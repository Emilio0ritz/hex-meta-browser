@echo off
set "HEX_DIR=%~dp0"
powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $env:HEX_DIR -WindowStyle Hidden"
exit /b
