@echo off
chcp 65001 >nul
title Ember - Lanceur
cd /d "%~dp0"

echo ============================================
echo    EMBER - Lancement
echo ============================================
echo.

if not exist "node_modules" (
  echo Premiere fois : installation des dependances...
  echo Ca peut prendre 1-2 minutes, patiente.
  call npm install
  echo.
)

echo Lancement du site web  -^>  http://localhost:4311
start "Ember - Site Web" cmd /k npm run dev:web

echo Lancement de l'app bureau (fenetre Electron)...
start "Ember - App Bureau" cmd /k npm run dev:desktop

echo.
echo C'est parti ! Deux fenetres se sont ouvertes.
echo - Site web : http://localhost:4311
echo - App bureau : la fenetre Electron s'ouvre toute seule
echo.
echo Tu peux fermer CETTE fenetre-ci.
timeout /t 8 >nul
