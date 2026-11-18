@echo off
rem Lance l'Atelier 3D sur le reseau local : http://<ip-du-pc>:8030
setlocal
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv || exit /b 1
  .venv\Scripts\pip install -q -r requirements.txt || exit /b 1
)
if not defined HOTE set HOTE=0.0.0.0
if not defined PORT set PORT=8030
.venv\Scripts\uvicorn atelier3d.app:app --host %HOTE% --port %PORT%
