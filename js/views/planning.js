/* Planning des prestations : aujourd'hui, à venir, en retard, à planifier (date vide : programme RCS ESC BIO
 * 2026), non auditées ; liste ou calendrier. Chaque prestation renvoie à sa fiche de préparation et à la fiche
 * station ; une ou plusieurs prestations cochées démarrent une tournée de contrôle (#/nouvel-audit). */
import { html, localDate, addDays, fmtDate, normalize, sortBy, groupBy } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/dom.js';
import { pageTitle, prestationBadge, kindBadge, auditBadge, options, empty, siteName } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { PRESTATION_STATUS } from '../domain/model.js';
import { TYPE_STYLES } from '../ui/map.js';
import { prestationType } from './station-sheet.js';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const longDate = d => { const x = new Date(d + 'T12:00:00'); return `${DAYS[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };

/** Audits (tournées) non abandonnés couvrant une prestation : prestation principale ou l'une des prestations de la tournée. */
export function auditsOf(prestationId) { return sortBy(store.filter('audit', a => a.status !== 'abandonne' && (a.prestationId === prestationId || (a.prestationIds || []).includes(prestationId))), '-startedAt'); }
/** Sélection de prestations pour démarrer une tournée (cases à cocher du planning). */
const picked = new Set();
const CLOSED = ['annulee', 'auditee', 'non_realisee'];
export function isLate(p, today = localDate()) { return p.plannedDate && p.plannedDate < today && p.status === 'prevue' && !auditsOf(p.id).length; }

function filterList(q) {
  const today = localDate();
  let list = store.all('prestation');
  const period = q.periode || 'semaine';
  if (q.jour) list = list.filter(p => p.plannedDate === q.jour);
  else if (period === 'jour') list = list.filter(p => p.plannedDate === today);
  else if (period === 'semaine') list = list.filter(p => p.plannedDate >= today && p.plannedDate <= addDays(today, 6));
  else if (period === 'avenir') list = list.filter(p => p.plannedDate >= today);
  else if (period === 'aplanifier') list = list.filter(p => !p.plannedDate && !CLOSED.includes(p.status));
  else if (period === 'retard') list = list.filter(p => isLate(p, today));
  else if (period === 'nonauditees') list = list.filter(p => !auditsOf(p.id).some(a => a.lock?.lockedAt) && !['annulee'].includes(p.status) && p.plannedDate && p.plannedDate <= today);
  if (q.prestataire) list = list.filter(p => p.providerId === q.prestataire);
  if (q.campagne) list = list.filter(p => p.campaignId === q.campagne);
  if (q.statut) list = list.filter(p => p.status === q.statut);
  if (q.q) { const t = normalize(q.q); list = list.filter(p => normalize(`${p.ref} ${siteName(p.siteId)} ${store.get('provider', p.providerId)?.name}`).includes(t)); }
  return sortBy(list, p => p.plannedDate || '9999', 'plannedTime', 'ref');
}

function card(p) {
  const site = store.get('site', p.siteId), prov = store.get('provider', p.providerId);
  const audits = auditsOf(p.id), a = audits[0];
  const late = isLate(p);
  const type = prestationType(p);
  const stripe = late ? 'stripe-nc' : a?.lock?.lockedAt ? 'stripe-ok' : a ? 'stripe-info' : p.status === 'reportee' || !p.plannedDate ? 'stripe-warn' : '';
  const open = !CLOSED.includes(p.status) && !a?.lock?.lockedAt;
  return html`<div class="li pl-li ${stripe}${picked.has(p.id) ? ' is-picked' : ''}">
    ${open && can('audit.create') ? html`<label class="pl-pick" title="Sélectionner pour une tournée"><input type="checkbox" data-change="pick" value="${p.id}" ${picked.has(p.id) ? 'checked' : ''} aria-label="Sélectionner ${site?.name || p.ref} pour une tournée"></label>` : ''}
    <a class="pl-main" href="#/prestation/${p.id}">
      <div class="pl-when"><div class="strong" style="font-size:17px">${p.plannedTime || (p.plannedDate ? '—' : icon('calendar', { size: 22 }))}</div><div class="tiny muted">${!p.plannedDate ? 'à planifier' : p.dateIndicative ? 'indicatif' : fmtDate(p.plannedDate).slice(0, 5)}</div></div>
      <div class="li-main"><div class="li-title">${site?.name || 'Site ?'} <span class="tiny muted">${site?.code || ''}</span></div>
        <div class="li-sub">${prov?.name || '—'} · ${store.get('samplingType', p.samplingTypeId)?.label || 'Type non précisé'}</div>
        <div class="row" style="gap:6px;margin-top:6px">${!p.plannedDate ? html`<span class="badge warn">À planifier</span>` : ''}${prestationBadge(p.status)}${type && TYPE_STYLES[type] ? html`<span class="type-badge t-${type}">${icon(TYPE_STYLES[type].icon, { size: 14 })}${TYPE_STYLES[type].label}</span>` : ''}${kindBadge(prov?.kind)}${late ? html`<span class="badge nc">En retard</span>` : ''}${a ? html`<span class="badge info">${a.number}</span>${auditBadge(a)}` : html`<span class="badge outline">Non auditée</span>`}</div>
      </div></a>
    <span class="pl-side">${site ? html`<a class="btn ghost sm" href="#/station/${encodeURIComponent(site.id)}" title="Fiche station">${icon('station', { size: 18 })}<span class="pl-lbl">Fiche station</span></a>` : ''}</span>
  </div>`;
}

function calendar(q, all) {
  const today = localDate();
  const month = q.mois || today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const byDay = groupBy(all, p => p.plannedDate);
  const cells = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(localDate(d)); }
  const prev = localDate(new Date(y, m - 2, 1)).slice(0, 7), next = localDate(new Date(y, m, 1)).slice(0, 7);
  return html`<div class="card"><div class="row between" style="margin-bottom:8px">
      <button class="btn ghost sm" data-act="q" data-k="mois" data-v="${prev}">‹</button><b style="font-size:17px">${MONTHS[m - 1]} ${y}</b><button class="btn ghost sm" data-act="q" data-k="mois" data-v="${next}">›</button></div>
    <div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => html`<div class="dow">${d}</div>`)}
    ${cells.map(d => { const n = (byDay.get(d) || []).length, late = (byDay.get(d) || []).filter(p => isLate(p)).length; return html`<button data-act="q" data-k="jour" data-v="${d}" class="${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${q.jour === d ? 'sel' : ''}">${Number(d.slice(8))}${n ? html`<span class="cnt" style="${late ? 'background:var(--nc-bg);color:var(--nc)' : ''}">${n}</span>` : ''}</button>`; })}</div></div>`;
}

/** Barre de sélection : « Démarrer une tournée » avec les prestations cochées. */
function pickBar() {
  if (!picked.size) return html`<div id="plPick" hidden></div>`;
  const list = [...picked].map(id => store.get('prestation', id)).filter(Boolean);
  const names = list.map(p => store.get('site', p.siteId)?.name || p.ref);
  return html`<div class="pl-pickbar" id="plPick" role="region" aria-label="Prestations sélectionnées">
    <span><b>${list.length} prestation${list.length > 1 ? 's' : ''}</b> · ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}</span>
    <span class="btn-row"><button class="btn ghost sm" data-act="unpick">Désélectionner</button><button class="btn primary" data-act="startTour"><span class="ic">${icon('route')}</span>Démarrer une tournée</button></span>
  </div>`;
}

export default {
  nav: 'planning', title: 'Planning',
  async render(params, q) {
    const today = localDate();
    const list = filterList(q);
    const all = store.all('prestation');
    const counts = {
      jour: all.filter(p => p.plannedDate === today).length,
      semaine: all.filter(p => p.plannedDate >= today && p.plannedDate <= addDays(today, 6)).length,
      retard: all.filter(p => isLate(p, today)).length,
      nonauditees: all.filter(p => !auditsOf(p.id).some(a => a.lock?.lockedAt) && p.status !== 'annulee' && p.plannedDate && p.plannedDate <= today).length,
      aplanifier: all.filter(p => !p.plannedDate && !CLOSED.includes(p.status)).length
    };
    for (const id of [...picked]) if (!store.get('prestation', id)) picked.delete(id);
    const inProgress = store.filter('audit', a => a.status === 'en_cours' && a.auditorId === session.user.id);
    const period = q.jour ? '' : (q.periode || 'semaine');
    const chips = [['jour', 'Aujourd’hui', counts.jour], ['semaine', '7 jours', counts.semaine], ['avenir', 'À venir'], ['aplanifier', 'À planifier', counts.aplanifier], ['retard', 'En retard', counts.retard], ['nonauditees', 'Non auditées', counts.nonauditees], ['toutes', 'Toutes']];
    const grouped = groupBy(list, p => p.plannedDate || '');
    return html`
      ${pageTitle('Planning des prestations', longDate(today), html`
        ${can('audit.create') ? html`<a class="btn primary" href="#/nouvel-audit"><span class="ic">${icon('plus')}</span>Nouvelle tournée</a><a class="btn accent" href="#/nouvel-audit?kind=inopine"><span class="ic">${icon('warning')}</span>Audit inopiné</a>` : ''}
        <button class="btn ghost" data-act="prepare" title="Synchroniser et télécharger les documents pour le terrain"><span class="ic">🧳</span>Préparer le terrain</button>
        ${can('planning.manage') ? html`<button class="btn ghost" data-act="newPrestation"><span class="ic">＋</span>Prestation</button>` : ''}`)}
      ${inProgress.length ? html`<div class="card" style="border-color:var(--sky)"><h2>▶ Tournées en cours — continuer</h2><div class="list">${inProgress.map(a => html`<a class="li stripe-info" href="#/audit/${a.id}"><div class="li-main"><div class="li-title">${a.number} — ${(a.stations || []).length > 1 ? `${a.stations.length} stations : ${a.stations.map(s => store.get('site', s.siteId)?.name || s.key).join(', ')}` : siteName(a.siteId)}</div><div class="li-sub">${store.get('provider', a.providerId)?.name || ''} · démarré le ${fmtDate(a.startedAt)}</div></div><span class="btn primary sm">Reprendre</span></a>`)}</div></div>` : ''}
      <div class="chips" style="margin-bottom:10px">${chips.map(([k, l, n]) => html`<button class="chip ${period === k ? 'sel' : ''}" data-act="q" data-k="periode" data-v="${k}">${l}${n !== undefined ? html`<span class="count">${n}</span>` : ''}</button>`)}
        <button class="chip ${q.mode === 'calendrier' ? 'sel' : ''}" data-act="q" data-k="mode" data-v="${q.mode === 'calendrier' ? '' : 'calendrier'}">🗓️ Calendrier</button></div>
      <details class="card" ${q.prestataire || q.campagne || q.statut || q.q ? 'open' : ''}><summary>Filtres${q.prestataire || q.campagne || q.statut || q.q ? ' (actifs)' : ''}</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Prestataire / partenaire / régie</label><select data-change="qsel" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), q.prestataire, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Campagne</label><select data-change="qsel" data-k="campagne">${options(sortBy(store.all('campaign'), 'label'), q.campagne, { placeholder: 'Toutes' })}</select></div>
          <div class="field"><label>Statut</label><select data-change="qsel" data-k="statut">${options(Object.entries(PRESTATION_STATUS).map(([id, s]) => ({ id, label: s.label })), q.statut, { placeholder: 'Tous' })}</select></div>
          <div class="field"><label>Recherche (site, référence)</label><input type="search" value="${q.q || ''}" data-change="qsel" data-k="q" placeholder="ex. Mahury"></div>
        </div>
        <button class="btn ghost sm" data-act="reset">Effacer les filtres</button>
      </details>
      ${q.mode === 'calendrier' ? calendar(q, all) : ''}
      ${q.jour ? html`<div class="banner info row between"><span>Prestations du ${longDate(q.jour)}</span><button class="btn ghost sm" data-act="q" data-k="jour" data-v="">Toutes les dates</button></div>` : ''}
      ${pickBar()}
      ${!all.length ? html`<div class="card">${empty('📅', 'Aucune prestation programmée sur cet appareil.', html`<div class="btn-row">
          ${can('planning.manage') ? html`<a class="btn primary" href="#/import">📥 Importer un calendrier (Excel, CSV, ICS, API)</a><button class="btn ghost" data-act="programme">Importer le programme des fiches terrain OEG</button>` : ''}
          ${session.mode === 'server' ? html`<button class="btn ghost" data-act="prepare">Synchroniser</button>` : ''}</div>`)}</div>`
        : !list.length ? html`<div class="card">${empty('🔎', 'Aucune prestation pour cette sélection.')}</div>`
        : html`${[...grouped.entries()].map(([d, ps]) => html`<div class="date-head">${d ? longDate(d) : 'À planifier (date à fixer)'} · ${ps.length}</div><div class="list">${ps.slice(0, 200).map(card)}</div>`)}`}
      <p class="note" style="margin-top:14px">${list.length} prestation(s) affichée(s). Les prestations peuvent être réalisées en régie, par des prestataires externes ou des partenaires. Cochez une ou plusieurs prestations pour démarrer une tournée de contrôle.</p>`;
  },
  handlers: {
    q(el) { const q = { ...this.query, [el.dataset.k]: el.dataset.v }; if (el.dataset.k === 'periode') delete q.jour; if (!q[el.dataset.k]) delete q[el.dataset.k]; navigate('/planning?' + new URLSearchParams(q), { replace: true }); },
    qsel(el) { const q = { ...this.query, [el.dataset.k]: el.value }; if (!el.value) delete q[el.dataset.k]; navigate('/planning?' + new URLSearchParams(q), { replace: true }); },
    reset() { navigate('/planning', { replace: true }); },
    pick(el) {
      if (el.checked) picked.add(el.value); else picked.delete(el.value);
      el.closest('.pl-li')?.classList.toggle('is-picked', el.checked);
      const bar = document.getElementById('plPick');
      if (bar) bar.outerHTML = String(pickBar());
    },
    unpick() { picked.clear(); this.refresh(); },
    startTour() {
      const list = [...picked].map(id => store.get('prestation', id)).filter(Boolean);
      if (!list.length) return;
      const providers = new Set(list.map(p => p.providerId)), types = new Set(list.map(p => prestationType(p)));
      if (providers.size > 1) { toast('Une tournée contrôle un seul prestataire : sélectionnez des prestations du même prestataire.', 'warn', 5000); return; }
      if (types.size > 1) { toast('Une tournée porte sur un seul type (biologie, cours d’eau ou eaux souterraines).', 'warn', 5000); return; }
      picked.clear();
      navigate(`/nouvel-audit?prestations=${encodeURIComponent(list.map(p => p.id).join(','))}&type=${[...types][0] || ''}`);
    },
    async newPrestation() { const { editPrestation } = await import('./prestation.js'); const p = await editPrestation(); if (p) navigate('/prestation/' + p.id); },
    async programme() {
      const { importOEGProgramme } = await import('../app/bootstrap.js');
      const n = await importOEGProgramme();
      toast(`${n} prestation(s) importée(s) depuis le programme des fiches terrain`, 'ok');
      this.refresh();
    },
    async prepare() {
      const { runSync, prefetchMedia } = await import('../app/sync.js');
      if (session.mode !== 'server') { toast('Mode autonome : toutes les données sont déjà sur l’appareil. Pensez à précharger la carte (écran Carte).', '', 4500); return; }
      if (!navigator.onLine) { toast('Hors connexion : la préparation nécessite le réseau.', 'warn'); return; }
      toast('Synchronisation et téléchargement des documents…');
      const r = await runSync({ reason: 'préparation du terrain' });
      const n = await prefetchMedia();
      toast(r.errors?.length ? `Préparation incomplète : ${r.errors[0]}` : `Prêt pour le terrain ✓ (${r.pulled || 0} mise(s) à jour, ${n} document(s) téléchargé(s))`, r.errors?.length ? 'warn' : 'ok', 5000);
      this.refresh();
    }
  }
};
