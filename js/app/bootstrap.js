/* Initialisation des données : référentiels de base, grilles, documents de référence, référentiel
 * des fiches terrain OEG (stations), programme RCS ESC BIO 2026 et jeu de démonstration facultatif.
 * Toutes les opérations sont idempotentes : elles n'ajoutent que ce qui manque (identifiants déterministes)
 * et ne remplacent jamais une saisie existante. */
import { store } from '../core/store.js';
import { baseReferential, referenceDocuments, oegReferential, oegProgramme, bioProgramme, demoData, emptyStationFields, STATION_DETAILS, BIO_CAMPAIGN } from '../domain/seed.js';
import { DEFAULT_GRIDS } from '../domain/default-grids.js';

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
 * Complète les sites déjà enregistrés avec les champs de la fiche station BIO 2026 (cours d'eau, listes BIO,
 * compartiments, accès, photos…) : seuls les champs ABSENTS sont ajoutés, aucune saisie n'est remplacée.
 */
export async function enrichSites(refSites) {
  const keys = Object.keys(emptyStationFields());
  const todo = [];
  for (const ref of refSites) {
    const cur = store.get('site', ref.id);
    if (!cur) continue;
    const add = {};
    for (const k of keys) if (cur[k] === undefined && ref[k] !== undefined) add[k] = ref[k];
    // Données connues de la station (maquettes) : appliquées si le champ est encore vide.
    for (const [k, v] of Object.entries(STATION_DETAILS[ref.code] || {})) {
      const empty = cur[k] === undefined || cur[k] === '' || (k === 'photos' && !Object.keys(cur[k] || {}).length) || (k === 'access' && !cur[k]?.summary && !cur[k]?.details);
      if (empty && v !== '') add[k] = structuredClone(v);
    }
    if (Object.keys(add).length) todo.push({ ...cur, ...add });
  }
  if (todo.length) await store.bulkPut('site', todo, { reason: 'Fiche station BIO 2026 : compléments du référentiel', action: 'seed', label: `${todo.length} site(s) complété(s)` });
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

export async function seedOEG({ bio = true } = {}) {
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
 * Première configuration. Par défaut : référentiel de base + grilles (dont CT-BIO-2026), référentiel des
 * fiches terrain OEG et programme RCS ESC BIO 2026 (38 prestations HYDRECO à planifier).
 */
export async function seedAll({ oeg = true, demo = false, bio = oeg } = {}) {
  await seedBase();
  if (oeg) await seedOEG({ bio });
  else if (bio) await seedBio2026();
  if (demo) await seedDemo();
}

/**
 * Mise à niveau d'un appareil déjà initialisé (à appeler après ouverture de session) : ajoute la grille
 * CT-BIO-2026 et le programme BIO 2026 s'ils manquent. Sans effet si tout est déjà présent.
 */
export async function upgradeBio2026() {
  const missingGrid = !store.getRaw('grid', 'grid-ct-bio-2026-v1');
  const missingProg = !store.getRaw('campaign', BIO_CAMPAIGN.id);
  if (!missingGrid && !missingProg) return { upgraded: false };
  if (missingGrid) await seedBase();
  const counts = missingProg && store.count('site') ? await seedBio2026() : {};
  return { upgraded: true, ...counts };
}
