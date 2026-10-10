/* Fiches de contrôle terrain en PDF (SPEC § 7, avenant n° 1 § F), fidèles aux maquettes docs/maquettes :
 *
 * - generateSheetsPdf({ auditId }) : rapport de TOURNÉE rempli = feuille tournée (F2) une fois puis, pour chaque
 *   station dans l'ordre de passage, ses feuilles (F1 portrait A4, les autres paysage A4), puis la synthèse
 *   (C / P / NC / N/A par station et par feuille, bilan, préconisations, écarts, signatures). Filigrane
 *   « PROVISOIRE » tant que l'audit n'est pas verrouillé ; n° d'audit, empreinte et pagination en pied de page.
 * - generateBlankSheetsPdf({ auditType, siteId | siteIds, compartments }) : fiches vierges imprimables d'une
 *   tournée (valeurs du référentiel seulement, cases vides, pointillés).
 * - generateStationSheetPdf({ siteId, auditType }) : fiche station seule (feuille 1).
 * Chaque fonction retourne { bytes, filename, pages, provisional }.
 *
 * Habillage : en-tête OEG (logo rond rastérisé, titre résolu par headerOf), pavé « Station NOM — Station i / n —
 * Feuille X / N », bandeau d'information à pastilles (Code SANDRE ou Code BSS), cartes numérotées, tableaux aux
 * couleurs du thème de la feuille (js/ui/themes.js) avec cases C / P / NC / N/A, encadrés de la feuille
 * (sheetBlocks : observations, notes, photos, conclusion à cases, contrôleur, date, signature), module
 * « appareils et étalonnage » de F4, F8 en deux colonnes, F10 (ardoise), F1 complète (carte : js/app/static-map.js,
 * photos, accès, difficultés, compartiments, repères terrain), pied de page à vagues et forêt (décors de
 * js/ui/sheet-chrome.js). Polices Barlow / Barlow Condensed / Montserrat incorporées (fonts/pdf), repli Helvetica.
 * Pictogrammes (js/ui/icons.js), logo et photos rastérisés par canvas.
 *
 * Le moteur de rendu (buildSheetsPdf) reçoit un « modèle » de document (sheetsModelFromAudit, blankSheetsModel) :
 * il est testable sans base de données (tests/unit/pdf-sheets.test.js).
 */
import { PDFDocument, A4, A4_LANDSCAPE, parseSvgPath } from '../formats/pdf.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { mediaBytes } from '../core/media.js';
import { fmtDate, fmtDateTime, nowISO, sha256Hex, haversine, fmtDistance } from '../core/util.js';
import { THEMES, OEG } from '../ui/themes.js';
import { icon } from '../ui/icons.js';
import { DECOR, DEFAULT_HEADER, siteLatLon } from '../ui/sheet-chrome.js';
import { GUYANE, guyaneXY } from '../lib/guyane.js';
import { latLonToUtm } from '../lib/geo.js';
import { SAMPLING_KINDS, kindSVG } from '../ui/map.js';
import { GRID_CT_2026, INSTRUMENTS, INSTRUMENT_FIELDS, CALIBRATION_FIELDS } from '../domain/grid-ct-2026.js';
import {
  expandGrid, sheetsOf, groupSheets, headerOf, sectionHeaders, sheetStoreKey, prefillResponses, auditCompartments, normalizeCompartments,
  typeCompartments, gridType, gridTypes, inferAuditType, makeStation, isSheetGrid, providerHeaderName
} from '../domain/grids.js';
import { formatValue, itemInput, fieldShown, SHEET_CONCLUSIONS, AUDIT_TYPES, PROVIDER_KINDS } from '../domain/model.js';
import { sheetSummary, stationSummary } from '../domain/summary.js';
import { calibrationStatus } from '../domain/rules.js';
import { auditState, auditContentHash, auditMedia } from './audits.js';
import { staticMap, scaleBar } from './static-map.js';
import { stationMapPoints, SLOTS } from '../views/station-sheet.js';

/* ---------- Constantes de mise en page ---------- */
const asset = path => new URL('../../' + path, import.meta.url).href;
/** Polices incorporées : nom logique → fichier de fonts/pdf et police de secours (Helvetica). */
export const FONT_FILES = {
  barlow: ['Barlow-Regular.ttf', 'regular'], 'barlow-semibold': ['Barlow-SemiBold.ttf', 'bold'], 'barlow-bold': ['Barlow-Bold.ttf', 'bold'],
  'barlow-italic': ['Barlow-Italic.ttf', 'italic'], condensed: ['BarlowCondensed-Bold.ttf', 'bold'], montserrat: ['Montserrat-Black.ttf', 'bold']
};
const F = { text: 'barlow', semi: 'barlow-semibold', bold: 'barlow-bold', italic: 'barlow-italic', cond: 'condensed', black: 'montserrat' };
const M = 18;                              // marge latérale
const FOOT = { land: 34, port: 44 };       // hauteur du pied de page (vagues)
const FS = 7.2, LH = 8.5, PADY = 2.9;      // corps, interligne et marge verticale des tableaux
const BOX = 7.4;                           // côté des cases à cocher des tableaux
const NAVY = OEG.navy, INK = '#14284b', MUTED = '#4c6280', DOTS = '#8ea9c3';
const STATUS = [
  { code: 'C', short: 'C', label: 'Conforme', color: '#1b7a43', bg: '#e8f5ec' },
  { code: 'P', short: 'P', label: 'Perfectible', color: '#d97706', bg: '#fff4e2' },
  { code: 'NC', short: 'NC', label: 'Non conforme', color: '#c62828', bg: '#fdecea' },
  { code: 'NA', short: 'N/A', label: 'Non applicable', color: '#5f6b7a', bg: '#eef1f4' }
];
const STATUS_OF = Object.fromEntries(STATUS.map(s => [s.code, s]));
const conclColor = (code, t) => STATUS_OF[code]?.color || t.main;
const theme = name => { const t = THEMES[name] || THEMES.ocean; return { ...t, title: t.title || t.dark, num: t.num || t.main, name: THEMES[name] ? name : 'ocean' }; };
const present = v => v !== undefined && v !== null && String(v).trim() !== '';
const upper = s => String(s || '').toLocaleUpperCase('fr-FR');
const fmtXY = v => (present(v) && isFinite(Number(v)) ? String(Math.round(Number(v))) : '—');
const fmtLL = (v, pos, neg) => `${Math.abs(v).toFixed(5).replace('.', ',')}° ${v >= 0 ? pos : neg}`;
const SUBSCRIPT = /[₀-₉]/;
/** Nom de fichier : capitales sans accents ni caractères spéciaux (« ATHANASE », « AEP-MARIPASOULA »). */
export const fileToken = s => upper(String(s || '').normalize('NFD').replace(/[\u0300-\u036F]/g, '')).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'STATION';

/* ---------- Canvas : pictogrammes, logo, photos ---------- */
function newCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
async function canvasJPEG(canvas, quality = 0.85) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality }) : await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
/** Image décodée (ImageBitmap ou <img> pour le SVG) depuis des octets. */
async function decode(bytes, mime = '') {
  const type = mime || sniffMime(bytes);
  const blob = new Blob([bytes], { type });
  if (type !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch (e) { /* repli <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}
function sniffMime(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x3C) return 'image/svg+xml';
  return 'application/octet-stream';
}
const dims = img => [img.width || img.naturalWidth, img.height || img.naturalHeight];

/** Ressources rastérisées d'un document (mises en cache : un objet image par pictogramme et couleur). */
class Assets {
  constructor(doc) { this.doc = doc; this.cache = new Map(); }
  async once(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn().catch(() => null));
    return this.cache.get(key);
  }
  /** Pictogramme de js/ui/icons.js rastérisé (RGBA avec transparence) dans la couleur demandée. */
  icon(name, color = '#ffffff', px = 72) {
    return this.once(`icon:${name}:${color}:${px}`, async () => {
      const svg = String(icon(name, { size: px })).replace(/currentColor/g, color);
      const img = await decode(new TextEncoder().encode(svg), 'image/svg+xml');
      const c = newCanvas(px, px), ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, px, px);
      return this.doc.addRGBA(ctx.getImageData(0, 0, px, px));
    });
  }
  /** Logo rond de l'OEG (icons/logo-oeg-rond.png, sinon icons/logo-oeg.png). */
  logo(px = 220) {
    return this.once('logo', async () => {
      for (const p of ['icons/logo-oeg-rond.png', 'icons/logo-oeg.png']) {
        try {
          const res = await fetch(asset(p));
          if (!res.ok) continue;
          const img = await decode(new Uint8Array(await res.arrayBuffer()), 'image/png');
          const [w, h] = dims(img), s = px / Math.max(w, h);
          const c = newCanvas(Math.round(w * s), Math.round(h * s)), ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, c.width, c.height);
          return await this.doc.addRGBA(ctx.getImageData(0, 0, c.width, c.height));
        } catch (e) { /* fichier suivant */ }
      }
      return null;
    });
  }
  /** Octets d'une photo : média chiffré de l'appareil (mediaId) ou fichier statique de l'application (src). */
  async photoBytes(src) {
    if (!src) return null;
    if (src.mediaId) { const b = await mediaBytes(src.mediaId).catch(() => null); if (b) return { bytes: b, mime: store.get('media', src.mediaId)?.mime || '' }; }
    if (src.bytes) return { bytes: src.bytes, mime: src.mime || '' };
    if (src.src) { const res = await fetch(asset(src.src)).catch(() => null); if (res?.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('content-type') || '' }; }
    return null;
  }
  /**
   * Photo recadrée aux proportions `aspect` (largeur / hauteur), JPEG d'au plus maxW pixels de large ;
   * fade : masque de transparence horizontal (fondu depuis la gauche, part de la largeur).
   */
  photo(src, { aspect = 1.5, maxW = 700, fade = 0, key = '' } = {}) {
    const id = key || src?.mediaId || src?.src || '';
    return this.once(`photo:${id}:${aspect.toFixed(3)}:${maxW}:${fade}`, async () => {
      const got = await this.photoBytes(src);
      if (!got) return null;
      const img = await decode(got.bytes, got.mime);
      const [w, h] = dims(img);
      let sw = w, sh = w / aspect;
      if (sh > h) { sh = h; sw = h * aspect; }
      const outW = Math.round(Math.min(maxW, sw)), outH = Math.round(outW / aspect);
      const c = newCanvas(outW, outH), ctx = c.getContext('2d');
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, outW, outH);
      const jpeg = await canvasJPEG(c, 0.84);
      let smask = null;
      if (fade > 0) {
        const n = 128, ramp = new Uint8Array(n);
        for (let i = 0; i < n; i++) { const u = Math.min(1, Math.max(0, (i / (n - 1)) / fade)); ramp[i] = Math.round(255 * u * u * (3 - 2 * u)); }
        smask = await this.doc.addGray({ width: n, height: 1, data: ramp });
      }
      return this.doc.addImage(jpeg, { smask });
    });
  }
  /** Image d'un média (signature…) en conservant la transparence (RGBA), au plus maxSide pixels. */
  mediaImage(mediaId, maxSide = 600) {
    return this.once(`media:${mediaId}:${maxSide}`, async () => {
      const bytes = await mediaBytes(mediaId).catch(() => null);
      if (!bytes) return null;
      const img = await decode(bytes, store.get('media', mediaId)?.mime || '');
      const [w, h] = dims(img), s = Math.min(1, maxSide / Math.max(w, h));
      const c = newCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))), ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return this.doc.addRGBA(ctx.getImageData(0, 0, c.width, c.height));
    });
  }
  /** Carte de localisation (tuiles OSM) au format JPEG, ou null (schéma). */
  map(site, points, wPx, hPx) {
    return this.once(`map:${site?.id}:${wPx}x${hPx}`, async () => {
      const ll = siteLatLon(site);
      if (!ll) return null;
      const m = await staticMap({ center: ll, points: points.map(p => [p.lat, p.lon]), width: wPx, height: hPx });
      if (m.kind !== 'tiles') return { schema: true, reason: m.reason };
      return { ...m, image: this.doc.addImage(m.jpeg) };
    });
  }
}

/* ---------- Polices et habillage OEG partagés (aussi utilisés par le rapport d'audit détaillé) ---------- */
/** Charge les polices Barlow / Barlow Condensed / Montserrat (repli Helvetica) et en fait les polices par défaut. */
export async function loadOegFonts(doc) {
  const res = await doc.loadFonts(Object.fromEntries(Object.entries(FONT_FILES).map(([name, [file, fallback]]) => [name, { url: asset('fonts/pdf/' + file), fallback, postscript: file.replace(/\.ttf$/, '') }])));
  doc.useFonts({ regular: F.text, bold: F.semi, italic: F.italic });
  return res;
}
/** Logo OEG rastérisé (image du document) ou null. */
export async function oegLogo(doc, assets = null) { return (assets || new Assets(doc)).logo(); }
/** Trait de pinceau (« vague » des titres) dans une boîte w × h. */
function swoosh(doc, x, y, w, h, color, opacity = 1) {
  doc.svgPath(DECOR.swoosh, { x, y, sx: w / 120, sy: h / 20, fill: color, opacity });
}
/**
 * Pied de page OEG : vagues aux couleurs du thème, silhouette de forêt, slogan, site web et ligne
 * d'identification (n° d'audit, station / feuille, empreinte, page). opts : {theme, left, center, right, slogan, website, provisional}.
 */
export function drawOegFooter(doc, { theme: th = 'ocean', center = '', right = '', slogan = DEFAULT_HEADER.slogan, website = DEFAULT_HEADER.website, provisional = false, height = null } = {}) {
  const t = theme(th);
  const W = doc.W, H = doc.H, fh = height || (W > H ? FOOT.land : FOOT.port);
  const y0 = H - fh;
  // Forêt et reflet (repère 600 × 120, sol à y = 100).
  const s = (fh + 6) / 100;
  doc.svgPath(DECOR.forestReflect, { x: 0, y: H - 100 * s - 4, scale: s, fill: t.main, opacity: 0.12 });
  doc.svgPath(DECOR.forest, { x: 0, y: H - 100 * s - 4, scale: s, fill: t.main, opacity: 0.30 });
  // Vagues (repère 1200 × 100 étiré).
  const [ww, wh] = DECOR.wavesViewBox;
  const sx = W / ww, sy = fh / wh;
  doc.svgPath(DECOR.waves[0], { x: 0, y: y0, sx, sy, fill: t.light });
  doc.svgPath(DECOR.waves[1], { x: 0, y: y0, sx, sy, fill: t.accent, opacity: 0.55 });
  doc.svgPath(DECOR.waves[2], { x: 0, y: y0, sx, sy, fill: t.main, opacity: 0.9 });
  doc.svgPath(DECOR.wavesLine, { x: 0, y: y0, sx, sy, stroke: '#ffffff', lineWidth: 0.8, opacity: 0.7 });
  // Slogan (deux lignes) et site web.
  const i = String(slogan || '').indexOf(' pour ');
  const lines = i > 0 ? [slogan.slice(0, i), slogan.slice(i + 1)] : [slogan];
  lines.forEach((l, k) => doc.text(l, M, H - 21 + k * 8.4, { font: F.semi, size: 7.2, color: NAVY }));
  doc.text(website || '', W - M - 120, H - 12.5, { font: F.semi, size: 8.6, color: '#ffffff', align: 'right', width: 120 });
  if (center || right) {
    const txt = [provisional ? 'PROVISOIRE' : '', center, right].filter(Boolean).join('  ·  ');
    const cx0 = 150, cw = W - 300;
    const size = doc.fitSize(txt, F.text, 6.4, cw, 4.6);
    const w = doc.width(txt, F.text, size);
    const x = cx0 + (cw - w) / 2;
    doc.roundRect(x - 6, y0 - 1.5, w + 12, size + 4.5, 4, { fill: '#ffffff', opacity: 0.86 });
    if (provisional) {
      const pw = doc.width('PROVISOIRE', F.text, size);
      doc.text('PROVISOIRE', x, y0 + 0.8, { font: F.bold, size, color: OEG.nc });
      doc.text(txt.slice('PROVISOIRE'.length), x + pw, y0 + 0.8, { font: F.text, size, color: INK });
    } else doc.text(txt, x, y0 + 0.8, { font: F.text, size, color: INK });
  }
}

/* ---------- Modèle de document ---------- */
const ctGridFromStore = () => store.get('grid', GRID_CT_2026.id) || GRID_CT_2026;
/** Prestataire de l'en-tête des fiches vierges : celui de la prochaine prestation programmée du type. */
function plannedProvider(sites, type, grid) {
  for (const site of sites) {
    const p = store.filter('prestation', x => x.siteId === site.id && ['prevue', 'reportee'].includes(x.status))
      .find(x => inferAuditType(grid, { site, prestation: x }) === type);
    if (p) return store.get('provider', p.providerId) || null;
  }
  return null;
}
/**
 * Modèle des fiches VIERGES (fonction pure) : tournée fictive des stations `sites` (ordre donné), compartiments du
 * type (biologie : ceux des stations, ou `compartments`), valeurs pré-remplies du référentiel uniquement (site.*).
 * mode : 'blank' (toutes les feuilles) ou 'station' (feuille 1 seule).
 */
export function blankSheetsModel({ grid = GRID_CT_2026, sites = [], auditType = '', compartments = null, provider = null, campaign = null, mode = 'blank' } = {}) {
  const list = sites.filter(Boolean);
  if (!list.length) throw new Error('Station introuvable.');
  const type = auditType && gridType(grid, auditType) ? auditType : inferAuditType(grid, { site: list[0] });
  const stations = list.map(s => makeStation({ siteId: s.id }));
  const siteMap = Object.fromEntries(list.map(s => [s.id, s]));
  const fromSites = type === 'bio' ? [...new Set(list.flatMap(s => s.compartments || []))] : [];
  const wanted = Array.isArray(compartments) && compartments.length ? compartments : fromSites.length ? fromSites : null;
  const comps = gridTypes(grid).length ? auditCompartments(grid, type, wanted) : normalizeCompartments(grid, wanted);
  const eff = expandGrid(grid, stations, siteMap, { provider });
  const ctx = { auditType: type, compartments: comps };
  const responses = prefillResponses(eff, { stations: stations.map(st => ({ key: st.key, site: siteMap[st.siteId] })), compartments: comps, auditType: type });
  return {
    mode, grid: eff, baseGrid: grid, auditType: type, typeDef: gridType(grid, type), ctx,
    header: headerOf(grid, { provider, auditType: type, campaign }),
    instances: sheetsOf(eff, responses, ctx), sites: siteMap, responses, sheetsData: {}, audit: null, provider,
    compartments: comps, chosenCompartments: Array.isArray(compartments) && compartments.length ? comps : null,
    deviations: [], mediaCounts: {}, sheetMedia: () => [], number: '', fingerprint: '', provisional: false,
    auditDate: '', auditorName: '', generatedAt: nowISO()
  };
}
/** Modèle d'une tournée enregistrée (grille effective, réponses, encadrés, médias, signatures, synthèse). */
export async function sheetsModelFromAudit(audit) {
  if (!isSheetGrid(audit?.gridSnapshot)) throw new Error('Cet audit n’utilise pas une grille « en feuilles » : utilisez le rapport d’audit détaillé.');
  const st = auditState(audit);
  const sites = {};
  for (const s of st.stations) if (s.site) sites[s.siteId] = s.site;
  if (!Object.keys(sites).length && audit.siteId) { const s = store.get('site', audit.siteId); if (s) sites[s.id] = s; }
  const provider = store.get('provider', audit.providerId) || null;
  const media = auditMedia(audit.id);
  const dateItem = Object.keys(audit.responses || {}).find(id => /^it-F2-1\.4$/.test(id));
  const auditDate = String(audit.responses?.[dateItem]?.value || audit.startedAt || '').slice(0, 10);
  const locked = !!audit.lock?.lockedAt;
  const fingerprint = locked ? audit.lock.contentHash : await auditContentHash(audit);
  return {
    mode: 'filled', grid: st.grid, baseGrid: st.baseGrid, auditType: st.auditType, typeDef: st.type, ctx: st.ctx,
    header: st.header || headerOf(st.baseGrid, { provider, auditType: st.auditType }),
    instances: st.sheets, sites, responses: audit.responses || {}, sheetsData: audit.sheets || {}, audit, provider,
    compartments: st.ctx.compartments || audit.compartments || [], chosenCompartments: null,
    deviations: st.deviations.filter(d => d.status !== 'annule'), mediaCounts: st.counts,
    sheetMedia: key => media.filter(m => m.link?.type === 'sheet' && String(m.link.itemId) === String(key) && String(m.mime || '').startsWith('image/')),
    number: audit.number, fingerprint, provisional: !locked, auditDate, auditorName: audit.auditorName || '',
    summary: st.summary, generatedAt: nowISO()
  };
}

/* ---------- Moteur de rendu ---------- */
class SheetsRenderer {
  constructor(doc, assets, model) {
    this.doc = doc; this.A = assets; this.m = model;
    this.blank = model.mode !== 'filled';
    this.stationList = model.grid?.stations || [];
    this.y = 0; this.bottom = 0; this.ctx = null;
  }
  get W() { return this.doc.W; }
  get H() { return this.doc.H; }
  resp(id) { return this.m.responses?.[id] || null; }
  data(key) { return this.m.sheetsData?.[key] || {}; }
  siteOf(sh) { return (sh?.station && this.m.sites[sh.station.siteId]) || Object.values(this.m.sites)[0] || null; }

  /* --- petits dessins --- */
  async iconAt(name, x, y, size, color) {
    const img = await this.A.icon(name, color, size > 30 ? 160 : 72);
    if (img) this.doc.drawImage(img, x, y, size, size);
  }
  /** Pastille ronde colorée avec pictogramme blanc (ou texte). */
  async pastille(cx, cy, r, { iconName = '', label = '', fill, color = '#ffffff', font = F.cond } = {}) {
    this.doc.circle(cx, cy, r, { fill });
    if (iconName) { const s = r * 1.22; await this.iconAt(iconName, cx - s / 2, cy - s / 2, s, color); }
    else if (label) {
      const size = this.doc.fitSize(label, font, r * 1.25, r * 1.7, 4);
      this.chemText(label, cx - this.doc.width(label, font, size) / 2, cy - size * 0.42, { font, size, color });
    }
  }
  /** Case à cocher (cochée : fond coloré et coche blanche). */
  box(x, y, s, { checked = false, color = NAVY, border = '#34507a' } = {}) {
    const d = this.doc;
    d.roundRect(x, y, s, s, s * 0.18, { fill: checked ? color : '#ffffff', stroke: checked ? color : border, lineWidth: 0.7 });
    if (checked) d.drawPath([['M', x + s * 0.2, y + s * 0.52], ['L', x + s * 0.42, y + s * 0.74], ['L', x + s * 0.8, y + s * 0.28]], { stroke: '#ffffff', lineWidth: s * 0.15, cap: 'round', join: 'round' });
  }
  /** Texte avec indices chimiques (O₂ → O et « 2 » en indice). */
  chemText(str, x, y, { font = F.text, size = FS, color = INK, charSpace = 0 } = {}) {
    const d = this.doc;
    if (!SUBSCRIPT.test(str)) { d.text(str, x, y, { font, size, color, charSpace }); return; }
    let cx = x;
    for (const part of String(str).split(/([₀-₉]+)/)) {
      if (!part) continue;
      if (SUBSCRIPT.test(part)) {
        const digits = [...part].map(c => String(c.codePointAt(0) - 0x2080)).join('');
        d.text(digits, cx, y + size * 0.32, { font, size: size * 0.68, color });
        cx += d.width(digits, font, size * 0.68);
      } else { d.text(part, cx, y, { font, size, color, charSpace }); cx += d.width(part, font, size, charSpace); }
    }
  }
  dots(x1, y, x2) { this.doc.dottedLine(x1, y, x2, { color: DOTS }); }

  /* --- pages --- */
  /** Libellés de pied de page d'une feuille : « Station i / n — Feuille X / N ». */
  sheetLabel(sh) {
    const n = this.stationList.length;
    const f = `Feuille ${sh.index} / ${sh.total}`;
    if (!sh.station) return n > 1 ? `Tournée (${n} stations) — ${f}` : f;
    return n > 1 ? `Station ${sh.station.index + 1} / ${n} ${sh.station.name ? '(' + upper(sh.station.name) + ')' : ''} — ${f}` : `${upper(sh.station.name)} — ${f}`;
  }
  newPage({ landscape, theme: th, label = '' }) {
    this.doc.newPage({ size: landscape ? A4_LANDSCAPE : A4, meta: { theme: th, label } });
    this.bottom = this.H - (landscape ? FOOT.land : FOOT.port) - 8;
  }
  /** Garantit h points disponibles ; sinon page de suite (en-tête compact de la feuille courante). */
  async ensure(h) {
    if (this.y + h <= this.bottom) return false;
    await this.continuation();
    return true;
  }
  async continuation() {
    const c = this.ctx;
    this.newPage({ landscape: c.landscape, theme: c.theme, label: c.label });
    this.y = await this.compactHeader(c);
  }
  /** En-tête compact des pages de suite : logo, organisme, titre de la feuille « (suite) », station et feuille. */
  async compactHeader(c) {
    const d = this.doc, t = theme(c.theme), W = this.W;
    const logo = await this.A.logo();
    if (logo) d.drawImageContain(logo, M, 8, 28, 28);
    d.text(upper(this.m.header?.org || DEFAULT_HEADER.org), M + 36, 10, { font: F.cond, size: 11, color: NAVY });
    d.text(this.m.header?.title || '', M + 36, 24, { font: F.text, size: 7.6, color: NAVY });
    const title = `${upper(c.title || '')}${c.title ? ' (suite)' : ''}`;
    const right = c.right || '';
    const rw = d.width(right, F.semi, 8);
    d.text(right, W - M - rw, 14, { font: F.semi, size: 8, color: t.dark });
    const tx = M + 36 + Math.max(d.width(upper(this.m.header?.org || DEFAULT_HEADER.org), F.cond, 11), d.width(this.m.header?.title || '', F.text, 7.6)) + 16;
    const size = d.fitSize(title, F.black, 9.5, W - M - rw - 16 - tx, 6);
    d.text(title, tx, 14, { font: F.black, size, color: t.title });
    d.line(M, 41, W - M, 41, { color: t.line, width: 0.8 });
    return 48;
  }
  /**
   * En-tête OEG complet : logo, organisme, titre résolu, sous-titre, slogan à droite et (paysage) pavé
   * « Station NOM — Feuille X / N ». Retourne la hauteur occupée.
   */
  async fullHeader({ landscape, theme: th, stationBlock = null }) {
    const d = this.doc, t = theme(th), W = this.W, h = this.m.header || {};
    const logo = await this.A.logo();
    const ls = landscape ? 56 : 60;
    if (logo) d.drawImageContain(logo, M, 7, ls, ls);
    const right = landscape ? 160 : 0;
    const tagW = 108;
    const x0 = M + ls + 12, x1 = W - M - right - tagW - 14;
    const cw = x1 - x0;
    const org = upper(h.org || DEFAULT_HEADER.org);
    d.text(org, x0, 9, { font: F.cond, size: d.fitSize(org, F.cond, landscape ? 21 : 22, cw, 12), color: NAVY, align: 'center', width: cw });
    if (h.title) d.text(h.title, x0, 35, { font: F.text, size: d.fitSize(h.title, F.text, 10.5, cw, 6), color: NAVY, align: 'center', width: cw });
    if (h.subtitle) {
      d.text(h.subtitle, x0, 50, { font: F.text, size: 10, color: OEG.sky, align: 'center', width: cw });
      d.roundRect(x0 + cw / 2 - 22, 63.5, 44, 1.8, 0.9, { fill: OEG.sky });
    }
    // Slogan « L’eau au service des milieux naturels de Guyane » + vague.
    const tx = W - M - right - tagW;
    const tag = upper(h.tagline || DEFAULT_HEADER.tagline);
    const parts = tag.match(/^(.*?SERVICE)\s+(.*?NATURELS)\s+(.*)$/) ? tag.match(/^(.*?SERVICE)\s+(.*?NATURELS)\s+(.*)$/).slice(1) : d.wrap(tag, F.cond, 6.8, tagW);
    parts.forEach((p, i) => d.text(p, tx, 12 + i * 8.2, { font: F.cond, size: 6.8, color: NAVY, charSpace: 0.55 }));
    swoosh(d, tx - 4, 12 + parts.length * 8.2 + 1, tagW, 14, OEG.sky);
    if (landscape && stationBlock) await this.stationPad(W - M - right + 8, 6, right - 8, 58, t, stationBlock);
    return landscape ? 72 : 76;
  }
  /** Pavé « Station / NOM / Feuille X / N » (ou « Tournée / n stations »). */
  async stationPad(x, y, w, h, t, { k = 'Station', name = '', sheetNo = '', tour = '' }) {
    const d = this.doc;
    d.roundRect(x, y, w, h, 8, { fill: t.light });
    d.text(k, x + 9, y + 6, { font: F.text, size: 9.5, color: NAVY });
    if (tour) {
      const tw = d.width(tour, F.semi, 6.6) + 10;
      d.roundRect(x + w - tw - 7, y + 6, tw, 10, 5, { fill: t.main });
      d.text(tour, x + w - tw - 7, y + 7.6, { font: F.semi, size: 6.6, color: '#ffffff', align: 'center', width: tw });
    }
    const nm = upper(name);
    const size = d.fitSize(nm, F.black, 20, w - 18, 8);
    d.text(nm, x + 9, y + 19 + (20 - size) * 0.45, { font: F.black, size, color: NAVY });
    swoosh(d, x + 9, y + 42, 38, 7, t.main);
    if (sheetNo) {
      const lab = 'Feuille ', lw = d.width(lab, F.text, 9), nw = d.width(sheetNo, F.bold, 9.5);
      d.text(lab, x + w - 9 - nw - lw, y + 44, { font: F.text, size: 9, color: NAVY });
      d.text(sheetNo, x + w - 9 - nw, y + 43.6, { font: F.bold, size: 9.5, color: NAVY });
    }
  }
  /** Bandeau d'information (Code SANDRE / BSS, Bassin versant ou Commune, Coordonnées RGFG95). */
  async infoStrip(site, x, y, w, h, t) {
    const d = this.doc, s = site || {};
    const bss = String(s.codeType || (this.m.auditType === 'eso' ? 'BSS' : '')).toUpperCase() === 'BSS';
    const bassin = s.bassin || s.bv || '';
    const cells = [
      { ic: 'database', k: bss ? 'Code BSS' : 'Code SANDRE', v: String(s.code || '—') },
      bss && !bassin ? { ic: 'map', k: 'Commune', v: s.commune || '—' } : { ic: 'basin', k: 'Bassin versant', v: bassin || '—' },
      { ic: 'pin', k: 'Coordonnées théoriques RGFG95', xy: [fmtXY(s.x), fmtXY(s.y)] }
    ];
    d.roundRect(x, y, w, h, 8, { fill: t.light });
    const cw = w / 3, r = Math.min(h * 0.36, 15);
    for (let i = 0; i < 3; i++) {
      const c = cells[i], cx = x + i * cw;
      if (i) d.line(cx, y + h * 0.18, cx, y + h * 0.82, { color: t.line, width: 0.9 });
      await this.pastille(cx + 14 + r, y + h / 2, r, { iconName: c.ic, fill: t.main });
      const tx = cx + 22 + 2 * r, tw = cw - (tx - cx) - 8;
      const ks = h > 40 ? 8.6 : 7.8;
      d.text(c.k, tx, y + h / 2 - ks - 3, { font: F.semi, size: ks, color: NAVY });
      if (c.xy) {
        const vs = h > 40 ? 10.5 : 9.5;
        d.text('X :', tx, y + h / 2 + 1, { font: F.semi, size: vs * 0.9, color: NAVY });
        d.text(c.xy[0], tx + 15, y + h / 2 + 0.5, { font: F.bold, size: vs, color: NAVY });
        const yx = tx + 15 + Math.max(42, d.width(c.xy[0], F.bold, vs)) + 10;
        d.text('Y :', yx, y + h / 2 + 1, { font: F.semi, size: vs * 0.9, color: NAVY });
        d.text(c.xy[1], yx + 15, y + h / 2 + 0.5, { font: F.bold, size: vs, color: NAVY });
      } else {
        const vs = d.fitSize(c.v, F.bold, h > 40 ? 14 : 12, tw, 7);
        d.text(c.v, tx, y + h / 2, { font: F.bold, size: vs, color: NAVY });
      }
    }
  }
  /** Bandeau des stations d'une tournée (feuille tournée d'une tournée de plusieurs stations). */
  async tourStrip(x, y, w, h, t) {
    const d = this.doc;
    d.roundRect(x, y, w, h, 8, { fill: t.light });
    await this.pastille(x + 14 + 12, y + h / 2, 12, { iconName: 'route', fill: t.main });
    d.text('Tournée', x + 46, y + h / 2 - 10, { font: F.bold, size: 10, color: NAVY });
    d.text(`${this.stationList.length} stations`, x + 46, y + h / 2 + 1, { font: F.text, size: 8, color: MUTED });
    let cx = x + 110;
    for (const st of this.stationList) {
      const site = this.m.sites[st.siteId] || {};
      const label = upper(st.name), code = String(site.code || st.code || '');
      const pw = Math.max(d.width(label, F.bold, 8.5), d.width(code, F.text, 7)) + 30;
      if (cx + pw > x + w - 8) { d.text('…', cx, y + h / 2 - 5, { font: F.bold, size: 10, color: NAVY }); break; }
      d.roundRect(cx, y + 5, pw, h - 10, 7, { fill: '#ffffff', stroke: t.line, lineWidth: 0.7 });
      d.circle(cx + 11, y + h / 2, 7, { fill: t.main });
      d.text(String(st.index + 1), cx + 4, y + h / 2 - 4, { font: F.cond, size: 8.5, color: '#ffffff', align: 'center', width: 14 });
      d.text(label, cx + 22, y + h / 2 - 9, { font: F.bold, size: 8.5, color: NAVY });
      d.text(code, cx + 22, y + h / 2 + 1.5, { font: F.text, size: 7, color: MUTED });
      cx += pw + 6;
    }
  }
  /** Titre de feuille en capitales (Montserrat) avec surtitre espacé et vague. Retourne la hauteur. */
  sheetTitle(title, kicker, x, y, w, t) {
    const d = this.doc;
    const T = upper(title);
    const size = d.fitSize(T, F.black, 14.5, w * (kicker ? 0.66 : 1), 9);
    d.text(T, x, y, { font: F.black, size, color: t.title });
    swoosh(d, x, y + size + 2, 54, 6, t.main);
    if (kicker) {
      const K = upper(kicker);
      const kx = x + d.width(T, F.black, size) + 22;
      const ks = d.fitSize(K, F.cond, 7, x + w - kx, 5, 0.9);
      if (kx < x + w - 60) {
        swoosh(d, kx - 2, y + 4, 26, 5, t.accent);
        d.text(K, kx + 28, y + 3, { font: F.cond, size: ks, color: t.main, charSpace: 0.9 });
      }
    }
    return size + 12;
  }
  /**
   * Début d'une feuille paysage : page, en-tête complet, bandeau d'information (ou des stations), titre.
   * Retourne la position de départ du contenu.
   */
  async startLandscape(sh) {
    const t = theme(sh.theme);
    const site = this.siteOf(sh);
    const n = this.stationList.length;
    const label = this.sheetLabel(sh);
    this.ctx = { landscape: true, theme: sh.theme, label, title: sh.title, right: sh.station ? `${upper(sh.station.name)} · Feuille ${sh.index} / ${sh.total}` : `Tournée · Feuille ${sh.index} / ${sh.total}` };
    this.newPage({ landscape: true, theme: sh.theme, label });
    const tour = sh.station && n > 1 ? `Station ${sh.station.index + 1} / ${n}` : '';
    const pad = !sh.station && n > 1 ? { k: 'Tournée', name: `${n} stations`, sheetNo: `${sh.index} / ${sh.total}` } : { k: 'Station', name: site?.name || '', sheetNo: `${sh.index} / ${sh.total}`, tour };
    let y = await this.fullHeader({ landscape: true, theme: sh.theme, stationBlock: pad });
    if (!sh.station && n > 1) await this.tourStrip(M, y, this.W - 2 * M, 34, t);
    else await this.infoStrip(site, M, y, this.W - 2 * M, 34, t);
    y += 40;
    y += this.sheetTitle(sh.title, sh.kicker && sh.kicker !== sh.title ? sh.kicker : '', M, y, this.W - 2 * M, t);
    this.y = y;
  }

  /* --- valeurs : jetons d'une cellule « Valeur / réponse » --- */
  /** Jetons (texte, cases, pointillés) d'une valeur ; mode vierge : formulaire (cases des choix, champs pointillés). */
  valueTokens(item, r, w) {
    const input = itemInput(item);
    const val = r?.value;
    const filled = r && present(formatValue(item, val));
    const words = (s, font = F.semi, color = NAVY) => String(s).split(/(\s+)/).filter(x => x && !/^\s+$/.test(x)).map(x => ({ t: 'text', s: x, font, color }));
    if (!input) return r?.status === 'NA' || !this.blank ? [] : [{ t: 'dots' }];
    if (filled && (!this.blank || r.prefilled || !isObj(val))) {
      if (!this.blank || !isObj(val)) return words(formatValue(item, val));
    }
    const shortOpts = opts => (opts || []).length && opts.length <= 4 && opts.reduce((s, o) => s + this.doc.width(String(o?.label ?? o), F.text, FS) + BOX + 8, 0) <= w;
    if (input.type === 'select') {
      if (this.blank && shortOpts(input.options)) return input.options.map(o => ({ t: 'box', label: String(o?.label ?? o), checked: false }));
      return [{ t: 'dots' }];
    }
    if (input.type === 'fields') {
      const out = [];
      const fields = input.fields || [];
      const details = new Set();
      for (const f of fields) {
        if (details.has(f.key) || (!this.blank && !fieldShown(f, val || {}))) continue;
        if (out.length) out.push({ t: 'gap', w: 7 });
        if (f.type === 'choice') {
          if (f.label) out.push(...words(f.label + ' :', F.text, INK));
          for (const o of f.options || []) {
            const ov = o?.value ?? o, ol = String(o?.label ?? o);
            out.push({ t: 'box', label: ol, checked: !!val && val[f.key] === ov });
            // Précision d'une option (« Autre : ……… ») : pointillés juste après la case, sans répéter le libellé.
            const det = fields.find(x => x !== f && !Array.isArray(x.showIf) && x.showIf?.key === f.key && x.showIf.value === ov && (x.label === ol || x.label === ov));
            if (det) { details.add(det.key); out.push({ t: 'text', s: ':', font: F.text, color: INK }, { t: 'dots', w: 46 }); }
          }
        } else {
          const lab = f.label || f.key.toUpperCase();
          if (f.showIf && !this.blank) continue;
          out.push(...words(lab + ' :', F.text, INK));
          out.push({ t: 'dots', w: f.type === 'text' && !f.showIf ? 62 : 34 });
          if (f.unit) out.push({ t: 'text', s: f.unit, font: F.text, color: INK });
        }
      }
      return out;
    }
    if (input.type === 'number' && input.unit) return [{ t: 'dots', w: Math.min(70, w - 30) }, { t: 'text', s: input.unit, font: F.text, color: INK }];
    return [{ t: 'dots' }];
  }
  /** Mise en lignes des jetons dans la largeur w : [{tokens:[{…, x, w}]}]. */
  flow(tokens, w, size = FS) {
    const d = this.doc;
    const lines = [[]];
    let x = 0;
    const tw = tok => tok.t === 'text' ? d.width(tok.s, tok.font, size) : tok.t === 'box' ? BOX + 2.6 + d.width(tok.label, F.text, size) : tok.t === 'gap' ? tok.w : tok.w || 0;
    for (const tok of tokens) {
      if (tok.t === 'dots' && !tok.w) {
        if (w - x < 26 && lines[lines.length - 1].length) { lines.push([]); x = 0; }
        lines[lines.length - 1].push({ ...tok, x, w: w - x });
        x = w; continue;
      }
      const tokW = Math.min(tw(tok), w);
      const space = tok.t === 'text' ? d.width(' ', tok.font, size) : 6;
      const cur = lines[lines.length - 1];
      const gapBefore = cur.length && tok.t !== 'gap' && cur[cur.length - 1].t !== 'gap' ? space : 0;
      if (cur.length && x + gapBefore + tokW > w) {
        if (tok.t === 'gap') continue;
        lines.push([]); x = 0;
        lines[lines.length - 1].push({ ...tok, x: 0, w: tokW }); x = tokW;
      } else { cur.push({ ...tok, x: x + gapBefore, w: tokW }); x += gapBefore + tokW; }
    }
    return lines.filter((l, i) => l.length || i === 0);
  }
  drawFlow(lines, x, y, size = FS, lh = LH) {
    const d = this.doc;
    lines.forEach((line, i) => {
      const ly = y + i * lh;
      for (const tok of line) {
        if (tok.t === 'text') this.chemText(tok.s, x + tok.x, ly, { font: tok.font, size, color: tok.color });
        else if (tok.t === 'box') { this.box(x + tok.x, ly - 0.2, BOX, { checked: tok.checked }); d.text(tok.label, x + tok.x + BOX + 2.6, ly, { font: F.text, size, color: INK }); }
        else if (tok.t === 'dots') this.dots(x + tok.x, ly + size + 0.6, x + tok.x + tok.w);
      }
    });
  }

  /* --- tableaux --- */
  /** Colonnes d'un tableau de feuille dans la largeur w. kind : 'full' | 'value' ; split : F8 (sans N° ni réf.). */
  columns(sec, w, { split = false, hasShort = true } = {}) {
    const h = sectionHeaders(sec);
    const full = (sec.columns || 'full') !== 'value';
    const narrow = w < 520;
    const stW = narrow ? 15 : 21;
    const cols = [];
    if (!split) cols.push({ key: 'no', label: h.no, w: narrow ? 20 : 25, align: 'center' });
    const labelW = full ? w * (split ? 0.27 : narrow ? 0.24 : 0.205) : w * 0.3;
    cols.push({ key: 'label', label: h.label, w: labelW });
    if (!split && hasShort) cols.push({ key: 'short', label: h.short, w: full ? (narrow ? 44 : 60) : w * 0.14, align: 'center' });
    const fixed = () => cols.reduce((s, c) => s + c.w, 0);
    if (!full) { cols.push({ key: 'value', label: h.value, w: w - fixed() }); return cols; }
    const valueW = w * (split ? 0.25 : narrow ? 0.22 : 0.245);
    cols.push({ key: 'value', label: h.value, w: valueW });
    for (const s of STATUS) cols.push({ key: s.code, label: h[s.code.toLowerCase()] || s.short, w: stW, align: 'center', status: s });
    cols.push({ key: 'obs', label: h.obs, w: w - fixed() });
    return cols;
  }
  /** Hauteur de l'en-tête de tableau (libellés coupés sur deux lignes au plus). */
  headLayout(cols) {
    const size = 7.4;
    const fits = cols.map(c => this.fitLines(c.label, F.semi, size, c.w - 4, 2, 4.8));
    return { size, lines: fits.map(f => f.lines), sizes: fits.map(f => f.size), h: Math.max(...fits.map(f => f.lines.length)) * (size + 1.6) + 6 };
  }
  /**
   * Texte en au plus maxLines lignes SANS couper un mot : la taille diminue (jusqu'à min) si nécessaire.
   * Retourne { size, lines }.
   */
  fitLines(text, font, size, w, maxLines = 2, min = 5) {
    const d = this.doc;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let s = size;
    for (; s > min; s -= 0.25) {
      if (words.some(x => d.width(x, font, s) > w)) continue;
      const lines = d.wrap(text, font, s, w);
      if (lines.length <= maxLines) return { size: s, lines };
    }
    return { size: s, lines: d.clampLines(d.wrap(text, font, s, w), maxLines, font, s, w) };
  }
  drawHead(cols, head, x, y, t, { rounded = true } = {}) {
    const d = this.doc;
    const w = cols.reduce((s, c) => s + c.w, 0);
    d.roundRect(x, y, w, head.h, rounded ? [5, 5, 0, 0] : 0, { fill: t.head });
    let cx = x;
    cols.forEach((c, i) => {
      if (i) d.line(cx, y + 2, cx, y + head.h - 2, { color: t.headText === '#ffffff' ? '#ffffff' : t.line, width: 0.5, opacity: 0.7 });
      const lines = head.lines[i];
      const ty = y + (head.h - lines.length * (head.size + 1.6)) / 2 + 0.4;
      lines.forEach((l, k) => d.text(l, cx + 2, ty + k * (head.size + 1.6) + (head.size - (head.sizes?.[i] || head.size)) / 2, { font: F.semi, size: head.sizes?.[i] || head.size, color: t.headText, align: 'center', width: c.w - 4 }));
      cx += c.w;
    });
    return head.h;
  }
  /** Prépare une ligne (mesure) : libellé, référence, valeur, observations, hauteur. */
  rowLayout(item, cols, { split = false, iconCol = false } = {}) {
    const d = this.doc;
    const r = this.resp(item.id);
    const col = k => cols.find(c => c.key === k);
    const out = { item, r, cells: {} };
    let lines = 1;
    const lc = col('label');
    const icoW = iconCol && item.icon ? 15 : 0;
    const labW = lc.w - 6 - icoW;
    let label = d.wrap(item.label, F.text, FS, labW);
    if (item.shared) {
      const badge = lc.w >= 150 ? 'Commun à la tournée' : 'tournée';
      const bw = d.width(badge, F.semi, 5.8) + 8;
      const last = label[label.length - 1] || '';
      out.badge = { text: badge, w: bw, line: d.width(last, F.text, FS) + bw + 4 <= labW ? label.length - 1 : label.length };
      if (out.badge.line === label.length) label = [...label, ''];
    }
    out.cells.label = { lines: label, icoW };
    lines = Math.max(lines, label.length);
    if (col('short')) { const f = this.fitLines(item.short || '', F.text, FS - 0.4, col('short').w - 4, 2, 4.6); out.cells.short = f.lines; out.cells.shortSize = f.size; lines = Math.max(lines, f.lines.length); }
    if (col('no')) out.cells.no = String(item.no ?? '');
    const vc = col('value');
    const vt = this.valueTokens(item, r, vc.w - 6);
    out.cells.value = this.flow(vt, vc.w - 6);
    lines = Math.max(lines, out.cells.value.length);
    if (col('obs')) {
      const obs = [];
      const comment = r?.comment || '';
      if (comment) obs.push(...d.wrap(comment, F.text, FS - 0.2, col('obs').w - 6).map(s => ({ s })));
      const extra = [];
      const n = this.m.mediaCounts?.[item.id] || 0;
      if (n) extra.push({ s: `${n} preuve${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''}`, color: MUTED, font: F.italic });
      for (const dv of (this.m.deviations || []).filter(x => x.itemId === item.id)) extra.push({ s: `Écart ${dv.number}${dv.criticalityCode ? ' (' + dv.criticalityCode + ')' : ''}`, color: OEG.nc, font: F.semi });
      if (extra.length) obs.push({ s: extra.map(e => e.s).join(' · '), color: extra.some(e => e.color === OEG.nc) ? OEG.nc : MUTED, font: extra.some(e => e.color === OEG.nc) ? F.semi : F.italic, wrap: col('obs').w - 6 });
      const flat = [];
      for (const o of obs) if (o.wrap) for (const s of d.wrap(o.s, o.font, FS - 0.6, o.wrap)) flat.push({ ...o, s }); else flat.push(o);
      out.cells.obs = flat;
      lines = Math.max(lines, flat.length || 1);
    }
    out.h = Math.max(13.6, lines * LH + 2 * PADY + 1);
    return out;
  }
  async drawRow(row, cols, x, y, t, zebra) {
    const d = this.doc;
    const { item, r } = row;
    const w = cols.reduce((s, c) => s + c.w, 0);
    const st = r?.status;
    const fill = st === 'NC' ? STATUS_OF.NC.bg : st === 'P' ? STATUS_OF.P.bg : zebra ? t.rowAlt : t.row;
    d.rect(x, y, w, row.h, { fill });
    d.line(x, y + row.h, x + w, y + row.h, { color: t.line, width: 0.45 });
    let cx = x;
    const ty = y + PADY + 0.6;
    const conformity = item.kind === 'conformity';
    for (const c of cols) {
      if (cx > x) d.line(cx, y, cx, y + row.h, { color: t.line, width: 0.45 });
      if (c.key === 'no') {
        if (t.name === 'teal') {
          const nw = Math.min(c.w - 6, Math.max(14, d.width(row.cells.no, F.cond, 8) + 7));
          d.roundRect(cx + (c.w - nw) / 2, y + row.h / 2 - 6, nw, 12, 3, { fill: t.num });
          d.text(row.cells.no, cx, y + row.h / 2 - 3.6, { font: F.cond, size: 8, color: '#ffffff', align: 'center', width: c.w });
        } else d.text(row.cells.no, cx, y + row.h / 2 - FS * 0.45, { font: F.semi, size: FS, color: t.dark, align: 'center', width: c.w });
      } else if (c.key === 'label') {
        const { lines, icoW } = row.cells.label;
        if (icoW) await this.iconAt(item.icon, cx + 4, y + row.h / 2 - 6, 12, t.main === '#ffffff' ? t.dark : t.main);
        const lx = cx + 3 + icoW;
        const ly = y + (row.h - lines.length * LH) / 2 + 0.6;
        lines.forEach((l, k) => { if (l) this.chemText(l, lx, ly + k * LH, { font: F.text, size: FS, color: t.dark }); });
        if (row.badge) {
          const bx = row.badge.line < lines.length && lines[row.badge.line] ? lx + d.width(lines[row.badge.line], F.text, FS) + 4 : lx;
          const by = ly + row.badge.line * LH - 0.6;
          d.roundRect(bx, by, row.badge.w, 8.4, 4.2, { fill: '#e8f3fc', stroke: '#6fb1e2', lineWidth: 0.5, dash: [1.4, 1] });
          d.text(row.badge.text, bx, by + 1.5, { font: F.semi, size: 5.8, color: '#0b4f9c', align: 'center', width: row.badge.w });
        }
      } else if (c.key === 'short') {
        const ls = row.cells.short || [];
        const ly = y + (row.h - ls.length * LH) / 2 + 0.6;
        ls.forEach((l, k) => d.text(l, cx + 2, ly + k * LH, { font: F.text, size: row.cells.shortSize || FS - 0.4, color: t.dark, align: 'center', width: c.w - 4 }));
      } else if (c.key === 'value') {
        const lines = row.cells.value;
        const ly = lines.length > 1 ? ty : y + (row.h - LH) / 2 + 0.6;
        this.drawFlow(lines, cx + 3, ly);
      } else if (c.status) {
        if (conformity && (item.responses || ['C', 'P', 'NC', 'NA']).includes(c.key)) {
          this.box(cx + (c.w - BOX) / 2, y + (row.h - BOX) / 2, BOX, { checked: st === c.key, color: c.status.color, border: st === c.key ? c.status.color : '#5c7493' });
        }
      } else if (c.key === 'obs') {
        const ls = row.cells.obs || [];
        if (!ls.length) { if (this.blank || conformity) this.dots(cx + 4, y + row.h - PADY - 1.5, cx + c.w - 4); }
        else ls.forEach((o, k) => d.text(o.s, cx + 3, ty + k * LH, { font: o.font || F.text, size: o.color ? FS - 0.6 : FS - 0.2, color: o.color || INK }));
      }
      cx += c.w;
    }
  }
  /** Ligne d'intertitre (sections fusionnées d'un même tableau). */
  drawSubRow(title, w, x, y, t) {
    const d = this.doc;
    d.rect(x, y, w, 13, { fill: t.light });
    d.line(x, y + 13, x + w, y + 13, { color: t.line, width: 0.45 });
    d.text(title, x + 6, y + 3.3, { font: F.bold, size: 7.4, color: t.title });
    return 13;
  }
  /** Barre de titre d'une carte de section (pastille numérotée ou pictogramme). Retourne la hauteur. */
  async sectionBar(sec, x, y, w, t, { cont = false } = {}) {
    const d = this.doc;
    d.roundRect(x, y, w, 19, [6, 6, 0, 0], { fill: t.bar });
    const no = sec.no;
    if (present(no)) await this.pastille(x + 11, y + 9.5, 8, { label: String(no), fill: t.main, font: F.cond });
    else await this.pastille(x + 11, y + 9.5, 8, { iconName: sec.icon || 'clipboard', fill: t.main });
    const title = sec.title + (cont ? ' (suite)' : '');
    d.text(title, x + 24, y + 4.6, { font: F.bold, size: d.fitSize(title, F.bold, 9.6, w - 30, 6), color: t.barText === '#ffffff' ? '#ffffff' : t.title });
    return 21;
  }
  /** Le titre de la section mérite-t-il une barre ? (pas pour une section unique homonyme de la feuille) */
  showBar(sh, secs) {
    if (secs.length > 1) return true;
    const s = secs[0];
    const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return !!s.title && norm(s.title) !== norm(sh.title) && !(String(sh.no) === '3' && /prise d.informations/i.test(s.title));
  }
  /**
   * Tableau d'une ou plusieurs sections (fusionnées : intertitres) en pleine largeur, avec saut de page propre
   * (en-tête du tableau répété).
   */
  async tableFull(sh, secs, { merged = false } = {}) {
    const t = theme(secs[0].theme || sh.theme);
    const x = M, w = this.W - 2 * M;
    const hasShort = secs.some(s => s.items.some(i => present(i.short)));
    const iconCol = secs.some(s => s.items.some(i => i.icon)) && ['9', '8'].includes(String(sh.no));
    const cols = this.columns(secs[0], w, { hasShort });
    const head = this.headLayout(cols);
    const bar = !merged ? this.showBar(sh, secs) : this.showBar(sh, secs.slice(0, 1)) && secs.length === 1;
    const rows = [];
    secs.forEach((sec, i) => {
      if (merged && i > 0 && sec.title) rows.push({ sub: sec.title, h: 13 });
      for (const it of sec.items) rows.push(this.rowLayout(it, cols, { iconCol }));
    });
    if (!rows.length) return;
    const first = rows.find(r => !r.sub);
    await this.ensure((bar ? 21 : 0) + head.h + (first?.h || 15) + 4);
    if (bar) this.y += await this.sectionBar(secs[0], x, this.y, w, t);
    this.y += this.drawHead(cols, head, x, this.y, t, { rounded: !bar });
    let z = 0;
    for (const row of rows) {
      if (this.y + row.h > this.bottom) {
        await this.continuation();
        if (bar) this.y += await this.sectionBar(secs[0], x, this.y, w, t, { cont: true });
        this.y += this.drawHead(cols, head, x, this.y, t, { rounded: !bar });
      }
      if (row.sub) { this.y += this.drawSubRow(row.sub, w, x, this.y, t); z = 0; continue; }
      await this.drawRow(row, cols, x, this.y, t, z++ % 2 === 1);
      this.y += row.h;
    }
    this.doc.roundRect(x, this.y - 0.1, w, 2.5, [0, 0, 3, 3], { fill: t.line });
    this.y += 9;
  }
  /** Section dans une boîte (x, w) sans saut de page : retourne la hauteur (mesure si draw = false). */
  async sectionBox(sh, sec, x, y, w, { draw = true, split = false } = {}) {
    const t = theme(sec.theme || sh.theme);
    const d = this.doc;
    const hasShort = sec.items.some(i => present(i.short));
    const cols = this.columns(sec, split ? w - 10 : w, { split, hasShort });
    const head = this.headLayout(cols);
    const rows = sec.items.map(it => this.rowLayout(it, cols, { split, iconCol: split || !!it.icon && String(sh.no) === '9' }));
    const barH = split ? 40 : 21;
    const total = barH + head.h + rows.reduce((s, r) => s + r.h, 0) + (split ? 10 : 3);
    if (!draw) return total;
    let cy = y;
    if (split) {
      d.roundRect(x, y, w, total, 8, { fill: '#ffffff', stroke: t.line, lineWidth: 1 });
      await this.pastille(x + 21, y + 20, 14, { label: String(sec.no || ''), fill: t.main, font: F.black });
      const title = sec.title;
      const size = d.fitSize(title, F.black, 15, w * 0.42, 9);
      d.text(title, x + 42, y + 12, { font: F.black, size, color: t.title });
      let ix = x + 42 + d.width(title, F.black, size) + 6;
      for (const ic of sec.icons || (sec.icon ? [sec.icon] : [])) { await this.iconAt(ic, ix, y + 11, 15, ic === 'drop' ? t.accent : t.dark); ix += 17; }
      if (sec.kicker) {
        const kw = Math.min(150, w * 0.3);
        const kl = d.wrap(upper(sec.kicker), F.cond, 6.2, kw, 0.7).slice(0, 3);
        const kx = x + w - kw - 8;
        swoosh(d, kx - 46, y + 12, 40, 7, t.accent);
        kl.forEach((l, i) => d.text(l, kx, y + 8 + i * 7.4, { font: F.cond, size: 6.2, color: t.main, charSpace: 0.7 }));
      }
      cy += barH;
      x += 5; w -= 10;
    } else cy += await this.sectionBar(sec, x, cy, w, t);
    cy += this.drawHead(cols, head, x, cy, t, { rounded: split });
    let z = 0;
    for (const row of rows) { await this.drawRow(row, cols, x, cy, t, z++ % 2 === 1); cy += row.h; }
    if (!split) d.roundRect(x, cy - 0.1, w, 2.5, [0, 0, 3, 3], { fill: t.line });
    return total;
  }
  /** Deux sections côte à côte (F2, F8) ; repli en pleine largeur si la paire ne tient pas sur une page. */
  async sectionPair(sh, pair, { split = false } = {}) {
    const gap = 10, w = (this.W - 2 * M - gap) / 2;
    const hs = await Promise.all(pair.map(sec => this.sectionBox(sh, sec, 0, 0, w, { draw: false, split })));
    const h = Math.max(...hs);
    const pageH = this.bottom - 48;
    const room = this.bottom - this.y;
    // Côte à côte (maquettes) si la paire tient ; sinon pleine largeur, paginée ligne à ligne (pas de grand blanc).
    if (h + 4 > room && (h > pageH || room > 140 || !split && room > 90)) { for (const sec of pair) await this.tableFull(sh, [sec]); return; }
    await this.ensure(h + 4);
    for (let i = 0; i < pair.length; i++) await this.sectionBox(sh, pair[i], M + i * (w + gap), this.y, w, { split });
    this.y += h + 9;
  }
  /** Regroupement des sections d'une feuille : paires (F2 : sections courtes ; F8 : A | B) ou tableaux pleine largeur. */
  sectionGroups(sh) {
    const secs = sh.sections.filter(s => s.items.length);
    if (sh.layout === 'split') {
      const out = [];
      for (let i = 0; i < secs.length; i += 2) out.push(secs.slice(i, i + 2).length === 2 ? { pair: secs.slice(i, i + 2), split: true } : { full: [secs[i]] });
      return out;
    }
    if (sh.mergeSections) return [{ full: secs, merged: true }];
    if (sh.key === 'organisation' || sh.scope === 'tournee') {
      const compact = s => s.items.length <= 14 && !s.items.some(i => ['longtext'].includes(itemInput(i)?.type) || i.kind === 'longtext');
      const out = [];
      for (let i = 0; i < secs.length; i++) {
        if (compact(secs[i]) && secs[i + 1] && compact(secs[i + 1])) { out.push({ pair: [secs[i], secs[i + 1]] }); i++; }
        else out.push({ full: [secs[i]] });
      }
      return out;
    }
    return secs.map(s => ({ full: [s] }));
  }

  /* --- encadrés de la feuille --- */
  blockText(sh, b) {
    const key = sh.instanceKey;
    const v = this.data(key)?.[b.key];
    return typeof v === 'string' ? v : '';
  }
  /** Hauteur (et dessin si draw) d'un encadré. */
  async block(sh, b, x, y, w, { draw = true, minH = 0, dotLines = 3 } = {}) {
    const d = this.doc, t = theme(sh.theme);
    const head = 20;
    const inner = w - 16;
    let body = 0;
    const ops = [];
    if (b.key === 'conclusion') {
      const c = this.data(sheetStoreKey(sh, 'conclusion'))?.conclusion || {};
      const opts = (b.options || []).map(([code, label]) => ({ t: 'box', label, checked: c.status === code, code }));
      const lines = this.flow(opts.flatMap((o, i) => i ? [{ t: 'gap', w: 10 }, o] : [o]), inner, 8);
      ops.push(['flow', lines, body]); body += lines.length * 12 + 4;
      const fields = b.fields || [];
      if (fields.includes('comments')) {
        const txt = c.comments || '';
        const ls = txt ? d.wrap('Commentaires : ' + txt, F.text, 7.6, inner) : ['Commentaires :'];
        ops.push(['comments', ls, body, !txt]); body += Math.max(1, ls.length) * 9.6 + 3;
      }
      const sigFields = fields.filter(f => ['controller', 'date', 'signature', 'providerSignature'].includes(f));
      if (sigFields.length) { ops.push(['sign', sigFields, body]); body += 38; }
    } else if (b.key === 'photos') {
      const txt = this.blockText(sh, b);
      const ls = txt ? d.wrap(txt, F.text, 7.6, inner) : [];
      ops.push(['text', ls, body]); body += Math.max(ls.length ? ls.length * 9.6 : 0, 0);
      const media = this.m.sheetMedia?.(sh.instanceKey) || [];
      if (media.length) { ops.push(['thumbs', media.slice(0, Math.max(1, Math.floor(inner / 70))), body + 3]); body += 52; }
      if (!ls.length && !media.length) { ops.push(['dots', dotLines, body]); body += dotLines * 11; }
    } else {
      const txt = this.blockText(sh, b);
      const ls = txt ? d.wrap(txt, F.text, 7.6, inner) : [];
      if (ls.length) { ops.push(['text', ls, body]); body += ls.length * 9.6 + 2; }
      else { ops.push(['dots', dotLines, body]); body += dotLines * 11; }
    }
    const h = Math.max(minH, head + body + 8);
    if (!draw) return h;
    d.roundRect(x, y, w, h, 7, { fill: '#ffffff', stroke: t.line, lineWidth: 0.9 });
    d.roundRect(x, y, w, head, [7, 7, 0, 0], { fill: t.bar });
    await this.pastille(x + 12, y + head / 2, 8.5, { iconName: b.icon || 'chat', fill: t.main });
    d.text(b.title, x + 25, y + 5.4, { font: F.bold, size: d.fitSize(b.title, F.bold, 9.4, w - 32, 6), color: t.barText === '#ffffff' ? '#ffffff' : t.title });
    const bx = x + 8, by = y + head + 5;
    for (const [kind, a, oy, empty] of ops) {
      if (kind === 'text') a.forEach((l, i) => this.chemText(l, bx, by + oy + i * 9.6, { font: F.text, size: 7.6, color: INK }));
      else if (kind === 'dots') for (let i = 0; i < a; i++) this.dots(bx, by + oy + 9 + i * 11, x + w - 8);
      else if (kind === 'flow') {
        a.forEach((line, i) => line.forEach(tok => {
          if (tok.t !== 'box') return;
          const col = conclColor(tok.code, t);
          this.box(bx + tok.x, by + oy + i * 12, 9, { checked: tok.checked, color: col, border: col });
          d.text(tok.label, bx + tok.x + 12, by + oy + i * 12 + 0.8, { font: tok.checked ? F.bold : F.semi, size: 8, color: tok.checked ? col : NAVY });
        }));
      } else if (kind === 'comments') {
        a.forEach((l, i) => d.text(l, bx, by + oy + i * 9.6, { font: F.text, size: 7.6, color: INK }));
        if (empty) { const lw = d.width(a[0], F.text, 7.6) + 4; this.dots(bx + lw, by + oy + 8, x + w - 8); }
      } else if (kind === 'sign') await this.signRow(a, bx, by + oy, w - 16, t);
      else if (kind === 'thumbs') {
        let tx = bx;
        for (const m of a) {
          const img = await this.A.photo({ mediaId: m.id }, { aspect: 4 / 3, maxW: 360 });
          if (img) { d.drawImageCover(img, tx, by + oy, 64, 48, { radius: 4 }); tx += 70; }
        }
      }
    }
    return h;
  }
  /** Ligne « Contrôleur / Date / Signature (/ prestataire) » d'un encadré de conclusion. */
  async signRow(fields, x, y, w, t) {
    const d = this.doc;
    const a = this.m.audit;
    const sig = a?.signatures || {};
    const parts = fields.filter(f => f !== 'signature' && f !== 'providerSignature');
    const sigs = fields.filter(f => f === 'signature' || f === 'providerSignature');
    const sigW = sigs.length ? Math.min(118, (w * 0.55) / sigs.length) : 0;
    let cx = x;
    const tw = (w - sigs.length * (sigW + 6)) / Math.max(1, parts.length);
    for (const f of parts) {
      const lab = f === 'controller' ? 'Contrôleur OEG :' : 'Date :';
      const val = f === 'controller' ? (this.blank ? '' : this.m.auditorName) : (this.blank ? '' : fmtDate(this.m.auditDate));
      d.text(lab, cx, y + 2, { font: F.semi, size: 7.6, color: NAVY });
      if (val) d.text(val, cx, y + 13, { font: F.bold, size: 8.4, color: INK });
      else this.dots(cx, y + 21, cx + tw - 8);
      cx += tw;
    }
    for (const f of sigs) {
      const role = f === 'signature' ? 'auditor' : 'provider';
      const s = sig[role];
      d.text(role === 'auditor' ? 'Signature du contrôleur' : 'Signature du prestataire', cx, y - 1, { font: F.semi, size: 6.4, color: MUTED });
      d.roundRect(cx, y + 7, sigW, 26, 4, { fill: t.light, stroke: t.line, lineWidth: 0.6 });
      if (s?.mediaId) {
        const img = await this.A.mediaImage(s.mediaId);
        if (img) d.drawImageContain(img, cx + 3, y + 9, sigW - 6, 22);
      } else if (s?.refused) d.text('Refus consigné', cx, y + 16, { font: F.italic, size: 6.8, color: OEG.nc, align: 'center', width: sigW });
      if (s?.name) d.text(s.name, cx, y + 34.5, { font: F.text, size: 5.6, color: MUTED, align: 'center', width: sigW });
      cx += sigW + 6;
    }
  }
  /** Encadrés en rangées de deux (conclusion plus étroite), avec saut de page si nécessaire. */
  async blocks(sh) {
    const list = (sh.blocks || []).filter(b => b && b.key);
    if (!list.length) return;
    const gap = 10, full = this.W - 2 * M;
    const rows = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
    for (const row of rows) {
      const ws = row.length === 1 ? [full] : row[1].key === 'conclusion' && row[0].key !== 'conclusion' ? [(full - gap) * 0.56, (full - gap) * 0.44] : [(full - gap) / 2, (full - gap) / 2];
      // Zones à écrire : trois lignes pointillées, deux si cela évite une page de suite.
      let dotLines = 3, h = 0;
      for (; dotLines >= 2; dotLines--) {
        const hs = [];
        for (let i = 0; i < row.length; i++) hs.push(await this.block(sh, row[i], 0, 0, ws[i], { draw: false, dotLines }));
        h = Math.max(...hs);
        if (this.y + h + 2 <= this.bottom) break;
      }
      if (dotLines < 2) dotLines = 3;
      if (await this.ensure(h + 2)) { const hs = []; for (let i = 0; i < row.length; i++) hs.push(await this.block(sh, row[i], 0, 0, ws[i], { draw: false, dotLines })); h = Math.max(...hs); }
      let x = M;
      for (let i = 0; i < row.length; i++) { await this.block(sh, row[i], x, this.y, ws[i], { minH: h, dotLines }); x += ws[i] + gap; }
      this.y += h + 8;
    }
  }

  /* --- module « appareils de mesure et étalonnage » (F4) --- */
  async instruments(sh) {
    const d = this.doc, t = theme(sh.theme);
    const list = sh.instruments || INSTRUMENTS;
    const idFields = sh.instrumentFields || INSTRUMENT_FIELDS;
    const calFields = sh.calibrationFields || CALIBRATION_FIELDS;
    const data = this.data(sheetStoreKey(sh, 'instruments'))?.instruments || {};
    const agents = this.data(sh.instanceKey)?.agents || '';
    const maxDays = this.m.baseGrid?.settings?.calibrationMaxDays || 30;
    const n = list.length + 1, gap = 6;
    const cw = (this.W - 2 * M - gap * (n - 1)) / n;
    const lines = idFields.length + 3;
    const ch = 21 + lines * 9.4 + 6;
    await this.ensure(18 + ch + 6);
    await this.pastille(M + 9, this.y + 8, 8.5, { iconName: 'wrench', fill: t.main });
    d.text('Appareils de mesure (in situ) et étalonnage', M + 22, this.y + 2.6, { font: F.bold, size: 9.6, color: t.title });
    if (this.stationList.length > 1) {
      const bw = d.width('Commun à la tournée', F.semi, 6) + 10, bx = M + 26 + d.width('Appareils de mesure (in situ) et étalonnage', F.bold, 9.6);
      d.roundRect(bx, this.y + 3, bw, 9, 4.5, { fill: '#e8f3fc', stroke: '#6fb1e2', lineWidth: 0.5, dash: [1.4, 1] });
      d.text('Commun à la tournée', bx, this.y + 4.6, { font: F.semi, size: 6, color: '#0b4f9c', align: 'center', width: bw });
    }
    this.y += 19;
    const y = this.y;
    for (let i = 0; i < n; i++) {
      const x = M + i * (cw + gap);
      d.roundRect(x, y, cw, ch, 6, { fill: '#ffffff', stroke: t.line, lineWidth: 0.9 });
      d.roundRect(x, y, cw, 19, [6, 6, 0, 0], { fill: t.bar });
      if (i === list.length) {
        await this.pastille(x + 11, y + 9.5, 7.5, { iconName: 'people', fill: t.main });
        d.text('Agent(s) prestataire(s) / fonction', x + 22, y + 5.4, { font: F.bold, size: d.fitSize('Agent(s) prestataire(s) / fonction', F.bold, 8, cw - 26, 5.5), color: t.title });
        const ls = agents ? d.clampLines(d.wrap(agents, F.text, 7.2, cw - 12), lines, F.text, 7.2, cw - 12) : [];
        if (ls.length) ls.forEach((l, k) => d.text(l, x + 6, y + 25 + k * 9.4, { font: F.text, size: 7.2, color: INK }));
        else for (let k = 0; k < 4; k++) this.dots(x + 6, y + 33 + k * 11, x + cw - 6);
        continue;
      }
      const ins = list[i], v = data[ins.key] || {};
      if (ins.badge) await this.pastille(x + 11, y + 9.5, 7.5, { label: ins.badge, fill: t.main, font: F.bold });
      else await this.pastille(x + 11, y + 9.5, 7.5, { iconName: ins.icon || 'gauge', fill: t.main });
      this.chemText(ins.label, x + 22, y + 5.2, { font: F.bold, size: 8.4, color: t.title });
      let ly = y + 24;
      const kv = (label, value, { warn = '' } = {}) => {
        const lab = label + ' :';
        d.text(lab, x + 6, ly, { font: F.text, size: 6.9, color: INK });
        const lx = x + 8 + d.width(lab, F.text, 6.9);
        if (present(value)) {
          const s = d.fitSize(String(value), F.semi, 7.2, x + cw - 6 - lx - (warn ? 9 : 0), 5);
          d.text(String(value), lx, ly - 0.2, { font: F.semi, size: s, color: NAVY });
          if (warn) { const wx = lx + d.width(String(value), F.semi, s) + 3; d.circle(wx + 3.2, ly + 3.4, 3.2, { fill: OEG.perf }); d.text('!', wx, ly + 0.9, { font: F.bold, size: 5.6, color: '#ffffff', align: 'center', width: 6.4 }); }
        } else this.dots(lx, ly + 7.2, x + cw - 6);
        ly += 9.4;
      };
      for (const f of idFields) {
        const val = f.type === 'date' && v[f.key] ? fmtDate(v[f.key]) : v[f.key];
        const warn = f.key === 'calibration' && v.calibration && !calibrationStatus(v.calibration, this.m.auditDate, maxDays).ok ? 'x' : '';
        kv(f.label, val, { warn });
      }
      d.line(x + 6, ly - 1.5, x + cw - 6, ly - 1.5, { color: t.line, width: 0.5 });
      ly += 1;
      const yn = (label, key, valKey) => {
        d.text(label, x + 6, ly, { font: F.text, size: 6.7, color: INK });
        let bx = x + 8 + d.width(label, F.text, 6.7);
        for (const o of ['Oui', 'Non']) { this.box(bx, ly + 0.2, 6.2, { checked: v[key] === o, color: o === 'Oui' ? STATUS_OF.C.color : STATUS_OF.NC.color }); d.text(o, bx + 7.6, ly, { font: F.text, size: 6.5, color: INK }); bx += 8 + d.width(o, F.text, 6.5) + 5; }
        if (valKey) {
          if (present(v[valKey])) d.text(String(v[valKey]), bx, ly - 0.2, { font: F.semi, size: d.fitSize(String(v[valKey]), F.semi, 7, x + cw - 6 - bx, 4.5), color: NAVY });
          else this.dots(bx, ly + 7, x + cw - 6);
        }
        ly += 9.4;
      };
      const label = k => calFields.find(f => f.key === k)?.label || k;
      yn(label('weekly').replace('Étalonnage hebdomadaire', 'Étal. hebdo.') + ' :', 'weekly', 'standards');
      yn('Vérif. matin :', 'morning', 'morningValue');
      yn('Vérif. soir :', 'evening', 'eveningValue');
    }
    this.y += ch + 8;
  }

  /* --- feuilles --- */
  async renderSheet(sh) {
    if (sh.layout === 'station') return this.stationSheet(sh);
    await this.startLandscape(sh);
    if ((sh.modules || []).includes('instruments')) await this.instruments(sh);
    for (const g of this.sectionGroups(sh)) {
      if (g.pair) await this.sectionPair(sh, g.pair, { split: !!g.split });
      else await this.tableFull(sh, g.full, { merged: !!g.merged });
    }
    await this.blocks(sh);
  }

  /* --- feuille 1 : fiche station (portrait) --- */
  async stationSheet(sh) {
    const d = this.doc;
    const site = this.siteOf(sh) || {};
    const t = theme(sh.theme || 'ocean');
    const n = this.stationList.length;
    const eso = this.m.auditType === 'eso' || String(site.codeType || '').toUpperCase() === 'BSS';
    const label = this.sheetLabel(sh);
    this.ctx = { landscape: false, theme: sh.theme, label, title: sh.title, right: `${upper(site.name)} · Feuille ${sh.index} / ${sh.total}` };
    this.newPage({ landscape: false, theme: sh.theme, label });
    const W = this.W, cw = W - 2 * M;
    let y = await this.fullHeader({ landscape: false, theme: sh.theme });
    // Bandeau « Station / NOM » avec photo fondue à droite et silhouette de la Guyane.
    const bh = 96;
    d.roundRect(M, y, cw, bh, 10, { fill: t.light });
    const rd = site.photos?.RD;
    if (rd?.mediaId || rd?.src) {
      const pw = cw * 0.64;
      const img = await this.A.photo(rd, { aspect: pw / bh, maxW: 900, fade: 0.55, key: 'banner:' + (rd.mediaId || rd.src) });
      if (img) { d.save(); d.clipRect(M, y, cw, bh, 10); d.drawImage(img, M + cw - pw, y, pw, bh); d.restore(); }
    }
    d.text('Station', M + 16, y + 9, { font: F.text, size: 14, color: NAVY });
    if (sh.station && n > 1) {
      const tour = `Station ${sh.station.index + 1} / ${n}`;
      const tw = d.width(tour, F.semi, 7.4) + 12;
      d.roundRect(M + 70, y + 10, tw, 12, 6, { fill: t.main });
      d.text(tour, M + 70, y + 12.2, { font: F.semi, size: 7.4, color: '#ffffff', align: 'center', width: tw });
    }
    const nm = upper(site.name || '');
    const ns = d.fitSize(nm, F.black, 40, cw * 0.5, 14);
    d.text(nm, M + 14, y + 26 + (40 - ns) * 0.5, { font: F.black, size: ns, color: NAVY });
    swoosh(d, M + 16, y + 70, 48, 8, t.accent);
    const kick = upper(sh.kicker || this.m.header?.program || '');
    if (kick) d.text(kick, M + 16, y + 82, { font: F.cond, size: d.fitSize(kick, F.cond, 7.4, cw * 0.55, 5, 1.3), color: t.main, charSpace: 1.3 });
    this.guyane(M + cw * 0.535, y + 6, bh - 12, site, { fill: '#ffffff', stroke: t.main, opacity: 0.92 });
    const tag = eso ? '' : 'DES RIVIÈRES VIVANTES POUR DEMAIN';
    if (tag) {
      const has = !!(rd?.mediaId || rd?.src);
      ['DES RIVIÈRES VIVANTES', 'POUR DEMAIN'].forEach((l, i) => d.text(l, M + cw - 128, y + 56 + i * 9, { font: F.cond, size: 7.6, color: has ? '#ffffff' : NAVY, charSpace: 1.1 }));
      swoosh(d, M + cw - 128, y + 76, 52, 6, has ? '#ffffff' : t.accent, 0.9);
    }
    y += bh + 7;
    await this.infoStrip(site, M, y, cw, 44, t);
    y += 52;
    // Deux colonnes.
    const gap = 10, colW = (cw - gap) / 2, xL = M, xR = M + colW + gap;
    const bottom = this.bottom - (site.photoSource ? 12 : 0);
    // Colonne gauche : carte et photographies remplissent la hauteur disponible.
    const avail = bottom - y;
    const photosH = Math.max(170, Math.min(262, avail * 0.45));
    let yl = y;
    yl += await this.mapCard(site, xL, yl, colW, t, sh, Math.max(200, avail - photosH - 8)) + 8;
    yl += await this.photosCard(site, xL, yl, colW, Math.max(150, bottom - yl), t) + 8;
    let yr = y;
    if (eso) yr += await this.esoCard(site, xR, yr, colW) + 8;
    yr += await this.accessCard(site, xR, yr, colW, t) + 8;
    yr += await this.difficultiesCard(site, xR, yr, colW) + 8;
    yr += await this.compartmentsCard(site, xR, yr, colW, t) + 8;
    yr += await this.reperesCard(sh, xR, yr, colW, bottom - yr, t) + 8;
    if (site.photoSource) d.text(site.photoSource, M, this.bottom - 9, { font: F.italic, size: 6.8, color: MUTED, align: 'center', width: cw });
    this.y = Math.max(yl, yr);
  }
  /** Silhouette de la Guyane (hauteur h) avec le point de la station. */
  guyane(x, y, h, site, { fill = '#ffffff', stroke = OEG.blue, opacity = 1, dot = '#0d3577', r = null } = {}) {
    const s = h / GUYANE.height;
    this.doc.svgPath(GUYANE.path, { x, y, scale: s, fill, stroke, lineWidth: 0.8, opacity });
    const ll = siteLatLon(site);
    if (ll) {
      const [gx, gy] = guyaneXY(ll[0], ll[1]);
      if (gx >= -5 && gx <= GUYANE.width + 5 && gy >= -5 && gy <= GUYANE.height + 5) {
        this.doc.circle(x + gx * s, y + gy * s, r || Math.max(1.6, h * 0.035), { fill: dot });
      }
    }
    return GUYANE.width * s;
  }
  /** Barre de titre d'une carte de la fiche station. */
  async cardBar(x, y, w, title, iconName, t, { fill = null, color = null } = {}) {
    const d = this.doc;
    d.roundRect(x, y, w, 22, [8, 8, 0, 0], { fill: t.bar });
    await this.pastille(x + 13, y + 11, 10, { iconName, fill: fill || t.main });
    d.text(title, x + 29, y + 5.6, { font: F.bold, size: d.fitSize(title, F.bold, 10.6, w - 36, 7), color: color || t.title });
    return 22;
  }
  symbol(kind, cx, cy, size) {
    const k = SAMPLING_KINDS[kind] || SAMPLING_KINDS.prelevement;
    const dPath = (String(kindSVG(kind, 24)).match(/ d="([^"]+)"/) || [])[1];
    if (!dPath) { this.doc.circle(cx, cy, size / 2, { fill: k.color }); return; }
    this.doc.svgPath(dPath, { x: cx - size / 2, y: cy - size / 2, scale: size / 24, fill: k.color, stroke: '#3a1a10', lineWidth: 0.5, join: 'round' });
  }
  async mapCard(site, x, y, w, t, sh, cardH = 236) {
    const d = this.doc;
    const h = cardH;
    const mh = h - 30;
    d.roundRect(x, y, w, h, 8, { fill: t.light });
    await this.cardBar(x, y, w, 'Localisation cartographique', 'map', t);
    const bx = x + 4, by = y + 25, bw = w - 8, bh = mh;
    const points = stationMapPoints(site, this.m.audit && !this.blank ? this.m.audit : null);
    const ll = siteLatLon(site);
    const map = ll ? await this.A.map(site, points, Math.round(bw * 2.6), Math.round(bh * 2.6)) : null;
    d.save(); d.clipRect(bx, by, bw, bh, 5);
    const kinds = new Set(['station']);
    if (map && !map.schema) {
      d.drawImage(map.image, bx, by, bw, bh);
      const k = bw / map.width;
      for (const p of points) { const [px, py] = map.project(p.lat, p.lon); if (px >= 0 && py >= 0 && px <= map.width && py <= map.height) { this.symbol(p.kind, bx + px * k, by + py * k, 9); kinds.add(p.kind); } }
      const [sx, sy] = map.project(ll[0], ll[1]);
      this.symbol('station', bx + sx * k, by + sy * k, 14);
      const nm = site.name || '';
      const lw = d.width(nm, F.bold, 7.6) + 6;
      d.roundRect(bx + sx * k + 8, by + sy * k - 6, lw, 11, 3, { fill: '#ffffff', opacity: 0.82 });
      d.text(nm, bx + sx * k + 11, by + sy * k - 4, { font: F.bold, size: 7.6, color: NAVY });
      // Échelle graphique.
      const sb = scaleBar(map.metersPerPixel, map.width * 0.28);
      const sw = sb.pixels * k;
      d.roundRect(bx + 5, by + bh - 23, sw + 22, 18, 2, { fill: '#ffffff', opacity: 0.92, stroke: '#14284b', lineWidth: 0.4 });
      d.rect(bx + 11, by + bh - 10, sw / 2, 2.6, { fill: '#14284b' });
      d.rect(bx + 11 + sw / 2, by + bh - 10, sw / 2, 2.6, { fill: '#ffffff', stroke: '#14284b', lineWidth: 0.4 });
      d.text('0', bx + 9, by + bh - 20, { font: F.text, size: 5.8, color: INK });
      d.text(sb.label, bx + 11 + sw - d.width(sb.label, F.text, 5.8) / 2, by + bh - 20, { font: F.text, size: 5.8, color: INK });
      d.text(map.attribution, bx, by + bh - 7, { font: F.text, size: 4.6, color: '#3b4a5a', align: 'right', width: bw - 3 });
    } else {
      // Schéma hors connexion : silhouette de la Guyane, point de la station, coordonnées et distances des points.
      d.rect(bx, by, bw, bh, { fill: '#eef6f2' });
      for (let gx = bx + 12; gx < bx + bw; gx += 24) d.line(gx, by, gx, by + bh, { color: '#dcebe3', width: 0.4 });
      for (let gy = by + 12; gy < by + bh; gy += 24) d.line(bx, gy, bx + bw, gy, { color: '#dcebe3', width: 0.4 });
      const gh = Math.min(bh - 26, bw * 0.5 * GUYANE.height / GUYANE.width);
      const gw = GUYANE.width * gh / GUYANE.height;
      const gx = bx + bw - gw - 14, gy = by + Math.max(10, (bh - gh) / 2 - 14);
      this.guyane(gx, gy, gh, null, { fill: '#d8ecdf', stroke: t.main });
      if (ll) {
        const [px, py] = guyaneXY(ll[0], ll[1]);
        const s = gh / GUYANE.height;
        this.symbol('station', gx + px * s, gy + py * s, 13);
      }
      const tx = bx + 9;
      let ty = by + 10;
      const line = (s, font = F.text, size = 7.2, color = INK) => { for (const l of d.wrap(s, font, size, bw - gw - 30)) { d.text(l, tx, ty, { font, size, color }); ty += size + 2.6; } };
      line(ll ? 'Fond de carte indisponible' : 'Coordonnées de la station à renseigner', F.bold, 8, NAVY);
      if (ll) line('(hors connexion ou tuiles non préchargées)', F.italic, 6.6, MUTED);
      ty += 3;
      if (present(site.x) && present(site.y)) { line('RGFG95 / UTM 22N', F.semi, 6.8, MUTED); line(`X : ${fmtXY(site.x)}   Y : ${fmtXY(site.y)}`, F.bold, 8, NAVY); ty += 2; }
      else if (ll) { const [ux, uy] = latLonToUtm(ll[0], ll[1], 22); line('RGFG95 / UTM 22N', F.semi, 6.8, MUTED); line(`X : ${fmtXY(ux)}   Y : ${fmtXY(uy)}`, F.bold, 8, NAVY); ty += 2; }
      if (ll) { line('WGS84', F.semi, 6.8, MUTED); line(`${fmtLL(ll[0], 'N', 'S')} · ${fmtLL(ll[1], 'E', 'O')}`, F.semi, 7.4, NAVY); ty += 3; }
      for (const p of points.slice(0, 5)) {
        if (ty > by + bh - 14) break;
        kinds.add(p.kind);
        this.symbol(p.kind, tx + 3.5, ty + 3.6, 7);
        const s = `${p.label} — ${ll ? fmtDistance(haversine(ll[0], ll[1], p.lat, p.lon)) : ''}`;
        d.text(d.clampLines(d.wrap(s, F.text, 6.5, bw - gw - 42), 1, F.text, 6.5, bw - gw - 42)[0], tx + 10, ty, { font: F.text, size: 6.5, color: INK });
        ty += 9;
      }
    }
    // Encart Guyane (avec carte) et flèche du nord.
    if (map && !map.schema) {
      d.roundRect(bx + 5, by + 5, 40, 48, 2, { fill: '#ffffff', opacity: 0.92, stroke: '#14284b', lineWidth: 0.4 });
      this.guyane(bx + 7.5, by + 7, 44, site, { fill: '#e6f3f8', stroke: t.main, dot: '#e3262b', r: 1.6 });
    }
    const nx = bx + bw - 20, ny = by + 6;
    d.svgPath('M12 1 20 23 12 18 4 23Z', { x: nx, y: ny, scale: 0.62, fill: '#ffffff', stroke: '#14284b', lineWidth: 0.8, join: 'round' });
    d.svgPath('M12 1 12 18 4 23Z', { x: nx, y: ny, scale: 0.62, fill: '#14284b' });
    d.text('N', nx, ny + 15.5, { font: F.bold, size: 7, color: '#14284b', align: 'center', width: 15 });
    d.restore();
    // Légende.
    const bio = this.m.auditType === 'bio';
    const legend = ['station', ...['prelevement', 'invertebres', 'diatomees', 'ichtyofaune'].filter(k => bio || kinds.has(k) || k === 'prelevement')];
    const lw = Math.min(bw * 0.58, 4 + Math.max(...legend.map(k => d.width(k === 'station' ? `Station : ${upper(site.name)}` : SAMPLING_KINDS[k].label, k === 'station' ? F.bold : F.text, 6.2))) + 14);
    const lh = legend.length * 8.6 + 6;
    const lx = bx + bw - lw - 5, ly = by + bh - lh - (map && !map.schema ? 11 : 5);
    d.roundRect(lx, ly, lw, lh, 2, { fill: '#ffffff', opacity: 0.94, stroke: '#14284b', lineWidth: 0.4 });
    legend.forEach((k, i) => {
      this.symbol(k, lx + 7, ly + 7.4 + i * 8.6, 6.4);
      d.text(k === 'station' ? `Station : ${upper(site.name)}` : SAMPLING_KINDS[k].label, lx + 13, ly + 4.4 + i * 8.6, { font: k === 'station' ? F.bold : F.text, size: 6.2, color: INK });
    });
    return h;
  }
  async photosCard(site, x, y, w, h, t) {
    const d = this.doc;
    d.roundRect(x, y, w, h, 8, { fill: t.light });
    await this.cardBar(x, y, w, 'Photographies de la station', 'camera', t);
    const gap = 5, pw = (w - 8 - gap) / 2, ph = (h - 22 - 6 - gap - 4) / 2;
    const photos = site.photos || {};
    for (let i = 0; i < SLOTS.length; i++) {
      const [slot, def] = SLOTS[i];
      const px = x + 4 + (i % 2) * (pw + gap), py = y + 25 + Math.floor(i / 2) * (ph + gap);
      const p = photos[slot] || {};
      const img = (p.mediaId || p.src) ? await this.A.photo(p, { aspect: pw / ph, maxW: 520 }) : null;
      if (img) d.drawImageCover(img, px, py, pw, ph, { radius: 5 });
      else {
        d.roundRect(px, py, pw, ph, 5, { fill: '#ffffff', stroke: t.line, lineWidth: 0.8, dash: [2, 1.6] });
        await this.iconAt('camera', px + pw / 2 - 12, py + ph / 2 - 18, 24, t.line);
        d.text(`Photographie ${def.toLowerCase()} à ajouter`, px, py + ph / 2 + 10, { font: F.italic, size: 6.6, color: MUTED, align: 'center', width: pw });
      }
      const cap = p.caption || def;
      const txt = `${slot} – ${cap}`;
      const cs = d.fitSize(txt, F.semi, 7.4, pw - 16, 5);
      const cwid = d.width(slot, F.bold, cs) + d.width(` – ${cap}`, F.text, cs) + 10;
      d.roundRect(px + 5, py + ph - 15, cwid, 11, 3, { fill: '#ffffff', opacity: 0.92 });
      d.text(slot, px + 10, py + ph - 13, { font: F.bold, size: cs, color: NAVY });
      d.text(` – ${cap}`, px + 10 + d.width(slot, F.bold, cs), py + ph - 13, { font: F.text, size: cs, color: NAVY });
    }
    return h;
  }
  /** Carte à barre de titre + corps texte avec grand pictogramme (accès, difficultés). */
  async iconTextCard(x, y, w, t, { title, barIcon, barFill = null, bigIcon, bigColor, lines, empty, tint = null, bar = null }) {
    const d = this.doc;
    const tw = w - 62;
    const size = lines.length > 3 ? 8 : 9;
    const wrapped = lines.flatMap(l => d.wrap(l, F.text, size, tw)).slice(0, 7);
    const bodyH = wrapped.length ? Math.max(46, wrapped.length * (size + 2.8) + 12) : 40;
    const h = 22 + bodyH;
    const tt = bar ? { ...t, bar } : t;
    d.roundRect(x, y, w, h, 8, { fill: tint || '#ffffff', stroke: t.line, lineWidth: 0.8 });
    await this.cardBar(x, y, w, title, barIcon, tt, { fill: barFill });
    if (wrapped.length) {
      await this.iconAt(bigIcon, x + 9, y + 22 + bodyH / 2 - 20, 40, bigColor);
      const ty = y + 22 + (bodyH - wrapped.length * (size + 2.8)) / 2;
      wrapped.forEach((l, i) => d.text(l, x + 56, ty + i * (size + 2.8), { font: F.text, size, color: INK }));
    } else {
      d.text(empty, x + 10, y + 28, { font: F.italic, size: 7.6, color: MUTED });
      this.dots(x + 10, y + 46, x + w - 10); this.dots(x + 10, y + 56, x + w - 10);
    }
    return h;
  }
  async accessCard(site, x, y, w, t) {
    const a = site.access || {};
    const sentences = s => String(s || '').split(/\n+|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý«])/).map(v => v.trim()).filter(Boolean);
    const lines = [...sentences(a.summary), ...sentences(a.details)];
    const modes = [...new Set([...(a.modes || []), ...(site.transportModes || [])])];
    if (modes.length) lines.push('Moyen(s) : ' + modes.join(', '));
    const m = modes.join(' ').toLowerCase();
    const big = /bateau|pirogue/.test(m) ? 'boat' : /4x4|voiture|v[ée]hicule|route/.test(m) ? 'car' : /pied|marche/.test(m) ? 'person' : 'route';
    return this.iconTextCard(x, y, w, t, { title: 'Accès / Localisation', barIcon: 'pin', bigIcon: big, bigColor: NAVY, lines, empty: 'Accès à décrire (itinéraire, durée, moyen de transport).' });
  }
  async difficultiesCard(site, x, y, w) {
    const t = theme('rust');
    const txt = String(site.difficulties || '').trim();
    const lines = txt ? (txt.length <= 90 && !txt.includes('\n') ? txt.split(/,\s+/).map((s, i, a) => s + (i < a.length - 1 ? ',' : '')) : txt.split(/\n+/)) : [];
    return this.iconTextCard(x, y, w, { ...t, title: NAVY }, { title: 'Difficultés / points d’attention', barIcon: 'warning', barFill: '#e8471c', bigIcon: 'mountain', bigColor: '#1f7fc4', lines, empty: 'Aucune difficulté signalée.', tint: '#fffaf6', bar: '#fdeee4' });
  }
  async compartmentsCard(site, x, y, w, t) {
    const d = this.doc;
    const g = this.m.baseGrid;
    const all = g?.compartments || [];
    const keys = gridType(g, this.m.auditType) ? typeCompartments(g, this.m.auditType) : all.map(c => c.key);
    const chosen = new Set(this.m.audit && !this.blank ? this.m.compartments : this.m.chosenCompartments || site.compartments || []);
    const list = all.filter(c => keys.includes(c.key));
    const year = (String(g?.code || '').match(/\d{4}/) || [])[0] || String(new Date().getFullYear());
    const rh = 15.5, h = 22 + list.length * rh + 8;
    d.roundRect(x, y, w, h, 8, { fill: '#ffffff', stroke: t.line, lineWidth: 0.8 });
    await this.cardBar(x, y, w, `Compartiments à contrôler – campagne ${year}`, 'clipboard', t);
    let cy = y + 26;
    for (const c of list) {
      const on = chosen.has(c.key);
      await this.pastille(x + 15, cy + 6, 6.6, { iconName: c.icon || 'check', fill: on ? t.main : '#9fb3c8' });
      d.text(c.label, x + 27, cy + 2, { font: on ? F.semi : F.text, size: d.fitSize(c.label, F.semi, 7.8, w - 52, 5.5), color: on ? NAVY : MUTED });
      this.box(x + w - 19, cy + 1.2, 9.6, { checked: on, color: t.main });
      cy += rh;
    }
    return h;
  }
  async esoCard(site, x, y, w) {
    const d = this.doc, t = theme('slate');
    const rows = [['Code BSS', site.code], ['Commune', site.commune], ['Libellé', site.name], ['Nature', site.nature || site.typePoint], ['Usage', site.usage], ['Aquifère', site.aquifere]];
    const rh = 11.5, h = 22 + rows.length * rh + 8;
    d.roundRect(x, y, w, h, 8, { fill: '#ffffff', stroke: t.line, lineWidth: 0.8 });
    await this.cardBar(x, y, w, 'Point d’eau souterraine', 'well', t);
    rows.forEach(([k, v], i) => {
      const ry = y + 26 + i * rh;
      d.text(k, x + 10, ry, { font: F.semi, size: 7.6, color: NAVY });
      if (present(v)) d.text(String(v), x + 70, ry, { font: F.text, size: d.fitSize(String(v), F.text, 7.6, w - 80, 5), color: INK });
      else d.text('à compléter', x + 70, ry, { font: F.italic, size: 7.2, color: MUTED });
    });
    return h;
  }
  /** « Repères terrain » : critères de la section s-F1-reperes de la station (valeurs ou pointillés). */
  async reperesCard(sh, x, y, w, maxH, t) {
    const d = this.doc;
    const items = (sh.sections || []).flatMap(s => s.items);
    const short = items.filter(i => i.kind !== 'longtext'), long = items.filter(i => i.kind === 'longtext');
    const rh = 15.5;
    const lw = Math.min(118, Math.max(...short.map(i => d.width(i.label + ' :', F.text, 7.8)), 60) + 8);
    const longLines = long.map(i => {
      const v = formatValue(i, this.resp(i.id)?.value);
      return { item: i, lines: v ? d.wrap(v, F.text, 7.8, w - 20) : [] };
    });
    let h = 22 + short.length * rh + 6;
    for (const l of longLines) h += 13 + Math.max(l.lines.length * 10, 3 * 11) + 4;
    h = Math.max(80, Math.max(h, maxH));
    if (h > maxH && maxH >= 80) h = maxH;
    d.roundRect(x, y, w, h, 8, { fill: '#ffffff', stroke: t.line, lineWidth: 0.8 });
    await this.cardBar(x, y, w, 'Repères terrain', 'edit', t);
    let cy = y + 25;
    for (const it of short) {
      const v = formatValue(it, this.resp(it.id)?.value);
      d.text(it.label + ' :', x + 9, cy + 3, { font: F.text, size: 7.8, color: NAVY });
      if (v) d.text(v, x + 9 + lw, cy + 2.6, { font: F.semi, size: d.fitSize(v, F.semi, 8, w - lw - 20, 5), color: INK });
      else this.dots(x + 9 + lw, cy + 11, x + w - 9);
      d.line(x + 6, cy + rh - 0.5, x + w - 6, cy + rh - 0.5, { color: t.line, width: 0.4 });
      cy += rh;
    }
    for (const l of longLines) {
      d.text(l.item.label + ' :', x + 9, cy + 4, { font: F.text, size: 7.8, color: NAVY });
      cy += 13;
      const room = Math.floor((y + h - 6 - cy) / 10.5);
      if (l.lines.length) d.clampLines(l.lines, Math.max(1, room), F.text, 7.8, w - 20).forEach((s, i) => d.text(s, x + 9, cy + i * 10, { font: F.text, size: 7.8, color: INK }));
      else for (let i = 0; i < Math.max(1, Math.min(Math.floor((y + h - 8 - cy) / 11), 12)); i++) this.dots(x + 9, cy + 9 + i * 11, x + w - 9);
      cy += Math.max(l.lines.length * 10, 3 * 11) + 4;
    }
    return h;
  }

  /* --- synthèse de la tournée --- */
  /** Tableau simple paginé (synthèse) : cols [{label, w, align}], rows [[cellule]] (texte ou {text, font, color, fill, pill}). */
  async simpleTable(cols, rows, t, { size = 7.4 } = {}) {
    const d = this.doc;
    const x = M, w = cols.reduce((s, c) => s + c.w, 0);
    const head = this.headLayout(cols.map(c => ({ ...c, w: c.w })));
    const lay = rows.map(r => {
      const cells = cols.map((c, i) => { const v = r[i]; const o = v && typeof v === 'object' ? v : { text: v ?? '' }; return { ...o, lines: d.wrap(String(o.text ?? ''), o.font || F.text, size, c.w - 8) }; });
      return { cells, h: Math.max(14, Math.max(...cells.map(c => c.lines.length)) * (size + 2) + 6) };
    });
    await this.ensure(head.h + (lay[0]?.h || 14) + 4);
    this.y += this.drawHead(cols, head, x, this.y, t);
    let z = 0;
    for (const row of lay) {
      if (this.y + row.h > this.bottom) { await this.continuation(); this.y += this.drawHead(cols, head, x, this.y, t); }
      d.rect(x, this.y, w, row.h, { fill: row.cells[0].rowFill || (z++ % 2 ? t.rowAlt : t.row) });
      d.line(x, this.y + row.h, x + w, this.y + row.h, { color: t.line, width: 0.45 });
      let cx = x;
      row.cells.forEach((c, i) => {
        if (i) d.line(cx, this.y, cx, this.y + row.h, { color: t.line, width: 0.45 });
        if (c.pill && c.text) {
          const pw = d.width(c.text, F.bold, size) + 10;
          const px = cols[i].align === 'center' ? cx + (cols[i].w - pw) / 2 : cx + 4;
          d.roundRect(px, this.y + row.h / 2 - 5.5, pw, 11, 5.5, { fill: c.pill });
          d.text(c.text, px, this.y + row.h / 2 - size * 0.48, { font: F.bold, size, color: '#ffffff', align: 'center', width: pw });
        } else c.lines.forEach((l, k) => d.text(l, cx + 4, this.y + 3.5 + k * (size + 2) + (c.lines.length === 1 ? (row.h - size - 7) / 2 : 0), { font: c.font || F.text, size, color: c.color || INK, align: cols[i].align || 'left', width: cols[i].w - 8 }));
        cx += cols[i].w;
      });
      this.y += row.h;
    }
    d.roundRect(x, this.y - 0.1, w, 2.5, [0, 0, 3, 3], { fill: t.line });
    this.y += 10;
  }
  async heading(title, t, iconName = 'list') {
    await this.ensure(40);
    await this.pastille(M + 9, this.y + 8, 8.5, { iconName, fill: t.main });
    this.doc.text(title, M + 23, this.y + 2.5, { font: F.bold, size: 10.4, color: t.title });
    this.y += 20;
  }
  /** Bloc de texte libre (commentaire, préconisations) dans un encadré. */
  async textCard(title, text, t, iconName) {
    const d = this.doc, w = this.W - 2 * M;
    const lines = text ? d.wrap(text, F.text, 8, w - 20) : [];
    let i = 0;
    do {
      const room = Math.floor((this.bottom - this.y - 34) / 10.4);
      if (room < 2) { await this.continuation(); continue; }
      const chunk = lines.length ? lines.slice(i, i + room) : [];
      const h = 22 + (chunk.length ? chunk.length * 10.4 : 22) + 8;
      d.roundRect(M, this.y, w, h, 7, { fill: '#ffffff', stroke: t.line, lineWidth: 0.9 });
      d.roundRect(M, this.y, w, 20, [7, 7, 0, 0], { fill: t.bar });
      await this.pastille(M + 12, this.y + 10, 8.5, { iconName, fill: t.main });
      d.text(title + (i ? ' (suite)' : ''), M + 25, this.y + 5.4, { font: F.bold, size: 9.4, color: t.title });
      if (chunk.length) chunk.forEach((l, k) => d.text(l, M + 10, this.y + 27 + k * 10.4, { font: F.text, size: 8, color: INK }));
      else d.text('Néant.', M + 10, this.y + 28, { font: F.italic, size: 8, color: MUTED });
      this.y += h + 8;
      i += Math.max(1, chunk.length);
    } while (i < lines.length);
  }
  async synthesis() {
    const d = this.doc, m = this.m, a = m.audit;
    const t = theme('navy');
    const n = this.stationList.length;
    this.ctx = { landscape: true, theme: 'navy', label: 'Synthèse de la tournée', title: 'Synthèse de la tournée', right: `Tournée ${m.number}` };
    this.newPage({ landscape: true, theme: 'navy', label: 'Synthèse de la tournée' });
    let y = await this.fullHeader({ landscape: true, theme: 'navy', stationBlock: { k: 'Tournée', name: m.number, sheetNo: '', tour: n > 1 ? `${n} stations` : '' } });
    y += this.sheetTitle('Synthèse de la tournée', 'Décomptes factuels C / P / NC / N/A — sans score global', M, y, this.W - 2 * M, t);
    this.y = y;
    // Identification et totaux.
    const provider = m.provider;
    const ident = [
      ['N° d’audit', m.number], ['Type de tournée', m.typeDef?.label || AUDIT_TYPES[m.auditType] || ''],
      ['Prestataire', provider ? `${providerHeaderName(provider)}${provider.kind && PROVIDER_KINDS[provider.kind] ? ' — ' + PROVIDER_KINDS[provider.kind] : ''}` : '—'],
      ['Date', fmtDate(m.auditDate)], ['Contrôleur OEG', m.auditorName], ['Type d’audit', a.kind === 'inopine' ? 'Inopiné' : 'Avec rendez-vous / planifié'],
      ['Stations', this.stationList.map(s => `${s.index + 1}. ${upper(s.name)} (${s.code})`).join(' · ')],
      ['Statut', a.lock?.lockedAt ? `Signé et verrouillé le ${fmtDateTime(a.lock.lockedAt)} par ${a.lock.lockedByName || ''}` : 'PROVISOIRE — tournée non signée ou non verrouillée'],
      [a.lock?.lockedAt ? 'Empreinte scellée (SHA-256)' : 'Empreinte du contenu (SHA-256)', m.fingerprint]
    ];
    const lw = 128, iw = (this.W - 2 * M) * 0.6, x0 = M;
    let iy = this.y;
    for (const [k, v] of ident) {
      const ls = d.wrap(String(v || '—'), k.startsWith('Empreinte') ? F.text : F.semi, k.startsWith('Empreinte') ? 6.6 : 8, iw - lw - 12);
      const h = Math.max(13, ls.length * 9.4 + 4);
      d.rect(x0, iy, lw, h, { fill: t.light });
      d.rect(x0 + lw, iy, iw - lw, h, { fill: '#ffffff' });
      d.line(x0, iy + h, x0 + iw, iy + h, { color: t.line, width: 0.45 });
      d.text(k, x0 + 6, iy + 3, { font: F.semi, size: 7.6, color: NAVY });
      ls.forEach((l, i) => d.text(l, x0 + lw + 6, iy + 3 + i * 9.4, { font: k.startsWith('Empreinte') ? F.text : F.semi, size: k.startsWith('Empreinte') ? 6.6 : 8, color: k === 'Statut' && !a.lock?.lockedAt ? OEG.nc : INK }));
      iy += h;
    }
    const sum = stationSummary({ audit: a, grid: m.grid, ctx: m.ctx });
    const g = sum.global;
    const tiles = [['C', 'Conformes', g.C], ['P', 'Perfectibles', g.P], ['NC', 'Non conformes', g.NC], ['NA', 'Non applicables', g.NA], ['', 'Non renseignés', g.unanswered]];
    const tx0 = M + iw + 12, tw = (this.W - M - tx0 - 4 * 6) / 5;
    tiles.forEach(([code, label, v], i) => {
      const x = tx0 + i * (tw + 6), col = STATUS_OF[code]?.color || '#8a979c';
      d.roundRect(x, this.y, tw, 58, 7, { fill: STATUS_OF[code]?.bg || '#f1f4f7', stroke: col, lineWidth: 0.8 });
      d.text(String(v), x, this.y + 8, { font: F.black, size: 20, color: col, align: 'center', width: tw });
      d.text(code ? (STATUS_OF[code].short) : '—', x, this.y + 31, { font: F.bold, size: 8, color: col, align: 'center', width: tw });
      d.text(label, x, this.y + 42, { font: F.text, size: d.fitSize(label, F.text, 7, tw - 6, 5), color: INK, align: 'center', width: tw });
    });
    d.text(`${g.total} point(s) de conformité contrôlés · ${g.values} valeur(s) renseignée(s) · ${(m.deviations || []).length} écart(s) enregistré(s)`, tx0, this.y + 64, { font: F.italic, size: 7, color: MUTED });
    this.y = Math.max(iy, this.y + 76) + 10;
    // Par station.
    const W2 = this.W - 2 * M;
    const num = v => ({ text: String(v), align: 'center' });
    await this.heading('Décomptes par station', t, 'route');
    const sc = [{ label: 'N°', w: 26, align: 'center' }, { label: 'Station', w: W2 * 0.26 }, { label: 'Code', w: 80, align: 'center' }];
    const rest = (W2 - sc.reduce((s, c) => s + c.w, 0)) / 6;
    for (const l of ['C', 'P', 'NC', 'N/A', 'Non renseignés', 'Total']) sc.push({ label: l, w: rest, align: 'center' });
    const srow = (no, name, code, c) => [no, name, code, ...[c.C, c.P, c.NC, c.NA, c.unanswered, c.total].map((v, i) => ({ text: String(v), font: i < 4 && v ? F.bold : F.text, color: i < 4 && v ? STATUS[i].color : INK }))];
    const srows = sum.stations.map(s => srow(String(s.index + 1), upper(s.name), s.code, s));
    if (sum.tournee.total || sum.tournee.values) srows.push(srow('—', 'Commun à la tournée (feuille tournée et points partagés)', '', sum.tournee));
    srows.push([{ text: '', rowFill: t.light }, { text: 'Ensemble de la tournée', font: F.bold }, '', ...[g.C, g.P, g.NC, g.NA, g.unanswered, g.total].map(v => ({ text: String(v), font: F.bold }))]);
    await this.simpleTable(sc, srows, t);
    // Par feuille.
    await this.heading('Décomptes et conclusions par feuille', t, 'clipboard');
    const sheets = sheetSummary({ audit: a, grid: m.grid, ctx: m.ctx });
    const fc = [{ label: 'Feuille', w: 50, align: 'center' }, { label: 'Station', w: 92 }, { label: 'Intitulé', w: W2 * 0.27 }];
    const fr = (W2 - fc.reduce((s, c) => s + c.w, 0) - 120) / 5;
    for (const l of ['C', 'P', 'NC', 'N/A', 'Non rens.']) fc.push({ label: l, w: fr, align: 'center' });
    fc.push({ label: 'Conclusion du contrôleur', w: 120, align: 'center' });
    const frows = sheets.map(s => [`${s.index} / ${s.sheetTotal}`, s.station ? upper(s.station.name) : 'Tournée', s.title + (s.sharedTotal ? ` (dont ${s.sharedTotal} point(s) commun(s))` : ''),
      ...[s.C, s.P, s.NC, s.NA, s.unanswered].map((v, i) => ({ text: String(v), font: i < 4 && v ? F.bold : F.text, color: i < 4 && v ? STATUS[i].color : INK })),
      s.conclusion ? { text: s.conclusionLabel, pill: conclColor(s.conclusion, t) } : { text: s.hint ? '— (' + s.hint + ')' : '—', color: MUTED, font: F.italic }]);
    await this.simpleTable(fc, frows, t);
    // Points non conformes et perfectibles.
    const sumAll = m.summary;
    const pts = [...(sumAll?.ncItems || []).map(x => ({ ...x, st: 'NC' })), ...(sumAll?.pItems || []).map(x => ({ ...x, st: 'P' }))];
    await this.heading('Points non conformes (NC) et perfectibles (P)', t, 'warning');
    if (pts.length) {
      await this.simpleTable([{ label: 'Statut', w: 44, align: 'center' }, { label: 'Code', w: 62, align: 'center' }, { label: 'Point de contrôle', w: W2 * 0.3 }, { label: 'Station', w: 92 }, { label: 'Observation', w: W2 - 44 - 62 - W2 * 0.3 - 92 }],
        pts.map(p => [{ text: STATUS_OF[p.st].short, pill: STATUS_OF[p.st].color }, p.code || '', p.label, p.stationName ? upper(p.stationName) : 'Tournée', p.comment || '—']), t);
    } else { d.text('Aucun point non conforme ni perfectible.', M + 4, this.y, { font: F.italic, size: 8, color: MUTED }); this.y += 16; }
    // Écarts.
    const devs = m.deviations || [];
    await this.heading('Écarts enregistrés', t, 'flag');
    if (devs.length) {
      const crit = code => store.all('criticality').find(c => c.code === code);
      await this.simpleTable([{ label: 'N°', w: 92 }, { label: 'Criticité', w: 84, align: 'center' }, { label: 'Station', w: 86 }, { label: 'Exigence', w: W2 * 0.26 }, { label: 'Constat', w: W2 - 92 - 84 - 86 - W2 * 0.26 }],
        devs.map(dv => [dv.number || '', { text: crit(dv.criticalityCode)?.label || dv.criticalityCode || '', pill: crit(dv.criticalityCode)?.color || t.main }, dv.stationKey ? upper(this.stationList.find(s => s.key === dv.stationKey)?.name || dv.stationKey) : 'Tournée', dv.requirement || dv.itemCode || '', dv.description || '']), t);
    } else { d.text('Aucun écart enregistré.', M + 4, this.y, { font: F.italic, size: 8, color: MUTED }); this.y += 16; }
    // Bilan et préconisations.
    await this.textCard('Commentaire et bilan de l’auditeur', a.conclusions?.comment || '', t, 'chat');
    await this.textCard('Autres préconisations', a.conclusions?.preconisations || '', t, 'edit');
    await this.signatures(t);
  }
  async signatures(t) {
    const d = this.doc, a = this.m.audit;
    const h = 92;
    await this.ensure(h + 26);
    await this.heading('Signatures', t, 'signature');
    const w = (this.W - 2 * M - 10) / 2;
    for (const [i, role] of ['auditor', 'provider'].entries()) {
      const x = M + i * (w + 10), s = a.signatures?.[role];
      d.roundRect(x, this.y, w, h, 7, { fill: '#ffffff', stroke: t.line, lineWidth: 0.9 });
      d.roundRect(x, this.y, w, 19, [7, 7, 0, 0], { fill: t.bar });
      d.text(role === 'auditor' ? 'Contrôleur OEG (auditeur)' : 'Représentant du prestataire', x + 10, this.y + 5, { font: F.bold, size: 9, color: t.title });
      if (!s) { d.text('Non signé.', x + 10, this.y + 28, { font: F.italic, size: 8, color: OEG.nc }); continue; }
      d.text(`${s.name || ''}${s.function ? ' — ' + s.function : ''}`, x + 10, this.y + 25, { font: F.semi, size: 8.4, color: INK });
      d.text(s.refused ? `Refus ou impossibilité de signer, consigné le ${fmtDateTime(s.at)}. Motif : ${s.comment || 'non précisé'}` : `Signé le ${fmtDateTime(s.at)}${s.offline ? ' (hors connexion)' : ''}`, x + 10, this.y + 36, { font: F.text, size: 7.4, color: MUTED });
      if (s.mediaId) { const img = await this.A.mediaImage(s.mediaId); if (img) d.drawImageContain(img, x + 10, this.y + 47, w * 0.5, 38, { align: 'left' }); }
      if (s.contentHash) d.text(`Empreinte à la signature : ${s.contentHash.slice(0, 32)}…`, x + 10, this.y + h - 10, { font: F.text, size: 5.6, color: MUTED });
    }
    this.y += h + 10;
    if (a.lock?.lockedAt) { d.text(`Tournée verrouillée le ${fmtDateTime(a.lock.lockedAt)} par ${a.lock.lockedByName || ''}. Toute modification ultérieure est historisée.`, M, this.y, { font: F.semi, size: 7.6, color: OEG.ok }); this.y += 14; }
  }

  /* --- document --- */
  async render({ only = null } = {}) {
    const groups = groupSheets(this.m.instances);
    const order = [...groups.tournee, ...groups.stations.flatMap(g => g.sheets)];
    for (const sh of order) {
      if (only && !only(sh)) continue;
      await this.renderSheet(sh);
    }
    if (this.m.mode === 'filled' && !only) await this.synthesis();
  }
}

/**
 * Moteur : document PDF des fiches d'un modèle (sheetsModelFromAudit, blankSheetsModel). options : only (filtre des
 * feuilles, ex. feuille 1), compress (défaut true : flux compressés). Retourne { bytes, pages, doc }.
 */
export async function buildSheetsPdf(model, { only = null, compress = true, title = '' } = {}) {
  const doc = new PDFDocument({ title: title || model.header?.title || 'Fiches de contrôle terrain', author: model.auditorName || 'Office de l’Eau de Guyane', subject: 'Fiches de contrôle terrain des prestations de prélèvement', keywords: `contrôle terrain;OEG;${model.number || 'fiche vierge'}`, autoFirstPage: false, margins: { top: 48, bottom: 52, left: M, right: M } });
  await loadOegFonts(doc);
  const assets = new Assets(doc);
  const r = new SheetsRenderer(doc, assets, model);
  if (model.provisional) doc.watermark = { text: 'PROVISOIRE', mode: 'fill', color: '#c62828', opacity: 0.09, font: F.black, size: 96 };
  const short = model.fingerprint ? `Empreinte ${model.fingerprint.slice(0, 12)}…` : '';
  doc.footerFn = (d, page, total) => {
    const meta = d.page.meta || {};
    const center = [model.number || (model.mode === 'filled' ? '' : model.mode === 'station' ? 'Fiche station' : 'Fiche vierge'), meta.label, short].filter(Boolean).join('  ·  ');
    drawOegFooter(d, { theme: meta.theme || 'ocean', center, right: `Page ${page} / ${total}`, slogan: model.header?.slogan || DEFAULT_HEADER.slogan, website: model.header?.website || DEFAULT_HEADER.website, provisional: model.provisional });
  };
  await r.render({ only });
  if (!doc.pages.length) throw new Error('Aucune feuille à imprimer.');
  const bytes = compress ? await doc.outputAsync() : doc.output();
  return { bytes, pages: doc.pages.length, doc };
}

/* ---------- API publique (écrans) ---------- */
/** Fiches de contrôle remplies d'une tournée : { bytes, filename, pages, provisional }. */
export async function generateSheetsPdf({ auditId } = {}) {
  const audit = store.get('audit', auditId);
  if (!audit) throw new Error('Audit introuvable.');
  const model = await sheetsModelFromAudit(audit);
  const { bytes, pages } = await buildSheetsPdf(model, { title: `Fiches de contrôle terrain ${audit.number}` });
  const filename = `${audit.number}_fiches_controle.pdf`;
  // Trace de la génération (empreinte du PDF), comme le rapport d'audit détaillé.
  try {
    const sha256 = await sha256Hex(bytes);
    const a = store.get('audit', audit.id);
    await store.put('audit', { ...a, reports: [...(a.reports || []), { kind: 'fiches', at: nowISO(), by: session.user?.name || '', sha256, provisional: model.provisional, pages, contentHash: model.fingerprint }] },
      { action: 'report', reason: model.provisional ? 'Fiches de contrôle provisoires (PDF)' : 'Fiches de contrôle (PDF)' });
  } catch (e) { /* la trace est facultative : le document reste fourni */ }
  return { bytes, filename, pages, provisional: model.provisional };
}

/** Sites demandés (siteIds, sinon siteId) depuis le référentiel. */
function sitesFor({ siteId = null, siteIds = null } = {}) {
  const ids = Array.isArray(siteIds) && siteIds.length ? siteIds : siteId ? [siteId] : [];
  const sites = ids.map(id => store.get('site', id)).filter(Boolean);
  if (!sites.length) throw new Error('Station introuvable.');
  return sites;
}
const typeKey = (grid, auditType, site) => (auditType && gridType(grid, auditType) ? auditType : inferAuditType(grid, { site }));

/** Fiches vierges d'une tournée (une ou plusieurs stations) : { bytes, filename, pages, provisional: false }. */
export async function generateBlankSheetsPdf({ auditType = '', siteId = null, siteIds = null, compartments = null } = {}) {
  const grid = ctGridFromStore();
  const sites = sitesFor({ siteId, siteIds });
  const type = typeKey(grid, auditType, sites[0]);
  const model = blankSheetsModel({ grid, sites, auditType: type, compartments, provider: plannedProvider(sites, type, grid), mode: 'blank' });
  const { bytes, pages } = await buildSheetsPdf(model, { title: `Fiches vierges de contrôle terrain – ${sites.map(s => s.name).join(', ')}` });
  const names = sites.slice(0, 3).map(s => fileToken(s.name || s.code)).join('-') + (sites.length > 3 ? `-et-${sites.length - 3}-autres` : '');
  return { bytes, filename: `Fiches_vierges_${type}_${names}.pdf`, pages, provisional: false };
}

/** Fiche station seule (feuille 1, portrait) : { bytes, filename, pages, provisional: false }. */
export async function generateStationSheetPdf({ siteId = null, auditType = '' } = {}) {
  const grid = ctGridFromStore();
  const sites = sitesFor({ siteId });
  const type = typeKey(grid, auditType, sites[0]);
  const model = blankSheetsModel({ grid, sites, auditType: type, provider: plannedProvider(sites, type, grid), mode: 'station' });
  const { bytes, pages } = await buildSheetsPdf(model, { only: sh => sh.layout === 'station', title: `Fiche station ${sites[0].name}` });
  return { bytes, filename: `Fiche_station_${fileToken(sites[0].name || sites[0].code)}.pdf`, pages, provisional: false };
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export { parseSvgPath };
