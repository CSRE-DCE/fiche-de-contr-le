/* Synchronisation d'équipe par un dépôt GitHub PRIVÉ de données (API REST GitHub, sans serveur).
 *
 *  1. RÉCEPTION différentielle : la tête de la branche est comparée à celle de la dernière synchronisation ;
 *     seuls les dossiers dont l'empreinte d'arbre a changé sont parcourus et seuls les fichiers dont
 *     l'empreinte (sha git, mémorisée localement) a changé sont téléchargés.
 *  2. CONFLITS : une donnée modifiée sur l'appareil ET dans le dépôt depuis la dernière version commune
 *     (syncBase) est fusionnée à trois versions (js/domain/merge.js), champ par champ ; les valeurs en
 *     concurrence sont conservées dans une entité « conflict » consultable et restaurable.
 *  3. ENVOI atomique : toutes les modifications locales en attente (file « outbox ») forment UN commit
 *     (entites/<type>/<id>.json, journal/…, medias/<id>, config/…) posé sur la tête relue ; la branche est
 *     avancée SANS forçage. Si un autre appareil a écrit entre-temps (refus « non fast-forward »), on relit,
 *     on fusionne et on recommence : rien n'est écrasé.
 *  4. NUMÉROS d'audit réservés par blocs dans config/sequences.json (dans le même commit) ; APPAREILS
 *     enregistrés dans config/appareils.json (n° unique) — un appareil révoqué est effacé à sa synchronisation
 *     suivante (callback revoked) ; RÔLES lus dans config/utilisateurs.json (login GitHub du compte, à
 *     défaut rôle local).
 *  5. JOURNAL : chaque synchronisation est tracée (date, origine, volumes, commit, conflits, erreurs).
 *  6. SÉCURITÉ : les droits sont appliqués par l'application ; la vraie frontière de sécurité est l'accès au
 *     dépôt privé (quiconque possède un jeton donnant accès au dépôt peut en lire et modifier les fichiers).
 */
import { idb, meta } from '../core/db.js';
import { store, LOCAL_ONLY, META_FIELDS } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { decryptBytes } from '../core/crypto.js';
import { ROLES, can, isTeamMode, teamLabel, getKeyring, syncKeyringProfile, normUsername, updateDevice, attachTeam, detachTeam, saveTeamToken, linkGithubLogin } from '../core/auth.js';
import { setRemoteFetcher, storeRemoteBytes } from '../core/media.js';
import { mergeEntity, stripMeta } from '../domain/merge.js';
import { availableNumbers, addBlock, BLOCK_SIZE, BLOCK_LOW } from './numbering.js';
import {
  createGitHub, teamSettings, dataPaths, parseDataPath, stableJSON, gitBlobSha, utf8, fromUtf8, mapLimit, trailDay,
  DATA_DIRS, DATA_FORMAT, CONFIG_FILES, MAX_BLOB_BYTES
} from './github.js';
import { uuid, nowISO, deepEqual, sleep, clone } from '../core/util.js';

const MAX_ATTEMPTS = 6;              // nouvelles tentatives après un refus « non fast-forward »
const PULL_CONCURRENCY = 8;          // téléchargements simultanés
const MEDIA_PER_SYNC = 30, MEDIA_BYTES_PER_SYNC = 60 * 1024 * 1024;
const POLL_MS = 5 * 60000;           // réception périodique des modifications des autres appareils
const JOURNAL_DAYS = 120;            // journal des autres appareils reçu automatiquement (plus ancien : réception complète)
// Événements qui ne déclenchent pas d'envoi : éléments locaux, et '*' (ouverture de session, données reçues).
const NO_TRIGGER = new Set(['syncLog', 'conflict', 'syncBase', 'localSecret', '*']);
const listeners = new Set();
export const syncState = { running: false, lastSyncAt: null, lastError: null, pending: 0, online: navigator.onLine, needsLogin: false, lastResult: null, initialized: null, progress: '' };
let onRevoked = () => {}, onDisabled = () => {};
let timer = null, debounceTimer = null, unsubscribe = null, windowBound = false, lastRunAt = 0;
let current = null, queued = null;

export function onSyncState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn({ ...syncState }); } catch (e) { console.error(e); } } }
function progress(text) { syncState.progress = text; emit(); }

export async function refreshPending() {
  const keys = await idb.keys('outbox').catch(() => []);
  syncState.pending = keys.length;
  syncState.online = navigator.onLine;
  emit();
  return keys.length;
}

/* ---------- Contexte : client, chemins, mémoire locale des empreintes ---------- */

export { isTeamMode };
const team = () => session.team;
const client = (t = team(), token = session.token) => createGitHub({ token, owner: t.owner, repo: t.repo, apiUrl: t.apiUrl });
const paths = (t = team()) => dataPaths(t.prefix);
const cacheKey = (t = team()) => t ? `${t.apiUrl}|${t.owner}/${t.repo}|${t.branch}|${t.prefix}` : '';
/** Empreintes connues : { key, head (dernier commit reçu), dirs: {chemin/: sha d'arbre}, files: {chemin: sha de blob} }. */
async function loadCache() { const c = await meta.get('gh:cache', null); return c && c.key === cacheKey() ? c : { key: cacheKey(), head: null, dirs: {}, files: {} }; }
const saveCache = c => meta.set('gh:cache', c);
/** Dernière lecture des fichiers config/ du dépôt : { key, equipe, utilisateurs, appareils, sequences, head, readAt }. */
async function loadConfig() { const c = await meta.get('gh:config', null); return c && c.key === cacheKey() ? c : { key: cacheKey(), equipe: null, utilisateurs: null, appareils: null, sequences: null, head: null, readAt: null }; }
const saveConfig = c => meta.set('gh:config', c);
/** Oublie les empreintes mémorisées (changement de dépôt, réception complète, détachement). */
export async function resetSyncCache() { await meta.del('gh:cache'); await meta.del('gh:config'); }

function withoutSyncMeta(e) { const { _rev, _lv, ...rest } = e; return rest; }
const content = e => { const out = {}; for (const [k, v] of Object.entries(e || {})) if (!META_FIELDS.includes(k)) out[k] = v; return out; };
const configKey = name => name.replace(/\.json$/, '');

function teamError(message, code) { const e = new Error(message); e.code = code; return e; }
function notInitialized(head) {
  if (head?.empty) return teamError('Le dépôt de données est vide : un administrateur doit l’initialiser (Synchronisation › Initialiser le dépôt).', 'not-initialized');
  if (head === null) return teamError(`Branche « ${team()?.branch} » introuvable dans le dépôt : un administrateur doit initialiser le dépôt.`, 'not-initialized');
  return teamError('Dépôt de données non initialisé (config/equipe.json absent) : un administrateur doit l’initialiser (Synchronisation › Initialiser le dépôt).', 'not-initialized');
}

/** Lit les fichiers config/ à partir de l'arbre racine d'un commit. */
async function readConfigFiles(gh, treeSha, P) {
  const out = { equipe: null, utilisateurs: null, appareils: null, sequences: null, shas: {} };
  const dir = await gh.lookup(treeSha, P.prefix + 'config');
  if (!dir || dir.type !== 'tree') return out;
  const t = await gh.getTree(dir.sha);
  await mapLimit((t.tree || []).filter(e => e.type === 'blob' && CONFIG_FILES.includes(e.path)), 4, async e => {
    try { out[configKey(e.path)] = JSON.parse(fromUtf8(await gh.getBlob(e.sha))); out.shas[configKey(e.path)] = e.sha; }
    catch (err) { if (!(err instanceof SyntaxError)) throw err; }
  });
  return out;
}

/* ---------- Démarrage, déclencheurs ---------- */

export function initSync({ revoked, disabled } = {}) {
  onRevoked = revoked || onRevoked;
  onDisabled = disabled || onDisabled;
  setRemoteFetcher(async id => { try { return await fetchMediaBytes(id); } catch (e) { return null; } });
  if (!windowBound) {
    windowBound = true;
    window.addEventListener('online', () => { syncState.online = true; emit(); scheduleSync(1000); });
    window.addEventListener('offline', () => { syncState.online = false; emit(); });
  }
  unsubscribe?.();
  unsubscribe = store.subscribe(type => { if (!NO_TRIGGER.has(type)) { refreshPending(); scheduleSync(8000); } });
  clearInterval(timer);
  timer = setInterval(() => {
    if (!isTeamMode() || !session.unlocked || !navigator.onLine) return;
    const visible = globalThis.document?.visibilityState !== 'hidden';
    if (syncState.pending || (visible && Date.now() - lastRunAt > POLL_MS)) scheduleSync(0);
  }, 60000);
  syncState.lastSyncAt = null;
  meta.get('lastSyncAt', null).then(v => { syncState.lastSyncAt = v; emit(); }).catch(() => {});
  refreshPending();
}
export function stopSync() { clearInterval(timer); clearTimeout(debounceTimer); unsubscribe?.(); unsubscribe = null; }

export function scheduleSync(delay = 5000) {
  if (!isTeamMode()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync({ reason: 'automatique' }).catch(() => {}), delay);
}

/**
 * Synchronisation complète (réception, fusion, envoi). Retourne le journal de la synchronisation
 * { pushed, pulled, journal, media, merged, conflicts, commit, errors… } ou { skipped: motif }.
 * Un appel pendant une synchronisation en cours attend sa fin puis synchronise à nouveau.
 */
export function runSync(opts = {}) {
  if (current) {
    if (!queued) queued = current.catch(() => {}).then(() => { queued = null; return runSync(opts); });
    return queued;
  }
  current = doSync(opts).finally(() => { current = null; });
  return current;
}

async function doSync({ reason = 'manuelle', full = false } = {}) {
  if (!isTeamMode() || !team()) return { skipped: 'mode autonome' };
  if (!session.unlocked) return { skipped: 'session fermée' };
  if (!navigator.onLine) { syncState.online = false; emit(); return { skipped: 'hors connexion' }; }
  if (!session.token) { syncState.needsLogin = true; emit(); return { skipped: 'jeton GitHub requis' }; }
  syncState.running = true; syncState.lastError = null; syncState.progress = ''; emit();
  lastRunAt = Date.now();
  const log = { id: uuid(), at: nowISO(), reason, pushed: 0, pulled: 0, journal: 0, media: 0, merged: 0, conflicts: 0, rejected: 0, attempts: 0, commit: null, head: null, errors: [], durationMs: 0, user: session.user?.name, repo: teamLabel() };
  const t0 = Date.now();
  const ctx = { gh: client(), P: paths(), log, cache: null, config: null, revoked: false, disabled: false, uploaded: new Map() };
  try {
    await store.flush();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      log.attempts = attempt;
      const head = await ctx.gh.head(team().branch);
      if (!head || head.empty) throw notInitialized(head);
      await pull(ctx, head, { full: full && attempt === 1 });
      log.head = head.sha;
      if (ctx.revoked || ctx.disabled) break;
      if (!session.unlocked) throw teamError('Session verrouillée pendant la synchronisation.', 'locked');
      await store.flush();
      const plan = await buildPush(ctx);
      if (!plan) break;
      if (!plan.files.length) { await afterPush(ctx, plan, null); break; }
      progress(`Envoi de ${plan.files.length} fichier(s)…`);
      let res;
      try { res = await ctx.gh.commitFiles({ branch: team().branch, parentSha: head.sha, baseTreeSha: head.treeSha, files: plan.files, message: plan.message }); }
      catch (e) {
        if (e.code === 'conflict' && attempt < MAX_ATTEMPTS) { await sleep(200 * attempt + Math.floor(Math.random() * 300)); continue; }
        throw e;
      }
      await afterPush(ctx, plan, res);
      if (plan.more) scheduleSync(1500);   // médias restants : synchronisation suivante
      break;
    }
    syncState.lastSyncAt = nowISO(); syncState.needsLogin = false; syncState.initialized = true;
    await meta.set('lastSyncAt', syncState.lastSyncAt);
  } catch (e) {
    if (e.code === 'auth') syncState.needsLogin = true;
    if (e.code === 'not-initialized') syncState.initialized = false;
    log.errors.push(e.message || String(e));
    syncState.lastError = log.errors[log.errors.length - 1] || null;
  } finally {
    log.durationMs = Date.now() - t0;
    syncState.running = false; syncState.progress = '';
    syncState.lastResult = log;
    if (!ctx.revoked && session.unlocked) { await store.put('syncLog', log).catch(() => {}); await refreshPending(); }
  }
  if (ctx.revoked) { stopSync(); emit(); await onRevoked(); return { ...log, revoked: true }; }
  emit();
  if (ctx.disabled) { await onDisabled(); return { ...log, disabled: true }; }
  return log;
}

/* ---------- Réception ---------- */

async function walk(gh, sha, dir, cache, changed, dirs) {
  if (cache.dirs[dir] === sha) return;
  const t = await gh.getTree(sha);
  const subs = [];
  for (const e of t.tree || []) {
    if (e.type === 'tree') subs.push(e);
    else if (e.type === 'blob' && cache.files[dir + e.path] !== e.sha) changed.push({ path: dir + e.path, sha: e.sha, size: e.size });
  }
  await mapLimit(subs, 4, e => walk(gh, e.sha, dir + e.path + '/', cache, changed, dirs));
  dirs[dir] = sha;
}

async function pull(ctx, head, { full = false } = {}) {
  const { gh, P, log } = ctx;
  const cache = ctx.cache = full ? { key: cacheKey(), head: null, dirs: {}, files: {} } : await loadCache();
  const config = ctx.config = await loadConfig();
  if (!config.equipe) {   // configuration jamais lue : relire config/ même si les empreintes sont connues
    for (const n of CONFIG_FILES) delete cache.files[P.config(n)];
    delete cache.dirs[P.prefix]; delete cache.dirs[P.prefix + 'config/'];
  }
  if (cache.head !== head.sha || !config.equipe) {
    progress('Lecture du dépôt…');
    const root = P.prefix ? await gh.lookup(head.treeSha, P.prefix.replace(/\/$/, '')) : { sha: head.treeSha, type: 'tree' };
    if (!root || root.type !== 'tree') throw notInitialized();
    const changed = [], dirs = {}, done = {};
    if (cache.dirs[P.prefix] !== root.sha) {
      const t = await gh.getTree(root.sha);
      await mapLimit((t.tree || []).filter(e => e.type === 'tree' && DATA_DIRS.includes(e.path)), 4, e => walk(gh, e.sha, P.prefix + e.path + '/', cache, changed, dirs));
      dirs[P.prefix] = root.sha;
    }
    const items = changed.map(f => ({ ...f, info: parseDataPath(P.prefix, f.path) })).filter(f => f.info);

    // 1. Configuration de l'équipe (révocation, rôles, numéros)
    for (const f of items.filter(f => f.info.kind === 'config')) {
      if (CONFIG_FILES.includes(f.info.name)) {
        try { config[configKey(f.info.name)] = JSON.parse(fromUtf8(await gh.getBlob(f.sha))); }
        catch (e) { if (!(e instanceof SyntaxError)) throw e; log.errors.push(`Fichier de configuration illisible : ${f.path}`); }
      }
      done[f.path] = f.sha;
    }
    if (!config.equipe) throw notInitialized();
    config.head = head.sha; config.readAt = nowISO();
    if (isRevoked(config)) { ctx.revoked = true; return; }

    // 2. Entités (seuls les fichiers dont l'empreinte diffère de la version locale sont téléchargés)
    const pendingByKey = new Map((await idb.entries('outbox')).map(([k, v]) => [k, v]));
    const toFetch = [];
    for (const f of items.filter(f => f.info.kind === 'entity')) {
      if (LOCAL_ONLY.has(f.info.type)) { done[f.path] = f.sha; continue; }
      const local = store.getRaw(f.info.type, f.info.id);
      if (local && local._rev === f.sha) { done[f.path] = f.sha; continue; }
      toFetch.push(f);
    }
    for (let i = 0; i < toFetch.length; i += 200) {
      if (!session.unlocked) throw teamError('Session verrouillée pendant la synchronisation.', 'locked');
      progress(`Réception : ${Math.min(i + 200, toFetch.length)} / ${toFetch.length}`);
      const fetched = await mapLimit(toFetch.slice(i, i + 200), PULL_CONCURRENCY, async f => {
        try { return { f, data: JSON.parse(fromUtf8(await gh.getBlob(f.sha))) }; }
        catch (e) { if (e instanceof SyntaxError) { log.errors.push(`Fichier illisible ignoré : ${f.path}`); return { f, data: null }; } throw e; }
      });
      const direct = [];
      for (const { f, data } of fetched) {
        done[f.path] = f.sha;
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        const type = f.info.type, id = data.id || f.info.id;
        const remote = { ...data, id, _rev: f.sha };
        const local = store.getRaw(type, id);
        const pending = pendingByKey.get(`${type}:${id}`);
        if (pending && local && !pending.rejected) await resolveConflict(type, id, remote, log);
        else direct.push({ type, data: remote });
        if (type === 'user' && data.username) {
          const k = await getKeyring();
          if (k.users[normUsername(data.username)]?.userId === id) await syncKeyringProfile(data);
        }
        log.pulled++;
      }
      if (direct.length) await store.applyRemoteMany(direct);
    }

    // 3. Journal d'audit (entrées immuables : seules les entrées absentes sont ajoutées). Les jours anciens ne
    //    sont téléchargés que par une réception complète (un appareil qui rejoint l'équipe ne relit pas des
    //    années de journal : une requête par appareil et par jour).
    const cutoff = full ? '' : new Date(Date.now() - JOURNAL_DAYS * 86400000).toISOString().slice(0, 10);
    for (const f of items.filter(f => f.info.kind === 'journal' && f.info.day < cutoff)) done[f.path] = f.sha;
    const journals = items.filter(f => f.info.kind === 'journal' && f.info.day >= cutoff);
    await mapLimit(journals, PULL_CONCURRENCY, async f => {
      let doc = null;
      try { doc = JSON.parse(fromUtf8(await gh.getBlob(f.sha))); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
      const entries = (Array.isArray(doc) ? doc : doc?.entries || []).filter(e => e && e.id && !store.getRaw('trail', e.id));
      if (entries.length) { await store.applyRemoteMany(entries.map(data => ({ type: 'trail', data })), { withBase: false }); log.journal += entries.length; }
      done[f.path] = f.sha;
    });

    // 4. Médias : empreintes mémorisées, contenu téléchargé à la demande (ou « pour le terrain »)
    for (const f of items.filter(f => f.info.kind === 'media')) done[f.path] = f.sha;
    for (const f of items.filter(f => !['config', 'entity', 'journal', 'media'].includes(f.info.kind))) done[f.path] = f.sha;

    Object.assign(cache.files, done); Object.assign(cache.dirs, dirs);
    cache.head = head.sha;
    await store.flush();
    await saveCache(cache); await saveConfig(config);
  } else if (isRevoked(config)) { ctx.revoked = true; return; }
  syncState.initialized = true;
  await applyTeamRoles(ctx);
}

const isRevoked = config => !!(config.appareils?.devices || []).find(d => d.id === session.device?.id && d.revoked);

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
/**
 * Version commune présumée quand aucune base n'est connue (même donnée créée des deux côtés, ex. référentiel
 * initial d'un appareil autonome rattaché à l'équipe) : ce qui est identique des deux côtés, préfixe commun
 * des listes (un ajout en fin de liste n'est pas un conflit), métadonnées de création reçues retenues.
 * Une valeur différente des deux côtés reste un conflit tracé.
 */
export function presumedBase(local, remote) {
  const walk = (l, r) => {
    if (deepEqual(l, r)) return clone(l);
    if (Array.isArray(l) && Array.isArray(r)) { const out = []; for (let i = 0; i < Math.min(l.length, r.length) && deepEqual(l[i], r[i]); i++) out.push(clone(l[i])); return out; }
    if (isObj(l) && isObj(r)) { const out = {}; for (const k of Object.keys(l)) if (k in r) { const b = walk(l[k], r[k]); if (b !== undefined) out[k] = b; } return out; }
    return undefined;
  };
  const base = walk(local, remote) || {};
  for (const k of ['createdAt', 'createdBy', 'createdByName']) if (local?.[k] !== undefined) base[k] = local[k];
  return base;
}

/** Fusion à trois versions et rapport de conflit. */
async function resolveConflict(type, id, remote, log) {
  const local = store.getRaw(type, id);
  // Contenu identique (même donnée créée ou modifiée de la même façon des deux côtés) : rien à fusionner.
  if (deepEqual(content(local), content(remote))) { await store.applyRemoteMany([{ type, data: remote }]); return; }
  const base = store.getBase(type, id) || presumedBase(local, remote);
  const { merged, conflicts } = mergeEntity(type, base, local, remote);
  const needsPush = !deepEqual(stripMeta(merged), stripMeta(remote));
  log.merged = (log.merged || 0) + 1;
  await store.applyMerged(type, merged, { needsPush, baseRev: remote._rev || 0 });
  await store.setBase(type, remote);
  if (conflicts.length) {
    log.conflicts++;
    await store.put('conflict', {
      id: uuid(), entityType: type, entityId: id, at: nowISO(), label: local?.number || local?.ref || local?.name || id,
      details: conflicts.map(c => ({ ...c, localValue: c.localValue, remoteValue: c.remoteValue })), resolved: false,
      localVersion: local, remoteVersion: remote, origin: 'Synchronisation d’équipe (dépôt GitHub)'
    });
  }
}

/** Rôles de config/utilisateurs.json appliqués aux comptes locaux rattachés à un login GitHub. */
async function applyTeamRoles(ctx) {
  const list = ctx.config?.utilisateurs?.users;
  if (!Array.isArray(list)) return;
  const byLogin = new Map(list.filter(u => u && u.login).map(u => [String(u.login).toLowerCase(), u]));
  const k = await getKeyring();
  for (const [username, e] of Object.entries(k.users)) {
    const ent = store.get('user', e.userId);
    const login = String(ent?.githubLogin || e.githubLogin || '').toLowerCase();
    const m = login ? byLogin.get(login) : null;
    if (!m || !ROLES[m.role]) continue;
    const active = m.active !== false;
    if (ent && (ent.role !== m.role || (ent.active !== false) !== active)) {
      await store.put('user', { ...ent, role: m.role, active }, { reason: `Rôle défini par l’équipe (config/utilisateurs.json : ${m.login})` });
    }
    if (e.role !== m.role || !!e.disabled !== !active) await syncKeyringProfile({ username, name: ent?.name || e.name, role: m.role, active });
    if (session.user?.id === e.userId) {
      if (session.user.role !== m.role) { session.user.role = m.role; ctx.log.roleChanged = m.role; }
      if (!active) ctx.disabled = true;
    }
  }
}

/* ---------- Envoi ---------- */

/** Prépare le commit : fichiers à écrire et opérations locales à faire après succès. null = rien à faire. */
async function buildPush(ctx) {
  const { P, cache, config, log } = ctx;
  const outbox = (await idb.entries('outbox')).map(([key, v]) => ({ key, ...v }));
  const plan = { files: [], sent: [], trailKeys: [], journalFiles: [], media: [], drop: [], device: null, block: null, more: false, message: '' };
  const journal = new Set();
  const bins = [];
  for (const e of outbox) {
    if (e.rejected) continue;
    if (e.type === '__bin') { bins.push(e); continue; }
    if (LOCAL_ONLY.has(e.type)) { plan.drop.push(e.key); continue; }
    const data = store.getRaw(e.type, e.id);
    if (!data) { plan.drop.push(e.key); continue; }
    if (e.type === 'trail') { journal.add(P.journalOf(data)); plan.trailKeys.push(e.key); continue; }
    const body = stableJSON(withoutSyncMeta(data));
    const path = P.entity(e.type, e.id), sha = await gitBlobSha(body);
    const unchanged = cache.files[path] === sha;
    if (!unchanged) plan.files.push({ path, content: body });
    plan.sent.push({ key: e.key, type: e.type, id: e.id, lv: data._lv, data: withoutSyncMeta(data), path, sha, unchanged });
  }
  // Journal : un fichier par appareil et par jour, régénéré à partir des entrées locales (déjà fusionnées)
  if (journal.size) {
    const groups = new Map([...journal].map(p => [p, []]));
    for (const t of store.all('trail', { withDeleted: true })) { const g = groups.get(P.journalOf(t)); if (g) g.push(withoutSyncMeta(t)); }
    for (const [path, list] of groups) {
      if (!list.length) continue;
      list.sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.at).localeCompare(String(b.at)));
      const body = stableJSON({ format: DATA_FORMAT, kind: 'journal', deviceId: list[0].deviceId || null, deviceName: list[list.length - 1].deviceName || null, day: trailDay(list[0]), entries: list });
      const sha = await gitBlobSha(body);
      if (cache.files[path] !== sha) plan.files.push({ path, content: body });
      plan.journalFiles.push({ path, sha });
    }
  }
  // Médias : octets bruts (blob base64), envoyés avant le commit ; volume borné par synchronisation
  let mediaBytes = 0;
  for (const b of bins) {
    if (plan.media.length >= MEDIA_PER_SYNC || mediaBytes >= MEDIA_BYTES_PER_SYNC) { plan.more = true; break; }
    const path = P.media(b.id);
    const rec = await idb.get('media', b.id);
    if (!rec || !store.getRaw('media', b.id)) { plan.drop.push(b.key); continue; }
    const bytes = await decryptBytes(session.dek, rec.iv, rec.ct);
    if (bytes.length > MAX_BLOB_BYTES) {
      const { key, ...v } = b;
      await idb.put('outbox', key, { ...v, rejected: true, error: 'Fichier trop volumineux pour le dépôt GitHub (100 Mo au plus).' });
      log.rejected++; continue;
    }
    const sha = await gitBlobSha(bytes);
    const unchanged = cache.files[path] === sha;
    if (!unchanged) {
      if (!ctx.uploaded.has(sha)) { const r = await ctx.gh.createBlob(bytes); ctx.uploaded.set(sha, r.sha); }
      plan.files.push({ path, uploadedSha: ctx.uploaded.get(sha) });
      mediaBytes += bytes.length;
    }
    plan.media.push({ key: b.key, path, sha, unchanged });
  }
  // Enregistrement de l'appareil (n° unique dans l'équipe)
  const devices = Array.isArray(config.appareils?.devices) ? config.appareils.devices : [];
  const me = devices.find(d => d.id === session.device.id);
  if (!me || me.name !== session.device.name) {
    const used = new Set(devices.filter(d => d.id !== session.device.id).map(d => Number(d.no)));
    let no = Number(me?.no || session.device.number) || 1;
    if (used.has(no) || no < 1 || no > 99) { no = 1; while (used.has(no) && no < 99) no++; }
    const entry = { ...(me || {}), id: session.device.id, no, name: session.device.name, registeredAt: me?.registeredAt || nowISO(), registeredBy: me?.registeredBy || session.githubLogin || session.user.name, revoked: !!me?.revoked };
    const next = { ...(config.appareils || {}), devices: [...devices.filter(d => d.id !== entry.id), entry].sort((a, b) => Number(a.no) - Number(b.no)) };
    const body = stableJSON(next);
    plan.files.push({ path: P.config('appareils.json'), content: body });
    plan.device = { entry, next, sha: await gitBlobSha(body) };
  }
  // Réservation d'un bloc de numéros d'audit
  const year = new Date().getFullYear();
  if (can('audit.create') && await availableNumbers('AUD', year) < BLOCK_LOW) {
    const seq = { ...(config.sequences || {}) };
    const key = `AUD-${year}`, from = (Number(seq[key]) || 0) + 1, to = from + BLOCK_SIZE - 1;
    seq[key] = to;
    const body = stableJSON(seq);
    plan.files.push({ path: P.config('sequences.json'), content: body });
    plan.block = { year, from, to, next: seq, sha: await gitBlobSha(body) };
  }
  if (!plan.files.length && !plan.sent.length && !plan.trailKeys.length && !plan.media.length && !plan.drop.length) return null;
  const counts = {};
  for (const s of plan.sent) if (!s.unchanged) counts[s.type] = (counts[s.type] || 0) + 1;
  const parts = Object.entries(counts).map(([t, n]) => `${n} ${t}`);
  if (plan.trailKeys.length) parts.push(`${plan.trailKeys.length} entrée(s) de journal`);
  if (plan.media.some(m => !m.unchanged)) parts.push(`${plan.media.filter(m => !m.unchanged).length} fichier(s)`);
  if (plan.device) parts.push(me ? 'mise à jour de l’appareil' : 'enregistrement de l’appareil');
  if (plan.block) parts.push(`réservation AUD-${year} ${plan.block.from}–${plan.block.to}`);
  plan.message = `Synchronisation : ${parts.join(', ') || 'mise à jour'}\n\nAppareil : ${session.device.name} (n° ${plan.device?.entry.no || me?.no || session.device.number}, ${session.device.id})\nUtilisateur : ${session.user.name}${session.githubLogin ? ' (@' + session.githubLogin + ')' : ''}\nApplication : ${appVersion()}`;
  return plan;
}

/** Après un commit réussi (ou sans commit si rien ne différait du dépôt) : révisions, bases, file, empreintes. */
async function afterPush(ctx, plan, res) {
  const { cache, config, log, P } = ctx;
  const outboxOps = [];
  for (const s of plan.sent) {
    const cur = store.getRaw(s.type, s.id);
    store.setRev(s.type, s.id, s.sha);
    if (cur && cur._lv === s.lv) outboxOps.push({ store: 'outbox', key: s.key, value: undefined });
    else outboxOps.push({ store: 'outbox', key: s.key, value: { type: s.type, id: s.id, baseRev: s.sha, at: nowISO() } });
    store.setBase(s.type, { ...s.data, _rev: s.sha });
    cache.files[s.path] = s.sha;
    if (!s.unchanged) log.pushed++;
  }
  for (const k of plan.trailKeys) outboxOps.push({ store: 'outbox', key: k, value: undefined });
  log.journal += plan.trailKeys.length;
  for (const j of plan.journalFiles) cache.files[j.path] = j.sha;
  for (const m of plan.media) { outboxOps.push({ store: 'outbox', key: m.key, value: undefined }); cache.files[m.path] = m.sha; if (!m.unchanged) log.media++; }
  for (const k of plan.drop) outboxOps.push({ store: 'outbox', key: k, value: undefined });
  if (res) {
    if (plan.device) {
      config.appareils = plan.device.next; cache.files[P.config('appareils.json')] = plan.device.sha;
      if (Number(session.device.number) !== plan.device.entry.no || !session.device.teamRegisteredAt) await updateDevice({ number: plan.device.entry.no, teamRegisteredAt: plan.device.entry.registeredAt });
    }
    if (plan.block) {
      config.sequences = plan.block.next; cache.files[P.config('sequences.json')] = plan.block.sha;
      await addBlock('AUD', plan.block.year, plan.block.from, plan.block.to);
    }
    // Les dossiers modifiés par ce commit seront relus (empreintes d'arbre devenues inconnues).
    for (const f of plan.files) { const segs = f.path.split('/'); for (let i = 0; i < segs.length; i++) delete cache.dirs[segs.slice(0, i).join('/') + (i ? '/' : '')]; }
    cache.head = res.commitSha; config.head = res.commitSha;
    log.commit = res.commitSha;
  }
  for (let i = 0; i < outboxOps.length; i += 500) await idb.batch(outboxOps.slice(i, i + 500));
  await store.flush();
  await saveCache(cache); await saveConfig(config);
}

/* ---------- Médias ---------- */

async function fetchMediaBytes(id) {
  if (!isTeamMode() || !team() || !session.token || !navigator.onLine) return null;
  const gh = client(), path = paths().media(id);
  const cache = await loadCache();
  let sha = cache.files[path];
  if (!sha) {
    const h = await gh.head(team().branch);
    if (!h?.sha) return null;
    const e = await gh.lookup(h.treeSha, path);
    if (!e || e.type !== 'blob') return null;
    sha = e.sha;
  }
  const bytes = await gh.getBlob(sha);
  return (await gitBlobSha(bytes)) === sha ? bytes : null;
}

/** Télécharge les contenus binaires utiles hors connexion (documents applicables, photos de points). */
export async function prefetchMedia(filter = m => m.kind === 'document' || m.link?.type === 'point' || m.link?.type === 'document' || m.link?.type === 'site') {
  if (!isTeamMode() || !navigator.onLine || !session.token) return 0;
  let n = 0;
  for (const m of store.filter('media', filter)) {
    if (await idb.get('media', m.id)) continue;
    try { const bytes = await fetchMediaBytes(m.id); if (bytes) { await storeRemoteBytes(m.id, bytes); n++; } } catch (e) { /* suivant */ }
    if (n % 10 === 0) await sleep(0);
  }
  return n;
}

/* ---------- File d'envoi ---------- */

/** Abandonne une modification locale refusée. */
export async function dropOutboxEntry(key) { await idb.del('outbox', key); await refreshPending(); }
export async function retryRejected() {
  for (const [key, v] of await idb.entries('outbox')) if (v.rejected) await idb.put('outbox', key, { ...v, rejected: false, error: null });
  await refreshPending();
}
export async function outboxEntries() { return (await idb.entries('outbox')).map(([key, v]) => ({ key, ...v })); }

/* ---------- Équipe : vérification, initialisation, rattachement, configuration ---------- */

/**
 * Vérifie un dépôt d'équipe avec un jeton (sans session ouverte possible) : compte GitHub, dépôt (privé ?),
 * branche, initialisation, appartenance à config/utilisateurs.json.
 * → { team, login, userName, repo: { fullName, private, defaultBranch }, empty, branchMissing, initialized, equipe, member, devices }
 */
export async function probeTeam(settings, token) {
  if (!token) throw new Error('Jeton d’accès GitHub requis.');
  const t = teamSettings(settings);
  const gh = createGitHub({ token, owner: t.owner, repo: t.repo, apiUrl: t.apiUrl });
  const user = await gh.user();
  let repo;
  try { repo = await gh.repo(); }
  catch (e) { if (e.code === 'not-found') e.message = `Dépôt ${t.owner}/${t.repo} introuvable ou inaccessible avec ce jeton : vérifiez le nom et que le jeton donne accès à ce dépôt (Repository access › Only select repositories).`; throw e; }
  const out = { team: t, login: user.login, userName: user.name || user.login, repo: { fullName: repo.full_name || `${t.owner}/${t.repo}`, private: repo.private === true, defaultBranch: repo.default_branch || 'main', htmlUrl: repo.html_url || '' }, empty: false, branchMissing: false, initialized: false, equipe: null, member: null, devices: null, users: null };
  const h = await gh.head(t.branch);
  if (h?.empty) { out.empty = true; return out; }
  if (!h) { out.branchMissing = true; return out; }
  const cfg = await readConfigFiles(gh, h.treeSha, dataPaths(t.prefix));
  out.initialized = !!cfg.equipe;
  out.equipe = cfg.equipe;
  out.users = cfg.utilisateurs?.users || null;
  out.devices = cfg.appareils?.devices || null;
  out.member = (out.users || []).find(u => String(u.login || '').toLowerCase() === String(user.login).toLowerCase()) || null;
  return out;
}

/** « Tester la connexion » (mode équipe) : vérification du dépôt + état de cet appareil. */
export async function testConnection() {
  if (!isTeamMode() || !team()) throw new Error('Cet appareil n’est rattaché à aucune équipe.');
  if (!session.token) throw new Error('Aucun jeton GitHub enregistré sur cet appareil.');
  const r = await probeTeam(team(), session.token);
  r.device = (r.devices || []).find(d => d.id === session.device.id) || null;
  syncState.initialized = r.initialized; syncState.needsLogin = false; emit();
  return r;
}

/**
 * Initialise un dépôt de données vide (premier appareil, administrateur) : config/equipe.json,
 * utilisateurs.json (l'initiateur administrateur), appareils.json, sequences.json. Un dépôt sans aucun
 * commit est d'abord amorcé par l'API Contents (l'API Git Data refuse un dépôt vide). republish : toutes
 * les données de l'appareil seront envoyées à la synchronisation suivante.
 */
export async function initializeRepo({ orgName = '', settings = team(), token = session.token, login = session.githubLogin, name = session.user?.name || '', republish = false } = {}) {
  const t = teamSettings(settings);
  const gh = createGitHub({ token, owner: t.owner, repo: t.repo, apiUrl: t.apiUrl });
  const P = dataPaths(t.prefix);
  const now = nowISO();
  const equipe = { format: DATA_FORMAT, createdAt: now, orgName: orgName || '', createdBy: login || name };
  let created = false;
  const h = await gh.head(t.branch);
  if (h?.empty) {
    await gh.putContents(P.config('equipe.json'), utf8(stableJSON(equipe)), 'Initialisation du dépôt de données (fiches de contrôle terrain)', { branch: t.branch });
    created = true;
  } else if (!h) {
    const repo = await gh.repo();
    const def = await gh.getRef(repo.default_branch || 'main');
    if (!def?.sha) throw new Error(`Branche « ${t.branch} » introuvable dans le dépôt.`);
    await gh.createRef(t.branch, def.sha);
  }
  const res = await gh.commitWithRetry({ branch: t.branch, build: async head => {
    const cur = await readConfigFiles(gh, head.treeSha, P);
    if (cur.equipe && !created) throw new Error('Ce dépôt de données est déjà initialisé : rejoignez l’équipe au lieu de l’initialiser.');
    const files = [];
    if (!cur.equipe) files.push({ path: P.config('equipe.json'), content: stableJSON(equipe) });
    if (!cur.utilisateurs) files.push({ path: P.config('utilisateurs.json'), content: stableJSON({ users: login ? [{ login, name, role: 'admin', active: true, addedAt: now }] : [] }) });
    if (!cur.appareils) files.push({ path: P.config('appareils.json'), content: stableJSON({ devices: [] }) });
    if (!cur.sequences) files.push({ path: P.config('sequences.json'), content: stableJSON({}) });
    return { files, message: 'Initialisation de la configuration de l’équipe (utilisateurs, appareils, numéros)' };
  } });
  if (isTeamMode() && cacheKey() === cacheKey(t)) {
    await resetSyncCache();
    // Dépôt (ré)initialisé depuis un appareil déjà en équipe : toutes ses données y sont renvoyées.
    if (republish) { await markAllForPush(); await refreshPending(); }
  }
  syncState.initialized = true; emit();
  return res;
}

/** Marque toutes les données locales pour envoi (rattachement d'un appareil autonome à une équipe). */
async function markAllForPush() {
  const ops = [], at = nowISO();
  for (const type of store.types()) {
    if (LOCAL_ONLY.has(type)) continue;
    for (const e of store.all(type, { withDeleted: true })) ops.push({ store: 'outbox', key: `${type}:${e.id}`, value: { type, id: e.id, baseRev: e._rev || 0, at } });
  }
  for (const id of await idb.keys('media')) if (store.getRaw('media', id)) ops.push({ store: 'outbox', key: `__bin:${id}`, value: { type: '__bin', id, at } });
  for (let i = 0; i < ops.length; i += 500) await idb.batch(ops.slice(i, i + 500));
}

/**
 * Rattache cet appareil (session ouverte, mode autonome) à une équipe : vérifie le dépôt, initialise un
 * dépôt vide si besoin (administrateur), puis fusionne toutes les données locales avec celles du dépôt.
 */
export async function attachDevice({ settings, token, orgName = '' }) {
  if (!can('settings.manage')) throw new Error('Rattachement réservé à l’administrateur de l’appareil.');
  const probe = await probeTeam(settings, token);
  if (!probe.repo.private) throw new Error('Le dépôt de données doit être PRIVÉ : les données d’audit ne doivent pas être publiques.');
  if (probe.member && probe.member.active === false) throw new Error('Votre compte GitHub est désactivé dans cette équipe (config/utilisateurs.json).');
  await attachTeam({ team: probe.team, token, login: probe.login });
  await resetSyncCache();
  if (!probe.initialized) await initializeRepo({ orgName, settings: probe.team, token, login: probe.login, name: session.user.name });
  await markAllForPush();
  await refreshPending();
  syncState.initialized = true; syncState.needsLogin = false; emit();
  return probe;
}

/** Détache l'appareil de l'équipe (retour au mode autonome ; les données locales restent). */
export async function detachDevice(reason = null) {
  await detachTeam(reason);
  await resetSyncCache();
  Object.assign(syncState, { lastError: null, needsLogin: false, initialized: null, lastResult: null });
  emit();
}

/** Remplace le jeton de l'appareil (jeton expiré ou révoqué) après vérification. */
export async function replaceToken(token) {
  if (!isTeamMode() || !team()) throw new Error('Cet appareil n’est rattaché à aucune équipe.');
  const probe = await probeTeam(team(), token);
  await saveTeamToken(token, probe.login);
  await linkGithubLogin(session.user.id, probe.login);
  syncState.needsLogin = false; syncState.lastError = null; emit();
  return probe;
}

/** Configuration de l'équipe : dernière lecture mémorisée, ou relecture dans le dépôt (refresh). */
export async function readTeamConfig({ refresh = false } = {}) {
  const cfg = await loadConfig();
  if (!refresh || !isTeamMode() || !session.token || !navigator.onLine) return cfg;
  const gh = client();
  const h = await gh.head(team().branch);
  if (!h?.sha) throw notInitialized(h);
  const cur = await readConfigFiles(gh, h.treeSha, paths());
  Object.assign(cfg, { equipe: cur.equipe, utilisateurs: cur.utilisateurs, appareils: cur.appareils, sequences: cur.sequences, readAt: nowISO() });
  await saveConfig(cfg);
  return cfg;
}

/**
 * Modifie un fichier config/<name>.json du dépôt par un commit (relecture et nouvel essai en cas d'écriture
 * concurrente). mutate(valeur actuelle) → nouvelle valeur (undefined = aucune modification).
 */
export async function updateTeamConfig(name, mutate, message) {
  if (!isTeamMode() || !session.token) throw new Error('Fonction disponible uniquement en mode équipe (jeton GitHub requis).');
  const gh = client(), P = paths();
  const defaults = { utilisateurs: { users: [] }, appareils: { devices: [] }, sequences: {} };
  const res = await gh.commitWithRetry({ branch: team().branch, build: async h => {
    const cur = await readConfigFiles(gh, h.treeSha, P);
    if (!cur.equipe) throw notInitialized();
    const next = mutate(clone(cur[name] ?? defaults[name] ?? {}));
    if (next === undefined || deepEqual(next, cur[name])) return null;
    return { files: [{ path: P.config(`${name}.json`), content: stableJSON(next) }], message, next };
  } });
  if (res.plan) {
    const cfg = await loadConfig(); cfg[name] = res.plan.next; await saveConfig(cfg);
    const cache = await loadCache();
    cache.files[P.config(`${name}.json`)] = await gitBlobSha(res.plan.files[0].content);
    delete cache.dirs[P.prefix]; delete cache.dirs[P.prefix + 'config/']; delete cache.dirs[''];
    await saveCache(cache);
    await store.log('team-config', { entityLabel: `config/${name}.json`, reason: message, details: { depot: teamLabel(), commit: res.commitSha } });
  }
  return res;
}

/** Utilisateurs de l'équipe (config/utilisateurs.json) : ajout ou modification d'un login. */
export async function saveTeamUser({ login, name = '', role = 'auditeur', active = true }, { previousLogin = null } = {}) {
  if (!can('users.manage')) throw new Error('Gestion des utilisateurs réservée à l’administrateur.');
  login = String(login || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) throw new Error('Login GitHub invalide.');
  if (!ROLES[role]) throw new Error('Profil inconnu.');
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  return updateTeamConfig('utilisateurs', cfg => {
    const users = Array.isArray(cfg.users) ? cfg.users : [];
    const old = users.find(u => same(u.login, previousLogin || login));
    if (!old && users.some(u => same(u.login, login))) throw new Error('Ce login figure déjà dans l’équipe.');
    const entry = { ...(old || { addedAt: nowISO(), addedBy: session.githubLogin || session.user.name }), login, name, role, active: !!active, updatedAt: nowISO() };
    const list = [...users.filter(u => u !== old), entry];
    if (!list.some(u => u.role === 'admin' && u.active !== false)) throw new Error('Il doit rester au moins un administrateur actif dans l’équipe.');
    return { ...cfg, users: list.sort((a, b) => String(a.name || a.login).localeCompare(String(b.name || b.login), 'fr')) };
  }, `${previousLogin ? 'Modification' : 'Ajout'} de l’utilisateur ${login} (${ROLES[role]}${active ? '' : ', désactivé'})`);
}

/** Révocation (appareil perdu, volé, réaffecté) ou réactivation d'un appareil de l'équipe. */
export async function setDeviceRevoked(id, revoked, reason = '') {
  if (!can('devices.manage')) throw new Error('Gestion des appareils réservée à l’administrateur.');
  let label = id;
  return updateTeamConfig('appareils', cfg => {
    const devices = Array.isArray(cfg.devices) ? cfg.devices : [];
    const d = devices.find(x => x.id === id);
    if (!d) throw new Error('Appareil inconnu dans config/appareils.json.');
    label = `${d.name} (n° ${d.no})`;
    if (!!d.revoked === !!revoked) return undefined;
    Object.assign(d, revoked
      ? { revoked: true, revokedAt: nowISO(), revokedBy: session.githubLogin || session.user.name, revokeReason: reason || '' }
      : { revoked: false, restoredAt: nowISO(), restoredBy: session.githubLogin || session.user.name });
    return { ...cfg, devices };
  }, revoked ? `Révocation de l’appareil ${id}${reason ? ' : ' + reason : ''}` : `Réactivation de l’appareil ${id}`).then(r => ({ ...r, label }));
}
