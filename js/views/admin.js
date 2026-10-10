/* Administration : utilisateurs et rôles, appareils (désactivation d'un appareil perdu), paramètres de
 * l'organisation, données (dont la mise à niveau du référentiel) ; écran « Mon compte ».
 * Mode équipe : les membres (login GitHub → profil) et les appareils sont tenus dans les fichiers
 * config/utilisateurs.json et config/appareils.json du dépôt de données (commit à chaque modification) ;
 * les comptes locaux de l'appareil restent gérés sur l'appareil. */
import { html, raw, fmtDateTime, fmtBytes, sortBy, uuid } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { meta, destroyDB, storageEstimate } from '../core/db.js';
import { ROLES, PERMISSIONS, can, addLocalAccount, setLocalAccountDisabled, syncKeyringProfile, changePassword, knownUsers, getKeyring, updateDevice, isTeamMode, teamLabel, linkGithubLogin } from '../core/auth.js';
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

/** Compte local de l'appareil (les deux modes ; en mode équipe, rattachement facultatif à un login GitHub). */
function userForm(u = null, { team = false } = {}) {
  const isNew = !u;
  u = u || { username: '', name: '', role: 'auditeur', active: true };
  const m = openModal({
    title: isNew ? 'Nouveau compte local' : 'Compte ' + u.name,
    body: html`<form id="uf">${field('Nom et prénom', html`<input name="name" value="${u.name}" required>`, { required: true })}
      ${field('Identifiant', html`<input name="username" value="${u.username}" required autocapitalize="none" ${isNew ? '' : raw('readonly')}>`, { required: true })}
      ${field('Profil local', html`<select name="role">${options(ROLE_OPTIONS(), u.role, { placeholder: null })}</select>`, { hint: team ? 'Remplacé par le profil d’équipe si le compte est rattaché à un login GitHub déclaré dans l’équipe.' : '' })}
      ${team ? field('Login GitHub (facultatif)', html`<input name="githubLogin" value="${u.githubLogin || ''}" autocapitalize="none" spellcheck="false" placeholder="ex. jdupont-oeg">`, { hint: 'Le profil de ce compte suivra alors config/utilisateurs.json.' }) : ''}
      ${field(isNew ? 'Mot de passe initial' : 'Nouveau mot de passe (laisser vide pour ne pas changer)', html`<input name="password" type="password" ${isNew ? raw('required minlength="8"') : ''} autocomplete="new-password">`)}
      <label class="check"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Compte actif</label>
      <p class="note">Le compte est créé sur cet appareil uniquement ; ses données sont chiffrées avec la clé de l’appareil${team ? ' ; les synchronisations utilisent le jeton GitHub de l’appareil' : ''}.</p></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: { ok() { const f = this.root.querySelector('#uf'); if (!f.reportValidity()) return; this.close(formValues(f)); } }
  });
  return m.result;
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
      <p class="note">Logins GitHub et profils de l’équipe (<span class="mono">config/utilisateurs.json</span> du dépôt ${teamLabel()}, ${readAt}). Le profil d’un compte local rattaché à un login s’aligne sur cette liste à chaque synchronisation.</p>
      ${error ? html`<div class="banner warn">${error} — affichage de la dernière lecture.</div>` : ''}
      ${users.length ? html`<div class="list">${users.map(u => html`<button class="li ${u.active === false ? '' : 'stripe-info'}" data-act="team-user-edit" data-login="${u.login}"><span class="avatar">${initials(u.name || u.login)}</span><div class="li-main"><div class="li-title">${u.name || u.login}</div><div class="li-sub">@${u.login} · ${ROLES[u.role] || u.role}${String(u.login).toLowerCase() === String(session.githubLogin || '').toLowerCase() ? ' · cet appareil' : ''}</div></div>${u.active === false ? badge('Désactivé', 'na') : badge('Actif', 'ok')}</button>`)}</div>` : html`<p class="note">Aucun membre déclaré.</p>`}</div>` : ''}
    ${can('devices.manage') ? html`<div class="card"><h2>Appareils de l’équipe</h2>
      <p class="note">Appareils enregistrés dans <span class="mono">config/appareils.json</span> (${readAt}). Un appareil révoqué voit ses données locales effacées à sa synchronisation suivante.</p>
      ${devices.length ? html`<div class="list">${devices.map(d => html`<div class="li ${d.revoked ? 'stripe-nc' : ''}"><div class="li-main"><div class="li-title">${d.name} ${d.id === session.device.id ? badge('cet appareil', 'info') : ''}</div><div class="li-sub">n° ${d.no} · enregistré le ${fmtDateTime(d.registeredAt)}${d.registeredBy ? ' par ' + d.registeredBy : ''}</div>${d.revoked ? badge('Révoqué le ' + fmtDateTime(d.revokedAt) + (d.revokedBy ? ' par ' + d.revokedBy : ''), 'nc') : ''}</div>${d.revoked ? html`<button class="btn ghost sm" data-act="dev-restore" data-id="${d.id}">Réactiver</button>` : d.id === session.device.id ? '' : html`<button class="btn danger-ghost sm" data-act="dev-revoke" data-id="${d.id}">Désactiver (perdu)</button>`}</div>`)}</div>` : html`<p class="note">Aucun appareil enregistré.</p>`}
      <div class="banner warn" style="margin-top:10px">La révocation efface les données de l’appareil à sa prochaine synchronisation, mais ne désactive PAS son jeton GitHub : pour un appareil perdu ou volé, révoquez aussi le jeton sur GitHub (Settings › Developer settings › Personal access tokens) ou retirez l’accès du compte au dépôt.</div></div>` : ''}
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
    const k = await getKeyring();
    const onDevice = new Set(Object.values(k.users).map(e => e.userId));
    // Comptes locaux : en mode équipe, seuls ceux de cet appareil (les profils des autres appareils sont aussi reçus).
    const users = can('users.manage') ? sortBy(store.all('user').filter(u => !team || onDevice.has(u.id)), 'name') : [];
    return html`${pageTitle('Administration', team ? `Mode équipe — dépôt ${teamLabel()}` : 'Mode autonome')}
      ${team ? await teamCards() : ''}
      ${can('users.manage') ? html`<div class="card"><h2>${team ? 'Comptes locaux de cet appareil' : 'Utilisateurs et profils'} <button class="btn primary sm" data-act="user-new">＋ ${team ? 'Compte local' : 'Utilisateur'}</button></h2>
        <div class="list">${users.map(u => html`<button class="li ${u.active === false ? '' : 'stripe-info'}" data-act="user-edit" data-id="${u.id}"><span class="avatar">${initials(u.name)}</span><div class="li-main"><div class="li-title">${u.name}</div><div class="li-sub">${u.username} · ${ROLES[u.role] || u.role}${u.githubLogin ? ' · @' + u.githubLogin : ''}${onDevice.has(u.id) ? '' : ' · autre appareil'}</div></div>${u.active === false ? badge('Désactivé', 'na') : badge('Actif', 'ok')}</button>`)}</div>
        <details style="margin-top:10px"><summary>Droits par profil</summary><div class="table-wrap"><table class="tbl"><thead><tr><th>Droit</th>${Object.values(ROLES).map(r => html`<th>${r}</th>`)}</tr></thead><tbody>${Object.entries(PERMISSIONS).map(([p, roles]) => html`<tr><td>${PERM_LABELS[p] || p}</td>${Object.keys(ROLES).map(r => html`<td>${roles.includes(r) ? '✓' : ''}</td>`)}</tr>`)}</tbody></table></div></details></div>` : ''}
      ${can('devices.manage') && !team ? html`<div class="card"><h2>Appareils</h2>${kv([['Cet appareil', `${session.device.name} — n° ${session.device.number}`], ['Identifiant', session.device.id]])}<p class="note">En mode autonome, la désactivation à distance d’un appareil perdu nécessite le mode équipe (dépôt GitHub). Les données restent protégées par le chiffrement et les mots de passe.</p></div>` : ''}
      ${can('settings.manage') ? html`<div class="card"><h2>Paramètres de l’organisation</h2><form id="setf"><div class="grid2">${SETTINGS.map(([key, l, t]) => field(l, html`<input name="${key}" type="${t === 'number' ? 'number' : 'text'}" value="${org[key] ?? ''}">`))}</div>
        <button class="btn primary" type="button" data-act="save-settings">Enregistrer les paramètres</button></form></div>` : ''}
      <div class="card"><h2>Données et stockage</h2>${kv([['Stockage utilisé', est ? `${fmtBytes(est.usage)} sur ${fmtBytes(est.quota)}` : 'inconnu'], ['Stockage persistant', persisted === true ? 'oui (protégé contre l’effacement automatique)' : persisted === false ? 'non garanti' : 'inconnu'], ['Audits', String(store.count('audit'))], ['Médias', String(store.count('media'))], ['Entrées de journal', String(store.count('trail'))], ['Comptes sur l’appareil', local.map(u => u.name).join(', ')]])}
        ${can('ref.manage') ? html`<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="upgrade">Mettre à niveau le référentiel</button><button class="btn ghost" data-act="seed">Compléter le référentiel de base</button><button class="btn ghost" data-act="seed-oeg">Reprendre le référentiel des fiches terrain</button><button class="btn ghost" data-act="seed-demo">Ajouter les données de démonstration</button><button class="btn ghost" data-act="purge-demo">Retirer les données de démonstration</button></div>
          <p class="note">« Mettre à niveau » ajoute ce qui manque (grille CT-2026, stations dont eaux souterraines, programmes 2026) sans jamais remplacer une saisie ; sans effet si tout est à jour.${team ? ' En mode équipe, synchronisez d’abord pour ne compléter que ce que le dépôt ne contient pas encore.' : ''}</p>` : ''}</div>
      ${can('settings.manage') ? html`<div class="card" style="border-color:var(--nc)"><h2>Zone sensible</h2><p class="note">Efface toutes les données de cet appareil (base chiffrée, comptes locaux, cartes). Les données non synchronisées ou non exportées seront perdues.</p><button class="btn danger" data-act="wipe">Effacer les données de cet appareil</button></div>` : ''}`;
  },
  handlers: {
    async 'user-new'() {
      const team = isTeamMode();
      const v = await userForm(null, { team }); if (!v) return;
      try {
        const id = await addLocalAccount({ username: v.username, name: v.name, role: v.role, password: v.password, extra: team ? { githubLogin: String(v.githubLogin || '').trim().replace(/^@/, '') || null } : {} });
        if (team && v.githubLogin) await linkGithubLogin(id, String(v.githubLogin).trim().replace(/^@/, ''));
        toast('Compte créé', 'ok'); this.refresh();
      } catch (e) { toast(e.message, 'err'); }
    },
    async 'user-edit'(el) {
      const team = isTeamMode();
      const u = store.get('user', el.dataset.id);
      if (!u) return;
      const v = await userForm(u, { team }); if (!v) return;
      try {
        if (u.id === session.user.id && v.role !== 'admin' && !store.filter('user', x => x.role === 'admin' && x.active !== false && x.id !== u.id).length) { toast('Il doit rester au moins un administrateur actif.', 'err'); return; }
        const githubLogin = team ? (String(v.githubLogin || '').trim().replace(/^@/, '') || null) : u.githubLogin;
        await store.put('user', { ...u, name: v.name, role: v.role, active: v.active, ...(team ? { githubLogin } : {}) }, { reason: 'Modification du compte' });
        if (v.password) await addLocalAccount({ id: u.id, username: u.username, name: v.name, role: v.role, password: v.password, source: 'kept', extra: team ? { githubLogin } : {} });
        await syncKeyringProfile({ username: u.username, name: v.name, role: v.role, active: v.active, ...(team ? { githubLogin } : {}) });
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
