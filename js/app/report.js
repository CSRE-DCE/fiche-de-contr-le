/* Rapport d'audit PDF — dossier de preuve exploitable dans le système qualité.
 * Rubriques : 1 identification, 2 contexte, 3 prestataire, 4 opérateur(s), 5 site et point,
 * 6 prestation, 7 documents applicables, 8 grille de contrôle, 9 réponses, 10 observations,
 * 11 photographies, 12 preuves, 13 écarts, 14 actions demandées, 15 signatures,
 * 16 historique des modifications — précédées d'une synthèse factuelle (sans score global).
 * Tant que l'audit n'est pas signé et verrouillé, le rapport porte la mention « RAPPORT PROVISOIRE ».
 * Habillage OEG (charte des fiches de contrôle) : polices Barlow incorporées, logo rond, pied de page à vagues
 * (js/app/sheets-pdf.js, chargé à la demande ; repli Helvetica sans décor s'il est indisponible). Échelle
 * C / P / NC / N/A ; tournée de plusieurs stations : stations, décomptes par station et par feuille, critères
 * « communs à la tournée » listés une seule fois. Réseaux de surveillance des stations (« BIO – Biologie… ») et
 * réseau du programme de la prestation (référentiel « Réseaux »).
 */
import { PDFDocument } from '../formats/pdf.js';
import { store } from '../core/store.js';
import { session, appVersion } from '../core/session.js';
import { mediaBytes } from '../core/media.js';
import { sha256Hex, fmtDate, fmtDateTime, fmtTime, haversine, fmtDistance, nowISO, localDate } from '../core/util.js';
import { RESPONSES, PROVIDER_KINDS, PRESTATION_STATUS, DOC_TYPES, DEVIATION_STATUS, ACTION_STATUS, CONTROL_LEVELS, responseText, QUALIFICATION_TYPES, EQUIPMENT_STATUS, auditDate } from '../domain/model.js';
import { isAnswerable, allItems, isSheetGrid } from '../domain/grids.js';
import { operatorStatus, equipmentStatus } from '../domain/rules.js';
import { auditState, auditContentHash, verifyAuditSeal, auditMedia, effectiveGrid, deviationPlace, tourControllers, entriesByAgent } from './audits.js';
import { sheetSummary, stationSummary } from '../domain/summary.js';
import { refLabel } from './documents.js';
import { orgSettings } from './settings.js';
import { siteNetworks, siteNetworksText, prestationNetworkOf } from './networks.js';
import { toJPEG } from '../ui/capture.js';

const COLORS = { C: '#1b7a43', P: '#b45309', NC: '#b3261e', NA: '#55636a', NO: '#8a5a00', NV: '#5d3f99' };
/** Palette OEG des titres et tableaux (js/ui/themes.js, thème « océan »). */
const OEG_STYLE = { heading: '#0d3577', rule: '#1a9fd9', tableHead: '#0d3577', tableHeadText: '#ffffff', zebra: '#f3fafd', border: '#cfe3f1', labelColor: '#0d3577', labelFill: '#e6f6fd', text: '#14284b' };

/** Habillage OEG (polices, logo, pied de page) : module des fiches PDF, ou null (repli Helvetica sans décor). */
async function branding(doc) {
  try {
    const mod = await import('./sheets-pdf.js');
    await mod.loadOegFonts(doc);
    return { logo: await mod.oegLogo(doc), footer: mod.drawOegFooter, cond: doc.hasFont('condensed') ? 'condensed' : 'bold' };
  } catch (e) { return null; }
}
async function logoJPEG() {
  try {
    const res = await fetch(new URL('../../icons/logo-oeg-rond.png', import.meta.url));
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await toJPEG(bytes, 'image/png', 400);
  } catch (e) { return null; }
}
async function imageFor(m, maxSide = 1400) {
  const bytes = await mediaBytes(m.id).catch(() => null);
  if (!bytes) return null;
  try { return await toJPEG(bytes, m.mime, maxSide); } catch (e) { return null; }
}
const opName = o => o ? ([o.firstName, o.lastName].filter(Boolean).join(' ') || o.code) : '—';
const linkText = (m, audit) => {
  const l = m.link || {};
  if (l.type === 'item') { const it = allItems(effectiveGrid(audit)).find(i => i.id === l.itemId); return `Critère ${it?.code || l.itemId || ''}`; }
  if (l.type === 'sheet') return `Feuille ${String(l.itemId || '').replace('@', ' — station ')}`;
  if (l.type === 'site') return `Station ${l.slot || ''}`.trim();
  return { audit: 'Audit', sample: 'Échantillon', equipment: 'Équipement', deviation: 'Écart', point: 'Point', gps: 'Point', observation: 'Observation' }[l.type] || l.type || '';
};

export async function buildAuditReport(auditId) {
  const audit = store.get('audit', auditId);
  const st = auditState(audit, { includeMissing: true });
  const org = orgSettings();
  const provider = store.get('provider', audit.providerId);
  const site = store.get('site', audit.siteId);
  const point = st.point;
  const prestation = st.prestation;
  const seal = await verifyAuditSeal(audit);
  const contentHash = await auditContentHash(audit);
  const provisional = !audit.lock?.lockedAt;
  const title = `Rapport d’audit ${audit.number}`;
  const stations = st.stations || [];
  const multi = stations.length > 1;
  const sheetGrid = isSheetGrid(st.grid);
  // Date de l'audit = date de la tournée (la même que celle des écrans et des fiches de contrôle PDF).
  const date = auditDate(audit);
  const entryDay = audit.startedAt ? localDate(new Date(audit.startedAt)) : '';
  // Contrôleurs OEG de la tournée (binôme) : partout où figure le contrôleur OEG.
  const controllers = tourControllers(audit);
  const controllersText = controllers.map(c => c.name).filter(Boolean).join(', ') || audit.auditorName || '';
  const doc = new PDFDocument({ title, author: controllersText, subject: `Audit terrain de prestation de prélèvement — ${stations.length ? stations.map(x => x.name).join(', ') : site?.name || ''}`, keywords: `audit;prélèvement;${audit.number}` });
  const brand = await branding(doc);
  const generatedAt = nowISO();
  if (brand) {
    // Charte OEG : titres et tableaux bleu marine, pied de page à vagues (place réservée en bas de page).
    doc.style = { ...doc.style, ...OEG_STYLE };
    doc.m.bottom = 62;
    if (provisional) doc.watermark = { text: 'RAPPORT PROVISOIRE', mode: 'fill', color: '#c62828', opacity: 0.08, font: 'montserrat', size: 70 };
    doc.headerFn = (d) => {
      if (brand.logo) d.drawImageContain(brand.logo, d.m.left, 11, 34, 34);
      d.text(String(org.orgName || 'Office de l’Eau de Guyane').toLocaleUpperCase('fr-FR'), d.m.left + 42, 14, { font: brand.cond, size: 13, color: '#0d3577' });
      d.text('Rapport d’audit détaillé — contrôle terrain des prestations de prélèvement', d.m.left + 42, 31, { size: 8, color: '#4c6280' });
      d.text(audit.number, d.m.left, 14, { font: 'bold', size: 10, color: '#0d3577', align: 'right', width: d.contentWidth });
      if (provisional) d.text('PROVISOIRE', d.m.left, 28, { font: 'bold', size: 8, color: '#c62828', align: 'right', width: d.contentWidth });
      d.line(d.m.left, 50, d.W - d.m.right, 50, { color: '#1a9fd9', width: 1.2 });
    };
    doc.footerFn = (d, page, total) => brand.footer(d, { theme: 'ocean', center: [`${title} — généré le ${fmtDateTime(generatedAt)} par ${session.user?.name || ''}`, org.reportFooter || ''].filter(Boolean).join(' — '), right: `Page ${page} / ${total}`, provisional });
  } else {
    if (provisional) doc.watermark = { text: 'RAPPORT PROVISOIRE' };
    const logo = await logoJPEG();
    doc.headerFn = (d) => {
      if (logo) { try { const img = d.addImage(logo); const h = 26, w = img.width * h / img.height; d.drawImage(img, d.m.left, 18, w, h); } catch (e) { /* logo facultatif */ } }
      d.text(org.orgName || '', d.m.left + 70, 20, { font: 'bold', size: 9, color: '#003d7a' });
      d.text('Audit terrain des prestations de prélèvement', d.m.left + 70, 31, { size: 8, color: '#4f5f67' });
      d.text(audit.number + (provisional ? ' — PROVISOIRE' : ''), d.m.left, 20, { font: 'bold', size: 9, color: provisional ? '#b3261e' : '#003d7a', align: 'right', width: d.contentWidth });
      d.line(d.m.left, 50, d.W - d.m.right, 50, { color: '#00ac97', width: 1.2 });
    };
    doc.footerFn = (d, page, total) => {
      d.line(d.m.left, d.H - 40, d.W - d.m.right, d.H - 40);
      const foot = d.wrap(`${title} — généré le ${fmtDateTime(generatedAt)} par ${session.user?.name || ''} — ${org.reportFooter || ''}`, 'regular', 6.8, d.contentWidth - 70);
      foot.slice(0, 2).forEach((l, i) => d.text(l, d.m.left, d.H - 36 + i * 8, { size: 6.8, color: '#6e7b82' }));
      d.text(`Page ${page} / ${total}`, d.m.left, d.H - 34, { size: 7.5, color: '#4f5f67', align: 'right', width: d.contentWidth });
    };
  }

  // Page de titre
  doc.y = 90;
  doc.text('RAPPORT D’AUDIT TERRAIN', doc.m.left, doc.y, { font: 'bold', size: 11, color: '#007f96' }); doc.y += 18;
  doc.paragraph(multi ? `Tournée de contrôle — ${stations.length} stations : ${stations.map(x => x.name).join(', ')}` : `Prestation de prélèvement — ${stations[0]?.name || site?.name || 'site non renseigné'}`, { size: 18, font: 'bold', color: doc.style.heading, gap: 2 });
  doc.paragraph(`${audit.number} · ${fmtDate(date)} · ${provider?.name || ''}`, { size: 12, color: '#4f5f67', gap: 10 });
  if (provisional) doc.paragraph('RAPPORT PROVISOIRE — audit non signé ou non verrouillé. Ce document ne vaut pas rapport définitif.', { font: 'bold', color: '#b3261e', size: 10 });
  doc.paragraph('Périmètre : le présent audit porte exclusivement sur le processus de prélèvement et d’échantillonnage, et sur la partie pré-analytique directement liée (conservation, transport, remise au laboratoire). Les analyses de laboratoire, leur validation, le traitement statistique et l’interprétation des résultats sont hors périmètre.', { size: 8.5, color: '#4f5f67', gap: 8 });

  // Synthèse
  const s = st.summary;
  doc.heading('Synthèse factuelle des constats');
  doc.table({
    columns: [{ label: 'Critères contrôlés', width: 70 }, { label: 'Conformes', width: 60 }, { label: 'Perfectibles', width: 62 }, { label: 'Non conformes', width: 66 }, { label: 'Non applicables', width: 66 }, { label: 'Non observés', width: 62 }, { label: 'Non vérifiables', width: 66 }, { label: 'Écarts', width: 59 }],
    rows: [[String(s.counts.controlled), { text: String(s.counts.C), color: COLORS.C, font: 'bold' }, { text: String(s.counts.P || 0), color: COLORS.P, font: 'bold' }, { text: String(s.counts.NC), color: COLORS.NC, font: 'bold' }, String(s.counts.NA), String(s.counts.NO), String(s.counts.NV), { text: String(s.deviationsCount), font: 'bold' }]]
  });
  if (sheetGrid && stations.length) {
    // Décomptes de la tournée par station et par feuille (chaque critère compté une seule fois).
    const ss = stationSummary({ audit, grid: st.grid, ctx: st.ctx });
    const cnt = c => [{ text: String(c.C), color: COLORS.C, font: c.C ? 'bold' : 'regular' }, { text: String(c.P), color: COLORS.P, font: c.P ? 'bold' : 'regular' }, { text: String(c.NC), color: COLORS.NC, font: c.NC ? 'bold' : 'regular' }, String(c.NA), String(c.unanswered), String(c.total)];
    const cols = l => [{ label: l, width: 181 }, ...['C', 'P', 'NC', 'N/A', 'Non renseignés', 'Total'].map(x => ({ label: x, width: 55 }))];
    doc.heading('Décomptes par station (C / P / NC / N/A)', { level: 3 });
    doc.table({ columns: cols('Station'), rows: [...ss.stations.map(x => [`${x.index + 1}. ${x.name} (${x.code})`, ...cnt(x)]), ...(ss.tournee.total ? [['Commun à la tournée', ...cnt(ss.tournee)]] : []), [{ text: 'Ensemble de la tournée', font: 'bold' }, ...cnt(ss.global)]], fontSize: 8 });
    doc.heading('Décomptes et conclusions par feuille', { level: 3 });
    doc.table({
      columns: [{ label: 'Feuille', width: 150 }, { label: 'Station', width: 76 }, ...['C', 'P', 'NC', 'N/A', 'Non rens.'].map(x => ({ label: x, width: 38 })), { label: 'Conclusion', width: 95 }],
      rows: sheetSummary({ audit, grid: st.grid, ctx: st.ctx }).map(x => [`${x.index}. ${x.title}`, x.station?.name || 'Tournée', String(x.C), String(x.P), String(x.NC), String(x.NA), String(x.unanswered), x.conclusionLabel || '—']), fontSize: 7.6
    });
  }
  doc.paragraph('Répartition des écarts par niveau de criticité : ' + (s.byCriticality.map(c => `${c.label} : ${c.count}`).join(' · ') || 'aucun'), { size: 9 });
  if (s.frequentRequirements.length) doc.paragraph('Exigences les plus fréquemment non conformes : ' + s.frequentRequirements.map(f => `${f.requirement} (${f.count})`).join(' ; '), { size: 9 });
  doc.heading('Points forts', { level: 3 }); doc.bullets(audit.conclusions?.strengths ? [audit.conclusions.strengths, ...s.strengths] : (s.strengths.length ? s.strengths : ['—']), { size: 9 });
  doc.heading('Points de vigilance', { level: 3 }); doc.bullets(audit.conclusions?.vigilance ? [audit.conclusions.vigilance, ...s.vigilance] : (s.vigilance.length ? s.vigilance : ['—']), { size: 9 });
  if (audit.conclusions?.comment) { doc.heading('Commentaire et bilan de l’auditeur', { level: 3 }); doc.paragraph(audit.conclusions.comment); }
  if (audit.conclusions?.preconisations) { doc.heading('Autres préconisations', { level: 3 }); doc.paragraph(audit.conclusions.preconisations); }
  doc.paragraph('Aucun score global n’est calculé : les constats sont présentés de façon factuelle et traçable.', { size: 7.5, color: '#6e7b82', font: 'italic' });

  // 1. Identification
  doc.heading('1. Identification de l’audit');
  doc.keyValues([
    ['Numéro d’audit', audit.number], ['Type d’audit', audit.kind === 'inopine' ? 'Audit inopiné (non planifié)' : 'Audit planifié'],
    ['Date', fmtDate(date)], ['Heure de début', `${fmtTime(audit.startedAt)}${entryDay && entryDay !== date ? ` (saisie démarrée le ${fmtDate(entryDay)})` : ''}`], ['Heure de fin', audit.endedAt ? fmtTime(audit.endedAt) : 'non clôturé'],
    [controllers.length > 1 ? 'Contrôleurs OEG' : 'Contrôleur OEG (auditeur)', controllersText],
    ['Tournée créée par', `${audit.auditorName} (${audit.auditorRole || ''})`],
    ...(controllers.length > 1 || (audit.controllerLog || []).length ? [['Saisies par agent', entriesByAgent(audit).map(r => `${r.name} : ${r.responses} réponse(s)`).join(' ; ')]] : []),
    ['Appareil utilisé', `${audit.device?.name || ''} — ${audit.device?.id || ''}`],
    ['Version de l’application', audit.appVersion], ['Grille d’audit', `${audit.gridSnapshot?.name} — ${audit.gridCode} v${audit.gridVersion}`],
    ['Version du protocole', audit.protocolVersion || 'non renseignée'], ['Version du CCTP', audit.cctpVersion || 'non renseignée'],
    ['Statut', audit.lock?.lockedAt ? `Signé et verrouillé le ${fmtDateTime(audit.lock.lockedAt)}` : (audit.status === 'termine' ? 'Terminé, en attente de signature' : 'En cours')],
    ['Empreinte SHA-256 du contenu', contentHash], ['Intégrité', seal.locked ? seal.message : 'Audit non verrouillé — contenu encore modifiable']
  ]);

  // 2. Contexte
  doc.heading('2. Contexte');
  const camp = store.get('campaign', audit.campaignId);
  doc.keyValues([
    ['Prestation programmée', prestation ? `${prestation.ref} — ${fmtDate(prestation.plannedDate)}${prestation.plannedTime ? ' ' + prestation.plannedTime : ''}${prestation.dateIndicative ? ' (date indicative)' : ''}` : 'Aucune (audit non planifié)'],
    ['Référence du marché', prestation?.marketRef], ['Campagne', camp?.label], ['Type de prélèvement', store.get('samplingType', audit.samplingTypeId)?.label],
    ['Matrice', store.get('matrix', audit.matrixId)?.label], ['Niveau de contrôle attendu', CONTROL_LEVELS[prestation?.controlLevel] || ''],
    ['Fréquence', prestation?.frequency], ['Source de la programmation', prestation?.source?.label || prestation?.source?.kind]
  ]);
  const ctxAlerts = st.alerts.filter(a => a.level !== 'info');
  if (ctxAlerts.length) {
    doc.heading('Alertes relevées pendant l’audit (décision laissée à l’auditeur)', { level: 3 });
    doc.table({ columns: [{ label: 'Niveau', width: 70 }, { label: 'Alerte', width: 130 }, { label: 'Détail', width: 311 }], rows: ctxAlerts.map(a => [a.level, a.title, a.message]) });
  }

  // 3. Prestataire
  doc.heading('3. Prestataire');
  const contract = (provider?.contracts || []).find(c => c.ref === prestation?.marketRef) || provider?.contracts?.[0];
  doc.keyValues([
    ['Raison sociale', provider?.name], ['Nature', PROVIDER_KINDS[provider?.kind] || ''], ['Adresse', provider?.address], ['Contact', [provider?.phone, provider?.email].filter(Boolean).join(' · ')],
    ['Contrat / marché', contract ? `${contract.ref} — ${contract.label || ''} (${fmtDate(contract.start)} → ${fmtDate(contract.end)})` : ''],
    ['Accréditation', provider?.accreditation?.number ? `${provider.accreditation.body || ''} n° ${provider.accreditation.number} — ${provider.accreditation.scope || ''}${provider.accreditation.validUntil ? ' — valide jusqu’au ' + fmtDate(provider.accreditation.validUntil) : ''}` : 'non renseignée']
  ]);

  // 4. Opérateurs
  doc.heading('4. Opérateur(s) contrôlé(s)');
  if (!st.operators.length) doc.paragraph('Aucun opérateur enregistré.');
  else doc.table({
    columns: [{ label: 'Opérateur', width: 110 }, { label: 'Fonction', width: 90 }, { label: 'Habilitations / qualifications', width: 216 }, { label: 'État à la date de l’audit', width: 95 }],
    rows: st.operators.map(o => {
      const os = operatorStatus(o, date, audit.samplingTypeId);
      return [opName(o), o.function || '', (o.qualifications || []).map(q => `${QUALIFICATION_TYPES[q.type] || q.type} : ${q.label}${q.ref ? ' (' + q.ref + ')' : ''}${q.validUntil ? ' — jusqu’au ' + fmtDate(q.validUntil) : ''}`).join('\n') || '—', { text: os.ok ? 'Habilité' : 'Non habilité : ' + os.message, color: os.ok ? COLORS.C : COLORS.NC, font: 'bold' }];
    })
  });

  // 5. Site et point
  doc.heading(multi ? '5. Stations de la tournée et point de prélèvement' : '5. Site et point de prélèvement');
  if (multi) doc.table({
    columns: [{ label: 'N°', width: 24 }, { label: 'Station', width: 120 }, { label: 'Code', width: 90 }, { label: 'Réseaux', width: 60 }, { label: 'Commune / bassin', width: 107 }, { label: 'Prestation programmée', width: 130 }],
    rows: stations.map(x => [String(x.index + 1), x.name, `${x.code} (${x.codeType === 'BSS' ? 'BSS' : 'SANDRE'})`, x.site ? siteNetworks(x.site).map(n => n.code).join(' · ') : '', [x.site?.commune, x.site?.bassin].filter(Boolean).join(' / '), x.prestation ? `${x.prestation.ref || ''}${x.prestation.plannedDate ? ' — ' + fmtDate(x.prestation.plannedDate) : ''}` : '—']),
    fontSize: 8
  });
  const lastGps = (audit.gps || []).slice(-1)[0];
  const threshold = Number(point?.gpsThreshold) || Number(org.gpsThresholdM) || 100;
  doc.keyValues([
    ['Site', site ? `${site.name} (${site.code})` : ''], ['Réseau(x)', site ? siteNetworksText(site) : ''], ['Nature', site?.kind], ['Commune / bassin', [site?.commune, site?.bassin].filter(Boolean).join(' / ')],
    ['Masse d’eau', site?.masseEau], ['Point', point ? `${point.code} — ${point.name}` : ''],
    ['Coordonnées attendues (WGS84)', point?.lat ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : 'non renseignées'],
    ['Dernier relevé GPS', lastGps ? `${lastGps.lat.toFixed(6)}, ${lastGps.lon.toFixed(6)} ±${Math.round(lastGps.accuracy || 0)} m le ${fmtDateTime(lastGps.at)}${lastGps.source === 'manuel' ? ' (saisie manuelle)' : ''}` : 'aucun'],
    ['Écart au point attendu', lastGps && point?.lat ? `${fmtDistance(haversine(point.lat, point.lon, lastGps.lat, lastGps.lon))} (seuil ${fmtDistance(threshold)})` : '']
  ]);

  // 6. Prestation
  doc.heading('6. Prestation');
  if (prestation) {
    const pnet = prestationNetworkOf(prestation);
    doc.keyValues([['Référence', prestation.ref], ['Réseau (programme)', pnet ? (pnet.label && pnet.label !== pnet.code ? `${pnet.code} – ${pnet.label}` : pnet.code) : ''], ['Statut', PRESTATION_STATUS[prestation.status]?.label || prestation.status], ['Équipe', prestation.team], ['Opérateurs programmés', (prestation.operatorIds || []).map(id => opName(store.get('operator', id))).join(', ')]]);
    if ((prestation.statusHistory || []).length) doc.table({ columns: [{ label: 'Date', width: 90 }, { label: 'Par', width: 100 }, { label: 'Évènement', width: 321 }], rows: prestation.statusHistory.map(h => [fmtDateTime(h.at), h.by || '', h.label || (h.to ? `${PRESTATION_STATUS[h.from]?.label || h.from || ''} → ${PRESTATION_STATUS[h.to]?.label || h.to}` : '') + (h.reason ? ` — ${h.reason}` : '')]) });
  } else doc.paragraph('Audit inopiné sans prestation programmée associée.');

  // 7. Documents applicables
  doc.heading('7. Documents applicables (versions figées à la création de l’audit)');
  if (!audit.documentsSnapshot?.length) doc.paragraph('Aucun document applicable enregistré.');
  else doc.table({
    columns: [{ label: 'Type', width: 70 }, { label: 'Document', width: 170 }, { label: 'Version', width: 45 }, { label: 'Application', width: 80 }, { label: 'Empreinte SHA-256', width: 146 }],
    rows: audit.documentsSnapshot.map(d => [DOC_TYPES[d.type] || d.type, `${d.reference || ''} — ${d.name}`, d.version, `${fmtDate(d.applicableFrom)}${d.applicableTo ? ' → ' + fmtDate(d.applicableTo) : ''}`, { text: d.sha256, size: 6.5 }])
  });

  // 8 et 9. Grille et réponses
  doc.heading('8. Grille de contrôle');
  doc.keyValues([['Grille', audit.gridSnapshot?.name], ['Code / version', `${audit.gridCode} v${audit.gridVersion}`], ['Empreinte de la grille', audit.gridSha256], ['Critères visibles', String(st.progress.total)], ['Critères renseignés', `${st.progress.answered} (${st.progress.percent} %)`]]);
  doc.heading('9. Réponses', {});
  const listed = new Set();   // critères « communs à la tournée » : listés une seule fois
  for (const sec of st.structure.filter(x => x.visible)) {
    const domain = sec.domain === 'transport' ? 'CONTRÔLE DU TRANSPORT (pré-analytique)' : 'CONTRÔLE DU PRÉLÈVEMENT';
    const items = sec.visibleItems.filter(isAnswerable).filter(it => !it.shared || !listed.has(it.id));
    if (!items.length) continue;
    items.forEach(it => { if (it.shared) listed.add(it.id); });
    doc.heading(`${sec.title}${sec.station && multi ? ' — ' + sec.station.name : ''}  —  ${domain}`, { level: 3, color: sec.domain === 'transport' ? '#8a4b00' : doc.style.heading });
    const rows = items.map(it => {
      const r = audit.responses?.[it.id];
      const n = st.counts[it.id] || 0;
      return [it.code || '', it.label + (it.shared && multi ? ' (commun à la tournée)' : '') + (it.refs?.length ? '\nRéf. : ' + it.refs.map(rf => refLabel(rf, audit.documentsSnapshot)).join(' ; ') : ''),
        it.kind === 'photo' && n ? { text: `${n} photographie(s) jointe(s)`, color: COLORS.C } : { text: responseText(it, r) || 'Sans réponse', color: COLORS[r?.status] || (r ? doc.style.text : '#b3261e'), font: ['NC', 'P'].includes(r?.status) ? 'bold' : 'regular' },
        (r?.comment || '') + (n ? `${r?.comment ? '\n' : ''}[${n} preuve(s)]` : '') + (r?.at ? `\n${fmtTime(r.at)} ${r.byName || ''}` : '')];
    });
    if (rows.length) doc.table({ columns: [{ label: 'Code', width: 38 }, { label: 'Critère et références', width: 215 }, { label: 'Réponse', width: 92 }, { label: 'Observation / preuve', width: 166 }], rows, fontSize: 8 });
    if (sec.module === 'equipment' && audit.equipmentChecks?.length) {
      doc.paragraph('Matériel de mesure contrôlé', { font: 'bold', size: 9, color: '#003d7a' });
      doc.table({
        columns: [{ label: 'Équipement', width: 100 }, { label: 'Inventaire / série', width: 85 }, { label: 'Marque / modèle', width: 80 }, { label: 'Vérif. / étalonnage', width: 82 }, { label: 'Validité', width: 60 }, { label: 'Constat', width: 104 }],
        rows: audit.equipmentChecks.map(e => { const es = equipmentStatus(e, date); return [e.label || '', `${e.inventoryNo || '—'} / ${e.serial || '—'}`, `${e.brand || ''} ${e.model || ''}`, `${fmtDate(e.checkDate) || '—'} / ${fmtDate(e.calibrationDate) || '—'}`, fmtDate(e.validUntil) || '—', { text: (es.ok ? 'Valide' : es.reasons.join(' ; ')) + (e.certificateAvailable ? ' — certificat disponible' : ''), color: es.ok ? COLORS.C : COLORS.NC }]; }), fontSize: 7.8
      });
    }
    if (sec.module === 'samples' && audit.samples?.length) {
      doc.paragraph('Échantillons enregistrés', { font: 'bold', size: 9, color: '#003d7a' });
      doc.table({
        columns: [{ label: 'Identifiant / code', width: 95 }, { label: 'Date / heure', width: 62 }, { label: 'Matrice / type', width: 85 }, { label: 'Contenant / conservateur', width: 100 }, { label: 'Volume / T°', width: 55 }, { label: 'Opérateur / observations', width: 114 }],
        rows: audit.samples.map(x => [`${x.sampleId}\n${x.code || x.scannedCode || 'NON IDENTIFIÉ'}`, `${fmtDate(x.date)} ${x.time || ''}`, `${store.get('matrix', x.matrixId)?.label || ''}\n${store.get('samplingType', x.samplingTypeId)?.label || ''}`, `${x.container || ''}${x.preservative ? '\n' + x.preservative : ''}`, `${x.volume ? x.volume + ' ' + (x.volumeUnit || 'mL') : ''}${x.temperature !== '' && x.temperature !== undefined && x.temperature !== null ? '\n' + x.temperature + ' °C' : ''}`, `${opName(store.get('operator', x.operatorId))}${x.conservation ? '\n' + x.conservation : ''}${x.observations ? '\n' + x.observations : ''}`]), fontSize: 7.8
      });
    }
  }

  // 10. Observations
  doc.heading('10. Observations');
  const obs = store.filter('observation', o => o.linkedAuditId === audit.id);
  const seenComment = new Set();
  const comments = st.structure.flatMap(sec => sec.visibleItems.filter(it => audit.responses?.[it.id]?.comment && audit.responses[it.id].status !== 'NC' && !seenComment.has(it.id) && seenComment.add(it.id)).map(it => [it.code, audit.responses[it.id].comment]));
  if (!obs.length && !comments.length) doc.paragraph('Aucune observation complémentaire.');
  if (comments.length) doc.table({ columns: [{ label: 'Critère', width: 60 }, { label: 'Observation de l’auditeur', width: 451 }], rows: comments });
  if (obs.length) doc.table({ columns: [{ label: 'Date', width: 80 }, { label: 'Auteur', width: 90 }, { label: 'Observation terrain rattachée', width: 341 }], rows: obs.map(o => [fmtDateTime(o.at), o.authorName || '', `${o.kind === 'urgence' ? '[URGENCE] ' : ''}${o.category ? o.category + ' — ' : ''}${o.text || ''}`]) });

  // 11. Photographies
  doc.heading('11. Photographies');
  const media = auditMedia(audit.id).filter(m => m.link?.type !== 'signature');
  const photos = media.filter(m => m.mime?.startsWith('image/') && m.kind !== 'document');
  if (!photos.length) doc.paragraph('Aucune photographie.');
  else {
    const items = [];
    for (const m of photos) {
      const bytes = await imageFor(m, 900);
      if (bytes) items.push({ bytes, caption: `${linkText(m, audit)} — ${fmtDateTime(m.takenAt)} — ${m.authorName || ''}${m.gps ? ` — GPS ${m.gps.lat.toFixed(5)}, ${m.gps.lon.toFixed(5)}` : ''}${m.derivedFrom ? ' — version annotée' : ''}${m.caption ? ' — ' + m.caption : ''}` });
    }
    doc.imageGrid(items, { cols: 3, maxHeight: 140 });
  }

  // 12. Preuves
  doc.heading('12. Preuves documentaires et intégrité des médias');
  if (!media.length) doc.paragraph('Aucune pièce jointe.');
  else doc.table({ columns: [{ label: 'Pièce', width: 120 }, { label: 'Rattachement', width: 80 }, { label: 'Date / auteur', width: 95 }, { label: 'Empreinte SHA-256', width: 216 }], rows: media.map(m => [`${m.kind === 'photo' ? 'Photographie' : 'Document'} ${m.name || ''}`, linkText(m, audit), `${fmtDateTime(m.takenAt)}\n${m.authorName || ''}`, { text: m.sha256, size: 6.5 }]), fontSize: 7.6 });

  // 13. Écarts
  const devs = st.deviations;
  const crit = code => store.all('criticality').find(c => c.code === code);
  doc.heading('13. Écarts');
  if (!devs.length) doc.paragraph('Aucun écart enregistré.');
  else doc.table({
    columns: [{ label: 'N°', width: 70 }, { label: 'Exigence et référence', width: 130 }, { label: 'Constat factuel', width: 170 }, { label: 'Criticité', width: 66 }, { label: 'Action immédiate', width: 75 }],
    // Tournée de plusieurs stations : station de l'écart (« Tournée (A, B) » pour un écart commun, « (retirée) »).
    rows: devs.map(d => [`${d.number}\n${fmtDate(d.date)} ${d.time || ''}${multi || (d.stationKey && !stations.some(x => x.key === d.stationKey)) ? `\n${deviationPlace(d, { codes: false })}` : ''}`, `${d.requirement || ''}${(d.docRefs || []).length ? '\nRéf. : ' + d.docRefs.map(r => refLabel(r, audit.documentsSnapshot)).join(' ; ') : ''}`, `${d.description || ''}${d.auditorObservation ? '\nObservation : ' + d.auditorObservation : ''}${d.location ? `\nGPS ${d.location.lat.toFixed(5)}, ${d.location.lon.toFixed(5)}` : ''}`, { text: crit(d.criticalityCode)?.label || d.criticalityCode, color: crit(d.criticalityCode)?.color || '#10202b', font: 'bold' }, d.immediateAction || '—']),
    fontSize: 7.8
  });

  // 14. Actions demandées
  doc.heading('14. Actions demandées');
  const acts = devs.filter(d => d.correctiveActionRequested || (d.correctiveActions || []).length);
  if (!acts.length) doc.paragraph('Aucune action corrective demandée.');
  else doc.table({
    columns: [{ label: 'Écart', width: 70 }, { label: 'Action corrective demandée', width: 200 }, { label: 'Responsable', width: 80 }, { label: 'Délai', width: 60 }, { label: 'Statut', width: 101 }],
    rows: acts.map(d => [d.number, d.correctiveActionRequested + ((d.correctiveActions || []).length ? '\n' + d.correctiveActions.map(a => `• ${a.description} (${ACTION_STATUS[a.status] || a.status})`).join('\n') : ''), d.responsible || '', fmtDate(d.dueDate), DEVIATION_STATUS[d.status]?.label || d.status]),
    fontSize: 7.8
  });

  // 15. Signatures
  doc.heading('15. Signatures');
  for (const role of ['auditor', 'provider']) {
    const sg = audit.signatures?.[role];
    doc.paragraph(role === 'auditor' ? (controllers.length > 1 ? `Contrôleur OEG (pour les contrôleurs de la tournée : ${controllersText})` : 'Auditeur') : 'Représentant du prestataire', { font: 'bold', size: 10, color: '#003d7a', gap: 1 });
    if (!sg) { doc.paragraph('Non signé.', { color: '#b3261e' }); continue; }
    if (sg.refused) doc.paragraph(`${sg.name || 'Représentant'} — refus ou impossibilité de signer, consigné le ${fmtDateTime(sg.at)}. Motif : ${sg.comment || 'non précisé'}`);
    else {
      doc.paragraph(`${sg.name}${sg.function ? ' — ' + sg.function : ''} — signé le ${fmtDate(sg.at)} à ${fmtTime(sg.at)}${sg.offline ? ' (hors connexion)' : ''}`, { gap: 2 });
      const m = sg.mediaId ? store.get('media', sg.mediaId) : null;
      const b = m ? await imageFor(m, 600) : null;
      if (b) doc.image(b, { maxWidth: 180, maxHeight: 70 });
    }
    doc.paragraph(`Empreinte du contenu au moment de la signature : ${sg.contentHash}`, { size: 7, color: '#4f5f67' });
  }
  if (audit.lock?.lockedAt) doc.paragraph(`Audit verrouillé le ${fmtDateTime(audit.lock.lockedAt)} par ${audit.lock.lockedByName}. Empreinte scellée : ${audit.lock.contentHash}. Toute modification ultérieure est historisée (rubrique 16).`, { size: 8.5, font: 'bold', color: '#1b7a43' });

  // 16. Historique
  doc.heading('16. Historique des modifications');
  if ((audit.amendments || []).length) {
    doc.paragraph('Modifications après signature (valeur précédente conservée) :', { font: 'bold', size: 9 });
    doc.table({
      columns: [{ label: 'Date', width: 75 }, { label: 'Auteur', width: 85 }, { label: 'Motif', width: 120 }, { label: 'Modifications (avant → après)', width: 231 }],
      rows: audit.amendments.map(a => [fmtDateTime(a.at), `${a.byName} (${a.role})`, a.reason, a.changes.map(c => `${c.path} : ${JSON.stringify(c.before ?? '')} → ${JSON.stringify(c.after ?? '')}`).join('\n')]), fontSize: 7.5
    });
  }
  const trail = store.filter('trail', t => t.entityId === audit.id || (t.entityType === 'deviation' && devs.some(d => d.id === t.entityId))).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const ACTIONS = { create: 'Création', update: 'Modification', amend: 'Modification après signature', sign: 'Signature', lock: 'Verrouillage', finish: 'Clôture', reopen: 'Réouverture', report: 'Génération de rapport', delete: 'Suppression', abandon: 'Abandon', 'controller-add': 'Contrôleur ajouté', 'controller-remove': 'Contrôleur retiré' };
  doc.table({
    columns: [{ label: 'Date et heure', width: 78 }, { label: 'Utilisateur', width: 85 }, { label: 'Appareil', width: 70 }, { label: 'Action', width: 90 }, { label: 'Détail', width: 188 }],
    rows: trail.slice(-250).map(t => [fmtDateTime(t.at), t.userName || '', t.deviceName || '', `${ACTIONS[t.action] || t.action}${t.entityType === 'deviation' ? ' (écart ' + t.entityLabel + ')' : ''}`, `${t.reason ? 'Motif : ' + t.reason + '\n' : ''}${t.changeCount ? t.changeCount + ' champ(s) : ' + (t.changes || []).slice(0, 4).map(c => c.path).join(', ') : ''}`]), fontSize: 7.2
  });
  doc.paragraph(`Journal informatique chaîné par empreintes SHA-256 (${trail.length} entrée(s) relatives à cet audit). Vérification d’intégrité disponible dans l’application (Journal d’audit).`, { size: 7.5, color: '#4f5f67' });

  const bytes = await doc.outputAsync();
  const sha256 = await sha256Hex(bytes);
  return { bytes, sha256, provisional, pages: doc.pages.length, filename: `${audit.number}${provisional ? '_PROVISOIRE' : ''}_rapport.pdf`, generatedAt, contentHash };
}

/** Génère le rapport et enregistre sa trace (empreinte du PDF) dans l'audit. */
export async function generateAuditReport(auditId) {
  const r = await buildAuditReport(auditId);
  const a = store.get('audit', auditId);
  await store.put('audit', { ...a, reports: [...(a.reports || []), { at: r.generatedAt, by: session.user.name, sha256: r.sha256, provisional: r.provisional, pages: r.pages, contentHash: r.contentHash, appVersion: appVersion() }] }, { action: 'report', reason: r.provisional ? 'Rapport provisoire' : 'Rapport définitif' });
  return r;
}
