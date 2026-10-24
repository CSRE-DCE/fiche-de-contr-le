"""Doublons et redondances des fiches terrain (demande de l'OEG du 16/10/2026 : « Vérifier qu'il n'y ait pas de
doublons » ; « Vérifie qu'il n'y ait pas de doublons ou de redondance dans les descriptions dans les fiches terrain ») :
grille CT-2026 version 1.2, fiche des attendus, menus. Les règles elles-mêmes (libellés, même information demandée deux
fois, aides, attendus, numéros retirés) sont vérifiées par tests/unit/grid-ct-2026.test.js et tests/unit/attendus.test.js.

  1. test_mise_a_niveau_tournee_signee_intacte : tablette en service avec la grille CT-2026 1.1 (« Heure début » /
     « Heure fin » en double dans F2, F4.14 et F4.16 répétés par station, pas de point de synthèse) et une tournée
     commencée puis signée et verrouillée avec cette grille. Avant la mise à niveau : nouvelle tournée et fiches vierges
     déjà en 1.2 (version du code : 1.3 depuis les CCTP 2026). upgradeReferentiel2026 : grille enregistrée dans la
     version du code (journal) ; la tournée signée n'est jamais
     modifiée (instantané 1.1, empreinte, sceau vérifié ; PDF avec ses libellés d'origine, sans avertissement) ;
     idempotence.
  2. test_fenetre_aide_et_attendu (tablette 1280 × 800 puis téléphone 390 × 844) : un seul bouton ⓘ par point (plus de
     bouton « Attendu » séparé ni d'aide en double), fenêtre « Aide et attendu » (attendu, cotation, « Point de
     synthèse, hors note », points des fiches d'évaluation inclus et leur origine), heures de F2 distinctes, F4.16
     « Commun à la tournée », textes d'invite distincts des zones libres ; aucun défilement horizontal.
  3. test_menus_sans_doublon : une seule entrée « Audits » (puce « Historique et comparaison ») ; type d'audit
     « avec rendez-vous » partout (plus de « planifié ») ; Mon compte renvoie à Administration pour renommer la tablette.
"""
import pathlib
import re

import pytest

from helpers import ATHANASE, answer_required, create_tour, goto_hash, js, setup_standalone
from test_affichage import OVERFLOW, PHONE
from test_parcours import pdf_texts, sign_and_lock

TABLET = {'width': 1280, 'height': 800}
S1 = '09271503'
# Version de la grille CT-2026 livrée avec l'application (1.2 : doublons et redondances ; 1.3 : CCTP 2026 et PEZSML) :
# la tablette en 1.1 reçoit la version du code, qui garde les libellés et portées de la 1.2.
CT_VERSION = re.search(r"^  version: '([\d.]+)',", (pathlib.Path(__file__).resolve().parent.parent / 'js' / 'domain' / 'grid-ct-2026.js').read_text(encoding='utf-8'), re.M).group(1)

# Grille CT-2026 telle qu'enregistrée sur une tablette en service avant la version 1.2.
GRID_11 = """const g = structuredClone(store.get('grid', 'grid-ct-2026-v1')); g.version = '1.1';
    for (const s of g.sections) for (const it of s.items) {
      if (it.id === 'it-F2-1.5' || it.id === 'it-F2-5.2') it.label = 'Heure début';
      if (it.id === 'it-F2-1.6' || it.id === 'it-F2-5.3') it.label = 'Heure fin';
      if (it.id === 'it-F4-14' || it.id === 'it-F4-16') delete it.scope;
      delete it.noScore;
    }
    await store.put('grid', g, { reason: 'Test : grille CT-2026 1.1 d’une tablette en service' });"""


def attr(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def seal(page, audit_id):
    return js(page, """const { canonicalJSON } = await import('./js/core/util.js'); const a = store.get('audit', arg);
        return { snapshot: canonicalJSON(a.gridSnapshot), sha: a.gridSha256, lock: a.lock.contentHash, updatedAt: a.updatedAt,
          version: a.gridSnapshot.version, ok: (await A.verifyAuditSeal(a)).ok };""", audit_id)


@pytest.mark.lent
def test_mise_a_niveau_tournee_signee_intacte(page, app_url):
    setup_standalone(page, app_url)
    assert js(page, "return store.get('grid', 'grid-ct-2026-v1').version;") == CT_VERSION, 'installation récente : version du code'
    js(page, GRID_11)
    # Tournée commencée avec la grille 1.1 (instantané 1.1), complète, signée et verrouillée.
    old = create_tour(page, 'ce', [ATHANASE], 'prov-TL1')
    js(page, """const { canonicalJSON, sha256Hex } = await import('./js/core/util.js');
        const a = structuredClone(store.get('audit', arg)), g = structuredClone(store.get('grid', 'grid-ct-2026-v1'));
        Object.assign(a, { gridSnapshot: g, gridVersion: g.version, gridSha256: await sha256Hex(canonicalJSON(g)) });
        await store.put('audit', a, { reason: 'Test : tournée commencée avec la grille 1.1' });""", old['id'])
    answer_required(page, old['id'])
    assert js(page, "return Object.keys(store.get('audit', arg).responses).some(k => k.startsWith('it-F4-16@'));", old['id']), \
        'grille 1.1 : F4.16 coté pour chaque station'
    sign_and_lock(page, old['id'])
    before = seal(page, old['id'])
    assert before['ok'] and before['version'] == '1.1', before

    # Avant toute mise à niveau (aucune session administrateur depuis la mise à jour) : nouvelle tournée dans la version du code.
    new = create_tour(page, 'ce', [ATHANASE], 'prov-TL1')
    snap = js(page, """const { itemIndex } = await import('./js/domain/grids.js'); const g = store.get('audit', arg).gridSnapshot, i = itemIndex(g);
        return { version: g.version, f16: i.get('it-F4-16').scope || null, h: i.get('it-F2-1.5').label, n: i.get('it-F2-2.8').noScore || false };""", new['id'])
    assert snap == {'version': CT_VERSION, 'f16': 'tournee', 'h': 'Début du contrôle', 'n': True}, snap
    blank = ' '.join(pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateBlankSheetsPdf({ auditType: 'ce', siteIds: [arg] });", ATHANASE))
    assert 'Début du contrôle' in blank and 'prévu au planning' in blank, 'fiches vierges : libellés 1.2'

    # ----- Mise à niveau
    res = js(page, "return (await import('./js/app/bootstrap.js')).upgradeReferentiel2026();")
    assert res['upgraded'] and not res.get('error') and res.get('gridsUpgraded', 0) >= 1, res
    assert js(page, "return store.get('grid', 'grid-ct-2026-v1').version;") == CT_VERSION
    trail = js(page, "return store.all('trail').filter(t => t.entityType === 'grid').map(t => t.reason || '');")
    assert any(f'version 1.1 → {CT_VERSION}' in t for t in trail), trail

    # Tournée signée : jamais modifiée (instantané, empreinte, sceau, date de modification).
    after = seal(page, old['id'])
    assert after == before, 'tournée signée intacte'
    texts = pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", old['id'])
    joined = ' '.join(texts)
    assert 'Heure début' in joined and 'Début du contrôle' not in joined, 'la tournée signée imprime ses libellés 1.1'
    assert not any('ATTENTION' in t for t in texts), 'sceau vérifié'
    js(page, "await A.setResponse(store.get('audit', arg), 'it-F2-1.5', { value: '07:30' });", new['id'])
    joined = ' '.join(pdf_texts(page, "const P = await import('./js/app/sheets-pdf.js'); await P.generateSheetsPdf({ auditId: arg });", new['id']))
    assert 'Début du contrôle' in joined and 'prévu au planning' in joined, 'nouvelle tournée : libellés 1.2'

    # Idempotence : rien à refaire
    again = js(page, "return (await import('./js/app/bootstrap.js')).upgradeReferentiel2026();")
    assert not again.get('gridsUpgraded') and not again.get('error'), again
    # (la génération du PDF a ajouté une entrée au registre des rapports, hors du contenu scellé : updatedAt change)
    assert {k: v for k, v in seal(page, old['id']).items() if k != 'updatedAt'} == {k: v for k, v in before.items() if k != 'updatedAt'}


@pytest.mark.lent
def test_fenetre_aide_et_attendu(page, app_url):
    setup_standalone(page, app_url)
    tour = create_tour(page, 'bio', [ATHANASE], 'prov-HYDRECO')
    aid = tour['id']
    for vp, name in ((TABLET, 'tablette'), (PHONE, 'téléphone')):
        page.set_viewport_size(vp)
        wide = vp['width'] >= 1100
        pfx = '#row-' if wide else '#card-'
        # ----- Feuille 2 : heures distinctes, synthèse « hors note », un seul bouton par point
        goto_hash(page, f'#/audit/{aid}/feuille-2')
        page.wait_for_timeout(150)
        view = page.locator('#view')
        assert view.locator('[data-act=item-help]').count() == 0, f'{name} : plus de bouton d’aide séparé'
        assert view.locator('[data-act=item-attendu]:visible').count() >= 40, f'{name} : un bouton ⓘ « Aide et attendu » par point'
        for item, label in (('it-F2-1.5', 'Début du contrôle'), ('it-F2-5.2', 'Début de tournée (prévu au planning)')):
            assert label in page.locator(f'[id={attr(pfx[1:] + item)}]').first.inner_text(), f'{name} : {label}'
        page.locator(f'[id={attr(pfx[1:] + "it-F2-2.8")}] [data-act=item-attendu]').first.click()
        page.wait_for_selector('.modal .att-crit')
        modal = page.inner_text('.modal')
        assert 'aide et attendu' in modal.casefold() and 'Point de synthèse, hors note' in modal and 'F2.2.1 à F2.2.7' in modal, modal[:500]
        assert page.evaluate(OVERFLOW)['sw'] <= page.evaluate(OVERFLOW)['W'], f'{name} : fenêtre sans débordement'
        page.click('.modal .modal-actions button:has-text("Fermer")')
        page.wait_for_selector('.modal', state='detached')
        ph = page.get_attribute('[id="sheet-2-observations"]', 'placeholder')
        assert 'organisation' in ph, ph
        # ----- Feuille 4 de la station : flacons sans réactif (aide « Inclut » et origine), F4.16 commun à la tournée
        goto_hash(page, f'#/audit/{aid}/feuille-4@{S1}')
        page.wait_for_timeout(150)
        assert 'Commun à la tournée' in page.locator(f'[id={attr(pfx[1:] + "it-F4-16")}]').first.inner_text()
        page.locator(f'[id={attr(pfx[1:] + "it-F4-17@" + S1)}] [data-act=item-attendu]').first.click()
        page.wait_for_selector('.modal .att-crit')
        modal = page.inner_text('.modal')
        assert 'Inclut (points des fiches d’évaluation)' in modal and 'sans réactif' in modal, modal[:600]
        assert 'Origine : fiches cours d’eau et eaux souterraines' in modal and 'jugés en F4.13' in modal, modal[:900]
        page.click('.modal .modal-actions button:has-text("Fermer")')
        page.wait_for_selector('.modal', state='detached')
        assert 'mesures in situ' in page.get_attribute(f'[id={attr(f"sheet-4@{S1}-observations")}]', 'placeholder')
        # Feuille 6 : deux zones libres (observations, commentaires de la conclusion) qui ne demandent pas la même chose
        goto_hash(page, f'#/audit/{aid}/feuille-6@{S1}')
        phs = [page.get_attribute(f'[id={attr(f"sheet-6@{S1}-observations")}]', 'placeholder'),
               page.get_attribute(f'[id={attr(f"concl-6@{S1}")}]', 'placeholder')]
        assert 'invertébrés' in phs[0] and 'Justification de la conclusion' in phs[1], phs
        # ----- Feuille 1 : observations de la station (texte d'invite distinct de l'encadré de F3)
        goto_hash(page, f'#/audit/{aid}/feuille-1@{S1}')
        r7 = page.get_attribute(f'[id={attr(f"r-it-F1-R7@{S1}")}]', 'placeholder')
        goto_hash(page, f'#/audit/{aid}/feuille-3@{S1}')
        f3 = page.get_attribute(f'[id={attr(f"sheet-3@{S1}-observations")}]', 'placeholder')
        assert r7 and f3 and r7 != f3 and 'station le jour du contrôle' in r7, (r7, f3)
        o = page.evaluate(OVERFLOW)
        assert o['sw'] <= o['W'] + 1, f'{name} : défilement horizontal {o}'


def test_menus_sans_doublon(page, app_url):
    setup_standalone(page, app_url)
    tour = create_tour(page, 'ce', [ATHANASE], 'prov-TL1')
    assert page.locator('#rail [data-nav="historique"]').count() == 0, 'plus d’entrée « Historique et comparaison » en double'
    goto_hash(page, '#/audits')
    assert page.locator('#rail [data-nav="audits"].active').count() == 1
    assert 'avec rendez-vous' in page.inner_text('#view') and 'planifié' not in page.inner_text('#view')
    page.click('#auHistory')
    page.wait_for_function("() => location.hash.includes('vue=historique')")
    page.wait_for_selector('#auHistory[aria-pressed="true"]')
    assert 'historique et comparaison' in page.inner_text('#view h1').casefold()
    assert page.locator('#rail [data-nav="audits"].active').count() == 1
    goto_hash(page, f'#/audit/{tour["id"]}/infos')
    assert 'Audit avec rendez-vous' in page.inner_text('#view')
    goto_hash(page, '#/compte')
    link = page.locator('#view a[href="#/administration"]')
    assert link.count() == 1 and 'Renommer la tablette' in link.inner_text()
    assert page.locator('#view [data-act=rename]').count() == 0, 'renommer : un seul emplacement (Administration)'
    goto_hash(page, '#/administration')
    assert page.locator('#thisTablet [data-act=device-rename]').count() == 1
