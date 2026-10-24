"""Coordonnées UTM 22N / 21N (demande de l'OEG du 14/10/2026 : « Pour les coordonnées, ajouter le choix UTM 22N et
UTM 21N et faire la conversion si UTM 21N est sélectionné en UTM 22N »).

Station « AV St Laurent » (eaux littorales, SANDRE 60007489) : X 167202 / Y 619395 en RGFG95 / UTM 22N, soit
X 831991,13 / Y 619390,88 en UTM 21N (point de contrôle de l'étude, implémentation de Krüger indépendante = PROJ).

  1. test_station_coordonnees_utm21n (tablette 1280 × 800 puis téléphone 390 × 844) : « Modifier la station » —
     choix « UTM 22N (RGFG95) » par défaut / « UTM 21N » ; passer en 21N garde la position (X / Y convertis à l'écran) ;
     X / Y d'UTM 21N laissés en « UTM 22N » : avertissement et enregistrement refusé ; point hors de la Guyane refusé ;
     saisie 21N (virgule, espaces) convertie, affichée et enregistrée en 22N avec la saisie d'origine (srs, x21, y21),
     aussi pour un point de prélèvement ; fiche station : « saisi en UTM 21N : … » ; retour en 22N : saisie d'origine
     retirée ; aucun défilement horizontal.
  2. test_feuille_coordonnees_utm21n (tablette puis téléphone) : critère F3.15 « Coordonnées GPS des points de
     prélèvement » (tableau ou carte) — système 21N : conversion affichée dès que X et Y sont saisis, valeur enregistrée
     en 22N avec la saisie d'origine, aucune alerte d'éloignement ; mêmes X / Y en 22N : avertissement « Choisissez
     « UTM 21N » », alerte d'éloignement et avertissement du contrôle avant clôture ; passer en 21N les convertit ;
     bouton GPS de la tablette : UTM 22N directement (équivalent 21N affiché en mode 21N) ; relevé hors de la Guyane
     signalé ; PDF des fiches : « saisi en UTM 21N : … ».
  3. test_import_tournee_signee_et_echange : import de stations (colonnes « X », « Y », « Fuseau UTM » ; fuseau
     reconnu d'après X ; latitude / longitude seules) ; tournée signée et verrouillée jamais modifiée (choix et champs
     désactivés, scellé intact) ; le fichier d'échange transporte la station et les saisies en 21N vers l'autre
     tablette (scellé identique), et le retour en 22N fait sur l'autre tablette revient sans la saisie d'origine.
"""
import pytest

from helpers import EXCHANGE_PASSWORD, PASSWORD, create_tour, goto_hash, js, open_setup, setup_standalone, wait_view
from test_echange_tablettes import receive, send, tablet
from test_reseaux import import_sites
from test_tablette_partagee import attr, pdf_texts

TABLET = {'width': 1280, 'height': 800}
PHONE = {'width': 390, 'height': 844}
NO_OVERFLOW = '() => document.documentElement.scrollWidth <= window.innerWidth + 1'
KEY = '60007489'
SITE = f'site-{KEY}'
ITEM = f'it-F3-15@{KEY}'
# Position de la tablette simulée sur la station (WGS84) : X 167202 / Y 619395 en UTM 22N.
ST_LAURENT = {'latitude': 5.595981, 'longitude': -54.003638, 'accuracy': 9}


def site(page, site_id=SITE):
    return js(page, "return store.get('site', arg);", site_id)


def value(page, audit_id, item=ITEM):
    return js(page, "return ((store.get('audit', arg.id).responses || {})[arg.item] || {}).value ?? null;", {'id': audit_id, 'item': item})


def wait_value(page, audit_id, expected, item=ITEM):
    """Attend que la valeur enregistrée (sans les champs du relevé GPS) soit `expected`."""
    page.wait_for_function("""([id, item, v]) => {
        const r = (window.AuditApp.store.get('audit', id).responses || {})[item] || {};
        const { lat, lon, accuracy, at, ...rest } = r.value || {};
        return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]])) === JSON.stringify(Object.keys(v).sort().map(k => [k, v[k]]));
    }""", arg=[audit_id, item, expected])


def visible(page, ids):
    """Premier élément visible parmi des identifiants (tableau « t- » ≥ 1100 px, carte « k- » en dessous)."""
    for i in ids:
        loc = page.locator(f'[id={attr(i)}]')
        if loc.count() and loc.first.is_visible():
            return loc.first
    raise AssertionError(f'aucun élément visible parmi {ids}')


def xy_controls(page, item=ITEM):
    srs = visible(page, [f't-{item}-srs', f'k-{item}-srs'])
    pfx = srs.get_attribute('id').split('-')[0]
    return srs, page.locator(f'[id={attr(f"{pfx}-{item}-x")}]'), page.locator(f'[id={attr(f"{pfx}-{item}-y")}]'), pfx


def type_xy(page, audit_id, x, y, expected):
    _, ix, iy, _ = xy_controls(page)
    ix.fill(x)
    ix.press('Tab')
    page.wait_for_function("([id, item]) => ((window.AuditApp.store.get('audit', id).responses || {})[item] || {}).value !== undefined", arg=[audit_id, ITEM])
    _, ix, iy, _ = xy_controls(page)
    iy.fill(y)
    iy.press('Tab')
    wait_value(page, audit_id, expected)


def item_area(page, item=ITEM):
    return visible(page, [f'row-{item}', f'card-{item}'])


def far_alerts(page, audit_id, item=ITEM):
    return js(page, "return A.auditState(store.get('audit', arg.id)).alerts.filter(a => a.code === 'GPS_XY_FAR' && a.itemId === arg.item).map(a => a.message);", {'id': audit_id, 'item': item})


def value_warnings(page, audit_id):
    return js(page, "return A.auditState(store.get('audit', arg)).validation.filter(v => v.level === 'warning' && /UTM|Guyane/.test(v.message)).map(v => v.message);", audit_id)


def toast(page):
    return page.inner_text('#toast-root')


def clear_toasts(page):
    page.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
@pytest.mark.parametrize('vp', [TABLET, PHONE], ids=['tablette', 'telephone'])
def test_station_coordonnees_utm21n(make_page, app_url, vp):
    page = make_page(viewport=vp)
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    before = site(page)
    assert (before['x'], before['y']) == (167202, 619395) and 'srs' not in before
    goto_hash(page, f'#/station/{SITE}/modifier')
    assert page.input_value('#seSrs') == '22N', 'UTM 22N (RGFG95) par défaut'
    assert page.eval_on_selector_all('#seSrs option', 'os => os.map(o => [o.value, o.textContent])') == [['22N', 'UTM 22N (RGFG95)'], ['21N', 'UTM 21N']]
    assert (page.input_value('[name=x]'), page.input_value('[name=y]')) == ('167202', '619395')

    # Passer en UTM 21N garde la position : X / Y convertis à l'écran, conversion en 22N affichée.
    page.select_option('#seSrs', '21N')
    page.wait_for_function("() => document.querySelector('#seXYConv').dataset.state === 'conv'")
    assert (page.input_value('[name=x]'), page.input_value('[name=y]')) == ('831991', '619391')
    assert page.inner_text('#seXYConv') == '→ RGFG95 / UTM 22N : X 167202 · Y 619395 (valeurs enregistrées)'
    page.select_option('#seSrs', '22N')
    page.wait_for_function("() => document.querySelector('[name=x]').value === '167202'")
    assert page.input_value('[name=y]') == '619395' and page.inner_text('#seXYConv') == ''

    # X / Y d'UTM 21N (Charvein) laissés en « UTM 22N » : avertissement, enregistrement refusé.
    page.fill('[name=x]', '845698')
    page.fill('[name=y]', '616125')
    page.wait_for_function("() => document.querySelector('#seXYConv').dataset.state === 'warn'")
    warn = page.inner_text('#seXYConv')
    assert 'coordonnées d’UTM 21N ? Choisissez « UTM 21N » pour les convertir en UTM 22N (X 180873 · Y 615990)' in warn, warn
    page.fill('[name=reason]', 'Coordonnées issues de la carte de l’ouest guyanais')
    page.click('#seForm button[type=submit]')
    page.wait_for_function("() => document.querySelector('#toast-root').textContent.includes('coordonnées d’UTM 21N')")
    assert page.evaluate('location.hash') == f'#/station/{SITE}/modifier' and site(page)['x'] == 167202, 'rien n’est enregistré'
    clear_toasts(page)

    # « UTM 21N » choisi avec des X / Y d'UTM 22N : point hors de la Guyane, refusé.
    page.select_option('#seSrs', '21N')
    page.fill('[name=x]', '164412')
    page.fill('[name=y]', '608596')
    page.wait_for_function("() => document.querySelector('#seXYConv').textContent.includes('hors de la Guyane')")
    page.click('#seForm button[type=submit]')
    page.wait_for_function("() => document.querySelector('#toast-root').textContent.includes('hors de la Guyane')")
    assert site(page)['x'] == 167202
    clear_toasts(page)

    # Saisie en UTM 21N (virgule décimale, espaces) : convertie, affichée et enregistrée en 22N, saisie d'origine gardée.
    page.fill('[name=x]', '831 991,13')
    page.fill('[name=y]', '619390,88')
    page.wait_for_function("() => document.querySelector('#seXYConv').dataset.state === 'conv'")
    assert 'X 167202 · Y 619395' in page.inner_text('#seXYConv')
    page.click('[data-act=spAdd]')
    row = page.locator('.se-sp-row').last
    row.locator('[data-sp=label]').fill('Prélèvement rive gauche')
    assert row.locator('[data-sp=srs]').input_value() == '22N'
    row.locator('[data-sp=srs]').select_option('21N')
    row.locator('[data-sp=x]').fill('831940')
    row.locator('[data-sp=y]').fill('619420')
    page.wait_for_function("() => [...document.querySelectorAll('.se-sp-row [data-sp=conv]')].pop().dataset.state === 'conv'")
    assert 'X 167151 · Y 619425' in row.locator('[data-sp=conv]').inner_text()
    assert page.evaluate(NO_OVERFLOW), 'aucun défilement horizontal (fiche de la station)'
    page.click('#seForm button[type=submit]')
    page.wait_for_function(f"() => location.hash === '#/station/{SITE}'")
    s = site(page)
    assert (s['x'], s['y'], s['srs'], s['x21'], s['y21']) == (167202, 619395, '21N', 831991.13, 619390.88), s
    assert abs(s['lat'] - 5.595981) < 2e-6 and abs(s['lon'] + 54.003638) < 2e-6, (s['lat'], s['lon'])
    pt = s['samplingPoints'][0]
    assert (pt['x'], pt['y'], pt['srs'], pt['x21'], pt['y21'], pt['label']) == (167151, 619425, '21N', 831940, 619420, 'Prélèvement rive gauche'), pt
    trail = js(page, "return store.all('trail').filter(t => t.entityId === arg).map(t => t.reason);", SITE)
    assert 'Coordonnées issues de la carte de l’ouest guyanais' in trail, trail
    # Fiche de la station : X / Y en RGFG95 / UTM 22N et saisie d'origine.
    text = page.text_content('#view')
    assert 'saisi en UTM 21N : X 831991 · Y 619391' in text and '167202' in text

    # Nouvelle modification : le formulaire rouvre la saisie d'origine ; retour en 22N : saisie d'origine retirée.
    goto_hash(page, f'#/station/{SITE}/modifier')
    assert page.input_value('#seSrs') == '21N'
    assert (page.input_value('[name=x]'), page.input_value('[name=y]')) == ('831991.13', '619390.88')
    row = page.locator('.se-sp-row').first
    assert row.locator('[data-sp=srs]').input_value() == '21N' and row.locator('[data-sp=x]').input_value() == '831940'
    page.select_option('#seSrs', '22N')
    page.wait_for_function("() => document.querySelector('[name=x]').value === '167202'")
    page.fill('[name=reason]', 'Retour au RGFG95 / UTM 22N')
    page.click('#seForm button[type=submit]')
    page.wait_for_function(f"() => location.hash === '#/station/{SITE}'")
    s = site(page)
    assert (s['x'], s['y']) == (167202, 619395) and not any(k in s for k in ('srs', 'x21', 'y21')), s
    assert s['samplingPoints'][0]['srs'] == '21N', 'point de prélèvement : saisi en 21N, inchangé'


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
@pytest.mark.parametrize('vp', [TABLET, PHONE], ids=['tablette', 'telephone'])
def test_feuille_coordonnees_utm21n(make_page, app_url, vp):
    page = make_page(viewport=vp, geolocation=ST_LAURENT)
    setup_standalone(page, app_url, name='Alice Dupont', username='adupont')
    tour = create_tour(page, 'ce', [SITE], 'prov-TL1')
    aid = tour['id']
    goto_hash(page, f'#/audit/{aid}/feuille-3@{KEY}')
    srs, ix, iy, pfx = xy_controls(page)
    assert pfx == ('t' if vp is TABLET else 'k'), 'tableau sur tablette, carte sur téléphone'
    assert srs.input_value() == '22N' and srs.evaluate('s => [...s.options].map(o => o.textContent)') == ['UTM 22N (RGFG95)', 'UTM 21N']

    # Système « UTM 21N » : conversion affichée dès que X et Y sont saisis, valeur enregistrée en 22N + saisie d'origine.
    srs.select_option('21N')
    wait_value(page, aid, {'srs': '21N'})
    assert 'conversion en RGFG95 / UTM 22N dès que X et Y sont saisis' in item_area(page).inner_text()
    type_xy(page, aid, '831991', '619391', {'srs': '21N', 'x21': 831991, 'y21': 619391, 'x': 167202, 'y': 619395})
    srs, ix, iy, _ = xy_controls(page)
    assert (ix.input_value(), iy.input_value()) == ('831991', '619391'), 'les champs gardent la saisie en UTM 21N'
    assert 'UTM 21N' in ix.get_attribute('aria-label')
    area = ' '.join(item_area(page).inner_text().split())
    assert '→ RGFG95 / UTM 22N : X 167202 · Y 619395' in area, area
    assert far_alerts(page, aid) == [] and value_warnings(page, aid) == [], 'position convertie : sur la station'
    assert page.evaluate(NO_OVERFLOW), 'aucun défilement horizontal (feuille 3)'

    # Retour en « UTM 22N » : X / Y (22N) conservés ; les mêmes X / Y d'UTM 21N saisis en 22N sont signalés.
    srs.select_option('22N')
    wait_value(page, aid, {'x': 167202, 'y': 619395})
    srs, ix, iy, _ = xy_controls(page)
    assert (ix.input_value(), iy.input_value()) == ('167202', '619395')
    type_xy(page, aid, '831991', '619391', {'x': 831991, 'y': 619391})
    warn = page.locator('.as-xy-warn >> visible=true')
    assert 'coordonnées d’UTM 21N ? Choisissez « UTM 21N » pour les convertir en UTM 22N (X 167202 · Y 619395)' in warn.inner_text()
    assert len(far_alerts(page, aid)) == 1, 'alerte d’éloignement de la station'
    assert any('Choisissez « UTM 21N »' in w for w in value_warnings(page, aid)), 'avertissement du contrôle avant clôture'
    # « UTM 21N » : les X / Y saisis sont repris comme saisie 21N et convertis.
    srs, _, _, _ = xy_controls(page)
    srs.select_option('21N')
    wait_value(page, aid, {'srs': '21N', 'x21': 831991, 'y21': 619391, 'x': 167202, 'y': 619395})
    page.wait_for_selector('.as-xy-warn >> visible=true', state='detached')
    assert far_alerts(page, aid) == [] and value_warnings(page, aid) == []
    clear_toasts(page)

    # Bouton GPS : la tablette donne directement l'UTM 22N (équivalent 21N affiché en mode 21N).
    item_area(page).locator('[data-act=gps-fill]').click()
    page.wait_for_function("([id, item]) => !!((window.AuditApp.store.get('audit', id).responses || {})[item] || {}).value?.at", arg=[aid, ITEM])
    v = value(page, aid)
    assert (v['x'], v['y'], v['srs'], v['x21'], v['y21'], v['accuracy']) == (167202, 619395, '21N', 831991, 619391, 9), v
    assert abs(v['lat'] - 5.595981) < 1e-6 and abs(v['lon'] + 54.003638) < 1e-6
    page.wait_for_function("() => document.querySelector('#toast-root').textContent.includes('Position relevée (RGFG95 / UTM 22N) : X 167202 · Y 619395')")
    assert 'Relevé GPS' in item_area(page).inner_text()
    clear_toasts(page)
    # Relevé hors de la Guyane (GPS non calé, appareil ailleurs) : signalé tout de suite et sous les champs.
    page.context.set_geolocation({'latitude': 48.8566, 'longitude': 2.3522, 'accuracy': 15})
    item_area(page).locator('[data-act=gps-fill]').click()
    page.wait_for_function("() => document.querySelector('#toast-root .toast.warn')?.textContent.includes('hors de la Guyane')")
    assert 'hors de la Guyane' in page.locator('.as-xy-warn >> visible=true').inner_text()
    page.context.set_geolocation(ST_LAURENT)
    clear_toasts(page)
    item_area(page).locator('[data-act=gps-fill]').click()
    page.wait_for_function("([id, item]) => ((window.AuditApp.store.get('audit', id).responses || {})[item] || {}).value?.x === 167202", arg=[aid, ITEM])
    page.wait_for_selector('.as-xy-warn >> visible=true', state='detached')

    if vp is TABLET:
        texts = pdf_texts(page, "const { generateSheetsPdf } = await import('./js/app/sheets-pdf.js'); await generateSheetsPdf({ auditId: arg });", aid)
        joined = ' '.join(texts)
        assert 'saisi en UTM 21N : X 831991 · Y 619391' in joined, 'PDF des fiches : saisie d’origine'


# ---------------------------------------------------------------------------------------------------------------
V21 = {'srs': '21N', 'x21': 831991, 'y21': 619391, 'x': 167202, 'y': 619395}


@pytest.mark.lent
def test_import_tournee_signee_et_echange(make_page, app_url, tmp_path):
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')

    # ----- Import de stations : « Fuseau UTM » explicite, fuseau reconnu d'après X, latitude / longitude seules
    rows = [['Code', 'Nom', 'X', 'Y', 'Fuseau UTM', 'Latitude', 'Longitude'],
            [KEY, 'AV St Laurent', '831991', '619391', 'UTM 21N', '', ''],
            ['BSS002NVHK', 'Charvein', '845698', '616125', '', '', ''],
            ['BSS002PANK', 'AEP Maripasoula', '', '', '', '3.638634', '-54.032295'],
            ['NEWUTM', 'Point hors Guyane', '500000', '442736', '22N', '', '']]
    r = import_sites(t1, 'stations-utm.csv', rows)
    assert {k: r['mapping'][k] for k in ('x', 'y', 'srs', 'lat', 'lon')} == {'x': 2, 'y': 3, 'srs': 4, 'lat': 5, 'lon': 6}, r['mapping']
    w = {p['code']: ' '.join(p['warnings']) for p in r['preview']}
    assert 'converties en RGFG95 / UTM 22N : X 167202 · Y 619395' in w[KEY], w
    assert 'fuseau reconnu d’après X' in w['BSS002NVHK'] and 'X 180873 · Y 615990' in w['BSS002NVHK'], w
    assert 'hors de la Guyane' in w['NEWUTM'], w
    s = site(t1)
    assert {k: s.get(k) for k in V21} == V21, s
    c = site(t1, 'site-BSS002NVHK')
    assert (c['x'], c['y'], c['srs'], c['x21'], c['y21']) == (180873, 615990, '21N', 845698, 616125), c
    m = site(t1, 'site-BSS002PANK')
    assert (m['x'], m['y']) == (163100, 402750) and 'srs' not in {k for k, v in m.items() if v is not None}, m

    # ----- Tournée en cours : F3.15 saisi en UTM 21N ; tournée signée et verrouillée : jamais modifiée
    tour = create_tour(t1, 'ce', [SITE], 'prov-TL1')
    goto_hash(t1, f'#/audit/{tour["id"]}/feuille-3@{KEY}')
    srs, _, _, _ = xy_controls(t1)
    srs.select_option('21N')
    wait_value(t1, tour['id'], {'srs': '21N'})
    type_xy(t1, tour['id'], '831991', '619391', V21)
    signed = create_tour(t1, 'ce', [SITE], 'prov-TL1')
    seal = js(t1, """const C = await import('./js/domain/coords.js');
        let a = store.get('audit', arg);
        let v = C.withSrs({}, '21N'); v = C.withXYEntry(v, 'x', 831991); v = C.withXYEntry(v, 'y', 619391);
        await A.setResponse(a, 'it-F3-15@60007489', { value: v, status: 'C' });
        a = await A.signAudit(store.get('audit', arg), 'auditor', { name: session.user.name });
        a = await A.signAudit(store.get('audit', arg), 'provider', { name: 'Représentant', refused: true, comment: 'absent' });
        await A.lockAudit(store.get('audit', arg));
        const s = await A.verifyAuditSeal(store.get('audit', arg));
        return { ok: s.ok, sealed: s.sealed, rev: store.get('audit', arg)._rev };""", signed['id'])
    assert seal['ok'], seal
    goto_hash(t1, f'#/audit/{signed["id"]}/feuille-3@{KEY}')
    srs, ix, iy, _ = xy_controls(t1)
    assert srs.is_disabled() and ix.is_disabled() and iy.is_disabled() and srs.input_value() == '21N'
    assert item_area(t1).locator('[data-act=gps-fill]').count() == 0, 'pas de relevé GPS sur une tournée verrouillée'
    assert '→ RGFG95 / UTM 22N : X 167202 · Y 619395' in ' '.join(item_area(t1).inner_text().split())
    after = js(t1, "const s = await A.verifyAuditSeal(store.get('audit', arg)); return { ok: s.ok, sealed: s.sealed, rev: store.get('audit', arg)._rev };", signed['id'])
    assert after == seal, 'affichage sans aucune écriture : scellé intact'

    # ----- Fichier d'échange : station et saisies en UTM 21N transportées vers l'autre tablette
    f1 = send(t1, tmp_path)
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(f1))
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    t2.click('#extraForm [data-act=extra-pick][data-u=adupont]')
    t2.fill('#extraForm [name=password]', PASSWORD)
    t2.fill('#extraForm [name=password2]', PASSWORD)
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    wait_view(t2)
    s2 = site(t2)
    assert {k: s2.get(k) for k in V21} == V21, s2
    assert site(t2, 'site-BSS002NVHK')['x21'] == 845698
    assert value(t2, tour['id']) == V21
    assert value(t2, signed['id']) == V21
    seal2 = js(t2, "const s = await A.verifyAuditSeal(store.get('audit', arg)); return { ok: s.ok, sealed: s.sealed };", signed['id'])
    assert seal2 == {'ok': True, 'sealed': seal['sealed']}, 'tournée signée : scellé identique sur l’autre tablette'
    goto_hash(t2, f'#/audit/{tour["id"]}/feuille-3@{KEY}')
    srs, ix, iy, _ = xy_controls(t2)
    assert srs.input_value() == '21N' and (ix.input_value(), iy.input_value()) == ('831991', '619391')

    # ----- Retour en UTM 22N sur la tablette 2, renvoyé à la tablette 1 : saisie d'origine retirée là aussi
    srs.select_option('22N')
    wait_value(t2, tour['id'], {'x': 167202, 'y': 619395})
    f2 = send(t2, tmp_path)
    _, report = receive(t1, f2)
    assert 'conflit' not in report, report
    assert value(t1, tour['id']) == {'x': 167202, 'y': 619395}
    assert js(t1, "const s = await A.verifyAuditSeal(store.get('audit', arg)); return s.ok;", signed['id']) is True
