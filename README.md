# Fiches de contrôle terrain — Office de l’Eau de Guyane

Application web de l’Office de l’Eau de Guyane (OEG) pour **contrôler sur le terrain les prestataires de prélèvement** (eaux de surface, eaux souterraines, suivi biologique). Elle s’utilise sur tablette, téléphone ou ordinateur, **fonctionne sans connexion** une fois installée et ne demande aucune installation de logiciel : un navigateur récent suffit.

**Adresse de l’application :** <https://csre-dce.github.io/fiche-de-contr-le/>

> Ce dépôt est **public** : il contient uniquement l’application. Les données de contrôle (audits, photos, signatures) restent **chiffrées sur les tablettes** et passent d’une tablette à l’autre **par fichier** (voir [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents)). N’ajoutez jamais de données dans ce dépôt.

Documents complémentaires :

- [docs/GUIDE-GITHUB.md](docs/GUIDE-GITHUB.md) : guide pas à pas de GitHub pour débutant (publier l’application, ajouter des fichiers, GitHub Desktop, VS Code, archiver des rapports dans le dépôt privé) ;
- [docs/ATTENDUS-PRESTATAIRES.md](docs/ATTENDUS-PRESTATAIRES.md) : fiche des attendus des prestataires (ce qui est attendu pour chaque point de contrôle, comment le contrôleur le vérifie, comment coter C / P / NC / N/A ; liste de préparation de la tournée) ;
- [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md) : architecture, format du fichier d’échange entre tablettes et règles de développement (pour les personnes qui modifient le code) ; en annexe technique, la synchronisation par GitHub, non utilisée à l’OEG ;
- [docs/charte.html](docs/charte.html) : charte graphique « vivante » (composants réels de l’application) ; [docs/maquettes/](docs/maquettes/) : maquettes des 9 feuilles d’origine.

## Sommaire

1. [Présentation](#présentation)
2. [Fonctionnalités](#fonctionnalités)
3. [Utiliser l’application](#utiliser-lapplication)
4. [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents) : une session par agent, mise en service des deux tablettes, au quotidien, échanges par fichier, conflits, tablette perdue
5. [Publier le site avec GitHub Pages](#publier-le-site-avec-github-pages)
6. [Travailler sans Node : VS Code ou Python](#travailler-sans-node--vs-code-ou-python)
7. [Ajouter ou modifier des fichiers sur GitHub](#ajouter-ou-modifier-des-fichiers-sur-github)
8. [Mettre à jour l’application](#mettre-à-jour-lapplication)
9. [Tests](#tests)
10. [Structure du dépôt](#structure-du-dépôt)
11. [Licences et sources](#licences-et-sources)

---

## Présentation

### À quoi sert l’application ?

Le contrôleur de l’OEG accompagne un prestataire de prélèvement pendant sa journée de terrain et vérifie, point par point, que les opérations sont conformes (organisation, sécurité, matériel, étalonnage, prélèvement, conditionnement, chaîne du froid, traçabilité…). Les prestataires proposés en premier sont ceux des contrôles 2026 : **Titulaire du marché – lot 1**, **OEG en régie**, **HYDRECO** et **NBC** ; tout autre prestataire du référentiel peut être choisi.

**Un contrôle = une tournée** : une journée de contrôle d’un prestataire, sur une ou plusieurs stations visitées dans l’ordre de passage.

- Les points communs à la journée (organisation, logistique, équipement, étalonnage des sondes, flaconnage, glacières et chaîne du froid, documentation, sécurité, expédition) sont renseignés **une seule fois** par tournée.
- Les fiches « station » sont **répétées pour chaque station** visitée.
- Chaque tournée a **un numéro** (AUD-AAAA-NNNNNN), **une synthèse**, **un rapport PDF** et **une signature**.

### Trois types de tournée

| Type de tournée | Programme | Code des stations | Feuilles par station |
|---|---|---|---|
| **Hydrobiologie – RCS ESC BIO** | RCS ESC BIO 2026 | Code SANDRE | les 9 feuilles des maquettes (selon les compartiments retenus) |
| **Cours d’eau – physico-chimie** | Physico-chimie des cours d’eau 2026 | Code SANDRE | 5 feuilles |
| **Eaux souterraines** | Surveillance des eaux souterraines 2026 | Code BSS | 6 feuilles (dont « Ouvrage et purge ») |

### Une station sur deux réseaux : on contrôle ce qui est réellement fait

Quinze stations relèvent à la fois de la **biologie** (réseau BIO) et de la **chimie** (réseau Chimie). Selon la situation, seule la partie biologie, seule la partie chimie, ou les deux sont contrôlées. À la création de la tournée (et à l’ajout d’une station), ces stations affichent les cases **« Contrôlé à cette station : ☑ Biologie ☐ Chimie »**, avec la prestation programmée de chaque partie :

- la partie du type de tournée choisi est cochée ; l’autre partie l’est d’office seulement si **le même prestataire** y a une prestation programmée ; sinon elle est proposée avec la mention « Programmée pour OEG en régie : tournée distincte » (cochez-la si, ce jour-là, le prestataire contrôlé la réalise) ;
- **même prestataire pour les deux** : **une seule tournée**, dite « mixte » (« Hydrobiologie + Cours d’eau ») ; les opérations communes (organisation de la tournée, accès et caractérisation de la station, mesures in situ, prélèvement, conservation et transport, critères communs à la tournée) ne sont **saisies et comptées qu’une fois** pour la station ; les feuilles propres à la biologie (invertébrés, diatomées, poissons, phytoplancton) s’ajoutent ; une station contrôlée pour la chimie seule n’a ni feuille biologique ni point propre à la biologie (rang de Strahler, habitats…) ;
- **prestataires différents** : deux **tournées indépendantes** (une par prestataire), chacune avec son périmètre ;
- depuis le **Planning**, cocher la prestation biologique et la prestation chimie d’un même prestataire à une même station puis « Démarrer une tournée » prépare directement cette tournée mixte, chaque prestation rattachée à sa partie ;
- le périmètre reste **modifiable jusqu’à la signature du contrôleur** (onglet Infos › « Périmètre contrôlé ») : les points d’une partie décochée sont masqués mais **conservés** (motif obligatoire s’ils contiennent des constats ; un écart ouvert sur ces points est annulé avec le même motif) et réapparaissent si la partie est recochée ; chaque changement est tracé (historique des stations, journal d’audit) et part vers l’autre tablette avec le fichier d’échange ;
- la synthèse, le PDF de la tournée (« Contrôlé à cette station : Biologie + Chimie » sur la feuille 1), le rapport d’audit détaillé et les exports indiquent le périmètre de chaque station ; une tournée d’un seul type (dont toutes les tournées existantes) est inchangée, sceau et PDF compris. L’audit interne de l’« OEG en régie » reste possible sur toute station, sans restriction aux listes des CCTP.

### Échelle de cotation unique : C / P / NC / N/A

| Cote | Signification | Observation |
|---|---|---|
| **C** | Conforme / satisfaisant | facultative |
| **P** | Perfectible | **obligatoire** |
| **NC** | Non conforme | **obligatoire** |
| **N/A** | Non applicable | facultative |

Cette échelle s’applique à toutes les feuilles (une colonne « P » s’ajoute, entre C et NC, aux tableaux des maquettes biologiques). Un nouvel appui sur la cote choisie l’annule.

### Les fiches d’évaluation « cours d’eau » et « eaux souterraines », sans doublon

Les fiches d’évaluation 2026 des Agences de l’eau / Aquascop (« Cours d’eau » et « Eaux souterraines ») ont été **fusionnées dans les feuilles thématiques existantes** : chaque point n’existe qu’**une fois**.

- Quand un point existait déjà dans une feuille des maquettes, le libellé de la maquette est conservé et le point est ajouté à son aide (« Inclut : … ») ;
- sinon, un critère est ajouté dans la feuille thématique, à la suite de la numérotation ;
- les points propres aux ouvrages d’eaux souterraines forment une feuille dédiée : **F10 « Eau souterraine – ouvrage, pompage et purge »** ;
- les points sans objet pour un type de tournée sont masqués automatiquement ;
- il n’y a pas de contre-mesures du contrôleur (pas de colonne « Aquascop ») : la cohérence des mesures du préleveur s’apprécie par des critères (« Regard critique sur les résultats des mesures », « Fiabilité apparente des mesures »).

Une **table de traçabilité** placée en tête du fichier [js/domain/grid-ct-2026.js](js/domain/grid-ct-2026.js) indique, pour chacun des 112 points des deux fiches (70 « cours d’eau », 42 « eaux souterraines »), le critère qui le couvre. Les tests automatiques vérifient qu’aucun point n’est oublié ni compté deux fois. Les fiches d’origine ne sont pas publiées dans ce dépôt (documents de tiers).

**Sans redondance (grille CT-2026 version 1.2, octobre 2026)** : un même constat n’est coté qu’à un seul endroit. Les critères voisins sont recadrés et se renvoient l’un à l’autre dans leur attendu (ex. le rinçage des flacons avec réactif n’est jugé qu’en F4.13 ; la stabilisation des mesures en F4.3 et une mesure manquante en F4.28, pas dans chaque paramètre) ; « Conformité équipe/CCTP » (F2.2.8) et « Fiabilité apparente des mesures » (F4.27) sont des **points de synthèse** : toujours cotés, mais marqués « hors note » ; la réserve de flacons (F4.14) et le transport des flacons vides (F4.16) sont jugés une seule fois pour la tournée ; les heures de F2 distinguent le **contrôle OEG** (1.5, 1.6) et la **tournée du prestataire** (5.2, 5.3). Chaque point des feuilles n’a plus qu’**un seul bouton ⓘ « Aide et attendu »** (attendu du prestataire, vérification, cotation, puis l’aide de la grille), et chaque zone de texte libre dit ce qu’elle attend. Les tablettes reçoivent cette version de la grille à la mise à jour de l’application ; les tournées déjà commencées ou signées gardent leur grille (leur sceau reste valide).

### Les feuilles par type de tournée

| N° | Onglet | Contenu | Renseignée | Hydrobiologie | Cours d’eau | Eaux souterraines |
|---|---|---|---|:---:|:---:|:---:|
| F1 | Station | Fiche station : carte, photos, accès, difficultés, compartiments à contrôler, repères terrain (date, heures d’arrivée et de départ, contrôleur, opérateurs, météo, niveau d’eau) | par station | ✓ | ✓ | ✓ ¹ |
| F2 | Organisation | Organisation, sécurité et déroulé de mission : identification de la mission, prestataires et équipe, locomotion, EPI, planning, documentation, traçabilité et expédition | **une fois par tournée** | ✓ | ✓ | ✓ |
| F3 | Caractérisation / Station et site | Prise d’informations de terrain, localisation et approche, observations environnementales, accès au site et rendez-vous (eaux souterraines) | par station | ✓ | ✓ | ✓ |
| F10 | Ouvrage et purge | Eau souterraine – ouvrage, pompage et purge ; niveau piézométrique | par station | — | — | ✓ |
| F4 | PC in situ / Mesures in situ | Physico-chimie, mesures in situ, étalonnage et flaconnage ; appareils de mesure et tableau d’étalonnage | par station ² | ✓ | ✓ | ✓ |
| F5 | PC prélèvement / Prélèvement | Prélèvement, conditionnement, chaîne du froid, identification et transmission des échantillons, matériel | par station ² | ✓ | ✓ | ✓ |
| F6 | Invertébrés | Invertébrés aquatiques – protocole PEZADA | par station | ✓ | — | — |
| F7 | Diatomées | Diatomées – IDGF | par station | ✓ | — | — |
| F8 | Poissons | Ichtyologie et mercure dans le biote | par station | ✓ | — | — |
| F9 | Phytoplancton | Phytoplancton d’eau douce | par station | ✓ | — | — |
| | | **Nombre de feuilles affichées pour une station** | | **9** | **5** | **6** |

¹ Variante « point d’eau » : code BSS, commune, libellé, nature, usage, aquifère ; pas de niveau d’eau.
² Certains points de F4 et F5 (sondes, étalonnage, flaconnage, glacières, stockage, matériel) sont **communs à la tournée** : ils apparaissent dans la fiche de chaque station avec le badge « Commun à la tournée », mais n’ont qu’une seule réponse.

En hydrobiologie, les feuilles F4 à F9 ne s’affichent que si le compartiment correspondant est retenu (cases pré-cochées selon la station). La mention « Feuille X / N » des fiches suit le rang parmi les feuilles affichées : une tournée biologique complète va de 1 à 9, comme les maquettes ; en eaux souterraines, F10 est la « Feuille 4 / 6 ».

---

## Fonctionnalités

- **Accueil « Stations »** : toutes les stations du référentiel (108 au référentiel OEG : 38 en biologie, 68 en cours d’eau, 17 en eaux souterraines ; une station peut relever de plusieurs types), **rangées par réseau** (choix « Ranger : par réseau | par statut », par réseau d’office) : une section par réseau de surveillance (BIO 38, Chimie 15, RCO 25, EL 29, ESO 17) ; les 16 stations sur deux réseaux (15 BIO + Chimie, et Mataroni RCO + EL) figurent dans chacune avec la mention « Aussi : … », mais le total « n stations affichées » et les effectifs des filtres comptent les stations distinctes (108, pas 124). Filtres par type de tournée, par réseau (Tous / BIO / Chimie / RCO / EL / ESO), bassin et statut de contrôle (à contrôler / tournée en cours / contrôlée dans l’année), recherche instantanée (nom, code, bassin, commune, réseau : les sections vides se masquent), tournées en cours à reprendre, bouton « Nouvelle tournée » et carte des stations. Le type, le réseau et le rangement choisis sont **mémorisés pour chaque agent** : sur une tablette partagée, l’agent suivant (« Changer d’agent ») retrouve ses propres réglages ; « Effacer les filtres » remet tout à zéro.
- **Réseaux de surveillance** (Référentiels › « Réseaux de surveillance ») : un réseau par marché OEG 2026 — BIO (biologie, 38 stations), Chimie (15), RCO (réseau de contrôle opérationnel, 25), EL (eaux littorales, 29), ESO (eaux souterraines, 17) ; **une station peut appartenir à plusieurs réseaux** (16 stations sur deux réseaux). Libellé, description, couleur, ordre d’affichage et types de tournée associés se modifient dans le référentiel ; le code ne change pas (il est enregistré sur les stations et les campagnes) et un réseau utilisé ne peut pas être supprimé. Les réseaux d’une station se cochent dans sa fiche (« Modifier la station ») ; un import de stations reconnaît les codes et les libellés sans tenir compte des majuscules ni des accents, et cumule les réseaux d’une station listée sur plusieurs lignes. Les réseaux apparaissent partout où l’on choisit ou décrit une station : carte (filtre et info-bulle « Réseaux : BIO, Chimie »), création de tournée (filtre des stations proposées), fiche station et feuille 1 (pastilles sous « Station », à l’écran et en PDF), planning (filtre « Réseau » dans les filtres, réseau du programme de chaque prestation), rapport d’audit, exports (« Stations et réseaux de surveillance » : une ligne par station, et une ligne par station et par réseau), tableau de bord (« Stations contrôlées par réseau »), prestataires (sites d’intervention par réseau).
- **Fiche station** fidèle à la maquette : localisation cartographique (station, points de prélèvement et, pendant une tournée, relevés GPS), photographies rive droite / rive gauche / amont / aval, accès, difficultés, compartiments à contrôler, prestations programmées et historique des tournées. Boutons « Démarrer une tournée », « Fiches vierges (PDF) », « Fiche station (PDF) », « Modifier la station ». Station BIO + Chimie : variante **« Biologie + Chimie »** (fiches vierges d’une tournée mixte : feuilles communes une fois, feuilles biologiques en plus).
- **Création de tournée** en sept étapes : type de tournée, prestataire contrôlé, date et modalité (inopiné ou avec rendez-vous), contrôleurs OEG de la tournée (binôme), stations dans l’ordre de passage (recherche, prestations programmées mises en avant, « Station la plus proche » par GPS ; station BIO + Chimie : cases « Biologie » / « Chimie » de ce qui y est réellement contrôlé, voir [Une station sur deux réseaux](#une-station-sur-deux-réseaux--on-contrôle-ce-qui-est-réellement-fait)), compartiments à contrôler, préleveurs du prestataire.
- **Préleveurs du prestataire** (opérateurs contrôlés) : à la création de la tournée (étape 7) et sur la feuille **Organisation** de la tournée, cochez les préleveurs présents ; un préleveur absent de la liste s’ajoute avec **« ＋ Ajouter un opérateur »** (nom, prénom, initiales, fonction), sans passer par les référentiels et par tout agent qui réalise des tournées. Il est rattaché au prestataire contrôlé et coché aussitôt ; **jamais de doublon** : un opérateur connu seulement par ses initiales (« NB ») est complété, une personne déjà enregistrée est reprise, et des initiales déjà prises chez ce prestataire font proposer l’opérateur existant. L’ajout est tracé au journal d’audit et part vers l’autre tablette avec le prochain fichier.
- **Tablette partagée et tournée en binôme** : plusieurs agents sur une même tablette (« Qui utilise la tablette ? », bouton « Changer d’agent »), même profil sur toutes les tablettes ; une tournée a un ou plusieurs contrôleurs OEG, chacun peut y saisir (chaque saisie reste attribuée à son auteur) et la signer ; un collègue peut « Rejoindre la tournée ». Voir [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents).
- **Saisie en feuilles** adaptée à la tablette (grands tableaux fidèles aux fiches papier, à partir de 1 100 px de large) et au téléphone (une carte par point de contrôle, quatre gros boutons C / P / NC / N/A). Chaque saisie est enregistrée immédiatement sur l’appareil.
- **Remplissage automatique des informations redondantes** : une information demandée sur plusieurs feuilles se saisit **une fois**. Saisie sur une feuille, elle est **reprise** dans les champs équivalents encore vides des autres feuilles, de la tournée et de chaque station, avec la marque **« repris de F2.1.9 »** (info-bulle : la feuille et le point d’origine) : date de la tournée (« Date mission » → « Jour », « Date » de chaque station, « Date des prélèvements »), contrôleurs OEG, météo de la journée (→ « Météo » de chaque station → « Conditions météo » de la feuille 3), niveau d’eau, préleveurs cochés sur la feuille Organisation (→ « Opérateurs » de chaque station → membres de l’équipe, préleveurs et agents des feuilles 3, 4, 6 à 9, encadré « Agent(s) prestataire(s) / fonction » de la feuille 4, « Identification des prestataires »), informations de la fiche station (bassin, cours d’eau, nom, codes SANDRE / BSS, rang de Strahler, pressions, commune, hydro-écorégion : « repris de la fiche station », mises à jour dans les tournées en cours quand la fiche de la station est corrigée). **Une valeur saisie ou modifiée par l’agent n’est jamais remplacée** (ni une valeur reprise que l’agent a déjà cotée) : la nouvelle valeur lui est seulement **proposée** (« Proposé (F2.1.9) : Orage », appliquée d’un appui) ; une source vidée retire les valeurs qu’elle avait remplies. Dès qu’il y a une part d’appréciation, l’application **propose sans jamais écrire** : heures de la tournée du prestataire, coordonnées des points biologiques, température de conservation, moyens d’accès des stations (un bouton par moyen quand les stations en ont plusieurs), difficultés d’accès, supports audités (d’après les compartiments), lot / marché (référence du marché de la prestation), effectif (nombre de préleveurs), sondes utilisées et calibration des sondes (d’après « Appareils de mesure » de la feuille 4). Chaque reprise est attribuée à l’agent connecté ; rien ne change sur une tournée signée et verrouillée ni sur une tournée annulée ; à la réception du fichier de l’autre tablette, les valeurs reçues sont gardées telles quelles (une saisie et une reprise concurrentes ne se mélangent jamais : la plus récente est retenue entière, l’autre reste dans les conflits) et un champ resté vide se voit seulement proposer la valeur. L’onglet Infos, le rapport et les exports donnent comme **heure de début / de fin** celles de « Début / Fin du contrôle » (feuille Organisation) quand elles sont renseignées.
- **« Reprendre les réponses de la station précédente »** (feuilles d’une station suivante, tournée à plusieurs stations) : après confirmation, les points **encore vides** de la feuille reçoivent la cote et l’observation du même point de la station précédente, marqués « repris de la station 1 » et modifiables ; mesures, coordonnées et informations propres à la station ne sont jamais reprises.
- **Photos** : partout où une photo s’ajoute (points de contrôle, encadrés « Prise de photos », photographies RD / RG / AM / AV de la fiche station, observations, écarts), deux boutons distincts : **« Prendre une photo »** (appareil photo de la tablette) et **« Importer depuis la galerie »** (photos déjà dans l’appareil, plusieurs à la fois), plus « Joindre un document » (PDF…) quand c’est utile ; dans les tableaux des feuilles (tablette en paysage), le bouton « Ajouter une preuve » de chaque ligne ouvre ces trois choix. Une photo importée garde **sa date de prise de vue** (métadonnées EXIF) ; à défaut, la date d’import est retenue et signalée (message et visionneuse). Photos compressées, géolocalisées si possible (position enregistrée par l’appareil photo, sinon celle de la tablette, signalée pour une photo importée), rattachées au point de contrôle. Aussi : saisie vocale (si le navigateur la propose), lecture de QR codes.
- **GPS en RGFG95** : le bouton « Relever la position » remplit les coordonnées X / Y (RGFG95 / UTM 22N) ; l’application compare la position aux coordonnées théoriques de la station.
- **Coordonnées en UTM 22N ou UTM 21N** : partout où l’on saisit des X / Y (coordonnées des feuilles — points de prélèvement, amont / aval, géoréférencement —, « Modifier la station » et ses points de prélèvement), une liste **« Système »** propose **« UTM 22N (RGFG95) »** (par défaut) ou **« UTM 21N »** (ouest guyanais). En UTM 21N, les X / Y saisis sont **convertis automatiquement en RGFG95 / UTM 22N** (« → RGFG95 / UTM 22N : X 167202 · Y 619395 ») : c’est la valeur 22N qui est enregistrée et utilisée partout (alertes d’éloignement, cartes, fiches et PDF, rapports, exports), la saisie d’origine (fuseau, X, Y) est conservée et affichée pour la traçabilité (« saisi en UTM 21N : X 831991 · Y 619391 », aussi dans les PDF). Changer de système garde la position du point. Le bouton GPS de la tablette donne directement l’UTM 22N. **Alertes** : des X / Y d’UTM 21N laissés en « UTM 22N » sont signalés (« Choisissez « UTM 21N » pour les convertir ») et un point hors de la Guyane (fuseau, X et Y inversés, faute de frappe, GPS non calé) est signalé ; la fiche d’une station refuse ces deux cas. Un import de stations reconnaît une colonne « Fuseau UTM » (« 21N », « UTM 21 », « EPSG:3313 »…) et, à défaut, le fuseau d’après X (les deux fuseaux ne se recouvrent pas en Guyane). La conversion suppose le RGFG95 (≈ WGS84) dans les deux fuseaux : des coordonnées d’anciennes cartes en CSG67 seraient décalées d’environ 115 m.
- **Alertes** (écart de position GPS, température de conservation hors plage, calibration ancienne…) : elles **ne créent jamais de non-conformité automatiquement** ; le contrôleur choisit « Créer un écart » ou « Ne pas retenir ».
- **Écarts et actions** : un écart naît d’une décision du contrôleur, depuis un point perfectible (criticité proposée : Observation) ou non conforme (criticité proposée : Écart mineur) ; registre des écarts, échéances, actions correctives et clôture.
- **Note sur 20** (règles validées par l’OEG le 23/10/2026) : chaque feuille, chaque station et la tournée reçoivent une note sur 20 — **C = 1 point, P = 0,5, NC = 0, N/A non compté** ; les **26 points majeurs** (badge « Majeur (×2) » sur la feuille et dans la fiche des attendus : localisation de la station, purge, étalonnage des sondes, flaconnage et réactifs, stabilisation, sources de contamination, conservation, remplissage, renouvellement, filtration, étiquetage, protocoles d’échantillonnage biologiques — invertébrés, diatomées, poissons, phytoplancton —, port des EPI) **comptent double** ; les points de synthèse (F2.2.8, F4.27) restent cotés mais **hors note**. Note = points obtenus ÷ points évalués × 20, au dixième ; aucun point évalué : « non noté ». Appréciation : **16 et plus « Satisfaisant »**, de 12 à moins de 16 « À améliorer », moins de 12 « Insuffisant » ; ces seuils se règlent dans **Administration › « Note sur 20 »** (administrateur). On la trouve dans l’encadré **« Grille de notation »** en pied de chaque feuille (écran et PDF : C, P, NC, N/A, points évalués, points, note, appréciation en couleur), dans la synthèse (note de la tournée, colonne « Note /20 » par station et par feuille), la **liste « Audits »** (badge « 17,7 / 20 · Satisfaisant » aux couleurs de l’appréciation sur chaque tournée — note définitive d’une tournée signée, note **provisoire** en gris d’une tournée en cours ou à signer, rien pour une tournée annulée — et « Trier : Date | Note décroissante | Note croissante »), les **cartes des stations de l’accueil** (note de la dernière tournée signée contenant la station, à côté de « Dernière tournée » : note de la station dans cette tournée, à défaut celle de la tournée), le PDF des fiches, le rapport détaillé, le **tableau de bord** (moyennes des tournées signées par prestataire et par réseau) et les **exports** Excel / CSV (colonnes de notes, feuille « Notes »). Un point commun à la tournée, comme une opération mutualisée d’une station contrôlée pour la biologie et la chimie, n’est compté qu’une fois dans la note de la tournée. **À la signature du contrôleur, la note et les seuils sont figés dans la tournée** (couverts par l’empreinte de la signature) : changer les seuils ensuite ne modifie pas une tournée signée ; une tournée signée avant la mise en place de la notation affiche sa note avec la mention « calculée ». La note résume les cotes, elle ne remplace jamais la conclusion du contrôleur.
- **Synthèse** : note de la tournée, décomptes C / P / NC / N/A / non renseignés pour la tournée, par station et par feuille, conclusions des feuilles (choix du contrôleur), commentaire et bilan de l’auditeur, autres préconisations. Un point commun à la tournée n’est compté qu’une fois, de même qu’une opération mutualisée d’une station contrôlée pour la biologie et la chimie.
- **Signatures et verrouillage scellé** : contrôle avant clôture, signature du contrôleur OEG (n’importe quel contrôleur de la tournée) et du représentant du prestataire (ou refus / absence motivé), puis « Valider et verrouiller l’audit » : le contenu est scellé par une empreinte SHA-256 ; ensuite, seule une modification motivée et tracée est possible (profils Administrateur et Responsable qualité).
- **PDF** : fiches de contrôle de la tournée remplies (« Fiches de contrôle (PDF) », filigrane « PROVISOIRE » tant que l’audit n’est pas verrouillé), rapport d’audit détaillé, dossier de preuve (JSON + médias), fiches vierges imprimables par station et par type de tournée, fiche station seule.
- **Attendus des prestataires** (menu Gestion › « Attendus des prestataires », bouton ⓘ « Aide et attendu » sur chaque point des feuilles, lien depuis la fiche station) : pour chacun des 212 points de la grille, ce que le prestataire doit faire ou présenter, comment le contrôleur le vérifie et des exemples de cotation C / P / NC / N/A, avec les références normatives, les **points majeurs** de la note sur 20 et la règle de notation ; filtres par type de tournée et par feuille, recherche ; PDF « Fiche des attendus » et « Liste de préparation » à remettre aux prestataires. Les exigences propres au marché (nombres, délais, matériel) sont marquées « À préciser (OEG) ».
- **Annuler une tournée** : bouton **« Annuler la tournée »** dans l’en-tête de la tournée et dans l’onglet Infos, pour **tout contrôleur de la tournée** (binôme compris) et pour le responsable qualité ou l’administrateur ; motif obligatoire (la fenêtre ne se ferme pas par un appui à côté, pour fermer le clavier) ; les écarts encore ouverts de la tournée sont annoncés puis annulés avec le même motif. Message **« Tournée AUD-… annulée »** et retour à l’accueil ; la tournée n’apparaît plus dans les tournées en cours ni dans la liste des audits (filtre **« Annulées »** pour la retrouver, avec la date, l’auteur et le motif) ; ses saisies sont conservées et ses prestations redeviennent à contrôler. Une tournée signée et verrouillée ne s’annule pas (l’application l’explique ; le responsable qualité peut la modifier avec un motif).
- **Logo de l’application** (Administration › « Logo de l’application », administrateur) : choisissez une image (PNG, JPEG, WebP ou SVG, 2 Mo au plus ; aperçu avant validation, proportions conservées, sans recadrage) ; elle remplace le logo de l’OEG dans l’en-tête, les écrans de connexion, l’accueil, les feuilles à l’écran et imprimées et **tous les PDF** (fiches de tournée, fiches vierges, fiche station, rapport, attendus). Elle est enregistrée chiffrée sur la tablette et part vers l’autre tablette avec le prochain fichier d’échange ; « Rétablir le logo OEG » revient au logo d’origine. **L’icône de l’application installée sur la tablette (écran d’accueil) ne change pas.**
- **Hors connexion** : toute l’application est mise en cache à la première ouverture ; le fond de carte peut être préchargé (écran Carte › « Précharger la zone affichée »).
- **Chiffrement local** : toutes les données (y compris photos et signatures) sont chiffrées sur l’appareil (AES-GCM 256 bits), déverrouillées par le mot de passe de chaque agent de la tablette ; verrouillage automatique après 30 minutes d’inactivité (réglable).
- **Journal d’audit** : qui a fait quoi, quand, sur quel appareil, avec l’ancienne valeur et le motif ; entrées chaînées par empreintes, bouton « Vérifier l’intégrité ».
- **Échanges entre tablettes par fichier**, sans réseau, sans serveur et sans compte GitHub : « Envoyer à l’autre tablette » produit un fichier unique chiffré (`OEG-echange_….oegct`) à faire passer par Quick Share, Bluetooth, e-mail, Teams ou clé USB ; « Recevoir un fichier » le fusionne automatiquement, champ par champ, en gardant les conflits consultables.
- Et aussi : planning des prestations (liste ou calendrier, import Excel / CSV / ICS), carte des stations, tableau de bord, historique et comparaison de tournées, observations simples et bouton « Urgence », exports Excel / CSV / ICS, gestion documentaire, bibliothèque de grilles, référentiels, mode « plein soleil » (contraste renforcé).

---

## Utiliser l’application

### Mise en service d’une tablette

1. Ouvrez <https://csre-dce.github.io/fiche-de-contr-le/> **avec une connexion** (Chrome ou Edge sur Android / Windows, Safari sur iPad / iPhone) et installez l’application sur l’écran d’accueil ([Installer l’application](#installer-lapplication-sur-une-tablette-ou-un-téléphone)). La navigation privée est à éviter : le navigateur y efface les données.
2. L’écran **« Mise en service de la tablette »** propose **deux choix** :
   - **« Première tablette de l’équipe »** : pour la toute première tablette ; l’administrateur y crée son compte et le mot de passe d’échange de l’équipe, puis ajoute les agents ;
   - **« Tablette supplémentaire : recevoir le fichier de l’autre tablette »** : pour toute autre tablette ; elle reçoit tout de la première, profils des agents compris (**aucun profil en double**), et chaque agent s’y ajoute avec son propre mot de passe.

   Le pas à pas complet est dans [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents). L’option avancée repliée en bas de l’écran (mode équipe GitHub) ne sert pas à l’OEG : ne l’ouvrez pas.

Les données restent **chiffrées sur la tablette** ; chaque agent y a son compte et son mot de passe. Les données de démonstration fictives (case à laisser décochée pour un usage réel) se retirent aussi plus tard : Administration › Données et stockage › « Retirer les données de démonstration ».

### Déroulé d’une tournée

1. **Avant de partir** : ouvrez l’application et la session ; si l’autre tablette a travaillé depuis le dernier échange, recevez son fichier (« Recevoir un fichier ») ; préchargez le fond de carte de la zone (menu Carte › « Précharger la zone affichée ») ; imprimez si besoin les fiches vierges de secours (fiche station › « Fiches vierges (PDF) »).
2. **Créer la tournée** : accueil **Stations › « Nouvelle tournée »** (ou, depuis une fiche station, « Démarrer une tournée » ; ou, depuis le Planning, cochez des prestations puis « Démarrer une tournée »). Remplissez les sept étapes :
   1. Type de tournée (Biologie, Cours d’eau, Eaux souterraines) ;
   2. Prestataire contrôlé ;
   3. Date et modalité (« Inopiné » ou « Avec rendez-vous ») ;
   4. Contrôleurs OEG de la tournée : vous êtes coché d’office ; cochez le ou les collègues qui contrôlent avec vous (binôme) ;
   5. Stations de la tournée, dans l’ordre de passage (▲ ▼ pour réordonner) ; pour une station BIO + Chimie, cochez ce qui y est **réellement contrôlé** (« Biologie », « Chimie » ou les deux : même prestataire = une seule tournée, opérations communes saisies une fois) ;
   6. Compartiments à contrôler (biologie : pré-cochés selon les stations) ;
   7. Préleveurs du prestataire : cochez ceux qui sont présents ; « ＋ Ajouter un opérateur » pour un préleveur absent de la liste (nom, prénom, initiales, fonction) ;

   puis **« Démarrer la tournée »**. Les informations connues (station, codes, bassin, date, heure, contrôleurs — « Agent(s) OEG » et « Contrôleur OEG » reçoivent les noms de tous les contrôleurs, par exemple « A. Dupont, B. Martin » —, prestataire, opérateurs…) sont pré-remplies.
3. **Saisir sur le terrain** :
   - en haut, le **sélecteur de stations** (pastilles numérotées avec l’avancement, « Ajouter une station », retrait motivé) ;
   - les **onglets** : la feuille « Organisation » (commune à la tournée) d’abord, puis les feuilles de la station affichée, puis Écarts, Synthèse, Signatures et Infos ;
   - pour chaque point : la valeur ou réponse, la cote **C / P / NC / N/A**, l’observation (obligatoire pour P et NC), et les outils (« Prendre une photo », « Importer depuis la galerie », relevé GPS, création d’un écart, aide) ;
   - la feuille **Organisation** liste aussi les **préleveurs du prestataire** de la tournée (à cocher, « ＋ Ajouter un opérateur ») ;
   - les encadrés de chaque feuille : observations, notes, photos, conclusion ou bilan (cases à cocher par le contrôleur ; l’application peut suggérer, jamais décider) ;
   - une information déjà saisie ailleurs (date, météo, niveau d’eau, contrôleurs, préleveurs, informations de la station) arrive toute seule, marquée « repris de … » : vérifiez-la sur place, modifiez-la si besoin (votre saisie n’est plus jamais remplacée) ; un bouton « Proposé (…) : … » applique d’un appui une valeur proposée ; sur la feuille d’une station suivante, « Reprendre les réponses de la station précédente » complète les points encore vides.
4. **Écarts** : depuis un point P ou NC, ou depuis une alerte, « Créer un écart » ; le suivi se fait ensuite dans le menu **Écarts**.
5. **Synthèse** : note sur 20 de la tournée (provisoire jusqu’à la signature), décomptes et notes par station et par feuille ; saisissez le « Commentaire et bilan de l’auditeur » et les « Autres préconisations ».
6. **Signatures** : vérifiez le « Contrôle avant clôture », cliquez sur « Terminer l’audit (heure de fin) », « Signer en tant que contrôleur » (n’importe quel contrôleur de la tournée ; la note sur 20 et les seuils sont alors figés dans la tournée), puis « Faire signer le représentant » (ou « Refus / absence de signature »), enfin **« Valider et verrouiller l’audit »**. Les boutons « Fiches de contrôle (PDF) », « Rapport d’audit détaillé (PDF) » et « Dossier de preuve (JSON + médias) » produisent les documents.
7. **Interrompre** : onglet « Infos » › « Continuer plus tard ». La tournée se reprend depuis l’accueil (« Tournées en cours sur cette tablette ») ou la fiche station. Sur une tablette partagée, « Changer d’agent » (en-tête) laisse la tournée sur la tablette pour le collègue.
8. **Annuler la tournée** (crue, accès impossible, prélèvement reporté…) : bouton **« Annuler la tournée »** de l’en-tête de la tournée ou de l’onglet Infos, motif obligatoire, puis « Annuler la tournée ». Le message « Tournée AUD-… annulée » s’affiche et l’application revient à l’accueil : la tournée a disparu des tournées en cours et de la liste des audits (elle reste consultable sous **Audits › « Annulées »**). **Il n’y a rien à réinitialiser** : surtout pas « Effacer les données de cette tablette » (Administration › Zone sensible), qui ferait perdre tout ce qui n’a pas été envoyé à l’autre tablette. Un agent du binôme qui ne voit pas le bouton doit d’abord « Rejoindre la tournée ». Une tournée signée et verrouillée ne s’annule plus.

La barre de navigation donne accès aux autres écrans : Stations, Planning, Audits (dont la vue « Historique et comparaison », puce de l’écran Audits), Écarts, Observations, Carte, Tableau de bord, Prestataires, Documents, Grilles d’audit, Référentiels, Import, Export, Échanges entre tablettes, Journal d’audit, Administration et Mon compte (changement de mot de passe, « Rechercher une mise à jour », mode « plein soleil »). Le bouton **« Changer d’agent »** de l’en-tête (icône seule sur téléphone ; aussi dans Menu) enregistre la saisie en cours et revient à l’écran « Qui utilise la tablette ? ».

---

## Deux tablettes pour quatre agents

L’OEG dispose de **deux tablettes pour quatre agents**. Chaque agent a **sa propre session** : un compte à son nom (**le même profil sur les deux tablettes**) et **son mot de passe** sur chaque tablette où il travaille. Les tablettes ne passent ni par GitHub ni par un serveur : elles s’échangent leurs données **par fichier** (« Envoyer à l’autre tablette » sur l’une, « Recevoir un fichier » sur l’autre), même sans connexion. **Aucun agent n’a besoin de compte GitHub.**

Deux sortes de mots de passe, à ne pas confondre :

| Mot de passe | Qui le choisit ? | Où ? | À quoi sert-il ? |
|---|---|---|---|
| **Mot de passe de l’agent** (8 caractères minimum) | chaque agent, pour lui seul | sur chaque tablette où il travaille (il peut être le même sur les deux) | ouvrir **sa** session ; il ne se communique à personne |
| **Mot de passe d’échange de l’équipe** (10 caractères minimum) | un administrateur | le **même sur toutes les tablettes**, saisi une seule fois sur chacune | chiffrer les fichiers échangés entre les tablettes ; ensuite, envoyer et recevoir ne le demandent plus |

### Avant de commencer

- Désignez **l’administrateur** qui met les tablettes en service et, de préférence, **un second administrateur** : un mot de passe d’agent oublié ne peut être redonné que par un administrateur.
- Choisissez le **mot de passe d’échange de l’équipe** (10 caractères minimum, différent des mots de passe des agents) et notez-le en lieu sûr.
- Sur chaque tablette, laissez la **date et l’heure réglées automatiquement** (paramètres de la tablette) : en cas de conflit entre les deux tablettes, la valeur la plus récente est retenue.
- Une connexion n’est nécessaire que pour la première ouverture de l’application sur chaque tablette (installation) ; ensuite, tout fonctionne hors connexion.

### Mise en service de la tablette 1 (administrateur)

1. Ouvrez <https://csre-dce.github.io/fiche-de-contr-le/> **avec une connexion** et installez l’application ([Installer l’application](#installer-lapplication-sur-une-tablette-ou-un-téléphone)).
2. Écran **« Mise en service de la tablette »** › **« Première tablette de l’équipe »**.
3. Renseignez :
   - **Organisme** (Office de l’Eau de Guyane), **Nom de la tablette** (« Tablette 1 ») et **N° de la tablette** : **1** (un numéro différent par tablette, pour des numéros d’audit uniques) ;
   - **votre compte** d’administrateur : nom et prénom (les initiales et l’identifiant sont proposés, par exemple `adupont`), puis votre mot de passe, deux fois ;
   - le **mot de passe d’échange de l’équipe**, deux fois ;
   - laissez **cochée** « Reprendre le référentiel des fiches terrain OEG » et **décochée** « Ajouter des données de démonstration fictives ».
4. Touchez **« Créer et ouvrir la session »**.
5. **Ajoutez les agents, chacun en sa présence** : Administration › Agents de cette tablette › **« ＋ Ajouter un agent »** : nom et prénom (initiales et identifiant proposés, par exemple `bmartin`), **profil** (« Auditeur » en général, « Administrateur » pour le second administrateur). **L’agent choisit et saisit lui-même son mot de passe**, deux fois, puis « Ajouter l’agent ». Recommencez pour chacun des quatre agents (si l’administrateur en fait partie, il a déjà son compte).
6. Vérifiez : bouton **« Changer d’agent »**, puis chaque agent touche son nom et ouvre sa session une fois.

> **Mot de passe oublié** : il ne peut pas être récupéré, mais un administrateur en fait choisir un nouveau à l’agent (Administration › Agents de cette tablette › « Modifier » › « Nouveau mot de passe sur cette tablette », saisi par l’agent). D’où l’intérêt d’un second administrateur.

| Profil | Peut notamment |
|---|---|
| Administrateur | tout, y compris les agents, la tablette et les paramètres |
| Responsable qualité | référentiels, documents et grilles ; modifier un audit signé (avec motif) ; annuler une tournée non signée |
| Superviseur | modifier les audits des autres, clôturer les écarts, planning, journal d’audit |
| Auditeur | créer et réaliser ses tournées (et les annuler, s’il en est contrôleur), écarts, observations, ajout d’un opérateur du prestataire |
| Consultation | consulter et exporter |

### Mise en service de la tablette 2

Une fois les quatre agents créés sur la tablette 1 :

1. **Sur la tablette 1** : Échanges entre tablettes › **« Tout envoyer »**, puis « Partager » (Quick Share, Bluetooth…) ou « Enregistrer le fichier » (clé USB, e-mail) : voir [Faire passer le fichier](#faire-passer-le-fichier-dune-tablette-à-lautre).
2. **Sur la tablette 2** : ouvrez l’adresse de l’application **avec une connexion**, installez-la, puis « Mise en service de la tablette » › **« Tablette supplémentaire : recevoir le fichier de l’autre tablette »**.
3. **« Choisir le fichier »** (le fichier `OEG-echange_Tablette-1_….oegct`, en général dans Téléchargements), saisissez le **mot de passe d’échange de l’équipe**, puis **« Ouvrir le fichier »** : un aperçu affiche la tablette d’origine, la date, les agents et les tournées. Avec un mauvais mot de passe, le fichier est refusé et rien n’est créé.
4. **Nom** (« Tablette 2 ») et **n°** de la tablette : un numéro libre est proposé (2), jamais celui de la tablette 1.
5. **« Qui êtes-vous ? »** : l’administrateur touche **son** nom parmi les agents reçus, choisit son mot de passe pour cette tablette (deux fois ; il peut être le même que sur la tablette 1), puis **« Mettre en service la tablette »**. Il garde **le même profil** : ses tournées et ses saisies restent les siennes, sans doublon.
6. **Chaque autre agent s’ajoute avec son propre mot de passe** : l’administrateur ouvre Administration › **« Agents pas encore sur cette tablette »** › **« Ajouter sur cette tablette »** en face du nom de l’agent ; l’agent saisit lui-même, deux fois, le mot de passe qu’il utilisera sur cette tablette. Recommencez pour chaque agent.
7. Vérifiez : « Changer d’agent », puis chaque agent ouvre sa session une fois.

Si la tablette 2 a été mise en service par un agent qui n’est pas administrateur, l’Administration affiche d’abord **« Aucun administrateur sur cette tablette »** : un administrateur s’y ajoute lui-même (« Ajouter sur cette tablette »), puis ajoute les autres agents.

**Plus tard** : un agent créé sur une tablette arrive sur l’autre avec le fichier suivant ; il apparaît alors dans « Agents pas encore sur cette tablette ». Un agent qui ne voit pas son nom à l’écran « Qui utilise la tablette ? » demande à un administrateur de l’ajouter. **« Retirer de cette tablette »** supprime seulement son accès à cette tablette (son profil, ses tournées et ses saisies restent ; l’agent connecté et le dernier administrateur ne peuvent pas être retirés). Pour **bloquer un agent sur les deux tablettes** : « Modifier » › décocher « Compte actif » ; sur l’autre tablette, le blocage s’applique dès la réception d’un fichier envoyé par un administrateur, sinon après validation dans l’Administration.

### Au quotidien

1. **Le matin** : si l’autre tablette a envoyé un fichier depuis la veille, **« Recevoir un fichier »** (bouton de l’accueil).
2. **Ouvrir sa session** : l’écran **« Qui utilise la tablette ? »** affiche les agents de la tablette avec leurs initiales ; touchez votre nom, saisissez votre mot de passe.
3. **Tournée en binôme** : « Nouvelle tournée » › étape **« Contrôleurs OEG de la tournée »** : vous êtes coché d’office ; cochez votre binôme. « Agent(s) OEG » et « Contrôleur OEG » sont pré-remplis avec vos deux noms (« A. Dupont, B. Martin »).
4. **Passer la tablette au collègue** : bouton **« Changer d’agent »** (en-tête ; sur téléphone, icône ou Menu). La saisie est enregistrée et **la tournée reste sur la tablette** ; le collègue ouvre sa session et arrive sur la tournée (sinon sur l’accueil, « Tournées en cours sur cette tablette »). **Chaque saisie reste attribuée à l’agent connecté** (« Saisi le … par … » sous chaque point ; onglet **Infos**, « Qui a saisi quoi »).
5. **Rejoindre la tournée** : un agent qui ne fait pas partie des contrôleurs voit la tournée en lecture seule, avec le bandeau « Tournée de … — **Rejoindre la tournée** » ; en le touchant, il devient contrôleur (tracé au journal) et peut saisir. Un contrôleur peut aussi en ajouter ou en retirer un autre (onglet Infos ; retrait avec motif, jamais le dernier).
6. **Signer** : n’importe quel contrôleur de la tournée signe « en tant que contrôleur » ; le PDF et le rapport détaillé indiquent **tous les contrôleurs**.
7. **Envoyer à l’autre tablette** : **en fin de journée** (l’accueil affiche « Fin de journée : n modifications à envoyer à l’autre tablette ») et **toujours avant de continuer une tournée sur l’autre tablette** : bouton **« Envoyer à l’autre tablette »** (accueil ou écran Échanges entre tablettes), puis faites passer le fichier.
8. **Recevoir** : sur l’autre tablette, **« Recevoir un fichier »**, choisissez le fichier, vérifiez l’aperçu, puis **« Recevoir et fusionner »** : un compte rendu indique ce qui a changé (« 1 tournée mise à jour, 1 nouvel agent à ajouter sur cette tablette… »).

**Une tournée se saisit sur une seule tablette à la fois** : pour la continuer sur l’autre, envoyez d’abord, recevez ensuite. Chaque agent garde **son** mot de passe pour lui et touche « Changer d’agent » avant de passer la tablette : chaque saisie reste ainsi attribuée à la bonne personne. Avant « Changer d’agent », l’écran « Qui utilise la tablette ? » rappelle les modifications pas encore envoyées (sans bloquer).

### Faire passer le fichier d’une tablette à l’autre

« Envoyer à l’autre tablette » prépare **un fichier unique**, `OEG-echange_<tablette>_<AAAA-MM-JJ_HHhMM>.oegct`, **toujours chiffré** avec le mot de passe d’échange, et affiche son contenu et sa taille. Ensuite, au choix :

- **Quick Share ou Bluetooth** (tablettes côte à côte) : **« Partager »** › Quick Share (ou Bluetooth) › l’autre tablette, qui accepte le fichier : il arrive dans Téléchargements ;
- **E-mail ou Teams** : **« Partager »** › Gmail, Outlook ou Teams, vers votre propre adresse ou celle du collègue ; sur l’autre tablette, ouvrez le message et téléchargez la pièce jointe ;
- **Clé USB ou ordinateur** : **« Enregistrer le fichier »** (dossier Téléchargements), puis copiez-le.

Sur certaines tablettes Android, le fichier est partagé sous le nom `….oegct.txt` : c’est normal, « Recevoir un fichier » l’accepte. Sans le mot de passe d’échange, le fichier est illisible : ne mettez **jamais** ce mot de passe dans le message qui transporte le fichier.

- **Contenu** : par défaut, **les modifications depuis le dernier envoi** (tournées, réponses, écarts, signatures, photos et documents pas encore envoyés, profils des agents — jamais de mot de passe —, journal d’audit, référentiels dont les opérateurs ajoutés sur le terrain, logo de l’application, suppressions et annulations). **« Tout envoyer »** produit un fichier complet : fichier perdu, nouvelle tablette.
- Le fichier n’est noté « envoyé » qu’**une fois partagé ou enregistré** ; un partage annulé ne compte pas.
- **Gros fichier** (au-delà d’environ 20 Mo, beaucoup de photos) : un e-mail risque de le refuser ; l’application propose d’envoyer sans les photos (elles partiront au prochain envoi). Préférez alors Quick Share, Bluetooth ou une clé USB.
- **À la réception**, rien n’est modifié avant votre confirmation : l’application déchiffre le fichier, vérifie son **empreinte d’intégrité** (un fichier abîmé ou modifié est refusé) et affiche un **aperçu** (tablette d’origine, date, agent qui l’a envoyé, agents, tournées, nombre d’éléments et de photos).
- **Fusion automatique, hors connexion** : une donnée modifiée sur une seule tablette prend la nouvelle valeur ; en binôme, les saisies faites sur les deux tablettes se rejoignent, **chacune attribuée à son auteur**. **Recevoir deux fois le même fichier ne change rien** ; un **fichier ancien n’écrase jamais** une saisie plus récente. Une tournée **signée** reste scellée, avec la même empreinte sur les deux tablettes.
- **Historique** : Échanges entre tablettes › « Historique des échanges » (date, sens, tablette, agent, contenu) ; chaque envoi et chaque réception sont aussi tracés au journal d’audit.
- Les anciens paquets de données (`donnees_audit_….json`, écran Export) sont acceptés par « Recevoir un fichier ».

### Conflits

Un **conflit** survient quand **la même valeur** (par exemple la cote d’un même point) a été modifiée **sur les deux tablettes** entre deux échanges. À la réception :

- la valeur **la plus récente est retenue** (d’où l’intérêt de tablettes à l’heure) et l’autre est **conservée** ; le compte rendu indique « n conflits à examiner » ;
- **Échanges entre tablettes › Conflits › « Examiner »** affiche, pour chaque valeur, celle de cette tablette, celle reçue et celle retenue ; **« Restaurer l’autre valeur »** remet la valeur écartée, **« Marquer comme examiné »** confirme la fusion ;
- une tournée **signée d’un seul côté** est gardée telle qu’elle a été signée (son scellé reste valide) ; les valeurs de l’autre version restent dans le rapport de conflit. Sur un audit verrouillé, une valeur ne se restaure que par une modification motivée depuis l’audit ;
- une **position** (X / Y d’une feuille, coordonnées d’une station avec leur saisie d’origine en UTM 21N) modifiée des deux côtés est retenue **entière** : jamais le X d’une tablette avec le Y ou le fuseau de l’autre.

Pour éviter les conflits : une tournée sur une seule tablette à la fois ; « Envoyer à l’autre tablette » avant de lui passer une tournée ; « Recevoir un fichier » le matin.

### Le mot de passe d’échange

- Défini par un administrateur à la mise en service de la tablette 1, puis saisi pour ouvrir le fichier à la mise en service de la tablette 2 : **le même sur toutes les tablettes**, 10 caractères minimum, différent des mots de passe des agents. Il est conservé chiffré sur chaque tablette : envoyer et recevoir ne le demandent plus.
- Communiquez-le **de vive voix**, jamais dans le message qui transporte le fichier.
- Pour le changer : Administration › Échanges entre tablettes › **« Changer le mot de passe d’échange »**, **sur chaque tablette**. Un fichier chiffré avec un autre mot de passe n’est pas ouvert : l’application l’explique et demande le mot de passe utilisé par l’autre tablette (rien n’est modifié tant que le fichier n’est pas ouvert et la réception confirmée).

### Profils des agents : règle de sécurité

Un fichier reçu ne peut pas, à l’insu de l’administrateur de la tablette, **élever le profil d’un agent**, **créer un administrateur**, **désactiver ou supprimer un agent** : ces changements ne s’appliquent d’office que si le fichier a été **envoyé par un administrateur de cette tablette** (agent connecté au moment de l’envoi). Sinon, ils sont mis **en attente** : Administration › **« Changements de profils reçus à valider »** › « Accepter » ou « Refuser ». Le dernier administrateur d’une tablette n’en est jamais retiré par un fichier. Le fichier ne contient ni mot de passe ni clé : il ne modifie jamais les comptes de connexion de la tablette (seuls le nom, les initiales et le profil affichés suivent le profil reçu).

La protection des fichiers repose sur le **mot de passe d’échange** : quiconque le connaît et dispose d’un fichier peut en lire le contenu, et même mettre une tablette en service. Gardez-le secret et changez-le si une tablette est perdue.

### Tablette perdue ou volée

Les données de la tablette perdue **restent chiffrées** (AES 256 bits), mot de passe d’échange compris : sans le mot de passe d’un de ses agents, elles sont illisibles. Rien ne peut être effacé à distance ; par prudence, sur l’autre tablette, un administrateur :

1. **change le mot de passe d’échange** (Administration › Échanges entre tablettes › « Changer le mot de passe d’échange ») : les fichiers suivants ne pourront plus être lus avec l’ancien, et un fichier chiffré avec l’ancien n’est plus ouvert d’office (l’application demande alors un mot de passe : refusez un fichier d’origine douteuse) ;
2. **retire les accès qui ont pu être exposés** : chaque agent qui utilisait le même mot de passe sur la tablette perdue **le change** (Mon compte › « Changer mon mot de passe sur cette tablette ») ; un agent dont le mot de passe a pu être vu (noté sur un papier rangé avec la tablette, par exemple) ou qui quitte l’équipe est **bloqué** : Administration › Agents de cette tablette › « Modifier » › décocher « Compte actif » (ou « Retirer de cette tablette »).

Ce qui n’avait pas encore été envoyé est perdu : d’où l’intérêt d’envoyer chaque soir.

- **Tablette de remplacement** : sur l’autre tablette, « Tout envoyer » ; sur la nouvelle, « Tablette supplémentaire : recevoir le fichier de l’autre tablette », avec le **nouveau** mot de passe d’échange et le n° proposé, puis « Ajouter sur cette tablette » pour chaque agent.
- **Tablette retrouvée** : avant de la réutiliser, un administrateur y saisit le nouveau mot de passe d’échange (Administration › Échanges entre tablettes), puis elle reçoit un fichier « Tout envoyer » de l’autre tablette.

### Le dépôt privé `fiche-de-controle-donn-es` n’est plus nécessaire

Le dépôt GitHub privé **`CSRE-DCE/fiche-de-controle-donn-es`** (GitHub a remplacé le « é » de « données » par « - ») ne sert plus à l’application : aucune tablette ne s’y connecte. Il peut servir, si vous le souhaitez, d’**archive manuelle** : un administrateur y dépose, par le site github.com, les rapports PDF signés et, au besoin, des fichiers d’échange `.oegct` (qui restent chiffrés : pour les relire, il faut le mot de passe d’échange en vigueur à leur date). Ce dépôt doit rester **privé** ([pas à pas](docs/GUIDE-GITHUB.md#12-archiver-des-rapports-dans-le-dépôt-privé-facultatif)). **Jamais de données dans le dépôt public de l’application** (`CSRE-DCE/fiche-de-contr-le`).

La synchronisation automatique par un dépôt GitHub (« mode équipe ») existe encore dans le code, comme option technique **non utilisée à l’OEG** : elle est décrite pour les développeurs dans [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md#annexe--synchronisation-github-mode-équipe-non-utilisée-à-loeg).

---

## Publier le site avec GitHub Pages

GitHub Pages publie gratuitement le contenu du dépôt (fichiers tels quels, sans construction) à une adresse web.

1. Sur <https://github.com/CSRE-DCE/fiche-de-contr-le>, ouvrez **Settings** (Paramètres) — il faut être administrateur du dépôt.
2. Dans le menu de gauche : **Pages**.
3. Rubrique **Build and deployment** › **Source** : choisissez **Deploy from a branch** (Déployer depuis une branche).
4. **Branch** : choisissez **main** et le dossier **/ (root)** (racine), puis cliquez sur **Save** (Enregistrer).
5. Après quelques minutes, la page affiche « Your site is live at https://csre-dce.github.io/fiche-de-contr-le/ » et un bouton **Visit site**.

**Adresse publiée :** <https://csre-dce.github.io/fiche-de-contr-le/>

**Délai de publication** : chaque envoi sur la branche `main` republie le site, en général en 1 à 10 minutes. L’avancement est visible dans l’onglet **Actions** (travail « pages build and deployment »). Le fichier `.nojekyll` à la racine demande à GitHub de publier les fichiers sans les transformer : ne le supprimez pas.

> Le site publié est **public**, comme le dépôt de l’application : il ne doit contenir aucune donnée. Les données restent chiffrées sur les tablettes.

### Installer l’application sur une tablette ou un téléphone

1. Ouvrez l’adresse **avec une connexion** et attendez l’écran de configuration (l’application se met en cache pour fonctionner hors connexion).
2. Ajoutez-la à l’écran d’accueil :
   - **Android (Chrome)** : menu **⋮** › **« Ajouter à l’écran d’accueil »** (ou « Installer l’application ») ;
   - **iPad / iPhone (Safari)** : bouton **Partager** › **« Sur l’écran d’accueil »** ;
   - **Windows (Edge ou Chrome)** : icône d’installation dans la barre d’adresse, ou menu › « Installer cette application ».
3. Lancez-la depuis l’icône « Contrôle OEG », mettez la tablette en service ([Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents)), puis vérifiez en mode avion qu’elle s’ouvre bien hors connexion.

---

## Travailler sans Node : VS Code ou Python

L’application n’a **aucune étape de construction** et n’utilise **ni Node ni npm** : les fichiers du dépôt sont servis tels quels. Il faut seulement un petit serveur web local, car un double-clic sur `index.html` (adresse `file://`) ne fonctionne pas : les modules JavaScript, le service worker et le chiffrement exigent une adresse `http://localhost`.

### Avec Python

1. Installez Python 3 (<https://www.python.org/downloads/> ; sous Windows, cochez « Add python.exe to PATH » pendant l’installation).
2. Ouvrez un terminal dans le dossier du dépôt et lancez :

   ```bash
   python tools/serve.py
   ```

3. Ouvrez **<http://localhost:8000>** dans le navigateur. Arrêt : `Ctrl+C`.

Options utiles : `python tools/serve.py --port 8080 --open` (autre port, ouverture du navigateur). Ce serveur interdit la mise en cache par le navigateur : chaque rechargement reprend la dernière version des fichiers. À défaut, `python -m http.server 8000` fonctionne aussi.

> Depuis une autre machine du réseau (adresse `http://192.168…`), le navigateur refuse le service worker et le chiffrement, qui exigent HTTPS hors de `localhost` : pour essayer sur une tablette, utilisez l’adresse GitHub Pages.

### Avec VS Code

1. Installez **Visual Studio Code** (<https://code.visualstudio.com/>) et ouvrez le dossier du dépôt (File › Open Folder…, en français Fichier › Ouvrir le dossier…).
2. Installez l’extension **Live Server** (onglet Extensions, recherche « Live Server »).
3. Cliquez sur **« Go Live »** dans la barre d’état, en bas à droite : l’application s’ouvre (en général à l’adresse <http://127.0.0.1:5500/>).

### Tâches VS Code

Le dossier `.vscode/` fournit des tâches prêtes à l’emploi (fichier `.vscode/tasks.json`) : menu **Terminal › Run Task…** (Terminal › Exécuter la tâche…), puis choisissez la tâche voulue (serveur local, tests, vérification avant publication, incrément de version). Elles lancent les commandes Python décrites dans ce document.

---

## Ajouter ou modifier des fichiers sur GitHub

Trois méthodes, de la plus simple à la plus complète. Le pas à pas détaillé, avec les libellés exacts des boutons, se trouve dans [docs/GUIDE-GITHUB.md](docs/GUIDE-GITHUB.md).

### 1. Directement sur le site github.com

- **Ajouter des fichiers** : ouvrez le dossier voulu du dépôt › **Add file** › **Upload files** (Téléverser des fichiers) › glissez-déposez les fichiers › écrivez un message (par exemple « Ajout des photos de la station X ») › **Commit changes** (Valider les modifications).
- **Créer un fichier** : **Add file** › **Create new file** › nom du fichier (tapez `dossier/nom.ext` pour créer un dossier) › contenu › **Commit changes…** › message › **Commit changes**.
- **Modifier un fichier** : ouvrez-le › icône **crayon** (Edit this file) › modifiez › **Commit changes…** › message › **Commit changes**.

### 2. Avec GitHub Desktop

1. Installez GitHub Desktop (<https://desktop.github.com/>) et connectez-vous à votre compte GitHub.
2. **File › Clone repository…** › choisissez `CSRE-DCE/fiche-de-contr-le` › **Clone** : le dépôt est copié sur votre ordinateur.
3. Modifiez les fichiers dans ce dossier (explorateur, VS Code…).
4. Dans GitHub Desktop, écrivez un résumé (« Summary ») puis cliquez sur **Commit to main**.
5. Cliquez sur **Push origin** pour envoyer sur GitHub. Avant de commencer une nouvelle session de travail, cliquez sur **Fetch origin** (puis **Pull origin**) pour récupérer les modifications des autres.

### 3. Avec VS Code

1. **Cloner le dépôt** : page d’accueil de VS Code › « Clone Git Repository… » (Cloner le dépôt Git…), collez `https://github.com/CSRE-DCE/fiche-de-contr-le.git`, choisissez un dossier, puis ouvrez-le.
2. Modifiez les fichiers.
3. Vue **Contrôle de code source** (Source Control, `Ctrl+Maj+G`) : écrivez un message, cliquez sur **Valider** (Commit).
4. Cliquez sur **Synchroniser les modifications** (Sync Changes) pour envoyer sur GitHub et récupérer les modifications des autres.

### À chaque modification de l’application : incrémenter la version

Le numéro de version se trouve dans [version.js](version.js) (`self.AUDIT_BUILD = …`). **Augmentez-le à chaque modification des fichiers de l’application** :

```bash
python tools/bump_version.py
```

(le script augmente `AUDIT_BUILD` de 1 et met la date du jour dans `AUDIT_BUILD_DATE` ; `--dry-run` affiche le résultat sans rien modifier). On peut aussi modifier le nombre à la main, en ligne avec l’icône crayon. Une modification limitée à la documentation (`README.md`, `docs/`), aux tests ou aux outils n’en a pas besoin. Sans ce changement, le service worker des appareils n’est pas réinstallé : le cache hors connexion n’est pas renouvelé d’un bloc et une tablette peut garder l’ancienne version (ou mélanger anciens et nouveaux fichiers) lorsqu’elle travaille hors réseau.

Si vous **ajoutez un nouveau fichier** utilisé par l’application (script, feuille de style, image, donnée), ajoutez aussi son chemin à la liste `SHELL` de [sw.js](sw.js), sinon il ne sera pas disponible hors connexion (la vérification automatique signale l’oubli).

### Vérification automatique

À chaque envoi sur GitHub, une vérification automatique (GitHub Actions, fichier `.github/workflows/verifications.yml`) contrôle la publication et lance les tests. Le contrôle de publication, `python tools/check_release.py`, peut aussi être lancé sur votre ordinateur : il signale un fichier oublié dans la liste `SHELL` ou absent, un chemin absolu (`/js/…`, interdit car le site est publié dans un sous-dossier), du code propre à Node, un fichier JSON invalide et une modification de l’application sans incrément de `AUDIT_BUILD`. Le résultat s’affiche dans l’onglet **Actions** du dépôt et à côté de chaque modification : coche verte ✓ = tout va bien ; croix rouge ✗ = cliquez dessus pour lire l’erreur, corrigez, puis renvoyez.

---

## Mettre à jour l’application

1. Modifiez les fichiers (voir [Ajouter ou modifier des fichiers](#ajouter-ou-modifier-des-fichiers-sur-github)) et **incrémentez la version** (`python tools/bump_version.py`).
2. Envoyez sur la branche `main` et vérifiez l’onglet **Actions** (vérification automatique, puis publication GitHub Pages).
3. Les appareils récupèrent la nouvelle version **automatiquement** dès qu’ils sont en ligne (à l’ouverture et au retour sur l’application) ; on peut forcer la recherche : **Mon compte › « Rechercher une mise à jour »**. Le numéro de version s’affiche en bas de l’écran de connexion (« Version 1.0.N ») et est enregistré dans chaque audit.

Les données enregistrées ne sont pas touchées par une mise à jour. Une tournée en cours garde la copie de la grille avec laquelle elle a été créée. Seule exception, voulue : les **grilles fournies avec l’application** (dont la grille CT-2026) se mettent à niveau sur chaque tablette à la première ouverture de session d’un administrateur ou d’un responsable qualité après la mise à jour ; les nouvelles tournées et les fiches vierges utilisent la nouvelle version dès la mise à jour. Exemple : la version 1.1 de la grille CT-2026 note la **turbidité en NTU** (unité des CCTP 2026) au lieu de FNU ; les tournées créées avant gardent FNU, et une tournée signée reste scellée à l’identique (aucune conversion des valeurs). Modifier la grille de contrôle elle-même (ajout d’un critère ou d’une feuille) demande des précautions particulières : voir [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md).

---

## Tests

Aucun Node n’est nécessaire : les tests utilisent Python et le navigateur.

**Tests unitaires dans le navigateur** : lancez le serveur local (`python tools/serve.py`) puis ouvrez <http://localhost:8000/tests/unit/index.html>. La page exécute tous les fichiers de tests (`core`, `domain`, `formats`, `grid-ct-2026`, `networks`, `pdf-sheets`, `github`, `attendus`, `exchange`, `demandes`, `links`…) et affiche les réussites et les échecs. Pour n’en lancer que certains : `tests/unit/index.html?files=grid-ct-2026,core`.

**Tests automatisés (pytest + Playwright)**, depuis la racine du dépôt :

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium      # une seule fois (sous Linux : --with-deps chromium)
python -m pytest
```

`python -m pytest -q` donne un affichage condensé ; `python -m pytest -m "not lent"` saute les tests longs (tournées complètes, PDF) ; la variable d’environnement `HEADED=1` affiche le navigateur pendant les tests. Ces tests ouvrent l’application dans un Chromium sans fenêtre : tests unitaires, parcours de l’application, tablette partagée et tournée en binôme (`tests/test_tablette_partagee.py`), échange par fichier entre deux tablettes (`tests/test_echange_tablettes.py` : deux navigateurs indépendants), réseaux de surveillance et turbidité en NTU (`tests/test_reseaux.py` : mises à niveau, imports, fusion entre deux tablettes, tournée signée intacte), demandes de l’OEG d’octobre 2026 (`tests/test_demandes_oeg.py` : « Annuler la tournée » par un contrôleur du binôme sur tablette et téléphone, opérateurs ajoutés sans doublon, « Prendre une photo » / « Importer depuis la galerie » avec la date de prise de vue, logo de l’application dans les écrans, les PDF et sur l’autre tablette ; `tests/test_coordonnees_utm.py` : saisie en UTM 21N convertie en UTM 22N sur la fiche d’une station et sur les feuilles, tablette et téléphone, relevé GPS, alertes, import de stations, tournée signée intacte, échange entre deux tablettes ; `tests/test_doublons.py` : grille CT-2026 1.2 sans doublon ni redondance, mise à niveau d’une tablette en 1.1 avec une tournée signée intacte, fenêtre « Aide et attendu », menus, PDF ; `tests/test_remplissage_auto.py` : remplissage automatique entre les feuilles d’une tournée à deux stations, saisie de l’agent conservée, valeurs proposées, fiche de station corrigée, reprise de la station précédente, tournée signée intacte, échange entre deux tablettes sans doublon ni perte) et, pour le mode équipe GitHub conservé dans le code mais non utilisé à l’OEG, synchronisation entre deux appareils avec un faux serveur GitHub (`tests/test_sync_github.py`, `tests/fake_github.py`, sans réseau). Ils tournent aussi automatiquement sur GitHub à chaque envoi (onglet Actions).

---

## Structure du dépôt

```text
index.html              page de l’application
manifest.webmanifest    description de l’application installable (nom, icônes, raccourcis)
sw.js                   service worker : cache hors connexion (liste SHELL), tuiles de carte
version.js              numéro de version (AUDIT_BUILD) — à incrémenter à chaque publication
styles.css, css/        styles (charte OEG, feuilles, audit, station)
js/
  main.js               démarrage et liste des écrans (routes)
  core/                 stockage chiffré, session, comptes, médias, outils
  domain/               règles métier pures : grille CT-2026, conditions, alertes, synthèse, fusion
  app/                  opérations : audits, opérateurs, logo, PDF, échanges entre tablettes (fichier .oegct), imports, exports, synchronisation GitHub (option avancée)
  ui/                   composants d’interface : feuilles, icônes, logo, carte, photo, GPS, signature
  views/                écrans (accueil, station, tournée, audit, échanges entre tablettes, administration…)
  formats/              CSV, Excel, ICS, moteur PDF
  lib/                  conversions de coordonnées (RGFG95 / UTM 22N et UTM 21N), contour de la Guyane, métadonnées EXIF des photos
data/referentiel-oeg.json   référentiel des stations repris des fiches terrain OEG
data/attendus-ct-2026.json  attendus des prestataires (source unique de l’écran, des PDF et de docs/ATTENDUS-PRESTATAIRES.md)
fonts/                  polices Barlow, Barlow Condensed, Montserrat (+ fonts/pdf pour les PDF)
icons/, img/            logo, icônes, décors, photos de la station ATHANASE
vendor/                 bibliothèques embarquées : Leaflet (carte), jsQR (QR codes)
docs/                   guides, charte graphique, maquettes des feuilles
tests/                  tests unitaires navigateur (tests/unit) et tests pytest
tools/                  outils Python : serveur local, vérification, incrément de version
.github/workflows/      vérification automatique (GitHub Actions)
.vscode/                tâches VS Code
.nojekyll               publication GitHub Pages sans transformation
```

---

## Licences et sources

- **Polices** Barlow, Barlow Condensed et Montserrat : SIL Open Font License 1.1 (textes de licence dans `fonts/OFL-Barlow.txt` et `fonts/OFL-Montserrat.txt`).
- **Leaflet** 1.9.4 (carte interactive) : licence BSD-2-Clause (`vendor/leaflet/LICENSE`).
- **jsQR** (lecture de QR codes) : licence Apache-2.0 (`vendor/jsqr/LICENSE`).
- **Contour de la Guyane** : département 973 issu de <https://github.com/gregoiredavid/france-geojson>, Licence Ouverte / Etalab, simplifié (`js/lib/guyane.js`).
- **Fond de carte** : tuiles OpenStreetMap chargées en ligne (« © contributeurs OpenStreetMap »), serveur de tuiles paramétrable (Administration › Paramètres de l’organisation).
- **Maquettes** des feuilles (`docs/maquettes/`) et **photos de station** (`img/stations/`) : fournies par l’OEG ; les photos de la station ATHANASE sont issues du rapport HYDRECO CRT BIO 2024.
- **Référentiel des stations** (`data/referentiel-oeg.json`) : repris des fiches terrain de l’OEG.
- **Fiches d’évaluation** « cours d’eau » et « eaux souterraines » 2026 (Agences de l’eau / Aquascop) : utilisées comme référence de contenu pour la grille CT-2026 ; elles ne sont pas publiées dans ce dépôt.
- Logo et charte : © Office de l’Eau de Guyane.
