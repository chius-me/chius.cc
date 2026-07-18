---
title: "给 HomeLab 降降功耗"
date: 2026-07-18T00:00:00+08:00
draft: false
tags: ["HomeLab", "Proxmox VE", "节能", "UPS"]
---
最近看了一眼 UPS，家里这套东西加起来已经快 200W 了。

现在一共有四台物理机：OpenWrt 软路由 Sol、TrueNAS Saturn，还有两台 PVE，Mars 和 Jupiter。光看数量好像也不算特别夸张，但这些机器一天到晚开着，200W 就有点肉疼了，房间里还会多一个稳定的热源。

反正先关机再说。

## 先看 Mars

我先关掉 Jupiter，又把 Mars 也关掉。此时 UPS 上只剩光猫、AP、Sol 和 Saturn，负载是 17%。

再打开 Mars，读数开始在 23% 到 29% 之间跳。一台没有运行任何 VM 的笔记本搁那吃掉几十瓦，感觉不太对。

Mars 是一台带 RTX 4060 的游戏本。CPU 用的是 `amd-pstate-epp`，重启后默认跑在 `performance`。先把所有 policy 调成 `powersave + balance_power`：

```bash
for p in /sys/devices/system/cpu/cpufreq/policy*; do
    echo powersave > "$p/scaling_governor"
    echo balance_power > "$p/energy_performance_preference"
done
```

名字虽然叫 `powersave`，但有负载时还是会正常升频，不是把 CPU 锁死在最低频率。

4060 平时直通给 Windows，需要的时候再开 VM。VM 没开时，让宿主机把显卡挂起：

```bash
echo auto > /sys/bus/pci/devices/0000:01:00.0/power/control
cat /sys/bus/pci/devices/0000:01:00.0/power/runtime_status
```

状态很快变成了 `suspended`。最后再关掉笔记本自己的屏幕背光：

```bash
echo 4 > /sys/class/backlight/nvidia_wmi_ec_backlight/bl_power
```

这些东西手动敲一遍当然有用，但重启就没了，于是加了一个 systemd 服务：

```ini
# /etc/systemd/system/mars-power-tune.service
[Unit]
Description=Mars idle power tuning

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

做完以后，Mars 开机但不运行来宾时，UPS 还是 17% 到 18%。当然不可能真的是零功耗，只是变化已经小到 UPS 的整数读数不太看得出来了。

这里也被 UPS 坑了几次。它大概几十秒才刷新一次，刚关掉一个东西，数字可能不降反升。我的 UPS 标称有功功率是 390W，1% 差不多是 3.9W，但这个百分比只能拿来看整套设备的大概趋势，没法精确算出某个 VM 吃了几瓦。

## Jupiter 就没这么简单了

Jupiter 不是笔记本，里面塞了 Tesla P4、ConnectX-3、好几块 NVMe，还有两块傲腾拿来做 swap。我先把所有 VM 和 LXC 都关掉，只留 PVE 宿主机。

CPU Package 最低能到 6.1W，不过整机显然不止这些。P4、MAP1602 主控的 NVMe、ConnectX-3 都没有很理想的 ASPM 状态，主板、内存和一堆 PCIe 设备的功耗也不在 RAPL 里面。Jupiter 纯宿主机开着时，整套 UPS 已经到了 30% 左右。

接下来我把 VM 和 LXC 一个个打开，每开一个就等 UPS 刷新。全部来宾空闲挂着时，CPU Package 大概 12.6W，UPS 多数时间在 31% 到 33%。所以这些空闲来宾确实会吃一点，但没有我一开始想得那么夸张。

Jupiter 用的是 `intel_pstate`，CPU 部分和 Mars 一样。我也给它放了一个开机服务：

```ini
# /etc/systemd/system/jupiter-power-tune.service
[Unit]
Description=Jupiter idle power tuning

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

我没有顺手把睿频也关掉。平时没活的时候降下来就行，真有任务时还是希望它赶紧跑完。

## 重启以后怎么反而 50% 了

持久化以后重启 Jupiter，UPS 直接冲到了 50% 多。

我第一反应是前面测试时是不是扔了一堆脚本在宿主机上，甚至把 `/root`、`/tmp`、systemd unit 和 crontab 都翻了一遍。最后什么都没找到，也没有残留的测量进程。

再看 PVE，原因其实很朴素：几乎所有来宾都是 `onboot: 1`。宿主机起来以后，14 个 VM 和 7 个 LXC 一窝蜂启动，根本不是什么“空载”。Windows 在启动，直通的 P4 也跟着变成 `active`；EVE-NG 最夸张的时候占了接近 800% CPU。

中间还碰到一个比较神秘的问题。duo 启动时有一个 vCPU 没唤醒成功，虚拟机里面对应的 CPU 是离线的，看起来已经闲下来了，但宿主机上的 KVM 线程一直占满一个核心。

当时 `ps` 里 duo 一度显示 500% 左右，我后来才发现那是从启动到现在的累计平均值。用 `top -H` 看线程，真正还在烧的是 `CPU 1/KVM`：

```bash
top -H -p "$(cat /var/run/qemu-server/189.pid)"
```

关掉 duo 后，CPU Package 从 31W 左右掉到了 22W。下一次重启它又正常了，6 个 vCPU 全部在线，这个问题暂时没有复现。

## 暂时先这样

最后我把 Mars 和 Jupiter 一起重启，又盯了十分钟 UPS。

刚开始所有来宾一起启动，峰值到过 60%，差不多是 234W。后面一路从 56%、48%、40% 往下掉，最后连续几次停在 31% 左右。Jupiter 的 CPU Package 这时大约 12W，Mars 的 4060 也重新回到了 `suspended`。

现在日常稳态大概就是 31% 到 34%，比最开始好不少。启动时那一大坨峰值还在，不过调频解决不了 21 个来宾同时开机。之后准备把 Windows、EVE-NG 和 duo 改成按需启动，剩下的再排一下 `onboot` 顺序。

这次先折腾到这里。
