"""Aides des tests de bout en bout (Playwright Python) : configuration de l'appareil, session, navigation,
tournées et appels directs aux modules de l'application (import dynamique depuis la page).

    from helpers import setup_standalone, unlock, goto_hash, create_tour, js
"""
import re

PASSWORD = 'motdepasse-test'
ORG = 'Office de l’Eau de Guyane'
ATHANASE = 'site-09271503'
ERROR_CARD = re.compile(r'Erreur d’affichage|Impossible de charger cet écran')


def js(page, body, arg=None):
    """Exécute une fonction asynchrone dans la page avec les modules de l'application.
    Variables disponibles : A (js/app/audits.js), store, session, arg."""
    return page.evaluate(f"""async (arg) => {{
        const A = await import('./js/app/audits.js');
        const store = window.AuditApp.store, session = window.AuditApp.session;
        {body}
    }}""", arg)


def wait_view(page, timeout=30000):
    """Attend l'écran de l'application (session ouverte, vue affichée)."""
    page.wait_for_selector('#view', timeout=timeout)
    page.wait_for_function("() => { const v = document.querySelector('#view'); return v && v.children.length > 0; }", timeout=timeout)


def setup_standalone(page, app_url, *, org=ORG, device='Tablette test', device_no=7, name='Admin Test', username='admin',
                     password=PASSWORD, oeg=True, demo=None):
    """Première configuration de l'appareil en mode autonome (référentiel OEG), puis attente de l'application
    déverrouillée. demo : None = choix par défaut de l'écran, True / False = case cochée / décochée."""
    page.goto(app_url + 'index.html')
    page.wait_for_selector('#setupBtn')
    standalone = page.locator('[data-act=mode][data-value=standalone]')   # mode autonome : affiché d'office
    if standalone.count():
        standalone.click()
    values = dict(orgName=org, deviceName=device, deviceNumber=str(device_no), name=name, username=username,
                  password=password, password2=password)
    for k, v in values.items():
        page.fill(f'#app [name={k}]', v)
    page.set_checked('#app [name=oeg]', bool(oeg))
    if demo is not None:
        page.set_checked('#app [name=demo]', bool(demo))
    page.click('#setupBtn')
    wait_view(page, timeout=90000)
    page.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')


def lock(page):
    """Verrouille la session (bouton cadenas de l'en-tête) et attend l'écran d'ouverture de session."""
    page.click('[data-act=shell-lock]')
    page.wait_for_selector('#loginBtn')


def unlock(page, password=PASSWORD, *, username=None):
    """Ouvre la session depuis l'écran de connexion (hors connexion possible : mot de passe local)."""
    page.wait_for_selector('#loginBtn')
    if username:
        page.click(f'[data-act=pick][data-u="{username}"]')
    page.fill('#app [name=password]', password)
    page.click('#loginBtn')
    wait_view(page)
    page.wait_for_function('() => window.AuditApp && window.AuditApp.session.unlocked')


def wait_maps_idle(page, timeout=5000):
    """Attend la fin des animations de zoom des cartes Leaflet affichées (voir test_carte_quitter_pendant_le_zoom)."""
    if page.locator('#view .leaflet-container').count():
        page.wait_for_timeout(80)
        page.wait_for_function("() => !document.querySelector('.leaflet-zoom-anim')", timeout=timeout)


def goto_hash(page, hash, *, check=True, settle=True):
    """Affiche un écran (« #/planning », « #/audit/<id>/synthese »…) et attend la fin de son affichage (rendu et
    montage). check : échec si l'écran affiche une erreur de chargement ou d'affichage ; settle : attendre la fin
    des animations des cartes de l'écran."""
    path = hash[1:] if hash.startswith('#') else hash
    page.evaluate("""async (p) => {
        const r = await import('./js/ui/router.js');
        await r.navigate(p, { replace: true });
    }""", path)
    if check:
        text = page.inner_text('#view')
        assert not ERROR_CARD.search(text), f'{hash} : {text[:400]}'
    if settle:
        wait_maps_idle(page)
    return page


def create_tour(page, audit_type, site_ids, provider_id, prestation_ids=None, **options):
    """Crée une tournée (grille CT-2026) par js/app/audits.js : {id, number, auditType, stations:[clé…]}."""
    if isinstance(site_ids, str):
        site_ids = [site_ids]
    prestation_ids = list(prestation_ids or [])
    stations = [{'siteId': s, 'prestationId': prestation_ids[i] if i < len(prestation_ids) else None} for i, s in enumerate(site_ids)]
    return js(page, """const a = await A.createAudit({ auditType: arg.type, stations: arg.stations, providerId: arg.provider, ...arg.options });
        return { id: a.id, number: a.number, auditType: a.auditType, stations: a.stations.map(s => s.key) };""",
              {'type': audit_type, 'stations': stations, 'provider': provider_id, 'options': options})


def audit_state(page, audit_id):
    """Résumé de l'état d'une tournée : statut, erreurs et avertissements du contrôle avant clôture, feuilles."""
    return js(page, """const a = store.get('audit', arg); const st = A.auditState(a);
        return { status: a.status, auditType: a.auditType, providerId: a.providerId, stations: a.stations.map(s => ({ key: s.key, siteId: s.siteId, prestationId: s.prestationId })),
          errors: st.validation.filter(v => v.level === 'error').map(v => ({ itemId: v.itemId, message: v.message })),
          warnings: st.validation.filter(v => v.level === 'warning').length,
          sheets: st.sheets.map(s => ({ key: s.instanceKey, no: s.no, tournee: !s.station, items: s.items.map(i => ({ id: i.id, kind: i.kind, required: !!i.required, shared: !!i.shared, responses: i.responses || null })) })) };""",
              audit_id)


def answer_required(page, audit_id, skip=()):
    """Renseigne toutes les réponses obligatoires manquantes d'une tournée (sauf `skip`) avec des valeurs plausibles
    (statut C ou N/A, valeur selon le type de saisie), jusqu'à ce qu'il n'en manque plus. Retourne le nombre de
    réponses ajoutées."""
    return js(page, """
        const { allItems, allowedResponses } = await import('./js/domain/grids.js');
        const { itemInput } = await import('./js/domain/model.js');
        const skip = new Set(arg.skip);
        let added = 0;
        for (let round = 0; round < 6; round++) {
          const audit = store.get('audit', arg.id);
          const missing = A.auditState(audit).validation.filter(v => v.level === 'error' && /réponse obligatoire manquante/.test(v.message) && !skip.has(v.itemId));
          if (!missing.length) break;
          const items = new Map(allItems(A.effectiveGrid(audit)).map(i => [i.id, i]));
          const plausible = it => {
            const input = itemInput(it) || { type: it.kind };
            const opt = o => (o && typeof o === 'object' ? o.value : o);
            switch (input.type) {
              case 'number': return 1;
              case 'boolean': return true;
              case 'date': return audit.date || audit.startedAt.slice(0, 10);
              case 'time': return '08:30';
              case 'select': return opt((input.options || [])[0]) ?? 'Autre';
              case 'multiselect': return [opt((input.options || [])[0]) ?? 'Autre'];
              case 'fields': {
                const v = {};
                for (const f of input.fields || []) {
                  if (f.showIf) continue;
                  v[f.key] = f.type === 'number' ? 1 : f.type === 'choice' ? opt((f.options || [])[0]) : f.type === 'date' ? (audit.date || audit.startedAt.slice(0, 10)) : f.type === 'time' ? '08:30' : 'Vérifié';
                }
                return v;
              }
              default: return 'Vérifié sur place';
            }
          };
          await A.updateAudit(audit, a => {
            for (const m of missing) {
              const it = items.get(m.itemId);
              if (!it) continue;
              const allowed = allowedResponses(it);
              const prev = a.responses[it.id] || {};
              const r = it.kind === 'conformity' ? { status: allowed.includes('C') ? 'C' : allowed[0] }
                : allowed.includes('NA') && !itemInput(it) ? { status: 'NA' } : { value: plausible(it) };
              a.responses[it.id] = { ...prev, ...r, at: new Date().toISOString(), by: session.user.id, byName: session.user.name };
              delete a.responses[it.id].prefilled;
              added++;
            }
          }, { reason: 'Saisie automatique (tests)' });
        }
        return added;""", {'id': audit_id, 'skip': list(skip)})


def response(page, audit_id, item_id):
    return page.evaluate("([id, item]) => (window.AuditApp.store.get('audit', id)?.responses || {})[item] || null", [audit_id, item_id])
