/* Composants d'interface réutilisables (gabarits HTML). */
import { html, raw, esc, fmtDate, fmtDateTime, fmtTime } from '../core/util.js';
import { store } from '../core/store.js';
import { mediaURL } from '../core/media.js';
import { hasSpeech } from './dom.js';
import {
  PRESTATION_STATUS, AUDIT_STATUS, DEVIATION_STATUS, DOC_STATUS, PROVIDER_KINDS, RESPONSES, ALERT_LEVELS
} from '../domain/model.js';
import { networkColors } from '../domain/networks.js';
import { icon } from './icons.js';

export function badge(text, cls = '') { return html`<span class="badge ${cls}">${text}</span>`; }
export function statusBadge(map, key) { const s = map[key]; return s ? badge(s.label || s, s.cls || '') : badge(key || '—', 'na'); }
export const prestationBadge = s => statusBadge(PRESTATION_STATUS, s);
export const auditBadge = a => a?.lock?.lockedAt ? badge('🔒 Signé — verrouillé', 'ok') : statusBadge(AUDIT_STATUS, a?.status);
export const deviationBadge = s => statusBadge(DEVIATION_STATUS, s);
export const docBadge = s => statusBadge(DOC_STATUS, s);
export function kindBadge(kind) { return badge(PROVIDER_KINDS[kind] || kind || '—', kind === 'regie' ? 'brand' : kind === 'partenaire' ? 'info' : 'outline'); }
export function responseBadge(code) { const r = RESPONSES[code]; return r ? badge(r.label, r.cls) : ''; }
export function critBadge(code) {
  const c = store.all('criticality').find(x => x.code === code);
  if (!c) return code ? badge(code, 'na') : badge('Criticité ?', 'na');
  return html`<span class="badge crit" style="background:${c.color || '#55636a'}">${c.label}</span>`;
}
export function alertLevelBadge(level) { const l = ALERT_LEVELS[level]; return l ? badge(l.label, l.cls) : ''; }

export function kv(pairs) {
  const rows = pairs.filter(p => p && p[1] !== undefined && p[1] !== null && p[1] !== '' && !(Array.isArray(p[1]) && !p[1].length));
  return html`<div class="kv">${rows.map(([k, v]) => html`<div>${k}</div><div>${v}</div>`)}</div>`;
}
export function empty(icon, text, action = '') { return html`<div class="empty"><span class="ic">${icon}</span><div>${text}</div>${action ? html`<div style="margin-top:12px">${action}</div>` : ''}</div>`; }
export function pageTitle(title, sub = '', right = '', back = '') {
  return html`${back ? html`<a class="back" href="${back}">‹ Retour</a>` : ''}<div class="page-title"><div><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>${right ? html`<div class="row">${right}</div>` : ''}</div>`;
}
/** Pastille de couleur d'un réseau de surveillance (décorative : le code ou le libellé l'accompagne toujours). */
export function networkDot(network) { return html`<span class="net-dot" style="--net:${networkColors(network).main}" aria-hidden="true"></span>`; }
/** Variables CSS des couleurs d'un réseau (--net, --net-light, --net-line, --net-dark : texte et fond sélectionné). */
export function networkVars(network) {
  const c = networkColors(network);
  return `--net:${c.main};--net-light:${c.light};--net-line:${c.line};--net-dark:${c.dark}`;
}
/**
 * Badge d'un réseau (pastille + code, libellé en info-bulle ; `long` : « CODE – Libellé ») ; `href` : lien (stations
 * du réseau à l'accueil). Le code est du texte : l'information ne repose jamais sur la seule couleur.
 */
export function networkBadge(network, { href = '', long = false } = {}) {
  const n = network || {};
  const text = long && n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code;
  const title = n.label && n.label !== n.code ? `${n.code} – ${n.label}` : `Réseau ${n.code}`;
  const inner = html`${networkDot(n)}${text}`;
  return href ? html`<a class="net-badge" href="${href}" style="${networkVars(n)}" title="${title}">${inner}</a>`
    : html`<span class="net-badge" style="${networkVars(n)}" title="${title}">${inner}</span>`;
}
/** Badges d'une liste de réseaux (objets du référentiel, js/app/networks.js : siteNetworks). */
export const networkBadges = (list, opts = {}) => (list || []).map(n => networkBadge(n, { ...opts, href: typeof opts.href === 'function' ? opts.href(n) : opts.href || '' }));
/**
 * Cases à cocher des réseaux de surveillance (valeur enregistrée = code) : pastille, code et libellé. `networks` :
 * réseaux proposés (js/app/networks.js : currentNetworkList, qui garde les réseaux déjà portés même inactifs ou
 * hors référentiel) ; `selected` : codes cochés.
 */
export function networkChecks(name, networks, selected = []) {
  const state = n => n.virtual ? 'hors référentiel' : n._deleted ? 'supprimé du référentiel' : n.active === false ? 'inactif' : '';
  return html`<div class="checks net-checks">${networks.map(n => {
    const on = selected.includes(n.code);
    return html`<label class="check ${on ? 'sel' : ''}"><input type="checkbox" name="${name}" data-multi value="${n.code}" ${on ? raw('checked') : ''}>${networkDot(n)}<span><b>${n.code}</b>${n.label && n.label !== n.code ? ` – ${n.label}` : ''}${state(n) ? html`<small class="net-state"> (${state(n)})</small>` : ''}</span></label>`;
  })}</div>`;
}
export function field(label, control, { required = false, hint = '', id = '' } = {}) {
  return html`<div class="field"><label ${id ? raw(`for="${esc(id)}"`) : ''}>${label}${required ? html` <span class="req">*</span>` : ''}</label>${control}${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
}
export function options(list, selected, { placeholder = '— sélectionner —', value = x => x.id, label = x => x.label || x.name } = {}) {
  const sel = Array.isArray(selected) ? selected.map(String) : [String(selected ?? '')];
  return html`${placeholder !== null ? html`<option value="">${placeholder}</option>` : ''}${list.map(x => {
    const v = typeof x === 'string' ? x : value(x), l = typeof x === 'string' ? x : label(x);
    return html`<option value="${v}" ${sel.includes(String(v)) ? raw('selected') : ''}>${l}</option>`;
  })}`;
}
/** Boutons segmentés (choix unique). opts : [{value, label, cls, icon, sub}] */
export function seg(act, opts, value, data = {}) {
  const attrs = raw(Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' '));
  return html`<div class="seg">${opts.map(o => html`<button type="button" class="${String(o.value) === String(value) ? 'sel ' + (o.cls || 'brand') : ''}" data-act="${act}" data-value="${o.value}" ${attrs} aria-pressed="${String(o.value) === String(value)}">${o.icon ? html`<span class="k">${o.icon}</span>` : ''}${o.label}${o.sub ? html`<small>${o.sub}</small>` : ''}</button>`)}</div>`;
}
export function voiceBtn(targetId) {
  return hasSpeech() ? html`<button type="button" class="icon-btn" data-act="voice" data-target="${targetId}" title="Saisie vocale" aria-label="Saisie vocale">🎤</button>` : '';
}
export function progressBar(pct) { return html`<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`; }

/** Libellés des trois façons d'ajouter une preuve (boutons, info-bulles, lecteurs d'écran). */
export const MEDIA_SOURCES = {
  camera: { label: 'Prendre une photo', title: 'Prendre une photo avec l’appareil photo de la tablette', icon: 'camera' },
  gallery: { label: 'Importer depuis la galerie', title: 'Importer des photos déjà dans l’appareil (galerie) : la date de prise de vue est reprise de la photo', icon: 'gallery' },
  document: { label: 'Joindre un document', title: 'Joindre un document (PDF, tableur, texte…)', icon: 'doc' }
};
/**
 * Ajout d'une photographie ou d'un document (preuve) : deux choix DISTINCTS et explicites partout où une photo
 * s'ajoute — « Prendre une photo » (appareil photo de la tablette : accept image/*, capture=environment, une photo) et
 * « Importer depuis la galerie » (photos déjà dans l'appareil : accept image/* sans capture, sélection multiple ;
 * Android ouvre le sélecteur de photos du système, iOS la photothèque) — et, si utile, « Joindre un document ».
 * data-source (camera | gallery | document) : origine enregistrée dans le média (js/ui/capture.js) ; gestionnaire
 * data-change = `act` (défaut « media-add »). link = {type, id, itemId?} ; compact : icônes seules (lignes de tableau,
 * libellé en info-bulle et pour les lecteurs d'écran) ; labels : libellés propres à l'écran ; data : attributs
 * data-* supplémentaires du champ.
 */
export function mediaInputs(link, { auditId = '', photo = true, gallery = true, document = false, compact = false, cls = 'btn ghost sm', camCls = '', act = 'media-add', labels = {}, data = {} } = {}) {
  const attrs = raw([link ? `data-link="${esc(JSON.stringify(link))}"` : '', `data-audit="${esc(auditId || '')}"`, ...Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`)].filter(Boolean).join(' '));
  const one = (key, accept) => {
    const d = MEDIA_SOURCES[key], label = labels[key] || d.label;
    const input = html`<input type="file" ${raw(accept)} hidden data-change="${act}" data-source="${key}" ${key === 'document' ? raw('data-kind="document"') : ''} ${attrs}>`;
    return compact
      ? html`<label class="as-tool ms-${key}" title="${label}" aria-label="${label}">${icon(d.icon, { size: 18 })}${input}</label>`
      : html`<label class="${key === 'camera' && camCls ? camCls : cls} ms-btn ms-${key}" title="${d.title}"><span class="ic">${icon(d.icon, { size: 18 })}</span><span class="ms-l">${label}</span>${input}</label>`;
  };
  return html`${photo ? one('camera', 'accept="image/*" capture="environment"') : ''}${gallery ? one('gallery', 'accept="image/*" multiple') : ''}${document ? one('document', 'accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt" multiple') : ''}`;
}
/** Boutons d'ajout de preuves (grilles historiques, écarts, modules) : prendre une photo, importer depuis la galerie,
 * joindre un document. link = {type, id, itemId?} ; label : libellé du bouton « appareil photo ». */
export function evidenceButtons(link, { auditId = '', photo = true, gallery = true, file = true, label = '' } = {}) {
  return mediaInputs(link, { auditId, photo, gallery, document: file, camCls: 'btn primary sm', labels: label ? { camera: label } : {} });
}
/** Heure de la vignette : date et heure si la prise de vue n'est pas du jour (photo importée), « import » si inconnue. */
function thumbTime(m) {
  if (m?.takenAtSource === 'import') return `import ${fmtTime(m.takenAt)}`;
  const d = m?.takenAt ? new Date(m.takenAt) : null;
  return d && d.toDateString() !== new Date().toDateString() ? `${fmtDate(m.takenAt).slice(0, 5)} ${fmtTime(m.takenAt)}` : fmtTime(m?.takenAt);
}
const thumbWhen = m => m?.source === 'gallery' ? (m.takenAtSource === 'exif' ? `photo du ${fmtDateTime(m.takenAt)}, importée de la galerie` : 'importée de la galerie : date de prise de vue inconnue') : '';
/** Vignettes de médias ; les images sont chargées ensuite par hydrateMedia(). */
export function thumbs(list) {
  if (!list?.length) return '';
  return html`<div class="thumbs">${list.map(m => m.mime?.startsWith('image/')
    ? html`<button type="button" class="thumb" data-act="media-view" data-id="${m.id}" title="${[m.caption, thumbWhen(m)].filter(Boolean).join(' — ')}"><img data-media="${m.id}" alt="${m.caption || 'Photographie'}">${m.derivedFrom ? html`<span class="t-badge">annotée</span>` : m.source === 'gallery' ? html`<span class="t-badge t-gal">galerie</span>` : ''}<span class="t-meta">${thumbTime(m)} · ${m.authorName || ''}</span></button>`
    : html`<button type="button" class="thumb file" data-act="media-view" data-id="${m.id}"><span class="ic">📄</span>${m.name || 'Document'}</button>`)}</div>`;
}
export async function hydrateMedia(root) {
  for (const img of root.querySelectorAll('img[data-media]')) {
    if (img.getAttribute('src')) continue;
    const url = await mediaURL(img.dataset.media).catch(() => null);
    if (url) img.src = url; else img.alt = 'Image non disponible sur cet appareil';
  }
}

export function userName(id) { return store.get('user', id)?.name || ''; }
export function providerName(id) { return store.get('provider', id)?.name || '—'; }
export function siteName(id) { const s = store.get('site', id); return s ? `${s.name}${s.code ? ' (' + s.code + ')' : ''}` : '—'; }
/** Stations d'une tournée : « 2 stations : Crique à l’Est, Amont Voltaire » (une seule : « Nom (code) »). */
export function tourStationsLabel(audit) {
  const list = audit?.stations || [];
  if (list.length <= 1) return siteName(list[0]?.siteId || audit?.siteId);
  return `${list.length} stations : ${list.map(st => store.get('site', st.siteId)?.name || st.key).join(', ')}`;
}
/** Sites d'un audit (toutes les stations de la tournée ; grille historique : le site de l'audit). */
export const auditSiteIds = audit => [...new Set([...(audit?.stations || []).map(st => st.siteId), audit?.siteId].filter(Boolean))];
export function operatorName(o) { if (typeof o === 'string') o = store.get('operator', o); return o ? ([o.firstName, o.lastName].filter(Boolean).join(' ') || o.code) + (o.code && o.firstName ? ` (${o.code})` : '') : '—'; }
export function docLabel(d) { return d ? `${d.reference || d.name} — v${d.version}` : '—'; }
export { fmtDate, fmtDateTime, fmtTime };
