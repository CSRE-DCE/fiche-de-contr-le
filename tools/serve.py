#!/usr/bin/env python3
"""Serveur local de développement des « Fiches de contrôle terrain » (Office de l'Eau de Guyane).

Sert la racine du dépôt telle quelle (aucune étape de construction, aucun Node) :
  - en-tête « Cache-Control: no-store » : chaque rechargement reprend la dernière version des fichiers ;
  - types MIME corrects pour les modules ES (.js, .mjs), le manifeste (.webmanifest), les polices (.woff2, .ttf),
    les données (.json) et les images vectorielles (.svg) ;
  - écoute par défaut sur 127.0.0.1:8000 (localhost : le service worker et WebCrypto fonctionnent).

Utilisation (depuis la racine du dépôt) :
    python tools/serve.py                 → http://127.0.0.1:8000/
    python tools/serve.py --port 8080 --open
    python tools/serve.py --bind 0.0.0.0  → accessible depuis une tablette du réseau local (voir l'avertissement)
Arrêt : Ctrl+C.
"""
import argparse
import functools
import http.server
import pathlib
import sys
import threading
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent

MIME_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
}


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    """Fichiers statiques sans mise en cache par le navigateur, avec les types MIME de l'application."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME_TYPES}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if not getattr(self.server, 'quiet', False):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def make_server(port=8000, bind='127.0.0.1', root=ROOT, quiet=False, handler_class=NoStoreHandler):
    """Crée le serveur (port 0 : port libre choisi par le système). Utilisé aussi par tests/conftest.py
    (handler_class : variante du gestionnaire de requêtes, ex. coupure simulée du réseau)."""
    handler = functools.partial(handler_class, directory=str(root))
    httpd = http.server.ThreadingHTTPServer((bind, port), handler)
    httpd.daemon_threads = True
    httpd.quiet = quiet
    return httpd


def main(argv=None):
    parser = argparse.ArgumentParser(description='Serveur local des Fiches de contrôle terrain (racine du dépôt, sans cache).')
    parser.add_argument('--port', type=int, default=8000, help='port d’écoute (défaut : 8000)')
    parser.add_argument('--bind', default='127.0.0.1', help='adresse d’écoute (défaut : 127.0.0.1 ; 0.0.0.0 pour le réseau local)')
    parser.add_argument('--open', action='store_true', help='ouvrir l’application dans le navigateur par défaut')
    parser.add_argument('--quiet', action='store_true', help='ne pas afficher chaque requête')
    args = parser.parse_args(argv)

    try:
        httpd = make_server(args.port, args.bind, quiet=args.quiet)
    except OSError as e:
        print(f'Impossible d’écouter sur {args.bind}:{args.port} : {e.strerror or e}.'
              ' Le port est peut-être déjà utilisé : essayez --port 8001.', file=sys.stderr)
        return 1
    host = '127.0.0.1' if args.bind in ('127.0.0.1', '0.0.0.0', '') else 'localhost' if args.bind in ('::', '::1') else args.bind
    url = f'http://{host}:{httpd.server_address[1]}/'
    print('Fiches de contrôle terrain — serveur local')
    print(f'  Dossier servi : {ROOT}')
    print(f'  Application   : {url}')
    print(f'  Tests unitaires (navigateur) : {url}tests/unit/index.html')
    if args.bind not in ('127.0.0.1', 'localhost', '::1'):
        print('  Attention : accessible depuis le réseau. Hors de « localhost », le navigateur exige HTTPS pour le'
              ' service worker et le chiffrement (WebCrypto) : préférez GitHub Pages pour les tablettes.')
    print('Arrêt : Ctrl+C')
    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServeur arrêté.')
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
