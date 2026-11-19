@echo off
rem Lance toute la batterie de tests (serveur + navigateur). A faire passer avant chaque commit.
setlocal
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv || exit /b 1
  .venv\Scripts\pip install -q -r requirements.txt || exit /b 1
)
.venv\Scripts\python -m pytest -q -p no:warnings tests %*
