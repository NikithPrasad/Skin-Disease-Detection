@echo off
rem One-time setup for the website. Needs Python 3.10 or newer and an internet connection.
cd /d "%~dp0"
python --version >nul 2>&1
if errorlevel 1 (
  echo Python is not installed. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during installation, then run this again.
  pause
  exit /b 1
)
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
rem CPU-only PyTorch: ~200 MB instead of ~2.5 GB for the GPU build. No GPU needed.
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r app\requirements.txt
echo.
rem Optional Gemini second opinion: the key is saved only on this computer (app\data is not in git)
if not exist app\data mkdir app\data
if exist app\data\gemini_api_key.txt (
  echo A Gemini API key is already saved on this computer.
) else (
  echo Optional: paste your Google Gemini API key to enable the "second opinion" feature,
  echo or just press Enter to skip. You can add it later by running setup.bat again.
  set /p GEMINI_KEY="Gemini API key: "
)
if defined GEMINI_KEY (
  powershell -NoProfile -Command "Set-Content -NoNewline -Encoding ascii -Path 'app\data\gemini_api_key.txt' -Value $env:GEMINI_KEY.Trim()"
  echo Key saved to app\data\gemini_api_key.txt ^(only on this computer, never uploaded to GitHub^).
)
echo.
echo Setup complete. Double-click run.bat to start the website.
pause
