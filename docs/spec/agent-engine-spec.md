# Agent 引擎内部规范

> 状态：v0.2 草案，待审核。
> v0.2 依据 spike E1/E4/E6/E7 实测重写 §8（沙箱：改为 AppContainer + Job Object）、
> §9（预算：主成本是 prompt 累积；输出撞顶必须判失败）、§10（mock 声明改为引擎强制）。
> 上位规范：`architecture.md` §11/§12/§14.1/§17、`system-spec.md` §6.3/§6.6、
> `implementation-plan.md` §6（`isolated-execution/`、`capability-boundary/`）。
> 范围：工作区、工具目录、agent 循环、自验证闭环、session 续跑、沙箱分级与预算。
> 首个垂直媒介：Web。首个真实场景：本仓库 → agent 前端页（含自造 mock 后端）。

## 1. 目的与边界

`architecture.md` §11 把「创作负责人」定义为**统筹**候选整体的角色，§12 要求「能力强的模型可以
获得更开放的创作空间和**更直接的工作区工具**」。本规范提供这个工作区和这套工具。

引擎不是流水线。它不规定模型按什么步骤工作，只提供环境、工具、反馈和边界。模型在阶段内部
如何探索、返工、重构、试错，由模型自己决定。

`system-spec.md` §6.3 是本规范的授权依据：

> 模型探索可以发生在阶段内部，但不能绕开 workflow 直接改变项目真源。

本规范不改变任何 port 的方法签名，不改变 Project 状态机，不定义设计质量标准，不定义媒介产物
结构。它也不决定具体的 agent 框架——那是 ADR-0004 的事。

## 2. 核心原则：沙箱内最大自由，边界上严格纪律

外层流水线（Project 状态机、revision、审批、交付门）存在的理由是**可恢复性与可信交付**，不是
限制模型。两者不在同一高度：

```text
┌─ Control Plane / Workflow ────────────────────────────┐
│  revision · approval · 状态机 · 交付门   ← 纪律       │
│                                                        │
│   ┌─ Stage ──────────────────────────────────────┐    │
│   │  ┌─ Agent Workspace ─────────────────────┐   │    │
│   │  │  文件随便建 · 命令随便跑 · 服务随便起 │   │    │
│   │  │  截图自己看 · 问题自己修 · 不逐步监督 │   │ ← 自由
│   │  └───────────────────────────────────────┘   │    │
│   │         ↓ 只有产出物经 port 出去              │    │
│   └──────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

具体规则：

- 工作区内的一切**不需要**逐步审批。建文件、删文件、重构、跑构建、起本地服务，都是模型的自由。
- 工作区外的一切**必须**过门：网络访问、写用户仓库、发布、外部发送、高成本调用。
- 进入项目真源的**只有**经 port 返回的产出物，由 Control Plane 验证后提交。
- 工作区不是项目真源。工作区可以被丢弃重建；项目状态不能。

## 3. Workspace

一个 Project-scoped 的持久目录，agent 在其中拥有完全读写权。

```text
<data_root>/workspaces/<project_id>/<workspace_id>/
  repo/          只读挂载的用户仓库（如有）
  work/          agent 的自由领地
  out/           声明为产出的部分
  .agent/        turn history、工具日志、预算账本
```

规则：

- 工作区**必须**跨进程重启存活。它在磁盘上，不在内存里，也不在模型会话里。
- `repo/` **必须**只读。agent 想改用户仓库的内容，先复制到 `work/`。
- `out/` 是 agent 声明「这是我的产出」的位置。port 从这里取结果，不扫描整个工作区。
- 工作区**必须**限定在应用数据根内，路径解析不得逃逸（沿用 ADR-0001 与 `paths.py` 的既有约束）。
- 一个 Project 可以有多个工作区（例如多个候选并行创作）。工作区之间**不共享**，这是不变量 4
  「候选责任统一」在实现层的形式。
- 工作区**必须**可被丢弃。丢弃工作区不损失任何已提交的项目状态。

`system-spec.md` §5 的核心项目域表需要增加 Agent Workspace 与 Agent Session 两个概念身份，
见 §12。

## 4. 工具目录

工具按副作用分三级。**级别决定是否需要门，不决定模型是否自由使用。**

### 4.1 L0 无副作用（自由使用）

| 工具 | 说明 |
|---|---|
| `read_file` | 读工作区内文件 |
| `list_files` | 列目录 |
| `search` | 工作区内内容检索 |
| `read_repo` | 读只读挂载的仓库 |

### 4.2 L1 工作区内副作用（自由使用）

| 工具 | 说明 |
|---|---|
| `write_file` | 写工作区内文件 |
| `delete_file` | 删工作区内文件 |
| `run_command` | 在沙箱内执行命令，无网络 |
| `start_dev_server` / `stop_dev_server` | 在沙箱内起停本地服务，仅回环可达 |
| `render` | 用真实浏览器加载工作区产物 |
| `screenshot` | 取指定视口截图 |
| `read_console` | 读渲染时的 console 与网络错误 |

`render` / `screenshot` / `read_console` 是引擎的核心价值所在，见 §6。

### 4.3 L2 外部副作用（需要门）

| 工具 | 门 |
|---|---|
| `fetch_network` | 默认**关闭**。依赖安装、外部 API 调用需显式策略放行 |
| `generate_image` | 计入生图预算，受成本上限约束 |
| `write_user_repo` | 需用户显式批准，本轮**不实现** |
| `start_real_backend` | 需用户显式批准 + 沙箱 spike 通过，本轮**不实现**（见 §10） |
| `publish` / `deploy` | 走 Control Plane 审批与 side-effect ledger，不由 agent 直接调用 |

规则：

- 工具目录**必须**按能力实例裁剪。`architecture.md` §12：结构化输出更稳定的小模型可以拿到更窄
  的工具集，强模型拿到完整工具集。工具集是 harness 的一部分，不是全局常量。
- 每次工具调用记录到 `.agent/`，但**不记录**文件正文与 prompt（`runtime-recovery.md` §8 的
  allowlist 约束）。
- 工具返回的错误是**给模型看的信息**，不是立即终止的理由。命令失败、渲染报错、测试不过，
  都应让 agent 有机会自己修。

## 5. Agent 循环

```text
输入：目标 + 约束快照 + 工作区 + 工具集 + 预算
  │
  ▼
┌─────────────────────────────────┐
│ agent 自主循环                   │
│  想 → 用工具 → 看结果 → 再想     │  ← 不逐步监督
└─────────────────────────────────┘
  │
  ▼
终止条件（任一）：
  · agent 自认完成且自验证通过
  · 预算耗尽（token / 步数 / 时长 / 生图次数）
  · 硬失败（沙箱违规、确定性错误）
  · 外部取消（Control Plane cancel）
  │
  ▼
输出：out/ 中的产出 + 自验证报告 + 预算账本
```

规则：

- 引擎**不得**要求 agent 按固定步骤工作。目标与验收标准是输入，路径由 agent 决定。
- 引擎**不得**在中途否决 agent 的中间状态。工作区里的半成品、失败尝试、被推翻的方案都是正常的。
- agent 自认完成时**必须**先跑自验证（§6）。自验证不过就继续修，直到过或预算耗尽。
- 预算耗尽而自验证未过时，**必须**如实返回「未达成 + 当前状态 + 剩余问题」，**不得**把未完成
  的产物报告为完成。
- 取消**必须**能在循环中途生效，工作区保留以便诊断。

## 6. 自验证闭环

这是引擎存在的主要理由。没有它，模型只能盲写代码。

```text
agent 写代码 → render → screenshot + console + 视口信息
                  │
                  ▼
            agent 自己看结果
                  │
        ┌─────────┴─────────┐
      有问题              没问题
        │                   │
     自己修               声明完成
        │
     回到 render
```

规则：

- agent **必须**能拿到真实渲染结果，而不是自己想象页面长什么样（`architecture.md` §3.6）。
- 自验证的最低门槛（引擎强制，不依赖 agent 自觉）：产物能被真实浏览器加载、无 console error、
  无未加载资源。达不到就不算完成。
- 自验证的上层判断（是否好看、是否达成目标）由 agent 自己做。引擎不替它判断，Quality 层在阶段
  之后独立判断（`quality-governance-spec.md`）。
- 自验证的循环次数计入预算。

## 7. Session 持久化与续跑

**不改 Phase 2 的 stage checkpoint 契约。** `runtime-recovery.md` §4 的粒度是 stage，而 agent
循环是 stage 内部过程。把每轮工具调用做成 sub-checkpoint 会把 agent 的执行模型污染进 workflow
契约。

改为：

- **工作区本身是持久的**（§3），文件已经在磁盘上；
- **Agent Session 的 turn history 单独持久化**在 `.agent/` 与项目存储中；
- stage 因进程重启而重入时，agent 从**工作区现状 + turn history** 续跑，而不是从零重来；
- 预算账本一并持久化，续跑不重置预算。

`runtime-recovery.md` §4「没有完成标记的阶段可以按错误与 retry policy 重新执行」在语义上已经
允许这种续跑——本规范只是让重新执行不浪费已完成的工作。

Agent Session 需要独立身份才能被引用与恢复，见 §12。

## 8. 沙箱与权限分级

沿用 `system-spec.md` §6.6 与 `architecture.md` §17。下表的「实现机制」列是 spike E1 的实测结论，
不是设计意向：

| 维度 | 默认 | 实现机制（已实测） |
|---|---|---|
| 文件根 | 限定在本工作区，路径逃逸即硬失败 | **AppContainer**（Job Object 无效，见下） |
| 网络 | **默认关闭**，L2 门控放行 | **AppContainer 零 capability**（OS 强制） |
| 进程 | 数量与生命周期受限，随 session 结束回收 | **Job Object** + `TerminateJobObject` |
| 时间 | 单次工具调用与整个 session 分别有上限 | Job Object |
| 内存 / 输出 | 有上限，超限截断并告知 agent | Job Object + 有界采集 |
| 凭据 | **永不进入工作区** | **白名单从空白构建 env** |

规则：

- 生成代码与用户仓库内容一律按**不可信输入**处理。
- 沙箱违规是硬失败，不是可重试错误。
- 沙箱边界**不得**被用来绕过 Control Plane 的审批与审计（`system-spec.md` §6.6）。

### 8.1 实测得出的硬性实现约束

以下四条来自 spike E1 的实测，**不是建议**，违反其中任何一条都会让对应维度的隔离失效：

1. **文件与网络隔离必须由 AppContainer 承担，不能只靠 Job Object。**
   实测：Job Object + 干净 env 下，`..\`、绝对路径、junction、UNC、`\\?\` 六类文件逃逸
   **全部成功**，与完全无防护的裸 `subprocess` 结果一模一样。Job Object 从设计上不提供文件系统
   或网络命名空间隔离。

2. **工作区必须放在 AppContainer 自己的包目录**
   （`%LOCALAPPDATA%\Packages\<profile>\AC\`），由 OS 自动 ACL。
   **不得**把工作区放在任意路径再对叶子目录授权——AppContainer 需要路径上**每一级祖先**都有
   traverse 权限，只授叶子会导致连自己的工作区都读不到（实测踩过）。

3. **网络关闭通过「零 capability」实现，不通过代理环境变量或防火墙规则。**
   实测：代理环境变量只能挡住「守规矩」的代码，raw socket 与裸 IP 直接绕过；按路径限定的防火墙
   规则需要管理员权限。零 capability 的 AppContainer 连 `ping 1.1.1.1` 都会得到
   `Unable to contact IP driver`——这是 OS 网络栈层面的拒绝。

4. **凭据隔离必须用白名单从空白构建 env，禁止 `os.environ.copy()` 后做减法。**
   实测：开发机的 shell 环境里当下就挂着多个不相关工具的真实密钥变量，黑名单式减法不可能穷举。
   白名单同时要按「该工具实际需要什么系统变量」配置——实测把 `PROGRAMFILES`/`LOCALAPPDATA`
   一并剥掉会导致 Playwright 找不到浏览器。

### 8.2 已知限制（实测，写明以免误解）

- **`C:\Windows` 与 `System32` 对容器可读**。这是 Windows 的设计（`ALL APPLICATION PACKAGES`
  在这些位置有 RX），不是配置疏漏。威胁模型是保护**用户项目文件与凭据**，不是全盘读黑洞。
- **内存上限是「分配失败」而非「进程终止」**。Job Object 的 `ProcessMemoryLimit` 让后续分配
  抛错（Python 侧表现为 `MemoryError`）；子进程若 catch 住继续走低内存路径不会被强制杀掉。
  内存上限**必须**与时间上限配合，不能单独依赖。
- **运行时 bootstrap**：Python/Node 的安装目录没有 AppContainer 的 ACE，无法直接启动。
  解法是**把运行时复制进包目录**（实测：复制进去的二进制可正常执行），**不是**给系统目录授权。

### 8.3 `render` 与 `run_command` 的隔离要求分开

两者威胁模型不同，**不得**混为一谈：

- `run_command` 面对「任意代码在 OS 进程里执行」，需要 §8.1 的完整机制；
- `render` 面对「HTML/JS 在 Chromium 渲染进程里执行」，Chromium 自带的渲染沙箱 +
  Playwright 的请求路由拦截即可构成可信边界（spike A2 已验证）。

因此 `render` 的隔离**可以先于**通用沙箱落地，两者分开排期。

## 9. 预算

| 预算项 | 作用 |
|---|---|
| token | 单 session 上限，**按累积 prompt 计量** |
| 步数 | 工具调用轮次上限，防死循环 |
| 时长 | 墙钟上限 |
| 单次输出上限 | 防止产物被截断（见下） |
| 生图次数 | 成本控制 |

超限行为：**如实停止并返回当前状态**，报 `CAPABILITY_UNAVAILABLE`，向用户说明用了多少、
差什么。不静默截断，不把半成品报成完成。

预算在续跑时**不重置**（§7）。

### 9.1 主成本是 prompt 累积，不是模型输出

实测（spike D1，n=20）：`prompt : completion ≈ 6.7 : 1`。agent 循环每一轮都要把完整历史
（含所有工具返回）重新发一遍，成本随轮次**超线性**增长。

因此：

- 预算**必须**按累积 prompt 计量，只算 completion 会严重低估；
- **步数上限本身就是成本控制手段**，不只是防死循环；
- 压成本的主要手段是 **prompt caching**（endpoint 已支持并观察到命中），不是细粒度 checkpoint。
  这也是 §7 决定不改 Phase 2 契约的成本依据。

推理 token（`reasoning_tokens`）应单独记录以便观测，但实测中位数仅占总量约 1.1%，
**不是**预算风险项。

### 9.2 单次输出上限会造成静默的产物缺陷

实测（spike E4）：8 次生成里有 2 次 `completion_tokens` 正好撞满上限，这 2 次**同时**是
产物不完整、且缺少 mock 声明文件的那 2 次。

因此引擎**必须**：

- 检测「输出撞顶」并将其视为**失败**，而不是当作正常完成；
- 撞顶时按 `CAPABILITY_UNAVAILABLE` 处理并说明是输出长度不足，**不得**把截断产物交付下游。

单次输出上限设置过低会同时表现为「交互不可用」和「声明缺失」两个看似无关的症状，
排查时容易误判为模型能力问题。

## 10. 自造 mock 后端

这是引擎能力的直接产物，不是单独功能：一个有工作区、能写 JS、能跑服务的 agent，自然能给前端
造一个假后端把交互跑通。引擎不规定它怎么造（内联 fetch 拦截、service worker、本地小服务都行）。

**但 mock 必须可见。** 假数据 demo 是一个保真声明：

- agent **应当**在 `out/` 中声明哪些数据是 mock、mock 了哪些接口；
- **引擎必须在会话结束时用确定性检测器复核**，检出未声明的 mock 即判失败并要求补声明。
  保证放在引擎侧，**不依赖模型自觉**——实测（spike E4）8 次生成里有 2 次没写声明文件；
- 声明**必须**进入 `ArtifactRevision.tradeoffs`（`domain.py:544`，字段已存在）；
- Quality 层据此产出保真 finding：`demo` delivery profile 下不阻断，`production` delivery
  profile 下阻断（`quality-governance-spec.md` §3.1）。

检测器的实现约束见 `quality-governance-spec.md` §3.4：**只读产物代码，禁止读取声明文件**，
否则检测结果会被 agent 的声明污染。

这条防的是把假后端当真后端交付出去。它不限制 agent 造 mock 的自由，只要求说实话——
而「说实话」由引擎强制，不由模型自律。

> 实测补充：那 2 次未声明的根因是**单次输出撞顶被截断**（§9.2），不是模型有意隐瞒。
> 因此修复顺序应是「先给足输出预算 + 检测截断」，再叠加确定性检出兜底。

## 11. 仓库只读接入

新增源类型 `SourceKind.CODE_REPOSITORY`（`context-evidence-baseline.md` v0.2）。

规则：

- 仓库路径**必须**由用户显式授权，并注册为 `SourceAsset`；**不接受**调用方传入的任意本地路径。
  这是 `context-evidence-baseline.md` §4 原有安全意图的保留形式。
- 挂载为 `repo/`，**只读**。
- 结构提取（路由、API 形状、现有组件、类型定义）作为 `NATIVE_OBSERVATION` 进入证据层；模型对
  仓库用途与语义的理解作为 `MACHINE_INTERPRETATION`，两者不混。
- repo locator 至少包含 `file path + line range`，使产出物中的事实能回溯到具体代码位置
  （`context-evidence-baseline.md` §5 已预留扩展位）。
- 排除规则：`.git/` 内部对象、`node_modules/`、构建产物、`.env` 与任何凭据文件**必须**被排除，
  不进入工作区也不进入证据。

**本轮不实现**：写用户仓库、启动用户真实后端。两者在 §4.3 中定义为 L2 门控工具，需用户显式
批准 + 沙箱 spike 通过（E4、E5）后才开放。

## 12. 需要 system-spec 补充的概念身份

`system-spec.md` §5 的核心项目域表缺两个概念。它们需要独立、可版本化的身份才能被引用与恢复：

| 概念 | 作用 | 主要所有者 |
|---|---|---|
| Agent Workspace | 一次创作或生产任务的持久工作目录 | Agent Engine |
| Agent Session | 一次 agent 循环的执行状态与 turn history | Agent Engine |

两者都**不是**项目真源。它们与 Workflow Run 的关系类似：拥有执行状态，不拥有业务状态。
详见 `system-spec.md` v0.2 §5。

## 13. 与三个模块的关系

| 模块 | 何时驱动引擎 | 工作区内容 |
|---|---|---|
| Design Intelligence | `create_candidates`、`revise_candidate` | 每个候选一个独立工作区 |
| Artifact Production | `materialize`、`apply_artifact_change` | 从已批准方向的工作区派生 |
| Quality & Governance | 修复循环（经 Artifact Production） | 复用 Artifact 的工作区 |

三个模块共用同一个引擎，各自给出不同的目标、约束快照、工具子集和预算。引擎不知道自己在为哪个
模块工作——它只执行目标。

## 14. 观测

记录：session 步数、工具调用分布、自验证循环次数、预算消耗与超限率、续跑发生率、沙箱违规次数、
mock 声明率、`capability_version`。

**不记录**：prompt、文件正文、截图原图、仓库代码正文、凭据（`runtime-recovery.md` §8 allowlist）。
只记摘要、计数、哈希与结论。

## 15. 待 spike 验证的技术假设

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| E1 | 沙箱能在 Windows 上真正限制文件、网络与进程 | ✅ **通过（AppContainer）** | Job Object 路线 6/6 文件逃逸失败；**AppContainer 路线全部拦截**，网络含裸 IP 亦被 OS 拒绝，无需管理员。见 `spikes/e1-sandbox/ADDENDUM-appcontainer.md` |
| E2 | agent 看截图能自己发现并修复视觉问题 | 🔒 待人工审核 | 物料见 `spikes/review.html` |
| E3 | agent 能从只读仓库产出与仓库事实一致的内容 | ✅ **通过** | 0 矛盾；严格口径 94.3%、宽松 100% 可回溯 |
| E4 | agent 自造 mock 能把交互跑通且如实声明 | ⚠️ **部分** | 完全可交互 3/8、至少部分 7/8；声明率 6/8，未声明根因是输出撞顶 |
| E5 | 真实后端启动的沙箱方案可行 | ⬜ 未做 | 为后续场景准备 |
| E6 | 工作区 + turn history 续跑能省掉重复工作 | ✅ **通过** | 省 26–34%（1/9 组 token 为负）；**0 次重复劳动** |
| E7 | 预算上限足以覆盖一个完整页面的创作 | ⚠️ **部分** | 简单页实测充足；真实候选为外推值，未实测。主成本是 prompt 累积（6.7:1） |

对应 ADR：**ADR-0004 Agent 工作区与沙箱边界**（未撰写，不具规范效力）。
基于 E1 追加实验，ADR-0004 的方向应为「**首选 Windows 原生 AppContainer + Job Object**，
WSL2/Docker 降为备选」，而非原先设想的「默认 WSL2」。

## 16. 验收条件

本规范被实现时，至少应能证明：

1. agent 在工作区内建文件、跑命令、起服务、重构，全程无需逐步审批；
2. agent 能拿到真实渲染截图与 console，并据此自己发现问题、自己修复、再次渲染确认；
3. 产出物只经 port 进入项目真源，工作区内容本身不是项目状态；
4. 工作区跨进程重启存活，stage 重入时从工作区现状 + turn history 续跑而非从零重跑；
5. 预算耗尽时如实返回未完成状态与剩余问题，不把半成品报告为完成；
6. 网络默认关闭，沙箱逃逸尝试被拦截且判为硬失败；
7. 凭据不出现在工作区任何位置；
8. 只读仓库可被 agent 读取，仓库内容不可被 agent 修改，凭据与构建产物被排除；
9. agent 自造的 mock 后端能跑通交互，且 mock 声明进入 `tradeoffs` 并被 Quality 报告；
10. 同一引擎能被 Design、Artifact 与 Quality 修复三条路径驱动，工具子集按能力实例裁剪；
11. 取消能在循环中途生效，工作区保留可诊断；
12. 观测记录不含 prompt、文件正文、仓库代码或凭据。
