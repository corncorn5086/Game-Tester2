# SPECTER — Autonomous QA for games

L'IA fantôme qui playteste ton jeu pendant que tu dors. Deux livrables design haute‑fidélité,
animés et interactifs :

| Fichier | Rôle |
|---|---|
| `Specter Landing.dc.html` | Site web / landing page premium (présentation produit + download) |
| `Specter App.dc.html` | App desktop : Dashboard, New Test, Live Testing, Bug Reports, Aftermath |

## Ouvrir

Ce sont des **Design Components** — des pages HTML autonomes. Pour les voir :

1. Ouvre `Specter Landing.dc.html` dans l'aperçu (ou un navigateur).
2. Depuis la section « The App » de la landing, le bouton **Open the full app** mène à `Specter App.dc.html`.
3. Tu peux aussi ouvrir directement `Specter App.dc.html`.

Tout tourne côté navigateur — aucune installation, aucun build, aucun serveur requis.

## Ce que fait l'app (cliquable)

- **Sidebar** : Dashboard · Test Runs · Bug Reports · Game Builds · AI Agents · Settings + bouton *New Test*.
- **Dashboard** : stat cards animées, courbe de stabilité, bugs par sévérité, runs récents, feed agents live.
- **New Test** : sélection de build, types de test cochables, intensité, bouton *Start AI Test*.
- **Live Testing** : barre de progression animée, scénarios qui se valident un par un, logs streamés en temps réel.
- **Bug Reports** : liste filtrable par gravité + panneau détail (cause probable, fix suggéré, repro).
- **Aftermath** : jauge de stabilité, zones problématiques, recommandations, export PDF/JSON.

## Stack visuelle

- Type : Space Grotesk (display) + JetBrains Mono (technique)
- Palette : dark profond + accents cyan `#63ece4` / violet `#9d8dff`
- Icônes : Lucide
- Effets : glassmorphism, champ de particules canvas, cœur orbital 3D, scan lines, reveals au scroll, tilt 3D, micro‑interactions

## Porter vers Next.js / Electron (étape suivante)

Le design est pensé pour être porté tel quel :
- Chaque section / vue → un composant React (Tailwind reproduit les styles inline).
- Les animations CSS / canvas → Framer Motion + React Three Fiber pour le cœur 3D.
- L'app desktop → wrapper Electron ou Tauri autour de l'app React.
- Backend / API (run d'agents, stockage des rapports) à brancher après, comme demandé.
