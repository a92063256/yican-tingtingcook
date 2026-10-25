@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS first.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required for this launcher.
  pause
  exit /b 1
)
if not exist .yican\current.json (
  if not exist node_modules\.bin\tsx.cmd (
    call npm.cmd ci --include=dev --no-audit --no-fund
    if errorlevel 1 goto failed
  )
  call npm.cmd run build
  if errorlevel 1 goto failed
)
node scripts\entry.mjs start --host 0.0.0.0
:failed
pause
