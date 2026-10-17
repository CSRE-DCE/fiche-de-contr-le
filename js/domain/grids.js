/* Grilles d'audit dynamiques : logique conditionnelle, avancement, contrôle de complétude.
 * Fichier pur (testé dans le navigateur, sans IndexedDB).
 *
 * Une grille : {id, code, name, version, status, scope, settings, sections:[{id, title, domain, module,
 *   phase, help, condition, subsections?, items:[item]}]}
 * Un critère (item) : {id, code, label, help, kind, responses, options, unit, min, max, required,
 *   justifyOn:['NC'], evidenceOnNC, refs:[{docKey, docType, article, paragraph, requirement}],
 *   condition, alerts:[{op, value, level, message, field?}], compareTo, delayFrom, maxHours,
 *   input?, prefill?, short?, no?, icon?, domain?, scope?, suggest?, labelTemplate?}
 * Une condition : {item:'CODE'|id, field?, op, value} | {ctx:'matrixCode'|'auditType'|'compartments'|…, op, value}
 *   | {all:[…]} | {any:[…]} | {not:…}. `field` : champ d'une valeur objet (« fields ») du critère.
 *
 * Grille « en feuilles » (`layout: 'sheets'`, ex. grid-ct-2026.js) : en plus, `types` (types de tournée),
 * `compartments` [{key, label, icon, always?}], `sheets` [{no, key, tab, title, theme, compartment, compartments?,
 * scope, layout, blocks, modules, variants?}] et `section.sheet` (n° de feuille). Le contexte des conditions est
 * complété par withCompartments() : type de tournée (`ctx.auditType`, défaut : premier type de la grille) et
 * compartiments retenus (`ctx.compartments`, défaut : ceux du type de tournée, sinon tous).
 *
 * Tournée (avenant n° 1, § C) : un audit compte une ou plusieurs stations (`audit.stations`). La grille EFFECTIVE
 * (expandGrid) duplique chaque section des feuilles `scope: 'station'` pour chaque station (`id@clé`) ; les critères
 * `scope: 'tournee'` d'une feuille station gardent leur identifiant (`shared: true`, une seule réponse) et ne sont
 * comptés qu'UNE fois (allItems, progress, validateResponses, synthèse, comparaison).
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
      if (!sec.station && parent?.station) sec.station = parent.station;
      out.push(sec); walk(s.subsections, sec, depth + 1);
    }
  };
  walk(grid?.sections);
  return out;
}
/** Domaine d'un critère : celui du critère s'il est précisé (ex. ligne « Transport » d'une feuille), sinon celui de la section. */
const itemDomain = (it, s) => it.domain || s.domain || 'prelevement';
/**
 * Tous les critères, dans l'ordre d'affichage. Grille effective d'une tournée : un critère partagé
 * (`shared`, présent dans chaque copie de section) n'est listé qu'une fois (première station).
 */
export function allItems(grid) {
  const out = [];
  const seen = new Set();
  for (const s of flatSections(grid)) for (const it of s.items || []) {
    if (it.shared) { if (seen.has(it.id)) continue; seen.add(it.id); }
    const x = { ...it, sectionId: s.id, sectionTitle: s.title, domain: itemDomain(it, s) };
    if (s.sheet !== undefined) x.sheet = s.sheet;
    out.push(x);
  }
  return out;
}
export function itemIndex(grid) {
  const m = new Map();
  for (const it of allItems(grid)) { m.set(it.id, it); if (it.code && !m.has(it.code)) m.set(it.code, it); }
  return m;
}

/** Valeur d'un critère utilisée par les conditions et règles. */
export function responseValue(item, r) {
  if (!r) return undefined;
  if (item?.kind === 'conformity') return r.status;
  if (r.status === 'NA') return 'NA';
  return r.value;
}
/** Valeur d'un champ (`field`) de la valeur objet d'un critère ; undefined si N/A ou si le champ est masqué (showIf). */
export function fieldValue(item, r, field) {
  if (!r || r.status === 'NA' || !isPlainObject(r.value)) return undefined;
  const spec = (itemInput(item)?.fields || []).find(f => f.key === field);
  if (spec && !fieldShown(spec, r.value)) return undefined;
  return r.value[field];
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
 * `ctx` : contexte de l'audit (type de tournée, compartiments, matrice, type de prélèvement…).
 * Condition sur un champ d'objet : {item, field, op, value} (champ masqué par showIf ⇒ non renseigné).
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
    const r = responses?.[item.id];
    return compare(cond.op || 'eq', cond.field ? fieldValue(item, r, cond.field) : responseValue(item, r), cond.value);
  }
  return true;
}

/** Une condition est-elle valide (critères et champs référencés existants, opérateur connu) ? */
export function conditionErrors(cond, index, path = 'condition') {
  if (!cond) return [];
  if (Array.isArray(cond)) return cond.flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.all || cond.any) return (cond.all || cond.any).flatMap((c, i) => conditionErrors(c, index, `${path}[${i}]`));
  if (cond.not) return conditionErrors(cond.not, index, path + '.not');
  const errs = [];
  if (cond.op && !OPERATORS[cond.op]) errs.push(`${path} : opérateur inconnu « ${cond.op} »`);
  if (cond.item && !index.get(cond.item)) errs.push(`${path} : critère « ${cond.item} » introuvable`);
  if (cond.item && cond.field && index.get(cond.item) && !(itemInput(index.get(cond.item))?.fields || []).some(f => f.key === cond.field)) errs.push(`${path} : champ « ${cond.field} » absent du critère « ${cond.item} »`);
  if (!cond.item && !cond.ctx) errs.push(`${path} : condition sans critère ni contexte`);
  return errs;
}

/**
 * Structure visible de la grille pour un audit : les sections/critères dont la condition n'est pas
 * remplie sont masqués (et exclus de l'avancement et des contrôles de complétude). Section d'une station
 * (grille effective) : la matrice de la station (`station.matrixCode`) prime sur celle du contexte.
 */
export function visibleStructure(grid, responses = {}, ctx = {}) {
  const index = itemIndex(grid);
  ctx = withCompartments(grid, ctx);
  const out = [];
  const walk = (secs, parentVisible = true, depth = 0, parentSheet = undefined, parentStation = null) => {
    for (const s of secs || []) {
      const sheet = s.sheet !== undefined ? s.sheet : parentSheet;
      const station = s.station || parentStation;
      const sctx = station?.matrixCode ? { ...ctx, matrixCode: station.matrixCode } : ctx;
      const visible = parentVisible && evalCondition(s.condition, responses, index, sctx);
      const items = (s.items || []).map(it => {
        const x = { ...it, sectionId: s.id, domain: itemDomain(it, s), visible: visible && evalCondition(it.condition, responses, index, sctx) };
        if (sheet !== undefined) x.sheet = sheet;
        return x;
      });
      const sec = { ...s, depth, visible, items, visibleItems: items.filter(i => i.visible) };
      if (sheet !== undefined) sec.sheet = sheet;
      if (station) sec.station = station;
      out.push(sec);
      walk(s.subsections, visible, depth + 1, sheet, station);
    }
  };
  walk(grid?.sections);
  return out;
}
/**
 * Critères visibles, chacun une seule fois (un critère partagé n'est retenu qu'à sa première occurrence),
 * accompagnés de leur section visible : [{item, section}].
 */
export function visibleItems(grid, responses = {}, ctx = {}, structure = null) {
  const out = [];
  const seen = new Set();
  for (const s of structure || visibleStructure(grid, responses, ctx)) {
    if (!s.visible) continue;
    for (const it of s.visibleItems) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ item: it, section: s });
    }
  }
  return out;
}

/* ---------- Types de tournée (grilles à `types`, ex. CT-2026) ---------- */
export function gridTypes(grid) { return Array.isArray(grid?.types) ? grid.types : []; }
export function gridType(grid, key) { return gridTypes(grid).find(t => t.key === key) || null; }
/** Type par défaut (premier type de la grille : la biologie pour CT-2026) ou ''. */
export function defaultAuditType(grid) { return gridTypes(grid)[0]?.key || ''; }
/** Compartiments retenus pour un type de tournée : ceux marqués `always` + ceux du type, dans l'ordre de la grille. */
export function typeCompartments(grid, auditType) {
  const t = gridType(grid, auditType);
  return t ? normalizeCompartments(grid, t.compartments.length ? t.compartments : ['organisation']) : normalizeCompartments(grid, null);
}
/**
 * Compartiments d'une tournée : choix `wanted` limité aux compartiments du type (biologie : cases cochées ;
 * cours d'eau : organisation + physico ; eaux souterraines : organisation + eso). Choix vide ⇒ ceux du type.
 */
export function auditCompartments(grid, auditType, wanted = null) {
  const t = gridType(grid, auditType);
  if (!t) return normalizeCompartments(grid, wanted);
  const list = (Array.isArray(wanted) ? wanted : []).filter(k => t.compartments.includes(k));
  return normalizeCompartments(grid, list.length ? list : t.compartments);
}
/**
 * Type de tournée déduit d'une prestation ou d'une station (création depuis le planning ou la fiche station) :
 * prestation.auditType, programme biologique / type HYDROBIO ⇒ bio, matrice ESO / code BSS ⇒ eso, sinon les
 * types de la station (site.types) ou ce.
 */
export function inferAuditType(grid, { site = null, prestation = null } = {}) {
  const types = gridTypes(grid);
  if (!types.length) return '';
  const has = k => types.some(t => t.key === k);
  if (prestation?.auditType && has(prestation.auditType)) return prestation.auditType;
  const mx = String(prestation?.matrixId || site?.matrixId || '').replace(/^mat-/, '');
  if (has('bio') && (prestation?.samplingTypeId === 'stype-HYDROBIO' || prestation?.source?.kind === 'programme-bio-2026')) return 'bio';
  if (has('eso') && (mx === 'ESO' || site?.codeType === 'BSS' || prestation?.samplingTypeId === 'stype-ESO')) return 'eso';
  const st = (site?.types || []).filter(has);
  if (prestation && st.includes('ce')) return 'ce';
  if (st.length) return st[0];
  if (has('ce') && prestation) return 'ce';
  return defaultAuditType(grid);
}
/** Type de tournée correspondant au mieux à une liste de compartiments (contexte sans `auditType`). */
function typeFromCompartments(grid, list) {
  const wanted = (list || []).filter(k => !(grid.compartments || []).find(c => c.key === k)?.always);
  if (!wanted.length) return defaultAuditType(grid);
  return (gridTypes(grid).find(t => wanted.every(k => t.compartments.includes(k))) || gridTypes(grid)[0]).key;
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
/**
 * Contexte complété (grilles à compartiments) : compartiments retenus et, pour une grille à types de tournée,
 * `auditType` (déduit des compartiments, sinon premier type) ; compartiments absents ⇒ ceux du type.
 */
export function withCompartments(grid, ctx = {}) {
  if (!grid?.compartments?.length) return ctx || {};
  const c = { ...(ctx || {}) };
  const given = Array.isArray(c.compartments) && c.compartments.length ? c.compartments : null;
  if (gridTypes(grid).length) {
    if (!c.auditType || !gridType(grid, c.auditType)) c.auditType = given ? typeFromCompartments(grid, given) : defaultAuditType(grid);
    c.compartments = given ? normalizeCompartments(grid, given) : typeCompartments(grid, c.auditType);
  } else c.compartments = normalizeCompartments(grid, given);
  return c;
}

/* ---------- En-tête des feuilles ---------- */
const fillTemplate = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? '');
/** Nom du prestataire dans les en-têtes : « OEG en régie » pour une régie, sinon la raison sociale. */
export function providerHeaderName(provider) {
  if (!provider) return '';
  if (typeof provider === 'string') return provider;
  return provider.kind === 'regie' && provider.code ? `${provider.code} en régie` : provider.name || provider.code || '';
}
/**
 * Titre d'en-tête des feuilles : « Contrôle terrain prestataire – {prestataire} – {programme} » ; programme =
 * libellé de la campagne si présent, sinon `types[].program`. Les éléments vides sont omis.
 * Ex. biologie : « Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026 ».
 */
export function headerTitle(grid, { provider = null, auditType = '', campaign = null } = {}) {
  const tpl = grid?.header?.title || '';
  if (!tpl.includes('{')) return tpl;
  const type = gridType(grid, auditType || defaultAuditType(grid));
  const programme = (typeof campaign === 'string' ? campaign : campaign?.label) || type?.program || '';
  return tpl.split(' – ').map(part => fillTemplate(part, { prestataire: providerHeaderName(provider), programme }).trim()).filter(Boolean).join(' – ');
}
/** En-tête résolu pour une tournée : {org, title, subtitle, tagline, program, slogan, website, typeLabel}. */
export function headerOf(grid, opts = {}) {
  const type = gridType(grid, opts.auditType || defaultAuditType(grid));
  return { ...(grid?.header || {}), title: headerTitle(grid, opts), subtitle: type?.subtitle || grid?.header?.subtitle || '', program: type?.kicker || grid?.header?.program || '', typeLabel: type?.label || '' };
}

/* ---------- Feuilles (grilles `layout: 'sheets'`) ---------- */
export const isSheetGrid = grid => grid?.layout === 'sheets' && Array.isArray(grid?.sheets) && grid.sheets.length > 0;
export function sheetOf(grid, no) { return (grid?.sheets || []).find(s => String(s.no) === String(no)) || null; }
/** Tous les critères d'une feuille (sans tenir compte des conditions d'affichage). */
export function itemsOfSheet(grid, no) { return allItems(grid).filter(it => String(it.sheet) === String(no)); }
/** Feuille contenant un critère (n°) ou null. */
export function sheetOfItem(grid, itemId) { return allItems(grid).find(it => it.id === itemId || it.code === itemId)?.sheet ?? null; }
/** Compartiments d'une feuille (`compartments`, sinon `compartment`) : la feuille est affichée si l'un est retenu. */
export function sheetCompartments(sheet) { return Array.isArray(sheet?.compartments) && sheet.compartments.length ? sheet.compartments : sheet?.compartment ? [sheet.compartment] : []; }
export const isTourneeSheet = sheet => sheet?.scope === 'tournee';
/** Encadrés d'une feuille pour un type de tournée (`showFor`). */
export function sheetBlocks(sheet, auditType = '') { return (sheet?.blocks || []).filter(b => !b.showFor || !auditType || b.showFor.includes(auditType)); }
/** Feuille résolue pour un type de tournée : variantes (titre, onglet, surtitre, appareils…) et encadrés filtrés. */
export function resolveSheet(sheet, auditType = '') {
  const out = { ...sheet, ...(sheet?.variants?.[auditType] || {}) };
  out.blocks = sheetBlocks(sheet, auditType);
  return out;
}
/**
 * Clé de stockage des données d'une feuille (audit.sheets[clé]) : `instanceKey` de la feuille, sauf pour les
 * données de TOURNÉE d'une feuille station (`sheet.tourneeData`, ex. 'instruments' de F4) : String(no).
 */
export function sheetStoreKey(sheet, dataKey = '') { return (sheet?.tourneeData || []).includes(dataKey) ? String(sheet.no) : sheet?.instanceKey || String(sheet?.no); }

/* ---------- Tournée : stations et grille effective ---------- */
/** Clé d'une station dans la tournée : identifiant du site sans le préfixe `site-` (= code de la station). */
export const stationKeyOf = siteId => String(siteId || '').replace(/^site-/, '');
/** 'it-F4-5@09271503' → {baseId: 'it-F4-5', stationKey: '09271503'} ; sans station : stationKey null. */
export function parseItemId(id) {
  const s = String(id ?? ''), i = s.lastIndexOf('@');
  return i < 0 ? { baseId: s, stationKey: null } : { baseId: s.slice(0, i), stationKey: s.slice(i + 1) };
}
/** Entrée de `audit.stations` : {key, siteId, pointId, prestationId, addedAt}. */
export function makeStation({ siteId, pointId = null, prestationId = null } = {}, addedAt = '') {
  return { key: stationKeyOf(siteId), siteId, pointId: pointId || null, prestationId: prestationId || null, addedAt };
}
const siteFrom = (sites, id) => !sites ? null : typeof sites === 'function' ? sites(id) : sites instanceof Map ? sites.get(id) : Array.isArray(sites) ? sites.find(s => s?.id === id) : sites[id];

/**
 * Grille EFFECTIVE d'une tournée (fonction pure). Chaque section d'une feuille `scope: 'station'` est dupliquée
 * pour chaque station (`id: sec.id + '@' + clé`, `baseId`, `station: {key, index, siteId, name, code, matrixCode}`) ;
 * ses critères sont suffixés (`id: it.id + '@' + clé`, `code: it.code + '·S' + (index + 1)`, `baseId`, `baseCode`,
 * `station`), leurs conditions visant un critère de la même feuille station sont réécrites pour la station.
 * Les critères `scope: 'tournee'` gardent leur identifiant et sont marqués `shared: true`. Les feuilles tournée ne
 * sont pas dupliquées. Ordre des sections : station par station, feuilles dans l'ordre de `sheets` (feuilles tournée
 * à leur première occurrence). Sans station (ou grille non « en feuilles ») : grille inchangée.
 * stations : [{key?, siteId, pointId?, prestationId?}] ; sites : {id: site} | Map | [site] | (id) => site ;
 * provider : complète les libellés `labelTemplate` ({prestataire}).
 */
export function expandGrid(grid, stations = [], sites = null, { provider = null } = {}) {
  if (!isSheetGrid(grid) || !Array.isArray(stations) || !stations.length) return grid;
  const list = stations.map((s, index) => {
    const site = siteFrom(sites, s.siteId);
    const key = s.key || stationKeyOf(s.siteId);
    return { key, index, siteId: s.siteId, name: site?.name || s.name || key, code: site?.code || key, matrixCode: String(site?.matrixId || '').replace(/^mat-/, '') };
  });
  const scopeOf = new Map(grid.sheets.map(sh => [String(sh.no), sh.scope || 'station']));
  const isStationSec = s => scopeOf.get(String(s.sheet)) === 'station';
  const vars = { prestataire: providerHeaderName(provider) || 'du prestataire' };
  const label = it => it.labelTemplate && provider ? fillTemplate(it.labelTemplate, vars) : it.label;
  // Critères propres aux stations (pour la réécriture des conditions) : identifiant et code d'origine.
  const ownIds = new Set(), ownCodes = new Set();
  const walkOwn = secs => { for (const s of secs || []) { for (const it of s.items || []) if (it.scope !== 'tournee') { ownIds.add(it.id); if (it.code) ownCodes.add(it.code); } walkOwn(s.subsections); } };
  walkOwn(grid.sections.filter(isStationSec));
  const rewrite = (cond, st) => {
    if (!cond) return cond;
    if (Array.isArray(cond)) return cond.map(c => rewrite(c, st));
    if (cond.all) return { ...cond, all: cond.all.map(c => rewrite(c, st)) };
    if (cond.any) return { ...cond, any: cond.any.map(c => rewrite(c, st)) };
    if (cond.not) return { ...cond, not: rewrite(cond.not, st) };
    if (cond.item && ownIds.has(cond.item)) return { ...cond, item: `${cond.item}@${st.key}` };
    if (cond.item && ownCodes.has(cond.item)) return { ...cond, item: `${cond.item}·S${st.index + 1}` };
    return cond;
  };
  const ref = st => ({ key: st.key, index: st.index, siteId: st.siteId, name: st.name, code: st.code, matrixCode: st.matrixCode });
  const copy = (sec, st) => ({
    ...sec, id: `${sec.id}@${st.key}`, baseId: sec.id, station: ref(st), condition: rewrite(sec.condition, st),
    items: (sec.items || []).map(it => it.scope === 'tournee'
      ? { ...it, label: label(it), shared: true }
      : { ...it, id: `${it.id}@${st.key}`, code: it.code ? `${it.code}·S${st.index + 1}` : it.code, baseId: it.id, baseCode: it.code ?? null, label: label(it), station: ref(st), condition: rewrite(it.condition, st) }),
    ...(sec.subsections ? { subsections: sec.subsections.map(x => copy(x, st)) } : {})
  });
  const plain = sec => ({ ...sec, items: (sec.items || []).map(it => it.labelTemplate && provider ? { ...it, label: label(it) } : it) });
  const bySheet = new Map();
  for (const sec of grid.sections || []) { const k = String(sec.sheet); if (!bySheet.has(k)) bySheet.set(k, []); bySheet.get(k).push(sec); }
  const sections = [];
  const done = new Set();
  for (const st of list) for (const sh of grid.sheets) {
    const k = String(sh.no), secs = bySheet.get(k) || [];
    if ((sh.scope || 'station') === 'tournee') { if (!done.has(k)) { done.add(k); sections.push(...secs.map(plain)); } }
    else sections.push(...secs.map(s => copy(s, st)));
  }
  for (const [k, secs] of bySheet) if (!scopeOf.has(k)) sections.push(...secs.map(plain));
  return { ...grid, sections, stations: list.map(ref), expanded: true };
}

/**
 * Instances de feuilles VISIBLES pour un audit (grille effective ou non) :
 * [{...feuille résolue (variantes, encadrés), instanceKey, station|null, stationKey, index, total, sections, items, shared}]
 * - instanceKey = String(no) (feuille tournée, ou grille sans station) ou `${no}@${clé}` (feuille station) ;
 * - index = rang AFFICHÉ « Feuille X / N » parmi les feuilles visibles (biologie complète : 1 à 9), total = N ;
 * - sections : sections visibles (items = critères visibles, critères partagés compris) ; items : à plat ;
 *   shared : nombre de critères partagés (« Commun à la tournée ») affichés dans l'instance.
 * Ordre : station par station (feuilles dans l'ordre de `sheets`), une feuille tournée à sa première occurrence.
 */
export function sheetsOf(grid, responses = {}, ctx = {}) {
  if (!isSheetGrid(grid)) return [];
  const c = withCompartments(grid, ctx);
  const active = new Set(c.compartments || []);
  const structure = visibleStructure(grid, responses, c);
  const defs = grid.sheets.filter(sh => { const keys = sheetCompartments(sh); return !keys.length || !grid.compartments?.length || keys.some(k => active.has(k)); })
    .map(sh => resolveSheet(sh, c.auditType || ''));
  const stations = grid.expanded && grid.stations?.length ? grid.stations : null;
  const make = (def, st) => {
    const own = structure.filter(s => String(s.sheet) === String(def.no) && (st ? s.station?.key === st.key : !s.station));
    const sections = own.filter(s => s.visible).map(s => ({ ...s, items: s.visibleItems }));
    if (own.length && !sections.length) return null;
    const items = sections.flatMap(s => s.items);
    return { ...def, instanceKey: st ? `${def.no}@${st.key}` : String(def.no), station: st || null, stationKey: st?.key || null, sections, items, shared: items.filter(i => i.shared).length };
  };
  const out = [];
  const emitted = new Set();
  for (const st of stations || [null]) for (const def of defs) {
    if (stations && isTourneeSheet(def)) {
      if (emitted.has(String(def.no))) continue;
      emitted.add(String(def.no));
      const x = make(def, null); if (x) out.push(x);
    } else { const x = make(def, stations ? st : null); if (x) out.push(x); }
  }
  const shown = defs.filter(d => out.some(x => x.no === d.no)).map(d => d.no);
  for (const x of out) { x.index = shown.indexOf(x.no) + 1; x.total = shown.length; }
  return out;
}
/** Regroupe des instances de feuilles : {tournee: [feuilles tournée], stations: [{station, sheets}]} (PDF, onglets). */
export function groupSheets(instances = []) {
  const stations = [];
  for (const sh of instances) {
    if (!sh.station) continue;
    let g = stations.find(x => x.station.key === sh.station.key);
    if (!g) stations.push(g = { station: sh.station, sheets: [] });
    g.sheets.push(sh);
  }
  return { tournee: instances.filter(sh => !sh.station), stations };
}

const emptyProgress = () => ({ total: 0, answered: 0, nc: 0, p: 0, missingRequired: 0, percent: 0 });
function tally(st, it, r) {
  if (!isAnswerable(it)) return;
  st.total++;
  if (isAnswered(it, r)) st.answered++;
  else if (it.required) st.missingRequired++;
  if (r?.status === 'NC') st.nc++;
  if (r?.status === 'P') st.p++;
}
const percentOf = st => { st.percent = st.total ? Math.round(st.answered * 100 / st.total) : 0; return st; };

/**
 * Avancement par instance de feuille visible, indexé par `instanceKey` :
 * {[instanceKey]: {no, instanceKey, stationKey, total, answered, nc, p, missingRequired, percent, shared}}.
 * Les critères partagés affichés dans la feuille sont comptés dans chaque instance (avancement de l'onglet) ;
 * l'avancement GLOBAL (progress) les compte une seule fois.
 */
export function sheetProgress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const out = {};
  for (const sh of sheetsOf(grid, responses, ctx)) {
    const st = { no: sh.no, instanceKey: sh.instanceKey, stationKey: sh.stationKey, ...emptyProgress(), shared: sh.shared };
    for (const it of sh.items) tally(st, it, withMedia(responses[it.id], mediaCounts[it.id]));
    out[sh.instanceKey] = percentOf(st);
  }
  return out;
}
/**
 * Avancement par station d'une tournée : {tournee: {…}, stations: {[clé]: {…}}} — `tournee` = feuilles tournée et
 * critères partagés, chaque station = ses critères propres. Chaque critère visible est compté une fois.
 */
export function stationProgress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const tournee = emptyProgress();
  const stations = {};
  for (const st of grid?.stations || []) stations[st.key] = emptyProgress();
  for (const { item } of visibleItems(grid, responses, withCompartments(grid, ctx))) {
    const k = !item.shared && item.station?.key;
    const bucket = k ? (stations[k] = stations[k] || emptyProgress()) : tournee;
    tally(bucket, item, withMedia(responses[item.id], mediaCounts[item.id]));
  }
  percentOf(tournee);
  for (const k of Object.keys(stations)) percentOf(stations[k]);
  return { tournee, stations };
}

/** En-têtes de colonnes d'un tableau de feuille (valeurs de la maquette, surchargées par `section.headers`). */
export const SHEET_HEADERS = { no: 'N°', label: 'Point de contrôle', short: 'Référence courte', value: 'Valeur / réponse', c: 'C', p: 'P', nc: 'NC', na: 'N/A', obs: 'Observations' };
export function sectionHeaders(section) { return { ...SHEET_HEADERS, ...(section?.headers || {}) }; }

/* ---------- Pré-remplissage à la création de l'audit (ou à l'ajout d'une station) ---------- */
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const operatorName = o => typeof o === 'string' ? o : ([o?.firstName, o?.lastName].filter(Boolean).join(' ') || o?.code || o?.name || '');
/** Valeur d'une source de pré-remplissage (`item.prefill`, voir PREFILL_SOURCES de model.js). */
export function prefillValue(source, { site = null, auditor = null, provider = null, prestation = null, operators = [], date = '', time = '', kind = '', stationCount = null } = {}) {
  switch (source) {
    case 'site.name': return site?.name ? String(site.name).toLocaleUpperCase('fr-FR') : '';
    case 'site.code': case 'site.bassin': case 'site.riverName': case 'site.commune': case 'site.her': case 'site.pressions': case 'site.strahler':
      return site?.[source.slice(5)] ?? '';
    case 'site.xy': return finite(site?.x) && finite(site?.y) ? { x: Number(site.x), y: Number(site.y) } : null;
    case 'audit.date': return date || '';
    case 'audit.time': return time ? String(time).slice(0, 5) : '';
    case 'audit.kind': return kind === 'inopine' ? 'Inopiné' : kind ? 'Avec rendez-vous' : '';
    case 'tournee.stationCount': return finite(stationCount) ? Number(stationCount) : '';
    case 'auditor.name': return typeof auditor === 'string' ? auditor : auditor?.name || '';
    case 'provider.name': return typeof provider === 'string' ? provider : provider?.name || '';
    case 'prestation.operators': return (operators || []).map(operatorName).filter(Boolean).join(', ') || prestation?.team || '';
    default: return '';
  }
}
/**
 * Réponses pré-remplies (fonction pure) : {[itemId]: {value, prefilled: true}} pour les critères VISIBLES portant
 * `prefill` (valeur sans statut ; l'auditeur reste maître du constat). Un critère partagé n'est pré-rempli qu'une fois.
 * p : {site, auditor, provider, prestation, operators, date, time, kind, stationCount, compartments?, auditType?,
 *      stations?: [{key, site, prestation, date?, time?}] (valeurs propres à chaque station de la grille effective),
 *      onlyStation?: clé (ajout d'une station : critères propres à cette station seulement), at?, by?, byName?}
 */
export function prefillResponses(grid, p = {}) {
  const out = {};
  const ctx = withCompartments(grid, { compartments: p.compartments, auditType: p.auditType });
  const byKey = new Map((p.stations || []).filter(s => s?.key).map(s => [s.key, s]));
  for (const s of visibleStructure(grid, {}, ctx)) {
    if (!s.visible) continue;
    if (p.onlyStation && s.station?.key !== p.onlyStation) continue;
    const sp = s.station && byKey.has(s.station.key) ? { ...p, ...byKey.get(s.station.key) } : p;
    for (const it of s.items) {
      if (!it.prefill || !it.visible || out[it.id] || (p.onlyStation && it.shared)) continue;
      let v = prefillValue(it.prefill, sp);
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

/* ---------- Saisies d'une station (retrait d'une station de la tournée) ---------- */
const filled = v => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length) && !(isPlainObject(v) && !Object.values(v).some(filled));
/** Une réponse contient-elle une saisie de l'auditeur (statut, observation, ou valeur non pré-remplie) ? */
export function isEnteredResponse(r) { return !!r && (!!r.status || filled(r.comment) || (!r.prefilled && filled(r.value))); }
/** Saisies propres à une station : {responses: [itemId], sheets: [instanceKey]} (pré-remplissages exclus). */
export function stationEntries(audit, key) {
  const suffix = '@' + key;
  return {
    responses: Object.entries(audit?.responses || {}).filter(([id, r]) => id.endsWith(suffix) && isEnteredResponse(r)).map(([id]) => id),
    sheets: Object.entries(audit?.sheets || {}).filter(([k, v]) => String(k).endsWith(suffix) && filled(v)).map(([k]) => k)
  };
}

/* ---------- Valeurs proposées (jamais appliquées seules) ---------- */
const minutesOf = v => { const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Durée lisible entre deux heures « HH:MM » (« 7 h 30 ») ou ''. */
export function durationText(from, to) {
  const a = minutesOf(from), b = minutesOf(to);
  if (a === null || b === null) return '';
  const d = b >= a ? b - a : b + 1440 - a;
  return `${Math.floor(d / 60)} h ${String(d % 60).padStart(2, '0')}`;
}
/** Valeur proposée pour un critère portant `suggest` (ex. amplitude horaire = 5.2 → 5.3), '' si incalculable. */
export function suggestedValue(item, responses = {}) {
  const s = item?.suggest;
  if (s?.type === 'duration') return durationText(responses[s.from]?.value, responses[s.to]?.value);
  return '';
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
/** Une justification est exigée pour cette réponse (toujours en cas de non-conformité ; P pour CT-2026). */
export function needsJustification(item, r) {
  if (!r?.status) return false;
  const on = item.justifyOn || ['NC'];
  return on.includes(r.status) || r.status === 'NC';
}

/**
 * Avancement global et par section (critères visibles uniquement). Global : chaque critère compté une fois
 * (critère partagé d'une tournée : une seule fois) ; par section : critères affichés dans la section.
 */
export function progress(grid, responses = {}, ctx = {}, mediaCounts = {}) {
  const sections = visibleStructure(grid, responses, ctx);
  const bySection = {};
  for (const s of sections) {
    const st = { total: 0, answered: 0, nc: 0, p: 0, missingRequired: 0, visible: s.visible };
    for (const it of s.visibleItems) tally(st, it, withMedia(responses[it.id], mediaCounts[it.id]));
    bySection[s.id] = st;
  }
  let total = 0, answered = 0;
  for (const { item } of visibleItems(grid, responses, ctx, sections)) {
    if (!isAnswerable(item)) continue;
    total++;
    if (isAnswered(item, withMedia(responses[item.id], mediaCounts[item.id]))) answered++;
  }
  return { total, answered, percent: total ? Math.round(answered * 100 / total) : 0, bySection };
}
function withMedia(r, count) { return count ? { ...(r || {}), mediaCount: count } : r; }

/**
 * Contrôle de complétude avant clôture/signature (chaque critère visible une fois).
 * Retourne [{level:'error'|'warning', sectionId, itemId, code, sheet, stationKey, message}].
 * Les erreurs bloquent la signature ; les avertissements laissent la décision à l'auditeur.
 */
export function validateResponses(grid, responses = {}, ctx = {}, { mediaCounts = {}, deviationsByItem = {} } = {}) {
  const issues = [];
  for (const { item: it, section: s } of visibleItems(grid, responses, ctx)) {
    if (!isAnswerable(it)) continue;
    const r = withMedia(responses[it.id], mediaCounts[it.id]);
    const ref = { sectionId: s.id, itemId: it.id, code: it.code, sheet: it.sheet, stationKey: it.shared ? null : it.station?.key || null };
    const at = it.station && !it.shared ? ` (station ${it.station.name})` : '';
    if (it.required && !isAnswered(it, r)) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label}${at} : réponse obligatoire manquante` });
    if (needsJustification(it, r) && !String(r.comment || '').trim()) issues.push({ level: 'error', ...ref, message: `${it.code || ''} ${it.label}${at} : justification obligatoire (${r.status === 'NC' ? 'non-conformité' : r.status === 'P' ? 'point perfectible' : r.status})` });
    if (r?.status === 'NC' && it.evidenceOnNC && !(mediaCounts[it.id] > 0)) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label}${at} : non-conformité sans photographie ni preuve jointe` });
    if (r?.status === 'NC' && !deviationsByItem[it.id]) issues.push({ level: 'warning', ...ref, message: `${it.code || ''} ${it.label}${at} : non-conformité sans écart enregistré (à décider par l’auditeur)` });
    if (r && r.status !== 'NA') for (const v of valueIssues(it, r.value)) issues.push({ level: v.level, ...ref, field: v.field, message: `${it.code || ''} ${it.label}${at} : ${v.message}` });
  }
  return issues;
}

/** Une grille est-elle structurellement correcte (identifiants uniques, conditions valides, feuilles et types cohérents) ? */
export function validateGrid(grid) {
  const errors = [];
  if (!grid?.name) errors.push('Nom de la grille manquant');
  const ids = new Set(), codes = new Set();
  const index = itemIndex(grid);
  const sheetNos = new Set();
  const typeKeys = new Set(gridTypes(grid).map(t => t.key));
  if (grid?.layout === 'sheets') {
    const compKeys = new Set(gridCompartments(grid));
    if (!(grid.sheets || []).length) errors.push('Grille en feuilles sans feuille');
    for (const t of gridTypes(grid)) for (const k of t.compartments || []) if (!compKeys.has(k)) errors.push(`Type de tournée ${t.key} : compartiment « ${k} » inconnu`);
    for (const sh of grid.sheets || []) {
      if (sheetNos.has(sh.no)) errors.push(`Feuille en double : ${sh.no}`); sheetNos.add(sh.no);
      for (const k of sheetCompartments(sh)) if (compKeys.size && !compKeys.has(k)) errors.push(`Feuille ${sh.no} : compartiment « ${k} » inconnu`);
      if (sh.scope && !['tournee', 'station'].includes(sh.scope)) errors.push(`Feuille ${sh.no} : portée « ${sh.scope} » inconnue`);
      for (const b of sh.blocks || []) for (const t of b.showFor || []) if (!typeKeys.has(t)) errors.push(`Feuille ${sh.no} : encadré « ${b.key} » pour un type de tournée inconnu (${t})`);
      for (const t of Object.keys(sh.variants || {})) if (!typeKeys.has(t)) errors.push(`Feuille ${sh.no} : variante pour un type de tournée inconnu (${t})`);
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
      if (it.scope && !['tournee', 'station'].includes(it.scope)) errors.push(`Critère ${it.code || it.id} : portée « ${it.scope} » inconnue`);
      if ((it.kind === 'select' || it.kind === 'multiselect') && !(it.options || []).length && !it.optionsFrom) errors.push(`Critère ${it.code || it.id} : liste de choix vide`);
      if (it.input?.type === 'select' && !(it.input.options || []).length) errors.push(`Critère ${it.code || it.id} : liste de choix vide`);
      const input = itemInput(it);
      if (input?.type === 'fields') {
        if (!(input.fields || []).length) errors.push(`Critère ${it.code || it.id} : groupe de champs vide`);
        const keys = new Set();
        for (const f of input.fields || []) {
          if (!f.key || keys.has(f.key)) errors.push(`Critère ${it.code || it.id} : champ sans clé ou en double (${f.key || '?'})`); keys.add(f.key);
          if (f.type === 'choice' && !(f.options || []).length) errors.push(`Critère ${it.code || it.id} : champ « ${f.key} » sans choix`);
        }
        for (const f of input.fields || []) for (const c of [].concat(f.showIf || [])) if (!keys.has(c.key)) errors.push(`Critère ${it.code || it.id} : condition d’affichage du champ « ${f.key} » sur un champ inconnu (${c.key})`);
        if (input.gps && !(keys.has('x') && keys.has('y'))) errors.push(`Critère ${it.code || it.id} : relevé GPS sans champs x / y`);
      }
      errors.push(...conditionErrors(it.condition, index, `Critère ${it.code || it.id}`));
    }
  }
  return errors;
}

/* ---------- Mise à niveau des grilles par défaut (diffusion d'une nouvelle version avec l'application) ---------- */
/** Compare deux numéros de version (« 1.10 » > « 1.9 » > « 1.0 ») : négatif, 0 ou positif. */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split(/[.\-]/), pb = String(b ?? '').split(/[.\-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    const d = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : String(x).localeCompare(String(y), 'fr', { numeric: true });
    if (d) return d;
  }
  return 0;
}
/** Turbidité exprimée en NTU (demande de l'OEG ; unité des CCTP 2026, paramètre SANDRE 1295) : anciens symboles remplacés. */
export const UNIT_REPLACEMENTS = Object.freeze({ FNU: 'NTU', NFU: 'NTU' });
/**
 * Copie d'une grille où chaque propriété `unit` (critère, `input`, champs `fields`, modules…) égale à un ancien symbole
 * est remplacée : { grid, count }. Ne touche ni `unitKey` (unité choisie à la saisie), ni les libellés, ni les réponses ;
 * aucune conversion numérique. Pure, déterministe et idempotente ; sans remplacement, la grille reçue est rendue telle
 * quelle (même objet). Jamais appliquée à l'instantané d'une tournée existante (gridSnapshot, contenu scellé).
 */
export function replaceGridUnits(grid, map = UNIT_REPLACEMENTS) {
  if (!grid || typeof grid !== 'object') return { grid, count: 0 };
  let count = 0;
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isPlainObject(v)) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'unit' && typeof x === 'string' && Object.prototype.hasOwnProperty.call(map, x)) { out[k] = map[x]; count++; } else out[k] = walk(x);
    }
    return out;
  };
  const next = walk(grid);
  return { grid: count ? next : grid, count };
}
/** Métadonnées d'enregistrement d'une grille (jamais reprises de la grille du code). */
const RECORD_META = ['_rev', '_lv', '_vv', 'createdAt', 'createdBy', 'createdByName', 'updatedAt', 'updatedBy', 'updatedByName', '_conflict'];
/**
 * Mise à niveau d'une grille PAR DÉFAUT enregistrée d'après la grille de même identifiant livrée avec l'application
 * (fonction pure, déterministe, idempotente) :
 *  - version du code plus élevée : contenu remplacé par celui du code (métadonnées d'enregistrement conservées) ; une
 *    grille ARCHIVÉE par un administrateur (écran Grilles : une grille publiée n'est jamais modifiable, elle peut
 *    seulement être archivée ou servir de base à une nouvelle version, d'identifiant différent) reste archivée ;
 *  - même version (ou version enregistrée plus récente, reçue d'une tablette mise à jour) : seules les unités de
 *    turbidité sont remplacées (replaceGridUnits) ; jamais de retour à une version antérieure.
 * Retourne { grid, changed, replaced?, from?, to?, units? } ; `grid` est la grille reçue si rien ne change.
 */
export function upgradeStoredGrid(stored, code) {
  if (!stored || !code || stored.id !== code.id || stored._deleted) return { grid: stored, changed: false };
  if (compareVersions(code.version, stored.version) > 0) {
    const meta = Object.fromEntries(RECORD_META.filter(k => stored[k] !== undefined).map(k => [k, stored[k]]));
    const next = { ...meta, ...structuredClone(code) };
    if (stored.status === 'archivee') { next.status = 'archivee'; if (stored.archivedAt) next.archivedAt = stored.archivedAt; }
    return { grid: next, changed: true, replaced: true, from: String(stored.version ?? ''), to: String(code.version ?? '') };
  }
  const r = replaceGridUnits(stored);
  return { grid: r.grid, changed: r.count > 0, units: r.count };
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
