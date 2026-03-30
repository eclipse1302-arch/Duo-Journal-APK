@echo off
setlocal

cd /d "%~dp0"

set "JDK_HOME=%~dp0.tools\jdk21\jdk-21.0.10+7"
if not exist "%JDK_HOME%\bin\java.exe" (
  echo [ERROR] JDK not found: %JDK_HOME%
  echo Please ask the agent to prepare portable JDK21 first.
  pause
  exit /b 1
)

set "JAVA_HOME=%JDK_HOME%"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo [1/3] Building web assets...
call npm run build
if errorlevel 1 goto :fail

echo [2/3] Syncing Capacitor Android project...
call npx cap sync android
if errorlevel 1 goto :fail

echo [3/3] Building debug APK...
cd /d "%~dp0android"
call gradlew.bat assembleDebug
if errorlevel 1 goto :fail

echo.
echo APK built successfully:
echo %~dp0android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:fail
echo.
echo Build failed.
pause
exit /b 1
