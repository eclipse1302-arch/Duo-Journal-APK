@echo off
title Duo Journal Server
echo ========================================
echo   Duo Journal - Starting Services...
echo ========================================
echo.

:: Start Vite dev server in background
echo [1/2] Starting Vite dev server on port 5173...
cd /d "e:\SJTU\Projects\Hackathon\Diary\duo-journal"
start "Vite Dev Server" cmd /c "npm run dev -- --port 5173 --host"

:: Wait for Vite to be ready
echo Waiting for Vite to start...
timeout /t 5 /nobreak >nul

:: Start ngrok
echo [2/2] Starting ngrok tunnel...
start "ngrok" cmd /c "ngrok http 5173"

echo.
echo ========================================
echo   Both services are running!
echo   Local:  http://localhost:5173
echo   ngrok:  Check the ngrok window for URL
echo ========================================
echo.
echo Press any key to STOP all services...
pause >nul

:: Cleanup - kill both processes
echo Shutting down...
taskkill /fi "windowtitle eq Vite Dev Server" /f >nul 2>&1
taskkill /fi "windowtitle eq ngrok" /f >nul 2>&1
taskkill /im ngrok.exe /f >nul 2>&1
echo Done.
