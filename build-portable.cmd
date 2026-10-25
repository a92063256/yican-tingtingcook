@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 goto missing
node scripts\package-portable.mjs
if errorlevel 1 goto failed
echo.
echo Done: release\Yican-Windows-x64.zip
pause
exit /b 0
:missing
echo Build tools require Node.js 24 or newer, with npm.
:failed
echo Build failed. Read the message above.
pause
exit /b 1
