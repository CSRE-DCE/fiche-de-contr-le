"""Périmètre réel de la tournée par station (réponse de l'OEG du 18/10/2026) : « Certaines stations contiennent chimie +
bio mais seule la partie bio ou chimie ou chimie + bio peuvent être auditées. […] Si c'est le même prestataire certaines
opérations vont être mutualisées, sinon elles sont faites de manière indépendante. »

  1. test_tournee_hydreco_biologie_et_chimie (tablette 1280 × 800 puis téléphone 390 × 844) : création par l'écran d'une
     tournée HYDRECO « Biologie » à Acarouany (09160201, BIO + Chimie) ; cases « Biologie » (prestation BIO-2026
     rattachée) et « Chimie » (programmée pour OEG en régie : tournée distincte) ; « Chimie » cochée : tournée mixte,
     physico-chimie imposée ; une seule tournée, F1, F3, F4, F5 une fois pour la station (opérations mutualisées), F6 / F7
     en plus, aucun critère en double, point mutualisé compté une fois dans la synthèse ; en-tête et onglet Infos ;
     station BIO + Chimie ajoutée pour la chimie seule (fenêtre « périmètre contrôlé ») : ni F6 ni F7 ; PDF de la tournée
     et fiches vierges « Biologie + Chimie » ; aucun défilement horizontal.
  2. test_tournee_chimie_seule_meme_station : tournée « cours d'eau » de l'OEG en régie (audit interne) à Acarouany :
     chimie seule cochée d'office, biologie proposée (programmée pour HYDRECO : tournée distincte) ; tournée d'un seul
     type, donnée identique à une tournée d'avant (ni `parts` ni `partPrestations`), PDF sans mention de périmètre.
  3. test_deux_prestataires_tournees_independantes : HYDRECO (biologie) et OEG en régie (chimie) à la même station le
     même jour : deux tournées indépendantes, chacune son périmètre et sa prestation ; la signature de l'une ne change pas
     l'autre ; une prestation chimie programmée pour le MÊME prestataire : « Chimie » cochée d'office (mutualisation).
     test_depuis_le_planning_biologie_et_chimie : planning, prestations biologie et chimie du même prestataire à la
     même station cochées ensemble → création d'une tournée mixte, chaque prestation rattachée à sa partie.
  4. test_modifier_le_perimetre_avant_signature : biologie retirée à la station (motif obligatoire car un constat est
     saisi, écart ouvert annulé avec le même motif après confirmation) : F6 / F7 masquées, constats conservés, historique
     des stations et journal ; biologie recochée : constat de nouveau affiché ; après la signature du contrôleur : refus
     expliqué, bouton absent.
  5. test_tournees_signees_intactes : tournée d'un seul type et tournée mixte signées et verrouillées : sceau intact
     après rechargement, périmètre non modifiable ; PDF de la tournée d'un seul type sans aucune mention de périmètre.
  6. test_echange_du_perimetre_entre_deux_tablettes : tournée mixte créée sur la tablette 1, reçue sur la tablette 2 avec
     son périmètre, modifiée sur la tablette 2 (chimie retirée, par Bruno, contrôleur de la tournée), renvoyée : même
     périmètre et même historique sur les deux tablettes, une seule tournée, double réception sans effet.
"""
import re

import pytest

from helpers import answer_required, create_tour, goto_hash, js, setup_standalone
from test_tablette_partagee import add_agent, pdf_texts

TABLET = {'width': 1280, 'height': 800}
PHONE = {'width': 390, 'height': 844}
NO_OVERFLOW = '() => document.documentElement.scrollWidth <= window.innerWidth + 1'
ACAROUANY, A = 'site-09160201', '09160201'          # BIO (BIO_CE) + Chimie (prestations chimie : OEG en régie)
TWENKE, T = 'site-09280106', '09280106'             # BIO + Chimie (chimie : Titulaire du marché – lot 1)
PRES_BIO = 'pres-BIO-2026-09160201'                 # programme RCS ESC BIO 2026 (HYDRECO)
PRES_CH = 'pres-Chimie_09160201_S1_-_Sept_26'       # programme chimie, session 1 (OEG en régie)


def state(page, aid):
    return js(page, """const a = store.get('audit', arg); const st = A.auditState(a);
        const conf = st.sheets.flatMap(s => s.items).filter(i => i.kind === 'conformity');
        return { auditType: a.auditType, stations: a.stations, compartments: a.compartments, prestationIds: a.prestationIds, mixed: st.mixed,
          tourTypes: st.tourTypes, header: st.header.title, typeLabel: st.header.typeLabel, sheets: st.sheets.map(s => s.instanceKey),
          visible: [...new Set(st.structure.filter(s => s.visible).flatMap(s => s.visibleItems).map(i => i.id))],
          // Critère affiché deux fois hors critères communs à la tournée (un par station, une seule réponse) : doublon.
          dups: (() => { const n = new Map(); for (const sh of st.sheets) for (const i of sh.items) if (!i.shared) n.set(i.id, (n.get(i.id) || 0) + 1); return [...n].filter(([, c]) => c > 1).map(([id]) => id); })(),
          distinct: [...new Set(st.sheets.flatMap(s => s.items).map(i => i.id))].length,
          conformity: new Set(conf.map(i => i.id)).size, summary: st.summary.stations.global, log: a.stationLog || [] };""", aid)


def creation_screen(page, audit_type, provider, site_id, name):
    goto_hash(page, '#/nouvel-audit')
    page.click(f'[data-act=setType][data-v={audit_type}]')
    page.wait_for_selector(f'[data-act=setType][data-v={audit_type}][aria-checked=true]')
    page.click(f'[data-act=setProvider][data-v="{provider}"]')
    page.wait_for_selector(f'[data-act=setProvider][data-v="{provider}"][aria-checked=true]')
    page.fill('[data-input=anSearch]', name)
    page.click(f'#anCands [data-act=addSt][data-site="{site_id}"]')
    page.wait_for_selector(f'.an-sel-row[data-site="{site_id}"]')
    return page.locator(f'.an-sel-row[data-site="{site_id}"]')


def start(page):
    page.click('#anForm button[type=submit]')
    page.wait_for_function("() => /^#\\/audit\\/[^/]+/.test(location.hash) && document.body.classList.contains('in-audit')")
    return re.match(r'#/audit/([^/?]+)', page.evaluate('location.hash')).group(1)


def part_box(scope, part):
    return scope.locator(f'.pm-check.t-{part} input')


def set_status(page, item, value):
    """Cote un critère par son bouton visible (ligne de tableau ≥ 1100 px, carte en dessous)."""
    btn = page.locator(f'[data-act=resp][data-item="{item}"][data-value="{value}"]:visible').first
    btn.click()
    page.wait_for_function("([i, v]) => [...document.querySelectorAll(`[data-act=resp][data-value='${v}']`)].some(b => b.dataset.item === i && b.getAttribute('aria-pressed') === 'true')", arg=[item, value])


def no_overflow(page, what):
    assert page.evaluate(NO_OVERFLOW), f'{what} : défilement horizontal'


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_tournee_hydreco_biologie_et_chimie(make_page, app_url):
    for vp in (TABLET, PHONE):
        page = make_page(viewport=vp, label=f'{vp["width"]} px')
        setup_standalone(page, app_url)
        row = creation_screen(page, 'bio', 'prov-HYDRECO', ACAROUANY, 'Acarouany')
        # Cases proposées selon les réseaux et les prestations programmées de la station.
        assert part_box(row, 'bio').is_checked() and part_box(row, 'bio').is_disabled(), 'biologie cochée (type de la tournée), dernière case non décochable'
        assert not part_box(row, 'ce').is_checked()
        text = ' '.join(row.inner_text().split())
        assert 'Contrôlé à cette station :' in text and 'BIO-2026-09160201' in text and 'Programmée pour OEG en régie : tournée distincte' in text, text
        no_overflow(page, 'création')
        # HYDRECO réalise aussi la chimie à cette station : même prestataire ⇒ une seule tournée, opérations mutualisées.
        row.locator('.pm-check.t-ce').click()
        page.wait_for_selector('.an-recap-mixed')
        row = page.locator(f'.an-sel-row[data-site="{ACAROUANY}"]')
        assert part_box(row, 'ce').is_checked() and not part_box(row, 'bio').is_disabled()
        assert 'Hors programme du prestataire (programmée pour OEG en régie)' in ' '.join(row.inner_text().split())
        assert 'tournée biologie + chimie' in page.inner_text('.an-recap')
        physico = page.locator('.an-comps input[value=physico]')
        assert physico.is_checked() and physico.is_disabled(), 'physico-chimie imposée par la chimie (commune aux deux)'
        no_overflow(page, 'création, tournée mixte')
        aid = start(page)

        s = state(page, aid)
        assert js(page, "return store.all('audit').length;") == 1, 'une seule tournée'
        st = s['stations'][0]
        assert st['parts'] == ['bio', 'ce'] and st['partPrestations'] == {'bio': PRES_BIO} and st['prestationId'] == PRES_BIO, st
        assert s['auditType'] == 'bio' and s['mixed'] and s['tourTypes'] == ['bio', 'ce'], s
        assert s['compartments'] == ['organisation', 'physico', 'invertebres', 'diatomees'], s['compartments']
        assert s['sheets'] == [f'1@{A}', '2', f'3@{A}', f'4@{A}', f'5@{A}', f'6@{A}', f'7@{A}'], 'opérations communes une fois, F6 / F7 en plus'
        assert s['dups'] == [], 'aucun critère en double'
        for item in (f'it-F3-5@{A}', f'it-F3-17@{A}', f'it-F4-11@{A}', f'it-F5-4@{A}', 'it-F4-2'):
            assert item in s['visible'], item
        assert s['header'] == 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026 + Physico-chimie des cours d’eau 2026', s['header']
        assert js(page, "return store.get('prestation', arg).statusHistory.some(h => h.event === 'audit-demarre');", PRES_BIO)

        # Point mutualisé (mesures in situ) : une réponse, comptée une fois.
        goto_hash(page, f'#/audit/{aid}/feuille-4@{A}')
        assert page.locator('.as-b-conclusion').count() == 1, 'un seul encadré « conclusion » sur la feuille 4 commune'
        set_status(page, f'it-F4-3@{A}', 'C')
        s = state(page, aid)
        assert s['summary']['C'] == 1 and s['summary']['total'] == s['conformity'], s['summary']
        no_overflow(page, 'feuille 4')
        goto_hash(page, f'#/audit/{aid}/synthese')
        assert 'Biologie + Chimie' in page.inner_text('.as-sum'), 'périmètre de la station dans la synthèse'
        goto_hash(page, f'#/audit/{aid}/feuille-1@{A}')
        assert 'Contrôlé à cette station : Biologie + Chimie' in ' '.join(page.inner_text('.ss-comps').split())
        assert page.locator('.as-top .type-badge').count() == 2, 'en-tête : badges des deux types'
        no_overflow(page, 'feuille 1')

        # Onglet Infos : périmètre et prestation de chaque partie.
        goto_hash(page, f'#/audit/{aid}/infos')
        perim = page.locator(f'#tourStations [data-station="{A}"] .as-perim')
        assert perim.get_attribute('data-parts') == 'bio,ce' and 'Biologie' in perim.inner_text() and 'Chimie' in perim.inner_text()
        assert 'tournée mixte' in page.inner_text('#view')
        no_overflow(page, 'infos')

        # Station BIO + Chimie ajoutée pour la chimie seule (Twenke : chimie programmée pour le Titulaire du marché).
        page.click('#tourStations [data-act=tour-add]')
        page.fill('#tsQ', 'Twenke')
        page.click(f'[data-act=ts-pick][data-site="{TWENKE}"]')
        page.wait_for_selector('#pmBox')
        box = page.locator('#pmBox')
        assert part_box(box, 'bio').is_checked() and not part_box(box, 'ce').is_checked()
        no_overflow(page, 'fenêtre « périmètre contrôlé »')
        box.locator('.pm-check.t-ce').click()
        page.wait_for_function("() => document.querySelector('#pmBox .pm-check.t-ce input')?.checked")
        page.locator('#pmBox .pm-check.t-bio').click()
        page.wait_for_function("() => !document.querySelector('#pmBox .pm-check.t-bio input')?.checked")
        page.click('#pmOk')
        page.wait_for_function(f"() => location.hash.includes('feuille-1@{T}')")
        s = state(page, aid)
        assert [x['key'] for x in s['stations']] == [A, T] and s['stations'][1]['parts'] == ['ce'], s['stations']
        assert [k for k in s['sheets'] if k.endswith('@' + T)] == [f'1@{T}', f'3@{T}', f'4@{T}', f'5@{T}'], 'chimie seule : ni invertébrés ni diatomées'
        assert f'it-F3-5@{T}' not in s['visible'] and s['dups'] == []
        assert s['log'][-1]['action'] == 'ajout' and s['log'][-1]['parts'] == ['ce']
        goto_hash(page, f'#/audit/{aid}/feuille-4@{T}')
        assert 'Bilan – Mesures in situ, étalonnage et flaconnage' in page.inner_text('.as-blocks'), 'station chimie : bilan de la chimie'

        if vp is TABLET:
            # PDF de la tournée : en-tête, type de tournée, périmètre de chaque station (feuille 1 et synthèse).
            texts = ' '.join(pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", aid))
            for t in ('Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026 + Physico-chimie des cours d’eau 2026', 'Contrôlé à cette station : Biologie + Chimie',
                      'Contrôlé à cette station : Chimie', 'Hydrobiologie – RCS ESC BIO + Cours d’eau – physico-chimie (tournée mixte)', '1. ACAROUANY (09160201) — biologie + chimie'):
                assert t in texts, t
            # Rapport d'audit détaillé : type de tournée et périmètre de chaque station.
            report = ' '.join(pdf_texts(page, "const { buildAuditReport } = await import('./js/app/report.js'); await buildAuditReport(arg);", aid))
            assert 'Périmètre contrôlé' in report and 'Acarouany : Biologie + Chimie ; Twenke : Chimie' in report, report[:600]
            # Fiches vierges d'une station BIO + Chimie contrôlée pour les deux (fiche station › « Biologie + Chimie »).
            goto_hash(page, f'#/station/{ACAROUANY}?type=bio&parties=bio,ce')
            assert page.locator('.stp-variants [data-parts="bio,ce"][aria-pressed=true]').count() == 1
            assert 'Contrôlé à cette station : Biologie + Chimie' in ' '.join(page.inner_text('.ss-comps').split())
            blank = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); const r = await P.generateBlankSheetsPdf({ siteId: arg, parts: ['bio', 'ce'] }); window.__f = r.filename;", ACAROUANY)
            joined = ' '.join(blank)
            assert 'Contrôlé à cette station : Biologie + Chimie' in joined and 'RCS ESC BIO 2026 + Physico-chimie des cours d’eau 2026' in joined
            assert page.evaluate('window.__f').startswith('Fiches_vierges_bio-ce_')
            assert 'pezada' in joined.lower() and 'idgf' in joined.lower() and 'Feuille 7 / 7' in joined, 'feuilles communes une fois, invertébrés et diatomées en plus'


def test_tournee_chimie_seule_meme_station(page, app_url):
    setup_standalone(page, app_url)
    row = creation_screen(page, 'ce', 'prov-OEG', ACAROUANY, 'Acarouany')
    assert part_box(row, 'ce').is_checked() and not part_box(row, 'bio').is_checked(), 'chimie seule cochée d’office'
    assert 'Programmée pour HYDRECO : tournée distincte' in ' '.join(row.inner_text().split())
    assert not page.locator('.an-recap-mixed').count()
    aid = start(page)
    a = js(page, "return store.get('audit', arg);", aid)
    assert a['auditType'] == 'ce' and a['providerId'] == 'prov-OEG' and a['compartments'] == ['organisation', 'physico']
    st = a['stations'][0]
    assert 'parts' not in st and 'partPrestations' not in st and st['prestationId'] == PRES_CH, 'donnée identique à une tournée d’avant'
    s = state(page, aid)
    assert not s['mixed'] and s['sheets'] == [f'1@{A}', '2', f'3@{A}', f'4@{A}', f'5@{A}'] and f'it-F3-5@{A}' not in s['visible']
    # Même tournée créée sans aucune notion de périmètre (API d'avant) : mêmes feuilles et mêmes critères.
    old = create_tour(page, 'ce', [ACAROUANY], 'prov-OEG', [PRES_CH])
    o = state(page, old['id'])
    assert o['sheets'] == s['sheets'] and o['visible'] == s['visible'] and o['stations'][0].keys() == st.keys()
    texts = ' '.join(pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", aid))
    assert 'Contrôlé à cette station' not in texts and 'tournée mixte' not in texts and '+ ' not in s['header']
    goto_hash(page, f'#/audit/{aid}/infos')
    perim = page.locator(f'#tourStations [data-station="{A}"] .as-perim')
    assert perim.get_attribute('data-parts') == 'ce', 'station BIO + Chimie : périmètre affiché et modifiable'
    assert page.locator(f'[data-act=tour-parts][data-key="{A}"]').count() == 1


def test_deux_prestataires_tournees_independantes(page, app_url):
    setup_standalone(page, app_url)
    bio = create_tour(page, 'bio', [ACAROUANY], 'prov-HYDRECO', [PRES_BIO])
    ce = create_tour(page, 'ce', [ACAROUANY], 'prov-OEG', [PRES_CH])
    sb, sc = state(page, bio['id']), state(page, ce['id'])
    assert not sb['mixed'] and not sc['mixed'] and sb['prestationIds'] == [PRES_BIO] and sc['prestationIds'] == [PRES_CH]
    assert f'6@{A}' in sb['sheets'] and not any(k.startswith('6@') for k in sc['sheets'])
    # Chaque tournée garde ses propres réponses : rien n'est partagé entre les deux prestataires.
    js(page, "await A.setResponse(store.get('audit', arg), 'it-F4-3@09160201', { status: 'NC', comment: 'Sonde non stabilisée' });", ce['id'])
    assert js(page, "return store.get('audit', arg).responses['it-F4-3@09160201'] || null;", bio['id']) is None
    # Signature de la tournée HYDRECO : seule SA prestation (biologie) est contrôlée.
    answer_required(page, bio['id'])
    js(page, """await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
        await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
        await A.lockAudit(store.get('audit', arg));""", bio['id'])
    assert js(page, "return [store.get('prestation', arg[0]).status, store.get('prestation', arg[1]).status];", [PRES_BIO, PRES_CH]) == ['auditee', 'prevue']
    goto_hash(page, f'#/station/{ACAROUANY}')
    hist = page.inner_text('#view')
    assert bio['number'] in hist and ce['number'] in hist, 'les deux tournées dans l’historique de la station'
    # Chimie programmée pour le MÊME prestataire (HYDRECO) : cochée d'office à la création (opérations mutualisées).
    js(page, """const p = store.get('prestation', arg);
        await store.put('prestation', { ...p, id: 'pres-test-HYDRECO-chimie', ref: 'Chimie-HYDRECO-09160201', providerId: 'prov-HYDRECO', statusHistory: [], source: null });""", PRES_CH)
    row = creation_screen(page, 'bio', 'prov-HYDRECO', ACAROUANY, 'Acarouany')
    assert part_box(row, 'bio').is_checked() and part_box(row, 'ce').is_checked(), 'même prestataire : biologie et chimie cochées'
    assert 'Chimie-HYDRECO-09160201' in row.inner_text()
    aid = start(page)
    st = state(page, aid)['stations'][0]
    assert st['parts'] == ['bio', 'ce'] and st['partPrestations'] == {'ce': 'pres-test-HYDRECO-chimie'}, 'biologie hors programme (prestation déjà contrôlée), chimie rattachée'


def test_depuis_le_planning_biologie_et_chimie(page, app_url):
    """Planning : prestations biologie et chimie du même prestataire à la même station cochées ensemble → tournée mixte."""
    setup_standalone(page, app_url)
    ch = js(page, """const p = store.filter('prestation', x => x.siteId === 'site-09280106' && x.campaignId && /Chimie/.test(x.id))[0];
        await store.put('prestation', { ...p, id: 'pres-test-HYDRECO-chimie-T', ref: 'Chimie-HYDRECO-09280106', providerId: 'prov-HYDRECO', statusHistory: [], source: null });
        return 'pres-test-HYDRECO-chimie-T';""")
    goto_hash(page, '#/planning?periode=toutes&prestataire=prov-HYDRECO&q=Twenke')
    for pid in ('pres-BIO-2026-09280106', ch):
        page.check(f'[data-change=pick][value="{pid}"]')
    page.click('[data-act=startTour]')
    page.wait_for_selector(f'.an-sel-row[data-site="{TWENKE}"]')
    row = page.locator(f'.an-sel-row[data-site="{TWENKE}"]')
    assert part_box(row, 'bio').is_checked() and part_box(row, 'ce').is_checked() and 'tournée biologie + chimie' in page.inner_text('.an-recap')
    no_overflow(page, 'création depuis le planning')
    aid = start(page)
    st = state(page, aid)['stations'][0]
    assert st['parts'] == ['bio', 'ce'] and st['partPrestations'] == {'bio': 'pres-BIO-2026-09280106', 'ce': ch} and st['prestationId'] == 'pres-BIO-2026-09280106', st
    assert sorted(state(page, aid)['prestationIds']) == sorted(['pres-BIO-2026-09280106', ch])


def test_modifier_le_perimetre_avant_signature(page, app_url):
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ACAROUANY], 'prov-HYDRECO', [PRES_BIO])
    aid = tour['id']
    goto_hash(page, f'#/audit/{aid}/infos')
    assert page.locator(f'#tourStations [data-station="{A}"] .as-perim').get_attribute('data-parts') == 'bio'
    # Chimie ajoutée : tournée mixte, prestation chimie de l'OEG non rattachée (autre prestataire).
    page.click(f'[data-act=tour-parts][data-key="{A}"]')
    page.wait_for_selector('#pmBox')
    page.locator('#pmBox .pm-check.t-ce').click()
    page.wait_for_function("() => document.querySelector('#pmBox .pm-check.t-ce input')?.checked")
    page.click('#pmOk')
    page.wait_for_function("(id) => (window.AuditApp.store.get('audit', id).stations[0].parts || []).length === 2", arg=aid)
    s = state(page, aid)
    assert s['mixed'] and s['stations'][0]['partPrestations'] == {'bio': PRES_BIO} and s['log'][-1]['action'] == 'perimetre'
    assert s['log'][-1]['before'] == ['bio'] and s['log'][-1]['after'] == ['bio', 'ce'] and s['sheets'][-2:] == [f'6@{A}', f'7@{A}']
    # Constat saisi sur les invertébrés, écart ouvert.
    goto_hash(page, f'#/audit/{aid}/feuille-6@{A}')
    item = js(page, "return A.auditState(store.get('audit', arg)).sheets.find(s => s.instanceKey === '6@09160201').items.find(i => i.kind === 'conformity').id;", aid)
    set_status(page, item, 'NC')
    js(page, """await A.setResponse(store.get('audit', arg.id), arg.item, { comment: 'Surber non conforme' });
        await A.createDeviation(store.get('audit', arg.id), { itemId: arg.item, description: 'Surber' });""", {'id': aid, 'item': item})
    # Biologie retirée : motif obligatoire (constat masqué), écart ouvert annulé avec le même motif.
    goto_hash(page, f'#/audit/{aid}/infos')
    page.click(f'[data-act=tour-parts][data-key="{A}"]')
    page.wait_for_selector('#pmBox')
    page.locator('#pmBox .pm-check.t-bio').click()
    page.wait_for_function("() => !document.querySelector('#pmBox .pm-check.t-bio input')?.checked")
    page.click('#pmOk')
    page.wait_for_selector('#__prompt')
    assert '1 réponse(s)' in page.inner_text('.modal-body') and 'conservés' in page.inner_text('.modal-body')
    page.fill('#__prompt', 'Biologie reportée : crue')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('.modal [data-act=yes]')
    page.click('.modal [data-act=yes]')
    page.wait_for_function("(id) => (window.AuditApp.store.get('audit', id).stations[0].parts || ['x']).join() === 'ce' || !window.AuditApp.store.get('audit', id).stations[0].parts", arg=aid)
    s = state(page, aid)
    assert s['auditType'] == 'ce' and not s['mixed'] and 'parts' not in s['stations'][0], 'redevenue une tournée chimie seule'
    assert s['stations'][0]['prestationId'] is None and s['prestationIds'] == [], 'prestation biologique détachée'
    assert not any(k.startswith('6@') or k.startswith('7@') for k in s['sheets']) and s['compartments'] == ['organisation', 'physico']
    assert js(page, "return store.get('audit', arg.id).responses[arg.item].status;", {'id': aid, 'item': item}) == 'NC', 'constat conservé'
    assert js(page, "return store.all('deviation').map(d => d.status);") == ['annule']
    log = s['log'][-1]
    assert log['action'] == 'perimetre' and log['before'] == ['bio', 'ce'] and log['after'] == ['ce'] and log['reason'] == 'Biologie reportée : crue'
    goto_hash(page, f'#/audit/{aid}/infos')
    page.click('#tourStations summary')
    assert 'périmètre contrôlé à Acarouany : Biologie + Chimie → Chimie — motif : « Biologie reportée : crue »' in ' '.join(page.inner_text('#tourStations').split())
    goto_hash(page, '#/journal?action=perimeter')
    rows = page.locator('tbody tr', has_text='Périmètre contrôlé d’une station modifié')
    assert rows.count() == 2, 'journal : chimie ajoutée, biologie retirée'
    assert 'Biologie + Chimie → Chimie — Biologie reportée : crue' in rows.first.inner_text(), rows.first.inner_text()
    # Biologie recochée : le constat réapparaît.
    js(page, "await A.setStationParts(store.get('audit', arg), '09160201', ['bio', 'ce']);", aid)
    s = state(page, aid)
    assert item in s['visible'] and s['mixed']
    # Après la signature du contrôleur : refus expliqué, bouton absent.
    err = js(page, """await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
        try { await A.setStationParts(store.get('audit', arg), '09160201', ['bio']); return null; } catch (e) { return e.message; }""", aid)
    assert 'rouvrez-la' in err, err
    goto_hash(page, f'#/audit/{aid}/infos')
    assert page.locator('[data-act=tour-parts]').count() == 0


def test_tournees_signees_intactes(page, app_url):
    setup_standalone(page, app_url)
    single = create_tour(page, 'bio', [ACAROUANY], 'prov-HYDRECO', [PRES_BIO])
    mixed = js(page, """const a = await A.createAudit({ auditType: 'bio', providerId: 'prov-HYDRECO', stations: [{ siteId: 'site-09160201', prestationId: arg, parts: ['bio', 'ce'] }] });
        return { id: a.id };""", PRES_BIO)
    seals = {}
    for t in (single, mixed):
        answer_required(page, t['id'])
        seals[t['id']] = js(page, """await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
            await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
            await A.lockAudit(store.get('audit', arg));
            const a = store.get('audit', arg); return { hash: a.lock.contentHash, stations: a.stations, ok: (await A.verifyAuditSeal(a)).ok };""", t['id'])
        assert seals[t['id']]['ok']
    assert 'parts' not in seals[single['id']]['stations'][0] and seals[mixed['id']]['stations'][0]['parts'] == ['bio', 'ce']
    page.reload()
    from helpers import unlock
    unlock(page)
    for t in (single, mixed):
        again = js(page, "const a = store.get('audit', arg); const s = await A.verifyAuditSeal(a); return { ok: s.ok, hash: s.current, stations: a.stations };", t['id'])
        assert again['ok'] and again['hash'] == seals[t['id']]['hash'] and again['stations'] == seals[t['id']]['stations'], 'sceau intact après rechargement'
        err = js(page, "try { await A.setStationParts(store.get('audit', arg), '09160201', ['ce']); return null; } catch (e) { return e.message; }", t['id'])
        assert 'verrouillée' in err, err
    texts = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", single['id'])
    joined = ' '.join(texts)
    assert 'Contrôlé à cette station' not in joined and 'tournée mixte' not in joined
    assert texts[texts.index('Type de tournée') + 1] == 'Hydrobiologie – RCS ESC BIO'
    assert 'Contrôle terrain prestataire – HYDRECO – RCS ESC BIO 2026' in joined and 'RCS ESC BIO 2026 +' not in joined


@pytest.mark.lent
def test_echange_du_perimetre_entre_deux_tablettes(make_page, app_url, tmp_path):
    from test_echange_tablettes import receive, send, tablet
    from test_remplissage_auto import second_tablet
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    bruno = add_agent(t1, 'Martin', 'Bruno', 'bmartin')
    tour = js(t1, """const a = await A.createAudit({ auditType: 'bio', providerId: 'prov-HYDRECO', controllerIds: [arg.bruno],
        stations: [{ siteId: 'site-09160201', prestationId: arg.pres, parts: ['bio', 'ce'] }, { siteId: 'site-09280106', parts: ['ce'] }] });
        return { id: a.id, number: a.number };""", {'bruno': bruno, 'pres': PRES_BIO})
    aid = tour['id']
    t2 = second_tablet(make_page, app_url, send(t1, tmp_path), 'bmartin')
    s2 = state(t2, aid)
    assert [x.get('parts') for x in s2['stations']] == [['bio', 'ce'], ['ce']] and s2['mixed'], 'périmètre reçu avec la tournée'
    assert s2['sheets'] == state(t1, aid)['sheets']
    # Tablette 2 (Bruno, contrôleur de la tournée) : chimie retirée à Acarouany.
    goto_hash(t2, f'#/audit/{aid}/infos')
    t2.click(f'[data-act=tour-parts][data-key="{A}"]')
    t2.wait_for_selector('#pmBox')
    t2.locator('#pmBox .pm-check.t-ce').click()
    t2.wait_for_function("() => !document.querySelector('#pmBox .pm-check.t-ce input')?.checked")
    t2.click('#pmOk')
    t2.wait_for_function("(id) => window.AuditApp.store.get('audit', id).stations[0].parts.join() === 'bio'", arg=aid)
    f2 = send(t2, tmp_path)
    _, report = receive(t1, f2)
    assert 'tournée mise à jour' in report, report
    states = [state(t, aid) for t in (t1, t2)]
    for s in states:
        assert [x['parts'] for x in s['stations']] == [['bio'], ['ce']] and s['mixed']
        assert s['log'][-1]['action'] == 'perimetre' and s['log'][-1]['byName'] == 'Bruno Martin'
    assert states[0]['stations'] == states[1]['stations'] and states[0]['sheets'] == states[1]['sheets']
    assert js(t1, "return store.all('audit').length;") == 1 and js(t2, "return store.all('audit').length;") == 1
    before = js(t1, "return JSON.stringify(store.get('audit', arg));", aid)
    preview, report = receive(t1, f2)
    assert 'déjà été reçu' in preview and 'aucun changement' in report, (preview, report)
    assert js(t1, "return JSON.stringify(store.get('audit', arg));", aid) == before, 'double réception sans effet'
