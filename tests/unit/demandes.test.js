/* Tests unitaires des demandes de l'OEG (14/10 et 16/10/2026), fonctions pures et composants :
 * - « Annuler la tournée » : règle cancelTourRefusal (contrôleur du binôme accepté, agent à rejoindre, encadrement,
 *   tournée signée et verrouillée, déjà annulée, motif obligatoire) ;
 * - opérateurs des prestataires (js/domain/operators.js) : initiales, identifiant déterministe, dédoublonnage
 *   (identité complétée, existant repris ou proposé, création), saisie contrôlée, libellés ; droit d'écriture ;
 * - photos : métadonnées EXIF (js/lib/exif.js : date de prise de vue, fuseau, position, deux ordres d'octets),
 *   boutons « Prendre une photo » / « Importer depuis la galerie » (js/ui/components.js), origine d'un champ ;
 * - logo de l'application (js/ui/logo.js) : logo de l'OEG par défaut, logo choisi (copie locale, images mises à jour
 *   en direct, octets PNG des PDF), stockage local indisponible. */
import { test, assert, eq, deepEq } from './harness.js';
import { cancelTourRefusal, writePermission, canWrite } from '../../js/domain/permissions.js';
import {
  normInitials, suggestOperatorInitials, operatorId, providerCode, initialsOnly, planOperator, cleanOperatorInput, operatorDisplay, operatorLabel
} from '../../js/domain/operators.js';
import { readExif, exifDateToISO } from '../../js/lib/exif.js';
import { mediaInputs, evidenceButtons, MEDIA_SOURCES } from '../../js/ui/components.js';
import { inputSource, mediaProvenance } from '../../js/ui/capture.js';
import { logoURL, isCustomLogo, setLogoCache, logoImg, logoBytes, customLogo, DEFAULT_LOGO, DEFAULT_LOGO_WIDE } from '../../js/ui/logo.js';

/* ---------- Annulation de tournée ---------- */
const ALICE = { id: 'u-alice', name: 'Alice Dupont', role: 'admin' };
const BRUNO = { id: 'u-bruno', name: 'Bruno Martin', role: 'auditeur' };
const CHLOE = { id: 'u-chloe', name: 'Chloé Petit', role: 'auditeur' };
const RQ = { id: 'u-rq', name: 'Rémi Quentin', role: 'rq' };
const SUP = { id: 'u-sup', name: 'Sarah Upton', role: 'superviseur' };
const LECT = { id: 'u-lect', name: 'Léa Lecture', role: 'consultation' };
const tour = (extra = {}) => ({ id: 'a1', number: 'AUD-2026-070001', status: 'en_cours', auditorId: ALICE.id, controllerIds: [ALICE.id, BRUNO.id], ...extra });

test('annulation : contrôleur du binôme (pas créateur) accepté, motif obligatoire', () => {
  eq(cancelTourRefusal(tour(), BRUNO), null, 'Bruno, contrôleur du binôme');
  eq(cancelTourRefusal(tour(), ALICE), null, 'Alice, créatrice');
  eq(cancelTourRefusal(tour(), BRUNO, { reason: 'Crue : accès impossible' }), null);
  eq(cancelTourRefusal(tour(), BRUNO, { reason: '' }), 'Le motif de l’annulation est obligatoire.');
  eq(cancelTourRefusal(tour(), BRUNO, { reason: '   ' }), 'Le motif de l’annulation est obligatoire.');
  eq(cancelTourRefusal(tour({ status: 'termine', signatures: { auditor: { at: 'x' } } }), BRUNO), null, 'terminée, signée mais pas verrouillée');
  // Tournée antérieure sans liste de contrôleurs : son auteur.
  eq(cancelTourRefusal({ id: 'a0', number: 'AUD-0', status: 'en_cours', auditorId: BRUNO.id }, BRUNO), null);
});

test('annulation : refus expliqués (verrouillée, déjà annulée, hors binôme, profils)', () => {
  assert(/signée et verrouillée : elle ne peut plus être annulée/.test(cancelTourRefusal(tour({ lock: { lockedAt: '2026-10-16T12:00:00Z' }, status: 'signe' }), ALICE)), 'verrouillée');
  assert(/AUD-2026-070001 déjà annulée/.test(cancelTourRefusal(tour({ status: 'abandonne' }), BRUNO)), 'déjà annulée');
  assert(/rejoignez d’abord la tournée/.test(cancelTourRefusal(tour(), CHLOE)), 'Chloé hors binôme : rejoindre');
  assert(/rejoignez d’abord la tournée/.test(cancelTourRefusal(tour(), SUP)), 'superviseur non contrôleur : rejoindre');
  eq(cancelTourRefusal(tour({ controllerIds: [BRUNO.id] }), RQ), null, 'responsable qualité (audit.delete)');
  eq(cancelTourRefusal(tour({ controllerIds: [BRUNO.id] }), ALICE), null, 'administratrice non contrôleuse');
  assert(/Votre profil ne permet pas/.test(cancelTourRefusal(tour(), LECT)), 'consultation');
  assert(/introuvable/.test(cancelTourRefusal(null, ALICE)));
  assert(cancelTourRefusal(tour(), null), 'sans agent connecté');
});

/* ---------- Opérateurs des prestataires ---------- */
const HYDRECO = { id: 'prov-HYDRECO', code: 'HYDRECO', name: 'HYDRECO' };
const NBC = { id: 'prov-NBC', code: 'NBC', name: 'NBC' };
const seedOp = (org, ini) => ({ id: `op-${org}-${ini}`, providerId: 'prov-' + org, code: ini, lastName: ini, firstName: '', function: 'Préleveur', active: true });
const OPS = [seedOp('HYDRECO', 'DB'), seedOp('HYDRECO', 'NB'), seedOp('HYDRECO', 'FC'), seedOp('HYDRECO', 'FCh'), seedOp('NBC', 'ML'), seedOp('OEG', 'ML'),
  { id: 'op-HYDRECO-JD', providerId: 'prov-HYDRECO', code: 'JD', lastName: 'Durand', firstName: 'Jean', function: 'Technicien', active: true },
  { id: 'op-HYDRECO-ZZ', providerId: 'prov-HYDRECO', code: 'ZZ', lastName: 'Ancien', firstName: 'Zoé', _deleted: true }];

test('opérateurs : initiales, identifiant déterministe, opérateur connu par ses initiales', () => {
  eq(normInitials(' n.b '), 'NB');
  eq(normInitials('élodie'), 'ELOD', '4 caractères au plus, sans accents');
  eq(suggestOperatorInitials('Nadia', 'Bernard'), 'NB');
  eq(suggestOperatorInitials('Jean-Marc', 'Évrard'), 'JME');
  eq(providerCode(HYDRECO), 'HYDRECO');
  eq(providerCode({ id: 'prov-TL1' }), 'TL1');
  eq(operatorId(HYDRECO, 'nb'), 'op-HYDRECO-NB', 'même schéma que le référentiel installé');
  assert(initialsOnly(seedOp('HYDRECO', 'NB')), 'NB : initiales seules');
  assert(!initialsOnly(OPS[6]), 'Jean Durand');
  eq(operatorDisplay(seedOp('HYDRECO', 'NB')), 'NB');
  eq(operatorDisplay(OPS[6]), 'Jean Durand (JD)');
  eq(operatorLabel(OPS[6]), 'Jean Durand (JD) — Technicien');
});

test('opérateurs : sans doublon (identité complétée, existant repris ou proposé, création)', () => {
  const plan = (provider, input) => planOperator(OPS, provider, cleanOperatorInput(input));
  // « NB » du référentiel (initiales seules) : identité complétée, même fiche.
  const p1 = plan(HYDRECO, { lastName: 'Bernard', firstName: 'Nadia', initials: 'NB', fn: 'Technicienne' });
  eq(p1.action, 'complete'); eq(p1.operator.id, 'op-HYDRECO-NB');
  // Même personne déjà enregistrée : reprise, sans doublon (casse et accents ignorés).
  const p2 = plan(HYDRECO, { lastName: 'DURAND', firstName: 'jean', initials: 'jd' });
  eq(p2.action, 'existing'); eq(p2.operator.id, 'op-HYDRECO-JD');
  // Mêmes initiales, autre personne : l'existant est proposé.
  const p3 = plan(HYDRECO, { lastName: 'Dubois', firstName: 'Jules', initials: 'JD' });
  eq(p3.action, 'propose'); eq(p3.operator.id, 'op-HYDRECO-JD');
  assert(/initiales JD sont déjà celles de Jean Durand \(JD\) chez HYDRECO/.test(p3.reason), p3.reason);
  // Même nom et prénom, autres initiales : l'existant est proposé (jamais deux fiches pour une personne).
  const p4 = plan(HYDRECO, { lastName: 'Durand', firstName: 'Jean', initials: 'JDu' });
  eq(p4.action, 'propose'); eq(p4.operator.id, 'op-HYDRECO-JD');
  // « FCH » = « FCh » (casse ignorée) : initiales seules → complétées.
  eq(plan(HYDRECO, { lastName: 'Charles', firstName: 'Félix', initials: 'FCH' }).operator.id, 'op-HYDRECO-FCh');
  // Initiales prises chez un AUTRE prestataire : pas de conflit (ML existe chez NBC et chez OEG).
  const p5 = plan(HYDRECO, { lastName: 'Lebrun', firstName: 'Marc', initials: 'ML' });
  deepEq(p5, { action: 'create', id: 'op-HYDRECO-ML' });
  // Identifiant d'un opérateur supprimé : suffixe (jamais de résurrection silencieuse).
  eq(plan(HYDRECO, { lastName: 'Zorro', firstName: 'Zia', initials: 'ZZ' }).id, 'op-HYDRECO-ZZ-2');
  eq(plan(NBC, { lastName: 'Lambert', firstName: 'Marie', initials: 'ML' }).action, 'complete', 'ML de NBC (initiales seules)');
});

test('opérateurs : saisie contrôlée et droit d’écriture des agents de terrain', () => {
  eq(cleanOperatorInput({ firstName: 'Nadia', initials: 'NB' }).error, 'Le nom de l’opérateur est obligatoire.');
  eq(cleanOperatorInput({ lastName: 'Bernard', initials: 'NB' }).error, 'Le prénom de l’opérateur est obligatoire.');
  const c = cleanOperatorInput({ lastName: '  Bernard ', firstName: 'Nadia  ', initials: '', fn: ' Technicienne ' });
  deepEq(c, { lastName: 'Bernard', firstName: 'Nadia', initials: 'NB', fn: 'Technicienne' }, 'initiales proposées si vides');
  deepEq(writePermission('operator'), ['ref.manage', 'audit.edit']);
  assert(canWrite('auditeur', 'operator') && canWrite('admin', 'operator'), 'auditeur et administrateur');
  assert(!canWrite('consultation', 'operator'), 'consultation');
  deepEq(writePermission('provider'), ['ref.manage'], 'les autres référentiels restent réservés');
});

/* ---------- Photos : EXIF ---------- */
/** JPEG minimal (SOI + APP1 Exif + EOI) en ordre « MM » (gros-boutiste) : DateTimeOriginal et OffsetTimeOriginal. */
function bigEndianExif(date, offset) {
  const ascii = s => [...s].map(c => c.charCodeAt(0)).concat(0);
  const d = ascii(date), o = ascii(offset);
  // TIFF : en-tête (8) + IFD0 (2 + 12 + 4) → sous-IFD Exif à 26 : (2 + 2 × 12 + 4) → données à 56.
  const tiff = [];
  const u16 = v => [v >> 8 & 255, v & 255], u32 = v => [v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
  tiff.push(0x4D, 0x4D, ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(2), ...u16(0x9003), ...u16(2), ...u32(d.length), ...u32(56), ...u16(0x9011), ...u16(2), ...u32(o.length), ...u32(56 + d.length), ...u32(0));
  tiff.push(...d, ...o);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, ...u16(app1.length + 2), ...app1, 0xFF, 0xD9]);
}

test('photos : date de prise de vue et position EXIF (fichier de la galerie)', async () => {
  const bytes = new Uint8Array(await (await fetch(new URL('../fixtures/photo-exif.jpg', import.meta.url))).arrayBuffer());
  const x = readExif(bytes);
  assert(x, 'métadonnées lues');
  eq(x.takenAtText, '2026:10:15 08:42:10');
  eq(x.takenAt, new Date(2026, 9, 15, 8, 42, 10).toISOString(), 'heure locale de l’appareil');
  assert(Math.abs(x.gps.lat - 4.2066) < 1e-4 && Math.abs(x.gps.lon + 52.29) < 1e-4, `position ${JSON.stringify(x.gps)}`);
  eq(x.make, 'OEG');
  // Sans métadonnées : null ; fichier qui n'est pas un JPEG : null, jamais d'erreur.
  eq(readExif(new Uint8Array(await (await fetch(new URL('../fixtures/photo.jpg', import.meta.url))).arrayBuffer())), null);
  eq(readExif(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), null);
  eq(readExif(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00])), null, 'segment tronqué');
});

test('photos : EXIF gros-boutiste avec fuseau, dates invalides', () => {
  const x = readExif(bigEndianExif('2026:10:15 08:42:10', '-03:00'));
  eq(x.takenAt, '2026-10-15T11:42:10.000Z', 'fuseau de la photo pris en compte');
  eq(x.gps, null);
  eq(exifDateToISO('0000:00:00 00:00:00'), null, 'date nulle');
  eq(exifDateToISO('2026:13:01 10:00:00'), null, 'mois invalide');
  eq(exifDateToISO('2026:10:15 08:42:10', '+02:00'), '2026-10-15T06:42:10.000Z');
});

/* ---------- Photos : boutons ---------- */
const dom = h => { const el = document.createElement('div'); el.innerHTML = String(h); return el; };

test('photos : « Prendre une photo » et « Importer depuis la galerie », deux choix distincts', () => {
  const link = { type: 'item', id: 'a1', itemId: 'it-F3-1@09271503' };
  const el = dom(mediaInputs(link, { auditId: 'a1', document: true }));
  const cam = el.querySelector('input[data-source=camera]'), gal = el.querySelector('input[data-source=gallery]'), doc = el.querySelector('input[data-source=document]');
  eq(cam.getAttribute('accept'), 'image/*'); eq(cam.getAttribute('capture'), 'environment'); assert(!cam.multiple, 'une photo');
  eq(gal.getAttribute('accept'), 'image/*'); assert(!gal.hasAttribute('capture'), 'galerie : sans capture'); assert(gal.multiple, 'sélection multiple');
  assert(/application\/pdf/.test(doc.getAttribute('accept')) && doc.dataset.kind === 'document');
  for (const i of [cam, gal, doc]) { deepEq(JSON.parse(i.dataset.link), link); eq(i.dataset.audit, 'a1'); eq(i.dataset.change, 'media-add'); }
  const labels = [...el.querySelectorAll('label')].map(l => l.textContent.trim());
  deepEq(labels, ['Prendre une photo', 'Importer depuis la galerie', 'Joindre un document']);
  eq(MEDIA_SOURCES.gallery.label, 'Importer depuis la galerie');
  // Icônes seules : libellé pour les lecteurs d'écran ; sans document par défaut.
  const c = dom(mediaInputs(link, { compact: true }));
  deepEq([...c.querySelectorAll('label')].map(l => l.getAttribute('aria-label')), ['Prendre une photo', 'Importer depuis la galerie']);
  // Grilles historiques, écarts : libellé du bouton « appareil photo » personnalisable, galerie toujours proposée.
  const ev = dom(evidenceButtons({ type: 'equipment', id: 'e1' }, { label: 'Photographier l’étiquette', file: false }));
  deepEq([...ev.querySelectorAll('label')].map(l => l.textContent.trim()), ['Photographier l’étiquette', 'Importer depuis la galerie']);
  // Autre gestionnaire et données (fiche station) ; pas de data-link sans lien.
  const st = dom(mediaInputs(null, { act: 'st-photo', data: { site: 'site-1', slot: 'AM' } })).querySelector('input[data-source=gallery]');
  eq(st.dataset.change, 'st-photo'); eq(st.dataset.slot, 'AM'); eq(st.dataset.site, 'site-1'); assert(!st.hasAttribute('data-link'));
});

test('photos : origine d’un champ et provenance affichée', () => {
  const inp = attrs => { const i = document.createElement('input'); i.type = 'file'; for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v); return i; };
  eq(inputSource(inp({ 'data-source': 'gallery' })), 'gallery');
  eq(inputSource(inp({ capture: 'environment' })), 'camera', 'ancien champ avec capture');
  eq(inputSource(inp({ 'data-kind': 'document' })), 'document');
  eq(inputSource(inp({})), 'gallery');
  const p = mediaProvenance({ source: 'gallery', importedAt: '2026-10-17T12:00:00Z', takenAt: '2026-10-15T11:42:10Z', takenAtSource: 'exif', gps: { lat: 4.2, lon: -52.3, source: 'exif' } });
  assert(/^Importée depuis la galerie le /.test(p.origin), p.origin);
  eq(p.whenNote, 'lue dans les métadonnées de la photo');
  eq(p.gpsNote, 'position enregistrée par l’appareil photo');
  const q = mediaProvenance({ source: 'gallery', takenAtSource: 'import', gps: { lat: 4.2, lon: -52.3, source: 'device' } });
  eq(q.whenNote, 'date d’import : date de prise de vue inconnue');
  assert(/position de la tablette au moment de l’import/.test(q.gpsNote));
  eq(mediaProvenance({ source: 'camera', takenAtSource: 'capture' }).origin, 'Appareil photo de la tablette');
});

/* ---------- Logo de l'application ---------- */
// PNG 1 × 1 transparent.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('logo : logo de l’OEG par défaut, logo choisi partout, rétablir', async () => {
  const saved = customLogo();
  try {
    setLogoCache(null);
    assert(!isCustomLogo());
    assert(logoURL().endsWith(DEFAULT_LOGO), logoURL());
    assert(logoURL(DEFAULT_LOGO_WIDE).endsWith(DEFAULT_LOGO_WIDE));
    const def = await logoBytes();
    assert(def && def[0] === 0x89 && def[1] === 0x50, 'PNG de l’OEG pour les PDF');
    // Logo choisi : copie locale, images data-app-logo de la page mises à jour, octets PNG pour les PDF.
    const host = dom(logoImg({ cls: 'oh-logo', width: 96, height: 96 }));
    document.body.appendChild(host);
    const img = host.querySelector('img');
    assert(!img.classList.contains('is-custom'));
    setLogoCache({ dataUrl: PNG, sha256: 'abc', width: 1, height: 1, name: 'test.png' });
    assert(isCustomLogo() && logoURL() === PNG && logoURL(DEFAULT_LOGO_WIDE) === PNG);
    eq(img.getAttribute('src'), PNG, 'image affichée mise à jour en direct');
    assert(img.classList.contains('is-custom'), 'proportions conservées (classe is-custom)');
    eq(JSON.parse(localStorage.getItem('oeg-ct:logo')).sha256, 'abc', 'copie locale pour l’écran de connexion');
    const b = await logoBytes();
    eq(b.length, 70); eq(b[0], 0x89);
    assert(/class="logo is-custom"/.test(String(logoImg())), 'nouveaux gabarits');
    // Une data: URL qui n'est pas un PNG est refusée (logo de l'OEG).
    setLogoCache({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' });
    assert(!isCustomLogo());
    setLogoCache(null);
    eq(localStorage.getItem('oeg-ct:logo'), null);
    eq(img.getAttribute('src'), logoURL(), 'rétabli en direct');
    host.remove();
  } finally { setLogoCache(saved); }
});

test('logo : stockage local indisponible (navigation privée) — logo pour la session', () => {
  const saved = customLogo();
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    setLogoCache({ dataUrl: PNG, sha256: 'def', width: 1, height: 1 });
    assert(isCustomLogo() && logoURL() === PNG, 'logo affiché malgré tout');
  } finally { Storage.prototype.setItem = orig; setLogoCache(saved); }
});
