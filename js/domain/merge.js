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
 *  - une position est fusionnée d'UN BLOC (jamais le X d'un côté et le Y ou le fuseau d'origine de l'autre) :
 *    coordonnées d'une station (COORD_FIELDS : x, y, lat, lon et saisie d'origine en UTM 21N srs, x21, y21) et valeur
 *    d'un groupe X / Y d'une feuille ({x, y, srs?, x21?, y21?, lat?, lon?…}) ; modifiée des deux côtés : un conflit,
 *    la plus récente est retenue entière ;
 *  - la valeur d'une réponse d'audit et sa PROVENANCE (saisie de l'agent ou reprise d'une autre feuille :
 *    VALUE_GROUPS.response — value, prefilled, from, fromId, valueManual, js/domain/links.js) sont fusionnées d'un
 *    bloc, de même un encadré lié d'une feuille et ses marques (VALUE_GROUPS.sheet) : jamais la valeur saisie d'un
 *    côté avec la marque « repris de F… » de l'autre ; modifiées des deux côtés : la réponse la plus récente (horodatage
 *    de la réponse) est retenue entière et l'autre valeur conservée dans le rapport ;
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
/** Champs de position d'une entité fusionnés d'un bloc (X / Y RGFG95 / UTM 22N, WGS84, saisie d'origine en UTM 21N). */
export const COORD_FIELDS = { site: ['x', 'y', 'lat', 'lon', 'srs', 'x21', 'y21'] };
/** Valeur d'une réponse d'audit et sa provenance ; encadré lié d'une feuille (« Agent(s) prestataire(s) ») et ses marques. */
export const VALUE_GROUPS = { response: ['value', 'prefilled', 'from', 'fromId', 'valueManual'], sheet: ['agents', 'agentsFrom', 'agentsManual'] };
/** Valeur d'un groupe X / Y (feuilles) ou d'un point : objet portant des coordonnées planes (nombres). */
const PLANE = ['x', 'y', 'x21', 'y21'];
const isCoord = c => typeof c === 'number' || (typeof c === 'string' && c.trim() !== '' && Number.isFinite(Number(c.replace(',', '.'))));
const isPosition = v => isObj(v) && PLANE.some(k => v[k] !== undefined) && PLANE.every(k => v[k] === undefined || v[k] === null || isCoord(v[k]));

/**
 * Fusion d'un groupe de champs d'un bloc : modifié d'un seul côté → ce côté ; des deux côtés → le plus récent entier.
 * opts (groupe d'une réponse ou d'un encadré) : { prefix (chemin), reason, report: [clés signalées au rapport],
 * localStamp, remoteStamp } ; par défaut : position d'une entité (chaque clé différente signalée).
 */
function mergeGroup(keys, base, local, remote, ctx, opts = {}) {
  const pick = o => { const out = {}; for (const k of keys) if (o?.[k] !== undefined) out[k] = o[k]; return out; };
  const gb = pick(base), gl = pick(local), gr = pick(remote);
  if (deepEqual(gl, gr) || deepEqual(gb, gr)) return clone(gl);
  if (deepEqual(gb, gl)) return clone(gr);
  const keepLocal = String(opts.localStamp ?? ctx.localStamp) > String(opts.remoteStamp ?? ctx.remoteStamp);
  for (const k of opts.report || keys) {
    if (!deepEqual(gl[k], gr[k])) ctx.conflicts.push({ path: opts.prefix ? `${opts.prefix}.${k}` : k, kept: keepLocal ? 'local' : 'remote', reason: opts.reason || 'position modifiée des deux côtés : la plus récente est retenue entière', localValue: gl[k] ?? null, remoteValue: gr[k] ?? null });
  }
  return clone(keepLocal ? gl : gr);
}
/** Groupe fusionné d'un bloc à ce niveau : position d'une entité (niveau 0), réponse ou encadré d'un audit (niveau 2). */
function groupAt(ctx, path, depth, l, r) {
  if (depth === 0) return COORD_FIELDS[ctx.type] ? { keys: COORD_FIELDS[ctx.type], opts: {} } : null;
  if (depth !== 2 || ctx.type !== 'audit') return null;
  const stamps = { localStamp: stamp(l) || ctx.localStamp, remoteStamp: stamp(r) || ctx.remoteStamp, prefix: path };
  if (path.startsWith('responses.')) return { keys: VALUE_GROUPS.response, opts: { ...stamps, report: ['value'], reason: 'valeur modifiée des deux côtés (saisie ou reprise d’une autre feuille) : la réponse la plus récente est retenue entière' } };
  if (path.startsWith('sheets.')) return { keys: VALUE_GROUPS.sheet, opts: { ...stamps, report: ['agents'], reason: 'encadré modifié des deux côtés (saisie ou reprise) : le plus récent est retenu entier' } };
  return null;
}
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
  // Modifié des deux côtés (une position — valeur X / Y — n'est jamais fusionnée champ par champ : conflit ci-dessous)
  const position = depth > 0 && (isPosition(local) || isPosition(remote));
  if (!position && depth < 4 && (isObj(local) || local === undefined) && (isObj(remote) || remote === undefined) && (isObj(local) || isObj(remote))) {
    const b = isObj(base) ? base : {}, l = local || {}, r = remote || {};
    const out = {};
    const g = groupAt(ctx, path, depth, l, r);
    const group = g?.keys || null;
    if (group) Object.assign(out, mergeGroup(group, b, l, r, ctx, g.opts));
    for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      if (depth === 0 && META.has(k)) continue;
      if (group?.includes(k)) continue;
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
