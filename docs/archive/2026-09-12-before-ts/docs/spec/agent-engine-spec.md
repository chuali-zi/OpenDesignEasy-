# Agent 引擎内部规范

> 状态：**v0.6，已于 2026-08-03 审核通过并冻结。**
> 冻结依据：E1–E7 全部通过或以明确受限口径接受；E8–E11 受限 profile 通过；E12 的 provider
> 超时风险已显式接受、不再作为重测门禁；E13 以 trusted fetch broker 方案通过。冻结后的变更必须
> 通过版本化 Spec 或 ADR。ADR-0005 已接受受限 `framework` profile，并作为跨模块规范化扩展生效。
> v0.6 回填 E2 人工裁决、E4 最终保证口径、E5/E13 实验，冻结 E7 预算策略与 E12 已知风险；
> 将真实后端和依赖下载统一收窄为 trusted host broker + zero-capability AppContainer 子进程。
> v0.5 追加失败根因实验：首版固定为 React/MUI + native esbuild builder，保留 AppContainer +
> Job Object；组件主题改为引擎生成的 strict theme。Node/Vite profile 暂不支持，E12 待重测。
> v0.4 回填 spike E8–E12：E9/E10 通过、E11 部分、E8/E12 未通过；收紧真实 Node bootstrap、
> 组件主题与预算闭环的解锁条件。原始数据见 `spikes/e8-e12-framework/RESULT.md`。
> v0.3 新增 §11 框架应用基底所需的引擎能力（提案）与 spike 假设 E8–E12；当时把跨模块影响归入
> 待撰写的 ADR-0005。该 ADR 现已接受，不直接改写已冻结的 Design / Artifact 两份规范。
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
结构。它也不决定具体的 agent 框架——该选择由已接受的 ADR-0004 固定。

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
见 §13。

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
| `start_dev_server` / `stop_dev_server` | 在沙箱内起停本地服务，由 trusted host broker 仅暴露到回环 |
| `render` | 用真实浏览器加载工作区产物 |
| `screenshot` | 取指定视口截图 |
| `read_console` | 读渲染时的 console 与网络错误 |

`render` / `screenshot` / `read_console` 是引擎的核心价值所在，见 §6。

### 4.3 L2 外部副作用（需要门）

| 工具 | 门 |
|---|---|
| `fetch_network` | 默认**关闭**。依赖安装、外部 API 调用需显式策略放行；首版由 trusted host broker 执行 |
| `generate_image` | 计入生图预算，受成本上限约束 |
| `write_user_repo` | 需用户显式批准，本轮**不实现** |
| `start_real_backend` | 需用户显式批准；首版使用 E5 已验证的 trusted loopback broker + zero-capability 后端 |
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

Agent Session 需要独立身份才能被引用与恢复，见 §13。

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
  把运行时复制进包目录只能证明**单个二进制可执行**，不能证明真实运行时成立。E8 实测复制后的
  Node `--version` 成功，但加载 Vite 模块图时因 `realpathSync` 对 `C:\` 执行 `lstat` 被 AppContainer
  拒绝。bootstrap 的通过标准必须是真实模块解析、构建与 dev server 全部跑通，不能用
  `exe --version` 代替；不得为绕过该问题给系统目录做宽泛 ACL 授权。
  首版 framework 不依赖该 Node profile：采用临时盘符根 + 原生 esbuild 固定 builder。通用 Node/Vite
  仍须等包含 AppContainer named-pipe 修复的运行时后另行解锁。

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

## 11. 框架应用基底所需的引擎能力（已由 ADR-0005 接受）

**本节的引擎能力与风险处理已冻结，ADR-0005 已接受跨模块改动。** E8–E11 已在受限实现
profile 下通过；E12 的 provider/model 超时作为已知风险接受，不再要求为了冻结本规范重跑；E13 以
比原提案更窄的 trusted fetch broker 方案通过。产品仅可启用 ADR-0005 冻结的受限 `framework`
profile，不得外推为通用工具链。完整方法
与原始数据见 `spikes/e8-e12-framework/RESULT.md`、`spikes/e13-gated-install/RESULT.md`。

它存在的理由：审美实验里被称为「C 组 / 框架路线」的东西，
实际只验证到「模型用**离线 Tailwind 原子类**写静态页」——没有包管理器、没有构建、没有组件库
源码、没有 agent 会话（产物是单次生成的静态文件）。`RESULT2.md` §8.5 因此写下「引擎仍然不需要
新增 npm/build/CDN 类工具」，那句话的前提正是这个轻量口径。

而「**agent 在工作区里应用现有 Web 前端框架**」（React/Vue + 组件库 + 构建）是另一件事。
下面冻结首版受限 profile、已接受风险与通用 profile 尚缺的能力。

### 11.1 依赖安装：走门控放行，不关网

依赖安装走 §4.3 已有的 L2 工具 `fetch_network`。**「默认关闭」是默认值，不是禁令**——门控存在
的意义是让每一次外网访问都被授权和记录，不是让 agent 装不上包。用「提前圈定依赖集」来回避
装包，等于拿产品能力换省事：agent 会被迫只用别人替它猜到的依赖。

- 放行**必须**产生审计记录：取了什么、从哪个 registry、什么时候、属于哪个 session，进
  side-effect ledger。这是 `runtime-recovery.md` §7 的既有机制，不需要新建。
- 依赖**必须**在安装后固定：lockfile 与依赖整树哈希随产物留存。这与开不开网无关，纯粹是为了
  让同一份源码以后还能构建出同一个产物；`artifact-production-spec.md` §3.1 对 vendor 包已有同样
  要求。E8 实测这条可测——镜像的 lockfile 与整树哈希在构建前后不变。
- 实现约束：放行表现为「trusted host fetch broker 只取门批准的精确 URL，再由零 capability 的独立
  AppContainer 子进程安装」。agent 自己的 `run_command` 与包脚本都维持零 capability。E13 实测：
  普通子进程访问 registry 在 DNS 层被拒；broker 成功下载 `is-number@7.0.0`，零 capability 安装
  子进程完成解包，lockfile 未漂移，归档与依赖整树 SHA-256 均进入 ledger。直接给安装子进程
  `internetClient` 在本机只前进到 DNS 可用，HTTPS 仍因 Schannel/连接策略失败，不作为支持方案。

**预置依赖镜像降级为一种供给方式，不再是唯一形态。** 它实测可用（固定 React/Vite/MUI 镜像
7,505 个文件，复制进包目录后最长路径 200 字符），当前受限 profile 仍在用它；但它不应该成为
agent 能用哪些依赖的上限。

**这条改动不解决当前的阻塞。** E8 的失败点在 §11.3 的 Node 祖先路径解析，与网络无关——开网既
不会让 Node 在 AppContainer 里启动起来，也不会缩短 E12 的 provider 推理时间。它解决的是另一件
事：agent 不必再受「依赖必须提前猜全」的限制。

**防护栏后续迭代**（不阻塞本轮）：`postinstall` 脚本限制、registry 来源限制、包名单策略、
安装产物扫描。缺这些不构成放行的阻塞理由。

### 11.2 构建步骤

`run_command` 已经能跑构建，**不需要**新工具。需要补的是三条约束：

- 构建产物路径**必须**约定并落在 `out/` 的声明范围内（§3），port 不扫描整个工作区；
- 构建失败按 §4 既有规则处理——是给模型看的信息，不是立即终止的理由；
- **构建必须确定性**：同一份源码两次构建，产物哈希一致。否则 ADR-0002 要定的「导出物重渲染
  一致性阈值」失去意义——分不清差异来自渲染还是来自构建。

首轮 E9 在宿主 Vite 下通过。后续固定 builder 实验进一步在零网络 AppContainer 内通过：临时盘符根
下直接运行预置 `esbuild.exe`，两次构建均小于 0.5 秒，相对路径、逐文件 SHA-256 与整树
SHA-256 完全一致；构建后真实渲染无外链、无 console error，20 个锚点全部存活。该结论只适用于
固定 React/MUI/esbuild profile，不覆盖跨机器、跨版本或通用 Vite plugin。

### 11.3 运行时 bootstrap

§8.2 已记录：Python/Node 的安装目录没有 AppContainer 的 ACE。E8 进一步证明“复制进包目录”只是
必要条件，不是充分条件：复制后的 Node `v25.6.1` 能执行 `--version`，但启动 Vite 时会从盘符根
解析真实路径，并因 `lstat C:\` 返回 `EPERM` 而退出。

对**通用 Node/Vite profile**，这一项是硬前置；首版固定 esbuild profile 不依赖 Node 或 dev server。
本次 `node_modules` 最长路径为 200 字符，未触发路径长度问题；**当前实际阻塞是 Node 的祖先路径
访问语义**。后续优化至少补测 Node LTS、不会扩大容器可读面的最小路径方案，以及 WSL2/专用低权限
账户备选。任何启动路径都必须同时挂 Job Object：诊断中 Node 忙循环并在父 harness 超时后成为孤儿，
证明只杀直接父进程不够。

后续最小探针把失败拆成两层：将 package workspace 映射为临时 `S:\` 后，Node 主脚本与 package
resolution 成功；但当前 libuv 在 AppContainer 内创建管道时未使用合法的 `\\.\pipe\LOCAL\` 命名空间，
`child_process` pipe、Vite 导入与 Vite build 均挂起。libuv #5181 已有对应上游修复，但当前 Node
`v25.6.1` / libuv `1.51.0` 尚未包含。

首版不等待通用运行时：launcher 选择随机空闲盘符映射工作区，直接启动依赖镜像中的原生 esbuild，
构建结束后精确删除映射；映射不改变目标 ACL。受信任 host renderer 服务 `dist/` 并截图，容器内不启
dev server。该方案保留 AppContainer + Job Object，不是沙箱重构；代价是首版不支持 Vite plugin、
HMR、Vue SFC、SSR 或任意 Node codegen。

### 11.4 预算

§9 的实测数字（`prompt : completion ≈ 6.7 : 1`）来自静态页场景。框架路线会在两个方向上
推高成本：构建与真实 render 的往返增加**步数与时长**，构建日志和组件源码进入上下文增加
**累积 prompt**。

E12 首轮同时混入冷复制依赖与 Kimi API 故障。改用固定 builder 和流式工具调用后，框架工具时间已降为
构建 0.15 秒、渲染 2.90 秒；但 Kimi 一次方向调用消耗 22,429 reasoning token / 767 秒，后续页面
文件又用 275 秒，总会话 1,082 秒，仍未在 900 秒内进入正式 build/render。会话外诊断产物可构建、
可渲染、有 12 个唯一锚点，不等于 agent 已完成闭环。

因此 E12 的失败瓶颈是**provider/model 长推理**，不是 framework tool time。2026-08-03 冻结裁决
直接接受这一已知风险：它不再阻塞 engine spec，也不再要求为冻结重跑。首版仍以 900 秒为可中断活动
HTTP 流的硬 deadline；超时必须按 §5/§9 如实返回未完成，不能把会话外诊断产物算成完成。
按真实架构消费上游已批准方向、分别记录 provider/tool time 和更换低时延 provider，列入 §18 后续优化。

### 11.5 对已冻结规范的影响（ADR-0005 规范化扩展）

`design-intelligence-spec.md` 与 `artifact-production-spec.md` 已于 2026-07-30 冻结，冻结规则要求
变更通过版本化 Spec 或 ADR。ADR-0005 已接受下列改动，且**仅在受限 `framework` profile 内具
规范效力**：

| 已冻结位置 | 需要的改动 |
|---|---|
| Design §4.2.2 实现基底 | 现为 `bespoke` / `system` 两条，需增加第三条 `framework` |
| Design §7 模板角色「设计系统」 | 现指离线 Tailwind + 主题注册；framework 下需指组件库的语义保留义务 |
| Artifact §3 产物树 | 现为 `index.html + styles.css + assets/`；框架项目有 `src/` + 构建配置 + `dist/`，**导出交付哪一份**需要定 |
| Artifact §3.1 离线 vendor 包 | 从「单文件设计系统 + 字体」扩展到构建期依赖：既可预置镜像，也可门控放行安装（§11.1）。**产物侧「不得依赖外链」不变**——构建期能联网与产物运行期不许联网是两件事 |
| Artifact 对象锚点 | `data-oey-*` 必须穿过 JSX/组件抽象/打包/压缩后在 DOM 中存活并可被 object registry 解析 |

最后一行原本是最大的产品级风险。E10 的受控 fixture 已通过：一个组件复用 20 次，构建后 DOM
保留 `card-01` 至 `card-20` 共 20 个唯一锚点，缺失与重复均为 0。成立的模式是**业务层持有稳定 ID，
调用方经 prop 显式传给复用组件，registry 从构建后 DOM 抽取**；随机数、数组下标或 React 自动 ID
不得作为持久对象身份。该结果排除了技术可行性风险，不等于任意 agent 产物都会自动遵守契约。

### 11.6 与已验证部分的关系

已经成立、**不需要**重测的部分：产物不得依赖外链（Artifact §3.1）、零网络渲染（A8，6/6）、
艺术方向阶段决定 token 纪律而非基底（`RESULT2.md` §4.1）。框架基底继承这三条，
它额外需要 E8–E13。当前受限 profile 的引擎条件已经冻结：E8–E11 通过、E12 风险接受、E13 通过。
ADR-0005 已允许 `framework` 受限 profile 进入 P6，不再由 E12 重测结果决定。

### 11.7 组件主题纪律与当前门禁

E11 首轮证明 prompt 不足以约束 MUI：真实 agent 候选从 6 个声明 token 派生出 10 色。修复后不再
让 agent 自由写主题：agent 只提交 6 个不透明角色 token，引擎用 strict theme factory 显式填满
palette/status/grey/action 与组件 override，并把生成的主题设为只读。hover/focus/disabled 只在六个
token 间切换，禁用 ripple 与颜色 transition。Playwright 对 rest、所有按钮 hover、focus、disabled
取并集，结果恰为 6 个声明 token，未归属颜色 0；E11 在该受控 profile 下通过。

主题验收不能只看声明 token 或颜色总数，必须同时检查：

- 排除 `data-oey-preview-root` 后，外壳计算后颜色数不超过艺术方向阈值；
- 每个计算后颜色都必须是六个声明 token 之一，strict profile 不接受 alpha 派生色；
- 组件库默认灰、状态色和 hover/focus 派生色不得静默进入；
- 抽取必须基于真实渲染的计算样式，不能只扫描主题源码。

**冻结结论**：ADR-0005 已作为 Design / Artifact 两份冻结规范的受限扩展接受，P6 可以暴露
`framework`。首版只承诺固定 React/MUI/native esbuild builder + trusted host
renderer，不承诺通用 Node/Vite、容器内 dev server、Vue SFC、SSR 或任意 codegen。E12 的长推理与
多样本校准转为非阻塞优化，不再是解锁条件。

## 12. 仓库只读接入

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

**本轮不实现**：写用户仓库。启动用户真实后端的产品功能仍待实现，但 E5 已冻结安全方案：需用户
显式批准，后端运行在零 capability AppContainer + Job Object 中，由只绑定 `127.0.0.1` 的 trusted
host broker 经包目录 spool 转发；不得直接在宿主运行不可信后端，也不得依赖全局 loopback exemption。

## 13. 需要 system-spec 补充的概念身份

`system-spec.md` §5 的核心项目域表缺两个概念。它们需要独立、可版本化的身份才能被引用与恢复：

| 概念 | 作用 | 主要所有者 |
|---|---|---|
| Agent Workspace | 一次创作或生产任务的持久工作目录 | Agent Engine |
| Agent Session | 一次 agent 循环的执行状态与 turn history | Agent Engine |

两者都**不是**项目真源。它们与 Workflow Run 的关系类似：拥有执行状态，不拥有业务状态。
详见 `system-spec.md` v0.2 §5。

## 14. 与三个模块的关系

| 模块 | 何时驱动引擎 | 工作区内容 |
|---|---|---|
| Design Intelligence | `create_candidates`、`revise_candidate` | 每个候选一个独立工作区 |
| Artifact Production | `materialize`、`apply_artifact_change` | 从已批准方向的工作区派生 |
| Quality & Governance | 修复循环（经 Artifact Production） | 复用 Artifact 的工作区 |

三个模块共用同一个引擎，各自给出不同的目标、约束快照、工具子集和预算。引擎不知道自己在为哪个
模块工作——它只执行目标。

## 15. 观测

记录：session 步数、工具调用分布、自验证循环次数、预算消耗与超限率、续跑发生率、沙箱违规次数、
mock 声明率、`capability_version`。

**不记录**：prompt、文件正文、截图原图、仓库代码正文、凭据（`runtime-recovery.md` §8 allowlist）。
只记摘要、计数、哈希与结论。

## 16. 技术假设与实测状态

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| E1 | 沙箱能在 Windows 上真正限制文件、网络与进程 | ✅ **通过（AppContainer）** | Job Object 路线 6/6 文件逃逸失败；**AppContainer 路线全部拦截**，网络含裸 IP 亦被 OS 拒绝，无需管理员。见 `spikes/e1-sandbox/ADDENDUM-appcontainer.md` |
| E2 | agent 看截图能自己发现并修复视觉问题 | ✅ **通过并冻结** | 4/4 候选发现并实际修复问题；最终轮均为零 console/failed request/page error/overflow，2026-08-03 人工审核通过。见 `spikes/d2-aesthetic/RESULT.md` |
| E3 | agent 能从只读仓库产出与仓库事实一致的内容 | ✅ **通过** | 0 矛盾；严格口径 94.3%、宽松 100% 可回溯 |
| E4 | agent 自造 mock 能把交互跑通且如实声明 | ✅ **通过并冻结（引擎兜底口径）** | 首轮完全可交互 3/8、至少部分 7/8；两次未声明均因 16k 撞顶。后续 40k 流式 6/6 无截断，确定性检出 4/4、0 误报 |
| E5 | 真实后端启动的沙箱方案可行 | ✅ **通过并冻结** | zero-capability AppContainer 后端经 trusted loopback/spool broker 完成 GET/POST；外部文件与 env key 隔离，Job 终止后端进程、session 关闭 broker 端口。见 `spikes/e5-real-backend/RESULT.md` |
| E6 | 工作区 + turn history 续跑能省掉重复工作 | ✅ **通过** | 省 26–34%（1/9 组 token 为负）；**0 次重复劳动** |
| E7 | 预算上限足以覆盖一个完整页面的创作 | ✅ **预算策略冻结** | 简单页 20/20 完成；冻结累积 prompt + 多维硬上限语义，`60/250k/900s/3 renders` 为首版 profile，分布校准转后续优化 |

§11 的框架应用基底已完成实验并冻结，ADR-0005 已允许受限 profile 进入产品：

| # | 假设 | 状态 | 实测结论 |
|---|---|---|---|
| E8 | 预置依赖镜像能在零网络沙箱内完成构建 | ✅ **通过（受限 profile）** | 临时盘符根 + native esbuild；两次零网络 AppContainer 构建成功。Node/Vite profile 仍不支持 |
| E9 | 构建是确定性的 | ✅ **通过（沙箱固定 builder）** | 两次沙箱 esbuild 的相对路径、逐文件与整树 SHA-256 全同；跨环境未覆盖 |
| E10 | `data-oey-*` 锚点能穿过组件抽象与构建存活 | ✅ **通过** | 复用组件 20 实例 → 构建后 20 个唯一锚点，缺失 0、重复 0；稳定业务 ID 经 prop 透传 |
| E11 | 组件库路线的 token 纪律不劣于现有两条基底 | ✅ **通过（strict theme）** | rest/hover/focus/disabled 并集恰为声明 6 色；自由生成主题不在支持范围 |
| E12 | 框架候选的完整创作在预算上限内完成 | 🔒 **已知风险接受并冻结** | 实测仍是构建 0.15s、渲染 2.90s、Kimi 会话 1,082s 且未完成自验；按 2026-08-03 裁决不再重测、不阻塞 spec，超时如实失败 |
| E13 | 会话内门控放行装依赖可行且可审计 | ✅ **通过并冻结（broker profile）** | agent 网络仍拒绝；trusted broker 下载批准 URL，零 capability 子进程安装；lockfile、归档/整树 SHA-256 与 ledger 完整，实验 key 零泄漏 |

对应 ADR：**ADR-0004 Agent 工作区与沙箱边界**、**ADR-0005 框架应用基底**，均已于
2026-08-03 接受。基于 E1 追加实验，ADR-0004 冻结为「**首选 Windows 原生 AppContainer + Job Object**，
WSL2/Docker 降为备选」，而非原先设想的「默认 WSL2」。
E8 不推翻 AppContainer，对首版固定 builder 也不需要 WSL2；但通用 Node/Vite 运行时不能直接继承
该推荐。在含 AppContainer pipe 修复的运行时可用前，通用 profile 保留 WSL2/专用低权限账户备选。

## 17. 验收条件

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

ADR-0005 接受的 §11 框架应用基底另需证明：

13. agent 能在零网络沙箱内消费预置依赖镜像，通过固定 builder 完成生产构建；预览由 trusted host renderer 提供；
14. 会话内新增依赖经门控放行后，由 trusted fetch broker 取回批准 URL、零 capability 子进程安装；每次放行进 side-effect ledger，依赖版本、lockfile、归档与整树哈希随产物留存；
15. 同一份源码两次构建产出哈希一致的产物；
16. 框架产物中的 `data-oey-*` 锚点在构建后的 DOM 中完整存活，可被 object registry 解析。
17. 组件主题在 rest/hover/focus/disabled 等状态下的外壳计算后颜色并集恰为六个声明 token；
18. 正式 agent 会话若在预算内完成，至少执行一次“构建 → 真实截图 → 模型检查 → 必要时修复”闭环；若 provider 超时则必须如实失败。

## 18. 冻结后的非阻塞优化点

以下项目已明确记录，但**不属于 v0.6 冻结门禁**：

1. E5 的包目录 spool broker 优化为带正确 AppContainer ACL 的 named pipe，补并发、背压、大请求体、
   流式响应与 WebSocket；安全边界保持“后端零 capability、host 只绑定 loopback”不变。
2. E7 用首个垂直切片和多 provider 样本校准 `60/250k/900s/3 renders`，分别观测缓存命中、
   provider time 与 tool time；参数调整不改变预算耗尽语义。
3. E12 让实现 session 直接消费上游批准方向、减少重复 reasoning，评估低时延 provider，并确保
   900 秒硬 deadline 能中断活动流；这些只改善完成率，不允许弱化“超时如实失败”。
4. 通用 Node/Vite profile 等包含 AppContainer `\\.\pipe\LOCAL\` 修复的运行时后再测；首版固定
   React/MUI/native esbuild profile 不等待它。
5. E13 增加 registry 来源与重定向逐跳复核、`postinstall` 限制、包扫描、缓存/并发和私有 registry
   认证。认证值只进入 broker 单次内存请求，不进入子进程 env、工作区或 ledger。
