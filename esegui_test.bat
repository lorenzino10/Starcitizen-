@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Avvia prima avvia_navcom.bat per installare l'ambiente.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" -m pytest -v
echo.
".venv\Scripts\python.exe" tools\aaron_halo_report.py
pause
