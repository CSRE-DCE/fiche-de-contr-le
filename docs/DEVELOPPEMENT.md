# Guide de développement

Ce document décrit l’architecture de l’application **Fiches de contrôle terrain** (PWA de l’Office de l’Eau de Guyane) et les règles à suivre pour la faire évoluer. Pour l’utilisation et la publication, voir le [README](../README.md) ; pour GitHub, le [guide pas à pas](GUIDE-GITHUB.md).

## Sommaire

1. [Principes](#1-principes)
2. [Arborescence et modules](#2-arborescence-et-modules)
3. [Démarrage, routes et écrans](#3-démarrage-routes-et-écrans)
4. [Données et stockage](#4-données-et-stockage)
5. [Grille CT-2026](#5-grille-ct-2026)
6. [Tournée et grille effective](#6-tournée-et-grille-effective)
7. [Stockage chiffré et journal d’audit](#7-stockage-chiffré-et-journal-daudit)
8. [Service worker et version](#8-service-worker-et-version)
9. [PDF](#9-pdf)
10. [Échanges entre tablettes par fichier](#10-échanges-entre-tablettes-par-fichier)
11. [Synchronisation GitHub (option avancée)](#11-synchronisation-github-option-avancée)
12. [Conventions de code](#12-conventions-de-code)
13. [Tests](#13-tests)
14. [Outils et vérification automatique](#14-outils-et-vérification-automatique)
15. [Ajouter un critère ou une feuille sans créer de doublon](#15-ajouter-un-critère-ou-une-feuille-sans-créer-de-doublon)

---

## 1. Principes

- **Aucune étape de construction, ni Node ni npm.** JavaScript « vanilla » en modules ES, servi tel quel par n’importe quel serveur statique : `python tools/serve.py`, Live Server de VS Code, GitHub Pages sous le sous-chemin `/fiche-de-contr-le/`. Les outils et les tests sont en **Python** (pytest + Playwright) et dans le **navigateur**.
- **Chemins toujours relatifs** (`js/main.js`, `./sw.js`, `new URL('../../data/…', import.meta.url)`), jamais `/js/…` : le site est publié dans un sous-dossier.
- **Hors connexion d’abord** : tout est préchargé par le service worker ; les seules ressources réseau à l’exécution sont les tuiles de carte (OpenStreetMap par défaut) et, en option avancée non utilisée à l’OEG, l’API GitHub. Les tablettes de l’OEG échangent leurs données par fichier (section 10). Pas de CDN ; polices locales dans `fonts/`.
- **Interface 100 % en français**, apostrophe typographique ’. Accessibilité : cibles tactiles ≥ 48 px (≥ 56 px pour C / P / NC / N/A), contraste AA, mode « plein soleil » (`body.sun`).
- **Jamais de non-conformité automatique** : alertes et suggestions ne font que proposer ; le contrôleur décide (cote, écart, conclusion de feuille).
- **Pas de score global** : la synthèse ne produit que des décomptes traçables.
- Noms de stockage réservés (le domaine `github.io` est partagé avec d’autres applications) : base IndexedDB `oeg-controle-terrain`, préférences `localStorage` préfixées `oeg-ct:`, caches `oeg-ct-build-<n>` et `oeg-ct-tiles`. Ne jamais toucher aux clés d’autres préfixes.

---

## 2. Arborescence et modules

```text
index.html, manifest.webmanifest, sw.js, version.js, styles.css, .nojekyll
css/          sheet.css (habillage des feuilles, thèmes .th-*), audit-sheet.css, station.css
js/main.js    point d’entrée : routes, verrouillage par inactivité, démarrage de la synchronisation
js/core/      socle technique (DOM excepté) : stockage, chiffrement, session, comptes, médias, utilitaires
js/domain/    règles métier PURES (sans DOM ni IndexedDB) : testables dans le navigateur
js/app/       opérations applicatives : audits, PDF, synchronisation, imports, exports, réglages
js/ui/        composants et aides d’interface (gabarits HTML, icônes, carte, photo, GPS, signature)
js/views/     écrans (un module par écran)
js/formats/   formats de fichiers sans dépendance : CSV, ICS, XLSX, moteur PDF
js/lib/       géographie (UTM 21N/22N ↔ WGS84, RGFG95), contour de la Guyane
data/         referentiel-oeg.json (stations, organismes, préleveurs, campagnes des fiches terrain OEG)
fonts/        WOFF2 (écran) et fonts/pdf/*.ttf (sous-ensembles incorporés aux PDF), licences OFL
icons/, img/  logo OEG, icônes de l’application, décor forêt, photos de station (img/stations/<code>/RD|RG|AM|AV.jpg)
vendor/       Leaflet 1.9.4 (carte), jsQR (QR codes) — bibliothèques embarquées
docs/         guides, charte.html (charte vivante), maquettes/ (référence visuelle des feuilles 1 à 9)
tests/        unit/ (tests navigateur), tests pytest, fake_github.py, fixtures/
tools/        serve.py, check_release.py, bump_version.py
.github/workflows/verifications.yml, .vscode/tasks.json
```

### js/core

| Fichier | Rôle |
|---|---|
| `db.js` | IndexedDB `oeg-controle-terrain` : magasins `meta` (appareil, trousseau, curseurs ; lisible avant session), `entities` (données chiffrées), `media` (binaires chiffrés), `outbox` (modifications à envoyer) |
| `crypto.js` | AES-GCM 256 bits ; clé de données (DEK) enveloppée par mot de passe (PBKDF2-SHA256, 310 000 itérations) ; `passwordKey` (clé dérivée d’un mot de passe dédié : sauvegardes, fichiers d’échange) |
| `session.js` | état de la session en mémoire (DEK, utilisateur, appareil, mode, jeton) ; `appVersion()` |
| `store.js` | magasin de données en mémoire + persistance chiffrée, file d’envoi (`outbox` : modifications pas encore envoyées), vecteurs de versions `_vv`, journal d’audit chaîné ; `applyExchange` (réception d’un fichier : une transaction, sans journal par élément), `dropOutbox`, `getLazy` / `getLazyMany` (types lus à la demande, `LAZY_TYPES`) |
| `auth.js` | agents de la tablette (trousseau : `knownUsers`, `addLocalAccount` — « Ajouter un agent » : nouveau profil, identifiant unique parmi le trousseau et les profils —, `enrollAgent` — « Ajouter sur cette tablette », profil reçu de l’autre tablette, même identifiant de profil —, `removeAgentFromDevice` — entrée locale seulement, jamais l’agent connecté ni le dernier administrateur —, `assertAdminRemains` — jamais de dernier administrateur de la tablette rétrogradé ou désactivé), `setupFromProfile` — tablette supplémentaire mise en service avec un profil reçu —, `tabletHasAdmin`, déverrouillage hors connexion, droits (`can`, `canEditAudit`), mode équipe (option avancée non utilisée à l’OEG : `TEAM_MODE = 'github'`, jeton chiffré ; `setupTeam({ account: { id } })` réutilise un profil existant) |
| `media.js` | photos, signatures, pièces jointes (binaire chiffré + entité `media` avec empreinte SHA-256) |
| `util.js` | gabarit `html` / `raw` (échappement), dates, JSON canonique, `sha256Hex`, `diff`, tris |

### js/domain (fichiers purs)

| Fichier | Rôle |
|---|---|
| `grid-ct-2026.js` | **grille unique CT-2026** (données) et **table de traçabilité** des fiches d’évaluation en en-tête |
| `default-grids.js` | grilles fournies au démarrage (`DEFAULT_GRIDS`, CT-2026 en tête ; grilles générales historiques) ; `CT_GRID_ID` |
| `grids.js` | conditions, structure visible, avancement, validation, feuilles (`sheetsOf`), grille effective (`expandGrid`), pré-remplissage |
| `model.js` | vocabulaire : `RESPONSES` (C, P, NC, NA…), `SCALE_CPNC`, `JUSTIFY_CPNC`, `BILAN_OPTIONS`, `PREFILL_SOURCES`, `formatValue`… |
| `rules.js` | alertes (règles `item.alerts`, écart GPS par station, ancienneté des calibrations) |
| `summary.js` | synthèse sans score : décomptes par feuille, par station, par tournée ; indicateurs |
| `compare.js` | comparaison de deux audits (appariement par critère d’origine et station) |
| `merge.js` | fusion à trois versions (échanges entre tablettes, synchronisation) ; `presumedBase` (version commune présumée) |
| `exchange.js` | échanges entre tablettes : vecteurs de versions (`vvLeq`, `vvCompare`…), décision de réception (`planEntity`), version commune (`chooseBase`, `nextCandidates`), choix des données à envoyer (`selectForSend`), règle des profils (`guardProfile`), nom du fichier, décomptes |
| `permissions.js` | profils (`ROLES`) et matrice des droits (`PERMISSIONS`) ; contrôleurs OEG d’une tournée (`auditControllerIds` — audit sans `controllerIds` : son auteur —, `auditControllers`, `controllerNamesText`, `isAuditController`), droit de saisie (`canEditAuditAs`), `canJoinAudit` ; identité des agents (`agentInitials`, `agentFullName`, `suggestUsername`) |
| `seed.js` | référentiels initiaux, référentiel OEG, programmes 2026 (biologie, cours d’eau) ; identifiants déterministes |
| `normalize.js` | normalisation des valeurs importées et saisies (dates, heures, nombres) |

### js/app

| Fichier | Rôle |
|---|---|
| `audits.js` | création de tournée (`createAudit`), stations (`addStation`, `removeStation`), réponses (`setResponse`), données de feuille (`updateSheet`), écarts, signatures, verrouillage scellé, `effectiveGrid(audit)`, `auditState(audit)` |
| `bootstrap.js` | installation des données (`seedAll`) et mise à niveau idempotente (`upgradeReferentiel2026`) |
| `sheets-pdf.js` | fiches de contrôle en PDF (tournée, fiches vierges, fiche station) |
| `report.js` | rapport d’audit détaillé (PDF) |
| `attendus-pdf.js` | attendus des prestataires : chargement de `data/attendus-ct-2026.json`, modèle d’affichage par type de tournée, PDF « Fiche des attendus » et « Liste de préparation » (écran : `js/views/attendus.js`, route `#/attendus`, fenêtre « Attendu » ouverte depuis les feuilles par `openAttendu(itemId)`) |
| `static-map.js` | carte statique de la feuille 1 pour les PDF (tuiles en cache ou schéma hors connexion) |
| `github.js` | client REST GitHub, arborescence du dépôt de données, erreurs en français, empreintes git |
| `exchange-file.js` | format du fichier d’échange `.oegct` : texte ASCII, chiffrement AES-GCM avec le mot de passe d’échange, compression gzip, médias joints, empreintes SHA-256 (`encodeExchange`, `decodeExchange`, `ExchangeError`) |
| `exchange.js` | échanges entre tablettes : mot de passe d’échange, modifications à envoyer (`pendingChanges`, `exchangeState`), `prepareSend` / `markSent`, `readExchange` / `previewExchange` / `receiveExchange`, changements de profils en attente (`acceptHeld`, `refuseHeld`), historique, mise en service d’une tablette supplémentaire (`setupFromExchange`) |
| `sync.js` | moteur de synchronisation d’équipe (option avancée) |
| `numbering.js` | numéros d’audit uniques `AUD-AAAA-NNNNNN` (blocs réservés en mode équipe, plage par appareil sinon) |
| `documents.js`, `imports.js`, `exports.js`, `settings.js` | documents applicables, imports (Excel, CSV, ICS…), exports et sauvegardes, réglages et préférences |

### js/ui et js/views

`js/ui` : `router.js` (routeur par fragment `#/…`), `dom.js` (délégation d’événements, modales, notifications), `components.js`, `sheet-chrome.js` (habillage des feuilles : `oegHeader`, `stationBanner`, `infoStrip`, `sectionCard`, `blockCard`, `checkSquare`, `statusHeadCells`, `sharedBadge`, `tourStations`, `sheetFooter`…), `themes.js` (palette des feuilles : ocean, navy, green, peach, orange, violet, sky, rust, slate, teal ; partagée écran / PDF), `icons.js` (pictogrammes SVG), `map.js` (Leaflet, préchargement des tuiles, `TYPE_STYLES`), `capture.js`, `gps.js`, `signature.js`, `scanner.js`, `voice.js`.

`js/views` : un module par écran (tableau de la section 3) ; `exchange.js` regroupe les fenêtres et cartes des échanges entre tablettes (envoyer, recevoir, mot de passe d’échange, historique, changements de profils à valider), utilisées par l’accueil, l’écran Échanges entre tablettes et l’Administration ; `station-sheet.js` produit la feuille 1 (fiche station) pour la page station, l’audit et les aides « station » partagées ; `audit-sheet.js` produit l’audit en feuilles ; `audit-modules.js` les éléments communs (signatures, documents, alertes, écarts).

---

## 3. Démarrage, routes et écrans

`index.html` charge `version.js`, Leaflet, puis `js/main.js` (module) et enregistre `sw.js`. `main.js` ouvre la base, affiche la mise en service (`views/auth.js : renderSetup` : deux choix, « Première tablette de l’équipe » `#setupFirst` et « Tablette supplémentaire : recevoir le fichier de l’autre tablette » `#setupExtra`) ou l’ouverture de session « Qui utilise la tablette ? » (`renderLogin` ; `pick: 'none'` après « Changer d’agent » : aucun agent présélectionné), puis la structure (`views/shell.js`, bouton « Changer d’agent » = `lockApp('changement d’agent')`, qui enregistre la saisie en cours, ferme les fenêtres et messages ouverts et rappelle, sans bloquer, les modifications pas encore envoyées à l’autre tablette ; après ce bouton ou un verrouillage par inactivité, un autre agent que le précédent arrive sur la tournée affichée, sinon sur l’accueil), le routeur et la synchronisation. La mise en service prépare le mode autonome (celui de l’OEG) ; « Rejoindre une équipe » n’est qu’une option avancée repliée (`#setupAdvanced`), comme dans l’écran Échanges entre tablettes (`#teamAdvanced`).

Le routeur (`js/ui/router.js`) numérote les rendus : si un rendu plus récent commence pendant qu’un écran se construit (navigation pendant un rendu lent, rafraîchissement après synchronisation), l’ancien abandonne sans toucher au DOM — un écran n’a jamais deux jeux de gestionnaires.

| Route | Module | Écran |
|---|---|---|
| `#/` | `home.js` | Stations (accueil) ; `?type=bio|ce|eso`, `?bassin=`, `?statut=`, `?q=` |
| `#/planning` | `planning.js` | Planning des prestations |
| `#/station/:id` | `station.js` | Fiche station ; `?type=` (variante) |
| `#/station/:id/modifier` | `station-edit.js` | Modification d’une station |
| `#/prestation/:id` | `prestation.js` | Préparation d’une prestation |
| `#/nouvel-audit` | `audit-new.js` | Nouvelle tournée ; `?site=`, `?prestation=`, `?prestations=a,b`, `?type=`, `?kind=inopine`, `?mode=general` (grille historique) |
| `#/audit/:id/:step?` | `audit.js` (+ `audit-sheet.js`) | Audit ; étapes `feuille-<no>` (feuille de tournée), `feuille-<no>@<clé>` (feuille d’une station), `ecarts`, `synthese`, `signatures`, `infos` |
| `#/audits`, `#/comparer` | `audits.js`, `compare.js` | Liste / historique, comparaison (`?a=&b=`) |
| `#/ecarts`, `#/ecart/:id` | `deviations.js` | Registre des écarts, détail |
| `#/observations`, `#/carte`, `#/tableau-de-bord` | `observations.js`, `map.js`, `dashboard.js` | Observations et urgences, carte, tableau de bord |
| `#/prestataires`, `#/prestataire/:id` | `providers.js` | Prestataires |
| `#/documents`, `#/grilles`, `#/referentiels` (+ détails) | `documents.js`, `grids.js`, `referentials.js` | Gestion |
| `#/import`, `#/export` | `imports.js`, `exports.js` | Import, export, paquets |
| `#/synchronisation`, `#/journal` | `sync.js`, `trail.js` | Échanges entre tablettes (mode autonome ; « Synchronisation » en mode équipe), journal d’audit |
| `#/administration`, `#/compte`, `#/menu` | `admin.js`, `menu.js` | Administration, Mon compte, menu (téléphone) |

### Contrat d’un écran

```js
export default {
  nav: 'home',                // entrée de navigation à mettre en surbrillance
  title: 'Stations',
  async render(params, query, ctx) { return html`…`; },   // HTML (gabarit échappé)
  async mount(root, params, query, ctx) { … },            // facultatif : carte, médias…
  unmount() { … },                                        // facultatif : libération
  handlers: {
    // data-act="nom" (clic), data-change="nom", data-input="nom", <form data-submit="nom">
    async nom(el, ev) { this.params; this.query; await this.refresh(); this.navigate('/…'); }
  }
};
```

`this` vaut le contexte `{ params, query, refresh, navigate }`. `refresh()` réaffiche l’écran en gardant le défilement. Les erreurs levées par un gestionnaire s’affichent en notification.

---

## 4. Données et stockage

Tout passe par `store` (`js/core/store.js`) : `get(type, id)`, `all(type)`, `find`, `filter`, `count`, `put(type, data, { reason, action })`, `bulkPut`, `remove(type, id, reason)` (suppression logique `_deleted`), `log(action, …)`, `subscribe(fn)`, `getRaw` (y compris supprimés), `flush()`. Les entités sont gardées en mémoire après ouverture de session ; chaque écriture met à jour les métadonnées (`createdAt`, `updatedBy`…), entre dans la file d’envoi (`outbox`) et produit une entrée du journal.

Principaux types : `site`, `point`, `provider`, `operator`, `campaign`, `prestation`, `grid`, `document`, `audit`, `deviation`, `media`, `observation`, `alert`, `user`, `setting`, `trail`, référentiels (`samplingType`, `matrix`, `criticality`, `deviationType`…). Types **locaux, jamais échangés ni synchronisés** (`LOCAL_ONLY`) : `conflict`, `syncLog`, `localSecret` (mot de passe d’échange, jeton GitHub : chiffrés), `syncBase`, `exchangeLog` (historique des échanges), `heldChange` (changements de profils reçus en attente). Type **lu à la demande** (`LAZY_TYPES`, jamais chargé en mémoire) : `xbase` (versions déjà échangées de chaque donnée, bases des fusions).

Métadonnées d’une entité (`META_FIELDS`, ignorées par les comparaisons et le journal) : `createdAt`, `createdBy(Name)`, `updatedAt`, `updatedBy(Name)`, `_lv` (version locale), `_rev` (empreinte du dépôt, mode équipe) et **`_vv`**, vecteur de versions `{ identifiant de tablette: nombre de modifications faites sur cette tablette }`, incrémenté à chaque écriture locale d’une donnée partagée (`put`, `bulkPut`) ; exclu de l’empreinte scellée des audits.

Station (`site`) : `code` (SANDRE ou BSS selon `codeType`), `name`, `bassin`, `riverName`, `commune`, `x`/`y` (RGFG95 / UTM 22N), `types` (`bio`, `ce`, `eso`), `compartments`, `access`, `difficulties`, `photos` (créneaux RD / RG / AM / AV : `mediaId` prioritaire sur `src` statique), `samplingPoints` ; eaux souterraines : `nature`, `usage`, `aquifere`.

---

## 5. Grille CT-2026

Fichier : [js/domain/grid-ct-2026.js](../js/domain/grid-ct-2026.js), export `GRID_CT_2026` (`id: 'grid-ct-2026-v1'`, `code: 'CT-2026'`, `layout: 'sheets'`). C’est une **donnée pure** ; la logique est dans `grids.js`.

### Structure

```js
GRID_CT_2026 = {
  id, code, version, status: 'publiee', name, layout: 'sheets', description, scope, settings,
  providers: ['prov-TL1', 'prov-OEG', 'prov-HYDRECO', 'prov-NBC'],   // proposés en premier
  header: { org, title: 'Contrôle terrain prestataire – {prestataire} – {programme}', subtitle, … },
  types: [ { key: 'bio' | 'ce' | 'eso', label, short, program, matrixCodes, compartments, codeType, … } ],
  compartments: [ { key, label, icon, always? } ],   // organisation (toujours), physico, eso, invertebres, diatomees, poissons, phytoplancton
  sheets: [ { no, key, tab, title, kicker, theme, compartment, compartments?, scope, layout, blocks, modules, variants?, … } ],
  sections: [ { id, sheet, no, title, columns: 'full' | 'value', domain, condition, headers?, items: [ … ] } ]
};
```

- **Types de tournée** (`types`, `audit.auditType`) : `bio` (Hydrobiologie – RCS ESC BIO), `ce` (Cours d’eau – physico-chimie), `eso` (Eaux souterraines).
- **Feuilles** : l’ordre d’affichage est celui du tableau `sheets` (F1, F2, F3, **F10**, F4, F5, F6, F7, F8, F9) ; `no` est un identifiant **stable**. Le rang affiché « Feuille X / N » est calculé parmi les feuilles visibles (`sheetsOf` : `index`, `total`).
- **Portée** (`sheet.scope`) : `'tournee'` (F2, renseignée une fois) ou `'station'` (toutes les autres, répétées par station). Dans une feuille station, `item.scope: 'tournee'` déclare un critère **commun à la tournée** (badge « Commun à la tournée », une seule réponse) : F4.2, F4.18 à F4.25, F5.11, F5.12, F5.14, F5.15, F5.17, F5.18, F5.29, F5.30.
- **Visibilité** : une feuille s’affiche si l’un de ses compartiments (`compartment` / `compartments`) est retenu pour la tournée ; les sections et critères portent des `condition`s.
- **Variantes** (`sheet.variants[type]`) : titre, onglet, surtitre ou appareils propres à un type (`resolveSheet`). **Encadrés** (`blocks`) : `observations`, `notes`, `photos`, `conclusion` (`options`, `fields` : `controller`, `date`, `signature`, `providerSignature`, `comments`) ; `showFor` limite un encadré à certains types (bilans « Satisfaisant / Perfectible / Non satisfaisant » de F3, F4, F5, F10 pour `ce` / `eso`). **Modules** : `instruments` (F4 : appareils de mesure et tableau d’étalonnage, donnée de tournée déclarée par `tourneeData`).

Nombre de critères par feuille (grille de base, tous types confondus, vérifié par les tests) :

| F1 | F2 | F3 | F10 | F4 | F5 | F6 | F7 | F8 | F9 | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 47 | 33 | 7 | 31 | 30 | 13 | 14 | 17 | 13 | **213** |

Feuilles affichées pour une station : biologie 9 (F1 à F9, compartiments complets), cours d’eau 5 (F1, F2, F3, F4, F5), eaux souterraines 6 (F1, F2, F3, F10, F4, F5).

### Critères (items)

```js
{ id: 'it-F4-12', code: 'F4.12', no: '12', label: 'Flaconnage conforme', short: 'Flac',
  kind: 'conformity', responses: ['C', 'P', 'NC', 'NA'], required: true, justifyOn: ['P', 'NC'],
  input: { type: 'text' },            // champ « Valeur / réponse » (facultatif)
  help: 'Inclut : …', condition: …, prefill: …, scope: 'tournee'?, domain: 'transport'?, alerts: [ … ]? }
```

- **Identifiants** : `id = it-F<feuille>-<no>`, `code = F<feuille>.<no>` (ex. `it-F2-1.11`, `it-F8-A3`, `it-F1-R8`), **uniques et stables** : les réponses des audits y sont rattachées. Dans la grille effective, un critère de station devient `it-F<n>-<no>@<clé>` (clé = code de la station).
- `short` = « Référence courte » des maquettes (≠ `refs`, références documentaires).
- **Échelle** : critères de conformité `kind: 'conformity'`, `responses: SCALE_CPNC` (`['C','P','NC','NA']`), `justifyOn: JUSTIFY_CPNC` (`['P','NC']`) — observation obligatoire pour P et NC. Critères « valeur seule » : `kind` `text`, `longtext`, `date`, `time`, `number`, `select` ou `fields`, sans cote.
- **`input`** : `text`, `longtext`, `number` (`unit`, `min`, `max`, `step`), `date`, `time`, `select` (`options`), `fields` (valeur OBJET : champs `text` / `number` / `date` / `time` / `choice`, `showIf`, `unitKey` ; `gps: true` ⇒ bouton de relevé X / Y RGFG95, avec `lat`, `lon`, `accuracy`, `at`). Affichage lisible : `formatValue(item, value)` (`model.js`).
- **Conditions** (`evalCondition`) : `{ item, field?, op, value }` (réponse d’un autre critère ; `field` = champ d’une valeur objet, ex. `{ item: 'it-F10-3', field: 'alimentation', op: 'in', value: ['Véhicule', 'Groupe électrogène'] }`) ; `{ ctx: 'auditType' | 'compartments' | 'matrixCode', op, value }` ; combinaisons `{ all: [] }`, `{ any: [] }`, `{ not: … }`. Opérateurs : `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `answered`, `empty`, `truthy`, `falsy`. Aides de `grid-ct-2026.js` : `ONLY(compartiment)`, `FOR(...types)`, `NOT_FOR(...types)`, `PHYSICO_OR_ESO`.
- **Pré-remplissage** (`prefill`, appliqué une fois à la création ou à l’ajout de la station, réponse marquée `prefilled: true`, sans cote) : `site.name`, `site.code`, `site.bassin`, `site.riverName`, `site.commune`, `site.her`, `site.pressions`, `site.strahler`, `site.xy`, `audit.date`, `audit.time`, `audit.kind`, `tournee.stationCount`, `auditor.name`, `provider.name`, `prestation.operators` (`PREFILL_SOURCES`, `prefillResponses`).
- `suggest` : valeur calculée proposée, jamais appliquée seule (ex. amplitude horaire 5.2 → 5.3). `labelTemplate` : libellé complété avec le prestataire (`Opérateurs {prestataire}`).
- Les numéros en double des maquettes (F3 « 16 », F4 « 16 », F9 « 12 ») sont corrigés en 17 / 17 / 13.

### Table de traçabilité

L’en-tête de `grid-ct-2026.js` contient une ligne par point des fiches d’évaluation (Agences de l’eau / Aquascop 2026, non reproduites dans le dépôt) :

```text
 * [CE] Propreté des flacons → it-F4-23
 * [CE] Site choisi pour les mesures → it-F4-11 (Inclut)
 * [ESO] Nature → site.nature (fiche station, feuille 1)
 * [CE] Colonne « Aquascop » (contre-mesures …) → exclue (décision A.3 : pas de contre-mesures) ; it-F4-26 ; it-F4-27
```

Format : ` * [CE|ESO] <point de la fiche> → <cible>[ ; <cible>…]`. Une cible est un identifiant de critère (suivi de ` (Inclut)` si le point est fusionné dans l’aide `Inclut : …` d’un critère existant) ou une donnée de l’audit / de la station (`audit.…`, `site.…`, synthèse, encadré, module, conclusion, exclusion motivée). Le test « traçabilité » de `tests/unit/grid-ct-2026.test.js` lit cette table et vérifie : 70 points CE et 42 points ESO, aucun point en double, chaque critère cité existe, chaque `(Inclut)` correspond à une aide commençant par `Inclut : `, et chaque critère ajouté par l’avenant provient d’au moins un point (pas de critère orphelin).

---

## 6. Tournée et grille effective

Un audit = une **tournée** :

```js
audit = {
  id, number: 'AUD-2026-000123', auditType: 'bio' | 'ce' | 'eso', kind: 'inopine' | 'planifie',
  stations: [ { key, siteId, pointId, prestationId, addedAt } ],      // ordre de passage ; key = siteId sans « site- »
  siteId, prestationId, pointId,                                       // ceux de la 1re station (compatibilité)
  prestationIds, providerId, operatorIds, compartments,
  gridId, gridVersion, gridSnapshot, gridSha256, documentsSnapshot,    // copie FIGÉE de la grille et des documents
  responses: { [idEffectif]: { status, value, comment, at, by, byName, prefilled? } },
  sheets: { [instanceKey]: { observations, notes, photos, conclusion: { status, comments }, agents }, '4': { instruments } },
  conclusions: { comment, preconisations, strengths, vigilance },
  signatures: { auditor, provider }, lock, amendments, stationLog, status, startedAt, endedAt, appVersion, device
}
```

- **Grille effective** : `expandGrid(grid, stations, sites, { provider })` (pur, `grids.js`) duplique chaque section d’une feuille `scope: 'station'` pour chaque station (`id: sec.id + '@' + clé`), suffixe ses critères (`id: it.id + '@' + clé`, `code: it.code + '·S' + rang`, `baseId`, `station`) et réécrit les conditions internes à la feuille ; les critères `scope: 'tournee'` gardent leur id (`shared: true`) et sont **comptés une seule fois** (`allItems`, `progress`, `validateResponses`, synthèse, comparaison). `effectiveGrid(audit)` (`app/audits.js`) est utilisée par **tous** les consommateurs : écran, alertes, synthèse, PDF, exports, écarts.
- **Instances de feuilles** : `sheetsOf(grilleEffective, responses, ctx)` → `{ no, instanceKey, station, index, total, sections, items, shared, … }` avec `instanceKey = String(no)` (feuille de tournée) ou `no + '@' + clé` (feuille de station). Données de feuille : `audit.sheets[instanceKey]` ; données de tournée d’une feuille station (appareils de F4) : `audit.sheets['4']` (`sheetStoreKey`).
- **Contrôleurs OEG (binôme)** : `audit.controllerIds` (ordre de la tournée ; l’agent qui crée est toujours inclus), `audit.controllerNames` `{ id: nom }` (noms figés), `audit.controllerLog` (ajouts / retraits : `at`, `by`, `byName`, `action`, `userId`, `name`, `reason`). Un audit antérieur sans `controllerIds` a pour contrôleur son auteur (`auditorId`). Droit de saisie (`canEditAudit`) : contrôleur de la tournée ou encadrement (`audit.editOthers`) ; verrouillage inchangé. `addController` / `joinTour` (« Rejoindre la tournée ») / `removeController` (motif obligatoire, jamais le dernier) : impossibles après la signature du contrôleur ; noms pré-remplis (`prefill: 'auditor.name'` : « Agent(s) OEG », « Contrôleur OEG ») mis à jour s’ils n’ont pas été modifiés. Chaque réponse garde son auteur (`by`, `byName`) : `entriesByAgent(audit)` (onglet Infos, rapport). Signature « contrôleur » par n’importe quel contrôleur ; `controllerIds` et `controllerNames` font partie du contenu scellé.
- **Opérations** : `createAudit({ auditType, stations: [{ siteId, prestationId }], providerId, kind, compartments, operatorIds, controllerIds })`, `addStation(audit, { siteId, prestationId })`, `removeStation(audit, key, { reason })` (motif obligatoire si des saisies existent), `setResponse`, `updateSheet(audit, no, patch, { reason })`, `updateAudit(audit, mutate, { reason })`.
- **Écarts** : créés uniquement par l’auditeur, depuis un P (criticité proposée `OBS`) ou un NC (`MIN`) — `DEFAULT_CRITICALITY` ; l’écart mémorise `stationKey`.
- **Scellement** : `signAudit` (empreinte du contenu au moment de la signature), `lockAudit` (exige la signature du contrôleur et celle du prestataire ou son refus motivé ; empreinte SHA-256 de `auditContent(audit)`, qui inclut `auditType`, `stations`, `compartments`, `controllerIds`, `controllerNames`, `sheets`, les constats d’écarts et les médias), `verifyAuditSeal`. Après verrouillage : amendements motivés (`audit.amend`), chacun historisé avec empreinte avant / après.

---

## 7. Stockage chiffré et journal d’audit

- **Chiffrement** : une clé de données aléatoire (DEK) par appareil chiffre toutes les entités et tous les médias (AES-GCM 256 bits, IV aléatoire). Pour chaque agent de la tablette, la DEK est enveloppée par une clé dérivée de SON mot de passe (PBKDF2-SHA256, 310 000 itérations, sel aléatoire) dans le trousseau (`meta.keyring` : `{ users: { identifiant: { userId, name, initials?, role, wrap, githubLogin?, disabled?, lastLogin } } }`). Le profil `user` (`{ id, username, name, firstName, lastName, initials, role, active }`, échangé entre tablettes) fait foi pour le nom, les initiales, le rôle et l’activation ; une entrée du trousseau n’existe que sur la tablette où l’agent a été ajouté. Ouvrir une session = désenvelopper la DEK, **hors connexion**. À la fermeture (manuelle ou après inactivité, 30 min par défaut), la DEK est effacée de la mémoire.
- **Journal d’audit** : chaque écriture produit une entrée `trail` (qui, quoi, quand, appareil, valeurs avant / après, motif), **chaînée** à la précédente par empreinte SHA-256 : une suppression ou altération rompt la chaîne (écran Journal › « Vérifier l’intégrité »). Les suppressions sont logiques.
- **Médias** : binaire chiffré dans le magasin `media` ; entité `media` (empreinte, horodatage, GPS, lien vers l’objet contrôlé). Un média n’est jamais modifié (une annotation crée un nouveau média `derivedFrom`).
- **Préférences** d’appareil (non sensibles) : `localStorage` préfixé `oeg-ct:` (`pref`, `setPref` de `app/settings.js`).
- **Appareil révoqué** (mode équipe) : base IndexedDB détruite, préférences `oeg-ct:` et cache de tuiles effacés (`onRevoked` de `main.js`).

---

## 8. Service worker et version

- **`version.js`** : `self.AUDIT_BUILD` (entier), `self.AUDIT_BUILD_DATE`, `self.AUDIT_VERSION = '1.0.' + AUDIT_BUILD`. Lu par la page (affiché sur l’écran de connexion, enregistré dans chaque audit) et par le service worker (`importScripts('./version.js')`).
- **`sw.js`** : cache `oeg-ct-build-<AUDIT_BUILD>` ; la liste **`SHELL`** énumère tous les fichiers préchargés à l’installation (l’application fonctionne hors connexion dès la première ouverture). Stratégies : fichiers de l’application « réseau d’abord, repli sur le cache » ; tuiles de carte « cache d’abord » dans `oeg-ct-tiles`, conservé d’une version à l’autre. À l’activation, les anciens caches `oeg-ct-build-*` sont supprimés.
- **Règles** :
  - toute modification des fichiers de l’application ⇒ **incrémenter `AUDIT_BUILD`** (`python tools/bump_version.py`) : c’est ce qui réinstalle le service worker et renouvelle le cache d’un bloc sur les appareils ;
  - tout **nouveau fichier** chargé par l’application (module JS, CSS, image, police, donnée) ⇒ l’ajouter à `SHELL` (chemin relatif `./…`), sinon il manque hors connexion (`tools/check_release.py` signale l’oubli) ;
  - `index.html` enregistre `sw.js` avec `updateViaCache: 'none'` et vérifie les mises à jour au chargement et au retour au premier plan ; Mon compte › « Rechercher une mise à jour » force la vérification.

---

## 9. PDF

- **`js/formats/pdf.js`** : générateur PDF 1.4 sans dépendance (`PDFDocument`, formats `A4` et `A4_LANDSCAPE`) : texte en flux, tableaux, formes (rectangles arrondis, cercles, courbes de Bézier, chemins SVG), images JPEG et RGBA avec transparence (SMask, compression `CompressionStream('deflate')`), polices TrueType incorporées (encodage WinAnsi) avec repli Helvetica, pages d’orientations différentes, filigrane.
- **`js/app/sheets-pdf.js`** — chaque fonction retourne `{ bytes, filename, pages, provisional }` :
  - `generateSheetsPdf({ auditId })` : rapport de tournée = F2 une fois, puis les feuilles de chaque station (F1 portrait, autres feuilles paysage ; pied de page « Station i / n — Feuille X / N »), synthèse, signatures ; filigrane **PROVISOIRE** tant que l’audit n’est pas verrouillé ; numéro d’audit et empreinte en pied de page ;
  - `generateBlankSheetsPdf({ auditType, siteId | siteIds, compartments })` : fiches vierges imprimables (valeurs du référentiel seulement) ;
  - `generateStationSheetPdf({ siteId, auditType })` : feuille 1 seule.
  Le rendu (`buildSheetsPdf`) reçoit un modèle (`sheetsModelFromAudit`, `blankSheetsModel`) : testable sans base de données. Polices `fonts/pdf/*.ttf` (Barlow, Barlow Condensed, Montserrat), couleurs de `js/ui/themes.js`, pictogrammes de `js/ui/icons.js` et logo rastérisés par canvas.
- **`js/app/static-map.js`** : carte de la feuille 1 composée à partir des tuiles (cache `oeg-ct-tiles` ou réseau), sinon schéma (silhouette de la Guyane, point, coordonnées).
- **`js/app/report.js`** : rapport d’audit détaillé (16 rubriques + synthèse), habillage OEG.

---

## 10. Échanges entre tablettes par fichier

Mode autonome, **celui de l’OEG** : aucun serveur, aucun jeton, hors connexion. Les tablettes s’échangent un **fichier unique** (`js/app/exchange.js`, écrans `js/views/exchange.js`).

**Fichier `.oegct`** (`js/app/exchange-file.js`) — texte ASCII, pour traverser e-mail, Teams, Quick Share, Bluetooth, clé USB :

```text
OEG-CT-ECHANGE 1
{"format":"oeg-ct-echange","v":1,"kdf":"PBKDF2-SHA256","iterations":310000,"salt":…,"iv":…,"check":{iv,ct},"z":"gzip"}
<contenu chiffré AES-GCM 256, en base64, lignes de 76 caractères>
```

Contenu déchiffré : `[longueur du corps : 4 octets][corps JSON compressé gzip][octets des médias]`. Corps : `{ format, v, id, createdAt, scope ('changes'|'all'), from: { id, name, number }, sentBy: { id, name, role, username }, devices, counts, entities: { type: [versions] }, media: [{ id, size, sha256 }], sha256 }` ; `sha256` = empreinte du JSON canonique du corps sans elle ; chaque média a la sienne. Erreurs (`ExchangeError.code`) : `password` (autre mot de passe d’échange : `check` ne se déchiffre pas), `altered` (authentification AES-GCM en échec), `integrity` (empreinte), `format`, `version`. Nom : `OEG-echange_<tablette>_<AAAA-MM-JJ_HHhMM>.oegct` (`exchangeFileName`).

**Mot de passe d’échange** : défini par un administrateur sur chaque tablette (10 caractères minimum ; à la mise en service de la première tablette, puis repris à la mise en service des suivantes), conservé chiffré (`localSecret` `exchange:password`), jamais dans un fichier.

**Envoyer** (`prepareSend`, `markSent`) : `selectForSend` prend les entrées de la file d’envoi (`outbox`, alimentée par toute écriture locale ; `__bin:<id>` = contenu d’un média) ou tout (`scope: 'all'`), jamais les types `LOCAL_ONLY` ni `LAZY_TYPES` ; pierres tombales `_deleted` comprises (suppressions) ; `_rev` et `_lv` retirés. Le fichier n’est marqué envoyé qu’une fois partagé (API Web Share : `navigator.canShare({ files })`, nom `….oegct.txt` / `text/plain` si Android refuse l’extension) ou enregistré (téléchargement) : `dropOutbox` retire de la file les entrées inchangées depuis la préparation, et les versions envoyées sont mémorisées (`xbase`). Au-delà de `LARGE_FILE` (20 Mo) : envoi proposé sans les photos déjà envoyées (« Tout envoyer ») ou avec les photos au prochain envoi.

**Recevoir** (`readExchange`, `previewExchange`, `receiveExchange`) : rien n’est modifié avant la confirmation de l’aperçu ; un fichier venant de la tablette elle-même est refusé ; les anciens paquets JSON (`oeg-audit-package-v1`, éventuellement chiffrés) sont convertis. Pour chaque donnée, `planEntity` (`js/domain/exchange.js`) compare les vecteurs de versions :

| Cas | Décision |
|---|---|
| absente de la tablette | `add` |
| version reçue contenue dans la version locale (fichier ancien, déjà reçu) | `known` : ignorée (idempotence ; jamais d’écrasement d’une saisie plus récente) |
| même contenu | `same` : versions réunies |
| version reçue contenant la version locale | `replace` |
| concurrentes | `merge` : `mergeEntity` à trois versions avec la dernière version commune (`chooseBase` parmi les versions déjà échangées, sinon `presumedBase`) ; conflits → entité `conflict` ; nouvelle version `_vv` incrémentée et renvoyée |
| audit signé d’un seul côté (ou des deux, différemment) | `signed` : version signée gardée telle quelle (scellé et empreinte intacts), l’autre dans le rapport de conflit |

Journal d’audit : entrées absentes ajoutées telles quelles (chaîne vérifiable par appareil). Médias : contenu stocké chiffré avec la clé de la tablette. Le tout en une transaction (`store.applyExchange`), puis rapport de conflit, changements de profils en attente, historique (`exchangeLog`), journal (`exchange-receive`), fichiers déjà reçus (`meta xch:received`), tablettes connues (`meta xch:devices` : n° proposé à la mise en service d’une tablette supplémentaire, avertissement si deux tablettes ont le même n°).

**Règle des profils** (`guardProfile`) : rôle, statut actif ou suppression d’un agent, et nouveau profil administrateur, ne sont appliqués d’office que si l’expéditeur du fichier (`sentBy`) est un administrateur actif **selon les données de la tablette qui reçoit** (avant réception) ; sinon la valeur locale est gardée et une entité `heldChange` attend la validation d’un administrateur (Administration › « Changements de profils reçus à valider » : `acceptHeld`, `refuseHeld`). Le dernier administrateur de la tablette n’est jamais retiré par un fichier. Le trousseau n’est jamais remplacé (`syncKeyringProfile` : nom, initiales, profil affichés). La frontière de sécurité réelle est le mot de passe d’échange : le documenter honnêtement.

**Mise en service d’une tablette supplémentaire** (`setupFromExchange`) : fichier + mot de passe d’échange, n° libre proposé, « Qui êtes-vous ? » parmi les agents actifs reçus (administrateurs d’abord) : `setupFromProfile` crée l’entrée du trousseau avec le MÊME identifiant de profil, puis tout le fichier est reçu (sans règle des profils). Mise en service par un agent qui n’est pas administrateur : un administrateur s’ajoute ensuite lui-même (`enrollAgent` autorise l’ajout d’un administrateur sur une tablette qui n’en a pas).

## 11. Synchronisation GitHub (option avancée)

Modes (`session.mode`) : `standalone` (autonome, **le mode de l’OEG** : échanges entre tablettes par fichier) et `github` (équipe : `TEAM_MODE` de `core/auth.js` ; option avancée, nécessite un jeton GitHub, non utilisée à l’OEG — code et tests conservés). Paramètres d’équipe : `{ apiUrl, owner, repo, branch: 'main', prefix: 'donnees/' }` ; jeton fine-grained **de la tablette** conservé chiffré (entité locale `localSecret`) : un jeton par tablette, créé par l’administrateur ; les agents n’ont pas de compte GitHub. `session.githubLogin` est le login du **propriétaire du jeton**, pas celui de l’agent connecté.

### Arborescence du dépôt de données

```text
donnees/                                  (préfixe configurable)
  config/equipe.json                      { format: 'oeg-ct-donnees-v1', createdAt, orgName }
  config/utilisateurs.json                { users: [{ login, name, role, active }] }
  config/appareils.json                   { devices: [{ id, no, name, registeredAt, registeredBy, revoked, revokedAt, revokedBy }] }
  config/sequences.json                   { "AUD-2026": 12 }   (dernier numéro réservé)
  entites/<type>/<id>.json                une entité par fichier, JSON stable (clés triées)
  journal/<AAAA-MM>/<AAAA-MM-JJ>_<appareil>.json   journal d’audit d’un appareil pour un jour
  medias/<id>                             contenu binaire des photos, signatures, documents
```

### Algorithme (`js/app/sync.js`)

1. **Réception différentielle** : la tête de branche est comparée à la dernière reçue ; seuls les sous-arbres dont l’empreinte a changé sont parcourus, seuls les fichiers dont l’empreinte git (SHA-1 de `blob <taille>\0<contenu>`, mémorisée localement) a changé sont téléchargés.
2. **Fusion à trois versions** (`domain/merge.js`, version commune `syncBase`) : champ par champ ; même champ modifié des deux côtés ⇒ valeur la plus récente retenue, l’autre conservée dans une entité `conflict` consultable et restaurable.
3. **Envoi atomique** : toutes les modifications en attente forment **un** commit (API Git Data : blobs → arbre(s) → commit → mise à jour de la référence **sans forçage**). Refus « non fast-forward » (autre appareil passé entre-temps) ⇒ relire, fusionner, réessayer (6 tentatives).
4. **Numéros d’audit** réservés par blocs de 25 dans `config/sequences.json` (dans le même commit) ; plage de secours propre à l’appareil si le bloc est épuisé hors connexion. **Appareils** : n° unique attribué par `config/appareils.json` ; appareil révoqué ⇒ effacement local. **Rôles** (`applyTeamRoles`) : `config/utilisateurs.json`, appliqué seulement aux agents explicitement rattachés à un login (`githubLogin` du profil, qui fait foi, à défaut du trousseau) ; les autres agents gardent leur profil local — le login du jeton de la tablette n’est jamais attribué à un autre agent ; membre désactivé ⇒ session fermée. `replaceToken` ne rattache l’agent connecté au login du nouveau jeton que s’il était déjà rattaché au login du jeton remplacé. `probeTeam(…, { profiles: true })` lit aussi les profils rattachés au login du jeton (écran « Rejoindre une équipe » : « C’est moi »).
5. Déclencheurs : ouverture de session, 8 s après une modification, toutes les 5 minutes en ligne, retour du réseau, bouton « Synchroniser maintenant ». Chaque synchronisation est tracée (`syncLog`).

**Sécurité** : les droits sont appliqués par l’application ; la vraie frontière est l’accès au dépôt privé (qui détient un jeton peut tout lire et écrire). Les fichiers du dépôt de données sont en clair pour ceux qui y ont accès. L’application refuse un dépôt public et n’accepte qu’une API en HTTPS (sauf `localhost` pour les tests).

`js/app/github.js` ne dépend ni du stockage ni de la session : il est testé seul avec un `fetch` simulé (`tests/unit/github.test.js`). Les scénarios de bout en bout à deux appareils utilisent un faux serveur de l’API (`tests/fake_github.py`, empreintes git exactes, refus « non fast-forward ») : `tests/test_sync_github.py`.

---

## 12. Conventions de code

- En-tête de fichier en commentaire, **en français**, décrivant le rôle du module ; densité de commentaires comparable à l’existant ; noms de fonctions et de variables en anglais ou en français selon le module voisin.
- Gabarits : `html\`…\`` échappe toutes les valeurs interpolées ; `raw()` uniquement pour du HTML déjà sûr. Jamais de concaténation de HTML avec des données saisies.
- Actions par attributs : `data-act` (clic), `data-change`, `data-input`, `data-submit` ; pas d’écouteurs d’événements dispersés.
- Les règles métier vont dans `js/domain` (fonctions **pures**, sans DOM ni IndexedDB) ; les écritures passent par `js/app` et `store` (journalisées, avec motif quand c’est pertinent).
- Données : ne jamais effacer physiquement (suppression logique) ; un audit verrouillé ne se modifie que par amendement motivé.
- Texte : français, apostrophe ’, espaces avant `:` `;` `?` `!` comme le reste de l’interface ; dates `JJ/MM/AAAA` à l’affichage.
- Pas de dépendance externe nouvelle sans l’embarquer dans `vendor/` (avec sa licence) et l’ajouter à `SHELL`.

---

## 13. Tests

### Tests unitaires dans le navigateur

- Page : `tests/unit/index.html` (servie par `python tools/serve.py` : <http://localhost:8000/tests/unit/index.html>) ; paramètre `?files=grid-ct-2026,core` pour n’exécuter que certains fichiers.
- `tests/unit/all.js` liste les fichiers : `core.test.js`, `domain.test.js`, `formats.test.js`, `grid-ct-2026.test.js`, `pdf-sheets.test.js`, `github.test.js`, `attendus.test.js`, `exchange.test.js` (un fichier absent ou en erreur est compté comme un échec). `exchange.test.js` : format `.oegct`, mauvais mot de passe, fichier altéré, empreinte incorrecte, versions, fusion, tournée signée, deux tablettes simulées (fichiers croisés, fichier ancien, idempotence), envoi incrémental, règle des profils.
- `tests/unit/harness.js` exporte `test(name, fn)` (fn peut être asynchrone), `assert(cond, msg)`, `eq(actual, expected, msg)` (`===`), `deepEq(actual, expected, msg)` (JSON canonique), `throwsAsync(fn, msg)`. Résultat publié sur `window.__UNIT_RESULTS__ = { done, passed, failed, failures: [{ name, error }] }`.
- Les tests importent les modules par chemins relatifs (`../../js/...`) et testent de préférence des modules purs (sans IndexedDB).
- Nouveau fichier `tests/unit/<nom>.test.js` : l’ajouter à la liste `FILES` de `all.js` (`tests/test_unit.py` vérifie que la liste et le dossier correspondent, puis exécute chaque fichier séparément avec `?files=<nom>`).

### Tests pytest + Playwright

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium     # une fois sur la machine de développement (Linux : --with-deps chromium)
python -m pytest -q                       # depuis la racine (pytest.ini : testpaths = tests)
python -m pytest -q -m "not lent"        # sans les tests longs (tournées complètes, PDF)
```

- `tests/conftest.py` : fixtures `app_url` (serveur de `tools/serve.py` sur un port libre, racine du dépôt, `Cache-Control: no-store`), `app_server` (le serveur ; `offline = True` simule une coupure réseau, y compris pour le service worker), `browser` (Chromium de session ; `HEADED=1` pour voir le navigateur), `make_page(service_workers='block'|'allow', viewport=…)` et `page` (nouveau contexte par test, tuiles de carte bloquées, position GPS simulée sur la station ATHANASE, fuseau de Cayenne ; erreurs de console et exceptions collectées : le test échoue s’il en reste, sauf marqueur `@pytest.mark.allow_console_errors` — toutes, ou seulement celles qui correspondent aux motifs donnés). Marqueur `lent` pour les tests longs.
- `tests/helpers.py` : `open_setup(page, app_url)` (écran de mise en service : `#setupFirst`, `#setupExtra`), `setup_standalone(page, app_url, …)` (« Première tablette de l’équipe » : champs `deviceName`, `deviceNumber`, `lastName`, `firstName` — `name='Prénom Nom'` —, `username`, `password`, `password2`, `exchangePassword`, `exchangePassword2` — `EXCHANGE_PASSWORD` par défaut — ; initiales proposées par l’écran ; bouton `#setupBtn`), `lock(page)`, `unlock(page, password)`, `goto_hash(page, '#/…')`, `create_tour(page, audit_type, site_ids, provider_id, …)`, `audit_state`, `answer_required`, `response`.
- Fichiers de tests, notamment : `tests/test_unit.py` (chaque fichier de tests unitaires du navigateur, et sa présence dans `all.js`) ; `tests/test_smoke.py` (configuration, affichage de chaque écran principal sans erreur, verrouillage / déverrouillage, fonctionnement hors connexion avec le service worker) ; `tests/test_sync_github.py` couvre la synchronisation d’équipe (initialisation, réception, fusion et conflits, révocation, numéros sans doublon, rattachement / détachement, erreurs claires, mode autonome) avec `tests/fake_github.py` ; `tests/test_tablette_partagee.py` couvre la tablette partagée (tournée en binôme, « Changer d’agent », « Rejoindre la tournée », signature par le second contrôleur, « Ajouter un agent », « Ajouter sur cette tablette » pour un profil reçu d’une autre tablette par paquet de données, « Retirer de cette tablette », dernier administrateur, « Changer d’agent » sur tablette et téléphone) ; `tests/test_echange_tablettes.py` couvre l’échange par fichier avec **deux contextes de navigateur** (deux tablettes au stockage séparé, Web Share retiré : fichier téléchargé puis choisi) : mise en service « Tablette supplémentaire », binôme sur deux tablettes, signature, retour, empreinte scellée identique, mauvais mot de passe d’échange, double réception, règle des profils, envoi incrémental, ancien paquet JSON.

---

## 14. Outils et vérification automatique

| Commande | Rôle |
|---|---|
| `python tools/serve.py` | serveur local sans cache sur <http://localhost:8000> (`--port`, `--open`, `--bind`) |
| `python tools/bump_version.py` | incrémente `AUDIT_BUILD` et met `AUDIT_BUILD_DATE` à la date du jour dans `version.js` (`--dry-run` : sans modifier) |
| `python tools/check_release.py` | vérifications statiques avant publication, sans Node ni réseau : fichiers de `SHELL` existants et fichiers de l’application tous présents dans `SHELL`, fichiers référencés et imports relatifs existants, aucun chemin absolu (`/js/…`), aucun code propre à Node dans `js/`, JSON valides, `AUDIT_BUILD` entier et incrémenté si un fichier de l’application ou `sw.js` a changé (base : `--base`, défaut `origin/main` ou `HEAD~1`) |
| `python -m pytest` | tous les tests (unitaires navigateur, parcours, synchronisation) |

- **GitHub Actions** : `.github/workflows/verifications.yml` lance les vérifications et les tests à chaque envoi ; résultat dans l’onglet **Actions**.
- **VS Code** : `.vscode/tasks.json` regroupe ces commandes (Terminal › Run Task…).

---

## 15. Ajouter un critère ou une feuille sans créer de doublon

### Avant d’ajouter quoi que ce soit

1. **Chercher si le point existe déjà** : parcourir la feuille thématique dans `grid-ct-2026.js` (libellés, `help`) et la table de traçabilité. Si un critère couvre déjà le sujet, **ne pas créer de critère** : compléter son aide (`help: inc('…')`, qui produit « Inclut : … ») et, si utile, son `input`.
2. **Choisir la feuille thématique** (organisation → F2, station et site → F3, ouvrage et purge → F10, mesures in situ et flaconnage → F4, prélèvement et chaîne du froid → F5, biologie → F6 à F9) et la **portée** : point de journée ⇒ F2 ou `scope: 'tournee'` dans une feuille station ; point propre à chaque station ⇒ critère de station.

### Ajouter un critère

1. L’ajouter **à la suite** dans la section voulue, avec le **numéro suivant** de la feuille (ne jamais réutiliser ni renuméroter un numéro existant : les réponses des audits sont rattachées à l’identifiant) : `C(4, 32, 'Libellé', 'Réf. courte', { … })` pour un critère C / P / NC / N/A, `V(…)` pour une valeur seule.
2. Poser la **condition** adaptée (`FOR('eso')`, `NOT_FOR('eso')`, `ONLY('physico')`, condition sur un autre critère…) pour qu’il soit masqué là où il est sans objet.
3. Si le point provient d’une fiche d’évaluation, ajouter ou mettre à jour la ligne de la **table de traçabilité** (` * [CE] … → it-F4-32`).
4. Mettre à jour `tests/unit/grid-ct-2026.test.js` : nombre de critères par feuille, liste des critères partagés, liste des critères ajoutés, décompte des points de traçabilité le cas échéant. Lancer les tests.
5. Vérifier l’affichage (tablette ≥ 1 100 px et téléphone) et le PDF (« Fiches de contrôle (PDF) » et « Fiches vierges (PDF) ») : le rendu est générique, aucun code d’écran n’est normalement à modifier.

### Ajouter une feuille

1. Ajouter l’objet dans `sheets` **à la position d’affichage voulue**, avec un `no` **nouveau et stable** (ex. 11), `key`, `tab`, `title`, `theme` (palette de `js/ui/themes.js` et classe `.th-<thème>` de `css/sheet.css`), `compartment` (nouveau compartiment à déclarer dans `compartments` et, le cas échéant, dans `types[].compartments`), `scope`, `layout: 'table'`, `blocks`.
2. Ajouter ses sections (`sheet: 11`) et critères `it-F11-<no>`.
3. Mettre à jour les tests de structure (ordre des feuilles, feuilles par type de tournée, nombre de critères) et vérifier écran et PDF.

### Diffuser une nouvelle version de la grille

Une grille **publiée est figée** : chaque audit en garde une copie intégrale (`gridSnapshot`), et l’installation (`seedBase` / `upgradeReferentiel2026`) n’ajoute une grille que si son `id` est **absent** de l’appareil (ou du dépôt de l’équipe). Modifier `grid-ct-2026.js` en gardant `id: 'grid-ct-2026-v1'` ne change donc que les appareils **nouvellement configurés** ; les appareils existants gardent la version enregistrée (les écrans utilisent la grille stockée, à défaut celle du code). Pour diffuser une évolution à tous les appareils :

1. publier la grille sous un **nouvel identifiant** et une nouvelle version (ex. `id: 'grid-ct-2026-v2'`, `version: '1.1'`) ;
2. mettre à jour les références à l’identifiant (`CT_GRID` de `js/views/station-sheet.js`, `CT_GRID_ID` de `js/domain/seed.js`) ;
3. dans `upgradeReferentiel2026` (`js/app/bootstrap.js`), archiver l’ancienne version et rattacher les prestations programmées à la nouvelle, comme cela est fait pour l’ancienne grille CT-BIO-2026 ;
4. incrémenter `AUDIT_BUILD`, lancer les tests, publier.

Les tournées déjà commencées restent sur la version avec laquelle elles ont été créées.

### Attendus des prestataires

`data/attendus-ct-2026.json` contient une entrée par critère de la grille CT-2026 (attendu, vérification, exemples C / P / NC / N/A, références, points « à préciser par l’OEG »). C’est la source unique de l’écran `#/attendus`, des PDF et de [ATTENDUS-PRESTATAIRES.md](ATTENDUS-PRESTATAIRES.md). Après toute modification du JSON, lancer `python tools/attendus_md.py` pour régénérer le document ; `python tools/attendus_md.py --check` vérifie qu’il est à jour (test `tests/test_attendus.py`). Quand un critère est ajouté ou modifié dans la grille, `tests/unit/attendus.test.js` signale l’entrée à créer ou à mettre à jour.
