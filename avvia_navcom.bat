@echo off
setlocal
title STAR CITIZEN NAVCOM
cd /d "%~dp0"

rem ---- 1. trova Python 3.12 (launcher "py" installato con Python per Windows)
set "PY="
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if not defined PY (
    python --version 2>nul | findstr /r "3\.1[2-9]" >nul && set "PY=python"
)
if not defined PY (
    echo [ERRORE] Python 3.12 non trovato.
    echo Installalo da https://www.python.org/downloads/ spuntando "Add python.exe to PATH".
    pause
    exit /b 1
)

rem ---- 2. ambiente virtuale e dipendenze (solo la prima volta o se cambia requirements.txt)
if not exist ".venv\Scripts\python.exe" (
    echo Creo l'ambiente virtuale...
    %PY% -m venv .venv || goto :fail
)
fc /b requirements.txt ".venv\requirements.installed" >nul 2>&1
if errorlevel 1 (
    echo Installo le dipendenze...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :fail
    copy /y requirements.txt ".venv\requirements.installed" >nul
)

rem ---- 3. avvio: apre il browser dopo qualche secondo
echo.
echo  NAVCOM in avvio su http://127.0.0.1:8601
echo  Trascina la finestra del browser sul secondo monitor.
echo  Per chiudere NAVCOM chiudi questa finestra.
echo.
start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start http://127.0.0.1:8601"
".venv\Scripts\python.exe" -m streamlit run navcom_app.py
goto :eof

:fail
echo [ERRORE] Installazione non riuscita. Controlla la connessione e riprova.
pause
exit /b 1
