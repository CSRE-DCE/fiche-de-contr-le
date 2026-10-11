/* Synthèse factuelle d'un audit et indicateurs d'historique. Fichier pur.
 * Volontairement AUCUN score global : seuls des décomptes traçables sont produits (C / P / NC / N/A / non
 * renseignés), y compris par feuille, par station et pour l'ensemble de la tournée (grilles en feuilles) ;
 * la conclusion d'une feuille reste le choix du contrôleur. Chaque critère est compté UNE fois (un critère
 * « commun à la tournée » affiché dans chaque fiche station n'est compté qu'une fois). */
import { visibleStructure, visibleItems, isAnswerable, sheetsOf, isSheetGrid, expandGrid, withCompartments } from './grids.js';
import { OPEN_DEVIATION, SHEET_CONCLUSIONS } from './model.js';

const STATUSES = ['C', 'P', 'NC', 'NA', 'NO', 'NV'];
const emptyCounts = () => ({ C: 0, P: 0, NC: 0, NA: 0, NO: 0, NV: 0, unanswered: 0, total: 0, values: 0 });
const hasValue = r => r && r.value !== undefined && r.value !== null && r.value !== '';
function count(st, it, r) {
  if (!isAnswerable(it)) return;
  if (it.kind === 'conformity') {
    st.total++;
    if (r?.status && STATUSES.includes(r.status)) st[r.status]++; else st.unanswered++;
  } else if (hasValue(r)) st.values++;
}

/**
 * Grille et contexte d'une synthèse : grille fournie (effective de préférence), sinon grille effective calculée
 * à partir de l'instantané et des stations de l'audit (sans les noms des sites) ; contexte complété par les
 * compartiments et le type de tournée de l'audit.
 */
function gridAndCtx(audit, grid, ctx = {}) {
  // Instantané de la grille d'une tournée (ancien appel) : grille effective recalculée.
  const g = !grid || grid === audit?.gridSnapshot ? expandGrid(audit?.gridSnapshot, audit?.stations || []) : grid;
  const c = { ...ctx };
  if (!Array.isArray(c.compartments) || !c.compartments.length) c.compartments = audit?.compartments;
  if (!c.auditType && audit?.auditType) c.auditType = audit.auditType;
  return { grid: g, ctx: g?.compartments?.length ? withCompartments(g, c) : c };
}
const hintOf = (st) => {
  const parts = [];
  if (st.NC) parts.push(`${st.NC} NC`);
  if (st.P) parts.push(`${st.P} P`);
  if (parts.length) return `${parts.join(', ')} sur cette feuille`;
  return st.unanswered ? `${st.unanswered} point(s) sans réponse` : st.total ? 'Tous les points renseignés, aucune NC' : '';
};

/**
 * Décompte par instance de feuille visible (synthèse, PDF, exports) :
 * [{no, instanceKey, station, stationKey, index, sheetTotal (« Feuille index / sheetTotal »), key, tab, title, theme, C, P, NC, NA, NO, NV, unanswered, total,
 *   values, sharedCounted, sharedTotal, conclusion, conclusionLabel, comments, hint}]
 * - C … unanswered, total : critères de conformité visibles COMPTÉS dans cette ligne ; les critères partagés
 *   (« commun à la tournée ») ne sont comptés que dans la première instance de la feuille (sharedCounted) :
 *   la somme des lignes = décompte global ; sharedTotal = critères partagés affichés dans l'instance ;
 * - values = critères « valeur seule » renseignés ;
 * - conclusion = choix du contrôleur (audit.sheets[instanceKey].conclusion.status) ou '' ;
 * - hint = simple suggestion factuelle (« 2 NC, 1 P sur cette feuille »), jamais appliquée automatiquement.
 */
export function sheetSummary({ audit, grid = null, ctx = {} }) {
  const g = gridAndCtx(audit, grid, ctx);
  if (!isSheetGrid(g.grid)) return [];
  const responses = audit?.responses || {};
  const seenShared = new Set();
  return sheetsOf(g.grid, responses, g.ctx).map(sh => {
    const st = { no: sh.no, instanceKey: sh.instanceKey, station: sh.station, stationKey: sh.stationKey, index: sh.index, sheetTotal: sh.total, key: sh.key, tab: sh.tab, title: sh.title, theme: sh.theme, ...emptyCounts(), sharedCounted: 0, sharedTotal: 0 };
    const shown = emptyCounts();
    for (const it of sh.items) {
      const r = responses[it.id];
      count(shown, it, r);
      if (it.shared) {
        if (it.kind === 'conformity') st.sharedTotal++;
        if (seenShared.has(it.id)) continue;
        seenShared.add(it.id);
        if (it.kind === 'conformity') st.sharedCounted++;
      }
      count(st, it, r);
    }
    const block = (sh.blocks || []).find(b => b.key === 'conclusion');
    const concl = audit?.sheets?.[sh.instanceKey]?.conclusion || {};
    st.conclusion = concl.status || '';
    st.conclusionLabel = st.conclusion ? ((block?.options || []).find(o => o[0] === st.conclusion)?.[1] || SHEET_CONCLUSIONS[st.conclusion] || st.conclusion) : '';
    st.comments = concl.comments || '';
    st.hint = hintOf(shown);
    return st;
  });
}

/**
 * Décomptes de la tournée : {global, tournee, stations: [{key, index, siteId, name, code, ...décomptes}]}.
 * global : chaque critère visible une fois ; tournee : feuilles tournée et critères partagés ; chaque station :
 * ses critères propres (tournee + stations = global). Décomptes : {C, P, NC, NA, NO, NV, unanswered, total, values}.
 */
export function stationSummary({ audit, grid = null, ctx = {} }) {
  const g = gridAndCtx(audit, grid, ctx);
  const responses = audit?.responses || {};
  const global = emptyCounts(), tournee = emptyCounts();
  const stations = (g.grid?.stations || []).map(s => ({ key: s.key, index: s.index, siteId: s.siteId, name: s.name, code: s.code, ...emptyCounts() }));
  const byKey = new Map(stations.map(s => [s.key, s]));
  if (g.grid) for (const { item } of visibleItems(g.grid, responses, g.ctx)) {
    const r = responses[item.id];
    count(global, item, r);
    count(!item.shared && item.station && byKey.get(item.station.key) || tournee, item, r);
  }
  return { global, tournee, stations };
}

/**
 * @param {object} p {audit, grid (effective de préférence), ctx, deviations:[…], criticalities:[…], alerts:[…]}
 * Retour : {counts, sections, sheets, stations, ncItems, pItems, deviationsCount, byCriticality, frequentRequirements,
 *   strengths, vigilance, actions, samples, equipment, comment, preconisations}
 */
export function auditSummary({ audit, grid, ctx = {}, deviations = [], criticalities = [], alerts = [] }) {
  const responses = audit.responses || {};
  const g = grid ? gridAndCtx(audit, grid, ctx) : { grid: null, ctx };
  const structure = g.grid ? visibleStructure(g.grid, responses, g.ctx) : [];
  const counts = { controlled: 0, C: 0, P: 0, NC: 0, NA: 0, NO: 0, NV: 0, unanswered: 0, measures: 0 };
  const multi = (g.grid?.stations || []).length > 1;
  const sections = [];
  const ncItems = [], pItems = [];
  const seen = new Set();
  for (const s of structure) {
    if (!s.visible) continue;
    const title = s.station && multi ? `${s.title} — ${s.station.name}` : s.title;
    const st = { id: s.id, title, domain: s.domain || 'prelevement', stationKey: s.station?.key || null, C: 0, P: 0, NC: 0, NA: 0, NO: 0, NV: 0, unanswered: 0, total: 0 };
    for (const it of s.visibleItems) {
      if (!isAnswerable(it) || seen.has(it.id)) continue;
      seen.add(it.id);
      const r = responses[it.id];
      if (it.kind === 'conformity') {
        st.total++; counts.controlled++;
        if (r?.status && STATUSES.includes(r.status)) { st[r.status]++; counts[r.status]++; } else { st.unanswered++; counts.unanswered++; }
        const entry = () => ({ itemId: it.id, code: it.code, label: it.label, section: title, sheet: it.sheet ?? null, stationKey: it.shared ? null : it.station?.key || null, stationName: it.shared ? '' : it.station?.name || '', comment: r.comment || '', value: r.value ?? null, refs: it.refs || [] });
        if (r?.status === 'NC') ncItems.push(entry());
        if (r?.status === 'P') pItems.push(entry());
      } else if (hasValue(r)) counts.measures++;
    }
    sections.push(st);
  }
  const crit = new Map(criticalities.map(c => [c.code, c]));
  const byCriticality = criticalities.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map(c => ({ code: c.code, label: c.label, color: c.color, count: deviations.filter(d => d.criticalityCode === c.code).length }));
  const unknown = deviations.filter(d => !crit.has(d.criticalityCode)).length;
  if (unknown) byCriticality.push({ code: '?', label: 'Criticité non renseignée', count: unknown });

  // Exigences les plus fréquemment non conformes (dans l'audit : par référence documentaire / section)
  const freq = new Map();
  for (const n of ncItems) {
    const keys = n.refs.length ? n.refs.map(r => [r.docKey || r.docType, r.article].filter(Boolean).join(' § ')) : [n.section];
    for (const k of keys) freq.set(k, (freq.get(k) || 0) + 1);
  }
  const frequentRequirements = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([requirement, count]) => ({ requirement, count }));

  const strengths = sections.filter(s => s.total >= 2 && s.C === s.total).map(s => `${s.title} : ${s.C}/${s.total} critères conformes`);
  const vigilance = [];
  for (const s of sections) {
    const parts = [];
    if (s.NC) parts.push(`${s.NC} non-conformité(s)`);
    if (s.P) parts.push(`${s.P} point(s) perfectible(s)`);
    if (s.NO) parts.push(`${s.NO} critère(s) non observé(s)`);
    if (s.NV) parts.push(`${s.NV} critère(s) non vérifiable(s)`);
    if (s.unanswered) parts.push(`${s.unanswered} sans réponse`);
    if (parts.length) vigilance.push(`${s.title} : ${parts.join(', ')}`);
  }
  for (const a of alerts.filter(a => a.level !== 'info')) vigilance.push(`Alerte — ${a.title} : ${a.message}`);

  const actions = deviations.filter(d => d.correctiveActionRequested || d.immediateAction)
    .map(d => ({ number: d.number, criticality: crit.get(d.criticalityCode)?.label || d.criticalityCode || '', action: d.correctiveActionRequested || '', immediate: d.immediateAction || '', responsible: d.responsible || '', dueDate: d.dueDate || '' }));

  const sheets = g.grid ? sheetSummary({ audit, grid: g.grid, ctx: g.ctx }) : [];
  const stations = g.grid && isSheetGrid(g.grid) ? stationSummary({ audit, grid: g.grid, ctx: g.ctx }) : null;
  return {
    counts, sections, sheets, stations, ncItems, pItems, deviationsCount: deviations.length, byCriticality, frequentRequirements, strengths, vigilance, actions,
    samples: (audit.samples || []).length, equipment: (audit.equipmentChecks || []).length,
    comment: audit.conclusions?.comment || '', preconisations: audit.conclusions?.preconisations || ''
  };
}

/**
 * Écarts récurrents : même exigence (code de critère ou type d'écart) relevée dans au moins
 * `min` audits distincts pour un même prestataire. Code d'un critère de station (« F4.5·S2 ») : code d'origine.
 */
export function recurringDeviations(deviations, { min = 2, key = d => String(d.itemCode || '').replace(/·S\d+$/, '') || d.typeCode || d.requirement } = {}) {
  const groups = new Map();
  for (const d of deviations) {
    if (d.status === 'annule') continue;
    const k = `${d.providerId || '?'}|${key(d) || '?'}`;
    if (!groups.has(k)) groups.set(k, { providerId: d.providerId, requirement: d.requirement || key(d), key: key(d), deviations: [], audits: new Set() });
    const g = groups.get(k); g.deviations.push(d); g.audits.add(d.auditId);
  }
  return [...groups.values()].filter(g => g.audits.size >= min)
    .map(g => ({ ...g, audits: [...g.audits], count: g.deviations.length, open: g.deviations.filter(d => OPEN_DEVIATION.includes(d.status)).length }))
    .sort((a, b) => b.audits.length - a.audits.length);
}

/** Échéance dépassée d'un écart encore ouvert. */
export function isOverdue(d, today) {
  return OPEN_DEVIATION.includes(d.status) && d.dueDate && String(d.dueDate).slice(0, 10) < today;
}

/* ---------- Prestations : échéance et retard ---------- */
const lastDayOfMonth = day => {
  const [y, m] = String(day).slice(0, 7).split('-').map(Number);
  if (!y || !m) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
/**
 * Échéance d'une prestation (AAAA-MM-JJ) : sa date programmée ; date INDICATIVE (convention : 1er jour du mois de
 * session) → fin de la campagne, à défaut fin du mois de la date indicative. '' si la prestation n'est pas datée.
 */
export function prestationDueDate(p, campaign = null) {
  if (!p?.plannedDate) return '';
  if (!p.dateIndicative) return String(p.plannedDate).slice(0, 10);
  const end = String(campaign?.end || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= String(p.plannedDate).slice(0, 10) ? end : lastDayOfMonth(p.plannedDate);
}
/** Prestation en retard : échéance (prestationDueDate) passée, toujours « prévue » et sans audit (audited : booléen). */
export function isPrestationLate(p, { today, campaign = null, audited = false } = {}) {
  const due = prestationDueDate(p, campaign);
  return !!due && due < today && p.status === 'prevue' && !audited;
}
