/* Tests unitaires des PDF (navigateur, sans base de données) : générateur js/formats/pdf.js (encodage WinAnsi et
 * substitutions, tracés SVG, polices TrueType incorporées, images RGBA avec masque, pages de formats différents,
 * structure du fichier : table xref, flux compressés), carte statique (js/app/static-map.js : projection, échelle,
 * tuiles simulées) et fiches de contrôle (js/app/sheets-pdf.js) : fiches vierges de la station ATHANASE (F1 portrait,
 * autres feuilles paysage, valeurs du référentiel seulement), fiche station seule, noms de fichiers. */
import { test, assert, eq, deepEq } from './harness.js';
import { PDFDocument, A4, A4_LANDSCAPE, toWinAnsi, pdfSafeText, parseSvgPath, parseTrueType, deflate } from '../../js/formats/pdf.js';
import { lonToPx, latToPx, metersPerPixel, fitZoom, scaleBar, tileURL, staticMap } from '../../js/app/static-map.js';
import { blankSheetsModel, buildSheetsPdf, fileToken, FONT_FILES } from '../../js/app/sheets-pdf.js';
import { GRID_CT_2026 } from '../../js/domain/grid-ct-2026.js';

const ATHANASE = {
  id: 'site-09271503', code: '09271503', codeType: 'SANDRE', name: 'Athanase', bassin: 'Approuague', riverName: 'Approuague', commune: '', her: 52, strahler: '',
  pressions: 'Orpaillage illégal', x: 356714, y: 465112, matrixId: 'mat-ESU', types: ['bio', 'ce'],
  compartments: ['organisation', 'physico', 'invertebres', 'diatomees', 'poissons', 'phytoplancton'],
  access: { summary: 'Environ 2 h depuis Cayenne et 1 h 30 depuis Régina.', details: 'Depuis le dégrad public de Régina, remonter l’Approuague.', modes: ['Bateau motorisé / pirogue'] },
  difficulties: 'Roches, Saut Tourépé.', photos: {}, samplingPoints: []
};
const MARIPA = { id: 'site-BSS002PANK', code: 'BSS002PANK', codeType: 'BSS', name: 'AEP Maripasoula', commune: 'Maripasoula', x: 163100, y: 402750, matrixId: 'mat-ESO', types: ['eso'], compartments: ['organisation', 'eso'], nature: 'Forage', usage: 'Alimentation en eau potable', aquifere: 'Socle' };

const latin1 = bytes => new TextDecoder('windows-1252').decode(bytes);
const hexOf = s => toWinAnsi(s).map(b => b.toString(16).padStart(2, '0')).join('');
/** Vérifie la structure : en-tête, %%EOF, startxref → table xref, chaque entrée pointe sur « n 0 obj ». */
function checkStructure(bytes) {
  const t = latin1(bytes);
  assert(t.startsWith('%PDF-1.4'), 'en-tête %PDF-1.4');
  assert(t.trimEnd().endsWith('%%EOF'), 'fin %%EOF');
  const sx = t.lastIndexOf('startxref');
  const off = parseInt(t.slice(sx + 9).trim(), 10);
  assert(t.startsWith('xref', off), 'startxref pointe sur la table xref');
  const head = t.slice(off).split('\n');
  const count = Number(head[1].split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const o = parseInt(head[2 + i].slice(0, 10), 10);
    assert(t.startsWith(`${i} 0 obj`, o), `objet ${i} à l’octet ${o}`);
  }
  assert(/trailer\n<< \/Size \d+ \/Root \d+ 0 R/.test(t), 'trailer');
  return { text: t, objects: count - 1 };
}
const mediaBoxes = t => [...t.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function fontBytes(file) { const r = await fetch(new URL('../../fonts/pdf/' + file, import.meta.url)); return new Uint8Array(await r.arrayBuffer()); }

/* ---------- js/formats/pdf.js ---------- */
test('pdf.js : encodage WinAnsi et substitution des caractères hors WinAnsi', () => {
  deepEq(toWinAnsi('A’é€'), [0x41, 0x92, 0xE9, 0x80], 'apostrophe typographique, accent, euro');
  eq(pdfSafeText('O₂ ≈ 5 mg/L'), 'O2 ~ 5 mg/L');
  eq(pdfSafeText('pH ≤ 8 et ≥ 6 → OK'), 'pH <= 8 et >= 6 -> OK');
  eq(pdfSafeText('µS/cm · 25 °C'), 'µS/cm · 25 °C', 'caractères Latin-1 conservés');
  eq(pdfSafeText('1\u202F000'), '1\u00A0000', 'espace fine insécable → insécable');
  eq(pdfSafeText('a\u200Bb'), 'ab', 'espace de largeur nulle supprimée');
  eq(pdfSafeText('😀'), '?', 'émoji irreprésentable');
});

test('pdf.js : tracés SVG (commandes relatives, H/V, arcs convertis en Bézier)', () => {
  const segs = parseSvgPath('M10 10h5v5H10z');
  deepEq(segs, [['M', 10, 10], ['L', 15, 10], ['L', 15, 15], ['L', 10, 15], ['Z']]);
  const arc = parseSvgPath('M0 0a10 10 0 1 0 20 0');
  assert(arc.length >= 3 && arc.slice(1).every(s => s[0] === 'C'), 'arc → courbes cubiques');
  const last = arc[arc.length - 1];
  assert(Math.abs(last[5] - 20) < 1e-9 && Math.abs(last[6]) < 1e-9, 'l’arc se termine au point demandé');
  const q = parseSvgPath('M0 0Q10 10 20 0');
  eq(q[1][0], 'C', 'quadratique → cubique');
  const implicit = parseSvgPath('M0 0 10 0 10 10');
  deepEq(implicit.map(s => s[0]), ['M', 'L', 'L'], 'coordonnées implicites après M = lignes');
});

test('pdf.js : lecture d’une police TrueType (Barlow) — nom, métriques, chasses WinAnsi', async () => {
  const f = parseTrueType(await fontBytes('Barlow-Regular.ttf'));
  eq(f.psName, 'Barlow-Regular');
  eq(f.upm, 1000);
  assert(f.widths.length === 256 && f.widths[65] > 400 && f.widths[65] < 800, 'chasse du « A »');
  assert(f.widths[0x92] > 0 && f.widths[0xE9] > 0 && f.widths[0x80] > 0, 'apostrophe, é et € présents');
  deepEq(f.missing.filter(c => c !== 0xAD && c !== 0x81 && c !== 0x8D && c !== 0x8F && c !== 0x90 && c !== 0x9D), [], 'jeu WinAnsi complet');
  assert(!f.italic, 'romain');
  assert(parseTrueType(await fontBytes('Barlow-Italic.ttf')).italic, 'italique détectée');
});

test('pdf.js : rétrocompatibilité (flux Helvetica, tableau, filigrane) et structure valide', () => {
  const doc = new PDFDocument({ title: 'Essai' });
  doc.heading('Titre');
  doc.paragraph('Paragraphe avec apostrophe ’ et O₂.');
  doc.table({ columns: [{ label: 'A', width: 100 }, { label: 'B', width: 100 }], rows: Array.from({ length: 80 }, (_, i) => [String(i), 'ligne ' + i]) });
  doc.watermark = { text: 'RAPPORT PROVISOIRE' };
  doc.footerFn = (d, p, n) => d.text(`Page ${p} / ${n}`, 40, d.H - 30);
  const bytes = doc.output();
  const { text } = checkStructure(bytes);
  assert(doc.pages.length >= 2, 'saut de page automatique');
  assert(text.includes('/BaseFont /Helvetica') && !text.includes('/FontFile2'), 'polices standard sans incorporation');
  assert(text.includes(`<${hexOf('Page 1 / ' + doc.pages.length)}>`), 'pied de page numéroté');
  assert(text.includes('1 Tr'), 'filigrane en contour');
});

test('pdf.js : polices incorporées (FontFile2, /Widths, FontDescriptor), pages portrait et paysage, flux compressés', async () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  // Police introuvable simulée (réponse 404 sans requête réseau).
  const fetchFn = u => (String(u).includes('absente') ? Promise.resolve(new Response('', { status: 404 })) : fetch(u));
  const res = await doc.loadFonts({ barlow: { url: new URL('../../fonts/pdf/Barlow-Regular.ttf', import.meta.url).href, fallback: 'regular' }, absente: { url: 'absente.ttf', fallback: 'bold' } }, { fetchFn });
  deepEq(res.loaded, ['barlow']); deepEq(res.failed, ['absente']);
  eq(doc.fontOf('absente').base, 'Helvetica-Bold', 'repli sur la police de secours');
  doc.newPage({ size: A4 });
  doc.text('Contrôle terrain – O₂', 40, 40, { font: 'barlow', size: 12 });
  doc.newPage({ landscape: true });
  doc.roundRect(20, 20, 200, 80, 8, { fill: '#e6f6fd', stroke: '#0b6cb4' });
  doc.circle(100, 200, 20, { fill: '#0b6cb4', opacity: 0.5 });
  doc.svgPath('M0 0a10 10 0 1 0 20 0Z', { x: 300, y: 200, scale: 2, fill: '#c62828' });
  doc.text('Paysage', 40, 40, { font: 'absente', size: 10 });
  const plain = doc.output();
  const t = checkStructure(plain).text;
  deepEq(mediaBoxes(t), [[595.28, 841.89], [841.89, 595.28]], 'portrait puis paysage');
  assert(/\/Subtype \/TrueType \/BaseFont \/Barlow-Regular \/FirstChar 32 \/LastChar 255 \/Widths \[/.test(t), 'police TrueType déclarée avec ses chasses');
  assert(t.includes('/FontFile2') && t.includes('/Type /FontDescriptor') && t.includes('/Length1 '), 'police incorporée');
  assert(t.includes('/ExtGState') && t.includes('/ca 0.5'), 'opacité');
  assert(t.includes(`<${hexOf('Contrôle terrain – O2')}>`), 'texte encodé WinAnsi (indice substitué)');
  // Même document, flux compressés.
  const doc2 = new PDFDocument({ autoFirstPage: false });
  await doc2.loadFonts({ barlow: new URL('../../fonts/pdf/Barlow-Regular.ttf', import.meta.url).href });
  doc2.newPage(); doc2.text('Compressé', 40, 40, { font: 'barlow' });
  for (let i = 0; i < 40; i++) doc2.rect(10 + i, 100, 5, 5, { fill: '#0d3577' });
  const packed = await doc2.outputAsync();
  const t2 = checkStructure(packed).text;
  assert(/\/Length \d+ \/Filter \/FlateDecode >>\nstream/.test(t2), 'flux de contenu FlateDecode');
  assert(/\/Length1 \d+ \/Filter \/FlateDecode/.test(t2), 'fichier de police compressé');
  let found = false;
  for (const m of t2.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    const content = latin1(await inflate(packed.slice(start, start + Number(m[1]))));
    if (content.includes(`<${hexOf('Compressé')}> Tj`)) found = true;
  }
  assert(found, 'contenu décompressé lisible');
});

test('pdf.js : image RGBA avec transparence (SMask) et mesure / coupure du texte', async () => {
  const doc = new PDFDocument();
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([11, 108, 180, i < 8 ? 255 : 0], i * 4);
  const img = await doc.addRGBA({ width: 4, height: 4, data });
  assert(img.smask, 'masque de transparence créé');
  doc.drawImage(img, 10, 10, 40, 40);
  const opaque = await doc.addRGBA({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) });
  assert(!opaque.smask, 'pas de masque pour une image opaque');
  const t = checkStructure(doc.output()).text;
  assert(/\/SMask \d+ 0 R/.test(t) && t.includes('/ColorSpace /DeviceGray'), 'SMask en niveaux de gris');
  if (await deflate(new Uint8Array([1, 2, 3]))) assert(/\/Subtype \/Image \/Width 4 \/Height 4 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode/.test(t), 'image compressée');
  const lines = doc.wrap('Le préleveur a rincé le matériel trois fois avant le prélèvement', 'regular', 10, 120);
  assert(lines.length >= 3 && lines.every(l => doc.width(l, 'regular', 10) <= 120), 'retour à la ligne dans la largeur');
  eq(doc.clampLines(['a', 'b', 'c'], 2, 'regular', 10, 100)[1], 'b …', 'troncature avec points de suspension');
});

/* ---------- js/app/static-map.js ---------- */
test('static-map : projection Web Mercator, zoom ajusté, échelle graphique, adresse des tuiles', () => {
  eq(Math.round(lonToPx(0, 0)), 128); eq(Math.round(latToPx(0, 0)), 128);
  const c = [4.2, -52.3];
  eq(fitZoom(c, [], 600, 450), 12, 'zoom par défaut sans point');
  assert(fitZoom(c, [[4.5, -52.0]], 600, 450) < 12, 'zoom réduit pour inclure un point éloigné');
  const sb = scaleBar(metersPerPixel(4.2, 12), 120);
  assert([1000, 2000, 5000, 500, 200].includes(sb.meters) && sb.pixels <= 120 && /km|m/.test(sb.label), 'échelle « ronde »');
  eq(tileURL('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 12, 1450, 2000), 'https://tile.openstreetmap.org/12/1450/2000.png');
});

test('static-map : composition des tuiles (simulées) et repli « schéma » après une seule tuile d’essai', async () => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#9fd3a0'; g.fillRect(0, 0, 256, 256);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  let calls = 0;
  const ok = await staticMap({ center: [4.2, -52.3], width: 300, height: 200, useCache: false, template: 'https://tuiles.invalid/{z}/{x}/{y}.png', fetchTile: async () => { calls++; return new Response(png, { status: 200 }); } });
  eq(ok.kind, 'tiles');
  assert(ok.jpeg[0] === 0xFF && ok.jpeg[1] === 0xD8, 'image JPEG');
  eq(ok.tiles.loaded, ok.tiles.total);
  const [px, py] = ok.project(4.2, -52.3);
  assert(Math.abs(px - 150) < 1 && Math.abs(py - 100) < 1, 'la station est au centre de l’image');
  calls = 0;
  const ko = await staticMap({ center: [4.2, -52.3], width: 300, height: 200, useCache: false, template: 'https://tuiles.invalid/{z}/{x}/{y}.png', fetchTile: async () => { calls++; throw new Error('réseau'); } });
  eq(ko.kind, 'schema'); eq(calls, 1, 'une seule requête perdue');
  eq((await staticMap({ center: null })).reason, 'coords');
});

/* ---------- js/app/sheets-pdf.js ---------- */
test('fiches vierges ATHANASE (biologie) : modèle — 9 feuilles, référentiel seul, aucune saisie', () => {
  const m = blankSheetsModel({ grid: GRID_CT_2026, sites: [ATHANASE], auditType: 'bio' });
  eq(m.mode, 'blank'); eq(m.auditType, 'bio');
  deepEq(m.instances.map(s => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  deepEq(m.instances.map(s => s.index), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'Feuille X / 9');
  eq(m.instances[1].station, null, 'F2 = feuille tournée');
  eq(m.responses['it-F3-3@09271503']?.value, 'ATHANASE', 'nom de la station pré-rempli');
  eq(m.responses['it-F3-4@09271503']?.value, '09271503', 'code SANDRE pré-rempli');
  assert(Object.values(m.responses).every(r => r.prefilled && !r.status && !r.comment), 'valeurs du référentiel seulement, sans statut');
  assert(!m.responses['it-F1-R1@09271503'] && !m.responses['it-F2-1.4'], 'ni date ni contrôleur pré-remplis');
  eq(m.provisional, false);
});

test('fiches vierges ATHANASE : PDF valide, polices Barlow / Montserrat incorporées, F1 portrait puis paysage', async () => {
  const m = blankSheetsModel({ grid: GRID_CT_2026, sites: [ATHANASE], auditType: 'bio' });
  const { bytes, pages } = await buildSheetsPdf(m, { compress: false, mapNetwork: false });
  const { text } = checkStructure(bytes);
  assert(pages >= 9, `au moins une page par feuille (${pages})`);
  const boxes = mediaBoxes(text);
  eq(boxes.length, pages);
  const portrait = boxes.map(([w, h]) => h > w);
  eq(portrait.filter(Boolean).length, 1, 'une seule page portrait (F1)');
  assert(!portrait[0] && portrait.indexOf(true) > 0, 'F2 (tournée, paysage) d’abord, puis F1 de la station en portrait');
  for (const [file] of Object.values(FONT_FILES)) assert(text.includes('/BaseFont /' + file.replace('.ttf', '')), 'police incorporée : ' + file);
  assert((text.match(/\/FontFile2/g) || []).length === Object.keys(FONT_FILES).length, 'six fichiers de police');
  for (const s of ['ATHANASE', 'OFFICE DE L’EAU DE GUYANE', 'Fiche vierge', '09271503', 'Approuague', 'Repères terrain', 'Conclusion du contrôle']) assert(text.includes(`<${hexOf(s)}>`) || text.includes(hexOf(s)), 'texte présent : ' + s);
  assert(!text.includes(hexOf('PROVISOIRE')), 'pas de filigrane sur une fiche vierge');
  assert(/\/Subtype \/Image/.test(text) && /\/SMask/.test(text), 'logo et pictogrammes rastérisés (RGBA)');
});

test('fiche station seule (feuille 1) et variante eaux souterraines ; fiches vierges compressées', async () => {
  const one = await buildSheetsPdf(blankSheetsModel({ grid: GRID_CT_2026, sites: [ATHANASE], auditType: 'bio', mode: 'station' }), { only: sh => sh.layout === 'station', compress: false, mapNetwork: false });
  eq(one.pages, 1);
  const t1 = checkStructure(one.bytes).text;
  deepEq(mediaBoxes(t1), [[595.28, 841.89]], 'A4 portrait');
  assert(t1.includes(hexOf('Localisation cartographique')) && t1.includes(hexOf('Compartiments à contrôler')), 'cartes de la fiche station');
  const eso = blankSheetsModel({ grid: GRID_CT_2026, sites: [MARIPA], auditType: 'eso' });
  deepEq(eso.instances.map(s => s.no), [1, 2, 3, 10, 4, 5], 'tournée eaux souterraines : F10 avant F4 et F5');
  const pdf = await buildSheetsPdf(eso, { mapNetwork: false });
  const t2 = checkStructure(pdf.bytes).text;
  assert(/\/Filter \/FlateDecode/.test(t2), 'flux compressés');
  assert(pdf.pages >= 6, 'six feuilles au moins');
});

test('noms de fichiers des fiches', () => {
  eq(fileToken('Athanase'), 'ATHANASE');
  eq(fileToken('Crique à l’Est'), 'CRIQUE-A-L-EST');
  eq(fileToken('AEP Maripasoula'), 'AEP-MARIPASOULA');
  eq(fileToken(''), 'STATION');
});
