/* Harnais minimal des tests unitaires exécutés dans le navigateur (aucune dépendance, aucun Node).
 * Chaque fichier de tests importe { test, assert, eq, deepEq, throwsAsync } et déclare ses tests ;
 * tests/unit/index.html les exécute (via all.js) et publie le résultat sur window.__UNIT_RESULTS__. */

const registry = [];
let currentFile = '';

/** Déclare un test (fn peut être asynchrone). */
export function test(name, fn) { registry.push({ name, fn, file: currentFile }); }

export function assert(cond, msg = 'assertion fausse') { if (!cond) throw new Error(msg); }

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg ? msg + ' — ' : ''}attendu ${fmt(expected)}, obtenu ${fmt(actual)}`);
}

export function deepEq(actual, expected, msg = '') {
  const a = canonical(actual), b = canonical(expected);
  if (a !== b) throw new Error(`${msg ? msg + ' — ' : ''}attendu ${b}, obtenu ${a}`);
}

export async function throwsAsync(fn, msg = 'une erreur était attendue') {
  try { await fn(); } catch (e) { return e; }
  throw new Error(msg);
}

function fmt(v) { try { return typeof v === 'string' ? JSON.stringify(v) : canonical(v); } catch (e) { return String(v); } }
function canonical(v) {
  if (v === undefined) return 'undefined';
  return JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val))
    ? Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
}

/** Charge un fichier de tests (les tests déclarés pendant l'import lui sont rattachés). */
export async function load(file) {
  currentFile = file;
  try { await import(new URL(file, import.meta.url).href); return null; }
  catch (e) { return e; } finally { currentFile = ''; }
}

/** Exécute tous les tests déclarés ; `loadErrors` : [{ file, error }] (fichier absent ou en erreur). */
export async function run({ loadErrors = [], onResult = () => {} } = {}) {
  const failures = loadErrors.map(({ file, error }) => ({ name: `chargement de ${file}`, error: String(error?.message || error) }));
  failures.forEach(f => onResult({ ...f, ok: false }));
  let passed = 0;
  for (const t of registry) {
    try { await t.fn(); passed++; onResult({ name: t.name, file: t.file, ok: true }); }
    catch (e) { const f = { name: `${t.file} › ${t.name}`, error: String(e?.stack || e?.message || e) }; failures.push(f); onResult({ ...f, ok: false }); }
  }
  return { done: true, passed, failed: failures.length, failures };
}
