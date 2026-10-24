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
10. [Échanges entre tablettes par fichier](#10-échanges-entre-tablettes-par-fichier) : format `.oegct`, envoi incrémental, fusion, règle des profils
11. [Conventions de code](#11-conventions-de-code)
12. [Tests](#12-tests)
13. [Outils et vérification automatique](#13-outils-et-vérification-automatique)
14. [Ajouter un critère ou une feuille sans créer de doublon](#14-ajouter-un-critère-ou-une-feuille-sans-créer-de-doublon)

Annexe : [synchronisation GitHub (mode équipe, non utilisée à l’OEG)](#annexe--synchronisation-github-mode-équipe-non-utilisée-à-loeg)

---

## 1. Principes

- **Aucune étape de construction, ni Node ni npm.** JavaScript « vanilla » en modules ES, servi tel quel par n’importe quel serveur statique : `python tools/serve.py`, Live Server de VS Code, GitHub Pages sous le sous-chemin `/fiche-de-contr-le/`. Les outils et les tests sont en **Python** (pytest + Playwright) et dans le **navigateur**.
- **Chemins toujours relatifs** (`js/main.js`, `./sw.js`, `new URL('../../data/…', import.meta.url)`), jamais `/js/…` : le site est publié dans un sous-dossier.
- **Hors connexion d’abord** : tout est préchargé par le service worker ; les seules ressources réseau à l’exécution sont les tuiles de carte (OpenStreetMap par défaut) et, dans le mode équipe non utilisé à l’OEG (annexe), l’API GitHub. Les tablettes de l’OEG échangent leurs données par fichier (section 10). Pas de CDN ; polices locales dans `fonts/`.
- **Interface 100 % en français**, apostrophe typographique ’. Accessibilité : cibles tactiles ≥ 48 px (≥ 56 px pour C / P / NC / N/A), contraste AA, mode « plein soleil » (`body.sun`).
- **Jamais de non-conformité automatique** : alertes et suggestions ne font que proposer ; le contrôleur décide (cote, écart, conclusion de feuille).
- **Note sur 20 traçable, jamais de décision automatique** : la synthèse produit des décomptes et une **note sur 20** (feuille, station, tournée) calculée par un module pur (`js/domain/grading.js`, barème validé par l’OEG le 23/10/2026) ; la note ne remplace jamais la conclusion du contrôleur ni la création d’un écart. Section 6, « Note sur 20 ».
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
js/lib/       géographie (UTM 21N/22N ↔ WGS84, RGFG95), contour de la Guyane, métadonnées EXIF des photos (exif.js)
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
| `auth.js` | agents de la tablette (trousseau : `knownUsers`, `addLocalAccount` — « Ajouter un agent » : nouveau profil, identifiant unique parmi le trousseau et les profils —, `enrollAgent` — « Ajouter sur cette tablette », profil reçu de l’autre tablette, même identifiant de profil —, `removeAgentFromDevice` — entrée locale seulement, jamais l’agent connecté ni le dernier administrateur —, `assertAdminRemains` — jamais de dernier administrateur de la tablette rétrogradé ou désactivé), `setupFromProfile` — tablette supplémentaire mise en service avec un profil reçu —, `tabletHasAdmin`, déverrouillage hors connexion, droits (`can`, `canEditAudit`), mode équipe (annexe, non utilisé à l’OEG : `TEAM_MODE = 'github'`, jeton chiffré ; `setupTeam({ account: { id } })` réutilise un profil existant) |
| `media.js` | photos, signatures, pièces jointes (binaire chiffré + entité `media` avec empreinte SHA-256) |
| `util.js` | gabarit `html` / `raw` (échappement), dates, JSON canonique, `sha256Hex`, `diff`, tris |

### js/domain (fichiers purs)

| Fichier | Rôle |
|---|---|
| `grid-ct-2026.js` | **grille unique CT-2026** (données) et **table de traçabilité** des fiches d’évaluation en en-tête |
| `default-grids.js` | grilles fournies au démarrage (`DEFAULT_GRIDS`, CT-2026 en tête ; grilles générales historiques) ; `CT_GRID_ID` ; `upToDateGrid` (grille par défaut enregistrée lue d’après la version du code : écrans, fiches vierges, instantané d’une nouvelle tournée) |
| `grids.js` | conditions, structure visible, avancement, validation, feuilles (`sheetsOf`), grille effective (`expandGrid`), pré-remplissage ; périmètre réel des stations (`stationParts`, `tourTypes`, `partCompartments`, `tourCompartments`, `normalizePerimeter` : section 6) ; mise à niveau des grilles par défaut (`compareVersions`, `replaceGridUnits`, `upgradeStoredGrid` : section 14) |
| `links.js` | **remplissage automatique** des informations redondantes (section 6) : groupes de champs liés `LINK_GROUPS` (mode `auto` ou `suggest`), sources virtuelles (`OPERATORS_SOURCE`, `SITE_SOURCE`, `STATIONS_SOURCE`, `COMPARTMENTS_SOURCE`, `MARKET_SOURCE`, `INSTRUMENTS_SOURCE`), `linkedUpdates` (reprises en chaîne), `linkProposal` (« Proposé : … »), `isWritable` (jamais une saisie de l’agent), `sourceInfo` ; reprise de la station précédente (`copyFromPreviousStation`) |
| `model.js` | vocabulaire : `RESPONSES` (C, P, NC, NA…), `SCALE_CPNC`, `JUSTIFY_CPNC`, `BILAN_OPTIONS`, `PREFILL_SOURCES`, `formatValue`, `auditDate`, `auditTimes` / `auditTimeTexts` (heures de la tournée rapprochées de « Début / Fin du contrôle », F2.1.5 / 1.6)… |
| `rules.js` | alertes (règles `item.alerts`, écart GPS par station — toujours en UTM 22N, saisie d’origine en UTM 21N citée —, ancienneté des calibrations) |
| `coords.js` | coordonnées planes saisies (section 4, « Coordonnées UTM 22N / 21N ») : systèmes `SRS` (« UTM 22N (RGFG95) » par défaut, « UTM 21N »), `convertEntry`, `withXYEntry`, `withSrs`, `withGpsReading` (valeur d’un groupe X / Y des feuilles), `siteXY` (station, point, import), `coordIssues` (21N saisi en 22N, point hors de la Guyane), `parseSrs`, `originText` / `convertedText` |
| `summary.js` | synthèse : décomptes et notes sur 20 par feuille, par station, par tournée (appelle `grading.js`) ; indicateurs |
| `grading.js` | **note sur 20** (section 6) : barème (`GRADE_SCALE`, `MAJOR_WEIGHT`, `scoringOf` — points majeurs `major`, points de synthèse `noScore`, barème de la grille du code pour un instantané antérieur), décompte (`tallyItem`) et note au dixième en entiers (`gradeOf`), seuils (`gradeThresholds`, `thresholdErrors`, `thresholdsText`), note figée à la signature (`gradingRecord`, `resolveGrades`, `applyResolvedGrades`), moyennes du tableau de bord (`averageGrades`) |
| `compare.js` | comparaison de deux audits (appariement par critère d’origine et station) |
| `merge.js` | fusion à trois versions (échanges entre tablettes, synchronisation) ; `presumedBase` (version commune présumée) ; réseaux et types de tournée d’une station fusionnés comme des **ensembles** (`SET_FIELDS`, `mergeSet` : un ajout d’un côté et un retrait de l’autre sont tous deux pris en compte, sans conflit) ; positions fusionnées **d’un bloc** (`COORD_FIELDS` d’une station, valeur X / Y d’une feuille) ; valeur d’une réponse et sa provenance fusionnées **d’un bloc** (`VALUE_GROUPS` : `value`, `prefilled`, `from`, `fromId`, `valueManual` ; encadré lié `agents`, `agentsFrom`, `agentsManual`) |
| `networks.js` | réseaux de surveillance (section 4) : `NETWORK_DEFAULTS` (cinq marchés 2026, identifiants `net-<code>`, contenu déterministe), `networkIndex` (repli sur les défauts), `networkOf` (réseau « virtuel » d’un code inconnu), `canonicalNetwork` / `normalizeNetworkCodes` (casse, accents, libellé, synonymes ; jamais de correspondance partielle), `sortNetworkCodes`, `listNetworks`, `auditTypesOf` (types de tournée déduits), `networksToCreate`, `groupSitesByNetwork` (totaux distincts), `prestationNetwork`, `networkColors` (couleurs claire / foncée, contraste) |
| `operators.js` | opérateurs des prestataires (« Préleveurs du prestataire », section 4) : initiales (`normInitials`, `suggestOperatorInitials`), identifiant déterministe `op-<code du prestataire>-<INITIALES>` (`operatorId`), dédoublonnage (`planOperator` : `create` / `complete` / `existing` / `propose`), saisie contrôlée (`cleanOperatorInput`), libellés (`operatorDisplay`, `operatorLabel`) |
| `exchange.js` | échanges entre tablettes : vecteurs de versions (`vvLeq`, `vvCompare`…), décision de réception (`planEntity`), version commune (`chooseBase`, `nextCandidates`), choix des données à envoyer (`selectForSend`), règle des profils (`guardProfile`), nom du fichier, décomptes |
| `permissions.js` | profils (`ROLES`) et matrice des droits (`PERMISSIONS`) ; contrôleurs OEG d’une tournée (`auditControllerIds` — audit sans `controllerIds` : son auteur —, `auditControllers`, `controllerNamesText`, `isAuditController`), droit de saisie (`canEditAuditAs`), `canJoinAudit` ; identité des agents (`agentInitials`, `agentFullName`, `suggestUsername`) |
| `seed.js` | référentiels initiaux (dont les réseaux de surveillance et l’unité NTU), référentiel OEG, programmes 2026 (biologie, cours d’eau) ; `stationTypes(site, index des réseaux)` ; identifiants déterministes |
| `normalize.js` | normalisation des valeurs importées et saisies (dates, heures, nombres) ; `guessMapping` (en-têtes comparés sans accents, majuscules ni ponctuation : « X (m) » = « x m ») |

### js/app

| Fichier | Rôle |
|---|---|
| `audits.js` | création de tournée (`createAudit`), stations (`addStation`, `removeStation`), réponses (`setResponse`), données de feuille (`updateSheet`), écarts, signatures, verrouillage scellé, `effectiveGrid(audit)`, `auditState(audit)` ; remplissage automatique (`applyLinks`, `linkExtra`, `refreshStationInfo`, `previousStationPlan` / `copyPreviousStation` : section 6) |
| `bootstrap.js` | installation des données (`seedAll`) et mise à niveau idempotente (`upgradeReferentiel2026` : grilles par défaut — `upgradeDefaultGrids` —, réseaux de surveillance, unité NTU, puis référentiel des stations et programmes) |
| `networks.js` | réseaux de surveillance côté application : `currentNetworkIndex` (index en cache, invalidé à chaque écriture d’un réseau), `siteNetworks` / `siteNetworksText` / `prestationNetworkOf` (réseaux à afficher : écrans, rapport), `usedNetworkCodes`, `networkUsage`, `ensureNetworks` (réseaux manquants créés par un profil « référentiels ») |
| `operators.js` | « ＋ Ajouter un opérateur » (création de tournée, feuille Organisation) : `planNewOperator` / `saveNewOperator` (création, identité complétée, existant réactivé ; journal), `setTourOperator` (préleveurs de la tournée : `audit.operatorIds`, libellés figés `audit.operatorNames`), `providerOperators`, `canAddOperator` (`audit.edit` ou `ref.manage`) |
| `logo.js` | logo de l’application (Administration) : `prepareLogo` (PNG, JPEG, WebP ou SVG → PNG 512 px au plus, proportions conservées), `setAppLogo` / `resetAppLogo` (média chiffré `kind: 'logo'` + `orgSettings().logo`, journal), `syncLogo` / `watchLogo` (copie locale accordée au réglage, aussi après réception d’un fichier d’échange) |
| `sheets-pdf.js` | fiches de contrôle en PDF (tournée, fiches vierges, fiche station) |
| `report.js` | rapport d’audit détaillé (PDF) |
| `attendus-pdf.js` | attendus des prestataires : chargement de `data/attendus-ct-2026.json`, modèle d’affichage par type de tournée, PDF « Fiche des attendus » et « Liste de préparation » (écran : `js/views/attendus.js`, route `#/attendus`, fenêtre « Attendu » ouverte depuis les feuilles par `openAttendu(itemId)`) |
| `static-map.js` | carte statique de la feuille 1 pour les PDF (tuiles en cache ou schéma hors connexion) |
| `github.js` | mode équipe (annexe) : client REST GitHub, arborescence du dépôt de données, erreurs en français, empreintes git |
| `exchange-file.js` | format du fichier d’échange `.oegct` (section 10) : texte ASCII, chiffrement AES-GCM avec le mot de passe d’échange, compression gzip, médias joints, empreintes SHA-256 (`encodeExchange`, `decodeExchange`, `ExchangeError`) |
| `exchange.js` | échanges entre tablettes (section 10) : mot de passe d’échange, modifications à envoyer (`pendingChanges`, `exchangeState`), `prepareSend` / `markSent`, `readExchange` / `previewExchange` / `receiveExchange`, changements de profils en attente (`acceptHeld`, `refuseHeld`), historique, mise en service d’une tablette supplémentaire (`setupFromExchange`) |
| `sync.js` | moteur de synchronisation du mode équipe (annexe, non utilisé à l’OEG) |
| `numbering.js` | numéros d’audit uniques `AUD-AAAA-NNNNNN` (blocs réservés en mode équipe, plage par appareil sinon) |
| `documents.js`, `imports.js`, `exports.js`, `settings.js` | documents applicables, imports (Excel, CSV, ICS… ; sites : colonne non associée sans effacement, réseaux normalisés et cumulés), exports (colonnes « Réseau(x) ») et sauvegardes, réglages et préférences |

### js/ui et js/views

`js/ui` : `router.js` (routeur par fragment `#/…`), `dom.js` (délégation d’événements, modales, notifications), `components.js`, `sheet-chrome.js` (habillage des feuilles : `oegHeader`, `stationBanner`, `infoStrip`, `sectionCard`, `blockCard`, `checkSquare`, `statusHeadCells`, `sharedBadge`, `tourStations`, `sheetFooter`…), `themes.js` (palette des feuilles : ocean, navy, green, peach, orange, violet, sky, rust, slate, teal ; partagée écran / PDF), `icons.js` (pictogrammes SVG), `logo.js` (logo affiché : logo choisi en Administration ou celui de l’OEG), `map.js` (Leaflet, préchargement des tuiles, `TYPE_STYLES`), `capture.js`, `gps.js`, `signature.js`, `scanner.js`, `voice.js`.

`js/views` : un module par écran (tableau de la section 3) ; `exchange.js` regroupe les fenêtres et cartes des échanges entre tablettes (envoyer, recevoir, mot de passe d’échange, historique, changements de profils à valider), utilisées par l’accueil, l’écran Échanges entre tablettes et l’Administration ; `station-sheet.js` produit la feuille 1 (fiche station) pour la page station, l’audit et les aides « station » partagées ; `audit-sheet.js` produit l’audit en feuilles ; `audit-modules.js` les éléments communs (signatures, documents, alertes, écarts).

---

## 3. Démarrage, routes et écrans

`index.html` charge `version.js`, Leaflet, puis `js/main.js` (module) et enregistre `sw.js`. `main.js` ouvre la base, affiche la mise en service (`views/auth.js : renderSetup` : deux choix, « Première tablette de l’équipe » `#setupFirst` et « Tablette supplémentaire : recevoir le fichier de l’autre tablette » `#setupExtra`) ou l’ouverture de session « Qui utilise la tablette ? » (`renderLogin` ; `pick: 'none'` après « Changer d’agent » : aucun agent présélectionné), puis la structure (`views/shell.js`, bouton « Changer d’agent » = `lockApp('changement d’agent')`, qui enregistre la saisie en cours, ferme les fenêtres et messages ouverts et rappelle, sans bloquer, les modifications pas encore envoyées à l’autre tablette ; après ce bouton ou un verrouillage par inactivité, un autre agent que le précédent arrive sur la tournée affichée, sinon sur l’accueil), le routeur et la synchronisation. La mise en service prépare le mode autonome (celui de l’OEG) ; « Rejoindre une équipe » n’est qu’une option avancée repliée (`#setupAdvanced`), comme dans l’écran Échanges entre tablettes (`#teamAdvanced`).

Le routeur (`js/ui/router.js`) numérote les rendus : si un rendu plus récent commence pendant qu’un écran se construit (navigation pendant un rendu lent, rafraîchissement après synchronisation), l’ancien abandonne sans toucher au DOM — un écran n’a jamais deux jeux de gestionnaires.

| Route | Module | Écran |
|---|---|---|
| `#/` | `home.js` | Stations (accueil) ; `?type=bio|ce|eso`, `?reseau=<code>|aucun` (réseau ; `aucun` : stations sans réseau), `?ranger=reseau|statut` (sections par réseau, d’office, ou grille historique par statut), `?bassin=`, `?statut=`, `?q=` ; sans paramètre, type, réseau et rangement de l’agent connecté |
| `#/planning` | `planning.js` | Planning des prestations ; `?periode=`, `?prestataire=`, `?campagne=`, `?reseau=<code>|aucun` (réseau du programme), `?statut=`, `?q=` |
| `#/station/:id` | `station.js` | Fiche station ; `?type=` (variante) ; `?parties=bio,ce` (station BIO + Chimie contrôlée pour les deux : fiche et fiches vierges d’une tournée mixte) |
| `#/station/:id/modifier` | `station-edit.js` | Modification d’une station |
| `#/prestation/:id` | `prestation.js` | Préparation d’une prestation |
| `#/nouvel-audit` | `audit-new.js` | Nouvelle tournée ; `?site=`, `?prestation=`, `?prestations=a,b`, `?type=`, `?reseau=` (filtre des stations proposées, jamais repris d’une préférence), `?kind=inopine`, `?mode=general` (grille historique) |
| `#/audit/:id/:step?` | `audit.js` (+ `audit-sheet.js`) | Audit ; étapes `feuille-<no>` (feuille de tournée), `feuille-<no>@<clé>` (feuille d’une station), `ecarts`, `synthese`, `signatures`, `infos` |
| `#/audits`, `#/comparer` | `audits.js`, `compare.js` | Liste ; `?vue=historique` : « Historique et comparaison » (puce de l’écran, plus d’entrée de menu en double) ; comparaison (`?a=&b=`) |
| `#/ecarts`, `#/ecart/:id` | `deviations.js` | Registre des écarts, détail |
| `#/observations`, `#/carte`, `#/tableau-de-bord` | `observations.js`, `map.js`, `dashboard.js` | Observations et urgences, carte (`?type=`, `?reseau=`, `?statut=`, `?site=`, `?point=`), tableau de bord |
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

Station (`site`) : `code` (SANDRE ou BSS selon `codeType`), `name`, `bassin`, `riverName`, `commune`, `x`/`y` (RGFG95 / UTM 22N), `lat`/`lon` (WGS84), saisie d’origine en UTM 21N éventuelle (`srs: '21N'`, `x21`, `y21`), `types` (`bio`, `ce`, `eso`), `compartments`, `access`, `difficulties`, `photos` (créneaux RD / RG / AM / AV : `mediaId` prioritaire sur `src` statique), `samplingPoints` (`kind`, `label`, `x`, `y`, `lat`, `lon`, `srs`/`x21`/`y21` éventuels) ; eaux souterraines : `nature`, `usage`, `aquifere`.

### Réseaux de surveillance (`network`)

Référentiel administrable (Référentiels › « Réseaux de surveillance », droit `ref.manage`), règles pures dans `js/domain/networks.js`, accès au magasin dans `js/app/networks.js`.

- **Réseau** : `{ id: 'net-<code>', code, label, description, color, order, auditTypes, active }`. Le **code** est la valeur enregistrée sur les stations (`site.networks`, tableau : une station peut appartenir à plusieurs réseaux) et les campagnes (`campaign.network`, un seul) : il **ne se modifie plus** après la création et un réseau utilisé ne peut pas être supprimé (le rendre inactif). `auditTypes` (parmi `bio`, `ce`, `eso`) : types de tournée proposés pour les stations du réseau.
- **Réseaux par défaut** (`NETWORK_DEFAULTS`, un par marché OEG 2026, contenu déterministe sans date : deux tablettes qui les installent produisent la même donnée, sans conflit d’échange) : BIO « Biologie (RCS ESC BIO) » (aucun type associé : le type `bio` est déduit des listes biologiques `site.bioLists`, comme avant), Chimie « Chimie des cours d’eau » (`ce`), RCO « Réseau de contrôle opérationnel » (`ce`), EL « Eaux littorales » (`ce`), ESO « Eaux souterraines » (`eso`). Effectifs du référentiel OEG : BIO 38, Chimie 15, RCO 25, EL 29, ESO 17, soit 124 appartenances pour 108 stations (15 stations BIO + Chimie, Mataroni RCO + EL). `CE_NETWORKS` (`seed.js`) reste la liste des **programmes** cours d’eau installés (Chimie, RCO), distincte des types associés.
- **Repli** : tant que le référentiel n’est pas installé (tablette où seul un agent sans droit « référentiels » a ouvert une session), `networkIndex` utilise les réseaux par défaut ; un code inconnu s’affiche comme un réseau « virtuel » gris (`networkOf`), sans rien écrire. **Types de tournée déduits** (`auditTypesOf`, `stationTypes(site, index)`, `siteTypes` de `station-sheet.js` quand `site.types` est vide) : bio par les listes biologiques, puis les types associés aux réseaux — résultat identique à l’ancienne règle codée en dur pour les 108 stations (test unitaire). `site.types` enregistré reste la référence : il n’est jamais recalculé pour une station existante.
- **Saisie** : cases à cocher du référentiel (modification d’une station, Référentiels › Sites) et « Autres réseaux » (codes ou libellés ramenés au code du référentiel par `normalizeNetworkCodes`, sans tenir compte de la casse ni des accents ; un code inconnu est ajouté au référentiel par `ensureNetworks`) ; campagne : liste des réseaux.
- **Imports de sites** (`js/app/imports.js`) : une colonne non associée ou une cellule vide ne modifie jamais la valeur enregistrée d’une station existante (réseaux, commune, bassin, masse d’eau, coordonnées) ; codes normalisés ; une station listée sur plusieurs lignes (une par réseau) cumule ses réseaux sur sa première ligne (lignes suivantes « Cumulée ») ; code inconnu signalé à la prévisualisation et créé à l’application de l’import ; réseaux comparés comme des ensembles.
- **Mise à niveau** (`upgradeReferentiel2026`, avant toute sortie anticipée) : réseaux par défaut manquants installés, puis un réseau créé pour chaque code utilisé par une station ou une campagne sans réseau enregistré ; **aucune station réécrite**. Un réseau supprimé (pierre tombale) n’est jamais recréé.
- **Fusion** (échange par fichier, synchronisation) : `site.networks` et `site.types` sont fusionnés comme des ensembles (`merge.js`).
- **Conditions de grille** : le contexte (`auditContext`) garde `network` (codes joints « BIO,Chimie », opérateur « est égal à ») et ajoute `networks` (tableau, opérateur « fait partie de » : vrai pour une station sur deux réseaux dès que l’un d’eux est cité).
- **Exports** : colonne « Réseau(x) » (codes triés) des tournées et des écarts ; prestations : « Réseau » du programme (celui de la campagne, `prestationNetwork`) et « Réseau(x) de la station » ; tableau « Stations et réseaux de surveillance » (`COLUMNS.sites`, une ligne par station ; classeur : feuille « Stations par réseau », `stationsByNetwork`, une ligne par station et par réseau). Filtre « Réseau » de l’écran Exports.
- **Écrans** (`?reseau=<code>`, `aucun` = sans réseau) :
  - accueil (`home.js`) : rangée de chips « Réseau » (effectifs en stations distinctes, chips à zéro masqués sauf le chip choisi), « Ranger : par réseau | par statut ». Par réseau : `<div class="hm-secs" id="hmGrid">` puis une `<section class="hm-sec" data-net>` par réseau (titre `h2.hm-sec-h`, effectif `[data-n]`), ordre du référentiel (`groupSitesByNetwork`) ; une station sur deux réseaux a une carte dans chaque section (`.hm-card[data-site]`, ligne « Aussi : … »). Par statut : `<div class="hm-grid" id="hmGrid">` historique. La recherche instantanée (`filterCards`) compte les `data-site` distincts (`#hmCount`), masque les sections sans carte visible et met leurs effectifs à jour. Type, réseau et rangement : préférences **de l’agent** (`agentPref` / `setAgentPref` de `app/settings.js`, clés `u:<profil>:home.type|home.reseau|home.ranger`) ; un réseau mémorisé sans station du type choisi est ignoré ; « Effacer les filtres » vide type et réseau ;
  - carte (`map.js`) : chips « Réseau » (effectifs), info-bulle « Réseaux : … », lien « Liste des stations » avec les mêmes filtres ;
  - création de tournée (`audit-new.js`) : chips « Réseau » en tête de `#anCands` (`data-act=setNet`, seul `#anCands` est réaffiché, la recherche est conservée), stations du réseau et prestations de son programme ; badges des réseaux sur les candidates et les stations choisies ;
  - fiche station (`station.js`) : badges des réseaux (lien vers l’accueil filtré), réseau du programme de chaque prestation ; feuille 1 : pastilles `.sb-nets` sur une ligne à part sous « Station » (`stationBanner({ networks })` de `sheet-chrome.js`, passé SEULEMENT par `stationSheet`) ; PDF : pastilles sur la ligne « Station », arrêtées avant la silhouette de la Guyane (53 % du bandeau), jamais sur F3 / F9 ;
  - planning : filtre « Réseau de surveillance (programme) » dans les Filtres repliés (aucune rangée de chips avant celle des périodes), campagnes regroupées par réseau, badge du réseau du programme sur chaque prestation ; prestation : réseau du programme et réseaux de la station ;
  - rapport d’audit : « Réseau(x) » des stations (« BIO – Biologie… »), colonne « Réseaux » du tableau des stations d’une tournée, « Réseau (programme) » de la prestation ; tableau de bord : « Stations contrôlées par réseau » (une ligne par réseau, n / total ; total distinct sous la carte), réseau des campagnes (une ligne ouvre `#/planning?campagne=…&periode=toutes`) ; prestataires : sites d’intervention rangés par réseau.
  - Composants : `networkBadge`, `networkBadges`, `networkDot`, `networkVars` (`js/ui/components.js`) ; styles `.net-badge`, `.net-dot`, `.chips.is-wrap` (rangée qui passe à la ligne : jamais de défilement horizontal sur téléphone) dans `styles.css`, accueil (`.hm-sec`…) dans `css/station.css`, bandeau (`.sb-nets`) dans `css/sheet.css` ; démonstration dans `docs/charte.html` (section « Réseaux »).


### Annulation de tournée, opérateurs, photos et logo (demandes de l’OEG, octobre 2026)

- **« Annuler la tournée »** : règle pure `cancelTourRefusal(audit, user, { reason })` (`js/domain/permissions.js` : tout contrôleur de la tournée — `isAuditController`, binôme compris — ou profil `audit.delete` ; refus expliqués : tournée signée et verrouillée, déjà annulée, agent qui doit d’abord « Rejoindre la tournée », motif vide) ; opération `cancelTour(audit, reason, { cancelDeviations })` (`js/app/audits.js`, `abandonAudit` en est l’ancien nom) : relit la tournée dans le magasin ; écarts ouverts (`OPEN_DEVIATION`) : erreur `needsCancel` sauf `cancelDeviations: true` (annulés avec le même motif) ; `status: 'abandonne'` (valeur conservée, libellé « Annulée »), `abandonReason`, `cancelledAt`, `cancelledBy`, `cancelledByName` ; historique de chaque prestation (`event: 'audit-annule'`) ; journal `action: 'abandon'` (« Annulation de tournée »). Écrans : bouton `#tourCancelTop` (en-tête `.as-top`) et `#tourCancel` (onglet Infos ; explication `#tourCancelWhy` sinon), fenêtre `promptDialog({ dismissable: false, cancelLabel: 'Garder la tournée', danger: true })` (ni croix, ni Échap, ni appui hors du cadre : clavier Android ; `index.html` : `interactive-widget=resizes-content`, `.modal` en `92dvh`), message « Tournée AUD-… annulée », retour à `#/` ; liste des audits : annulées masquées par défaut, puce « Annulées » ; bandeau `#tourCancelled`.
- **Opérateurs** (« Préleveurs du prestataire ») : `js/domain/operators.js` (règles pures) et `js/app/operators.js` ; fenêtre `openOperatorForm` et carte F2 `tourOperatorsCard` (`#tourOperators`, hors impression) dans `js/views/audit-modules.js` ; étape 7 de la création (`#anOperators`, `#opNewCreate`). Identifiant déterministe `op-<code du prestataire>-<INITIALES>` (initiales en capitales, uniques par prestataire sans tenir compte de la casse ; identifiant d’un opérateur supprimé : suffixe `-2`). Tournée : `audit.operatorIds` et libellés figés `audit.operatorNames` (`{ id: 'Prénom Nom (INI) — fonction' }`, scellés avec la tournée ; `auditState().operators` s’en sert si la fiche manque). Droit d’écriture d’un `operator` : `ref.manage` ou `audit.edit` (`writePermission`).
- **Photos** : `mediaInputs(link, { photo, gallery, document, compact, act, labels, data })` (`js/ui/components.js`) produit « Prendre une photo » (`accept="image/*" capture="environment"`), « Importer depuis la galerie » (`accept="image/*" multiple`, sans `capture`) et « Joindre un document » ; `data-source` (`camera` | `gallery` | `document`). `evidenceButtons` s’en sert ; lignes de tableau des feuilles : bouton `[data-act=proof-menu]` (fenêtre « Ajouter une preuve » avec les trois choix). `js/ui/capture.js` : `preparePhoto(file, { source })` (compression, `readExif` de `js/lib/exif.js` : `DateTimeOriginal` lue en heure locale de la tablette sauf fuseau `OffsetTimeOriginal`, position GPS), `inputSource`, `mediaProvenance` (visionneuse). Média : `source`, `importedAt`, `takenAtSource` (`exif` | `capture` | `import`), `gps.source` (`exif` | `device`) — hors contenu scellé (le sceau ne reprend que `id`, `sha256`, `link`, `takenAt`, `derivedFrom`).
- **Coordonnées UTM 22N / 21N** : voir la sous-section suivante.
- **Logo** : réglage `orgSettings().logo = { mediaId, sha256, width, height, mime: 'image/png', name, updatedAt, by, byName }` + média chiffré (`kind: 'logo'`, lien `{ type: 'setting', id: 'org' }`), tous deux transmis par le fichier d’échange. Affichage : `js/ui/logo.js` (`logoURL`, `logoImg` — images `data-app-logo` mises à jour en direct, classe `is-custom` : fond blanc, proportions conservées —, `logoBytes` pour les PDF : `Assets.logo` de `sheets-pdf.js`, `logoJPEG` de `report.js`, `loadLogo` de `attendus-pdf.js`) avec une copie locale `localStorage` `oeg-ct:logo` (PNG en `data:` URL) pour les écrans affichés avant l’ouverture de session (`auth.js`, écran de chargement d’`index.html`) ; `js/app/logo.js` accorde cette copie au réglage (`watchLogo`, appelé par `main.js` à chaque ouverture de session ; contenu pas encore reçu : nouvel essai toutes les 2 s pendant une minute). L’icône de l’application installée (`manifest.webmanifest`, `icons/icon-*.png`) ne change pas. `LOGO_URL` (`sheet-chrome.js`) reste le logo par défaut.

### Coordonnées UTM 22N / 21N (demande de l’OEG, octobre 2026)

Règles pures dans `js/domain/coords.js` (conversion par la latitude / longitude : `utmToLatLon` / `latLonToUtm` de `js/lib/geo.js`, ellipsoïde GRS80 ≈ WGS84 ; `utmConvert`, `guessUtmZone`, `inGuyane`, `GUYANE_BOUNDS`).

- **Valeur enregistrée : TOUJOURS `x` / `y` en RGFG95 / UTM 22N** (EPSG:2972), arrondis au mètre comme un relevé GPS : alertes d’éloignement (`GPS_XY_FAR`), cartes, fiches et PDF, rapports, exports, comparaisons et liens entre feuilles n’ont rien à convertir. Une saisie en UTM 21N (EPSG:3313) garde en plus sa **saisie d’origine** : `srs: '21N'`, `x21`, `y21` (valeurs saisies). En 22N (défaut), `srs`, `x21`, `y21` sont absents. Les deux fuseaux sont disjoints en X sur la Guyane (22N : X ≈ 99 000 à 434 000 ; 21N : X ≈ 766 000 à 1 101 000 ; Y ≈ 232 000 à 644 000) : `guessUtmZone` reconnaît le fuseau d’une saisie, `inGuyane` (Guyane et eaux littorales, ± 0,3°) repère un point aberrant. Datum : RGFG95 dans les deux fuseaux ; des coordonnées en CSG67 (EPSG:3312) seraient décalées d’environ 115 m (non géré, à préciser dans les aides si besoin).
- **Feuilles** (critères `fields` + `gps` : F3.15, F6.3, F6.4, F7.3, F8.A7, F9.3 — logique côté domaine, valable pour les tournées déjà commencées) : `fieldsControl` (`js/views/audit-sheet.js`) ajoute la liste « Système » (`<select class="st-srs" id="<t|k>-<critère>-srs" data-change="fsrs">`) ; en 21N, les champs X / Y (`data-xy`) éditent `x21` / `y21` (`withXYEntry`) et `x` / `y` sont recalculés dès que les deux sont saisis (« → RGFG95 / UTM 22N : X … · Y … », `.as-xy-conv`) ; changer de système (`withSrs`) garde la position (X / Y d’UTM 21N laissés en 22N : repris comme saisie 21N et convertis) ; relevé GPS (`gps-fill`, `withGpsReading`) : UTM 22N directement (`positionXY`), plus `x21` / `y21` en mode 21N, avertissement si le relevé tombe hors de la Guyane. `coordIssues` (`XY_21N_AS_22N`, `XY_OUT`) s’affiche sous les champs (`.as-xy-warn`) et passe par `valueIssues` (avertissement du contrôle avant clôture). `formatValue` ajoute « (saisi en UTM 21N : X … · Y …) » : écrans, PDF des fiches (`valueTokens`), rapport. Tournée signée et verrouillée : choix et champs désactivés, rien n’est écrit à l’affichage.
- **Station** (`js/views/station-edit.js`) : même choix pour X / Y de la station (`#seSrs`, aperçu `#seXYConv` : `data-state` `conv` | `warn`) et de chaque point de prélèvement (`[data-sp=srs]`, `[data-sp=conv]`) ; `siteXY` calcule `x`, `y`, `lat`, `lon` et la saisie d’origine ; un X / Y d’UTM 21N laissé en 22N ou un point hors de la Guyane est **refusé** à l’enregistrement. Fiche station et PDF de la feuille 1 : « saisi en UTM 21N : … » sous les X / Y. Référentiels › Sites (latitude / longitude seulement) : X / Y recalculés en 22N quand la position change, saisie d’origine retirée.
- **Imports de sites** : colonne « Fuseau UTM (22N / 21N) » (`parseSrs` : « 21 », « 21N », « UTM 21 », « EPSG:3313 », « 32621 »… ; valeur non reconnue signalée), sinon fuseau reconnu d’après X ; 21N converti avec la saisie d’origine et signalé à la prévisualisation ; latitude / longitude seules : X / Y recalculés en 22N ; point hors de la Guyane : avertissement.
- **Échanges entre tablettes** : les champs circulent avec les entités ; `merge.js` fusionne une position **d’un bloc** (`COORD_FIELDS.site` ; valeur d’un groupe X / Y portant `x`, `y`, `x21` ou `y21` numériques) : modifiée d’un seul côté, ce côté ; des deux côtés, la plus récente entière, l’autre dans le rapport de conflit.
- **Tests** : `tests/unit/coords.test.js` (points de contrôle de l’étude — implémentation de Krüger indépendante identique à PROJ 9.8 — en 21N et 22N à ± 5 cm, conversion à ± 0,5 m, aller-retour < 1 mm, saisie arrondie au mètre, `guessUtmZone`, saisie et changement de système, relevé GPS, contrôles, `formatValue`, `valueIssues`, alerte d’éloignement, colonnes d’import, fusion d’un bloc) ; `tests/test_coordonnees_utm.py` (station et feuille 3 sur tablette 1280 × 800 et téléphone 390 × 844, GPS, PDF, import, tournée signée, deux tablettes).

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
- **Portée** (`sheet.scope`) : `'tournee'` (F2, renseignée une fois) ou `'station'` (toutes les autres, répétées par station). Dans une feuille station, `item.scope: 'tournee'` déclare un critère **commun à la tournée** (badge « Commun à la tournée », une seule réponse) : F4.2, F4.14, F4.16, F4.18 à F4.25, F5.11, F5.12, F5.14, F5.15, F5.17, F5.18, F5.29, F5.30 (F4.14 et F4.16 depuis la version 1.2).
- **Visibilité** : une feuille s’affiche si l’un de ses compartiments (`compartment` / `compartments`) est retenu pour la tournée ; les sections et critères portent des `condition`s.
- **Variantes** (`sheet.variants[type]`) : titre, onglet, surtitre ou appareils propres à un type (`resolveSheet`). **Encadrés** (`blocks`, texte d’invite propre `placeholder` : deux zones libres d’une feuille ne demandent pas la même chose) : `observations`, `notes`, `photos`, `conclusion` (`options`, `fields` : `controller`, `date`, `signature`, `providerSignature`, `comments`) ; `showFor` limite un encadré à certains types (bilans « Satisfaisant / Perfectible / Non satisfaisant » de F3, F4, F5, F10 pour `ce` / `eso`). **Modules** : `instruments` (F4 : appareils de mesure et tableau d’étalonnage, donnée de tournée déclarée par `tourneeData`).

Nombre de critères par feuille (grille de base, tous types confondus, vérifié par les tests) :

| F1 | F2 | F3 | F10 | F4 | F5 | F6 | F7 | F8 | F9 | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 47 | 33 | 7 | 31 | 30 | 13 | 14 | 16 | 13 | **212** |

Feuilles affichées pour une station : biologie 9 (F1 à F9, compartiments complets), cours d’eau 5 (F1, F2, F3, F4, F5), eaux souterraines 6 (F1, F2, F3, F10, F4, F5).

### Critères (items)

```js
{ id: 'it-F4-12', code: 'F4.12', no: '12', label: 'Flaconnage conforme', short: 'Flac',
  kind: 'conformity', responses: ['C', 'P', 'NC', 'NA'], required: true, justifyOn: ['P', 'NC'],
  input: { type: 'text' },            // champ « Valeur / réponse » (facultatif)
  help: 'Inclut : …', condition: …, prefill: …, scope: 'tournee'?, domain: 'transport'?, alerts: [ … ]? }
```

- **Identifiants** : `id = it-F<feuille>-<no>`, `code = F<feuille>.<no>` (ex. `it-F2-1.11`, `it-F8-A2`, `it-F1-R8`), **uniques et stables** (un numéro retiré, comme F8.A3 en 1.2, n’est jamais réutilisé) : les réponses des audits y sont rattachées. Dans la grille effective, un critère de station devient `it-F<n>-<no>@<clé>` (clé = code de la station).
- `short` = « Référence courte » des maquettes (≠ `refs`, références documentaires).
- **Échelle** : critères de conformité `kind: 'conformity'`, `responses: SCALE_CPNC` (`['C','P','NC','NA']`), `justifyOn: JUSTIFY_CPNC` (`['P','NC']`) — observation obligatoire pour P et NC. Critères « valeur seule » : `kind` `text`, `longtext`, `date`, `time`, `number`, `select` ou `fields`, sans cote.
- **`input`** : `text`, `longtext`, `number` (`unit`, `min`, `max`, `step`), `date`, `time`, `select` (`options`), `fields` (valeur OBJET : champs `text` / `number` / `date` / `time` / `choice`, `showIf`, `unitKey` ; `gps: true` ⇒ choix du système UTM 22N / 21N et bouton de relevé X / Y RGFG95, avec `lat`, `lon`, `accuracy`, `at` ; saisie en 21N : `srs`, `x21`, `y21` — section 4). Affichage lisible : `formatValue(item, value)` (`model.js`).
- **Conditions** (`evalCondition`) : `{ item, field?, op, value }` (réponse d’un autre critère ; `field` = champ d’une valeur objet, ex. `{ item: 'it-F10-3', field: 'alimentation', op: 'in', value: ['Véhicule', 'Groupe électrogène'] }`) ; `{ ctx: 'auditType' | 'compartments' | 'matrixCode', op, value }` ; combinaisons `{ all: [] }`, `{ any: [] }`, `{ not: … }`. Opérateurs : `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `answered`, `empty`, `truthy`, `falsy`. Aides de `grid-ct-2026.js` : `ONLY(compartiment)`, `FOR(...types)`, `NOT_FOR(...types)`, `PHYSICO_OR_ESO`.
- **Pré-remplissage** (`prefill`, appliqué une fois à la création ou à l’ajout de la station, réponse marquée `prefilled: true`, sans cote) : `site.name`, `site.code`, `site.bassin`, `site.riverName`, `site.commune`, `site.her`, `site.pressions`, `site.strahler`, `site.xy`, `audit.date`, `audit.time`, `audit.kind`, `tournee.stationCount`, `auditor.name`, `provider.name`, `prestation.operators` (`PREFILL_SOURCES`, `prefillResponses`).
- `suggest` : valeur calculée proposée, jamais appliquée seule (ex. amplitude horaire 5.2 → 5.3). `labelTemplate` : libellé complété avec le prestataire (`Opérateurs {prestataire}`).
- **`help`** : réservée aux points des fiches d’évaluation regroupés dans le critère (`inc('…')` ⇒ « Inclut : … », avec leur origine « (fiche cours d’eau) ») et à de rares précisions justifiées (F3.20, formule de F10.5) ; ce que juge le critère et les renvois vers ses voisins sont dans son **attendu** (`data/attendus-ct-2026.json`). Les deux s’affichent dans la même fenêtre « Aide et attendu » (bouton ⓘ unique de chaque point, `openAttendu(id, { item })` de `js/views/attendus.js`).
- **`noScore: true`** : point de **synthèse** d’autres critères (F2.2.8, F4.27), coté C / P / NC / N/A et compté dans les décomptes, mais exclu de la note sur 20 (un même constat n’est jamais compté deux fois) ; badge « Point de synthèse, hors note » dans les attendus.
- **`major: true`** : **point majeur** de la note sur 20 (compte double) ; posé par la liste `MAJOR_ITEMS` de `grid-ct-2026.js` (26 points validés par l’OEG le 23/10/2026 : F2.4.4 ; F3.19 ; F10.4 à F10.6 ; F4.2, F4.12, F4.13, F4.31 ; F5.7, F5.13, F5.21, F5.24, F5.26, F5.27 ; F6.5, F6.11, F6.12 ; F7.6, F7.12 ; F8.A2, F8.A5, F8.B4, F8.B5 ; F9.9, F9.12 — les futurs critères PEZSML équivalents à F6.5 / F6.11 / F6.12 seront majeurs aussi) ; badge « Majeur (×2) » sur les feuilles (écran et PDF), dans la fiche des attendus et ses PDF (champ `majeur` du JSON des attendus, vérifié identique à la grille).
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
  stations: [ { key, siteId, pointId, prestationId, addedAt,          // ordre de passage ; key = siteId sans « site- »
                parts?, partPrestations? } ],                          // tournée mixte seulement : parties contrôlées, prestation de chaque partie
  siteId, prestationId, pointId,                                       // ceux de la 1re station (compatibilité)
  prestationIds, providerId, operatorIds, compartments,
  gridId, gridVersion, gridSnapshot, gridSha256, documentsSnapshot,    // copie FIGÉE de la grille et des documents
  responses: { [idEffectif]: { status, value, comment, at, by, byName, prefilled?, from?, fromId?, valueManual?, copiedFrom? } },
  sheets: { [instanceKey]: { observations, notes, photos, conclusion: { status, comments }, agents }, '4': { instruments } },
  conclusions: { comment, preconisations, strengths, vigilance },
  signatures: { auditor, provider }, lock, amendments, stationLog, status, startedAt, endedAt, appVersion, device,
  grading?                                                             // note sur 20 figée à la signature du contrôleur (section « Note sur 20 »)
}
```

- **Grille effective** : `expandGrid(grid, stations, sites, { provider })` (pur, `grids.js`) duplique chaque section d’une feuille `scope: 'station'` pour chaque station (`id: sec.id + '@' + clé`), suffixe ses critères (`id: it.id + '@' + clé`, `code: it.code + '·S' + rang`, `baseId`, `station`) et réécrit les conditions internes à la feuille ; les critères `scope: 'tournee'` gardent leur id (`shared: true`) et sont **comptés une seule fois** (`allItems`, `progress`, `validateResponses`, synthèse, comparaison). `effectiveGrid(audit)` (`app/audits.js`) est utilisée par **tous** les consommateurs : écran, alertes, synthèse, PDF, exports, écarts.
- **Instances de feuilles** : `sheetsOf(grilleEffective, responses, ctx)` → `{ no, instanceKey, station, index, total, sections, items, shared, … }` avec `instanceKey = String(no)` (feuille de tournée) ou `no + '@' + clé` (feuille de station). Données de feuille : `audit.sheets[instanceKey]` ; données de tournée d’une feuille station (appareils de F4) : `audit.sheets['4']` (`sheetStoreKey`).
- **Contrôleurs OEG (binôme)** : `audit.controllerIds` (ordre de la tournée ; l’agent qui crée est toujours inclus), `audit.controllerNames` `{ id: nom }` (noms figés), `audit.controllerLog` (ajouts / retraits : `at`, `by`, `byName`, `action`, `userId`, `name`, `reason`). Un audit antérieur sans `controllerIds` a pour contrôleur son auteur (`auditorId`). Droit de saisie (`canEditAudit`) : contrôleur de la tournée ou encadrement (`audit.editOthers`) ; verrouillage inchangé. `addController` / `joinTour` (« Rejoindre la tournée ») / `removeController` (motif obligatoire, jamais le dernier) : impossibles après la signature du contrôleur ; noms pré-remplis (`prefill: 'auditor.name'` : « Agent(s) OEG », « Contrôleur OEG ») mis à jour s’ils n’ont pas été modifiés. Chaque réponse garde son auteur (`by`, `byName`) : `entriesByAgent(audit)` (onglet Infos, rapport). Signature « contrôleur » par n’importe quel contrôleur ; `controllerIds` et `controllerNames` font partie du contenu scellé.
- **Opérations** : `createAudit({ auditType, stations: [{ siteId, prestationId, parts?, partPrestations? }], providerId, kind, compartments, operatorIds, controllerIds })`, `addStation(audit, { siteId, prestationId, parts?, partPrestations? })`, `removeStation(audit, key, { reason })` (motif obligatoire si des saisies existent), `setStationParts(audit, key, parts, { reason, cancelDeviations, partPrestations })` (périmètre, ci-dessous), `setResponse`, `updateSheet(audit, no, patch, { reason })`, `updateAudit(audit, mutate, { reason })`.
- **Périmètre réel des stations** (réponse de l’OEG du 18/10/2026 : « seule la partie bio ou chimie ou chimie + bio peuvent être auditées […] si c’est le même prestataire certaines opérations vont être mutualisées, sinon elles sont faites de manière indépendante ») :
  - **choix de conception** : un périmètre **par station** (`station.parts`, parties = types de tournée de la grille : `bio`, `ce`, `eso`), et non un 4e type « mixte » dans la grille : aucune nouvelle version de grille ni migration, des stations différentes d’une même tournée peuvent avoir des périmètres différents (biologie + chimie à Acarouany, chimie seule à Twenke), et une tournée d’un seul type reste exactement la donnée d’avant ;
  - **invariant** (`normalizePerimeter`, pur) : une tournée d’un seul type ne porte **ni `parts` ni `partPrestations`** (toutes les tournées existantes : sceaux, PDF et échanges inchangés) ; une tournée **mixte** (réunion des parties > 1 type, `tourTypes`) en porte sur **chaque** station ; `audit.auditType` = type **principal** (en-têtes, variantes des feuilles de tournée ; s’il n’est plus contrôlé nulle part, le premier type restant le remplace, type de prélèvement et matrice suivent) ; `audit.compartments` = réunion (`tourCompartments` : choix existant pour un type déjà contrôlé, compartiments des stations pour un type ajouté ; un type à compartiment unique — chimie : `physico` — a toujours le sien) ; `prestationId` d’une station = prestation de sa partie principale, `prestationIds` de la tournée = toutes les prestations de toutes les parties (`stationPrestationIds`) ;
  - **visibilité** (`visibleStructure`, `sheetsOf`) : dans une tournée mixte, une section d’une station est visible si elle l’est pour **l’une** de ses parties, chaque partie étant évaluée avec son contexte (`ctx.auditType` = la partie, `ctx.compartments` = `partCompartments`) ; les conditions de la grille (`FOR`, `NOT_FOR`, `ONLY`, `eq`…) gardent leur sens. Les feuilles communes restent **une** instance par station (F1, F3, F4, F5) ou par tournée (F2) : leurs points sont la réunion de ceux des parties, sans double (opérations mutualisées : une réponse, un décompte) ; F6 à F9 s’ajoutent pour la biologie. Variantes de la partie principale de la station, encadrés de chacune de ses parties (`sheetBlocks` avec plusieurs types : un seul encadré par clé, celui de la partie principale — ex. « Conclusion générale » de F4 en biologie plutôt que le bilan de la chimie, même stockage). La numérotation « Feuille X / N » reste commune à la tournée ;
  - **choix** : création (`audit-new.js`, cases `.pm-checks` d’une station sur plusieurs types — `possibleParts`, `partChoices`, `defaultParts` : type de la tournée + parties dont le **même** prestataire a une prestation programmée ouverte —, prestation de chaque partie, mention « tournée distincte » pour une partie programmée chez un autre prestataire ; étape 6 : physico-chimie imposée par la chimie) ; planning : prestations biologie + chimie du même prestataire cochées ensemble → `?prestations=a,b&type=bio`, une station aux deux parties (`initDraft`, `partPrestations` du brouillon) ; ajout d’une station (`tour-add` puis fenêtre `#pmBox`) ; onglet Infos, bouton `[data-act=tour-parts]` jusqu’à la signature du contrôleur. `setStationParts` : points d’une partie retirée **masqués, jamais effacés** (motif obligatoire s’ils contiennent des saisies : erreur `needsReason`, `perimeterChangePlan` ; écarts ouverts : `needsCancel`, annulés avec le même motif), points d’une partie ajoutée pré-remplis puis reprises (`applyLinks`), `audit.stationLog` `{ action: 'perimetre', key, siteId, before, after, reason }`, journal (`action: 'perimeter'`), historique des prestations rattachées ou retirées ;
  - **affichage** : badges des types dans l’en-tête et la liste des tournées, « Type de tournée » joint (« Hydrobiologie – RCS ESC BIO + Cours d’eau – physico-chimie », `tourTypeLabel`), titre « … – RCS ESC BIO 2026 + Physico-chimie des cours d’eau 2026 » (`headerOf({ auditTypes })`), « Contrôlé à cette station : Biologie + Chimie » (feuille 1 à l’écran et en PDF), périmètre dans l’onglet Infos, la synthèse, le PDF (synthèse), le rapport d’audit détaillé (identification, décomptes par station) et les exports ; alertes : une prestation d’une autre partie est comparée au type de prélèvement de SA partie (`samplingTypeId` de `computeAlerts`) ; verrouillage : chaque prestation rattachée devient « auditée » ;
  - **échange** : `parts` et `partPrestations` font partie de `audit.stations` (contenu scellé, transporté par le fichier d’échange ; modifié des deux côtés : la version la plus récente est retenue entière, l’autre reste dans le rapport de conflits).
- **Écarts** : créés uniquement par l’auditeur, depuis un P (criticité proposée `OBS`) ou un NC (`MIN`) — `DEFAULT_CRITICALITY` ; l’écart mémorise `stationKey`.
- **Instantané de la grille** (`gridSnapshot`, `gridSha256`) : copie de la grille **à jour** (`upToDateGrid` : une grille par défaut pas encore mise à niveau sur la tablette est lue d’après la version du code) à la création de la tournée ; il n’est **jamais** modifié ensuite, ni par une mise à niveau, ni par un échange (il fait partie du contenu scellé). La comparaison de deux tournées ignore l’unité définie par la grille (`formatValue(…, { unit: false })` : turbidité FNU puis NTU, mêmes valeurs = « identique »).
- **Scellement** : `signAudit` (empreinte du contenu au moment de la signature ; contrôleur : note sur 20 figée juste avant, `audit.grading`), `lockAudit` (exige la signature du contrôleur et celle du prestataire ou son refus motivé ; empreinte SHA-256 de `auditContent(audit)`, qui inclut `auditType`, `stations`, `compartments`, `controllerIds`, `controllerNames`, `sheets`, les constats d’écarts et les médias), `verifyAuditSeal`. Après verrouillage : amendements motivés (`audit.amend`), chacun historisé avec empreinte avant / après.

### Remplissage automatique des informations redondantes (`js/domain/links.js`)

Demande de l’OEG (octobre 2026) : « si point commun entre les fiches, une fois complété sur une feuille, remplissage auto sur les autres pour les informations redondantes ». Les liens sont définis **dans le code** (`LINK_GROUPS`), pas dans la grille : ils valent aussi pour les tournées déjà commencées, sans nouvelle version de la grille. Clé de liaison : identifiant de **base** du critère (`baseId`) ; une source de tournée (sans `@`) alimente les cibles de la tournée et de **chaque** station, une source de station (`it-F1-R5@<clé>`) celles de **la même** station ; les reprises s’enchaînent (F2.1.9 → F1.R5 de chaque station → F3.7 de la station).

| Groupe (`key`) | Source | Cibles | Mode |
|---|---|---|---|
| `date` | F2.1.4 « Date mission » | F2.5.1, F1.R1, F3.14 | auto |
| `controleurs` | F2.1.1 « Agent(s) OEG » | F1.R3 | auto |
| `meteo` / `meteo-station` | F2.1.9 → F1.R5 | F1.R5 (chaque station) → F3.7 (même station) | auto |
| `niveau` | F2.1.8 | F1.R6 | auto |
| `preleveurs` / `prestataire` | préleveurs de la tournée (`OPERATORS_SOURCE` : `audit.operatorIds`, libellés figés) | F1.R4 ; F2.2.1 (« Prestataire : équipe ») | auto |
| `equipe-station` | F1.R4 | F3.12, F4.1, F6.1, F7.1, F8.A1, F9.1 (nom / fonction), encadré `agents` de F4 | auto |
| `station` | fiche de la station (`SITE_SOURCE`, `@site@<clé>`) | F3.1–F3.6, F3.9, F3.10, F3.18 (même calcul que `prefillValue`) | auto |
| `heure-debut` / `heure-fin` | F2.1.5 / F2.1.6 | F2.5.2 / F2.5.3 | proposé |
| `coordonnees` | F3.15 | F7.3, F9.3 | proposé |
| `temperature` | F5.13 | F9.11 (champ `t`) | proposé |
| `moyens` / `difficultes` | stations de la tournée (`STATIONS_SOURCE` : `access.modes`, `transportModes`, `difficulties`) | F2.3.1 (plusieurs moyens : un bouton par choix), F2.1.10 | proposé |
| `supports` / `marche` | compartiments (`COMPARTMENTS_SOURCE`) / référence du marché des prestations et lots du contrat (`MARKET_SOURCE`) | F2.1.13 / F2.1.12 | proposé |
| `effectif` | nombre de préleveurs de la tournée | F2.2.2 | proposé |
| `sondes` / `calibration` | module « Appareils de mesure » de F4 (`INSTRUMENTS_SOURCE`) | F4.18 / F4.2 | proposé |

- **Mode `auto`** (`linkedUpdates`, appliqué par `applyLinks` dans la **même écriture** que la saisie : `setResponse`, contrôleurs ajoutés / retirés, préleveurs cochés — `setTourOperator` —, `createAudit`, `addStation`) : la cible reçoit la valeur si elle est **vide ou encore auto-remplie** (`isWritable` : `prefilled` sans statut) — jamais une saisie de l’agent (`valueManual`, posé par `setResponse` dès que l’agent change une valeur, effacement compris), jamais une reprise déjà cotée. Valeur reprise : `{ value, prefilled: true, from: 'F2.1.9', fromId: 'it-F2-1.9' }`, attribuée à l’agent connecté (`at`, `by`, `byName`, sauf réponse qui contient déjà une saisie) ; `prefilled` la laisse hors des « saisies » (`isEnteredResponse` : retrait de station, « Qui a saisi quoi »). Source vidée : les valeurs reprises **de cette source** (`fromId`) sont retirées ; fiche de station absente de la tablette : rien n’est retiré. Encadré lié : `audit.sheets[instance].agents` + `agentsFrom` (repris) ou `agentsManual` (saisi, `updateSheet`).
- **Mode `suggest`**, et cible `auto` saisie, cotée ou restée en retard sur sa source (tournée reçue de l’autre tablette, fiche de station modifiée ailleurs) : `linkProposal` → bouton « Proposé (F2.1.9) : … » (`data-act="link-take"`, plusieurs choix : `data-choice`), appliqué seulement par l’agent (`setResponse` : la valeur devient la sienne).
- **Jamais** sur une tournée signée et verrouillée ni annulée (`applyLinks`), ni à la **réception** d’un fichier d’échange (les valeurs reçues sont gardées ; la fusion traite la valeur et sa provenance d’un bloc : `VALUE_GROUPS`, section 10) ; les valeurs reprises font partie du contenu scellé (écrites avant la signature).
- **Fiche de station corrigée** (« Modifier la station », Référentiels › Sites, import de stations) : `refreshStationInfo(siteIds)` recalcule F3 dans les tournées **en cours, non signées** qui la visitent (une écriture et une entrée de journal par tournée).
- **Écran** (`js/views/audit-sheet.js`) : marque `.as-from` « repris de F2.1.9 » / « repris de la fiche station » (info-bulle : `sourceInfo(…).text`), carte < 1 100 px « Repris de … — à vérifier sur place, modifiable. » ; bouton `.as-link-suggest` ; PDF des fiches : valeurs seules (fidèles aux fiches papier), boutons et propositions masqués à l’impression.
- **Reprise de la station précédente** (`copyFromPreviousStation`, `previousStationPlan`, `copyPreviousStation`, bouton `#copyPrev` des feuilles d’une station suivante, confirmation) : points C / P / NC **encore vides** de la feuille ← cote, observation (et choix de liste) du même point de la station précédente, marqués `copiedFrom` (« repris de la station 1 ») ; jamais une mesure, des coordonnées, une information de la station (`prefill: 'site.*'`) ni un critère commun à la tournée ; tracé au journal.
- **Heures** : `auditTimes` / `auditTimeTexts` (`model.js`) — « Heure de début / de fin » de l’onglet Infos, du rapport et des exports = F2.1.5 / F2.1.6 si renseignés (création / clôture de la tournée indiquées à côté), sinon `startedAt` / `endedAt`.
- Ajouter un lien : une entrée de `LINK_GROUPS` (source et cibles présentes dans la grille, listes de choix compatibles, pas de cycle : `tests/unit/links.test.js`) ; le contrôle des doublons de la grille (section 14) tient compte des groupes.

### Note sur 20 (`js/domain/grading.js`)

Demande de l’OEG (« mettre une grille de notation pour chaque fiche d’évaluation ») ; règles **validées le 23/10/2026** :

- **Barème** : C = 1 point, P = 0,5, NC = 0 ; N/A (et NO / NV des grilles historiques) et points non renseignés ne comptent pas. **Points majeurs × 2** (`major`, `MAJOR_WEIGHT`) ; **points de synthèse** (`noScore` : F2.2.8, F4.27) cotés et comptés dans les décomptes C / P / NC / N/A, mais **hors note**. Note = points pondérés obtenus ÷ points pondérés évalués × 20, **au dixième**, virgule ; aucun point évalué : « non noté ».
- **Arrondi exact** : calcul en demi-points entiers (`got2`, `max2`) et `n10 = ⌊(400·got2 + max2) / (2·max2)⌋` (note × 10 arrondie au plus proche, demi au-dessus) : 23,5 / 200 donne « 2,4 » (le calcul flottant naïf donne 2,3). **Appréciation d’après la note affichée** (37,5 / 47 = 15,96 → « 16,0 » → Satisfaisant).
- **Seuils** : par défaut ≥ 16 « Satisfaisant », 12 à < 16 « À améliorer », < 12 « Insuffisant » ; réglages de l’organisation `gradeGood`, `gradeFair` (`seed.js`, Administration › carte « Note sur 20 », administrateur ; `thresholdErrors` : 0 à 20, « À améliorer » ≤ « Satisfaisant ») ; ils partent vers l’autre tablette avec l’entité `setting`.
- **Barème d’une tournée** (`scoringOf(gridSnapshot)`) : celui de son instantané ; un instantané **antérieur** au barème (aucun `major`, tournées commencées avant la 1.2) d’une grille fournie par l’application prend le barème de la grille du code de même identifiant, critère par critère (identifiant d’origine) — un numéro retiré depuis (F8.A3) compte × 1. Les badges « Majeur (×2) » de l’écran et du PDF suivent le même barème (`isMajorItem`).
- **Portées** (dans `summary.js`, mêmes ensembles que les décomptes) : `sheetSummary` → `grade` de chaque instance de feuille = points **affichés** dans la feuille (un point commun à la tournée compte dans la note de chaque feuille où il figure) ; `stationSummary` → `grade` de `global` (tournée : chaque point **une fois**, y compris un point commun ou une opération mutualisée d’une station biologie + chimie), de `tournee` (feuille de tournée et points communs) et de chaque station (ses points propres) ; `auditSummary` → `grade` (tournée), `null` pour une grille historique (non notée).
- **Figement à la signature** (`signAudit`, rôle `auditor`, grille en feuilles) : `freezeGrading` calcule les notes avec les seuils **actuels** et le barème de la tournée, puis `gradingRecord` les enregistre dans `audit.grading` = `{ version: 1, at, by, byName, thresholds, scale, majorWeight, source, majors, noScore, tour, tournee, stations: { clé: note }, sheets: { instanceKey: note } }` (notes compactes `{ note, level, evaluated, majors, excluded, points, max, C, P, NC, NA, unanswered }`) **avant** le calcul de l’empreinte signée : la note et les seuils font partie du contenu signé puis scellé (`auditContent`). Une nouvelle signature du contrôleur les recalcule ; « Rouvrir » les efface. Une tournée signée **avant** la notation n’a pas `grading` : son contenu, donc son sceau, est inchangé (`tests/test_notation.py`).
- **Notes à afficher** (`gradingContext`, `resolveGrades`, `auditState` → `summary.grade`, `summary.grading`, `tourGrades` pour le tableau de bord et les exports) : `figee` (valeurs enregistrées, seuils figés, même si l’administration les change), `recalculee` (modification tracée après la signature qui change la note : recalculée avec les seuils et le barème figés, note à la signature rappelée), `calculee` (tournée signée sans note figée : seuils actuels, mention « calculée »), `provisoire` (non signée : seuils actuels).
- **Affichage** : encadré « Grille de notation » en pied de chaque feuille cotée (`gradeBox` de `js/ui/sheet-chrome.js`, écran ; `SheetsRenderer.gradeBox`, PDF — cases vides sur les fiches vierges), badge `majorBadge`, pastille `gradePill` ; synthèse (carte « Note de la tournée », colonnes « Note /20 » par station et par feuille) ; PDF des fiches (synthèse) ; rapport détaillé ; tableau de bord (moyennes par prestataire et par réseau des tournées signées : `averageGrades`, réseau = programme des prestations de la tournée, à défaut réseaux de ses stations) ; exports (colonnes « Note /20 », « Appréciation », points, état et seuils ; feuille « Notes » : tournée, commun, stations, feuilles).

---

## 7. Stockage chiffré et journal d’audit

- **Chiffrement** : une clé de données aléatoire (DEK) par appareil chiffre toutes les entités et tous les médias (AES-GCM 256 bits, IV aléatoire). Pour chaque agent de la tablette, la DEK est enveloppée par une clé dérivée de SON mot de passe (PBKDF2-SHA256, 310 000 itérations, sel aléatoire) dans le trousseau (`meta.keyring` : `{ users: { identifiant: { userId, name, initials?, role, wrap, githubLogin?, disabled?, lastLogin } } }`). Le profil `user` (`{ id, username, name, firstName, lastName, initials, role, active }`, échangé entre tablettes) fait foi pour le nom, les initiales, le rôle et l’activation ; une entrée du trousseau n’existe que sur la tablette où l’agent a été ajouté. Ouvrir une session = désenvelopper la DEK, **hors connexion**. À la fermeture (manuelle ou après inactivité, 30 min par défaut), la DEK est effacée de la mémoire.
- **Journal d’audit** : chaque écriture produit une entrée `trail` (qui, quoi, quand, appareil, valeurs avant / après, motif), **chaînée** à la précédente par empreinte SHA-256 : une suppression ou altération rompt la chaîne (écran Journal › « Vérifier l’intégrité »). Les suppressions sont logiques.
- **Médias** : binaire chiffré dans le magasin `media` ; entité `media` (empreinte, horodatage, GPS, lien vers l’objet contrôlé). Un média n’est jamais modifié (une annotation crée un nouveau média `derivedFrom`).
- **Préférences** d’appareil (non sensibles) : `localStorage` préfixé `oeg-ct:` (`pref`, `setPref` de `app/settings.js`) ; préférences d’affichage **de chaque agent** (tablette partagée : filtres de l’accueil) sous `oeg-ct:u:<identifiant du profil>:<clé>` (`agentPref`, `setAgentPref`) : l’agent suivant ne reçoit jamais les filtres du précédent.
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
  - `generateSheetsPdf({ auditId })` : rapport de tournée = F2 une fois, puis les feuilles de chaque station (F1 portrait, autres feuilles paysage ; pied de page « Station i / n — Feuille X / N » ; encadré « Grille de notation » sous chaque feuille cotée, badge « Majeur ×2 »), synthèse (note de la tournée, notes par station et par feuille), signatures ; filigrane **PROVISOIRE** tant que l’audit n’est pas verrouillé ; numéro d’audit et empreinte en pied de page ;
  - `generateBlankSheetsPdf({ auditType, siteId | siteIds, compartments, parts })` : fiches vierges imprimables (valeurs du référentiel seulement) ; `parts` (ex. `['bio', 'ce']`) : tournée mixte (feuilles communes une fois) ;
  - `generateStationSheetPdf({ siteId, auditType })` : feuille 1 seule.
  Le rendu (`buildSheetsPdf`) reçoit un modèle (`sheetsModelFromAudit`, `blankSheetsModel`) : testable sans base de données. Polices `fonts/pdf/*.ttf` (Barlow, Barlow Condensed, Montserrat), couleurs de `js/ui/themes.js`, pictogrammes de `js/ui/icons.js` et logo rastérisés par canvas.
- **`js/app/static-map.js`** : carte de la feuille 1 composée à partir des tuiles (cache `oeg-ct-tiles` ou réseau), sinon schéma (silhouette de la Guyane, point, coordonnées).
- **`js/app/report.js`** : rapport d’audit détaillé (16 rubriques + synthèse), habillage OEG.

---

## 10. Échanges entre tablettes par fichier

Mode autonome (`session.mode = 'standalone'`), **celui de l’OEG** : une session par agent sur chaque tablette (trousseau, section 7), aucun serveur, aucun jeton, aucune connexion nécessaire. Les tablettes s’échangent **un fichier unique**, chiffré, que les agents font passer par Quick Share, Bluetooth, e-mail, Teams ou clé USB. Parcours utilisateur : README, section « Deux tablettes pour quatre agents ».

### Modules

| Fichier | Rôle |
|---|---|
| `js/app/exchange-file.js` | format du fichier `.oegct`, sans stockage : `encodeExchange` (`packExchange` + `sealExchange`), `decodeExchange` (`readHeader`, déchiffrement, `openPlain`), `bodyHash`, `isExchangeText`, `ExchangeError` |
| `js/domain/exchange.js` | règles pures : vecteurs de versions (`vvLeq`, `vvCompare`, `vvMax`, `vvBump`), décision de réception (`planEntity`), version commune (`chooseBase`, `nextCandidates`), règle des profils (`guardProfile`, `heldLabel`), choix des données à envoyer (`selectForSend`), nom du fichier (`exchangeFileName`), n° libre (`freeDeviceNumber`), décomptes (`countEntities`, `countsLabel`) |
| `js/app/exchange.js` | mot de passe d’échange (`setExchangePassword`, `exchangePasswordInfo`, `validateExchangePassword`), modifications à envoyer (`pendingChanges`, `exchangeState`, `watchExchange`), envoi (`prepareSend`, `markSent`), réception (`readExchange`, `previewExchange`, `receiveExchange`, `receiveSummary`), changements de profils en attente (`heldChanges`, `acceptHeld`, `refuseHeld`), historique et tablettes connues (`exchangeHistory`, `knownDevices`), mise en service d’une tablette supplémentaire (`setupProfiles`, `proposedDeviceNumber`, `setupFromExchange`) |
| `js/views/exchange.js` | fenêtres et cartes : « Envoyer à l’autre tablette » (`sendDialog`), « Recevoir un fichier » (`receiveFile`), mot de passe d’échange (`passwordDialog`), bandeau de l’accueil (`homeBanner`), `exchangeCard`, `historyCard`, `heldCard` |
| écrans | `views/sync.js` (`standaloneView` : écran « Échanges entre tablettes », route `#/synchronisation`), `views/auth.js` (mise en service : `#setupFirst`, `#setupExtra` ; `renderLogin` : rappel des modifications non envoyées), `views/admin.js` (Cette tablette, Échanges entre tablettes, changements de profils à valider, « Aucun administrateur sur cette tablette »), `views/home.js` (bandeau), `views/shell.js` (pastille « n à envoyer ») |
| `js/core/store.js` | vecteurs de versions `_vv`, file d’envoi `outbox`, `applyExchange` (une transaction), `dropOutbox`, `getLazy` / `getLazyMany` (versions déjà échangées, type `xbase`) |

### Le fichier `.oegct` : enveloppe chiffrée

Un **texte ASCII** (rien de binaire), pour traverser sans dommage e-mail, Teams, Quick Share, Bluetooth et clé USB ; fins de ligne CRLF et espaces tolérés :

```text
OEG-CT-ECHANGE 1
{"format":"oeg-ct-echange","v":1,"kdf":"PBKDF2-SHA256","iterations":310000,"salt":…,"iv":…,"check":{"iv":…,"ct":…},"z":"gzip"}
<contenu chiffré AES-GCM 256, en base64, lignes de 76 caractères>
```

- **Chiffrement toujours** : clé AES-GCM 256 bits dérivée du **mot de passe d’échange** (`passwordKey` de `js/core/crypto.js` : PBKDF2-SHA256, 310 000 itérations, sel aléatoire de 16 octets propre à chaque fichier, IV de 12 octets). L’en-tête (ligne 2) n’est pas secret.
- **`check`** : le texte connu `OEG-CT-ECHANGE` chiffré avec la même clé et un autre IV. Il distingue un **mauvais mot de passe** (`check` ne se déchiffre pas : code `password`) d’un **fichier altéré** (`check` correct, mais authentification AES-GCM du contenu en échec : code `altered`).
- **`z`** : `'gzip'` si le corps JSON est compressé (`CompressionStream`), sinon `null`.
- Nom : `OEG-echange_<tablette>_<AAAA-MM-JJ_HHhMM>.oegct` (`exchangeFileName` : nom de la tablette sans accents ni espaces). Si Android refuse de partager l’extension, le même fichier est partagé sous le nom `….oegct.txt` (`text/plain`) ; la réception reconnaît le contenu, pas l’extension (`isExchangeText`).

### Contenu

Contenu déchiffré : `[longueur du corps : 4 octets, gros-boutiste][corps JSON, compressé ou non][octets des médias, à la suite, dans l’ordre de l’index]`.

```js
corps = {
  format: 'oeg-ct-echange', v: 1, id, createdAt,
  scope: 'changes' | 'all',                  // modifications depuis le dernier envoi, ou « Tout envoyer »
  mediaScope: 'unsent' | 'all' | 'none',     // photos jointes : pas encore envoyées, toutes, aucune
  from: { id, name, number },                // tablette d'origine
  sentBy: { id, name, role, username },      // agent connecté à l'envoi (règle des profils)
  appVersion, org,
  devices: [{ id, name, number }],           // tablettes connues de l'expéditeur (n° libre proposé à la mise en service)
  counts: { total, byType, journal, media, mediaBytes },
  entities: { [type]: [versions] },          // versions échangées : _vv compris, _rev et _lv retirés ; pierres tombales _deleted
  media: [{ id, size, sha256 }],             // index des photos, signatures et documents joints
  sha256                                     // empreinte SHA-256 du JSON canonique du corps sans elle
}
```

- **Jamais dans le fichier** : les types locaux (`LOCAL_ONLY` : `conflict`, `syncLog`, `localSecret` — mot de passe d’échange, jeton —, `syncBase`, `exchangeLog`, `heldChange`), les versions déjà échangées (`LAZY_TYPES` : `xbase`), le trousseau (`meta.keyring` : clé de données enveloppée par les mots de passe des agents), la clé de données, les préférences. Les profils `user` circulent, jamais un mot de passe.
- **Médias** : contenu déchiffré avec la clé de la tablette qui envoie, placé dans l’enveloppe (donc chiffré par le mot de passe d’échange), puis rechiffré avec la clé de la tablette qui reçoit (`storeRemoteBytes`). La fiche `media` (empreinte, horodatage, GPS) accompagne toujours son contenu.

### Intégrité

Tout est vérifié **à l’ouverture, avant toute modification** (`openPlain`) : authentification AES-GCM du contenu, empreinte du corps (`bodyHash`), puis taille et empreinte SHA-256 de chaque média, et longueur totale exacte. Erreurs (`ExchangeError.code`) : `format` (pas un fichier d’échange), `version` (créé par une version plus récente : mettre l’application à jour), `password`, `altered`, `integrity`, `browser` (navigateur sans `DecompressionStream`) ; à la lecture (`readExchange`) : `nopassword`, `password-backup` (ancien paquet chiffré), `self` (fichier envoyé par cette même tablette). Les audits signés gardent leur propre scellé (empreinte de `auditContent`, dont `_vv` est exclu) : il reste vérifiable après échange.

### Envoi incrémental

`prepareSend` / `markSent` : `selectForSend` prend les entrées de la file d’envoi (`outbox`, alimentée par toute écriture locale d’une donnée partagée ; `__bin:<id>` = contenu d’un média pas encore envoyé), ou toutes les données partagées (`scope: 'all'`). Une donnée antérieure aux vecteurs de versions reçoit sa première version (`{ tablette: 1 }`) au premier envoi. Le fichier n’est **marqué envoyé** qu’une fois partagé (API Web Share : `navigator.canShare({ files })`) ou enregistré (téléchargement) : `dropOutbox` retire de la file les entrées **inchangées depuis la préparation**, les versions envoyées sont mémorisées (`xbase`, bases des fusions suivantes), puis historique (`exchangeLog`), `meta xch:lastSent` et journal (`exchange-send`). Au-delà de `LARGE_FILE` (20 Mo) : envoi proposé sans les photos (elles restent dans la file pour le prochain envoi) ou, pour « Tout envoyer », sans les photos déjà envoyées. L’envoi incrémental est pensé pour **deux tablettes** : une tablette ne retransmet pas à une troisième ce qu’elle a reçu, sauf « Tout envoyer ».

### Réception et fusion

`readExchange` (déchiffrement et vérifications ; ancien paquet JSON `oeg-audit-package-v1`, éventuellement chiffré, converti), `previewExchange` (aperçu : tablette d’origine, agent, agents et tournées, décomptes, « déjà reçu le … »), puis, après confirmation, `receiveExchange`. Pour chaque donnée, `planEntity` (`js/domain/exchange.js`) compare les vecteurs de versions :

| Cas | Décision |
|---|---|
| absente de la tablette | `add` |
| version reçue contenue dans la version locale (fichier ancien, déjà reçu) | `known` : ignorée (idempotence ; jamais d’écrasement d’une saisie plus récente) |
| même contenu | `same` : versions réunies |
| version reçue contenant la version locale | `replace` |
| concurrentes | `merge` : `mergeEntity` à trois versions avec la dernière version commune (`chooseBase` parmi les versions déjà échangées, sinon `presumedBase`) ; même champ modifié des deux côtés : la valeur la plus récente (horodatage) est retenue, l’autre va dans une entité `conflict` (réseaux et types d’une station : fusion d’ensembles, sans conflit ; position d’une station ou valeur X / Y d’une feuille : retenue d’un bloc ; valeur d’une réponse et sa provenance — saisie de l’agent ou reprise d’une autre feuille, `VALUE_GROUPS` — : retenues d’un bloc, la réponse la plus récente entière, sans aucune reprise automatique à la réception) ; nouvelle version `_vv` incrémentée, renvoyée au prochain envoi |
| audit signé d’un seul côté (ou des deux, différemment) | `signed` : version signée gardée telle quelle (scellé et empreinte intacts), l’autre dans le rapport de conflit |

Grille par défaut reçue d’une tablette pas encore mise à niveau (turbidité en FNU, version antérieure) : lue d’après la version du code (`upToDateGrid`) **avant** la comparaison — ni conflit, ni retour en arrière ; même règle pour l’ancien paquet JSON (`importPackage`). Journal d’audit : entrées absentes ajoutées telles quelles (la chaîne de chaque tablette reste vérifiable). Le tout en **une transaction** (`store.applyExchange` : données, journal, file d’envoi, versions communes), puis médias, rapport de conflit, changements de profils en attente, trousseau (`syncKeyringProfile` : nom, initiales et profil affichés ; jamais les mots de passe), tablettes connues (`meta xch:devices` : n° proposé à la mise en service d’une tablette supplémentaire, avertissement si deux tablettes ont le même n°), fichiers déjà reçus (`meta xch:received`), historique (`exchangeLog`) et journal (`exchange-receive`).

### Règle de sécurité des profils

`guardProfile` : un changement de **rôle**, de **statut actif**, la **suppression** d’un agent et un **nouveau profil administrateur** ne sont appliqués d’office que si l’expéditeur du fichier (`sentBy`) est un administrateur actif **selon les données de la tablette qui reçoit** (avant réception, `senderTrusted`). Sinon la valeur locale est gardée (un nouveau profil administrateur est créé « auditeur ») et une entité `heldChange` attend la décision d’un administrateur (Administration › « Changements de profils reçus à valider » : `acceptHeld`, `refuseHeld` ; un refus ne vaut que sur cette tablette). Même d’un administrateur, le retrait du **dernier administrateur** de la tablette attend. Le trousseau n’est jamais remplacé.

**Limite à documenter honnêtement** : la vraie frontière de sécurité est le **mot de passe d’échange**. `sentBy` est déclaré par la tablette qui envoie et n’est pas signé individuellement : quiconque connaît le mot de passe d’échange et dispose d’un fichier peut en lire le contenu, fabriquer un fichier, ou mettre une tablette en service en choisissant n’importe quel profil reçu. Tablette perdue : changer le mot de passe d’échange sur les autres tablettes.

### Mot de passe d’échange et mise en service

- **Mot de passe d’échange** : 10 caractères minimum (`EXCHANGE_PASSWORD_MIN`), défini par un administrateur à la mise en service de la première tablette puis repris à la mise en service des suivantes ; conservé chiffré avec la clé de la tablette (`localSecret` `exchange:password`), jamais dans un fichier ; changé par un administrateur (Administration › Échanges entre tablettes, journal `exchange-password`). Fichier chiffré avec un autre mot de passe : il est demandé, rien n’est modifié, et un administrateur peut l’adopter.
- **Tablette supplémentaire** (`setupFromExchange`) : fichier + mot de passe d’échange, n° libre proposé, « Qui êtes-vous ? » parmi les agents actifs reçus (administrateurs d’abord) : `setupFromProfile` crée l’entrée du trousseau avec le **même identifiant de profil**, puis tout le fichier est reçu (sans règle des profils : `setup: true`). Mise en service par un agent qui n’est pas administrateur : un administrateur s’ajoute ensuite lui-même (`enrollAgent` autorise l’ajout d’un administrateur sur une tablette qui n’en a aucun).

### Tests

- `tests/unit/exchange.test.js` (navigateur) : format `.oegct` (texte ASCII, en-tête, rien en clair, CRLF, corps compressé ou non), mauvais mot de passe, fichier altéré, empreinte du corps ou d’un média incorrecte, version plus récente, vecteurs de versions, décisions de réception, fusion avec la version commune et conflit réel, tournée signée gardée scellée, deux tablettes simulées (fichiers croisés d’un binôme, fichier ancien, idempotence, suppression propagée), envoi incrémental, « Tout envoyer », envoi sans les photos, règle des profils, nom du fichier, n° libre, invariants (`_vv` métadonnée, types locaux jamais échangés, empreinte scellée indépendante des versions).
- `tests/test_echange_tablettes.py` (pytest + Playwright, **deux contextes de navigateur** = deux tablettes au stockage séparé, Web Share retiré : fichier téléchargé puis choisi) : mise en service « Tablette supplémentaire » (mauvais mot de passe refusé, n° proposé, même profil), binôme sur deux tablettes, photo reçue intacte, signature et retour (empreinte scellée identique), autre mot de passe d’échange puis adoption, double réception sans effet, fichier de la tablette elle-même refusé, règle des profils (mise en attente, acceptation, application d’office), envoi incrémental, ancien paquet JSON.
- `tests/test_tablette_partagee.py` : sessions des agents sur une tablette partagée (voir section 12).

---

## 11. Conventions de code

- En-tête de fichier en commentaire, **en français**, décrivant le rôle du module ; densité de commentaires comparable à l’existant ; noms de fonctions et de variables en anglais ou en français selon le module voisin.
- Gabarits : `html\`…\`` échappe toutes les valeurs interpolées ; `raw()` uniquement pour du HTML déjà sûr. Jamais de concaténation de HTML avec des données saisies.
- Actions par attributs : `data-act` (clic), `data-change`, `data-input`, `data-submit` ; pas d’écouteurs d’événements dispersés.
- Les règles métier vont dans `js/domain` (fonctions **pures**, sans DOM ni IndexedDB) ; les écritures passent par `js/app` et `store` (journalisées, avec motif quand c’est pertinent).
- Données : ne jamais effacer physiquement (suppression logique) ; un audit verrouillé ne se modifie que par amendement motivé.
- Texte : français, apostrophe ’, espaces avant `:` `;` `?` `!` comme le reste de l’interface ; dates `JJ/MM/AAAA` à l’affichage.
- Pas de dépendance externe nouvelle sans l’embarquer dans `vendor/` (avec sa licence) et l’ajouter à `SHELL`.

---

## 12. Tests

### Tests unitaires dans le navigateur

- Page : `tests/unit/index.html` (servie par `python tools/serve.py` : <http://localhost:8000/tests/unit/index.html>) ; paramètre `?files=grid-ct-2026,core` pour n’exécuter que certains fichiers.
- `tests/unit/all.js` liste les fichiers : `core.test.js`, `domain.test.js`, `formats.test.js`, `grid-ct-2026.test.js` (dont la turbidité en NTU et la mise à niveau des grilles par défaut), `networks.test.js` (réseaux de surveillance : défauts, normalisation, regroupement des 108 stations, déduction des types identique à l’ancienne règle, fusion d’ensemble, conditions), `pdf-sheets.test.js`, `github.test.js`, `attendus.test.js`, `exchange.test.js`, `demandes.test.js` (annulation de tournée, opérateurs sans doublon, métadonnées EXIF, boutons « Prendre une photo » / « Importer depuis la galerie », logo), `coords.test.js` (coordonnées UTM 22N / 21N : points de contrôle, conversion, saisie, contrôles, fusion d’un bloc), `links.test.js` (remplissage automatique : chaque groupe, chaîne F2 → F1 → F3, non-écrasement, source vidée, fiche de station, propositions, cible en retard, fusion d’un bloc à l’échange, station précédente, heures F2.1.5 / 1.6), `perimetre.test.js` (périmètre réel des stations : parties, compartiments, tournée d’un seul type identique à l’ancienne, station biologie + chimie sans doublon, tournée mixte à trois stations, décomptes, `normalizePerimeter`, en-tête, pré-remplissage, fusion), `grading.test.js` (note sur 20 : barème, vecteurs d’arrondi, « non noté », seuils, points majeurs × 2 et points de synthèse hors note, 26 points majeurs de CT-2026, barème d’un instantané antérieur, portées feuille / station / commun / tournée, point commun et opération mutualisée comptés une fois, note figée, recalculée, calculée ou provisoire, moyennes du tableau de bord) (un fichier absent ou en erreur est compté comme un échec). `exchange.test.js` : voir section 10 ; `github.test.js` : client GitHub du mode équipe (annexe).
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
- Fichiers de tests, notamment : `tests/test_unit.py` (chaque fichier de tests unitaires du navigateur, et sa présence dans `all.js`) ; `tests/test_smoke.py` (configuration, affichage de chaque écran principal sans erreur, verrouillage / déverrouillage, fonctionnement hors connexion avec le service worker) ; `tests/test_sync_github.py` couvre le mode équipe (annexe ; initialisation, réception, fusion et conflits, révocation, numéros sans doublon, rattachement / détachement, erreurs claires, mode autonome) avec `tests/fake_github.py` ; `tests/test_tablette_partagee.py` couvre la tablette partagée (tournée en binôme, « Changer d’agent », « Rejoindre la tournée », signature par le second contrôleur, « Ajouter un agent », « Ajouter sur cette tablette » pour un profil reçu d’une autre tablette par paquet de données, « Retirer de cette tablette », dernier administrateur, « Changer d’agent » sur tablette et téléphone) ; `tests/test_reseaux.py` couvre les réseaux de surveillance et la turbidité en NTU (installation, mise à niveau d’une tablette ancienne, garde-fous avant migration, tournée signée en FNU intacte, idempotence, Référentiels › Réseaux, modification de station, imports de sites, fusion des réseaux entre deux tablettes et grille FNU reçue sans retour en arrière) ; `tests/test_demandes_oeg.py` couvre les demandes de l’OEG d’octobre 2026 (« Annuler la tournée » par un contrôleur du binôme sur tablette et téléphone, refus expliqués, filtre « Annulées » ; « Ajouter un opérateur » sans doublon à la création et sur F2 par un auditeur ; « Prendre une photo » / « Importer depuis la galerie » avec date EXIF ou date d’import signalée, sur les critères, encadrés, fiche station, observations et écarts — fichiers `tests/fixtures/photo-exif.jpg` ; logo SVG ou PNG — `tests/fixtures/logo-test.*` — dans les écrans, tous les PDF et sur une seconde tablette) ; `tests/test_coordonnees_utm.py` couvre les coordonnées UTM 22N / 21N (fiche d’une station et feuille 3 sur tablette et téléphone : conversion affichée et enregistrée, saisie d’origine, alertes, relevé GPS, PDF ; import de stations ; tournée signée intacte ; échange entre deux tablettes dans les deux sens) ; `tests/test_doublons.py` couvre la grille CT-2026 1.2 sans doublon ni redondance (tablette en 1.1 avec une tournée signée : mise à niveau, instantané, empreinte et sceau intacts, PDF de la tournée signée avec ses libellés d’origine ; nouvelle tournée et fiches vierges en 1.2 ; fenêtre unique « Aide et attendu » ; zones libres distinctes ; une seule entrée de menu « Audits » ; tablette et téléphone sans défilement horizontal) ; `tests/test_remplissage_auto.py` couvre le remplissage automatique (tournée à deux stations sur tablette et téléphone : F2 → F1 → F3 / F4 des deux stations, saisie de l’agent conservée et nouvelle valeur seulement proposée, date corrigée jusque dans le PDF, préleveurs, valeurs proposées de F2 et F4, fiche de station corrigée, « Heure de début » de l’onglet Infos, reprise de la station précédente, tournée signée intacte, échange entre deux tablettes sans doublon ni perte) ; `tests/test_perimetre.py` couvre le périmètre réel des stations (tournée HYDRECO biologie + chimie à Acarouany créée à l’écran sur tablette et téléphone : cases et prestations de chaque partie, opérations mutualisées sans doublon, station ajoutée pour la chimie seule, PDF et fiches vierges « Biologie + Chimie » ; tournée chimie seule de l’OEG en régie identique à une tournée d’avant ; deux prestataires, deux tournées indépendantes ; tournée mixte préparée depuis le planning ; modification du périmètre avant signature avec motif, écart annulé, historique et journal, refus après signature ; tournées signées intactes ; échange entre deux tablettes) ; `tests/test_notation.py` couvre la note sur 20 (saisie sur tablette et téléphone : badge « Majeur (×2) », encadré « Grille de notation » en pied de feuille mis à jour à chaque cote, synthèse et colonnes « Note /20 » ; PDF des fiches et rapport détaillé ; seuils modifiés en Administration — refus des seuils incohérents — : l’appréciation d’une tournée en cours change, celle d’une tournée signée non ; signature qui fige la note et les seuils dans le contenu scellé ; tournée signée avant la notation intacte, note « calculée » ; tableau de bord par prestataire et par réseau ; exports Excel / CSV); `tests/test_echange_tablettes.py` couvre l’échange par fichier avec **deux contextes de navigateur** (deux tablettes au stockage séparé, Web Share retiré : fichier téléchargé puis choisi) : mise en service « Tablette supplémentaire », binôme sur deux tablettes, signature, retour, empreinte scellée identique, mauvais mot de passe d’échange, double réception, règle des profils, envoi incrémental, ancien paquet JSON.

---

## 13. Outils et vérification automatique

| Commande | Rôle |
|---|---|
| `python tools/serve.py` | serveur local sans cache sur <http://localhost:8000> (`--port`, `--open`, `--bind`) |
| `python tools/bump_version.py` | incrémente `AUDIT_BUILD` et met `AUDIT_BUILD_DATE` à la date du jour dans `version.js` (`--dry-run` : sans modifier) |
| `python tools/check_release.py` | vérifications statiques avant publication, sans Node ni réseau : fichiers de `SHELL` existants et fichiers de l’application tous présents dans `SHELL`, fichiers référencés et imports relatifs existants, aucun chemin absolu (`/js/…`), aucun code propre à Node dans `js/`, JSON valides, `AUDIT_BUILD` entier et incrémenté si un fichier de l’application ou `sw.js` a changé (base : `--base`, défaut `origin/main` ou `HEAD~1`) |
| `python -m pytest` | tous les tests (unitaires navigateur, parcours, tablettes partagées, échange par fichier, mode équipe) |

- **GitHub Actions** : `.github/workflows/verifications.yml` lance les vérifications et les tests à chaque envoi ; résultat dans l’onglet **Actions**.
- **VS Code** : `.vscode/tasks.json` regroupe ces commandes (Terminal › Run Task…).

---

## 14. Ajouter un critère ou une feuille sans créer de doublon

### Avant d’ajouter quoi que ce soit

1. **Chercher si le point existe déjà** : parcourir la feuille thématique dans `grid-ct-2026.js` (libellés, `help`), les attendus (`data/attendus-ct-2026.json` : ce que juge chaque critère) et la table de traçabilité. Si un critère couvre déjà le sujet, **ne pas créer de critère** : compléter son aide (`help: inc('…')`, qui produit « Inclut : … ») et, si utile, son `input` et son attendu.
2. **Choisir la feuille thématique** (organisation → F2, station et site → F3, ouvrage et purge → F10, mesures in situ et flaconnage → F4, prélèvement et chaîne du froid → F5, biologie → F6 à F9) et la **portée** : point de journée ⇒ F2 ou `scope: 'tournee'` dans une feuille station ; point propre à chaque station ⇒ critère de station.

### Pas de doublon ni de redondance : règles et contrôles automatiques

Demande de l’OEG (16/10/2026) : « Vérifie qu’il n’y ait pas de doublons ou de redondance dans les descriptions dans les fiches terrain ». Règles appliquées depuis la version 1.2 de CT-2026, **vérifiées automatiquement** par `tests/unit/grid-ct-2026.test.js` (tests « doublons : … ») et `tests/unit/attendus.test.js` :

1. **Un constat, une cote** : deux critères voisins ne jugent pas le même manquement. On **recadre** leurs attendus (ce que chacun juge, renvoi vers l’autre : « le rinçage du matériel est jugé en F5.9 »), on marque une **synthèse** `noScore: true`, ou on passe un fait de la journée en `scope: 'tournee'` (un critère par station jugerait plusieurs fois le même véhicule). Exemples 1.2 : flacons avec réactif (F4.13 seul, F4.17 = flacons sans réactif, F5.25 = autres consignes) ; mesures in situ (F4.3 règles communes, F4.4–F4.10 et F4.29 propres au paramètre, F4.26 regard critique, F4.28 mesure manquante ; F4.27 synthèse) ; EPI (F2.4.4 sécurité, F5.2 gants d’hygiène, F5.22 sécurité de l’opération).
2. **Libellés** : unique dans une feuille, sans exception ; un même libellé dans deux feuilles seulement pour un critère par protocole ou par portée, listé et commenté dans `SAME_LABEL_OK`.
3. **Même information demandée deux fois** (même source de pré-remplissage, même liste de choix, ou libellés proches pour une date, une heure, un nombre, une liste ou des coordonnées) : seulement si les deux champs sont reliés par un groupe de remplissage de `js/domain/links.js` (`LINK_GROUPS` : reprise automatique ou valeur proposée) ou listés et commentés dans `SAME_INFO_OK`.
4. **Aides** : jamais deux fois la même ; seulement « Inclut : … » (et deux exceptions commentées) ; tout code cité (« F5.28 ») existe.
5. **Attendus** : aucun attendu recopié d’un critère à l’autre (personnaliser par protocole), aucune entrée identique, renvois vers des critères existants, liste de préparation sans élément répété.
6. **Zones de texte libres** : chaque encadré a un texte d’invite distinct (`placeholder`).

Toute exception nouvelle s’ajoute **à la liste blanche, avec un commentaire** qui dit pourquoi elle n’est pas un doublon.

### Retirer ou fusionner un critère sans renuméroter

Les réponses des tournées sont rattachées à l’identifiant `it-F<n>-<no>` : un numéro n’est **jamais réutilisé ni renuméroté**. Préférer, dans l’ordre : recadrer l’attendu ; `noScore: true` ; `scope: 'tournee'`. Pour retirer vraiment un critère : supprimer l’objet de la grille, l’ajouter sous « NUMÉROS RETIRÉS » en tête de `grid-ct-2026.js` (` *   F8.A3 → F8.A2 (1.2)` : critère qui le reprend, version — premier cas, validé par l’OEG le 23/10/2026), mettre à jour la table de traçabilité si un point des fiches d’évaluation y renvoyait, supprimer l’entrée de `data/attendus-ct-2026.json` (puis `python tools/attendus_md.py`), les décomptes des tests, et incrémenter la version de la grille (section suivante). Le test « numéros retirés » refuse qu’un critère reprenne un numéro retiré ; les tournées existantes gardent le critère dans leur instantané. Version 1.2 : aucun critère retiré.

### Ajouter un critère

1. L’ajouter **à la suite** dans la section voulue, avec le **numéro suivant** de la feuille (ne jamais réutiliser ni renuméroter un numéro existant : les réponses des audits sont rattachées à l’identifiant) : `C(4, 32, 'Libellé', 'Réf. courte', { … })` pour un critère C / P / NC / N/A, `V(…)` pour une valeur seule.
2. Poser la **condition** adaptée (`FOR('eso')`, `NOT_FOR('eso')`, `ONLY('physico')`, condition sur un autre critère…) pour qu’il soit masqué là où il est sans objet.
3. Si le point provient d’une fiche d’évaluation, ajouter ou mettre à jour la ligne de la **table de traçabilité** (` * [CE] … → it-F4-32`).
4. Mettre à jour `tests/unit/grid-ct-2026.test.js` : nombre de critères par feuille, liste des critères partagés, liste des critères ajoutés, décompte des points de traçabilité le cas échéant. Lancer les tests.
5. Note sur 20 : un point de synthèse d’autres critères reçoit `noScore: true` ; un point **majeur** (décision de l’OEG) est ajouté à `MAJOR_ITEMS` (et `"majeur": true` dans `data/attendus-ct-2026.json`) ; mettre à jour la liste du test « 26 points majeurs » de `tests/unit/grading.test.js`.
6. Vérifier l’affichage (tablette ≥ 1 100 px et téléphone) et le PDF (« Fiches de contrôle (PDF) » et « Fiches vierges (PDF) ») : le rendu est générique, aucun code d’écran n’est normalement à modifier.

### Ajouter une feuille

1. Ajouter l’objet dans `sheets` **à la position d’affichage voulue**, avec un `no` **nouveau et stable** (ex. 11), `key`, `tab`, `title`, `theme` (palette de `js/ui/themes.js` et classe `.th-<thème>` de `css/sheet.css`), `compartment` (nouveau compartiment à déclarer dans `compartments` et, le cas échéant, dans `types[].compartments`), `scope`, `layout: 'table'`, `blocks`.
2. Ajouter ses sections (`sheet: 11`) et critères `it-F11-<no>`.
3. Mettre à jour les tests de structure (ordre des feuilles, feuilles par type de tournée, nombre de critères) et vérifier écran et PDF.

### Diffuser une nouvelle version de la grille

Une tournée est **figée** : chaque audit garde une copie intégrale de sa grille (`gridSnapshot`, empreinte `gridSha256`, dans le contenu signé et scellé) et ne change jamais. Les **grilles par défaut** (`DEFAULT_GRIDS` : CT-2026, GR-PREL-EAU, GR-RAPIDE), elles, suivent l’application : c’est l’**exception documentée** à la règle « grille publiée figée ». Pour diffuser une évolution d’une grille par défaut à toutes les tablettes, **en gardant son identifiant** :

1. modifier la grille dans le code (`grid-ct-2026.js`, `default-grids.js`) sans jamais réutiliser ni renuméroter un identifiant de critère (section précédente) ;
2. **incrémenter son numéro `version`** (ex. `'1.1'` → `'1.2'` ; comparaison numérique, `compareVersions`) ;
3. décrire la révision sous « RÉVISIONS » en tête de `grid-ct-2026.js` (vérifié par les tests) ;
4. incrémenter `AUDIT_BUILD`, lancer les tests (`tests/unit/grid-ct-2026.test.js`, `tests/test_reseaux.py`, `tests/test_doublons.py`), publier.

Ce qui se passe ensuite, sans autre code :

- **mise à niveau** : `upgradeReferentiel2026` (ouverture de session d’un profil « référentiels », bouton Administration › « Mettre à niveau le référentiel ») appelle `upgradeDefaultGrids` : pour chaque grille par défaut enregistrée, `upgradeStoredGrid` (pur, déterministe, idempotent) remplace son contenu par celui du code si la version du code est **plus élevée** (métadonnées d’enregistrement conservées : journal d’audit et file d’envoi gérés par `store.put`) ; sinon il ne change rien, sauf les unités de turbidité (`replaceGridUnits` : FNU / NFU → NTU). Jamais de retour à une version antérieure (grille reçue d’une tablette déjà mise à jour), jamais de grille supprimée recréée, et aucune date dans le contenu : deux tablettes produisent la même grille, sans conflit à l’échange ;
- **avant la mise à niveau** (tablette où aucun administrateur n’a encore ouvert de session) : `upToDateGrid` lit déjà la grille enregistrée d’après le code pour les écrans, les fiches vierges (`ctGrid`, `ctGridFromStore`) et l’instantané d’une **nouvelle** tournée (`createAudit`) ; une grille reçue d’une tablette non mise à jour (fichier d’échange, ancien paquet) est lue de la même façon avant d’être comparée ;
- **grille modifiée localement** : l’écran Grilles ne permet pas de modifier une grille publiée (seuls les brouillons sont modifiables) ; un administrateur peut seulement l’**archiver** ou en créer une nouvelle version, sous un **autre identifiant** (jamais touchée par la mise à niveau, mais non utilisée par les tournées CT-2026, qui lisent `grid-ct-2026-v1`). Une grille par défaut archivée reste archivée (statut et date conservés), son contenu suit le code ;
- **tournées existantes** : jamais modifiées, signées ou non (`gridSnapshot` et `gridSha256` font partie du contenu scellé : les modifier casserait le sceau) ; elles s’affichent, s’impriment et s’exportent avec leur propre grille. La comparaison de deux tournées ignore l’unité définie par la grille.

Exemples : la **version 1.2 de CT-2026** retire les doublons et redondances (libellés des heures de F2, F4.14 et F4.16 communs à la tournée, F2.2.8 et F4.27 hors note, aides réduites à « Inclut : … », zones libres distinguées ; section précédente), porte les 26 points majeurs de la note sur 20 et réunit F8.A3 à F8.A2 (F8.A3 retiré) — une tablette en 1.1 reçoit la 1.2 à la mise à niveau, ses tournées commencées ou signées gardent leur instantané 1.1 et leur sceau (`tests/test_doublons.py`) ; la **version 1.1** note la turbidité de F4.9 en **NTU** (unité des CCTP 2026, paramètre SANDRE 1295, mesure en triplicat ; même identifiant `grid-ct-2026-v1`) ; V08 de GR-PREL-EAU passe aussi en NTU (même version, par `replaceGridUnits`) ; l’unité `unit-NTU` est ajoutée au référentiel des unités (`unit-FNU` et `unit-NFU` conservées pour l’historique). Aucune conversion numérique : les tournées antérieures restent libellées FNU.

Changement de **structure** incompatible (feuille supprimée, critère dont le sens change) : publier plutôt une nouvelle grille sous un **nouvel identifiant** (ex. `grid-ct-2026-v2`), mettre à jour `CT_GRID` (`js/views/station-sheet.js`) et `CT_GRID_ID` (`js/domain/seed.js`), puis, dans `upgradeReferentiel2026`, archiver l’ancienne grille et rattacher les prestations programmées à la nouvelle, comme pour l’ancienne grille CT-BIO-2026.

### Attendus des prestataires

`data/attendus-ct-2026.json` contient une entrée par critère de la grille CT-2026 (attendu, vérification, exemples C / P / NC / N/A, références, points « à préciser par l’OEG », `majeur: true` des points majeurs, recopié de la grille) et la règle de la note sur 20 (`notation`). C’est la source unique de l’écran `#/attendus`, des PDF et de [ATTENDUS-PRESTATAIRES.md](ATTENDUS-PRESTATAIRES.md). Après toute modification du JSON, lancer `python tools/attendus_md.py` pour régénérer le document ; `python tools/attendus_md.py --check` vérifie qu’il est à jour (test `tests/test_attendus.py`). Quand un critère est ajouté ou modifié dans la grille, `tests/unit/attendus.test.js` signale l’entrée à créer ou à mettre à jour.

---

## Annexe : synchronisation GitHub (mode équipe, non utilisée à l’OEG)

> **Option technique, non utilisée à l’OEG** : l’OEG a choisi une session par agent et l’échange par fichier entre tablettes (section 10), **sans jeton**. Le mode équipe reste dans le code, avec ses tests (`tests/unit/github.test.js`, `tests/test_sync_github.py`), pour une organisation qui voudrait une synchronisation automatique par un dépôt GitHub privé. Dans l’application, il n’apparaît que dans une option avancée repliée, marquée « nécessite un jeton GitHub — non utilisé à l’OEG » : mise en service (`#setupAdvanced`, « Rejoindre une équipe ») et écran Échanges entre tablettes (`#teamAdvanced`, « Rejoindre une équipe (dépôt GitHub) »). Aucun document destiné aux agents n’en parle. Le dépôt privé `CSRE-DCE/fiche-de-controle-donn-es` de l’OEG n’est pas utilisé par l’application (archive manuelle facultative : [GUIDE-GITHUB.md, section 12](GUIDE-GITHUB.md#12-archiver-des-rapports-dans-le-dépôt-privé-facultatif)).

Modes (`session.mode`) : `standalone` (autonome, celui de l’OEG) et `github` (équipe : `TEAM_MODE` de `core/auth.js`). Paramètres d’équipe : `{ apiUrl, owner, repo, branch: 'main', prefix: 'donnees/' }` ; jeton « fine-grained » **de la tablette** conservé chiffré (entité locale `localSecret` `github:token`) : un jeton par tablette, créé par l’administrateur de l’équipe ; les agents n’ont pas de compte GitHub. `session.githubLogin` est le login du **propriétaire du jeton**, pas celui de l’agent connecté. Écrans du mode équipe : « Synchronisation » (`views/sync.js` : état, file d’envoi, conflits, aide pas à pas `helpCard`, « Renouveler le jeton », « Détacher »), Administration › « Membres de l’équipe » et « Appareils de l’équipe » (`config/utilisateurs.json`, `config/appareils.json`, révocation).

### Mise en place (pour mémoire)

1. **Dépôt de données** : un dépôt GitHub **privé**, distinct du dépôt public de l’application, vide ou avec un simple README. L’application refuse un dépôt public et n’accepte qu’une API en HTTPS (sauf `localhost` pour les tests).
2. **Un jeton par tablette**, créé par l’administrateur depuis son compte GitHub (Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token) : nom de la tablette (« Tablette 1 »…), Resource owner = propriétaire du dépôt de données (l’organisation doit autoriser les jetons fine-grained), expiration courte, accès limité à ce seul dépôt, permission **Contents : Read and write** et aucune autre. Le jeton (`github_pat_…`) est collé sur la tablette concernée, jamais copié ailleurs.
3. **Première tablette** : « Rejoindre une équipe » (ou « Rattacher cet appareil » sur un appareil autonome déjà utilisé) : le dépôt vide est initialisé (`config/…`), puis le référentiel est envoyé. **Tablettes suivantes** : même dépôt, jeton de la tablette ; l’administrateur y retrouve son profil (« C’est moi », `probeTeam(…, { profiles: true })`), puis « Ajouter sur cette tablette » pour chaque agent.
4. Tablette perdue : Administration › Appareils de l’équipe › « Désactiver (perdu) » **et** suppression du jeton de cette tablette sur GitHub (la révocation dans l’application efface les données de l’appareil à sa synchronisation suivante, mais ne désactive pas le jeton).

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
4. **Numéros d’audit** réservés par blocs de 25 dans `config/sequences.json` (dans le même commit) ; plage de secours propre à l’appareil si le bloc est épuisé hors connexion. **Appareils** : n° unique attribué par `config/appareils.json` ; appareil révoqué ⇒ effacement local (`onRevoked` de `main.js`). **Rôles** (`applyTeamRoles`) : `config/utilisateurs.json`, appliqué seulement aux agents explicitement rattachés à un login (`githubLogin` du profil, qui fait foi, à défaut du trousseau) ; les autres agents gardent leur profil local — le login du jeton de la tablette n’est jamais attribué à un autre agent ; membre désactivé ⇒ session fermée. `replaceToken` ne rattache l’agent connecté au login du nouveau jeton que s’il était déjà rattaché au login du jeton remplacé.
5. Déclencheurs : ouverture de session, 8 s après une modification, toutes les 5 minutes en ligne, retour du réseau, bouton « Synchroniser maintenant ». Chaque synchronisation est tracée (`syncLog`).

**Sécurité** : les droits sont appliqués par l’application ; la vraie frontière est l’accès au dépôt privé (qui détient un jeton peut tout lire et écrire). Les fichiers du dépôt de données sont en clair pour ceux qui y ont accès.

**Tests** : `js/app/github.js` ne dépend ni du stockage ni de la session : il est testé seul avec un `fetch` simulé (`tests/unit/github.test.js`). Les scénarios de bout en bout à deux appareils utilisent un faux serveur de l’API (`tests/fake_github.py`, empreintes git exactes, refus « non fast-forward ») : `tests/test_sync_github.py` (initialisation, réception, fusion et conflits, révocation, numéros sans doublon, rattachement / détachement, erreurs claires, mode autonome).
