@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0.."
title Capri check

rem Starts the check (selftest.js). It needs Node.js 20 or newer; if the PC has none, Capri's own Node is used
rem (Capri.exe started with ELECTRON_RUN_AS_NODE). Called by the two launchers one folder up. Only ASCII in this file.

set "RUNNER="
set "OLDNODE="
node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)" >nul 2>nul
if not errorlevel 1 (
  set "RUNNER=node"
  goto :run
)
node -v >nul 2>nul
if not errorlevel 1 set "OLDNODE=1"

set "CAPRI="
if defined CAPRI_EXE if exist "%CAPRI_EXE%" set "CAPRI=%CAPRI_EXE%"
if not defined CAPRI if exist "%LOCALAPPDATA%\Programs\Capri\Capri.exe" set "CAPRI=%LOCALAPPDATA%\Programs\Capri\Capri.exe"
if not defined CAPRI if exist "%LOCALAPPDATA%\Programs\capri-desktop\Capri.exe" set "CAPRI=%LOCALAPPDATA%\Programs\capri-desktop\Capri.exe"
if not defined CAPRI if exist "%ProgramFiles%\Capri\Capri.exe" set "CAPRI=%ProgramFiles%\Capri\Capri.exe"
if not defined CAPRI if exist "%ProgramFiles(x86)%\Capri\Capri.exe" set "CAPRI=%ProgramFiles(x86)%\Capri\Capri.exe"
if not defined CAPRI if exist "%~dp0..\Capri\Capri.exe" set "CAPRI=%~dp0..\Capri\Capri.exe"
if defined CAPRI (
  set "ELECTRON_RUN_AS_NODE=1"
  set "RUNNER=%CAPRI%"
  goto :run
)
if defined OLDNODE (
  set "RUNNER=node"
  goto :run
)
echo.
echo   Node.js was not found, and Capri is not installed in the usual place.
echo   Install Node.js 20 or newer from https://nodejs.org  (or install Capri), then run this again.
echo.
pause
exit /b 2

:run
if /i "%RUNNER%"=="node" (
  "%RUNNER%" "%~dp0..\selftest.js" %*
) else (
  rem Capri.exe is a program with windows, not a console one: without start /wait the batch would not wait for it
  start "" /b /wait "%RUNNER%" "%~dp0..\selftest.js" %*
)
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%
