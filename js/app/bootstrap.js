/* Initialisation des données : référentiels de base, grilles (dont CT-2026), documents de référence,
 * référentiel des fiches terrain OEG (stations biologie, cours d'eau, eaux souterraines), programmes RCS ESC BIO 2026
 * et cours d'eau 2026, jeu de démonstration facultatif, et mise à niveau d'un appareil déjà initialisé.
 * Toutes les opérations sont idempotentes : elles n'ajoutent que ce qui manque (identifiants déterministes)
 * et ne remplacent jamais une saisie existante. */
import { store } from '../core/store.js';
import { baseReferential, referenceDocuments, oegReferential, oegProgramme, bioProgramme, ceProgramme, demoData, emptyStationFields, STATION_DETAILS, BIO_CAMPAIGN, CT_GRID_ID, CE_NETWORKS, orderCompartments } from '../domain/seed.js';
import { DEFAULT_GRIDS, OLD_BIO_GRID_ID } from '../domain/default-grids.js';
import { nowISO } from '../core/util.js';

let dataPromise = null;
/** Charge le référentiel des stations OEG (data/referentiel-oeg.json, repris des fiches terrain). */
export function loadOEGData() {
  if (!dataPromise) dataPromise = fetch(new URL('../../data/referentiel-oeg.json', import.meta.url).href)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(e => { dataPromise = null; throw new Error('Référentiel des stations indisponible (data/referentiel-oeg.json) : ' + e.message); });
  return dataPromise;
}

const only = (type, list) => list.filter(e => !store.getRaw(type, e.id));

export async function seedBase() {
  const ref = baseReferential();
  for (const [type, list] of Object.entries(ref)) {
    const todo = type === 'setting' ? list.filter(s => !store.getRaw('setting', s.id)) : only(type, list);
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Référentiel initial', action: 'seed', label: `${todo.length} ${type}` });
  }
  const docs = only('document', referenceDocuments());
  if (docs.length) await store.bulkPut('document', docs, { reason: 'Documents de référence', action: 'seed' });
  const grids = only('grid', DEFAULT_GRIDS);
  if (grids.length) await store.bulkPut('grid', grids, { reason: 'Grilles d’audit par défaut', action: 'seed' });
}

/**
 * Complète les sites déjà enregistrés avec les champs de la fiche station (grille CT-2026 : types de tournée,
 * type de code, compartiments, cours d'eau, listes BIO, accès, photos ; eaux souterraines : nature, usage,
 * aquifère) : seuls les champs ABSENTS ou VIDES sont complétés, aucune saisie n'est remplacée.
 */
export async function enrichSites(refSites) {
  const keys = Object.keys(emptyStationFields());
  const derived = ['types', 'compartments', 'nature', 'usage', 'aquifere'];
  const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const todo = [];
  for (const ref of refSites) {
    const cur = store.get('site', ref.id);
    if (!cur) continue;
    const add = {};
    for (const k of keys) if (cur[k] === undefined && ref[k] !== undefined) add[k] = structuredClone(ref[k]);
    // Valeurs déduites du référentiel (types de tournée, compartiments, données des points d'eau) : complétées si vides.
    for (const k of derived) if (empty(cur[k]) && !empty(ref[k])) add[k] = structuredClone(ref[k]);
    // Site initialisé avant la grille CT-2026 (sans types de tournée) : compartiments complétés (union).
    if (cur.types === undefined && !empty(cur.compartments) && !empty(ref.compartments)) add.compartments = orderCompartments([...new Set([...cur.compartments, ...ref.compartments])]);
    // Données connues de la station (maquettes) : appliquées si le champ est encore vide.
    for (const [k, v] of Object.entries(STATION_DETAILS[ref.code] || {})) {
      const isEmpty = cur[k] === undefined || cur[k] === '' || (k === 'photos' && !Object.keys(cur[k] || {}).length) || (k === 'access' && !cur[k]?.summary && !cur[k]?.details);
      if (isEmpty && v !== '') add[k] = structuredClone(v);
    }
    if (Object.keys(add).length) todo.push({ ...cur, ...add });
  }
  if (todo.length) await store.bulkPut('site', todo, { reason: 'Fiche station 2026 : compléments du référentiel', action: 'seed', label: `${todo.length} site(s) complété(s)` });
  return todo.length;
}

/**
 * Programme RCS ESC BIO 2026 : sites BIO (créés s'ils manquent), prestataire HYDRECO, campagne
 * camp-BIO-2026 et 38 prestations « à planifier ». Ne remplace jamais une prestation existante.
 */
export async function seedBio2026({ DATA = null } = {}) {
  DATA = DATA || await loadOEGData();
  const ref = oegReferential(DATA);
  const prog = bioProgramme(DATA);
  const siteIds = new Set(prog.map(p => p.siteId));
  const counts = {};
  const put = async (type, list, label) => {
    const todo = only(type, list);
    counts[type] = todo.length;
    if (todo.length) await store.bulkPut(type, todo, { reason: `Programme ${BIO_CAMPAIGN.label}`, action: 'seed', label: `${todo.length} ${label}` });
  };
  await put('provider', ref.provider.filter(p => p.id === 'prov-HYDRECO'), 'prestataire');
  await put('site', ref.site.filter(s => siteIds.has(s.id)), 'station(s) BIO');
  await put('point', ref.point.filter(p => siteIds.has(p.siteId)), 'point(s)');
  await put('campaign', ref.campaign.filter(c => c.id === BIO_CAMPAIGN.id), 'campagne');
  counts.enriched = await enrichSites(ref.site.filter(s => siteIds.has(s.id)));
  await put('prestation', prog, 'prestation(s) BIO 2026');
  return counts;
}

/**
 * Programme cours d'eau 2026 (réseaux Chimie et RCO : prestataires OEG en régie / Titulaire du marché, dates
 * indicatives = 1er jour du mois de session) : prestataires, sites, points, campagnes manquants puis prestations
 * « ce ». Ne remplace jamais une prestation existante.
 */
export async function seedCe2026({ DATA = null } = {}) {
  DATA = DATA || await loadOEGData();
  const ref = oegReferential(DATA);
  const prog = ceProgramme(DATA);
  const siteIds = new Set(prog.map(p => p.siteId));
  const providerIds = new Set(prog.map(p => p.providerId));
  const campaignIds = new Set(prog.map(p => p.campaignId));
  const counts = {};
  const put = async (type, list, label) => {
    const todo = only(type, list);
    counts[type] = todo.length;
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Programme cours d’eau 2026', action: 'seed', label: `${todo.length} ${label}` });
  };
  await put('provider', ref.provider.filter(p => providerIds.has(p.id)), 'prestataire(s)');
  await put('site', ref.site.filter(s => siteIds.has(s.id)), 'station(s) cours d’eau');
  await put('point', ref.point.filter(p => siteIds.has(p.siteId)), 'point(s)');
  await put('campaign', ref.campaign.filter(c => campaignIds.has(c.id)), 'campagne(s)');
  await put('prestation', prog, `prestation(s) cours d’eau (${CE_NETWORKS.join(', ')})`);
  return counts;
}

export async function seedOEG({ bio = true, ce = true } = {}) {
  const DATA = await loadOEGData();
  if (!DATA) throw new Error('Référentiel des fiches terrain introuvable.');
  const ref = oegReferential(DATA);
  const counts = {};
  for (const type of ['provider', 'site', 'point', 'operator', 'campaign']) {
    const todo = only(type, ref[type]);
    counts[type] = todo.length;
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Reprise du référentiel des fiches terrain OEG', action: 'seed', label: `${todo.length} ${type}` });
  }
  await enrichSites(ref.site);
  if (bio) counts.prestation = (await seedBio2026({ DATA })).prestation || 0;
  if (ce) counts.prestationCe = (await seedCe2026({ DATA })).prestation || 0;
  return counts;
}

export async function seedDemo() {
  const demo = demoData({});
  for (const type of ['document', 'provider', 'operator', 'equipment', 'prestation']) {
    const todo = only(type, demo[type]);
    if (todo.length) await store.bulkPut(type, todo, { reason: 'Données de démonstration (fictives)', action: 'seed' });
  }
}

/** Prestations du programme des fiches terrain (Chimie, EL, RCO). Ne remplace jamais une prestation existante. */
export async function importOEGProgramme({ networks = ['Chimie', 'EL', 'RCO'] } = {}) {
  const DATA = await loadOEGData();
  const list = only('prestation', oegProgramme(DATA, { networks }));
  if (list.length) await store.bulkPut('prestation', list, { reason: `Import du programme des fiches terrain (${networks.join(', ')})`, action: 'import', label: `${list.length} prestation(s)` });
  return list.length;
}

/**
 * Première configuration. Par défaut : référentiel de base + grilles (dont CT-2026), référentiel des fiches
 * terrain OEG (stations biologie, cours d'eau, 17 points d'eaux souterraines), programme RCS ESC BIO 2026
 * (38 prestations HYDRECO à planifier) et programme cours d'eau 2026 (Chimie, RCO). Pas de prestations eaux
 * souterraines : la tournée se crée en choisissant les points dans le référentiel.
 */
export async function seedAll({ oeg = true, demo = false, bio = oeg, ce = oeg } = {}) {
  await seedBase();
  if (oeg) await seedOEG({ bio, ce });
  else {
    if (bio) await seedBio2026();
    if (ce) await seedCe2026();
  }
  if (demo) await seedDemo();
}

/**
 * Mise à niveau d'un appareil déjà initialisé (à appeler après ouverture de session), IDEMPOTENTE :
 * - ajoute la grille CT-2026 (et toute grille par défaut manquante) ; archive l'ancienne grille CT-BIO-2026 ;
 * - si le référentiel des stations est installé : ajoute les prestataires, sites (dont les 17 points d'eaux
 *   souterraines), points et campagnes manquants, complète les sites (types de tournée, code BSS, compartiments,
 *   nature / usage / aquifère), installe les programmes BIO 2026 et cours d'eau 2026 manquants et rattache à la
 *   grille CT-2026 les prestations programmées qui visaient l'ancienne grille.
 * Sans effet si tout est déjà à jour. Ne lève pas d'erreur : {upgraded, error?, ...décomptes}.
 */
export async function upgradeReferentiel2026() {
  const res = { upgraded: false };
  try {
    if (!store.getRaw('grid', CT_GRID_ID) || DEFAULT_GRIDS.some(g => !store.getRaw('grid', g.id))) { await seedBase(); res.upgraded = true; res.grid = true; }
    const old = store.get('grid', OLD_BIO_GRID_ID);
    if (old && old.status === 'publiee') {
      await store.put('grid', { ...old, status: 'archivee', archivedAt: nowISO() }, { reason: 'Remplacée par la grille CT-2026 (contrôle terrain des prestations de prélèvement – 2026)' });
      res.upgraded = true; res.oldGridArchived = true;
    }
    if (!store.count('site')) return res;
    const retarget = store.filter('prestation', p => p.gridId === OLD_BIO_GRID_ID);
    // Contrôles rapides (éléments supprimés compris : un élément supprimé n'est jamais recréé).
    const raw = type => store.all(type, { withDeleted: true });
    const needs = retarget.length || !store.getRaw('campaign', BIO_CAMPAIGN.id)
      || !raw('prestation').some(p => p.source?.kind === 'programme-oeg' && CE_NETWORKS.some(n => String(p.source?.externalId || '').startsWith(n + '|')))
      || !raw('site').some(s => (s.networks || []).includes('ESO'))
      || store.all('site').some(s => s.source === 'Fiches terrain OEG' && !Array.isArray(s.types));
    if (!needs) return res;
    const DATA = await loadOEGData();
    const ref = oegReferential(DATA);
    for (const type of ['provider', 'site', 'point', 'campaign', 'operator']) {
      const todo = only(type, ref[type]);
      res[type] = todo.length;
      if (todo.length) await store.bulkPut(type, todo, { reason: 'Mise à niveau du référentiel 2026', action: 'seed', label: `${todo.length} ${type}` });
    }
    res.enriched = await enrichSites(ref.site);
    res.bio = (await seedBio2026({ DATA })).prestation || 0;
    res.ce = (await seedCe2026({ DATA })).prestation || 0;
    if (retarget.length) {
      await store.bulkPut('prestation', retarget.map(p => ({ ...p, gridId: CT_GRID_ID, auditType: p.auditType || 'bio' })), { reason: 'Rattachement à la grille CT-2026', action: 'seed', label: `${retarget.length} prestation(s)` });
      res.retargeted = retarget.length;
    }
    res.upgraded = true;
  } catch (e) {
    res.error = e.message || String(e);
  }
  return res;
}
/** Ancien nom (CT-BIO-2026), conservé pour compatibilité. */
export const upgradeBio2026 = upgradeReferentiel2026;
