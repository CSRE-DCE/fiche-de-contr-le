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
 * TABLETTE PARTAGÉE (deux tablettes pour quatre agents, mode autonome : celui de l'OEG) : chaque agent a son
 * entrée dans le trousseau de chaque tablette où il travaille (« Agents de cette tablette » : clé de l'appareil
 * chiffrée par SON mot de passe) et le MÊME profil « user » partout (« Ajouter un agent » : nouveau profil ;
 * « Ajouter sur cette tablette » : enrollAgent avec l'identifiant du profil reçu de l'autre tablette par fichier) ;
 * jamais de tablette sans administrateur (removeAgentFromDevice, assertAdminRemains). Tablette supplémentaire : mise
 * en service avec le fichier d'échange de la première (setupFromProfile : profil reçu, même identifiant). Mode équipe (option
 * avancée) : seuls les comptes explicitement rattachés à un login GitHub suivent config/utilisateurs.json.
 */
import { meta } from './db.js';
import { session, clearSession } from './session.js';
import { store } from './store.js';
import { wrapDEK, unwrapDEK, importDEK, newDEKRaw } from './crypto.js';
import { uuid, nowISO } from './util.js';

import { ROLES, PERMISSIONS, isAuditController, agentFullName } from '../domain/permissions.js';
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
/** Agents de cette tablette (entrées du trousseau), derniers connectés en premier. */
export async function knownUsers() {
  const k = await getKeyring();
  return Object.entries(k.users).map(([username, e]) => ({ username, userId: e.userId, name: e.name, initials: e.initials || null, role: e.role, lastLogin: e.lastLogin, disabled: !!e.disabled, githubLogin: e.githubLogin || null }))
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

/**
 * Premier démarrage en mode autonome (celui de l'OEG) : crée la clé de la tablette et l'agent administrateur qui la
 * configure (admin : { firstName, lastName, initials, username, password } — comme « Ajouter un agent » — ou, forme
 * antérieure, { name, username, password }).
 */
export async function setupStandalone({ deviceName, deviceNumber, admin }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(admin.password);
  const ident = {};
  for (const k of ['firstName', 'lastName', 'initials']) if (String(admin[k] || '').trim()) ident[k] = String(admin[k]).trim();
  if (ident.initials) ident.initials = ident.initials.toUpperCase().slice(0, 4);
  const name = String(admin.name || agentFullName(ident.firstName, ident.lastName)).trim();
  if (!name || !normUsername(admin.username)) throw new Error('Nom et identifiant de l’administrateur requis.');
  await loadDevice();
  await updateDevice({ name: deviceName || defaultDeviceName(), number: Math.max(1, Math.min(99, Number(deviceNumber) || 1)) });
  await meta.set('mode', 'standalone'); session.mode = 'standalone';
  const dekRaw = newDEKRaw();
  const user = { id: uuid(), username: normUsername(admin.username), name, ...ident, role: 'admin', active: true };
  const k = await getKeyring();
  k.users[user.username] = { userId: user.id, name: user.name, ...(ident.initials ? { initials: ident.initials } : {}), role: user.role, wrap: await wrapDEK(dekRaw, admin.password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, user);
  await store.put('user', { ...user, source: 'local' }, { action: 'create', reason: 'Configuration initiale de l’appareil' });
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'autonome', device: session.device } });
  return user;
}

/**
 * Mise en service d'une TABLETTE SUPPLÉMENTAIRE (mode autonome) avec le fichier d'échange de l'autre tablette : clé
 * de la tablette créée, agent qui la met en service (« Qui êtes-vous ? » : un agent actif parmi les profils reçus)
 * ajouté au trousseau avec SON profil — même identifiant de profil, aucun profil en double — et le mot de passe qu'il
 * choisit pour cette tablette. Les données du fichier (son profil compris) sont reçues ensuite (js/app/exchange.js :
 * setupFromExchange). Mise en service par un agent qui n'est pas administrateur : un administrateur s'ajoute ensuite
 * lui-même sur la tablette (enrollAgent, tablette sans administrateur).
 */
export async function setupFromProfile({ deviceName, deviceNumber, profile, password }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(password);
  const username = normUsername(profile?.username);
  if (!profile?.id || !username) throw new Error('Choisissez votre profil.');
  if (profile.active === false || profile._deleted) throw new Error(`Le compte de ${profile.name} est désactivé.`);
  await loadDevice();
  await updateDevice({ name: String(deviceName || '').trim() || defaultDeviceName(), number: Math.max(1, Math.min(99, Number(deviceNumber) || 2)) });
  await meta.set('mode', 'standalone'); session.mode = 'standalone';
  const dekRaw = newDEKRaw();
  const k = await getKeyring();
  k.users[username] = { userId: profile.id, name: profile.name, ...(profile.initials ? { initials: profile.initials } : {}), role: profile.role, wrap: await wrapDEK(dekRaw, password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, { id: profile.id, username, name: profile.name, role: profile.role });
  return session.user;
}

/** Ouverture de session hors connexion (ou en ligne, la vérification est locale). */
export async function unlock(username, password) {
  username = normUsername(username);
  const k = await getKeyring();
  const entry = k.users[username];
  if (!entry) return { ok: false, error: 'Agent inconnu sur cette tablette.' };
  if (entry.disabled) return { ok: false, error: 'Ce compte est désactivé sur cette tablette.' };
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
    if (profile.role !== entry.role || profile.name !== entry.name || (profile.initials || null) !== (entry.initials || null)) { entry.role = profile.role; entry.name = profile.name; entry.initials = profile.initials || null; await saveKeyring(k); }
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

/**
 * Crée ou met à jour l'entrée d'un agent dans le trousseau de cette tablette (les deux modes) ; source 'local' :
 * crée aussi son profil. extra : champs du profil (ex. { firstName, lastName, initials }, { githubLogin }) ; les
 * initiales et le login GitHub sont aussi gardés dans le trousseau (écran « Qui utilise la tablette ? »).
 */
export async function addLocalAccount({ id, username, name, role, password, source = 'local', extra = {} }) {
  if (!session.dekRaw) throw new Error('Session fermée');
  validatePassword(password);
  username = normUsername(username);
  const k = await getKeyring();
  if (k.users[username] && k.users[username].userId !== id) throw new Error('Identifiant déjà utilisé sur cette tablette.');
  // Nouveau profil : identifiant libre aussi parmi les profils reçus de l'autre tablette (même identifiant partout).
  const homonym = !id ? store.find('user', x => normUsername(x.username) === username) : null;
  if (homonym) throw new Error(`Identifiant « ${username} » déjà utilisé par ${homonym.name}.`);
  const userId = id || uuid();
  k.users[username] = { ...(k.users[username] || {}), userId, name, role, wrap: await wrapDEK(session.dekRaw, password), lastLogin: k.users[username]?.lastLogin || null, ...(extra.githubLogin !== undefined ? { githubLogin: extra.githubLogin || null } : {}), ...(extra.initials !== undefined ? { initials: extra.initials || null } : {}) };
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

/* ---------- Agents de la tablette (tablette partagée) ---------- */
/**
 * « Ajouter sur cette tablette » : crée l'entrée du trousseau d'un agent dont le profil existe déjà (reçu d'une
 * autre tablette par la synchronisation ou par un paquet), avec le MÊME identifiant de profil : même identité sur
 * toutes les tablettes (tournées, saisies, journal). `password` : mot de passe choisi et saisi par l'agent pour
 * cette tablette. Le profil n'est pas modifié (rôle, rattachement GitHub : ceux de l'équipe).
 */
export async function enrollAgent(userId, password) {
  if (!session.dekRaw) throw new Error('Session fermée');
  const u = store.get('user', userId);
  // Tablette sans administrateur (mise en service par un agent) : tout agent connecté peut y ajouter un ADMINISTRATEUR,
  // qui choisit et saisit lui-même son mot de passe ; ensuite, seul un administrateur ajoute les agents.
  const bootstrap = u?.role === 'admin' && !(await tabletHasAdmin());
  if (!can('users.manage') && !bootstrap) throw new Error('Seul un administrateur peut ajouter un agent sur cette tablette.');
  if (!u) throw new Error('Profil inconnu sur cette tablette : recevez d’abord les données de l’autre tablette.');
  if (u.active === false) throw new Error(`Le compte de ${u.name} est désactivé.`);
  const k = await getKeyring();
  if (Object.values(k.users).some(e => e.userId === userId)) throw new Error(`${u.name} est déjà sur cette tablette.`);
  const username = normUsername(u.username);
  if (!username) throw new Error(`Le profil de ${u.name} n’a pas d’identifiant.`);
  if (k.users[username]) {
    // Même identifiant, autre profil (ex. compte créé à la configuration de cette tablette avec l'identifiant qu'il a
    // déjà sur l'autre) : un identifiant ne désigne qu'un agent ; l'entrée locale doit d'abord être retirée.
    const other = k.users[username], self = other.userId === session.user?.id;
    throw new Error(`L’identifiant « ${username} » est déjà utilisé sur cette tablette par ${other.name} (autre profil, créé sur cette tablette). `
      + `Pour ajouter ${u.name} avec son profil de l’autre tablette, ${self ? 'un autre administrateur doit d’abord retirer votre compte de cette tablette' : `retirez d’abord ${other.name} de cette tablette`}, puis recommencez.`);
  }
  await addLocalAccount({ id: u.id, username, name: u.name, role: u.role, password, source: 'kept', extra: { initials: u.initials || null } });
  await store.log('account-enroll', { entityType: 'user', entityId: u.id, entityLabel: u.name, details: { identifiant: username, appareil: session.device?.name || '' } });
  return u;
}
/** La tablette a-t-elle au moins un administrateur actif dans son trousseau ? */
export async function tabletHasAdmin() {
  const k = await getKeyring();
  return Object.values(k.users).some(e => { const prof = store.get('user', e.userId); return !e.disabled && (prof?.role || e.role) === 'admin' && prof?.active !== false; });
}
/**
 * « Retirer de cette tablette » : supprime SEULEMENT l'entrée du trousseau (l'agent ne peut plus ouvrir de session
 * ici) ; son profil, ses tournées et ses saisies restent, ainsi que ses accès sur les autres tablettes. Jamais
 * l'agent connecté ni le dernier administrateur de la tablette.
 */
export async function removeAgentFromDevice(userId) {
  if (!session.dekRaw) throw new Error('Session fermée');
  if (!can('users.manage')) throw new Error('Seul un administrateur peut retirer un agent de cette tablette.');
  if (userId === session.user?.id) throw new Error('Vous êtes connecté : un autre administrateur doit vous retirer de cette tablette.');
  const k = await getKeyring();
  const names = Object.keys(k.users).filter(n => k.users[n].userId === userId);
  if (!names.length) throw new Error('Cet agent n’est pas sur cette tablette.');
  const isAdmin = e => { const prof = store.get('user', e.userId); return (prof?.role || e.role) === 'admin' && !e.disabled && prof?.active !== false; };
  if (names.some(n => isAdmin(k.users[n])) && !Object.values(k.users).some(e => e.userId !== userId && isAdmin(e))) {
    throw new Error('Dernier administrateur de cette tablette : il ne peut pas en être retiré.');
  }
  const name = k.users[names[0]].name;
  for (const n of names) delete k.users[n];
  await saveKeyring(k);
  await store.log('account-remove', { entityType: 'user', entityId: userId, entityLabel: name, details: { identifiant: names.join(', '), appareil: session.device?.name || '' } });
}
/**
 * Garde-fou « dernier administrateur » avant de modifier un profil (`next` : { role, active }) : un administrateur
 * ne perd son profil (changement de profil, désactivation) que s'il reste un autre administrateur actif sur cette
 * tablette (s'il y est) et dans l'ensemble des profils.
 */
export async function assertAdminRemains(userId, next = {}) {
  const u = store.get('user', userId);
  if (!u || u.role !== 'admin' || ((next.role ?? u.role) === 'admin' && next.active !== false)) return;
  const k = await getKeyring();
  const activeAdmin = e => { const prof = store.get('user', e.userId); return (prof?.role || e.role) === 'admin' && !e.disabled && prof?.active !== false; };
  if (Object.values(k.users).some(e => e.userId === userId) && !Object.values(k.users).some(e => e.userId !== userId && activeAdmin(e))) {
    throw new Error(`${u.name} est le dernier administrateur de cette tablette : ajoutez d’abord un autre administrateur.`);
  }
  if (!store.filter('user', x => x.id !== userId && x.role === 'admin' && x.active !== false).length) throw new Error('Il doit rester au moins un administrateur actif.');
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
    if (user.initials !== undefined) e.initials = user.initials || null;
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
 * Tablette partagée : le compte créé est celui de l'administrateur qui configure la tablette (propriétaire du
 * jeton de la tablette) ; account.id = identifiant de SON profil existant dans l'équipe (deuxième tablette) :
 * même identité sur les deux tablettes (le profil est reçu à la première synchronisation). Les agents sont
 * ensuite ajoutés depuis Administration › Agents de cette tablette.
 */
export async function setupTeam({ deviceName, account, team, token, login, role = 'auditeur' }) {
  if (await isSetUp()) throw new Error('Cet appareil est déjà configuré.');
  validatePassword(account.password);
  if (!token) throw new Error('Jeton d’accès GitHub requis.');
  await loadDevice();
  await updateDevice({ name: deviceName || defaultDeviceName() });
  const t = await setTeamMode(team);
  const dekRaw = newDEKRaw();
  const user = { id: account.id || uuid(), username: normUsername(account.username), name: String(account.name || '').trim(), role: ROLES[role] ? role : 'auditeur', active: true, githubLogin: login || null };
  if (!user.username || !user.name) throw new Error('Nom et identifiant du compte local requis.');
  const k = await getKeyring();
  k.users[user.username] = { userId: user.id, name: user.name, role: user.role, githubLogin: user.githubLogin, wrap: await wrapDEK(dekRaw, account.password), lastLogin: nowISO() };
  await saveKeyring(k);
  await openWithDEK(dekRaw, { id: user.id, username: user.username, name: user.name, role: user.role });
  // Profil existant de l'équipe (account.id) : reçu à la première synchronisation, il n'est pas recréé ici.
  if (!account.id) await store.put('user', { ...user, source: 'local' }, { action: 'create', reason: 'Configuration initiale de l’appareil (équipe)' });
  await saveTeamToken(token, login);
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'équipe GitHub', depot: teamLabel(t), branche: t.branch, prefixe: t.prefix, compteGitHub: login, device: session.device, ...(account.id ? { profilExistant: account.id } : {}) } });
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

