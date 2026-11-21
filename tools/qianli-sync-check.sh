#!/usr/bin/env bash
# qianli 工作区同步体检（2026-11-22 git 体检批落地，AGENTS「收工自查」规则配套工具）
# 用法: bash tools/qianli-sync-check.sh   （在 qianli 工作区任意位置执行均可，自动定位根）
# 体检项: ①各仓 origin 欠账 ②gitlink 锚点漂移 ③DEVLOG 指针 vs 末条目版本一致性 ④脏工作区提示
# 退出码: 0=全绿, 1=有漂移项（脏工作区只提示不计失败——调试会话等合法在途）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

repos=(".:qianli顶层" "approval-bot:approval-bot" "duty-bot:duty-bot" \
       "ticket-pm/ticket-bot:ticket-bot" "ticket-pm/project-management-robot:pm-robot" \
       "memory:memory(大脑仓)" "sop/site-sop-planet:site-sop-planet")

echo "== qianli-sync-check $(date '+%Y-%m-%d %H:%M:%S') root=$ROOT =="

# ①② 各仓 origin 欠账 + 脏提示
for kv in "${repos[@]}"; do
  path="${kv%%:*}"; name="${kv#*:}"
  d="$ROOT/$path"
  unpushed=$(git -C "$d" rev-list --count origin/main..HEAD 2>/dev/null || echo ERR)
  dirty=$(git -C "$d" status --short 2>/dev/null | wc -l | tr -d ' ')
  if [ "$unpushed" != "0" ]; then echo "⚠ [$name] origin 欠账 $unpushed 笔未推"; fail=1; fi
  if [ "$unpushed" = "ERR" ]; then echo "⚠ [$name] origin/main 不存在（无远端或未推过）"; fail=1; fi
  if [ "$dirty" != "0" ]; then echo "· [$name] 脏工作区 $dirty 项（合法在途请自行确认）"; fi
done

# ③ gitlink 锚点漂移（顶层仓记录值 vs 嵌套仓实际 HEAD）
while read -r mode sha _stage path; do
  [ "$mode" = "160000" ] || continue
  head_sha=$(git -C "$ROOT/$path" rev-parse HEAD 2>/dev/null || echo missing)
  if [ "$sha" != "$head_sha" ]; then
    echo "⚠ [gitlink] $path 锚=${sha:0:7} HEAD=${head_sha:0:7}（父仓锚点待收编）"; fail=1
  fi
done < <(git -C "$ROOT" ls-files -s | awk '$1=="160000"')

# ④ DEVLOG 指针 vs 末条目版本一致性
for dv in "$ROOT/DEVLOG.md" \
          "$ROOT/approval-bot/DEVLOG.md" "$ROOT/duty-bot/DEVLOG.md" \
          "$ROOT/ticket-pm/ticket-bot/DEVLOG.md" "$ROOT/ticket-pm/project-management-robot/DEVLOG.md" \
          "$ROOT/feishu-gateway/DEVLOG.md" "$ROOT/bambu-print-reservation/DEVLOG.md" \
          "$ROOT/netlog/DEVLOG.md"; do
  [ -f "$dv" ] || continue
  ptr=$(grep -m1 -oP '当前最新：\*\*\Kv[0-9A-Za-z.]+' "$dv" 2>/dev/null || echo none)
  last=$(grep -E '^#{2,3} v' "$dv" | tail -1 | grep -oP '^#{2,3} \Kv[0-9A-Za-z.]+')
  if [ "$ptr" != "$last" ]; then
    echo "⚠ [DEVLOG] ${dv#$ROOT/}: 指针=$ptr 末条目=$last"; fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✅ 全绿：origin 欠账 / gitlink 锚点 / DEVLOG 指针 一致性全部通过"
else
  echo "❌ 存在漂移项如上——按 AGENTS「npm push 五连」收尾后重跑"
fi
exit $fail
