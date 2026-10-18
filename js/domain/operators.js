/* Opérateurs des prestataires (« Préleveurs du prestataire ») : identité, initiales, identifiant et dédoublonnage —
 * fonctions pures (tests unitaires), utilisées par l'ajout d'un opérateur depuis la création de tournée ou la feuille
 * Organisation (F2) d'une tournée (js/app/operators.js).
 * Règles :
 *  - un opérateur est rattaché à UN prestataire ; ses initiales (1 à 4 lettres ou chiffres, en capitales) sont uniques
 *    chez ce prestataire, sans tenir compte de la casse (« FCh » et « FCH » sont les mêmes initiales) ;
 *  - identifiant DÉTERMINISTE « op-<code du prestataire>-<INITIALES> » (même schéma que le référentiel installé,
 *    js/domain/seed.js) : deux tablettes qui ajoutent la même personne produisent le même identifiant, fusionné à
 *    l'échange de fichiers ;
 *  - ajout d'une personne déjà connue : jamais de doublon — opérateur du référentiel connu seulement par ses initiales
 *    (« NB ») : son identité est complétée ; même identité : l'existant est repris ; mêmes initiales mais autre
 *    personne, ou même nom et prénom avec d'autres initiales : l'existant est proposé. */

const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
/** Texte de comparaison : sans accents, casse, ponctuation ni espaces multiples. */
const key = s => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Initiales saisies → capitales sans accents, lettres et chiffres seulement, 4 caractères au plus. */
export const normInitials = s => plain(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
/** Initiales proposées pour un nom et un prénom (« Nadia » « Bernard » → « NB » ; nom composé : première lettre de chaque partie du prénom). */
export function suggestOperatorInitials(firstName, lastName) {
  const first = plain(firstName).split(/[\s-]+/).filter(Boolean).map(w => w[0]).join('');
  const last = plain(lastName).replace(/[^A-Za-z]/g, '').charAt(0);
  return normInitials(first + last);
}
/** Nom et prénom mis en forme (« bernard » → « Bernard », « LE GOFF » conservé en capitales). */
export const tidyName = s => String(s ?? '').trim().replace(/\s+/g, ' ');

/** Code du prestataire dans l'identifiant d'un opérateur (provider.code, à défaut l'identifiant sans « prov- »). */
export const providerCode = provider => String(provider?.code || String(provider?.id || '').replace(/^prov-/, '') || 'PREST').replace(/[^\w-]+/g, '_');
/** Identifiant déterministe d'un opérateur : « op-<code du prestataire>-<INITIALES> ». */
export const operatorId = (provider, initials) => `op-${providerCode(provider)}-${normInitials(initials)}`;

/** L'opérateur n'est-il connu que par ses initiales (référentiel repris des fiches terrain : nom = initiales, sans prénom) ? */
export function initialsOnly(o) {
  if (!o) return false;
  const last = String(o.lastName || '').trim(), first = String(o.firstName || '').trim();
  return !first && (!last || normInitials(last) === normInitials(o.code));
}
/** Même personne (nom et prénom, sans accents ni casse) ? */
export const sameIdentity = (o, { lastName, firstName }) => !!key(lastName) && key(o?.lastName) === key(lastName) && key(o?.firstName) === key(firstName);

/** « Prénom Nom (INI) » ; opérateur connu seulement par ses initiales : « INI ». */
export function operatorDisplay(o) {
  if (!o) return '';
  const name = initialsOnly(o) ? '' : [o.firstName, o.lastName].map(tidyName).filter(Boolean).join(' ');
  return name ? `${name}${o.code ? ` (${o.code})` : ''}` : (o.code || '');
}
/** « Prénom Nom (INI) — fonction » : liste des préleveurs d'une tournée (feuilles, rapports). */
export const operatorLabel = o => [operatorDisplay(o), tidyName(o?.function)].filter(Boolean).join(' — ');

/**
 * Contrôle de la saisie « + Ajouter un opérateur » : { lastName, firstName, initials, fn } nettoyés, ou erreur
 * expliquée ({ error }).
 */
export function cleanOperatorInput({ lastName = '', firstName = '', initials = '', fn = '' } = {}) {
  const out = { lastName: tidyName(lastName), firstName: tidyName(firstName), initials: normInitials(initials) || suggestOperatorInitials(firstName, lastName), fn: tidyName(fn) };
  if (!out.lastName) return { ...out, error: 'Le nom de l’opérateur est obligatoire.' };
  if (!out.firstName) return { ...out, error: 'Le prénom de l’opérateur est obligatoire.' };
  if (!out.initials) return { ...out, error: 'Les initiales de l’opérateur sont obligatoires (lettres ou chiffres, 4 au plus).' };
  return out;
}

/**
 * Décision pour l'ajout d'un opérateur chez un prestataire (sans doublon). operators : opérateurs du prestataire
 * (hors supprimés) ; input : saisie nettoyée (cleanOperatorInput). Retourne :
 *  - { action: 'create', id } : nouvel opérateur (identifiant déterministe libre) ;
 *  - { action: 'complete', operator } : opérateur connu par ses seules initiales, identité à compléter ;
 *  - { action: 'existing', operator } : même personne déjà enregistrée (mêmes initiales et même identité) ;
 *  - { action: 'propose', operator, reason } : initiales déjà prises par une autre personne, ou même nom et prénom
 *    avec d'autres initiales : l'existant est proposé (sinon, choisir d'autres initiales).
 */
export function planOperator(operators, provider, input) {
  const list = (operators || []).filter(o => o && !o._deleted && (!provider?.id || o.providerId === provider.id));
  const ini = normInitials(input.initials);
  const byInitials = list.find(o => normInitials(o.code) === ini);
  const byName = list.find(o => sameIdentity(o, input));
  const who = provider?.name || provider?.code || 'ce prestataire';
  const sameName = byName ? { action: 'propose', operator: byName, reason: `${operatorDisplay(byName)} est déjà enregistré(e) chez ${who} avec les initiales ${byName.code}.` } : null;
  if (byInitials) {
    if (sameIdentity(byInitials, input)) return { action: 'existing', operator: byInitials };
    // Même personne déjà enregistrée sous d'autres initiales : elle est proposée (jamais deux fiches pour une personne).
    if (sameName && byName.id !== byInitials.id) return sameName;
    if (initialsOnly(byInitials)) return { action: 'complete', operator: byInitials };
    return { action: 'propose', operator: byInitials, reason: `Les initiales ${ini} sont déjà celles de ${operatorDisplay(byInitials)} chez ${who}.` };
  }
  if (sameName) return sameName;
  let id = operatorId(provider, ini);
  // Identifiant déjà pris (opérateur supprimé, autre prestataire au même code) : suffixe numérique.
  for (let n = 2; (operators || []).some(o => o?.id === id && (o._deleted || o.providerId !== provider?.id)); n++) id = `${operatorId(provider, ini)}-${n}`;
  return { action: 'create', id };
}
