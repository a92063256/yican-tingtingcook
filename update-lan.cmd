@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 goto missing_node
where git >nul 2>nul
if errorlevel 1 (
  echo Git is required. Please install Git for Windows first.
  pause
  exit /b 1
)
node scripts\entry.mjs update
set "YICAN_UPDATE_RESULT=%errorlevel%"
pause
exit /b %YICAN_UPDATE_RESULT%
:missing_node
echo Node.js 24 LTS or newer is required.
pause
exit /b 1
