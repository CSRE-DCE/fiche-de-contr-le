"""Tests unitaires exécutés dans le navigateur (tests/unit/index.html, sans Node), un cas pytest par fichier.

Chaque fichier tests/unit/*.test.js est exécuté seul (?files=<nom>) ; le résultat est lu sur
window.__UNIT_RESULTS__ = { done, passed, failed, failures: [{ name, error }] }. Un fichier présent sur le disque
mais absent de la liste de tests/unit/all.js (ou l'inverse) est signalé.
"""
import pathlib
import re

import pytest

UNIT = pathlib.Path(__file__).resolve().parent / 'unit'
FILES = sorted(p.name[:-len('.test.js')] for p in UNIT.glob('*.test.js'))


def listed_in_all_js():
    return re.findall(r"'\./([\w.-]+)\.test\.js'", (UNIT / 'all.js').read_text(encoding='utf-8'))


def test_fichiers_de_tests_listes():
    listed = listed_in_all_js()
    assert sorted(listed) == FILES, f'tests/unit/all.js liste {sorted(listed)}, le dossier contient {FILES}'
    for name in ('core', 'domain', 'formats', 'grid-ct-2026', 'pdf-sheets', 'github'):
        assert name in FILES, f'tests/unit/{name}.test.js manquant'


@pytest.mark.parametrize('name', FILES)
def test_unitaires(page, app_url, name):
    page.goto(f'{app_url}tests/unit/index.html?files={name}')
    page.wait_for_function('() => window.__UNIT_RESULTS__ && window.__UNIT_RESULTS__.done', timeout=180000)
    r = page.evaluate('window.__UNIT_RESULTS__')
    details = '\n'.join(f"  ✗ {f['name']}\n      {f['error'][:1200]}" for f in r['failures'])
    assert r['failed'] == 0, f"{name}.test.js : {r['failed']} échec(s), {r['passed']} réussi(s)\n{details}"
    assert r['passed'] > 0, f'{name}.test.js : aucun test exécuté'
    shown = page.inner_text('#sum')
    assert f"{r['passed']} réussi(s), 0 échec(s)" in shown, shown
