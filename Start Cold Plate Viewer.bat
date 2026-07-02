@echo off
setlocal
title Cold Plate - Master Baseline Viewer
cd /d "%~dp0"

echo.
echo  ============================================================
echo    Cold Plate - Master Baseline Viewer
echo  ============================================================
echo.

REM --- 1. Check Python -----------------------------------------
where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python was not found on your PATH.
  echo Install Python 3.10+ from https://www.python.org and run this again.
  echo.
  pause
  exit /b 1
)

REM --- 2. Free port 8000 if a previous run is still holding it --
echo Freeing port 8000 if a previous run is still using it...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

REM --- 3. Build the UI once if it hasn't been built ------------
if not exist "frontend\dist\index.html" (
  echo.
  echo First run: building the web UI ^(needs Node.js^). This can take a minute...
  where npm >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Node.js/npm not found and the UI is not built yet.
    echo Install Node.js LTS from https://nodejs.org then run this again.
    echo.
    pause
    exit /b 1
  )
  pushd frontend
  call npm install
  call npm run build
  popd
)

REM --- 4. Allow LAN access through Windows Firewall -------------
REM Adds an inbound rule for port 8000 (needs admin; skipped silently if not).
netsh advfirewall firewall show rule name="Cold Plate Viewer 8000" >nul 2>&1
if errorlevel 1 (
  netsh advfirewall firewall add rule name="Cold Plate Viewer 8000" dir=in action=allow protocol=TCP localport=8000 >nul 2>&1
)

REM --- 5. Open the browser shortly after the server starts -----
echo.
echo Opening http://127.0.0.1:8000 in your browser...
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:8000"

REM --- 6. Run the app (serves UI + API on one port) -----------
echo.
echo  ------------------------------------------------------------
echo    Server running:  http://127.0.0.1:8000
echo    Colleagues on the same LAN/WiFi can use the LAN address
echo    printed below by the server.
echo    Keep this window OPEN. Close it to stop the app.
echo  ------------------------------------------------------------
echo.
python server.py

echo.
echo Server stopped.
pause
endlocal
