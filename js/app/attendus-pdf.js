/* « Attendus des prestataires » : ce que le prestataire doit faire ou présenter pour chaque point de contrôle de la
 * grille CT-2026, comment le contrôleur le vérifie et comment choisir C / P / NC / N/A, plus la liste de préparation
 * à remettre aux prestataires avant les tournées.
 *
 * Source unique : data/attendus-ct-2026.json (une entrée par critère de js/domain/grid-ct-2026.js, identifiant de
 * base « it-F4-12 »). Ce module fournit :
 *  - le chargement des attendus (loadAttendus, mis en cache) et l'attendu d'un critère (attenduFor, qui accepte un
 *    identifiant effectif de tournée « it-F4-12@09271503 ») ;
 *  - le modèle d'affichage par type de tournée (attendusModel) : feuilles VISIBLES pour le type (conditions de la
 *    grille évaluées par sheetsOf / expandGrid sur une station fictive, conditions portant sur des réponses
 *    ignorées), sections, critères, badges « Commun à la tournée » ;
 *  - le PDF A4 portrait (generateAttendusPdf / buildAttendusPdf) : en-tête OEG, échelle, liste de préparation à
 *    cocher, puis une section par feuille aux couleurs de son thème (js/ui/themes.js), pied de page avec la version
 *    des attendus et la pagination. Polices Barlow / Barlow Condensed / Montserrat incorporées (fonts/pdf), repli
 *    Helvetica. Utilisé par l'écran #/attendus (js/views/attendus.js).
 * Aucune dépendance au magasin de données ni à la session : utilisable hors connexion et dans les tests unitaires.
 */
import { PDFDocument, A4 } from '../formats/pdf.js';
import { THEMES, OEG } from '../ui/themes.js';
import { DECOR } from '../ui/sheet-chrome.js';
import { GRID_CT_2026 } from '../domain/grid-ct-2026.js';
import { expandGrid, sheetsOf, parseItemId, gridTypes, gridType, resolveSheet, sheetOf, allItems, flatSections } from '../domain/grids.js';

/* ---------- Données ---------- */
const asset = path => new URL('../../' + path, import.meta.url).href;
export const ATTENDUS_URL = asset('data/attendus-ct-2026.json');
/** Types de tournée de la grille, dans l'ordre d'affichage. */
export const TOUR_TYPES = ['bio', 'ce', 'eso'];
/** Couleurs des types de tournée (mêmes thèmes que TYPE_STYLES de js/ui/map.js). */
export const TYPE_THEMES = { bio: 'green', ce: 'ocean', eso: 'slate' };
/** Pictogrammes des feuilles (js/ui/icons.js) ; à défaut, celui du compartiment de la feuille. */
export const SHEET_ICONS = { 1: 'station', 2: 'clipboard', 3: 'compass', 10: 'well', 4: 'gauge', 5: 'bottles', 6: 'bug', 7: 'diatom', 8: 'fish', 9: 'algae' };
/** Échelle de cotation (couleurs OEG de js/ui/themes.js). */
export const SCALE = [
  { code: 'C', short: 'C', label: 'Conforme / satisfaisant', color: OEG.ok, bg: '#e8f5ec' },
  { code: 'P', short: 'P', label: 'Perfectible', color: OEG.perf, bg: '#fff4e2' },
  { code: 'NC', short: 'NC', label: 'Non conforme', color: OEG.nc, bg: '#fdecea' },
  { code: 'NA', short: 'N/A', label: 'Non applicable', color: OEG.na, bg: '#eef1f4' }
];

let cache = null;
let loading = null;
/** Charge data/attendus-ct-2026.json (une seule fois ; force : relecture). */
export async function loadAttendus({ force = false, fetchFn = u => fetch(u) } = {}) {
  if (cache && !force) return cache;
  if (!loading || force) {
    loading = (async () => {
      const res = await fetchFn(ATTENDUS_URL);
      if (!res.ok) throw new Error(`Attendus des prestataires introuvables (HTTP ${res.status}).`);
      cache = await res.json();
      return cache;
    })().finally(() => { loading = null; });
  }
  return loading;
}
/** Attendus déjà chargés (ou null). */
export const attendusData = () => cache;
/** Remplace les attendus en mémoire (tests). */
export function setAttendusData(data) { cache = data || null; }

/**
 * Attendu d'un critère : identifiant de base (« it-F4-12 ») ou effectif d'une tournée (« it-F4-12@09271503 »).
 * Retourne {id, feuille, no, libelle, attendu, verification, C, P, NC, NA?, refs, aPreciser?, …} ou null (attendus
 * non chargés ou critère inconnu). Synchrone : appeler loadAttendus() au préalable.
 */
export function attenduFor(itemId, data = cache) {
  if (!itemId || !data?.criteres) return null;
  const { baseId } = parseItemId(itemId);
  const e = data.criteres[baseId];
  return e ? { id: baseId, ...e } : null;
}

/* ---------- Visibilité des critères par type de tournée ---------- */
/** Condition sans ses parties portant sur des réponses (critères affichés selon une réponse : toujours retenus). */
function relax(cond) {
  if (!cond) return null;
  if (Array.isArray(cond)) { const l = cond.map(relax).filter(Boolean); return l.length ? l : null; }
  if (cond.all) { const l = cond.all.map(relax).filter(Boolean); return l.length ? { all: l } : null; }
  if (cond.any) { const l = cond.any.map(relax); return l.some(c => !c) ? null : { any: l }; }
  if (cond.not) { const n = relax(cond.not); return n ? { not: n } : null; }
  if (cond.item) return null;
  return cond;
}
const relaxGrid = grid => ({
  ...grid,
  sections: flatSections(grid).map(s => ({ ...s, subsections: undefined, condition: relax(s.condition), items: (s.items || []).map(it => ({ ...it, condition: relax(it.condition) })) }))
});
const hasItemCondition = cond => !!cond && (Array.isArray(cond) ? cond.some(hasItemCondition) : cond.all ? cond.all.some(hasItemCondition) : cond.any ? cond.any.some(hasItemCondition) : cond.not ? hasItemCondition(cond.not) : !!cond.item);
const STATION_KEY = 'ATTENDUS';

const visCache = new WeakMap();
/**
 * Visibilité de la grille par type de tournée, calculée par les fonctions de la grille (expandGrid + sheetsOf) sur
 * une tournée fictive d'UNE station de la matrice du type, toutes les conditions portant sur des réponses étant
 * levées. Retourne {types: {bio: {sheets: [{no, title, tab, kicker, theme, scope, items: [idDeBase]}], items: Set}},
 * typesOf: Map(idDeBase → [types]), conditional: Set(idDeBase affichés selon une réponse)}.
 */
export function typeVisibility(grid = GRID_CT_2026) {
  if (visCache.has(grid)) return visCache.get(grid);
  const relaxed = relaxGrid(grid);
  const out = { types: {}, typesOf: new Map(), conditional: new Set() };
  for (const it of allItems(grid)) if (hasItemCondition(it.condition)) out.conditional.add(it.id);
  for (const t of gridTypes(grid)) {
    const siteId = 'site-' + STATION_KEY;
    const sites = { [siteId]: { id: siteId, name: 'Station type', code: STATION_KEY, matrixId: t.matrixId || '' } };
    const eff = expandGrid(relaxed, [{ siteId }], sites);
    const items = new Set();
    const sheets = sheetsOf(eff, {}, { auditType: t.key }).map(sh => {
      const ids = sh.items.map(i => parseItemId(i.id).baseId);
      ids.forEach(id => items.add(id));
      return { no: sh.no, title: sh.title, tab: sh.tab, kicker: sh.kicker || '', theme: sh.theme, scope: sh.scope, items: ids };
    });
    out.types[t.key] = { sheets, items };
    for (const id of items) { if (!out.typesOf.has(id)) out.typesOf.set(id, []); out.typesOf.get(id).push(t.key); }
  }
  visCache.set(grid, out);
  return out;
}

/* ---------- Modèle d'affichage ---------- */
const sectionTheme = (sec, sheet) => sec.theme || sheet.theme || 'ocean';
/**
 * Modèle du document pour un type de tournée (null : tous les types) :
 * {type, typeLabel, data, echelle, avertissement, preparation: [{key, label, groups}], sheets: [{no, code, title, tab,
 *  theme, scope, icon, types, intro, documents, sections: [{id, no, title, icon, theme, items}], items, values, count}], count}.
 * Critère : {id, code, no, label, kind, shared, types, conditional, value (critère sans cotation), theme, entry}.
 * Les feuilles et critères sont ceux AFFICHÉS pour le type (tous les types : réunion, titres de base des feuilles).
 */
export function attendusModel(data, { auditType = null, grid = GRID_CT_2026 } = {}) {
  const vis = typeVisibility(grid);
  const type = auditType && gridType(grid, auditType) ? auditType : null;
  const allowed = type ? vis.types[type].items : new Set(vis.typesOf.keys());
  const sheetNos = type ? vis.types[type].sheets.map(s => String(s.no)) : grid.sheets.map(s => String(s.no)).filter(no => [...allowed].some(id => String(sheetOfId(grid, id)) === no));
  const sections = flatSections(grid);
  const sheets = [];
  for (const no of sheetNos) {
    const base = sheetOf(grid, no);
    const sh = type ? resolveSheet(base, type) : base;
    const fe = data?.feuilles?.[no] || {};
    const secs = [];
    for (const s of sections.filter(x => String(x.sheet) === no)) {
      const items = (s.items || []).filter(it => allowed.has(it.id)).map(it => ({
        id: it.id, code: it.code, no: it.no, label: it.label, kind: it.kind, value: it.kind !== 'conformity',
        shared: base.scope === 'tournee' || it.scope === 'tournee', sheetScope: base.scope,
        types: vis.typesOf.get(it.id) || [], conditional: vis.conditional.has(it.id), help: it.help || '',
        theme: sectionTheme(s, base), entry: data?.criteres?.[it.id] || null
      }));
      if (items.length) secs.push({ id: s.id, no: s.no || '', title: s.title, icon: s.icon || '', theme: sectionTheme(s, base), items });
    }
    const items = secs.flatMap(s => s.items);
    if (!items.length) continue;
    sheets.push({
      no: base.no, code: 'F' + base.no, title: sh.title, tab: sh.tab, kicker: sh.kicker || '', theme: base.theme, scope: base.scope,
      icon: SHEET_ICONS[base.no] || (grid.compartments || []).find(c => c.key === base.compartment)?.icon || '',
      types: TOUR_TYPES.filter(t => vis.types[t]?.sheets.some(x => String(x.no) === no)),
      intro: fe.intro || '', documents: fe.documents || [], sections: secs, items,
      count: items.filter(i => !i.value).length, values: items.filter(i => i.value).length
    });
  }
  const typeLabel = type ? gridType(grid, type).label : 'Tous types de tournée';
  const prep = data?.preparation || {};
  const preparation = [{ key: 'commun', label: 'Commun à toutes les tournées', groups: prep.commun || [] },
    ...(type ? [type] : TOUR_TYPES).map(t => ({ key: t, label: gridType(grid, t)?.label || t, groups: prep[t] || [] }))].filter(p => p.groups.length);
  return {
    type, typeLabel, data, version: data?.version || '', updated: data?.updated || '', avertissement: data?.avertissement || '',
    echelle: SCALE.map(s => ({ ...s, text: data?.echelle?.[s.code] || '' })), preparation, sheets,
    count: sheets.reduce((n, s) => n + s.count, 0)
  };
}
function sheetOfId(grid, id) {
  const m = /^it-F(\d+)-/.exec(id);
  return m ? m[1] : null;
}

/* ---------- PDF ---------- */
const FONT_FILES = {
  barlow: ['Barlow-Regular.ttf', 'regular'], 'barlow-semibold': ['Barlow-SemiBold.ttf', 'bold'], 'barlow-bold': ['Barlow-Bold.ttf', 'bold'],
  'barlow-italic': ['Barlow-Italic.ttf', 'italic'], condensed: ['BarlowCondensed-Bold.ttf', 'bold'], montserrat: ['Montserrat-Black.ttf', 'bold']
};
const F = { text: 'barlow', semi: 'barlow-semibold', bold: 'barlow-bold', italic: 'barlow-italic', cond: 'condensed', black: 'montserrat' };
const NAVY = OEG.navy, INK = '#14284b', MUTED = '#4c6280', LINE = '#d3e3f0';
const M = 34;            // marge latérale
const TOP = 46;          // haut des pages suivantes (sous l'en-tête courant)
const BOTTOM = 50;       // bas de page (pied de page à vagues)
const th = name => { const t = THEMES[name] || THEMES.ocean; return { ...t, title: t.title || t.dark, num: t.num || t.main, ink: t.ink || NAVY }; };
const fmtDateFr = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10).split('-').reverse().join('/') : String(iso || ''));
const TYPE_FILE = { bio: 'biologie', ce: 'cours-eau', eso: 'eaux-souterraines' };
/** Nom des fichiers : Attendus_prestataires_<type|tous>.pdf, Preparation_tournee_<type|tous>.pdf. */
export const attendusFilename = ({ auditType = null, preparationOnly = false } = {}) =>
  `${preparationOnly ? 'Preparation_tournee' : 'Attendus_prestataires'}_${TYPE_FILE[auditType] || 'tous'}.pdf`;

/** Logo OEG rond rastérisé (RGBA) ou null (pas de canvas, fichier absent). */
async function loadLogo(doc, px = 220) {
  try {
    const res = await fetch(asset('icons/logo-oeg-rond.png'));
    if (!res.ok || typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(await res.blob());
    const s = px / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    return await doc.addRGBA(ctx.getImageData(0, 0, w, h));
  } catch (e) { return null; }
}

/** Mise en page en flux : saut de page automatique, éléments mesurés avant d'être dessinés. */
class Flow {
  constructor(doc) { this.doc = doc; }
  get W() { return this.doc.W; }
  get H() { return this.doc.H; }
  get width() { return this.W - 2 * M; }
  get bottom() { return this.H - BOTTOM; }
  room() { return this.bottom - this.doc.y; }
  page() { this.doc.newPage(); this.doc.y = TOP; }
  ensure(h) { if (this.doc.y + h > this.bottom) this.page(); }
  lines(text, font, size, width) { return this.doc.wrap(String(text ?? ''), font, size, width); }
  /** Bloc de texte (lignes déjà coupées) ; retourne la hauteur. */
  textLines(lines, x, y, { font = F.text, size = 8.6, color = INK, lh = null } = {}) {
    const l = lh || size * 1.24;
    lines.forEach((s, i) => this.doc.text(s, x, y + i * l, { font, size, color }));
    return lines.length * l;
  }
  /** Paragraphe en flux (coupé entre les pages). */
  paragraph(text, { font = F.text, size = 9, color = INK, x = M, width = null, gap = 4 } = {}) {
    const w = width || this.width, lh = size * 1.28;
    for (const l of this.lines(text, font, size, w)) { this.ensure(lh); this.doc.text(l, x, this.doc.y, { font, size, color }); this.doc.y += lh; }
    this.doc.y += gap;
  }
}

/** Pastille de cotation (C, P, NC, N/A). */
function scaleChip(doc, s, x, y, h = 12) {
  const w = Math.max(h * 1.5, doc.width(s.short, F.cond, h * 0.78) + 8);
  doc.roundRect(x, y, w, h, 3, { fill: s.color });
  doc.text(s.short, x, y + h * 0.16, { font: F.cond, size: h * 0.78, color: '#ffffff', align: 'center', width: w });
  return w;
}
/** Case à cocher vide. */
const checkbox = (doc, x, y, size = 8, color = NAVY) => doc.roundRect(x, y, size, size, 1.5, { stroke: color, lineWidth: 0.9, fill: '#ffffff' });

function drawSwoosh(doc, x, y, w, h, color, opacity = 1) { doc.svgPath(DECOR.swoosh, { x, y, sx: w / 120, sy: h / 20, fill: color, opacity }); }

/** En-tête de la première page. */
function drawCover(flow, model, { logo, preparationOnly }) {
  const doc = flow.doc, W = doc.W;
  const tt = th(model.type ? TYPE_THEMES[model.type] : 'navy');
  doc.rect(0, 0, W, 112, { fill: '#f4f9fd' });
  doc.svgPath(DECOR.waves[0], { x: 0, y: 92, sx: W / 1200, sy: 0.2, fill: tt.light });
  doc.svgPath(DECOR.waves[2], { x: 0, y: 96, sx: W / 1200, sy: 0.16, fill: tt.main, opacity: 0.35 });
  if (logo) doc.drawImage(logo, M, 22, 66, 66);
  else doc.circle(M + 33, 55, 33, { fill: NAVY });
  const x = M + 80;
  doc.text('OFFICE DE L’EAU DE GUYANE', x, 24, { font: F.cond, size: 13.5, color: NAVY, charSpace: 0.4 });
  const title = preparationOnly ? 'Liste de préparation de la tournée' : 'Attendus des prestataires';
  const ts = doc.fitSize(title, F.black, 20, W - x - M - 4, 12);
  doc.text(title, x, 41, { font: F.black, size: ts, color: NAVY });
  drawSwoosh(doc, x, 41 + ts + 1, 92, 7, OEG.sky);
  doc.text(preparationOnly ? 'À préparer par le prestataire avant chaque tournée – contrôle terrain 2026' : 'Contrôle terrain des prestations de prélèvement 2026 – document partagé contrôleurs OEG et prestataires',
    x, 41 + ts + 11, { font: F.semi, size: 9.2, color: OEG.blue });
  // Pavé « type de tournée » et version
  const label = model.typeLabel;
  const lw = doc.width(label, F.bold, 9.4) + 18;
  doc.roundRect(x, 84, lw, 16, 8, { fill: model.type ? tt.main : NAVY });
  doc.text(label, x, 87.6, { font: F.bold, size: 9.4, color: '#ffffff', align: 'center', width: lw });
  const ver = `Attendus v${model.version || '—'} du ${fmtDateFr(model.updated)} · grille ${GRID_CT_2026.code}`;
  doc.text(ver, x + lw + 10, 88, { font: F.text, size: 7.8, color: MUTED });
  doc.y = 124;
}

/** Avertissement (encadré bleu clair). */
function drawNotice(flow, text) {
  if (!text) return;
  const doc = flow.doc, w = flow.width - 20;
  const lines = flow.lines(text, F.italic, 8.4, w);
  const h = lines.length * 10.4 + 12;
  flow.ensure(h);
  doc.roundRect(M, doc.y, flow.width, h, 6, { fill: '#eef6fc', stroke: '#b9d8ee', lineWidth: 0.6 });
  doc.rect(M, doc.y + 6, 3, h - 12, { fill: OEG.sky });
  flow.textLines(lines, M + 12, doc.y + 6.5, { font: F.italic, size: 8.4, color: INK, lh: 10.4 });
  doc.y += h + 10;
}

/** Titre de partie (échelle, préparation) : pastille + titre + filet. */
function partTitle(flow, title, color = NAVY, need = 60) {
  const doc = flow.doc;
  flow.ensure(need + 24);
  doc.circle(M + 6, doc.y + 8, 5, { fill: color });
  doc.text(title.toLocaleUpperCase('fr-FR'), M + 17, doc.y + 1.5, { font: F.cond, size: 13.5, color: NAVY, charSpace: 0.3 });
  doc.line(M, doc.y + 19, M + flow.width, doc.y + 19, { color: LINE, width: 0.8 });
  doc.y += 26;
}

/** Échelle C / P / NC / N/A : quatre encadrés (deux par ligne). */
function drawScale(flow, model) {
  partTitle(flow, 'Échelle de cotation C / P / NC / N/A', OEG.ok, 120);
  const doc = flow.doc, gap = 10, cw = (flow.width - gap) / 2;
  const boxes = model.echelle.map(s => ({ s, lines: flow.lines(s.text, F.text, 8.3, cw - 22) }));
  for (let i = 0; i < boxes.length; i += 2) {
    const row = boxes.slice(i, i + 2);
    const h = Math.max(...row.map(b => b.lines.length * 10.2 + 26));
    flow.ensure(h + 6);
    row.forEach((b, k) => {
      const x = M + k * (cw + gap), y = doc.y;
      doc.roundRect(x, y, cw, h, 6, { fill: b.s.bg, stroke: b.s.color, lineWidth: 0.7 });
      doc.rect(x, y + 5, 3.2, h - 10, { fill: b.s.color });
      const w = scaleChip(doc, b.s, x + 10, y + 6, 12.5);
      doc.text(b.s.label, x + 16 + w, y + 7.2, { font: F.bold, size: 9.2, color: b.s.color });
      flow.textLines(b.lines, x + 10, y + 22, { size: 8.3, lh: 10.2 });
    });
    doc.y += h + 6;
  }
  doc.y += 6;
}

/** Liste de préparation : groupes répartis sur deux colonnes, cases à cocher. */
function drawPreparation(flow, model, { big = false } = {}) {
  const doc = flow.doc;
  const size = big ? 9.2 : 8.4, lh = size * 1.25, gap = 12, cw = (flow.width - gap) / 2;
  partTitle(flow, 'Liste de préparation de la tournée (à cocher par le prestataire)', OEG.perf, 80);
  for (const part of model.preparation) {
    const tt = th(TYPE_THEMES[part.key] || 'navy');
    flow.ensure(40);
    doc.roundRect(M, doc.y, flow.width, 17, 4, { fill: tt.light });
    doc.text(part.label, M + 8, doc.y + 3.4, { font: F.bold, size: 10, color: tt.dark });
    doc.y += 23;
    const groups = part.groups.map(g => {
      const items = (g.elements || []).map(e => flow.lines(e, F.text, size, cw - 16));
      return { g, items, h: 15 + items.reduce((n, l) => n + l.length * lh + 2.6, 0) + 6 };
    });
    let col = [doc.y, doc.y];
    for (const grp of groups) {
      let k = col[0] <= col[1] ? 0 : 1;
      if (col[k] + grp.h > flow.bottom) {
        const other = 1 - k;
        if (col[other] + grp.h <= flow.bottom) k = other;
        else { flow.page(); col = [doc.y, doc.y]; k = 0; }
      }
      const x = M + k * (cw + gap);
      let y = col[k];
      doc.text(grp.g.titre || '', x, y, { font: F.bold, size: size + 0.6, color: tt.title });
      doc.line(x, y + size + 3.5, x + cw, y + size + 3.5, { color: tt.line, width: 0.7 });
      y += 15;
      for (const l of grp.items) {
        checkbox(doc, x + 1, y + 0.6, size * 0.92, tt.main);
        flow.textLines(l, x + 15, y, { size, lh });
        y += l.length * lh + 2.6;
      }
      col[k] = y + 6;
    }
    doc.y = Math.max(...col) + 4;
  }
}

/** Bandeau de feuille : pastille « F4 », titre, onglet et types. */
function drawSheetHead(flow, model, sh) {
  const doc = flow.doc, t = th(sh.theme);
  const titleLines = flow.lines(sh.title, F.bold, 12.5, flow.width - 70);
  const h = Math.max(30, titleLines.length * 14.5 + 16);
  flow.ensure(h + 70);
  const y = doc.y;
  doc.roundRect(M, y, flow.width, h, 8, { fill: t.head });
  const headText = t.headText || NAVY;
  doc.circle(M + 20, y + h / 2, 13, { fill: t.num === t.head ? t.dark : t.num, stroke: '#ffffff', lineWidth: 1.4 });
  doc.text(sh.code, M + 7, y + h / 2 - 5.2, { font: F.cond, size: 11, color: '#ffffff', align: 'center', width: 26 });
  flow.textLines(titleLines, M + 42, y + 6.5, { font: F.bold, size: 12.5, color: headText, lh: 14.5 });
  const meta = [`Onglet « ${sh.tab} »`, sh.scope === 'tournee' ? 'renseignée une fois par tournée' : 'répétée pour chaque station',
    model.type ? '' : 'types : ' + sh.types.map(k => gridType(GRID_CT_2026, k)?.short || k).join(', ')].filter(Boolean).join(' · ');
  doc.text(meta, M + 42, y + h - 10.5, { font: F.text, size: 7.4, color: headText, opacity: 0.85 });
  doc.y = y + h + 7;
  if (sh.intro) flow.paragraph(sh.intro, { size: 8.8, color: INK, gap: 3 });
  if (sh.documents.length) {
    const lines = sh.documents.map(d => flow.lines(d, F.text, 8.3, flow.width / 2 - 26));
    flow.ensure(18);
    doc.text('À présenter ou à préparer :', M, doc.y, { font: F.bold, size: 8.6, color: t.title });
    doc.y += 12;
    // Deux colonnes de puces
    const half = Math.ceil(lines.length / 2), cw = flow.width / 2;
    const colH = c => lines.slice(c * half, (c + 1) * half).reduce((n, l) => n + l.length * 10.2 + 1.5, 0);
    const h2 = Math.max(colH(0), colH(1));
    flow.ensure(h2);
    [0, 1].forEach(c => {
      let yy = doc.y;
      for (const l of lines.slice(c * half, (c + 1) * half)) {
        doc.circle(M + c * cw + 4, yy + 4.2, 1.6, { fill: t.main });
        flow.textLines(l, M + c * cw + 10, yy, { size: 8.3, lh: 10.2 });
        yy += l.length * 10.2 + 1.5;
      }
    });
    doc.y += h2 + 6;
  }
}

/** Informations relevées sans cotation (critères « valeur seule ») : tableau compact. */
function drawValues(flow, items, theme) {
  if (!items.length) return;
  const doc = flow.doc, t = th(theme);
  const w1 = 46, w2 = 150, w3 = flow.width - w1 - w2;
  flow.ensure(40);
  doc.text('Informations relevées par le contrôleur (sans cotation)', M, doc.y, { font: F.bold, size: 8.8, color: t.title });
  doc.y += 13;
  items.forEach((it, i) => {
    const a = flow.lines(String(it.entry?.attendu || '').replace(/^Information à relever\s*:\s*/i, ''), F.text, 7.8, w3 - 8);
    const l = flow.lines(it.label, F.semi, 7.8, w2 - 8);
    const h = Math.max(a.length, l.length) * 9.6 + 6;
    flow.ensure(h);
    const y = doc.y;
    doc.rect(M, y, flow.width, h, { fill: i % 2 ? t.rowAlt || '#f6fbfe' : '#ffffff', stroke: t.line, lineWidth: 0.4 });
    doc.text(it.code, M + 4, y + 3, { font: F.cond, size: 8.4, color: t.num });
    flow.textLines(l, M + w1, y + 3, { font: F.semi, size: 7.8, color: t.ink, lh: 9.6 });
    flow.textLines(a, M + w1 + w2, y + 3, { size: 7.8, lh: 9.6 });
    doc.y += h;
  });
  doc.y += 8;
}

/** Fiche d'un critère : mesurée puis dessinée (jamais coupée entre deux pages). */
function criterionCard(flow, model, it) {
  const doc = flow.doc, t = th(it.theme), e = it.entry || {};
  const W = flow.width, pad = 8, inner = W - 2 * pad - 4;
  const labelLines = flow.lines(it.label, F.bold, 10, inner - 30);
  const badges = [];
  if (it.shared && it.sheetScope !== 'tournee') badges.push({ text: 'Commun à la tournée', color: '#0b4f9c', bg: '#e8f3fc' });
  if (it.conditional) badges.push({ text: 'Affiché selon une réponse', color: MUTED, bg: '#eef1f4' });
  if (!model.type && it.types.length < TOUR_TYPES.length) it.types.forEach(k => badges.push({ text: gridType(GRID_CT_2026, k)?.short || k, color: th(TYPE_THEMES[k]).dark, bg: th(TYPE_THEMES[k]).light }));
  const kw = 62;
  const rows = [['Attendu', e.attendu], ['Vérification', e.verification]].filter(r => r[1]).map(([k, v]) => ({ k, lines: flow.lines(v, F.text, 8.4, inner - kw) }));
  const codes = SCALE.filter(s => e[s.code]);
  const cols = codes.length || 1, gap = 5, colW = (inner - gap * (cols - 1)) / cols;
  const cells = codes.map(s => ({ s, lines: flow.lines(e[s.code], F.text, 7.7, colW - 10) }));
  const cellH = cells.length ? Math.max(...cells.map(c => c.lines.length * 9.3)) + 22 : 0;
  const refs = (e.refs || []).length ? flow.lines('Références : ' + e.refs.join(' · '), F.italic, 7.5, inner) : [];
  const prec = e.aPreciser ? flow.lines(e.aPreciser, F.text, 7.7, inner - 74) : [];
  const head = Math.max(labelLines.length * 12, 12) + (badges.length ? 13 : 0) + 6;
  const body = rows.reduce((n, r) => n + r.lines.length * 10.4 + 4, 0);
  const h = pad + head + body + (cellH ? cellH + 4 : 0) + (refs.length ? refs.length * 9.2 + 3 : 0) + (prec.length ? prec.length * 9.4 + 9 : 0) + pad - 2;
  if (doc.y + h > flow.bottom && h <= flow.bottom - TOP) flow.page();
  const x = M, y = doc.y;
  doc.roundRect(x, y, W, h, 7, { fill: '#ffffff', stroke: t.line, lineWidth: 0.8 });
  doc.roundRect(x, y, 4.5, h, [7, 0, 0, 7], { fill: t.main });
  const ix = x + pad + 4;
  // En-tête : numéro + libellé + badges
  const noTxt = String(it.no);
  const nw = Math.max(20, doc.width(noTxt, F.cond, 10.5) + 10);
  doc.roundRect(ix, y + pad - 1, nw, 16, 8, { fill: t.num });
  doc.text(noTxt, ix, y + pad + 1.4, { font: F.cond, size: 10.5, color: '#ffffff', align: 'center', width: nw });
  flow.textLines(labelLines, ix + nw + 7, y + pad + 1, { font: F.bold, size: 10, color: t.ink, lh: 12 });
  doc.text(it.code, x + W - pad - 60, y + pad + 1.5, { font: F.text, size: 7.2, color: MUTED, align: 'right', width: 60 });
  let yy = y + pad + Math.max(labelLines.length * 12, 12) + 3;
  if (badges.length) {
    let bx = ix + nw + 7;
    for (const b of badges) {
      const bw = doc.width(b.text, F.semi, 6.8) + 10;
      doc.roundRect(bx, yy, bw, 10.5, 5.2, { fill: b.bg });
      doc.text(b.text, bx, yy + 2, { font: F.semi, size: 6.8, color: b.color, align: 'center', width: bw });
      bx += bw + 4;
    }
    yy += 13;
  }
  yy += 3;
  for (const r of rows) {
    doc.text(r.k, ix, yy, { font: F.bold, size: 8, color: t.title });
    flow.textLines(r.lines, ix + kw, yy, { size: 8.4, lh: 10.4 });
    yy += r.lines.length * 10.4 + 4;
  }
  if (cells.length) {
    cells.forEach((c, i) => {
      const cx = ix + i * (colW + gap);
      doc.roundRect(cx, yy, colW, cellH, 4, { fill: c.s.bg });
      const w = scaleChip(doc, c.s, cx + 4, yy + 4, 11);
      doc.text(c.s.label, cx + 8 + w, yy + 5.4, { font: F.semi, size: 7, color: c.s.color });
      flow.textLines(c.lines, cx + 5, yy + 19, { size: 7.7, lh: 9.3 });
    });
    yy += cellH + 4;
  }
  if (refs.length) { flow.textLines(refs, ix, yy, { font: F.italic, size: 7.5, color: MUTED, lh: 9.2 }); yy += refs.length * 9.2 + 3; }
  if (prec.length) {
    const ph = prec.length * 9.4 + 6;
    doc.roundRect(ix, yy, inner, ph, 3.5, { fill: '#fff6e6', stroke: '#f3c27a', lineWidth: 0.6 });
    doc.text('À préciser (OEG)', ix + 5, yy + 3.3, { font: F.bold, size: 7.4, color: '#a35a00' });
    flow.textLines(prec, ix + 70, yy + 3, { size: 7.7, color: '#5c3b00', lh: 9.4 });
    yy += ph + 3;
  }
  doc.y = y + h + 6;
}

/** Sous-titre de section dans une feuille. */
function sectionTitle(flow, sec, sheet) {
  const doc = flow.doc, t = th(sec.theme);
  flow.ensure(64);
  const label = [sec.no && sec.no !== '' ? sec.no : '', sec.title].filter(Boolean).join(' – ');
  doc.rect(M, doc.y + 2, 3, 11, { fill: t.main });
  doc.text(label, M + 9, doc.y + 1.5, { font: F.bold, size: 10.2, color: t.title });
  doc.y += 18;
}

/** En-têtes et pieds de page (dessinés à la fin : pagination connue). */
function decorate(doc, model, { preparationOnly }) {
  doc.headerFn = (d, n) => {
    if (n === 1) return;
    const W = d.W;
    d.text('OFFICE DE L’EAU DE GUYANE', M, 16, { font: F.cond, size: 8.6, color: NAVY, charSpace: 0.3 });
    d.text(`${preparationOnly ? 'Liste de préparation de la tournée' : 'Attendus des prestataires – contrôle terrain 2026'} · ${model.typeLabel}`, M + 126, 16.6, { font: F.semi, size: 7.8, color: MUTED });
    d.line(M, 30, W - M, 30, { color: LINE, width: 0.7 });
  };
  doc.footerFn = (d, n, total) => {
    const W = d.W, H = d.H, fh = 30, y0 = H - fh;
    const tt = th(model.type ? TYPE_THEMES[model.type] : 'navy');
    const [ww, wh] = DECOR.wavesViewBox, sx = W / ww, sy = fh / wh;
    d.svgPath(DECOR.waves[0], { x: 0, y: y0, sx, sy, fill: tt.light });
    d.svgPath(DECOR.waves[1], { x: 0, y: y0, sx, sy, fill: tt.accent, opacity: 0.5 });
    d.svgPath(DECOR.waves[2], { x: 0, y: y0, sx, sy, fill: tt.main, opacity: 0.85 });
    d.text(`Attendus des prestataires v${model.version || '—'} du ${fmtDateFr(model.updated)} · grille ${GRID_CT_2026.code} · ${model.typeLabel}`, M, H - 22, { font: F.text, size: 6.8, color: NAVY });
    d.text('www.eauguyane.fr', M, H - 13, { font: F.semi, size: 6.8, color: NAVY });
    d.text(`Page ${n} / ${total}`, W - M - 80, H - 12.5, { font: F.bold, size: 8, color: '#ffffff', align: 'right', width: 80 });
  };
}

/**
 * Construit le PDF (fonction testable sans réseau autre que les polices et le logo).
 * options : auditType ('bio' | 'ce' | 'eso' | null = tous), preparationOnly, grid, fonts (false : Helvetica),
 * logo (false : pas de logo). Retourne { bytes, filename, pages }.
 */
export async function buildAttendusPdf(data, { auditType = null, preparationOnly = false, grid = GRID_CT_2026, fonts = true, logo = true, compress = true } = {}) {
  const model = attendusModel(data, { auditType, grid });
  const title = preparationOnly ? `Liste de préparation de la tournée – ${model.typeLabel}` : `Attendus des prestataires – contrôle terrain 2026 – ${model.typeLabel}`;
  const doc = new PDFDocument({ title, author: 'Office de l’Eau de Guyane', subject: 'Contrôle terrain des prestations de prélèvement 2026', keywords: 'OEG, contrôle terrain, prestataires, attendus', pageSize: A4, margins: { top: TOP, bottom: BOTTOM, left: M, right: M } });
  if (fonts) {
    await doc.loadFonts(Object.fromEntries(Object.entries(FONT_FILES).map(([name, [file, fallback]]) => [name, { url: asset('fonts/pdf/' + file), fallback, postscript: file.replace(/\.ttf$/, '') }])));
    doc.useFonts({ regular: F.text, bold: F.semi, italic: F.italic });
  }
  const img = logo ? await loadLogo(doc) : null;
  const flow = new Flow(doc);
  drawCover(flow, model, { logo: img, preparationOnly });
  drawNotice(flow, preparationOnly
    ? 'Cette liste rassemble ce que le prestataire doit préparer avant chaque tournée pour remplir au mieux les exigences contrôlées par l’OEG. Elle complète le CCTP, les protocoles et les consignes du laboratoire, qui prévalent en cas de différence.'
    : model.avertissement);
  if (preparationOnly) {
    drawPreparation(flow, model, { big: true });
    // Visa du prestataire
    flow.ensure(64);
    const doc2 = flow.doc, y = doc2.y + 6, cw = (flow.width - 20) / 3;
    ['Préparé par (nom, fonction)', 'Date', 'Visa'].forEach((k, i) => {
      const x = M + i * (cw + 10);
      doc2.text(k, x, y, { font: F.bold, size: 8.4, color: NAVY });
      doc2.roundRect(x, y + 12, cw, 34, 5, { stroke: LINE, lineWidth: 0.8 });
    });
    doc2.y = y + 54;
  } else {
    drawScale(flow, model);
    drawPreparation(flow, model);
    for (const sh of model.sheets) {
      // Une feuille commence en haut de page, sauf s'il reste plus de la moitié de la page (feuille courte, F1).
      if (flow.room() < (flow.bottom - TOP) * 0.5) flow.page(); else flow.doc.y += 10;
      drawSheetHead(flow, model, sh);
      drawValues(flow, sh.items.filter(i => i.value), sh.theme);
      for (const sec of sh.sections) {
        const crit = sec.items.filter(i => !i.value);
        if (!crit.length) continue;
        sectionTitle(flow, sec, sh);
        for (const it of crit) criterionCard(flow, model, it);
      }
    }
  }
  decorate(doc, model, { preparationOnly });
  const bytes = compress ? await doc.outputAsync() : doc.output();
  return { bytes, filename: attendusFilename({ auditType: model.type, preparationOnly }), pages: doc.pages.length };
}

/** PDF des attendus (preparationOnly : liste de préparation seule) pour un type de tournée (null : tous). */
export async function generateAttendusPdf({ auditType = null, preparationOnly = false } = {}) {
  const data = await loadAttendus();
  return buildAttendusPdf(data, { auditType, preparationOnly });
}
