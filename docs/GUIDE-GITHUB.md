# Guide GitHub pas à pas (débutant)

Ce guide explique, sans connaissance préalable, comment travailler sur le dépôt de l’application **Fiches de contrôle terrain** de l’Office de l’Eau de Guyane : <https://github.com/CSRE-DCE/fiche-de-contr-le>.

Les libellés des boutons de GitHub sont donnés **en anglais, tels qu’ils apparaissent à l’écran**, suivis de leur traduction entre parenthèses. GitHub fait évoluer son interface de temps en temps : si un bouton a légèrement changé de place, cherchez le même libellé.

## Sommaire

1. [Le vocabulaire en 2 minutes](#1-le-vocabulaire-en-2-minutes)
2. [Créer un compte ou se connecter](#2-créer-un-compte-ou-se-connecter)
3. [Ajouter des fichiers par le site](#3-ajouter-des-fichiers-par-le-site)
4. [Modifier un fichier en ligne](#4-modifier-un-fichier-en-ligne)
5. [Créer un dossier](#5-créer-un-dossier)
6. [Supprimer ou renommer un fichier](#6-supprimer-ou-renommer-un-fichier)
7. [Travailler avec GitHub Desktop](#7-travailler-avec-github-desktop)
8. [Travailler avec VS Code](#8-travailler-avec-vs-code)
9. [Avant chaque envoi : la version de l’application](#9-avant-chaque-envoi--la-version-de-lapplication)
10. [Activer GitHub Pages](#10-activer-github-pages)
11. [Consulter l’onglet Actions (vérifications)](#11-consulter-longlet-actions-vérifications)
12. [Archiver des rapports dans le dépôt privé (facultatif)](#12-archiver-des-rapports-dans-le-dépôt-privé-facultatif)
13. [Inviter un collègue](#13-inviter-un-collègue)
14. [Bonnes pratiques](#14-bonnes-pratiques)
15. [En cas de problème](#15-en-cas-de-problème)

---

## 1. Le vocabulaire en 2 minutes

| Mot GitHub | Ce que cela veut dire |
|---|---|
| **Repository** (dépôt) | le dossier du projet hébergé sur GitHub, avec tout son historique |
| **Commit** (validation) | un enregistrement de modifications, avec un message qui les décrit |
| **Branch** (branche) | une ligne de travail ; ici on travaille sur la branche **`main`**, qui est publiée |
| **Clone** (cloner) | copier le dépôt sur son ordinateur |
| **Push** (envoyer) | envoyer ses validations de l’ordinateur vers GitHub |
| **Fetch / Pull** (récupérer / tirer) | récupérer sur son ordinateur les modifications faites par les autres |
| **Public / Private** (public / privé) | visible par tous sur Internet / visible seulement par les personnes invitées |

Deux dépôts existent :

- **`CSRE-DCE/fiche-de-contr-le`** — PUBLIC : le code de l’application, publié sur <https://csre-dce.github.io/fiche-de-contr-le/>. **Aucune donnée ici.**
- **`CSRE-DCE/fiche-de-controle-donn-es`** — PRIVÉ (GitHub a remplacé le « é » de « données » par « - ») : **l’application ne s’en sert plus** ; il peut servir d’archive manuelle des rapports PDF ([section 12](#12-archiver-des-rapports-dans-le-dépôt-privé-facultatif)).

Les données de contrôle restent chiffrées sur les tablettes, qui se les échangent **par fichier**, directement de l’une à l’autre (Quick Share, Bluetooth, e-mail, Teams, clé USB) : GitHub n’intervient pas, et **les agents de terrain n’ont pas besoin de compte GitHub**. Ce guide concerne les personnes qui publient l’application ou alimentent l’archive privée.

---

## 2. Créer un compte ou se connecter

### Créer un compte

1. Allez sur <https://github.com> et cliquez sur **Sign up** (S’inscrire).
2. Saisissez votre adresse électronique professionnelle, un mot de passe et un nom d’utilisateur (par exemple `prenom-nom-oeg`), puis cliquez sur **Continue** (Continuer) à chaque étape.
3. Recopiez le code reçu par courriel pour vérifier votre adresse.
4. Activez la double authentification quand GitHub le propose (**Enable two-factor authentication**, Activer l’authentification à deux facteurs) : elle est obligatoire pour contribuer à un dépôt, et protège les données de l’équipe. Une application d’authentification sur téléphone suffit ; conservez les codes de récupération (**recovery codes**) en lieu sûr.

### Se connecter

Sur <https://github.com>, cliquez sur **Sign in** (Se connecter), saisissez votre identifiant ou adresse électronique et votre mot de passe, puis le code de double authentification.

### Rejoindre l’organisation CSRE-DCE

Demandez à un administrateur de vous inviter (voir [Inviter un collègue](#13-inviter-un-collègue)). Vous recevez un courriel : cliquez sur **View invitation** (Voir l’invitation) puis **Accept invitation** (Accepter l’invitation) — ou **Join CSRE-DCE** (Rejoindre CSRE-DCE) pour une invitation à l’organisation. Les invitations en attente apparaissent aussi sur <https://github.com/notifications>.

---

## 3. Ajouter des fichiers par le site

C’est la méthode la plus simple, sans rien installer.

1. Ouvrez <https://github.com/CSRE-DCE/fiche-de-contr-le>.
2. Cliquez sur les noms de dossiers pour vous placer **dans le dossier de destination** (par exemple `img`, puis `stations`).
3. Cliquez sur le bouton **Add file** (Ajouter un fichier) puis sur **Upload files** (Téléverser des fichiers).
4. **Glissez-déposez** les fichiers depuis l’explorateur de votre ordinateur dans la zone « Drag files here to add them to your repository » (Faites glisser les fichiers ici…), ou cliquez sur **choose your files** (choisissez vos fichiers). Glisser un dossier entier depuis Chrome ou Edge conserve son arborescence.
5. En bas de la page, rubrique **Commit changes** (Valider les modifications) :
   - premier champ : un message court et clair, par exemple « Ajout des photos de la station Saut Maripa » ;
   - laissez cochée l’option **Commit directly to the `main` branch** (Valider directement sur la branche main).
6. Cliquez sur le bouton vert **Commit changes** (Valider les modifications).

Limites du site : 25 Mo par fichier et 100 fichiers par envoi. Au-delà, utilisez GitHub Desktop ou VS Code.

> Rappel : pas de photos de personnes, de jeux de données d’audit, de fichiers d’échange entre tablettes, de PDF de contrôles ni de mot de passe dans ce dépôt public.

---

## 4. Modifier un fichier en ligne

1. Ouvrez le fichier dans le dépôt (cliquez sur son nom).
2. Cliquez sur l’icône **crayon** en haut à droite du fichier : **Edit this file** (Modifier ce fichier).
3. Faites vos modifications. L’onglet **Preview** (Aperçu) montre le rendu d’un fichier Markdown (`.md`).
4. Cliquez sur **Commit changes…** (Valider les modifications…).
5. Dans la fenêtre qui s’ouvre : **Commit message** (message de validation), éventuellement **Extended description** (description détaillée), option **Commit directly to the `main` branch**.
6. Cliquez sur **Commit changes** (Valider les modifications).

Exemple courant : augmenter le numéro de version dans `version.js` (voir [section 9](#9-avant-chaque-envoi--la-version-de-lapplication)).

---

## 5. Créer un dossier

GitHub ne conserve pas de dossier vide : on crée un dossier **en créant un fichier dedans**.

1. Placez-vous à l’endroit voulu dans le dépôt.
2. **Add file** (Ajouter un fichier) › **Create new file** (Créer un nouveau fichier).
3. Dans le champ **Name your file…** (Nommez votre fichier…), tapez le nom du dossier suivi d’une **barre oblique `/`** : par exemple `notes/`. GitHub transforme aussitôt ce texte en dossier. Tapez ensuite le nom du fichier : `notes/LISEZMOI.md`.
4. Écrivez le contenu du fichier.
5. **Commit changes…** › message › **Commit changes**.

Pour mettre ensuite des fichiers dans ce dossier, ouvrez-le et utilisez **Add file › Upload files** ([section 3](#3-ajouter-des-fichiers-par-le-site)).

---

## 6. Supprimer ou renommer un fichier

- **Supprimer** : ouvrez le fichier › menu **…** (trois points, en haut à droite) › **Delete file** (Supprimer le fichier) › **Commit changes…** › **Commit changes**.
- **Renommer ou déplacer** : ouvrez le fichier › crayon **Edit this file** › modifiez le nom dans le champ du chemin (tapez `../` pour remonter d’un dossier) › **Commit changes…** › **Commit changes**.

Si vous supprimez ou renommez un fichier utilisé par l’application, mettez aussi à jour la liste `SHELL` de `sw.js` et la version (sinon la vérification automatique échoue).

---

## 7. Travailler avec GitHub Desktop

GitHub Desktop est une application gratuite (Windows, macOS) qui évite la ligne de commande. Elle est pratique pour envoyer beaucoup de fichiers ou travailler hors connexion.

### Installer et se connecter

1. Téléchargez GitHub Desktop sur <https://desktop.github.com/> et installez-le.
2. Au premier lancement, cliquez sur **Sign in to GitHub.com** (Se connecter à GitHub.com) : le navigateur s’ouvre, autorisez l’application (**Authorize desktop**, Autoriser), puis revenez dans GitHub Desktop.
   Plus tard : **File › Options › Accounts** (Windows) ou **GitHub Desktop › Settings › Accounts** (macOS).

### Copier le dépôt sur l’ordinateur (une seule fois)

1. **File › Clone repository…** (Fichier › Cloner un dépôt…).
2. Onglet **GitHub.com** : choisissez `CSRE-DCE/fiche-de-contr-le` dans la liste (ou onglet **URL** : collez `https://github.com/CSRE-DCE/fiche-de-contr-le`).
3. **Local path** (Chemin local) : le dossier de votre ordinateur où ranger la copie, par exemple `Documents\GitHub\fiche-de-contr-le`.
4. Cliquez sur **Clone** (Cloner).

### Le cycle de travail

1. **Récupérer les dernières modifications** : cliquez sur **Fetch origin** (Récupérer depuis origin) dans la barre du haut ; s’il devient **Pull origin** (Tirer depuis origin), cliquez à nouveau.
2. **Modifier** les fichiers dans le dossier du dépôt : avec l’explorateur (**Repository › Show in Explorer** / **Show in Finder**, Afficher dans l’explorateur) ou avec VS Code (**Repository › Open in Visual Studio Code**).
3. Revenez dans GitHub Desktop : l’onglet **Changes** (Modifications) liste les fichiers modifiés, avec le détail des lignes. Décochez un fichier pour ne pas l’inclure.
4. En bas à gauche, champ **Summary (required)** (Résumé, obligatoire) : un message clair ; **Description** si besoin.
5. Cliquez sur **Commit to main** (Valider sur main).
6. Cliquez sur **Push origin** (Envoyer vers origin) dans la barre du haut : vos modifications sont sur GitHub.

L’onglet **History** (Historique) montre toutes les validations ; un clic droit sur une validation propose **Revert changes in commit** (Annuler les modifications de cette validation).

---

## 8. Travailler avec VS Code

Visual Studio Code est un éditeur gratuit qui intègre Git. Il permet aussi de lancer l’application localement (extension Live Server, ou `python tools/serve.py`).

### Installer

1. Installez VS Code : <https://code.visualstudio.com/>.
2. Sous Windows, installez aussi **Git** : <https://git-scm.com/download/win> (options par défaut).
3. Facultatif : interface en français avec l’extension **French Language Pack for Visual Studio Code** (onglet Extensions). Les libellés français sont indiqués ci-dessous entre parenthèses.

### Cloner le dépôt (une seule fois)

1. Page d’accueil de VS Code › **Clone Git Repository…** (Cloner le dépôt Git…) — ou `Ctrl+Maj+P` puis **Git: Clone**.
2. Collez l’adresse `https://github.com/CSRE-DCE/fiche-de-contr-le.git` et validez.
3. Choisissez le dossier de destination, puis cliquez sur **Open** (Ouvrir) lorsque VS Code le propose.
4. Lors du premier envoi, VS Code demande de se connecter à GitHub : **Allow** (Autoriser), puis autorisez dans le navigateur.

### Le cycle de travail

1. Ouvrez la vue **Source Control** (Contrôle de code source) : icône de branche dans la barre de gauche, ou `Ctrl+Maj+G`.
2. Avant de commencer : menu **…** de la vue › **Pull** (Tirer), pour récupérer les modifications des autres.
3. Modifiez les fichiers ; ils apparaissent sous **Changes** (Modifications). Un clic sur un fichier montre les différences.
4. Écrivez un message dans le champ **Message** en haut de la vue.
5. Cliquez sur **Commit** (Valider). Si VS Code demande « There are no staged changes to commit… » (Aucune modification indexée…), répondez **Yes** (Oui) ou **Always** (Toujours).
6. Cliquez sur **Sync Changes** (Synchroniser les modifications) : VS Code envoie vos validations et récupère celles des autres.

### Lancer l’application et les tâches

- Extension **Live Server** › bouton **Go Live** dans la barre d’état (adresse <http://127.0.0.1:5500/>) ; ou, dans le terminal (**Terminal › New Terminal**, Nouveau terminal) : `python tools/serve.py` puis <http://localhost:8000>.
- **Terminal › Run Task…** (Terminal › Exécuter la tâche…) : tâches prêtes à l’emploi du fichier `.vscode/tasks.json` (serveur local, tests, vérification, incrément de version).

---

## 9. Avant chaque envoi : la version de l’application

Le fichier `version.js` contient le numéro de version `self.AUDIT_BUILD = …`. **À chaque modification des fichiers de l’application, augmentez ce nombre de 1** :

- sur l’ordinateur : `python tools/bump_version.py` ;
- ou sur le site : ouvrez `version.js` › crayon › remplacez par exemple `self.AUDIT_BUILD = 3;` par `self.AUDIT_BUILD = 4;` › **Commit changes**.

C’est ce changement qui fait renouveler le cache hors connexion des tablettes. Une modification limitée à la documentation (`README.md`, `docs/`) n’en a pas besoin.

---

## 10. Activer GitHub Pages

À faire une seule fois, par un administrateur du dépôt.

1. Ouvrez le dépôt `CSRE-DCE/fiche-de-contr-le` › onglet **Settings** (Paramètres).
2. Menu de gauche, rubrique « Code and automation » : **Pages**.
3. **Build and deployment** (Construction et déploiement) › **Source** : **Deploy from a branch** (Déployer depuis une branche).
4. **Branch** (Branche) : **main**, dossier **/ (root)** (racine) › **Save** (Enregistrer).
5. Patientez quelques minutes puis rechargez la page : le message « Your site is live at https://csre-dce.github.io/fiche-de-contr-le/ » (Votre site est en ligne à…) apparaît, avec le bouton **Visit site** (Voir le site).

Ensuite, chaque envoi sur `main` republie automatiquement le site (1 à 10 minutes ; suivi dans l’onglet **Actions**, travail « pages build and deployment »). Avec un compte GitHub gratuit, GitHub Pages exige un dépôt public — c’est le cas du dépôt de l’application, jamais du dépôt privé d’archive.

---

## 11. Consulter l’onglet Actions (vérifications)

À chaque envoi, GitHub lance automatiquement la vérification de l’application (fichier `.github/workflows/verifications.yml` : contrôle de publication et tests).

1. Ouvrez l’onglet **Actions** du dépôt.
2. Chaque ligne est une exécution (**workflow run**), avec le message de la validation :
   - **coche verte ✓** : tout est correct ;
   - **rond orange** : en cours ;
   - **croix rouge ✗** : un problème a été détecté.
3. En cas d’échec : cliquez sur l’exécution, puis sur le travail (**job**) en rouge ; dépliez l’étape en erreur et lisez les dernières lignes (les messages sont en français : par exemple version non incrémentée, fichier absent du cache, test en échec).
4. Corrigez, puis renvoyez une validation : la vérification repart. Le bouton **Re-run jobs** (Relancer les travaux) relance une vérification sans modification (utile après un incident passager).

La même coche ou croix apparaît à côté de chaque validation dans la liste des fichiers et dans l’historique (**Commits**). GitHub envoie aussi un courriel en cas d’échec.

---

## 12. Archiver des rapports dans le dépôt privé (facultatif)

Le dépôt privé **`CSRE-DCE/fiche-de-controle-donn-es`** n’est **plus utilisé par l’application** : aucune tablette ne s’y connecte. Si vous le souhaitez, il sert d’**archive manuelle**, alimentée par un administrateur depuis un ordinateur ; sinon, il peut simplement rester tel quel.

1. Sur la tablette, produisez le document : rapport d’audit signé (audit › Signatures › « Rapport d’audit détaillé (PDF) » ou « Fiches de contrôle (PDF) »), puis faites-le passer sur l’ordinateur (e-mail, Teams, clé USB). Pour un fichier d’échange `.oegct`, archivez **une copie du fichier réellement envoyé à l’autre tablette** (pièce jointe de l’e-mail, copie de la clé USB) : un envoi fait seulement pour l’archive serait noté « envoyé » et l’autre tablette ne recevrait pas ces modifications.
2. Ouvrez <https://github.com/CSRE-DCE/fiche-de-controle-donn-es> et placez-vous dans le dossier voulu, par exemple `rapports/2026/` (pour créer un dossier : [section 5](#5-créer-un-dossier)).
3. **Add file** (Ajouter un fichier) › **Upload files** (Téléverser des fichiers) › glissez-déposez les fichiers › message, par exemple « Rapports de la tournée AUD-2026-000123 » › **Commit changes** (Valider les modifications), comme à la [section 3](#3-ajouter-des-fichiers-par-le-site) (25 Mo au plus par fichier sur le site ; au-delà, GitHub Desktop).

À retenir :

- le dépôt reste **privé** (badge **Private** sur sa page) : ne le passez jamais en public ; n’y invitez que les personnes qui en ont besoin ([section 13](#13-inviter-un-collègue)) ;
- les rapports PDF y sont lisibles par toutes les personnes invitées ; les fichiers `.oegct` restent chiffrés : pour s’en servir (« Recevoir un fichier » sur une tablette — un fichier ancien n’écrase jamais une saisie plus récente —, ou mise en service d’une tablette à partir d’un fichier « Tout envoyer »), il faut le mot de passe d’échange en vigueur à leur date ;
- **aucun mot de passe** dans ce dépôt (ni ceux des agents, ni le mot de passe d’échange) ;
- **jamais de données dans le dépôt public de l’application** (`CSRE-DCE/fiche-de-contr-le`) : ni rapport, ni fichier d’échange, ni paquet de données.

---

## 13. Inviter un collègue

Il faut être administrateur du dépôt.

1. Ouvrez le dépôt › **Settings** (Paramètres) › **Collaborators and teams** (Collaborateurs et équipes) — **Collaborators** pour un dépôt personnel.
2. Cliquez sur **Add people** (Ajouter des personnes).
3. Recherchez le nom d’utilisateur GitHub ou l’adresse électronique du collègue.
4. Choisissez le rôle :
   - dépôt de l’application : **Write** (écriture) pour les personnes qui le modifient, **Read** (lecture) sinon ;
   - dépôt privé d’archive : **Write** pour les administrateurs qui y déposent des rapports, **Read** pour les personnes qui les consultent.
5. Cliquez sur **Add … to this repository** (Ajouter … à ce dépôt). Le collègue accepte l’invitation reçue par courriel.

Les agents de terrain n’ont jamais besoin de GitHub : ils sont ajoutés sur chaque tablette dans l’application, **Administration › Agents de cette tablette › « ＋ Ajouter un agent »** (ou « Ajouter sur cette tablette » s’ils existent déjà sur l’autre tablette).

Pour retirer un accès : même page › **Remove** (Retirer) à côté du nom.

---

## 14. Bonnes pratiques

- **Jamais de données personnelles ni de données de contrôle dans le dépôt public** : pas d’audits, de fichiers d’échange entre tablettes (`OEG-echange_….oegct`), de paquets de données exportés, de PDF de tournées, de signatures, de photos de personnes, de listes de noms ou de numéros de téléphone. Les tablettes de l’OEG échangent leurs données par fichier, directement de l’une à l’autre (Quick Share, Bluetooth, e-mail, Teams, clé USB) : GitHub n’intervient pas.
- **Jamais de mot de passe** dans un fichier, un message de validation, un courriel ou une conversation : ni ceux des agents, ni le mot de passe d’échange, ni celui d’un compte GitHub. Un secret publié par erreur doit être changé aussitôt : supprimer le fichier ne suffit pas, l’historique le conserve.
- Le dépôt d’archive `CSRE-DCE/fiche-de-controle-donn-es` reste **privé**, avec le moins de personnes invitées possible.
- Activez la double authentification sur tous les comptes GitHub qui ont accès aux dépôts (administrateur et suppléant).
- Les fiches d’évaluation des Agences de l’eau / Aquascop et autres documents de tiers ne doivent pas être déposés dans le dépôt public.
- Un message de validation par modification, clair et en français (« Correction du libellé F4.12 », « Ajout des photos de la station X »).
- **Incrémentez la version** à chaque modification de l’application et vérifiez l’onglet **Actions** après chaque envoi.
- Récupérez les modifications des autres (**Fetch origin** / **Pull** / **Sync Changes**) avant de commencer à travailler.

---

## 15. En cas de problème

| Situation | Que faire ? |
|---|---|
| **Push origin** refusé (« rejected », des modifications existent sur GitHub) | **Fetch origin** puis **Pull origin**, puis **Push origin** à nouveau. |
| Conflit lors d’un **Pull** (le même fichier a été modifié des deux côtés) | GitHub Desktop liste les fichiers en conflit : ouvrez-les (bouton **Open in Visual Studio Code**), choisissez pour chaque bloc **Accept Current Change** / **Accept Incoming Change** (Garder ma modification / Garder la modification reçue), enregistrez, puis **Continue merge** / **Commit merge** (Valider la fusion). |
| Le site publié ne change pas | Vérifiez l’onglet **Actions** (publication terminée ?) puis rechargez la page ; dans l’application : **Mon compte › « Rechercher une mise à jour »**. Avez-vous incrémenté `version.js` ? |
| Croix rouge dans **Actions** | Ouvrez l’exécution, lisez le message d’erreur ([section 11](#11-consulter-longlet-actions-vérifications)), corrigez, renvoyez. |
| Un agent n’apparaît pas à l’écran « Qui utilise la tablette ? » | Un administrateur l’ajoute : Administration › Agents de cette tablette › « ＋ Ajouter un agent », ou « Ajouter sur cette tablette » s’il existe déjà sur l’autre tablette (même profil, après réception d’un fichier de celle-ci : Échanges entre tablettes › « Recevoir un fichier »). |
| Un fichier d’échange ne s’ouvre pas (« autre mot de passe d’échange ») | Le mot de passe d’échange n’est pas le même sur les deux tablettes : saisissez celui de la tablette qui a envoyé le fichier (demandez-le à un administrateur), puis harmonisez-le (Administration › Échanges entre tablettes). Voir le README, section « Deux tablettes pour quatre agents ». |
| Le dépôt privé d’archive affiche « 404 » (page introuvable) | Il est privé : demandez à un administrateur de vous inviter ([section 13](#13-inviter-un-collègue)), acceptez l’invitation, puis reconnectez-vous. |
