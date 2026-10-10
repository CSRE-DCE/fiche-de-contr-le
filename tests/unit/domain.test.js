/* Tests unitaires du domaine (modules purs, navigateur) sur les grilles historiques GRID_GENERAL / GRID_RAPIDE
 * (js/domain/default-grids.js) : logique conditionnelle, avancement et complétude, sélection des grilles,
 * alertes (jamais de non-conformité automatique), habilitations et équipements, synthèse factuelle, écarts
 * récurrents, comparaison de deux audits, fusion à trois versions, normalisation des imports, référentiel initial
 * (data/referentiel-oeg.json lu par fetch), droits par profil. Portage de tests/audit-unit.mjs (fiches-oeg) :
 * la partie serveur Node (audit-api) n'a pas d'équivalent ici (synchronisation GitHub : github.test.js). */
import { test, assert, eq, deepEq } from './harness.js';
import { evalCondition, itemIndex, visibleStructure, progress, validateResponses, validateGrid, rankGrids, allItems, conditionErrors } from '../../js/domain/grids.js';
import { computeAlerts, operatorStatus, equipmentStatus, qualificationValid } from '../../js/domain/rules.js';
import { auditSummary, recurringDeviations, isOverdue } from '../../js/domain/summary.js';
import { compareAudits } from '../../js/domain/compare.js';
import { mergeEntity, stripMeta, IMMUTABLE_TYPES } from '../../js/domain/merge.js';
import { GRID_GENERAL, GRID_RAPIDE, DEFAULT_GRIDS } from '../../js/domain/default-grids.js';
import { baseReferential, oegReferential, oegProgramme, demoData, parseSessionMonth } from '../../js/domain/seed.js';
import { parseDate, parseTime, parseNumber, parseBool, guessMapping, resolveRef } from '../../js/domain/normalize.js';
import { canWrite, roleCan, ROLES, writePermission } from '../../js/domain/permissions.js';

/** Référentiel des fiches terrain OEG (même source que l'application : js/app/bootstrap.js). */
let dataPromise = null;
const loadDATA = () => (dataPromise ||= fetch(new URL('../../data/referentiel-oeg.json', import.meta.url).href).then(r => {
  if (!r.ok) throw new Error(`data/referentiel-oeg.json : HTTP ${r.status}`);
  return r.json();
}));
const R = (status, extra = {}) => ({ status, at: '2026-10-08T10:00:00Z', ...extra });

/* ---------- Grilles ---------- */
test('grilles par défaut valides', () => {
  for (const g of DEFAULT_GRIDS) deepEq(validateGrid(g), [], g.code);
  assert(allItems(GRID_GENERAL).length >= 90, 'grille générale complète');
  assert(DEFAULT_GRIDS.includes(GRID_GENERAL) && DEFAULT_GRIDS.includes(GRID_RAPIDE), 'grilles historiques toujours fournies');
});

test('logique conditionnelle : chaîne du froid affichée seulement si demandée', () => {
  const idx = itemIndex(GRID_GENERAL);
  const vis = resp => visibleStructure(GRID_GENERAL, resp, {}).find(s => s.id === 'sec-transport').visibleItems.map(i => i.code);
  assert(!vis({}).includes('T07'));
  assert(vis({ 'it-T00': { value: true } }).includes('T07'));
  assert(!vis({ 'it-T00': { value: false } }).includes('T07'));
  eq(evalCondition({ ctx: 'matrixCode', op: 'eq', value: 'ESO' }, {}, idx, { matrixCode: 'ESO' }), true);
  eq(evalCondition({ any: [{ item: 'M09', op: 'truthy' }, { ctx: 'auditKind', op: 'eq', value: 'inopine' }] }, {}, idx, { auditKind: 'inopine' }), true);
  eq(evalCondition({ all: [{ item: 'M09', op: 'truthy' }, { ctx: 'auditKind', op: 'eq', value: 'inopine' }] }, {}, idx, { auditKind: 'inopine' }), false);
  eq(evalCondition(null, {}, idx, {}), true, 'sans condition : affiché');
  // purge du forage uniquement en eau souterraine
  const obs = ctx => visibleStructure(GRID_GENERAL, {}, ctx).find(s => s.id === 'sec-obs').visibleItems.map(i => i.code);
  assert(obs({ matrixCode: 'ESO' }).includes('O14'));
  assert(!obs({ matrixCode: 'ESU' }).includes('O14'));
});

test('conditions : références inconnues signalées', () => {
  const idx = itemIndex(GRID_GENERAL);
  deepEq(conditionErrors({ item: 'T00', op: 'truthy' }, idx), []);
  assert(conditionErrors({ item: 'ZZ99', op: 'truthy' }, idx).length > 0, 'critère inconnu');
  const bad = { ...GRID_RAPIDE, sections: [{ ...GRID_RAPIDE.sections[0], items: [...GRID_RAPIDE.sections[0].items, { id: 'it-R01', code: 'R01', label: 'doublon', kind: 'conformity' }] }] };
  assert(validateGrid(bad).length > 0, 'identifiant en double signalé');
});

test('avancement et contrôle de complétude (justification obligatoire en cas de NC)', () => {
  const p0 = progress(GRID_RAPIDE, {}, {});
  eq(p0.answered, 0);
  const resp = { 'it-R01': R('NC'), 'it-R02': { value: '2' } };
  const issues = validateResponses(GRID_RAPIDE, resp, {});
  assert(issues.some(i => i.itemId === 'it-R01' && i.level === 'error' && /justification/.test(i.message)), 'justification exigée');
  assert(issues.some(i => i.itemId === 'it-R03' && /obligatoire/.test(i.message)), 'critère obligatoire');
  const issues2 = validateResponses(GRID_RAPIDE, { ...resp, 'it-R01': R('NC', { comment: 'carte absente' }) }, {}, { mediaCounts: { 'it-R01': 1 }, deviationsByItem: { 'it-R01': 1 } });
  assert(!issues2.some(i => i.itemId === 'it-R01'), 'NC justifiée, photo et écart présents');
  // photo obligatoire satisfaite par un média
  eq(progress(GRID_RAPIDE, {}, {}, { 'it-R05': 1 }).answered, 1);
  const p1 = progress(GRID_RAPIDE, { 'it-R01': R('C'), 'it-R03': R('NA') }, {});
  eq(p1.answered, 2);
  assert(p1.total >= 10 && p1.total > p1.answered, 'total des critères visibles');
});

test('sélection des grilles par champ d’application', () => {
  const spec = { ...GRID_RAPIDE, id: 'g-eso', scope: { matrixIds: ['mat-ESO'] } };
  const ranked = rankGrids([GRID_GENERAL, spec], { matrixId: 'mat-ESO' });
  eq(ranked[0].id, 'g-eso');
  deepEq(rankGrids([GRID_GENERAL, spec], { matrixId: 'mat-ESU' }).map(g => g.id), [GRID_GENERAL.id]);
});

/* ---------- Alertes ---------- */
test('alertes : jamais de non-conformité automatique, toutes les situations du cahier des charges', () => {
  const audit = {
    startedAt: '2026-10-08T10:00:00Z', responses: { 'it-T00': { value: true }, 'it-T07': { value: 11 }, 'it-D02': { value: 'v1' }, 'it-M09': { value: true }, 'it-T10': { value: '2026-10-09T15:00' } },
    gps: [{ id: 'g', lat: 4.95, lon: -52.3, accuracy: 10 }], samples: [{ id: 's1', sampleId: 'E01', code: '', date: '2026-10-08', time: '08:00' }],
    equipmentChecks: [{ id: 'e1', label: 'Sonde', inventoryNo: 'X1', validUntil: '2026-01-01', status: 'service' }],
    operatorIds: ['op1'], siteId: 'site-2', providerId: 'p1', documentsSnapshot: [{ type: 'PROTOCOLE', version: '2', reference: 'P' }]
  };
  const alerts = computeAlerts({ audit, grid: GRID_GENERAL, point: { code: 'P', lat: 5.0, lon: -53.0 }, prestation: { id: 'x', siteId: 'site-1', providerId: 'p1', plannedDate: '2026-10-08' }, operators: [{ id: 'op1', firstName: 'A', lastName: 'B', qualifications: [{ type: 'habilitation', label: 'H', validUntil: '2025-01-01' }] }], settings: { gpsThresholdM: 100 } });
  const codes = alerts.map(a => a.code);
  for (const c of ['GPS_FAR', 'EQUIPMENT_INVALID', 'SAMPLE_UNIDENTIFIED', 'OPERATOR_NOT_QUALIFIED', 'PRESTATION_DIFFERENT', 'TEMP_OUT', 'PROTOCOL_WRONG', 'MATERIAL_MISSING', 'DELAY_EXCEEDED']) assert(codes.includes(c), `alerte ${c} attendue (obtenu : ${codes.join(', ')})`);
  assert(alerts.every(a => !('status' in a)), 'une alerte ne porte aucune réponse de conformité');
  eq(alerts[0].level, 'critique', 'alertes critiques en tête');
  const missing = computeAlerts({ audit: { responses: {} }, grid: GRID_RAPIDE, includeMissing: true });
  assert(missing.some(a => a.code === 'REQUIRED_MISSING'), 'critères obligatoires manquants');
});

test('alertes : aucune alerte pour une situation conforme', () => {
  const audit = { startedAt: '2026-10-08T10:00:00Z', responses: { 'it-R09': { value: true }, 'it-R10': { value: 5 } }, gps: [{ id: 'g', lat: 4.95, lon: -52.3 }] };
  const alerts = computeAlerts({ audit, grid: GRID_RAPIDE, point: { code: 'P', lat: 4.9501, lon: -52.3001 }, settings: { gpsThresholdM: 100 } });
  deepEq(alerts.map(a => a.code), [], 'température dans l’intervalle, position au point');
  const hot = computeAlerts({ audit: { ...audit, responses: { 'it-R09': { value: true }, 'it-R10': { value: 9.5 } } }, grid: GRID_RAPIDE });
  assert(hot.some(a => a.code === 'TEMP_OUT' && a.level === 'critique' && /9.5|9,5/.test(a.message)), 'température hors critère');
});

test('habilitations et équipements', () => {
  eq(operatorStatus({ qualifications: [{ type: 'habilitation', validUntil: '2027-01-01' }] }, '2026-10-08').ok, true);
  eq(operatorStatus({ qualifications: [] }, '2026-10-08').ok, false);
  assert(/expirée/.test(operatorStatus({ qualifications: [{ type: 'habilitation', label: 'H', validUntil: '2025-01-01' }] }, '2026-10-08').message));
  eq(qualificationValid({ obtainedAt: '2026-11-01' }, '2026-10-08'), false, 'pas encore obtenue');
  eq(equipmentStatus({ inventoryNo: 'A', status: 'service', validUntil: '2027-01-01' }, '2026-10-08').ok, true);
  eq(equipmentStatus({ inventoryNo: 'A', status: 'hors_service' }, '2026-10-08').level, 'critique');
  eq(equipmentStatus({ status: 'service' }, '2026-10-08').level, 'attention', 'équipement non identifié');
});

/* ---------- Synthèse, écarts, comparaison ---------- */
test('synthèse factuelle sans score, écarts récurrents, retards', () => {
  const crit = baseReferential().criticality;
  const s = auditSummary({ audit: { responses: { 'it-R01': R('C'), 'it-R03': R('NC', { comment: 'x' }), 'it-R04': R('NA') } }, grid: GRID_RAPIDE, deviations: [{ criticalityCode: 'MAJ' }], criticalities: crit });
  eq(s.counts.C, 1); eq(s.counts.NC, 1); eq(s.counts.NA, 1);
  eq(s.byCriticality.find(c => c.code === 'MAJ').count, 1);
  assert(!('score' in s), 'aucun score');
  eq(s.ncItems.length, 1); eq(s.ncItems[0].code, 'R03'); eq(s.ncItems[0].comment, 'x');
  const rec = recurringDeviations([{ providerId: 'p', itemCode: 'Q04', auditId: 'a1', status: 'clos' }, { providerId: 'p', itemCode: 'Q04', auditId: 'a2', status: 'ouvert' }, { providerId: 'p', itemCode: 'Q05', auditId: 'a2', status: 'ouvert' }]);
  eq(rec.length, 1); eq(rec[0].open, 1);
  eq(isOverdue({ status: 'ouvert', dueDate: '2026-01-01' }, '2026-10-08'), true);
  eq(isOverdue({ status: 'clos', dueDate: '2026-01-01' }, '2026-10-08'), false);
});

test('comparaison de deux audits successifs', () => {
  const a = { gridSnapshot: GRID_RAPIDE, responses: { 'it-R01': R('NC'), 'it-R03': R('C'), 'it-R04': R('NC') } };
  const b = { gridSnapshot: GRID_RAPIDE, responses: { 'it-R01': R('C'), 'it-R03': R('NC'), 'it-R04': R('NC') } };
  const r = compareAudits(a, b);
  eq(r.stats.amelioration, 1); eq(r.stats.degradation, 1);
  deepEq(r.persistent.map(x => x.code), ['R04']);
  eq(r.rows[0].change, 'degradation', 'dégradations en tête');
  eq(r.sameGrid, true);
});

/* ---------- Fusion ---------- */
test('fusion à trois versions : champs disjoints conservés, concurrence tracée, verrou préservé', () => {
  const base = { id: 'a', responses: { q1: { status: 'C', at: '1' } }, samples: [{ id: 's1', code: 'A' }] };
  const local = { ...base, updatedAt: '2026-10-08T10:00:00Z', responses: { q1: { status: 'NC', at: '2026-10-08T10:00:00Z' }, q2: { status: 'C', at: '2' } }, samples: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }] };
  const remote = { ...base, _rev: 5, updatedAt: '2026-10-08T09:00:00Z', responses: { q1: { status: 'NA', at: '2026-10-08T09:00:00Z' }, q3: { status: 'C', at: '3' } }, samples: [{ id: 's1', code: 'A2' }], lock: { lockedAt: 'x' }, status: 'signe' };
  const { merged, conflicts } = mergeEntity('audit', base, local, remote);
  eq(merged.responses.q2.status, 'C'); eq(merged.responses.q3.status, 'C');
  eq(merged.responses.q1.status, 'NC');
  assert(conflicts.some(c => c.path.startsWith('responses.q1') && c.kept === 'local'), 'conflit tracé');
  deepEq(merged.samples.map(s => s.code).sort(), ['A2', 'B']);
  eq(merged.lock.lockedAt, 'x'); eq(merged.status, 'signe'); eq(merged._rev, 5);
  eq(mergeEntity('trail', null, { id: 't', x: 1 }, { id: 't', x: 1 }).conflicts.length, 0);
});

test('fusion : objets immuables, suppressions, versions absentes', () => {
  assert(IMMUTABLE_TYPES.has('trail') && IMMUTABLE_TYPES.has('media'));
  const imm = mergeEntity('media', null, { id: 'm', sha: 'a', updatedAt: '2' }, { id: 'm', sha: 'b', updatedAt: '1' });
  eq(imm.merged.sha, 'b', 'objet immuable : version distante'); eq(imm.conflicts.length, 1);
  eq(mergeEntity('audit', null, { id: 'x', v: 1 }, null).merged.v, 1, 'pas de version distante');
  eq(mergeEntity('audit', null, null, { id: 'x', v: 2 }).merged.v, 2, 'pas de version locale');
  // Élément supprimé d'un côté, inchangé de l'autre : la suppression l'emporte
  const base = { id: 'a', samples: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B' }] };
  const r1 = mergeEntity('audit', base, { ...base, samples: [{ id: 's1', code: 'A' }] }, { ...base });
  deepEq(r1.merged.samples.map(s => s.id), ['s1']); eq(r1.conflicts.length, 0);
  // Supprimé d'un côté, modifié de l'autre : conservé et signalé
  const r2 = mergeEntity('audit', base, { ...base, samples: [{ id: 's1', code: 'A' }] }, { ...base, samples: [{ id: 's1', code: 'A' }, { id: 's2', code: 'B2' }] });
  deepEq(r2.merged.samples.map(s => s.code), ['A', 'B2']);
  assert(r2.conflicts.some(c => c.path === 'samples[s2]' && /supprimé/.test(c.reason)));
  deepEq(stripMeta({ id: 'x', _rev: 1, updatedAt: 't', name: 'n' }), { id: 'x', name: 'n' });
});

/* ---------- Normalisation des imports ---------- */
test('normalisation des imports', () => {
  eq(parseDate('12/10/2026'), '2026-10-12'); eq(parseDate('12-10-26'), '2026-10-12');
  eq(parseDate('31/02/2026'), ''); eq(parseDate('46307'), '2026-10-12');
  eq(parseTime('8h30'), '08:30'); eq(parseTime('0830'), '08:30');
  const m = guessMapping(['Date prévue', 'Station', 'Organisme préleveur', 'Heure'], [{ key: 'plannedDate', label: 'Date prévue' }, { key: 'site', label: 'Site', hints: ['station'] }, { key: 'provider', label: 'Prestataire', hints: ['organisme'] }, { key: 'plannedTime', label: 'Heure prévue', hints: ['heure'] }]);
  deepEq(m, { plannedDate: 0, site: 1, provider: 2, plannedTime: 3 });
  eq(resolveRef([{ code: 'HYD', name: 'HYDRECO' }], 'hydreco').code, 'HYD');
  eq(parseNumber('3,5'), 3.5);
  eq(parseBool('Oui'), true); eq(parseBool('non'), false); eq(parseBool('peut-être'), null);
});

/* ---------- Référentiel initial ---------- */
test('référentiel initial repris des fiches terrain OEG', async () => {
  const DATA = await loadDATA();
  const r = oegReferential(DATA);
  assert(r.site.length > 100, `stations : ${r.site.length}`); eq(r.site.length, r.point.length);
  assert(r.site.every(s => s.lat > 1 && s.lat < 6.5 && s.lon > -55 && s.lon < -51), 'coordonnées en Guyane');
  const athanase = r.site.find(s => s.id === 'site-09271503');
  assert(athanase && Math.abs(athanase.lat - 4.2066) < 0.01 && Math.abs(athanase.lon + 52.29) < 0.01, 'ATHANASE vers 4,2066 N / 52,29 O');
  const prog = oegProgramme(DATA);
  assert(prog.length > 100 && prog.every(p => r.campaign.some(c => c.id === p.campaignId) && r.site.some(s => s.id === p.siteId)), 'programme rattaché aux campagnes et aux stations');
  deepEq(parseSessionMonth('S2 - Déc.26'), { year: 2026, month: 12 });
  const demo = demoData({ today: '2026-10-08' });
  eq(demo.prestation.length, 3);
});

/* ---------- Droits ---------- */
test('droits par profil', () => {
  eq(canWrite('auditeur', 'audit'), true);
  eq(canWrite('auditeur', 'grid'), false);
  eq(canWrite('consultation', 'audit'), false);
  eq(canWrite('consultation', 'trail'), true);
  eq(canWrite('auditeur', 'conflict'), false);
  eq(roleCan('rq', 'audit.amend'), true); eq(roleCan('auditeur', 'audit.amend'), false);
  eq(roleCan('admin', 'users.manage'), true); eq(roleCan('rq', 'users.manage'), false);
  eq(roleCan('auditeur', 'inconnu'), false);
  eq(writePermission('inconnu'), null);
  deepEq(Object.keys(ROLES), ['admin', 'rq', 'superviseur', 'auditeur', 'consultation']);
});
