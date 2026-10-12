/* Profils et matrice des droits — partagés par l'application (affichage, contrôles locaux) et par le
 * serveur de synchronisation (contrôle effectif des écritures) ; contrôleurs OEG d'une tournée (binôme) et droit
 * de saisie dans une tournée. Fichier pur. */
export const ROLES = {
  admin: 'Administrateur',
  rq: 'Responsable qualité',
  superviseur: 'Superviseur',
  auditeur: 'Auditeur',
  consultation: 'Consultation'
};

export const PERMISSIONS = {
  'audit.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.edit': ['admin', 'rq', 'superviseur', 'auditeur'],
  'audit.editOthers': ['admin', 'rq', 'superviseur'],
  'audit.amend': ['admin', 'rq'],                 // modification d'un audit signé (avec motif)
  'audit.delete': ['admin', 'rq'],                // abandon d'un audit non signé
  'deviation.manage': ['admin', 'rq', 'superviseur', 'auditeur'],
  'deviation.close': ['admin', 'rq', 'superviseur'],
  'observation.create': ['admin', 'rq', 'superviseur', 'auditeur'],
  'planning.manage': ['admin', 'rq', 'superviseur'],
  'ref.manage': ['admin', 'rq'],                  // référentiels, documents, grilles
  'trail.view': ['admin', 'rq', 'superviseur'],
  'users.manage': ['admin'],
  'devices.manage': ['admin'],
  'settings.manage': ['admin'],
  'export': ['admin', 'rq', 'superviseur', 'auditeur', 'consultation']
};

export function roleCan(role, perm) { return (PERMISSIONS[perm] || []).includes(role); }

/* ---------- Contrôleurs OEG d'une tournée (binôme sur une tablette partagée) ---------- */
/**
 * Identifiants des contrôleurs OEG de la tournée, dans l'ordre : audit.controllerIds ; audit antérieur sans
 * contrôleurs enregistrés : son auteur (auditorId).
 */
export function auditControllerIds(audit) {
  const ids = Array.isArray(audit?.controllerIds) ? [...new Set(audit.controllerIds.filter(Boolean))] : [];
  return ids.length ? ids : audit?.auditorId ? [audit.auditorId] : [];
}
/**
 * Contrôleurs [{ id, name }] : nom enregistré dans la tournée (audit.controllerNames : { id: nom }), à défaut
 * `names` ({ id: nom }, ex. profils des agents), à défaut le nom de l'auteur de la tournée.
 */
export function auditControllers(audit, names = {}) {
  return auditControllerIds(audit).map(id => ({
    id, name: audit?.controllerNames?.[id] || names?.[id] || (id === audit?.auditorId ? audit?.auditorName : '') || ''
  }));
}
/** Noms des contrôleurs séparés par des virgules (« A. Dupont, B. Martin ») : pré-remplissages, fiches, rapports. */
export function controllerNamesText(audit, names = {}) {
  return auditControllers(audit, names).map(c => c.name).filter(Boolean).join(', ');
}
export function isAuditController(audit, userId) { return !!userId && auditControllerIds(audit).includes(userId); }

/**
 * Droit de saisir dans une tournée (fonction pure) : profil autorisé à réaliser des audits ET contrôleur de la
 * tournée, ou encadrement (audit.editOthers). Tournée verrouillée (signée) : jamais (modification motivée à part).
 */
export function canEditAuditAs(audit, user) {
  if (!audit || !user) return false;
  if (audit.lock?.lockedAt) return false;
  if (!roleCan(user.role, 'audit.edit')) return false;
  return isAuditController(audit, user.id) || roleCan(user.role, 'audit.editOthers');
}
/**
 * L'agent peut-il rejoindre la tournée (bandeau « Rejoindre la tournée ») ? Profil autorisé à réaliser des audits,
 * pas encore contrôleur, tournée ni verrouillée, ni abandonnée, ni déjà signée par un contrôleur (sa signature
 * couvre la liste des contrôleurs).
 */
export function canJoinAudit(audit, user) {
  if (!audit || !user || !roleCan(user.role, 'audit.edit')) return false;
  if (audit.lock?.lockedAt || audit.status === 'abandonne' || audit.status === 'signe' || audit.signatures?.auditor) return false;
  return !isAuditController(audit, user.id);
}

/* ---------- Identité des agents (profils « user ») ---------- */
const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
/** Initiales d'un agent : celles du profil, à défaut prénom + nom, à défaut les deux premiers mots du nom. */
export function agentInitials(u) {
  const own = String(u?.initials || '').trim();
  if (own) return own.toUpperCase().slice(0, 4);
  const first = s => plain(s).replace(/[^A-Za-z]/g, '').charAt(0);
  if (u?.firstName || u?.lastName) return (first(u.firstName) + first(u.lastName)).toUpperCase() || '?';
  const words = String(u?.name || u?.username || '').split(/[\s-]+/).filter(Boolean);
  return words.map(w => first(w)).join('').slice(0, 2).toUpperCase() || '?';
}
/** Nom affiché d'un agent : « Prénom Nom ». */
export const agentFullName = (firstName, lastName) => [firstName, lastName].map(s => String(s || '').trim()).filter(Boolean).join(' ');
/** Identifiant proposé pour un nouvel agent : initiale du prénom + nom, sans accents ni espaces (« Chloé Petit » → cpetit). */
export function suggestUsername(firstName, lastName) {
  const f = plain(firstName).toLowerCase().replace(/[^a-z0-9]/g, '').charAt(0);
  const l = plain(lastName).toLowerCase().replace(/[^a-z0-9]/g, '');
  return (f + l) || l || f;
}

export const REFERENTIAL_TYPES = ['provider', 'operator', 'site', 'point', 'equipment', 'samplingType', 'matrix', 'method', 'unit', 'criticality', 'deviationType', 'container', 'campaign', 'document', 'grid'];

/** Droit requis pour enregistrer un objet d'un type donné (null = refusé, '*' = tout profil). */
export function writePermission(type) {
  if (REFERENTIAL_TYPES.includes(type)) return ['ref.manage'];
  switch (type) {
    case 'trail': return '*';
    case 'media': return ['observation.create', 'ref.manage', 'audit.edit'];
    case 'audit': return ['audit.edit'];
    case 'deviation': return ['deviation.manage'];
    case 'observation': case 'alert': return ['observation.create'];
    case 'prestation': return ['planning.manage', 'audit.edit'];
    case 'importBatch': case 'importSource': return ['planning.manage', 'ref.manage'];
    case 'setting': return ['settings.manage'];
    default: return null;
  }
}
export function canWrite(role, type) {
  const p = writePermission(type);
  if (p === '*') return true;
  if (!p) return false;
  return p.some(x => roleCan(role, x));
}
