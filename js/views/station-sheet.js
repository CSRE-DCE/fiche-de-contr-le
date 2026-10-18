/* Fiche station (feuille 1 des fiches de contrôle terrain), fidèle aux maquettes
 * docs/maquettes/feuille-1-station.webp et sa variante : en-tête OEG, bandeau « Station / NOM » (photo RD en
 * fond ; réseaux de surveillance de la station sur une ligne à part), bandeau d'information (Code SANDRE ou Code BSS), « Localisation cartographique » (carte Leaflet : étoile
 * de la station, points de prélèvement du site et relevés GPS de la tournée pour cette station, légende, échelle,
 * nord, encart Guyane ; repli hors connexion), « Photographies de la station » (RD / RG / AM / AV), « Accès /
 * Localisation », « Difficultés / points d’attention », « Compartiments à contrôler », point d'eau souterraine
 * (Code BSS, commune, libellé, nature, usage, aquifère), « Repères terrain », source des photos, pied de page.
 *
 * Utilisée par la page #/station/:id (js/views/station.js) et par l'audit (feuille 1 de chaque station) :
 *   html  : stationSheet({ site, grid, audit, editable, reperes, variant })
 *   mount : mountStationSheet(root, { site, audit })  — carte et photos chiffrées (asynchrone) ;
 *           unmountStationSheet()                      — libère les cartes (à appeler au démontage de la vue) ;
 *   actions : stationHandlers (clés préfixées « st- ») à fusionner dans les handlers de la vue.
 * Exporte aussi les aides « station » partagées par les écrans (types de tournée, statut de contrôle, tournées
 * de la station, prestations ouvertes, grille CT-2026). */
import { html, raw, fmtDate, normalize, sortBy, haversine, fmtDistance } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { saveMedia, mediaURL } from '../core/media.js';
import { toast } from '../ui/dom.js';
import { mediaInputs } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { oegHeader, stationBanner, infoStrip, sectionCard, blockCard, checkSquare, guyaneInset, sheetFooter, sheetFrame, dotLines, assetURL, siteLatLon } from '../ui/sheet-chrome.js';
import { createMap, tilesUsable, watchTiles, kindIcon, kindSVG, SAMPLING_KINDS, TYPE_STYLES, TYPE_ORDER, STATUS_STYLES } from '../ui/map.js';
import { GRID_CT_2026 } from '../domain/grid-ct-2026.js';
import { upToDateGrid } from '../domain/default-grids.js';
import { auditTypesOf } from '../domain/networks.js';
import { currentNetworkIndex, siteNetworks } from '../app/networks.js';
import { headerOf, resolveSheet, sheetOf, gridType, gridTypes, defaultAuditType, typeCompartments, normalizeCompartments, allItems, itemIndex, evalCondition, parseItemId, stationKeyOf, providerHeaderName } from '../domain/grids.js';
import { itemInput, auditDate, byAuditDateDesc } from '../domain/model.js';
import { effectiveGrid, auditTypeOf } from '../app/audits.js';
import { utmToLatLon, latLonToUtm } from '../lib/geo.js';
import { originText } from '../domain/coords.js';

export const CT_GRID = 'grid-ct-2026-v1';
/** Créneaux photographiques fixes de la fiche station. */
export const SLOTS = [['RD', 'Rive droite'], ['RG', 'Rive gauche'], ['AM', 'Amont'], ['AV', 'Aval']];
const SLOT_LONG = Object.fromEntries(SLOTS);

/* ---------- Aides « station » partagées (accueil, fiche, carte, création de tournée) ---------- */
/** Grille CT-2026 publiée sur l'appareil, lue d'après la version livrée avec l'application si elle n'est pas encore
 * mise à niveau (turbidité en NTU…) ; à défaut : la grille de référence embarquée. */
export function ctGrid() { return upToDateGrid(store.get('grid', CT_GRID)) || GRID_CT_2026; }

/**
 * Types de tournée d'une station (bio, ce, eso), dans l'ordre d'affichage ; déduits si le site n'est pas encore enrichi :
 * listes biologiques et types associés à ses réseaux (référentiel « Réseaux », repli sur les réseaux par défaut), plus
 * eaux souterraines pour un code BSS ou une matrice ESO.
 */
export function siteTypes(site) {
  if (!site) return [];
  let t = Array.isArray(site.types) && site.types.length ? site.types : [];
  if (!t.length) {
    t = auditTypesOf(site, currentNetworkIndex());
    if (site.codeType === 'BSS' || site.matrixId === 'mat-ESO') t = [...t, 'eso'];
  }
  return TYPE_ORDER.filter(k => t.includes(k));
}
/** Type principal d'une station (couleur, variante de fiche par défaut). */
export const primaryType = site => siteTypes(site)[0] || (site?.codeType === 'BSS' ? 'eso' : 'ce');

/** Tournées (audits non abandonnés) dont la station fait partie, la plus récente d'abord. */
export function stationAudits(siteId) {
  return store.filter('audit', a => a.status !== 'abandonne' && ((a.stations || []).some(s => s.siteId === siteId) || (!(a.stations || []).length && a.siteId === siteId))).sort(byAuditDateDesc);
}
const auditYear = a => Number(auditDate(a).slice(0, 4)) || null;
/**
 * Statut de contrôle d'une station (déduit des tournées qui la contiennent) :
 * {key: 'en_cours' | 'controlee' | 'a_controler', label, audit, cls}. « Contrôlée » = tournée signée l'année donnée.
 */
export function stationStatus(siteId, { year = new Date().getFullYear(), audits = null } = {}) {
  const list = audits || stationAudits(siteId);
  const open = list.find(a => !a.lock?.lockedAt && ['en_cours', 'termine'].includes(a.status));
  if (open) return { key: 'en_cours', label: `Tournée en cours · ${open.number}`, audit: open, cls: STATUS_STYLES.en_cours.cls };
  const done = list.find(a => a.lock?.lockedAt && auditYear(a) === year);
  if (done) return { key: 'controlee', label: `Contrôlée en ${year}`, audit: done, cls: STATUS_STYLES.controlee.cls, date: done.lock.lockedAt };
  return { key: 'a_controler', label: 'À contrôler', audit: null, cls: STATUS_STYLES.a_controler.cls };
}
/** Une tournée (non abandonnée) contient-elle déjà cette prestation ? (signée = prestation contrôlée) */
export function prestationAudits(prestationId) {
  return store.filter('audit', a => a.status !== 'abandonne' && ((a.prestationIds || []).includes(prestationId) || a.prestationId === prestationId));
}
/** Prestations programmées non clôturées d'une station (date croissante, « à planifier » en dernier). */
export function openPrestations(siteId, { providerId = null, type = '' } = {}) {
  const grid = ctGrid();
  return sortBy(store.filter('prestation', p => p.siteId === siteId && ['prevue', 'reportee'].includes(p.status) && (!providerId || p.providerId === providerId)
    && (!type || prestationType(p, grid) === type) && !prestationAudits(p.id).some(a => a.lock?.lockedAt)), p => p.plannedDate || '9999', 'ref');
}
/** Type de tournée d'une prestation programmée (prestation.auditType, sinon déduit). */
export function prestationType(p, grid = ctGrid()) {
  if (p?.auditType) return p.auditType;
  if (p?.samplingTypeId === 'stype-HYDROBIO' || p?.source?.kind === 'programme-bio-2026') return 'bio';
  if (p?.matrixId === 'mat-ESO' || p?.samplingTypeId === 'stype-ESO') return 'eso';
  return gridTypes(grid).some(t => t.key === 'ce') ? 'ce' : '';
}
/** Libellé de date d'une prestation : « 01/09/2026 », « 01/09/2026 (indicative) » ou « À planifier ». */
export function plannedLabel(p) {
  if (!p?.plannedDate) return 'À planifier';
  return fmtDate(p.plannedDate) + (p.dateIndicative ? ' (indicative)' : '');
}
/** Texte de recherche d'une station (normalisé) : nom, code, bassin, commune, cours d'eau, masse d'eau, nature,
 * aquifère, réseaux de surveillance (codes et libellés : « chimie », « RCO », « eaux littorales »). */
export function siteSearchText(site) {
  const s = site || {};
  return normalize([s.name, s.code, s.bassin, s.commune, s.riverName, s.masseEau, s.nature, s.aquifere, ...siteNetworks(s).flatMap(n => [n.code, n.label])].filter(Boolean).join(' '));
}
/** Recherche plein texte d'une station (nom, code, bassin, commune, cours d'eau, réseaux). */
export function siteMatches(site, query) {
  const t = normalize(query);
  if (!t) return true;
  return siteSearchText(site).includes(t);
}

/* ---------- Composition de la feuille ---------- */
/** Espaces insécables dans les durées et distances (« 1 h 30 », « 2 km ») : pas de coupure de ligne au milieu. */
const nbsp = t => String(t || '').replace(/(\d)\s+(?=(?:h|min|km|m)\b)/g, '$1\u00a0').replace(/(\u00a0h)\s+(?=\d)/g, '$1\u00a0');
const lines = text => nbsp(text).split(/\n+/).map(s => s.trim()).filter(Boolean);
/** Phrases sur des lignes distinctes (comme la maquette « Accès / Localisation »). */
const sentences = text => lines(text).flatMap(l => l.replace(/([.!?])\s+(?=[A-ZÀ-ÖØ-Ý«])/g, '$1\n').split('\n'));
/** Liste courte « Roches, Saut Tourépé. » → une ligne par élément (maquette « Difficultés »). */
const listLines = text => {
  const ls = lines(text);
  if (ls.length > 1 || String(text).length > 90) return ls;
  return String(text || '').replace(/,\s+/g, ',\n').split('\n').map(s => s.trim()).filter(Boolean);
};
const fmtXY = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : String(Math.round(Number(v))));
const fmtLL = v => (isFinite(v) && v !== null ? Number(v).toFixed(5).replace('.', ',') : '—');

function accessIcon(site) {
  const m = normalize([...(site.access?.modes || []), ...(site.transportModes || [])].join(' '));
  if (/bateau|pirogue/.test(m)) return 'boat';
  if (/4x4|voiture|vehicule|route/.test(m)) return 'car';
  if (/pied|marche/.test(m)) return 'person';
  return 'route';
}
/** Position (WGS84) d'une valeur de relevé GPS {lat, lon} ou {x, y} (RGFG95 / UTM 22N). */
function valueLatLon(v) {
  if (!v || typeof v !== 'object') return null;
  if (isFinite(v.lat) && isFinite(v.lon) && v.lat !== null && v.lon !== null && v.lat !== '' && v.lon !== '') return [Number(v.lat), Number(v.lon)];
  if (isFinite(v.x) && isFinite(v.y) && v.x !== null && v.y !== null && v.x !== '' && v.y !== '') {
    const x = Number(v.x), y = Number(v.y);
    if (x < 100000 || x > 900000 || y < 100000 || y > 1000000) return null;
    try { return utmToLatLon(x, y, 22); } catch (e) { return null; }
  }
  return null;
}
/** Feuille d'un critère GPS → type de point de la légende. */
const kindOfSheet = no => ({ 6: 'invertebres', 7: 'diatomees', 8: 'ichtyofaune' }[Number(no)] || 'prelevement');

/**
 * Points à placer sur la carte d'une station : points de prélèvement du site (site.samplingPoints) et relevés GPS
 * de la tournée POUR CETTE STATION (critères à relevé GPS dont l'identifiant effectif porte « @<clé> »).
 * → [{kind, lat, lon, label, source: 'site' | 'audit'}]
 */
export function stationMapPoints(site, audit = null) {
  const out = [];
  for (const p of site?.samplingPoints || []) {
    const ll = valueLatLon(p);
    if (ll) out.push({ kind: SAMPLING_KINDS[p.kind] ? p.kind : 'prelevement', lat: ll[0], lon: ll[1], label: p.label || SAMPLING_KINDS[p.kind]?.label || 'Point de prélèvement', source: 'site' });
  }
  if (audit && site) {
    const key = stationKeyOf(site.id);
    let grid = null;
    try { grid = effectiveGrid(audit); } catch (e) { grid = null; }
    for (const it of grid ? allItems(grid) : []) {
      if (!itemInput(it)?.gps || parseItemId(it.id).stationKey !== key) continue;
      const ll = valueLatLon(audit.responses?.[it.id]?.value);
      if (ll) out.push({ kind: kindOfSheet(it.sheet), lat: ll[0], lon: ll[1], label: `${it.baseCode || it.code || ''} – ${it.label}`, source: 'audit' });
    }
  }
  return out;
}

/** Prestataire de l'en-tête hors tournée : celui de la prochaine prestation programmée du type (ex. HYDRECO pour la biologie). */
function plannedProvider(site, type) {
  const p = openPrestations(site.id, { type })[0];
  return p ? store.get('provider', p.providerId) : null;
}

function mapCard(site, audit, { bio = true } = {}) {
  const ll = siteLatLon(site);
  const pts = stationMapPoints(site, audit);
  const xy = isFinite(site.x) && isFinite(site.y) && site.x !== null && site.x !== '' ? { x: site.x, y: site.y } : (ll ? (() => { const [x, y] = latLonToUtm(ll[0], ll[1], 22); return { x, y }; })() : null);
  const near = ll ? pts.map(p => ({ ...p, d: haversine(ll[0], ll[1], p.lat, p.lon) })) : [];
  const legend = html`<div class="ss-map-legend" aria-label="Légende">
    <span>${raw(kindSVG('station', 16))}Station&nbsp;: <b>${String(site.name || '').toLocaleUpperCase('fr-FR')}</b></span>
    ${['prelevement', 'invertebres', 'diatomees', 'ichtyofaune'].filter(k => bio || k === 'prelevement' || pts.some(p => p.kind === k)).map(k => html`<span class="${pts.some(p => p.kind === k) ? 'has' : ''}">${raw(kindSVG(k, 14))}${SAMPLING_KINDS[k].label}</span>`)}
  </div>`;
  const body = html`<div class="ss-map-frame"><div class="ss-map st-map${ll ? '' : ' is-offline no-coords'}" data-site="${site.id}" data-points="${JSON.stringify(pts)}">
    <div class="ss-map-canvas" role="img" aria-label="Carte de localisation de la station ${site.name || ''}"></div>
    <div class="ss-map-fallback">
      ${guyaneInset(site, { size: 132 })}
      <div class="ss-map-fb">
        <b>${ll ? 'Fond de carte indisponible hors connexion' : 'Coordonnées de la station à renseigner'}</b>
        ${xy ? html`<span class="ss-fb-k">RGFG95 / UTM 22N</span><span class="ss-fb-v"><span>X&nbsp;: ${fmtXY(xy.x)}</span> <span>Y&nbsp;: ${fmtXY(xy.y)}</span></span>` : ''}
        ${xy && originText(site) ? html`<span class="ss-fb-k ss-fb-origin">${originText(site)}</span>` : ''}
        ${ll ? html`<span class="ss-fb-k">WGS84</span><span class="ss-fb-v">${fmtLL(ll[0])}° · ${fmtLL(ll[1])}°</span>` : ''}
        ${near.length ? html`<ul>${near.map(p => html`<li>${raw(kindSVG(p.kind, 14))}${p.label} — à ${fmtDistance(p.d)} de la station</li>`)}</ul>` : ''}
      </div>
    </div>
    <figure class="ss-map-inset" aria-hidden="true">${guyaneInset(site, { size: 62 })}</figure>
    <span class="ss-map-north" aria-label="Nord">${raw('<svg viewBox="0 0 24 34" width="24" height="34" aria-hidden="true"><path d="M12 1 20 23 12 18 4 23Z" fill="#fff" stroke="#14284b" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 1 12 18 4 23Z" fill="#14284b"/></svg>')}<b>N</b></span>
  </div>${legend}</div>`;
  return sectionCard({ icon: 'map', title: 'Localisation cartographique', cls: 'ss-card ss-map-card', body });
}

function photosCard(site, { editable, audit }) {
  const ph = site.photos || {};
  // Deux choix distincts : « Prendre une photo » (appareil photo de la tablette) et « Importer depuis la galerie »
  // (photo déjà dans l'appareil : date de prise de vue reprise de la photo) — js/ui/components.js, mediaInputs.
  const inputs = (slot, opts) => mediaInputs(null, { auditId: audit?.id || '', act: 'st-photo', data: { site: site.id, slot }, ...opts });
  const tools = slot => html`<div class="ss-photo-tools" role="group" aria-label="Remplacer la photographie ${SLOT_LONG[slot].toLowerCase()}">
    ${inputs(slot, { cls: 'ss-ph-btn', labels: { camera: 'Photo', gallery: 'Galerie' } })}
  </div>`;
  const body = html`<div class="ss-photos">${SLOTS.map(([slot, def]) => {
    const p = ph[slot] || {};
    const cap = p.caption || def;
    const src = p.src ? assetURL(p.src) : '';
    const has = !!(p.mediaId || p.src);
    const alt = `${slot} – ${cap}`;
    return html`<figure class="ss-photo${has ? '' : ' is-empty'}" data-slot="${slot}">
      ${p.mediaId ? html`<button type="button" class="ss-photo-open" data-act="st-photo-view" data-media="${p.mediaId}" aria-label="Agrandir la photographie ${alt}"><img data-st-media="${p.mediaId}" data-fallback="${src}" alt="${alt}"></button>`
        : p.src ? html`<img src="${src}" alt="${alt}">`
        : editable ? html`<div class="ss-photo-ph is-add" role="group" aria-label="Ajouter la photographie ${SLOT_LONG[slot].toLowerCase()}"><span class="ss-ph-k">Photographie ${SLOT_LONG[slot].toLowerCase()}</span><span class="ss-ph-add">${inputs(slot, { cls: 'ss-ph-btn is-big' })}</span></div>`
        : html`<span class="ss-photo-ph">${icon('camera', { size: 38 })}<span>Photographie ${SLOT_LONG[slot].toLowerCase()} non disponible</span></span>`}
      <figcaption><b>${slot}</b> – ${cap}</figcaption>
      ${editable && has ? tools(slot) : ''}
    </figure>`;
  })}</div>`;
  return sectionCard({ icon: 'camera', title: 'Photographies de la station', cls: 'ss-card', body });
}

function accessCard(site) {
  const a = site.access || {};
  const modes = [...new Set([...(a.modes || []), ...(site.transportModes || [])])];
  const has = a.summary || a.details;
  const body = has || modes.length ? html`<div class="ss-iconrow">
      <span class="ss-big-ic">${icon(accessIcon(site), { size: 58 })}</span>
      <div class="ss-text">${sentences(a.summary).map(s => html`<span class="ss-line">${s}</span>`)}${sentences(a.details).map(s => html`<span class="ss-line">${s}</span>`)}
        ${!has ? html`<span class="ss-line ss-muted">Itinéraire d’accès à décrire.</span>` : ''}
        ${modes.length ? html`<span class="ss-modes">${modes.map(m => html`<span class="ss-mode">${m}</span>`)}</span>` : ''}</div>
    </div>` : html`<p class="ss-muted ss-todo">Accès à décrire (itinéraire, durée, moyen de transport).</p>${dotLines(2)}`;
  return blockCard({ icon: 'pin', title: 'Accès / Localisation', cls: 'ss-access', body });
}

function difficultiesCard(site) {
  const items = listLines(site.difficulties);
  const body = items.length ? html`<div class="ss-iconrow"><span class="ss-big-ic is-mountain">${icon('mountain', { size: 64 })}</span><div class="ss-text is-big">${items.map(s => html`<span class="ss-line">${s}</span>`)}</div></div>`
    : html`<p class="ss-muted ss-todo">Aucune difficulté signalée.</p>${dotLines(2)}`;
  return blockCard({ icon: 'warning', title: 'Difficultés / points d’attention', cls: 'ss-diff', body });
}

function compartmentsCard(grid, type, { site, audit }) {
  const all = grid?.compartments || [];
  const keys = gridType(grid, type) ? typeCompartments(grid, type) : all.map(c => c.key);
  const chosen = new Set(audit ? normalizeCompartments(grid, audit.compartments) : (site.compartments || []));
  const year = (String(grid?.code || '').match(/\d{4}/) || [])[0] || String(new Date().getFullYear());
  const body = html`<ul class="ss-comp">${all.filter(c => keys.includes(c.key)).map(c => html`<li class="${chosen.has(c.key) ? 'on' : ''}">
      <span class="ss-comp-ic">${icon(c.icon || 'check', { size: 24 })}</span><span class="ss-comp-l">${c.label}</span>${checkSquare({ checked: chosen.has(c.key), cls: 'lg' })}</li>`)}</ul>`;
  return blockCard({ icon: 'clipboard', title: `Compartiments à contrôler – campagne ${year}`, cls: 'ss-comps', body });
}

function esoCard(site) {
  const rows = [['Code BSS', site.code], ['Commune', site.commune], ['Libellé', site.name], ['Nature', site.nature || site.typePoint], ['Usage', site.usage], ['Aquifère', site.aquifere]];
  return blockCard({ icon: 'well', title: 'Point d’eau souterraine', theme: 'slate', cls: 'ss-eso', body: html`<dl class="ss-kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v || html`<span class="ss-muted">à compléter</span>`}</dd>`)}</dl>` });
}

/** Repères terrain vierges (lignes pointillées) : libellés de la section s-F1-reperes visibles pour le type de tournée. */
function blankReperes(grid, type, provider) {
  const sec = (grid?.sections || []).find(s => s.id === 's-F1-reperes' || (String(s.sheet) === '1' && s.columns === 'value'));
  const index = itemIndex(grid || { sections: [] });
  const ctx = { auditType: type, compartments: typeCompartments(grid, type) };
  const name = providerHeaderName(provider) || 'du prestataire';
  const items = (sec?.items || []).filter(it => evalCondition(it.condition, {}, index, ctx))
    .map(it => ({ ...it, label: it.labelTemplate ? it.labelTemplate.replace('{prestataire}', name) : it.label }));
  const list = items.length ? items : [{ label: 'Date' }, { label: 'Heure' }, { label: 'Contrôleur OEG' }, { label: 'Opérateurs' }, { label: 'Météo' }, { label: 'Niveau d’eau' }, { label: 'Observations', kind: 'longtext' }];
  const short = list.filter(i => i.kind !== 'longtext'), long = list.filter(i => i.kind === 'longtext');
  return html`<div class="ss-rep">
    <div class="ss-rep-rows">${short.map(i => html`<div class="ss-rep-row"><span>${i.label}&nbsp;:</span><i></i></div>`)}</div>
    ${long.map(i => html`<div class="ss-rep-long"><div class="ss-rep-row"><span>${i.label}&nbsp;:</span><i></i></div>${dotLines(3)}</div>`)}
  </div>`;
}

/**
 * HTML de la fiche station (feuille 1).
 * - site : station (entité « site ») ; grid : grille (défaut : celle de l'audit, sinon CT-2026) ;
 * - audit : tournée (en-tête résolu par headerOf : prestataire et programme, rang « Station i / n », compartiments
 *   retenus, relevés GPS de la station sur la carte) ;
 * - editable : ajout / remplacement des photos RD / RG / AM / AV (droit ref.manage requis à l'enregistrement) ;
 * - reperes : HTML des « Repères terrain » rendu par l'écran d'audit (sinon lignes pointillées vierges) ;
 * - variant : 'page' (fiche complète : en-tête OEG et pied de page), 'audit' (idem, dans l'écran d'audit), 'body'
 *   (sans en-tête ni pied de page, sous l'en-tête propre de l'écran) ;
 * - auditType : variante hors tournée ('bio' | 'ce' | 'eso' ; défaut : type principal de la station).
 */
export function stationSheet({ site, grid = null, audit = null, editable = false, reperes = '', variant = 'page', auditType = '' } = {}) {
  if (!site) return html`<div class="card"><p>Station introuvable.</p></div>`;
  const g = grid || audit?.gridSnapshot || ctGrid();
  const known = k => k && (!gridTypes(g).length || gridType(g, k));
  const type = [auditType, audit ? auditTypeOf(audit) : '', primaryType(site)].find(known) || defaultAuditType(g) || '';
  const sheetDef = resolveSheet(sheetOf(g, 1) || { no: 1, title: 'Fiche station de contrôle terrain', theme: 'ocean', layout: 'station' }, type);
  const provider = audit ? store.get('provider', audit.providerId) : plannedProvider(site, type);
  const campaign = audit?.campaignId ? store.get('campaign', audit.campaignId) : null;
  const head = headerOf(g, { provider, auditType: type, campaign });
  const theme = sheetDef.theme || 'ocean';
  const eso = type === 'eso' || String(site.codeType || '').toUpperCase() === 'BSS';
  const key = stationKeyOf(site.id);
  const stations = audit?.stations || [];
  const pos = stations.findIndex(s => s.key === key);
  const rd = site.photos?.RD;
  const bannerPhoto = rd?.src && !rd.mediaId ? assetURL(rd.src) : null;
  const full = variant !== 'body';
  const body = html`
    ${full ? oegHeader({ grid: g, sheet: { ...sheetDef, layout: 'station' }, site, title: head.title, subtitle: head.subtitle }) : ''}
    ${stationBanner({ site, kicker: sheetDef.kicker || head.program || '', theme, photo: bannerPhoto, stationIndex: pos >= 0 ? pos + 1 : null, stationTotal: stations.length || null,
      tagline: eso ? (head.tagline || '') : 'Des rivières vivantes pour demain', networks: siteNetworks(site) })}
    ${infoStrip(site, { codeType: site.codeType || (eso ? 'BSS' : '') })}
    <div class="ss-body">
      <div class="ss-col">
        ${mapCard(site, audit, { bio: type === 'bio' })}
        ${photosCard(site, { editable, audit })}
      </div>
      <div class="ss-col">
        ${eso ? esoCard(site) : ''}
        ${accessCard(site)}
        ${difficultiesCard(site)}
        ${compartmentsCard(g, type, { site, audit })}
      </div>
      <div class="ss-wide">${sectionCard({ icon: 'edit', title: 'Repères terrain', cls: 'ss-card ss-reperes', body: reperes ? (typeof reperes === 'string' ? raw(reperes) : reperes) : blankReperes(g, type, provider) })}</div>
    </div>
    ${site.photoSource ? html`<p class="ss-source">${site.photoSource}</p>` : ''}
    ${full ? sheetFooter({ grid: g }) : ''}`;
  return html`<div class="ss-sheet-wrap" data-st-sheet="${site.id}" data-variant="${variant}">${sheetFrame({ theme, cls: `layout-station is-portrait ss-sheet ss-${variant}${eso ? ' is-eso' : ''}`, body })}</div>`;
}

/* ---------- Montage : carte et photographies chiffrées ---------- */
const live = new Set();   // {map, box, timer} : cartes créées par mountStationSheet
let generation = 0;       // incrémenté au démontage : une carte en cours de création pour une vue quittée est abandonnée
/** Libère les cartes (toutes, ou celles dont la fiche a quitté le document) et annule leurs minuteurs. */
function prune(all = false) {
  for (const x of [...live]) {
    if (all || !x.box.isConnected) { clearTimeout(x.timer); live.delete(x); try { x.map.remove(); } catch (e) { /* déjà libérée */ } }
  }
}

async function initMap(box, site) {
  if (box.dataset.ready) return;
  box.dataset.ready = '1';
  const gen = generation;
  const L = globalThis.L;
  const ll = siteLatLon(site);
  let pts = [];
  try { pts = JSON.parse(box.dataset.points || '[]'); } catch (e) { pts = []; }
  if (!L || !ll) { box.classList.add('is-offline'); return; }
  const tiles = await tilesUsable();
  if (!box.isConnected || gen !== generation) return;
  if (!tiles) { box.classList.add('is-offline'); return; }
  let map;
  try { map = createMap(box.querySelector('.ss-map-canvas'), { center: ll, zoom: 13, interactive: false }); }
  catch (e) { box.classList.add('is-offline'); return; }
  const entry = { map, box, timer: null };
  live.add(entry);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 150 }).addTo(map);
  const name = String(site.name || '').toLocaleUpperCase('fr-FR');
  L.marker(ll, { icon: kindIcon('station', { size: 30, title: `Station ${name}` }), keyboard: false, zIndexOffset: 1000 }).addTo(map)
    .bindTooltip(name, { permanent: true, direction: 'right', offset: [14, 0], className: 'ss-map-label' });
  const bounds = [ll];
  for (const p of pts) {
    L.marker([p.lat, p.lon], { icon: kindIcon(p.kind, { size: 22, title: p.label }), keyboard: false }).addTo(map).bindTooltip(p.label);
    bounds.push([p.lat, p.lon]);
  }
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: false });
  watchTiles(map, { onFail: () => box.classList.add('is-offline'), onLoad: () => box.classList.remove('is-offline') });
  // Recalage de la taille après la mise en page ; jamais sur une carte libérée entre-temps (démontage de la vue : le
  // routeur libère les cartes avant de remplacer le HTML, la fiche est encore dans le document).
  entry.timer = setTimeout(() => { entry.timer = null; if (live.has(entry) && box.isConnected) { try { map.invalidateSize(); } catch (e) { /* carte libérée */ } } }, 200);
}

async function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-st-media]')) {
    if (img.getAttribute('src')) continue;
    const url = await mediaURL(img.dataset.stMedia).catch(() => null);
    if (url) img.src = url;
    else if (img.dataset.fallback) img.src = img.dataset.fallback;
    else img.closest('.ss-photo')?.classList.add('is-missing');
  }
  // Bandeau : photo RD importée dans l'application (média chiffré) en fond.
  for (const wrap of root.querySelectorAll('[data-st-sheet]')) {
    const site = store.get('site', wrap.dataset.stSheet);
    const id = site?.photos?.RD?.mediaId;
    const banner = wrap.querySelector('.station-banner');
    if (!id || !banner || banner.querySelector('.sb-photo')) continue;
    const url = await mediaURL(id).catch(() => null);
    if (!url) continue;
    const ph = document.createElement('div');
    ph.className = 'sb-photo';
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', `Photographie de la station ${site.name}`);
    ph.style.backgroundImage = `url("${url}")`;
    banner.prepend(ph);
    banner.classList.add('has-photo');
  }
}

/**
 * Initialise les fiches station présentes dans `root` : carte Leaflet de chaque « .st-map[data-site] » (étoile de la
 * station, points de prélèvement et relevés GPS de la tournée, échelle ; repli hors connexion : encart Guyane et
 * coordonnées) et photographies chiffrées (médias). Asynchrone ; les cartes des fiches retirées du document sont
 * libérées à chaque appel. site / audit : facultatifs (lus depuis data-site sinon).
 */
export async function mountStationSheet(root, { site = null, audit = null } = {}) {
  prune();
  if (!root) return;
  const boxes = [...root.querySelectorAll('.st-map[data-site]')];
  await Promise.all(boxes.map(box => initMap(box, site?.id === box.dataset.site ? site : store.get('site', box.dataset.site)).catch(e => { console.warn(e); box.classList.add('is-offline'); })));
  await hydratePhotos(root).catch(e => console.warn(e));
}
/** Libère les cartes créées par mountStationSheet (démontage de la vue). */
export function unmountStationSheet() { generation++; prune(true); }

/* ---------- Actions (à fusionner dans les handlers de la vue) ---------- */
export const stationHandlers = {
  /** Ajout / remplacement d'une photographie RD / RG / AM / AV : média chiffré lié {type:'site', id, slot}, fiche station mise à jour (journal). */
  async 'st-photo'(el) {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    if (!can('ref.manage')) throw new Error('Votre profil ne permet pas de modifier la fiche station (droit « référentiels » requis).');
    if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (JPEG, PNG…).');
    const site = store.get('site', el.dataset.site);
    if (!site) throw new Error('Station introuvable.');
    const slot = el.dataset.slot;
    if (!SLOT_LONG[slot]) throw new Error('Emplacement de photo inconnu.');
    toast('Enregistrement de la photographie…', '', 1500);
    // Photo prise (appareil photo) ou importée de la galerie : compression, date de prise de vue (EXIF, sinon date
    // d'import signalée), position (js/ui/capture.js).
    const { preparePhoto, inputSource } = await import('../ui/capture.js');
    const source = inputSource(el);
    const ph = await preparePhoto(file, { source });
    const prev = site.photos?.[slot] || {};
    const caption = prev.caption || SLOT_LONG[slot];
    const m = await saveMedia(ph.bytes, { mime: 'image/jpeg', kind: 'photo', name: file.name, caption: `${slot} – ${caption}`, link: { type: 'site', id: site.id, slot }, auditId: el.dataset.audit || null, gps: ph.gps, width: ph.width, height: ph.height, takenAt: ph.takenAt, takenAtSource: ph.takenAtSource, importedAt: ph.importedAt, source: ph.source });
    const cur = store.get('site', site.id);
    const replaced = !!(prev.mediaId || prev.src);
    await store.put('site', { ...cur, photos: { ...(cur.photos || {}), [slot]: { ...prev, caption, mediaId: m.id, previousMediaId: prev.mediaId || null } } },
      { reason: `Photographie ${slot} (${caption}) de la station ${cur.name} ${replaced ? 'remplacée' : 'ajoutée'}${source === 'gallery' ? ' (importée de la galerie)' : ''}` });
    toast(`Photographie ${slot} enregistrée ✓${ph.takenAtSource === 'import' ? ' — date de prise de vue inconnue : date d’import retenue' : ''}`, ph.takenAtSource === 'import' ? 'warn' : 'ok', ph.takenAtSource === 'import' ? 5000 : 3200);
    if (typeof this?.refresh === 'function') this.refresh();
  },
  async 'st-photo-view'(el) {
    const { viewMedia } = await import('../ui/capture.js');
    await viewMedia(el.dataset.media, { readOnly: true });
  }
};

/** Badges des types de tournée d'une station (accueil, carte, création de tournée). */
export function typeBadges(site, { short = false } = {}) {
  return siteTypes(site).map(t => html`<span class="type-badge t-${t}">${icon(TYPE_STYLES[t].icon, { size: 15 })}${short ? TYPE_STYLES[t].label : TYPE_STYLES[t].long}</span>`);
}
