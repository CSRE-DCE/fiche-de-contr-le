/* Liste des fichiers de tests unitaires (un fichier absent ou en erreur est signalé comme un échec). */
import { load, run } from './harness.js';

export const FILES = [
  './core.test.js',
  './domain.test.js',
  './formats.test.js',
  './grid-ct-2026.test.js',
  './networks.test.js',
  './pdf-sheets.test.js',
  './github.test.js',
  './attendus.test.js',
  './exchange.test.js'
];

export async function runAll({ files = FILES, onResult } = {}) {
  const loadErrors = [];
  for (const file of files) {
    const error = await load(file);
    if (error) loadErrors.push({ file, error });
  }
  return run({ loadErrors, onResult });
}
