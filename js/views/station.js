/* Page « Fiche station » (#/station/:id) : la fiche station de contrôle terrain (feuille 1, maquette
 * docs/maquettes/feuille-1-station.webp) et les actions de terrain : démarrer une tournée avec cette station
 * (type de tournée déduit), reprendre une tournée non signée qui la contient, fiches vierges et fiche station
 * en PDF (module js/app/sheets-pdf.js, chargé à la demande), modification de la station (droit ref.manage),
 * prestations programmées et historique des tournées de la station. Variante de fiche au choix si la station
 * relève de plusieurs types de tournée (?type=bio|ce|eso). */
import { html, fmtDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { empty, auditBadge, badge } from '../ui/components.js';
import { TYPE_STYLES } from '../ui/map.js';
import { gridType, inferAuditType, providerHeaderName } from '../domain/grids.js';
import { stationSheet, mountStationSheet, unmountStationSheet, stationHandlers, siteTypes, primaryType, stationAudits, stationStatus, openPrestations, plannedLabel, prestationType, ctGrid, typeBadges } from './station-sheet.js';

/** Module de génération des fiches PDF (écrit séparément) ; null avec un message clair s'il est absent. */
async function sheetsPdf() {
  try { return await import('../app/sheets-pdf.js'); }
  catch (e) {
    console.warn('Module PDF des fiches indisponible :', e?.message || e);
    toast('La génération des fiches PDF n’est pas disponible dans cette version de l’application.', 'warn', 5000);
    return null;
  }
}
async function savePdf(result, fallbackName) {
  if (!result?.bytes) throw new Error('Le document PDF n’a pas pu être produit.');
  downloadBlob(result.bytes, result.filename || fallbackName, 'application/pdf');
  toast('Document PDF généré ✓', 'ok');
}

/** Type de tournée affiché / proposé : ?type= s'il convient à la station, sinon déduit (prestation programmée, types du site). */
function variantType(site, q) {
  const grid = ctGrid();
  const types = siteTypes(site);
  if (q.type && types.includes(q.type) && gridType(grid, q.type)) return q.type;
  const p = openPrestations(site.id)[0] || null;
  const t = inferAuditType(grid, { site, prestation: p });
  return types.includes(t) ? t : primaryType(site);
}

function prestationRow(p, site) {
  const prov = store.get('provider', p.providerId);
  const type = prestationType(p);
  return html`<div class="li stp-pres${p.plannedDate ? '' : ' is-unplanned'}">
    <a class="li-main" href="#/prestation/${p.id}"><div class="li-title">${p.ref}</div>
      <div class="li-sub">${providerHeaderName(prov) || '—'} · ${store.get('campaign', p.campaignId)?.label || 'hors campagne'}</div>
      <div class="row" style="gap:6px;margin-top:6px">${p.plannedDate ? badge(plannedLabel(p), 'info') : badge('À planifier', 'warn')}${type && TYPE_STYLES[type] ? html`<span class="type-badge t-${type}">${icon(TYPE_STYLES[type].icon, { size: 15 })}${TYPE_STYLES[type].label}</span>` : ''}</div></a>
    ${can('audit.create') ? html`<a class="btn ghost sm" href="#/nouvel-audit?site=${encodeURIComponent(site.id)}&prestation=${encodeURIComponent(p.id)}&type=${type}">${icon('plus', { size: 18 })}Tournée</a>` : ''}
  </div>`;
}

function auditRow(a) {
  const prov = store.get('provider', a.providerId);
  const n = (a.stations || []).length || 1;
  const t = a.auditType && TYPE_STYLES[a.auditType];
  return html`<a class="li ${a.lock?.lockedAt ? 'stripe-ok' : 'stripe-perf'}" href="#/audit/${a.id}">
    <span class="li-ic">${icon('route')}</span>
    <div class="li-main"><div class="li-title">${a.number}${n > 1 ? html` <span class="tiny muted">· tournée de ${n} stations</span>` : ''}</div>
      <div class="li-sub">${fmtDate(a.startedAt)} · ${providerHeaderName(prov) || '—'}${t ? ` · ${t.label}` : ''} · ${a.auditorName || ''}</div></div>
    <span class="li-side">${auditBadge(a)}</span></a>`;
}

export default {
  nav: 'home', title: 'Fiche station',
  async render({ id }, q) {
    const site = store.get('site', id);
    if (!site) return html`<a class="back" href="#/">‹ Stations</a><div class="card">${empty(icon('station', { size: 44 }), 'Station introuvable sur cet appareil.')}</div>`;
    const types = siteTypes(site);
    const type = variantType(site, q);
    const audits = stationAudits(site.id);
    const status = stationStatus(site.id, { audits });
    const open = audits.filter(a => !a.lock?.lockedAt && ['en_cours', 'termine'].includes(a.status));
    const prestations = openPrestations(site.id);
    const startHref = `#/nouvel-audit?site=${encodeURIComponent(site.id)}&type=${type}`;
    return html`
      <div class="stp-top">
        <a class="back" href="#/">‹ Stations</a>
        <div class="stp-meta">${typeBadges(site)}${badge(status.label, status.cls)}</div>
      </div>
      <div class="stp-actions">
        ${open.map(a => html`<a class="btn primary lg" href="#/audit/${a.id}"><span class="ic">${icon('route')}</span>Reprendre la tournée ${a.number}</a>`)}
        ${can('audit.create') ? html`<a class="btn ${open.length ? 'ghost' : 'primary lg'}" href="${startHref}"><span class="ic">${icon('plus')}</span>Démarrer une tournée</a>` : ''}
        <button class="btn ghost" data-act="blankPdf" title="Fiches de contrôle vierges à imprimer pour cette station"><span class="ic">${icon('print')}</span>Fiches vierges (PDF)</button>
        <button class="btn ghost" data-act="stationPdf"><span class="ic">${icon('pdf')}</span>Fiche station (PDF)</button>
        <a class="btn ghost" href="#/carte?site=${encodeURIComponent(site.id)}"><span class="ic">${icon('map')}</span>Carte</a>
        ${can('ref.manage') ? html`<a class="btn ghost" href="#/station/${encodeURIComponent(site.id)}/modifier"><span class="ic">${icon('edit')}</span>Modifier la station</a>` : ''}
      </div>
      ${types.length > 1 ? html`<div class="chips stp-variants" role="group" aria-label="Variante de la fiche">${types.map(t => html`<button class="chip ${t === type ? 'sel' : ''}" data-act="variant" data-type="${t}" aria-pressed="${t === type}">${icon(TYPE_STYLES[t].icon)}${TYPE_STYLES[t].long}</button>`)}</div>` : ''}
      ${stationSheet({ site, editable: can('ref.manage'), auditType: type, variant: 'page' })}
      <div class="stp-grid">
        <section class="card"><h2>${icon('calendar', { size: 22 })} Prestations programmées</h2>
          ${prestations.length ? html`<div class="list">${prestations.map(p => prestationRow(p, site))}</div>` : html`<p class="note">Aucune prestation programmée ouverte pour cette station. Une tournée peut être créée librement (« Démarrer une tournée »).</p>`}</section>
        <section class="card"><h2>${icon('history', { size: 22 })} Historique des tournées</h2>
          ${audits.length ? html`<div class="list">${audits.map(auditRow)}</div>` : html`<p class="note">Aucune tournée n’a encore contrôlé cette station.</p>`}</section>
      </div>`;
  },
  mount(root, { id }) { return mountStationSheet(root, { site: store.get('site', id) }); },
  unmount() { unmountStationSheet(); },
  handlers: {
    ...stationHandlers,
    variant(el) { navigate(`/station/${encodeURIComponent(this.params.id)}?type=${el.dataset.type}`, { replace: true }); },
    async blankPdf() {
      const site = store.get('site', this.params.id);
      const mod = await sheetsPdf();
      if (!mod) return;
      if (typeof mod.generateBlankSheetsPdf !== 'function') { toast('Fiches vierges : fonction indisponible dans cette version.', 'warn'); return; }
      toast('Préparation des fiches vierges…', '', 2000);
      const auditType = variantType(site, this.query);
      await savePdf(await mod.generateBlankSheetsPdf({ auditType, siteId: site.id }), `fiches-vierges_${auditType}_${site.code}.pdf`);
    },
    async stationPdf() {
      const site = store.get('site', this.params.id);
      const mod = await sheetsPdf();
      if (!mod) return;
      if (typeof mod.generateStationSheetPdf !== 'function') { toast('Fiche station : fonction indisponible dans cette version.', 'warn'); return; }
      toast('Préparation de la fiche station…', '', 2000);
      await savePdf(await mod.generateStationSheetPdf({ siteId: site.id, auditType: variantType(site, this.query) }), `fiche-station_${site.code}.pdf`);
    }
  }
};
