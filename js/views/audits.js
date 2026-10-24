/* Liste et historique des audits : par prestataire, site, point, statut, période ; sélection de deux
 * audits à comparer. « Historique et comparaison » (?vue=historique : tri par date, recherche ouverte) est une vue de
 * cet écran, choisie par une puce (une seule entrée de menu « Audits »). Tournées annulées (« Annuler la tournée ») masquées par défaut, visibles sous la puce
 * « Annulées » avec la date, l'auteur et le motif de l'annulation. Contrôleurs OEG de chaque tournée (binôme)
 * affichés ; « Mes audits » : tournées dont l'agent connecté est contrôleur ; tournées en cours de l'agent connecté
 * en tête de liste.
 * NOTE SUR 20 (validé par l'OEG le 24/10/2026) : badge « 17,7 / 20 · Satisfaisant » aux couleurs de l'appréciation sur
 * chaque tournée (gradeTag) — tournée signée : note définitive (figée à la signature ; « calculée » si elle a été signée
 * avant la notation, « recalculée » après une modification tracée) ; tournée en cours ou à signer : note provisoire en
 * gris « provisoire » ; aucun point évalué : « non noté » discret ; tournée annulée : rien. « Trier : Date | Note
 * décroissante | Note croissante » (?tri=note|note-asc, tournées non notées en dernier), conservé par « Effacer » ;
 * notes mémorisées par tournée (auditListGrade de js/app/audits.js), décomptes des tournées signées aussi (rowState) :
 * changer de tri ou de filtre ne recalcule que les tournées non signées. */
import { html, fmtDate, sortBy, normalize, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { navigate } from '../ui/router.js';
import { toast, downloadBlob } from '../ui/dom.js';
import { pageTitle, auditBadge, options, empty, siteName, providerName, badge, progressBar, tourStationsLabel, auditSiteIds } from '../ui/components.js';
import { AUDIT_STATUS, auditDate, byAuditDateDesc, auditKindLabel } from '../domain/model.js';
import { auditState, controllersLabel, isAuditController, auditListGrade, auditDeviations } from '../app/audits.js';
import { compareListGrades } from '../domain/grading.js';
import { gradeTag } from '../ui/sheet-chrome.js';

let selected = [];
/**
 * Tris proposés : [valeur de ?tri, libellé, sens (téléphone : « Note ↓ », le sens en toutes lettres restant lu par les
 * lecteurs d'écran), flèche, info-bulle].
 */
const SORTS = [
  ['', 'Date', '', '', 'Les plus récentes d’abord (vos tournées en cours en tête)'],
  ['note', 'Note', 'décroissante', '↓', 'Note sur 20, de la meilleure à la plus faible (tournées non notées en dernier)'],
  ['note-asc', 'Note', 'croissante', '↑', 'Note sur 20, de la plus faible à la meilleure (tournées non notées en dernier)']
];
const sortOf = q => (SORTS.some(([k]) => k && k === q.tri) ? q.tri : '');

/*
 * Ligne d'une tournée : décomptes C / P / NC, nombre d'écarts, avancement. Tournée verrouillée (contenu figé : seul un
 * amendement, qui remplace l'objet dans le dépôt, le change) : décomptes mémorisés par objet, calculés une seule fois ;
 * changer de filtre ou de tri ne recalcule que les tournées non signées. Écarts : toujours lus dans le dépôt.
 */
const LOCKED_COUNTS = new WeakMap();
function rowState(a) {
  if (!a.lock?.lockedAt) { const st = auditState(a); return { counts: st.summary.counts, devs: st.deviations.length, percent: st.progress.percent }; }
  let counts = LOCKED_COUNTS.get(a);
  if (!counts) { counts = auditState(a).summary.counts; LOCKED_COUNTS.set(a, counts); }
  return { counts, devs: auditDeviations(a.id).length, percent: 100 };
}

/** Tournées retenues par les filtres (prestataire, site, point, statut, « Mes audits », période, recherche), sans tri. */
function selection(q) {
  let list = store.all('audit');
  if (q.prestataire) list = list.filter(a => a.providerId === q.prestataire);
  // Tournée : l'audit est retenu si l'une de ses stations correspond.
  if (q.site) list = list.filter(a => auditSiteIds(a).includes(q.site));
  if (q.point) list = list.filter(a => a.pointId === q.point || (a.stations || []).some(st => st.pointId === q.point));
  if (q.statut === 'verrouille') list = list.filter(a => a.lock?.lockedAt);
  else if (q.statut) list = list.filter(a => a.status === q.statut && !a.lock?.lockedAt);
  // Tournées annulées : masquées par défaut (vues « Tous », « Mes audits », « Historique ») ; puce « Annulées ».
  else list = list.filter(a => a.status !== 'abandonne');
  if (q.mine) list = list.filter(a => isAuditController(a, session.user.id));
  if (q.du) list = list.filter(a => auditDate(a) >= q.du);
  if (q.au) list = list.filter(a => auditDate(a) <= q.au);
  if (q.q) { const t = normalize(q.q); list = list.filter(a => normalize(`${a.number} ${tourStationsLabel(a)} ${siteName(a.siteId)} ${providerName(a.providerId)} ${a.auditorName} ${controllersLabel(a)}`).includes(t)); }
  return list;
}

function filtered(q) {
  const list = selection(q);
  const tri = sortOf(q);
  // Tri par note : notes mémorisées par tournée ; notes égales par date (tri stable) ; non notées en dernier.
  if (tri) {
    const grades = new Map(list.map(a => [a, auditListGrade(a)]));
    return [...list].sort(byAuditDateDesc).sort((a, b) => compareListGrades(grades.get(a), grades.get(b), { asc: tri === 'note-asc' }));
  }
  // Tournées en cours dont l'agent connecté est contrôleur (tablette partagée) : en tête ; puis par date.
  const mineOpen = a => a.status === 'en_cours' && !a.lock?.lockedAt && isAuditController(a, session.user?.id) ? 0 : 1;
  return q.vue === 'historique' ? [...list].sort(byAuditDateDesc) : [...list].sort(byAuditDateDesc).sort((a, b) => mineOpen(a) - mineOpen(b));
}

export default {
  nav: 'audits', title: 'Audits',
  async render(params, q) {
    const list = filtered(q);
    const historique = q.vue === 'historique';
    // Annulées masquées par la vue courante (même filtres, sans statut) : signalées sous la liste.
    const hidden = q.statut ? 0 : selection({ ...q, statut: 'abandonne' }).length;
    const tri = sortOf(q);
    const audited = new Set(store.all('audit').flatMap(auditSiteIds));
    const sitesWithAudits = sortBy(store.all('site').filter(s => audited.has(s.id)), 'name');
    const points = q.site ? store.filter('point', p => p.siteId === q.site) : [];
    return html`
      ${pageTitle(historique ? 'Historique et comparaison' : 'Audits', `${list.length} audit(s)${hidden ? ` · ${hidden} annulée${hidden > 1 ? 's' : ''} masquée${hidden > 1 ? 's' : ''}` : ''}`, html`<a class="btn accent" href="#/nouvel-audit">⚡ Audit inopiné</a>`)}
      <div class="chips" style="margin-bottom:10px">
        ${[['', 'Tous'], ['en_cours', 'En cours'], ['termine', 'À signer'], ['verrouille', 'Signés'], ['abandonne', 'Annulées']].map(([k, l]) => html`<button class="chip ${(q.statut || '') === k ? 'sel' : ''}" data-act="q" data-k="statut" data-v="${k}" aria-pressed="${String((q.statut || '') === k)}">${l}</button>`)}
        <button class="chip ${q.mine ? 'sel' : ''}" data-act="q" data-k="mine" data-v="${q.mine ? '' : '1'}" aria-pressed="${String(!!q.mine)}">Mes audits</button>
        <button class="chip ${historique ? 'sel' : ''}" id="auHistory" data-act="q" data-k="vue" data-v="${historique ? '' : 'historique'}" aria-pressed="${String(historique)}" title="Toutes les tournées par date, recherche et comparaison de deux audits">Historique et comparaison</button>
      </div>
      <div class="chips is-wrap au-sort" role="group" aria-label="Trier les tournées"><span class="au-sort-k" aria-hidden="true">Trier&nbsp;:</span>
        ${SORTS.map(([k, l, dir, arrow, t]) => html`<button class="chip ${tri === k ? 'sel' : ''}" data-act="q" data-k="tri" data-v="${k}" aria-pressed="${String(tri === k)}" title="${t}">${l}${dir ? html`<span class="au-dir"> ${dir}</span><span class="au-arrow" aria-hidden="true">${arrow}</span>` : ''}</button>`)}
      </div>
      <details class="card" ${historique || q.prestataire || q.site ? 'open' : ''}><summary>Rechercher dans l’historique</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Prestataire</label><select data-change="qsel" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), q.prestataire, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Site</label><select data-change="qsel" data-k="site">${options(sitesWithAudits, q.site, { placeholder: 'Tous les sites audités', label: s => `${s.name} (${s.code})` })}</select></div>
          ${points.length > 1 ? html`<div class="field"><label>Point</label><select data-change="qsel" data-k="point">${options(points, q.point, { placeholder: 'Tous', label: p => p.code })}</select></div>` : ''}
          <div class="field"><label>Du</label><input type="date" value="${q.du || ''}" data-change="qsel" data-k="du"></div>
          <div class="field"><label>Au</label><input type="date" value="${q.au || ''}" data-change="qsel" data-k="au"></div>
          <div class="field"><label>Recherche</label><input type="search" value="${q.q || ''}" data-change="qsel" data-k="q" placeholder="numéro, site, contrôleur…"></div>
        </div><button class="btn ghost sm" data-act="reset">Effacer</button>
      </details>
      <div class="banner info row between"><span>Comparer deux audits successifs : cochez-en deux (${selected.length}/2).</span>${selected.length === 2 ? html`<button class="btn primary sm" data-act="compare">Comparer</button>` : ''}</div>
      ${list.length ? html`<div class="list">${list.map(a => { const st = rowState(a); const devs = st.devs; const n = st.counts; const lg = auditListGrade(a); return html`
        <div class="li ${a.lock?.lockedAt ? 'stripe-ok' : a.status === 'abandonne' ? '' : 'stripe-info'}">
          <input type="checkbox" aria-label="Sélectionner pour comparaison" data-change="sel" data-id="${a.id}" ${selected.includes(a.id) ? 'checked' : ''}>
          <a class="li-main" href="#/audit/${a.id}" style="text-decoration:none;color:inherit"><div class="li-title">${a.number} — ${tourStationsLabel(a)}</div>
            <div class="li-sub">${fmtDate(auditDate(a))} · ${providerName(a.providerId)} · <span class="au-ctrl" title="Contrôleur(s) OEG de la tournée">${controllersLabel(a) || a.auditorName}</span>${isAuditController(a, session.user?.id) ? ' (vous)' : ''} · ${auditKindLabel(a.kind).toLowerCase()}</div>
            <div class="row" style="gap:6px;margin-top:6px">${auditBadge(a)}${gradeTag(lg)}${badge(`${n.C} C · ${n.P || 0} P · ${n.NC} NC`, n.NC ? 'nc' : n.P ? 'perf' : 'ok')}${devs ? badge(`${devs} écart(s)`, 'warn') : ''}${(a.amendments || []).length ? badge(`${a.amendments.length} modif. après signature`, 'nv') : ''}</div>
            ${a.status === 'en_cours' ? html`<div style="margin-top:6px">${progressBar(st.percent)}</div>` : ''}
            ${a.status === 'abandonne' ? html`<div class="li-sub au-cancel">Annulée${a.cancelledAt ? ` le ${fmtDate(a.cancelledAt)}` : ''}${a.cancelledByName ? ` par ${a.cancelledByName}` : ''} — motif : « ${a.abandonReason || 'non précisé'} »</div>` : ''}</a>
          <span class="chev">›</span></div>`; })}</div>`
        : html`<div class="card">${empty('📋', 'Aucun audit pour cette sélection.')}</div>`}
      ${hidden ? html`<p class="note au-hidden">${hidden} tournée${hidden > 1 ? 's' : ''} annulée${hidden > 1 ? 's' : ''} non affichée${hidden > 1 ? 's' : ''} : puce « Annulées » pour ${hidden > 1 ? 'les' : 'la'} voir.</p>` : ''}`;
  },
  handlers: {
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; if (!el.dataset.v) delete q[el.dataset.k]; navigate('/audits?' + new URLSearchParams(q), { replace: true }); },
    qsel(el) { const q = { ...this.query, [el.dataset.k]: el.value }; if (!el.value) delete q[el.dataset.k]; if (el.dataset.k === 'site') delete q.point; navigate('/audits?' + new URLSearchParams(q), { replace: true }); },
    // Filtres effacés ; vue (historique) et tri conservés.
    reset() { const keep = new URLSearchParams(['vue', 'tri'].filter(k => this.query[k]).map(k => [k, this.query[k]])); navigate('/audits' + (String(keep) ? '?' + keep : ''), { replace: true }); },
    sel(el) {
      selected = el.checked ? [...selected.filter(x => x !== el.dataset.id), el.dataset.id].slice(-2) : selected.filter(x => x !== el.dataset.id);
      this.refresh();
    },
    compare() {
      const [a, b] = sortBy(selected.map(id => store.get('audit', id)).filter(Boolean), auditDate, 'startedAt');
      if (!a || !b) { toast('Sélectionnez deux audits.', 'warn'); return; }
      navigate(`/comparer?a=${a.id}&b=${b.id}`);
    }
  }
};
