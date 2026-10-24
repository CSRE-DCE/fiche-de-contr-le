/* Audit « en feuilles » (grilles `layout: 'sheets'`, ex. CT-2026 — SPEC § 6.3 et avenant n° 1 § F) : une tournée
 * = une ou plusieurs stations. Écran fidèle aux fiches papier (docs/maquettes) :
 * - sélecteur des stations de la tournée (pastilles numérotées avec avancement, ajout d'une station du référentiel,
 *   retrait motivé), barre d'onglets colorée par thème : la feuille de tournée (F2) puis les feuilles de la station
 *   courante, puis Écarts, Synthèse, Signatures et Infos ;
 * - étapes : feuille-<no> (feuille de tournée), feuille-<no>@<clé> (feuille d'une station), ecarts, synthese,
 *   signatures, infos (identification de l'audit, contrôleurs OEG de la tournée et saisies par agent, stations,
 *   documents figés, alertes, continuer plus tard, « Annuler la tournée ») ;
 * - PÉRIMÈTRE contrôlé d'une station sur plusieurs réseaux (« Biologie », « Chimie ») : choisi à l'ajout de la station
 *   et modifiable avant la signature (onglet Infos, « Périmètre contrôlé » : motif si des saisies deviennent masquées) ;
 *   tournée mixte : badges des types dans l'en-tête, périmètre de chaque station (Infos, synthèse, feuille 1) ;
 * - « Annuler la tournée » (motif obligatoire) dans l'en-tête et l'onglet Infos pour tout contrôleur de la tournée et
 *   l'encadrement autorisé ; sinon la raison est expliquée (tournée signée et verrouillée, tournée à rejoindre) ;
 * - tournée en binôme : bandeau « Tournée de … — Rejoindre la tournée » pour un agent qui n'en est pas contrôleur ;
 * - chaque feuille : en-tête OEG (complet ≥ 900 px, compact en dessous), bandeau d'information, modules (appareils
 *   de mesure de F4 ; préleveurs du prestataire et « Ajouter un opérateur » sur F2), tableaux .st-table ≥ 1100 px
 *   (N° | Point de contrôle | Réf. | Valeur / réponse | C | P | NC | N/A | Observations) ou lignes en cartes
 *   < 1100 px (quatre gros boutons C / P / NC / N/A), encadrés
 *   (observations, notes, photos, conclusion) et pied de page ; la feuille 1 est la fiche station de
 *   js/views/station-sheet.js (import dynamique, repli si indisponible) avec les « Repères terrain » saisissables.
 * Remplissage automatique (js/domain/links.js) : valeur reprise d'une autre feuille marquée « repris de F… » (modifiable,
 * jamais une saisie écrasée ; « repris de la fiche station » pour les informations du référentiel) ; valeur proposée
 * (« Proposé (…) : … », bouton ; un bouton par choix quand plusieurs valeurs sont possibles) quand la cible a été saisie,
 * validée ou est restée en retard sur sa source, ou pour les liens « proposés » (heures, coordonnées, température, accès,
 * supports, lot / marché, effectif, sondes et calibration) ; feuilles d'une station suivante : « Reprendre les réponses
 * de la station précédente » (points vides seulement, confirmation, reprises marquées « repris de la station n ») ;
 * onglet Infos : heures de début / fin rapprochées de F2.1.5 / F2.1.6 (auditTimeTexts).
 * Coordonnées X / Y : « UTM 22N (RGFG95) » ou « UTM 21N » (converties en 22N, saisie d'origine conservée).
 * Preuves : « Prendre une photo » (appareil photo de la tablette), « Importer depuis la galerie » (date de prise de vue
 * reprise de la photo) et « Joindre un document » — boutons libellés dans les cartes et les encadrés, bouton « Ajouter
 * une preuve » ouvrant ces trois choix dans les lignes de tableau.
 * NOTE SUR 20 (js/domain/grading.js) : badge « Majeur (×2) » des points majeurs (lignes et cartes) ; encadré « Grille de
 * notation » en pied de chaque feuille cotée (C, P, NC, N/A, évalués, points, note /20, appréciation colorée) ; synthèse :
 * note de la tournée (figée à la signature, recalculée, calculée ou provisoire), colonne « Note /20 » par station et par
 * feuille.
 * Saisie enregistrée à chaque changement (handlers de js/views/audit.js et sheetHandlers ci-dessous) ; un nouvel
 * appui sur le statut choisi l'annule ; observation obligatoire pour P et NC (contrôle avant clôture) ; critères
 * « Commun à la tournée » : une seule réponse partagée par toutes les stations (identifiant sans « @ »).
 * Lecture seule si l'audit est verrouillé (sauf modification motivée en cours). */
import { html, raw, fmtDate, fmtTime, fmtDateTime, normalize, sortBy } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, promptDialog, confirmDialog, openModal } from '../ui/dom.js';
import { kv, badge, thumbs, auditBadge, critBadge, deviationBadge, empty, operatorName, providerName, kindBadge, voiceBtn, progressBar, mediaInputs } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { themeVars } from '../ui/themes.js';
import { getPosition, positionXY } from '../ui/gps.js';
import { addFilesFromInput } from '../ui/capture.js';
import {
  oegHeader, stationBanner, infoStrip, sectionCard, blockCard, checkSquare, sheetFooter, sheetFrame, STATUS_SCALE, statusHeadCells,
  statusLegend, sharedBadge, tourStations, assetURL, majorBadge, gradeBox, gradePill
} from '../ui/sheet-chrome.js';
import { isMajorItem, GRADE_STATES, thresholdsText } from '../domain/grading.js';
import { RESPONSES, itemInput, fieldShown, SHEET_CONCLUSIONS, CODE_TYPES, auditDate, formatValue, auditKindLabel, auditTimeTexts } from '../domain/model.js';
import {
  isSheetGrid, isAnswered, allowedResponses, needsJustification, sectionHeaders, sheetStoreKey, suggestedValue, groupSheets, isEnteredResponse, stationKeyOf,
  orderedParts, partsText, partLabel
} from '../domain/grids.js';
import { calibrationStatus } from '../domain/rules.js';
import { agentInitials } from '../domain/permissions.js';
import {
  addStation, removeStation, updateSheet, setResponse, auditMedia, auditTypeOf, stationLabel, tourControllers, tourAgents, entriesByAgent, canJoinAudit,
  joinTour, addController, removeController, linkExtra, previousStationPlan, copyPreviousStation, auditState, setStationParts, stationPartsOf
} from '../app/audits.js';
import { linkProposal, sourceInfo, LINK_GROUPS } from '../domain/links.js';
import { alertBox, documentsCard, signaturesStep, deviationChips, findItem, allowClear, cancelTourButton, cancelTourBlock, cancelledBanner, tourOperatorsCard, openOperatorForm } from './audit-modules.js';
import { setTourOperator } from '../app/operators.js';
import { SRS, srsOf, entryOf, withXYEntry, withSrs, withGpsReading, convertedText, coordIssues, fmtMeters } from '../domain/coords.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const optVal = o => (o && typeof o === 'object' ? o.value : o);
const optLab = o => (o && typeof o === 'object' ? (o.label ?? o.value) : o);
const blankStr = v => v === undefined || v === null || String(v).trim() === '';
/** Nombre affiché avec la virgule décimale (saisie acceptée avec virgule ou point). */
const numText = v => (typeof v === 'number' ? String(v).replace('.', ',') : v ?? '');
const FIXED = {
  ecarts: { label: 'Écarts', icon: 'warning' }, synthese: { label: 'Synthèse', icon: 'chart' },
  signatures: { label: 'Signatures', icon: 'signature' }, infos: { label: 'Infos', icon: 'info' }
};
const OPT_CLS = { C: 'ok', P: 'p', NC: 'nc', NA: 'na' };
/** Zones de texte libre (observations, encadrés, bilan) : enregistrement différé pendant la frappe (data-autosave,
 * js/ui/dom.js), sauf sur un audit signé (une modification motivée est enregistrée quand le champ est quitté). */
const autosave = c => (c.editable && !c.locked ? raw('data-autosave') : '');

/** Dernière station affichée par audit (sélecteur de stations, onglets des étapes fixes). */
const lastStation = new Map();
/** Dernier défilement automatique vers un critère (lien « ?item= ») : une seule fois par adresse. */
let lastScrolled = '';

/* ---------- Fiche station (js/views/station-sheet.js, chargée dynamiquement) ---------- */
let SS = null;
/** Module de la fiche station ou null s'il est indisponible (l'écran d'audit affiche alors un repli). */
export async function loadStationSheet() {
  if (SS) return SS;
  try { SS = await import('./station-sheet.js'); } catch (e) { console.warn('Fiche station indisponible :', e); SS = null; }
  return SS;
}

/** L'audit utilise-t-il une grille « en feuilles » ? */
export const isSheetAudit = audit => isSheetGrid(audit?.gridSnapshot);

/* ---------- Étapes ---------- */
const sheetStep = sh => 'feuille-' + sh.instanceKey;
/**
 * Modèle de navigation : groupes (feuilles de tournée, feuilles par station), ordre linéaire des étapes (F2, puis
 * les feuilles de chaque station dans l'ordre de passage, puis Écarts, Synthèse, Signatures), table critère →
 * instance de feuille (première feuille affichant le critère).
 */
function navModel(st) {
  const groups = groupSheets(st.sheets);
  const linear = [...groups.tournee, ...groups.stations.flatMap(g => g.sheets)];
  const itemSheet = new Map();
  for (const sh of linear) for (const it of sh.items) if (!itemSheet.has(it.id)) itemSheet.set(it.id, sh.instanceKey);
  const order = [...linear.map(sheetStep), 'ecarts', 'synthese', 'signatures'];
  return { groups, linear, itemSheet, order, all: [...order, 'infos'] };
}
/** Étape par défaut : 1re feuille station d'une tournée vierge, sinon 1re feuille incomplète ; terminée : Signatures. */
function defaultStep(audit, st, model) {
  if (audit.status !== 'en_cours') return 'signatures';
  if (!Object.values(audit.responses || {}).some(isEnteredResponse)) {
    const f1 = model.linear.find(sh => sh.layout === 'station');
    if (f1) return sheetStep(f1);
  }
  const next = model.linear.find(sh => (st.sheetProgress[sh.instanceKey]?.missingRequired || 0) > 0);
  return next ? sheetStep(next) : 'synthese';
}
/** Lien vers un critère (contrôle avant clôture, synthèse) : feuille qui l'affiche + défilement. */
function itemHref(audit, model, itemId) {
  const key = model.itemSheet.get(itemId);
  return key ? `#/audit/${audit.id}/feuille-${key}?item=${encodeURIComponent(itemId)}` : `#/audit/${audit.id}/signatures`;
}
/** Liens des points du contrôle avant clôture (issue → adresse de la feuille du critère), pour un état st = auditState(audit). */
export function issueHrefFor(audit, st) {
  const model = navModel(st);
  return e => itemHref(audit, model, e.itemId);
}

/* ---------- Reprises d'une autre feuille (js/domain/links.js) ---------- */
/** Critères pouvant recevoir une valeur reprise ou proposée (identifiants de base). */
const LINK_TARGETS = new Set(LINK_GROUPS.flatMap(g => g.to));
/** Source d'une valeur reprise, en clair : « F2.1.9 (Conditions météo) ». */
const fromText = (c, id) => sourceInfo(id, c.linkItems).text;
/** Marque « repris de F… » (valeur reprise d'une autre feuille) ou « repris de la station n » (reprise demandée). */
function fromBadge(c, it) {
  const r = c.audit.responses?.[it.id];
  if (r?.copiedFrom) {
    const st = c.stations.find(x => x.key === r.copiedFrom.stationKey);
    return html`<span class="as-from is-copy" title="Statut et observation repris de la station ${st ? st.index + 1 : ''} (${st?.name || r.copiedFrom.stationKey}) par ${r.copiedFrom.byName || ''} — à vérifier, modifiable">${icon('refresh', { size: 13 })}repris de la station ${st ? st.index + 1 : r.copiedFrom.stationKey}</span>`;
  }
  if (!r?.prefilled || !r.from || blankStr(typeof r.value === 'object' ? Object.values(r.value || {}).join('') : r.value)) return '';
  return html`<span class="as-from" title="Repris de ${fromText(c, r.fromId)} — à vérifier sur place, modifiable">${icon('link', { size: 13 })}repris de ${sourceInfo(r.fromId, c.linkItems).short || r.from}</span>`;
}
/** Bouton « Proposé : … » d'une valeur liée (jamais appliquée seule ; action link-take). */
function linkSuggest(c, it) {
  if (!c.editable || !LINK_TARGETS.has(it.baseId || it.id)) return '';
  const p = linkProposal({ items: c.linkItems, responses: c.audit.responses || {}, item: it, extra: c.linkExtra });
  if (!p) return '';
  const title = `Valeur ${p.mode === 'suggest' ? 'proposée' : 'de la source'} : ${fromText(c, p.fromId)} — non appliquée automatiquement`;
  // Plusieurs valeurs possibles (liste de choix : moyens d'accès de plusieurs stations…) : un bouton par valeur.
  if (p.choices) return html`<span class="as-link-choices" title="${title}"><span class="as-link-k">${icon('refresh', { size: 15 })}Proposé (${p.from}) :</span> ${p.choices.map((v, i) => html`<button type="button" class="as-suggest as-link-suggest" data-act="link-take" data-item="${it.id}" data-choice="${i}" title="${title}"><b>${formatValue(it, v) || String(v)}</b></button>`)}</span>`;
  const shown = formatValue(it, p.value) || String(p.value);
  return html`<button type="button" class="as-suggest as-link-suggest" data-act="link-take" data-item="${it.id}" title="${title}">${icon('refresh', { size: 15 })}<span class="as-link-k">Proposé (${p.from}) :</span> <b>${shown}</b></button>`;
}

/* ---------- Champs de saisie ---------- */
/** Champ « Valeur / réponse » d'un critère. pfx : 't' (tableau), 'k' (carte), 'r' (repères) — identifiants uniques. */
function valueControl(c, it, pfx) {
  const r = c.audit.responses?.[it.id];
  const v = r?.value;
  const input = itemInput(it);
  const dis = c.editable ? '' : raw('disabled');
  const id = `${pfx}-${it.id}`;
  const pre = r?.prefilled && !blankStr(v) ? raw(` class="is-prefilled" title="${r.from ? `Repris de ${String(fromText(c, r.fromId)).replace(/"/g, '&quot;')} — modifiable` : 'Valeur pré-remplie : à vérifier sur place'}"`) : '';
  if (!input) return html`<span class="as-novalue" aria-hidden="true"></span>`;
  const sug = it.suggest ? suggestedValue(it, c.audit.responses || {}) : '';
  const suggest = sug && sug !== v && c.editable ? html`<button type="button" class="as-suggest" data-act="suggest" data-item="${it.id}" data-value="${sug}" title="Valeur proposée (non appliquée automatiquement)">${icon('refresh', { size: 15 })}Proposé : <b>${sug}</b></button>` : '';
  const label = it.label;
  switch (input.type) {
    case 'number':
      return html`<span class="st-fields"><span class="st-field"><input id="${id}"${pre} type="text" inputmode="decimal" value="${numText(v)}" data-change="val" data-num data-item="${it.id}" aria-label="${label}" placeholder="${input.placeholder || ''}" ${dis}>${input.unit ? html`<span class="st-unit">${input.unit}</span>` : ''}</span></span>${suggest}`;
    case 'date':
      return html`<span class="as-inline"><input id="${id}"${pre} type="date" value="${v ?? ''}" data-change="val" data-item="${it.id}" aria-label="${label}" ${dis}>${c.editable && pfx !== 't' ? html`<button type="button" class="as-now" data-act="now" data-kind="date" data-item="${it.id}" title="Date du jour">${icon('calendar', { size: 16 })}<span>Aujourd’hui</span></button>` : ''}</span>`;
    case 'time':
      return html`<span class="as-inline"><input id="${id}"${pre} type="time" value="${v ?? ''}" data-change="val" data-item="${it.id}" aria-label="${label}" ${dis}>${c.editable ? html`<button type="button" class="as-now" data-act="now" data-kind="time" data-item="${it.id}" title="Heure actuelle">${icon('clock', { size: 16 })}<span>Maintenant</span></button>` : ''}</span>`;
    case 'select': {
      const opts = input.options || [];
      return html`<select id="${id}"${pre} data-change="val" data-item="${it.id}" aria-label="${label}" ${dis}><option value=""></option>${opts.map(o => html`<option value="${optVal(o)}" ${String(optVal(o)) === String(v ?? '') ? raw('selected') : ''}>${optLab(o)}</option>`)}${!blankStr(v) && !opts.some(o => String(optVal(o)) === String(v)) ? html`<option selected>${v}</option>` : ''}</select>`;
    }
    case 'longtext':
      return html`<textarea id="${id}"${pre} rows="${pfx === 't' ? 1 : 2}" data-change="val" data-item="${it.id}" aria-label="${label}" placeholder="${input.placeholder || ''}" ${dis}>${v ?? ''}</textarea>`;
    case 'fields':
      return fieldsControl(c, it, input, v, pfx, dis);
    default:
      return html`<input id="${id}"${pre} value="${isObj(v) ? '' : v ?? ''}" data-change="val" data-item="${it.id}" aria-label="${label}" placeholder="${input.placeholder || ''}" autocomplete="off" ${dis}>${suggest}`;
  }
}

/**
 * Groupe de champs (valeur objet) : cases exclusives, champs conditionnels (showIf), relevé GPS → X / Y RGFG95.
 * Groupe X / Y (`gps`) : choix du système « UTM 22N (RGFG95) » (défaut) ou « UTM 21N » ; en 21N, les champs X / Y
 * éditent la saisie d'origine (x21 / y21) et la conversion en UTM 22N (valeur enregistrée) est affichée dessous ;
 * contrôle de cohérence (coordonnées d'UTM 21N saisies en 22N, point hors de la Guyane) : js/domain/coords.js.
 */
function fieldsControl(c, it, input, v, pfx, dis) {
  const obj = isObj(v) ? v : {};
  const srs = input.gps ? srsOf(obj) : '22N';
  const entry = input.gps ? entryOf(obj) : null;
  const xyKey = f => input.gps && (f.key === 'x' || f.key === 'y');
  const parts = (input.fields || []).filter(f => fieldShown(f, obj)).map(f => {
    const fid = `${pfx}-${it.id}-${f.key}`;
    if (f.type === 'choice') {
      const choice = html`<span class="st-choice" role="group" aria-label="${f.label || it.label}">${(f.options || []).map(o => {
        const on = String(obj[f.key] ?? '') === String(optVal(o));
        return html`<button type="button" class="${on ? 'sel' : ''}" aria-pressed="${on}" data-act="fchoice" data-item="${it.id}" data-key="${f.key}" data-value="${optVal(o)}" ${dis}>${checkSquare({ checked: on })}${optLab(o)}</button>`;
      })}</span>`;
      return f.label ? html`<span class="st-field is-choice"><span class="st-k">${f.label}&nbsp;:</span>${choice}</span>` : choice;
    }
    const type = f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text';
    const num = f.type === 'number';
    const val = xyKey(f) ? entry[f.key] : obj[f.key];
    const lab = xyKey(f) ? `${f.label} (${srs === '21N' ? 'UTM 21N' : 'RGFG95 / UTM 22N'})` : f.label || it.label;
    return html`<span class="st-field${num ? ' is-num' : ''}">${f.label ? html`<label class="st-k" for="${fid}">${f.label}&nbsp;:</label>` : ''}<input id="${fid}" type="${type}" ${num ? raw('inputmode="decimal" data-num') : ''} ${xyKey(f) ? raw('data-xy') : ''} value="${num ? numText(val) : val ?? ''}" placeholder="${f.placeholder || ''}" data-change="fval" data-item="${it.id}" data-key="${f.key}" aria-label="${lab}" autocomplete="off" ${dis}>${f.unit && !f.unitKey ? html`<span class="st-unit">${f.unit}</span>` : ''}</span>`;
  });
  if (!input.gps) return html`<span class="st-fields">${parts}</span>`;
  const sid = `${pfx}-${it.id}-srs`;
  const srsSel = html`<span class="st-field is-srs"><label class="st-k" for="${sid}">Système&nbsp;:</label><select id="${sid}" class="st-srs" data-change="fsrs" data-item="${it.id}" aria-label="Système de coordonnées — ${it.label}" title="Coordonnées enregistrées en RGFG95 / UTM 22N ; une saisie en UTM 21N est convertie" ${dis}>${Object.entries(SRS).map(([k, l]) => html`<option value="${k}" ${k === srs ? raw('selected') : ''}>${l}</option>`)}</select></span>`;
  const conv = srs !== '21N' ? '' : convertedText(obj) ? html`<span class="as-xy-conv" title="Valeur enregistrée (convertie depuis l’UTM 21N)">→ RGFG95 / UTM 22N : <span>X ${fmtMeters(obj.x)}</span> · <span>Y ${fmtMeters(obj.y)}</span></span>`
    : html`<span class="as-xy-conv is-pending">→ conversion en RGFG95 / UTM 22N dès que X et Y sont saisis</span>`;
  const warn = coordIssues(obj).map(w => html`<span class="as-xy-warn" role="note">${icon('warning', { size: 15 })}${w.message}</span>`);
  const gps = html`${c.editable ? html`<button type="button" class="st-gps" data-act="gps-fill" data-item="${it.id}" title="Relever la position GPS de l’appareil (X / Y RGFG95 / UTM 22N)">${icon('pin')}<span>Relever${pfx === 't' ? '' : ' la position'}</span></button>` : ''}
    ${obj.lat !== undefined && obj.at ? html`<span class="as-gps-meta" title="${Number(obj.lat).toFixed(6)}, ${Number(obj.lon).toFixed(6)} (WGS84)">Relevé GPS ${fmtTime(obj.at)}${obj.accuracy ? ` · ±${Math.round(obj.accuracy)} m` : ''}</span>` : ''}`;
  return html`<span class="st-fields is-xy">${srsSel}${parts}${gps}${conv}${warn}</span>`;
}

/** Bouton de statut (tableau : case carrée ; carte : gros bouton). */
function statusButton(c, it, s, cur, pfx) {
  const on = cur === s.code;
  const dis = c.editable ? '' : raw('disabled');
  const common = raw(`id="${pfx}-s${s.cls}-${it.id}" aria-pressed="${on}" title="${s.label}" data-act="resp" data-item="${it.id}" data-value="${s.code}"`);
  return pfx === 't'
    ? html`<button type="button" class="st-chk${on ? ' sel' : ''}" ${common} aria-label="${s.label} — ${it.label}" ${dis}>${checkSquare({ checked: on })}<span class="st-chk-l">${s.short}</span></button>`
    : html`<button type="button" class="st-rc-btn ${s.cls}${on ? ' sel' : ''}" ${common} aria-label="${s.label}" ${dis}>${s.short}</button>`;
}
/** Zone « Observations » : obligatoire (et signalée) pour P et NC. */
function obsField(c, it, r, pfx) {
  const need = needsJustification(it, r);
  const empty = need && blankStr(r?.comment);
  const dis = c.editable ? '' : raw('disabled');
  return html`<textarea ${autosave(c)} id="${pfx}-o-${it.id}" class="as-obs${empty ? ' need' : ''}" rows="${pfx === 't' ? 1 : 2}" data-change="comment" data-item="${it.id}" data-need="${need ? '1' : ''}" aria-label="Observations — ${it.label}" placeholder="${need ? 'Observation obligatoire (constat factuel)' : pfx === 't' ? '' : 'Constat, précision…'}" ${dis}>${r?.comment || ''}</textarea>`;
}
/** UN seul bouton d'aide par point (demande de l'OEG : pas de description en double) : critère de la grille CT-2026 ⇒
 * fenêtre « Aide et attendu » (attendu du prestataire, vérification, cotation C / P / NC / N/A, puis l'aide de la grille
 * — points des fiches d'évaluation inclus, origine — : js/views/attendus.js) ; autre grille en feuilles ⇒ aide seule. */
const hasAttendu = it => /^it-F\d+-/.test(it.id);
const attenduButton = it => hasAttendu(it) ? html`<button type="button" class="as-help as-attendu" data-act="item-attendu" data-item="${it.id}" title="Aide et attendu du prestataire (cotation C / P / NC / N/A)" aria-label="Aide et attendu : ${it.label}">${icon('info', { size: 17 })}</button>` : '';
const helpButton = it => !hasAttendu(it) && (it.help || it.refs?.length) ? html`<button type="button" class="as-help" data-act="item-help" data-item="${it.id}" title="${it.help || 'Références'}" aria-label="Aide : ${it.label}">${icon('info', { size: 17 })}</button>` : '';
function rowClass(c, it, r) {
  const s = r?.status;
  const conf = it.kind === 'conformity';
  return [s === 'NC' ? 'is-nc' : s === 'P' ? 'is-p' : s === 'C' ? 'is-c' : s === 'NA' ? 'is-na' : conf && !isAnswered(it, r) ? 'is-missing' : '',
    it.shared ? 'is-shared' : '', r?.prefilled && !r?.status ? 'is-prefilled' : ''].filter(Boolean).join(' ');
}
/** Ajout de preuves d'un critère ou d'un encadré : « Prendre une photo », « Importer depuis la galerie » (et « Joindre un
 * document ») — boutons libellés distincts (cartes, encadrés : js/ui/components.js, mediaInputs). */
const proofInputs = (c, link, opts = {}) => mediaInputs(link, { auditId: c.audit.id, ...opts });
/** Ligne de tableau (place comptée) : un bouton « Ajouter une preuve » qui ouvre les trois choix (action proof-menu). */
const proofButton = it => html`<button type="button" class="as-tool as-proof" data-act="proof-menu" data-item="${it.id}" title="Ajouter une preuve : prendre une photo, importer depuis la galerie ou joindre un document" aria-label="Ajouter une preuve — ${it.label}">${icon('camera', { size: 18 })}<span class="as-plus" aria-hidden="true">+</span></button>`;

/* ---------- Lignes (tableau ≥ 1100 px) ---------- */
function tableRow(c, it, o) {
  const r = c.audit.responses?.[it.id];
  const conf = it.kind === 'conformity';
  const allowed = allowedResponses(it);
  const media = c.mediaByItem.get(it.id) || [];
  const devs = c.devsByItem.get(it.id) || [];
  const alerts = c.st.alerts.filter(a => a.itemId === it.id);
  const tools = c.editable ? html`<span class="as-tools">${!c.locked ? proofButton(it) : ''}${media.length ? html`<span class="as-count" title="${media.length} preuve(s)">${media.length}</span>` : ''}
    ${(r?.status === 'NC' || r?.status === 'P') && can('deviation.manage') ? html`<button type="button" class="as-tool ${r.status === 'NC' ? 'nc' : 'p'}" data-act="dev-new" data-item="${it.id}" title="Créer un écart (${r.status === 'NC' ? 'non-conformité' : 'piste d’amélioration'})">${icon('warning', { size: 18 })}</button>` : ''}</span>` : '';
  const sub = alerts.length || media.length || devs.length ? html`<tr class="as-sub"><td colspan="${o.cols}"><div class="as-sub-in">${alerts.map(a => alertBox(a, c.editable))}${thumbs(media)}${devs.length ? deviationChips(c.audit, it.id, devs) : ''}</div></td></tr>` : '';
  return html`<tr id="row-${it.id}" class="${rowClass(c, it, r)}">
    ${o.noCol ? html`<td class="c-no">${o.pills ? html`<span class="st-no">${it.no}</span>` : it.no}</td>` : ''}
    <td class="c-label">${it.icon ? html`<span class="st-ic">${icon(it.icon)}</span>` : ''}<span class="as-lbl">${it.label}</span>${it.shared ? sharedBadge() : ''}${conf && isMajorItem(it, c.scoring) ? majorBadge() : ''}${helpButton(it)}${attenduButton(it)}</td>
    ${o.hasShort ? html`<td class="c-short">${it.short || ''}</td>` : ''}
    <td class="c-value">${valueControl(c, it, 't')}${linkSuggest(c, it)}${fromBadge(c, it)}</td>
    ${o.full ? STATUS_SCALE.map(s => html`<td class="c-${s.cls}">${conf && allowed.includes(s.code) ? statusButton(c, it, s, r?.status, 't') : ''}</td>`) : ''}
    ${o.full ? html`<td class="c-obs"><div class="as-obs-cell">${obsField(c, it, r, 't')}${tools}</div></td>` : ''}
  </tr>${sub}`;
}

/* ---------- Lignes en cartes (< 1100 px) ---------- */
function itemCard(c, it, o) {
  const r = c.audit.responses?.[it.id];
  const conf = it.kind === 'conformity';
  const allowed = allowedResponses(it);
  const media = c.mediaByItem.get(it.id) || [];
  const devs = c.devsByItem.get(it.id) || [];
  const alerts = c.st.alerts.filter(a => a.itemId === it.id);
  const need = needsJustification(it, r);
  const hd = o.headers;
  return html`<article id="card-${it.id}" class="st-row-card ${rowClass(c, it, r)}">
    <div class="st-rc-head"><span class="st-rc-no">${it.no}</span>${it.icon ? html`<span class="st-rc-ic">${icon(it.icon)}</span>` : ''}<span class="st-rc-label">${it.label}${it.required && conf ? html` <span class="req" title="obligatoire">*</span>` : ''}${it.shared || (conf && isMajorItem(it, c.scoring)) ? html`<br>${it.shared ? sharedBadge() : ''}${conf && isMajorItem(it, c.scoring) ? majorBadge() : ''}` : ''}</span>${it.short && it.short !== it.no ? html`<span class="st-rc-short">${it.short}</span>` : ''}${helpButton(it)}${attenduButton(it)}</div>
    ${itemInput(it) ? html`<div class="st-rc-value"><span class="st-rc-k">${hd.value}</span>${valueControl(c, it, 'k')}${linkSuggest(c, it)}${fromBadge(c, it)}</div>` : r?.copiedFrom ? html`<div class="st-rc-value">${fromBadge(c, it)}</div>` : ''}
    ${conf ? html`<div class="st-rc-status" role="group" aria-label="Statut — ${it.label}">${STATUS_SCALE.filter(s => allowed.includes(s.code)).map(s => statusButton(c, it, s, r?.status, 'k'))}</div>` : ''}
    ${o.full ? html`<div class="st-rc-obs"><label class="st-rc-k" for="k-o-${it.id}">Observations${need ? html` <span class="req">(obligatoire)</span>` : ''}</label><div class="input-wrap">${obsField(c, it, r, 'k')}${c.editable ? voiceBtn('k-o-' + it.id) : ''}</div></div>` : ''}
    ${alerts.map(a => alertBox(a, c.editable))}
    ${thumbs(media)}
    ${c.editable && o.full ? html`<div class="st-rc-tools">${!c.locked ? proofInputs(c, { type: 'item', id: c.audit.id, itemId: it.id }, { cls: 'btn ghost sm as-file', document: true }) : ''}
      ${(r?.status === 'NC' || r?.status === 'P') && can('deviation.manage') ? html`<button type="button" class="btn ${r.status === 'NC' ? 'danger-ghost' : 'perf'} sm" data-act="dev-new" data-item="${it.id}"><span class="ic">${icon('warning')}</span>Écart</button>` : ''}</div>` : ''}
    ${devs.length ? deviationChips(c.audit, it.id, devs) : ''}
    ${r?.at && !r.prefilled ? html`<div class="st-rc-meta">Saisi le ${fmtDate(r.at)} à ${fmtTime(r.at)} par ${r.byName || ''}${media.length ? ` · ${media.length} preuve(s)` : ''}</div>` : r?.prefilled && r.from ? html`<div class="st-rc-meta">Repris de ${fromText(c, r.fromId)} — à vérifier sur place, modifiable.</div>` : r?.prefilled ? html`<div class="st-rc-meta">Valeur pré-remplie à la création de la tournée — à vérifier sur place.</div>` : ''}
  </article>`;
}

/** Tableau (≥ 1100 px) + cartes (< 1100 px) d'une ou plusieurs sections (fusionnées : F5, mergeSections). */
function itemsBlock(c, sh, sections, { boxed = false, noCol = true, merged = false } = {}) {
  const items = sections.flatMap(s => s.items);
  if (!items.length) return '';
  const headers = sectionHeaders(sections[0]);
  const full = sections.some(s => s.columns !== 'value');
  const hasShort = items.some(x => x.short && x.short !== x.no);
  const o = { full, hasShort, noCol, pills: headers.no === '#', headers, cols: (noCol ? 1 : 0) + 2 + (hasShort ? 1 : 0) + (full ? 5 : 0) };
  // Sections fusionnées (F5) : les deux premières forment le tableau de la maquette ; les suivantes (ajouts de
  // l'avenant n° 1) sont précédées d'un intertitre.
  const groupTitle = (s, i) => merged && i >= 2 && s.title ? s.title : '';
  const rows = sections.map((s, i) => html`${groupTitle(s, i) ? html`<tr class="is-group"><td colspan="${o.cols}">${s.title}</td></tr>` : ''}${s.items.map(it => tableRow(c, it, o))}`);
  const cards = sections.map((s, i) => html`${groupTitle(s, i) ? html`<h4 class="as-group">${s.title}</h4>` : ''}${s.items.map(it => itemCard(c, it, o))}`);
  return html`<div class="st-wrap st-only-wide${boxed ? ' boxed' : ''}"><table class="st-table${full ? '' : ' is-value'}">
      <thead><tr>${noCol ? html`<th class="c-no" scope="col">${headers.no}</th>` : ''}<th class="c-label" scope="col">${headers.label}</th>${hasShort ? html`<th class="c-short" scope="col">${headers.short}</th>` : ''}<th class="c-value" scope="col">${splitParen(headers.value)}</th>${full ? statusHeadCells() : ''}${full ? html`<th class="c-obs" scope="col">${splitParen(headers.obs)}</th>` : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="st-cards st-only-narrow">${cards}</div>`;
}
const splitParen = s => { const t = String(s || ''), k = t.indexOf(' ('); return k > 0 ? html`${t.slice(0, k)} <small>${t.slice(k + 1)}</small>` : t; };

/* ---------- Modules et encadrés ---------- */
/** Appareils de mesure de F4 (donnée de TOURNÉE : audit.sheets['4'].instruments) + agents du prestataire (station). */
function instrumentsModule(c, sh) {
  const key = sheetStoreKey(sh, 'instruments');
  const data = c.audit.sheets?.[key]?.instruments || {};
  const dis = c.editable ? '' : raw('disabled');
  const maxDays = Number(c.baseGrid?.settings?.calibrationMaxDays) || 30;
  const idFields = sh.instrumentFields || [{ key: 'model', label: 'Marque / modèle', type: 'text' }, { key: 'serial', label: 'N° de série', type: 'text' }, { key: 'calibration', label: 'Dernière calibration', type: 'date' }];
  const calFields = sh.calibrationFields || [];
  const input = (ins, f) => {
    const val = data[ins.key]?.[f.key] ?? '';
    const id = `ins-${ins.key}-${f.key}`;
    if (f.type === 'choice') return html`<div class="as-kv is-choice"><span class="as-kv-k">${f.label}&nbsp;:</span><span class="st-choice">${((f.key === 'weekly' && ins.weeklyOptions) || f.options || []).map(o => { const on = String(val) === String(o); return html`<button type="button" class="${on ? 'sel' : ''}" aria-pressed="${on}" data-act="instr-choice" data-sheet="${key}" data-ins="${ins.key}" data-k="${f.key}" data-value="${o}" ${dis}>${checkSquare({ checked: on })}${o}</button>`; })}</span></div>`;
    return html`<div class="as-kv"><label class="as-kv-k" for="${id}">${f.label}&nbsp;:</label><input id="${id}" class="st-input" type="${f.type === 'date' ? 'date' : 'text'}" value="${val}" placeholder="${f.key === 'standards' ? ins.standards || f.placeholder || '' : f.placeholder || ''}" data-change="instr" data-sheet="${key}" data-ins="${ins.key}" data-k="${f.key}" autocomplete="off" ${dis}></div>`;
  };
  const cards = (sh.instruments || []).map(ins => {
    const cal = calibrationStatus(data[ins.key]?.calibration, c.date, maxDays);
    const alert = c.st.alerts.find(a => a.key === `CALIBRATION:${sh.no}:${ins.key}`);
    const filled = calFields.some(f => !blankStr(data[ins.key]?.[f.key]));
    return sectionCard({
      no: ins.badge || '', icon: ins.badge ? '' : ins.icon || 'gauge', title: ins.label, cls: 'as-ins',
      body: html`<div class="as-kvs">${idFields.map(f => input(ins, f))}</div>
        ${!cal.ok ? html`<p class="as-cal-warn">${icon('warning', { size: 16 })}${cal.reason}</p>` : ''}
        ${calFields.length ? html`<details class="as-cal" ${c.type !== 'bio' || filled ? raw('open') : ''}><summary>Étalonnage et vérifications</summary><div class="as-kvs">${calFields.map(f => input(ins, f))}</div></details>` : ''}
        ${alert && alert.deviation && c.editable && can('deviation.manage') ? html`<div class="row" style="gap:6px;margin-top:6px"><button class="btn sm danger-ghost" data-act="alert-dev" data-key="${alert.key}">Créer un écart</button><button class="btn sm ghost" data-act="alert-dismiss" data-key="${alert.key}">Ne pas retenir</button></div>` : ''}`
    });
  });
  const agentsKey = sheetStoreKey(sh, 'agents');
  return html`<div class="as-module">
    <div class="as-module-title"><span class="bc-ic">${icon('wrench')}</span><span>Appareils de mesure (in situ)</span>${c.multi ? sharedBadge() : ''}</div>
    <div class="as-instr">${cards}
      ${sectionCard({ icon: 'people', title: 'Agent(s) prestataire(s) / fonction', cls: 'as-ins', body: html`<textarea ${autosave(c)} id="sheet-${agentsKey}-agents" class="as-lined${c.audit.sheets?.[agentsKey]?.agentsFrom ? ' is-prefilled' : ''}" rows="3" data-change="sheet-text" data-sheet="${agentsKey}" data-k="agents" aria-label="Agent(s) prestataire(s) / fonction" ${dis}>${c.audit.sheets?.[agentsKey]?.agents || ''}</textarea>
        ${c.audit.sheets?.[agentsKey]?.agentsFrom && c.audit.sheets[agentsKey].agents ? html`<span class="as-from" title="Repris de ${c.audit.sheets[agentsKey].agentsFrom} (Opérateurs du prestataire de la station) — modifiable">${icon('link', { size: 13 })}repris de ${c.audit.sheets[agentsKey].agentsFrom}</span>` : ''}` })}</div>
  </div>`;
}

/** Contrôleur, date et signatures d'un encadré « conclusion » : affichés depuis l'audit (une signature scelle tout). */
function signatureView(sig) {
  if (!sig) return html`<div class="bc-sign"></div>`;
  if (sig.refused) return html`<div class="bc-sign as-refused">Refus / absence de signature${sig.comment ? html`<small>${sig.comment}</small>` : ''}</div>`;
  return html`<div class="bc-sign">${sig.mediaId ? html`<img data-media="${sig.mediaId}" alt="Signature de ${sig.name || ''}">` : html`<span>${sig.name || ''}</span>`}</div>`;
}
function conclusionBody(c, sh, b) {
  const key = sheetStoreKey(sh, 'conclusion');
  const concl = c.audit.sheets?.[key]?.conclusion || {};
  const dis = c.editable ? '' : raw('disabled');
  const fields = b.fields || ['controller', 'date', 'signature'];
  const summary = c.st.summary.sheets.find(x => x.instanceKey === sh.instanceKey);
  const date = c.date;
  const sig = c.audit.signatures || {};
  const opts = b.options || Object.entries(SHEET_CONCLUSIONS);
  return html`<div class="bc-options" role="group" aria-label="${b.title}">${opts.map(([k, l]) => html`<button type="button" class="bc-option${concl.status === k ? ' sel' : ''}" aria-pressed="${concl.status === k}" data-act="sheet-concl" data-sheet="${key}" data-value="${k}" ${dis}>${checkSquare({ checked: concl.status === k, cls: OPT_CLS[k] || '' })}${l}</button>`)}</div>
    ${summary?.hint ? html`<p class="as-hint">${icon('info', { size: 15 })}Constat de la feuille : ${summary.hint}. <span>La conclusion reste le choix du contrôleur.</span></p>` : ''}
    ${fields.includes('comments') ? html`<div class="bc-field"><label class="bc-k" for="concl-${key}">Commentaires</label><textarea ${autosave(c)} id="concl-${key}" class="as-lined" rows="2" data-change="sheet-concl-text" data-sheet="${key}" placeholder="Justification de la conclusion (les constats détaillés vont dans les observations)" ${dis}>${concl.comments || ''}</textarea></div>` : ''}
    <div class="bc-fields">${fields.filter(f => f === 'controller' || f === 'date').map(f => html`<div class="bc-field"><span class="bc-k">${f === 'date' ? 'Date' : 'Nom du contrôleur OEG'}</span><span class="bc-v">${f === 'date' ? fmtDate(date) : c.controllersText}</span></div>`)}</div>
    ${fields.some(f => f === 'signature' || f === 'providerSignature') ? html`<div class="bc-fields">${fields.includes('signature') ? html`<div class="bc-field"><span class="bc-k">Signature du contrôleur</span>${signatureView(sig.auditor)}</div>` : ''}${fields.includes('providerSignature') ? html`<div class="bc-field"><span class="bc-k">Nom et signature du prestataire${sig.provider?.name ? ` : ${sig.provider.name}` : ''}</span>${signatureView(sig.provider)}</div>` : ''}</div>
      ${!sig.auditor ? html`<p class="note as-sign-note">Signature électronique unique de la tournée : onglet « Signatures ».</p>` : ''}` : ''}`;
}
function textBlock(c, sh, b) {
  const key = sheetStoreKey(sh, b.key);
  const dis = c.editable ? '' : raw('disabled');
  const media = b.key === 'photos' ? (c.mediaBySheet.get(key) || []) : [];
  // Texte d'invite propre à chaque encadré (grille : `placeholder`) : deux zones libres d'une même feuille (observations,
  // commentaires de la conclusion) ne demandent pas la même chose.
  return html`<textarea ${autosave(c)} id="sheet-${key}-${b.key}" class="as-lined" rows="4" data-change="sheet-text" data-sheet="${key}" data-k="${b.key}" aria-label="${b.title}" placeholder="${b.placeholder || ''}" ${dis}>${c.audit.sheets?.[key]?.[b.key] || ''}</textarea>
    ${b.key === 'photos' ? html`${thumbs(media)}${c.editable && !c.locked ? html`<div class="st-rc-tools">${proofInputs(c, { type: 'sheet', id: c.audit.id, itemId: key }, { cls: 'btn ghost sm as-file' })}</div>` : ''}` : ''}`;
}
function blocksArea(c, sh) {
  const blocks = sh.blocks || [];
  if (!blocks.length) return '';
  return html`<div class="sheet-blocks as-blocks">${blocks.map(b => blockCard({ icon: b.icon || 'chat', title: b.title, cls: `as-block as-b-${b.key}`, body: b.key === 'conclusion' ? conclusionBody(c, sh, b) : textBlock(c, sh, b) }))}</div>`;
}

/** Encadré « Grille de notation » d'une feuille (id gradeBox-<instance>) : note de la feuille et seuils de la tournée. */
function sheetGradeBox(c, sh) {
  const g = c.st.summary.sheets.find(x => x.instanceKey === sh.instanceKey)?.grade || null;
  const r = c.st.summary.grading;
  return gradeBox({ grade: g, thresholds: r?.thresholds, state: r?.state || '', id: `gradeBox-${sh.instanceKey.replace(/[^\w@.-]/g, '_')}`, scope: 'de la feuille' });
}

/* ---------- Feuilles ---------- */
/** En-têtes de la feuille : complet (≥ 900 px) et compact (< 900 px, une ligne). */
function sheetHeaders(c, sh, site, { variant = 'default', titleInBanner = false } = {}) {
  const base = { grid: c.baseGrid, sheet: titleInBanner ? { ...sh, title: '' } : sh, title: c.st.header?.title || '', subtitle: c.st.header?.subtitle || '', index: sh.index, total: sh.total,
    stationIndex: sh.station ? sh.station.index + 1 : null, stationTotal: c.stations.length || null };
  return html`<div class="as-hd as-hd-full">${oegHeader({ ...base, site: titleInBanner ? null : site, variant })}</div>
    <div class="as-hd as-hd-compact">${oegHeader({ ...base, sheet: sh, site, variant: 'compact' })}</div>`;
}
/** Feuille de tournée d'une tournée à plusieurs stations : stations visitées (ordre de passage), à la place du bandeau d'information. */
function tourStrip(c, sh) {
  return html`<div class="as-tourstrip">
    <div class="as-ts-head">${icon('route', { size: 22 })}<span>Tournée du ${fmtDate(c.date)}<small>${c.stations.length} stations · ${c.providerLabel}</small></span><span class="as-ts-sheet">Feuille <b>${sh.index}&nbsp;/&nbsp;${sh.total}</b></span></div>
    <ol class="as-ts-list">${c.stations.map(s => html`<li><b>${s.index + 1}</b><span class="as-ts-name">${s.name}</span><small>${CODE_TYPES[s.codeType] || 'Code'} ${s.code}${s.site?.commune ? ' · ' + s.site.commune : s.site?.bassin ? ' · ' + s.site.bassin : ''}</small></li>`)}</ol>
  </div>`;
}

/** Feuille 1 : fiche station (station-sheet.js) avec les « Repères terrain » saisissables. */
function reperesHTML(c, sh) {
  const items = sh.items;
  const short = items.filter(i => i.kind !== 'longtext'), long = items.filter(i => i.kind === 'longtext');
  return html`<div class="ss-rep as-rep">
    <div class="ss-rep-rows">${short.map(it => html`<div class="ss-rep-row as-rep-row ${rowClass(c, it, c.audit.responses?.[it.id])}" id="row-${it.id}"><label for="r-${it.id}">${it.label}&nbsp;:</label><div class="as-rep-v">${valueControl(c, it, 'r')}</div>${linkSuggest(c, it)}${fromBadge(c, it)}</div>`)}</div>
    ${long.map(it => html`<div class="ss-rep-long as-rep-long" id="row-${it.id}"><div class="ss-rep-row as-rep-row"><label for="r-${it.id}">${it.label}&nbsp;:</label></div><textarea id="r-${it.id}" class="as-lined" rows="3" data-change="val" data-item="${it.id}" placeholder="${it.placeholder || ''}" ${c.editable ? '' : raw('disabled')}>${c.audit.responses?.[it.id]?.value ?? ''}</textarea></div>`)}
  </div>`;
}
function stationSheetView(c, sh, site) {
  const reperes = reperesHTML(c, sh);
  const theme = sh.theme || 'ocean';
  const inner = c.SS && site
    ? c.SS.stationSheet({ site, grid: c.baseGrid, audit: c.audit, editable: c.editable && !c.locked && can('ref.manage'), reperes, variant: 'body', auditType: c.type,
      // Tournée mixte : variante, compartiments et périmètre propres aux parties contrôlées à cette station.
      parts: c.st.mixed && sh.station ? orderedParts(c.baseGrid, sh.station, c.type) : null })
    : html`${stationBanner({ site, kicker: sh.kicker || c.st.header?.program || '', theme, stationIndex: sh.station ? sh.station.index + 1 : null, stationTotal: c.stations.length || null })}
      ${infoStrip(site, { codeType: site?.codeType })}
      <p class="note">Fiche station détaillée (carte, photographies, accès) indisponible sur cet appareil.</p>
      ${sectionCard({ icon: 'edit', title: 'Repères terrain', body: reperes })}`;
  return sheetFrame({ theme, cls: 'as-frame layout-station is-portrait', body: html`${sheetHeaders(c, { ...sh, layout: 'station' }, site)}${inner}${sheetFooter({ grid: c.baseGrid })}` });
}

/** Feuilles en tableaux (F2 à F10) : composition des maquettes. */
function tableSheetView(c, sh, site) {
  const th = sh.theme || 'ocean';
  const secs = sh.sections.filter(s => s.items.length);
  const tour = !sh.station && c.multi;
  const withBanner = ['caracterisation', 'phyto'].includes(sh.key);
  const parts = [];
  if (withBanner) {
    const ph = sh.key === 'phyto' ? site?.photos?.AM : null;
    parts.push(sheetHeaders(c, sh, site, { titleInBanner: true }));
    parts.push(stationBanner({ site, kicker: sh.kicker || sh.title, theme: th, photo: ph?.src && !ph.mediaId ? assetURL(ph.src) : null, sheetNo: sh.index, sheetCount: sh.total,
      stationIndex: sh.station ? sh.station.index + 1 : null, stationTotal: c.stations.length || null }));
  } else parts.push(sheetHeaders(c, sh, tour ? null : site, { variant: sh.scope === 'tournee' ? 'band' : 'default' }));
  parts.push(tour ? tourStrip(c, sh) : infoStrip(site, { codeType: site?.codeType }));
  // Feuille d'une station suivante : reprise, à la demande, des réponses de la station précédente (points vides).
  if (sh.station && sh.station.index > 0 && c.editable && !c.locked && sh.items.some(i => i.kind === 'conformity')) {
    const plan = previousStationPlan(c.audit, sh.instanceKey);
    if (plan?.copies.length) parts.push(html`<div class="as-copyprev" id="copyPrev"><button type="button" class="btn ghost sm" data-act="copy-prev" data-sheet="${sh.instanceKey}"><span class="ic">${icon('refresh')}</span>Reprendre les réponses de la station précédente</button><span class="note">Station ${plan.prev.index + 1} — ${plan.prev.name} : ${plan.copies.length} point${plan.copies.length > 1 ? 's' : ''} encore vide${plan.copies.length > 1 ? 's' : ''} de cette feuille peu${plan.copies.length > 1 ? 'vent' : 't'} reprendre le statut et l’observation (confirmation demandée, modifiables ensuite).</span></div>`);
  }
  const sheetAlerts = c.st.alerts.filter(a => !a.itemId && String(a.sheet) === String(sh.no) && a.code !== 'CALIBRATION' && a.code !== 'REQUIRED_MISSING' && (!a.stationKey || a.stationKey === sh.stationKey));
  if (sheetAlerts.length) parts.push(html`<div>${sheetAlerts.map(a => alertBox(a, c.editable))}</div>`);
  // Feuille Organisation (F2) : préleveurs du prestataire présents pour la tournée, « Ajouter un opérateur ».
  if (sh.key === 'organisation') parts.push(tourOperatorsCard(c.audit, { editable: c.editable }));
  if ((sh.modules || []).includes('instruments')) parts.push(instrumentsModule(c, sh));
  if (sh.layout === 'split') {
    parts.push(html`<div class="sheet-split as-split">${secs.map(s => sectionCard({ no: s.no, title: s.title, icon: (s.icons || [s.icon]).filter(Boolean).join('+'), theme: s.theme || th, cls: 'big', kicker: s.kicker || '', body: itemsBlock(c, sh, [s], { noCol: false }) }))}</div>`);
  } else if (sh.scope === 'tournee') {
    // Feuille 2 : cartes deux par deux comme la maquette (la dernière, impaire, en pleine largeur).
    parts.push(html`<div class="as-cols2">${secs.map((s, i) => html`<div class="${i === secs.length - 1 && secs.length % 2 === 1 ? 'as-span' : ''}">${sectionCard({ no: s.no, icon: s.no ? '' : s.icon || 'clipboard', title: s.title, body: itemsBlock(c, sh, [s]) })}</div>`)}</div>`);
  } else if (sh.mergeSections && secs.length) {
    parts.push(itemsBlock(c, sh, secs, { boxed: true, merged: true }));
  } else if (secs.length > 1) {
    parts.push(html`<div class="as-stack">${secs.map(s => sectionCard({ no: s.no, icon: s.no ? '' : s.icon || 'clipboard', title: s.title, body: itemsBlock(c, sh, [s]) }))}</div>`);
  } else if (secs.length) {
    parts.push(itemsBlock(c, sh, secs, { boxed: true }));
  }
  if (sh.items.some(i => i.kind === 'conformity')) parts.push(statusLegend());
  parts.push(blocksArea(c, sh));
  // Grille de notation de la feuille (points affichés, communs à la tournée compris).
  if (sh.items.some(i => i.kind === 'conformity')) parts.push(sheetGradeBox(c, sh));
  parts.push(sheetFooter({ grid: c.baseGrid }));
  return sheetFrame({ theme: th, cls: `as-frame as-sheet-${sh.key}`, body: html`${parts}` });
}

/* ---------- Étapes fixes ---------- */
function deviationsView(c) {
  const devs = c.st.deviations;
  // Station de l'écart ; station retirée de la tournée : « Nom (retirée) » ; écart commun : « Tournée ».
  const stName = k => k ? stationLabel(c.audit, k) : 'Tournée';
  return html`<div class="card"><h2>Écarts de la tournée (${devs.length})</h2>
    ${devs.length ? html`<div class="list">${devs.map(d => html`<a class="li ${d.status === 'clos' ? 'stripe-ok' : d.criticalityCode === 'OBS' ? 'stripe-perf' : 'stripe-nc'}" href="#/ecart/${d.id}"><div class="li-main"><div class="li-title">${d.number}${d.itemCode ? ' · ' + d.itemCode : ''}</div><div class="li-sub">${d.requirement}</div><div class="li-sub">${d.description}</div><div class="row" style="gap:6px;margin-top:4px">${c.multi || (d.stationKey && !c.stations.some(s => s.key === d.stationKey)) ? badge(stName(d.stationKey), 'outline') : ''}${d.responseStatus ? badge(RESPONSES[d.responseStatus]?.label || d.responseStatus, RESPONSES[d.responseStatus]?.cls || '') : ''}${critBadge(d.criticalityCode)}${deviationBadge(d.status)}${d.dueDate ? badge('Délai ' + fmtDate(d.dueDate), 'outline') : ''}</div></div><span class="chev">›</span></a>`)}</div>`
      : empty(icon('check-circle', { size: 44 }), 'Aucun écart enregistré pour cette tournée.')}
    <p class="note">Un écart naît d’une décision de l’auditeur : depuis un point perfectible (criticité proposée : observation / piste d’amélioration) ou non conforme (criticité proposée : mineure), jamais automatiquement.</p>
    ${c.editable && can('deviation.manage') ? html`<button class="btn danger lg block" style="margin-top:12px" data-act="dev-new"><span class="ic">${icon('warning')}</span>Enregistrer un écart (hors critère)</button>` : ''}
  </div>
  ${c.st.alerts.filter(a => a.deviation).length ? html`<div class="card"><h2>Alertes pouvant justifier un écart</h2>${c.st.alerts.filter(a => a.deviation).map(a => alertBox(a, c.editable))}</div>` : ''}`;
}

const countCells = x => html`<td class="n-c">${x.C}</td><td class="n-p">${x.P}</td><td class="n-nc">${x.NC}</td><td class="n-na">${x.NA}</td><td class="n-u">${x.unanswered}</td>`;
const gradeCell = x => html`<td class="n-g">${gradePill(x?.grade)}</td>`;
/** Mention de l'état de la note de la tournée (synthèse) : figée à la signature, recalculée, calculée, provisoire. */
function gradeStateNote(c) {
  const r = c.st.summary.grading;
  if (!r) return '';
  const rec = r.record;
  const by = rec ? `${rec.at ? ` le ${fmtDate(rec.at)} à ${fmtTime(rec.at)}` : ''}${rec.byName ? ` par ${rec.byName}` : ''}` : '';
  const text = r.state === 'figee' ? `Note figée à la signature du contrôleur${by}, avec les seuils de ce moment (${thresholdsText(r.thresholds)}).`
    : r.state === 'recalculee' ? `Note recalculée après modification tracée de la tournée signée (seuils et barème figés à la signature${by}) ; note à la signature : ${r.signedTour?.text || '—'} / 20.`
      : r.state === 'calculee' ? `Note calculée : tournée signée avant la mise en place de la notation (aucune note figée à sa signature) ; seuils actuels (${thresholdsText(r.thresholds)}).`
        : 'Note provisoire : elle sera figée à la signature du contrôleur, avec les seuils de ce moment.';
  return html`<p class="note as-grade-state" data-state="${r.state}">${text}</p>`;
}
function synthesisView(c) {
  const s = c.st.summary;
  const g = s.stations?.global || { C: s.counts.C, P: s.counts.P, NC: s.counts.NC, NA: s.counts.NA, unanswered: s.counts.unanswered, total: s.counts.controlled };
  const dis = c.editable ? '' : raw('disabled');
  const tiles = [['Points conformes / satisfaisants', g.C, 'ok', 'C'], ['Points perfectibles', g.P, 'perf', 'P'], ['Points non conformes', g.NC, 'nc', 'NC'], ['Non applicables', g.NA, 'na', 'N/A'], ['Non renseignés', g.unanswered, '', ''], ['Écarts enregistrés', s.deviationsCount, 'nc', '']];
  const max = Math.max(1, ...s.byCriticality.map(x => x.count));
  const sheetRows = list => list.map(x => html`<tr><th scope="row"><a href="#/audit/${c.audit.id}/feuille-${x.instanceKey}"><span class="as-sn" style="${themeVars(x.theme)}">${x.index}</span>${x.tab || x.title}</a>${x.sharedCounted ? html` <small class="muted">(dont ${x.sharedCounted} commun${x.sharedCounted > 1 ? 's' : ''})</small>` : ''}</th>${gradeCell(x)}${countCells(x)}<td class="as-concl">${x.conclusionLabel ? badge(x.conclusionLabel, OPT_CLS[x.conclusion] === 'ok' ? 'ok' : OPT_CLS[x.conclusion] === 'p' ? 'perf' : OPT_CLS[x.conclusion] || 'outline') : html`<span class="muted">—</span>`}${x.hint && (x.NC || x.P) ? html`<div class="tiny muted">${x.hint}</div>` : ''}</td></tr>`);
  const tourSheets = s.sheets.filter(x => !x.stationKey);
  const head = html`<thead><tr><th scope="col">Feuille</th><th class="n-g" scope="col" title="Note sur 20 de la feuille">Note /20</th><th class="n-c" scope="col" title="Conforme / satisfaisant">C</th><th class="n-p" scope="col" title="Perfectible">P</th><th class="n-nc" scope="col" title="Non conforme">NC</th><th class="n-na" scope="col" title="Non applicable">N/A</th><th class="n-u" scope="col" title="Non renseignés">Non rens.</th><th scope="col">Conclusion</th></tr></thead>`;
  const r = s.grading;
  return html`${r ? html`<div class="card as-grade-card" id="tourGrade"><h2>Note de la tournée</h2>
      ${gradeBox({ grade: r.tour, thresholds: r.thresholds, state: r.state, id: 'tourGradeBox', scope: 'de la tournée', theme: 'navy', title: 'Grille de notation de la tournée' })}
      ${gradeStateNote(c)}
      <p class="note">La note de la tournée compte chaque point une fois (un point commun à la tournée${c.st.mixed ? ', une opération mutualisée d’une station contrôlée pour la biologie et la chimie' : ''} : une seule fois) ; la note d’une feuille porte sur les points affichés dans la feuille ; la note d’une station, sur ses points propres (les points communs sont notés sur la ligne « Commun à la tournée »).</p>
    </div>` : ''}
    <div class="card"><h2>Synthèse factuelle de la tournée</h2>
      <div class="kpis as-kpis">${tiles.map(([k, v, cls, code]) => html`<div class="kpi ${cls ? 'k-' + cls : ''}"><span class="k">${code ? html`<b class="as-k-code">${code}</b>` : ''}${k}</span><span class="v">${v}</span></div>`)}</div>
      <p class="note">Chaque point est compté une fois : un critère « commun à la tournée » n’est compté qu’une seule fois, quel que soit le nombre de stations${c.st.mixed ? ' ; à une station contrôlée pour plusieurs parties (biologie et chimie), une opération commune (accès, mesures in situ, prélèvement, conservation…) n’est saisie et comptée qu’une fois' : ''}.</p>
    </div>
    ${s.stations && c.stations.length ? html`<div class="card"><h2>Par station</h2><div class="table-wrap"><table class="tbl as-sum"><thead><tr><th scope="col">Station</th><th class="n-g" scope="col" title="Note sur 20">Note /20</th><th class="n-c" scope="col">C</th><th class="n-p" scope="col">P</th><th class="n-nc" scope="col">NC</th><th class="n-na" scope="col">N/A</th><th class="n-u" scope="col">Non rens.</th><th scope="col">Avancement</th></tr></thead><tbody>
      ${s.stations.tournee.total ? html`<tr class="as-sum-tour"><th scope="row">${icon('route', { size: 16 })} Commun à la tournée</th>${gradeCell(s.stations.tournee)}${countCells(s.stations.tournee)}<td>${c.st.stationProgress?.tournee ? `${c.st.stationProgress.tournee.answered} / ${c.st.stationProgress.tournee.total}` : ''}</td></tr>` : ''}
      ${s.stations.stations.map(x => { const p = c.st.stationProgress?.stations?.[x.key]; const perim = c.st.mixed ? c.stations.find(y => y.key === x.key)?.perimeter : null; return html`<tr data-station="${x.key}"><th scope="row"><b>${x.index + 1}.</b> ${x.name} <small class="muted">${x.code}</small>${perim ? html` <small class="as-perim-s">${partsText(c.baseGrid, perim)}</small>` : ''}</th>${gradeCell(x)}${countCells(x)}<td>${p ? `${p.answered} / ${p.total}` : ''}</td></tr>`; })}
      <tr class="as-sum-total"><th scope="row">Total de la tournée</th>${gradeCell(s.stations.global)}${countCells(s.stations.global)}<td>${c.st.progress.answered} / ${c.st.progress.total}</td></tr>
    </tbody></table></div></div>` : ''}
    <div class="card"><h2>Par feuille</h2><div class="table-wrap"><table class="tbl as-sum">${head}<tbody>
      ${tourSheets.length ? html`${c.multi ? html`<tr class="as-sum-group"><td colspan="8">${icon('route', { size: 16 })} Feuilles de tournée</td></tr>` : ''}${sheetRows(tourSheets)}` : ''}
      ${c.stations.map(st => { const list = s.sheets.filter(x => x.stationKey === st.key); return list.length ? html`<tr class="as-sum-group"><td colspan="8">Station ${st.index + 1} — ${st.name} <small>${st.code}</small></td></tr>${sheetRows(list)}` : ''; })}
      ${!c.stations.length ? sheetRows(s.sheets.filter(x => x.stationKey)) : ''}
    </tbody></table></div>
      <p class="note">Conclusion : choix du contrôleur dans l’encadré de chaque feuille (la suggestion « n NC, n P sur cette feuille » n’est jamais appliquée seule). Note /20 de la feuille : points affichés dans la feuille, communs à la tournée compris.</p></div>
    ${s.ncItems.length || s.pItems.length ? html`<div class="card"><h2>Points non conformes et perfectibles</h2><div class="list">${[...s.ncItems.map(x => ({ ...x, st: 'NC' })), ...s.pItems.map(x => ({ ...x, st: 'P' }))].map(x => html`<a class="li ${x.st === 'NC' ? 'stripe-nc' : 'stripe-perf'}" href="${itemHref(c.audit, c.model, x.itemId)}"><div class="li-main"><div class="li-title">${badge(x.st, x.st === 'NC' ? 'nc' : 'perf')} ${x.code} — ${x.label}</div><div class="li-sub">${x.stationName ? x.stationName + ' · ' : ''}${x.comment || html`<i>observation manquante</i>`}</div></div><span class="chev">›</span></a>`)}</div></div>` : ''}
    <div class="card"><h2>Écarts par niveau de criticité</h2>
      <div class="bars">${s.byCriticality.map(b => html`<div class="bar-row"><span class="bl">${b.label}</span><span class="bt"><span style="width:${b.count / max * 100}%;background:${b.color || 'var(--sky)'}"></span></span><span class="bn">${b.count}</span></div>`)}</div>
      ${s.actions.length ? html`<h3>Actions demandées</h3><ul>${s.actions.map(a => html`<li><b>${a.number}</b> (${a.criticality}) : ${a.action || a.immediate}${a.responsible ? ' — ' + a.responsible : ''}${a.dueDate ? ' — avant le ' + fmtDate(a.dueDate) : ''}</li>`)}</ul>` : ''}
    </div>
    <div class="card"><h2>Bilan de l’auditeur</h2>
      <div class="field"><label for="cc-comment">Commentaire et bilan de l’auditeur</label><div class="input-wrap"><textarea ${autosave(c)} ${dis} id="cc-comment" data-change="concl" data-k="comment" rows="4">${c.audit.conclusions?.comment || ''}</textarea>${c.editable ? voiceBtn('cc-comment') : ''}</div></div>
      <div class="field"><label for="cc-preconisations">Autres préconisations</label><div class="input-wrap"><textarea ${autosave(c)} ${dis} id="cc-preconisations" data-change="concl" data-k="preconisations" rows="3">${c.audit.conclusions?.preconisations || ''}</textarea>${c.editable ? voiceBtn('cc-preconisations') : ''}</div></div>
      <details ${c.audit.conclusions?.strengths || c.audit.conclusions?.vigilance ? raw('open') : ''}><summary>Points forts et points de vigilance</summary>
        ${s.strengths.length ? html`<h3>Points forts constatés</h3><ul>${s.strengths.map(x => html`<li>${x}</li>`)}</ul>` : ''}
        ${s.vigilance.length ? html`<h3>Points de vigilance constatés</h3><ul>${s.vigilance.slice(0, 12).map(x => html`<li>${x}</li>`)}</ul>${s.vigilance.length > 12 ? html`<p class="note">… et ${s.vigilance.length - 12} autre(s).</p>` : ''}` : ''}
        <div class="field"><label for="cc-strengths">Points forts complémentaires</label><textarea ${autosave(c)} ${dis} id="cc-strengths" data-change="concl" data-k="strengths">${c.audit.conclusions?.strengths || ''}</textarea></div>
        <div class="field"><label for="cc-vigilance">Points de vigilance complémentaires</label><textarea ${autosave(c)} ${dis} id="cc-vigilance" data-change="concl" data-k="vigilance">${c.audit.conclusions?.vigilance || ''}</textarea></div>
      </details>
    </div>`;
}

function infosView(c) {
  const { audit, st } = c;
  const prov = store.get('provider', audit.providerId);
  const comps = (c.baseGrid.compartments || []).filter(x => (audit.compartments || []).includes(x.key));
  const canRemove = c.editable && !c.locked && c.stations.length > 1;
  // Périmètre contrôlé modifiable avant la signature du contrôleur (comme la liste des contrôleurs).
  const canParts = c.editable && !c.locked && !audit.signatures?.auditor && audit.status !== 'abandonne';
  const times = auditTimeTexts(audit);
  return html`
    <div class="card"><h2>Identification de la tournée</h2>${kv([
      ['Numéro d’audit', html`<b class="mono">${audit.number}</b>`], ['Type de tournée', st.mixed ? html`${st.header?.typeLabel || st.types.map(t => t.label).join(' + ')} <span class="badge info">tournée mixte</span>` : st.type?.label || ''], ['Type d’audit', auditKindLabel(audit.kind, { long: true })],
      // Heures rapprochées de la feuille Organisation : « Début / Fin du contrôle » (F2.1.5 / 1.6) si renseignés.
      ['Date', fmtDate(c.date)], ['Heure de début', times.start], ['Heure de fin', times.end],
      [c.controllers.length > 1 ? 'Contrôleurs OEG' : 'Contrôleur OEG', c.controllersText], ['Tournée créée par', audit.auditorName], ['Appareil utilisé', audit.device?.name], ['Version de l’application', audit.appVersion],
      ['Grille', `${audit.gridSnapshot?.name} — v${audit.gridVersion}`], ['Version du protocole', audit.protocolVersion || 'non renseignée'], ['Version du CCTP', audit.cctpVersion || 'non renseignée'],
      ['Prestataire', prov ? html`${prov.name} ${kindBadge(prov.kind)}` : '—'], ['Opérateur(s) contrôlé(s)', st.operators.map(o => operatorName(o)).join(', ') || 'à identifier'],
      ['Compartiments contrôlés', comps.map(x => x.label).join(' · ')]
    ])}</div>
    ${controllersCard(c)}
    <div class="card" id="tourStations"><h2>Stations de la tournée (${c.stations.length})</h2>
      <div class="list">${c.stations.map(s => { const p = st.stationProgress?.stations?.[s.key]; const multi = c.SS && s.site && c.SS.possibleParts(s.site, c.baseGrid).length > 1; return html`<div class="li" data-station="${s.key}"><span class="li-ic as-li-no">${s.index + 1}</span><div class="li-main"><div class="li-title">${s.name} <span class="badge outline">${CODE_TYPES[s.codeType] || 'Code'} ${s.code}</span></div>
        ${st.mixed || multi ? html`<div class="li-sub as-perim" data-parts="${s.perimeter.join(',')}"><span class="as-perim-k">Contrôlé :</span>${s.perimeter.map(k => html`<span class="type-badge t-${k}">${partLabel(c.baseGrid, k)}</span>`)}${s.perimeter.length > 1 ? html`<small class="muted">opérations communes saisies une seule fois</small>` : ''}</div>` : ''}
        <div class="li-sub">${st.mixed ? s.perimeter.map((k, i) => { const x = s.prestations.find(y => y.type === k); return html`${i ? ' · ' : ''}${partLabel(c.baseGrid, k)} : ${x ? html`prestation <a href="#/prestation/${x.prestation.id}">${x.prestation.ref}</a>${x.prestation.plannedDate ? ' · ' + fmtDate(x.prestation.plannedDate) : ' · à planifier'}` : 'hors programme'}`; })
          : s.prestation ? html`Prestation <a href="#/prestation/${s.prestation.id}">${s.prestation.ref}</a>${s.prestation.plannedDate ? ' · ' + fmtDate(s.prestation.plannedDate) : ' · à planifier'}` : 'Hors programme (aucune prestation rattachée)'}${p ? ` · ${p.answered} / ${p.total} points renseignés` : ''}</div>
        <div class="row" style="gap:6px;margin-top:6px"><a class="btn ghost sm" href="#/audit/${audit.id}/feuille-1@${s.key}">Feuilles de la station</a><a class="btn ghost sm" href="#/station/${s.siteId}">Fiche station</a>${canParts && (st.mixed || multi) ? html`<button type="button" class="btn ghost sm" data-act="tour-parts" data-key="${s.key}">${icon('edit', { size: 16 })}Périmètre contrôlé</button>` : ''}${canRemove ? html`<button type="button" class="btn danger-ghost sm" data-act="tour-remove" data-key="${s.key}">Retirer de la tournée</button>` : ''}</div></div></div>`; })}</div>
      ${c.editable && !c.locked ? html`<button type="button" class="btn ghost" style="margin-top:10px" data-act="tour-add"><span class="ic">${icon('plus')}</span>Ajouter une station</button>` : ''}
      ${(audit.stationLog || []).length ? html`<details style="margin-top:10px"><summary>Historique des stations (${audit.stationLog.length})</summary><ul>${audit.stationLog.map(l => html`<li>${fmtDateTime(l.at)} — ${l.byName || ''} — ${l.action === 'perimetre' ? html`périmètre contrôlé à ${store.get('site', l.siteId)?.name || l.key} : ${partsText(c.baseGrid, l.before)} → ${partsText(c.baseGrid, l.after)}` : html`${l.action === 'ajout' ? 'ajout' : 'retrait'} de ${store.get('site', l.siteId)?.name || l.key}${l.parts ? ` (contrôlé : ${partsText(c.baseGrid, l.parts)})` : ''}`}${l.reason ? html` — motif : « ${l.reason} »` : ''}</li>`)}</ul></details>` : ''}
    </div>
    ${documentsCard(audit)}
    ${st.alerts.length ? html`<div class="card"><h2>Alertes en cours (${st.alerts.length})</h2>${st.alerts.map(a => alertBox(a, c.editable))}</div>` : ''}
    ${c.editable && !c.locked ? html`<div class="card" id="tourActions"><h2>Actions</h2><div class="btn-row">
      <button class="btn ghost" data-act="later"><span class="ic">${icon('clock')}</span>Continuer plus tard</button></div>
      <p class="note">Chaque saisie est enregistrée immédiatement sur l’appareil, même sans connexion. La tournée peut être reprise à tout moment depuis l’accueil ou le planning ; sur une tablette partagée, « Changer d’agent » (en-tête) laisse la tournée sur la tablette pour le collègue qui se connecte ensuite.</p>
      ${cancelTourBlock(audit)}</div>` : cancelTourBlock(audit) ? html`<div class="card" id="tourActions"><h2>Annuler la tournée</h2>${cancelTourBlock(audit)}</div>` : ''}`;
}

/** « A. Dupont », « A. Dupont et B. Martin », « A, B et C ». */
export function namesList(names) {
  const l = names.filter(Boolean);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : l[0] || '';
}
/** « de » ou « d’ » devant un nom (élision devant une voyelle : « tournée d’Alice Dupont »). */
export const deName = n => /^[aeiouyàâäéèêëîïôöûüœ]/i.test(String(n || '').trim()) ? 'd’' : 'de ';
/**
 * Contrôleurs OEG de la tournée (binôme) : liste, réponses saisies par chacun, ajout / retrait (motif) par un
 * contrôleur avant la signature, « Rejoindre la tournée », saisies par agent et historique des contrôleurs.
 */
function controllersCard(c) {
  const { audit } = c;
  const ctrls = c.controllers;
  const byAgent = entriesByAgent(audit);
  const canManage = c.editable && !c.locked && !audit.signatures?.auditor && audit.status !== 'abandonne';
  const others = canManage ? tourAgents().filter(u => !ctrls.some(x => x.id === u.id)) : [];
  const log = audit.controllerLog || [];
  return html`<div class="card" id="tourControllers"><h2>Contrôleurs OEG de la tournée (${ctrls.length})</h2>
    <div class="list">${ctrls.map(x => {
      const n = byAgent.find(r => r.id === x.id)?.responses || 0;
      return html`<div class="li as-ctrl" data-ctrl="${x.id}"><span class="avatar">${agentInitials(store.get('user', x.id) || x)}</span><div class="li-main"><div class="li-title">${x.name || 'Agent'} ${x.id === session.user?.id ? badge('vous', 'info') : ''} ${x.id === audit.auditorId ? badge('a créé la tournée', 'outline') : ''}</div>
        <div class="li-sub">${n} réponse${n > 1 ? 's' : ''} saisie${n > 1 ? 's' : ''}</div></div>
        ${canManage && ctrls.length > 1 ? html`<button type="button" class="btn danger-ghost sm" data-act="ctrl-remove" data-id="${x.id}">Retirer</button>` : ''}</div>`;
    })}</div>
    ${canManage && others.length ? html`<div class="field" style="margin-top:10px"><label for="ctrlAdd">Ajouter un contrôleur</label><select id="ctrlAdd" data-change="ctrl-add"><option value="">— agent de l’équipe —</option>${others.map(u => html`<option value="${u.id}">${u.name}</option>`)}</select></div>` : ''}
    ${c.joinable ? html`<button type="button" class="btn primary" style="margin-top:10px" data-act="tour-join"><span class="ic">${icon('people')}</span>Rejoindre la tournée</button>` : ''}
    <h3>Qui a saisi quoi</h3>
    <div class="table-wrap"><table class="tbl as-by-agent"><thead><tr><th scope="col">Agent</th><th scope="col">Réponses saisies</th></tr></thead>
      <tbody>${byAgent.map(r => html`<tr data-agent="${r.id}"><th scope="row">${r.name}${r.controller ? '' : html` <small class="muted">(hors contrôleurs)</small>`}</th><td>${r.responses}</td></tr>`)}</tbody></table></div>
    <p class="note">Chaque réponse est attribuée à l’agent connecté qui l’a saisie ou modifiée en dernier (« Saisi le … par … » sous chaque critère) ; le journal d’audit conserve l’historique complet. La signature « contrôleur » peut être faite par n’importe quel contrôleur de la tournée.</p>
    ${log.length ? html`<details><summary>Historique des contrôleurs (${log.length})</summary><ul>${log.map(l => html`<li>${fmtDateTime(l.at)} — ${l.action === 'ajout' ? (l.userId === l.by ? `${l.name} a rejoint la tournée` : `${l.name} ajouté(e) par ${l.byName || ''}`) : `${l.name} retiré(e) par ${l.byName || ''}`}${l.reason ? html` — motif : « ${l.reason} »` : ''}</li>`)}</ul></details>` : ''}
  </div>`;
}

/* ---------- Navigation : stations, onglets, pied ---------- */
function stationSelector(c, cur) {
  if (!c.stations.length) return '';
  const curSheet = c.model.linear.find(sh => sheetStep(sh) === cur);
  const href = key => {
    const own = c.model.groups.stations.find(g => g.station.key === key)?.sheets || [];
    const same = curSheet?.station ? own.find(sh => String(sh.no) === String(curSheet.no)) : null;
    const target = same || own[0];
    return target ? `#/audit/${c.audit.id}/${sheetStep(target)}` : `#/audit/${c.audit.id}/infos`;
  };
  const list = c.stations.map(s => { const p = c.st.stationProgress?.stations?.[s.key] || {}; return { key: s.key, name: s.name, code: s.code, answered: p.answered, total: p.total, nc: p.nc, p: p.p, href: href(s.key) }; });
  const canEdit = c.editable && !c.locked;
  const extra = canEdit && c.stations.length > 1 ? html`<button type="button" class="ts-rm" data-act="tour-remove" data-key="${c.curKey}" title="Retirer la station affichée de la tournée">${icon('minus', { size: 18 })}<span>Retirer</span></button>` : '';
  return tourStations({ stations: list, current: c.curKey, addAct: canEdit ? 'tour-add' : '', addLabel: 'Ajouter une station', label: 'Tournée', extra });
}
function tabsNav(c, cur) {
  const own = c.model.groups.stations.find(g => g.station.key === c.curKey)?.sheets || [];
  const sheets = [...c.model.groups.tournee, ...own];
  const tab = sh => {
    const p = c.st.sheetProgress[sh.instanceKey] || {};
    const sel = sheetStep(sh) === cur;
    const done = p.total && p.answered >= p.total;
    return html`<a class="as-tab th-${sh.theme || 'ocean'}${sel ? ' sel' : ''}${done ? ' done' : ''}" style="${themeVars(sh.theme || 'ocean')}" href="#/audit/${c.audit.id}/${sheetStep(sh)}" ${sel ? raw('aria-current="page"') : ''} title="${sh.title}">
      <b>${sh.index}</b><span class="t">${sh.tab || sh.title}</span>${p.total ? html`<small>${p.answered}/${p.total}</small>` : ''}${p.nc ? html`<i class="as-flag nc" title="${p.nc} non-conformité(s)">${p.nc}</i>` : ''}${p.p ? html`<i class="as-flag p" title="${p.p} point(s) perfectible(s)">${p.p}</i>` : ''}${!sh.station && c.multi ? html`<span class="as-tab-tour" title="Feuille commune à la tournée">${icon('route', { size: 14 })}</span>` : ''}</a>`;
  };
  const fixed = k => {
    const sel = cur === k;
    const n = k === 'ecarts' ? c.st.deviations.length : k === 'signatures' ? c.st.validation.filter(v => v.level === 'error').length : 0;
    return html`<a class="as-tab is-fixed${sel ? ' sel' : ''}" href="#/audit/${c.audit.id}/${k}" ${sel ? raw('aria-current="page"') : ''}><b>${icon(FIXED[k].icon, { size: 18 })}</b><span class="t">${FIXED[k].label}</span>${n && k === 'ecarts' ? html`<small>${n}</small>` : ''}${k === 'signatures' && c.locked ? html`<span class="as-tab-tour">${icon('lock', { size: 14 })}</span>` : ''}</a>`;
  };
  return html`<nav class="as-tabs" aria-label="Feuilles et étapes de la tournée" id="asTabs">${sheets.map(tab)}<span class="as-tab-sep" aria-hidden="true"></span>${Object.keys(FIXED).map(fixed)}</nav>`;
}
function stepLabel(c, id) {
  if (FIXED[id]) return FIXED[id].label;
  const sh = c.model.linear.find(x => sheetStep(x) === id);
  if (!sh) return '';
  return `${sh.index} · ${sh.tab || sh.title}${sh.station && c.multi ? ` (${sh.station.name})` : ''}`;
}
function footerNav(c, cur) {
  const i = c.model.order.indexOf(cur);
  const prev = i > 0 ? c.model.order[i - 1] : null;
  const next = i >= 0 && i < c.model.order.length - 1 ? c.model.order[i + 1] : cur === 'infos' ? c.model.order[0] : null;
  return html`<div class="audit-footer as-footer">
    ${prev ? html`<a class="btn ghost lg" href="#/audit/${c.audit.id}/${prev}"><span class="as-fl">◀ Précédent</span><small>${stepLabel(c, prev)}</small></a>` : html`<a class="btn ghost lg" href="#/"><span class="as-fl">◀ Accueil</span></a>`}
    ${next ? html`<a class="btn primary lg" href="#/audit/${c.audit.id}/${next}"><span class="as-fl">Suivant ▶</span><small>${stepLabel(c, next)}</small></a>` : ''}
  </div>`;
}

/* ---------- Rendu de l'écran ---------- */
/**
 * Écran d'audit en feuilles. p : {audit, st (auditState), step, q, editable, locked, amendReason, seal}.
 * Retourne {html, step (étape affichée), stationKey, siteId (fiche station affichée)}.
 */
export async function renderSheetAudit({ audit, st, step, q = {}, editable, locked, amendReason = null, seal = null }) {
  const model = navModel(st);
  const cur = model.all.includes(step) ? step : defaultStep(audit, st, model);
  // Étape déduite (adresse sans étape ou périmée) : inscrite dans l'adresse pour que les ré-affichages après chaque
  // saisie restent sur la même feuille.
  if (cur !== step) { try { history.replaceState(null, '', `#/audit/${audit.id}/${cur}${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`); } catch (e) { /* adresse inchangée */ } }
  const curSheet = model.linear.find(sh => sheetStep(sh) === cur) || null;
  const keys = (st.stations || []).map(s => s.key);
  const curKey = curSheet?.station?.key || (keys.includes(q.station) ? q.station : null) || (keys.includes(lastStation.get(audit.id)) ? lastStation.get(audit.id) : null) || keys[0] || null;
  if (curKey) lastStation.set(audit.id, curKey);
  const media = auditMedia(audit.id);
  const mediaByItem = new Map(), mediaBySheet = new Map();
  for (const m of media) {
    const k = m.link?.itemId;
    if (!k) continue;
    const map = m.link.type === 'item' ? mediaByItem : m.link.type === 'sheet' ? mediaBySheet : null;
    if (map) { if (!map.has(k)) map.set(k, []); map.get(k).push(m); }
  }
  const devsByItem = new Map();
  for (const d of st.deviations) if (d.itemId) { if (!devsByItem.has(d.itemId)) devsByItem.set(d.itemId, []); devsByItem.get(d.itemId).push(d); }
  const prov = store.get('provider', audit.providerId);
  const c = {
    audit, st, editable, locked, amendReason, model, curKey, stations: st.stations || [], multi: (st.stations || []).length > 1, type: st.auditType || auditTypeOf(audit),
    baseGrid: st.baseGrid, mediaByItem, mediaBySheet, devsByItem, SS: null,
    // Date de la tournée (auditDate : « Date mission », date choisie à la création ou date de création).
    date: auditDate(audit),
    providerLabel: prov ? (prov.kind === 'regie' && prov.code ? `${prov.code} en régie` : prov.name) : '',
    // Contrôleurs OEG de la tournée (binôme) ; agent connecté hors contrôleurs : « Rejoindre la tournée ».
    controllers: tourControllers(audit), controllersText: '', joinable: !locked && canJoinAudit(audit, session.user),
    // Barème de la note sur 20 (points majeurs, points de synthèse) : figé à la signature, sinon celui de la grille.
    scoring: st.scoring || null
  };
  c.controllersText = c.controllers.map(x => x.name).filter(Boolean).join(', ');
  // Critères visibles (reprises et propositions entre feuilles) et préleveurs de la tournée.
  c.linkItems = (st.sheets || []).flatMap(sh => sh.items);
  c.linkExtra = linkExtra(audit);
  let body, siteId = null;
  if (curSheet) {
    const stn = curSheet.station ? c.stations.find(s => s.key === curSheet.station.key) : c.stations.length === 1 ? c.stations[0] : null;
    const site = stn?.site || st.site || null;
    siteId = site?.id || null;
    if (curSheet.layout === 'station') { c.SS = await loadStationSheet(); body = stationSheetView(c, curSheet, site); }
    else body = tableSheetView(c, curSheet, site);
    if (curSheet.layout === 'station') body = html`${body}<div class="as-f1-actions"><a class="btn ghost sm" href="#/audit/${audit.id}/infos"><span class="ic">${icon('info')}</span>Identification, stations, documents et alertes</a>${site ? html`<a class="btn ghost sm" href="#/station/${site.id}"><span class="ic">${icon('station')}</span>Fiche station</a>` : ''}</div>`;
  } else if (cur === 'ecarts') body = deviationsView(c);
  else if (cur === 'synthese') body = synthesisView(c);
  else if (cur === 'signatures') body = signaturesStep(audit, st, editable, seal, { issueHref: e => itemHref(audit, model, e.itemId), sheets: true });
  else { c.SS = await loadStationSheet(); body = infosView(c); }
  const p = st.progress;
  const out = html`
    <div class="as-top">
      <div class="as-id"><span class="as-num">${audit.number}</span>${auditBadge(audit)}${st.mixed ? st.types.map(t => html`<span class="type-badge t-${t.key}" title="Tournée mixte : ${st.header?.typeLabel || ''}">${icon(t.icon || 'drop', { size: 15 })}${t.short || t.label}</span>`) : st.type ? html`<span class="type-badge t-${c.type}">${icon(st.type.icon || 'drop', { size: 15 })}${st.type.short || st.type.label}</span>` : ''}${!locked && !amendReason ? cancelTourButton(audit, { cls: 'btn danger-ghost sm as-cancel', id: 'tourCancelTop' }) : ''}</div>
      <div class="as-meta">${c.providerLabel || providerName(audit.providerId)} · ${fmtDate(c.date)} · ${c.stations.length} station${c.stations.length > 1 ? 's' : ''}${audit.kind === 'inopine' ? ' · inopiné' : ''}</div>
      <div class="as-pct"><b>${p.percent} %</b><span class="save-state" id="saveState">${editable ? `Enregistré sur l’appareil ✓ ${fmtTime(audit.updatedAt)}` : locked ? 'Lecture seule' : ''}</span></div>
      ${progressBar(p.percent)}
    </div>
    ${stationSelector(c, cur)}
    ${tabsNav(c, cur)}
    ${locked ? html`<div class="banner ${amendReason ? 'warn' : 'ok'} locked-banner"><span class="grow">${amendReason ? html`Modification tracée en cours — motif : « ${amendReason} ». Chaque changement est historisé (valeur précédente conservée).` : html`${icon('lock', { size: 18 })} Audit signé et verrouillé : lecture seule.`}</span>
      ${can('audit.amend') ? (amendReason ? html`<button class="btn sm ghost" data-act="amend-stop">Terminer les modifications</button>` : html`<button class="btn sm ghost" data-act="amend-start">Modifier (avec motif)</button>`) : ''}</div>` : ''}
    ${c.joinable ? html`<div class="banner info as-join" id="tourJoin"><span class="grow">${icon('people', { size: 18 })} Tournée ${deName(c.controllersText)}<b>${namesList(c.controllers.map(x => x.name))}</b>${editable ? ' — en tant qu’encadrement, vous pouvez la modifier ; rejoignez-la pour en être contrôleur.' : ' — rejoignez la tournée pour saisir avec vos collègues (vos saisies vous seront attribuées).'}</span><button type="button" class="btn primary sm" data-act="tour-join">Rejoindre la tournée</button></div>` : ''}
    ${!editable && !locked && audit.status !== 'abandonne' && !c.joinable ? html`<div class="banner info">Lecture seule : tournée ${deName(c.controllersText)}${namesList(c.controllers.map(x => x.name))}.</div>` : ''}
    ${cancelledBanner(audit)}
    <div class="as-body as-step-${cur.startsWith('feuille-') ? 'sheet' : cur}">${body}</div>
    ${footerNav(c, cur)}`;
  return { html: out, step: cur, stationKey: curKey, siteId };
}

/** Montage : fiche station (carte, photos), images des signatures, onglet courant visible, défilement vers ?item=. */
export async function mountSheetAudit(root, { audit, siteId = null, q = {} } = {}) {
  const tabs = root.querySelector('#asTabs');
  const curTab = tabs?.querySelector('[aria-current]');
  if (tabs && curTab) tabs.scrollLeft = Math.max(0, curTab.offsetLeft - (tabs.clientWidth - curTab.offsetWidth) / 2);
  const ts = root.querySelector('.ts-list');
  const curPill = ts?.querySelector('[aria-current]');
  if (ts && curPill) ts.scrollLeft = Math.max(0, curPill.offsetLeft - 8);
  if (siteId && root.querySelector('[data-st-sheet]')) {
    const mod = await loadStationSheet();
    mod?.mountStationSheet(root, { site: store.get('site', siteId), audit }).catch(e => console.warn(e));
  }
  if (q.item && lastScrolled !== location.hash) {
    lastScrolled = location.hash;
    setTimeout(() => {
      const el = [document.getElementById('row-' + q.item), document.getElementById('card-' + q.item)].find(x => x && x.offsetParent !== null);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('as-flash');
      setTimeout(() => el.classList.remove('as-flash'), 2200);
    }, 80);
  }
}
export async function unmountSheetAudit() { SS?.unmountStationSheet?.(); }

/* ---------- Ré-affichage en conservant la saisie en cours ---------- */
/**
 * Ré-affiche l'écran (this.refresh du routeur) en conservant le champ actif, sa sélection et une saisie non encore
 * enregistrée (champ quitté pendant l'enregistrement du précédent).
 */
export async function refreshKeep(ctx) {
  const a = document.activeElement;
  const id = a && a !== document.body ? a.id : '';
  const typing = id && 'value' in a && a.value !== a.defaultValue && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? a.value : null;
  let sel = null;
  try { if (id && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch (e) { sel = null; }
  await ctx.refresh();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  if (typing !== null && el.value !== typing) el.value = typing;
  el.focus({ preventScroll: true });
  try { if (sel) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* type sans sélection */ }
}

/**
 * Fenêtre « Périmètre contrôlé » d'une station (ajout d'une station, onglet Infos) : cases « Biologie », « Chimie »…
 * proposées selon les réseaux et les prestations programmées de la station (au moins une cochée). Retourne les parties
 * cochées, ou undefined si la fenêtre est fermée sans valider.
 */
function askPerimeter(SSm, audit, site, { title, parts = null, okLabel = 'Valider' } = {}) {
  const opts = { grid: audit.gridSnapshot, providerId: audit.providerId, type: auditTypeOf(audit) };
  let cur = parts || SSm.defaultParts(site, opts);
  const checks = () => SSm.perimeterChecks(SSm.partChoices(site, { ...opts, parts: cur }), { act: 'pm-toggle' });
  const m = openModal({
    title, wide: true,
    body: html`<p class="as-pm-for"><b>${site.name || ''}</b> ${site.code ? html`<span class="badge outline">${site.code}</span>` : ''}</p>
      <p class="note">Cochez ce qui est <b>réellement contrôlé</b> à cette station.</p>
      <div id="pmBox">${checks()}</div>
      <p class="note">Même prestataire : les opérations communes (accès et station, mesures in situ, prélèvement, conservation et transport) sont saisies une seule fois pour la station ; les feuilles propres à chaque partie s’ajoutent. Partie réalisée par un autre prestataire : tournée distincte. Les points d’une partie décochée sont masqués (rien n’est effacé).</p>`,
    actions: [{ label: 'Annuler' }, { label: okLabel, cls: 'primary', act: 'pm-ok', id: 'pmOk' }],
    handlers: {
      'pm-toggle'(el) {
        const next = [...this.root.querySelectorAll('#pmBox input')].filter(x => x.checked).map(x => x.value);
        if (!next.length) { el.checked = true; return; }
        cur = next;
        this.root.querySelector('#pmBox').innerHTML = String(checks());
      },
      'pm-ok'() { this.close(cur); }
    }
  });
  return m.result;
}

/* ---------- Actions propres aux feuilles (fusionnées dans les handlers de js/views/audit.js) ---------- */
const saved = () => { const s = document.getElementById('saveState'); if (s) s.textContent = `Enregistré sur l’appareil ✓ ${new Date().toTimeString().slice(0, 5)}`; };
const parseNum = v => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const sheetHandlers = {
  /** Champ d'une valeur objet (« fields ») : texte, nombre, date, heure. */
  async fval(el) {
    const audit = store.get('audit', this.params.id);
    const id = el.dataset.item, key = el.dataset.key;
    let v = el.value.trim();
    if (el.dataset.num !== undefined && v !== '') { const n = parseNum(v); if (n === null) { toast('Valeur numérique invalide', 'err'); return; } v = n; }
    const cur = audit.responses?.[id];
    let obj = { ...(isObj(cur?.value) ? cur.value : {}) };
    // X / Y d'un groupe GPS : saisie dans le système choisi (UTM 21N : convertie en UTM 22N, saisie d'origine gardée).
    if (el.dataset.xy !== undefined) obj = withXYEntry(obj, key, v);
    else if (v === '') delete obj[key]; else obj[key] = v;
    await setResponse(audit, id, { value: Object.keys(obj).length ? obj : undefined, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    await refreshKeep(this);
  },
  /** Système des coordonnées X / Y : « UTM 22N (RGFG95) » ou « UTM 21N » (conversion en 22N, voir withSrs). */
  async fsrs(el) {
    const audit = store.get('audit', this.params.id);
    const id = el.dataset.item;
    const cur = audit.responses?.[id];
    const obj = withSrs(cur?.value, el.value);
    await setResponse(audit, id, { value: Object.keys(obj).length ? obj : undefined, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    if (el.value === '21N' && obj.x21 !== undefined && obj.x !== undefined) toast(`UTM 21N : X ${obj.x21} · Y ${obj.y21} → RGFG95 / UTM 22N : X ${obj.x} · Y ${obj.y}`, 'ok', 5000);
    await refreshKeep(this);
  },
  /** Case exclusive d'une valeur objet (Oui / Non / Partielle…) ; un nouvel appui la décoche. */
  async fchoice(el) {
    const audit = store.get('audit', this.params.id);
    const id = el.dataset.item, key = el.dataset.key, val = el.dataset.value;
    const cur = audit.responses?.[id];
    const obj = { ...(isObj(cur?.value) ? cur.value : {}) };
    if (String(obj[key] ?? '') === val) {
      // Case décochée dans un audit signé en cours de modification : confirmation ; réponse obligatoire vidée : refus.
      if (!(await allowClear(this, audit, id, el.textContent.trim() || val, { empties: Object.keys(obj).length === 1, what: 'la case' }))) return;
      delete obj[key];
    } else obj[key] = val;
    await setResponse(audit, id, { value: Object.keys(obj).length ? obj : undefined, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    await refreshKeep(this);
  },
  /** Relevé GPS → X / Y RGFG95 (UTM 22N) + lat, lon, précision et heure du relevé (+ x21 / y21 en mode UTM 21N). */
  async 'gps-fill'(el) {
    const id = el.dataset.item;
    toast('Acquisition GPS en cours (restez immobile à découvert)…', '', 2500);
    let pos;
    try { pos = await getPosition({ timeout: 30000 }); } catch (e) { toast(e.message, 'err', 5000); return; }
    const xy = positionXY(pos);
    const audit = store.get('audit', this.params.id);
    const cur = audit.responses?.[id];
    // Le GPS de la tablette donne directement l'UTM 22N ; en mode « UTM 21N », la saisie 21N équivalente est affichée.
    await setResponse(audit, id, { value: withGpsReading(cur?.value, xy), status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    const out = coordIssues(xy)[0];   // position hors de la Guyane (GPS non calé, appareil hors du terrain…)
    toast(`Position relevée (RGFG95 / UTM 22N) : X ${xy.x} · Y ${xy.y}${xy.accuracy ? ` (±${Math.round(xy.accuracy)} m)` : ''}${out ? ` — ⚠ ${out.message}` : ''}`, out ? 'warn' : 'ok', out ? 8000 : 4000);
    await refreshKeep(this);
  },
  /** Valeur proposée (ex. amplitude horaire 5.2 → 5.3) appliquée à la demande de l'auditeur. */
  async suggest(el) {
    const audit = store.get('audit', this.params.id);
    const cur = audit.responses?.[el.dataset.item];
    await setResponse(audit, el.dataset.item, { value: el.dataset.value, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    await refreshKeep(this);
  },
  /** Valeur proposée d'un champ lié (autre feuille, liens « proposés ») appliquée à la demande de l'agent. */
  async 'link-take'(el) {
    const audit = store.get('audit', this.params.id);
    const id = el.dataset.item;
    const st = auditState(audit);
    const it = st.sheets.flatMap(sh => sh.items).find(i => i.id === id);
    const p = it ? linkProposal({ items: st.sheets.flatMap(sh => sh.items), responses: audit.responses || {}, item: it, extra: linkExtra(audit) }) : null;
    if (!p) { await refreshKeep(this); return; }
    const cur = audit.responses?.[id];
    const value = p.choices && el.dataset.choice !== undefined ? p.choices[Number(el.dataset.choice)] ?? p.value : p.value;
    await setResponse(audit, id, { value, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
    toast(`Valeur reprise de ${sourceInfo(p.fromId, st.sheets.flatMap(sh => sh.items)).text}`, 'ok', 3000);
    await refreshKeep(this);
  },
  /** « Reprendre les réponses de la station précédente » (feuille d'une station suivante) : points vides, confirmation. */
  async 'copy-prev'(el) {
    const audit = store.get('audit', this.params.id);
    const plan = previousStationPlan(audit, el.dataset.sheet);
    if (!plan?.copies.length) { toast('Aucun point vide à reprendre sur cette feuille.', '', 3000); return; }
    const n = plan.copies.length;
    const ok = await confirmDialog({
      title: 'Reprendre les réponses de la station précédente',
      message: `${n} point${n > 1 ? 's' : ''} encore vide${n > 1 ? 's' : ''} de cette feuille ${n > 1 ? 'vont' : 'va'} reprendre le statut (C / P / NC / N/A) et l’observation du même point de la station ${plan.prev.index + 1} (${plan.prev.name}). Les points déjà renseignés ne changent pas ; mesures, coordonnées et informations de la station ne sont jamais reprises. Chaque reprise est marquée « repris de la station ${plan.prev.index + 1} » et reste modifiable : vérifiez-les sur place.`,
      okLabel: `Reprendre ${n} réponse${n > 1 ? 's' : ''}`, cancelLabel: 'Annuler'
    });
    if (!ok) return;
    try {
      const r = await copyPreviousStation(audit, el.dataset.sheet, { reason: this.amendReason });
      toast(`${r.count} réponse${r.count > 1 ? 's' : ''} reprise${r.count > 1 ? 's' : ''} de la station ${r.prev.index + 1} (${r.prev.name}) : à vérifier`, 'ok', 5000);
    } catch (e) { toast(e.message, 'err', 6000); return; }
    await refreshKeep(this);
  },
  /** Encadré texte d'une feuille (observations, notes, photos) et agents du prestataire (F4). */
  async 'sheet-text'(el) {
    const audit = store.get('audit', this.params.id);
    const v = el.value.trim() ? el.value : null;
    // Enregistrement différé pendant la frappe puis « change » à la sortie du champ : pas de seconde écriture identique.
    if ((audit.sheets?.[el.dataset.sheet]?.[el.dataset.k] || null) !== v) await updateSheet(audit, el.dataset.sheet, { [el.dataset.k]: v }, { reason: this.amendReason });
    saved();
  },
  /** Conclusion d'une feuille (choix du contrôleur) ; un nouvel appui l'annule. */
  async 'sheet-concl'(el) {
    const audit = store.get('audit', this.params.id);
    const cur = audit.sheets?.[el.dataset.sheet]?.conclusion?.status;
    if (cur === el.dataset.value && !(await allowClear(this, audit, null, el.textContent.trim() || cur, { what: 'la conclusion de la feuille' }))) return;
    await updateSheet(audit, el.dataset.sheet, { conclusion: { status: cur === el.dataset.value ? null : el.dataset.value } }, { reason: this.amendReason });
    await refreshKeep(this);
  },
  async 'sheet-concl-text'(el) {
    const audit = store.get('audit', this.params.id);
    const v = el.value.trim() ? el.value : null;
    if ((audit.sheets?.[el.dataset.sheet]?.conclusion?.comments || null) !== v) await updateSheet(audit, el.dataset.sheet, { conclusion: { comments: v } }, { reason: this.amendReason });
    saved();
  },
  /** Appareil de mesure (F4, donnée de tournée : clé de stockage sheetStoreKey(feuille, 'instruments')). */
  async instr(el) {
    const v = el.value.trim();
    await updateSheet(store.get('audit', this.params.id), el.dataset.sheet || '4', { instruments: { [el.dataset.ins]: { [el.dataset.k]: v || null } } }, { reason: this.amendReason });
    // Date de calibration : alerte et propositions de F4.18 / F4.2 à jour (les autres champs : au prochain affichage,
    // sans réafficher la feuille pendant la frappe du champ suivant).
    if (el.dataset.k === 'calibration') await refreshKeep(this); else saved();
  },
  async 'instr-choice'(el) {
    const audit = store.get('audit', this.params.id);
    const key = el.dataset.sheet || '4';
    const cur = audit.sheets?.[key]?.instruments?.[el.dataset.ins]?.[el.dataset.k];
    await updateSheet(audit, key, { instruments: { [el.dataset.ins]: { [el.dataset.k]: cur === el.dataset.value ? null : el.dataset.value } } }, { reason: this.amendReason });
    await refreshKeep(this);
  },
  /**
   * « Ajouter une preuve » d'une ligne de tableau : trois choix explicites — « Prendre une photo » (appareil photo de la
   * tablette), « Importer depuis la galerie » (photos déjà dans l'appareil : date de prise de vue reprise de la photo),
   * « Joindre un document ».
   */
  async 'proof-menu'(el) {
    const audit = store.get('audit', this.params.id);
    const it = findItem(audit, el.dataset.item);
    if (!it) return;
    const link = { type: 'item', id: audit.id, itemId: it.id };
    const m = openModal({
      title: 'Ajouter une preuve',
      body: html`<p class="as-proof-for"><b>${it.code || ''}</b> ${it.label}</p>
        <div class="as-proof-choices">${mediaInputs(link, { auditId: audit.id, document: true, cls: 'btn ghost lg', camCls: 'btn primary lg' })}</div>
        <p class="note">Photo importée : la date de prise de vue est reprise de la photo (à défaut, la date d’import est retenue et signalée).</p>`,
      actions: [{ label: 'Fermer' }],
      handlers: { async 'media-add'(input) { this.close(await addFilesFromInput(input, { auditId: audit.id })); } }
    });
    if ((await m.result)?.length) await refreshKeep(this);
  },
  /** « Aide et attendu » de ce critère (fenêtre de js/views/attendus.js ; identifiant effectif accepté) : attendu du
   * prestataire puis l'aide du critère de la grille de la tournée. */
  async 'item-attendu'(el) {
    const it = findItem(store.get('audit', this.params.id), el.dataset.item);
    (await import('./attendus.js')).openAttendu(el.dataset.item, { item: it });
  },
  /** Aide d'un critère d'une autre grille en feuilles (« Inclut : … », références documentaires, critère commun) ; la
   * légende C / P / NC / N/A est sous chaque tableau (pas répétée ici). */
  'item-help'(el) {
    const audit = store.get('audit', this.params.id);
    const it = findItem(audit, el.dataset.item);
    if (!it) return;
    openModal({
      title: `${it.code || ''} — ${it.label}`,
      body: html`${it.help ? html`<p style="font-size:16px">${it.help}</p>` : ''}
        ${it.shared ? html`<div class="banner info">${icon('route', { size: 16 })} Critère commun à la tournée : une seule réponse, affichée dans chaque fiche station.</div>` : ''}
        ${it.station && !it.shared ? html`<p class="note">Station : ${it.station.name} (${it.station.code}).</p>` : ''}
        ${(it.refs || []).length ? html`<h3>Références</h3><ul>${it.refs.map(r => html`<li>${[r.docKey || r.docType, r.article].filter(Boolean).join(' § ')}${r.requirement ? ' — ' + r.requirement : ''}</li>`)}</ul>` : ''}`,
      actions: [{ label: 'Fermer', cls: 'primary' }]
    });
  },
  /** Préleveur du prestataire coché / décoché sur la feuille Organisation (F2) : présent pour la tournée ou non. */
  async 'tour-op'(el) {
    try { await setTourOperator(store.get('audit', this.params.id), el.value, el.checked, { reason: this.amendReason }); }
    catch (e) { el.checked = !el.checked; toast(e.message, 'err', 6000); return; }
    await refreshKeep(this);
  },
  /** « Ajouter un opérateur » (F2) : rattaché au prestataire contrôlé, sans doublon, sélectionné aussitôt. */
  async 'op-new'() {
    const audit = store.get('audit', this.params.id);
    const op = await openOperatorForm(audit.providerId, { context: `tournée ${audit.number}` });
    if (!op) return;
    await setTourOperator(store.get('audit', audit.id), op.id, true, { reason: this.amendReason });
    await refreshKeep(this);
  },
  /** Ajout d'une station du référentiel (même type de tournée) à la fin de l'ordre de passage. */
  async 'tour-add'() {
    const audit = store.get('audit', this.params.id);
    const type = auditTypeOf(audit);
    const SSm = await loadStationSheet();
    const types = s => SSm ? SSm.siteTypes(s) : (s.types || []);
    const taken = new Set((audit.stations || []).map(s => s.siteId));
    const prestaOf = s => (SSm ? SSm.openPrestations(s.id, { providerId: audit.providerId, type })[0] : null) || null;
    const all = store.filter('site', s => !s._deleted && s.active !== false && !taken.has(s.id) && (!type || types(s).includes(type)))
      .map(s => ({ s, p: prestaOf(s) }));
    const matches = (s, q) => SSm?.siteMatches ? SSm.siteMatches(s, q) : !q || normalize([s.name, s.code, s.bassin, s.commune, s.riverName].join(' ')).includes(normalize(q));
    const list = q => {
      const res = sortBy(all.filter(x => matches(x.s, q)), x => (x.p ? 0 : 1), x => x.s.name).slice(0, 40);
      if (!res.length) return html`<p class="note">Aucune station ${type ? 'de ce type ' : ''}ne correspond.</p>`;
      return html`${res.map(({ s, p }) => html`<button type="button" class="li" data-act="ts-pick" data-site="${s.id}" data-pres="${p?.id || ''}"><span class="li-ic">${icon(type === 'eso' ? 'well' : 'station')}</span><div class="li-main"><div class="li-title">${s.name} <span class="badge outline">${s.code}</span></div><div class="li-sub">${[s.bassin, s.commune, s.riverName].filter(Boolean).join(' · ') || '—'}</div>${p ? html`<div class="li-sub">${icon('calendar', { size: 14 })} Prestation ${p.ref} programmée${p.plannedDate ? ' le ' + fmtDate(p.plannedDate) : ' (à planifier)'}</div>` : ''}</div><span class="chev">${icon('plus', { size: 20 })}</span></button>`)}${all.filter(x => matches(x.s, q)).length > 40 ? html`<p class="note">40 premières stations affichées : précisez la recherche.</p>` : ''}`;
    };
    const m = openModal({
      title: 'Ajouter une station à la tournée', wide: true,
      body: html`<p class="note">Stations${type ? html` de type « ${audit.gridSnapshot?.types?.find(t => t.key === type)?.label || type} »` : ''} du référentiel ; la station est ajoutée à la fin de l’ordre de passage et ses informations sont pré-remplies.</p>
        <div class="field"><label for="tsQ">Rechercher une station</label><input id="tsQ" type="search" data-input="ts-q" placeholder="Nom, code, bassin, commune, cours d’eau…" autocomplete="off" autofocus></div>
        <div class="list" id="tsList">${list('')}</div>`,
      actions: [{ label: 'Annuler' }],
      handlers: {
        'ts-q'(el) { this.root.querySelector('#tsList').innerHTML = String(list(el.value)); },
        'ts-pick'(el) { this.close({ siteId: el.dataset.site, prestationId: el.dataset.pres || null }); }
      }
    });
    const v = await m.result;
    if (!v) return;
    // Station sur plusieurs réseaux (ex. BIO + Chimie) : ce qui y est réellement contrôlé (cases « Biologie », « Chimie »).
    const site = store.get('site', v.siteId);
    let req = v;
    if (SSm && site && SSm.possibleParts(site, audit.gridSnapshot).length > 1) {
      const parts = await askPerimeter(SSm, audit, site, { title: 'Ajouter une station : périmètre contrôlé', okLabel: 'Ajouter la station' });
      if (!parts) return;
      const pp = SSm.partPrestationIds(site, parts, { grid: audit.gridSnapshot, providerId: audit.providerId });
      const p = v.prestationId ? store.get('prestation', v.prestationId) : null;
      if (p && parts.includes(SSm.prestationType(p, audit.gridSnapshot))) pp[SSm.prestationType(p, audit.gridSnapshot)] = p.id;
      req = { siteId: v.siteId, prestationId: pp[type] || parts.map(k => pp[k]).find(Boolean) || null, parts, partPrestations: pp };
    }
    const updated = await addStation(audit, req, { reason: this.amendReason });
    const key = stationKeyOf(v.siteId);
    lastStation.set(audit.id, key);
    toast(`Station ${store.get('site', v.siteId)?.name || ''} ajoutée à la tournée (${updated.stations.length} stations)`, 'ok');
    navigate(`/audit/${audit.id}/feuille-1@${key}`);
  },
  /**
   * « Périmètre contrôlé » d'une station (onglet Infos, avant la signature du contrôleur) : cases « Biologie »,
   * « Chimie »… ; points d'une partie retirée masqués (saisies conservées) : motif obligatoire s'ils contiennent des
   * saisies, écarts ouverts annulés avec le même motif après confirmation.
   */
  async 'tour-parts'(el) {
    const audit = store.get('audit', this.params.id);
    const key = el.dataset.key;
    const stn = (audit.stations || []).find(s => s.key === key);
    if (!stn) return;
    const SSm = await loadStationSheet();
    if (!SSm) { toast('Choix du périmètre indisponible sur cet appareil.', 'err', 5000); return; }
    const site = store.get('site', stn.siteId);
    const name = site?.name || key;
    const before = stationPartsOf(audit, stn);
    const parts = await askPerimeter(SSm, audit, site || { id: stn.siteId, name, code: key }, { title: `Périmètre contrôlé à ${name}`, parts: before });
    if (!parts || parts.join() === before.join()) return;
    // Prestations programmées du prestataire pour les parties AJOUTÉES (celles déjà rattachées restent).
    const pp = SSm.partPrestationIds(site, parts.filter(k => !before.includes(k)), { grid: audit.gridSnapshot, providerId: audit.providerId });
    try { await setStationParts(audit, key, parts, { partPrestations: pp }); }
    catch (e) {
      if (!e.needsReason && !e.needsCancel) { toast(e.message, 'err', 6000); return; }
      const n = e.entries || {};
      const open = e.openDeviations || [];
      const numbers = open.map(d => d.number).join(', ');
      let reason = null;
      if (e.needsReason) {
        reason = await promptDialog({ title: `Périmètre contrôlé à ${name}`, label: 'Motif de la modification (obligatoire)', hint: `Constats déjà saisis qui ne seront plus affichés : ${n.responses?.length || 0} réponse(s), ${n.sheets?.length || 0} encadré(s), ${n.media || 0} preuve(s), ${n.deviations || 0} écart(s). Ils sont conservés dans la tournée et réapparaissent si la partie est de nouveau cochée.${open.length ? ` Écart(s) ouvert(s) : ${numbers} — ils seront annulés avec ce motif.` : ''}` });
        if (!reason) return;
      }
      if (open.length && !(await confirmDialog({ title: 'Écarts ouverts', message: `${open.length} écart(s) ouvert(s) portent sur des points qui ne seront plus affichés : ${numbers}. ${open.length > 1 ? 'Ils seront annulés' : 'Il sera annulé'} avec le motif « ${reason || ''} » (annulation tracée dans l’historique de l’écart). Continuer ?`, okLabel: 'Annuler les écarts et modifier', cancelLabel: 'Ne rien changer', danger: true }))) return;
      try { await setStationParts(audit, key, parts, { reason, cancelDeviations: open.length > 0, partPrestations: pp }); }
      catch (e2) { toast(e2.message, 'err', 6000); return; }
    }
    toast(`Périmètre contrôlé à ${name} : ${partsText(audit.gridSnapshot, parts)}`, 'ok');
    this.refresh();
  },
  /**
   * Retrait d'une station : simple sans saisie, sinon motif obligatoire (saisies conservées dans l'historique) ;
   * écarts OUVERTS de la station : annulés avec le même motif après confirmation, sinon la station reste.
   */
  async 'tour-remove'(el) {
    const audit = store.get('audit', this.params.id);
    const key = el.dataset.key;
    const stn = (audit.stations || []).find(s => s.key === key);
    if (!stn) return;
    const name = store.get('site', stn.siteId)?.name || key;
    if (!(await confirmDialog({ title: 'Retirer la station', message: `Retirer la station ${name} de la tournée ${audit.number} ?`, okLabel: 'Retirer', danger: true }))) return;
    try { await removeStation(audit, key, {}); }
    catch (e) {
      if (!e.needsReason && !e.needsCancel) throw e;
      const n = e.entries || {};
      const open = e.openDeviations || [];
      const numbers = open.map(d => d.number).join(', ');
      let reason = null;
      if (e.needsReason) {
        reason = await promptDialog({ title: `Retirer ${name}`, label: 'Motif du retrait (obligatoire)', hint: `Constats déjà saisis pour cette station : ${n.responses?.length || 0} réponse(s), ${n.sheets?.length || 0} encadré(s), ${n.media || 0} preuve(s), ${n.deviations || 0} écart(s). Ils sont conservés dans l’historique de la tournée.${open.length ? ` Écart(s) ouvert(s) : ${numbers} — ils seront annulés avec ce motif.` : ''}` });
        if (!reason) return;
      }
      if (open.length && !(await confirmDialog({ title: 'Écarts ouverts de la station', message: `La station ${name} a ${open.length} écart(s) ouvert(s) : ${numbers}. Pour la retirer de la tournée, ${open.length > 1 ? 'ils seront annulés' : 'il sera annulé'} avec le motif « ${reason || ''} » (annulation tracée dans l’historique de l’écart). Continuer ?`, okLabel: 'Annuler les écarts et retirer', cancelLabel: 'Garder la station', danger: true }))) return;
      await removeStation(audit, key, { reason, cancelDeviations: open.length > 0 });
    }
    if (lastStation.get(audit.id) === key) lastStation.delete(audit.id);
    toast(`Station ${name} retirée de la tournée`, 'ok');
    const step = String(this.params.step || '');
    navigate(step.endsWith('@' + key) || !step ? `/audit/${audit.id}/infos` : `/audit/${audit.id}/${step}`);
  },
  /** « Rejoindre la tournée » : l'agent connecté devient contrôleur (journal + historique ; rien n'est effacé). */
  async 'tour-join'() {
    try { await joinTour(store.get('audit', this.params.id)); }
    catch (e) { toast(e.message, 'err', 5000); return; }
    toast('Vous avez rejoint la tournée : vos saisies vous seront attribuées.', 'ok');
    this.refresh();
  },
  /** Ajout d'un collègue aux contrôleurs (par un contrôleur de la tournée). */
  async 'ctrl-add'(el) {
    const id = el.value;
    if (!id) return;
    try { await addController(store.get('audit', this.params.id), id); }
    catch (e) { toast(e.message, 'err', 5000); el.value = ''; return; }
    toast(`${store.get('user', id)?.name || 'Agent'} ajouté(e) aux contrôleurs de la tournée`, 'ok');
    this.refresh();
  },
  /** Retrait d'un contrôleur (jamais le dernier), motif obligatoire ; ses saisies restent dans la tournée. */
  async 'ctrl-remove'(el) {
    const audit = store.get('audit', this.params.id);
    const who = tourControllers(audit).find(x => x.id === el.dataset.id);
    if (!who) return;
    const reason = await promptDialog({ title: `Retirer ${who.name} de la tournée`, label: 'Motif (obligatoire)', hint: 'Ses saisies restent dans la tournée et lui restent attribuées.', multiline: false });
    if (!reason) return;
    try { await removeController(audit, who.id, { reason }); }
    catch (e) { toast(e.message, 'err', 5000); return; }
    toast(`${who.name} retiré(e) des contrôleurs de la tournée`, 'ok');
    this.refresh();
  },
  /** Fiches de contrôle remplies (PDF) : module js/app/sheets-pdf.js (chargé à la demande). */
  async 'sheets-pdf'() {
    let mod = null;
    try { mod = await import('../app/sheets-pdf.js'); } catch (e) { mod = null; }
    if (typeof mod?.generateSheetsPdf !== 'function') { toast('Génération des fiches de contrôle (PDF) non disponible dans cette version de l’application. Le rapport d’audit détaillé reste disponible.', 'warn', 6000); return; }
    toast('Génération des fiches de contrôle…', '', 2000);
    const r = await mod.generateSheetsPdf({ auditId: this.params.id });
    const { downloadBlob } = await import('../ui/dom.js');
    downloadBlob(r.bytes, r.filename, 'application/pdf');
    toast(`Fiches de contrôle ${r.provisional ? 'provisoires ' : ''}générées${r.pages ? ` (${r.pages} pages)` : ''}`, 'ok');
  }
};

/** Étape d'une ancienne adresse (« feuille-4 » d'une tournée) : première instance de la feuille. */
export function normalizeStep(audit, st, step) {
  if (!step || !/^feuille-[^@]+$/.test(step)) return step;
  const no = step.slice(8);
  const sh = st.sheets.find(x => String(x.no) === no && (!x.station || x.station.key === (lastStation.get(audit.id) || x.station.key)));
  return sh ? sheetStep(sh) : step;
}
