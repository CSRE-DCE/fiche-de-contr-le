/* Carte des stations (#/carte) : une pastille par station aux couleurs de son type de tournée (biologie :
 * vert, cours d'eau : bleu, eaux souterraines : ardoise ; deux couleurs si plusieurs types), anneau selon le
 * statut de contrôle (tournée en cours : orange ; contrôlée dans l'année : coche verte), légende, filtres par
 * type, par réseau de surveillance (?reseau=<code>|aucun : une station sur deux réseaux est affichée sous chacun) et
 * par statut ; info-bulle « Réseaux : BIO, Chimie » ; un clic ouvre la fiche station. Ma position, préchargement
 * des tuiles pour le terrain (zones limitées), fonctionnement hors connexion (stations affichées même sans fond de
 * carte). */
import { html, esc } from '../core/util.js';
import { store } from '../core/store.js';
import { navigate } from '../ui/router.js';
import { toast, confirmDialog } from '../ui/dom.js';
import { pageTitle, networkDot, networkVars } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { siteLatLon } from '../ui/sheet-chrome.js';
import { createMap, tileUrls, preloadTiles, tileCacheCount, clearTileCache, tilesUsable, watchTiles, stationIcon, TYPE_STYLES, TYPE_ORDER, STATUS_STYLES } from '../ui/map.js';
import { getPosition } from '../ui/gps.js';
import { orgSettings } from '../app/settings.js';
import { siteTypes, stationStatus } from './station-sheet.js';
import { NO_NETWORK, inNetwork, siteNetworkCodes, sortNetworkCodes } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkOf } from '../app/networks.js';

let map = null, layer = null, meMarker = null;

/** Stations à afficher (filtres ?type=, ?reseau= et ?statut=) : [{site, ll, types, networks, status}]. */
function stations(q) {
  const year = new Date().getFullYear(), idx = currentNetworkIndex();
  return store.all('site').map(site => ({ site, ll: siteLatLon(site), types: siteTypes(site), networks: siteNetworkCodes(site, idx) }))
    .filter(x => x.ll && (!q.type || x.types.includes(q.type)) && (!q.reseau || inNetwork(x.networks, q.reseau)))
    .map(x => ({ ...x, status: stationStatus(x.site.id, { year }) }))
    .filter(x => !q.statut || x.status.key === q.statut);
}
/** Réseaux proposés au filtre (stations géolocalisées du type choisi ; réseau choisi toujours présent), effectifs. */
function networkChoices(q) {
  const list = stations({ type: q.type });
  const codes = sortNetworkCodes([...new Set(list.flatMap(x => x.networks)), ...(q.reseau && q.reseau !== NO_NETWORK ? [q.reseau] : [])], currentNetworkIndex());
  if (list.some(x => !x.networks.length) || q.reseau === NO_NETWORK) codes.push(NO_NETWORK);
  return codes.map(code => ({ code, n: code === NO_NETWORK ? null : currentNetworkOf(code), count: list.filter(x => inNetwork(x.networks, code)).length }));
}

export default {
  nav: 'carte', title: 'Carte',
  async render(params, q) {
    const n = await tileCacheCount();
    const list = stations(q);
    const usable = await tilesUsable();
    const chip = (k, v, label, extra = '', style = '') => html`<button class="chip ${(q[k] || '') === v ? 'sel' : ''}" data-act="filter" data-k="${k}" data-v="${v}" aria-pressed="${String((q[k] || '') === v)}" style="${style}">${extra}${label}</button>`;
    const nets = networkChoices(q);
    // Liste des stations avec les mêmes filtres (sinon : accueil avec les préférences de l'agent).
    const listHref = q.type || q.reseau ? '#/?' + new URLSearchParams({ type: q.type || '', reseau: q.reseau || '' }) : '#/';
    return html`${pageTitle('Carte des stations', `${list.length} station(s) affichée(s) · ${n} tuile(s) de carte disponibles hors connexion`, html`<a class="btn ghost" href="${listHref}"><span class="ic">${icon('station')}</span>Liste des stations</a>`)}
      <div class="chips" style="margin-bottom:6px" role="group" aria-label="Type de tournée">${chip('type', '', 'Toutes')}${TYPE_ORDER.map(t => chip('type', t, TYPE_STYLES[t].label, html`<i class="mk-chip" style="background:${TYPE_STYLES[t].color}"></i>`))}</div>
      ${nets.length ? html`<div class="chips is-wrap mp-nets" style="margin-bottom:6px" role="group" aria-label="Réseau de surveillance">${chip('reseau', '', 'Tous réseaux')}${nets.map(x => chip('reseau', x.code, html`${x.n ? x.n.code : 'Sans réseau'}<span class="count">${x.count}</span>`, x.n ? networkDot(x.n) : html`<span class="net-dot" aria-hidden="true"></span>`, x.n ? networkVars(x.n) : ''))}</div>` : ''}
      <div class="chips" style="margin-bottom:8px" role="group" aria-label="Statut de contrôle">${chip('statut', '', 'Tous statuts')}${Object.entries(STATUS_STYLES).map(([k, s]) => chip('statut', k, k === 'controlee' ? `Contrôlées en ${new Date().getFullYear()}` : s.label))}</div>
      ${usable ? '' : html`<div class="banner warn">Hors connexion et aucune zone préchargée : fond de carte indisponible. Les stations restent affichées à leur position.</div>`}
      <div class="map-box mp-box" id="mapBox" role="application" aria-label="Carte interactive des stations"></div>
      <div class="map-legend mp-legend">${TYPE_ORDER.map(t => html`<span><i style="background:${TYPE_STYLES[t].color}"></i>${TYPE_STYLES[t].label}</span>`)}
        <span><i class="mp-multi"></i>Plusieurs types</span>
        <span><i class="mp-ring is-en_cours"></i>${STATUS_STYLES.en_cours.label}</span>
        <span><i class="mp-ring is-controlee"></i>Contrôlée en ${new Date().getFullYear()}</span></div>
      <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="me"><span class="ic">${icon('pin')}</span>Ma position</button><button class="btn ghost" data-act="preload"><span class="ic">${icon('download')}</span>Précharger la zone affichée</button>${n ? html`<button class="btn ghost" data-act="clear">Vider le cache de carte</button>` : ''}</div>
      <p class="note" id="preloadMsg">Touchez une station pour ouvrir sa fiche. Préchargement limité au niveau de zoom ${orgSettings().maxPreloadZoom} et à 1 500 tuiles par zone, pour respecter les conditions d’utilisation du serveur de tuiles (configurable dans Administration). Les stations restent affichées même sans fond de carte.</p>`;
  },
  async mount(root, params, q) {
    const box = root.querySelector('#mapBox');
    if (!globalThis.L) { box.innerHTML = String(html`<div class="empty">${icon('map', { size: 44 })}<div>Carte indisponible sur cet appareil.</div></div>`); return; }
    const tiles = await tilesUsable();
    if (!box.isConnected) return;
    map = createMap(box, { tiles });
    if (tiles) watchTiles(map, { onFail: () => box.classList.add('is-offline'), onLoad: () => box.classList.remove('is-offline') });
    else box.classList.add('is-offline');
    const L = globalThis.L;
    layer = L.layerGroup().addTo(map);
    const bounds = [];
    let focus = null;
    const focusSite = q.site || (q.point ? store.get('point', q.point)?.siteId : null);
    for (const x of stations(q)) {
      const { site, ll, types, status } = x;
      const m = L.marker(ll, { icon: stationIcon({ types, status: status.key, size: status.key === 'a_controler' ? 20 : 24 }), title: `${site.name} (${site.code})`, riseOnHover: true, keyboard: true }).addTo(layer);
      m.bindTooltip(`<b>${esc(site.name)}</b><br>${esc(site.code)} · ${esc(types.map(t => TYPE_STYLES[t].label).join(', '))}<br>Réseaux : ${esc(x.networks.join(', ') || 'aucun')}<br>${esc(status.label)}`, { direction: 'top', offset: [0, -10] });
      m.on('click', () => navigate('/station/' + encodeURIComponent(site.id)));
      bounds.push(ll);
      if (focusSite === site.id) focus = { m, ll };
    }
    if (focus) { map.setView(focus.ll, 12, { animate: false }); focus.m.openTooltip(); }
    else if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
    setTimeout(() => map?.invalidateSize(), 100);
  },
  unmount() { if (map) { map.remove(); map = null; layer = null; meMarker = null; } },
  handlers: {
    filter(el) {
      const q = { ...this.query, [el.dataset.k]: el.dataset.v };
      if (!q[el.dataset.k]) delete q[el.dataset.k];
      delete q.site; delete q.point;
      navigate('/carte?' + new URLSearchParams(q), { replace: true });
    },
    async me() {
      try {
        const p = await getPosition({ timeout: 20000 });
        if (meMarker) meMarker.remove();
        meMarker = globalThis.L.circleMarker([p.lat, p.lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#7b2cbf', fillOpacity: 1 }).addTo(map).bindPopup(`Ma position (±${Math.round(p.accuracy)} m)`).openPopup();
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12));
      } catch (e) { toast(e.message, 'err'); }
    },
    async preload() {
      if (!navigator.onLine) { toast('Le préchargement nécessite une connexion.', 'warn'); return; }
      const b = map.getBounds(), z = map.getZoom(), maxZ = Math.min(Number(orgSettings().maxPreloadZoom) || 14, z + 3);
      const urls = tileUrls({ west: b.getWest(), east: b.getEast(), north: b.getNorth(), south: b.getSouth() }, Math.max(3, z - 2), Math.max(z, Math.min(maxZ, 18)));
      if (urls.length > 1500) { toast(`Zone trop étendue (${urls.length}+ tuiles) : zoomez sur la zone de terrain.`, 'warn', 5000); return; }
      if (!(await confirmDialog({ title: 'Précharger la carte', message: `${urls.length} tuile(s) vont être téléchargées pour un usage hors connexion (zoom ${Math.max(3, z - 2)} à ${Math.max(z, maxZ)}).`, okLabel: 'Télécharger' }))) return;
      const msg = document.getElementById('preloadMsg');
      const r = await preloadTiles(urls, (d, t) => { if (msg) msg.textContent = `Téléchargement des tuiles : ${d} / ${t}`; });
      toast(`Carte préchargée : ${r.saved} nouvelle(s), ${r.skipped} déjà présente(s)${r.failed ? `, ${r.failed} échec(s)` : ''}`, r.failed ? 'warn' : 'ok', 5000);
      this.refresh();
    },
    async clear() { if (await confirmDialog({ title: 'Vider le cache de carte', message: 'Supprimer les tuiles préchargées ?', danger: true })) { await clearTileCache(); this.refresh(); } }
  }
};
