/* Tests unitaires de la synchronisation d'équipe par GitHub (fonctions pures de js/app/github.js et client
 * REST avec une fonction fetch simulée) : empreintes git exactes, JSON stable, paramètres du dépôt,
 * arborescence des données, erreurs claires (jeton, limite de débit, dépôt vide, écriture concurrente),
 * en-têtes des requêtes, blobs base64, commit atomique et nouvel essai après refus « non fast-forward ». */
import { test, assert, eq, deepEq, throwsAsync } from './harness.js';
import {
  gitBlobSha, stableJSON, parseRepoSpec, normalizePrefix, normalizeApiUrl, teamSettings, fileSafe, unFileSafe, dataPaths, parseDataPath,
  githubError, chunkEntries, mapLimit, createGitHub, trailDay, utf8, fromUtf8, GITHUB_API, API_VERSION
} from '../../js/app/github.js';
import { bytesToBase64 } from '../../js/core/util.js';

/* ---------- Empreintes ---------- */
test('github : empreintes git exactes (git hash-object)', async () => {
  eq(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'fichier vide');
  eq(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'hello');
  eq(await gitBlobSha(utf8('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a', 'octets = texte UTF-8');
  eq(await gitBlobSha('é'), await gitBlobSha(new Uint8Array([0xc3, 0xa9])), 'UTF-8');
  eq(await gitBlobSha(new Uint8Array([0, 1, 2, 255])), 'f971a5e28b6c4cb237ca3c7349e33bb600dbc907', 'binaire');
  eq(await gitBlobSha(stableJSON({ a: 1 })), '8d6b85c7b3f97652ab7fdfdf53f3dd2b6dc3ccef', 'JSON stable');
});

test('github : JSON stable (clés triées, indentation, fin de ligne, undefined ignoré)', async () => {
  const a = stableJSON({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'é' }, u: undefined });
  eq(a, '{\n  "a": {\n    "c": "é",\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  eq(stableJSON({ x: 1, y: 2 }), stableJSON({ y: 2, x: 1 }), 'ordre des clés indifférent');
  eq(await gitBlobSha(stableJSON({ x: 1, y: 2 })), await gitBlobSha(stableJSON({ y: 2, x: 1 })), 'même empreinte');
});

/* ---------- Paramètres ---------- */
test('github : dépôt « propriétaire/nom » et adresses GitHub', () => {
  deepEq(parseRepoSpec('CSRE-DCE/fiche-de-controle-donnees'), { owner: 'CSRE-DCE', repo: 'fiche-de-controle-donnees' });
  deepEq(parseRepoSpec(' https://github.com/CSRE-DCE/donnees.git '), { owner: 'CSRE-DCE', repo: 'donnees' });
  deepEq(parseRepoSpec('https://github.com/oeg/d_1.x/'), { owner: 'oeg', repo: 'd_1.x' });
  deepEq(parseRepoSpec('git@github.com:oeg/donnees.git'), { owner: 'oeg', repo: 'donnees' });
  for (const bad of ['', 'oeg', 'oeg/', '/donnees', 'oeg/a/b', 'o g/d', 'oeg/..', '-oeg/d']) eq(parseRepoSpec(bad), null, bad);
});

test('github : préfixe des données, adresse de l’API, réglages d’équipe', () => {
  eq(normalizePrefix(''), ''); eq(normalizePrefix('/'), ''); eq(normalizePrefix('donnees'), 'donnees/');
  eq(normalizePrefix('/donnees/'), 'donnees/'); eq(normalizePrefix('a//b/../c'), 'a/b/c/'); eq(normalizePrefix(undefined), '');
  eq(normalizeApiUrl(), GITHUB_API); eq(normalizeApiUrl('https://ghe.oeg.fr/api/v3/'), 'https://ghe.oeg.fr/api/v3');
  eq(normalizeApiUrl('http://127.0.0.1:8899'), 'http://127.0.0.1:8899', 'poste local en http');
  let err = null; try { normalizeApiUrl('http://api.exemple.fr'); } catch (e) { err = e; }
  assert(err && /HTTPS/.test(err.message), 'HTTPS obligatoire hors poste local');
  deepEq(teamSettings({ owner: 'oeg', repo: 'donnees' }), { apiUrl: GITHUB_API, owner: 'oeg', repo: 'donnees', branch: 'main', prefix: 'donnees/' });
  eq(teamSettings({ owner: 'oeg', repo: 'd', branch: 'donnees/2026', prefix: '' }).prefix, '');
  for (const branch of ['a..b', '/x', 'x/', 'a b']) { let e = null; try { teamSettings({ owner: 'o', repo: 'r', branch }); } catch (x) { e = x; } assert(e, 'branche refusée : ' + branch); }
});

/* ---------- Arborescence ---------- */
test('github : chemins du dépôt de données et analyse inverse', () => {
  const P = dataPaths('donnees/');
  eq(P.config('equipe.json'), 'donnees/config/equipe.json');
  eq(P.entity('audit', '3f2a-1'), 'donnees/entites/audit/3f2a-1.json');
  eq(P.media('m-1'), 'donnees/medias/m-1');
  eq(P.journal('dev-1', '2026-10-10'), 'donnees/journal/2026-10/2026-10-10_dev-1.json');
  eq(P.journalOf({ at: '2026-10-09T23:59:59.000Z', deviceId: 'd' }), 'donnees/journal/2026-10/2026-10-09_d.json');
  eq(trailDay({ at: 'n/a' }), '0000-00-00');
  deepEq(parseDataPath('donnees/', 'donnees/entites/site/site-09271503.json'), { kind: 'entity', type: 'site', id: 'site-09271503' });
  deepEq(parseDataPath('donnees/', 'donnees/config/appareils.json'), { kind: 'config', name: 'appareils.json' });
  deepEq(parseDataPath('donnees/', 'donnees/medias/m-1'), { kind: 'media', id: 'm-1' });
  deepEq(parseDataPath('donnees/', 'donnees/journal/2026-10/2026-10-10_dev-1.json'), { kind: 'journal', day: '2026-10-10', deviceId: 'dev-1' });
  eq(parseDataPath('donnees/', 'README.md'), null); eq(parseDataPath('donnees/', 'donnees/autre/x.json'), null);
  eq(parseDataPath('donnees/', 'donnees/entites/site/x.txt'), null);
  deepEq(parseDataPath('', 'entites/user/u1.json'), { kind: 'entity', type: 'user', id: 'u1' }, 'préfixe racine');
});

test('github : noms de fichiers sûrs pour tout identifiant (aller-retour)', () => {
  for (const id of ['site-09271503', 'grid-ct-2026-v1', 'a.b', 'BSS/002 X', 'é:ü?', '50%', '..', 'org', 'x'.repeat(40)]) {
    const f = fileSafe(id);
    assert(/^[A-Za-z0-9._@%-]+$/.test(f) && f !== '..' && f !== '.', 'nom sûr : ' + f);
    eq(unFileSafe(f), id, 'aller-retour ' + id);
    deepEq(parseDataPath('d/', dataPaths('d/').entity('site', id)), { kind: 'entity', type: 'site', id }, 'chemin ' + id);
  }
  eq(fileSafe('site-09271503'), 'site-09271503', 'identifiant simple inchangé');
});

/* ---------- Erreurs ---------- */
const H = o => ({ get: k => o[k.toLowerCase()] ?? null });
test('github : erreurs claires (réseau, jeton, limite de débit, droits, introuvable)', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  let e = githubError(0, { message: 'Failed to fetch' });
  eq(e.code, 'network'); assert(e.retryable && /injoignable/.test(e.message));
  e = githubError(401, { message: 'Bad credentials' }); eq(e.code, 'auth'); assert(/jeton/i.test(e.message) && !e.retryable);
  e = githubError(403, { message: 'API rate limit exceeded' }, H({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 600) }), { now });
  eq(e.code, 'rate-limit'); eq(e.resetAt, new Date(now + 600000).toISOString()); assert(/Limite de débit/.test(e.message));
  e = githubError(429, {}, H({ 'retry-after': '30' }), { now }); eq(e.code, 'rate-limit'); eq(e.resetAt, new Date(now + 30000).toISOString());
  e = githubError(403, { message: 'You have exceeded a secondary rate limit' }, H({}), { now }); eq(e.code, 'rate-limit');
  e = githubError(403, { message: 'Resource not accessible by personal access token' }, H({ 'x-ratelimit-remaining': '4000' }));
  eq(e.code, 'forbidden'); assert(/Contents : Read and write/.test(e.message));
  e = githubError(404, { message: 'Not Found' }); eq(e.code, 'not-found');
  e = githubError(500, {}); eq(e.code, 'server'); assert(e.retryable);
});

test('github : dépôt vide, écritures concurrentes (409 / 422) à réessayer, requête invalide', () => {
  let e = githubError(409, { message: 'Git Repository is empty.' }); eq(e.code, 'empty'); assert(!e.retryable);
  e = githubError(422, { message: 'Update is not a fast forward' }); eq(e.code, 'conflict'); assert(e.retryable, 'non fast-forward');
  e = githubError(409, { message: 'donnees/config/x.json does not match abc' }); eq(e.code, 'conflict'); assert(e.retryable);
  e = githubError(422, { message: 'Reference already exists' }); eq(e.code, 'conflict');
  e = githubError(422, { message: 'Invalid request.', errors: [{ message: 'content too large' }] }); eq(e.code, 'invalid'); assert(!e.retryable && /content too large/.test(e.message));
});

/* ---------- Découpage, concurrence ---------- */
test('github : lots d’entrées d’arbre bornés en taille et en nombre', () => {
  const big = 'x'.repeat(1000);
  const entries = Array.from({ length: 25 }, (_, i) => ({ path: `p/${i}.json`, mode: '100644', type: 'blob', content: big }));
  const chunks = chunkEntries(entries, { maxBytes: 5000, maxCount: 100 });
  eq(chunks.flat().length, 25, 'aucune entrée perdue');
  assert(chunks.length >= 5 && chunks.every(c => c.length <= 4), 'taille bornée');
  eq(chunkEntries(entries, { maxBytes: 1e9, maxCount: 10 }).length, 3, 'nombre borné');
  eq(chunkEntries([{ path: 'a', content: 'y'.repeat(9000) }], { maxBytes: 100 }).length, 1, 'entrée trop grosse seule');
  deepEq(chunkEntries([]), []);
});

test('github : exécution parallèle bornée, résultats dans l’ordre', async () => {
  let running = 0, max = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (x, i) => { running++; max = Math.max(max, running); await new Promise(r => setTimeout(r, x)); running--; return x * 10 + i; });
  deepEq(out, [50, 11, 42, 23, 34, 5]); assert(max <= 2, 'au plus 2 simultanés');
  deepEq(await mapLimit([], 4, async x => x), []);
});

/* ---------- Client REST (fetch simulé) ---------- */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const key = `${init.method} ${url.replace(/^https?:\/\/[^/]+(\/api\/v3)?/, '')}`;
    const r = typeof routes === 'function' ? routes(key, calls[calls.length - 1]) : routes[key];
    if (!r) return { ok: false, status: 404, headers: H({}), json: async () => ({ message: 'Not Found' }) };
    const [status, body, headers = {}] = r;
    return { ok: status >= 200 && status < 300, status, headers: H({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1', ...headers }), json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('github : en-têtes (Bearer, Accept, version d’API), sans cache, URL de base configurable', async () => {
  const f = fakeFetch({ 'GET /user': [200, { login: 'alice' }], 'GET /repos/o%20x/r/git/ref/heads/main': [200, { object: { sha: 'a'.repeat(40) } }] });
  const gh = createGitHub({ token: 'tok-1', owner: 'o x', repo: 'r', apiUrl: 'https://ghe.oeg.fr/api/v3/', fetch: f });
  eq((await gh.user()).login, 'alice');
  const c = f.calls[0];
  eq(c.url, 'https://ghe.oeg.fr/api/v3/user');
  eq(c.headers.Authorization, 'Bearer tok-1'); eq(c.headers.Accept, 'application/vnd.github+json'); eq(c.headers['X-GitHub-Api-Version'], API_VERSION);
  eq(c.cache, 'no-store', 'jamais de cache HTTP (données en clair)'); eq(c.credentials, 'omit');
  deepEq(await gh.getRef('main'), { sha: 'a'.repeat(40) });
  deepEq(gh.rate, { limit: 5000, remaining: 4999, reset: 1 });
});

test('github : référence absente, dépôt vide, erreurs levées', async () => {
  const f = fakeFetch({ 'GET /repos/o/r/git/ref/heads/main': [409, { message: 'Git Repository is empty.' }], 'GET /user': [401, { message: 'Bad credentials' }] });
  const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: f });
  deepEq(await gh.getRef('main'), { empty: true });
  eq(await gh.getRef('autre'), null, '404 → null');
  deepEq(await gh.head('main'), { empty: true });
  const e = await throwsAsync(() => gh.user()); eq(e.code, 'auth'); eq(e.status, 401);
  const net = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: async () => { throw new TypeError('Failed to fetch'); } });
  eq((await throwsAsync(() => net.user())).code, 'network');
});

test('github : blobs base64 (avec retours à la ligne), binaires, lecture d’un fichier par chemin', async () => {
  const bin = new Uint8Array([0, 255, 1, 128, 10, 13]);
  const b64 = bytesToBase64(utf8('{"é":1}\n'));
  const f = fakeFetch({
    'GET /repos/o/r/git/blobs/b1': [200, { content: b64.slice(0, 4) + '\n' + b64.slice(4) + '\n', encoding: 'base64' }],
    'GET /repos/o/r/git/blobs/b2': [200, { content: bytesToBase64(bin), encoding: 'base64' }],
    'POST /repos/o/r/git/blobs': [201, { sha: 'new' }],
    'GET /repos/o/r/git/trees/root': [200, { tree: [{ path: 'donnees', type: 'tree', sha: 't1' }] }],
    'GET /repos/o/r/git/trees/t1': [200, { tree: [{ path: 'config', type: 'tree', sha: 't2' }] }],
    'GET /repos/o/r/git/trees/t2': [200, { tree: [{ path: 'equipe.json', type: 'blob', sha: 'b1' }] }]
  });
  const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: f });
  eq(fromUtf8(await gh.getBlob('b1')), '{"é":1}\n');
  deepEq([...await gh.getBlob('b2')], [...bin], 'binaire intact');
  eq((await gh.createBlob(bin)).sha, 'new');
  deepEq(f.calls[f.calls.length - 1].body, { content: bytesToBase64(bin), encoding: 'base64' });
  deepEq(await gh.readJSON('root', 'donnees/config/equipe.json'), { 'é': 1 });
  eq(await gh.readFile('root', 'donnees/config/absent.json'), null);
  eq(await gh.readFile('root', 'donnees/config/equipe.json/x'), null, 'un fichier n’a pas d’enfant');
});

test('github : commit atomique (textes dans l’arbre, binaires en blobs, arbres chaînés, référence sans forçage)', async () => {
  let trees = 0;
  const f = fakeFetch((key, call) => {
    if (key === 'POST /repos/o/r/git/blobs') return [201, { sha: 'blobsha' }];
    if (key === 'POST /repos/o/r/git/trees') { trees++; return [201, { sha: 'tree' + trees }]; }
    if (key === 'POST /repos/o/r/git/commits') return [201, { sha: 'c2' }];
    if (key === 'PATCH /repos/o/r/git/refs/heads/main') return [200, { object: { sha: 'c2' } }];
    return null;
  });
  const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: f });
  const files = [{ path: 'd/a.json', content: '{}\n' }, { path: 'd/m', bytes: new Uint8Array([1, 2]) }, { path: 'd/old.json', delete: true }];
  const res = await gh.commitFiles({ branch: 'main', parentSha: 'c1', baseTreeSha: 'base', files, message: 'msg' });
  deepEq(res, { commitSha: 'c2', treeSha: 'tree1', parentSha: 'c1' });
  const tree = f.calls.find(c => c.url.endsWith('/git/trees'));
  eq(tree.body.base_tree, 'base');
  deepEq(tree.body.tree, [{ path: 'd/a.json', mode: '100644', type: 'blob', content: '{}\n' }, { path: 'd/m', mode: '100644', type: 'blob', sha: 'blobsha' }, { path: 'd/old.json', mode: '100644', type: 'blob', sha: null }]);
  deepEq(f.calls.find(c => c.url.endsWith('/git/commits')).body, { message: 'msg', tree: 'tree1', parents: ['c1'] });
  deepEq(f.calls.find(c => c.method === 'PATCH').body, { sha: 'c2', force: false }, 'jamais de forçage');
  // Gros lot : plusieurs arbres chaînés par base_tree, un seul commit
  trees = 0;
  const many = Array.from({ length: 900 }, (_, i) => ({ path: `d/e${i}.json`, content: '{}\n' }));
  await gh.commitFiles({ branch: 'main', parentSha: 'c1', baseTreeSha: 'base', files: many, message: 'm' });
  const posts = f.calls.filter(c => c.url.endsWith('/git/trees')).slice(1);
  assert(posts.length >= 3, 'plusieurs lots');
  eq(posts[0].body.base_tree, 'base'); eq(posts[1].body.base_tree, 'tree1'); eq(posts[2].body.base_tree, 'tree2');
  eq(posts.reduce((s, p) => s + p.body.tree.length, 0), 900);
});

test('github : refus « non fast-forward » ⇒ relecture de la tête et nouvel essai', async () => {
  let head = 'c1', patches = 0;
  const f = fakeFetch((key, call) => {
    if (key === 'GET /repos/o/r/git/ref/heads/main') return [200, { object: { sha: head } }];
    if (key.startsWith('GET /repos/o/r/git/commits/')) return [200, { tree: { sha: 'tree-of-' + key.split('/').pop() } }];
    if (key === 'POST /repos/o/r/git/trees') return [201, { sha: 'nt' }];
    if (key === 'POST /repos/o/r/git/commits') return [201, { sha: 'new-' + call.body.parents[0] }];
    if (key === 'PATCH /repos/o/r/git/refs/heads/main') {
      patches++;
      if (patches === 1) { head = 'c9'; return [422, { message: 'Update is not a fast forward' }]; }   // un autre appareil a écrit
      return [200, { object: { sha: call.body.sha } }];
    }
    return null;
  });
  const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: f });
  const seen = [];
  const res = await gh.commitWithRetry({ branch: 'main', build: async h => { seen.push(h.sha + '/' + h.treeSha); return { files: [{ path: 'seq.json', content: String(seen.length) }], message: 'm' }; } });
  deepEq(seen, ['c1/tree-of-c1', 'c9/tree-of-c9'], 'plan recalculé sur la nouvelle tête');
  eq(res.commitSha, 'new-c9'); eq(res.attempts, 2);
  // Rien à écrire
  deepEq(await gh.commitWithRetry({ branch: 'main', build: async () => null }), { skipped: true, headSha: 'c9' });
  // Refus persistant : erreur après le nombre maximal d'essais
  const always = fakeFetch(key => key.startsWith('PATCH') ? [422, { message: 'Update is not a fast forward' }] : key.startsWith('GET /repos/o/r/git/ref') ? [200, { object: { sha: 'c' } }] : key.startsWith('GET') ? [200, { tree: { sha: 't' } }] : [201, { sha: 'x' }]);
  const e = await throwsAsync(() => createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: always }).commitWithRetry({ branch: 'main', maxAttempts: 2, build: async () => ({ files: [{ path: 'a', content: 'b' }], message: 'm' }) }));
  eq(e.code, 'conflict');
});

test('github : API Contents (amorçage d’un dépôt vide)', async () => {
  const f = fakeFetch({ 'PUT /repos/o/r/contents/donnees/config/equipe.json': [201, { commit: { sha: 'c1' } }] });
  const gh = createGitHub({ token: 't', owner: 'o', repo: 'r', fetch: f });
  await gh.putContents('donnees/config/equipe.json', utf8('{}\n'), 'init', { branch: 'main' });
  deepEq(f.calls[0].body, { message: 'init', content: bytesToBase64(utf8('{}\n')), branch: 'main' });
});
