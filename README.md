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
