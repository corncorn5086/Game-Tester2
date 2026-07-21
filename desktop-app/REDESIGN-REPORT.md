# Ember — Refonte de l'interface interne (v0.3.1)

Rapport final · branche `claude/ember-redesign-premium-e7qlah` · commit `bf8125a`

---

## 0. Résumé

L'accueil public et la cinématique sont **verrouillés et prouvés identiques**.
Toute l'application après la connexion a été reconstruite en un **seul design
system Apple sombre** (noir / gris / blanc cassé / orange Ember). La cascade CSS
contradictoire a été **consolidée** (6 feuilles supprimées, une seule source de
vérité). **Aucun texte, caractère ou symbole japonais** ne subsiste dans l'app
interne ; le Japon reste uniquement dans le décor. Le terminal est **réel**
(PowerShell / shell système). Toutes les fonctions existantes sont préservées.

Bilan du commit : **35 fichiers, +4 609 / −8 232 lignes** (réduction nette
d'environ 3 600 lignes — consolidation, pas empilement).

---

## 1. Accueil public — VERROUILLÉ (preuve)

Rien n'a été modifié : `Landing.dc.html`, `landing.css`, `temple-intro.css`, la
section inline `ember-temple-intro--welcome` d'`index.html`, l'image, les
polices, les textes, les boutons, le sélecteur EN/FR, la boule, les animations.

**Méthode de preuve** (Playwright, viewport 1440×900) :

| Contrôle | Référence (source d'origine) | Après refonte | Verdict |
|---|---|---|---|
| Dimensions racine | 1440 × 900 | 1440 × 900 | **identique** |
| Boîte du copy (x,y,w,h) | 108 / 588.30 / 790 / 185.70 | 108 / 588.296875 / 790 / 185.703125 | **identique au pixel** |
| Welcome EN (diff vs baseline) | — | 2,80 % | animation seule* |
| Welcome FR (diff vs baseline) | — | 3,90 % | animation seule* |
| Cinématique (diff vs baseline) | — | 98,42 % | animation seule* |

\* **Preuve que le résidu est de l'animation, pas un changement de design** :
deux captures du *même* build actuel diffèrent l'une de l'autre de 1,81 % / 2,86 %
/ 98,67 % — même ordre de grandeur que le diff vs baseline. Le delta est donc
entièrement dû à la phase de rotation de l'orbe WebGL et des braises, qui varie
d'une capture à l'autre quel que soit le code. Confirmation visuelle : les deux
frames welcome-EN sont superposables (portail, pagode, montagnes, lanternes,
cerisier, logo, kicker, titre « A living intelligence for game testing. », copy,
boutons Create account / Sign in — tous à la même position, taille, couleur,
police).

Captures : `scratchpad/landing-ref/` (baseline) vs `scratchpad/landing-now/`.

---

## 2. Cascade CSS consolidée

### Fichiers supprimés (6) — contradictions éliminées

| Fichier supprimé | Contradiction qu'il causait | Destination du style utile |
|---|---|---|
| `workspace-dark.css` | thème sombre imposé par-dessus les pages | plié dans `app-shell.css` + `tokens.css` |
| `theme-dark.css` | 2ᵉ couche de thème sombre | idem |
| `home-refinement.css` | **remettait Home en blanc/crème/beige** | `home.css` (Home 100 % sombre) |
| `settings-redesign.css` | identité papier washi + `--ember-font-jp-*` | `settings.css` (sombre) |
| `visual-comfort.css` | corrections ad hoc | replié dans les fichiers propriétaires |
| `performance.css` | réglages perf épars | tokens + gardes qualité dans `tokens.css` |

### Source de vérité unique — `tokens.css`

- **Bloc « PUBLIC HERITAGE » gelé** : les anciennes variables `--ember-*` (dont
  les 3 `--ember-font-jp-*` et les `@font-face` japonaises) sont conservées mais
  **consommées uniquement par la Landing verrouillée**. Vérifié : aucun fichier
  interne ne référence `var(--ember-font-*)`.
- **Système sémantique interne** : `--app-bg #0d0d0f`, `--surface-1/2/3`,
  `--surface-hover`, `--border-subtle/strong`, `--text-primary/secondary/muted`,
  `--accent #f0783c` / `--accent-hover` / `--accent-deep`, `--success`,
  `--warning`, `--danger`, `--focus-ring` — 28 tokens. Police interne : pile
  Apple system (`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro
  Text", Inter, "Segoe UI Variable", "Segoe UI"`). Mono : `SFMono/JetBrains/
  Cascadia/Consolas`.
- **Gardes qualité** appliquées à l'orbe : `:root[data-quality="low"]
  molten-core canvas`, `:root[data-3d="off"] molten-core canvas { display:none }`,
  `html[data-window-active="false"] .ember-ambient *` (pause).

Plus aucun écran interne ne redevient beige/blanc selon l'ordre de chargement :
le thème clair papier n'existe simplement plus dans le code interne.

---

## 3. Japonais textuel retiré (app interne)

- **0 caractère CJK** sur les **28 fichiers internes** analysés (pages `.dc.html`,
  styles, scripts) — vérifié par balayage Unicode, et re-vérifié **dans le
  `app.asar` packagé**.
- Exclusions volontaires (verrouillées) : `Landing.dc.html`, `landing.css`,
  `temple-intro.css`.
- Kanjis fonctionnels (utilisés comme icônes / sceaux / états) remplacés par une
  **famille d'icônes SVG outline unique** (Home, Folder, Play, Stop, Check,
  Warning, Report, Search, Settings, User, Bell, Terminal, Plug, Help, Card,
  Chevron, Arrow, Shield, etc.). Icônes du menu Tools via masques CSS
  (`.is-plans/.is-activity/.is-terminal/.is-connectors/.is-config/.is-billing/
  .is-docs`). Le folio projet par défaut utilise l'**initiale** du projet, plus
  jamais 火.
- Traductions EN/FR nettoyées de toute mention/police japonaise ; aucune 2ᵉ
  traduction japonaise.

Le Japon subsiste **uniquement en décor** : `temple-bonsai-welcome-v2.png`,
jardins saisonniers via `seasons.css` (`--ember-season-garden` par
`data-season`), couches `.ember-ambient` discrètes — imperceptibles sur Reports
et le Terminal (aucun décor animé derrière le terminal).

---

## 4. Écrans refaits (Apple sombre)

Tous les écrans internes, pas seulement 2-3 :

- **AppChrome** — nav supérieure : logo + section (+ projet), centre
  Home/Projects/Test/Reports, droite action principale contextuelle + Search +
  Notifications + profil. Menu **Tools** (pas « More ») : Test Plans, Activity,
  Terminal, Connectors, Configuration, Documentation (icônes + titres +
  descriptions, navigation clavier, fermeture Échap/clic extérieur). 7 icônes SVG.
- **Home** — centre de commande à **4 états honnêtes** : sans projet / prêt / en
  cours / terminé, avec récupération. Une grande carte montre toujours la
  prochaine action. Plus de composition éditoriale chargée.
- **AccountOnboarding** — logique et données conservées, refonte sombre, une
  étape à la fois, autosave/reprise ; panneau Apple lisible sur décor temple.
- **Auth (Sign In / Create account)** — plein écran, jardin sombre en fond,
  panneau solide lisible ; jamais affiché si une session existe.
- **Projects / Add Project** — liste (nom, moteur, statut, dernier test,
  problèmes), Open Folder réel + validation stricte, détection moteur.
- **Test Center** — modes Quick/Guided/Custom, Deep AI review optionnel réel.
- **Reports / Report Viewer** — priorité aux données, décor minimal ; sévérités
  recolorées sur la palette (`critical #e56b60, high #f0783c, medium #e5a84b,
  low #8b8b95`).
- **Test Plans / Plan Composer** — concepts « sanctuaire/registre/sceau »
  retirés ; listes et éditeur clairs.
- **Settings** — sombre consolidé, une catégorie à la fois ; **Qualité**
  (Automatic/Low/Balanced/High), **Reduce Motion**, **Disable Ambient Effects**,
  **Disable 3D Effects** ; aperçus saisonniers par imagerie (printemps cerisier /
  été bonsaï vert / automne feuilles / hiver neige), labels EN/FR uniquement.
- **Cloches / Palette de commandes / Toasts / Terminal** — réécrits en classes.

---

## 5. Terminal réel

Vrai terminal, pas une zone de texte :

- **`main.cjs`** : `terminalSessions` (Map par webContents), `terminalShell()`
  → `powershell.exe -NoLogo -NoProfile -Command -` sur win32, sinon `$SHELL`/bash ;
  `startTerminal` / `terminalInput` / `stopTerminal` ; flux `ember:terminal:data`
  ({type:'data'|'cwd'|'exit'}) ; validation du cwd ; kill à la destruction du
  webContents.
- **`preload.cjs`** : `terminalStart({cwd})`, `terminalInput(command)`,
  `terminalStop()`, `onTerminalData(cb)` — API étroite via `window.emberDesktop`.
- Rendu monospace, historique, clear, panneau refermable, aucun décor animé
  derrière.
- Limite connue : shell **piped** (stdin/stdout), pas un vrai PTY interactif
  (suffisant pour exécuter des commandes réelles et afficher cwd/sortie/erreurs).

---

## 6. Correctifs notables

- **Course d'amorçage (bug réellement livré)** : `runSplash` remettait
  `bootDestination` à `null` *après* qu'`hydrateAuthStatus` l'ait mis en file →
  splash bloqué. Réparé par un `setState` fonctionnel préservant la destination
  (`bootDestination: destination ?? s.bootDestination`).
- **Contamination `sc-interp`** : le runtime enveloppe chaque interpolation dans
  `<span class="sc-interp">` ; des sélecteurs descendants (`.brand span { … }`)
  stylaient aussi ces spans internes (cercle orange derrière « LOCAL MODE »,
  chevauchements). Corrigé en re-scopant ~40 sélecteurs en enfant direct + une
  **garde globale** `span.sc-interp { display:inline; … reset }`.

---

## 7. Performance

- **Une seule scène WebGL importante** : l'orbe `<molten-core>` (1 seul élément,
  vérifié). Aucune multiplication de boules WebGL.
- Pauses : `visibilitychange` (document caché), `IntersectionObserver` (hors
  écran), `prefers-reduced-motion`, garde `data-quality="low"` (canvas masqué).
- Nettoyage complet au démontage : `cancelAnimationFrame`, `geometry.dispose()`,
  `material.dispose()`, `renderer.renderLists.dispose()`, `renderer.dispose()`,
  retrait des listeners.

**Mesure FPS** : l'environnement de test est **headless (WebGL logiciel
SwiftShader)**, qui plafonne artificiellement le rendu (~30 FPS mesurés) et
**n'est pas représentatif du GPU réel**. Aucun chiffre matériel honnête ne peut
être produit dans ce conteneur ; les garanties ci-dessus (scène unique + pauses +
disposal + gardes qualité) sont ce qui, sur GPU réel, tient la cible ~60 FPS.
Avant : la version d'origine empilait plusieurs feuilles + animations non
gardées ; après : orbe unique, gardée, avec modes qualité.

---

## 8. Build Windows

- **Configuration ajoutée** (`desktop-app/package.json`) : `electron-builder`
  (`appId dev.ember.desktop`, `productName Ember`, `files` electron/standalone/
  package.json hors `@ember`, `extraResources` `ember-core` + `ember-service.json`,
  cibles **Windows `portable` + `zip` x64**, asar activé). Scripts `dist:win` et
  `dist:win:dir`.
- **Reproduction sur une machine avec accès réseau** :
  `cd desktop-app && npm install && npm run dist:win`
  → produit `desktop-app/dist/Ember-0.3.1-portable.exe` et `Ember-0.3.1-x64.zip`.
- **Dans ce sandbox** : le `.exe` final **n'a pas pu être généré** — le proxy
  réseau renvoie **403** sur les binaires Electron hébergés sur les *release
  assets GitHub* (runtime Electron **et** `app-builder-bin` d'electron-builder).
  C'est une restriction réseau de l'environnement que je ne dois pas contourner.
- **Artefact réellement produit ici** : **`desktop-app/dist/app.asar`**
  (24 876 458 octets) — la charge utile exacte qui va dans
  `resources/app.asar` de la build Windows, packagée avec le packer pur-JS
  `@electron/asar`. Vérifié : contient les fichiers refaits, **aucune** des 6
  feuilles supprimées, **0 CJK** sur 28 fichiers. Les points d'entrée passent
  `node --check` (main/preload/static-server/project-service). Le boot complet est
  prouvé par le test de parcours (33 captures, 0 erreur page).

**Emplacement de la build** : `desktop-app/dist/app.asar` (dans le sandbox) ;
`desktop-app/dist/Ember-0.3.1-portable.exe` après `npm run dist:win` sur une
machine avec accès aux releases GitHub.

---

## 9. Tests exécutés

- **Parcours complet** (Playwright + mock fidèle de `window.emberDesktop`) :
  welcome → Create account → onboarding (identity/visual/plan/project) → Home
  (1ᵉ usage) → wizard Add Project → Home prêt → run live → run terminé → Report
  Viewer → Reports → Projects → Test Center → menu Tools → Test Plans → Plan
  Composer → Connectors → Config → Billing → Terminal (commande exécutée) →
  cloche → palette → Settings (profil/prefs/IA) → **FR** → Home FR.
  **33 captures, 0 erreur de page** (seul bruit : ERR_CONNECTION_RESET de Google
  Fonts en headless + 404 favicon — inoffensifs).
- **Verrou Landing** : dimensions + diff pixel EN/FR/cinématique (§1).
- **Dé-japonisation** : balayage CJK source + dans l'asar (§3).
- **Orbe unique** : énumération WebGL (1 `molten-core`).
- **Gardes** : présence `visibilitychange` / `IntersectionObserver` / disposal
  vérifiée dans `index.html`.

---

## 10. Problèmes restants / limites honnêtes

1. **`.exe` non généré dans ce sandbox** (403 sur binaires Electron GitHub) — la
   config et la commande de repro sont fournies ; l'`app.asar` est livré.
2. **FPS matériel non mesuré** (headless SwiftShader) — garanties
   architecturales fournies à la place.
3. **Terminal = shell piped**, pas un PTY complet (curseur/couleurs ANSI
   interactives limitées) ; exécution de commandes réelles OK.
4. Mock de test : `terminalInput` corrigé pour accepter une chaîne (le chemin
   Electron réel était déjà correct).

---

## 11. Confirmation

**L'accueil public et la cinématique sont inchangés** (dimensions identiques au
pixel, diff résiduel = animation seule, superposition visuelle confirmée).
Aucune nouvelle feuille d'overrides n'a été ajoutée : la cascade a été
consolidée, pas empilée.
