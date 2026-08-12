# Phase 5 Spike 总结

> 日期：2026-07-26 至 2026-08-03。模型：Kimi `k3`（`api.kimi.com/coding/v1`）；生图：Seedream 5.0（Ark）。
> 浏览器：Playwright + 系统 Chrome（`channel="chrome"`）。
> 每项详情见各子目录 `RESULT.md`。**审美类结论一律留给人工审核，见 `review.html`。**

## 结果总览

| # | 假设 | 结论 | 关键数据 | 报告 |
|---|---|---|---|---|
| **D1** | 工具调用在长会话中可靠 | ✅ **通过** | 120 次调用 **0 格式错误**；20/20 完成；故障恢复 100% | `d1-agent-loop/` |
| **D6** | 图像输入能力可绑定 | ✅ **通过** | `k3`/`k3-256k` 支持；**`kimi-for-coding` 不支持且静默返回空** | `d6-capability/` |
| **E6** | 工作区+history 续跑省事 | ✅ **通过** | 省 26–34%；**0 次重复劳动**（9 组 18 路径） | `e6-resume/` |
| **E3/D7** | 仓库事实一致性 | ✅ **通过** | **0 矛盾**；严格口径 94.3%、宽松 100% 可回溯 | `e3-repo-facts/` |
| **Q7** | mock 可确定性检出 | ✅ **通过** | 检出 4/4；**误报 0**（纯静态对照 0 信号） | `e4-mock/` |
| **D3** | contract 抽取稳定 | ✅ **通过（有前提）** | 计算后样式 8/8 且 3× 确定性；**源码正则 0/8 全失效** | `q1-checks/` |
| **A2** | 隔离渲染可行 | ✅ **通过** | 外链阻断可采集；1GB 内存够、150MB 不够 | `e1-sandbox/` |
| **E4** | mock 把交互跑通 | ✅ **通过并冻结（引擎兜底）** | 首轮完全可交互 3/8；40k 流式 6/6 无截断，mock 检出 4/4、0 误报 | `e4-mock/` |
| **E5** | 真实后端沙箱启动 | ✅ **通过并冻结** | zero-capability 后端经 trusted loopback/spool broker 完成 GET/POST；文件/env/进程边界全通过 | `e5-real-backend/` |
| **Q8** | 矛盾可自动复核 | ✅ **通过（本次注入范围）** | primary 检出 4/4、漏报 0%；closed_world 3/4；自然样本误报 0/70 | `e3-repo-facts/` |
| **E7** | 预算够用 | ✅ **预算策略冻结** | 20/20 简单页完成；`60/250k/900s/3 renders` 冻为首版 profile，分布校准后续优化 | `d1-agent-loop/` |
| **E1** | Windows 沙箱能隔离文件/网络 | ✅ **通过（AppContainer）** | Job Object 路线 6/6 逃逸；**AppContainer 路线全部拦截**，网络含裸 IP 亦被 OS 拒绝，无需管理员 | `e1-sandbox/ADDENDUM-appcontainer.md` |
| **D4/D5** | Seedream 可控性与权利条款 | ⚠️ **部分** | D4：4/4 尺寸匹配且两种风格可辨；D5：公开条款不足以确认客户交付授权，维持 `ANALYSIS_ONLY` | `d4-seedream/` |
| **A3** | 局部编辑事后验证成立 | ✅ **通过（有边界，n=20）** | 四项 `all_pass` 19/20；锚点/contract/渲染健康 20/20，视觉隔离 19/20；真实越界影响被正确拦截 | `a3-render/` |
| **A4/A5/A6** | 交付化/导出/交互一致性 | ✅ **通过** | A4：10/10 diff≤0.002；A5/Q6：54/54 文件 hash、10/10 重渲染一致；A6：声明路径 5/5 | `a3-render/` |
| **Q1/Q4** | 硬检查检出率 / 漂移误报率 | ✅ **通过（受控 fixture）** | Q1：12/12 检出、0/42 类别误报；Q4：6/6 漂移检出、0/8 control 误报 | `q1-checks/` |
| **E2** | 看截图后自主发现并修复视觉问题 | ✅ **人工审核通过并冻结** | 4/4 候选实际修复；9 轮截图，最终均零 console/failed request/page error/overflow | `d2-aesthetic/` |
| **D2/Q2/Q3** | 候选审美与 critic 稳定性 | 🔒 **候选排序未裁决** | 4 个候选；Q2 15 条发现；Q3 20 次重复评估 | `d2-aesthetic/review.html` |
| **E12** | 框架候选预算内完成 | 🔒 **已知风险接受并冻结** | Kimi 会话 1,082s 且未完成自验；不再重测，超时如实失败 | `e8-e12-framework/` |
| **E13** | 门控安装可行且可审计 | ✅ **通过并冻结** | agent 网络拒绝；trusted broker + zero-cap installer 成功，hash/ledger/key 隔离全通过 | `e13-gated-install/` |
| **P6-C** | 八槽真实纵切闭环 | ✅ **通过** | readiness 8/8；AppContainer/build/Kimi/Chrome；ZIP 重渲染；Quality PASS；恢复后单次 Delivery | `phase6-closure/` |

## 三个最重要的发现

### 1. E1：Windows 原生沙箱**成立**，用 AppContainer（初判被推翻）

首轮结论是「必须上 Docker/WSL2」。**追加实验推翻了它。**

首轮只测了 Job Object——它从设计上就不提供文件/网络命名空间隔离，所以「6/6 文件逃逸」是必然，
不能推广为「Windows 做不到」。首轮的 AppContainer 探针则败在试图启动 `python.exe`
（Python 安装目录无 AppContainer ACE），而 `System32` **本来就**授予 `ALL APPLICATION PACKAGES`
读+执行，换成系统自带二进制即可启动。

零 capability AppContainer 实测：

| 探针 | 结果 |
|---|---|
| 读容器内工作区 / 写容器内工作区 | ✅ 允许 |
| 读仓库外部文件 / 读用户主目录 / 写容器外 | ✅ **全部拒绝** |
| `curl` 域名 / `curl` **裸 IP** / `ping` | ✅ **全部拒绝**（`Unable to contact IP driver`） |

关键设计点：**工作区必须放在 AppContainer 自己的包目录**
（`%LOCALAPPDATA%\Packages\<profile>\AC\`，OS 自动 ACL）。放在任意路径再授权叶子目录会失败——
AppContainer 需要路径上每一级祖先都有 traverse 权限。

运行时 bootstrap 也已验证：**复制进包目录的二进制可正常执行**。

**结论：AppContainer（文件+网络）× Job Object（进程+内存+时间）× 白名单 env（凭据），
纯 Windows 原生、零管理员、不需要 Docker/WSL2。** 这正是 Chromium 自己的 Windows 沙箱做法。

> 附带安全发现：本机 shell 环境**当下就挂着多个其他工具的真实 API key**
> （`DEEPSEEK_API_KEY`、`GITEE_TOKEN` 等）。naive 的 `os.environ.copy()` 会整包泄漏给子进程。
> spec「凭据永不进工作区」必须用**白名单从空白构建 env**实现，禁止黑名单减法。

### 2. D3：抽取方式不能留白，源码正则在真实产物上全军覆没

8 个 agent 真实产出的多文件项目，源码正则抽出的颜色/字号/间距**全部为 0**——因为 CSS 在独立
`styles.css` 里。计算后样式路径 8/8 成功且 3× 字节级确定。

spec §3 只说「确定性、不调模型」，源码正则**同样满足这个描述**却完全不可用。必须写死为
「基于真实渲染的计算样式」。

附带发现：**锚点也必须从渲染后 DOM 取**——产物用 mock 在运行时生成的带锚点元素不在静态源码里，
两种口径差异最大 +15 个锚点。口径不统一会让 Quality 的契约比对产生双向假警报。

### 3. E4：mock 未声明的根因是输出截断，不是模型想隐瞒

run-03 与 run-05 的 completion token **正好都撞满 16,000 上限**，而它俩恰好就是缺 `MOCK.md` 的
那两个。修复方向因此不是「别信模型自觉」，而是**先给足 token 预算 + 检测截断**，
再叠加确定性检出兜底。

## 需要修正的既有判断

**「reasoning token 会让预算严重低估」——实测不成立。** reasoning 中位数仅占总量 1.1%
（D1，n=20）。此前的印象来自一次「回复 OK」的极短冒烟测试（67%），是特例。

真正的成本大头是 **prompt 累积**：prompt : completion ≈ **6.7 : 1**，因为 agent 循环每轮都要
重发完整历史。E6 也印证了这点——续跑省下的是执行，不是上下文，所以收益封顶在 ~34%。

**推论**：压 agent 成本的主要手段是 **prompt caching**（endpoint 已支持并观察到命中），
不是细粒度 checkpoint。这支持了 `agent-engine-spec.md` §7「不改 Phase 2 契约」的决定。

## 待办

1. **D5 权利拍板**——公开条款不足以确认客户交付/再许可，当前保持 `ANALYSIS_ONLY`
2. **候选审美排序**——E2 已审核通过；若要给 D2 候选排序，再打开 `d2-aesthetic/review.html`
3. **A3 作用域策略拍板**——n=20 的 1 次视觉失败证明合法的作用域内文案可经居中布局影响外部；建议失败后扩大到最近布局容器重试，而非放宽阈值
4. 全部 spike 已有终态；后续规范与 ADR 由用户另行决定，本轮不写 ADR、不启动 Phase 6

## 方法说明：本轮 spike 的安全约束

沙箱可行性（E1）结论未出之前，**所有涉及模型输出的 spike 一律不真实执行模型产生的 shell 命令**。
D1 的 `run_command` 是模拟工具（返回预设文本，实现里不出现 `subprocess`/`eval`/`exec`）。
E1 事后证明这个顺序是对的：Windows 原生方案确实拦不住文件与网络逃逸。

**协议可靠 ≠ 可以放心让它跑命令**——D1 与 E1 必须合起来读。
