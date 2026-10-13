/* Échange par fichier entre tablettes (mode autonome, celui de l'OEG) : règles pures, sans stockage ni écran.
 *
 *  VERSIONS : chaque donnée partagée porte un vecteur de versions `_vv` ({ identifiant de tablette : nombre de
 *  modifications faites sur cette tablette }, tenu par js/core/store.js). Une version A « contient » B quand chaque
 *  compteur de B est inférieur ou égal à celui de A. À la réception d'une donnée (planEntity) :
 *   - absente de la tablette : ajoutée ;
 *   - contenue dans la version de la tablette (fichier ancien ou déjà reçu) : ignorée. Un fichier ancien n'écrase
 *     jamais des saisies plus récentes ; recevoir deux fois le même fichier ne change rien ;
 *   - contenant la version de la tablette (modifiée seulement sur l'autre tablette) : elle la remplace ;
 *   - concurrente (modifiée des deux côtés) : fusion champ par champ à trois versions (js/domain/merge.js) avec la
 *     dernière version commune connue parmi les versions déjà échangées (chooseBase), conflits conservés ;
 *     tournée signée d'un seul côté : la version signée est gardée telle quelle (scellé et empreinte intacts), les
 *     valeurs de l'autre version restent dans le rapport de conflit.
 *  PROFILS (guardProfile) : un changement de profil (rôle), de statut actif ou la suppression d'un agent, et un
 *  nouveau profil administrateur, ne sont appliqués d'office que si le fichier a été envoyé par un administrateur
 *  de CETTE tablette (profil administrateur actif selon ses propres données, avant réception) ; sinon ils sont mis
 *  en attente de validation par un administrateur de la tablette (Administration). Jamais de tablette sans
 *  administrateur : même d'un administrateur, le retrait du dernier administrateur de la tablette attend.
 *  NOM du fichier : « OEG-echange_<tablette>_<AAAA-MM-JJ_HHhMM>.oegct ».
 */
import { deepEqual, clone, diff } from '../core/util.js';
import { mergeEntity, presumedBase } from './merge.js';

/** Métadonnées ignorées pour comparer deux versions d'une donnée (mêmes champs que META_FIELDS de js/core/store.js). */
export const CONTENT_IGNORE = ['_rev', '_lv', '_vv', 'createdAt', 'createdBy', 'createdByName', 'updatedAt', 'updatedBy', 'updatedByName', '_conflict'];
/** Contenu d'une donnée, sans ses métadonnées. */
export function content(e) {
  const out = {};
  for (const [k, v] of Object.entries(e || {})) if (!CONTENT_IGNORE.includes(k)) out[k] = v;
  return out;
}
export const sameContent = (a, b) => deepEqual(content(a), content(b));
/** Version telle qu'échangée : sans les métadonnées propres à la tablette (révision du dépôt, version locale). */
export function exchanged(e) { const { _rev, _lv, ...rest } = e || {}; return rest; }

/* ---------- Vecteurs de versions ---------- */
export const vvOf = e => (e && e._vv && typeof e._vv === 'object' && !Array.isArray(e._vv) ? e._vv : {});
export const vvEmpty = vv => !vv || !Object.keys(vv).length;
/** a ≤ b : la version b contient toutes les modifications de a. */
export function vvLeq(a, b) {
  for (const [k, n] of Object.entries(a || {})) if ((Number(n) || 0) > (Number(b?.[k]) || 0)) return false;
  return true;
}
export function vvMax(...list) {
  const out = {};
  for (const vv of list) for (const [k, n] of Object.entries(vv || {})) out[k] = Math.max(out[k] || 0, Number(n) || 0);
  return out;
}
export function vvBump(vv, deviceId) { const out = { ...(vv || {}) }; out[deviceId] = (Number(out[deviceId]) || 0) + 1; return out; }
export const vvTotal = vv => Object.values(vv || {}).reduce((s, n) => s + (Number(n) || 0), 0);
/** Relation de a à b : 'equal', 'older' (a contenue dans b), 'newer' (a contient b) ou 'concurrent'. */
export function vvCompare(a, b) {
  const le = vvLeq(a, b), ge = vvLeq(b, a);
  return le && ge ? 'equal' : le ? 'older' : ge ? 'newer' : 'concurrent';
}

/* ---------- Versions déjà échangées (bases des fusions) ---------- */
/**
 * Dernière version commune connue : parmi les versions déjà échangées avec l'autre tablette (envoyées ou reçues),
 * la plus récente contenue À LA FOIS dans la version locale et dans la version reçue. null si aucune.
 */
export function chooseBase(candidates, local, remote) {
  const l = vvOf(local), r = vvOf(remote);
  let best = null;
  for (const c of candidates || []) {
    if (!c || vvEmpty(c.vv) || !vvLeq(c.vv, l) || !vvLeq(c.vv, r)) continue;
    if (!best || vvTotal(c.vv) > vvTotal(best.vv)) best = c;
  }
  return best;
}
/**
 * Versions échangées à conserver après un envoi (dir 'envoyée') ou une réception (dir 'reçue') de `version` : une
 * version reçue rend inutiles celles qu'elle contient (l'autre tablette les a toutes) ; au plus `max` versions.
 */
export function nextCandidates(candidates, version, { dir = 'reçue', at = null, max = 4 } = {}) {
  const vv = vvOf(version);
  if (vvEmpty(vv)) return candidates || [];
  const keep = (candidates || []).filter(c => c && !deepEqual(c.vv, vv) && !(dir === 'reçue' && vvLeq(c.vv, vv)));
  return [...keep, { vv: clone(vv), data: exchanged(clone(version)), dir, at }].slice(-max);
}

/* ---------- Décision de réception ---------- */
const sealMoment = a => { const am = a.amendments || []; return String(am.length ? am[am.length - 1].at || '' : a.lock?.lockedAt || ''); };

/** Différences entre la version écartée et la version gardée, au format des rapports de conflit (js/domain/merge.js). */
function discarded(kept, other, keptSide, reason) {
  return diff(content(other), content(kept)).map(c => ({
    path: c.path, kept: keptSide, reason,
    localValue: (keptSide === 'remote' ? c.before : c.after) ?? null,
    remoteValue: (keptSide === 'remote' ? c.after : c.before) ?? null
  }));
}

/**
 * Décision de réception d'une donnée (hors journal d'audit, toujours ajouté entrée par entrée).
 *   local      : version de la tablette (pierre tombale comprise) ou null ;
 *   remote     : version reçue ;
 *   candidates : versions déjà échangées de cette donnée ({ vv, data }) ;
 *   deviceId   : identifiant de cette tablette.
 * Retourne { action, result, conflicts, outbox, base } :
 *   action  'add' (nouvelle), 'known' (déjà connue ou plus ancienne : ignorée), 'same' (même contenu : versions
 *           réunies), 'replace' (version reçue plus récente), 'merge' (fusion), 'signed' (tournée signée d'un seul
 *           côté : version signée gardée telle quelle) ;
 *   result  version à enregistrer (null : rien à écrire) ;
 *   outbox  'clear' (l'autre tablette a déjà cette version : plus rien à lui envoyer), 'set' (à lui envoyer) ou 'keep'.
 */
export function planEntity(type, local, remote, { candidates = [], deviceId = 'local' } = {}) {
  if (!local) return { action: 'add', result: exchanged(remote), conflicts: [], outbox: 'keep' };
  const l = vvOf(local), r = vvOf(remote);
  // Versions comparables (données antérieures aux vecteurs de versions : comparaison du contenu seulement).
  const rel = !vvEmpty(l) && !vvEmpty(r) ? vvCompare(r, l) : null;
  if (rel === 'equal' || rel === 'older') return { action: 'known', result: null, conflicts: [], outbox: 'keep' };
  if (sameContent(local, remote)) {
    const vv = vvMax(l, r);
    return { action: 'same', result: deepEqual(vv, l) ? null : { ...exchanged(local), _vv: vv }, conflicts: [], outbox: rel === 'newer' ? 'clear' : 'keep' };
  }
  if (rel === 'newer') return { action: 'replace', result: exchanged(remote), conflicts: [], outbox: 'clear' };

  // Modifiée des deux côtés.
  const vv = vvMax(l, r);
  if (type === 'audit' && (local.lock?.lockedAt || remote.lock?.lockedAt)) {
    const signedL = !!local.lock?.lockedAt, signedR = !!remote.lock?.lockedAt;
    // Une tournée signée n'est jamais fusionnée : la version signée (ou, signée des deux côtés, celle dont le scellé ou
    // la dernière modification motivée est la plus récente) est gardée telle quelle ; l'autre reste dans le rapport.
    const keepRemote = signedL && signedR ? sealMoment(remote) >= sealMoment(local) : signedR;
    const kept = keepRemote ? remote : local, other = keepRemote ? local : remote;
    const reason = signedL && signedR ? 'tournée signée sur les deux tablettes : version scellée la plus récente conservée'
      : 'tournée signée : version signée conservée telle quelle (scellé intact)';
    return {
      action: 'signed', result: { ...exchanged(kept), _vv: keepRemote ? vv : vvBump(vv, deviceId) },
      conflicts: discarded(kept, other, keepRemote ? 'remote' : 'local', reason), outbox: keepRemote ? 'clear' : 'set'
    };
  }
  const cand = chooseBase(candidates, local, remote);
  const base = cand ? cand.data : presumedBase(local, remote);
  const { merged, conflicts } = mergeEntity(type, base, local, remote);
  const newer = String(local.updatedAt || '') > String(remote.updatedAt || '') ? local : remote;
  merged.updatedByName = newer.updatedByName ?? null;
  delete merged._rev;
  let result, outbox;
  if (sameContent(merged, remote)) { result = { ...merged, _vv: vv }; outbox = 'clear'; }
  else if (sameContent(merged, local)) { result = { ...merged, _vv: vv }; outbox = 'set'; }
  else { result = { ...merged, _vv: vvBump(vv, deviceId) }; outbox = 'set'; }
  return { action: 'merge', result, conflicts, outbox, base: cand ? 'commune' : 'présumée' };
}

/* ---------- Règle de sécurité des profils d'agents ---------- */
const isActive = u => !!u && u.active !== false && !u._deleted;
/**
 * Profil d'agent reçu. local : profil de la tablette (ou null) ; next : profil retenu par la réception ;
 * trusted : fichier envoyé par un administrateur de cette tablette ; lastAdmin : ce profil est le dernier
 * administrateur actif de la tablette. Retourne { result, held: [{ field, from, to }] } : un changement non accepté
 * garde la valeur de la tablette (nouveau profil administrateur : créé « auditeur ») et attend la validation d'un
 * administrateur de la tablette.
 */
export function guardProfile(local, next, { trusted = false, lastAdmin = false } = {}) {
  const result = { ...next }, held = [];
  if (!local) {
    if (next.role === 'admin' && !trusted) { held.push({ field: 'role', from: 'auditeur', to: 'admin' }); result.role = 'auditeur'; }
    return { result, held };
  }
  const losesAdmin = local.role === 'admin' && isActive(local) && (next.role !== 'admin' || !isActive(next));
  const ok = trusted && !(lastAdmin && losesAdmin);
  if (next.role !== local.role && !ok) { held.push({ field: 'role', from: local.role, to: next.role }); result.role = local.role; }
  if ((next.active !== false) !== (local.active !== false) && !ok) { held.push({ field: 'active', from: local.active !== false, to: next.active !== false }); result.active = local.active !== false; }
  if (!!next._deleted !== !!local._deleted && !ok) {
    held.push({ field: '_deleted', from: !!local._deleted, to: !!next._deleted });
    for (const k of ['_deleted', 'deletedAt', 'deletedBy', 'deleteReason']) { if (local[k] === undefined) delete result[k]; else result[k] = local[k]; }
  }
  return { result, held };
}
/** Libellé d'un changement de profil en attente (« Profil : Auditeur → Administrateur »). */
export function heldLabel(h, roles = {}) {
  if (h.field === 'role') return `Profil : ${roles[h.from] || h.from || '—'} → ${roles[h.to] || h.to}`;
  if (h.field === 'active') return h.to ? 'Compte réactivé' : 'Compte désactivé';
  return h.to ? 'Profil supprimé' : 'Profil restauré';
}

/* ---------- Envoi : choix des données ---------- */
/**
 * Données à envoyer. scope 'changes' : celles de la file d'envoi (modifications locales depuis le dernier envoi ;
 * outbox : [[« type:id », { at }]], « __bin:id » = contenu d'une photo pas encore envoyée), 'all' : toutes (types
 * partagés, pierres tombales comprises). media : 'unsent' (photos pas encore envoyées), 'all' ou 'none'.
 * Accès aux données : getRaw(type, id), allOf(type), types (types partagés), mediaIds (toutes les photos présentes).
 * Retourne { entities: { type: [versions échangées] }, sent: [{ key, at }] (entrées de la file couvertes par l'envoi),
 * media: [identifiants des photos à joindre] }.
 */
export function selectForSend({ scope = 'changes', media = 'unsent', outbox = [], types = [], getRaw, allOf, mediaIds = [] }) {
  const entities = {}, sent = [];
  const add = (type, e) => { (entities[type] = entities[type] || []).push(exchanged(e)); };
  const shared = new Set(types);
  if (scope === 'all') {
    for (const type of types) for (const e of allOf(type)) add(type, e);
    for (const [key, v] of outbox) if (!key.startsWith('__bin:')) sent.push({ key, at: v?.at });
  } else {
    for (const [key, v] of outbox) {
      if (key.startsWith('__bin:')) continue;
      const i = key.indexOf(':'), type = key.slice(0, i), id = key.slice(i + 1);
      const e = shared.has(type) ? getRaw(type, id) : null;
      if (e) add(type, e);
      sent.push({ key, at: v?.at });
    }
  }
  const ids = new Set(media === 'all' ? mediaIds : []);
  if (media !== 'none') for (const [key] of outbox) if (key.startsWith('__bin:')) ids.add(key.slice(6));
  return { entities, sent, media: [...ids] };
}

/* ---------- Fichier ---------- */
/** « OEG-echange_Tablette-1_2026-10-13_17h05.oegct » (nom de la tablette sans accents ni espaces). */
export function exchangeFileName(deviceName, date = new Date()) {
  const safe = String(deviceName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tablette';
  const p = n => String(n).padStart(2, '0');
  return `OEG-echange_${safe}_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}h${p(date.getMinutes())}.oegct`;
}
/** N° libre proposé pour une nouvelle tablette (1 à 99), d'après les tablettes connues de l'équipe. */
export function freeDeviceNumber(devices = []) {
  const used = new Set(devices.map(d => Number(d?.number)).filter(Boolean));
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 99;
}
/** Décompte d'un ensemble de données par type : { total, byType, journal }. */
export function countEntities(entities = {}) {
  const out = { total: 0, byType: {}, journal: 0 };
  for (const [type, list] of Object.entries(entities)) {
    const n = (list || []).length;
    if (!n) continue;
    if (type === 'trail') { out.journal += n; continue; }
    out.byType[type] = n; out.total += n;
  }
  return out;
}
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
/** « 3 tournées, 1 agent, 2 écarts, 12 autres éléments » (décompte par type). */
export function countsLabel(byType = {}, { media = 0 } = {}) {
  const parts = [];
  const { audit = 0, user = 0, deviation = 0, ...rest } = byType;
  if (audit) parts.push(plural(audit, 'tournée', 'tournées'));
  if (user) parts.push(plural(user, 'agent', 'agents'));
  if (deviation) parts.push(plural(deviation, 'écart', 'écarts'));
  const others = Object.entries(rest).filter(([t]) => t !== 'media').reduce((s, [, n]) => s + n, 0);
  if (others) parts.push(plural(others, parts.length ? 'autre élément' : 'élément', parts.length ? 'autres éléments' : 'éléments'));
  if (media) parts.push(plural(media, 'photo ou document', 'photos ou documents'));
  return parts.join(', ');
}
