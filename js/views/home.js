/* Accueil « Stations » (#/) : toutes les stations du référentiel en cartes aux couleurs de la charte
 * (biologie : vert, cours d'eau : bleu, eaux souterraines : ardoise), filtres par type de tournée avec
 * effectifs (Biologie / Cours d’eau / Eaux souterraines), recherche (nom, code, bassin, commune, cours d'eau),
 * filtre par bassin et par statut de contrôle (à contrôler / tournée en cours / contrôlée dans l'année, déduit
 * des tournées dont la liste des stations contient la station), pictogrammes des compartiments à contrôler,
 * tournées en cours à reprendre, bouton « + Nouvelle tournée » et lien vers la carte. Carte → fiche station.
 * Mode autonome (celui de l'OEG) : bandeau « n modifications à envoyer à l'autre tablette » avec « Envoyer à l'autre
 * tablette » et « Recevoir un fichier » (js/views/exchange.js). */
import { html, normalize, sortBy, fmtDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, isTeamMode } from '../core/auth.js';
import { homeBanner, sendDialog, receiveFile, passwordDialog } from './exchange.js';
import { navigate } from '../ui/router.js';
import { icon } from '../ui/icons.js';
import { empty, options } from '../ui/components.js';
import { auditDate, byAuditDateDesc } from '../domain/model.js';
import { guyaneInset, assetURL, LOGO_URL } from '../ui/sheet-chrome.js';
import { mediaURL } from '../core/media.js';
import { TYPE_STYLES, TYPE_ORDER, STATUS_STYLES } from '../ui/map.js';
import { pref, setPref } from '../app/settings.js';
import { providerHeaderName } from '../domain/grids.js';
import { ctGrid, siteTypes, primaryType, stationStatus, plannedLabel, typeBadges } from './station-sheet.js';
import { tourControllers, isAuditController } from '../app/audits.js';

const YEAR = () => new Date().getFullYear();
const STATUS_ORDER = { en_cours: 0, a_controler: 1, controlee: 2 };
const searchText = s => normalize([s.name, s.code, s.bassin, s.commune, s.riverName, s.masseEau, s.nature, s.aquifere].filter(Boolean).join(' '));

/** Données de l'accueil, calculées en un passage sur les tournées et les prestations. */
function collect() {
  const year = YEAR();
  const bySite = new Map();
  const push = (id, a) => { if (!bySite.has(id)) bySite.set(id, []); bySite.get(id).push(a); };
  for (const a of store.filter('audit', x => x.status !== 'abandonne')) {
    const ids = (a.stations || []).length ? a.stations.map(s => s.siteId) : [a.siteId];
    for (const id of new Set(ids.filter(Boolean))) push(id, a);
  }
  const prestBySite = new Map();
  for (const p of store.filter('prestation', x => ['prevue', 'reportee'].includes(x.status))) {
    if (!prestBySite.has(p.siteId)) prestBySite.set(p.siteId, []);
    prestBySite.get(p.siteId).push(p);
  }
  return store.all('site').map(site => {
    const audits = [...(bySite.get(site.id) || [])].sort(byAuditDateDesc);
    const prestations = sortBy((prestBySite.get(site.id) || []).filter(p => !audits.some(a => a.lock?.lockedAt && ((a.prestationIds || []).includes(p.id) || a.prestationId === p.id))), p => p.plannedDate || '9999');
    return { site, types: siteTypes(site), status: stationStatus(site.id, { year, audits }), audits, prestations, text: searchText(site) };
  });
}

function compPictos(site, grid) {
  const comps = (grid.compartments || []).filter(c => !c.always && (site.compartments || []).includes(c.key));
  return comps.length ? html`<span class="hm-comps" aria-label="Compartiments à contrôler">${comps.map(c => html`<span class="hm-comp" title="${c.label}">${icon(c.icon || 'check', { size: 18, title: c.label })}</span>`)}</span>` : '';
}

function stationCard(x, grid) {
  const { site, status, prestations, audits } = x;
  const t = TYPE_STYLES[primaryType(site)] || TYPE_STYLES.ce;
  const rd = site.photos?.RD;
  const visual = rd?.mediaId ? html`<span class="hm-thumb" data-hm-media="${rd.mediaId}" data-fallback="${rd.src ? assetURL(rd.src) : ''}"></span>`
    : rd?.src ? html`<span class="hm-thumb" style="background-image:url(&quot;${assetURL(rd.src)}&quot;)"></span>`
    : html`<span class="hm-inset">${guyaneInset(site, { size: 50 })}</span>`;
  const next = prestations[0];
  const last = audits[0];
  const place = [site.bassin, site.commune, site.riverName && site.riverName !== site.bassin ? site.riverName : ''].filter(Boolean).join(' · ');
  return html`<a class="hm-card th-${t.theme} is-${status.key}" href="#/station/${encodeURIComponent(site.id)}" data-search="${x.text}">
    <span class="hm-top"><span class="hm-badges">${typeBadges(site, { short: true })}</span><span class="hm-code">${site.code}</span></span>
    <span class="hm-main">
      <span class="hm-txt"><span class="hm-k">${site.codeType === 'BSS' ? 'Point d’eau' : 'Station'}</span><span class="hm-name">${site.name}</span>
        <span class="hm-place">${place || site.kind || '—'}</span></span>
      ${visual}
    </span>
    ${compPictos(site, grid)}
    <span class="hm-foot">
      <span class="badge ${status.cls}">${status.key === 'en_cours' ? icon('route', { size: 14 }) : status.key === 'controlee' ? icon('check', { size: 14 }) : ''}${status.label}</span>
      ${next ? html`<span class="hm-next${next.plannedDate ? '' : ' is-unplanned'}" title="${next.ref}">${icon('calendar', { size: 14 })}${providerHeaderName(store.get('provider', next.providerId)) || ''} · ${plannedLabel(next)}</span>` : ''}
      ${last && status.key !== 'en_cours' ? html`<span class="hm-last">Dernière tournée : ${last.number} (${fmtDate(auditDate(last))})</span>` : ''}
    </span>
  </a>`;
}

/**
 * Tournées en cours sur la tablette : d'abord celles dont l'agent connecté est contrôleur, puis celles commencées
 * sur cette tablette (binôme : la tournée du collègue), puis les autres ; les plus récentes d'abord.
 */
function openTours() {
  const list = store.filter('audit', a => !a.lock?.lockedAt && ['en_cours', 'termine'].includes(a.status));
  const rank = a => isAuditController(a, session.user?.id) ? 0 : a.device?.id === session.device?.id ? 1 : 2;
  return [...list].sort(byAuditDateDesc).sort((a, b) => rank(a) - rank(b));
}

export default {
  nav: 'home', title: 'Stations',
  async render(params, q) {
    const grid = ctGrid();
    const all = collect();
    const remembered = pref('home.type', '');
    const type = q.type !== undefined ? (TYPE_STYLES[q.type] ? q.type : '') : (TYPE_STYLES[remembered] ? remembered : '');
    const byType = all.filter(x => !type || x.types.includes(type));
    const bassins = sortBy([...new Set(byType.map(x => x.site.bassin).filter(Boolean))], b => b);
    const byBassin = byType.filter(x => !q.bassin || x.site.bassin === q.bassin);
    const statusCount = k => byBassin.filter(x => x.status.key === k).length;
    const list = sortBy(byBassin.filter(x => !q.statut || x.status.key === q.statut), x => STATUS_ORDER[x.status.key], x => (x.prestations.length ? 0 : 1), x => x.site.name);
    const tours = openTours();
    const text = normalize(q.q || '');
    const shown = list.filter(x => !text || x.text.includes(text)).length;
    return html`
      <section class="hm-hero">
        <img class="hm-logo" src="${LOGO_URL}" alt="" width="64" height="64">
        <div class="hm-hero-txt"><h1>Stations</h1><p>${grid.name || 'Contrôle terrain des prestations de prélèvement'} · ${all.length} station${all.length > 1 ? 's' : ''} au référentiel</p></div>
        <div class="hm-hero-actions">
          ${can('audit.create') ? html`<a class="btn primary lg" href="#/nouvel-audit${type ? '?type=' + type : ''}"><span class="ic">${icon('plus')}</span>Nouvelle tournée</a>` : ''}
          <a class="btn ghost" href="#/carte${type ? '?type=' + type : ''}"><span class="ic">${icon('map')}</span>Carte<span class="hm-opt"> des stations</span></a>
        </div>
      </section>
      ${isTeamMode() ? '' : await homeBanner()}
      ${tours.length ? html`<section class="hm-tours" aria-label="Tournées en cours sur cette tablette"><h2>${icon('route', { size: 20 })}Tournées en cours sur cette tablette</h2><div class="hm-tour-list">${tours.slice(0, 6).map(a => {
        const tt = TYPE_STYLES[a.auditType];
        const names = (a.stations || []).map(s => store.get('site', s.siteId)?.name || s.key);
        const mine = isAuditController(a, session.user?.id);
        const ctrls = tourControllers(a);
        return html`<a class="hm-tour${mine ? ' is-mine' : ''}" href="#/audit/${a.id}" data-tour="${a.id}"><span class="hm-tour-top"><b>${a.number}</b>${tt ? html`<span class="type-badge t-${a.auditType}">${icon(tt.icon, { size: 14 })}${tt.label}</span>` : ''}</span>
          <span class="hm-tour-st">${names.length ? names.map((n, i) => html`<span><i>${i + 1}</i>${n}</span>`) : '—'}</span>
          <span class="hm-tour-meta">${providerHeaderName(store.get('provider', a.providerId)) || '—'} · ${fmtDate(auditDate(a))}${a.device?.id && a.device.id !== session.device?.id ? ` · commencée sur ${a.device.name || 'une autre tablette'}` : ''}</span>
          <span class="hm-tour-ctrl" title="Contrôleurs OEG de la tournée">${icon('people', { size: 15 })}${ctrls.map(c => c.name).filter(Boolean).join(', ') || '—'}</span>
          <span class="btn ${mine ? 'primary' : 'ghost'} sm">${mine ? 'Reprendre' : can('audit.edit') ? 'Voir ou rejoindre' : 'Voir'}</span></a>`;
      })}</div></section>` : ''}
      <section class="hm-filters" aria-label="Filtres">
        <div class="chips hm-types" role="group" aria-label="Type de tournée">
          <button class="chip ${!type ? 'sel' : ''}" data-act="type" data-v="" aria-pressed="${!type}">${icon('station')}Toutes<span class="count">${all.length}</span></button>
          ${TYPE_ORDER.map(k => html`<button class="chip hm-chip-${k} ${type === k ? 'sel' : ''}" data-act="type" data-v="${k}" aria-pressed="${type === k}">${icon(TYPE_STYLES[k].icon)}${TYPE_STYLES[k].label}<span class="count">${all.filter(x => x.types.includes(k)).length}</span></button>`)}
        </div>
        <div class="hm-row">
          <label class="hm-search"><span class="sr">Rechercher une station</span>${icon('search', { size: 20 })}<input type="search" value="${q.q || ''}" placeholder="Rechercher : nom, code, bassin, commune…" data-input="search" autocomplete="off"></label>
          <label class="hm-bassin"><span class="sr">Bassin versant</span><select data-change="bassin">${options(bassins, q.bassin || '', { placeholder: 'Tous les bassins' })}</select></label>
        </div>
        <div class="chips hm-status" role="group" aria-label="Statut de contrôle">
          <button class="chip ${!q.statut ? 'sel' : ''}" data-act="statut" data-v="">Tous statuts<span class="count">${byBassin.length}</span></button>
          ${Object.entries(STATUS_STYLES).map(([k, s]) => html`<button class="chip hm-st-${k} ${q.statut === k ? 'sel' : ''}" data-act="statut" data-v="${k}" aria-pressed="${q.statut === k}"><i class="hm-dot"></i>${k === 'controlee' ? `Contrôlée en ${YEAR()}` : s.label}<span class="count">${statusCount(k)}</span></button>`)}
        </div>
      </section>
      <p class="hm-count" id="hmCount" aria-live="polite">${shown} station${shown > 1 ? 's' : ''} affichée${shown > 1 ? 's' : ''}</p>
      ${list.length ? html`<div class="hm-grid" id="hmGrid">${list.map(x => stationCard(x, grid))}</div>
        <div class="card hide" id="hmNone">${empty(icon('search', { size: 44 }), 'Aucune station ne correspond à la recherche.')}</div>`
        : html`<div class="card">${empty(icon('station', { size: 44 }), all.length ? 'Aucune station pour ces filtres.' : 'Aucune station sur cet appareil : installez le référentiel (Administration › Données et stockage) ou synchronisez.', all.length ? html`<button class="btn ghost" data-act="reset">Effacer les filtres</button>` : '')}</div>`}`;
  },
  async mount(root, params, q) {
    if (q.q) filterCards(root, q.q);
    for (const el of root.querySelectorAll('[data-hm-media]')) {
      const url = await mediaURL(el.dataset.hmMedia).catch(() => null) || el.dataset.fallback;
      if (url) el.style.backgroundImage = `url("${url}")`;
    }
  },
  handlers: {
    async 'xch-send'() { if (await sendDialog()) this.refresh(); },
    async 'xch-receive'(el) { const f = el.files[0]; el.value = ''; if (!f) return; if (await receiveFile(f)) this.refresh(); },
    async 'xch-password'() { if (await passwordDialog()) this.refresh(); },
    type(el) {
      setPref('home.type', el.dataset.v || '');
      const q = { ...this.query, type: el.dataset.v || '' };
      delete q.statut; delete q.bassin;
      navigate('/?' + new URLSearchParams(q), { replace: true });
    },
    statut(el) { const q = { ...this.query, statut: el.dataset.v }; if (!q.statut) delete q.statut; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    bassin(el) { const q = { ...this.query, bassin: el.value }; if (!q.bassin) delete q.bassin; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    reset() { navigate('/?type=', { replace: true }); },
    search(el) {
      filterCards(document.getElementById('view') || document, el.value);
      // Recherche mémorisée dans l'adresse sans réafficher l'écran (le champ garde le focus).
      const q = { ...this.query, q: el.value };
      if (!q.q) delete q.q;
      this.query.q = q.q;
      history.replaceState(null, '', '#/?' + new URLSearchParams(q));
    }
  }
};

/** Filtrage instantané des cartes (sans réaffichage). */
function filterCards(root, value) {
  const t = normalize(value);
  let n = 0;
  for (const card of root.querySelectorAll('.hm-card')) {
    const ok = !t || card.dataset.search.includes(t);
    card.hidden = !ok;
    if (ok) n++;
  }
  const c = root.querySelector('#hmCount');
  if (c) c.textContent = `${n} station${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''}`;
  root.querySelector('#hmNone')?.classList.toggle('hide', n > 0 || !root.querySelector('.hm-card'));
}
