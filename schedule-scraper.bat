@echo off
REM Amazon S&S Scraper Suite - Weekly Launcher
REM Schedule via Task Scheduler: weekly Sunday at 1:00 AM
REM Adds random 0-3 hour delay so runs between 1:00-4:00 AM
REM Runs: Amazon price scraper, then competitor price scraper

set /a SLEEP_SECONDS=%random% %% 10800
echo [%date% %time%] Sleeping %SLEEP_SECONDS% seconds before scraping... >> "%~dp0scraper.log"
timeout /t %SLEEP_SECONDS% /nobreak >nul

cd /d "%~dp0"

echo [%date% %time%] Starting Amazon price scraper... >> scraper.log
node scraper.mjs >> scraper.log 2>&1
echo [%date% %time%] Amazon scraper finished with exit code %ERRORLEVEL% >> scraper.log

echo [%date% %time%] Starting competitor price scraper... >> scraper.log
node competitor-scraper.mjs >> scraper.log 2>&1
echo [%date% %time%] Competitor scraper finished with exit code %ERRORLEVEL% >> scraper.log

echo [%date% %time%] All scrapers complete. >> scraper.log
