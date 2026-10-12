/* Administration : agents de la tablette et profils, appareils (désactivation d'un appareil perdu), paramètres
 * de l'organisation, données (dont la mise à niveau du référentiel) ; écran « Mon compte ».
 * Tablette partagée (deux tablettes pour quatre agents) : « Agents de cette tablette » (comptes du trousseau :
 * connexion possible ici ; nouvel agent, modifier, « Retirer de cette tablette » — entrée locale seulement) et
 * « Agents de l'équipe pas encore sur cette tablette » (profils reçus d'une autre tablette : « Ajouter sur cette
 * tablette », mot de passe choisi et saisi par l'agent, MÊME profil).
 * Mode équipe : les membres (login GitHub → profil) et les appareils sont tenus dans les fichiers
 * config/utilisateurs.json et config/appareils.json du dépôt de données (commit à chaque modification). */
import { html, raw, fmtDateTime, fmtBytes, sortBy, uuid } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { meta, destroyDB, storageEstimate } from '../core/db.js';
import { ROLES, PERMISSIONS, can, addLocalAccount, setLocalAccountDisabled, syncKeyringProfile, changePassword, knownUsers, updateDevice, isTeamMode, teamLabel, linkGithubLogin, enrollAgent, removeAgentFromDevice, assertAdminRemains, normUsername } from '../core/auth.js';
import { agentInitials, agentFullName, suggestUsername } from '../domain/permissions.js';
import { toast, openModal, formValues, promptDialog, confirmDialog } from '../ui/dom.js';
import { pageTitle, kv, badge, empty, options, field } from '../ui/components.js';
import { orgSettings, saveOrgSettings, pref, setPref, applyDisplayPrefs } from '../app/settings.js';

const PERM_LABELS = { 'audit.create': 'Créer un audit', 'audit.edit': 'Réaliser ses audits', 'audit.editOthers': 'Modifier les audits des autres', 'audit.amend': 'Modifier un audit signé (motif)', 'audit.delete': 'Abandonner un audit', 'deviation.manage': 'Enregistrer / suivre les écarts', 'deviation.close': 'Clôturer les écarts', 'observation.create': 'Observations et urgences', 'planning.manage': 'Gérer le planning et les imports', 'ref.manage': 'Gérer référentiels, documents, grilles', 'trail.view': 'Consulter le journal', 'users.manage': 'Gérer les utilisateurs', 'devices.manage': 'Gérer les appareils', 'settings.manage': 'Paramétrer l’application', export: 'Exporter' };
const SETTINGS = [
  ['orgName', 'Nom de l’organisme', 'text'], ['gpsThresholdM', 'Seuil d’alerte d’écart GPS (m)', 'number'], ['autoLockMinutes', 'Verrouillage automatique après inactivité (min)', 'number'],
  ['transportMaxHours', 'Délai maximal prélèvement → remise (h, par défaut)', 'number'], ['dateToleranceDays', 'Tolérance de date avant alerte « prestation différente » (jours)', 'number'],
  ['sampleIdPattern', 'Modèle d’identifiant d’échantillon ({AUDIT}, {SITE}, {YYYYMMDD}, {NN}, {NNN})', 'text'], ['tileUrl', 'Serveur de tuiles de carte ({z}/{x}/{y})', 'text'],
  ['tileAttribution', 'Attribution de la carte', 'text'], ['maxPreloadZoom', 'Zoom maximal de préchargement de la carte', 'number'], ['reportFooter', 'Mention de pied de page des rapports', 'text']
];

const ROLE_OPTIONS = () => Object.entries(ROLES).map(([id, label]) => ({ id, label }));
const errText = e => e?.message === 'Failed to fetch' ? 'GitHub injoignable : vérifiez la connexion réseau.' : (e?.message || String(e));

/**
 * Agent de la tablette (les deux modes) : « Ajouter un agent » = NOUVEAU profil (nom, prénom, initiales, profil,
 * identifiant proposé, mot de passe choisi et saisi deux fois par l'agent) ; modification d'un profil (nom, prénom,
 * initiales, profil, actif ; nouveau mot de passe sur cette tablette). Profil antérieur sans prénom ni nom séparés :
 * nom découpé au premier espace (prénom puis nom). Mode équipe : login GitHub facultatif (option avancée).
 * taken : identifiants déjà utilisés (trousseau et profils), pour proposer un identifiant libre.
 */
function userForm(u = null, { team = false, enrolled = true, taken = new Set() } = {}) {
  const isNew = !u;
  u = u || { username: '', name: '', role: 'auditeur', active: true };
  const words = String(u.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = u.firstName ?? (u.lastName ? '' : words[0] || '');
  const lastName = u.lastName ?? (u.firstName ? '' : words.slice(1).join(' '));
  let manualIni = !!u.initials, manualUser = !isNew;
  const freeUsername = base => { if (!base || !taken.has(base)) return base; let i = 2; while (taken.has(base + i)) i++; return base + i; };
  const m = openModal({
    title: isNew ? 'Ajouter un agent' : 'Agent ' + u.name,
    body: html`<form id="uf"><div class="grid2">
        ${field('Nom', html`<input name="lastName" value="${lastName}" required autocomplete="off" autocapitalize="words" data-input="uf-name">`, { required: true })}
        ${field('Prénom', html`<input name="firstName" value="${firstName}" required autocomplete="off" autocapitalize="words" data-input="uf-name">`, { required: true })}
        ${field('Initiales', html`<input name="initials" value="${agentInitials({ ...u, firstName, lastName })}" required maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" data-input="uf-ini">`, { required: true, hint: 'Affichées sur l’écran « Qui utilise la tablette ? ».' })}
        ${field('Profil', html`<select name="role">${options(ROLE_OPTIONS(), u.role, { placeholder: null })}</select>`, { hint: team ? 'Remplacé par le profil d’équipe si l’agent est rattaché à un login GitHub déclaré dans l’équipe.' : 'Auditeur : réalise ses tournées ; Administrateur : gère aussi les agents de la tablette.' })}
      </div>
      ${field('Identifiant', html`<input name="username" value="${u.username}" required autocapitalize="none" spellcheck="false" data-input="uf-user" ${isNew ? '' : raw('readonly')}>`, { required: true, hint: isNew ? 'Proposé à partir du prénom et du nom ; le même sur toutes les tablettes.' : 'Le même sur toutes les tablettes (non modifiable).' })}
      ${team ? html`<details><summary>Option avancée : login GitHub (mode équipe)</summary>${field('Login GitHub (facultatif)', html`<input name="githubLogin" value="${u.githubLogin || ''}" autocapitalize="none" spellcheck="false" placeholder="ex. jdupont-oeg">`, { hint: 'À laisser vide en général. Renseigné, le profil de l’agent suit config/utilisateurs.json du dépôt de l’équipe.' })}</details>` : ''}
      ${enrolled ? html`${field(isNew ? 'Mot de passe (choisi et saisi par l’agent, 8 caractères min.)' : 'Nouveau mot de passe sur cette tablette (laisser vide pour ne pas changer)', html`<input name="password" type="password" ${isNew ? raw('required minlength="8"') : ''} autocomplete="new-password">`, { required: isNew })}
      ${field(isNew ? 'Confirmation du mot de passe' : 'Confirmation du nouveau mot de passe', html`<input name="password2" type="password" ${isNew ? raw('required') : ''} autocomplete="new-password">`, { required: isNew })}` : html`<p class="note">Agent pas encore sur cette tablette : pour qu’il puisse s’y connecter, utilisez « Ajouter sur cette tablette » (il choisira son mot de passe).</p>`}
      <label class="check"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Compte actif${team ? ' (désactivé : sur toutes les tablettes, après synchronisation)' : ' (désactivé : l’agent ne peut plus ouvrir de session)'}</label>
      <p class="note">${isNew ? 'À faire avec l’agent : c’est lui qui choisit et saisit son mot de passe. Il pourra ouvrir une session sur cette tablette ; pour l’autre tablette, une fois les données de celle-ci reçues : Administration › « Agents pas encore sur cette tablette » › Ajouter sur cette tablette (même profil). ' : ''}Ses données sont chiffrées avec la clé de la tablette.</p>
      <p class="hint" id="ufErr" style="color:var(--nc)"></p></form>`,
    actions: [{ label: 'Annuler' }, { label: isNew ? 'Ajouter l’agent' : 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      /** Nom ou prénom saisi : initiales et identifiant proposés (tant qu'ils n'ont pas été modifiés à la main). */
      'uf-name'() {
        const f = this.root.querySelector('#uf');
        const fn = f.querySelector('[name=firstName]').value, ln = f.querySelector('[name=lastName]').value;
        if (!manualIni) f.querySelector('[name=initials]').value = fn || ln ? agentInitials({ firstName: fn, lastName: ln }) : '';
        if (!manualUser) f.querySelector('[name=username]').value = freeUsername(suggestUsername(fn, ln));
      },
      'uf-ini'(el) { manualIni = !!el.value; },
      'uf-user'(el) { manualUser = !!el.value; },
      ok() {
        const f = this.root.querySelector('#uf'), err = this.root.querySelector('#ufErr'); if (!f.reportValidity()) return;
        const v = formValues(f);
        v.firstName = v.firstName.trim(); v.lastName = v.lastName.trim(); v.initials = v.initials.trim().toUpperCase();
        v.name = agentFullName(v.firstName, v.lastName);
        if ((v.password || v.password2) && v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
        if (isNew && taken.has(String(v.username || '').trim().toLowerCase())) { err.textContent = `L’identifiant « ${v.username} » est déjà utilisé : choisissez-en un autre.`; return; }
        this.close(v);
      }
    }
  });
  return m.result;
}

/**
 * « Ajouter sur cette tablette » : l'agent (profil reçu d'une autre tablette) choisit et saisit lui-même son mot de
 * passe pour cette tablette, deux fois ; entrée du trousseau créée avec le MÊME identifiant de profil.
 */
function enrollForm(u) {
  const m = openModal({
    title: `Ajouter ${u.name} sur cette tablette`,
    body: html`<form id="ef">
      <div class="banner info">À faire avec <b>${u.name}</b> : c’est l’agent qui choisit et saisit son mot de passe pour cette tablette (8 caractères minimum ; il peut être le même que sur l’autre tablette).</div>
      ${kv([['Agent', u.name], ['Identifiant', u.username], ['Profil', ROLES[u.role] || u.role]])}
      ${field('Mot de passe de l’agent', html`<input name="p1" type="password" required minlength="8" autocomplete="new-password">`, { required: true })}
      ${field('Confirmation du mot de passe', html`<input name="p2" type="password" required autocomplete="new-password">`, { required: true })}
      <p class="note">Même profil que sur l’autre tablette : ses tournées et ses saisies restent les siennes.</p>
      <p class="hint" id="efErr" style="color:var(--nc)"></p></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Ajouter sur cette tablette', act: 'ok', cls: 'primary' }],
    handlers: { async ok() {
      const f = this.root.querySelector('#ef'); if (!f.reportValidity()) return;
      const v = formValues(f), err = this.root.querySelector('#efErr');
      if (v.p1 !== v.p2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      try { await enrollAgent(u.id, v.p1); this.close(true); } catch (e) { err.textContent = e.message; }
    } }
  });
  return m.result;
}

/** « Agents de cette tablette » (trousseau : connexion possible ici) et « pas encore sur cette tablette ». */
async function agentsCards(team) {
  const local = await knownUsers();
  const here = new Set(local.map(e => e.userId));
  const agents = sortBy(local.map(e => ({ entry: e, u: store.get('user', e.userId) })), x => x.u?.name || x.entry.name);
  const others = sortBy(store.all('user').filter(u => !here.has(u.id)), u => u.active === false ? 1 : 0, 'name');
  const roleOf = x => x.u?.role || x.entry.role;
  return html`<div class="card" id="tabletAgents"><h2>Agents de cette tablette (${agents.length}) <button class="btn primary sm" data-act="user-new">＋ Ajouter un agent</button></h2>
      <p class="note">Ils peuvent ouvrir une session ici (écran « Qui utilise la tablette ? »), chacun avec son mot de passe ; les tournées en cours restent sur la tablette d’un agent à l’autre (« Changer d’agent »).</p>
      <div class="list">${agents.map(x => { const u = x.u, e = x.entry, off = u?.active === false || e.disabled; return html`<div class="li ${off ? '' : 'stripe-info'}" data-agent="${e.userId}"><span class="avatar">${agentInitials(u || e)}</span><div class="li-main"><div class="li-title">${u?.name || e.name} ${e.userId === session.user.id ? badge('vous', 'info') : ''}</div><div class="li-sub">${e.username} · ${ROLES[roleOf(x)] || roleOf(x)}${u?.githubLogin ? ' · @' + u.githubLogin : ''} · ${e.lastLogin ? 'dernière session ici le ' + fmtDateTime(e.lastLogin) : 'jamais connecté ici'}</div></div>
        ${off ? badge('Désactivé', 'na') : ''}
        <div class="btn-row">${u ? html`<button class="btn ghost sm" data-act="user-edit" data-id="${u.id}">Modifier</button>` : ''}${e.userId === session.user.id ? '' : html`<button class="btn danger-ghost sm" data-act="agent-remove" data-id="${e.userId}">Retirer de cette tablette</button>`}</div></div>`; })}</div>
      <details style="margin-top:10px"><summary>Droits par profil</summary><div class="table-wrap"><table class="tbl"><thead><tr><th>Droit</th>${Object.values(ROLES).map(r => html`<th>${r}</th>`)}</tr></thead><tbody>${Object.entries(PERMISSIONS).map(([p, roles]) => html`<tr><td>${PERM_LABELS[p] || p}</td>${Object.keys(ROLES).map(r => html`<td>${roles.includes(r) ? '✓' : ''}</td>`)}</tr>`)}</tbody></table></div></details></div>
    ${team || others.length ? html`<div class="card" id="teamAgents"><h2>Agents pas encore sur cette tablette (${others.filter(u => u.active !== false).length})</h2>
      <p class="note">${team ? 'Profils reçus des autres tablettes par la synchronisation de l’équipe' : 'Profils reçus de l’autre tablette avec ses données, ou agents retirés de celle-ci'}. « Ajouter sur cette tablette » permet à l’agent d’ouvrir une session ici avec le MÊME profil (ses tournées et saisies restent les siennes) ; il choisit et saisit lui-même son mot de passe.</p>
      ${others.length ? html`<div class="list">${others.map(u => html`<div class="li ${u.active === false ? '' : 'stripe-warn'}" data-agent="${u.id}"><span class="avatar">${agentInitials(u)}</span><div class="li-main"><div class="li-title">${u.name}</div><div class="li-sub">${u.username || '—'} · ${ROLES[u.role] || u.role}${u.githubLogin ? ' · @' + u.githubLogin : ''}</div></div>
          <div class="btn-row"><button class="btn ghost sm" data-act="user-edit" data-id="${u.id}">Modifier</button>${u.active === false ? badge('Désactivé', 'na') : html`<button class="btn primary sm" data-act="agent-enroll" data-id="${u.id}">Ajouter sur cette tablette</button>`}</div></div>`)}</div>`
        : html`<p class="note">Tous les agents connus sont sur cette tablette.${team ? ' Un agent créé sur une autre tablette apparaît ici après synchronisation.' : ''}</p>`}</div>` : ''}`;
}

/** Membre de l'équipe (config/utilisateurs.json) : login GitHub, nom, profil, actif. */
function teamUserForm(u = null) {
  const isNew = !u;
  u = u || { login: '', name: '', role: 'auditeur', active: true };
  const m = openModal({
    title: isNew ? 'Nouveau membre de l’équipe' : 'Membre @' + u.login,
    body: html`<form id="tuf">${field('Login GitHub', html`<input name="login" value="${u.login}" required autocapitalize="none" spellcheck="false" placeholder="ex. jdupont-oeg">`, { required: true, hint: 'Le compte doit aussi être invité sur le dépôt privé de données (Settings › Collaborators).' })}
      ${field('Nom et prénom', html`<input name="name" value="${u.name || ''}">`)}
      ${field('Profil dans l’application', html`<select name="role">${options(ROLE_OPTIONS(), u.role, { placeholder: null })}</select>`)}
      <label class="check"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Membre actif (désactivé : ses sessions sont fermées et ses comptes locaux bloqués à la synchronisation suivante)</label></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer dans le dépôt', act: 'ok', cls: 'primary' }],
    handlers: { ok() { const f = this.root.querySelector('#tuf'); if (!f.reportValidity()) return; this.close(formValues(f)); } }
  });
  return m.result;
}

const initials = n => (n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

/** Cartes du mode équipe : membres et appareils (fichiers config/ du dépôt de données). */
async function teamCards() {
  const { readTeamConfig } = await import('../app/sync.js');
  let cfg = null, error = '';
  // Relecture dans le dépôt (au plus 8 s, sinon dernière lecture mémorisée : l'écran n'attend jamais le réseau).
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('GitHub ne répond pas')), 8000));
  try { cfg = await Promise.race([readTeamConfig({ refresh: navigator.onLine }), timeout]); }
  catch (e) { error = errText(e); try { cfg = await readTeamConfig(); } catch (e2) { /* rien en mémoire */ } }
  const users = cfg?.utilisateurs?.users || [], devices = cfg?.appareils?.devices || [];
  const readAt = cfg?.readAt ? `lu le ${fmtDateTime(cfg.readAt)}` : 'jamais lu';
  return html`${can('users.manage') ? html`<div class="card"><h2>Membres de l’équipe <button class="btn primary sm" data-act="team-user-new">＋ Membre</button></h2>
      <p class="note">Logins GitHub et profils de l’équipe (<span class="mono">config/utilisateurs.json</span> du dépôt ${teamLabel()}, ${readAt}). Le profil d’un agent rattaché à un login s’aligne sur cette liste à chaque synchronisation. Avec un jeton par tablette, seul l’administrateur (propriétaire des jetons) y figure en général : les agents sans compte GitHub n’y sont pas, leur profil se règle dans « Agents de cette tablette ».</p>
      ${error ? html`<div class="banner warn">${error} — affichage de la dernière lecture.</div>` : ''}
      ${users.length ? html`<div class="list">${users.map(u => html`<button class="li ${u.active === false ? '' : 'stripe-info'}" data-act="team-user-edit" data-login="${u.login}"><span class="avatar">${initials(u.name || u.login)}</span><div class="li-main"><div class="li-title">${u.name || u.login}</div><div class="li-sub">@${u.login} · ${ROLES[u.role] || u.role}${String(u.login).toLowerCase() === String(session.githubLogin || '').toLowerCase() ? ' · propriétaire du jeton de cette tablette' : ''}</div></div>${u.active === false ? badge('Désactivé', 'na') : badge('Actif', 'ok')}</button>`)}</div>` : html`<p class="note">Aucun membre déclaré.</p>`}</div>` : ''}
    ${can('devices.manage') ? html`<div class="card"><h2>Appareils de l’équipe</h2>
      <p class="note">Appareils enregistrés dans <span class="mono">config/appareils.json</span> (${readAt}). Un appareil révoqué voit ses données locales effacées à sa synchronisation suivante.</p>
      ${devices.length ? html`<div class="list">${devices.map(d => html`<div class="li ${d.revoked ? 'stripe-nc' : ''}"><div class="li-main"><div class="li-title">${d.name} ${d.id === session.device.id ? badge('cet appareil', 'info') : ''}</div><div class="li-sub">n° ${d.no} · enregistré le ${fmtDateTime(d.registeredAt)}${d.registeredBy ? ' par ' + d.registeredBy : ''}</div>${d.revoked ? badge('Révoqué le ' + fmtDateTime(d.revokedAt) + (d.revokedBy ? ' par ' + d.revokedBy : ''), 'nc') : ''}</div>${d.revoked ? html`<button class="btn ghost sm" data-act="dev-restore" data-id="${d.id}">Réactiver</button>` : d.id === session.device.id ? '' : html`<button class="btn danger-ghost sm" data-act="dev-revoke" data-id="${d.id}">Désactiver (perdu)</button>`}</div>`)}</div>` : html`<p class="note">Aucun appareil enregistré.</p>`}
      <div class="banner warn" style="margin-top:10px">La révocation efface les données de l’appareil à sa prochaine synchronisation, mais ne désactive PAS son jeton GitHub : pour une tablette perdue ou volée, révoquez aussi <b>le jeton de cette tablette</b> sur GitHub (Settings › Developer settings › Personal access tokens › Fine-grained tokens › « Tablette … » › Revoke).</div></div>` : ''}
    <div class="card"><h2>Sécurité du mode équipe</h2><ul class="note" style="padding-left:20px;margin:0">
      <li>Les profils et les droits sont appliqués par l’application. La véritable frontière de sécurité est l’<b>accès au dépôt privé</b> : toute personne disposant d’un jeton valide sur ce dépôt peut lire et modifier tous ses fichiers, y compris la liste des membres et des appareils.</li>
      <li>N’inviter sur le dépôt que les membres de l’équipe ; jetons « fine-grained » limités à ce dépôt (Contents : Read and write), à expiration courte ; ne jamais rendre le dépôt public.</li>
      <li>L’historique Git conserve toutes les versions ; les audits signés restent scellés par leur empreinte et le journal d’audit est chaîné.</li></ul>
      <a class="btn ghost sm" style="margin-top:10px" href="#/synchronisation">Aide et état de la synchronisation</a></div>`;
}

export default {
  nav: 'admin', title: 'Administration',
  async render() {
    const team = isTeamMode() && session.team;
    const org = orgSettings();
    const est = await storageEstimate();
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    const local = await knownUsers();
    return html`${pageTitle('Administration', team ? `Mode équipe — dépôt ${teamLabel()}` : 'Mode autonome')}
      ${can('users.manage') ? await agentsCards(team) : ''}
      ${team ? await teamCards() : ''}
      ${can('devices.manage') && !team ? html`<div class="card"><h2>Cette tablette</h2>${kv([['Tablette', `${session.device.name} — n° ${session.device.number}`], ['Identifiant', session.device.id]])}<p class="note">Tablette perdue ou volée : ses données restent protégées par le chiffrement et les mots de passe des agents.</p></div>` : ''}
      ${can('settings.manage') ? html`<div class="card"><h2>Paramètres de l’organisation</h2><form id="setf"><div class="grid2">${SETTINGS.map(([key, l, t]) => field(l, html`<input name="${key}" type="${t === 'number' ? 'number' : 'text'}" value="${org[key] ?? ''}">`))}</div>
        <button class="btn primary" type="button" data-act="save-settings">Enregistrer les paramètres</button></form></div>` : ''}
      <div class="card"><h2>Données et stockage</h2>${kv([['Stockage utilisé', est ? `${fmtBytes(est.usage)} sur ${fmtBytes(est.quota)}` : 'inconnu'], ['Stockage persistant', persisted === true ? 'oui (protégé contre l’effacement automatique)' : persisted === false ? 'non garanti' : 'inconnu'], ['Audits', String(store.count('audit'))], ['Médias', String(store.count('media'))], ['Entrées de journal', String(store.count('trail'))], ['Agents de cette tablette', local.map(u => u.name).join(', ')]])}
        ${can('ref.manage') ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="upgrade">Mettre à niveau le référentiel</button><button class="btn ghost" data-act="seed">Compléter le référentiel de base</button><button class="btn ghost" data-act="seed-oeg">Reprendre le référentiel des fiches terrain</button><button class="btn ghost" data-act="seed-demo">Ajouter les données de démonstration</button><button class="btn ghost" data-act="purge-demo">Retirer les données de démonstration</button></div>
          <p class="note">« Mettre à niveau » ajoute ce qui manque (grille CT-2026, stations dont eaux souterraines, programmes 2026) sans jamais remplacer une saisie ; sans effet si tout est à jour.${team ? ' En mode équipe, synchronisez d’abord pour ne compléter que ce que le dépôt ne contient pas encore.' : ''}</p>` : ''}</div>
      ${can('settings.manage') ? html`<div class="card" style="border-color:var(--nc)"><h2>Zone sensible</h2><p class="note">Efface toutes les données de cet appareil (base chiffrée, comptes locaux, cartes). Les données non synchronisées ou non exportées seront perdues.</p><button class="btn danger" data-act="wipe">Effacer les données de cet appareil</button></div>` : ''}`;
  },
  handlers: {
    /** « Ajouter un agent » : NOUVEAU profil et entrée du trousseau de cette tablette (mot de passe saisi par l'agent). */
    async 'user-new'() {
      const team = isTeamMode();
      const taken = new Set([...(await knownUsers()).map(e => e.username), ...store.all('user').map(u => normUsername(u.username))].filter(Boolean));
      const v = await userForm(null, { team, taken }); if (!v) return;
      const githubLogin = team ? String(v.githubLogin || '').trim().replace(/^@/, '') || null : undefined;
      try {
        const id = await addLocalAccount({ username: v.username, name: v.name, role: v.role, password: v.password, extra: { firstName: v.firstName, lastName: v.lastName, initials: v.initials, ...(team ? { githubLogin } : {}) } });
        if (githubLogin) await linkGithubLogin(id, githubLogin);
        // Agent créé désactivé (case décochée) : profil et entrée de la tablette bloqués.
        if (v.active === false) { await store.put('user', { ...store.get('user', id), active: false }, { reason: 'Compte créé désactivé' }); await setLocalAccountDisabled(v.username, true); }
        toast(`${v.name} peut ouvrir une session sur cette tablette`, 'ok'); this.refresh();
      } catch (e) { toast(e.message, 'err'); }
    },
    /** « Ajouter sur cette tablette » : profil existant (autre tablette), mot de passe saisi par l'agent. */
    async 'agent-enroll'(el) {
      const u = store.get('user', el.dataset.id);
      if (!u) return;
      if (!(await enrollForm(u))) return;
      toast(`${u.name} est ajouté(e) sur cette tablette : il ou elle peut ouvrir une session ici`, 'ok', 5000);
      this.refresh();
    },
    /** « Retirer de cette tablette » : entrée locale seulement (profil, tournées et saisies conservés). */
    async 'agent-remove'(el) {
      const id = el.dataset.id;
      const name = store.get('user', id)?.name || (await knownUsers()).find(e => e.userId === id)?.name || 'cet agent';
      if (!(await confirmDialog({ title: 'Retirer de cette tablette', message: `${name} ne pourra plus ouvrir de session sur cette tablette. Son profil, ses tournées et ses saisies sont conservés, ainsi que son accès aux autres tablettes. (Pour bloquer l’agent partout : Modifier › décocher « Compte actif ».)`, okLabel: 'Retirer de cette tablette', danger: true }))) return;
      try { await removeAgentFromDevice(id); toast(`${name} retiré(e) de cette tablette`, 'ok'); }
      catch (e) { toast(e.message, 'err', 6000); }
      this.refresh();
    },
    async 'user-edit'(el) {
      const team = isTeamMode();
      const u = store.get('user', el.dataset.id);
      if (!u) return;
      const enrolled = (await knownUsers()).some(e => e.userId === u.id);
      const v = await userForm(u, { team, enrolled }); if (!v) return;
      try {
        // Jamais le dernier administrateur (de cette tablette, et de l'ensemble des profils).
        await assertAdminRemains(u.id, { role: v.role, active: v.active });
        const githubLogin = team ? (String(v.githubLogin || '').trim().replace(/^@/, '') || null) : u.githubLogin;
        const ident = { name: v.name, firstName: v.firstName, lastName: v.lastName, initials: v.initials };
        await store.put('user', { ...u, ...ident, role: v.role, active: v.active, ...(team ? { githubLogin } : {}) }, { reason: 'Modification du compte' });
        if (v.password && enrolled) await addLocalAccount({ id: u.id, username: u.username, name: v.name, role: v.role, password: v.password, source: 'kept', extra: { initials: v.initials, ...(team ? { githubLogin } : {}) } });
        await syncKeyringProfile({ username: u.username, name: v.name, role: v.role, active: v.active, initials: v.initials, ...(team ? { githubLogin } : {}) });
        await setLocalAccountDisabled(u.username, v.active === false);
        if (u.id === session.user.id) Object.assign(session.user, { name: v.name, role: v.role });
        toast('Compte mis à jour', 'ok'); this.refresh();
      } catch (e) { toast(e.message, 'err'); }
    },
    async 'team-user-new'() {
      const v = await teamUserForm(); if (!v) return;
      const { saveTeamUser, runSync } = await import('../app/sync.js');
      try { await saveTeamUser(v); toast(`Membre @${v.login} enregistré dans le dépôt`, 'ok'); runSync({ reason: 'membres de l’équipe' }).catch(() => {}); }
      catch (e) { toast(errText(e), 'err', 6000); }
      this.refresh();
    },
    async 'team-user-edit'(el) {
      const { readTeamConfig, saveTeamUser, runSync } = await import('../app/sync.js');
      const cfg = await readTeamConfig();
      const u = (cfg.utilisateurs?.users || []).find(x => x.login === el.dataset.login);
      if (!u) return;
      const v = await teamUserForm(u); if (!v) return;
      try { await saveTeamUser(v, { previousLogin: u.login }); toast('Membre mis à jour dans le dépôt', 'ok'); runSync({ reason: 'membres de l’équipe' }).catch(() => {}); }
      catch (e) { toast(errText(e), 'err', 6000); }
      this.refresh();
    },
    async 'dev-revoke'(el) {
      const reason = await promptDialog({ title: 'Désactiver l’appareil', label: 'Motif (appareil perdu, volé, réaffecté…)', multiline: false, voice: false }); if (!reason) return;
      const { setDeviceRevoked } = await import('../app/sync.js');
      try { const r = await setDeviceRevoked(el.dataset.id, true, reason); toast(`Appareil ${r.label} désactivé : ses données seront effacées à sa prochaine synchronisation`, 'ok', 6000); this.refresh(); } catch (e) { toast(errText(e), 'err', 6000); }
    },
    async 'dev-restore'(el) {
      const { setDeviceRevoked } = await import('../app/sync.js');
      try { await setDeviceRevoked(el.dataset.id, false); toast('Appareil réactivé', 'ok'); this.refresh(); } catch (e) { toast(errText(e), 'err', 6000); }
    },
    async 'save-settings'() {
      const v = formValues(document.getElementById('setf'));
      for (const [key, , t] of SETTINGS) if (t === 'number') v[key] = Number(v[key]);
      await saveOrgSettings(v, 'Modification des paramètres');
      toast('Paramètres enregistrés', 'ok');
    },
    async upgrade(el) {
      el.disabled = true; el.textContent = 'Mise à niveau…';
      const { upgradeReferentiel2026 } = await import('../app/bootstrap.js');
      const r = await upgradeReferentiel2026();
      const counts = Object.entries(r).filter(([key, n]) => typeof n === 'number' && n > 0).map(([key, n]) => `${n} ${key}`).join(', ');
      toast(r.error ? 'Mise à niveau incomplète : ' + r.error : r.upgraded ? `Référentiel mis à niveau${counts ? ' : ' + counts : ''}` : 'Référentiel déjà à jour', r.error ? 'err' : 'ok', 6000);
      this.refresh();
    },
    async seed() { const { seedBase } = await import('../app/bootstrap.js'); await seedBase(); toast('Référentiel de base complété', 'ok'); this.refresh(); },
    async 'seed-oeg'() { const { seedOEG } = await import('../app/bootstrap.js'); const c = await seedOEG(); toast(`Référentiel repris : ${Object.entries(c).map(([key, n]) => `${n} ${key}`).join(', ')}`, 'ok', 5000); this.refresh(); },
    async 'seed-demo'() { const { seedDemo } = await import('../app/bootstrap.js'); await seedDemo(); toast('Données de démonstration ajoutées', 'ok'); this.refresh(); },
    async 'purge-demo'() {
      if (!(await confirmDialog({ title: 'Retirer la démonstration', message: 'Supprimer le prestataire, les opérateurs, équipements, prestations et documents fictifs de démonstration ? Les audits déjà réalisés sont conservés.', danger: true }))) return;
      const ids = { provider: ['prov-DEMO'], operator: ['op-DEMO-1', 'op-DEMO-2'], equipment: ['eq-DEMO-1', 'eq-DEMO-2', 'eq-DEMO-3'], prestation: ['pres-DEMO-1', 'pres-DEMO-2', 'pres-DEMO-3'], document: ['doc-CCTP-EX-v1', 'doc-PROTO-EX-v1', 'doc-PROTO-EX-v2', 'doc-CONSIGNES-EX-v1'] };
      for (const [t, list] of Object.entries(ids)) for (const id of list) await store.remove(t, id, 'Retrait des données de démonstration');
      toast('Données de démonstration retirées', 'ok'); this.refresh();
    },
    async wipe() {
      const v = await promptDialog({ title: 'Effacer cet appareil', label: 'Tapez EFFACER pour confirmer', multiline: false, voice: false });
      if (v !== 'EFFACER') return;
      await destroyDB();
      try { const keys = await caches.keys(); await Promise.all(keys.filter(key => key.startsWith('oeg-ct-tiles')).map(key => caches.delete(key))); } catch (e) { /* ignore */ }
      location.reload();
    }
  }
};

export const accountView = {
  nav: 'compte', title: 'Mon compte',
  async render() {
    return html`${pageTitle('Mon compte', `${session.user.name} — ${ROLES[session.user.role]}`)}
      <div class="card"><h2>Session</h2>${kv([['Nom', session.user.name], ['Identifiant', session.user.username], ['Profil', ROLES[session.user.role]], ['Session ouverte le', fmtDateTime(session.unlockedAt)], ['Appareil', `${session.device.name} (n° ${session.device.number})`], ['Mode', isTeamMode() ? `Équipe — dépôt GitHub ${teamLabel()}${session.githubLogin ? ' (@' + session.githubLogin + ')' : ''}` : 'Autonome'], ['Version de l’application', `${self.AUDIT_VERSION} (${self.AUDIT_BUILD_DATE})`]])}
        <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="password">Changer mon mot de passe</button><button class="btn ghost" data-act="rename">Renommer l’appareil</button><button class="btn ghost" data-act="update">Rechercher une mise à jour</button></div></div>
      <div class="card"><h2>Affichage terrain</h2>
        <label class="check ${pref('sun') ? 'sel' : ''}"><input type="checkbox" data-change="sun" ${pref('sun') ? 'checked' : ''}> Mode « plein soleil » (contraste renforcé, texte agrandi)</label>
        <p class="note">Boutons larges utilisables avec des gants, navigation principale en bas d’écran, saisie vocale et lecture de QR codes lorsque l’appareil les propose.</p></div>`;
  },
  handlers: {
    sun(el) { setPref('sun', el.checked); applyDisplayPrefs(); },
    async password() {
      const m = openModal({ title: 'Changer mon mot de passe', body: html`<form id="pw">${field('Mot de passe actuel', html`<input type="password" name="old" required>`)}${field('Nouveau mot de passe (8 caractères min.)', html`<input type="password" name="n1" required minlength="8">`)}${field('Confirmation', html`<input type="password" name="n2" required>`)}</form>`, actions: [{ label: 'Annuler' }, { label: 'Changer', act: 'ok', cls: 'primary' }], handlers: { ok() { const f = this.root.querySelector('#pw'); if (!f.reportValidity()) return; this.close(formValues(f)); } } });
      const v = await m.result; if (!v) return;
      if (v.n1 !== v.n2) { toast('Les mots de passe ne correspondent pas.', 'err'); return; }
      try { await changePassword(v.old, v.n1); toast('Mot de passe changé', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    },
    async rename() { const n = await promptDialog({ title: 'Nom de l’appareil', label: 'Nom', value: session.device.name, multiline: false, voice: false }); if (n) { await updateDevice({ name: n }); toast('Appareil renommé', 'ok'); this.refresh(); } },
    async update() {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) { toast('Mise à jour automatique indisponible sur ce navigateur.', 'warn'); return; }
      await reg.update().catch(() => {});
      toast(reg.installing || reg.waiting ? 'Nouvelle version en cours d’installation : rechargement…' : 'Application à jour.', 'ok');
      if (reg.waiting) { reg.waiting.postMessage('skipWaiting'); setTimeout(() => location.reload(), 800); }
    }
  }
};
