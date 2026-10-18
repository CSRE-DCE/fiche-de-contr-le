/* Logo affiché par l'application : logo de l'organisme choisi en Administration (« Logo de l'application »), à défaut
 * le logo rond de l'OEG (icons/logo-oeg-rond.png).
 * Le logo choisi est enregistré dans la base chiffrée (média + réglage « org », js/app/logo.js) et transmis à l'autre
 * tablette par le fichier d'échange ; une COPIE (image PNG en data: URL, sans donnée sensible) est gardée dans le
 * localStorage de l'appareil (clé « oeg-ct:logo ») pour les écrans affichés AVANT l'ouverture de session (connexion,
 * chargement), quand la base chiffrée n'est pas encore lisible, et pour l'affichage synchrone des gabarits.
 * Toutes les images portant data-app-logo sont mises à jour aussitôt qu'il change (sans réaffichage de l'écran).
 * L'icône de l'application installée (écran d'accueil de la tablette, manifest.webmanifest) ne change pas.
 * Module sans accès à la base : utilisable par les écrans de connexion, docs/charte.html et les PDF. */
import { html, raw } from '../core/util.js';

const KEY = 'oeg-ct:logo';
/** Logo par défaut (rond, fond bleu) et variante rectangulaire des écrans de connexion. */
export const DEFAULT_LOGO = 'icons/logo-oeg-rond.png';
export const DEFAULT_LOGO_WIDE = 'icons/logo-oeg.png';
const asset = path => new URL('../../' + path, import.meta.url).href;

function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v.dataUrl === 'string' && v.dataUrl.startsWith('data:image/png;base64,') ? v : null;
  } catch (e) { return null; }
}
let current = readCache();

/** Logo personnalisé en cours : { dataUrl, sha256, width, height, name } ou null (logo de l'OEG). */
export const customLogo = () => current;
export const isCustomLogo = () => !!current;
/** Adresse du logo à afficher : logo choisi, sinon le logo de l'OEG (`fallback` : variante par défaut). */
export function logoURL(fallback = DEFAULT_LOGO) { return current?.dataUrl || asset(fallback); }
/** Classe d'un logo personnalisé (proportions conservées, fond blanc : jamais recadré en rond). */
export const logoClass = () => (current ? 'is-custom' : '');

/**
 * <img> du logo (mis à jour en direct : data-app-logo). cls : classe de l'image ; fallback : logo par défaut à utiliser.
 */
export function logoImg({ cls = 'logo', alt = 'Office de l’Eau de Guyane', width = null, height = null, fallback = DEFAULT_LOGO } = {}) {
  const dims = raw(`${width ? ` width="${Number(width)}"` : ''}${height ? ` height="${Number(height)}"` : ''}`);
  return html`<img class="${[cls, logoClass()].filter(Boolean).join(' ')}" src="${logoURL(fallback)}" alt="${alt}" data-app-logo="${fallback}"${dims}>`;
}

/**
 * Remplace le logo affiché (entry : { dataUrl (PNG), sha256, width, height, name } ou null pour le logo de l'OEG) :
 * copie locale (localStorage) et images data-app-logo de la page.
 */
export function setLogoCache(entry) {
  current = entry && typeof entry.dataUrl === 'string' && entry.dataUrl.startsWith('data:image/png;base64,') ? { ...entry } : null;
  try { if (current) localStorage.setItem(KEY, JSON.stringify(current)); else localStorage.removeItem(KEY); } catch (e) { /* stockage local indisponible : logo pour la session */ }
  if (typeof document === 'undefined') return;
  for (const img of document.querySelectorAll('img[data-app-logo]')) {
    img.src = logoURL(img.dataset.appLogo || DEFAULT_LOGO);
    img.classList.toggle('is-custom', !!current);
  }
}

/** Octets d'une data: URL base64. */
export function dataURLBytes(url) {
  const b64 = String(url || '').split(',')[1] || '';
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/**
 * Octets PNG du logo pour les PDF (fiches de tournée, fiches vierges, fiche station, rapport, attendus) : logo choisi,
 * sinon le fichier de l'OEG (`fallbacks`, dans l'ordre). null si aucun n'est lisible.
 */
export async function logoBytes(fallbacks = [DEFAULT_LOGO, DEFAULT_LOGO_WIDE]) {
  if (current) { try { return dataURLBytes(current.dataUrl); } catch (e) { /* copie illisible : logo de l'OEG */ } }
  for (const p of fallbacks) {
    try { const res = await fetch(asset(p)); if (res.ok) return new Uint8Array(await res.arrayBuffer()); } catch (e) { /* fichier suivant */ }
  }
  return null;
}
