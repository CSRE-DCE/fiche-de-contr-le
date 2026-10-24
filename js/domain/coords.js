/* Coordonnées planes saisies (critères « X / Y » des feuilles, stations et points de prélèvement, imports de
 * stations) : système de référence RGFG95 / UTM 22N, ou saisie en UTM 21N convertie en UTM 22N. Fichier pur.
 *
 * Valeur enregistrée : TOUJOURS x / y en UTM 22N (alertes d'éloignement, cartes, fiches, PDF, rapports, exports) ;
 * une saisie en UTM 21N garde en plus sa trace : srs '21N' et x21 / y21 (valeurs saisies, en mètres). En 22N (défaut),
 * srs, x21 et y21 sont absents. La conversion passe par la latitude / longitude (js/lib/geo.js, même ellipsoïde
 * GRS80 ≈ WGS84 dans les deux fuseaux) et s'arrondit au mètre, comme un relevé GPS (positionXY).
 * Contrôles (coordIssues) : X / Y d'UTM 21N saisis en 22N (proposer « UTM 21N »), point hors de la Guyane et de ses
 * eaux littorales. Le relevé GPS de la tablette donne directement l'UTM 22N (lat / lon conservés). */
import { utmToLatLon, latLonToUtm, guessUtmZone, inGuyane } from '../lib/geo.js';

/** Systèmes proposés à la saisie (libellés des listes de choix). */
export const SRS = Object.freeze({ '22N': 'UTM 22N (RGFG95)', '21N': 'UTM 21N' });
export const DEFAULT_SRS = '22N';
/** Clés techniques d'un relevé GPS (position de la tablette) jointes aux X / Y d'un critère. */
const GPS_META = ['lat', 'lon', 'accuracy', 'at'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
/** Mètres arrondis, sans séparateur (comme les X / Y des fiches et des PDF) : 164411,68 → « 164412 ». */
export const fmtMeters = v => { const n = num(v); return n === null ? '' : String(Math.round(n)); };

/** Système d'une valeur ou d'une station : '21N' si la saisie d'origine est en UTM 21N, sinon '22N'. */
export const srsOf = v => (isObj(v) && String(v.srs || '').toUpperCase() === '21N' ? '21N' : '22N');
/** Système lu dans un texte (colonne « Fuseau » d'un import…) : « 21 », « 21N », « UTM 21 », « EPSG:3313 » → '21N'. */
export function parseSrs(text) {
  const t = String(text ?? '').toUpperCase().replace(/\s+/g, '');
  if (!t) return null;
  if (/3313|32621|(^|[^0-9])21N?($|[^0-9])/.test(t)) return '21N';
  if (/2972|32622|RGFG|(^|[^0-9])22N?($|[^0-9])/.test(t)) return '22N';
  return null;
}

/**
 * Conversion d'une saisie X / Y dans le système `srs` : {x, y (UTM 22N, arrondis au mètre), lat, lon (WGS84, 7
 * décimales), srs, x21?, y21?, inGuyane, zone (fuseau probable de la saisie)} ; null si X ou Y manque ou est illisible.
 */
export function convertEntry(x, y, srs = DEFAULT_SRS) {
  const ex = num(x), ny = num(y);
  if (ex === null || ny === null) return null;
  const s = srs === '21N' ? '21N' : '22N';
  const [lat, lon] = utmToLatLon(ex, ny, s === '21N' ? 21 : 22);
  const out = { srs: s, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), inGuyane: inGuyane(lat, lon), zone: guessUtmZone(ex, ny) };
  if (s === '21N') {
    const [x22, y22] = latLonToUtm(lat, lon, 22);
    Object.assign(out, { x: Math.round(x22), y: Math.round(y22), x21: ex, y21: ny });
  } else Object.assign(out, { x: ex, y: ny });
  return out;
}

/** Valeurs affichées dans les champs X / Y pour le système choisi : {x, y} (x21 / y21 en UTM 21N). */
export function entryOf(v) {
  if (!isObj(v)) return { x: null, y: null };
  return srsOf(v) === '21N' ? { x: v.x21 ?? null, y: v.y21 ?? null } : { x: v.x ?? null, y: v.y ?? null };
}

/**
 * Valeur d'un groupe X / Y (critère `fields` gps) après la saisie d'un champ (`key` 'x' ou 'y', `v` nombre ou vide) :
 * en 22N, x / y ; en UTM 21N, x21 / y21 puis x / y (22N) recalculés dès que les deux sont saisis (retirés sinon).
 * Une position saisie à la main remplace celle d'un relevé GPS : lat, lon, précision et heure du relevé sont retirés.
 * Les autres champs du groupe sont conservés. Retourne un nouvel objet (jamais la valeur reçue).
 */
export function withXYEntry(value, key, v) {
  const out = { ...(isObj(value) ? value : {}) };
  const n = num(v);
  const k = srsOf(out) === '21N' ? key + '21' : key;
  if (n === null) delete out[k]; else out[k] = n;
  for (const g of GPS_META) delete out[g];
  if (srsOf(out) === '21N') {
    const c = convertEntry(out.x21, out.y21, '21N');
    if (c) { out.x = c.x; out.y = c.y; } else { delete out.x; delete out.y; }
  }
  return out;
}

/**
 * Changement de système d'un groupe X / Y (choix « UTM 22N (RGFG95) » / « UTM 21N ») ; la position du point est
 * conservée, sauf X / Y d'UTM 21N saisis par erreur en 22N, qui sont alors CONVERTIS :
 *  - vers 21N : relevé GPS (lat / lon) → x21 / y21 calculés ; X / Y plausibles en 21N (saisis en 22N par erreur) →
 *    repris comme saisie 21N et convertis en 22N ; X / Y 22N → leurs équivalents 21N affichés ;
 *  - vers 22N : srs, x21 et y21 retirés (x / y, déjà en 22N, conservés).
 */
export function withSrs(value, srs) {
  const out = { ...(isObj(value) ? value : {}) };
  if (srs !== '21N') { delete out.srs; delete out.x21; delete out.y21; return out; }
  if (srsOf(out) === '21N') return out;
  out.srs = '21N';
  const x = num(out.x), y = num(out.y), lat = num(out.lat), lon = num(out.lon);
  if (lat !== null && lon !== null) {
    const [x21, y21] = latLonToUtm(lat, lon, 21);
    out.x21 = Math.round(x21); out.y21 = Math.round(y21);
  } else if (x !== null && y !== null) {
    if (guessUtmZone(x, y) === '21N') {
      const c = convertEntry(x, y, '21N');
      out.x21 = x; out.y21 = y; out.x = c.x; out.y = c.y;
    } else {
      const [lt, ln] = utmToLatLon(x, y, 22);
      const [x21, y21] = latLonToUtm(lt, ln, 21);
      out.x21 = Math.round(x21); out.y21 = Math.round(y21);
    }
  } else {
    if (x !== null) out.x21 = x;
    if (y !== null) out.y21 = y;
    delete out.x; delete out.y;
  }
  return out;
}

/** Relevé GPS (positionXY : x / y 22N, lat, lon…) appliqué à un groupe X / Y : en UTM 21N, x21 / y21 calculés aussi. */
export function withGpsReading(value, reading) {
  const out = { ...(isObj(value) ? value : {}), ...reading };
  if (srsOf(out) === '21N' && num(reading?.lat) !== null && num(reading?.lon) !== null) {
    const [x21, y21] = latLonToUtm(Number(reading.lat), Number(reading.lon), 21);
    out.x21 = Math.round(x21); out.y21 = Math.round(y21);
  }
  return out;
}

/** « saisi en UTM 21N : X 829310 · Y 608565 » (traçabilité de la saisie d'origine) ou ''. */
export function originText(v) {
  if (srsOf(v) !== '21N' || num(v?.x21) === null || num(v?.y21) === null) return '';
  return `saisi en UTM 21N : X ${fmtMeters(v.x21)} · Y ${fmtMeters(v.y21)}`;
}
/** « RGFG95 / UTM 22N : X 164412 · Y 608596 » (résultat de la conversion) ou ''. */
export function convertedText(v) {
  if (num(v?.x) === null || num(v?.y) === null) return '';
  return `RGFG95 / UTM 22N : X ${fmtMeters(v.x)} · Y ${fmtMeters(v.y)}`;
}

/**
 * Contrôle de cohérence d'une position saisie {x, y, srs?, x21?, y21?} : [{level: 'warning', code, message}].
 *  - XY_21N_AS_22N : X / Y saisis en 22N alors qu'ils sont ceux d'un point de Guyane en UTM 21N ;
 *  - XY_OUT : point hors de la Guyane et de ses eaux littorales (fuseau, X / Y inversés ou faute de frappe ?).
 */
export function coordIssues(v) {
  if (!isObj(v)) return [];
  const srs = srsOf(v);
  const e = entryOf(v);
  const c = convertEntry(e.x, e.y, srs);
  if (!c) return [];
  if (c.inGuyane) return [];
  if (srs === '22N' && c.zone === '21N') {
    const x22 = convertEntry(e.x, e.y, '21N');
    return [{ level: 'warning', code: 'XY_21N_AS_22N', message: `X ${fmtMeters(e.x)} / Y ${fmtMeters(e.y)} : coordonnées d’UTM 21N ? Choisissez « UTM 21N » pour les convertir en UTM 22N (X ${fmtMeters(x22.x)} · Y ${fmtMeters(x22.y)}).` }];
  }
  const swapped = convertEntry(e.y, e.x, srs);
  return [{ level: 'warning', code: 'XY_OUT', message: `X ${fmtMeters(e.x)} / Y ${fmtMeters(e.y)} (${SRS[srs]}) : point hors de la Guyane — vérifiez le système de coordonnées${swapped?.inGuyane ? ' (X et Y inversés ?)' : ''} et la saisie.` }];
}

/**
 * Coordonnées d'une station ou d'un point de prélèvement saisies dans un formulaire ou un fichier :
 * {x, y, lat, lon (6 décimales), srs?, x21?, y21?} pour l'enregistrement (x / y en 22N), plus `issues` ; null si X ou Y
 * manque. Sans système précisé (`srs` null) : fuseau détecté (UTM 21N reconnu et converti, `detected: true`).
 */
export function siteXY(x, y, srs = null) {
  const ex = num(x), ny = num(y);
  if (ex === null || ny === null) return null;
  const detected = !srs && guessUtmZone(ex, ny) === '21N';
  const s = srs === '21N' || detected ? '21N' : '22N';
  const c = convertEntry(ex, ny, s);
  const out = { x: c.x, y: c.y, lat: Number(c.lat.toFixed(6)), lon: Number(c.lon.toFixed(6)) };
  if (s === '21N') Object.assign(out, { srs: '21N', x21: ex, y21: ny });
  return { ...out, detected, issues: coordIssues(s === '21N' ? { srs: '21N', x21: ex, y21: ny } : { x: ex, y: ny }) };
}
