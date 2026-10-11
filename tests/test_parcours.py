"""Parcours terrain : non-régression des constats de la relecture (tournées CT-2026, Playwright).

  P1  date de tournée choisie à la création : enregistrée sur l'audit (audit.date), dates pré-remplies, listes,
      accueil, planning, Infos, rapport d'audit détaillé et fiches de contrôle (PDF), station ajoutée ensuite ;
  P2  aucune saisie perdue : verrouillage (automatique ou manuel) pendant la frappe, enregistrement différé des
      zones d'observation, mise en arrière-plan / fermeture (visibilitychange, pagehide), 'input' = activité ;
  P4  modification motivée après signature : pas d'effacement silencieux, « Terminer les modifications » refusé
      tant qu'un point bloquant a été introduit ;
  P6  prestations à date indicative : en retard seulement après la fin de la campagne (planning, tableau de bord) ;
  P7  fiche station quittée pendant le montage de la carte : aucune erreur Leaflet ;
  P8  signature affichée entière (non recadrée) à l'étape Signatures ;
  P9  écart sur un critère commun à la tournée : rattaché à toute la tournée, affiché « Tournée (…) » ;
  P10 retrait d'une station ayant un écart ouvert : écart annulé avec le motif, nom « (retirée) » ;
  P11 liste des audits : badge C · P · NC et stations de la tournée.
"""
import re
import time

import pytest

from helpers import ATHANASE, PASSWORD, answer_required, create_tour, goto_hash, js, response, setup_standalone, unlock

pytestmark = pytest.mark.lent

SAKOURA, SOUROU, TWENKE = 'site-09281718', 'site-09281719', 'site-09280106'
RCO = ['pres-RCO_09281718_S1_-_Octobre_2026', 'pres-RCO_09281719_S1_-_Octobre_2026']


def attr(value):
    """Valeur d'attribut pour un sélecteur CSS (identifiants contenant « @ » et « . »)."""
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def fr(day):
    """AAAA-MM-JJ → JJ/MM/AAAA."""
    y, m, d = day.split('-')
    return f'{d}/{m}/{y}'


def view_text(page):
    return page.inner_text('#view')


def pdf_texts(page, body, arg=None):
    """Textes dessinés dans un PDF : PDFDocument.text (js/formats/pdf.js) est espionné pendant `body` (qui doit
    produire le document). Retourne la liste des chaînes dessinées."""
    return page.evaluate(f"""async (arg) => {{
        const A = await import('./js/app/audits.js');
        const store = window.AuditApp.store;
        const {{ PDFDocument }} = await import('./js/formats/pdf.js');
        const seen = [], orig = PDFDocument.prototype.text;
        PDFDocument.prototype.text = function (s, ...rest) {{ seen.push(String(s)); return orig.call(this, s, ...rest); }};
        try {{ {body} }} finally {{ PDFDocument.prototype.text = orig; }}
        return seen;
    }}""", arg)


def sign_and_lock(page, audit_id):
    """Clôture, signatures (images PNG 688 × 200, tracé à GAUCHE du cadre) et verrouillage d'une tournée complète."""
    js(page, """
        const png = async () => {
          const c = document.createElement('canvas'); c.width = 688; c.height = 200;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 688, 200);
          g.strokeStyle = '#0d3577'; g.lineWidth = 6; g.beginPath(); g.moveTo(16, 160); g.bezierCurveTo(50, 10, 110, 190, 150, 30); g.stroke();
          const blob = await new Promise(r => c.toBlob(r, 'image/png'));
          return new Uint8Array(await blob.arrayBuffer());
        };
        await A.finishAudit(store.get('audit', arg));
        await A.signAudit(store.get('audit', arg), 'auditor', { bytes: await png(), mime: 'image/png', name: session.user.name });
        await A.signAudit(store.get('audit', arg), 'provider', { bytes: await png(), mime: 'image/png', name: 'Jean Préleveur', fn: 'Technicien' });
        await A.lockAudit(store.get('audit', arg));""", audit_id)


def ce_tour(page):
    """Tournée cours d'eau de deux stations (Crique Sakoura, Crique Sourou ; prestations RCO S1) du prestataire TL1."""
    return create_tour(page, 'ce', [SAKOURA, SOUROU], 'prov-TL1', RCO)


# ---------------------------------------------------------------------------------------------------------------
def test_date_de_tournee_partout(page, app_url):
    """P1 : tournée créée par l'écran avec une date passée → cette date partout, y compris pour une station ajoutée."""
    setup_standalone(page, app_url)
    today, day = page.evaluate("""async () => { const u = await import('./js/core/util.js');
        return [u.localDate(), u.addDays(u.localDate(), -2)]; }""")
    goto_hash(page, '#/nouvel-audit')
    page.click('[data-act=setType][data-v=ce]')
    page.click('[data-act=setProvider][data-v="prov-TL1"]')
    page.wait_for_selector('[data-act=setProvider][data-v="prov-TL1"][aria-checked=true]')
    page.fill('#anForm [name=date]', day)
    page.wait_for_function("(d) => document.querySelector('.an-recap')?.textContent.includes(d)", arg=fr(day))
    for site_id, name in [(SAKOURA, 'Sakoura'), (SOUROU, 'Sourou')]:
        page.fill('[data-input=anSearch]', name)
        page.click(f'#anCands [data-act=addSt][data-site={attr(site_id)}]')
        page.wait_for_selector(f'.an-sel-row:has-text("{name}")')
    page.click('#anForm button[type=submit]')
    page.wait_for_function("() => /^#\\/audit\\/[^/]+/.test(location.hash) && document.body.classList.contains('in-audit')")
    audit_id = re.match(r'#/audit/([^/?]+)', page.evaluate('location.hash')).group(1)

    a = js(page, """const a = store.get('audit', arg);
        return { date: a.date, number: a.number, startedAt: a.startedAt, keys: a.stations.map(s => s.key),
          r: Object.fromEntries(Object.entries(a.responses).filter(([k]) => /^it-F1-R1@|^it-F2-1\\.4$/.test(k)).map(([k, v]) => [k, v.value])),
          amendments: (a.amendments || []).length };""", audit_id)
    assert a['date'] == day, f'date de tournée enregistrée sur l’audit : {a}'
    assert a['r'] == {'it-F2-1.4': day, **{f'it-F1-R1@{k}': day for k in a['keys']}}, a['r']
    assert js(page, "return (await import('./js/domain/model.js')).auditDate(store.get('audit', arg));", audit_id) == day

    # Écrans : en-tête / Infos, liste des audits, accueil, planning
    goto_hash(page, f'#/audit/{audit_id}/infos')
    assert fr(day) in view_text(page)
    goto_hash(page, '#/audits')
    row = page.locator('.li', has_text=a['number'])
    assert fr(day) in row.inner_text() and fr(today) not in row.inner_text(), row.inner_text()
    goto_hash(page, '#/')
    tour = page.locator('.hm-tour', has_text=a['number'])
    assert fr(day) in tour.inner_text(), tour.inner_text()
    goto_hash(page, '#/planning')
    assert f'tournée du {fr(day)}' in page.locator('.li', has_text=a['number']).inner_text()

    # Rapport d'audit détaillé (js/app/report.js) et fiches de contrôle (js/app/sheets-pdf.js)
    texts = pdf_texts(page, "const { buildAuditReport } = await import('./js/app/report.js'); await buildAuditReport(arg);", audit_id)
    joined = '\n'.join(texts)
    assert f"{a['number']} · {fr(day)}" in joined, 'en-tête du rapport à la date de la tournée'
    assert f"{a['number']} · {fr(today)}" not in joined, 'aucune date de saisie dans l’en-tête du rapport'
    i = texts.index('Date')                     # « 1. Identification de l'audit » : libellé puis valeur
    assert texts[i + 1] == fr(day), texts[i:i + 4]
    texts = pdf_texts(page, "const { generateSheetsPdf } = await import('./js/app/sheets-pdf.js'); await generateSheetsPdf({ auditId: arg });", audit_id)
    assert fr(day) in '\n'.join(texts), 'fiches de contrôle à la date de la tournée'

    # Station ajoutée après coup : pré-remplie avec la date de la tournée (pas celle du jour), sans heure d'arrivée
    added = js(page, """const a = await A.addStation(store.get('audit', arg), { siteId: 'site-09280106' });
        const key = a.stations.at(-1).key;
        const items = Object.entries(a.responses).filter(([k, v]) => k.endsWith('@' + key) && v.prefilled);
        return { key, date: a.responses['it-F1-R1@' + key]?.value, times: items.filter(([, v]) => /^\\d{2}:\\d{2}$/.test(String(v.value))).map(([k]) => k) };""", audit_id)
    assert added['date'] == day, added
    assert added['times'] == [], f'aucune heure d’arrivée pré-remplie pour une tournée d’un autre jour : {added}'


# ---------------------------------------------------------------------------------------------------------------
def test_saisie_en_cours_conservee(page, app_url):
    """P2 : texte en cours de frappe conservé au verrouillage, à la mise en arrière-plan et à la fermeture."""
    setup_standalone(page, app_url)
    tour = create_tour(page, 'ce', [SAKOURA], 'prov-TL1', RCO[:1])
    audit_id = tour['id']
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')

    # 1. Verrouillage (même chemin que l'inactivité) pendant la frappe d'une observation, champ non quitté
    obs = page.locator(f'[id={attr("t-o-it-F2-2.4")}]')
    obs.click()
    page.keyboard.type('Commentaire en cours de frappe')
    assert page.evaluate("document.activeElement.id") == 't-o-it-F2-2.4'
    page.evaluate("window.AuditApp.lockApp('inactivité')")
    page.wait_for_selector('#loginBtn')
    unlock(page, PASSWORD)
    assert (response(page, audit_id, 'it-F2-2.4') or {}).get('comment') == 'Commentaire en cours de frappe', 'observation conservée'

    # 2. Enregistrement différé pendant la frappe (encadré « Observations » de la feuille), sans quitter le champ
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    box = page.locator('[id="sheet-2-observations"]')
    box.click()
    page.keyboard.type('Équipe en sous-effectif')
    page.wait_for_function("(id) => window.AuditApp.store.get('audit', id).sheets?.['2']?.observations === 'Équipe en sous-effectif'", arg=audit_id, timeout=5000)
    assert page.evaluate("document.activeElement.id") == 'sheet-2-observations', 'le champ garde le focus pendant l’enregistrement'
    page.keyboard.type(' ce matin')     # la frappe continue normalement après l'enregistrement différé
    assert box.input_value() == 'Équipe en sous-effectif ce matin'

    # 3. Mise en arrière-plan avant la fin du délai (changement d'application, écran éteint) puis fermeture de l'onglet
    page.evaluate("""() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
    }""")
    page.wait_for_function("(id) => window.AuditApp.store.get('audit', id).sheets?.['2']?.observations === 'Équipe en sous-effectif ce matin'", arg=audit_id, timeout=5000)
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    note = page.locator(f'[id={attr("t-o-it-F2-2.5")}]')
    note.click()
    page.keyboard.type('Saisie avant fermeture')
    page.evaluate("() => window.dispatchEvent(new Event('pagehide'))")
    page.wait_for_function("(id) => window.AuditApp.store.get('audit', id).responses?.['it-F2-2.5']?.comment === 'Saisie avant fermeture'", arg=audit_id, timeout=5000)
    page.evaluate("() => window.AuditApp.store.flush()")
    page.reload()
    unlock(page, PASSWORD)
    saved = js(page, "const a = store.get('audit', arg); return [a.sheets?.['2']?.observations, a.responses?.['it-F2-2.5']?.comment];", audit_id)
    assert saved == ['Équipe en sous-effectif ce matin', 'Saisie avant fermeture'], saved

    # 4. La saisie (clavier virtuel, dictée vocale : événements 'input') compte comme une activité
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    touched = page.evaluate("""() => {
        const s = window.AuditApp.session; s.lastActivity = 0;
        const el = document.getElementById('sheet-2-notes') || document.querySelector('textarea');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return s.lastActivity;
    }""")
    assert touched > 0, 'événement input = activité (pas de verrouillage pendant une dictée)'


# ---------------------------------------------------------------------------------------------------------------
@pytest.fixture
def signed_tour(page, app_url):
    """Tournée cours d'eau de deux stations complète, signée et verrouillée."""
    setup_standalone(page, app_url)
    tour = ce_tour(page)
    answer_required(page, tour['id'])
    sign_and_lock(page, tour['id'])
    assert js(page, "return !!store.get('audit', arg).lock?.lockedAt", tour['id'])
    return tour


def test_modification_apres_signature_sans_effacement(page, signed_tour):
    """P4 : pas d'effacement silencieux ; « Terminer les modifications » refusé avec un point bloquant introduit."""
    audit_id = signed_tour['id']
    item = 'it-F2-2.3'
    assert response(page, audit_id, item)['status'] == 'C'
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    page.click('[data-act=amend-start]')
    page.fill('#__prompt', 'Correction après relecture')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('[data-act=amend-stop]')

    # Nouvel appui sur « C » d'un critère obligatoire : refusé, la réponse reste
    page.click(f'[id={attr("row-" + item)}] [data-act=resp][data-value="C"]')
    page.wait_for_selector('.toast:has-text("obligatoire")')
    assert response(page, audit_id, item)['status'] == 'C'
    assert js(page, "return (store.get('audit', arg).amendments || []).length", audit_id) == 0

    # Bilan d'une feuille station : effacement seulement après confirmation explicite
    goto_hash(page, f"#/audit/{audit_id}/feuille-4@{signed_tour['stations'][0]}")
    concl = page.locator('[data-act=sheet-concl]').first
    sheet, value = concl.get_attribute('data-sheet'), concl.get_attribute('data-value')
    concl.click()
    page.wait_for_function("([id, k, v]) => window.AuditApp.store.get('audit', id).sheets?.[k]?.conclusion?.status === v", arg=[audit_id, sheet, value])
    page.locator('[data-act=sheet-concl]').first.click()
    page.wait_for_selector('.modal:has-text("Effacer")')
    page.click('.modal [data-act=no]')
    page.wait_for_timeout(300)
    assert js(page, "return store.get('audit', arg.id).sheets[arg.k].conclusion.status", {'id': audit_id, 'k': sheet}) == value, 'conservé (« Conserver »)'
    page.locator('[data-act=sheet-concl]').first.click()
    page.click('.modal [data-act=yes]')
    page.wait_for_function("([id, k]) => !window.AuditApp.store.get('audit', id).sheets?.[k]?.conclusion?.status", arg=[audit_id, sheet])
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')

    # Point bloquant introduit (P sans observation) : clôture des modifications refusée, avec le lien vers le critère
    page.click(f'[id={attr("row-" + item)}] [data-act=resp][data-value="P"]')
    page.wait_for_function("([id, it]) => window.AuditApp.store.get('audit', id).responses[it].status === 'P'", arg=[audit_id, item])
    page.click('[data-act=amend-stop]')
    modal = page.locator('.modal:has-text("Modifications à compléter")')
    modal.wait_for()
    assert 'justification obligatoire' in modal.inner_text() and 'F2' in modal.inner_text()
    assert modal.locator(f'a[href*="item={item}"]').count() == 1
    modal.locator('[data-act]').last.click()
    assert page.locator('[data-act=amend-stop]').count() == 1, 'modification toujours en cours'

    # Observation ajoutée : clôture acceptée, audit complet et intègre
    obs = page.locator(f'[id={attr("t-o-" + item)}]')
    obs.fill('Un stagiaire présent sans encadrement permanent.')
    obs.evaluate('el => el.blur()')
    page.wait_for_function("([id, it]) => !!window.AuditApp.store.get('audit', id).responses[it].comment", arg=[audit_id, item])
    page.click('[data-act=amend-stop]')
    page.wait_for_selector('[data-act=amend-start]')
    st = js(page, """const a = store.get('audit', arg); const seal = await A.verifyAuditSeal(a);
        return { errors: A.auditState(a).validation.filter(v => v.level === 'error').length, ok: seal.ok, amendments: seal.amendments };""", audit_id)
    assert st['errors'] == 0 and st['ok'] and st['amendments'] >= 3, st


def test_signature_affichee_entiere(page, signed_tour):
    """P8 : la signature (688 × 200, tracée à gauche) est affichée entière, sans recadrage, avec un texte alternatif."""
    goto_hash(page, f"#/audit/{signed_tour['id']}/signatures")
    page.wait_for_function("() => [...document.querySelectorAll('#view img.sig-img')].every(i => i.complete && i.naturalWidth > 0) && document.querySelectorAll('#view img.sig-img').length === 2")
    imgs = page.evaluate("""() => [...document.querySelectorAll('#view img.sig-img')].map(i => {
        const r = i.getBoundingClientRect(), cs = getComputedStyle(i);
        return { w: r.width, h: r.height, nw: i.naturalWidth, nh: i.naturalHeight, fit: cs.objectFit, alt: i.alt, thumb: !!i.closest('.thumbs') };
    })""")
    for i in imgs:
        assert (i['nw'], i['nh']) == (688, 200), i
        assert not i['thumb'] and i['fit'] in ('contain', 'fill'), i
        assert abs(i['w'] / i['h'] - 688 / 200) < 0.08, f'proportions conservées (aucun recadrage) : {i}'
        assert i['alt'].startswith('Signature'), i
    assert 'Jean Préleveur' in ' '.join(i['alt'] for i in imgs)


# ---------------------------------------------------------------------------------------------------------------
def test_dates_indicatives_pas_en_retard(page, app_url):
    """P6 : RCO S1 (indicative, 1er octobre ; campagne jusqu'au 31/10) non en retard le 11/10 ; Chimie S1 en retard."""
    setup_standalone(page, app_url)
    r = js(page, """const P = await import('./js/views/planning.js');
        const of = c => store.all('prestation').filter(p => p.campaignId === c);
        return { rco: of('camp-RCO-S1_-_Octobre_2026').map(p => [p.dateIndicative, P.isLate(p, '2026-10-11'), P.isLate(p, '2026-11-01')]),
                 chimie: of('camp-Chimie-S1_-_Sept_26').map(p => P.isLate(p, '2026-10-11')) };""")
    assert r['rco'] and all(ind and not late and after for ind, late, after in r['rco']), r['rco']
    assert r['chimie'] and all(r['chimie']), r['chimie']
    # Écran Planning, filtre « En retard » : exactement les prestations dont l'échéance est passée aujourd'hui (pas
    # de prestation RCO S1 avant la fin de sa campagne) ; tableau de bord : même décompte « Audits en retard ».
    goto_hash(page, '#/planning?periode=retard')
    shown = page.evaluate("() => [...document.querySelectorAll('#view a[href^=\"#/prestation/\"]')].map(a => decodeURIComponent(a.getAttribute('href').slice(13)))")
    late = js(page, """const P = await import('./js/views/planning.js'); const { localDate } = await import('./js/core/util.js');
        const today = localDate();
        return { ids: store.all('prestation').filter(p => P.isLate(p, today)).map(p => p.id), today };""")
    assert sorted(set(shown)) == sorted(late['ids']), 'planning : prestations en retard = échéance passée'
    if late['today'] <= '2026-10-31':
        assert not [i for i in shown if 'RCO' in i and 'S1_-_Octobre_2026' in i], shown
    assert re.search(rf"En retard\s*{len(late['ids'])}\b", page.inner_text('#view .chips')), page.inner_text('#view .chips')
    goto_hash(page, '#/tableau-de-bord')


# ---------------------------------------------------------------------------------------------------------------
def test_fiche_station_quittee_pendant_la_carte(page, app_url):
    """P7 : fiche station quittée juste après la création de sa carte, vers un écran dont le module se charge
    lentement (le routeur libère la carte AVANT de remplacer la fiche) : le minuteur invalidateSize de la carte
    libérée est annulé, aucune erreur Leaflet (« _leaflet_pos »)."""
    setup_standalone(page, app_url)
    slow = re.compile(r'/js/views/(planning|audit-new|dashboard)\.js(\?|$)')

    def delayed(route):
        time.sleep(0.6)                 # chargement lent du module de l'écran suivant (> minuteur de 200 ms)
        route.continue_()
    page.route(slow, delayed)
    for target in ('#/planning', '#/nouvel-audit', '#/tableau-de-bord'):
        goto_hash(page, f'#/station/{ATHANASE}', settle=False)
        page.wait_for_selector('#view .leaflet-container', state='attached')
        goto_hash(page, target, settle=False)
        page.wait_for_timeout(300)      # au-delà du minuteur de 200 ms
    assert page.errors == [], page.errors


# ---------------------------------------------------------------------------------------------------------------
def test_ecarts_de_tournee_et_station_retiree(page, app_url):
    """P9, P10, P11 : écart sur un critère commun ; station retirée avec un écart ouvert ; liste des audits."""
    setup_standalone(page, app_url)
    tour = ce_tour(page)
    audit_id, (k1, k2) = tour['id'], tour['stations']

    # P9 : critère commun F4.2 à P depuis la 2e station → écart de TOURNÉE (toutes les stations et prestations)
    dev = js(page, """const id = arg.id;
        await A.setResponse(store.get('audit', id), 'it-F4-2', { status: 'P', comment: 'Calibration des sondes incomplète' });
        await A.setResponse(store.get('audit', id), 'it-F4-3@' + arg.k1, { status: 'NC', comment: 'Flaconnage non conforme' });
        const d = await A.createDeviation(store.get('audit', id), { itemId: 'it-F4-2', itemCode: 'F4.2', requirement: 'Calibration des sondes', description: 'Calibration incomplète' });
        return { id: d.id, number: d.number, siteId: d.siteId, prestationId: d.prestationId, stationKey: d.stationKey, siteIds: d.siteIds, prestationIds: d.prestationIds, place: A.deviationPlace(d) };""",
             {'id': audit_id, 'k1': k1})
    assert dev['stationKey'] is None and dev['siteId'] is None and dev['prestationId'] is None, dev
    assert dev['siteIds'] == [SAKOURA, SOUROU] and dev['prestationIds'] == RCO, dev
    assert dev['place'] == 'Tournée (Crique Sakoura, Crique Sourou)', dev['place']
    goto_hash(page, '#/ecarts')
    assert 'Tournée (Crique Sakoura, Crique Sourou)' in page.locator('.li', has_text=dev['number']).inner_text()
    goto_hash(page, f"#/ecart/{dev['id']}")
    assert 'Tournée (Crique Sakoura, Crique Sourou)' in view_text(page)
    cols = js(page, """const E = await import('./js/app/exports.js'); const d = store.get('deviation', arg);
        return Object.fromEntries(E.COLUMNS.deviations.filter(c => ['Site', 'Station'].includes(c.label)).map(c => [c.label, c.get(d)]));""", dev['id'])
    assert cols == {'Site': 'Crique Sakoura ; Crique Sourou', 'Station': 'Tournée (Crique Sakoura, Crique Sourou)'}, cols
    # Filtre du registre par site : l'écart de tournée est retrouvé depuis chacune des stations
    goto_hash(page, f'#/ecarts?site={SOUROU}')
    assert dev['number'] in view_text(page)

    # P11 : badge C · P · NC et stations de la tournée dans la liste des audits
    goto_hash(page, '#/audits')
    row = page.locator('.li', has_text=tour['number']).inner_text()
    assert '2 stations : Crique Sakoura, Crique Sourou' in row, row
    assert re.search(r'\d+ C · 1 P · 1 NC', row), row

    # P10 : station ajoutée, écart ouvert sur sa feuille 4, puis retrait motivé → écart annulé avec le même motif
    added = js(page, """const a = await A.addStation(store.get('audit', arg), { siteId: 'site-09280106' });
        const key = a.stations.at(-1).key;
        await A.setResponse(store.get('audit', arg), 'it-F4-3@' + key, { status: 'NC', comment: 'Flacons non identifiés' });
        const d = await A.createDeviation(store.get('audit', arg), { itemId: 'it-F4-3@' + key, itemCode: 'F4.3', requirement: 'Flaconnage', description: 'Flacons non identifiés' });
        let refused = null;
        try { await A.removeStation(store.get('audit', arg), key, { reason: 'Station inaccessible' }); } catch (e) { refused = { cancel: !!e.needsCancel, open: (e.openDeviations || []).map(x => x.number) }; }
        return { key, id: d.id, number: d.number, refused };""", audit_id)
    assert added['refused'] == {'cancel': True, 'open': [added['number']]}, f"retrait refusé tant que l'écart est ouvert : {added}"
    goto_hash(page, f'#/audit/{audit_id}/infos')
    page.click(f'[data-act=tour-remove][data-key="{added["key"]}"]')
    page.click('.modal [data-act=yes]')                       # « Retirer la station Twenke ? »
    page.fill('#__prompt', 'Station inaccessible (crue)')
    page.click('.modal [data-act=ok]')
    confirm = page.locator('.modal:has-text("Écarts ouverts de la station")')
    confirm.wait_for()
    assert added['number'] in confirm.inner_text() and 'Station inaccessible (crue)' in confirm.inner_text()
    confirm.locator('[data-act=yes]').click()
    page.wait_for_function("([id, k]) => !window.AuditApp.store.get('audit', id).stations.some(s => s.key === k)", arg=[audit_id, added['key']])
    d = js(page, "const d = store.get('deviation', arg); return { status: d.status, note: d.closureNote, last: d.history.at(-1), place: A.deviationPlace(d) };", added['id'])
    assert d['status'] == 'annule' and 'Station inaccessible (crue)' in d['note'] and d['last']['reason'] == 'Station inaccessible (crue)', d
    assert d['place'] == 'Twenke (09280106) (retirée)', d['place']
    goto_hash(page, f'#/audit/{audit_id}/ecarts')
    row = page.locator('.li', has_text=added['number']).inner_text()
    assert 'Twenke (retirée)' in row and '09280106\n' not in row + '\n', row
    assert js(page, "return A.stationLabel(store.get('audit', arg.id), arg.k)", {'id': audit_id, 'k': added['key']}) == 'Twenke (retirée)'
