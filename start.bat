@echo off
title Cadence Voice Tutor — Server
echo.
echo  ============================================
echo   Cadence Multilingual Voice Tutor
echo   DataForge x Rime — Starting server...
echo  ============================================
echo.
cd /d E:\Cadence
call .venv\Scripts\activate
echo  Server running at: http://localhost:8000
echo  Press Ctrl+C to stop.
echo.
start "" "http://localhost:8000"
python web_server.py
pause
