/* Création d'une tournée de contrôle terrain (#/nouvel-audit) — grille CT-2026 (avenant n° 1, § F) :
 * type de tournée (hydrobiologie, cours d'eau, eaux souterraines), prestataire contrôlé (Titulaire du
 * marché – lot 1, OEG en régie, HYDRECO, NBC en premier, puis les autres), date, audit inopiné ou avec
 * rendez-vous, contrôleurs OEG de la tournée (binôme : agents connus autorisés à auditer, agent connecté coché et
 * obligatoire), stations dans l'ordre de passage (recherche, filtre par type, prestations programmées du
 * prestataire mises en avant, ordre modifiable, station la plus proche par GPS, filtre par réseau de surveillance
 * avec effectifs, réseaux de chaque station ; PÉRIMÈTRE contrôlé d'une station sur plusieurs réseaux : cases
 * « Biologie », « Chimie » proposées selon ses réseaux et ses prestations programmées — même prestataire ⇒ une tournée
 * mixte aux opérations communes mutualisées, autre prestataire ⇒ tournée distincte), compartiments (biologie :
 * pré-cochés selon les stations ; physico-chimie imposée par la chimie) et préleveurs du prestataire (« Ajouter un
 * opérateur » : nom, prénom, initiales, fonction, sans doublon) → createAudit → #/audit/<id>.
 * Pré-sélection : ?site=<siteId>, ?prestation=<id>, ?prestations=<id1,id2>, ?type=bio|ce|eso, ?kind=inopine,
 * ?reseau=<code> (filtre des stations candidates : seulement par l'adresse, jamais par une préférence mémorisée).
 * Option avancée : audit sur une grille historique (un seul site), ?mode=general — formulaire d'origine. */
import { html, sortBy, localDate, addDays, haversine, fmtDistance, fmtDate, normalize } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, ROLES, knownUsers } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, formValues } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageTitle, options, field, operatorName, empty, networkBadges, networkDot, networkVars } from '../ui/components.js';
import { PROVIDER_KINDS } from '../domain/model.js';
import { gridType, gridTypes, inferAuditType, auditCompartments, typeCompartments, providerHeaderName, isSheetGrid, tourTypes, tourCompartments, partsText } from '../domain/grids.js';
import { agentInitials } from '../domain/permissions.js';
import { createAudit, gridsFor, tourAgents } from '../app/audits.js';
import { providerOperators, canAddOperator, operatorDisplay } from '../app/operators.js';
import { openOperatorForm } from './audit-modules.js';
import { getPosition } from '../ui/gps.js';
import { agentPref } from '../app/settings.js';
import { NO_NETWORK, inNetwork, prestationNetwork, sortNetworkCodes } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkOf, siteNetworks } from '../app/networks.js';
import { TYPE_STYLES } from '../ui/map.js';
import { ctGrid, CT_GRID, siteTypes, openPrestations, prestationType, plannedLabel, siteMatches, typeBadges, possibleParts, partChoices, defaultParts, partPrestationIds, perimeterChecks } from './station-sheet.js';

/* ---------- Brouillon de la tournée (conservé entre deux affichages) ---------- */
let draft = null;
let legacy = {};
const FEATURED = ['prov-TL1', 'prov-OEG', 'prov-HYDRECO', 'prov-NBC'];
const MAX_CANDIDATES = 40;

const featuredIds = grid => (Array.isArray(grid.providers) && grid.providers.length ? grid.providers : FEATURED);
/** Prestation programmée ouverte d'une station pour le prestataire et le type de tournée (la plus proche). */
const matchPrestation = (siteId, providerId, type) => providerId ? openPrestations(siteId, { providerId, type })[0] || null : null;

function initDraft(q) {
  const grid = ctGrid();
  const pres = [q.prestation, ...String(q.prestations || '').split(',')].filter(Boolean).map(id => store.get('prestation', id)).filter(Boolean);
  const site = q.site ? store.get('site', q.site) : null;
  const typeOk = k => !!gridType(grid, k);
  let type = typeOk(q.type) ? q.type : pres[0] ? prestationType(pres[0], grid) : site ? inferAuditType(grid, { site, prestation: openPrestations(site.id)[0] || null }) : '';
  if (!typeOk(type)) type = typeOk(agentPref('home.type', '')) ? agentPref('home.type', '') : (gridTypes(grid)[0]?.key || 'bio');
  let providerId = pres[0]?.providerId || '';
  if (!providerId && site) providerId = openPrestations(site.id, { type })[0]?.providerId || '';
  const stations = [];
  for (const p of pres) if (!stations.some(s => s.siteId === p.siteId)) stations.push({ siteId: p.siteId, prestationId: p.id });
  if (site && !stations.some(s => s.siteId === site.id)) stations.unshift({ siteId: site.id, prestationId: matchPrestation(site.id, providerId, type)?.id || null });
  return {
    key: JSON.stringify(q), type, providerId, date: localDate(), kind: q.kind === 'inopine' || !pres.length ? 'inopine' : 'planifie',
    stations, compartments: null, operatorIds: [...new Set(pres.flatMap(p => p.operatorIds || []))], search: '',
    // Filtre des stations candidates par réseau : seulement ?reseau= (jamais une préférence : toutes les stations du type).
    network: knownNetwork(q.reseau) ? q.reseau : '',
    controllerIds: [session.user?.id].filter(Boolean), userId: session.user?.id || null
  };
}

/* ---------- Périmètre contrôlé à chaque station (tournée mixte) ---------- */
/** Parties contrôlées à une station du brouillon : choix de l'agent (`parts`), sinon parties par défaut (defaultParts). */
const draftParts = (d, s) => s.parts || defaultParts(store.get('site', s.siteId), { providerId: d.providerId, type: d.type });
/** Types de la tournée en préparation : réunion des parties de ses stations (type choisi seul tant qu'il n'y en a pas). */
const draftTypes = (grid, d) => tourTypes(grid, d.stations.map(s => ({ parts: draftParts(d, s) })), d.type);

/** Compartiments proposés : biologie → ceux des stations choisies (cases modifiables) ; autres types → ceux du type ;
 * tournée mixte : type par type (la chimie impose la physico-chimie, commune aux deux). */
function defaultCompartments(grid, d) {
  const t = gridType(grid, d.type);
  if (!t) return typeCompartments(grid, d.type);
  const types = draftTypes(grid, d);
  if (types.length > 1) {
    return tourCompartments(grid, types, Object.fromEntries(types.map(k => {
      const fromSites = [...new Set(d.stations.filter(s => draftParts(d, s).includes(k)).flatMap(s => store.get('site', s.siteId)?.compartments || []))];
      return [k, fromSites.length ? fromSites : null];
    })));
  }
  const fromSites = [...new Set(d.stations.flatMap(s => store.get('site', s.siteId)?.compartments || []))].filter(k => t.compartments.includes(k));
  return auditCompartments(grid, d.type, fromSites.length ? fromSites : null);
}
const chosenCompartments = (grid, d) => {
  const types = draftTypes(grid, d);
  return d.compartments ? (types.length > 1 ? tourCompartments(grid, types, d.compartments) : d.compartments) : defaultCompartments(grid, d);
};

/** Prestataires : les quatre prestataires des contrôles 2026 en premier, puis les autres (actifs). */
function providerLists(grid) {
  const active = store.filter('provider', p => p.active !== false);
  const featured = featuredIds(grid).map(id => store.get('provider', id)).filter(Boolean);
  const others = sortBy(active.filter(p => !featured.some(f => f.id === p.id)), 'kind', 'name');
  return { featured, others };
}

/* ---------- Choix des stations ---------- */
/** Code de réseau reconnu (référentiel, code porté par une station, ou « aucun » : stations sans réseau). */
function knownNetwork(code) {
  if (!code) return false;
  return code === NO_NETWORK || currentNetworkIndex().has(code) || store.all('site').some(s => (s.networks || []).includes(code));
}
/** Réseaux des stations du type de tournée (filtre des candidates) : [{code, n, count}], réseau choisi toujours présent. */
function networkChoices(d) {
  const sites = store.filter('site', s => siteTypes(s).includes(d.type));
  const codes = sortNetworkCodes([...new Set(sites.flatMap(s => s.networks || [])), ...(d.network && d.network !== NO_NETWORK ? [d.network] : [])], currentNetworkIndex());
  if (sites.some(s => !(s.networks || []).length) || d.network === NO_NETWORK) codes.push(NO_NETWORK);
  return { total: sites.length, list: codes.map(code => ({ code, n: code === NO_NETWORK ? null : currentNetworkOf(code), count: sites.filter(s => inNetwork(s, code)).length })) };
}
function networkFilterHTML(d) {
  const { total, list } = networkChoices(d);
  if (list.length < 2 && !d.network) return '';
  const chip = (code, label, count, n = null) => html`<button type="button" class="chip${d.network === code ? ' sel' : ''}" data-act="setNet" data-v="${code}" aria-pressed="${String(d.network === code)}" style="${n ? networkVars(n) : ''}">${code ? (n ? networkDot(n) : html`<span class="net-dot" aria-hidden="true"></span>`) : icon('grid')}${label}<span class="count">${count}</span></button>`;
  return html`<div class="chips is-wrap an-nets" role="group" aria-label="Réseau de surveillance des stations proposées">${chip('', 'Tous réseaux', total)}${list.map(x => chip(x.code, x.n ? x.n.code : 'Sans réseau', x.count, x.n))}</div>`;
}

function candidateRow(site, p, d) {
  const nets = siteNetworks(site);
  return html`<div class="an-cand${p ? ' is-planned' : ''}">
    <div class="an-cand-main"><span class="an-cand-name">${site.name}</span>
      <span class="an-cand-sub">${site.code}${site.bassin ? ' · ' + site.bassin : site.commune ? ' · ' + site.commune : ''}</span>
      ${nets.length ? html`<span class="an-cand-nets net-badges">${networkBadges(nets)}</span>` : ''}
      ${p ? html`<span class="an-cand-pres${p.plannedDate ? '' : ' is-unplanned'}">${icon('calendar', { size: 14 })}${p.ref} · ${plannedLabel(p)}</span>` : ''}</div>
    <button type="button" class="btn ${p ? 'primary' : 'ghost'} sm" data-act="addSt" data-site="${site.id}" data-pres="${p?.id || ''}">${icon('plus', { size: 18 })}Ajouter</button>
  </div>`;
}
function candidatesHTML(d) {
  const grid = ctGrid();
  const taken = new Set(d.stations.map(s => s.siteId));
  const t = normalize(d.search);
  // Filtre par réseau : stations du réseau ; prestations de son programme (réseau de la campagne) ou sans programme connu.
  const idx = currentNetworkIndex();
  const inNet = s => !d.network || inNetwork(s, d.network);
  const presNet = p => { const c = prestationNetwork(p, p.campaignId ? store.get('campaign', p.campaignId) : null, idx); return !d.network || !c || c === d.network; };
  const planned = d.providerId ? sortBy(store.filter('prestation', p => p.providerId === d.providerId && ['prevue', 'reportee'].includes(p.status) && prestationType(p, grid) === d.type && !taken.has(p.siteId) && presNet(p)), p => p.plannedDate || '9999', 'ref') : [];
  const plannedBySite = new Map();
  for (const p of planned) { const s = store.get('site', p.siteId); if (s && inNet(s) && !plannedBySite.has(s.id) && openPrestations(s.id, { providerId: d.providerId, type: d.type }).some(x => x.id === p.id) && siteMatches(s, t)) plannedBySite.set(s.id, p); }
  const others = sortBy(store.filter('site', s => !taken.has(s.id) && !plannedBySite.has(s.id) && siteTypes(s).includes(d.type) && inNet(s) && siteMatches(s, t)), 'name');
  const prov = store.get('provider', d.providerId);
  const net = d.network ? (d.network === NO_NETWORK ? 'sans réseau' : d.network) : '';
  return html`
    ${networkFilterHTML(d)}
    ${plannedBySite.size ? html`<h4 class="an-h4">${icon('calendar', { size: 18 })}Prestations programmées · ${providerHeaderName(prov)}<span class="badge info">${plannedBySite.size}</span></h4>
      <div class="an-cands">${[...plannedBySite].slice(0, MAX_CANDIDATES).map(([id, p]) => candidateRow(store.get('site', id), p, d))}</div>` : ''}
    <h4 class="an-h4">${icon(TYPE_STYLES[d.type]?.icon || 'station', { size: 18 })}${plannedBySite.size ? 'Autres stations' : 'Stations'} · ${TYPE_STYLES[d.type]?.label || ''}${net ? ` · réseau ${net}` : ''}<span class="badge outline">${others.length}</span></h4>
    ${!others.length ? html`<p class="note">${t ? 'Aucune station ne correspond à la recherche.' : d.network ? 'Aucune autre station de ce type dans ce réseau.' : 'Toutes les stations de ce type sont déjà dans la tournée.'}</p>`
      // Prestations programmées mises en avant : les autres stations restent repliées tant qu'aucune recherche n'est saisie.
      : plannedBySite.size && !t && !d.showAll ? html`<button type="button" class="btn ghost sm" data-act="showAll">${icon('list', { size: 18 })}Afficher les ${others.length} autres stations</button>`
      : html`<div class="an-cands">${others.slice(0, MAX_CANDIDATES).map(s => candidateRow(s, null, d))}</div>
        ${others.length > MAX_CANDIDATES ? html`<p class="note">${MAX_CANDIDATES} premières stations affichées : précisez la recherche.</p>` : ''}`}`;
}

function selectedHTML(d) {
  if (!d.stations.length) return html`<div class="an-empty">${icon('route', { size: 30 })}<span>Aucune station : ajoutez la ou les stations visitées, dans l’ordre de passage.</span></div>`;
  const grid = ctGrid();
  let several = false;
  const list = html`<ol class="an-sel">${d.stations.map((s, i) => {
    const site = store.get('site', s.siteId);
    const p = s.prestationId ? store.get('prestation', s.prestationId) : null;
    // Station sur plusieurs réseaux (ex. BIO + Chimie) : ce qui y est RÉELLEMENT contrôlé (cases, prestations de chaque partie).
    const multi = site && possibleParts(site, grid).length > 1;
    if (multi) several = true;
    return html`<li class="an-sel-row${multi ? ' has-parts' : ''}" data-site="${s.siteId}">
      <span class="an-sel-no">${i + 1}</span>
      <span class="an-sel-main"><span class="an-sel-name">${site?.name || s.siteId}</span>
        <span class="an-sel-sub">${site?.code || ''}${site ? html` ${typeBadges(site, { short: true })}${networkBadges(siteNetworks(site))}` : ''}</span>
        ${multi ? html`<span class="an-sel-parts"><span class="an-parts-k">Contrôlé à cette station :</span>${perimeterChecks(partChoices(site, { grid, providerId: d.providerId, type: d.type, parts: draftParts(d, s) }), { act: 'setPart', attrs: `data-i="${i}"` })}</span>`
          : html`<span class="an-sel-pres">${p ? html`${icon('calendar', { size: 14 })}Prestation ${p.ref} · ${plannedLabel(p)}` : 'Hors programme (aucune prestation programmée rattachée)'}</span>`}</span>
      <span class="an-sel-tools">
        <button type="button" class="icon-btn" data-act="moveSt" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Monter" aria-label="Monter ${site?.name || ''}">▲</button>
        <button type="button" class="icon-btn" data-act="moveSt" data-i="${i}" data-d="1" ${i === d.stations.length - 1 ? 'disabled' : ''} title="Descendre" aria-label="Descendre ${site?.name || ''}">▼</button>
        <button type="button" class="icon-btn an-del" data-act="removeSt" data-i="${i}" title="Retirer" aria-label="Retirer ${site?.name || ''} de la tournée">${icon('close', { size: 20 })}</button>
      </span></li>`;
  })}</ol>`;
  return html`${list}${several ? html`<p class="note an-parts-note">${icon('info', { size: 16 })} Station sur plusieurs réseaux : cochez ce qui y est <b>réellement contrôlé</b>. Même prestataire : une seule tournée, les opérations communes (organisation, accès et station, mesures in situ, prélèvement, conservation et transport) sont saisies une seule fois. Partie réalisée par un autre prestataire : tournée distincte.</p>` : ''}`;
}

// Agents de cette tablette (trousseau) : relus à chaque affichage de l'écran de création.
let tabletIds = new Set();
/**
 * Contrôleurs OEG de la tournée : agents connus autorisés à auditer (ceux de cette tablette d'abord, les autres
 * signalés « autre tablette ») ; l'agent connecté est coché et obligatoire.
 */
function controllersHTML(d) {
  const me = session.user?.id;
  const agents = [...tourAgents()].sort((a, b) => (tabletIds.has(a.id) ? 0 : 1) - (tabletIds.has(b.id) ? 0 : 1));
  const ids = new Set([me, ...(d.controllerIds || [])]);
  return html`<div class="checks an-ctrls">${agents.map(u => {
      const on = ids.has(u.id), mine = u.id === me;
      return html`<label class="check ${on ? 'sel' : ''}"><input type="checkbox" value="${u.id}" data-change="setCtrl" ${on ? 'checked' : ''} ${mine ? 'disabled' : ''}><span class="an-ctrl-av">${agentInitials(u)}</span><span class="an-ctrl-txt"><b>${u.name}</b><small>${mine ? 'vous' : `${ROLES[u.role] || u.role}${tabletIds.size && !tabletIds.has(u.id) ? ' · autre tablette' : ''}`}</small></span></label>`;
    })}</div>
    <p class="note">${agents.length > 1 ? 'Cochez le ou les collègues qui contrôlent avec vous : chacun pourra saisir dans la tournée en se connectant sur la tablette (« Changer d’agent »), et chaque saisie reste attribuée à son auteur.' : html`Vous êtes le seul agent connu sur cette tablette. Les collègues s’ajoutent dans <a href="#/administration">Administration › Agents de cette tablette</a> ; ils pourront aussi « Rejoindre la tournée » plus tard.`}</p>`;
}

/* ---------- Écran de création de tournée ---------- */
function tourForm(q) {
  const grid = ctGrid();
  // Brouillon propre à l'agent connecté (tablette partagée : « Changer d'agent » repart d'un brouillon neuf).
  if (!draft || draft.key !== JSON.stringify(q) || draft.userId !== session.user?.id) draft = initDraft(q);
  const d = draft;
  const types = gridTypes(grid);
  const { featured, others } = providerLists(grid);
  const prov = store.get('provider', d.providerId);
  const comps = chosenCompartments(grid, d);
  const typeDef = gridType(grid, d.type);
  // Types de la tournée (mixte : biologie + chimie…) ; compartiment imposé par un type qui n'en a qu'un (chimie : physico).
  const types = draftTypes(grid, d), mixed = types.length > 1;
  const typeDefs = types.map(k => gridType(grid, k)).filter(Boolean);
  const forced = key => mixed && typeDefs.some(t => t.compartments.length === 1 && t.compartments[0] === key);
  const ops = d.providerId ? providerOperators(d.providerId, { include: d.operatorIds || [] }) : [];
  const step = (n, title, sub = '') => html`<h2 class="an-step"><span class="an-step-no">${n}</span><span>${title}${sub ? html`<small>${sub}</small>` : ''}</span></h2>`;
  return html`
    ${pageTitle('Nouvelle tournée', 'Contrôle terrain d’un prestataire de prélèvement : une journée, une ou plusieurs stations', html`<a class="btn ghost sm" href="#/nouvel-audit?mode=general">${icon('clipboard', { size: 18 })}Grille historique</a>`, '#/')}
    <form class="an-form" id="anForm" data-submit="start" novalidate>
      <section class="card">${step(1, 'Type de tournée')}
        <div class="an-types" role="radiogroup" aria-label="Type de tournée">${types.map(t => {
          const st = TYPE_STYLES[t.key] || {};
          return html`<button type="button" class="an-type t-${t.key}${d.type === t.key ? ' sel' : ''}" role="radio" aria-checked="${d.type === t.key}" data-act="setType" data-v="${t.key}">
            <span class="an-type-ic">${icon(st.icon || t.icon || 'drop', { size: 30 })}</span><span class="an-type-txt"><b>${st.label || t.short || t.label}</b><small>${t.program}</small></span></button>`;
        })}</div></section>

      <section class="card">${step(2, 'Prestataire contrôlé')}
        <div class="an-provs" role="radiogroup" aria-label="Prestataire">${featured.map(p => html`<button type="button" class="an-prov${d.providerId === p.id ? ' sel' : ''}" role="radio" aria-checked="${d.providerId === p.id}" data-act="setProvider" data-v="${p.id}">
          <span class="an-prov-ic">${icon(p.kind === 'regie' ? 'home' : 'building', { size: 22 })}</span><span><b>${providerHeaderName(p)}</b><small>${PROVIDER_KINDS[p.kind] || ''}</small></span></button>`)}</div>
        ${others.length ? field('Autre prestataire, partenaire ou régie', html`<select data-change="setProviderSel">${options(others, featured.some(f => f.id === d.providerId) ? '' : d.providerId, { placeholder: '— autre —' })}</select>`) : ''}</section>

      <section class="card">${step(3, 'Date et modalité')}
        <div class="an-row">
          ${field('Date de la tournée', html`<input type="date" name="date" value="${d.date}" data-change="setDate" required>`, { required: true })}
          <div class="field"><label>Type d’audit</label><div class="seg">
            <button type="button" class="${d.kind === 'inopine' ? 'sel brand' : ''}" data-act="setKind" data-v="inopine" aria-pressed="${d.kind === 'inopine'}"><span class="k">${icon('warning', { size: 18 })}</span>Inopiné</button>
            <button type="button" class="${d.kind === 'planifie' ? 'sel brand' : ''}" data-act="setKind" data-v="planifie" aria-pressed="${d.kind === 'planifie'}"><span class="k">${icon('calendar', { size: 18 })}</span>Avec rendez-vous</button></div></div>
        </div></section>

      <section class="card">${step(4, 'Contrôleurs OEG de la tournée', 'binôme ou équipe de l’OEG')}
        ${controllersHTML(d)}</section>

      <section class="card">${step(5, 'Stations de la tournée', 'dans l’ordre de passage')}
        ${selectedHTML(d)}
        <div class="an-add">
          <div class="an-add-bar">
            <label class="an-search">${icon('search', { size: 20 })}<span class="sr">Rechercher une station</span><input type="search" value="${d.search}" placeholder="Rechercher une station : nom, code, bassin, commune…" data-input="anSearch" autocomplete="off"></label>
            <button type="button" class="btn ghost" data-act="nearest"><span class="ic">${icon('pin')}</span>Station la plus proche</button>
          </div>
          <div id="anNearest" class="hint"></div>
          <div id="anCands">${candidatesHTML(d)}</div>
        </div></section>

      <section class="card">${step(6, 'Compartiments à contrôler')}
        ${typeDefs.some(t => t.compartments.length > 1)
          ? html`<div class="checks an-comps">${(grid.compartments || []).filter(c => c.always || typeDefs.some(t => t.compartments.includes(c.key))).map(c => html`<label class="check ${comps.includes(c.key) ? 'sel' : ''}"><input type="checkbox" value="${c.key}" data-change="setComp" ${comps.includes(c.key) ? 'checked' : ''} ${c.always || forced(c.key) ? 'disabled' : ''}> ${icon(c.icon || 'check', { size: 20 })} ${c.label}</label>`)}</div>
            <p class="note">Pré-cochés selon les compartiments des stations choisies ; l’organisation, la sécurité et la traçabilité sont toujours contrôlées.${mixed ? ' La physico-chimie (mesures in situ, prélèvement, conservation et transport) est commune à la biologie et à la chimie : contrôlée une seule fois par station.' : ''}</p>`
          : html`<ul class="an-fixed">${(grid.compartments || []).filter(c => comps.includes(c.key)).map(c => html`<li>${icon(c.icon || 'check', { size: 20 })}${c.label}</li>`)}</ul>`}</section>

      <section class="card" id="anOperators">${step(7, 'Préleveurs du prestataire', 'opérateurs contrôlés')}
        ${!d.providerId ? html`<p class="note">Choisissez d’abord le prestataire.</p>`
          : html`${ops.length ? html`<div class="checks an-ops">${ops.map(o => { const on = (d.operatorIds || []).includes(o.id); return html`<label class="check ${on ? 'sel' : ''}"><input type="checkbox" value="${o.id}" data-change="setOps" ${on ? 'checked' : ''}><span class="as-op-ini">${o.code || '?'}</span><span class="as-op-txt"><b>${operatorDisplay(o)}</b>${o.function ? html`<small>${o.function}</small>` : ''}</span></label>`; })}</div>`
              : html`<p class="note">Aucun opérateur enregistré pour ce prestataire.</p>`}
            ${canAddOperator() ? html`<button type="button" class="btn ghost" data-act="op-new" id="opNewCreate"><span class="ic">${icon('plus')}</span>Ajouter un opérateur</button>` : ''}
            <p class="note">Cochez les préleveurs présents. Un préleveur absent de la liste : « Ajouter un opérateur » (nom, prénom, initiales, fonction) — rattaché à ${providerHeaderName(prov)}, sans doublon. La liste reste modifiable dans la tournée (feuille Organisation).</p>`}</section>

      <div class="an-submit">
        <div class="an-recap">${typeDef ? html`<span class="type-badge t-${d.type}">${icon(TYPE_STYLES[d.type]?.icon || 'drop', { size: 15 })}${TYPE_STYLES[d.type]?.label || typeDef.label}</span>` : ''}${mixed ? types.filter(k => k !== d.type).map(k => html`<span class="type-badge t-${k}">${icon(TYPE_STYLES[k]?.icon || 'drop', { size: 15 })}+ ${TYPE_STYLES[k]?.label || k}</span>`) : ''}
          <span><b>${prov ? providerHeaderName(prov) : 'Prestataire à choisir'}</b> · ${d.stations.length} station${d.stations.length > 1 ? 's' : ''} · ${fmtDate(d.date)} · ${d.kind === 'inopine' ? 'inopiné' : 'avec rendez-vous'}${(d.controllerIds || []).length > 1 ? ` · ${d.controllerIds.length} contrôleurs` : ''}${mixed ? html` · <span class="an-recap-mixed">tournée ${partsText(grid, types).toLocaleLowerCase('fr-FR')}</span>` : ''}</span></div>
        <button class="btn primary lg" type="submit" ${d.providerId && d.stations.length ? '' : 'disabled'}><span class="ic">${icon('route')}</span>Démarrer la tournée</button>
      </div>
    </form>`;
}

/* ---------- Formulaire historique : audit sur une grille générale (un seul site) ---------- */
function legacyForm(q) {
  if (q.prestation && legacy.prestationId !== q.prestation) {
    const p = store.get('prestation', q.prestation);
    if (p) legacy = { prestationId: p.id, providerId: p.providerId, siteId: p.siteId, pointId: p.pointIds?.[0], samplingTypeId: p.samplingTypeId, matrixId: p.matrixId, operatorIds: p.operatorIds || [] };
  }
  const providers = sortBy(store.filter('provider', p => p.active !== false), 'kind', 'name');
  const sites = sortBy(store.all('site'), 'name');
  const points = store.filter('point', p => p.siteId === legacy.siteId);
  const today = localDate();
  const prestations = sortBy(store.filter('prestation', p => (!legacy.providerId || p.providerId === legacy.providerId) && (!legacy.siteId || p.siteId === legacy.siteId) && p.plannedDate >= addDays(today, -31) && p.plannedDate <= addDays(today, 31)), 'plannedDate');
  const grids = gridsFor({ providerId: legacy.providerId, samplingTypeId: legacy.samplingTypeId, matrixId: legacy.matrixId }).filter(g => !isSheetGrid(g));
  const ops = sortBy(store.filter('operator', o => o.providerId === legacy.providerId && o.active !== false), 'code');
  return html`
    ${pageTitle('Audit sur grille historique', 'Contrôle d’un seul site avec une grille générale (hors fiches de contrôle 2026)', '', '#/nouvel-audit')}
    <div class="banner info">Pour les contrôles terrain 2026 (hydrobiologie, cours d’eau, eaux souterraines), utilisez plutôt <a href="#/nouvel-audit">la création de tournée</a>.</div>
    <form class="card" data-submit="lg-start" id="newAuditForm">
      <h2>1 · Prestataire contrôlé</h2>
      ${field('Prestataire, partenaire ou régie', html`<select name="providerId" data-change="lg-set" required>${providers.length ? Object.entries(PROVIDER_KINDS).map(([k, label]) => html`<optgroup label="${label}">${options(providers.filter(p => p.kind === k), legacy.providerId, { placeholder: null })}</optgroup>`) : ''}<option value="" ${!legacy.providerId ? 'selected' : ''}>— sélectionner —</option></select>`, { required: true })}
      <h2 style="margin-top:14px">2 · Site et point</h2>
      <div class="btn-row" style="margin-bottom:10px"><button type="button" class="btn ghost" data-act="lg-nearest"><span class="ic">${icon('pin')}</span>Site le plus proche (GPS)</button></div>
      <div id="nearestInfo" class="hint"></div>
      ${field('Site', html`<select name="siteId" data-change="lg-set" required>${options(sites, legacy.siteId, { label: s => `${s.name} (${s.code})${s.networks?.length ? ' — ' + s.networks.join(', ') : ''}` })}</select>`, { required: true })}
      ${points.length ? field('Point de prélèvement', html`<select name="pointId" data-change="lg-set">${options(points, legacy.pointId, { label: p => `${p.code} — ${p.name}`, placeholder: null })}</select>`) : ''}
      <h2 style="margin-top:14px">3 · Prestation observée</h2>
      ${field('Prestation programmée correspondante (facultatif)', html`<select name="prestationId" data-change="lg-set">${options(prestations, legacy.prestationId, { label: p => `${fmtDate(p.plannedDate)} — ${p.ref}`, placeholder: 'Aucune — prestation non programmée' })}</select>`, { hint: 'Prestations de ce prestataire sur ce site à ± 1 mois.' })}
      <div class="grid2">
        ${field('Type de prélèvement observé', html`<select name="samplingTypeId" data-change="lg-set">${options(store.all('samplingType'), legacy.samplingTypeId)}</select>`)}
        ${field('Matrice', html`<select name="matrixId" data-change="lg-set">${options(store.all('matrix'), legacy.matrixId)}</select>`)}
      </div>
      ${ops.length ? field('Opérateur(s) présent(s)', html`<div class="checks">${ops.map(o => html`<label class="check ${(legacy.operatorIds || []).includes(o.id) ? 'sel' : ''}"><input type="checkbox" name="operatorIds" data-multi value="${o.id}" data-change="lg-set" ${(legacy.operatorIds || []).includes(o.id) ? 'checked' : ''}> ${operatorName(o)}</label>`)}</div>`, { hint: 'D’autres opérateurs pourront être ajoutés dans l’audit.' }) : ''}
      <h2 style="margin-top:14px">4 · Grille d’audit</h2>
      ${grids.length ? html`<div class="list">${grids.map((g, i) => html`<label class="li" style="cursor:pointer"><input type="radio" name="gridId" value="${g.id}" ${(legacy.gridId ? legacy.gridId === g.id : i === 0) ? 'checked' : ''} data-change="lg-set"><div class="li-main"><div class="li-title">${g.name}</div><div class="li-sub">${g.code} v${g.version} — ${g.description || ''}</div></div></label>`)}</div>` : html`<div class="banner warn">Aucune grille historique publiée n’est applicable.</div>`}
      <button class="btn primary lg block" type="submit" style="margin-top:16px" ${grids.length ? '' : 'disabled'}><span class="ic">${icon('check')}</span>Démarrer immédiatement le contrôle</button>
    </form>`;
}

export default {
  nav: 'planning', title: 'Nouvelle tournée',
  async render(params, q) {
    if (!can('audit.create')) return html`<div class="card">${empty(icon('lock', { size: 44 }), 'Votre profil ne permet pas de créer une tournée de contrôle.')}</div>`;
    if (q.mode === 'general') return legacyForm(q);
    if (!gridTypes(ctGrid()).length) return html`<div class="card">${empty(icon('warning', { size: 44 }), 'La grille CT-2026 n’est pas installée sur cet appareil.', html`<a class="btn ghost" href="#/nouvel-audit?mode=general">Audit sur grille historique</a>`)}</div>`;
    tabletIds = new Set((await knownUsers().catch(() => [])).map(u => u.userId));
    return tourForm(q);
  },
  handlers: {
    setType(el) {
      if (draft.type === el.dataset.v) return;
      const kept = draft.stations.filter(s => siteTypes(store.get('site', s.siteId)).includes(el.dataset.v));
      if (kept.length < draft.stations.length) toast(`${draft.stations.length - kept.length} station(s) retirée(s) : elles ne relèvent pas de ce type de tournée.`, 'warn', 4000);
      draft.type = el.dataset.v;
      draft.stations = kept.map(s => ({ siteId: s.siteId, prestationId: matchPrestation(s.siteId, draft.providerId, draft.type)?.id || null }));
      draft.compartments = null;
      // Réseau sans station de ce type : filtre retiré.
      if (draft.network && !store.all('site').some(s => siteTypes(s).includes(draft.type) && inNetwork(s, draft.network))) draft.network = '';
      this.refresh();
    },
    setNet(el) {
      draft.network = el.dataset.v || '';
      draft.showAll = draft.showAll || !!draft.network;
      const box = document.getElementById('anCands');
      if (!box) return;
      box.innerHTML = String(candidatesHTML(draft));
      // Focus rendu au filtre choisi (la liste est réaffichée sans quitter l'écran ; la recherche est conservée).
      box.querySelector(`[data-act=setNet][data-v="${CSS.escape(draft.network)}"]`)?.focus();
    },
    setProvider(el) { selectProvider(el.dataset.v); this.refresh(); },
    setProviderSel(el) { if (el.value) { selectProvider(el.value); this.refresh(); } },
    setDate(el) { draft.date = el.value || localDate(); this.refresh(); },
    setKind(el) { draft.kind = el.dataset.v; this.refresh(); },
    setComp() {
      draft.compartments = [...document.querySelectorAll('.an-comps input')].filter(i => i.checked || i.disabled).map(i => i.value);
      this.refresh();
    },
    /** Case « Biologie » / « Chimie » d'une station : parties réellement contrôlées (au moins une). */
    setPart(el) {
      const s = draft.stations[Number(el.dataset.i)];
      if (!s) return;
      const grid = ctGrid();
      const parts = [...el.closest('.pm-checks').querySelectorAll('input')].filter(x => x.checked).map(x => x.value);
      if (!parts.length) { el.checked = true; return; }
      const before = draftTypes(grid, draft).join();
      s.parts = parts;
      // Types de la tournée changés (biologie ajoutée ou retirée…) : compartiments recalculés d'après les stations.
      if (draftTypes(grid, draft).join() !== before) draft.compartments = null;
      this.refresh();
    },
    setOps() { draft.operatorIds = [...document.querySelectorAll('[data-change=setOps]')].filter(i => i.checked).map(i => i.value); this.refresh(); },
    /** « Ajouter un opérateur » : rattaché au prestataire choisi, sans doublon, coché aussitôt. */
    async 'op-new'() {
      const op = await openOperatorForm(draft.providerId, { context: 'création de tournée' });
      if (!op) return;
      draft.operatorIds = [...new Set([...(draft.operatorIds || []), op.id])];
      this.refresh();
    },
    setCtrl() {
      const me = session.user?.id;
      draft.controllerIds = [me, ...[...document.querySelectorAll('[data-change=setCtrl]')].filter(i => i.checked && i.value !== me).map(i => i.value)].filter(Boolean);
      this.refresh();
    },
    showAll() { draft.showAll = true; const box = document.getElementById('anCands'); if (box) box.innerHTML = String(candidatesHTML(draft)); },
    anSearch(el) { draft.search = el.value; const box = document.getElementById('anCands'); if (box) box.innerHTML = String(candidatesHTML(draft)); },
    addSt(el) {
      const siteId = el.dataset.site;
      if (draft.stations.some(s => s.siteId === siteId)) return;
      draft.stations.push({ siteId, prestationId: el.dataset.pres || matchPrestation(siteId, draft.providerId, draft.type)?.id || null });
      if (!draft.providerId && el.dataset.pres) selectProvider(store.get('prestation', el.dataset.pres)?.providerId || '');
      draft.search = '';
      this.refresh();
    },
    removeSt(el) { draft.stations.splice(Number(el.dataset.i), 1); this.refresh(); },
    moveSt(el) {
      const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
      if (j < 0 || j >= draft.stations.length) return;
      [draft.stations[i], draft.stations[j]] = [draft.stations[j], draft.stations[i]];
      this.refresh();
    },
    async nearest() {
      const info = document.getElementById('anNearest');
      info.textContent = 'Recherche de la position GPS…';
      try {
        const pos = await getPosition({ timeout: 20000 });
        const taken = new Set(draft.stations.map(s => s.siteId));
        const best = store.filter('site', s => isFinite(s.lat) && s.lat !== null && !taken.has(s.id) && siteTypes(s).includes(draft.type))
          .map(s => ({ s, d: haversine(pos.lat, pos.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
        if (!best) { info.textContent = 'Aucune station géolocalisée de ce type.'; return; }
        draft.stations.push({ siteId: best.s.id, prestationId: matchPrestation(best.s.id, draft.providerId, draft.type)?.id || null });
        toast(`Station la plus proche ajoutée : ${best.s.name} (${fmtDistance(best.d)})`, 'ok');
        this.refresh();
      } catch (e) { info.textContent = e.message; }
    },
    async start() {
      const d = draft;
      if (!d.providerId) { toast('Choisissez le prestataire contrôlé.', 'err'); return; }
      if (!d.stations.length) { toast('Ajoutez au moins une station à la tournée.', 'err'); return; }
      const grid = ctGrid();
      const a = await createAudit({
        auditType: d.type, gridId: grid.id || CT_GRID, providerId: d.providerId, kind: d.kind,
        // Périmètre contrôlé : parties de chaque station (tournée mixte) et prestation programmée de chaque partie.
        stations: d.stations.map(s => stationRequest(grid, d, s)),
        compartments: chosenCompartments(grid, d), operatorIds: d.operatorIds || [],
        // Contrôleurs OEG de la tournée (binôme) : l'agent connecté et les collègues cochés.
        controllerIds: d.controllerIds || [],
        // Date de la tournée enregistrée sur l'audit (audit.date) : dates pré-remplies, listes, alertes et PDF.
        date: d.date || localDate()
      });
      draft = null;
      toast(`Tournée ${a.number} créée (${d.stations.length} station${d.stations.length > 1 ? 's' : ''})`, 'ok');
      navigate('/audit/' + a.id);
    },
    /* Formulaire historique */
    'lg-set'(el) {
      const form = el.form || document.getElementById('newAuditForm');
      const v = formValues(form);
      const siteChanged = v.siteId !== legacy.siteId;
      legacy = { ...legacy, ...v };
      if (siteChanged) { legacy.pointId = store.find('point', p => p.siteId === v.siteId)?.id; const s = store.get('site', v.siteId); if (s?.matrixId && !legacy.matrixId) legacy.matrixId = s.matrixId; }
      if (el.name === 'prestationId' && v.prestationId) { const p = store.get('prestation', v.prestationId); Object.assign(legacy, { samplingTypeId: p.samplingTypeId || legacy.samplingTypeId, matrixId: p.matrixId || legacy.matrixId, operatorIds: p.operatorIds?.length ? p.operatorIds : legacy.operatorIds }); }
      if (el.name !== 'gridId') this.refresh();
    },
    async 'lg-nearest'() {
      const info = document.getElementById('nearestInfo');
      info.textContent = 'Recherche de la position GPS…';
      try {
        const pos = await getPosition({ timeout: 20000 });
        const pts = store.filter('point', p => isFinite(p.lat) && isFinite(p.lon) && p.lat !== null).map(p => ({ p, d: haversine(pos.lat, pos.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d);
        if (!pts.length) { info.textContent = 'Aucun point géolocalisé dans le référentiel.'; return; }
        legacy = { ...legacy, siteId: pts[0].p.siteId, pointId: pts[0].p.id };
        toast(`Site le plus proche : ${store.get('site', pts[0].p.siteId)?.name} (${fmtDistance(pts[0].d)})`, 'ok');
        this.refresh();
      } catch (e) { info.textContent = e.message; }
    },
    async 'lg-start'(form) {
      const v = formValues(form);
      if (!v.providerId || !v.siteId || !v.gridId) { toast('Prestataire, site et grille sont obligatoires.', 'err'); return; }
      const a = await createAudit({ prestationId: v.prestationId || null, gridId: v.gridId, kind: 'inopine', providerId: v.providerId, siteId: v.siteId, pointId: v.pointId || null, operatorIds: v.operatorIds || [], samplingTypeId: v.samplingTypeId || null, matrixId: v.matrixId || null });
      legacy = {};
      toast(`Audit inopiné ${a.number} démarré`, 'ok');
      navigate('/audit/' + a.id);
    }
  }
};

/**
 * Station demandée à createAudit : {siteId, prestationId} ; périmètre différent du type de la tournée (station
 * contrôlée pour plusieurs parties, ou pour une autre partie) : + parts et partPrestations (prestations programmées du
 * prestataire pour chaque partie cochée).
 */
function stationRequest(grid, d, s) {
  const parts = draftParts(d, s);
  if (parts.length === 1 && parts[0] === d.type) return { siteId: s.siteId, prestationId: s.prestationId || null };
  const site = store.get('site', s.siteId);
  const pp = partPrestationIds(site, parts, { grid, providerId: d.providerId });
  const p = s.prestationId ? store.get('prestation', s.prestationId) : null;
  const t = p ? prestationType(p, grid) : '';
  if (p && parts.includes(t)) pp[t] = p.id;
  return { siteId: s.siteId, prestationId: pp[d.type] || parts.map(k => pp[k]).find(Boolean) || null, parts, partPrestations: pp };
}

/** Changement de prestataire : prestations rattachées aux stations et opérateurs recalculés (parties choisies gardées). */
function selectProvider(id) {
  if (!id || draft.providerId === id) return;
  draft.providerId = id;
  draft.stations = draft.stations.map(s => ({ ...s, siteId: s.siteId, prestationId: matchPrestation(s.siteId, id, draft.type)?.id || null }));
  const ops = new Set(store.filter('operator', o => o.providerId === id).map(o => o.id));
  const fromPres = draft.stations.flatMap(s => store.get('prestation', s.prestationId)?.operatorIds || []);
  draft.operatorIds = [...new Set([...(draft.operatorIds || []).filter(x => ops.has(x)), ...fromPres])];
}
