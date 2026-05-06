@echo off
echo [MASAR] Clearing ports...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8001 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8002 "') do taskkill /F /PID %%a >nul 2>&1
timeout /t 3 /nobreak >nul
echo [MASAR] Starting backend on port 8000...
cd d:\Graduation_Project
call grad_env\Scripts\activate
uvicorn backend:app --reload --port 8000
