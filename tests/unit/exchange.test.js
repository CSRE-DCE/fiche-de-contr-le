/* Tests unitaires de l'échange par fichier entre tablettes (sans IndexedDB : modules purs et WebCrypto) :
 *  - format du fichier .oegct (js/app/exchange-file.js) : texte ASCII, en-tête, chiffrement AES-GCM avec le mot de
 *    passe d'échange, compression, médias joints ; mauvais mot de passe, fichier altéré, empreinte SHA-256 incorrecte
 *    (corps ou média), version plus récente, fichier qui n'est pas un fichier d'échange ;
 *  - versions et réception (js/domain/exchange.js) : vecteurs de versions, décision de réception (ajout, déjà connue,
 *    plus récente, fusion à trois versions avec la dernière version commune, conflit réel), tournée signée gardée
 *    scellée, deux tablettes simulées (fichiers croisés d'un binôme, fichier ancien, suppression, idempotence) ;
 *  - envoi « depuis le dernier envoi » ou « tout » (selectForSend) ;
 *  - règle de sécurité des profils (guardProfile) ; nom du fichier, n° de tablette libre, libellés ;
 *  - invariants : `_vv` métadonnée, types propres à la tablette jamais échangés, empreinte scellée indépendante des versions. */
import { test, assert, eq, deepEq, throwsAsync } from './harness.js';
import {
  encodeExchange, decodeExchange, packExchange, packPlain, sealExchange, readHeader, isExchangeText, ExchangeError, EXCHANGE_MAGIC
} from '../../js/app/exchange-file.js';
import {
  vvLeq, vvMax, vvBump, vvCompare, vvOf, planEntity, chooseBase, nextCandidates, guardProfile, heldLabel, selectForSend,
  exchangeFileName, freeDeviceNumber, countEntities, countsLabel, sameContent, content
} from '../../js/domain/exchange.js';
import { KDF_ITERATIONS } from '../../js/core/crypto.js';
import { deepEqual, clone } from '../../js/core/util.js';
import { META_FIELDS, LOCAL_ONLY, LAZY_TYPES } from '../../js/core/store.js';
import { auditContentHash } from '../../js/app/audits.js';
import { mergeEntity } from '../../js/domain/merge.js';

const PW = 'echange-equipe-test', FAST = { iterations: 2000 };
const bytes = (...v) => new Uint8Array(v);
const body = () => ({ id: 'f1', createdAt: '2026-10-13T20:00:00.000Z', scope: 'changes', from: { id: 'T1', name: 'Tablette 1', number: 1 }, sentBy: { id: 'u-a', name: 'Alice Dupont', role: 'admin' },
  entities: { audit: [{ id: 'a1', number: 'AUD-2026-010001', responses: { 'it-1': { status: 'C', at: '2026-10-13T10:00:00Z', by: 'u-a' } }, _vv: { T1: 3 } }], trail: [{ id: 't1', seq: 1, hash: 'h' }] } });
/** Remplace un caractère du contenu chiffré (base64) du fichier. */
function flip(text, at = 40) {
  const { payload } = readHeader(text);
  const start = text.length - payload.length;
  const i = start + at, c = text[i];
  return text.slice(0, i) + (c === 'A' ? 'B' : 'A') + text.slice(i + 1);
}
const code = async (fn) => { const e = await throwsAsync(fn, 'une erreur était attendue'); assert(e instanceof ExchangeError, 'ExchangeError attendue : ' + e); return e.code; };

/* ---------- Format du fichier ---------- */
test('fichier .oegct : texte ASCII, en-tête non secret, chiffré, relu à l’identique avec ses médias', async () => {
  const photo = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
  const { text, core } = await encodeExchange(body(), [{ id: 'm1', bytes: photo }], PW);
  assert(isExchangeText(text) && text.startsWith(EXCHANGE_MAGIC + ' 1\n'), 'première ligne « OEG-CT-ECHANGE 1 »');
  assert(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), 'fichier texte ASCII (traverse e-mail, Teams, Quick Share…)');
  const { header, payload } = readHeader(text);
  eq(header.format, 'oeg-ct-echange'); eq(header.kdf, 'PBKDF2-SHA256'); eq(header.iterations, KDF_ITERATIONS, 'dérivation PBKDF2 de js/core/crypto.js');
  assert(header.salt && header.iv && header.check?.ct, 'sel, vecteur d’initialisation, contrôle du mot de passe');
  assert(payload.split('\n').filter(Boolean).every(l => l.length <= 76), 'lignes de 76 caractères au plus');
  assert(!text.includes('AUD-2026-010001') && !text.includes('Alice'), 'aucune donnée en clair');
  const { body: b, media } = await decodeExchange(text, PW);
  eq(b.sha256, core.sha256, 'empreinte SHA-256 du corps'); eq(b.sha256.length, 64);
  deepEq(b.entities, body().entities, 'données intactes');
  eq(b.from.name, 'Tablette 1'); eq(b.media[0].id, 'm1'); eq(b.media[0].size, 3000);
  assert(deepEqual([...media.get('m1')], [...photo]), 'photo intacte');
  // Retours à la ligne transformés en CRLF (messagerie) : toujours lisible.
  const crlf = await decodeExchange(text.replace(/\n/g, '\r\n'), PW);
  eq(crlf.body.sha256, core.sha256);
});

test('fichier .oegct : corps compressé ou non, médias multiples', async () => {
  for (const compress of [true, false]) {
    const { plain, core } = await packExchange(body(), [{ id: 'a', bytes: bytes(1, 2, 3) }, { id: 'b', bytes: bytes() }, { id: 'c', bytes: bytes(9) }], { compress });
    const text = await sealExchange(plain, PW, { ...FAST, compressed: compress });
    eq(readHeader(text).header.z, compress ? 'gzip' : null);
    const { body: b, media } = await decodeExchange(text, PW);
    eq(b.sha256, core.sha256);
    deepEq([...media.keys()], ['a', 'b', 'c']); deepEq([...media.get('a')], [1, 2, 3]); eq(media.get('b').length, 0);
  }
});

test('fichier .oegct : mauvais mot de passe d’échange refusé (code « password »), rien n’est lu', async () => {
  const { text } = await encodeExchange(body(), [], PW, FAST);
  eq(await code(() => decodeExchange(text, 'autre-mot-de-passe')), 'password');
  eq(await code(() => decodeExchange(text, '')), 'password');
  eq((await decodeExchange(text, PW)).body.id, 'f1');
});

test('fichier .oegct : contenu altéré refusé (code « altered ») ; empreinte incorrecte (code « integrity »)', async () => {
  const { text } = await encodeExchange(body(), [{ id: 'm', bytes: bytes(1, 2, 3, 4) }], PW, FAST);
  eq(await code(() => decodeExchange(flip(text), PW)), 'altered', 'un caractère changé : l’authentification AES-GCM échoue');
  eq(await code(() => decodeExchange(text.slice(0, -200), PW)), 'altered', 'fichier tronqué');
  // Corps dont l'empreinte ne correspond pas (fichier fabriqué avec le bon mot de passe mais modifié avant chiffrement)
  const { core } = await packExchange(body(), [], { compress: false });
  const forged = { ...core, entities: { ...core.entities, audit: [{ ...core.entities.audit[0], number: 'AUD-FALSIFIE' }] } };
  const plain = await packPlain(forged, [], { compress: false });
  eq(await code(async () => decodeExchange(await sealExchange(plain, PW, FAST), PW)), 'integrity', 'empreinte du corps vérifiée');
  // Média modifié (empreinte SHA-256 du média)
  const pk = await packExchange(body(), [{ id: 'm', bytes: bytes(1, 2, 3, 4) }], { compress: false });
  pk.plain[pk.plain.length - 1] ^= 0xff;
  eq(await code(async () => decodeExchange(await sealExchange(pk.plain, PW, FAST), PW)), 'integrity', 'empreinte de chaque média vérifiée');
});

test('fichier .oegct : autre fichier, version plus récente', async () => {
  eq(await code(() => decodeExchange('{"format":"oeg-audit-package-v1"}', PW)), 'format');
  eq(await code(() => decodeExchange('n’importe quoi', PW)), 'format');
  const { text } = await encodeExchange(body(), [], PW, FAST);
  eq(await code(() => decodeExchange(text.replace(EXCHANGE_MAGIC + ' 1', EXCHANGE_MAGIC + ' 9'), PW)), 'version');
  eq(await code(() => decodeExchange(text.split('\n')[0] + '\n{pas du json\n', PW)), 'altered');
  assert(!isExchangeText('{"a":1}') && isExchangeText('  ' + text));
});

/* ---------- Versions ---------- */
test('vecteurs de versions : contenance, maximum, incrément, comparaison', () => {
  assert(vvLeq({ A: 1 }, { A: 2, B: 1 }) && !vvLeq({ A: 3 }, { A: 2, B: 1 }) && vvLeq({}, { A: 1 }));
  deepEq(vvMax({ A: 1, B: 4 }, { A: 3 }), { A: 3, B: 4 });
  deepEq(vvBump({ A: 1 }, 'B'), { A: 1, B: 1 }); deepEq(vvBump({ A: 1 }, 'A'), { A: 2 });
  eq(vvCompare({ A: 1 }, { A: 1 }), 'equal'); eq(vvCompare({ A: 1 }, { A: 2 }), 'older'); eq(vvCompare({ A: 2, B: 1 }, { A: 2 }), 'newer');
  eq(vvCompare({ A: 2 }, { B: 1 }), 'concurrent'); deepEq(vvOf({}), {}); deepEq(vvOf(null), {});
});

const audit = (vv, responses, extra = {}) => ({ id: 'a1', number: 'AUD-2026-010001', status: 'en_cours', responses, _vv: vv, updatedAt: '2026-10-13T10:00:00Z', ...extra });
const r = (status, at, by = 'u-a') => ({ status, at, by, byName: by });

test('réception : ajout, déjà connue (fichier ancien ou reçu deux fois), plus récente, même contenu', () => {
  const v1 = audit({ T1: 1 }, { x: r('C', 't1') }), v2 = audit({ T1: 2 }, { x: r('NC', 't2') });
  eq(planEntity('audit', null, v1).action, 'add');
  const old = planEntity('audit', v2, v1);
  eq(old.action, 'known', 'fichier ancien : ignoré'); eq(old.result, null, 'jamais d’écrasement d’une saisie plus récente');
  eq(planEntity('audit', v2, v2).action, 'known', 'même version : rien à faire (idempotent)');
  const up = planEntity('audit', v1, v2);
  eq(up.action, 'replace'); eq(up.result.responses.x.status, 'NC'); eq(up.outbox, 'clear', 'plus rien à renvoyer : l’autre tablette a cette version');
  const same = planEntity('audit', audit({ T2: 1 }, { x: r('C', 't1') }), audit({ T1: 1 }, { x: r('C', 't1') }));
  eq(same.action, 'same'); deepEq(same.result._vv, { T1: 1, T2: 1 }, 'versions réunies');
  // Données antérieures aux vecteurs de versions : comparaison du contenu.
  eq(planEntity('audit', audit(undefined, { x: r('C', 't1') }), audit(undefined, { x: r('C', 't1') })).action, 'same');
});

test('réception : modifications concurrentes fusionnées champ par champ avec la dernière version commune', () => {
  const base = audit({ T1: 1 }, { x: { value: 'pré-rempli', prefilled: true }, y: { value: 'pré-rempli', prefilled: true } });
  const local = audit({ T1: 2 }, { ...base.responses, x: r('C', '2026-10-13T11:00:00Z', 'u-a') });
  const remote = audit({ T1: 1, T2: 1 }, { ...base.responses, y: r('NC', '2026-10-13T11:05:00Z', 'u-b') });
  const cands = nextCandidates([], base, { dir: 'envoyée' });
  eq(chooseBase(cands, local, remote).data.responses.x.value, 'pré-rempli', 'version envoyée le matin = version commune');
  const p = planEntity('audit', local, remote, { candidates: cands, deviceId: 'T1' });
  eq(p.action, 'merge'); eq(p.base, 'commune'); eq(p.conflicts.length, 0, 'saisies sur des critères différents : aucun conflit');
  eq(p.result.responses.x.by, 'u-a'); eq(p.result.responses.y.by, 'u-b', 'saisies des deux agents présentes et attribuées');
  deepEq(p.result._vv, { T1: 3, T2: 1 }, 'nouvelle version, contenant les deux'); eq(p.outbox, 'set', 'fusion à renvoyer');
  // Même critère modifié des deux côtés : conflit conservé, la plus récente retenue.
  const l2 = audit({ T1: 2 }, { ...base.responses, x: r('C', '2026-10-13T11:00:00Z', 'u-a') });
  const r2 = audit({ T1: 1, T2: 1 }, { ...base.responses, x: r('NC', '2026-10-13T12:00:00Z', 'u-b') });
  const c = planEntity('audit', l2, r2, { candidates: cands, deviceId: 'T1' });
  assert(c.conflicts.length > 0 && c.conflicts.some(d => d.path.includes('x')), 'conflit réel tracé');
  eq(c.result.responses.x.status, 'NC', 'valeur la plus récente retenue');
});

test('réception : tournée signée d’un seul côté gardée telle quelle (scellé intact), l’autre version dans le rapport', () => {
  const lock = { lockedAt: '2026-10-13T16:00:00Z', contentHash: 'abc' };
  const signedRemote = audit({ T1: 1, T2: 5 }, { x: r('C', 't') }, { lock, status: 'signe' });
  const localEdit = audit({ T1: 2 }, { x: r('C', 't'), z: r('NC', 't9') });
  const p = planEntity('audit', localEdit, signedRemote, { deviceId: 'T1' });
  eq(p.action, 'signed'); deepEq(content(p.result), content(signedRemote), 'contenu signé inchangé');
  assert(p.conflicts.some(c => c.path.startsWith('responses.z') && c.kept === 'remote'), 'saisie locale conservée dans le rapport');
  const q = planEntity('audit', signedRemote, localEdit, { deviceId: 'T2' });
  eq(q.action, 'signed'); deepEq(content(q.result), content(signedRemote)); eq(q.outbox, 'set', 'version signée à renvoyer à l’autre tablette');
});

/* ---------- Deux tablettes simulées ---------- */
/** Tablette simulée : mêmes règles que js/core/store.js (versions, file d'envoi) et js/app/exchange.js (réception). */
class Tablet {
  constructor(id) { Object.assign(this, { id, data: new Map(), outbox: new Map(), bases: new Map(), conflicts: [], clock: 0 }); }
  get(type, id) { return this.data.get(type + ':' + id) || null; }
  put(type, e) {
    const prev = this.get(type, e.id);
    const next = { ...clone(e), _vv: vvBump(prev ? prev._vv : e._vv, this.id), updatedAt: `2026-10-13T1${this.clock++}:00:00Z` };
    this.data.set(type + ':' + e.id, next); this.outbox.set(type + ':' + e.id, { at: next.updatedAt });
    return next;
  }
  send(scope = 'changes') {
    const sel = selectForSend({ scope, outbox: [...this.outbox], types: ['audit'], getRaw: (t, id) => this.get(t, id), allOf: t => [...this.data.entries()].filter(([k]) => k.startsWith(t + ':')).map(([, v]) => v) });
    for (const s of sel.sent) if (this.outbox.get(s.key)?.at === s.at) this.outbox.delete(s.key);
    for (const [t, list] of Object.entries(sel.entities)) for (const e of list) this.bases.set(t + ':' + e.id, nextCandidates(this.bases.get(t + ':' + e.id), e, { dir: 'envoyée' }));
    return clone(sel.entities);
  }
  receive(entities) {
    const actions = [];
    for (const [type, list] of Object.entries(entities)) for (const remote of list) {
      const key = type + ':' + remote.id, cands = this.bases.get(key) || [];
      const p = planEntity(type, this.get(type, remote.id), remote, { candidates: cands, deviceId: this.id });
      actions.push(p.action);
      if (p.action === 'known') continue;
      if (p.result) this.data.set(key, p.result);
      if (p.outbox === 'set') this.outbox.set(key, { at: 'fusion' }); else if (p.outbox === 'clear') this.outbox.delete(key);
      this.bases.set(key, nextCandidates(cands, remote, { dir: 'reçue' }));
      this.conflicts.push(...p.conflicts);
    }
    return actions;
  }
}

test('deux tablettes : binôme, fichiers croisés, saisies des deux agents réunies sans conflit ; double réception sans effet', () => {
  const t1 = new Tablet('T1'), t2 = new Tablet('T2');
  t1.put('audit', audit(undefined, { x: { value: 'A. Dupont, B. Martin', prefilled: true }, y: { value: 'v', prefilled: true } }));
  const f0 = t1.send();                                  // le matin : la tournée part sur la tablette 2
  deepEq(t2.receive(f0), ['add']);
  // Saisies simultanées : A sur la tablette 1, B sur la tablette 2 ; les deux envoient en même temps (fichiers croisés).
  t1.put('audit', { ...t1.get('audit', 'a1'), responses: { ...t1.get('audit', 'a1').responses, x: r('C', '2026-10-13T11:00:00Z', 'u-a') } });
  t2.put('audit', { ...t2.get('audit', 'a1'), responses: { ...t2.get('audit', 'a1').responses, y: r('NC', '2026-10-13T11:02:00Z', 'u-b') } });
  const f1 = t1.send(), g1 = t2.send();
  deepEq(t1.receive(g1), ['merge']); deepEq(t2.receive(f1), ['merge']);
  eq(t1.conflicts.length + t2.conflicts.length, 0, 'aucun conflit');
  assert(sameContent(t1.get('audit', 'a1'), t2.get('audit', 'a1')), 'même contenu sur les deux tablettes');
  eq(t1.get('audit', 'a1').responses.x.by, 'u-a'); eq(t1.get('audit', 'a1').responses.y.by, 'u-b');
  // Recevoir deux fois le même fichier, ou un fichier ancien : rien ne change.
  const before = clone(t2.get('audit', 'a1'));
  deepEq(t2.receive(f1), ['known']); deepEq(t2.receive(f0), ['known']);
  deepEq(t2.get('audit', 'a1'), before, 'idempotent');
  // Les fusions repartent ; une fois reçues, les deux tablettes ont la même version.
  t2.receive(t1.send()); t1.receive(t2.send());
  assert(sameContent(t1.get('audit', 'a1'), t2.get('audit', 'a1')));
  eq(t1.send().audit, undefined, 'plus rien à envoyer');
});

test('deux tablettes : fichier ancien reçu après un plus récent, suppression propagée', () => {
  const t1 = new Tablet('T1'), t2 = new Tablet('T2');
  t1.put('audit', audit(undefined, { x: r('C', 't1') }));
  const f1 = t1.send();
  t1.put('audit', { ...t1.get('audit', 'a1'), responses: { x: r('NC', 't2') } });
  const f2 = t1.send();
  t2.receive(f2); deepEq(t2.receive(f1), ['known']);
  eq(t2.get('audit', 'a1').responses.x.status, 'NC', 'le fichier ancien n’écrase pas la saisie plus récente');
  t1.put('audit', { ...t1.get('audit', 'a1'), _deleted: true, deleteReason: 'doublon' });
  t2.receive(t1.send());
  eq(t2.get('audit', 'a1')._deleted, true, 'pierre tombale reçue : suppression propagée');
});

test('envoi : modifications depuis le dernier envoi par défaut, tout sur demande', () => {
  const outbox = [['audit:a1', { at: '1' }], ['user:u1', { at: '2' }], ['trail:t1', { at: '3' }], ['__bin:m1', { at: '4' }], ['localSecret:x', { at: '5' }]];
  const data = { 'audit:a1': { id: 'a1', _lv: 4, _rev: 'sha' }, 'audit:a2': { id: 'a2' }, 'user:u1': { id: 'u1' }, 'trail:t1': { id: 't1' }, 'media:m2': { id: 'm2' } };
  const getRaw = (t, id) => data[t + ':' + id] || null, allOf = t => Object.entries(data).filter(([k]) => k.startsWith(t + ':')).map(([, v]) => v);
  const types = ['audit', 'user', 'trail', 'media'];
  const s = selectForSend({ outbox, types, getRaw, allOf, mediaIds: ['m1', 'm2'] });
  deepEq(Object.keys(s.entities).sort(), ['audit', 'trail', 'user']); eq(s.entities.audit.length, 1, 'seulement la tournée modifiée');
  assert(!('_lv' in s.entities.audit[0]) && !('_rev' in s.entities.audit[0]), 'métadonnées propres à la tablette retirées');
  deepEq(s.media, ['m1'], 'photos pas encore envoyées'); assert(!s.entities.localSecret, 'jamais de secret');
  deepEq(s.sent.map(x => x.key).sort(), ['audit:a1', 'localSecret:x', 'trail:t1', 'user:u1']);
  eq(selectForSend({ outbox: [], types, getRaw, allOf }).entities.audit, undefined, 'rien de nouveau : rien à envoyer');
  const all = selectForSend({ scope: 'all', media: 'all', outbox, types, getRaw, allOf, mediaIds: ['m1', 'm2'] });
  eq(all.entities.audit.length, 2, '« Tout envoyer »'); deepEq(all.media.sort(), ['m1', 'm2']);
  deepEq(selectForSend({ scope: 'all', media: 'unsent', outbox, types, getRaw, allOf, mediaIds: ['m1', 'm2'] }).media, ['m1'], 'sans les photos déjà envoyées');
  deepEq(selectForSend({ outbox, types, getRaw, allOf, media: 'none' }).media, [], 'photos au prochain envoi');
});

/* ---------- Profils ---------- */
test('profils : élévation de rôle, nouvel administrateur ou désactivation en attente sauf fichier d’un administrateur', () => {
  const agent = { id: 'u1', name: 'Bruno Martin', role: 'auditeur', active: true };
  let g = guardProfile(agent, { ...agent, role: 'admin' }, { trusted: false });
  eq(g.result.role, 'auditeur', 'rôle inchangé'); deepEq(g.held, [{ field: 'role', from: 'auditeur', to: 'admin' }]);
  eq(heldLabel(g.held[0], { auditeur: 'Auditeur', admin: 'Administrateur' }), 'Profil : Auditeur → Administrateur');
  g = guardProfile(null, { id: 'u9', name: 'Inconnu', role: 'admin' }, { trusted: false });
  eq(g.result.role, 'auditeur', 'aucun administrateur créé à l’insu de la tablette'); eq(g.held.length, 1);
  g = guardProfile(agent, { ...agent, active: false }, { trusted: false });
  eq(g.result.active, true); eq(g.held[0].field, 'active');
  g = guardProfile(agent, { ...agent, _deleted: true, deletedAt: 'x' }, { trusted: false });
  assert(!g.result._deleted && !g.result.deletedAt && g.held[0].field === '_deleted');
  g = guardProfile(agent, { ...agent, name: 'Bruno Martin-Durand', initials: 'BMD' }, { trusted: false });
  eq(g.held.length, 0, 'nom et initiales : appliqués'); eq(g.result.name, 'Bruno Martin-Durand');
  g = guardProfile(agent, { ...agent, role: 'superviseur' }, { trusted: true });
  eq(g.result.role, 'superviseur', 'fichier envoyé par un administrateur de la tablette : appliqué'); eq(g.held.length, 0);
  eq(guardProfile(null, { id: 'u9', role: 'admin' }, { trusted: true }).result.role, 'admin');
  const admin = { id: 'u0', name: 'Alice', role: 'admin', active: true };
  g = guardProfile(admin, { ...admin, role: 'auditeur' }, { trusted: true, lastAdmin: true });
  eq(g.result.role, 'admin', 'jamais le dernier administrateur de la tablette, même d’un administrateur'); eq(g.held.length, 1);
  eq(guardProfile(admin, { ...admin, role: 'auditeur' }, { trusted: true, lastAdmin: false }).result.role, 'auditeur');
});

/* ---------- Nom du fichier, tablettes, libellés ---------- */
test('nom du fichier, n° de tablette libre, décomptes', () => {
  eq(exchangeFileName('Tablette 1', new Date(2026, 9, 3, 7, 5)), 'OEG-echange_Tablette-1_2026-10-03_07h05.oegct');
  eq(exchangeFileName('Équipe Nord / bis', new Date(2026, 0, 1, 17, 30)), 'OEG-echange_Equipe-Nord-bis_2026-01-01_17h30.oegct');
  eq(exchangeFileName('', new Date(2026, 0, 1)), 'OEG-echange_tablette_2026-01-01_00h00.oegct');
  eq(freeDeviceNumber([{ number: 1 }]), 2); eq(freeDeviceNumber([{ number: 2 }, { number: 1 }, { number: 4 }]), 3); eq(freeDeviceNumber([]), 1);
  const c = countEntities({ audit: [{}, {}], user: [{}], trail: [{}, {}, {}], site: [{}], media: [{}] });
  deepEq(c, { total: 5, byType: { audit: 2, user: 1, site: 1, media: 1 }, journal: 3 });
  eq(countsLabel(c.byType, { media: 1 }), '2 tournées, 1 agent, 1 autre élément, 1 photo ou document');
  eq(countsLabel({ site: 3 }), '3 éléments');
});

/* ---------- Invariants du stockage et du scellé ---------- */
test('stockage : versions hors contenu, éléments propres à la tablette jamais échangés, scellé indépendant des versions', async () => {
  assert(META_FIELDS.includes('_vv'), '_vv : métadonnée (ignorée par les comparaisons et le journal)');
  for (const t of ['localSecret', 'exchangeLog', 'heldChange', 'conflict', 'syncBase']) assert(LOCAL_ONLY.has(t), `${t} jamais envoyé`);
  assert(LAZY_TYPES.has('xbase') && !LOCAL_ONLY.has('user') && !LOCAL_ONLY.has('trail'));
  const a = { id: 'a-seal', number: 'AUD-2026-020001', auditType: 'ce', stations: [], responses: { x: r('C', 't') }, createdAt: '2026-10-13T08:00:00Z' };
  eq(await auditContentHash({ ...a, _vv: { T1: 1 } }), await auditContentHash({ ...a, _vv: { T1: 4, T2: 2 } }), 'empreinte scellée indépendante des versions');
  assert(await auditContentHash(a) !== await auditContentHash({ ...a, responses: { x: r('NC', 't') } }), 'mais pas du contenu');
  const { merged, conflicts } = mergeEntity('audit', null, { ...a, _vv: { T1: 2 } }, { ...a, _vv: { T2: 1 } });
  eq(conflicts.length, 0, 'versions jamais fusionnées champ par champ'); assert(!('_vv' in merged));
});
