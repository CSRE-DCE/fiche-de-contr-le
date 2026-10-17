/* Référentiels administrables (types de prélèvements, matrices, équipements, unités, opérateurs, réseaux de
 * surveillance, sites, points, niveaux d'écart, types d'écarts, méthodes, contenants, campagnes). Formulaires
 * génériques décrits par un schéma ; chaque modification est tracée au journal.
 * Réseaux de surveillance (type 'network', js/domain/networks.js) : identifiant déterministe net-<code>, code non
 * modifiable après la création (enregistré sur les stations et les campagnes), suppression refusée tant qu'une station
 * ou une campagne l'utilise ; liste triée par ordre d'affichage, pastille de couleur et nombre de stations.
 * Sites (stations des fiches de contrôle 2026) : les champs non décrits par le schéma (types de tournée, code
 * BSS, compartiments, accès, photos, points de prélèvement…) sont conservés ; une nouvelle station reçoit les
 * champs « station » vides et ses types / compartiments déduits des réseaux (cases à cocher du référentiel) ; la
 * modification complète se fait dans la fiche station (#/station/:id/modifier). Campagnes : réseau choisi dans la
 * liste du référentiel. */
import { html, raw, uuid, sortBy, normalize, localDate } from '../core/util.js';
import { store } from '../core/store.js';
import { can } from '../core/auth.js';
import { navigate } from '../ui/router.js';
import { toast, openModal, formValues, promptDialog, downloadBlob } from '../ui/dom.js';
import { pageTitle, badge, empty, options, field, networkChecks, networkDot } from '../ui/components.js';
import { EQUIPMENT_STATUS } from '../domain/model.js';
import { equipmentStatus } from '../domain/rules.js';
import { toCSV } from '../formats/csv.js';
import { emptyStationFields, stationTypes, stationCompartments } from '../domain/seed.js';
import { networkId, networkColors, sortNetworkCodes, AUDIT_TYPE_KEYS } from '../domain/networks.js';
import { currentNetworkIndex, currentNetworkList, networkUsage } from '../app/networks.js';
import { TYPE_STYLES } from '../ui/map.js';
import { latLonToUtm } from '../lib/geo.js';

const ref = (type, label = x => x.label || x.name) => ({ type: 'ref', ref: type, label });
export const SCHEMAS = {
  samplingType: { title: 'Types de prélèvements', icon: '🧪', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'matrixIds', l: 'Matrices', type: 'multiref', ref: 'matrix' }, { k: 'description', l: 'Description', type: 'textarea' }] },
  matrix: { title: 'Matrices', icon: '💧', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  method: { title: 'Méthodes', icon: '📐', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'reference', l: 'Référence (norme, mode opératoire)' }, { k: 'docKey', l: 'Clé du document associé' }] },
  unit: { title: 'Unités', icon: '📏', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'symbol', l: 'Symbole', req: true }, { k: 'label', l: 'Libellé' }, { k: 'quantity', l: 'Grandeur' }] },
  criticality: { title: 'Niveaux d’écart (criticité)', icon: '🚦', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'rank', l: 'Rang (0 = moins grave)', type: 'number', req: true }, { k: 'color', l: 'Couleur', type: 'color' }, { k: 'defaultDelayDays', l: 'Délai de traitement par défaut (jours)', type: 'number' }, { k: 'requiresImmediateAction', l: 'Action immédiate obligatoire', type: 'checkbox' }, { k: 'definition', l: 'Définition (système qualité)', type: 'textarea' }] },
  deviationType: { title: 'Types d’écarts', icon: '🏷️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  container: { title: 'Contenants', icon: '🧴', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }] },
  equipment: { title: 'Équipements', icon: '🔧', fields: [{ k: 'inventoryNo', l: 'N° d’inventaire', req: true }, { k: 'label', l: 'Désignation', req: true }, { k: 'providerId', l: 'Prestataire / propriétaire', ...ref('provider') }, { k: 'category', l: 'Catégorie', type: 'select', opts: [['mesure', 'Matériel de mesure'], ['prelevement', 'Matériel de prélèvement']] }, { k: 'brand', l: 'Marque' }, { k: 'model', l: 'Modèle' }, { k: 'serial', l: 'N° de série' }, { k: 'lastCheckDate', l: 'Date de vérification', type: 'date' }, { k: 'calibrationDate', l: 'Date d’étalonnage', type: 'date' }, { k: 'calibrationRequired', l: 'Étalonnage requis', type: 'checkbox' }, { k: 'validUntil', l: 'Date de validité', type: 'date' }, { k: 'certificateRef', l: 'Certificat / constat' }, { k: 'status', l: 'Statut', type: 'select', opts: Object.entries(EQUIPMENT_STATUS) }], sub: e => { const s = equipmentStatus(e, localDate()); return s.ok ? badge('Valide', 'ok') : badge(s.reasons[0], s.level === 'critique' ? 'nc' : 'warn'); } },
  operator: { title: 'Opérateurs', icon: '👷', fields: [{ k: 'providerId', l: 'Prestataire', req: true, ...ref('provider') }, { k: 'code', l: 'Code / initiales', req: true }, { k: 'lastName', l: 'Nom' }, { k: 'firstName', l: 'Prénom' }, { k: 'function', l: 'Fonction' }, { k: 'active', l: 'Actif', type: 'checkbox' }], note: 'Les habilitations se gèrent depuis la fiche du prestataire.' },
  network: {
    title: 'Réseaux de surveillance', icon: '🗺️',
    fields: [
      { k: 'code', l: 'Code (enregistré sur les stations et les campagnes)', req: true, fixed: true }, { k: 'label', l: 'Libellé', req: true },
      { k: 'description', l: 'Description (marché, programme)', type: 'textarea' }, { k: 'color', l: 'Couleur', type: 'color' },
      { k: 'order', l: 'Ordre d’affichage (croissant)', type: 'number' },
      { k: 'auditTypes', l: 'Types de tournée associés', type: 'checks', opts: AUDIT_TYPE_KEYS.map(k => [k, TYPE_STYLES[k].label]) },
      { k: 'active', l: 'Actif (proposé à la saisie des stations et des campagnes)', type: 'checkbox' }
    ],
    note: 'Le code ne se modifie plus après la création : il est enregistré sur les stations et les campagnes. Les types de tournée associés sont proposés pour les stations du réseau (biologie : déduite des listes biologiques de la station). Un réseau utilisé ne peut pas être supprimé : le rendre inactif.',
    sort: list => sortNetworkCodes(list.map(n => n.code), currentNetworkIndex()).map(c => list.find(n => n.code === c)),
    title2: n => `${n.code} – ${n.label || n.code}`,
    line: n => { const u = networkUsage(n.code); return [`${u.sites} station(s)`, u.campaigns ? `${u.campaigns} campagne(s)` : '', (n.auditTypes || []).length ? 'tournées : ' + n.auditTypes.map(k => TYPE_STYLES[k]?.label || k).join(', ') : '', n.description].filter(Boolean).join(' · '); },
    sub: n => n.active === false ? badge('Inactif', 'na') : ''
  },
  site: { title: 'Sites', icon: '🏞️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'name', l: 'Nom', req: true }, { k: 'networks', l: 'Réseaux de surveillance', type: 'codes' }, { k: 'kind', l: 'Nature' }, { k: 'codeType', l: 'Type de code', type: 'select', opts: [['SANDRE', 'Code SANDRE'], ['BSS', 'Code BSS (eaux souterraines)']] }, { k: 'commune', l: 'Commune' }, { k: 'bassin', l: 'Bassin versant' }, { k: 'masseEau', l: 'Masse d’eau' }, { k: 'matrixId', l: 'Matrice principale', ...ref('matrix') }, { k: 'lat', l: 'Latitude (WGS84)', type: 'number' }, { k: 'lon', l: 'Longitude (WGS84)', type: 'number' }, { k: 'transportModes', l: 'Moyens d’accès (séparés par « ; »)', type: 'list' }, { k: 'notes', l: 'Accès / consignes', type: 'textarea' }] },
  point: { title: 'Points de prélèvement', icon: '📍', fields: [{ k: 'siteId', l: 'Site', req: true, ...ref('site', s => `${s.name} (${s.code})`) }, { k: 'code', l: 'Code du point', req: true }, { k: 'name', l: 'Nom' }, { k: 'lat', l: 'Latitude', type: 'number' }, { k: 'lon', l: 'Longitude', type: 'number' }, { k: 'gpsThreshold', l: 'Seuil d’alerte GPS propre au point (m)', type: 'number' }, { k: 'description', l: 'Description / repérage', type: 'textarea' }] },
  campaign: { title: 'Campagnes', icon: '🗓️', fields: [{ k: 'code', l: 'Code', req: true }, { k: 'label', l: 'Libellé', req: true }, { k: 'network', l: 'Réseau', type: 'code' }, { k: 'start', l: 'Début', type: 'date' }, { k: 'end', l: 'Fin', type: 'date' }] }
};
const LINKS = [['prestataires', '🏢', 'Prestataires, partenaires et régie'], ['documents', '📚', 'Documents (CCTP, protocoles, normes…)'], ['grilles', '🧩', 'Grilles d’audit']];
const titleOf = (type, e) => e.label || e.name || (type === 'operator' ? [e.firstName, e.lastName].filter(Boolean).join(' ') || e.code : e.code) || e.id;

export default {
  nav: 'referentiels', title: 'Référentiels',
  async render() {
    return html`${pageTitle('Référentiels', 'Données de base administrables utilisées par les audits')}
      <div class="list">${Object.entries(SCHEMAS).map(([t, s]) => html`<a class="li" href="#/referentiel/${t}"><span style="font-size:24px">${s.icon}</span><div class="li-main"><div class="li-title">${s.title}</div><div class="li-sub">${store.count(t)} élément(s)</div></div><span class="chev">›</span></a>`)}
      ${LINKS.map(([h, i, l]) => html`<a class="li" href="#/${h}"><span style="font-size:24px">${i}</span><div class="li-main"><div class="li-title">${l}</div></div><span class="chev">›</span></a>`)}</div>`;
  }
};

function control(f, value, { isNew = true } = {}) {
  const v = value ?? '';
  if (f.fixed && !isNew) return html`<input name="${f.k}" value="${v}" readonly aria-readonly="true">`;
  switch (f.type) {
    case 'textarea': return html`<textarea name="${f.k}">${v}</textarea>`;
    case 'number': return html`<input name="${f.k}" type="text" inputmode="decimal" value="${v}" ${f.req ? raw('required') : ''}>`;
    case 'date': return html`<input name="${f.k}" type="date" value="${v}">`;
    case 'color': return html`<input name="${f.k}" type="color" value="${v || '#55636a'}" style="min-height:52px">`;
    case 'checkbox': return html`<label class="check"><input type="checkbox" name="${f.k}" ${value === undefined && f.k === 'active' || value ? raw('checked') : ''}> ${f.l}</label>`;
    case 'select': return html`<select name="${f.k}">${options(f.opts.map(([id, label]) => ({ id, label })), v, { placeholder: null })}</select>`;
    case 'ref': return html`<select name="${f.k}" ${f.req ? raw('required') : ''}>${options(sortBy(store.all(f.ref), x => f.label(x)), v, { label: f.label })}</select>`;
    case 'multiref': return html`<select name="${f.k}" multiple size="4">${options(store.all(f.ref), v || [], { placeholder: null })}</select>`;
    case 'list': return html`<input name="${f.k}" value="${(v || []).join('; ')}">`;
    // Cases à cocher d'options fixes (valeurs enregistrées en tableau).
    case 'checks': return html`<div class="checks">${f.opts.map(([id, label]) => html`<label class="check"><input type="checkbox" name="${f.k}" data-multi value="${id}" ${(v || []).includes(id) ? raw('checked') : ''}> ${label}</label>`)}</div>`;
    // Codes de réseaux de surveillance (référentiel « Réseaux ») : cases à cocher ; un code déjà porté reste proposé.
    case 'codes': return networkChecks(f.k, currentNetworkList({ keep: v || [] }), v || []);
    // Un code de réseau : liste du référentiel (le code déjà enregistré reste proposé).
    case 'code': return html`<select name="${f.k}">${options(currentNetworkList({ keep: v ? [v] : [] }).map(n => ({ id: n.code, label: n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code })), v, { placeholder: '— aucun —' })}</select>`;
    default: return html`<input name="${f.k}" value="${v}" ${f.req ? raw('required') : ''}>`;
  }
}
function readValues(schema, v) {
  const out = {};
  for (const f of schema.fields) {
    let x = v[f.k];
    if (f.type === 'number') x = x === '' || x === undefined ? null : Number(String(x).replace(',', '.'));
    if (f.type === 'list') x = String(x || '').split(';').map(s => s.trim()).filter(Boolean);
    if (f.type === 'checks' || f.type === 'codes') x = Array.isArray(x) ? x : [];
    if (f.type === 'codes') x = sortNetworkCodes(x, currentNetworkIndex());
    if (f.fixed) x = String(x ?? '').trim();
    out[f.k] = x;
  }
  return out;
}

/**
 * Site : champs « station » des fiches de contrôle 2026 complétés sans écraser l'existant (nouvelle station :
 * champs vides, types de tournée et compartiments déduits des réseaux ; coordonnées RGFG95 déduites du WGS84).
 */
function stationDefaults(site, isNew) {
  const next = isNew ? { ...emptyStationFields(), ...site } : { ...site };
  const idx = currentNetworkIndex();
  if (!next.codeType) next.codeType = stationTypes({ networks: next.networks }, idx).includes('eso') ? 'BSS' : 'SANDRE';
  if (next.codeType === 'BSS' && !next.matrixId) next.matrixId = 'mat-ESO';
  if (!Array.isArray(next.types) || !next.types.length) next.types = stationTypes(next, idx);
  if (!Array.isArray(next.compartments) || !next.compartments.length) next.compartments = stationCompartments(next);
  const hasLL = isFinite(next.lat) && isFinite(next.lon) && next.lat !== null && next.lon !== null;
  if (hasLL && (isNew || next.x === null || next.x === undefined || next.x === '')) {
    const [x, y] = latLonToUtm(next.lat, next.lon, 22);
    next.x = Math.round(x); next.y = Math.round(y);
  }
  return next;
}

export function editEntity(type, e = null) {
  const schema = SCHEMAS[type];
  const isNew = !e;
  e = e || (type === 'network' ? { color: '#5f6b7a', order: 100, auditTypes: [] } : { id: uuid() });
  const m = openModal({
    title: (isNew ? 'Nouveau : ' : 'Modifier : ') + schema.title.toLowerCase(), wide: true,
    body: html`<form id="rf"><div class="grid2">${schema.fields.map(f => f.type === 'checkbox' ? html`<div class="field">${control(f, e[f.k], { isNew })}</div>` : field(f.l, control(f, e[f.k], { isNew }), { required: f.req, hint: f.fixed && !isNew ? 'Non modifiable : enregistré sur les stations et les campagnes.' : '' }))}</div>${schema.note ? html`<p class="note">${schema.note}</p>` : ''}</form>`,
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', act: 'ok', cls: 'primary' }],
    handlers: {
      async ok() {
        const f = this.root.querySelector('#rf'); if (!f.reportValidity()) return;
        const vals = readValues(schema, formValues(f));
        for (const x of schema.fields) if (x.fixed && !isNew) vals[x.k] = e[x.k];   // code d'un réseau : jamais modifié
        const codeKey = schema.fields[0].k === 'code' ? 'code' : schema.fields[0].k === 'inventoryNo' ? 'inventoryNo' : null;
        // Réseaux : code unique sans tenir compte de la casse ni des accents (« chimie » = « Chimie »).
        const same = (a, b) => type === 'network' ? normalize(a) === normalize(b) : String(a) === String(b);
        if (codeKey && store.find(type, x => x.id !== e.id && same(x[codeKey], vals[codeKey]) && (type !== 'point' || x.siteId === vals.siteId) && (type !== 'operator' || x.providerId === vals.providerId))) { toast('Ce code existe déjà.', 'err'); return; }
        let next = { ...e, ...vals };
        if (type === 'network') {
          if (isNew) next.id = networkId(vals.code);
          next.order = Number.isFinite(vals.order) ? vals.order : 100;
          next.auditTypes = AUDIT_TYPE_KEYS.filter(k => (vals.auditTypes || []).includes(k));
          next.color = networkColors(vals.color).main;
        }
        if (type === 'equipment') next.statusLabel = EQUIPMENT_STATUS[next.status];
        if (type === 'site') next = stationDefaults(next, isNew);
        await store.put(type, next, { reason: isNew ? 'Création' : 'Modification du référentiel' });
        this.close(next);
      }
    }
  });
  return m.result;
}

export const listView = {
  nav: 'referentiels', title: 'Référentiel',
  async render({ type }, q) {
    const schema = SCHEMAS[type];
    if (!schema) return html`<div class="card">${empty('❓', 'Référentiel inconnu.')}</div>`;
    let list = store.all(type);
    if (q.q) { const t = normalize(q.q); list = list.filter(e => normalize(JSON.stringify(e)).includes(t)); }
    list = schema.sort ? schema.sort(list) : sortBy(list, type === 'criticality' ? 'rank' : (x => titleOf(type, x)));
    const manage = can('ref.manage');
    const second = e => schema.line ? schema.line(e) : schema.fields.slice(1, 4).filter(f => !['textarea', 'checkbox', 'multiref'].includes(f.type)).map(f => f.type === 'ref' ? (store.get(f.ref, e[f.k]) ? f.label(store.get(f.ref, e[f.k])) : '') : Array.isArray(e[f.k]) ? e[f.k].join(', ') : e[f.k]).filter(x => x !== '' && x !== null && x !== undefined).join(' · ');
    const dot = e => type === 'criticality' ? html`<span style="width:18px;height:18px;border-radius:50%;background:${e.color};flex:none"></span>` : type === 'network' ? networkDot(e) : '';
    const sub = e => schema.sub ? schema.sub(e) : '';
    return html`${pageTitle(schema.title, `${list.length} élément(s)`, html`${manage ? html`<button class="btn primary" data-act="new">＋ Ajouter</button>` : ''}<button class="btn ghost" data-act="csv">Exporter (CSV)</button>`, '#/referentiels')}
      <div class="field"><input type="search" placeholder="Rechercher…" value="${q.q || ''}" data-change="search"></div>
      ${list.length ? html`<div class="list">${list.slice(0, 400).map(e => html`<button class="li" data-act="${manage ? 'edit' : 'noop'}" data-id="${e.id}">${dot(e)}<div class="li-main"><div class="li-title">${schema.title2 ? schema.title2(e) : titleOf(type, e)}</div><div class="li-sub">${second(e)}</div>${String(sub(e)) ? html`<div style="margin-top:4px">${sub(e)}</div>` : ''}</div>${manage ? html`<span class="chev">›</span>` : ''}</button>`)}</div>${list.length > 400 ? html`<p class="note">400 premiers éléments affichés : affinez la recherche.</p>` : ''}` : html`<div class="card">${empty('🗂️', 'Aucun élément.')}</div>`}
      ${schema.note && type === 'network' ? html`<p class="note">${schema.note}</p>` : ''}`;
  },
  handlers: {
    search(el) { navigate(`/referentiel/${this.params.type}?q=${encodeURIComponent(el.value)}`, { replace: true }); },
    noop() {},
    async new() { if (await editEntity(this.params.type)) this.refresh(); },
    async edit(el) {
      const type = this.params.type, e = store.get(type, el.dataset.id);
      const isSite = type === 'site';
      const m = openModal({ title: titleOf(type, e), body: html`<p class="note">Créé le ${new Date(e.createdAt).toLocaleString('fr-FR')} par ${e.createdByName || '—'} · modifié le ${new Date(e.updatedAt).toLocaleString('fr-FR')} par ${e.updatedByName || '—'}</p>${isSite ? html`<p class="note">La fiche station regroupe toutes les informations de la station (accès, photos, compartiments, points de prélèvement).</p>` : ''}`,
        actions: [{ label: 'Supprimer', act: 'del', cls: 'danger-ghost' }, ...(isSite ? [{ label: 'Fiche station', act: 'sheet' }] : []), { label: 'Modifier', act: 'edit', cls: 'primary' }],
        handlers: { del() { this.close('del'); }, edit() { this.close('edit'); }, sheet() { this.close('sheet'); } } });
      const choice = await m.result;
      if (choice === 'sheet') { navigate('/station/' + encodeURIComponent(e.id)); return; }
      if (choice === 'edit' && isSite) { navigate(`/station/${encodeURIComponent(e.id)}/modifier`); return; }
      if (choice === 'edit') { if (await editEntity(type, e)) this.refresh(); }
      if (choice === 'del') {
        if (type === 'network') {
          const u = networkUsage(e.code);
          if (u.sites || u.campaigns) { toast(`Réseau ${e.code} utilisé par ${u.sites} station(s)${u.campaigns ? ` et ${u.campaigns} campagne(s)` : ''} : suppression impossible. Retirez-le d’abord des stations et des campagnes, ou rendez-le inactif.`, 'err', 8000); return; }
        }
        const reason = await promptDialog({ title: 'Supprimer l’élément', label: 'Motif (la suppression est tracée ; les audits passés conservent leurs données)' });
        if (!reason) return;
        await store.remove(type, e.id, reason); toast('Élément supprimé', 'ok'); this.refresh();
      }
    },
    async csv() {
      const type = this.params.type, schema = SCHEMAS[type];
      const rows = [['id', ...schema.fields.map(f => f.l)], ...store.all(type).map(e => [e.id, ...schema.fields.map(f => Array.isArray(e[f.k]) ? e[f.k].join('; ') : f.type === 'ref' ? (store.get(f.ref, e[f.k]) ? f.label(store.get(f.ref, e[f.k])) : '') : e[f.k] ?? '')])];
      downloadBlob(toCSV(rows), `referentiel_${type}_${localDate()}.csv`, 'text/csv;charset=utf-8');
      await store.log('export', { entityLabel: `Référentiel ${schema.title}`, details: `${rows.length - 1} lignes CSV` });
    }
  }
};
