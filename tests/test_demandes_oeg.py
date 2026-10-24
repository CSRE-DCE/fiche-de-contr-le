"""Demandes de l'OEG des 14/10 et 16/10/2026 (étape 1/3) : annulation de tournée, opérateurs, photos, logo.

  1. « Annuler la tournée » (tablette 1280 × 900 puis téléphone 390 × 844) : Bruno, auditeur et contrôleur du binôme
     (il n'a pas créé la tournée), l'annule depuis l'en-tête (tablette) ou l'onglet Infos (téléphone) : motif vide refusé,
     appui hors de la fenêtre sans effet (clavier Android), écart ouvert annoncé puis annulé avec le même motif, message
     « Tournée AUD-… annulée », retour à l'accueil ; la tournée n'est plus dans « Tournées en cours » ni dans la liste
     des audits (filtre « Annulées » : badge « Annulée », motif) ; bandeau « Tournée annulée » ; journal. Chloé, hors
     binôme : pas de bouton, « rejoignez d'abord la tournée » ; tournée signée et verrouillée : refus expliqué.
  2. Opérateurs (« Préleveurs du prestataire ») par un auditeur (sans droit « référentiels ») : « Ajouter un opérateur »
     à la création de tournée (HYDRECO : « NB » du référentiel complété en Nadia Bernard, sans doublon ; mêmes initiales
     pour une autre personne : l'existante est proposée) puis sur la feuille Organisation (F2) : nouvel opérateur
     rattaché au prestataire, sélectionné aussitôt, libellé figé dans la tournée, journal ; décocher le retire.
  3. Photos : « Prendre une photo » (capture=environment) et « Importer depuis la galerie » (sans capture, sélection
     multiple) sur un critère (fenêtre « Ajouter une preuve » du tableau ; boutons libellés des cartes à 390 px), dans
     l'encadré « Prise de photos », la fiche station (RD / RG / AM / AV), l'observation terrain et un écart ; date de
     prise de vue reprise des métadonnées EXIF, sinon date d'import signalée ; origine affichée par la visionneuse.
  4. Logo de l'application (administrateur) : SVG choisi → PNG aux proportions conservées dans l'en-tête, l'accueil,
     les feuilles, l'écran de connexion (aussi après rechargement) et tous les PDF (fiches de tournée, fiches vierges,
     fiche station, rapport, attendus) ; transmis à l'autre tablette par le fichier d'échange (avec un opérateur ajouté,
     sans doublon) ; « Rétablir le logo OEG » aussi transmis.
"""
import pathlib
import re

import pytest

from helpers import EXCHANGE_PASSWORD, PASSWORD, ATHANASE, create_tour, goto_hash, js, lock, open_setup, setup_standalone, unlock, wait_view
from test_tablette_partagee import SAKOURA, add_agent, attr, login, switch_agent
from test_echange_tablettes import receive, send, tablet

FIXTURES = pathlib.Path(__file__).resolve().parent / 'fixtures'
TABLET = {'width': 1280, 'height': 900}
PHONE = {'width': 390, 'height': 844}
NO_OVERFLOW = '() => document.documentElement.scrollWidth <= window.innerWidth + 1'


def clear_toasts(page):
    page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")


def toast_text(page):
    return page.inner_text('#toast-root')


# ---------------------------------------------------------------------------------------------------------------
# 1. Annulation de tournée
def cancel_setup(page, app_url):
    """Alice (administratrice) crée une tournée en binôme avec Bruno (auditeur), un écart ouvert ; Chloé hors binôme ;
    seconde tournée signée et verrouillée."""
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    bruno = add_agent(page, 'Martin', 'Bruno', 'bmartin')
    add_agent(page, 'Petit', 'Chloé', 'cpetit')
    tour = create_tour(page, 'ce', [ATHANASE], 'prov-TL1', controllerIds=[bruno])
    dev = js(page, """const a = store.get('audit', arg);
        const d = await A.createDeviation(a, { description: 'Flacons non étiquetés', requirement: 'Étiquetage' });
        return d.number;""", tour['id'])
    signed = create_tour(page, 'ce', ['site-09160201'], 'prov-TL1', controllerIds=[bruno])
    js(page, """let a = store.get('audit', arg);
        a = await A.signAudit(a, 'auditor', { name: session.user.name });
        a = await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
        await A.lockAudit(store.get('audit', arg));""", signed['id'])
    return tour, dev, signed


@pytest.mark.lent
def test_annulation_tournee_binome_tablette_et_telephone(make_page, app_url):
    for vp in (TABLET, PHONE):
        page = make_page(viewport=vp, label=f'{vp["width"]} px')
        tour, dev, signed = cancel_setup(page, app_url)
        number = tour['number']

        # Chloé, hors binôme : pas de bouton ; l'onglet Infos explique qu'il faut rejoindre la tournée.
        switch_agent(page)
        login(page, 'cpetit')
        goto_hash(page, f'#/audit/{tour["id"]}/infos')
        assert page.locator('#tourCancelTop').count() == 0 and page.locator('#tourCancel').count() == 0
        assert 'rejoignez d’abord la tournée' in page.inner_text('#tourCancelWhy')

        # Bruno, contrôleur du binôme (n'a pas créé la tournée)
        switch_agent(page)
        login(page, 'bmartin')
        goto_hash(page, f'#/audit/{tour["id"]}/feuille-2')
        assert page.locator('#tourCancelTop').is_visible(), 'bouton « Annuler la tournée » dans l’en-tête'
        assert page.evaluate(NO_OVERFLOW), 'en-tête de la tournée sans débordement'
        if vp is TABLET:
            page.click('#tourCancelTop')
        else:
            goto_hash(page, f'#/audit/{tour["id"]}/infos')
            assert page.inner_text('#tourCancel').strip() == 'Annuler la tournée'
            page.click('#tourCancel')
        page.wait_for_selector('.modal #__prompt')
        assert page.inner_text('.modal-head h2').casefold() == f'annuler la tournée {number}'.casefold()
        assert page.locator('.modal [data-act=__close]').count() == 0, 'pas de croix : seulement les boutons'
        hint = page.inner_text('.modal .hint')
        assert dev in hint and 'annulé avec ce motif' in hint, hint
        # Motif vide : refus ; appui hors du cadre (pour fermer le clavier) : la fenêtre reste.
        page.click('.modal [data-act=ok]')
        assert page.inner_text('#__prompt_err') == 'Ce champ est obligatoire.'
        page.mouse.click(4, 4)
        page.keyboard.press('Escape')
        assert page.locator('.modal #__prompt').count() == 1, 'fenêtre toujours ouverte'
        assert page.inner_text('.modal [data-act=cancel]') == 'Garder la tournée'
        page.fill('#__prompt', 'Crue : accès impossible à la station')
        page.click('.modal [data-act=ok]')
        page.wait_for_function("() => location.hash === '#/'")
        assert f'Tournée {number} annulée (1 écart annulé)' in toast_text(page)
        a = js(page, "const a = store.get('audit', arg); return { status: a.status, reason: a.abandonReason, by: a.cancelledByName, at: !!a.cancelledAt };", tour['id'])
        assert a == {'status': 'abandonne', 'reason': 'Crue : accès impossible à la station', 'by': 'Bruno Martin', 'at': True}, a
        assert js(page, "return store.filter('deviation', d => d.auditId === arg).map(d => [d.status, d.closureNote]);", tour['id']) == [['annule', f'Tournée {number} annulée — Crue : accès impossible à la station']]
        trail = js(page, "return store.all('trail').filter(t => t.action === 'abandon').map(t => [t.entityLabel || '', t.reason]);")
        assert any(r == 'Crue : accès impossible à la station' for _, r in trail), trail
        # Accueil : plus dans les tournées en cours ; liste des audits : masquée, visible sous « Annulées ».
        assert page.locator(f'.hm-tour[data-tour="{tour["id"]}"]').count() == 0
        goto_hash(page, '#/audits')
        assert number not in page.inner_text('#view .list') if page.locator('#view .list').count() else True
        assert '1 tournée annulée non affichée' in page.inner_text('.au-hidden')
        page.click('[data-act=q][data-v=abandonne]')
        page.wait_for_selector('.au-cancel')
        row = page.inner_text('#view .list')
        assert number in row and 'Annulée' in row and 'motif : « Crue : accès impossible à la station »' in row and 'par Bruno Martin' in row, row
        # Tournée annulée : bandeau, lecture seule, plus de bouton.
        goto_hash(page, f'#/audit/{tour["id"]}/infos')
        assert 'Tournée annulée' in page.inner_text('#tourCancelled') and 'Crue' in page.inner_text('#tourCancelled')
        assert page.locator('#tourCancelTop').count() == 0 and page.locator('#tourCancel').count() == 0
        assert page.evaluate(NO_OVERFLOW)

        # Tournée signée et verrouillée : pas de bouton, refus expliqué (onglet Infos et domaine).
        goto_hash(page, f'#/audit/{signed["id"]}/infos')
        assert page.locator('#tourCancelTop').count() == 0
        assert 'signée et verrouillée : elle ne peut plus être annulée' in page.inner_text('#tourCancelWhy')
        err = js(page, "try { await A.cancelTour(store.get('audit', arg), 'test'); return null; } catch (e) { return e.message; }", signed['id'])
        assert 'signée et verrouillée' in err, err
        assert js(page, "try { await A.cancelTour(store.get('audit', arg), '  '); return null; } catch (e) { return e.message; }", tour['id']).endswith('déjà annulée.')


# ---------------------------------------------------------------------------------------------------------------
# 2. Opérateurs
def add_operator(page, button, last, first, *, fn='', initials=None):
    page.click(button)
    page.wait_for_selector('#opf')
    page.fill('#opf [name=lastName]', last)
    page.fill('#opf [name=firstName]', first)
    if initials is not None:
        page.fill('#opf [name=initials]', initials)
    if fn:
        page.fill('#opf [name=fn]', fn)
    page.click('#opOk')


def operators(page, provider='prov-HYDRECO'):
    return js(page, "return store.filter('operator', o => o.providerId === arg).map(o => [o.id, o.code, o.firstName || '', o.lastName, o.function || '']).sort();", provider)


def test_operateurs_creation_de_tournee_et_feuille_organisation(make_page, app_url):
    page = make_page(viewport=TABLET)
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    add_agent(page, 'Martin', 'Bruno', 'bmartin')
    switch_agent(page)
    login(page, 'bmartin')
    assert js(page, "return session.user.role;") == 'auditeur'
    before = operators(page)
    assert len(before) == 10

    goto_hash(page, '#/nouvel-audit')
    page.click('[data-act=setType][data-v=ce]')
    page.click('[data-act=setProvider][data-v="prov-HYDRECO"]')
    page.wait_for_selector('#opNewCreate')
    # « NB » du référentiel (initiales seules) : identité complétée, sans doublon, cochée aussitôt.
    add_operator(page, '#opNewCreate', 'Bernard', 'Nadia', fn='Technicienne')
    page.wait_for_selector('#opf', state='detached')
    assert 'complétée : Nadia Bernard, sans doublon' in toast_text(page)
    after = operators(page)
    assert len(after) == 10 and ['op-HYDRECO-NB', 'NB', 'Nadia', 'Bernard', 'Technicienne'] in after, after
    assert page.is_checked('#anOperators input[value="op-HYDRECO-NB"]')
    # Mêmes initiales, autre personne : l'existante est proposée, puis sélectionnée (aucune fiche créée).
    add_operator(page, '#opNewCreate', 'Bouvier', 'Noé')
    page.wait_for_selector('#opProposeBox')
    assert 'Les initiales NB sont déjà celles de Nadia Bernard (NB) chez HYDRECO' in page.inner_text('#opProposeBox')
    page.click('#opUse')
    page.wait_for_selector('#opf', state='detached')
    assert len(operators(page)) == 10
    # Station, puis démarrage
    page.fill('[data-input=anSearch]', 'Sakoura')
    page.click(f'#anCands [data-act=addSt][data-site="{SAKOURA}"]')
    page.wait_for_selector('.an-sel-row:has-text("Sakoura")')
    assert page.is_checked('#anOperators input[value="op-HYDRECO-NB"]'), 'sélection conservée'
    page.click('#anForm button[type=submit]')
    page.wait_for_function("() => /^#\\/audit\\/[^/]+/.test(location.hash) && document.body.classList.contains('in-audit')")
    audit_id = re.match(r'#/audit/([^/?]+)', page.evaluate('location.hash')).group(1)
    a = js(page, "const a = store.get('audit', arg); return { ids: a.operatorIds, names: a.operatorNames, number: a.number };", audit_id)
    assert a['ids'] == ['op-HYDRECO-NB'] and a['names'] == {'op-HYDRECO-NB': 'Nadia Bernard (NB) — Technicienne'}, a

    # Feuille Organisation (F2) : liste du prestataire, « Ajouter un opérateur » → rattaché, sélectionné, journal.
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    card = page.locator('#tourOperators')
    assert 'HYDRECO' in card.inner_text() and page.is_checked('#tourOperators input[value="op-HYDRECO-NB"]')
    add_operator(page, '#opNewTour', 'Martin', 'Paul', fn='Préleveur')
    page.wait_for_selector('#opf', state='detached')
    page.wait_for_selector('#tourOperators input[value="op-HYDRECO-PM"]:checked')
    assert len(operators(page)) == 11 and ['op-HYDRECO-PM', 'PM', 'Paul', 'Martin', 'Préleveur'] in operators(page)
    a = js(page, "const a = store.get('audit', arg); return { ids: a.operatorIds, names: a.operatorNames };", audit_id)
    assert a['ids'] == ['op-HYDRECO-NB', 'op-HYDRECO-PM'] and a['names']['op-HYDRECO-PM'] == 'Paul Martin (PM) — Préleveur', a
    reasons = js(page, "return store.all('trail').map(t => t.reason || '');")
    assert any(r.startswith('Opérateur Paul Martin (PM) ajouté au prestataire HYDRECO — tournée AUD-') for r in reasons), reasons[-5:]
    assert any(r.startswith('Préleveur Paul Martin (PM) ajouté à la tournée AUD-') for r in reasons)
    # Décocher : retiré de la tournée (la fiche reste au référentiel).
    page.uncheck('#tourOperators input[value="op-HYDRECO-NB"]')
    page.wait_for_function("(id) => window.AuditApp.store.get('audit', id).operatorIds.join() === 'op-HYDRECO-PM'", arg=audit_id)
    goto_hash(page, f'#/audit/{audit_id}/infos')
    assert 'Paul Martin (PM)' in page.inner_text('#view')
    # Téléphone : la carte tient dans l'écran.
    page.set_viewport_size(PHONE)
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    assert page.locator('#opNewTour').is_visible() and page.evaluate(NO_OVERFLOW)


# ---------------------------------------------------------------------------------------------------------------
# 3. Photos
def media_of(page, item):
    return js(page, "return store.filter('media', m => m.link?.itemId === arg).map(m => ({ source: m.source, takenAt: m.takenAt, takenAtSource: m.takenAtSource, gps: m.gps && m.gps.source, importedAt: !!m.importedAt })).sort((a, b) => (a.takenAtSource || '').localeCompare(b.takenAtSource || ''));", item)


def check_inputs(scope):
    cam = scope.locator('input[type=file][data-source=camera]')
    gal = scope.locator('input[type=file][data-source=gallery]')
    assert cam.count() >= 1 and gal.count() >= 1
    assert cam.first.get_attribute('capture') == 'environment' and cam.first.get_attribute('accept') == 'image/*'
    assert gal.first.get_attribute('capture') is None and gal.first.get_attribute('accept') == 'image/*' and gal.first.evaluate('i => i.multiple')
    return cam.first, gal.first


@pytest.mark.lent
def test_photos_appareil_et_galerie(make_page, app_url):
    page = make_page(viewport=TABLET)
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO')
    key = tour['stations'][0]
    item = f'it-F3-1@{key}'

    # Tableau (≥ 1100 px) : « Ajouter une preuve » → trois choix explicites.
    goto_hash(page, f'#/audit/{tour["id"]}/feuille-3@{key}')
    page.click(f'[id={attr("row-" + item)}] [data-act=proof-menu]')
    page.wait_for_selector('.modal .as-proof-choices')
    assert [t.strip() for t in page.locator('.modal .as-proof-choices label').all_inner_texts()] == ['Prendre une photo', 'Importer depuis la galerie', 'Joindre un document']
    _, gal = check_inputs(page.locator('.modal'))
    gal.set_input_files([str(FIXTURES / 'photo-exif.jpg'), str(FIXTURES / 'photo.jpg')])
    page.wait_for_selector('.modal', state='detached')
    page.wait_for_function("(id) => window.AuditApp.store.filter('media', m => m.link?.itemId === id).length === 2", arg=item)
    assert '2 photos importées de la galerie ✓ — 1 photo sans date de prise de vue : date d’import retenue' in toast_text(page)
    m = media_of(page, item)
    assert m[0] == {'source': 'gallery', 'takenAt': '2026-10-15T11:42:10.000Z', 'takenAtSource': 'exif', 'gps': 'exif', 'importedAt': True}, m
    assert m[1]['source'] == 'gallery' and m[1]['takenAtSource'] == 'import' and m[1]['gps'] == 'device', m
    sub = page.locator(f'[id={attr("row-" + item)}] + tr.as-sub')
    sub.locator('.thumb img[src]').first.wait_for()
    assert sub.locator('.t-gal').count() == 2
    # Visionneuse : date de prise de vue lue dans la photo, origine.
    clear_toasts(page)
    sub.locator('.thumb', has_text='15/10').click()
    page.wait_for_selector('.modal .kv')
    kv = page.inner_text('.modal .kv')
    assert '15/10/2026 08:42' in kv and 'lue dans les métadonnées de la photo' in kv and 'Importée depuis la galerie le' in kv and 'position enregistrée par l’appareil photo' in kv, kv
    page.click('.modal [data-act=__close]')
    # Appareil photo de la tablette
    page.click(f'[id={attr("row-" + item)}] [data-act=proof-menu]')
    page.wait_for_selector('.modal .as-proof-choices')
    page.set_input_files('.modal input[data-source=camera]', str(FIXTURES / 'photo.jpg'))
    page.wait_for_function("(id) => window.AuditApp.store.filter('media', m => m.link?.itemId === id).length === 3", arg=item)
    assert any(x['source'] == 'camera' and x['takenAtSource'] == 'capture' and x['gps'] == 'device' for x in media_of(page, item))
    assert page.evaluate("() => [...document.querySelectorAll('.st-wrap')].every(w => w.scrollWidth <= w.clientWidth)"), 'colonne Observations inchangée'

    # Encadré « Prise de photos » (F3) : deux boutons libellés
    block = page.locator('.as-b-photos')
    cam, gal = check_inputs(block)
    assert 'Prendre une photo' in block.inner_text() and 'Importer depuis la galerie' in block.inner_text()
    gal.set_input_files(str(FIXTURES / 'photo-exif.jpg'))
    page.wait_for_function("(id) => window.AuditApp.store.filter('media', m => m.link?.type === 'sheet' && m.link.itemId === '3@' + id).length === 1", arg=key)

    # Cartes (< 1100 px) : boutons libellés sur chaque critère
    page.set_viewport_size(PHONE)
    goto_hash(page, f'#/audit/{tour["id"]}/feuille-3@{key}')
    card = page.locator(f'[id={attr("card-" + item)}]')
    assert [t.strip() for t in card.locator('.st-rc-tools label').all_inner_texts()] == ['Prendre une photo', 'Importer depuis la galerie', 'Joindre un document']
    check_inputs(card)
    assert page.evaluate(NO_OVERFLOW)

    # Fiche station : photographies RD / RG / AM / AV (emplacement vide : deux choix)
    page.set_viewport_size(TABLET)
    goto_hash(page, '#/station/site-09160201')
    fig = page.locator('.ss-photo[data-slot=AM]')
    cam, gal = check_inputs(fig)
    assert gal.get_attribute('data-change') == 'st-photo' and gal.get_attribute('data-slot') == 'AM'
    gal.set_input_files(str(FIXTURES / 'photo-exif.jpg'))
    page.wait_for_function("() => !!window.AuditApp.store.get('site', 'site-09160201').photos?.AM?.mediaId")
    st = js(page, "const m = store.get('media', store.get('site', 'site-09160201').photos.AM.mediaId); return [m.source, m.takenAtSource, m.link.slot];")
    assert st == ['gallery', 'exif', 'AM'], st

    # Observation terrain : deux choix
    goto_hash(page, '#/')
    page.click('[data-act=shell-observation]')
    page.wait_for_selector('#obsf')
    _, gal = check_inputs(page.locator('.modal'))
    gal.set_input_files(str(FIXTURES / 'photo-exif.jpg'))
    page.wait_for_selector('#obsThumbs .thumb img')
    page.fill('#obsText', 'Flacons posés au soleil')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('#obsf', state='detached')
    page.wait_for_function("() => window.AuditApp.store.filter('media', m => m.link?.type === 'observation').length === 1")
    obs = js(page, "const o = store.all('observation')[0]; return store.filter('media', m => m.link?.type === 'observation' && m.link.id === o.id).map(m => [m.source, m.takenAtSource]);")
    assert obs == [['gallery', 'exif']], obs

    # Écart : prendre une photo, importer depuis la galerie, joindre un document
    dev = js(page, "const d = await A.createDeviation(store.get('audit', arg), { description: 'Test' }); return d.id;", tour['id'])
    goto_hash(page, f'#/ecart/{dev}')
    tools = page.locator('.item-tools').first
    assert [t.strip() for t in tools.locator('label').all_inner_texts()] == ['Prendre une photo', 'Importer depuis la galerie', 'Joindre un document']
    check_inputs(tools)


# ---------------------------------------------------------------------------------------------------------------
# 4. Logo de l'application
PDF_LOGO = """async (arg) => {
    const { PDFDocument } = await import('./js/formats/pdf.js');
    const seen = [], orig = PDFDocument.prototype.addRGBA;
    PDFDocument.prototype.addRGBA = function (d, ...r) { seen.push([d.width, d.height]); return orig.call(this, d, ...r); };
    const out = {};
    try {
      const S = await import('./js/app/sheets-pdf.js');
      const run = async (k, fn) => { seen.length = 0; await fn(); out[k] = seen[0] || null; };
      await run('tournee', async () => { const m = await S.sheetsModelFromAudit(window.AuditApp.store.get('audit', arg)); await S.buildSheetsPdf(m, { only: sh => sh.index <= 2, mapNetwork: false }); });
      await run('vierges', () => S.generateBlankSheetsPdf({ auditType: 'ce', siteId: 'site-09271503' }));
      await run('station', () => S.generateStationSheetPdf({ siteId: 'site-09271503', auditType: 'ce' }));
      await run('rapport', async () => (await import('./js/app/report.js')).buildAuditReport(arg));
      await run('attendus', async () => { const P = await import('./js/app/attendus-pdf.js'); await P.buildAttendusPdf(await P.loadAttendus(), { auditType: 'ce' }); });
    } finally { PDFDocument.prototype.addRGBA = orig; }
    return out;
}"""


def logo_src(page, sel):
    return page.get_attribute(sel, 'src') or ''


@pytest.mark.lent
def test_logo_application_ecrans_pdf_et_autre_tablette(make_page, app_url, tmp_path):
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    tour = create_tour(t1, 'ce', [ATHANASE], 'prov-TL1')
    default = t1.evaluate("async () => { const S = await import('./js/app/sheets-pdf.js'); const { PDFDocument } = await import('./js/formats/pdf.js'); const d = new PDFDocument(); const img = await S.oegLogo(d); return img ? [img.width, img.height] : null; }")
    assert default == [220, 220], default

    goto_hash(t1, '#/administration')
    assert 'Logo de l’OEG (par défaut)' in t1.inner_text('#logoCard') and 'L’icône de l’application installée sur la tablette (écran d’accueil) ne change pas' in t1.inner_text('#logoCard')
    assert t1.locator('#logoReset').count() == 0
    t1.set_input_files('#logoPick input', str(FIXTURES / 'logo-test.svg'))
    t1.wait_for_selector('#logoUse')
    assert t1.locator('.logo-previews img').count() == 3 and '512 × 256 px' in t1.inner_text('.modal-body')
    t1.click('#logoUse')
    t1.wait_for_selector('#logoReset')
    logo = js(t1, "return store.get('setting', 'org').logo;")
    assert logo['width'] == 512 and logo['height'] == 256 and logo['mime'] == 'image/png' and logo['name'] == 'logo-test.svg', logo
    media = js(t1, "const m = store.get('media', arg); return [m.kind, m.mime, m.sha256, m.link];", logo['mediaId'])
    assert media == ['logo', 'image/png', logo['sha256'], {'type': 'setting', 'id': 'org'}], media
    assert 'Logo choisi — logo-test.svg (512 × 256 px)' in t1.inner_text('#logoCard')
    reasons = js(t1, "return store.all('trail').map(t => t.reason || '');")
    assert any(r.startswith('Logo de l’application remplacé (logo-test.svg') for r in reasons)
    # Partout à l'écran : en-tête, accueil, feuilles (proportions conservées : classe is-custom)
    assert logo_src(t1, '.app-top .logo').startswith('data:image/png;base64,') and 'is-custom' in t1.get_attribute('.app-top .logo', 'class')
    goto_hash(t1, '#/')
    assert logo_src(t1, '.hm-logo').startswith('data:image/png')
    goto_hash(t1, f'#/audit/{tour["id"]}/feuille-2')
    assert logo_src(t1, '.as-hd-full .oh-logo').startswith('data:image/png') and 'is-custom' in t1.get_attribute('.as-hd-full .oh-logo', 'class')
    ratio = t1.eval_on_selector('.as-hd-full .oh-logo', "i => [i.naturalWidth, i.naturalHeight]")
    assert ratio == [512, 256], ratio
    # Tous les PDF : logo choisi (220 × 110 px : proportions conservées)
    pdfs = t1.evaluate(PDF_LOGO, tour['id'])
    assert pdfs == {k: [220, 110] for k in ('tournee', 'vierges', 'station', 'rapport', 'attendus')}, pdfs
    # Écran de connexion : avant l'ouverture de session, aussi après rechargement
    lock(t1)
    assert logo_src(t1, '.auth-card .logo').startswith('data:image/png') and 'is-custom' in t1.get_attribute('.auth-card .logo', 'class')
    t1.reload()
    t1.wait_for_selector('#loginBtn')
    assert logo_src(t1, '.auth-card .logo').startswith('data:image/png')
    unlock(t1)

    # Autre tablette : le logo arrive avec le fichier d'échange (avec un opérateur ajouté sur le terrain, sans doublon)
    js(t1, """const O = await import('./js/app/operators.js');
        const prep = O.planNewOperator('prov-HYDRECO', { lastName: 'Bernard', firstName: 'Nadia', initials: 'NB', fn: 'Technicienne' });
        await O.saveNewOperator(prep, { context: 'test' });""")
    f1 = send(t1, tmp_path)
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    assert logo_src(t2, '#app .logo').endswith('icons/logo-oeg.png'), 'nouvelle tablette : logo de l’OEG'
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(f1))
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    t2.click('#extraForm [data-act=extra-pick][data-u=adupont]')
    t2.fill('#extraForm [name=password]', PASSWORD)
    t2.fill('#extraForm [name=password2]', PASSWORD)
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    wait_view(t2)
    t2.wait_for_function("() => (document.querySelector('.app-top .logo')?.getAttribute('src') || '').startsWith('data:image/png')")
    assert js(t2, "return store.get('setting', 'org').logo.sha256;") == logo['sha256']
    assert js(t2, "return store.filter('operator', o => o.providerId === 'prov-HYDRECO' && o.code === 'NB').map(o => [o.id, o.firstName, o.lastName]);") == [['op-HYDRECO-NB', 'Nadia', 'Bernard']]
    assert len(operators(t2)) == 10, 'aucun doublon'

    # « Rétablir le logo OEG » : transmis aussi
    goto_hash(t1, '#/administration')
    t1.click('#logoReset')
    t1.click('.modal [data-act=yes]')
    t1.wait_for_selector('#logoReset', state='detached')
    assert logo_src(t1, '.app-top .logo').endswith('icons/logo-oeg-rond.png') and 'is-custom' not in t1.get_attribute('.app-top .logo', 'class')
    assert js(t1, "return store.get('setting', 'org').logo;") is None
    assert t1.evaluate(PDF_LOGO, tour['id'])['tournee'] == [220, 220]
    f2 = send(t1, tmp_path, where='#/synchronisation', button='#xchSend')
    receive(t2, f2)
    t2.wait_for_function("() => (document.querySelector('.app-top .logo')?.getAttribute('src') || '').endsWith('icons/logo-oeg-rond.png')")
    lock(t2)
    assert logo_src(t2, '.auth-card .logo').endswith('icons/logo-oeg.png')
