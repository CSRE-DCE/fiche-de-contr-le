/* Fichier d'échange entre tablettes « .oegct » : format, chiffrement et contrôle d'intégrité (sans stockage).
 *
 * Le fichier est un TEXTE ASCII, qui traverse sans dommage e-mail, Teams, Quick Share, Bluetooth ou clé USB :
 *   ligne 1 : « OEG-CT-ECHANGE 1 » (format et version) ;
 *   ligne 2 : en-tête JSON non secret { format, v, kdf, iterations, salt, iv, check, z } ;
 *   suite   : contenu chiffré, en base64 (lignes de 76 caractères ; espaces et retours à la ligne ignorés).
 * Chiffrement TOUJOURS : AES-GCM 256 bits, clé dérivée du MOT DE PASSE D'ÉCHANGE de l'équipe (PBKDF2-SHA256, sel
 * aléatoire : js/core/crypto.js). `check` (texte connu chiffré avec la même clé) distingue un mauvais mot de passe
 * d'un fichier altéré. Contenu déchiffré : [longueur du corps, 4 octets][corps JSON, compressé gzip si le navigateur
 * le permet][octets des photos et documents, à la suite]. Le corps porte une empreinte SHA-256 (JSON canonique du
 * corps sans l'empreinte, index des médias compris) et chaque média la sienne : tout est vérifié à la réception,
 * avant toute modification des données.
 * Erreurs : ExchangeError, code 'format' | 'version' | 'password' | 'altered' | 'integrity' | 'browser'.
 */
import { passwordKey, randomBytes, KDF_ITERATIONS } from '../core/crypto.js';
import { bytesToBase64, base64ToBytes, canonicalJSON, sha256Hex } from '../core/util.js';

export const EXCHANGE_MAGIC = 'OEG-CT-ECHANGE';
export const EXCHANGE_FORMAT = 'oeg-ct-echange';
export const EXCHANGE_VERSION = 1;
export const EXCHANGE_EXT = '.oegct';
const CHECK_TEXT = 'OEG-CT-ECHANGE';
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export class ExchangeError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'ExchangeError'; }
}

/** Le texte est-il un fichier d'échange entre tablettes ? */
export function isExchangeText(text) { return String(text || '').trimStart().startsWith(EXCHANGE_MAGIC); }

async function gzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new ExchangeError('browser', 'Navigateur trop ancien pour lire ce fichier : mettez à jour le navigateur de la tablette.');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const wrap = (s, n = 76) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out.join('\n'); };
/** Empreinte du corps : JSON canonique, sans l'empreinte elle-même. */
export async function bodyHash(core) { const { sha256, ...rest } = core; return sha256Hex(canonicalJSON(rest)); }

/**
 * Contenu en clair : corps (avec l'index et les empreintes des médias, puis l'empreinte du corps) et octets des médias.
 * body : objet JSON ; media : [{ id, bytes }]. Retourne { plain, core } (core : corps tel qu'il sera lu à la réception).
 */
export async function packExchange(body, media = [], { compress = typeof CompressionStream === 'function' } = {}) {
  const index = [];
  for (const m of media) index.push({ id: m.id, size: m.bytes.length, sha256: await sha256Hex(m.bytes) });
  const { sha256: _ignored, ...rest } = body;
  const core = JSON.parse(JSON.stringify({ ...rest, format: EXCHANGE_FORMAT, v: EXCHANGE_VERSION, media: index }));
  core.sha256 = await bodyHash(core);
  return { plain: await packPlain(core, media, { compress }), core, compressed: compress };
}
/** Assemble [longueur][corps][médias] (core déjà muni de son empreinte). */
export async function packPlain(core, media = [], { compress = typeof CompressionStream === 'function' } = {}) {
  const json = enc.encode(JSON.stringify(core));
  const packed = compress ? await gzip(json) : json;
  const total = 4 + packed.length + media.reduce((s, m) => s + m.bytes.length, 0);
  const plain = new Uint8Array(total);
  new DataView(plain.buffer).setUint32(0, packed.length);
  plain.set(packed, 4);
  let o = 4 + packed.length;
  for (const m of media) { plain.set(m.bytes, o); o += m.bytes.length; }
  return plain;
}

/** Chiffre le contenu avec le mot de passe d'échange : texte du fichier .oegct (compressed : corps compressé gzip). */
export async function sealExchange(plain, password, { iterations = KDF_ITERATIONS, compressed = false } = {}) {
  if (!password) throw new ExchangeError('password', 'Mot de passe d’échange manquant.');
  const salt = randomBytes(16), iv = randomBytes(12), civ = randomBytes(12);
  const key = await passwordKey(password, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
  const check = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: civ }, key, enc.encode(CHECK_TEXT)));
  const header = { format: EXCHANGE_FORMAT, v: EXCHANGE_VERSION, kdf: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), check: { iv: bytesToBase64(civ), ct: bytesToBase64(check) }, z: compressed ? 'gzip' : null };
  return `${EXCHANGE_MAGIC} ${EXCHANGE_VERSION}\n${JSON.stringify(header)}\n${wrap(bytesToBase64(ct))}\n`;
}

/**
 * Fichier d'échange complet. body : corps JSON (identifiant, tablette d'origine, agent, données…) ; media :
 * [{ id, bytes }]. Retourne { text, core } (core : corps lu à la réception, avec son empreinte).
 */
export async function encodeExchange(body, media, password, opts = {}) {
  const { plain, core, compressed } = await packExchange(body, media, opts);
  return { text: await sealExchange(plain, password, { ...opts, compressed }), core };
}

/** En-tête non secret d'un fichier d'échange (sans le mot de passe) ; ExchangeError 'format' / 'version'. */
export function readHeader(text) {
  text = String(text || '').trimStart();
  if (!text.startsWith(EXCHANGE_MAGIC)) throw new ExchangeError('format', 'Ce fichier n’est pas un fichier d’échange entre tablettes (.oegct).');
  const nl1 = text.indexOf('\n'), nl2 = text.indexOf('\n', nl1 + 1);
  const v = Number(text.slice(EXCHANGE_MAGIC.length, nl1).trim()) || 0;
  if (v > EXCHANGE_VERSION) throw new ExchangeError('version', 'Ce fichier a été créé par une version plus récente de l’application : mettez d’abord l’application à jour sur cette tablette (Mon compte › Rechercher une mise à jour).');
  let header;
  try { header = JSON.parse(text.slice(nl1 + 1, nl2 < 0 ? undefined : nl2)); } catch (e) { header = null; }
  if (nl1 < 0 || nl2 < 0 || !header || header.format !== EXCHANGE_FORMAT) throw new ExchangeError('altered', 'Fichier d’échange incomplet ou altéré : demandez un nouvel envoi.');
  return { header, payload: text.slice(nl2 + 1) };
}

/**
 * Déchiffre et vérifie un fichier d'échange. Retourne { body, media: Map(id → octets), header }.
 * ExchangeError 'password' (autre mot de passe d'échange), 'altered' (fichier abîmé ou modifié), 'integrity'
 * (empreinte SHA-256 incorrecte).
 */
export async function decodeExchange(text, password) {
  const { header, payload } = readHeader(text);
  const b64 = s => base64ToBytes(String(s || ''));
  let key, salt;
  try { salt = b64(header.salt); } catch (e) { throw new ExchangeError('altered', 'Fichier d’échange altéré : demandez un nouvel envoi.'); }
  key = await passwordKey(String(password || ''), salt, Number(header.iterations) || KDF_ITERATIONS);
  try { await subtle().decrypt({ name: 'AES-GCM', iv: b64(header.check?.iv) }, key, b64(header.check?.ct)); }
  catch (e) { throw new ExchangeError('password', 'Ce fichier a été chiffré avec un autre mot de passe d’échange que celui de cette tablette.'); }
  let plain;
  try { plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64(header.iv) }, key, b64(payload.replace(/\s+/g, '')))); }
  catch (e) { throw new ExchangeError('altered', 'Fichier d’échange altéré ou incomplet (contrôle d’intégrité du chiffrement en échec) : rien n’a été modifié ; demandez un nouvel envoi.'); }
  return openPlain(plain, header);
}

/** Lit et vérifie le contenu en clair (empreinte du corps, empreinte et taille de chaque média). */
export async function openPlain(plain, header = {}) {
  const fail = () => new ExchangeError('integrity', 'Empreinte d’intégrité (SHA-256) incorrecte : le fichier a été modifié. Rien n’a été modifié ; demandez un nouvel envoi.');
  if (plain.length < 4) throw fail();
  const n = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
  if (4 + n > plain.length) throw fail();
  let body;
  try {
    const raw = plain.subarray(4, 4 + n);
    body = JSON.parse(dec.decode(header.z === 'gzip' ? await gunzip(raw) : raw));
  } catch (e) { if (e instanceof ExchangeError) throw e; throw fail(); }
  if (!body || body.format !== EXCHANGE_FORMAT || !body.sha256 || await bodyHash(body) !== body.sha256) throw fail();
  const media = new Map();
  let o = 4 + n;
  for (const m of body.media || []) {
    const bytes = plain.slice(o, o + (Number(m.size) || 0));
    o += bytes.length;
    if (bytes.length !== m.size || await sha256Hex(bytes) !== m.sha256) throw fail();
    media.set(m.id, bytes);
  }
  if (o !== plain.length) throw fail();
  return { body, media, header };
}
