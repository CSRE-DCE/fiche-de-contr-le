/* Note sur 20 des tournées (demande de l'OEG du 14/10/2026 « Mettre une grille de notation pour chaque fiche
 * d'évaluation » ; règles validées par l'OEG le 23/10/2026). Fichier pur (sans DOM ni IndexedDB).
 *
 * - Barème : C (conforme) = 1 point, P (perfectible) = 0,5, NC (non conforme) = 0 ; N/A (et NO / NV des grilles
 *   historiques) et points non renseignés : non comptés.
 * - Pondération : un point MAJEUR (`item.major`, 26 points de CT-2026 : MAJOR_ITEMS de grid-ct-2026.js) compte double
 *   (× MAJOR_WEIGHT) ; un point de SYNTHÈSE (`item.noScore` : F2.2.8, F4.27) reste coté et compté dans les décomptes
 *   C / P / NC / N/A, mais hors de la note (chaque écart est déjà compté dans les points qu'il résume).
 * - Note = points pondérés obtenus ÷ points pondérés évalués × 20, au dixième (le demi-dixième arrondi au-dessus),
 *   calculée en ENTIERS (demi-points) : 23,5 / 200 → « 2,4 » (jamais l'erreur d'arrondi des nombres flottants) ; aucun
 *   point évalué : « non noté ».
 * - Appréciation d'après la note AFFICHÉE (arrondie) et les seuils : par défaut ≥ 16 « Satisfaisant », 12 à < 16 « À
 *   améliorer », < 12 « Insuffisant » ; seuils réglables en Administration (orgSettings : gradeGood, gradeFair).
 * - Barème d'une grille (scoringOf) : points majeurs et de synthèse portés par la grille. Instantané d'une tournée
 *   commencée avant le barème (aucun point majeur) d'une grille fournie par l'application : barème de la grille du code
 *   de même identifiant, critère par critère (identifiant d'origine) ; un numéro retiré depuis (F8.A3) compte × 1.
 * - Portées (mêmes ensembles que les décomptes de summary.js, qui appelle tallyItem / gradeOf) : FEUILLE = points
 *   affichés dans la feuille (un point « commun à la tournée » compte dans la note de chaque feuille où il figure) ;
 *   STATION = points propres à la station ; « COMMUN À LA TOURNÉE » = feuille de tournée et points partagés ; TOURNÉE =
 *   chaque point une fois (point commun, opération mutualisée d'une station contrôlée pour la biologie et la chimie).
 * - Figement (js/app/audits.js, signAudit) : à la signature du contrôleur, gradingRecord enregistre dans la tournée les
 *   notes, les seuils et le barème utilisés (audit.grading, couvert par l'empreinte des signatures) ; resolveGrades
 *   choisit les notes à afficher : figées, recalculées après une modification tracée, calculées (tournée signée avant
 *   la notation) ou provisoires.
 * - averageGrades : moyennes des notes de tournées signées par prestataire et par réseau (tableau de bord).
 */
import { allItems, isAnswerable, parseItemId } from './grids.js';
import { GRID_CT_2026 } from './grid-ct-2026.js';

/** Points par cote (affichage) ; N/A, NO, NV et non renseigné : non comptés. */
export const GRADE_SCALE = Object.freeze({ C: 1, P: 0.5, NC: 0 });
/** Les mêmes en DEMI-points (calcul en entiers). */
const HALF = Object.freeze({ C: 2, P: 1, NC: 0 });
const rated = s => typeof s === 'string' && Object.prototype.hasOwnProperty.call(HALF, s);
/** Coefficient d'un point majeur. */
export const MAJOR_WEIGHT = 2;
/** Seuils par défaut : note ≥ good « Satisfaisant », ≥ fair « À améliorer », sinon « Insuffisant ». */
export const DEFAULT_GRADE_THRESHOLDS = Object.freeze({ good: 16, fair: 12 });
export const GRADE_LABELS = Object.freeze({ good: 'Satisfaisant', fair: 'À améliorer', poor: 'Insuffisant' });
export const NOT_GRADED = 'non noté';
/** Version de l'enregistrement de la note figée à la signature (audit.grading). */
export const GRADING_RECORD_VERSION = 1;

const toNum = v => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
/** Nombre en français (« 12,5 »). */
export const frNumber = n => String(n).replace('.', ',');

/* ---------- Seuils ---------- */
/**
 * Erreurs des seuils saisis (Administration) : [] s'ils sont valides — nombres de 0 à 20, « À améliorer » inférieur ou
 * égal à « Satisfaisant ». t : {good, fair} ou réglages {gradeGood, gradeFair}.
 */
export function thresholdErrors(t = {}) {
  const good = toNum(t?.good ?? t?.gradeGood), fair = toNum(t?.fair ?? t?.gradeFair);
  const errs = [];
  if (!(good >= 0 && good <= 20)) errs.push('Seuil « Satisfaisant » : nombre de 0 à 20 attendu.');
  if (!(fair >= 0 && fair <= 20)) errs.push('Seuil « À améliorer » : nombre de 0 à 20 attendu.');
  if (!errs.length && fair > good) errs.push('Le seuil « À améliorer » doit être inférieur ou égal au seuil « Satisfaisant ».');
  return errs;
}
/** Seuils valides au dixième ({good, fair} ou réglages {gradeGood, gradeFair}) ; absents ou invalides : seuils par défaut. */
export function gradeThresholds(t = null) {
  if (!t || thresholdErrors(t).length) return { ...DEFAULT_GRADE_THRESHOLDS };
  const r = v => Math.round(toNum(v) * 10) / 10;
  return { good: r(t.good ?? t.gradeGood), fair: r(t.fair ?? t.gradeFair) };
}
/**
 * « ≥ 16 Satisfaisant · 12 à < 16 À améliorer · < 12 Insuffisant » ; words (PDF, sans « ≥ ») : « 16 et plus
 * « Satisfaisant » · de 12 à moins de 16 « À améliorer » · moins de 12 « Insuffisant » ».
 */
export function thresholdsText(t = null, { words = false } = {}) {
  const { good, fair } = gradeThresholds(t);
  if (words) return `${frNumber(good)} et plus « ${GRADE_LABELS.good} » · de ${frNumber(fair)} à moins de ${frNumber(good)} « ${GRADE_LABELS.fair} » · moins de ${frNumber(fair)} « ${GRADE_LABELS.poor} »`;
  return `≥ ${frNumber(good)} ${GRADE_LABELS.good} · ${frNumber(fair)} à < ${frNumber(good)} ${GRADE_LABELS.fair} · < ${frNumber(fair)} ${GRADE_LABELS.poor}`;
}

/* ---------- Barème d'une grille ---------- */
const baseOf = it => it?.baseId || parseItemId(it?.id).baseId;
/** Grilles du code servant de barème de référence (instantanés antérieurs au barème), par identifiant. */
const REFERENCES = new Map([[GRID_CT_2026.id, GRID_CT_2026]]);
const SCORING = new WeakMap();
const emptyScoring = () => ({ source: 'aucun', majors: new Set(), noScore: new Set() });

/**
 * Barème d'une grille (instantané ou grille effective) : {source, majors, noScore} — ensembles d'identifiants
 * D'ORIGINE des critères (« it-F4-12 », aussi pour « it-F4-12@09271503 »).
 * source : 'grille' (points majeurs portés par la grille) ; 'reference' (instantané d'une tournée commencée avant le
 * barème : celui de la grille du code de même identifiant, critère par critère ; un critère retiré depuis compte × 1) ;
 * 'aucun' (grille sans barème : × 1 partout, points de synthèse de la grille hors note).
 */
export function scoringOf(grid, { references = REFERENCES } = {}) {
  if (!grid || typeof grid !== 'object') return emptyScoring();
  const cached = references === REFERENCES ? SCORING.get(grid) : null;
  if (cached) return cached;
  const items = allItems(grid).filter(it => it.kind === 'conformity' && isAnswerable(it));
  const own = items.some(it => it.major);
  const ref = own ? null : references.get(grid.id) || null;
  const refItems = ref ? new Map(allItems(ref).map(it => [it.id, it])) : null;
  const out = { source: own ? 'grille' : ref ? 'reference' : 'aucun', majors: new Set(), noScore: new Set() };
  for (const it of items) {
    const b = baseOf(it), src = refItems ? refItems.get(b) : it;
    if (src?.major) out.majors.add(b);
    if (src?.noScore || it.noScore) out.noScore.add(b);
  }
  if (references === REFERENCES) SCORING.set(grid, out);
  return out;
}
/** Barème figé dans une note enregistrée à la signature. */
export function scoringFromRecord(rec) {
  return { source: rec?.source || 'grille', majors: new Set(rec?.majors || []), noScore: new Set(rec?.noScore || []) };
}
/** Coefficient d'un critère : 0 (point de synthèse, hors note), MAJOR_WEIGHT (point majeur) ou 1. Sans barème : attributs du critère. */
export function weightOf(item, scoring = null) {
  if (!scoring) return item?.noScore ? 0 : item?.major ? MAJOR_WEIGHT : 1;
  const b = baseOf(item);
  return scoring.noScore.has(b) ? 0 : scoring.majors.has(b) ? MAJOR_WEIGHT : 1;
}
export const isMajorItem = (item, scoring = null) => weightOf(item, scoring) === MAJOR_WEIGHT;
export const isNoScoreItem = (item, scoring = null) => weightOf(item, scoring) === 0;

/* ---------- Décompte et note ---------- */
/** Décompte d'une portée : cotes (C, P, NC, NA, unanswered, total) et points en demi-points (got2 / max2). */
export const emptyTally = () => ({ C: 0, P: 0, NC: 0, NA: 0, unanswered: 0, total: 0, evaluated: 0, majors: 0, excluded: 0, got2: 0, max2: 0 });
/**
 * Ajoute un critère de conformité (les autres sont ignorés) : cote comptée ; C / P / NC notés avec le coefficient du
 * critère (evaluated, majors = points majeurs évalués, excluded = points de synthèse cotés hors note).
 */
export function tallyItem(t, item, r, scoring = null) {
  if (!item || item.kind !== 'conformity' || !isAnswerable(item)) return t;
  t.total++;
  const s = r?.status;
  if (s === 'C' || s === 'P' || s === 'NC' || s === 'NA') t[s]++;
  else if (!s) t.unanswered++;
  if (!rated(s)) return t;
  const w = weightOf(item, scoring);
  if (!w) { t.excluded++; return t; }
  t.evaluated++;
  if (w > 1) t.majors++;
  t.got2 += w * HALF[s];
  t.max2 += w * HALF.C;
  return t;
}
/** « 15,6 » (note × 10 entière) ou « non noté ». */
export const noteText = n10 => (Number.isInteger(n10) && n10 >= 0 ? `${Math.floor(n10 / 10)},${n10 % 10}` : NOT_GRADED);
/** Niveau d'une note AFFICHÉE (× 10, entière) : 'good' | 'fair' | 'poor'. */
export function levelOf(n10, thresholds = null) {
  const th = gradeThresholds(thresholds);
  return n10 >= Math.round(th.good * 10) ? 'good' : n10 >= Math.round(th.fair * 10) ? 'fair' : 'poor';
}
/**
 * Note d'un décompte : {C, P, NC, NA, unanswered, total, evaluated, majors, excluded, points, max, n10, note, text,
 * level, label} — points / max : points pondérés obtenus / évalués ; n10 = note × 10 (entier) ; note : nombre au dixième
 * ou null (« non noté ») ; level : 'good' | 'fair' | 'poor' | null.
 */
export function gradeOf(t = {}, thresholds = null) {
  const got2 = Math.max(0, Math.round(t.got2 || 0)), max2 = Math.max(0, Math.round(t.max2 || 0));
  const g = {
    C: t.C || 0, P: t.P || 0, NC: t.NC || 0, NA: t.NA || 0, unanswered: t.unanswered || 0, total: t.total || 0,
    evaluated: t.evaluated || 0, majors: t.majors || 0, excluded: t.excluded || 0, points: got2 / 2, max: max2 / 2,
    n10: null, note: null, text: NOT_GRADED, level: null, label: 'Non noté'
  };
  if (!max2) return g;
  // note × 10 = 200 × got2 / max2, arrondie au plus proche (demi au-dessus) en arithmétique entière exacte.
  const n10 = Math.floor((400 * got2 + max2) / (2 * max2));
  const level = levelOf(n10, thresholds);
  return { ...g, n10, note: n10 / 10, text: noteText(n10), level, label: GRADE_LABELS[level] };
}
/** Note d'une liste de critères (feuille, test) : [{item, response}] ou critères + réponses. */
export function gradeItems(items, responses = {}, { scoring = null, thresholds = null } = {}) {
  const t = emptyTally();
  for (const it of items || []) tallyItem(t, it, responses?.[it.id], scoring);
  return gradeOf(t, thresholds);
}
/** « 15,6 / 20 — À améliorer » ou « non noté ». */
export const gradeText = g => (g?.n10 === null || g?.n10 === undefined ? NOT_GRADED : `${noteText(g.n10)} / 20 — ${g.label}`);

/* ---------- Note figée à la signature ---------- */
const COMPACT = ['note', 'level', 'evaluated', 'majors', 'excluded', 'points', 'max', 'C', 'P', 'NC', 'NA', 'unanswered'];
const compact = g => Object.fromEntries(COMPACT.map(k => [k, g?.[k] ?? (k === 'note' || k === 'level' ? null : 0)]));
/** Note complète d'une note compacte enregistrée (niveau enregistré, sinon d'après les seuils). */
export function gradeFromCompact(c, thresholds = null) {
  const n10 = typeof c?.note === 'number' && Number.isFinite(c.note) ? Math.round(c.note * 10) : null;
  const level = n10 === null ? null : GRADE_LABELS[c.level] ? c.level : levelOf(n10, thresholds);
  const g = { ...compact(c), n10, note: n10 === null ? null : n10 / 10, level };
  return { ...g, text: noteText(n10), label: level ? GRADE_LABELS[level] : 'Non noté' };
}
/**
 * Notes d'une synthèse (auditSummary : notes des feuilles et décomptes par station) : {tour, tournee, stations: {clé:
 * note}, sheets: {instanceKey: note}} ; null hors grille « en feuilles ».
 */
export function collectGrades(summary) {
  const st = summary?.stations;
  if (!st?.global?.grade) return null;
  return {
    tour: st.global.grade, tournee: st.tournee.grade,
    stations: Object.fromEntries((st.stations || []).map(s => [s.key, s.grade])),
    sheets: Object.fromEntries((summary.sheets || []).filter(s => s.grade).map(s => [s.instanceKey, s.grade]))
  };
}
/**
 * Enregistrement de la note figée à la signature (audit.grading) : {version, at, by, byName, thresholds, scale,
 * majorWeight, source, majors, noScore (identifiants d'origine triés), tour, tournee, stations, sheets} — notes compactes
 * {note, level, evaluated, majors, excluded, points, max, C, P, NC, NA, unanswered}. grades : collectGrades.
 */
export function gradingRecord(grades, { thresholds = null, scoring = null, at = '', by = '', byName = '' } = {}) {
  const sc = scoring || emptyScoring();
  const map = o => Object.fromEntries(Object.entries(o || {}).map(([k, g]) => [k, compact(g)]));
  return {
    version: GRADING_RECORD_VERSION, at, by, byName, thresholds: gradeThresholds(thresholds), scale: { ...GRADE_SCALE }, majorWeight: MAJOR_WEIGHT,
    source: sc.source, majors: [...sc.majors].sort(), noScore: [...sc.noScore].sort(),
    tour: compact(grades?.tour), tournee: compact(grades?.tournee), stations: map(grades?.stations), sheets: map(grades?.sheets)
  };
}
/** Enregistrement de note figée lisible (version connue, seuils valides, note de la tournée présente) ? */
export function isGradingRecord(rec) {
  return !!rec && typeof rec === 'object' && rec.version === GRADING_RECORD_VERSION && !!rec.tour && typeof rec.tour === 'object' && !thresholdErrors(rec.thresholds || {}).length;
}
const sig = g => `${g?.n10 ?? ''}|${g?.evaluated ?? 0}|${g?.points ?? 0}|${g?.max ?? 0}`;
/** Note dont l'appréciation est recalculée avec d'autres seuils (même note). */
export function relabelGrade(g, thresholds = null) {
  if (!g || g.n10 === null || g.n10 === undefined) return g;
  const level = levelOf(g.n10, thresholds);
  return { ...g, level, label: GRADE_LABELS[level] };
}
/**
 * Notes à afficher pour une tournée (fonction pure) : {state, thresholds, record, tour, tournee, stations, sheets,
 * signedTour?}. live : notes calculées (collectGrades) avec les seuils et le barème du contexte — figés si `record`.
 * state : 'figee' (note figée à la signature, affichée telle qu'enregistrée) ; 'recalculee' (tournée verrouillée, note
 * figée puis modification tracée après la signature qui la change : notes recalculées avec les seuils et le barème
 * figés, signedTour = note de la tournée à la signature) ; 'calculee' (tournée signée sans note figée : signée avant la
 * notation) ; 'provisoire' (tournée non signée, ou contenu changé après la signature du contrôleur et avant le
 * verrouillage — il faudra signer de nouveau : seuils actuels `thresholds`). null hors grille « en feuilles ».
 * locked : tournée verrouillée ; amended : modifications tracées après le verrouillage.
 */
export function resolveGrades({ live, record = null, thresholds = null, signed = false, amended = false, locked = true } = {}) {
  if (!live) return null;
  if (record && isGradingRecord(record)) {
    const th = gradeThresholds(record.thresholds);
    const of = (o, base) => Object.fromEntries(Object.entries(base || {}).map(([k, g]) => [k, o?.[k] ? gradeFromCompact(o[k], th) : g]));
    const frozen = { tour: gradeFromCompact(record.tour, th), tournee: record.tournee ? gradeFromCompact(record.tournee, th) : live.tournee, stations: of(record.stations, live.stations), sheets: of(record.sheets, live.sheets) };
    const all = x => [sig(x.tour), sig(x.tournee), ...Object.keys(live.stations || {}).map(k => sig(x.stations[k])), ...Object.keys(live.sheets || {}).map(k => sig(x.sheets[k]))].join(';');
    if (all(frozen) === all(live)) return { state: 'figee', thresholds: th, record, ...frozen };
    if (!locked) {
      // Signée par le contrôleur puis modifiée avant le verrouillage : la signature est à refaire, la note redevient provisoire.
      const cur = gradeThresholds(thresholds), map = o => Object.fromEntries(Object.entries(o || {}).map(([k, g]) => [k, relabelGrade(g, cur)]));
      return { state: 'provisoire', thresholds: cur, record: null, tour: relabelGrade(live.tour, cur), tournee: relabelGrade(live.tournee, cur), stations: map(live.stations), sheets: map(live.sheets) };
    }
    if (!amended) return { state: 'figee', thresholds: th, record, ...frozen };
    return { state: 'recalculee', thresholds: th, record, ...live, signedTour: frozen.tour };
  }
  return { state: signed ? 'calculee' : 'provisoire', thresholds: gradeThresholds(thresholds), record: null, ...live };
}
/**
 * Reporte les notes à afficher (resolveGrades) dans une synthèse (auditSummary) : summary.grade, notes des stations,
 * de la ligne « commun à la tournée » et des feuilles ; summary.grading = r. Retourne la synthèse.
 */
export function applyResolvedGrades(summary, r) {
  if (!summary) return summary;
  summary.grading = r || null;
  if (!r || !summary.stations) return summary;
  summary.grade = r.tour;
  summary.stations.global.grade = r.tour;
  summary.stations.tournee.grade = r.tournee;
  for (const s of summary.stations.stations || []) if (r.stations?.[s.key]) s.grade = r.stations[s.key];
  for (const s of summary.sheets || []) if (r.sheets?.[s.instanceKey]) s.grade = r.sheets[s.instanceKey];
  return summary;
}
/** Mention de l'état d'une note (écrans, PDF, exports). */
export const GRADE_STATES = Object.freeze({
  figee: 'figée à la signature', recalculee: 'recalculée après modification tracée', calculee: 'calculée (tournée signée avant la notation)', provisoire: 'provisoire (tournée non signée)'
});

/* ---------- Moyennes (tableau de bord) ---------- */
const meanN10 = list => Math.floor((2 * list.reduce((a, b) => a + b, 0) + list.length) / (2 * list.length));
const avg = (list, th) => {
  if (!list.length) return { count: 0, n10: null, note: null, text: NOT_GRADED, level: null, label: 'Non noté', min: null, max: null };
  const n10 = meanN10(list), level = levelOf(n10, th);
  return { count: list.length, n10, note: n10 / 10, text: noteText(n10), level, label: GRADE_LABELS[level], min: Math.min(...list) / 10, max: Math.max(...list) / 10 };
};
/**
 * Moyennes des notes de tournées (tournées notées seulement) : rows [{providerId, networks: [codes], n10}] →
 * {all, byProvider: [{providerId, ...moyenne, networks: [{code, ...moyenne}]}], byNetwork: [{code, ...moyenne}]} ;
 * moyenne : {count, n10, note, text, level, label, min, max}, au dixième (demi au-dessus), d'après les notes affichées ;
 * appréciation selon les seuils donnés. Une tournée sur deux réseaux compte dans chacun. Tri : prestataires par nombre
 * de tournées décroissant, réseaux dans l'ordre de première apparition (à trier par l'appelant).
 */
export function averageGrades(rows = [], thresholds = null) {
  const ok = (rows || []).filter(r => Number.isInteger(r?.n10));
  const byProv = new Map(), byNet = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of ok) {
    push(byProv, r.providerId || '', r);
    for (const c of new Set(r.networks || [])) push(byNet, c, r.n10);
  }
  const byProvider = [...byProv.entries()].map(([providerId, list]) => {
    const nets = new Map();
    for (const r of list) for (const c of new Set(r.networks || [])) push(nets, c, r.n10);
    return { providerId, ...avg(list.map(r => r.n10), thresholds), networks: [...nets.entries()].map(([code, l]) => ({ code, ...avg(l, thresholds) })) };
  }).sort((a, b) => b.count - a.count);
  return { all: avg(ok.map(r => r.n10), thresholds), byProvider, byNetwork: [...byNet.entries()].map(([code, l]) => ({ code, ...avg(l, thresholds) })) };
}
