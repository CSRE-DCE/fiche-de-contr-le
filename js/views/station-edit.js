/* Modification d'une station (#/station/:id/modifier), droit « référentiels » (ref.manage) : identification
 * (code SANDRE ou BSS, nom, nature, types de tournée, réseaux de surveillance — cases à cocher du référentiel
 * « Réseaux », plus « Autres réseaux » ramenés au code du référentiel ou ajoutés au référentiel —, matrice),
 * localisation (commune, bassin, cours d'eau, masse d'eau, coordonnées X / Y saisies en RGFG95 / UTM 22N ou en UTM
 * 21N — converties en UTM 22N, saisie d'origine conservée (srs, x21, y21), conversion affichée pendant la saisie,
 * point hors de la Guyane refusé — → WGS84, hydro-écorégion,
 * rang de Strahler, typologie, pressions), point d'eau souterraine (nature, usage, aquifère), accès et difficultés,
 * compartiments à contrôler et listes biologiques, points de prélèvement (station, invertébrés, diatomées,
 * ichtyofaune), légendes et source des photographies. Enregistrement par store.put avec motif obligatoire (journal
 * d'audit). */
import { html, raw, normalize } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, formValues } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageTitle, field, options, empty, networkChecks } from '../ui/components.js';
import { normalizeNetworkCodes, sameNetworks, sortNetworkCodes } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkList, ensureNetworks } from '../app/networks.js';
import { CODE_TYPES } from '../domain/model.js';
import { normalizeCompartments } from '../domain/grids.js';
import { latLonToUtm, utmConvert, guessUtmZone } from '../lib/geo.js';
import { SRS, srsOf, entryOf, siteXY, convertedText } from '../domain/coords.js';
import { TYPE_STYLES, TYPE_ORDER, SAMPLING_KINDS } from '../ui/map.js';
import { ctGrid, SLOTS, siteTypes } from './station-sheet.js';

const MODES = ['4x4', 'Bateau motorisé / pirogue', 'À pied', 'Hélicoptère', 'Avion', 'Autre'];
const USAGES = ['Alimentation en eau potable', 'Surveillance (piézomètre)', 'Usage agricole', 'Usage industriel', 'Autre'];
const BIO_LISTS = [['BIO_CE', 'Invertébrés, diatomées, physico-chimie (BIO_CE)'], ['BIO_FISH', 'Ichtyofaune et mercure (BIO_FISH)'], ['BIO_PHYTO', 'Phytoplancton (BIO_PHYTO)']];
const POINT_KINDS = Object.entries(SAMPLING_KINDS).filter(([k]) => k !== 'station').map(([id, k]) => ({ id, label: k.label }));

const num = v => { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); return s === '' || isNaN(Number(s)) ? null : Number(s); };
/** Liste de choix du système des coordonnées X / Y (UTM 22N RGFG95 par défaut, UTM 21N converti en 22N). */
const srsSelect = (attrs, cur) => html`<select ${raw(attrs)}>${Object.entries(SRS).map(([k, l]) => html`<option value="${k}" ${k === cur ? raw('selected') : ''}>${l}</option>`)}</select>`;
/**
 * Aperçu de la conversion d'une saisie X / Y (UTM 21N → RGFG95 / UTM 22N) et contrôle de cohérence :
 * {text, state ('conv' : conversion affichée, 'warn' : incohérence — refusée à l'enregistrement, '' : rien à dire)}.
 */
function xyPreview(x, y, srs) {
  const c = siteXY(x, y, srs);
  if (!c) return { text: srs === '21N' ? 'Saisissez X et Y en UTM 21N : ils seront convertis en RGFG95 / UTM 22N.' : '', state: '' };
  const issue = c.issues[0]?.message || '';
  if (issue) return { text: `⚠ ${issue}`, state: 'warn' };
  return srs === '21N' ? { text: `→ ${convertedText(c)} (valeurs enregistrées)`, state: 'conv' } : { text: '', state: '' };
}
/** Paragraphe de l'aperçu (station ou point de prélèvement). */
const previewP = (attrs, p) => html`<p class="hint se-xy-conv" ${raw(attrs)} data-state="${p.state}" aria-live="polite">${p.text}</p>`;
const setPreview = (out, p) => { if (out) { out.textContent = p.text; out.dataset.state = p.state; } };
/** Champs X / Y à l'affichage d'une saisie enregistrée (UTM 21N : saisie d'origine) ; à défaut, X / Y 22N. */
const shownXY = p => { const e = entryOf(p); return { x: e.x ?? p?.x ?? '', y: e.y ?? p?.y ?? '' }; };

function checkList(name, items, selected, { disabled = [] } = {}) {
  return html`<div class="checks se-checks">${items.map(([v, l, ic]) => html`<label class="check ${selected.includes(v) ? 'sel' : ''}"><input type="checkbox" name="${name}" data-multi value="${v}" ${selected.includes(v) ? 'checked' : ''} ${disabled.includes(v) ? raw('disabled') : ''}> ${ic ? icon(ic, { size: 20 }) : ''} ${l}</label>`)}</div>`;
}
function pointRow(p = {}) {
  const srs = srsOf(p), xy = shownXY(p);
  return html`<div class="se-sp-row">
    <label class="se-sp-kind"><span class="sr">Type de point</span><select data-sp="kind">${options(POINT_KINDS, p.kind || 'prelevement', { placeholder: null })}</select></label>
    <label class="se-sp-label"><span class="sr">Libellé</span><input data-sp="label" value="${p.label || ''}" placeholder="Libellé (ex. Radier amont)"></label>
    <label class="se-sp-srs"><span class="sr">Système des coordonnées du point</span>${srsSelect('data-sp="srs" data-change="se-srs" title="Système des coordonnées X / Y du point"', srs)}</label>
    <label class="se-sp-x"><span class="sr">X (m)</span><input data-sp="x" inputmode="decimal" value="${xy.x}" placeholder="X (m)" data-input="se-xy"></label>
    <label class="se-sp-y"><span class="sr">Y (m)</span><input data-sp="y" inputmode="decimal" value="${xy.y}" placeholder="Y (m)" data-input="se-xy"></label>
    <button type="button" class="icon-btn" data-act="spDel" title="Retirer ce point" aria-label="Retirer ce point">${icon('trash', { size: 20 })}</button>
    ${previewP('data-sp="conv"', xyPreview(xy.x, xy.y, srs))}
  </div>`;
}
const pointXY = p => {
  if (isFinite(p.x) && isFinite(p.y) && p.x !== null && p.x !== '') return p;
  if (isFinite(p.lat) && isFinite(p.lon) && p.lat !== null) { const [x, y] = latLonToUtm(p.lat, p.lon, 22); return { ...p, x: Math.round(x), y: Math.round(y) }; }
  return p;
};

/** Met à jour l'aperçu de conversion de la station ou du point de prélèvement contenant `el`. */
function updatePreview(el) {
  const row = el.closest('.se-sp-row');
  if (row) {
    setPreview(row.querySelector('[data-sp=conv]'), xyPreview(row.querySelector('[data-sp=x]')?.value, row.querySelector('[data-sp=y]')?.value, row.querySelector('[data-sp=srs]')?.value || '22N'));
    return;
  }
  const form = el.closest('form');
  if (form) setPreview(form.querySelector('#seXYConv'), xyPreview(form.querySelector('[name=x]')?.value, form.querySelector('[name=y]')?.value, form.querySelector('[name=srs]')?.value || '22N'));
}

export default {
  nav: 'home', title: 'Modifier la station',
  async render({ id }) {
    const s = store.get('site', id);
    if (!s) return html`<div class="card">${empty(icon('station', { size: 44 }), 'Station introuvable.')}<a class="btn ghost" href="#/">Retour aux stations</a></div>`;
    if (!can('ref.manage')) return html`<a class="back" href="#/station/${encodeURIComponent(id)}">‹ Fiche station</a><div class="card">${empty(icon('lock', { size: 44 }), 'Votre profil ne permet pas de modifier les stations (droit « référentiels »).')}</div>`;
    const grid = ctGrid();
    const types = siteTypes(s);
    const comps = s.compartments || [];
    const a = s.access || {};
    const modes = [...new Set([...(a.modes || []), ...(s.transportModes || [])])];
    const extraModes = modes.filter(m => !MODES.includes(m));
    const photos = s.photos || {};
    const sec = (ic, title, body, cls = '') => html`<section class="card se-sec ${cls}"><h2><span>${icon(ic, { size: 22 })}${title}</span></h2>${body}</section>`;
    return html`
      ${pageTitle(`Modifier : ${s.name}`, `${s.codeType === 'BSS' ? 'Code BSS' : 'Code SANDRE'} ${s.code} · toute modification est tracée au journal d’audit`, '', `#/station/${encodeURIComponent(id)}`)}
      <form id="seForm" class="se-form" data-submit="save" novalidate>
        ${sec('database', 'Identification', html`<div class="grid2">
          ${field('Code de la station', html`<input name="code" value="${s.code || ''}" required>`, { required: true })}
          ${field('Type de code', html`<select name="codeType">${options(Object.entries(CODE_TYPES).map(([k, l]) => ({ id: k, label: l })), s.codeType || 'SANDRE', { placeholder: null })}</select>`)}
          ${field('Nom de la station', html`<input name="name" value="${s.name || ''}" required>`, { required: true })}
          ${field('Nature du site', html`<input name="kind" value="${s.kind || ''}" placeholder="ex. Cours d’eau, Eau souterraine">`)}
          ${field('Matrice principale', html`<select name="matrixId">${options(store.all('matrix'), s.matrixId || '', { placeholder: '—' })}</select>`)}
        </div>
        ${field('Réseaux de surveillance', networkChecks('networks', currentNetworkList({ keep: s.networks || [] }), s.networks || []), { hint: 'Une station peut appartenir à plusieurs réseaux. Liste tenue dans Référentiels › Réseaux de surveillance.' })}
        ${field('Autres réseaux (codes séparés par « ; »)', html`<input name="networksOther" value="" placeholder="ex. RCO ; Eaux littorales">`, { hint: 'Codes ou libellés reconnus sans tenir compte des majuscules ni des accents ; un code inconnu est ajouté au référentiel.' })}
        ${field('Types de tournée concernés', checkList('types', TYPE_ORDER.map(t => [t, TYPE_STYLES[t].long, TYPE_STYLES[t].icon]), types))}`)}

        ${sec('pin', 'Localisation', html`<div class="grid2">
          ${field('Commune', html`<input name="commune" value="${s.commune || ''}">`)}
          ${field('Bassin versant', html`<input name="bassin" value="${s.bassin || ''}">`)}
          ${field('Cours d’eau', html`<input name="riverName" value="${s.riverName || ''}">`)}
          ${field('Masse d’eau', html`<input name="masseEau" value="${s.masseEau || ''}">`)}
          <div class="se-xy" role="group" aria-label="Coordonnées X / Y de la station">
            ${field('Système des coordonnées X / Y', srsSelect('name="srs" id="seSrs" data-change="se-srs"', srsOf(s)), { hint: 'RGFG95 / UTM 22N par défaut ; une saisie en UTM 21N (ouest guyanais) est convertie en UTM 22N, la saisie d’origine est conservée.' })}
            ${field('X (m)', html`<input name="x" inputmode="decimal" value="${shownXY(s).x}" data-input="se-xy">`, { hint: 'Prioritaire : la position WGS84 est recalculée.' })}
            ${field('Y (m)', html`<input name="y" inputmode="decimal" value="${shownXY(s).y}" data-input="se-xy">`)}
            ${previewP('id="seXYConv"', xyPreview(shownXY(s).x, shownXY(s).y, srsOf(s)))}
          </div>
          ${field('Latitude WGS84', html`<input name="lat" inputmode="decimal" value="${s.lat ?? ''}">`, { hint: 'Utilisée seulement si X / Y sont vides.' })}
          ${field('Longitude WGS84', html`<input name="lon" inputmode="decimal" value="${s.lon ?? ''}">`)}
          ${field('Hydro-écorégion (HER)', html`<input name="her" value="${s.her ?? ''}">`)}
          ${field('Rang de Strahler', html`<input name="strahler" inputmode="numeric" value="${s.strahler ?? ''}">`)}
          ${field('Typologie', html`<input name="typo" value="${s.typo || ''}" placeholder="ex. Fleuve, Crique">`)}
          ${field('Pressions', html`<input name="pressions" value="${s.pressions || ''}">`)}
        </div>`)}

        ${sec('well', 'Point d’eau souterraine', html`<p class="note">À renseigner pour les points des réseaux d’eaux souterraines (code BSS).</p><div class="grid2">
          ${field('Nature du point', html`<input name="nature" value="${s.nature || ''}" placeholder="ex. Forage, piézomètre, source">`)}
          ${field('Usage', html`<input name="usage" value="${s.usage || ''}" list="seUsages"><datalist id="seUsages">${USAGES.map(u => html`<option value="${u}"></option>`)}</datalist>`)}
          ${field('Aquifère', html`<input name="aquifere" value="${s.aquifere || ''}">`)}
        </div>`)}

        ${sec('boat', 'Accès et difficultés', html`
          ${field('Accès — résumé', html`<input name="accessSummary" value="${a.summary || ''}" placeholder="ex. Environ 2 h depuis Cayenne et 1 h 30 depuis Régina.">`)}
          ${field('Accès — itinéraire détaillé', html`<textarea name="accessDetails" rows="3">${a.details || ''}</textarea>`)}
          ${field('Moyens d’accès', checkList('modes', [...MODES, ...extraModes].map(m => [m, m]), modes))}
          ${field('Difficultés / points d’attention', html`<textarea name="difficulties" rows="2">${s.difficulties || ''}</textarea>`)}
          ${field('Consignes (accès, sécurité, contacts…)', html`<textarea name="notes" rows="2">${s.notes || ''}</textarea>`)}`)}

        ${sec('clipboard', 'Compartiments à contrôler', html`
          ${checkList('compartments', (grid.compartments || []).map(c => [c.key, c.label, c.icon]), [...new Set([...comps, ...(grid.compartments || []).filter(c => c.always).map(c => c.key)])], { disabled: (grid.compartments || []).filter(c => c.always).map(c => c.key) })}
          ${field('Listes des fiches terrain biologiques', checkList('bioLists', BIO_LISTS, s.bioLists || []))}`)}

        ${sec('map', 'Points de prélèvement', html`<p class="note">Points affichés sur la carte de la fiche station (coordonnées en mètres, RGFG95 / UTM 22N ; une saisie en UTM 21N est convertie).</p>
          <div id="seSpRows" class="se-sp">${(s.samplingPoints || []).map(p => pointRow(pointXY(p)))}</div>
          <button type="button" class="btn ghost sm" data-act="spAdd"><span class="ic">${icon('plus', { size: 18 })}</span>Ajouter un point</button>`)}

        ${sec('camera', 'Photographies', html`<p class="note">Les photographies s’ajoutent ou se remplacent depuis la fiche station (bouton sur chaque photo).</p>
          <div class="grid2">${SLOTS.map(([slot, def]) => {
            const p = photos[slot] || {};
            return html`<div class="field"><label for="se-cap-${slot}">${slot} — légende</label><input id="se-cap-${slot}" name="cap_${slot}" value="${p.caption || ''}" placeholder="${def}">
              <div class="hint">${p.mediaId ? html`Photo prise dans l’application. <label class="se-inline"><input type="checkbox" name="drop_${slot}"> retirer${p.src ? ' (revenir à la photo d’origine)' : ''}</label>` : p.src ? 'Photo d’origine (rapport)' : 'Aucune photo'}</div></div>`;
          })}</div>
          ${field('Source des photographies et de la cartographie', html`<input name="photoSource" value="${s.photoSource || ''}" placeholder="ex. Localisation cartographique et photos issues du rapport …">`)}`)}

        <section class="card se-sec se-reason">
          ${field('Motif de la modification', html`<textarea name="reason" rows="2" required placeholder="ex. Mise à jour de l’accès après la tournée du 9 octobre"></textarea>`, { required: true, hint: 'Obligatoire : enregistré au journal d’audit avec le détail des changements.' })}
          <div class="btn-row"><a class="btn ghost" href="#/station/${encodeURIComponent(id)}">Annuler</a><button class="btn primary lg" type="submit"><span class="ic">${icon('check')}</span>Enregistrer la station</button></div>
        </section>
      </form>`;
  },
  handlers: {
    spAdd() { document.getElementById('seSpRows')?.insertAdjacentHTML('beforeend', String(pointRow({}))); },
    /** Aperçu de la conversion pendant la saisie de X / Y (station ou point de prélèvement). */
    'se-xy'(el) { updatePreview(el); },
    /**
     * Changement de système (station ou point) : X / Y déjà saisis dans l'ancien système et plausibles en Guyane sont
     * convertis pour garder la même position ; X / Y plausibles dans le nouveau système (saisis avant de choisir le
     * fuseau) sont gardés tels quels.
     */
    'se-srs'(el) {
      const box = el.closest('.se-sp-row') || el.closest('form');
      const [ix, iy] = el.closest('.se-sp-row') ? [box.querySelector('[data-sp=x]'), box.querySelector('[data-sp=y]')] : [box.querySelector('[name=x]'), box.querySelector('[name=y]')];
      const x = num(ix?.value), y = num(iy?.value), to = el.value, from = to === '21N' ? '22N' : '21N';
      if (x !== null && y !== null && guessUtmZone(x, y) === from) {
        const [cx, cy] = utmConvert(x, y, from, to);
        ix.value = Math.round(cx); iy.value = Math.round(cy);
      }
      updatePreview(el);
    },
    spDel(el) { el.closest('.se-sp-row')?.remove(); },
    async save(form) {
      const s = store.get('site', this.params.id);
      if (!s) throw new Error('Station introuvable.');
      if (!can('ref.manage')) throw new Error('Votre profil ne permet pas de modifier les stations.');
      const v = formValues(form);
      const reason = String(v.reason || '').trim();
      const code = String(v.code || '').trim(), name = String(v.name || '').trim();
      if (!code || !name) { toast('Le code et le nom de la station sont obligatoires.', 'err'); return; }
      if (!reason) { toast('Indiquez le motif de la modification.', 'err'); form.querySelector('[name=reason]')?.focus(); return; }
      if (store.find('site', x => x.id !== s.id && normalize(x.code) === normalize(code))) { toast('Ce code est déjà utilisé par une autre station.', 'err'); return; }
      // Coordonnées : X / Y prioritaires (RGFG95 / UTM 22N, ou UTM 21N converties en 22N — saisie d'origine gardée :
      // srs, x21, y21), sinon latitude / longitude. Point hors de la Guyane, X / Y d'UTM 21N saisis en 22N : refusés.
      let x = num(v.x), y = num(v.y), lat = num(v.lat), lon = num(v.lon);
      let origin = null;
      if (x !== null || y !== null) {
        const c = siteXY(x, y, v.srs === '21N' ? '21N' : '22N');
        if (!c) { toast('Saisissez X et Y (en mètres).', 'err'); return; }
        if (c.issues.length) { toast(c.issues[0].message, 'err', 8000); form.querySelector('[name=x]')?.focus(); return; }
        ({ x, y, lat, lon } = c);
        if (c.srs === '21N') origin = { srs: '21N', x21: c.x21, y21: c.y21 };
      } else if (lat !== null && lon !== null) {
        if (lat < 1.5 || lat > 6.5 || lon < -55.5 || lon > -51) { toast('Latitude / longitude hors de la Guyane.', 'err'); return; }
        const [ex, ny] = latLonToUtm(lat, lon, 22); x = Math.round(ex); y = Math.round(ny);
      }
      const points = [];
      for (const row of form.querySelectorAll('.se-sp-row')) {
        const get = k => row.querySelector(`[data-sp=${k}]`)?.value ?? '';
        const px = num(get('x')), py = num(get('y'));
        if (px === null && py === null && !String(get('label')).trim()) continue;
        const c = siteXY(px, py, get('srs') === '21N' ? '21N' : '22N');
        if (!c || c.issues.length) { toast(`Point « ${get('label') || 'sans libellé'} » : ${c ? c.issues[0].message : 'coordonnées X / Y invalides.'}`, 'err', 8000); return; }
        points.push({ kind: get('kind') || 'prelevement', label: String(get('label')).trim(), x: c.x, y: c.y, lat: c.lat, lon: c.lon, ...(c.srs === '21N' ? { srs: '21N', x21: c.x21, y21: c.y21 } : {}) });
      }
      const grid = ctGrid();
      const modes = v.modes || [];
      const photos = { ...(s.photos || {}) };
      for (const [slot] of SLOTS) {
        const cur = photos[slot] || {};
        const caption = String(v['cap_' + slot] || '').trim();
        const next = { ...cur, caption };
        if (v['drop_' + slot] && cur.mediaId) { next.previousMediaId = cur.mediaId; next.mediaId = null; }
        if (caption || next.mediaId || next.src) photos[slot] = next; else delete photos[slot];
      }
      // Réseaux : cases cochées + « Autres réseaux » ramenés au code du référentiel ; même ensemble : ordre conservé.
      const idx = currentNetworkIndex();
      const nets = normalizeNetworkCodes([...(v.networks || []), ...String(v.networksOther || '').split(/[;,|\n]/)], idx);
      const networks = sameNetworks(nets.codes, s.networks || []) ? [...(s.networks || [])] : sortNetworkCodes(nets.codes, idx);
      const next = {
        ...s, code, name, codeType: v.codeType || 'SANDRE', kind: v.kind, matrixId: v.matrixId || s.matrixId || null,
        networks,
        types: TYPE_ORDER.filter(t => (v.types || []).includes(t)),
        commune: v.commune, bassin: v.bassin, riverName: v.riverName, masseEau: v.masseEau,
        x: x ?? null, y: y ?? null, lat: lat ?? null, lon: lon ?? null, ...(origin || {}),
        her: v.her === '' ? '' : (isNaN(Number(v.her)) ? v.her : Number(v.her)), strahler: v.strahler, typo: v.typo, pressions: v.pressions,
        nature: v.nature, usage: v.usage, aquifere: v.aquifere,
        access: { ...(s.access || {}), summary: String(v.accessSummary || '').trim(), details: String(v.accessDetails || '').trim(), modes },
        transportModes: modes, difficulties: String(v.difficulties || '').trim(), notes: v.notes,
        compartments: normalizeCompartments(grid, v.compartments || []), bioLists: (v.bioLists || []).slice(),
        samplingPoints: points, photos, photoSource: String(v.photoSource || '').trim()
      };
      if (!origin) { delete next.srs; delete next.x21; delete next.y21; }
      const created = await ensureNetworks(nets.unknown, { reason: `${reason} (réseau ajouté depuis la fiche de la station ${code})`, action: 'create' });
      await store.put('site', next, { reason });
      // Point principal du site (créé avec le référentiel aux coordonnées de la station) : même position.
      if (lat !== null && (lat !== s.lat || lon !== s.lon)) {
        for (const pt of store.filter('point', p => p.siteId === s.id && p.lat === s.lat && p.lon === s.lon)) {
          await store.put('point', { ...pt, lat, lon }, { reason: `${reason} (position de la station)` });
        }
      }
      toast(created.length ? `Station enregistrée ✓ — réseau(x) ajouté(s) au référentiel : ${created.map(n => n.code).join(', ')}` : 'Station enregistrée ✓', 'ok', created.length ? 6000 : undefined);
      navigate('/station/' + encodeURIComponent(s.id));
    }
  }
};
