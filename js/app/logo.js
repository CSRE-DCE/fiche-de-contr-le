/* Logo de l'application choisi par un administrateur (Administration › « Logo de l'application ») : il remplace le logo
 * de l'OEG partout (en-tête, écrans de connexion, accueil, feuilles à l'écran et imprimées, tous les PDF).
 * - Image acceptée : PNG, JPEG, WebP ou SVG, 2 Mo au plus ; convertie en PNG (transparence conservée, proportions
 *   conservées, 512 px au plus sur le grand côté ; un SVG est rastérisé : aucun script n'est conservé).
 * - Stockage : média chiffré (kind 'logo', lien { type: 'setting', id: 'org' }) et réglage de l'organisation
 *   orgSettings().logo = { mediaId, sha256, width, height, mime, name, updatedAt, by, byName } — entités partagées :
 *   le logo part vers l'autre tablette avec le prochain fichier d'échange ; journal d'audit.
 * - Affichage : copie locale js/ui/logo.js (logo visible avant l'ouverture de session), tenue à jour à chaque
 *   changement du réglage (choix, « Rétablir le logo OEG », fichier reçu de l'autre tablette).
 * - L'icône de l'application installée sur la tablette (écran d'accueil) ne change pas. */
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { saveMedia, mediaBytes } from '../core/media.js';
import { nowISO, sha256Hex } from '../core/util.js';
import { orgSettings, saveOrgSettings } from './settings.js';
import { setLogoCache, customLogo } from '../ui/logo.js';

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.svg';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MAX_SIDE = 512;

const isSVG = file => file?.type === 'image/svg+xml' || /\.svg$/i.test(file?.name || '');
/** Contrôle du fichier choisi : message d'erreur expliqué ou null. */
export function logoFileError(file) {
  if (!file) return 'Aucun fichier choisi.';
  if (!LOGO_TYPES.includes(file.type) && !isSVG(file)) return 'Format non pris en charge : choisissez une image PNG, JPEG, WebP ou SVG.';
  if (file.size > LOGO_MAX_BYTES) return `Image trop volumineuse (${Math.round(file.size / 1024)} Ko) : 2 Mo au plus.`;
  if (!file.size) return 'Fichier vide.';
  return null;
}

function bytesToDataURL(bytes, mime = 'image/png') {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Image choisie → logo PNG : { bytes, dataUrl, width, height, sha256, name } (proportions conservées, 512 px au plus ;
 * un SVG sans dimensions est dessiné sur 512 px). Erreur expliquée si l'image est illisible.
 */
export async function prepareLogo(file) {
  const err = logoFileError(file);
  if (err) throw new Error(err);
  const blob = isSVG(file) && file.type !== 'image/svg+xml' ? new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }) : file;
  const url = URL.createObjectURL(blob);
  let img;
  try { img = new Image(); img.src = url; await img.decode(); }
  catch (e) { throw new Error('Image illisible : choisissez un autre fichier.'); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  let w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) { if (!isSVG(file)) throw new Error('Image illisible : dimensions inconnues.'); w = h = LOGO_MAX_SIDE; }
  // Agrandissement permis pour un SVG (dessin vectoriel), jamais pour une image matricielle.
  const s = isSVG(file) ? LOGO_MAX_SIDE / Math.max(w, h) : Math.min(1, LOGO_MAX_SIDE / Math.max(w, h));
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(img, 0, 0, W, H);
  let png;
  try { png = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Conversion impossible'))), 'image/png')); }
  catch (e) { throw new Error('Image non convertible en PNG (SVG avec contenu externe ?) : exportez-la en PNG.'); }
  const bytes = new Uint8Array(await png.arrayBuffer());
  return { bytes, dataUrl: bytesToDataURL(bytes), width: W, height: H, sha256: await sha256Hex(bytes), name: file.name || 'logo' };
}

/** Le profil connecté peut-il changer le logo (administrateur : paramètres de l'organisation) ? */
export const canManageLogo = () => can('settings.manage');

/** Enregistre le logo choisi (image préparée par prepareLogo) : média chiffré, réglage « org », journal, affichage. */
export async function setAppLogo(prepared) {
  if (!canManageLogo()) throw new Error('Seul un administrateur peut changer le logo de l’application.');
  const media = await saveMedia(prepared.bytes, { mime: 'image/png', kind: 'logo', name: prepared.name, caption: 'Logo de l’application', link: { type: 'setting', id: 'org' }, width: prepared.width, height: prepared.height, source: 'document', importedAt: nowISO() });
  const logo = { mediaId: media.id, sha256: media.sha256, width: prepared.width, height: prepared.height, mime: 'image/png', name: prepared.name, updatedAt: nowISO(), by: session.user?.id || null, byName: session.user?.name || '' };
  await saveOrgSettings({ logo }, `Logo de l’application remplacé (${prepared.name}, ${prepared.width} × ${prepared.height} px)`);
  setLogoCache({ dataUrl: prepared.dataUrl, sha256: media.sha256, width: prepared.width, height: prepared.height, name: prepared.name });
  return logo;
}
/** « Rétablir le logo OEG » : réglage effacé (journal), logo de l'OEG partout. */
export async function resetAppLogo() {
  if (!canManageLogo()) throw new Error('Seul un administrateur peut changer le logo de l’application.');
  await saveOrgSettings({ logo: null }, 'Logo de l’OEG rétabli');
  setLogoCache(null);
}

/**
 * Accorde la copie locale du logo au réglage de l'organisation (session ouverte) : logo reçu de l'autre tablette,
 * rétabli, ou copie absente (autre navigateur). Contenu pas encore sur la tablette : nouvel essai au prochain
 * changement du magasin. Retourne true si le logo affiché est à jour.
 */
let pendingId = null;
export async function syncLogo() {
  if (!session.unlocked || !store.loaded) return true;   // session fermée : la copie locale reste celle affichée
  const want = orgSettings().logo || null;
  const cur = customLogo();
  if (!want?.mediaId) { pendingId = null; if (cur) setLogoCache(null); return true; }
  if (cur && cur.sha256 === want.sha256) { pendingId = null; return true; }
  const bytes = await mediaBytes(want.mediaId).catch(() => null);
  if (!bytes) { pendingId = want.mediaId; return false; }
  pendingId = null;
  setLogoCache({ dataUrl: bytesToDataURL(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), sha256: want.sha256, width: want.width, height: want.height, name: want.name || '' });
  return true;
}
let watching = false, timer = null;
/** Accord différé ; contenu du logo pas encore enregistré (fichier d'échange en cours de réception) : nouvel essai
 * toutes les 2 s pendant une minute. */
function schedule(delay = 150, tries = 30) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ok = await syncLogo().catch(() => true);
    if (!ok && tries > 0) schedule(2000, tries - 1);
  }, delay);
}
/** Suit les changements du réglage « org » et des médias (réception d'un fichier d'échange : « * ») : appelé à chaque
 * ouverture de session (une seule écoute). */
export function watchLogo() {
  schedule(0);
  if (watching) return;
  watching = true;
  store.subscribe(type => { if (type === 'setting' || type === 'media' || type === '*' || pendingId) schedule(); });
}
