@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*esm_mail_ingest*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
for /f "delims=" %%i in ('py -3 -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do set "PYW=%%i"
if not defined PYW for /f "delims=" %%i in ('python -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"') do set "PYW=%%i"
start "" "%PYW%" "%~dp0esm_mail_ingest.py" --loop
echo Restarted ESM Mail Ingest (background).
pause
