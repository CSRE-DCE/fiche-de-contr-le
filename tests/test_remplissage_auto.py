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
  3. test_propositions_fiche_station_et_heures (tablette 1280 × 800 puis téléphone 390 × 844) : valeurs seulement
     PROPOSÉES (rien n'est écrit avant l'appui) — moyens d'accès des stations (deux choix), difficultés d'accès,
     supports audités, lot / marché, effectif (F2), sondes et calibration (F4, d'après « Appareils de mesure ») ;
     l'appui applique la valeur, attribuée à l'agent ; fiche de la station modifiée (« Modifier la station ») : bassin
     recalculé dans F3 (« repris de la fiche station »), cours d'eau déjà coté seulement proposé ; « Heure de début »
     de l'onglet Infos rapprochée de « Début du contrôle » (F2.1.5) ; tournée signée et verrouillée : fiche de la
     station modifiée sans effet, sceau intact ; aucun défilement horizontal.
  4. test_echange_sans_doublon_ni_perte (deux tablettes, échange par fichier) : Alice saisit la météo de la journée
     (reprise sur les deux stations), Bruno, sur l'autre tablette, saisit la météo de la station 2 et le niveau d'eau
     et ajoute une station ; après les deux envois : mêmes réponses sur les deux tablettes, une seule tournée, trois
     stations distinctes, saisie de Bruno conservée entière (jamais marquée « repris »), valeur écartée gardée dans le
     rapport de conflits, aucune reprise à la réception (la station ajoutée reçoit seulement une proposition),
     double réception sans effet.
"""
import pytest

from helpers import ATHANASE, EXCHANGE_PASSWORD, answer_required, create_tour, goto_hash, js, open_setup, setup_standalone
from test_tablette_partagee import PW, SAKOURA, add_agent, attr, click_status, login, pdf_texts, switch_agent

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


def take(page, item, text):
    """Bouton « Proposé … » d'un critère (ligne visible) dont le texte contient `text`."""
    loc = row(page, item).locator('[data-act=link-take]', has_text=text)
    assert loc.count() == 1, f'{item} : proposition « {text} » introuvable ({row(page, item).inner_text()[:300]})'
    return loc


def test_propositions_fiche_station_et_heures(make_page, app_url):
    for vp in ({'width': 1280, 'height': 800}, PHONE):
        page = make_page(viewport=vp, label=f'{vp["width"]} px')
        setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
        # Prestation de la station 1 : référence du marché et lot du contrat du prestataire
        js(page, """const p = store.get('prestation', 'pres-BIO-2026-09271503');
            await store.put('prestation', { ...p, marketRef: 'OEG-2026-03A' });
            const h = store.get('provider', 'prov-HYDRECO');
            await store.put('provider', { ...h, contracts: [{ id: 'k1', ref: 'OEG-2026-03A', label: 'Chimie des cours d’eau', lots: 'Lot unique' }] });""")
        tour = create_tour(page, 'ce', [ATHANASE, ACAROUANY], 'prov-HYDRECO', ['pres-BIO-2026-09271503'], operatorIds=['op-HYDRECO-NB', 'op-HYDRECO-DB'])
        aid = tour['id']
        proposed = ['it-F2-3.1', 'it-F2-1.10', 'it-F2-1.13', 'it-F2-1.12', 'it-F2-2.2', 'it-F4-18', 'it-F4-2']
        assert [resp(page, aid, i) for i in proposed] == [None] * len(proposed), 'valeurs seulement proposées : rien n’est écrit'

        # ----- F2 : moyens d'accès (deux choix), difficultés, supports, lot / marché, effectif
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        assert 'Proposé (fiches station)' in row(page, 'it-F2-3.1').inner_text()
        take(page, 'it-F2-3.1', '4x4')
        take(page, 'it-F2-3.1', 'Bateau motorisé / pirogue').click()
        wait_value(page, aid, 'it-F2-3.1', 'Bateau motorisé / pirogue')
        r = resp(page, aid, 'it-F2-3.1')
        assert r['valueManual'] and not r.get('prefilled') and r['byName'] == 'Alice Dupont', r
        page.wait_for_selector(f'[id={attr("row-it-F2-3.1")}] [data-act=link-take], [id={attr("card-it-F2-3.1")}] [data-act=link-take]', state='detached')
        for item, text, value in (('it-F2-1.10', 'Athanase : Roches, Saut Tourépé.', 'Athanase : Roches, Saut Tourépé.'), ('it-F2-1.13', 'eau', 'eau'),
                                  ('it-F2-1.12', 'OEG-2026-03A (Lot unique)', 'OEG-2026-03A (Lot unique)'), ('it-F2-2.2', 'Proposé (F2)', 2)):
            take(page, item, text).click()
            wait_value(page, aid, item, value)
        assert page.evaluate(NO_OVERFLOW), 'F2 sans débordement'

        # ----- F4 : « Appareils de mesure » renseignés → sondes et calibration proposées (communes à la tournée)
        goto_hash(page, f'#/audit/{aid}/feuille-4@{S1}')
        for k, v in (('model', 'WTW 3110'), ('serial', '18250012'), ('calibration', '2026-10-20')):
            page.fill(f'#ins-ph-{k}', v)
            page.locator(f'#ins-ph-{k}').dispatch_event('change')
            page.wait_for_function("([id, k, v]) => (((window.AuditApp.store.get('audit', id).sheets['4'] || {}).instruments || {}).ph || {})[k] === v", arg=[aid, k, v])
        assert resp(page, aid, 'it-F4-18') is None and resp(page, aid, 'it-F4-2') is None
        goto_hash(page, f'#/audit/{aid}/feuille-4@{S2}')
        assert 'Sonde pH : calibration du 20/10/2026' in take(page, 'it-F4-2', 'Proposé (F4)').inner_text()
        take(page, 'it-F4-18', 'WTW 3110 n° 18250012').click()
        wait_value(page, aid, 'it-F4-18', 'Sonde pH : WTW 3110 n° 18250012')
        assert page.evaluate(NO_OVERFLOW), 'F4 sans débordement'

        # ----- Fiche de la station modifiée : bassin recalculé dans F3, cours d'eau déjà coté seulement proposé
        assert resp(page, aid, f'it-F3-1@{S1}')['from'] == 'fiche station'
        goto_hash(page, f'#/audit/{aid}/feuille-3@{S1}')
        assert 'repris de la fiche station' in row(page, f'it-F3-1@{S1}').inner_text()
        row(page, f'it-F3-2@{S1}').locator('[data-act=resp][data-value="C"]').click()
        page.wait_for_function("([id, item]) => (window.AuditApp.store.get('audit', id).responses[item] || {}).status === 'C'", arg=[aid, f'it-F3-2@{S1}'])
        goto_hash(page, f'#/station/{ATHANASE}/modifier')
        page.fill('#seForm [name=bassin]', 'Approuague (bassin corrigé)')
        page.fill('#seForm [name=riverName]', 'Approuague (cours d’eau corrigé)')
        page.fill('#seForm [name=reason]', 'Correction du référentiel (test)')
        page.click('#seForm button[type=submit]')
        page.wait_for_function("() => location.hash === '#/station/site-09271503'")
        r = resp(page, aid, f'it-F3-1@{S1}')
        assert r['value'] == 'Approuague (bassin corrigé)' and r['prefilled'] and r['fromId'] == f'@site@{S1}' and r['byName'] == 'Alice Dupont', r
        assert resp(page, aid, f'it-F3-2@{S1}')['value'] == 'Approuague' and resp(page, aid, f'it-F3-2@{S1}')['status'] == 'C', 'valeur cotée jamais remplacée'
        assert resp(page, aid, f'it-F3-1@{S2}')['value'] == 'Mana', 'autre station inchangée'
        goto_hash(page, f'#/audit/{aid}/feuille-3@{S1}')
        assert 'Proposé (fiche station) : Approuague (cours d’eau corrigé)' in ' '.join(take(page, f'it-F3-2@{S1}', 'corrigé').inner_text().split())
        assert js(page, "return store.all('trail').some(t => t.entityType === 'audit' && /informations de la station 09271503 reprises dans la tournée/.test(t.reason || ''));")

        # ----- « Heure de début » de l'onglet Infos = « Début du contrôle » (F2.1.5)
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        control(page, 'it-F2-1.5').fill('07:45')
        control(page, 'it-F2-1.5').dispatch_event('change')
        wait_value(page, aid, 'it-F2-1.5', '07:45')
        goto_hash(page, f'#/audit/{aid}/infos')
        assert '07:45 (début du contrôle, F2.1.5) — saisie démarrée' in page.inner_text('#view')
        assert page.evaluate(NO_OVERFLOW), 'Infos sans débordement'

        # ----- Tournée signée et verrouillée : la fiche de la station change, la tournée non (sceau intact)
        answer_required(page, aid)
        js(page, """await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
            await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
            await A.lockAudit(store.get('audit', arg));""", aid)
        before = js(page, "return JSON.stringify(store.get('audit', arg).responses);", aid)
        n = js(page, """const s = store.get('site', arg.site); await store.put('site', { ...s, bassin: 'Autre bassin' }, { reason: 'test' });
            return A.refreshStationInfo([arg.site]);""", {'site': ATHANASE})
        assert n == 0
        seal = js(page, "const v = await A.verifyAuditSeal(store.get('audit', arg)); return { ok: v.ok, amended: v.amended };", aid)
        assert seal == {'ok': True, 'amended': False} and js(page, "return JSON.stringify(store.get('audit', arg).responses);", aid) == before
        page.close()


def second_tablet(make_page, app_url, path, username):
    """Tablette supplémentaire mise en service avec le fichier `path` : l'agent `username` choisit son profil."""
    from test_echange_tablettes import tablet
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(path))
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    t2.click(f'#extraForm [data-act=extra-pick][data-u={username}]')
    t2.fill('#extraForm [name=password]', PW[username])
    t2.fill('#extraForm [name=password2]', PW[username])
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    return t2


@pytest.mark.lent
def test_echange_sans_doublon_ni_perte(make_page, app_url, tmp_path):
    from test_echange_tablettes import receive, send, tablet
    S3 = SAKOURA.replace('site-', '')
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    bruno = add_agent(t1, 'Martin', 'Bruno', 'bmartin')
    tour = create_tour(t1, 'ce', [ATHANASE, ACAROUANY], 'prov-HYDRECO', controllerIds=[bruno], operatorIds=['op-HYDRECO-NB'])
    aid = tour['id']
    t2 = second_tablet(make_page, app_url, send(t1, tmp_path), 'bmartin')

    # Tablette 1 (Alice) : météo de la journée → F1.R5 des deux stations → F3.7
    goto_hash(t1, f'#/audit/{aid}/feuille-2')
    control(t1, 'it-F2-1.9').select_option('Pluie forte')
    wait_value(t1, aid, f'it-F3-7@{S2}', 'Pluie forte')
    # Tablette 2 (Bruno), ensuite : météo de la station 2 saisie à la main, niveau d'eau de la journée, 3e station
    goto_hash(t2, f'#/audit/{aid}/feuille-1@{S2}')
    control(t2, f'it-F1-R5@{S2}', ('r',)).select_option('Couvert')
    wait_value(t2, aid, f'it-F3-7@{S2}', 'Couvert')
    goto_hash(t2, f'#/audit/{aid}/feuille-2')
    control(t2, 'it-F2-1.8').select_option('Hautes eaux')
    wait_value(t2, aid, f'it-F1-R6@{S2}', 'Hautes eaux')
    js(t2, "await A.addStation(store.get('audit', arg.id), { siteId: arg.site });", {'id': aid, 'site': SAKOURA})

    # Tablette 2 → tablette 1, puis tablette 1 → tablette 2
    _, report = receive(t1, send(t2, tmp_path))
    assert 'tournée mise à jour' in report, report
    f3 = send(t1, tmp_path)
    receive(t2, f3)

    expect = {
        'it-F2-1.9': ('Pluie forte', False), 'it-F2-1.8': ('Hautes eaux', False),
        f'it-F1-R5@{S1}': ('Pluie forte', True), f'it-F3-7@{S1}': ('Pluie forte', True),
        f'it-F1-R5@{S2}': ('Couvert', False), f'it-F3-7@{S2}': ('Couvert', True),
        f'it-F1-R6@{S1}': ('Hautes eaux', True), f'it-F1-R6@{S2}': ('Hautes eaux', True)
    }
    states = []
    for t in (t1, t2):
        a = js(t, """const a = store.get('audit', arg);
            return { audits: store.all('audit').filter(x => x.id === arg || x.number === a.number).length, stations: a.stations.map(s => s.key),
                     operators: store.all('operator').length, opIds: new Set(store.all('operator').map(o => o.id)).size, responses: a.responses };""", aid)
        assert a['audits'] == 1 and a['stations'] == [S1, S2, S3] and a['operators'] == a['opIds'], 'sans doublon : une tournée, trois stations, opérateurs uniques'
        for item, (value, reprise) in expect.items():
            r = a['responses'][item]
            assert r['value'] == value and bool(r.get('prefilled')) == reprise, (t, item, r)
        r = a['responses'][f'it-F1-R5@{S2}']
        assert r['valueManual'] and r['byName'] == 'Bruno Martin' and 'from' not in r and 'fromId' not in r, f'saisie de Bruno conservée entière : {r}'
        assert f'it-F1-R5@{S3}' not in a['responses'], 'aucune reprise à la réception'
        states.append(a['responses'])
    assert states[0] == states[1], 'mêmes réponses sur les deux tablettes'
    # Valeur écartée (« Pluie forte » reprise sur la station 2) gardée dans le rapport de conflits de la tablette 1
    kept = js(t1, "return store.all('conflict').flatMap(c => c.details).filter(d => d.path === 'responses.it-F1-R5@' + arg + '.value').map(d => [d.localValue, d.remoteValue, d.kept]);", S2)
    assert kept == [['Pluie forte', 'Couvert', 'remote']], kept
    # Station ajoutée sur l'autre tablette : la météo de la journée y est seulement proposée
    goto_hash(t1, f'#/audit/{aid}/feuille-1@{S3}')
    assert 'Proposé (F2.1.9) : Pluie forte' in ' '.join(take(t1, f'it-F1-R5@{S3}', 'Pluie forte').inner_text().split())
    # Double réception : sans effet
    before = js(t2, "return JSON.stringify(store.get('audit', arg));", aid)
    preview, report = receive(t2, f3)
    assert 'déjà été reçu' in preview and 'aucun changement' in report, (preview, report)
    assert js(t2, "return JSON.stringify(store.get('audit', arg));", aid) == before
