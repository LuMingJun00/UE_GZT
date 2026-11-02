@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
if exist "Workbench\.wb-pid" (
  set /p PID=<"Workbench\.wb-pid"
  taskkill /PID !PID! /T /F >nul 2>&1
)
if exist "Workbench\.ekkopbr-inject.pid" (
  set /p EPID=<"Workbench\.ekkopbr-inject.pid"
  taskkill /PID !EPID! /T /F >nul 2>&1
)
del /q "Workbench\.wb-port" 2>nul
del /q "Workbench\.wb-pid" 2>nul
del /q "Workbench\.ekkopbr-inject.pid" 2>nul
echo 工作台已关闭
endlocal