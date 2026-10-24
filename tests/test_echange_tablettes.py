"""Échange par fichier entre deux tablettes (mode autonome, celui de l'OEG : aucun serveur, aucun jeton, hors connexion).

Deux contextes de navigateur distincts = deux tablettes (stockage séparé). L'API Web Share est retirée (navigateur de
bureau) : « Envoyer à l'autre tablette » propose « Enregistrer le fichier », téléchargé puis choisi sur l'autre tablette.

  1. Tablette 1 (« Première tablette de l'équipe ») : administratrice Alice, deux agents ajoutés (Bruno, Chloé), tournée
     en binôme Alice + Bruno commencée et saisie (avec une photo) ; accueil « n modifications à envoyer à l'autre
     tablette » ; « Envoyer » → fichier « OEG-echange_Tablette-1_<date>.oegct » (chiffré).
     Tablette 2 (« Tablette supplémentaire ») : mauvais mot de passe d'échange refusé (rien n'est créé) ; aperçu ; n° 2
     proposé ; Bruno choisit SON profil (même identifiant, aucun profil en double), poursuit la tournée (saisie
     attribuée à Bruno), retrouve la saisie et la photo d'Alice ; tablette sans administrateur : Alice s'y ajoute
     elle-même ; Bruno termine, signe, renvoie.
     Tablette 1 : fichier chiffré avec un autre mot de passe d'échange → mot de passe demandé, mauvais mot de passe
     refusé sans rien modifier ; bon mot de passe (adopté) → tournée signée identique (empreinte scellée), saisies
     d'Alice et de Bruno présentes et attribuées, journal de la tablette 2 reçu et intègre ; double réception sans effet.
  2. Règle des profils : un changement de profil fait par l'administratrice mais envoyé par un agent non administrateur
     est mis en attente de validation sur l'autre tablette (Administration › « Changements de profils reçus à
     valider ») ; envoyé par un administrateur, il est appliqué. Envoi incrémental (« Rien de nouveau à envoyer »,
     « Tout envoyer ») ; ancien paquet de données JSON accepté par « Recevoir un fichier ».
"""
import json
import re

import pytest

from helpers import EXCHANGE_PASSWORD, PASSWORD, answer_required, create_tour, goto_hash, js, open_setup, response, setup_standalone
from test_tablette_partagee import PW, SAKOURA, add_agent, click_status, keyring, login, switch_agent

NO_SHARE = 'delete Navigator.prototype.share; delete Navigator.prototype.canShare;'
FILE_NAME = re.compile(r'^OEG-echange_Tablette-(\d)_\d{4}-\d\d-\d\d_\d\dh\d\d\.oegct$')
# Données comparées avant / après une double réception (hors éléments techniques et journal).
SNAPSHOT = """const out = {};
    for (const t of store.types()) {
      if (['trail', 'exchangeLog', 'conflict', 'localSecret', 'heldChange', 'syncLog'].includes(t)) continue;
      out[t] = store.all(t, { withDeleted: true }).map(({ _lv, _rev, ...e }) => e).sort((a, b) => a.id.localeCompare(b.id));
    }
    return JSON.stringify(out);"""


def tablet(make_page, label):
    """Une tablette = un contexte de navigateur (stockage séparé), sans API Web Share."""
    page = make_page(label=label)
    page.context.add_init_script(NO_SHARE)
    return page


def me(page):
    return js(page, 'return session.user.id;')


def pending(page):
    return page.evaluate("async () => (await import('./js/app/exchange.js')).pendingChanges()")


def send(page, tmp_path, *, button='#hmSend', where='#/', expect_nothing=False):
    """« Envoyer à l'autre tablette » puis « Enregistrer le fichier » : chemin du fichier téléchargé."""
    goto_hash(page, where)
    page.click(button)
    if expect_nothing:
        page.wait_for_selector('#xchNothing')
        return None
    page.wait_for_selector('#xchSave')
    assert page.locator('#xchShare').count() == 0, 'sans Web Share : enregistrement seulement'
    with page.expect_download() as d:
        page.click('#xchSave')
    dl = d.value
    path = tmp_path / dl.suggested_filename
    dl.save_as(path)
    page.wait_for_selector('#xchSave', state='detached')
    return path


def receive(page, path, *, password=None, adopt=False):
    """« Recevoir un fichier » (écran Échanges entre tablettes) : aperçu, réception, compte rendu (texte)."""
    goto_hash(page, '#/synchronisation')
    page.set_input_files('#xchReceive input', str(path))
    if password:
        page.wait_for_selector('#xaskPw')
        page.fill('#xaskPw', password)
        page.click('.modal [data-act=ok]')
    page.wait_for_selector('#xchConfirm')
    preview = page.inner_text('#xchPreview')
    if adopt:
        page.check('#xchAdopt')
    page.click('#xchConfirm')
    page.wait_for_selector('#xchReport')
    report = page.inner_text('.modal-body')
    page.click('#xchDone')
    page.wait_for_selector('#xchReport', state='detached')
    return preview, report


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_echange_entre_deux_tablettes(make_page, app_url, tmp_path):
    # ----- Tablette 1 : première tablette de l'équipe, deux agents, tournée en binôme commencée
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    alice = me(t1)
    bruno = add_agent(t1, 'Martin', 'Bruno', 'bmartin')
    chloe = add_agent(t1, 'Petit', 'Chloé', 'cpetit')
    tour = create_tour(t1, 'ce', [SAKOURA], 'prov-TL1', controllerIds=[bruno])
    goto_hash(t1, f'#/audit/{tour["id"]}/feuille-2')
    click_status(t1, 'it-F2-2.2', 'C')
    assert response(t1, tour['id'], 'it-F2-2.2')['by'] == alice
    photo = js(t1, """const { saveMedia } = await import('./js/core/media.js');
        const bytes = new Uint8Array(4096).map((_, i) => (i * 7) % 251);
        const m = await saveMedia(bytes, { mime: 'image/jpeg', kind: 'photo', name: 'flacons.jpg', auditId: arg, link: { type: 'audit', id: arg, itemId: 'it-F2-2.2' } });
        return { id: m.id, sha256: m.sha256 };""", tour['id'])

    # Accueil : « n modifications à envoyer à l'autre tablette », bouton bien visible ; en-tête « n à envoyer »
    goto_hash(t1, '#/')
    count = t1.inner_text('#hmXchCount')
    assert re.search(r'\d+ modifications à envoyer à l’autre tablette', count), count
    assert 'tournée' in t1.text_content('#hmXch') and t1.locator('#hmSend').is_visible()
    assert 'à envoyer' in t1.inner_text('#netLbl')
    f1 = send(t1, tmp_path)
    m = FILE_NAME.match(f1.name)
    assert m and m.group(1) == '1', f1.name
    text = f1.read_text(encoding='ascii')
    assert text.startswith('OEG-CT-ECHANGE 1\n') and 'Sakoura' not in text and 'Alice' not in text and 'adupont' not in text, 'fichier chiffré'
    assert pending(t1)['total'] == 0 and pending(t1)['media'] == 0, 'tout est envoyé'
    goto_hash(t1, '#/')
    assert 'tout est envoyé' in t1.text_content('#hmXch')
    goto_hash(t1, '#/synchronisation')
    assert 'Envoi' in t1.text_content('#xchHistory') and f1.name in t1.text_content('#xchHistory')

    # ----- Tablette 2 : « Tablette supplémentaire : recevoir le fichier de l'autre tablette »
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(f1))
    assert t2.inner_text('#extraFileName') == f1.name
    t2.fill('#extraOpenForm [name=exchangePassword]', 'pas-le-bon-mot-de-passe')
    t2.click('#extraOpen')
    t2.wait_for_function("() => document.querySelector('#extraErr').textContent.includes('Mot de passe d’échange incorrect')")
    assert t2.evaluate("async () => (await import('./js/core/auth.js')).isSetUp()") is False, 'rien n’est créé'
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    assert 'Tablette 1' in t2.text_content('#extraPreview') and 'Alice Dupont' in t2.text_content('#extraPreview')
    assert t2.locator('#extraPartial').count() == 0, 'premier envoi : toutes les données'
    assert t2.input_value('#extraForm [name=deviceName]') == 'Tablette 2' and t2.input_value('#extraForm [name=deviceNumber]') == '2'
    tiles = t2.locator('#extraForm .user-tile b').all_inner_texts()
    assert tiles == ['Alice Dupont', 'Bruno Martin', 'Chloé Petit'], 'agents reçus, administrateurs d’abord'
    t2.click('#extraForm [data-act=extra-pick][data-u=bmartin]')
    t2.fill('#extraForm [name=password]', PW['bmartin'])
    t2.fill('#extraForm [name=password2]', PW['bmartin'])
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    t2.wait_for_selector('#view .hm-hero')
    assert js(t2, 'return session.user;') == {'id': bruno, 'username': 'bmartin', 'name': 'Bruno Martin', 'role': 'auditeur'}, 'MÊME profil'
    assert keyring(t2) == {'bmartin': bruno}
    assert sorted(js(t2, "return store.all('user').map(u => u.id);")) == sorted([alice, bruno, chloe]), 'aucun profil en double'
    assert js(t2, 'return session.device;')['number'] == 2
    assert js(t2, "return (await import('./js/app/exchange.js')).exchangePasswordInfo() !== null;"), 'mot de passe d’échange enregistré'
    assert pending(t2)['total'] == 0, 'données reçues : rien à renvoyer'

    # Bruno poursuit la tournée : saisie d'Alice et photo présentes, saisie de Bruno attribuée à Bruno
    card = t2.locator(f'.hm-tour[data-tour="{tour["id"]}"]')
    assert 'Reprendre' in card.inner_text() and 'commencée sur Tablette 1' in card.inner_text()
    goto_hash(t2, f'#/audit/{tour["id"]}/feuille-2')
    assert response(t2, tour['id'], 'it-F2-2.2')['by'] == alice
    click_status(t2, 'it-F2-2.3', 'C')
    r = response(t2, tour['id'], 'it-F2-2.3')
    assert r['by'] == bruno and r['byName'] == 'Bruno Martin'
    assert js(t2, "const { verifyMedia } = await import('./js/core/media.js'); return (await verifyMedia(arg)).ok;", photo['id']) is True, 'photo reçue, empreinte conforme'

    # Tablette sans administrateur : Alice s'y ajoute elle-même (mot de passe qu'elle saisit)
    goto_hash(t2, '#/administration')
    assert 'Aucun administrateur sur cette tablette' in t2.text_content('#noAdmin')
    t2.click(f'#noAdmin [data-act=agent-enroll][data-id="{alice}"]')
    t2.wait_for_selector('#ef')
    t2.fill('#ef [name=p1]', PW['adupont'])
    t2.fill('#ef [name=p2]', PW['adupont'])
    t2.click('.modal [data-act=ok]')
    t2.wait_for_selector('#noAdmin', state='detached')
    assert keyring(t2) == {'bmartin': bruno, 'adupont': alice}

    # Bruno termine et signe (contrôleur + refus motivé du prestataire), la tournée est verrouillée, il renvoie
    assert answer_required(t2, tour['id']) > 10
    sealed = js(t2, """let a = store.get('audit', arg);
        await A.finishAudit(a);
        await A.signAudit(store.get('audit', arg), 'auditor', { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), mime: 'image/png', name: session.user.name, fn: 'Contrôleur OEG' });
        await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant TL1', refused: true, comment: 'Absent au moment de la signature' });
        a = await A.lockAudit(store.get('audit', arg));
        const v = await A.verifyAuditSeal(store.get('audit', arg));
        return { hash: a.lock.contentHash, ok: v.ok, current: v.current, auditor: a.signatures.auditor.userId };""", tour['id'])
    assert sealed['ok'] and sealed['auditor'] == bruno, sealed
    t2_device = js(t2, 'return session.device.id;')
    assert pending(t2)['total'] > 0
    f2 = send(t2, tmp_path, button='#xchSend', where='#/synchronisation')
    assert FILE_NAME.match(f2.name).group(1) == '2'

    # ----- Tablette 1 : fichier chiffré avec un autre mot de passe d'échange que le sien
    js(t1, "await (await import('./js/app/exchange.js')).setExchangePassword('autre-mot-de-passe-t1');")
    before = js(t1, SNAPSHOT)
    trail_before = js(t1, "return store.all('trail').length;")
    goto_hash(t1, '#/synchronisation')
    t1.set_input_files('#xchReceive input', str(f2))
    t1.wait_for_selector('#xaskPw')
    assert 'autre mot de passe d’échange' in t1.inner_text('.modal-body')
    t1.fill('#xaskPw', 'toujours-pas-le-bon')
    t1.click('.modal [data-act=ok]')
    t1.wait_for_function("() => document.querySelector('.modal-body')?.textContent.includes('Mot de passe incorrect pour ce fichier')")
    t1.click('.modal [data-act=cancel]')
    t1.wait_for_selector('#xaskPw', state='detached')
    assert js(t1, SNAPSHOT) == before and js(t1, "return store.all('trail').length;") == trail_before, 'rien n’est modifié'
    assert js(t1, "return !!store.get('audit', arg).lock;", tour['id']) is False
    # Bon mot de passe (celui de l'équipe), adopté pour cette tablette
    preview, report = receive(t1, f2, password=EXCHANGE_PASSWORD, adopt=True)
    assert 'Tablette 2' in preview and 'Bruno Martin' in preview and tour['number'] in preview and 'signée' in preview, preview
    assert 'tournée mise à jour' in report and tour['number'] in report, report
    a1 = js(t1, """const a = store.get('audit', arg); const v = await A.verifyAuditSeal(a);
        return { hash: a.lock?.contentHash, ok: v.ok, current: v.current, status: a.status, auditor: a.signatures?.auditor?.userId };""", tour['id'])
    assert a1 == {'hash': sealed['hash'], 'ok': True, 'current': sealed['current'], 'status': 'signe', 'auditor': bruno}, 'tournée signée identique : même empreinte, scellé valide'
    assert response(t1, tour['id'], 'it-F2-2.2')['by'] == alice and response(t1, tour['id'], 'it-F2-2.3')['by'] == bruno
    trail = js(t1, """const { verifyTrail } = await import('./js/core/store.js');
        const all = store.all('trail'); const r = await verifyTrail(all);
        return { ok: r.ok, fromT2: all.filter(t => t.deviceId === arg).length, sign: all.some(t => t.deviceId === arg && t.action === 'lock') };""", t2_device)
    assert trail['ok'] and trail['fromT2'] > 5 and trail['sign'], trail
    assert js(t1, "const X = await import('./js/app/exchange.js'); return X.exchangePasswordInfo() && (await X.readExchange(arg)).body.id;", f2.read_text()) , 'mot de passe adopté'
    assert pending(t1)['total'] == 0, 'rien à renvoyer : la tablette 2 a déjà cette version'
    goto_hash(t1, '#/synchronisation')
    hist = t1.text_content('#xchHistory')
    assert 'Réception' in hist and 'Tablette 2' in hist and 'Bruno Martin' in hist, hist
    goto_hash(t1, '#/journal')
    assert 'Réception d’un fichier de l’autre tablette' in t1.inner_text('#view') and 'Envoi à l’autre tablette' in t1.inner_text('#view')

    # Double réception : sans effet
    before = js(t1, SNAPSHOT)
    preview, report = receive(t1, f2)
    assert 'déjà été reçu' in preview, preview
    assert 'aucun changement' in report, report
    assert js(t1, SNAPSHOT) == before, 'recevoir deux fois le même fichier ne change rien'
    assert js(t1, "return store.all('conflict').length;") == 0
    # Fichier venant de cette tablette : refusé
    goto_hash(t1, '#/synchronisation')
    t1.set_input_files('#xchReceive input', str(f1))
    t1.wait_for_selector('#xchMsg')
    assert 'envoyé par cette tablette' in t1.inner_text('#xchMsg')
    t1.click('.modal .btn.primary')


@pytest.mark.lent
def test_regle_des_profils_et_envoi_incremental(make_page, app_url, tmp_path):
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    alice = me(t1)
    bruno = add_agent(t1, 'Martin', 'Bruno', 'bmartin')
    f1 = send(t1, tmp_path)
    # Envoi incrémental : rien de nouveau, puis « Tout envoyer »
    send(t1, tmp_path, button='#xchSend', where='#/synchronisation', expect_nothing=True)
    t1.click('.modal [data-act=all]')
    t1.wait_for_selector('#xchSave')
    assert 'tout (« Tout envoyer »)' in t1.inner_text('.modal-body')
    t1.click('.modal [data-act=__close]')

    # Tablette 2 mise en service par Alice (administratrice)
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(f1))
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    t2.click('#extraForm [data-act=extra-pick][data-u=adupont]')
    t2.fill('#extraForm [name=password]', PW['adupont'])
    t2.fill('#extraForm [name=password2]', PW['adupont'])
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    t2.wait_for_selector('#teamAgents')
    assert t2.evaluate('location.hash') == '#/administration', 'administratrice : ajouter les agents'
    assert js(t2, 'return session.user.id;') == alice and 'Bruno Martin' in t2.text_content('#teamAgents')

    # Tablette 1 : l'administratrice passe Bruno « Superviseur », mais c'est Bruno (auditeur) qui envoie
    goto_hash(t1, '#/administration')
    t1.click(f'#tabletAgents [data-act=user-edit][data-id="{bruno}"]')
    t1.wait_for_selector('#uf')
    t1.select_option('#uf [name=role]', 'superviseur')
    t1.click('.modal [data-act=ok]')
    t1.wait_for_function("(id) => window.AuditApp.store.get('user', id).role === 'superviseur'", arg=bruno)
    switch_agent(t1)
    assert 'pas encore envoyée' in t1.inner_text('#loginMsg'), 'rappel non bloquant avant « Changer d’agent »'
    login(t1, 'bmartin')
    f3 = send(t1, tmp_path)
    _, report = receive(t2, f3)
    assert 'changement de profil en attente de validation' in report, report
    assert 'Profil : Auditeur → Superviseur' in report, report
    assert js(t2, "return store.get('user', arg).role;", bruno) == 'auditeur', 'rôle inchangé tant que l’administrateur n’a pas validé'
    goto_hash(t2, '#/administration')
    held = t2.text_content('#heldChanges')
    assert 'Bruno Martin' in held and 'envoyé par Bruno Martin' in held, held
    t2.click('#heldChanges [data-act=held-accept]')
    t2.wait_for_selector('#heldChanges', state='detached')
    assert js(t2, "return store.get('user', arg).role;", bruno) == 'superviseur'

    # Envoyé par l'administratrice : appliqué d'office
    switch_agent(t1)
    login(t1, 'adupont', PASSWORD)
    goto_hash(t1, '#/administration')
    t1.click(f'#tabletAgents [data-act=user-edit][data-id="{bruno}"]')
    t1.wait_for_selector('#uf')
    t1.select_option('#uf [name=role]', 'auditeur')
    t1.click('.modal [data-act=ok]')
    t1.wait_for_function("(id) => window.AuditApp.store.get('user', id).role === 'auditeur'", arg=bruno)
    f4 = send(t1, tmp_path)
    _, report = receive(t2, f4)
    assert 'en attente' not in report, report
    assert js(t2, "return store.get('user', arg).role;", bruno) == 'auditeur'

    # Ancien paquet de données JSON (non chiffré) : accepté par « Recevoir un fichier »
    tour = create_tour(t1, 'ce', [SAKOURA], 'prov-TL1')
    pkg = js(t1, """const { buildPackage } = await import('./js/app/exports.js');
        return JSON.stringify(await buildPackage({ includeMedia: false }));""")
    legacy = tmp_path / 'donnees_audit.json'
    legacy.write_text(pkg, encoding='utf-8')
    preview, report = receive(t2, legacy)
    assert 'ancien paquet de données' in preview, preview
    assert 'nouvelle tournée' in report and tour['number'] in report, report
    assert js(t2, "return store.get('audit', arg)?.number;", tour['id']) == tour['number']
    assert json.loads(pkg)['format'] == 'oeg-audit-package-v1'
