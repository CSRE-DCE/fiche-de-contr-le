/* Échanges entre tablettes (mode autonome, celui de l'OEG) : fenêtres et cartes partagées par l'accueil, l'écran
 * « Échanges entre tablettes », l'Administration et la mise en service d'une tablette supplémentaire.
 *  - « Envoyer à l'autre tablette » (sendDialog) : fichier préparé (contenu, taille ; au-delà de ~20 Mo, envoi
 *    proposé sans les photos), puis « Partager » — feuille de partage du système : Quick Share, Bluetooth, Gmail,
 *    Teams, Drive… (API Web Share, navigator.canShare({ files }) ; Android n'accepte que certains types de fichiers :
 *    le même fichier est alors partagé sous le nom « ….oegct.txt ») — ou « Enregistrer le fichier » (téléchargement,
 *    clé USB). Le fichier n'est marqué envoyé qu'une fois partagé ou enregistré ;
 *  - « Recevoir un fichier » (receiveFile) : mot de passe d'échange de la tablette (fichier chiffré avec un autre :
 *    message clair et mot de passe demandé, rien n'est modifié), aperçu, réception, compte rendu (liens vers
 *    Administration › Agents de cette tablette, conflits, changements de profils en attente) ;
 *  - mot de passe d'échange (passwordDialog), bandeau de l'accueil (homeBanner), carte d'envoi et de réception
 *    (exchangeCard), historique (historyCard), changements de profils en attente (heldCard).
 */
import { html, fmtDateTime, fmtBytes } from '../core/util.js';
import { session } from '../core/session.js';
import { can, ROLES } from '../core/auth.js';
import { openModal, toast, downloadBlob, formValues } from '../ui/dom.js';
import { kv, badge } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import {
  prepareSend, markSent, readExchange, previewExchange, receiveExchange, receiveSummary, setExchangePassword, exchangePasswordInfo,
  validateExchangePassword, missingPasswordMessage, pendingChanges, lastSent, exchangeHistory, heldChanges, LARGE_FILE, EXCHANGE_PASSWORD_MIN
} from '../app/exchange.js';
import { heldLabel } from '../domain/exchange.js';

const nb = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const WAYS = 'Quick Share, Bluetooth, e-mail, Teams, clé USB…';

/* ---------- Partage du fichier ---------- */
/** Fichier partageable par la feuille de partage du système (null : partage indisponible, enregistrement seulement). */
function shareableFile(prep) {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return null;
  for (const [name, type] of [[prep.fileName, 'application/octet-stream'], [prep.fileName + '.txt', 'text/plain']]) {
    const file = new File([prep.blob], name, { type });
    try { if (navigator.canShare({ files: [file] })) return file; } catch (e) { /* type refusé */ }
  }
  return null;
}

/* ---------- Mot de passe d'échange ---------- */
/** Fenêtre « Mot de passe d'échange de l'équipe » (administrateur) : true si enregistré. */
export async function passwordDialog() {
  const info = exchangePasswordInfo();
  const m = openModal({
    title: info ? 'Changer le mot de passe d’échange' : 'Mot de passe d’échange de l’équipe',
    body: html`<form id="xpw" autocomplete="off">
      <p class="note">Il chiffre les fichiers échangés entre les tablettes (e-mail, Teams, Quick Share…). <b>Le même sur toutes les tablettes de l’équipe</b>, défini une fois par un administrateur sur chacune ; ensuite, envoyer et recevoir ne le demandent plus. Communiquez-le de vive voix, jamais avec le fichier.</p>
      ${info ? html`<div class="banner warn">Changez-le aussi sur l’autre tablette : sinon, ses fichiers ne s’ouvriront plus ici sans saisir l’ancien mot de passe.</div>` : ''}
      <div class="field"><label>Mot de passe d’échange (${EXCHANGE_PASSWORD_MIN} caractères min.)</label><input name="p1" type="password" required minlength="${EXCHANGE_PASSWORD_MIN}" autocomplete="new-password"></div>
      <div class="field"><label>Confirmation</label><input name="p2" type="password" required autocomplete="new-password"></div>
      <p class="hint" id="xpwErr" style="color:var(--nc)"></p></form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      async ok() {
        const f = this.root.querySelector('#xpw'), err = this.root.querySelector('#xpwErr');
        const v = formValues(f);
        try {
          validateExchangePassword(v.p1);
          if (v.p1 !== v.p2) throw new Error('Les deux mots de passe ne correspondent pas.');
          await setExchangePassword(v.p1);
          this.close(true);
        } catch (e) { err.textContent = e.message; }
      }
    }
  });
  const ok = await m.result;
  if (ok) toast('Mot de passe d’échange enregistré sur cette tablette', 'ok');
  return !!ok;
}
/** Saisie d'un mot de passe (fichier chiffré avec un autre mot de passe d'échange, sauvegarde chiffrée). */
function askPassword({ title, message, label }) {
  const m = openModal({
    title,
    body: html`<form id="xask" autocomplete="off" data-submit="ok"><div class="banner warn">${message}</div>
      <div class="field"><label for="xaskPw">${label}</label><input id="xaskPw" name="pw" type="password" required autocomplete="off"></div>
      <p class="note">Rien n’est modifié tant que le fichier n’est pas ouvert et que vous n’avez pas confirmé la réception.</p></form>`,
    actions: [{ label: 'Annuler', act: 'cancel' }, { label: 'Ouvrir le fichier', act: 'ok', cls: 'primary' }],
    handlers: {
      ok() { const v = this.root.querySelector('#xaskPw').value; if (v) this.close(v); },
      cancel() { this.close(null); }
    }
  });
  return m.result.then(v => v || null);
}
function messageDialog(title, message, cls = 'nc') {
  return openModal({ title, body: html`<div class="banner ${cls}" id="xchMsg">${message}</div><p class="note">Rien n’a été modifié sur cette tablette.</p>`, actions: [{ label: 'Fermer', cls: 'primary' }] }).result;
}

/* ---------- Envoyer ---------- */
function fileCard(prep) {
  return html`<div class="xch-file"><span class="xch-file-ic">${icon('upload', { size: 26 })}</span><div><b class="mono" id="xchName">${prep.fileName}</b>
    <div class="tiny muted"><span id="xchSize">${fmtBytes(prep.size)}</span> · chiffré avec le mot de passe d’échange de l’équipe</div></div></div>`;
}
function sendBody(prep, shareable) {
  if (prep.empty) {
    return html`<div class="banner ok" id="xchNothing">Rien de nouveau à envoyer : toutes les modifications de cette tablette ont déjà été envoyées.</div>
      <p class="note">Fichier perdu ou pas reçu par l’autre tablette ? « Tout envoyer » prépare un fichier avec toutes les données.</p>
      <div class="btn-row"><button class="btn ghost" data-act="all">Tout envoyer</button></div>`;
  }
  const big = prep.size > LARGE_FILE;
  return html`${fileCard(prep)}
    ${kv([['Contenu', prep.label || '—'], ['Journal d’audit', nb(prep.counts.journal || 0, 'entrée', 'entrées')], ['Envoi', prep.scope === 'all' ? 'tout (« Tout envoyer »)' : 'modifications depuis le dernier envoi'], ['Agent', `${session.user.name} — ${session.device.name}`]])}
    ${prep.heldMedia ? html`<div class="banner info">${nb(prep.heldMedia, 'photo ou document partira', 'photos ou documents partiront')} au prochain envoi.</div>` : ''}
    ${big ? html`<div class="banner warn" id="xchBig">Fichier volumineux (${fmtBytes(prep.size)}) : un e-mail risque de le refuser. Préférez Quick Share, Bluetooth ou une clé USB, ou
      <button class="btn warn sm" data-act="lighter">${prep.scope === 'all' ? 'Envoyer sans les photos déjà envoyées' : 'Envoyer sans les photos (elles partiront au prochain envoi)'}</button></div>` : ''}
    <div class="btn-row xch-send-row">
      ${shareable ? html`<button class="btn primary lg" data-act="share" id="xchShare">${icon('upload')}Partager (${WAYS})</button>` : ''}
      <button class="btn ${shareable ? 'ghost' : 'primary lg'}" data-act="save" id="xchSave">${icon('download')}Enregistrer le fichier${shareable ? '' : ` (à envoyer par ${WAYS})`}</button>
    </div>
    <p class="note">Sur l’autre tablette : Échanges entre tablettes › <b>Recevoir un fichier</b>. ${prep.scope === 'all' ? '' : html`Fichier perdu ? <button class="btn ghost sm" data-act="all">Tout envoyer</button>`}</p>`;
}

/**
 * « Envoyer à l'autre tablette » : prépare le fichier puis le partage ou l'enregistre. Retourne l'entrée d'historique
 * de l'envoi, ou null (annulé, rien à envoyer).
 */
export async function sendDialog({ scope = 'changes' } = {}) {
  if (!exchangePasswordInfo()) {
    if (!can('settings.manage')) { toast(missingPasswordMessage(), 'warn', 7000); return null; }
    if (!(await passwordDialog())) return null;
  }
  let prep = null, busy = false;
  /** Enregistrement du fichier (téléchargement : dossier Téléchargements, clé USB…). */
  const save = async () => {
    if (busy || !prep) return;
    busy = true;
    downloadBlob(prep.blob, prep.fileName, 'application/octet-stream');
    try { m.close(await markSent(prep, { via: 'fichier' })); }
    catch (e) { busy = false; toast('Fichier enregistré, mais l’envoi n’a pas pu être noté : ' + (e?.message || e), 'err', 7000); }
  };
  const m = openModal({
    title: 'Envoyer à l’autre tablette', wide: true,
    body: html`<p class="note" id="xchPrep">Préparation du fichier…</p>`,
    actions: [{ label: 'Fermer' }],
    handlers: {
      /** Feuille de partage du système (appelée directement au toucher : le navigateur l'exige). */
      async share() {
        if (busy || !prep) return;
        const file = shareableFile(prep);
        if (!file) return save();
        busy = true;
        try {
          await navigator.share({ files: [file], title: 'Échange entre tablettes — Fiches de contrôle terrain' });
          m.close(await markSent(prep, { via: 'partage' }));
        } catch (e) {
          busy = false;
          if (e?.name === 'AbortError') toast('Partage annulé : rien n’est marqué envoyé.', 'warn');
          else toast('Partage impossible (' + (e?.message || e) + ') : utilisez « Enregistrer le fichier ».', 'err', 7000);
        }
      },
      save,
      async all() { await build({ scope: 'all' }); },
      async lighter() { await build({ scope: prep.scope, media: prep.scope === 'all' ? 'unsent' : 'none' }); }
    }
  });
  async function build(opts) {
    m.setBody(html`<p class="note" id="xchPrep">Préparation du fichier…</p>`);
    try { prep = await prepareSend(opts); }
    catch (e) { m.setBody(html`<div class="banner nc">${e.message}</div>`); return; }
    m.setBody(sendBody(prep, !!shareableFile(prep)));
  }
  build({ scope });
  const entry = await m.result;
  if (entry) toast(`Fichier ${entry.via === 'partage' ? 'partagé' : 'enregistré'} ✓ — sur l’autre tablette : « Recevoir un fichier »`, 'ok', 6000);
  return entry || null;
}

/* ---------- Recevoir ---------- */
function previewBody(pv) {
  const agents = pv.agents.slice(0, 12), tours = pv.tours.slice(0, 12);
  return html`<div class="xch-preview" id="xchPreview">
    ${pv.received ? html`<div class="banner info">Ce fichier a déjà été reçu le ${fmtDateTime(pv.received.at)} : le recevoir à nouveau ne change rien.</div>` : ''}
    ${pv.otherPassword ? html`<div class="banner warn">Ce fichier a été chiffré avec un autre mot de passe d’échange que celui de cette tablette.</div>` : ''}
    ${pv.sameNumber ? html`<div class="banner warn">${pv.from.name} et cette tablette ont le même n° (${pv.from.number}) : les numéros d’audit risquent d’être en double. Un administrateur peut changer le n° de cette tablette (Administration › Cette tablette).</div>` : ''}
    ${kv([
      ['Tablette d’origine', pv.legacy ? `${pv.from.name || '—'} (ancien paquet de données)` : `${pv.from.name || '—'}${pv.from.number ? ' (n° ' + pv.from.number + ')' : ''}`],
      ['Envoyé par', `${pv.sentBy.name || '—'}${pv.createdAt ? ' le ' + fmtDateTime(pv.createdAt) : ''}`],
      ['Contenu', `${pv.label || 'aucun élément'}${pv.journal ? ` ; ${nb(pv.journal, 'entrée', 'entrées')} du journal d’audit` : ''}`],
      ['Envoi', pv.scope === 'all' ? 'toutes les données' : 'modifications depuis le dernier envoi']
    ])}
    ${pv.agents.length ? html`<h3>Agents (${pv.agents.length})</h3><ul class="xch-list">${agents.map(a => html`<li>${a.name} <span class="tiny muted">${a.roleLabel}${a.active ? '' : ' · désactivé'}</span> ${a.isNew ? badge('nouveau', 'info') : ''}</li>`)}${pv.agents.length > agents.length ? html`<li class="muted">…</li>` : ''}</ul>` : ''}
    ${pv.tours.length ? html`<h3>Tournées (${pv.tours.length})</h3><ul class="xch-list">${tours.map(t => html`<li><b>${t.number}</b> ${t.stations ? html`<span class="tiny">${t.stations}</span>` : ''} ${t.signed ? badge('signée', 'ok') : ''}${t.deleted ? badge('supprimée', 'na') : ''}${t.status === 'abandonne' ? badge('annulée', 'na') : ''} ${t.isNew ? badge('nouvelle', 'info') : ''}</li>`)}${pv.tours.length > tours.length ? html`<li class="muted">…</li>` : ''}</ul>` : ''}
    ${!pv.trusted && pv.agents.length ? html`<p class="note">Fichier envoyé par un agent qui n’est pas administrateur sur cette tablette : un changement de profil ou de statut d’agent restera en attente de validation par un administrateur.</p>` : ''}
    <p class="note">Les données sont fusionnées champ par champ : rien n’est écrasé sans trace, une saisie plus récente de cette tablette est conservée et les valeurs en concurrence restent consultables (conflits).</p></div>`;
}

function reportBody(r, pv) {
  const total = o => Object.values(o).reduce((s, n) => s + n, 0);
  const newAgents = r.agents.added.filter(a => !a.onTablet);
  const lines = [];
  if (r.tours.added.length) lines.push(html`<li>${nb(r.tours.added.length, 'nouvelle tournée', 'nouvelles tournées')} : ${r.tours.added.join(', ')}</li>`);
  if (r.tours.updated.length) lines.push(html`<li>${nb(r.tours.updated.length, 'tournée mise à jour', 'tournées mises à jour')} : ${r.tours.updated.join(', ')}</li>`);
  if (newAgents.length) lines.push(html`<li id="xchNewAgents">${nb(newAgents.length, 'nouvel agent à ajouter sur cette tablette', 'nouveaux agents à ajouter sur cette tablette')} : ${newAgents.map(a => a.name).join(', ')} — <a href="#/administration" data-act="__close">Administration › Agents de cette tablette</a></li>`);
  const others = total(r.added) + total(r.updated) - r.tours.added.length - r.tours.updated.length - newAgents.length;
  if (others > 0) lines.push(html`<li>${nb(others, 'autre élément ajouté ou mis à jour', 'autres éléments ajoutés ou mis à jour')} (profils, écarts, référentiels…)</li>`);
  if (r.media) lines.push(html`<li>${nb(r.media, 'photo ou document reçu', 'photos ou documents reçus')}</li>`);
  if (r.journal) lines.push(html`<li>${nb(r.journal, 'entrée', 'entrées')} du journal d’audit de l’autre tablette</li>`);
  if (r.conflicts) lines.push(html`<li id="xchConflicts">${nb(r.conflicts, 'conflit à examiner', 'conflits à examiner')} (valeurs modifiées des deux côtés : la plus récente est retenue, l’autre est conservée) — <a href="#/synchronisation" data-act="__close">Conflits</a></li>`);
  if (r.held.length) lines.push(html`<li id="xchHeld">${nb(r.held.length, 'changement de profil en attente de validation', 'changements de profils en attente de validation')} : ${r.held.map(h => `${h.name} (${h.labels.join(', ')})`).join(' ; ')} — <a href="#/administration" data-act="__close">Administration</a></li>`);
  if (r.ignored) lines.push(html`<li class="muted">${nb(r.ignored, 'élément déjà présent ou plus ancien que celui de cette tablette : ignoré', 'éléments déjà présents ou plus anciens que ceux de cette tablette : ignorés')}</li>`);
  return html`<div class="banner ok" id="xchReport">✓ Fichier reçu de ${pv.from.name || 'l’autre tablette'} (${pv.sentBy.name || '—'}${pv.createdAt ? ', ' + fmtDateTime(pv.createdAt) : ''}) : ${receiveSummary(r)}.</div>
    <ul class="xch-report">${lines.length ? lines : html`<li>Aucun changement : les données de cette tablette étaient déjà à jour.</li>`}</ul>`;
}

/**
 * « Recevoir un fichier » : lecture (mot de passe demandé si besoin), aperçu, réception, compte rendu.
 * Retourne le compte rendu, ou null (annulé ou refusé : rien n'a été modifié).
 */
export async function receiveFile(file) {
  let rx = null, password = null;
  for (;;) {
    try { rx = await readExchange(file, { password }); break; }
    catch (e) {
      if (['password', 'nopassword', 'password-backup'].includes(e.code)) {
        const backup = e.code === 'password-backup';
        const pw = await askPassword({
          title: backup ? 'Sauvegarde chiffrée' : 'Mot de passe d’échange',
          message: password ? 'Mot de passe incorrect pour ce fichier. ' + e.message : e.code === 'password' ? `${e.message} Saisissez le mot de passe d’échange utilisé par la tablette qui l’a envoyé (demandez-le à un administrateur).` : e.message,
          label: backup ? 'Mot de passe de la sauvegarde' : 'Mot de passe d’échange de l’équipe'
        });
        if (!pw) return null;
        password = pw;
        continue;
      }
      await messageDialog('Fichier non reçu', e.message || String(e));
      return null;
    }
  }
  const pv = await previewExchange(rx);
  const adopt = rx.otherPassword && can('settings.manage');
  const m = openModal({
    title: 'Recevoir un fichier de l’autre tablette', wide: true,
    body: html`${previewBody(pv)}${adopt ? html`<label class="check"><input type="checkbox" id="xchAdopt"> Utiliser désormais ce mot de passe d’échange sur cette tablette</label>` : ''}`,
    actions: [{ label: 'Annuler', act: 'no' }, { label: 'Recevoir et fusionner', act: 'yes', cls: 'primary', id: 'xchConfirm' }],
    handlers: {
      yes() { this.close({ adopt: !!this.root.querySelector('#xchAdopt')?.checked }); },
      no() { this.close(null); }
    }
  });
  const go = await m.result;
  if (!go) return null;
  toast('Réception en cours…', '', 2500);
  let report;
  try { report = await receiveExchange(rx); }
  catch (e) { console.error(e); await messageDialog('Réception interrompue', e.message || String(e)); return null; }
  if (go.adopt) await setExchangePassword(rx.password, { reason: 'Mot de passe d’un fichier reçu adopté' }).catch(e => toast(e.message, 'err'));
  await openModal({ title: 'Fichier reçu', wide: true, body: reportBody(report, pv), actions: [{ label: 'Fermer', cls: 'primary', id: 'xchDone' }] }).result;
  return report;
}

/* ---------- Cartes et bandeaux ---------- */
/** Bandeau de l'accueil : modifications à envoyer (bouton bien visible) ; recevoir ; mot de passe à définir. */
export async function homeBanner() {
  const p = await pendingChanges(), last = await lastSent(), info = exchangePasswordInfo();
  const evening = new Date().getHours() >= 16;
  const receive = html`<label class="btn ghost" id="hmReceive">${icon('download')}Recevoir un fichier<input type="file" hidden data-change="xch-receive"></label>`;
  if (!info && can('settings.manage')) {
    return html`<section class="hm-xch is-todo" id="hmXch"><div class="hm-xch-txt"><b>Échanges entre tablettes : définissez le mot de passe d’échange de l’équipe</b><span>Il chiffre les fichiers envoyés à l’autre tablette ; le même sur chaque tablette.</span></div>
      <div class="hm-xch-btns"><button class="btn primary" data-act="xch-password">Définir le mot de passe d’échange</button>${receive}</div></section>`;
  }
  if (p.total || p.media) {
    const n = p.total;
    return html`<section class="hm-xch is-pending" id="hmXch" aria-live="polite"><div class="hm-xch-txt"><b id="hmXchCount">${evening ? 'Fin de journée : ' : ''}${nb(n, 'modification à envoyer', 'modifications à envoyer')} à l’autre tablette</b>
      <span>${p.label}${last ? ` · dernier envoi le ${fmtDateTime(last.at)}` : ' · aucun envoi depuis cette tablette'}</span></div>
      <div class="hm-xch-btns"><button class="btn primary lg" data-act="xch-send" id="hmSend">${icon('upload')}Envoyer à l’autre tablette</button>${receive}</div></section>`;
  }
  return html`<section class="hm-xch" id="hmXch"><div class="hm-xch-txt"><b>Échanges entre tablettes : tout est envoyé</b><span>${last ? `Dernier envoi le ${fmtDateTime(last.at)}` : 'Aucune modification à envoyer'}</span></div>
    <div class="hm-xch-btns">${receive}</div></section>`;
}

/** Carte « Envoyer / Recevoir » de l'écran Échanges entre tablettes. */
export async function exchangeCard() {
  const p = await pendingChanges(), last = await lastSent(), info = exchangePasswordInfo();
  return html`<div class="card xch-card" id="xchCard"><h2>Envoyer à l’autre tablette</h2>
      ${p.total || p.media ? html`<p class="xch-pending" id="xchPending"><b>${nb(p.total, 'modification à envoyer', 'modifications à envoyer')} à l’autre tablette</b> : ${p.label}${p.tours.length ? html` <span class="tiny muted">(tournées : ${p.tours.slice(0, 8).join(', ')}${p.tours.length > 8 ? '…' : ''})</span>` : ''}.${last ? html` <span class="tiny muted">Dernier envoi le ${fmtDateTime(last.at)}.</span>` : ''}</p>` : html`<p class="xch-pending" id="xchPending">Aucune modification à envoyer${last ? ` (dernier envoi le ${fmtDateTime(last.at)})` : ''}.</p>`}
      <div class="btn-row"><button class="btn primary lg" data-act="xch-send" id="xchSend">${icon('upload')}Envoyer à l’autre tablette</button><button class="btn ghost" data-act="xch-send-all">Tout envoyer</button></div>
      <p class="note">Un fichier unique, chiffré, à faire passer par ${WAYS} Par défaut : les modifications depuis le dernier envoi ; « Tout envoyer » si un fichier a été perdu.</p>
      <h2 style="margin-top:16px">Recevoir un fichier</h2>
      <div class="btn-row"><label class="btn primary" id="xchReceive">${icon('download')}Recevoir un fichier<input type="file" hidden data-change="xch-receive"></label></div>
      <p class="note">Choisissez le fichier « OEG-echange_….oegct » envoyé par l’autre tablette (dans Téléchargements après Quick Share, Bluetooth ou e-mail). Fusion automatique, hors connexion ; recevoir deux fois le même fichier ne change rien.</p>
      <p class="tiny muted">Mot de passe d’échange : ${info ? `défini le ${fmtDateTime(info.setAt)}${info.setByName ? ' par ' + info.setByName : ''}` : 'non défini'}${can('settings.manage') ? html` · <button class="btn ghost sm" data-act="xch-password">${info ? 'Changer' : 'Définir'}</button>` : ''}</p></div>`;
}

/** Historique des échanges (envois et réceptions de cette tablette). */
export function historyCard() {
  const list = exchangeHistory(30);
  return html`<div class="card" id="xchHistory"><h2>Historique des échanges</h2>${list.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Sens</th><th>Tablette</th><th>Agent</th><th>Contenu</th></tr></thead><tbody>
    ${list.map(e => html`<tr data-dir="${e.dir}"><td>${fmtDateTime(e.at)}</td><td>${e.dir === 'envoi' ? badge('Envoi', 'info') : badge('Réception', 'ok')}</td>
      <td>${e.dir === 'envoi' ? `${e.device?.name || ''} → autre tablette` : `${e.device?.name || '—'}${e.sentBy ? ' (' + e.sentBy + ')' : ''}`}</td>
      <td>${e.agent || '—'}</td><td class="tiny">${e.label || '—'}${e.size ? ` · ${fmtBytes(e.size)}` : ''}${e.scope === 'all' ? ' · tout' : ''}<div class="muted mono">${e.fileName || ''}</div></td></tr>`)}</tbody></table></div>`
    : html`<p class="note">Aucun échange enregistré sur cette tablette.</p>`}</div>`;
}

/** Changements de profils reçus en attente de validation (Administration). */
export function heldCard() {
  const list = heldChanges();
  if (!list.length) return '';
  return html`<div class="card" id="heldChanges" style="border-color:var(--warn)"><h2>Changements de profils reçus à valider (${list.length})</h2>
    <p class="note">Reçus de l’autre tablette dans un fichier envoyé par un agent qui n’est pas administrateur sur cette tablette (ou retrait du dernier administrateur) : ils ne sont appliqués qu’après votre validation.</p>
    <div class="list">${list.map(h => html`<div class="li stripe-warn" data-held="${h.userId}"><div class="li-main"><div class="li-title">${h.name}</div>
      <div class="li-sub">${h.changes.map(c => heldLabel(c, ROLES)).join(' ; ')} — fichier de ${h.from?.name || '?'} envoyé par ${h.sentBy?.name || '?'} (reçu le ${fmtDateTime(h.receivedAt)})</div></div>
      <div class="btn-row"><button class="btn primary sm" data-act="held-accept" data-id="${h.id}">Accepter</button><button class="btn ghost sm" data-act="held-refuse" data-id="${h.id}">Refuser</button></div></div>`)}</div></div>`;
}

