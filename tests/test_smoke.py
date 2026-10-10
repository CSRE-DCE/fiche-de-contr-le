"""Tests de fumée de l'application (Playwright) : première configuration en mode autonome, affichage de chaque écran
principal sans erreur JavaScript, verrouillage / déverrouillage de la session, et fonctionnement HORS CONNEXION
avec le service worker (cache préchargé à l'installation : SHELL de sw.js).
"""
import pytest

from helpers import ATHANASE, PASSWORD, goto_hash, lock, setup_standalone, unlock, wait_view

# (adresse, entrée de navigation active, texte attendu dans l'écran — insensible à la casse)
SCREENS = [
    ('#/', 'home', 'Athanase'),
    ('#/planning', 'planning', 'Planning'),
    ('#/audits', 'audits', 'Audits'),
    ('#/ecarts', 'ecarts', 'Écarts'),
    ('#/carte', 'carte', 'Carte'),
    ('#/tableau-de-bord', 'dashboard', 'Tableau de bord'),
    ('#/synchronisation', 'sync', 'Mode autonome'),
    ('#/administration', 'admin', 'Administration'),
    (f'#/station/{ATHANASE}', 'home', 'Athanase'),
]


def view_text(page):
    return page.inner_text('#view').casefold()


def test_configuration_et_ecrans(page, app_url):
    setup_standalone(page, app_url)
    assert page.evaluate('window.AuditApp.session.user.role') == 'admin'
    assert page.evaluate('window.AuditApp.session.device.number') == 7
    assert page.evaluate("window.AuditApp.store.count('site')") > 100, 'référentiel des stations OEG installé'
    assert page.evaluate("!!window.AuditApp.store.get('grid', 'grid-ct-2026-v1')"), 'grille CT-2026 installée'
    assert 'Office de l’Eau de Guyane' in page.inner_text('#appTop')
    for hash_, nav, expected in SCREENS:
        goto_hash(page, hash_)
        assert expected.casefold() in view_text(page), f'{hash_} : « {expected} » absent de l’écran'
        assert page.locator(f'#rail [data-nav="{nav}"].active').count() == 1, f'{hash_} : entrée « {nav} » non active'
    # Carte : Leaflet chargé hors CDN (vendor/leaflet), conteneur de carte présent
    goto_hash(page, '#/carte')
    page.wait_for_selector('.leaflet-container')
    assert page.evaluate('typeof L !== "undefined" && !!L.map')


def test_verrouillage_deverrouillage(page, app_url):
    setup_standalone(page, app_url)
    sites = page.evaluate("window.AuditApp.store.count('site')")
    lock(page)
    assert not page.evaluate('window.AuditApp.session.unlocked')
    assert page.locator('#view').count() == 0, 'données masquées pendant le verrouillage'
    page.fill('#app [name=password]', 'mauvais-mot-de-passe')
    page.click('#loginBtn')
    page.wait_for_function("() => document.querySelector('#loginErr')?.textContent.trim().length > 0")
    assert not page.evaluate('window.AuditApp.session.unlocked')
    unlock(page, PASSWORD)
    assert page.evaluate("window.AuditApp.store.count('site')") == sites, 'données déchiffrées après déverrouillage'
    goto_hash(page, '#/planning')
    # Verrouillage par l'application (même chemin que l'inactivité) puis reprise
    page.evaluate("window.AuditApp.lockApp('manuel')")
    unlock(page, PASSWORD)
    assert page.evaluate('window.AuditApp.session.user.username') == 'admin'


def test_hors_connexion(make_page, app_url, app_server):
    page = make_page(service_workers='allow', label='hors connexion')
    setup_standalone(page, app_url)
    # Installation du service worker : cache de l'application préchargé, page contrôlée
    state = page.evaluate("""async () => { const reg = await navigator.serviceWorker.ready; return reg.active && reg.active.state; }""")
    assert state in ('activating', 'activated'), state
    page.wait_for_function('() => !!navigator.serviceWorker.controller', timeout=30000)
    cached = page.evaluate("""async () => {
        const name = 'oeg-ct-build-' + self.AUDIT_BUILD;
        const keys = await (await caches.open(name)).keys();
        return { name, names: await caches.keys(), count: keys.length, urls: keys.map(r => new URL(r.url).pathname) };
    }""")
    assert cached['name'] in cached['names'], cached['names']
    assert cached['count'] >= 100, f"{cached['count']} fichiers en cache"
    for path in ('/index.html', '/js/main.js', '/js/views/station.js', '/data/referentiel-oeg.json', '/fonts/Barlow-Regular.woff2'):
        assert path in cached['urls'], f'{path} absent du cache'

    # Coupure du réseau (navigateur hors ligne ET serveur injoignable, y compris pour le service worker),
    # rechargement : l'application s'ouvre depuis le cache et reste utilisable.
    before = len(app_server.served)
    page.context.set_offline(True)
    app_server.offline = True
    try:
        page.reload()
        page.wait_for_selector('#loginBtn', timeout=30000)
        assert page.evaluate('navigator.onLine') is False
        assert 'Hors connexion' in page.inner_text('#app')
        unlock(page, PASSWORD)
        page.wait_for_function("() => /Hors connexion/.test(document.querySelector('#netLbl')?.textContent || '')")
        for hash_, expected in ((f'#/station/{ATHANASE}', 'Athanase'), ('#/planning', 'Planning'), ('#/nouvel-audit', 'Nouvelle tournée'),
                                ('#/tableau-de-bord', 'Tableau de bord')):
            goto_hash(page, hash_)
            assert expected.casefold() in page.inner_text('#view').casefold(), hash_
        assert page.evaluate("window.AuditApp.store.count('site')") > 100
    finally:
        app_server.offline = False
        page.context.set_offline(False)
    served_offline = app_server.served[before:]
    assert not served_offline, f'requêtes servies pendant la coupure : {served_offline[:10]}'

    # Retour du réseau : l'application continue normalement
    page.reload()
    unlock(page, PASSWORD)
    wait_view(page)


def test_carte_quitter_pendant_le_zoom(page, app_url):
    setup_standalone(page, app_url)
    goto_hash(page, '#/planning')
    goto_hash(page, '#/carte', settle=False)
    goto_hash(page, '#/planning')
    page.wait_for_timeout(700)
