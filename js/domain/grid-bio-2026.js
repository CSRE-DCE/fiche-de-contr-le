/* Grille « en feuilles » du contrôle terrain prestataire HYDRECO — RCS ESC BIO 2026 (fiches 1 à 9).
 * Transcription des maquettes docs/maquettes/feuille-*.webp. Fichier pur (données uniquement).
 *
 * - `layout: 'sheets'` déclenche l'affichage en feuilles (onglets) ; les grilles générales gardent
 *   l'affichage historique par sections.
 * - Chaque section porte `sheet` (n° de feuille) ; les sections des feuilles 2 à 9 sont conditionnées
 *   par le compartiment retenu pour l'audit : `{ ctx: 'compartments', op: 'in', value: '<clé>' }`.
 * - Critère de conformité : statut C / NC / N/A + valeur facultative (`input`) + observations (`comment`).
 *   Critère « valeur seule » (repères terrain, section 1 de la feuille 2) : kinds text, date, time, select…
 * - `short` = « Référence courte » des maquettes (≠ `refs`, références documentaires).
 * - `prefill` : valeur pré-remplie une seule fois à la création de l'audit (voir prefillResponses, grids.js).
 * - `headers` (facultatif, par section) : libellés d'en-têtes de colonnes propres à la maquette
 *   (clés no, label, short, value, obs) ; valeurs par défaut : sectionHeaders() de grids.js.
 * Les numéros en double des maquettes (F3 « 16 », F4 « 16 », F9 « 12 ») sont corrigés en 17 / 17 / 13.
 */

const RESP = ['C', 'NC', 'NA'];
const ONLY = key => ({ ctx: 'compartments', op: 'in', value: key });

/** Critère de conformité (C / NC / N/A) d'une feuille, avec champ « Valeur / réponse » texte par défaut. */
const C = (sheet, no, label, short, extra = {}) => ({
  id: `it-F${sheet}-${no}`, code: `F${sheet}.${no}`, no: String(no), label, short,
  kind: 'conformity', responses: [...RESP], required: true, justifyOn: ['NC'], evidenceOnNC: false,
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

export const METEO = ['Ensoleillé', 'Nuageux', 'Couvert', 'Pluie faible', 'Pluie forte', 'Orage'];
export const NIVEAU_EAU = ['Étiage', 'Basses eaux', 'Moyennes eaux', 'Hautes eaux', 'Crue'];
const OUI_NON = ['Oui', 'Non'];
const OUI_NON_PARTIELLE = ['Oui', 'Non', 'Partielle'];

/** Appareils de mesure de la feuille 4 (module « instruments ») : stockés dans audit.sheets[4].instruments. */
export const INSTRUMENTS = [
  { key: 'ph', label: 'Sonde pH', badge: 'pH' },
  { key: 'o2', label: 'Sonde O₂', badge: 'O₂' },
  { key: 'cond', label: 'Conductivité', icon: 'list' },
  { key: 'turb', label: 'Turbidimètre', icon: 'sun' }
];
export const INSTRUMENT_FIELDS = [
  { key: 'model', label: 'Marque / modèle', type: 'text' },
  { key: 'serial', label: 'N° de série', type: 'text' },
  { key: 'calibration', label: 'Dernière calibration', type: 'date' }
];

const SIGN = ['controller', 'date', 'signature'];

export const GRID_BIO_2026 = {
  id: 'grid-ct-bio-2026-v1',
  code: 'CT-BIO-2026',
  version: '1.0',
  status: 'publiee',
  publishedAt: '2026-10-01T00:00:00.000Z',
  name: 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026',
  layout: 'sheets',
  description: 'Fiches de contrôle terrain des prestations HYDRECO du réseau de contrôle de surveillance biologique (RCS ESC BIO 2026) : fiche station, organisation et sécurité, caractérisation de la station, physico-chimie in situ et prélèvement, invertébrés (PEZADA), diatomées (IDGF), ichtyologie et mercure, phytoplancton. Les feuilles affichées dépendent des compartiments retenus pour la station.',
  scope: { providerIds: ['prov-HYDRECO'], samplingTypeIds: ['stype-HYDROBIO', 'stype-PC'], matrixIds: [], protocolDocKeys: [], cctpDocKeys: [], environments: [] },
  settings: { gpsThresholdM: 300, transportMaxHours: 24, calibrationMaxDays: 30 },
  header: {
    org: 'Office de l’Eau de Guyane', title: 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026',
    subtitle: 'Fiche station de contrôle terrain', tagline: 'L’eau au service des milieux naturels de Guyane',
    program: 'Suivi biologique des eaux douces de surface de Guyane',
    slogan: 'La connaissance aujourd’hui pour les rivières de demain', website: 'www.eauguyane.fr'
  },
  compartments: [
    { key: 'organisation', label: 'Organisation / sécurité / traçabilité', icon: 'gear', always: true },
    { key: 'physico', label: 'Physico-chimie in situ et prélèvement eau', icon: 'drop' },
    { key: 'invertebres', label: 'Invertébrés aquatiques – PEZADA', icon: 'bug' },
    { key: 'diatomees', label: 'Diatomées – IDGF', icon: 'diatom' },
    { key: 'poissons', label: 'Ichtyologie et mercure dans le biote', icon: 'fish' },
    { key: 'phytoplancton', label: 'Phytoplancton d’eau douce', icon: 'algae' }
  ],
  sheets: [
    { no: 1, key: 'station', tab: 'Station', title: 'Fiche station de contrôle terrain', kicker: 'Suivi biologique des eaux douces de surface de Guyane', theme: 'ocean', compartment: 'organisation', layout: 'station', blocks: [], modules: [] },
    { no: 2, key: 'organisation', tab: 'Organisation', title: 'Organisation, sécurité et déroulé de mission', kicker: '', theme: 'navy', compartment: 'organisation', layout: 'table', modules: [],
      blocks: [{ key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'chat' }] },
    { no: 3, key: 'caracterisation', tab: 'Caractérisation', title: 'Prise d’informations de terrain – caractérisation de la station', kicker: 'Prise d’informations de terrain – caractérisation de la station', theme: 'green', compartment: 'organisation', layout: 'table', modules: [],
      blocks: [{ key: 'observations', title: 'Observations générales et non-conformités', icon: 'chat' }, { key: 'photos', title: 'Prise de photos / références / commentaires', icon: 'camera' }] },
    { no: 4, key: 'pc-insitu', tab: 'PC in situ', title: 'Physico-chimie, mesures in situ et flaconnage', kicker: '', theme: 'peach', compartment: 'physico', layout: 'table',
      modules: ['instruments'], instruments: INSTRUMENTS, instrumentFields: INSTRUMENT_FIELDS,
      blocks: [
        { key: 'observations', title: 'Observations / non-conformités / actions demandées :', icon: 'chat' },
        { key: 'conclusion', title: 'Conclusion générale', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['AC', 'À compléter']], fields: SIGN }
      ] },
    { no: 5, key: 'pc-prelevement', tab: 'PC prélèvement', title: 'Physico-chimie – prélèvement, conditionnement et chaîne du froid', kicker: '', theme: 'orange', compartment: 'physico', layout: 'table', modules: [], mergeSections: true,
      blocks: [
        { key: 'notes', title: 'Remarques générales / Notes', icon: 'edit' },
        { key: 'conclusion', title: 'Conclusion du contrôle', icon: 'check', options: [['C', 'Conforme (C)'], ['NC', 'Non conforme (NC)'], ['NA', 'Non applicable (N/A)'], ['RES', 'À compléter / Réserve']], fields: SIGN }
      ] },
    { no: 6, key: 'pezada', tab: 'Invertébrés', title: 'Invertébrés aquatiques – protocole PEZADA', kicker: 'Suivi biologique des eaux douces de surface de Guyane', theme: 'violet', compartment: 'invertebres', layout: 'table', modules: [],
      blocks: [
        { key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'edit' },
        { key: 'conclusion', title: 'Conclusion du contrôle', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['NA', 'Non applicable']], fields: ['comments', 'date', 'controller', 'signature', 'providerSignature'] }
      ] },
    { no: 7, key: 'idgf', tab: 'Diatomées', title: 'Diatomées – IDGF', kicker: 'Fiche de contrôle terrain – Diatomées – IDGF', theme: 'sky', compartment: 'diatomees', layout: 'table', modules: [],
      blocks: [
        { key: 'observations', title: 'Observations générales', icon: 'chat' },
        { key: 'conclusion', title: 'Conclusion du contrôle terrain', icon: 'check', options: [['C', 'Conforme'], ['NC', 'Non conforme'], ['NA', 'Non applicable']], fields: ['comments', 'controller', 'date', 'signature'] }
      ] },
    { no: 8, key: 'ichtyo-mercure', tab: 'Poissons', title: 'Ichtyologie et mercure dans le biote', kicker: 'Suivi biologique des eaux douces de Guyane', theme: 'ocean', compartment: 'poissons', layout: 'split', modules: [],
      blocks: [{ key: 'observations', title: 'Observations / non-conformités / actions demandées', icon: 'clipboard' }] },
    { no: 9, key: 'phyto', tab: 'Phytoplancton', title: 'Phytoplancton d’eau douce', kicker: 'Phytoplancton d’eau douce', theme: 'teal', compartment: 'phytoplancton', layout: 'table', modules: [],
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
        V(1, 'R2', 'Heure', '', 'time', { prefill: 'audit.time' }),
        V(1, 'R3', 'Contrôleur OEG', '', 'text', { prefill: 'auditor.name' }),
        V(1, 'R4', 'Opérateurs HYDRECO', '', 'text', { prefill: 'prestation.operators' }),
        V(1, 'R5', 'Météo', '', 'select', { options: [...METEO] }),
        V(1, 'R6', 'Niveau d’eau', '', 'select', { options: [...NIVEAU_EAU] }),
        V(1, 'R7', 'Observations', '', 'longtext')
      ]
    },

    /* ---------- Feuille 2 : organisation, sécurité et déroulé de mission ---------- */
    {
      id: 's-F2-1', sheet: 2, no: '1', title: 'Identification mission', columns: 'value', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        V(2, '1.1', 'Agent(s) OEG', 'OEG', 'text', { prefill: 'auditor.name', required: true }),
        V(2, '1.2', 'Structure accompagnatrice', 'Structure', 'text'),
        V(2, '1.3', 'Agent(s) accompagnateur(s)', 'Accompagnateurs', 'text'),
        V(2, '1.4', 'Date mission', 'Date', 'date', { prefill: 'audit.date', required: true }),
        V(2, '1.5', 'Heure début', 'Hdébut', 'time', { prefill: 'audit.time' }),
        V(2, '1.6', 'Heure fin', 'Hfin', 'time'),
        V(2, '1.7', 'Moyens OEG', 'Moyens', 'text'),
        V(2, '1.8', 'Niveau d’eau', 'Niveau', 'select', { options: [...NIVEAU_EAU] }),
        V(2, '1.9', 'Conditions météo', 'Météo', 'select', { options: [...METEO] }),
        V(2, '1.10', 'Difficulté d’accès', 'Accès', 'text')
      ]
    },
    {
      id: 's-F2-2', sheet: 2, no: '2', title: 'Prestataires et équipe', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '2.1', 'Identification des prestataires', 'Prestataires', { prefill: 'provider.name' }),
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
        C(2, '3.4', 'Conformité et sécurité', 'Conformité')
      ]
    },
    {
      id: 's-F2-4', sheet: 2, no: '4', title: 'EPI (Équipements de protection individuelle)', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '4.1', 'Tenue adaptée', 'Tenue'),
        C(2, '4.2', 'EPI navigation présents', 'EPI nav. présents'),
        C(2, '4.3', 'Port des EPI navigation', 'EPI nav. portés'),
        C(2, '4.4', 'Port des EPI prélèvements', 'EPI prél. portés'),
        C(2, '4.5', 'Rappels EPI', 'Rappels')
      ]
    },
    {
      id: 's-F2-5', sheet: 2, no: '5', title: 'Planning et déroulé de mission', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      items: [
        C(2, '5.1', 'Jour', 'Jour', { input: { type: 'date' } }),
        C(2, '5.2', 'Heure début', 'Hdébut', { input: { type: 'time' } }),
        C(2, '5.3', 'Heure fin', 'Hfin', { input: { type: 'time' } }),
        C(2, '5.4', 'Description des étapes de la mission', 'Déroulé', { input: { type: 'longtext' } })
      ]
    },

    /* ---------- Feuille 3 : caractérisation de la station ---------- */
    {
      id: 's-F3-infos', sheet: 3, no: '', title: 'Prise d’informations de terrain', columns: 'full', domain: 'prelevement', condition: ONLY('organisation'),
      headers: { label: 'Information' },
      items: [
        C(3, 1, 'Nom du bassin versant', 'BV', { prefill: 'site.bassin' }),
        C(3, 2, 'Nom du cours d’eau', 'CE', { prefill: 'site.riverName' }),
        C(3, 3, 'Nom de la station', 'STA', { prefill: 'site.name' }),
        C(3, 4, 'Code SANDRE station', 'SANDRE', { prefill: 'site.code' }),
        C(3, 5, 'Rang de Strahler', 'STR', { prefill: 'site.strahler' }),
        C(3, 6, 'Pression (RCO)', 'RCO', { prefill: 'site.pressions' }),
        C(3, 7, 'Conditions météo', 'METEO'),
        C(3, 8, 'Physico-chimie générale', 'PHYC'),
        C(3, 9, 'Commune', 'COM', { prefill: 'site.commune' }),
        C(3, 10, 'Hydro-écorégion', 'HER', { prefill: 'site.her' }),
        C(3, 11, 'Schéma général des habitats', 'HAB'),
        C(3, 12, 'Membres de l’équipe', 'EQUIPE', { prefill: 'prestation.operators' }),
        C(3, 13, 'Protocoles utilisés', 'PROTO'),
        C(3, 14, 'Date des prélèvements', 'DATE', { input: { type: 'date' } }),
        C(3, 15, 'Coordonnées GPS des points de prélèvement', 'GPS', { input: xy() }),
        C(3, 16, 'Prise de photos', 'PHOTO'),
        C(3, 17, 'Station représentative de la ME', 'REP_ME', { input: select(['Oui', 'Non', 'Partiellement']) })
      ]
    },

    /* ---------- Feuille 4 : physico-chimie, mesures in situ et flaconnage ---------- */
    {
      id: 's-F4-controle', sheet: 4, no: '', title: 'Contrôle terrain – Physico-chimie, mesures in situ et flaconnage', icon: 'clipboard', columns: 'full', domain: 'prelevement', condition: ONLY('physico'),
      headers: { short: 'Réf.' },
      items: [
        C(4, 1, 'Préleveur(s) / fonction', 'PV'),
        C(4, 2, 'Calibration des sondes', 'CAL'),
        C(4, 3, 'Respect des normes de mesure', 'NORME'),
        C(4, 4, 'pH (in situ)', 'pH', { input: num({ unit: 'unité pH', min: 0, max: 14, step: 0.01 }) }),
        C(4, 5, 'Oxygène dissous (in situ)', 'O2', { input: num({ unit: 'mg/L', min: 0, step: 0.01 }) }),
        C(4, 6, 'Saturation en O₂ (in situ)', 'SatO2', { input: num({ unit: '%', min: 0, step: 0.1 }) }),
        C(4, 7, 'Température eau (in situ)', 'T°', { input: num({ unit: '°C', step: 0.1 }) }),
        C(4, 8, 'Conductivité (in situ)', 'Cond', { input: num({ unit: 'µS/cm', min: 0, step: 0.1 }) }),
        C(4, 9, 'Turbidité (in situ, triplicat)', 'Turb', { input: { type: 'fields', fields: [1, 2, 3].map(n => ({ key: 't' + n, label: 'Mesure ' + n, type: 'number', unit: 'FNU', min: 0, step: 0.01 })) } }),
        C(4, 10, 'Salinité (si applicable)', 'Sal', { input: num({ min: 0, step: 0.01 }) }),
        C(4, 11, 'Position de mesure', 'Pos'),
        C(4, 12, 'Flaconnage conforme', 'Flac'),
        C(4, 13, 'Présence ou ajout de réactif', 'Réactif'),
        C(4, 14, 'Flaconnage supplémentaire', 'Sup'),
        C(4, 15, 'Casse de flaconnage', 'Casse'),
        C(4, 16, 'Transport adapté du flaconnage', 'Transp'),
        C(4, 17, 'Rinçage des flacons', 'Rinçage')
      ]
    },

    /* ---------- Feuille 5 : physico-chimie – prélèvement, conditionnement et chaîne du froid ---------- */
    {
      id: 's-F5-prelevement', sheet: 5, no: '', title: 'Prélèvement', columns: 'full', domain: 'prelevement', condition: ONLY('physico'),
      items: [
        C(5, 1, 'Lieu de prélèvement', 'Lieu'),
        C(5, 2, 'EPI pendant le prélèvement', 'EPI'),
        C(5, 3, 'Matériel intermédiaire', 'Matériel'),
        C(5, 4, 'Prélèvement face au courant', 'Face courant'),
        C(5, 5, 'Prélèvement en sub-surface', 'Sub-surface'),
        C(5, 6, 'Distance à la berge', 'Distance', { input: num({ unit: 'm', min: 0, step: 0.1 }) }),
        C(5, 7, 'Sources de contamination', 'Contamination'),
        C(5, 8, 'Moyens d’évitement', 'Évitement'),
        C(5, 9, 'Rinçage du matériel', 'Rinçage'),
        C(5, 10, 'Nombre de flacons', 'Nb flacons', { input: num({ min: 0, step: 1 }) })
      ]
    },
    {
      id: 's-F5-transport', sheet: 5, no: '', title: 'Conditionnement et chaîne du froid', columns: 'full', domain: 'transport', condition: ONLY('physico'),
      items: [
        C(5, 11, 'Type / nombre de glacières', 'Glacières'),
        C(5, 12, 'Pré-réfrigération', 'Pré-réfrig.'),
        C(5, 13, 'Température de conservation', 'T° conservation', {
          input: num({ unit: '°C', step: 0.1 }),
          alerts: [{ op: 'outside', value: [2, 8], level: 'attention', code: 'TEMP_CONSERVATION', title: 'Température de conservation {value} °C', message: 'Température hors de la plage 5 ± 3 °C (NF EN ISO 5667-3)', requirement: 'Conservation des échantillons à 5 ± 3 °C (NF EN ISO 5667-3)', typeCode: 'TRANSPORT' }]
        }),
        C(5, 14, 'Réfrigérant / glace', 'Réfrigérant'),
        C(5, 15, 'Thermobouton / traceur', 'Thermobouton'),
        C(5, 16, 'Positionnement du thermobouton', 'Position'),
        C(5, 17, 'Lieu de stockage intermédiaire', 'Stockage (lieu)'),
        C(5, 18, 'Moyen de stockage intermédiaire', 'Stockage (moyen)')
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
