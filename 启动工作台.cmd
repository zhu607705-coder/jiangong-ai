@echo off
cd /d "%~dp0"
wsl.exe --cd "%CD%" bash ./scripts/start.sh
pause
