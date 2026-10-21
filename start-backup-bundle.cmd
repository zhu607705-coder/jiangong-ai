@echo off
cd /d "%~dp0"
python scripts\bundle-launch.py
if errorlevel 1 pause
