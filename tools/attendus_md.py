#!/usr/bin/env python3
"""Génère docs/ATTENDUS-PRESTATAIRES.md depuis data/attendus-ct-2026.json (source unique des « attendus des
prestataires » du contrôle terrain 2026 : ce que le prestataire doit faire ou présenter pour chaque point de contrôle
de la grille CT-2026, comment le contrôleur le vérifie, comment choisir C / P / NC / N/A, note sur 20 et points majeurs,
liste de préparation).

Python standard uniquement (aucune dépendance). Les libellés, numéros, sections, types de tournée, portée
(« commun à la tournée ») et points majeurs (« majeur ») des critères sont recopiés de js/domain/grid-ct-2026.js
dans le JSON ; leur identité avec la grille est vérifiée par tests/unit/attendus.test.js.

Utilisation (depuis la racine du dépôt) :
    python tools/attendus_md.py            → écrit docs/ATTENDUS-PRESTATAIRES.md
    python tools/attendus_md.py --check    → code de sortie 1 si le document n'est pas à jour
    python tools/attendus_md.py --stdout   → affiche le document sans l'écrire
"""
import argparse
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data' / 'attendus-ct-2026.json'
TARGET = ROOT / 'docs' / 'ATTENDUS-PRESTATAIRES.md'
TYPES = ('bio', 'ce', 'eso')
SCALE = (('C', 'C', 'Conforme / satisfaisant'), ('P', 'P', 'Perfectible'), ('NC', 'NC', 'Non conforme'), ('NA', 'N/A', 'Non applicable'))


def load(path=SOURCE):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def slug(text):
    """Ancre stable (minuscules, sans accents ni ponctuation)."""
    s = unicodedata.normalize('NFD', str(text)).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def md_escape(text):
    """Texte sûr dans un tableau ou une liste Markdown (barres verticales, retours à la ligne)."""
    return str(text or '').replace('|', '\\|').replace('\r', '').replace('\n', ' ').strip()


def fr_date(iso):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(iso or ''))
    return f'{m.group(3)}/{m.group(2)}/{m.group(1)}' if m else str(iso or '')


def type_names(data, keys, short=True):
    labels = data.get('typesTournee', {})
    return ', '.join((labels.get(k, {}).get('court' if short else 'label') or k) for k in keys)


def code_of(crit):
    return f"F{crit['feuille']}.{crit['no']}"


def render(data):
    out = []
    w = out.append
    feuilles = data['feuilles']
    criteres = data['criteres']
    title = data.get('titre') or 'Attendus des prestataires – contrôle terrain 2026'
    w(f'# {title}')
    w('')
    w('<!-- Document généré par tools/attendus_md.py depuis data/attendus-ct-2026.json : ne pas le modifier à la main. -->')
    w('')
    w(f"Version **{data.get('version', '')}** du {fr_date(data.get('updated'))} · grille `{data.get('grid', '')}` · "
      f"source : `data/attendus-ct-2026.json` · écran de l’application : **Attendus des prestataires** (`#/attendus`).")
    w('')
    if data.get('avertissement'):
        w(f"> {md_escape(data['avertissement'])}")
        w('')

    # Sommaire
    w('## Sommaire')
    w('')
    w('- [Échelle de cotation C / P / NC / N/A et note sur 20](#echelle)')
    w('- [Liste de préparation de la tournée](#preparation)')
    for no, fe in feuilles.items():
        n = sum(1 for c in criteres.values() if str(c['feuille']) == no and not c.get('valeur'))
        w(f"- [F{no} — {fe['titre']}](#f{no}) · {n} point{'s' if n > 1 else ''} coté{'s' if n > 1 else ''} · {type_names(data, fe.get('types', []))}")
    w('- [Références citées](#references)')
    w('')

    # Échelle
    w('<a id="echelle"></a>')
    w('')
    w('## Échelle de cotation C / P / NC / N/A et note sur 20')
    w('')
    w('| Cote | Signification |')
    w('|:----:|---|')
    for code, short, label in SCALE:
        w(f"| **{short}** | **{label}.** {md_escape(data['echelle'].get(code, ''))} |")
    w('')
    w('Un critère marqué *Commun à la tournée* est jugé une seule fois pour toute la tournée (une réponse partagée par '
      'toutes les stations). Les mentions *À préciser* signalent une exigence chiffrée ou propre au marché que l’OEG doit confirmer.')
    w('')
    if data.get('notation'):
        w(f"**Note sur 20.** {md_escape(data['notation'])}")
        w('')

    # Préparation
    w('<a id="preparation"></a>')
    w('')
    w('## Liste de préparation de la tournée')
    w('')
    w('À remettre aux prestataires : ce qu’ils préparent avant chaque tournée (à cocher).')
    w('')
    prep = data.get('preparation', {})
    parts = [('commun', 'Commun à toutes les tournées')] + [(k, data.get('typesTournee', {}).get(k, {}).get('label', k)) for k in TYPES]
    for key, label in parts:
        groups = prep.get(key) or []
        if not groups:
            continue
        w(f'### {label}')
        w('')
        for g in groups:
            w(f"**{g.get('titre', '')}**")
            w('')
            for e in g.get('elements', []):
                w(f'- [ ] {md_escape(e)}')
            w('')

    # Feuilles
    for no, fe in feuilles.items():
        items = [(cid, c) for cid, c in criteres.items() if str(c['feuille']) == no]
        w(f'<a id="f{no}"></a>')
        w('')
        w(f"## F{no} — {fe['titre']}")
        w('')
        meta = [f"Onglet « {fe.get('onglet', '')} »",
                'renseignée une fois par tournée' if fe.get('portee') == 'tournee' else 'répétée pour chaque station',
                'types de tournée : ' + type_names(data, fe.get('types', []), short=False)]
        w('*' + ' · '.join(meta) + '*')
        w('')
        for t, other in (fe.get('titres') or {}).items():
            w(f"*Titre pour les tournées « {type_names(data, [t])} » : {other}.*")
            w('')
        if fe.get('intro'):
            w(md_escape(fe['intro']))
            w('')
        if fe.get('documents'):
            w('**À présenter ou à préparer :**')
            w('')
            for d in fe['documents']:
                w(f'- {md_escape(d)}')
            w('')
        values = [(cid, c) for cid, c in items if c.get('valeur')]
        if values:
            w('### Informations relevées par le contrôleur (sans cotation)')
            w('')
            w('| N° | Information | Ce qui est relevé |')
            w('|---|---|---|')
            for cid, c in values:
                what = re.sub(r'^Information à relever\s*:\s*', '', c.get('attendu', ''), flags=re.I)
                w(f"| {code_of(c)} | {md_escape(c['libelle'])} | {md_escape(what)} |")
            w('')
        section = None
        for cid, c in items:
            if c.get('valeur'):
                continue
            if c.get('section') != section:
                section = c.get('section')
                w(f'### {section}')
                w('')
            badges = []
            if c.get('majeur'):
                badges.append('Point majeur (compte double dans la note)')
            if c.get('tournee') and fe.get('portee') != 'tournee':
                badges.append('Commun à la tournée')
            if len(c.get('types', [])) < len(TYPES):
                badges.append('Tournées : ' + type_names(data, c.get('types', [])))
            w(f"#### {code_of(c)} – {c['libelle']}")
            w('')
            if badges:
                w('*' + ' · '.join(badges) + '*')
                w('')
            w(f"- **Attendu :** {md_escape(c.get('attendu'))}")
            w(f"- **Vérification :** {md_escape(c.get('verification'))}")
            for code, short, label in SCALE:
                if c.get(code):
                    w(f"- **{short}** ({label.lower()}) : {md_escape(c[code])}")
            if c.get('refs'):
                w(f"- **Références :** {md_escape(' · '.join(c['refs']))}")
            if c.get('aPreciser'):
                w(f"- **À préciser (OEG) :** {md_escape(c['aPreciser'])}")
            w('')

    # Références
    refs = data.get('references') or {}
    if refs:
        w('<a id="references"></a>')
        w('')
        w('## Références citées')
        w('')
        w('| Référence | Objet |')
        w('|---|---|')
        for k, v in refs.items():
            w(f'| {md_escape(k)} | {md_escape(v)} |')
        w('')
        w('Les protocoles du marché (PEZADA, IDGF, pêche, mercure, phytoplancton), le CCTP et les consignes du laboratoire '
          'sont fournis par l’OEG et le laboratoire ; ils prévalent sur le présent document.')
        w('')
    return '\n'.join(out).rstrip('\n') + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description='Génère docs/ATTENDUS-PRESTATAIRES.md depuis data/attendus-ct-2026.json.')
    ap.add_argument('--check', action='store_true', help='vérifie que le document est à jour (code de sortie 1 sinon)')
    ap.add_argument('--stdout', action='store_true', help='affiche le document au lieu de l’écrire')
    ap.add_argument('--source', default=str(SOURCE), help='fichier JSON des attendus')
    ap.add_argument('--output', default=str(TARGET), help='document Markdown à produire')
    args = ap.parse_args(argv)
    text = render(load(args.source))
    target = pathlib.Path(args.output)
    if args.stdout:
        sys.stdout.write(text)
        return 0
    if args.check:
        current = target.read_text(encoding='utf-8') if target.exists() else None
        if current != text:
            print(f'{target.relative_to(ROOT) if target.is_relative_to(ROOT) else target} n’est pas à jour : '
                  'lancer « python tools/attendus_md.py ».', file=sys.stderr)
            return 1
        print(f'{target.name} à jour.')
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')
    print(f'{target} écrit ({len(text.splitlines())} lignes).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
