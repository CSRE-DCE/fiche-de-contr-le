/* Écran « Attendus des prestataires » (#/attendus) : document de référence partagé entre contrôleurs OEG et
 * prestataires. Pour chaque point de contrôle de la grille CT-2026 : ce que le prestataire doit faire ou présenter,
 * comment le contrôleur le vérifie, comment choisir C / P / NC / N/A, références et points « à préciser » par l'OEG ;
 * liste de préparation de la tournée à remettre aux prestataires.
 *
 * - Source unique : data/attendus-ct-2026.json (chargé et mis en cache par js/app/attendus-pdf.js).
 * - Filtres : type de tournée (?type=bio|ce|eso : seuls les critères AFFICHÉS pour ce type, d'après les conditions de
 *   la grille évaluées sur une station fictive — attendusModel / typeVisibility), feuille (?feuille=4), recherche
 *   (?q=…, filtrage immédiat sans réaffichage de l'écran).
 * - Boutons « Fiche des attendus (PDF) » et « Liste de préparation (PDF) » (js/app/attendus-pdf.js).
 * - Pour les feuilles d'audit : attenduFor(itemId) (synchrone, après loadAttendus()), attenduCard(itemId) (HTML) et
 *   openAttendu(itemId) (fenêtre « Attendu du prestataire ») ; itemId de base « it-F4-12 » ou effectif
 *   « it-F4-12@09271503 ».
 * Mise en forme : css/sheet.css (feuilles, cartes de section, thèmes) et css/attendus.css (chargée par l'écran si
 * index.html ne la déclare pas). Aucune donnée de la base locale n'est lue : l'écran fonctionne pour tout profil. */
import { html, raw, normalize, fmtDate } from '../core/util.js';
import { navigate, parseHash } from '../ui/router.js';
import { toast, openModal, downloadBlob } from '../ui/dom.js';
import { pageTitle } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { sectionCard, sharedBadge, checkSquare, assetURL } from '../ui/sheet-chrome.js';
import { themeVars, THEMES } from '../ui/themes.js';
import { GRID_CT_2026 } from '../domain/grid-ct-2026.js';
import { gridType, parseItemId } from '../domain/grids.js';
import {
  loadAttendus, attendusData, attenduFor as entryOf, attendusModel, typeVisibility, generateAttendusPdf,
  SCALE, TOUR_TYPES, TYPE_THEMES
} from '../app/attendus-pdf.js';

export { loadAttendus };

/* ---------- Feuille de style propre à l'écran ---------- */
const CSS_URL = assetURL('css/attendus.css');
let cssReady = null;
/** Ajoute css/attendus.css au document s'il ne la contient pas encore ; résolue au chargement (au plus 2 s). */
export function ensureStyles() {
  if (typeof document === 'undefined') return Promise.resolve();
  const present = [...document.querySelectorAll('link[rel~="stylesheet"]')].find(l => l.href === CSS_URL);
  if (present && cssReady) return cssReady;
  if (present) return (cssReady = Promise.resolve());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.dataset.attendus = '';
  cssReady = new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 2000);
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  });
  document.head.appendChild(link);
  return cssReady;
}

/* ---------- Outils ---------- */
const TYPE_ICONS = { bio: 'bug', ce: 'wave', eso: 'drop' };
const SCALE_CLS = { C: 'c', P: 'p', NC: 'nc', NA: 'na' };
const themeOf = name => (THEMES[name] ? name : 'ocean');
const typeShort = k => gridType(GRID_CT_2026, k)?.short || k;
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const valueText = entry => String(entry?.attendu || '').replace(/^Information à relever\s*:\s*/i, '');
const fold = s => normalize(String(s ?? '').replace(/[’ʼ]/g, '\''));

/** Texte de recherche d'un critère (code, libellé, attendu, vérification, échelle, références, à préciser). */
export function searchText(item) {
  const e = item.entry || {};
  return fold([item.code, item.label, e.attendu, e.verification, e.C, e.P, e.NC, e.NA, (e.refs || []).join(' '), e.aPreciser,
    item.shared ? 'commun a la tournee' : ''].filter(Boolean).join(' '));
}
/** Vrai si le texte de recherche contient tous les mots de la requête (sans accents ni casse). */
export function matches(text, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return terms.every(t => text.includes(t));
}

/** Adresse de l'écran avec ses paramètres (valeurs vides retirées). */
function hrefWith(patch = {}) {
  const q = { ...parseHash().query, ...patch };
  for (const k of Object.keys(q)) if (q[k] === '' || q[k] === null || q[k] === undefined) delete q[k];
  const qs = new URLSearchParams(q).toString();
  return '/attendus' + (qs ? '?' + qs : '');
}

/* ---------- Gabarits ---------- */
/** Pastille de cotation (C, P, NC, N/A). */
const scaleKey = s => html`<b class="att-k ${SCALE_CLS[s.code]}">${s.short}</b>`;

function typeBadges(item, model) {
  if (model.type || item.types.length >= TOUR_TYPES.length) return '';
  return item.types.map(k => html`<span class="att-tb th-${TYPE_THEMES[k]}" style="${themeVars(TYPE_THEMES[k])}">${icon(TYPE_ICONS[k], { size: 14 })}${typeShort(k)}</span>`);
}

/** Carte d'un critère coté : attendu, vérification, C / P / NC / N/A, références, à préciser. */
function critCard(item, model = { type: null }, { id = true } = {}) {
  const e = item.entry || {};
  const badges = [
    item.shared && item.sheetScope !== 'tournee' ? sharedBadge() : '',
    item.conditional ? html`<span class="att-tb att-cond">${icon('filter', { size: 14 })}Affiché selon une réponse</span>` : '',
    typeBadges(item, model)
  ].filter(Boolean);
  const scale = SCALE.filter(s => e[s.code]);
  return html`<article class="att-crit"${id ? raw(` id="att-${item.id}"`) : ''} data-id="${item.id}" data-q="${searchText(item)}">
    <header class="att-c-head">
      <span class="att-c-no">${item.no}</span>
      <h4 class="att-c-label">${item.label}</h4>
      <span class="att-c-code">${item.code}</span>
    </header>
    ${badges.length ? html`<div class="att-c-badges">${badges}</div>` : ''}
    <dl class="att-c-body">
      <div><dt>${icon('clipboard', { size: 16 })}Attendu</dt><dd>${e.attendu || '—'}</dd></div>
      ${e.verification ? html`<div><dt>${icon('eye', { size: 16 })}Vérification</dt><dd>${e.verification}</dd></div>` : ''}
    </dl>
    ${scale.length ? html`<div class="att-c-scale">${scale.map(s => html`<div class="att-sc ${SCALE_CLS[s.code]}"><div class="att-sc-h">${scaleKey(s)}<span>${s.label}</span></div><p>${e[s.code]}</p></div>`)}</div>` : ''}
    ${(e.refs || []).length ? html`<p class="att-c-refs">${icon('book', { size: 15 })}<span>Références : ${e.refs.join(' · ')}</span></p>` : ''}
    ${e.aPreciser ? html`<p class="att-c-prec">${icon('warning', { size: 16 })}<span><b>À préciser (OEG)</b> ${e.aPreciser}</span></p>` : ''}
  </article>`;
}

/** Ligne d'une information relevée sans cotation (critère « valeur seule »). */
const valueRow = item => html`<div class="att-val" id="att-${item.id}" data-id="${item.id}" data-q="${searchText(item)}">
  <span class="att-v-code">${item.code}</span><span class="att-v-label">${item.label}</span><span class="att-v-what">${valueText(item.entry) || '—'}</span>
</div>`;

function scaleBox(model) {
  return html`<section class="att-box att-scale-box" aria-labelledby="attScaleH">
    <h2 class="att-box-h" id="attScaleH">${icon('check-circle', { size: 22 })}Échelle de cotation C / P / NC / N/A</h2>
    <div class="att-scale">${model.echelle.map(s => html`<div class="att-sc-tile ${SCALE_CLS[s.code]}"><div class="att-sc-h">${scaleKey(s)}<span>${s.label}</span></div><p>${s.text}</p></div>`)}</div>
    <p class="att-note">${sharedBadge()} critère jugé une seule fois pour toute la tournée (une réponse partagée par toutes les stations).
      Les mentions « À préciser (OEG) » signalent une exigence chiffrée ou propre au marché que l’OEG doit confirmer.</p>
  </section>`;
}

function preparationBox(model) {
  const total = model.preparation.reduce((n, p) => n + p.groups.reduce((m, g) => m + (g.elements || []).length, 0), 0);
  return html`<details class="att-box att-prep" id="attPrep">
    <summary><h2 class="att-box-h">${icon('list', { size: 22 })}Liste de préparation de la tournée</h2><span class="att-sum-sub">${plural(total, 'élément')} à préparer par le prestataire · ${model.typeLabel}</span></summary>
    <p class="att-note">À remettre aux prestataires avant les tournées : ce qu’ils préparent pour remplir au mieux les exigences contrôlées.
      Elle complète le CCTP, les protocoles et les consignes du laboratoire, qui prévalent en cas de différence.</p>
    ${model.preparation.map(part => html`<div class="att-prep-part th-${TYPE_THEMES[part.key] || 'navy'}" style="${themeVars(TYPE_THEMES[part.key] || 'navy')}">
      <h3 class="att-prep-h">${icon(TYPE_ICONS[part.key] || 'clipboard', { size: 18 })}${part.label}</h3>
      <div class="att-prep-groups">${part.groups.map(g => html`<div class="att-prep-group"><h4>${g.titre || ''}</h4>
        <ul>${(g.elements || []).map(el => html`<li>${checkSquare()}<span>${el}</span></li>`)}</ul></div>`)}</div>
    </div>`)}
    <div class="att-prep-actions"><button type="button" class="btn ghost sm" data-act="att-prep-pdf" data-type="${model.type || ''}">${icon('pdf', { size: 18 })}Liste de préparation (PDF)</button></div>
  </details>`;
}

function sheetBlock(sh, model) {
  const t = themeOf(sh.theme);
  const meta = [`Onglet « ${sh.tab} »`, sh.scope === 'tournee' ? 'renseignée une fois par tournée' : 'répétée pour chaque station',
    sh.count ? plural(sh.count, 'point coté', 'points cotés') : '', sh.values ? plural(sh.values, 'information relevée', 'informations relevées') : '',
    model.type ? '' : 'tournées : ' + sh.types.map(typeShort).join(', ')].filter(Boolean).join(' · ');
  const body = sh.sections.map(sec => {
    const values = sec.items.filter(i => i.value), crits = sec.items.filter(i => !i.value);
    return sectionCard({
      no: sec.no || '', icon: sec.no ? '' : (sec.icon || sh.icon), title: sec.title, theme: sec.theme !== sh.theme ? sec.theme : undefined,
      cls: 'att-sec', id: 'att-sec-' + sec.id,
      body: html`${values.length ? html`<div class="att-vals"><p class="att-vals-h">Informations relevées par le contrôleur (sans cotation)</p>${values.map(valueRow)}</div>` : ''}
        ${crits.length ? html`<div class="att-crits">${crits.map(i => critCard(i, model))}</div>` : ''}`
    });
  });
  return html`<section class="sheet th-${t} att-sheet" style="${themeVars(t)}" data-theme="${t}" data-sheet="${sh.no}" id="att-F${sh.no}" aria-labelledby="att-F${sh.no}-h">
    <header class="att-sh-head">
      <span class="att-sh-no">${sh.code}</span>
      <div class="att-sh-titles"><h2 id="att-F${sh.no}-h">${sh.title}</h2><p class="att-sh-meta">${meta}</p></div>
      ${sh.icon ? html`<span class="att-sh-ic">${icon(sh.icon, { size: 40 })}</span>` : ''}
    </header>
    ${sh.intro ? html`<p class="att-sh-intro">${sh.intro}</p>` : ''}
    ${sh.documents.length ? html`<div class="att-docs"><h3>${icon('folder', { size: 16 })}À présenter ou à préparer</h3><ul>${sh.documents.map(d => html`<li>${d}</li>`)}</ul></div>` : ''}
    ${body}
  </section>`;
}

/* ---------- Filtrage par la recherche (sans réaffichage) ---------- */
/**
 * Masque les critères et informations qui ne contiennent pas tous les mots de `query`, puis les sections et feuilles
 * vides ; met à jour le décompte (#attCount) et le message « aucun résultat ». Retourne {crit, values}.
 */
export function applyFilter(root, query = '') {
  const has = !!fold(query);
  let crit = 0, values = 0;
  for (const el of root.querySelectorAll('.att-sheet [data-q]')) {
    const ok = !has || matches(el.dataset.q, query);
    el.classList.toggle('hide', !ok);
    if (ok) { if (el.classList.contains('att-crit')) crit++; else values++; }
  }
  const visible = el => !!el.querySelector('[data-q]:not(.hide)');
  for (const el of root.querySelectorAll('.att-vals, .att-sec, .att-sheet')) el.classList.toggle('hide', !visible(el));
  for (const el of root.querySelectorAll('.att-sh-intro, .att-docs')) el.classList.toggle('hide', has);
  const count = root.querySelector('#attCount');
  if (count) {
    const what = [plural(crit, 'point coté', 'points cotés'), values ? plural(values, 'information relevée', 'informations relevées') : ''].filter(Boolean).join(' · ');
    count.textContent = has ? `${what} pour « ${String(query).trim()} »` : what;
  }
  root.querySelector('#attEmpty')?.classList.toggle('hide', crit + values > 0);
  return { crit, values };
}

/* ---------- Écran ---------- */
export default {
  nav: 'attendus', title: 'Attendus des prestataires',
  async render(params, q = {}) {
    const css = ensureStyles();
    let data;
    try { data = await loadAttendus(); }
    catch (e) {
      await css;
      return html`${pageTitle('Attendus des prestataires')}<div class="card"><p>${e.message}</p><p class="note">Le fichier data/attendus-ct-2026.json n’a pas pu être lu. Ouvrez l’application une fois avec une connexion pour le mettre en cache sur l’appareil.</p></div>`;
    }
    const type = TOUR_TYPES.includes(q.type) ? q.type : null;
    const model = attendusModel(data, { auditType: type });
    const sheetNo = model.sheets.some(s => String(s.no) === String(q.feuille)) ? String(q.feuille) : '';
    const sheets = sheetNo ? model.sheets.filter(s => String(s.no) === sheetNo) : model.sheets;
    const counts = { crit: sheets.reduce((n, s) => n + s.count, 0), values: sheets.reduce((n, s) => n + s.values, 0) };
    const vis = typeVisibility(GRID_CT_2026);
    await css;
    const typeChip = (key, label, ic, n) => html`<button type="button" class="chip ${(type || '') === key ? 'sel' : ''}" data-act="att-type" data-value="${key}" aria-pressed="${(type || '') === key}" title="${plural(n, 'point coté', 'points cotés')}">${icon(ic, { size: 18 })}${label}<span class="att-chip-n">${n}</span></button>`;
    const coted = ids => [...ids].filter(id => !data.criteres?.[id]?.valeur).length;
    const sheetChip = sh => html`<button type="button" class="chip ${sheetNo === String(sh.no) ? 'sel' : ''}" data-act="att-sheet" data-value="${sh.no}" aria-pressed="${sheetNo === String(sh.no)}" title="${sh.title}"><span class="att-chip-no">${sh.code}</span>${sh.tab}</button>`;
    return html`${pageTitle('Attendus des prestataires',
      `Ce que le prestataire doit faire ou présenter, comment le contrôleur vérifie et cote chaque point · version ${model.version} du ${fmtDate(model.updated)}`,
      html`<button type="button" class="btn primary" data-act="att-pdf" data-type="${type || ''}">${icon('pdf', { size: 20 })}Fiche des attendus (PDF)</button>
        <button type="button" class="btn ghost" data-act="att-prep-pdf" data-type="${type || ''}">${icon('list', { size: 20 })}Liste de préparation (PDF)</button>`)}
      <div class="card att-tools" role="search">
        <div class="att-row"><span class="att-row-k">Type de tournée</span><div class="chips">
          ${typeChip('', 'Tous les types', 'grid', coted(vis.typesOf.keys()))}
          ${TOUR_TYPES.map(k => typeChip(k, typeShort(k), TYPE_ICONS[k], coted(vis.types[k]?.items || [])))}
        </div></div>
        <div class="att-row"><span class="att-row-k">Feuille</span><div class="chips">
          <button type="button" class="chip ${sheetNo ? '' : 'sel'}" data-act="att-sheet" data-value="" aria-pressed="${!sheetNo}">Toutes</button>
          ${model.sheets.map(sheetChip)}
        </div></div>
        <div class="att-row"><label class="att-row-k" for="attSearch">Rechercher</label>
          <div class="att-search">${icon('search', { size: 20 })}<input type="search" id="attSearch" data-input="att-search" value="${q.q || ''}" autocomplete="off" enterkeyhint="search"
            placeholder="glacière, étalonnage, Surber, F4.12…" aria-describedby="attCount"></div></div>
        <p class="att-count" id="attCount" aria-live="polite">${plural(counts.crit, 'point coté', 'points cotés')}${counts.values ? ' · ' + plural(counts.values, 'information relevée', 'informations relevées') : ''}</p>
      </div>
      ${model.avertissement ? html`<p class="att-notice">${icon('info', { size: 22 })}<span>${model.avertissement}</span></p>` : ''}
      ${scaleBox(model)}
      ${preparationBox(model)}
      <div class="att-sheets">${sheets.map(sh => sheetBlock(sh, model))}</div>
      <div class="card att-empty hide" id="attEmpty"><p>Aucun point de contrôle ne correspond à la recherche.</p><button type="button" class="btn ghost sm" data-act="att-clear">Effacer la recherche</button></div>
      <p class="note att-source">Source : data/attendus-ct-2026.json (version ${model.version}, grille ${GRID_CT_2026.code}) · version imprimable du dépôt : docs/ATTENDUS-PRESTATAIRES.md.
        Le CCTP, les protocoles et les consignes du laboratoire prévalent en cas de différence.</p>`;
  },
  mount(root, params, q = {}) {
    if (q.q) applyFilter(root, q.q);
    if (q.item) {
      const el = root.querySelector(`#att-${CSS.escape(parseItemId(q.item).baseId)}`);
      if (el) { el.classList.add('att-focus'); requestAnimationFrame(() => el.scrollIntoView({ block: 'center' })); }
    }
  },
  handlers: {
    'att-type'(el) {
      const type = el.dataset.value || '';
      const feuille = parseHash().query.feuille;
      // Feuille non affichée pour le nouveau type (ex. F10 hors eaux souterraines) : filtre retiré.
      const keep = feuille && (!type || typeVisibility(GRID_CT_2026).types[type]?.sheets.some(s => String(s.no) === String(feuille)));
      navigate(hrefWith({ type, feuille: keep ? feuille : '' }), { replace: true });
    },
    'att-sheet'(el) { navigate(hrefWith({ feuille: el.dataset.value || '' }), { replace: true }); },
    'att-search'(el) {
      const root = el.closest('#view') || document;
      applyFilter(root, el.value);
      history.replaceState(null, '', '#' + hrefWith({ q: el.value.trim() }));
    },
    'att-clear'(el) {
      const root = el.closest('#view') || document;
      const input = root.querySelector('#attSearch');
      if (input) { input.value = ''; input.focus(); }
      applyFilter(root, '');
      history.replaceState(null, '', '#' + hrefWith({ q: '' }));
    },
    async 'att-pdf'(el) { await makePdf(el, { auditType: el.dataset.type || null, preparationOnly: false }); },
    async 'att-prep-pdf'(el) { await makePdf(el, { auditType: el.dataset.type || null, preparationOnly: true }); }
  }
};

async function makePdf(el, opts) {
  if (el.disabled) return;
  const label = el.innerHTML;
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
  el.textContent = 'Génération du PDF…';
  try {
    const r = await generateAttendusPdf(opts);
    downloadBlob(r.bytes, r.filename, 'application/pdf');
    toast(`${r.filename} : ${plural(r.pages, 'page')}`, 'ok');
  } finally {
    el.disabled = false;
    el.removeAttribute('aria-busy');
    el.innerHTML = label;
  }
}

/* ---------- Attendu d'un critère dans les feuilles d'audit ---------- */
/**
 * Attendu d'un critère (identifiant de base « it-F4-12 » ou effectif « it-F4-12@09271503 ») :
 * {id, feuille, no, libelle, attendu, verification, C, P, NC, NA?, refs, aPreciser?, tournee, types, valeur?} ou null.
 * Synchrone : null tant que les attendus ne sont pas chargés (await loadAttendus() au préalable).
 */
export function attenduFor(itemId) { return entryOf(itemId, attendusData()); }

/** Critère du modèle d'affichage (tous types) : thème de sa section, badges, entrée des attendus. */
function modelItem(baseId, data) {
  for (const sh of attendusModel(data).sheets) {
    for (const sec of sh.sections) {
      const it = sec.items.find(i => i.id === baseId);
      if (it) return { item: it, sheet: sh, section: sec };
    }
  }
  return null;
}

/**
 * Carte HTML de l'attendu d'un critère, aux couleurs de sa feuille (à insérer dans une feuille d'audit ou une
 * fenêtre) ; '' si les attendus ne sont pas chargés ou si le critère est inconnu. Synchrone (voir attenduFor).
 */
export function attenduCard(itemId) {
  const data = attendusData();
  const found = data ? modelItem(parseItemId(itemId).baseId, data) : null;
  if (!found) return '';
  const t = themeOf(found.item.theme);
  const inner = found.item.value
    ? html`<div class="att-vals"><p class="att-vals-h">Information relevée par le contrôleur (sans cotation)</p>${valueRow(found.item)}</div>`
    : critCard(found.item, { type: null }, { id: false });
  return html`<div class="att-modal th-${t}" style="${themeVars(t)}">${inner}</div>`;
}

/** Fenêtre « Attendu du prestataire » d'un critère (charge les attendus si besoin). Retourne la promesse de fermeture. */
export async function openAttendu(itemId) {
  const [data] = await Promise.all([loadAttendus(), ensureStyles()]);
  const baseId = parseItemId(itemId).baseId;
  const found = modelItem(baseId, data);
  if (!found) { toast('Aucun attendu n’est défini pour ce point de contrôle.', 'warn'); return null; }
  const { item, sheet } = found;
  const m = openModal({
    title: `Attendu du prestataire – ${item.code} ${item.label}`, wide: true,
    body: html`${attenduCard(baseId)}<p class="note att-modal-note">${sheet.code} · ${sheet.title}. Le CCTP, les protocoles et les consignes du laboratoire prévalent en cas de différence.</p>`,
    actions: [{ label: 'Tous les attendus', act: 'all' }, { label: 'Fermer', cls: 'primary' }],
    handlers: {
      all() { this.close(); navigate(`/attendus?feuille=${sheet.no}&item=${encodeURIComponent(baseId)}`); }
    }
  });
  return m.result;
}
