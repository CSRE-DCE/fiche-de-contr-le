/* Fusion à trois versions pour la résolution des conflits de synchronisation. Fichier pur.
 *
 * base   : dernière version commune (celle reçue/acceptée lors de la dernière synchronisation)
 * local  : version modifiée sur cet appareil
 * remote : version modifiée ailleurs (dépôt de l'équipe, ou autre tablette : échange par fichier)
 * Sans version commune connue : presumedBase (ce qui est identique des deux côtés).
 *
 * Règles :
 *  - un champ modifié d'un seul côté prend la valeur modifiée ;
 *  - les objets (ex. réponses d'un audit, critère par critère) et les listes d'éléments identifiés
 *    (échantillons, équipements, actions correctives…) sont fusionnés élément par élément ;
 *  - les réseaux et les types de tournée d'une station (site.networks, site.types : listes de codes) sont des
 *    ENSEMBLES : un ajout d'un côté et un retrait de l'autre sont tous deux pris en compte, sans conflit (échange par
 *    fichier entre tablettes comme synchronisation) ;
 *  - un même champ modifié des deux côtés avec des valeurs différentes est un CONFLIT : la version la
 *    plus récente (horodatage) est retenue et l'autre valeur est conservée dans le rapport de conflit,
 *    consultable et restaurable par l'utilisateur ;
 *  - les objets immuables (journal, médias, alertes) ne sont jamais fusionnés.
 *  - un audit verrouillé (signé) d'un côté reste verrouillé ;
 *  - métadonnées (révision, versions `_vv`, dernière modification) : jamais fusionnées champ par champ.
 */
import { deepEqual, clone } from '../core/util.js';

export const IMMUTABLE_TYPES = new Set(['trail', 'media', 'alert']);
const META = new Set(['_rev', '_lv', '_vv', 'updatedAt', 'updatedBy', 'updatedByName', '_conflict']);

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isIdArray = v => Array.isArray(v) && v.length > 0 && v.every(x => isObj(x) && x.id);
const stamp = v => (isObj(v) && (v.updatedAt || v.at)) || '';
/** Champs fusionnés comme des ensembles de valeurs simples, par type d'entité. */
export const SET_FIELDS = { site: new Set(['networks', 'types']) };
const isSimpleList = v => v === undefined || v === null || (Array.isArray(v) && v.every(x => x === null || typeof x !== 'object'));
/**
 * Fusion d'ensembles : un élément retiré d'un côté (présent dans la version commune) est retiré ; un élément ajouté
 * d'un côté est gardé. Ordre : version distante, puis ajouts locaux.
 */
export function mergeSet(base, local, remote) {
  const l = local || [], r = remote || [];
  const removed = new Set((base || []).filter(x => !(l.includes(x) && r.includes(x))));
  return [...new Set([...r, ...l])].filter(x => !removed.has(x));
}

function mergeValue(base, local, remote, path, ctx, depth) {
  if (deepEqual(local, remote)) return clone(local);
  if (deepEqual(base, local)) return clone(remote);
  if (deepEqual(base, remote)) return clone(local);
  // Liste de codes d'une station (réseaux, types de tournée) modifiée des deux côtés : fusion d'ensembles, sans conflit.
  if (depth === 1 && SET_FIELDS[ctx.type]?.has(path) && [base, local, remote].every(isSimpleList)) return mergeSet(base, local, remote);
  // Modifié des deux côtés
  if (depth < 4 && (isObj(local) || local === undefined) && (isObj(remote) || remote === undefined) && (isObj(local) || isObj(remote))) {
    const b = isObj(base) ? base : {}, l = local || {}, r = remote || {};
    const out = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      if (depth === 0 && META.has(k)) continue;
      const v = mergeValue(b[k], l[k], r[k], path ? `${path}.${k}` : k, { ...ctx, parentLocal: l, parentRemote: r }, depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (depth < 4 && (isIdArray(local) || isIdArray(remote) || isIdArray(base)) && [base, local, remote].every(v => v === undefined || Array.isArray(v))) {
    const mb = new Map((base || []).map(x => [x.id, x])), ml = new Map((local || []).map(x => [x.id, x])), mr = new Map((remote || []).map(x => [x.id, x]));
    const order = [...new Set([...(remote || []).map(x => x.id), ...(local || []).map(x => x.id)])];
    const out = [];
    for (const id of order) {
      const inB = mb.has(id), inL = ml.has(id), inR = mr.has(id);
      if (inB && (!inL || !inR)) {
        // supprimé d'un côté : la suppression l'emporte sauf si l'autre côté l'a modifié
        const kept = inL ? ml.get(id) : mr.get(id);
        if (kept && !deepEqual(kept, mb.get(id))) { ctx.conflicts.push({ path: `${path}[${id}]`, kept: inL ? 'local' : 'remote', reason: 'élément supprimé d’un côté et modifié de l’autre (conservé)', localValue: ml.get(id) ?? null, remoteValue: mr.get(id) ?? null }); out.push(clone(kept)); }
        continue;
      }
      const v = mergeValue(mb.get(id), ml.get(id), mr.get(id), `${path}[${id}]`, ctx, depth + 1);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  // Conflit réel sur une valeur : la plus récente l'emporte, l'autre est conservée dans le rapport.
  const tl = stamp(local) || stamp(ctx.parentLocal) || ctx.localStamp, tr = stamp(remote) || stamp(ctx.parentRemote) || ctx.remoteStamp;
  const keepLocal = String(tl) > String(tr);
  ctx.conflicts.push({ path, kept: keepLocal ? 'local' : 'remote', localValue: local ?? null, remoteValue: remote ?? null });
  return clone(keepLocal ? local : remote);
}

/**
 * Fusionne deux versions d'une entité. Retourne {merged, conflicts:[{path, kept, localValue, remoteValue}]}.
 */
export function mergeEntity(type, base, local, remote) {
  if (!remote) return { merged: clone(local), conflicts: [] };
  if (!local) return { merged: clone(remote), conflicts: [] };
  if (IMMUTABLE_TYPES.has(type)) return { merged: clone(remote), conflicts: deepEqual(stripMeta(local), stripMeta(remote)) ? [] : [{ path: '', kept: 'remote', reason: 'objet immuable', localValue: local, remoteValue: remote }] };
  const ctx = { type, conflicts: [], localStamp: local.updatedAt || '', remoteStamp: remote.updatedAt || '' };
  const merged = mergeValue(base || {}, local, remote, '', ctx, 0);
  // Un audit signé reste verrouillé : on ne peut pas « déverrouiller » par fusion.
  if (type === 'audit') {
    const lock = remote.lock?.lockedAt ? remote.lock : local.lock?.lockedAt ? local.lock : merged.lock;
    if (lock) merged.lock = clone(lock);
    if (remote.status === 'signe' || local.status === 'signe') merged.status = 'signe';
  }
  merged.id = remote.id;
  merged._rev = remote._rev;
  merged.updatedAt = String(local.updatedAt || '') > String(remote.updatedAt || '') ? local.updatedAt : remote.updatedAt;
  merged.updatedBy = String(local.updatedAt || '') > String(remote.updatedAt || '') ? local.updatedBy : remote.updatedBy;
  return { merged, conflicts: ctx.conflicts };
}

export function stripMeta(e) {
  if (!isObj(e)) return e;
  const out = {};
  for (const [k, v] of Object.entries(e)) if (!META.has(k)) out[k] = v;
  return out;
}

/**
 * Version commune présumée quand aucune base n'est connue (même donnée créée des deux côtés, ex. référentiel
 * initial d'un appareil autonome rattaché à l'équipe) : ce qui est identique des deux côtés, préfixe commun
 * des listes (un ajout en fin de liste n'est pas un conflit), métadonnées de création reçues retenues.
 * Une valeur différente des deux côtés reste un conflit tracé.
 */
export function presumedBase(local, remote) {
  const walk = (l, r) => {
    if (deepEqual(l, r)) return clone(l);
    if (Array.isArray(l) && Array.isArray(r)) { const out = []; for (let i = 0; i < Math.min(l.length, r.length) && deepEqual(l[i], r[i]); i++) out.push(clone(l[i])); return out; }
    if (isObj(l) && isObj(r)) { const out = {}; for (const k of Object.keys(l)) if (k in r) { const b = walk(l[k], r[k]); if (b !== undefined) out[k] = b; } return out; }
    return undefined;
  };
  const base = walk(local, remote) || {};
  for (const k of ['createdAt', 'createdBy', 'createdByName']) if (local?.[k] !== undefined) base[k] = local[k];
  return base;
}
