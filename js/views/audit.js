/* Audit terrain : Section → Critère → Réponse → Preuve → Validation.
 * Enregistrement automatique de chaque saisie sur l'appareil (« continuer plus tard » hors connexion),
 * alertes intelligentes (jamais converties automatiquement en non-conformité), écarts, synthèse,
 * signatures, verrouillage scellé, puis modifications uniquement motivées et historisées ; « Annuler la tournée »
 * (motif obligatoire, confirmation, retour à l'accueil).
 * Deux affichages : grilles « en feuilles » (CT-2026 : tournée de stations, feuilles fidèles aux fiches papier —
 * js/views/audit-sheet.js) et grilles historiques par sections (ci-dessous). Les actions de saisie sont communes. */
import { html, raw, fmtDate, fmtTime, fmtDateTime, localDate, localTime, localDateTime, nowISO, sortBy } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, canEditAudit } from '../core/auth.js';
import { mediaFor } from '../core/media.js';
import { navigate } from '../ui/router.js';
import { toast, promptDialog, confirmDialog, openModal, downloadBlob, choiceDialog } from '../ui/dom.js';
import { kv, badge, thumbs, hydrateMedia, evidenceButtons, voiceBtn, progressBar, auditBadge, critBadge, deviationBadge, empty, operatorName, siteName, providerName, kindBadge } from '../ui/components.js';
import { addFilesFromInput, viewMedia } from '../ui/capture.js';
import { RESPONSES, DOMAINS, DOC_TYPES, responseText, defaultCriticality, auditDate, OPEN_DEVIATION, auditKindLabel, auditTimeTexts } from '../domain/model.js';
import { allowedResponses, isAnswered, isAnswerable, needsJustification, isEnteredResponse } from '../domain/grids.js';
import { auditState, setResponse, updateAudit, finishAudit, reopenAudit, signAudit, lockAudit, verifyAuditSeal, cancelTour, cancelTourRefusal, auditDeviations, controllersLabel, canJoinAudit } from '../app/audits.js';
import { refLabel, refArticle } from '../app/documents.js';
import { operatorsModule, operatorHandlers, equipmentModule, equipmentHandlers, gpsModule, gpsHandlers, samplesModule, sampleHandlers, openDeviationForm, deviationChips, alertBox, documentsCard, signaturesStep, findItem, allowClear, cancelTourButton, cancelTourBlock, cancelledBanner } from './audit-modules.js';
import { isSheetAudit, renderSheetAudit, mountSheetAudit, unmountSheetAudit, sheetHandlers, refreshKeep, normalizeStep, issueHrefFor, deName } from './audit-sheet.js';

const amendState = new Map();   // « utilisateur:audit » → motif de la modification en cours (audit signé)
const amendBaseline = new Map(); // même clé → points bloquants déjà présents au début de la modification
const amendKey = id => `${session.user?.id}:${session.unlockedAt}:${id}`;
/** Points bloquants (erreurs du contrôle avant clôture) d'un audit, identifiés par critère, champ et message. */
const issueKey = e => `${e.itemId || ''}|${e.field || ''}|${e.message}`;
const blockingIssues = audit => auditState(audit).validation.filter(v => v.level === 'error');

const STEP_FIXED = { identification: '🪪 Identification', ecarts: '⚠️ Écarts', synthese: '📊 Synthèse', signatures: '✍️ Signatures' };

function stepsOf(st) {
  return ['identification', ...st.structure.filter(s => s.visible).map(s => s.id), 'ecarts', 'synthese', 'signatures'];
}
function itemOptions(item) {
  if (item.optionsFrom === 'method') return store.all('method').map(m => `${m.reference} — ${m.label}`);
  return item.options || [];
}

/* ---------- Critère ---------- */
function itemCard(audit, item, st, editable) {
  const r = audit.responses?.[item.id];
  const n = st.counts[item.id] || 0;
  const answered = isAnswered(item, n ? { ...(r || {}), mediaCount: n } : r);
  const isNC = r?.status === 'NC', isP = r?.status === 'P';
  const missing = !answered && item.required;
  const alerts = st.alerts.filter(a => a.itemId === item.id);
  const media = mediaFor({ type: 'item', id: audit.id, itemId: item.id });
  const dis = editable ? '' : raw('disabled');
  const v = r?.value;
  let control = '';
  const statusBtns = codes => html`<div class="seg">${codes.map(c => html`<button type="button" ${dis} class="${r?.status === c ? 'sel ' + RESPONSES[c].cls : ''}" data-act="resp" data-item="${item.id}" data-value="${c}" aria-pressed="${r?.status === c}"><span class="k">${RESPONSES[c].icon}</span>${RESPONSES[c].label}</button>`)}</div>`;
  const naBtn = item.allowNA ? html`<button type="button" ${dis} class="btn sm ${r?.status === 'NA' ? 'primary' : 'ghost'}" data-act="resp" data-item="${item.id}" data-value="NA">Non applicable</button>` : '';
  switch (item.kind) {
    case 'conformity': control = statusBtns(allowedResponses(item)); break;
    case 'boolean': control = html`<div class="seg">${[['true', 'Oui', 'brand'], ['false', 'Non', 'brand']].map(([val, l, cls]) => html`<button type="button" ${dis} class="${String(v) === val ? 'sel ' + cls : ''}" data-act="val-btn" data-item="${item.id}" data-value="${val}">${l}</button>`)}${item.allowNA ? html`<button type="button" ${dis} class="${r?.status === 'NA' ? 'sel na' : ''}" data-act="resp" data-item="${item.id}" data-value="NA">NA</button>` : ''}</div>`; break;
    case 'select': {
      const opts = itemOptions(item);
      control = opts.length <= 8 ? html`<div class="opt-list">${opts.map(o => html`<button type="button" ${dis} class="${v === o ? 'sel' : ''}" data-act="val-btn" data-item="${item.id}" data-value="${o}">${o}</button>`)}</div>${naBtn}`
        : html`<select ${dis} data-change="val" data-item="${item.id}"><option value="">— choisir —</option>${opts.map(o => html`<option ${v === o ? raw('selected') : ''}>${o}</option>`)}</select>${naBtn}`;
      break;
    }
    case 'multiselect': control = html`<div class="opt-list">${itemOptions(item).map(o => html`<button type="button" ${dis} class="${(v || []).includes(o) ? 'sel' : ''}" data-act="multi" data-item="${item.id}" data-value="${o}">${(v || []).includes(o) ? '✓ ' : ''}${o}</button>`)}</div>`; break;
    case 'number': control = html`<div class="input-wrap"><input ${dis} type="text" inputmode="decimal" value="${v ?? ''}" data-change="val" data-item="${item.id}" data-num placeholder="valeur" style="max-width:220px">${item.unit ? html`<span class="unit">${item.unit}</span>` : ''}${naBtn}</div>`; break;
    case 'text': control = html`<div class="input-wrap"><input ${dis} id="in-${item.id}" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? voiceBtn('in-' + item.id) : ''}${editable && item.scan !== false ? html`<button type="button" class="icon-btn" data-act="scan-val" data-item="${item.id}" title="Scanner">▦</button>` : ''}</div>`; break;
    case 'longtext': control = html`<div class="input-wrap"><textarea ${dis} id="in-${item.id}" data-change="val" data-item="${item.id}">${v ?? ''}</textarea>${editable ? voiceBtn('in-' + item.id) : ''}</div>`; break;
    case 'date': control = html`<div class="input-wrap"><input ${dis} type="date" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="date">Aujourd’hui</button>` : ''}</div>`; break;
    case 'time': control = html`<div class="input-wrap"><input ${dis} type="time" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="time">Maintenant</button>` : ''}</div>`; break;
    case 'datetime': control = html`<div class="input-wrap"><input ${dis} type="datetime-local" value="${v ?? ''}" data-change="val" data-item="${item.id}">${editable ? html`<button type="button" class="btn ghost sm" data-act="now" data-item="${item.id}" data-kind="datetime">Maintenant</button>` : ''}</div>`; break;
    case 'photo': control = html`<p class="note">Photographie requise${n ? ` — ${n} jointe(s) ✓` : ''}.</p>`; break;
    default: control = '';
  }
  const needJ = needsJustification(item, r);
  return html`<article class="item ${answered ? 'answered' : ''} ${isNC ? 'is-nc' : ''} ${isP ? 'is-p' : ''} ${missing && audit.status !== 'en_cours' ? 'missing' : ''}" id="item-${item.id}">
    <div class="item-head">${item.code ? html`<span class="item-code">${item.code}</span>` : ''}<div class="item-label">${item.label}${item.required && isAnswerable(item) ? html` <span class="req" title="obligatoire">*</span>` : ''}</div></div>
    ${item.refs?.length ? html`<div class="item-refs">${item.refs.map((rf, i) => html`<button type="button" class="ref-chip" data-act="ref" data-item="${item.id}" data-i="${i}">📄 ${refLabel(rf, audit.documentsSnapshot)}</button>`)}</div>` : ''}
    ${item.help ? html`<div class="item-help">${item.help}</div>` : ''}
    ${control}
    ${alerts.map(a => alertBox(a, editable))}
    ${isAnswerable(item) ? html`<div class="comment"><label class="label" for="cm-${item.id}">${needJ ? html`Justification obligatoire <span class="req">*</span>` : 'Observation (facultatif)'}</label>
      <div class="input-wrap"><textarea ${editable && !audit.lock?.lockedAt ? raw('data-autosave') : ''} ${dis} id="cm-${item.id}" data-change="comment" data-item="${item.id}" rows="2" style="min-height:56px" placeholder="${needJ ? 'Décrire factuellement l’écart constaté' : 'Constat, précision…'}">${r?.comment || ''}</textarea>${editable ? voiceBtn('cm-' + item.id) : ''}</div></div>` : ''}
    ${thumbs(media)}
    <div class="item-tools">
      ${editable && !audit.lock?.lockedAt ? evidenceButtons({ type: 'item', id: audit.id, itemId: item.id }, { auditId: audit.id }) : ''}
      ${editable && (isNC || isP || r?.status === 'NV' || r?.status === 'NO') && can('deviation.manage') ? html`<button class="btn danger-ghost sm" data-act="dev-new" data-item="${item.id}">⚠ Créer un écart</button>` : ''}
    </div>
    ${deviationChips(audit, item.id)}
    ${r?.at ? html`<div class="item-meta">Saisi le ${fmtDate(r.at)} à ${fmtTime(r.at)} par ${r.byName || ''}${n ? ` · ${n} preuve(s)` : ''}</div>` : ''}
  </article>`;
}

/* ---------- Étapes fixes ---------- */
function identificationStep(audit, st, editable) {
  const prov = store.get('provider', audit.providerId);
  const p = st.prestation;
  return html`
    <div class="card"><h2>Identification de l’audit</h2>${kv([
      ['Numéro d’audit', html`<b class="mono">${audit.number}</b>`], ['Type', auditKindLabel(audit.kind, { long: true })],
      ['Date', fmtDate(auditDate(audit))], ['Heure de début', auditTimeTexts(audit).start], ['Heure de fin', auditTimeTexts(audit).end],
      ['Contrôleur(s) OEG', controllersLabel(audit)], ['Créé par', audit.auditorName], ['Appareil utilisé', audit.device?.name], ['Version de l’application', audit.appVersion],
      ['Grille', `${audit.gridSnapshot?.name} — v${audit.gridVersion}`], ['Version du protocole', audit.protocolVersion || 'non renseignée'], ['Version du CCTP', audit.cctpVersion || 'non renseignée'],
      ['Prestataire', prov ? html`${prov.name} ${kindBadge(prov.kind)}` : '—'], ['Opérateur(s) contrôlé(s)', st.operators.map(o => operatorName(o)).join(', ') || 'à identifier'],
      ['Site', siteName(audit.siteId)], ['Point', store.get('point', audit.pointId)?.code], ['Prestation', p ? html`<a href="#/prestation/${p.id}">${p.ref} — ${fmtDate(p.plannedDate)}</a>` : 'non programmée']
    ])}</div>
    ${documentsCard(audit)}
    ${st.alerts.length ? html`<div class="card"><h2>Alertes en cours (${st.alerts.length})</h2>${st.alerts.map(a => alertBox(a, editable))}</div>` : ''}
    ${editable && !audit.lock?.lockedAt ? html`<div class="card" id="tourActions"><h2>Actions</h2><div class="btn-row">
      <button class="btn ghost" data-act="later">⏸ Continuer plus tard</button></div>
      <p class="note">Chaque saisie est enregistrée immédiatement sur l’appareil, même sans connexion. L’audit peut être repris à tout moment depuis le planning.</p>
      ${cancelTourBlock(audit)}</div>` : cancelTourBlock(audit) ? html`<div class="card" id="tourActions"><h2>Annuler la tournée</h2>${cancelTourBlock(audit)}</div>` : ''}`;
}

function deviationsStep(audit, st, editable) {
  const devs = st.deviations;
  return html`<div class="card"><h2>Écarts de l’audit (${devs.length})</h2>
    ${devs.length ? html`<div class="list">${devs.map(d => html`<a class="li ${d.status === 'clos' ? 'stripe-ok' : 'stripe-nc'}" href="#/ecart/${d.id}"><div class="li-main"><div class="li-title">${d.number}${d.itemCode ? ' · ' + d.itemCode : ''}</div><div class="li-sub">${d.requirement}</div><div class="li-sub">${d.description}</div><div class="row" style="gap:6px;margin-top:4px">${critBadge(d.criticalityCode)}${deviationBadge(d.status)}${d.dueDate ? badge('Délai ' + fmtDate(d.dueDate), 'outline') : ''}</div></div><span class="chev">›</span></a>`)}</div>`
      : empty('✅', 'Aucun écart enregistré pour cet audit.')}
    ${editable && can('deviation.manage') ? html`<button class="btn danger lg block" style="margin-top:12px" data-act="dev-new">⚠ Enregistrer un écart</button>` : ''}
  </div>
  ${st.alerts.filter(a => a.deviation).length ? html`<div class="card"><h2>Alertes pouvant justifier un écart</h2>${st.alerts.filter(a => a.deviation).map(a => alertBox(a, editable))}</div>` : ''}`;
}

function synthesisStep(audit, st, editable) {
  const s = st.summary, c = s.counts;
  const tiles = [['Critères contrôlés', c.controlled, ''], ['Conformes', c.C, 'ok'], ['Non conformes', c.NC, 'nc'], ['Non applicables', c.NA, 'na'], ['Non observés', c.NO, 'no'], ['Non vérifiables', c.NV, 'nv'], ['Écarts', s.deviationsCount, 'nc'], ['Échantillons', s.samples, ''], ['Équipements', s.equipment, '']];
  const max = Math.max(1, ...s.byCriticality.map(x => x.count));
  const dis = editable ? '' : raw('disabled');
  // Grille historique (par sections) : décomptes seulement ; la note sur 20 concerne les tournées en feuilles (CT-2026).
  return html`<div class="card"><h2>Synthèse factuelle <span class="badge outline" title="La note sur 20 concerne les tournées de la grille CT-2026 (fiches en feuilles)">grille historique : sans note sur 20</span></h2>
      <div class="kpis">${tiles.map(([k, v, cls]) => html`<div class="kpi"><span class="k">${k}</span><span class="v" style="${cls ? `color:var(--${cls})` : ''}">${v}</span></div>`)}</div>
      <h3>Écarts par niveau de criticité</h3>
      <div class="bars">${s.byCriticality.map(b => html`<div class="bar-row"><span class="bl">${b.label}</span><span class="bt"><span style="width:${b.count / max * 100}%;background:${b.color || 'var(--sky)'}"></span></span><span class="bn">${b.count}</span></div>`)}</div>
      ${s.frequentRequirements.length ? html`<h3>Exigences les plus fréquemment non conformes</h3><ul>${s.frequentRequirements.map(f => html`<li>${f.requirement} — <b>${f.count}</b></li>`)}</ul>` : ''}
      <h3>Points forts (constatés)</h3>${s.strengths.length ? html`<ul>${s.strengths.map(x => html`<li>${x}</li>`)}</ul>` : html`<p class="note">Aucune section entièrement conforme.</p>`}
      <h3>Points de vigilance</h3>${s.vigilance.length ? html`<ul>${s.vigilance.map(x => html`<li>${x}</li>`)}</ul>` : html`<p class="note">Aucun point de vigilance.</p>`}
      <h3>Actions demandées</h3>${s.actions.length ? html`<ul>${s.actions.map(a => html`<li><b>${a.number}</b> (${a.criticality}) : ${a.action || a.immediate}${a.responsible ? ' — ' + a.responsible : ''}${a.dueDate ? ' — avant le ' + fmtDate(a.dueDate) : ''}</li>`)}</ul>` : html`<p class="note">Aucune action demandée.</p>`}
    </div>
    <div class="card"><h2>Conclusions de l’auditeur</h2>
      <div class="field"><label>Points forts complémentaires</label><div class="input-wrap"><textarea ${editable && !audit.lock?.lockedAt ? raw('data-autosave') : ''} ${dis} id="cc-strengths" data-change="concl" data-k="strengths">${audit.conclusions?.strengths || ''}</textarea>${editable ? voiceBtn('cc-strengths') : ''}</div></div>
      <div class="field"><label>Points de vigilance complémentaires</label><div class="input-wrap"><textarea ${editable && !audit.lock?.lockedAt ? raw('data-autosave') : ''} ${dis} id="cc-vigilance" data-change="concl" data-k="vigilance">${audit.conclusions?.vigilance || ''}</textarea>${editable ? voiceBtn('cc-vigilance') : ''}</div></div>
      <div class="field"><label>Commentaire général</label><div class="input-wrap"><textarea ${editable && !audit.lock?.lockedAt ? raw('data-autosave') : ''} ${dis} id="cc-comment" data-change="concl" data-k="comment">${audit.conclusions?.comment || ''}</textarea>${editable ? voiceBtn('cc-comment') : ''}</div></div>
    </div>`;
}

/* ---------- Vue ---------- */
export default {
  nav: 'audits', title: 'Audit',
  async render({ id, step }, q, ctx) {
    const audit = store.get('audit', id);
    if (!audit) return html`<div class="card">${empty('❓', 'Audit introuvable sur cet appareil.')}<a class="btn ghost" href="#/audits">Liste des audits</a></div>`;
    const locked = !!audit.lock?.lockedAt;
    const amendReason = amendState.get(amendKey(audit.id)) || null;
    ctx.amendReason = amendReason;
    ctx.sheetView = null;
    const editable = locked ? (!!amendReason && can('audit.amend')) : (canEditAudit(audit) && audit.status !== 'abandonne');
    // Grille « en feuilles » (CT-2026) : tournée de stations, feuilles fidèles aux fiches papier.
    if (isSheetAudit(audit)) {
      const st = auditState(audit, { includeMissing: step === 'signatures' });
      const seal = locked && (step === 'signatures' || !step) ? await verifyAuditSeal(audit) : null;
      const view = await renderSheetAudit({ audit, st, step: normalizeStep(audit, st, step), q, editable, locked, amendReason, seal });
      ctx.sheetView = view;
      return view.html;
    }
    const st = auditState(audit, { includeMissing: step === 'signatures' });
    const steps = stepsOf(st);
    const cur = steps.includes(step) ? step : (audit.status === 'en_cours' ? (st.structure.find(s => s.visible && st.progress.bySection[s.id]?.answered < st.progress.bySection[s.id]?.total)?.id || 'identification') : 'signatures');
    const idx = steps.indexOf(cur);
    const sec = st.structure.find(s => s.id === cur);
    const bs = sec ? st.progress.bySection[sec.id] : null;
    // Indicateur Section → Critère → Réponse → Preuve → Validation
    const ncNoEvidence = sec ? sec.visibleItems.some(it => audit.responses?.[it.id]?.status === 'NC' && (!(audit.responses[it.id].comment || '').trim() || !(st.counts[it.id] > 0))) : false;
    const stepState = [
      ['Section', 'cur'],
      ['Critère', bs ? (bs.missingRequired === 0 ? 'done' : 'cur') : 'done'],
      ['Réponse', bs ? (bs.answered === bs.total ? 'done' : '') : (st.progress.answered === st.progress.total ? 'done' : '')],
      ['Preuve', sec ? (ncNoEvidence ? '' : 'done') : ''],
      ['Validation', locked ? 'done' : cur === 'signatures' ? 'cur' : '']
    ];
    const chipLabel = s => STEP_FIXED[s] || st.structure.find(x => x.id === s)?.title || s;
    const seal = locked && cur === 'signatures' ? await verifyAuditSeal(audit) : null;
    let body;
    if (cur === 'identification') body = identificationStep(audit, st, editable);
    else if (cur === 'ecarts') body = deviationsStep(audit, st, editable);
    else if (cur === 'synthese') body = synthesisStep(audit, st, editable);
    else if (cur === 'signatures') body = signaturesStep(audit, st, editable, seal);
    else {
      const secAlerts = st.alerts.filter(a => a.sectionId === sec.id && !a.itemId);
      body = html`<div class="card" style="padding:12px 14px"><div class="row between"><h2 style="margin:0;border:0;padding:0">${sec.title}</h2><span class="domain-tag ${sec.domain || 'prelevement'}">${DOMAINS[sec.domain || 'prelevement']}</span></div>
          ${sec.help ? html`<p class="note" style="margin:8px 0 0">${sec.help}</p>` : ''}
          ${sec.domain === 'transport' ? html`<div class="banner scope" style="margin:10px 0 0">Contrôle de la partie pré-analytique liée au prélèvement. Les analyses de laboratoire sont hors périmètre de l’audit.</div>` : ''}</div>
        ${secAlerts.map(a => alertBox(a, editable))}
        ${sec.module === 'operators' ? operatorsModule(audit, editable) : sec.module === 'equipment' ? equipmentModule(audit, editable) : sec.module === 'gps' ? gpsModule(audit, editable) : sec.module === 'samples' ? samplesModule(audit, editable) : ''}
        ${sec.visibleItems.map(it => itemCard(audit, it, st, editable))}
        ${sec.items.length > sec.visibleItems.length ? html`<p class="note">${sec.items.length - sec.visibleItems.length} critère(s) masqué(s) car sans objet compte tenu des réponses (logique conditionnelle).</p>` : ''}`;
    }
    return html`
      <div class="audit-head">
        <div class="ah-row"><div style="min-width:0"><div class="ah-num">${audit.number} ${auditBadge(audit)} ${!locked ? cancelTourButton(audit, { cls: 'btn danger-ghost sm as-cancel', id: 'tourCancelTop' }) : ''}</div><div class="ah-meta">${siteName(audit.siteId)} · ${providerName(audit.providerId)}</div></div>
          <div style="text-align:right"><div class="strong">${st.progress.percent} %</div><div class="save-state" id="saveState">${editable ? `Enregistré sur l’appareil ✓ ${fmtTime(audit.updatedAt)}` : locked ? 'Lecture seule' : ''}</div></div></div>
        ${progressBar(st.progress.percent)}
        <div class="steps" style="margin-top:6px">${stepState.map(([l, s], i) => html`${i ? html`<span class="arr">→</span>` : ''}<span class="st ${s}">${l}</span>`)}</div>
        <nav class="sec-chips" aria-label="Sections de l’audit">${steps.map(s => { const p = st.progress.bySection[s]; const done = p && p.total && p.answered === p.total; return html`<a class="sec-chip ${s === cur ? 'sel' : ''} ${done ? 'done' : ''} ${p?.nc ? 'hasnc' : ''}" href="#/audit/${audit.id}/${s}" ${s === cur ? raw('aria-current="step"') : ''}><span class="t">${chipLabel(s)}</span>${p ? html`<span class="c">${p.answered}/${p.total}</span>` : s === 'ecarts' && st.deviations.length ? html`<span class="c">${st.deviations.length}</span>` : ''}</a>`; })}</nav>
      </div>
      ${locked ? html`<div class="banner ${amendReason ? 'warn' : 'ok'} locked-banner"><span class="grow">${amendReason ? html`✏️ Modification tracée en cours — motif : « ${amendReason} ». Chaque changement est historisé (valeur précédente conservée).` : '🔒 Audit signé et verrouillé : lecture seule.'}</span>
        ${can('audit.amend') ? (amendReason ? html`<button class="btn sm ghost" data-act="amend-stop">Terminer les modifications</button>` : html`<button class="btn sm ghost" data-act="amend-start">Modifier (avec motif)</button>`) : ''}</div>` : ''}
      ${!locked && canJoinAudit(audit, session.user) ? html`<div class="banner info as-join" id="tourJoin"><span class="grow">Audit ${deName(controllersLabel(audit))}<b>${controllersLabel(audit)}</b>${editable ? ' — en tant qu’encadrement, vous pouvez le modifier.' : ' — rejoignez-le pour saisir avec vos collègues.'}</span><button type="button" class="btn primary sm" data-act="tour-join">Rejoindre la tournée</button></div>`
        : !editable && !locked && audit.status !== 'abandonne' ? html`<div class="banner info">Lecture seule : audit réalisé par ${controllersLabel(audit)}.</div>` : ''}
      ${cancelledBanner(audit)}
      ${body}
      <div class="audit-footer">
        ${idx > 0 ? html`<a class="btn ghost lg" href="#/audit/${audit.id}/${steps[idx - 1]}">◀ Précédent</a>` : html`<a class="btn ghost lg" href="#/">◀ Stations</a>`}
        ${idx < steps.length - 1 ? html`<a class="btn primary lg" href="#/audit/${audit.id}/${steps[idx + 1]}">Suivant ▶</a>` : ''}
      </div>`;
  },
  async mount(root, params, q, ctx) {
    const view = ctx?.sheetView;
    if (view) { await mountSheetAudit(root, { audit: store.get('audit', params.id), siteId: view.siteId, q }); await hydrateMedia(root); return; }
    await hydrateMedia(root);
    if (q.item) { const el = document.getElementById('item-' + q.item); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 60); }
  },
  unmount() { unmountSheetAudit(); },
  handlers: {
    ...operatorHandlers, ...equipmentHandlers, ...gpsHandlers, ...sampleHandlers, ...sheetHandlers,
    async resp(el) {
      const audit = store.get('audit', this.params.id);
      const cur = audit.responses?.[el.dataset.item];
      const value = el.dataset.value;
      // Un nouvel appui sur la réponse déjà choisie l'annule (correction d'une erreur de saisie, tracée) ; audit signé en
      // cours de modification : jamais pour un critère obligatoire, et seulement après confirmation.
      const clear = cur?.status === value;
      if (clear && !(await allowClear(this, audit, el.dataset.item, RESPONSES[value]?.label || value))) return;
      await setResponse(audit, el.dataset.item, clear ? { status: undefined } : { status: value }, { reason: this.amendReason });
      navigator.vibrate?.(20);
      await refreshKeep(this);
    },
    async 'val-btn'(el) {
      const audit = store.get('audit', this.params.id);
      const raw = el.dataset.value, value = raw === 'true' ? true : raw === 'false' ? false : raw;
      const cur = audit.responses?.[el.dataset.item];
      if (cur?.value === value && !(await allowClear(this, audit, el.dataset.item, el.textContent.trim() || raw))) return;
      await setResponse(audit, el.dataset.item, cur?.value === value ? { value: undefined } : { value, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
      this.refresh();
    },
    async multi(el) {
      const audit = store.get('audit', this.params.id);
      const cur = audit.responses?.[el.dataset.item]?.value || [];
      const v = el.dataset.value;
      // Audit signé en cours de modification : la dernière case décochée viderait la réponse (jamais silencieusement).
      if (cur.length === 1 && cur[0] === v && !(await allowClear(this, audit, el.dataset.item, el.textContent.trim() || v))) return;
      await setResponse(audit, el.dataset.item, { value: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }, { reason: this.amendReason });
      this.refresh();
    },
    async val(el) {
      const audit = store.get('audit', this.params.id);
      let v = el.value;
      if (el.dataset.num !== undefined && v !== '') { const n = Number(v.replace(',', '.')); if (!isFinite(n)) { toast('Valeur numérique invalide', 'err'); return; } v = n; }
      await setResponse(audit, el.dataset.item, { value: v === '' ? undefined : v, status: audit.responses?.[el.dataset.item]?.status === 'NA' ? undefined : audit.responses?.[el.dataset.item]?.status }, { reason: this.amendReason });
      await refreshKeep(this);
    },
    async now(el) {
      const audit = store.get('audit', this.params.id);
      const v = el.dataset.kind === 'date' ? localDate() : el.dataset.kind === 'time' ? localTime() : localDateTime();
      const cur = audit.responses?.[el.dataset.item];
      await setResponse(audit, el.dataset.item, { value: v, status: cur?.status === 'NA' ? undefined : cur?.status }, { reason: this.amendReason });
      await refreshKeep(this);
    },
    async comment(el) {
      const audit = store.get('audit', this.params.id);
      const value = el.value.trim();
      // Enregistrement différé pendant la frappe puis « change » à la sortie du champ : pas de seconde écriture identique.
      if ((audit.responses?.[el.dataset.item]?.comment || '') !== value) await setResponse(audit, el.dataset.item, { comment: value || undefined }, { reason: this.amendReason });
      // Feuilles : observation recopiée dans la version « tableau » / « carte » du critère, obligation signalée.
      for (const pfx of ['t', 'k']) {
        const twin = document.getElementById(`${pfx}-o-${el.dataset.item}`);
        if (!twin) continue;
        if (twin !== el) twin.value = el.value;
        twin.classList.toggle('need', !!twin.dataset.need && !value);
      }
      const s = document.getElementById('saveState'); if (s) s.textContent = `Enregistré sur l’appareil ✓ ${localTime()}`;
    },
    async concl(el) {
      const audit = store.get('audit', this.params.id);
      if ((audit.conclusions?.[el.dataset.k] || '') !== el.value) await updateAudit(audit, a => { a.conclusions = { ...(a.conclusions || {}), [el.dataset.k]: el.value }; }, { reason: this.amendReason });
      const s = document.getElementById('saveState'); if (s) s.textContent = `Enregistré sur l’appareil ✓ ${localTime()}`;
    },
    async voice(el) { (await import('../ui/voice.js')).dictate(document.getElementById(el.dataset.target)); },
    async 'scan-val'(el) {
      const { scanCode } = await import('../ui/scanner.js');
      const v = await scanCode(); if (!v) return;
      await setResponse(store.get('audit', this.params.id), el.dataset.item, { value: v }, { reason: this.amendReason });
      this.refresh();
    },
    async 'media-add'(el) {
      await addFilesFromInput(el, { auditId: this.params.id });
      this.refresh();
    },
    async 'media-view'(el) { await viewMedia(el.dataset.id, { readOnly: !!store.get('audit', this.params.id)?.lock?.lockedAt, onChange: () => this.refresh() }); },
    /* Photographies de la fiche station (feuille 1) : actions de js/views/station-sheet.js, chargé à la demande. */
    async 'st-photo'(el, ev) { const m = await import('./station-sheet.js'); return m.stationHandlers['st-photo'].call(this, el, ev); },
    async 'st-photo-view'(el, ev) { const m = await import('./station-sheet.js'); return m.stationHandlers['st-photo-view'].call(this, el, ev); },
    async ref(el) {
      const audit = store.get('audit', this.params.id);
      const item = findItem(audit, el.dataset.item);
      const rf = item?.refs?.[Number(el.dataset.i)];
      if (!rf) return;
      const art = refArticle(rf, audit.documentsSnapshot);
      openModal({ title: refLabel(rf, audit.documentsSnapshot), body: html`${rf.requirement ? html`<p><b>Exigence :</b> ${rf.requirement}</p>` : ''}${art ? html`<div class="doc-article"><h4>${art.number} — ${art.title}</h4><p>${art.text}</p></div><p class="note">Texte de la version figée dans l’audit.</p>` : html`<p class="note">Texte de l’article non disponible dans l’instantané documentaire.</p>`}`, actions: [{ label: 'Fermer', cls: 'primary' }] });
    },
    'doc-snap'(el) {
      const d = store.get('audit', this.params.id).documentsSnapshot[Number(el.dataset.i)];
      openModal({ title: `${d.reference} — v${d.version}`, wide: true, body: html`${kv([['Document', d.name], ['Type', DOC_TYPES[d.type]], ['Version', d.version], ['Application', `${fmtDate(d.applicableFrom)}${d.applicableTo ? ' → ' + fmtDate(d.applicableTo) : ''}`], ['Empreinte SHA-256', html`<span class="mono tiny">${d.sha256}</span>`]])}${(d.articles || []).map(a => html`<div class="doc-article"><h4>${a.number} — ${a.title}</h4><p>${a.text}</p></div>`)}${d.fileMediaId ? html`<button class="btn ghost" data-act="open-file">Ouvrir le fichier joint</button>` : ''}`, actions: [{ label: 'Fermer', cls: 'primary' }], handlers: { async 'open-file'() { await viewMedia(d.fileMediaId, { readOnly: true }); } } });
    },
    async 'dev-new'(el) {
      const audit = store.get('audit', this.params.id);
      let prefill = { source: 'manuel' };
      if (el.dataset.item) {
        const it = findItem(audit, el.dataset.item);
        if (!it) { toast('Critère introuvable dans la grille de l’audit.', 'err'); return; }
        const r = audit.responses?.[it.id];
        // Criticité proposée selon la réponse : P ⇒ observation / piste d'amélioration, NC ⇒ mineure (modifiable).
        prefill = { itemId: it.id, itemCode: it.code, requirement: it.refs?.[0]?.requirement || it.label, docRefs: it.refs || [], description: r?.comment || '', source: 'critere', criticalityCode: defaultCriticality(r?.status) };
      }
      if (audit.lock?.lockedAt) prefill.reason = this.amendReason;
      const dev = await openDeviationForm(audit, prefill);
      if (dev) this.refresh();
    },
    async 'alert-dev'(el) {
      const audit = store.get('audit', this.params.id);
      const a = auditState(audit, { includeMissing: true }).alerts.find(x => x.key === el.dataset.key);
      if (!a) return;
      const it = a.itemId ? findItem(audit, a.itemId) : null;
      const dev = await openDeviationForm(audit, { ...a.deviation, docRefs: a.deviation.refs || [], itemId: a.itemId || null, itemCode: it?.code || (a.itemId ? a.itemId.replace(/^it-/, '') : null), stationKey: a.stationKey ?? undefined, source: 'alerte', alertCode: a.code, criticalityCode: a.level === 'critique' ? 'MAJ' : 'MIN' });
      if (dev) this.refresh();
    },
    async 'alert-dismiss'(el) {
      const reason = await promptDialog({ title: 'Ne pas retenir cette alerte', label: 'Motif (décision de l’auditeur)', required: true });
      if (!reason) return;
      await updateAudit(store.get('audit', this.params.id), a => { a.dismissedAlerts = [...(a.dismissedAlerts || []), { key: el.dataset.key, reason, at: nowISO(), by: session.user.name }]; }, { reason: this.amendReason || reason });
      this.refresh();
    },
    async finish() {
      await finishAudit(store.get('audit', this.params.id));
      toast('Audit terminé : heure de fin enregistrée', 'ok'); this.refresh();
    },
    async reopen() { await reopenAudit(store.get('audit', this.params.id)); this.refresh(); },
    async 'sign-auditor'() {
      const { signaturePad } = await import('../ui/signature.js');
      const audit = store.get('audit', this.params.id);
      const sheets = isSheetAudit(audit);
      const s = await signaturePad({ title: sheets ? 'Signature du contrôleur OEG' : 'Signature de l’auditeur', signer: session.user.name, statement: sheets ? `Je certifie l’exactitude des constats consignés dans la présente tournée (contrôleurs : ${controllersLabel(audit)}).` : 'Je certifie l’exactitude des constats consignés dans le présent audit.' });
      if (!s) return;
      try { await signAudit(store.get('audit', this.params.id), 'auditor', { ...s, name: session.user.name, fn: sheets ? 'Contrôleur OEG' : 'Auditeur' }); }
      catch (e) { toast(e.message, 'err', 5000); return; }
      toast(sheets ? 'Signature du contrôleur enregistrée' : 'Signature de l’auditeur enregistrée', 'ok'); this.refresh();
    },
    async 'sign-provider'() {
      const name = document.getElementById('repName')?.value.trim(), fn = document.getElementById('repFn')?.value.trim();
      if (!name) { toast('Indiquez le nom du représentant du prestataire.', 'err'); return; }
      const { signaturePad } = await import('../ui/signature.js');
      const s = await signaturePad({ title: 'Signature du représentant du prestataire', signer: `${name}${fn ? ' — ' + fn : ''}`, statement: 'Je reconnais avoir pris connaissance des constats de l’audit.' });
      if (!s) return;
      await signAudit(store.get('audit', this.params.id), 'provider', { ...s, name, fn });
      toast('Signature du représentant enregistrée', 'ok'); this.refresh();
    },
    async 'refuse-provider'() {
      const name = document.getElementById('repName')?.value.trim();
      const reason = await promptDialog({ title: 'Refus ou absence de signature', label: 'Motif (refus, représentant absent, impossibilité…)', required: true });
      if (!reason) return;
      await signAudit(store.get('audit', this.params.id), 'provider', { name, refused: true, comment: reason });
      this.refresh();
    },
    async lock() {
      if (!(await confirmDialog({ title: 'Verrouiller l’audit', message: 'Le contenu sera scellé. Les modifications ultérieures exigeront un motif et seront historisées. Continuer ?', okLabel: 'Verrouiller' }))) return;
      try { await lockAudit(store.get('audit', this.params.id)); toast('Audit signé et verrouillé 🔒', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      this.refresh();
    },
    async verify() { const r = await verifyAuditSeal(store.get('audit', this.params.id)); toast(r.message, r.ok ? 'ok' : 'err', 6000); this.refresh(); },
    async 'amend-start'() {
      const reason = await promptDialog({ title: 'Modifier un audit signé', label: 'Motif de la modification (obligatoire)', hint: 'Le motif, l’auteur, la date et les valeurs avant/après seront conservés.' });
      if (!reason) return;
      amendState.set(amendKey(this.params.id), reason);
      amendBaseline.set(amendKey(this.params.id), new Set(blockingIssues(store.get('audit', this.params.id)).map(issueKey)));
      await store.log('amend-start', { entityType: 'audit', entityId: this.params.id, entityLabel: store.get('audit', this.params.id).number, reason });
      this.refresh();
    },
    async 'amend-stop'() {
      // Clôture des modifications refusée tant qu'elles ont introduit un point bloquant (réponse obligatoire effacée,
      // P / NC sans observation…) : l'audit signé doit rester complet.
      const audit = store.get('audit', this.params.id);
      const before = amendBaseline.get(amendKey(audit.id)) || new Set();
      const added = blockingIssues(audit).filter(e => !before.has(issueKey(e)));
      if (added.length) {
        const href = isSheetAudit(audit) ? issueHrefFor(audit, auditState(audit)) : e => `#/audit/${audit.id}/${e.sectionId}`;
        const m = openModal({
          title: 'Modifications à compléter',
          body: html`<div class="banner nc">${added.length} point(s) bloquant(s) introduit(s) par la modification en cours : complétez-les avant de terminer les modifications (l’audit signé doit rester complet).</div>
            <div class="list as-issues">${added.map(e => html`<a class="li stripe-nc" href="${href(e)}"><div class="li-main"><div class="li-sub">${e.message}</div></div><span class="chev">›</span></a>`)}</div>`,
          actions: [{ label: 'Continuer les modifications', cls: 'primary' }]
        });
        m.root.addEventListener('click', ev => { if (ev.target.closest('a[href^="#/"]')) m.close(); });
        return;
      }
      amendState.delete(amendKey(this.params.id));
      amendBaseline.delete(amendKey(this.params.id));
      await store.log('amend-stop', { entityType: 'audit', entityId: this.params.id, entityLabel: store.get('audit', this.params.id).number });
      this.refresh();
    },
    async report() {
      toast('Génération du rapport…', '', 1500);
      const { generateAuditReport } = await import('../app/report.js');
      const r = await generateAuditReport(this.params.id);
      downloadBlob(r.bytes, r.filename, 'application/pdf');
      toast(`Rapport ${r.provisional ? 'provisoire ' : ''}généré (${r.pages} pages)`, 'ok');
      this.refresh();
    },
    async dossier() {
      const { buildAuditDossier } = await import('../app/exports.js');
      const audit = store.get('audit', this.params.id);
      const pkg = await buildAuditDossier(audit.id);
      downloadBlob(JSON.stringify(pkg), `${audit.number}_dossier_preuve.json`, 'application/json');
      await store.log('export', { entityType: 'audit', entityId: audit.id, entityLabel: audit.number, details: 'Dossier de preuve JSON' });
    },
    later() { toast('Audit enregistré sur l’appareil : reprise possible depuis l’accueil ou le planning.', 'ok'); navigate('/'); },
    /**
     * « Annuler la tournée » (en-tête ou onglet Infos) : refus expliqué (tournée signée et verrouillée, agent qui n'en
     * est pas contrôleur…), motif obligatoire dans une fenêtre qui ne se ferme pas par un appui hors du cadre (clavier
     * d'une tablette Android), écarts ouverts annoncés puis annulés avec le même motif ; message de confirmation et
     * retour à l'accueil (la tournée n'apparaît plus dans les tournées en cours ni dans les listes par défaut).
     */
    async abandon() {
      const audit = store.get('audit', this.params.id);
      const refusal = cancelTourRefusal(audit, session.user);
      if (refusal) { toast(refusal, 'err', 7000); return; }
      const open = auditDeviations(audit.id).filter(d => OPEN_DEVIATION.includes(d.status));
      const n = Object.values(audit.responses || {}).filter(isEnteredResponse).length;
      const stations = (audit.stations || []).length;
      const reason = await promptDialog({
        title: `Annuler la tournée ${audit.number}`, label: 'Motif de l’annulation', okLabel: 'Annuler la tournée', cancelLabel: 'Garder la tournée',
        dismissable: false, danger: true, placeholder: 'Ex. : crue, accès impossible, prélèvement reporté par le prestataire…',
        hint: `${stations > 1 ? `${stations} stations` : stations ? '1 station' : ''}${n ? ` · ${n} réponse${n > 1 ? 's' : ''} saisie${n > 1 ? 's' : ''} (conservée${n > 1 ? 's' : ''})` : ''}${open.length ? ` · écart${open.length > 1 ? 's' : ''} ouvert${open.length > 1 ? 's' : ''} ${open.map(d => d.number).join(', ')} : ${open.length > 1 ? 'ils seront annulés' : 'il sera annulé'} avec ce motif` : ''}. La tournée annulée n’apparaît plus dans les tournées en cours ; elle reste consultable (Audits › filtre « Annulées »).`.replace(/^ · /, '')
      });
      if (!reason) return;
      try { await cancelTour(store.get('audit', audit.id), reason, { cancelDeviations: open.length > 0 }); }
      catch (e) { toast(e.message, 'err', 7000); return; }
      toast(`Tournée ${audit.number} annulée${open.length ? ` (${open.length} écart${open.length > 1 ? 's' : ''} annulé${open.length > 1 ? 's' : ''})` : ''}`, 'ok', 6000);
      navigate('/');
    }
  }
};
