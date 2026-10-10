#!/usr/bin/env python3
"""Vérifications statiques avant publication (lancées par GitHub Actions à chaque push et pull request).

Elles détectent les erreurs qui casseraient l'application sur les tablettes, sans Node ni réseau :
  a) un fichier listé dans SHELL (sw.js, cache hors connexion) n'existe pas ;
  b) un fichier de l'application (index.html, styles.css, manifeste, version.js, css/, fonts/ hors .txt, icons/,
     img/, vendor/ hors LICENSE, js/, data/) a été oublié dans SHELL : il manquerait hors connexion ;
     fichier référencé par index.html absent, import relatif vers un fichier inexistant ;
  c) chemin ABSOLU (« /js/… ») dans un src / href / import / url() de index.html, des CSS ou des JS : l'application
     est publiée sous un sous-chemin (GitHub Pages /fiche-de-contr-le/), tous les chemins doivent être relatifs ;
  d) code propre à Node dans js/ (require(, import 'node:…', process.) : l'application tourne dans le navigateur ;
  e) JSON invalide (manifest.webmanifest, data/*.json) ;
  f) version.js : AUDIT_BUILD doit être un entier et doit avoir été INCRÉMENTÉ si un fichier de l'application a
     changé depuis la base de comparaison (sinon les tablettes garderaient l'ancienne version en cache).
     Base : --base (défaut : origin/main s'il existe et diffère de HEAD, sinon HEAD~1) ; les modifications non
     validées (et les nouveaux fichiers non suivis) sont prises en compte. Ignoré proprement sans git.

Utilisation (depuis n'importe quel dossier) :
    python tools/check_release.py               base automatique
    python tools/check_release.py --base HEAD   seulement les modifications pas encore validées (commit)
Code de sortie : 0 si tout est correct, 1 en cas d'erreur.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

APP_FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'version.js']
APP_DIRS = ['css', 'fonts', 'icons', 'img', 'vendor', 'js', 'data']
# Fichiers dont la modification exige une nouvelle version (AUDIT_BUILD) : l'application + son service worker.
VERSIONED_FILES = APP_FILES + ['sw.js']


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def is_app_asset(rel):
    """Fichier de l'application à précharger dans le cache hors connexion (SHELL)."""
    p = pathlib.PurePosixPath(rel)
    if any(part.startswith('.') or part == '__pycache__' for part in p.parts):
        return False
    if rel in APP_FILES:
        return True
    if p.parts[0] not in APP_DIRS:
        return False
    if p.parts[0] == 'fonts' and p.suffix.lower() == '.txt':
        return False                      # licences OFL
    if p.parts[0] == 'vendor' and p.name.upper().startswith('LICENSE'):
        return False
    return True


def app_assets():
    out = [f for f in APP_FILES if (ROOT / f).is_file()]
    for d in APP_DIRS:
        if (ROOT / d).is_dir():
            out += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / d).rglob('*')) if p.is_file()]
    return sorted(f for f in set(out) if is_app_asset(f))


def is_versioned(rel):
    return rel in VERSIONED_FILES or (pathlib.PurePosixPath(rel).parts[0] in APP_DIRS and is_app_asset(rel))


def strip_js_comments(src):
    """Retire les commentaires /* … */ et // … du code JavaScript (chaînes, gabarits `…${…}…` imbriqués et
    expressions régulières littérales préservés ; retours à la ligne conservés pour les numéros de ligne)."""
    out, i, n = [], 0, len(src)
    stack = []                 # contextes ouverts : 'tpl' (gabarit) ou nombre d'accolades d'une expression ${…}
    last = ''                  # dernier caractère significatif du code (détection des expressions régulières)
    while i < n:
        c = src[i]
        if stack and stack[-1] == 'tpl':                         # intérieur d'un gabarit `…`
            if c == '\\':
                out.append(src[i:i + 2]); i += 2; continue
            if c == '`':
                stack.pop(); out.append(c); i += 1; last = '`'; continue
            if src.startswith('${', i):
                stack.append(0); out.append('${'); i += 2; last = '{'; continue
            out.append(c); i += 1; continue
        if c in '\'"':                                           # chaîne '…' ou "…"
            j = i + 1
            while j < n and src[j] != c and src[j] != '\n':
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1]); i = j + 1; last = c; continue
        if c == '`':
            stack.append('tpl'); out.append(c); i += 1; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append('\n' * src.count('\n', i, j)); i = j; continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and (not last or last in '(,=:[!&|?{};+-*%<>~^'):   # expression régulière littérale
            j, in_class = i + 1, False
            while j < n and src[j] != '\n':
                if src[j] == '\\':
                    j += 2; continue
                if src[j] == '[':
                    in_class = True
                elif src[j] == ']':
                    in_class = False
                elif src[j] == '/' and not in_class:
                    break
                j += 1
            out.append(src[i:j + 1]); i = j + 1; last = '/'; continue
        if stack and c == '{':
            stack[-1] += 1
        elif stack and c == '}':
            if stack[-1] == 0:                                   # fin de l'expression ${…} : retour au gabarit
                stack.pop(); out.append(c); i += 1; continue
            stack[-1] -= 1
        if not c.isspace():
            # mot-clé suivi d'une expression régulière (return /x/, typeof /x/…) : traité comme un opérateur
            last = '(' if c.isalnum() and src[max(0, i - 6):i + 1].endswith(('return', 'typeof', 'case')) else c
        out.append(c); i += 1
    return ''.join(out)


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def is_external(u):
    return bool(re.match(r'^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\$\{|about:)', u, re.I))


def parse_build(src):
    """Valeur de self.AUDIT_BUILD dans le texte de version.js (None si absente, chaîne si non entière)."""
    m = re.search(r'self\.AUDIT_BUILD\s*=\s*([^;\n]+)', src)
    if not m:
        return None
    v = m.group(1).strip()
    return int(v) if re.fullmatch(r'\d+', v) else v


def git(*args):
    r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f'git {" ".join(args)} a échoué')
    return r.stdout


def default_base():
    head = git('rev-parse', 'HEAD').strip()
    try:
        origin = git('rev-parse', '--verify', '--quiet', 'origin/main^{commit}').strip()
    except RuntimeError:
        origin = ''
    if origin and origin != head:
        return 'origin/main'
    return 'HEAD~1'


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description='Vérifications statiques avant publication de la PWA (sans Node).')
    parser.add_argument('--base', help='révision git de comparaison pour AUDIT_BUILD (défaut : origin/main s’il diffère de HEAD, sinon HEAD~1)')
    args = parser.parse_args(argv)

    errors, notes = [], []
    fail = errors.append

    # ---------- a) SHELL de sw.js ----------
    sw = read('sw.js')
    m = re.search(r'const\s+SHELL\s*=\s*\[([\s\S]*?)\]', sw)
    shell = []
    if not m:
        fail('sw.js : liste SHELL introuvable (const SHELL = [ … ]).')
    else:
        shell = [a or b for a, b in re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1))]
    norm = [re.sub(r'^\./', '', s) for s in shell]
    for s, n in zip(shell, norm):
        if s.startswith('/') or re.match(r'^https?:', s):
            fail(f'sw.js : « {s} » dans SHELL n’est pas un chemin relatif (« ./… » attendu).')
        elif n and not (ROOT / n).is_file():
            fail(f'sw.js met en cache « {s} », qui n’existe pas.')
    dups = sorted({n for n in norm if norm.count(n) > 1})
    if dups:
        fail('sw.js : entrées en double dans SHELL : ' + ', '.join(dups))
    shell_set = set(norm)

    # ---------- b) fichiers de l'application absents de SHELL ----------
    assets = app_assets()
    for f in assets:
        if f not in shell_set:
            fail(f'{f} est un fichier de l’application mais n’est pas dans SHELL (sw.js) : il manquerait hors connexion.')

    # index.html : fichiers référencés présents et en cache ; identifiants uniques
    html = read('index.html')
    refs = re.findall(r'\b(?:src|href)\s*=\s*["\']([^"\']*)["\']', html)
    for u in sorted(set(refs)):
        if not u or is_external(u) or u.startswith('/'):
            continue
        f = re.split(r'[?#]', u)[0]
        if not (ROOT / f).exists():
            fail(f'index.html référence « {u} », qui n’existe pas.')
        elif f not in shell_set:
            fail(f'« {u} » est utilisé par index.html mais absent de SHELL (sw.js).')
    ids = re.findall(r'\sid="([^"]+)"', html)
    dup_ids = sorted({i for i in ids if ids.count(i) > 1})
    if dup_ids:
        fail('index.html : identifiants HTML en double : ' + ', '.join(dup_ids))

    # ---------- c) chemins absolus ; imports relatifs résolus ----------
    def check_url(rel, text, pos, u, kind, resolve=True):
        if not u or is_external(u):
            return
        if u.startswith('/'):
            fail(f'{rel}:{line_of(text, pos)} : chemin absolu « {u} » ({kind}) — utiliser un chemin relatif '
                 '(l’application est publiée sous /fiche-de-contr-le/).')
            return
        if re.match(r'^[a-z][\w+.-]*:', u, re.I):
            return                        # autre schéma (node: … traité au point d)
        if kind in ('import', 'import()') and not u.startswith(('./', '../')):
            fail(f'{rel}:{line_of(text, pos)} : {kind} « {u} » — le navigateur exige un chemin relatif (« ./ » ou « ../ »).')
            return
        if resolve:
            target = (ROOT / rel).parent / re.split(r'[?#]', u)[0]
            if not target.exists():
                fail(f'{rel}:{line_of(text, pos)} : {kind} « {u} » introuvable.')

    for m in re.finditer(r'\b(src|href)\s*=\s*["\']([^"\']*)["\']', html):
        check_url('index.html', html, m.start(), m.group(2), m.group(1), resolve=False)

    css_files = ['styles.css'] + [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / 'css').rglob('*.css'))] \
        + [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / 'vendor').rglob('*.css'))]
    for rel in css_files:
        text = read(rel)
        for m in re.finditer(r'url\(\s*["\']?([^"\')]+)["\']?\s*\)', text):
            check_url(rel, text, m.start(), m.group(1).strip(), 'url()')
        for m in re.finditer(r'@import\s+(?:url\()?\s*["\']([^"\']+)["\']', text):
            check_url(rel, text, m.start(), m.group(1), '@import')

    js_files = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / 'js').rglob('*.js')) + ['sw.js', 'version.js']
    js_patterns = [
        (r'(?m)^[ \t]*(?:import|export)\b[^;\'"`]*?\bfrom\s*["\']([^"\'\n]+)["\']', 'import'),
        (r'(?m)^[ \t]*import\s*["\']([^"\'\n]+)["\']', 'import'),
        (r'(?<![\w.$\'"])import\s*\(\s*["\']([^"\'\n]+)["\']', 'import()'),
        (r'\bimportScripts\s*\(\s*["\']([^"\'\n]+)["\']', 'importScripts'),
        (r'\bnew\s+URL\s*\(\s*["\']([^"\'\n]+)["\']\s*,\s*import\.meta\.url', 'new URL'),
        (r'\bfetch\s*\(\s*["\']([^"\'\n]+)["\']', 'fetch'),
        (r'\b(?:src|href)\s*=\s*\\?["\']([^"\'\n$]*)', 'src/href'),
    ]
    for rel in js_files:
        code = strip_js_comments(read(rel))
        for pat, kind in js_patterns:
            for m in re.finditer(pat, code):
                u = m.group(1)
                check_url(rel, code, m.start(), u, kind, resolve=kind in ('import', 'import()', 'importScripts', 'new URL'))

    # ---------- d) code propre à Node dans js/ ----------
    for rel in [f for f in js_files if f.startswith('js/')]:
        code = strip_js_comments(read(rel))
        for pat, what in [(r'\brequire\s*\(', 'require('), (r'["\']node:[a-z_/]+["\']', 'module « node: »'),
                          (r'(?<![\w.$])process\s*\.', 'process.')]:
            for m in re.finditer(pat, code):
                fail(f'{rel}:{line_of(code, m.start())} : {what} — code Node interdit dans l’application (navigateur uniquement).')

    # ---------- e) JSON valides ----------
    json_files = ['manifest.webmanifest'] + [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / 'data').glob('*.json'))]
    for rel in json_files:
        try:
            json.loads(read(rel))
        except (OSError, ValueError) as e:
            fail(f'{rel} : JSON invalide ({e}).')

    # ---------- f) numéro de version ----------
    build = parse_build(read('version.js'))
    if not isinstance(build, int):
        fail(f'version.js : AUDIT_BUILD doit être un nombre entier (valeur lue : {build!r}).')
    else:
        try:
            base = args.base or default_base()
            try:
                git('rev-parse', '--verify', '--quiet', f'{base}^{{commit}}')
            except RuntimeError:
                if args.base:
                    raise LookupError(base)
                raise
            merge_base = git('merge-base', base, 'HEAD').strip()
            changed = set(git('diff', '--name-only', merge_base).split('\n'))
            changed |= set(git('ls-files', '--others', '--exclude-standard').split('\n'))
            app_changed = sorted(f for f in changed if f and is_versioned(f))
            try:
                base_build = parse_build(git('show', f'{merge_base}:version.js'))
            except RuntimeError:
                base_build = None          # version.js absent de la base
            if not app_changed:
                notes.append(f'aucun fichier de l’application modifié depuis {base}')
            elif not isinstance(base_build, int):
                notes.append(f'{len(app_changed)} fichier(s) de l’application modifié(s) depuis {base} (pas de version.js exploitable dans la base)')
            elif build <= base_build:
                shown = ', '.join(app_changed[:12]) + (f' … (+{len(app_changed) - 12})' if len(app_changed) > 12 else '')
                fail(f'Fichiers de l’application modifiés depuis {base} ({shown}) mais AUDIT_BUILD n’a pas été incrémenté '
                     f'dans version.js (actuel : {build}, base : {base_build}). Lancer : python tools/bump_version.py')
            else:
                notes.append(f'{len(app_changed)} fichier(s) de l’application modifié(s) depuis {base}, AUDIT_BUILD {base_build} → {build}')
        except LookupError as e:
            fail(f'--base : révision git « {e.args[0]} » introuvable (exemples : HEAD, HEAD~1, origin/main).')
        except (RuntimeError, OSError) as e:
            first = str(e).splitlines()[0] if str(e) else 'erreur inconnue'
            notes.append(f'comparaison de version ignorée (git indisponible ou base introuvable : {first})')

    if errors:
        print(f'ÉCHEC — {len(errors)} problème(s) :\n', file=sys.stderr)
        for e in errors:
            print('  • ' + e, file=sys.stderr)
        return 1
    print(f'Vérifications OK — {len(shell)} fichiers dans SHELL, {len(assets)} fichiers de l’application, '
          f'{len(js_files)} fichiers JS, {len(css_files)} feuilles de style, {len(json_files)} fichiers JSON, '
          f'AUDIT_BUILD {build}.')
    for n in notes:
        print('  - ' + n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
