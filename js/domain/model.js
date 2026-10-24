/* Vocabulaire métier : réponses, statuts, types d'objets. Fichier pur (aucune dépendance). */

/** Réponses possibles à un critère de conformité. Grille CT-2026 : échelle C / P / NC / N/A
 * (« Perfectible » : observation obligatoire, comme pour une non-conformité). */
export const RESPONSES = {
  C: { label: 'Conforme', short: 'C', cls: 'ok', icon: '✓' },
  P: { label: 'Perfectible', short: 'P', cls: 'perf', icon: '≈' },
  NC: { label: 'Non conforme', short: 'NC', cls: 'nc', icon: '✗' },
  NA: { label: 'Non applicable', short: 'NA', cls: 'na', icon: '—' },
  NO: { label: 'Non observé', short: 'NO', cls: 'no', icon: '◌' },
  NV: { label: 'Non vérifiable', short: 'NV', cls: 'nv', icon: '?' }
};
export const DEFAULT_RESPONSES = ['C', 'NC', 'NA', 'NO'];
/** Échelle à quatre niveaux des grilles de contrôle terrain (CT-2026) et réponses exigeant une observation. */
export const SCALE_CPNC = ['C', 'P', 'NC', 'NA'];
export const JUSTIFY_CPNC = ['P', 'NC'];
/** Criticité proposée par défaut pour un écart créé depuis une réponse (jamais créé automatiquement). */
export const DEFAULT_CRITICALITY = { P: 'OBS', NC: 'MIN' };
export function defaultCriticality(status) { return DEFAULT_CRITICALITY[status] || 'MIN'; }

/** Types de tournée (grille CT-2026 : `grid.types[].key`) et types de code de station. */
export const AUDIT_TYPES = { bio: 'Hydrobiologie', ce: 'Cours d’eau', eso: 'Eaux souterraines' };
export const CODE_TYPES = { SANDRE: 'Code SANDRE', BSS: 'Code BSS' };

/** Critère « Date mission » de la feuille de tournée (grille CT-2026, F2 1.4 : pré-rempli avec la date de la tournée). */
export const TOUR_DATE_ITEM = 'it-F2-1.4';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = n => String(n).padStart(2, '0');
/**
 * Date d'un audit (AAAA-MM-JJ) — SEULE source de la date d'un audit (écrans, listes, tris, filtres, alertes,
 * exports, rapports, PDF) : « Date mission » de la feuille de tournée (F2 1.4) si elle est renseignée (valeur
 * imprimée sur les fiches, corrigeable par l'auditeur), sinon date de la tournée choisie à la création
 * (audit.date), sinon date locale de création (startedAt). '' si aucune n'est connue.
 */
export function auditDate(audit) {
  if (!audit) return '';
  const v = audit.responses?.[TOUR_DATE_ITEM]?.value;
  if (typeof v === 'string' && ISO_DAY.test(v)) return v;
  if (typeof audit.date === 'string' && ISO_DAY.test(audit.date)) return audit.date;
  const d = audit.startedAt ? new Date(audit.startedAt) : null;
  return d && !isNaN(d) ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '';
}
/** Critères « Début du contrôle » / « Fin du contrôle » de la feuille de tournée (grille CT-2026, F2 1.5 / 1.6). */
export const TOUR_START_ITEM = 'it-F2-1.5';
export const TOUR_END_ITEM = 'it-F2-1.6';
const HHMM = /^\d{2}:\d{2}/;
const clock = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; };
const dayOf = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : ''; };
/**
 * Heures d'une tournée (« HH:MM »), rapprochées de la feuille Organisation (écrans, rapport, exports) : début =
 * « Début du contrôle » (F2 1.5) s'il est renseigné, sinon heure de création de la tournée (startedAt) ; fin = « Fin du
 * contrôle » (F2 1.6), sinon heure de clôture (endedAt). { start, end, startFromSheet, endFromSheet, enteredAt (heure
 * de création), enteredDay (jour de création, AAAA-MM-JJ), closedAt (heure de clôture) }.
 */
export function auditTimes(audit) {
  const v = id => { const x = audit?.responses?.[id]?.value; return typeof x === 'string' && HHMM.test(x) ? x.slice(0, 5) : ''; };
  const s = v(TOUR_START_ITEM), e = v(TOUR_END_ITEM);
  const enteredAt = clock(audit?.startedAt), closedAt = clock(audit?.endedAt);
  return { start: s || enteredAt, end: e || closedAt, startFromSheet: !!s, endFromSheet: !!e, enteredAt, enteredDay: dayOf(audit?.startedAt), closedAt };
}
/**
 * Textes « Heure de début » / « Heure de fin » d'une tournée : « 07:45 (début du contrôle, F2.1.5) — saisie démarrée à
 * 08:02 », « 08:02 (saisie démarrée le 17/10/2026) » quand la tournée a été saisie un autre jour que sa date,
 * « 16:30 (fin du contrôle, F2.1.6) », sinon heure de clôture ou `open` (« en cours »).
 */
export function auditTimeTexts(audit, { open = 'en cours' } = {}) {
  const t = auditTimes(audit);
  const date = auditDate(audit);
  const otherDay = t.enteredDay && date && t.enteredDay !== date ? t.enteredDay.split('-').reverse().join('/') : '';
  let start = t.start;
  if (t.startFromSheet) {
    if (t.enteredAt && (otherDay || t.enteredAt !== t.start)) start += ` (début du contrôle, F2.1.5) — saisie démarrée ${otherDay ? `le ${otherDay} ` : ''}à ${t.enteredAt}`;
    else start += ' (début du contrôle, F2.1.5)';
  } else if (otherDay) start += ` (saisie démarrée le ${otherDay})`;
  let end = t.end || open;
  if (t.endFromSheet) end += t.closedAt && t.closedAt !== t.end ? ` (fin du contrôle, F2.1.6) — tournée clôturée à ${t.closedAt}` : ' (fin du contrôle, F2.1.6)';
  return { start, end };
}
/** Comparateur d'audits : date de l'audit (auditDate) la plus récente d'abord, puis création la plus récente. */
export function byAuditDateDesc(a, b) {
  return auditDate(b).localeCompare(auditDate(a)) || String(b?.startedAt || '').localeCompare(String(a?.startedAt || ''));
}

export const ITEM_KINDS = {
  conformity: 'Conformité (C / P / NC / NA / NO / NV)',
  boolean: 'Oui / Non',
  select: 'Liste de choix',
  multiselect: 'Choix multiples',
  number: 'Valeur numérique',
  text: 'Texte court',
  longtext: 'Texte libre',
  date: 'Date',
  time: 'Heure',
  datetime: 'Date et heure',
  photo: 'Photographie obligatoire',
  info: 'Information (sans réponse)'
};

/**
 * Champ « Valeur / réponse » d'un critère de conformité (`item.input`, grilles en feuilles) :
 *  {type:'text', placeholder?} · {type:'longtext'} · {type:'number', unit?, min?, max?, step?}
 *  {type:'date'} · {type:'time'} · {type:'select', options:[…]}
 *  {type:'fields', fields:[{key, label?, type, unit?, unitKey?, min?, max?, step?, options?, placeholder?, showIf?}], gps?:true}
 *    → la valeur est un OBJET {clé: valeur}. `choice` = cases exclusives ; `showIf` : champ utile seulement
 *      si value[showIf.key] === showIf.value (`value` peut être une liste : l'une des valeurs ; `showIf` peut
 *      être une liste de conditions : l'une suffit — voir fieldShown) ; `unitKey` : unité lue dans un autre champ (ex. mL / L) ;
 *      `gps: true` : le groupe contient x / y (RGFG95 / UTM 22N), le relevé GPS ajoute lat, lon, accuracy, at ; une
 *      saisie en UTM 21N garde aussi srs '21N', x21, y21 (x / y restent en 22N : js/domain/coords.js).
 * Un critère « valeur seule » n'a pas d'`input` : son `kind` (text, number, select…) en tient lieu ; un critère
 * `kind: 'fields'` (+ `fields`, `gps`) porte une valeur objet sans statut (non proposé dans l'éditeur de grilles).
 */
export const INPUT_TYPES = {
  text: 'Texte court', longtext: 'Texte libre', number: 'Valeur numérique', date: 'Date', time: 'Heure',
  select: 'Liste de choix', fields: 'Groupe de champs'
};
export const FIELD_TYPES = { text: 'Texte', number: 'Nombre', date: 'Date', time: 'Heure', choice: 'Choix exclusif' };

/** Valeurs pré-remplies à la création d'un audit (`item.prefill`) ; critères des feuilles « station » : valeurs de LA station. */
export const PREFILL_SOURCES = {
  'site.name': 'Nom de la station', 'site.code': 'Code de la station (SANDRE / BSS)', 'site.bassin': 'Bassin versant', 'site.riverName': 'Cours d’eau',
  'site.commune': 'Commune', 'site.her': 'Hydro-écorégion', 'site.pressions': 'Pressions', 'site.strahler': 'Rang de Strahler',
  'site.xy': 'Coordonnées théoriques (X / Y)', 'site.protocoleIA': 'Protocole invertébrés (PEZADA / PEZSML, d’après l’hydro-écorégion)', 'audit.date': 'Date de l’audit', 'audit.time': 'Heure de début (ou d’arrivée sur la station)',
  'audit.kind': 'Type d’audit (inopiné / avec rendez-vous)', 'tournee.stationCount': 'Nombre de stations de la tournée',
  'auditor.name': 'Nom du contrôleur', 'provider.name': 'Prestataire', 'prestation.operators': 'Opérateurs du prestataire'
};

/** Conclusion d'une feuille (choix du contrôleur, jamais automatique). Libellés propres à chaque feuille : block.options. */
export const SHEET_CONCLUSIONS = {
  C: 'Conforme', P: 'Perfectible', NC: 'Non conforme', NA: 'Non applicable', AC: 'À compléter', RES: 'Sous réserve'
};
/** Options du « Bilan – Satisfaisant ? » (fiche eaux souterraines) : conclusions des feuilles F3, F4, F5 (cours d'eau,
 * eaux souterraines) et F10. */
export const BILAN_OPTIONS = [['C', 'Satisfaisant'], ['P', 'Perfectible'], ['NC', 'Non satisfaisant']];

/** Modules spécialisés pouvant être insérés dans une section de grille. */
export const SECTION_MODULES = {
  '': 'Aucun',
  operators: 'Opérateurs contrôlés et habilitations',
  equipment: 'Équipements de mesure (identification, étalonnage, validité)',
  gps: 'Relevé GPS et contrôle de la position',
  samples: 'Traçabilité des échantillons'
};

/** Domaine d'une section : sépare clairement le contrôle du prélèvement de celui du transport. */
export const DOMAINS = {
  prelevement: 'Contrôle du prélèvement',
  transport: 'Contrôle du transport (pré-analytique)'
};

export const PROVIDER_KINDS = { regie: 'Régie', prestataire: 'Prestataire externe', partenaire: 'Partenaire' };

export const PRESTATION_STATUS = {
  prevue: { label: 'Prévue', cls: 'info' },
  realisee: { label: 'Réalisée', cls: 'ok' },
  auditee: { label: 'Auditée', cls: 'brand' },
  annulee: { label: 'Annulée', cls: 'na' },
  reportee: { label: 'Reportée', cls: 'warn' },
  non_realisee: { label: 'Non réalisée', cls: 'nc' },
  realisee_ecart: { label: 'Réalisée avec écart', cls: 'warn' }
};

export const CONTROL_LEVELS = {
  aucun: 'Aucun contrôle prévu',
  documentaire: 'Contrôle documentaire',
  partiel: 'Audit partiel',
  complet: 'Audit complet sur site',
  inopine: 'Audit inopiné'
};

/**
 * Type d'audit (audit.kind) : UN libellé partout (écrans, PDF, rapport, exports), celui de la création de tournée et
 * de F2.1.11 (« Inopiné » / « Avec rendez-vous ») — plus de « planifié » pour la même notion.
 */
export const AUDIT_KINDS = Object.freeze({ inopine: 'Inopiné', planifie: 'Avec rendez-vous' });
/** Libellé du type d'audit : « Inopiné » / « Avec rendez-vous » ; long : « Audit inopiné » / « Audit avec rendez-vous ». */
export function auditKindLabel(kind, { long = false } = {}) {
  const l = kind === 'inopine' ? AUDIT_KINDS.inopine : AUDIT_KINDS.planifie;
  return long ? `Audit ${l.charAt(0).toLowerCase()}${l.slice(1)}` : l;
}

export const AUDIT_STATUS = {
  en_cours: { label: 'En cours', cls: 'info' },
  termine: { label: 'Terminé — à signer', cls: 'warn' },
  signe: { label: 'Signé — verrouillé', cls: 'ok' },
  abandonne: { label: 'Annulée', cls: 'na' }   // « Annuler la tournée » (valeur 'abandonne' conservée : données existantes)
};

export const DEVIATION_STATUS = {
  ouvert: { label: 'Ouvert', cls: 'nc' },
  action_en_cours: { label: 'Action en cours', cls: 'warn' },
  a_verifier: { label: 'À vérifier', cls: 'info' },
  clos: { label: 'Clos', cls: 'ok' },
  annule: { label: 'Annulé', cls: 'na' }
};
export const OPEN_DEVIATION = ['ouvert', 'action_en_cours', 'a_verifier'];

export const ACTION_STATUS = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  realisee: 'Réalisée — à vérifier',
  efficace: 'Vérifiée efficace',
  inefficace: 'Vérifiée inefficace'
};

export const DOC_TYPES = {
  CCTP: 'CCTP',
  CDC: 'Cahier des charges',
  PROTOCOLE: 'Protocole',
  PROCEDURE: 'Procédure',
  MODOP: 'Mode opératoire',
  PLAN_PREL: 'Plan de prélèvement',
  PLAN_SITE: 'Plan du site',
  CONSIGNES: 'Consignes particulières',
  NORME: 'Méthode normalisée',
  REFERENTIEL: 'Référentiel qualité (ISO/IEC 17025, Cofrac)',
  REGLEMENTATION: 'Exigence réglementaire',
  AUTRE: 'Autre'
};
export const DOC_STATUS = {
  brouillon: { label: 'Brouillon', cls: 'na' },
  en_vigueur: { label: 'En vigueur', cls: 'ok' },
  remplace: { label: 'Remplacé', cls: 'warn' },
  archive: { label: 'Archivé', cls: 'na' }
};

export const EQUIPMENT_STATUS = {
  service: 'En service',
  verification: 'En attente de vérification',
  reparation: 'En réparation',
  hors_service: 'Hors service',
  reforme: 'Réformé'
};

export const QUALIFICATION_TYPES = {
  habilitation: 'Habilitation',
  qualification: 'Qualification',
  formation: 'Formation',
  autorisation: 'Autorisation',
  experience: 'Expérience'
};

export const OBSERVATION_KINDS = { observation: 'Observation terrain', urgence: 'Situation critique (urgence)' };
export const EMERGENCY_CATEGORIES = ['Risque pour la sécurité', 'Contamination des échantillons', 'Pollution constatée sur le milieu', 'Échantillons compromis', 'Accident / incident', 'Prestation non conforme grave', 'Autre'];

export const ALERT_LEVELS = {
  critique: { label: 'Critique', cls: 'nc', rank: 3 },
  attention: { label: 'Attention', cls: 'warn', rank: 2 },
  info: { label: 'Information', cls: 'info', rank: 1 }
};

/**
 * Description du champ de saisie d'un critère : `item.input` s'il existe (critère de conformité des
 * grilles en feuilles), sinon déduite du `kind` (critère « valeur seule » ou grilles générales).
 * Retourne null pour un critère de conformité sans valeur (statut seul).
 */
export function itemInput(item) {
  if (!item) return null;
  if (item.input) return item.input;
  if (item.kind === 'conformity' || item.kind === 'info' || item.kind === 'photo') return null;
  if (item.kind === 'fields') return { type: 'fields', fields: item.fields || [], gps: !!item.gps };
  const spec = { type: item.kind, options: item.options, unit: item.unit, min: item.min, max: item.max, step: item.step };
  if (item.placeholder) spec.placeholder = item.placeholder;
  return spec;
}

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
/**
 * Le champ d'un groupe est-il utile pour la valeur donnée (condition `showIf`) ?
 * showIf : {key, value} (égalité), {key, value: [...]} (l'une des valeurs) ou [{…}, {…}] (l'une des conditions).
 */
export function fieldShown(field, obj) {
  if (!field?.showIf) return true;
  const o = obj || {};
  const one = c => !c || (Array.isArray(c.value) ? c.value.includes(o[c.key]) : o[c.key] === c.value);
  return Array.isArray(field.showIf) ? field.showIf.some(one) : one(field.showIf);
}

/** Une valeur est-elle vide ? Objet « fields » : vide si aucun champ affiché n'est renseigné. */
export function isEmptyValue(item, value) {
  if (blank(value)) return true;
  if (!isPlainObject(value)) return false;
  const fields = itemInput(item)?.fields;
  if (fields?.length) return !fields.some(f => fieldShown(f, value) && !blank(value[f.key]));
  return !Object.values(value).some(v => !blank(v));
}

function frDate(v) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ' ' + m[4] : ''}` : String(v);
}
const optionLabel = (options, v) => {
  const o = (options || []).find(x => (x && typeof x === 'object' ? x.value : x) === v);
  return o && typeof o === 'object' ? (o.label ?? o.value) : v;
};
/** Valeur scalaire lisible selon la description du champ (type, unité, options). */
function scalarText(spec, v, unit) {
  const type = spec?.type || spec?.kind;
  if (type === 'boolean' || v === true || v === false) v = v === true ? 'Oui' : v === false ? 'Non' : v;
  else if (Array.isArray(v)) v = v.map(x => optionLabel(spec?.options, x)).join(', ');
  else if (type === 'number' && v !== '' && !isNaN(Number(String(v).replace(',', '.')))) v = String(v).replace('.', ',');
  else if (type === 'date' || type === 'datetime') v = frDate(v);
  else if (type === 'time') v = String(v).slice(0, 5);
  else if (type === 'select' || type === 'choice') v = optionLabel(spec?.options, v);
  const u = unit ?? spec?.unit;
  return u && type === 'number' ? `${v} ${u}` : String(v);
}

/**
 * Formatage lisible d'une valeur (tableaux, PDF, CSV, comparaison) :
 * scalaires (nombres avec unité et virgule décimale, dates JJ/MM/AAAA, Oui / Non, listes),
 * objets « fields » → « Nom : Dupont · Fonction : Chef d’équipe » (champs masqués par showIf ignorés,
 * coordonnées techniques lat / lon / précision non reprises).
 * `unit: false` : sans l'unité définie par la grille (comparaison de deux tournées dont les grilles diffèrent
 * seulement par l'unité, ex. turbidité FNU puis NTU) ; l'unité choisie à la saisie (`unitKey`) est conservée.
 * Groupe X / Y saisi en UTM 21N (`gps`, srs '21N', voir js/domain/coords.js) : X / Y convertis en UTM 22N suivis de
 * la saisie d'origine — « X : 164412 · Y : 608596 (saisi en UTM 21N : X 829310 · Y 608565) ».
 */
export function formatValue(item, value, { unit: withUnit = true } = {}) {
  if (blank(value)) return '';
  const input = itemInput(item);
  if (isPlainObject(value)) {
    const fields = input?.type === 'fields' ? input.fields || [] : [];
    if (!fields.length) return Object.entries(value).filter(([, v]) => !blank(v) && typeof v !== 'object').map(([k, v]) => `${k} : ${v}`).join(' · ');
    const used = new Set(fields.filter(f => f.unitKey && !blank(value[f.key])).map(f => f.unitKey));
    const parts = [];
    for (const f of fields) {
      if (!fieldShown(f, value) || used.has(f.key) || blank(value[f.key])) continue;
      const gridUnit = withUnit ? f.unit : '';
      let t = scalarText(f, value[f.key], f.unitKey ? (value[f.unitKey] || gridUnit) : gridUnit);
      // Choix « Autre » / « Écart(s) » suivi de sa précision : « Autre : pompe » (une seule mention).
      const detail = f.type === 'choice' && fields.find(d => !Array.isArray(d.showIf) && d.showIf?.key === f.key && d.showIf.value === value[f.key] && d.label === value[f.key] && !blank(value[d.key]));
      if (detail) { t = `${t} : ${scalarText(detail, value[detail.key])}`; used.add(detail.key); }
      parts.push(f.label ? `${f.label} : ${t}` : t);
    }
    const origin = input.gps && String(value.srs || '').toUpperCase() === '21N' && isFinite(value.x21) && isFinite(value.y21) && !blank(value.x21) && !blank(value.y21)
      ? ` (saisi en UTM 21N : X ${Math.round(Number(value.x21))} · Y ${Math.round(Number(value.y21))})` : '';
    return parts.join(' · ') + (parts.length ? origin : '');
  }
  return scalarText(input || {}, value, withUnit ? undefined : '');
}

/** Libellé lisible d'une réponse : statut · valeur. */
export function responseText(item, r) {
  if (!r) return '';
  const parts = [];
  if (r.status) parts.push(RESPONSES[r.status]?.label || r.status);
  const v = formatValue(item, r.value);
  if (v) parts.push(v);
  return parts.join(' · ');
}
