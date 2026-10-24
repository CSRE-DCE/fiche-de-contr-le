/* Service worker — Fiches de contrôle terrain (OEG).
 *  - Fichiers de l'application (liste SHELL) : « réseau d'abord, repli sur le cache » (toujours la dernière
 *    version dès qu'il y a du réseau ; utilisation intégrale hors connexion sinon). Tous les fichiers sont
 *    préchargés à l'installation : l'application fonctionne hors connexion dès la première ouverture.
 *  - Tuiles de carte : « cache d'abord », dans un cache séparé conservé d'une version à l'autre
 *    (zones préchargées depuis l'écran Carte).
 *  - API GitHub (synchronisation) : autre domaine, jamais mise en cache par ce service worker.
 * IMPORTANT : à chaque publication d'une modification de l'application, incrémenter AUDIT_BUILD dans
 * version.js (python tools/bump_version.py) et tenir SHELL à jour (vérifié par tools/check_release.py).
 */
importScripts('./version.js');
const CACHE = 'oeg-ct-build-' + self.AUDIT_BUILD;
const TILE_CACHE = 'oeg-ct-tiles';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './version.js',
  './css/attendus.css',
  './css/audit-sheet.css',
  './css/sheet.css',
  './css/station.css',
  './data/attendus-ct-2026.json',
  './data/referentiel-oeg.json',
  './fonts/Barlow-Bold.woff2',
  './fonts/Barlow-Italic.woff2',
  './fonts/Barlow-Medium.woff2',
  './fonts/Barlow-Regular.woff2',
  './fonts/Barlow-SemiBold.woff2',
  './fonts/BarlowCondensed-Bold.woff2',
  './fonts/BarlowCondensed-ExtraBold.woff2',
  './fonts/BarlowCondensed-SemiBold.woff2',
  './fonts/Montserrat-Black.woff2',
  './fonts/Montserrat-ExtraBold.woff2',
  './fonts/pdf/Barlow-Bold.ttf',
  './fonts/pdf/Barlow-Italic.ttf',
  './fonts/pdf/Barlow-Regular.ttf',
  './fonts/pdf/Barlow-SemiBold.ttf',
  './fonts/pdf/BarlowCondensed-Bold.ttf',
  './fonts/pdf/Montserrat-Black.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/logo-oeg-rond.png',
  './icons/logo-oeg.png',
  './img/foret.svg',
  './img/stations/09271503/AM.jpg',
  './img/stations/09271503/AV.jpg',
  './img/stations/09271503/RD.jpg',
  './img/stations/09271503/RG.jpg',
  './js/app/attendus-pdf.js',
  './js/app/audits.js',
  './js/app/bootstrap.js',
  './js/app/documents.js',
  './js/app/exchange-file.js',
  './js/app/exchange.js',
  './js/app/exports.js',
  './js/app/github.js',
  './js/app/imports.js',
  './js/app/logo.js',
  './js/app/networks.js',
  './js/app/numbering.js',
  './js/app/operators.js',
  './js/app/report.js',
  './js/app/settings.js',
  './js/app/sheets-pdf.js',
  './js/app/static-map.js',
  './js/app/sync.js',
  './js/core/auth.js',
  './js/core/crypto.js',
  './js/core/db.js',
  './js/core/media.js',
  './js/core/session.js',
  './js/core/store.js',
  './js/core/util.js',
  './js/domain/compare.js',
  './js/domain/coords.js',
  './js/domain/default-grids.js',
  './js/domain/exchange.js',
  './js/domain/grading.js',
  './js/domain/grid-ct-2026.js',
  './js/domain/grids.js',
  './js/domain/links.js',
  './js/domain/merge.js',
  './js/domain/model.js',
  './js/domain/networks.js',
  './js/domain/normalize.js',
  './js/domain/operators.js',
  './js/domain/permissions.js',
  './js/domain/rules.js',
  './js/domain/seed.js',
  './js/domain/summary.js',
  './js/formats/csv.js',
  './js/formats/ics.js',
  './js/formats/pdf.js',
  './js/formats/xlsx.js',
  './js/lib/exif.js',
  './js/lib/geo.js',
  './js/lib/guyane.js',
  './js/main.js',
  './js/ui/capture.js',
  './js/ui/components.js',
  './js/ui/dom.js',
  './js/ui/gps.js',
  './js/ui/icons.js',
  './js/ui/logo.js',
  './js/ui/map.js',
  './js/ui/router.js',
  './js/ui/scanner.js',
  './js/ui/sheet-chrome.js',
  './js/ui/signature.js',
  './js/ui/themes.js',
  './js/ui/voice.js',
  './js/views/admin.js',
  './js/views/attendus.js',
  './js/views/audit-modules.js',
  './js/views/audit-new.js',
  './js/views/audit-sheet.js',
  './js/views/audit.js',
  './js/views/audits.js',
  './js/views/auth.js',
  './js/views/compare.js',
  './js/views/dashboard.js',
  './js/views/deviations.js',
  './js/views/documents.js',
  './js/views/exchange.js',
  './js/views/exports.js',
  './js/views/grids.js',
  './js/views/home.js',
  './js/views/imports.js',
  './js/views/map.js',
  './js/views/menu.js',
  './js/views/observations.js',
  './js/views/planning.js',
  './js/views/prestation.js',
  './js/views/providers.js',
  './js/views/referentials.js',
  './js/views/shell.js',
  './js/views/station-edit.js',
  './js/views/station-sheet.js',
  './js/views/station.js',
  './js/views/sync.js',
  './js/views/trail.js',
  './vendor/jsqr/jsQR.js',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('oeg-ct-build-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

const isTile = url => /\/\d+\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)(\?.*)?$/i.test(url.pathname + url.search);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/api/')) return;               // API : jamais de cache
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const resp = await fetch(req, { cache: 'no-store' });
        if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || new Response('Hors connexion', { status: 503 });
        return new Response('Hors connexion : ressource non disponible.', { status: 503 });
      }
    })());
    return;
  }
  if (isTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
        return resp;
      } catch (e) { return new Response('', { status: 504 }); }
    })());
  }
});
