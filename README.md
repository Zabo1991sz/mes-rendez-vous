# Mes rendez-vous

Application tablette (PWA) pour noter ses rendez-vous à la voix et les voir en grand.

## Tester sur le PC

```bash
npm start
```

Puis ouvrir http://localhost:8080 dans Chrome (le micro fonctionne sur `localhost`).

## Tests de l'analyse des phrases

```bash
npm test
```

## Fichiers

- `public/index.html`, `public/styles.css` : les écrans
- `public/app.js` : fonctionnement (veille, liste, dictée, vérification). Réglages en haut du fichier (prénom, délai de mise en veille, lecture à voix haute).
- `public/parser.js` : compréhension de la phrase (date, heure, motif)
- `public/backup.js` : sauvegarde (fichier `.json` à enregistrer / récupérer, copies automatiques)
- `public/sw.js`, `public/manifest.webmanifest` : installation sur la tablette et fonctionnement hors ligne

Les rendez-vous sont enregistrés uniquement sur l'appareil.

## Sauvegarde

Bouton « 💾 Sauvegarde » en bas de la liste :

- **Copies automatiques** : avant la première modification de chaque jour, l'appli garde une copie de la liste (7 dernières copies). Elles protègent d'une erreur (rendez-vous supprimé par mégarde), mais restent sur la tablette.
- **Enregistrer une copie** : crée un fichier `mes-rendez-vous-AAAA-MM-JJ.json` dans « Téléchargements », à mettre à l'abri ailleurs (mail, clé USB, NAS).
- **Récupérer** (depuis un fichier ou une copie automatique) : ajoute seulement les rendez-vous qui manquent, n'efface et ne modifie jamais rien.

## Sauvegarde en ligne (Firebase)

`public/cloud.js` copie les rendez-vous dans Firestore (projet `mes-rendez-vous-6147c`, un document par rendez-vous dans `rdv`) et les partage entre les appareils connectés au même compte (tablette, téléphone).

- Connexion une seule fois par appareil : « 💾 Sauvegarde » → « Sauvegarde en ligne » → e-mail et mot de passe du compte créé dans Firebase Authentication. La connexion reste active.
- Tout est d'abord enregistré sur l'appareil ; les changements partent dès qu'Internet est disponible. Les changements faits ailleurs arrivent toutes les 2 minutes (et à l'ouverture de l'appli).
- En cas de modification des deux côtés, la plus récente gagne. Une suppression est envoyée comme une marque « supprimé ».
- Un ⚠️ apparaît sur le bouton « Sauvegarde » si la connexion a expiré ou si rien n'a pu être envoyé depuis 2 jours.
- Sécurité : la configuration Firebase dans `app.js` n'est pas secrète. L'accès est limité au compte de la famille par les règles `firestore.rules` (à coller dans la console Firebase : Firestore → Règles → Publier), et la création de comptes est désactivée.
