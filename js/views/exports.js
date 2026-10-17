/* Exports (PDF par audit depuis l'écran d'audit) : Excel, CSV, calendrier, données d'audit, historique,
 * registre des écarts, stations et réseaux de surveillance (une ligne par station ; classeur : aussi une ligne par
 * station et par réseau), paquets de données (archivage, transfert entre appareils, sauvegarde chiffrée).
 * Filtres : période, prestataire, réseau (stations des tournées et des écarts, programme des prestations). */
import { html, raw, localDate, sortBy, fmtDateTime } from '../core/util.js';
import { store } from '../core/store.js';
import { session } from '../core/session.js';
import { can, isTeamMode } from '../core/auth.js';
import { toast, downloadBlob, promptDialog, readFileAsText, confirmDialog } from '../ui/dom.js';
import { pageTitle, options, field } from '../ui/components.js';
import { auditDate } from '../domain/model.js';
import { table, csvOf, responsesRows, exportWorkbook, planningICS, buildPackage, protectPackage, readPackage, importPackage, stationsByNetwork } from '../app/exports.js';
import { NO_NETWORK, inNetwork, prestationNetwork, sortNetworkCodes } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkOf, usedNetworkCodes } from '../app/networks.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let filters = { du: '', au: '', prestataire: '', reseau: '' };
const FILE_NAMES = { sites: 'stations-reseaux' };

function select(kind) {
  const inP = d => (!filters.du || String(d).slice(0, 10) >= filters.du) && (!filters.au || String(d).slice(0, 10) <= filters.au);
  const prov = x => !filters.prestataire || x.providerId === filters.prestataire;
  // Réseau : une des stations concernées en fait partie ; prestation : réseau de son programme (campagne).
  const net = ids => !filters.reseau || ids.some(id => inNetwork(store.get('site', id), filters.reseau));
  const presNet = p => !filters.reseau || (prestationNetwork(p, store.get('campaign', p.campaignId), currentNetworkIndex()) || NO_NETWORK) === filters.reseau;
  if (kind === 'audits') return sortBy(store.filter('audit', a => a.status !== 'abandonne' && inP(auditDate(a)) && prov(a) && net((a.stations || []).length ? a.stations.map(s => s.siteId) : [a.siteId])), auditDate, 'startedAt');
  if (kind === 'deviations') return sortBy(store.filter('deviation', d => inP(d.date) && prov(d) && net(d.siteId ? [d.siteId] : d.siteIds || [])), 'number');
  if (kind === 'prestations') return sortBy(store.filter('prestation', p => inP(p.plannedDate) && prov(p) && presNet(p)), 'plannedDate');
  if (kind === 'sites') return sortBy(store.filter('site', s => !filters.reseau || inNetwork(s, filters.reseau)), 'name');
  if (kind === 'trail') return sortBy(store.filter('trail', t => inP(t.at)), 'at');
  return [];
}

export default {
  nav: 'export', title: 'Export',
  async render() {
    const nets = [...sortNetworkCodes(usedNetworkCodes(), currentNetworkIndex()).map(c => { const n = currentNetworkOf(c); return { id: c, label: n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code }; }), { id: NO_NETWORK, label: 'Sans réseau' }];
    return html`${pageTitle('Exports', 'Toutes les données restent exploitables dans les outils existants (tableur, logiciel qualité, GED)')}
      <div class="card"><h2>Filtres</h2><div class="grid3">
        ${field('Du', html`<input type="date" value="${filters.du}" data-change="f" data-k="du">`)}${field('Au', html`<input type="date" value="${filters.au}" data-change="f" data-k="au">`)}
        ${field('Prestataire', html`<select data-change="f" data-k="prestataire">${options(sortBy(store.all('provider'), 'name'), filters.prestataire, { placeholder: 'Tous' })}</select>`)}
        ${field('Réseau de surveillance', html`<select data-change="f" data-k="reseau">${options(nets, filters.reseau, { placeholder: 'Tous' })}</select>`, { hint: 'Tournées et écarts : stations du réseau ; prestations : programme du réseau.' })}</div>
        <p class="note">${select('audits').length} audit(s), ${select('deviations').length} écart(s), ${select('prestations').length} prestation(s), ${select('sites').length} station(s), ${select('trail').length} entrée(s) de journal.</p></div>
      <div class="card"><h2>Tableaux</h2><div class="list">
        ${[['audits', '📋 Audits (synthèse, réponses, écarts)'], ['deviations', '⚠️ Registre des écarts et actions correctives'], ['prestations', '📅 Prestations programmées et statuts'], ['sites', '📍 Stations et réseaux de surveillance', 'Classeur Excel : aussi une feuille « Stations par réseau » (une ligne par station et par réseau)'], ['trail', '🧾 Historique — journal d’audit informatique']].map(([k, l, sub]) => html`<div class="li"><div class="li-main"><div class="li-title">${l}</div>${sub ? html`<div class="li-sub">${sub}</div>` : ''}</div><button class="btn primary sm" data-act="xlsx" data-k="${k}">Excel</button><button class="btn ghost sm" data-act="csv" data-k="${k}">CSV</button></div>`)}
        <div class="li"><div class="li-main"><div class="li-title">🗓️ Calendrier des prestations (iCalendar)</div><div class="li-sub">À importer dans Outlook, Google Agenda, Thunderbird…</div></div><button class="btn ghost sm" data-act="ics">ICS</button></div>
      </div><p class="note">Les rapports PDF se génèrent depuis chaque audit (étape « Signatures »).</p></div>
      <div class="card"><h2>Données d’audit et sauvegarde</h2>
        <div class="btn-row"><button class="btn ghost" data-act="package">Paquet de données complet (JSON)</button><button class="btn primary" data-act="backup">🔐 Sauvegarde chiffrée</button></div>
        <p class="note">Le paquet contient toutes les données et photos ; la sauvegarde chiffrée est protégée par un mot de passe dédié (AES-256). Conservez ces fichiers dans un emplacement sécurisé.${isTeamMode() ? '' : html` Pour transmettre les données à l’autre tablette : <a href="#/synchronisation">Échanges entre tablettes</a> (« Envoyer à l’autre tablette », fichier chiffré).`}</p>
        ${can('ref.manage') || !isTeamMode() ? html`<h3>Importer un paquet (${isTeamMode() ? 'autre appareil, ' : ''}restauration)</h3><label class="btn ghost">📂 Choisir un paquet<input type="file" accept="application/json,.json" hidden data-change="importpkg"></label>
          <p class="note">Fusion avec les données de la tablette : rien n’est écrasé sans trace, les valeurs concurrentes sont conservées dans le rapport de conflits (${isTeamMode() ? 'Synchronisation' : 'Échanges entre tablettes › Conflits'}).${isTeamMode() ? '' : ' Pour un fichier envoyé par l’autre tablette, utilisez plutôt « Recevoir un fichier ».'}</p>` : ''}
      </div>`;
  },
  handlers: {
    f(el) { filters[el.dataset.k] = el.value; this.refresh(); },
    async xlsx(el) {
      const k = el.dataset.k, list = select(k), d = localDate();
      const sheets = k === 'audits' ? [{ name: 'Audits', rows: table('audits', list) }, { name: 'Réponses', rows: responsesRows(list) }, { name: 'Écarts', rows: table('deviations', store.filter('deviation', x => list.some(a => a.id === x.auditId))) }]
        : k === 'sites' ? [{ name: 'Stations', rows: table('sites', list) }, { name: 'Stations par réseau', rows: table('stationsByNetwork', stationsByNetwork(list).filter(r => !filters.reseau || r.network.code === filters.reseau)) }]
        : [{ name: { deviations: 'Registre des écarts', prestations: 'Prestations', trail: 'Journal d’audit' }[k], rows: table(k, list) }];
      const file = `${FILE_NAMES[k] || k}_${d}.xlsx`;
      const bytes = await exportWorkbook(sheets, file, sheets[0].name);
      downloadBlob(bytes, file, XLSX_MIME);
    },
    async csv(el) {
      const k = el.dataset.k;
      downloadBlob(csvOf(k, select(k)), `${FILE_NAMES[k] || k}_${localDate()}.csv`, 'text/csv;charset=utf-8');
      await store.log('export', { entityLabel: `${FILE_NAMES[k] || k}.csv`, details: 'CSV' });
    },
    async ics() { downloadBlob(planningICS(select('prestations')), `prestations_${localDate()}.ics`, 'text/calendar'); await store.log('export', { entityLabel: 'prestations.ics' }); },
    async package() {
      toast('Préparation du paquet…');
      const pkg = await buildPackage();
      downloadBlob(JSON.stringify(pkg), `donnees_audit_${localDate()}.json`, 'application/json');
      await store.log('export', { entityLabel: 'Paquet de données complet', details: `SHA-256 ${pkg.sha256}` });
    },
    async backup() {
      const pw = await promptDialog({ title: 'Sauvegarde chiffrée', label: 'Mot de passe de la sauvegarde (10 caractères minimum)', multiline: false, voice: false, hint: 'Sans ce mot de passe, la sauvegarde ne pourra pas être restaurée.' });
      if (!pw) return;
      if (pw.length < 10) { toast('Mot de passe trop court (10 caractères minimum).', 'err'); return; }
      toast('Chiffrement…');
      const enc = await protectPackage(await buildPackage(), pw);
      downloadBlob(JSON.stringify(enc), `sauvegarde_audit_${localDate()}.oegbackup.json`, 'application/json');
      await store.log('backup', { entityLabel: 'Sauvegarde chiffrée' });
      toast('Sauvegarde chiffrée téléchargée', 'ok');
    },
    async importpkg(el) {
      const f = el.files[0]; el.value = ''; if (!f) return;
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
    }
  }
};
