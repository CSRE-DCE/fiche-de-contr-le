/* Composants d'interface réutilisables (gabarits HTML). */
import { html, raw, esc, fmtDate, fmtDateTime, fmtTime } from '../core/util.js';
import { store } from '../core/store.js';
import { mediaURL } from '../core/media.js';
import { hasSpeech } from './dom.js';
import {
  PRESTATION_STATUS, AUDIT_STATUS, DEVIATION_STATUS, DOC_STATUS, PROVIDER_KINDS, RESPONSES, ALERT_LEVELS
} from '../domain/model.js';
import { networkColors } from '../domain/networks.js';

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

/** Boutons d'ajout de preuves (photo appareil, galerie, fichier). link = {type, id, itemId?} */
export function evidenceButtons(link, { auditId = '', photo = true, gallery = true, file = true, label = 'Photo' } = {}) {
  const data = raw(`data-link="${esc(JSON.stringify(link))}" data-audit="${esc(auditId || '')}"`);
  return html`${photo ? html`<label class="btn primary sm"><span class="ic">📷</span>${label}<input type="file" accept="image/*" capture="environment" hidden data-change="media-add" ${data}></label>` : ''}
    ${gallery ? html`<label class="btn ghost sm"><span class="ic">🖼️</span>Galerie<input type="file" accept="image/*" multiple hidden data-change="media-add" ${data}></label>` : ''}
    ${file ? html`<label class="btn ghost sm"><span class="ic">📎</span>Document<input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.odt,.txt" multiple hidden data-change="media-add" data-kind="document" ${data}></label>` : ''}`;
}
/** Vignettes de médias ; les images sont chargées ensuite par hydrateMedia(). */
export function thumbs(list) {
  if (!list?.length) return '';
  return html`<div class="thumbs">${list.map(m => m.mime?.startsWith('image/')
    ? html`<button type="button" class="thumb" data-act="media-view" data-id="${m.id}" title="${m.caption || ''}"><img data-media="${m.id}" alt="${m.caption || 'Photographie'}">${m.derivedFrom ? html`<span class="t-badge">annotée</span>` : ''}<span class="t-meta">${fmtTime(m.takenAt)} · ${m.authorName || ''}</span></button>`
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
