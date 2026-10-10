/* Comparaison de deux audits successifs (critère par critère, appariés par code). Fichier pur.
 * Les valeurs sont comparées sous leur forme lisible (formatValue) : une valeur objet (« fields ») est
 * comparée champ par champ, sans tenir compte des métadonnées techniques (lat / lon / précision du relevé GPS).
 * Tournées (grille effective) : un critère de station est apparié par son code d'origine ET la station
 * (« F4.5 @ site-09271503 »), quel que soit son rang dans la tournée ; un critère partagé n'est compté qu'une fois.
 * `siteId` (facultatif) limite la comparaison des critères de station à une station (historique d'une station). */
import { allItems, expandGrid } from './grids.js';
import { responseText, formatValue } from './model.js';

const RANK = { C: 4, NA: 3, P: 2, NO: 1, NV: 1, NC: 0 };

const gridOf = a => a.effectiveGrid || expandGrid(a.gridSnapshot, a.stations || []);
const keyOf = it => it.station ? `${it.baseCode || it.baseId || it.code}@${it.station.siteId}` : (it.code || it.label);

export function compareAudits(older, newer, { deviationsOld = [], deviationsNew = [], siteId = null } = {}) {
  const keep = it => !siteId || !it.station || it.station.siteId === siteId;
  const itemsA = allItems(gridOf(older)).filter(keep), itemsB = allItems(gridOf(newer)).filter(keep);
  const mapA = new Map(itemsA.map(i => [keyOf(i), i])), mapB = new Map(itemsB.map(i => [keyOf(i), i]));
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
    const it = b || a;
    rows.push({
      code: it.baseCode || it.code, label: it.label, section: it.sectionTitle, kind: it.kind, sheet: it.sheet ?? null,
      station: it.station ? { siteId: it.station.siteId, name: it.station.name } : null,
      before: a ? responseText(a, ra) : '', after: b ? responseText(b, rb) : '',
      beforeStatus: ra?.status || null, afterStatus: rb?.status || null, change
    });
  }
  const order = { degradation: 0, amelioration: 1, modifie: 2, nouveau: 3, retire: 4, identique: 5 };
  rows.sort((x, y) => order[x.change] - order[y.change] || String(x.code).localeCompare(String(y.code), 'fr', { numeric: true }) || String(x.station?.name || '').localeCompare(String(y.station?.name || ''), 'fr'));
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
