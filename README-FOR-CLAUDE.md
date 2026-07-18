# Ember v0.3.1 — paquet de travail pour Claude

Ce dossier a été reconstruit à partir de la distribution Windows fournie. Les binaires Electron/Chromium, DLL, locales, installateurs et autres fichiers de runtime ont été retirés afin de garder un paquet léger et utile pour l’analyse ou la modification du projet.

## Structure

- `desktop-app/` : application Electron extraite de `app.asar`.
- `desktop-app/electron/` : processus principal, preload et services locaux.
- `desktop-app/standalone/` : interface, pages, styles, scripts, images, polices et effets visuels.
- `ember-core/` : modules source `@ember/agent` et `@ember/shared` inclus dans la distribution.
- `ember-service.json` : configuration du service embarqué.

## Contraintes de design à respecter

- Ne pas modifier l’écran d’accueil public/Landing existant, sauf demande explicite.
- Harmoniser uniquement le reste de l’application avec son univers visuel : style Apple clair, simple et premium, décor japonais sans texte ni symboles japonais décoratifs, palette noir/gris avec accents chauds déjà présents.
- Conserver les fonctionnalités existantes : modifier et améliorer, ne rien retirer sans validation.
- La navigation doit rester évidente, cohérente et accessible.
- Les animations, effets et éléments 3D doivent être fluides et optimisés; éviter les déplacements de mise en page et les baisses de FPS.

## Note technique

Ce paquet contient le code réellement livré dans l’application, mais pas nécessairement le dépôt de développement original ni ses fichiers de build complets. Avant de restructurer fortement le projet, commencer par cartographier les routes, composants, styles globaux et dépendances visibles dans `desktop-app/standalone/index.html` et `desktop-app/electron/main.cjs`.
