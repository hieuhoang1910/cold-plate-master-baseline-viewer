@echo off
setlocal
title Cold Plate Viewer - build standalone exe
cd /d "%~dp0"

REM ============================================================
REM  Rebuilds standalone\ColdPlateViewer.exe from the current
REM  server.py + engine\ + frontend\dist.
REM  Run this after the physics (sync_engine.py) or UI changes.
REM  If you changed the UI, rebuild it first:
REM      cd frontend && npm run build
REM ============================================================

REM --- 1. Check Python -----------------------------------------
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python was not found on your PATH.
  pause
  exit /b 1
)

REM --- 2. Check the UI is built --------------------------------
if not exist "frontend\dist\index.html" (
  echo [ERROR] frontend\dist is missing. Build the UI first:
  echo    cd frontend ^&^& npm install ^&^& npm run build
  pause
  exit /b 1
)

REM --- 3. PyInstaller lives in its own venv at a SHORT path ----
REM     (a venv inside this deep folder tree hits the Windows
REM      260-character path limit during pip install)
set "VENV=%LOCALAPPDATA%\Temp\cpv\venv"
if not exist "%VENV%\Scripts\python.exe" (
  echo Creating build venv at %VENV% ...
  python -m venv "%VENV%" || (pause & exit /b 1)
)
"%VENV%\Scripts\python.exe" -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
  echo Installing PyInstaller...
  "%VENV%\Scripts\python.exe" -m pip install --quiet pyinstaller || (pause & exit /b 1)
)

REM --- 4. Build ------------------------------------------------
set "WORK=%LOCALAPPDATA%\Temp\cpv"
"%VENV%\Scripts\python.exe" -m PyInstaller --onefile --name ColdPlateViewer ^
  --distpath "%WORK%\dist" --workpath "%WORK%\build" --specpath "%WORK%" ^
  --add-data "%~dp0engine;engine" ^
  --add-data "%~dp0frontend\dist;frontend/dist" ^
  --hidden-import csv --hidden-import argparse --hidden-import itertools ^
  --hidden-import re --hidden-import webbrowser --hidden-import urllib.request ^
  server.py
if errorlevel 1 (
  echo [ERROR] PyInstaller build failed.
  pause
  exit /b 1
)

REM --- 5. Stage the deliverable + zip --------------------------
if not exist "standalone" mkdir "standalone"
copy /y "%WORK%\dist\ColdPlateViewer.exe" "standalone\" >nul
powershell -NoProfile -Command "Compress-Archive -Force -Path 'standalone\ColdPlateViewer.exe','standalone\README - How to run.txt' -DestinationPath 'standalone\ColdPlateViewer.zip'"

echo.
echo  Done:
echo    standalone\ColdPlateViewer.exe   (run/test it yourself)
echo    standalone\ColdPlateViewer.zip   (send this to the team)
echo.
pause
endlocal
