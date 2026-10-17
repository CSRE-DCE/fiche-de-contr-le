/* Réseaux de surveillance (référentiel « Réseaux », type d'entité 'network'). Fichier pur (testé dans le navigateur).
 *
 * Une station porte un ou plusieurs CODES de réseau (site.networks : « BIO », « Chimie », « RCO », « EL », « ESO ») ;
 * une campagne en porte un seul (campaign.network). Le code est la valeur enregistrée : il ne se modifie plus après la
 * création du réseau, dont l'identifiant est déterministe (net-<code>). Un réseau : { id, code, label, description,
 * color, order, auditTypes (types de tournée associés, parmi bio / ce / eso), active }.
 * - NETWORK_DEFAULTS : les cinq réseaux des marchés OEG 2026 (un CCTP par réseau). Contenu DÉTERMINISTE, sans date :
 *   deux tablettes qui les installent produisent la même donnée (aucun conflit à l'échange). Libellés, descriptions et
 *   couleurs restent modifiables par l'OEG dans Référentiels › Réseaux de surveillance. BIO n'a pas de type associé :
 *   le type « bio » d'une station est déduit de ses listes biologiques (site.bioLists), comme avant le référentiel.
 * - networkIndex(liste) : index code → réseau, complété par les réseaux par défaut absents (repli tant que le
 *   référentiel n'est pas installé : tablette où seul un agent sans droit « référentiels » a ouvert une session) ;
 *   networkOf(code) : réseau « virtuel » (gris, sans type de tournée) pour un code inconnu, affiché sans être écrit.
 * - canonicalNetwork / normalizeNetworkCodes : saisie ou import ramené au code du référentiel (code, libellé ou
 *   synonyme ; sans tenir compte de la casse ni des accents ; JAMAIS de correspondance partielle : « BI » n'est pas
 *   « BIO ») ; les codes inconnus sont rendus à part, tels que saisis.
 * - sortNetworkCodes (ordre d'affichage, puis libellé), listNetworks (réseaux proposés à la saisie), auditTypesOf
 *   (types de tournée déduits : bio par les listes biologiques, puis les types associés aux réseaux),
 *   networksToCreate (réseaux à créer pour des codes rencontrés sans réseau ; jamais un réseau supprimé),
 *   groupSitesByNetwork (une station sur deux réseaux figure dans CHAQUE groupe, les totaux comptent les stations
 *   distinctes), prestationNetwork (réseau du programme d'une prestation : celui de sa campagne).
 * - networkColors : couleurs d'affichage dérivées de la couleur du réseau (claire pour les fonds, filet, foncée pour
 *   le texte et les éléments sélectionnés, avec un contraste suffisant).
 */
import { normalize } from '../core/util.js';

/** Types de tournée de la grille CT-2026, dans l'ordre d'affichage. */
export const AUDIT_TYPE_KEYS = ['bio', 'ce', 'eso'];
/** Pseudo-code des stations sans réseau (filtre « Sans réseau »). */
export const NO_NETWORK = 'aucun';
/** Couleur d'un réseau inconnu ou sans couleur. */
export const OTHER_COLOR = '#5f6b7a';
/** Ordre d'affichage d'un réseau qui n'en précise pas (après les réseaux du référentiel). */
export const DEFAULT_ORDER = 900;

/** Identifiant déterministe d'un réseau (« net-RCO ») : le même sur toutes les tablettes. */
export const networkId = code => 'net-' + String(code ?? '').trim().replace(/[^\w-]+/g, '_');

const DEFAULTS = [
  { code: 'BIO', label: 'Biologie (RCS ESC BIO)', description: 'Marché OEG 2026-01 – suivi biologique des eaux douces (DCE) : invertébrés, diatomées, ichtyologie et mercure, phytoplancton.', color: '#2f8a3f', order: 10, auditTypes: [] },
  { code: 'Chimie', label: 'Chimie des cours d’eau', description: 'Marché OEG 2026-03 – suivi chimique des eaux douces (DCE), réseau de contrôle de surveillance.', color: '#6a35b0', order: 20, auditTypes: ['ce'] },
  { code: 'RCO', label: 'Réseau de contrôle opérationnel', description: 'Marché OEG 2026-04 – réseau de contrôle opérationnel des eaux de surface (DCE).', color: '#0b6cb4', order: 30, auditTypes: ['ce'] },
  { code: 'EL', label: 'Eaux littorales', description: 'Marché OEG 2026-02 – surveillance des eaux littorales, côtières et de transition (DCE).', color: '#0b7a7c', order: 40, auditTypes: ['ce'] },
  { code: 'ESO', label: 'Eaux souterraines', description: 'Marché OEG 2026-05 – suivi chimique des eaux souterraines (DCE).', color: '#2f6f8f', order: 50, auditTypes: ['eso'] }
];
/** Réseaux installés par défaut (référentiel initial et mise à niveau). Objets figés : copier avant d'écrire. */
export const NETWORK_DEFAULTS = Object.freeze(DEFAULTS.map(n => Object.freeze({ id: networkId(n.code), ...n, auditTypes: Object.freeze([...n.auditTypes]), active: true })));
/** Copie modifiable des réseaux par défaut (contenu enregistré). */
export const defaultNetworks = () => NETWORK_DEFAULTS.map(n => ({ ...n, auditTypes: [...n.auditTypes] }));

/** Synonymes reconnus à l'import et à la saisie (correspondance exacte seulement), propres au code : jamais enregistrés. */
const CODE_ALIASES = {
  BIO: ['Biologie', 'Hydrobiologie', 'Suivi biologique', 'RCS ESC BIO', 'RCS BIO'],
  Chimie: ['Suivi chimique', 'Chimie des cours d’eau', 'RCS ESC suivi chimique', 'RCS chimie'],
  RCO: ['Réseau de contrôle opérationnel', 'Contrôle opérationnel'],
  EL: ['Eaux littorales', 'Eau littorale', 'Littoral', 'RCS EL', 'Suivi littoral'],
  ESO: ['Eaux souterraines', 'Eau souterraine', 'RCS ESO']
};

/** Clé de comparaison : sans casse, accents, ponctuation ni espaces multiples. */
const keyOf = v => normalize(v).replace(/[’'`´]/g, ' ').replace(/[\s_.,;:/\\|–—-]+/g, ' ').trim();

/**
 * Index code → réseau : réseaux enregistrés (passer store.all('network', { withDeleted: true }) : un réseau supprimé
 * reste connu et n'est pas remplacé par le défaut), complétés par les réseaux par défaut dont le code est absent.
 */
export function networkIndex(list = []) {
  const idx = new Map();
  for (const n of list || []) if (n && n.code !== undefined && n.code !== null && String(n.code).trim() && !idx.has(String(n.code))) idx.set(String(n.code), n);
  for (const n of NETWORK_DEFAULTS) if (!idx.has(n.code)) idx.set(n.code, n);
  return idx;
}
const DEFAULT_INDEX = networkIndex();

/** Réseau d'un code ; code inconnu : réseau « virtuel » (libellé = code, gris, sans type de tournée, jamais écrit). */
export function networkOf(code, idx = DEFAULT_INDEX) {
  const c = String(code ?? '').trim();
  return idx.get(c) || { id: networkId(c), code: c, label: c, description: '', color: OTHER_COLOR, order: DEFAULT_ORDER, auditTypes: [], active: true, virtual: true };
}
/** Libellé d'un réseau (« Eaux littorales »). */
export const networkLabel = (code, idx = DEFAULT_INDEX) => networkOf(code, idx).label || String(code ?? '');

/** Codes triés par ordre d'affichage, puis libellé (doublons et codes vides retirés). */
export function sortNetworkCodes(codes, idx = DEFAULT_INDEX) {
  const list = [...new Set((codes || []).map(c => String(c ?? '').trim()).filter(Boolean))];
  const rank = c => { const o = Number(networkOf(c, idx).order); return Number.isFinite(o) ? o : DEFAULT_ORDER; };
  return list.sort((a, b) => rank(a) - rank(b) || String(networkLabel(a, idx)).localeCompare(String(networkLabel(b, idx)), 'fr') || a.localeCompare(b, 'fr'));
}
/** Réseaux d'une station, triés (codes). */
export const siteNetworkCodes = (site, idx = DEFAULT_INDEX) => sortNetworkCodes(site?.networks || [], idx);
/** La station fait-elle partie du réseau ? (NO_NETWORK : station sans réseau) */
export function inNetwork(site, code) {
  const list = (Array.isArray(site) ? site : site?.networks || []).filter(Boolean);
  return code === NO_NETWORK ? !list.length : list.includes(code);
}

/**
 * Réseaux proposés à la saisie (cases à cocher, listes) : réseaux actifs, non supprimés, triés ; `keep` (codes déjà
 * portés par la station ou la campagne) ajoute les réseaux inactifs, supprimés ou inconnus concernés, pour ne rien perdre.
 */
export function listNetworks(idx = DEFAULT_INDEX, { keep = [], includeInactive = false } = {}) {
  const kept = new Set((keep || []).map(c => String(c ?? '').trim()).filter(Boolean));
  const codes = [...idx.values()].filter(n => kept.has(n.code) || (!n._deleted && (includeInactive || n.active !== false))).map(n => n.code);
  return sortNetworkCodes([...codes, ...kept], idx).map(c => networkOf(c, idx));
}

/**
 * Code du référentiel correspondant à une saisie : code, libellé ou synonyme (casse, accents et ponctuation
 * ignorés), y compris sous la forme « Libellé (CODE) » ou « CODE – Libellé » ; '' si aucun. Jamais de
 * correspondance partielle.
 */
export function canonicalNetwork(raw, idx = DEFAULT_INDEX) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const forms = [text];
  const par = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (par) forms.push(par[2], par[1]);
  const dash = text.split(/\s+[–—-]\s+/);
  if (dash.length > 1) forms.push(dash[0], dash.slice(1).join(' – '));
  const nets = [...idx.values()];
  for (const f of forms) {
    const k = keyOf(f);
    if (!k) continue;
    const byCode = nets.find(n => keyOf(n.code) === k);
    if (byCode) return byCode.code;
  }
  for (const f of forms) {
    const k = keyOf(f);
    if (!k) continue;
    const byLabel = nets.find(n => keyOf(n.label) === k || [...(n.aliases || []), ...(CODE_ALIASES[n.code] || [])].some(a => keyOf(a) === k));
    if (byLabel) return byLabel.code;
  }
  return '';
}

/**
 * Normalise une liste de réseaux (chaîne « RCO ; chimie » — séparateurs ; , | et retour à la ligne — ou tableau) :
 * { codes : codes du référentiel puis inconnus, sans doublon, dans l'ordre de saisie ; unknown : codes inconnus, tels
 * que saisis (espaces superflus retirés) ; all : codes triés (référentiel, puis inconnus) }.
 */
export function normalizeNetworkCodes(raw, idx = DEFAULT_INDEX) {
  const parts = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[;,|\n]/)).map(s => String(s ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const codes = [], unknown = [], seen = new Set();
  for (const p of parts) {
    const c = canonicalNetwork(p, idx);
    const k = c ? 'c:' + c : 'u:' + keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    if (c) codes.push(c); else { codes.push(p); unknown.push(p); }
  }
  return { codes, unknown, all: sortNetworkCodes(codes, idx) };
}
/** Deux listes de réseaux identiques à l'ordre près ? */
export function sameNetworks(a, b) {
  const x = [...new Set((a || []).filter(Boolean))].sort(), y = [...new Set((b || []).filter(Boolean))].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Types de tournée d'une station déduits du référentiel : bio si elle figure sur une liste biologique (BIO_CE,
 * BIO_FISH, BIO_PHYTO), puis les types associés à ses réseaux (défauts : Chimie, RCO, EL ⇒ ce ; ESO ⇒ eso).
 * Même résultat que l'ancienne règle codée en dur pour les 108 stations du référentiel OEG.
 */
export function auditTypesOf(site, idx = DEFAULT_INDEX) {
  const t = new Set();
  if ((site?.bioLists || []).length) t.add('bio');
  for (const c of site?.networks || []) for (const k of networkOf(c, idx).auditTypes || []) t.add(k);
  return AUDIT_TYPE_KEYS.filter(k => t.has(k));
}

/**
 * Réseaux à créer pour des codes rencontrés sans réseau enregistré (stations, campagnes, imports) : contenu par défaut
 * pour un code des marchés 2026, sinon réseau minimal à compléter (gris, sans type de tournée). `list` : réseaux
 * enregistrés, supprimés compris (un réseau supprimé n'est jamais recréé). Contenu déterministe (aucune date).
 */
export function networksToCreate(codes, list = []) {
  const known = new Set((list || []).map(n => String(n?.code ?? '')));
  const ids = new Set((list || []).map(n => n?.id));
  const out = [];
  for (const raw of codes || []) {
    const code = String(raw ?? '').trim();
    if (!code || known.has(code)) continue;
    known.add(code);
    const def = NETWORK_DEFAULTS.find(n => n.code === code);
    let id = networkId(code);
    for (let i = 2; ids.has(id); i++) id = networkId(code) + '-' + i;   // codes distincts au même identifiant (« A B » / « A_B »)
    ids.add(id);
    out.push(def ? { ...def, id, auditTypes: [...def.auditTypes] } : {
      id, code, label: code, description: 'Réseau créé automatiquement (code rencontré sur une station, une campagne ou un import) : libellé, couleur et types de tournée à compléter.',
      color: OTHER_COLOR, order: DEFAULT_ORDER, auditTypes: [], active: true
    });
  }
  return out;
}

/**
 * Stations rangées par réseau : { groups: [{ code, network, sites }], distinct, memberships }. Une station sur deux
 * réseaux figure dans chaque groupe (memberships les compte toutes), `distinct` compte les stations une seule fois ;
 * groupe « Sans réseau » (code NO_NETWORK) en dernier s'il y a lieu ; groupes vides omis.
 */
export function groupSitesByNetwork(sites, idx = DEFAULT_INDEX) {
  const by = new Map(), none = [], ids = new Set();
  for (const s of sites || []) {
    if (!s) continue;
    ids.add(s.id ?? s);
    const codes = [...new Set((s.networks || []).map(c => String(c ?? '').trim()).filter(Boolean))];
    if (!codes.length) none.push(s);
    for (const c of codes) { if (!by.has(c)) by.set(c, []); by.get(c).push(s); }
  }
  const groups = sortNetworkCodes([...by.keys()], idx).map(code => ({ code, network: networkOf(code, idx), sites: by.get(code) }));
  if (none.length) groups.push({ code: NO_NETWORK, network: { id: '', code: NO_NETWORK, label: 'Sans réseau', description: '', color: OTHER_COLOR, order: DEFAULT_ORDER + 1, auditTypes: [], active: true, virtual: true }, sites: none });
  return { groups, distinct: ids.size, memberships: groups.reduce((n, g) => n + g.sites.length, 0) };
}

/**
 * Réseau du programme d'une prestation (unique) : celui de sa campagne, à défaut le préfixe de son identifiant de
 * programme (« RCO|09281718|S1 - Octobre 2026 ») s'il désigne un réseau connu ; '' sinon (saisie manuelle).
 */
export function prestationNetwork(p, campaign = null, idx = DEFAULT_INDEX) {
  const c = String(campaign?.network ?? '').trim();
  if (c) return canonicalNetwork(c, idx) || c;
  const ext = String(p?.source?.externalId ?? '');
  return ext.includes('|') ? canonicalNetwork(ext.split('|')[0], idx) : '';
}

/* ---------- Couleurs d'affichage ---------- */
const WHITE = [255, 255, 255], BLACK = [0, 0, 0], INK = '#111a22';
const hexOf = c => {
  const s = String(c ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(x => x + x).join('');
  return null;
};
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (h, target, t) => toHex(rgbOf(h).map((v, i) => v + (target[i] - v) * t));
const luminance = h => {
  const [r, g, b] = rgbOf(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Rapport de contraste WCAG entre deux couleurs « #rrggbb » (1 à 21). */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(hexOf(a) || OTHER_COLOR), luminance(hexOf(b) || OTHER_COLOR)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/**
 * Couleurs d'un réseau : main (couleur du réseau), light (fond clair), line (filet), dark (texte sur le fond clair,
 * fond d'un élément sélectionné à texte blanc : contraste ≥ 4,5 avec les deux), onMain (texte sur `main` : blanc ou
 * encre foncée, le plus contrasté — le vert BIO n'atteint que 4,35:1 avec le blanc).
 */
export function networkColors(network) {
  const main = hexOf(typeof network === 'string' ? network : network?.color) || OTHER_COLOR;
  const light = mix(main, WHITE, 0.88), line = mix(main, WHITE, 0.62);
  let dark = mix(main, BLACK, 0.28);
  for (let i = 0; i < 12 && (contrastRatio(dark, '#ffffff') < 4.5 || contrastRatio(dark, light) < 4.5); i++) dark = mix(dark, BLACK, 0.15);
  return { main, light, line, dark, onMain: contrastRatio(main, '#ffffff') >= contrastRatio(main, INK) ? '#ffffff' : INK };
}
