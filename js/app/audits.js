/* Opérations métier sur les audits : création (instantanés), réponses, écarts, clôture, signatures,
 * verrouillage scellé, modifications motivées après signature et vérification d'intégrité.
 * Grilles en feuilles (CT-2026) — un audit = une TOURNÉE : type de tournée (audit.auditType : bio, ce, eso),
 * stations visitées dans l'ordre de passage (audit.stations : [{key, siteId, pointId, prestationId, addedAt}] ;
 * audit.siteId / prestationId / pointId = ceux de la 1re station, audit.prestationIds = toutes), compartiments
 * retenus (audit.compartments), réponses indexées par l'identifiant EFFECTIF du critère (« it-F4-5@09271503 » pour
 * un critère de station, identifiant d'origine pour un critère de tournée ou partagé), réponses pré-remplies à la
 * création ou à l'ajout d'une station (prefilled: true), données propres aux feuilles (audit.sheets[instanceKey] :
 * observations, notes, photos, conclusion, agents ; appareils de mesure de F4 : audit.sheets['4'].instruments)
 * mises à jour par updateSheet. Tous les consommateurs utilisent la grille effective : effectiveGrid(audit). */
import { store } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { saveMedia } from '../core/media.js';
import { can } from '../core/auth.js';
import { uuid, nowISO, clone, canonicalJSON, sha256Hex, diff, compactValue, addDays, localDate, localTime } from '../core/util.js';
import {
  allItems, progress, validateResponses, visibleStructure, rankGrids, sheetsOf, sheetProgress, stationProgress, prefillResponses, normalizeCompartments,
  isSheetGrid, expandGrid, gridTypes, gridType, defaultAuditType, inferAuditType, auditCompartments, headerOf, makeStation, stationKeyOf, parseItemId, stationEntries
} from '../domain/grids.js';
import { defaultCriticality } from '../domain/model.js';
import { computeAlerts } from '../domain/rules.js';
import { auditSummary } from '../domain/summary.js';
import { CT_GRID_ID } from '../domain/default-grids.js';
import { nextNumber } from './numbering.js';
import { applicableDocuments, snapshotDocument } from './documents.js';
import { orgSettings } from './settings.js';

export const auditDeviations = auditId => store.filter('deviation', d => d.auditId === auditId).sort((a, b) => String(a.number).localeCompare(String(b.number), 'fr', { numeric: true }));
export const auditMedia = auditId => store.filter('media', m => m.auditId === auditId);

export { prefillResponses };

/* ---------- Tournée : type, stations, grille effective ---------- */
/** Type de tournée d'un audit ('bio' | 'ce' | 'eso') ; grille à types sans auditType : premier type ; sinon ''. */
export function auditTypeOf(audit) {
  const g = audit?.gridSnapshot;
  return audit?.auditType && gridType(g, audit.auditType) ? audit.auditType : defaultAuditType(g);
}
/** Sites des stations de la tournée : {[clé]: site}. */
export function stationSites(audit) {
  const out = {};
  for (const st of audit?.stations || []) out[st.key] = store.get('site', st.siteId);
  return out;
}
const sitesById = stations => Object.fromEntries((stations || []).map(st => [st.siteId, store.get('site', st.siteId)]));
const cache = new WeakMap();
/**
 * Grille EFFECTIVE de l'audit (expandGrid de l'instantané pour ses stations) : à utiliser partout (affichage, état,
 * alertes, synthèse, PDF, exports, écarts). Grille historique (sans feuilles) ou audit sans station : l'instantané.
 */
export function effectiveGrid(audit) {
  const g = audit?.gridSnapshot;
  if (!isSheetGrid(g) || !(audit.stations || []).length) return g;
  const hit = cache.get(audit);
  if (hit) return hit;
  const grid = expandGrid(g, audit.stations, sitesById(audit.stations), { provider: store.get('provider', audit.providerId) });
  cache.set(audit, grid);
  return grid;
}
/**
 * Stations de la tournée enrichies (sélecteur de stations, PDF) :
 * [{key, index, siteId, pointId, prestationId, addedAt, site, point, prestation, name, code, codeType}].
 */
export function stationsOf(audit) {
  return (audit?.stations || []).map((st, index) => {
    const site = store.get('site', st.siteId);
    return { ...st, index, site, point: st.pointId ? store.get('point', st.pointId) : null, prestation: st.prestationId ? store.get('prestation', st.prestationId) : null, name: site?.name || st.key, code: site?.code || st.key, codeType: site?.codeType || 'SANDRE' };
  });
}

/**
 * Contexte des conditions de grille (type de tournée, matrice, type de prélèvement, prestataire…) et compartiments
 * retenus (grilles en feuilles : audit.compartments, à défaut ceux du type de tournée).
 */
export function auditContext(audit) {
  const prestation = audit.prestationId ? store.get('prestation', audit.prestationId) : null;
  const site = store.get('site', audit.siteId);
  const matrix = store.get('matrix', audit.matrixId || prestation?.matrixId || site?.matrixId);
  const stype = store.get('samplingType', audit.samplingTypeId || prestation?.samplingTypeId);
  const provider = store.get('provider', audit.providerId);
  const ctx = {
    matrixCode: matrix?.code || '', samplingTypeCode: stype?.code || '', providerKind: provider?.kind || '', providerId: provider?.id || '',
    auditKind: audit.kind || '', network: (site?.networks || []).join(','), controlLevel: prestation?.controlLevel || '',
    compartments: normalizeCompartments(audit.gridSnapshot, audit.compartments)
  };
  const type = auditTypeOf(audit);
  if (type) ctx.auditType = type;
  return ctx;
}

export function mediaCounts(audit) {
  const counts = {};
  for (const m of auditMedia(audit.id)) if (m.link?.type === 'item' && m.link.itemId) counts[m.link.itemId] = (counts[m.link.itemId] || 0) + 1;
  return counts;
}

/**
 * État calculé complet d'un audit (pour l'affichage) — sur la grille EFFECTIVE :
 * {grid (effective), baseGrid (instantané), ctx, auditType, type, header, stations (stationsOf), counts, deviations,
 *  prestation, point, site, operators, alerts, structure, progress, sheets (instances), sheetProgress (par instanceKey),
 *  stationProgress ({tournee, stations}), validation, summary}
 */
export function auditState(audit, { includeMissing = false } = {}) {
  const baseGrid = audit.gridSnapshot;
  const grid = effectiveGrid(audit);
  const ctx = auditContext(audit);
  const counts = mediaCounts(audit);
  const deviations = auditDeviations(audit.id);
  const prestation = audit.prestationId ? store.get('prestation', audit.prestationId) : null;
  const point = store.get('point', audit.pointId);
  const site = store.get('site', audit.siteId);
  const provider = store.get('provider', audit.providerId);
  const stations = stationsOf(audit);
  const operators = [...(audit.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean), ...(audit.adHocOperators || [])];
  const settings = orgSettings();
  const prestations = stations.filter(st => st.prestation).map(st => ({ prestation: st.prestation, station: st }));
  const alerts = computeAlerts({ audit, grid, ctx, point, site, prestation, prestations, operators, settings, mediaCounts: counts, includeMissing, today: localDate(), stationSites: Object.fromEntries(stations.map(st => [st.key, st.site])) })
    .filter(a => !(audit.dismissedAlerts || []).some(d => d.key === a.key));
  const deviationsByItem = {};
  for (const d of deviations) if (d.itemId) deviationsByItem[d.itemId] = (deviationsByItem[d.itemId] || 0) + 1;
  const responses = audit.responses || {};
  const sheetGrid = isSheetGrid(grid);
  return {
    grid, baseGrid, ctx, auditType: ctx.auditType || '', type: gridType(baseGrid, ctx.auditType) || null,
    header: sheetGrid ? headerOf(baseGrid, { provider, auditType: ctx.auditType, campaign: audit.campaignId ? store.get('campaign', audit.campaignId) : null }) : null,
    stations, counts, deviations, prestation, point, site, operators, alerts,
    structure: visibleStructure(grid, responses, ctx),
    progress: progress(grid, responses, ctx, counts),
    sheets: sheetGrid ? sheetsOf(grid, responses, ctx) : [],
    sheetProgress: sheetGrid ? sheetProgress(grid, responses, ctx, counts) : {},
    stationProgress: sheetGrid ? stationProgress(grid, responses, ctx, counts) : null,
    validation: validateResponses(grid, responses, ctx, { mediaCounts: counts, deviationsByItem }),
    summary: auditSummary({ audit, grid, ctx, deviations: deviations.filter(d => d.status !== 'annule'), criticalities: store.all('criticality'), alerts })
  };
}

export function gridsFor(prestation) {
  const grids = store.all('grid').filter(g => g.status === 'publiee');
  return rankGrids(grids, { samplingTypeId: prestation?.samplingTypeId, matrixId: prestation?.matrixId, providerId: prestation?.providerId, protocolDocKey: prestation?.protocolDocKey, cctpDocKey: prestation?.cctpDocKey });
}

const defaultPointId = siteId => store.find('point', p => p.siteId === siteId)?.id || null;
const sessionStamp = at => ({ at, by: session.user.id, byName: session.user.name });

/**
 * Crée un audit (une tournée). Tout ce qui sert de référence est FIGÉ dans l'audit : copie de la grille, instantané
 * des documents applicables (version + empreinte), identification de l'appareil et de l'application.
 * p : {auditType?, stations?: [{siteId, prestationId?, pointId?}] (ordre de passage), providerId?, compartments?,
 *      operatorIds?, campaignId?, kind ('planifie' | 'inopine'), gridId? (défaut : grille de la prestation, sinon
 *      CT-2026 si un type de tournée est donné), samplingTypeId?, matrixId?}
 * Compatibilité : `prestationId` / `siteId` / `pointId` seuls = une station.
 * Grille à types : type de tournée = `auditType`, sinon déduit de la 1re prestation / station ; compartiments =
 * choix limité aux compartiments du type (biologie : défaut = ceux des stations ou de la prestation ; cours d'eau :
 * organisation + physico ; eaux souterraines : organisation + eso). Les critères `prefill` reçoivent une valeur
 * initiale (sans statut, prefilled: true), ceux des feuilles station avec les données de LEUR station.
 */
export async function createAudit({ prestationId = null, gridId = null, kind = 'planifie', providerId = null, siteId = null, pointId = null, operatorIds = [], samplingTypeId = null, matrixId = null, compartments = null, auditType = null, stations = null, campaignId = null } = {}) {
  if (!can('audit.create')) throw new Error('Votre profil ne permet pas de créer un audit.');
  // Stations demandées (compatibilité : prestationId / siteId seuls = une station).
  const req = (Array.isArray(stations) && stations.length ? stations : [{ siteId, prestationId, pointId }]).map(s => {
    const p = s?.prestationId ? store.get('prestation', s.prestationId) : null;
    if (s?.prestationId && !p) throw new Error('Prestation introuvable.');
    return { siteId: s?.siteId || p?.siteId || null, prestationId: p?.id || null, pointId: s?.pointId || p?.pointIds?.[0] || null, prestation: p };
  });
  const prestation = req[0].prestation;
  const grid = store.get('grid', gridId || prestation?.gridId || (auditType ? CT_GRID_ID : null));
  if (!grid) throw new Error('Grille d’audit introuvable.');
  if (auditType && gridTypes(grid).length && !gridType(grid, auditType)) throw new Error(`Type de tournée inconnu : ${auditType}`);
  const site0 = req[0].siteId ? store.get('site', req[0].siteId) : null;
  const type = gridTypes(grid).length ? (auditType || inferAuditType(grid, { site: site0, prestation })) : '';
  const typeDef = gridType(grid, type);
  const now = nowISO(), today = localDate(), date = new Date(now);
  // Stations de la tournée (ordre de passage, sans doublon).
  const list = [];
  for (const s of req) {
    if (!s.siteId) { if (isSheetGrid(grid)) throw new Error('Station non précisée.'); continue; }
    if (!store.get('site', s.siteId)) throw new Error(`Station introuvable : ${s.siteId}`);
    const st = makeStation({ siteId: s.siteId, pointId: s.pointId || defaultPointId(s.siteId), prestationId: s.prestationId }, now);
    if (list.some(x => x.key === st.key)) throw new Error(`Station en double dans la tournée : ${st.key}`);
    list.push(st);
  }
  if (isSheetGrid(grid) && !list.length) throw new Error('Une tournée compte au moins une station.');
  const prestations = req.map(r => r.prestation).filter(Boolean);
  const { number, source } = await nextNumber('AUD', new Date().getFullYear());
  const docs = applicableDocuments(prestation || { providerId, samplingTypeId: samplingTypeId || typeDef?.samplingTypeId, siteId: list[0]?.siteId }, today);
  const documentsSnapshot = await Promise.all(docs.map(snapshotDocument));
  const gridSnapshot = clone(grid);
  const audit = {
    id: uuid(), number, numberSource: source, kind,
    auditType: type || null,
    stations: list,
    prestationIds: [...new Set(list.map(s => s.prestationId).filter(Boolean))],
    prestationId: list[0]?.prestationId || prestation?.id || null,
    providerId: providerId || prestation?.providerId || null,
    siteId: list[0]?.siteId || req[0].siteId || null,
    pointId: list[0]?.pointId || req[0].pointId || null,
    operatorIds: operatorIds.length ? operatorIds : [...new Set(prestations.flatMap(p => p.operatorIds || []))],
    samplingTypeId: samplingTypeId || prestation?.samplingTypeId || typeDef?.samplingTypeId || null,
    matrixId: matrixId || prestation?.matrixId || site0?.matrixId || typeDef?.matrixId || null,
    campaignId: campaignId || prestation?.campaignId || null,
    auditorId: session.user.id, auditorName: session.user.name, auditorRole: session.user.role,
    device: { id: session.device.id, name: session.device.name, userAgent: navigator.userAgent },
    appVersion: appVersion(),
    gridId: grid.id, gridCode: grid.code, gridVersion: grid.version, gridSnapshot,
    gridSha256: await sha256Hex(canonicalJSON(gridSnapshot)),
    documentsSnapshot,
    protocolVersion: documentsSnapshot.find(d => d.type === 'PROTOCOLE')?.version || null,
    cctpVersion: documentsSnapshot.find(d => d.type === 'CCTP')?.version || null,
    startedAt: now, endedAt: null, status: 'en_cours',
    compartments: [], sheets: {},
    responses: {}, gps: [], samples: [], equipmentChecks: [], dismissedAlerts: [],
    signatures: {}, lock: null, amendments: [], reports: [], conclusions: { strengths: '', vigilance: '', comment: '', preconisations: '' },
    stationLog: [], removedStations: []
  };
  const sites = sitesById(list);
  if (grid.compartments?.length) {
    if (typeDef) {
      const fromStations = [...new Set(list.flatMap(st => sites[st.siteId]?.compartments || []))];
      const wanted = Array.isArray(compartments) && compartments.length ? compartments
        : fromStations.length ? fromStations : prestation?.compartments?.length ? prestation.compartments : null;
      audit.compartments = auditCompartments(grid, type, wanted);
    } else {
      const wanted = Array.isArray(compartments) && compartments.length ? compartments
        : site0?.compartments?.length ? site0.compartments : prestation?.compartments?.length ? prestation.compartments : null;
      audit.compartments = normalizeCompartments(grid, wanted);
    }
  } else if (Array.isArray(compartments)) audit.compartments = [...compartments];
  const provider = store.get('provider', audit.providerId);
  const eff = expandGrid(gridSnapshot, list, sites, { provider });
  const time = localTime(date);
  audit.responses = prefillResponses(eff, {
    site: site0, auditor: { name: session.user.name }, provider, prestation,
    operators: audit.operatorIds.map(id => store.get('operator', id)).filter(Boolean),
    date: localDate(date), time, kind, stationCount: list.length, compartments: audit.compartments, auditType: type,
    // Heure d'arrivée pré-remplie pour la 1re station seulement (les suivantes : à l'arrivée sur place).
    stations: list.map((st, i) => ({ key: st.key, site: sites[st.siteId], prestation: req.find(r => r.siteId === st.siteId)?.prestation || null, time: i === 0 ? time : '' })),
    ...sessionStamp(now)
  });
  await store.put('audit', audit, { action: 'create', reason: kind === 'inopine' ? 'Audit inopiné' : null });
  for (const p of prestations) await addPrestationHistory(p, { event: 'audit-demarre', auditId: audit.id, label: `Audit ${number} démarré${list.length > 1 ? ` (tournée de ${list.length} stations)` : ''}` });
  return store.get('audit', audit.id);
}

/**
 * Ajoute une station à la tournée (fin de l'ordre de passage) : pré-remplit ses critères (date, heure d'arrivée,
 * données de la station), met à jour le « Programme journalier (nombre de stations) » s'il est encore pré-rempli,
 * historise (audit.stationLog, journal, historique de la prestation). Refus : station déjà présente, audit
 * verrouillé ou abandonné, grille sans feuilles.
 */
export async function addStation(audit, { siteId = null, prestationId = null, pointId = null } = {}, { reason = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Audit signé et verrouillé : impossible d’ajouter une station.');
  if (cur.status === 'abandonne') throw new Error('Audit abandonné : impossible d’ajouter une station.');
  if (!isSheetGrid(cur.gridSnapshot)) throw new Error('Cette grille ne permet pas les tournées à plusieurs stations.');
  const prestation = prestationId ? store.get('prestation', prestationId) : null;
  if (prestationId && !prestation) throw new Error('Prestation introuvable.');
  siteId = siteId || prestation?.siteId;
  const site = siteId ? store.get('site', siteId) : null;
  if (!site) throw new Error('Station introuvable.');
  const now = nowISO(), d = new Date(now);
  const st = makeStation({ siteId, pointId: pointId || prestation?.pointIds?.[0] || defaultPointId(siteId), prestationId: prestation?.id || null }, now);
  if ((cur.stations || []).some(s => s.key === st.key)) throw new Error('Cette station fait déjà partie de la tournée.');
  const stations = [...(cur.stations || []), st];
  const provider = store.get('provider', cur.providerId);
  const eff = expandGrid(cur.gridSnapshot, stations, sitesById(stations), { provider });
  const pre = prefillResponses(eff, {
    onlyStation: st.key, site, prestation, auditor: { name: cur.auditorName }, provider,
    operators: (cur.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean),
    date: localDate(d), time: localTime(d), kind: cur.kind, compartments: cur.compartments, auditType: auditTypeOf(cur), ...sessionStamp(now)
  });
  const countIds = allItems(eff).filter(i => i.prefill === 'tournee.stationCount').map(i => i.id);
  await updateAudit(cur, a => {
    a.stations = stations;
    a.prestationIds = [...new Set([...(a.prestationIds || []), ...(st.prestationId ? [st.prestationId] : [])])];
    a.responses = a.responses || {};
    for (const [k, v] of Object.entries(pre)) if (!a.responses[k]) a.responses[k] = v;
    for (const id of countIds) { const r = a.responses[id]; if (!r || (r.prefilled && !r.status)) a.responses[id] = { ...(r || {}), value: stations.length, prefilled: true, ...sessionStamp(now) }; }
    a.stationLog = [...(a.stationLog || []), { ...sessionStamp(now), action: 'ajout', key: st.key, siteId, prestationId: st.prestationId, reason: reason || null }];
  }, { reason: reason || `Ajout de la station ${site.name} (${site.code}) à la tournée` });
  if (prestation) await addPrestationHistory(prestation, { event: 'audit-demarre', auditId: cur.id, label: `Audit ${cur.number} : station ajoutée à la tournée` });
  return store.get('audit', cur.id);
}

/**
 * Retire une station de la tournée. Sans saisie de l'auditeur pour cette station (hors pré-remplissage, encadrés,
 * médias, écarts) : retrait simple. Sinon `reason` est OBLIGATOIRE (erreur `needsReason`) et les saisies retirées sont
 * conservées dans audit.removedStations (traçabilité). Refus : audit verrouillé, dernière station de la tournée.
 */
export async function removeStation(audit, key, { reason = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Audit signé et verrouillé : impossible de retirer une station.');
  const st = (cur.stations || []).find(s => s.key === key);
  if (!st) throw new Error('Station absente de la tournée.');
  if ((cur.stations || []).length <= 1) throw new Error('Une tournée compte au moins une station.');
  const entries = stationEntries(cur, key);
  const media = auditMedia(cur.id).filter(m => parseItemId(m.link?.itemId).stationKey === key || m.link?.stationKey === key).length;
  const devs = auditDeviations(cur.id).filter(dv => dv.status !== 'annule' && dv.stationKey === key).length;
  const hasData = entries.responses.length + entries.sheets.length + media + devs > 0;
  if (hasData && !String(reason || '').trim()) {
    const e = new Error('Des constats ont déjà été saisis pour cette station : un motif est obligatoire pour la retirer de la tournée.');
    e.needsReason = true; e.entries = { ...entries, media, deviations: devs };
    throw e;
  }
  const now = nowISO();
  const site = store.get('site', st.siteId);
  const suffix = '@' + key;
  const countIds = new Set(allItems(cur.gridSnapshot).filter(i => i.prefill === 'tournee.stationCount').map(i => i.id));
  await updateAudit(cur, a => {
    const removed = { station: st, ...sessionStamp(now), reason: reason || null, responses: {}, sheets: {} };
    for (const id of Object.keys(a.responses || {})) if (id.endsWith(suffix)) { removed.responses[id] = a.responses[id]; delete a.responses[id]; }
    for (const k of Object.keys(a.sheets || {})) if (String(k).endsWith(suffix)) { removed.sheets[k] = a.sheets[k]; delete a.sheets[k]; }
    a.stations = a.stations.filter(s => s.key !== key);
    if (hasData) a.removedStations = [...(a.removedStations || []), removed];
    a.stationLog = [...(a.stationLog || []), { ...sessionStamp(now), action: 'retrait', key, siteId: st.siteId, prestationId: st.prestationId, reason: reason || null }];
    const first = a.stations[0];
    a.siteId = first.siteId; a.pointId = first.pointId; a.prestationId = first.prestationId || null;
    a.prestationIds = [...new Set(a.stations.map(s => s.prestationId).filter(Boolean))];
    for (const id of countIds) { const r = a.responses?.[id]; if (r?.prefilled && !r.status) a.responses[id] = { ...r, value: a.stations.length }; }
  }, { reason: reason || `Retrait de la station ${site?.name || key} de la tournée (aucune saisie)` });
  const p = st.prestationId ? store.get('prestation', st.prestationId) : null;
  if (p) await addPrestationHistory(p, { event: 'audit-station-retiree', auditId: cur.id, label: `Audit ${cur.number} : station retirée de la tournée`, reason: reason || null });
  return store.get('audit', cur.id);
}

export async function addPrestationHistory(prestation, entry, patch = {}) {
  const p = store.get('prestation', prestation.id);
  await store.put('prestation', { ...p, ...patch, statusHistory: [...(p.statusHistory || []), { at: nowISO(), by: session.user?.name, ...entry }] }, { reason: entry.reason || entry.label });
}
export async function setPrestationStatus(prestation, status, reason) {
  await addPrestationHistory(prestation, { event: 'statut', from: prestation.status, to: status, reason }, { status });
}

/* ---------- Modification d'un audit (avant ou après signature) ---------- */
/**
 * Applique une modification. Sur un audit verrouillé, il faut le droit « audit.amend » et un motif :
 * l'amendement conserve les valeurs avant/après, l'auteur, la date et la nouvelle empreinte.
 */
export async function updateAudit(audit, mutate, { reason = null, action = null } = {}) {
  const before = store.get('audit', audit.id);
  const next = clone(before);
  mutate(next);
  if (before.lock?.lockedAt) {
    if (!can('audit.amend')) throw new Error('Audit signé et verrouillé : modification réservée au responsable qualité ou à l’administrateur.');
    if (!reason) throw new Error('Un motif est obligatoire pour modifier un audit signé.');
    const changes = diff(before, next, { ignore: ['amendments', 'updatedAt', 'updatedBy', 'updatedByName', '_rev', '_lv', 'reports'] });
    if (!changes.length) return before;
    const hashBefore = await auditContentHash(before);
    const hashAfter = await auditContentHash(next);
    next.amendments = [...(before.amendments || []), {
      id: uuid(), at: nowISO(), by: session.user.id, byName: session.user.name, role: session.user.role, reason,
      changes: changes.slice(0, 80).map(c => ({ path: c.path, before: compactValue(c.before), after: compactValue(c.after) })), hashBefore, hashAfter
    }];
    return store.put('audit', next, { action: 'amend', reason });
  }
  return store.put('audit', next, { action: action || undefined, reason });
}

export async function setResponse(audit, itemId, patch, { reason = null } = {}) {
  return updateAudit(audit, a => {
    const prev = a.responses[itemId] || {};
    const r = { ...prev, ...patch, at: nowISO(), by: session.user.id, byName: session.user.name };
    // Une valeur pré-remplie modifiée par l'auditeur n'est plus « pré-remplie ».
    if (prev.prefilled && 'value' in patch && !('prefilled' in patch) && canonicalJSON(patch.value ?? null) !== canonicalJSON(prev.value ?? null)) delete r.prefilled;
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    a.responses[itemId] = r;
  }, { reason });
}

/* ---------- Données propres aux feuilles (grilles en feuilles) ---------- */
/**
 * Met à jour les données d'une feuille : audit.sheets[clé] = {observations, notes, photos, conclusion:{status,
 * comments}, instruments:{ph|o2|cond|turb|redox:{model, serial, calibration, weekly, standards, morning, morningValue,
 * evening, eveningValue}}, agents}. `no` = clé de stockage : `instanceKey` de l'instance de feuille (« 4@09271503 »
 * pour une feuille station d'une tournée, « 2 » pour une feuille tournée) ; données de TOURNÉE d'une feuille
 * station (appareils de mesure de F4) : String(no), voir sheetStoreKey(). Les clés du patch remplacent celles de
 * la feuille ; `conclusion` est fusionnée champ par champ et `instruments` appareil par appareil (puis champ par
 * champ), une valeur null efface la clé. Passe par updateAudit (journal ; motif obligatoire et amendement tracé
 * sur un audit signé).
 */
export async function updateSheet(audit, no, patch = {}, { reason = null } = {}) {
  const merge = (cur, p) => {
    const out = { ...(cur || {}) };
    for (const [k, v] of Object.entries(p || {})) { if (v === null || v === undefined) delete out[k]; else out[k] = v; }
    return out;
  };
  return updateAudit(audit, a => {
    a.sheets = a.sheets || {};
    const cur = a.sheets[no] || {};
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === null || v === undefined) delete next[k];
      else if (k === 'conclusion' && typeof v === 'object' && !Array.isArray(v)) next.conclusion = merge(cur.conclusion, v);
      else if (k === 'instruments' && typeof v === 'object' && !Array.isArray(v)) {
        const ins = { ...(cur.instruments || {}) };
        for (const [key, fields] of Object.entries(v)) {
          if (fields === null) delete ins[key];
          else ins[key] = typeof fields === 'object' && !Array.isArray(fields) ? merge(ins[key], fields) : fields;
        }
        next.instruments = ins;
      } else next[k] = v;
    }
    a.sheets[no] = next;
  }, { reason });
}

/* ---------- Échantillons ---------- */
export function sampleIdFor(audit, index) {
  const pattern = orgSettings().sampleIdPattern || '{AUDIT}-E{NN}';
  const site = store.get('site', audit.siteId);
  const d = new Date();
  return pattern.replace('{AUDIT}', audit.number).replace('{SITE}', site?.code || 'SITE').replace('{YYYYMMDD}', localDate(d).replace(/-/g, ''))
    .replace('{NNN}', String(index).padStart(3, '0')).replace('{NN}', String(index).padStart(2, '0'));
}

/* ---------- Écarts ---------- */
export function nextDeviationNumber(audit) {
  const n = store.all('deviation', { withDeleted: true }).filter(d => d.auditId === audit.id).length + 1;
  return `${audit.number}-E${String(n).padStart(2, '0')}`;
}
export function defaultDueDate(criticalityCode) {
  const c = store.all('criticality').find(x => x.code === criticalityCode);
  return c?.defaultDelayDays ? addDays(localDate(), c.defaultDelayDays) : '';
}
/**
 * Enregistre un écart (jamais automatiquement : décision de l'auditeur). Depuis un critère : `itemId` effectif ;
 * criticité par défaut selon la réponse (P ⇒ OBS « Observation / piste d'amélioration », NC ⇒ MIN). L'écart
 * mémorise la station (`stationKey`, déduite de l'identifiant du critère à défaut) et en reprend site, point et
 * prestation ; écart de tournée (critère commun ou sans critère) : stationKey null, 1re station.
 */
export async function createDeviation(audit, data) {
  if (!can('deviation.manage')) throw new Error('Votre profil ne permet pas d’enregistrer un écart.');
  const now = new Date();
  const cur = store.get('audit', audit.id) || audit;
  const stationKey = data.stationKey !== undefined ? data.stationKey : parseItemId(data.itemId).stationKey;
  const station = stationKey ? (cur.stations || []).find(s => s.key === stationKey) : null;
  const responseStatus = data.itemId ? cur.responses?.[data.itemId]?.status || null : null;
  const criticalityCode = data.criticalityCode || (responseStatus ? defaultCriticality(responseStatus) : 'MIN');
  const dev = {
    id: uuid(), number: nextDeviationNumber(cur), auditId: cur.id, auditNumber: cur.number,
    providerId: cur.providerId, siteId: station?.siteId || cur.siteId, pointId: station?.pointId || cur.pointId, prestationId: station ? station.prestationId || null : cur.prestationId,
    stationKey: station?.key || null, responseStatus,
    date: localDate(now), time: now.toTimeString().slice(0, 5),
    itemId: data.itemId || null, itemCode: data.itemCode || null, requirement: data.requirement || '', docRefs: data.docRefs || [],
    description: data.description || '', auditorObservation: data.auditorObservation || '', location: data.location || null,
    criticalityCode, typeCode: data.typeCode || null,
    immediateAction: data.immediateAction || '', correctiveActionRequested: data.correctiveActionRequested || '',
    responsible: data.responsible || '', dueDate: data.dueDate || defaultDueDate(criticalityCode),
    status: 'ouvert', source: data.source || 'manuel', alertCode: data.alertCode || null,
    correctiveActions: [], history: [{ at: nowISO(), by: session.user.name, event: 'Création', status: 'ouvert' }]
  };
  return store.put('deviation', dev, { action: 'create', reason: cur.lock?.lockedAt ? (data.reason || 'Écart ajouté après signature') : null });
}
export async function updateDeviation(dev, patch, { reason = null, event = null } = {}) {
  const cur = store.get('deviation', dev.id);
  const next = { ...cur, ...patch };
  if (event || (patch.status && patch.status !== cur.status)) next.history = [...(cur.history || []), { at: nowISO(), by: session.user.name, event: event || `Statut : ${cur.status} → ${patch.status}`, status: next.status, reason }];
  return store.put('deviation', next, { reason });
}

/* ---------- Clôture, signature, verrouillage ---------- */
/**
 * Projection du contenu probant de l'audit, couverte par l'empreinte de signature :
 * l'audit (hors signatures, verrou, métadonnées) — dont les réponses, le type de tournée (auditType), les stations
 * (stations, ordre de passage), les compartiments retenus (compartments) et les données des feuilles (sheets :
 * observations, conclusions, instruments…) —,
 * les constats des écarts (hors suivi : statut, responsable, échéance, actions correctives) et les
 * médias (hors images de signature).
 * Les écarts et médias ajoutés après le verrouillage relèvent du suivi et sont tracés au journal.
 */
const DEVIATION_CONSTAT = ['id', 'number', 'date', 'time', 'itemId', 'itemCode', 'stationKey', 'requirement', 'docRefs', 'description', 'auditorObservation', 'criticalityCode', 'typeCode', 'immediateAction', 'correctiveActionRequested', 'location', 'source', 'alertCode'];
export function auditContent(audit) {
  const lockedAt = audit.lock?.lockedAt || null;
  const before = e => !lockedAt || String(e.createdAt || '') <= lockedAt;
  const deviations = auditDeviations(audit.id).filter(before).map(d => Object.fromEntries(DEVIATION_CONSTAT.map(k => [k, d[k] ?? null])));
  const media = auditMedia(audit.id).filter(m => m.link?.type !== 'signature' && before(m))
    .map(m => ({ id: m.id, sha256: m.sha256, link: m.link, takenAt: m.takenAt, derivedFrom: m.derivedFrom || null })).sort((a, b) => a.id.localeCompare(b.id));
  const { signatures, lock, amendments, reports, status, endedAt, updatedAt, updatedBy, updatedByName, _rev, _lv, _conflict, dismissedAlerts, ...content } = audit;
  // Type de tournée, stations, compartiments et données des feuilles font partie du contenu scellé.
  for (const k of ['auditType', 'stations', 'compartments', 'sheets']) if (audit[k] !== undefined) content[k] = audit[k];
  return { audit: content, deviations, media };
}
export async function auditContentHash(audit) { return sha256Hex(canonicalJSON(auditContent(audit))); }

export async function finishAudit(audit) {
  return updateAudit(audit, a => { a.endedAt = a.endedAt || nowISO(); a.status = 'termine'; }, { action: 'finish' });
}
export async function reopenAudit(audit) {
  if (audit.lock?.lockedAt) throw new Error('Audit verrouillé');
  return updateAudit(audit, a => { a.status = 'en_cours'; a.endedAt = null; a.signatures = {}; }, { action: 'reopen', reason: 'Réouverture avant signature' });
}

/** Enregistre une signature (role : 'auditor' | 'provider'). */
export async function signAudit(audit, role, { bytes, mime, name, fn = '', refused = false, comment = '' }) {
  const contentHash = await auditContentHash(audit);
  let media = null;
  if (bytes) media = await saveMedia(bytes, { mime, kind: 'signature', name: `signature-${role}.png`, link: { type: 'signature', id: audit.id, itemId: role }, auditId: audit.id });
  const sig = { role, name, function: fn, at: nowISO(), mediaId: media?.id || null, mediaSha256: media?.sha256 || null, refused, comment, contentHash, userId: role === 'auditor' ? session.user.id : null, deviceId: session.device.id, offline: !navigator.onLine };
  return updateAudit(audit, a => { a.signatures = { ...(a.signatures || {}), [role]: sig }; }, { action: 'sign' });
}

/** Verrouille l'audit signé : empreinte SHA-256 du contenu probant, plus aucune modification sans trace. */
export async function lockAudit(audit) {
  const a = store.get('audit', audit.id);
  if (!a.signatures?.auditor) throw new Error('La signature de l’auditeur est requise.');
  if (!a.signatures?.provider) throw new Error('La signature du représentant du prestataire (ou son refus motivé) est requise.');
  const contentHash = await auditContentHash(a);
  if (a.signatures.auditor.contentHash !== contentHash) throw new Error('Le contenu a été modifié après la signature de l’auditeur : faites signer à nouveau.');
  const lock = { lockedAt: nowISO(), lockedBy: session.user.id, lockedByName: session.user.name, contentHash, appVersion: appVersion(), deviceId: session.device.id };
  const saved = await store.put('audit', { ...a, lock, status: 'signe', endedAt: a.endedAt || nowISO() }, { action: 'lock', reason: 'Signature et verrouillage de l’audit' });
  // Statut de chaque prestation de la tournée : écarts de SA station + écarts communs à la tournée (hors observations).
  const devs = auditDeviations(a.id).filter(d => d.status !== 'annule' && d.criticalityCode !== 'OBS');
  const targets = (a.stations || []).length ? a.stations.filter(s => s.prestationId).map(s => ({ id: s.prestationId, key: s.key })) : a.prestationId ? [{ id: a.prestationId, key: null }] : [];
  for (const t of targets) {
    const p = store.get('prestation', t.id);
    const n = devs.filter(d => !d.stationKey || !t.key || d.stationKey === t.key).length;
    if (p) await setPrestationStatus(p, n ? 'realisee_ecart' : 'auditee', `Audit ${a.number} signé${n ? ` — ${n} écart(s)` : ''}`);
  }
  return saved;
}

/** Vérifie l'intégrité d'un audit signé : empreinte actuelle vs empreinte scellée / dernier amendement. */
export async function verifyAuditSeal(audit) {
  if (!audit.lock?.lockedAt) return { locked: false };
  const current = await auditContentHash(audit);
  const amendments = audit.amendments || [];
  const expected = amendments.length ? amendments[amendments.length - 1].hashAfter : audit.lock.contentHash;
  return {
    locked: true, current, sealed: audit.lock.contentHash, expected, ok: current === expected,
    amended: amendments.length > 0, amendments: amendments.length,
    message: current === expected
      ? (amendments.length ? `Contenu intègre — ${amendments.length} modification(s) après signature, toutes tracées.` : 'Contenu intègre — identique au contenu signé.')
      : 'ATTENTION : le contenu ne correspond pas à l’empreinte enregistrée (modification non tracée).'
  };
}

export async function abandonAudit(audit, reason) {
  if (audit.lock?.lockedAt) throw new Error('Un audit signé ne peut pas être abandonné.');
  if (!(audit.auditorId === session.user.id || can('audit.delete'))) throw new Error('Droit insuffisant.');
  return updateAudit(audit, a => { a.status = 'abandonne'; a.abandonReason = reason; a.endedAt = nowISO(); }, { action: 'abandon', reason });
}

/** Critère (grille effective) par code (« F4.5·S2 », « F2.1.1 ») ou par identifiant. */
export function itemByCode(audit, code) { return allItems(effectiveGrid(audit)).find(i => i.code === code || i.id === code) || null; }
