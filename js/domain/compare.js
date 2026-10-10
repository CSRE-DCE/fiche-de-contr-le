/* Comparaison de deux audits successifs (critère par critère, appariés par code). Fichier pur.
 * Les valeurs sont comparées sous leur forme lisible (formatValue) : une valeur objet (« fields ») est
 * comparée champ par champ, sans tenir compte des métadonnées techniques (lat / lon / précision du relevé GPS). */
import { allItems } from './grids.js';
import { responseText, formatValue } from './model.js';

const RANK = { C: 3, NA: 2, NO: 1, NV: 1, NC: 0 };

export function compareAudits(older, newer, { deviationsOld = [], deviationsNew = [] } = {}) {
  const itemsA = allItems(older.gridSnapshot), itemsB = allItems(newer.gridSnapshot);
  const key = it => it.code || it.label;
  const mapA = new Map(itemsA.map(i => [key(i), i])), mapB = new Map(itemsB.map(i => [key(i), i]));
  const rows = [];
  for (const k of new Set([...mapA.keys(), ...mapB.keys()])) {
    const a = mapA.get(k), b = mapB.get(k);
    const ra = a ? older.responses?.[a.id] : null, rb = b ? newer.responses?.[b.id] : null;
    let change;
    if (!a) change = 'nouveau';
    else if (!b) change = 'retire';
    else if ((ra?.status || null) === (rb?.status || null) && formatValue(a, ra?.value) === formatValue(b, rb?.value)) change = 'identique';
    else if (a.kind === 'conformity' && ra?.status && rb?.status) change = RANK[rb.status] > RANK[ra.status] ? 'amelioration' : RANK[rb.status] < RANK[ra.status] ? 'degradation' : 'modifie';
    else change = 'modifie';
    rows.push({
      code: (b || a).code, label: (b || a).label, section: (b || a).sectionTitle, kind: (b || a).kind, sheet: (b || a).sheet ?? null,
      before: a ? responseText(a, ra) : '', after: b ? responseText(b, rb) : '',
      beforeStatus: ra?.status || null, afterStatus: rb?.status || null, change
    });
  }
  const order = { degradation: 0, amelioration: 1, modifie: 2, nouveau: 3, retire: 4, identique: 5 };
  rows.sort((x, y) => order[x.change] - order[y.change] || String(x.code).localeCompare(String(y.code), 'fr', { numeric: true }));
  const count = c => rows.filter(r => r.change === c).length;
  const persistent = rows.filter(r => r.beforeStatus === 'NC' && r.afterStatus === 'NC');
  return {
    rows, persistent,
    stats: { amelioration: count('amelioration'), degradation: count('degradation'), modifie: count('modifie'), identique: count('identique'), nouveau: count('nouveau'), retire: count('retire') },
    deviations: { before: deviationsOld.length, after: deviationsNew.length },
    sameGrid: older.gridSnapshot?.code === newer.gridSnapshot?.code,
    gridVersions: [older.gridSnapshot?.version, newer.gridSnapshot?.version]
  };
}
