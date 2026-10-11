"""Non-régression de l'affichage des feuilles et des fiches PDF (relecture visuelle et parcours terrain).

Mesures dans le navigateur (Playwright), sans comparaison d'images :
  - téléphone 390 px : aucune étape d'une tournée de 2 stations ne déborde horizontalement (3 types de tournée),
    pied de feuille « Précédent / Suivant » compris ; fenêtre « Nouvel écart » dans l'écran (P3) ;
  - zones de texte lignées : interligne du texte = pas des pointillés (V1) ;
  - repères terrain de la feuille 1 : champs heure lisibles à 390 px, aucun débordement en 1055 px (V2, V3) ;
  - en-tête des feuilles à 1491 px (menu latéral ouvert) : slogan affiché (V6) ; F8 : parties A et B côte à côte sans
    défilement horizontal (V7) ; unité « FNU » à côté de la valeur (V9) ; « : » final d'un titre d'encadré jamais seul
    sur sa ligne (V10) ; champ « Fonction » de F9 assez large (V11) ; libellés en bleu marine (V5) ;
  - PDF (texte et couleurs lus dans les opérations des pages) : bandeau bleu de la feuille de tournée, grand bandeau
    « Station » de F3 / F9 (V4), libellés bleu marine / brun (V5), aucun « : » isolé (V8) ; tournée modifiée après
    signature : empreinte du contenu imprimé et récapitulatif des modifications (P5).
"""
import re

import pytest

from helpers import ATHANASE, answer_required, audit_state, create_tour, goto_hash, js, setup_standalone

PHONE = {'width': 390, 'height': 844}
WIDE = {'width': 1491, 'height': 1055}          # portable, menu latéral ouvert : feuille de 1155 px utiles
NAVY = (13, 53, 119)
RUST_INK = (138, 58, 26)

TOURS = {
    'bio': ([ATHANASE, 'site-09160201'], 'prov-HYDRECO'),
    'ce': (['site-09281718', 'site-09281719'], 'prov-TL1'),
    'eso': (['site-BSS002PANK', 'site-BSS002PAAX'], 'prov-NBC'),
}

# Largeur de page (débordement horizontal) et éléments qui dépassent à droite sans être rognés par un parent.
OVERFLOW = """() => {
  const W = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
  const out = [];
  if (sw > W) for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect();
    if (!b.width || b.right <= W + 1) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= W + 1) { clipped = true; break; }
    }
    if (!clipped) out.push(`${el.tagName}.${[...el.classList].join('.')} ${Math.round(b.left)}→${Math.round(b.right)}`);
  }
  return { W, sw, out: out.slice(0, 5) };
}"""


def attr(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def rgb(css):
    return tuple(int(v) for v in re.findall(r'\d+', css)[:3])


def tour_steps(page, audit_id):
    """Étapes d'une tournée dans l'ordre du pied de feuille (« Suivant »), puis Infos."""
    steps = ['feuille-2']
    while True:
        goto_hash(page, f'#/audit/{audit_id}/{steps[-1]}')
        nxt = page.locator('.as-footer a.btn.primary')
        if not nxt.count():
            break
        step = nxt.get_attribute('href').rsplit('/', 1)[-1]
        if step in steps:
            break
        steps.append(step)
    return steps + ['infos']


def fill_sample(page, audit_id, key):
    """Réponses d'exemple de la station `key` (valeurs à unité, champs texte, encadrés)."""
    js(page, """const k = arg.key;
        const R = {
          'it-F2-2.2': { status: 'C', value: 4 },
          [`it-F4-9@${k}`]: { status: 'C', value: { t1: 3.1, t2: 3.3, t3: 3.2 } },
          [`it-F8-A4@${k}`]: { status: 'C', value: '17:30' },
          [`it-F8-B1@${k}`]: { status: 'NC', value: 3, comment: 'Effectif insuffisant.' },
          [`it-F9-1@${k}`]: { status: 'C', value: { nom: 'Dupont', fonction: 'Technicien de rivière' } },
        };
        await A.updateAudit(store.get('audit', arg.id), x => {
          for (const [id, r] of Object.entries(R)) x.responses[id] = { ...(x.responses[id] || {}), ...r, at: new Date().toISOString(), by: session.user.id, byName: session.user.name };
        });
        await A.updateSheet(store.get('audit', arg.id), '2', { observations: 'Équipe en sous-effectif, à signaler au prestataire. Deuxième phrase assez longue pour passer à la ligne suivante dans l’encadré des observations.' });
        await A.updateSheet(store.get('audit', arg.id), `4@${k}`, { observations: 'Flaconnage métaux à compléter.' });
        return true;""", {'id': audit_id, 'key': key})


def show(page, viewport, audit_id, step):
    page.set_viewport_size(viewport)
    goto_hash(page, f'#/audit/{audit_id}/{step}')
    page.wait_for_timeout(120)


# ---------------------------------------------------------------------------------------------------------------
# Téléphone : aucune feuille ne déborde (P3)
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
@pytest.mark.parametrize('audit_type', list(TOURS))
def test_telephone_aucun_debordement_horizontal(make_page, app_url, audit_type):
    page = make_page(viewport=PHONE, is_mobile=True, has_touch=True, device_scale_factor=2)
    setup_standalone(page, app_url)
    sites, provider = TOURS[audit_type]
    tour = create_tour(page, audit_type, sites, provider)
    steps = tour_steps(page, tour['id'])
    assert len([s for s in steps if s.startswith('feuille-')]) >= 7, steps
    assert {'ecarts', 'synthese', 'signatures', 'infos'} <= set(steps), steps
    for step in steps:
        goto_hash(page, f'#/audit/{tour["id"]}/{step}')
        page.wait_for_timeout(80)
        r = page.evaluate(OVERFLOW)
        assert r['sw'] <= r['W'], f'{audit_type} {step} : page de {r["sw"]} px pour {r["W"]} px — {r["out"]}'
        if page.locator('.as-footer .btn').count():
            boxes = page.eval_on_selector_all('.as-footer .btn', 'els => els.map(e => e.getBoundingClientRect().right)')
            assert max(boxes) <= r['W'] + 1, f'{audit_type} {step} : bouton du pied hors de l’écran {boxes}'

    # Fenêtre « Nouvel écart » ouverte depuis une feuille station : entièrement dans l'écran
    key = tour['stations'][0]
    item = next(i['id'] for s in audit_state(page, tour['id'])['sheets'] if s['key'] == f'4@{key}' for i in s['items'] if i['kind'] == 'conformity')
    js(page, "await A.setResponse(store.get('audit', arg.id), arg.item, { status: 'NC', comment: 'Constat (test d’affichage).' }); return true;",
       {'id': tour['id'], 'item': item})
    goto_hash(page, f'#/audit/{tour["id"]}/feuille-4@{key}')
    page.click(f'.st-row-card[id*={attr(item)}] [data-act=dev-new]')
    page.wait_for_selector('.modal')
    page.wait_for_timeout(250)
    box = page.eval_on_selector('.modal', 'm => { const b = m.getBoundingClientRect(); return [b.left, b.right]; }')
    r = page.evaluate(OVERFLOW)
    assert box[0] >= -1 and box[1] <= r['W'] + 1 and r['sw'] <= r['W'], f'fenêtre « Nouvel écart » hors écran : {box}, {r}'


# ---------------------------------------------------------------------------------------------------------------
# Feuilles à l'écran : zones lignées, repères, en-tête, F8, unités, champs texte, titres, couleurs
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_feuilles_mesures_d_affichage(make_page, app_url):
    page = make_page(viewport=WIDE)
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE, 'site-09160201'], 'prov-HYDRECO', ['pres-BIO-2026-09271503', 'pres-BIO-2026-09160201'])
    aid, key = tour['id'], tour['stations'][0]
    fill_sample(page, aid, key)

    # V1 — zones lignées : le texte est posé sur chaque pointillé (interligne = pas des pointillés), toutes largeurs
    for vp in (WIDE, PHONE):
        show(page, vp, aid, 'feuille-2')
        lined = page.eval_on_selector_all('textarea.as-lined', """els => els.map(t => { const cs = getComputedStyle(t);
            return [parseFloat(cs.lineHeight), parseFloat(cs.backgroundSize.split(' ')[1]), parseFloat(cs.backgroundPosition.split(' ')[1])]; })""")
        assert lined, 'zones lignées de la feuille 2'
        for lh, step, offset in lined:
            assert lh == step == 30, f'interligne {lh} px pour des pointillés tous les {step} px'
            assert 0 < offset < step / 2, f'pointillé décalé de {offset} px : sous la ligne de texte'

    # V2 — repères terrain à 390 px : champs date / heure lisibles, libellés entiers
    show(page, PHONE, aid, f'feuille-1@{key}')
    reps = page.eval_on_selector_all('.as-rep .as-rep-row', """rows => rows.map(r => { const l = r.querySelector('label'), i = r.querySelector('.as-rep-v input');
        return i && /time|date/.test(i.type) ? [l.textContent.trim(), Math.round(i.getBoundingClientRect().width), l.scrollWidth > l.clientWidth + 1] : null; }).filter(Boolean)""")
    assert len(reps) >= 3, reps
    for label, width, cut in reps:
        assert width >= 120, f'« {label} » : champ de {width} px à 390 px'
        assert not cut, f'« {label} » : libellé tronqué'

    # V3 — repères terrain en 1055 × 1491 (portrait) : rien ne déborde de la carte
    show(page, {'width': 1055, 'height': 1491}, aid, f'feuille-1@{key}')
    over = page.eval_on_selector('.as-rep', 'c => [c.scrollWidth, c.clientWidth, document.documentElement.scrollWidth, innerWidth]')
    assert over[0] <= over[1] and over[2] <= over[3], f'repères terrain : {over}'

    # V6 — slogan de l'en-tête visible à 1491 px (feuille de 1000 à 1180 px) avec le pavé « Station »
    for step in (f'feuille-4@{key}', f'feuille-8@{key}', 'feuille-2'):
        show(page, WIDE, aid, step)
        tag = page.eval_on_selector('.as-hd-full .oeg-header .oh-tagline', """t => { const h = t.closest('.oeg-header'); const b = t.getBoundingClientRect();
            return [getComputedStyle(t).display, Math.round(b.width), h.scrollWidth <= h.clientWidth, Math.round(h.querySelector('.oh-org').getBoundingClientRect().height)]; }""")
        assert tag[0] != 'none' and tag[1] > 60, f'{step} : slogan masqué {tag}'
        assert tag[2], f'{step} : en-tête qui déborde'
        assert tag[3] < 50, f'{step} : titre OEG comprimé sur plusieurs lignes ({tag[3]} px)'

    # V7 — F8 : parties A et B côte à côte, sans défilement horizontal des tableaux
    show(page, WIDE, aid, f'feuille-8@{key}')
    split = page.evaluate("""() => { const s = document.querySelector('.as-frame .sheet-split'); const cards = [...s.children].map(c => c.getBoundingClientRect());
        return { tops: cards.map(c => Math.round(c.top)), wraps: [...s.querySelectorAll('.st-wrap')].map(w => [w.scrollWidth, w.clientWidth]) }; }""")
    assert len(split['tops']) == 2 and split['tops'][0] == split['tops'][1], f'parties A et B empilées : {split}'
    for sw, cw in split['wraps']:
        assert sw <= cw, f'tableau de F8 avec défilement horizontal : {sw} > {cw}'
    # Feuille plus étroite que 1100 px : empilées (et toujours sans défilement)
    show(page, {'width': 1280, 'height': 900}, aid, f'feuille-8@{key}')
    cols = page.eval_on_selector('.as-frame .sheet-split', 'e => getComputedStyle(e).gridTemplateColumns.split(" ").length')
    assert cols == 1

    # V9 — F4.9 : l'unité FNU suit chaque valeur sur la même ligne (tableau et carte)
    for vp in (WIDE, PHONE):
        show(page, vp, aid, f'feuille-4@{key}')
        sel = f'[id={attr("row-it-F4-9@" + key)}]' if vp is WIDE else f'.st-row-card[id*={attr("it-F4-9@" + key)}]'
        fields = page.eval_on_selector_all(f'{sel} .st-field', """fs => fs.map(f => { const i = f.querySelector('input').getBoundingClientRect(), u = f.querySelector('.st-unit').getBoundingClientRect();
            return [u.top < i.bottom && u.bottom > i.top, u.left >= i.right - 1, f.querySelector('.st-unit').textContent]; })""")
        assert len(fields) == 3, fields
        assert all(same and after for same, after, _ in fields), f'{vp["width"]} px : unité sous la valeur {fields}'

    # V11 — F9 A1 : « Technicien de rivière » lisible en entier dans le champ « Fonction »
    for vp in (WIDE, PHONE):
        show(page, vp, aid, f'feuille-9@{key}')
        sel = f'[id={attr("row-it-F9-1@" + key)}]' if vp is WIDE else f'.st-row-card[id*={attr("it-F9-1@" + key)}]'
        inputs = page.eval_on_selector_all(f'{sel} .st-field input', 'is => is.map(i => [i.value, i.scrollWidth, i.clientWidth])')
        for value, sw, cw in inputs:
            assert sw <= cw + 1, f'{vp["width"]} px : « {value} » coupé ({sw} > {cw})'

    # V10 — titre d'encadré : « : » final insécable, jamais seul sur la dernière ligne
    for vp in (WIDE, PHONE):
        show(page, vp, aid, f'feuille-4@{key}')
        title = page.evaluate("""() => { const t = [...document.querySelectorAll('.bc-title')].find(e => /actions demandées/.test(e.textContent));
            const n = t.firstChild, r = document.createRange(); let lastTop = -1, start = 0;
            for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect();
              if (!b.width) continue; if (lastTop >= 0 && b.top > lastTop + 2) start = i; lastTop = Math.max(lastTop, b.top); }
            return [t.textContent, t.textContent.slice(start)]; }""")
        assert ' :' in title[0], title
        assert re.search(r'\w', title[1]), f'« : » seul en fin de titre : {title}'

    # V5 — libellés et références courtes en bleu marine (seuls les numéros prennent la couleur de la feuille) ;
    # partie B de F8 en brun
    show(page, WIDE, aid, f'feuille-3@{key}')
    for no in ('3', '6'):
        show(page, WIDE, aid, f'feuille-{no}@{key}')
        colors = page.eval_on_selector_all('.st-table td.c-label, .st-table td.c-short', 'es => [...new Set(es.map(e => getComputedStyle(e).color))]')
        assert colors and all(rgb(c) == NAVY for c in colors), f'F{no} : {colors}'
        show(page, PHONE, aid, f'feuille-{no}@{key}')
        colors = page.eval_on_selector_all('.st-rc-label, .st-rc-short', 'es => [...new Set(es.map(e => getComputedStyle(e).color))]')
        assert colors and all(rgb(c) == NAVY for c in colors), f'F{no} (cartes) : {colors}'
    show(page, WIDE, aid, f'feuille-8@{key}')
    colors = page.eval_on_selector_all('.as-split > *', "cs => cs.map(c => [...new Set([...c.querySelectorAll('.st-table td.c-label')].map(e => getComputedStyle(e).color))])")
    assert [list(map(rgb, c)) for c in colors] == [[NAVY], [RUST_INK]], colors


# ---------------------------------------------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------------------------------------------
# Textes des pages d'un PDF construit par buildSheetsPdf : [{ text, rgb, size }] par page (opérations « … rg … Td
# <hex> Tj » de js/formats/pdf.js, codes WinAnsi ≈ latin-1 pour les caractères utiles ici).
PDF_TEXTS = """
  const decode = h => (h.match(/../g) || []).map(x => String.fromCharCode(parseInt(x, 16))).join('').replace(/\\x92/g, '’').replace(/\\x97/g, '—').replace(/\\x85/g, '…').replace(/\\xA0/g, ' ');
  const pageTexts = p => [...p.ops.join('\\n').matchAll(/\\/\\w+ ([\\d.]+) Tf (?:[\\d.\\-]+ Tc )?([\\d.]+) ([\\d.]+) ([\\d.]+) rg [\\d.\\- ]+Td <([0-9A-Fa-f]*)> Tj/g)]
    .map(m => ({ size: Number(m[1]), rgb: [m[2], m[3], m[4]].map(v => Math.round(Number(v) * 255)), text: decode(m[5]) }));
"""


def pdf_pages(page, audit_id, only=None):
    """Textes (avec couleur et corps) de chaque page des fiches PDF de la tournée ; only : numéros de feuille."""
    return js(page, PDF_TEXTS + """
        const S = await import('./js/app/sheets-pdf.js');
        const model = await S.sheetsModelFromAudit(store.get('audit', arg.id));
        const only = arg.only ? sh => arg.only.includes(sh.index) : null;
        const { doc } = await S.buildSheetsPdf(model, { only, mapNetwork: false });
        return doc.pages.map(p => pageTexts(p));""", {'id': audit_id, 'only': only})


def near(c, ref, tol=6):
    return all(abs(a - b) <= tol for a, b in zip(c, ref))


@pytest.mark.lent
def test_pdf_bandeaux_libelles_et_ponctuation(page, app_url):
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', ['pres-BIO-2026-09271503'])
    aid, key = tour['id'], tour['stations'][0]
    fill_sample(page, aid, key)
    pages = pdf_pages(page, aid, only=[2, 3, 4, 6, 8, 9])
    by_sheet = {}
    for texts in pages:
        foot = next((t['text'] for t in texts if re.search(r'Feuille \d+ / \d+', t['text']) and 'Page' in t['text']), '')
        no = int(re.search(r'Feuille (\d+) /', foot).group(1)) if foot else None
        by_sheet.setdefault(no, []).append(texts)
    assert set(by_sheet) >= {2, 3, 4, 6, 8, 9}, sorted(k for k in by_sheet if k)

    # V4 — feuille de tournée (F2) : en-tête en bandeau bleu, textes blancs ; autres feuilles : en-tête blanc
    org = lambda texts: next(t for t in texts if t['text'].startswith('OFFICE DE L'))
    assert org(by_sheet[2][0])['rgb'] == [255, 255, 255], 'F2 : « OFFICE DE L’EAU DE GUYANE » en blanc sur le bandeau'
    assert near(org(by_sheet[4][0])['rgb'], NAVY), 'F4 : en-tête blanc à textes bleu marine'
    # F3 et F9 : grand bandeau « Station NOM » (nom en grand corps) portant le titre de la feuille (surtitre)
    for no in (3, 9):
        first = by_sheet[no][0]
        big = [t for t in first if t['text'] == 'ATHANASE']
        assert big and max(t['size'] for t in big) >= 24, f'F{no} : grand bandeau « Station ATHANASE » absent ({[t["size"] for t in big]})'
        assert any(t['text'].startswith('Feuille') or t['text'] == f'{no} / 9' for t in first), f'F{no} : pastille « Feuille {no} / 9 »'

    # V5 — libellés des tableaux en bleu marine (F3 vert, F6 violet, F8 A), brun pour la partie B de F8 (cuivre) ; seuls
    # les numéros prennent la couleur de la feuille
    labels = js(page, """const items = (await import('./js/domain/grids.js')).allItems(A.effectiveGrid(store.get('audit', arg.id)));
        const pick = prefix => items.filter(i => i.id.startsWith(prefix) && i.id.endsWith('@' + arg.key) && /^[^\\d₀-₉]{4,24}$/.test(i.label || '')).map(i => i.label);
        return { 3: pick('it-F3-'), 6: pick('it-F6-'), A: pick('it-F8-A'), B: pick('it-F8-B') };""", {'id': aid, 'key': key})

    def label_colors(no, names):
        found = [t['rgb'] for texts in by_sheet[no] for t in texts if t['text'] in names]
        assert len(found) >= 2, f'F{no} : libellés {names[:4]} introuvables'
        return found
    for no, names, ink in ((3, labels['3'], NAVY), (6, labels['6'], NAVY), (8, labels['A'], NAVY), (8, labels['B'], RUST_INK)):
        bad = [c for c in label_colors(no, names) if not near(c, ink)]
        assert not bad, f'F{no} : libellés de couleur {bad[:3]} au lieu de {ink}'

    # V8 — jamais de « : » isolé (jeton seul, donc susceptible de commencer une ligne)
    lone = [(no, t['text']) for no, pp in by_sheet.items() for texts in pp for t in texts if t['text'].strip() in (':', ';')]
    assert not lone, f'« : » isolé dans le PDF : {lone[:5]}'
    # … et le retour à la ligne générique du moteur PDF ne commence jamais une ligne par « : »
    wrapped = js(page, """const { PDFDocument } = await import('./js/formats/pdf.js');
        const d = new PDFDocument({ autoFirstPage: false });
        const w = d.width('Mesures manquantes et cause', 'regular', 10) + 2;
        return d.wrap('Mesures manquantes et cause : ……', 'regular', 10, w);""")
    assert all(not line.lstrip().startswith(':') for line in wrapped), wrapped


@pytest.mark.lent
def test_pdf_tournee_modifiee_apres_signature(page, app_url):
    """P5 : PDF d'une tournée signée puis modifiée avec motif — empreinte du contenu IMPRIMÉ (dernier amendement) en
    pied de page, mention « modifié après signature », récapitulatif des modifications dans la synthèse."""
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO', ['pres-BIO-2026-09271503'])
    aid = tour['id']
    answer_required(page, aid)
    seal = js(page, """let a = store.get('audit', arg);
        await A.updateAudit(a, x => { x.responses['it-F2-2.2'] = { ...(x.responses['it-F2-2.2'] || {}), status: 'C', value: 4 }; });
        await A.finishAudit(store.get('audit', arg));
        await A.signAudit(store.get('audit', arg), 'auditor', { name: 'Admin Test', fn: 'Contrôleur' });
        await A.signAudit(store.get('audit', arg), 'provider', { name: 'Jean Prest', fn: 'Chef d’équipe' });
        a = await A.lockAudit(store.get('audit', arg));
        const sealed = a.lock.contentHash;
        await A.updateAudit(store.get('audit', arg), x => { x.responses['it-F2-2.2'].value = 5; }, { reason: 'Erreur de saisie de l’effectif' });
        await A.updateAudit(store.get('audit', arg), x => { x.sheets = x.sheets || {}; x.sheets['2'] = { ...(x.sheets['2'] || {}), observations: 'Ajout après signature.' }; }, { reason: 'Complément demandé' });
        return { sealed, v: await A.verifyAuditSeal(store.get('audit', arg)) };""", aid)
    v = seal['v']
    assert v['ok'] and v['amendments'] == 2 and v['current'] != seal['sealed'], v

    pages = pdf_pages(page, aid)
    feet = [next((t['text'] for t in texts if 'Page ' in t['text'] and 'Empreinte' in t['text']), '') for texts in pages]
    assert all(feet), 'pied de page d’identification sur chaque page'
    for f in feet:
        assert f'Empreinte {v["current"][:12]}' in f, f'empreinte du contenu imprimé attendue : {f}'
        assert seal['sealed'][:12] not in f, f'empreinte d’origine (contenu signé) sous un contenu modifié : {f}'
    flags = [t for texts in pages for t in texts if t['text'] == 'MODIFIÉ APRÈS SIGNATURE']
    assert len(flags) == len(pages), 'mention « MODIFIÉ APRÈS SIGNATURE » en pied de chaque page'
    # Contenu imprimé = contenu modifié
    assert any(t['text'] == 'Ajout après signature.' for texts in pages for t in texts)

    synth = [t['text'] for texts in pages[-3:] for t in texts]
    joined = '\n'.join(synth)
    assert 'Modifications après signature (2)' in synth, 'rubrique des modifications dans la synthèse'
    assert 'Empreinte à la signature' in synth and seal['sealed'] in synth, 'empreinte scellée rappelée'
    assert v['current'] in synth, 'empreinte du contenu imprimé dans la synthèse'
    assert 'Erreur de saisie de l’effectif' in joined and 'Complément demandé' in joined, 'motifs des modifications'
    assert 'Admin Test (Administrateur)' in synth, 'auteur et profil de chaque modification'
    assert re.search(r'Effectif total — valeur : 4 -> 5', joined), 'valeurs avant -> après'
    assert re.search(r'Feuille 2 — observations : \(vide\) -> Ajout après signature\.', joined)
    assert re.search(r'Modifiée après signature : 2 modification\(s\)', joined), 'mention sous les signatures'
    assert 'Toute modification ultérieure est historisée' not in joined
