@echo off
cd /d "%~dp0"
title CNA Fund Monitor
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
rem Install the components if any are missing or out of date (needs internet only when something is missing).
node -e "require('express');require('bcryptjs');require('exceljs');require('xlsx');require('pg')" >nul 2>nul
if errorlevel 1 (
  echo Installing the components the app needs. This needs internet and may take a minute.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo The installation failed. Check the internet connection and try again. & pause & exit /b 1 )
)
node server.js
echo.
echo The server has stopped.
pause
