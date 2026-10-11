/* Authentification, rôles et droits.
 *
 * Les comptes sont toujours LOCAUX à l'appareil (mot de passe vérifié hors connexion par désenveloppement
 * de la clé de chiffrement de l'appareil). Deux modes :
 *  - autonome : données uniquement sur l'appareil, échanges par paquets export/import ;
 *  - équipe (GitHub) : l'appareil est rattaché à un dépôt GitHub PRIVÉ de données (propriétaire/dépôt,
 *    branche, préfixe) et se synchronise par l'API REST GitHub avec un jeton d'accès « fine-grained »
 *    conservé CHIFFRÉ avec la clé de l'appareil (entité locale jamais synchronisée). Le rôle d'un compte
 *    rattaché à un login GitHub est celui de config/utilisateurs.json (appliqué par js/app/sync.js) ; à
 *    défaut, son rôle local.
 */
import { meta } from './db.js';
import { session, clearSession } from './session.js';
import { store } from './store.js';
import { wrapDEK, unwrapDEK, importDEK, newDEKRaw } from './crypto.js';
import { uuid, nowISO } from './util.js';

import { ROLES, PERMISSIONS, isAuditController } from '../domain/permissions.js';
export { ROLES, PERMISSIONS };

export function can(perm, user = session.user) {
  if (!user) return false;
  return (PERMISSIONS[perm] || []).includes(user.role);
}
/**
 * Droit de saisir dans une tournée précise : contrôleur OEG de la tournée (audit.controllerIds ; audit antérieur :
 * son auteur) ou encadrement (audit.editOthers). Tournée verrouillée : non (modification motivée à part).
 */
export function canEditAudit(audit, user = session.user) {
  if (!audit || !user) return false;
  if (audit.lock?.lockedAt) return false;
  if (!can('audit.edit', user)) return false;
  return isAuditController(audit, user.id) || can('audit.editOthers', user);
}

/* ---------- trousseau de clés local ---------- */
export async function getKeyring() { return meta.get('keyring', { users: {} }); }
async function saveKeyring(k) { await meta.set('keyring', k); }
export async function isSetUp() { const k = await getKeyring(); return Object.keys(k.users).length > 0; }
export async function knownUsers() {
  const k = await getKeyring();
  return Object.entries(k.users).map(([username, e]) => ({ username, name: e.name, role: e.role, lastLogin: e.lastLogin }))
    .sort((a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')));
}

export async function loadDevice() {
  let device = await meta.get('device');
  if (!device) {
    device = { id: uuid(), name: defaultDeviceName(), number: 1, createdAt: nowISO() };
    await meta.set('device', device);
  }
  session.device = device;
  session.mode = await meta.get('mode', null);
  session.team = session.mode === TEAM_MODE ? await meta.get('team', null) : null;
  return device;
}
export async function updateDevice(patch) {
  const device = { ...(await meta.get('device')), ...patch };
  await meta.set('device', device); session.device = device; return device;
}
export function defaultDeviceName() {
  const ua = globalThis.navigator?.userAgent || '';
  const os = /Android/.test(ua) ? 'Android' : /iPad|iPhone|Macintosh/.test(ua) && 'ontouchend' in (globalThis.document || {}) ? 'iPad/iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  return `${os} · ${br}`;
}

async function openWithDEK(dekRaw, user) {
  session.dekRaw = dekRaw;
  session.dek = await importDEK(dekRaw);
  session.user = user;
  session.unlockedAt = nowISO();
  session.lastActivity = Date.now();
  await store.load();
}

/** Premier démarrage en mode autonome : crée l'administrateur local et la clé de l'appareil. */
export async function setupStandalone({ deviceName, deviceNumber, admin }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(admin.password);
  await loadDevice();
  await updateDevice({ name: deviceName || defaultDeviceName(), number: Math.max(1, Math.min(99, Number(deviceNumber) || 1)) });
  await meta.set('mode', 'standalone'); session.mode = 'standalone';
  const dekRaw = newDEKRaw();
  const user = { id: uuid(), username: normUsername(admin.username), name: admin.name.trim(), role: 'admin', active: true };
  const k = await getKeyring();
  k.users[user.username] = { userId: user.id, name: user.name, role: user.role, wrap: await wrapDEK(dekRaw, admin.password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, user);
  await store.put('user', { ...user, source: 'local' }, { action: 'create', reason: 'Configuration initiale de l’appareil' });
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'autonome', device: session.device } });
  return user;
}

/** Ouverture de session hors connexion (ou en ligne, la vérification est locale). */
export async function unlock(username, password) {
  username = normUsername(username);
  const k = await getKeyring();
  const entry = k.users[username];
  if (!entry) return { ok: false, error: 'Compte inconnu sur cet appareil.' };
  if (entry.disabled) return { ok: false, error: 'Ce compte est désactivé sur cet appareil.' };
  const dekRaw = await unwrapDEK(entry.wrap, password);
  if (!dekRaw) {
    entry.failures = (entry.failures || 0) + 1; entry.lastFailure = nowISO();
    await saveKeyring(k);
    return { ok: false, error: 'Mot de passe incorrect.' };
  }
  entry.failures = 0; entry.lastLogin = nowISO();
  await saveKeyring(k);
  await openWithDEK(dekRaw, { id: entry.userId, username, name: entry.name, role: entry.role });
  // Le profil enregistré dans les données (rôle mis à jour par un administrateur) fait foi.
  const profile = store.get('user', entry.userId);
  if (profile) {
    if (profile.active === false) { await lock('compte désactivé'); return { ok: false, error: 'Ce compte a été désactivé.' }; }
    session.user = { id: profile.id, username, name: profile.name, role: profile.role };
    if (profile.role !== entry.role || profile.name !== entry.name) { entry.role = profile.role; entry.name = profile.name; await saveKeyring(k); }
  }
  await store.log('login', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name });
  return { ok: true, user: session.user, password };
}

export async function lock(reason = 'manuel') {
  if (session.unlocked) {
    try { await store.log('logout', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name, reason }); await store.flush(); } catch (e) { /* journal best effort */ }
  }
  store.unload();
  clearSession();
}

/** Crée un compte local (les deux modes ; extra : champs du profil, ex. { githubLogin }). */
export async function addLocalAccount({ id, username, name, role, password, source = 'local', extra = {} }) {
  if (!session.dekRaw) throw new Error('Session fermée');
  validatePassword(password);
  username = normUsername(username);
  const k = await getKeyring();
  if (k.users[username] && k.users[username].userId !== id) throw new Error('Identifiant déjà utilisé sur cet appareil.');
  const userId = id || uuid();
  k.users[username] = { ...(k.users[username] || {}), userId, name, role, wrap: await wrapDEK(session.dekRaw, password), lastLogin: k.users[username]?.lastLogin || null, ...(extra.githubLogin !== undefined ? { githubLogin: extra.githubLogin || null } : {}) };
  await saveKeyring(k);
  if (source === 'local') {
    const existing = store.get('user', userId);
    await store.put('user', { ...(existing || {}), id: userId, username, name, role, active: true, source, ...extra });
  }
  return userId;
}
export async function removeLocalAccount(username) {
  const k = await getKeyring(); delete k.users[normUsername(username)]; await saveKeyring(k);
}
export async function setLocalAccountDisabled(username, disabled) {
  const k = await getKeyring(); const e = k.users[normUsername(username)];
  if (e) { e.disabled = !!disabled; await saveKeyring(k); }
}
export async function syncKeyringProfile(user) {
  const k = await getKeyring(); const e = k.users[normUsername(user.username)];
  if (e) {
    e.name = user.name; e.role = user.role; e.disabled = user.active === false;
    if (user.githubLogin !== undefined) e.githubLogin = user.githubLogin || null;
    await saveKeyring(k);
  }
}

export async function changePassword(oldPassword, newPassword) {
  validatePassword(newPassword);
  const k = await getKeyring();
  const entry = k.users[session.user.username];
  if (!entry || !(await unwrapDEK(entry.wrap, oldPassword))) throw new Error('Mot de passe actuel incorrect.');
  entry.wrap = await wrapDEK(session.dekRaw, newPassword);
  await saveKeyring(k);
  await store.log('password-change', { entityType: 'user', entityId: session.user.id, entityLabel: session.user.name });
}

export function validatePassword(p) {
  if (!p || String(p).length < 8) throw new Error('Le mot de passe doit comporter au moins 8 caractères.');
}
export function normUsername(u) { return String(u || '').trim().toLowerCase(); }

/* ---------- mode équipe (dépôt GitHub de données) ---------- */
export const TEAM_MODE = 'github';
export const TEAM_DEFAULTS = { apiUrl: 'https://api.github.com', branch: 'main', prefix: 'donnees/' };
const TOKEN_ID = 'github:token';

export function isTeamMode() { return session.mode === TEAM_MODE; }
/** « propriétaire/dépôt » de l'équipe (affichage). */
export function teamLabel(team = session.team) { return team ? `${team.owner}/${team.repo}` : ''; }

function cleanTeam(t) {
  return { apiUrl: t.apiUrl || TEAM_DEFAULTS.apiUrl, owner: t.owner, repo: t.repo, branch: t.branch || TEAM_DEFAULTS.branch, prefix: t.prefix ?? TEAM_DEFAULTS.prefix, attachedAt: t.attachedAt || nowISO(), orgName: t.orgName || '' };
}
async function setTeamMode(team) {
  const t = cleanTeam(team);
  await meta.set('mode', TEAM_MODE); await meta.set('team', t);
  session.mode = TEAM_MODE; session.team = t;
  return t;
}

/** Jeton GitHub : conservé chiffré avec la clé de l'appareil (entité locale « localSecret », jamais synchronisée). */
export async function saveTeamToken(token, login) {
  if (!session.dekRaw) throw new Error('Session fermée');
  session.token = token; session.githubLogin = login || null;
  await store.put('localSecret', { id: TOKEN_ID, token, login: login || null, savedAt: nowISO(), savedBy: session.user?.id || null });
}
/** Recharge le jeton en mémoire après l'ouverture de session (mode équipe). */
export function restoreToken() {
  const t = store.get('localSecret', TOKEN_ID);
  if (isTeamMode() && t?.token) { session.token = t.token; session.githubLogin = t.login || null; }
  else { session.token = null; session.githubLogin = null; }
  return !!session.token;
}
/** Informations non secrètes sur le jeton enregistré. */
export function tokenInfo() { const t = store.get('localSecret', TOKEN_ID); return t?.token ? { login: t.login, savedAt: t.savedAt, savedBy: t.savedBy } : null; }

/** Rattache un compte local à un login GitHub (son rôle suivra config/utilisateurs.json). */
export async function linkGithubLogin(userId, login) {
  const k = await getKeyring();
  for (const e of Object.values(k.users)) if (e.userId === userId) e.githubLogin = login || null;
  await saveKeyring(k);
  const u = store.get('user', userId);
  if (u && (u.githubLogin || null) !== (login || null)) await store.put('user', { ...u, githubLogin: login || null }, { reason: 'Rattachement au compte GitHub ' + (login || '(aucun)') });
}

/**
 * Premier démarrage en mode équipe (« Rejoindre une équipe ») : crée la clé de l'appareil et le compte
 * local, enregistre la configuration du dépôt et le jeton (chiffré). Le rôle initial est celui de
 * config/utilisateurs.json pour ce login, « admin » pour celui qui initialise un dépôt vide, sinon « auditeur ».
 * Les données de l'équipe sont ensuite reçues par la première synchronisation.
 */
export async function setupTeam({ deviceName, account, team, token, login, role = 'auditeur' }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(account.password);
  if (!token) throw new Error('Jeton d’accès GitHub requis.');
  await loadDevice();
  await updateDevice({ name: deviceName || defaultDeviceName() });
  const t = await setTeamMode(team);
  const dekRaw = newDEKRaw();
  const user = { id: uuid(), username: normUsername(account.username), name: String(account.name || '').trim(), role: ROLES[role] ? role : 'auditeur', active: true, githubLogin: login || null };
  if (!user.username || !user.name) throw new Error('Nom et identifiant du compte local requis.');
  const k = await getKeyring();
  k.users[user.username] = { userId: user.id, name: user.name, role: user.role, githubLogin: user.githubLogin, wrap: await wrapDEK(dekRaw, account.password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, { id: user.id, username: user.username, name: user.name, role: user.role });
  await store.put('user', { ...user, source: 'local' }, { action: 'create', reason: 'Configuration initiale de l’appareil (équipe)' });
  await saveTeamToken(token, login);
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'équipe GitHub', depot: teamLabel(t), branche: t.branch, prefixe: t.prefix, compteGitHub: login, device: session.device } });
  return user;
}

/**
 * Rattache un appareil déjà configuré (session ouverte) à un dépôt d'équipe : toutes les données locales
 * seront fusionnées avec celles du dépôt à la prochaine synchronisation. Le compte courant est relié au
 * login GitHub du jeton.
 */
export async function attachTeam({ team, token, login }) {
  if (!session.dekRaw) throw new Error('Session fermée');
  const t = await setTeamMode(team);
  await saveTeamToken(token, login);
  await linkGithubLogin(session.user.id, login);
  await store.log('attach-team', { entityLabel: teamLabel(t), details: { depot: teamLabel(t), branche: t.branch, prefixe: t.prefix, compteGitHub: login } });
  return t;
}

/** Détache l'appareil de l'équipe : retour au mode autonome, jeton effacé ; les données locales restent. */
export async function detachTeam(reason = null) {
  const label = teamLabel();
  await meta.set('mode', 'standalone'); await meta.del('team');
  session.mode = 'standalone'; session.team = null; session.token = null; session.githubLogin = null;
  if (store.getRaw('localSecret', TOKEN_ID)) await store.put('localSecret', { id: TOKEN_ID, _deleted: true });
  await store.log('detach-team', { entityLabel: label, reason, details: { depot: label } });
}

