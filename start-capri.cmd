@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Capri

rem Starts Capri from these files. Node.js 18 or newer is needed for that: it is looked for, and if it is
rem missing (or too old) the portable one is fetched into your own folder (scripts\install-node.ps1, no administrator).

set "NEED_NODE="
where node >nul 2>nul || set "NEED_NODE=1"
if not defined NEED_NODE (
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" || set "NEED_NODE=1"
)

if defined NEED_NODE (
  echo Node.js не найден или слишком старый. Ставлю его в твою папку, права администратора не нужны...
  set "NODE_DIR="
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node.ps1"`) do set "NODE_DIR=%%F"
  if not defined NODE_DIR (
    echo Не получилось поставить Node.js. Поставь его с https://nodejs.org и запусти этот файл снова.
    pause
    exit /b 1
  )
  set "PATH=%NODE_DIR%;%PATH%"
)

if not exist node_modules (
  echo Первый запуск: ставлю пакеты, это несколько минут...
  call npm install
  if errorlevel 1 (
    echo npm install не удался. Проверь интернет и запусти этот файл снова.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
