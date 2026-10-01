@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (py -3 esm_mail_ingest.py --diag) || (python esm_mail_ingest.py --diag)
pause
