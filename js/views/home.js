/* Accueil « Stations » (#/) : toutes les stations du référentiel en cartes aux couleurs de la charte
 * (biologie : vert, cours d'eau : bleu, eaux souterraines : ardoise), filtres par type de tournée avec
 * effectifs (Biologie / Cours d’eau / Eaux souterraines), par réseau de surveillance (Tous / BIO / Chimie / RCO / EL /
 * ESO… / Sans réseau, effectifs en stations DISTINCTES), recherche instantanée (nom, code, bassin, commune, cours
 * d'eau, réseaux), filtre par bassin et par statut de contrôle (à contrôler / tournée en cours / contrôlée dans
 * l'année, déduit des tournées dont la liste des stations contient la station), pictogrammes des compartiments à
 * contrôler, tournées en cours à reprendre, bouton « + Nouvelle tournée » et lien vers la carte. Carte → fiche station.
 * « Ranger : par réseau | par statut » (par réseau d'office) :
 *  - par réseau : une section par réseau (titre h2 : pastille, code, libellé, effectif ; référentiel « Réseaux »,
 *    js/app/networks.js) ; une station sur deux réseaux figure dans CHAQUE section avec « Aussi : … », mais le total
 *    « n stations affichées » et les effectifs des filtres comptent les stations distinctes (108, pas 124) ; la
 *    recherche masque les sections vides et met leurs effectifs à jour ;
 *  - par statut : grille historique (#hmGrid.hm-grid), triée par statut de contrôle.
 * Type, réseau et rangement sont mémorisés PAR AGENT (préférences « u:<profil>:home.* » : sur une tablette partagée,
 * l'agent suivant ne reçoit pas les filtres du précédent) ; « Effacer les filtres » vide aussi le réseau.
 * Paramètres : ?type=bio|ce|eso, ?reseau=<code>|aucun, ?ranger=reseau|statut, ?bassin=, ?statut=, ?q=.
 * Mode autonome (celui de l'OEG) : bandeau « n modifications à envoyer à l'autre tablette » avec « Envoyer à l'autre
 * tablette » et « Recevoir un fichier » (js/views/exchange.js). */
import { html, normalize, sortBy, fmtDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, isTeamMode } from '../core/auth.js';
import { homeBanner, sendDialog, receiveFile, passwordDialog } from './exchange.js';
import { navigate } from '../ui/router.js';
import { icon } from '../ui/icons.js';
import { empty, options, networkDot, networkBadges, networkVars } from '../ui/components.js';
import { auditDate, byAuditDateDesc } from '../domain/model.js';
import { guyaneInset, assetURL, LOGO_URL } from '../ui/sheet-chrome.js';
import { mediaURL } from '../core/media.js';
import { TYPE_STYLES, TYPE_ORDER, STATUS_STYLES } from '../ui/map.js';
import { agentPref, setAgentPref } from '../app/settings.js';
import { providerHeaderName } from '../domain/grids.js';
import { ctGrid, siteTypes, primaryType, stationStatus, plannedLabel, typeBadges, siteSearchText } from './station-sheet.js';
import { tourControllers, isAuditController } from '../app/audits.js';
import { NO_NETWORK, groupSitesByNetwork, inNetwork, networkId, siteNetworkCodes, sortNetworkCodes } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkOf } from '../app/networks.js';

const YEAR = () => new Date().getFullYear();
const STATUS_ORDER = { en_cours: 0, a_controler: 1, controlee: 2 };
/** Rangements proposés : par réseau (d'office) ou par statut (grille historique). */
const RANGEMENTS = ['reseau', 'statut'];
const stationsText = n => `${n} station${n > 1 ? 's' : ''}`;
const shownText = n => `${n} station${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''}`;
/** Adresse d'un écran avec les paramètres non vides (« #/carte?type=ce&reseau=EL »). */
const withQuery = (path, params) => { const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v)); return path + (String(p) ? '?' + p : ''); };

/** Données de l'accueil, calculées en un passage sur les tournées et les prestations. */
function collect() {
  const year = YEAR(), idx = currentNetworkIndex();
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
    return { site, types: siteTypes(site), networks: siteNetworkCodes(site, idx), status: stationStatus(site.id, { year, audits }), audits, prestations, text: siteSearchText(site) };
  });
}

function compPictos(site, grid) {
  const comps = (grid.compartments || []).filter(c => !c.always && (site.compartments || []).includes(c.key));
  return comps.length ? html`<span class="hm-comps" aria-label="Compartiments à contrôler">${comps.map(c => html`<span class="hm-comp" title="${c.label}">${icon(c.icon || 'check', { size: 18, title: c.label })}</span>`)}</span>` : '';
}

/**
 * Réseaux d'une carte : en rangement par réseau, les AUTRES réseaux de la station (« Aussi : Chimie » : la station
 * figure aussi dans cette section) ; en rangement par statut, tous ses réseaux.
 */
function networkLine(x, net) {
  const others = x.networks.filter(c => c !== net);
  if (!others.length) return '';
  const list = networkBadges(others.map(currentNetworkOf));
  return net ? html`<span class="hm-netline hm-also"><span class="hm-also-k">Aussi&nbsp;:</span> ${list}</span>`
    : html`<span class="hm-netline"><span class="sr">Réseaux de surveillance :</span>${list}</span>`;
}

function stationCard(x, grid, { net = '' } = {}) {
  const { site, status, prestations, audits } = x;
  const t = TYPE_STYLES[primaryType(site)] || TYPE_STYLES.ce;
  const rd = site.photos?.RD;
  const visual = rd?.mediaId ? html`<span class="hm-thumb" data-hm-media="${rd.mediaId}" data-fallback="${rd.src ? assetURL(rd.src) : ''}"></span>`
    : rd?.src ? html`<span class="hm-thumb" style="background-image:url(&quot;${assetURL(rd.src)}&quot;)"></span>`
    : html`<span class="hm-inset">${guyaneInset(site, { size: 50 })}</span>`;
  const next = prestations[0];
  const last = audits[0];
  const place = [site.bassin, site.commune, site.riverName && site.riverName !== site.bassin ? site.riverName : ''].filter(Boolean).join(' · ');
  return html`<a class="hm-card th-${t.theme} is-${status.key}" href="#/station/${encodeURIComponent(site.id)}" data-site="${site.id}" data-search="${x.text}">
    <span class="hm-top"><span class="hm-badges">${typeBadges(site, { short: true })}</span><span class="hm-code">${site.code}</span></span>
    <span class="hm-main">
      <span class="hm-txt"><span class="hm-k">${site.codeType === 'BSS' ? 'Point d’eau' : 'Station'}</span><span class="hm-name">${site.name}</span>
        <span class="hm-place">${place || site.kind || '—'}</span></span>
      ${visual}
    </span>
    ${networkLine(x, net)}
    ${compPictos(site, grid)}
    <span class="hm-foot">
      <span class="badge ${status.cls}">${status.key === 'en_cours' ? icon('route', { size: 14 }) : status.key === 'controlee' ? icon('check', { size: 14 }) : ''}${status.label}</span>
      ${next ? html`<span class="hm-next${next.plannedDate ? '' : ' is-unplanned'}" title="${next.ref}">${icon('calendar', { size: 14 })}${providerHeaderName(store.get('provider', next.providerId)) || ''} · ${plannedLabel(next)}</span>` : ''}
      ${last && status.key !== 'en_cours' ? html`<span class="hm-last">Dernière tournée : ${last.number} (${fmtDate(auditDate(last))})</span>` : ''}
    </span>
  </a>`;
}

/** Section d'un réseau (rangement par réseau) : titre h2 (pastille, code, libellé, effectif), description, cartes. */
function networkSection(g, grid) {
  const n = g.network, none = g.code === NO_NETWORK, items = g.sites.map(s => s.x);
  const id = 'hmSec-' + networkId(g.code);
  return html`<section class="hm-sec" data-net="${g.code}" aria-labelledby="${id}" style="${networkVars(n)}">
    <h2 class="hm-sec-h" id="${id}">${networkDot(n)}<span class="hm-sec-code">${none ? 'Sans réseau' : n.code}</span>${!none && n.label && n.label !== n.code ? html`<span class="hm-sec-label">${n.label}</span>` : ''}<span class="hm-sec-n" data-n>${stationsText(items.length)}</span></h2>
    ${n.description && !n.virtual ? html`<p class="hm-sec-d">${n.description}</p>` : ''}
    <div class="hm-grid">${items.map(x => stationCard(x, grid, { net: g.code }))}</div>
  </section>`;
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
    const idx = currentNetworkIndex();
    // Type de tournée, réseau et rangement : paramètre de l'adresse, sinon préférence de l'agent connecté.
    const remembered = agentPref('home.type', '');
    const type = q.type !== undefined ? (TYPE_STYLES[q.type] ? q.type : '') : (TYPE_STYLES[remembered] ? remembered : '');
    const byType = all.filter(x => !type || x.types.includes(type));
    const netCount = code => byType.filter(x => inNetwork(x.networks, code)).length;
    const knownNet = code => code === NO_NETWORK || idx.has(code) || all.some(x => x.networks.includes(code));
    const rememberedNet = agentPref('home.reseau', '');
    // Réseau mémorisé sans station du type choisi : ignoré (la liste ne serait jamais vide « par surprise »).
    const reseau = q.reseau !== undefined ? (knownNet(q.reseau) ? q.reseau : '') : (knownNet(rememberedNet) && netCount(rememberedNet) ? rememberedNet : '');
    const rememberedSort = agentPref('home.ranger', 'reseau');
    const ranger = RANGEMENTS.includes(q.ranger) ? q.ranger : RANGEMENTS.includes(rememberedSort) ? rememberedSort : 'reseau';
    const nets = sortNetworkCodes([...new Set(byType.flatMap(x => x.networks)), ...(reseau && reseau !== NO_NETWORK ? [reseau] : [])], idx);
    if (byType.some(x => !x.networks.length) || reseau === NO_NETWORK) nets.push(NO_NETWORK);
    const byNet = byType.filter(x => !reseau || inNetwork(x.networks, reseau));
    const bassins = sortBy([...new Set(byNet.map(x => x.site.bassin).filter(Boolean))], b => b);
    const byBassin = byNet.filter(x => !q.bassin || x.site.bassin === q.bassin);
    const statusCount = k => byBassin.filter(x => x.status.key === k).length;
    const list = sortBy(byBassin.filter(x => !q.statut || x.status.key === q.statut), x => STATUS_ORDER[x.status.key], x => (x.prestations.length ? 0 : 1), x => x.site.name);
    // Rangement par réseau : une section par réseau (une station sur deux réseaux dans chacune), ordre du référentiel.
    const groups = ranger === 'reseau' ? groupSitesByNetwork(list.map(x => ({ id: x.site.id, networks: x.networks, x })), idx).groups.filter(g => !reseau || g.code === reseau) : null;
    const tours = openTours();
    const text = normalize(q.q || '');
    const shown = list.filter(x => !text || x.text.includes(text)).length;   // stations distinctes
    const filtered = !!(type || reseau || q.bassin || q.statut || q.q);
    const netChip = code => {
      const n = code === NO_NETWORK ? null : currentNetworkOf(code), on = reseau === code;
      return html`<button class="chip hm-net${on ? ' sel' : ''}" data-act="reseau" data-v="${code}" aria-pressed="${String(on)}" style="${n ? networkVars(n) : ''}" title="${n ? (n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code) : 'Stations sans réseau de surveillance'}">${n ? networkDot(n) : html`<span class="net-dot" aria-hidden="true"></span>`}${n ? n.code : 'Sans réseau'}<span class="count">${netCount(code)}</span></button>`;
    };
    return html`
      <section class="hm-hero">
        <img class="hm-logo" src="${LOGO_URL}" alt="" width="64" height="64">
        <div class="hm-hero-txt"><h1>Stations</h1><p>${grid.name || 'Contrôle terrain des prestations de prélèvement'} · ${all.length} station${all.length > 1 ? 's' : ''} au référentiel${nets.filter(c => c !== NO_NETWORK).length && !type ? ` · ${nets.filter(c => c !== NO_NETWORK).length} réseaux de surveillance` : ''}</p></div>
        <div class="hm-hero-actions">
          ${can('audit.create') ? html`<a class="btn primary lg" href="${withQuery('#/nouvel-audit', { type, reseau })}"><span class="ic">${icon('plus')}</span>Nouvelle tournée</a>` : ''}
          <a class="btn ghost" href="${withQuery('#/carte', { type, reseau })}"><span class="ic">${icon('map')}</span>Carte<span class="hm-opt"> des stations</span></a>
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
          <button class="chip ${!type ? 'sel' : ''}" data-act="type" data-v="" aria-pressed="${String(!type)}">${icon('station')}Toutes<span class="count">${all.length}</span></button>
          ${TYPE_ORDER.map(k => html`<button class="chip hm-chip-${k} ${type === k ? 'sel' : ''}" data-act="type" data-v="${k}" aria-pressed="${String(type === k)}">${icon(TYPE_STYLES[k].icon)}${TYPE_STYLES[k].label}<span class="count">${all.filter(x => x.types.includes(k)).length}</span></button>`)}
        </div>
        ${nets.length ? html`<div class="chips is-wrap hm-nets" role="group" aria-label="Réseau de surveillance">
          <span class="hm-nets-k" aria-hidden="true">Réseau</span>
          <button class="chip hm-net-all ${!reseau ? 'sel' : ''}" data-act="reseau" data-v="" aria-pressed="${String(!reseau)}">${icon('grid')}Tous<span class="count">${byType.length}</span></button>
          ${nets.filter(c => c === reseau || netCount(c)).map(netChip)}
        </div>` : ''}
        <div class="hm-row">
          <label class="hm-search"><span class="sr">Rechercher une station</span>${icon('search', { size: 20 })}<input type="search" value="${q.q || ''}" placeholder="Rechercher : nom, code, bassin, commune, réseau…" data-input="search" autocomplete="off"></label>
          <label class="hm-bassin"><span class="sr">Bassin versant</span><select data-change="bassin">${options(bassins, q.bassin || '', { placeholder: 'Tous les bassins' })}</select></label>
        </div>
        <div class="chips hm-status" role="group" aria-label="Statut de contrôle">
          <button class="chip ${!q.statut ? 'sel' : ''}" data-act="statut" data-v="" aria-pressed="${String(!q.statut)}">Tous statuts<span class="count">${byBassin.length}</span></button>
          ${Object.entries(STATUS_STYLES).map(([k, s]) => html`<button class="chip hm-st-${k} ${q.statut === k ? 'sel' : ''}" data-act="statut" data-v="${k}" aria-pressed="${String(q.statut === k)}"><i class="hm-dot"></i>${k === 'controlee' ? `Contrôlée en ${YEAR()}` : s.label}<span class="count">${statusCount(k)}</span></button>`)}
        </div>
      </section>
      <div class="hm-countbar">
        <p class="hm-count" id="hmCount" aria-live="polite">${shownText(shown)}</p>
        ${filtered && list.length ? html`<button class="btn ghost sm hm-reset" data-act="reset">Effacer les filtres</button>` : ''}
        <div class="chips is-wrap hm-sort" role="group" aria-label="Ranger les stations"><span class="hm-sort-k" aria-hidden="true">Ranger&nbsp;:</span>
          ${[['reseau', 'Par réseau'], ['statut', 'Par statut']].map(([k, l]) => html`<button class="chip ${ranger === k ? 'sel' : ''}" data-act="ranger" data-v="${k}" aria-pressed="${String(ranger === k)}">${l}</button>`)}
        </div>
      </div>
      ${list.length ? html`${groups ? html`<div class="hm-secs" id="hmGrid">${groups.map(g => networkSection(g, grid))}</div>` : html`<div class="hm-grid" id="hmGrid">${list.map(x => stationCard(x, grid))}</div>`}
        <div class="card hide" id="hmNone">${empty(icon('search', { size: 44 }), 'Aucune station ne correspond à la recherche.')}</div>`
        : html`<div class="card">${empty(icon('station', { size: 44 }), all.length ? 'Aucune station pour ces filtres.' : `Aucune station sur cette tablette : installez le référentiel (Administration › Données et stockage) ou ${isTeamMode() ? 'synchronisez' : 'recevez le fichier de l’autre tablette (« Recevoir un fichier »)'}.`, all.length ? html`<button class="btn ghost" data-act="reset">Effacer les filtres</button>` : '')}</div>`}`;
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
      const v = el.dataset.v || '';
      setAgentPref('home.type', v);
      const q = { ...this.query, type: v };
      delete q.statut; delete q.bassin;
      // Réseau choisi sans aucune station de ce type : retiré (liste jamais vide « par surprise »).
      const r = q.reseau ?? agentPref('home.reseau', '');
      if (r && v && !store.all('site').some(s => siteTypes(s).includes(v) && inNetwork(s, r))) { delete q.reseau; setAgentPref('home.reseau', ''); }
      navigate('/?' + new URLSearchParams(q), { replace: true });
    },
    reseau(el) {
      const v = el.dataset.v || '';
      setAgentPref('home.reseau', v);
      const q = { ...this.query, reseau: v };
      delete q.statut; delete q.bassin;
      if (!v) delete q.reseau;
      navigate('/?' + new URLSearchParams(q), { replace: true });
    },
    ranger(el) {
      setAgentPref('home.ranger', el.dataset.v);
      navigate('/?' + new URLSearchParams({ ...this.query, ranger: el.dataset.v }), { replace: true });
    },
    statut(el) { const q = { ...this.query, statut: el.dataset.v }; if (!q.statut) delete q.statut; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    bassin(el) { const q = { ...this.query, bassin: el.value }; if (!q.bassin) delete q.bassin; navigate('/?' + new URLSearchParams(q), { replace: true }); },
    reset() {
      // Tous les filtres, réseau compris (préférences de l'agent effacées) ; le rangement est conservé.
      setAgentPref('home.type', ''); setAgentPref('home.reseau', '');
      navigate('/?' + new URLSearchParams({ type: '', reseau: '', ...(this.query.ranger ? { ranger: this.query.ranger } : {}) }), { replace: true });
    },
    search(el) {
      filterCards(document.getElementById('view') || document, el.value);
      // Recherche mémorisée dans l'adresse sans réafficher l'écran (le champ garde le focus).
      const q = { ...this.query, q: el.value };
      if (!q.q) delete q.q;
      // Champ vidé : paramètre retiré (sinon « q=undefined » dans l'adresse des filtres suivants).
      if (q.q) this.query.q = q.q; else delete this.query.q;
      history.replaceState(null, '', '#/?' + new URLSearchParams(q));
    }
  }
};

/**
 * Filtrage instantané des cartes (sans réaffichage) : total en stations DISTINCTES (une station sur deux réseaux a
 * une carte dans chaque section), sections sans carte visible masquées, effectif de chaque section mis à jour.
 */
function filterCards(root, value) {
  const t = normalize(value);
  const ids = new Set();
  for (const card of root.querySelectorAll('.hm-card')) {
    const ok = !t || card.dataset.search.includes(t);
    card.hidden = !ok;
    if (ok) ids.add(card.dataset.site);
  }
  for (const sec of root.querySelectorAll('.hm-sec')) {
    const k = sec.querySelectorAll('.hm-card:not([hidden])').length;
    sec.hidden = !k;
    const c = sec.querySelector('[data-n]');
    if (c) c.textContent = stationsText(k);
  }
  const n = ids.size;
  const c = root.querySelector('#hmCount');
  if (c) c.textContent = shownText(n);
  root.querySelector('#hmNone')?.classList.toggle('hide', n > 0 || !root.querySelector('.hm-card'));
}
