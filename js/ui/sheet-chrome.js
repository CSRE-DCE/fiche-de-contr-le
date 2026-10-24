/* Habillage des fiches de contrôle terrain OEG, fidèle aux maquettes (docs/maquettes) : en-tête OEG,
 * grand bandeau « Station », bandeau d'information (Code SANDRE / Bassin versant / Coordonnées
 * RGFG95), cartes de section à pastille numérotée, encadrés (observations, conclusion…), cases à
 * cocher carrées, silhouette de la Guyane avec le point de la station, pied de page (vagues, forêt).
 *
 * Bandeau « Station » de la feuille 1 : réseaux de surveillance de la station (option networks : objets du
 * référentiel « Réseaux », couleurs de js/domain/networks.js) sur une ligne à part.
 * Note sur 20 (js/domain/grading.js) : badge « Majeur (×2) » d'un point majeur (majorBadge), encadré « Grille de
 * notation » en pied de feuille (gradeBox) et pastille de note des tableaux de synthèse (gradePill), couleur de
 * l'appréciation : vert « Satisfaisant », orange « À améliorer », rouge « Insuffisant », gris « non noté ».
 *
 * Fonctions pures produisant du HTML (gabarits html`` de js/core/util.js), mises en forme par
 * css/sheet.css. Couleurs : thème de la feuille (js/ui/themes.js), posé par sheetFrame() ou par le
 * paramètre `theme` d'un composant (classe .th-<thème> + variables CSS --th-*).
 * Paramètres « body » / « right » : du HTML (html``/raw() ou chaîne HTML) ; titres : texte échappé. */
import { html, raw, SafeHTML } from '../core/util.js';
import { THEMES, themeVars } from './themes.js';
import { icon } from './icons.js';
import { GUYANE, guyaneXY } from '../lib/guyane.js';
import { utmToLatLon } from '../lib/geo.js';
import { networkColors } from '../domain/networks.js';
import { logoImg } from './logo.js';
import { thresholdsText, frNumber, GRADE_STATES } from '../domain/grading.js';

/** Adresse d'un fichier de l'application (résolue depuis ce module : fonctionne depuis index.html,
 * docs/charte.html ou un sous-chemin GitHub Pages). */
export const assetURL = path => new URL('../../' + path, import.meta.url).href;
/** Logo par défaut de l'OEG ; logo affiché (logo choisi en Administration, sinon celui-ci) : logoURL() de js/ui/logo.js. */
export const LOGO_URL = assetURL('icons/logo-oeg-rond.png');

/** Textes par défaut de l'en-tête (remplacés par grid.header). */
export const DEFAULT_HEADER = {
  org: 'Office de l’Eau de Guyane', title: 'Fiches de contrôle terrain', subtitle: 'Fiche station de contrôle terrain',
  tagline: 'L’eau au service des milieux naturels de Guyane', program: 'Suivi biologique des eaux douces de surface de Guyane',
  slogan: 'La connaissance aujourd’hui pour les rivières de demain', website: 'www.eauguyane.fr'
};

/* Décors vectoriels (réutilisables par le PDF : mêmes tracés). Forêt : repère 600 × 120, sol à y = 100. */
export const DECOR = {
  forestViewBox: [600, 120],
  forest: 'M460 100L456 100L450 100L444 100L438 100L432 100L426 100L420 100L414 100L408 100L402 99.3L396 98.3L390 97.3L384 96.6L378 96.1L372 95.6L366 94.7L360 93.1L354 91L348 88.9L342 87.3L336 86.6L330 86.5L324 86.6L318 86.2L312 85L306 83.4L300 82.1L294 81.6L288 81.9L282 82.5L276 82.3L270 80.7L264 77.6L258 73.9L252 70.6L246 68.7L240 68L234 67.6L228 66.4L222 64.1L216 61.1L210 58.7L204 58.1L198 59.9L192 63.1L186 66.1L180 67.6L174 66.9L168 65L162 63.3L156 63L150 64.2L144 65.4L138 65L132 61.8L126 56.3L120 50.2L114 47L108 46.8L102 48.9L96 51.5L90 52.9L84 52.2L78 50.4L72 49.2L66 50.2L60 53.5L54 57.7L48 60.6L42 60.6L36 57.6L30 53L24 48.9L18 46.9L12 46.9L6 47.5L0 46.8L0 100ZM-11.5 43.7a11.5 11.5 0 1 0 23 0a11.5 11.5 0 1 0 -23 0ZM-1.4 37.3a7.1 7.1 0 1 0 14.3 0a7.1 7.1 0 1 0 -14.3 0ZM0.7 44.3a11.3 11.3 0 1 0 22.7 0a11.3 11.3 0 1 0 -22.7 0ZM10.7 38.1a7 7 0 1 0 14.1 0a7 7 0 1 0 -14.1 0ZM12.7 44.3a11.3 11.3 0 1 0 22.6 0a11.3 11.3 0 1 0 -22.6 0ZM22.6 38.1a7 7 0 1 0 14 0a7 7 0 1 0 -14 0ZM26.2 52.7a9.7 9.7 0 1 0 19.3 0a9.7 9.7 0 1 0 -19.3 0ZM34.7 47.4a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM38 55.5a8 8 0 1 0 16.1 0a8 8 0 1 0 -16.1 0ZM44.8 52.2a9.7 9.7 0 1 0 19.3 0a9.7 9.7 0 1 0 -19.3 0ZM53.3 46.8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM54 45.2a10.6 10.6 0 1 0 21.1 0a10.6 10.6 0 1 0 -21.1 0ZM63.3 39.4a6.5 6.5 0 1 0 13.1 0a6.5 6.5 0 1 0 -13.1 0ZM64.9 45.6a10.8 10.8 0 1 0 21.6 0a10.8 10.8 0 1 0 -21.6 0ZM77.2 50.1a9.8 9.8 0 1 0 19.5 0a9.8 9.8 0 1 0 -19.5 0ZM85.8 44.7a6 6 0 1 0 12.1 0a6 6 0 1 0 -12.1 0ZM86.6 45a10.6 10.6 0 1 0 21.3 0a10.6 10.6 0 1 0 -21.3 0ZM96 39.1a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0 -13.2 0ZM98.9 41.5a9.5 9.5 0 1 0 19.1 0a9.5 9.5 0 1 0 -19.1 0ZM108.2 43.6a10.3 10.3 0 1 0 20.5 0a10.3 10.3 0 1 0 -20.5 0ZM120.4 55.3a8.8 8.8 0 1 0 17.6 0a8.8 8.8 0 1 0 -17.6 0ZM129.5 61.9a8.9 8.9 0 1 0 17.8 0a8.9 8.9 0 1 0 -17.8 0ZM137.4 57a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0ZM139.2 61a8.5 8.5 0 1 0 17.1 0a8.5 8.5 0 1 0 -17.1 0ZM146.8 56.3a5.3 5.3 0 1 0 10.6 0a5.3 5.3 0 1 0 -10.6 0ZM148.2 57.4a8.5 8.5 0 1 0 17.1 0a8.5 8.5 0 1 0 -17.1 0ZM155.7 52.7a5.3 5.3 0 1 0 10.6 0a5.3 5.3 0 1 0 -10.6 0ZM157.5 61.5a8.2 8.2 0 1 0 16.5 0a8.2 8.2 0 1 0 -16.5 0ZM167 60.6a7.4 7.4 0 1 0 14.7 0a7.4 7.4 0 1 0 -14.7 0ZM173.5 56.6a4.6 4.6 0 1 0 9.1 0a4.6 4.6 0 1 0 -9.1 0ZM174.4 62a7.7 7.7 0 1 0 15.5 0a7.7 7.7 0 1 0 -15.5 0ZM181.2 57.8a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0 -9.6 0ZM182.4 61.1a7.8 7.8 0 1 0 15.7 0a7.8 7.8 0 1 0 -15.7 0ZM189.3 56.8a4.9 4.9 0 1 0 9.7 0a4.9 4.9 0 1 0 -9.7 0ZM188.3 54.4a10.1 10.1 0 1 0 20.3 0a10.1 10.1 0 1 0 -20.3 0ZM197.3 48.8a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0 -12.6 0ZM200.3 53.7a8.8 8.8 0 1 0 17.7 0a8.8 8.8 0 1 0 -17.7 0ZM208.8 59.2a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0ZM217.3 54a5.9 5.9 0 1 0 11.9 0a5.9 5.9 0 1 0 -11.9 0ZM220.1 63.6a8.4 8.4 0 1 0 16.8 0a8.4 8.4 0 1 0 -16.8 0ZM227.5 58.9a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0 -10.4 0ZM228.4 64.5a9 9 0 1 0 18 0a9 9 0 1 0 -18 0ZM236.3 59.6a5.6 5.6 0 1 0 11.1 0a5.6 5.6 0 1 0 -11.1 0ZM239 64.5a7.8 7.8 0 1 0 15.6 0a7.8 7.8 0 1 0 -15.6 0ZM245.8 60.2a4.8 4.8 0 1 0 9.7 0a4.8 4.8 0 1 0 -9.7 0ZM247.7 69.5a7.2 7.2 0 1 0 14.5 0a7.2 7.2 0 1 0 -14.5 0ZM254.1 65.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM253.8 72.8a8.8 8.8 0 1 0 17.6 0a8.8 8.8 0 1 0 -17.6 0ZM264.5 77.6a7.3 7.3 0 1 0 14.6 0a7.3 7.3 0 1 0 -14.6 0ZM272.4 76.3a7 7 0 1 0 14 0a7 7 0 1 0 -14 0ZM278.7 76.5a8.1 8.1 0 1 0 16.3 0a8.1 8.1 0 1 0 -16.3 0ZM285.8 72a5 5 0 1 0 10.1 0a5 5 0 1 0 -10.1 0ZM288.8 75.3a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0ZM296.4 76.1a5.8 5.8 0 1 0 11.5 0a5.8 5.8 0 1 0 -11.5 0ZM300.9 80.9a7.4 7.4 0 1 0 14.8 0a7.4 7.4 0 1 0 -14.8 0ZM308.7 81.8a7.3 7.3 0 1 0 14.6 0a7.3 7.3 0 1 0 -14.6 0ZM316.9 83.4a6.7 6.7 0 1 0 13.5 0a6.7 6.7 0 1 0 -13.5 0ZM324.3 81.1a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0ZM330.7 82.8a6.7 6.7 0 1 0 13.4 0a6.7 6.7 0 1 0 -13.4 0ZM338.4 83a6.1 6.1 0 1 0 12.3 0a6.1 6.1 0 1 0 -12.3 0ZM345.9 86.1a5.1 5.1 0 1 0 10.2 0a5.1 5.1 0 1 0 -10.2 0ZM350.4 86.3a5.9 5.9 0 1 0 11.8 0a5.9 5.9 0 1 0 -11.8 0ZM356.5 91.1a5.9 5.9 0 1 0 11.9 0a5.9 5.9 0 1 0 -11.9 0ZM362 89.9a6.8 6.8 0 1 0 13.5 0a6.8 6.8 0 1 0 -13.5 0ZM369.3 91.5a6.6 6.6 0 1 0 13.1 0a6.6 6.6 0 1 0 -13.1 0ZM377.9 91.3a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0 -9.6 0ZM382.3 91.8a5.5 5.5 0 1 0 10.9 0a5.5 5.5 0 1 0 -10.9 0ZM387.9 92.5a5.6 5.6 0 1 0 11.1 0a5.6 5.6 0 1 0 -11.1 0ZM393.4 92.5a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM401.1 96.6a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM405.1 94.3a5.3 5.3 0 1 0 10.7 0a5.3 5.3 0 1 0 -10.7 0ZM410.7 96.5a5.2 5.2 0 1 0 10.5 0a5.2 5.2 0 1 0 -10.5 0ZM415.4 95.4a6.1 6.1 0 1 0 12.3 0a6.1 6.1 0 1 0 -12.3 0ZM422.3 96.1a5.6 5.6 0 1 0 11.2 0a5.6 5.6 0 1 0 -11.2 0ZM428.9 97.1a5 5 0 1 0 10 0a5 5 0 1 0 -10 0ZM434.3 96.5a4.8 4.8 0 1 0 9.5 0a4.8 4.8 0 1 0 -9.5 0ZM440.2 97.5a3.8 3.8 0 1 0 7.7 0a3.8 3.8 0 1 0 -7.7 0ZM442.5 97.8a5.6 5.6 0 1 0 11.2 0a5.6 5.6 0 1 0 -11.2 0ZM448.5 97.8a5.5 5.5 0 1 0 10.9 0a5.5 5.5 0 1 0 -10.9 0ZM14.2 45.7L17.8 45.7L16.9 23L15.1 23ZM16 28L-1.1 21.5L0 23.4L15.4 30ZM16.6 30L32 23.4L33.1 21.5L16 28ZM-8.1 18.5a5.1 5.1 0 1 0 10.1 0a5.1 5.1 0 1 0 -10.1 0ZM-1.8 14.2a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0ZM4.6 11.6a7.6 7.6 0 1 0 15.3 0a7.6 7.6 0 1 0 -15.3 0ZM11.8 11.6a8 8 0 1 0 16 0a8 8 0 1 0 -16 0ZM20.5 13.6a6.9 6.9 0 1 0 13.8 0a6.9 6.9 0 1 0 -13.8 0ZM29.6 17.6a5.4 5.4 0 1 0 10.8 0a5.4 5.4 0 1 0 -10.8 0ZM126.2 57.3L129.8 57.3L128.9 29L127.1 29ZM128 34L112.7 27.5L113.7 29.4L127.4 36ZM128.6 36L142.3 29.4L143.3 27.5L128 34ZM105.6 24.4a5.4 5.4 0 1 0 10.8 0a5.4 5.4 0 1 0 -10.8 0ZM111.8 21.5a6 6 0 1 0 12 0a6 6 0 1 0 -12 0ZM117.4 19.5a7.2 7.2 0 1 0 14.5 0a7.2 7.2 0 1 0 -14.5 0ZM124 19.1a7.4 7.4 0 1 0 14.8 0a7.4 7.4 0 1 0 -14.8 0ZM132.2 21.4a6 6 0 1 0 12.1 0a6 6 0 1 0 -12.1 0ZM140.1 25a4.9 4.9 0 1 0 9.8 0a4.9 4.9 0 1 0 -9.8 0ZM260.2 75.4L263.8 75.4L262.9 45L261.1 45ZM262 50L248.5 43.5L249.4 45.4L261.4 52ZM262.6 52L274.6 45.4L275.5 43.5L262 50ZM242.2 39.1a4.8 4.8 0 1 0 9.5 0a4.8 4.8 0 1 0 -9.5 0ZM247.7 37.2a5.3 5.3 0 1 0 10.5 0a5.3 5.3 0 1 0 -10.5 0ZM253.2 36.2a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0ZM258.4 35.3a6.6 6.6 0 1 0 13.1 0a6.6 6.6 0 1 0 -13.1 0ZM265.7 37.6a5.3 5.3 0 1 0 10.5 0a5.3 5.3 0 1 0 -10.5 0ZM273 40.1a4 4 0 1 0 8 0a4 4 0 1 0 -8 0ZM346.2 87.9L349.8 87.9L348.9 65L347.1 65ZM348 70L338.1 63.5L338.8 65.4L347.4 72ZM348.6 72L357.2 65.4L357.9 63.5L348 70ZM333.2 60.4a3.8 3.8 0 1 0 7.6 0a3.8 3.8 0 1 0 -7.6 0ZM337.1 58.9a4.3 4.3 0 1 0 8.7 0a4.3 4.3 0 1 0 -8.7 0ZM341.4 57.4a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0ZM345.5 56.6a4.7 4.7 0 1 0 9.3 0a4.7 4.7 0 1 0 -9.3 0ZM350.7 58.9a3.9 3.9 0 1 0 7.7 0a3.9 3.9 0 1 0 -7.7 0ZM356 59.7a3 3 0 1 0 6.1 0a3 3 0 1 0 -6.1 0ZM54.1 83.9L54.3 71.2L55.3 58.5L57 45.9L59.4 33.2L62.6 20.5L66.5 7.9L64.2 7.9L60 20.5L56.5 33.2L53.7 45.9L51.7 58.5L50.4 71.2L49.9 83.9ZM65.4 7.6L61 5.8L56.1 5.4L51.3 6.8L46.9 9.9L43.2 14.3L39.3 18.9L39.6 19.1L44 15.3L48.6 12.5L52.9 10.5L57 9L61.1 8.1L65.4 8ZM65.5 7.7L63.2 4.3L60.4 1.6L57.1 0.2L53.5 0.2L50.1 1.5L47.1 2.6L47.2 3L50.2 2.8L53.2 3.3L56 4.1L58.9 5L62 6.3L65.3 7.9ZM65.6 7.8L65.8 4.5L65.6 1.6L64.6 -0.7L62.8 -2.4L60.6 -3.4L58.9 -4.4L58.6 -4.2L59.5 -2.6L60.2 -0.8L61.1 1.2L62.3 3.3L63.7 5.5L65.3 7.9ZM65.6 7.9L67.5 5.7L69 3.6L69.6 1.5L69.4 -0.5L68.6 -2.6L68.4 -4.4L68 -4.5L67.3 -3L66.4 -1.3L65.7 0.7L65.3 2.9L65.2 5.3L65.3 7.8ZM65.6 8L68.9 6.4L71.7 5L73.9 3.5L75.5 1.7L77 -0.3L79 -1.5L78.9 -1.9L76.6 -1.6L74.1 -1L71.6 0.3L69.3 2.2L67.2 4.8L65.3 7.8ZM65.5 8.1L69.9 8.3L73.8 8.9L77.5 9.4L81.4 9.8L86 10.6L90.5 12.8L90.7 12.6L86.6 9.5L82.5 7L78.2 5.5L73.8 5.2L69.5 6L65.3 7.8ZM65.3 7.6L61.3 7.8L57.1 9.7L53.5 13.2L50.7 18.3L48.6 24.5L46 31.2L46.3 31.4L49.7 25.1L53.3 19.9L56.6 15.8L59.6 12.4L62.5 9.8L65.4 7.9ZM65.3 8.1L68 10.7L70.5 13.5L73.4 16.7L77.2 20.5L81.7 25.1L85.7 31.2L86 31.1L82.8 24.5L79.7 18.7L76.4 14.1L72.8 10.7L69.1 8.6L65.4 7.8ZM63.1 9.1a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0ZM91.8 81.8L91.4 71.8L90.7 61.8L89.4 51.8L87.7 41.8L85.6 31.8L83.1 21.8L81.1 21.8L83.4 31.8L85.2 41.8L86.6 51.8L87.6 61.8L88.1 71.8L88.2 81.8ZM82.1 21.5L78.3 20L74.2 19.6L70 20.8L66.2 23.5L63.1 27.2L59.7 31.2L60 31.4L63.8 28.1L67.7 25.7L71.4 24L74.9 22.8L78.4 22L82.1 21.8ZM82.2 21.6L80.3 18.6L77.8 16.4L75 15.2L71.9 15.2L69 16.2L66.4 17.2L66.5 17.6L69.1 17.4L71.6 17.8L74 18.5L76.5 19.3L79.2 20.4L82 21.8ZM82.3 21.7L82.5 18.9L82.3 16.4L81.5 14.4L79.9 12.9L78 12.1L76.5 11.2L76.3 11.5L77.1 12.8L77.7 14.4L78.4 16.1L79.4 17.8L80.6 19.7L82 21.8ZM82.3 21.8L84 19.9L85.2 18.1L85.8 16.3L85.6 14.6L84.9 12.8L84.7 11.2L84.3 11.1L83.7 12.5L83 13.9L82.4 15.6L82 17.5L81.9 19.5L82 21.7ZM82.3 21.9L85.1 20.5L87.6 19.3L89.4 18.1L90.8 16.5L92 14.8L93.8 13.7L93.7 13.4L91.7 13.7L89.5 14.2L87.4 15.2L85.4 16.9L83.6 19.1L82 21.7ZM82.2 22L86 22.1L89.3 22.7L92.5 23.1L95.8 23.5L99.7 24.1L103.6 26.1L103.8 25.8L100.3 23.1L96.8 21L93.1 19.7L89.3 19.4L85.6 20.1L82 21.7ZM82 21.5L78.6 21.7L75 23.3L71.9 26.3L69.5 30.7L67.6 36L65.4 41.8L65.7 41.9L68.6 36.5L71.7 32.1L74.6 28.5L77.2 25.7L79.6 23.4L82.1 21.8ZM82 22L84.3 24.2L86.4 26.6L89 29.4L92.2 32.6L96 36.6L99.5 41.8L99.8 41.7L97 36L94.4 31.1L91.6 27.1L88.5 24.2L85.3 22.4L82.1 21.7ZM80.1 23a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM177.9 86.8L178 76.2L178.4 65.5L179.2 54.8L180.5 44.2L182.1 33.5L184.1 22.8L182 22.8L179.7 33.5L177.8 44.2L176.3 54.8L175.2 65.5L174.4 76.2L174.1 86.8ZM183.1 22.6L179.1 20.9L174.7 20.6L170.3 21.9L166.3 24.6L163 28.6L159.5 32.8L159.7 33L163.7 29.5L167.8 27L171.7 25.2L175.4 23.9L179.2 23.1L183 22.9ZM183.2 22.6L181.1 19.5L178.6 17.2L175.5 15.9L172.3 15.9L169.3 17L166.5 18.1L166.6 18.4L169.3 18.2L172 18.7L174.6 19.4L177.2 20.3L180 21.4L183 22.9ZM183.3 22.7L183.5 19.8L183.3 17.2L182.4 15L180.8 13.5L178.7 12.6L177.2 11.7L176.9 11.9L177.7 13.3L178.4 15L179.2 16.8L180.2 18.7L181.5 20.7L183 22.9ZM183.3 22.9L185 20.9L186.3 19L186.9 17.1L186.7 15.2L186 13.3L185.8 11.7L185.4 11.6L184.8 13L184 14.6L183.4 16.3L183 18.3L182.9 20.5L183 22.8ZM183.2 23L186.3 21.5L188.8 20.2L190.7 18.9L192.2 17.3L193.6 15.4L195.4 14.3L195.3 14L193.2 14.3L190.9 14.8L188.6 15.9L186.5 17.7L184.7 20L183 22.8ZM183.1 23.1L187.2 23.2L190.7 23.8L194 24.2L197.6 24.6L201.7 25.3L205.8 27.3L206 27.1L202.3 24.3L198.6 22L194.7 20.7L190.7 20.4L186.7 21.1L183 22.7ZM183 22.6L179.3 22.7L175.6 24.4L172.3 27.7L169.7 32.2L167.8 37.8L165.5 43.9L165.8 44.1L168.9 38.4L172.1 33.8L175.1 30L177.8 26.9L180.4 24.6L183.1 22.9ZM183 23.1L185.4 25.4L187.6 28L190.3 30.9L193.7 34.2L197.8 38.4L201.4 44L201.7 43.8L198.8 37.8L196 32.6L193 28.4L189.8 25.4L186.4 23.5L183.1 22.7ZM180.9 24a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM219.6 85L219.4 77L218.9 69L218.2 61L217.3 53L216.1 45L214.7 37L212.9 37L214 45L215 53L215.7 61L216.1 69L216.4 77L216.4 85ZM213.8 36.7L210.4 35.3L206.6 35L202.7 36.1L199.3 38.5L196.4 41.9L193.4 45.5L193.7 45.8L197.1 42.8L200.7 40.6L204 39L207.2 37.9L210.4 37.2L213.8 37.1ZM213.9 36.8L212.1 34.1L209.9 32.1L207.3 31L204.5 31L201.9 31.9L199.5 32.8L199.6 33.2L201.9 33L204.2 33.4L206.5 34L208.7 34.8L211.1 35.8L213.7 37ZM214 36.9L214.2 34.4L214 32.1L213.2 30.2L211.8 28.9L210.1 28.2L208.7 27.4L208.5 27.6L209.2 28.8L209.8 30.3L210.4 31.8L211.3 33.4L212.5 35.1L213.7 37ZM214 37L215.5 35.3L216.6 33.7L217.1 32L217 30.4L216.3 28.8L216.2 27.4L215.8 27.3L215.3 28.5L214.6 29.8L214 31.4L213.7 33.1L213.6 34.9L213.7 37ZM214 37.1L216.6 35.8L218.8 34.8L220.4 33.6L221.7 32.2L222.9 30.6L224.4 29.7L224.4 29.4L222.5 29.6L220.5 30L218.6 31L216.8 32.6L215.2 34.6L213.7 36.9ZM213.9 37.2L217.4 37.4L220.4 37.8L223.2 38.2L226.3 38.6L229.8 39.2L233.4 40.9L233.6 40.7L230.4 38.2L227.2 36.3L223.8 35.1L220.4 34.9L217 35.5L213.7 36.9ZM213.7 36.7L210.6 36.9L207.3 38.3L204.5 41.1L202.3 45.1L200.6 49.9L198.6 55.2L198.9 55.3L201.5 50.4L204.3 46.4L206.9 43.2L209.3 40.5L211.5 38.5L213.8 37.1ZM213.7 37.2L215.8 39.2L217.7 41.5L220 43.9L223 46.9L226.4 50.5L229.6 55.3L229.9 55.1L227.4 49.9L225 45.4L222.4 41.8L219.6 39.2L216.7 37.5L213.8 36.9ZM212 38.2a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0ZM307.4 92.4L307.4 85.8L307.6 79.1L308 72.4L308.6 65.8L309.3 59.1L310.3 52.4L308.7 52.4L307.5 59.1L306.6 65.8L305.8 72.4L305.2 79.1L304.8 85.8L304.6 92.4ZM309.6 52.2L306.5 51L303.2 50.7L299.8 51.7L296.8 53.8L294.3 56.8L291.6 59.9L291.9 60.2L294.9 57.5L298 55.6L300.9 54.3L303.8 53.3L306.6 52.7L309.5 52.5ZM309.7 52.2L308.1 49.9L306.2 48.1L303.8 47.1L301.4 47.1L299.1 48L297 48.8L297.1 49.1L299.1 49L301.1 49.3L303.1 49.9L305.1 50.5L307.2 51.4L309.5 52.5ZM309.8 52.4L309.9 50.1L309.8 48.1L309.1 46.5L307.9 45.4L306.3 44.7L305.1 44L304.9 44.2L305.5 45.3L306 46.5L306.6 47.9L307.4 49.3L308.3 50.8L309.4 52.5ZM309.8 52.5L311.1 51L312.1 49.5L312.5 48.1L312.4 46.7L311.8 45.3L311.6 44L311.3 43.9L310.8 45L310.2 46.2L309.7 47.5L309.5 49L309.4 50.7L309.4 52.4ZM309.7 52.6L312 51.5L313.9 50.5L315.4 49.5L316.5 48.3L317.5 46.9L318.9 46.1L318.8 45.7L317.2 45.9L315.5 46.3L313.7 47.2L312.2 48.6L310.7 50.3L309.5 52.4ZM309.6 52.7L312.7 52.8L315.3 53.2L317.8 53.6L320.5 53.9L323.6 54.4L326.7 55.9L326.9 55.7L324.1 53.5L321.3 51.8L318.3 50.8L315.3 50.6L312.3 51.1L309.5 52.4ZM309.5 52.2L306.7 52.3L303.8 53.6L301.3 56.1L299.4 59.5L297.9 63.8L296.1 68.4L296.4 68.6L298.8 64.3L301.2 60.7L303.5 57.9L305.6 55.6L307.6 53.8L309.5 52.5ZM309.5 52.7L311.3 54.4L313 56.4L315 58.6L317.6 61.1L320.6 64.3L323.4 68.5L323.7 68.4L321.5 63.8L319.4 59.9L317.1 56.7L314.7 54.4L312.1 52.9L309.5 52.4ZM307.9 53.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0ZM399.1 97.8L399.1 93.8L399.1 89.8L399.2 85.8L399.5 81.8L399.8 77.8L400.2 73.8L399 73.8L398.4 77.8L397.9 81.8L397.5 85.8L397.2 89.8L397 93.8L396.9 97.8ZM399.6 73.5L397.3 72.6L394.7 72.4L392.2 73.1L389.9 74.7L387.9 77L385.9 79.5L386.1 79.7L388.4 77.7L390.8 76.2L393 75.2L395.2 74.4L397.3 74L399.6 73.9ZM399.7 73.6L398.5 71.8L397 70.4L395.3 69.6L393.4 69.6L391.6 70.3L390 70.9L390.1 71.2L391.7 71.1L393.2 71.4L394.7 71.8L396.2 72.3L397.8 73L399.5 73.8ZM399.8 73.7L399.9 72L399.8 70.4L399.3 69.2L398.4 68.3L397.2 67.8L396.3 67.3L396 67.5L396.5 68.3L396.9 69.3L397.3 70.3L397.9 71.4L398.7 72.5L399.5 73.8ZM399.8 73.8L400.8 72.6L401.6 71.6L401.9 70.5L401.8 69.4L401.4 68.3L401.3 67.4L400.9 67.3L400.6 68.1L400.1 69L399.7 70L399.5 71.1L399.5 72.4L399.5 73.8ZM399.8 73.9L401.5 73.1L403 72.3L404.1 71.6L404.9 70.7L405.7 69.6L406.7 69L406.7 68.6L405.4 68.8L404.1 69.1L402.8 69.8L401.6 70.8L400.5 72.1L399.5 73.7ZM399.7 74L402 74.1L404 74.4L405.9 74.7L407.9 74.9L410.3 75.3L412.7 76.5L412.9 76.2L410.7 74.6L408.6 73.3L406.3 72.5L404 72.3L401.7 72.7L399.6 73.7ZM399.5 73.5L397.4 73.6L395.2 74.6L393.3 76.5L391.8 79.1L390.7 82.4L389.3 85.9L389.6 86.1L391.4 82.8L393.3 80.1L395 77.9L396.6 76.2L398.1 74.8L399.6 73.9ZM399.5 74L400.9 75.3L402.2 76.8L403.7 78.5L405.7 80.4L408 82.9L410.1 86.1L410.4 85.9L408.7 82.4L407.1 79.4L405.4 77L403.5 75.2L401.5 74.1L399.6 73.7ZM398.4 75a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0Z',
  forestReflect: 'M0 100L0 111.7L6 112.5L12 113.1L18 113L24 111.9L30 110.1L36 108.2L42 107.2L48 107.4L54 108.9L60 110.8L66 112.3L72 112.7L78 111.9L84 110.6L90 109.5L96 109.2L102 109.8L108 110.9L114 111.8L120 112L126 111.1L132 109.7L138 108.2L144 107.2L150 106.7L156 106.6L162 106.9L168 107.4L174 108L180 108.5L186 108.9L192 109L198 108.8L204 108.3L210 107.6L216 107.2L222 107.2L228 107.7L234 108.3L240 108.5L246 108.1L252 106.9L258 105.2L264 103.6L270 102.8L276 102.9L282 103.7L288 104.8L294 105.5L300 105.4L306 104.4L312 103.1L318 102L324 101.5L330 101.7L336 102.4L342 103.2L348 103.7L354 103.5L360 102.6L366 101.4L372 100.3L378 99.5L384 99.3L390 99.7L396 100.4L402 101.1L408 101.5L414 101.3L420 100.5L426 99.5L432 98.6L438 98.1L444 98.3L450 98.9L456 99.7L460 100Z',
  /** Vagues du pied de page : repère 1200 × 100 étiré sur toute la largeur. */
  wavesViewBox: [1200, 100],
  waves: [
    'M0 100V88C230 93 430 88 650 70S1010 30 1200 16V100Z',
    'M360 100C620 97 860 76 1010 57S1150 34 1200 29V100Z',
    'M560 100C800 98 985 87 1095 70S1172 53 1200 48V100Z'
  ],
  wavesLine: 'M420 97C690 90 905 64 1200 25',
  /** Trait de pinceau (« vague » sous les titres) : repère 120 × 20. */
  swoosh: 'M1.2 15.6C25 4.6 63 .4 119 5.6 84 5.8 52 9.6 4.4 18.8 2.3 19.2.4 17.2 1.2 15.6Z'
};

const H = v => (v instanceof SafeHTML || Array.isArray(v) ? v : raw(v ?? ''));
const themeName = t => (t && THEMES[t] ? t : '');
/** Attributs de thème (classe + variables) d'un composant ; '' si pas de thème explicite (hérité). */
function themed(theme, base, cls = '') {
  const t = themeName(theme);
  return raw(`class="${[base, t ? 'th-' + t : '', cls].filter(Boolean).join(' ').replace(/"/g, '')}"${t ? ` style="${themeVars(t)}"` : ''}`);
}
/* Trait de pinceau : <span> coloré par background-color et découpé par un masque CSS (css/sheet.css, même tracé
 * que DECOR.swoosh). Un <svg> en ligne à cet endroit déclenche un défaut d'impression de Chromium (bloc étiré
 * jusqu'au bas de la page) ; le masque CSS s'imprime correctement. */
const swoosh = (cls = '') => raw(`<span class="swoosh ${cls}" aria-hidden="true"></span>`);
const cssURL = u => String(u).replace(/["\\\n\r]/g, c => encodeURIComponent(c));
const fmtCoord = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : String(Math.round(Number(v))));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '\'').trim();

/** Position WGS84 d'une station (lat/lon, sinon déduite de X/Y RGFG95 / UTM 22N). */
export function siteLatLon(site) {
  if (!site) return null;
  if (isFinite(site.lat) && isFinite(site.lon) && site.lat !== null && site.lon !== null) return [Number(site.lat), Number(site.lon)];
  if (isFinite(site.x) && isFinite(site.y) && site.x !== null && site.y !== null && site.x !== '') {
    try { return utmToLatLon(Number(site.x), Number(site.y), 22); } catch (e) { return null; }
  }
  return null;
}

/* ---------- Conteneur de feuille ---------- */
/** <section class="sheet th-<thème>"> : pose les variables de couleur du thème pour tout son contenu. */
export function sheetFrame({ theme = 'ocean', cls = '', body = '' } = {}) {
  const t = themeName(theme) || 'ocean';
  return html`<section class="sheet th-${t}${cls ? ' ' + cls : ''}" style="${themeVars(t)}" data-theme="${t}">${H(body)}</section>`;
}

/* ---------- En-tête OEG ---------- */
const present = v => v !== null && v !== undefined && v !== '';
/** En-tête de feuille : logo rond, titres de grid.header, slogan, pavé « Station NOM · Feuille n / N »,
 * titre de la feuille.
 * - title / subtitle : titre et sous-titre RÉSOLUS (ex. headerTitle(grid, { provider, auditType, campaign }) →
 *   « Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026 ») ; à défaut grid.header.title / subtitle
 *   (un modèle contenant encore « {prestataire} » ou « {programme} » n'est pas affiché).
 * - index / total : numéro AFFICHÉ de la feuille (rang parmi les feuilles visibles, à partir de 1) et
 *   nombre de feuilles ; à défaut sheet.index / sheet.total (instances de sheetsOf), puis sheet.no / sheetCount.
 * - stationIndex / stationTotal : rang de la station dans la tournée (« Station 2 / 3 »), si plus d'une.
 * - variant : 'default' (en-tête clair des maquettes), 'band' (bandeau bleu de la feuille 2, titre de la
 *   feuille sous le bandeau), 'compact' (une ligne : mobile, barre d'onglets). */
export function oegHeader({ grid = null, sheet = null, site = null, sheetCount = 9, variant = 'default', title = '', subtitle = '',
  index = null, total = null, stationIndex = null, stationTotal = null } = {}) {
  const h = { ...DEFAULT_HEADER, ...(grid?.header || {}) };
  const tpl = s => /\{[^}]*\}/.test(String(s || ''));
  const mainTitle = title || (tpl(h.title) ? '' : h.title);
  const subTitle = subtitle || (tpl(h.subtitle) ? '' : h.subtitle);
  const no = present(index) ? index : present(sheet?.index) ? sheet.index : (sheet?.no ?? '');
  const count = present(total) ? total : present(sheet?.total) ? sheet.total : sheetCount;
  const name = site?.name || '';
  const isStation = sheet?.layout === 'station';
  const sheetTitle = sheet?.title && !isStation ? sheet.title : '';
  const kicker = sheet?.kicker && sheetTitle && !norm(sheet.kicker).includes(norm(sheetTitle)) && !norm(sheetTitle).includes(norm(sheet.kicker)) ? sheet.kicker : '';
  const tour = present(stationIndex) && Number(stationTotal) > 1 ? html`<span class="oh-st-tour">${icon('route', { size: 14 })}Station ${stationIndex}&nbsp;/&nbsp;${stationTotal}</span>` : '';
  const sheetNo = no !== '' ? html`Feuille <b>${no}&nbsp;/&nbsp;${count}</b>` : '';
  // Logo choisi en Administration (proportions conservées) ou logo rond de l'OEG.
  const logo = logoImg({ cls: 'oh-logo', alt: h.org || 'Office de l’Eau de Guyane', width: 96, height: 96 });
  if (variant === 'compact') {
    return html`<header class="oeg-header compact">
      ${logo}
      <div class="oh-c-main">
        <div class="oh-c-org"><span class="oh-c-oeg">${h.org}</span>${mainTitle ? html`<span class="oh-c-prog"> · ${mainTitle}</span>` : ''}</div>
        <div class="oh-c-title">${sheet?.title || subTitle}</div>
      </div>
      ${name ? html`<div class="oh-c-station"><span>${present(stationIndex) && Number(stationTotal) > 1 ? `Station ${stationIndex} / ${stationTotal}` : 'Station'}</span><b>${name}</b></div>` : ''}
      ${sheetNo ? html`<div class="oh-c-sheet">${sheetNo}</div>` : ''}
    </header>`;
  }
  const band = variant === 'band';
  const titleBlock = sheetTitle ? html`<div class="oh-sheet-title${band ? ' is-after' : ''}"><h2>${sheetTitle}</h2>${kicker ? html`<span class="oh-kicker">${swoosh('oh-kicker-swoosh')}${kicker}</span>` : ''}</div>` : '';
  return html`<header class="oeg-header${band ? ' band' : ''}${isStation ? ' is-station' : ''}${name && !isStation ? ' has-station' : ''}">
    ${logo}
    <div class="oh-titles">
      <div class="oh-org">${h.org}</div>
      ${mainTitle ? html`<div class="oh-title">${mainTitle}</div>` : ''}
      ${subTitle ? html`<div class="oh-sub">${subTitle}</div>` : ''}
    </div>
    ${h.tagline ? html`<div class="oh-tagline"><span>${h.tagline}</span>${swoosh('oh-tag-swoosh')}</div>` : ''}
    ${name && !isStation ? html`<div class="oh-station">
      ${tour}<span class="oh-st-k">Station</span><span class="oh-st-name">${name}</span>${swoosh('oh-st-swoosh')}
      ${sheetNo ? html`<span class="oh-st-sheet">${sheetNo}</span>` : ''}
    </div>` : ''}
    ${band ? '' : titleBlock}
  </header>${band ? titleBlock : ''}`;
}

/* ---------- Bandeau station ---------- */
/** Grand bandeau « Station / NOM » + surtitre + silhouette de la Guyane + photo fondue à droite.
 * Options supplémentaires : sheetNo / sheetCount (pastille « Feuille n / N », numéro affiché), tagline,
 * stationIndex / stationTotal (« Station 2 / 3 » d'une tournée, si plus d'une station). */
export function stationBanner({ site, kicker = '', theme = 'ocean', photo = null, sheetNo = null, sheetCount = 9, tagline = 'Des rivières vivantes pour demain',
  stationIndex = null, stationTotal = null, networks = [] } = {}) {
  const name = site?.name || 'Station';
  const tour = present(stationIndex) && Number(stationTotal) > 1;
  // Réseaux de surveillance (feuille 1 seulement) : ligne à part sous « Station », qui passe à la ligne (téléphone).
  const nets = (networks || []).filter(n => n?.code);
  return html`<div ${themed(theme, 'station-banner', [photo ? 'has-photo' : '', sheetNo ? 'has-sheet' : ''].filter(Boolean).join(' '))}>
    ${photo ? html`<div class="sb-photo" style="background-image:url(&quot;${cssURL(photo)}&quot;)" role="img" aria-label="Photographie de la station ${name}"></div>` : ''}
    <div class="sb-text">
      <span class="sb-k">Station${tour ? html`<span class="sb-tour">${icon('route', { size: 16 })}${stationIndex}&nbsp;/&nbsp;${stationTotal}</span>` : ''}</span>
      ${nets.length ? html`<span class="sb-nets" role="list" aria-label="Réseaux de surveillance">${nets.map(n => html`<span class="sb-net" role="listitem" style="--net-dark:${networkColors(n).dark}" title="${n.label && n.label !== n.code ? `${n.code} – ${n.label}` : n.code}">${n.code}</span>`)}</span>` : ''}
      <span class="sb-name">${name}</span>
      ${swoosh('sb-swoosh')}
      ${kicker ? html`<span class="sb-kicker">${kicker}</span>` : ''}
    </div>
    <div class="sb-map">${guyaneInset(site, { size: 110 })}</div>
    ${tagline ? html`<div class="sb-tag"><span>${tagline}</span>${swoosh('sb-tag-swoosh')}</div>` : ''}
    ${sheetNo ? html`<div class="sb-sheet"><span>Feuille</span><b>${sheetNo}&nbsp;/&nbsp;${sheetCount}</b></div>` : ''}
  </div>`;
}

/* ---------- Bandeau d'information ---------- */
/** Code SANDRE / Bassin versant / Coordonnées théoriques RGFG95 (X, Y).
 * Point d'eau souterraine (site.codeType === 'BSS', ou option codeType) : « Code BSS » et, si la station
 * n'a pas de bassin versant, « Commune » à la place. */
export function infoStrip(site, { theme, codeType = '' } = {}) {
  const s = site || {};
  const bss = String(codeType || s.codeType || '').toUpperCase() === 'BSS';
  const bassin = s.bassin || s.bv || '';
  const code = String(s.code || '');
  const second = bss && !bassin
    ? html`<div class="is-cell is-commune"><span class="is-ic">${icon('map')}</span><div class="is-txt"><span class="is-k">Commune</span><span class="is-v">${s.commune || '—'}</span></div></div>`
    : html`<div class="is-cell"><span class="is-ic">${icon('basin')}</span><div class="is-txt"><span class="is-k">Bassin versant</span><span class="is-v">${bassin || '—'}</span></div></div>`;
  return html`<div ${themed(theme, 'info-strip', bss ? 'is-bss' : '')}>
    <div class="is-cell"><span class="is-ic">${icon('database')}</span><div class="is-txt"><span class="is-k">${bss ? 'Code BSS' : 'Code SANDRE'}</span><span class="is-v${code.length > 10 ? ' is-long' : ''}">${code || '—'}</span></div></div>
    ${second}
    <div class="is-cell is-coords"><span class="is-ic">${icon('pin')}</span><div class="is-txt"><span class="is-k">Coordonnées théoriques RGFG95</span>
      <span class="is-xy"><span>X&nbsp;:&nbsp;<b>${fmtCoord(s.x)}</b></span><span>Y&nbsp;:&nbsp;<b>${fmtCoord(s.y)}</b></span></span></div></div>
  </div>`;
}

/* ---------- Cartes et encadrés ---------- */
const icons = (name, size) => String(name || '').split('+').filter(Boolean).map(n => icon(n.trim(), { size }));

/**
 * Typographie française d'un titre : l'espace avant une ponctuation haute (« : », « ; », « ! », « ? », « » ») et
 * après « « » devient insécable, pour que la ponctuation ne parte jamais seule à la ligne (« … actions
 * demandées : »). Les titres déjà en HTML (SafeHTML) sont rendus tels quels.
 */
export const nbspPunct = s => (typeof s === 'string' ? s.replace(/[ \t]+([:;!?»])/g, '\u00A0$1').replace(/«[ \t]+/g, '«\u00A0') : s);

/** Carte de section : barre de titre avec pastille numérotée (ou pictogramme) puis corps.
 * Classes utiles (cls) : 'big' (grande pastille A / B de la feuille 8), 'plain' (sans fond de barre). */
export function sectionCard({ no = '', title = '', icon: ic = '', theme, kicker = '', right = '', body = '', cls = '', id = '' } = {}) {
  const pastille = no !== '' && no !== null && no !== undefined ? html`<span class="sec-no">${no}</span>` : ic ? html`<span class="sec-no is-icon">${icons(ic)}</span>` : '';
  return html`<section ${themed(theme, 'sec-card', cls)}${id ? raw(` id="${String(id).replace(/[^\w:.-]/g, '')}"`) : ''}>
    <header class="sec-head">
      ${pastille}
      <h3 class="sec-title"><span>${nbspPunct(title)}</span>${pastille && no !== '' && ic ? html`<span class="sec-title-ic">${icons(ic, 30)}</span>` : ''}</h3>
      ${kicker ? html`<span class="sec-kicker">${swoosh('sec-kicker-swoosh')}<span>${kicker}</span></span>` : ''}
      ${right ? html`<div class="sec-right">${H(right)}</div>` : ''}
    </header>
    <div class="sec-body">${H(body)}</div>
  </section>`;
}

/** Encadré (observations, remarques, conclusion, signature…) : pictogramme rond + titre + corps. */
export function blockCard({ icon: ic = 'chat', title = '', theme, body = '', cls = '' } = {}) {
  return html`<section ${themed(theme, 'block-card', cls)}>
    <header class="bc-head"><span class="bc-ic">${icons(ic)}</span><h3 class="bc-title">${nbspPunct(title)}</h3></header>
    <div class="bc-body">${H(body)}</div>
  </section>`;
}

/** Case carrée façon maquette (affichage). cls : 'ok' | 'p' | 'nc' | 'na' (couleur), 'lg' ; attrs : attributs HTML bruts. */
export function checkSquare({ checked = false, label = '', cls = '', attrs = '' } = {}) {
  const box = html`<span class="chk${checked ? ' on' : ''}${label ? '' : (cls ? ' ' + cls : '')}" role="img" aria-label="${checked ? 'Case cochée' : 'Case non cochée'}"${label ? '' : raw(attrs ? ' ' + attrs : '')}>${checked ? icon('check', { size: 16 }) : ''}</span>`;
  if (!label) return box;
  return html`<span class="chk-wrap${cls ? ' ' + cls : ''}"${raw(attrs ? ' ' + attrs : '')}>${box}<span class="chk-l">${label}</span></span>`;
}

/* ---------- Échelle C / P / NC / N/A (avenant n° 1) ---------- */
/** Colonnes de statut des tableaux de feuille, dans l'ordre d'affichage. cls = suffixe des classes CSS :
 * colonne .c-<cls>, bouton de carte .st-rc-btn.<cls>, case .chk.<cls>, ligne tr.is-<cls> / .st-row-card.is-<cls>. */
export const STATUS_SCALE = [
  { code: 'C', short: 'C', label: 'Conforme / satisfaisant', cls: 'c' },
  { code: 'P', short: 'P', label: 'Perfectible', cls: 'p' },
  { code: 'NC', short: 'NC', label: 'Non conforme', cls: 'nc' },
  { code: 'NA', short: 'N/A', label: 'Non applicable', cls: 'na' }
];
const scaleOf = codes => (codes || STATUS_SCALE.map(s => s.code)).map(c => STATUS_SCALE.find(s => s.code === c)).filter(Boolean);
/** Cellules d'en-tête « C | P | NC | N/A » (th.c-c, th.c-p, th.c-nc, th.c-na, infobulle = libellé complet). */
export function statusHeadCells(codes = null) {
  return scaleOf(codes).map(s => html`<th class="c-${s.cls}" scope="col" title="${s.label}"><abbr title="${s.label}">${s.short}</abbr></th>`);
}
/** Légende de l'échelle (sous un tableau ou dans une fiche vierge). */
export function statusLegend(codes = null) {
  return html`<p class="st-legend">${scaleOf(codes).map(s => html`<span class="st-lg st-lg-${s.cls}"><b>${s.short}</b>${s.label}</span>`)}</p>`;
}

/* ---------- Tournée ---------- */
/** Badge « Commun à la tournée » d'un critère partagé entre les stations (réponse unique). */
export function sharedBadge(label = 'Commun à la tournée') {
  return html`<span class="shared-badge" title="Réponse unique pour toutes les stations de la tournée">${icon('route', { size: 14 })}${label}</span>`;
}

/* ---------- Note sur 20 ---------- */
/** Badge « Majeur (×2) » d'un point majeur (compte double dans la note sur 20). */
export function majorBadge(label = 'Majeur (×2)') {
  return html`<span class="major-badge" title="Point majeur : compte double (× 2) dans la note sur 20">${icon('star', { size: 13 })}${label}</span>`;
}
/** Classe de couleur d'une appréciation (« lvl-good », « lvl-fair », « lvl-poor », « lvl-none »). */
export const gradeLevelClass = g => `lvl-${g?.level || 'none'}`;
/** Pastille de note des tableaux (« 15,6 », titre : appréciation) ; « non noté » en gris. */
export function gradePill(g, { label = false } = {}) {
  const graded = g && g.n10 !== null && g.n10 !== undefined;
  return html`<span class="grade-pill ${gradeLevelClass(g)}" title="${graded ? `${g.text} / 20 — ${g.label}` : 'Non noté : aucun point évalué'}">${graded ? html`<b>${g.text}</b>${label ? html`<small>${g.label}</small>` : ''}` : 'non noté'}</span>`;
}
/**
 * Encadré « Grille de notation » (pied de feuille, synthèse) : cotes C / P / NC / N/A, points évalués (dont points
 * majeurs ×2), points pondérés obtenus / évalués, note /20 et appréciation colorée, règle de calcul et seuils.
 * grade : note (gradeOf / resolveGrades) ; thresholds : seuils utilisés ; state : état de la note (GRADE_STATES :
 * figee, recalculee, calculee, provisoire) ; id : identifiant de l'encadré ; scope : portée lisible (« de la feuille »).
 */
export function gradeBox({ grade: g = null, thresholds = null, state = '', id = '', scope = 'de la feuille', theme, title = 'Grille de notation' } = {}) {
  const graded = g && g.n10 !== null && g.n10 !== undefined;
  const cell = (cls, k, v, sub = '') => html`<div class="gb-c ${cls}"><span class="gb-k">${k}</span><span class="gb-n">${v}</span>${sub ? html`<small>${sub}</small>` : ''}</div>`;
  const extra = [
    g?.excluded ? `${g.excluded} point${g.excluded > 1 ? 's' : ''} de synthèse coté${g.excluded > 1 ? 's' : ''} hors note` : '',
    g?.unanswered ? `${g.unanswered} point${g.unanswered > 1 ? 's' : ''} non renseigné${g.unanswered > 1 ? 's' : ''}${state === 'provisoire' ? ' : note provisoire' : ''}` : '',
    state && GRADE_STATES[state] && state !== 'provisoire' ? `Note ${GRADE_STATES[state]}` : ''
  ].filter(Boolean);
  return html`<section ${themed(theme, 'block-card', `grade-box ${gradeLevelClass(g)}`)} ${id ? raw(`id="${id}"`) : ''} data-grade="${graded ? g.text : 'non noté'}" aria-label="${title} ${scope}">
    <header class="bc-head"><span class="bc-ic">${icon('star')}</span><h3 class="bc-title">${title}</h3>${graded ? html`<span class="gb-head-note">${g.text}&nbsp;/&nbsp;20</span>` : ''}</header>
    <div class="bc-body">
      <div class="gb-cells">
        ${cell('gb-cc', 'C', g?.C ?? 0)}${cell('gb-cp', 'P', g?.P ?? 0)}${cell('gb-cnc', 'NC', g?.NC ?? 0)}${cell('gb-cna', 'N/A', g?.NA ?? 0)}
        ${cell('gb-ev', 'Évalués', g?.evaluated ?? 0, g?.majors ? `dont ${g.majors} majeur${g.majors > 1 ? 's' : ''} ×2` : '')}
        ${cell('gb-pts', 'Points', graded ? html`${frNumber(g.points)}<small>&nbsp;/&nbsp;${frNumber(g.max)}</small>` : '—')}
        <div class="gb-note"><span class="gb-k">Note /20</span><span class="gb-v">${graded ? g.text : 'non noté'}</span><span class="gb-lvl">${graded ? g.label : 'aucun point évalué'}</span></div>
      </div>
      <p class="gb-rule">C = 1 point · P = 0,5 · NC = 0 · N/A non compté · point majeur ×2 · point de synthèse hors note. Appréciation : ${thresholdsText(thresholds)}.</p>
      ${extra.length ? html`<p class="gb-extra">${extra.join(' · ')}.</p>` : ''}
    </div>
  </section>`;
}

/** Sélecteur des stations d'une tournée : pastilles numérotées « 1 ATHANASE » avec avancement.
 * stations : [{ key, name, code?, answered?, total?, nc?, p?, href? }] (ordre de passage) ; current : clé
 * de la station affichée ; act : data-act des pastilles sans href (data-key = clé) ; addAct / addLabel :
 * bouton d'ajout ; label : intitulé à gauche (texte) ; extra : HTML ajouté en fin de barre. */
export function tourStations({ stations = [], current = '', act = 'tour-station', addAct = '', addLabel = 'Ajouter une station', label = 'Tournée', extra = '', theme } = {}) {
  const pill = (s, i) => {
    const total = Number(s.total) || 0, answered = Math.min(total, Number(s.answered) || 0);
    const pc = total ? Math.round(answered * 100 / total) : 0;
    const cls = ['ts-pill', s.key === current ? 'is-current' : '', total && answered >= total ? 'is-done' : '', s.nc ? 'has-nc' : ''].filter(Boolean).join(' ');
    const inner = html`<span class="ts-no">${i + 1}</span>
      <span class="ts-txt"><span class="ts-name">${s.name || s.key}</span><span class="ts-meta">${s.code ? html`<span class="ts-code">${s.code}</span>` : ''}${total ? html`<span>${answered}&nbsp;/&nbsp;${total}</span>` : ''}${s.nc ? html`<span class="ts-flag nc" title="${s.nc} non-conformité(s)">${s.nc}&nbsp;NC</span>` : ''}${s.p ? html`<span class="ts-flag p" title="${s.p} point(s) perfectible(s)">${s.p}&nbsp;P</span>` : ''}</span></span>
      <span class="ts-bar" aria-hidden="true"><i style="width:${pc}%"></i></span>`;
    const aria = raw(`${s.key === current ? ' aria-current="true"' : ''} aria-label="${String(`Station ${i + 1} : ${s.name || s.key}${total ? ` — ${answered} sur ${total} points renseignés` : ''}`).replace(/"/g, '&quot;')}"`);
    return s.href ? html`<a class="${cls}" href="${s.href}"${aria}>${inner}</a>`
      : html`<button type="button" class="${cls}" data-act="${act}" data-key="${s.key}"${aria}>${inner}</button>`;
  };
  return html`<nav ${themed(theme, 'tour-stations')} aria-label="Stations de la tournée">
    ${label ? html`<span class="ts-label">${icon('route', { size: 20 })}<span>${label}<small>${stations.length} station${stations.length > 1 ? 's' : ''}</small></span></span>` : ''}
    <div class="ts-list">${stations.map(pill)}</div>
    ${addAct ? html`<button type="button" class="ts-add" data-act="${addAct}">${icon('plus', { size: 18 })}<span>${addLabel}</span></button>` : ''}
    ${extra ? H(extra) : ''}
  </nav>`;
}

/** Lignes pointillées vides (zones à écrire à la main : fiches vierges, encadrés non remplis). */
export function dotLines(count = 3, cls = '') {
  return html`<div class="dot-lines${cls ? ' ' + cls : ''}" aria-hidden="true">${Array.from({ length: Math.max(1, count) }, () => raw('<i></i>'))}</div>`;
}

/* ---------- Silhouette de la Guyane ---------- */
/** Silhouette SVG de la Guyane avec le point de la station (site.lat / site.lon, ou X / Y). */
export function guyaneInset(site, { size = 90, theme, label = '' } = {}) {
  const ll = siteLatLon(site);
  const xy = ll ? guyaneXY(ll[0], ll[1]) : null;
  const inside = xy && xy[0] >= -5 && xy[0] <= GUYANE.width + 5 && xy[1] >= -5 && xy[1] <= GUYANE.height + 5;
  const w = Math.max(24, Number(size) || 90), hgt = Math.round(w * (GUYANE.height + 16) / (GUYANE.width + 16));
  const what = site?.name ? `de la station ${site.name}` : 'de la station';
  return html`<figure ${themed(theme, 'guyane-inset')}>
    <svg viewBox="-8 -8 ${GUYANE.width + 16} ${GUYANE.height + 16}" width="${w}" height="${hgt}" role="img" aria-label="Situation ${what} en Guyane">
      <path class="gi-land" d="${GUYANE.path}"/>
      ${inside ? raw(`<circle class="gi-halo" cx="${xy[0].toFixed(1)}" cy="${xy[1].toFixed(1)}" r="17"/><circle class="gi-dot" cx="${xy[0].toFixed(1)}" cy="${xy[1].toFixed(1)}" r="9"/>`) : ''}
    </svg>
    ${label ? html`<figcaption>${label}</figcaption>` : ''}
  </figure>`;
}

/* ---------- Pied de page ---------- */
/** Slogan sur deux lignes comme les maquettes (coupure avant « pour … »). */
const sloganLines = text => {
  const t = String(text || ''), i = t.indexOf(' pour ');
  return i > 0 ? html`<span>${t.slice(0, i)}</span><span>${t.slice(i + 1)}</span>` : html`<span>${t}</span>`;
};
/** Pied de page : forêt et palmiers sur l'eau, vagues, slogan et site web (grid.header). */
export function sheetFooter({ grid = null, theme } = {}) {
  const h = { ...DEFAULT_HEADER, ...(grid?.header || {}) };
  const [fw, fh] = DECOR.forestViewBox, [ww, wh] = DECOR.wavesViewBox;
  return html`<footer ${themed(theme, 'sheet-footer')}>
    ${raw(`<svg class="sf-waves" viewBox="0 0 ${ww} ${wh}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${DECOR.waves.map((d, i) => `<path class="sf-w${i + 1}" d="${d}"/>`).join('')}<path class="sf-line" d="${DECOR.wavesLine}"/></svg>`)}
    ${raw(`<svg class="sf-forest" viewBox="0 0 ${fw} ${fh}" preserveAspectRatio="xMinYMax meet" aria-hidden="true" focusable="false"><path class="sf-reflect" d="${DECOR.forestReflect}"/><path class="sf-trees" d="${DECOR.forest}"/></svg>`)}
    <p class="sf-slogan">${sloganLines(h.slogan)}${swoosh('sf-swoosh')}</p>
    <p class="sf-web">${h.website}</p>
  </footer>`;
}
