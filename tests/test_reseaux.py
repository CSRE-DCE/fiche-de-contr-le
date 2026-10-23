"""Réseaux de surveillance et turbidité en NTU (référentiel « Réseaux », migrations, imports, fusion, sceaux), Playwright.

  1. Installation : cinq réseaux par défaut (identifiants net-<code>, contenu déterministe), unité NTU, grilles par
     défaut en NTU (CT-2026 1.1).
  2. Mise à niveau d'une tablette ancienne (upgradeReferentiel2026) : réseaux et unité NTU installés, réseau créé pour un
     code utilisé inconnu, grilles enregistrées FNU / 1.0 mises à niveau (journal, file d'envoi), aucune station
     réécrite ; garde-fous AVANT la migration (nouvelle tournée et fiches vierges en NTU) ; tournée signée en FNU :
     instantané, empreinte et sceau intacts ; idempotence (aucune écriture, aucune entrée de journal) ; réseau
     supprimé jamais recréé.
  3. Référentiels › Réseaux de surveillance : liste triée (pastille, nombre de stations), code non modifiable,
     suppression refusée tant que le réseau est utilisé ; modification de station : cases à cocher et « Autres
     réseaux » normalisés (réseau inconnu ajouté au référentiel) ; campagne : réseau choisi dans la liste.
  4. Import de sites : colonne non associée sans effacement (réseaux, commune, bassin, masse d'eau, coordonnées), codes
     normalisés, station sur deux lignes (cumul), code inconnu signalé puis créé à l'application.
  5. Deux tablettes (échange par fichier) : réseaux d'une station modifiés des deux côtés (ajout d'un côté, retrait de
     l'autre) fusionnés sans conflit ; grille FNU envoyée par une tablette non mise à niveau : ni conflit, ni retour.
  6. Accueil rangé par réseau : sections BIO 38 / Chimie 15 / RCO 25 / EL 29 / ESO 17 ; station 09160201 dans BIO et
     dans Chimie (« Aussi : … ») ; « 108 stations affichées » (stations distinctes) ; recherche instantanée (sections
     vides masquées, effectifs mis à jour) ; filtre et rangement mémorisés PAR AGENT (pas appliqués à l'agent suivant
     après « Changer d'agent ») ; « Effacer les filtres » ; rangement par statut : DOM historique ; téléphone sans
     défilement horizontal.
  7. Carte (?reseau=EL, info-bulle « Réseaux : BIO, Chimie »), création de tournée (?reseau=EL ; jamais filtrée par la
     préférence de l'accueil ; recherche conservée), fiche station et feuille 1 (pastilles BIO et Chimie), planning
     (filtre Réseau dans les Filtres repliés, badge du réseau du programme), modification de la station 60007480
     (sections de l'accueil mises à jour).
  8. Documents : PDF de la fiche station 09160201 (BIO et Chimie avant la silhouette ; pas sur F3 / F9), rapport
     (colonne « Réseaux »), exports (stations, stations par réseau), tableau de bord (stations contrôlées par réseau,
     total distinct ; lien d'une campagne vers le planning).
"""
import json

import pytest

from helpers import ATHANASE, EXCHANGE_PASSWORD, PASSWORD, answer_required, create_tour, goto_hash, js, open_setup, setup_standalone, unlock, wait_view
from test_affichage import OVERFLOW, PHONE
from test_parcours import pdf_texts, sign_and_lock
from test_tablette_partagee import add_agent, login, switch_agent

ACAROUANY, MATARONI, SAKOURA = 'site-09160201', 'site-60007480', 'site-09281718'

# Grilles par défaut repassées « avant NTU » (tablette ancienne) : turbidité en FNU, CT-2026 en version 1.0.
OLD_GRIDS = """const fnu = v => { if (Array.isArray(v)) v.forEach(fnu); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'unit' && x === 'NTU') v[k] = 'FNU'; else fnu(x); } };
    for (const id of ['grid-ct-2026-v1', 'grid-prel-eau-general-v1']) {
      const g = structuredClone(store.get('grid', id)); fnu(g.sections);
      if (id === 'grid-ct-2026-v1') g.version = '1.0';
      await store.put('grid', g, { reason: 'Test : grille d’une tablette ancienne' });
    }"""


def grid_units(page, grid_id, item_id):
    """Unités (champ, puis sous-champs) d'un critère de la grille enregistrée."""
    return js(page, """const { itemIndex } = await import('./js/domain/grids.js');
        const it = itemIndex(store.get('grid', arg[0])).get(arg[1]);
        return [it.unit || null, ...((it.input && it.input.fields) || []).map(f => f.unit)].filter(Boolean);""", [grid_id, item_id])


def outbox(page):
    return js(page, "await store.flush(); const { idb } = await import('./js/core/db.js'); return (await idb.keys('outbox')).map(String).sort();")


def upgrade(page):
    return js(page, "return (await import('./js/app/bootstrap.js')).upgradeReferentiel2026();")


def sites_networks(page):
    return js(page, "return Object.fromEntries(store.all('site').map(s => [s.id, s.networks]));")


# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.lent
def test_installation_et_mise_a_niveau(page, app_url):
    setup_standalone(page, app_url)
    # ----- 1. Installation : réseaux par défaut, unité NTU, grilles en NTU
    nets = js(page, """const { defaultNetworks } = await import('./js/domain/networks.js');
        const strip = ({ id, code, label, description, color, order, auditTypes, active }) => ({ id, code, label, description, color, order, auditTypes, active });
        return { stored: store.all('network').map(strip).sort((a, b) => a.order - b.order), defaults: defaultNetworks() };""")
    assert nets['stored'] == nets['defaults'], 'réseaux par défaut installés tels quels'
    assert [n['id'] for n in nets['stored']] == ['net-BIO', 'net-Chimie', 'net-RCO', 'net-EL', 'net-ESO']
    assert js(page, "return store.get('unit', 'unit-NTU');")['symbol'] == 'NTU'
    assert js(page, "return store.get('grid', 'grid-ct-2026-v1').version;") == '1.1'
    assert grid_units(page, 'grid-ct-2026-v1', 'it-F4-9') == ['NTU', 'NTU', 'NTU']
    assert grid_units(page, 'grid-prel-eau-general-v1', 'it-V08') == ['NTU']
    assert upgrade(page)['upgraded'] is False, 'installation récente : déjà à jour'

    # ----- 2. Tablette ancienne simulée : référentiel « Réseaux » et unité NTU absents, grilles en FNU / 1.0,
    # station portant un code inconnu, tournée signée avec la grille FNU.
    js(page, OLD_GRIDS)
    js(page, """store._map('network').clear(); store._map('unit').delete('unit-NTU');
        await store.put('site', { ...structuredClone(store.get('site', 'site-09271503')), id: 'site-TEST1', code: 'TEST1', name: 'Station test', networks: ['TEST', 'BIO'], types: ['bio'] }, { reason: 'Test' });""")
    assert grid_units(page, 'grid-ct-2026-v1', 'it-F4-9') == ['FNU', 'FNU', 'FNU']

    # Tournée commencée avant la mise à jour (instantané FNU), signée et verrouillée sur la tablette.
    old = create_tour(page, 'ce', [SAKOURA], 'prov-TL1')
    js(page, """const { canonicalJSON, sha256Hex } = await import('./js/core/util.js');
        const a = structuredClone(store.get('audit', arg)), g = structuredClone(store.get('grid', 'grid-ct-2026-v1'));
        Object.assign(a, { gridSnapshot: g, gridVersion: g.version, gridSha256: await sha256Hex(canonicalJSON(g)) });
        a.responses['it-F4-9@09281718'] = { status: 'C', value: { t1: 3.1, t2: 3.3, t3: 3.2 }, at: new Date().toISOString(), by: session.user.id, byName: session.user.name };
        await store.put('audit', a, { reason: 'Test : tournée créée avant la mise à jour (turbidité en FNU)' });""", old['id'])
    answer_required(page, old['id'])
    sign_and_lock(page, old['id'])
    sealed = js(page, "const a = store.get('audit', arg); return { lock: a.lock.contentHash, sha: a.gridSha256, updatedAt: a.updatedAt, ok: (await A.verifyAuditSeal(a)).ok };", old['id'])
    assert sealed['ok']

    # Garde-fous AVANT la migration (aucune session administrateur depuis la mise à jour) : nouvelle tournée et fiches
    # vierges en NTU, alors que la grille enregistrée est encore en FNU.
    new = create_tour(page, 'ce', [SAKOURA], 'prov-TL1')
    snap = js(page, """const { itemIndex } = await import('./js/domain/grids.js'); const a = store.get('audit', arg);
        return { version: a.gridVersion, units: itemIndex(a.gridSnapshot).get('it-F4-9').input.fields.map(f => f.unit) };""", new['id'])
    assert snap == {'version': '1.1', 'units': ['NTU', 'NTU', 'NTU']}, snap
    blank = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateBlankSheetsPdf({ auditType: 'ce', siteIds: [arg] });", SAKOURA)
    assert any('NTU' in t for t in blank) and not any('FNU' in t for t in blank), 'fiches vierges en NTU'
    before_sites = sites_networks(page)
    box_before = set(outbox(page))

    # ----- Mise à niveau
    res = upgrade(page)
    assert res['upgraded'] and not res.get('error'), res
    assert res['networks'] == 5 and res['networksCreated'] == 1 and res['units'] == 1 and res['gridsUpgraded'] == 2, res
    after = js(page, "return store.all('network').map(n => [n.id, n.code, n.auditTypes]).sort();")
    assert ['net-TEST', 'TEST', []] in after and len(after) == 6, after
    assert js(page, "return store.get('grid', 'grid-ct-2026-v1').version;") == '1.1'
    assert grid_units(page, 'grid-ct-2026-v1', 'it-F4-9') == ['NTU', 'NTU', 'NTU']
    assert grid_units(page, 'grid-prel-eau-general-v1', 'it-V08') == ['NTU']
    assert sites_networks(page) == before_sites, 'aucune station réécrite'
    trail = js(page, "return store.all('trail').filter(t => t.entityType === 'grid' || t.entityType === 'network').map(t => [t.entityType, t.entityId || '', t.reason || '']);")
    assert any(t[0] == 'grid' and t[1] == 'grid-ct-2026-v1' and 'version 1.0 → 1.1' in t[2] for t in trail), trail
    assert any(t[0] == 'grid' and t[1] == 'grid-prel-eau-general-v1' and 'Turbidité exprimée en NTU' in t[2] for t in trail), trail
    box = set(outbox(page))
    assert {'grid:grid-ct-2026-v1', 'grid:grid-prel-eau-general-v1', 'network:net-BIO', 'network:net-TEST', 'unit:unit-NTU'} <= box, sorted(box - box_before)
    # Tournée signée en FNU : instantané, empreinte et sceau intacts ; jamais réécrite.
    kept = js(page, """const { itemIndex } = await import('./js/domain/grids.js'); const a = store.get('audit', arg);
        return { lock: a.lock.contentHash, sha: a.gridSha256, updatedAt: a.updatedAt, ok: (await A.verifyAuditSeal(a)).ok,
          units: itemIndex(a.gridSnapshot).get('it-F4-9').input.fields.map(f => f.unit), version: a.gridSnapshot.version };""", old['id'])
    assert kept == {**sealed, 'units': ['FNU', 'FNU', 'FNU'], 'version': '1.0'}, kept
    texts = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", old['id'])
    assert any('FNU' in t for t in texts) and not any('NTU' in t for t in texts), 'la tournée signée imprime l’unité signée (FNU)'
    assert not any('ATTENTION' in t for t in texts), 'sceau vérifié'
    js(page, "await A.setResponse(store.get('audit', arg), 'it-F4-9@09281718', { status: 'C', value: { t1: 2.5, t2: 2.6, t3: 2.4 } });", new['id'])
    texts = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", new['id'])
    assert any('NTU' in t for t in texts) and not any('FNU' in t for t in texts), 'nouvelle tournée : NTU'

    # ----- Idempotence : aucune écriture, aucune entrée de journal, rien de plus à envoyer
    n_trail, box = js(page, "await store.flush(); return store.all('trail').length;"), outbox(page)
    again = upgrade(page)
    assert again['upgraded'] is False and not again.get('error'), again
    assert js(page, "await store.flush(); return store.all('trail').length;") == n_trail
    assert outbox(page) == box
    # Réseau supprimé (pierre tombale) : jamais recréé, même s'il reste utilisé par une station.
    js(page, "await store.remove('network', 'net-TEST', 'Test : réseau supprimé');")
    assert upgrade(page)['upgraded'] is False
    assert js(page, "return store.getRaw('network', 'net-TEST')._deleted;") is True


# ---------------------------------------------------------------------------------------------------------------
def test_referentiel_reseaux_et_saisie(page, app_url):
    setup_standalone(page, app_url)
    # ----- Référentiels › Réseaux de surveillance : liste triée, pastille, nombre de stations
    goto_hash(page, '#/referentiels')
    assert 'Réseaux de surveillance' in page.inner_text('#view')
    goto_hash(page, '#/referentiel/network')
    titles = page.locator('#view .li .li-title').all_inner_texts()
    assert titles == ['BIO – Biologie (RCS ESC BIO)', 'Chimie – Chimie des cours d’eau', 'RCO – Réseau de contrôle opérationnel', 'EL – Eaux littorales', 'ESO – Eaux souterraines'], titles
    subs = page.locator('#view .li .li-sub').all_inner_texts()
    assert [s.split(' station')[0] for s in subs] == ['38', '15', '25', '29', '17'], subs
    assert page.locator('#view .li .net-dot').count() == 5
    # Modification : code en lecture seule ; libellé modifié
    page.click('#view .li[data-id="net-EL"]')
    page.click('.modal [data-act=edit]')
    page.wait_for_selector('#rf')
    assert page.get_attribute('#rf [name=code]', 'readonly') is not None
    page.eval_on_selector('#rf [name=code]', 'e => { e.value = "XX"; }')   # forcé : sans effet, le code ne se modifie pas
    page.fill('#rf [name=label]', 'Eaux littorales (DCE)')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('#rf', state='detached')
    el = js(page, "return store.get('network', 'net-EL');")
    assert el['code'] == 'EL' and el['label'] == 'Eaux littorales (DCE)' and el['auditTypes'] == ['ce']
    # Suppression refusée tant que le réseau est utilisé
    page.click('#view .li[data-id="net-BIO"]')
    page.click('.modal [data-act=del]')
    page.wait_for_selector('.toast.err')
    assert 'utilisé par 38 station(s)' in page.inner_text('.toast.err')
    assert js(page, "return !!store.get('network', 'net-BIO');")
    # Nouveau réseau : identifiant déterministe ; code déjà pris (casse) refusé ; suppression d'un réseau inutilisé
    page.click('#view [data-act=new]')
    page.wait_for_selector('#rf')
    page.fill('#rf [name=code]', 'chimie')
    page.fill('#rf [name=label]', 'Doublon')
    page.click('.modal [data-act=ok]')
    page.wait_for_function("() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Ce code existe déjà'))")
    page.fill('#rf [name=code]', 'PEST')
    page.fill('#rf [name=label]', 'Pesticides (test)')
    page.check('#rf [name=auditTypes][value=ce]')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('#rf', state='detached')
    pest = js(page, "return store.get('network', 'net-PEST');")
    assert pest['code'] == 'PEST' and pest['auditTypes'] == ['ce'] and pest['active'] is True, pest

    # ----- Modification de station : cases à cocher, « Autres réseaux » normalisés, réseau inconnu ajouté
    goto_hash(page, f'#/station/{MATARONI}/modifier')
    checked = page.eval_on_selector_all('#seForm [name=networks]:checked', 'els => els.map(e => e.value)')
    assert checked == ['RCO', 'EL'], checked
    assert page.locator('#seForm [name=networks][value=PEST]').count() == 1, 'réseau actif proposé'
    page.uncheck('#seForm [name=networks][value=EL]')
    page.fill('#seForm [name=networksOther]', 'chimie ; Côtier')
    page.fill('#seForm [name=reason]', 'Test des réseaux')
    page.click('#seForm button[type=submit]')
    page.wait_for_function("() => location.hash.startsWith('#/station/site-60007480') && !location.hash.includes('modifier')")
    site = js(page, "return store.get('site', arg);", MATARONI)
    assert site['networks'] == ['Chimie', 'RCO', 'Côtier'], site['networks']
    cotier = js(page, "return store.get('network', 'net-C_tier');")
    assert cotier and cotier['code'] == 'Côtier' and cotier['auditTypes'] == [], cotier
    assert js(page, "return store.all('trail').some(t => t.entityId === arg && t.reason === 'Test des réseaux');", MATARONI)
    goto_hash(page, f'#/station/{MATARONI}/modifier')
    assert page.eval_on_selector_all('#seForm [name=networks]:checked', 'els => els.map(e => e.value)') == ['Chimie', 'RCO', 'Côtier']

    # ----- Campagne : réseau choisi dans la liste du référentiel
    goto_hash(page, '#/referentiel/campaign')
    page.click('#view .li[data-id="camp-BIO-2026"]')
    page.click('.modal [data-act=edit]')
    page.wait_for_selector('#rf')
    assert page.eval_on_selector('#rf select[name=network]', 'e => e.value') == 'BIO'
    opts = page.eval_on_selector_all('#rf select[name=network] option', 'os => os.map(o => o.value)')
    assert opts[:6] == ['', 'BIO', 'Chimie', 'RCO', 'EL', 'ESO'] and 'PEST' in opts, opts
    page.click('.modal-head [data-act=__close]')
    page.wait_for_selector('#rf', state='detached')

    # ----- Nouveau site depuis Référentiels › Sites : cases à cocher, types déduits des réseaux
    goto_hash(page, '#/referentiel/site')
    page.click('#view [data-act=new]')
    page.wait_for_selector('#rf')
    page.fill('#rf [name=code]', 'NEW01')
    page.fill('#rf [name=name]', 'Nouvelle station')
    page.check('#rf [name=networks][value=ESO]')
    page.check('#rf [name=networks][value=PEST]')
    page.click('.modal [data-act=ok]')
    page.wait_for_selector('#rf', state='detached')
    new = js(page, "return store.find('site', s => s.code === 'NEW01');")
    assert new['networks'] == ['ESO', 'PEST'] and new['types'] == ['ce', 'eso'], new

    # ----- Téléphone (390 px) : aucun débordement horizontal (liste des réseaux, fenêtre, modification de station)
    page.set_viewport_size(PHONE)
    for where in ('#/referentiel/network', f'#/station/{MATARONI}/modifier', '#/referentiel/site'):
        goto_hash(page, where)
        o = page.evaluate(OVERFLOW)
        assert o['sw'] <= o['W'], (where, o)
    goto_hash(page, '#/referentiel/network')
    page.click('#view .li[data-id="net-RCO"]')
    page.click('.modal [data-act=edit]')
    page.wait_for_selector('#rf')
    o = page.evaluate(OVERFLOW)
    assert o['sw'] <= o['W'], ('fenêtre Réseau', o)


# ---------------------------------------------------------------------------------------------------------------
IMPORT = """const I = await import('./js/app/imports.js');
    const rows = arg.rows, headers = rows.shift();
    const source = { kind: 'csv', name: arg.name, sha256: 'test', headers, rows };
    const mapping = I.suggestMapping('site', headers);
    const preview = I.previewImport('site', source, mapping);
    const out = { mapping, preview: preview.map(p => ({ index: p.index, status: p.status, code: p.entity.code, networks: p.entity.networks, warnings: p.warnings, errors: p.errors })) };
    if (arg.apply) out.counts = await I.applyImport('site', source, preview);
    return out;"""


def import_sites(page, name, rows, apply=True):
    return js(page, IMPORT, {'name': name, 'rows': rows, 'apply': apply})


def test_import_sites_reseaux(page, app_url):
    setup_standalone(page, app_url)
    # ----- Exports : réseaux des stations d'une tournée, réseau du programme d'une prestation
    tour = create_tour(page, 'bio', ['site-09271503', ACAROUANY], 'prov-HYDRECO')
    cols = js(page, """const E = await import('./js/app/exports.js');
        const col = (kind, label) => E.COLUMNS[kind].find(c => c.label === label);
        const a = E.auditsWithSummary([store.get('audit', arg)])[0], p = store.get('prestation', 'pres-RCO_09281718_S1_-_Octobre_2026');
        return { audit: col('audits', 'Réseau(x)').get(a), prestation: col('prestations', 'Réseau').get(p), site: col('prestations', 'Réseau(x) de la station').get(store.get('prestation', 'pres-BIO-2026-09160201')),
          bio: col('prestations', 'Réseau').get(store.get('prestation', 'pres-BIO-2026-09160201')) };""", tour['id'])
    assert cols == {'audit': 'BIO ; Chimie', 'prestation': 'RCO', 'site': 'BIO ; Chimie', 'bio': 'BIO'}, cols
    before = js(page, "return store.get('site', arg);", ACAROUANY)
    assert before['networks'] == ['BIO', 'Chimie'] and before['bassin'] and before['masseEau']
    # ----- Colonnes non associées : rien n'est effacé (réseaux, bassin, masse d'eau, coordonnées)
    r = import_sites(page, 'sites-sans-reseau.csv', [['Code', 'Nom', 'Commune'], ['09160201', 'Acarouany', 'Mana (bourg)']])
    assert 'networks' not in r['mapping'] and r['preview'][0]['status'] == 'update', r
    after = js(page, "return store.get('site', arg);", ACAROUANY)
    assert after['commune'] == 'Mana (bourg)'
    for k in ('networks', 'bassin', 'masseEau', 'lat', 'lon', 'x', 'y', 'types', 'compartments'):
        assert after[k] == before[k], k

    # ----- Codes normalisés, station sur deux lignes (une par réseau), code inconnu signalé puis créé
    rows = [['Code', 'Nom', 'Réseau', 'Bassin versant'],
            ['NEWST1', 'Nouvelle crique', 'bio', 'Mana'],
            ['NEWST1', 'Nouvelle crique', 'Chimie des cours d’eau', ''],
            ['60007480', 'Mataroni', 'rco ; eaux littorales', ''],
            ['NEWST2', 'Station pesticides', 'PESTICIDES', 'Kourou']]
    r = import_sites(page, 'sites-reseaux.csv', rows, apply=False)
    p = {x['index']: x for x in r['preview']}
    assert p[1]['status'] == 'new' and p[1]['networks'] == ['BIO', 'Chimie'], p[1]
    assert p[2]['status'] == 'merged' and 'ligne 1' in p[2]['warnings'][0], p[2]
    assert p[3]['status'] == 'same' and p[3]['networks'] == ['RCO', 'EL'], 'Mataroni : mêmes réseaux (casse, libellé)'
    assert p[4]['status'] == 'new' and p[4]['networks'] == ['PESTICIDES'] and 'ajouté(s) à l’application : PESTICIDES' in ' '.join(p[4]['warnings']), p[4]
    assert not js(page, "return store.getRaw('network', 'net-PESTICIDES');"), 'rien n’est créé avant l’application'
    r = import_sites(page, 'sites-reseaux.csv', [list(x) for x in rows])
    assert r['counts']['new'] == 2 and r['counts']['merged'] == 1 and r['counts']['networks'] == ['PESTICIDES'], r['counts']
    s1 = js(page, "return store.find('site', s => s.code === 'NEWST1');")
    assert s1['networks'] == ['BIO', 'Chimie'] and s1['bassin'] == 'Mana' and s1['types'] == ['ce'] and s1['compartments'] == ['organisation', 'physico'], s1
    net = js(page, "return store.get('network', 'net-PESTICIDES');")
    assert net['code'] == 'PESTICIDES' and net['auditTypes'] == []
    assert js(page, "return store.all('trail').some(t => t.entityType === 'network' && /Import Sites depuis sites-reseaux\\.csv/.test(t.reason || ''));")
    # Réimport du même fichier : rien à modifier
    r = import_sites(page, 'sites-reseaux.csv', [list(x) for x in rows], apply=False)
    assert [x['status'] for x in r['preview']] == ['same', 'merged', 'same', 'same'], r['preview']
    # Réseaux d'une station existante remplacés par ceux du fichier : retrait signalé
    r = import_sites(page, 'mataroni.csv', [['Code', 'Nom', 'Réseau(x)'], ['60007480', 'Mataroni', 'EL']], apply=False)
    assert r['preview'][0]['status'] == 'update' and 'retiré(s) de la station : RCO' in ' '.join(r['preview'][0]['warnings'])


# ---------------------------------------------------------------------------------------------------------------
def tablet(make_page, label):
    page = make_page(label=label)
    page.context.add_init_script('delete Navigator.prototype.share; delete Navigator.prototype.canShare;')
    return page


def send_file(page, tmp_path):
    goto_hash(page, '#/synchronisation')
    page.click('#xchSend')
    page.wait_for_selector('#xchSave')
    with page.expect_download() as d:
        page.click('#xchSave')
    path = tmp_path / d.value.suggested_filename
    d.value.save_as(path)
    page.wait_for_selector('#xchSave', state='detached')
    return path


def receive_file(page, path):
    goto_hash(page, '#/synchronisation')
    page.set_input_files('#xchReceive input', str(path))
    page.wait_for_selector('#xchConfirm')
    page.click('#xchConfirm')
    page.wait_for_selector('#xchReport')
    report = page.inner_text('.modal-body')
    page.click('#xchDone')
    page.wait_for_selector('#xchReport', state='detached')
    return report


def set_networks(page, site_id, networks):
    js(page, "await store.put('site', { ...store.get('site', arg[0]), networks: arg[1] }, { reason: 'Test : réseaux de la station' });", [site_id, networks])


@pytest.mark.lent
def test_deux_tablettes_fusion_des_reseaux(make_page, app_url, tmp_path):
    t1 = tablet(make_page, 'tablette 1')
    setup_standalone(t1, app_url, device='Tablette 1', device_no=1, name='Alice Dupont', username='adupont')
    f = send_file(t1, tmp_path)
    t2 = tablet(make_page, 'tablette 2')
    open_setup(t2, app_url)
    t2.click('#setupExtra')
    t2.set_input_files('#extraFile', str(f))
    t2.fill('#extraOpenForm [name=exchangePassword]', EXCHANGE_PASSWORD)
    t2.click('#extraOpen')
    t2.wait_for_selector('#extraForm')
    t2.click('#extraForm [data-act=extra-pick][data-u=adupont]')
    t2.fill('#extraForm [name=password]', PASSWORD)
    t2.fill('#extraForm [name=password2]', PASSWORD)
    t2.click('#extraBtn')
    t2.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')
    wait_view(t2)
    assert js(t2, "return store.get('site', arg).networks;", ACAROUANY) == ['BIO', 'Chimie']
    assert js(t2, "return store.all('network').length;") == 5

    # Modifications concurrentes : tablette 1 ajoute RCO, tablette 2 retire Chimie ; tablette 2 non mise à niveau
    # (grille CT-2026 enregistrée en FNU / 1.0).
    set_networks(t1, ACAROUANY, ['BIO', 'Chimie', 'RCO'])
    set_networks(t2, ACAROUANY, ['BIO'])
    js(t2, OLD_GRIDS)
    f2 = send_file(t2, tmp_path)
    report = receive_file(t1, f2)
    assert 'conflit' not in report, report
    assert js(t1, "return store.get('site', arg).networks;", ACAROUANY) == ['BIO', 'RCO'], 'ajout ET retrait pris en compte'
    assert js(t1, "return store.all('conflict').length;") == 0
    assert js(t1, "return store.get('grid', 'grid-ct-2026-v1').version;") == '1.1'
    assert grid_units(t1, 'grid-ct-2026-v1', 'it-F4-9') == ['NTU', 'NTU', 'NTU'], 'pas de retour à FNU'
    assert grid_units(t1, 'grid-prel-eau-general-v1', 'it-V08') == ['NTU']
    # Retour vers la tablette 2 : même fusion
    f3 = send_file(t1, tmp_path)
    receive_file(t2, f3)
    assert js(t2, "return store.get('site', arg).networks;", ACAROUANY) == ['BIO', 'RCO']
    assert js(t2, "return store.all('conflict').length;") == 0
    snap = "return JSON.stringify(store.all('network').map(({ _lv, _rev, _vv, createdAt, createdBy, createdByName, updatedAt, updatedBy, updatedByName, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)));"
    assert js(t1, snap) == js(t2, snap), 'même référentiel « Réseaux » sur les deux tablettes'


# ---------------------------------------------------------------------------------------------------------------
# 6 à 8. Écrans et documents
SECTIONS = """() => [...document.querySelectorAll('#hmGrid .hm-sec')].filter(s => !s.hidden).map(s => [s.dataset.net, s.querySelector('[data-n]').textContent])"""
PHONE_360 = {'width': 360, 'height': 780}


def home_state(page):
    """Accueil : rangement, chips pressés (réseau, type, rangement), sections visibles, total affiché, cartes visibles."""
    return page.evaluate("""() => ({
        sections: [...document.querySelectorAll('#hmGrid .hm-sec')].filter(s => !s.hidden).map(s => [s.dataset.net, s.querySelector('[data-n]').textContent]),
        grid: document.querySelector('#hmGrid')?.className,
        count: document.querySelector('#hmCount')?.textContent,
        cards: document.querySelectorAll('#hmGrid .hm-card:not([hidden])').length,
        reseau: document.querySelector('.hm-nets [aria-pressed=true]')?.dataset.v,
        type: document.querySelector('.hm-types [aria-pressed=true]')?.dataset.v,
        ranger: document.querySelector('.hm-sort [aria-pressed=true]')?.dataset.v })""")


def search(page, text):
    page.fill('#view [data-input=search]', text)
    page.wait_for_function("t => document.querySelector('#view [data-input=search]').value === t", arg=text)
    return home_state(page)


def test_accueil_range_par_reseau_et_preferences_par_agent(page, app_url):
    setup_standalone(page, app_url)
    goto_hash(page, '#/')
    st = home_state(page)
    # ----- Sections par réseau (rangement d'office), effectifs, stations distinctes
    assert st['sections'] == [['BIO', '38 stations'], ['Chimie', '15 stations'], ['RCO', '25 stations'], ['EL', '29 stations'], ['ESO', '17 stations']], st
    assert st['grid'] == 'hm-secs' and st['ranger'] == 'reseau' and st['reseau'] == '' and st['type'] == ''
    assert st['count'] == '108 stations affichées' and st['cards'] == 124, 'total distinct : 108, pas 124'
    assert 'athanase' in page.inner_text('#view').casefold()
    chips = page.eval_on_selector_all('.hm-nets .chip', "els => els.map(e => [e.dataset.v, e.querySelector('.count').textContent, e.getAttribute('aria-pressed')])")
    assert chips == [['', '108', 'true'], ['BIO', '38', 'false'], ['Chimie', '15', 'false'], ['RCO', '25', 'false'], ['EL', '29', 'false'], ['ESO', '17', 'false']], chips
    assert page.get_attribute('.hm-nets', 'role') == 'group' and page.get_attribute('.hm-sort', 'role') == 'group'
    assert page.eval_on_selector_all('#hmGrid .hm-sec > h2.hm-sec-h', 'els => els.length') == 5, 'titres h2'
    acar = page.eval_on_selector_all(f'.hm-card[data-site="{ACAROUANY}"]', "els => els.map(e => [e.closest('.hm-sec').dataset.net, e.querySelector('.hm-also')?.textContent.replace(/\\s+/g, ' ').trim()])")
    assert acar == [['BIO', 'Aussi : Chimie'], ['Chimie', 'Aussi : BIO']], acar
    assert page.locator(f'.hm-sec[data-net="BIO"] .hm-card[data-site="{ATHANASE}"] .hm-also').count() == 0, 'station sur un seul réseau : pas de « Aussi »'
    # Cibles tactiles ≥ 44 px
    small = page.eval_on_selector_all('.hm-nets .chip, .hm-sort .chip, .hm-types .chip, .hm-status .chip', 'els => els.filter(e => e.getBoundingClientRect().height < 44).length')
    assert small == 0

    # ----- Recherche instantanée : sections vides masquées, effectifs mis à jour, total distinct
    st = search(page, 'Acarouany')
    assert st['count'] == '1 station affichée' and st['sections'] == [['BIO', '1 station'], ['Chimie', '1 station']], st
    st = search(page, 'Mataroni')
    assert st['count'] == '1 station affichée' and st['sections'] == [['RCO', '1 station'], ['EL', '1 station']], st
    st = search(page, 'chimie des cours')
    assert st['count'] == '15 stations affichées' and st['sections'] == [['BIO', '15 stations'], ['Chimie', '15 stations']], 'recherche par libellé de réseau'
    st = search(page, 'zzzz')
    assert st['count'] == '0 station affichée' and st['sections'] == [] and page.is_visible('#hmNone')
    st = search(page, '')
    assert st['count'] == '108 stations affichées' and len(st['sections']) == 5 and not page.is_visible('#hmNone')

    # ----- Filtre « Réseau » (agent A) : une section, « Aussi : BIO », mémorisé avec le rangement
    page.click('.hm-nets [data-v=Chimie]')
    page.wait_for_function("() => location.hash.includes('reseau=Chimie') && document.querySelector('.hm-nets [data-v=Chimie]')?.getAttribute('aria-pressed') === 'true'")
    st = home_state(page)
    assert st['sections'] == [['Chimie', '15 stations']] and st['count'] == '15 stations affichées' and st['cards'] == 15, st
    assert page.locator('.hm-sec[data-net="Chimie"] .hm-also').count() == 15
    goto_hash(page, '#/')
    st = home_state(page)
    assert st['reseau'] == 'Chimie' and st['sections'] == [['Chimie', '15 stations']], 'réseau rappelé (préférence de l’agent)'
    # Rangement par statut : DOM historique (grille unique), réseaux sur chaque carte
    page.click('.hm-sort [data-v=statut]')
    page.wait_for_function("() => document.querySelector('#hmGrid')?.className === 'hm-grid'")
    st = home_state(page)
    assert st['ranger'] == 'statut' and st['cards'] == 15 and page.locator('.hm-sec').count() == 0, st
    assert page.eval_on_selector_all(f'#hmGrid > .hm-card[data-site="{ACAROUANY}"] .hm-netline .net-badge', 'els => els.map(e => e.textContent.trim())') == ['BIO', 'Chimie']
    assert page.locator('#hmGrid .hm-also').count() == 0, 'rangement par statut : tous les réseaux, sans « Aussi »'
    # « Effacer les filtres » : réseau compris (rangement conservé)
    page.click('.hm-countbar [data-act=reset]')
    page.wait_for_function("() => document.querySelectorAll('#hmGrid > .hm-card').length === 108")
    st = home_state(page)
    assert st['reseau'] == '' and st['ranger'] == 'statut' and st['count'] == '108 stations affichées', st
    goto_hash(page, '#/?ranger=statut&type=&reseau=')
    assert page.locator('#hmGrid.hm-grid > .hm-card').count() == 108 and page.locator('.hm-sec').count() == 0, 'DOM historique'

    # ----- Préférences PAR AGENT : A choisit cours d'eau + EL + par statut ; B (même tablette) n'en hérite pas
    goto_hash(page, '#/')
    page.click('.hm-types [data-v=ce]')
    page.wait_for_function("() => document.querySelector('.hm-types [data-v=ce]')?.getAttribute('aria-pressed') === 'true'")
    page.click('.hm-nets [data-v=EL]')
    page.wait_for_function("() => document.querySelector('.hm-nets [data-v=EL]')?.getAttribute('aria-pressed') === 'true'")
    st = home_state(page)
    assert st['type'] == 'ce' and st['reseau'] == 'EL' and st['ranger'] == 'statut' and st['cards'] == 29, st
    bruno = add_agent(page, 'Martin', 'Bruno', 'bmartin')
    switch_agent(page)
    login(page, 'bmartin')
    assert js(page, 'return session.user.id;') == bruno
    goto_hash(page, '#/')
    st = home_state(page)
    assert st['type'] == '' and st['reseau'] == '' and st['ranger'] == 'reseau' and len(st['sections']) == 5, ('agent suivant : réglages par défaut', st)
    page.click('.hm-nets [data-v=ESO]')
    page.wait_for_function("() => document.querySelector('.hm-nets [data-v=ESO]')?.getAttribute('aria-pressed') === 'true'")
    # La création de tournée n'est jamais filtrée par la préférence de l'accueil
    goto_hash(page, '#/nouvel-audit?type=ce')
    assert page.get_attribute('#anCands [data-act=setNet][data-v=""]', 'aria-pressed') == 'true'
    switch_agent(page)
    unlock(page, PASSWORD, username='admin')
    goto_hash(page, '#/')
    st = home_state(page)
    assert st['type'] == 'ce' and st['reseau'] == 'EL' and st['ranger'] == 'statut', ('agent A : ses réglages', st)
    keys = page.evaluate("() => Object.keys(localStorage).filter(k => k.includes('home.')).sort()")
    assert all(k.startswith('oeg-ct:u:') for k in keys) and any(bruno in k for k in keys), keys

    # ----- Téléphone (390 et 360 px) et tablette en portrait : aucun débordement, rangées de chips à la ligne
    for vp in (PHONE, PHONE_360, {'width': 800, 'height': 1280}):
        page.set_viewport_size(vp)
        for where in ('#/?type=&reseau=&ranger=reseau', '#/?type=&reseau=&ranger=statut', '#/?type=&reseau=Chimie&ranger=reseau'):
            goto_hash(page, where)
            o = page.evaluate(OVERFLOW)
            assert o['sw'] <= o['W'], (vp, where, o)
            wraps = page.eval_on_selector_all('.hm-nets, .hm-sort', 'els => els.map(e => getComputedStyle(e).flexWrap)')
            assert wraps == ['wrap', 'wrap'], wraps


def test_carte_tournee_station_planning(page, app_url):
    setup_standalone(page, app_url)
    # ----- Carte : filtre EL (29 stations géolocalisées), info-bulle, lien vers la liste
    goto_hash(page, '#/carte?reseau=EL')
    assert '29 station(s) affichée(s)' in page.inner_text('#view .page-title')
    assert page.get_attribute('.mp-nets [data-k=reseau][data-v=EL]', 'aria-pressed') == 'true'
    page.wait_for_function("() => document.querySelectorAll('.leaflet-marker-icon .mk-st').length === 29")
    assert page.get_attribute('#view .page-title a.btn', 'href') == '#/?type=&reseau=EL'
    goto_hash(page, '#/carte?reseau=Chimie&type=bio')
    page.wait_for_function("() => document.querySelectorAll('.leaflet-marker-icon .mk-st').length === 15")
    goto_hash(page, f'#/carte?site={ACAROUANY}')
    page.wait_for_selector('.leaflet-tooltip')
    assert 'Réseaux : BIO, Chimie' in page.inner_text('.leaflet-tooltip')

    # ----- Création de tournée : ?reseau=EL ; sans paramètre, « Tous réseaux » (recherche « Sakoura »)
    goto_hash(page, '#/nouvel-audit?type=ce&reseau=EL')
    assert page.get_attribute('#anCands [data-act=setNet][data-v=EL]', 'aria-pressed') == 'true'
    cands = page.eval_on_selector_all('#anCands [data-act=addSt]', 'els => els.map(e => e.dataset.site)')
    nets = js(page, "return arg.map(id => store.get('site', id).networks);", cands)
    assert len(cands) == 29 and all('EL' in n for n in nets), (len(cands), nets)
    assert page.inner_text(f'#anCands .an-cand:has([data-site="{MATARONI}"]) .an-cand-nets').split() == ['RCO', 'EL']
    goto_hash(page, '#/nouvel-audit?type=ce')
    assert page.get_attribute('#anCands [data-act=setNet][data-v=""]', 'aria-pressed') == 'true'
    page.fill('[data-input=anSearch]', 'Sakoura')
    page.wait_for_selector(f'#anCands [data-act=addSt][data-site="{SAKOURA}"]')
    page.click('#anCands [data-act=setNet][data-v=RCO]')
    page.wait_for_selector('#anCands [data-act=setNet][data-v=RCO][aria-pressed=true]')
    assert page.input_value('[data-input=anSearch]') == 'Sakoura', 'recherche conservée'
    assert page.locator(f'#anCands [data-act=addSt][data-site="{SAKOURA}"]').count() == 1
    assert page.evaluate('document.activeElement?.dataset.v') == 'RCO', 'focus rendu au filtre choisi'
    page.click('#anCands [data-act=setNet][data-v=EL]')
    page.wait_for_selector('#anCands [data-act=setNet][data-v=EL][aria-pressed=true]')
    assert page.locator('#anCands [data-act=addSt]').count() == 0 and 'Aucune station ne correspond' in page.inner_text('#anCands')
    page.click('#anCands [data-act=setNet][data-v=""]')
    page.click(f'#anCands [data-act=addSt][data-site="{SAKOURA}"]')
    page.wait_for_selector('.an-sel-row')
    assert 'RCO' in page.inner_text('.an-sel-row .an-sel-sub')

    # ----- Fiche station et feuille 1 : badges (lien vers l'accueil filtré), pastilles du bandeau sur une ligne à part
    goto_hash(page, f'#/station/{ACAROUANY}')
    meta = page.eval_on_selector_all('.stp-meta a.net-badge', 'els => els.map(e => [e.textContent.trim(), e.getAttribute("href")])')
    assert meta == [['BIO', '#/?type=&reseau=BIO'], ['Chimie', '#/?type=&reseau=Chimie']], meta
    assert page.eval_on_selector_all('.station-banner .sb-text > .sb-nets .sb-net', 'els => els.map(e => e.textContent)') == ['BIO', 'Chimie']
    pres = page.eval_on_selector_all('.stp-pres .net-badge', 'els => [...new Set(els.map(e => e.textContent.trim()))].sort()')
    assert pres == ['BIO', 'Chimie'], 'réseau du programme de chaque prestation'
    page.set_viewport_size(PHONE)
    for where in (f'#/station/{ACAROUANY}', '#/carte?reseau=EL', '#/nouvel-audit?type=ce&reseau=EL', '#/planning?periode=toutes&reseau=RCO'):
        goto_hash(page, where)
        o = page.evaluate(OVERFLOW)
        assert o['sw'] <= o['W'], (where, o)
    page.set_viewport_size({'width': 1280, 'height': 900})

    # ----- Planning : filtre Réseau dans les Filtres repliés, badge du réseau du programme
    js(page, """await store.put('prestation', { id: 'pres-EL-TEST', ref: 'EL-TEST-S1', siteId: arg, providerId: 'prov-TL1', campaignId: 'camp-EL-S1_-_Septembre_2026_saison_s_che_',
        plannedDate: '2026-11-03', status: 'prevue', auditType: 'ce' }, { reason: 'Test : prestation EL' });""", MATARONI)
    goto_hash(page, '#/planning?periode=toutes&reseau=EL')
    assert page.get_attribute('#view details.card', 'open') is not None, 'Filtres ouverts'
    assert page.eval_on_selector('select[data-k=reseau]', 'e => e.value') == 'EL'
    assert page.locator('.pl-li').count() == 1 and page.inner_text('.pl-li .net-badge').strip() == 'EL'
    assert 'Aujourd’hui' in page.inner_text('#view .chips'), 'première rangée de chips : les périodes'
    goto_hash(page, '#/planning?periode=toutes&reseau=RCO')
    badges = page.eval_on_selector_all('.pl-li', "els => els.map(e => e.querySelector('.net-badge')?.textContent.trim())")
    assert len(badges) == 52 and set(badges) == {'RCO'}, (len(badges), set(badges))
    page.select_option('select[data-k=reseau]', 'Chimie')
    page.wait_for_function("() => location.hash.includes('reseau=Chimie')")
    assert page.locator('.pl-li').count() == 42

    # ----- Modification de la station 60007480 (EL retiré) : sections de l'accueil mises à jour
    goto_hash(page, f'#/station/{MATARONI}/modifier')
    page.uncheck('#seForm [name=networks][value=EL]')
    page.fill('#seForm [name=reason]', 'Mataroni : réseau RCO seulement (test)')
    page.click('#seForm button[type=submit]')
    page.wait_for_function("() => location.hash.startsWith('#/station/site-60007480') && !location.hash.includes('modifier')")
    assert page.eval_on_selector_all('.stp-meta a.net-badge', 'els => els.map(e => e.textContent.trim())') == ['RCO']
    goto_hash(page, '#/?type=&reseau=&ranger=reseau')
    st = home_state(page)
    assert ['RCO', '25 stations'] in st['sections'] and ['EL', '28 stations'] in st['sections'] and st['count'] == '108 stations affichées', st
    st = search(page, 'Mataroni')
    assert st['sections'] == [['RCO', '1 station']], st

    # ----- Station sans réseau : chip et section « Sans réseau » (?reseau=aucun), carte
    js(page, """await store.put('site', { ...structuredClone(store.get('site', arg)), id: 'site-SANSRES', code: 'SANSRES', name: 'Station sans réseau', networks: [] }, { reason: 'Test' });""", ATHANASE)
    goto_hash(page, '#/?type=&reseau=&ranger=reseau')
    assert page.inner_text('.hm-nets [data-v=aucun]').split()[-1] == '1' and page.inner_text('#hmCount') == '109 stations affichées'
    assert home_state(page)['sections'][-1] == ['aucun', '1 station'] and 'sans réseau' in page.inner_text('.hm-sec[data-net=aucun] h2').casefold()
    page.click('.hm-nets [data-v=aucun]')
    # L'adresse change avant la fin du réaffichage (navigate : replaceState puis rendu) : attendre le chip pressé.
    page.wait_for_function("() => location.hash.includes('reseau=aucun') && document.querySelector('.hm-nets [data-v=aucun]')?.getAttribute('aria-pressed') === 'true'")
    assert home_state(page)['sections'] == [['aucun', '1 station']]
    goto_hash(page, '#/carte?reseau=aucun')
    page.wait_for_function("() => document.querySelectorAll('.leaflet-marker-icon .mk-st').length === 1")


@pytest.mark.lent
def test_documents_exports_tableau_de_bord(page, app_url):
    setup_standalone(page, app_url)
    # ----- PDF de la fiche station : BIO et Chimie dans le bandeau, avant la silhouette de la Guyane
    drawn = page.evaluate("""async (id) => {
        const { PDFDocument } = await import('./js/formats/pdf.js');
        const M = await import('./js/app/sheets-pdf.js');
        const seen = [], orig = PDFDocument.prototype.text;
        PDFDocument.prototype.text = function (s, x, ...rest) { seen.push([String(s), x, this.pageWidth || this.width || 595.28]); return orig.call(this, s, x, ...rest); };
        try { await M.generateStationSheetPdf({ siteId: id }); } finally { PDFDocument.prototype.text = orig; }
        return seen;
    }""", ACAROUANY)
    pills = [d for d in drawn if d[0] in ('BIO', 'Chimie')]
    assert [d[0] for d in pills] == ['BIO', 'Chimie'], pills
    assert all(d[1] < 0.53 * 595.28 for d in pills), ('avant la silhouette (53 % du bandeau)', pills)
    # Tournée : pastilles sur la feuille 1 de chaque station, jamais sur les grands bandeaux de F3 / F9
    tour = create_tour(page, 'bio', [ATHANASE, ACAROUANY], 'prov-HYDRECO')
    texts = pdf_texts(page, "await (await import('./js/app/sheets-pdf.js')).generateSheetsPdf({ auditId: arg });", tour['id'])
    assert texts.count('Chimie') == 1 and texts.count('BIO') == 2, (texts.count('Chimie'), texts.count('BIO'))

    # ----- Rapport : réseaux des stations, colonne « Réseaux » du tableau des stations de la tournée
    texts = pdf_texts(page, "await (await import('./js/app/report.js')).buildAuditReport(arg);", tour['id'])
    assert 'Réseaux' in texts and 'BIO · Chimie' in texts and 'BIO – Biologie (RCS ESC BIO)' in texts, [t for t in texts if 'BIO' in t]
    assert 'BIO – Biologie (RCS ESC BIO)' in texts and 'Réseau (programme)' not in texts, 'tournée sans prestation : pas de réseau de programme'

    # ----- Exports : stations (une ligne par station), stations par réseau (une ligne par station et par réseau)
    ex = js(page, """const E = await import('./js/app/exports.js');
        const sites = store.all('site');
        const rows = E.table('sites', sites), byNet = E.table('stationsByNetwork', E.stationsByNetwork(sites));
        const col = (t, l) => t[0].indexOf(l);
        const acar = rows.find(r => r[0] === '09160201');
        return { n: rows.length - 1, acar: acar[col(rows, 'Réseau(x)')], types: acar[col(rows, 'Types de tournée')], memberships: byNet.length - 1,
          acarByNet: byNet.filter(r => r[col(byNet, 'Code')] === '09160201').map(r => [r[0], r[col(byNet, 'Aussi dans')]]),
          first: byNet[1][0], last: byNet[byNet.length - 1][0] };""")
    assert ex['n'] == 108 and ex['acar'] == 'BIO ; Chimie' and ex['types'] == 'Hydrobiologie ; Cours d’eau', ex
    assert ex['memberships'] == 124 and ex['acarByNet'] == [['BIO', 'Chimie'], ['Chimie', 'BIO']] and ex['first'] == 'BIO' and ex['last'] == 'ESO', ex
    goto_hash(page, '#/export')
    page.select_option('select[data-k=reseau]', 'EL')
    page.wait_for_function("() => document.querySelector('#view .card .note')?.textContent.includes('29 station(s)')")
    with page.expect_download() as dl:
        page.click('[data-act=csv][data-k=sites]')
    assert dl.value.suggested_filename.startswith('stations-reseaux_')
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    assert csv.count('\n') >= 29 and 'Mataroni' in csv and 'Acarouany' not in csv

    # ----- Tableau de bord : stations contrôlées par réseau (total distinct), lien d'une campagne vers le planning
    goto_hash(page, '#/tableau-de-bord')
    cov = page.eval_on_selector_all('.bars.is-cov .bar-row', "els => els.map(e => [e.dataset.net, e.querySelector('.bn').textContent.replace(/\\s/g, ' ')])")
    assert cov == [['BIO', '0 / 38'], ['Chimie', '0 / 15'], ['RCO', '0 / 25'], ['EL', '0 / 29'], ['ESO', '0 / 17']], cov
    answer_required(page, tour['id'])
    sign_and_lock(page, tour['id'])
    goto_hash(page, '#/tableau-de-bord')
    cov = dict(page.eval_on_selector_all('.bars.is-cov .bar-row', "els => els.map(e => [e.dataset.net, e.querySelector('.bn').textContent.replace(/\\s/g, ' ')])"))
    assert cov['BIO'] == '2 / 38' and cov['Chimie'] == '1 / 15' and cov['RCO'] == '0 / 25', cov
    assert page.inner_text('button.kpi[data-k=sites] .v') == '2', 'sites contrôlés : stations distinctes'
    assert '2 stations contrôlées sur 108' in page.inner_text('.bars.is-cov + .note')
    page.click('.bars.is-cov .bar-row[data-net=Chimie]')
    page.wait_for_selector('.modal')
    assert 'réseau chimie (1)' in page.inner_text('.modal-head').casefold() and 'acarouany' in page.inner_text('.modal-body').casefold()
    page.click('.modal [data-act=__close]')
    href = page.eval_on_selector('tr.click[data-act=goto]', 'e => e.dataset.href')
    assert href.startswith('#/planning?campagne=') and href.endswith('&periode=toutes'), href
    page.click('tr.click[data-act=goto]')
    page.wait_for_function("() => location.hash.startsWith('#/planning?campagne=')")

