"""Fixtures communes des tests de bout en bout (pytest + Playwright Python, sans Node).

  app_url    (session)  serveur statique Python (tools/serve.py) sur un port libre, racine du dépôt,
                        « Cache-Control: no-store », types MIME des modules ES ; URL terminée par « / ».
  app_server (session)  le serveur lui-même : app_server.served (chemins servis), app_server.offline = True
                        (coupure du réseau simulée : connexions fermées sans réponse, y compris pour les requêtes
                        du service worker, que context.set_offline() n'intercepte pas), app_server.refused.
  browser    (session)  Chromium (Playwright). Variable HEADED=1 : navigateur visible.
  make_page  (test)     fabrique de pages : make_page(service_workers='block'|'allow', viewport=…, label=…) —
                        nouveau contexte (service worker bloqué par défaut, tuiles de carte bloquées, position GPS
                        simulée sur la station ATHANASE, fuseau de Cayenne) + page ; erreurs de console et
                        exceptions collectées dans page.errors.
  page       (test)     make_page() par défaut.
Un test échoue s'il reste des erreurs de console ou des exceptions JavaScript (hors « Failed to load resource » des
tuiles bloquées), sauf marqueur @pytest.mark.allow_console_errors (toutes) ou
@pytest.mark.allow_console_errors(r'motif', …) (seulement celles qui correspondent).
Ces fixtures sont aussi utilisées (app_url, browser) par tests/test_sync_github.py.
"""
import os
import pathlib
import re
import sys
import threading

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
for p in (ROOT / 'tools', ROOT / 'tests'):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from serve import NoStoreHandler, make_server  # noqa: E402  (tools/serve.py)

# Requêtes des service workers visibles et soumises aux routes du contexte (Chromium) : les tuiles de carte
# restent bloquées même lorsqu'elles passent par le service worker (test hors connexion).
os.environ.setdefault('PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS', '1')

# Tuiles des fonds de carte : bloquées (aucune dépendance réseau pendant les tests).
TILE_HOSTS = re.compile(r'^https?://([a-z0-9-]+\.)*(openstreetmap\.org|arcgisonline\.com|opentopomap\.org)/', re.I)
# Position simulée : station ATHANASE (Approuague), code SANDRE 09271503.
ATHANASE_GEO = {'latitude': 4.2066, 'longitude': -52.29, 'accuracy': 12}
VIEWPORT = {'width': 1280, 'height': 900}


class _TestHandler(NoStoreHandler):
    """Gestionnaire du serveur de test : chemins servis enregistrés ; coupure du réseau simulée (server.offline)."""

    def handle(self):
        if self.server.offline:
            self.server.refused.append(self.client_address)
            return                      # connexion fermée sans réponse : erreur réseau côté navigateur
        super().handle()

    def end_headers(self):
        super().end_headers()
        self.server.served.append(self.path)


@pytest.fixture(scope='session')
def app_server():
    httpd = make_server(0, '127.0.0.1', quiet=True, handler_class=_TestHandler)
    httpd.served, httpd.refused, httpd.offline = [], [], False
    thread = threading.Thread(target=httpd.serve_forever, name='serveur-statique', daemon=True)
    thread.start()
    yield httpd
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture(scope='session')
def app_url(app_server):
    return f'http://127.0.0.1:{app_server.server_address[1]}/'


@pytest.fixture(scope='session')
def browser():
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    try:
        b = pw.chromium.launch(headless=os.environ.get('HEADED', '') in ('', '0'))
    except Exception:
        pw.stop()
        raise
    yield b
    b.close()
    pw.stop()


def _is_tile_failure(msg):
    """Échec de chargement d'une tuile bloquée volontairement (route.abort)."""
    if not msg.text.startswith('Failed to load resource'):
        return False
    url = (msg.location or {}).get('url', '')
    return bool(TILE_HOSTS.search(url))


@pytest.fixture
def make_page(browser, request):
    pages, contexts = [], []
    request.node._oeg_pages = pages

    def make(*, service_workers='block', viewport=None, label='', geolocation=ATHANASE_GEO, **context_options):
        ctx = browser.new_context(
            viewport=viewport or VIEWPORT, service_workers=service_workers, locale='fr-FR', timezone_id='America/Cayenne',
            geolocation=geolocation, permissions=['geolocation'] if geolocation else [], accept_downloads=True, **context_options)
        ctx.route(TILE_HOSTS, lambda route: route.abort())
        ctx.set_default_timeout(30000)
        contexts.append(ctx)
        page = ctx.new_page()
        page.label = label or f'page {len(pages) + 1}'
        page.errors = []
        page.on('console', lambda m: page.errors.append(f'console : {m.text}') if m.type == 'error' and not _is_tile_failure(m) else None)
        page.on('pageerror', lambda e: page.errors.append(f'exception : {e}'))
        pages.append(page)
        return page

    yield make
    for ctx in contexts:
        try:
            ctx.close()
        except Exception:
            pass


@pytest.fixture
def page(make_page):
    return make_page()


def _unexpected_errors(item):
    pages = getattr(item, '_oeg_pages', None) or []
    marker = item.get_closest_marker('allow_console_errors')
    if marker and not marker.args:
        return []
    allowed = [re.compile(a) for a in (marker.args if marker else ())]
    out = []
    for p in pages:
        out += [f'[{p.label}] {e}' for e in p.errors if not any(a.search(e) for a in allowed)]
    return out


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    """Après un test réussi : échec s'il reste des erreurs de console / exceptions JavaScript non attendues."""
    result = yield
    errors = _unexpected_errors(item)
    if errors:
        shown = '\n  '.join(errors[:15]) + (f'\n  … et {len(errors) - 15} autre(s)' if len(errors) > 15 else '')
        pytest.fail(f'{len(errors)} erreur(s) JavaScript ou de console inattendue(s) :\n  {shown}\n'
                    '(marqueur @pytest.mark.allow_console_errors pour les tolérer)', pytrace=False)
    return result
