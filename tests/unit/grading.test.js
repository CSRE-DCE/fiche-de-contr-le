/* Tests unitaires de la NOTE SUR 20 (js/domain/grading.js et décomptes de js/domain/summary.js ; règles validées par
 * l'OEG le 23/10/2026) :
 * - barème C = 1, P = 0,5, NC = 0, N/A et non renseignés non comptés ; note au dixième calculée en entiers (vecteurs
 *   d'arrondi : 23,5 / 200 → « 2,4 », 37,5 / 47 → « 16,0 » Satisfaisant, 119,5 / 200 → « 12,0 ») ; « non noté » ;
 * - appréciation d'après la note affichée et les seuils (défaut 16 / 12, seuils personnalisés, bornes, saisie invalide) ;
 * - points majeurs × 2 (26 points de CT-2026, liste MAJOR_ITEMS) et points de synthèse hors note (F2.2.8, F4.27) ;
 * - barème d'un instantané antérieur (grille du code par identifiant d'origine, numéro retiré × 1) ;
 * - portées : feuille (points affichés, communs compris), station, commun à la tournée, tournée (point commun et
 *   opération mutualisée d'une tournée mixte comptés une fois) ;
 * - note figée à la signature (gradingRecord), notes à afficher (resolveGrades : figée, recalculée, calculée,
 *   provisoire) ; moyennes du tableau de bord (averageGrades) ;
 * - listes (liste « Audits », cartes des stations de l'accueil) : listGrade (note définitive, calculée, recalculée,
 *   provisoire, non notée, tournée annulée ; note de la station, à défaut de la tournée), tri compareListGrades, note
 *   figée lue sans calcul (frozenGrades, identique à resolveGrades d'une tournée verrouillée sans modification). */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_CT_2026, MAJOR_ITEMS } from '../../js/domain/grid-ct-2026.js';
import { GRID_GENERAL } from '../../js/domain/default-grids.js';
import { allItems, itemIndex, expandGrid, visibleItems, sheetsOf, typeCompartments } from '../../js/domain/grids.js';
import { sheetSummary, stationSummary, auditSummary } from '../../js/domain/summary.js';
import {
  GRADE_SCALE, MAJOR_WEIGHT, DEFAULT_GRADE_THRESHOLDS, NOT_GRADED, emptyTally, tallyItem, gradeOf, gradeItems, noteText, levelOf, gradeThresholds,
  thresholdErrors, thresholdsText, scoringOf, scoringFromRecord, weightOf, isMajorItem, isNoScoreItem, collectGrades, gradingRecord, isGradingRecord,
  resolveGrades, applyResolvedGrades, gradeFromCompact, gradeText, averageGrades, relabelGrade, listGrade, compareListGrades, frozenGrades
} from '../../js/domain/grading.js';

const G = GRID_CT_2026;
const IDX = itemIndex(G);
const ATHANASE = { id: 'site-09271503', code: '09271503', name: 'Athanase', matrixId: 'mat-ESU' };
const ACAROUANY = { id: 'site-09160201', code: '09160201', name: 'Acarouany', matrixId: 'mat-ESU' };
const SAKOURA = { id: 'site-09281718', code: '09281718', name: 'Sakoura', matrixId: 'mat-ESU' };
const SITES = { [ATHANASE.id]: ATHANASE, [ACAROUANY.id]: ACAROUANY, [SAKOURA.id]: SAKOURA };
const A = '09160201', B = '09271503', S = '09281718';
const BIO_ALL = ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'];
/** Décompte de n critères ordinaires par cote. */
const tally = ({ C = 0, P = 0, NC = 0, NA = 0 } = {}) => {
  const t = emptyTally(), it = { id: 'it-x', kind: 'conformity' };
  for (const [s, n] of Object.entries({ C, P, NC, NA })) for (let i = 0; i < n; i++) tallyItem(t, it, { status: s });
  return t;
};

/* ---------- Barème, arrondi, appréciation ---------- */
test('barème et vecteurs de calcul : C = 1, P = 0,5, NC = 0, N/A non compté, une décimale', () => {
  deepEq(GRADE_SCALE, { C: 1, P: 0.5, NC: 0 }); eq(MAJOR_WEIGHT, 2); deepEq(DEFAULT_GRADE_THRESHOLDS, { good: 16, fair: 12 });
  let g = gradeOf(tally({ C: 10, P: 4, NC: 2, NA: 3 }));
  deepEq([g.text, g.label, g.level, g.points, g.max, g.evaluated, g.NA, g.total], ['15,0', 'À améliorer', 'fair', 12, 16, 16, 3, 19], '12 / 16');
  eq(g.note, 15);
  g = gradeOf(tally({ C: 9, NC: 6 })); deepEq([g.text, g.label], ['12,0', 'À améliorer'], '9 / 15');
  g = gradeOf(tally({ C: 8 })); deepEq([g.text, g.label, g.note], ['20,0', 'Satisfaisant', 20]);
  g = gradeOf(tally({ NC: 3 })); deepEq([g.text, g.label, g.level], ['0,0', 'Insuffisant', 'poor'], 'que des NC : 0,0 (noté)');
  g = gradeOf(tally({ C: 119, P: 1, NC: 80 })); deepEq([g.points, g.max, g.text, g.label], [119.5, 200, '12,0', 'À améliorer'], '119,5 / 200 = 11,95 → 12,0');
  // Arrondi exact en entiers : 23,5 / 200 = 2,35 tout juste → « 2,4 » (le calcul flottant naïf donne 2,3).
  eq(gradeOf({ got2: 47, max2: 400 }).text, '2,4');
  eq(Math.round(23.5 / 200 * 20 * 10) / 10, 2.3, 'contrôle : l’arrondi flottant naïf se trompe');
  // Appréciation d'après la note AFFICHÉE : 37,5 / 47 = 15,957… → « 16,0 » → Satisfaisant.
  g = gradeOf({ got2: 75, max2: 94 }); deepEq([g.text, g.label], ['16,0', 'Satisfaisant']);
  eq(gradeOf({ got2: 1, max2: 2 }).text, '10,0'); eq(gradeOf({ got2: 1, max2: 6 }).text, '3,3'); eq(gradeOf({ got2: 5, max2: 6 }).text, '16,7');
  eq(noteText(5), '0,5'); eq(noteText(200), '20,0'); eq(noteText(null), NOT_GRADED);
});

test('aucun point évalué : « non noté » (tout N/A, rien de renseigné, seulement des points hors note)', () => {
  for (const t of [tally({ NA: 5 }), emptyTally(), {}]) {
    const g = gradeOf(t);
    deepEq([g.note, g.n10, g.text, g.level, g.label, g.evaluated], [null, null, 'non noté', null, 'Non noté', 0]);
  }
  const t = emptyTally();
  tallyItem(t, { id: 'it-F2-2.8', kind: 'conformity', noScore: true }, { status: 'NC' });
  const g = gradeOf(t);
  deepEq([g.text, g.NC, g.excluded, g.evaluated], ['non noté', 1, 1, 0], 'point de synthèse : compté dans les cotes, hors note');
  eq(gradeText(g), 'non noté'); eq(gradeText(gradeOf(tally({ C: 3, NC: 1 }))), '15,0 / 20 — À améliorer');
  // Non renseigné et NO / NV (grilles historiques) : non comptés
  const u = emptyTally(); const it = { id: 'x', kind: 'conformity' };
  tallyItem(u, it, null); tallyItem(u, it, { status: 'NO' }); tallyItem(u, it, { status: 'C' }); tallyItem(u, { id: 'v', kind: 'text' }, { value: 'x' });
  deepEq([u.total, u.unanswered, u.evaluated, gradeOf(u).text], [3, 1, 1, '20,0']);
});

test('seuils : défaut, personnalisés, bornes au dixième, saisie invalide refusée', () => {
  const g = n10 => levelOf(n10);
  deepEq([g(200), g(160), g(159), g(120), g(119), g(0)], ['good', 'good', 'fair', 'fair', 'poor', 'poor']);
  const t = { good: 15, fair: 10 };
  deepEq([levelOf(150, t), levelOf(149, t), levelOf(100, t), levelOf(99, t)], ['good', 'fair', 'fair', 'poor']);
  deepEq(gradeOf(tally({ C: 3, NC: 1 }), t).label, 'Satisfaisant', '15,0 avec le seuil 15');
  deepEq(gradeThresholds({ gradeGood: '17,5', gradeFair: '14' }), { good: 17.5, fair: 14 }, 'réglages de l’organisation, virgule');
  deepEq(gradeThresholds({ good: 16.04, fair: 11.96 }), { good: 16, fair: 12 }, 'au dixième');
  deepEq(levelOf(175, { good: 17.5, fair: 14 }), 'good');
  for (const bad of [null, {}, { good: 12, fair: 16 }, { good: 21, fair: 12 }, { good: 16, fair: -1 }, { good: '', fair: 12 }, { good: 'x', fair: 12 }]) deepEq(gradeThresholds(bad), { good: 16, fair: 12 }, JSON.stringify(bad));
  deepEq(thresholdErrors({ good: 16, fair: 12 }), []);
  deepEq(thresholdErrors({ good: 16, fair: 16 }), [], 'seuils égaux admis (pas de « À améliorer »)');
  eq(thresholdErrors({ good: 12, fair: 16 })[0], 'Le seuil « À améliorer » doit être inférieur ou égal au seuil « Satisfaisant ».');
  eq(thresholdErrors({ good: 25, fair: 12 })[0], 'Seuil « Satisfaisant » : nombre de 0 à 20 attendu.');
  eq(thresholdErrors({ gradeGood: 16, gradeFair: '' })[0], 'Seuil « À améliorer » : nombre de 0 à 20 attendu.');
  eq(thresholdsText(), '≥ 16 Satisfaisant · 12 à < 16 À améliorer · < 12 Insuffisant');
  eq(thresholdsText({ good: 17.5, fair: 14 }), '≥ 17,5 Satisfaisant · 14 à < 17,5 À améliorer · < 14 Insuffisant');
});

/* ---------- Pondération ---------- */
test('points majeurs × 2 et points de synthèse hors note', () => {
  const maj = { id: 'it-F4-12', kind: 'conformity', major: true }, ord = { id: 'it-F4-14', kind: 'conformity' }, syn = { id: 'it-F4-27', kind: 'conformity', noScore: true };
  deepEq([weightOf(maj), weightOf(ord), weightOf(syn)], [2, 1, 0]);
  const t = emptyTally();
  tallyItem(t, maj, { status: 'C' }); tallyItem(t, { ...maj, id: 'it-F4-13' }, { status: 'NC' }); tallyItem(t, ord, { status: 'P' }); tallyItem(t, syn, { status: 'NC' });
  const g = gradeOf(t);
  deepEq([g.C, g.P, g.NC, g.evaluated, g.majors, g.excluded, g.points, g.max, g.text], [1, 1, 2, 3, 2, 1, 2.5, 5, '10,0'], '(2 + 0 + 0,5) / (2 + 2 + 1)');
  // Sans pondération, la même saisie donnerait 1,5 / 3 = 10,0 ; un NC majeur pèse davantage :
  const t2 = emptyTally();
  tallyItem(t2, maj, { status: 'NC' }); tallyItem(t2, ord, { status: 'C' }); tallyItem(t2, { ...ord, id: 'it-F4-15' }, { status: 'C' });
  eq(gradeOf(t2).text, '10,0', '2 / 4 (majeur NC) au lieu de 2 / 3 = 13,3');
  eq(gradeItems([maj, ord, syn], { 'it-F4-12': { status: 'C' }, 'it-F4-14': { status: 'NC' }, 'it-F4-27': { status: 'NC' } }).text, '13,3', 'gradeItems : 2 / 3');
});

test('CT-2026 : 26 points majeurs validés (MAJOR_ITEMS), F8.A2 réunit A2 et A3, synthèses hors note', () => {
  deepEq([...MAJOR_ITEMS], ['F2.4.4', 'F3.19', 'F10.4', 'F10.5', 'F10.6', 'F4.2', 'F4.12', 'F4.13', 'F4.31', 'F5.7', 'F5.13', 'F5.21', 'F5.24', 'F5.26', 'F5.27',
    'F6.5', 'F6.11', 'F6.12', 'F7.6', 'F7.12', 'F8.A2', 'F8.A5', 'F8.B4', 'F8.B5', 'F9.9', 'F9.12']);
  const items = allItems(G);
  deepEq(items.filter(i => i.major).map(i => i.code).sort(), [...MAJOR_ITEMS].sort(), 'attribut major sur les 26 points, et eux seuls');
  assert(items.filter(i => i.major).every(i => i.kind === 'conformity' && !i.noScore), 'points majeurs : critères cotés, jamais hors note');
  deepEq(items.filter(i => i.noScore).map(i => i.code), ['F2.2.8', 'F4.27']);
  for (const c of ['F2.4.3', 'F2.7.3', 'F8.A1', 'F8.A4']) assert(!IDX.get(c).major, `${c} n’est pas majeur`);
  eq(IDX.get('F8.A2').label, 'Filets maillants / batteries et mailles utilisées');
  assert(!IDX.get('F8.A3') && !IDX.get('it-F8-A3'), 'F8.A3 retiré');
  const sc = scoringOf(G);
  deepEq([sc.source, sc.majors.size, [...sc.noScore].sort()], ['grille', 26, ['it-F2-2.8', 'it-F4-27']]);
  assert(scoringOf(G) === sc, 'barème mémorisé par grille');
  // Grille effective : critère de station (id@clé) et critère commun : même barème (identifiant d'origine).
  const E = expandGrid(G, [{ siteId: ATHANASE.id }, { siteId: ACAROUANY.id }], SITES);
  const ei = itemIndex(E);
  deepEq([weightOf(ei.get(`it-F4-12@${B}`), sc), weightOf(ei.get('it-F4-2'), sc), weightOf(ei.get(`it-F4-27@${A}`), sc), weightOf(ei.get(`it-F4-14`), sc)], [2, 2, 0, 1]);
  assert(isMajorItem(ei.get(`it-F8-A2@${A}`), sc) && isNoScoreItem(ei.get('it-F2-2.8'), sc) && !isMajorItem(ei.get(`it-F8-A4@${A}`), sc));
  deepEq([...scoringOf(E).majors].sort(), [...sc.majors].sort(), 'barème identique sur la grille effective');
});

test('barème d’un instantané antérieur : grille du code par identifiant d’origine, numéro retiré × 1, autre grille × 1', () => {
  // Instantané d'une tournée commencée en 1.1 : ni major ni noScore, F8.A3 encore présent.
  const old = structuredClone(G); old.version = '1.1';
  for (const s of old.sections) for (const it of s.items) { delete it.major; delete it.noScore; }
  const f8 = old.sections.find(s => s.id === 's-F8-A');
  f8.items.splice(2, 0, { id: 'it-F8-A3', code: 'F8.A3', no: 'A3', label: 'Mailles utilisées', short: 'A3', kind: 'conformity', responses: ['C', 'P', 'NC', 'NA'], required: true });
  const sc = scoringOf(old);
  deepEq([sc.source, sc.majors.size, [...sc.noScore].sort()], ['reference', 26, ['it-F2-2.8', 'it-F4-27']]);
  eq(weightOf({ id: 'it-F8-A3@' + B, baseId: 'it-F8-A3', kind: 'conformity' }, sc), 1, 'numéro retiré : × 1');
  eq(weightOf({ id: 'it-F8-A2@' + B, kind: 'conformity' }, sc), 2, 'identifiant d’origine déduit de l’identifiant effectif');
  // Grille sans barème et sans grille de référence : × 1 partout.
  const custom = { ...structuredClone(old), id: 'grid-locale' };
  const c2 = scoringOf(custom);
  deepEq([c2.source, c2.majors.size, c2.noScore.size], ['aucun', 0, 0]);
  deepEq([scoringOf(null).source, scoringOf(GRID_GENERAL).source], ['aucun', 'aucun']);
  // Barème figé dans une note enregistrée
  const fr = scoringFromRecord({ source: 'grille', majors: ['it-F4-12'], noScore: ['it-F4-27'] });
  deepEq([weightOf({ id: 'it-F4-12@' + B }, fr), weightOf({ id: 'it-F4-27' }, fr), weightOf({ id: 'it-F4-13' }, fr)], [2, 0, 1]);
});

/* ---------- Portées : feuille, station, commun à la tournée, tournée ---------- */
const bioTour = () => {
  const stations = [{ siteId: ATHANASE.id }, { siteId: ACAROUANY.id }];
  const ctx = { auditType: 'bio', compartments: BIO_ALL };
  return { stations, ctx, E: expandGrid(G, stations, SITES) };
};

test('tournée de deux stations : point commun compté une fois dans la tournée, dans la note de chaque feuille où il figure', () => {
  const { stations, ctx, E } = bioTour();
  const responses = {
    'it-F4-2': { status: 'NC', comment: 'sonde non étalonnée' },     // commun à la tournée, majeur
    [`it-F4-12@${B}`]: { status: 'C' }, [`it-F4-12@${A}`]: { status: 'C' },   // majeurs, propres à chaque station
    [`it-F4-5@${B}`]: { status: 'P', comment: 'x' },                   // ordinaire
    'it-F2-2.8': { status: 'NC', comment: 'synthèse' },                  // synthèse, hors note
    [`it-F4-6@${A}`]: { status: 'NA' }
  };
  const audit = { responses, stations, compartments: BIO_ALL, auditType: 'bio' };
  const ss = stationSummary({ audit, grid: E, ctx });
  const v = g => [g.text, g.label, g.evaluated, g.majors, g.excluded, g.points, g.max];
  // Tournée : F4.2 NC (×2), F4.12 C ×2 (×2 chacun), F4.5 P → (0 + 2 + 2 + 0,5) / (2 + 2 + 2 + 1) = 4,5 / 7 → 12,9
  deepEq(v(ss.global.grade), ['12,9', 'À améliorer', 4, 3, 1, 4.5, 7]);
  deepEq(v(ss.tournee.grade), ['0,0', 'Insuffisant', 1, 1, 1, 0, 2], 'commun à la tournée : F4.2 (et F2.2.8 hors note)');
  const st = Object.fromEntries(ss.stations.map(s => [s.key, s.grade]));
  deepEq(v(st[A]), ['20,0', 'Satisfaisant', 1, 1, 0, 2, 2], 'Acarouany : F4.12 majeur (N/A non compté)');
  deepEq(v(st[B]), ['16,7', 'Satisfaisant', 2, 1, 0, 2.5, 3], 'Athanase : (2 + 0,5) / (2 + 1)');
  // tournée + stations = tournée entière (portées disjointes)
  eq(ss.tournee.grade.max + ss.stations.reduce((n, s) => n + s.grade.max, 0), ss.global.grade.max);
  eq(ss.tournee.grade.points + ss.stations.reduce((n, s) => n + s.grade.points, 0), ss.global.grade.points);
  // Feuilles : points AFFICHÉS (F4.2, commun, dans chaque feuille 4) ; feuille 2 : seulement la synthèse ⇒ non noté
  const sh = Object.fromEntries(sheetSummary({ audit, grid: E, ctx }).map(s => [s.instanceKey, s]));
  deepEq(v(sh[`4@${B}`].grade), ['10,0', 'Insuffisant', 3, 2, 0, 2.5, 5], 'F4 Athanase : F4.2 NC + F4.12 C + F4.5 P');
  deepEq(v(sh[`4@${A}`].grade), ['10,0', 'Insuffisant', 2, 2, 0, 2, 4], 'F4 Acarouany : F4.2 NC (commun, aussi ici) + F4.12 C');
  deepEq([sh['2'].grade.text, sh['2'].grade.NC, sh['2'].grade.excluded], ['non noté', 1, 1]);
  deepEq([sh[`4@${A}`].grade.NA, sh[`4@${B}`].grade.NC, sh[`4@${A}`].sharedCounted], [1, 1, 0], 'cotes de la feuille : points affichés ; décompte de synthèse inchangé');
  eq(sh[`6@${B}`].grade.text, 'non noté', 'feuille sans réponse');
  // auditSummary : note de la tournée ; seuils personnalisés
  const sum = auditSummary({ audit, grid: E, ctx, grading: { thresholds: { good: 12.5, fair: 10 } } });
  deepEq([sum.grade.text, sum.grade.label, sum.stations.global.grade.label], ['12,9', 'Satisfaisant', 'Satisfaisant']);
  assert(!('score' in sum), 'propriété « grade », jamais « score »');
  eq(auditSummary({ audit: { responses: {} }, grid: GRID_GENERAL }).grade, null, 'grille historique : non notée');
});

test('tournée mixte (biologie + chimie, même prestataire) : opération mutualisée notée une fois ; station chimie seule', () => {
  const stations = [{ siteId: ACAROUANY.id, parts: ['bio', 'ce'] }, { siteId: SAKOURA.id, parts: ['ce'] }];
  const ctx = { auditType: 'bio', compartments: ['organisation', 'physico', 'invertebres', 'diatomees'] };
  const E = expandGrid(G, stations, SITES);
  const conf = visibleItems(E, {}, ctx).map(x => x.item).filter(i => i.kind === 'conformity');
  const responses = Object.fromEntries(conf.map(i => [i.id, { status: 'C' }]));
  responses[`it-F4-12@${A}`] = { status: 'NC', comment: 'flacons' };   // opération mutualisée (biologie + chimie), majeure
  const audit = { responses, stations, compartments: ctx.compartments, auditType: 'bio' };
  const ss = stationSummary({ audit, grid: E, ctx });
  const sc = scoringOf(G);
  const max = conf.reduce((n, i) => n + weightOf(i, sc), 0);
  eq(ss.global.grade.max, max, 'chaque point de la tournée une fois, pondéré');
  eq(ss.global.grade.points, max - 2, 'un seul NC majeur (–2)');
  eq(ss.global.grade.evaluated, conf.filter(i => weightOf(i, sc)).length);
  // F4 d'Acarouany : une seule feuille pour les deux parties
  const f4 = sheetSummary({ audit, grid: E, ctx }).filter(s => s.no === 4 && s.stationKey === A);
  eq(f4.length, 1, 'feuille 4 unique à la station mixte');
  eq(f4[0].grade.NC, 1);
  // Station chimie seule : ni F6 ni F7 dans sa note
  const sh = sheetsOf(E, responses, ctx).filter(s => s.station?.key === S).map(s => s.no);
  assert(!sh.includes(6) && !sh.includes(7), 'chimie seule : pas de feuilles biologiques');
  eq(ss.stations.find(s => s.key === S).grade.text, '20,0');
});

/* ---------- Note figée à la signature, notes à afficher ---------- */
test('note figée à la signature : enregistrement, seuils figés, modification tracée, tournée signée avant la notation', () => {
  const { stations, ctx, E } = bioTour();
  const responses = { 'it-F4-2': { status: 'NC', comment: 'x' }, [`it-F4-12@${B}`]: { status: 'C' }, [`it-F4-5@${B}`]: { status: 'C' } };
  const audit = { responses, stations, compartments: BIO_ALL, auditType: 'bio' };
  const grading = { thresholds: { good: 16, fair: 12 }, scoring: scoringOf(G) };
  const live = collectGrades(auditSummary({ audit, grid: E, ctx, grading }));
  eq(live.tour.text, '12,0'); eq(live.tour.label, 'À améliorer');
  const rec = gradingRecord(live, { ...grading, at: '2026-10-23T15:00:00.000Z', by: 'u1', byName: 'Admin Test' });
  deepEq([rec.version, rec.thresholds, rec.scale, rec.majorWeight, rec.source, rec.majors.length, rec.noScore], [1, { good: 16, fair: 12 }, { C: 1, P: 0.5, NC: 0 }, 2, 'grille', 26, ['it-F2-2.8', 'it-F4-27']]);
  deepEq([rec.tour.note, rec.tour.level, rec.tour.points, rec.tour.max, rec.tour.evaluated], [12, 'fair', 3, 5, 3]);
  assert(rec.sheets[`4@${B}`] && rec.stations[B] && rec.tournee, 'notes des feuilles, des stations et du commun');
  eq(JSON.stringify(rec), JSON.stringify(JSON.parse(JSON.stringify(rec))), 'données JSON simples (enregistrables, scellables)');
  assert(isGradingRecord(rec) && !isGradingRecord(null) && !isGradingRecord({ version: 2, tour: {} }) && !isGradingRecord({ ...rec, thresholds: { good: 10, fair: 15 } }));
  // Figée : affichée telle qu'enregistrée, avec SES seuils, même si l'administration les change ensuite.
  const later = collectGrades(auditSummary({ audit, grid: E, ctx, grading: { thresholds: { good: 11, fair: 8 }, scoring: scoringOf(G) } }));
  eq(later.tour.label, 'Satisfaisant', 'seuils actuels : Satisfaisant');
  let r = resolveGrades({ live: collectGrades(auditSummary({ audit, grid: E, ctx, grading: { thresholds: rec.thresholds, scoring: scoringFromRecord(rec) } })), record: rec, thresholds: { good: 11, fair: 8 }, signed: true });
  deepEq([r.state, r.tour.text, r.tour.label, r.thresholds], ['figee', '12,0', 'À améliorer', { good: 16, fair: 12 }]);
  eq(r.sheets[`4@${B}`].text, gradeFromCompact(rec.sheets[`4@${B}`]).text);
  // Modification tracée après la signature qui change la note : recalculée avec les seuils et le barème figés.
  const amended = { ...audit, responses: { ...responses, 'it-F4-2': { status: 'C' } } };
  const live2 = collectGrades(auditSummary({ audit: amended, grid: E, ctx, grading: { thresholds: rec.thresholds, scoring: scoringFromRecord(rec) } }));
  r = resolveGrades({ live: live2, record: rec, signed: true, amended: true });
  deepEq([r.state, r.tour.text, r.signedTour.text], ['recalculee', '20,0', '12,0']);
  r = resolveGrades({ live: live2, record: rec, signed: true, amended: false });
  deepEq([r.state, r.tour.text], ['figee', '12,0'], 'sans modification tracée : toujours la note figée');
  r = resolveGrades({ live, record: rec, signed: true, amended: true });
  eq(r.state, 'figee', 'modification sans effet sur la note : figée');
  // Signée par le contrôleur puis modifiée AVANT le verrouillage : signature à refaire, note provisoire (seuils actuels).
  r = resolveGrades({ live: live2, record: rec, thresholds: { good: 21, fair: 12 }, signed: true, locked: false });
  deepEq([r.state, r.tour.text, r.tour.label, r.record, r.thresholds], ['provisoire', '20,0', 'Satisfaisant', null, { good: 16, fair: 12 }], 'seuils invalides : défauts');
  r = resolveGrades({ live: live2, record: rec, thresholds: { good: 20.5, fair: 20 }, signed: true, locked: false });
  eq(r.tour.label, 'Satisfaisant');
  r = resolveGrades({ live: live2, record: rec, thresholds: { good: 20, fair: 19 }, signed: true, locked: false });
  deepEq([r.state, r.tour.label, r.sheets[`4@${B}`].label], ['provisoire', 'Satisfaisant', 'Satisfaisant']);
  eq(resolveGrades({ live, record: rec, thresholds: { good: 20, fair: 19 }, signed: true, locked: false }).state, 'figee', 'non verrouillée, inchangée : figée');
  // Tournée signée avant la notation (pas de note figée) : calculée, seuils actuels ; non signée : provisoire.
  r = resolveGrades({ live: later, record: null, thresholds: { good: 11, fair: 8 }, signed: true });
  deepEq([r.state, r.tour.label, r.thresholds], ['calculee', 'Satisfaisant', { good: 11, fair: 8 }]);
  eq(resolveGrades({ live, signed: false }).state, 'provisoire');
  deepEq([relabelGrade(live.tour, { good: 11, fair: 8 }).label, relabelGrade(live.tour).label, relabelGrade(gradeOf({})).text], ['Satisfaisant', 'À améliorer', 'non noté']);
  eq(resolveGrades({ live: null }), null, 'grille historique');
  // Report dans la synthèse
  const sum = auditSummary({ audit: amended, grid: E, ctx });
  applyResolvedGrades(sum, resolveGrades({ live: collectGrades(sum), record: rec, signed: true }));
  deepEq([sum.grade.text, sum.stations.global.grade.text, sum.grading.state, sum.sheets.find(s => s.instanceKey === `4@${B}`).grade.text], ['12,0', '12,0', 'figee', gradeFromCompact(rec.sheets[`4@${B}`]).text]);
});

/* ---------- Tableau de bord ---------- */
test('moyennes par prestataire et par réseau (tournées notées seulement, demi-dixième au-dessus)', () => {
  const rows = [
    { providerId: 'prov-HYDRECO', networks: ['BIO'], n10: 156 }, { providerId: 'prov-HYDRECO', networks: ['BIO', 'Chimie'], n10: 155 },
    { providerId: 'prov-OEG', networks: ['Chimie'], n10: 110 }, { providerId: 'prov-OEG', networks: ['Chimie'], n10: null }
  ];
  const m = averageGrades(rows);
  deepEq([m.all.count, m.all.text, m.all.label, m.all.min, m.all.max], [3, '14,0', 'À améliorer', 11, 15.6], '(156 + 155 + 110) / 3 = 140,33');
  const h = m.byProvider[0];
  deepEq([h.providerId, h.count, h.text, h.label], ['prov-HYDRECO', 2, '15,6', 'À améliorer'], '(15,6 + 15,5) / 2 = 15,55 → 15,6');
  deepEq(h.networks.map(n => [n.code, n.count, n.text]), [['BIO', 2, '15,6'], ['Chimie', 1, '15,5']]);
  deepEq(m.byProvider[1].networks.map(n => [n.code, n.count, n.text, n.label]), [['Chimie', 1, '11,0', 'Insuffisant']], 'tournée non notée ignorée');
  deepEq(m.byNetwork.map(n => [n.code, n.count, n.text]), [['BIO', 2, '15,6'], ['Chimie', 2, '13,3']], 'tournée sur deux réseaux : comptée dans chacun');
  eq(averageGrades([], { good: 15, fair: 10 }).all.text, 'non noté');
  eq(averageGrades(rows, { good: 15, fair: 10 }).byProvider[0].label, 'Satisfaisant', 'appréciation des moyennes : seuils donnés');
});

/* ---------- Listes : liste « Audits », cartes des stations de l'accueil ---------- */
test('listes : badge de note (figée, calculée, recalculée, provisoire, non notée, annulée), note de station, tri, note figée lue sans calcul', () => {
  const { stations, ctx, E } = bioTour();
  const responses = { 'it-F4-2': { status: 'NC', comment: 'x' }, [`it-F4-12@${B}`]: { status: 'C' }, [`it-F4-5@${B}`]: { status: 'C' } };
  const audit = { responses, stations, compartments: BIO_ALL, auditType: 'bio' };
  const grading = { thresholds: { good: 16, fair: 12 }, scoring: scoringOf(G) };
  const live = collectGrades(auditSummary({ audit, grid: E, ctx, grading }));
  const rec = gradingRecord(live, grading);
  // Tournée signée, note figée : note définitive, sans mention.
  const r = resolveGrades({ live, record: rec, signed: true });
  let lg = listGrade(r);
  deepEq([lg.graded, lg.text, lg.note, lg.n10, lg.final, lg.mention, lg.scope, lg.level, lg.state], [true, '12,0 / 20 · À améliorer', '12,0', 120, true, '', 'tournee', 'fair', 'figee']);
  eq(lg.title, 'Note de la tournée : 12,0 / 20 — À améliorer (note figée à la signature)');
  // Note de la station (points propres : F4.12 C ×2 + F4.5 C) ; station sans point propre évalué : note de la tournée.
  lg = listGrade(r, { stationKey: B });
  deepEq([lg.scope, lg.text, lg.final], ['station', '20,0 / 20 · Satisfaisant', true]);
  assert(lg.title.startsWith('Note de la station dans la tournée : 20,0 / 20 — Satisfaisant'), lg.title);
  deepEq([listGrade(r, { stationKey: A }).scope, listGrade(r, { stationKey: A }).text], ['tournee', '12,0 / 20 · À améliorer']);
  eq(listGrade(r, { stationKey: 'inconnue' }).scope, 'tournee');
  // Signée avant la notation : « calculée » ; modification tracée après la signature : « recalculée » ; non signée : provisoire.
  lg = listGrade(resolveGrades({ live, signed: true }));
  deepEq([lg.final, lg.mention, lg.state], [true, 'calculée', 'calculee']);
  const amended = { ...audit, responses: { ...responses, 'it-F4-2': { status: 'C' } } };
  const live2 = collectGrades(auditSummary({ audit: amended, grid: E, ctx, grading: { thresholds: rec.thresholds, scoring: scoringFromRecord(rec) } }));
  lg = listGrade(resolveGrades({ live: live2, record: rec, signed: true, amended: true }));
  deepEq([lg.final, lg.mention, lg.text], [true, 'recalculée', '20,0 / 20 · Satisfaisant']);
  lg = listGrade(resolveGrades({ live, signed: false }));
  deepEq([lg.final, lg.mention, lg.text, lg.level], [false, 'provisoire', '12,0 / 20 · À améliorer', 'fair']);
  assert(lg.title.endsWith('(note provisoire (tournée non signée))'), lg.title);
  // Aucun point évalué : « non noté » ; tournée annulée, grille historique : rien.
  const none = listGrade(resolveGrades({ live: collectGrades(auditSummary({ audit: { ...audit, responses: {} }, grid: E, ctx, grading })), signed: false }));
  deepEq([none.graded, none.text, none.n10, none.mention, none.final], [false, 'non noté', null, '', false]);
  eq(listGrade(r, { cancelled: true }), null, 'tournée annulée');
  eq(listGrade(null), null, 'grille historique');
  // Note figée lue sans calcul : identique à resolveGrades d'une tournée verrouillée sans modification tracée.
  const f = frozenGrades(rec), full = resolveGrades({ live, record: rec, signed: true, locked: true, amended: false });
  deepEq([f.state, f.tour.text, f.tour.label, f.tournee.text, f.stations[B].text, f.thresholds], [full.state, full.tour.text, full.tour.label, full.tournee.text, full.stations[B].text, full.thresholds]);
  deepEq(listGrade(f, { stationKey: B }), listGrade(full, { stationKey: B }));
  deepEq(listGrade(f), listGrade(full));
  eq(frozenGrades(null), null); eq(frozenGrades({ version: 9, tour: {} }), null);
  // Tri par note : décroissante ou croissante, non notées (ou sans note) en dernier, égalités dans l'ordre d'origine.
  const g = n10 => ({ graded: true, n10 });
  const rows = [['a', g(150)], ['b', null], ['c', g(177)], ['d', { graded: false, n10: null }], ['e', g(150)], ['f', g(90)]];
  const order = asc => [...rows].sort((x, y) => compareListGrades(x[1], y[1], { asc })).map(x => x[0]).join('');
  eq(order(false), 'caefbd'); eq(order(true), 'faecbd');
});
