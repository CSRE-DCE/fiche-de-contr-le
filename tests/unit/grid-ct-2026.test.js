/* Tests unitaires de la grille unique CT-2026 (hydrobiologie, cours d'eau, eaux souterraines) et du domaine
 * des tournées (modules purs) : structure et feuilles par type de tournée, conditions par type et sur un champ
 * d'objet, échelle C / P / NC / N/A, grille effective (expansion par station, critères partagés comptés une fois),
 * pré-remplissage et alertes par station, synthèse par feuille / station / tournée, logique des stations,
 * traçabilité des fiches d'évaluation (table d'en-tête de grid-ct-2026.js), référentiel et programmes 2026, turbidité en
 * NTU (version 1.1) et mise à niveau des grilles par défaut enregistrées (replaceGridUnits, upgradeStoredGrid). */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_CT_2026, INSTRUMENTS_ESO } from '../../js/domain/grid-ct-2026.js';
import { DEFAULT_GRIDS, CT_GRID_ID, GRID_GENERAL, DEFAULT_GRID_IDS, upToDateGrid } from '../../js/domain/default-grids.js';
import { RESPONSES, formatValue, responseText, isEmptyValue, itemInput, fieldShown, defaultCriticality, BILAN_OPTIONS } from '../../js/domain/model.js';
import {
  validateGrid, allItems, itemIndex, isAnswered, validateResponses, progress, visibleStructure, sheetsOf, sheetProgress, stationProgress,
  itemsOfSheet, normalizeCompartments, prefillResponses, sectionHeaders, expandGrid, groupSheets, sheetStoreKey, headerTitle, headerOf,
  inferAuditType, auditCompartments, typeCompartments, withCompartments, evalCondition, conditionErrors, parseItemId, stationKeyOf, makeStation,
  stationEntries, isEnteredResponse, suggestedValue, durationText, needsJustification,
  replaceGridUnits, upgradeStoredGrid, compareVersions, UNIT_REPLACEMENTS
} from '../../js/domain/grids.js';
import { computeAlerts, calibrationStatus, xyDistance } from '../../js/domain/rules.js';
import { sheetSummary, stationSummary, auditSummary, recurringDeviations } from '../../js/domain/summary.js';
import { compareAudits } from '../../js/domain/compare.js';
import { parseInputValue } from '../../js/domain/normalize.js';
import { oegReferential, bioProgramme, ceProgramme, bioCompartments, esoUsage, BIO_CAMPAIGN, baseReferential } from '../../js/domain/seed.js';
import { canonicalJSON } from '../../js/core/util.js';

const G = GRID_CT_2026;
const IDX = itemIndex(G);
const item = id => IDX.get(id);
const ATHANASE = { id: 'site-09271503', code: '09271503', name: 'Athanase', bassin: 'Approuague', riverName: 'Approuague', commune: '', her: 52, strahler: '', pressions: 'Orpaillage illégal', x: 356714, y: 465112, matrixId: 'mat-ESU' };
const ACAROUANY = { id: 'site-09160201', code: '09160201', name: 'Acarouany', bassin: 'Mana', riverName: '', commune: 'Mana', her: 51, pressions: 'Agriculture', x: 188010, y: 622135, matrixId: 'mat-ESU' };
const MARIPA = { id: 'site-BSS002PANK', code: 'BSS002PANK', name: 'AEP Maripasoula', commune: 'Maripasoula', pressions: 'Urbaine', x: 163100, y: 402750, matrixId: 'mat-ESO', codeType: 'BSS' };
const SITES = { [ATHANASE.id]: ATHANASE, [ACAROUANY.id]: ACAROUANY, [MARIPA.id]: MARIPA };
const BIO_ALL = ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'];
const nos = sheets => sheets.map(s => s.no);
const ctxOf = auditType => ({ auditType, compartments: typeCompartments(G, auditType) });
const visibleIds = (grid, ctx, responses = {}) => new Set(visibleStructure(grid, responses, ctx).filter(s => s.visible).flatMap(s => s.visibleItems.map(i => i.id)));

/* ---------- Structure de la grille ---------- */
test('CT-2026 : grille en tête des grilles par défaut, structurellement valide, types de tournée', () => {
  eq(DEFAULT_GRIDS[0], G, 'CT-2026 en tête de DEFAULT_GRIDS');
  eq(CT_GRID_ID, 'grid-ct-2026-v1');
  assert(DEFAULT_GRIDS.some(g => g.code === 'GR-PREL-EAU') && DEFAULT_GRIDS.some(g => g.code === 'GR-RAPIDE'), 'grilles générales conservées');
  for (const g of DEFAULT_GRIDS) deepEq(validateGrid(g), [], g.code);
  eq(G.id, 'grid-ct-2026-v1'); eq(G.code, 'CT-2026'); eq(G.layout, 'sheets'); eq(G.status, 'publiee');
  eq(G.name, 'Contrôle terrain des prestations de prélèvement – 2026');
  deepEq(G.types.map(t => [t.key, t.codeType]), [['bio', 'SANDRE'], ['ce', 'SANDRE'], ['eso', 'BSS']]);
  deepEq(G.types.find(t => t.key === 'ce').matrixCodes, ['ESU', 'PLE', 'EL']);
  deepEq(G.types.map(t => t.compartments), [['physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'], ['physico'], ['eso']]);
  deepEq(G.compartments.map(c => c.key), ['organisation', 'physico', 'eso', 'invertebres', 'diatomees', 'poissons', 'phytoplancton']);
  eq(G.compartments.find(c => c.key === 'eso').icon, 'drop');
  deepEq(G.providers, ['prov-TL1', 'prov-OEG', 'prov-HYDRECO', 'prov-NBC']);
  eq(G.settings.gpsThresholdM, 300);
});

test('CT-2026 : feuilles (ordre, n° stables, portée, thèmes, compartiments, F10 eaux souterraines)', () => {
  deepEq(nos(G.sheets), [1, 2, 3, 10, 4, 5, 6, 7, 8, 9], 'ordre d’affichage');
  deepEq(G.sheets.map(s => s.scope), ['station', 'tournee', 'station', 'station', 'station', 'station', 'station', 'station', 'station', 'station']);
  deepEq(G.sheets.map(s => s.theme), ['ocean', 'navy', 'green', 'slate', 'peach', 'orange', 'violet', 'sky', 'ocean', 'teal']);
  const f10 = G.sheets.find(s => s.no === 10);
  deepEq([f10.key, f10.tab, f10.title, f10.compartment], ['eso-ouvrage', 'Ouvrage et purge', 'Eau souterraine – ouvrage, pompage et purge', 'eso']);
  deepEq(G.sheets.find(s => s.no === 4).compartments, ['physico', 'eso']);
  deepEq(G.sheets.find(s => s.no === 5).compartments, ['physico', 'eso']);
  for (const s of G.sections.filter(x => x.sheet === 4 || x.sheet === 5)) deepEq(s.condition, { any: [{ ctx: 'compartments', op: 'in', value: 'physico' }, { ctx: 'compartments', op: 'in', value: 'eso' }] }, s.id);
  deepEq(G.sheets.find(s => s.no === 4).tourneeData, ['instruments']);
  // Encadrés : conclusions biologiques inchangées, « Bilan » pour cours d'eau / eaux souterraines
  const blocks = no => G.sheets.find(s => s.no === no).blocks;
  deepEq(blocks(4).filter(b => b.key === 'conclusion').map(b => [b.title, b.showFor]), [['Conclusion générale', ['bio']], ['Bilan – Mesures in situ, étalonnage et flaconnage', ['ce']], ['Bilan – Purge et mesure des paramètres in situ', ['eso']]]);
  deepEq(blocks(3).find(b => b.key === 'conclusion').title, 'Bilan – Localisation et accès au site');
  deepEq(blocks(3).find(b => b.key === 'conclusion').showFor, ['ce', 'eso']);
  assert(!blocks(10).some(b => b.key === 'conclusion'), 'F10 : le bilan purge + mesures in situ est porté par F4 (eaux souterraines)');
  deepEq(blocks(4).find(b => b.showFor?.includes('eso')).options, BILAN_OPTIONS);
  deepEq(BILAN_OPTIONS, [['C', 'Satisfaisant'], ['P', 'Perfectible'], ['NC', 'Non satisfaisant']]);
  deepEq(blocks(5).filter(b => b.key === 'conclusion').map(b => b.title), ['Conclusion du contrôle', 'Bilan – Échantillonnage et identification des échantillons']);
  deepEq(blocks(6).find(b => b.key === 'conclusion').options.map(o => o[0]), ['C', 'NC', 'NA'], 'F6 inchangée');
  eq(blocks(2)[0].title, 'Observations / non-conformités / actions demandées');
});

test('CT-2026 : critères (identifiants, codes, échelle C / P / NC / N/A, nombre par feuille, libellés sans doublon)', () => {
  const items = allItems(G);
  eq(new Set(items.map(i => i.id)).size, items.length, 'identifiants uniques');
  eq(new Set(items.map(i => i.code)).size, items.length, 'codes uniques');
  assert(items.every(i => i.id === `it-F${i.sheet}-${i.no}` && i.code === `F${i.sheet}.${i.no}`), 'id = it-F<feuille>-<no>, code = F<feuille>.<no>');
  deepEq([1, 2, 3, 10, 4, 5, 6, 7, 8, 9].map(no => itemsOfSheet(G, no).length), [8, 47, 33, 7, 31, 30, 13, 14, 17, 13]);
  deepEq(G.sections.filter(s => s.sheet === 2).map(s => s.items.length), [13, 8, 5, 6, 8, 4, 3]);
  const conf = items.filter(i => i.kind === 'conformity');
  assert(conf.every(i => i.responses.join() === 'C,P,NC,NA' && i.justifyOn.join() === 'P,NC'), 'échelle C / P / NC / N/A partout, observation pour P et NC');
  deepEq(conf.filter(i => !i.required).map(i => i.id), ['it-F7-14']);
  // Libellés sans doublon dans une même feuille (seuls « Heure début » / « Heure fin » des sections 1 et 5 de la maquette F2)
  const MAQUETTE = new Set(['F2:Heure début', 'F2:Heure fin']);
  for (const sh of G.sheets) {
    const seen = new Map();
    for (const it of itemsOfSheet(G, sh.no)) {
      const k = it.label.toLocaleLowerCase('fr');
      assert(!seen.has(k) || MAQUETTE.has(`F${sh.no}:${it.label}`), `libellé en double dans F${sh.no} : ${it.label}`);
      seen.set(k, it.id);
    }
  }
  // Critères de tournée dans les feuilles station
  const shared = items.filter(i => i.scope === 'tournee').map(i => i.code);
  deepEq(shared, ['F4.2', 'F4.18', 'F4.19', 'F4.20', 'F4.21', 'F4.22', 'F4.23', 'F4.24', 'F4.25', 'F5.11', 'F5.12', 'F5.14', 'F5.15', 'F5.17', 'F5.18', 'F5.29', 'F5.30']);
  // Libellés et numérotation des ajouts (SPEC2 § E)
  eq(item('it-F1-R2').label, 'Heure d’arrivée sur site'); eq(item('it-F1-R8').label, 'Heure de départ du site');
  eq(item('it-F2-1.11').prefill, 'audit.kind'); eq(item('it-F2-5.6').prefill, 'tournee.stationCount');
  eq(item('it-F3-18').prefill, 'site.code'); eq(item('it-F3-29').kind, 'select'); eq(item('it-F3-33').kind, 'longtext');
  eq(item('it-F10-1').kind, 'select'); eq(item('it-F10-2').kind, 'fields'); eq(item('it-F10-3').kind, 'conformity');
  eq(item('it-F4-29').input.unit, 'mV'); eq(item('it-F5-28').domain, 'transport'); eq(item('it-F2-7.3').domain, 'transport');
  // Les numéros des maquettes restent corrigés
  eq(item('it-F3-17').short, 'REP_ME'); eq(item('it-F4-17').label, 'Rinçage des flacons'); eq(item('it-F9-13').short, 'A13');
  deepEq(itemsOfSheet(G, 8).map(i => i.short), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
});

/* ---------- Feuilles par type de tournée ---------- */
test('feuilles affichées par type de tournée et numéro « Feuille X / N »', () => {
  const bio = sheetsOf(G, {}, { auditType: 'bio', compartments: BIO_ALL });
  deepEq(nos(bio), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'biologie complète : F1 à F9');
  deepEq(bio.map(s => s.index), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'numéros identiques aux maquettes');
  assert(bio.every(s => s.total === 9));
  const ce = sheetsOf(G, {}, ctxOf('ce'));
  deepEq(nos(ce), [1, 2, 3, 4, 5]); deepEq(ce.map(s => `${s.index}/${s.total}`), ['1/5', '2/5', '3/5', '4/5', '5/5']);
  const eso = sheetsOf(G, {}, ctxOf('eso'));
  deepEq(nos(eso), [1, 2, 3, 10, 4, 5]); deepEq(eso.map(s => s.index), [1, 2, 3, 4, 5, 6]);
  deepEq(nos(sheetsOf(G, {}, { auditType: 'bio', compartments: ['organisation', 'poissons'] })), [1, 2, 3, 8]);
  deepEq(nos(sheetsOf(G, {}, {})), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'défaut : biologie, tous ses compartiments');
  deepEq(nos(sheetsOf(G, {}, { compartments: ['organisation', 'eso'] })), [1, 2, 3, 10, 4, 5], 'type déduit des compartiments');
  // Nombre de critères visibles par type
  const counts = sheets => sheets.map(s => s.items.length);
  deepEq(counts(bio), [8, 47, 27, 28, 29, 13, 14, 17, 13]);
  deepEq(counts(ce), [8, 47, 23, 28, 29]);
  deepEq(counts(eso), [7, 46, 25, 6, 30, 25], 'F4.11 masqué en eaux souterraines (couvert par F4.30)');
  // Variantes (titres, onglets, appareils) et encadrés selon le type
  eq(ce.find(s => s.no === 2).title, 'Organisation, logistique et sécurité de la tournée');
  eq(bio.find(s => s.no === 2).title, 'Organisation, sécurité et déroulé de mission', 'titre biologie inchangé');
  eq(eso.find(s => s.no === 3).tab, 'Station et site');
  deepEq(eso.find(s => s.no === 4).instruments.map(i => i.key), INSTRUMENTS_ESO.map(i => i.key));
  assert(eso.find(s => s.no === 4).instruments.some(i => i.key === 'redox'), 'redox pour eso');
  assert(!bio.find(s => s.no === 4).instruments.some(i => i.key === 'redox'));
  deepEq(bio.find(s => s.no === 4).blocks.map(b => b.title), ['Observations / non-conformités / actions demandées :', 'Conclusion générale']);
  deepEq(ce.find(s => s.no === 4).blocks.find(b => b.key === 'conclusion').options.map(o => o[1]), ['Satisfaisant', 'Perfectible', 'Non satisfaisant']);
  assert(!bio.find(s => s.no === 3).blocks.some(b => b.key === 'conclusion'), 'pas de bilan F3 en biologie');
  eq(eso.find(s => s.no === 3).blocks.find(b => b.key === 'conclusion').title, 'Bilan – Localisation et accès au site');
});

test('conditions par type de tournée : critères masqués pour eso / ce, ajouts eso', () => {
  const bio = visibleIds(G, { auditType: 'bio', compartments: BIO_ALL }), ce = visibleIds(G, ctxOf('ce')), eso = visibleIds(G, ctxOf('eso'));
  for (const no of [1, 2, 4]) { assert(!eso.has(`it-F3-${no}`), `F3.${no} masqué pour eso`); assert(ce.has(`it-F3-${no}`)); }
  for (const no of [5, 10, 11, 17]) { assert(bio.has(`it-F3-${no}`), `F3.${no} biologie`); assert(!ce.has(`it-F3-${no}`) && !eso.has(`it-F3-${no}`), `F3.${no} biologie uniquement`); }
  for (const id of ['it-F3-18', 'it-F3-29', 'it-F3-30', 'it-F3-31', 'it-F3-32', 'it-F3-33', 'it-F4-29', 'it-F4-30', 'it-F4-31', 'it-F5-24', 'it-F10-1', 'it-F10-7']) {
    assert(eso.has(id), `${id} visible pour eso`); assert(!ce.has(id) && !bio.has(id), `${id} masqué hors eso`);
  }
  for (const id of ['it-F5-4', 'it-F5-5', 'it-F5-6', 'it-F5-19', 'it-F5-20', 'it-F3-20', 'it-F1-R6', 'it-F2-1.8']) { assert(!eso.has(id), `${id} masqué pour eso`); assert(ce.has(id) && bio.has(id)); }
  for (const id of ['it-F3-19', 'it-F3-22', 'it-F3-27', 'it-F4-26', 'it-F4-28', 'it-F5-25', 'it-F5-26', 'it-F5-27', 'it-F5-28', 'it-F2-6.1', 'it-F2-7.3']) assert(bio.has(id) && ce.has(id) && eso.has(id), `${id} commun aux trois types`);
  assert(!ce.has('it-F6-1') && !eso.has('it-F6-1') && bio.has('it-F6-1'), 'feuilles biologiques');
  // Type et compartiments
  eq(inferAuditType(G, { prestation: { samplingTypeId: 'stype-HYDROBIO' } }), 'bio');
  eq(inferAuditType(G, { site: MARIPA }), 'eso');
  eq(inferAuditType(G, { site: { types: ['bio', 'ce'] }, prestation: { samplingTypeId: 'stype-PC' } }), 'ce');
  eq(inferAuditType(G, { prestation: { auditType: 'ce' } }), 'ce');
  deepEq(auditCompartments(G, 'bio', ['poissons', 'eso']), ['organisation', 'poissons'], 'compartiments limités au type');
  deepEq(auditCompartments(G, 'ce', ['invertebres']), ['organisation', 'physico']);
  deepEq(auditCompartments(G, 'eso'), ['organisation', 'eso']);
  deepEq(auditCompartments(G, 'bio'), BIO_ALL);
  deepEq(withCompartments(G, {}).auditType, 'bio');
  deepEq(normalizeCompartments(G, ['poissons', 'inconnu', 'physico']), ['organisation', 'physico', 'poissons']);
});

test('en-tête dynamique : prestataire et programme (campagne ou type de tournée)', () => {
  eq(headerTitle(G, { provider: { name: 'HYDRECO', kind: 'prestataire' }, auditType: 'bio' }), 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026');
  eq(headerTitle(G, { provider: { code: 'OEG', name: 'Office de l’Eau de Guyane', kind: 'regie' }, auditType: 'ce' }), 'Contrôle terrain prestataire – OEG en régie – Physico-chimie des cours d’eau 2026');
  eq(headerTitle(G, { provider: 'NBC', auditType: 'eso', campaign: { label: 'ESO — Novembre 2026' } }), 'Contrôle terrain prestataire – NBC – ESO — Novembre 2026');
  eq(headerTitle(G, { auditType: 'eso' }), 'Contrôle terrain prestataire – Surveillance des eaux souterraines 2026', 'prestataire absent omis');
  eq(headerOf(G, { auditType: 'bio' }).subtitle, 'Fiche station de contrôle terrain');
  eq(headerOf(G, { auditType: 'eso' }).subtitle, 'Fiche de contrôle terrain');
  eq(headerOf(G, { auditType: 'bio' }).program, 'Suivi biologique des eaux douces de surface de Guyane');
  eq(headerOf(G, { auditType: 'bio' }).website, 'www.eauguyane.fr');
});

/* ---------- Échelle P ---------- */
test('échelle C / P / NC / N/A : réponse P, observation obligatoire, décomptes, criticité proposée', () => {
  deepEq(RESPONSES.P, { label: 'Perfectible', short: 'P', cls: 'perf', icon: '≈' });
  const it = item('it-F4-12');
  assert(needsJustification(it, { status: 'P' }) && needsJustification(it, { status: 'NC' }) && !needsJustification(it, { status: 'C' }));
  const ctx = ctxOf('ce');
  const issues = validateResponses(G, { 'it-F4-12': { status: 'P' }, 'it-F4-13': { status: 'P', comment: 'à améliorer' } }, ctx);
  assert(issues.some(i => i.itemId === 'it-F4-12' && i.level === 'error' && /justification obligatoire \(point perfectible\)/.test(i.message)), 'P sans observation');
  assert(!issues.some(i => i.itemId === 'it-F4-13' && /justification/.test(i.message)), 'P justifié');
  assert(!issues.some(i => i.itemId === 'it-F4-12' && /sans écart/.test(i.message)), 'pas d’écart attendu pour un P');
  eq(responseText(it, { status: 'P', value: 'x' }), 'Perfectible · x');
  eq(defaultCriticality('P'), 'OBS'); eq(defaultCriticality('NC'), 'MIN');
  eq(sectionHeaders(G.sections.find(s => s.id === 's-F2-2')).p, 'P');
  const a = { gridSnapshot: G, responses: { 'it-F4-12': { status: 'NC' } } }, b = { gridSnapshot: G, responses: { 'it-F4-12': { status: 'P' } } }, c = { gridSnapshot: G, responses: { 'it-F4-12': { status: 'C' } } };
  eq(compareAudits(a, b).rows.find(r => r.code === 'F4.12').change, 'amelioration', 'NC → P');
  eq(compareAudits(c, b).rows.find(r => r.code === 'F4.12').change, 'degradation', 'C → P');
});

/* ---------- Conditions sur un champ d'objet ---------- */
test('condition sur un champ d’objet : vigilance gaz d’échappement (F10.4) selon l’alimentation de la pompe (F10.3)', () => {
  const ctx = ctxOf('eso');
  const vis = r => visibleIds(G, ctx, { 'it-F10-3': r }).has('it-F10-4');
  assert(!vis(undefined), 'masqué sans réponse');
  assert(vis({ status: 'C', value: { installee: 'Oui', alimentation: 'Véhicule' } }), 'véhicule');
  assert(vis({ status: 'C', value: { installee: 'Oui', alimentation: 'Groupe électrogène' } }), 'groupe électrogène');
  assert(!vis({ status: 'C', value: { installee: 'Oui', alimentation: 'Batterie portative' } }), 'batterie');
  assert(!vis({ status: 'C', value: { installee: 'Non', alimentation: 'Véhicule' } }), 'champ masqué (showIf) : non pris en compte');
  assert(!vis({ status: 'NA', value: { installee: 'Oui', alimentation: 'Véhicule' } }), 'N/A');
  const idx = itemIndex(G);
  eq(evalCondition({ item: 'it-F10-3', field: 'alimentation', op: 'answered' }, { 'it-F10-3': { value: { installee: 'Oui', alimentation: 'Véhicule' } } }, idx), true);
  deepEq(conditionErrors({ item: 'it-F10-3', field: 'inconnu', op: 'eq', value: 1 }, idx), ['condition : champ « inconnu » absent du critère « it-F10-3 »']);
  // showIf : liste de conditions (l'une suffit) et liste de valeurs
  const acces = item('it-F10-2').fields.find(f => f.key === 'acces');
  assert(fieldShown(acces, { pompe: 'Non' }) && fieldShown(acces, { pompe: 'Oui', etat: 'Non fonctionnelle' }) && !fieldShown(acces, { pompe: 'Oui', etat: 'Mise en route par le préleveur' }));
  assert(fieldShown({ showIf: { key: 'a', value: ['x', 'y'] } }, { a: 'y' }) && !fieldShown({ showIf: { key: 'a', value: ['x'] } }, { a: 'z' }));
  eq(formatValue(item('it-F10-2'), { pompe: 'Non', acces: 'Autre', accesAutre: 'trop-plein', etat: 'masqué' }), 'Ouvrage équipé d’une pompe à demeure : Non · Accès à l’eau : Autre · Autre accès : trop-plein');
  eq(formatValue(item('it-F4-17'), { troisFois: 'Oui', bouchons: 'Non' }), 'Rinçage trois fois : Oui · Rinçage des bouchons : Non');
});

/* ---------- Grille effective (tournée) ---------- */
test('expansion à une station : identifiants suffixés, critères partagés inchangés, mêmes décomptes que la grille de base', () => {
  const E = expandGrid(G, [{ siteId: ATHANASE.id }], SITES, { provider: { name: 'HYDRECO' } });
  assert(E.expanded && E.stations.length === 1);
  deepEq(E.stations[0], { key: '09271503', index: 0, siteId: ATHANASE.id, name: 'Athanase', code: '09271503', matrixCode: 'ESU' });
  const idx = itemIndex(E);
  const f45 = idx.get('it-F4-5@09271503');
  deepEq([f45.code, f45.baseId, f45.baseCode, f45.station.key], ['F4.5·S1', 'it-F4-5', 'F4.5', '09271503']);
  eq(idx.get('it-F4-2').shared, true, 'F4.2 partagé'); eq(idx.get('it-F4-2').code, 'F4.2');
  assert(idx.get('it-F2-1.1') && !idx.get('it-F2-1.1@09271503'), 'feuille tournée non dupliquée');
  eq(idx.get('it-F1-R4@09271503').label, 'Opérateurs HYDRECO', 'libellé complété avec le prestataire');
  eq(item('it-F1-R4').label, 'Opérateurs du prestataire');
  const ctx = { auditType: 'bio', compartments: BIO_ALL };
  const sheets = sheetsOf(E, {}, ctx);
  deepEq(sheets.map(s => s.instanceKey), ['1@09271503', '2', '3@09271503', '4@09271503', '5@09271503', '6@09271503', '7@09271503', '8@09271503', '9@09271503']);
  deepEq(sheets.map(s => s.index), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq(progress(E, {}, ctx).total, progress(G, {}, ctx).total, 'une station : même nombre de critères');
  deepEq(sheetsOf(G, {}, ctx).map(s => s.instanceKey), ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 'grille non développée : instanceKey = n°');
  eq(expandGrid(G, []), G, 'sans station : inchangée');
  eq(expandGrid(DEFAULT_GRIDS[1], [{ siteId: 'site-X' }]), DEFAULT_GRIDS[1], 'grille historique : inchangée');
  deepEq(parseItemId('it-F4-5@09271503'), { baseId: 'it-F4-5', stationKey: '09271503' });
  deepEq(parseItemId('it-F2-1.1'), { baseId: 'it-F2-1.1', stationKey: null });
  eq(stationKeyOf('site-BSS002PANK'), 'BSS002PANK');
  deepEq(makeStation({ siteId: 'site-09271503', prestationId: 'p1' }, 'T'), { key: '09271503', siteId: 'site-09271503', pointId: null, prestationId: 'p1', addedAt: 'T' });
});

test('expansion à trois stations : critères partagés comptés une fois, avancement par feuille et par station', () => {
  const stations = [{ siteId: MARIPA.id }, { siteId: 'site-BSS002PAAX' }, { siteId: 'site-BSS002NZDT' }];
  const E = expandGrid(G, stations, SITES);
  const ctx = ctxOf('eso');
  const struct = visibleStructure(E, {}, ctx).filter(s => s.visible);
  const shown = struct.flatMap(s => s.visibleItems);
  const own = shown.filter(i => !i.shared);
  eq(new Set(own.map(i => i.id)).size, own.length, 'identifiants propres uniques après expansion');
  const sharedShown = shown.filter(i => i.shared);
  const sharedIds = new Set(sharedShown.map(i => i.id));
  eq(sharedIds.size, 17); eq(sharedShown.length, 17 * 3, 'chaque critère partagé affiché dans chaque station');
  const all = allItems(E);
  eq(new Set(all.map(i => i.id)).size, all.length, 'allItems : chaque critère une fois');
  const base = progress(G, {}, ctx).total;
  const tournee = 46 + 17, perStation = base - tournee;
  eq(progress(E, {}, ctx).total, tournee + 3 * perStation, 'critères partagés comptés une fois');
  const sheets = sheetsOf(E, {}, ctx);
  deepEq(sheets.map(s => s.instanceKey).slice(0, 7), ['1@BSS002PANK', '2', '3@BSS002PANK', '10@BSS002PANK', '4@BSS002PANK', '5@BSS002PANK', '1@BSS002PAAX']);
  eq(sheets.length, 1 + 5 * 3);
  deepEq(sheets.filter(s => s.no === 10).map(s => `${s.index}/${s.total}`), ['4/6', '4/6', '4/6'], 'rang affiché identique pour chaque station');
  const g = groupSheets(sheets);
  deepEq(g.tournee.map(s => s.instanceKey), ['2']);
  deepEq(g.stations.map(x => [x.station.key, x.sheets.length]), [['BSS002PANK', 5], ['BSS002PAAX', 5], ['BSS002NZDT', 5]]);
  const f4b = sheets.find(s => s.instanceKey === '4@BSS002PAAX');
  eq(sheetStoreKey(f4b, 'instruments'), '4', 'appareils : donnée de tournée'); eq(sheetStoreKey(f4b, 'agents'), '4@BSS002PAAX');
  // Une réponse partagée compte dans chaque fiche station mais une seule fois au global
  const resp = { 'it-F4-18': { status: 'C' }, 'it-F4-5@BSS002PAAX': { status: 'NC', comment: 'sonde HS' }, 'it-F5-11': { status: 'P', comment: 'glacière usée' } };
  const sp = sheetProgress(E, resp, ctx);
  eq(sp['4@BSS002PANK'].answered, 1); eq(sp['4@BSS002PAAX'].answered, 2); eq(sp['4@BSS002NZDT'].answered, 1);
  eq(sp['4@BSS002PAAX'].nc, 1); eq(sp['5@BSS002PANK'].p, 1); eq(sp['4@BSS002PANK'].shared, 9);
  eq(progress(E, resp, ctx).answered, 3);
  const stp = stationProgress(E, resp, ctx);
  eq(stp.tournee.total, tournee); eq(stp.tournee.answered, 2); eq(stp.stations.BSS002PAAX.answered, 1); eq(stp.stations.BSS002PAAX.nc, 1);
  eq(stp.stations.BSS002PANK.total, perStation);
  // Validation : un critère partagé manquant n'est signalé qu'une fois ; observations par station
  const v = validateResponses(E, resp, ctx);
  eq(v.filter(i => i.itemId === 'it-F4-19').length, 1);
  assert(v.some(i => i.itemId === 'it-F4-5@BSS002PAAX' && i.stationKey === 'BSS002PAAX' && /sans écart/.test(i.message)));
  // Conditions réécrites par station : F10.4 dépend du F10.3 de LA station
  const vis = visibleIds(E, ctx, { 'it-F10-3@BSS002PAAX': { status: 'C', value: { installee: 'Oui', alimentation: 'Véhicule' } } });
  assert(vis.has('it-F10-4@BSS002PAAX') && !vis.has('it-F10-4@BSS002PANK') && !vis.has('it-F10-4@BSS002NZDT'));
  eq(itemIndex(E).get('it-F10-4@BSS002PAAX').condition.item, 'it-F10-3@BSS002PAAX');
});

test('matrice de la station dans le contexte des conditions (ctx.matrixCode)', () => {
  const grid = { ...G, sections: G.sections.map(s => s.id !== 's-F5-prelevement' ? s : { ...s, items: s.items.map(i => i.id === 'it-F5-4' ? { ...i, condition: { ctx: 'matrixCode', op: 'eq', value: 'ESU' } } : i) }) };
  const E = expandGrid(grid, [{ siteId: ATHANASE.id }, { siteId: 'site-EL' }], { ...SITES, 'site-EL': { name: 'Littoral', matrixId: 'mat-EL' } });
  const vis = visibleIds(E, { auditType: 'ce', compartments: ['organisation', 'physico'], matrixCode: 'EL' });
  assert(vis.has('it-F5-4@09271503') && !vis.has('it-F5-4@EL'), 'matrice propre à chaque station');
});

/* ---------- Pré-remplissage ---------- */
test('pré-remplissage par station : données de chaque site, une seule fois pour la tournée', () => {
  const stations = [{ siteId: ATHANASE.id }, { siteId: ACAROUANY.id }];
  const E = expandGrid(G, stations, SITES);
  const r = prefillResponses(E, {
    site: ATHANASE, auditor: { name: 'Marie Dupont' }, provider: { name: 'Titulaire du marché — lot 1' }, operators: [{ code: 'JD', lastName: 'Dupont', firstName: 'Jean' }],
    date: '2026-10-09', time: '08:30:12', kind: 'inopine', stationCount: 2, auditType: 'ce', compartments: ['organisation', 'physico'],
    stations: [{ key: '09271503', site: ATHANASE, time: '08:30' }, { key: '09160201', site: ACAROUANY, time: '' }]
  });
  const v = id => r[id]?.value;
  eq(v('it-F3-3@09271503'), 'ATHANASE'); eq(v('it-F3-3@09160201'), 'ACAROUANY');
  eq(v('it-F3-4@09271503'), '09271503'); eq(v('it-F3-4@09160201'), '09160201');
  eq(v('it-F3-1@09160201'), 'Mana'); eq(v('it-F3-9@09160201'), 'Mana');
  eq(v('it-F1-R2@09271503'), '08:30'); assert(!('it-F1-R2@09160201' in r), 'heure d’arrivée : 1re station seulement');
  eq(v('it-F1-R1@09160201'), '2026-10-09'); eq(v('it-F1-R4@09160201'), 'Jean Dupont');
  eq(v('it-F2-1.1'), 'Marie Dupont'); eq(v('it-F2-1.11'), 'Inopiné'); eq(v('it-F2-5.6'), 2); eq(v('it-F2-2.1'), 'Titulaire du marché — lot 1');
  assert(!('it-F3-5@09271503' in r) && !('it-F3-10@09271503' in r), 'critères biologie masqués en cours d’eau');
  assert(Object.values(r).every(x => x.prefilled === true && !('status' in x)), 'prefilled, sans statut');
  assert(!Object.keys(r).some(k => k.endsWith('@undefined')));
  // Ajout d'une station : critères propres à la station seulement
  const r2 = prefillResponses(E, { onlyStation: '09160201', site: ACAROUANY, date: '2026-10-09', time: '14:05', auditType: 'ce' });
  eq(r2['it-F1-R2@09160201'].value, '14:05');
  assert(Object.keys(r2).every(k => k.endsWith('@09160201')), 'aucun critère de tournée ni d’une autre station');
  // Eaux souterraines : code BSS, libellé
  const EE = expandGrid(G, [{ siteId: MARIPA.id }], SITES);
  const re = prefillResponses(EE, { stations: [{ key: 'BSS002PANK', site: MARIPA }], auditType: 'eso', kind: 'planifie' });
  eq(re['it-F3-18@BSS002PANK'].value, 'BSS002PANK'); eq(re['it-F3-3@BSS002PANK'].value, 'AEP MARIPASOULA');
  assert(!('it-F3-4@BSS002PANK' in re), 'pas de code SANDRE en eaux souterraines');
  eq(re['it-F2-1.11'].value, 'Avec rendez-vous');
  // Biologie (grille de base) : comme les maquettes
  const rb = prefillResponses(G, { site: ATHANASE, auditor: 'M. D.', provider: { name: 'HYDRECO' }, date: '2026-10-09', time: '08:30' });
  eq(rb['it-F3-10'].value, '52'); eq(rb['it-F3-2'].value, 'Approuague'); eq(rb['it-F2-2.1'].value, 'HYDRECO');
  assert(!('it-F3-18' in rb), 'pas de code BSS en biologie');
});

test('saisies d’une station (retrait) et valeurs proposées', () => {
  const audit = { responses: {
    'it-F3-3@A': { value: 'ALPHA', prefilled: true }, 'it-F1-R1@A': { value: '2026-10-09', prefilled: true },
    'it-F3-3@B': { value: 'BETA', prefilled: true }, 'it-F4-5@B': { status: 'C' }, 'it-F4-2': { status: 'NC', comment: 'x' }
  }, sheets: { '4@A': {}, '4@B': { observations: 'RAS' }, 4: { instruments: { ph: { model: 'X' } } } } };
  deepEq(stationEntries(audit, 'A'), { responses: [], sheets: [] }, 'pré-remplissages seuls : retrait libre');
  deepEq(stationEntries(audit, 'B'), { responses: ['it-F4-5@B'], sheets: ['4@B'] });
  assert(!isEnteredResponse({ value: 'x', prefilled: true }) && isEnteredResponse({ value: 'x' }) && isEnteredResponse({ prefilled: true, value: 'x', comment: 'vu' }) && !isEnteredResponse({ value: { x: '', y: null } }));
  eq(durationText('07:45', '16:15'), '8 h 30'); eq(durationText('', '16:15'), '');
  eq(suggestedValue(item('it-F2-5.7'), { 'it-F2-5.2': { status: 'C', value: '07:00' }, 'it-F2-5.3': { status: 'C', value: '15:05' } }), '8 h 05');
});

/* ---------- Alertes ---------- */
const auditOf = (responses, extra = {}) => ({ startedAt: '2026-10-09T12:00:00Z', responses, compartments: BIO_ALL, ...extra });

test('alertes GPS par station : coordonnées comparées à LA station du critère', () => {
  const E = expandGrid(G, [{ siteId: ATHANASE.id }, { siteId: ACAROUANY.id }], SITES);
  const ctx = { auditType: 'bio', compartments: BIO_ALL };
  const resp = {
    'it-F6-3@09271503': { status: 'C', value: { x: ACAROUANY.x, y: ACAROUANY.y } },
    'it-F6-3@09160201': { status: 'C', value: { x: ACAROUANY.x + 100, y: ACAROUANY.y } }
  };
  const al = computeAlerts({ audit: auditOf(resp), grid: E, ctx, site: ATHANASE, stationSites: { '09271503': ATHANASE, '09160201': ACAROUANY } }).filter(a => a.code === 'GPS_XY_FAR');
  eq(al.length, 1);
  eq(al[0].itemId, 'it-F6-3@09271503'); eq(al[0].stationKey, '09271503'); eq(al[0].sheet, 6);
  assert(/Athanase/.test(al[0].message), al[0].message);
  // Sans sites par station : repli sur le site de l'audit (comportement historique)
  const old = computeAlerts({ audit: auditOf(resp), grid: E, ctx, site: ATHANASE }).filter(a => a.code === 'GPS_XY_FAR');
  eq(old.length, 2);
  eq(xyDistance({ x: 356714 + 300, y: 465112 + 400 }, ATHANASE), 500);
});

test('alertes : température de conservation, règle sur un champ, calibration une fois pour la tournée', () => {
  const run = (r, ctx = { auditType: 'bio', compartments: BIO_ALL }) => computeAlerts({ audit: auditOf({ 'it-F5-13': r }), grid: G, ctx, site: ATHANASE });
  const a = run({ status: 'C', value: 11 }).find(x => x.code === 'TEMP_CONSERVATION');
  assert(a, 'alerte > 8 °C'); eq(a.level, 'attention'); eq(a.message, 'Température hors de la plage 5 ± 3 °C (NF EN ISO 5667-3)');
  assert(!('status' in a), 'jamais de NC automatique');
  assert(!run({ value: 5 }).some(x => x.code === 'TEMP_CONSERVATION'));
  assert(!run({ status: 'NA', value: 12 }).some(x => x.code === 'TEMP_CONSERVATION'));
  const grid = { id: 'g', name: 'g', sections: [{ id: 's', items: [{ id: 'i', code: 'I', label: 'Glacière', kind: 'conformity', input: { type: 'fields', fields: [{ key: 'choix', type: 'choice', options: ['Oui', 'Non'] }, { key: 't', label: 'T°', type: 'number', unit: '°C' }] }, alerts: [{ field: 't', op: 'gt', value: 8, code: 'T_GLACIERE', message: 'T° {value} °C' }] }] }] };
  eq(computeAlerts({ audit: auditOf({ i: { value: { choix: 'Oui', t: 9.5 } } }), grid }).find(x => x.code === 'T_GLACIERE')?.message, 'T° 9,5 °C');
  eq(calibrationStatus('2026-08-01', '2026-10-09').days, 69);
  const E = expandGrid(G, [{ siteId: ATHANASE.id }, { siteId: ACAROUANY.id }], SITES);
  const sheets = { 4: { instruments: { ph: { calibration: '2026-08-01' }, cond: { calibration: '2026-10-12' }, redox: { calibration: '2026-01-01' } } } };
  const cal = computeAlerts({ audit: auditOf({}, { sheets }), grid: E, ctx: { auditType: 'ce', compartments: ['organisation', 'physico'] } }).filter(x => x.code === 'CALIBRATION');
  deepEq(cal.map(x => x.target.id).sort(), ['cond', 'ph'], 'une alerte par appareil (redox : eaux souterraines seulement)');
  const calEso = computeAlerts({ audit: auditOf({}, { sheets }), grid: E, ctx: ctxOf('eso') }).filter(x => x.code === 'CALIBRATION');
  deepEq(calEso.map(x => x.target.id).sort(), ['cond', 'ph', 'redox']);
});

/* ---------- Synthèse ---------- */
test('synthèse : décomptes C / P / NC / N/A par feuille, par station et pour la tournée', () => {
  const stations = [{ key: '09271503', siteId: ATHANASE.id }, { key: '09160201', siteId: ACAROUANY.id }];
  const audit = {
    gridSnapshot: G, auditType: 'ce', stations, compartments: ['organisation', 'physico'],
    responses: {
      'it-F2-6.1': { status: 'C' }, 'it-F2-6.2': { status: 'P', comment: 'à jour ?' },
      'it-F4-18': { status: 'C' }, 'it-F4-2': { status: 'NC', comment: 'pas d’étalonnage' },
      'it-F4-5@09271503': { status: 'C', value: 7.1 }, 'it-F4-5@09160201': { status: 'P', comment: 'stabilisation' }, 'it-F4-6@09160201': { status: 'NA' },
      'it-F3-19@09160201': { status: 'NC', comment: 'mauvais pont' }, 'it-F1-R3@09271503': { value: 'M. D.' }
    },
    sheets: { '3@09160201': { conclusion: { status: 'P', comments: 'à revoir' } } },
    conclusions: { comment: 'Bonne tournée', preconisations: 'Vérifier le pont amont' }
  };
  const s = sheetSummary({ audit });
  deepEq(s.map(x => x.instanceKey), ['1@09271503', '2', '3@09271503', '4@09271503', '5@09271503', '1@09160201', '3@09160201', '4@09160201', '5@09160201']);
  const f4a = s.find(x => x.instanceKey === '4@09271503'), f4b = s.find(x => x.instanceKey === '4@09160201');
  deepEq([f4a.C, f4a.P, f4a.NC, f4a.NA, f4a.sharedCounted, f4a.sharedTotal], [2, 0, 1, 0, 9, 9], 'S1 : critères partagés comptés');
  deepEq([f4b.C, f4b.P, f4b.NC, f4b.NA, f4b.sharedCounted, f4b.sharedTotal], [0, 1, 0, 1, 0, 9], 'S2 : critères partagés non recomptés');
  eq(f4b.hint, '1 NC, 1 P sur cette feuille', 'suggestion sur la feuille affichée (NC partagé compris)');
  const f3b = s.find(x => x.instanceKey === '3@09160201');
  eq(f3b.conclusion, 'P'); eq(f3b.conclusionLabel, 'Perfectible'); eq(f3b.comments, 'à revoir');
  eq(f3b.index, 3); eq(f3b.sheetTotal, 5); eq(f3b.station.name, '09160201', 'sans sites : clé de la station');
  const ss = stationSummary({ audit });
  deepEq([ss.global.C, ss.global.P, ss.global.NC, ss.global.NA], [3, 2, 2, 1], 'C : F2-6.1, F4-18 (partagé), F4-5 S1');
  deepEq([ss.tournee.C, ss.tournee.P, ss.tournee.NC], [2, 1, 1]);
  deepEq(ss.stations.map(x => [x.key, x.C, x.P, x.NC, x.NA]), [['09271503', 1, 0, 0, 0], ['09160201', 0, 1, 1, 1]]);
  for (const k of ['C', 'P', 'NC', 'NA', 'unanswered', 'total']) {
    eq(ss.tournee[k] + ss.stations.reduce((n, x) => n + x[k], 0), ss.global[k], `tournée + stations = global (${k})`);
    eq(s.reduce((n, x) => n + x[k], 0), ss.global[k], `somme des feuilles = global (${k})`);
  }
  const sum = auditSummary({ audit, grid: expandGrid(G, stations), ctx: { auditType: 'ce', compartments: audit.compartments } });
  deepEq([sum.counts.C, sum.counts.P, sum.counts.NC, sum.counts.NA], [3, 2, 2, 1]);
  eq(sum.counts.controlled, ss.global.total);
  deepEq(sum.pItems.map(x => [x.itemId, x.stationKey]), [['it-F2-6.2', null], ['it-F4-5@09160201', '09160201']]);
  deepEq(sum.ncItems.map(x => x.code), ['F4.2', 'F3.19·S2']);
  eq(sum.preconisations, 'Vérifier le pont amont'); eq(sum.comment, 'Bonne tournée');
  assert(!('score' in sum), 'synthèse sans score');
  assert(sum.vigilance.some(v => /perfectible/.test(v)), 'P en vigilance');
  eq(sum.stations.stations.length, 2);
  eq(sheetSummary({ audit: { gridSnapshot: DEFAULT_GRIDS[1], responses: {} } }).length, 0, 'grille par sections');
  // Écarts récurrents : code d'origine du critère de station
  const rec = recurringDeviations([{ providerId: 'p', auditId: 'a1', itemCode: 'F4.5·S1' }, { providerId: 'p', auditId: 'a2', itemCode: 'F4.5·S3' }]);
  eq(rec.length, 1); eq(rec[0].key, 'F4.5');
});

test('comparaison de tournées : appariement par critère d’origine et station', () => {
  const a = { gridSnapshot: G, stations: [{ key: '09271503', siteId: ATHANASE.id }, { key: '09160201', siteId: ACAROUANY.id }], responses: { 'it-F4-5@09160201': { status: 'NC' }, 'it-F4-2': { status: 'C' } } };
  const b = { gridSnapshot: G, stations: [{ key: '09160201', siteId: ACAROUANY.id }], responses: { 'it-F4-5@09160201': { status: 'C' }, 'it-F4-2': { status: 'C' } } };
  const r = compareAudits(a, b);
  const row = r.rows.find(x => x.code === 'F4.5' && x.station?.siteId === ACAROUANY.id);
  eq(row.change, 'amelioration', 'station de rang 2 puis 1 appariée');
  eq(r.rows.filter(x => x.code === 'F4.2').length, 1, 'critère partagé une fois');
  eq(r.rows.find(x => x.code === 'F4.5' && x.station?.siteId === ATHANASE.id).change, 'retire');
  assert(!compareAudits(a, b, { siteId: ACAROUANY.id }).rows.some(x => x.station?.siteId === ATHANASE.id), 'filtre par station');
  const g1 = { gridSnapshot: G, responses: { 'it-F6-3': { status: 'C', value: { x: 1, y: 2, lat: 4.1 } } } }, g2 = { gridSnapshot: G, responses: { 'it-F6-3': { status: 'C', value: { x: 1, y: 2, lat: 4.2 } } } };
  eq(compareAudits(g1, g2).rows.find(x => x.code === 'F6.3').change, 'identique');
});

/* ---------- Formatage et validation (repris de CT-BIO-2026) ---------- */
test('formatValue, isAnswered, bornes et saisies numériques', () => {
  eq(formatValue(item('it-F4-4'), 7.2), '7,2 unité pH');
  eq(formatValue(item('it-F2-1.4'), '2026-10-09'), '09/10/2026');
  eq(formatValue(item('it-F9-4'), { choix: 'Autre', autre: 'Pompe péristaltique' }), 'Autre : Pompe péristaltique');
  eq(formatValue(item('it-F9-5'), { volume: 500, unite: 'mL' }), 'Volume : 500 mL');
  eq(formatValue(item('it-F6-3'), { x: 356714, y: 465112, lat: 4.2, lon: -52.3 }), 'X : 356714 · Y : 465112');
  eq(formatValue(item('it-F3-31'), { choix: 'Non', retard: 20 }), 'Non · Retard : 20 min');
  eq(itemInput(item('it-F2-1.13')).placeholder, 'ex. eau, sédiments, biote');
  assert(!itemInput(item('it-F10-4')), 'statut seul (sans valeur)');
  assert(isEmptyValue(item('it-F3-15'), { x: '', y: '' }));
  assert(isAnswered(item('it-F10-2'), { value: { pompe: 'Oui' } }) && !isAnswered(item('it-F10-2'), { value: { etat: 'Non fonctionnelle' } }), 'valeur seule : champ affiché renseigné');
  const issues = validateResponses(G, { 'it-F4-4': { status: 'C', value: 15 }, 'it-F10-5': { status: 'C', value: { realisee: 'Oui', duree: 'abc' } } }, ctxOf('eso'));
  assert(issues.some(i => i.itemId === 'it-F4-4' && i.level === 'warning' && /entre 0 et 14/.test(i.message)));
  assert(issues.some(i => i.itemId === 'it-F10-5' && i.level === 'error' && /Durée/.test(i.message)));
  eq(parseInputValue({ type: 'number' }, '7,25'), 7.25);
});

/* ---------- Traçabilité des fiches d'évaluation ---------- */
test('traçabilité : chaque point des fiches cours d’eau et eaux souterraines est couvert sans doublon', async () => {
  const src = await (await fetch(new URL('../../js/domain/grid-ct-2026.js', import.meta.url))).text();
  const head = src.slice(0, src.indexOf('*/'));
  const rows = [...head.matchAll(/^ \* \[(CE|ESO)\] (.+?) → (.+)$/gm)].map(m => ({ src: m[1], point: m[2], target: m[3] }));
  eq(rows.filter(r => r.src === 'CE').length, 70, 'fiche cours d’eau : 70 points');
  eq(rows.filter(r => r.src === 'ESO').length, 42, 'fiche eaux souterraines : 42 points');
  eq(new Set(rows.map(r => r.src + r.point)).size, rows.length, 'pas de point en double');
  const ids = new Set(allItems(G).map(i => i.id));
  const covered = new Set();
  for (const r of rows) {
    assert((r.target.match(/\(Inclut\)/g) || []).length <= 1, `${r.point} : un seul critère peut inclure ce point (sans doublon)`);
    const refs = [...r.target.matchAll(/(it-F\d+-[A-Z]?[\d.]*\d)( \(Inclut\))?/g)];
    assert(refs.length || /audit\.|site\.|synthèse|encadré|données de l['’]audit|exclue|module|conclusion/.test(r.target), `cible non reconnue : ${r.point}`);
    for (const [, id, inc] of refs) {
      assert(ids.has(id), `${r.point} → critère inexistant ${id}`);
      covered.add(id);
      if (inc) assert(/^Inclut : /.test(item(id).help || ''), `${id} : aide « Inclut : … » attendue (${r.point})`);
    }
  }
  // Chaque critère ajouté par l'avenant provient d'au moins un point des fiches (pas de critère orphelin)
  const added = ['it-F1-R8', ...['1.11', '1.12', '1.13', '3.5', '4.6', '5.5', '5.6', '5.7', '5.8', '6.1', '6.2', '6.3', '6.4', '7.1', '7.2', '7.3'].map(n => 'it-F2-' + n),
    ...Array.from({ length: 16 }, (_, i) => 'it-F3-' + (18 + i)), ...Array.from({ length: 7 }, (_, i) => 'it-F10-' + (1 + i)),
    ...Array.from({ length: 14 }, (_, i) => 'it-F4-' + (18 + i)), ...Array.from({ length: 12 }, (_, i) => 'it-F5-' + (19 + i))];
  for (const id of added) assert(ids.has(id), `critère ajouté manquant : ${id}`);
  for (const id of added) assert(covered.has(id), `critère ajouté sans point source : ${id}`);
  // Les fusions décrites par l'avenant figurent dans l'aide des critères existants
  for (const id of ['it-F2-2.1', 'it-F2-4.4', 'it-F4-2', 'it-F4-3', 'it-F4-11', 'it-F4-12', 'it-F4-13', 'it-F4-17', 'it-F5-1', 'it-F5-2', 'it-F5-3', 'it-F5-5', 'it-F5-8', 'it-F5-9', 'it-F5-11', 'it-F5-14', 'it-F5-15', 'it-F4-30']) assert(/^Inclut : /.test(item(id).help || ''), `fusion ${id}`);
  for (const id of ['it-F3-7', 'it-F3-8']) assert(/27–28/.test(item(id).help), `renvoi ${id}`);
  assert(/π × r² × hauteur d’eau/.test(item('it-F10-5').help));
});

/* ---------- Référentiel et programmes 2026 ---------- */
test('référentiel : eaux souterraines (BSS), stations cours d’eau, biologie et programmes 2026', async () => {
  const DATA = await (await fetch(new URL('../../data/referentiel-oeg.json', import.meta.url))).json();
  const ref = oegReferential(DATA);
  const eso = ref.site.filter(s => s.types.includes('eso'));
  eq(eso.length, 17, '17 points d’eaux souterraines');
  assert(eso.every(s => s.codeType === 'BSS' && /^BSS/.test(s.code) && s.matrixId === 'mat-ESO' && s.kind === 'Eau souterraine'), 'code BSS');
  assert(eso.every(s => s.nature && s.aquifere && s.usage && s.commune), 'nature, aquifère, usage, commune');
  deepEq(eso[0].compartments, ['organisation', 'eso']); deepEq(eso[0].types, ['eso']);
  const maripa = eso.find(s => s.code === 'BSS002PANK');
  deepEq([maripa.name, maripa.commune, maripa.nature, maripa.usage], ['AEP Maripasoula', 'Maripasoula', 'Unité de traitement / Forages (60 m)', 'Alimentation en eau potable']);
  eq(eso.find(s => s.code === 'BSS002NZDT').usage, 'Surveillance (piézomètre)');
  eq(esoUsage('Forage d’exploitation (62 m)'), 'Alimentation en eau potable'); eq(esoUsage('Piézomètre (20 m)'), 'Surveillance (piézomètre)');
  const bio = ref.site.filter(s => s.types.includes('bio'));
  eq(bio.length, 38, '38 stations biologie');
  const ce = ref.site.filter(s => s.types.includes('ce'));
  assert(ce.length > 0 && ce.every(s => s.codeType === 'SANDRE' && s.compartments.includes('organisation') && s.compartments.includes('physico')), 'stations cours d’eau');
  assert(ref.site.filter(s => s.networks.some(n => ['Chimie', 'RCO', 'EL'].includes(n))).every(s => s.types.includes('ce')), 'Chimie, RCO, RCO_BIO12, EL ⇒ ce');
  const ath = ref.site.find(s => s.code === '09271503');
  assert(ath.types.includes('bio')); deepEq(ath.bioLists, ['BIO_CE', 'BIO_FISH', 'BIO_PHYTO']);
  assert(BIO_ALL.every(k => ath.compartments.includes(k)), 'ATHANASE : tous les compartiments biologiques');
  eq(ath.riverName, 'Approuague'); eq(ath.photos.RD.src, 'img/stations/09271503/RD.jpg');
  deepEq(bioCompartments(['BIO_FISH']), ['organisation', 'poissons']);
  // Programme biologique
  const prog = bioProgramme(DATA);
  eq(prog.length, 38);
  assert(prog.every(p => p.gridId === 'grid-ct-2026-v1' && p.auditType === 'bio' && p.providerId === 'prov-HYDRECO' && p.plannedDate === '' && p.campaignId === BIO_CAMPAIGN.id), 'prestations BIO 2026');
  // Programme cours d'eau (Chimie, RCO)
  const cep = ceProgramme(DATA);
  assert(cep.length > 0, 'programme cours d’eau');
  assert(cep.every(p => p.gridId === 'grid-ct-2026-v1' && p.auditType === 'ce' && ['prov-OEG', 'prov-TL1'].includes(p.providerId) && /^\d{4}-\d{2}-01$/.test(p.plannedDate) && p.dateIndicative), 'OEG / Titulaire, 1er jour du mois');
  assert(cep.some(p => p.providerId === 'prov-TL1') && cep.some(p => p.providerId === 'prov-OEG'));
  assert(cep.every(p => /^(Chimie|RCO)\|/.test(p.source.externalId)), 'réseaux Chimie et RCO');
  assert(cep.every(p => ref.site.some(s => s.id === p.siteId) && ref.campaign.some(c => c.id === p.campaignId)), 'sites et campagnes existants');
  eq(new Set(cep.map(p => p.id)).size, cep.length);
  assert(ref.provider.some(p => p.id === 'prov-TL1') && ref.provider.some(p => p.id === 'prov-NBC'));
});

/* ---------- Turbidité en NTU (grille CT-2026 1.1) et mise à niveau des grilles par défaut ---------- */
/** Copie d'une grille par défaut « ancienne » : unités de turbidité repassées en FNU (et version donnée). */
const withFNU = (grid, version = grid.version) => {
  const g = structuredClone(grid); g.version = version;
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'unit' && x === 'NTU') v[k] = 'FNU'; else walk(x); } };
  walk(g.sections);
  return g;
};
const turbUnits = g => { const it = itemIndex(g).get('it-F4-9'); return it ? it.input.fields.map(f => f.unit) : []; };

test('turbidité : NTU dans les grilles par défaut (CT-2026 1.1, GR-PREL-EAU), unité NTU au référentiel, FNU / NFU conservées', () => {
  const text = JSON.stringify(DEFAULT_GRIDS);
  assert(!/"(FNU|NFU)"/.test(text), 'aucune unité FNU / NFU dans les grilles du code');
  deepEq(turbUnits(G), ['NTU', 'NTU', 'NTU'], 'F4.9 : trois mesures en NTU');
  eq(itemIndex(GRID_GENERAL).get('it-V08').unit, 'NTU', 'V08 en NTU');
  eq(G.id, 'grid-ct-2026-v1', 'même identifiant'); eq(G.version, '1.1', 'version 1.1'); eq(GRID_GENERAL.id, 'grid-prel-eau-general-v1');
  eq(formatValue(item('it-F4-9'), { t1: 3.1, t2: 3.3, t3: 3.2 }), 'Mesure 1 : 3,1 NTU · Mesure 2 : 3,3 NTU · Mesure 3 : 3,2 NTU');
  eq(formatValue(itemIndex(GRID_GENERAL).get('it-V08'), 2.5), '2,5 NTU');
  eq(formatValue(item('it-F4-9'), { t1: 3.1 }, { unit: false }), 'Mesure 1 : 3,1', 'sans l’unité de la grille');
  eq(formatValue(item('it-F9-5'), { volume: 500, unite: 'mL' }, { unit: false }), 'Volume : 500 mL', 'unité choisie à la saisie conservée');
  const units = baseReferential().unit;
  deepEq(units.find(u => u.id === 'unit-NTU'), { id: 'unit-NTU', code: 'NTU', symbol: 'NTU', label: 'NTU (Turbidité)', quantity: 'Turbidité' });
  assert(units.some(u => u.id === 'unit-FNU') && units.some(u => u.id === 'unit-NFU'), 'FNU et NFU conservées (tournées antérieures)');
  deepEq(UNIT_REPLACEMENTS, { FNU: 'NTU', NFU: 'NTU' });
});

test('replaceGridUnits : pur, déterministe, idempotent ; ni unitKey, ni libellés, ni réponses', () => {
  const old = withFNU(G);
  const before = canonicalJSON(old);
  const r = replaceGridUnits(old);
  eq(r.count, 3, 'trois champs de F4.9'); deepEq(turbUnits(r.grid), ['NTU', 'NTU', 'NTU']);
  eq(canonicalJSON(old), before, 'entrée non modifiée');
  eq(canonicalJSON(replaceGridUnits(old).grid), canonicalJSON(r.grid), 'déterministe');
  const again = replaceGridUnits(r.grid);
  eq(again.count, 0); assert(again.grid === r.grid, 'idempotent : même objet');
  eq(canonicalJSON(r.grid), canonicalJSON({ ...old, sections: r.grid.sections }), 'seules les sections changent');
  eq(itemIndex(r.grid).get('it-F9-5').input.fields.find(f => f.unitKey)?.unitKey, itemIndex(G).get('it-F9-5').input.fields.find(f => f.unitKey)?.unitKey, 'unitKey inchangé');
  eq(item('it-F4-9').label, itemIndex(r.grid).get('it-F4-9').label);
  const g2 = replaceGridUnits(withFNU(GRID_GENERAL));
  eq(g2.count, 1); eq(itemIndex(g2.grid).get('it-V08').unit, 'NTU');
  const odd = { id: 'x', sections: [{ items: [{ id: 'a', unit: 'NFU', label: 'FNU' }] }] };
  deepEq(replaceGridUnits(odd).grid.sections[0].items[0], { id: 'a', unit: 'NTU', label: 'FNU' }, 'NFU aussi ; libellé intact');
  const bare = { id: 'y', name: 'sans sections' };
  assert(replaceGridUnits(bare).grid === bare && replaceGridUnits(null).grid === null, 'grille sans unité : telle quelle');
});

test('numéros de version : comparaison numérique', () => {
  assert(compareVersions('1.1', '1.0') > 0 && compareVersions('1.10', '1.9') > 0 && compareVersions('1.0', '1.0') === 0 && compareVersions('1', '1.0') === 0);
  assert(compareVersions('1.0', '1.1') < 0 && compareVersions('2.0', '1.12') > 0 && compareVersions('1.0.1', '1.0') > 0);
});

test('mise à niveau d’une grille par défaut enregistrée : nouvelle version ⇒ contenu du code ; même version ⇒ unités ; jamais de retour', () => {
  const meta = { createdAt: '2026-10-10T08:00:00.000Z', createdBy: 'u1', updatedAt: '2026-10-11T08:00:00.000Z', _vv: { A: 3 }, _lv: 3 };
  const stored = { ...withFNU(G, '1.0'), ...meta };
  const r = upgradeStoredGrid(stored, G);
  assert(r.changed && r.replaced, 'version 1.0 → 1.1'); deepEq([r.from, r.to], ['1.0', '1.1']);
  const { createdAt, createdBy, updatedAt, _vv, _lv, ...content } = r.grid;
  eq(canonicalJSON(content), canonicalJSON(G), 'contenu = grille du code');
  deepEq({ createdAt, createdBy, updatedAt, _vv, _lv }, meta, 'métadonnées d’enregistrement conservées');
  deepEq(turbUnits(r.grid), ['NTU', 'NTU', 'NTU']);
  eq(upgradeStoredGrid(r.grid, G).changed, false, 'idempotent');
  eq(canonicalJSON(upgradeStoredGrid({ ...withFNU(G, '1.0'), ...meta }, G).grid), canonicalJSON(r.grid), 'déterministe (deux tablettes : même grille)');
  assert(!stored.version || stored.version === '1.0', 'entrée non modifiée');
  // Grille archivée par un administrateur : reste archivée (avec sa date), contenu mis à niveau.
  const arch = upgradeStoredGrid({ ...withFNU(G, '1.0'), status: 'archivee', archivedAt: '2026-10-12T00:00:00.000Z' }, G).grid;
  deepEq([arch.status, arch.archivedAt, arch.version], ['archivee', '2026-10-12T00:00:00.000Z', '1.1']);
  // Même version (grille générale non renumérotée) : unités seules.
  const gen = upgradeStoredGrid({ ...withFNU(GRID_GENERAL), ...meta }, GRID_GENERAL);
  assert(gen.changed && !gen.replaced && gen.units === 1); eq(gen.grid.updatedAt, meta.updatedAt);
  // Version enregistrée plus récente (reçue d'une tablette mise à jour) : jamais de retour à la version du code.
  const newer = { ...structuredClone(G), version: '1.2', name: 'CT-2026 (1.2)' };
  const n = upgradeStoredGrid(newer, G);
  assert(!n.changed && n.grid === newer, 'pas de retour en arrière');
  // Grille supprimée, autre identifiant : rien.
  assert(!upgradeStoredGrid({ ...withFNU(G, '1.0'), _deleted: true }, G).changed, 'grille supprimée');
  assert(!upgradeStoredGrid({ ...withFNU(G, '1.0'), id: 'autre' }, G).changed, 'autre identifiant');
});

test('grille à jour (affichage, fiches vierges, nouvelle tournée) : grilles par défaut seulement, mémorisée', () => {
  deepEq([...DEFAULT_GRID_IDS], DEFAULT_GRIDS.map(g => g.id));
  const old = withFNU(G, '1.0');
  const up = upToDateGrid(old);
  eq(up.version, '1.1'); deepEq(turbUnits(up), ['NTU', 'NTU', 'NTU']);
  assert(upToDateGrid(old) === up, 'mémorisée par objet');
  assert(upToDateGrid(G) === G, 'grille déjà à jour : même objet');
  const own = { ...withFNU(G, '1.0'), id: 'grid-copie-oeg' };
  assert(upToDateGrid(own) === own, 'grille créée par l’OEG : jamais modifiée');
  assert(upToDateGrid(null) === null);
});

test('comparaison de tournées : turbidité FNU puis NTU, mêmes valeurs ⇒ identique ; chaque tournée garde son unité', () => {
  const v = { t1: 3.1, t2: 3.3, t3: 3.2 };
  const a = { gridSnapshot: withFNU(G, '1.0'), stations: [{ key: '09271503', siteId: ATHANASE.id }], responses: { 'it-F4-9@09271503': { status: 'C', value: v } } };
  const b = { gridSnapshot: G, stations: [{ key: '09271503', siteId: ATHANASE.id }], responses: { 'it-F4-9@09271503': { status: 'C', value: v } } };
  const row = compareAudits(a, b).rows.find(x => x.code === 'F4.9');
  eq(row.change, 'identique');
  assert(/3,1 FNU/.test(row.before) && /3,1 NTU/.test(row.after), 'avant / après : unité de chaque tournée');
  const c = { ...b, responses: { 'it-F4-9@09271503': { status: 'C', value: { ...v, t1: 4 } } } };
  eq(compareAudits(a, c).rows.find(x => x.code === 'F4.9').change, 'modifie', 'valeur différente : modifiée');
});
