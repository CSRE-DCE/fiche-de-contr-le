/* Générateur PDF sans dépendance (PDF 1.4) : mise en page en flux (titres, paragraphes, tableaux avec en-têtes
 * répétés, listes clé / valeur, images, filigrane, en-têtes et pieds de page « page X / Y ») ET dessin libre
 * (fiches de contrôle terrain) : couleurs de remplissage / trait, opacité, rectangles arrondis, cercles, ellipses,
 * courbes de Bézier, chemins (dont les tracés SVG « d », arcs compris), découpage (clip), pointillés.
 *
 * - Polices : Helvetica standard (repli, aucune incorporation) et polices TrueType INCORPORÉES (fonts/pdf/*.ttf,
 *   encodage WinAnsi, /Widths calculées depuis cmap + hmtx, FontDescriptor, FontFile2). Noms logiques :
 *   'regular', 'bold', 'italic' (Helvetica par défaut, réassignables à une police incorporée : useFonts) et ceux
 *   enregistrés (registerFont / loadFonts) ; une police absente se replie sur sa police de secours.
 * - Texte : encodage WinAnsi ; les caractères hors WinAnsi sont substitués (₂ → 2, ≈ → ~, ≤ → <=, ≥ → >=,
 *   → → ->, ✓ → v…), un caractère irreprésentable devient « ? ». Mesure (width) et retour à la ligne (wrap).
 * - Images : JPEG (DCTDecode, avec masque de transparence facultatif) et RGBA (canvas) avec transparence
 *   (SMask), compressées en FlateDecode via CompressionStream('deflate') lorsque le navigateur le permet.
 * - Pages de formats et d'orientations différents dans un même document (newPage({ size, landscape })).
 * - Sortie : output() (synchrone, flux non compressés : rétrocompatible) ou outputAsync() (flux compressés).
 * Coordonnées : points PDF, origine en HAUT à gauche de la page (y vers le bas). Fichier pur (sans DOM).
 */

export const A4 = [595.28, 841.89];
export const A4_LANDSCAPE = [841.89, 595.28];

/* ---------- Encodage WinAnsi ---------- */
const WIN_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
/** Code WinAnsi (0–255) → caractère Unicode (pour les métriques des polices TrueType). */
const WIN_UNICODE = (() => {
  const t = new Array(256).fill(0);
  for (let c = 32; c < 127; c++) t[c] = c;
  for (let c = 0xA0; c <= 0xFF; c++) t[c] = c;
  for (const [ch, code] of Object.entries(WIN_EXTRA)) t[code] = ch.codePointAt(0);
  return t;
})();
/** Substitutions des caractères hors WinAnsi (indices, symboles mathématiques, flèches, espaces fines…). */
export const SUBSTITUTIONS = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-',
  '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
  '≈': '~', '≃': '~', '≅': '~', '∼': '~', '≤': '<=', '⩽': '<=', '≥': '>=', '⩾': '>=', '≠': '!=', '−': '-', '∓': '-/+', '√': 'V',
  '∞': 'inf.', 'π': 'pi', 'Ω': 'Ohm', 'Δ': 'D', 'α': 'a', 'β': 'b', 'γ': 'g', 'μ': 'µ', 'σ': 's', 'θ': 'th', 'λ': 'l',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '↑': '^', '↓': 'v', '➜': '->', '▶': '>', '◀': '<',
  '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '☐': '[ ]', '☑': '[x]', '☒': '[x]', '◌': 'o', '●': '•', '○': 'o', '■': '•', '□': '[ ]',
  '▲': '^', '▼': 'v', '⚠': '!', '★': '*', '☆': '*', '♦': '•', '◆': '•',
  '\u202F': '\u00A0', '\u2007': '\u00A0', '\u2009': ' ', '\u200A': ' ', '\u2002': ' ', '\u2003': ' ', '\u2004': ' ', '\u2005': ' ', '\u2006': ' ', '\u3000': ' ',
  '\u200B': '', '\u200C': '', '\u200D': '', '\u2060': '', '\uFEFF': '', '\u00AD': '',
  '‐': '-', '‑': '-', '‒': '-', '―': '—', '′': '\'', '″': '"', '‟': '"', '‛': '\'',
  'ō': 'o', 'ā': 'a', 'ē': 'e', 'ī': 'i', 'ū': 'u', '\t': '  '
};
function encodeChar(ch) {
  const c = ch.codePointAt(0);
  if (c >= 32 && c < 127) return [c];
  if (WIN_EXTRA[ch] !== undefined) return [WIN_EXTRA[ch]];
  if (c >= 0xA0 && c <= 0xFF && c !== 0xAD) return [c];
  if (SUBSTITUTIONS[ch] !== undefined && SUBSTITUTIONS[ch] !== ch) return [...SUBSTITUTIONS[ch]].flatMap(encodeChar);
  if (c === 10 || c === 13) return [32];
  const base = ch.normalize('NFD')[0];
  if (base && base !== ch) { const b = base.codePointAt(0); if (b >= 32 && b < 127) return [b]; }
  if (c < 32) return [];
  return [63]; // « ? » : caractère non représentable (emoji…)
}
/** Chaîne → codes WinAnsi (substitutions appliquées). */
export function toWinAnsi(str) { const out = []; for (const ch of String(str ?? '')) out.push(...encodeChar(ch)); return out; }
/** Chaîne telle qu'elle sera imprimée (après substitution des caractères hors WinAnsi). */
export function pdfSafeText(str) { return toWinAnsi(str).map(c => String.fromCodePoint(WIN_UNICODE[c] || 63)).join(''); }

/* ---------- Métriques Helvetica (AFM, millièmes d'em) pour les codes 32–126 ---------- */
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const HIGH = { 0x80: 556, 0x82: 222, 0x84: 333, 0x85: 1000, 0x8C: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0x9C: 944, 0xA0: 278, 0xAB: 556, 0xB0: 400, 0xB1: 584, 0xB2: 333, 0xB3: 333, 0xB5: 556, 0xB7: 278, 0xBB: 556, 0xC6: 1000, 0xD7: 584, 0xDF: 611, 0xE6: 889, 0xF7: 584 };
function helvWidth(code, bold) {
  const t = bold ? HELVB : HELV;
  if (code >= 32 && code <= 126) return t[code - 32];
  if (HIGH[code]) return HIGH[code];
  if (code >= 0xC0) {
    const base = String.fromCharCode(code).normalize('NFD')[0].charCodeAt(0);
    if (base >= 32 && base <= 126) return t[base - 32];
  }
  return 556;
}
const stdFont = (key, base, bold) => ({ key, base, type: 'std', bold, widths: Array.from({ length: 256 }, (_, c) => helvWidth(c, bold)), ascent: 718, descent: -207, capHeight: 718 });
/** Polices standard (jamais incorporées) : clés F1 à F3 (compatibilité du rapport d'audit). */
const STD_FONTS = { helvetica: stdFont('F1', 'Helvetica', false), 'helvetica-bold': stdFont('F2', 'Helvetica-Bold', true), 'helvetica-oblique': stdFont('F3', 'Helvetica-Oblique', false) };
const STD_ALIASES = { regular: 'helvetica', bold: 'helvetica-bold', italic: 'helvetica-oblique' };

/* ---------- Polices TrueType ---------- */
/**
 * Lecture des tables utiles d'une police TrueType (sfnt) : nom PostScript, unités par em, boîte englobante,
 * ascendante / descendante, hauteur des capitales, angle d'italique, graisse, chasses des codes WinAnsi 0–255
 * (en millièmes d'em, via la table cmap format 4 et hmtx). Lève une erreur si le fichier n'est pas une police.
 */
export function parseTrueType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = dv.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x74727565) throw new Error('Police TrueType attendue');
  const tables = {};
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const p = 12 + 16 * i;
    const name = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    tables[name] = { offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (!tables[t]) throw new Error(`Police TrueType incomplète (table ${t} absente)`);
  const head = tables.head.offset, hhea = tables.hhea.offset;
  const upm = dv.getUint16(head + 18) || 1000;
  const k = 1000 / upm;
  const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)].map(v => Math.round(v * k));
  const macStyle = dv.getUint16(head + 44);
  const ascent = Math.round(dv.getInt16(hhea + 4) * k), descent = Math.round(dv.getInt16(hhea + 6) * k);
  const nHMetrics = dv.getUint16(hhea + 34);
  let capHeight = Math.round(ascent * 0.7), weight = (macStyle & 1) ? 700 : 400;
  if (tables['OS/2']) {
    const os2 = tables['OS/2'].offset;
    weight = dv.getUint16(os2 + 4) || weight;
    if (dv.getUint16(os2) >= 2 && tables['OS/2'].length >= 90) capHeight = Math.round(dv.getInt16(os2 + 88) * k) || capHeight;
  }
  let italicAngle = 0, fixed = false;
  if (tables.post) { const p = tables.post.offset; italicAngle = dv.getInt16(p + 4) + dv.getUint16(p + 6) / 65536; fixed = dv.getUint32(p + 12) !== 0; }
  // cmap : sous-table Unicode BMP format 4 ((3,1) de préférence, sinon (0,x)).
  const cm = tables.cmap.offset;
  let sub = null;
  const nSub = dv.getUint16(cm + 2);
  for (let i = 0; i < nSub; i++) {
    const pid = dv.getUint16(cm + 4 + 8 * i), eid = dv.getUint16(cm + 6 + 8 * i), off = cm + dv.getUint32(cm + 8 + 8 * i);
    if (dv.getUint16(off) !== 4) continue;
    if ((pid === 3 && eid === 1) || (pid === 0 && !sub)) sub = off;
  }
  if (sub === null) throw new Error('Police TrueType sans table cmap Unicode (format 4)');
  const segX2 = dv.getUint16(sub + 6), seg = segX2 / 2;
  const endP = sub + 14, startP = endP + segX2 + 2, deltaP = startP + segX2, rangeP = deltaP + segX2;
  const glyphOf = c => {
    for (let i = 0; i < seg; i++) {
      const end = dv.getUint16(endP + 2 * i);
      if (c > end) continue;
      const start = dv.getUint16(startP + 2 * i);
      if (c < start) return 0;
      const delta = dv.getInt16(deltaP + 2 * i), range = dv.getUint16(rangeP + 2 * i);
      if (!range) return (c + delta) & 0xFFFF;
      const g = dv.getUint16(rangeP + 2 * i + range + 2 * (c - start));
      return g ? (g + delta) & 0xFFFF : 0;
    }
    return 0;
  };
  const hm = tables.hmtx.offset;
  const advance = g => dv.getUint16(hm + 4 * Math.min(g, nHMetrics - 1));
  const widths = WIN_UNICODE.map(u => (u ? Math.round(advance(glyphOf(u)) * k) : 0));
  const missing = WIN_UNICODE.map((u, c) => (u && c >= 32 && !glyphOf(u) ? c : -1)).filter(c => c >= 0);
  // Nom PostScript (name ID 6).
  let psName = '';
  if (tables.name) {
    const nm = tables.name.offset, count = dv.getUint16(nm + 2), strs = nm + dv.getUint16(nm + 4);
    for (let i = 0; i < count && !psName; i++) {
      const r = nm + 6 + 12 * i;
      if (dv.getUint16(r + 6) !== 6) continue;
      const pid = dv.getUint16(r), len = dv.getUint16(r + 8), off = strs + dv.getUint16(r + 10);
      let s = '';
      if (pid === 3 || pid === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(dv.getUint16(off + j));
      else for (let j = 0; j < len; j++) s += String.fromCharCode(b[off + j]);
      psName = s;
    }
  }
  psName = (psName || 'EmbeddedFont').replace(/[^A-Za-z0-9+\-_]/g, '');
  return { psName, upm, bbox, ascent, descent, capHeight, italicAngle, weight, fixed, widths, missing, italic: italicAngle !== 0 || !!(macStyle & 2) };
}

/* ---------- Compression ---------- */
/** Compression zlib (FlateDecode) via CompressionStream('deflate') ; null si le navigateur ne la propose pas. */
export async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { return null; }
}

/* ---------- JPEG ---------- */
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Image JPEG attendue');
  let p = 2;
  while (p < bytes.length) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    const m = bytes[p + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(m)) {
      return { height: (bytes[p + 5] << 8) | bytes[p + 6], width: (bytes[p + 7] << 8) | bytes[p + 8], components: bytes[p + 9] };
    }
    p += 2 + len;
  }
  throw new Error('Dimensions JPEG introuvables');
}

/* ---------- Tracés SVG ---------- */
/**
 * Tracé SVG (attribut « d ») → segments absolus [['M', x, y] | ['L', x, y] | ['C', x1, y1, x2, y2, x, y] | ['Z']].
 * Toutes les commandes (M L H V C S Q T A Z, absolues et relatives) ; les arcs et quadratiques sont convertis en
 * courbes de Bézier cubiques.
 */
export function parseSvgPath(d) {
  const toks = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = null, lcy = null, lqx = null, lqy = null;
  const isCmd = t => /^[A-Za-z]$/.test(t);
  const num = () => Number(toks[i++]);
  const flag = () => { // drapeaux d'arc éventuellement collés (« 0 1 0 » ou « 010 »)
    const t = toks[i];
    if (t.length > 1 && /^[01]/.test(t)) { toks[i] = t.slice(1); return Number(t[0]); }
    i++; return Number(t);
  };
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { out.push(['Z']); x = sx; y = sy; lcx = lqx = null; if (!isCmd(toks[i] || 'Z')) cmd = ''; continue; }
    if (i >= toks.length || isCmd(toks[i])) continue;
    if (C === 'M') {
      x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; out.push(['M', x, y]);
      cmd = rel ? 'l' : 'L'; lcx = lqx = null;
    } else if (C === 'L') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); out.push(['L', x, y]); lcx = lqx = null; }
    else if (C === 'H') { x = (rel ? x : 0) + num(); out.push(['L', x, y]); lcx = lqx = null; }
    else if (C === 'V') { y = (rel ? y : 0) + num(); out.push(['L', x, y]); lcx = lqx = null; }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = (rel ? x : 0) + num(); y1 = (rel ? y : 0) + num(); }
      else { x1 = lcx === null ? x : 2 * x - lcx; y1 = lcy === null ? y : 2 * y - lcy; }
      const x2 = (rel ? x : 0) + num(), y2 = (rel ? y : 0) + num(), ex = (rel ? x : 0) + num(), ey = (rel ? y : 0) + num();
      out.push(['C', x1, y1, x2, y2, ex, ey]); lcx = x2; lcy = y2; lqx = null; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = (rel ? x : 0) + num(); qy = (rel ? y : 0) + num(); }
      else { qx = lqx === null ? x : 2 * x - lqx; qy = lqy === null ? y : 2 * y - lqy; }
      const ex = (rel ? x : 0) + num(), ey = (rel ? y : 0) + num();
      out.push(['C', x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey]);
      lqx = qx; lqy = qy; lcx = null; x = ex; y = ey;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
      const ex = (rel ? x : 0) + num(), ey = (rel ? y : 0) + num();
      for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey)) out.push(c);
      x = ex; y = ey; lcx = lqx = null;
    } else i++;
  }
  return out;
}
/** Arc elliptique SVG → courbes de Bézier cubiques (segments ≤ 90°). */
function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [['L', x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = phiDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (!!large === !!sweep) co = -co;
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs, k = 4 / 3 * Math.tan(step / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * step, b = a + step;
    const [ax, ay] = pt(a), [bx, by] = pt(b), [dax, day] = der(a), [dbx, dby] = der(b);
    out.push(['C', ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, s === segs - 1 ? x2 : bx, s === segs - 1 ? y2 : by]);
  }
  return out;
}

const hex = bytes => bytes.map(b => b.toString(16).padStart(2, '0')).join('');
const num = n => { const r = Math.round(n * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
function rgb(c) {
  if (!c) return [0, 0, 0];
  if (Array.isArray(c)) return c;
  let h = String(c).replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; };
const KAPPA = 0.5522847498;

export class PDFDocument {
  /**
   * options : title, author, subject, keywords, margins {top, bottom, left, right}, pageSize ([largeur, hauteur]
   * en points ; A4 portrait par défaut), autoFirstPage (false : aucune page tant que newPage() n'est pas appelé).
   */
  constructor({ title = '', author = '', subject = '', keywords = '', margins = {}, pageSize = A4, autoFirstPage = true } = {}) {
    this.info = { title, author, subject, keywords };
    this.pageSize = pageSize;
    this.W = pageSize[0]; this.H = pageSize[1];
    this.m = { top: 62, bottom: 52, left: 42, right: 42, ...margins };
    this.pages = []; this.images = []; this.y = 0; this.page = null;
    this.fonts = { ...STD_FONTS };
    this.aliases = { ...STD_ALIASES };
    this.fallbacks = {};
    this.gstates = new Map();
    this.headerFn = null; this.footerFn = null; this.watermark = null;
    /** Couleurs par défaut de la mise en page en flux (titres, tableaux, listes clé / valeur), modifiables. */
    this.style = { heading: '#003d7a', rule: '#00ac97', tableHead: '#003d7a', tableHeadText: '#ffffff', zebra: '#f5f8f9', border: '#cfdadd', labelColor: '#0c447c', labelFill: '#eef4f9', text: '#10202b' };
    this._finalized = false;
    if (autoFirstPage) this.newPage();
  }
  get contentWidth() { return this.W - this.m.left - this.m.right; }
  /**
   * Nouvelle page. opts.size : [largeur, hauteur] (défaut : format de la page courante, sinon pageSize) ;
   * opts.landscape : true / false force l'orientation ; opts.meta : données libres (pied de page…).
   */
  newPage({ size = null, landscape = null, meta = null } = {}) {
    let [w, h] = size || (this.page ? [this.page.W, this.page.H] : this.pageSize);
    if (landscape === true && h > w) [w, h] = [h, w];
    if (landscape === false && w > h) [w, h] = [h, w];
    this.page = { ops: [], W: w, H: h, meta: meta || (this.page?.meta ? { ...this.page.meta } : {}) };
    this.pages.push(this.page);
    this.W = w; this.H = h;
    this.y = this.m.top;
    if (this.onNewPage) this.onNewPage(this);
    return this;
  }
  ensure(h) { if (this.y + h > this.H - this.m.bottom) this.newPage(); return this; }
  remaining() { return this.H - this.m.bottom - this.y; }
  op(s) { this.page.ops.push(s); }

  /* --- polices --- */
  /**
   * Enregistre une police TrueType sous un nom logique (ex. 'barlow-bold') ; fallback : police de secours si
   * l'enregistrement échoue (nom logique ou standard) ; postscript : nom PostScript à déclarer (sinon celui de la
   * table « name » de la police). Retourne la description de la police ou null.
   */
  registerFont(name, bytes, { fallback = 'regular', postscript = '' } = {}) {
    this.fallbacks[name] = fallback;
    try {
      const info = parseTrueType(bytes);
      if (postscript) info.psName = String(postscript).replace(/[^A-Za-z0-9+\-_]/g, '') || info.psName;
      const key = 'F' + (Object.values(this.fonts).length + 1);
      this.fonts[name] = { ...info, key, base: info.psName, type: 'ttf', bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), packed: null, bold: info.weight >= 600 };
      return this.fonts[name];
    } catch (e) { return null; }
  }
  /**
   * Charge et incorpore des polices TrueType : { nom: { url, fallback, postscript } } ; fichiers compressés dès le chargement.
   * Une police introuvable se replie sur sa police de secours. Retourne { loaded: [noms], failed: [noms] }.
   */
  async loadFonts(map, { fetchFn = (u) => fetch(u) } = {}) {
    const loaded = [], failed = [];
    await Promise.all(Object.entries(map).map(async ([name, spec]) => {
      const { url, fallback = 'regular', postscript = '' } = typeof spec === 'string' ? { url: spec } : spec;
      this.fallbacks[name] = fallback;
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const f = this.registerFont(name, bytes, { fallback, postscript });
        if (!f) throw new Error('police illisible');
        f.packed = await deflate(bytes);
        loaded.push(name);
      } catch (e) { failed.push(name); }
    }));
    return { loaded, failed };
  }
  /** Réassigne les noms logiques ('regular', 'bold', 'italic'…) à des polices enregistrées (si présentes). */
  useFonts(map) { for (const [logical, name] of Object.entries(map)) if (this.fonts[name]) this.aliases[logical] = name; return this; }
  /** Police effective d'un nom logique (alias, puis police de secours, puis Helvetica). */
  fontOf(name = 'regular') {
    const seen = new Set();
    let n = name;
    while (n && !seen.has(n)) {
      seen.add(n);
      if (this.aliases[n] && this.aliases[n] !== n && !this.fonts[n]) { n = this.aliases[n]; continue; }
      if (this.fonts[n]) return this.fonts[n];
      n = this.fallbacks[n] || this.aliases[n];
    }
    return this.fonts[this.aliases.regular] || STD_FONTS.helvetica;
  }
  hasFont(name) { return this.fontOf(name).type === 'ttf'; }
  /** Largeur d'une chaîne (points) ; charSpace : espacement additionnel entre caractères. */
  width(str, font = 'regular', size = 10, charSpace = 0) {
    const f = this.fontOf(font);
    const codes = toWinAnsi(str);
    return codes.reduce((s, c) => s + (f.widths[c] || 0), 0) * size / 1000 + charSpace * Math.max(0, codes.length - 1);
  }
  /** Retour à la ligne : lignes tenant dans maxWidth (mots trop longs coupés). */
  wrap(str, font = 'regular', size = 10, maxWidth = this.contentWidth, charSpace = 0) {
    const out = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      const words = para.split(/([ \t]+)/).filter(w => w !== '');
      let line = '';
      for (const w of words) {
        const cand = line + w;
        if (this.width(cand.trimEnd(), font, size, charSpace) <= maxWidth || !line.trim()) {
          if (!line.trim() && this.width(w, font, size, charSpace) > maxWidth) {
            // mot plus long que la ligne : découpage caractère par caractère
            let chunk = '';
            for (const ch of w) { if (chunk && this.width(chunk + ch, font, size, charSpace) > maxWidth) { out.push(chunk); chunk = ''; } chunk += ch; }
            line = chunk;
          } else line = cand;
        } else { out.push(line.trimEnd()); line = /^[ \t]+$/.test(w) ? '' : w; }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  /** Lignes limitées à maxLines (dernière ligne terminée par « … » si le texte est tronqué). */
  clampLines(lines, maxLines, font = 'regular', size = 10, maxWidth = this.contentWidth) {
    if (!maxLines || lines.length <= maxLines) return lines;
    const out = lines.slice(0, maxLines);
    let last = out[maxLines - 1];
    while (last && this.width(last + ' …', font, size) > maxWidth) last = last.slice(0, -1);
    out[maxLines - 1] = last.trimEnd() + ' …';
    return out;
  }
  /** Plus grande taille (≤ size, ≥ min) pour que le texte tienne sur une ligne de largeur maxWidth. */
  fitSize(str, font, size, maxWidth, min = 4, charSpace = 0) {
    let s = size;
    while (s > min && this.width(str, font, s, charSpace) > maxWidth) s -= 0.25;
    return s;
  }

  /* --- état graphique --- */
  save() { this.op('q'); return this; }
  restore() { this.op('Q'); return this; }
  /** Nom de l'état graphique d'opacité (remplissage, trait). */
  alpha(fill = 1, stroke = fill) {
    const k = `${num(fill)}/${num(stroke)}`;
    if (!this.gstates.has(k)) this.gstates.set(k, { name: 'GS' + (this.gstates.size + 1), fill, stroke });
    return this.gstates.get(k).name;
  }
  _paint({ fill = null, stroke = null, lineWidth = 0.6, opacity = 1, strokeOpacity = null, dash = null, cap = null, join = null, evenodd = false } = {}) {
    const pre = [];
    if (opacity < 1 || (strokeOpacity !== null && strokeOpacity < 1)) pre.push(`/${this.alpha(opacity, strokeOpacity ?? opacity)} gs`);
    if (fill) { const [r, g, b] = rgb(fill); pre.push(`${num(r)} ${num(g)} ${num(b)} rg`); }
    if (stroke) {
      const [r, g, b] = rgb(stroke);
      pre.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(lineWidth)} w`);
      if (dash) pre.push(`[${dash.map(num).join(' ')}] 0 d`);
      if (cap !== null) pre.push(`${{ butt: 0, round: 1, square: 2 }[cap] ?? cap} J`);
      if (join !== null) pre.push(`${{ miter: 0, round: 1, bevel: 2 }[join] ?? join} j`);
    }
    const op = fill && stroke ? (evenodd ? 'B*' : 'B') : fill ? (evenodd ? 'f*' : 'f') : stroke ? 'S' : 'n';
    return { pre: pre.join(' '), op };
  }
  /** Segments absolus (repère haut-gauche) → opérateurs de chemin PDF. */
  _pathOps(segs) {
    const H = this.H, out = [];
    for (const s of segs) {
      if (s[0] === 'M') out.push(`${num(s[1])} ${num(H - s[2])} m`);
      else if (s[0] === 'L') out.push(`${num(s[1])} ${num(H - s[2])} l`);
      else if (s[0] === 'C') out.push(`${num(s[1])} ${num(H - s[2])} ${num(s[3])} ${num(H - s[4])} ${num(s[5])} ${num(H - s[6])} c`);
      else if (s[0] === 'Z') out.push('h');
    }
    return out.join(' ');
  }
  /** Dessine des segments [['M',x,y],['L',x,y],['C',…],['Z']] avec les options de peinture (fill, stroke…). */
  drawPath(segs, opts = {}) {
    if (!segs.length) return this;
    const { pre, op } = this._paint(opts);
    this.op(`q ${pre} ${this._pathOps(segs)} ${op} Q`);
    return this;
  }
  /**
   * Tracé SVG « d » placé en (x, y) avec une échelle (scale, ou sx / sy) ; options de peinture de drawPath
   * (evenodd pour les « trous »). Retourne les segments transformés.
   */
  svgPath(d, { x = 0, y = 0, scale = 1, sx = null, sy = null, ...paint } = {}) {
    const kx = sx ?? scale, ky = sy ?? scale;
    const segs = (Array.isArray(d) ? d : parseSvgPath(d)).map(s => s[0] === 'Z' ? s : [s[0], ...s.slice(1).map((v, i) => i % 2 ? y + v * ky : x + v * kx)]);
    this.drawPath(segs, paint);
    return segs;
  }
  rectSegs(x, y, w, h, r = 0) {
    const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(Number(v) || 0, w / 2, h / 2)));
    if (!tl && !tr && !br && !bl) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
    const k = 1 - KAPPA;
    return [['M', x + tl, y], ['L', x + w - tr, y], ['C', x + w - tr * k, y, x + w, y + tr * k, x + w, y + tr], ['L', x + w, y + h - br],
      ['C', x + w, y + h - br * k, x + w - br * k, y + h, x + w - br, y + h], ['L', x + bl, y + h], ['C', x + bl * k, y + h, x, y + h - bl * k, x, y + h - bl],
      ['L', x, y + tl], ['C', x, y + tl * k, x + tl * k, y, x + tl, y], ['Z']];
  }
  ellipseSegs(cx, cy, rx, ry) {
    const ox = rx * KAPPA, oy = ry * KAPPA;
    return [['M', cx - rx, cy], ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry], ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
      ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry], ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy], ['Z']];
  }
  /** Rectangle arrondi (r : rayon ou [haut-gauche, haut-droit, bas-droit, bas-gauche]). */
  roundRect(x, y, w, h, r = 4, opts = {}) { return this.drawPath(this.rectSegs(x, y, w, h, r), opts); }
  circle(cx, cy, r, opts = {}) { return this.drawPath(this.ellipseSegs(cx, cy, r, r), opts); }
  ellipse(cx, cy, rx, ry, opts = {}) { return this.drawPath(this.ellipseSegs(cx, cy, rx, ry), opts); }
  polygon(points, opts = {}) { return this.drawPath([...points.map(([px, py], i) => [i ? 'L' : 'M', px, py]), ['Z']], opts); }
  /** Courbe de Bézier cubique (trait). */
  bezier(x0, y0, x1, y1, x2, y2, x3, y3, opts = {}) { return this.drawPath([['M', x0, y0], ['C', x1, y1, x2, y2, x3, y3]], { stroke: '#000000', ...opts, fill: null }); }
  /** Découpe les dessins suivants (jusqu'au restore() correspondant) selon un rectangle éventuellement arrondi. */
  clipRect(x, y, w, h, r = 0) { this.op(`${this._pathOps(this.rectSegs(x, y, w, h, r))} W n`); return this; }
  clipPath(segs, { evenodd = false } = {}) { this.op(`${this._pathOps(segs)} W${evenodd ? '*' : ''} n`); return this; }

  /* --- primitives (y mesuré depuis le haut de la page) --- */
  /**
   * Texte sur une ligne. y = haut de la ligne. Options : font, size, color, align ('left' | 'center' | 'right',
   * avec width), charSpace (espacement des lettres), opacity, render ('fill' | 'stroke'), baseline (y = ligne de base).
   */
  text(str, x, y, { font = 'regular', size = 10, color = '#10202b', align = 'left', width = 0, charSpace = 0, opacity = 1, baseline = false } = {}) {
    const f = this.fontOf(font);
    f.used = true;
    let tx = x;
    if (align !== 'left' && width) { const w = this.width(str, font, size, charSpace); tx = align === 'center' ? x + (width - w) / 2 : x + width - w; }
    const [r, g, b] = rgb(color);
    const by = baseline ? this.H - y : this.H - y - size * 0.8;
    const gs = opacity < 1 ? `/${this.alpha(opacity)} gs ` : '';
    const tc = charSpace ? `${num(charSpace)} Tc ` : '';
    this.op(`q ${gs}BT /${f.key} ${num(size)} Tf ${tc}${num(r)} ${num(g)} ${num(b)} rg ${num(tx)} ${num(by)} Td <${hex(toWinAnsi(str))}> Tj ET Q`);
  }
  /**
   * Paragraphe dans une boîte : lignes coupées à la largeur w, au plus maxLines (« … »), interligne lineHeight
   * (défaut 1,2 × size). Retourne la hauteur occupée.
   */
  textBox(str, x, y, w, { font = 'regular', size = 9, color = '#10202b', align = 'left', lineHeight = null, maxLines = 0, charSpace = 0 } = {}) {
    const lh = lineHeight || size * 1.2;
    const lines = this.clampLines(this.wrap(str, font, size, w, charSpace), maxLines, font, size, w);
    lines.forEach((l, i) => this.text(l, x, y + i * lh, { font, size, color, align, width: w, charSpace }));
    return lines.length * lh;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.6, opacity = 1, dash = null } = {}) {
    const { pre, op } = this._paint({ fill, stroke, lineWidth, opacity, dash });
    this.op(`q ${pre} ${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re ${op} Q`);
  }
  line(x1, y1, x2, y2, { color = '#d6dfdf', width = 0.6, dash = null, cap = null, opacity = 1 } = {}) {
    const { pre } = this._paint({ stroke: color, lineWidth: width, dash, cap, opacity });
    this.op(`q ${pre} ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S Q`);
  }
  /** Ligne pointillée (zones à écrire à la main). */
  dottedLine(x1, y, x2, { color = '#8ea9c3', width = 0.7, gap = 1.9 } = {}) {
    if (x2 - x1 > 2) this.line(x1, y, x2, y, { color, width, dash: [0.01, gap], cap: 'round' });
  }

  /* --- images --- */
  _addImageRecord(rec) { rec.name = 'Im' + (this.images.length + 1); this.images.push(rec); return rec; }
  /** Image JPEG (octets) ; même tableau d'octets ⇒ même objet image. opts.smask : masque de transparence (addGray). */
  addImage(bytes, { smask = null } = {}) {
    const found = this.images.find(i => i.bytes === bytes && i.smask === smask && i.kind === 'jpeg');
    if (found) return found;
    const info = jpegInfo(bytes);
    return this._addImageRecord({ kind: 'jpeg', bytes, ...info, filter: 'DCTDecode', smask });
  }
  /** Masque de transparence en niveaux de gris (Uint8Array largeur × hauteur, 0 = transparent). */
  async addGray({ width, height, data }) {
    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const packed = await deflate(raw);
    return this._addImageRecord({ kind: 'gray', width, height, components: 1, bytes: packed || raw, filter: packed ? 'FlateDecode' : null, isMask: true });
  }
  /**
   * Image RGBA (ex. ImageData d'un canvas) : couleurs RGB + masque de transparence (SMask) si un pixel n'est pas
   * opaque ; flux compressés (FlateDecode). Retourne l'objet image (drawImage).
   */
  async addRGBA({ width, height, data }) {
    const n = width * height;
    const rgbBytes = new Uint8Array(n * 3), alpha = new Uint8Array(n);
    let opaque = true;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      rgbBytes[i * 3] = data[j]; rgbBytes[i * 3 + 1] = data[j + 1]; rgbBytes[i * 3 + 2] = data[j + 2];
      alpha[i] = data[j + 3];
      if (data[j + 3] !== 255) opaque = false;
    }
    const smask = opaque ? null : await this.addGray({ width, height, data: alpha });
    const packed = await deflate(rgbBytes);
    return this._addImageRecord({ kind: 'rgb', width, height, components: 3, bytes: packed || rgbBytes, filter: packed ? 'FlateDecode' : null, smask });
  }
  drawImage(img, x, y, w, h, { opacity = 1 } = {}) {
    this.page.usesImages = true;
    const gs = opacity < 1 ? `/${this.alpha(opacity)} gs ` : '';
    this.op(`q ${gs}${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /${img.name} Do Q`);
  }
  /** Image recadrée pour REMPLIR la boîte (centrée), découpée selon un rectangle éventuellement arrondi. */
  drawImageCover(img, x, y, w, h, { radius = 0, opacity = 1, focusX = 0.5, focusY = 0.5 } = {}) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    this.save(); this.clipRect(x, y, w, h, radius);
    this.drawImage(img, x - (iw - w) * focusX, y - (ih - h) * focusY, iw, ih, { opacity });
    this.restore();
  }
  /** Image CONTENUE dans la boîte (proportions conservées, centrée). Retourne {x, y, w, h} dessinés. */
  drawImageContain(img, x, y, w, h, { align = 'center', opacity = 1 } = {}) {
    const s = Math.min(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    const ix = align === 'left' ? x : align === 'right' ? x + w - iw : x + (w - iw) / 2;
    this.drawImage(img, ix, y + (h - ih) / 2, iw, ih, { opacity });
    return { x: ix, y: y + (h - ih) / 2, w: iw, h: ih };
  }

  /* --- flux --- */
  spacer(h = 8) { this.y += h; return this; }
  heading(str, { level = 1, color = this.style.heading } = {}) {
    const size = level === 1 ? 15 : level === 2 ? 12 : 10.5;
    this.ensure(size + 28);
    if (level === 1) {
      this.y += 4;
      this.rect(this.m.left, this.y, this.contentWidth, size + 10, { fill: color });
      this.text(str, this.m.left + 8, this.y + 5, { font: 'bold', size, color: '#ffffff' });
      this.y += size + 18;
    } else {
      this.y += level === 2 ? 6 : 3;
      const lines = this.wrap(str, 'bold', size);
      for (const l of lines) { this.text(l, this.m.left, this.y, { font: 'bold', size, color }); this.y += size + 3; }
      if (level === 2) this.line(this.m.left, this.y, this.m.left + this.contentWidth, this.y, { color: this.style.rule, width: 1 });
      this.y += 6;
    }
    return this;
  }
  paragraph(str, { size = 9.5, font = 'regular', color = this.style.text, indent = 0, gap = 4, lineGap = 2.6 } = {}) {
    if (str === undefined || str === null || str === '') return this;
    for (const l of this.wrap(str, font, size, this.contentWidth - indent)) {
      this.ensure(size + lineGap);
      this.text(l, this.m.left + indent, this.y, { font, size, color });
      this.y += size + lineGap;
    }
    this.y += gap;
    return this;
  }
  bullets(list, opts = {}) { for (const s of list || []) this.paragraph('•  ' + s, { indent: 6, gap: 1, ...opts }); this.y += 3; return this; }
  /** Liste clé / valeur sur deux colonnes. */
  keyValues(pairs, { labelWidth = 170, size = 9, labelColor = this.style.labelColor, labelFill = this.style.labelFill } = {}) {
    const rows = pairs.filter(p => p && p[1] !== undefined && p[1] !== null && p[1] !== '');
    return this.table({ columns: [{ label: '', width: labelWidth }, { label: '', width: this.contentWidth - labelWidth }], rows: rows.map(([k, v]) => [{ text: k, font: 'bold', color: labelColor, fill: labelFill }, String(v)]), fontSize: size, header: false });
  }
  /**
   * Tableau. columns : [{label, width, align}] ; rows : [[cellule]] avec cellule = texte ou
   * {text, font, color, fill, align, size}. L'en-tête est répété à chaque saut de page.
   * Options de style : headerFill, headerColor, borderColor, zebraFill, rounded (coins de l'en-tête).
   */
  table({ columns, rows, fontSize = 8.5, header = true, headerFill = this.style.tableHead, headerColor = this.style.tableHeadText, borderColor = this.style.border, zebra = true, zebraFill = this.style.zebra, padding = 4, maxLinesPerCell = 60 }) {
    const lh = fontSize + 2.4;
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    const scale = totalW > this.contentWidth ? this.contentWidth / totalW : 1;
    const cols = columns.map(c => ({ ...c, width: c.width * scale }));
    const drawHeader = () => {
      if (!header) return;
      const hl = cols.map(c => this.wrap(c.label, 'bold', fontSize, c.width - padding * 2));
      const h = Math.max(...hl.map(l => l.length)) * lh + padding * 2;
      let x = this.m.left;
      cols.forEach((c, i) => {
        this.rect(x, this.y, c.width, h, { fill: headerFill, stroke: '#ffffff', lineWidth: 0.5 });
        hl[i].forEach((l, k) => this.text(l, x + padding, this.y + padding + k * lh, { font: 'bold', size: fontSize, color: headerColor }));
        x += c.width;
      });
      this.y += h;
    };
    this.ensure(lh * 3);
    drawHeader();
    rows.forEach((row, ri) => {
      const cells = cols.map((c, i) => {
        const cell = row[i]; const o = cell && typeof cell === 'object' ? cell : { text: cell };
        let lines = this.wrap(o.text ?? '', o.font || 'regular', o.size || fontSize, c.width - padding * 2);
        if (lines.length > maxLinesPerCell) lines = [...lines.slice(0, maxLinesPerCell - 1), lines[maxLinesPerCell - 1] + ' […]'];
        return { ...o, lines };
      });
      const h = Math.max(1, ...cells.map(c => c.lines.length)) * lh + padding * 2;
      if (this.y + h > this.H - this.m.bottom) { this.newPage(); drawHeader(); }
      let x = this.m.left;
      cells.forEach((c, i) => {
        const fill = c.fill || (zebra && ri % 2 ? zebraFill : '#ffffff');
        this.rect(x, this.y, cols[i].width, h, { fill, stroke: borderColor, lineWidth: 0.5 });
        c.lines.forEach((l, k) => this.text(l, x + padding, this.y + padding + k * lh, { font: c.font || 'regular', size: c.size || fontSize, color: c.color || this.style.text, align: c.align || cols[i].align || 'left', width: cols[i].width - padding * 2 }));
        x += cols[i].width;
      });
      this.y += h;
    });
    this.y += 8;
    return this;
  }
  /** Grille d'images JPEG avec légendes. items : [{bytes, caption}] */
  imageGrid(items, { cols = 3, gap = 8, maxHeight = 150, captionSize = 7 } = {}) {
    const cw = (this.contentWidth - gap * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols).map(it => {
        try { const img = this.addImage(it.bytes); const ratio = img.height / img.width; const w = Math.min(cw, maxHeight / ratio); return { img, w, h: w * ratio, caption: this.wrap(it.caption || '', 'regular', captionSize, cw) }; }
        catch (e) { return { error: true, caption: this.wrap((it.caption || '') + ' [image illisible]', 'regular', captionSize, cw) }; }
      });
      const rowH = Math.max(...row.map(r => (r.h || 20) + r.caption.length * (captionSize + 2) + 6));
      this.ensure(rowH);
      row.forEach((r, k) => {
        const x = this.m.left + k * (cw + gap);
        if (!r.error) { this.drawImage(r.img, x + (cw - r.w) / 2, this.y, r.w, r.h); this.rect(x + (cw - r.w) / 2, this.y, r.w, r.h, { stroke: '#9aa9ae', lineWidth: 0.4 }); }
        r.caption.forEach((l, j) => this.text(l, x, this.y + (r.h || 20) + 3 + j * (captionSize + 2), { size: captionSize, color: '#4b5a61' }));
      });
      this.y += rowH + 4;
    }
    return this;
  }
  /** Image unique (signature…) dans une boîte de dimensions maximales. */
  image(bytes, { maxWidth = 200, maxHeight = 80, x = null } = {}) {
    const img = this.addImage(bytes);
    const s = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const w = img.width * s, h = img.height * s;
    this.ensure(h + 4);
    this.drawImage(img, x ?? this.m.left, this.y, w, h);
    this.y += h + 4;
    return { w, h };
  }

  /* --- sortie --- */
  /**
   * Filigrane (this.watermark = { text, color, size, opacity, font, mode: 'outline' | 'fill', angle }) : centré
   * sur la diagonale de chaque page, par-dessus le contenu sans le masquer (contour seul ou remplissage translucide).
   */
  _drawWatermark() {
    const wm = this.watermark;
    if (!wm?.text) return;
    const font = wm.font || 'bold';
    const f = this.fontOf(font); f.used = true;
    const angle = (wm.angle ?? 35) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    let size = wm.size || 54;
    const fit = Math.hypot(this.W, this.H) * 0.62;
    while (size > 12 && this.width(wm.text, font, size) > fit) size -= 2;
    const w = this.width(wm.text, font, size), h = size * 0.7;
    const tx = this.W / 2 - (cos * w / 2 - sin * h / 2), ty = this.H / 2 - (sin * w / 2 + cos * h / 2);
    const [r, g, b] = rgb(wm.color || '#c9772a');
    const fill = wm.mode === 'fill';
    const gs = wm.opacity !== undefined && wm.opacity < 1 ? `/${this.alpha(wm.opacity)} gs ` : '';
    this.op(`q ${gs}${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(tx)} ${num(ty)} cm BT ${fill ? '0 Tr' : '1 Tr 0.9 w'} /${f.key} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} ${fill ? 'rg' : 'RG'} 0 0 Td <${hex(toWinAnsi(wm.text))}> Tj ET Q`);
  }
  /** Filigrane, en-têtes et pieds de page (une seule fois, avant l'assemblage). */
  _finalize() {
    if (this._finalized) return;
    this._finalized = true;
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      this.page = p; this.W = p.W; this.H = p.H;
      if (this.watermark && p.meta?.watermark !== false) this._drawWatermark();
      if (this.headerFn) this.headerFn(this, i + 1, total);
      if (this.footerFn) this.footerFn(this, i + 1, total);
    });
  }
  /** Document PDF (octets), flux non compressés. */
  output() {
    this._finalize();
    return this._assemble(this.pages.map(p => ({ bytes: enc(p.ops.join('\n')), filter: null })), false);
  }
  /** Document PDF (octets), flux de contenu, polices et images compressés (FlateDecode) si possible. */
  async outputAsync() {
    this._finalize();
    const contents = [];
    for (const p of this.pages) {
      const bytes = enc(p.ops.join('\n'));
      const packed = bytes.length > 256 ? await deflate(bytes) : null;
      contents.push(packed ? { bytes: packed, filter: 'FlateDecode' } : { bytes, filter: null });
    }
    for (const f of Object.values(this.fonts)) if (f.type === 'ttf' && f.used && !f.packed) f.packed = await deflate(f.bytes);
    return this._assemble(contents, true);
  }
  _assemble(contents) {
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const catalogId = add(null), pagesId = add(null);
    // Polices : les trois polices standard (toujours déclarées : compatibilité) + les polices incorporées utilisées.
    const fontIds = {};
    for (const f of Object.values(this.fonts)) {
      if (f.type === 'std') { fontIds[f.key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`); continue; }
      if (!f.used) continue;
      const file = f.packed ? { head: `<< /Length ${f.packed.length} /Length1 ${f.bytes.length} /Filter /FlateDecode >>`, bytes: f.packed } : { head: `<< /Length ${f.bytes.length} /Length1 ${f.bytes.length} >>`, bytes: f.bytes };
      const fileId = add(file);
      const flags = 32 | (f.italic ? 64 : 0) | (f.fixed ? 1 : 0);
      const stemV = f.weight >= 700 ? 140 : f.weight >= 600 ? 110 : 80;
      const descId = add(`<< /Type /FontDescriptor /FontName /${f.base} /Flags ${flags} /FontBBox [${f.bbox.join(' ')}] /ItalicAngle ${num(f.italicAngle)} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${stemV} /FontFile2 ${fileId} 0 R >>`);
      fontIds[f.key] = add(`<< /Type /Font /Subtype /TrueType /BaseFont /${f.base} /FirstChar 32 /LastChar 255 /Widths [${f.widths.slice(32).join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descId} 0 R >>`);
    }
    // Images (les masques de transparence sont écrits avant les images qui les référencent).
    const imgIds = new Map();
    const writeImage = img => {
      if (imgIds.has(img)) return imgIds.get(img);
      const sm = img.smask ? writeImage(img.smask) : null;
      const cs = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      const extra = (img.kind === 'jpeg' && img.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '') + (sm ? ` /SMask ${sm} 0 R` : '');
      const id = add({ head: `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8${img.filter ? ' /Filter /' + img.filter : ''}${extra} /Interpolate true /Length ${img.bytes.length} >>`, bytes: img.bytes });
      imgIds.set(img, id);
      return id;
    };
    for (const img of this.images) writeImage(img);
    const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
    const xobj = this.images.filter(i => !i.isMask).map(i => `/${i.name} ${imgIds.get(i)} 0 R`).join(' ');
    const gsRes = [...this.gstates.values()].map(g => `/${g.name} << /Type /ExtGState /ca ${num(g.fill)} /CA ${num(g.stroke)} >>`).join(' ');
    const resId = add(`<< /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${fontRes} >>${xobj ? ` /XObject << ${xobj} >>` : ''}${gsRes ? ` /ExtGState << ${gsRes} >>` : ''} >>`);
    const pageIds = [];
    this.pages.forEach((p, i) => {
      const c = contents[i];
      const cid = add({ head: `<< /Length ${c.bytes.length}${c.filter ? ' /Filter /' + c.filter : ''} >>`, bytes: c.bytes });
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.W)} ${num(p.H)}] /Resources ${resId} 0 R /Contents ${cid} 0 R >>`));
    });
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (fr-FR) >>`;
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const pdfDate = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    const infoStr = s => `<FEFF${[...String(s)].map(ch => { const c = ch.codePointAt(0); return c > 0xFFFF ? '003F' : c.toString(16).padStart(4, '0'); }).join('')}>`;
    const infoId = add(`<< /Title ${infoStr(this.info.title)} /Author ${infoStr(this.info.author)} /Subject ${infoStr(this.info.subject)} /Keywords ${infoStr(this.info.keywords)} /Creator ${infoStr('PWA Audit prélèvements OEG')} /Producer ${infoStr('pdf.js minimal OEG')} /CreationDate (${pdfDate}) >>`);
    const chunks = [enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    let offset = chunks[0].length;
    const xref = [];
    objects.forEach((o, i) => {
      xref.push(offset);
      let part;
      if (typeof o === 'string') part = [enc(`${i + 1} 0 obj\n${o}\nendobj\n`)];
      else part = [enc(`${i + 1} 0 obj\n${o.head}\nstream\n`), o.bytes, enc('\nendstream\nendobj\n')];
      for (const c of part) { chunks.push(c); offset += c.length; }
    });
    const xrefStart = offset;
    let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    tail += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(enc(tail));
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}
