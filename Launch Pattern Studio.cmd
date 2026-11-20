@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if not errorlevel 1 (
    python visualizer\server.py --open
) else if exist "%USERPROFILE%\.platformio\penv\Scripts\python.exe" (
    "%USERPROFILE%\.platformio\penv\Scripts\python.exe" visualizer\server.py --open
) else (
    py -3 visualizer\server.py --open
)
if errorlevel 1 pause
