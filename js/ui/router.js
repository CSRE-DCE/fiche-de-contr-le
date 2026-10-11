/* Routeur par fragment d'URL (#/chemin/param?clé=valeur) : fonctionne hors connexion et sans serveur. */
import { bindActions, toast } from './dom.js';
import { html } from '../core/util.js';

const routes = [];
let current = null;          // {view, params, query, unbind}
let container = null;
let onRouted = () => {};

/** pattern : 'audit/:id/:step?' ; loader : () => import('…') (module avec export default {render, handlers…}). */
export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp('^' + pattern.split('/').filter(Boolean).map(seg => {
    if (seg.startsWith(':')) { const opt = seg.endsWith('?'); keys.push(seg.replace(/[:?]/g, '')); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; }
    return '/' + seg.replace(/[-]/g, '\\-');
  }).join('') + '/?$');
  routes.push({ pattern, re, keys, loader });
}

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path.startsWith('/') ? path : '/' + path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === target) return refresh();
  if (replace) { history.replaceState(null, '', target); return render(); }
  location.hash = target;
}

export function startRouter(el, { onRoute } = {}) {
  container = el;
  if (onRoute) onRouted = onRoute;
  window.addEventListener('hashchange', () => render());
  return render();
}
export function stopRouter() { if (current?.unbind) current.unbind(); current?.view?.unmount?.(); current = null; }

export function currentView() { return current; }

// Rendus concurrents (navigation pendant le rendu d'un écran lent, rafraîchissement après synchronisation) : seul
// le plus récent affiche et branche ses gestionnaires — jamais deux jeux de gestionnaires sur l'écran.
let renderSeq = 0;
async function render({ keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  let match = null, params = {};
  for (const r of routes) {
    const m = path === '/' && r.pattern === '/' ? [path] : (r.pattern === '/' ? null : path.match(r.re));
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = m[i + 1] !== undefined ? decodeURIComponent(m[i + 1]) : undefined; }); break; }
  }
  if (!match) match = routes.find(r => r.pattern === '/');
  const scroll = keepScroll ? window.scrollY : 0;
  if (current) { const prev = current; current = null; prev.unbind?.(); try { prev.view?.unmount?.(); } catch (e) { console.error(e); } }
  let mod;
  try { mod = (await match.loader()).default; }
  catch (e) { console.error(e); if (seq === renderSeq) container.innerHTML = String(html`<div class="card"><h2>Erreur</h2><p>Impossible de charger cet écran : ${e.message}</p></div>`); return; }
  if (seq !== renderSeq) return;
  const ctx = { params, query, refresh, navigate };
  let body;
  try { body = await mod.render(params, query, ctx); }
  catch (e) { console.error(e); body = html`<div class="card"><h2>Erreur d’affichage</h2><p>${e.message}</p><a class="btn ghost" href="#/">Retour à l’accueil</a></div>`; }
  if (seq !== renderSeq) return;      // un rendu plus récent a commencé : il affichera l'écran
  if (current) { const prev = current; current = null; prev.unbind?.(); try { prev.view?.unmount?.(); } catch (e) { console.error(e); } }
  container.innerHTML = String(body);
  const unbind = bindActions(container, mod.handlers || {}, ctx);
  current = { pattern: match.pattern, params, query, view: mod, unbind, ctx };
  try { await mod.mount?.(container, params, query, ctx); } catch (e) { console.error(e); toast(e.message, 'err'); }
  onRouted({ nav: mod.nav, title: mod.title, path });
  if (keepScroll) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
}

/** Ré-affiche l'écran courant en conservant la position de défilement. */
export function refresh() { return render({ keepScroll: true }); }
