/* Structure de l'application : en-tête aux couleurs OEG (logo rond, réseau, synchronisation,
 * utilisateur), navigation latérale (tablette paysage / ordinateur), barre de navigation basse
 * (téléphone : Stations, Planning, Audits, Écarts, Menu), boutons Urgence et Observation toujours
 * accessibles. Pictogrammes : js/ui/icons.js. */
import { html, localDate } from '../core/util.js';
import { session } from '../core/session.js';
import { store } from '../core/store.js';
import { ROLES, can, isTeamMode } from '../core/auth.js';
import { bindActions } from '../ui/dom.js';
import { navigate } from '../ui/router.js';
import { syncState, onSyncState, runSync } from '../app/sync.js';
import { orgSettings } from '../app/settings.js';
import { OPEN_DEVIATION } from '../domain/model.js';
import { icon } from '../ui/icons.js';

// ic : nom de pictogramme (js/ui/icons.js) ; bottom : présent dans la barre basse du téléphone.
const NAV = [
  { key: 'home', href: '#/', ic: 'station', label: 'Stations', bottom: true, group: 'Terrain' },
  { key: 'planning', href: '#/planning', ic: 'calendar', label: 'Planning', bottom: true, group: 'Terrain' },
  { key: 'audits', href: '#/audits', ic: 'clipboard', label: 'Audits', bottom: true, group: 'Terrain' },
  { key: 'ecarts', href: '#/ecarts', ic: 'warning', label: 'Écarts', bottom: true, group: 'Terrain', badge: 'overdue' },
  { key: 'observations', href: '#/observations', ic: 'eye', label: 'Observations', group: 'Terrain' },
  { key: 'carte', href: '#/carte', ic: 'map', label: 'Carte', group: 'Terrain' },
  { key: 'dashboard', href: '#/tableau-de-bord', ic: 'chart', label: 'Tableau de bord', group: 'Suivi' },
  { key: 'prestataires', href: '#/prestataires', ic: 'building', label: 'Prestataires', group: 'Suivi' },
  { key: 'historique', href: '#/audits?vue=historique', ic: 'history', label: 'Historique et comparaison', group: 'Suivi' },
  { key: 'documents', href: '#/documents', ic: 'book', label: 'Documents', group: 'Gestion' },
  { key: 'attendus', href: '#/attendus', ic: 'check-circle', label: 'Attendus des prestataires', group: 'Gestion' },
  { key: 'grilles', href: '#/grilles', ic: 'puzzle', label: 'Grilles d’audit', group: 'Gestion' },
  { key: 'referentiels', href: '#/referentiels', ic: 'database', label: 'Référentiels', group: 'Gestion' },
  { key: 'import', href: '#/import', ic: 'download', label: 'Import', group: 'Gestion' },
  { key: 'export', href: '#/export', ic: 'upload', label: 'Export', group: 'Gestion' },
  { key: 'sync', href: '#/synchronisation', ic: 'sync', label: 'Synchronisation', group: 'Système' },
  { key: 'journal', href: '#/journal', ic: 'list', label: 'Journal d’audit', group: 'Système', perm: 'trail.view' },
  { key: 'admin', href: '#/administration', ic: 'gear', label: 'Administration', group: 'Système' },
  { key: 'menu', href: '#/menu', ic: 'menu', label: 'Menu', bottom: true, mobileOnly: true }
];
// Écrans affichés en pleine largeur (fiches, cartes de stations) : body.wide-view.
const WIDE = [/^\/$/, /^\/station\//, /^\/audit\//, /^\/carte/];
let unbinds = [];

export function navItems() { return NAV.filter(n => !n.mobileOnly && (!n.perm || can(n.perm))); }

export function renderShell(root, { lock }) {
  unbinds.forEach(u => u()); unbinds = [];
  const org = orgSettings();
  const groups = [...new Set(navItems().map(n => n.group))];
  root.innerHTML = String(html`
    <header class="app-top" id="appTop">
      <img class="logo" src="icons/logo-oeg-rond.png" alt="Office de l’Eau de Guyane" width="46" height="46">
      <div class="titles"><h1>Fiches de contrôle terrain</h1><small>${org.orgName || 'Office de l’Eau de Guyane'}</small></div>
      <button class="top-pill" data-act="shell-sync" id="netPill" title="État de la connexion et de la synchronisation"><span class="dot"></span><span class="lbl" id="netLbl">…</span></button>
      <button class="top-pill pill-account" data-act="shell-account" title="Mon compte">${icon('user', { size: 20 })}<span class="lbl">${session.user.name.split(' ')[0]}</span></button>
      <button class="top-pill" data-act="shell-lock" title="Verrouiller la session" aria-label="Verrouiller la session">${icon('lock', { size: 20 })}</button>
    </header>
    <div class="app-shell">
      <nav class="rail" id="rail" aria-label="Navigation principale">
        ${groups.map(g => html`<div class="rail-sep">${g}</div>${navItems().filter(n => n.group === g).map(n => html`<a href="${n.href}" data-nav="${n.key}"><span class="ic">${icon(n.ic, { size: 20 })}</span>${n.label}${n.badge ? html`<span class="badge nc hide" data-badge="${n.badge}" style="margin-left:auto"></span>` : ''}</a>`)}`)}
        <div class="rail-sep">Session</div>
        <a href="#/compte" data-nav="compte"><span class="ic">${icon('user', { size: 20 })}</span>${session.user.name}<span class="tiny muted" style="margin-left:auto">${ROLES[session.user.role]}</span></a>
      </nav>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="Navigation">
      ${NAV.filter(n => n.bottom).map(n => html`<a href="${n.href}" data-nav="${n.key}"><span class="ic">${icon(n.ic, { size: 24 })}</span>${n.label}${n.badge ? html`<span class="nav-badge hide" data-badge="${n.badge}"></span>` : ''}</a>`)}
    </nav>
    <div class="fab-stack" id="fabs">
      ${can('observation.create') ? html`<button class="fab fab-obs" data-act="shell-observation" title="Observation simple"><span class="ic">${icon('eye', { size: 24 })}</span><span>Observation</span></button>` : ''}
      ${can('observation.create') ? html`<button class="fab fab-urgent" data-act="shell-urgent" title="Signaler une situation critique"><span class="ic">${icon('warning', { size: 24 })}</span><span>Urgence</span></button>` : ''}
    </div>`);
  const handlers = {
    'shell-sync'() { navigate('/synchronisation'); },
    'shell-account'() { navigate('/compte'); },
    'shell-lock'() { lock(); },
    async 'shell-urgent'() { (await import('./observations.js')).openEmergency(); },
    async 'shell-observation'() { (await import('./observations.js')).openQuickObservation(); }
  };
  for (const id of ['appTop', 'fabs']) unbinds.push(bindActions(document.getElementById(id), handlers));
  unbinds.push(onSyncState(updateNet));
  unbinds.push(store.subscribe(type => { if (type === 'deviation' || type === '*') updateBadges(); }));
  window.addEventListener('online', updateNet); window.addEventListener('offline', updateNet);
  updateNet(); updateBadges();
}

function updateNet() {
  const pill = document.getElementById('netPill'), lbl = document.getElementById('netLbl');
  if (!pill) return;
  const online = navigator.onLine;
  pill.classList.toggle('offline', !online);
  pill.classList.toggle('pending', online && isTeamMode() && syncState.pending > 0);
  let text = online ? 'En ligne' : 'Hors connexion';
  if (!isTeamMode()) text = online ? 'Mode autonome' : 'Hors connexion';
  if (syncState.running) text = 'Synchronisation…';
  else if (syncState.pending && isTeamMode()) text += ` · ${syncState.pending} en attente`;
  if (syncState.needsLogin) text = 'Reconnexion requise';
  lbl.textContent = text;
  pill.title = `${text}${syncState.lastSyncAt ? ' — dernière synchronisation : ' + new Date(syncState.lastSyncAt).toLocaleString('fr-FR') : ''}`;
}

function updateBadges() {
  const today = localDate();
  const overdue = store.filter('deviation', d => OPEN_DEVIATION.includes(d.status) && d.dueDate && d.dueDate < today).length;
  for (const el of document.querySelectorAll('[data-badge=overdue]')) { el.textContent = overdue; el.classList.toggle('hide', !overdue); el.title = `${overdue} écart(s) en retard`; }
}

export function updateShell({ nav, path }) {
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === nav);
  document.body.classList.toggle('in-audit', path.startsWith('/audit/'));
  document.body.classList.toggle('wide-view', WIDE.some(re => re.test(path)));
  const v = document.getElementById('view'); v?.focus?.({ preventScroll: true });
  updateBadges();
}
export { runSync };
