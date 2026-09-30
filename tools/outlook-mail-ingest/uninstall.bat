@echo off
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ESM-Mail-Ingest.cmd" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*esm_mail_ingest*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Removed auto-start and stopped ESM Mail Ingest.
pause
