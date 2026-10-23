/* Tests unitaires du PÉRIMÈTRE RÉEL d'une station dans une tournée (demande de l'OEG du 18/10/2026 : « Certaines
 * stations contiennent chimie + bio mais seule la partie bio ou chimie ou chimie + bio peuvent être auditées […] si c'est
 * le même prestataire certaines opérations vont être mutualisées ») — fonctions pures de js/domain/grids.js sur la
 * grille CT-2026 :
 * - parties d'une station (`station.parts`, défaut : le type de la tournée), types de la tournée, compartiments d'une
 *   partie et d'une tournée de plusieurs types (la physico-chimie, commune, n'est retenue qu'une fois) ;
 * - tournée d'un seul type : résultat IDENTIQUE à l'ancien (aucune partie enregistrée ; parties explicites égales au type
 *   de la tournée : mêmes feuilles, mêmes critères) — tournées existantes, sceaux et PDF inchangés ;
 * - station BIO + Chimie contrôlée pour les deux (Acarouany, 09160201) : F1, F3, F4, F5 une seule fois (opérations
 *   mutualisées : réunion des points de chaque partie, aucun critère en double), F6 / F7 en plus ; station chimie seule
 *   dans la même tournée : ni F6 / F7 ni points propres à la biologie ; encadrés et variantes de la partie principale ;
 * - décomptes de la synthèse : chaque point (mutualisé ou commun à la tournée) compté une fois ;
 * - normalizePerimeter : prestations rattachées à chaque partie, partie retirée ⇒ prestation retirée, type principal ;
 * - en-tête d'une tournée mixte (programmes des deux types), pré-remplissage selon les parties de la station ;
 * - fusion (échange entre tablettes) : le périmètre modifié d'un côté est repris. */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_CT_2026 } from '../../js/domain/grid-ct-2026.js';
import {
  PART_LABELS, partLabel, partsText, normalizeParts, stationParts, tourTypes, partCompartments, stationCompartmentKeys, tourCompartments,
  normalizePerimeter, stationPrestationIds, tourTypeLabel, orderedParts, auditCompartments, typeCompartments, expandGrid, sheetsOf,
  visibleItems, resolveSheet, sheetBlocks, headerOf, prefillResponses, allItems, progress, validateResponses
} from '../../js/domain/grids.js';
import { stationSummary, sheetSummary } from '../../js/domain/summary.js';
import { mergeEntity } from '../../js/domain/merge.js';

const G = GRID_CT_2026;
const ACAROUANY = { id: 'site-09160201', code: '09160201', name: 'Acarouany', bassin: 'Mana', riverName: 'Acarouany', strahler: 4, her: 51, matrixId: 'mat-ESU', compartments: ['organisation', 'physico', 'invertebres', 'diatomees'] };
const ATHANASE = { id: 'site-09271503', code: '09271503', name: 'Athanase', bassin: 'Approuague', strahler: 5, her: 15, matrixId: 'mat-ESU', compartments: ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons'] };
const SAKOURA = { id: 'site-09281718', code: '09281718', name: 'Sakoura', bassin: 'Mahury', matrixId: 'mat-ESU', compartments: ['organisation', 'physico'] };
const SITES = { [ACAROUANY.id]: ACAROUANY, [ATHANASE.id]: ATHANASE, [SAKOURA.id]: SAKOURA };
const A = '09160201', B = '09271503', C = '09281718';
const BIO_CE = ['organisation', 'physico', 'invertebres', 'diatomees'];

const eff = stations => expandGrid(G, stations, SITES, { provider: { name: 'HYDRECO' } });
const keys = list => list.map(s => s.instanceKey);
const ids = (E, ctx, responses = {}) => visibleItems(E, responses, ctx).map(x => x.item.id);
const of = (list, key) => list.filter(id => id.endsWith('@' + key));

test('parties : libellés, normalisation, parties d’une station, types de la tournée', () => {
  deepEq(PART_LABELS, { bio: 'Biologie', ce: 'Chimie', eso: 'Eaux souterraines' });
  eq(partLabel(G, 'ce'), 'Chimie'); eq(partsText(G, ['bio', 'ce']), 'Biologie + Chimie');
  deepEq(normalizeParts(G, ['ce', 'bio', 'ce', 'x']), ['bio', 'ce'], 'ordre de la grille, sans doublon ni type inconnu');
  eq(normalizeParts(G, []), null); eq(normalizeParts(G, ['x']), null); eq(normalizeParts(G, null), null);
  deepEq(stationParts(G, { key: A }, 'ce'), ['ce'], 'sans parties : le type de la tournée');
  deepEq(stationParts(G, { key: A, parts: ['ce', 'bio'] }, 'ce'), ['bio', 'ce']);
  deepEq(orderedParts(G, { key: A, parts: ['bio', 'ce'] }, 'ce'), ['ce', 'bio'], 'partie principale en tête');
  deepEq(tourTypes(G, [{ key: A, parts: ['bio', 'ce'] }, { key: C, parts: ['ce'] }], 'bio'), ['bio', 'ce']);
  deepEq(tourTypes(G, [{ key: A }, { key: B }], 'bio'), ['bio'], 'tournée d’un seul type');
  deepEq(tourTypes(G, [], 'eso'), ['eso']);
  eq(tourTypeLabel(G, ['bio', 'ce']), 'Hydrobiologie – RCS ESC BIO + Cours d’eau – physico-chimie');
  eq(tourTypeLabel(G, ['ce']), 'Cours d’eau – physico-chimie');
});

test('compartiments : d’une partie, d’une station, d’une tournée de plusieurs types (physico-chimie commune une fois)', () => {
  deepEq(partCompartments(G, BIO_CE, 'ce'), ['organisation', 'physico']);
  deepEq(partCompartments(G, BIO_CE, 'bio'), BIO_CE);
  deepEq(partCompartments(G, ['organisation', 'invertebres'], 'ce'), ['organisation'], 'physico non retenue : rien de la chimie hors organisation');
  deepEq(stationCompartmentKeys(G, BIO_CE, ['ce']), ['organisation', 'physico']);
  deepEq(stationCompartmentKeys(G, BIO_CE, ['bio', 'ce']), BIO_CE);
  // Une tournée d'un seul type : identique à auditCompartments (comportement d'avant).
  for (const t of ['bio', 'ce', 'eso']) for (const w of [null, BIO_CE, ['organisation', 'poissons']]) deepEq(tourCompartments(G, [t], w), auditCompartments(G, t, w), `${t} ${w}`);
  // Biologie + chimie : la physico-chimie (compartiment unique de la chimie) est toujours retenue, une seule fois.
  deepEq(tourCompartments(G, ['bio', 'ce'], ['organisation', 'invertebres']), ['organisation', 'physico', 'invertebres']);
  deepEq(tourCompartments(G, ['bio', 'ce'], { bio: ['diatomees'], ce: null }), ['organisation', 'physico', 'diatomees']);
  deepEq(tourCompartments(G, ['bio', 'ce'], null), typeCompartments(G, 'bio'), 'sans choix : tous ceux de la biologie (dont physico)');
});

test('tournée d’un seul type : parties explicites égales au type ⇒ mêmes feuilles et mêmes critères qu’avant (aucun changement)', () => {
  for (const [type, comps, stations] of [['bio', BIO_CE, [ACAROUANY, ATHANASE]], ['ce', ['organisation', 'physico'], [ACAROUANY, SAKOURA]]]) {
    const ctx = { auditType: type, compartments: comps };
    const legacy = eff(stations.map(s => ({ siteId: s.id })));
    const explicit = eff(stations.map(s => ({ siteId: s.id, parts: [type] })));
    deepEq(keys(sheetsOf(explicit, {}, ctx)), keys(sheetsOf(legacy, {}, ctx)), `${type} : feuilles`);
    deepEq(ids(explicit, ctx), ids(legacy, ctx), `${type} : critères visibles`);
    deepEq(sheetsOf(explicit, {}, ctx).map(s => (s.blocks || []).map(b => b.title)), sheetsOf(legacy, {}, ctx).map(s => (s.blocks || []).map(b => b.title)), `${type} : encadrés`);
    deepEq(sheetsOf(explicit, {}, ctx).map(s => s.title), sheetsOf(legacy, {}, ctx).map(s => s.title), `${type} : titres (variantes)`);
    eq(progress(explicit, {}, ctx).total, progress(legacy, {}, ctx).total);
    assert(!('parts' in legacy.stations[0]), 'aucune partie ajoutée aux stations d’une tournée existante');
  }
  // normalizePerimeter d'une tournée d'un seul type : stations rendues sans `parts` ni `partPrestations`.
  const st = [{ key: A, siteId: ACAROUANY.id, pointId: 'pt-' + A, prestationId: 'pres-1', addedAt: 'x' }, { key: B, siteId: ATHANASE.id, pointId: null, prestationId: null, addedAt: 'x', parts: ['bio'] }];
  const n = normalizePerimeter(G, 'bio', st);
  deepEq(n, { auditType: 'bio', types: ['bio'], mixed: false, stations: [st[0], { key: B, siteId: ATHANASE.id, pointId: null, prestationId: null, addedAt: 'x' }] });
});

test('station BIO + Chimie contrôlée pour les deux (même prestataire) : opérations communes une seule fois, feuilles propres en plus', () => {
  const ctx = { auditType: 'bio', compartments: BIO_CE };
  const mixed = eff([{ siteId: ACAROUANY.id, parts: ['bio', 'ce'] }]);
  const bio = eff([{ siteId: ACAROUANY.id }]);
  const ce = eff([{ siteId: ACAROUANY.id }]);
  const sh = sheetsOf(mixed, {}, ctx);
  deepEq(keys(sh), ['1@' + A, '2', '3@' + A, '4@' + A, '5@' + A, '6@' + A, '7@' + A], 'F1, F2, F3, F4, F5 une fois ; F6, F7 de la biologie');
  const all = ids(mixed, ctx);
  eq(new Set(all).size, all.length, 'aucun critère en double');
  const bioIds = ids(bio, ctx), ceIds = ids(ce, { auditType: 'ce', compartments: ['organisation', 'physico'] });
  deepEq([...all].sort(), [...new Set([...bioIds, ...ceIds])].sort(), 'réunion exacte des points de la biologie et de la chimie');
  assert(all.length < bioIds.length + ceIds.length, 'points communs mutualisés (comptés une fois)');
  for (const id of ['it-F3-5@' + A, 'it-F3-10@' + A, 'it-F3-11@' + A, 'it-F3-17@' + A, 'it-F4-11@' + A, 'it-F5-4@' + A, 'it-F4-2', 'it-F2-1.8']) assert(all.includes(id), id);
  assert(!all.some(id => /^it-F(10|8|9)-/.test(id)), 'ni eaux souterraines, ni poissons, ni phytoplancton (non retenus)');
  // Encadrés : un seul encadré « conclusion » par feuille (même stockage) — celui de la partie principale (biologie).
  const f4 = sh.find(s => s.no === 4), f3 = sh.find(s => s.no === 3), f5 = sh.find(s => s.no === 5);
  deepEq(f4.blocks.filter(b => b.key === 'conclusion').map(b => b.title), ['Conclusion générale']);
  deepEq(f5.blocks.filter(b => b.key === 'conclusion').map(b => b.title), ['Conclusion du contrôle']);
  deepEq(f3.blocks.map(b => b.title), ['Observations générales et non-conformités', 'Prise de photos / références / commentaires', 'Bilan – Localisation et accès au site'], 'bilan de F3 propre à la chimie ajouté');
  eq(f4.title, 'Physico-chimie, mesures in situ et flaconnage', 'variante de la partie principale');
  // Partie principale chimie : variantes et encadrés de la chimie en premier.
  const shCe = sheetsOf(mixed, {}, { auditType: 'ce', compartments: BIO_CE });
  deepEq(keys(shCe), keys(sh));
  eq(shCe.find(s => s.no === 4).title, 'Physico-chimie, mesures in situ, étalonnage et flaconnage');
  deepEq(shCe.find(s => s.no === 4).blocks.filter(b => b.key === 'conclusion').map(b => b.title), ['Bilan – Mesures in situ, étalonnage et flaconnage']);
});

test('tournée mixte à trois stations : chaque station selon SES parties ; décomptes sans double comptage', () => {
  const ctx = { auditType: 'bio', compartments: BIO_CE };
  const stations = [{ siteId: ACAROUANY.id, parts: ['bio', 'ce'] }, { siteId: ATHANASE.id, parts: ['bio'] }, { siteId: SAKOURA.id, parts: ['ce'] }];
  const E = eff(stations);
  const sh = sheetsOf(E, {}, ctx);
  deepEq(keys(sh), ['1@' + A, '2', '3@' + A, '4@' + A, '5@' + A, '6@' + A, '7@' + A, '1@' + B, '3@' + B, '4@' + B, '5@' + B, '6@' + B, '7@' + B, '1@' + C, '3@' + C, '4@' + C, '5@' + C]);
  const all = ids(E, ctx);
  eq(new Set(all).size, all.length, 'aucun critère en double');
  assert(!of(all, C).some(id => /^it-F[67]-/.test(id)), 'station chimie seule : ni invertébrés ni diatomées');
  assert(!of(all, C).includes('it-F3-5@' + C) && of(all, A).includes('it-F3-5@' + A), 'rang de Strahler : biologie seulement');
  assert(of(all, B).includes('it-F4-1@' + B), 'biologie seule : physico-chimie soutenant la biologie retenue (compartiment physico)');
  // Station chimie seule dans une tournée principalement biologique : variante et bilan de la chimie.
  const f4c = sh.find(s => s.instanceKey === '4@' + C);
  eq(f4c.title, 'Physico-chimie, mesures in situ, étalonnage et flaconnage');
  deepEq(f4c.blocks.filter(b => b.key === 'conclusion').map(b => b.title), ['Bilan – Mesures in situ, étalonnage et flaconnage']);
  eq(sh.find(s => s.instanceKey === '4@' + B).blocks.find(b => b.key === 'conclusion').title, 'Conclusion générale');
  // Numérotation « Feuille X / N » commune à la tournée (même feuille = même numéro à chaque station).
  deepEq(sh.filter(s => s.station?.key === C).map(s => s.index), [1, 3, 4, 5]);
  eq(sh[0].total, 7);
  // Décomptes : global = tournée + stations ; critères communs à la tournée (F4.2…) une seule fois.
  const responses = Object.fromEntries(visibleItems(E, {}, ctx).filter(x => x.item.kind === 'conformity').map(x => [x.item.id, { status: 'C' }]));
  const sum = stationSummary({ audit: { responses, stations, compartments: BIO_CE, auditType: 'bio' }, grid: E, ctx });
  const conf = visibleItems(E, {}, ctx).filter(x => x.item.kind === 'conformity').length;
  eq(sum.global.total, conf); eq(sum.global.C, conf);
  eq(sum.tournee.total + sum.stations.reduce((n, s) => n + s.total, 0), sum.global.total, 'tournée + stations = total');
  eq(sheetSummary({ audit: { responses, stations }, grid: E, ctx }).reduce((n, s) => n + s.total, 0), conf, 'somme des feuilles = total (communs comptés une fois)');
  // Contrôle avant clôture : chaque critère une fois.
  const errs = validateResponses(E, {}, ctx).filter(v => v.level === 'error');
  eq(new Set(errs.map(e => e.itemId)).size, errs.length);
});

test('normalizePerimeter : tournée mixte, prestations par partie, partie retirée, type principal', () => {
  const s = (key, extra = {}) => ({ key, siteId: 'site-' + key, pointId: null, prestationId: null, addedAt: 't', ...extra });
  // Station d'une tournée biologique (prestation bio) + chimie cochée à Acarouany : tournée mixte.
  let n = normalizePerimeter(G, 'bio', [s(B, { prestationId: 'pres-bio-B' }), s(A, { prestationId: 'pres-bio-A', parts: ['bio', 'ce'], partPrestations: { bio: 'pres-bio-A', ce: 'pres-ce-A' } })]);
  eq(n.mixed, true); deepEq(n.types, ['bio', 'ce']); eq(n.auditType, 'bio');
  deepEq(n.stations[0], s(B, { prestationId: 'pres-bio-B', parts: ['bio'], partPrestations: { bio: 'pres-bio-B' } }), 'station d’un seul type : parties explicites, prestation rattachée');
  deepEq(n.stations[1], s(A, { prestationId: 'pres-bio-A', parts: ['bio', 'ce'], partPrestations: { bio: 'pres-bio-A', ce: 'pres-ce-A' } }));
  deepEq(stationPrestationIds(n.stations[1]), ['pres-bio-A', 'pres-ce-A']);
  // Biologie retirée à Acarouany : prestation biologique détachée ; toujours mixte (Athanase en biologie).
  n = normalizePerimeter(G, 'bio', [n.stations[0], { ...n.stations[1], parts: ['ce'] }]);
  deepEq(n.stations[1], s(A, { prestationId: 'pres-ce-A', parts: ['ce'], partPrestations: { ce: 'pres-ce-A' } }));
  // Plus de biologie nulle part : tournée d'un seul type, la chimie ; parties retirées des stations.
  n = normalizePerimeter(G, 'bio', [{ ...n.stations[1] }]);
  deepEq(n, { auditType: 'ce', types: ['ce'], mixed: false, stations: [s(A, { prestationId: 'pres-ce-A' })] });
  // Partie sans prestation : prestation de la station à null (jamais celle d'une partie retirée).
  n = normalizePerimeter(G, 'bio', [s(A, { prestationId: 'pres-bio-A', parts: ['ce'], partPrestations: { bio: 'pres-bio-A' } })]);
  deepEq(n.stations[0], s(A, { prestationId: null }));
});

test('en-tête d’une tournée mixte et pré-remplissage selon les parties de chaque station', () => {
  const h = headerOf(G, { provider: { name: 'HYDRECO' }, auditType: 'bio', auditTypes: ['bio', 'ce'] });
  eq(h.title, 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026 + Physico-chimie des cours d’eau 2026');
  eq(h.typeLabel, 'Hydrobiologie – RCS ESC BIO + Cours d’eau – physico-chimie');
  eq(headerOf(G, { provider: { name: 'HYDRECO' }, auditType: 'bio', auditTypes: ['bio'] }).title, 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026', 'un seul type : inchangé');
  eq(headerOf(G, { provider: { name: 'HYDRECO' }, auditType: 'ce' }).typeLabel, 'Cours d’eau – physico-chimie');
  const stations = [{ siteId: ACAROUANY.id, parts: ['bio', 'ce'] }, { siteId: SAKOURA.id, parts: ['ce'] }];
  const E = eff(stations);
  const pre = prefillResponses(E, { auditType: 'bio', compartments: BIO_CE, stations: [{ key: A, site: ACAROUANY }, { key: C, site: SAKOURA }] });
  eq(pre['it-F3-5@' + A]?.value, '4', 'Strahler pré-rempli (biologie contrôlée)');
  assert(!pre['it-F3-5@' + C], 'station chimie seule : pas de Strahler');
  eq(pre['it-F3-1@' + C]?.value, 'Mahury');
  // resolveSheet / sheetBlocks : une partie = comportement d'avant ; plusieurs = un encadré par clé.
  const f4 = G.sheets.find(x => x.no === 4);
  deepEq(sheetBlocks(f4, 'ce'), sheetBlocks(f4, ['ce']));
  deepEq(resolveSheet(f4, 'eso'), resolveSheet(f4, ['eso']));
  deepEq(sheetBlocks(f4, ['eso', 'ce']).filter(b => b.key === 'conclusion').map(b => b.title), ['Bilan – Purge et mesure des paramètres in situ']);
});

test('fusion (échange entre tablettes) : périmètre modifié d’un seul côté repris ; des deux côtés : conflit tracé', () => {
  const base = { id: 'a1', updatedAt: '2026-10-20T08:00:00Z', stations: [{ key: A, siteId: ACAROUANY.id, prestationId: 'p1' }], auditType: 'bio', compartments: BIO_CE, responses: {} };
  const remote = { ...base, updatedAt: '2026-10-20T09:00:00Z', stations: [{ key: A, siteId: ACAROUANY.id, prestationId: 'p1', parts: ['bio', 'ce'], partPrestations: { bio: 'p1' } }] };
  const local = { ...base, updatedAt: '2026-10-20T08:30:00Z', responses: { 'it-F2-1.9': { value: 'Pluie forte' } } };
  const { merged, conflicts } = mergeEntity('audit', base, local, remote);
  deepEq(merged.stations, remote.stations); eq(merged.responses['it-F2-1.9'].value, 'Pluie forte'); eq(conflicts.length, 0);
  const local2 = { ...base, updatedAt: '2026-10-20T08:30:00Z', stations: [{ key: A, siteId: ACAROUANY.id, prestationId: null, parts: ['ce'] }] };
  const r = mergeEntity('audit', base, local2, remote);
  deepEq(r.merged.stations, remote.stations, 'le plus récent retenu entier'); eq(r.conflicts.length, 1);
  eq(allItems(eff(remote.stations)).length, allItems(eff(base.stations)).length, 'la grille effective ne dépend pas des parties (seule la visibilité)');
});
