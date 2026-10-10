/* Écrans hors session : première configuration de l'appareil (mode autonome ou « Rejoindre une équipe »
 * par un dépôt GitHub privé de données), ouverture de session, messages. */
import { html } from '../core/util.js';
import { session } from '../core/session.js';
import * as auth from '../core/auth.js';
import { bindActions, toast, formValues } from '../ui/dom.js';
import { seedAll } from '../app/bootstrap.js';
import { saveOrgSettings } from '../app/settings.js';
import { parseRepoSpec } from '../app/github.js';

const LOGO = 'icons/logo-oeg.png';
let unbind = null;
function bind(root, handlers) { unbind?.(); unbind = bindActions(root, handlers); }
/** Retire les gestionnaires des écrans de connexion (appelé à l'entrée dans l'application). */
export function teardownAuth() { unbind?.(); unbind = null; }
const modeLabel = () => session.mode === auth.TEAM_MODE ? `équipe GitHub${session.team ? ' (' + auth.teamLabel() + ')' : ''}` : session.mode ? 'autonome' : '';
const footer = () => html`<p class="tiny muted" style="text-align:center;margin-top:16px">Version ${self.AUDIT_VERSION || ''} · ${session.device?.name || ''}${session.mode ? ' · mode ' + modeLabel() : ''}</p>`;

export function renderMessage(root, { title, message }) {
  teardownAuth();
  root.innerHTML = String(html`<div class="auth"><div class="auth-card"><img class="logo" src="${LOGO}" alt=""><h1>${title}</h1><p class="sub">${message}</p></div></div>`);
}

/** Aide pas à pas : dépôt privé et jeton « fine-grained » (reprise dans l'écran Synchronisation). */
export function tokenHelp() {
  return html`<ol class="note" style="padding-left:20px;margin:6px 0">
    <li>Le dépôt de données est un dépôt GitHub <b>privé</b>, distinct du dépôt public de l’application (ex. <span class="mono">CSRE-DCE/fiche-de-controle-donnees</span>), créé vide ou avec un simple README par l’administrateur, qui y invite chaque membre de l’équipe.</li>
    <li>Sur GitHub : <b>Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token</b>.</li>
    <li><b>Resource owner</b> : le propriétaire du dépôt de données (l’organisation doit autoriser les jetons fine-grained) ; <b>Expiration</b> : 90 jours par exemple (le jeton se renouvelle depuis l’écran Synchronisation).</li>
    <li><b>Repository access</b> : <i>Only select repositories</i> → uniquement le dépôt de données.</li>
    <li><b>Permissions › Repository permissions › Contents</b> : <i>Read and write</i> (Metadata : lecture, ajoutée automatiquement). Aucune autre permission.</li>
    <li>Copiez le jeton (<span class="mono">github_pat_…</span>) et collez-le ici : il est conservé chiffré sur cet appareil et n’est envoyé qu’à l’API GitHub.</li>
  </ol>`;
}

/** Résumé de la vérification d'un dépôt d'équipe (probeTeam). */
export function probeSummary(p) {
  if (!p) return '';
  const who = html`Connecté à GitHub en tant que <b>@${p.login}</b>${p.userName && p.userName !== p.login ? ` (${p.userName})` : ''}`;
  if (!p.repo.private) return html`<div class="banner nc">${who}. Le dépôt <b>${p.repo.fullName}</b> est PUBLIC : les données d’audit seraient visibles de tous. Rendez-le privé (Settings › General › Danger Zone › Change visibility) ou choisissez un autre dépôt.</div>`;
  if (!p.initialized) return html`<div class="banner warn">${who} · dépôt privé <b>${p.repo.fullName}</b> ✓<br>${p.empty ? 'Dépôt vide' : p.branchMissing ? `Branche « ${p.team.branch} » absente` : 'Dépôt non initialisé'} : cet appareil va l’initialiser (configuration de l’équipe, référentiel) et vous en serez l’administrateur.</div>`;
  const role = p.member ? (p.member.active === false ? 'compte DÉSACTIVÉ dans l’équipe' : `profil ${auth.ROLES[p.member.role] || p.member.role}`) : 'login absent de config/utilisateurs.json : profil Auditeur par défaut (modifiable par l’administrateur de l’équipe)';
  return html`<div class="banner ${p.member?.active === false ? 'nc' : 'ok'}">${who} · dépôt privé <b>${p.repo.fullName}</b> ✓<br>Équipe « ${p.equipe?.orgName || p.repo.fullName} » — ${role}.</div>`;
}

const errText = e => e?.message === 'Failed to fetch' ? 'GitHub injoignable : vérifiez la connexion réseau.' : (e?.message || String(e));

export function renderSetup(root, { onDone }) {
  let mode = 'standalone';
  let probe = null, probeKey = '';
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      <img class="logo" src="${LOGO}" alt="Office de l'Eau de Guyane">
      <h1>Configuration de l’appareil</h1>
      <p class="sub">Audit terrain des prestations de prélèvement — première utilisation sur cet appareil.</p>
      <div class="seg" style="margin-bottom:14px">
        <button type="button" data-act="mode" data-value="standalone" class="${mode === 'standalone' ? 'sel brand' : ''}">Mode autonome<small>données sur cet appareil</small></button>
        <button type="button" data-act="mode" data-value="team" class="${mode === 'team' ? 'sel brand' : ''}">Rejoindre une équipe<small>dépôt GitHub privé</small></button>
      </div>
      ${mode === 'standalone' ? html`<form data-submit="standalone" autocomplete="off">
        <div class="banner info">Les données restent chiffrées sur cet appareil. L’appareil pourra être rattaché plus tard au dépôt GitHub d’une équipe ; en attendant, les échanges entre appareils se font par export/import de paquets de données.</div>
        <div class="field"><label>Organisme</label><input name="orgName" value="Office de l’Eau de Guyane" required></div>
        <div class="grid2">
          <div class="field"><label>Nom de l’appareil</label><input name="deviceName" value="${auth.defaultDeviceName()}" required></div>
          <div class="field"><label>N° de l’appareil (1 à 99)</label><input name="deviceNumber" type="number" min="1" max="99" value="1" required><div class="hint">Unique par appareil : garantit des numéros d’audit uniques.</div></div>
        </div>
        <h3>Compte administrateur</h3>
        <div class="field"><label>Nom et prénom</label><input name="name" required autocomplete="name"></div>
        <div class="grid2">
          <div class="field"><label>Identifiant</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"></div>
        <label class="check sel"><input type="checkbox" name="oeg" checked> Reprendre le référentiel des fiches terrain OEG (stations, organismes, préleveurs, campagnes)</label>
        <label class="check" style="margin-top:8px"><input type="checkbox" name="demo" checked> Ajouter des données de démonstration fictives (prestataire « DÉMO », 3 prestations, documents « EXEMPLE »)</label>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="setupBtn">Créer et ouvrir la session</button>
      </form>` : html`<form data-submit="team" autocomplete="off" id="teamForm">
        <div class="banner info">Les données de l’équipe sont partagées par un dépôt GitHub <b>privé</b>, lu et écrit directement depuis cet appareil avec votre jeton d’accès personnel (aucun serveur). Sur l’appareil, elles restent chiffrées et la session s’ouvre ensuite hors connexion.</div>
        <h3>Dépôt de données de l’équipe</h3>
        <div class="field"><label>Dépôt GitHub (propriétaire/nom) <span class="req">*</span></label><input name="repoSpec" required placeholder="CSRE-DCE/fiche-de-controle-donnees" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label>Jeton d’accès « fine-grained » <span class="req">*</span></label><input name="token" type="password" required placeholder="github_pat_…" autocomplete="off" spellcheck="false"><div class="hint">Limité à ce dépôt, permission « Contents : Read and write ». Conservé chiffré sur cet appareil.</div></div>
        <details><summary>Comment créer le dépôt et le jeton ?</summary>${tokenHelp()}</details>
        <details><summary>Options avancées</summary><div class="grid2">
          <div class="field"><label>Branche</label><input name="branch" value="${auth.TEAM_DEFAULTS.branch}" autocapitalize="none" spellcheck="false"></div>
          <div class="field"><label>Dossier des données</label><input name="prefix" value="${auth.TEAM_DEFAULTS.prefix}" autocapitalize="none" spellcheck="false"></div></div>
          <div class="field"><label>Adresse de l’API</label><input name="apiUrl" value="${auth.TEAM_DEFAULTS.apiUrl}" inputmode="url" autocapitalize="none" spellcheck="false"><div class="hint">GitHub Enterprise Server : https://serveur/api/v3</div></div></details>
        <button type="button" class="btn ghost block" style="margin:10px 0" data-act="team-check" id="teamCheck">Vérifier l’accès au dépôt</button>
        <div id="teamProbe"></div>
        <div id="teamInit" hidden>
          <div class="field"><label>Organisme</label><input name="orgName" value="Office de l’Eau de Guyane"></div>
          <label class="check sel"><input type="checkbox" name="oeg" checked> Reprendre le référentiel des fiches terrain OEG (stations, organismes, préleveurs, campagnes)</label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="demo"> Ajouter des données de démonstration fictives</label>
        </div>
        <h3>Cet appareil et votre compte local</h3>
        <div class="field"><label>Nom de l’appareil</label><input name="deviceName" value="${auth.defaultDeviceName()}" required></div>
        <div class="field"><label>Nom et prénom</label><input name="name" required autocomplete="name"></div>
        <div class="grid2">
          <div class="field"><label>Identifiant local</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"><div class="hint">Ce mot de passe ouvre la session sur cet appareil, y compris hors connexion. Il n’est jamais envoyé à GitHub.</div></div>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="teamBtn">Rejoindre l’équipe</button>
      </form>`}
      ${footer()}
    </div></div>`);
  };
  const settingsOf = v => {
    const r = parseRepoSpec(v.repoSpec);
    if (!r) throw new Error('Dépôt GitHub invalide : indiquez « propriétaire/nom-du-dépôt ».');
    return { apiUrl: v.apiUrl || auth.TEAM_DEFAULTS.apiUrl, owner: r.owner, repo: r.repo, branch: v.branch || auth.TEAM_DEFAULTS.branch, prefix: v.prefix ?? auth.TEAM_DEFAULTS.prefix };
  };
  const keyOf = v => [v.repoSpec, v.token, v.branch, v.prefix, v.apiUrl].map(x => String(x || '').trim()).join('|');
  async function check(form) {
    const v = formValues(form), box = form.querySelector('#teamProbe'), initBox = form.querySelector('#teamInit');
    probe = null; probeKey = '';
    box.innerHTML = String(html`<p class="note">Vérification auprès de GitHub…</p>`);
    const { probeTeam } = await import('../app/sync.js');
    try {
      probe = await probeTeam(settingsOf(v), String(v.token || '').trim());
      probeKey = keyOf(v);
      box.innerHTML = String(probeSummary(probe));
      initBox.hidden = probe.initialized || !probe.repo.private;
      form.querySelector('#teamBtn').textContent = probe.initialized ? 'Rejoindre l’équipe' : 'Initialiser le dépôt et créer l’équipe';
      return probe;
    } catch (e) {
      box.innerHTML = String(html`<div class="banner nc">${errText(e)}</div>`);
      initBox.hidden = true;
      throw e;
    }
  }
  draw();
  bind(root, {
    mode(el) { mode = el.dataset.value; probe = null; probeKey = ''; draw(); },
    async standalone(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#setupBtn');
      err.textContent = '';
      if (v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      btn.disabled = true; btn.textContent = 'Préparation de l’appareil…';
      try {
        await auth.setupStandalone({ deviceName: v.deviceName, deviceNumber: v.deviceNumber, admin: { name: v.name, username: v.username, password: v.password } });
        await seedAll({ oeg: !!v.oeg, demo: !!v.demo });
        await saveOrgSettings({ orgName: v.orgName }, 'Configuration initiale');
        toast('Appareil configuré ✓', 'ok');
        onDone({ password: v.password });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Créer et ouvrir la session'; }
    },
    async 'team-check'(el) {
      const form = el.closest('form');
      if (!form.querySelector('[name=repoSpec]').reportValidity() || !form.querySelector('[name=token]').reportValidity()) return;
      el.disabled = true;
      try { await check(form); } catch (e) { /* message affiché */ } finally { el.disabled = false; }
    },
    async team(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#teamBtn');
      err.textContent = '';
      if (v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Vérification du dépôt…';
      let p;
      try {
        const wasChecked = probe && probeKey === keyOf(v);
        p = wasChecked ? probe : await check(form);
        if (!p.repo.private) throw new Error('Le dépôt de données doit être PRIVÉ.');
        if (p.member && p.member.active === false) throw new Error('Votre compte GitHub est désactivé dans cette équipe : contactez l’administrateur.');
        // Dépôt à initialiser : l'utilisateur confirme d'abord les options d'initialisation affichées.
        if (!p.initialized && !wasChecked) { err.textContent = 'Dépôt à initialiser : vérifiez les options ci-dessus puis validez à nouveau.'; btn.disabled = false; btn.textContent = 'Initialiser le dépôt et créer l’équipe'; return; }
      } catch (e) { err.textContent = errText(e); btn.disabled = false; btn.textContent = label; return; }
      const token = String(v.token).trim(), init = !p.initialized;
      btn.textContent = 'Préparation de l’appareil…';
      try {
        await auth.setupTeam({ deviceName: v.deviceName, account: { name: v.name, username: v.username, password: v.password }, team: { ...p.team, orgName: v.orgName || p.equipe?.orgName || '' }, token, login: p.login, role: init ? 'admin' : (p.member?.role || 'auditeur') });
      } catch (e) { err.textContent = errText(e); btn.disabled = false; btn.textContent = label; return; }
      // L'appareil est configuré : les étapes suivantes n'empêchent pas l'ouverture de la session.
      try {
        if (init) {
          btn.textContent = 'Initialisation du dépôt…';
          await seedAll({ oeg: !!v.oeg, demo: !!v.demo });
          await saveOrgSettings({ orgName: v.orgName || 'Office de l’Eau de Guyane' }, 'Configuration initiale');
          const { initializeRepo } = await import('../app/sync.js');
          await initializeRepo({ orgName: v.orgName || '', settings: p.team, token, login: p.login, name: v.name });
          toast('Dépôt de l’équipe initialisé ✓ — envoi des données en cours', 'ok', 5000);
        } else toast('Appareil rattaché à l’équipe ✓ — réception des données en cours', 'ok', 5000);
      } catch (e) { toast('Appareil configuré, mais : ' + errText(e) + ' (voir Synchronisation)', 'err', 8000); }
      onDone({ password: v.password });
    }
  });
}

export async function renderLogin(root, { message = '', onUnlocked }) {
  const users = await auth.knownUsers();
  let selected = users[0]?.username || '';
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      <img class="logo" src="${LOGO}" alt="Office de l'Eau de Guyane">
      <h1>Audit des prestations de prélèvement</h1>
      <p class="sub">${navigator.onLine ? 'Ouverture de session' : 'Hors connexion — ouverture de session locale'}</p>
      ${message ? html`<div class="banner info">${message}</div>` : ''}
      <form data-submit="login" autocomplete="off">
        <div class="user-tiles">${users.map(u => html`<button type="button" class="user-tile ${u.username === selected ? 'sel' : ''}" data-act="pick" data-u="${u.username}">
          <span class="avatar">${(u.name || u.username).split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span><b>${u.name}</b><br><span class="tiny muted">${auth.ROLES[u.role] || u.role} · ${u.username}</span></span></button>`)}</div>
        <div class="field"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password" autofocus></div>
        <p class="hint" id="loginErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="loginBtn">Ouvrir la session</button>
      </form>
      ${footer()}
    </div></div>`);
    root.querySelector('input[name=password]')?.focus();
  };
  draw();
  bind(root, {
    pick(el) { selected = el.dataset.u; root.querySelectorAll('.user-tile').forEach(t => t.classList.toggle('sel', t === el)); root.querySelector('input[name=password]').focus(); },
    async login(form) {
      const v = formValues(form), err = form.querySelector('#loginErr'), btn = form.querySelector('#loginBtn');
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Vérification…';
      try {
        const r = await auth.unlock(selected, v.password);
        if (!r.ok) { err.textContent = r.error; btn.disabled = false; btn.textContent = 'Ouvrir la session'; return; }
        onUnlocked({ password: v.password });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Ouvrir la session'; }
    }
  });
}
