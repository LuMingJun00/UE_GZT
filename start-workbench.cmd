@echo off
setlocal
cd /d "%~dp0"
if not exist "Reference\EkkoPBR-Portable-Windows\runtime\node.exe" (
  echo [警告] 找不到便携 Node 运行时: Reference\EkkoPBR-Portable-Windows\runtime\node.exe
  pause
  exit /b 1
)
del /q "Workbench\.wb-port" 2>nul
del /q "Workbench\.wb-pid" 2>nul
start "" /min "Reference\EkkoPBR-Portable-Windows\runtime\node.exe" "Workbench\server.mjs"
for /l %%i in (1,1,40) do (
  if exist "Workbench\.wb-port" goto :ready
  >nul ping 127.0.0.1 -n 2
)
echo [警告] 工作台启动失败
pause
exit /b 1
:ready
set /p PORT=<"Workbench\.wb-port"
start "" "http://127.0.0.1:%PORT%/"
echo 工作台已启动: http://127.0.0.1:%PORT%/
echo 关闭请双击 "stop-workbench.cmd"
endlocal