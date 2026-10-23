/* Tests unitaires des coordonnées UTM 21N / 22N : conversion (js/lib/geo.js : utmConvert, guessUtmZone, inGuyane) et
 * saisies des fiches et des stations (js/domain/coords.js : système choisi, conversion en UTM 22N, saisie d'origine
 * conservée, contrôle de cohérence), affichage (formatValue) et contrôle avant clôture (valueIssues).
 * Points de contrôle : étude des demandes OEG du 14/10/2026 (RGFG95 / GRS80, implémentation de Krüger indépendante,
 * identique à PROJ 9.8 — EPSG:3313 → EPSG:2972 — à moins de 0,001 mm). */
import { test, assert, eq, deepEq } from './harness.js';
import { utmToLatLon, latLonToUtm, utmConvert, guessUtmZone, inGuyane, UTM_ZONES } from '../../js/lib/geo.js';
import { SRS, srsOf, parseSrs, convertEntry, entryOf, withXYEntry, withSrs, withGpsReading, originText, convertedText, coordIssues, siteXY } from '../../js/domain/coords.js';
import { formatValue } from '../../js/domain/model.js';
import { valueIssues } from '../../js/domain/grids.js';
import { GRID_CT_2026 } from '../../js/domain/grid-ct-2026.js';
import { guessMapping } from '../../js/domain/normalize.js';
import { TARGETS } from '../../js/app/imports.js';

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} attendu ${b} ± ${tol}, obtenu ${a}`);

/** [nom, latitude N, longitude O, X 21N, Y 21N, X 22N, Y 22N] (mètres). */
const POINTS = [
  ['Saint-Laurent-du-Maroni, bourg', 5.4983, 54.0283, 829310.44, 608564.88, 164411.68, 608596.40],
  ['Maripasoula, bourg', 3.6403, 54.0286, 830127.56, 402911.85, 163511.57, 402933.01],
  ['AEP Maripasoula (BSS002PANK)', 3.638634, 54.032295, 829717.24, 402726.11, 163100.00, 402750.00],
  ['AEP Grand Santi (BSS002PAAX)', 4.276784, 54.383753, 790418.03, 473216.67, 124297.00, 473550.00],
  ['AV St Laurent (EL 60007489)', 5.595981, 54.003638, 831991.13, 619390.88, 167202.00, 619395.00],
  ['Charvein (BSS002NVHK)', 5.565836, 53.880209, 845697.58, 616125.06, 180873.00, 615990.00],
  ['Badaa Tabiki (09281717)', 4.886234, 54.470623, 780530.65, 540616.48, 114967.00, 541083.00],
  ['Méridien 54° O, 4° N', 4.0, 54.0, 833168.93, 442736.25, 166831.07, 442736.25],
  ['Caserne Saint-Georges (BSS002PBJJ)', 3.89342, 51.803064, 1077753.82, 432129.43, 410841.00, 430389.00]
];

test('UTM : points de contrôle de l’étude — latitude / longitude → UTM 21N et 22N (± 5 cm)', () => {
  for (const [name, lat, lonW, x21, y21, x22, y22] of POINTS) {
    const [ax, ay] = latLonToUtm(lat, -lonW, 21);
    const [bx, by] = latLonToUtm(lat, -lonW, 22);
    near(ax, x21, 0.05, `${name} X 21N`); near(ay, y21, 0.05, `${name} Y 21N`);
    near(bx, x22, 0.05, `${name} X 22N`); near(by, y22, 0.05, `${name} Y 22N`);
  }
});

test('UTM : conversion 21N → 22N et 22N → 21N sur les points de contrôle (± 0,5 m), aller-retour < 1 mm', () => {
  for (const [name, , , x21, y21, x22, y22] of POINTS) {
    const [cx, cy] = utmConvert(x21, y21, 21, 22);
    near(cx, x22, 0.5, `${name} X 22N`); near(cy, y22, 0.5, `${name} Y 22N`);
    const [dx, dy] = utmConvert(x22, y22, '22N', '21N');
    near(dx, x21, 0.5, `${name} X 21N`); near(dy, y21, 0.5, `${name} Y 21N`);
    const [rx, ry] = utmConvert(cx, cy, 22, 21);
    near(rx, x21, 0.001, `${name} aller-retour X`); near(ry, y21, 0.001, `${name} aller-retour Y`);
  }
  // Saisie arrondie au mètre : 829310 / 608565 (21N) → 164411,24 / 608596,53 (22N, calcul de Krüger indépendant),
  // enregistrée arrondie au mètre : 164411 / 608597 (rotation entre les deux quadrillages : l'arrondi ne se reporte pas
  // terme à terme sur la valeur exacte 164411,68 / 608596,40 du point).
  const [kx, ky] = utmConvert(829310, 608565, 21, 22);
  near(kx, 164411.24, 0.05, 'X 22N de la saisie'); near(ky, 608596.53, 0.05, 'Y 22N de la saisie');
  const [jx, jy] = utmConvert(164412, 608596, 22, 21);
  near(jx, 829310.76, 0.05, 'X 21N'); near(jy, 608564.48, 0.05, 'Y 21N');
  const c = convertEntry(829310, 608565, '21N');
  eq(c.x, 164411); eq(c.y, 608597); eq(c.x21, 829310); eq(c.y21, 608565); eq(c.srs, '21N'); assert(c.inGuyane);
  near(c.lat, 5.4983, 0.00001, 'latitude'); near(c.lon, -54.0283, 0.00001, 'longitude');
  // Méridien 54° O : les deux fuseaux sont symétriques (X 21N + X 22N = 1 000 000, même Y).
  const [mx, my] = utmConvert(833168.93, 442736.25, 21, 22);
  near(mx + 833168.93, 1000000, 0.01, 'symétrie'); near(my, 442736.25, 0.01, 'même Y');
  eq(UTM_ZONES['21N'], 21); eq(UTM_ZONES['22N'], 22);
});

test('UTM : fuseau probable et emprise de la Guyane', () => {
  eq(guessUtmZone(163100, 402750), '22N', 'AEP Maripasoula en 22N');
  eq(guessUtmZone(829717, 402726), '21N', 'AEP Maripasoula en 21N');
  eq(guessUtmZone(114967, 541083), '22N', 'X 22N minimal (Badaa Tabiki)');
  eq(guessUtmZone(410841, 430389), '22N', 'extrême est (Saint-Georges)');
  eq(guessUtmZone(1077754, 432129), '21N', 'Saint-Georges en 21N');
  eq(guessUtmZone(500000, 442736), null, 'X 500 000 : hors de la Guyane dans les deux fuseaux');
  eq(guessUtmZone(356714, 46511), null, 'Y tronqué');
  eq(guessUtmZone('', 1), null); eq(guessUtmZone(null, null), null);
  for (const [, , , x21, y21, x22, y22] of POINTS) { eq(guessUtmZone(x21, y21), '21N'); eq(guessUtmZone(x22, y22), '22N'); }
  assert(inGuyane(4.93, -52.33) && inGuyane(5.75, -53.0), 'Cayenne, littoral');
  assert(!inGuyane(4.0, -48.6) && !inGuyane(-4, -52) && !inGuyane(NaN, -52), 'hors Guyane');
});

test('saisie X / Y : système, conversion, saisie d’origine conservée, relevé GPS', () => {
  deepEq(SRS, { '22N': 'UTM 22N (RGFG95)', '21N': 'UTM 21N' });
  eq(srsOf({}), '22N'); eq(srsOf({ srs: '21N' }), '21N'); eq(srsOf(null), '22N');
  eq(parseSrs('UTM 21N'), '21N'); eq(parseSrs('21'), '21N'); eq(parseSrs('EPSG:3313'), '21N'); eq(parseSrs('32621'), '21N');
  eq(parseSrs('RGFG95 / UTM 22N'), '22N'); eq(parseSrs('EPSG:2972'), '22N'); eq(parseSrs('22n'), '22N'); eq(parseSrs(''), null); eq(parseSrs('Lambert'), null);
  // 22N (défaut) : X / Y enregistrés tels quels.
  let v = withXYEntry({}, 'x', 164412); v = withXYEntry(v, 'y', 608596);
  deepEq(v, { x: 164412, y: 608596 });
  // Choisir « UTM 21N » avant de saisir : x21 / y21 puis conversion dès que les deux sont saisis.
  v = withSrs({}, '21N'); deepEq(v, { srs: '21N' });
  v = withXYEntry(v, 'x', 829310); deepEq(v, { srs: '21N', x21: 829310 }, 'X seul : pas encore de conversion');
  v = withXYEntry(v, 'y', '608 565'); deepEq(v, { srs: '21N', x21: 829310, y21: 608565, x: 164411, y: 608597 });
  deepEq(entryOf(v), { x: 829310, y: 608565 }, 'champs affichés : saisie 21N');
  eq(originText(v), 'saisi en UTM 21N : X 829310 · Y 608565');
  eq(convertedText(v), 'RGFG95 / UTM 22N : X 164411 · Y 608597');
  // Effacer Y : la conversion est retirée.
  deepEq(withXYEntry(v, 'y', ''), { srs: '21N', x21: 829310 });
  // X / Y d'UTM 21N saisis par erreur en 22N puis « UTM 21N » : repris comme saisie 21N et convertis.
  deepEq(withSrs({ x: 829310, y: 608565 }, '21N'), { srs: '21N', x21: 829310, y21: 608565, x: 164411, y: 608597 });
  // X / Y 22N puis « UTM 21N » : même position (x / y inchangés), équivalent 21N affiché.
  deepEq(withSrs({ x: 164412, y: 608596 }, '21N'), { srs: '21N', x: 164412, y: 608596, x21: 829311, y21: 608564 });
  // Retour en 22N : x / y (22N) conservés, saisie 21N retirée.
  deepEq(withSrs(v, '22N'), { x: 164411, y: 608597 });
  // Relevé GPS : UTM 22N direct ; en mode 21N, l'équivalent 21N est calculé ; une saisie manuelle remplace le relevé.
  const gps = { x: 164412, y: 608596, lat: 5.4983, lon: -54.0283, accuracy: 8, at: '2026-10-17T12:00:00.000Z' };
  deepEq(withGpsReading({ note: 'a' }, gps), { note: 'a', ...gps });
  const g21 = withGpsReading({ srs: '21N' }, gps);
  eq(g21.x, 164412); eq(g21.x21, 829310); eq(g21.y21, 608565); eq(g21.lat, 5.4983);
  deepEq(withSrs(gps, '21N'), { ...gps, srs: '21N', x21: 829310, y21: 608565 }, 'relevé GPS puis 21N');
  deepEq(withXYEntry(gps, 'x', 164500), { x: 164500, y: 608596 }, 'correction manuelle : relevé GPS retiré');
});

test('saisie X / Y : contrôle de cohérence (21N saisi en 22N, point hors de la Guyane)', () => {
  deepEq(coordIssues({ x: 164412, y: 608596 }), [], 'Saint-Laurent en 22N');
  deepEq(coordIssues({ srs: '21N', x21: 829310, y21: 608565, x: 164412, y: 608596 }), [], 'Saint-Laurent en 21N');
  deepEq(coordIssues({ x: 164412 }), [], 'incomplet : rien à signaler');
  const a = coordIssues({ x: 829310, y: 608565 });
  eq(a.length, 1); eq(a[0].code, 'XY_21N_AS_22N');
  assert(a[0].message.includes('Choisissez « UTM 21N »') && a[0].message.includes('X 164411 · Y 608597'), a[0].message);
  const b = coordIssues({ x: 608596, y: 164412 });
  eq(b[0].code, 'XY_OUT'); assert(b[0].message.includes('hors de la Guyane') && b[0].message.includes('inversés'), b[0].message);
  const c = coordIssues({ srs: '21N', x21: 164412, y21: 608596 });
  eq(c[0].code, 'XY_OUT', '22N saisi en 21N'); assert(c[0].message.includes('UTM 21N'), c[0].message);
  eq(coordIssues({ x: 500000, y: 100 })[0].code, 'XY_OUT');
  // Station : fuseau imposé ou reconnu (import), refus des incohérences.
  const s1 = siteXY(829310, 608565, null);
  eq(s1.detected, true); eq(s1.srs, '21N'); eq(s1.x, 164411); eq(s1.y, 608597); eq(s1.x21, 829310); deepEq(s1.issues, []);
  near(s1.lat, 5.4983, 0.00001); near(s1.lon, -54.0283, 0.00001);
  const s2 = siteXY('164412', '608596', '22N');
  eq(s2.srs, undefined); eq(s2.x, 164412); eq(s2.detected, false); deepEq(s2.issues, []);
  eq(siteXY(829310, 608565, '22N').issues[0].code, 'XY_21N_AS_22N', 'fuseau 22N imposé : 21N signalé');
  eq(siteXY(null, 1), null);
});

test('critère X / Y (F3.15) : affichage avec la saisie d’origine et avertissement avant clôture', () => {
  const it = GRID_CT_2026.sections.flatMap(s => s.items).find(i => i.id === 'it-F3-15');
  assert(it?.input?.gps, 'F3.15 : groupe X / Y avec relevé GPS');
  eq(formatValue(it, { x: 164412, y: 608596 }), 'X : 164412 · Y : 608596');
  eq(formatValue(it, { srs: '21N', x21: 829310, y21: 608565, x: 164412, y: 608596 }), 'X : 164412 · Y : 608596 (saisi en UTM 21N : X 829310 · Y 608565)');
  eq(formatValue(it, { srs: '21N', x21: 829310 }), '', 'conversion incomplète : rien d’affiché');
  deepEq(valueIssues(it, { x: 164412, y: 608596 }), []);
  const w = valueIssues(it, { x: 829310, y: 608565 });
  eq(w.length, 1); eq(w[0].level, 'warning'); eq(w[0].code, 'XY_21N_AS_22N');
  deepEq(valueIssues(it, { srs: '21N', x21: 829310, y21: 608565, x: 164412, y: 608596 }), []);
  // Projection inverse (UTM 22N, référentiel) inchangée.
  const [lat, lon] = utmToLatLon(163100, 402750, 22);
  near(lat, 3.638634, 0.000001); near(lon, -54.032295, 0.000001);
});

test('import de stations : colonnes « X », « Y » et « Fuseau UTM » reconnues (jamais « Réseau(x) » ni « Nature »)', () => {
  // Un en-tête d'une lettre n'est associé que par égalité (« x » est contenu dans « réseau(x) »).
  deepEq(guessMapping(['Code', 'Nom', 'X', 'Y', 'Fuseau UTM'], TARGETS.site.fields), { code: 0, name: 1, x: 2, y: 3, srs: 4 });
  deepEq(guessMapping(['Code station', 'Nom', 'Réseau(x)', 'Type', 'X (m)', 'Y (m)', 'Zone UTM'], TARGETS.site.fields),
    { code: 0, name: 1, networks: 2, kind: 3, x: 4, y: 5, srs: 6 });
  deepEq(guessMapping(['Code', 'Nom', 'Latitude', 'Longitude', 'EPSG'], TARGETS.site.fields), { code: 0, name: 1, lat: 2, lon: 3, srs: 4 });
});
