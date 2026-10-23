/* Opérations métier sur les audits : création (instantanés), réponses, écarts, clôture, signatures,
 * verrouillage scellé, modifications motivées après signature, vérification d'intégrité et annulation motivée
 * d'une tournée non signée (« Annuler la tournée » : cancelTour).
 * Grilles en feuilles (CT-2026) — un audit = une TOURNÉE : type de tournée (audit.auditType : bio, ce, eso),
 * stations visitées dans l'ordre de passage (audit.stations : [{key, siteId, pointId, prestationId, addedAt}] ;
 * audit.siteId / prestationId / pointId = ceux de la 1re station, audit.prestationIds = toutes), compartiments
 * retenus (audit.compartments), réponses indexées par l'identifiant EFFECTIF du critère (« it-F4-5@09271503 » pour
 * un critère de station, identifiant d'origine pour un critère de tournée ou partagé), réponses pré-remplies à la
 * création ou à l'ajout d'une station (prefilled: true), données propres aux feuilles (audit.sheets[instanceKey] :
 * observations, notes, photos, conclusion, agents ; appareils de mesure de F4 : audit.sheets['4'].instruments)
 * mises à jour par updateSheet. Tous les consommateurs utilisent la grille effective : effectiveGrid(audit).
 * Tournée en BINÔME (tablette partagée) : contrôleurs OEG de la tournée (audit.controllerIds, noms figés dans
 * audit.controllerNames {id: nom}, historique audit.controllerLog ; audit antérieur sans contrôleurs : son auteur),
 * choisis à la création, rejoints (« Rejoindre la tournée ») ou retirés avec motif ; chaque saisie reste attribuée à
 * l'agent connecté (réponse : by / byName).
 * REMPLISSAGE AUTOMATIQUE des informations redondantes (js/domain/links.js) : chaque saisie d'une source (date, météo,
 * niveau d'eau, contrôleurs de F2 ; préleveurs de la tournée ; opérateurs présents sur la station…) remplit, dans la
 * même écriture, les champs équivalents encore vides ou encore auto-remplis des autres feuilles (« Repris de F… »,
 * prefilled, from, fromId ; attribués à l'agent dont la saisie les a produits) ; une valeur saisie par l'agent
 * (valueManual) n'est jamais remplacée ; rien n'est propagé sur une tournée signée et verrouillée ou annulée, ni à la
 * réception d'un fichier d'échange. Fiche d'une station modifiée (référentiel) : informations de F3 recalculées dans les
 * tournées en cours non signées (refreshStationInfo). Valeurs seulement proposées (accès, supports, marché, effectif,
 * sondes…) : données complémentaires linkExtra.
 * Reprise des réponses de la station précédente (copyPreviousStation) : à la demande, feuille par feuille.
 * PÉRIMÈTRE RÉEL de chaque station (demande de l'OEG du 18/10/2026) : une station sur plusieurs réseaux (ex. BIO +
 * Chimie) n'est contrôlée que pour ce qui y est réellement réalisé (biologie seule, chimie seule ou les deux). Même
 * prestataire ⇒ UNE tournée, éventuellement MIXTE (plusieurs types : chaque station porte `parts` et
 * `partPrestations`, audit.auditType = type principal, audit.compartments = réunion ; normalizePerimeter de grids.js) :
 * les opérations communes (F2, F3, F4, F5, critères communs à la tournée) ne sont saisies et comptées qu'une fois ;
 * prestataires différents ⇒ tournées indépendantes, chacune avec son périmètre. Choix à la création (createAudit,
 * stations[].parts) et à l'ajout d'une station (addStation), modifiable avant la signature du contrôleur
 * (setStationParts : motif obligatoire si des saisies deviennent masquées — elles sont conservées —, écarts ouverts
 * annulés avec le même motif, historique audit.stationLog « perimetre » et journal). Une tournée d'un seul type ne porte
 * ni `parts` ni `partPrestations` : les tournées existantes, leurs sceaux et leurs PDF sont inchangés. */
import { store } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { saveMedia } from '../core/media.js';
import { can, canEditAudit } from '../core/auth.js';
import { roleCan, auditControllerIds, auditControllers, controllerNamesText, isAuditController, canJoinAudit, cancelTourRefusal } from '../domain/permissions.js';
import { uuid, nowISO, clone, canonicalJSON, sha256Hex, diff, compactValue, addDays, localDate, localTime } from '../core/util.js';
import {
  allItems, progress, validateResponses, visibleStructure, rankGrids, sheetsOf, sheetProgress, stationProgress, prefillResponses, normalizeCompartments,
  isSheetGrid, expandGrid, gridTypes, gridType, defaultAuditType, inferAuditType, auditCompartments, headerOf, makeStation, stationKeyOf, parseItemId, stationEntries,
  isEnteredResponse, visibleItems, resolveSheet, sheetStoreKey, normalizeParts, stationParts, tourTypes, tourCompartments, normalizePerimeter,
  stationPrestationIds, partsText
} from '../domain/grids.js';
import { linkedUpdates, copyFromPreviousStation, OPERATORS_SOURCE, SITE_SOURCE, LINKED_SHEET_KEYS } from '../domain/links.js';
import { defaultCriticality, auditDate, OPEN_DEVIATION } from '../domain/model.js';
import { computeAlerts } from '../domain/rules.js';
import { auditSummary } from '../domain/summary.js';
import { CT_GRID_ID, upToDateGrid } from '../domain/default-grids.js';
import { operatorLabel } from '../domain/operators.js';
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
/**
 * Types contrôlés dans la tournée (réunion des parties de ses stations, ordre de la grille) : [type] pour une tournée
 * d'un seul type ; [] pour une grille sans types.
 */
export function tourTypesOf(audit) {
  const g = audit?.gridSnapshot;
  return gridTypes(g).length ? tourTypes(g, audit?.stations || [], auditTypeOf(audit)) : [];
}
/** Tournée mixte (plusieurs types contrôlés, ex. biologie + chimie du même prestataire) ? */
export const isMixedTour = audit => tourTypesOf(audit).length > 1;
/** Parties contrôlées à une station de la tournée (`perimeter` de stationsOf) : station.parts, sinon [type de la tournée]. */
export const stationPartsOf = (audit, station) => (gridTypes(audit?.gridSnapshot).length ? stationParts(audit.gridSnapshot, station, auditTypeOf(audit)) : []);
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
 * [{key, index, siteId, pointId, prestationId, addedAt, parts?, partPrestations?, site, point, prestation, name, code,
 *   codeType, perimeter (parties contrôlées : stationPartsOf), prestations ([{type, prestation}] : une par partie)}].
 */
export function stationsOf(audit) {
  return (audit?.stations || []).map((st, index) => {
    const site = store.get('site', st.siteId);
    const perimeter = stationPartsOf(audit, st);
    const pp = st.partPrestations || (st.prestationId && perimeter.length === 1 ? { [perimeter[0]]: st.prestationId } : {});
    const prestations = perimeter.filter(t => pp[t]).map(t => ({ type: t, prestation: store.get('prestation', pp[t]) || null })).filter(x => x.prestation);
    return { ...st, index, site, point: st.pointId ? store.get('point', st.pointId) : null, prestation: st.prestationId ? store.get('prestation', st.prestationId) : null, name: site?.name || st.key, code: site?.code || st.key, codeType: site?.codeType || 'SANDRE', perimeter, prestations };
  });
}

/**
 * Nom d'une station de la tournée par sa clé : nom du site ; station retirée de la tournée (audit.removedStations,
 * à défaut journal audit.stationLog) : « Nom (retirée) » ; inconnue : la clé. codes : ajoute le code (« Nom (09271503) »).
 */
export function stationLabel(audit, key, { codes = false } = {}) {
  if (!key) return '';
  const fmt = (siteId, suffix = '') => { const s = store.get('site', siteId); return s ? `${s.name}${codes && s.code ? ` (${s.code})` : ''}${suffix}` : ''; };
  const cur = (audit?.stations || []).find(st => st.key === key);
  if (cur) return fmt(cur.siteId) || key;
  const removed = (audit?.removedStations || []).find(r => r.station?.key === key)?.station
    || [...(audit?.stationLog || [])].reverse().find(l => l.key === key && l.action === 'retrait');
  return removed ? fmt(removed.siteId, ' (retirée)') || `${key} (retirée)` : key;
}
/**
 * Rattachement d'un écart, en clair : sa station (stationLabel) ; écart commun à une tournée de plusieurs stations
 * (critère commun, alerte ou écart hors critère) : « Tournée (Crique à l’Est, Amont Voltaire) » ; sinon le site.
 */
export function deviationPlace(d, { codes = true } = {}) {
  const audit = d?.auditId ? store.get('audit', d.auditId) : null;
  if (d?.stationKey) return stationLabel(audit, d.stationKey, { codes }) || d.stationKey;
  const sites = d?.siteIds?.length ? d.siteIds : (audit?.stations || []).length > 1 ? audit.stations.map(st => st.siteId) : [];
  if (sites.length > 1) return `Tournée (${sites.map(id => store.get('site', id)?.name || id).join(', ')})`;
  const s = store.get('site', d?.siteId || sites[0]);
  return s ? `${s.name}${codes && s.code ? ` (${s.code})` : ''}` : '';
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
    // network : réseaux joints (« BIO,Chimie », compatibilité, opérateur « est égal à ») ; networks : tableau (opérateur
    // « fait partie de » : vrai pour une station sur plusieurs réseaux dès que l'un d'eux est cité).
    auditKind: audit.kind || '', network: (site?.networks || []).join(','), networks: [...(site?.networks || [])], controlLevel: prestation?.controlLevel || '',
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
  // Préleveurs : fiche du référentiel, à défaut (fiche absente de la tablette) le libellé figé dans la tournée.
  const operators = [...(audit.operatorIds || []).map(id => store.get('operator', id) || (audit.operatorNames?.[id] ? { id, code: '', firstName: '', lastName: audit.operatorNames[id], frozen: true } : null)).filter(Boolean), ...(audit.adHocOperators || [])];
  const settings = orgSettings();
  // Prestations de la tournée comparées à leur station ; prestation d'une autre partie d'une station mixte : comparée au
  // type de prélèvement de SA partie (ex. chimie : physico-chimie) et non à celui du type principal.
  const prestations = stations.flatMap(st => [
    ...(st.prestation ? [{ prestation: st.prestation, station: st }] : []),
    ...st.prestations.filter(x => x.prestation.id !== st.prestationId).map(x => ({ prestation: x.prestation, station: st, samplingTypeId: gridType(baseGrid, x.type)?.samplingTypeId || null }))
  ]);
  const types = tourTypesOf(audit);
  const alerts = computeAlerts({ audit, grid, ctx, point, site, prestation, prestations, operators, settings, mediaCounts: counts, includeMissing, today: localDate(), stationSites: Object.fromEntries(stations.map(st => [st.key, st.site])) })
    .filter(a => !(audit.dismissedAlerts || []).some(d => d.key === a.key));
  const deviationsByItem = {};
  for (const d of deviations) if (d.itemId) deviationsByItem[d.itemId] = (deviationsByItem[d.itemId] || 0) + 1;
  const responses = audit.responses || {};
  const sheetGrid = isSheetGrid(grid);
  return {
    grid, baseGrid, ctx, auditType: ctx.auditType || '', type: gridType(baseGrid, ctx.auditType) || null,
    // Types contrôlés (tournée mixte : plusieurs) et leurs définitions.
    tourTypes: types, mixed: types.length > 1, types: types.map(k => gridType(baseGrid, k)).filter(Boolean),
    header: sheetGrid ? headerOf(baseGrid, { provider, auditType: ctx.auditType, campaign: audit.campaignId ? store.get('campaign', audit.campaignId) : null, auditTypes: types }) : null,
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

/* ---------- Remplissage automatique des informations redondantes (js/domain/links.js) ---------- */
/** Sources de tournée des groupes de champs liés (création de la tournée, ajout d'une station). */
const TOUR_SOURCES = ['it-F2-1.4', 'it-F2-1.1', 'it-F2-1.9', 'it-F2-1.8', OPERATORS_SOURCE];
/** Source « fiche de la station » d'une station de la tournée (informations de F3 recalculées). */
const siteSource = key => `${SITE_SOURCE}@${key}`;
/** Préleveurs de la tournée en clair : « Prénom Nom (INI) — fonction, … » (libellés figés dans la tournée). */
export function tourOperatorsText(audit) {
  return (audit?.operatorIds || []).map(id => audit.operatorNames?.[id] || operatorLabel(store.get('operator', id))).filter(Boolean).join(', ');
}
/** Appareils du module « Appareils de mesure » (F4, donnée de tournée) : [{ key, label, model, serial, calibration… }]. */
function tourInstruments(audit) {
  const sh = (audit?.gridSnapshot?.sheets || []).find(s => (s.modules || []).includes('instruments'));
  if (!sh) return [];
  const r = resolveSheet(sh, auditTypeOf(audit));
  const data = audit.sheets?.[sheetStoreKey(r, 'instruments')]?.instruments || {};
  return (r.instruments || []).map(ins => ({ key: ins.key, label: ins.label, ...(data[ins.key] || {}) }));
}
/**
 * Données complémentaires des groupes liés (js/domain/links.js) : préleveurs de la tournée et prestataire, fiches des
 * stations (informations de F3, moyens d'accès, difficultés), compartiments contrôlés, référence du marché des
 * prestations (lots du contrat du prestataire), appareils de mesure de F4.
 */
export function linkExtra(audit) {
  const provider = store.get('provider', audit?.providerId);
  const stations = (audit?.stations || []).map(st => ({ key: st.key, site: store.get('site', st.siteId) || null }));
  const prestations = [...new Set([...(audit?.prestationIds || []), audit?.prestationId].filter(Boolean))].map(id => store.get('prestation', id)).filter(p => p?.marketRef);
  return {
    operatorsText: tourOperatorsText(audit), operatorsCount: (audit?.operatorIds || []).length, providerName: provider?.name || '',
    sites: Object.fromEntries(stations.map(s => [s.key, s.site])),
    stations: stations.map(({ key, site }) => ({ key, name: site?.name || key, modes: [...(site?.access?.modes || []), ...(site?.transportModes || [])], difficulties: site?.difficulties || '' })),
    compartments: (audit?.gridSnapshot?.compartments || []).filter(c => !c.always && (audit.compartments || []).includes(c.key)).map(c => ({ key: c.key, label: c.label })),
    markets: prestations.map(p => ({ ref: p.marketRef, lots: (provider?.contracts || []).find(k => k.ref === p.marketRef)?.lots || '' })),
    instruments: tourInstruments(audit)
  };
}
/** Critères visibles de la grille effective d'un audit (version en cours de modification comprise). */
function linkItems(a) {
  if (!isSheetGrid(a?.gridSnapshot) || !(a.stations || []).length) return [];
  const grid = expandGrid(a.gridSnapshot, a.stations, sitesById(a.stations), { provider: store.get('provider', a.providerId) });
  return visibleItems(grid, a.responses || {}, auditContext(a)).map(x => x.item);
}
const emptyValue = v => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'object' && !Object.values(v || {}).some(x => !emptyValue(x)));
/**
 * Applique EN PLACE (dans la fonction de modification d'updateAudit, une seule écriture) les reprises des sources
 * `changed` : valeurs { value, prefilled: true, from, fromId } attribuées à l'agent connecté (sauf réponse déjà saisie :
 * son auteur est conservé) ; encadrés liés (`<clé>From`). Rien sur une tournée signée et verrouillée ou annulée, ni
 * sur une grille sans feuilles. Retourne le nombre de champs mis à jour.
 */
export function applyLinks(a, changed, at = nowISO()) {
  if (!isSheetGrid(a?.gridSnapshot) || a.lock?.lockedAt || a.status === 'abandonne' || !session.user) return 0;
  const ups = linkedUpdates({ items: linkItems(a), responses: a.responses || {}, sheets: a.sheets || {}, changed, extra: linkExtra(a) });
  const stamp = sessionStamp(at);
  a.responses = a.responses || {};
  for (const u of ups) {
    if (u.sheet) {
      a.sheets = a.sheets || {};
      const d = { ...(a.sheets[u.sheet] || {}) };
      if (u.clear) { delete d[u.key]; delete d[u.key + 'From']; } else { d[u.key] = u.value; d[u.key + 'From'] = u.from; }
      a.sheets[u.sheet] = d;
      continue;
    }
    const r = a.responses[u.id];
    if (u.clear) {
      if (!r) continue;
      const n = { ...r };
      for (const k of ['value', 'prefilled', 'from', 'fromId']) delete n[k];
      if (!n.status && emptyValue(n.comment)) delete a.responses[u.id]; else a.responses[u.id] = n;
      continue;
    }
    a.responses[u.id] = { ...(r || {}), value: u.value, prefilled: true, from: u.from, fromId: u.fromId, ...(isEnteredResponse(r) ? {} : stamp) };
  }
  return ups.length;
}
/**
 * Fiche d'une station modifiée dans le référentiel (« Modifier la station », Référentiels › Sites, import) : les
 * informations de la station reprises dans F3 (bassin, cours d'eau, nom, codes, Strahler, pressions, commune, HER)
 * sont recalculées dans les tournées EN COURS qui la visitent quand elles sont encore auto-remplies (jamais une saisie
 * ni une valeur déjà cotée : la nouvelle valeur y est seulement proposée) ; jamais une tournée signée (même pas encore
 * verrouillée : la signature couvre le contenu), terminée, verrouillée ou annulée. Valeurs attribuées à l'agent
 * connecté (auteur de la modification de la fiche), une écriture par tournée (journal). Retourne le nombre de tournées
 * mises à jour. Pas d'appel à la réception d'un fichier d'échange (la valeur est alors proposée sur la feuille).
 */
export async function refreshStationInfo(siteIds, { reason = null } = {}) {
  const ids = new Set([].concat(siteIds || []).filter(Boolean));
  if (!ids.size || !session.user) return 0;
  const open = store.filter('audit', a => a.status === 'en_cours' && !a.lock?.lockedAt && !Object.keys(a.signatures || {}).length
    && isSheetGrid(a.gridSnapshot) && (a.stations || []).some(s => ids.has(s.siteId)));
  let n = 0;
  for (const cur of open) {
    const sts = cur.stations.filter(s => ids.has(s.siteId));
    const changed = sts.map(s => siteSource(s.key));
    if (!applyLinks(clone(cur), changed)) continue;
    const names = sts.map(s => store.get('site', s.siteId)?.name || s.key).join(', ');
    const now = nowISO();
    await updateAudit(cur, a => { applyLinks(a, changed, now); }, { reason: reason || `Informations de la station ${names} reprises de la fiche station (référentiel modifié)` });
    n++;
  }
  return n;
}

/* ---------- Contrôleurs OEG de la tournée (binôme) ---------- */
/** Noms des agents connus (profils « user ») : {id: nom} ; l'agent connecté avec son nom de session. */
export function agentNames() {
  const out = Object.fromEntries(store.all('user').map(u => [u.id, u.name]));
  if (session.user?.id) out[session.user.id] = out[session.user.id] || session.user.name;
  return out;
}
/** Agents pouvant contrôler une tournée : profils actifs autorisés à réaliser des audits (agent connecté inclus). */
export function tourAgents() {
  const list = store.filter('user', u => u.active !== false && roleCan(u.role, 'audit.edit'));
  if (session.user && roleCan(session.user.role, 'audit.edit') && !list.some(u => u.id === session.user.id)) list.push({ id: session.user.id, name: session.user.name, username: session.user.username, role: session.user.role });
  return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
}
/** Contrôleurs de la tournée [{id, name}] (noms figés dans la tournée, à défaut profils). */
export const tourControllers = audit => auditControllers(audit, agentNames());
/** « A. Dupont, B. Martin » : contrôleurs de la tournée (Agent(s) OEG, Contrôleur OEG, fiches, rapports, listes). */
export const controllersLabel = audit => controllerNamesText(audit, agentNames());
export { auditControllerIds, isAuditController, canJoinAudit, cancelTourRefusal };

/** Contrôleurs demandés à la création : agent connecté toujours inclus (en tête), agents actifs autorisés à auditer. */
function resolveControllers(ids) {
  const me = session.user;
  const out = [{ id: me.id, name: me.name }];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || out.some(c => c.id === id)) continue;
    const u = store.get('user', id);
    if (!u) throw new Error(`Agent inconnu sur cet appareil : ${id}`);
    if (u.active === false) throw new Error(`Le compte de ${u.name} est désactivé.`);
    if (!roleCan(u.role, 'audit.edit')) throw new Error(`Le profil de ${u.name} ne permet pas de réaliser des audits.`);
    out.push({ id: u.id, name: u.name });
  }
  return out;
}
/** Réponses pré-remplies avec les noms des contrôleurs (Agent(s) OEG, Contrôleur OEG) et encore non modifiées. */
function refreshControllerPrefill(a, names) {
  const g = a.gridSnapshot;
  const grid = isSheetGrid(g) && (a.stations || []).length ? expandGrid(g, a.stations, sitesById(a.stations), { provider: store.get('provider', a.providerId) }) : g;
  if (!grid) return;
  for (const it of allItems(grid).filter(i => i.prefill === 'auditor.name')) {
    const r = a.responses?.[it.id];
    if (r?.prefilled && !r.status) a.responses[it.id] = { ...r, value: names };
  }
}
function controllerChange(audit) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Tournée signée et verrouillée : la liste des contrôleurs ne peut plus changer.');
  if (cur.status === 'abandonne') throw new Error('Tournée annulée.');
  if (cur.signatures?.auditor) throw new Error('Tournée déjà signée par un contrôleur : rouvrez-la avant de modifier la liste des contrôleurs.');
  return cur;
}
/**
 * Ajoute un contrôleur à la tournée : l'agent connecté (« Rejoindre la tournée », droit audit.edit) ou, par un
 * contrôleur de la tournée (ou l'encadrement), un autre agent actif autorisé à auditer. Rien n'est effacé : les
 * saisies restent attribuées à leurs auteurs ; noms pré-remplis (Agent(s) OEG, Contrôleur OEG) mis à jour s'ils
 * n'ont pas été modifiés ; historique (audit.controllerLog) et journal d'audit.
 */
export async function addController(audit, userId = session.user?.id, { reason = null } = {}) {
  const cur = controllerChange(audit);
  const self = userId === session.user.id;
  if (self ? !can('audit.edit') : !canEditAudit(cur)) throw new Error(self ? 'Votre profil ne permet pas de réaliser des audits.' : 'Seul un contrôleur de la tournée peut y ajouter un agent.');
  if (isAuditController(cur, userId)) return cur;
  const u = self ? { id: session.user.id, name: session.user.name, role: session.user.role, active: true } : store.get('user', userId);
  if (!u) throw new Error('Agent inconnu sur cet appareil.');
  if (u.active === false || !roleCan(u.role, 'audit.edit')) throw new Error(`${u.name} ne peut pas contrôler une tournée (compte désactivé ou profil sans droit d’audit).`);
  const before = tourControllers(cur);
  const after = [...before, { id: u.id, name: u.name }];
  const now = nowISO();
  return updateAudit(cur, a => {
    a.controllerIds = after.map(c => c.id);
    a.controllerNames = Object.fromEntries(after.map(c => [c.id, c.name]));
    a.controllerLog = [...(a.controllerLog || []), { ...sessionStamp(now), action: 'ajout', userId: u.id, name: u.name, reason: reason || null }];
    refreshControllerPrefill(a, after.map(c => c.name).filter(Boolean).join(', '));
    applyLinks(a, ['it-F2-1.1'], now);
  }, { action: 'controller-add', reason: reason || (self ? `${u.name} rejoint la tournée` : `${u.name} ajouté(e) aux contrôleurs de la tournée`) });
}
/** « Rejoindre la tournée » : l'agent connecté devient contrôleur de la tournée. */
export const joinTour = (audit, opts) => addController(audit, session.user.id, opts);
/**
 * Retire un contrôleur de la tournée (motif obligatoire), par un contrôleur de la tournée ou l'encadrement ;
 * jamais le dernier. Ses saisies restent dans la tournée, attribuées à leur auteur.
 */
export async function removeController(audit, userId, { reason = null } = {}) {
  const cur = controllerChange(audit);
  if (!canEditAudit(cur)) throw new Error('Seul un contrôleur de la tournée peut en retirer un autre.');
  const before = tourControllers(cur);
  const gone = before.find(c => c.id === userId);
  if (!gone) throw new Error('Cet agent n’est pas contrôleur de la tournée.');
  if (before.length <= 1) throw new Error('Une tournée compte au moins un contrôleur.');
  if (!String(reason || '').trim()) throw new Error('Un motif est obligatoire pour retirer un contrôleur de la tournée.');
  const after = before.filter(c => c.id !== userId);
  const now = nowISO();
  return updateAudit(cur, a => {
    a.controllerIds = after.map(c => c.id);
    a.controllerNames = Object.fromEntries(after.map(c => [c.id, c.name]));
    a.controllerLog = [...(a.controllerLog || []), { ...sessionStamp(now), action: 'retrait', userId, name: gone.name, reason }];
    refreshControllerPrefill(a, after.map(c => c.name).filter(Boolean).join(', '));
    applyLinks(a, ['it-F2-1.1'], now);
  }, { action: 'controller-remove', reason: `${gone.name} retiré(e) des contrôleurs de la tournée — ${reason}` });
}
/**
 * Saisies par agent (onglet Infos) : [{id, name, responses, controller}] — réponses saisies (hors pré-remplissages)
 * comptées pour leur dernier auteur (by / byName), contrôleurs de la tournée en premier.
 */
export function entriesByAgent(audit) {
  const ctrl = tourControllers(audit);
  const rows = new Map(ctrl.map(c => [c.id, { id: c.id, name: c.name, responses: 0, controller: true }]));
  for (const r of Object.values(audit?.responses || {})) {
    if (!isEnteredResponse(r)) continue;
    const id = r.by || ('nom:' + (r.byName || '?'));
    if (!rows.has(id)) rows.set(id, { id, name: r.byName || agentNames()[r.by] || 'Agent inconnu', responses: 0, controller: false });
    rows.get(id).responses++;
  }
  return [...rows.values()];
}

/* ---------- Périmètre réel des stations (parties contrôlées, tournée mixte) ---------- */
/** Type de tournée d'une prestation (prestation.auditType, sinon déduit) ; '' si inconnu. */
const prestationPart = (grid, p, site = null) => (p ? (p.auditType && gridType(grid, p.auditType) ? p.auditType : inferAuditType(grid, { prestation: p, site })) : '');
/**
 * Prestations rattachées aux parties d'une station ({type: prestationId}) : celles données (`partPrestations`, prestations
 * connues seulement), puis la prestation de la station pour la partie de son type si elle n'en a pas encore.
 */
function partPrestationsOf(grid, parts, { prestationId = null, partPrestations = null, siteId = null } = {}) {
  const out = {};
  for (const [k, id] of Object.entries(partPrestations || {})) if (id && parts.includes(k) && store.get('prestation', id)) out[k] = id;
  const p = prestationId ? store.get('prestation', prestationId) : null;
  const t = prestationPart(grid, p, siteId ? store.get('site', siteId) : null);
  if (p && parts.includes(t) && !out[t] && !Object.values(out).includes(p.id)) out[t] = p.id;
  return out;
}
/**
 * Compartiments d'une tournée après un changement de périmètre : un seul type, inchangé : tels quels ; sinon, type par
 * type, le choix existant pour un type déjà contrôlé, les compartiments des stations (site.compartments) pour un type
 * ajouté ; ceux d'un type qui n'est plus contrôlé sont retirés (tourCompartments).
 */
function perimeterCompartments(grid, a, beforeTypes, sites) {
  const types = tourTypes(grid, a.stations, a.auditType);
  if (types.length === 1 && beforeTypes.length === 1 && types[0] === beforeTypes[0]) return a.compartments;
  const wanted = Object.fromEntries(types.map(t => [t, beforeTypes.includes(t) ? a.compartments
    : [...new Set(a.stations.filter(st => stationParts(grid, st, a.auditType).includes(t)).flatMap(st => sites[st.siteId]?.compartments || []))]]));
  return tourCompartments(grid, types, wanted);
}
/**
 * Applique EN PLACE un nouveau jeu de stations (parties comprises) à une tournée : périmètre normalisé
 * (normalizePerimeter : type principal, `parts` / `partPrestations` seulement pour une tournée mixte), compartiments,
 * prestations rattachées ; type de prélèvement et matrice suivent un changement de type principal. Grille sans types :
 * stations seules.
 */
function applyStations(a, stations) {
  const g = a.gridSnapshot;
  if (!gridTypes(g).length) { a.stations = stations; a.prestationIds = [...new Set(stations.flatMap(stationPrestationIds))]; return; }
  const before = auditTypeOf(a);
  const beforeTypes = tourTypes(g, a.stations || [], before);
  const per = normalizePerimeter(g, before, stations);
  a.stations = per.stations;
  if (per.auditType !== before) {
    a.auditType = per.auditType;
    const t = gridType(g, per.auditType);
    const p = a.stations.map(st => st.prestationId && store.get('prestation', st.prestationId)).find(Boolean);
    a.samplingTypeId = p?.samplingTypeId || t?.samplingTypeId || a.samplingTypeId || null;
    a.matrixId = p?.matrixId || t?.matrixId || a.matrixId || null;
  }
  a.compartments = perimeterCompartments(g, a, beforeTypes, sitesById(a.stations));
  a.prestationIds = [...new Set(a.stations.flatMap(stationPrestationIds))];
  if (a.stations.length) a.prestationId = a.stations[0].prestationId || null;
}
/** Instances de feuilles et critères visibles d'une tournée (version en cours de modification comprise). */
function visibleParts(a) {
  if (!isSheetGrid(a?.gridSnapshot) || !(a.stations || []).length) return { items: new Set(), sheets: new Set() };
  const grid = expandGrid(a.gridSnapshot, a.stations, sitesById(a.stations), { provider: store.get('provider', a.providerId) });
  const ctx = auditContext(a);
  return { items: new Set(visibleItems(grid, a.responses || {}, ctx).map(x => x.item.id)), sheets: new Set(sheetsOf(grid, a.responses || {}, ctx).map(s => s.instanceKey)) };
}
/** Tournée avec les parties `parts` à la station `key` (copie ; prestations des parties ajoutées : `partPrestations`). */
function withStationParts(cur, key, parts, partPrestations = null) {
  const next = clone(cur);
  const g = next.gridSnapshot, type = auditTypeOf(next);
  const stations = next.stations.map(s => {
    if (s.key !== key) return s;
    const own = stationParts(g, s, type);
    const pp = { ...(s.partPrestations || (s.prestationId && own.length === 1 ? { [own[0]]: s.prestationId } : {})), ...(partPrestations || {}) };
    return { ...s, parts, partPrestations: partPrestationsOf(g, parts, { partPrestations: pp, siteId: s.siteId }) };
  });
  applyStations(next, stations);
  return next;
}
/**
 * Conséquences d'un changement du périmètre contrôlé à une station (avant de l'appliquer) : {before, after (parties),
 * hidden: {responses, sheets, media, deviations, openDeviations: [{id, number}]}} — saisies de l'agent (hors
 * pré-remplissages), encadrés, preuves et écarts des points qui ne seraient plus affichés.
 */
export function perimeterChangePlan(audit, key, parts, { partPrestations = null } = {}) {
  const cur = store.get('audit', audit.id) || audit;
  const g = cur.gridSnapshot;
  const st = (cur.stations || []).find(s => s.key === key);
  const want = normalizeParts(g, parts);
  if (!st || !want) return null;
  const next = withStationParts(cur, key, want, partPrestations);
  const a = visibleParts(cur), b = visibleParts(next);
  const items = [...a.items].filter(id => !b.items.has(id));
  const sheets = [...a.sheets].filter(k => !b.sheets.has(k));
  const filled = v => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()) && !(typeof v === 'object' && !Object.values(v).some(filled));
  const media = auditMedia(cur.id).filter(m => (m.link?.type === 'item' && items.includes(m.link.itemId)) || (m.link?.type === 'sheet' && sheets.includes(String(m.link.itemId)))).length;
  const devs = auditDeviations(cur.id).filter(d => d.status !== 'annule' && d.itemId && items.includes(d.itemId));
  return {
    before: stationParts(g, st, auditTypeOf(cur)), after: want, next,
    hidden: {
      responses: items.filter(id => isEnteredResponse(cur.responses?.[id])), sheets: sheets.filter(k => filled(cur.sheets?.[k])), media, deviations: devs.length,
      openDeviations: devs.filter(d => OPEN_DEVIATION.includes(d.status)).map(d => ({ id: d.id, number: d.number }))
    }
  };
}
/**
 * Modifie le périmètre contrôlé à une station de la tournée (« Biologie », « Chimie »…), avant la signature du
 * contrôleur. Points d'une partie ajoutée pré-remplis (données de la station, informations communes reprises) ; points
 * d'une partie retirée seulement MASQUÉS (saisies conservées, de nouveau affichées si la partie est recochée) : motif
 * OBLIGATOIRE s'ils contiennent des saisies (erreur `needsReason`, e.entries) ; écarts OUVERTS sur ces points : refus
 * (erreur `needsCancel`, e.openDeviations) sauf `cancelDeviations: true` (annulés avec le même motif). Historique
 * (audit.stationLog « perimetre » : avant, après, motif), journal, historique des prestations rattachées ou retirées.
 */
export async function setStationParts(audit, key, parts, { reason = null, cancelDeviations = false, partPrestations = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Tournée signée et verrouillée : le périmètre contrôlé ne peut plus changer.');
  if (cur.status === 'abandonne') throw new Error('Tournée annulée : le périmètre contrôlé ne peut plus changer.');
  if (cur.signatures?.auditor) throw new Error('Tournée déjà signée par un contrôleur : rouvrez-la avant de modifier le périmètre contrôlé.');
  if (!canEditAudit(cur)) throw new Error('Seul un contrôleur de la tournée peut modifier le périmètre contrôlé.');
  const g = cur.gridSnapshot;
  if (!isSheetGrid(g) || !gridTypes(g).length) throw new Error('Cette grille ne distingue pas les parties contrôlées.');
  const st = (cur.stations || []).find(s => s.key === key);
  if (!st) throw new Error('Station absente de la tournée.');
  const want = normalizeParts(g, parts);
  if (!want) throw new Error('Cochez au moins une partie contrôlée à cette station (biologie, chimie…).');
  const plan = perimeterChangePlan(cur, key, want, { partPrestations });
  const site = store.get('site', st.siteId);
  const name = site?.name || key;
  const same = plan.before.join() === want.join();
  const beforePres = new Set(stationPrestationIds(st));
  const afterPres = stationPrestationIds(plan.next.stations.find(s => s.key === key));
  if (same && afterPres.join() === [...beforePres].join()) return cur;
  const h = plan.hidden;
  const hasData = h.responses.length + h.sheets.length + h.media + h.deviations > 0;
  if (hasData && !String(reason || '').trim()) {
    const e = new Error(`Des constats déjà saisis à ${name} ne seraient plus affichés : un motif est obligatoire pour modifier le périmètre contrôlé.`);
    e.needsReason = true; e.entries = { responses: h.responses, sheets: h.sheets, media: h.media, deviations: h.deviations, openDeviations: h.openDeviations.length };
    e.openDeviations = h.openDeviations;
    throw e;
  }
  if (h.openDeviations.length && !cancelDeviations) {
    const e = new Error(`${h.openDeviations.length} écart(s) ouvert(s) (${h.openDeviations.map(d => d.number).join(', ')}) portent sur des points qui ne seraient plus affichés : annulez-les (avec le motif) pour modifier le périmètre.`);
    e.needsCancel = true; e.openDeviations = h.openDeviations;
    throw e;
  }
  if (h.openDeviations.length && !(can('deviation.manage') || can('deviation.close'))) throw new Error('Votre profil ne permet pas d’annuler ces écarts ouverts.');
  for (const dv of h.openDeviations) {
    const d = store.get('deviation', dv.id);
    if (d) await updateDeviation(d, { status: 'annule', closedAt: nowISO(), closedBy: session.user.name, closureNote: `Périmètre contrôlé à ${name} modifié — ${reason}` }, { reason, event: 'Annulation : partie retirée du périmètre de la station' });
  }
  const now = nowISO(), d = new Date(now);
  const label = `${partsText(g, plan.before)} → ${partsText(g, want)}`;
  const saved = await updateAudit(store.get('audit', cur.id), a => {
    const next = withStationParts(a, key, want, partPrestations);
    for (const k of ['stations', 'auditType', 'samplingTypeId', 'matrixId', 'compartments', 'prestationIds', 'prestationId']) if (next[k] !== undefined) a[k] = next[k];
    a.stationLog = [...(a.stationLog || []), { ...sessionStamp(now), action: 'perimetre', key, siteId: st.siteId, before: plan.before, after: want, reason: reason || null }];
    // Points d'une partie ajoutée : pré-remplis (données de la station) puis informations communes reprises.
    const provider = store.get('provider', a.providerId);
    const s = a.stations.find(x => x.key === key);
    const pre = prefillResponses(expandGrid(a.gridSnapshot, a.stations, sitesById(a.stations), { provider }), {
      onlyStation: key, site, prestation: s?.prestationId ? store.get('prestation', s.prestationId) : null, auditor: { name: controllersLabel(a) }, provider,
      operators: (a.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean), date: auditDate(a) || localDate(d), time: '', kind: a.kind,
      compartments: a.compartments, auditType: auditTypeOf(a), ...sessionStamp(now)
    });
    a.responses = a.responses || {};
    for (const [k, v] of Object.entries(pre)) if (!a.responses[k]) a.responses[k] = v;
    applyLinks(a, [...TOUR_SOURCES, siteSource(key)], now);
  }, { action: 'perimeter', reason: reason ? `Périmètre contrôlé à ${name} : ${label} — ${reason}` : `Périmètre contrôlé à ${name} : ${label}` });
  for (const id of afterPres.filter(x => !beforePres.has(x))) { const p = store.get('prestation', id); if (p) await addPrestationHistory(p, { event: 'audit-demarre', auditId: cur.id, label: `Audit ${cur.number} : partie ajoutée au périmètre contrôlé à ${name}` }); }
  for (const id of [...beforePres].filter(x => !afterPres.includes(x))) { const p = store.get('prestation', id); if (p) await addPrestationHistory(p, { event: 'audit-station-retiree', auditId: cur.id, label: `Audit ${cur.number} : partie retirée du périmètre contrôlé à ${name}`, reason: reason || null }); }
  return saved;
}

/**
 * Crée un audit (une tournée). Tout ce qui sert de référence est FIGÉ dans l'audit : copie de la grille, instantané
 * des documents applicables (version + empreinte), identification de l'appareil et de l'application.
 * p : {auditType?, stations?: [{siteId, prestationId?, pointId?}] (ordre de passage), providerId?, compartments?,
 *      operatorIds?, campaignId?, kind ('planifie' | 'inopine'), gridId? (défaut : grille de la prestation, sinon
 *      CT-2026 si un type de tournée est donné), samplingTypeId?, matrixId?, date? (date de la tournée AAAA-MM-JJ,
 *      aujourd'hui par défaut : audit.date, lue partout par auditDate())}
 * Compatibilité : `prestationId` / `siteId` / `pointId` seuls = une station.
 * Grille à types : type de tournée = `auditType`, sinon déduit de la 1re prestation / station ; compartiments =
 * choix limité aux compartiments du type (biologie : défaut = ceux des stations ou de la prestation ; cours d'eau :
 * organisation + physico ; eaux souterraines : organisation + eso). Les critères `prefill` reçoivent une valeur
 * initiale (sans statut, prefilled: true), ceux des feuilles station avec les données de LEUR station ; dates
 * pré-remplies = date de la tournée ; heure d'arrivée pré-remplie seulement pour une tournée du jour.
 * controllerIds : contrôleurs OEG de la tournée (binôme), agent connecté toujours inclus (défaut : lui seul) ;
 * « Agent(s) OEG » et « Contrôleur OEG » pré-remplis avec leurs noms (« A. Dupont, B. Martin »).
 * Périmètre réel : stations[].parts (parties contrôlées à la station, ex. ['bio', 'ce'] ; défaut : le type de la
 * tournée) et stations[].partPrestations ({type: prestationId}) ; plusieurs types ⇒ tournée MIXTE (normalizePerimeter :
 * type principal = `auditType` s'il est contrôlé quelque part ; compartiments retenus type par type — tourCompartments).
 */
export async function createAudit({ prestationId = null, gridId = null, kind = 'planifie', providerId = null, siteId = null, pointId = null, operatorIds = [], samplingTypeId = null, matrixId = null, compartments = null, auditType = null, stations = null, campaignId = null, date = null, controllerIds = null } = {}) {
  if (!can('audit.create')) throw new Error('Votre profil ne permet pas de créer un audit.');
  const controllers = resolveControllers(controllerIds);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`Date de tournée invalide : ${date}`);
  // Stations demandées (compatibilité : prestationId / siteId seuls = une station).
  const req = (Array.isArray(stations) && stations.length ? stations : [{ siteId, prestationId, pointId }]).map(s => {
    const p = s?.prestationId ? store.get('prestation', s.prestationId) : null;
    if (s?.prestationId && !p) throw new Error('Prestation introuvable.');
    return { siteId: s?.siteId || p?.siteId || null, prestationId: p?.id || null, pointId: s?.pointId || p?.pointIds?.[0] || null, prestation: p, parts: s?.parts || null, partPrestations: s?.partPrestations || null };
  });
  const prestation0 = req[0].prestation;
  // Grille par défaut lue d'après la version livrée avec l'application (turbidité en NTU…) même si la grille enregistrée
  // n'est pas encore mise à niveau sur la tablette (aucune session administrateur depuis la mise à jour) : l'instantané
  // d'une NOUVELLE tournée est toujours à jour ; celui des tournées existantes n'est jamais modifié.
  const grid = upToDateGrid(store.get('grid', gridId || prestation0?.gridId || (auditType ? CT_GRID_ID : null)));
  if (!grid) throw new Error('Grille d’audit introuvable.');
  if (auditType && gridTypes(grid).length && !gridType(grid, auditType)) throw new Error(`Type de tournée inconnu : ${auditType}`);
  const site0 = req[0].siteId ? store.get('site', req[0].siteId) : null;
  const type0 = gridTypes(grid).length ? (auditType || inferAuditType(grid, { site: site0, prestation: prestation0 })) : '';
  const now = nowISO(), today = localDate(new Date(now));
  const tourDate = date || today;
  // Stations de la tournée (ordre de passage, sans doublon) et parties contrôlées à chacune.
  let list = [];
  for (const s of req) {
    if (!s.siteId) { if (isSheetGrid(grid)) throw new Error('Station non précisée.'); continue; }
    if (!store.get('site', s.siteId)) throw new Error(`Station introuvable : ${s.siteId}`);
    const st = makeStation({ siteId: s.siteId, pointId: s.pointId || defaultPointId(s.siteId), prestationId: s.prestationId }, now);
    if (list.some(x => x.key === st.key)) throw new Error(`Station en double dans la tournée : ${st.key}`);
    const parts = gridTypes(grid).length ? normalizeParts(grid, s.parts) : null;
    if (Array.isArray(s.parts) && s.parts.length && !parts) throw new Error(`Partie contrôlée inconnue : ${s.parts.join(', ')}`);
    if (parts) Object.assign(st, { parts, partPrestations: partPrestationsOf(grid, parts, { prestationId: s.prestationId, partPrestations: s.partPrestations, siteId: s.siteId }) });
    list.push(st);
  }
  if (isSheetGrid(grid) && !list.length) throw new Error('Une tournée compte au moins une station.');
  // Périmètre normalisé : tournée d'un seul type (sans `parts`, comme avant) ou mixte ; type principal.
  const per = gridTypes(grid).length ? normalizePerimeter(grid, type0, list) : { auditType: type0, types: [type0].filter(Boolean), mixed: false, stations: list };
  list = per.stations;
  const type = per.auditType;
  const typeDef = gridType(grid, type);
  // Prestations de la tournée : celles des stations (toutes leurs parties), sinon celle demandée (grille historique).
  const presIds = [...new Set([...list.flatMap(stationPrestationIds), ...(list.length ? [] : req.map(r => r.prestationId))].filter(Boolean))];
  const prestations = presIds.map(id => store.get('prestation', id)).filter(Boolean);
  // Prestation de référence (documents, type de prélèvement, matrice, campagne) : celle de la 1re station (partie
  // principale) ; tournée d'un seul type : la prestation demandée pour la 1re station, comme avant.
  const prestation = list.length ? (list[0].prestationId ? store.get('prestation', list[0].prestationId) || null : (per.mixed || list[0].parts ? null : prestation0)) : prestation0;
  const { number, source } = await nextNumber('AUD', new Date().getFullYear());
  const docs = applicableDocuments(prestation || { providerId, samplingTypeId: samplingTypeId || typeDef?.samplingTypeId, siteId: list[0]?.siteId }, today);
  const documentsSnapshot = await Promise.all(docs.map(snapshotDocument));
  const gridSnapshot = clone(grid);
  const audit = {
    id: uuid(), number, numberSource: source, kind,
    auditType: type || null,
    stations: list,
    prestationIds: [...new Set(list.flatMap(stationPrestationIds))],
    prestationId: list[0]?.prestationId || prestation?.id || null,
    providerId: providerId || prestation?.providerId || null,
    siteId: list[0]?.siteId || req[0].siteId || null,
    pointId: list[0]?.pointId || req[0].pointId || null,
    operatorIds: operatorIds.length ? operatorIds : [...new Set(prestations.flatMap(p => p.operatorIds || []))],
    operatorNames: {},
    samplingTypeId: samplingTypeId || prestation?.samplingTypeId || typeDef?.samplingTypeId || null,
    matrixId: matrixId || prestation?.matrixId || site0?.matrixId || typeDef?.matrixId || null,
    campaignId: campaignId || prestation?.campaignId || null,
    auditorId: session.user.id, auditorName: session.user.name, auditorRole: session.user.role,
    controllerIds: controllers.map(c => c.id), controllerNames: Object.fromEntries(controllers.map(c => [c.id, c.name])), controllerLog: [],
    device: { id: session.device.id, name: session.device.name, userAgent: navigator.userAgent },
    appVersion: appVersion(),
    gridId: grid.id, gridCode: grid.code, gridVersion: grid.version, gridSnapshot,
    gridSha256: await sha256Hex(canonicalJSON(gridSnapshot)),
    documentsSnapshot,
    protocolVersion: documentsSnapshot.find(d => d.type === 'PROTOCOLE')?.version || null,
    cctpVersion: documentsSnapshot.find(d => d.type === 'CCTP')?.version || null,
    date: tourDate, startedAt: now, endedAt: null, status: 'en_cours',
    compartments: [], sheets: {},
    responses: {}, gps: [], samples: [], equipmentChecks: [], dismissedAlerts: [],
    signatures: {}, lock: null, amendments: [], reports: [], conclusions: { strengths: '', vigilance: '', comment: '', preconisations: '' },
    stationLog: [], removedStations: []
  };
  // Préleveurs du prestataire : libellés figés dans la tournée (« Prénom Nom (INI) — fonction »).
  audit.operatorNames = Object.fromEntries(audit.operatorIds.map(id => [id, operatorLabel(store.get('operator', id))]).filter(([, l]) => l));
  const sites = sitesById(list);
  if (grid.compartments?.length) {
    if (typeDef && per.mixed) {
      // Tournée mixte : compartiments retenus type par type (choix de l'écran, sinon ceux des stations qui contrôlent ce
      // type, sinon ceux de leurs prestations) ; un type à compartiment unique (cours d'eau : physico) a toujours le sien.
      const wanted = Array.isArray(compartments) && compartments.length ? compartments : Object.fromEntries(per.types.map(t => {
        const sts = list.filter(st => stationParts(grid, st, type).includes(t));
        const fromSites = [...new Set(sts.flatMap(st => sites[st.siteId]?.compartments || []))];
        const fromPres = [...new Set(sts.flatMap(st => stationPrestationIds(st).map(id => store.get('prestation', id)?.compartments || []).flat()))];
        return [t, fromSites.length ? fromSites : fromPres.length ? fromPres : null];
      }));
      audit.compartments = tourCompartments(grid, per.types, wanted);
    } else if (typeDef) {
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
  // Tournée saisie après coup (date passée) : pas d'heure d'arrivée pré-remplie avec l'heure actuelle.
  const time = tourDate === today ? localTime(new Date(now)) : '';
  audit.responses = prefillResponses(eff, {
    site: site0, auditor: { name: controllers.map(c => c.name).filter(Boolean).join(', ') }, provider, prestation,
    operators: audit.operatorIds.map(id => store.get('operator', id)).filter(Boolean),
    date: tourDate, time, kind, stationCount: list.length, compartments: audit.compartments, auditType: type,
    // Heure d'arrivée pré-remplie pour la 1re station seulement (les suivantes : à l'arrivée sur place).
    stations: list.map((st, i) => ({ key: st.key, site: sites[st.siteId], prestation: (st.prestationId && store.get('prestation', st.prestationId)) || (per.mixed ? null : req.find(r => r.siteId === st.siteId)?.prestation) || null, time: i === 0 ? time : '' })),
    ...sessionStamp(now)
  });
  // Informations communes reprises dans les autres feuilles (date, contrôleurs, préleveurs, fiche de chaque station…) :
  // « Repris de F… ».
  applyLinks(audit, [...TOUR_SOURCES, ...list.map(st => siteSource(st.key))], now);
  await store.put('audit', audit, { action: 'create', reason: kind === 'inopine' ? 'Audit inopiné' : null });
  for (const p of prestations) await addPrestationHistory(p, { event: 'audit-demarre', auditId: audit.id, label: `Audit ${number} démarré${list.length > 1 ? ` (tournée de ${list.length} stations)` : ''}` });
  return store.get('audit', audit.id);
}

/**
 * Ajoute une station à la tournée (fin de l'ordre de passage) : pré-remplit ses critères (date de la tournée —
 * auditDate() —, heure d'arrivée si la tournée est du jour, données de la station), met à jour le « Programme journalier (nombre de stations) » s'il est encore pré-rempli,
 * historise (audit.stationLog, journal, historique de la prestation). Refus : station déjà présente, audit
 * verrouillé ou tournée annulée, grille sans feuilles.
 * Périmètre réel : `parts` (parties contrôlées à la station, défaut : le type de la tournée) et `partPrestations`
 * ({type: prestationId}) ; une partie d'un autre type rend la tournée mixte (compartiments du type ajoutés).
 */
export async function addStation(audit, { siteId = null, prestationId = null, pointId = null, parts = null, partPrestations = null } = {}, { reason = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Audit signé et verrouillé : impossible d’ajouter une station.');
  if (cur.status === 'abandonne') throw new Error('Tournée annulée : impossible d’ajouter une station.');
  if (!isSheetGrid(cur.gridSnapshot)) throw new Error('Cette grille ne permet pas les tournées à plusieurs stations.');
  let prestation = prestationId ? store.get('prestation', prestationId) : null;
  if (prestationId && !prestation) throw new Error('Prestation introuvable.');
  siteId = siteId || prestation?.siteId;
  const site = siteId ? store.get('site', siteId) : null;
  if (!site) throw new Error('Station introuvable.');
  const g = cur.gridSnapshot;
  const want = gridTypes(g).length ? normalizeParts(g, parts) : null;
  if (Array.isArray(parts) && parts.length && !want) throw new Error(`Partie contrôlée inconnue : ${parts.join(', ')}`);
  const now = nowISO(), d = new Date(now);
  const tourDate = auditDate(cur) || localDate(d);
  const st = makeStation({ siteId, pointId: pointId || prestation?.pointIds?.[0] || defaultPointId(siteId), prestationId: prestation?.id || null }, now);
  if ((cur.stations || []).some(s => s.key === st.key)) throw new Error('Cette station fait déjà partie de la tournée.');
  // Tournée mixte (avant ou après l'ajout) : périmètre normalisé, compartiments et prestations recalculés ; sinon, comme avant.
  const type = auditTypeOf(cur);
  const mix = isMixedTour(cur) || (want && want.join() !== type);
  let next = null;
  if (mix) {
    if (want) Object.assign(st, { parts: want, partPrestations: partPrestationsOf(g, want, { prestationId: st.prestationId, partPrestations, siteId }) });
    next = clone(cur);
    applyStations(next, [...(cur.stations || []), st]);
    const added = next.stations[next.stations.length - 1];
    prestation = added.prestationId ? store.get('prestation', added.prestationId) || null : null;
  }
  const stations = next ? next.stations : [...(cur.stations || []), st];
  const added = stations[stations.length - 1];
  const provider = store.get('provider', cur.providerId);
  const eff = expandGrid(g, stations, sitesById(stations), { provider });
  const pre = prefillResponses(eff, {
    onlyStation: st.key, site, prestation, auditor: { name: controllersLabel(cur) }, provider,
    operators: (cur.operatorIds || []).map(id => store.get('operator', id)).filter(Boolean),
    date: tourDate, time: tourDate === localDate(d) ? localTime(d) : '', kind: cur.kind, compartments: next ? next.compartments : cur.compartments, auditType: next ? auditTypeOf(next) : type, ...sessionStamp(now)
  });
  const countIds = allItems(eff).filter(i => i.prefill === 'tournee.stationCount').map(i => i.id);
  await updateAudit(cur, a => {
    if (next) for (const k of ['stations', 'auditType', 'samplingTypeId', 'matrixId', 'compartments', 'prestationIds', 'prestationId']) { if (next[k] !== undefined) a[k] = next[k]; }
    else {
      a.stations = stations;
      a.prestationIds = [...new Set([...(a.prestationIds || []), ...(st.prestationId ? [st.prestationId] : [])])];
    }
    a.responses = a.responses || {};
    for (const [k, v] of Object.entries(pre)) if (!a.responses[k]) a.responses[k] = v;
    for (const id of countIds) { const r = a.responses[id]; if (!r || (r.prefilled && !r.status)) a.responses[id] = { ...(r || {}), value: stations.length, prefilled: true, ...sessionStamp(now) }; }
    a.stationLog = [...(a.stationLog || []), { ...sessionStamp(now), action: 'ajout', key: st.key, siteId, prestationId: added.prestationId || null, ...(added.parts ? { parts: added.parts } : {}), reason: reason || null }];
    // Nouvelle station : date, contrôleurs, météo, niveau d'eau et préleveurs déjà saisis pour la tournée repris,
    // informations de sa fiche station marquées « repris de la fiche station ».
    applyLinks(a, [...TOUR_SOURCES, siteSource(st.key)], now);
  }, { reason: reason || `Ajout de la station ${site.name} (${site.code}) à la tournée${added.parts ? ` (contrôlé : ${partsText(g, added.parts)})` : ''}` });
  for (const id of stationPrestationIds(added)) {
    const p = store.get('prestation', id);
    if (p) await addPrestationHistory(p, { event: 'audit-demarre', auditId: cur.id, label: `Audit ${cur.number} : station ajoutée à la tournée` });
  }
  return store.get('audit', cur.id);
}

/**
 * Retire une station de la tournée. Sans saisie de l'auditeur pour cette station (hors pré-remplissage, encadrés,
 * médias, écarts) : retrait simple. Sinon `reason` est OBLIGATOIRE (erreur `needsReason`) et les saisies retirées sont
 * conservées dans audit.removedStations (traçabilité). Écarts OUVERTS de la station : retrait refusé (erreur
 * `needsCancel`, e.openDeviations) sauf `cancelDeviations: true` — ils sont alors annulés avec le même motif (statut
 * « annulé », historique de l'écart). Refus : audit verrouillé, dernière station de la tournée.
 */
export async function removeStation(audit, key, { reason = null, cancelDeviations = false } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Audit signé et verrouillé : impossible de retirer une station.');
  const st = (cur.stations || []).find(s => s.key === key);
  if (!st) throw new Error('Station absente de la tournée.');
  if ((cur.stations || []).length <= 1) throw new Error('Une tournée compte au moins une station.');
  const entries = stationEntries(cur, key);
  const media = auditMedia(cur.id).filter(m => parseItemId(m.link?.itemId).stationKey === key || m.link?.stationKey === key).length;
  const stationDevs = auditDeviations(cur.id).filter(dv => dv.status !== 'annule' && dv.stationKey === key);
  const openDevs = stationDevs.filter(dv => OPEN_DEVIATION.includes(dv.status));
  const devs = stationDevs.length;
  const hasData = entries.responses.length + entries.sheets.length + media + devs > 0;
  const openList = openDevs.map(dv => ({ id: dv.id, number: dv.number }));
  if (hasData && !String(reason || '').trim()) {
    const e = new Error('Des constats ont déjà été saisis pour cette station : un motif est obligatoire pour la retirer de la tournée.');
    e.needsReason = true; e.entries = { ...entries, media, deviations: devs, openDeviations: openList.length };
    e.openDeviations = openList;
    throw e;
  }
  // Un écart ouvert ne reste pas rattaché à une station qui ne fait plus partie de la tournée.
  if (openDevs.length && !cancelDeviations) {
    const e = new Error(`La station a ${openDevs.length} écart(s) ouvert(s) (${openDevs.map(dv => dv.number).join(', ')}) : annulez-les (avec le motif du retrait) pour la retirer de la tournée.`);
    e.needsCancel = true; e.openDeviations = openList;
    throw e;
  }
  if (openDevs.length && !(can('deviation.manage') || can('deviation.close'))) throw new Error('Votre profil ne permet pas d’annuler les écarts ouverts de cette station.');
  const now = nowISO();
  const site = store.get('site', st.siteId);
  const suffix = '@' + key;
  const countIds = new Set(allItems(cur.gridSnapshot).filter(i => i.prefill === 'tournee.stationCount').map(i => i.id));
  // Écarts ouverts annulés AVANT le retrait (contrôles faits) : jamais de station retirée avec un écart encore ouvert.
  for (const dv of openDevs) {
    await updateDeviation(dv, { status: 'annule', closedAt: nowISO(), closedBy: session.user.name, closureNote: `Station ${site?.name || key} retirée de la tournée — ${reason}` },
      { reason, event: 'Annulation : station retirée de la tournée' });
  }
  await updateAudit(store.get('audit', cur.id), a => {
    const removed = { station: st, ...sessionStamp(now), reason: reason || null, responses: {}, sheets: {} };
    for (const id of Object.keys(a.responses || {})) if (id.endsWith(suffix)) { removed.responses[id] = a.responses[id]; delete a.responses[id]; }
    for (const k of Object.keys(a.sheets || {})) if (String(k).endsWith(suffix)) { removed.sheets[k] = a.sheets[k]; delete a.sheets[k]; }
    const mixed = isMixedTour(a);
    const rest = a.stations.filter(s => s.key !== key);
    // Tournée mixte : périmètre normalisé (la tournée redevient d'un seul type si la station retirée était la seule à
    // contrôler une partie : type principal, compartiments et prestations suivent).
    if (mixed) applyStations(a, rest); else a.stations = rest;
    if (hasData) a.removedStations = [...(a.removedStations || []), removed];
    a.stationLog = [...(a.stationLog || []), { ...sessionStamp(now), action: 'retrait', key, siteId: st.siteId, prestationId: st.prestationId, reason: reason || null }];
    const first = a.stations[0];
    a.siteId = first.siteId; a.pointId = first.pointId; a.prestationId = first.prestationId || null;
    a.prestationIds = [...new Set(a.stations.flatMap(stationPrestationIds))];
    for (const id of countIds) { const r = a.responses?.[id]; if (r?.prefilled && !r.status) a.responses[id] = { ...r, value: a.stations.length }; }
  }, { reason: reason || `Retrait de la station ${site?.name || key} de la tournée (aucune saisie)` });
  for (const id of stationPrestationIds(st)) {
    const p = store.get('prestation', id);
    if (p) await addPrestationHistory(p, { event: 'audit-station-retiree', auditId: cur.id, label: `Audit ${cur.number} : station retirée de la tournée${openDevs.length ? ` (${openDevs.length} écart(s) annulé(s))` : ''}`, reason: reason || null });
  }
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

/**
 * Enregistre la réponse d'un critère (saisie de l'agent connecté). Une valeur modifiée par l'agent n'est plus
 * « pré-remplie » ni « reprise » et ne sera plus remplacée par une reprise (valueManual) ; une reprise de la station
 * précédente modifiée n'est plus marquée. La valeur saisie est reprise dans les champs liés des autres feuilles
 * (applyLinks, même écriture) ; « Type d'audit » (F2.1.11) tient à jour audit.kind (inopiné / avec rendez-vous).
 */
export async function setResponse(audit, itemId, patch, { reason = null } = {}) {
  return updateAudit(audit, a => {
    const prev = a.responses[itemId] || {};
    const at = nowISO();
    const r = { ...prev, ...patch, at, by: session.user.id, byName: session.user.name };
    const valueChanged = 'value' in patch && canonicalJSON(patch.value ?? null) !== canonicalJSON(prev.value ?? null);
    // Une valeur pré-remplie (ou reprise d'une autre feuille) modifiée par l'auditeur n'est plus « pré-remplie ».
    if (valueChanged && !('prefilled' in patch)) { delete r.prefilled; delete r.from; delete r.fromId; r.valueManual = true; }
    if (prev.copiedFrom && ('status' in patch || 'comment' in patch || valueChanged)) delete r.copiedFrom;
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    a.responses[itemId] = r;
    if (valueChanged) {
      if (itemId === 'it-F2-1.11' && isSheetGrid(a.gridSnapshot)) { const k = { 'Inopiné': 'inopine', 'Avec rendez-vous': 'planifie' }[r.value]; if (k) a.kind = k; }
      applyLinks(a, [itemId], at);
    }
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
      // Encadré lié (ex. « Agent(s) prestataire(s) / fonction » de F4, repris de F1.R4) : saisie de l'agent, plus de reprise.
      if (LINKED_SHEET_KEYS.includes(k)) { delete next[k + 'From']; next[k + 'Manual'] = true; }
    }
    a.sheets[no] = next;
  }, { reason });
}

/**
 * Reprise possible des réponses de la station précédente pour une feuille station (`instanceKey` « 4@<clé> ») :
 * { prev: {key, index, name}, copies: [{id, fromId, status, comment?, value?}] } ou null (première station, feuille de
 * tournée, tournée verrouillée ou annulée).
 */
export function previousStationPlan(audit, instanceKey) {
  const cur = audit?.id ? store.get('audit', audit.id) || audit : audit;
  if (!cur || cur.lock?.lockedAt || cur.status === 'abandonne' || !isSheetGrid(cur.gridSnapshot)) return null;
  const [no, key] = String(instanceKey || '').split('@');
  const i = (cur.stations || []).findIndex(st => st.key === key);
  if (!key || i <= 0) return null;
  const prev = cur.stations[i - 1];
  const site = store.get('site', prev.siteId);
  const copies = copyFromPreviousStation({ items: linkItems(cur), responses: cur.responses || {}, sheetNo: no, stationKey: key, prevKey: prev.key });
  return { prev: { key: prev.key, index: i - 1, name: site?.name || prev.key }, copies };
}
/**
 * « Reprendre les réponses de la station précédente » (feuille station d'une tournée à plusieurs stations, à la
 * demande de l'agent, après confirmation) : les points VIDES de la feuille reçoivent le statut, l'observation (et un
 * choix de liste) du même point de la station précédente ; chaque reprise est marquée copiedFrom {stationKey, fromId}
 * et attribuée à l'agent connecté. Retourne { count, prev }.
 */
export async function copyPreviousStation(audit, instanceKey, { reason = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (cur.lock?.lockedAt) throw new Error('Tournée signée et verrouillée : les réponses ne peuvent plus être reprises.');
  if (cur.status === 'abandonne') throw new Error('Tournée annulée.');
  const plan = previousStationPlan(cur, instanceKey);
  if (!plan) throw new Error('Aucune station précédente pour cette feuille.');
  if (!plan.copies.length) return { count: 0, prev: plan.prev };
  const now = nowISO();
  const stamp = sessionStamp(now);
  await updateAudit(cur, a => {
    for (const c of plan.copies) {
      const r = a.responses[c.id] || {};
      const n = { ...r, status: c.status, ...stamp, copiedFrom: { stationKey: plan.prev.key, fromId: c.fromId, ...stamp } };
      if (c.comment) n.comment = c.comment;
      if (c.value !== undefined) { n.value = c.value; delete n.prefilled; }
      a.responses[c.id] = n;
    }
  }, { reason: reason || `Réponses de la station ${plan.prev.index + 1} (${plan.prev.name}) reprises pour la feuille ${String(instanceKey).split('@')[0]} : ${plan.copies.length} point(s)` });
  return { count: plan.copies.length, prev: plan.prev };
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
 * prestation ; écart de TOURNÉE (critère commun à la tournée, alerte ou écart sans critère) : stationKey null,
 * rattaché à toute la tournée — siteIds / prestationIds = ceux de toutes les stations ; siteId, pointId et
 * prestationId = ceux de la station seulement si la tournée n'en compte qu'une (sinon null).
 */
export async function createDeviation(audit, data) {
  if (!can('deviation.manage')) throw new Error('Votre profil ne permet pas d’enregistrer un écart.');
  const now = new Date();
  const cur = store.get('audit', audit.id) || audit;
  const stationKey = data.stationKey !== undefined ? data.stationKey : parseItemId(data.itemId).stationKey;
  const station = stationKey ? (cur.stations || []).find(s => s.key === stationKey) : null;
  const responseStatus = data.itemId ? cur.responses?.[data.itemId]?.status || null : null;
  const criticalityCode = data.criticalityCode || (responseStatus ? defaultCriticality(responseStatus) : 'MIN');
  const stations = cur.stations || [];
  // Écart de tournée : toutes les stations (un seul site seulement pour une tournée d'une station ou une grille historique).
  const one = station || (stations.length === 1 ? stations[0] : null);
  const tour = !station ? {
    siteIds: stations.length ? [...new Set(stations.map(s => s.siteId))] : [cur.siteId].filter(Boolean),
    prestationIds: stations.length ? [...new Set(stations.map(s => s.prestationId).filter(Boolean))] : [cur.prestationId].filter(Boolean)
  } : {};
  const dev = {
    id: uuid(), number: nextDeviationNumber(cur), auditId: cur.id, auditNumber: cur.number,
    providerId: cur.providerId,
    siteId: one ? one.siteId : stations.length ? null : cur.siteId, pointId: one ? one.pointId || null : stations.length ? null : cur.pointId,
    prestationId: one ? one.prestationId || null : stations.length ? null : cur.prestationId, ...tour,
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
 * (stations, ordre de passage, parties contrôlées à chaque station d'une tournée mixte), les compartiments retenus (compartments), les contrôleurs OEG de la tournée
 * (controllerIds, controllerNames) et les données des feuilles (sheets : observations, conclusions, instruments…) —,
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
  const { signatures, lock, amendments, reports, status, endedAt, updatedAt, updatedBy, updatedByName, _rev, _lv, _vv, _conflict, dismissedAlerts, ...content } = audit;
  // Type de tournée, stations, compartiments, contrôleurs et données des feuilles font partie du contenu scellé.
  for (const k of ['auditType', 'stations', 'compartments', 'controllerIds', 'controllerNames', 'sheets']) if (audit[k] !== undefined) content[k] = audit[k];
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

/**
 * Enregistre une signature (role : 'auditor' | 'provider'). Signature « contrôleur » (auditor) : par n'importe quel
 * contrôleur OEG de la tournée (ou l'encadrement) ; elle couvre la liste des contrôleurs.
 */
export async function signAudit(audit, role, { bytes, mime, name, fn = '', refused = false, comment = '' }) {
  if (role === 'auditor' && !canEditAudit(store.get('audit', audit.id) || audit)) throw new Error('Seul un contrôleur de la tournée peut la signer.');
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
  // Toutes les prestations rattachées à chaque station (une par partie contrôlée d'une station mixte).
  const targets = (a.stations || []).length ? a.stations.flatMap(s => stationPrestationIds(s).map(id => ({ id, key: s.key }))) : a.prestationId ? [{ id: a.prestationId, key: null }] : [];
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

/**
 * « Annuler la tournée » : statut 'abandonne' (valeur conservée : données existantes, échanges, filtres), motif
 * OBLIGATOIRE (audit.abandonReason), auteur et date (cancelledAt, cancelledBy, cancelledByName). Permise à tout
 * contrôleur de la tournée et aux profils autorisés (audit.delete) — règle pure cancelTourRefusal ; refus expliqué
 * pour une tournée signée et verrouillée ou déjà annulée. Écarts OUVERTS de la tournée : refus (erreur `needsCancel`,
 * e.openDeviations) sauf `cancelDeviations: true` — ils sont alors annulés avec le même motif (jamais d'écart ouvert
 * rattaché à une tournée annulée). Les saisies sont conservées ; historique de chaque prestation (« Audit … annulé —
 * motif ») : la prestation redevient à contrôler au planning. L'objet reçu est relu dans le magasin.
 */
export async function cancelTour(audit, reason, { cancelDeviations = false } = {}) {
  const cur = store.get('audit', audit?.id);
  const refusal = cancelTourRefusal(cur, session.user, { reason: reason ?? '' });
  if (refusal) throw new Error(refusal);
  const motif = String(reason).trim();
  const open = auditDeviations(cur.id).filter(d => OPEN_DEVIATION.includes(d.status));
  if (open.length && !cancelDeviations) {
    const e = new Error(`La tournée ${cur.number} a ${open.length} écart(s) ouvert(s) (${open.map(d => d.number).join(', ')}) : ils doivent être annulés avec elle.`);
    e.needsCancel = true; e.openDeviations = open.map(d => ({ id: d.id, number: d.number }));
    throw e;
  }
  if (open.length && !(can('deviation.manage') || can('deviation.close'))) throw new Error('Votre profil ne permet pas d’annuler les écarts ouverts de cette tournée.');
  for (const d of open) {
    await updateDeviation(d, { status: 'annule', closedAt: nowISO(), closedBy: session.user.name, closureNote: `Tournée ${cur.number} annulée — ${motif}` }, { reason: motif, event: 'Annulation : tournée annulée' });
  }
  const now = nowISO();
  const saved = await updateAudit(store.get('audit', cur.id), a => {
    a.status = 'abandonne'; a.abandonReason = motif; a.endedAt = a.endedAt || now;
    a.cancelledAt = now; a.cancelledBy = session.user.id; a.cancelledByName = session.user.name;
  }, { action: 'abandon', reason: motif });
  const ids = [...new Set([...(cur.prestationIds || []), cur.prestationId].filter(Boolean))];
  for (const id of ids) {
    const p = store.get('prestation', id);
    if (p) await addPrestationHistory(p, { event: 'audit-annule', auditId: cur.id, label: `Audit ${cur.number} annulé${open.length ? ` (${open.length} écart(s) annulé(s))` : ''} — ${motif}`, reason: motif });
  }
  return saved;
}
/** Ancien nom de cancelTour (« Abandonner l'audit »). */
export const abandonAudit = (audit, reason, opts) => cancelTour(audit, reason, opts);

/** Critère (grille effective) par code (« F4.5·S2 », « F2.1.1 ») ou par identifiant. */
export function itemByCode(audit, code) { return allItems(effectiveGrid(audit)).find(i => i.code === code || i.id === code) || null; }
