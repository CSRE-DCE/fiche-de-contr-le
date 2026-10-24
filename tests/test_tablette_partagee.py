"""Tablettes partagées (deux tablettes pour quatre agents, mode autonome, aucun jeton) : parcours par l'interface.

  1. Binôme sur une tablette : A crée une tournée en binôme avec B (étape « Contrôleurs OEG de la tournée »,
     « Agent(s) OEG » et « Contrôleur OEG » pré-remplis « Alice Dupont, Bruno Martin »), saisit, « Changer d'agent »
     (écran « Qui utilise la tablette ? », aucun agent présélectionné) ; B se connecte, arrive sur la tournée,
     poursuit (saisie attribuée à B) et la retrouve à l'accueil (« Tournées en cours sur cette tablette ») ; C, hors
     binôme, voit « Rejoindre la tournée » (lecture seule avant), rejoint (noms pré-remplis mis à jour), saisit ;
     onglet Infos « Qui a saisi quoi » ; B termine et SIGNE au pavé de signature ; fiches PDF et rapport détaillé :
     tous les contrôleurs.
  2. Retrait d'un contrôleur (onglet Infos) : motif obligatoire, historique, noms pré-remplis mis à jour, jamais le
     dernier.
  3. Profil reçu d'une autre tablette (paquet de données) : présent dans le magasin mais pas dans le trousseau
     local → « Agents pas encore sur cette tablette » › « Ajouter sur cette tablette » (mot de passe saisi deux fois
     par l'agent) → l'agent se connecte avec le MÊME identifiant de profil et retrouve sa tournée ; identifiant déjà
     pris sur la tablette par un autre profil : refus expliqué, ajout possible après retrait du compte local ;
     « Retirer de cette tablette » ; jamais le dernier administrateur de la tablette.
  4. Écran de configuration (mode autonome d'office, mode équipe replié ; compte de l'administrateur : nom, prénom,
     initiales et identifiant proposés), « Ajouter un agent » (nom, prénom, initiales, profil, mot de passe saisi deux
     fois) et « Changer d'agent » : libellé visible sur tablette, icône + entrée du Menu sur téléphone ; l'agent
     suivant arrive sur l'accueil (aussi après un verrouillage par inactivité, sauf s'il s'agit du même agent).
"""
import re

import pytest

from helpers import PASSWORD, answer_required, create_tour, goto_hash, js, open_setup, response, setup_standalone, unlock

SAKOURA = 'site-09281718'
PW = {'bmartin': 'bruno-mdp-2026', 'cpetit': 'chloe-mdp-2026', 'ddurand': 'dora-mdp-2026', 'eleroy': 'eric-mdp-2026', 'adupont': 'alice-t2-mdp-2026'}
TABLET = {'width': 1280, 'height': 900}
TABLET_PORTRAIT = {'width': 800, 'height': 1280}
PHONE = {'width': 390, 'height': 844}
# « Créer le jeton », « créez un jeton »… : aucun écran affiché ne doit le demander (le mode équipe est replié).
CREATE_TOKEN = re.compile(r'cr[ée]e[rz]?\s+(le|un|son|votre)\s+jeton|jeton\s+d.acc[eè]s', re.I)


def attr(value):
    """Valeur d'attribut pour un sélecteur CSS (identifiants contenant « @ » et « . »)."""
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def me(page):
    return js(page, 'return session.user.id;')


def keyring(page):
    """Agents de la tablette (trousseau local) : {identifiant: identifiant de profil}."""
    return page.evaluate("""async () => { const a = await import('./js/core/auth.js');
        return Object.fromEntries((await a.knownUsers()).map(u => [u.username, u.userId])); }""")


def add_agent(page, last, first, username, *, role='auditeur', initials=None):
    """« Ajouter un agent » (Administration › Agents de cette tablette) : nom, prénom, initiales et identifiant
    proposés, profil, mot de passe saisi deux fois. Retourne l'identifiant du profil créé."""
    goto_hash(page, '#/administration')
    page.click('#tabletAgents [data-act=user-new]')
    page.wait_for_selector('#uf')
    page.fill('#uf [name=lastName]', last)
    page.fill('#uf [name=firstName]', first)
    assert page.input_value('#uf [name=username]') == username, 'identifiant proposé : initiale du prénom + nom'
    expected = (first[0] + last[0]).upper()
    assert page.input_value('#uf [name=initials]') == expected, 'initiales proposées'
    if initials:
        page.fill('#uf [name=initials]', initials)
    page.select_option('#uf [name=role]', role)
    page.fill('#uf [name=password]', PW[username])
    page.fill('#uf [name=password2]', PW[username])
    page.click('.modal [data-act=ok]')
    page.wait_for_selector(f'#tabletAgents [data-agent]:has-text("{first} {last}")')
    uid = keyring(page)[username]
    profile = js(page, "return store.get('user', arg);", uid)
    assert profile['name'] == f'{first} {last}' and profile['firstName'] == first and profile['lastName'] == last, profile
    assert profile['initials'] == (initials or expected) and profile['role'] == role and profile['active'] is True, profile
    return uid


def switch_agent(page):
    """« Changer d'agent » (en-tête) : saisie enregistrée, écran « Qui utilise la tablette ? »."""
    page.click('[data-act=shell-lock]')
    page.wait_for_selector('#loginBtn')
    assert page.inner_text('.auth-card h1').casefold() == 'qui utilise la tablette ?'


def login(page, username, password=None):
    unlock(page, password or PW[username], username=username)


def click_status(page, item, value):
    page.click(f'[id={attr("row-" + item)}] [data-act=resp][data-value="{value}"]')
    page.wait_for_selector(f'[id={attr("row-" + item)}] [data-act=resp][data-value="{value}"][aria-pressed=true]')


def controllers(page, audit_id):
    return js(page, """const a = store.get('audit', arg);
        return { ids: a.controllerIds, names: A.controllersLabel(a), log: (a.controllerLog || []).map(l => ({ action: l.action, userId: l.userId, by: l.by, reason: l.reason })),
          f2: a.responses['it-F2-1.1'], r3: Object.entries(a.responses).filter(([k]) => k.startsWith('it-F1-R3@')).map(([, r]) => r.value) };""", audit_id)


def pdf_texts(page, body, arg=None):
    """Textes dessinés dans un PDF (PDFDocument.text espionné pendant `body`)."""
    return page.evaluate(f"""async (arg) => {{
        const A = await import('./js/app/audits.js');
        const store = window.AuditApp.store;
        const {{ PDFDocument }} = await import('./js/formats/pdf.js');
        const seen = [], orig = PDFDocument.prototype.text;
        PDFDocument.prototype.text = function (s, ...rest) {{ seen.push(String(s)); return orig.call(this, s, ...rest); }};
        try {{ {body} }} finally {{ PDFDocument.prototype.text = orig; }}
        return seen;
    }}""", arg)


def sign_on_pad(page):
    """Signature tracée au doigt (souris) dans le pavé, puis « Valider la signature »."""
    pad = page.locator('#__sig')
    pad.wait_for()
    page.wait_for_timeout(100)          # dimensionnement du canevas (requestAnimationFrame)
    box = pad.bounding_box()
    x, y, w, h = box['x'], box['y'], box['width'], box['height']
    page.mouse.move(x + 0.1 * w, y + 0.7 * h)
    page.mouse.down()
    for i in range(1, 16):
        page.mouse.move(x + (0.1 + 0.05 * i) * w, y + (0.7 - 0.4 * (i % 2)) * h)
    page.mouse.up()
    page.click('.modal [data-act=ok]')


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_binome_changer_d_agent_rejoindre_et_signer(page, app_url):
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    alice = me(page)
    bruno = add_agent(page, 'Martin', 'Bruno', 'bmartin')
    chloe = add_agent(page, 'Petit', 'Chloé', 'cpetit')
    assert keyring(page) == {'adupont': alice, 'bmartin': bruno, 'cpetit': chloe}

    # A crée la tournée en binôme avec B (écran de création, étape « Contrôleurs OEG de la tournée »)
    goto_hash(page, '#/nouvel-audit')
    page.click('[data-act=setType][data-v=ce]')
    page.click('[data-act=setProvider][data-v="prov-TL1"]')
    page.wait_for_selector('[data-act=setProvider][data-v="prov-TL1"][aria-checked=true]')
    own = page.locator(f'[data-change=setCtrl][value="{alice}"]')
    assert own.is_checked() and own.is_disabled(), 'agent connecté coché d’office et obligatoire'
    page.check(f'[data-change=setCtrl][value="{bruno}"]')
    page.wait_for_function("() => document.querySelector('.an-recap')?.textContent.includes('2 contrôleurs')")
    assert not page.is_checked(f'[data-change=setCtrl][value="{chloe}"]')
    page.fill('[data-input=anSearch]', 'Sakoura')
    page.click(f'#anCands [data-act=addSt][data-site="{SAKOURA}"]')
    page.wait_for_selector('.an-sel-row:has-text("Sakoura")')
    page.click('#anForm button[type=submit]')
    page.wait_for_function("() => /^#\\/audit\\/[^/]+/.test(location.hash) && document.body.classList.contains('in-audit')")
    audit_id = re.match(r'#/audit/([^/?]+)', page.evaluate('location.hash')).group(1)
    c = controllers(page, audit_id)
    assert c['ids'] == [alice, bruno] and c['names'] == 'Alice Dupont, Bruno Martin', c
    assert c['f2']['value'] == 'Alice Dupont, Bruno Martin' and c['f2']['prefilled'], 'F2 1.1 « Agent(s) OEG » pré-rempli'
    assert c['r3'] == ['Alice Dupont, Bruno Martin'], 'F1 R3 « Contrôleur OEG » pré-rempli'

    # A saisit
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    assert page.locator('#tourJoin').count() == 0
    click_status(page, 'it-F2-2.2', 'C')
    assert response(page, audit_id, 'it-F2-2.2')['by'] == alice

    # « Changer d'agent » : libellé visible sur tablette ; aucun agent présélectionné pour l'agent suivant
    assert page.locator('.pill-switch .lbl').is_visible() and 'Changer d’agent' in page.inner_text('.pill-switch')
    switch_agent(page)
    assert 'Alice Dupont : session fermée' in page.inner_text('#loginMsg')
    assert page.locator('.user-tile.sel').count() == 0
    assert set(page.locator('.user-tile b').all_inner_texts()) == {'Alice Dupont', 'Bruno Martin', 'Chloé Petit'}
    page.fill('#app [name=password]', PW['bmartin'])
    page.click('#loginBtn')
    page.wait_for_function("() => document.querySelector('#loginErr')?.textContent.includes('Touchez d’abord votre nom')")
    login(page, 'bmartin')

    # B arrive sur la tournée laissée par A, poursuit : saisie attribuée à B
    assert page.evaluate('location.hash').startswith(f'#/audit/{audit_id}')
    assert js(page, 'return session.user;')['name'] == 'Bruno Martin'
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    assert page.locator('#tourJoin').count() == 0, 'B est contrôleur : pas de bandeau « Rejoindre »'
    click_status(page, 'it-F2-2.3', 'C')
    r = response(page, audit_id, 'it-F2-2.3')
    assert r['by'] == bruno and r['byName'] == 'Bruno Martin', r
    assert response(page, audit_id, 'it-F2-2.2')['by'] == alice, 'la saisie de A lui reste attribuée'

    # Accueil de B : « Tournées en cours sur cette tablette »
    goto_hash(page, '#/')
    assert 'Tournées en cours sur cette tablette' in page.text_content('.hm-tours')
    card = page.locator(f'.hm-tour[data-tour="{audit_id}"]')
    assert 'is-mine' in card.get_attribute('class') and 'Reprendre' in card.inner_text()
    assert 'Alice Dupont, Bruno Martin' in card.inner_text()

    # C, hors binôme : « Voir ou rejoindre », lecture seule, « Rejoindre la tournée »
    switch_agent(page)
    login(page, 'cpetit')
    assert page.evaluate('location.hash') in ('#/', ''), 'écran quitté par B : accueil'
    card = page.locator(f'.hm-tour[data-tour="{audit_id}"]')
    assert 'is-mine' not in card.get_attribute('class') and 'Voir ou rejoindre' in card.inner_text()
    goto_hash(page, f'#/audit/{audit_id}/feuille-2')
    banner = page.inner_text('#tourJoin')
    assert 'Tournée d’Alice Dupont et Bruno Martin' in banner and 'Rejoindre la tournée' in banner, banner
    assert page.locator('[id="row-it-F2-2.4"] [data-act=resp][data-value="C"]').is_disabled(), 'hors binôme : lecture seule'
    page.click('#tourJoin [data-act=tour-join]')
    page.wait_for_function("() => !document.querySelector('#tourJoin')")
    c = controllers(page, audit_id)
    assert c['ids'] == [alice, bruno, chloe], c
    assert c['f2']['value'] == 'Alice Dupont, Bruno Martin, Chloé Petit', 'noms pré-remplis mis à jour'
    assert c['log'][-1] == {'action': 'ajout', 'userId': chloe, 'by': chloe, 'reason': None}, c['log']
    click_status(page, 'it-F2-2.4', 'C')
    assert response(page, audit_id, 'it-F2-2.4')['by'] == chloe

    # Infos : contrôleurs et « Qui a saisi quoi »
    goto_hash(page, f'#/audit/{audit_id}/infos')
    assert page.locator('#tourControllers [data-ctrl]').count() == 3
    rows = {page.locator(f'.as-by-agent tr[data-agent="{u}"] th').text_content().strip(): page.locator(f'.as-by-agent tr[data-agent="{u}"] td').text_content().strip()
            for u in (alice, bruno, chloe)}
    assert rows == {'Alice Dupont': '1', 'Bruno Martin': '1', 'Chloé Petit': '1'}, rows
    assert 'Historique des contrôleurs (1)' in page.text_content('#tourControllers')

    # B termine et signe pour la tournée
    switch_agent(page)
    login(page, 'bmartin')
    assert page.evaluate('location.hash').startswith(f'#/audit/{audit_id}'), 'tournée affichée par C : B y arrive'
    assert answer_required(page, audit_id) > 20
    goto_hash(page, f'#/audit/{audit_id}/signatures')
    note = page.inner_text('#view')
    assert 'Alice Dupont, Bruno Martin, Chloé Petit' in note and 'un seul d’entre eux signe' in note
    page.click('[data-act=finish]')
    page.wait_for_selector('text=Terminé à')
    assert 'Signer en tant que contrôleur (Bruno Martin)' in page.inner_text('[data-act=sign-auditor]')
    page.click('[data-act=sign-auditor]')
    sign_on_pad(page)
    page.wait_for_function("(id) => !!window.AuditApp.store.get('audit', id)?.signatures?.auditor", arg=audit_id)
    sig = js(page, "return store.get('audit', arg).signatures.auditor;", audit_id)
    assert sig['name'] == 'Bruno Martin' and sig['userId'] == bruno and sig['function'] == 'Contrôleur OEG', sig
    assert js(page, """const { canJoinAudit } = await import('./js/domain/permissions.js');
        return canJoinAudit(store.get('audit', arg), { id: 'u-autre', role: 'auditeur' });""", audit_id) is False, 'signée : plus de « Rejoindre »'

    # Fiches PDF et rapport détaillé : tous les contrôleurs
    model = js(page, """const { sheetsModelFromAudit } = await import('./js/app/sheets-pdf.js');
        const m = await sheetsModelFromAudit(store.get('audit', arg)); return { name: m.auditorName, n: m.controllerCount };""", audit_id)
    assert model == {'name': 'Alice Dupont, Bruno Martin, Chloé Petit', 'n': 3}, model
    texts = pdf_texts(page, "const { generateSheetsPdf } = await import('./js/app/sheets-pdf.js'); await generateSheetsPdf({ auditId: arg });", audit_id)
    joined = ' '.join(texts)
    assert 'Alice Dupont, Bruno Martin, Chloé Petit' in joined, 'fiches : contrôleurs de la tournée'
    assert any(t.startswith('Contrôleurs OEG') for t in texts)
    texts = pdf_texts(page, "const { buildAuditReport } = await import('./js/app/report.js'); await buildAuditReport(arg);", audit_id)
    joined = ' '.join(texts)
    assert 'Contrôleurs OEG' in joined and 'Alice Dupont, Bruno Martin, Chloé Petit' in joined
    assert 'Bruno Martin : ' in joined and 'Chloé Petit : 1 réponse(s)' in joined, 'saisies par agent'


def test_retrait_d_un_controleur_avec_motif(page, app_url):
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    alice = me(page)
    bruno = page.evaluate("""async () => { const a = await import('./js/core/auth.js');
        return a.addLocalAccount({ username: 'bmartin', name: 'Bruno Martin', role: 'auditeur', password: 'bruno-mdp-2026' }); }""")
    tour = create_tour(page, 'ce', [SAKOURA], 'prov-TL1', controllerIds=[bruno])
    assert controllers(page, tour['id'])['ids'] == [alice, bruno]
    # Motif obligatoire
    err = js(page, """try { await A.removeController(store.get('audit', arg.id), arg.bruno, { reason: '  ' }); return null; } catch (e) { return e.message; }""",
             {'id': tour['id'], 'bruno': bruno})
    assert err and 'motif est obligatoire' in err, err
    goto_hash(page, f'#/audit/{tour["id"]}/infos')
    page.click(f'#tourControllers [data-act=ctrl-remove][data-id="{bruno}"]')
    page.wait_for_selector('#__prompt')
    page.click('.modal [data-act=ok]')
    assert 'obligatoire' in page.inner_text('#__prompt_err')
    page.fill('#__prompt', 'Rappelé au bureau')
    page.click('.modal [data-act=ok]')
    page.wait_for_function("() => document.querySelectorAll('#tourControllers [data-ctrl]').length === 1")
    c = controllers(page, tour['id'])
    assert c['ids'] == [alice] and c['f2']['value'] == 'Alice Dupont', c
    assert c['log'] == [{'action': 'retrait', 'userId': bruno, 'by': alice, 'reason': 'Rappelé au bureau'}], c['log']
    assert 'Bruno Martin retiré(e) par Alice Dupont — motif : « Rappelé au bureau »' in page.text_content('#tourControllers')
    # Jamais le dernier contrôleur
    assert page.locator('#tourControllers [data-act=ctrl-remove]').count() == 0
    err = js(page, """try { await A.removeController(store.get('audit', arg.id), arg.alice, { reason: 'test' }); return null; } catch (e) { return e.message; }""",
             {'id': tour['id'], 'alice': alice})
    assert err and 'au moins un contrôleur' in err, err
    # Ajout par un contrôleur (liste « Ajouter un contrôleur »)
    page.select_option('#ctrlAdd', bruno)
    page.wait_for_function("() => document.querySelectorAll('#tourControllers [data-ctrl]').length === 2")
    assert controllers(page, tour['id'])['f2']['value'] == 'Alice Dupont, Bruno Martin'


@pytest.mark.lent
def test_ajouter_sur_cette_tablette_profil_recu(make_page, app_url):
    # Tablette 1 : l'administratrice crée l'agent Dora et une tournée dont Dora est contrôleuse
    t1 = make_page(label='tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    alice = me(t1)
    dora = add_agent(t1, 'Durand', 'Dora', 'ddurand')
    tour = create_tour(t1, 'ce', [SAKOURA], 'prov-TL1', controllerIds=[dora])
    package = js(t1, """const { buildPackage } = await import('./js/app/exports.js');
        return JSON.stringify(await buildPackage({ includeMedia: false }));""")

    # Tablette 2 : son administrateur reçoit les données de la tablette 1 (paquet de données)
    t2 = make_page(label='tablette 2')
    setup_standalone(t2, app_url, device='Tablette 2', device_no=2, name='Eric Leroy', username='eleroy')
    admin2 = me(t2)
    # Avant la réception : un compte « adupont » créé sur la tablette 2 (autre profil que celui de la tablette 1)
    alice2 = add_agent(t2, 'Dupont', 'Alice', 'adupont')
    assert alice2 != alice
    res = js(t2, """const X = await import('./js/app/exports.js');
        return X.importPackage(await X.readPackage(arg));""", package)
    assert res['added'] > 0
    assert js(t2, "return store.get('user', arg)?.name;", dora) == 'Dora Durand', 'profil reçu dans le magasin'
    assert dora not in keyring(t2).values(), '… mais pas dans le trousseau de la tablette 2'

    goto_hash(t2, '#/administration')
    others = t2.text_content('#teamAgents')
    assert 'Agents pas encore sur cette tablette' in others and 'Dora Durand' in others and 'Alice Dupont' in others, others
    assert 'jeton' not in (t2.text_content('#tabletAgents') + others).casefold()
    t2.click(f'#teamAgents [data-act=agent-enroll][data-id="{dora}"]')
    t2.wait_for_selector('#ef')
    assert 'c’est l’agent qui choisit et saisit son mot de passe' in t2.text_content('#ef')
    t2.fill('#ef [name=p1]', PW['ddurand'])
    t2.fill('#ef [name=p2]', PW['ddurand'] + 'x')
    t2.click('.modal [data-act=ok]')
    t2.wait_for_function("() => document.querySelector('#efErr')?.textContent.includes('ne correspondent pas')")
    t2.fill('#ef [name=p2]', PW['ddurand'])
    t2.click('.modal [data-act=ok]')
    t2.wait_for_selector(f'#tabletAgents [data-agent="{dora}"]')
    assert keyring(t2)['ddurand'] == dora, 'MÊME identifiant de profil que sur la tablette 1'
    assert t2.locator(f'#teamAgents [data-agent="{dora}"]').count() == 0

    # Dora se connecte sur la tablette 2 et retrouve sa tournée
    switch_agent(t2)
    assert t2.locator('.user-tile[data-u="ddurand"]').count() == 1
    login(t2, 'ddurand')
    assert js(t2, 'return session.user;') == {'id': dora, 'username': 'ddurand', 'name': 'Dora Durand', 'role': 'auditeur'}
    goto_hash(t2, '#/')
    card = t2.locator(f'.hm-tour[data-tour="{tour["id"]}"]')
    assert 'is-mine' in card.get_attribute('class') and 'Reprendre' in card.inner_text()
    assert js(t2, """const auth = await import('./js/core/auth.js'); return auth.canEditAudit(store.get('audit', arg));""", tour['id']) is True

    # « Retirer de cette tablette » : entrée locale seulement ; jamais le dernier administrateur
    switch_agent(t2)
    login(t2, 'eleroy', PASSWORD)
    goto_hash(t2, '#/administration')
    assert t2.locator(f'#tabletAgents [data-agent="{admin2}"] [data-act=agent-remove]').count() == 0, 'pas de retrait de soi-même'
    t2.click(f'#tabletAgents [data-act=agent-remove][data-id="{dora}"]')
    t2.click('.modal [data-act=yes]')
    t2.wait_for_selector(f'#teamAgents [data-agent="{dora}"]')
    assert 'ddurand' not in keyring(t2)
    assert js(t2, "return store.get('user', arg)?.active;", dora) is True, 'profil conservé'
    err = t2.evaluate("""async (id) => { const a = await import('./js/core/auth.js');
        try { await a.removeAgentFromDevice(id); return null; } catch (e) { return e.message; } }""", admin2)
    assert err and 'connecté' in err, err
    t2.click(f'#tabletAgents [data-act=user-edit][data-id="{admin2}"]')
    t2.wait_for_selector('#uf')
    assert t2.input_value('#uf [name=firstName]') == 'Eric' and t2.input_value('#uf [name=lastName]') == 'Leroy'
    t2.select_option('#uf [name=role]', 'auditeur')
    t2.click('.modal [data-act=ok]')
    t2.wait_for_selector('.toast.err:has-text("dernier administrateur de cette tablette")')
    assert js(t2, "return store.get('user', session.user.id).role;") == 'admin'
    assert js(t2, 'return session.user.role;') == 'admin'

    # Même identifiant, autre profil : refus expliqué ; après « Retirer de cette tablette » du compte local, ajout possible
    t2.click(f'#teamAgents [data-act=agent-enroll][data-id="{alice}"]')
    t2.wait_for_selector('#ef')
    t2.fill('#ef [name=p1]', PASSWORD)
    t2.fill('#ef [name=p2]', PASSWORD)
    t2.click('.modal [data-act=ok]')
    t2.wait_for_function("() => document.querySelector('#efErr')?.textContent.includes('déjà utilisé sur cette tablette')")
    assert 'retirez d’abord Alice Dupont de cette tablette' in t2.text_content('#efErr')
    t2.click('.modal [data-act=__close]')
    t2.wait_for_selector('#ef', state='detached')
    t2.click(f'#tabletAgents [data-act=agent-remove][data-id="{alice2}"]')
    t2.click('.modal [data-act=yes]')
    t2.wait_for_selector(f'#teamAgents [data-agent="{alice2}"]')
    t2.click(f'#teamAgents [data-act=agent-enroll][data-id="{alice}"]')
    t2.wait_for_selector('#ef')
    t2.fill('#ef [name=p1]', PASSWORD)
    t2.fill('#ef [name=p2]', PASSWORD)
    t2.click('.modal [data-act=ok]')
    t2.wait_for_selector(f'#tabletAgents [data-agent="{alice}"]')
    assert keyring(t2)['adupont'] == alice, 'identifiant « adupont » : désormais le profil de la tablette 1'
    # Un autre administrateur est désormais sur la tablette : Eric peut changer de profil
    t2.click(f'#tabletAgents [data-act=user-edit][data-id="{admin2}"]')
    t2.wait_for_selector('#uf')
    t2.select_option('#uf [name=role]', 'auditeur')
    t2.click('.modal [data-act=ok]')
    t2.wait_for_function("() => window.AuditApp.session.user.role === 'auditeur'")
    assert js(t2, "return store.get('user', session.user.id).role;") == 'auditeur'


def test_ajouter_un_agent_et_changer_d_agent_sur_telephone(page, app_url):
    # Configuration : mode autonome d'office ; le mode équipe GitHub n'est qu'une option avancée repliée
    open_setup(page, app_url)
    assert 'nécessite un jeton GitHub — non utilisé à l’OEG' in page.inner_text('#setupAdvanced > summary')
    assert not page.locator('[data-act=mode][data-value=team]').is_visible()
    assert not CREATE_TOKEN.search(page.inner_text('#app'))
    # Compte de l'administrateur : comme « Ajouter un agent » (nom, prénom, initiales et identifiant proposés)
    page.click('#setupFirst')
    page.fill('#app [name=lastName]', 'Dupont')
    page.fill('#app [name=firstName]', 'Alice')
    assert page.input_value('#app [name=initials]') == 'AD' and page.input_value('#app [name=username]') == 'adupont'
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    profile = js(page, "return store.get('user', session.user.id);")
    assert (profile['firstName'], profile['lastName'], profile['initials'], profile['role']) == ('Alice', 'Dupont', 'AD', 'admin'), profile
    goto_hash(page, '#/synchronisation')
    assert not CREATE_TOKEN.search(page.inner_text('#view')), 'aucun écran ne demande de créer un jeton'
    bruno = add_agent(page, 'Martin', 'Bruno', 'bmartin', initials='BMA')
    # Identifiant déjà pris : un autre identifiant est proposé
    goto_hash(page, '#/administration')
    page.click('#tabletAgents [data-act=user-new]')
    page.fill('#uf [name=lastName]', 'Martin')
    page.fill('#uf [name=firstName]', 'Benoît')
    assert page.input_value('#uf [name=username]') == 'bmartin2'
    page.click('.modal [data-act=__close]')

    # Tablette en portrait : libellé « Changer d'agent » visible
    page.set_viewport_size(TABLET_PORTRAIT)
    assert page.locator('.pill-switch .lbl').is_visible()
    # Téléphone : icône seule dans l'en-tête, entrée « Changer d'agent » du Menu
    page.set_viewport_size(PHONE)
    assert page.locator('.pill-switch').is_visible() and not page.locator('.pill-switch .lbl').is_visible()
    goto_hash(page, '#/menu')
    page.click('[data-act=switch-agent]')
    page.wait_for_selector('#loginBtn')
    assert 'Alice Dupont : session fermée' in page.inner_text('#loginMsg')
    tile = page.locator('.user-tile[data-u="bmartin"]')
    assert tile.locator('.avatar').inner_text() == 'BMA', 'initiales du profil'
    login(page, 'bmartin')
    assert js(page, 'return session.user.id;') == bruno
    assert page.evaluate('location.hash') in ('#/', ''), 'agent suivant : accueil (pas le Menu de l’agent précédent)'

    # Mon compte : mot de passe propre à cette tablette ; le nom de la tablette n'est modifiable que par un administrateur
    goto_hash(page, '#/compte')
    assert 'Changer mon mot de passe sur cette tablette' in page.inner_text('#view')
    assert page.locator('#view [data-act=rename]').count() == 0 and page.locator('#view [data-act=switch-agent]').count() == 1

    # Verrouillage par inactivité : le même agent reprend son écran ; un autre arrive sur l'accueil
    goto_hash(page, '#/planning')
    page.evaluate("window.AuditApp.lockApp('inactivité')")
    page.wait_for_selector('#loginBtn')
    assert 'Bruno Martin : session verrouillée après inactivité' in page.inner_text('#loginMsg')
    assert page.locator('.user-tile.sel').get_attribute('data-u') == 'bmartin', 'dernier agent présélectionné'
    login(page, 'bmartin')
    assert page.evaluate('location.hash') == '#/planning'
    page.evaluate("window.AuditApp.lockApp('inactivité')")
    page.wait_for_selector('#loginBtn')
    login(page, 'adupont', PASSWORD)
    assert page.evaluate('location.hash') in ('#/', ''), 'autre agent après inactivité : accueil'
