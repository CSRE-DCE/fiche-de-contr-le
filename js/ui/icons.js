/* Pictogrammes de l'application et des fiches de contrôle terrain (style « pastille » des maquettes :
 * formes pleines et arrondies, lisibles de 18 à 48 px, blanches sur pastille colorée ou colorées seules).
 *
 * icon(name, { size, cls, title }) → chaîne SVG en ligne (viewBox 0 0 24 24, couleur = currentColor),
 * construite uniquement avec des chemins, cercles et rectangles simples (pas de <use>, pas de texte) :
 * utilisable telle quelle dans le HTML et rastérisable (canvas) pour les PDF.
 * ICON_NAMES : liste de tous les noms disponibles. Nom inconnu → pictogramme « info ». */

import { SafeHTML } from '../core/util.js';

/* ---------- Petits constructeurs de formes ---------- */
const n = v => Math.round(v * 100) / 100;
/** Forme pleine ; evenodd = les sous-chemins intérieurs deviennent des « trous » (yeux, lignes…). */
const F = (d, evenodd = false) => `<path d="${d}"${evenodd ? ' fill-rule="evenodd"' : ''}/>`;
/** Trait arrondi. */
const S = (d, w = 2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Sous-chemin circulaire (à combiner dans F(…, true) pour les trous). */
const circ = (cx, cy, r) => `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
const C = (cx, cy, r) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`;
const R = (x, y, w, h, rx = 0) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''}/>`;
/** Polygone fermé à partir d'une liste de points [[x, y], …]. */
const poly = pts => 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'Z';
const rot = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
/** Rectangle tourné (segment épais) entre deux points, d'épaisseur w. */
function bar([x1, y1], [x2, y2], w) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, ox = -dy / l * w / 2, oy = dx / l * w / 2;
  return poly([[x1 + ox, y1 + oy], [x2 + ox, y2 + oy], [x2 - ox, y2 - oy], [x1 - ox, y1 - oy]]);
}

/** Roue dentée (dents trapézoïdales) avec moyeu évidé. */
function gear(cx = 12, cy = 12, ro = 10, ri = 7.6, teeth = 8, hole = 3.2) {
  const pts = [], step = 360 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - 90;
    pts.push(rot(cx, cy, ri, a - step * 0.36), rot(cx, cy, ro, a - step * 0.2), rot(cx, cy, ro, a + step * 0.2), rot(cx, cy, ri, a + step * 0.36));
  }
  return F(poly(pts) + circ(cx, cy, hole), true);
}
/** Étoile à 5 branches. */
function star(cx = 12, cy = 12.6, ro = 10.2, ri = 4.3) {
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push(rot(cx, cy, i % 2 ? ri : ro, -90 + i * 36));
  return poly(pts);
}
/** Flocon : six branches munies d'un chevron. */
function snowflake() {
  let d = '';
  for (let k = 0; k < 6; k++) {
    const a = k * 60 - 90, [x, y] = rot(12, 12, 9.6, a), [bx, by] = rot(12, 12, 6.2, a);
    const [lx, ly] = rot(bx, by, 2.9, a + 180 - 42), [rx, ry] = rot(bx, by, 2.9, a + 180 + 42);
    d += `M12 12L${n(x)} ${n(y)}M${n(lx)} ${n(ly)}L${n(bx)} ${n(by)}L${n(rx)} ${n(ry)}`;
  }
  return S(d, 2) + C(12, 12, 1.9);
}
/** Soleil : disque et rayons. */
function sun() {
  let d = '';
  for (let k = 0; k < 8; k++) { const [x1, y1] = rot(12, 12, 7.4, k * 45), [x2, y2] = rot(12, 12, 10.2, k * 45); d += `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`; }
  return C(12, 12, 4.6) + S(d, 2.1);
}
/** Diatomée pennée (frustule en navette, raphé et stries), en diagonale. */
function diatom() {
  const a = -40, cx = 12, cy = 12, rx = 10.6, ry = 4.6;
  const [x1, y1] = rot(cx, cy, rx, a), [x2, y2] = rot(cx, cy, -rx, a);
  let d = `M${n(x1)} ${n(y1)}A${rx} ${ry} ${a} 1 1 ${n(x2)} ${n(y2)}A${rx} ${ry} ${a} 1 1 ${n(x1)} ${n(y1)}Z`;
  const u = [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)], v = [-u[1], u[0]];
  const at = (s, t) => [cx + u[0] * s + v[0] * t, cy + u[1] * s + v[1] * t];
  d += bar(at(-6.6, 0), at(6.6, 0), 0.9).replace(/^M/, 'M');               // raphé
  for (const s of [-5.4, -3, -0.6, 1.8, 4.2]) {                           // stries de part et d'autre
    d += bar(at(s + 0.6, 1.2), at(s + 0.6, 3.1), 0.95);
    d += bar(at(s + 0.6, -1.2), at(s + 0.6, -3.1), 0.95);
  }
  return F(d, true);
}
/** Poisson (tête à droite) dans un cadre 24 × 24, éventuellement réduit/décalé. */
function fishPath(tx = 0, ty = 0, s = 1) {
  const p = (x, y) => `${n(tx + x * s)} ${n(ty + y * s)}`;
  return `M${p(22, 12)}C${p(20, 15.6)} ${p(16.8, 17.6)} ${p(13, 17.6)}C${p(10.4, 17.6)} ${p(8.2, 16.6)} ${p(6.5, 15)}L${p(2.2, 18)}L${p(3.6, 12)}L${p(2.2, 6)}L${p(6.5, 9)}`
    + `C${p(8.2, 7.4)} ${p(10.4, 6.4)} ${p(13, 6.4)}C${p(16.8, 6.4)} ${p(20, 8.4)} ${p(22, 12)}Z`
    + circ(tx + 17.6 * s, ty + 10.8 * s, 1.15 * s)
    + `M${p(12.4, 9)}C${p(13.6, 10.6)} ${p(13.6, 13.4)} ${p(12.4, 15)}L${p(11.4, 14.4)}C${p(12.3, 13)} ${p(12.3, 11)} ${p(11.4, 9.6)}Z`;
}
/** Flacon (bouchon, épaule, étiquette évidée), éventuellement réduit/décalé. */
function bottlePath(tx = 0, ty = 0, s = 1) {
  const p = (x, y) => `${n(tx + x * s)} ${n(ty + y * s)}`, r = n(2 * s);
  return `M${p(9, 1.8)}L${p(15, 1.8)}L${p(15, 5)}L${p(9, 5)}Z`
    + `M${p(9.6, 6)}L${p(14.4, 6)}L${p(14.4, 8.2)}C${p(16.8, 9)} ${p(18.2, 10.8)} ${p(18.2, 13.2)}L${p(18.2, 20)}`
    + `A${r} ${r} 0 0 1 ${p(16.2, 22)}L${p(7.8, 22)}A${r} ${r} 0 0 1 ${p(5.8, 20)}L${p(5.8, 13.2)}`
    + `C${p(5.8, 10.8)} ${p(7.2, 9)} ${p(9.6, 8.2)}Z`
    + `M${p(8, 13.4)}L${p(16, 13.4)}L${p(16, 18.2)}L${p(8, 18.2)}Z`;
}
/** Règle graduée en diagonale. */
function ruler() {
  const a = -45 * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
  const at = (s, t) => [12 + u[0] * s + v[0] * t, 12 + u[1] * s + v[1] * t];
  let d = poly([at(-11, -3.4), at(11, -3.4), at(11, 3.4), at(-11, 3.4)]);
  [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].forEach((s, i) => { d += bar(at(s, -3.5), at(s, i % 2 ? -0.4 : 0.8), 1.1); });
  return F(d, true);
}

/* ---------- Catalogue ---------- */
const ICONS = {
  database: F('M4 5.6c0-1.8 3.6-3.2 8-3.2s8 1.4 8 3.2-3.6 3.2-8 3.2-8-1.4-8-3.2Z')
    + F('M4 8.9v3.4c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V8.9c-1.8 1.3-4.8 2-8 2s-6.2-.7-8-2Z')
    + F('M4 15.4v3c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-3c-1.8 1.3-4.8 2-8 2s-6.2-.7-8-2Z'),
  basin: S('M2.8 12.4 8.2 5.6l2.9 3.5 3.2-4.4 6.9 7.7', 2) + S('M6.6 8.3l1.6 1.2 1.3-1.1', 1.6)
    + S('M2.8 16.3c1.5 0 1.5-1.2 3.1-1.2s1.5 1.2 3.1 1.2 1.5-1.2 3.1-1.2 1.5 1.2 3.1 1.2 1.5-1.2 3.1-1.2 1.5 1.2 2.9 1.2', 1.9)
    + S('M2.8 20.3c1.5 0 1.5-1.2 3.1-1.2s1.5 1.2 3.1 1.2 1.5-1.2 3.1-1.2 1.5 1.2 3.1 1.2 1.5-1.2 3.1-1.2 1.5 1.2 2.9 1.2', 1.9),
  pin: F('M12 1.8a7.4 7.4 0 0 0-7.4 7.4c0 5.4 7.4 13 7.4 13s7.4-7.6 7.4-13A7.4 7.4 0 0 0 12 1.8Z' + circ(12, 9.2, 2.9), true),
  camera: F('M8.6 4.2h6.8l1.4 2.3h2.7A2.5 2.5 0 0 1 22 9v9.3a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.3V9a2.5 2.5 0 0 1 2.5-2.5h2.7Z'
    + circ(12, 13.4, 4.9) + circ(12, 13.4, 2.6), true),
  warning: F('M10.3 3.3a2 2 0 0 1 3.4 0l8.6 14.9a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3Z'
    + 'M12 8.2c.8 0 1.3.6 1.2 1.3l-.4 5a.8.8 0 0 1-1.6 0l-.4-5c-.1-.7.4-1.3 1.2-1.3Z' + circ(12, 17.6, 1.25), true),
  chat: F('M12 3C6.5 3 2 6.6 2 11.1c0 2.4 1.3 4.6 3.4 6.1L4.5 21.4l4.8-2.6c.9.2 1.8.3 2.7.3 5.5 0 10-3.6 10-8S17.5 3 12 3Z'
    + circ(7.8, 11.1, 1.35) + circ(12, 11.1, 1.35) + circ(16.2, 11.1, 1.35), true),
  clipboard: F('M6 4h2.4v1.1c0 .9.7 1.6 1.6 1.6h4c.9 0 1.6-.7 1.6-1.6V4H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'
    + 'M7.6 10.4h8.8v1.7H7.6ZM7.6 14.2h8.8v1.7H7.6ZM7.6 18h5.6v1.7H7.6Z', true) + R(9.4, 1.8, 5.2, 3.8, 1.1),
  check: S('M4.2 12.6l5 5L19.8 7', 3),
  'check-circle': F(circ(12, 12, 10) + 'M10.4 16.9 5.9 12.4l1.7-1.7 2.8 2.8 6-6 1.7 1.7Z', true),
  edit: S('M12.5 4.2H5.6A1.6 1.6 0 0 0 4 5.8v12.6A1.6 1.6 0 0 0 5.6 20h12.6a1.6 1.6 0 0 0 1.6-1.6v-6.9', 2)
    + F('M18.2 2.7a1.9 1.9 0 0 1 2.7 0l.4.4a1.9 1.9 0 0 1 0 2.7l-8.5 8.5-3.8 1 1-3.8Z'),
  boat: F('M1.8 13.4h20.4l-2.6 4.4a2 2 0 0 1-1.7 1H6.3a2 2 0 0 1-1.7-.9Z')
    + F('M6.6 12.6V9.4a1 1 0 0 1 1-1h6.7l3.2 4.2ZM8.6 9.8v1.7h2.2V9.8ZM12.2 9.8v1.7h2.3l-1.3-1.7Z', true)
    + R(9.4, 5.2, 1.6, 3.4, .5)
    + S('M2 21.6c1.7 0 1.7-1.1 3.4-1.1s1.7 1.1 3.3 1.1 1.7-1.1 3.3-1.1 1.7 1.1 3.3 1.1 1.7-1.1 3.4-1.1 1.6 1.1 3.3 1.1', 1.6),
  gear: gear(),
  drop: F('M12 2.2S4.8 10 4.8 14.9a7.2 7.2 0 0 0 14.4 0C19.2 10 12 2.2 12 2.2Z'
    + 'M8.9 14.3a.9.9 0 0 1 1.1.7 2.9 2.9 0 0 0 2.1 2.2.9.9 0 1 1-.4 1.7 4.7 4.7 0 0 1-3.5-3.5.9.9 0 0 1 .7-1.1Z', true),
  bug: F('M12 7.6c3.1 0 5.1 2.7 5.1 6.4s-2 7.6-5.1 7.6-5.1-3.9-5.1-7.6 2-6.4 5.1-6.4ZM11.35 10.4v9.6h1.3v-9.6Z', true) + C(12, 5.6, 2.4)
    + S('M7.2 11.6 3.8 9.6M6.9 14.6H3.2M7.4 17.8l-3 2.4M16.8 11.6l3.4-2M17.1 14.6h3.7M16.6 17.8l3 2.4M10.7 3.8 9.3 1.9M13.3 3.8l1.4-1.9', 1.6),
  diatom: diatom(),
  fish: F(fishPath(), true),
  fishes: F(fishPath(-1, -2.4, .62) + fishPath(8.2, 9.2, .62), true),
  algae: S('M12 22V13.4c0-2.6 2.2-3.4 2.2-6S12 4 12 2.4', 2) + S('M12 22c-.8-2.6-3.8-3.6-4.7-6.6s.6-5.2-1-7.8', 2)
    + S('M12 22c.8-2.6 4.4-3.2 5.3-6.1s-.4-4.7 1.2-7.2', 2)
    + F('M7.3 11.3c-1.8-.4-3.2.2-3.9 1.4 1.6.6 3 .4 3.9-1.4ZM16.9 12.4c1.8-.6 3.3-.1 4 1.1-1.5.7-3 .6-4-1.1ZM14.2 7.6c1.4-1.2 2.9-1.3 4-.6-1.1 1.2-2.5 1.5-4 .6Z'),
  person: C(12, 7.2, 4.2) + F('M3.8 20.2C3.8 16.2 7.5 13.2 12 13.2s8.2 3 8.2 7c0 .8-.6 1.4-1.4 1.4H5.2c-.8 0-1.4-.6-1.4-1.4Z'),
  people: C(16.4, 7.4, 3.2) + F('M13.8 13.6c.8-.3 1.7-.4 2.6-.4 3.4 0 6 2.2 6 5.2 0 .6-.5 1.1-1.1 1.1h-4.2c-.3-2.2-1.4-4.3-3.3-5.9Z')
    + C(8.6, 7.8, 3.8) + F('M1.6 19.4c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3Z'),
  net: S('M3 5.6h18', 2) + S('M4 5.6 5.6 18.4a2 2 0 0 0 2 1.8h8.8a2 2 0 0 0 2-1.8L20 5.6M8.6 5.6l.8 14.6M12 5.6v14.6M15.4 5.6l-.8 14.6M4.6 10.6h14.8M5.2 15.4h13.6', 1.5)
    + C(5, 4.6, 1.7) + C(12, 4.6, 1.7) + C(19, 4.6, 1.7),
  grid: S('M6.5 2.5v19M12 2.5v19M17.5 2.5v19M2.5 6.5h19M2.5 12h19M2.5 17.5h19', 1.9),
  clock: F(circ(12, 12, 10) + circ(12, 12, 7.9), true) + S('M12 6.8V12l3.6 2.3', 2.2),
  ruler: ruler(),
  doc: F('M6 2h7v5.6A1.6 1.6 0 0 0 14.6 9.2H20V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM7.6 12.2h8.8v1.6H7.6ZM7.6 16h8.8v1.6H7.6Z', true)
    + F('M14.6 2.4 19.6 7.6h-4.4a.6.6 0 0 1-.6-.6Z'),
  box: F('M4.4 3h15.2A1.4 1.4 0 0 1 21 4.4V8H3V4.4A1.4 1.4 0 0 1 4.4 3Z')
    + F('M4 9.6h16V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM9.5 12.2h5a1 1 0 0 1 0 2h-5a1 1 0 0 1 0-2Z', true),
  tag: F('M2.6 4.2v6.6c0 .6.2 1.1.6 1.5l9 9a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8l-9-9a2 2 0 0 0-1.5-.6H4.2a1.6 1.6 0 0 0-1.6 1.5Z' + circ(7.2, 7.2, 1.7), true),
  snowflake: snowflake(),
  cooler: S('M8.4 6.6V5.2a1.4 1.4 0 0 1 1.4-1.4h4.4a1.4 1.4 0 0 1 1.4 1.4v1.4', 1.9)
    + F('M5 7h14a2 2 0 0 1 2 2v2.2H3V9a2 2 0 0 1 2-2Z')
    + F('M3 12.6h18V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9.8 14.4h4.4v2.2H9.8Z', true),
  truck: F('M3.4 4.6h10.2A1.4 1.4 0 0 1 15 6v10.2H2V6a1.4 1.4 0 0 1 1.4-1.4Z')
    + F('M16 8.2h3.1c.5 0 1 .3 1.3.7l1.6 2.4v4.9h-6ZM17.3 9.6v2.6h3.2l-1.6-2.6Z', true)
    + F(circ(6.4, 17.6, 2.5) + circ(6.4, 17.6, 1), true) + F(circ(17.6, 17.6, 2.5) + circ(17.6, 17.6, 1), true),
  search: S('M10.4 3.6a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6Z', 2.6) + S('M15.6 15.6 21 21', 3.2),
  wrench: F('M15.6 2.3a5.9 5.9 0 0 1 1.6.3l-3.4 3.4.6 3.6 3.6.6 3.4-3.4A5.9 5.9 0 0 1 14.2 14l-7.3 7.3a2.4 2.4 0 0 1-3.4-3.4l7.3-7.3a5.9 5.9 0 0 1 4.8-8.3Z' + circ(5.2, 19.2, 1), true),
  thermometer: S('M9.6 13.7V4.6a2.4 2.4 0 0 1 4.8 0v9.1a4.4 4.4 0 1 1-4.8 0Z', 1.9) + C(12, 17.4, 2.2) + R(11.15, 8, 1.7, 8.6, .85)
    + S('M17 5.6h2.4M17 9h2.4M17 12.4h1.6', 1.6),
  barcode: R(2.5, 4, 1.8, 16) + R(5.6, 4, .9, 16) + R(7.6, 4, 2, 16) + R(10.7, 4, .9, 16) + R(12.6, 4, 1.7, 16)
    + R(15.4, 4, .9, 16) + R(17.2, 4, 2.2, 16) + R(20.4, 4, 1.1, 16),
  bottle: F(bottlePath(), true),
  bottles: F(bottlePath(-3.6, 2.6, .66) + bottlePath(4.1, 2.6, .66) + bottlePath(11.8, 2.6, .66), true),
  beaker: F('M5 2.6h14v1.8h-1.6v14.4a3.2 3.2 0 0 1-3.2 3.2H9.8a3.2 3.2 0 0 1-3.2-3.2V4.4H5ZM8.6 7.4h3.6v1.4H8.6ZM8.6 11h2.4v1.4H8.6ZM8.6 14.6h3.6V16H8.6Z', true),
  refresh: S('M20 12a8 8 0 1 1-2.6-5.9', 2.4) + F('M21.4 2.6v6.6h-6.6Z'),
  flask: S('M9.8 2.8v6.6L4.4 18.5A1.7 1.7 0 0 0 5.9 21h12.2a1.7 1.7 0 0 0 1.5-2.5L14.2 9.4V2.8M8.2 2.8h7.6', 2)
    + F('M7.6 14.2h8.8l2.2 4.1c.3.6-.1 1.3-.8 1.3H6.2c-.7 0-1.1-.7-.8-1.3Z'),
  map: F('M2.6 6.3 8.4 4l7.2 2.6 5.8-2.3v13.4l-5.8 2.3-7.2-2.6-5.8 2.3ZM8 5.2v12.2h1V5.6ZM15 7.2v12.1h1V6.9Z', true),
  mountain: F('M1.6 20.4 8.6 7.8l3.3 5.8 2.6-4.1 7.9 10.9Z') + F('M8.6 7.8 6.6 11.4l1.2-.5.8.9.8-.9 1.2.5Z'),
  compass: F(circ(12, 12, 10) + circ(12, 12, 8.2), true) + F('M12 4.8l2.6 7.2H9.4Z') + F('M9.4 12h5.2L12 19.2Z' + 'M10.9 12h2.2L12 15.6Z', true),
  info: F(circ(12, 12, 10) + 'M10.9 10.2h2.2V17h-2.2Z' + circ(12, 7.3, 1.35), true),
  plus: S('M12 4.5v15M4.5 12h15', 2.8),
  calendar: F('M5 4.4h14a2 2 0 0 1 2 2v12.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.4a2 2 0 0 1 2-2ZM4.8 9.4v9.4c0 .3.3.6.6.6h13.2c.3 0 .6-.3.6-.6V9.4Z', true)
    + R(6.6, 11.2, 2.6, 2.4, .5) + R(10.7, 11.2, 2.6, 2.4, .5) + R(14.8, 11.2, 2.6, 2.4, .5) + R(6.6, 15, 2.6, 2.4, .5) + R(10.7, 15, 2.6, 2.4, .5)
    + R(6.6, 2, 2, 4.6, 1) + R(15.4, 2, 2, 4.6, 1),
  signature: S('M2.8 16.4c1.6-2.8 3.4-8.4 5.6-8.4 1.9 0 .2 7.6 2.4 7.6 1.6 0 2.4-3.6 3.8-3.6 1.3 0 1 2.4 2.5 2.4 1 0 1.9-.8 2.6-1.6', 2)
    + S('M2.8 20.6h18.4', 1.8) + F('M18.6 3.2a1.5 1.5 0 0 1 2.1 2.1l-4.4 4.4-2.6.6.6-2.6Z'),
  station: F('M10.2 2h3.6v14.6h-3.6ZM12 4.2v1.4h1.8V4.2ZM12 7.4v1.4h1.8V7.4ZM12 10.6V12h1.8v-1.4ZM12 13.8v1.4h1.8v-1.4Z', true)
    + S('M2.4 18.6c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2', 1.9)
    + S('M2.4 22c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2', 1.9),
  leaf: F('M20.6 3.2C11.4 3.2 4.8 7.1 4.8 14c0 1.6.4 3 1.1 4.2 1.5-3.9 5-6.9 9-8.4-3.5 2.1-6.5 5.2-8.1 9.2 1 .8 2.4 1.3 3.9 1.3 6.8 0 9.9-7.4 9.9-17.1Z'),
  star: F(star()),
  flag: R(4.4, 2.2, 1.9, 19.6, .9) + F('M7.4 3.6h12.2l-3 4.7 3 4.7H7.4Z'),
  sun: sun(),
  cloud: F('M7.2 19.4a4.7 4.7 0 0 1-.7-9.3 6.2 6.2 0 0 1 11.6-1.6 5.5 5.5 0 0 1-.2 10.9Z'),
  wave: S('M2.2 7.4c2.4 0 2.4-2 4.9-2s2.4 2 4.9 2 2.4-2 4.9-2 2.4 2 4.9 2', 2.1)
    + S('M2.2 12.6c2.4 0 2.4-2 4.9-2s2.4 2 4.9 2 2.4-2 4.9-2 2.4 2 4.9 2', 2.1)
    + S('M2.2 17.8c2.4 0 2.4-2 4.9-2s2.4 2 4.9 2 2.4-2 4.9-2 2.4 2 4.9 2', 2.1),
  phone: F('M6.9 2.4 9 2a1.4 1.4 0 0 1 1.5.8l1.4 3.3a1.4 1.4 0 0 1-.3 1.5L9.7 9.4a12.6 12.6 0 0 0 4.9 4.9l1.8-1.9a1.4 1.4 0 0 1 1.5-.3l3.3 1.4a1.4 1.4 0 0 1 .8 1.5l-.4 2.1a2 2 0 0 1-2 1.7C10.8 18.8 5.2 13.2 5.2 4.4a2 2 0 0 1 1.7-2Z'),
  home: F('M12 2.6 1.8 11.2h2.8v8.6a1.6 1.6 0 0 0 1.6 1.6h3.6v-6.2h4.4v6.2h3.6a1.6 1.6 0 0 0 1.6-1.6v-8.6h2.8Z'),
  list: C(4.4, 6, 1.7) + C(4.4, 12, 1.7) + C(4.4, 18, 1.7) + R(8, 5, 13.4, 2, 1) + R(8, 11, 13.4, 2, 1) + R(8, 17, 13.4, 2, 1),
  sync: S('M4.2 11a7.9 7.9 0 0 1 13.3-4.8', 2.3) + F('M20.2 2.8v6.4h-6.4Z') + S('M19.8 13a7.9 7.9 0 0 1-13.3 4.8', 2.3) + F('M3.8 21.2v-6.4h6.4Z'),
  lock: S('M7.8 10.4V7.6a4.2 4.2 0 0 1 8.4 0v2.8', 2.3)
    + F('M5.6 9.8h12.8A1.6 1.6 0 0 1 20 11.4v8.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8.2a1.6 1.6 0 0 1 1.6-1.6Z' + circ(12, 14.6, 1.7) + 'M11.25 15.4h1.5v3h-1.5Z', true),
  user: F(circ(12, 12, 10.2) + circ(12, 9.4, 3.4) + 'M5.6 18.3c1.3-2.5 3.6-4 6.4-4s5.1 1.5 6.4 4a8 8 0 0 1-12.8 0Z', true),
  download: S('M12 3.2v11.4M7 9.8l5 5 5-5', 2.4) + S('M3.8 16v2.6a2.4 2.4 0 0 0 2.4 2.4h11.6a2.4 2.4 0 0 0 2.4-2.4V16', 2.2),
  print: R(6.6, 2.4, 10.8, 5, 1) + F('M4.6 8.6h14.8A2.6 2.6 0 0 1 22 11.2v6h-3.8v-3H5.8v3H2v-6a2.6 2.6 0 0 1 2.6-2.6Z' + circ(18.2, 11.6, .95), true)
    + F('M6.8 15.6h10.4V21a.8.8 0 0 1-.8.8H7.6a.8.8 0 0 1-.8-.8ZM8.6 17.4v1.2h6.8v-1.2Z', true),
  pdf: S('M13.6 2.4H6.2a1.8 1.8 0 0 0-1.8 1.8v15.6a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8V8.4Z', 1.8) + F('M13.2 2.6v4.6a1.4 1.4 0 0 0 1.4 1.4h4.8Z')
    + S('M7.2 18v-5h1.5a1.5 1.5 0 0 1 0 3H7.2M11.1 13v5h.8a2.5 2.5 0 0 0 0-5ZM15.6 18v-5h2.3M15.6 15.4h1.9', 1.4),
  /* Compléments (navigation et actions de l'application) */
  eye: F('M12 5c-5 0-8.8 3.7-10.2 7 1.4 3.3 5.2 7 10.2 7s8.8-3.7 10.2-7C20.8 8.7 17 5 12 5Z' + circ(12, 12, 4.4) + circ(12, 12, 2.2), true),
  chart: R(3, 13, 4, 8, 1) + R(10, 8, 4, 13, 1) + R(17, 3, 4, 18, 1),
  building: F('M4 3.6A1.6 1.6 0 0 1 5.6 2h8.8A1.6 1.6 0 0 1 16 3.6V8h2.4A1.6 1.6 0 0 1 20 9.6V22H4ZM7 5.4v2.2h2.2V5.4ZM10.8 5.4v2.2H13V5.4ZM7 9.4v2.2h2.2V9.4ZM10.8 9.4v2.2H13V9.4ZM7 13.4v2.2h2.2v-2.2ZM10.8 13.4v2.2H13v-2.2ZM16 11v2.2h2v-2.2ZM16 15v2.2h2V15ZM9.4 22v-3.6h3.2V22Z', true),
  book: F('M4 4.6A2.6 2.6 0 0 1 6.6 2H20v16.4H6.6a1 1 0 0 0 0 2H20V22H6.6A2.6 2.6 0 0 1 4 19.4ZM8 6v1.8h8V6ZM8 9.6v1.8h5.6V9.6Z', true),
  history: S('M3.6 12a8.4 8.4 0 1 0 2.5-6', 2.2) + F('M2.6 3.4v5.8h5.8Z') + S('M12 7.4V12l3.2 2', 2.2),
  folder: F('M2.6 5.6A1.6 1.6 0 0 1 4.2 4h5.2l2.2 2.4h8.2a1.6 1.6 0 0 1 1.6 1.6v10.4a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6Z'),
  upload: S('M12 15V3.6M7 8.6l5-5 5 5', 2.4) + S('M3.8 16v2.6a2.4 2.4 0 0 0 2.4 2.4h11.6a2.4 2.4 0 0 0 2.4-2.4V16', 2.2),
  menu: R(3, 5, 18, 2.4, 1.2) + R(3, 10.8, 18, 2.4, 1.2) + R(3, 16.6, 18, 2.4, 1.2),
  close: S('M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4', 2.8),
  'chevron-right': S('M9 4.8l7.2 7.2L9 19.2', 2.6),
  'chevron-left': S('M15 4.8 7.8 12l7.2 7.2', 2.6),
  puzzle: F('M10 2.4a2.4 2.4 0 0 1 2.4 2.4V6h4.4A1.2 1.2 0 0 1 18 7.2v4.4h1.2a2.4 2.4 0 0 1 0 4.8H18v4.4a1.2 1.2 0 0 1-1.2 1.2h-4.4v-1.2a2.4 2.4 0 0 0-4.8 0V22H3.2A1.2 1.2 0 0 1 2 20.8v-4.4h1.2a2.4 2.4 0 0 0 0-4.8H2V7.2A1.2 1.2 0 0 1 3.2 6h4.4V4.8A2.4 2.4 0 0 1 10 2.4Z'),
  key: F(circ(7.4, 12, 5.2) + circ(6.6, 12, 1.7), true) + R(11.4, 10.8, 10.4, 2.6, 1) + R(17, 12.6, 2.4, 4, .6) + R(20.2, 12.6, 1.6, 3, .6),
  logout: S('M14.6 4.2H18a2 2 0 0 1 2 2v11.6a2 2 0 0 1-2 2h-3.4', 2.2) + S('M9.8 7.4 5.2 12l4.6 4.6M5.4 12h10.4', 2.4),
  trash: R(3.4, 4.6, 17.2, 2.2, 1.1) + R(9.2, 2.2, 5.6, 2.4, .8) + F('M5.4 8.2h13.2l-1 12.2a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6ZM9.2 10.6v8.6h1.6v-8.6ZM13.2 10.6v8.6h1.6v-8.6Z', true),
  minus: S('M4.5 12h15', 2.8)
};
// Disque plein avec croix évidée (contour unique de la croix, pour un « trou » net en evenodd).
ICONS['x-circle'] = F(circ(12, 12, 10) + 'M7.8 9.4 9.4 7.8 12 10.4l2.6-2.6 1.6 1.6-2.6 2.6 2.6 2.6-1.6 1.6-2.6-2.6-2.6 2.6-1.6-1.6 2.6-2.6Z', true);

export const ICON_NAMES = Object.keys(ICONS);
export const hasIcon = name => Object.prototype.hasOwnProperty.call(ICONS, name);

/* Résultat « chaîne SVG » utilisable partout : c'est un SafeHTML (inséré tel quel par html``, sans
 * échappement) qui se comporte aussi comme une chaîne (`${…}`, innerHTML, raw(), String(), .replace(),
 * .includes(), .length…). String(icon(…)) donne une chaîne primitive si besoin. */
class IconSVG extends SafeHTML { get length() { return this.s.length; } }
for (const m of ['at', 'charAt', 'charCodeAt', 'codePointAt', 'concat', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'match', 'matchAll',
  'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'search', 'slice', 'split', 'startsWith', 'substring',
  'toLowerCase', 'toUpperCase', 'trim', 'trimEnd', 'trimStart']) {
  if (String.prototype[m]) Object.defineProperty(IconSVG.prototype, m, { value: String.prototype[m], configurable: true, writable: true });
}
IconSVG.prototype[Symbol.toPrimitive] = function () { return this.s; };

/** Pictogramme SVG en ligne. size : px (nombre) ou longueur CSS (« 1.2em ») ; title : infobulle accessible
 * (sans title, le pictogramme est décoratif : aria-hidden). Nom inconnu → « info ». */
export function icon(name, { size = 24, cls = '', title = '' } = {}) {
  const known = hasIcon(name);
  const sz = typeof size === 'number' ? String(size) : String(size).replace(/[^0-9a-z.%]/gi, '');
  const t = String(title || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const a11y = t ? `role="img" aria-label="${t}"` : 'aria-hidden="true" focusable="false"';
  const klass = `ico ico-${known ? name : 'info'}${cls ? ' ' + String(cls).replace(/[<>"]/g, '') : ''}`;
  return new IconSVG(`<svg xmlns="http://www.w3.org/2000/svg" class="${klass}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor" ${a11y}>${t ? `<title>${t}</title>` : ''}${known ? ICONS[name] : ICONS.info}</svg>`);
}
