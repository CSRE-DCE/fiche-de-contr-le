/* Carte interactive (Leaflet embarqué) et préchargement des tuiles pour un usage hors connexion.
 * Les tuiles sont conservées dans un cache dédié du navigateur (servi par le service worker). Le
 * préchargement est volontairement limité (niveau de zoom et nombre de tuiles plafonnés) pour respecter
 * les conditions d'utilisation des serveurs de tuiles ; un serveur interne peut être configuré.
 *
 * Symboles partagés par la carte des stations (js/views/map.js) et la « Localisation cartographique » de la
 * fiche station (js/views/station-sheet.js) : couleurs des types de tournée (charte : thèmes green / ocean /
 * slate), pictogrammes des points de prélèvement (légende des maquettes : Station · Prélèvement · Faune
 * invertébrée benthique · Diatomées · Ichtyofaune). Hors connexion sans tuile préchargée, aucune tuile n'est
 * demandée (pas d'erreurs réseau inutiles) : les vues affichent un repli (encart Guyane + coordonnées). */
import { orgSettings } from '../app/settings.js';

export const TILE_CACHE = 'oeg-ct-tiles';
const MAX_TILES = 1500;

/**
 * Crée une carte Leaflet. opts : center, zoom, tiles (false : sans fond de carte), interactive (false : ni
 * déplacement ni zoom à la molette — carte insérée dans une fiche qu'on fait défiler), et toute option Leaflet.
 * La couche de tuiles est accessible par map.oegTiles (null sans fond de carte).
 */
export function createMap(el, { center = [4.0, -53.0], zoom = 7, tiles = true, interactive = true, ...opts } = {}) {
  const L = globalThis.L;
  if (!L) throw new Error('Carte indisponible (Leaflet non chargé).');
  const s = orgSettings();
  const touch = !!(L.Browser && (L.Browser.mobile || L.Browser.touch));
  const map = L.map(el, {
    zoomControl: true, attributionControl: true, preferCanvas: true,
    ...(interactive ? {} : { scrollWheelZoom: false, dragging: !touch, tap: false, boxZoom: false, keyboard: false }),
    ...opts
  }).setView(center, zoom);
  map.oegTiles = tiles ? L.tileLayer(s.tileUrl, { maxZoom: 18, attribution: s.tileAttribution, crossOrigin: true }).addTo(map) : null;
  return map;
}

/** Un fond de carte peut-il s'afficher ? (en ligne, ou tuiles préchargées dans le cache de l'appareil) */
export async function tilesUsable() {
  if (globalThis.navigator?.onLine !== false) return true;
  return (await tileCacheCount()) > 0;
}

/**
 * Surveille le chargement des tuiles d'une carte : onFail() si aucune tuile n'a pu être chargée (réseau
 * coupé, serveur injoignable), onLoad() dès qu'une tuile s'affiche. dropOnFail : la couche de tuiles est alors
 * retirée (plus aucune requête inutile tant que l'écran reste affiché).
 */
export function watchTiles(map, { onFail = () => {}, onLoad = () => {}, dropOnFail = true } = {}) {
  const layer = map?.oegTiles;
  if (!layer) { onFail(); return; }
  let ok = 0, failed = 0, done = false;
  layer.on('tileload', () => { if (!ok++) onLoad(); });
  layer.on('tileerror', () => {
    failed++;
    if (ok || done || failed < 2) return;
    done = true;
    if (dropOnFail) { try { map.removeLayer(layer); map.oegTiles = null; } catch (e) { /* carte déjà libérée */ } }
    onFail();
  });
}

function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); }

/** Liste des URL de tuiles couvrant une emprise, du zoom minZ au zoom maxZ. */
export function tileUrls(bounds, minZ, maxZ, template = orgSettings().tileUrl) {
  const urls = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x1 = lon2tile(bounds.west, z), x2 = lon2tile(bounds.east, z), y1 = lat2tile(bounds.north, z), y2 = lat2tile(bounds.south, z);
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a').replace('{r}', ''));
      if (urls.length > MAX_TILES) return urls;
    }
  }
  return urls;
}

/** Précharge les tuiles ; onProgress(done, total). Retourne {saved, failed, skipped, total}. */
export async function preloadTiles(urls, onProgress = () => {}) {
  if (urls.length > MAX_TILES) throw new Error(`Zone trop étendue (${urls.length} tuiles, maximum ${MAX_TILES}) : zoomez davantage.`);
  const cache = await caches.open(TILE_CACHE);
  let done = 0, saved = 0, failed = 0, skipped = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (await cache.match(url)) skipped++;
        else { const r = await fetch(url, { mode: 'cors' }); if (r.ok) { await cache.put(url, r); saved++; } else failed++; }
      } catch (e) { failed++; }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { saved, failed, skipped, total: urls.length };
}
export async function tileCacheCount() { try { return (await (await caches.open(TILE_CACHE)).keys()).length; } catch (e) { return 0; } }
export async function clearTileCache() { await caches.delete(TILE_CACHE); }

/* ---------- Symboles ---------- */
/** Types de tournée : libellés, couleurs (thèmes de js/ui/themes.js) et pictogrammes (js/ui/icons.js). */
export const TYPE_STYLES = {
  bio: { key: 'bio', label: 'Biologie', long: 'Hydrobiologie – RCS ESC BIO', color: '#2f8a3f', dark: '#1f5f30', light: '#e4f4e8', theme: 'green', icon: 'fish' },
  ce: { key: 'ce', label: 'Cours d’eau', long: 'Cours d’eau – physico-chimie', color: '#0b6cb4', dark: '#0d3577', light: '#e6f6fd', theme: 'ocean', icon: 'wave' },
  eso: { key: 'eso', label: 'Eaux souterraines', long: 'Eaux souterraines', color: '#2f6f8f', dark: '#163e57', light: '#e3eef5', theme: 'slate', icon: 'well' }
};
export const TYPE_ORDER = ['bio', 'ce', 'eso'];

/** Statut de contrôle d'une station (carte, accueil) : couleur d'anneau / pastille. */
export const STATUS_STYLES = {
  a_controler: { label: 'À contrôler', color: '#8a979c', cls: 'outline' },
  en_cours: { label: 'Tournée en cours', color: '#d97706', cls: 'perf' },
  controlee: { label: 'Contrôlée', color: '#1b7a43', cls: 'ok' }
};

/** Points d'une station (légende des maquettes de la feuille 1). shape : star | cross | triangle | diamond | circle. */
export const SAMPLING_KINDS = {
  station: { label: 'Station', shape: 'star', color: '#e3262b' },
  prelevement: { label: 'Prélèvement', shape: 'cross', color: '#f2b705' },
  invertebres: { label: 'Faune invertébrée benthique', shape: 'triangle', color: '#c2189b' },
  diatomees: { label: 'Diatomées', shape: 'diamond', color: '#1f5fd1' },
  ichtyofaune: { label: 'Ichtyofaune', shape: 'star', color: '#f29d0b' }
};
const SHAPES = {
  star: 'M12 1.6l3.1 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.4 5.6 21l1.5-7.1L1.7 9l7.2-.8Z',
  cross: 'M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9Z',
  triangle: 'M12 2.4 22.4 20.6H1.6Z',
  diamond: 'M12 1.8 22.2 12 12 22.2 1.8 12Z',
  circle: 'M12 2.6a9.4 9.4 0 1 1 0 18.8 9.4 9.4 0 0 1 0-18.8Z'
};
/** Symbole SVG d'un type de point (chaîne HTML, liseré sombre pour rester lisible sur le fond de carte). */
export function kindSVG(kind, size = 18) {
  const k = SAMPLING_KINDS[kind] || SAMPLING_KINDS.prelevement;
  return `<svg class="mk-sym mk-${kind}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${SHAPES[k.shape] || SHAPES.circle}" fill="${k.color}" stroke="#3a1a10" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}
/** Icône Leaflet (divIcon) d'un point de prélèvement ou de la station. */
export function kindIcon(kind, { size = 22, title = '' } = {}) {
  const L = globalThis.L;
  return L.divIcon({ className: 'mk-icon', html: `<span class="mk-wrap" title="${String(title).replace(/[&<>"]/g, '')}">${kindSVG(kind, size)}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
/**
 * Icône Leaflet d'une station de la carte générale : pastille à la couleur du type de tournée, anneau selon le
 * statut de contrôle (orange : tournée en cours ; coche verte : contrôlée), deux couleurs si plusieurs types.
 */
export function stationIcon({ types = [], status = 'a_controler', size = 22 } = {}) {
  const L = globalThis.L;
  const list = types.filter(t => TYPE_STYLES[t]);
  const colors = (list.length ? list : ['ce']).map(t => TYPE_STYLES[t].color);
  const fill = colors.length > 1 ? `conic-gradient(${colors.map((c, i) => `${c} ${i * 360 / colors.length}deg ${(i + 1) * 360 / colors.length}deg`).join(',')})` : colors[0];
  const html = `<span class="mk-st is-${status}" style="--mk-fill:${fill};width:${size}px;height:${size}px">${status === 'controlee' ? '<i>✓</i>' : ''}</span>`;
  return L.divIcon({ className: 'mk-icon', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
