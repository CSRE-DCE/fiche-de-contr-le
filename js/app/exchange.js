/* Échanges entre tablettes par fichier (mode autonome, celui de l'OEG) : aucun serveur, aucun jeton, hors connexion.
 *
 *  ENVOYER (« Envoyer à l'autre tablette ») : un fichier unique « OEG-echange_<tablette>_<AAAA-MM-JJ_HHhMM>.oegct »
 *   (js/app/exchange-file.js : TOUJOURS chiffré avec le mot de passe d'échange de l'équipe, empreintes SHA-256)
 *   contenant les données modifiées depuis le dernier envoi — file d'envoi « outbox » de js/core/store.js, où toute
 *   écriture locale est inscrite et qu'un envoi vide — ou tout (« Tout envoyer ») : profils d'agents (jamais de mot
 *   de passe, de trousseau, de jeton ni de clé : types propres à la tablette exclus), tournées, réponses, écarts,
 *   signatures, journal d'audit, référentiels, suppressions (pierres tombales `_deleted`) et abandons, photos et
 *   documents pas encore envoyés. Le partage (Quick Share, Bluetooth, e-mail, Teams, clé USB) : js/views/exchange.js.
 *  RECEVOIR : déchiffrement avec le mot de passe d'échange de la tablette (fichier chiffré avec un autre mot de
 *   passe : erreur claire, mot de passe demandé, rien n'est modifié), vérification d'intégrité, aperçu, puis réception
 *   donnée par donnée selon les versions (js/domain/exchange.js : planEntity — ajout, déjà connue ou plus ancienne,
 *   plus récente, fusion champ par champ avec conflits conservés, tournée signée gardée scellée) ; journal d'audit de
 *   l'autre tablette ajouté entrée par entrée ; photos stockées chiffrées. Profils : guardProfile (changement de
 *   profil ou de statut actif en attente de validation, sauf fichier envoyé par un administrateur de la tablette).
 *   Le trousseau n'est jamais remplacé : seuls le nom, les initiales et le profil affichés sur l'écran « Qui utilise
 *   la tablette ? » suivent le profil reçu. Les anciens paquets de données JSON sont acceptés.
 *  VERSIONS COMMUNES : versions envoyées et reçues de chaque donnée, gardées chiffrées hors mémoire (type « xbase ») :
 *   bases des fusions (une saisie faite d'un seul côté n'est jamais un conflit).
 *  MOT DE PASSE D'ÉCHANGE : défini par un administrateur sur chaque tablette (10 caractères minimum), conservé chiffré
 *   avec la clé de la tablette (entité locale « localSecret », jamais échangée) : envoyer et recevoir ne demandent
 *   plus rien.
 *  HISTORIQUE : envois et réceptions (entité locale « exchangeLog »), journal d'audit (exchange-send /
 *   exchange-receive), fichiers déjà reçus, tablettes connues de l'équipe (n° uniques : numéros d'audit sans doublon).
 */
import { idb, meta } from '../core/db.js';
import { store, LOCAL_ONLY, LAZY_TYPES } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { decryptBytes } from '../core/crypto.js';
import { can, getKeyring, syncKeyringProfile, setupFromProfile, assertAdminRemains, ROLES } from '../core/auth.js';
import { storeRemoteBytes, hasLocalBytes } from '../core/media.js';
import { uuid, nowISO, fmtDateTime, sortBy, base64ToBytes } from '../core/util.js';
import { encodeExchange, decodeExchange, isExchangeText, ExchangeError } from './exchange-file.js';
import { planEntity, guardProfile, nextCandidates, exchanged, exchangeFileName, countEntities, countsLabel, freeDeviceNumber, heldLabel, selectForSend } from '../domain/exchange.js';
import { IMMUTABLE_TYPES } from '../domain/merge.js';
import { upToDateGrid } from '../domain/default-grids.js';
import { orgSettings } from './settings.js';

export { ExchangeError };
const PASSWORD_ID = 'exchange:password';
const BASE = 'xbase';
export const EXCHANGE_PASSWORD_MIN = 10;
/** Taille au-delà de laquelle un e-mail risque de refuser le fichier (≈ 20 Mo). */
export const LARGE_FILE = 20 * 1024 * 1024;
const shared = type => !LOCAL_ONLY.has(type) && !LAZY_TYPES.has(type);
const deviceRef = () => ({ id: session.device?.id || null, name: session.device?.name || '', number: Number(session.device?.number) || null });

/* ---------- Mot de passe d'échange de l'équipe ---------- */
export function validateExchangePassword(p) {
  if (!p || String(p).length < EXCHANGE_PASSWORD_MIN) throw new Error(`Le mot de passe d’échange doit comporter au moins ${EXCHANGE_PASSWORD_MIN} caractères.`);
}
/** Mot de passe d'échange enregistré sur la tablette : { setAt, setByName } (jamais le mot de passe) ou null. */
export function exchangePasswordInfo() {
  const s = store.get('localSecret', PASSWORD_ID);
  return s?.password ? { setAt: s.setAt, setByName: s.setByName || '' } : null;
}
const exchangePassword = () => store.get('localSecret', PASSWORD_ID)?.password || null;
/**
 * Définit ou change le mot de passe d'échange de la tablette (administrateur ; le même sur toutes les tablettes).
 * setup : mise en service d'une tablette supplémentaire (mot de passe qui a ouvert le fichier, quel que soit l'agent).
 */
export async function setExchangePassword(password, { reason = null, setup = false } = {}) {
  if (!setup && !can('settings.manage')) throw new Error('Seul un administrateur peut définir le mot de passe d’échange.');
  validateExchangePassword(password);
  const had = !!exchangePassword();
  await store.put('localSecret', { id: PASSWORD_ID, password: String(password), setAt: nowISO(), setBy: session.user?.id || null, setByName: session.user?.name || '' });
  await store.log('exchange-password', { entityLabel: had ? 'Mot de passe d’échange changé' : 'Mot de passe d’échange défini', reason });
}
/** Message quand le mot de passe d'échange manque (envoi, réception). */
export function missingPasswordMessage() {
  return can('settings.manage') ? 'Définissez d’abord le mot de passe d’échange de l’équipe (Administration › Échanges entre tablettes).'
    : 'Le mot de passe d’échange n’est pas encore défini sur cette tablette : demandez à un administrateur (Administration › Échanges entre tablettes).';
}

/* ---------- Tablettes de l'équipe ---------- */
/** Tablettes connues (celle-ci en premier) : [{ id, name, number, seenAt, self }]. */
export async function knownDevices() {
  const map = await meta.get('xch:devices', {});
  const self = session.device ? { ...deviceRef(), self: true } : null;
  const others = sortBy(Object.values(map).filter(d => d.id && d.id !== self?.id), d => Number(d.number) || 99, 'name');
  return self ? [self, ...others] : others;
}
async function rememberDevices(body) {
  const map = await meta.get('xch:devices', {});
  for (const d of [...(body.devices || []), body.from]) {
    if (!d?.id || d.id === session.device?.id) continue;
    const prev = map[d.id] || {};
    map[d.id] = { id: d.id, name: d.name || prev.name || '', number: Number(d.number) || prev.number || null, seenAt: d.id === body.from?.id ? body.createdAt : prev.seenAt || null };
  }
  await meta.set('xch:devices', map);
}
/** N° proposé pour une tablette supplémentaire (différent de ceux des tablettes connues du fichier). */
export function proposedDeviceNumber(rx) { return freeDeviceNumber([...(rx?.body?.devices || []), rx?.body?.from].filter(Boolean)); }

/* ---------- Modifications à envoyer ---------- */
/** Modifications pas encore envoyées à l'autre tablette : { total, byType, media, journal, label, tours (numéros) }. */
export async function pendingChanges() {
  await store.flush();
  const keys = await idb.keys('outbox').catch(() => []);
  const byType = {}, tours = [];
  let total = 0, media = 0, journal = 0;
  for (const key of keys) {
    const k = String(key), i = k.indexOf(':'), type = k.slice(0, i);
    if (type === '__bin') media++;
    else if (type === 'trail') journal++;
    else if (shared(type)) {
      byType[type] = (byType[type] || 0) + 1; total++;
      if (type === 'audit') tours.push(store.getRaw('audit', k.slice(i + 1))?.number || k.slice(i + 1));
    }
  }
  return { total, byType, media, journal, label: countsLabel(byType, { media }), tours: tours.sort() };
}
/** État affiché (en-tête, accueil) : nombre de modifications à envoyer, mis à jour après chaque écriture locale. */
export const exchangeState = { pending: 0, label: '', media: 0 };
const listeners = new Set();
let unwatch = null, watchTimer = null;
export function onExchangeState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function refreshExchangeState() {
  if (!session.unlocked) return null;
  const p = await pendingChanges();
  Object.assign(exchangeState, { pending: p.total, label: p.label, media: p.media });
  for (const fn of listeners) { try { fn({ ...exchangeState }); } catch (e) { console.error(e); } }
  return p;
}
export function watchExchange() {
  unwatch?.();
  unwatch = store.subscribe(type => {
    if (LOCAL_ONLY.has(type) || type === 'error') return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => { refreshExchangeState().catch(() => {}); }, 400);
  });
  return refreshExchangeState().catch(() => null);
}
export function stopWatchExchange() { unwatch?.(); unwatch = null; clearTimeout(watchTimer); }

/* ---------- Versions échangées (bases des fusions) ---------- */
async function rememberVersions(entities, dir, at = nowISO()) {
  const list = [];
  for (const [type, arr] of Object.entries(entities || {})) {
    if (type === 'trail' || IMMUTABLE_TYPES.has(type)) continue;
    for (const e of arr || []) if (e?.id && e._vv && Object.keys(e._vv).length) list.push({ type, e });
  }
  for (let i = 0; i < list.length; i += 300) {
    const chunk = list.slice(i, i + 300), keys = chunk.map(x => `${x.type}:${x.e.id}`);
    const prev = await store.getLazyMany(BASE, keys);
    await store.applyExchange([], { lazy: chunk.map((x, j) => ({ type: BASE, id: keys[j], data: { cands: nextCandidates(prev.get(keys[j])?.cands, x.e, { dir, at }) } })) });
  }
}

/* ---------- Envoyer ---------- */
/**
 * Prépare le fichier à envoyer. scope : 'changes' (modifications depuis le dernier envoi) ou 'all' (« Tout envoyer ») ;
 * media : 'unsent' (photos et documents pas encore envoyés), 'all' ou 'none' (au prochain envoi). Rien n'est marqué
 * envoyé ici : markSent() une fois le fichier partagé ou enregistré.
 * Retourne { blob, fileName, size, scope, media, fileId, sha256, counts, label, empty, heldMedia }.
 */
export async function prepareSend({ scope = 'changes', media = scope === 'all' ? 'all' : 'unsent' } = {}) {
  const password = exchangePassword();
  if (!password) throw new Error(missingPasswordMessage());
  await store.flush();
  const outbox = new Map(await idb.entries('outbox'));
  const { entities, sent, media: ids } = selectForSend({
    scope, media, outbox: [...outbox], types: store.types().filter(shared),
    getRaw: (type, id) => store.getRaw(type, id), allOf: type => store.all(type, { withDeleted: true }), mediaIds: store.all('media').map(m => m.id)
  });
  const add = (type, e) => { (entities[type] = entities[type] || []).push(exchanged(e)); };
  // Données antérieures aux vecteurs de versions : première version de cette tablette, enregistrée aussi localement
  // (sinon une modification ultérieure aurait la même version que celle envoyée).
  const stamp = [];
  for (const [type, list] of Object.entries(entities)) {
    if (type === 'trail') continue;
    for (const e of list) if (!e._vv || !Object.keys(e._vv).length) { e._vv = { [session.device.id]: 1 }; stamp.push({ type, data: { ...store.getRaw(type, e.id), _vv: e._vv } }); }
  }
  if (stamp.length) await store.applyExchange(stamp);
  // Photos et documents (contenu déchiffré avec la clé de la tablette, rechiffré avec le mot de passe d'échange).
  const files = [], inFile = new Set((entities.media || []).map(m => m.id));
  for (const id of ids) {
    const rec = await idb.get('media', id);
    const bytes = rec ? await decryptBytes(session.dek, rec.iv, rec.ct).catch(() => null) : null;
    if (!bytes) continue;
    files.push({ id, bytes });
    const m = store.getRaw('media', id);
    if (m && !inFile.has(id)) { add('media', m); inFile.add(id); }   // fiche du média jointe à son contenu
    if (outbox.has('__bin:' + id)) sent.push({ key: '__bin:' + id, at: outbox.get('__bin:' + id)?.at });
  }
  const counts = { ...countEntities(entities), media: files.length, mediaBytes: files.reduce((s, f) => s + f.bytes.length, 0) };
  const now = new Date();
  const body = {
    id: uuid(), createdAt: now.toISOString(), scope, mediaScope: media,
    from: deviceRef(), sentBy: { id: session.user.id, name: session.user.name, role: session.user.role, username: session.user.username },
    appVersion: appVersion(), org: orgSettings().orgName || '',
    devices: (await knownDevices()).map(d => ({ id: d.id, name: d.name, number: d.number })),
    counts, entities
  };
  const { text, core } = await encodeExchange(body, files, password);
  const blob = new Blob([text], { type: 'application/octet-stream' });
  return {
    blob, fileName: exchangeFileName(session.device?.name, now), size: blob.size, scope, media, fileId: core.id, sha256: core.sha256, counts,
    label: countsLabel(counts.byType, { media: files.length }), empty: !counts.total && !files.length,
    heldMedia: media === 'none' ? [...outbox.keys()].filter(k => k.startsWith('__bin:')).length : 0,
    _sent: sent, _entities: entities
  };
}

/**
 * Fichier partagé ou enregistré (via : 'partage' | 'fichier') : file d'envoi vidée des données envoyées (sauf celles
 * modifiées depuis), versions envoyées mémorisées, historique et journal d'audit.
 */
export async function markSent(prep, { via = 'fichier' } = {}) {
  await store.dropOutbox(prep._sent);
  await rememberVersions(prep._entities, 'envoyée');
  const entry = { id: uuid(), at: nowISO(), dir: 'envoi', fileName: prep.fileName, fileId: prep.fileId, scope: prep.scope, via, agent: session.user?.name || '', device: deviceRef(), label: prep.label, counts: prep.counts, size: prep.size };
  await store.put('exchangeLog', entry);
  await meta.set('xch:lastSent', { at: entry.at, fileName: prep.fileName, via });
  await store.log('exchange-send', {
    entityLabel: prep.fileName,
    details: { contenu: prep.label || 'aucune modification', portee: prep.scope === 'all' ? 'tout' : 'modifications depuis le dernier envoi', taille: prep.size, moyen: via === 'partage' ? 'partage (Quick Share, e-mail, Teams…)' : 'fichier enregistré', empreinte: prep.sha256 }
  });
  refreshExchangeState().catch(() => {});
  return entry;
}
export function lastSent() { return meta.get('xch:lastSent', null); }

/* ---------- Recevoir ---------- */
/**
 * Lit un fichier reçu (.oegct, ou ancien paquet de données .json) : { body, media: Map, fileName, legacy, password,
 * otherPassword }. password : mot de passe saisi (fichier chiffré avec un autre mot de passe d'échange), sinon celui
 * de la tablette. ExchangeError : 'nopassword', 'password', 'password-backup', 'altered', 'integrity', 'format',
 * 'version', 'self'. Rien n'est modifié.
 */
export async function readExchange(source, { password = null, name = '', knownPassword = undefined } = {}) {
  const text = typeof source === 'string' ? source : await source.text();
  const fileName = name || source?.name || '';
  const own = knownPassword !== undefined ? knownPassword : session.unlocked ? exchangePassword() : null;
  let out;
  if (isExchangeText(text)) {
    const pw = password || own;
    if (!pw) throw new ExchangeError('nopassword', 'Saisissez le mot de passe d’échange de l’équipe pour ouvrir ce fichier.');
    const { body, media } = await decodeExchange(text, pw);
    out = { body, media, legacy: false, password: pw, otherPassword: !!own && pw !== own };
  } else out = await readLegacy(text, password);
  if (out.body.from?.id && out.body.from.id === session.device?.id) {
    throw new ExchangeError('self', `Ce fichier a été envoyé par cette tablette (${session.device.name}) : il est destiné à l’autre tablette.`);
  }
  return { ...out, fileName };
}

/** Ancien paquet de données JSON (format oeg-audit-package-v1, éventuellement sauvegarde chiffrée). */
async function readLegacy(text, password) {
  const t = String(text || '').trimStart();
  if (!t.startsWith('{')) throw new ExchangeError('format', 'Fichier non reconnu : choisissez le fichier d’échange envoyé par l’autre tablette (OEG-echange_….oegct).');
  const { readPackage } = await import('./exports.js');
  let pkg;
  try { pkg = await readPackage(t, password); }
  catch (e) {
    if (e.needsPassword) throw new ExchangeError('password-backup', 'Sauvegarde chiffrée : saisissez le mot de passe de cette sauvegarde.');
    throw new ExchangeError(/Mot de passe/.test(e.message) ? 'password-backup' : 'format', /Format/.test(e.message) ? 'Fichier non reconnu : choisissez le fichier d’échange envoyé par l’autre tablette (OEG-echange_….oegct).' : e.message);
  }
  if (!pkg.integrity) throw new ExchangeError('integrity', 'Empreinte d’intégrité (SHA-256) du paquet incorrecte : le fichier a été modifié. Rien n’a été modifié.');
  const media = new Map(Object.entries(pkg.media || {}).map(([id, b64]) => [id, base64ToBytes(b64)]));
  const entities = pkg.entities || {};
  const body = {
    format: pkg.format, id: 'paquet:' + pkg.sha256, createdAt: pkg.exportedAt, scope: 'all', legacy: true,
    from: { id: null, name: pkg.device || 'appareil inconnu', number: null }, sentBy: { id: null, name: pkg.exportedBy || '' }, entities,
    counts: { ...countEntities(entities), media: media.size, mediaBytes: [...media.values()].reduce((s, b) => s + b.length, 0) }
  };
  return { body, media, legacy: true, password: null, otherPassword: false };
}

/** Le fichier a-t-il été envoyé par un administrateur actif selon les données de CETTE tablette (avant réception) ? */
export function senderTrusted(body) {
  const u = body?.sentBy?.id ? store.get('user', body.sentBy.id) : null;
  return !!u && u.role === 'admin' && u.active !== false;
}

/** Aperçu avant réception : tablette d'origine, date, agents, tournées concernées, nombre d'éléments et de photos. */
export async function previewExchange(rx) {
  const { body } = rx;
  const ents = body.entities || {};
  const k = session.unlocked ? await getKeyring() : { users: {} };
  const enrolled = new Set(Object.values(k.users).map(e => e.userId));
  const siteName = id => (ents.site || []).find(s => s.id === id)?.name || (session.unlocked ? store.get('site', id)?.name : '') || '';
  const known = (type, id) => session.unlocked && !!store.getRaw(type, id);
  const agents = sortBy((ents.user || []).filter(u => u && !u._deleted), 'name').map(u => ({ id: u.id, name: u.name, role: u.role, roleLabel: ROLES[u.role] || u.role, active: u.active !== false, isNew: !known('user', u.id), onTablet: enrolled.has(u.id) }));
  const tours = sortBy((ents.audit || []).filter(Boolean), 'number').map(a => ({
    id: a.id, number: a.number || a.id, status: a.status, signed: !!a.lock?.lockedAt, deleted: !!a._deleted, isNew: !known('audit', a.id),
    stations: (a.stations || []).map(s => siteName(s.siteId) || s.key).filter(Boolean).join(', ') || siteName(a.siteId)
  }));
  const counts = body.counts || countEntities(ents);
  const received = (await meta.get('xch:received', [])).find(r => r.id === body.id) || null;
  const sameNumber = !body.legacy && body.from?.number && session.device && Number(body.from.number) === Number(session.device.number);
  return {
    from: body.from || {}, sentBy: body.sentBy || {}, createdAt: body.createdAt, scope: body.scope, legacy: !!body.legacy, agents, tours, counts,
    label: countsLabel(counts.byType || {}, { media: rx.media?.size || 0 }), journal: counts.journal || 0, received, sameNumber,
    trusted: session.unlocked ? senderTrusted(body) : true, otherPassword: !!rx.otherPassword
  };
}

/**
 * Réception : fusion des données du fichier avec celles de la tablette (setup : mise en service, tout est accepté).
 * Retourne le compte rendu { added, updated, same, ignored, merged, conflicts, held, tours, agents, media, journal… }.
 */
export async function receiveExchange(rx, { setup = false } = {}) {
  const { body, media } = rx;
  await store.flush();
  const trusted = setup || senderTrusted(body);
  const deviceId = session.device.id, at = nowISO();
  const origin = `Fichier de ${body.from?.name || 'l’autre tablette'} (${fmtDateTime(body.createdAt)})`;
  const report = {
    fileId: body.id, fileName: rx.fileName || '', at, from: body.from || {}, sentBy: body.sentBy || {}, trusted, legacy: !!body.legacy,
    added: {}, updated: {}, same: 0, ignored: 0, merged: 0, conflicts: 0, held: [], media: 0, journal: 0,
    tours: { added: [], updated: [] }, agents: { added: [], updated: [] }
  };
  const k = await getKeyring();
  const enrolled = new Map(Object.entries(k.users).map(([username, e]) => [e.userId, username]));
  // Administrateurs actifs de la tablette : le dernier n'est jamais retiré par un fichier.
  const admins = new Set([...enrolled.keys()].filter(id => { const u = store.get('user', id), e = k.users[enrolled.get(id)]; return u && u.role === 'admin' && u.active !== false && !e?.disabled; }));
  const writes = [], lazy = [], conflicts = [], holds = [];
  for (const [type, list] of Object.entries(body.entities || {})) {
    if (!shared(type) || !Array.isArray(list)) continue;
    const valid = list.filter(e => e && typeof e === 'object' && e.id);
    if (type === 'trail') {
      for (const t of valid) if (!store.getRaw('trail', t.id)) { writes.push({ type, data: exchanged(t) }); report.journal++; }
      continue;
    }
    const keys = valid.filter(e => store.getRaw(type, e.id)).map(e => `${type}:${e.id}`);
    const bases = keys.length ? await store.getLazyMany(BASE, keys) : new Map();
    for (const received of valid) {
      // Grille par défaut envoyée par une tablette pas encore mise à niveau (turbidité en FNU, version antérieure) :
      // lue d'après la version livrée avec l'application avant toute comparaison (ni conflit, ni retour en arrière).
      const remote = type === 'grid' ? upToDateGrid(received) : received;
      const local = store.getRaw(type, remote.id), key = `${type}:${remote.id}`;
      const cands = bases.get(key)?.cands || [];
      const plan = planEntity(type, local, remote, { candidates: cands, deviceId });
      if (plan.action === 'known') { report.ignored++; continue; }
      let result = plan.result, outbox = plan.outbox;
      if (type === 'user' && result) {
        const g = guardProfile(local, result, { trusted, lastAdmin: admins.size <= 1 && admins.has(remote.id) });
        if (g.held.length) { result = g.result; holds.push({ local, remote, held: g.held }); if (outbox === 'clear') outbox = 'keep'; }
      }
      if (result || outbox !== 'keep') writes.push({ type, id: remote.id, data: result, outbox });
      if (!IMMUTABLE_TYPES.has(type)) lazy.push({ type: BASE, id: key, data: { cands: nextCandidates(cands, remote, { dir: 'reçue', at }) } });
      if (plan.conflicts?.length) conflicts.push({ type, local, remote, details: plan.conflicts });
      if (plan.action === 'same') { report.same++; continue; }
      const bucket = plan.action === 'add' ? report.added : report.updated;
      bucket[type] = (bucket[type] || 0) + 1;
      if (plan.action === 'merge' || plan.action === 'signed') report.merged++;
      if (type === 'audit') (plan.action === 'add' ? report.tours.added : report.tours.updated).push(remote.number || remote.id);
      if (type === 'user' && !remote._deleted) (plan.action === 'add' ? report.agents.added : report.agents.updated).push({ id: remote.id, name: remote.name, onTablet: enrolled.has(remote.id) });
    }
  }
  // Une transaction : données, journal d'audit, file d'envoi, versions communes.
  await store.applyExchange(writes, { lazy });
  // Photos et documents (contenu vérifié par son empreinte à l'ouverture du fichier), chiffrés avec la clé de la tablette.
  for (const [id, bytes] of media || []) {
    if (await hasLocalBytes(id)) continue;
    await storeRemoteBytes(id, bytes); report.media++;
  }
  // Conflits : rapport consultable et restaurable (Échanges entre tablettes › Conflits).
  for (const c of conflicts) {
    await store.put('conflict', { entityType: c.type, entityId: c.remote.id, at, label: c.remote.number || c.remote.ref || c.remote.name || c.local?.number || c.remote.id, details: c.details, resolved: false, localVersion: c.local, remoteVersion: c.remote, origin });
    report.conflicts++;
  }
  // Changements de profils en attente de validation (un seul en attente par agent : le plus récent).
  for (const h of holds) {
    const id = 'held:' + h.remote.id;
    const item = { id, userId: h.remote.id, name: h.remote.name || h.local?.name || '', changes: h.held, from: body.from || {}, sentBy: body.sentBy || {}, fileName: rx.fileName || '', receivedAt: at, status: 'pending' };
    await store.put('heldChange', item);
    report.held.push({ userId: item.userId, name: item.name, labels: h.held.map(x => heldLabel(x, ROLES)) });
  }
  // Trousseau : nom, initiales et profil affichés suivent le profil retenu (jamais les mots de passe).
  for (const w of writes) {
    if (w.type !== 'user' || !w.data || !enrolled.has(w.data.id)) continue;
    await syncKeyringProfile({ ...w.data, username: enrolled.get(w.data.id), initials: w.data.initials || null });
    if (session.user?.id === w.data.id) Object.assign(session.user, { name: w.data.name, role: w.data.role });
  }
  if (!body.legacy) await rememberDevices(body);
  const seen = (await meta.get('xch:received', [])).filter(r => r.id !== body.id);
  await meta.set('xch:received', [...seen, { id: body.id, at, fileName: rx.fileName || '', from: body.from?.name || '' }].slice(-50));
  const summary = receiveSummary(report);
  await store.put('exchangeLog', { id: uuid(), at, dir: 'réception', fileName: rx.fileName || '', fileId: body.id, scope: body.scope, agent: session.user?.name || '', device: body.from || {}, sentBy: body.sentBy?.name || '', label: summary, counts: body.counts || null, legacy: !!body.legacy });
  await store.log('exchange-receive', { entityLabel: rx.fileName || 'fichier d’échange', details: { origine: `${body.from?.name || '?'} — ${body.sentBy?.name || '?'} (${fmtDateTime(body.createdAt)})`, resultat: summary, empreinte: body.sha256 || null } });
  refreshExchangeState().catch(() => {});
  return report;
}

const nb = (n, one, many) => `${n} ${n > 1 ? many : one}`;
/** Compte rendu en une phrase (« 3 tournées mises à jour, 1 nouvel agent… »). */
export function receiveSummary(r) {
  const added = Object.values(r.added).reduce((s, n) => s + n, 0), updated = Object.values(r.updated).reduce((s, n) => s + n, 0);
  const parts = [];
  if (r.tours.added.length) parts.push(nb(r.tours.added.length, 'nouvelle tournée', 'nouvelles tournées'));
  if (r.tours.updated.length) parts.push(nb(r.tours.updated.length, 'tournée mise à jour', 'tournées mises à jour'));
  if (r.agents.added.length) parts.push(nb(r.agents.added.length, 'nouvel agent', 'nouveaux agents'));
  const otherAdded = added - r.tours.added.length - r.agents.added.length, otherUpdated = updated - r.tours.updated.length - r.agents.updated.length;
  if (otherAdded > 0) parts.push(nb(otherAdded, 'autre élément ajouté', 'autres éléments ajoutés'));
  if (otherUpdated + r.agents.updated.length > 0) parts.push(nb(otherUpdated + r.agents.updated.length, 'autre élément mis à jour', 'autres éléments mis à jour'));
  if (r.media) parts.push(nb(r.media, 'photo ou document', 'photos ou documents'));
  if (r.conflicts) parts.push(nb(r.conflicts, 'conflit à examiner', 'conflits à examiner'));
  if (r.held.length) parts.push(nb(r.held.length, 'changement de profil en attente', 'changements de profils en attente'));
  if (!parts.length) parts.push('aucun changement (données déjà à jour)');
  return parts.join(', ');
}

/* ---------- Changements de profils en attente de validation ---------- */
export function heldChanges() { return sortBy(store.filter('heldChange', h => h.status === 'pending'), '-receivedAt'); }
/** Accepte un changement de profil reçu (administrateur ; jamais le dernier administrateur de la tablette). */
export async function acceptHeld(id) {
  if (!can('users.manage')) throw new Error('Seul un administrateur peut valider un changement de profil.');
  const h = store.get('heldChange', id), u = h && store.getRaw('user', h.userId);
  if (!h || !u) throw new Error('Changement ou profil introuvable.');
  const next = { ...u };
  for (const c of h.changes) {
    if (c.field === 'role') next.role = c.to;
    else if (c.field === 'active') next.active = !!c.to;
    else if (c.to) Object.assign(next, { _deleted: true, deletedAt: nowISO(), deletedBy: session.user.id });
    else { delete next._deleted; delete next.deletedAt; delete next.deletedBy; delete next.deleteReason; }
  }
  if (!u._deleted) await assertAdminRemains(u.id, { role: next.role, active: next.active !== false && !next._deleted });
  await store.put('user', next, { reason: `Changement reçu de ${h.from?.name || 'l’autre tablette'} (envoyé par ${h.sentBy?.name || '?'}) validé : ${h.changes.map(x => heldLabel(x, ROLES)).join(' ; ')}` });
  const k = await getKeyring();
  const username = Object.keys(k.users).find(n => k.users[n].userId === u.id);
  if (username) await syncKeyringProfile({ ...next, username, active: next.active !== false && !next._deleted, initials: next.initials || null });
  if (session.user?.id === u.id) session.user.role = next.role;
  await store.put('heldChange', { ...h, status: 'accepted', decidedAt: nowISO(), decidedBy: session.user.name });
}
/** Refuse un changement de profil reçu : le profil garde sa valeur sur cette tablette. */
export async function refuseHeld(id) {
  if (!can('users.manage')) throw new Error('Seul un administrateur peut refuser un changement de profil.');
  const h = store.get('heldChange', id);
  if (!h) throw new Error('Changement introuvable.');
  await store.put('heldChange', { ...h, status: 'refused', decidedAt: nowISO(), decidedBy: session.user.name });
  await store.log('exchange-hold-refuse', { entityType: 'user', entityId: h.userId, entityLabel: h.name, reason: `Changement reçu de ${h.from?.name || 'l’autre tablette'} refusé : ${h.changes.map(x => heldLabel(x, ROLES)).join(' ; ')}` });
}

/* ---------- Historique ---------- */
export function exchangeHistory(limit = 30) { return sortBy(store.all('exchangeLog'), '-at').slice(0, limit); }

/* ---------- Mise en service d'une tablette supplémentaire ---------- */
/** « Qui êtes-vous ? » : agents actifs parmi les profils reçus, administrateurs d'abord. */
export function setupProfiles(rx) {
  return sortBy((rx?.body?.entities?.user || []).filter(u => u && !u._deleted && u.active !== false && u.username), u => u.role === 'admin' ? 0 : 1, 'name');
}
/**
 * Tablette supplémentaire : nom et n° de la tablette, agent (profil reçu, même identifiant) et son mot de passe sur
 * cette tablette ; le mot de passe d'échange est celui qui a ouvert le fichier ; toutes les données du fichier sont
 * reçues. Retourne le compte rendu de réception.
 */
export async function setupFromExchange(rx, { deviceName, deviceNumber, profileId, password }) {
  if (rx.legacy) throw new Error('Choisissez le fichier d’échange envoyé par l’autre tablette (OEG-echange_….oegct).');
  const profile = setupProfiles(rx).find(u => u.id === profileId);
  if (!profile) throw new Error('Touchez d’abord votre nom (« Qui êtes-vous ? »).');
  await setupFromProfile({ deviceName, deviceNumber, profile, password });
  await setExchangePassword(rx.password, { reason: 'Mise en service : mot de passe d’échange de l’équipe', setup: true });
  const report = await receiveExchange(rx, { setup: true });
  await store.log('setup', { entityLabel: session.device.name, details: { mode: 'autonome', miseEnService: 'tablette supplémentaire', fichier: rx.fileName || '', tabletteOrigine: rx.body.from?.name || '', device: session.device } });
  return report;
}
