/* Grille unique « en feuilles » du contrôle terrain des prestations de prélèvement – 2026 (CT-2026).
 * Remplace CT-BIO-2026 : mêmes feuilles 1 à 9 (transcription des maquettes docs/maquettes/feuille-*.webp) complétées
 * par les points des fiches d'évaluation « cours d'eau » et « eaux souterraines » (avenant n° 1, § B à E), chaque
 * point n'existant qu'UNE fois : critère dédié, ou mention « Inclut : … » dans l'aide (`help`) d'un critère existant.
 * Fichier pur (données uniquement).
 *
 * - `types` : type de tournée choisi à la création (audit.auditType) : bio, ce, eso. Les conditions d'affichage
 *   utilisent `ctx.auditType`, `ctx.compartments` et `ctx.matrixCode`.
 * - `sheets[]` : ordre d'affichage = ordre du tableau (F1, F2, F3, F10, F4…F9) ; `no` = identifiant stable ;
 *   `scope` : 'tournee' (renseignée une fois : F2) ou 'station' (répétée pour chaque station de la tournée) ;
 *   `compartment` (+ `compartments` : l'un d'eux suffit) ; `variants[type]` : titre, onglet, surtitre… propres à un
 *   type de tournée ; `blocks[].showFor` : types de tournée affichant l'encadré (défaut : tous).
 * - `item.scope: 'tournee'` dans une feuille station : critère affiché dans chaque fiche station (badge « Commun à la
 *   tournée ») avec UNE seule réponse partagée (voir expandGrid, grids.js).
 * - Critère de conformité : échelle C / P / NC / N/A, observation obligatoire pour P et NC ; champ « Valeur /
 *   réponse » facultatif (`input`) ; critère « valeur seule » : kinds text, date, time, select, number, longtext, fields.
 * - `short` = « Référence courte » des maquettes (≠ `refs`, références documentaires).
 * - `prefill` : valeur pré-remplie une seule fois (création de l'audit ou ajout de la station) — voir prefillResponses.
 * - `labelTemplate` : libellé complété avec le prestataire de la tournée ({prestataire}) dans la grille effective.
 * - `suggest` : valeur calculée proposée à l'auditeur (ex. amplitude horaire), jamais appliquée seule.
 * Les numéros en double des maquettes (F3 « 16 », F4 « 16 », F9 « 12 ») sont corrigés en 17 / 17 / 13.
 *
 * TRAÇABILITÉ DES FICHES D'ÉVALUATION (fiches Agences de l'eau / Aquascop 2026, non reproduites dans le dépôt).
 * Une ligne par point de la fiche source → critère(s) CT-2026 qui le couvre(nt). « (Inclut) » : point fusionné dans
 * l'aide d'un critère existant ; sinon critère dédié ou donnée de l'audit. Format lu par tests/unit/grid-ct-2026.test.js.
 *
 * Fiche « Cours d'eau » — page 1, en-tête et logistique / organisation générales / équipement (tournée)
 * [CE] Organisme → audit.providerId ; it-F2-2.1
 * [CE] Date → it-F2-1.4
 * [CE] Préleveur → it-F2-2.1 (Inclut) ; audit.operatorIds ; it-F1-R4
 * [CE] Auditeur → it-F2-1.1
 * [CE] Assistant → it-F2-2.1 (Inclut)
 * [CE] Type d'audit : inopiné / avec RV → it-F2-1.11
 * [CE] Lot prélèvement → it-F2-1.12
 * [CE] Codes stations de la tournée → audit.stations (sélecteur de stations, sans critère)
 * [CE] Support(s) audité(s) → it-F2-1.13
 * [CE] Planification de l'audit, respect RV / horaire si inopiné → it-F2-5.5
 * [CE] Programme journalier (nombre de stations) → it-F2-5.6
 * [CE] Amplitude horaire → it-F2-5.7
 * [CE] Logique d'enchaînement de la tournée (ordre des stations) → it-F2-5.8
 * [CE] Documents contractuels à disposition (CCTP, lettre de mission) → it-F2-6.1
 * [CE] Référentiels techniques à disposition → it-F2-6.2
 * [CE] Documents techniques sur le matériel à disposition → it-F2-6.3
 * [CE] Support d'informations sur stations et sites → it-F2-6.4
 * [CE] Flaconnage : organisme fournisseur → it-F4-22
 * [CE] Propreté des flacons → it-F4-23
 * [CE] Étiquetage des flacons / descriptif disponible → it-F4-24
 * [CE] Traçabilité / laboratoire (scan, fiche…) → it-F4-25
 * [CE] Aménagement du véhicule (étagère, rangement…) → it-F2-3.5
 * [CE] Sondes utilisées (type, état, propreté) → it-F4-18
 * [CE] Procédures de calibration et d'étalonnage des sondes → it-F4-2 (Inclut)
 * [CE] Traçabilité des procédures / sondes → it-F4-19
 * [CE] Disponibilité de consommables pour l'étalonnage (solutions / piles) → it-F4-20
 * [CE] Sondes de secours disponibles → it-F4-21
 * [CE] Matériel de prélèvement disponible → it-F5-29 (Inclut)
 * [CE] Diversité, adéquation et propreté du matériel de prélèvement (seau inox / plastique, chaîne + corde, canne) → it-F5-29 (Inclut)
 * [CE] État et propreté du matériel de prélèvement → it-F5-30
 * [CE] Mode de conservation / réfrigération des échantillons → it-F5-14 (Inclut)
 * [CE] État et qualité des glacières → it-F5-11 (Inclut)
 * [CE] Conditionnement des échantillons en glacières (calage…) → it-F5-23
 * [CE] Suivi thermique (enceinte, frigo, échantillons…) → it-F5-15 (Inclut)
 * [CE] Sécurité routière / équipements (triangle, chasuble, cônes…) → it-F2-4.6
 * [CE] Port du gilet de sauvetage selon contexte → it-F2-4.4 (Inclut)
 * [CE] Support de notation des données terrain → it-F2-7.1
 * [CE] Support papier disponible → it-F2-7.2
 * [CE] Dépôt / expédition des échantillons le jour même → it-F2-7.3
 * [CE] Nombre de points conformes / satisfaisants → synthèse : décompte C (sheetSummary, stationSummary)
 * [CE] Nombre de points perfectibles → synthèse : décompte P
 * [CE] Nombre de points non conformes → synthèse : décompte NC
 * [CE] Commentaire et bilan auditeur → audit.conclusions.comment
 * [CE] Tableau d'étalonnage (pH-mètre, conductimètre, oxymètre, turbidimètre : hebdomadaire, vérification matin / soir) → module « instruments » de F4 (audit.sheets['4'].instruments) ; it-F4-2
 * Fiche « Cours d'eau » — page 2, une colonne par station (répétée pour chaque station de la tournée)
 * [CE] Organisme, préleveur, date, auditeur (rappel) → données de l'audit (en-tête de la tournée)
 * [CE] Respect de la localisation de la station prévue → it-F3-19
 * [CE] Respect de la localisation du site eau indiqué (amont pont / aval pont / autre) → it-F3-20
 * [CE] Pertinence des modifications apportées le cas échéant → it-F3-21
 * [CE] Observation de la station et du site → it-F3-23
 * [CE] Appréhension du contexte → it-F3-24
 * [CE] Gestion des particularités → it-F3-25
 * [CE] Logique d'enchaînement des différentes opérations → it-F3-26
 * [CE] Complétude des observations → it-F3-27
 * [CE] Qualité des observations (couleur, limpidité) → it-F3-28
 * [CE] Site choisi pour les mesures → it-F4-11 (Inclut)
 * [CE] Modalités de réalisation → it-F4-3 (Inclut)
 * [CE] Regard critique sur les résultats des mesures → it-F4-26
 * [CE] Fiabilité apparente des mesures → it-F4-27
 * [CE] Colonne « Aquascop » (contre-mesures Temp, pH, Cond, Oxyg) → exclue (décision A.3 : pas de contre-mesures) ; it-F4-26 ; it-F4-27
 * [CE] Site choisi pour le prélèvement → it-F5-1 (Inclut)
 * [CE] Rinçage du matériel, des flacons et des bouchons → it-F5-9 (Inclut) ; it-F4-17
 * [CE] Technique de prélèvement utilisée / adaptée (directement dans le CE, canne, seau, bouteille) → it-F5-19
 * [CE] Mode opératoire (fractionnement si besoin) → it-F5-20
 * [CE] Respect de la profondeur de prélèvement → it-F5-5 (Inclut)
 * [CE] Remplissage des flacons avec réactifs → it-F4-13 (Inclut)
 * [CE] Remplissage des flacons (barbotage…) → it-F5-21
 * [CE] Préservation de l'intégrité de l'échantillon (contamination) → it-F5-8 (Inclut) ; it-F5-7 (sources identifiées)
 * [CE] Mesures d'hygiène prises par le préleveur (gants, de longueur adaptée…) → it-F5-2 (Inclut)
 * [CE] Conditions de sécurité prises pendant l'opération → it-F5-22
 * [CE] Remarques auditeur (par station) → encadrés « Observations » des fiches station (audit.sheets['<no>@<station>'])
 *
 * Fiche « Eaux souterraines » — rapport d'audit de prélèvement (une fiche par point d'eau)
 * [ESO] Code BSS → it-F3-18
 * [ESO] Commune → it-F3-9
 * [ESO] Libellé → it-F3-3
 * [ESO] Nature → site.nature (fiche station, feuille 1)
 * [ESO] Usage → site.usage (fiche station, feuille 1)
 * [ESO] Heure d'arrivée sur site → it-F1-R2
 * [ESO] Heure de départ du site → it-F1-R8
 * [ESO] Le préleveur est-il accompagné ? → it-F3-29
 * [ESO] Autorisation d'entrer sur le site et de prélever → it-F3-30
 * [ESO] Préleveur à l'heure au RDV (si non, retard) → it-F3-31
 * [ESO] Gestionnaire à l'heure au RDV (si non, retard) → it-F3-32
 * [ESO] Commentaires sur les échanges entre l'accompagnant et le préleveur → it-F3-33
 * [ESO] Cohérence entre le lieu prévu (bordereau) et le lieu prélevé → it-F3-19 (Inclut)
 * [ESO] Fiche de localisation à jour (vérifiée par le préleveur) → it-F3-22
 * [ESO] Photographies n° 1 et n° 2 (relevé des mesures in situ, remplissage des flacons) → encadré « photos » de F3 ; preuves photographiques (médias) des critères it-F4-30 et it-F5-21
 * [ESO] Configuration de l'ouvrage (robinet, puits réservoir, émergence, piézomètre, autre) → it-F10-1
 * [ESO] Pompe à demeure (état à l'arrivée ; accès à l'eau si absente ou non fonctionnelle) → it-F10-2
 * [ESO] Pompe installée par le préleveur (branchée sur…, si non pourquoi) → it-F10-3
 * [ESO] Attention aux risques de contamination par les gaz d'échappement → it-F10-4
 * [ESO] Purge de l'ouvrage et/ou des canalisations (durée, type, calcul du volume et du débit, si non pourquoi) → it-F10-5
 * [ESO] Volume piézomètre = π × rayon² × hauteur d'eau → it-F10-5 (aide)
 * [ESO] Technique de purge adaptée (robinet, tuyau, pompe, débit calculé, position dans la colonne d'eau) → it-F10-6
 * [ESO] Technique de prise des mesures in situ adaptée au point d'eau → it-F4-30
 * [ESO] Vérification de la stabilité des paramètres (nombre, intervalle, délai, si non pourquoi) → it-F4-31
 * [ESO] Complétude des mesures in situ (T, pH, conductivité, redox, O₂, turbidité ; instrument ; mesures manquantes) → it-F4-28 ; it-F4-29
 * [ESO] Mesure du niveau piézométrique (sonde du préleveur / exploitant ; statique ; dynamique) → it-F10-7
 * [ESO] Cohérence des mesures in situ avec le matériel Aquascop → exclue (décision A.3 : pas de contre-mesures) ; it-F4-26 ; it-F4-27
 * [ESO] Prélèvement après purge ou renouvellement de l'eau (durée) → it-F5-24
 * [ESO] Port de gants nitrile à usage unique (si non : absence, autre type) → it-F5-2 (Inclut)
 * [ESO] Rinçage des flacons (trois fois) et des bouchons → it-F4-17
 * [ESO] Remplissage avec le minimum d'intermédiaire ; retrait des intermédiaires → it-F5-3 (Inclut)
 * [ESO] Respect des consignes du laboratoire lors du remplissage des flacons → it-F5-25
 * [ESO] Filtration pour les analyses de métaux (rinçage du kit, seringue sans intermédiaire) → it-F5-26
 * [ESO] Flaconnage conforme au programme analytique du laboratoire (nombre, type) → it-F4-12 (Inclut)
 * [ESO] Échantillons étiquetés de manière suffisante (code BSS, date, heure) → it-F5-27
 * [ESO] Données transmises au laboratoire avec les échantillons (bordereau, application, autre) → it-F5-28
 * [ESO] Bilan – Localisation et accès au site → encadré conclusion de F3 (Bilan)
 * [ESO] Bilan – Purge et mesure des paramètres in situ → encadré conclusion de F4 (Bilan, après la purge F10 et les mesures in situ)
 * [ESO] Bilan – Échantillonnage → encadré conclusion de F5 (Bilan)
 * [ESO] Bilan – Identification des échantillons → encadré conclusion de F5 (Bilan)
 * [ESO] Commentaires du bilan → conclusion.comments des encadrés « Bilan »
 * [ESO] Autres préconisations → audit.conclusions.preconisations
 */
import { SCALE_CPNC, JUSTIFY_CPNC, BILAN_OPTIONS } from './model.js';

const ONLY = key => ({ ctx: 'compartments', op: 'in', value: key });
const PHYSICO_OR_ESO = { any: [ONLY('physico'), ONLY('eso')] };
/** Visible pour ces types de tournée seulement / masqué pour ces types. */
const FOR = (...types) => ({ ctx: 'auditType', op: 'in', value: types });
const NOT_FOR = (...types) => ({ ctx: 'auditType', op: 'nin', value: types });
const TOURNEE = { scope: 'tournee' };
const inc = text => `Inclut : ${text}`;

/** Critère de conformité (C / P / NC / N/A) d'une feuille, avec champ « Valeur / réponse » texte par défaut. */
const C = (sheet, no, label, short, extra = {}) => ({
  id: `it-F${sheet}-${no}`, code: `F${sheet}.${no}`, no: String(no), label, short,
  kind: 'conformity', responses: [...SCALE_CPNC], required: true, justifyOn: [...JUSTIFY_CPNC], evidenceOnNC: false,
  input: { type: 'text' }, refs: [], ...extra
});
/** Critère « valeur seule » (sans statut). */
const V = (sheet, no, label, short, kind, extra = {}) => ({
  id: `it-F${sheet}-${no}`, code: `F${sheet}.${no}`, no: String(no), label, short, kind, required: false, refs: [], ...extra
});

const num = (extra = {}) => ({ type: 'number', ...extra });
const select = options => ({ type: 'select', options: [...options] });
const xy = () => ({ type: 'fields', gps: true, fields: [{ key: 'x', label: 'X', type: 'number' }, { key: 'y', label: 'Y', type: 'number' }] });
const choice = (options, extra = []) => ({ type: 'fields', fields: [{ key: 'choix', label: '', type: 'choice', options: [...options] }, ...extra] });
const other = (value = 'Autre', label = 'Autre') => ({ key: 'autre', label, type: 'text', showIf: { key: 'choix', value } });
const fields = list => ({ type: 'fields', fields: list });
const yn = (key, label, extra = {}) => ({ key, label, type: 'choice', options: [...OUI_NON], ...extra });

export const METEO = ['Ensoleillé', 'Nuageux', 'Couvert', 'Pluie faible', 'Pluie forte', 'Orage'];
export const NIVEAU_EAU = ['Étiage', 'Basses eaux', 'Moyennes eaux', 'Hautes eaux', 'Crue'];
const OUI_NON = ['Oui', 'Non'];
const OUI_NON_PARTIELLE = ['Oui', 'Non', 'Partielle'];
const OUI_NON_SO = ['Oui', 'Non', 'Sans objet'];

/**
 * Appareils de mesure de la feuille 4 (module « instruments ») : donnée de TOURNÉE, stockée dans
 * audit.sheets['4'].instruments[clé] = {model, serial, calibration, weekly, standards, morning, morningValue, evening, eveningValue}.
 * `standards` : étalons usuels proposés (tableau d'étalonnage de la fiche cours d'eau).
 */
export const INSTRUMENTS = [
  { key: 'ph', label: 'Sonde pH', badge: 'pH', standards: '4 – 7 – 10' },
  { key: 'o2', label: 'Sonde O₂', badge: 'O₂' },
  { key: 'cond', label: 'Conductivité', icon: 'list', standards: '500 – 1408 – 1413', weeklyOptions: ['Oui', 'Non', 'Semestre'] },
  { key: 'turb', label: 'Turbidimètre', icon: 'sun' }
];
/** Eaux souterraines : potentiel redox en plus. */
export const INSTRUMENTS_ESO = [...INSTRUMENTS, { key: 'redox', label: 'Sonde redox', badge: 'Eh' }];
/** Identification de l'appareil (maquette F4). */
export const INSTRUMENT_FIELDS = [
  { key: 'model', label: 'Marque / modèle', type: 'text' },
  { key: 'serial', label: 'N° de série', type: 'text' },
  { key: 'calibration', label: 'Dernière calibration', type: 'date' }
];
/** Tableau d'étalonnage et de vérification (fiche cours d'eau), par appareil. */
export const CALIBRATION_FIELDS = [
  { key: 'weekly', label: 'Étalonnage hebdomadaire', type: 'choice', options: [...OUI_NON] },
  { key: 'standards', label: 'Étalons utilisés', type: 'text' },
  { key: 'morning', label: 'Vérification du matin', type: 'choice', options: [...OUI_NON] },
  { key: 'morningValue', label: 'Valeur (matin)', type: 'text' },
  { key: 'evening', label: 'Vérification du soir', type: 'choice', options: [...OUI_NON] },
  { key: 'eveningValue', label: 'Valeur (soir)', type: 'text' }
];

const SIGN = ['controller', 'date', 'signature'];
const BILAN = (title, extra = {}) => ({ key: 'conclusion', title, icon: 'check', options: BILAN_OPTIONS.map(o => [...o]), fields: ['comments'], showFor: ['ce', 'eso'], ...extra });

export const GRID_CT_2026 = {
  id: 'grid-ct-2026-v1',
  code: 'CT-2026',
  // 1.1 : turbidité (F4.9) en NTU, unité des CCTP 2026 (même identifiant : grilles enregistrées mises à niveau par
  // upgradeStoredGrid ; tournées existantes inchangées). Toute évolution diffusée aux tablettes incrémente ce numéro.
  version: '1.1',
  status: 'publiee',
  publishedAt: '2026-10-10T00:00:00.000Z',
  name: 'Contrôle terrain des prestations de prélèvement – 2026',
  layout: 'sheets',
  description: 'Grille unique des contrôles terrain des prestations de prélèvement 2026 : hydrobiologie (RCS ESC BIO, 9 feuilles des maquettes), physico-chimie des cours d’eau et eaux souterraines (points des fiches d’évaluation intégrés sans doublon). Un audit = une tournée : les points communs à la journée (organisation, logistique, étalonnage, flaconnage, froid, documentation, sécurité, expédition) sont renseignés une fois, les fiches station sont répétées pour chaque station visitée. Échelle C / P / NC / N/A.',
  scope: { providerIds: [], samplingTypeIds: ['stype-HYDROBIO', 'stype-PC', 'stype-ESO', 'stype-MICROPOL', 'stype-INSITU'], matrixIds: [], protocolDocKeys: [], cctpDocKeys: [], environments: [] },
  /** Prestataires proposés en premier pour les tournées (tout autre prestataire reste possible). */
  providers: ['prov-TL1', 'prov-OEG', 'prov-HYDRECO', 'prov-NBC'],
  settings: { gpsThresholdM: 300, transportMaxHours: 24, calibrationMaxDays: 30 },
  header: {
    org: 'Office de l’Eau de Guyane', title: 'Contrôle terrain prestataire – {prestataire} – {programme}',
    subtitle: 'Fiche de contrôle terrain', tagline: 'L’eau au service des milieux naturels de Guyane',
    program: 'Suivi de la qualité des eaux de Guyane',
    slogan: 'La connaissance aujourd’hui pour les rivières de demain', website: 'www.eauguyane.fr'
  },
  types: [
    { key: 'bio', label: 'Hydrobiologie – RCS ESC BIO', short: 'Hydrobiologie', program: 'RCS ESC BIO 2026', matrixCodes: ['ESU'],
      compartments: ['physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'], codeType: 'SANDRE',
      subtitle: 'Fiche station de contrôle terrain', kicker: 'Suivi biologique des eaux douces de surface de Guyane',
      samplingTypeId: 'stype-HYDROBIO', matrixId: 'mat-ESU', icon: 'bug' },
    { key: 'ce', label: 'Cours d’eau – physico-chimie', short: 'Cours d’eau', program: 'Physico-chimie des cours d’eau 2026', matrixCodes: ['ESU', 'PLE', 'EL'],
      compartments: ['physico'], codeType: 'SANDRE',
      subtitle: 'Fiche de contrôle terrain', kicker: 'Suivi physico-chimique des eaux de surface de Guyane',
      samplingTypeId: 'stype-PC', matrixId: 'mat-ESU', icon: 'wave' },
    { key: 'eso', label: 'Eaux souterraines', short: 'Eaux souterraines', program: 'Surveillance des eaux souterraines 2026', matrixCodes: ['ESO'],
      compartments: ['eso'], codeType: 'BSS',
      subtitle: 'Fiche de contrôle terrain', kicker: 'Suivi qualitatif des eaux souterraines de Guyane',
      samplingTypeId: 'stype-ESO', matrixId: 'mat-ESO', icon: 'drop' }
  ],
  compartments: [
    { key: 'organisation', label: 'Organisation / sécurité / traçabilité', icon: 'gear', always: true },
    { key: 'physico', label: 'Physico-chimie in situ et prélèvement eau', icon: 'drop' },
    { key: 'eso', label: 'Eau souterraine – ouvrage, purge, mesures et échantillonnage', icon: 'drop' },
    { key: 'invertebres', label: 'Invertébrés aquatiques – PEZADA', icon: 'bug' },
    { key: 'diatomees', label: 'Diatomées – IDGF', icon: 'diatom' },
    { key: 'poissons', label: 'Ichtyologie et mercure dans le biote', icon: 'fish' },
    { key: 'phytoplancton', label: 'Phytoplancton d’eau douce', icon: 'algae' }
  ],
  sheets: [
    { no: 1, key: 'station', tab: 'Station', title: 'Fiche station de contrôle terrain', kicker: 'Suivi biologique des eaux douces de surface de Guyane', theme: 'ocean', compartment: 'organisation', scope: 'station', layout: 'station', blocks: [], modules: [],
      variants: { ce: { title: 'Fiche de contrôle terrain', kicker: 'Suivi physico-chimique des eaux de surface de Guyane' }, eso: { title: 'Fiche de contrôle terrain', kicker: 'Suivi qualitatif des eaux souterraines de Guyane' } } },
    { no: 2, key: 'organisation', tab: 'Organisation', title: 'Organisation, sécurité et déroulé de mission', kicker: '', theme: 'navy', compartment: 'organisation', scope: 'tournee', layout: 'table', modules: [],
      variants: { ce: { title: 'Organisation, logistique et sécurité de la tournée' }, eso: { title: 'Organisation, logistique et sécurité de la tournée' } },
      blocks: [{ key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'chat' }] },
    { no: 3, key: 'caracterisation', tab: 'Caractérisation', title: 'Prise d’informations de terrain – caractérisation de la station', kicker: 'Prise d’informations de terrain – caractérisation de la station', theme: 'green', compartment: 'organisation', scope: 'station', layout: 'table', modules: [],
      variants: {
        ce: { tab: 'Station et site', title: 'Prise d’informations de terrain – station et site', kicker: 'Prise d’informations de terrain – station et site' },
        eso: { tab: 'Station et site', title: 'Prise d’informations de terrain – station et site', kicker: 'Prise d’informations de terrain – station et site' }
      },
      blocks: [
        { key: 'observations', title: 'Observations générales et non-conformités', icon: 'chat' },
        { key: 'photos', title: 'Prise de photos / références / commentaires', icon: 'camera' },
        BILAN('Bilan – Localisation et accès au site')
      ] },
    { no: 10, key: 'eso-ouvrage', tab: 'Ouvrage et purge', title: 'Eau souterraine – ouvrage, pompage et purge', kicker: 'Suivi qualitatif des eaux souterraines de Guyane', theme: 'slate', compartment: 'eso', scope: 'station', layout: 'table', modules: [],
      blocks: [
        { key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'chat' }
      ] },
    { no: 4, key: 'pc-insitu', tab: 'PC in situ', title: 'Physico-chimie, mesures in situ et flaconnage', kicker: '', theme: 'peach', compartment: 'physico', compartments: ['physico', 'eso'], scope: 'station', layout: 'table',
      modules: ['instruments'], tourneeData: ['instruments'], instruments: INSTRUMENTS, instrumentFields: INSTRUMENT_FIELDS, calibrationFields: CALIBRATION_FIELDS,
      variants: {
        ce: { title: 'Physico-chimie, mesures in situ, étalonnage et flaconnage' },
        eso: { tab: 'Mesures in situ', title: 'Physico-chimie, mesures in situ, étalonnage et flaconnage', instruments: INSTRUMENTS_ESO }
      },
      blocks: [
        { key: 'observations', title: 'Observations / non-conformités / actions demandées :', icon: 'chat' },
        { key: 'conclusion', title: 'Conclusion générale', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['AC', 'À compléter']], fields: SIGN, showFor: ['bio'] },
        BILAN('Bilan – Mesures in situ, étalonnage et flaconnage', { showFor: ['ce'] }),
        BILAN('Bilan – Purge et mesure des paramètres in situ', { showFor: ['eso'] })
      ] },
    { no: 5, key: 'pc-prelevement', tab: 'PC prélèvement', title: 'Physico-chimie – prélèvement, conditionnement et chaîne du froid', kicker: '', theme: 'orange', compartment: 'physico', compartments: ['physico', 'eso'], scope: 'station', layout: 'table', modules: [], mergeSections: true,
      variants: {
        ce: { tab: 'Prélèvement', title: 'Prélèvement, conditionnement et chaîne du froid' },
        eso: { tab: 'Prélèvement', title: 'Prélèvement, conditionnement et chaîne du froid' }
      },
      blocks: [
        { key: 'notes', title: 'Remarques générales / Notes', icon: 'edit' },
        { key: 'conclusion', title: 'Conclusion du contrôle', icon: 'check', options: [['C', 'Conforme (C)'], ['NC', 'Non conforme (NC)'], ['NA', 'Non applicable (N/A)'], ['RES', 'À compléter / Réserve']], fields: SIGN, showFor: ['bio'] },
        BILAN('Bilan – Échantillonnage et identification des échantillons')
      ] },
    { no: 6, key: 'pezada', tab: 'Invertébrés', title: 'Invertébrés aquatiques – protocole PEZADA', kicker: 'Suivi biologique des eaux douces de surface de Guyane', theme: 'violet', compartment: 'invertebres', scope: 'station', layout: 'table', modules: [],
      blocks: [
        { key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'edit' },
        { key: 'conclusion', title: 'Conclusion du contrôle', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['NA', 'Non applicable']], fields: ['comments', 'date', 'controller', 'signature', 'providerSignature'] }
      ] },
    { no: 7, key: 'idgf', tab: 'Diatomées', title: 'Diatomées – IDGF', kicker: 'Fiche de contrôle terrain – Diatomées – IDGF', theme: 'sky', compartment: 'diatomees', scope: 'station', layout: 'table', modules: [],
      blocks: [
        { key: 'observations', title: 'Observations générales', icon: 'chat' },
        { key: 'conclusion', title: 'Conclusion du contrôle terrain', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['NA', 'Non applicable']], fields: ['comments', 'controller', 'date', 'signature'] }
      ] },
    { no: 8, key: 'ichtyo-mercure', tab: 'Poissons', title: 'Ichtyologie et mercure dans le biote', kicker: 'Suivi biologique des eaux douces de Guyane', theme: 'ocean', compartment: 'poissons', scope: 'station', layout: 'split', modules: [],
      blocks: [{ key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'clipboard' }] },
    { no: 9, key: 'phyto', tab: 'Phytoplancton', title: 'Phytoplancton d’eau douce', kicker: 'Phytoplancton d’eau douce', theme: 'teal', compartment: 'phytoplancton', scope: 'station', layout: 'table', modules: [],
      blocks: [
        { key: 'notes', title: 'Notes et observations générales', icon: 'doc' },
        { key: 'conclusion', title: 'Conclusion et signature', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['RES', 'Sous réserve']], fields: ['comments', 'controller', 'date', 'signature'] }
      ] }
  ],
  sections: [
    /* ---------- Feuille 1 : repères terrain (affichés dans la fiche station) ---------- */
    {
      id: 's-F1-reperes', sheet: 1, no: '', title: 'Repères terrain', icon: 'edit', columns: 'value', domain: 'prelevement',
      items: [
        V(1, 'R1', 'Date', '', 'date', { prefill: 'audit.date' }),
        V(1, 'R2', 'Heure d’arrivée sur site', '', 'time', { prefill: 'audit.time' }),
        V(1, 'R8', 'Heure de départ du site', '', 'time'),
        V(1, 'R3', 'Contrôleur OEG', '', 'text', { prefill: 'auditor.name' }),
        V(1, 'R4', 'Opérateurs du prestataire', '', 'text', { prefill: 'prestation.operators', labelTemplate: 'Opérateurs {prestataire}' }),
        V(1, 'R5', 'Météo', '', 'select', { options: [...METEO] }),
        V(1, 'R6', 'Niveau d’eau', '', 'select', { options: [...NIVEAU_EAU], condition: NOT_FOR('eso') }),
        V(1, 'R7', 'Observations', '', 'longtext')
      ]
    },

    /* ---------- Feuille 2 : organisation, logistique et sécurité de la tournée (une fois par tournée) ---------- */
    {
      id: 's-F2-1', sheet: 2, no: '1', title: 'Identification mission', columns: 'value', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        V(2, '1.1', 'Agent(s) OEG', 'OEG', 'text', { prefill: 'auditor.name', required: true, help: 'Auditeur de la tournée.' }),
        V(2, '1.2', 'Structure accompagnatrice', 'Structure', 'text'),
        V(2, '1.3', 'Agent(s) accompagnateur(s)', 'Accompagnateurs', 'text'),
        V(2, '1.4', 'Date mission', 'Date', 'date', { prefill: 'audit.date', required: true }),
        V(2, '1.5', 'Heure début', 'Hdébut', 'time', { prefill: 'audit.time' }),
        V(2, '1.6', 'Heure fin', 'Hfin', 'time'),
        V(2, '1.7', 'Moyens OEG', 'Moyens', 'text'),
        V(2, '1.8', 'Niveau d’eau', 'Niveau', 'select', { options: [...NIVEAU_EAU], condition: NOT_FOR('eso') }),
        V(2, '1.9', 'Conditions météo', 'Météo', 'select', { options: [...METEO] }),
        V(2, '1.10', 'Difficulté d’accès', 'Accès', 'text'),
        V(2, '1.11', 'Type d’audit', 'Type audit', 'select', { options: ['Inopiné', 'Avec rendez-vous'], prefill: 'audit.kind' }),
        V(2, '1.12', 'Lot / marché de prélèvement', 'Lot', 'text'),
        V(2, '1.13', 'Support(s) audité(s)', 'Supports', 'text', { placeholder: 'ex. eau, sédiments, biote' })
      ]
    },
    {
      id: 's-F2-2', sheet: 2, no: '2', title: 'Prestataires et équipe', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '2.1', 'Identification des prestataires', 'Prestataires', { prefill: 'provider.name', help: inc('préleveur, assistant (fiche cours d’eau).') }),
        C(2, '2.2', 'Effectif total', 'Effectif', { input: num({ min: 0, step: 1 }) }),
        C(2, '2.3', 'Stagiaires en observation', 'Stag. obs.', { input: num({ min: 0, step: 1 }) }),
        C(2, '2.4', 'Stagiaires chargés de mission', 'Stag. mission', { input: num({ min: 0, step: 1 }) }),
        C(2, '2.5', 'Agents non spécialisés mais formés', 'Non spé. formés', { input: num({ min: 0, step: 1 }) }),
        C(2, '2.6', 'Agents non spécialisés non formés', 'Non spé. non formés', { input: num({ min: 0, step: 1 }) }),
        C(2, '2.7', 'Sous-effectif', 'Sous-effectif', { input: select(OUI_NON) }),
        C(2, '2.8', 'Conformité équipe/CCTP', 'Conformité')
      ]
    },
    {
      id: 's-F2-3', sheet: 2, no: '3', title: 'Moyens de locomotion', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '3.1', 'Type(s) de moyen', 'Type', { input: select(['4x4', 'Bateau motorisé / pirogue', 'À pied', 'Hélicoptère', 'Avion', 'Autre']) }),
        C(2, '3.2', 'État général', 'État'),
        C(2, '3.3', 'Conducteur(s)', 'Conducteur'),
        C(2, '3.4', 'Conformité et sécurité', 'Conformité'),
        C(2, '3.5', 'Aménagement du véhicule (étagères, rangement…)', 'Aménagement')
      ]
    },
    {
      id: 's-F2-4', sheet: 2, no: '4', title: 'EPI (Équipements de protection individuelle)', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '4.1', 'Tenue adaptée', 'Tenue'),
        C(2, '4.2', 'EPI navigation présents', 'EPI nav. présents'),
        C(2, '4.3', 'Port des EPI navigation', 'EPI nav. portés'),
        C(2, '4.4', 'Port des EPI prélèvements', 'EPI prél. portés', { help: inc('port du gilet de sauvetage selon le contexte : berge, pont, gué… (fiche cours d’eau).') }),
        C(2, '4.5', 'Rappels EPI', 'Rappels'),
        C(2, '4.6', 'Sécurité routière / équipements (triangle, chasuble, cônes…)', 'Séc. routière')
      ]
    },
    {
      id: 's-F2-5', sheet: 2, no: '5', title: 'Planning et déroulé de mission', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '5.1', 'Jour', 'Jour', { input: { type: 'date' } }),
        C(2, '5.2', 'Heure début', 'Hdébut', { input: { type: 'time' } }),
        C(2, '5.3', 'Heure fin', 'Hfin', { input: { type: 'time' } }),
        C(2, '5.4', 'Description des étapes de la mission', 'Déroulé', { input: { type: 'longtext' } }),
        C(2, '5.5', 'Planification de l’audit, respect du RDV / horaire si inopiné', 'Planif.'),
        C(2, '5.6', 'Programme journalier (nombre de stations)', 'Prog. jour', { input: num({ min: 0, step: 1 }), prefill: 'tournee.stationCount' }),
        C(2, '5.7', 'Amplitude horaire', 'Amplitude', { suggest: { type: 'duration', from: 'it-F2-5.2', to: 'it-F2-5.3' }, help: 'Durée proposée à partir des heures de début et de fin (5.2 → 5.3).' }),
        C(2, '5.8', 'Logique d’enchaînement de la tournée (ordre des stations)', 'Enchaînement')
      ]
    },
    {
      id: 's-F2-6', sheet: 2, no: '6', title: 'Documentation', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '6.1', 'Documents contractuels à disposition (CCTP, lettre de mission…)', 'Doc. contrat.'),
        C(2, '6.2', 'Référentiels techniques à disposition', 'Référentiels'),
        C(2, '6.3', 'Documents techniques sur le matériel à disposition', 'Doc. matériel'),
        C(2, '6.4', 'Support d’informations sur stations et sites', 'Infos stations')
      ]
    },
    {
      id: 's-F2-7', sheet: 2, no: '7', title: 'Traçabilité et expédition', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '7.1', 'Support de notation des données terrain', 'Support notation', { input: select(['Fiche papier', 'Tablette', 'Application mobile', 'Autre']) }),
        C(2, '7.2', 'Support papier disponible (secours)', 'Papier secours'),
        C(2, '7.3', 'Dépôt / expédition des échantillons le jour même', 'Expédition', { domain: 'transport' })
      ]
    },

    /* ---------- Feuille 3 : station et site (caractérisation de la station) ---------- */
    {
      id: 's-F3-infos', sheet: 3, no: '', title: 'Prise d’informations de terrain', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      headers: { label: 'Information' },
      items: [
        C(3, 1, 'Nom du bassin versant', 'BV', { prefill: 'site.bassin', condition: NOT_FOR('eso') }),
        C(3, 2, 'Nom du cours d’eau', 'CE', { prefill: 'site.riverName', condition: NOT_FOR('eso') }),
        C(3, 3, 'Nom de la station', 'STA', { prefill: 'site.name', help: 'Eaux souterraines : libellé du point d’eau.' }),
        C(3, 4, 'Code SANDRE station', 'SANDRE', { prefill: 'site.code', condition: NOT_FOR('eso') }),
        C(3, 5, 'Rang de Strahler', 'STR', { prefill: 'site.strahler', condition: FOR('bio') }),
        C(3, 6, 'Pression (RCO)', 'RCO', { prefill: 'site.pressions' }),
        C(3, 7, 'Conditions météo', 'METEO', { help: 'Voir aussi 27–28 (observations environnementales).' }),
        C(3, 8, 'Physico-chimie générale', 'PHYC', { help: 'Voir aussi 27–28 (observations environnementales).' }),
        C(3, 9, 'Commune', 'COM', { prefill: 'site.commune' }),
        C(3, 10, 'Hydro-écorégion', 'HER', { prefill: 'site.her', condition: FOR('bio') }),
        C(3, 11, 'Schéma général des habitats', 'HAB', { condition: FOR('bio') }),
        C(3, 12, 'Membres de l’équipe', 'EQUIPE', { prefill: 'prestation.operators' }),
        C(3, 13, 'Protocoles utilisés', 'PROTO'),
        C(3, 14, 'Date des prélèvements', 'DATE', { input: { type: 'date' } }),
        C(3, 15, 'Coordonnées GPS des points de prélèvement', 'GPS', { input: xy() }),
        C(3, 16, 'Prise de photos', 'PHOTO', { help: 'Le préleveur photographie la station et ses opérations selon le protocole. Les photos du contrôleur se joignent en preuve aux critères ou dans l’encadré « Prise de photos / références / commentaires ».' }),
        C(3, 17, 'Station représentative de la ME', 'REP_ME', { input: select(['Oui', 'Non', 'Partiellement']), condition: FOR('bio') }),
        C(3, 18, 'Code BSS du point', 'BSS', { prefill: 'site.code', condition: FOR('eso') })
      ]
    },
    {
      id: 's-F3-localisation', sheet: 3, no: '', title: 'Localisation et approche', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(3, 19, 'Respect de la localisation prévue (station / bordereau)', 'LOC', { help: inc('respect de la localisation de la station prévue (fiche cours d’eau) ; cohérence entre le lieu prévu (bordereau) et le lieu prélevé (fiche eaux souterraines).') }),
        C(3, 20, 'Site de prélèvement indiqué respecté', 'SITE', { input: select(['Amont pont', 'Aval pont', 'Autre']), condition: NOT_FOR('eso'), help: 'Respect de la localisation du site eau indiqué (fiche cours d’eau).' }),
        C(3, 21, 'Pertinence des modifications apportées le cas échéant', 'MODIF'),
        C(3, 22, 'Fiche de localisation tenue à jour par le préleveur', 'FICHE_LOC'),
        C(3, 23, 'Observation de la station et du site', 'OBS_STA'),
        C(3, 24, 'Appréhension du contexte', 'CONTEXTE'),
        C(3, 25, 'Gestion des particularités', 'PARTIC'),
        C(3, 26, 'Logique d’enchaînement des différentes opérations', 'ENCHAIN')
      ]
    },
    {
      id: 's-F3-environnement', sheet: 3, no: '', title: 'Observations environnementales', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(3, 27, 'Complétude des observations', 'OBS_COMPL'),
        C(3, 28, 'Qualité des observations (couleur, limpidité…)', 'OBS_QUAL')
      ]
    },
    {
      id: 's-F3-acces', sheet: 3, no: '', title: 'Accès au site et rendez-vous', columns: 'full', domain: 'prelevement', condition: { all: [ONLY('organisation'), FOR('eso')] },
      items: [
        V(3, 29, 'Préleveur accompagné', 'ACCOMP', 'select', { options: [...OUI_NON] }),
        C(3, 30, 'Autorisation d’entrer sur le site et de prélever', 'AUTORIS', { input: null }),
        C(3, 31, 'Préleveur à l’heure au RDV', 'RDV_PREL', { input: fields([{ key: 'choix', label: '', type: 'choice', options: [...OUI_NON_SO] }, { key: 'retard', label: 'Retard', type: 'number', unit: 'min', min: 0, step: 1, showIf: { key: 'choix', value: 'Non' } }]) }),
        C(3, 32, 'Gestionnaire à l’heure au RDV', 'RDV_GEST', { input: fields([{ key: 'choix', label: '', type: 'choice', options: [...OUI_NON_SO] }, { key: 'retard', label: 'Retard', type: 'number', unit: 'min', min: 0, step: 1, showIf: { key: 'choix', value: 'Non' } }]) }),
        V(3, 33, 'Échanges entre l’accompagnant et le préleveur', 'ECHANGES', 'longtext', { placeholder: 'Rien à signaler / commentaire (sans objet si non accompagné)' })
      ]
    },

    /* ---------- Feuille 10 : eau souterraine – ouvrage, pompage et purge ---------- */
    {
      id: 's-F10-1', sheet: 10, no: '1', title: 'Caractéristiques du point de prélèvement', columns: 'full', domain: 'prelevement', condition: ONLY('eso'),
      items: [
        V(10, 1, 'Configuration de l’ouvrage', 'Ouvrage', 'select', { options: ['Robinet', 'Puits réservoir', 'Émergence de la source', 'Piézomètre', 'Autre'], help: 'Accès à l’eau souterraine.' }),
        V(10, 2, 'Pompe à demeure', 'Pompe', 'fields', {
          fields: [
            yn('pompe', 'Ouvrage équipé d’une pompe à demeure'),
            { key: 'etat', label: 'État', type: 'choice', options: ['En fonctionnement avant l’arrivée / automatique', 'Mise en route par le gestionnaire à l’arrivée', 'Mise en route par le préleveur', 'Non fonctionnelle', 'Fonctionnelle mais non utilisée'], showIf: { key: 'pompe', value: 'Oui' } },
            { key: 'pourquoi', label: 'Pourquoi', type: 'text', showIf: { key: 'etat', value: 'Fonctionnelle mais non utilisée' } },
            { key: 'acces', label: 'Accès à l’eau', type: 'choice', options: ['Accès direct à la ressource (source, émergence, trop-plein)', 'Robinet / vanne en écoulement gravitaire', 'Installation d’une pompe du préleveur nécessaire', 'Autre'], showIf: [{ key: 'pompe', value: 'Non' }, { key: 'etat', value: 'Non fonctionnelle' }] },
            { key: 'accesAutre', label: 'Autre accès', type: 'text', showIf: { key: 'acces', value: 'Autre' } }
          ]
        }),
        C(10, 3, 'Pompe installée par le préleveur', 'Pompe préleveur', {
          input: fields([
            yn('installee', 'Pompe installée dans l’ouvrage'),
            { key: 'alimentation', label: 'Branchée sur', type: 'choice', options: ['Batterie portative', 'Véhicule', 'Groupe électrogène'], showIf: { key: 'installee', value: 'Oui' } },
            { key: 'pourquoi', label: 'Si non, pourquoi', type: 'text', showIf: { key: 'installee', value: 'Non' } }
          ])
        }),
        C(10, 4, 'Vigilance vis-à-vis des gaz d’échappement (contamination)', 'Gaz', {
          input: null, condition: { item: 'it-F10-3', field: 'alimentation', op: 'in', value: ['Véhicule', 'Groupe électrogène'] },
          help: 'Pompe alimentée par le véhicule ou un groupe électrogène : le préleveur est-il attentif aux risques de contamination de l’eau par les gaz d’échappement ?'
        })
      ]
    },
    {
      id: 's-F10-2', sheet: 10, no: '2', title: 'Purge', columns: 'full', domain: 'prelevement', condition: ONLY('eso'),
      items: [
        C(10, 5, 'Purge de l’ouvrage et/ou des canalisations', 'Purge', {
          input: fields([
            yn('realisee', 'Purge réalisée'),
            { key: 'duree', label: 'Durée', type: 'number', unit: 'min', min: 0, step: 1, showIf: { key: 'realisee', value: 'Oui' } },
            { key: 'type', label: 'Type', type: 'choice', options: ['Purge des canalisations', 'Purge de l’ouvrage'], showIf: { key: 'realisee', value: 'Oui' } },
            yn('calculVolume', 'Calcul du volume de l’ouvrage', { showIf: { key: 'type', value: 'Purge de l’ouvrage' } }),
            yn('calculDebit', 'Calcul du débit de pompage', { showIf: { key: 'type', value: 'Purge de l’ouvrage' } }),
            { key: 'pourquoi', label: 'Si non, pourquoi', type: 'text', showIf: { key: 'realisee', value: 'Non' } }
          ]),
          help: 'Volume de l’ouvrage (piézomètre) = π × r² × hauteur d’eau. Sans objet ⇒ N/A (préciser pourquoi en observation).'
        }),
        C(10, 6, 'Technique de purge adaptée à la configuration du point d’eau', 'Technique purge', {
          input: fields([
            yn('robinetContinu', 'Robinet en écoulement continu'),
            yn('tuyauFixe', 'Robinet avec tuyau fixe'),
            yn('tuyauAdapte', 'Adaptation d’un tuyau par le préleveur', { showIf: { key: 'tuyauFixe', value: 'Non' } }),
            yn('pompeContinu', 'Pompe en fonctionnement continu'),
            yn('debitCalcule', 'Débit de pompage calculé'),
            { key: 'position', label: 'Position dans la colonne d’eau', type: 'choice', options: ['Milieu', 'Tiers inférieur', 'Autre'] },
            { key: 'positionAutre', label: 'Autre position', type: 'text', showIf: { key: 'position', value: 'Autre' } }
          ])
        })
      ]
    },
    {
      id: 's-F10-3', sheet: 10, no: '3', title: 'Niveau piézométrique', columns: 'full', domain: 'prelevement', condition: ONLY('eso'),
      items: [
        C(10, 7, 'Mesure du niveau piézométrique', 'Niveau piézo', {
          input: fields([
            { key: 'source', label: 'Source', type: 'choice', options: ['Sonde du préleveur', 'Communiqué par l’exploitant'] },
            { key: 'statique', label: 'Niveau statique (avant prélèvement)', type: 'number', unit: 'm', step: 0.01 },
            { key: 'dynamique', label: 'Niveau dynamique', type: 'number', unit: 'm', step: 0.01 }
          ])
        })
      ]
    },

    /* ---------- Feuille 4 : physico-chimie, mesures in situ, étalonnage et flaconnage ---------- */
    {
      id: 's-F4-controle', sheet: 4, no: '', title: 'Contrôle terrain – Physico-chimie, mesures in situ et flaconnage', icon: 'clipboard', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      headers: { short: 'Réf.' },
      items: [
        C(4, 1, 'Préleveur(s) / fonction', 'PV'),
        C(4, 2, 'Calibration des sondes', 'CAL', { ...TOURNEE, help: inc('procédures de calibration et d’étalonnage des sondes (fiche cours d’eau). Détail par appareil (étalonnage hebdomadaire, vérifications du matin et du soir) : module « Appareils de mesure ».') }),
        C(4, 3, 'Respect des normes de mesure', 'NORME', { help: inc('modalités de réalisation des mesures (fiche cours d’eau).') }),
        C(4, 4, 'pH (in situ)', 'pH', { input: num({ unit: 'unité pH', min: 0, max: 14, step: 0.01 }) }),
        C(4, 5, 'Oxygène dissous (in situ)', 'O2', { input: num({ unit: 'mg/L', min: 0, step: 0.01 }) }),
        C(4, 6, 'Saturation en O₂ (in situ)', 'SatO2', { input: num({ unit: '%', min: 0, step: 0.1 }) }),
        C(4, 7, 'Température eau (in situ)', 'T°', { input: num({ unit: '°C', step: 0.1 }) }),
        C(4, 8, 'Conductivité (in situ)', 'Cond', { input: num({ unit: 'µS/cm', min: 0, step: 0.1 }) }),
        C(4, 9, 'Turbidité (in situ, triplicat)', 'Turb', { input: { type: 'fields', fields: [1, 2, 3].map(n => ({ key: 't' + n, label: 'Mesure ' + n, type: 'number', unit: 'NTU', min: 0, step: 0.01 })) } }),
        C(4, 10, 'Salinité (si applicable)', 'Sal', { input: num({ min: 0, step: 0.01 }) }),
        C(4, 11, 'Position de mesure', 'Pos', { help: inc('site choisi pour les mesures (fiche cours d’eau).'), condition: NOT_FOR('eso') }),
        C(4, 12, 'Flaconnage conforme', 'Flac', { help: inc('flaconnage conforme au programme analytique du laboratoire (nombre, type de flacons) (fiche eaux souterraines).') }),
        C(4, 13, 'Présence ou ajout de réactif', 'Réactif', { help: inc('remplissage des flacons avec réactifs (fiche cours d’eau).') }),
        C(4, 14, 'Flaconnage supplémentaire', 'Sup'),
        C(4, 15, 'Casse de flaconnage', 'Casse'),
        C(4, 16, 'Transport adapté du flaconnage', 'Transp'),
        C(4, 17, 'Rinçage des flacons', 'Rinçage', {
          input: fields([yn('troisFois', 'Rinçage trois fois'), yn('bouchons', 'Rinçage des bouchons')]),
          help: inc('rinçage des flacons (trois fois) et des bouchons (fiches cours d’eau et eaux souterraines) ; rinçage du matériel : F5.9.')
        })
      ]
    },
    {
      id: 's-F4-tournee', sheet: 4, no: '', title: 'Sondes, étalonnage et flaconnage – commun à la tournée', icon: 'gear', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      headers: { short: 'Réf.' },
      items: [
        C(4, 18, 'Sondes utilisées (type, état, propreté)', 'Sondes', TOURNEE),
        C(4, 19, 'Traçabilité des procédures / sondes', 'Trac. proc.', TOURNEE),
        C(4, 20, 'Disponibilité de consommables pour l’étalonnage (solutions, piles)', 'Consomm.', TOURNEE),
        C(4, 21, 'Sondes de secours disponibles', 'Secours', TOURNEE),
        C(4, 22, 'Organisme fournisseur du flaconnage', 'Fournisseur', { ...TOURNEE, input: { type: 'text', placeholder: 'Laboratoire / organisme fournisseur' } }),
        C(4, 23, 'Propreté des flacons', 'Propreté', TOURNEE),
        C(4, 24, 'Étiquetage des flacons / descriptif disponible', 'Étiquetage', TOURNEE),
        C(4, 25, 'Traçabilité vers le laboratoire (scan, fiche…)', 'Trac. labo', { ...TOURNEE, help: 'Flacons fournis identifiés et rattachés au laboratoire (code-barres scanné, fiche). La transmission des données de terrain avec les échantillons est contrôlée en F5.28.' })
      ]
    },
    {
      id: 's-F4-mesures', sheet: 4, no: '', title: 'Appréciation des mesures in situ', icon: 'search', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      headers: { short: 'Réf.' },
      items: [
        C(4, 26, 'Regard critique sur les résultats des mesures', 'Regard crit.', { input: null, help: 'Le préleveur vérifie la cohérence de ses mesures (aucune contre-mesure du contrôleur).' }),
        C(4, 27, 'Fiabilité apparente des mesures', 'Fiabilité', { input: null }),
        C(4, 28, 'Complétude des mesures in situ', 'Complétude', {
          input: fields([
            { key: 'instrument', label: 'Instrument', type: 'choice', options: ['Sondes monoparamètres', 'Sonde multiparamètres'] },
            { key: 'manquantes', label: 'Mesures manquantes et cause', type: 'text' }
          ]),
          help: 'Température, pH, conductivité, oxygène dissous et turbidité ; potentiel redox en plus pour les eaux souterraines (29).'
        }),
        C(4, 29, 'Potentiel redox (in situ)', 'Redox', { input: num({ unit: 'mV', step: 1 }), condition: FOR('eso') }),
        C(4, 30, 'Technique de prise des mesures adaptée au point d’eau', 'Technique', {
          condition: FOR('eso'),
          help: inc('position de mesure (F4.11 des tournées cours d’eau et biologie).'),
          input: fields([
            yn('emergence', 'Directement dans la ressource, au plus près de l’émergence'),
            yn('seauContinu', 'Dans un seau / récipient en écoulement continu'),
            yn('barbotage', 'En limitant le barbotage'),
            { key: 'barbotageComment', label: 'Comment', type: 'text', showIf: { key: 'barbotage', value: 'Oui' } },
            yn('tuyauFond', 'Tuyau placé au fond du seau')
          ])
        }),
        C(4, 31, 'Vérification de la stabilité des paramètres', 'Stabilité', {
          condition: FOR('eso'),
          input: fields([
            yn('realisee', 'Vérification effectuée'),
            { key: 'nb', label: 'Nombre de mesures', type: 'number', min: 0, step: 1, showIf: { key: 'realisee', value: 'Oui' } },
            { key: 'intervalle', label: 'Intervalle', type: 'number', unit: 'min', min: 0, step: 1, showIf: { key: 'realisee', value: 'Oui' } },
            { key: 'delai', label: 'Délai avant la 1re mesure', type: 'number', unit: 'min', min: 0, step: 1, showIf: { key: 'realisee', value: 'Oui' } },
            { key: 'pourquoi', label: 'Si non, pourquoi', type: 'text', showIf: { key: 'realisee', value: 'Non' } }
          ])
        })
      ]
    },

    /* ---------- Feuille 5 : prélèvement, conditionnement et chaîne du froid ---------- */
    {
      id: 's-F5-prelevement', sheet: 5, no: '', title: 'Prélèvement', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      items: [
        C(5, 1, 'Lieu de prélèvement', 'Lieu', { help: inc('site choisi pour le prélèvement (fiche cours d’eau).') }),
        C(5, 2, 'EPI pendant le prélèvement', 'EPI', { help: inc('mesures d’hygiène prises par le préleveur : port de gants nitrile à usage unique, de longueur adaptée (si non : absence de gants ou autre type à préciser) (fiches cours d’eau et eaux souterraines).') }),
        C(5, 3, 'Matériel intermédiaire', 'Matériel', { help: inc('remplissage des flacons avec le minimum d’intermédiaire possible ; retrait des intermédiaires utilisés pour la phase de renouvellement (tuyau…) (fiche eaux souterraines).') }),
        C(5, 4, 'Prélèvement face au courant', 'Face courant', { condition: NOT_FOR('eso') }),
        C(5, 5, 'Prélèvement en sub-surface', 'Sub-surface', { condition: NOT_FOR('eso'), help: inc('respect de la profondeur de prélèvement (fiche cours d’eau).') }),
        C(5, 6, 'Distance à la berge', 'Distance', { input: num({ unit: 'm', min: 0, step: 0.1 }), condition: NOT_FOR('eso') }),
        C(5, 7, 'Sources de contamination', 'Contamination', { help: 'Sources de contamination identifiées par le préleveur ; préservation de l’intégrité de l’échantillon : F5.8.' }),
        C(5, 8, 'Moyens d’évitement', 'Évitement', { help: inc('préservation de l’intégrité de l’échantillon vis-à-vis des contaminations (fiche cours d’eau).') }),
        C(5, 9, 'Rinçage du matériel', 'Rinçage', { help: inc('rinçage du matériel de prélèvement (fiche cours d’eau) ; rinçage des flacons et des bouchons : F4.17.') }),
        C(5, 10, 'Nombre de flacons', 'Nb flacons', { input: num({ min: 0, step: 1 }) })
      ]
    },
    {
      id: 's-F5-transport', sheet: 5, no: '', title: 'Conditionnement et chaîne du froid', columns: 'full', domain: 'transport', condition: PHYSICO_OR_ESO,
      items: [
        C(5, 11, 'Type / nombre de glacières', 'Glacières', { ...TOURNEE, help: inc('état et qualité des glacières (fiche cours d’eau).') }),
        C(5, 12, 'Pré-réfrigération', 'Pré-réfrig.', TOURNEE),
        C(5, 13, 'Température de conservation', 'T° conservation', {
          input: num({ unit: '°C', step: 0.1 }),
          help: 'Température relevée pour les échantillons de la station ; mode de conservation / réfrigération : F5.14 (commun à la tournée).',
          alerts: [{ op: 'outside', value: [2, 8], level: 'attention', code: 'TEMP_CONSERVATION', title: 'Température de conservation {value} °C', message: 'Température hors de la plage 5 ± 3 °C (NF EN ISO 5667-3)', requirement: 'Conservation des échantillons à 5 ± 3 °C (NF EN ISO 5667-3)', typeCode: 'TRANSPORT' }]
        }),
        C(5, 14, 'Réfrigérant / glace', 'Réfrigérant', { ...TOURNEE, help: inc('mode de conservation / réfrigération des échantillons (fiche cours d’eau).') }),
        C(5, 15, 'Thermobouton / traceur', 'Thermobouton', { ...TOURNEE, help: inc('suivi thermique (enceinte, frigo, échantillons) (fiche cours d’eau).') }),
        C(5, 16, 'Positionnement du thermobouton', 'Position'),
        C(5, 17, 'Lieu de stockage intermédiaire', 'Stockage (lieu)', TOURNEE),
        C(5, 18, 'Moyen de stockage intermédiaire', 'Stockage (moyen)', TOURNEE)
      ]
    },
    {
      id: 's-F5-complements', sheet: 5, no: '', title: 'Technique de prélèvement et remplissage', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      items: [
        C(5, 19, 'Technique de prélèvement utilisée / adaptée', 'Technique', { input: select(['Directement dans le cours d’eau', 'Canne', 'Seau', 'Bouteille', 'Autre']), condition: NOT_FOR('eso') }),
        C(5, 20, 'Mode opératoire (fractionnement si besoin)', 'Mode op.', { condition: NOT_FOR('eso') }),
        C(5, 21, 'Remplissage des flacons (barbotage…)', 'Remplissage'),
        C(5, 22, 'Conditions de sécurité pendant l’opération', 'Sécurité'),
        C(5, 23, 'Conditionnement des échantillons en glacières (calage…)', 'Calage', { domain: 'transport' }),
        C(5, 24, 'Prélèvement après purge ou renouvellement de l’eau', 'Renouvellement', { condition: FOR('eso'), input: fields([{ key: 'renouvellement', label: 'Renouvellement avant prélèvement', type: 'number', unit: 'min', min: 0, step: 1 }]) }),
        C(5, 25, 'Respect des consignes du laboratoire lors du remplissage des flacons', 'Consignes labo'),
        C(5, 26, 'Filtration pour les analyses de métaux', 'Filtration', {
          input: fields([yn('rincageKit', 'Rinçage du kit de filtration (seringue et filtre)'), yn('seringue', 'Seringue remplie sans intermédiaire')]),
          help: 'N/A si aucune analyse de métaux dissous n’est prévue.'
        })
      ]
    },
    {
      id: 's-F5-identification', sheet: 5, no: '', title: 'Identification et transmission des échantillons', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      items: [
        C(5, 27, 'Étiquetage suffisant des échantillons (à minima code station / BSS, date, heure)', 'Étiquetage'),
        C(5, 28, 'Données transmises au laboratoire avec les échantillons', 'Transmission', {
          domain: 'transport',
          help: 'Bordereau ou application accompagnant les échantillons de la station ; la traçabilité des flacons fournis est contrôlée en F4.25.',
          input: fields([{ key: 'support', label: 'Support', type: 'choice', options: ['Bordereau papier', 'Application mobile', 'Autre'] }, { key: 'autre', label: 'Autre', type: 'text', showIf: { key: 'support', value: 'Autre' } }])
        })
      ]
    },
    {
      id: 's-F5-materiel', sheet: 5, no: '', title: 'Matériel de prélèvement', columns: 'full', domain: 'prelevement', condition: PHYSICO_OR_ESO,
      items: [
        C(5, 29, 'Matériel de prélèvement disponible et adapté', 'Matériel dispo.', { ...TOURNEE, input: { type: 'text', placeholder: 'ex. seau inox / plastique, chaîne + corde, canne' }, help: inc('matériel de prélèvement disponible ; diversité, adéquation et propreté du matériel de prélèvement (seau inox / plastique, chaîne + corde, canne…) (fiche cours d’eau).') }),
        C(5, 30, 'État et propreté du matériel de prélèvement', 'État matériel', TOURNEE)
      ]
    },

    /* ---------- Feuille 6 : invertébrés aquatiques – protocole PEZADA ---------- */
    {
      id: 's-F6-pezada', sheet: 6, no: '', title: 'Invertébrés aquatiques – protocole PEZADA', columns: 'full', domain: 'prelevement', condition: ONLY('invertebres'),
      headers: { short: 'Réf.', value: 'Valeur / réponse (à renseigner)', obs: 'Observations (détails, précisions, actions…)' },
      items: [
        C(6, 1, 'Agent prestataire & fonction', 'AGT'),
        C(6, 2, 'Fiche terrain complétée', 'FT', { input: select(OUI_NON_PARTIELLE) }),
        C(6, 3, 'Coordonnées amont (X / Y)', 'AM', { input: xy() }),
        C(6, 4, 'Coordonnées aval (X / Y)', 'AV', { input: xy() }),
        C(6, 5, 'Nombre de prélèvements Surber', 'NB', { input: num({ min: 0, step: 1 }) }),
        C(6, 6, 'Répartition des prélèvements', 'REP'),
        C(6, 7, 'Autre matériel utilisé', 'MAT'),
        C(6, 8, 'Récipients de stockage', 'REC'),
        C(6, 9, 'Nature du produit de conservation', 'CON'),
        C(6, 10, 'Traçabilité des flacons', 'TRAC'),
        C(6, 11, 'Respect des normes de prélèvement', 'NORM'),
        C(6, 12, 'Échantillons correctement identifiés', 'ID'),
        C(6, 13, 'Transport / conservation', 'TRANS', { domain: 'transport' })
      ]
    },

    /* ---------- Feuille 7 : diatomées – IDGF ---------- */
    {
      id: 's-F7-idgf', sheet: 7, no: '', title: 'Diatomées – IDGF', columns: 'full', domain: 'prelevement', condition: ONLY('diatomees'),
      items: [
        C(7, 1, 'Agent prestataire & fonction', 'Agent'),
        C(7, 2, 'Fiche terrain complétée', 'Fiche OK', { input: select(OUI_NON_PARTIELLE) }),
        C(7, 3, 'Coordonnées', 'Coord. terrain', { input: xy() }),
        C(7, 4, 'Nature du substrat échantillonné', 'Substrat'),
        C(7, 5, 'Matériel d’échantillonnage', 'Matériel'),
        C(7, 6, 'Nombre de blocs échantillonnés', 'Nb blocs', { input: num({ min: 0, step: 1 }) }),
        C(7, 7, 'Prélèvements en doublon', 'Doublon', { input: select(OUI_NON) }),
        C(7, 8, 'Autre matériel utilisé', 'Autre mat.'),
        C(7, 9, 'Récipients de stockage', 'Récipients'),
        C(7, 10, 'Nature du produit de conservation', 'Conservation'),
        C(7, 11, 'Traçabilité des flacons', 'Traçabilité'),
        C(7, 12, 'Respect des normes de prélèvement', 'Normes'),
        C(7, 13, 'Conditionnement / transport', 'Transport', { domain: 'transport' }),
        C(7, 14, 'Autre point à préciser', 'Autre', { required: false })
      ]
    },

    /* ---------- Feuille 8 : ichtyologie (A) et mercure dans le biote (B) ---------- */
    {
      id: 's-F8-A', sheet: 8, no: 'A', title: 'Ichtyologie', theme: 'ocean', kicker: 'Suivi biologique des eaux douces de Guyane', icon: 'fish', icons: ['fish'],
      columns: 'full', domain: 'prelevement', condition: ONLY('poissons'), headers: { label: 'Paramètre / information' },
      items: [
        C(8, 'A1', 'Agent prestataire & fonction', 'A1', { icon: 'person' }),
        C(8, 'A2', 'Filets maillants / batteries', 'A2', { icon: 'net' }),
        C(8, 'A3', 'Mailles utilisées', 'A3', { icon: 'grid' }),
        C(8, 'A4', 'Heure de pose', 'A4', { icon: 'clock', input: { type: 'time' } }),
        C(8, 'A5', 'Heure de relève', 'A5', { icon: 'clock', input: { type: 'time' } }),
        C(8, 'A6', 'État des filets', 'A6', { icon: 'gear' }),
        C(8, 'A7', 'Géoréférencement', 'A7', { icon: 'pin', input: xy() }),
        C(8, 'A8', 'Biométrie / identification', 'A8', { icon: 'ruler' }),
        C(8, 'A9', 'Fiche terrain complétée', 'A9', { icon: 'doc' }),
        C(8, 'A10', 'Conditionnement', 'A10', { icon: 'box' })
      ]
    },
    {
      id: 's-F8-B', sheet: 8, no: 'B', title: 'Mercure / biote', theme: 'rust', kicker: 'Contaminants dans les milieux aquatiques', icon: 'fish', icons: ['fish', 'drop'],
      columns: 'full', domain: 'prelevement', condition: ONLY('poissons'), headers: { label: 'Paramètre / information' },
      items: [
        C(8, 'B1', 'Nombre d’individus retenus', 'B1', { icon: 'fish', input: num({ min: 0, step: 1 }) }),
        C(8, 'B2', 'Espèces retenues', 'B2', { icon: 'fishes' }),
        C(8, 'B3', 'Critères de sélection', 'B3', { icon: 'search' }),
        C(8, 'B4', 'Étiquetage / traçabilité', 'B4', { icon: 'tag' }),
        C(8, 'B5', 'Conservation', 'B5', { icon: 'snowflake' }),
        C(8, 'B6', 'Glacière / température', 'B6', { icon: 'cooler' }),
        C(8, 'B7', 'Expédition / remise au laboratoire', 'B7', { icon: 'truck', domain: 'transport' })
      ]
    },

    /* ---------- Feuille 9 : phytoplancton d'eau douce ---------- */
    {
      id: 's-F9-phyto', sheet: 9, no: '', title: 'Phytoplancton d’eau douce', columns: 'full', domain: 'prelevement', condition: ONLY('phytoplancton'),
      headers: { no: '#', label: 'Élément à contrôler', short: 'Réf.', value: 'Valeur / Réponse', obs: 'Observations (commentaires, précisions, anomalies)' },
      items: [
        C(9, 1, 'Agent prestataire & fonction', 'A1', { icon: 'person', input: { type: 'fields', fields: [{ key: 'nom', label: 'Nom', type: 'text' }, { key: 'fonction', label: 'Fonction', type: 'text' }] } }),
        C(9, 2, 'Fiche terrain complétée', 'A2', { icon: 'clipboard', input: choice(OUI_NON_PARTIELLE) }),
        C(9, 3, 'Coordonnées du point', 'A3', { icon: 'pin', input: xy() }),
        C(9, 4, 'Type de prélèvement', 'A4', { icon: 'bottle', input: choice(['Intégré', 'Ponctuel', 'Autre'], [other()]) }),
        C(9, 5, 'Volume prélevé', 'A5', { icon: 'beaker', input: { type: 'fields', fields: [{ key: 'volume', label: 'Volume', type: 'number', min: 0, unitKey: 'unite' }, { key: 'unite', label: 'Unité', type: 'choice', options: ['mL', 'L'] }] } }),
        C(9, 6, 'Nombre de prélèvements / doublons', 'A6', { icon: 'bottles', input: { type: 'fields', fields: [{ key: 'prelevements', label: 'Prélèvements', type: 'number', min: 0, step: 1 }, { key: 'doublons', label: 'Doublons', type: 'number', min: 0, step: 1 }] } }),
        C(9, 7, 'Homogénéisation', 'A7', { icon: 'refresh', input: choice(['Oui', 'Non', 'Sans objet']) }),
        C(9, 8, 'Flaconnage adapté', 'A8', { icon: 'bottle', input: choice(['Oui', 'Non', 'Autre'], [other()]) }),
        C(9, 9, 'Produit de conservation', 'A9', { icon: 'drop', input: choice(['Lugol', 'Autre', 'Aucun'], [other()]) }),
        C(9, 10, 'Traçabilité des flacons', 'A10', { icon: 'barcode', input: choice(OUI_NON_PARTIELLE) }),
        C(9, 11, 'Stockage / glacière', 'A11', { icon: 'snowflake', input: choice(OUI_NON, [{ key: 't', label: 'T° (si disponible)', type: 'number', unit: '°C', step: 0.1 }]) }),
        C(9, 12, 'Respect des normes de prélèvement', 'A12', { icon: 'check', input: choice(['Oui', 'Non', 'Écart(s)'], [other('Écart(s)', 'Écart(s)')]) }),
        C(9, 13, 'Transport / acheminement', 'A13', { icon: 'truck', domain: 'transport', input: choice(['Glacière', 'Autre'], [other()]) })
      ]
    }
  ]
};

/* Nettoyage des critères construits par C() puis surchargés (`input: null` ⇒ statut seul, sans « Valeur / réponse »). */
for (const s of GRID_CT_2026.sections) for (const it of s.items) {
  for (const k of Object.keys(it)) if (it[k] === undefined || (k === 'input' && it[k] === null)) delete it[k];
}
