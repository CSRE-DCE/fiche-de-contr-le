"""Synchronisation d'équipe par un dépôt GitHub privé (SPEC § 8), de bout en bout, sans réseau.

Un faux serveur de l'API GitHub (tests/fake_github.py, empreintes git exactes, refus « non fast-forward »)
remplace api.github.com ; deux appareils = deux contextes de navigateur (stockages IndexedDB séparés).
Scénarios : initialisation d'un dépôt vide puis création → synchronisation → réception ; modifications
concurrentes ⇒ fusion (et conflit tracé sur un même champ) ; révocation d'un appareil ⇒ effacement ;
numéros d'audit sans doublon (réservation concurrente) ; rattachement / détachement d'un appareil autonome ;
erreurs claires (jeton refusé, dépôt public) ; mode autonome inchangé.

Fixtures : utilise `app_url` et `browser` de tests/conftest.py s'ils existent, sinon les crée ici.
"""
import functools
import http.server
import pathlib
import re
import sys
import threading
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fake_github import FakeGitHub  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PASSWORD = 'motdepasse-test'
YEAR = time.localtime().tm_year
# Réponses HTTP attendues (jeton refusé 401, limite de débit 403, introuvable 404, dépôt vide 409, refus « non
# fast-forward » 422, tuiles de carte bloquées) :
# le navigateur les journalise comme erreurs de console, elles ne sont pas des défauts de l'application.
EXPECTED_CONSOLE = re.compile(r'Failed to load resource: (the server responded with a status of (401|403|404|409|422)|net::ERR_FAILED)')


# ---------- fixtures (repli si tests/conftest.py ne les fournit pas) ----------

class _StaticHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


@pytest.fixture(scope='session')
def gh_app_url(request):
    try:
        url = request.getfixturevalue('app_url')
    except pytest.FixtureLookupError:
        url = None
    if url:
        url = str(url)
        yield (url.rsplit('/', 1)[0] if url.endswith('.html') else url.rstrip('/')) + '/'
        return
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(_StaticHandler, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{httpd.server_address[1]}/'
    httpd.shutdown()


@pytest.fixture(scope='session')
def gh_browser(request):
    try:
        b = request.getfixturevalue('browser')
    except pytest.FixtureLookupError:
        b = None
    if b is not None:
        yield b
        return
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    b = pw.chromium.launch()
    yield b
    b.close()
    pw.stop()


@pytest.fixture
def fake():
    f = FakeGitHub(tokens={'tok-admin': 'oeg-admin', 'tok-audit': 'oeg-auditrice', 'tok-sup': 'oeg-superviseur'},
                   repos=['oeg/donnees']).start()
    f.add_repo('oeg/public-donnees', private=False)
    yield f
    f.stop()


@pytest.fixture
def devices(gh_browser, gh_app_url):
    """Fabrique d'appareils (un contexte de navigateur chacun), fermés en fin de test."""
    made = []

    def make(label='A'):
        ctx = gh_browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
        ctx.route(re.compile(r'^https?://([a-z0-9-]+\.)*(openstreetmap\.org|arcgisonline\.com|opentopomap\.org)/'), lambda r: r.abort())
        page = ctx.new_page()
        page.label, page.errors = label, []
        page.on('console', lambda m: page.errors.append(m.text) if m.type == 'error' and not EXPECTED_CONSOLE.search(m.text) else None)
        page.on('pageerror', lambda e: page.errors.append(f'pageerror: {e}'))
        page.goto(gh_app_url + 'index.html')
        page.wait_for_selector('#setupFirst')     # mise en service : deux choix (le mode équipe est une option avancée)
        made.append((ctx, page))
        return page
    yield make
    for ctx, page in made:
        ctx.close()
    for ctx, page in made:
        assert not page.errors, f'erreurs de console sur l’appareil {page.label} : {page.errors[:5]}'


# ---------- aides ----------

def join_team(page, fake, token, name, username, *, repo='oeg/donnees', device=None, expect_init=None):
    """« Rejoindre une équipe » depuis l'écran de première configuration, jusqu'à l'application ouverte et synchronisée."""
    page.click('#setupAdvanced > summary')     # option avancée repliée (mode équipe : non utilisé à l'OEG)
    page.click('[data-act=mode][data-value=team]')
    page.fill('[name=repoSpec]', repo)
    page.fill('[name=token]', token)
    page.click('details:has([name=apiUrl]) > summary')
    page.fill('[name=apiUrl]', fake.url)
    page.click('#teamCheck')
    page.wait_for_selector('#teamProbe .banner')
    probe = page.inner_text('#teamProbe')
    if expect_init is not None:
        assert ('va l’initialiser' in probe) == expect_init, probe
    page.fill('[name=deviceName]', device or f'Tablette {name}')
    page.fill('[name=name]', name)
    page.fill('[name=username]', username)
    page.fill('[name=password]', PASSWORD)
    page.fill('[name=password2]', PASSWORD)
    page.click('#teamBtn')
    page.wait_for_selector('#view', timeout=60000)
    sync(page)   # attend la fin de la synchronisation d'ouverture de session
    quiet(page)
    return probe


def quiet(page):
    """Arrête les synchronisations automatiques (déterminisme : les tests synchronisent explicitement)."""
    page.evaluate("() => import('./js/app/sync.js').then(m => m.stopSync())")


def setup_standalone(page, device_no=7):
    page.click('#setupFirst')                     # « Première tablette de l'équipe »
    for k, v in dict(deviceName='Tablette autonome', deviceNumber=str(device_no), lastName='Autonome', firstName='Admin', username='admin', password=PASSWORD, password2=PASSWORD,
                     exchangePassword='echange-equipe-test', exchangePassword2='echange-equipe-test').items():
        page.fill(f'[name={k}]', v)
    page.click('#setupBtn')
    page.wait_for_selector('#view', timeout=60000)


def sync(page, *, ok=True):
    r = page.evaluate("() => import('./js/app/sync.js').then(m => m.runSync({ reason: 'test' }))")
    if ok:
        assert not r.get('errors'), r.get('errors')
        assert not r.get('skipped'), r.get('skipped')
    return r


def js(page, body, arg=None):
    """Exécute une fonction asynchrone dans la page avec les modules de l'application : (A, S, store, session, arg) => …"""
    return page.evaluate(f"""async (arg) => {{
        const A = await import('./js/app/audits.js'); const S = await import('./js/app/sync.js');
        const store = window.AuditApp.store, session = window.AuditApp.session;
        {body}
    }}""", arg)


def create_audit(page):
    return js(page, """const a = await A.createAudit({ auditType: 'bio', stations: [{ siteId: 'site-09271503', prestationId: 'pres-BIO-2026-09271503' }], providerId: 'prov-HYDRECO' });
        return { id: a.id, number: a.number, source: a.numberSource };""")


def set_response(page, audit_id, item, patch):
    js(page, "await A.setResponse(store.get('audit', arg.id), arg.item, arg.patch);", {'id': audit_id, 'item': item, 'patch': patch})


def response(page, audit_id, item):
    return page.evaluate("([id, item]) => (window.AuditApp.store.get('audit', id)?.responses || {})[item] || null", [audit_id, item])


def team_of_two(devices, fake, *, b_token='tok-audit'):
    a = devices('A')
    join_team(a, fake, 'tok-admin', 'Alice Admin', 'alice', expect_init=True)
    b = devices('B')
    join_team(b, fake, b_token, 'Bruno Terrain', 'bruno', expect_init=False)
    sync(a)
    return a, b


# ---------- scénarios ----------

def test_creation_synchro_reception(devices, fake):
    a = devices('A')
    join_team(a, fake, 'tok-admin', 'Alice Admin', 'alice', expect_init=True)
    # Dépôt initialisé : configuration, référentiel, journal ; appareil enregistré ; bloc de numéros réservé
    assert fake.read_json('donnees/config/equipe.json')['format'] == 'oeg-ct-donnees-v1'
    users = fake.read_json('donnees/config/utilisateurs.json')['users']
    assert [(u['login'], u['role'], u['active']) for u in users] == [('oeg-admin', 'admin', True)]
    devs = fake.read_json('donnees/config/appareils.json')['devices']
    assert [(d['no'], d['name'], d['revoked']) for d in devs] == [(1, 'Tablette Alice Admin', False)]
    assert fake.read_json('donnees/config/sequences.json') == {f'AUD-{YEAR}': 25}
    assert fake.read_json('donnees/entites/site/site-09271503.json')['name'].upper() == 'ATHANASE'
    assert fake.read('donnees/entites/grid/grid-ct-2026-v1.json')
    assert fake.list('donnees/journal/'), 'journal d’audit envoyé'
    assert all(not p.startswith('donnees/entites/localSecret') and not p.startswith('donnees/entites/syncBase') for p in fake.list()), 'aucune donnée locale (jeton…) dans le dépôt'
    tok = fake.list('donnees/')
    assert not any(b'tok-admin' in fake.read(p) for p in tok), 'le jeton n’est jamais écrit dans le dépôt'

    # Création d'une tournée sur A → synchronisation → fichier de l'audit dans le dépôt
    audit = create_audit(a)
    assert audit['number'] == f'AUD-{YEAR}-000001' and audit['source'] == 'bloc réservé (équipe)'
    set_response(a, audit['id'], 'it-F2-2.2', {'status': 'C', 'value': 4})
    r = sync(a)
    assert r['pushed'] >= 1 and r['commit']
    saved = fake.read_json(f"donnees/entites/audit/{audit['id']}.json")
    assert saved['number'] == audit['number'] and saved['responses']['it-F2-2.2']['value'] == 4
    assert '_rev' not in saved and '_lv' not in saved
    last = fake.history()[0]
    assert last['message'].startswith('Synchronisation : ') and 'Tablette Alice Admin' in last['message']

    # Second appareil : reçoit tout le référentiel et la tournée
    b = devices('B')
    probe = join_team(b, fake, 'tok-audit', 'Bruno Terrain', 'bruno', expect_init=False)
    assert 'profil Auditeur par défaut' in probe
    assert b.evaluate("window.AuditApp.store.count('site')") == a.evaluate("window.AuditApp.store.count('site')") > 100
    assert response(b, audit['id'], 'it-F2-2.2')['value'] == 4
    assert b.evaluate(f"window.AuditApp.store.get('audit', '{audit['id']}').number") == audit['number']
    assert b.evaluate("window.AuditApp.session.user.role") == 'auditeur'
    assert b.evaluate("window.AuditApp.session.device.number") == 2
    assert b.evaluate("window.AuditApp.store.count('trail')") > 10, 'journal des autres appareils reçu'
    # A reçoit à son tour ce que B a envoyé (profil de B, enregistrement de l'appareil)
    sync(a)
    assert [d['no'] for d in fake.read_json('donnees/config/appareils.json')['devices']] == [1, 2]
    b_user = b.evaluate("window.AuditApp.session.user.id")
    assert a.evaluate(f"window.AuditApp.store.get('user', '{b_user}')?.name") == 'Bruno Terrain'
    # Réception différentielle : sans changement, une synchronisation ne relit qu'une référence
    before = fake.stats['requests']
    r = sync(b)
    assert r['pulled'] == 0 and r['pushed'] == 0 and fake.stats['requests'] - before <= 3
    # Écran Synchronisation : état et test de connexion
    b.evaluate("location.hash = '#/synchronisation'")
    b.wait_for_selector('text=oeg/donnees')
    b.click('[data-act=test]')
    b.wait_for_selector('#testResult .banner')
    assert 'enregistré dans l’équipe sous le n° 2' in b.inner_text('#testResult')
    # Photo (binaire) : octets bruts dans medias/<id>, téléchargés à la demande par l'autre appareil
    data = list(range(256)) * 3
    media_id = a.evaluate("""async (data) => { const M = await import('./js/core/media.js');
        const m = await M.saveMedia(new Uint8Array(data), { mime: 'image/jpeg', kind: 'photo', name: 'berge.jpg' }); return m.id; }""", data)
    r = sync(a)
    assert r['media'] == 1
    assert list(fake.read(f'donnees/medias/{media_id}')) == data
    assert fake.stats['blobs_created'] >= 1
    sync(b)
    got = b.evaluate("""async (id) => { const M = await import('./js/core/media.js'); return Array.from(await M.mediaBytes(id) || []); }""", media_id)
    assert got == data
    assert b.evaluate(f"() => import('./js/core/media.js').then(m => m.verifyMedia('{media_id}')).then(v => v.ok)")
    # Réception complète : tout est relu, rien ne diffère
    r = b.evaluate("() => import('./js/app/sync.js').then(m => m.runSync({ reason: 'test', full: true }))")
    assert not r['errors'] and r['pulled'] == 0 and r['conflicts'] == 0
    # Jeton expiré : erreur claire, puis renouvellement depuis l'écran Synchronisation
    del fake.tokens['tok-audit']
    fake.tokens['tok-audit-2'] = {'login': 'oeg-auditrice', 'id': 1001, 'name': 'Oeg Auditrice'}
    r = sync(b, ok=False)
    assert any('Jeton GitHub refusé' in e for e in r['errors'])
    assert b.evaluate("() => import('./js/app/sync.js').then(m => m.syncState.needsLogin)")
    b.evaluate("() => import('./js/ui/router.js').then(m => m.refresh())")   # écran Synchronisation déjà affiché
    b.wait_for_selector('button.warn[data-act=token]')
    b.click('[data-act=token]')
    b.fill('#tf [name=token]', 'tok-audit-2')
    b.click('.modal [data-act=ok]')
    b.wait_for_selector('text=Jeton enregistré (@oeg-auditrice)')
    assert sync(b)['errors'] == []
    assert b.evaluate("window.AuditApp.store.get('localSecret', 'github:token').token") == 'tok-audit-2'


def test_modification_concurrente_fusion(devices, fake):
    a = devices('A')
    join_team(a, fake, 'tok-admin', 'Alice Admin', 'alice', expect_init=True)
    # L'administrateur déclare le superviseur dans l'équipe (Administration › Membres)
    a.evaluate("location.hash = '#/administration'")
    a.click('[data-act=team-user-new]')
    a.fill('#tuf [name=login]', 'oeg-superviseur')
    a.fill('#tuf [name=name]', 'Sam Superviseur')
    a.select_option('#tuf [name=role]', 'superviseur')
    a.click('.modal [data-act=ok]')
    a.wait_for_selector('text=@oeg-superviseur')
    assert any(u['login'] == 'oeg-superviseur' and u['role'] == 'superviseur' for u in fake.read_json('donnees/config/utilisateurs.json')['users'])
    b = devices('B')
    probe = join_team(b, fake, 'tok-sup', 'Sam Superviseur', 'sam', expect_init=False)
    assert 'profil Superviseur' in probe
    assert b.evaluate("window.AuditApp.session.user.role") == 'superviseur'

    audit = create_audit(a)
    sync(a)
    sync(b)
    # Modifications concurrentes de champs différents : fusion sans conflit
    set_response(a, audit['id'], 'it-F2-2.3', {'status': 'C', 'value': 1})
    set_response(b, audit['id'], 'it-F2-2.4', {'status': 'NC', 'value': 2, 'comment': 'Effectif insuffisant'})
    sync(a)
    r = sync(b)
    assert r['merged'] >= 1 and r['conflicts'] == 0
    sync(a)
    for page in (a, b):
        assert response(page, audit['id'], 'it-F2-2.3')['value'] == 1
        assert response(page, audit['id'], 'it-F2-2.4')['comment'] == 'Effectif insuffisant'
    assert b.evaluate("window.AuditApp.store.count('conflict')") == 0
    # Même champ modifié des deux côtés : la valeur la plus récente est retenue, l'autre conservée dans un conflit
    set_response(a, audit['id'], 'it-F2-2.5', {'status': 'C', 'comment': 'version A'})
    b.wait_for_timeout(30)
    set_response(b, audit['id'], 'it-F2-2.5', {'status': 'P', 'comment': 'version B'})
    sync(a)
    r = sync(b)
    assert r['conflicts'] == 1
    sync(a)
    for page in (a, b):
        assert response(page, audit['id'], 'it-F2-2.5')['comment'] == 'version B'
    conflict = b.evaluate("window.AuditApp.store.all('conflict')[0]")
    assert conflict['entityType'] == 'audit' and not conflict['resolved']
    assert any(d['path'] == 'responses.it-F2-2.5.comment' and d['localValue'] == 'version B' and d['remoteValue'] == 'version A' for d in conflict['details'])
    # Le dépôt contient la version fusionnée ; historique linéaire (jamais de forçage)
    saved = fake.read_json(f"donnees/entites/audit/{audit['id']}.json")
    assert saved['responses']['it-F2-2.3']['value'] == 1 and saved['responses']['it-F2-2.5']['comment'] == 'version B'
    hist = fake.history()
    assert all(len(c['parents']) <= 1 for c in hist)
    # L'écran Synchronisation présente le conflit à examiner
    b.evaluate("location.hash = '#/synchronisation'")
    b.wait_for_selector('text=Conflits (1 à examiner)')


def test_revocation_efface_appareil(devices, fake):
    a, b = team_of_two(devices, fake)
    b_device = b.evaluate("window.AuditApp.session.device.id")
    # B saisit une donnée qui ne sera jamais envoyée : l'appareil est révoqué avant
    audit = create_audit(b)
    # Révocation par l'administrateur (Administration › Appareils de l'équipe)
    a.evaluate("location.hash = '#/administration'")
    a.click(f'[data-act=dev-revoke][data-id="{b_device}"]')
    a.fill('#__prompt', 'Tablette perdue sur le terrain')
    a.click('.modal [data-act=ok]')
    a.wait_for_selector('text=Révoqué le')
    dev = next(d for d in fake.read_json('donnees/config/appareils.json')['devices'] if d['id'] == b_device)
    assert dev['revoked'] and dev['revokedBy'] == 'oeg-admin' and dev['revokeReason'] == 'Tablette perdue sur le terrain'
    # Synchronisation suivante de B : effacement complet des données locales
    r = sync(b, ok=False)
    assert r.get('revoked') is True
    b.wait_for_selector('text=Appareil désactivé')
    names = b.evaluate("indexedDB.databases ? indexedDB.databases().then(l => l.map(d => d.name)) : []")
    assert 'oeg-controle-terrain' not in names
    assert not fake.read(f"donnees/entites/audit/{audit['id']}.json"), 'rien n’est envoyé par un appareil révoqué'
    # Rechargement : appareil vierge (première configuration)
    b.reload()
    b.wait_for_selector('#setupFirst')


def test_numeros_sans_doublon(devices, fake):
    a, b = team_of_two(devices, fake)
    seq = fake.read_json('donnees/config/sequences.json')[f'AUD-{YEAR}']
    assert seq == 50, 'un bloc de 25 numéros par appareil'
    numbers = [create_audit(a)['number'] for _ in range(3)] + [create_audit(b)['number'] for _ in range(3)]
    assert numbers[:3] == [f'AUD-{YEAR}-{n:06d}' for n in (1, 2, 3)]
    assert numbers[3:] == [f'AUD-{YEAR}-{n:06d}' for n in (26, 27, 28)]
    # Bloc de B épuisé hors connexion : plage de secours propre à l'appareil (n° 2)
    b.evaluate("() => import('./js/core/db.js').then(m => m.meta.set('numBlocks', {}))")
    fallback = create_audit(b)
    assert fallback['number'] == f'AUD-{YEAR}-902001' and fallback['source'] == 'plage de secours appareil'
    numbers.append(fallback['number'])

    # Réservation concurrente : un troisième appareil réserve 51–75 pendant l'écriture de B ⇒ B relit et réserve 76–100
    def third_device(branch):
        cur = fake.read_json('donnees/config/sequences.json')
        fake.commit_files({'donnees/config/sequences.json': {**cur, f'AUD-{YEAR}': cur[f'AUD-{YEAR}'] + 25}}, 'Synchronisation : réservation (autre appareil)')
    fake.before_ref_update = third_device
    non_ff = fake.stats['non_ff']
    r = sync(b)
    assert fake.stats['non_ff'] == non_ff + 1 and r['attempts'] == 2
    assert fake.read_json('donnees/config/sequences.json')[f'AUD-{YEAR}'] == 100
    nxt = create_audit(b)
    assert nxt['number'] == f'AUD-{YEAR}-000076', 'nouveau bloc, après celui de l’autre appareil'
    blocks = b.evaluate("() => import('./js/app/numbering.js').then(m => m.reservedBlocks())")
    assert [(x['from'], x['next'], x['to']) for x in blocks] == [(76, 77, 100)]
    numbers.append(nxt['number'])
    # Tout le monde reçoit tout : aucun numéro en double dans l'équipe
    sync(a)
    sync(b)
    sync(a)
    all_a = a.evaluate("window.AuditApp.store.all('audit').map(x => x.number)")
    all_b = b.evaluate("window.AuditApp.store.all('audit').map(x => x.number)")
    assert sorted(all_a) == sorted(all_b) == sorted(numbers)
    assert len(set(all_a)) == len(all_a) == 8


def test_rattachement_et_detachement(devices, fake):
    a = devices('A')
    join_team(a, fake, 'tok-admin', 'Alice Admin', 'alice', expect_init=True)
    # Appareil autonome avec ses propres saisies, rattaché ensuite à l'équipe
    c = devices('C')
    setup_standalone(c, device_no=7)
    local = create_audit(c)
    assert local['number'] == f'AUD-{YEAR}-070001'
    c.evaluate("location.hash = '#/synchronisation'")
    c.click('#teamAdvanced > summary')     # option avancée repliée (mode équipe : non utilisé à l'OEG)
    c.click('[data-act=attach]')
    c.fill('#af [name=repoSpec]', 'oeg/donnees')
    c.fill('#af [name=token]', 'tok-audit')
    c.click('#af details:has([name=apiUrl]) > summary')
    c.fill('#af [name=apiUrl]', fake.url)
    c.click('.modal [data-act=check]')
    c.wait_for_selector('#afProbe .banner')
    c.click('.modal [data-act=ok]')
    c.wait_for_selector('text=Équipe — dépôt GitHub oeg/donnees', timeout=60000)
    quiet(c)
    att = c.evaluate("window.AuditApp.store.all('syncLog').find(l => l.reason === 'rattachement à l’équipe')")
    assert att and not att['errors'] and att['conflicts'] == 0, (att, c.evaluate("window.AuditApp.store.all('conflict').map(x => [x.entityType, x.entityId, JSON.stringify(x.details).slice(0, 600)])"))
    assert att['pushed'] > 0, 'données propres à l’appareil envoyées (démonstration, audit, compte)'
    r = sync(c)
    assert r['pushed'] == 0 and r['pulled'] == 0
    assert c.evaluate("window.AuditApp.session.mode") == 'github'
    assert fake.read_json(f"donnees/entites/audit/{local['id']}.json")['number'] == local['number']
    assert c.evaluate("window.AuditApp.store.count('conflict')") == 0
    # Le profil local (administrateur de l'appareil) est conservé : login absent de l'équipe
    assert c.evaluate("window.AuditApp.session.user.role") == 'admin'
    sync(a)
    assert a.evaluate(f"!!window.AuditApp.store.get('audit', '{local['id']}')")
    # Détachement : retour au mode autonome, jeton effacé, données conservées
    c.evaluate("location.hash = '#/synchronisation'")
    c.click('[data-act=detach]')
    c.fill('#__prompt', 'Fin de mission')
    c.click('.modal [data-act=ok]')
    c.wait_for_selector('#xchCard')            # écran « Échanges entre tablettes » du mode autonome
    assert 'Mode autonome' in c.inner_text('#view')
    assert c.evaluate("window.AuditApp.session.mode") == 'standalone'
    assert c.evaluate("window.AuditApp.store.get('localSecret', 'github:token')") is None
    assert sync(c, ok=False).get('skipped') == 'mode autonome'
    assert c.evaluate(f"!!window.AuditApp.store.get('audit', '{local['id']}')")


def test_erreurs_claires(devices, fake):
    p = devices('X')
    p.click('#setupAdvanced > summary')
    p.click('[data-act=mode][data-value=team]')
    p.fill('[name=repoSpec]', 'oeg/donnees')
    p.fill('[name=token]', 'jeton-invalide')
    p.click('details:has([name=apiUrl]) > summary')
    p.fill('[name=apiUrl]', fake.url)
    p.click('#teamCheck')
    p.wait_for_selector('#teamProbe .banner.nc:has-text("Jeton GitHub refusé")')
    p.fill('[name=token]', 'tok-admin')
    p.fill('[name=repoSpec]', 'oeg/inexistant')
    p.click('#teamCheck')
    p.wait_for_selector('#teamProbe .banner.nc:has-text("introuvable")')
    p.fill('[name=repoSpec]', 'oeg/public-donnees')
    p.click('#teamCheck')
    p.wait_for_selector('#teamProbe .banner.nc:has-text("PUBLIC")')
    for k, v in dict(name='Xavier', username='xavier', password=PASSWORD, password2=PASSWORD).items():
        p.fill(f'[name={k}]', v)
    p.click('#teamBtn')
    p.wait_for_selector('#setupErr:has-text("PRIVÉ")')
    assert not fake.read_json('donnees/config/equipe.json', full='oeg/public-donnees')
    # Limite de débit : message clair avec l'heure de reprise
    fake.rate_limit_remaining = 0
    p.fill('[name=repoSpec]', 'oeg/donnees')
    p.click('#teamCheck')
    p.wait_for_selector('#teamProbe .banner.nc:has-text("Limite de débit de l’API GitHub atteinte")')


def test_mode_autonome_inchange(devices, fake, gh_app_url):
    p = devices('Autonome')
    setup_standalone(p, device_no=7)
    assert p.evaluate("window.AuditApp.session.mode") == 'standalone'
    assert sync(p, ok=False).get('skipped') == 'mode autonome'
    tour = create_audit(p)
    assert tour['number'] == f'AUD-{YEAR}-070001' and tour['source'] == 'plage appareil'
    # Verrouillage puis déverrouillage hors connexion (mot de passe local)
    p.evaluate("window.AuditApp.lockApp('manuel')")
    p.wait_for_selector('#loginBtn')
    p.fill('[name=password]', PASSWORD)
    p.click('#loginBtn')
    p.wait_for_selector('#view')
    assert p.evaluate(f"!!window.AuditApp.store.get('audit', '{tour['id']}')")
    p.evaluate("location.hash = '#/synchronisation'")
    p.wait_for_selector('#teamAdvanced [data-act=attach]', state='attached')   # option avancée repliée
    assert fake.stats['requests'] == 0, 'aucun appel à GitHub en mode autonome'
