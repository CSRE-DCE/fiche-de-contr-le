/* Tests unitaires de la grille en feuilles CT-BIO-2026 et du domaine associé (modules purs) :
 * structure des 9 feuilles, formatage des valeurs, réponses à valeur objet, validation, alertes
 * (température F5, coordonnées GPS, calibration F4), feuilles visibles selon les compartiments,
 * pré-remplissage, synthèse par feuille, référentiel des stations BIO et programme 2026. */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_BIO_2026 } from '../../js/domain/grid-bio-2026.js';
import { DEFAULT_GRIDS } from '../../js/domain/default-grids.js';
import { formatValue, responseText, isEmptyValue, itemInput } from '../../js/domain/model.js';
import {
  validateGrid, allItems, itemIndex, isAnswered, validateResponses, progress, visibleStructure,
  sheetsOf, sheetProgress, itemsOfSheet, normalizeCompartments, prefillResponses, sectionHeaders
} from '../../js/domain/grids.js';
import { computeAlerts, calibrationStatus, xyDistance } from '../../js/domain/rules.js';
import { sheetSummary, auditSummary } from '../../js/domain/summary.js';
import { compareAudits } from '../../js/domain/compare.js';
import { parseInputValue } from '../../js/domain/normalize.js';
import { oegReferential, bioProgramme, bioCompartments, BIO_CAMPAIGN } from '../../js/domain/seed.js';

const G = GRID_BIO_2026;
const IDX = itemIndex(G);
const item = id => IDX.get(id);
const ATHANASE = { id: 'site-09271503', code: '09271503', name: 'Athanase', bassin: 'Approuague', riverName: 'Approuague', commune: '', her: 52, strahler: '', pressions: 'Orpaillage illégal', x: 356714, y: 465112 };
const ALL = ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'];
const nos = sheets => sheets.map(s => s.no);

/* ---------- Structure de la grille ---------- */
test('BIO 2026 : grille en tête des grilles par défaut et structurellement valide', () => {
  eq(DEFAULT_GRIDS[0], G, 'CT-BIO-2026 en tête de DEFAULT_GRIDS');
  assert(DEFAULT_GRIDS.some(g => g.code === 'GR-PREL-EAU') && DEFAULT_GRIDS.some(g => g.code === 'GR-RAPIDE'), 'grilles générales conservées');
  for (const g of DEFAULT_GRIDS) deepEq(validateGrid(g), [], g.code);
  eq(G.id, 'grid-ct-bio-2026-v1'); eq(G.code, 'CT-BIO-2026'); eq(G.layout, 'sheets'); eq(G.status, 'publiee');
  eq(G.settings.gpsThresholdM, 300); eq(G.settings.transportMaxHours, 24);
  deepEq(G.scope.providerIds, ['prov-HYDRECO']);
  deepEq(G.compartments.map(c => c.key), ALL);
  assert(G.compartments.find(c => c.key === 'organisation').always === true, 'organisation toujours retenue');
});

test('BIO 2026 : 9 feuilles avec thèmes, compartiments et mises en page des maquettes', () => {
  eq(G.sheets.length, 9);
  deepEq(nos(G.sheets), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  deepEq(G.sheets.map(s => s.theme), ['ocean', 'navy', 'green', 'peach', 'orange', 'violet', 'sky', 'ocean', 'teal']);
  deepEq(G.sheets.map(s => s.compartment), ['organisation', 'organisation', 'organisation', 'physico', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton']);
  deepEq(G.sheets.map(s => s.layout), ['station', 'table', 'table', 'table', 'table', 'table', 'table', 'split', 'table']);
  deepEq(G.sheets.map(s => s.key), ['station', 'organisation', 'caracterisation', 'pc-insitu', 'pc-prelevement', 'pezada', 'idgf', 'ichtyo-mercure', 'phyto']);
  deepEq(G.sheets[3].modules, ['instruments']);
  eq(G.sheets[4].mergeSections, true);
  deepEq(G.sheets[1].blocks.map(b => b.key), ['observations']);
  deepEq(G.sheets[2].blocks.map(b => b.key), ['observations', 'photos']);
  deepEq(G.sheets[3].blocks.find(b => b.key === 'conclusion').options.map(o => o[0]), ['C', 'NC', 'AC']);
  deepEq(G.sheets[4].blocks.find(b => b.key === 'conclusion').options.map(o => o[0]), ['C', 'NC', 'NA', 'RES']);
  deepEq(G.sheets[5].blocks.find(b => b.key === 'conclusion').fields, ['comments', 'date', 'controller', 'signature', 'providerSignature']);
  deepEq(G.sheets[8].blocks.find(b => b.key === 'conclusion').options.map(o => o[1]), ['Conforme', 'Non conforme', 'Sous réserve']);
  eq(G.sheets[0].kicker, 'Suivi biologique des eaux douces de surface de Guyane');
  eq(G.sheets[6].kicker, 'Fiche de contrôle terrain – Diatomées – IDGF');
});

test('BIO 2026 : nombre de critères par feuille, identifiants et codes uniques', () => {
  const count = no => itemsOfSheet(G, no).length;
  deepEq([1, 2, 3, 4, 5, 6, 7, 8, 9].map(count), [7, 31, 17, 17, 18, 13, 14, 17, 13]);
  deepEq(G.sections.filter(s => s.sheet === 2).map(s => s.items.length), [10, 8, 4, 5, 4]);
  const items = allItems(G);
  eq(new Set(items.map(i => i.id)).size, items.length, 'identifiants uniques');
  eq(new Set(items.map(i => i.code)).size, items.length, 'codes uniques');
  assert(items.every(i => i.id === `it-F${i.sheet}-${i.no}` && i.code === `F${i.sheet}.${i.no}`), 'id = it-F<feuille>-<no>, code = F<feuille>.<no>');
  // Numéros en double des maquettes corrigés
  eq(item('it-F3-17').short, 'REP_ME'); eq(item('it-F4-17').label, 'Rinçage des flacons'); eq(item('it-F9-13').short, 'A13');
  // Quelques libellés et références courtes
  eq(item('it-F4-12').label, 'Flaconnage conforme'); eq(item('it-F4-12').short, 'Flac');
  eq(item('it-F2-2.6').short, 'Non spé. non formés'); eq(item('it-F2-1.10').label, 'Difficulté d’accès');
  eq(item('it-F5-13').short, 'T° conservation'); eq(item('it-F6-3').label, 'Coordonnées amont (X / Y)');
  eq(item('it-F7-2').short, 'Fiche OK'); eq(item('it-F8-A7').label, 'Géoréférencement'); eq(item('it-F8-B7').icon, 'truck');
  deepEq(itemsOfSheet(G, 8).map(i => i.short), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
  deepEq(itemsOfSheet(G, 9).map(i => i.short), Array.from({ length: 13 }, (_, i) => 'A' + (i + 1)));
  deepEq(itemsOfSheet(G, 1).map(i => i.id), ['it-F1-R1', 'it-F1-R2', 'it-F1-R3', 'it-F1-R4', 'it-F1-R5', 'it-F1-R6', 'it-F1-R7']);
  // Critères de conformité : C / NC / N/A, obligatoires sauf F7.14
  const conf = items.filter(i => i.kind === 'conformity');
  assert(conf.every(i => i.responses.join() === 'C,NC,NA' && i.justifyOn.includes('NC')), 'réponses C / NC / N/A');
  deepEq(conf.filter(i => !i.required).map(i => i.id), ['it-F7-14']);
  // Sections « valeur seule » : F1 repères et F2 section 1 (sans statut)
  deepEq(G.sections.filter(s => s.columns === 'value').map(s => s.id), ['s-F1-reperes', 's-F2-1']);
  assert(G.sections.filter(s => s.columns === 'value').every(s => s.items.every(i => i.kind !== 'conformity')), 'valeur seule sans statut');
});

test('BIO 2026 : sections conditionnées par compartiment, domaines transport', () => {
  for (const s of G.sections) {
    const sheet = G.sheets.find(x => x.no === s.sheet);
    if (s.sheet === 1) { eq(s.condition, undefined, 'F1 sans condition'); continue; }
    deepEq(s.condition, { ctx: 'compartments', op: 'in', value: sheet.compartment }, s.id);
  }
  deepEq(G.sections.filter(s => s.sheet === 5).map(s => s.domain), ['prelevement', 'transport']);
  deepEq(itemsOfSheet(G, 5).filter(i => i.domain === 'transport').map(i => i.no), ['11', '12', '13', '14', '15', '16', '17', '18']);
  for (const id of ['it-F6-13', 'it-F7-13', 'it-F8-B7', 'it-F9-13']) eq(allItems(G).find(i => i.id === id).domain, 'transport', id);
  eq(allItems(G).find(i => i.id === 'it-F6-12').domain, 'prelevement');
  const f8 = G.sections.filter(s => s.sheet === 8);
  deepEq(f8.map(s => [s.no, s.theme]), [['A', 'ocean'], ['B', 'rust']]);
  eq(sectionHeaders(G.sections.find(s => s.id === 's-F3-infos')).label, 'Information');
  eq(sectionHeaders(G.sections.find(s => s.id === 's-F2-2')).short, 'Référence courte');
});

/* ---------- Formatage des valeurs ---------- */
test('formatValue : scalaires, unités, dates, choix, objets « fields »', () => {
  eq(formatValue(item('it-F4-4'), 7.2), '7,2 unité pH');
  eq(formatValue(item('it-F4-7'), '26.5'), '26,5 °C');
  eq(formatValue(item('it-F2-1.4'), '2026-10-09'), '09/10/2026');
  eq(formatValue(item('it-F2-1.5'), '08:30'), '08:30');
  eq(formatValue(item('it-F1-R5'), 'Pluie faible'), 'Pluie faible');
  eq(formatValue(item('it-F2-2.2'), 4), '4');
  eq(formatValue(item('it-F4-1'), ''), '');
  eq(formatValue(item('it-F9-1'), { nom: 'Dupont', fonction: 'Chef d’équipe' }), 'Nom : Dupont · Fonction : Chef d’équipe');
  eq(formatValue(item('it-F9-2'), { choix: 'Partielle' }), 'Partielle');
  eq(formatValue(item('it-F9-4'), { choix: 'Autre', autre: 'Pompe péristaltique' }), 'Autre : Pompe péristaltique');
  eq(formatValue(item('it-F9-4'), { choix: 'Intégré', autre: 'texte masqué' }), 'Intégré', 'champ showIf masqué');
  eq(formatValue(item('it-F9-5'), { volume: 500, unite: 'mL' }), 'Volume : 500 mL');
  eq(formatValue(item('it-F9-11'), { choix: 'Oui', t: 4.5 }), 'Oui · T° (si disponible) : 4,5 °C');
  eq(formatValue(item('it-F9-12'), { choix: 'Écart(s)', autre: 'flacon non rincé' }), 'Écart(s) : flacon non rincé');
  eq(formatValue(item('it-F6-3'), { x: 356714, y: 465112, lat: 4.2, lon: -52.3, accuracy: 8, at: '2026-10-09T12:00:00Z' }), 'X : 356714 · Y : 465112');
  eq(formatValue(item('it-F4-9'), { t1: 2.5, t2: '2.7', t3: '' }), 'Mesure 1 : 2,5 FNU · Mesure 2 : 2,7 FNU');
  eq(responseText(item('it-F9-1'), { status: 'C', value: { nom: 'Dupont' } }), 'Conforme · Nom : Dupont');
  eq(responseText(item('it-F4-12'), { status: 'NC' }), 'Non conforme');
  eq(responseText({ kind: 'number', unit: '°C' }, { value: 4.5 }), '4,5 °C', 'grilles générales');
  eq(responseText({ kind: 'boolean' }, { value: true }), 'Oui');
  eq(itemInput(item('it-F1-R5')).type, 'select');
  eq(itemInput(item('it-F4-12')).type, 'text');
});

/* ---------- Réponses à valeur objet, validation ---------- */
test('isAnswered / isEmptyValue : objets « fields » et critères de conformité', () => {
  const gps = item('it-F3-15');
  assert(isEmptyValue(gps, { x: '', y: '' }), 'objet vide');
  assert(!isEmptyValue(gps, { x: 356714, y: '' }), 'un champ renseigné');
  assert(isEmptyValue(item('it-F9-4'), { choix: '', autre: 'x' }), 'champ « Autre » masqué non compté');
  assert(!isEmptyValue(item('it-F9-4'), { choix: 'Autre', autre: '' }), 'choix renseigné');
  assert(!isAnswered(gps, { value: { x: 1, y: 2 } }), 'conformité : statut requis');
  assert(isAnswered(gps, { status: 'C', value: {} }), 'statut suffisant');
  assert(isAnswered(gps, { status: 'NA' }));
  const valueItem = { id: 'v', kind: 'fields', fields: [{ key: 'a', type: 'text' }, { key: 'b', type: 'number' }] };
  assert(!isAnswered(valueItem, { value: { a: ' ', b: null } }), 'valeur seule objet vide');
  assert(isAnswered(valueItem, { value: { b: 0 } }), 'zéro est une valeur');
  assert(isAnswered(item('it-F1-R3'), { value: 'Marie Dupont' }));
  assert(!isAnswered(item('it-F1-R3'), { value: '  ' }));
});

test('validation : NC ⇒ observation, obligatoires, bornes des nombres en avertissement', () => {
  const ctx = { compartments: ['organisation', 'physico'] };
  const issues = validateResponses(G, { 'it-F4-12': { status: 'NC' }, 'it-F4-4': { status: 'C', value: 15 }, 'it-F4-5': { status: 'C', value: 'abc' }, 'it-F4-9': { status: 'C', value: { t1: 'x' } } }, ctx);
  const of = id => issues.filter(i => i.itemId === id);
  assert(of('it-F4-12').some(i => i.level === 'error' && /justification/.test(i.message)), 'NC sans observation');
  assert(of('it-F4-4').some(i => i.level === 'warning' && /hors des bornes/.test(i.message) && /entre 0 et 14/.test(i.message)), 'pH hors bornes');
  assert(!of('it-F4-4').some(i => i.level === 'error'), 'hors bornes = avertissement seulement');
  assert(of('it-F4-5').some(i => i.level === 'error' && /numérique invalide/.test(i.message)));
  assert(of('it-F4-9').some(i => i.level === 'error' && /Mesure 1/.test(i.message)));
  assert(of('it-F4-13').some(i => /obligatoire/.test(i.message)), 'critère obligatoire manquant');
  assert(of('it-F2-1.1').some(i => /obligatoire/.test(i.message)), 'valeur seule obligatoire');
  assert(!issues.some(i => i.itemId === 'it-F7-1'), 'feuille non retenue ignorée');
  assert(!issues.some(i => i.itemId === 'it-F1-R7'), 'repère facultatif');
  const ok = validateResponses(G, { 'it-F4-12': { status: 'NC', comment: 'flacon fêlé' } }, ctx, { deviationsByItem: { 'it-F4-12': 1 } });
  assert(!ok.some(i => i.itemId === 'it-F4-12'), 'NC justifiée');
  eq(parseInputValue({ type: 'number' }, '7,25'), 7.25);
  eq(parseInputValue({ type: 'number' }, 'abc'), 'abc');
  eq(parseInputValue({ type: 'date' }, '09/10/2026'), '2026-10-09');
  eq(parseInputValue({ type: 'text' }, ''), '');
});

/* ---------- Alertes ---------- */
const auditOf = (responses, extra = {}) => ({ startedAt: '2026-10-09T12:00:00Z', responses, compartments: ALL, ...extra });

test('alerte température de conservation (F5.13) : attention, jamais de NC', () => {
  const run = (r, ctx = { compartments: ALL }) => computeAlerts({ audit: auditOf({ 'it-F5-13': r }), grid: G, ctx, site: ATHANASE });
  const a = run({ status: 'C', value: 11 }).find(x => x.code === 'TEMP_CONSERVATION');
  assert(a, 'alerte > 8 °C');
  eq(a.level, 'attention'); eq(a.itemId, 'it-F5-13'); eq(a.sheet, 5);
  eq(a.message, 'Température hors de la plage 5 ± 3 °C (NF EN ISO 5667-3)');
  assert(/11/.test(a.title), 'valeur dans le titre');
  assert(!('status' in a), 'aucune réponse de conformité');
  assert(run({ value: 1.5 }).some(x => x.code === 'TEMP_CONSERVATION'), '< 2 °C');
  assert(!run({ value: 5 }).some(x => x.code === 'TEMP_CONSERVATION'), 'dans la plage');
  assert(!run({ value: '' }).some(x => x.code === 'TEMP_CONSERVATION'), 'non renseigné');
  assert(!run({ status: 'NA', value: 12 }).some(x => x.code === 'TEMP_CONSERVATION'), 'N/A');
  assert(!run({ value: 12 }, { compartments: ['organisation'] }).some(x => x.code === 'TEMP_CONSERVATION'), 'feuille non retenue');
});

test('alerte règle sur un champ d’objet ({field})', () => {
  const grid = { id: 'g', name: 'g', sections: [{ id: 's', items: [{ id: 'i', code: 'I', label: 'Glacière', kind: 'conformity', input: { type: 'fields', fields: [{ key: 'choix', type: 'choice', options: ['Oui', 'Non'] }, { key: 't', label: 'T°', type: 'number', unit: '°C' }] }, alerts: [{ field: 't', op: 'gt', value: 8, code: 'T_GLACIERE', message: 'T° {value} °C' }] }] }] };
  const al = computeAlerts({ audit: auditOf({ i: { value: { choix: 'Oui', t: 9.5 } } }), grid });
  eq(al.find(a => a.code === 'T_GLACIERE')?.message, 'T° 9,5 °C');
  eq(computeAlerts({ audit: auditOf({ i: { value: { choix: 'Oui', t: 6 } } }), grid }).length, 0);
});

test('alerte GPS : distance UTM aux coordonnées théoriques au-delà du seuil de la grille', () => {
  eq(xyDistance({ x: 356714 + 300, y: 465112 + 400 }, ATHANASE), 500);
  eq(xyDistance({ x: '', y: 1 }, ATHANASE), null);
  const run = (v, grid = G, settings = {}) => computeAlerts({ audit: auditOf({ 'it-F6-3': { status: 'C', value: v } }), grid, ctx: { compartments: ALL }, site: ATHANASE, settings });
  const far = run({ x: 356714 + 300, y: 465112 + 400 }).find(a => a.code === 'GPS_XY_FAR');
  assert(far, 'écart de 500 m > 300 m');
  eq(far.level, 'attention'); eq(far.itemId, 'it-F6-3'); eq(far.sheet, 6);
  assert(/500 m/.test(far.message) && /300 m/.test(far.message), 'distance et seuil dans le message : ' + far.message);
  assert(!run({ x: 356714 + 150, y: 465112 + 200 }).some(a => a.code === 'GPS_XY_FAR'), '250 m < seuil 300 m');
  assert(!run({ x: 356714, y: '' }).some(a => a.code === 'GPS_XY_FAR'), 'coordonnées incomplètes');
  const noSetting = { ...G, settings: {} };
  assert(run({ x: 356714 + 150, y: 465112 + 200 }, noSetting, { gpsThresholdM: 100 }).some(a => a.code === 'GPS_XY_FAR'), 'seuil de l’organisation à défaut');
  assert(!computeAlerts({ audit: auditOf({ 'it-F6-3': { status: 'NA', value: { x: 1, y: 1 } } }), grid: G, site: ATHANASE }).some(a => a.code === 'GPS_XY_FAR'), 'N/A');
});

test('alerte calibration des sondes (F4) : plus de 30 jours ou postérieure à l’audit', () => {
  eq(calibrationStatus('2026-09-20', '2026-10-09').ok, true);
  eq(calibrationStatus('2026-08-01', '2026-10-09').days, 69);
  eq(calibrationStatus('2026-10-12', '2026-10-09').ok, false);
  eq(calibrationStatus('', '2026-10-09').ok, true);
  const sheets = { 4: { instruments: { ph: { model: 'WTW 3630', calibration: '2026-08-01' }, o2: { calibration: '2026-10-01' }, cond: { calibration: '2026-10-12' }, turb: { model: 'HI98703' } } } };
  const al = computeAlerts({ audit: auditOf({}, { sheets }), grid: G, ctx: { compartments: ALL } }).filter(a => a.code === 'CALIBRATION');
  deepEq(al.map(a => a.target.id).sort(), ['cond', 'ph']);
  assert(al.every(a => a.level === 'attention' && a.sheet === 4));
  assert(/69 jours/.test(al.find(a => a.target.id === 'ph').message));
  assert(/postérieure/.test(al.find(a => a.target.id === 'cond').message));
  eq(computeAlerts({ audit: auditOf({}, { sheets, compartments: ['organisation'] }), grid: G, ctx: { compartments: ['organisation'] } }).filter(a => a.code === 'CALIBRATION').length, 0, 'F4 non retenue');
});

/* ---------- Feuilles visibles ---------- */
test('sheetsOf : feuilles visibles selon les compartiments retenus', () => {
  deepEq(nos(sheetsOf(G, {}, { compartments: ['organisation'] })), [1, 2, 3]);
  deepEq(nos(sheetsOf(G, {}, { compartments: ['organisation', 'poissons'] })), [1, 2, 3, 8]);
  deepEq(nos(sheetsOf(G, {}, { compartments: ['phytoplancton'] })), [1, 2, 3, 9], 'organisation toujours');
  deepEq(nos(sheetsOf(G, {}, {})), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'défaut : tous');
  deepEq(nos(sheetsOf(G, {}, { compartments: [] })), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  deepEq(normalizeCompartments(G, ['poissons', 'inconnu', 'physico']), ['organisation', 'physico', 'poissons']);
  const f5 = sheetsOf(G, {}, { compartments: ALL }).find(s => s.no === 5);
  eq(f5.sections.length, 2); eq(f5.items.length, 18);
  assert(f5.sections.every(s => s.visible && s.items.every(i => i.visible)), 'sections et critères visibles');
  eq(sheetsOf({ id: 'x', sections: [] }, {}, {}).length, 0, 'grille sans feuilles');
  // Les critères des feuilles non retenues sont exclus de l'avancement global
  const p = progress(G, {}, { compartments: ['organisation'] });
  eq(p.total, 7 + 31 + 17);
  eq(visibleStructure(G, {}, { compartments: ['organisation'] }).filter(s => s.visible).length, 7);
});

test('sheetProgress : avancement et NC par feuille', () => {
  const resp = { 'it-F1-R1': { value: '2026-10-09' }, 'it-F2-1.1': { value: 'M. Dupont' }, 'it-F2-2.1': { value: 'HYDRECO' }, 'it-F2-2.2': { status: 'C', value: 4 }, 'it-F2-3.1': { status: 'NC', comment: 'gilets absents' }, 'it-F8-A1': { status: 'NA' } };
  const sp = sheetProgress(G, resp, { compartments: ['organisation', 'poissons'] });
  deepEq(Object.keys(sp).map(Number), [1, 2, 3, 8]);
  eq(sp[1].answered, 1); eq(sp[1].total, 7);
  eq(sp[2].answered, 3, 'valeur seule + 2 statuts (valeur sans statut non comptée)'); eq(sp[2].total, 31); eq(sp[2].nc, 1);
  eq(sp[8].answered, 1); eq(sp[8].total, 17); eq(sp[8].nc, 0);
  eq(sp[3].percent, 0);
});

/* ---------- Pré-remplissage ---------- */
test('prefillResponses : station, auditeur, prestataire, opérateurs, date et heure', () => {
  const r = prefillResponses(G, { site: ATHANASE, auditor: { name: 'Marie Dupont' }, provider: { name: 'HYDRECO' }, operators: [{ code: 'DB', lastName: 'DB', firstName: '' }, 'Jean Martin'], date: '2026-10-09', time: '08:30:12' });
  const v = id => r[id]?.value;
  eq(v('it-F3-3'), 'ATHANASE'); eq(v('it-F3-4'), '09271503'); eq(v('it-F3-1'), 'Approuague'); eq(v('it-F3-2'), 'Approuague');
  eq(v('it-F3-10'), '52'); eq(v('it-F3-6'), 'Orpaillage illégal'); eq(v('it-F3-12'), 'DB, Jean Martin');
  eq(v('it-F1-R1'), '2026-10-09'); eq(v('it-F1-R2'), '08:30'); eq(v('it-F1-R3'), 'Marie Dupont'); eq(v('it-F1-R4'), 'DB, Jean Martin');
  eq(v('it-F2-1.1'), 'Marie Dupont'); eq(v('it-F2-1.4'), '2026-10-09'); eq(v('it-F2-1.5'), '08:30'); eq(v('it-F2-2.1'), 'HYDRECO');
  assert(!('it-F3-5' in r) && !('it-F3-9' in r), 'valeurs vides non pré-remplies (Strahler, commune)');
  assert(Object.values(r).every(x => x.prefilled === true && !('status' in x)), 'marqué prefilled, sans statut');
  eq(Object.keys(r).length, 15, 'F1 : 4, F2 : 4, F3 : 7');
  // Opérateurs absents : équipe de la prestation
  eq(prefillResponses(G, { prestation: { team: 'Équipe A' } })['it-F1-R4'].value, 'Équipe A');
  // Les critères pré-remplis des feuilles 1 à 3 sont renseignés (valeur seule) mais pas « conformes »
  const sp = sheetProgress(G, r, { compartments: ['organisation'] });
  eq(sp[1].answered, 4); eq(sp[3].answered, 0);
});

/* ---------- Synthèse ---------- */
test('sheetSummary : décomptes par feuille et conclusion choisie par le contrôleur', () => {
  const audit = {
    gridSnapshot: G, compartments: ['organisation', 'physico'],
    responses: { 'it-F4-1': { status: 'C' }, 'it-F4-2': { status: 'NC', comment: 'x' }, 'it-F4-3': { status: 'NA' }, 'it-F5-1': { status: 'C' }, 'it-F1-R3': { value: 'M. D.' } },
    sheets: { 4: { conclusion: { status: 'AC', comments: 'à revoir' } }, 5: { conclusion: { status: 'RES' } } }
  };
  const s = sheetSummary({ audit });
  deepEq(s.map(x => x.no), [1, 2, 3, 4, 5]);
  const f4 = s.find(x => x.no === 4);
  eq(f4.C, 1); eq(f4.NC, 1); eq(f4.NA, 1); eq(f4.unanswered, 14); eq(f4.total, 17);
  eq(f4.conclusion, 'AC'); eq(f4.conclusionLabel, 'À compléter'); eq(f4.comments, 'à revoir'); eq(f4.theme, 'peach');
  eq(f4.hint, '1 NC sur cette feuille');
  eq(s.find(x => x.no === 5).conclusionLabel, 'À compléter / Réserve');
  const f1 = s.find(x => x.no === 1);
  eq(f1.total, 0); eq(f1.values, 1); eq(f1.conclusion, '');
  const g = auditSummary({ audit, grid: G, ctx: { compartments: audit.compartments } });
  assert(!('score' in g), 'synthèse sans score');
  eq(g.sheets.length, 5); eq(g.counts.NC, 1);
  eq(sheetSummary({ audit: { gridSnapshot: DEFAULT_GRIDS[1], responses: {} } }).length, 0, 'grille par sections');
});

test('comparaison : valeurs objet comparées sous forme lisible', () => {
  const a = { gridSnapshot: G, responses: { 'it-F6-3': { status: 'C', value: { x: 1, y: 2, lat: 4.1 } }, 'it-F4-12': { status: 'NC' } } };
  const b = { gridSnapshot: G, responses: { 'it-F6-3': { status: 'C', value: { x: 1, y: 2, lat: 4.2 } }, 'it-F4-12': { status: 'C' } } };
  const r = compareAudits(a, b);
  eq(r.rows.find(x => x.code === 'F6.3').change, 'identique');
  eq(r.rows.find(x => x.code === 'F4.12').change, 'amelioration');
  const c = { gridSnapshot: G, responses: { 'it-F6-3': { status: 'C', value: { x: 5, y: 2 } } } };
  eq(compareAudits(a, c).rows.find(x => x.code === 'F6.3').change, 'modifie');
});

/* ---------- Référentiel des stations et programme BIO 2026 ---------- */
test('référentiel : stations BIO enrichies et programme RCS ESC BIO 2026 (38 prestations)', async () => {
  const res = await fetch(new URL('../../data/referentiel-oeg.json', import.meta.url));
  const DATA = await res.json();
  const ref = oegReferential(DATA);
  const ath = ref.site.find(s => s.code === '09271503');
  eq(ath.riverName, 'Approuague'); eq(ath.her, 52); eq(ath.typo, 'Fleuve'); eq(ath.bassin, 'Approuague');
  deepEq(ath.bioLists, ['BIO_CE', 'BIO_FISH', 'BIO_PHYTO']);
  deepEq(ath.compartments, ALL);
  eq(ath.photos.RD.src, 'img/stations/09271503/RD.jpg'); eq(ath.photos.RG.caption, 'Berge rocheuse');
  deepEq(ath.access.modes, ['Bateau motorisé / pirogue']); eq(ath.difficulties, 'Roches, Saut Tourépé.');
  const other = ref.site.find(s => s.code === '09160201');
  eq(other.riverName, ''); deepEq(other.photos, {}); eq(other.access.summary, ''); eq(other.difficulties, '');
  deepEq(other.compartments, bioCompartments(other.bioLists));
  const nonBio = ref.site.find(s => !s.networks.includes('BIO'));
  deepEq(nonBio.bioLists, []); deepEq(nonBio.compartments, []);
  deepEq(bioCompartments(['BIO_FISH']), ['organisation', 'poissons']);
  const camp = ref.campaign.find(c => c.id === 'camp-BIO-2026');
  deepEq([camp.label, camp.network, camp.start, camp.end], ['RCS ESC BIO 2026', 'BIO', '2026-09-01', '2026-12-15']);
  const prog = bioProgramme(DATA);
  eq(prog.length, 38);
  eq(new Set(prog.map(p => p.id)).size, 38);
  assert(prog.every(p => p.id === 'pres-BIO-2026-' + p.siteId.slice(5) && p.providerId === 'prov-HYDRECO' && p.samplingTypeId === 'stype-HYDROBIO' && p.matrixId === 'mat-ESU'), 'prestations HYDRECO');
  assert(prog.every(p => p.plannedDate === '' && p.dateIndicative === true && p.controlLevel === 'complet' && p.status === 'prevue' && p.source.kind === 'programme-bio-2026' && p.campaignId === BIO_CAMPAIGN.id), 'à planifier');
  assert(prog.every(p => ref.site.some(s => s.id === p.siteId) && ref.point.some(pt => pt.id === p.pointIds[0])), 'sites et points existants');
  deepEq(bioProgramme(DATA), prog, 'identifiants et contenu déterministes');
});
