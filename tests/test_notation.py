"""Note sur 20 des fiches de contrôle (demande de l'OEG du 14/10/2026 « Mettre une grille de notation pour chaque fiche
d'évaluation » ; règles validées par l'OEG le 23/10/2026 : C = 1, P = 0,5, NC = 0, N/A non compté, 26 points majeurs
× 2, points de synthèse hors note, note au dixième, appréciation ≥ 16 « Satisfaisant », 12 à < 16 « À améliorer »,
< 12 « Insuffisant », seuils modifiables en Administration, note figée à la signature). Le calcul lui-même est vérifié
par tests/unit/grading.test.js.

  1. test_saisie_grille_de_notation_et_synthese (tablette 1280 × 800 puis téléphone 390 × 844) : badge « Majeur (×2) »
     sur les points majeurs (F4.2 commun à la tournée, F4.12), pas sur les autres ; encadré « Grille de notation » en
     pied de la feuille 4, « non noté » puis mis à jour à chaque cote (C, P, NC, N/A, évalués dont majeurs, points,
     note, appréciation) ; un point commun à la tournée compte dans la note de chaque feuille 4 mais une fois dans la
     note de la tournée ; synthèse : note provisoire de la tournée, colonnes « Note /20 » par station et par feuille ;
     feuille sans point coté (F1) sans encadré ; aucun défilement horizontal.
  2. test_pdf_rapport_et_exports : PDF des fiches (grille sous chaque feuille cotée — encadré, ou ligne compacte en bas
     de page faute de place —, badge « Majeur ×2 », note de la tournée et colonnes « Note /20 » de la synthèse), fiches
     vierges (grille à remplir), rapport détaillé (note, colonnes, règle), exports (colonnes « Note /20 », « Appréciation »… du tableau des audits, CSV en virgule décimale,
     classeur Excel avec la feuille « Notes »).
  3. test_seuils_signature_tournee_ancienne_et_tableau_de_bord : Administration › « Note sur 20 » (refus de seuils
     incohérents, enregistrement) ; une tournée en cours suit les nouveaux seuils, une tournée signée garde la note et les
     seuils figés à sa signature (dans le contenu scellé : sceau vérifié) ; tournée signée avant la notation (sans note
     figée) : sceau intact, note « calculée » ; modification tracée après la signature : note « recalculée », note à la
     signature rappelée ; tableau de bord : moyennes par prestataire et par réseau des tournées signées, liste des
     tournées d'une moyenne ; téléphone sans défilement horizontal.
  4. test_note_dans_les_listes (validé par l'OEG le 24/10/2026 ; tablette 1280 × 800 puis téléphone 390 × 844) :
     liste « Audits » — badge « 18,0 / 20 · Satisfaisant » aux couleurs de l'appréciation (tournée signée, note figée),
     « calculée » (tournée signée avant la notation), note provisoire en gris « provisoire », « non noté » discret,
     rien sur une tournée annulée ; « Trier : Date | Note décroissante | Note croissante » (aria-pressed, combiné aux
     filtres, conservé par « Effacer », tournées non notées en dernier) ; badge mis à jour après une saisie et après un
     changement des seuils (mémoire par tournée) ; accueil — note de la dernière tournée signée à côté de « Dernière
     tournée » (note de la station, « Tournée » à défaut), « Dernière tournée signée » pendant une tournée en cours,
     rien dans « Tournées en cours sur cette tablette », recherche sans réaffichage ; aucun défilement horizontal.
"""
import re
import zipfile

import pytest

from helpers import ATHANASE, answer_required, create_tour, goto_hash, js, setup_standalone
from test_parcours import pdf_texts

TABLET = {'width': 1280, 'height': 800}
PHONE = {'width': 390, 'height': 844}
K = '09271503'
NO_OVERFLOW = '() => document.documentElement.scrollWidth <= window.innerWidth + 1'
PRES_BIO = 'pres-BIO-2026-09271503'      # programme RCS ESC BIO 2026 (HYDRECO), réseau BIO


def by_id(value):
    """Sélecteur d'un identifiant contenant « @ » ou « . »."""
    return f'[id="{value}"]'


def set_status(page, item, value):
    """Cote un critère par son bouton visible (ligne de tableau ≥ 1100 px, carte en dessous)."""
    page.locator(f'[data-act=resp][data-item="{item}"][data-value="{value}"]:visible').first.click()
    page.wait_for_function("([i, v]) => [...document.querySelectorAll(`[data-act=resp][data-value='${v}']`)].some(b => b.dataset.item === i && b.getAttribute('aria-pressed') === 'true')", arg=[item, value])


def box(page, key):
    return page.locator(by_id(f'gradeBox-{key}'))


def wait_grade(page, key, text):
    page.wait_for_function("([id, t]) => document.getElementById(id)?.dataset.grade === t", arg=[f'gradeBox-{key}', text])


def flat(text):
    return ' '.join(text.split())


def grading(page, aid):
    return js(page, """const a = store.get('audit', arg); const st = A.auditState(a); const r = st.summary.grading;
        return { state: r.state, text: r.tour.text, label: r.tour.label, n10: r.tour.n10, thresholds: r.thresholds, record: a.grading || null };""", aid)


def lower_to(page, aid, n10_max, *, start=0):
    """Passe en NC (avec observation) des points ordinaires de la tournée, un à un, jusqu'à une note ≤ n10_max / 10."""
    return js(page, """const { isMajorItem, isNoScoreItem } = await import('./js/domain/grading.js');
        let a = store.get('audit', arg.id);
        const st0 = A.auditState(a);
        const items = st0.sheets.flatMap(s => s.items).filter(i => i.kind === 'conformity' && !isMajorItem(i, st0.scoring) && !isNoScoreItem(i, st0.scoring) && a.responses[i.id]?.status === 'C');
        let n = 0;
        for (const it of [...new Map(items.map(i => [i.id, i])).values()].slice(arg.start)) {
          await A.setResponse(store.get('audit', arg.id), it.id, { status: 'NC', comment: 'Écart constaté (test)' });
          n++;
          if (A.auditState(store.get('audit', arg.id)).summary.grade.n10 <= arg.max) break;
        }
        return { n, n10: A.auditState(store.get('audit', arg.id)).summary.grade.n10 };""", {'id': aid, 'max': n10_max, 'start': start})


def sign_lock(page, aid):
    return js(page, """await A.finishAudit(store.get('audit', arg));
        await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
        await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
        const a = await A.lockAudit(store.get('audit', arg));
        const seal = await A.verifyAuditSeal(a);
        return { ok: seal.ok, lock: a.lock.contentHash, sig: a.signatures.auditor.contentHash, hash: await A.auditContentHash(a), sealedGrading: !!A.auditContent(a).audit.grading };""", aid)


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_saisie_grille_de_notation_et_synthese(make_page, app_url):
    for vp in (TABLET, PHONE):
        page = make_page(viewport=vp, label=f'{vp["width"]} px')
        setup_standalone(page, app_url)
        tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', [PRES_BIO])
        aid = tour['id']
        goto_hash(page, f'#/audit/{aid}/feuille-4@{K}')
        row = (lambda i: f'#row-{i}') if vp is TABLET else (lambda i: f'#card-{i}')
        # Badges « Majeur (×2) » : F4.2 (commun à la tournée, majeur), F4.12 (majeur) ; F4.14 et F4.5 ordinaires
        assert page.locator(f'{by_id(row("it-F4-2")[1:])} .major-badge').is_visible()
        assert page.locator(f'{by_id(row(f"it-F4-12@{K}")[1:])} .major-badge').is_visible()
        assert page.locator(f'{by_id(row(f"it-F4-5@{K}")[1:])} .major-badge').count() == 0
        assert page.locator(f'{by_id(row("it-F4-14")[1:])} .major-badge').count() == 0
        assert 'Majeur (×2)' in page.inner_text(by_id(row(f'it-F4-12@{K}')[1:]))
        b = box(page, f'4@{K}')
        assert b.is_visible() and b.get_attribute('data-grade') == 'non noté'
        assert 'Grille de notation' in b.inner_text() and 'aucun point évalué' in b.inner_text()
        # Cotes : F4.12 C (×2), F4.2 NC (×2, commun), F4.5 P, F4.27 NC (synthèse, hors note), F4.6 N/A
        set_status(page, f'it-F4-12@{K}', 'C'); wait_grade(page, f'4@{K}', '20,0')
        set_status(page, 'it-F4-2', 'NC'); wait_grade(page, f'4@{K}', '10,0')
        set_status(page, f'it-F4-5@{K}', 'P'); wait_grade(page, f'4@{K}', '10,0')
        set_status(page, f'it-F4-27@{K}', 'NC')
        set_status(page, f'it-F4-6@{K}', 'NA')
        t = flat(box(page, f'4@{K}').inner_text())
        assert re.search(r'C 1 P 1 NC 2 N/A 1', t, re.I), t
        assert 'dont 2 majeurs ×2' in t and '2,5 / 5' in t and 'Insuffisant' in t, t
        assert '1 point de synthèse coté hors note' in t and 'note provisoire' in t, t
        assert '≥ 16 Satisfaisant · 12 à < 16 À améliorer · < 12 Insuffisant' in t, t
        assert 'lvl-poor' in box(page, f'4@{K}').get_attribute('class')
        assert page.evaluate(NO_OVERFLOW), f'{vp["width"]} px : feuille 4'
        # Feuille 1 (aucun point coté) : pas d'encadré ; feuille 5 : « non noté »
        goto_hash(page, f'#/audit/{aid}/feuille-1@{K}')
        assert page.locator('.grade-box').count() == 0
        goto_hash(page, f'#/audit/{aid}/feuille-5@{K}')
        assert box(page, f'5@{K}').get_attribute('data-grade') == 'non noté'
        # Synthèse : note provisoire de la tournée (chaque point une fois), notes par station et par feuille
        goto_hash(page, f'#/audit/{aid}/synthese')
        tg = flat(page.inner_text('#tourGrade'))
        assert '10,0 / 20' in tg and 'Insuffisant' in tg and 'Note provisoire' in tg, tg
        assert page.locator('#tourGradeBox').get_attribute('data-grade') == '10,0'
        stations = flat(page.inner_text('.as-sum'))
        assert 'NOTE /20' in stations.upper() and 'Commun à la tournée' in stations, stations
        pills = page.eval_on_selector_all('.as-sum .grade-pill', 'els => els.map(e => e.textContent.trim())')
        assert pills[:3] == ['0,0', '16,7', '10,0'], ('commun (F4.2 NC) · station (F4.12 C ×2 + F4.5 P) · tournée', pills)
        sheets = page.locator('.as-sum').nth(1)
        assert '10,0' in flat(sheets.locator(f'tr:has(a[href$="feuille-4@{K}"])').inner_text())
        assert page.evaluate(NO_OVERFLOW), f'{vp["width"]} px : synthèse'


@pytest.mark.lent
def test_pdf_rapport_et_exports(page, app_url, tmp_path):
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', [PRES_BIO])
    aid = tour['id']
    answer_required(page, aid)
    r = lower_to(page, aid, 175)
    g = grading(page, aid)
    assert g['state'] == 'provisoire' and 160 <= g['n10'] <= 175 and g['label'] == 'Satisfaisant', (r, g)
    note = g['text']
    n = js(page, "const sh = A.auditState(store.get('audit', arg)).sheets; return { all: sh.length, rated: sh.filter(s => s.items.some(i => i.kind === 'conformity')).length };", aid)
    assert n['rated'] == n['all'] - 1 >= 5, ('toutes les feuilles sauf F1 sont cotées', n)
    # ----- PDF des fiches : encadré sous chaque feuille cotée, badges, synthèse
    texts = pdf_texts(page, "await (await import('./js/app/sheets-pdf.js')).generateSheetsPdf({ auditId: arg });", aid)
    assert texts.count('Grille de notation') == n['rated'], ('une grille par feuille cotée', texts.count('Grille de notation'), n)
    # Note de chaque feuille (encadré complet, ou ligne compacte en bas de page faute de place) et badges des points majeurs
    assert len([t for t in texts if re.fullmatch(r'\d{1,2},\d / 20 — (Satisfaisant|À améliorer|Insuffisant)', t)]) == n['rated'] and 'Majeur ×2' in texts
    assert 'NOTE DE LA TOURNÉE' in texts and f'{note} / 20' in texts and 'NOTE SUR 20 ET DÉCOMPTES C / P / NC / N/A' in texts
    assert any(t.startswith('C = 1 point · P = 0,5 · NC = 0 · N/A non compté') and '16 et plus « Satisfaisant »' in t for t in texts)
    assert texts.count('Note /20') >= 2, 'colonnes « Note /20 » par station et par feuille'
    assert not any('sans score' in t for t in texts)
    # Fiches vierges : grilles de notation à remplir (seuils actuels)
    blank = pdf_texts(page, "await (await import('./js/app/sheets-pdf.js')).generateBlankSheetsPdf({ siteId: arg, auditType: 'bio' });", ATHANASE)
    assert blank.count('Grille de notation') >= 5 and '……… / 20' in blank and 'Majeur ×2' in blank
    # ----- Rapport détaillé
    rep = pdf_texts(page, "await (await import('./js/app/report.js')).buildAuditReport(arg);", aid)
    assert 'Note de la tournée (sur 20)' in rep and 'Décomptes et notes par station (C / P / NC / N/A, note sur 20)' in rep
    assert f'{note} — Satisfaisant' in rep and 'provisoire (tournée non signée)' in rep
    assert not any('Aucun score global' in t for t in rep)
    # ----- Exports : tableau des audits, CSV (virgule décimale), classeur Excel avec la feuille « Notes »
    ex = js(page, """const E = await import('./js/app/exports.js'); const l = [store.get('audit', arg)];
        const t = E.table('audits', l), c = l => t[1][t[0].indexOf(l)];
        const notes = E.gradesRows(E.auditsWithSummary(l));
        return { note: c('Note /20'), label: c('Appréciation'), state: c('État de la note'), majors: c('dont points majeurs (×2)'), csv: E.csvOf('audits', l),
          portees: notes.slice(1).map(r => r[4]), head: notes[0] };""", aid)
    assert ex['note'] == g['n10'] / 10 and ex['label'] == 'Satisfaisant' and ex['state'] == 'provisoire (tournée non signée)' and ex['majors'] > 0, ex
    assert 'Note /20;Appréciation' in ex['csv'] and f';{note};Satisfaisant;' in ex['csv']
    assert ex['portees'][:3] == ['Tournée', 'Commun à la tournée', 'Station'] and ex['portees'].count('Feuille') == n['all'], ex['portees']
    goto_hash(page, '#/export')
    with page.expect_download() as dl:
        page.click('[data-act=xlsx][data-k=audits]')
    path = tmp_path / 'audits.xlsx'
    dl.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        wb = z.read('xl/workbook.xml').decode('utf-8')
        strings = ' '.join(z.read(n).decode('utf-8') for n in z.namelist() if n.startswith('xl/') and n.endswith('.xml'))
    assert re.findall(r'<sheet name="([^"]+)"', wb)[:2] == ['Audits', 'Notes'], wb
    assert 'Note /20' in strings and 'Commun à la tournée' in strings


@pytest.mark.lent
def test_seuils_signature_tournee_ancienne_et_tableau_de_bord(make_page, app_url):
    page = make_page(viewport=TABLET)
    setup_standalone(page, app_url)
    tours = [create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', [PRES_BIO])['id'] for _ in range(3)]
    for aid in tours:
        answer_required(page, aid)
    notes = [lower_to(page, aid, 175)['n10'] for aid in tours]
    assert all(160 <= n <= 175 for n in notes), notes
    current, signed, old = tours

    # ----- Signature du contrôleur : note et seuils figés dans le contenu signé puis scellé
    s = sign_lock(page, signed)
    assert s['ok'] and s['lock'] == s['sig'] == s['hash'] and s['sealedGrading'], s
    g = grading(page, signed)
    rec = g['record']
    assert g['state'] == 'figee' and rec['thresholds'] == {'good': 16, 'fair': 12} and rec['tour']['note'] == notes[1] / 10, g
    assert rec['majors'] and 'it-F4-12' in rec['majors'] and rec['noScore'] == ['it-F2-2.8', 'it-F4-27'] and f'4@{K}' in rec['sheets']

    # ----- Tournée signée avant la mise en place de la notation : pas de note figée, sceau intact, note « calculée »
    js(page, """await A.finishAudit(store.get('audit', arg));
        const b = structuredClone(store.get('audit', arg)); delete b.grading;
        const h = await A.auditContentHash(b);
        b.signatures = { auditor: { role: 'auditor', name: session.user.name, at: '2026-10-01T15:00:00.000Z', contentHash: h, userId: session.user.id },
          provider: { role: 'provider', name: 'Représentant', refused: true, comment: 'absent', at: '2026-10-01T15:05:00.000Z', contentHash: h } };
        b.lock = { lockedAt: '2026-10-01T15:10:00.000Z', lockedBy: session.user.id, lockedByName: session.user.name, contentHash: h, appVersion: '1.0.8' };
        b.status = 'signe';
        await store.put('audit', b, { reason: 'Test : tournée signée avec la version 1.0.8 (sans note sur 20)' });""", old)
    assert js(page, "return (await A.verifyAuditSeal(store.get('audit', arg))).ok;", old), 'sceau d’une tournée ancienne intact'
    g_old = grading(page, old)
    assert g_old['state'] == 'calculee' and g_old['record'] is None and g_old['label'] == 'Satisfaisant', g_old
    goto_hash(page, f'#/audit/{old}/synthese')
    assert 'Note calculée : tournée signée avant la mise en place de la notation' in page.inner_text('.as-grade-state')
    assert js(page, "return (await A.verifyAuditSeal(store.get('audit', arg))).ok && !store.get('audit', arg).grading;", old), 'affichage sans écriture'

    # ----- Administration › « Note sur 20 » : seuils incohérents refusés, puis 19 / 15
    goto_hash(page, '#/administration')
    card = page.locator('#gradingCard')
    card.scroll_into_view_if_needed()
    assert 'NOTE SUR 20' in card.inner_text().upper() and page.input_value('#gradeGood') == '16' and page.input_value('#gradeFair') == '12'
    page.fill('#gradeFair', '17')
    page.click('[data-act=save-grading]')
    page.wait_for_function("() => document.getElementById('gradeErr').textContent.includes('inférieur ou égal')")
    assert js(page, "return (await import('./js/app/settings.js')).orgSettings().gradeFair;") == 12, 'seuils incohérents non enregistrés'
    page.fill('#gradeGood', '19')
    page.fill('#gradeFair', '15')
    page.wait_for_function("() => document.getElementById('gradePreview').textContent === '≥ 19 Satisfaisant · 15 à < 19 À améliorer · < 15 Insuffisant'")
    page.click('[data-act=save-grading]')
    page.wait_for_function("() => (window.AuditApp.store.get('setting', 'org') || {}).gradeGood === 19")
    assert js(page, "const s = store.get('setting', 'org'); return [s.gradeGood, s.gradeFair];") == [19, 15]

    # Tournée en cours : nouveaux seuils ; tournée signée : seuils et appréciation figés ; tournée ancienne : seuils actuels
    assert grading(page, current)['label'] == 'À améliorer' and grading(page, current)['thresholds'] == {'good': 19, 'fair': 15}
    g = grading(page, signed)
    assert g['state'] == 'figee' and g['label'] == 'Satisfaisant' and g['thresholds'] == {'good': 16, 'fair': 12}, g
    assert grading(page, old)['label'] == 'À améliorer'
    goto_hash(page, f'#/audit/{signed}/synthese')
    st = page.inner_text('.as-grade-state')
    assert 'Note figée à la signature du contrôleur' in st and '≥ 16 Satisfaisant' in st, st
    assert 'Satisfaisant' in page.inner_text('#tourGradeBox')
    goto_hash(page, f'#/audit/{signed}/feuille-4@{K}')
    assert 'Note figée à la signature' in page.inner_text(by_id(f'gradeBox-4@{K}'))
    goto_hash(page, f'#/audit/{current}/synthese')
    assert 'À améliorer' in page.inner_text('#tourGradeBox') and '≥ 19 Satisfaisant' in page.inner_text('#tourGradeBox')

    # ----- Modification tracée après la signature : note recalculée (seuils figés), note à la signature rappelée
    js(page, """const a = store.get('audit', arg);
        const id = Object.keys(a.responses).find(k => a.responses[k].status === 'NC' && a.responses[k].comment === 'Écart constaté (test)');
        await A.setResponse(a, id, { status: 'C' }, { reason: 'Erreur de saisie corrigée (test)' });""", signed)
    g = grading(page, signed)
    assert g['state'] == 'recalculee' and g['n10'] > notes[1] and g['thresholds'] == {'good': 16, 'fair': 12}, g
    assert js(page, "return (await A.verifyAuditSeal(store.get('audit', arg))).ok;", signed), 'modification tracée : intégrité'
    goto_hash(page, f'#/audit/{signed}/synthese')
    assert f'note à la signature : {notes[1] // 10},{notes[1] % 10} / 20' in page.inner_text('.as-grade-state')

    # ----- Tableau de bord : moyennes des tournées signées par prestataire et par réseau
    goto_hash(page, '#/tableau-de-bord?periode=tout')
    card = flat(page.inner_text('#dashGrades'))
    assert 'NOTES SUR 20 DES TOURNÉES SIGNÉES' in card.upper() and '2 tournées notées' in card and 'HYDRECO' in card and 'BIO' in card, card
    mean = js(page, """const { averageGrades } = await import('./js/domain/grading.js');
        const n = arg.map(id => A.tourGrades(store.get('audit', id)).tour.n10);
        return averageGrades(n.map(n10 => ({ providerId: 'p', networks: ['BIO'], n10 })), { good: 19, fair: 15 }).all;""", [signed, old])
    assert mean['text'] in card and mean['label'] in card, (mean, card)
    page.click('#dashGrades [data-act=list][data-prov="prov-HYDRECO"]:visible')
    page.wait_for_selector('.modal')
    modal = flat(page.inner_text('.modal'))
    assert 'TOURNÉES SIGNÉES NOTÉES · HYDRECO (2)' in modal.upper(), modal
    assert modal.count('AUD-') == 2 and 'Satisfaisant' in modal and 'À améliorer' in modal, ('chaque tournée avec sa note et son appréciation (seuils figés / actuels)', modal)
    page.click('.modal [data-act=__close]')
    page.click('#dashGrades .dash-gnets [data-net=BIO]:not([data-prov])')
    page.wait_for_selector('.modal')
    assert 'RÉSEAU BIO (2)' in page.inner_text('.modal-head').upper()
    page.click('.modal [data-act=__close]')

    # ----- Téléphone : synthèse, tableau de bord et Administration sans défilement horizontal
    page.set_viewport_size(PHONE)
    for h in (f'#/audit/{signed}/synthese', f'#/audit/{current}/feuille-4@{K}', '#/tableau-de-bord?periode=tout', '#/administration'):
        goto_hash(page, h)
        assert page.evaluate(NO_OVERFLOW), f'{h} : défilement horizontal'


# ---------------------------------------------------------------------------------------------------------------
SAKOURA, SOUROU, TWENKE = 'site-09281718', 'site-09281719', 'site-09280106'
T = '09280106'


def rate(page, aid, responses):
    """Cote directement des critères d'une tournée ({identifiant: {status, comment?}}), en une écriture."""
    js(page, """await A.updateAudit(store.get('audit', arg.id), a => {
          for (const [k, v] of Object.entries(arg.r)) a.responses[k] = { ...v, at: new Date().toISOString(), by: session.user.id, byName: session.user.name };
        }, { reason: 'Cotes (test)' });""", {'id': aid, 'r': responses})


def sign_before_grading(page, aid):
    """Tournée signée et verrouillée comme avec la version 1.0.8 (sans note figée) : note « calculée »."""
    js(page, """await A.finishAudit(store.get('audit', arg));
        const b = structuredClone(store.get('audit', arg)); delete b.grading;
        const h = await A.auditContentHash(b);
        b.signatures = { auditor: { role: 'auditor', name: session.user.name, at: new Date().toISOString(), contentHash: h, userId: session.user.id },
          provider: { role: 'provider', name: 'Représentant', refused: true, comment: 'absent', at: new Date().toISOString(), contentHash: h } };
        b.lock = { lockedAt: new Date().toISOString(), lockedBy: session.user.id, lockedByName: session.user.name, contentHash: h, appVersion: '1.0.8' };
        b.status = 'signe';
        await store.put('audit', b, { reason: 'Test : tournée signée avec la version 1.0.8 (sans note sur 20)' });""", aid)


def rows(page):
    """Lignes de la liste « Audits » : [(numéro, texte du badge de note ou '')]."""
    return page.eval_on_selector_all('#view .list .li', """els => els.map(e => [e.querySelector('.li-title').textContent.split(' — ')[0].trim(),
        (e.querySelector('.grade-tag, .grade-none')?.textContent || '').replace(/\\s+/g, ' ').trim()])""")


def tag(page, number):
    t = page.locator('#view .list .li', has_text=number).locator('.grade-tag')
    return {'text': flat(t.inner_text()), 'cls': t.get_attribute('class'), 'grade': t.get_attribute('data-grade'), 'state': t.get_attribute('data-state'), 'title': t.get_attribute('title')}


def click_q(page, k, v, expect):
    page.click(f'[data-act=q][data-k={k}][data-v="{v}"]')
    page.wait_for_function('(e) => location.hash.includes(e)', arg=expect)
    page.wait_for_selector(f'[data-act=q][data-k={k}][data-v="{v}"][aria-pressed="true"]')


def card(page, site):
    return page.locator(f'#hmGrid .hm-card[data-site="{site}"]')


@pytest.mark.lent
def test_note_dans_les_listes(make_page, app_url):
    page = make_page(viewport=TABLET)
    setup_standalone(page, app_url)
    # Tournée signée (note figée) : tournée 9 / 10 points = 18,0 ; station Athanase (points propres) 5 / 6 = 16,7.
    signed = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', [PRES_BIO])
    rate(page, signed['id'], {'it-F4-2': {'status': 'C'}, f'it-F4-12@{K}': {'status': 'C'}, f'it-F4-5@{K}': {'status': 'P', 'comment': 'À reprendre'}})
    assert sign_lock(page, signed['id'])['ok']
    # Tournée signée avant la notation (Twenke 4 / 6 = 13,3 ; Crique Sakoura sans point propre évalué ; tournée 8 / 10 = 16,0).
    old = create_tour(page, 'ce', [TWENKE, SAKOURA], 'prov-TL1')
    rate(page, old['id'], {'it-F4-2': {'status': 'C'}, f'it-F4-12@{T}': {'status': 'C'}, f'it-F4-5@{T}': {'status': 'NC', 'comment': 'Écart'}})
    sign_before_grading(page, old['id'])
    g = js(page, """const r = A.tourGrades(store.get('audit', arg.old)), s = A.tourGrades(store.get('audit', arg.signed));
        return [r.state, r.tour.text, r.stations[arg.T].text, r.stations[arg.S].text, s.state, s.tour.text, s.stations[arg.K].text];""",
           {'old': old['id'], 'signed': signed['id'], 'T': T, 'S': '09281718', 'K': K})
    assert g == ['calculee', '16,0', '13,3', 'non noté', 'figee', '18,0', '16,7'], g
    cancelled = create_tour(page, 'ce', [SOUROU], 'prov-TL1')
    rate(page, cancelled['id'], {'it-F4-2': {'status': 'C'}})
    js(page, "await A.cancelTour(store.get('audit', arg), 'Crue : accès impossible');", cancelled['id'])

    # ----- Accueil : la dernière tournée de chaque station est signée → note à côté de « Dernière tournée »
    goto_hash(page, '#/?ranger=statut')
    last = card(page, ATHANASE).locator('.hm-last')
    assert last.count() == 1 and f'Dernière tournée : {signed["number"]} (' in flat(last.inner_text()), last.inner_text()
    t = last.locator('.grade-tag')
    assert flat(t.inner_text()) == f'Station Note de la station dans la tournée {signed["number"]} : 16,7 / 20 · Satisfaisant', t.inner_text()
    assert 'lvl-good' in t.get_attribute('class') and t.get_attribute('data-state') == 'figee'
    assert t.get_attribute('title') == 'Note de la station dans la tournée : 16,7 / 20 — Satisfaisant (note figée à la signature)'
    tw = card(page, TWENKE).locator('.hm-last .grade-tag')
    assert 'Station' in tw.inner_text() and '13,3 / 20 · À améliorer · calculée' in flat(tw.inner_text()) and 'lvl-fair' in tw.get_attribute('class')
    sk = card(page, SAKOURA).locator('.hm-last .grade-tag')
    assert flat(sk.inner_text()).startswith('Tournée') and '16,0 / 20 · Satisfaisant · calculée' in flat(sk.inner_text()), sk.inner_text()
    assert sk.get_attribute('title').startswith('Note de la tournée : 16,0 / 20 — Satisfaisant (note calculée'), 'station sans note propre : note de la tournée'
    assert card(page, SOUROU).locator('.grade-tag, .grade-none').count() == 0, 'tournée annulée : aucune note'
    assert card(page, 'site-09160201').locator('.grade-tag').count() == 0, 'station jamais contrôlée'

    # ----- Tournées en cours : provisoire (Athanase) et sans point évalué (Twenke)
    current = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO')
    rate(page, current['id'], {'it-F4-2': {'status': 'NC', 'comment': 'Sonde non étalonnée'}, f'it-F4-12@{K}': {'status': 'C'}})   # 4 / 8 = 10,0
    fresh = create_tour(page, 'ce', [TWENKE], 'prov-TL1')
    goto_hash(page, '#/?ranger=statut')
    c = card(page, ATHANASE)
    assert f'Tournée en cours · {current["number"]}' in c.inner_text()
    sig = c.locator('.hm-signed')
    assert f'Dernière tournée signée : {signed["number"]} (' in flat(sig.inner_text()) and '16,7 / 20 · Satisfaisant' in flat(sig.inner_text()), sig.inner_text()
    assert c.locator('.grade-tag').count() == 1 and current['number'] not in sig.inner_text(), 'jamais la note provisoire de la tournée en cours'
    assert '13,3 / 20' in flat(card(page, TWENKE).locator('.hm-signed').inner_text())
    assert page.locator('.hm-tours .hm-tour').count() == 2 and page.locator('.hm-tours .grade-tag, .hm-tours .grade-none').count() == 0, 'rien dans « Tournées en cours sur cette tablette »'
    # Recherche instantanée : cartes filtrées sans réaffichage (aucun recalcul à chaque frappe)
    page.evaluate(f"() => {{ document.querySelector('#hmGrid .hm-card[data-site=\"{ATHANASE}\"]').__probe = 1; }}")
    page.fill('[data-input=search]', 'athan')
    page.wait_for_function("() => document.getElementById('hmCount').textContent.startsWith('1 station')")
    assert page.evaluate(f"() => document.querySelector('#hmGrid .hm-card[data-site=\"{ATHANASE}\"]').__probe === 1"), 'carte conservée'
    assert card(page, ATHANASE).locator('.grade-tag').is_visible()

    # ----- Liste « Audits » : badges
    goto_hash(page, '#/audits')
    b = tag(page, signed['number'])
    assert b['text'] == 'Note : 18,0 / 20 · Satisfaisant' and 'lvl-good' in b['cls'] and 'is-prov' not in b['cls'] and b['grade'] == '18,0' and b['state'] == 'figee', b
    assert b['title'] == 'Note de la tournée : 18,0 / 20 — Satisfaisant (note figée à la signature)', b
    b = tag(page, old['number'])
    assert b['text'] == 'Note : 16,0 / 20 · Satisfaisant · calculée' and 'lvl-good' in b['cls'] and b['state'] == 'calculee', b
    b = tag(page, current['number'])
    assert b['text'] == 'Note : 10,0 / 20 · Insuffisant · provisoire' and 'lvl-none' in b['cls'] and 'is-prov' in b['cls'] and b['state'] == 'provisoire', b
    assert page.locator('#view .list .li', has_text=fresh['number']).locator('.grade-none').inner_text() == 'non noté'
    assert cancelled['number'] not in page.inner_text('#view .list')
    r = page.locator('#view .list .li', has_text=old['number']).inner_text()
    assert re.search(r'\d+ C · 0 P · 1 NC', r) and '2 stations : Twenke, Crique Sakoura' in r, r
    # Tri : Date (défaut), Note décroissante, Note croissante — boutons accessibles (aria-pressed), non notées en dernier
    sort = page.locator('.au-sort[role=group][aria-label="Trier les tournées"]')
    assert sort.locator('button').count() == 3 and sort.locator('[data-v=""][aria-pressed="true"]').count() == 1
    assert page.get_by_role('button', name='Note décroissante').count() == 1 and page.get_by_role('button', name='Note croissante').count() == 1
    click_q(page, 'tri', 'note', 'tri=note')
    assert [n for n, _ in rows(page)] == [signed['number'], old['number'], current['number'], fresh['number']], rows(page)
    assert sort.locator('[data-v=""][aria-pressed="false"]').count() == 1
    click_q(page, 'tri', 'note-asc', 'tri=note-asc')
    assert [n for n, _ in rows(page)] == [current['number'], old['number'], signed['number'], fresh['number']], rows(page)
    # Combiné aux filtres existants : « Signés », « En cours », « Annulées »
    click_q(page, 'statut', 'verrouille', 'statut=verrouille')
    assert 'tri=note-asc' in page.evaluate('location.hash') and [n for n, _ in rows(page)] == [old['number'], signed['number']], rows(page)
    click_q(page, 'statut', 'en_cours', 'statut=en_cours')
    assert [n for n, _ in rows(page)] == [current['number'], fresh['number']], rows(page)
    click_q(page, 'statut', 'abandonne', 'statut=abandonne')
    assert [n for n, _ in rows(page)] == [cancelled['number']] and page.locator('#view .list .grade-tag, #view .list .grade-none').count() == 0, 'tournée annulée : rien'
    # « Effacer » : filtres effacés, tri conservé ; puce « Date » : ordre d'origine
    goto_hash(page, '#/audits?prestataire=prov-TL1&tri=note')
    assert [n for n, _ in rows(page)] == [old['number'], fresh['number']], rows(page)
    page.click('[data-act=reset]')
    page.wait_for_function("() => location.hash === '#/audits?tri=note' && document.querySelectorAll('#view .list .li').length === 4")
    assert page.locator('[data-act=q][data-k=tri][data-v=note][aria-pressed="true"]').count() == 1
    click_q(page, 'tri', '', '#/audits')
    assert 'tri=' not in page.evaluate('location.hash') and len(rows(page)) == 4
    # Mémoire des notes : une saisie (nouvel objet tournée) et un changement des seuils mettent le badge à jour
    rate(page, current['id'], {'it-F4-2': {'status': 'C'}})                                         # 8 / 8 = 20,0
    goto_hash(page, '#/audits?tri=note')
    assert rows(page)[0] == [current['number'], 'Note : 20,0 / 20 · Satisfaisant · provisoire'], rows(page)
    js(page, "await (await import('./js/app/settings.js')).saveOrgSettings({ gradeGood: 19, gradeFair: 17 }, 'Seuils (test)');")
    goto_hash(page, '#/audits?tri=note')
    assert dict(rows(page)) == {current['number']: 'Note : 20,0 / 20 · Satisfaisant · provisoire', signed['number']: 'Note : 18,0 / 20 · Satisfaisant',
                                old['number']: 'Note : 16,0 / 20 · Insuffisant · calculée', fresh['number']: 'non noté'}, ('seuils figés à la signature ; tournée ancienne : seuils actuels', rows(page))
    assert page.evaluate(NO_OVERFLOW)

    # ----- Téléphone : badges lisibles, tri accessible, aucun défilement horizontal
    page.set_viewport_size(PHONE)
    goto_hash(page, '#/audits')
    page.get_by_role('button', name='Note croissante').click()
    page.wait_for_selector('[data-act=q][data-k=tri][data-v=note-asc][aria-pressed="true"]')
    assert [n for n, _ in rows(page)][-1] == fresh['number'] and page.locator('#view .list .grade-tag').first.is_visible()
    assert page.evaluate(NO_OVERFLOW), 'liste « Audits » (téléphone)'
    for h in ('#/?ranger=statut', '#/?ranger=reseau'):
        goto_hash(page, h)
        g = card(page, ATHANASE).first.locator('.grade-tag')
        g.scroll_into_view_if_needed()
        assert g.is_visible() and '16,7 / 20 · Satisfaisant' in flat(g.inner_text())
        assert page.evaluate(NO_OVERFLOW), f'{h} (téléphone)'

