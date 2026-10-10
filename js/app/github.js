/* Client REST GitHub pour le navigateur et fonctions pures de la synchronisation d'équipe.
 *
 * Le mode « équipe » partage les données entre appareils au moyen d'un dépôt GitHub PRIVÉ de données
 * (ex. CSRE-DCE/fiche-de-controle-donnees), distinct du dépôt public de l'application, lu et écrit
 * directement depuis le navigateur par l'API REST GitHub (CORS autorisé par GitHub), avec un jeton
 * d'accès « fine-grained » (Contents : Read and write, limité à ce seul dépôt). Aucun serveur.
 *
 * Ce module ne dépend ni du stockage local ni de la session : il est testé seul (tests/unit/github.test.js)
 * avec une fonction fetch simulée. Il fournit :
 *  - createGitHub() : appels REST (utilisateur, dépôt, références, commits, arbres, blobs, API Contents),
 *    commit atomique d'un lot de fichiers (blobs → arbre(s) → commit → référence SANS forçage) ;
 *  - githubError() : erreurs claires en français (jeton refusé, limite de débit, introuvable, dépôt vide,
 *    écriture concurrente « non fast-forward » à réessayer…) ;
 *  - l'arborescence du dépôt de données (préfixe configurable, défaut « donnees/ ») :
 *      config/equipe.json        { format, createdAt, orgName }
 *      config/utilisateurs.json  { users: [{ login, name, role, active }] }
 *      config/appareils.json     { devices: [{ id, no, name, registeredAt, registeredBy, revoked, revokedAt, revokedBy }] }
 *      config/sequences.json     { "AUD-2026": 12 }  (dernier numéro d'audit réservé)
 *      entites/<type>/<id>.json  une entité par fichier (JSON stable, clés triées, lisible dans GitHub)
 *      journal/<AAAA-MM>/<AAAA-MM-JJ>_<appareil>.json  journal d'audit : entrées d'un appareil pour un jour
 *                                (regroupées pour limiter le nombre de fichiers et de requêtes)
 *      medias/<id>               contenu binaire des photos, signatures et documents (octets bruts) ;
 *  - l'empreinte git exacte d'un fichier (SHA-1 de « blob <taille>\0<contenu> ») : un fichier dont
 *    l'empreinte n'a pas changé n'est ni relu ni renvoyé (lecture différentielle via l'arbre).
 */
import { bytesToBase64, base64ToBytes, sleep } from '../core/util.js';

export const GITHUB_API = 'https://api.github.com';
export const API_VERSION = '2022-11-28';
export const DATA_FORMAT = 'oeg-ct-donnees-v1';
export const CONFIG_FILES = ['equipe.json', 'utilisateurs.json', 'appareils.json', 'sequences.json'];
/** Taille maximale d'un fichier accepté par l'API GitHub (blobs) : 100 Mo ; marge de sécurité. */
export const MAX_BLOB_BYTES = 95 * 1024 * 1024;

const enc = new TextEncoder(), dec = new TextDecoder();
export const utf8 = s => enc.encode(String(s));
export const fromUtf8 = b => dec.decode(b);

/* ---------- Empreintes et JSON stable ---------- */

/** Empreinte git d'un blob (identique à `git hash-object`) : SHA-1 hexadécimal. */
export async function gitBlobSha(data) {
  const bytes = typeof data === 'string' ? utf8(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const head = utf8(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const h = await globalThis.crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const sortDeep = v => Array.isArray(v) ? v.map(sortDeep)
  : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = sortDeep(v[k]); return o; }, {}) : v;
/** JSON stable (clés triées, indentation de 2 espaces, fin de ligne) : contenu identique ⇒ empreinte identique. */
export function stableJSON(value) { return JSON.stringify(sortDeep(value), null, 2) + '\n'; }

/* ---------- Paramètres du dépôt ---------- */

/** « propriétaire/dépôt », adresse https://github.com/propriétaire/dépôt(.git) → { owner, repo } ou null. */
export function parseRepoSpec(spec) {
  let s = String(spec || '').trim();
  if (!s) return null;
  s = s.replace(/^git@[^:]+:/, '').replace(/^https?:\/\/[^/]+\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2] };
}

/** Préfixe des données dans le dépôt : '' (racine) ou 'chemin/' (sans barre initiale, barre finale). */
export function normalizePrefix(p) {
  const parts = String(p ?? '').split('/').map(x => x.trim()).filter(x => x && x !== '.' && x !== '..');
  return parts.length ? parts.join('/') + '/' : '';
}

/** Adresse de l'API : HTTPS obligatoire hors poste local (GitHub Enterprise : https://serveur/api/v3). */
export function normalizeApiUrl(url = GITHUB_API) {
  const s = String(url || GITHUB_API).trim();
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('Adresse de l’API GitHub invalide.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('L’API GitHub doit être jointe en HTTPS (communications chiffrées).');
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/** Configuration d'équipe normalisée : { apiUrl, owner, repo, branch, prefix }. */
export function teamSettings({ apiUrl = GITHUB_API, owner = '', repo = '', branch = 'main', prefix = 'donnees/' } = {}) {
  const r = parseRepoSpec(`${owner}/${repo}`);
  if (!r) throw new Error('Dépôt GitHub invalide : indiquez « propriétaire/nom-du-dépôt ».');
  const b = String(branch || 'main').trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(b) || b.includes('..') || b.startsWith('/') || b.endsWith('/')) throw new Error('Nom de branche invalide.');
  return { apiUrl: normalizeApiUrl(apiUrl), owner: r.owner, repo: r.repo, branch: b, prefix: normalizePrefix(prefix) };
}

/* ---------- Arborescence du dépôt de données ---------- */

/** Nom de fichier sûr pour un identifiant (caractères hors [A-Za-z0-9._@-] encodés en %XX). */
export function fileSafe(id) {
  const s = String(id);
  if (/^[A-Za-z0-9._@-]+$/.test(s) && !/^\.+$/.test(s)) return s;
  return [...utf8(s)].map(b => b < 128 && /[A-Za-z0-9_@-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
}
export function unFileSafe(name) { try { return decodeURIComponent(name); } catch (e) { return name; } }

/** Jour (UTC, AAAA-MM-JJ) d'une entrée du journal. */
export const trailDay = entry => (String(entry?.at || '').match(/^\d{4}-\d{2}-\d{2}/) || ['0000-00-00'])[0];

/** Chemins des fichiers du dépôt de données pour un préfixe donné. */
export function dataPaths(prefix = 'donnees/') {
  const p = normalizePrefix(prefix);
  return {
    prefix: p,
    config: name => `${p}config/${name}`,
    entity: (type, id) => `${p}entites/${fileSafe(type)}/${fileSafe(id)}.json`,
    media: id => `${p}medias/${fileSafe(id)}`,
    journal: (deviceId, day) => `${p}journal/${String(day).slice(0, 7)}/${day}_${fileSafe(deviceId || 'appareil-inconnu')}.json`,
    journalOf: entry => `${p}journal/${trailDay(entry).slice(0, 7)}/${trailDay(entry)}_${fileSafe(entry?.deviceId || 'appareil-inconnu')}.json`
  };
}

/**
 * Nature d'un chemin du dépôt : { kind: 'config', name } | { kind: 'entity', type, id } | { kind: 'media', id }
 * | { kind: 'journal', day, deviceId } | null (fichier étranger aux données : README, etc.).
 */
export function parseDataPath(prefix, path) {
  const p = normalizePrefix(prefix);
  if (!String(path).startsWith(p)) return null;
  const rest = String(path).slice(p.length).split('/');
  if (rest[0] === 'config' && rest.length === 2 && rest[1]) return { kind: 'config', name: rest[1] };
  if (rest[0] === 'entites' && rest.length === 3 && rest[2].endsWith('.json') && rest[2].length > 5) return { kind: 'entity', type: unFileSafe(rest[1]), id: unFileSafe(rest[2].slice(0, -5)) };
  if (rest[0] === 'medias' && rest.length === 2 && rest[1]) return { kind: 'media', id: unFileSafe(rest[1]) };
  if (rest[0] === 'journal' && rest.length === 3) {
    const m = rest[2].match(/^(\d{4}-\d{2}-\d{2})_(.+)\.json$/);
    if (m) return { kind: 'journal', day: m[1], deviceId: unFileSafe(m[2]) };
  }
  return null;
}
/** Dossiers de premier niveau sous le préfixe qui contiennent des données (les autres sont ignorés). */
export const DATA_DIRS = ['config', 'entites', 'journal', 'medias'];

/* ---------- Erreurs ---------- */

export class GitHubError extends Error {
  constructor(message, { status = 0, code = 'http', retryable = false, resetAt = null, detail = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    Object.assign(this, { status, code, retryable, resetAt, detail });
  }
}

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const header = (headers, name) => (headers && typeof headers.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) ?? null;

/**
 * Traduit une réponse d'erreur de l'API en GitHubError (fonction pure). status 0 = réseau injoignable.
 * Codes : network, auth, rate-limit, forbidden, not-found, empty, conflict (à réessayer), invalid, server.
 */
export function githubError(status, body = {}, headers = null, { now = Date.now() } = {}) {
  const msg = String(body?.message || '');
  const detail = msg + (Array.isArray(body?.errors) && body.errors.length ? ' — ' + body.errors.map(e => e.message || e.code || '').join(', ') : '');
  if (!status) return new GitHubError('GitHub injoignable : vérifiez la connexion réseau.', { code: 'network', retryable: true, detail });
  const remaining = header(headers, 'x-ratelimit-remaining');
  if (status === 429 || (status === 403 && (remaining === '0' || /rate limit/i.test(msg)))) {
    const reset = Number(header(headers, 'x-ratelimit-reset')), after = Number(header(headers, 'retry-after'));
    const resetAt = after > 0 ? new Date(now + after * 1000) : reset > 0 ? new Date(reset * 1000) : new Date(now + 60000);
    return new GitHubError(`Limite de débit de l’API GitHub atteinte : nouvel essai possible vers ${hhmm(resetAt)}.`, { status, code: 'rate-limit', resetAt: resetAt.toISOString(), detail });
  }
  if (status === 401) return new GitHubError('Jeton GitHub refusé (invalide, expiré ou révoqué) : renouvelez le jeton dans Synchronisation.', { status, code: 'auth', detail });
  if (status === 403) return new GitHubError('Accès refusé par GitHub : le jeton doit donner accès à ce dépôt avec la permission « Contents : Read and write ».', { status, code: 'forbidden', detail });
  if (status === 404) return new GitHubError('Introuvable sur GitHub (dépôt, branche ou fichier) : vérifiez le propriétaire, le nom du dépôt et que le jeton donne accès à ce dépôt.', { status, code: 'not-found', detail });
  if (status === 409 && /empty/i.test(msg)) return new GitHubError('Le dépôt GitHub est vide (aucun commit) : il doit être initialisé.', { status, code: 'empty', detail });
  if (status === 409 || (status === 422 && /fast.?forward|already exists|cannot be updated|does not match|wasn.t supplied|is at .* but expected/i.test(msg))) {
    return new GitHubError('Le dépôt a été modifié pendant l’écriture (écriture concurrente) : nouvel essai.', { status, code: 'conflict', retryable: true, detail });
  }
  if (status === 422) return new GitHubError(`Requête refusée par GitHub : ${detail || 'données invalides'}.`, { status, code: 'invalid', detail });
  if (status >= 500) return new GitHubError(`Erreur temporaire de GitHub (${status}) : réessayez dans quelques instants.`, { status, code: 'server', retryable: true, detail });
  return new GitHubError(`Erreur GitHub ${status}${detail ? ' : ' + detail : ''}.`, { status, code: 'http', detail });
}

/* ---------- Découpage des écritures ---------- */

/** Taille approximative (octets) d'une entrée d'arbre envoyée à l'API. */
const entrySize = e => (e.content ? utf8(e.content).length : 0) + String(e.path).length + 120;
/** Répartit des entrées d'arbre en lots (taille et nombre bornés) : un arbre par lot, chaînés par base_tree. */
export function chunkEntries(entries, { maxBytes = 900000, maxCount = 400 } = {}) {
  const out = [];
  let cur = [], size = 0;
  for (const e of entries) {
    const s = entrySize(e);
    if (cur.length && (size + s > maxBytes || cur.length >= maxCount)) { out.push(cur); cur = []; size = 0; }
    cur.push(e); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Exécute fn sur chaque élément avec au plus `limit` appels simultanés ; résultats dans l'ordre. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/* ---------- Client ---------- */

const encSeg = s => encodeURIComponent(s);
const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');

/**
 * Client de l'API REST GitHub. opts : { token, owner, repo, apiUrl, fetch }.
 * Toutes les requêtes : Authorization: Bearer, Accept: application/vnd.github+json, X-GitHub-Api-Version,
 * sans cache HTTP (les réponses contiennent des données d'audit en clair : jamais conservées par le navigateur).
 */
export function createGitHub({ token = '', owner = '', repo = '', apiUrl = GITHUB_API, fetch: fetchFn = null } = {}) {
  const base = normalizeApiUrl(apiUrl);
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  const R = `/repos/${encSeg(owner)}/${encSeg(repo)}`;
  const client = {
    rate: null,          // { limit, remaining, reset } d'après la dernière réponse
    requests: 0,

    async request(method, path, { body } = {}) {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let res;
      client.requests++;
      try { res = await doFetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' }); }
      catch (e) { throw githubError(0, { message: e?.message || String(e) }); }
      const lim = header(res.headers, 'x-ratelimit-limit');
      if (lim !== null) client.rate = { limit: Number(lim), remaining: Number(header(res.headers, 'x-ratelimit-remaining')), reset: Number(header(res.headers, 'x-ratelimit-reset')) };
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw githubError(res.status, b, res.headers);
      }
      if (res.status === 204) return null;
      return res.json();
    },

    user: () => client.request('GET', '/user'),
    repo: () => client.request('GET', R),

    /** Référence d'une branche : { sha } ; { empty: true } si le dépôt n'a aucun commit ; null si la branche n'existe pas. */
    async getRef(branch) {
      try { const r = await client.request('GET', `${R}/git/ref/heads/${encPath(branch)}`); return { sha: r.object.sha }; }
      catch (e) { if (e.code === 'empty') return { empty: true }; if (e.code === 'not-found') return null; throw e; }
    },
    getCommit: sha => client.request('GET', `${R}/git/commits/${encSeg(sha)}`),
    /** Arbre : { sha, tree: [{ path, mode, type: 'blob'|'tree', sha, size }], truncated }. */
    getTree: (sha, { recursive = false } = {}) => client.request('GET', `${R}/git/trees/${encSeg(sha)}${recursive ? '?recursive=1' : ''}`),
    /** Contenu d'un blob (octets). */
    async getBlob(sha) {
      const b = await client.request('GET', `${R}/git/blobs/${encSeg(sha)}`);
      if (b.encoding && b.encoding !== 'base64') return utf8(b.content || '');
      return base64ToBytes(String(b.content || '').replace(/\s+/g, ''));
    },
    /** Crée un blob à partir d'octets (base64 : fichiers binaires) → { sha }. */
    createBlob: bytes => client.request('POST', `${R}/git/blobs`, { body: { content: bytesToBase64(bytes), encoding: 'base64' } }),
    /** Crée un arbre (entrées { path, mode, type, sha | content }, sha null = suppression) sur base_tree. */
    createTree: (tree, baseTree = null) => client.request('POST', `${R}/git/trees`, { body: baseTree ? { base_tree: baseTree, tree } : { tree } }),
    createCommit: ({ message, tree, parents }) => client.request('POST', `${R}/git/commits`, { body: { message, tree, parents } }),
    /** Avance la branche SANS forçage : refusé (conflict) si le commit ne descend pas de la tête actuelle. */
    updateRef: (branch, sha) => client.request('PATCH', `${R}/git/refs/heads/${encPath(branch)}`, { body: { sha, force: false } }),
    createRef: (branch, sha) => client.request('POST', `${R}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha } }),
    /** API Contents : crée/remplace un fichier par un commit (seul moyen d'écrire dans un dépôt vide). */
    putContents: (path, bytes, message, { branch = null, sha = null } = {}) => client.request('PUT', `${R}/contents/${encPath(path)}`, { body: { message, content: bytesToBase64(bytes), ...(branch ? { branch } : {}), ...(sha ? { sha } : {}) } }),

    /** Tête d'une branche : { sha, treeSha } | { empty: true } | null (branche absente). */
    async head(branch) {
      const ref = await client.getRef(branch);
      if (!ref || ref.empty) return ref;
      const c = await client.getCommit(ref.sha);
      return { sha: ref.sha, treeSha: c.tree.sha };
    },

    /** Entrée d'un chemin (fichier ou dossier) dans un arbre : { sha, type, size } ou null. */
    async lookup(treeSha, path) {
      const segs = String(path).split('/').filter(Boolean);
      let sha = treeSha, found = { sha: treeSha, type: 'tree' };
      for (const seg of segs) {
        if (found.type !== 'tree') return null;
        const t = await client.getTree(sha);
        const e = (t.tree || []).find(x => x.path === seg);
        if (!e) return null;
        found = e; sha = e.sha;
      }
      return found;
    },
    /** Contenu d'un fichier à partir de l'arbre racine (octets), ou null s'il n'existe pas. */
    async readFile(treeSha, path) {
      const e = await client.lookup(treeSha, path);
      return e && e.type === 'blob' ? client.getBlob(e.sha) : null;
    },
    async readJSON(treeSha, path) {
      const b = await client.readFile(treeSha, path);
      return b ? JSON.parse(fromUtf8(b)) : null;
    },

    /**
     * Commit atomique d'un lot de fichiers sur la tête `parentSha` : files = [{ path, content (texte) | bytes
     * (binaire, blob base64) | sha (blob existant) | delete: true }]. Les textes sont envoyés dans l'arbre
     * (une requête par lot, pas de requête par fichier) ; les arbres successifs sont chaînés par base_tree.
     * Lève GitHubError code 'conflict' si la branche a avancé entre-temps (relire, fusionner, réessayer).
     * Retourne { commitSha, treeSha, parentSha }.
     */
    async commitFiles({ branch, parentSha, baseTreeSha, files, message }) {
      const entries = [];
      for (const f of files) {
        if (f.delete) entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
        else if (typeof f.content === 'string') entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
        else {
          const sha = f.uploadedSha || (await client.createBlob(f.bytes)).sha;
          f.uploadedSha = sha;   // pas de nouvel envoi du même fichier en cas de nouvel essai
          entries.push({ path: f.path, mode: '100644', type: 'blob', sha });
        }
      }
      let tree = baseTreeSha;
      for (const chunk of chunkEntries(entries)) tree = (await client.createTree(chunk, tree)).sha;
      const commit = await client.createCommit({ message, tree, parents: [parentSha] });
      await client.updateRef(branch, commit.sha);
      return { commitSha: commit.sha, treeSha: tree, parentSha };
    },

    /**
     * Écriture avec nouvelle tentative : build({ sha, treeSha, attempt }) → { files, message } | null (rien à
     * écrire) est rappelé sur la tête la plus récente après chaque refus « non fast-forward ».
     */
    async commitWithRetry({ branch, build, maxAttempts = 5 }) {
      for (let attempt = 1; ; attempt++) {
        const h = await client.head(branch);
        if (!h || h.empty) throw new GitHubError(h?.empty ? 'Le dépôt GitHub est vide (aucun commit) : il doit être initialisé.' : `Branche « ${branch} » introuvable dans le dépôt.`, { code: h?.empty ? 'empty' : 'not-found', status: h?.empty ? 409 : 404 });
        const plan = await build({ ...h, attempt });
        if (!plan || !plan.files?.length) return { skipped: true, headSha: h.sha };
        try { return { ...(await client.commitFiles({ branch, parentSha: h.sha, baseTreeSha: h.treeSha, files: plan.files, message: plan.message })), attempts: attempt, plan }; }
        catch (e) {
          if (e.code === 'conflict' && attempt < maxAttempts) { await sleep(150 * attempt + Math.floor(Math.random() * 200)); continue; }
          throw e;
        }
      }
    }
  };
  return client;
}
