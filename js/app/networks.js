/* Réseaux de surveillance côté application (référentiel « Réseaux », règles pures dans js/domain/networks.js).
 *
 * - currentNetworkIndex() : index code → réseau du référentiel enregistré (réseaux supprimés compris), complété par
 *   les réseaux par défaut tant que le référentiel n'est pas installé ; mis en cache (l'accueil et la carte le
 *   consultent pour chaque station) et invalidé à chaque écriture d'un réseau ou rechargement des données ;
 * - usedNetworkCodes() / networkUsage(code) : codes portés par les stations et les campagnes ;
 * - siteNetworks(site) / siteNetworksText(site) / prestationNetworkOf(p) : réseaux à afficher (écrans et documents :
 *   badges de l'accueil, de la carte, de la fiche station, du planning ; rapport, exports) ;
 * - ensureNetworks(codes) : crée les réseaux manquants (contenu déterministe, jamais un réseau supprimé), seulement
 *   pour un profil « référentiels » (ref.manage) ; les autres profils affichent un réseau « virtuel » sans rien écrire.
 * Aucune station n'est réécrite ici : site.networks reste tel qu'il a été saisi ou importé.
 */
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { networkIndex, networkOf, networksToCreate, sortNetworkCodes, listNetworks, siteNetworkCodes, prestationNetwork } from '../domain/networks.js';

let cache = null;
store.subscribe(type => { if (type === 'network' || type === '*') cache = null; });

/** Index courant des réseaux (référentiel enregistré + repli sur les réseaux par défaut). */
export function currentNetworkIndex() {
  if (!cache) cache = networkIndex(store.all('network', { withDeleted: true }));
  return cache;
}
/** Réseau d'un code (réseau « virtuel » pour un code inconnu). */
export const currentNetworkOf = code => networkOf(code, currentNetworkIndex());
/** Réseaux proposés à la saisie (actifs), plus ceux déjà portés (`keep`) même inactifs, supprimés ou inconnus. */
export const currentNetworkList = (opts = {}) => listNetworks(currentNetworkIndex(), opts);
/** Codes triés selon le référentiel courant. */
export const sortCodes = codes => sortNetworkCodes(codes, currentNetworkIndex());
/** Réseaux d'une station (objets triés, réseau virtuel pour un code inconnu) ; `except` : code à omettre. */
export const siteNetworks = (site, { except = '' } = {}) => siteNetworkCodes(site, currentNetworkIndex()).filter(c => c !== except).map(currentNetworkOf);
/** Réseau du programme d'une prestation (celui de sa campagne) : objet du référentiel, ou null (saisie manuelle). */
export function prestationNetworkOf(p) {
  const code = prestationNetwork(p, p?.campaignId ? store.get('campaign', p.campaignId) : null, currentNetworkIndex());
  return code ? currentNetworkOf(code) : null;
}
/** Libellés « CODE – Libellé » des réseaux d'une station (documents : rapport, exports), séparés par `sep`. */
export const siteNetworksText = (site, sep = ' · ') => siteNetworks(site).map(n => n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code).join(sep);

/** Codes de réseau utilisés par les stations (site.networks) et les campagnes (campaign.network), triés. */
export function usedNetworkCodes() {
  const codes = new Set();
  for (const s of store.all('site')) for (const c of s.networks || []) if (String(c ?? '').trim()) codes.add(String(c).trim());
  for (const c of store.all('campaign')) if (String(c.network ?? '').trim()) codes.add(String(c.network).trim());
  return sortCodes([...codes]);
}
/** Utilisation d'un réseau : { sites, campaigns } (nombres, éléments supprimés exclus). */
export function networkUsage(code) {
  return {
    sites: store.count('site', s => (s.networks || []).includes(code)),
    campaigns: store.count('campaign', c => c.network === code)
  };
}

/**
 * Crée les réseaux manquants pour des codes rencontrés (stations, campagnes, imports, saisie) : profil
 * « référentiels » seulement, sinon rien (réseau virtuel à l'affichage). Retourne les réseaux créés.
 */
export async function ensureNetworks(codes, { reason = 'Réseaux rencontrés sur les stations', action = 'seed' } = {}) {
  if (!can('ref.manage')) return [];
  const todo = networksToCreate(codes, store.all('network', { withDeleted: true }));
  if (todo.length) await store.bulkPut('network', todo, { reason, action, label: `${todo.length} réseau(x) : ${todo.map(n => n.code).join(', ')}` });
  return todo;
}
