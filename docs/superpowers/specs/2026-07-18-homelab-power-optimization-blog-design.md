# HomeLab 节能优化博客文章设计

## 目标

为 chius.cc 撰写一篇中文技术复盘，记录两台 Proxmox VE 主机 Mars 与 Jupiter 的降功耗过程。文章既要保留真实排障过程，也要给读者提供可以复用的检查方法和 systemd 配置。

## 受众与披露边界

- 面向拥有 PVE、NAS、独立显卡或 UPS 的 HomeLab 用户。
- 保留 Sol、Saturn、Mars、Jupiter 等主机名，隐藏全部内网 IP。
- 只点名与功耗结论直接相关的虚拟机，例如 Windows、duo 和 EVE-NG；不公开完整 VM/LXC 清单。
- 不写入 SSH 配置、密钥、外部域名或其他访问凭据。

## 叙事方案

采用“技术复盘 + 可复制教程”的混合结构：以接近 200W 的初始问题开场，穿插 UPS 实测、逐项排查、错误判断修正与最终配置。避免写成单纯流水账，也不把真实排障过程压缩成脱离上下文的命令合集。

## 标题

《给两台 PVE 主机降功耗：一次 HomeLab 节能优化实录》

## 文章结构

1. 介绍由 OpenWrt、TrueNAS 和两台 PVE 组成的家庭服务器环境，以及接近 200W 的初始功耗。
2. 说明 APC UPS 的负载百分比、390W 标称有功功率换算和约 30 秒刷新延迟，强调趋势比单次读数更可靠。
3. 记录 Mars 的优化：`amd-pstate-epp`、`powersave + balance_power`、RTX 4060 Runtime PM 和关闭笔记本内屏背光。
4. 记录 Jupiter 的拆分测量：关闭全部来宾得到宿主机基线，再逐个启动 VM/LXC；解释部分 PCIe 设备缺少 ASPM 带来的硬件下限。
5. 复盘重启后的异常峰值：全部来宾 `onboot` 引发启动风暴，duo 曾出现 vCPU 唤醒失败和 KVM 单核空转，EVE-NG 启动时一度占用约 800% CPU。
6. 给出 Mars 与 Jupiter 的 systemd oneshot 服务，说明两台机器共同的 CPU 策略及 Mars 独有的 GPU、背光配置。
7. 汇总结果：重启峰值约 60%，约 10 分钟后整套 UPS 负载稳定在 31–34%；Jupiter CPU Package 在稳态约 12W。
8. 总结可复用经验：区分整套 UPS 与 CPU Package、考虑监控延迟、检查真实实时负载、按需启动 GPU VM，以及为重型来宾设置启动顺序。

## 数据表达

- UPS 负载百分比用于描述整套设备，必要时按 390W 标称有功功率给出近似瓦数，并明确这只是估算。
- RAPL 的 CPU Package 数值只描述处理器封装，不代替墙上功耗。
- 采用表格对比关键阶段：基础设备、Mars 上线、Jupiter 宿主机、全部来宾启动峰值和最终稳态。
- 不声称单个 VM/LXC 的功耗可以被 UPS 精确拆分；逐个启动测试只用于估算增量和定位异常。

## 配置与安全说明

- 命令以 Bash 代码块呈现，保持可复制。
- 推荐 `powersave + balance_power`，说明在 `intel_pstate` 和 `amd-pstate-epp` 下仍会按负载升频，并非锁死最低频率。
- 不把 `no_turbo=1` 写成通用推荐，因为它不是本轮统一实施的策略。
- GPU 直通场景说明：宿主机无法在设备被 VM 占用时让显卡进入 Runtime Suspend，按需启动 Windows VM 才是主要节能手段。

## 验证标准

- Front matter 与现有 Hugo 文章一致，日期使用 `2026-07-18T00:00:00+08:00`，标签包含 `HomeLab`、`Proxmox VE`、`节能`。
- Hugo 0.161.1 能无错误完成构建。
- 文中不出现家庭内网 IP、SSH 细节或完整来宾清单。
- 所有测量数据与本次实际记录一致，UPS 百分比和 CPU Package 不混用。
- 服务文件与实际部署版本一致。
