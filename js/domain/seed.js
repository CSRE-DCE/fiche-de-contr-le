/* Référentiels initiaux. Fichier pur (testé sous Node).
 *
 * - baseReferential() : niveaux de criticité, types d'écarts, matrices, types de prélèvement,
 *   méthodes, unités (turbidité en NTU, unité des CCTP 2026 ; FNU et NFU conservées pour les tournées antérieures),
 *   contenants, réseaux de surveillance (js/domain/networks.js), réglages par défaut — tous administrables ensuite.
 * - oegReferential(DATA) : sites, points, prestataires/partenaires/régie, opérateurs et campagnes repris
 *   du référentiel des fiches terrain OEG (js/data.js), pour démarrer avec les stations réelles.
 * - oegProgramme(DATA, …) : prestations programmées déduites des sessions de campagne des fiches terrain
 *   (programme cours d'eau : réseaux Chimie et RCO — ceProgramme(DATA) — tournées « ce » de la grille CT-2026).
 * - bioProgramme(DATA) : programme RCS ESC BIO 2026 (une prestation HYDRECO « à planifier » par station BIO).
 * Les sites sont enrichis pour les fiches de contrôle 2026 (grille CT-2026) : types de tournée (`types` : bio, ce,
 * eso), type de code (`codeType` : SANDRE ou BSS), compartiments à contrôler, cours d'eau, hydro-écorégion, listes
 * BIO, accès, difficultés, photos ; eaux souterraines : nature, aquifère, usage. Seules les données de la station
 * ATHANASE (09271503) sont connues (maquettes) : les autres stations ont des champs vides à compléter.
 * - demoData() : jeu d'exemple FICTIF (documents « EXEMPLE », prestataire de démonstration).
 * Les identifiants sont déterministes : deux appareils initialisés séparément produisent les mêmes
 * identifiants pour les mêmes objets, ce qui évite les doublons à la synchronisation.
 */
import { utmToLatLon } from '../lib/geo.js';
import { addDays, localDate, normalize } from '../core/util.js';
import { defaultNetworks, networkIndex, auditTypesOf } from './networks.js';

export function baseReferential() {
  const criticality = [
    { id: 'crit-OBS', code: 'OBS', label: 'Observation', rank: 0, color: '#2f6f9f', defaultDelayDays: null, requiresImmediateAction: false, definition: 'Constat ne remettant pas en cause la conformité du prélèvement ; piste d’amélioration. (Définition à adapter au système qualité.)' },
    { id: 'crit-MIN', code: 'MIN', label: 'Écart mineur', rank: 1, color: '#b7791f', defaultDelayDays: 30, requiresImmediateAction: false, definition: 'Non-respect ponctuel d’une exigence sans incidence démontrée sur la représentativité ou l’intégrité de l’échantillon. (Définition à adapter.)' },
    { id: 'crit-MAJ', code: 'MAJ', label: 'Écart majeur', rank: 2, color: '#c05621', defaultDelayDays: 15, requiresImmediateAction: false, definition: 'Non-respect d’une exigence pouvant affecter la représentativité, l’intégrité ou la traçabilité de l’échantillon. (Définition à adapter.)' },
    { id: 'crit-CRIT', code: 'CRIT', label: 'Non-conformité critique', rank: 3, color: '#b3261e', defaultDelayDays: 2, requiresImmediateAction: true, definition: 'Non-respect remettant en cause la validité du prélèvement ou la sécurité ; action immédiate requise. (Définition à adapter.)' }
  ];
  const deviationType = [
    ['DOCUMENTAIRE', 'Documentaire / programmation'], ['COMPETENCE', 'Compétence / habilitation'], ['MATERIEL', 'Matériel / équipement'],
    ['METHODE', 'Méthode / mode opératoire'], ['LOCALISATION', 'Localisation / point de prélèvement'], ['TRACABILITE', 'Identification / traçabilité'],
    ['TRANSPORT', 'Conservation / transport'], ['SECURITE', 'Sécurité'], ['AUTRE', 'Autre']
  ].map(([code, label]) => ({ id: 'dtype-' + code, code, label }));
  const matrix = [
    ['ESU', 'Eau de surface continentale (cours d’eau)'], ['PLE', 'Eau de surface (plan d’eau)'], ['ESO', 'Eau souterraine'],
    ['EL', 'Eau littorale / de transition'], ['SED', 'Sédiments'], ['BIO', 'Biote / hydrobiologie'], ['REJ', 'Eau résiduaire / rejet']
  ].map(([code, label]) => ({ id: 'mat-' + code, code, label }));
  const samplingType = [
    { code: 'PC', label: 'Prélèvement d’eau — physico-chimie', matrixIds: ['mat-ESU', 'mat-PLE', 'mat-EL'] },
    { code: 'MICROPOL', label: 'Prélèvement d’eau — micropolluants', matrixIds: ['mat-ESU', 'mat-EL'] },
    { code: 'ESO', label: 'Prélèvement d’eau souterraine (forage, piézomètre, source)', matrixIds: ['mat-ESO'] },
    { code: 'SED', label: 'Prélèvement de sédiments', matrixIds: ['mat-SED'] },
    { code: 'HYDROBIO', label: 'Prélèvement hydrobiologique (invertébrés, diatomées, macrophytes)', matrixIds: ['mat-BIO'] },
    { code: 'ADNE', label: 'Prélèvement d’ADN environnemental', matrixIds: ['mat-ESU', 'mat-BIO'] },
    { code: 'INSITU', label: 'Mesures in situ uniquement', matrixIds: ['mat-ESU', 'mat-ESO', 'mat-EL'] }
  ].map(x => ({ id: 'stype-' + x.code, ...x }));
  const method = [
    { code: 'ISO5667-6', label: 'Échantillonnage des rivières et cours d’eau', reference: 'NF EN ISO 5667-6', docKey: 'ISO5667-6' },
    { code: 'ISO5667-11', label: 'Échantillonnage des eaux souterraines', reference: 'NF EN ISO 5667-11', docKey: 'ISO5667-11' },
    { code: 'ISO5667-12', label: 'Échantillonnage des sédiments', reference: 'NF EN ISO 5667-12', docKey: 'ISO5667-12' },
    { code: 'ISO5667-9', label: 'Échantillonnage des eaux marines', reference: 'NF EN ISO 5667-9', docKey: 'ISO5667-9' },
    { code: 'PROTO-INTERNE', label: 'Protocole interne / mode opératoire du marché', reference: 'Protocole du marché', docKey: '' }
  ].map(x => ({ id: 'meth-' + x.code, ...x }));
  const unit = [
    ['C', '°C', 'Température'], ['M', 'm', 'Longueur / profondeur'], ['M3S', 'm³/s', 'Débit'], ['LS', 'L/s', 'Débit'], ['NTU', 'NTU', 'Turbidité'],
    ['FNU', 'FNU', 'Turbidité'], ['NFU', 'NFU', 'Turbidité'], ['ML', 'mL', 'Volume'], ['L', 'L', 'Volume'], ['USCM', 'µS/cm', 'Conductivité'], ['MGL', 'mg/L', 'Concentration'],
    ['PCT', '%', 'Pourcentage'], ['H', 'h', 'Durée'], ['MIN', 'min', 'Durée'], ['UPH', 'unité pH', 'pH']
  ].map(([code, symbol, quantity]) => ({ id: 'unit-' + code, code, symbol, label: `${symbol} (${quantity})`, quantity }));
  const container = [
    'Flacon verre ambré 1 L', 'Flacon verre ambré 250 mL', 'Flacon PEHD 1 L', 'Flacon PEHD 500 mL', 'Flacon stérile 500 mL (microbiologie)',
    'Flacon verre (COV) 40 mL', 'Pot verre 500 mL (sédiments)', 'Tube 50 mL', 'Poche / sachet', 'Autre'
  ].map((label, i) => ({ id: 'cont-' + (i + 1), code: 'CT' + String(i + 1).padStart(2, '0'), label }));
  const setting = [{
    id: 'org', orgName: 'Office de l’Eau de Guyane', gpsThresholdM: 100, autoLockMinutes: 30, transportMaxHours: 24, dateToleranceDays: 0,
    sampleIdPattern: '{AUDIT}-E{NN}', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileAttribution: '© contributeurs OpenStreetMap', maxPreloadZoom: 14,
    reportFooter: 'Document généré par la PWA d’audit des prestations de prélèvement — enregistrement qualité.'
  }];
  // Réseaux de surveillance (codes enregistrés sur les stations et les campagnes) : contenu déterministe.
  const network = defaultNetworks();
  return { criticality, deviationType, matrix, samplingType, method, unit, container, network, setting };
}

/** Documents de référence (métadonnées) : versions à vérifier et à compléter par le responsable qualité. */
export function referenceDocuments() {
  const base = { status: 'en_vigueur', applicableFrom: '2017-12-01', applicableTo: '', providerIds: [], samplingTypeIds: [], articles: [] };
  return [
    { ...base, id: 'doc-ISO17025-2017', docKey: 'ISO17025', type: 'REFERENTIEL', name: 'Exigences générales concernant la compétence des laboratoires d’étalonnages et d’essais', reference: 'NF EN ISO/IEC 17025', version: '2017', summary: 'Exigences pertinentes pour l’échantillonnage : § 6.2 Personnel, § 6.4 Équipements, § 6.5 Traçabilité métrologique, § 7.2 Méthodes, § 7.3 Échantillonnage, § 7.4 Manutention des objets, § 7.5 Enregistrements techniques, § 7.10 Travaux non conformes, § 8.3 Maîtrise des documents, § 8.4 Maîtrise des enregistrements, § 8.7 Actions correctives.' },
    { ...base, id: 'doc-COFRAC-REF', docKey: 'COFRAC-LAB', type: 'REFERENTIEL', name: 'Documents Cofrac applicables à l’accréditation (exigences et guides techniques)', reference: 'Cofrac — à préciser', version: 'à vérifier', applicableFrom: '', summary: 'Référencer ici les documents Cofrac en vigueur applicables à l’activité de prélèvement (référence exacte et version à vérifier sur le site du Cofrac).' },
    ...[['ISO5667-1', 'Qualité de l’eau — Échantillonnage — Conception des programmes et des techniques d’échantillonnage'], ['ISO5667-3', 'Qualité de l’eau — Échantillonnage — Conservation et manipulation des échantillons d’eau'], ['ISO5667-6', 'Qualité de l’eau — Échantillonnage — Rivières et cours d’eau'], ['ISO5667-9', 'Qualité de l’eau — Échantillonnage — Eaux marines'], ['ISO5667-11', 'Qualité de l’eau — Échantillonnage — Eaux souterraines'], ['ISO5667-12', 'Qualité de l’eau — Échantillonnage — Sédiments'], ['ISO5667-14', 'Qualité de l’eau — Échantillonnage — Assurance et contrôle qualité de l’échantillonnage']]
      .map(([key, name]) => ({ ...base, id: 'doc-' + key, docKey: key, type: 'NORME', name, reference: 'NF EN ' + key.replace('ISO', 'ISO '), version: 'à vérifier', applicableFrom: '', summary: 'Version applicable à vérifier et à compléter.' }))
  ];
}

const PROVIDERS = [
  { id: 'prov-OEG', code: 'OEG', name: 'Office de l’Eau de Guyane', kind: 'regie', aliases: ['OEG', 'Office de l\'Eau de Guyane', 'Office de l’Eau de Guyane'] },
  { id: 'prov-HYDRECO', code: 'HYDRECO', name: 'HYDRECO', kind: 'prestataire', aliases: ['HYDRECO'] },
  { id: 'prov-NBC', code: 'NBC', name: 'NBC', kind: 'prestataire', aliases: ['NBC'] },
  { id: 'prov-DGTM', code: 'DGTM', name: 'DGTM', kind: 'partenaire', aliases: ['DGTM'] },
  { id: 'prov-TL1', code: 'TL1', name: 'Titulaire du marché — lot 1', kind: 'prestataire', aliases: ['Titulaire L1', 'Titulaire du marché'] }
];
const OPERATORS = { OEG: ['PF', 'AA', 'SM', 'ML', 'MG', 'MB'], HYDRECO: ['DB', 'NB', 'EV', 'ER', 'YK', 'FC', 'HL', 'NG', 'GQ', 'FCh'], NBC: ['ML', 'FD', 'FR', 'JN', 'RC'], DGTM: ['OPC', 'MM'] };

export function providerIdFromLabel(label) {
  const p = PROVIDERS.find(x => x.aliases.some(a => a.toLowerCase() === String(label || '').trim().toLowerCase()));
  return p ? p.id : null;
}

const MONTHS = { jan: 1, janv: 1, janvier: 1, fev: 2, fevr: 2, fevrier: 2, mar: 3, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7, aou: 8, aout: 8, sep: 9, sept: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, dec: 12, decembre: 12 };
/** Déduit le mois d'un libellé de session (« S2 - Déc.26 », « Octobre 2026 »…) → {year, month} ou null. */
export function parseSessionMonth(label) {
  const s = String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = s.match(/([a-z]+)\.?\s*'?(\d{2,4})/g);
  for (const tok of m || []) {
    const mm = tok.match(/([a-z]+)\.?\s*'?(\d{2,4})/);
    const month = MONTHS[mm[1]];
    if (month) { let year = Number(mm[2]); if (year < 100) year += 2000; return { year, month }; }
  }
  return null;
}
function monthRange(label) {
  const p = parseSessionMonth(label); if (!p) return { start: '', end: '' };
  const start = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
  const end = localDate(new Date(p.year, p.month, 0));
  return { start, end };
}

/* ---------- Programme biologique RCS ESC BIO 2026 ---------- */
/** Listes des fiches terrain biologiques déterminant les compartiments à contrôler. */
export const BIO_LISTS = ['BIO_CE', 'BIO_FISH', 'BIO_PHYTO'];
export const BIO_CAMPAIGN = { id: 'camp-BIO-2026', code: 'BIO-2026', label: 'RCS ESC BIO 2026', network: 'BIO', start: '2026-09-01', end: '2026-12-15' };
/** Grille des tournées de contrôle terrain 2026 (CT-2026) ; BIO_GRID_ID : ancien nom, conservé pour compatibilité. */
export const CT_GRID_ID = 'grid-ct-2026-v1';
export const BIO_GRID_ID = CT_GRID_ID;
/** Réseaux du programme cours d'eau installé avec le référentiel (prestations « ce ») : liste de PROGRAMMES, distincte
 * des types de tournée associés aux réseaux (EL est aussi « ce », sans programme installé). */
export const CE_NETWORKS = ['Chimie', 'RCO'];
/** Ordre des compartiments de la grille CT-2026. */
export const COMPARTMENT_ORDER = ['organisation', 'physico', 'eso', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'];
export const orderCompartments = list => COMPARTMENT_ORDER.filter(k => list.includes(k));

/** Usage d'un point d'eau souterraine déduit de sa nature (type de point des fiches terrain). */
export function esoUsage(typePoint) {
  return /AEP|Unité de traitement|exploitation/i.test(String(typePoint || '')) ? 'Alimentation en eau potable' : 'Surveillance (piézomètre)';
}
const DEFAULT_NETWORK_INDEX = networkIndex();
/**
 * Types de tournée d'une station (une station peut en avoir plusieurs) : bio (listes BIO_CE / BIO_FISH / BIO_PHYTO),
 * puis les types associés à ses réseaux dans le référentiel « Réseaux » (`idx` : index courant ; par défaut les
 * réseaux de 2026 : Chimie, RCO, EL ⇒ ce ; ESO ⇒ eso).
 */
export function stationTypes(site, idx = DEFAULT_NETWORK_INDEX) {
  return auditTypesOf(site, idx);
}
/** Compartiments à contrôler d'une station selon ses types (biologie : listes BIO ; ce : physico ; eso : eso). */
export function stationCompartments(site) {
  const types = site.types || stationTypes(site);
  const list = [...bioCompartments(site.bioLists || [])];
  if (types.includes('ce')) list.push('organisation', 'physico');
  if (types.includes('eso')) list.push('organisation', 'eso');
  return orderCompartments([...new Set(list)]);
}

/** Compartiments à contrôler déduits des listes BIO : 'organisation' toujours ; BIO_CE ⇒ physico + invertébrés + diatomées ; BIO_FISH ⇒ poissons ; BIO_PHYTO ⇒ phytoplancton. */
export function bioCompartments(lists = []) {
  if (!lists.length) return [];
  const out = ['organisation'];
  if (lists.includes('BIO_CE')) out.push('physico', 'invertebres', 'diatomees');
  if (lists.includes('BIO_FISH')) out.push('poissons');
  if (lists.includes('BIO_PHYTO')) out.push('phytoplancton');
  return out;
}

/** Champs « station » ajoutés aux sites (fiche station, grille CT-2026), vides par défaut. */
export function emptyStationFields() {
  return {
    riverName: '', strahler: '', her: '', typo: '', bioLists: [], compartments: [], types: [], codeType: 'SANDRE',
    nature: '', usage: '', aquifere: '',
    access: { summary: '', details: '', modes: [] }, difficulties: '', photos: {}, photoSource: '', samplingPoints: []
  };
}
const stationPhoto = (code, slot, caption) => ({ caption, src: `img/stations/${code}/${slot}.jpg`, mediaId: null });
/** Données connues des stations (maquettes des fiches) : seule ATHANASE est documentée. */
export const STATION_DETAILS = {
  '09271503': {
    riverName: 'Approuague', commune: '', strahler: '',
    access: {
      summary: 'Environ 2 h depuis Cayenne et 1 h 30 depuis Régina.',
      details: 'Depuis le dégrad public de Régina, remonter l’Approuague pendant environ 1 h 30. La station se situe en aval direct du Saut Mapaou.',
      modes: ['Bateau motorisé / pirogue']
    },
    difficulties: 'Roches, Saut Tourépé.',
    photos: {
      RD: stationPhoto('09271503', 'RD', 'Vue d’ensemble'), RG: stationPhoto('09271503', 'RG', 'Berge rocheuse'),
      AM: stationPhoto('09271503', 'AM', 'Amont'), AV: stationPhoto('09271503', 'AV', 'Aval')
    },
    photoSource: 'Localisation cartographique et photos issues du rapport HYDRECO CRT BIO 2024.'
  }
};

/** Référentiel repris des fiches terrain OEG. */
/** Nombre de lettres accentuées d'un texte (choix de la bonne orthographe entre deux listes). */
const accents = t => (String(t || '').normalize('NFD').match(/[\u0300-\u036f]/g) || []).length;
export function oegReferential(DATA) {
  const sites = new Map();
  const add = (s, network, extra = {}) => {
    const code = String(s.code || s.code_bss || s.nom);
    if (!sites.has(code)) {
      let lat = null, lon = null;
      if (isFinite(s.x) && isFinite(s.y)) [lat, lon] = utmToLatLon(Number(s.x), Number(s.y), 22);
      sites.set(code, {
        id: 'site-' + code, code, name: s.nom, networks: [], kind: extra.kind || 'Cours d’eau', commune: s.commune || '', bassin: s.bv || s.bassin || '',
        masseEau: s.code_me || '', statut: s.statut || '', pressions: s.pressions || s.pression || '', x: s.x, y: s.y, projection: 'RGFG95 / UTM 22N',
        lat: lat !== null ? Math.round(lat * 1e6) / 1e6 : null, lon: lon !== null ? Math.round(lon * 1e6) / 1e6 : null,
        transportModes: s.transportModes || [], typePoint: s.type_point || s.typo || s.type || '', matrixId: extra.matrixId || 'mat-ESU', source: 'Fiches terrain OEG',
        ...emptyStationFields()
      });
    }
    const site = sites.get(code);
    // Même pression écrite dans deux listes au seul accent près (« Orpaillage illegal » / « illégal ») : une seule
    // valeur, la variante accentuée (sinon la première liste gagne, comme pour les autres attributs).
    const pr = s.pressions || s.pression || '';
    if (pr && site.pressions && pr !== site.pressions && normalize(pr) === normalize(site.pressions) && accents(pr) > accents(site.pressions)) site.pressions = pr;
    if (!site.networks.includes(network)) site.networks.push(network);
    if (site.her === '' && s.her !== undefined && s.her !== null) site.her = s.her;
    if (!site.typo && s.typo) site.typo = s.typo;
    if (extra.bioList && !site.bioLists.includes(extra.bioList)) site.bioLists.push(extra.bioList);
    if (network === 'ESO') Object.assign(site, { codeType: 'BSS', nature: s.type_point || '', aquifere: s.aquifere || '', usage: esoUsage(s.type_point), matrixId: 'mat-ESO' });
  };
  for (const k of ['RCO13', 'RCO25', 'RCO_BIO12']) (DATA[k] || []).forEach(s => add(s, 'RCO'));
  for (const k of ['BIO_CE', 'BIO_FISH', 'BIO_PHYTO', 'BIO_ADNE']) (DATA[k] || []).forEach(s => add(s, 'BIO', { bioList: BIO_LISTS.includes(k) ? k : null }));
  (DATA.CH_STATIONS || []).forEach(s => add(s, 'Chimie'));
  (DATA.ESO || []).forEach(s => add(s, 'ESO', { kind: 'Eau souterraine', matrixId: 'mat-ESO' }));
  (DATA.EL_STATIONS || []).forEach(s => add(s, 'EL', { kind: s.type === 'MEC' ? 'Eau côtière' : 'Eau de transition', matrixId: 'mat-EL' }));
  for (const st of sites.values()) {
    st.bioLists = BIO_LISTS.filter(k => st.bioLists.includes(k));
    st.types = stationTypes(st);
    st.compartments = stationCompartments(st);
    if (STATION_DETAILS[st.code]) Object.assign(st, structuredClone(STATION_DETAILS[st.code]));
  }
  const site = [...sites.values()];
  const point = site.map(s => ({ id: 'pt-' + s.code, siteId: s.id, code: s.code, name: `Point de prélèvement ${s.name}`, lat: s.lat, lon: s.lon, description: s.typePoint || '', gpsThreshold: null }));
  const provider = PROVIDERS.map(({ aliases, ...p }) => ({ ...p, contacts: [], contracts: [], address: '', phone: '', email: '', accreditation: {}, active: true, notes: 'Repris du référentiel des fiches terrain.' }));
  const operator = [];
  for (const [org, list] of Object.entries(OPERATORS)) for (const ini of list) operator.push({ id: `op-${org}-${ini}`, providerId: 'prov-' + org, code: ini, lastName: ini, firstName: '', function: 'Préleveur', qualifications: [], active: true, notes: 'Initiales reprises des fiches terrain — compléter l’identité et les habilitations.' });
  const campaign = [];
  const camp = (network, label) => { const id = `camp-${network}-${label}`.replace(/[^\w-]+/g, '_'); if (!campaign.some(c => c.id === id)) campaign.push({ id, code: label.split(' ')[0], label: `${network} — ${label}`, network, ...monthRange(label) }); return id; };
  ['S1 - Octobre 2026', 'S2 - Décembre 2026', 'S3 - Février 2027', 'S4 - Avril 2027'].forEach(l => camp('RCO', l));
  ['S1 - Sept.26', 'S2 - Déc.26', 'S3 - Fév.27', 'S4 - Juin.27'].forEach(l => camp('Chimie', l));
  (DATA.EL_SESSIONS || []).forEach(s => camp('EL', s.label));
  ['Juillet 2026', 'Novembre 2026'].forEach(l => camp('ESO', l));
  campaign.push({ ...BIO_CAMPAIGN });
  return { site, point, provider, operator, campaign };
}

/**
 * Programme RCS ESC BIO 2026 : une prestation HYDRECO par station BIO (listes BIO_CE / BIO_FISH / BIO_PHYTO),
 * date « à planifier » (plannedDate vide, date indicative), contrôle terrain complet, grille CT-BIO-2026.
 */
export function bioProgramme(DATA) {
  const seen = new Set(), out = [];
  for (const k of BIO_LISTS) for (const s of DATA[k] || []) {
    const code = String(s.code);
    if (seen.has(code)) continue;
    seen.add(code);
    const lists = BIO_LISTS.filter(l => (DATA[l] || []).some(x => String(x.code) === code));
    const compartments = bioCompartments(lists);
    out.push({
      id: 'pres-BIO-2026-' + code, ref: 'BIO-2026-' + code, marketRef: '', campaignId: BIO_CAMPAIGN.id,
      siteId: 'site-' + code, pointIds: ['pt-' + code], plannedDate: '', plannedTime: '', dateIndicative: true, frequency: 'Par campagne',
      samplingTypeId: 'stype-HYDROBIO', matrixId: 'mat-ESU', providerId: 'prov-HYDRECO', partnerId: null,
      operatorIds: [], team: '', protocolDocKey: '', cctpDocKey: '', methodId: '', controlLevel: 'complet', status: 'prevue', statusHistory: [],
      gridId: CT_GRID_ID, auditType: 'bio', compartments,
      source: { kind: 'programme-bio-2026', externalId: 'BIO-2026|' + code, label: 'Programme RCS ESC BIO 2026 (HYDRECO)' },
      notes: `Campagne ${BIO_CAMPAIGN.label} (${BIO_CAMPAIGN.start.split('-').reverse().join('/')} → ${BIO_CAMPAIGN.end.split('-').reverse().join('/')}) — date à planifier. Listes : ${lists.join(', ')}.`
    });
  }
  return out;
}

/**
 * Prestations programmées déduites des fiches terrain (réseaux Chimie, EL et RCO) : une prestation par
 * station et par session, attribuée à l'organisme indiqué. Date indicative = 1er jour du mois de session.
 * Tournées « cours d'eau » de la grille CT-2026 (auditType 'ce', compartiments organisation + physico).
 */
export function oegProgramme(DATA, { networks = ['Chimie', 'EL', 'RCO'] } = {}) {
  const out = [];
  const mk = (network, s, sessionLabel, providerLabel, stype) => {
    const code = String(s.code || s.code_bss);
    const r = monthRange(sessionLabel);
    const campaignId = `camp-${network}-${sessionLabel}`.replace(/[^\w-]+/g, '_');
    const externalId = `${network}|${code}|${sessionLabel}`;
    out.push({
      id: 'pres-' + externalId.replace(/[^\w-]+/g, '_'), ref: `${network}-${code}-${sessionLabel.split(' ')[0]}`, marketRef: '', campaignId,
      siteId: 'site-' + code, pointIds: ['pt-' + code], plannedDate: r.start || '', plannedTime: '', dateIndicative: true, frequency: 'Par campagne',
      samplingTypeId: stype, matrixId: network === 'EL' ? 'mat-EL' : 'mat-ESU', providerId: providerIdFromLabel(providerLabel), partnerId: null,
      operatorIds: [], team: '', protocolDocKey: '', cctpDocKey: '', methodId: '', controlLevel: 'complet', status: 'prevue', statusHistory: [],
      gridId: CT_GRID_ID, auditType: 'ce', compartments: ['organisation', 'physico'],
      source: { kind: 'programme-oeg', externalId, label: 'Programme des fiches terrain OEG' }, notes: `Session ${sessionLabel} — date indicative (mois de campagne).`
    });
  };
  if (networks.includes('Chimie')) for (const s of DATA.CH_STATIONS || []) for (const [sess, org] of Object.entries(s.sessions || {})) mk('Chimie', s, sess, org, 'stype-PC');
  if (networks.includes('EL')) for (const s of DATA.EL_STATIONS || []) for (const sess of DATA.EL_SESSIONS || []) mk('EL', s, sess.label, s.operateur, 'stype-PC');
  if (networks.includes('RCO')) for (const s of DATA.RCO13 || []) for (const sess of ['S1 - Octobre 2026', 'S2 - Décembre 2026', 'S3 - Février 2027', 'S4 - Avril 2027']) mk('RCO', s, sess, s.operateur, 'stype-PC');
  return out.filter(p => p.providerId);
}
/** Programme cours d'eau 2026 installé avec le référentiel : réseaux Chimie et RCO (prestataires OEG / Titulaire du marché). */
export function ceProgramme(DATA) { return oegProgramme(DATA, { networks: CE_NETWORKS }); }

/** Jeu de démonstration FICTIF, clairement identifié, pour prendre en main l'application. */
export function demoData({ today = localDate(), siteIds = [] } = {}) {
  const sites = siteIds.length ? siteIds : ['site-09160201', 'site-09141515', 'site-60007471'];
  const document = [
    {
      id: 'doc-CCTP-EX-v1', docKey: 'CCTP-SURV-EAUX', type: 'CCTP', name: 'EXEMPLE — CCTP marché de surveillance de la qualité des eaux', reference: 'CCTP-SURV-EAUX', version: '1',
      applicableFrom: '2026-01-01', applicableTo: '', status: 'en_vigueur', providerIds: [], samplingTypeIds: [], summary: 'Document d’exemple à remplacer par le CCTP réel du marché.',
      articles: [
        { id: 'a21', number: '2.3', title: 'Programme de prélèvement', text: 'Le titulaire réalise les prélèvements selon le calendrier transmis par le maître d’ouvrage. Toute modification est signalée avant intervention.' },
        { id: 'a24', number: '2.4', title: 'Localisation des points', text: 'Les prélèvements sont réalisés aux coordonnées des points fixées au programme ; tout écart supérieur à 100 m est justifié.' },
        { id: 'a31', number: '3.1', title: 'Titulaire et sous-traitance', text: 'Seuls le titulaire et les sous-traitants déclarés peuvent intervenir.' },
        { id: 'a42', number: '4.2', title: 'Qualification du personnel', text: 'Le personnel préleveur est formé et habilité ; les justificatifs sont présentés sur demande lors des contrôles.' },
        { id: 'a51', number: '5.1', title: 'Matériel', text: 'Le matériel est propre, adapté et vérifié ; les équipements de mesure sont étalonnés et en cours de validité.' },
        { id: 'a63', number: '6.3', title: 'Conservation et transport', text: 'Les échantillons sont conservés à l’obscurité à 5 ± 3 °C jusqu’à leur remise au laboratoire.' },
        { id: 'a64', number: '6.4', title: 'Délai de remise', text: 'Le délai entre le prélèvement et la remise au laboratoire n’excède pas 24 heures.' }
      ]
    },
    {
      id: 'doc-PROTO-EX-v1', docKey: 'PROTO-PREL-ESU', type: 'PROTOCOLE', name: 'EXEMPLE — Protocole de prélèvement d’eau de surface', reference: 'PROTO-PREL-ESU', version: '1',
      applicableFrom: '2025-01-01', applicableTo: '2026-06-30', status: 'remplace', providerIds: [], samplingTypeIds: ['stype-PC'], summary: 'Ancienne version (exemple de gestion des versions).',
      articles: [{ id: 'p1', number: '1', title: 'Domaine d’application', text: 'Prélèvements d’eau de surface pour analyses physico-chimiques.' }]
    },
    {
      id: 'doc-PROTO-EX-v2', docKey: 'PROTO-PREL-ESU', type: 'PROTOCOLE', name: 'EXEMPLE — Protocole de prélèvement d’eau de surface', reference: 'PROTO-PREL-ESU', version: '2',
      applicableFrom: '2026-07-01', applicableTo: '', status: 'en_vigueur', providerIds: [], samplingTypeIds: ['stype-PC'], summary: 'Document d’exemple à remplacer par le protocole réel.',
      articles: [
        { id: 'p1', number: '1', title: 'Domaine d’application', text: 'Prélèvements d’eau de surface pour analyses physico-chimiques.' },
        { id: 'p3', number: '3', title: 'Conditions préalables', text: 'Vérifier le matériel, les flacons fournis par le laboratoire, les étiquettes et la glacière avant le départ.' },
        { id: 'p41', number: '4.1', title: 'Ordre de remplissage des flacons', text: 'Remplir d’abord les flacons destinés aux paramètres sensibles (COV, microbiologie) puis les autres.' },
        { id: 'p42', number: '4.2', title: 'Volumes', text: 'Respecter les volumes indiqués par le laboratoire ; ne pas rincer les flacons contenant un conservateur.' }
      ]
    },
    { id: 'doc-CONSIGNES-EX-v1', docKey: 'CONSIGNES-SECU', type: 'CONSIGNES', name: 'EXEMPLE — Consignes particulières (sécurité, accès)', reference: 'CONS-01', version: '1', applicableFrom: '2026-01-01', applicableTo: '', status: 'en_vigueur', providerIds: [], samplingTypeIds: [], summary: 'Port du gilet de sauvetage en embarcation ; travail isolé interdit ; prévenir avant l’accès aux sites privés.', articles: [] }
  ];
  const provider = [{
    id: 'prov-DEMO', code: 'DEMO', name: 'DÉMO — Prélèvements Exemple SARL (fictif)', kind: 'prestataire', address: 'Adresse fictive', phone: '', email: '', active: true,
    contacts: [{ id: 'c1', name: 'Responsable technique (fictif)', role: 'Responsable technique', phone: '', email: '' }],
    contracts: [{ id: 'k1', ref: 'MARCHE-DEMO-2026', label: 'Marché de démonstration — surveillance des eaux', start: '2026-01-01', end: '2027-12-31', lots: 'Lot 1' }],
    accreditation: { number: 'DÉMO-0000', body: 'Cofrac', scope: 'Fictif — démonstration', validUntil: '2027-06-30' }, notes: 'Prestataire fictif de démonstration.'
  }];
  const operator = [
    { id: 'op-DEMO-1', providerId: 'prov-DEMO', code: 'JD', lastName: 'Exemple', firstName: 'Jeanne', function: 'Technicienne préleveuse', active: true, experienceYears: 6,
      qualifications: [{ id: 'q1', type: 'habilitation', label: 'Prélèvement eaux de surface', ref: 'HAB-DEMO-12', obtainedAt: '2024-03-01', validUntil: '2027-03-01', samplingTypeIds: [] }, { id: 'q2', type: 'formation', label: 'Formation ISO 5667-3 (conservation)', ref: 'FORM-DEMO', obtainedAt: '2025-02-10', validUntil: '' }] },
    { id: 'op-DEMO-2', providerId: 'prov-DEMO', code: 'PM', lastName: 'Modèle', firstName: 'Paul', function: 'Technicien préleveur', active: true, experienceYears: 1,
      qualifications: [{ id: 'q3', type: 'habilitation', label: 'Prélèvement eaux de surface', ref: 'HAB-DEMO-15', obtainedAt: '2023-01-01', validUntil: '2026-01-01', samplingTypeIds: [] }] }
  ];
  const equipment = [
    { id: 'eq-DEMO-1', providerId: 'prov-DEMO', inventoryNo: 'DEMO-MP-01', category: 'mesure', label: 'Sonde multiparamètre', brand: 'Marque A', model: 'Modèle X', serial: 'SN-0001', lastCheckDate: addDays(today, -1), calibrationDate: addDays(today, -60), calibrationRequired: true, validUntil: addDays(today, 300), certificateRef: 'CERT-DEMO-01', status: 'service' },
    { id: 'eq-DEMO-2', providerId: 'prov-DEMO', inventoryNo: 'DEMO-TH-02', category: 'mesure', label: 'Thermomètre de contrôle', brand: 'Marque B', model: 'T-100', serial: 'SN-0002', lastCheckDate: addDays(today, -400), calibrationDate: addDays(today, -400), calibrationRequired: true, validUntil: addDays(today, -35), certificateRef: 'CERT-DEMO-02', status: 'service' },
    { id: 'eq-DEMO-3', providerId: 'prov-DEMO', inventoryNo: 'DEMO-PR-03', category: 'prelevement', label: 'Perche de prélèvement', brand: '', model: 'Télescopique 3 m', serial: '', lastCheckDate: addDays(today, -10), calibrationDate: '', calibrationRequired: false, validUntil: '', certificateRef: '', status: 'service' }
  ];
  const prestation = sites.slice(0, 3).map((siteId, i) => ({
    id: 'pres-DEMO-' + (i + 1), ref: `DEMO-2026-${String(i + 1).padStart(3, '0')}`, marketRef: 'MARCHE-DEMO-2026', campaignId: 'camp-Chimie-S1_-_Sept_26',
    siteId, pointIds: [siteId.replace('site-', 'pt-')], plannedDate: addDays(today, i), plannedTime: ['08:30', '10:00', '14:00'][i], dateIndicative: false, frequency: 'Mensuelle',
    samplingTypeId: 'stype-PC', matrixId: 'mat-ESU', providerId: 'prov-DEMO', partnerId: null, operatorIds: ['op-DEMO-1', 'op-DEMO-2'], team: 'Équipe démo',
    protocolDocKey: 'PROTO-PREL-ESU', cctpDocKey: 'CCTP-SURV-EAUX', methodId: 'meth-ISO5667-6', controlLevel: 'complet', status: 'prevue', statusHistory: [],
    source: { kind: 'demo', label: 'Données de démonstration' }, notes: 'Prestation fictive de démonstration.'
  }));
  return { document, provider, operator, equipment, prestation };
}
