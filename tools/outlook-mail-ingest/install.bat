@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ==== ESM Mail Ingest - install ====

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo [X] Python not found. Install Python 3 from python.org first ^(tick "Add to PATH"^).
  pause & exit /b 1
)

echo [1/4] Installing pywin32 ...
%PY% -m pip install --user --upgrade pywin32 || (echo [X] pip install failed & pause & exit /b 1)

echo [2/4] Setup token + test connection ...
%PY% "%~dp0esm_mail_ingest.py" --setup || (echo [X] Test failed - see messages above & pause & exit /b 1)

echo [3/4] Register auto-start at logon ...
for /f "delims=" %%i in ('%PY% -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"') do set "PYW=%%i"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\ESM-Mail-Ingest.cmd" echo @start "" "%PYW%" "%~dp0esm_mail_ingest.py" --loop

echo [4/4] Start now ...
start "" "%PYW%" "%~dp0esm_mail_ingest.py" --loop

echo.
echo Done. Runs every time you log in, checks Outlook every 15 minutes.
echo Log file: %~dp0esm_mail_ingest.log
pause
