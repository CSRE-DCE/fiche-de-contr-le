"""« Attendus des prestataires » : source data/attendus-ct-2026.json, document docs/ATTENDUS-PRESTATAIRES.md généré par
tools/attendus_md.py, écran #/attendus (js/views/attendus.js) et ses PDF.

Les tests unitaires du contenu (exhaustivité par rapport à la grille, nombres inventés, références, PDF) sont dans
tests/unit/attendus.test.js (exécutés par tests/test_unit.py). Tant que la route #/attendus n'est pas déclarée dans
js/main.js, le test de l'écran l'enregistre lui-même (import dynamique du module de vue) ; le test d'intégration
(route, menu, service worker) est alors marqué « skip ».
"""
import json
import pathlib
import re
import subprocess
import sys

import pytest

from helpers import setup_standalone, goto_hash

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data' / 'attendus-ct-2026.json'
DOC = ROOT / 'docs' / 'ATTENDUS-PRESTATAIRES.md'
sys.path.insert(0, str(ROOT / 'tools'))
import attendus_md  # noqa: E402  (tools/attendus_md.py)


def load():
    return json.loads(SOURCE.read_text(encoding='utf-8'))


def route_integree():
    return re.search(r"route\('attendus'", (ROOT / 'js' / 'main.js').read_text(encoding='utf-8')) is not None


# ---------- Source et document Markdown ----------

def test_json_valide_et_complet():
    data = load()
    assert data['grid'] == 'grid-ct-2026-v1'
    assert len(data['criteres']) == 217, 'une entrée par critère de GRID_CT_2026 (1.2 : F8.A3 réuni à F8.A2 ; 1.3 : F5.31, F5.32, F6.14 à F6.16)'
    assert 'it-F8-A3' not in data['criteres'], 'numéro retiré : plus d’attendu'
    assert sorted(data['feuilles'], key=int) == [str(n) for n in range(1, 11)]
    assert set(data['echelle']) == {'C', 'P', 'NC', 'NA'}
    assert set(data['preparation']) == {'commun', 'bio', 'ce', 'eso'}
    cotes = [e for e in data['criteres'].values() if not e.get('valeur')]
    assert len(cotes) == 191
    # Note sur 20 : 28 points majeurs (« majeur », recopié de la grille ; 1.3 : F6.15 et F6.16), règle de notation expliquée.
    assert sum(1 for e in cotes if e.get('majeur')) == 28
    assert 'note sur 20' in data['notation'] and 'majeurs' in data['notation']
    for e in cotes:
        for k in ('attendu', 'verification', 'C', 'P', 'NC'):
            assert e.get(k, '').strip(), f"F{e['feuille']}.{e['no']} : champ {k} vide"


# Unité de turbidité écartée (seule NTU est admise), écrite en deux morceaux pour ne pas figurer en clair.
AUTRE_UNITE = 'F' + 'NU'


def test_turbidite_en_ntu():
    for path in (SOURCE, DOC):
        text = path.read_text(encoding='utf-8')
        assert not re.search(rf'\b{AUTRE_UNITE}\b', text, re.I), f'{path.name} : la turbidité s’exprime en NTU'
    assert 'NTU' in SOURCE.read_text(encoding='utf-8')


def test_markdown_a_jour():
    r = subprocess.run([sys.executable, 'tools/attendus_md.py', '--check'], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, (r.stdout + r.stderr) + '\n→ lancer « python tools/attendus_md.py »'


def test_markdown_option_check(tmp_path):
    """--check : code 1 si le document est absent ou différent, 0 s'il est identique ; --stdout n'écrit rien."""
    out = tmp_path / 'ATTENDUS.md'
    assert attendus_md.main(['--check', '--output', str(out)]) == 1
    out.write_text('ancien contenu\n', encoding='utf-8')
    assert attendus_md.main(['--check', '--output', str(out)]) == 1
    assert attendus_md.main(['--output', str(out)]) == 0
    assert attendus_md.main(['--check', '--output', str(out)]) == 0
    assert out.read_text(encoding='utf-8') == DOC.read_text(encoding='utf-8')


def test_markdown_contenu():
    data = load()
    text = attendus_md.render(data)
    for anchor in ('echelle', 'preparation', 'references', *[f'f{n}' for n in range(1, 11)]):
        assert f'<a id="{anchor}"></a>' in text, f'ancre #{anchor}'
    for e in data['criteres'].values():
        code = f"F{e['feuille']}.{e['no']}"
        if e.get('valeur'):
            assert f"| {code} | {attendus_md.md_escape(e['libelle'])} |" in text, f'{code} (information relevée)'
        else:
            assert f"#### {code} – {e['libelle']}" in text, f'{code} (point coté)'
            if e.get('aPreciser'):
                assert attendus_md.md_escape(e['aPreciser']) in text
    assert text.count('- [ ] ') == sum(len(g['elements']) for groups in data['preparation'].values() for g in groups)
    assert 'Commun à la tournée' in text and 'À préciser (OEG)' in text
    assert text.count('Point majeur (compte double dans la note)') == 28 and '**Note sur 20.**' in text
    # CCTP 2026 : valeurs par réseau et sources (références seulement : aucun nom de fichier)
    assert '**Selon le réseau (CCTP 2026) :**' in text and '- **Sources :** CCTP' in text and '.pdf' not in text
    assert '72 h au plus entre le prélèvement et la prise en charge' in text and 'AQUAREF (module DROM)' in text


# ---------- Écran #/attendus ----------

def ouvrir_attendus(page, app_url, hash_='#/attendus'):
    setup_standalone(page, app_url, demo=False)
    if not route_integree():
        page.evaluate("""async () => {
            const r = await import('./js/ui/router.js');
            r.route('attendus', () => import('./js/views/attendus.js'));
        }""")
    goto_hash(page, hash_)
    page.wait_for_selector('#view .att-sheet')
    return page


def test_ecran_attendus(page, app_url):
    ouvrir_attendus(page, app_url, '#/attendus?type=eso')
    assert page.locator('#view h1').inner_text().strip().lower() == 'attendus des prestataires'
    sheets = page.eval_on_selector_all('#view .att-sheet', 'els => els.map(e => e.dataset.sheet)')
    assert sheets == ['1', '2', '3', '10', '4', '5'], sheets
    total = page.locator('#view .att-crit').count()
    assert total > 100
    assert page.locator('#att-it-F4-2 .shared-badge').count() == 1
    assert 'Non applicable' in page.inner_text('#view .att-scale-box')

    # Filtre par feuille puis par type (la feuille 10 n'existe pas en biologie : filtre retiré)
    page.click('[data-act=att-sheet][data-value="10"]')
    page.wait_for_function("() => document.querySelectorAll('#view .att-sheet').length === 1")
    assert 'feuille=10' in page.evaluate('location.hash')
    page.click('[data-act=att-type][data-value=bio]')
    page.wait_for_function("() => document.querySelectorAll('#view .att-sheet').length === 9")
    assert 'feuille' not in page.evaluate('location.hash')

    # Recherche immédiate, conservée dans l'adresse
    page.fill('#attSearch', 'surber')
    page.wait_for_function("() => /pour « surber »/.test(document.querySelector('#attCount').textContent)")
    shown = page.eval_on_selector_all('#view .att-crit:not(.hide)', 'els => els.map(e => e.dataset.id)')
    assert 'it-F6-5' in shown and all(i.startswith('it-F6-') for i in shown), shown
    assert 'q=surber' in page.evaluate('location.hash')
    page.fill('#attSearch', 'mot introuvable')
    page.wait_for_selector('#attEmpty:not(.hide)')
    page.click('[data-act=att-clear]')
    page.wait_for_selector('#attEmpty.hide', state='attached')

    # Liste de préparation dépliable
    page.click('#attPrep summary')
    assert page.locator('#attPrep .att-prep-group').count() >= 8


@pytest.mark.lent
def test_ecran_attendus_pdf_et_fenetre(page, app_url):
    ouvrir_attendus(page, app_url, '#/attendus?type=ce')
    with page.expect_download() as dl:
        page.click('.page-title [data-act=att-prep-pdf]')
    assert dl.value.suggested_filename == 'Preparation_tournee_cours-eau.pdf'
    assert pathlib.Path(dl.value.path()).read_bytes()[:5] == b'%PDF-'
    page.wait_for_selector('.page-title [data-act=att-pdf]:not([disabled])')
    with page.expect_download(timeout=120000) as dl:
        page.click('.page-title [data-act=att-pdf]')
    assert dl.value.suggested_filename == 'Attendus_prestataires_cours-eau.pdf'
    assert pathlib.Path(dl.value.path()).read_bytes()[:5] == b'%PDF-'

    # Fenêtre « Attendu du prestataire » (identifiant effectif d'une tournée), puis « Tous les attendus »
    page.evaluate("async () => { const m = await import('./js/views/attendus.js'); m.openAttendu('it-F4-12@09271503'); }")
    page.wait_for_selector('.modal .att-crit')
    assert 'Flaconnage conforme' in page.inner_text('.modal')
    page.click('.modal [data-act=all]')
    page.wait_for_selector('#att-it-F4-12.att-focus')
    assert page.locator('.modal').count() == 0
    assert 'feuille=4' in page.evaluate('location.hash')


def test_integration_route_menu_service_worker():
    """Intégration dans l'application (fichiers tenus par l'intégrateur) : route, entrée de menu, service worker."""
    if not route_integree():
        pytest.skip('route #/attendus pas encore déclarée dans js/main.js (intégration à faire, voir le rapport)')
    shell = (ROOT / 'js' / 'views' / 'shell.js').read_text(encoding='utf-8')
    assert "key: 'attendus'" in shell and '#/attendus' in shell, 'entrée de menu « Attendus des prestataires »'
    sw = (ROOT / 'sw.js').read_text(encoding='utf-8')
    for f in ('./css/attendus.css', './data/attendus-ct-2026.json', './js/app/attendus-pdf.js', './js/views/attendus.js'):
        assert f"'{f}'" in sw, f'{f} absent de la liste SHELL de sw.js'
