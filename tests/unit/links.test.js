/* Tests unitaires du remplissage automatique des informations redondantes entre les feuilles d'une tournée et de la
 * reprise des réponses de la station précédente (js/domain/links.js, fonctions pures) sur la grille effective CT-2026
 * (expandGrid) à deux ou trois stations :
 * - groupes de champs liés : sources et cibles présentes dans la grille, valeurs compatibles (listes de choix) ;
 * - météo F2.1.9 → F1.R5 de chaque station → F3.7 de la même station (chaîne), date F2.1.4 → F2.5.1, F1.R1, F3.14,
 *   contrôleurs F2.1.1 → F1.R3, niveau d'eau F2.1.8 → F1.R6, préleveurs de la tournée → F1.R4 → F3.12, F4.1, F6.1,
 *   F7.1, F8.A1, F9.1 (nom / fonction), encadré « Agent(s) prestataire(s) / fonction » de F4, F2.2.1 ;
 * - jamais d'écrasement : saisie de l'agent (valueManual), valeur effacée volontairement, valeur reprise puis cotée
 *   (proposition « Proposé : … » à la place) ; source vidée : reprises retirées ; nouvelle station : valeurs courantes ;
 * - fiche de la station (référentiel) → F3.1–F3.6, F3.9, F3.10, F3.18 de LA station : recalcul quand la fiche change
 *   (valeurs encore auto-remplies), saisie ou valeur cotée jamais remplacée (proposée), champ vidé retiré ;
 * - liens « proposés » (heures, coordonnées, température, moyens et difficultés d'accès, supports, lot / marché,
 *   effectif, sondes et calibration de F4) : jamais appliqués seuls ; plusieurs moyens d'accès : choix proposés ;
 * - cible restée en retard sur sa source (tournée reçue d'une autre tablette) : valeur proposée, jamais écrite ;
 *   fusion d'un fichier d'échange : valeur et provenance (saisie / reprise) d'une réponse fusionnées d'un bloc ;
 * - heures de la tournée rapprochées de F2.1.5 / F2.1.6 (auditTimes, auditTimeTexts de js/domain/model.js) ;
 * - reprise de la station précédente : points vides seulement, statut + observation (+ choix de liste), jamais les
 *   mesures, coordonnées ni informations propres à la station, ni les critères communs à la tournée. */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_CT_2026 } from '../../js/domain/grid-ct-2026.js';
import { expandGrid, visibleItems, itemIndex, typeCompartments, parseItemId } from '../../js/domain/grids.js';
import { itemInput, auditTimes, auditTimeTexts } from '../../js/domain/model.js';
import {
  LINK_GROUPS, LINKED_SHEET_KEYS, OPERATORS_SOURCE, SITE_SOURCE, STATIONS_SOURCE, COMPARTMENTS_SOURCE, MARKET_SOURCE, INSTRUMENTS_SOURCE,
  isVirtualSource, isWritable, isSheetWritable, personFields, sourceInfo, linkedUpdates, linkProposal, copyFromPreviousStation
} from '../../js/domain/links.js';
import { mergeEntity } from '../../js/domain/merge.js';

const G = GRID_CT_2026;
const IDX = itemIndex(G);
const ATHANASE = { id: 'site-09271503', code: '09271503', name: 'Athanase', bassin: 'Approuague', riverName: 'Approuague', commune: 'Régina', pressions: 'Orpaillage', her: 15, strahler: 5, matrixId: 'mat-ESU' };
const ACAROUANY = { id: 'site-09160201', code: '09160201', name: 'Acarouany', bassin: 'Mana', riverName: 'Acarouany', commune: 'Mana', matrixId: 'mat-ESU' };
const SAKOURA = { id: 'site-09141222', code: '09141222', name: 'Sakoura', bassin: 'Mahury', matrixId: 'mat-ESU' };
const PANK = { id: 'site-BSS002PANK', code: 'BSS002PANK', name: 'AEP Maripasoula', commune: 'Maripasoula', pressions: 'Assainissement', matrixId: 'mat-ESO' };
const SITES = { [ATHANASE.id]: ATHANASE, [ACAROUANY.id]: ACAROUANY, [SAKOURA.id]: SAKOURA, [PANK.id]: PANK };
const S1 = '09271503', S2 = '09160201', S3 = '09141222';
const BIO_ALL = ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'];

/** Critères visibles de la grille effective (comme js/app/audits.js, linkItems). */
function itemsFor(type, sites = [ATHANASE, ACAROUANY], { responses = {}, compartments = null } = {}) {
  const E = expandGrid(G, sites.map(s => ({ siteId: s.id })), SITES);
  const ctx = { auditType: type, compartments: compartments || typeCompartments(G, type) };
  return visibleItems(E, responses, ctx).map(x => x.item);
}
/** Saisie de l'agent (comme setResponse) puis reprises appliquées (comme applyLinks) : nouvel état. */
function enter(items, state, id, value, extra = {}) {
  const responses = { ...state.responses }, sheets = { ...state.sheets };
  if (id !== OPERATORS_SOURCE) {
    const prev = responses[id] || {};
    const r = { ...prev, value, valueManual: true };
    delete r.prefilled; delete r.from; delete r.fromId;
    if (value === undefined) delete r.value;
    responses[id] = r;
  }
  const ups = linkedUpdates({ items, responses, sheets, changed: [id], extra });
  return { ...apply({ responses, sheets }, ups), ups };
}
function apply(state, ups) {
  const responses = { ...state.responses }, sheets = { ...state.sheets };
  for (const u of ups) {
    if (u.sheet) {
      const d = { ...(sheets[u.sheet] || {}) };
      if (u.clear) { delete d[u.key]; delete d[u.key + 'From']; } else { d[u.key] = u.value; d[u.key + 'From'] = u.from; }
      sheets[u.sheet] = d;
    } else if (u.clear) {
      const n = { ...responses[u.id] };
      for (const k of ['value', 'prefilled', 'from', 'fromId']) delete n[k];
      responses[u.id] = n;
    } else responses[u.id] = { ...(responses[u.id] || {}), value: u.value, prefilled: true, from: u.from, fromId: u.fromId };
  }
  return { responses, sheets };
}
const val = (st, id) => st.responses[id]?.value;
const empty = () => ({ responses: {}, sheets: {} });

test('groupes de champs liés : sources et cibles dans la grille, listes de choix compatibles, aucun cycle', () => {
  const keys = LINK_GROUPS.map(g => g.key);
  eq(new Set(keys).size, keys.length, 'clés uniques');
  for (const g of LINK_GROUPS) {
    if (!isVirtualSource(g.from)) assert(IDX.has(g.from), `${g.key} : source ${g.from} absente de la grille`);
    else assert([OPERATORS_SOURCE, SITE_SOURCE, STATIONS_SOURCE, COMPARTMENTS_SOURCE, MARKET_SOURCE, INSTRUMENTS_SOURCE].includes(g.from), `${g.key} : source virtuelle inconnue ${g.from}`);
    for (const t of g.to) assert(IDX.has(t), `${g.key} : cible ${t} absente de la grille`);
    assert(!g.to.includes(g.from), `${g.key} : source parmi ses cibles`);
    assert(!g.mode || g.mode === 'suggest', `${g.key} : mode ${g.mode}`);
    // Liste de choix → liste de choix : chaque valeur de la source existe dans la cible.
    const src = IDX.get(g.from), so = itemInput(src);
    if (so?.type === 'select') for (const t of g.to) {
      const ti = itemInput(IDX.get(t));
      if (ti?.type === 'select') for (const o of so.options) assert(ti.options.includes(o), `${g.key} : « ${o} » absent de ${t}`);
    }
  }
  // Pas de cycle entre groupes automatiques (une cible n'alimente jamais, en chaîne, sa propre source).
  const auto = LINK_GROUPS.filter(g => g.mode !== 'suggest');
  const next = new Map();
  for (const g of auto) for (const t of g.to) { if (!next.has(g.from)) next.set(g.from, new Set()); next.get(g.from).add(t); }
  const reach = (from, seen = new Set()) => { for (const t of next.get(from) || []) if (!seen.has(t)) { seen.add(t); reach(t, seen); } return seen; };
  for (const g of auto) assert(!reach(g.from).has(g.from), `cycle depuis ${g.from}`);
  deepEq(LINKED_SHEET_KEYS, ['agents']);
  deepEq(LINK_GROUPS.filter(g => g.mode === 'suggest').map(g => g.key), ['heure-debut', 'heure-fin', 'coordonnees', 'temperature', 'moyens', 'difficultes', 'supports', 'marche', 'effectif', 'sondes', 'calibration']);
  // Écriture automatique seulement pour une information identique (date, météo, niveau, équipe, fiche de la station) :
  // dès qu'il y a une part d'appréciation, la valeur est seulement proposée.
  deepEq(LINK_GROUPS.filter(g => g.mode !== 'suggest').map(g => g.key), ['date', 'controleurs', 'meteo', 'meteo-station', 'niveau', 'preleveurs', 'prestataire', 'equipe-station', 'station']);
  // Fiche de la station : les critères de F3 pré-remplis depuis le référentiel (même `prefill`), aucun autre.
  deepEq(LINK_GROUPS.find(g => g.key === 'station').to, ['it-F3-1', 'it-F3-2', 'it-F3-3', 'it-F3-4', 'it-F3-5', 'it-F3-6', 'it-F3-9', 'it-F3-10', 'it-F3-18']);
  deepEq(LINK_GROUPS.find(g => g.key === 'station').to.map(id => IDX.get(id).prefill).every(p => /^site\./.test(p)), true);
  assert(isVirtualSource('@site@09271503') && !isVirtualSource('it-F2-1.9'));
});

test('isWritable / isSheetWritable : vide ou encore auto-rempli, jamais une saisie de l’agent', () => {
  assert(isWritable(undefined) && isWritable(null), 'aucune réponse');
  assert(isWritable({ value: 'Pluie forte', prefilled: true, from: 'F2.1.9' }), 'reprise sans statut');
  assert(!isWritable({ value: 'Pluie forte', prefilled: true, status: 'C' }), 'reprise validée (statut)');
  assert(!isWritable({ value: 'Couvert' }), 'valeur saisie');
  assert(!isWritable({ valueManual: true }), 'valeur effacée volontairement');
  assert(isWritable({ status: 'C', comment: 'ok' }), 'statut sans valeur : la valeur peut être reprise');
  assert(isWritable({ value: '  ' }), 'valeur blanche');
  assert(isSheetWritable(undefined, 'agents') && isSheetWritable({ agents: 'X', agentsFrom: 'F1.R4' }, 'agents'));
  assert(!isSheetWritable({ agents: 'Saisi' }, 'agents') && !isSheetWritable({ agentsManual: true }, 'agents'));
  deepEq(personFields('Nadia Bernard (NB) — Technicienne, Paul Martin (PM) — Préleveur'), { nom: 'Nadia Bernard (NB), Paul Martin (PM)', fonction: 'Technicienne, Préleveur' });
  deepEq(personFields('DB, NB'), { nom: 'DB, NB' });
  deepEq(personFields(''), {});
});

test('météo : F2.1.9 → F1.R5 de chaque station → F3.7 de la même station ; saisie manuelle jamais écrasée', () => {
  const items = itemsFor('ce');
  let st = enter(items, empty(), 'it-F2-1.9', 'Pluie forte');
  deepEq(st.ups.map(u => [u.id, u.value, u.from]), [
    [`it-F1-R5@${S1}`, 'Pluie forte', 'F2.1.9'], [`it-F1-R5@${S2}`, 'Pluie forte', 'F2.1.9'],
    [`it-F3-7@${S1}`, 'Pluie forte', 'F1.R5'], [`it-F3-7@${S2}`, 'Pluie forte', 'F1.R5']
  ]);
  eq(st.responses[`it-F1-R5@${S1}`].fromId, 'it-F2-1.9'); eq(st.responses[`it-F3-7@${S2}`].fromId, `it-F1-R5@${S2}`, 'chaîne : même station');
  eq(sourceInfo('it-F2-1.9', items).label, 'Conditions météo'); eq(sourceInfo(`it-F1-R5@${S1}`, items).code, 'F1.R5');
  // Station 2 saisie à la main : la météo de la station change F3.7 de CETTE station seulement.
  st = enter(items, st, `it-F1-R5@${S2}`, 'Couvert');
  deepEq(st.ups.map(u => [u.id, u.value]), [[`it-F3-7@${S2}`, 'Couvert']]);
  // Nouvelle météo de la journée : la station 1 suit, la station 2 (saisie) non ; proposition pour la station 2.
  st = enter(items, st, 'it-F2-1.9', 'Orage');
  deepEq(st.ups.map(u => [u.id, u.value]), [[`it-F1-R5@${S1}`, 'Orage'], [`it-F3-7@${S1}`, 'Orage']]);
  eq(val(st, `it-F1-R5@${S2}`), 'Couvert'); eq(val(st, `it-F3-7@${S2}`), 'Couvert');
  const r5 = items.find(i => i.id === `it-F1-R5@${S2}`);
  deepEq((({ value, from, mode }) => ({ value, from, mode }))(linkProposal({ items, responses: st.responses, item: r5 })), { value: 'Orage', from: 'F2.1.9', mode: 'auto' });
  eq(linkProposal({ items, responses: st.responses, item: items.find(i => i.id === `it-F1-R5@${S1}`) }), null, 'cible encore reprise : rien à proposer');
  // Reprise validée par l'agent (statut posé) : plus jamais remplacée, nouvelle valeur seulement proposée.
  st.responses[`it-F3-7@${S1}`] = { ...st.responses[`it-F3-7@${S1}`], status: 'C' };
  st = enter(items, st, 'it-F2-1.9', 'Ensoleillé');
  deepEq(st.ups.map(u => u.id), [`it-F1-R5@${S1}`]);
  eq(val(st, `it-F3-7@${S1}`), 'Orage');
  eq(linkProposal({ items, responses: st.responses, item: items.find(i => i.id === `it-F3-7@${S1}`) }).value, 'Ensoleillé');
  // Valeur effacée volontairement par l'agent : jamais re-remplie.
  st = enter(items, st, `it-F1-R5@${S1}`, undefined);
  assert(st.responses[`it-F1-R5@${S1}`].valueManual && val(st, `it-F1-R5@${S1}`) === undefined);
  st = enter(items, st, 'it-F2-1.9', 'Nuageux');
  deepEq(st.ups, [], 'champ vidé à dessein et saisie manuelle : rien n’est repris');
});

test('source vidée : les valeurs reprises de cette source sont retirées (en chaîne), les saisies restent', () => {
  const items = itemsFor('ce');
  let st = enter(items, empty(), 'it-F2-1.9', 'Pluie faible');
  st = enter(items, st, `it-F3-7@${S2}`, 'Bruine notée par le préleveur');
  st = enter(items, st, 'it-F2-1.9', undefined);
  deepEq(st.ups.map(u => [u.id, !!u.clear]), [[`it-F1-R5@${S1}`, true], [`it-F1-R5@${S2}`, true], [`it-F3-7@${S1}`, true]]);
  eq(val(st, `it-F3-7@${S2}`), 'Bruine notée par le préleveur');
  // Valeur incompatible avec la cible (date mal formée) : rien n'est repris, rien n'est retiré.
  const d = enter(items, empty(), 'it-F2-1.4', '01/10/2026');
  deepEq(d.ups, []);
});

test('date, contrôleurs, niveau d’eau : tournée → chaque station ; nouvelle station : valeurs courantes', () => {
  const items = itemsFor('ce');
  let st = enter(items, empty(), 'it-F2-1.4', '2026-10-01');
  deepEq(st.ups.map(u => u.id), ['it-F2-5.1', `it-F1-R1@${S1}`, `it-F1-R1@${S2}`, `it-F3-14@${S1}`, `it-F3-14@${S2}`]);
  assert(st.ups.every(u => u.value === '2026-10-01' && u.from === 'F2.1.4'));
  // Date pré-remplie à la création (prefilled sans source) : remplacée ; date des prélèvements cotée : proposée.
  st.responses[`it-F3-14@${S1}`] = { ...st.responses[`it-F3-14@${S1}`], status: 'NC', comment: 'date absente de la fiche' };
  st = enter(items, st, 'it-F2-1.4', '2026-10-02');
  assert(!st.ups.some(u => u.id === `it-F3-14@${S1}`) && val(st, `it-F3-14@${S1}`) === '2026-10-01');
  st = enter(items, st, 'it-F2-1.1', 'A. Dupont, B. Martin');
  deepEq(st.ups.map(u => [u.id, u.value]), [[`it-F1-R3@${S1}`, 'A. Dupont, B. Martin'], [`it-F1-R3@${S2}`, 'A. Dupont, B. Martin']]);
  st = enter(items, st, 'it-F2-1.8', 'Hautes eaux');
  deepEq(st.ups.map(u => u.id), [`it-F1-R6@${S1}`, `it-F1-R6@${S2}`]);
  st = enter(items, st, 'it-F2-1.9', 'Couvert');
  // Troisième station ajoutée : les sources de la tournée (comme addStation) remplissent ses champs, rien d'autre.
  const items3 = itemsFor('ce', [ATHANASE, ACAROUANY, SAKOURA]);
  const ups = linkedUpdates({ items: items3, responses: st.responses, changed: ['it-F2-1.4', 'it-F2-1.1', 'it-F2-1.9', 'it-F2-1.8', OPERATORS_SOURCE], extra: {} });
  deepEq(ups.map(u => u.id).sort(), [`it-F1-R1@${S3}`, `it-F1-R3@${S3}`, `it-F1-R5@${S3}`, `it-F1-R6@${S3}`, `it-F3-14@${S3}`, `it-F3-7@${S3}`].sort());
  // Eaux souterraines : pas de niveau d'eau (critères masqués) ; heure de début : lien proposé, jamais appliqué.
  const eso = itemsFor('eso', [ATHANASE]);
  deepEq(enter(eso, empty(), 'it-F2-1.8', 'Crue').ups, []);
  deepEq(enter(itemsFor('ce'), empty(), 'it-F2-1.5', '08:00').ups, [], 'heures : liens proposés seulement');
});

test('préleveurs de la tournée → F1.R4 → F3.12, F4.1, F6.1, F7.1, F8.A1, F9.1 et encadré F4 ; F2.2.1', () => {
  const items = itemsFor('bio', [ATHANASE, ACAROUANY], { compartments: BIO_ALL });
  const extra = { operatorsText: 'Nadia Bernard (NB) — Technicienne, Paul Martin (PM) — Préleveur', providerName: 'HYDRECO' };
  let st = enter(items, empty(), OPERATORS_SOURCE, null, extra);
  const team = 'Nadia Bernard (NB) — Technicienne, Paul Martin (PM) — Préleveur';
  eq(val(st, 'it-F2-2.1'), `HYDRECO : ${team}`);
  for (const k of [S1, S2]) {
    eq(val(st, `it-F1-R4@${k}`), team); eq(st.responses[`it-F1-R4@${k}`].from, 'F2');
    for (const b of ['it-F3-12', 'it-F4-1', 'it-F6-1', 'it-F7-1', 'it-F8-A1']) { eq(val(st, `${b}@${k}`), team, `${b}@${k}`); eq(st.responses[`${b}@${k}`].from, 'F1.R4'); }
    deepEq(val(st, `it-F9-1@${k}`), { nom: 'Nadia Bernard (NB), Paul Martin (PM)', fonction: 'Technicienne, Préleveur' });
    deepEq(st.sheets[`4@${k}`], { agents: team, agentsFrom: 'F1.R4' });
  }
  eq(sourceInfo(OPERATORS_SOURCE, items).code, 'F2');
  // Présence sur la station 2 corrigée à la main (un seul préleveur) : ses feuilles suivent, la station 1 non.
  st.sheets['4@' + S1] = { agents: 'Saisi par le contrôleur', agentsManual: true };
  st = enter(items, st, `it-F1-R4@${S2}`, 'Paul Martin (PM) — Préleveur', extra);
  eq(val(st, `it-F4-1@${S2}`), 'Paul Martin (PM) — Préleveur'); deepEq(val(st, `it-F9-1@${S2}`), { nom: 'Paul Martin (PM)', fonction: 'Préleveur' });
  eq(st.sheets['4@' + S2].agents, 'Paul Martin (PM) — Préleveur');
  // Préleveur ajouté à la tournée : station 1 (encore reprise) suit, station 2 (saisie) et encadré saisi non.
  const extra2 = { ...extra, operatorsText: `${team}, Léa Roux (LR) — Assistante` };
  st = enter(items, st, OPERATORS_SOURCE, null, extra2);
  assert(val(st, `it-F1-R4@${S1}`).endsWith('Léa Roux (LR) — Assistante') && val(st, `it-F6-1@${S1}`).includes('Léa Roux'));
  eq(val(st, `it-F1-R4@${S2}`), 'Paul Martin (PM) — Préleveur');
  eq(st.sheets['4@' + S1].agents, 'Saisi par le contrôleur', 'encadré saisi par l’agent conservé');
  eq(val(st, 'it-F2-2.1'), `HYDRECO : ${extra2.operatorsText}`);
  // Aucun préleveur : les reprises de la tournée sont retirées (F2.2.1 garde le prestataire).
  st = enter(items, st, OPERATORS_SOURCE, null, { operatorsText: '', providerName: 'HYDRECO' });
  eq(val(st, 'it-F2-2.1'), 'HYDRECO'); eq(val(st, `it-F1-R4@${S1}`), undefined); eq(val(st, `it-F3-12@${S1}`), undefined);
  // Cours d'eau : pas de feuilles biologiques, l'encadré F4 et F3.12 / F4.1 sont remplis.
  const ce = enter(itemsFor('ce', [ATHANASE]), empty(), OPERATORS_SOURCE, null, extra);
  deepEq(ce.ups.filter(u => u.id).map(u => parseItemId(u.id).baseId), ['it-F1-R4', 'it-F2-2.1', 'it-F3-12', 'it-F4-1']);
  eq(ce.ups.filter(u => u.sheet).length, 1);
});

test('liens proposés : coordonnées F3.15 → F7.3 / F9.3, température F5.13 → F9.11, heures F2.1.5 → F2.5.2', () => {
  const items = itemsFor('bio', [ATHANASE], { compartments: BIO_ALL });
  const responses = {
    [`it-F3-15@${S1}`]: { value: { srs: '21N', x21: 829310, y21: 608565, x: 164411, y: 608597 } },
    [`it-F5-13@${S1}`]: { value: 4.5, status: 'C' },
    'it-F2-1.5': { value: '07:45' }
  };
  deepEq(linkedUpdates({ items, responses, changed: Object.keys(responses) }), [], 'jamais appliqués seuls');
  const at = id => items.find(i => i.id === id);
  const p = linkProposal({ items, responses, item: at(`it-F7-3@${S1}`) });
  deepEq(p.value, { srs: '21N', x21: 829310, y21: 608565, x: 164411, y: 608597 }); eq(p.from, 'F3.15'); eq(p.mode, 'suggest');
  deepEq(linkProposal({ items, responses, item: at(`it-F9-11@${S1}`) }).value, { t: 4.5 });
  deepEq(linkProposal({ items, responses: { ...responses, [`it-F9-11@${S1}`]: { value: { choix: 'Oui' } } }, item: at(`it-F9-11@${S1}`) }).value, { choix: 'Oui', t: 4.5 }, 'autres champs conservés');
  eq(linkProposal({ items, responses, item: at('it-F2-5.2') }).value, '07:45');
  eq(linkProposal({ items, responses: { ...responses, 'it-F2-5.2': { value: '07:45' } }, item: at('it-F2-5.2') }), null, 'valeur identique : rien à proposer');
});

test('reprise de la station précédente : points vides seulement, jamais mesures, coordonnées, infos de station ni critères communs', () => {
  const items = itemsFor('ce', [ATHANASE, ACAROUANY]);
  const responses = {
    [`it-F4-3@${S1}`]: { status: 'C' },
    [`it-F4-4@${S1}`]: { status: 'NC', comment: 'pH non mesuré au point prévu', value: 7.2 },
    [`it-F4-11@${S1}`]: { status: 'P', comment: 'mesure en bordure' },
    [`it-F4-2`]: { status: 'C' },
    [`it-F4-12@${S1}`]: { status: 'C' },
    [`it-F4-12@${S2}`]: { status: 'NC', comment: 'flacon manquant' },
    [`it-F4-13@${S1}`]: { status: 'C' },
    [`it-F4-13@${S2}`]: { value: 'Saisi', valueManual: true },
    [`it-F5-19@${S1}`]: { status: 'C', value: 'Canne' },
    [`it-F3-3@${S1}`]: { status: 'C', value: 'Athanase', prefilled: true },
    [`it-F3-15@${S1}`]: { status: 'C', value: { x: 356714, y: 465112 } }
  };
  const f4 = copyFromPreviousStation({ items, responses, sheetNo: 4, stationKey: S2, prevKey: S1 });
  deepEq(f4, [
    { id: `it-F4-3@${S2}`, fromId: `it-F4-3@${S1}`, status: 'C' },
    { id: `it-F4-4@${S2}`, fromId: `it-F4-4@${S1}`, status: 'NC', comment: 'pH non mesuré au point prévu' },
    { id: `it-F4-11@${S2}`, fromId: `it-F4-11@${S1}`, status: 'P', comment: 'mesure en bordure' }
  ], 'mesure (7,2) non reprise ; F4.12 déjà coté et F4.13 déjà saisi inchangés ; F4.2 commun à la tournée exclu');
  deepEq(copyFromPreviousStation({ items, responses, sheetNo: 5, stationKey: S2, prevKey: S1 }), [{ id: `it-F5-19@${S2}`, fromId: `it-F5-19@${S1}`, status: 'C', value: 'Canne' }], 'choix de liste repris');
  // F3 : nom de la station (information du référentiel) jamais repris ; coordonnées : statut seul, jamais X / Y.
  deepEq(copyFromPreviousStation({ items, responses, sheetNo: 3, stationKey: S2, prevKey: S1 }), [{ id: `it-F3-15@${S2}`, fromId: `it-F3-15@${S1}`, status: 'C' }]);
  deepEq(copyFromPreviousStation({ items, responses, sheetNo: 4, stationKey: S1, prevKey: S1 }), []);
  deepEq(copyFromPreviousStation({ items, responses, sheetNo: 4, stationKey: S2, prevKey: null }), []);
  // Point pré-rempli sans statut (ex. date reprise) : considéré vide, son statut peut être repris ; la valeur reste.
  const r2 = { ...responses, [`it-F3-14@${S1}`]: { status: 'C', value: '2026-10-01', prefilled: true }, [`it-F3-14@${S2}`]: { value: '2026-10-01', prefilled: true, from: 'F2.1.4' } };
  deepEq(copyFromPreviousStation({ items, responses: r2, sheetNo: 3, stationKey: S2, prevKey: S1 }).map(c => [c.id, c.status, c.value]), [[`it-F3-14@${S2}`, 'C', undefined], [`it-F3-15@${S2}`, 'C', undefined]]);
});

test('fiche de la station → F3 de LA station : repris à la création, recalculé quand la fiche change, jamais une saisie', () => {
  const items = itemsFor('ce');
  const sites = { [S1]: ATHANASE, [S2]: ACAROUANY };
  const at = id => items.find(i => i.id === id);
  // Création de la tournée (comme createAudit : une source « @site@<clé> » par station)
  let ups = linkedUpdates({ items, changed: [`${SITE_SOURCE}@${S1}`, `${SITE_SOURCE}@${S2}`], extra: { sites } });
  let st = apply(empty(), ups);
  deepEq(ups.filter(u => u.id.endsWith(S1)).map(u => [parseItemId(u.id).baseId, u.value]), [
    ['it-F3-1', 'Approuague'], ['it-F3-2', 'Approuague'], ['it-F3-3', 'ATHANASE'], ['it-F3-4', '09271503'], ['it-F3-6', 'Orpaillage'], ['it-F3-9', 'Régina']
  ], 'cours d’eau : ni Strahler, ni HER (biologie), ni code BSS ; nom en capitales comme à la création');
  eq(val(st, `it-F3-1@${S2}`), 'Mana'); eq(val(st, `it-F3-3@${S2}`), 'ACAROUANY');
  deepEq((({ from, fromId, prefilled }) => ({ from, fromId, prefilled }))(st.responses[`it-F3-1@${S1}`]), { from: 'fiche station', fromId: `@site@${S1}`, prefilled: true });
  deepEq((({ code, short }) => ({ code, short }))(sourceInfo(`@site@${S1}`, items)), { code: 'fiche station', short: 'la fiche station' });
  assert(sourceInfo(`@site@${S1}`, items).text.includes('référentiel'), 'info-bulle « Repris de la fiche de la station (référentiel…) »');
  // Valeurs identiques déjà marquées : aucune écriture superflue
  deepEq(linkedUpdates({ items, responses: st.responses, changed: [`${SITE_SOURCE}@${S1}`], extra: { sites } }), []);
  // L'agent cote le nom (C) et corrige la pression à la main ; la fiche de la station est ensuite modifiée
  st.responses[`it-F3-3@${S1}`] = { ...st.responses[`it-F3-3@${S1}`], status: 'C' };
  st = enter(items, st, `it-F3-6@${S1}`, 'Orpaillage illégal');
  deepEq(st.ups, [], 'F3.6 n’alimente aucune autre feuille');
  const site2 = { ...ATHANASE, name: 'Athanase amont', bassin: 'Approuague aval', pressions: 'Aucune', commune: '' };
  const sites2 = { [S1]: site2, [S2]: ACAROUANY };
  ups = linkedUpdates({ items, responses: st.responses, changed: [`${SITE_SOURCE}@${S1}`], extra: { sites: sites2 } });
  deepEq(ups.map(u => [u.id, u.clear ? 'retiré' : u.value]), [[`it-F3-1@${S1}`, 'Approuague aval'], [`it-F3-9@${S1}`, 'retiré']],
    'bassin recalculé, commune effacée de la fiche retirée ; nom coté et pression saisie inchangés ; station 2 non concernée');
  st = apply(st, ups);
  eq(val(st, `it-F3-3@${S1}`), 'ATHANASE'); eq(val(st, `it-F3-6@${S1}`), 'Orpaillage illégal'); eq(val(st, `it-F3-9@${S1}`), undefined);
  // La nouvelle valeur de la fiche est seulement PROPOSÉE pour le nom coté et la pression saisie
  deepEq((({ value, from, mode }) => ({ value, from, mode }))(linkProposal({ items, responses: st.responses, item: at(`it-F3-3@${S1}`), extra: { sites: sites2 } })), { value: 'ATHANASE AMONT', from: 'fiche station', mode: 'auto' });
  eq(linkProposal({ items, responses: st.responses, item: at(`it-F3-6@${S1}`), extra: { sites: sites2 } }).value, 'Aucune');
  eq(linkProposal({ items, responses: st.responses, item: at(`it-F3-1@${S1}`), extra: { sites: sites2 } }), null, 'valeur à jour : rien à proposer');
  // Fiche modifiée sur l'AUTRE tablette (aucune reprise à la réception) : la valeur en retard est proposée
  eq(linkProposal({ items, responses: st.responses, item: at(`it-F3-2@${S2}`), extra: { sites: { ...sites2, [S2]: { ...ACAROUANY, riverName: 'Crique Acarouany' } } } }).value, 'Crique Acarouany');
  // Biologie : Strahler et hydro-écorégion ; eaux souterraines : code BSS (F3.18), pas de code SANDRE ni de bassin
  const bio = itemsFor('bio', [ATHANASE], { compartments: BIO_ALL });
  const b = apply(empty(), linkedUpdates({ items: bio, changed: [`${SITE_SOURCE}@${S1}`], extra: { sites } }));
  eq(val(b, `it-F3-5@${S1}`), '5'); eq(val(b, `it-F3-10@${S1}`), '15');
  const eso = itemsFor('eso', [PANK]);
  const e = linkedUpdates({ items: eso, changed: [`${SITE_SOURCE}@BSS002PANK`], extra: { sites: { BSS002PANK: PANK } } });
  deepEq(e.map(u => [parseItemId(u.id).baseId, u.value]), [['it-F3-3', 'AEP MARIPASOULA'], ['it-F3-6', 'Assainissement'], ['it-F3-9', 'Maripasoula'], ['it-F3-18', 'BSS002PANK']]);
  // Station inconnue sur cette tablette (fiche absente) : rien n'est repris ni retiré
  deepEq(linkedUpdates({ items, responses: st.responses, changed: [`${SITE_SOURCE}@${S2}`], extra: { sites: {} } }), []);
});

test('cible en retard sur sa source (tournée reçue d’une autre tablette) : valeur proposée, jamais écrite', () => {
  // Tablette A : météo de la journée saisie ; tablette B : 3e station ajoutée avant la réception (F1.R5 vide).
  const items3 = itemsFor('ce', [ATHANASE, ACAROUANY, SAKOURA]);
  const responses = { 'it-F2-1.9': { value: 'Pluie forte', valueManual: true }, [`it-F1-R5@${S1}`]: { value: 'Pluie forte', prefilled: true, from: 'F2.1.9', fromId: 'it-F2-1.9' } };
  const at = id => items3.find(i => i.id === id);
  const p = linkProposal({ items: items3, responses, item: at(`it-F1-R5@${S3}`) });
  deepEq((({ value, from, mode }) => ({ value, from, mode }))(p), { value: 'Pluie forte', from: 'F2.1.9', mode: 'auto' });
  eq(linkProposal({ items: items3, responses, item: at(`it-F1-R5@${S1}`) }), null, 'cible à jour');
  eq(linkProposal({ items: items3, responses, item: at(`it-F3-7@${S3}`) }), null, 'chaîne : F3.7 attend F1.R5 de sa station (vide)');
});

test('propositions : moyens et difficultés d’accès, supports, lot / marché, effectif, sondes et calibration (jamais écrites)', () => {
  const items = itemsFor('ce');
  const at = id => items.find(i => i.id === id);
  const extra = {
    stations: [{ key: S1, name: 'Athanase', modes: ['Bateau motorisé / pirogue'], difficulties: 'Roches, Saut Tourépé.' }, { key: S2, name: 'Acarouany', modes: ['4x4'], difficulties: '' }],
    compartments: [{ key: 'physico', label: 'Physico-chimie in situ et prélèvement eau' }],
    markets: [{ ref: 'MARCHE-DEMO-2026', lots: 'Lot 1' }, { ref: 'MARCHE-DEMO-2026', lots: 'Lot 1' }],
    operatorsCount: 2,
    instruments: [
      { key: 'ph', label: 'Sonde pH', model: 'WTW 3110', serial: '1234', calibration: '2026-10-01', standards: '4 – 7 – 10' },
      { key: 'o2', label: 'Sonde O₂' },
      { key: 'cond', label: 'Conductivité', model: 'HACH HQ40d', calibration: '2026-09-28' }
    ]
  };
  // Aucune de ces sources n'écrit quoi que ce soit
  deepEq(linkedUpdates({ items, changed: [STATIONS_SOURCE, COMPARTMENTS_SOURCE, MARKET_SOURCE, INSTRUMENTS_SOURCE, OPERATORS_SOURCE], extra }).filter(u => ['it-F2-3.1', 'it-F2-1.10', 'it-F2-1.13', 'it-F2-1.12', 'it-F2-2.2', 'it-F4-18', 'it-F4-2'].includes(u.id)), []);
  const prop = (id, responses = {}, x = extra) => linkProposal({ items, responses, item: at(id), extra: x });
  // Moyens d'accès : deux moyens différents → deux choix proposés (ordre de la liste), un seul → valeur proposée
  const m = prop('it-F2-3.1');
  deepEq([m.value, m.choices, m.from, m.mode], ['4x4', ['4x4', 'Bateau motorisé / pirogue'], 'fiches station', 'suggest']);
  eq(prop('it-F2-3.1', { 'it-F2-3.1': { status: 'C', value: 'Bateau motorisé / pirogue' } }), null, 'un des moyens déjà retenu');
  const one = { ...extra, stations: [{ key: S1, modes: ['4x4'] }, { key: S2, modes: ['4X4'] }] };
  deepEq([prop('it-F2-3.1', {}, one).value, prop('it-F2-3.1', {}, one).choices], ['4x4', undefined]);
  deepEq(prop('it-F2-3.1', {}, { ...extra, stations: [{ key: S1, modes: ['Voiture', 'à pied'] }] }).choices, ['À pied', 'Autre'], 'moyen inconnu de la liste : « Autre »');
  // Difficultés d'accès : précédées du nom de la station dès qu'il y a plusieurs stations
  eq(prop('it-F2-1.10').value, 'Athanase : Roches, Saut Tourépé.');
  eq(prop('it-F2-1.10', {}, { ...extra, stations: [{ key: S1, name: 'Athanase', difficulties: 'Roches\nSaut Tourépé' }] }).value, 'Roches, Saut Tourépé');
  eq(prop('it-F2-1.10', {}, { ...extra, stations: [] }), null);
  // Supports, lot / marché (sans doublon), effectif
  eq(prop('it-F2-1.13').value, 'eau');
  eq(prop('it-F2-1.13', {}, { ...extra, compartments: [{ key: 'physico' }, { key: 'invertebres' }, { key: 'diatomees' }, { key: 'autre', label: 'Macrophytes' }] }).value, 'eau, invertébrés aquatiques, diatomées, Macrophytes');
  eq(prop('it-F2-1.12').value, 'MARCHE-DEMO-2026 (Lot 1)');
  eq(prop('it-F2-1.12', {}, { ...extra, markets: [] }), null, 'aucune prestation rattachée');
  deepEq([prop('it-F2-2.2').value, prop('it-F2-2.2').from], [2, 'F2']);
  eq(prop('it-F2-2.2', { 'it-F2-2.2': { status: 'C', value: 2 } }), null, 'effectif déjà saisi identique');
  eq(prop('it-F2-2.2', { 'it-F2-2.2': { status: 'P', value: 3, comment: 'un stagiaire' } }).value, 2, 'effectif différent : proposition, jamais écrite');
  eq(prop('it-F2-2.2', {}, { ...extra, operatorsCount: 0 }), null);
  // Sondes et calibration (module « Appareils de mesure » de F4, données de la tournée)
  eq(prop('it-F4-18').value, 'Sonde pH : WTW 3110 n° 1234 ; Conductivité : HACH HQ40d');
  eq(prop('it-F4-2').value, 'Sonde pH : calibration du 01/10/2026 (étalons 4 – 7 – 10) ; Conductivité : calibration du 28/09/2026');
  deepEq([prop('it-F4-2').from, sourceInfo(INSTRUMENTS_SOURCE, items).text], ['F4', 'F4 — appareils de mesure (in situ)']);
  eq(prop('it-F4-18', {}, { ...extra, instruments: [{ key: 'ph', label: 'Sonde pH' }] }), null, 'aucun appareil identifié');
});

test('heures de la tournée rapprochées de la feuille Organisation (F2.1.5 / F2.1.6) : auditTimes, auditTimeTexts', () => {
  // Création à 08:02 le jour de la tournée ; « Début du contrôle » corrigé à 07:45 ; fin saisie 16:30, clôture 17:05
  const start = new Date(2026, 9, 18, 8, 2).toISOString(), end = new Date(2026, 9, 18, 17, 5).toISOString();
  const a = { date: '2026-10-18', startedAt: start, endedAt: null, responses: {} };
  deepEq(auditTimeTexts(a), { start: '08:02', end: 'en cours' }, 'sans saisie de F2 : heures de la tournée');
  a.responses['it-F2-1.5'] = { value: '08:02', prefilled: true };
  deepEq(auditTimeTexts(a), { start: '08:02 (début du contrôle, F2.1.5)', end: 'en cours' });
  a.responses['it-F2-1.5'] = { value: '07:45', valueManual: true };
  a.responses['it-F2-1.6'] = { value: '16:30' };
  a.endedAt = end;
  deepEq((({ start, end, startFromSheet, endFromSheet, enteredAt, closedAt }) => ({ start, end, startFromSheet, endFromSheet, enteredAt, closedAt }))(auditTimes(a)),
    { start: '07:45', end: '16:30', startFromSheet: true, endFromSheet: true, enteredAt: '08:02', closedAt: '17:05' });
  deepEq(auditTimeTexts(a), { start: '07:45 (début du contrôle, F2.1.5) — saisie démarrée à 08:02', end: '16:30 (fin du contrôle, F2.1.6) — tournée clôturée à 17:05' });
  // Tournée saisie après coup (un autre jour que sa date) : jour de saisie indiqué
  const b = { date: '2026-10-15', startedAt: start, endedAt: null, responses: {} };
  deepEq(auditTimeTexts(b, { open: 'non clôturé' }), { start: '08:02 (saisie démarrée le 18/10/2026)', end: 'non clôturé' });
  b.responses['it-F2-1.5'] = { value: '09:10' };
  eq(auditTimeTexts(b).start, '09:10 (début du contrôle, F2.1.5) — saisie démarrée le 18/10/2026 à 08:02');
  eq(auditTimes({ responses: { 'it-F2-1.5': { value: 'matin' } } }).start, '', 'valeur non horaire ignorée');
});

test('échange entre tablettes : valeur et provenance d’une réponse fusionnées d’un bloc (ni mélange, ni perte)', () => {
  const R5 = `it-F1-R5@${S2}`, R6 = `it-F1-R6@${S1}`;
  const base = { id: 'a1', updatedAt: '2026-10-23T08:00:00Z', responses: { [R6]: { value: 'Basses eaux', prefilled: true, from: 'F2.1.8', fromId: 'it-F2-1.8', at: '2026-10-23T08:00:00Z' } }, sheets: {} };
  // Tablette A : météo de la journée reprise sur la station 2 ; tablette B : météo de la station 2 saisie (plus tard)
  const A = { ...base, updatedAt: '2026-10-23T09:00:00Z', responses: { ...base.responses, [R5]: { value: 'Pluie forte', prefilled: true, from: 'F2.1.9', fromId: 'it-F2-1.9', at: '2026-10-23T09:00:00Z', by: 'alice' } } };
  const B = { ...base, updatedAt: '2026-10-23T09:30:00Z', responses: { ...base.responses, [R5]: { value: 'Couvert', valueManual: true, status: 'C', at: '2026-10-23T09:30:00Z', by: 'bruno' },
    [R6]: { value: 'Hautes eaux', valueManual: true, at: '2026-10-23T09:10:00Z', by: 'bruno' } } };
  for (const [local, remote] of [[A, B], [B, A]]) {
    const { merged, conflicts } = mergeEntity('audit', base, local, remote);
    deepEq(merged.responses[R5], B.responses[R5], 'saisie la plus récente retenue entière : jamais « Couvert » marqué « repris de F2.1.9 »');
    deepEq(merged.responses[R6], B.responses[R6], 'modifiée d’un seul côté : ce côté entier (la marque « repris » de la version commune disparaît)');
    const c = conflicts.find(x => x.path === `responses.${R5}.value`);
    assert(c && c.kept === (local === B ? 'local' : 'remote') && [c.localValue, c.remoteValue].includes('Pluie forte'), 'valeur écartée conservée dans le rapport de conflits');
    assert(!conflicts.some(x => /\.(prefilled|from|fromId|valueManual)$/.test(x.path)), 'pas de conflit sur les marques');
  }
  // Statut posé d'un côté, valeur reprise de l'autre : les deux sont gardés (champs indépendants)
  const C1 = { ...base, updatedAt: '2026-10-23T09:00:00Z', responses: { [R6]: { ...base.responses[R6], status: 'C', at: '2026-10-23T09:00:00Z' } } };
  const C2 = { ...base, updatedAt: '2026-10-23T09:05:00Z', responses: { [R6]: { ...base.responses[R6], value: 'Crue', fromId: 'it-F2-1.8', at: '2026-10-23T09:05:00Z' } } };
  const m = mergeEntity('audit', base, C1, C2).merged.responses[R6];
  deepEq([m.status, m.value, m.prefilled, m.from], ['C', 'Crue', true, 'F2.1.8']);
  // Encadré « Agent(s) prestataire(s) » : saisi d'un côté, repris de l'autre → le plus récent entier
  const sb = { ...base, sheets: { [`4@${S1}`]: { agents: 'NB', agentsFrom: 'F1.R4' } } };
  const s1 = { ...sb, updatedAt: '2026-10-23T09:00:00Z', sheets: { [`4@${S1}`]: { agents: 'NB, DB', agentsFrom: 'F1.R4', notes: 'x' } } };
  const s2 = { ...sb, updatedAt: '2026-10-23T09:20:00Z', sheets: { [`4@${S1}`]: { agents: 'Nadia B. (cheffe d’équipe)', agentsManual: true } } };
  deepEq(mergeEntity('audit', sb, s1, s2).merged.sheets[`4@${S1}`], { agents: 'Nadia B. (cheffe d’équipe)', agentsManual: true, notes: 'x' });
});
