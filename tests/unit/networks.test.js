/* Tests unitaires des réseaux de surveillance (js/domain/networks.js, modules purs) : réseaux par défaut des marchés
 * OEG 2026 (contenu déterministe), index avec repli, réseau virtuel, normalisation des codes (casse, accents, libellé,
 * jamais de correspondance partielle), tri, réseaux à créer, regroupement des 108 stations du référentiel (une station
 * sur deux réseaux dans chaque groupe, totaux distincts), déduction des types de tournée IDENTIQUE à l'ancienne règle,
 * couleurs d'affichage (contraste), réseau d'une prestation, fusion d'ensemble des réseaux d'une station (échange
 * entre tablettes), conditions de grille sur les réseaux, droits d'écriture du référentiel ; bandeau « Station » de la
 * feuille 1 (js/ui/sheet-chrome.js) : réseaux sur une ligne à part, absents sans l'option. */
import { test, assert, eq, deepEq } from './harness.js';
import {
  NETWORK_DEFAULTS, defaultNetworks, networkId, networkIndex, networkOf, networkLabel, sortNetworkCodes, listNetworks, canonicalNetwork,
  normalizeNetworkCodes, sameNetworks, auditTypesOf, networksToCreate, groupSitesByNetwork, inNetwork, prestationNetwork, networkColors,
  contrastRatio, NO_NETWORK, OTHER_COLOR, AUDIT_TYPE_KEYS
} from '../../js/domain/networks.js';
import { baseReferential, oegReferential, stationTypes, ceProgramme, bioProgramme, CE_NETWORKS, BIO_CAMPAIGN } from '../../js/domain/seed.js';
import { mergeEntity, mergeSet } from '../../js/domain/merge.js';
import { planEntity } from '../../js/domain/exchange.js';
import { evalCondition } from '../../js/domain/grids.js';
import { writePermission, canWrite, REFERENTIAL_TYPES } from '../../js/domain/permissions.js';
import { stationBanner } from '../../js/ui/sheet-chrome.js';

const loadData = async () => (await fetch(new URL('../../data/referentiel-oeg.json', import.meta.url))).json();
/** Ancienne règle de déduction des types de tournée (seed.js et station-sheet.js avant le référentiel « Réseaux »). */
const oldTypes = site => {
  const out = [];
  if ((site.bioLists || []).length) out.push('bio');
  if ((site.networks || []).some(n => ['Chimie', 'RCO', 'EL'].includes(n))) out.push('ce');
  if ((site.networks || []).includes('ESO')) out.push('eso');
  return out;
};

/* ---------- Réseaux par défaut ---------- */
test('réseaux par défaut : cinq marchés 2026, identifiants net-<code>, contenu déterministe', () => {
  deepEq(NETWORK_DEFAULTS.map(n => n.code), ['BIO', 'Chimie', 'RCO', 'EL', 'ESO']);
  deepEq(NETWORK_DEFAULTS.map(n => n.id), ['net-BIO', 'net-Chimie', 'net-RCO', 'net-EL', 'net-ESO']);
  deepEq(NETWORK_DEFAULTS.map(n => n.label), ['Biologie (RCS ESC BIO)', 'Chimie des cours d’eau', 'Réseau de contrôle opérationnel', 'Eaux littorales', 'Eaux souterraines']);
  deepEq(NETWORK_DEFAULTS.map(n => n.color), ['#2f8a3f', '#6a35b0', '#0b6cb4', '#0b7a7c', '#2f6f8f']);
  deepEq(NETWORK_DEFAULTS.map(n => n.auditTypes), [[], ['ce'], ['ce'], ['ce'], ['eso']]);
  deepEq(NETWORK_DEFAULTS.map(n => n.description.slice(0, 18)), ['Marché OEG 2026-01', 'Marché OEG 2026-03', 'Marché OEG 2026-04', 'Marché OEG 2026-02', 'Marché OEG 2026-05']);
  eq(new Set(NETWORK_DEFAULTS.map(n => n.order)).size, 5, 'ordres distincts');
  assert(NETWORK_DEFAULTS.every(n => n.active === true && n.auditTypes.every(t => AUDIT_TYPE_KEYS.includes(t))), 'actifs, types connus');
  // Aucune date ni valeur variable : deux tablettes installent la même donnée (aucun conflit à l'échange).
  assert(NETWORK_DEFAULTS.every(n => deepEqKeys(n, ['id', 'code', 'label', 'description', 'color', 'order', 'auditTypes', 'active'])), 'champs du réseau');
  deepEq(baseReferential().network, defaultNetworks(), 'référentiel initial = réseaux par défaut');
  deepEq(baseReferential().network, baseReferential().network, 'déterministe');
  const copy = defaultNetworks(); copy[0].auditTypes.push('bio'); copy[0].label = 'x';
  deepEq(NETWORK_DEFAULTS[0].auditTypes, [], 'défauts protégés des modifications');
  eq(NETWORK_DEFAULTS[0].label, 'Biologie (RCS ESC BIO)');
  eq(networkId(' RCO '), 'net-RCO'); eq(networkId('RCO BIO'), 'net-RCO_BIO');
  // CE_NETWORKS (programmes installés) reste inchangé : EL est « ce » sans programme installé.
  deepEq(CE_NETWORKS, ['Chimie', 'RCO']);
});
function deepEqKeys(o, keys) { return JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort()); }

test('index : repli sur les réseaux par défaut, référentiel enregistré prioritaire, réseau supprimé connu, réseau virtuel', () => {
  const empty = networkIndex([]);
  deepEq([...empty.keys()], ['BIO', 'Chimie', 'RCO', 'EL', 'ESO'], 'référentiel non installé : défauts');
  const stored = [{ ...defaultNetworks()[2], label: 'RCO (libellé OEG)' }, { ...defaultNetworks()[3], _deleted: true }, { id: 'net-TEST', code: 'TEST', label: 'Test', order: 5, auditTypes: ['eso'], active: false, color: '#123456' }];
  const idx = networkIndex(stored);
  eq(networkLabel('RCO', idx), 'RCO (libellé OEG)', 'libellé enregistré prioritaire');
  assert(idx.get('EL')._deleted, 'réseau supprimé : pas remplacé par le défaut');
  eq(networkOf('BIO', idx).label, 'Biologie (RCS ESC BIO)', 'défaut pour un code absent');
  const v = networkOf('Inconnu', idx);
  assert(v.virtual && v.label === 'Inconnu' && v.color === OTHER_COLOR && !v.auditTypes.length, 'réseau virtuel');
  // Liste proposée à la saisie : actifs non supprimés, triés ; les codes portés (`keep`) restent proposés.
  deepEq(listNetworks(idx).map(n => n.code), ['BIO', 'Chimie', 'RCO', 'ESO']);
  deepEq(listNetworks(idx, { keep: ['TEST', 'EL', 'XYZ'] }).map(n => n.code), ['TEST', 'BIO', 'Chimie', 'RCO', 'EL', 'ESO', 'XYZ']);
  deepEq(listNetworks(idx, { includeInactive: true }).map(n => n.code), ['TEST', 'BIO', 'Chimie', 'RCO', 'ESO']);
  // Tri : ordre d'affichage, puis libellé ; codes inconnus après.
  deepEq(sortNetworkCodes(['ESO', 'zz', 'EL', 'BIO', 'aa', 'Chimie', 'RCO', 'BIO', '']), ['BIO', 'Chimie', 'RCO', 'EL', 'ESO', 'aa', 'zz']);
  deepEq(sortNetworkCodes(['ESO', 'TEST'], idx), ['TEST', 'ESO'], 'ordre du référentiel enregistré');
});

test('normalisation : casse, accents, libellés et synonymes ; jamais de correspondance partielle', () => {
  deepEq(normalizeNetworkCodes('rco ; Chimie').codes, ['RCO', 'Chimie']);
  deepEq(normalizeNetworkCodes(['chimie', ' BIO', 'bio', 'RCO', 'Autre']).codes, ['Chimie', 'BIO', 'RCO', 'Autre']);
  deepEq(normalizeNetworkCodes(['chimie', ' BIO', 'bio', 'RCO', 'Autre']).all, ['BIO', 'Chimie', 'RCO', 'Autre'], 'triés');
  deepEq(normalizeNetworkCodes(['chimie', ' BIO', 'bio', 'RCO', 'Autre']).unknown, ['Autre']);
  eq(canonicalNetwork('Réseau de contrôle opérationnel (RCO)'), 'RCO');
  eq(canonicalNetwork('réseau de controle operationnel'), 'RCO', 'libellé sans accents');
  eq(canonicalNetwork('EAUX LITTORALES'), 'EL');
  eq(canonicalNetwork('Eaux souterraines'), 'ESO');
  eq(canonicalNetwork('BIO – Biologie (RCS ESC BIO)'), 'BIO', 'forme « CODE – Libellé »');
  eq(canonicalNetwork('Biologie (RCS ESC BIO)'), 'BIO', 'libellé exact');
  eq(canonicalNetwork('Hydrobiologie'), 'BIO', 'synonyme');
  eq(canonicalNetwork('BI'), '', 'pas de correspondance partielle');
  eq(canonicalNetwork('Chim'), '');
  eq(canonicalNetwork('RCO_BIO12'), '', 'liste des fiches terrain : pas un réseau');
  deepEq(normalizeNetworkCodes('XYZ | xyz\nRCO,  rco ').codes, ['XYZ', 'RCO'], 'doublons (casse) retirés, première écriture gardée');
  deepEq(normalizeNetworkCodes('XYZ | xyz').unknown, ['XYZ']);
  deepEq(normalizeNetworkCodes('').codes, []);
  // Libellé modifié par l'OEG : reconnu ; codes du référentiel enregistré.
  const idx = networkIndex([{ ...defaultNetworks()[3], label: 'Littoral DCE' }, { id: 'net-Côtier', code: 'Côtier', label: 'Eaux côtières', order: 45, auditTypes: ['ce'] }]);
  eq(canonicalNetwork('littoral dce', idx), 'EL'); eq(canonicalNetwork('cotier', idx), 'Côtier'); eq(canonicalNetwork('EAUX CÔTIÈRES', idx), 'Côtier');
  assert(sameNetworks(['RCO', 'EL'], ['EL', 'RCO', 'EL']) && !sameNetworks(['RCO'], ['RCO', 'EL']), 'ensembles');
});

test('réseaux à créer : jamais un réseau existant ou supprimé ; contenu déterministe', () => {
  const list = [{ ...defaultNetworks()[0] }, { ...defaultNetworks()[3], _deleted: true }];
  const todo = networksToCreate(['BIO', 'EL', 'RCO', 'TEST', 'TEST', ''], list);
  deepEq(todo.map(n => n.code), ['RCO', 'TEST'], 'BIO existe, EL supprimé : jamais recréés');
  deepEq(todo[0], defaultNetworks()[2], 'code des marchés 2026 : contenu par défaut');
  const t = todo[1];
  deepEq([t.id, t.label, t.color, t.auditTypes, t.active], ['net-TEST', 'TEST', OTHER_COLOR, [], true]);
  deepEq(networksToCreate(['TEST'], list), networksToCreate(['TEST'], list), 'deux tablettes : même contenu');
  assert(!JSON.stringify(todo).match(/\d{4}-\d{2}-\d{2}T/), 'aucune date');
  // Deux codes distincts au même identifiant : suffixe déterministe.
  deepEq(networksToCreate(['A_B'], [{ id: 'net-A_B', code: 'A B' }]).map(n => n.id), ['net-A_B-2']);
});

/* ---------- Référentiel des stations OEG ---------- */
test('108 stations : effectifs par réseau, 16 stations sur deux réseaux, types de tournée IDENTIQUES à l’ancienne règle', async () => {
  const DATA = await loadData();
  const ref = oegReferential(DATA);
  eq(ref.site.length, 108, '108 stations');
  const count = c => ref.site.filter(s => s.networks.includes(c)).length;
  deepEq(['BIO', 'Chimie', 'RCO', 'EL', 'ESO'].map(count), [38, 15, 25, 29, 17], 'effectifs BIO, Chimie, RCO, EL, ESO');
  const multi = ref.site.filter(s => s.networks.length > 1);
  eq(multi.length, 16, '16 stations sur deux réseaux');
  eq(multi.filter(s => sameNetworks(s.networks, ['BIO', 'Chimie'])).length, 15, '15 BIO + Chimie');
  deepEq(ref.site.find(s => s.code === '60007480').networks, ['RCO', 'EL'], 'Mataroni : RCO + EL');
  assert(ref.site.every(s => s.networks.length >= 1), 'toute station a un réseau');
  // Déduction des types : identique à l'ancienne règle, avec les défauts ET avec le référentiel installé.
  const installed = networkIndex(baseReferential().network);
  for (const s of ref.site) {
    deepEq(stationTypes(s), oldTypes(s), s.code + ' (défauts)');
    deepEq(auditTypesOf(s, installed), oldTypes(s), s.code + ' (référentiel installé)');
    deepEq(s.types, oldTypes(s), s.code + ' (types enregistrés)');
  }
  eq(ref.site.filter(s => s.types.includes('bio')).length, 38); eq(ref.site.filter(s => s.types.includes('eso')).length, 17);
  eq(ref.site.filter(s => s.types.includes('ce')).length, 15 + 25 + 29 - 1 - 0, 'cours d’eau : Chimie ∪ RCO ∪ EL (Mataroni une fois)');
  // Aucun code de station hors référentiel « Réseaux » par défaut.
  assert(ref.site.every(s => s.networks.every(c => !networkOf(c).virtual)), 'codes connus');
  assert(ref.campaign.every(c => !networkOf(c.network).virtual), 'campagnes : codes connus');
  // Types associés modifiables : un réseau « eso » ajoute le type à ses stations.
  const custom = networkIndex([{ id: 'net-XX', code: 'XX', label: 'XX', auditTypes: ['eso'] }]);
  deepEq(auditTypesOf({ networks: ['XX', 'BIO'], bioLists: ['BIO_CE'] }, custom), ['bio', 'eso']);
  deepEq(auditTypesOf({ networks: ['BIO'] }), [], 'BIO sans liste biologique : aucun type (règle historique)');
});

test('regroupement par réseau : une station sur deux réseaux dans chaque groupe, totaux distincts', async () => {
  const ref = oegReferential(await loadData());
  const g = groupSitesByNetwork(ref.site);
  deepEq(g.groups.map(x => x.code), ['BIO', 'Chimie', 'RCO', 'EL', 'ESO']);
  deepEq(g.groups.map(x => x.sites.length), [38, 15, 25, 29, 17]);
  eq(g.distinct, 108, 'stations distinctes'); eq(g.memberships, 124, 'appartenances');
  const ids = code => g.groups.find(x => x.code === code).sites.map(s => s.id);
  assert(ids('BIO').includes('site-09160201') && ids('Chimie').includes('site-09160201'), 'Acarouany dans BIO et Chimie');
  assert(ids('RCO').includes('site-60007480') && ids('EL').includes('site-60007480'), 'Mataroni dans RCO et EL');
  assert(!g.groups.some(x => x.code === NO_NETWORK), 'aucune station sans réseau');
  const withNone = groupSitesByNetwork([...ref.site.slice(0, 3), { id: 'site-X', networks: [] }, { id: 'site-Y', networks: ['ZZ'] }]);
  deepEq(withNone.groups.slice(-2).map(x => [x.code, x.network.label, x.sites.length]), [['ZZ', 'ZZ', 1], [NO_NETWORK, 'Sans réseau', 1]], 'inconnu puis « Sans réseau » en dernier');
  assert(inNetwork({ networks: [] }, NO_NETWORK) && !inNetwork({ networks: ['BIO'] }, NO_NETWORK) && inNetwork({ networks: ['BIO', 'Chimie'] }, 'Chimie'));
});

test('réseau d’une prestation : celui de sa campagne, sinon préfixe du programme, sinon aucun', async () => {
  const DATA = await loadData();
  const ref = oegReferential(DATA);
  const camp = id => ref.campaign.find(c => c.id === id);
  const bio = bioProgramme(DATA)[0];
  eq(prestationNetwork(bio, camp(bio.campaignId)), 'BIO');
  eq(camp(bio.campaignId).id, BIO_CAMPAIGN.id);
  const ce = ceProgramme(DATA);
  assert(ce.every(p => prestationNetwork(p, camp(p.campaignId)) === p.source.externalId.split('|')[0]), 'Chimie / RCO');
  eq(prestationNetwork(ce.find(p => p.source.externalId.startsWith('RCO|')), null), 'RCO', 'sans campagne : préfixe du programme');
  eq(prestationNetwork({ ref: 'MAN-1', source: { kind: 'manuel' } }, null), '', 'saisie manuelle');
  eq(prestationNetwork({}, { network: 'chimie' }), 'Chimie', 'code normalisé');
});

test('couleurs d’affichage : claire, filet, foncée lisible (contraste ≥ 4,5), repli gris', () => {
  for (const n of NETWORK_DEFAULTS) {
    const c = networkColors(n);
    eq(c.main, n.color);
    assert(contrastRatio(c.dark, '#ffffff') >= 4.5, `${n.code} : texte blanc sur foncé (${contrastRatio(c.dark, '#ffffff').toFixed(2)})`);
    assert(contrastRatio(c.dark, c.light) >= 4.5, `${n.code} : texte foncé sur fond clair`);
    assert(contrastRatio(c.light, '#ffffff') < 1.3, `${n.code} : fond clair`);
    assert(contrastRatio(c.onMain, c.main) >= 4.3, `${n.code} : texte lisible sur la couleur du réseau`);
  }
  eq(networkColors({ color: 'rouge' }).main, OTHER_COLOR); eq(networkColors(null).main, OTHER_COLOR); eq(networkColors('#ABC').main, '#aabbcc');
  deepEq(networkColors({ color: '#f2c94c' }), networkColors({ color: '#f2c94c' }), 'déterministe');
  assert(contrastRatio(networkColors({ color: '#f2c94c' }).dark, '#ffffff') >= 4.5, 'couleur claire : foncée assombrie');
  eq(networkColors({ color: '#f2c94c' }).onMain === '#ffffff', false, 'texte foncé sur une couleur claire');
});

/* ---------- Fusion (échange entre tablettes, synchronisation) ---------- */
test('fusion : réseaux et types d’une station fusionnés comme des ensembles (ajout + retrait, sans conflit)', () => {
  const base = { id: 'site-1', name: 'S', networks: ['BIO', 'Chimie'], types: ['bio', 'ce'], updatedAt: '2026-10-01T10:00:00Z' };
  const local = { ...base, networks: ['BIO', 'Chimie', 'RCO'], updatedAt: '2026-10-02T10:00:00Z' };
  const remote = { ...base, networks: ['BIO'], types: ['bio'], updatedAt: '2026-10-03T10:00:00Z' };
  const r = mergeEntity('site', base, local, remote);
  deepEq(r.merged.networks, ['BIO', 'RCO'], 'ajout local (RCO) + retrait distant (Chimie)');
  deepEq(r.merged.types, ['bio'], 'retrait distant');
  deepEq(r.conflicts, [], 'aucun conflit');
  // Ajouts des deux côtés.
  deepEq(mergeEntity('site', base, { ...base, networks: ['BIO', 'Chimie', 'EL'] }, { ...base, networks: ['BIO', 'Chimie', 'ESO'] }).merged.networks, ['BIO', 'Chimie', 'ESO', 'EL']);
  // Sans version commune : les ajouts l'emportent (aucun retrait déduit).
  deepEq(mergeSet(undefined, ['BIO', 'RCO'], ['BIO', 'EL']), ['BIO', 'EL', 'RCO']);
  deepEq(mergeSet(['A'], null, ['A', 'B']), ['B'], 'liste effacée d’un côté');
  // Autres champs et autres types : comportement inchangé (une liste de valeurs modifiée des deux côtés est un conflit).
  const t = mergeEntity('site', { ...base, transportModes: ['4x4'] }, { ...base, transportModes: ['4x4', 'À pied'], updatedAt: '2026-10-02T10:00:00Z' }, { ...base, transportModes: ['Avion'], updatedAt: '2026-10-03T10:00:00Z' });
  eq(t.conflicts.length, 1, 'site.transportModes : conflit'); deepEq(t.merged.transportModes, ['Avion']);
  const c = mergeEntity('campaign', { id: 'c', networks: ['A'] }, { id: 'c', networks: ['A', 'B'], updatedAt: '2' }, { id: 'c', networks: ['C'], updatedAt: '3' });
  eq(c.conflicts.length, 1, 'autre type : conflit');
  // Échange par fichier entre tablettes : versions concurrentes fusionnées sans conflit.
  const plan = planEntity('site', { ...local, _vv: { A: 2, B: 1 } }, { ...remote, _vv: { A: 1, B: 2 } }, { candidates: [{ vv: { A: 1, B: 1 }, data: base }], deviceId: 'A' });
  eq(plan.action, 'merge'); deepEq(plan.result.networks, ['BIO', 'RCO']); deepEq(plan.conflicts, []);
});

test('conditions de grille : ctx.network (chaîne, compatibilité) et ctx.networks (tableau, « fait partie de »)', () => {
  const ctx = { network: 'BIO,Chimie', networks: ['BIO', 'Chimie'] };
  const idx = new Map();
  assert(evalCondition({ ctx: 'networks', op: 'in', value: ['BIO'] }, {}, idx, ctx), 'networks in [BIO]');
  assert(evalCondition({ ctx: 'networks', op: 'in', value: 'Chimie' }, {}, idx, ctx), 'networks in Chimie');
  assert(!evalCondition({ ctx: 'networks', op: 'in', value: ['RCO', 'EL'] }, {}, idx, ctx), 'networks hors RCO / EL');
  assert(evalCondition({ ctx: 'networks', op: 'nin', value: ['ESO'] }, {}, idx, ctx), 'networks nin ESO');
  assert(evalCondition({ ctx: 'network', op: 'eq', value: 'BIO,Chimie' }, {}, idx, ctx), 'network eq (compatibilité)');
  assert(!evalCondition({ ctx: 'network', op: 'in', value: ['BIO'] }, {}, idx, ctx), 'chaîne jointe : « in » faux (d’où ctx.networks)');
});

test('droits : référentiel « Réseaux » réservé au profil référentiels', () => {
  assert(REFERENTIAL_TYPES.includes('network'));
  deepEq(writePermission('network'), ['ref.manage']);
  assert(canWrite('admin', 'network') && canWrite('rq', 'network'), 'administrateur, responsable qualité');
  assert(!canWrite('auditeur', 'network') && !canWrite('superviseur', 'network') && !canWrite('consultation', 'network'), 'autres profils');
});

test('bandeau « Station » (feuille 1) : réseaux sur une ligne à part, codes écrits, couleur foncée ; rien sans l’option', () => {
  const site = { id: 'site-09160201', name: 'Acarouany', code: '09160201', x: 188010, y: 622135 };
  const idx = networkIndex();
  const nets = sortNetworkCodes(['Chimie', 'BIO'], idx).map(c => networkOf(c, idx));
  const el = document.createElement('div');
  el.innerHTML = String(stationBanner({ site, networks: nets, stationIndex: 2, stationTotal: 2 }));
  const box = el.querySelector('.sb-text > .sb-nets');
  assert(box, 'ligne .sb-nets dans .sb-text');
  assert(!el.querySelector('.sb-k .sb-nets'), 'pas dans la ligne « Station » (.sb-k : jamais de retour à la ligne)');
  eq(box.getAttribute('role'), 'list'); eq(box.getAttribute('aria-label'), 'Réseaux de surveillance');
  deepEq([...box.querySelectorAll('.sb-net')].map(x => x.textContent), ['BIO', 'Chimie']);
  eq(box.querySelector('.sb-net').title, 'BIO – Biologie (RCS ESC BIO)');
  assert(box.querySelector('.sb-net').getAttribute('style').includes(networkColors(nets[0]).dark), 'fond foncé du réseau');
  assert(el.querySelector('.sb-k').nextElementSibling === box, 'juste sous « Station »');
  el.innerHTML = String(stationBanner({ site }));
  assert(!el.querySelector('.sb-nets'), 'bandeaux F3 / F9 : aucun réseau');
});
