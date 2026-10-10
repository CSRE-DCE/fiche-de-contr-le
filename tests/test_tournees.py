"""Tournées de contrôle terrain (grille CT-2026) de bout en bout, par l'interface.

Pour chaque type de tournée (hydrobiologie, cours d'eau, eaux souterraines) :
  1. création PAR L'ÉCRAN #/nouvel-audit (type, prestataire, stations recherchées et ajoutées dans l'ordre de
     passage, démarrage) ;
  2. réponses obligatoires des autres critères renseignées automatiquement (tests/helpers.py : answer_required) ;
  3. statut C sur une feuille de TOURNÉE (F2) et statut NC SANS observation sur une feuille STATION ⇒ le bouton
     « Terminer l'audit » est bloqué (point bloquant « justification obligatoire ») ; ajout de l'observation ⇒
     débloqué ; fin de l'audit ;
  4. PDF des fiches de la tournée (js/app/sheets-pdf.js generateSheetsPdf) : document PDF valide.
Et les fiches vierges de la station ATHANASE (bouton « Fiches vierges (PDF) » de la fiche station).
"""
import re

import pytest

from helpers import ATHANASE, answer_required, audit_state, create_tour, goto_hash, js, response, setup_standalone, wait_maps_idle

pytestmark = pytest.mark.lent

# type, prestataire, stations [(identifiant, nom recherché, prestation programmée attendue)], critère C (feuille de
# tournée), critère NC (feuille station)
TOURS = {
    'bio': dict(provider='prov-HYDRECO', stations=[(ATHANASE, 'Athanase', 'pres-BIO-2026-09271503')],
                c_item='it-F2-2.2', nc_item='it-F3-1@09271503', nc_sheet='3@09271503'),
    'ce': dict(provider='prov-TL1', stations=[('site-09281718', 'Sakoura', 'pres-RCO_09281718_S1_-_Octobre_2026'),
                                              ('site-09281719', 'Sourou', 'pres-RCO_09281719_S1_-_Octobre_2026')],
               c_item='it-F2-2.3', nc_item='it-F4-3@09281719', nc_sheet='4@09281719', reorder=True),
    'eso': dict(provider='prov-NBC', stations=[('site-BSS002PANK', 'Maripasoula', None)],
                c_item='it-F2-2.4', nc_item='it-F10-3@BSS002PANK', nc_sheet='10@BSS002PANK'),
}


def attr(value):
    """Valeur d'attribut pour un sélecteur CSS (identifiants contenant « @ » et « . »)."""
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def create_tour_by_screen(page, audit_type, provider, stations, reorder=False):
    """Création d'une tournée par l'écran #/nouvel-audit ; retourne l'identifiant de l'audit créé."""
    goto_hash(page, '#/nouvel-audit')
    page.click(f'[data-act=setType][data-v={audit_type}]')
    page.wait_for_selector(f'[data-act=setType][data-v={audit_type}][aria-checked=true]')
    page.click(f'[data-act=setProvider][data-v="{provider}"]')
    page.wait_for_selector(f'[data-act=setProvider][data-v="{provider}"][aria-checked=true]')
    submit = page.locator('#anForm button[type=submit]')
    assert submit.is_disabled(), 'démarrage impossible sans station'
    for site_id, name, prestation in stations:
        page.fill('[data-input=anSearch]', name)
        add = page.locator(f'#anCands [data-act=addSt][data-site={attr(site_id)}]')
        add.wait_for()
        if prestation:
            assert add.get_attribute('data-pres') == prestation, f'{name} : prestation programmée {prestation} proposée'
        add.click()
        page.wait_for_selector(f'.an-sel-row:has-text("{name}")')
    shown = [t.casefold() for t in page.locator('.an-sel-row .an-sel-name').all_inner_texts()]
    assert len(shown) == len(stations) and all(n.casefold() in s for s, (_, n, _) in zip(shown, stations)), shown
    if reorder:
        # Ordre de passage : la dernière station remonte en tête
        page.click(f'[data-act=moveSt][data-i="{len(stations) - 1}"][data-d="-1"]')
        page.wait_for_function("(n) => document.querySelector('.an-sel-row .an-sel-name')?.textContent.toLowerCase().includes(n.toLowerCase())", arg=stations[-1][1])
    recap = page.inner_text('.an-recap')
    assert f'{len(stations)} station' in recap, recap
    assert submit.is_enabled()
    submit.click()
    # Fin de l'affichage de la tournée : le routeur marque <body> « in-audit » après le montage de l'écran
    page.wait_for_function("() => /^#\\/audit\\/[^/]+/.test(location.hash) && document.body.classList.contains('in-audit')")
    wait_maps_idle(page)
    return re.match(r'#/audit/([^/?]+)', page.evaluate('location.hash')).group(1)


def click_status(page, item, value):
    page.click(f'[id={attr("row-" + item)}] [data-act=resp][data-value="{value}"]')
    page.wait_for_selector(f'[id={attr("row-" + item)}] [data-act=resp][data-value="{value}"][aria-pressed=true]')


def finish_button(page, audit_id):
    goto_hash(page, f'#/audit/{audit_id}/signatures')
    return page.locator('[data-act=finish]')


@pytest.mark.parametrize('audit_type', list(TOURS))
def test_tournee_de_bout_en_bout(page, app_url, audit_type):
    t = TOURS[audit_type]
    setup_standalone(page, app_url)
    audit_id = create_tour_by_screen(page, audit_type, t['provider'], t['stations'], t.get('reorder', False))

    # Tournée créée conforme aux choix de l'écran
    st = audit_state(page, audit_id)
    expected = [s for s, _, _ in t['stations']]
    if t.get('reorder'):
        expected = [expected[-1]] + expected[:-1]
    assert st['auditType'] == audit_type and st['providerId'] == t['provider'] and st['status'] == 'en_cours'
    assert [s['siteId'] for s in st['stations']] == expected, 'stations dans l’ordre de passage'
    pres = {s: p for s, _, p in t['stations']}
    assert all(s['prestationId'] == pres[s['siteId']] for s in st['stations']), 'prestations programmées rattachées'
    keys = {s['key'] for s in st['sheets']}
    assert '2' in keys and t['nc_sheet'] in keys, sorted(keys)
    if audit_type == 'eso':
        assert any(k.startswith('10@') for k in keys), 'feuille 10 « Eau souterraine – ouvrage, pompage et purge »'
    assert st['errors'], 'tournée vierge : réponses obligatoires manquantes'
    assert finish_button(page, audit_id).is_disabled()

    # Toutes les autres réponses obligatoires renseignées (hors des deux critères saisis à l'écran)
    assert answer_required(page, audit_id, skip=[t['c_item'], t['nc_item']]) > 20

    # Statut C sur la feuille de tournée (F2)
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    click_status(page, t['c_item'], 'C')
    assert response(page, audit_id, t['c_item'])['status'] == 'C'

    # Statut NC sans observation sur une feuille station ⇒ « Terminer » bloqué
    goto_hash(page, f'#/audit/{audit_id}/feuille-{t["nc_sheet"]}')
    click_status(page, t['nc_item'], 'NC')
    obs = page.locator(f'[id={attr("t-o-" + t["nc_item"])}]')
    assert 'need' in (obs.get_attribute('class') or ''), 'observation signalée obligatoire'
    errors = audit_state(page, audit_id)['errors']
    assert [e['itemId'] for e in errors] == [t['nc_item']] and 'justification obligatoire' in errors[0]['message'], errors
    button = finish_button(page, audit_id)
    assert button.is_disabled(), '« Terminer » doit être bloqué : non-conformité sans observation'
    issues = page.inner_text('.as-issues')
    assert 'justification obligatoire' in issues, issues

    # Ajout de l'observation ⇒ débloqué
    goto_hash(page, f'#/audit/{audit_id}/feuille-{t["nc_sheet"]}')
    obs = page.locator(f'[id={attr("t-o-" + t["nc_item"])}]')
    obs.fill('Constat : flaconnage non conforme au protocole (test automatisé).')
    obs.evaluate('el => el.blur()')
    page.wait_for_function("([id, item]) => !!window.AuditApp.store.get('audit', id)?.responses?.[item]?.comment", arg=[audit_id, t['nc_item']])
    assert audit_state(page, audit_id)['errors'] == []
    button = finish_button(page, audit_id)
    assert button.is_enabled(), '« Terminer » doit être débloqué'
    assert page.locator('.banner.ok:has-text("Aucun point bloquant")').count() == 1
    button.click()
    page.wait_for_selector('text=Terminé à')
    assert audit_state(page, audit_id)['status'] == 'termine'

    # PDF des fiches de la tournée
    pdf = js(page, """const { generateSheetsPdf } = await import('./js/app/sheets-pdf.js');
        const r = await generateSheetsPdf({ auditId: arg });
        const tail = String.fromCharCode(...r.bytes.slice(-16));
        return { head: String.fromCharCode(...r.bytes.slice(0, 8)), tail, size: r.bytes.length, pages: r.pages, filename: r.filename, provisional: r.provisional };""", audit_id)
    assert pdf['head'].startswith('%PDF'), pdf['head']
    assert '%%EOF' in pdf['tail']
    assert pdf['pages'] >= len(st['sheets']) and pdf['size'] > 20000, f"{pdf} pour {len(st['sheets'])} feuilles"
    assert pdf['provisional'] is True, 'audit non verrouillé : fiches provisoires'
    assert pdf['filename'].endswith('_fiches_controle.pdf')
    reports = page.evaluate(f"window.AuditApp.store.get('audit', '{audit_id}').reports.map(r => r.kind)")
    assert 'fiches' in reports, 'génération tracée dans l’audit'


def test_tournee_creee_par_le_module(page, app_url):
    """create_tour (js/app/audits.js) : tournée hydrobiologie de deux stations, toutes les étapes s'affichent."""
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE, 'site-09160201'], 'prov-HYDRECO', ['pres-BIO-2026-09271503', 'pres-BIO-2026-09160201'])
    assert tour['auditType'] == 'bio' and tour['stations'] == ['09271503', '09160201']
    assert re.fullmatch(r'AUD-\d{4}-07\d{4}', tour['number']), 'numéro dans la plage de l’appareil n° 7'
    steps = ['feuille-1@09271503', 'feuille-2', 'feuille-4@09160201', 'feuille-9@09160201', 'ecarts', 'synthese', 'signatures', 'infos']
    for step in steps:
        goto_hash(page, f'#/audit/{tour["id"]}/{step}')
    assert 'acarouany' in page.inner_text('#view').casefold(), 'stations de la tournée listées (Infos)'
    st = audit_state(page, tour['id'])
    assert [s['prestationId'] for s in st['stations']] == ['pres-BIO-2026-09271503', 'pres-BIO-2026-09160201']
    shared = {i['id'] for s in st['sheets'] if s['key'].startswith('4@') for i in s['items'] if i['shared']}
    assert 'it-F4-2' in shared, 'critère commun à la tournée partagé par les deux stations'


def test_fiches_vierges_athanase(page, app_url, tmp_path):
    setup_standalone(page, app_url)
    goto_hash(page, f'#/station/{ATHANASE}')
    assert 'athanase' in page.inner_text('#view').casefold()
    with page.expect_download(timeout=120000) as dl:
        page.click('[data-act=blankPdf]')
    download = dl.value
    path = tmp_path / download.suggested_filename
    download.save_as(path)
    data = path.read_bytes()
    assert data.startswith(b'%PDF'), data[:16]
    assert b'%%EOF' in data[-32:]
    assert 'ATHANASE' in download.suggested_filename.upper() and download.suggested_filename.endswith('.pdf'), download.suggested_filename
    assert len(data) > 20000
    # Même document par l'API du module : 9 feuilles de la tournée hydrobiologie, sans saisie
    r = js(page, """const M = await import('./js/app/sheets-pdf.js');
        const r = await M.generateBlankSheetsPdf({ siteId: arg, auditType: 'bio' });
        return { head: String.fromCharCode(...r.bytes.slice(0, 5)), pages: r.pages, filename: r.filename, provisional: r.provisional };""", ATHANASE)
    assert r['head'] == '%PDF-' and r['pages'] >= 9 and r['provisional'] is False, r
    assert r['filename'].startswith('Fiches_vierges_bio_'), r['filename']
