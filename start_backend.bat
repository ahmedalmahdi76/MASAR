@echo off
setlocal enabledelayedexpansion

echo [MASAR] Clearing port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [MASAR] Loading environment...
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" if not "%%b"=="" set "%%a=%%b"
)

echo [MASAR] Starting backend on port 8000...
uvicorn backend:app --host 0.0.0.0 --port 8000 --reload
