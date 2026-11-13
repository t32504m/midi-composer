@echo off
rem Start the MIDI composer editor (first run installs packages).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install
  if errorlevel 1 (
    echo Failed to install packages.
    pause
    exit /b 1
  )
)
echo Building and starting. The browser will open at http://localhost:4173/
echo Close this window to stop the app.
call npm start
pause
