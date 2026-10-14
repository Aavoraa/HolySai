@echo off
rem EXAM Vision - AI paper correction with Claude, on http://localhost:8006
rem As the Holy Sai "Paper Correction" module, "npm run dev" in the project folder starts it for you.
rem Run this file only to start the service on its own. If the project .env has EXAM_VISION_SECRET,
rem the service runs as the Holy Sai module (sign-in through Holy Sai); otherwise standalone.
title EXAM Vision - port 8006
cd /d "%~dp0backend"
for /f "tokens=1,* delims==" %%a in ('findstr /b "EXAM_VISION_SECRET=" "%~dp0..\.env" 2^>nul') do set "EXAM_GATEWAY_SECRET=%%b"
if not defined EXAM_GATEWAY_SECRET start "" http://localhost:8006
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8006
