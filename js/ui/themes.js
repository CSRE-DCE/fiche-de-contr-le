/* Palette des fiches de contrôle terrain OEG (couleurs relevées sur les maquettes des feuilles 1 à 9).
 * Fichier pur, partagé par l'affichage (variables CSS) et la génération des PDF : une seule source.
 *
 * Champs d'un thème :
 *  main     couleur principale (pastilles d'icônes, numéros, cases cochées, vagues)
 *  dark     titres et textes forts
 *  head     fond de l'en-tête des tableaux          headText  texte de cet en-tête
 *  bar      fond des barres de titre des encadrés   barText   texte de ces barres
 *  row      fond des lignes paires                  rowAlt    fond des lignes impaires
 *  light    fond des bandeaux et des encadrés       line      filets et bordures
 *  accent   couleur secondaire (vague, soulignement)
 *  ink      libellés et références courtes des tableaux : bleu marine des maquettes quelle que soit la couleur de la
 *           feuille (seuls les numéros prennent la couleur du thème) ; brun pour la partie B de la feuille 8 (cuivre)
 */
export const OEG = {
  navy: '#0d3577',      // « OFFICE DE L'EAU DE GUYANE », nom de la station
  blue: '#0b5fae',      // pastilles d'icônes du bandeau d'information
  sky: '#1a9fd9',       // sous-titre « Fiche station de contrôle terrain »
  cyan: '#33b5e5',
  ink: '#14284b',       // texte courant
  muted: '#4c6280',
  paper: '#f4f9fd',     // fond de page
  card: '#ffffff',
  line: '#cfe3f1',
  ok: '#1b7a43', perf: '#d97706', nc: '#c62828', na: '#5f6b7a', warn: '#b45309'
};

export const THEMES = {
  ocean: { label: 'Océan', main: '#0b6cb4', dark: '#0d3577', head: '#dcf4fc', headText: '#0d3577', bar: '#dcf4fc', barText: '#0d3577', row: '#ffffff', rowAlt: '#f3fafd', light: '#e6f6fd', line: '#bfe3f3', accent: '#1a9fd9', ink: '#0d3577' },
  navy: { label: 'Bleu', main: '#0b5fae', dark: '#0d3577', head: '#c8ecfc', headText: '#0d3577', bar: '#d4f0fc', barText: '#0d3577', row: '#ffffff', rowAlt: '#f6fbfe', light: '#dff3fd', line: '#b6dcf2', accent: '#0880c8', ink: '#0d3577' },
  green: { label: 'Vert', main: '#2f8a3f', dark: '#1f5f30', head: '#388440', headText: '#ffffff', bar: '#ecf8f0', barText: '#1f6b34', row: '#ffffff', rowAlt: '#e9f6ec', light: '#e4f4e8', line: '#bfdec6', accent: '#3fa34d', ink: '#0d3577' },
  peach: { label: 'Pêche', main: '#ec5f12', dark: '#0d3577', head: '#fcc094', headText: '#0d3577', bar: '#fcf0e4', barText: '#0d3577', row: '#ffffff', rowAlt: '#fcf4ec', light: '#fdf1e6', line: '#f3cfb2', accent: '#f39a5b', ink: '#0d3577' },
  orange: { label: 'Orange', main: '#f2621a', dark: '#0d3577', head: '#fc600c', headText: '#ffffff', bar: '#fff3ea', barText: '#0d3577', row: '#f0f8fc', rowAlt: '#e9f5fb', light: '#fce8dc', line: '#f7a878', accent: '#fc8a3c', title: '#f2621a', ink: '#0d3577' },
  violet: { label: 'Violet', main: '#6a35b0', dark: '#4a1f8a', head: '#8256c4', headText: '#ffffff', bar: '#9464cc', barText: '#ffffff', row: '#ffffff', rowAlt: '#faf6fd', light: '#ece8fc', line: '#d4c3ec', accent: '#9c6ccc', ink: '#0d3577' },
  sky: { label: 'Ciel', main: '#0b6cb4', dark: '#0d3577', head: '#088cc0', headText: '#ffffff', bar: '#dcf4fc', barText: '#0d3577', row: '#ffffff', rowAlt: '#e4f4fc', light: '#d8f0fc', line: '#b4dcf0', accent: '#0c9ccc', ink: '#0d3577' },
  rust: { label: 'Cuivre', main: '#e0662a', dark: '#b4451a', head: '#fce8d8', headText: '#8a3a1a', bar: '#fdf0e4', barText: '#b4451a', row: '#fcf8f4', rowAlt: '#fcf0e8', light: '#fdf0e4', line: '#f3c9a6', accent: '#f0a060', title: '#c4501f', ink: '#8a3a1a' },
  slate: { label: 'Ardoise (eaux souterraines)', main: '#2f6f8f', dark: '#163e57', head: '#3f7ea3', headText: '#ffffff', bar: '#e3eef5', barText: '#163e57', row: '#ffffff', rowAlt: '#eef4f8', light: '#e3eef5', line: '#bcd3e2', accent: '#5b9bbf', ink: '#0d3577' },
  teal: { label: 'Turquoise', main: '#0b6c9c', dark: '#0d3577', head: '#088cb4', headText: '#ffffff', bar: '#d8f4fc', barText: '#0d3577', row: '#ffffff', rowAlt: '#ecf8fc', light: '#dcf4fc', line: '#b4dcec', accent: '#349cc0', num: '#349cc0', ink: '#0d3577' }
};

export const DEFAULT_THEME = 'ocean';
export const theme = name => THEMES[name] || THEMES[DEFAULT_THEME];

/** Variables CSS d'un thème (style="…" d'un conteneur de feuille). */
export function themeVars(name) {
  const t = theme(name);
  return Object.entries(t).filter(([k]) => k !== 'label').map(([k, v]) => `--th-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join(';');
}

/** Couleur hexadécimale → [r, g, b] entre 0 et 1 (pour le PDF). */
export function rgb01(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
