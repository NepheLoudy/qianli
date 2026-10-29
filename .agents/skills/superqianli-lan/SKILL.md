---
name: superqianli-lan
description: qianli 部署目标（小电脑 192.168.31.57 / NAS 192.168.31.153）只在 superqianli 局域网内可达。凡 npm run push 部署步报 ETIMEDOUT/ECONNRESET/握手超时、SSH/SFTP/ping 小电脑或 NAS 不通、部署前预防性连通性检查、或本地 commit 已推 GitHub 但现网没更新时使用——先判断当前机器是否在 superqianli 局域网，再考虑别的故障；不要把「不在局域网」误判成目标机故障去修目标机。
---

# superqianli 局域网：qianli 部署目标的连通性前提

## 铁律

小电脑（DESKTOP-FE1MIGI，192.168.31.57）与 NAS（qianli-NAS，192.168.31.153）**只挂在 superqianli 局域网**（主路由 192.168.31.1 的 WiFi/LAN，网段 192.168.31.x）。当前工作机不在该局域网时，SSH/SFTP/HTTP 全部不可达——ping 超时、ETIMEDOUT、ECONNRESET、handshake timeout 都是「不在局域网」的正常表现，**不是目标机故障，不要去修目标机**（qianli 各项目 push.js / ssh2 诊断脚本连的都是这台）。

## 触发即查（30 秒判定）

1. `ping -n 2 192.168.31.57`（Windows）——不通 = 大概率不在局域网；
2. `netsh wlan show interfaces` 看 SSID 是否 superqianli（WiFi 机器）；`ipconfig` 看本机是否有 192.168.31.x 网段地址（网线机器）；
3. 确认在局域网里却不通 → 才是目标机/路由器问题，转 `qianli-lab-network` skill 深度排查。

## 处置

- **不在局域网**：连回 superqianli（WiFi 选 superqianli；台式机查网线；人不在实验室时请曼波恢复内网），恢复后**重跑 `npm run push`**——部署链幂等（git/SFTP 同步、.env 上传、npm install、pm2 restart 全部可重入），不会双写。
- **典型症状对照**：本地 commit 已推上 GitHub、部署输出没有「✅ 部署完成」、目标机 pm2 uptime 未刷新 = 部署步没跑成、现网停留旧版。网络恢复后补跑一次 push 即可，版本不丢（实例：2026-10-22 凌晨 duty-bot v59 断网致部署步失败，现网停留 v58 半天，内网恢复后重跑补齐）。
- **与 GitHub 失败区分**：`git push` 到 github.com 失败（超时/无法解析/SSL 中断）= 公网问题，用 `git-push-accelerator` skill（Watt Toolkit 加速）；连 192.168.31.x 失败 = 本 skill（局域网问题）。两者可独立发生，也可同时发生（人不在实验室且公网也不通）。

## 相关 skill

- `qianli-deploy`：部署链本体（npm run push 流程 / .env 规则 / 隔离红线）
- `qianli-lab-network`：局域网完整拓扑与深度排障（路由器/校园网认证/双网关互踩/设备清单）
- `git-push-accelerator`：GitHub 公网加速（与局域网无关）
