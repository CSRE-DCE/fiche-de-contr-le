#!/usr/bin/env python3
"""Nouvelle version de l'application : incrémente AUDIT_BUILD et met AUDIT_BUILD_DATE à la date du jour (version.js).

À lancer avant chaque publication qui modifie un fichier de l'application (index.html, styles.css, css/, js/,
data/, img/, icons/, fonts/, vendor/, manifeste, sw.js) : les tablettes détectent alors la nouvelle version et
remplacent leur cache hors connexion (oeg-ct-build-<n>). tools/check_release.py refuse sinon la publication.

Utilisation :  python tools/bump_version.py            (AUDIT_BUILD + 1, date du jour)
               python tools/bump_version.py --dry-run  (affiche sans modifier)
"""
import argparse
import datetime
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = ROOT / 'version.js'


def bump(text, today):
    """Retourne (nouveau texte, ancien numéro, nouveau numéro)."""
    m = re.search(r'(self\.AUDIT_BUILD\s*=\s*)(\d+)(\s*;)', text)
    if not m:
        raise ValueError('version.js : « self.AUDIT_BUILD = <nombre entier>; » introuvable.')
    old = int(m.group(2))
    new = old + 1
    text = text[:m.start()] + f'{m.group(1)}{new}{m.group(3)}' + text[m.end():]
    date_re = re.compile(r'''(self\.AUDIT_BUILD_DATE\s*=\s*)(['"])[^'"]*\2(\s*;)''')
    if date_re.search(text):
        text = date_re.sub(lambda d: f"{d.group(1)}{d.group(2)}{today}{d.group(2)}{d.group(3)}", text, count=1)
    else:
        line_end = text.find('\n', text.find(f'self.AUDIT_BUILD = {new}'))
        insert = f"\nself.AUDIT_BUILD_DATE = '{today}';"
        text = text + insert + '\n' if line_end < 0 else text[:line_end] + insert + text[line_end:]
    return text, old, new


def main(argv=None):
    parser = argparse.ArgumentParser(description='Incrémente AUDIT_BUILD et date la version (version.js).')
    parser.add_argument('--dry-run', action='store_true', help='afficher le résultat sans modifier version.js')
    parser.add_argument('--date', help='date à inscrire (AAAA-MM-JJ ; défaut : aujourd’hui)')
    args = parser.parse_args(argv)
    today = args.date or datetime.date.today().isoformat()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', today):
        print(f'Date invalide : « {today} » (format AAAA-MM-JJ attendu).', file=sys.stderr)
        return 1
    try:
        text = VERSION.read_text(encoding='utf-8')
        new_text, old, new = bump(text, today)
    except (OSError, ValueError) as e:
        print(f'Impossible de mettre à jour la version : {e}', file=sys.stderr)
        return 1
    if args.dry_run:
        print(f'(essai) AUDIT_BUILD {old} → {new}, AUDIT_BUILD_DATE = {today} — version.js non modifié.')
        return 0
    VERSION.write_text(new_text, encoding='utf-8', newline='\n')
    print(f'Nouvelle version : AUDIT_BUILD {old} → {new} (version 1.0.{new}), AUDIT_BUILD_DATE = {today}.')
    print('Pensez à valider (commit) version.js avec vos modifications.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
