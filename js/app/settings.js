/* Réglages de l'organisation (entité « setting » id=org, synchronisée), préférences de l'appareil et préférences
 * d'affichage propres à chaque agent (tablette partagée : chaque agent a sa session et retrouve ses filtres). */
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { baseReferential } from '../domain/seed.js';

const DEFAULTS = baseReferential().setting[0];

export function orgSettings() { return { ...DEFAULTS, ...(store.get('setting', 'org') || {}) }; }
export async function saveOrgSettings(patch, reason) {
  return store.put('setting', { ...orgSettings(), ...patch, id: 'org' }, { reason });
}

/* Préférences purement locales (affichage) : localStorage, sans donnée sensible. */
export function pref(key, fallback = null) { try { const v = localStorage.getItem('oeg-ct:' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
export function setPref(key, value) { try { localStorage.setItem('oeg-ct:' + key, JSON.stringify(value)); } catch (e) { /* navigation privée */ } }
/* Préférences d'affichage de l'AGENT connecté (accueil : type de tournée, réseau, « Ranger par ») : clé
 * « u:<identifiant du profil>:<clé> ». Sur une tablette partagée, l'agent suivant (« Changer d'agent ») ne reçoit pas
 * les filtres du précédent ; aucune donnée sensible, aucun jeton. */
export const agentPrefKey = (key, userId = session.user?.id) => `u:${userId || 'appareil'}:${key}`;
export function agentPref(key, fallback = null) { return pref(agentPrefKey(key), fallback); }
export function setAgentPref(key, value) { setPref(agentPrefKey(key), value); }
export function applyDisplayPrefs() {
  document.body.classList.toggle('sun', !!pref('sun', false));
}
