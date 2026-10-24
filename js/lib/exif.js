/* Lecture minimale des métadonnées EXIF d'une photographie JPEG, sans dépendance : date de prise de vue et position
 * GPS enregistrées par l'appareil photo (photos importées depuis la galerie de la tablette : la date utile est celle
 * de la prise de vue, pas celle de l'import).
 * Segment APP1 « Exif » → en-tête TIFF (ordre des octets II ou MM) → IFD0 (DateTime 0x0132, Make, Model) → sous-IFD
 * Exif (pointeur 0x8769 : DateTimeOriginal 0x9003, DateTimeDigitized 0x9004, OffsetTimeOriginal 0x9011) et IFD GPS
 * (pointeur 0x8825 : GPSLatitudeRef 1, GPSLatitude 2, GPSLongitudeRef 3, GPSLongitude 4).
 * Une date EXIF sans fuseau (cas général) est une heure LOCALE de l'appareil : lue dans le fuseau de la tablette.
 * Fichier pur (tests unitaires) : aucune erreur levée, null si le fichier n'a pas de métadonnées lisibles. */

const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5, SRATIONAL = 10;
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Début de l'en-tête TIFF du segment EXIF d'un JPEG (index dans `b`) ou -1. */
function tiffStart(b) {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return -1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return -1;
    const type = b[i + 1];
    if (type === 0xD8 || (type >= 0xD0 && type <= 0xD7) || type === 0x01) { i += 2; continue; }
    if (type === 0xDA || type === 0xD9) return -1;            // début de l'image : plus de métadonnées
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return -1;
    if (type === 0xE1 && i + 10 <= b.length && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) return i + 10;
    i += 2 + len;
  }
  return -1;
}

/** Lecteur des entrées d'un IFD : { tag: valeur } (texte, nombre ou tableau de nombres). */
function readIFD(view, base, offset, little) {
  const out = {};
  if (base + offset + 2 > view.byteLength) return out;
  const n = view.getUint16(base + offset, little);
  for (let k = 0; k < n; k++) {
    const e = base + offset + 2 + k * 12;
    if (e + 12 > view.byteLength) break;
    const tag = view.getUint16(e, little), type = view.getUint16(e + 2, little), count = view.getUint32(e + 4, little);
    const size = (SIZE[type] || 0) * count;
    if (!size || count > 4096) continue;
    const at = size <= 4 ? e + 8 : base + view.getUint32(e + 8, little);
    if (at + size > view.byteLength) continue;
    try { out[tag] = value(view, at, type, count, little); } catch (err) { /* entrée illisible ignorée */ }
  }
  return out;
}
function value(view, at, type, count, little) {
  if (type === ASCII) {
    let s = '';
    for (let k = 0; k < count; k++) { const c = view.getUint8(at + k); if (!c) break; s += String.fromCharCode(c); }
    return s.trim();
  }
  const list = [];
  for (let k = 0; k < count; k++) {
    if (type === SHORT) list.push(view.getUint16(at + 2 * k, little));
    else if (type === LONG) list.push(view.getUint32(at + 4 * k, little));
    else if (type === RATIONAL || type === SRATIONAL) {
      const get = type === RATIONAL ? (o => view.getUint32(o, little)) : (o => view.getInt32(o, little));
      const num = get(at + 8 * k), den = get(at + 8 * k + 4);
      list.push(den ? num / den : NaN);
    } else list.push(view.getUint8(at + k));
  }
  return count === 1 ? list[0] : list;
}

/**
 * Date EXIF « AAAA:MM:JJ HH:MM:SS » (+ fuseau « ±HH:MM » facultatif) → instant ISO (UTC) ; sans fuseau : heure locale
 * de la tablette. null pour une date absente, nulle (« 0000:00:00 ») ou invraisemblable.
 */
export function exifDateToISO(text, offset = '') {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text || '').trim());
  if (!m) return null;
  const [Y, M, D, h, mi, s] = m.slice(1).map(Number);
  if (Y < 1990 || Y > 2100 || M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || mi > 59 || s > 59) return null;
  const tz = /^[+-]\d{2}:\d{2}$/.test(String(offset || '').trim()) ? String(offset).trim() : '';
  const d = tz ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`) : new Date(Y, M - 1, D, h, mi, s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
/** Degrés, minutes, secondes EXIF → degrés décimaux signés (référence S / W négative). */
function dmsToDeg(dms, ref) {
  const [d, m = 0, s = 0] = Array.isArray(dms) ? dms : [dms];
  const v = Number(d) + Number(m) / 60 + Number(s) / 3600;
  if (!Number.isFinite(v)) return null;
  return /^[SW]/i.test(String(ref || '')) ? -v : v;
}

/**
 * Métadonnées EXIF d'une photographie JPEG (octets : Uint8Array ou ArrayBuffer ; les 128 premiers kilo-octets
 * suffisent) : { takenAt (ISO ou null), takenAtText (« AAAA:MM:JJ HH:MM:SS » lu), gps ({lat, lon} ou null), make,
 * model } ; null si le fichier n'a pas de segment EXIF lisible.
 */
export function readExif(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const start = tiffStart(b);
    if (start < 0 || start + 8 > b.length) return null;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const order = view.getUint16(start);
    const little = order === 0x4949;
    if (!little && order !== 0x4D4D) return null;
    if (view.getUint16(start + 2, little) !== 42) return null;
    const ifd0 = readIFD(view, start, view.getUint32(start + 4, little), little);
    const sub = typeof ifd0[0x8769] === 'number' ? readIFD(view, start, ifd0[0x8769], little) : {};
    const gpsIfd = typeof ifd0[0x8825] === 'number' ? readIFD(view, start, ifd0[0x8825], little) : {};
    const text = sub[0x9003] || sub[0x9004] || ifd0[0x0132] || '';
    const offset = sub[0x9003] ? sub[0x9011] : sub[0x9004] ? sub[0x9012] : sub[0x9010];
    let gps = null;
    if (gpsIfd[2] !== undefined && gpsIfd[4] !== undefined) {
      const lat = dmsToDeg(gpsIfd[2], gpsIfd[1]), lon = dmsToDeg(gpsIfd[4], gpsIfd[3]);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) gps = { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 };
    }
    return { takenAt: exifDateToISO(text, offset), takenAtText: text || null, gps, make: ifd0[0x010F] || null, model: ifd0[0x0110] || null };
  } catch (e) { return null; }
}
