/* Tests unitaires du socle (modules purs, exécutés dans le navigateur, sans Node) :
 * utilitaires (js/core/util.js : identifiants, dates, échappement HTML, JSON canonique, différences, distances,
 * base64, empreintes), chiffrement local (js/core/crypto.js : enveloppe de la clé de données, AES-GCM, sauvegarde
 * chiffrée par mot de passe), journal chaîné (js/core/store.js : trailHash / verifyTrail, sans IndexedDB) et
 * projection UTM 22N (js/lib/geo.js), saisies en cours (js/ui/dom.js : enregistrement différé, settleInput). Portage de tests/audit-unit.mjs (fiches-oeg) complété. */
import { test, assert, eq, deepEq, throwsAsync } from './harness.js';
import {
  uuid, localDate, localTime, localDateTime, fmtDate, fmtTime, fmtDateTime, fmtBytes, daysBetween, addDays, esc, html, raw, SafeHTML,
  canonicalJSON, sha256Hex, toHex, clone, debounce, normalize, groupBy, countBy, sortBy, truncate, haversine, fmtDistance, deepEqual, diff,
  compactValue, bytesToBase64, base64ToBytes, dataUrlToBytes
} from '../../js/core/util.js';
import {
  randomBytes, newDEKRaw, importDEK, wrapDEK, unwrapDEK, encryptBytes, decryptBytes, encryptJSON, decryptJSON, encryptWithPassword, decryptWithPassword
} from '../../js/core/crypto.js';
import { trailHash, verifyTrail, entityLabel, META_FIELDS, LOCAL_ONLY } from '../../js/core/store.js';
import { utmToLatLon, latLonToUtm, ecartGPS } from '../../js/lib/geo.js';
import { bindActions, settleInput, AUTOSAVE_DELAY } from '../../js/ui/dom.js';

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} attendu ${b} ± ${tol}, obtenu ${a}`);

/* ---------- Utilitaires ---------- */
test('utilitaires : JSON canonique, différences, échappement HTML, distance', () => {
  eq(canonicalJSON({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  eq(canonicalJSON({ a: undefined, b: null, c: [undefined] }), '{"b":null,"c":[null]}', 'undefined ignoré (objet) ou null (liste)');
  deepEq(diff({ a: 1, r: { x: 1 } }, { a: 2, r: { x: 1, y: 2 } }).map(d => d.path), ['a', 'r.y']);
  eq(String(html`<b>${'<script>'}</b>${raw('<i>ok</i>')}`), '<b>&lt;script&gt;</b><i>ok</i>');
  assert(Math.abs(haversine(4.93, -52.33, 4.94, -52.33) - 1112) < 5, 'haversine');
});

test('utilitaires : échappement HTML complet et gabarits imbriqués', () => {
  eq(esc(`<a href="x">l’"é'&</a>`), '&lt;a href=&quot;x&quot;&gt;l’&quot;é&#039;&amp;&lt;/a&gt;');
  eq(esc(null), ''); eq(esc(undefined), ''); eq(esc(0), '0');
  const items = ['<1>', '2'];
  const out = html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>${null}${false}${undefined}`;
  assert(out instanceof SafeHTML, 'html`` produit un SafeHTML');
  eq(String(out), '<ul><li>&lt;1&gt;</li><li>2</li></ul>');
  eq(String(raw(null)), '');
});

test('utilitaires : dates locales, formats français, écarts de jours', () => {
  const d = new Date(2026, 9, 8, 7, 5);   // 8 octobre 2026, 07:05 (heure locale)
  eq(localDate(d), '2026-10-08'); eq(localTime(d), '07:05'); eq(localDateTime(d), '2026-10-08T07:05');
  eq(fmtDate('2026-10-08'), '08/10/2026'); eq(fmtDate(''), ''); eq(fmtDate('n’importe quoi'), 'n’importe quoi');
  eq(fmtTime('08:30:15'), '08:30'); eq(fmtTime(''), '');
  eq(fmtDateTime('2026-10-08T08:30'), '08/10/2026 08:30');
  eq(daysBetween('2026-10-01', '2026-10-08'), 7); eq(daysBetween('2026-10-08', '2026-10-01'), -7);
  eq(daysBetween('2026-03-28', '2026-03-30'), 2, 'indépendant du changement d’heure');
  eq(addDays('2026-12-30', 3), '2027-01-02'); eq(addDays('2026-03-01', -1), '2026-02-28');
});

test('utilitaires : nombres, tailles, distances, troncature', () => {
  eq(fmtBytes(0), '0 o'); eq(fmtBytes(512), '512 o'); eq(fmtBytes(1536), '1,5 Ko'); eq(fmtBytes(5 * 1024 * 1024), '5,0 Mo');
  eq(fmtDistance(null), '—'); eq(fmtDistance(42.4), '42 m'); eq(fmtDistance(1234), '1,23 km');
  eq(truncate('abcdef', 4), 'abc…'); eq(truncate('abc', 4), 'abc'); eq(truncate(null), '');
});

test('utilitaires : normalisation, regroupements, tri français numérique', () => {
  eq(normalize('  Équipe Élève ÇA '), 'equipe eleve ca');
  const g = groupBy([{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }], x => x.k);
  deepEq([...g.keys()], ['a', 'b']); eq(g.get('a').length, 2);
  deepEq(countBy(['C', 'NC', 'C', 'NA'], x => x), { C: 2, NC: 1, NA: 1 });
  deepEq(sortBy([{ n: 'S10' }, { n: 'S2' }, { n: '' }, { n: 'S1' }], 'n').map(x => x.n), ['S1', 'S2', 'S10', '']);
  deepEq(sortBy([{ n: 1 }, { n: 3 }, { n: 2 }], '-n').map(x => x.n), [3, 2, 1]);
  deepEq(sortBy([{ a: 1, b: 2 }, { a: 1, b: 1 }, { a: 0, b: 9 }], 'a', x => x.b).map(x => x.b), [9, 1, 2]);
  const src = [{ n: 2 }, { n: 1 }];
  sortBy(src, 'n'); eq(src[0].n, 2, 'la liste d’origine n’est pas modifiée');
});

test('utilitaires : comparaison profonde, copie, différences de listes identifiées', () => {
  assert(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), 'ordre des clés indifférent');
  assert(!deepEqual({ a: 1 }, { a: '1' }), 'types différents');
  const o = { a: { b: [1, { c: 2 }] } }; const c = clone(o);
  c.a.b[1].c = 3; eq(o.a.b[1].c, 2, 'copie profonde'); eq(clone(undefined), undefined);
  const d = diff({ samples: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }], _rev: 1 }, { samples: [{ id: 's1', code: 'A2' }], _rev: 2 }, { ignore: ['_rev'] });
  deepEq(d.map(x => x.path), ['samples[s1].code', 'samples[s2]']);
  eq(d[1].after, undefined);
});

test('utilitaires : valeurs compactes du journal, base64, adresses data:', () => {
  eq(compactValue('data:image/png;base64,AAAA'), '[données 26 car.]');
  eq(compactValue('x'.repeat(500), 10), 'xxxxxxxxx…');
  deepEq(compactValue({ a: 1 }), { a: 1 }); eq(compactValue(undefined), undefined);
  const big = compactValue({ photo: 'data:image/jpeg;base64,' + 'A'.repeat(600) });
  assert(typeof big === 'string' && big.includes('[données]'), 'image remplacée dans un objet volumineux');
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  const b64 = bytesToBase64(bytes);
  deepEq(Array.from(base64ToBytes(b64)), Array.from(bytes), 'aller-retour base64 (grand tableau)');
  eq(bytesToBase64(new Uint8Array([0xc3, 0xa9])), 'w6k=');
  const u = dataUrlToBytes('data:image/png;base64,iVBORw==');
  eq(u.mime, 'image/png'); deepEq(Array.from(u.bytes), [0x89, 0x50, 0x4e, 0x47]);
  eq(dataUrlToBytes('data:,').mime, 'application/octet-stream');
});

test('utilitaires : empreintes SHA-256 et identifiants', async () => {
  eq(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  eq(await sha256Hex(new TextEncoder().encode('abc')), await sha256Hex('abc'), 'octets = texte');
  eq(await sha256Hex(new TextEncoder().encode('abc').buffer), await sha256Hex('abc'), 'ArrayBuffer');
  eq(toHex(new Uint8Array([0, 15, 255]).buffer), '000fff');
  const ids = new Set(Array.from({ length: 50 }, () => uuid()));
  eq(ids.size, 50, 'identifiants uniques');
  assert([...ids].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)), 'format UUID v4');
});

test('utilitaires : temporisation (debounce) avec envoi immédiat', async () => {
  const calls = [];
  const d = debounce(v => calls.push(v), 30);
  d(1); d(2); d(3);
  assert(d.pending(), 'appel en attente');
  d.flush(4);
  deepEq(calls, [4], 'flush exécute immédiatement');
  assert(!d.pending(), 'plus rien en attente');
  d(5);
  await new Promise(r => setTimeout(r, 60));
  deepEq(calls, [4, 5], 'dernier appel exécuté après le délai');
});

/* ---------- Chiffrement ---------- */
test('chiffrement : enveloppe de la clé de données (bon et mauvais mot de passe)', async () => {
  const dek = newDEKRaw();
  eq(dek.length, 32);
  const entry = await wrapDEK(dek, 'motdepasse-test', 1000);
  eq(entry.iterations, 1000); eq(entry.alg, 'PBKDF2-SHA256/AES-GCM-256');
  assert(!entry.wrapped.includes(bytesToBase64(dek)), 'la clé n’est jamais stockée en clair');
  deepEq(Array.from(await unwrapDEK(entry, 'motdepasse-test')), Array.from(dek), 'mot de passe correct');
  eq(await unwrapDEK(entry, 'mauvais'), null, 'mot de passe faux ⇒ null');
  const other = await wrapDEK(dek, 'motdepasse-test', 1000);
  assert(other.salt !== entry.salt && other.iv !== entry.iv, 'sel et vecteur aléatoires à chaque enveloppe');
});

test('chiffrement : données AES-GCM (aller-retour, vecteur unique, altération détectée)', async () => {
  const key = await importDEK(newDEKRaw());
  const obj = { id: 'a1', note: 'Crique « Athanase » — œuvre', n: [1, 2.5] };
  const a = await encryptJSON(key, obj), b = await encryptJSON(key, obj);
  eq(a.iv.length, 12);
  assert(bytesToBase64(a.iv) !== bytesToBase64(b.iv), 'vecteur d’initialisation unique');
  assert(bytesToBase64(a.ct) !== bytesToBase64(b.ct), 'chiffrés différents pour un même contenu');
  deepEq(await decryptJSON(key, a.iv, a.ct), obj);
  const tampered = a.ct.slice(); tampered[0] ^= 1;
  await throwsAsync(() => decryptJSON(key, a.iv, tampered), 'altération non détectée');
  const otherKey = await importDEK(newDEKRaw());
  await throwsAsync(() => decryptBytes(otherKey, a.iv, a.ct), 'mauvaise clé non détectée');
  const bin = randomBytes(300);
  const e = await encryptBytes(key, bin);
  deepEq(Array.from(await decryptBytes(key, e.iv, e.ct)), Array.from(bin), 'octets bruts (photos)');
});

test('chiffrement : sauvegarde chiffrée par mot de passe', async () => {
  const payload = await encryptWithPassword('sauvegarde-2026', '{"format":"test","é":"’"}');
  eq(payload.format, 'oeg-audit-backup-enc-v1'); eq(payload.kdf, 'PBKDF2-SHA256');
  eq(await decryptWithPassword('sauvegarde-2026', payload), '{"format":"test","é":"’"}');
  await throwsAsync(() => decryptWithPassword('mauvais', payload), 'mauvais mot de passe accepté');
});

/* ---------- Journal chaîné (sans IndexedDB) ---------- */
test('journal chaîné : toute altération est détectée', async () => {
  const entries = []; let prev = '';
  for (let i = 1; i <= 5; i++) { const e = { id: 'e' + i, seq: i, at: `2026-10-08T10:0${i}:00Z`, deviceId: 'd1', action: 'update', entityLabel: 'AUD-1', prevHash: prev }; e.hash = await trailHash(e); prev = e.hash; entries.push(e); }
  eq((await verifyTrail(entries)).ok, true);
  const altered = entries.map(e => ({ ...e })); altered[2].entityLabel = 'AUD-2';
  eq((await verifyTrail(altered)).ok, false);
  const removed = entries.filter(e => e.seq !== 3);
  const r = await verifyTrail(removed);
  eq(r.ok, false); assert(/manquante/.test(r.devices[0].breaks[0].reason), r.devices[0].breaks[0].reason);
  // L'empreinte ignore les champs techniques de synchronisation
  eq(await trailHash({ ...entries[0], _rev: 9, _lv: 3 }), entries[0].hash);
});

test('journal chaîné : plusieurs appareils, chaînage rompu, début inattendu', async () => {
  const chain = async (deviceId, n, startSeq = 1, prev = '') => {
    const out = [];
    for (let i = 0; i < n; i++) { const e = { id: `${deviceId}-${i}`, seq: startSeq + i, at: `2026-10-08T11:0${i}:00Z`, deviceId, deviceName: 'Tablette ' + deviceId, action: 'create', prevHash: prev }; e.hash = await trailHash(e); prev = e.hash; out.push(e); }
    return out;
  };
  const a = await chain('A', 3), b = await chain('B', 2);
  const r = await verifyTrail([...b, ...a].reverse());
  eq(r.ok, true, 'ordre indifférent, appareils séparés');
  eq(r.devices.length, 2); deepEq(r.devices.map(d => d.count).sort(), [2, 3]);
  eq(r.devices.find(d => d.deviceId === 'A').deviceName, 'Tablette A');
  // Chaînage rompu : entrée recalculée avec une autre empreinte précédente
  const broken = a.map(e => ({ ...e }));
  broken[2].prevHash = 'x'; broken[2].hash = await trailHash(broken[2]);
  assert((await verifyTrail(broken)).devices[0].breaks.some(x => /chaînage rompu/.test(x.reason)), 'chaînage rompu détecté');
  // Début de chaîne inattendu (n° 3 sans empreinte précédente)
  const orphan = await chain('C', 1, 3);
  assert((await verifyTrail(orphan)).devices[0].breaks.some(x => /début de chaîne/.test(x.reason)), 'début inattendu détecté');
});

test('dépôt de données : libellés d’entités et types locaux', () => {
  eq(entityLabel('audit', { id: 'x', number: 'AUD-2026-000001', name: 'n' }), 'AUD-2026-000001');
  eq(entityLabel('operator', { id: 'op', lastName: 'Martin', firstName: 'Léa' }), 'Martin Léa');
  eq(entityLabel('site', { id: 'site-1' }), 'site-1');
  eq(entityLabel('site', null), '');
  for (const t of ['conflict', 'syncLog', 'localSecret', 'syncBase']) assert(LOCAL_ONLY.has(t), `${t} jamais envoyé`);
  assert(!LOCAL_ONLY.has('audit'));
  assert(META_FIELDS.includes('_rev') && META_FIELDS.includes('updatedAt'));
});

/* ---------- Projection UTM 22N (RGFG95) ---------- */
test('géographie : UTM 22N ↔ latitude / longitude (station ATHANASE) et écart GPS', () => {
  const [lat, lon] = utmToLatLon(356714, 465112, 22);
  near(lat, 4.2066, 0.002, 'latitude ATHANASE'); near(lon, -52.29, 0.005, 'longitude ATHANASE');
  const [x, y] = latLonToUtm(lat, lon, 22);
  near(x, 356714, 0.5, 'aller-retour X'); near(y, 465112, 0.5, 'aller-retour Y');
  const [lat2, lon2] = utmToLatLon(...latLonToUtm(4.93, -52.33));
  near(lat2, 4.93, 1e-6); near(lon2, -52.33, 1e-6);
  eq(ecartGPS(356714, 465112, 356714 + 30, 465112 + 40), 50);
  // Cohérence avec la distance orthodromique sur une courte distance
  const [la, lo] = utmToLatLon(356714 + 300, 465112 + 400);
  near(haversine(lat, lon, la, lo), 500, 3, 'UTM vs haversine');
});

/* ---------- Saisies en cours : enregistrement différé et validation avant verrouillage (js/ui/dom.js) ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
function sandbox(markup) {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}

test('saisie en cours : enregistrement différé (data-autosave) pendant la frappe, exécuté au démontage', async () => {
  const root = sandbox('<textarea data-autosave data-change="save"></textarea><textarea id="u-plain" data-change="save"></textarea>');
  const calls = [];
  const unbind = bindActions(root, { save(el) { calls.push(el.value); } });
  try {
    const [auto, plain] = root.querySelectorAll('textarea');
    auto.value = 'Obs'; auto.dispatchEvent(new Event('input', { bubbles: true }));
    plain.value = 'x'; plain.dispatchEvent(new Event('input', { bubbles: true }));
    eq(calls.length, 0, 'rien avant le délai');
    auto.value = 'Observation'; auto.dispatchEvent(new Event('input', { bubbles: true }));   // la frappe reporte l'échéance
    await wait(AUTOSAVE_DELAY + 300);
    deepEq(calls, ['Observation'], 'un seul enregistrement après une pause de frappe ; champ ordinaire : à la sortie');
    auto.value = 'Observation complète'; auto.dispatchEvent(new Event('input', { bubbles: true }));
    auto.dispatchEvent(new Event('change', { bubbles: true }));                               // sortie du champ
    await wait(AUTOSAVE_DELAY + 300);
    deepEq(calls, ['Observation', 'Observation complète'], '« change » annule l’enregistrement différé en attente');
    auto.value = 'Avant changement d’écran'; auto.dispatchEvent(new Event('input', { bubbles: true }));
  } finally { unbind(); root.remove(); }
  eq(calls.at(-1), 'Avant changement d’écran', 'démontage de la vue : enregistrement différé exécuté, pas abandonné');
});

test('saisie en cours : settleInput valide le champ actif, exécute les enregistrements différés et attend les gestionnaires', async () => {
  const root = sandbox('<textarea id="u-active" data-change="save"></textarea><textarea id="u-auto" data-autosave data-change="slow"></textarea><button data-act="never">x</button>');
  const calls = [];
  const unbind = bindActions(root, {
    save(el) { calls.push('save:' + el.value); },
    async slow(el) { await wait(150); calls.push('slow:' + el.value); },
    never() { return new Promise(() => {}); }   // gestionnaire en attente d'une réponse (fenêtre de confirmation)
  });
  try {
    const auto = root.querySelector('#u-auto');
    auto.value = 'différé'; auto.dispatchEvent(new Event('input', { bubbles: true }));
    const active = root.querySelector('#u-active');
    active.focus();
    document.execCommand('insertText', false, 'en cours de frappe');   // saisie « utilisateur » : « change » à la perte du focus
    eq(document.activeElement, active);
    root.querySelector('[data-act=never]').click();
    const t0 = performance.now();
    await settleInput({ timeout: 600 });
    const ms = performance.now() - t0;
    assert(document.activeElement !== active, 'champ actif quitté (blur)');
    assert(calls.includes('save:en cours de frappe'), `champ actif enregistré : ${calls}`);
    assert(calls.includes('slow:différé'), `enregistrement différé exécuté et attendu : ${calls}`);
    assert(ms >= 140 && ms < 2000, `attente des gestionnaires bornée par timeout (${Math.round(ms)} ms)`);
    const n = calls.length;
    await settleInput({ timeout: 50 });
    eq(calls.length, n, 'rien à refaire');
  } finally { unbind(); root.remove(); }
});
