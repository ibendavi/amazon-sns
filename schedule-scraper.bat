@echo off
REM Amazon S&S Price Scraper - Weekly Launcher
REM Schedule via Task Scheduler: weekly Sunday at 1:00 AM
REM Adds random 0-3 hour delay so runs between 1:00-4:00 AM

set /a SLEEP_SECONDS=%random% %% 10800
echo [%date% %time%] Sleeping %SLEEP_SECONDS% seconds before scraping... >> "%~dp0scraper.log"
timeout /t %SLEEP_SECONDS% /nobreak >nul

cd /d "%~dp0"
echo [%date% %time%] Starting scraper... >> scraper.log
node scraper.mjs >> scraper.log 2>&1
echo [%date% %time%] Scraper finished with exit code %ERRORLEVEL% >> scraper.log
