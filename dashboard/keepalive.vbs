' qianli dashboard keepalive: hidden-runs dashboard\autostart.bat (port-guarded, idempotent)
' Invoked every 10 minutes by scheduled task "qianli-dashboard-keepalive"
' Path resolved per machine (2026-10-14 v154): desktop D:\dev / laptop C:\Users\0d00\Desktop
' 2026-11-07 闸门: 随用随开改制 (曼波定) — 任务本体禁用需管理员权限未遂,
' flag 存在即空转秒退。手动开启走 open-console.bat (不经本文件)。
' 恢复任务: 删 D:\dev\qianli\dashboard\keepalive_disabled.flag 后再启用任务。
If CreateObject("Scripting.FileSystemObject").FileExists("D:\dev\qianli\dashboard\keepalive_disabled.flag") Then WScript.Quit
Dim sh, fso, bat
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
bat = "D:\dev\qianli\dashboard\autostart.bat"
If Not fso.FileExists(bat) Then bat = "C:\Users\0d00\Desktop\qianli\dashboard\autostart.bat"
sh.Run """" & bat & """", 0, False
