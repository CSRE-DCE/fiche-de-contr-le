/* Tests unitaires des « Attendus des prestataires » (navigateur, sans base de données) :
 * - data/attendus-ct-2026.json : une entrée complète par critère de GRID_CT_2026 (attendu, vérification, C, P, NC
 *   pour les critères de conformité ; « information à relever » pour les critères valeur seule), aucune clé
 *   orpheline, feuille / n° / libellé / section / portée / types recopiés à l'identique de la grille, feuilles 1 à 10,
 *   échelle, liste de préparation, références normatives connues, aucun nombre « contractuel » inventé (heuristique),
 *   turbidité en NTU ;
 * - js/app/attendus-pdf.js : attenduFor (identifiants de base et effectifs), visibilité par type de tournée calculée
 *   par les conditions de la grille, modèle d'affichage, PDF (fiche complète et liste de préparation) ;
 * - js/views/attendus.js : rendu de l'écran par type et par feuille, recherche, carte d'un critère. */
import { test, assert, eq, deepEq } from './harness.js';
import { GRID_CT_2026 } from '../../js/domain/grid-ct-2026.js';
import { allItems, flatSections, sheetOf } from '../../js/domain/grids.js';
import { toWinAnsi } from '../../js/formats/pdf.js';
import {
  loadAttendus, attenduFor, attendusModel, typeVisibility, buildAttendusPdf, attendusFilename, SCALE, TOUR_TYPES
} from '../../js/app/attendus-pdf.js';

const data = await loadAttendus({ force: true });
const items = allItems(GRID_CT_2026);
const conformity = items.filter(it => it.kind === 'conformity');
const sectionOf = new Map(flatSections(GRID_CT_2026).flatMap(s => (s.items || []).map(it => [it.id, s])));
const filled = v => typeof v === 'string' && v.trim().length > 0;

/** Références normatives que le document peut citer (existence et intitulé vérifiés) — aucune autre. */
const KNOWN_REFS = ['NF EN ISO 5667-1', 'NF EN ISO 5667-3', 'NF EN ISO 5667-6', 'NF EN ISO 5667-11', 'NF EN ISO 5667-14',
  'FD T90-523-1', 'FD T90-523-3', 'NF EN ISO 10523', 'NF EN 27888', 'NF EN ISO 5814', 'NF EN ISO 7027-1', 'NF EN 13946', 'NF EN ISO/IEC 17025'];

/** Tous les textes rédigés du document (hors libellés recopiés de la grille), avec leur chemin. */
function writtenTexts() {
  const out = [['avertissement', data.avertissement], ['titre', data.titre]];
  for (const [k, v] of Object.entries(data.echelle || {})) out.push([`echelle.${k}`, v]);
  for (const [k, groups] of Object.entries(data.preparation || {})) {
    for (const g of groups) { out.push([`preparation.${k}.titre`, g.titre]); (g.elements || []).forEach((e, i) => out.push([`preparation.${k}.${g.titre}[${i}]`, e])); }
  }
  for (const [no, f] of Object.entries(data.feuilles || {})) {
    out.push([`feuilles.${no}.intro`, f.intro]);
    (f.documents || []).forEach((d, i) => out.push([`feuilles.${no}.documents[${i}]`, d]));
  }
  for (const [id, e] of Object.entries(data.criteres || {})) {
    for (const k of ['attendu', 'verification', 'C', 'P', 'NC', 'NA', 'aPreciser']) if (e[k]) out.push([`${id}.${k}`, e[k]]);
  }
  return out.filter(([, v]) => typeof v === 'string');
}

/* ---------- Fichier JSON ---------- */
test('attendus : en-tête, échelle C / P / NC / N/A et liste de préparation', () => {
  eq(data.grid, GRID_CT_2026.id, 'grille de référence');
  assert(/^\d+\.\d+$/.test(data.version), 'version « x.y »');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.updated), 'date de mise à jour AAAA-MM-JJ');
  assert(filled(data.avertissement), 'avertissement');
  for (const s of SCALE) assert(filled(data.echelle?.[s.code]), `définition de ${s.short}`);
  deepEq(Object.keys(data.preparation).sort(), ['bio', 'ce', 'commun', 'eso'], 'parties de la liste de préparation');
  for (const [k, groups] of Object.entries(data.preparation)) {
    assert(groups.length > 0, `préparation « ${k} » vide`);
    for (const g of groups) {
      assert(filled(g.titre), `préparation « ${k} » : groupe sans titre`);
      assert(g.elements.length > 0 && g.elements.every(filled), `préparation « ${k} › ${g.titre} » : éléments`);
    }
  }
  const commun = data.preparation.commun.map(g => g.titre).join(' | ');
  for (const w of ['Documents', 'Personnel', 'EPI', 'Sondes', 'Flaconnage', 'Glacières', 'Traçabilité']) assert(commun.includes(w), `groupe commun « ${w} » : ${commun}`);
});

test('attendus : une entrée par critère de la grille, aucune clé orpheline', () => {
  eq(items.length, 213, 'nombre de critères de GRID_CT_2026');
  const ids = new Set(items.map(i => i.id));
  const missing = items.filter(i => !data.criteres[i.id]).map(i => i.id);
  const orphans = Object.keys(data.criteres).filter(k => !ids.has(k));
  deepEq(missing, [], 'critères sans attendu');
  deepEq(orphans, [], 'clés absentes de la grille');
});

test('attendus : critères de conformité complets (attendu, vérification, C, P, NC), valeurs seules renseignées', () => {
  const bad = [];
  for (const it of conformity) {
    const e = data.criteres[it.id];
    for (const k of ['attendu', 'verification', 'C', 'P', 'NC']) if (!filled(e[k])) bad.push(`${it.id}.${k}`);
    if ('NA' in e && !filled(e.NA)) bad.push(`${it.id}.NA vide`);
    if (!Array.isArray(e.refs)) bad.push(`${it.id}.refs`);
    if (e.valeur) bad.push(`${it.id} marqué valeur seule`);
  }
  for (const it of items.filter(i => i.kind !== 'conformity')) {
    const e = data.criteres[it.id];
    if (!e.valeur) bad.push(`${it.id} : valeur seule non marquée`);
    if (!/^Information à relever\s*:\s*\S/.test(e.attendu || '')) bad.push(`${it.id} : « Information à relever : … » attendu`);
  }
  deepEq(bad, [], 'entrées incomplètes');
  eq(conformity.length, 188, 'critères cotés');
});

test('attendus : feuille, n°, libellé, section, portée et types identiques à la grille', () => {
  const vis = typeVisibility(GRID_CT_2026);
  const diffs = [];
  for (const it of items) {
    const e = data.criteres[it.id], sheet = sheetOf(GRID_CT_2026, it.sheet);
    const expect = {
      feuille: it.sheet, no: String(it.no), libelle: it.label, section: sectionOf.get(it.id)?.title,
      tournee: sheet.scope === 'tournee' || it.scope === 'tournee', types: vis.typesOf.get(it.id) || []
    };
    const got = { feuille: e.feuille, no: String(e.no), libelle: e.libelle, section: e.section, tournee: !!e.tournee, types: e.types };
    if (JSON.stringify(got) !== JSON.stringify(expect)) diffs.push(`${it.id} : ${JSON.stringify(got)} ≠ ${JSON.stringify(expect)}`);
  }
  deepEq(diffs.slice(0, 5), [], `${diffs.length} différence(s) avec la grille`);
});

test('attendus : feuilles 1 à 10 (titre, onglet, thème, portée, types, introduction, documents)', () => {
  const vis = typeVisibility(GRID_CT_2026);
  deepEq(Object.keys(data.feuilles).map(Number).sort((a, b) => a - b), GRID_CT_2026.sheets.map(s => s.no).sort((a, b) => a - b), 'feuilles');
  for (const s of GRID_CT_2026.sheets) {
    const f = data.feuilles[s.no];
    eq(f.titre, s.title, `F${s.no} titre`);
    eq(f.onglet, s.tab, `F${s.no} onglet`);
    eq(f.theme, s.theme, `F${s.no} thème`);
    eq(f.portee, s.scope, `F${s.no} portée`);
    deepEq(f.types, TOUR_TYPES.filter(t => vis.types[t].sheets.some(x => x.no === s.no)), `F${s.no} types`);
    for (const [t, title] of Object.entries(f.titres || {})) eq(title, s.variants?.[t]?.title, `F${s.no} titre ${t}`);
    assert(filled(f.intro), `F${s.no} introduction`);
    assert(Array.isArray(f.documents) && f.documents.length > 0 && f.documents.every(filled), `F${s.no} documents`);
  }
});

test('attendus : critères communs à la tournée signalés comme jugés une seule fois', () => {
  const bad = conformity.filter(it => it.scope === 'tournee' && sheetOf(GRID_CT_2026, it.sheet).scope !== 'tournee')
    .filter(it => !/Commun à la tournée/.test(`${data.criteres[it.id].attendu} ${data.criteres[it.id].verification}`)).map(i => i.id);
  deepEq(bad, [], 'critères partagés sans la mention « Commun à la tournée »');
});

test('attendus : références normatives connues uniquement, autres références = documents du marché', () => {
  const refs = Object.keys(data.references || {});
  deepEq(refs.filter(r => !KNOWN_REFS.includes(r)), [], 'références hors de la liste vérifiée');
  const bad = [];
  for (const [id, e] of Object.entries(data.criteres)) {
    for (const r of e.refs || []) {
      if (/^(NF|FD|XP|ISO|EN)\b/.test(r)) { if (!refs.includes(r)) bad.push(`${id} : ${r} absente de « references »`); }
      else if (!/CCTP|[Pp]rotocole|[Cc]onsignes|[Ll]ettre de mission/.test(r)) bad.push(`${id} : ${r}`);
    }
  }
  deepEq(bad, [], 'références inattendues');
  // Aucun article de CCTP inventé
  const art = writtenTexts().filter(([, v]) => /\b(art\.|article)\s*\d/i.test(v)).map(([k]) => k);
  deepEq(art, [], 'article de CCTP cité');
});

/** Valeurs chiffrées déjà présentes dans la grille, AVEC leur unité (un nombre seul n'est jamais admis) : seuils de
 * GRID_CT_2026.settings (GPS « 300 m », calibration « 30 jours », transport « 24 h »), bornes des alertes de
 * température (« 2–8 °C ») et consigne de conservation de leurs messages (« 5 ± 3 °C »), année du contrôle. */
function gridValuePatterns(grid) {
  const S = grid.settings || {};
  const p = [/\b2026\b/g];
  if (S.gpsThresholdM) p.push(new RegExp(`\\b${S.gpsThresholdM}\\s*m\\b`, 'g'));
  if (S.calibrationMaxDays) p.push(new RegExp(`\\b${S.calibrationMaxDays}\\s*jours\\b`, 'g'));
  if (S.transportMaxHours) p.push(new RegExp(`\\b${S.transportMaxHours}\\s*(?:h|heures)\\b`, 'g'));
  for (const it of allItems(grid)) {
    for (const a of it.alerts || []) {
      if (a.op === 'outside' && Array.isArray(a.value)) p.push(new RegExp(`\\b${a.value[0]}\\s*(?:–|-|et|à)\\s*${a.value[1]}\\s*°C`, 'g'));
      for (const m of `${a.message || ''} ${a.requirement || ''}`.matchAll(/(\d+)\s*±\s*(\d+)\s*°C/g)) p.push(new RegExp(`\\b${m[1]}\\s*±\\s*${m[2]}\\s*°C`, 'g'));
    }
  }
  return p;
}

test('attendus : aucun nombre « contractuel » inventé (heuristique)', () => {
  // Retirés avant l'analyse : références normatives (NF EN ISO 5667-3…), codes de critères (F4.12, F2.2.1 à F2.2.7),
  // « feuille 4 », « 4x4 », « (valeur 0) » (saisie d'un décompte nul) et les valeurs de la grille avec leur unité.
  // Tout autre chiffre (nombre de prélèvements, délai, volume, fréquence…) est signalé : il doit être remplacé par
  // « conformément au protocole / CCTP du marché » et une mention « aPreciser ».
  const patterns = gridValuePatterns(GRID_CT_2026);
  const refs = [...Object.keys(data.references || {})].sort((a, b) => b.length - a.length);
  const stray = [];
  for (const [path, text] of writtenTexts()) {
    let t = text;
    for (const r of refs) t = t.split(r).join(' ');
    for (const re of patterns) t = t.replace(re, ' ');
    t = t.replace(/\bF\d+(?:\.[0-9A-Z]+)*/g, ' ').replace(/\bfeuilles?\s+\d+/gi, ' ').replace(/\b4x4\b/gi, ' ').replace(/\(valeur 0\)/g, ' ');
    for (const n of t.match(/\d+(?:[.,]\d+)?/g) || []) stray.push(`${path} : « ${n} » dans « ${text.slice(0, 90)}… »`);
  }
  // Contrôle du contrôle : l'heuristique détecte bien une valeur inventée.
  const probe = 'Au moins 8 prélèvements Surber, transport en 48 h, 3 réplicats ; conservation à 5 ± 3 °C ; écart de 300 m.';
  let pt = probe;
  for (const re of patterns) pt = pt.replace(re, ' ');
  deepEq(pt.match(/\d+/g), ['8', '48', '3'], 'heuristique : valeurs inventées détectées, valeurs de la grille admises');
  deepEq(stray, [], 'nombres à confirmer (renseigner « aPreciser » plutôt qu’une valeur)');
  // Les exigences chiffrées propres au marché sont renvoyées à l'OEG.
  for (const id of ['it-F6-5', 'it-F4-2']) assert(filled(data.criteres[id].aPreciser), `${id} : « à préciser » attendu`);
});

/** Unité de turbidité écartée (seule NTU est admise), écrite en deux morceaux pour ne pas figurer en clair. */
const OTHER_UNIT = 'F' + 'NU';
test('attendus : turbidité exprimée en NTU uniquement', () => {
  const re = new RegExp(`\\b${OTHER_UNIT}\\b`, 'i');
  const other = writtenTexts().filter(([, v]) => re.test(v)).map(([k]) => k);
  deepEq(other, [], 'autre unité que NTU');
  assert(JSON.stringify(data).includes('NTU'), 'unité NTU citée pour la turbidité');
  assert(!new RegExp(OTHER_UNIT, 'i').test(JSON.stringify(data)), 'aucune autre unité de turbidité dans le fichier');
});

/* ---------- Module js/app/attendus-pdf.js ---------- */
test('attenduFor : identifiant de base ou effectif de tournée', () => {
  eq(attenduFor('it-F4-12', data).id, 'it-F4-12');
  eq(attenduFor('it-F4-12@09271503', data).libelle, 'Flaconnage conforme');
  eq(attenduFor('it-F4-12@09271503', data).attendu, data.criteres['it-F4-12'].attendu);
  eq(attenduFor('it-F99-1', data), null, 'critère inconnu');
  eq(attenduFor('', data), null, 'identifiant vide');
  eq(attenduFor('it-F4-12', null), null, 'attendus non chargés');
});

test('visibilité par type de tournée (conditions de la grille, station fictive)', () => {
  const vis = typeVisibility(GRID_CT_2026);
  deepEq(vis.types.bio.sheets.map(s => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'feuilles biologie');
  deepEq(vis.types.ce.sheets.map(s => s.no), [1, 2, 3, 4, 5], 'feuilles cours d’eau');
  deepEq(vis.types.eso.sheets.map(s => s.no), [1, 2, 3, 10, 4, 5], 'feuilles eaux souterraines');
  eq(vis.typesOf.size, items.length, 'chaque critère est visible pour au moins un type');
  assert(!vis.types.eso.items.has('it-F1-R6'), 'niveau d’eau masqué en eaux souterraines');
  assert(vis.types.ce.items.has('it-F1-R6'), 'niveau d’eau des cours d’eau');
  assert([...vis.types.eso.items].some(id => id.startsWith('it-F10-')) && ![...vis.types.ce.items].some(id => id.startsWith('it-F10-')), 'F10 réservée aux eaux souterraines');
});

test('attendusModel : feuilles, sections, critères et décomptes par type', () => {
  const all = attendusModel(data);
  eq(all.type, null);
  eq(all.sheets.reduce((n, s) => n + s.items.length, 0), items.length, 'tous types : tous les critères');
  eq(all.count, conformity.length, 'tous types : points cotés');
  deepEq(all.preparation.map(p => p.key), ['commun', 'bio', 'ce', 'eso']);
  const vis = typeVisibility(GRID_CT_2026);
  for (const t of TOUR_TYPES) {
    const m = attendusModel(data, { auditType: t });
    eq(m.type, t);
    deepEq(m.preparation.map(p => p.key), ['commun', t], `${t} : préparation`);
    const ids = m.sheets.flatMap(s => s.items.map(i => i.id));
    eq(ids.length, vis.types[t].items.size, `${t} : critères affichés`);
    assert(ids.every(id => data.criteres[id]), `${t} : chaque critère a son attendu`);
    assert(m.sheets.every(s => s.items.every(i => i.entry === data.criteres[i.id])), `${t} : entrées rattachées`);
  }
  const f4 = attendusModel(data, { auditType: 'eso' }).sheets.find(s => s.no === 4);
  eq(f4.title, GRID_CT_2026.sheets.find(s => s.no === 4).variants.eso.title, 'titre propre au type');
  assert(f4.items.find(i => i.id === 'it-F4-2').shared, 'F4.2 commun à la tournée');
  eq(attendusModel(data, { auditType: 'inconnu' }).type, null, 'type inconnu : tous les types');
});

/* ---------- PDF ---------- */
const latin1 = bytes => new TextDecoder('windows-1252').decode(bytes);
const hexOf = s => toWinAnsi(s).map(b => b.toString(16).padStart(2, '0')).join('');

test('PDF : fiche des attendus (eaux souterraines) et liste de préparation', async () => {
  const r = await buildAttendusPdf(data, { auditType: 'eso', compress: false });
  const t = latin1(r.bytes);
  assert(t.startsWith('%PDF'), 'en-tête %PDF');
  assert(t.trimEnd().endsWith('%%EOF'), 'fin %%EOF');
  assert(r.pages > 5, `pages : ${r.pages}`);
  eq(r.filename, 'Attendus_prestataires_eaux-souterraines.pdf');
  eq((t.match(/\/Type \/Page\b/g) || []).length, r.pages, 'objets page');
  for (const s of ['Attendus des prestataires', 'Flaconnage conforme', 'Eaux souterraines', `Page 1 / ${r.pages}`, `Page ${r.pages} / ${r.pages}`]) assert(t.includes(hexOf(s)), `texte : ${s}`);
  assert(!t.includes(hexOf('Nombre de prélèvements Surber')), 'pas de critère de biologie dans la fiche eaux souterraines');
  assert(!t.includes(hexOf(OTHER_UNIT)), 'turbidité en NTU uniquement');

  const p = await buildAttendusPdf(data, { auditType: 'bio', preparationOnly: true });
  assert(latin1(p.bytes.subarray(0, 5)) === '%PDF-', 'liste de préparation : %PDF');
  assert(p.pages >= 1 && p.pages < r.pages, `liste de préparation : ${p.pages} page(s)`);
  eq(p.filename, 'Preparation_tournee_biologie.pdf');
  eq(attendusFilename({}), 'Attendus_prestataires_tous.pdf');
  eq(attendusFilename({ auditType: 'ce', preparationOnly: true }), 'Preparation_tournee_cours-eau.pdf');
});

/* ---------- Écran js/views/attendus.js ---------- */
test('écran : rendu par type et par feuille, recherche, carte d’un critère', async () => {
  const mod = await import('../../js/views/attendus.js');
  const view = mod.default;
  eq(view.nav, 'attendus');
  const box = document.createElement('div');
  box.style.display = 'none';
  document.body.appendChild(box);
  try {
    const vis = typeVisibility(GRID_CT_2026);
    box.innerHTML = String(await view.render({}, { type: 'eso' }));
    const shown = [...box.querySelectorAll('[data-id]')].map(el => el.dataset.id);
    eq(shown.length, vis.types.eso.items.size, 'eaux souterraines : critères affichés');
    eq(box.querySelectorAll('.att-crit').length, [...vis.types.eso.items].filter(id => !data.criteres[id].valeur).length, 'points cotés');
    assert(box.querySelector('#att-F10') && !box.querySelector('#att-F6'), 'F10 affichée, F6 absente');
    assert(box.querySelector('[data-act=att-pdf][data-type=eso]') && box.querySelector('[data-act=att-prep-pdf]'), 'boutons PDF');
    assert(box.querySelector('#att-it-F4-2 .shared-badge'), 'badge « Commun à la tournée »');
    assert(box.querySelector('#att-it-F6-5') === null, 'critère de biologie absent');

    let r = mod.applyFilter(box, 'glacière');
    assert(r.crit > 0, 'recherche « glacière » : résultats');
    const visible = [...box.querySelectorAll('.att-crit:not(.hide)')];
    assert(visible.every(el => el.dataset.q.includes('glaciere')), 'résultats contenant le mot (sans accent)');
    assert(box.querySelector('#attEmpty').classList.contains('hide'), 'pas de message « aucun résultat »');
    r = mod.applyFilter(box, 'zzzz introuvable');
    eq(r.crit + r.values, 0, 'aucun résultat');
    assert(!box.querySelector('#attEmpty').classList.contains('hide'), 'message « aucun résultat »');
    r = mod.applyFilter(box, 'F4.12');
    eq(r.crit, 1, 'recherche par code de critère');
    r = mod.applyFilter(box, '');
    eq(r.crit, box.querySelectorAll('.att-crit').length, 'recherche effacée');

    box.innerHTML = String(await view.render({}, { type: 'bio', feuille: '6' }));
    deepEq([...box.querySelectorAll('.att-sheet')].map(s => s.dataset.sheet), ['6'], 'filtre par feuille');
    box.innerHTML = String(await view.render({}, { type: 'bio', feuille: '10' }));
    eq(box.querySelectorAll('.att-sheet').length, 9, 'feuille non affichée pour le type : filtre ignoré');
    box.innerHTML = String(await view.render({}, {}));
    eq(box.querySelectorAll('[data-id]').length, items.length, 'tous types : 213 critères');

    eq(mod.attenduFor('it-F5-13@09271503').id, 'it-F5-13', 'attenduFor de l’écran (id effectif)');
    const card = String(mod.attenduCard('it-F4-12@09271503'));
    assert(card.includes('att-crit') && card.includes('Flaconnage conforme') && card.includes('th-peach'), 'carte aux couleurs de la feuille 4');
    assert(String(mod.attenduCard('it-F1-R1')).includes('att-val'), 'carte d’une information relevée');
    eq(String(mod.attenduCard('it-F99-9')), '', 'critère inconnu');
    assert(mod.matches(mod.searchText({ code: 'F5.13', label: 'Température', entry: { attendu: 'Échantillons conservés' } }), 'echantillons temperature'), 'recherche sans accents');
  } finally {
    box.remove();
  }
});
