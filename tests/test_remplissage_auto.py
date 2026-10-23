"""Demandes de l'OEG des 14/10 et 16/10/2026 (étape 2/3) : remplissage automatique des informations redondantes entre
les feuilles d'une tournée et reprise, à la demande, des réponses de la station précédente (js/domain/links.js).

  1. test_remplissage_automatique_entre_feuilles (tablette 1280 × 900 puis téléphone 390 × 844) : tournée « cours
     d'eau » à deux stations (Athanase, Acarouany) créée par Alice, binôme avec Bruno (auditeur) qui saisit :
     - F2 › « Conditions météo » « Pluie forte » → « Météo » (F1) des deux stations, puis « Conditions météo » (F3.7)
       de chaque station, marqués « repris de F2.1.9 » / « repris de F1.R5 » et attribués à Bruno ;
     - la météo de la station 2 corrigée à la main n'est plus jamais remplacée : nouvelle valeur de F2 → la station 1
       suit, la station 2 garde sa saisie et propose « Proposé (F2.1.9) : Orage » (appliqué seulement sur appui) ;
     - « Date mission » corrigée → « Date » (F1) des deux stations, « Jour » (F2.5.1), « Date des prélèvements » (F3.14)
       et le PDF des fiches suivent ;
     - préleveur coché sur la carte « Préleveurs du prestataire » de F2 → « Opérateurs HYDRECO » (F1), « Membres de
       l'équipe » (F3.12), « Préleveur(s) / fonction » (F4.1) et l'encadré « Agent(s) prestataire(s) / fonction » de F4 ;
     - tournée signée et verrouillée : une modification motivée de F2 n'est plus reprise ailleurs ;
     - aucun défilement horizontal.
  2. test_reprise_station_precedente : F4 de la station 2 « Reprendre les réponses de la station précédente » :
     confirmation, points vides seulement (un point déjà coté reste), statut et observation repris, jamais la mesure,
     chaque reprise marquée « repris de la station 1 » et attribuée à l'agent ; une reprise modifiée n'est plus
     marquée ; pas de bouton sur la station 1 ni sur une tournée verrouillée.
"""
from helpers import ATHANASE, answer_required, create_tour, goto_hash, js, setup_standalone
from test_tablette_partagee import add_agent, attr, click_status, login, pdf_texts, switch_agent

ACAROUANY = 'site-09160201'
S1, S2 = '09271503', '09160201'
TABLET = {'width': 1280, 'height': 900}
PHONE = {'width': 390, 'height': 844}
NO_OVERFLOW = '() => document.documentElement.scrollWidth <= window.innerWidth + 1'


def resp(page, audit_id, item_id):
    return js(page, "return (store.get('audit', arg.id).responses || {})[arg.item] || null;", {'id': audit_id, 'item': item_id})


def control(page, item, pfx=('t', 'k', 'r')):
    """Champ « Valeur / réponse » visible d'un critère (tableau ≥ 1100 px, carte en dessous, repères de F1)."""
    for p in pfx:
        loc = page.locator(f'[id={attr(f"{p}-{item}")}]')
        if loc.count() and loc.first.is_visible():
            return loc.first
    raise AssertionError(f'champ de {item} introuvable')


def row(page, item):
    """Ligne visible d'un critère : ligne de tableau ou de repères (row-…), sinon carte (card-…)."""
    for sel in (f'[id={attr("row-" + item)}]', f'[id={attr("card-" + item)}]'):
        loc = page.locator(sel)
        if loc.count() and loc.first.is_visible():
            return loc.first
    raise AssertionError(f'ligne de {item} introuvable')


def wait_value(page, audit_id, item, value):
    page.wait_for_function("([id, item, v]) => JSON.stringify(((window.AuditApp.store.get('audit', id).responses || {})[item] || {}).value ?? null) === JSON.stringify(v)",
                           arg=[audit_id, item, value])


def tour_setup(page, app_url):
    """Alice crée une tournée cours d'eau à deux stations (HYDRECO, préleveur NB), en binôme avec Bruno qui saisit."""
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    bruno = add_agent(page, 'Martin', 'Bruno', 'bmartin')
    tour = create_tour(page, 'ce', [ATHANASE, ACAROUANY], 'prov-HYDRECO', controllerIds=[bruno], operatorIds=['op-HYDRECO-NB'])
    switch_agent(page)
    login(page, 'bmartin')
    return tour


def test_remplissage_automatique_entre_feuilles(make_page, app_url):
    for vp in (TABLET, PHONE):
        page = make_page(viewport=vp, label=f'{vp["width"]} px')
        tour = tour_setup(page, app_url)
        aid = tour['id']
        # À la création : date, contrôleurs et préleveur repris dans les feuilles des stations.
        r1 = resp(page, aid, f'it-F1-R1@{S1}')
        assert r1['prefilled'] and r1['from'] == 'F2.1.4', r1
        assert resp(page, aid, f'it-F1-R3@{S2}')['value'] == 'Alice Dupont, Bruno Martin'
        assert resp(page, aid, f'it-F4-1@{S2}')['from'] == 'F1.R4'

        # ----- Météo de la journée (F2) → F1.R5 de chaque station → F3.7 de la même station
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        control(page, 'it-F2-1.9').select_option('Pluie forte')
        wait_value(page, aid, f'it-F3-7@{S2}', 'Pluie forte')
        for k in (S1, S2):
            r = resp(page, aid, f'it-F1-R5@{k}')
            assert r['value'] == 'Pluie forte' and r['prefilled'] and r['from'] == 'F2.1.9' and r['byName'] == 'Bruno Martin', r
            r = resp(page, aid, f'it-F3-7@{k}')
            assert r['value'] == 'Pluie forte' and r['from'] == 'F1.R5' and r['fromId'] == f'it-F1-R5@{k}', r
        goto_hash(page, f'#/audit/{aid}/feuille-1@{S1}')
        assert control(page, f'it-F1-R5@{S1}', ('r',)).input_value() == 'Pluie forte'
        badge = row(page, f'it-F1-R5@{S1}').locator('.as-from')
        assert badge.inner_text().strip() == 'repris de F2.1.9' and 'Conditions météo' in badge.get_attribute('title')
        assert page.evaluate(NO_OVERFLOW), 'F1 sans débordement'
        goto_hash(page, f'#/audit/{aid}/feuille-3@{S1}')
        assert 'repris de F1.R5' in row(page, f'it-F3-7@{S1}').inner_text()
        assert page.evaluate(NO_OVERFLOW), 'F3 sans débordement'

        # ----- Station 2 corrigée à la main : jamais remplacée ensuite, la nouvelle valeur est seulement proposée
        goto_hash(page, f'#/audit/{aid}/feuille-1@{S2}')
        control(page, f'it-F1-R5@{S2}', ('r',)).select_option('Couvert')
        wait_value(page, aid, f'it-F3-7@{S2}', 'Couvert')
        r = resp(page, aid, f'it-F1-R5@{S2}')
        assert r['valueManual'] and not r.get('prefilled') and not r.get('from'), r
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        control(page, 'it-F2-1.9').select_option('Orage')
        wait_value(page, aid, f'it-F1-R5@{S1}', 'Orage')
        assert resp(page, aid, f'it-F3-7@{S1}')['value'] == 'Orage'
        assert resp(page, aid, f'it-F1-R5@{S2}')['value'] == 'Couvert' and resp(page, aid, f'it-F3-7@{S2}')['value'] == 'Couvert'
        goto_hash(page, f'#/audit/{aid}/feuille-1@{S2}')
        take = row(page, f'it-F1-R5@{S2}').locator('[data-act=link-take]')
        assert 'Proposé (F2.1.9) : Orage' in ' '.join(take.inner_text().split())
        assert row(page, f'it-F1-R5@{S2}').locator('.as-from').count() == 0
        take.click()
        wait_value(page, aid, f'it-F1-R5@{S2}', 'Orage')
        page.wait_for_selector(f'[id={attr("row-it-F1-R5@" + S2)}] [data-act=link-take]', state='detached')

        # ----- Date de la tournée corrigée : F1 des deux stations, F2.5.1, F3.14 et le PDF des fiches suivent
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        control(page, 'it-F2-1.4').fill('2026-10-01')
        wait_value(page, aid, f'it-F1-R1@{S2}', '2026-10-01')
        for item in ('it-F2-5.1', f'it-F1-R1@{S1}', f'it-F3-14@{S1}', f'it-F3-14@{S2}'):
            r = resp(page, aid, item)
            assert r['value'] == '2026-10-01' and r['from'] == 'F2.1.4', (item, r)
        if vp is TABLET:
            texts = pdf_texts(page, "const { generateSheetsPdf } = await import('./js/app/sheets-pdf.js'); await generateSheetsPdf({ auditId: arg });", aid)
            joined = ' '.join(texts)
            assert '01/10/2026' in joined and '18/10/2026' not in joined, 'PDF : date corrigée partout (F1, F2, F3)'

        # ----- Préleveurs (carte de F2) → F1.R4 → F3.12, F4.1 et encadré « Agent(s) prestataire(s) / fonction »
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        page.check('#tourOperators input[value="op-HYDRECO-DB"]')
        page.wait_for_function("([id, item]) => /DB/.test((window.AuditApp.store.get('audit', id).responses[item] || {}).value || '')", arg=[aid, f'it-F4-1@{S2}'])
        team = resp(page, aid, f'it-F1-R4@{S1}')['value']
        assert 'NB' in team and 'DB' in team, team
        for item in (f'it-F3-12@{S1}', f'it-F4-1@{S1}', f'it-F3-12@{S2}'):
            assert resp(page, aid, item)['value'] == team, item
        assert resp(page, aid, 'it-F2-2.1')['value'] == f'HYDRECO : {team}'
        goto_hash(page, f'#/audit/{aid}/feuille-4@{S1}')
        agents = page.locator(f'[id={attr("sheet-4@" + S1 + "-agents")}]')
        assert agents.input_value() == team
        assert 'repris de F1.R4' in page.inner_text('.as-instr')
        assert page.evaluate(NO_OVERFLOW), 'F4 sans débordement'

        # ----- Tournée signée et verrouillée : plus aucune reprise (modification motivée de F2)
        switch_agent(page)
        login(page, 'adupont', 'motdepasse-test')
        answer_required(page, aid)
        js(page, """let a = store.get('audit', arg);
            a = await A.signAudit(a, 'auditor', { name: session.user.name });
            await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
            await A.lockAudit(store.get('audit', arg));""", aid)
        before = {k: resp(page, aid, f'it-F1-R5@{k}')['value'] for k in (S1, S2)}
        js(page, "await A.setResponse(store.get('audit', arg), 'it-F2-1.9', { value: 'Ensoleillé' }, { reason: 'Météo corrigée après signature (test)' });", aid)
        assert resp(page, aid, 'it-F2-1.9')['value'] == 'Ensoleillé'
        assert {k: resp(page, aid, f'it-F1-R5@{k}')['value'] for k in (S1, S2)} == before, 'aucune reprise sur une tournée verrouillée'
        page.close()


def test_reprise_station_precedente(page, app_url):
    tour = tour_setup(page, app_url)
    aid = tour['id']
    # Station 1, feuille 4 : trois points cotés (dont un NC avec observation et mesure)
    goto_hash(page, f'#/audit/{aid}/feuille-4@{S1}')
    assert page.locator('#copyPrev').count() == 0, 'pas de reprise sur la première station'
    click_status(page, f'it-F4-3@{S1}', 'C')
    click_status(page, f'it-F4-7@{S1}', 'C')
    js(page, """await A.setResponse(store.get('audit', arg.id), arg.item, { status: 'NC', comment: 'pH mesuré hors de l’écoulement', value: 7.2 });""",
       {'id': aid, 'item': f'it-F4-4@{S1}'})
    # Station 2 : un point déjà coté par l'agent (jamais remplacé)
    goto_hash(page, f'#/audit/{aid}/feuille-4@{S2}')
    click_status(page, f'it-F4-7@{S2}', 'NC')
    js(page, "await A.setResponse(store.get('audit', arg.id), arg.item, { comment: 'Température non relevée' });", {'id': aid, 'item': f'it-F4-7@{S2}'})
    goto_hash(page, f'#/audit/{aid}/feuille-4@{S2}')
    note = page.inner_text('#copyPrev')
    assert 'Reprendre les réponses de la station précédente' in note and 'ATHANASE' in note.upper() and '2 points encore vides' in note, note
    page.click('#copyPrev [data-act=copy-prev]')
    page.wait_for_selector('.modal')
    assert 'jamais reprises' in page.inner_text('.modal')
    page.click('.modal [data-act=yes]')
    page.wait_for_function("([id, item]) => !!(window.AuditApp.store.get('audit', id).responses[item] || {}).copiedFrom", arg=[aid, f'it-F4-4@{S2}'])
    r = resp(page, aid, f'it-F4-4@{S2}')
    assert r['status'] == 'NC' and r['comment'] == 'pH mesuré hors de l’écoulement' and 'value' not in r, r
    assert r['copiedFrom']['stationKey'] == S1 and r['byName'] == 'Bruno Martin' and r['copiedFrom']['byName'] == 'Bruno Martin', r
    assert resp(page, aid, f'it-F4-3@{S2}')['status'] == 'C'
    r = resp(page, aid, f'it-F4-7@{S2}')
    assert r['status'] == 'NC' and r['comment'] == 'Température non relevée' and 'copiedFrom' not in r, 'point déjà coté inchangé'
    assert 'repris de la station 1' in row(page, f'it-F4-4@{S2}').inner_text()
    assert page.locator('#copyPrev').count() == 0, 'plus aucun point vide à reprendre'
    assert js(page, "return store.all('trail').some(t => t.entityType === 'audit' && /Réponses de la station 1 \\(Athanase\\) reprises pour la feuille 4 : 2 point/.test(t.reason || ''));")
    # Une reprise modifiée par l'agent n'est plus marquée
    click_status(page, f'it-F4-3@{S2}', 'P')
    assert 'copiedFrom' not in resp(page, aid, f'it-F4-3@{S2}')
    # Tournée verrouillée : plus de bouton
    js(page, "await A.updateAudit(store.get('audit', arg), a => { a.lock = { lockedAt: new Date().toISOString() }; a.status = 'signe'; });", aid)
    goto_hash(page, f'#/audit/{aid}/feuille-4@{S2}')
    assert page.locator('#copyPrev').count() == 0
