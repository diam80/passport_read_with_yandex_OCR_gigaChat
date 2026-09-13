@echo off
cd /d "%~dp0"

echo Starting PassportRead server...
start "PassportRead-Server" cmd /k "node server.js"

echo Waiting for the server to be ready...
set ok=
for /l %%i in (1,1,30) do (
  curl -s -o nul http://localhost:3000/api/health && set ok=1 && goto :open
  timeout /t 1 /nobreak >nul
)

:open
if not defined ok (
  echo Server did not start. Check Node.js: node --version
) else (
  echo Done. Opening http://localhost:3000 ...
	start "chrome.exe" "http://localhost:3000"
rem   powershell -NoProfile -Command "Start-Process 'http://localhost:3000'"
  echo To stop the server, close the PassportRead-Server window (Ctrl+C).
)

pause >nul