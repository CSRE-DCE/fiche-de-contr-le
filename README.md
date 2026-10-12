# Fiches de contrôle terrain — Office de l’Eau de Guyane

Application web de l’Office de l’Eau de Guyane (OEG) pour **contrôler sur le terrain les prestataires de prélèvement** (eaux de surface, eaux souterraines, suivi biologique). Elle s’utilise sur tablette, téléphone ou ordinateur, **fonctionne sans connexion** une fois installée et ne demande aucune installation de logiciel : un navigateur récent suffit.

**Adresse de l’application :** <https://csre-dce.github.io/fiche-de-contr-le/>

> Ce dépôt est **public** : il contient uniquement l’application. Les données de contrôle (audits, photos, signatures) restent chiffrées sur les appareils et, en mode équipe, dans un **dépôt GitHub privé distinct** (voir [Synchroniser plusieurs appareils](#synchroniser-plusieurs-appareils-avec-un-dépôt-github-privé)). N’ajoutez jamais de données ni de jeton d’accès dans ce dépôt.

Documents complémentaires :

- [docs/GUIDE-GITHUB.md](docs/GUIDE-GITHUB.md) : guide pas à pas de GitHub pour débutant (ajouter des fichiers, GitHub Desktop, VS Code, GitHub Pages, dépôt privé de données, jetons) ;
- [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md) : architecture et règles de développement (pour les personnes qui modifient le code) ;
- [docs/charte.html](docs/charte.html) : charte graphique « vivante » (composants réels de l’application) ; [docs/maquettes/](docs/maquettes/) : maquettes des 9 feuilles d’origine.

## Sommaire

1. [Présentation](#présentation)
2. [Fonctionnalités](#fonctionnalités)
3. [Utiliser l’application](#utiliser-lapplication)
4. [Publier le site avec GitHub Pages](#publier-le-site-avec-github-pages)
5. [Travailler sans Node : VS Code ou Python](#travailler-sans-node--vs-code-ou-python)
6. [Ajouter ou modifier des fichiers sur GitHub](#ajouter-ou-modifier-des-fichiers-sur-github)
7. [Synchroniser plusieurs appareils avec un dépôt GitHub privé](#synchroniser-plusieurs-appareils-avec-un-dépôt-github-privé)
8. [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents)
9. [Mettre à jour l’application](#mettre-à-jour-lapplication)
10. [Tests](#tests)
11. [Structure du dépôt](#structure-du-dépôt)
12. [Licences et sources](#licences-et-sources)

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

- **Accueil « Stations »** : toutes les stations du référentiel (108 au référentiel OEG : 38 en biologie, 68 en cours d’eau, 17 en eaux souterraines ; une station peut relever de plusieurs types), filtres par type de tournée, bassin et statut de contrôle (à contrôler / tournée en cours / contrôlée dans l’année), recherche, tournées en cours à reprendre, bouton « Nouvelle tournée » et carte des stations.
- **Fiche station** fidèle à la maquette : localisation cartographique (station, points de prélèvement et, pendant une tournée, relevés GPS), photographies rive droite / rive gauche / amont / aval, accès, difficultés, compartiments à contrôler, prestations programmées et historique des tournées. Boutons « Démarrer une tournée », « Fiches vierges (PDF) », « Fiche station (PDF) », « Modifier la station ».
- **Création de tournée** en sept étapes : type de tournée, prestataire contrôlé, date et modalité (inopiné ou avec rendez-vous), contrôleurs OEG de la tournée (binôme), stations dans l’ordre de passage (recherche, prestations programmées mises en avant, « Station la plus proche » par GPS), compartiments à contrôler, opérateurs du prestataire.
- **Tablette partagée et tournée en binôme** : plusieurs agents sur une même tablette (« Qui utilise la tablette ? », bouton « Changer d’agent »), même profil sur toutes les tablettes ; une tournée a un ou plusieurs contrôleurs OEG, chacun peut y saisir (chaque saisie reste attribuée à son auteur) et la signer ; un collègue peut « Rejoindre la tournée ». Voir [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents).
- **Saisie en feuilles** adaptée à la tablette (grands tableaux fidèles aux fiches papier, à partir de 1 100 px de large) et au téléphone (une carte par point de contrôle, quatre gros boutons C / P / NC / N/A). Chaque saisie est enregistrée immédiatement sur l’appareil.
- **Photos** prises avec l’appareil ou jointes (preuves rattachées au point de contrôle, horodatées, géolocalisées si possible, compressées), documents joints, saisie vocale (si le navigateur la propose), lecture de QR codes.
- **GPS en RGFG95** : le bouton « Relever la position » remplit les coordonnées X / Y (RGFG95 / UTM 22N) ; l’application compare la position aux coordonnées théoriques de la station.
- **Alertes** (écart de position GPS, température de conservation hors plage, calibration ancienne…) : elles **ne créent jamais de non-conformité automatiquement** ; le contrôleur choisit « Créer un écart » ou « Ne pas retenir ».
- **Écarts et actions** : un écart naît d’une décision du contrôleur, depuis un point perfectible (criticité proposée : Observation) ou non conforme (criticité proposée : Écart mineur) ; registre des écarts, échéances, actions correctives et clôture.
- **Synthèse sans score** : décomptes C / P / NC / N/A / non renseignés pour la tournée, par station et par feuille, conclusions des feuilles (choix du contrôleur), commentaire et bilan de l’auditeur, autres préconisations. Un point commun à la tournée n’est compté qu’une fois.
- **Signatures et verrouillage scellé** : contrôle avant clôture, signature du contrôleur OEG (n’importe quel contrôleur de la tournée) et du représentant du prestataire (ou refus / absence motivé), puis « Valider et verrouiller l’audit » : le contenu est scellé par une empreinte SHA-256 ; ensuite, seule une modification motivée et tracée est possible (profils Administrateur et Responsable qualité).
- **PDF** : fiches de contrôle de la tournée remplies (« Fiches de contrôle (PDF) », filigrane « PROVISOIRE » tant que l’audit n’est pas verrouillé), rapport d’audit détaillé, dossier de preuve (JSON + médias), fiches vierges imprimables par station et par type de tournée, fiche station seule.
- **Hors connexion** : toute l’application est mise en cache à la première ouverture ; le fond de carte peut être préchargé (écran Carte › « Précharger la zone affichée »).
- **Chiffrement local** : toutes les données (y compris photos et signatures) sont chiffrées sur l’appareil (AES-GCM 256 bits), déverrouillées par le mot de passe de chaque agent de la tablette ; verrouillage automatique après 30 minutes d’inactivité (réglable).
- **Journal d’audit** : qui a fait quoi, quand, sur quel appareil, avec l’ancienne valeur et le motif ; entrées chaînées par empreintes, bouton « Vérifier l’intégrité ».
- **Synchronisation entre appareils** par un dépôt GitHub privé (mode équipe), ou échanges de paquets de données sans réseau (mode autonome).
- Et aussi : planning des prestations (liste ou calendrier, import Excel / CSV / ICS), carte des stations, tableau de bord, historique et comparaison de tournées, observations simples et bouton « Urgence », exports Excel / CSV / ICS, gestion documentaire, bibliothèque de grilles, référentiels, mode « plein soleil » (contraste renforcé).

---

## Utiliser l’application

### Première configuration d’un appareil

1. Ouvrez <https://csre-dce.github.io/fiche-de-contr-le/> **avec une connexion** (Chrome ou Edge sur Android / Windows, Safari sur iPad / iPhone). La navigation privée est à éviter : le navigateur y efface les données.
2. L’écran **« Configuration de l’appareil »** propose deux choix :
   - **« Mode autonome »** — données sur cet appareil ;
   - **« Rejoindre une équipe »** — dépôt GitHub privé (voir la section [Synchroniser plusieurs appareils](#synchroniser-plusieurs-appareils-avec-un-dépôt-github-privé)).
3. En mode autonome, renseignez :
   - **Organisme** (Office de l’Eau de Guyane par défaut), **Nom de l’appareil** ;
   - **N° de l’appareil (1 à 99)** : un numéro **différent pour chaque appareil**, qui garantit des numéros d’audit uniques ;
   - le **compte administrateur** : nom et prénom, identifiant, mot de passe (8 caractères minimum) et confirmation ;
   - la case « Reprendre le référentiel des fiches terrain OEG » (stations, organismes, préleveurs, campagnes) : à laisser cochée ;
   - la case « Ajouter des données de démonstration fictives » : **cochée par défaut, à décocher pour un usage réel** (elles se retirent aussi plus tard : Administration › Données et stockage › « Retirer les données de démonstration »).
4. Cliquez sur **« Créer et ouvrir la session »**.

> **Mot de passe** : il déverrouille la clé de chiffrement de l’appareil et **ne peut pas être récupéré**. Ajoutez au moins un second agent administrateur (Administration › Agents de cette tablette › « ＋ Nouvel agent ») ou utilisez le mode équipe, dont les données sont aussi conservées dans le dépôt privé. Un administrateur peut redonner un mot de passe à un agent qui l’a oublié (Administration › Agents de cette tablette › « Modifier »).

### Mode autonome ou mode équipe ?

| | Mode autonome | Mode équipe (dépôt GitHub privé) |
|---|---|---|
| Où sont les données ? | sur l’appareil uniquement (chiffrées) | sur l’appareil (chiffrées) et dans le dépôt privé de l’équipe |
| Échanges entre appareils | paquets de données (Export › « Paquet de données complet (JSON) », puis « Importer un paquet ») | automatiques, dès qu’il y a du réseau |
| Comptes et profils | agents et profils gérés sur l’appareil | agents ajoutés sur chaque tablette (même profil partout, mot de passe propre à chaque tablette) ; seul l’administrateur a besoin d’un compte GitHub |
| Pour qui ? | un contrôleur seul, un essai | plusieurs contrôleurs ou plusieurs tablettes (par exemple [deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents)) |

Un appareil autonome peut être rattaché plus tard à une équipe par son administrateur (Synchronisation › « Rejoindre une équipe (dépôt GitHub) »).

### Déroulé d’une tournée

1. **Avant de partir (avec du réseau)** : ouvrez l’application et la session ; en mode équipe, attendez la fin de la synchronisation ; préchargez le fond de carte de la zone (menu Carte › « Précharger la zone affichée ») ; imprimez si besoin les fiches vierges de secours (fiche station › « Fiches vierges (PDF) »).
2. **Créer la tournée** : accueil **Stations › « Nouvelle tournée »** (ou, depuis une fiche station, « Démarrer une tournée » ; ou, depuis le Planning, cochez des prestations puis « Démarrer une tournée »). Remplissez les sept étapes :
   1. Type de tournée (Biologie, Cours d’eau, Eaux souterraines) ;
   2. Prestataire contrôlé ;
   3. Date et modalité (« Inopiné » ou « Avec rendez-vous ») ;
   4. Contrôleurs OEG de la tournée : vous êtes coché d’office ; cochez le ou les collègues qui contrôlent avec vous (binôme) ;
   5. Stations de la tournée, dans l’ordre de passage (▲ ▼ pour réordonner) ;
   6. Compartiments à contrôler (biologie : pré-cochés selon les stations) ;
   7. Opérateurs du prestataire ;

   puis **« Démarrer la tournée »**. Les informations connues (station, codes, bassin, date, heure, contrôleurs — « Agent(s) OEG » et « Contrôleur OEG » reçoivent les noms de tous les contrôleurs, par exemple « A. Dupont, B. Martin » —, prestataire, opérateurs…) sont pré-remplies.
3. **Saisir sur le terrain** :
   - en haut, le **sélecteur de stations** (pastilles numérotées avec l’avancement, « Ajouter une station », retrait motivé) ;
   - les **onglets** : la feuille « Organisation » (commune à la tournée) d’abord, puis les feuilles de la station affichée, puis Écarts, Synthèse, Signatures et Infos ;
   - pour chaque point : la valeur ou réponse, la cote **C / P / NC / N/A**, l’observation (obligatoire pour P et NC), et les outils (photo, relevé GPS, création d’un écart, aide) ;
   - les encadrés de chaque feuille : observations, notes, photos, conclusion ou bilan (cases à cocher par le contrôleur ; l’application peut suggérer, jamais décider).
4. **Écarts** : depuis un point P ou NC, ou depuis une alerte, « Créer un écart » ; le suivi se fait ensuite dans le menu **Écarts**.
5. **Synthèse** : décomptes par tournée, par station et par feuille ; saisissez le « Commentaire et bilan de l’auditeur » et les « Autres préconisations ».
6. **Signatures** : vérifiez le « Contrôle avant clôture », cliquez sur « Terminer l’audit (heure de fin) », « Signer en tant que contrôleur » (n’importe quel contrôleur de la tournée), puis « Faire signer le représentant » (ou « Refus / absence de signature »), enfin **« Valider et verrouiller l’audit »**. Les boutons « Fiches de contrôle (PDF) », « Rapport d’audit détaillé (PDF) » et « Dossier de preuve (JSON + médias) » produisent les documents.
7. **Interrompre** : onglet « Infos » › « Continuer plus tard ». La tournée se reprend depuis l’accueil (« Tournées en cours sur cette tablette ») ou la fiche station. Sur une tablette partagée, « Changer d’agent » (en-tête) laisse la tournée sur la tablette pour le collègue. Une tournée non signée peut être abandonnée (« Abandonner l’audit », avec motif).

La barre de navigation donne accès aux autres écrans : Stations, Planning, Audits, Écarts, Observations, Carte, Tableau de bord, Prestataires, Historique et comparaison, Documents, Grilles d’audit, Référentiels, Import, Export, Synchronisation, Journal d’audit, Administration et Mon compte (changement de mot de passe, « Rechercher une mise à jour », mode « plein soleil »). Le bouton **« Changer d’agent »** de l’en-tête (icône seule sur téléphone ; aussi dans Menu) enregistre la saisie en cours et revient à l’écran « Qui utilise la tablette ? ».

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

> Le site publié est **public**, comme le dépôt de l’application : il ne doit contenir aucune donnée. Les données restent sur les appareils et dans le dépôt privé de l’équipe.

### Installer l’application sur une tablette ou un téléphone

1. Ouvrez l’adresse **avec une connexion** et attendez l’écran de configuration (l’application se met en cache pour fonctionner hors connexion).
2. Ajoutez-la à l’écran d’accueil :
   - **Android (Chrome)** : menu **⋮** › **« Ajouter à l’écran d’accueil »** (ou « Installer l’application ») ;
   - **iPad / iPhone (Safari)** : bouton **Partager** › **« Sur l’écran d’accueil »** ;
   - **Windows (Edge ou Chrome)** : icône d’installation dans la barre d’adresse, ou menu › « Installer cette application ».
3. Lancez-la depuis l’icône « Contrôle OEG », configurez l’appareil, puis vérifiez en mode avion qu’elle s’ouvre bien hors connexion.

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

## Synchroniser plusieurs appareils avec un dépôt GitHub privé

### Principe

En mode équipe, les appareils partagent leurs données au moyen d’un **dépôt GitHub privé de données**, distinct du dépôt public de l’application (par exemple `CSRE-DCE/fiche-de-controle-donnees`). L’application lit et écrit ce dépôt **directement depuis le navigateur**, par l’API GitHub, avec **le jeton d’accès de la tablette** : il n’y a aucun serveur à installer. **Un jeton par tablette** (par appareil), créé par l’administrateur depuis son compte GitHub : les agents **n’ont pas besoin de compte GitHub**. Sur l’appareil, les données et le jeton restent chiffrés et la session s’ouvre hors connexion.

La mise en place concrète pour l’OEG (deux tablettes partagées par quatre agents) est décrite pas à pas dans [Deux tablettes pour quatre agents](#deux-tablettes-pour-quatre-agents) ; cette section en donne le détail.

### 1. Créer le dépôt privé de données (administrateur, une seule fois)

Sur GitHub : **+** › **New repository** › propriétaire `CSRE-DCE`, nom `fiche-de-controle-donnees`, visibilité **Private** › **Create repository**. Le dépôt peut rester vide (ou contenir un simple README) : l’application l’initialise.

### 2. Qui a besoin d’un compte GitHub ?

**Seul l’administrateur** (et, si vous le souhaitez, un administrateur suppléant) : son compte doit avoir le rôle **Write** (écriture) sur le dépôt de données (**Settings › Collaborators and teams › Add people**). Les agents de terrain n’ont **pas** de compte GitHub : ils sont ajoutés sur les tablettes dans l’application (Administration › Agents de cette tablette) et ouvrent leur session avec leur mot de passe.

### 3. L’administrateur crée un jeton « fine-grained » par tablette

Sur GitHub, connecté avec le compte de l’administrateur : photo de profil › **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**, **une fois pour chaque tablette** :

- **Token name** : le nom de la tablette, par exemple **« Tablette 1 »**, puis **« Tablette 2 »** pour la seconde (c’est ce nom qui permet de révoquer le bon jeton si une tablette est perdue) ;
- **Resource owner** : le propriétaire du dépôt de données (`CSRE-DCE` ; l’organisation doit autoriser les jetons fine-grained) ;
- **Expiration** : par exemple 90 jours ;
- **Repository access** : **Only select repositories** › uniquement le dépôt de données ;
- **Permissions** › **Repository permissions** › **Contents** : **Read and write** (« Metadata : Read-only » est ajouté automatiquement). **Aucune autre permission** ;
- **Generate token**, puis copiez le jeton (`github_pat_…`) : il n’est affiché qu’une fois.

**Un jeton par tablette**, saisi directement sur cette tablette (où il est conservé chiffré) : jamais copié sur une autre tablette, ni écrit dans un fichier, un courriel ou un message. Notez dans un registre quelle tablette porte quel jeton et sa date d’expiration. (Une équipe où chacun a son propre appareil suit la même règle : un jeton par appareil.)

### 4. Configurer la première tablette (administrateur)

1. Écran « Configuration de l’appareil » › **« Rejoindre une équipe »**.
2. **Dépôt GitHub (propriétaire/nom)** : `CSRE-DCE/fiche-de-controle-donnees` ; **Jeton d’accès « fine-grained » de la tablette** : collez le jeton « Tablette 1 ». Les « Options avancées » (branche `main`, dossier des données `donnees/`, adresse de l’API) n’ont normalement pas à être modifiées.
3. **« Vérifier l’accès au dépôt »** : l’application confirme le compte GitHub et que le dépôt est privé (elle refuse un dépôt public).
4. Dépôt vide : vérifiez les options (organisme, reprise du référentiel OEG), renseignez le **nom de la tablette** (« Tablette 1 ») et **votre compte d’administrateur** (nom, identifiant, mot de passe — ce mot de passe ouvre la session sur la tablette et n’est jamais envoyé à GitHub), puis **« Initialiser le dépôt et créer l’équipe »**. Vous êtes l’administrateur de l’équipe. Le compte créé à cette étape est toujours celui de la personne qui configure la tablette ; les agents sont ajoutés ensuite (étape 5).

Un appareil déjà utilisé en mode autonome peut aussi devenir le premier appareil de l’équipe : son administrateur ouvre Synchronisation › « Rejoindre une équipe (dépôt GitHub) » › « Rattacher cet appareil » (ses données sont fusionnées avec celles du dépôt).

### 5. Ajouter les agents et choisir leurs profils

**Administration › Agents de cette tablette › « ＋ Nouvel agent »** : nom et prénom, identifiant, profil ; l’agent choisit et saisit lui-même son mot de passe (deux fois). Le profil de l’agent est synchronisé : il est le même sur toutes les tablettes et se modifie par « Modifier » (un agent désactivé l’est partout).

La rubrique **Administration › Membres de l’équipe** concerne seulement les **comptes GitHub** (fichier `config/utilisateurs.json` du dépôt de données) : l’administrateur y est inscrit à l’initialisation ; ajoutez-y un administrateur suppléant s’il a son propre compte GitHub. Un agent rattaché à un login GitHub suit le profil de cette liste ; un agent sans login garde le profil choisi dans « Agents de cette tablette ». **Le login du propriétaire du jeton de la tablette ne s’applique jamais aux autres agents de la tablette.**

| Profil | Peut notamment |
|---|---|
| Administrateur | tout, y compris utilisateurs, appareils et paramètres |
| Responsable qualité | référentiels, documents et grilles ; modifier un audit signé (avec motif) ; abandonner un audit |
| Superviseur | modifier les audits des autres, clôturer les écarts, planning, journal d’audit |
| Auditeur | créer et réaliser ses tournées, écarts, observations |
| Consultation | consulter et exporter |

### 6. Configurer les autres tablettes

Sur chaque autre tablette, l’administrateur : « Rejoindre une équipe », même dépôt, **jeton de cette tablette** (« Tablette 2 »…), « Vérifier l’accès au dépôt » ; dans « Vous êtes déjà dans l’équipe ? », il choisit **« C’est moi »** (il garde ainsi la même identité sur toutes les tablettes), saisit son mot de passe pour cette tablette, puis **« Rejoindre l’équipe »**. Ensuite, **Administration › Agents de l’équipe pas encore sur cette tablette › « Ajouter sur cette tablette »** pour chaque agent : l’agent saisit le mot de passe qu’il utilisera sur cette tablette (deux fois) ; son profil, ses tournées et ses saisies sont les mêmes que sur l’autre tablette. Les données de l’équipe sont reçues, puis la synchronisation est automatique : à l’ouverture de session, après chaque modification et toutes les 5 minutes tant qu’il y a du réseau. L’écran **Synchronisation** affiche l’état, la file d’envoi, les conflits éventuels (« Examiner ») et le journal ; boutons « Synchroniser maintenant », « Tester la connexion », « Renouveler le jeton » (jeton expiré), « Télécharger les documents pour le terrain ».

Deux appareils qui modifient la même tournée sont fusionnés champ par champ ; si le même champ a été modifié des deux côtés, la valeur la plus récente est retenue et l’autre reste consultable et restaurable (Synchronisation › Conflits). Les numéros d’audit sont réservés par blocs : deux appareils ne produisent jamais le même numéro, même hors connexion.

### Appareils

Chaque appareil est enregistré dans `config/appareils.json`. Pour une tablette perdue ou retirée : **Administration › Appareils de l’équipe › « Désactiver (perdu) »** : ses données locales sont effacées à sa synchronisation suivante. Cela ne désactive **pas** son jeton : **révoquez aussi le jeton de cette tablette** sur GitHub (compte de l’administrateur › Settings › Developer settings › Personal access tokens › Fine-grained tokens › « Tablette … » › **Delete**).

### Contenu du dépôt de données

Dans le dossier `donnees/` : `config/` (équipe, utilisateurs, appareils, numéros réservés), `entites/<type>/<id>.json` (une donnée par fichier, lisible), `journal/` (journal d’audit par appareil et par jour) et `medias/` (photos, signatures, documents). L’historique Git conserve toutes les versions.

### Sécurité : ce qu’il faut savoir

- **La vraie protection des données partagées est l’accès au dépôt privé et aux jetons.** Toute personne disposant d’un jeton valide sur ce dépôt peut en lire et modifier tous les fichiers, quel que soit son profil dans l’application : les profils et le verrouillage des audits signés sont appliqués par l’application, pas par GitHub.
- Dans le dépôt de données, les fichiers sont en clair pour les personnes qui y ont accès ; sur les appareils, ils sont chiffrés.
- Les audits signés restent scellés par leur empreinte et le journal d’audit chaîné permet de détecter une altération.
- **Jamais de données dans le dépôt public de l’application** ; ne rendez jamais le dépôt de données public ; un jeton par tablette, limité au seul dépôt de données et à la permission « Contents » ; préférez une expiration courte ; activez la double authentification sur le compte GitHub de l’administrateur.
- Sur une tablette partagée, chaque agent a **son** mot de passe : il ne le communique pas à ses collègues et utilise « Changer d’agent » avant de passer la tablette, pour que chaque saisie reste attribuée à la bonne personne.

---

## Deux tablettes pour quatre agents

L’OEG dispose de **deux tablettes pour quatre agents** : les agents travaillent en binôme sur une tablette partagée, et un agent peut utiliser l’une ou l’autre tablette selon les jours. L’application est prévue pour cela : chaque agent a **son profil** (le même sur les deux tablettes) et **son mot de passe** sur chaque tablette où il travaille ; il n’a pas besoin de compte GitHub.

### Mise en place (administrateur, une seule fois)

1. **Dépôt de données** : créez le dépôt privé `CSRE-DCE/fiche-de-controle-donnees` ([détail](#1-créer-le-dépôt-privé-de-données-administrateur-une-seule-fois)).
2. **Un jeton par tablette** : depuis votre compte GitHub, créez **un jeton « fine-grained » pour chaque tablette**, nommé **« Tablette 1 »**, puis **« Tablette 2 »** : *Only select repositories* › le seul dépôt de données ; *Repository permissions* › **Contents : Read and write** ; aucune autre permission ; expiration courte (par exemple 90 jours) ([détail](#3-ladministrateur-crée-un-jeton--fine-grained--par-tablette)).
3. **Tablette 1** : « Rejoindre une équipe » avec le jeton « Tablette 1 », nom de la tablette « Tablette 1 », votre compte d’administrateur, puis « Initialiser le dépôt et créer l’équipe ».
4. **Les quatre agents sur la tablette 1** : Administration › Agents de cette tablette › **« ＋ Nouvel agent »** pour chaque agent (nom, identifiant, profil — en général « Auditeur ») ; **chaque agent choisit et saisit lui-même son mot de passe**.
5. **Tablette 2** : « Rejoindre une équipe » avec le jeton « Tablette 2 », nom « Tablette 2 » ; dans « Vous êtes déjà dans l’équipe ? », choisissez **« C’est moi »**, saisissez votre mot de passe pour cette tablette, puis « Rejoindre l’équipe ».
6. **Les quatre agents sur la tablette 2** : Administration › **Agents de l’équipe pas encore sur cette tablette** › **« Ajouter sur cette tablette »** pour chaque agent ; l’agent saisit son mot de passe pour cette tablette (deux fois ; il peut reprendre le même). Il retrouve ainsi le même profil, les mêmes tournées et ses saisies.

Un agent qui ne voit pas son nom à l’écran de connexion demande à un administrateur de l’ajouter : Administration › Agents de cette tablette. « Retirer de cette tablette » supprime seulement son accès à cette tablette (son profil, ses tournées et ses saisies restent ; le dernier administrateur ne peut pas être retiré) ; pour bloquer un agent partout : « Modifier » › décocher « Compte actif ».

### Au quotidien

- **Ouvrir la session** : l’écran **« Qui utilise la tablette ? »** affiche les agents de la tablette ; l’agent touche son nom puis saisit son mot de passe.
- **Tournée en binôme** : à la création (« Nouvelle tournée »), étape **« Contrôleurs OEG de la tournée »** : l’agent connecté est coché d’office ; cochez votre binôme. « Agent(s) OEG » (feuille d’organisation) et « Contrôleur OEG » (repères des stations) sont pré-remplis avec vos deux noms.
- **Passer la tablette** : bouton **« Changer d’agent »** (en-tête ; sur téléphone, icône ou Menu) : la saisie en cours est enregistrée, l’écran de connexion revient et **la tournée reste sur la tablette** ; le collègue se connecte et la reprend depuis l’accueil (« Tournées en cours sur cette tablette » : les tournées dont il est contrôleur d’abord). **Chaque saisie reste attribuée à l’agent connecté** (« Saisi le … par … » sous chaque point) ; l’onglet **Infos** liste les contrôleurs et le nombre de réponses saisies par chacun.
- **Rejoindre la tournée** : un agent qui ne fait pas partie des contrôleurs voit le bandeau « Tournée d’… — **Rejoindre la tournée** » ; en le touchant, il devient contrôleur (tracé au journal) et peut saisir. Un contrôleur peut aussi en ajouter ou en retirer un autre (onglet Infos, retrait avec motif ; jamais le dernier).
- **Signature** : n’importe quel contrôleur de la tournée signe « en tant que contrôleur » ; le PDF de la tournée et le rapport détaillé indiquent **tous les contrôleurs** ; l’empreinte scellée couvre la liste des contrôleurs.
- **Synchronisation** : automatique dès qu’il y a du réseau ; une tournée commencée sur une tablette peut être poursuivie sur l’autre après synchronisation.

### Tablette perdue ou volée

1. Sur l’autre tablette, l’administrateur : **Administration › Appareils de l’équipe › « Désactiver (perdu) »** sur la tablette perdue (ses données locales seront effacées à sa prochaine connexion) ;
2. **ET** sur GitHub, il **révoque le jeton de cette tablette** : Settings › Developer settings › Personal access tokens › Fine-grained tokens › « Tablette 1 » (ou 2) › **Delete**. Les autres tablettes et leurs jetons ne sont pas touchés.
3. Pour une tablette de remplacement : nouveau jeton (« Tablette 3 »), « Rejoindre une équipe », puis « Ajouter sur cette tablette » pour chaque agent.

---

## Mettre à jour l’application

1. Modifiez les fichiers (voir [Ajouter ou modifier des fichiers](#ajouter-ou-modifier-des-fichiers-sur-github)) et **incrémentez la version** (`python tools/bump_version.py`).
2. Envoyez sur la branche `main` et vérifiez l’onglet **Actions** (vérification automatique, puis publication GitHub Pages).
3. Les appareils récupèrent la nouvelle version **automatiquement** dès qu’ils sont en ligne (à l’ouverture et au retour sur l’application) ; on peut forcer la recherche : **Mon compte › « Rechercher une mise à jour »**. Le numéro de version s’affiche en bas de l’écran de connexion (« Version 1.0.N ») et est enregistré dans chaque audit.

Les données enregistrées ne sont pas touchées par une mise à jour. Une tournée en cours garde la copie de la grille avec laquelle elle a été créée. Modifier la grille de contrôle elle-même (ajout d’un critère ou d’une feuille) demande des précautions particulières : voir [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md).

---

## Tests

Aucun Node n’est nécessaire : les tests utilisent Python et le navigateur.

**Tests unitaires dans le navigateur** : lancez le serveur local (`python tools/serve.py`) puis ouvrez <http://localhost:8000/tests/unit/index.html>. La page exécute tous les fichiers de tests (`core`, `domain`, `formats`, `grid-ct-2026`, `pdf-sheets`, `github`) et affiche les réussites et les échecs. Pour n’en lancer que certains : `tests/unit/index.html?files=grid-ct-2026,core`.

**Tests automatisés (pytest + Playwright)**, depuis la racine du dépôt :

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium      # une seule fois (sous Linux : --with-deps chromium)
python -m pytest
```

`python -m pytest -q` donne un affichage condensé ; `python -m pytest -m "not lent"` saute les tests longs (tournées complètes, PDF) ; la variable d’environnement `HEADED=1` affiche le navigateur pendant les tests. Ces tests ouvrent l’application dans un Chromium sans fenêtre : tests unitaires, parcours de l’application, synchronisation entre deux appareils avec un faux serveur GitHub (`tests/fake_github.py`, sans réseau), tablette partagée et tournée en binôme (`tests/test_tablette_partagee.py`). Ils tournent aussi automatiquement sur GitHub à chaque envoi (onglet Actions).

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
  app/                  opérations : audits, PDF, synchronisation GitHub, imports, exports
  ui/                   composants d’interface : feuilles, icônes, carte, photo, GPS, signature
  views/                écrans (accueil, station, tournée, audit, synchronisation, administration…)
  formats/              CSV, Excel, ICS, moteur PDF
  lib/                  conversions de coordonnées (RGFG95 / UTM 22N), contour de la Guyane
data/referentiel-oeg.json   référentiel des stations repris des fiches terrain OEG
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
