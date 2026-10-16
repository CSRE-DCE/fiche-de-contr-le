/* « Échanges entre tablettes » (mode autonome, celui de l'OEG) : « Envoyer à l'autre tablette » (modifications
 * depuis le dernier envoi, ou tout), « Recevoir un fichier », historique des envois et réceptions, tablettes
 * connues, conflits et résolution (js/views/exchange.js, js/app/exchange.js). Le mode équipe n'y apparaît qu'en
 * option avancée repliée, « nécessite un jeton GitHub — non utilisé à l'OEG ».
 * « Synchronisation » (mode équipe, dépôt GitHub privé de données) : configuration et test de la connexion, aide pas
 * à pas, état, file d'envoi, conflits et résolution, journal, échanges par paquets. */
import { html, raw, fmtDateTime, sortBy, compactValue, clone, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, isTeamMode, teamLabel, tokenInfo, ROLES, TEAM_DEFAULTS } from '../core/auth.js';
import { toast, promptDialog, confirmDialog, openModal, formValues, downloadBlob, readFileAsText } from '../ui/dom.js';
import { pageTitle, kv, badge, field } from '../ui/components.js';
import {
  runSync, syncState, outboxEntries, retryRejected, dropOutboxEntry, prefetchMedia, testConnection, initializeRepo,
  attachDevice, detachDevice, replaceToken, readTeamConfig
} from '../app/sync.js';
import { reservedBlocks, fmtNumber } from '../app/numbering.js';
import { parseRepoSpec } from '../app/github.js';
import { tokenHelp, probeSummary } from './auth.js';
import { exchangeCard, historyCard, sendDialog, receiveFile, passwordDialog } from './exchange.js';
import { knownDevices } from '../app/exchange.js';

const TYPE_LABELS = { audit: 'Audits', deviation: 'Écarts', media: 'Médias (métadonnées)', __bin: 'Fichiers (photos, documents)', trail: 'Journal d’audit', prestation: 'Prestations', observation: 'Observations', alert: 'Alertes d’urgence', document: 'Documents', grid: 'Grilles', site: 'Stations', user: 'Utilisateurs' };
const show = v => { const c = compactValue(v, 160); return c === undefined || c === null ? '—' : typeof c === 'string' ? c : JSON.stringify(c); };
const short = sha => sha ? String(sha).slice(0, 7) : '';
const errText = e => e?.message === 'Failed to fetch' ? 'GitHub injoignable : vérifiez la connexion réseau.' : (e?.message || String(e));
let lastTest = null;   // résultat du dernier « Tester la connexion » (affiché 10 minutes)

/** Applique une valeur à un chemin « a.b[id].c » (identifiants d'éléments de liste entre crochets). */
export function setPath(obj, path, value) {
  const segs = [];
  for (const part of path.split('.')) { const m = part.match(/^([^[]*)((?:\[[^\]]+\])*)$/); if (m[1]) segs.push(m[1]); for (const b of m[2].matchAll(/\[([^\]]+)\]/g)) segs.push({ id: b[1] }); }
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], last = i === segs.length - 1;
    if (typeof s === 'object') {
      const idx = cur.findIndex(x => x.id === s.id);
      if (last) { if (value === null || value === undefined) { if (idx >= 0) cur.splice(idx, 1); } else if (idx >= 0) cur[idx] = value; else cur.push(value); return obj; }
      cur = cur[idx];
    } else {
      if (last) { if (value === undefined) delete cur[s]; else cur[s] = value; return obj; }
      if (cur[s] === undefined) cur[s] = typeof segs[i + 1] === 'object' ? [] : {};
      cur = cur[s];
    }
    if (cur === undefined) throw new Error('Chemin introuvable : ' + path);
  }
  return obj;
}

/** Lien vers un commit (github.com uniquement). */
function commitLink(sha) {
  const t = session.team;
  if (!sha) return '—';
  if (t?.apiUrl === TEAM_DEFAULTS.apiUrl) return html`<a class="mono" href="https://github.com/${t.owner}/${t.repo}/commit/${sha}" target="_blank" rel="noopener">${short(sha)}</a>`;
  return html`<span class="mono">${short(sha)}</span>`;
}

function testResult(r) {
  if (!r) return '';
  if (r.error) return html`<div class="banner nc" style="margin-top:10px">Échec du test : ${r.error}</div>`;
  const dev = r.device;
  return html`<div style="margin-top:10px">${probeSummary(r)}
    ${r.initialized ? html`<div class="banner ${dev?.revoked ? 'nc' : 'info'}">${dev ? (dev.revoked ? `Cet appareil est RÉVOQUÉ dans l’équipe (le ${fmtDateTime(dev.revokedAt)}).` : `Cet appareil est enregistré dans l’équipe sous le n° ${dev.no}.`) : 'Cet appareil n’est pas encore enregistré dans l’équipe : il le sera à la prochaine synchronisation.'}</div>` : ''}</div>`;
}

/** Aide pas à pas et transparence sur la sécurité du mode équipe. */
function helpCard(open) {
  return html`<div class="card"><details ${open ? raw('open') : ''}><summary>Mettre en place le dépôt de l’équipe — pas à pas</summary>
    <ol class="note" style="padding-left:20px">
      <li><b>Administrateur</b> : créer sur GitHub un dépôt <b>privé</b> de données (ex. <span class="mono">CSRE-DCE/fiche-de-controle-donnees</span>), distinct du dépôt public de l’application ; l’ajouter vide ou avec un README.</li>
      <li><b>Un jeton par tablette</b> : l’administrateur crée, depuis son compte GitHub, un jeton « fine-grained » par tablette (voir ci-dessous), nommé d’après la tablette (« Tablette 1 », « Tablette 2 »…). Les agents n’ont pas besoin de compte GitHub. Un jeton n’est jamais copié sur une autre tablette.</li>
      <li><b>Première tablette</b> (administrateur) : « Rejoindre une équipe » (ou, sur un appareil autonome déjà utilisé, « Rattacher cet appareil ») avec le jeton « Tablette 1 » : le dépôt vide est initialisé (config/equipe.json, utilisateurs.json, appareils.json, sequences.json) puis le référentiel est envoyé.</li>
      <li><b>Agents</b> : Administration › Agents de cette tablette › « Ajouter un agent » ; chaque agent choisit et saisit son mot de passe.</li>
      <li><b>Deuxième tablette</b> : « Rejoindre une équipe » avec le même dépôt et le jeton « Tablette 2 » (l’administrateur y retrouve son profil), puis Administration › « Agents pas encore sur cette tablette » › <b>Ajouter sur cette tablette</b> pour chaque agent (même profil, mot de passe choisi par l’agent). Les données sont ensuite synchronisées automatiquement (à chaque modification et toutes les 5 minutes en ligne).</li>
      <li>Tablette perdue ou volée : Administration › Appareils de l’équipe › « Désactiver (perdu) » ET révoquer le jeton de cette tablette sur GitHub.</li>
    </ol>
    <h3>Créer le jeton</h3>${tokenHelp()}
    <h3>Sécurité : ce qu’il faut savoir</h3>
    <ul class="note" style="padding-left:20px">
      <li>La vraie protection des données partagées est l’<b>accès au dépôt privé</b> : toute personne disposant d’un jeton valide sur ce dépôt peut en lire et modifier tous les fichiers, quel que soit son profil dans l’application. Les profils (auditeur, superviseur…) et les verrouillages d’audits signés sont appliqués par l’application, pas par GitHub.</li>
      <li>L’historique Git du dépôt conserve toutes les versions (qui a écrit quoi et quand) ; les audits signés restent scellés par leur empreinte et le journal d’audit chaîné permet de détecter une altération.</li>
      <li>Sur l’appareil, les données et le jeton sont chiffrés avec la clé de l’appareil (déverrouillée par le mot de passe local). Dans le dépôt, les fichiers sont en clair pour les personnes ayant accès au dépôt.</li>
      <li>Révoquer un appareil (Administration) efface ses données à sa prochaine synchronisation, mais ne désactive PAS le jeton : pour une tablette perdue, révoquez aussi <b>le jeton de cette tablette</b> sur GitHub (Settings › Developer settings › Fine-grained tokens).</li>
      <li>Ne jamais rendre le dépôt de données public ; limiter le jeton à ce seul dépôt et à la permission « Contents » ; préférer une expiration courte.</li>
    </ul></details></div>`;
}

/** Conflits (les deux modes) : fusion automatique, valeurs écartées consultables et restaurables. */
function conflictsCard(conflicts) {
  return html`<div class="card" id="conflicts"><h2>Conflits (${conflicts.filter(c => !c.resolved).length} à examiner)</h2>
    ${conflicts.length ? html`<div class="list">${conflicts.map(c => html`<div class="li ${c.resolved ? '' : 'stripe-warn'}"><div class="li-main"><div class="li-title">${TYPE_LABELS[c.entityType] || c.entityType} — ${c.label}</div><div class="li-sub">${fmtDateTime(c.at)} · ${c.details.length} valeur(s) en concurrence${c.origin ? ' · ' + c.origin : ''}</div>${c.resolved ? badge('Examiné — ' + (c.resolution || ''), 'ok') : ''}</div><button class="btn ghost sm" data-act="conflict" data-id="${c.id}">Examiner</button></div>`)}</div>`
      : html`<p class="note">Aucun conflit. En cas de modifications concurrentes d’une même donnée sur deux tablettes, la fusion est faite champ par champ et les valeurs écartées sont conservées ici.</p>`}</div>`;
}

/** Écran du mode autonome : échanges entre tablettes par fichier (aucun serveur, aucun jeton). */
async function standaloneView(conflicts, admin) {
  const devices = await knownDevices();
  return html`${pageTitle('Échanges entre tablettes', 'Mode autonome : les tablettes s’échangent un fichier chiffré, même sans connexion')}
    ${await exchangeCard()}
    ${historyCard()}
    ${conflictsCard(conflicts)}
    <div class="card"><h2>Tablettes de l’équipe</h2>${kv([['Cette tablette', `${session.device.name} (n° ${session.device.number})`], ['Connexion', navigator.onLine ? 'En ligne (non nécessaire)' : 'Hors connexion']])}
      ${devices.length > 1 ? html`<div class="list" style="margin-top:8px">${devices.filter(d => !d.self).map(d => html`<div class="li"><div class="li-main"><div class="li-title">${d.name || 'Tablette'}${d.number ? ` (n° ${d.number})` : ''}</div><div class="li-sub">${d.seenAt ? 'dernier fichier reçu le ' + fmtDateTime(d.seenAt) : 'connue par un fichier reçu'}${Number(d.number) === Number(session.device.number) ? ' · MÊME N° que cette tablette : numéros d’audit en double possibles' : ''}</div></div></div>`)}</div>` : html`<p class="note">Aucune autre tablette connue : elle apparaîtra à la réception de son premier fichier.</p>`}
      <p class="note">Chaque agent a son compte et son mot de passe sur chaque tablette (Administration › Agents de cette tablette). Les fichiers sont toujours chiffrés avec le mot de passe d’échange de l’équipe.</p></div>
    <details class="card" id="teamAdvanced"><summary>Option avancée : mode équipe GitHub — nécessite un jeton GitHub — non utilisé à l’OEG</summary>
      <p class="note">Synchronisation automatique par un dépôt GitHub privé de données. L’OEG ne l’utilise pas : les tablettes échangent leurs données par fichier.</p>
      ${admin ? html`<button class="btn ghost" data-act="attach">Rejoindre une équipe (dépôt GitHub)</button>` : html`<p class="note">Le rattachement à une équipe est réservé à l’administrateur de la tablette.</p>`}
      ${helpCard(false)}</details>`;
}

export default {
  nav: 'sync', get title() { return isTeamMode() ? 'Synchronisation' : 'Échanges entre tablettes'; },
  async render() {
    const conflicts = sortBy(store.all('conflict'), x => x.resolved ? 1 : 0, '-at');
    if (!isTeamMode()) return standaloneView(conflicts, can('settings.manage'));
    const out = await outboxEntries();
    const byType = {};
    for (const e of out) byType[e.type] = (byType[e.type] || 0) + 1;
    const rejected = out.filter(e => e.rejected);
    const logs = sortBy(store.all('syncLog'), '-at').slice(0, 30);
    const team = isTeamMode() && session.team;
    const tok = team ? tokenInfo() : null;
    const cfg = team ? await readTeamConfig().catch(() => null) : null;
    const blocks = team ? await reservedBlocks() : [];
    const member = (cfg?.utilisateurs?.users || []).find(u => String(u.login).toLowerCase() === String(session.githubLogin || '').toLowerCase());
    // Agent connecté : profil d'équipe s'il est rattaché à un login GitHub, sinon profil défini par l'administrateur.
    const myLogin = store.get('user', session.user.id)?.githubLogin || '';
    const admin = can('settings.manage');
    return html`${pageTitle('Synchronisation', team ? `Équipe — dépôt GitHub ${teamLabel()}` : 'Mode autonome (aucun dépôt d’équipe)')}
      <div class="card"><h2>État</h2>${team ? html`${kv([
        ['Mode', 'Équipe — dépôt GitHub privé, synchronisation différentielle'],
        ['Dépôt de données', html`<span class="mono">${teamLabel()}</span> · branche <span class="mono">${session.team.branch}</span> · dossier <span class="mono">${session.team.prefix || '(racine)'}</span>${session.team.apiUrl !== TEAM_DEFAULTS.apiUrl ? html` · API <span class="mono">${session.team.apiUrl}</span>` : ''}`],
        ['Équipe', cfg?.equipe?.orgName || ''],
        ['Jeton de la tablette', session.githubLogin ? html`compte GitHub @${session.githubLogin} (propriétaire du jeton)${member ? ` — profil d’équipe : ${ROLES[member.role] || member.role}${member.active === false ? ' (désactivé)' : ''}` : ' — absent de config/utilisateurs.json'}` : ''],
        ['Agent connecté', `${session.user.name} — ${ROLES[session.user.role] || session.user.role}${myLogin ? ` (profil d’équipe de @${myLogin})` : ' (profil défini par l’administrateur ; aucun compte GitHub nécessaire)'}`],
        ['Jeton d’accès', tok ? html`${syncState.needsLogin ? badge('refusé ou expiré — à renouveler', 'nc') : badge('enregistré (chiffré)', 'ok')} <span class="tiny muted">le ${fmtDateTime(tok.savedAt)}</span>` : badge('absent — à renseigner', 'nc')],
        ['Connexion', navigator.onLine ? 'En ligne' : 'Hors connexion'],
        ['Appareil', `${session.device.name} (n° ${session.device.number}) — ${session.device.id}`],
        ['Modifications en attente d’envoi', String(out.length)],
        ['Dernière synchronisation', syncState.lastSyncAt ? fmtDateTime(syncState.lastSyncAt) : 'aucune'],
        ['Dernier commit', syncState.lastResult?.commit || syncState.lastResult?.head ? commitLink(syncState.lastResult.commit || syncState.lastResult.head) : ''],
        ['Numéros d’audit réservés', blocks.length ? blocks.map(b => `${fmtNumber(b.key.split('-')[0], b.key.split('-')[1], b.next)} → ${b.to}`).join(' ; ') : 'aucun (réservés à la prochaine synchronisation)'],
        ['Dépôt initialisé', syncState.initialized === false ? html`${badge('non', 'nc')}` : ''],
        ['En cours', syncState.running ? (syncState.progress || 'synchronisation…') : ''],
        ['Dernière erreur', syncState.lastError]
      ])}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn primary lg" data-act="sync" ${syncState.running ? raw('disabled') : ''}>Synchroniser maintenant</button>
          <button class="btn ghost" data-act="test">Tester la connexion</button>
          <button class="btn ${syncState.needsLogin || !tok ? 'warn' : 'ghost'}" data-act="token">${tok ? 'Renouveler le jeton' : 'Renseigner le jeton'}</button>
          <button class="btn ghost" data-act="full">Réception complète</button>
          <button class="btn ghost" data-act="prefetch">Télécharger les documents pour le terrain</button>
          ${syncState.initialized === false && admin ? html`<button class="btn warn" data-act="init">Initialiser le dépôt</button>` : ''}
          ${admin ? html`<button class="btn danger-ghost" data-act="detach">Détacher cet appareil de l’équipe</button>` : ''}
        </div><div id="testResult">${lastTest && Date.now() - lastTest.at < 600000 ? testResult(lastTest) : ''}</div>`
      : ''}</div>
      ${helpCard(false)}
      <div class="card"><h2>File d’envoi</h2>${out.length ? html`<div class="row" style="gap:6px">${Object.entries(byType).map(([t, n]) => badge(`${TYPE_LABELS[t] || t} : ${n}`, 'outline'))}</div>` : html`<p class="note">Aucune modification en attente.</p>`}
        ${rejected.length ? html`<div class="banner nc" style="margin-top:10px">${rejected.length} modification(s) non envoyée(s).</div><div class="list">${rejected.map(e => html`<div class="li stripe-nc"><div class="li-main"><div class="li-title">${TYPE_LABELS[e.type] || e.type} — ${store.getRaw(e.type === '__bin' ? 'media' : e.type, e.id)?.number || store.getRaw('media', e.id)?.name || e.id}</div><div class="li-sub">${e.error}</div></div><button class="btn ghost sm" data-act="drop" data-key="${e.key}">Retirer</button></div>`)}</div><button class="btn ghost sm" data-act="retry">Réessayer</button>` : ''}</div>
      ${conflictsCard(conflicts)}
      <div class="card"><h2>Journal de synchronisation</h2>${logs.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Origine</th><th>Envois</th><th>Fichiers</th><th>Journal</th><th>Réceptions</th><th>Conflits</th><th>Commit</th><th>Erreurs</th></tr></thead><tbody>${logs.map(l => html`<tr><td>${fmtDateTime(l.at)}<div class="tiny muted">${l.durationMs} ms${l.attempts > 1 ? ` · ${l.attempts} essais` : ''}</div></td><td>${l.reason}</td><td>${l.pushed}</td><td>${l.media}</td><td>${l.journal ?? '—'}</td><td>${l.pulled}</td><td>${l.conflicts}</td><td>${commitLink(l.commit)}</td><td class="tiny">${(l.errors || []).join(' ; ') || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="note">Aucune synchronisation enregistrée sur cet appareil.</p>`}</div>
      <div class="card"><h2>Échanges par paquets (sans réseau)</h2>
        <p class="note">Pour transférer des données entre appareils sans dépôt d’équipe (ou hors réseau) : exporter un paquet sur l’un, l’importer sur l’autre. La fusion est faite champ par champ ; les valeurs concurrentes sont conservées dans les conflits ci-dessus. Sauvegarde chiffrée : écran Export.</p>
        <div class="btn-row"><button class="btn ghost" data-act="pkg-export">Exporter un paquet de données</button>
          ${can('ref.manage') ? html`<label class="btn ghost">Importer un paquet<input type="file" accept="application/json,.json" hidden data-change="pkg-import"></label>` : ''}
          <a class="btn ghost" href="#/export">Écran Export</a></div></div>`;
  },
  handlers: {
    /* Échanges entre tablettes (mode autonome) */
    async 'xch-send'() { if (await sendDialog()) this.refresh(); },
    async 'xch-send-all'() { if (await sendDialog({ scope: 'all' })) this.refresh(); },
    async 'xch-receive'(el) { const f = el.files[0]; el.value = ''; if (!f) return; if (await receiveFile(f)) this.refresh(); },
    async 'xch-password'() { if (await passwordDialog()) this.refresh(); },
    async sync() { const r = await runSync({ reason: 'manuelle' }); toast(r.skipped ? 'Synchronisation non lancée : ' + r.skipped : r.errors?.length ? 'Terminée avec erreurs : ' + r.errors[0] : `Synchronisé : ${r.pushed} envoi(s), ${r.pulled} réception(s)`, r.errors?.length || r.skipped ? 'warn' : 'ok', 5000); this.refresh(); },
    async full() { if (!(await confirmDialog({ title: 'Réception complète', message: 'Relire tout le dépôt de l’équipe (y compris le journal d’audit de plus de 4 mois des autres appareils) et retélécharger ce qui diffère ? Les modifications locales en attente sont conservées et fusionnées.' }))) return; const r = await runSync({ reason: 'réception complète', full: true }); toast(r.errors?.length ? r.errors[0] : `Réception : ${r.pulled || 0} élément(s)`, r.errors?.length ? 'warn' : 'ok'); this.refresh(); },
    async prefetch() { const n = await prefetchMedia(); toast(`${n} fichier(s) téléchargé(s) pour un usage hors connexion`, 'ok'); },
    async test(el) {
      el.disabled = true; el.textContent = 'Test en cours…';
      try { lastTest = { ...(await testConnection()), at: Date.now() }; } catch (e) { lastTest = { error: errText(e), at: Date.now() }; }
      this.refresh();
    },
    async token() {
      const m = openModal({ title: 'Jeton d’accès GitHub', body: html`<form id="tf">${field('Nouveau jeton « fine-grained »', html`<input name="token" type="password" required placeholder="github_pat_…" autocomplete="off" spellcheck="false">`, { hint: 'Jeton de cette tablette (créé par l’administrateur, nommé d’après la tablette), limité au dépôt ' + teamLabel() + ', permission « Contents : Read and write ». Il remplace le jeton de cette tablette.' })}<details><summary>Comment créer le jeton ?</summary>${tokenHelp()}</details><p class="hint" id="tfErr" style="color:var(--nc)"></p></form>`,
        actions: [{ label: 'Annuler' }, { label: 'Vérifier et enregistrer', act: 'ok', cls: 'primary' }],
        handlers: { async ok() {
          const f = this.root.querySelector('#tf'); if (!f.reportValidity()) return;
          const err = this.root.querySelector('#tfErr'); err.textContent = 'Vérification…';
          try { const p = await replaceToken(String(formValues(f).token).trim()); this.close(p); } catch (e) { err.textContent = errText(e); }
        } } });
      const p = await m.result; if (!p) return;
      toast(`Jeton enregistré (@${p.login})`, 'ok');
      await runSync({ reason: 'nouveau jeton' }); this.refresh();
    },
    async init() {
      if (!(await confirmDialog({ title: 'Initialiser le dépôt', message: `Créer la configuration de l’équipe dans ${teamLabel()} (utilisateurs, appareils, numéros) puis y envoyer les données de cet appareil ? Vous serez administrateur de l’équipe.`, okLabel: 'Initialiser' }))) return;
      try {
        await initializeRepo({ orgName: store.get('setting', 'org')?.orgName || '', republish: true });
        toast('Dépôt initialisé', 'ok');
        await runSync({ reason: 'initialisation du dépôt' });
      } catch (e) { toast(errText(e), 'err', 7000); }
      this.refresh();
    },
    async attach() {
      const m = openModal({ title: 'Rejoindre une équipe (dépôt GitHub)', wide: true, body: html`<form id="af">
          <div class="banner info">Toutes les données de cet appareil seront fusionnées avec celles du dépôt de l’équipe (rien n’est écrasé sans trace : les valeurs concurrentes sont conservées dans les conflits). Les comptes locaux restent utilisables hors connexion.</div>
          ${field('Dépôt GitHub (propriétaire/nom)', html`<input name="repoSpec" required placeholder="CSRE-DCE/fiche-de-controle-donnees" autocapitalize="none" spellcheck="false">`, { required: true })}
          ${field('Jeton d’accès « fine-grained »', html`<input name="token" type="password" required placeholder="github_pat_…" autocomplete="off" spellcheck="false">`, { required: true, hint: 'Limité à ce dépôt, permission « Contents : Read and write ». Conservé chiffré sur cet appareil.' })}
          <details><summary>Comment créer le dépôt et le jeton ?</summary>${tokenHelp()}</details>
          <details><summary>Options avancées</summary><div class="grid2">${field('Branche', html`<input name="branch" value="${TEAM_DEFAULTS.branch}" autocapitalize="none">`)}${field('Dossier des données', html`<input name="prefix" value="${TEAM_DEFAULTS.prefix}" autocapitalize="none">`)}</div>${field('Adresse de l’API', html`<input name="apiUrl" value="${TEAM_DEFAULTS.apiUrl}" autocapitalize="none">`)}</details>
          <div id="afProbe"></div><p class="hint" id="afErr" style="color:var(--nc)"></p></form>`,
        actions: [{ label: 'Annuler' }, { label: 'Vérifier', act: 'check' }, { label: 'Rattacher cet appareil', act: 'ok', cls: 'primary' }],
        handlers: {
          async check() {
            const f = this.root.querySelector('#af'); if (!f.reportValidity()) return;
            const v = formValues(f), box = this.root.querySelector('#afProbe'), err = this.root.querySelector('#afErr');
            const r = parseRepoSpec(v.repoSpec); if (!r) { err.textContent = 'Dépôt GitHub invalide : « propriétaire/nom-du-dépôt ».'; return; }
            err.textContent = ''; box.innerHTML = String(html`<p class="note">Vérification auprès de GitHub…</p>`);
            const { probeTeam } = await import('../app/sync.js');
            try { box.innerHTML = String(probeSummary(await probeTeam({ ...v, owner: r.owner, repo: r.repo }, String(v.token).trim()))); }
            catch (e) { box.innerHTML = String(html`<div class="banner nc">${errText(e)}</div>`); }
          },
          ok() {
            const f = this.root.querySelector('#af'); if (!f.reportValidity()) return;
            const v = formValues(f), r = parseRepoSpec(v.repoSpec);
            if (!r) { this.root.querySelector('#afErr').textContent = 'Dépôt GitHub invalide : « propriétaire/nom-du-dépôt ».'; return; }
            this.close({ ...v, owner: r.owner, repo: r.repo });
          }
        } });
      const v = await m.result; if (!v) return;
      toast('Rattachement en cours…');
      try {
        const p = await attachDevice({ settings: v, token: String(v.token).trim(), orgName: store.get('setting', 'org')?.orgName || '' });
        toast(`Appareil rattaché à ${p.repo.fullName} (@${p.login}) — synchronisation…`, 'ok', 5000);
        const res = await runSync({ reason: 'rattachement à l’équipe' });
        if (res.errors?.length) toast(res.errors[0], 'warn', 7000);
      } catch (e) { toast(errText(e), 'err', 8000); }
      this.refresh();
    },
    async detach() {
      const out = await outboxEntries();
      const reason = await promptDialog({ title: 'Détacher cet appareil de l’équipe', label: 'Motif', hint: `${out.length ? out.length + ' modification(s) locale(s) ne sont pas encore envoyées : elles resteront sur l’appareil. ' : ''}L’appareil repasse en mode autonome ; le jeton est effacé ; les données locales sont conservées.`, multiline: false, voice: false });
      if (!reason) return;
      await detachDevice(reason);
      toast('Appareil détaché : mode autonome', 'ok');
      this.refresh();
    },
    async retry() { await retryRejected(); await runSync({ reason: 'nouvel essai' }); this.refresh(); },
    async drop(el) { if (await confirmDialog({ title: 'Retirer de la file', message: 'Cette modification ne sera plus envoyée (elle reste sur l’appareil). Continuer ?', danger: true })) { await dropOutboxEntry(el.dataset.key); this.refresh(); } },
    async 'pkg-export'() {
      const { buildPackage } = await import('../app/exports.js');
      toast('Préparation du paquet…');
      const pkg = await buildPackage();
      downloadBlob(JSON.stringify(pkg), `donnees_audit_${localDate()}.json`, 'application/json');
      await store.log('export', { entityLabel: 'Paquet de données complet', details: `SHA-256 ${pkg.sha256}` });
    },
    async 'pkg-import'(el) {
      const f = el.files[0]; el.value = ''; if (!f) return;
      const { readPackage, importPackage } = await import('../app/exports.js');
      const text = await readFileAsText(f);
      let pkg;
      try { pkg = await readPackage(text); }
      catch (e) {
        if (!e.needsPassword) { toast(e.message, 'err'); return; }
        const pw = await promptDialog({ title: 'Sauvegarde chiffrée', label: 'Mot de passe', multiline: false, voice: false });
        if (!pw) return;
        try { pkg = await readPackage(text, pw); } catch (e2) { toast(e2.message, 'err'); return; }
      }
      const n = Object.values(pkg.entities || {}).reduce((s, l) => s + l.length, 0);
      if (!(await confirmDialog({ title: 'Importer le paquet', message: `Paquet exporté le ${fmtDateTime(pkg.exportedAt)} par ${pkg.exportedBy || '?'} (${pkg.device || '?'}) : ${n} élément(s), ${Object.keys(pkg.media || {}).length} fichier(s). Intégrité : ${pkg.integrity ? 'vérifiée ✓' : 'ÉCHEC — fichier modifié'}. Fusionner avec les données de l’appareil ?`, okLabel: 'Fusionner' }))) return;
      const r = await importPackage(pkg);
      await store.log('import', { entityLabel: f.name, details: r });
      toast(`Import : ${r.added} ajout(s), ${r.updated} mise(s) à jour, ${r.conflicts} conflit(s), ${r.media} fichier(s)`, r.conflicts ? 'warn' : 'ok', 6000);
      this.refresh();
    },
    async conflict(el) {
      const c = store.get('conflict', el.dataset.id);
      const m = openModal({
        title: `Conflit — ${c.label}`, wide: true,
        body: html`<p class="note">Les deux versions ont été fusionnées automatiquement ; pour chaque valeur modifiée des deux côtés, la plus récente a été retenue. Vous pouvez restaurer la valeur écartée.</p>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Champ</th><th>Valeur de cette tablette</th><th>Valeur reçue</th><th>Retenue</th><th></th></tr></thead><tbody>
          ${c.details.map((d, i) => html`<tr><td class="mono tiny">${d.path || '(objet)'}</td><td class="tiny">${show(d.localValue)}</td><td class="tiny">${show(d.remoteValue)}</td><td>${badge(d.kept === 'local' ? 'cette tablette' : 'reçue', 'info')}</td><td>${!c.resolved && d.path && store.get(c.entityType, c.entityId) ? html`<button class="btn ghost sm" data-act="restore" data-i="${i}">Restaurer l’autre valeur</button>` : ''}</td></tr>`)}</tbody></table></div>`,
        actions: [{ label: 'Fermer' }, ...(c.resolved ? [] : [{ label: 'Marquer comme examiné', act: 'ok', cls: 'primary' }])],
        handlers: {
          async restore(btn) {
            const d = c.details[Number(btn.dataset.i)];
            const cur = clone(store.get(c.entityType, c.entityId));
            const value = d.kept === 'local' ? d.remoteValue : d.localValue;
            try { setPath(cur, d.path, value ?? undefined); } catch (e) { toast(e.message, 'err'); return; }
            if (c.entityType === 'audit' && cur.lock?.lockedAt) { toast('Audit verrouillé : restaurez la valeur par une modification motivée depuis l’audit.', 'warn', 6000); return; }
            await store.put(c.entityType, cur, { reason: `Résolution de conflit : restauration de la valeur ${d.kept === 'local' ? 'reçue' : 'de cette tablette'} (${d.path})` });
            await store.put('conflict', { ...c, resolved: true, resolution: 'valeur restaurée', resolvedAt: new Date().toISOString(), resolvedBy: session.user.name });
            this.close(true);
          },
          async ok() { await store.put('conflict', { ...c, resolved: true, resolution: 'fusion acceptée', resolvedAt: new Date().toISOString(), resolvedBy: session.user.name }); this.close(true); }
        }
      });
      if (await m.result) this.refresh();
    }
  }
};
