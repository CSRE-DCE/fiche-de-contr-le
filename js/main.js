/* Point d'entrée de la PWA d'audit des prestations de prélèvement. */
import { openDB, destroyDB } from './core/db.js';
import { session } from './core/session.js';
import { store } from './core/store.js';
import * as auth from './core/auth.js';
import { revokeAllURLs } from './core/media.js';
import { route, startRouter, stopRouter, refresh } from './ui/router.js';
import { toast, settleInput } from './ui/dom.js';
import { initSync, stopSync, runSync } from './app/sync.js';
import { applyDisplayPrefs, orgSettings } from './app/settings.js';
import { renderSetup, renderLogin, renderMessage, teardownAuth } from './views/auth.js';
import { renderShell, updateShell } from './views/shell.js';

const app = document.getElementById('app');

route('/', () => import('./views/home.js'));
route('planning', () => import('./views/planning.js'));
route('station/:id', () => import('./views/station.js'));
route('station/:id/modifier', () => import('./views/station-edit.js'));
route('prestation/:id', () => import('./views/prestation.js'));
route('nouvel-audit', () => import('./views/audit-new.js'));
route('audit/:id/:step?', () => import('./views/audit.js'));
route('audits', () => import('./views/audits.js'));
route('comparer', () => import('./views/compare.js'));
route('ecarts', () => import('./views/deviations.js'));
route('ecart/:id', () => import('./views/deviations.js').then(m => ({ default: m.detailView })));
route('observations', () => import('./views/observations.js'));
route('prestataires', () => import('./views/providers.js'));
route('prestataire/:id', () => import('./views/providers.js').then(m => ({ default: m.detailView })));
route('carte', () => import('./views/map.js'));
route('tableau-de-bord', () => import('./views/dashboard.js'));
route('documents', () => import('./views/documents.js'));
route('document/:id', () => import('./views/documents.js').then(m => ({ default: m.detailView })));
route('grilles', () => import('./views/grids.js'));
route('grille/:id', () => import('./views/grids.js').then(m => ({ default: m.detailView })));
route('referentiels', () => import('./views/referentials.js'));
route('referentiel/:type', () => import('./views/referentials.js').then(m => ({ default: m.listView })));
route('import', () => import('./views/imports.js'));
route('export', () => import('./views/exports.js'));
route('synchronisation', () => import('./views/sync.js'));
route('journal', () => import('./views/trail.js'));
route('administration', () => import('./views/admin.js'));
route('compte', () => import('./views/admin.js').then(m => ({ default: m.accountView })));
route('menu', () => import('./views/menu.js'));

/* ---------- Saisie en cours : jamais perdue ---------- */
/**
 * Valide le champ en cours de saisie (perte du focus ⇒ enregistrement habituel), exécute les enregistrements différés,
 * attend la fin des gestionnaires puis l'écriture sur l'appareil. Avant le verrouillage et à la mise en arrière-plan
 * (changement d'application, écran éteint, onglet fermé ou tué par le système).
 */
async function saveInput() {
  if (!session.unlocked) return;
  try { await settleInput(); } catch (e) { console.warn(e); }
  try { await store.flush(); } catch (e) { /* erreur déjà signalée par le magasin */ }
}
let backgroundSave = false;
function watchBackground() {
  if (backgroundSave) return;
  backgroundSave = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveInput(); });
  window.addEventListener('pagehide', () => { saveInput(); });
}

/* ---------- Verrouillage automatique par inactivité ---------- */
let idleTimer = null;
let activityWatched = false;
function watchActivity() {
  const touch = () => { session.lastActivity = Date.now(); };
  // 'input' : saisie au clavier virtuel ou par la dictée vocale (js/ui/voice.js n'émet que des événements input / change).
  if (!activityWatched) { activityWatched = true; ['pointerdown', 'keydown', 'touchstart', 'input'].forEach(e => window.addEventListener(e, touch, { passive: true, capture: true })); }
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (!session.unlocked) return;
    const minutes = Number(orgSettings().autoLockMinutes) || 30;
    if (Date.now() - session.lastActivity > minutes * 60000) lockApp('inactivité');
  }, 20000);
}

let locking = null;
export function lockApp(reason = 'manuel') {
  // Un seul verrouillage à la fois (minuteur d'inactivité et cadenas peuvent se croiser pendant l'enregistrement).
  if (!locking) locking = doLock(reason).finally(() => { locking = null; });
  return locking;
}
async function doLock(reason) {
  // Saisie en cours (observation commencée, champ non quitté) enregistrée AVANT la fermeture de la session.
  await saveInput();
  stopSync(); stopRouter(); revokeAllURLs();
  await auth.lock(reason);
  document.body.classList.remove('in-audit');
  showLogin(reason === 'inactivité' ? 'Session verrouillée après inactivité. Vos saisies sont enregistrées sur l’appareil.'
    : reason === 'compte désactivé' ? 'Ce compte a été désactivé par l’administrateur de l’équipe (config/utilisateurs.json).' : '');
}

/** Appareil révoqué par l'administrateur : effacement complet des données locales. */
async function onRevoked() {
  stopSync(); stopRouter(); revokeAllURLs();
  store.unload();
  try { await destroyDB(); } catch (e) { /* déjà supprimée */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('oeg-ct:')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  try { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('oeg-ct-tiles')).map(k => caches.delete(k))); } catch (e) { /* ignore */ }
  renderMessage(app, { title: 'Appareil désactivé', message: 'Cet appareil a été désactivé par l’administrateur (appareil perdu ou retiré). Toutes les données locales ont été effacées. Contactez votre administrateur pour réactiver un appareil.' });
}

/** Mise à niveau idempotente du référentiel (grille CT-2026, stations, programmes) par un profil habilité. */
function upgradeReferentiel() {
  if (!auth.can('ref.manage')) return Promise.resolve(null);
  return import('./app/bootstrap.js').then(m => m.upgradeReferentiel2026?.()).catch(() => null);
}

async function enterApp() {
  document.body.classList.remove('auth-mode');
  teardownAuth();
  auth.restoreToken();
  renderShell(app, { lock: () => lockApp('manuel') });
  watchActivity();
  watchBackground();
  initSync({ revoked: onRevoked, disabled: () => lockApp('compte désactivé') });
  await startRouter(document.getElementById('view'), { onRoute: updateShell });
  if (!auth.isTeamMode()) { upgradeReferentiel(); return; }
  // Mode équipe : réception des données de l'équipe d'abord, puis mise à niveau du référentiel (évite de
  // recréer localement ce que le dépôt contient déjà).
  const emptyBefore = !store.count('site');
  runSync({ reason: 'ouverture de session' }).then(async res => {
    if (res?.revoked || res?.disabled || !session.unlocked) return;
    if (res?.pulled || res?.pushed) toast(`Synchronisation : ${res.pushed} envoi(s), ${res.pulled} réception(s)`, 'ok');
    else if (res?.errors?.length) toast('Synchronisation : ' + res.errors[0], 'warn', 6000);
    if (res && !res.skipped && !res.errors?.length) {
      const up = await upgradeReferentiel();
      if (up?.upgraded) runSync({ reason: 'mise à niveau du référentiel' }).catch(() => {});
    }
    if (emptyBefore && store.count('site') && session.unlocked) refresh();   // premières données reçues : réafficher
  }).catch(() => {});
}

function showLogin(message = '') {
  document.body.classList.add('auth-mode');
  renderLogin(app, { message, onUnlocked: () => enterApp() });
}

async function boot() {
  applyDisplayPrefs();
  try { await openDB(); }
  catch (e) { renderMessage(app, { title: 'Stockage indisponible', message: e.message + ' — l’application a besoin du stockage du navigateur (IndexedDB). Évitez la navigation privée.' }); return; }
  await auth.loadDevice();
  if (!(await auth.isSetUp())) {
    document.body.classList.add('auth-mode');
    renderSetup(app, { onDone: () => enterApp() });
  } else showLogin();
}

window.AuditApp = { store, session, lockApp };   // diagnostic et tests automatisés
boot();
