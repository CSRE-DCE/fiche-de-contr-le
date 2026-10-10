/* Grilles d'audit dynamiques : logique conditionnelle, avancement, contrôle de complétude.
 * Fichier pur (testé sous Node et dans le navigateur).
 *
 * Une grille : {id, code, name, version, status, scope, settings, sections:[{id, title, domain, module,
 *   phase, help, condition, subsections?, items:[item]}]}
 * Un critère (item) : {id, code, label, help, kind, responses, options, unit, min, max, required,
 *   justifyOn:['NC'], evidenceOnNC, refs:[{docKey, docType, article, paragraph, requirement}],
 *   condition, alerts:[{op, value, level, message, field?}], compareTo, delayFrom, maxHours,
 *   input?, prefill?, short?, no?, icon?, domain?}
 * Une condition : {item:'CODE'|id, op, value} | {ctx:'matrixCode', op, value} | {all:[…]} | {any:[…]} | {not:…}
 *
 * Grille « en feuilles » (`layout: 'sheets'`, ex. grid-bio-2026.js) : en plus, `compartments`
 * [{key, label, icon, always?}], `sheets` [{no, key, tab, title, theme, compartment, layout, blocks, modules}]
 * et `section.sheet` (n° de feuille). Les compartiments retenus pour l'audit sont passés dans le contexte
 * (`ctx.compartments`) ; à défaut, tous les compartiments de la grille sont considérés comme retenus.
 */
import { DEFAULT_RESPONSES, itemInput, isEmptyValue, fieldShown } from './model.js';

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const OPERATORS = {
  eq: 'est égal à', neq: 'est différent de', in: 'fait partie de', nin: 'ne fait pas partie de',
  gt: 'est supérieur à', gte: 'est supérieur ou égal à', lt: 'est inférieur à', lte: 'est inférieur ou égal à',
  answered: 'est renseigné', empty: 'n’est pas renseigné', truthy: 'est « Oui »', falsy: 'est « Non »'
};

/** Liste à plat des sections (sous-sections incluses) dans l'ordre d'affichage (`sheet` hérité du parent). */
export function flatSections(grid) {
  const out = [];
  const walk = (secs, parent = null, depth = 0) => {
    for (const s of secs || []) {
      const sec = { ...s, parentId: parent?.id || null, depth };
      if (sec.sheet === undefined && parent?.sheet !== undefined) sec.sheet = parent.sheet;
      out.push(sec); walk(s.subsections, sec, depth + 1);
    }
  };
  walk(grid?.sections);
  return out;
}
/** Domaine d'un critère : celui du critère s'il est précisé (ex. ligne « Transport » d'une feuille), sinon celui de la section. */
const itemDomain = (it, s) => it.domain || s.domain || 'prelevement';
export function allItems(grid) {
  const out = [];
  for (const s of flatSections(grid)) for (const it of s.items || []) {
    const x = { ...it, sectionId: s.id, sectionTitle: s.title, domain: itemDomain(it, s) };
    if (s.sheet !== undefined) x.sheet = s.sheet;
    out.push(x);
  }
  return out;
}
export function itemIndex(grid) {
  const m = new Map();
  for (const it of allItems(grid)) { m.set(it.id, it); if (it.code) m.set(it.code, it); }
  return m;
}

/** Valeur d'un critère utilisée par les conditions et règles. */
export function responseValue(item, r) {
  if (!r) return undefined;
  if (item?.kind === 'conformity') return r.status;
  if (r.status === 'NA') return 'NA';
  return r.value;
}

function compare(op, actual, expected) {
  const num = v => (v === '' || v === null || v === undefined) ? NaN : Number(String(v).replace(',', '.'));
  switch (op) {
    case 'eq': return actual === expected || String(actual) === String(expected);
    case 'neq': return !(actual === expected || String(actual) === String(expected));
    case 'in': return (Array.isArray(expected) ? expected : [expected]).some(e => Array.isArray(actual) ? actual.map(String).includes(String(e)) : String(actual) === String(e));
    case 'nin': return !compare('in', actual, expected);
    case 'gt': return num(actual) > num(expected);
    case 'gte': return num(actual) >= num(expected);
    case 'lt': return num(actual) < num(expected);
    case 'lte': return num(actual) <= num(expected);
    case 'answered': return actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && !actual.length);
    case 'empty': return !compare('answered', actual);
    case 'truthy': return actual === true || actual === 'Oui' || actual === 'oui' || actual === 'C';
    case 'falsy': return actual === false || actual === 'Non' || actual === 'non';
    default: return false;
  }
}

/**
 * Évalue une condition. `responses` : réponses de l'audit ; `index` : critères par id/code ;
 * `ctx` : contexte de l'audit (matrice, type de prélèvement, type de prestataire…).
 */
export function evalCondition(cond, responses, index, ctx = {}) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every(c => evalCondition(c, responses, index, ctx));
  if (cond.all) return cond.all.every(c => evalCondition(c, responses, index, ctx));
  if (cond.any) return cond.any.some(c => evalCondition(c, responses, index, ctx));
  if (cond.not) return !evalCondition(cond.not, responses, index, ctx);
  if (cond.ctx) return compare(cond.op || 'eq', ctx[cond.ctx], cond.value);
  if (cond.item) {
    const item = index.get(cond.item);
    if (!item) return false;
    return compare(cond.op || 'eq', responseValue(item, responses?.[item.id]), cond.value);
  }
  return true;
}

/** Une condition est-elle valide (critères référencés existants, opérateur connu) ? */
export function conditionErrors(cond, index, path = 'condition') {
  if (!cond) return [];
  if (Array.isArray(cond)) return cond.flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.all || cond.any) return (cond.all || cond.any).flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.not) return conditionErrors(cond.not, index, path + '.not');
  const errs = [];
  if (cond.op && !OPERATORS[cond.op]) errs.push(`${path} : opérateur inconnu « ${cond.op} »`);
  if (cond.item && !index.get(cond.item)) errs.push(`${path} : critère « ${cond.item} » introuvable`);
  if (!cond.item && !cond.ctx) errs.push(`${path} : condition sans critère ni contexte`);
  return errs;
}

/**
 * Structure visible de la grille pour un audit : les sections/critères dont la condition n'est pas
 * remplie sont masqués (et exclus de l'avancement et des contrôles de complétude).
 */
export function visibleStructure(grid, responses = {}, ctx = {}) {
  const index = itemIndex(grid);
  ctx = withCompartments(grid, ctx);
  const out = [];
  const walk = (secs, parentVisible = true, depth = 0, parentSheet = undefined) => {
    for (const s of secs || []) {
      const sheet = s.sheet !== undefined ? s.sheet : parentSheet;
      const visible = parentVisible && evalCondition(s.condition, responses, index, ctx);
      const items = (s.items || []).map(it => {
        const x = { ...it, sectionId: s.id, domain: itemDomain(it, s), visible: visible && evalCondition(it.condition, responses, index, ctx) };
        if (sheet !== undefined) x.sheet = sheet;
        return x;
      });
      const sec = { ...s, depth, visible, items, visibleItems: items.filter(i => i.visible) };
      if (sheet !== undefined) sec.sheet = sheet;
      out.push(sec);
      walk(s.subsections, visible, depth + 1, sheet);
    }
  };
  walk(grid?.sections);
  return out;
}

/* ---------- Compartiments (grilles en feuilles) ---------- */
/** Clés des compartiments d'une grille, dans l'ordre de la grille. */
export function gridCompartments(grid) { return (grid?.compartments || []).map(c => c.key); }
/**
 * Compartiments effectivement retenus : ceux demandés (connus de la grille) + ceux marqués `always`,
 * dans l'ordre de la grille. Liste absente ou vide ⇒ tous les compartiments.
 */
export function normalizeCompartments(grid, list) {
  const all = grid?.compartments || [];
  if (!all.length) return Array.isArray(list) ? [...list] : [];
  const wanted = new Set(Array.isArray(list) && list.length ? list : all.map(c => c.key));
  return all.filter(c => c.always || wanted.has(c.key)).map(c => c.key);
}
/** Contexte complété par les compartiments retenus (grilles à compartiments uniquement). */
export function withCompartments(grid, ctx = {}) {
  if (!grid?.compartments?.length) return ctx || {};
  return { ...(ctx || {}), compartments: normalizeCompartments(grid, ctx?.compartments) };
}

/* ---------- Feuilles (grilles `layout: 'sheets'`) ---------- */
export const isSheetGrid = grid => grid?.layout === 'sheets' && Array.isArray(grid?.sheets) && grid.sheets.length > 0;
export function sheetOf(grid, no) { return (grid?.sheets || []).find(s => String(s.no) === String(no)) || null; }
/** Tous les critères d'une feuille (sans tenir compte des conditions d'affichage). */
export function itemsOfSheet(grid, no) { return allItems(grid).filter(it => String(it.sheet) === String(no)); }
/** Feuille contenant un critère (n°) ou null. */
export function sheetOfItem(grid, itemId) { return allItems(grid).find(it => it.id === itemId || it.code === itemId)?.sheet ?? null; }

/**
 * Feuilles VISIBLES pour un audit : feuilles dont le compartiment est retenu, chacune avec ses sections
 * visibles (`sections[].items` = critères visibles) et la liste à plat de ses critères visibles (`items`).
 */
export function sheetsOf(grid, responses = {}, ctx = {}) {
  if (!isSheetGrid(grid)) return [];
  const c = withCompartments(grid, ctx);
  const active = new Set(c.compartments || []);
  const structure = visibleStructure(grid, responses, c);
  const out = [];
  for (const sh of grid.sheets) {
    if (sh.compartment && grid.compartments?.length && !active.has(sh.compartment)) continue;
    const own = structure.filter(s => String(s.sheet) === String(sh.no));
    const sections = own.filter(s => s.visible).map(s => ({ ...s, items: s.visibleItems }));
    if (own.length && !sections.length) continue;
    out.push({ ...sh, sections, items: sections.flatMap(s => s.items) });
  }
  return out;
}

/** Avancement par feuille visible : {[no]: {no, total, answered, nc, missingRequired, percent}}. */
export function sheetProgress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const out = {};
  for (const sh of sheetsOf(grid, responses, ctx)) {
    const st = { no: sh.no, total: 0, answered: 0, nc: 0, missingRequired: 0, percent: 0 };
    for (const it of sh.items) {
      if (!isAnswerable(it)) continue;
      const r = withMedia(responses[it.id], mediaCounts[it.id]);
      st.total++;
      if (isAnswered(it, r)) st.answered++;
      else if (it.required) st.missingRequired++;
      if (r?.status === 'NC') st.nc++;
    }
    st.percent = st.total ? Math.round(st.answered * 100 / st.total) : 0;
    out[sh.no] = st;
  }
  return out;
}

/** En-têtes de colonnes d'un tableau de feuille (valeurs de la maquette, surchargées par `section.headers`). */
export const SHEET_HEADERS = { no: 'N°', label: 'Point de contrôle', short: 'Référence courte', value: 'Valeur / réponse', c: 'C', nc: 'NC', na: 'N/A', obs: 'Observations' };
export function sectionHeaders(section) { return { ...SHEET_HEADERS, ...(section?.headers || {}) }; }

/* ---------- Pré-remplissage à la création de l'audit ---------- */
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const operatorName = o => typeof o === 'string' ? o : ([o?.firstName, o?.lastName].filter(Boolean).join(' ') || o?.code || o?.name || '');
/** Valeur d'une source de pré-remplissage (`item.prefill`, voir PREFILL_SOURCES de model.js). */
export function prefillValue(source, { site = null, auditor = null, provider = null, prestation = null, operators = [], date = '', time = '' } = {}) {
  switch (source) {
    case 'site.name': return site?.name ? String(site.name).toLocaleUpperCase('fr-FR') : '';
    case 'site.code': case 'site.bassin': case 'site.riverName': case 'site.commune': case 'site.her': case 'site.pressions': case 'site.strahler':
      return site?.[source.slice(5)] ?? '';
    case 'site.xy': return finite(site?.x) && finite(site?.y) ? { x: Number(site.x), y: Number(site.y) } : null;
    case 'audit.date': return date || '';
    case 'audit.time': return time ? String(time).slice(0, 5) : '';
    case 'auditor.name': return typeof auditor === 'string' ? auditor : auditor?.name || '';
    case 'provider.name': return typeof provider === 'string' ? provider : provider?.name || '';
    case 'prestation.operators': return (operators || []).map(operatorName).filter(Boolean).join(', ') || prestation?.team || '';
    default: return '';
  }
}
/**
 * Réponses pré-remplies d'un nouvel audit (fonction pure) : {[itemId]: {value, prefilled: true}} pour les
 * critères des sections visibles portant `prefill` (valeur sans statut ; l'auditeur reste maître du constat).
 * p : {site, auditor, provider, prestation, operators, date, time, compartments?, at?, by?, byName?}
 */
export function prefillResponses(grid, p = {}) {
  const out = {};
  const ctx = withCompartments(grid, { compartments: p.compartments });
  for (const s of visibleStructure(grid, {}, ctx)) {
    if (!s.visible) continue;
    for (const it of s.items) {
      if (!it.prefill) continue;
      let v = prefillValue(it.prefill, p);
      if (v === null || v === undefined || v === '') continue;
      const type = itemInput(it)?.type;
      if (isPlainObject(v) && type !== 'fields') continue;
      if (!isPlainObject(v) && type === 'fields') continue;
      if (type === 'number') { if (!finite(v)) continue; v = Number(v); }
      else if (!isPlainObject(v)) v = String(v);
      const r = { value: v, prefilled: true };
      if (p.at) r.at = p.at;
      if (p.by) r.by = p.by;
      if (p.byName) r.byName = p.byName;
      out[it.id] = r;
    }
  }
  return out;
}

export function isAnswerable(item) { return item.kind !== 'info'; }
/**
 * Un critère est-il renseigné ? Conformité : statut choisi (la valeur « Valeur / réponse » est facultative).
 * Valeur objet (« fields ») : au moins un champ affiché renseigné.
 */
export function isAnswered(item, r) {
  if (!isAnswerable(item)) return true;
  if (!r) return false;
  if (r.status === 'NA' || r.status === 'NV' || r.status === 'NO') return true;
  switch (item.kind) {
    case 'conformity': return !!r.status;
    case 'photo': return (r.mediaCount || 0) > 0;
    case 'multiselect': return Array.isArray(r.value) && r.value.length > 0;
    case 'boolean': return r.value === true || r.value === false;
    case 'number': return r.value !== '' && r.value !== null && r.value !== undefined && !isNaN(Number(String(r.value).replace(',', '.')));
    default: return !isEmptyValue(item, r.value);
  }
}

/**
 * Contrôle d'une valeur saisie (nombres du champ `input` / `kind: 'number'` et des groupes « fields ») :
 * [{level:'error'|'warning', field, message}]. Nombre illisible ⇒ erreur ; hors bornes min / max ⇒ avertissement.
 */
export function valueIssues(item, value) {
  const out = [];
  const input = itemInput(item);
  if (!input || isEmptyValue(item, value)) return out;
  const check = (spec, v, label = '') => {
    if (blank(v)) return;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    const pre = label ? `${label} : ` : '';
    if (!Number.isFinite(n)) { out.push({ level: 'error', field: spec.key || null, message: `${pre}valeur numérique invalide` }); return; }
    const lo = finite(spec.min) ? Number(spec.min) : null, hi = finite(spec.max) ? Number(spec.max) : null;
    if ((lo !== null && n < lo) || (hi !== null && n > hi)) {
      const fr = x => String(x).replace('.', ',');
      const range = lo !== null && hi !== null ? `entre ${fr(lo)} et ${fr(hi)}` : lo !== null ? `≥ ${fr(lo)}` : `≤ ${fr(hi)}`;
      out.push({ level: 'warning', field: spec.key || null, message: `${pre}valeur ${fr(n)}${spec.unit ? ' ' + spec.unit : ''} hors des bornes attendues (${range}${spec.unit ? ' ' + spec.unit : ''}) : vérifier la saisie` });
    }
  };
  if (input.type === 'number') check(input, value);
  else if (input.type === 'fields' && isPlainObject(value)) for (const f of input.fields || []) if (f.type === 'number' && fieldShown(f, value)) check(f, value[f.key], f.label || f.key);
  return out;
}
export function allowedResponses(item) {
  if (item.kind === 'conformity') return item.responses?.length ? item.responses : DEFAULT_RESPONSES;
  return item.allowNA ? ['NA'] : [];
}
/** Une justification est exigée pour cette réponse (toujours en cas de non-conformité). */
export function needsJustification(item, r) {
  if (!r?.status) return false;
  const on = item.justifyOn || ['NC'];
  return on.includes(r.status) || r.status === 'NC';
}

/** Avancement global et par section (critères visibles uniquement). */
export function progress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const sections = visibleStructure(grid, responses, ctx);
  const bySection = {};
  let total = 0, answered = 0;
  for (const s of sections) {
    const st = { total: 0, answered: 0, nc: 0, missingRequired: 0, visible: s.visible };
    for (const it of s.visibleItems) {
      if (!isAnswerable(it)) continue;
      const r = withMedia(responses[it.id], mediaCounts[it.id]);
      st.total++;
      if (isAnswered(it, r)) st.answered++;
      else if (it.required) st.missingRequired++;
      if (r?.status === 'NC') st.nc++;
    }
    bySection[s.id] = st;
    if (s.visible) { total += st.total; answered += st.answered; }
  }
  return { total, answered, percent: total ? Math.round(answered * 100 / total) : 0, bySection };
}
function withMedia(r, count) { return count ? { ...(r || {}), mediaCount: count } : r; }

/**
 * Contrôle de complétude avant clôture/signature.
 * Retourne [{level:'error'|'warning', sectionId, itemId, code, message}].
 * Les erreurs bloquent la signature ; les avertissements laissent la décision à l'auditeur.
 */
export function validateResponses(grid, responses = {}, ctx = {}, { mediaCounts = {}, deviationsByItem = {} } = {}) {
  const issues = [];
  for (const s of visibleStructure(grid, responses, ctx)) {
    if (!s.visible) continue;
    for (const it of s.visibleItems) {
      if (!isAnswerable(it)) continue;
      const r = withMedia(responses[it.id], mediaCounts[it.id]);
      const ref = { sectionId: s.id, itemId: it.id, code: it.code };
      if (it.required && !isAnswered(it, r)) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label} : réponse obligatoire manquante` });
      if (needsJustification(it, r) && !String(r.comment || '').trim()) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label} : justification obligatoire (${r.status === 'NC' ? 'non-conformité' : r.status})` });
      if (r?.status === 'NC' && it.evidenceOnNC && !(mediaCounts[it.id] > 0)) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label} : non-conformité sans photographie ni preuve jointe` });
      if (r?.status === 'NC' && !deviationsByItem[it.id]) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label} : non-conformité sans écart enregistré (à décider par l’auditeur)` });
      if (r && r.status !== 'NA') for (const v of valueIssues(it, r.value)) issues.push({ level: v.level, ...ref, sheet: it.sheet, field: v.field, message: `${it.code || ''} ${it.label} : ${v.message}` });
    }
  }
  return issues;
}

/** Une grille est-elle structurellement correcte (identifiants uniques, conditions valides, feuilles cohérentes) ? */
export function validateGrid(grid) {
  const errors = [];
  if (!grid?.name) errors.push('Nom de la grille manquant');
  const ids = new Set(), codes = new Set();
  const index = itemIndex(grid);
  const sheetNos = new Set();
  if (grid?.layout === 'sheets') {
    const compKeys = new Set(gridCompartments(grid));
    if (!(grid.sheets || []).length) errors.push('Grille en feuilles sans feuille');
    for (const sh of grid.sheets || []) {
      if (sheetNos.has(sh.no)) errors.push(`Feuille en double : ${sh.no}`); sheetNos.add(sh.no);
      if (sh.compartment && !compKeys.has(sh.compartment)) errors.push(`Feuille ${sh.no} : compartiment « ${sh.compartment} » inconnu`);
    }
  }
  for (const s of flatSections(grid)) {
    if (!s.id) errors.push(`Section « ${s.title} » sans identifiant`);
    if (ids.has(s.id)) errors.push(`Identifiant de section en double : ${s.id}`); ids.add(s.id);
    if (grid?.layout === 'sheets' && !sheetNos.has(s.sheet)) errors.push(`Section « ${s.title} » : feuille ${s.sheet} inconnue`);
    errors.push(...conditionErrors(s.condition, index, `Section « ${s.title} »`));
    for (const it of s.items || []) {
      if (!it.id) errors.push(`Critère « ${it.label} » sans identifiant`);
      if (ids.has(it.id)) errors.push(`Identifiant en double : ${it.id}`); ids.add(it.id);
      if (it.code) { if (codes.has(it.code)) errors.push(`Code de critère en double : ${it.code}`); codes.add(it.code); }
      if (!it.label) errors.push(`Critère ${it.code || it.id} sans libellé`);
      if ((it.kind === 'select' || it.kind === 'multiselect') && !(it.options || []).length && !it.optionsFrom) errors.push(`Critère ${it.code || it.id} : liste de choix vide`);
      if (it.input?.type === 'select' && !(it.input.options || []).length) errors.push(`Critère ${it.code || it.id} : liste de choix vide`);
      if (it.input?.type === 'fields') {
        if (!(it.input.fields || []).length) errors.push(`Critère ${it.code || it.id} : groupe de champs vide`);
        const keys = new Set();
        for (const f of it.input.fields || []) {
          if (!f.key || keys.has(f.key)) errors.push(`Critère ${it.code || it.id} : champ sans clé ou en double (${f.key || '?'})`); keys.add(f.key);
          if (f.type === 'choice' && !(f.options || []).length) errors.push(`Critère ${it.code || it.id} : champ « ${f.key} » sans choix`);
        }
        if (it.input.gps && !(keys.has('x') && keys.has('y'))) errors.push(`Critère ${it.code || it.id} : relevé GPS sans champs x / y`);
      }
      errors.push(...conditionErrors(it.condition, index, `Critère ${it.code || it.id}`));
    }
  }
  return errors;
}

/**
 * Grilles applicables à une prestation, de la plus spécifique à la plus générale.
 * scope de grille : {samplingTypeIds, matrixIds, providerIds, protocolDocKeys, cctpDocKeys, environments}
 */
export function rankGrids(grids, target = {}) {
  const dims = [['samplingTypeIds', 'samplingTypeId'], ['matrixIds', 'matrixId'], ['providerIds', 'providerId'], ['protocolDocKeys', 'protocolDocKey'], ['cctpDocKeys', 'cctpDocKey'], ['environments', 'environment']];
  const scored = [];
  for (const g of grids) {
    if (g.status && g.status !== 'publiee') continue;
    let score = 0, ok = true;
    for (const [gk, tk] of dims) {
      const list = g.scope?.[gk] || [];
      if (!list.length) continue;
      if (target[tk] && list.includes(target[tk])) score += 10; else { ok = false; break; }
    }
    if (ok) scored.push({ grid: g, score });
  }
  return scored.sort((a, b) => b.score - a.score || String(b.grid.version).localeCompare(String(a.grid.version), 'fr', { numeric: true })).map(x => x.grid);
}
