@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0allow-lan.ps1"
pause
