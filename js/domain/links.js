/* Remplissage automatique des informations redondantes entre les feuilles d'une tournée (grille CT-2026) et reprise
 * des réponses de la station précédente — fonctions pures (tests unitaires), appliquées par js/app/audits.js.
 *
 * Groupes de champs liés (LINK_GROUPS, définis ici et non dans la grille : ils valent aussi pour les tournées déjà
 * commencées) : identifiants de BASE de la source et des cibles. Portée : une source de tournée (F2, sans « @ »)
 * alimente les cibles de la tournée et de CHAQUE station ; une source de station (« it-F1-R5@<clé> ») alimente les
 * cibles de LA MÊME station. Les mises à jour s'enchaînent (F2.1.9 → F1.R5 de chaque station → F3.7 de la station).
 *  - mode 'auto' : la saisie de la source remplit les cibles encore VIDES ou encore AUTO-REMPLIES (prefilled, sans
 *    statut), jamais une saisie de l'agent (valueManual, valeur saisie, statut posé sur une valeur pré-remplie) ;
 *    valeur reprise marquée { prefilled: true, from: 'F2.1.9', fromId: 'it-F2-1.9' } (« Repris de F2.1.9 ») ;
 *    source vidée : les valeurs reprises de cette source sont retirées ;
 *  - mode 'suggest' : valeur seulement PROPOSÉE (bouton « Proposé : … »), jamais appliquée seule (heures de la
 *    tournée du prestataire, coordonnées des points biologiques, température de la glacière) ;
 *  - cible d'une valeur auto déjà validée par l'agent (statut posé) ou saisie à la main : la nouvelle valeur de la
 *    source est proposée (linkProposal), jamais écrite.
 * Source virtuelle OPERATORS_SOURCE : préleveurs du prestataire de la tournée (feuille Organisation, audit.operatorIds,
 * libellés « Prénom Nom (INI) — fonction »). Cible d'encadré : texte d'une feuille (audit.sheets[instance][clé],
 * ex. « Agent(s) prestataire(s) / fonction » de F4), marqué `<clé>From` (auto) ou `<clé>Manual` (saisie de l'agent).
 * Jamais de propagation sur une tournée signée et verrouillée ni annulée (contrôle fait par l'appelant), ni à la
 * réception d'un fichier d'échange (fusion champ par champ : js/domain/merge.js).
 *
 * Reprise de la station précédente (copyFromPreviousStation) : pour les critères C / P / NC d'une tournée à plusieurs
 * stations, AUCUN remplissage silencieux ; à la demande de l'agent (bouton par feuille, confirmation), les points
 * encore vides de la feuille reçoivent le statut et l'observation (et un choix de liste) du même point de la station
 * précédente, chaque reprise marquée `copiedFrom`. Points propres à la station (informations du référentiel
 * pré-remplies : nom, codes, bassin…) jamais repris. */
import { itemInput } from './model.js';
import { parseItemId } from './grids.js';

/** Source virtuelle : préleveurs du prestataire retenus pour la tournée (feuille Organisation F2). */
export const OPERATORS_SOURCE = '@operators';
const OPERATORS_LABEL = 'Préleveurs du prestataire (feuille Organisation)';

/**
 * Groupes de champs liés : { key, label, from (identifiant de base | OPERATORS_SOURCE), to: [identifiants de base],
 * sheets?: [{ no, key }] (encadrés cibles), mode ('auto' par défaut | 'suggest'), transform?, field? }.
 */
export const LINK_GROUPS = Object.freeze([
  { key: 'date', label: 'Date de la tournée', from: 'it-F2-1.4', to: ['it-F2-5.1', 'it-F1-R1', 'it-F3-14'] },
  { key: 'controleurs', label: 'Contrôleurs OEG', from: 'it-F2-1.1', to: ['it-F1-R3'] },
  { key: 'meteo', label: 'Météo de la journée', from: 'it-F2-1.9', to: ['it-F1-R5'] },
  { key: 'meteo-station', label: 'Météo sur la station', from: 'it-F1-R5', to: ['it-F3-7'] },
  { key: 'niveau', label: 'Niveau d’eau', from: 'it-F2-1.8', to: ['it-F1-R6'] },
  { key: 'preleveurs', label: 'Préleveurs du prestataire', from: OPERATORS_SOURCE, to: ['it-F1-R4'] },
  { key: 'prestataire', label: 'Prestataire et préleveurs', from: OPERATORS_SOURCE, to: ['it-F2-2.1'], transform: 'providerTeam' },
  { key: 'equipe-station', label: 'Équipe du prestataire sur la station', from: 'it-F1-R4', to: ['it-F3-12', 'it-F4-1', 'it-F6-1', 'it-F7-1', 'it-F8-A1', 'it-F9-1'], sheets: [{ no: 4, key: 'agents' }] },
  { key: 'heure-debut', label: 'Heure de début', mode: 'suggest', from: 'it-F2-1.5', to: ['it-F2-5.2'] },
  { key: 'heure-fin', label: 'Heure de fin', mode: 'suggest', from: 'it-F2-1.6', to: ['it-F2-5.3'] },
  { key: 'coordonnees', label: 'Coordonnées du point de prélèvement', mode: 'suggest', from: 'it-F3-15', to: ['it-F7-3', 'it-F9-3'] },
  { key: 'temperature', label: 'Température de conservation', mode: 'suggest', from: 'it-F5-13', to: ['it-F9-11'], field: 't' }
]);
/** Encadrés de feuille alimentés par un groupe (clé de donnée de feuille). */
export const LINKED_SHEET_KEYS = Object.freeze(['agents']);

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = v => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.values(v).some(x => !blank(x)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const baseOf = it => it?.baseId || it?.id;
const codeOf = it => it?.baseCode || it?.code || '';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const optVal = o => (o && typeof o === 'object' ? o.value : o);

/**
 * La réponse d'une cible peut-elle recevoir une valeur reprise ? Oui si elle est absente, encore auto-remplie (sans
 * statut) ou sans valeur ; jamais si l'agent a saisi ou effacé la valeur lui-même (valueManual).
 */
export function isWritable(r) {
  if (!r) return true;
  if (r.valueManual) return false;
  if (r.prefilled) return !r.status;
  return blank(r.value);
}
/** Encadré de feuille modifiable par la reprise : vide ou encore repris, jamais saisi par l'agent. */
export function isSheetWritable(data, key) {
  if (!data) return true;
  if (data[key + 'Manual']) return false;
  return blank(data[key]) || !!data[key + 'From'];
}

/** « Nadia Bernard (NB) — Technicienne, Paul Martin (PM) — Préleveur » → { nom: 'Nadia Bernard (NB), Paul Martin (PM)', fonction: 'Technicienne, Préleveur' }. */
export function personFields(text) {
  const parts = String(text || '').split(/\s*[,;]\s*/).map(s => s.trim()).filter(Boolean);
  const names = [], fns = [];
  for (const p of parts) { const [n, ...f] = p.split(/\s+—\s+/); names.push(n); if (f.length) fns.push(f.join(' — ')); }
  const out = {};
  if (names.length) out.nom = names.join(', ');
  if (fns.length) out.fonction = fns.join(', ');
  return out;
}

/** Valeur de la source pour une cible (adaptée au champ de la cible) ; undefined : rien à reprendre (incompatible). */
function targetValue(src, target, group, extra = {}) {
  if (group.transform === 'providerTeam') {
    const p = String(extra.providerName || '').trim(), team = blank(src) ? '' : String(src);
    return p && team ? `${p} : ${team}` : (p || team || undefined);
  }
  if (blank(src)) return undefined;
  const input = itemInput(target);
  const type = input?.type || 'text';
  if (group.field) {
    if (type !== 'fields' || !(input.fields || []).some(f => f.key === group.field)) return undefined;
    return isObj(src) ? undefined : { [group.field]: src };
  }
  if (type === 'fields') {
    if (input.gps && isObj(src)) {
      const out = {};
      for (const k of ['x', 'y', 'srs', 'x21', 'y21']) if (!blank(src[k])) out[k] = src[k];
      return blank(out.x) || blank(out.y) ? undefined : out;
    }
    const keys = (input.fields || []).map(f => f.key);
    if (keys.includes('nom') && typeof src === 'string') return personFields(src);
    return undefined;
  }
  if (isObj(src)) return undefined;
  const s = String(src);
  if (type === 'date') return ISO_DAY.test(s) ? s : undefined;
  if (type === 'time') return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : undefined;
  if (type === 'number') return Number.isFinite(Number(s.replace(',', '.'))) ? Number(s.replace(',', '.')) : undefined;
  if (type === 'select') return (input.options || []).some(o => String(optVal(o)) === s) ? s : undefined;
  return s;
}

/** Index des critères (visibles) d'une grille effective : { byId, byBase }. */
function indexItems(items) {
  const byId = new Map(), byBase = new Map();
  for (const it of items || []) {
    if (!it?.id || byId.has(it.id)) continue;
    byId.set(it.id, it);
    const b = baseOf(it);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(it);
  }
  return { byId, byBase };
}
/** Cibles d'un groupe pour une source (clé de station de la source : null pour une source de tournée). */
function targetsOf(idx, group, stationKey) {
  const out = [];
  for (const b of group.to) for (const it of idx.byBase.get(b) || []) {
    if (stationKey && (it.shared || it.station?.key !== stationKey)) continue;
    out.push(it);
  }
  return out;
}
/** Encadrés cibles d'un groupe : clés d'instance (« 4@<clé> ») des feuilles affichées pour la station. */
function sheetTargetsOf(idx, group, stationKey) {
  if (!group.sheets?.length || !stationKey) return [];
  const out = [];
  for (const sh of group.sheets) {
    const shown = [...idx.byId.values()].some(it => String(it.sheet) === String(sh.no) && it.station?.key === stationKey);
    if (shown) out.push({ sheet: `${sh.no}@${stationKey}`, key: sh.key });
  }
  return out;
}
/** Source d'un identifiant effectif : { baseId, stationKey } (source virtuelle : préleveurs de la tournée). */
const sourceRef = id => (id === OPERATORS_SOURCE ? { baseId: OPERATORS_SOURCE, stationKey: null } : parseItemId(id));
/** Code et libellé affichés d'une source (« F2.1.9 », « Conditions météo »). */
export function sourceInfo(id, items) {
  if (id === OPERATORS_SOURCE) return { code: 'F2', label: OPERATORS_LABEL };
  const it = (items || []).find(x => x.id === id);
  return { code: codeOf(it) || parseItemId(id).baseId.replace(/^it-/, '').replace('-', '.'), label: it?.label || '' };
}

/**
 * Mises à jour des cibles après le changement de sources (identifiants effectifs, ou OPERATORS_SOURCE), en chaîne :
 * [{ id, value, from, fromId } | { id, clear: true, fromId } | { sheet, key, value, from } | { sheet, key, clear: true }].
 * p : { items (critères visibles de la grille effective), responses, sheets (audit.sheets), changed: [ids],
 *       extra: { operatorsText, providerName } }. Ne modifie rien (fonction pure).
 */
export function linkedUpdates({ items = [], responses = {}, sheets = {}, changed = [], extra = {} } = {}) {
  const idx = indexItems(items);
  const pending = new Map();          // id → réponse après mise à jour (pour l'enchaînement)
  const sheetPending = new Map();     // « instance|clé » → valeur
  const out = [];
  const resp = id => (pending.has(id) ? pending.get(id) : responses[id]);
  const queue = [...changed];
  const seen = new Set();
  while (queue.length) {
    const src = queue.shift();
    if (seen.has(src)) continue;
    seen.add(src);
    const { baseId, stationKey } = sourceRef(src);
    const srcValue = src === OPERATORS_SOURCE ? extra.operatorsText : resp(src)?.value;
    const info = sourceInfo(src, items);
    for (const g of LINK_GROUPS) {
      if (g.mode === 'suggest' || g.from !== baseId) continue;
      for (const t of targetsOf(idx, g, stationKey)) {
        const r = resp(t.id);
        if (!isWritable(r)) continue;
        const v = targetValue(srcValue, t, g, extra);
        if (v === undefined) {
          // Source vidée : valeur reprise de cette source retirée (une valeur incompatible ne change rien).
          if (blank(srcValue) && r?.prefilled && r.fromId === src && !blank(r.value)) {
            out.push({ id: t.id, clear: true, fromId: src });
            pending.set(t.id, { ...r, value: undefined });
            queue.push(t.id);
          }
          continue;
        }
        if (same(r?.value, v) && r?.fromId === src) continue;
        out.push({ id: t.id, value: v, from: info.code, fromId: src });
        pending.set(t.id, { ...(r || {}), value: v, prefilled: true, from: info.code, fromId: src });
        queue.push(t.id);
      }
      for (const st of sheetTargetsOf(idx, g, stationKey)) {
        const k = `${st.sheet}|${st.key}`;
        const data = sheets?.[st.sheet];
        if (!isSheetWritable(data, st.key)) continue;
        const v = blank(srcValue) || isObj(srcValue) ? undefined : String(srcValue);
        const cur = sheetPending.has(k) ? sheetPending.get(k) : data?.[st.key];
        if (v === undefined) {
          if (data?.[st.key + 'From'] && !blank(cur)) { out.push({ sheet: st.sheet, key: st.key, clear: true }); sheetPending.set(k, undefined); }
          continue;
        }
        if (same(cur, v) && data?.[st.key + 'From'] === info.code) continue;
        out.push({ sheet: st.sheet, key: st.key, value: v, from: info.code });
        sheetPending.set(k, v);
      }
    }
  }
  return out;
}

/**
 * Valeur PROPOSÉE pour un critère (jamais appliquée seule) : groupe 'suggest' (heures, coordonnées, température), ou
 * groupe 'auto' dont la cible a été saisie / validée par l'agent et diffère de la source. { value, from, fromId, label }
 * ou null (rien à proposer, valeur identique ou cible encore remplie automatiquement).
 */
export function linkProposal({ items = [], responses = {}, item, extra = {} } = {}) {
  if (!item) return null;
  const base = baseOf(item);
  const key = item.shared ? null : item.station?.key || null;
  const idx = indexItems(items);
  const r = responses[item.id];
  for (const g of LINK_GROUPS) {
    if (!g.to.includes(base)) continue;
    const srcId = g.from === OPERATORS_SOURCE ? OPERATORS_SOURCE
      : idx.byId.has(g.from) ? g.from : key && idx.byId.has(`${g.from}@${key}`) ? `${g.from}@${key}` : null;
    if (!srcId) continue;
    if (g.mode !== 'suggest' && isWritable(r)) continue;
    const srcValue = srcId === OPERATORS_SOURCE ? extra.operatorsText : responses[srcId]?.value;
    let v = targetValue(srcValue, item, g, extra);
    if (v === undefined) continue;
    if (g.field) {
      if (same(r?.value?.[g.field], v[g.field])) continue;
      v = { ...(isObj(r?.value) ? r.value : {}), ...v };
    } else if (isObj(v) && isObj(r?.value) && Object.entries(v).every(([k, x]) => same(r.value[k], x))) continue;
    if (same(r?.value, v)) continue;
    const info = sourceInfo(srcId, items);
    return { value: v, from: info.code, fromId: srcId, label: info.label, group: g.key, mode: g.mode || 'auto' };
  }
  return null;
}

/** Réponse « vide » pour la reprise de la station précédente : ni statut, ni observation, ni valeur saisie. */
const emptyForCopy = r => !r || (!r.status && blank(r.comment) && (blank(r.value) || !!r.prefilled));
/** Point propre à la station (information du référentiel pré-remplie : nom, codes, bassin…) : jamais repris. */
const stationOwn = it => /^site\./.test(String(it?.prefill || ''));

/**
 * Reprise des réponses de la station précédente pour UNE feuille (critères C / P / NC propres à la station) :
 * [{ id (critère de la station), fromId (même critère de la station précédente), status, comment?, value? }].
 * Seuls les points encore vides reçoivent une reprise ; un choix de liste (« Valeur / réponse » de type liste) est
 * repris s'il est vide ; mesures, textes et coordonnées restent propres à chaque station.
 * p : { items (visibles), responses, sheetNo, stationKey, prevKey }.
 */
export function copyFromPreviousStation({ items = [], responses = {}, sheetNo, stationKey, prevKey } = {}) {
  if (!stationKey || !prevKey || stationKey === prevKey) return [];
  const out = [];
  for (const it of items) {
    if (it.kind !== 'conformity' || it.shared || it.station?.key !== stationKey || String(it.sheet) !== String(sheetNo) || stationOwn(it)) continue;
    const fromId = `${baseOf(it)}@${prevKey}`;
    const src = responses[fromId];
    if (!src?.status || !emptyForCopy(responses[it.id])) continue;
    const c = { id: it.id, fromId, status: src.status };
    if (!blank(src.comment)) c.comment = src.comment;
    if (itemInput(it)?.type === 'select' && !blank(src.value) && !src.prefilled && blank(responses[it.id]?.value)) c.value = src.value;
    out.push(c);
  }
  return out;
}
