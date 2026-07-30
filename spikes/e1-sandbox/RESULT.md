# E1 + A2: Windows 上的 agent 沙箱可行性

> Spike 目录：`spikes/e1-sandbox/`
> 方法：纯 Python 标准库 + `ctypes` + `subprocess`（候选实现见 `sandbox.py`），
> 用真实攻击用例打它（`attacks/*.py`，编排见 `run_attacks.py`），
> 原始结果见 `attack_results.json`；A2 见 `a2_render.py` / `a2_result.json` / `a2_screenshot.png`。
> 环境：Windows 11 Home，非管理员 shell，Python 3.12.10，Playwright 1.58.0
> （`channel="chrome"`），Docker Desktop 已装但守护进程未运行，WSL2 已装且有发行版在跑。

## 假设原文

`agent-engine-spec.md` §15：

| # | 假设 | 判定标准 |
|---|---|---|
| E1 | 沙箱能在 Windows 上真正限制文件、网络与进程 | 逃逸测试全部被拦截；可能需引入 Docker/WSL，属 ADR-0004 |

`artifact-production-spec.md` §11：

| # | 假设 | 判定标准 |
|---|---|---|
| A2 | 隔离渲染与沙箱在 Windows 上可行 | 无网络、限时限内存的沙箱实际跑通（与 E1 共用） |

## 结论先说

**E1 被证伪（部分）。** 纯 Python 标准库 + `subprocess` 能可靠做到**进程**维度的限制（时间、内存、
进程树回收）和**凭据**隔离，这两项判定标准**通过**。但**文件根逃逸测试全部未被拦截**，**网络阻断
在无管理员权限下做不到**。这两项判定标准**不通过**。

**A2 通过，但有前提。** Playwright + Chromium 的渲染本身可以在无外网、限时、限内存下跑通——因为
被渲染的是网页内容，运行在 Chromium 自己的渲染进程沙箱里，不是任意 OS 级代码执行，这是一个远
比 E1 通用命令执行更容易的威胁模型。

**关键判断题结论：纯 Python/Windows 原生方案不够。** 文件与网络维度的真实隔离，在这台机器的权限
条件下，只有引入 Docker（已装但守护进程未起）或 WSL2（已装且在跑）才能达到判定标准。详见 §5。

## 1. 攻击用例实际结果

“naive” = 裸 `subprocess.run`，仅靠子进程 cwd 隔离，没有任何额外防护。
“hardened” = `sandbox.run_sandboxed()`：Job Object（进程树回收 + 内存上限）+ 从空白构建的
env（不做 `os.environ.copy()`）+ 有界输出采集。**hardened 模式没有额外做任何文件系统或网络限制**
——这正是要验证的点：Job Object/干净 env 这类"便宜"的加固能不能顺带带来文件/网络隔离，答案是不能。

### 1.1 文件根逃逸

| 攻击 | naive | hardened | 说明 |
|---|---|---|---|
| `..\..\` 相对路径穿越 | **未拦截**（ESCAPED） | **未拦截**（ESCAPED） | 读到 workspace 外的 `credentials.txt` |
| 绝对路径（工作区外文件） | **未拦截** | **未拦截** | 同上，绝对路径直接读 |
| 绝对路径（`C:\Windows\win.ini`） | **未拦截** | **未拦截** | 读到系统文件内容 |
| Junction（`mklink /J`，非管理员可建） | **未拦截** | **未拦截** | 在 workspace 内建一个指向 `C:\Users\<user>` 的 junction，`iterdir()` 直接列出 129 个条目 |
| UNC 路径（`\\localhost\C$\...`） | **未拦截** | **未拦截** | 管理共享可读，读到 `win.ini` |
| `\\?\` 扩展前缀 | **未拦截** | **未拦截** | 绕过任何只认 `C:\` 字符串前缀的检查 |
| 保留设备名（CON/PRN/AUX/NUL/COM1/LPT1） | 信息性，非二选一 | — | `CON`、`NUL` 能以 `workspace\CON` 形式被"写入"成功（NUL 静默吞掉，CON 在无控制台的子进程里行为不确定）；`PRN`/`AUX`/`COM1`/`LPT1` 报 `FileNotFoundError`（本机无对应设备）。**结论**：字符串前缀检查会把 `workspace/CON` 误判为"在根内"，但 OS 把它解析成设备而非文件——这是正确性坑，不是本次验证到的可利用逃逸，但要求路径校验代码显式拒绝保留名 |

**原始数据**：`attack_results.json` 第 1–13 条。六类逃逸测试，`naive` 与 `hardened` **结果完全一致**
——因为 Job Object 和干净 env 根本不作用于文件系统。这证明：`agent-engine-spec.md` §8 表格里"文件根：
限定在本工作区，路径逃逸即硬失败"这一行，**在当前候选实现里没有被满足**，也不会被"多加一层进程
级加固"顺带满足。要满足它，必须有一个 OS 强制的文件系统边界（见 §5）。

### 1.2 网络阻断

| 场景 | 结果 |
|---|---|
| 无任何缓解，raw socket | **未拦截**：`socket.create_connection(("example.com", 80))` 直接连通 |
| 无任何缓解，`urllib.request` | **未拦截**：拿到 200 字节响应体 |
| 设置 `HTTP_PROXY`/`HTTPS_PROXY` 指向不可达地址 | **部分**：`urllib`（遵守代理环境变量的那条路径）被挡；**raw socket 完全不受影响，照样连通** |
| 非管理员创建出站防火墙规则（`netsh advfirewall firewall add rule`） | **拒绝**：`The requested operation requires elevation (Run as administrator)` |

**结论**：代理环境变量不是安全边界，只是对"守规矩"的代码有效——恰恰是不可信/模型生成代码不能
指望会守的那种规矩（本次 `attack_network.py` 里 raw socket 那条路径就是刻意模拟"不理会代理变量的
代码"）。真正能挡网络的机制（按可执行文件路径限定的出站防火墙规则）**在非管理员权限下建不了**。

**旁证**（只读观察，未做任何改动）：这台机器上已经装了别的 AI 编码工具（Codex CLI 等），
`netsh advfirewall firewall show rule name=all` 能看到它们预置的规则，例如
`AIProxyGuard_TCP_..._node_repl.exe` / `AIProxyGuard_UDP443_..._codex.exe`——**按完整可执行文件路径
限定**、方向 Out、协议 TCP/UDP、端口 80/443，动作 Block。这正是我设想的"唯一现实机制"，而且这些
规则显然是**安装期以管理员权限预置的**，不是运行期由沙箱自己临时建的。另外还发现一个专用本地组
`CodexSandboxUsers`（含 `CodexSandboxOffline`/`CodexSandboxOnline` 两个专用账户）——另一个同类工具
的 Windows 沙箱方案用的是"专用低权限账户 + 按账户区分是否放行网络"，同样需要一次性、管理员级别
的机器配置，不是纯 per-session 的 Python 代码。

### 1.3 时间限制与进程树回收

| 场景 | 结果 |
|---|---|
| naive：`proc.kill()` 杀直接子进程 | **孙进程存活**：心跳文件在"杀掉"后仍从 5 涨到 9，证明祖父进程被杀、孙进程（脱离了 `Popen` 句柄追踪的独立进程）完全不受影响继续跑 |
| hardened：Job Object `TerminateJobObject` | **孙进程被回收**：`timed_out=True job_terminated=True`，心跳文件在杀之后稳定停在 3，不再变化 |

**结论**：Job Object 方案在进程树回收上**通过**，且证明了朴素 `proc.kill()`/`.terminate()` 方案
**不通过**——这是本次验证里少数"如果只做最简单实现就会出问题"被实测坐实的地方，值得写进规范当
硬性要求（不能只调用 `proc.kill()`）。

### 1.4 内存与输出限制

| 场景 | 结果 |
|---|---|
| naive，无内存上限 | 分配满 4096 MB 未被杀（Python 进程能吃多少吃多少） |
| hardened，Job Object 100 MB 上限 | 子进程在约 90 MB 处收到 `MemoryError` 并自行以 `exit(1)` 退出。**注意**：这是 `JOBOBJECT_EXTENDED_LIMIT_INFORMATION.ProcessMemoryLimit` 让后续内存分配失败（类似 rlimit），Python 把它包成了 `MemoryError` 异常，**不是**操作系统强制杀掉进程——如果子进程 catch 住 `MemoryError` 继续跑（例如换个更省内存的路径），Job Object 不会额外介入。这点在规范措辞上要精确：内存限制是"分配失败"，不是"进程终止"，除非搭配一个额外的硬杀逻辑 |
| naive，stdout 无界采集 | 5000 万字节全部原样进父进程内存，0.55s 内完成（本机没炸，但父进程内存随子进程输出线性增长，是一个真实的资源风险） |
| hardened，1 MB 输出上限 | 正确截断在 1,000,000 字节，`truncated=True`，子进程本身**没有**被杀（按 spec §8"超限截断并告知 agent"的措辞，这是对的行为——只截断不杀） |

### 1.5 凭据隔离

| 场景 | 结果 |
|---|---|
| naive，`env=os.environ.copy()` + 注入一个假 `API_KEY` | **泄漏**：子进程环境里不仅看到注入的 `API_KEY`，还看到这台开发机上**本来就存在**的其他工具的真实凭据形状变量：`DEEPSEEK_API_KEY`、`GITEE_TOKEN`、`MCP_API_KEY`、`OPENCODE_GO_API_KEY`、`VSCODE_GIT_IPC_AUTH_TOKEN` |
| hardened，`build_clean_env()`（从空白按 allowlist 构建，不继承 `os.environ`） | **未泄漏**：子进程 env 总共只有 8 个 key（`SYSTEMROOT`/`PATH`/`PATHEXT`/`TEMP`/`TMP`/`OS`/`COMSPEC`/`PYTHONIOENCODING`），无任何凭据形状的 key |

**结论**：`env=os.environ.copy()` 是一个真实存在的风险，不是假设——这台开发机的 shell 环境里
**当下就挂着好几个不相关工具的真实密钥**。`agent-engine-spec.md` §8"凭据永不进入工作区"这一条，
**必须**通过"从空白构建 allowlist env"实现，**禁止**任何形式的 `os.environ.copy()` 再做减法（减法
容易漏，加法白名单不会漏未预期的变量）。这一项判定标准通过。

## 2. AppContainer 可行性探测（决定关键判断题的核心实验）

`appcontainer_probe.py` 尝试用纯 `ctypes` 调用 Windows 真正的沙箱原语（`CreateAppContainerProfile` +
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` + `CreateProcessW`，这正是 UWP 应用和 Chrome/Edge
渲染进程沙箱底层用的机制）：

1. **`CreateAppContainerProfile` 成功**，拿到 AppContainer SID，`CreateProcessW` **成功启动**了一个
   带 AppContainer token 的子进程——证明这条路径在 ctypes 下**可达**，不需要管理员权限。
2. 子进程立即以 `0xC0000135`（`STATUS_DLL_NOT_FOUND`）退出：AppContainer 的 SID 在 Python 安装目录
   上**没有 ACL**，连 `python3xx.dll` 都加载不了。
3. 尝试修复：`icacls <python目录> /grant "*S-1-15-2-1:(OI)(CI)RX"`（给"ALL APPLICATION PACKAGES"
   授权）。**被 Claude Code 自身的权限分级器拒绝**，理由是"未经审查的、持久性的、机器级安全配置
   变更"。我没有绕过这个拒绝——这个拒绝本身就是本次 spike 最有力的证据之一：**真正能用的
   AppContainer 沙箱，需要对沙箱要用到的每一个目录（Python 安装目录、site-packages、临时目录……）
   做持久性 ACL 授权，这是一次性的、机器级的、需要更高权限的部署步骤，不是"每次开 session 跑一段
   Python 代码"能自我完成的**。

结合 §1.2 里发现的旁证（Codex 的专用沙箱账户组、其他工具预置的按路径限定防火墙规则），三个独立
证据指向同一个结论：**Windows 原生沙箱机制（AppContainer / 专用账户 / 按路径防火墙规则）都需要
一次性的、管理员权限的机器配置**，且要做对（准确的 ACL 范围、准确的 capability 集合、覆盖所有
依赖路径）本身是相当于重新实现 Chromium sandbox 一部分的工程量，不是这个 Phase 能在预算内做到
且做对的。

## 3. A2：隔离渲染结果

`a2_render.py`：Playwright `channel="chrome"`，本地页面（`a2_fixture/index.html`）引用 1 个本地
CSS、1 个本地 JS、1 个本地 PNG，以及 2 个外部资源（图片 + 脚本）。

| 检查项 | 结果 |
|---|---|
| 本地资源加载 | 通过：CSS 生效（截图可见标题变色变字体）、JS 执行（`document.title` 被改写，`console.log` 被采集到）、本地 PNG 加载成功 |
| 外部资源在无网络下失败并被采集 | 通过：两个外部请求都被 `context.route()` 拦截（`route.abort("blockedbyclient")`），在 `requestfailed` 事件与 console error 里都能看到 `net::ERR_BLOCKED_BY_CLIENT`，不是静默吞掉 |
| console 采集 | 通过：`console.log`、`console.error`（含页面主动抛的）都被捕获，共 4 条消息 |
| 限时 | 通过：`page.goto(timeout=8000, wait_until="networkidle")`，整次运行 2.0s 完成；额外测试把整条 `a2_render.py`（含它拉起的 Chrome 子进程树）包进 `sandbox.run_sandboxed(timeout_s=1)`，能可靠触发超时并回收，见 §1.3 的同一机制 |
| 限内存 | 通过，但有实际下限：把整条驱动进程包进 Job Object，150 MB 上限下 Playwright 的驱动连接直接断掉（渲染进程栈对 150 MB 来说太挤了）；1GB 上限下渲染完整成功，2.2s。**结论**：Job Object 内存限制机制本身在浏览器场景下同样有效，但渲染类沙箱的内存下限比纯代码执行沙箱高得多（这里验证到 1GB 够、150MB 不够，实际生产上限需要单独校准） |
| 截图 | 通过：`a2_screenshot.png`，18.7KB，视觉上外部图片显示为 alt 文本占位（加载失败的正确表现），本地样式正常应用 |

**关键区别**：A2 之所以能通过而 E1 的文件/网络两项不能通过，是因为**威胁模型不同**。E1 的
`run_command` 面对的是"任意代码在 OS 进程里执行"，需要 OS 级边界。A2 的 `render` 面对的是"HTML/JS
内容在 Chromium 渲染进程里执行"，Chromium 自己的渲染进程沙箱（Google 已经做了多年加固）加上
Playwright 的 CDP 层请求拦截，就足以构成一个可信边界——页面 JS 没有能力绕过 Playwright 的路由拦截
去发起浏览器网络栈之外的请求（除非利用 Chromium 沙箱逃逸漏洞，超出本 spike 范围）。**这意味着
`render` 工具的隔离要求可以现在就用 Playwright 原生能力满足，不需要等 E1 的通用沙箱方案落地**，
两者可以分开排期。

有一个意外发现：`build_clean_env()` 的 allowlist 一开始把 `PROGRAMFILES`/`LOCALAPPDATA` 都剥掉了，
导致 Playwright 找不到 Chrome 安装路径。补充这些变量后才能跑通。**教训**：凭据安全 env allowlist
不能是一份全局通用清单，必须按"这个工具实际需要什么系统变量"来配，否则会把合法工具一起挡在外面。

## 4. 判定标准核对

| 判定标准 | 结果 |
|---|---|
| E1：逃逸测试全部被拦截 | **不通过**。文件根：6/6 逃逸未拦截。网络：2/2 无缓解场景未拦截，代理环境变量缓解部分有效但可被 raw socket 绕过，防火墙规则因权限不足建不了。进程/内存/输出/凭据四项：**通过**（Job Object + 干净 env 有效） |
| A2：无网络、限时限内存的沙箱实际跑通 | **通过**，威胁模型比 E1 窄（浏览器渲染沙箱而非通用代码执行），且用现成的 Playwright API 就能满足 |

## 5. 关键判断题：纯 Python/Windows 原生方案够不够？

**结论：不够。文件与网络维度必须引入 Docker 或 WSL2 才能达到 E1 的判定标准；进程/内存/输出/凭据
四个维度纯 Python 标准库 + ctypes 已经够用，不需要 Docker/WSL。**

**依据**：

1. **实测**：6 类文件逃逸攻击、2 类无缓解网络攻击，在"naive"和"hardened"（Job Object + 干净 env）
   两种候选实现下**结果完全相同、全部未被拦截**。这不是候选实现写得不够细致的问题——Job Object
   从设计上就不提供文件系统命名空间或网络命名空间隔离（这是 Windows 和 Linux 的一个真实差异：
   Linux 的 mount namespace / network namespace 在 Windows Job Object 里没有对应物）。
2. **AppContainer 是唯一的纯 Windows 原生候选**，本次验证到它在 ctypes 下**可达**（这本身是个积极
   发现），但要真正用起来需要**持久性、机器级的 ACL 授权**，这个操作本身被 Claude Code 自己的权限
   系统当作"未审查的系统级变更"拒绝——即便是在一个专门为了验证沙箱可行性的 spike 里，日常 agent
   session 也没有理由拥有做这类变更的权限。生产环境里这意味着：要么在安装/部署阶段以管理员权限
   预置好所有 ACL（一次性但侵入性强，且要为每个新增依赖路径维护），要么放弃 AppContainer。
3. **旁证而非猜测**：这台机器上已经装着的其他 AI 编码工具（Codex CLI 及另一未具名工具）都没有走
   "纯 per-session Python"这条路——它们要么预置了专用低权限账户组（`CodexSandboxUsers`），要么
   预置了按可执行文件全路径限定的防火墙规则（`AIProxyGuard_*`），两者都是安装期/管理员权限的机器
   级配置。这是两个独立团队面对同一个 Windows 沙箱问题，各自都选择了"提前用管理员权限做机器配置"
   而不是"运行时用普通用户权限现场搭"，值得当作强信号。
4. **Docker/WSL2 在这台机器上的可用性（已查证，非假设）**：
   - Docker Desktop **已安装**（CLI 版本 29.5.2），但守护进程**未运行**
     （`docker info` 报 `failed to connect ... dockerDesktopLinuxEngine`，对应的
     `docker-desktop` WSL 发行版状态是 `Stopped`）。需要用户手动启动 Docker Desktop（大概率需要
     管理员权限完成首次启动的 Hyper-V/WSL2 后端初始化，取决于是否是首次使用）。
   - WSL2 **已安装且有发行版在运行**（`kali-linux`，状态 `Running`），另有 `AlmaLinux-9` 已装但
     停着。WSL2 提供真正的 Linux 内核 namespace（mount/net/pid），拿现成的 `unshare`/`bwrap`/
     容器化方案就能满足 E1 的判定标准，工程量远小于从零实现 AppContainer 或维护一堆按路径限定的
     防火墙规则。
   - 综合看，**WSL2 是这台机器上代价最低的路径**：已经在跑，不需要额外启动一个 VM 后端，agent
     生成的代码可以整体在一个"WSL2 里的低权限用户 + network namespace 隔离 + bind-mount 只读
     `repo/`、可写 `work/`"方案下执行。Docker Desktop 需要先解决守护进程未运行的问题，如果之后
     选它，本质上也是在 WSL2 之上再加一层（Docker Desktop 的 Linux 后端本身就跑在 WSL2 里）。
   - 代价：引入 WSL2 意味着 agent 生成的代码运行在 Linux 环境而非原生 Windows，对于"Web 前端 +
     headless 浏览器渲染"这个首个垂直场景没有实质影响（Linux 下的 headless Chromium 是最成熟、
     最常见的组合），但如果未来场景需要验证 Windows 原生行为（例如渲染依赖 Windows 字体渲染差异、
     或未来要跑 Windows-only 的构建工具链），就需要额外方案，这是一个要写进 ADR-0004 的已知取舍。

## 6. 对 `agent-engine-spec.md` §8 的具体修订建议

现状表格：

| 维度 | 默认 |
|---|---|
| 文件根 | 限定在本工作区，路径逃逸即硬失败 |
| 网络 | 默认关闭，L2 门控放行 |
| 进程 | 数量与生命周期受限，随 session 结束回收 |
| 时间 | 单次工具调用与整个 session 分别有上限 |
| 内存 / 输出 | 有上限，超限截断并告知 agent |
| 凭据 | 永不进入工作区 |

建议修订：

1. **拆分实现路径，明确标注哪些维度纯 Windows 原生方案不满足**：
   - 文件根、网络两行后面加注："在 Windows 原生（非 Docker/WSL）候选下未达成，需 WSL2/Docker
     承载，见 spike E1"。不要让读者以为这两行和进程/内存/凭据三行是同一套机制实现的——本次验证
     证明它们**不是**。
   - 进程、内存/输出、凭据三行可以标注"已验证：Job Object + 从空白构建的 env allowlist 满足"。
2. **内存这一行的措辞要更精确**："超限截断并告知 agent"对输出成立，但对内存不完全成立——Windows
   Job Object 的内存上限是让分配失败（`MemoryError`），不是主动杀进程；如果子进程 catch 住继续跑
   低内存路径，不会被强制终止。规范应该明确：内存上限**必须**同时配合"进程整体存活时间"或显式的
   健康检查，不能只依赖分配失败来保证子进程行为符合预期。
3. **凭据这一行要加一条硬性实现约束**："子进程环境**必须**从空白按 allowlist 构建，**禁止**
   `os.environ.copy()` 之后做减法。" 本次验证证明减法会漏（这台开发机的 shell 里就挂着好几个不
   相关工具的真实密钥，减法式的黑名单几乎不可能穷举）。
4. **`render` 工具的隔离要求应该和 `run_command` 分开写**，因为威胁模型不同（A2 证明可以用
   Playwright 原生能力更早满足），不要把两者绑在同一句"沙箱边界"里，否则容易造成"render 能跑通
   所以 run_command 的沙箱也差不多能用"的错误印象——本次验证证明这是两回事。
5. **ADR-0004 需要正面回答"用 WSL2 还是 Docker"，而不是笼统写"可能需要引入 Docker/WSL"**。
   基于 §5 的证据，建议 ADR-0004 的默认方向是 **WSL2**（已装、已在跑、代价最低），把 Docker 列为
   "如果需要更强的镜像/依赖隔离，或者需要在 CI 里跑，再迁移到 Docker"的后续选项，而不是两者平级
   并列。同时 ADR-0004 需要显式记录一条风险：Docker Desktop 当前守护进程未运行，如果后续改选
   Docker 路线，需要先验证"守护进程启动"这一步在用户机器上是否顺畅（是否需要管理员权限、是否需要
   重启），这一步本次 spike 没有验证到（没有获得管理员权限，也不在 spike 授权范围内去改系统级
   Docker/WSL 配置）。
6. **保留 AppContainer 方案的探索价值记一笔，但不作为当前路线**：本次验证证明 ctypes 层面可达，
   将来如果 Docker/WSL2 因为某个约束（例如必须原生 Windows 行为）被否决，AppContainer 仍然是一
   条已经验证过起点可行、只是需要专门的部署期 ACL 配置工作的备选路径，不需要从零重新调研。

## 7. 关键限制与诚实说明

- 本次 spike 在**非管理员** shell 下完成。所有"需要管理员权限"的结论（防火墙规则、AppContainer
  的 ACL 授权）是**实测报错拒绝**得到的，不是猜测；但没有在"有管理员权限"的条件下重跑一遍来确认
  "有了管理员权限之后这些方案能不能做对、做对要花多大工夫"——这是本次验证的一个真实盲区，如果
  团队决定认真评估 AppContainer 或防火墙路线，需要在有管理员权限的环境里补一轮。
- Docker 守护进程当前未运行，本次**没有**实际跑通"Docker 容器里执行攻击用例全部被拦截"这个正向
  证明——§5 的 Docker/WSL2 判断是基于"Linux namespace 隔离是成熟技术、WSL2 已经在这台机器上跑着"
  的工程判断，不是本 spike 里的实测数据。如果 ADR-0004 要基于"Docker/WSL 方案本身实测通过"来定案，
  需要补一个 E1 的后续 spike，在 WSL2/Docker 里重跑同一份 `attacks/*.py`。
- `attack_junction.py`、`attack_unc.py` 等攻击脚本本身也是不可信代码的"标本"，运行前已确认目标只
  指向本机已知只读位置（用户主目录、`C:\Windows\win.ini`、本地 loopback 管理共享），不产生破坏性
  副作用；`attack_memory.py`/`attack_stdout_flood.py` 在无防护模式下运行前评估过本机内存/磁盘余量，
  未导致本机不稳定。
- 没有打印任何真实 API key。凭据测试用的是运行时注入的假值 `sk-fake-not-a-real-credential-...`，
  真实凭据相关的发现（这台机器 shell 里已有其他工具的真实变量名）只报告了**变量名**，没有读取或
  打印**变量值**。
