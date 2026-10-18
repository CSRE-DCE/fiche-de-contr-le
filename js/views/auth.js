/* Écrans hors session : mise en service de la tablette (mode autonome, celui de l'OEG : données chiffrées sur la
 * tablette, un compte par agent, échanges entre tablettes par fichier), ouverture de session « Qui utilise la
 * tablette ? » (tuiles des agents de la tablette, aide si un agent n'y figure pas), messages.
 * Mise en service, deux choix :
 *  - « Première tablette de l'équipe » : compte de l'administrateur saisi comme « Ajouter un agent » (nom, prénom,
 *    initiales et identifiant proposés), mot de passe d'échange de l'équipe, référentiel ; il ajoute ensuite les agents ;
 *  - « Tablette supplémentaire : recevoir le fichier de l'autre tablette » : fichier d'échange et mot de passe
 *    d'échange, aperçu, nom et n° de la tablette (n° libre proposé), « Qui êtes-vous ? » parmi les agents reçus
 *    (même identifiant de profil sur les deux tablettes : aucun profil en double) et son mot de passe ; toutes
 *    les données du fichier sont reçues (js/app/exchange.js : setupFromExchange).
 * Option avancée repliée « Rejoindre une équipe » par un dépôt GitHub privé de données — nécessite un jeton GitHub,
 * non utilisée à l'OEG. */
import { html, fmtDateTime } from '../core/util.js';
import { session } from '../core/session.js';
import * as auth from '../core/auth.js';
import { agentInitials, suggestUsername } from '../domain/permissions.js';
import { bindActions, toast, formValues } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { logoImg, DEFAULT_LOGO_WIDE } from '../ui/logo.js';
import { seedAll } from '../app/bootstrap.js';
import { saveOrgSettings } from '../app/settings.js';
import { parseRepoSpec } from '../app/github.js';

// Logo des écrans de connexion : logo choisi en Administration (copie locale, js/ui/logo.js), sinon celui de l'OEG.
const LOGO = () => logoImg({ cls: 'logo', alt: 'Office de l’Eau de Guyane', fallback: DEFAULT_LOGO_WIDE });
let unbind = null;
function bind(root, handlers) { unbind?.(); unbind = bindActions(root, handlers); }
/** Retire les gestionnaires des écrans de connexion (appelé à l'entrée dans l'application). */
export function teardownAuth() { unbind?.(); unbind = null; }
const modeLabel = () => session.mode === auth.TEAM_MODE ? `équipe GitHub${session.team ? ' (' + auth.teamLabel() + ')' : ''}` : session.mode ? 'autonome' : '';
const footer = () => html`<p class="tiny muted" style="text-align:center;margin-top:16px">Version ${self.AUDIT_VERSION || ''} · ${session.device?.name || ''}${session.mode ? ' · mode ' + modeLabel() : ''}</p>`;

export function renderMessage(root, { title, message }) {
  teardownAuth();
  root.innerHTML = String(html`<div class="auth"><div class="auth-card">${LOGO()}<h1>${title}</h1><p class="sub">${message}</p></div></div>`);
}

/** Aide pas à pas : dépôt privé et jeton « fine-grained » (reprise dans l'écran Synchronisation). */
export function tokenHelp() {
  return html`<ol class="note" style="padding-left:20px;margin:6px 0">
    <li>Le dépôt de données est un dépôt GitHub <b>privé</b>, distinct du dépôt public de l’application (ex. <span class="mono">CSRE-DCE/fiche-de-controle-donnees</span>), créé vide ou avec un simple README par l’administrateur.</li>
    <li><b>Un jeton par tablette</b>, créé par l’administrateur depuis son compte GitHub et nommé d’après la tablette (« Tablette 1 », « Tablette 2 »…) : les agents n’ont pas besoin de compte GitHub. Sur GitHub : <b>Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token</b>.</li>
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

/**
 * Deuxième tablette : profils de l'équipe déjà rattachés au login du jeton (l'administrateur qui configure) —
 * « C'est moi » réutilise ce profil (même identité sur les deux tablettes) ; sinon nouveau compte.
 */
function profilesChoice(p, chosen) {
  const list = p?.profiles || [];
  if (!list.length) return '';
  return html`<div class="card" style="margin:6px 0 10px"><b>Vous êtes déjà dans l’équipe ?</b>
    <p class="note">Profil(s) rattaché(s) au compte GitHub @${p.login} (le propriétaire de ce jeton). Choisissez le vôtre pour garder la même identité sur toutes les tablettes (tournées, saisies, journal).</p>
    <div class="checks" style="grid-template-columns:1fr">${list.map(u => html`<label class="check ${chosen === u.id ? 'sel' : ''}"><input type="radio" name="profileId" value="${u.id}" data-change="pick-profile" ${chosen === u.id ? 'checked' : ''}><span>C’est moi : <b>${u.name}</b> <small class="muted">(${u.username} · ${auth.ROLES[u.role] || u.role})</small></span></label>`)}
      <label class="check ${chosen ? '' : 'sel'}"><input type="radio" name="profileId" value="" data-change="pick-profile" ${chosen ? '' : 'checked'}><span>Créer un nouveau compte</span></label></div></div>`;
}

/** Aperçu du fichier reçu à la mise en service d'une tablette supplémentaire. */
function extraPreview(pv) {
  const tours = pv.tours.slice(0, 6);
  return html`<div class="banner ok" id="extraPreview">Fichier de <b>${pv.from.name || 'l’autre tablette'}</b>${pv.from.number ? ` (n° ${pv.from.number})` : ''}, envoyé par ${pv.sentBy.name || '—'}${pv.createdAt ? ' le ' + fmtDateTime(pv.createdAt) : ''} : ${pv.label || 'aucun élément'}.</div>
    ${pv.scope !== 'all' && !(pv.counts.byType?.grid && pv.counts.byType?.site) ? html`<div class="banner warn" id="extraPartial">Ce fichier ne contient que les dernières modifications de l’autre tablette (ni grille ni stations) : pour une mise en service, demandez-lui « Tout envoyer ».</div>` : ''}
    ${pv.tours.length ? html`<p class="note">Tournées : ${tours.map(t => t.number).join(', ')}${pv.tours.length > tours.length ? '…' : ''}</p>` : ''}`;
}

export function renderSetup(root, { onDone }) {
  // 'choice' (deux choix), 'standalone' (première tablette), 'extra' (tablette supplémentaire), 'team' (option avancée).
  let mode = 'choice';
  let probe = null, probeKey = '', profileId = '';
  let manualIni = false, manualUser = false;   // initiales / identifiant modifiés à la main : plus de proposition
  const extra = { file: null, rx: null, pv: null, profileId: '' };   // tablette supplémentaire : fichier ouvert, agent choisi
  const back = html`<button type="button" class="btn ghost sm" data-act="mode" data-value="choice" style="margin-bottom:10px">← Revenir au choix de mise en service</button>`;
  const choice = () => html`<div class="setup-choices" id="setupChoice" role="group" aria-label="Mise en service">
      <button type="button" class="setup-choice" data-act="mode" data-value="standalone" id="setupFirst"><span class="setup-choice-ic">${icon('station', { size: 30 })}</span>
        <span><b>Première tablette de l’équipe</b><span class="setup-choice-sub">L’administrateur crée son compte et le mot de passe d’échange, puis ajoute les agents. Les autres tablettes recevront ensuite ses données par fichier.</span></span></button>
      <button type="button" class="setup-choice" data-act="mode" data-value="extra" id="setupExtra"><span class="setup-choice-ic">${icon('download', { size: 30 })}</span>
        <span><b>Tablette supplémentaire : recevoir le fichier de l’autre tablette</b><span class="setup-choice-sub">Sur la première tablette : Échanges entre tablettes › « Tout envoyer ». Ici : choisir ce fichier, saisir le mot de passe d’échange, puis « Qui êtes-vous ? ».</span></span></button>
    </div>
    <details class="setup-adv" id="setupAdvanced"><summary>Option avancée : mode équipe GitHub — nécessite un jeton GitHub — non utilisé à l’OEG</summary>
      <p class="note">Synchronisation par un dépôt GitHub privé de données. L’OEG ne l’utilise pas : les tablettes échangent leurs données par fichier.</p>
      <button type="button" class="btn ghost" data-act="mode" data-value="team">Rejoindre une équipe (dépôt GitHub privé)</button></details>`;
  const first = () => html`${back}<form data-submit="standalone" autocomplete="off">
        <div class="banner info">Les données restent chiffrées sur cette tablette, sans connexion nécessaire. Chaque agent y aura son compte et son mot de passe (Administration › Agents de cette tablette) ; les échanges avec l’autre tablette se font par fichier.</div>
        <div class="field"><label>Organisme</label><input name="orgName" value="Office de l’Eau de Guyane" required></div>
        <div class="grid2">
          <div class="field"><label>Nom de la tablette</label><input name="deviceName" value="Tablette 1" required placeholder="ex. Tablette 1"></div>
          <div class="field"><label>N° de la tablette (1 à 99)</label><input name="deviceNumber" type="number" min="1" max="99" value="1" required><div class="hint">Différent sur chaque tablette (1, 2…) : garantit des numéros d’audit uniques.</div></div>
        </div>
        <h3>Votre compte (administrateur de la tablette)</h3>
        <div class="grid2">
          <div class="field"><label>Nom</label><input name="lastName" required autocomplete="family-name" autocapitalize="words" data-input="setup-name"></div>
          <div class="field"><label>Prénom</label><input name="firstName" required autocomplete="given-name" autocapitalize="words" data-input="setup-name"></div>
          <div class="field"><label>Initiales</label><input name="initials" required maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" data-input="setup-ini"><div class="hint">Affichées sur l’écran « Qui utilise la tablette ? ».</div></div>
          <div class="field"><label>Identifiant</label><input name="username" required autocapitalize="none" autocomplete="username" spellcheck="false" data-input="setup-user"><div class="hint">Proposé à partir du prénom et du nom ; le même sur toutes les tablettes.</div></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
          <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"></div>
        </div>
        <h3>Mot de passe d’échange de l’équipe</h3>
        <p class="note">Il chiffre les fichiers échangés avec l’autre tablette (Quick Share, Bluetooth, e-mail, Teams, clé USB). Le même sur toutes les tablettes : il sera saisi une seule fois, à la mise en service de la tablette supplémentaire ; ensuite, envoyer et recevoir ne demandent plus rien. Différent de votre mot de passe ; communiquez-le de vive voix.</p>
        <div class="grid2">
          <div class="field"><label>Mot de passe d’échange (10 caractères min.)</label><input name="exchangePassword" type="password" required minlength="10" autocomplete="new-password"></div>
          <div class="field"><label>Confirmer le mot de passe d’échange</label><input name="exchangePassword2" type="password" required autocomplete="new-password"></div>
        </div>
        <p class="note" id="setupSecond">Une tablette de l’équipe est déjà en service ? Revenez au choix précédent : « Tablette supplémentaire : recevoir le fichier de l’autre tablette » (aucun profil en double).</p>
        <label class="check sel"><input type="checkbox" name="oeg" checked> Reprendre le référentiel des fiches terrain OEG (stations, organismes, préleveurs, campagnes)</label>
        <label class="check" style="margin-top:8px"><input type="checkbox" name="demo"> Ajouter des données de démonstration fictives (prestataire « DÉMO », 3 prestations, documents « EXEMPLE »)</label>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="setupBtn">Créer et ouvrir la session</button>
      </form>`;
  const extraForm = () => {
    if (!extra.rx) {
      return html`${back}<form data-submit="extra-open" id="extraOpenForm" autocomplete="off">
        <div class="banner info">Sur la première tablette : Échanges entre tablettes › <b>« Tout envoyer »</b>, puis faites passer le fichier sur cette tablette (Quick Share, Bluetooth, e-mail, Teams, clé USB).</div>
        <div class="field"><label>Fichier d’échange (OEG-echange_….oegct)</label>
          <label class="btn ghost block" id="extraPick">${icon('download')}Choisir le fichier<input type="file" id="extraFile" hidden data-change="extra-file"></label>
          <div class="hint" id="extraFileName">${extra.file ? extra.file.name : 'Aucun fichier choisi (dossier Téléchargements après Quick Share, Bluetooth ou e-mail)'}</div></div>
        <div class="field"><label>Mot de passe d’échange de l’équipe</label><input name="exchangePassword" type="password" required autocomplete="off"><div class="hint">Celui défini sur la première tablette ; il sera enregistré sur cette tablette.</div></div>
        <p class="hint" id="extraErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="extraOpen">Ouvrir le fichier</button>
      </form>`;
    }
    const agents = extra.agents;
    const number = extra.number;
    return html`${back}${extraPreview(extra.pv)}
      <form data-submit="extra" id="extraForm" autocomplete="off">
        <div class="grid2">
          <div class="field"><label>Nom de la tablette</label><input name="deviceName" value="Tablette ${number}" required></div>
          <div class="field"><label>N° de la tablette (1 à 99)</label><input name="deviceNumber" type="number" min="1" max="99" value="${number}" required><div class="hint">Différent de celui des autres tablettes (${extra.pv.from.name || 'autre tablette'} : n° ${extra.pv.from.number || '?'}).</div></div>
        </div>
        <h3>Qui êtes-vous ?</h3>
        <p class="note">Touchez votre nom : vous gardez le MÊME profil que sur l’autre tablette (tournées, saisies, journal). Les autres agents s’ajoutent ensuite : Administration › Agents pas encore sur cette tablette › « Ajouter sur cette tablette » — par un administrateur (si vous n’en êtes pas un, un administrateur s’ajoute d’abord lui-même sur cette tablette).</p>
        ${agents.length ? html`<div class="user-tiles" role="group" aria-label="Agents reçus">${agents.map(u => html`<button type="button" class="user-tile ${u.id === extra.profileId ? 'sel' : ''}" data-act="extra-pick" data-id="${u.id}" data-u="${u.username}" aria-pressed="${u.id === extra.profileId}">
            <span class="avatar">${agentInitials(u)}</span><span><b>${u.name}</b><br><span class="tiny muted">${auth.ROLES[u.role] || u.role} · ${u.username}</span></span></button>`)}</div>`
          : html`<div class="banner nc">Aucun agent actif dans ce fichier : demandez à l’autre tablette de « Tout envoyer ».</div>`}
        <div class="grid2">
          <div class="field"><label>Votre mot de passe sur cette tablette (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
          <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"></div>
        </div>
        <p class="hint">Il peut être le même que sur l’autre tablette ; il ouvre votre session ici, hors connexion.</p>
        <p class="hint" id="setupErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="extraBtn" ${agents.length ? '' : 'disabled'}>Mettre en service la tablette</button>
      </form>`;
  };
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      ${LOGO()}
      <h1>Mise en service de la tablette</h1>
      <p class="sub">Fiches de contrôle terrain — première utilisation sur cette tablette.</p>
      ${mode === 'choice' ? choice() : mode === 'standalone' ? first() : mode === 'extra' ? extraForm() : html`<button type="button" class="btn ghost sm" data-act="mode" data-value="choice" style="margin-bottom:10px">← Revenir au mode autonome (celui de l’OEG)</button>
      <form data-submit="team" autocomplete="off" id="teamForm">
        <div class="banner warn">Mode équipe GitHub — nécessite un jeton GitHub — non utilisé à l’OEG.</div>
        <div class="banner info">Les données de l’équipe sont partagées par un dépôt GitHub <b>privé</b>, lu et écrit directement depuis cette tablette avec <b>le jeton d’accès de la tablette</b>, créé par l’administrateur (aucun serveur ; les agents n’ont pas besoin de compte GitHub). Sur la tablette, les données restent chiffrées et la session s’ouvre ensuite hors connexion.</div>
        <h3>Dépôt de données de l’équipe</h3>
        <div class="field"><label>Dépôt GitHub (propriétaire/nom) <span class="req">*</span></label><input name="repoSpec" required placeholder="CSRE-DCE/fiche-de-controle-donnees" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label>Jeton d’accès « fine-grained » de la tablette <span class="req">*</span></label><input name="token" type="password" required placeholder="github_pat_…" autocomplete="off" spellcheck="false"><div class="hint">Un jeton par tablette (nommé « Tablette 1 », « Tablette 2 »…), limité à ce dépôt, permission « Contents : Read and write ». Conservé chiffré sur cette tablette.</div></div>
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
        <h3>Cette tablette et le compte de l’administrateur</h3>
        <div class="field"><label>Nom de la tablette</label><input name="deviceName" value="${auth.defaultDeviceName()}" required placeholder="ex. Tablette 1"></div>
        <p class="note" id="teamAccountHelp">Le compte créé ici est celui de la personne qui configure la tablette — en général <b>l’administrateur</b>, propriétaire du jeton. Les autres agents n’ont pas besoin de compte GitHub : ils sont ajoutés ensuite dans <b>Administration › Agents de cette tablette</b>, chacun choisissant son mot de passe.</p>
        <div id="teamProfiles"></div>
        <div class="field"><label>Nom et prénom</label><input name="name" required autocomplete="name"></div>
        <div class="grid2">
          <div class="field"><label>Identifiant local</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
          <div class="field"><label>Mot de passe (8 caractères min.)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="field"><label>Confirmer le mot de passe</label><input name="password2" type="password" required autocomplete="new-password"><div class="hint">Ce mot de passe ouvre la session sur cette tablette, y compris hors connexion. Il n’est jamais envoyé à GitHub.</div></div>
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
  /** Profil existant choisi (« C'est moi ») : nom et identifiant repris du profil, non modifiables. */
  function applyProfile(form) {
    const u = (probe?.profiles || []).find(x => x.id === profileId) || null;
    const name = form.querySelector('[name=name]'), username = form.querySelector('[name=username]');
    if (u) { name.value = u.name; username.value = u.username; }
    else if (name.readOnly) { name.value = ''; username.value = ''; }
    name.readOnly = username.readOnly = !!u;
    form.querySelector('#teamProfiles').innerHTML = String(profilesChoice(probe, profileId));
  }
  async function check(form) {
    const v = formValues(form), box = form.querySelector('#teamProbe'), initBox = form.querySelector('#teamInit');
    probe = null; probeKey = ''; profileId = '';
    box.innerHTML = String(html`<p class="note">Vérification auprès de GitHub…</p>`);
    const { probeTeam } = await import('../app/sync.js');
    try {
      probe = await probeTeam(settingsOf(v), String(v.token || '').trim(), { profiles: true });
      probeKey = keyOf(v);
      box.innerHTML = String(probeSummary(probe));
      initBox.hidden = probe.initialized || !probe.repo.private;
      form.querySelector('#teamBtn').textContent = probe.initialized ? 'Rejoindre l’équipe' : 'Initialiser le dépôt et créer l’équipe';
      // Deuxième tablette : l'administrateur retrouve son profil (choisi par défaut s'il est seul).
      profileId = probe.profiles?.length === 1 ? probe.profiles[0].id : '';
      applyProfile(form);
      return probe;
    } catch (e) {
      box.innerHTML = String(html`<div class="banner nc">${errText(e)}</div>`);
      initBox.hidden = true;
      applyProfile(form);
      throw e;
    }
  }
  draw();
  bind(root, {
    mode(el) {
      mode = el.dataset.value; probe = null; probeKey = ''; profileId = ''; manualIni = manualUser = false;
      if (mode === 'choice') Object.assign(extra, { file: null, rx: null, pv: null, profileId: '' });
      draw();
    },
    /** Nom ou prénom saisi : initiales et identifiant proposés (tant qu'ils n'ont pas été modifiés à la main). */
    'setup-name'(el) {
      const f = el.closest('form'), fn = f.querySelector('[name=firstName]').value, ln = f.querySelector('[name=lastName]').value;
      if (!manualIni) f.querySelector('[name=initials]').value = fn || ln ? agentInitials({ firstName: fn, lastName: ln }) : '';
      if (!manualUser) f.querySelector('[name=username]').value = suggestUsername(fn, ln);
    },
    'setup-ini'(el) { manualIni = !!el.value; },
    'setup-user'(el) { manualUser = !!el.value; },
    'pick-profile'(el) { profileId = el.value || ''; applyProfile(el.closest('form')); },
    async standalone(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#setupBtn');
      err.textContent = '';
      if (v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      const { validateExchangePassword, setExchangePassword } = await import('../app/exchange.js');
      try { validateExchangePassword(v.exchangePassword); } catch (e) { err.textContent = e.message; return; }
      if (v.exchangePassword !== v.exchangePassword2) { err.textContent = 'Les deux mots de passe d’échange ne correspondent pas.'; return; }
      btn.disabled = true; btn.textContent = 'Préparation de la tablette…';
      try {
        await auth.setupStandalone({ deviceName: v.deviceName, deviceNumber: v.deviceNumber, admin: { firstName: v.firstName, lastName: v.lastName, initials: v.initials, username: v.username, password: v.password } });
        await seedAll({ oeg: !!v.oeg, demo: !!v.demo });
        await saveOrgSettings({ orgName: v.orgName }, 'Configuration initiale');
        await setExchangePassword(v.exchangePassword, { reason: 'Mise en service de la première tablette' });
        toast('Tablette mise en service ✓ — ajoutez maintenant les agents (Administration)', 'ok', 5000);
        onDone({ password: v.password });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Créer et ouvrir la session'; }
    },
    /* ---------- Tablette supplémentaire ---------- */
    'extra-file'(el) {
      extra.file = el.files[0] || null;
      const n = root.querySelector('#extraFileName'); if (n) n.textContent = extra.file ? extra.file.name : 'Aucun fichier choisi';
      root.querySelector('#extraErr').textContent = '';
    },
    async 'extra-open'(form) {
      const err = form.querySelector('#extraErr'), btn = form.querySelector('#extraOpen'), pw = formValues(form).exchangePassword;
      err.textContent = '';
      if (!extra.file) { err.textContent = 'Choisissez d’abord le fichier envoyé par l’autre tablette.'; return; }
      btn.disabled = true; btn.textContent = 'Ouverture du fichier…';
      try {
        const X = await import('../app/exchange.js');
        const rx = await X.readExchange(extra.file, { password: pw, knownPassword: null });
        if (rx.legacy) throw new Error('Ancien paquet de données : pour une mise en service, choisissez le fichier d’échange « OEG-echange_….oegct » (sur la première tablette : Échanges entre tablettes › « Tout envoyer »).');
        extra.rx = rx; extra.pv = await X.previewExchange(rx);
        extra.agents = X.setupProfiles(rx);
        extra.number = X.proposedDeviceNumber(rx);
        extra.profileId = extra.agents.length === 1 ? extra.agents[0].id : '';
        draw();
      } catch (e) {
        err.textContent = e.code === 'password' ? 'Mot de passe d’échange incorrect pour ce fichier : vérifiez-le auprès de l’administrateur (le même que sur la première tablette).' : e.message;
        btn.disabled = false; btn.textContent = 'Ouvrir le fichier';
      }
    },
    'extra-pick'(el) {
      extra.profileId = el.dataset.id;
      root.querySelectorAll('[data-act=extra-pick]').forEach(t => { t.classList.toggle('sel', t === el); t.setAttribute('aria-pressed', String(t === el)); });
      root.querySelector('#setupErr').textContent = '';
      root.querySelector('#extraForm [name=password]')?.focus();
    },
    async extra(form) {
      const v = formValues(form), err = form.querySelector('#setupErr'), btn = form.querySelector('#extraBtn');
      err.textContent = '';
      if (!extra.profileId) { err.textContent = 'Touchez d’abord votre nom (« Qui êtes-vous ? »).'; return; }
      if (v.password !== v.password2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
      btn.disabled = true; btn.textContent = 'Mise en service et réception des données…';
      try {
        const X = await import('../app/exchange.js');
        const report = await X.setupFromExchange(extra.rx, { deviceName: v.deviceName, deviceNumber: v.deviceNumber, profileId: extra.profileId, password: v.password });
        const admin = auth.can('users.manage');
        toast(`Tablette mise en service ✓ — ${X.receiveSummary(report)}. ${admin ? 'Ajoutez maintenant les autres agents (Administration).' : 'Un administrateur doit maintenant s’ajouter sur cette tablette (Administration) pour y ajouter les autres agents.'}`, 'ok', 8000);
        // Étape suivante : administrateur → ajouter les agents (« Agents pas encore sur cette tablette ») ; agent → accueil.
        history.replaceState(null, '', admin ? '#/administration' : '#/');
        onDone({ password: v.password });
      } catch (e) {
        console.error(e);
        // Tablette déjà créée (session ouverte) mais réception interrompue : on entre, « Recevoir un fichier » reste possible.
        if (session.unlocked) { toast('Tablette mise en service, mais réception interrompue : ' + e.message + ' (Échanges entre tablettes › Recevoir un fichier)', 'err', 9000); history.replaceState(null, '', '#/synchronisation'); onDone({ password: v.password }); return; }
        err.textContent = e.message; btn.disabled = false; btn.textContent = 'Mettre en service la tablette';
      }
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
      const mine = !init ? (p.profiles || []).find(x => x.id === profileId) : null;
      btn.textContent = 'Préparation de l’appareil…';
      try {
        await auth.setupTeam({ deviceName: v.deviceName, account: { id: mine?.id || null, name: mine?.name || v.name, username: mine?.username || v.username, password: v.password }, team: { ...p.team, orgName: v.orgName || p.equipe?.orgName || '' }, token, login: p.login, role: init ? 'admin' : (p.member?.role || mine?.role || 'auditeur') });
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

/**
 * Ouverture de session « Qui utilise la tablette ? » : une tuile par agent de la tablette (derniers connectés en
 * premier), mot de passe de l'agent, aide si un agent n'y figure pas (ajout par un administrateur).
 * pick : 'last' = dernier agent connecté présélectionné ; 'none' (après « Changer d'agent ») = l'agent suivant
 * touche d'abord son nom (sauf agent unique).
 */
export async function renderLogin(root, { message = '', onUnlocked, pick = 'last' }) {
  const users = await auth.knownUsers();
  let selected = pick === 'none' && users.length > 1 ? '' : users[0]?.username || '';
  const draw = () => {
    root.innerHTML = String(html`<div class="auth"><div class="auth-card">
      ${LOGO()}
      <h1>Qui utilise la tablette ?</h1>
      <p class="sub">${navigator.onLine ? 'Fiches de contrôle terrain' : 'Hors connexion — ouverture de session locale'} : touchez votre nom puis saisissez votre mot de passe</p>
      ${message ? html`<div class="banner info" id="loginMsg">${message}</div>` : ''}
      <form data-submit="login" autocomplete="off">
        <div class="user-tiles" role="group" aria-label="Agents de cette tablette">${users.map(u => html`<button type="button" class="user-tile ${u.username === selected ? 'sel' : ''}" data-act="pick" data-u="${u.username}" aria-pressed="${u.username === selected}">
          <span class="avatar">${agentInitials(u)}</span>
          <span><b>${u.name}</b><br><span class="tiny muted">${auth.ROLES[u.role] || u.role} · ${u.username}${u.disabled ? ' · désactivé' : ''}</span></span></button>`)}</div>
        <div class="field"><label for="loginPw">Mot de passe${users.length > 1 ? html` <b id="loginWho">${selected ? '— ' + (users.find(u => u.username === selected)?.name || '') : '(touchez d’abord votre nom)'}</b>` : ''}</label><input id="loginPw" name="password" type="password" required autocomplete="current-password" autofocus></div>
        <p class="hint" id="loginErr" style="color:var(--nc)"></p>
        <button class="btn primary lg block" type="submit" id="loginBtn">Ouvrir la session</button>
      </form>
      <p class="note login-help" id="loginHelp">Votre nom n’apparaît pas ? Demandez à un administrateur de vous ajouter sur cette tablette : <b>Administration › Agents de cette tablette</b>.</p>
      ${footer()}
    </div></div>`);
    root.querySelector('input[name=password]')?.focus();
  };
  draw();
  bind(root, {
    pick(el) {
      selected = el.dataset.u;
      root.querySelectorAll('.user-tile').forEach(t => { t.classList.toggle('sel', t === el); t.setAttribute('aria-pressed', String(t === el)); });
      const who = root.querySelector('#loginWho'); if (who) who.textContent = '— ' + (users.find(u => u.username === selected)?.name || '');
      const pw = root.querySelector('input[name=password]'); pw.value = ''; root.querySelector('#loginErr').textContent = ''; pw.focus();
    },
    async login(form) {
      const v = formValues(form), err = form.querySelector('#loginErr'), btn = form.querySelector('#loginBtn');
      err.textContent = '';
      if (!selected) { err.textContent = 'Touchez d’abord votre nom.'; return; }
      btn.disabled = true; btn.textContent = 'Vérification…';
      try {
        const r = await auth.unlock(selected, v.password);
        if (!r.ok) { err.textContent = r.error; btn.disabled = false; btn.textContent = 'Ouvrir la session'; return; }
        onUnlocked({ password: v.password });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Ouvrir la session'; }
    }
  });
}
