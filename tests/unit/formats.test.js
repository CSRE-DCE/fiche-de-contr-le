/* Tests unitaires des formats d'échange (modules purs, navigateur) : CSV (séparateur, guillemets, injection de
 * formules), iCalendar (lecture, récurrences, écriture), Excel (écriture puis relecture, dates Excel), PDF
 * (structure, table de références croisées exacte, encodage WinAnsi, image JPEG de tests/fixtures/photo.jpg).
 * Portage de tests/audit-unit.mjs (fiches-oeg) : Buffer (Node) remplacé par une lecture latin-1 des octets. */
import { test, assert, eq, deepEq, throwsAsync } from './harness.js';
import { parseCSV, toCSV, detectDelimiter, objectsToRows } from '../../js/formats/csv.js';
import { parseICS, parseICSDate, expandEvents, toICS } from '../../js/formats/ics.js';
import { writeXLSX, readXLSX, sheetToTable, excelSerialToISO, unzip, zipStore } from '../../js/formats/xlsx.js';
import { PDFDocument, toWinAnsi, pdfSafeText, jpegInfo, A4, A4_LANDSCAPE } from '../../js/formats/pdf.js';

/** Octets → chaîne « latin-1 » (un caractère par octet : les positions de la table xref restent exactes). */
function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}
/** Vérifie la structure d'un PDF : en-tête, fin de fichier, chaque entrée de la table xref pointe sur son objet. */
function checkPdfStructure(bytes) {
  const text = latin1(bytes);
  assert(text.startsWith('%PDF-1.4'), 'en-tête %PDF-1.4');
  assert(text.trimEnd().endsWith('%%EOF'), 'fin %%EOF');
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  eq(text.slice(startxref, startxref + 4), 'xref', 'startxref pointe sur la table');
  const offsets = text.slice(startxref).split('\n').slice(3).filter(l => / 00000 n /.test(l)).map(l => Number(l.slice(0, 10)));
  assert(offsets.length > 3, 'objets référencés');
  offsets.forEach((o, i) => assert(text.slice(o).startsWith(`${i + 1} 0 obj`), `objet ${i + 1} à l’octet ${o}`));
  const size = Number(text.match(/trailer\n<< \/Size (\d+)/)[1]);
  eq(size, offsets.length + 1, '/Size du trailer');
  return text;
}

/* ---------- CSV ---------- */
test('CSV : séparateur, guillemets, injection de formules', () => {
  eq(detectDelimiter('a;b;c\n1;2;3'), ';');
  const rows = parseCSV('﻿Réf;Lieu;Note\nP1;"Crique ""A""; amont";"ligne1\nligne2"\n');
  deepEq(rows[0], ['Réf', 'Lieu', 'Note'], 'BOM retiré');
  deepEq(rows[1], ['P1', 'Crique "A"; amont', 'ligne1\nligne2']);
  const out = toCSV([['a', 'b'], ['=SOMME(A1)', 3.5]]);
  assert(out.includes("'=SOMME(A1)"), 'formule neutralisée'); assert(out.includes('3,5'), 'décimale française');
});

test('CSV : autres séparateurs, fins de ligne Windows, lignes vides, aller-retour', () => {
  eq(detectDelimiter('a,b,c\n1,2,3'), ','); eq(detectDelimiter('a\tb\n1\t2'), '\t'); eq(detectDelimiter('"x;y",b,c'), ',', 'séparateur entre guillemets ignoré');
  eq(detectDelimiter('seul'), ';', 'séparateur par défaut');
  deepEq(parseCSV('a,b\r\n1,2\r\n\r\n,\r\n'), [['a', 'b'], ['1', '2']], 'lignes vides ignorées');
  deepEq(parseCSV('a;b', ','), [['a;b']], 'séparateur imposé');
  const table = [['Code', 'Libellé', 'Valeur'], ['F4.5', 'pH « in situ » ; sonde', -1.5], ['+33', 'l’"eau"\nclaire', null]];
  const text = toCSV(table);
  assert(text.startsWith('﻿') && text.endsWith('\r\n'), 'BOM UTF-8 et fin de ligne Windows');
  deepEq(parseCSV(text), [['Code', 'Libellé', 'Valeur'], ['F4.5', 'pH « in situ » ; sonde', '-1,5'], ["'+33", 'l’"eau"\nclaire', '']]);
  deepEq(objectsToRows([{ a: 1, b: { c: 'x' } }, { a: 2 }], [{ key: 'a', label: 'A' }, { get: o => o.b?.c, label: 'C' }]), [['A', 'C'], [1, 'x'], [2, '']]);
});

/* ---------- iCalendar ---------- */
test('iCalendar : lecture, récurrence, écriture', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Prélèvement Mahury\\, aval\r\nDTSTART:20261012T083000\r\nLOCATION:Mahury\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e2\r\nSUMMARY:Journée\r\nDTSTART;VALUE=DATE:20261020\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const ev = parseICS(ics);
  eq(ev[0].summary, 'Prélèvement Mahury, aval'); eq(ev[0].start.time, '08:30'); eq(ev[1].start.allDay, true);
  const occ = expandEvents(ev);
  deepEq(occ.filter(o => o.uid.startsWith('e1')).map(o => o.occurrence), ['2026-10-12', '2026-10-19', '2026-10-26']);
  const back = parseICS(toICS([{ uid: 'x', date: '2026-10-12', time: '08:30', summary: 'A; B, C' }]));
  eq(back[0].summary, 'A; B, C');
});

test('iCalendar : lignes repliées, dates UTC, journée entière, durée par défaut', () => {
  const long = 'Contrôle terrain de la prestation de prélèvement — station ATHANASE (Approuague), hydrobiologie';
  const text = toICS([{ uid: 'u1', date: '2026-10-12', time: '08:30', summary: long, description: 'ligne 1\nligne 2', location: 'Approuague' }, { uid: 'u2', date: '2026-10-20', summary: 'Journée' }], { name: 'Tournées OEG' });
  assert(text.split('\r\n').every(l => l.length <= 75), 'lignes repliées à 75 caractères');
  assert(text.includes('DTEND:20261012T103000'), 'durée par défaut : 2 h');
  assert(text.includes('DTSTART;VALUE=DATE:20261020'), 'journée entière');
  const ev = parseICS(text);
  eq(ev.length, 2); eq(ev[0].summary, long, 'repliement défait'); eq(ev[0].description, 'ligne 1\nligne 2'); eq(ev[0].location, 'Approuague');
  deepEq(parseICSDate('20261012'), { date: '2026-10-12', time: '', allDay: true });
  const utc = parseICSDate('20261012T120000Z');
  eq(utc.utc, true); eq(utc.allDay, false);
  const local = new Date(Date.UTC(2026, 9, 12, 12, 0));
  eq(utc.time, `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`, 'heure UTC convertie en heure locale');
  eq(parseICSDate('n’importe quoi'), null);
});

/* ---------- Excel ---------- */
test('Excel : écriture puis relecture', async () => {
  const bytes = writeXLSX([{ name: 'Prestations', rows: [['Réf', 'Date', 'Nb'], ['P-1', '12/10/2026', 3], ['P-2', 'Crique & <B>', 4.5]] }]);
  eq(bytes[0], 0x50); eq(bytes[1], 0x4B);
  const wb = await readXLSX(bytes.buffer);
  const t = sheetToTable(wb.sheets[0].rows);
  deepEq(t.headers, ['Réf', 'Date', 'Nb']);
  deepEq(t.rows[1], ['P-2', 'Crique & <B>', 4.5]);
});

test('Excel : plusieurs feuilles, noms nettoyés, booléens, archive ZIP', async () => {
  const bytes = writeXLSX([
    { name: 'Écarts/2026 [tournée]', rows: [['Code', 'Ouvert'], ['F4.5', true], ['F5.2', false]] },
    { name: '', rows: [['Station', 'X', 'Y'], ['ATHANASE', 356714, 465112]] }
  ], { title: 'Export', author: 'OEG' });
  const wb = await readXLSX(bytes.buffer);
  deepEq(wb.sheets.map(s => s.name), ['Écarts 2026  tournée ', 'Feuille2'], 'caractères interdits remplacés, nom par défaut');
  deepEq(wb.sheets[1].rows[1], ['ATHANASE', 356714, 465112], 'nombres conservés');
  const z = await unzip(bytes.buffer);
  assert((await z.text('docProps/core.xml')).includes('<dc:title>Export</dc:title>'), 'propriétés du classeur');
  assert((await z.text('xl/worksheets/sheet1.xml')).includes('t="b"'), 'booléens écrits comme tels');
  const raw = zipStore([{ name: 'a.txt', data: 'é’' }]);
  eq(await (await unzip(raw.buffer)).text('a.txt'), 'é’', 'archive ZIP stockée (UTF-8)');
  await throwsAsync(() => readXLSX(zipStore([{ name: 'x.txt', data: 'x' }]).buffer), 'classeur sans workbook.xml accepté');
});

test('Excel : numéros de série de dates et en-tête détecté', () => {
  eq(excelSerialToISO(46307), '2026-10-12');
  eq(excelSerialToISO(0.5), '12:00');
  eq(excelSerialToISO(46307.5), '2026-10-12T12:00');
  eq(excelSerialToISO('abc'), null);
  const t = sheetToTable([['Titre du classeur'], [], ['Réf', 'Station'], ['P-1', 'ATHANASE'], ['', '']]);
  deepEq(t.headers, ['Réf', 'Station'], 'première ligne d’au moins deux cellules'); eq(t.rows.length, 1, 'lignes vides ignorées');
  deepEq(sheetToTable([['seul']]), { headers: [], rows: [] });
});

/* ---------- PDF ---------- */
test('PDF : structure valide, table de références croisées exacte', () => {
  const doc = new PDFDocument({ title: 'Rapport d’audit' });
  doc.heading('1. Identification'); doc.keyValues([['Numéro', 'AUD-2026-000001'], ['Température', '5 ± 3 °C — œuvre']]);
  doc.table({ columns: [{ label: 'A', width: 100 }, { label: 'B', width: 300 }], rows: Array.from({ length: 120 }, (_, i) => [String(i), 'texte '.repeat(i % 20)]) });
  const bytes = doc.output();
  checkPdfStructure(bytes);
  assert(doc.pages.length > 2, 'tableau réparti sur plusieurs pages');
  deepEq(toWinAnsi('é’€'), [0xE9, 0x92, 0x80]);
});

test('PDF : encodage WinAnsi (substitutions), formats de page, sortie compressée', async () => {
  eq(pdfSafeText('CO₂ ≥ 5 → ok ✓'), 'CO2 >= 5 -> ok v');
  deepEq(toWinAnsi('a😀'), [0x61, 63], 'caractère non représentable ⇒ « ? »');
  deepEq(toWinAnsi('ŝ'), [0x73], 'lettre accentuée hors WinAnsi ⇒ lettre de base');
  const doc = new PDFDocument({ title: 'Formats', author: 'OEG' });
  doc.paragraph('Page portrait');
  doc.newPage({ landscape: true });
  doc.paragraph('Page paysage');
  eq(doc.pages[0].W, A4[0]); eq(doc.pages[1].W, A4_LANDSCAPE[0]);
  const text = checkPdfStructure(await doc.outputAsync());
  assert(text.includes(`/MediaBox [0 0 ${A4_LANDSCAPE[0]} ${A4_LANDSCAPE[1]}]`) || /\/MediaBox \[0 0 841\.89 595\.28\]/.test(text), 'page paysage');
  assert(/\/Count 2 >>/.test(text), 'deux pages');
});

test('PDF : image JPEG (tests/fixtures/photo.jpg) incorporée en DCTDecode', async () => {
  const resp = await fetch(new URL('../fixtures/photo.jpg', import.meta.url).href);
  assert(resp.ok, 'tests/fixtures/photo.jpg disponible');
  const jpg = new Uint8Array(await resp.arrayBuffer());
  deepEq(jpegInfo(jpg), { width: 320, height: 200, components: 3 });
  let err = null;
  try { jpegInfo(new Uint8Array([1, 2, 3])); } catch (e) { err = e; }
  assert(err && /JPEG/.test(err.message), 'fichier non JPEG refusé');
  const doc = new PDFDocument({ title: 'Photo' });
  doc.heading('Photographie du point');
  doc.image(jpg, { maxWidth: 160, maxHeight: 100 });
  const text = checkPdfStructure(doc.output());
  assert(/\/Subtype \/Image \/Width 320 \/Height 200 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/.test(text), 'image JPEG déclarée');
  assert(text.includes(latin1(jpg.subarray(0, 64))), 'octets JPEG incorporés tels quels');
});
