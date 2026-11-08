@echo off
rem qianli 运维台随用随开 (2026-11-07 曼波定): keepalive 任务+自启 vbs 已撤,
rem 本脚本=手动开启器: 幂等拉起 (复用 autostart.bat port-guard) + 开浏览器。
rem 注: 拉起后 node 常驻到关机 (server.js 未加空闲退出, 需要再说)。
wscript.exe "%~dp0autostart-run.vbs"
start "" http://127.0.0.1:3100
exit /b 0
