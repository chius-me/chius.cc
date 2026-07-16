# HomeLab Power Optimization Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a Chinese technical retrospective on chius.cc that documents the measured Mars and Jupiter power optimizations and provides reproducible systemd configurations.

**Architecture:** Add one self-contained Hugo Markdown post under `content/posts`. The post combines a chronological incident narrative with measurement cautions, exact configuration examples, and a results table; validation uses Hugo plus targeted privacy and consistency searches.

**Tech Stack:** Hugo 0.161.1 extended, Blowfish theme, Markdown with YAML front matter, Bash/systemd examples

## Global Constraints

- Preserve the hostnames Sol, Saturn, Mars, and Jupiter, but publish no private IP addresses.
- Name only Windows, duo, and EVE-NG among the guests; do not publish the complete VM/LXC inventory.
- Treat UPS load as whole-rack load and RAPL CPU Package as processor-only power; never present them as interchangeable.
- Use date `2026-07-18T00:00:00+08:00` and tags `HomeLab`, `Proxmox VE`, `节能`, and `UPS`.
- Keep both systemd service definitions consistent with the versions actually deployed.
- Do not recommend `no_turbo=1` as part of the shared tuning.

---

### Task 1: Write the HomeLab power optimization post

**Files:**
- Create: `content/posts/2026-07-18-homelab-power-optimization.md`

**Interfaces:**
- Consumes: Hugo front matter conventions from existing files in `content/posts`; measured values and disclosure rules from `docs/superpowers/specs/2026-07-18-homelab-power-optimization-blog-design.md`.
- Produces: One publishable Hugo content page at `/posts/2026-07-18-homelab-power-optimization/`.

- [ ] **Step 1: Confirm that the target path does not already exist**

Run:

```bash
test ! -e content/posts/2026-07-18-homelab-power-optimization.md
```

Expected: exit status 0 with no output.

- [ ] **Step 2: Create the complete article**

Create `content/posts/2026-07-18-homelab-power-optimization.md` with exactly this initial draft:

````markdown
---
title: "给两台 PVE 主机降功耗：一次 HomeLab 节能优化实录"
date: 2026-07-18T00:00:00+08:00
draft: false
tags: ["HomeLab", "Proxmox VE", "节能", "UPS"]
---
## 为什么要折腾功耗

我家里目前有四台长期在线的物理设备：运行 OpenWrt 的 Sol、运行 TrueNAS 的 Saturn，以及两台 Proxmox VE 主机 Mars 和 Jupiter。Mars 是一台带 RTX 4060 的游戏本，Jupiter 则是一台装有多块 NVMe、万兆网卡和 Tesla P4 的台式机。

整套 HomeLab 的功耗一度接近 200W。这个数字放在机房里不算什么，但放在家里 24 小时运行，一年就是大约 1750 度电，还会变成持续的热量和风扇噪声。所以我决定从最容易控制的两台 PVE 主机开始排查。

这次优化最后得到的不是一个“神奇参数”，而是一套很朴素的方法：先建立基线，再一次只改变一个变量，最后一定要重启验证。

## 先搞清楚 UPS 的数字

我的 APC UPS 标称有功功率是 390W，NUT 暴露的 `ups.load` 是整数百分比。因此可以粗略认为：

\[
1\% \approx 3.9\text{W}
\]

例如 31% 大约对应 121W。不过这只是整套 UPS 下游设备的估算值，里面还包括光猫、AP、软路由和 NAS，并不是某一台 PVE 的功耗。

```bash
upsc ups@nas.local ups.load
```

另外，UPS 数据大约每 30 秒才刷新一次。刚关闭一个 VM 时，读数可能不降反升；连续采样几分钟后才能看到真实趋势。后面的每个结论，我都尽量结合三类信息判断：UPS 负载、宿主机实时 CPU，以及 RAPL 的 CPU Package 功耗。

RAPL 只统计处理器封装，也不能当作墙上功耗。主板、内存、硬盘、网卡和显卡都不在这个数字里。

## 先优化 Mars：一台带独显的 PVE 笔记本

只保留 Sol、光猫、AP 和 Saturn 时，UPS 负载约为 17%。最初打开 Mars 后，读数会来到 23% 到 29%。对于一台没有运行来宾的笔记本，这显然偏高。

Mars 使用 `amd-pstate-epp`。我把所有 CPU policy 从 `performance` 改成 `powersave`，并把 Energy Performance Preference 改为 `balance_power`：

```bash
for p in /sys/devices/system/cpu/cpufreq/policy*; do
    echo powersave > "$p/scaling_governor"
    echo balance_power > "$p/energy_performance_preference"
done
```

这里的 `powersave` 并不是把 CPU 锁死在最低频率。对于 `amd-pstate-epp` 和 `intel_pstate`，CPU 仍然会根据负载升频，只是空闲和轻载时不再一直偏向最高性能。

Mars 的 RTX 4060 平时不需要由宿主机使用，所以让 PCIe 设备进入 Runtime PM：

```bash
echo auto > /sys/bus/pci/devices/0000:01:00.0/power/control
cat /sys/bus/pci/devices/0000:01:00.0/power/runtime_status
```

空闲时应当看到 `suspended`。如果把 4060 直通给 Windows VM，VM 启动后显卡会变成 `active`；关闭 VM 后，它才能再次休眠。这正好实现“随开随用”，但显卡被 VM 占用期间的功耗无法由宿主机消除。

最后把笔记本内屏背光关掉：

```bash
echo 4 > /sys/class/backlight/nvidia_wmi_ec_backlight/bl_power
```

不同笔记本的背光设备路径可能不同，需要先查看 `/sys/class/backlight/`。

为了让设置在重启后继续生效，我建立了下面的服务：

```ini
# /etc/systemd/system/mars-power-tune.service
[Unit]
Description=Mars idle power tuning
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo auto > /sys/bus/pci/devices/0000:01:00.0/power/control'
ExecStart=/bin/sh -c 'for p in /sys/devices/system/cpu/cpufreq/policy*; do echo powersave > "$p/scaling_governor"; echo balance_power > "$p/energy_performance_preference"; done'
ExecStart=/bin/sh -c 'echo 4 > /sys/class/backlight/nvidia_wmi_ec_backlight/bl_power'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now mars-power-tune.service
```

优化后 Mars 开机、没有运行来宾时，整套 UPS 仍维持在 17% 到 18%。这不代表 Mars 的功耗是零，只能说明它的增量已经接近 UPS 整数读数的分辨率。

## 再看 Jupiter：先测宿主机，再测来宾

Jupiter 的情况复杂得多。我先关闭全部 VM 和 LXC，只测宿主机，然后逐个启动来宾并等待读数稳定。

纯宿主机状态下，CPU Package 最低约 6.1W；但 UPS 增量仍明显高于这个数字。检查 PCIe 链路后发现，Tesla P4、使用 MAP1602 控制器的 NVMe、ConnectX-3 网卡等设备缺少理想的 ASPM 省电状态，再加上多块 NVMe，这些硬件构成了无法靠 CPU 调频消除的功耗下限。

逐个启动全部来宾后，CPU Package 从约 6.1W 上升到约 12.6W，整套 UPS 稳态通常只增加几个百分点。这说明“大量空闲 VM/LXC”确实有成本，但不是最初接近 200W 的唯一解释。真正昂贵的是来宾里面的实际任务，以及被唤醒的直通硬件。

Jupiter 使用 `intel_pstate`，CPU 调整方式与 Mars 相同：

```ini
# /etc/systemd/system/jupiter-power-tune.service
[Unit]
Description=Jupiter idle power tuning
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for p in /sys/devices/system/cpu/cpufreq/policy*; do echo powersave > "$p/scaling_governor"; echo balance_power > "$p/energy_performance_preference"; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now jupiter-power-tune.service
```

我没有把关闭睿频写进这套通用配置。是否限制最高性能需要根据业务延迟和峰值性能单独决定，不能因为追求一个更低的空载数字就一刀切。

## 为什么重启后突然冲到 50% 甚至 60%

持久化调频后，我重启了 Jupiter。UPS 不但没有立刻下降，反而冲到了 50% 以上，后续联合重启 Mars 和 Jupiter 时还出现过 60% 的峰值。

一开始我怀疑是优化脚本或者残留进程，但完整检查后没有发现自定义定时任务、测量脚本或后台循环。真正的问题是：Jupiter 上几乎全部来宾都配置了 `onboot: 1`，开机时 14 个 VM 和 7 个 LXC 同时启动。

那一刻并不存在所谓“空载”：Windows、EVE-NG 和其他大量 VM/LXC 都在做初始化。EVE-NG 启动时一度占满 8 个核心，宿主机侧看到约 800% CPU；Windows 也会同时唤醒直通的 Tesla P4。

期间还遇到过一次很隐蔽的异常：duo 在启动时报告某个 vCPU 唤醒失败。虚拟机内部对应 CPU 离线，看起来几乎空闲，但宿主机上的 KVM vCPU 线程一直占满一个核心。关闭 duo 后，CPU Package 从约 31W 降到了约 22W。下一次重启时它的 6 个 vCPU 又全部正常上线，异常没有复现。

这也说明，判断虚拟机功耗不能只看来宾内部的 `top`。至少要同时看宿主机上的 KVM 线程：

```bash
top -H -p "$(cat /var/run/qemu-server/VMID.pid)"
```

对于 EVE-NG 这类实验环境、带 GPU 的 Windows，以及不需要全天运行的开发集群，更合理的做法是取消自动启动或配置启动延迟，而不是让所有来宾在宿主机开机后争抢资源。

## 最终结果

下面的 UPS 百分比都是整套设备读数，按 390W 标称有功功率换算的瓦数只用于帮助理解量级。

| 阶段 | UPS 负载 | 近似整套功耗 | 说明 |
| --- | ---: | ---: | --- |
| Sol、光猫、AP、Saturn，加优化后的空闲 Mars | 17%–18% | 66W–70W | Mars 的 4060 已休眠 |
| Jupiter 宿主机上线、来宾关闭 | 约 30% | 约 117W | PCIe 和多块 NVMe 构成硬件下限 |
| Jupiter 全部来宾启动后的稳态 | 31%–34% | 121W–133W | CPU Package 最终约 12W |
| Mars 与 Jupiter 同时重启的启动峰值 | 60% | 约 234W | 14 个 VM 和 7 个 LXC 同时初始化 |

联合重启后，我以 20 秒间隔监控了约 10 分钟。UPS 从 60% 逐步回落到 56%、48%、40%，最后连续稳定在 31% 左右；两台机器的 `powersave + balance_power` 都在重启后自动恢复，Mars 的 4060 也回到了 `suspended`。

因此，这一轮优化解决了长期空闲时的浪费，但没有、也不应该消灭启动和实际业务带来的峰值。下一步如果还要继续优化，重点会是给重型来宾设置启动顺序，并把 Windows、EVE-NG 和实验集群改成真正的按需启动。

## 这次排查留下的经验

1. **不要相信单次 UPS 读数。** 先确认刷新周期，连续采样，再比较稳定平台。
2. **不要混用测量口径。** UPS 是整套设备，RAPL 只是 CPU Package，`top` 只说明计算负载。
3. **空载 VM 不等于没有成本，但实际任务更重要。** 与其纠结每个空闲来宾的一两瓦，不如先找持续占满核心和唤醒显卡的任务。
4. **省电配置必须经过重启验证。** 手动 `echo` 生效不代表下次开机仍然生效，systemd oneshot 服务简单而可靠。
5. **独立显卡适合按需直通。** 不用时让 VM 关闭、显卡 Runtime Suspend；需要时再启动 VM。
6. **开机峰值要靠调度解决。** 调频策略不能解决 21 个来宾同时初始化，应该使用启动延迟或取消不必要的 `onboot`。

HomeLab 降功耗并不是把所有设备都限制在最低性能，而是让“没有工作的时候真正休息，有工作的时候正常干活”。这比追求某个漂亮但不可持续的瞬时数字更有意义。
````

- [ ] **Step 3: Run privacy and content checks**

Run:

```bash
test "$(rg -o '10\.0\.0\.[0-9]+' content/posts/2026-07-18-homelab-power-optimization.md | wc -l | tr -d ' ')" = "0"
rg -n 'powersave|balance_power|suspended|800%|31%–34%|60%' content/posts/2026-07-18-homelab-power-optimization.md
```

Expected: the first command exits 0; the second prints matching lines for every required technical claim.

- [ ] **Step 4: Commit the article**

```bash
git add content/posts/2026-07-18-homelab-power-optimization.md
git commit -m "content: add homelab power optimization post"
```

Expected: one commit containing only the new post.

### Task 2: Validate the rendered site

**Files:**
- Verify: `content/posts/2026-07-18-homelab-power-optimization.md`
- Generated and ignored: `public/posts/2026-07-18-homelab-power-optimization/index.html`

**Interfaces:**
- Consumes: the Hugo content page created in Task 1 and the existing repository theme submodule.
- Produces: a verified rendered page with title, table, math, and highlighted code blocks.

- [ ] **Step 1: Confirm the required Hugo version is available**

Run:

```bash
hugo version
```

Expected: output reports Hugo `v0.161.1` or a newer compatible extended build.

- [ ] **Step 2: Build the production site**

Run:

```bash
hugo --minify
```

Expected: exit status 0 with no error-level messages.

- [ ] **Step 3: Inspect the generated article**

Run:

```bash
test -s public/posts/2026-07-18-homelab-power-optimization/index.html
rg -n '给两台 PVE 主机降功耗|mars-power-tune|jupiter-power-tune|234W' public/posts/2026-07-18-homelab-power-optimization/index.html
```

Expected: the HTML file is non-empty and contains all four rendered markers.

- [ ] **Step 4: Verify the repository handoff state**

Run:

```bash
git status --short
git log -2 --oneline
```

Expected: no tracked working-tree changes; the latest commits are the article commit and the implementation-plan commit.
