/* Exports : tableaux (CSV, Excel), registre des écarts, historique, données complètes, dossiers de
 * preuve et sauvegarde chiffrée. Chaque export est tracé au journal.
 * Tournées (grille CT-2026) : colonnes « Type de tournée » et « Station(s) » ; réponses et synthèses par feuille
 * établies sur la grille EFFECTIVE de l'audit (un critère partagé par les stations n'apparaît qu'une fois).
 * Réseaux de surveillance (codes du référentiel « Réseaux », séparés par « ; », triés) : « Réseau(x) » des stations
 * d'une tournée ou d'un écart ; prestations : « Réseau » du programme (celui de la campagne, unique) et « Réseau(x)
 * de la station » (une station peut appartenir à plusieurs réseaux) ; stations : une ligne par station (« Réseau(x) »)
 * et une ligne par station ET par réseau (stationsByNetwork : rangement par réseau, « Aussi dans »). */
import { store, LOCAL_ONLY } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { mediaBytes, storeRemoteBytes } from '../core/media.js';
import { idb } from '../core/db.js';
import { encryptWithPassword, decryptWithPassword } from '../core/crypto.js';
import { fmtDate, fmtDateTime, fmtTime, nowISO, localDate, bytesToBase64, base64ToBytes, sha256Hex, sortBy } from '../core/util.js';
import { toCSV, objectsToRows } from '../formats/csv.js';
import { writeXLSX } from '../formats/xlsx.js';
import { toICS } from '../formats/ics.js';
import { PRESTATION_STATUS, DEVIATION_STATUS, AUDIT_STATUS, PROVIDER_KINDS, RESPONSES, responseText, formatValue, ACTION_STATUS, AUDIT_TYPES, CODE_TYPES, auditDate, auditKindLabel } from '../domain/model.js';
import { allItems, sheetOf, gridType } from '../domain/grids.js';
import { isOverdue, sheetSummary } from '../domain/summary.js';
import { mergeEntity } from '../domain/merge.js';
import { upToDateGrid } from '../domain/default-grids.js';
import { NO_NETWORK, prestationNetwork, sortNetworkCodes, groupSitesByNetwork, auditTypesOf } from '../domain/networks.js';
import { currentNetworkIndex } from './networks.js';
import { controllerNamesText } from '../domain/permissions.js';
import { auditState, effectiveGrid, auditContext, auditTypeOf, deviationPlace } from './audits.js';

const name = (type, id, f = x => x.name || x.label) => { const e = store.get(type, id); return e ? f(e) : ''; };
const crit = code => store.all('criticality').find(c => c.code === code)?.label || code || '';
/** Libellé du type de tournée d'un audit (grille CT-2026), '' pour une grille historique. */
const typeLabel = a => gridType(a.gridSnapshot, auditTypeOf(a))?.label || '';
/** Stations de la tournée : « ATHANASE (09271503) ; … ». */
const stationsLabel = a => (a.stations || []).map(st => { const s = store.get('site', st.siteId); return s ? `${s.name} (${s.code})` : st.key; }).join(' ; ');
/** Station d'un écart (deviationPlace) : nom de la station (« (retirée) » si elle a été retirée de la tournée) ;
 * écart commun à une tournée de plusieurs stations : « Tournée (A, B) ». */
const deviationStation = d => deviationPlace(d, { codes: false });
/** Sites d'un écart : son site, ou ceux de toutes les stations pour un écart commun à la tournée. */
const deviationSites = d => (d.siteId ? [d.siteId] : d.siteIds || []).map(id => name('site', id)).filter(Boolean).join(' ; ');
/** Réseaux (codes triés, « BIO ; Chimie ») d'un ensemble de stations. */
const networksOf = siteIds => sortNetworkCodes(siteIds.flatMap(id => store.get('site', id)?.networks || []), currentNetworkIndex()).join(' ; ');
const auditSiteIds = a => (a.stations || []).length ? a.stations.map(s => s.siteId) : [a.siteId].filter(Boolean);
/** Types de tournée d'une station (enregistrés, sinon déduits des réseaux) : « Hydrobiologie ; Cours d’eau ». */
const siteTypesText = s => ((s.types || []).length ? s.types : auditTypesOf(s, currentNetworkIndex())).map(t => AUDIT_TYPES[t] || t).join(' ; ');

/**
 * Stations rangées par réseau (une ligne par station ET par réseau ; une station sur deux réseaux a deux lignes,
 * « Aussi dans » nomme l'autre ; groupe « Sans réseau » en dernier) : [{ network, site, others }].
 */
export function stationsByNetwork(sites) {
  return groupSitesByNetwork(sites, currentNetworkIndex()).groups.flatMap(g => g.sites.map(site => ({
    network: g.network, site, others: sortNetworkCodes(site.networks || [], currentNetworkIndex()).filter(c => c !== g.code)
  })));
}

export const COLUMNS = {
  audits: [
    { label: 'Numéro', get: a => a.number }, { label: 'Type', get: a => auditKindLabel(a.kind) },
    { label: 'Type de tournée', get: typeLabel }, { label: 'Nombre de stations', get: a => (a.stations || []).length || (a.siteId ? 1 : 0) }, { label: 'Stations', get: stationsLabel },
    { label: 'Réseau(x)', get: a => networksOf(auditSiteIds(a)) },
    { label: 'Date', get: a => fmtDate(auditDate(a)) }, { label: 'Début', get: a => fmtTime(a.startedAt) }, { label: 'Fin', get: a => fmtTime(a.endedAt) },
    { label: 'Statut', get: a => a.lock?.lockedAt ? 'Signé — verrouillé' : AUDIT_STATUS[a.status]?.label || a.status },
    { label: 'Prestataire', get: a => name('provider', a.providerId) }, { label: 'Nature', get: a => PROVIDER_KINDS[store.get('provider', a.providerId)?.kind] || '' },
    { label: 'Site', get: a => name('site', a.siteId) }, { label: 'Code site', get: a => name('site', a.siteId, s => s.code) }, { label: 'Point', get: a => name('point', a.pointId, p => p.code) },
    { label: 'Prestation', get: a => name('prestation', a.prestationId, p => p.ref) }, { label: 'Campagne', get: a => name('campaign', a.campaignId, c => c.label) },
    { label: 'Grille', get: a => `${a.gridCode} v${a.gridVersion}` }, { label: 'Version protocole', get: a => a.protocolVersion || '' }, { label: 'Version CCTP', get: a => a.cctpVersion || '' },
    { label: 'Auditeur', get: a => a.auditorName }, { label: 'Contrôleurs OEG', get: a => controllerNamesText(a) }, { label: 'Appareil', get: a => a.device?.name || '' }, { label: 'Version application', get: a => a.appVersion },
    { label: 'Critères contrôlés', get: a => a._s.counts.controlled }, { label: 'Conformes', get: a => a._s.counts.C }, { label: 'Perfectibles', get: a => a._s.counts.P || 0 }, { label: 'Non conformes', get: a => a._s.counts.NC },
    { label: 'Non applicables', get: a => a._s.counts.NA }, { label: 'Non observés', get: a => a._s.counts.NO }, { label: 'Non vérifiables', get: a => a._s.counts.NV },
    { label: 'Écarts', get: a => a._s.deviationsCount }, ...['OBS', 'MIN', 'MAJ', 'CRIT'].map(c => ({ label: `Écarts ${crit(c)}`, get: a => a._s.byCriticality.find(x => x.code === c)?.count || 0 })),
    { label: 'Empreinte scellée', get: a => a.lock?.contentHash || '' }, { label: 'Modifications après signature', get: a => (a.amendments || []).length },
    { label: 'Compartiments contrôlés', get: a => (a.compartments || []).map(k => (a.gridSnapshot?.compartments || []).find(c => c.key === k)?.label || k).join(' ; ') }
  ],
  deviations: [
    { label: 'Numéro', get: d => d.number }, { label: 'Date', get: d => fmtDate(d.date) }, { label: 'Heure', get: d => d.time }, { label: 'Audit', get: d => d.auditNumber },
    { label: 'Prestataire', get: d => name('provider', d.providerId) }, { label: 'Site', get: deviationSites }, { label: 'Station', get: deviationStation }, { label: 'Réseau(x)', get: d => networksOf(d.siteId ? [d.siteId] : d.siteIds || []) }, { label: 'Critère', get: d => d.itemCode || '' },
    { label: 'Exigence concernée', get: d => d.requirement }, { label: 'Référence documentaire', get: d => (d.docRefs || []).map(r => [r.docKey, r.article].filter(Boolean).join(' § ')).join(' ; ') },
    { label: 'Description factuelle', get: d => d.description }, { label: 'Observation de l’auditeur', get: d => d.auditorObservation },
    { label: 'Criticité', get: d => crit(d.criticalityCode) }, { label: 'Type d’écart', get: d => name('deviationType', 'dtype-' + d.typeCode) || d.typeCode || '' },
    { label: 'Action immédiate', get: d => d.immediateAction }, { label: 'Action corrective demandée', get: d => d.correctiveActionRequested },
    { label: 'Responsable', get: d => d.responsible }, { label: 'Délai', get: d => fmtDate(d.dueDate) }, { label: 'Statut', get: d => DEVIATION_STATUS[d.status]?.label || d.status },
    { label: 'En retard', get: d => isOverdue(d, localDate()) ? 'Oui' : 'Non' }, { label: 'Actions correctives', get: d => (d.correctiveActions || []).map(a => `${a.description} [${ACTION_STATUS[a.status] || a.status}]`).join(' | ') },
    { label: 'Date de clôture', get: d => fmtDate(d.closedAt) }, { label: 'Localisation GPS', get: d => d.location ? `${d.location.lat.toFixed(6)}, ${d.location.lon.toFixed(6)}` : '' }
  ],
  prestations: [
    { label: 'Référence', get: p => p.ref }, { label: 'Date prévue', get: p => p.plannedDate ? fmtDate(p.plannedDate) : 'À planifier' }, { label: 'Heure', get: p => p.plannedTime }, { label: 'Date indicative', get: p => p.dateIndicative ? 'Oui' : '' },
    { label: 'Site', get: p => name('site', p.siteId) }, { label: 'Code site', get: p => name('site', p.siteId, s => s.code) },
    { label: 'Réseau', get: p => prestationNetwork(p, store.get('campaign', p.campaignId), currentNetworkIndex()) }, { label: 'Réseau(x) de la station', get: p => networksOf([p.siteId].filter(Boolean)) },
    { label: 'Prestataire', get: p => name('provider', p.providerId) },
    { label: 'Campagne', get: p => name('campaign', p.campaignId, c => c.label) }, { label: 'Type de prélèvement', get: p => name('samplingType', p.samplingTypeId) }, { label: 'Marché', get: p => p.marketRef },
    { label: 'Statut', get: p => PRESTATION_STATUS[p.status]?.label || p.status }, { label: 'Audits', get: p => store.filter('audit', a => (a.prestationId === p.id || (a.prestationIds || []).includes(p.id)) && a.status !== 'abandonne').map(a => a.number).join(', ') },
    { label: 'Source', get: p => p.source?.label || p.source?.kind || '' }
  ],
  sites: [
    { label: 'Code', get: s => s.code }, { label: 'Type de code', get: s => CODE_TYPES[s.codeType] || s.codeType || '' }, { label: 'Station', get: s => s.name },
    { label: 'Réseau(x)', get: s => sortNetworkCodes(s.networks || [], currentNetworkIndex()).join(' ; ') }, { label: 'Types de tournée', get: siteTypesText },
    { label: 'Bassin versant', get: s => s.bassin || '' }, { label: 'Commune', get: s => s.commune || '' }, { label: 'Cours d’eau', get: s => s.riverName || '' },
    { label: 'Masse d’eau', get: s => s.masseEau || '' }, { label: 'Nature', get: s => s.kind || s.nature || '' },
    { label: 'Latitude (WGS84)', get: s => s.lat ?? '' }, { label: 'Longitude (WGS84)', get: s => s.lon ?? '' }
  ],
  stationsByNetwork: [
    { label: 'Réseau', get: r => r.network.code === NO_NETWORK ? 'Sans réseau' : r.network.code }, { label: 'Libellé du réseau', get: r => r.network.label || '' },
    { label: 'Code', get: r => r.site.code }, { label: 'Station', get: r => r.site.name }, { label: 'Aussi dans', get: r => r.others.join(' ; ') },
    { label: 'Types de tournée', get: r => siteTypesText(r.site) }, { label: 'Bassin versant', get: r => r.site.bassin || '' }, { label: 'Commune', get: r => r.site.commune || '' }
  ],
  trail: [
    { label: 'Date et heure', get: t => fmtDateTime(t.at) }, { label: 'Horodatage ISO', get: t => t.at }, { label: 'Utilisateur', get: t => t.userName }, { label: 'Profil', get: t => t.role },
    { label: 'Appareil', get: t => t.deviceName }, { label: 'N° d’ordre (appareil)', get: t => t.seq }, { label: 'Action', get: t => t.action }, { label: 'Objet', get: t => t.entityType },
    { label: 'Libellé', get: t => t.entityLabel }, { label: 'Motif', get: t => t.reason }, { label: 'Nombre de champs', get: t => t.changeCount },
    { label: 'Détail (avant → après)', get: t => (t.changes || []).map(c => `${c.path}: ${JSON.stringify(c.before ?? '')} → ${JSON.stringify(c.after ?? '')}`).join(' | ') },
    { label: 'Empreinte', get: t => t.hash }, { label: 'Empreinte précédente', get: t => t.prevHash }
  ]
};

export function auditsWithSummary(audits) { return audits.map(a => ({ ...a, _s: auditState(a).summary })); }

/**
 * Réponses critère par critère (valeurs lisibles : formatValue ; objets « fields » en « Libellé : valeur · … ») :
 * grille effective ; « Station » = station du critère, « Commun à la tournée » pour un critère de tournée.
 */
export function responsesRows(audits) {
  const rows = [['Audit', 'Date', 'Type de tournée', 'Station', 'Feuille', 'Section', 'Domaine', 'Code', 'Réf. courte', 'Critère', 'Réponse', 'Valeur', 'Observation', 'Pré-rempli', 'Heure', 'Auteur']];
  for (const a of audits) {
    const multi = (a.stations || []).length > 1, type = typeLabel(a);
    for (const it of allItems(effectiveGrid(a))) {
      const r = a.responses?.[it.id]; if (!r) continue;
      const sheet = it.sheet !== undefined ? sheetOf(a.gridSnapshot, it.sheet) : null;
      const station = it.station && !it.shared ? it.station.name : multi ? 'Commun à la tournée' : name('site', a.siteId);
      rows.push([a.number, fmtDate(auditDate(a)), type, station, sheet ? `${sheet.no} – ${sheet.tab || sheet.title}` : '', it.sectionTitle, it.domain === 'transport' ? 'Transport' : 'Prélèvement', it.code, it.short || '', it.label, RESPONSES[r.status]?.label || '', formatValue(it, r.value), r.comment || '', r.prefilled ? 'Oui' : '', fmtTime(r.at), r.byName || '']);
    }
  }
  return rows;
}

/**
 * Synthèse par feuille (instance) des audits en feuilles : décomptes C / P / NC / N/A (critères partagés comptés
 * une fois, dans la 1re station), conclusion du contrôleur, observations / notes des encadrés.
 */
export function sheetsRows(audits) {
  const rows = [['Audit', 'Date', 'Type de tournée', 'Station', 'Feuille', 'N° affiché', 'Titre', 'C', 'P', 'NC', 'N/A', 'Non renseignés', 'Total', 'Conclusion', 'Commentaires', 'Observations', 'Notes', 'Photos / références', 'Agent(s) prestataire(s)']];
  for (const a of audits) for (const st of sheetSummary({ audit: a, grid: effectiveGrid(a), ctx: auditContext(a) })) {
    const d = a.sheets?.[st.instanceKey] || {};
    const station = st.station ? st.station.name : (a.stations || []).length > 1 ? 'Commun à la tournée' : name('site', a.siteId);
    rows.push([a.number, fmtDate(auditDate(a)), typeLabel(a), station, st.no, st.index ? `${st.index} / ${st.sheetTotal}` : '', st.title, st.C, st.P, st.NC, st.NA, st.unanswered, st.total, st.conclusionLabel, st.comments, d.observations || '', d.notes || '', d.photos || '', d.agents || '']);
  }
  return rows;
}

export function table(kind, list) { return objectsToRows(kind === 'audits' ? auditsWithSummary(list) : list, COLUMNS[kind]); }
export function csvOf(kind, list) { return toCSV(table(kind, list)); }

export async function exportWorkbook(sheets, filename, title) {
  await store.log('export', { entityLabel: filename, details: { format: 'xlsx', sheets: sheets.map(s => `${s.name} (${s.rows.length - 1})`) } });
  return writeXLSX(sheets, { title, author: session.user?.name });
}

export function planningICS(prestations) {
  return toICS(prestations.filter(p => p.plannedDate).map(p => ({
    uid: `${p.id}@oeg-audit`, date: p.plannedDate, time: p.plannedTime || '', summary: `Prélèvement ${name('site', p.siteId)} — ${name('provider', p.providerId)}`,
    location: name('site', p.siteId), description: `Prestation ${p.ref}\nType : ${name('samplingType', p.samplingTypeId)}\nStatut : ${PRESTATION_STATUS[p.status]?.label || p.status}`
  })), { name: 'Prestations de prélèvement' });
}

/* ---------- Paquets de données JSON (archivage, transfert entre appareils autonomes) ---------- */
const PACKAGE_FORMAT = 'oeg-audit-package-v1';

/** Paquet de données : toutes les entités (hors éléments techniques locaux), médias facultatifs. */
export async function buildPackage({ types = null, includeMedia = true, filter = null } = {}) {
  const entities = {};
  for (const t of store.types()) {
    if (LOCAL_ONLY.has(t) || (types && !types.includes(t))) continue;
    const list = store.all(t, { withDeleted: true }).filter(e => !filter || filter(t, e)).map(({ _rev, _lv, ...e }) => e);
    if (list.length) entities[t] = list;
  }
  const media = {};
  if (includeMedia) for (const m of entities.media || []) { const b = await mediaBytes(m.id).catch(() => null); if (b) media[m.id] = bytesToBase64(b); }
  const pkg = { format: PACKAGE_FORMAT, exportedAt: nowISO(), exportedBy: session.user?.name, device: session.device?.name, appVersion: appVersion(), entities, media };
  pkg.sha256 = await sha256Hex(JSON.stringify({ entities, media }));
  return pkg;
}
/** Dossier de preuve d'un audit : audit, écarts, médias, journal, prestation et référentiels utiles. */
export async function buildAuditDossier(auditId) {
  const a = store.get('audit', auditId);
  const devIds = new Set(store.filter('deviation', d => d.auditId === auditId).map(d => d.id));
  // Tournée : toutes les stations (sites, points, prestations), y compris celles retirées en cours de tournée.
  const stations = [...(a.stations || []), ...(a.removedStations || []).map(r => r.station).filter(Boolean)];
  const ids = new Set([auditId, ...devIds, a.prestationId, a.providerId, a.siteId, a.pointId, ...(a.operatorIds || []), ...(a.prestationIds || []),
    ...stations.flatMap(s => [s.siteId, s.pointId, s.prestationId])].filter(Boolean));
  return buildPackage({ filter: (t, e) => ids.has(e.id) || (t === 'media' && (e.auditId === auditId || devIds.has(e.link?.id))) || (t === 'trail' && (ids.has(e.entityId))) });
}

export async function protectPackage(pkg, password) { return encryptWithPassword(password, JSON.stringify(pkg)); }

/** Lecture d'un paquet (éventuellement chiffré). */
export async function readPackage(text, password = null) {
  let obj = JSON.parse(text);
  if (obj.format === 'oeg-audit-backup-enc-v1') {
    if (!password) { const e = new Error('Ce fichier est chiffré : mot de passe requis.'); e.needsPassword = true; throw e; }
    obj = JSON.parse(await decryptWithPassword(password, obj).catch(() => { throw new Error('Mot de passe incorrect ou fichier altéré.'); }));
  }
  if (obj.format !== PACKAGE_FORMAT) throw new Error('Format de fichier non reconnu.');
  const check = await sha256Hex(JSON.stringify({ entities: obj.entities, media: obj.media }));
  obj.integrity = check === obj.sha256;
  return obj;
}

/**
 * Fusion d'un paquet dans les données locales (transfert entre appareils en mode autonome).
 * Fusion champ par champ ; les valeurs concurrentes sont conservées en rapport de conflit.
 */
export async function importPackage(pkg) {
  const res = { added: 0, updated: 0, same: 0, conflicts: 0, media: 0 };
  for (const [type, list] of Object.entries(pkg.entities || {})) {
    if (LOCAL_ONLY.has(type)) continue;
    const toPut = [];
    for (const received of list) {
      // Grille par défaut d'une tablette pas encore mise à niveau (turbidité en FNU…) : lue d'après la version de
      // l'application avant la comparaison (ni conflit, ni retour en arrière).
      const remote = type === 'grid' ? upToDateGrid(received) : received;
      const local = store.getRaw(type, remote.id);
      if (!local) { toPut.push(remote); res.added++; continue; }
      if (JSON.stringify(sortKeys(local, true)) === JSON.stringify(sortKeys(remote, true))) { res.same++; continue; }
      const { merged, conflicts } = mergeEntity(type, null, local, remote);
      if (type === 'trail') { res.same++; continue; }
      toPut.push(merged); res.updated++;
      if (conflicts.length) { res.conflicts++; await store.put('conflict', { entityType: type, entityId: remote.id, at: nowISO(), label: remote.number || remote.name || remote.id, details: conflicts, resolved: false, localVersion: local, remoteVersion: remote, origin: `Import de ${pkg.device || 'paquet'} (${fmtDateTime(pkg.exportedAt)})` }); }
    }
    if (toPut.length) {
      if (type === 'trail') await store.applyRemoteMany(toPut.map(data => ({ type, data })), { withBase: false });
      else await store.bulkPut(type, toPut, { reason: `Import d’un paquet de données (${pkg.exportedBy || ''}, ${pkg.device || ''})`, action: 'import' });
    }
  }
  for (const [id, b64] of Object.entries(pkg.media || {})) {
    if (await idb.get('media', id)) continue;
    await storeRemoteBytes(id, base64ToBytes(b64)); res.media++;
  }
  return res;
}
function sortKeys(e, strip) { const out = {}; for (const k of Object.keys(e).sort()) if (!(strip && ['_rev', '_lv', 'updatedAt', 'updatedBy', 'updatedByName'].includes(k))) out[k] = e[k]; return out; }

export { sortBy };
