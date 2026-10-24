/* Opérateurs des prestataires (« Préleveurs du prestataire ») : ajout sur le terrain (« + Ajouter un opérateur » de la
 * création de tournée et de la feuille Organisation F2), sans passer par les référentiels, et préleveurs d'une tournée.
 * - Ajout : nom, prénom, initiales, fonction ; rattaché au prestataire contrôlé ; jamais de doublon (règles pures de
 *   js/domain/operators.js : identité d'un opérateur connu par ses seules initiales complétée, personne déjà connue
 *   reprise ou proposée) ; identifiant déterministe (fusion sans doublon à l'échange entre tablettes) ; tracé au
 *   journal d'audit (motif « ajouté depuis la tournée … »). Permis aux profils qui réalisent des tournées (audit.edit)
 *   comme aux profils « référentiels » (ref.manage).
 * - Préleveurs d'une tournée : audit.operatorIds (ordre d'ajout) et leurs libellés figés dans la tournée
 *   (audit.operatorNames { id: « Prénom Nom (INI) — fonction » }) : une fiche corrigée plus tard dans le référentiel ne
 *   change pas une tournée signée ; chaque ajout ou retrait passe par updateAudit (journal ; motif et amendement
 *   tracé sur une tournée signée) ; la liste est reprise dans les feuilles des stations (« Opérateurs du prestataire »
 *   de F1, puis F3.12, F4.1, F6.1, F7.1, F8.A1, F9.1 et l'encadré de F4, quand ils sont encore vides ou auto-remplis). */
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can } from '../core/auth.js';
import { nowISO, sortBy } from '../core/util.js';
import { cleanOperatorInput, planOperator, operatorDisplay, operatorLabel, normInitials, suggestOperatorInitials } from '../domain/operators.js';
import { OPERATORS_SOURCE } from '../domain/links.js';
import { updateAudit, applyLinks } from './audits.js';

export { operatorDisplay, operatorLabel };
/** Initiales proposées à partir du prénom et du nom (« Nadia » « Bernard » → « NB »). */
export const suggestInitials = suggestOperatorInitials;

/** Le profil connecté peut-il ajouter un opérateur (terrain ou référentiels) ? */
export const canAddOperator = () => can('audit.edit') || can('ref.manage');

/** Opérateurs actifs d'un prestataire, triés par initiales ; `include` : identifiants à garder même inactifs. */
export function providerOperators(providerId, { include = [] } = {}) {
  const keep = new Set(include);
  return sortBy(store.filter('operator', o => o.providerId === providerId && (o.active !== false || keep.has(o.id))), o => normInitials(o.code), 'lastName');
}

/**
 * Prépare l'ajout d'un opérateur chez un prestataire : { input (saisie nettoyée), plan (planOperator), provider } ;
 * erreur expliquée si la saisie est incomplète, le prestataire inconnu ou le profil sans droit.
 */
export function planNewOperator(providerId, raw) {
  if (!canAddOperator()) throw new Error('Votre profil ne permet pas d’ajouter un opérateur.');
  const provider = store.get('provider', providerId);
  if (!provider) throw new Error('Choisissez d’abord le prestataire contrôlé.');
  const input = cleanOperatorInput(raw);
  if (input.error) throw new Error(input.error);
  return { input, provider, plan: planOperator(store.all('operator', { withDeleted: true }), provider, input) };
}

/**
 * Enregistre l'opérateur décidé par planNewOperator (création, identité complétée, opérateur existant réactivé au
 * besoin) et retourne la fiche. `context` : texte du journal (« depuis la création de tournée », « tournée AUD-… »).
 * Un plan « propose » n'est appliqué que si l'agent a choisi l'existant (accept: true).
 */
export async function saveNewOperator({ input, provider, plan }, { context = '', accept = false } = {}) {
  const who = `${input.firstName} ${input.lastName} (${input.initials})`;
  const where = context ? ` — ${context}` : '';
  if (plan.action === 'create') {
    const op = {
      id: plan.id, providerId: provider.id, code: input.initials, lastName: input.lastName, firstName: input.firstName, function: input.fn || 'Préleveur',
      qualifications: [], active: true, notes: 'Ajouté sur le terrain (« + Ajouter un opérateur »).', createdAt: nowISO(), createdBy: session.user?.id || null, createdByName: session.user?.name || ''
    };
    await store.put('operator', op, { action: 'create', reason: `Opérateur ${who} ajouté au prestataire ${provider.name}${where}` });
    return store.get('operator', op.id);
  }
  if (plan.action === 'complete') {
    const cur = store.get('operator', plan.operator.id);
    await store.put('operator', { ...cur, lastName: input.lastName, firstName: input.firstName, function: input.fn || cur.function || 'Préleveur', active: true },
      { reason: `Identité de l’opérateur ${cur.code} complétée : ${who} (${provider.name})${where}` });
    return store.get('operator', cur.id);
  }
  if (plan.action === 'propose' && !accept) throw new Error(plan.reason);
  const cur = store.get('operator', plan.operator.id);
  if (cur.active === false) await store.put('operator', { ...cur, active: true }, { reason: `Opérateur ${operatorDisplay(cur)} réactivé (${provider.name})${where}` });
  return store.get('operator', cur.id);
}

/**
 * Ajoute (on: true) ou retire un préleveur de la tournée : audit.operatorIds et libellé figé audit.operatorNames ;
 * journal (motif obligatoire sur une tournée signée : modification tracée).
 */
export async function setTourOperator(audit, operatorId, on, { reason = null } = {}) {
  const cur = store.get('audit', audit.id);
  if (!cur) throw new Error('Tournée introuvable.');
  if (cur.status === 'abandonne') throw new Error('Tournée annulée : la liste des préleveurs ne peut plus changer.');
  const op = store.get('operator', operatorId);
  const has = (cur.operatorIds || []).includes(operatorId);
  if (on === has) return cur;
  if (on && !op) throw new Error('Opérateur introuvable sur cette tablette.');
  const label = op ? operatorDisplay(op) : cur.operatorNames?.[operatorId] || operatorId;
  return updateAudit(cur, a => {
    if (on) {
      a.operatorIds = [...(a.operatorIds || []), operatorId];
      a.operatorNames = { ...(a.operatorNames || {}), [operatorId]: operatorLabel(op) };
    } else {
      a.operatorIds = (a.operatorIds || []).filter(x => x !== operatorId);
      if (a.operatorNames) { a.operatorNames = { ...a.operatorNames }; delete a.operatorNames[operatorId]; }
    }
    // Préleveurs repris dans « Opérateurs du prestataire » (F1) de chaque station, puis F3.12, F4.1, F6.1… (links.js).
    applyLinks(a, [OPERATORS_SOURCE]);
  }, { reason: reason || `Préleveur ${label} ${on ? 'ajouté à' : 'retiré de'} la tournée ${cur.number}` });
}
