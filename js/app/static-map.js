/* Carte statique d'une station pour les fiches PDF (« Localisation cartographique » de la feuille 1).
 *
 * Image composée à partir des tuiles OpenStreetMap (projection Web Mercator) : d'abord le cache de l'appareil
 * (cache « oeg-ct-tiles » alimenté par la carte et le préchargement), sinon le réseau (requêtes CORS, délai
 * limité), jamais hors connexion. Si trop de tuiles manquent, le résultat est un « schéma » : la fiche PDF
 * dessine alors la silhouette de la Guyane avec le point de la station et les coordonnées.
 *
 * staticMap({ center: [lat, lon], points: [[lat, lon]…], width, height }) →
 *   { kind: 'tiles', jpeg (octets JPEG), width, height, zoom, metersPerPixel, project(lat, lon) → [x, y] en pixels
 *     de l'image, attribution, tiles: { loaded, total } }
 *   ou { kind: 'schema', reason: 'coords' | 'offline' | 'tiles' | 'canvas', zoom, tiles }.
 * scaleBar(metersPerPixel, maxPixels) → { meters, pixels, label } : longueur « ronde » de l'échelle graphique.
 * Les tuiles obtenues par le réseau sont ajoutées au cache de l'appareil (même usage que la carte interactive).
 */
import { orgSettings } from './settings.js';

export const TILE_CACHE = 'oeg-ct-tiles';
const TILE = 256;

/* ---------- Projection Web Mercator (pixels du niveau de zoom z) ---------- */
export const lonToPx = (lon, z) => (lon + 180) / 360 * TILE * 2 ** z;
export function latToPx(lat, z) {
  const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILE * 2 ** z;
}
/** Mètres par pixel au niveau de zoom z, à la latitude donnée. */
export const metersPerPixel = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;

/**
 * Niveau de zoom le plus élevé (≤ maxZoom) pour lequel tous les points tiennent dans l'image autour du centre,
 * avec une marge `pad` (pixels). Sans point : `zoom` (défaut 12, emprise ≈ 10 km comme la maquette).
 */
export function fitZoom(center, points = [], width = 600, height = 450, { minZoom = 7, maxZoom = 14, zoom = 12, pad = 28 } = {}) {
  const pts = (points || []).filter(p => p && isFinite(p[0]) && isFinite(p[1]));
  let z = Math.min(maxZoom, Math.max(minZoom, zoom));
  if (!pts.length) return z;
  for (; z > minZoom; z--) {
    const cx = lonToPx(center[1], z), cy = latToPx(center[0], z);
    if (pts.every(([la, lo]) => Math.abs(lonToPx(lo, z) - cx) <= width / 2 - pad && Math.abs(latToPx(la, z) - cy) <= height / 2 - pad)) break;
  }
  return z;
}

/** Échelle graphique : plus grande longueur « ronde » (1, 2, 5 × 10ⁿ m) ne dépassant pas maxPixels. */
export function scaleBar(mpp, maxPixels = 120) {
  const max = mpp * maxPixels;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, max)));
  const meters = [5, 2, 1].map(k => k * pow).find(v => v <= max) || pow;
  const label = meters >= 1000 ? `${String(meters / 1000).replace('.', ',')} km` : `${meters} m`;
  return { meters, pixels: meters / mpp, label };
}

/** Adresse d'une tuile depuis le modèle d'URL des réglages ({z}, {x}, {y}, {s}, {r}). */
export function tileURL(template, z, x, y) {
  return String(template).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'abc'[(x + y) % 3]).replace('{r}', '');
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
async function canvasJPEG(canvas, quality = 0.86) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
async function withTimeout(promise, ms, onTimeout) {
  let t;
  try { return await Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => { onTimeout?.(); rej(new Error('délai dépassé')); }, ms); })]); }
  finally { clearTimeout(t); }
}

/**
 * Tuile (image décodée) : cache de l'appareil, sinon réseau (si `network` et en ligne). null si indisponible.
 * fetchTile(url) facultatif (tests) : fonction renvoyant une Response.
 */
async function loadTile(url, { cache, network, timeoutMs, fetchTile }) {
  let resp = null;
  try { resp = cache ? await cache.match(url) : null; } catch (e) { resp = null; }
  if (!resp && network) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const r = await withTimeout(fetchTile ? fetchTile(url) : fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl?.signal }), timeoutMs, () => ctrl?.abort());
      if (r && r.ok && r.type !== 'opaque') {
        if (cache) { try { await cache.put(url, r.clone()); } catch (e) { /* quota : sans importance */ } }
        resp = r;
      }
    } catch (e) { resp = null; }
  }
  if (!resp || resp.type === 'opaque') return null;
  try {
    const blob = await resp.blob();
    if (!blob.size) return null;
    return await createImageBitmap(blob);
  } catch (e) { return null; }
}

/**
 * Compose la carte statique (voir l'en-tête du fichier). Options : zoom (sinon ajusté aux points : fitZoom),
 * minZoom / maxZoom, network (false : cache seulement), timeoutMs (par tuile), minCoverage (part minimale des
 * tuiles disponibles, défaut 0,6), template (modèle d'URL, défaut : réglages de l'organisation), fetchTile (tests).
 */
export async function staticMap({ center, points = [], width = 640, height = 480, zoom = null, minZoom = 7, maxZoom = 14, network = true,
  timeoutMs = 5000, minCoverage = 0.6, template = null, fetchTile = null } = {}) {
  if (!center || !isFinite(center[0]) || !isFinite(center[1])) return { kind: 'schema', reason: 'coords', zoom: null, tiles: { loaded: 0, total: 0 } };
  const W = Math.round(width), H = Math.round(height);
  const z = zoom ?? fitZoom(center, points, W, H, { minZoom, maxZoom });
  const cx = lonToPx(center[1], z), cy = latToPx(center[0], z);
  const left = cx - W / 2, top = cy - H / 2;
  const n = 2 ** z;
  const tiles = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W - 1) / TILE); tx++) tiles.push({ tx, ty, x: ((tx % n) + n) % n });
  }
  const online = globalThis.navigator?.onLine !== false;
  const tpl = template || orgSettings().tileUrl;
  const base = { zoom: z, tiles: { loaded: 0, total: tiles.length } };
  if (!tpl) return { kind: 'schema', reason: 'tiles', ...base };
  let cache = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(TILE_CACHE) : null; } catch (e) { cache = null; }
  if (!cache && !(network && online)) return { kind: 'schema', reason: 'offline', ...base };
  const canvas = makeCanvas(W, H);
  const ctx = canvas?.getContext('2d');
  if (!ctx) return { kind: 'schema', reason: 'canvas', ...base };
  ctx.fillStyle = '#e9eef0';
  ctx.fillRect(0, 0, W, H);
  let loaded = 0;
  const draw = (t, bmp) => { ctx.drawImage(bmp, Math.round(t.tx * TILE - left), Math.round(t.ty * TILE - top), TILE, TILE); bmp.close?.(); loaded++; };
  // 1. Cache de l'appareil.
  const missing = [];
  for (const t of tiles) { const bmp = await loadTile(tileURL(tpl, z, t.x, t.ty), { cache, network: false }); if (bmp) draw(t, bmp); else missing.push(t); }
  // 2. Réseau : une tuile d'essai (la plus centrale) puis, si elle arrive, les autres (4 requêtes simultanées).
  //    Réseau injoignable : une seule requête perdue au lieu d'une par tuile.
  if (missing.length && network && online) {
    missing.sort((a, b) => Math.hypot((a.tx + 0.5) * TILE - cx, (a.ty + 0.5) * TILE - cy) - Math.hypot((b.tx + 0.5) * TILE - cx, (b.ty + 0.5) * TILE - cy));
    const opts = { cache, network: true, timeoutMs, fetchTile };
    const probe = missing.shift();
    const first = await loadTile(tileURL(tpl, z, probe.x, probe.ty), opts);
    if (first) {
      draw(probe, first);
      const worker = async () => {
        while (missing.length) { const t = missing.shift(); const bmp = await loadTile(tileURL(tpl, z, t.x, t.ty), opts); if (bmp) draw(t, bmp); }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }
  }
  base.tiles.loaded = loaded;
  if (!tiles.length || loaded / tiles.length < minCoverage) return { kind: 'schema', reason: online && network ? 'tiles' : 'offline', ...base };
  let jpeg;
  try { jpeg = await canvasJPEG(canvas); } catch (e) { return { kind: 'schema', reason: 'canvas', ...base }; }
  return {
    kind: 'tiles', jpeg, width: W, height: H, ...base,
    metersPerPixel: metersPerPixel(center[0], z),
    project: (lat, lon) => [lonToPx(lon, z) - left, latToPx(lat, z) - top],
    attribution: orgSettings().tileAttribution || '© contributeurs OpenStreetMap'
  };
}
