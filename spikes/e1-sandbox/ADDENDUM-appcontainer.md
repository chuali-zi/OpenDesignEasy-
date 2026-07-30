# E1 追加实验：AppContainer 是可行的 Windows 原生沙箱

> 日期：2026-07-27。执行者：主 agent。
> 结论：**推翻 `RESULT.md` §5「纯 Python/Windows 原生方案不够，必须引入 Docker/WSL2」。**
> 原始数据：`ac_escape_result.json`；脚本：`appcontainer_v2.py`、`ac_escape_test.py`。

## 1. 为什么要重做

首轮 E1 的结论是「Windows 原生做不到文件与网络隔离，必须上 Docker/WSL2」。这个结论建立在两个
前提上，**两个都不成立**：

1. 首轮只测了 **Job Object + 干净 env**。Job Object 从设计上就不提供文件系统或网络命名空间隔离，
   所以它测出「文件逃逸 6/6 未拦截」是**必然**的，不能推广为「Windows 做不到」。
2. 首轮的 AppContainer 探针**试图启动 `python.exe`**，因为 Python 安装目录没有 AppContainer 的
   ACE 而挂在 `STATUS_DLL_NOT_FOUND`，随后就放弃了。但 **`%SystemRoot%\System32` 本来就授予
   `ALL APPLICATION PACKAGES` 读+执行**（否则这台机器上所有 UWP 应用都跑不起来），所以换成
   **系统自带二进制**就能启动，根本不需要碰 Python 安装目录。

## 2. 关键设计修正：工作区放在 AppContainer 自己的包目录

前两次尝试还踩了一个坑：把工作区建在 `D:\projects2\...` 下，然后只对**叶子目录** `icacls /grant`。
结果连「已授权」的目录都读不到——因为 AppContainer 要访问一个路径，**路径上每一级祖先都必须
授予 traverse 权限**，只授叶子没用。

正确做法：用 **AppContainer 自己的包目录**
`%LOCALAPPDATA%\Packages\<profile>\AC\`。Windows 在 `CreateAppContainerProfile` 时**自动**为该
容器 SID 配好 ACL。实测该目录的 ACL 为：

```
S-1-15-2-...(容器SID):(OI)(CI)(CR)(F)
```

**零 icacls、零管理员、零祖先授权。** 这也正是所有 UWP 应用获得本地存储的方式。

## 3. 逃逸测试实测结果

零 capability 的 AppContainer（`CapabilityCount = 0`）内运行 `cmd.exe`，每个探针独立一次调用：

| 探针 | 期望 | 实测 | 输出 |
|---|---|---|---|
| A 读 容器内工作区 | 允许 | ✅ **ALLOWED** | `INSIDE-OK` |
| B1 读 仓库内文件（容器外） | 拒绝 | ✅ **DENIED** | `Access is denied.` |
| B2 读 用户主目录文件 | 拒绝 | ✅ **DENIED** | `Access is denied.` |
| C 读 `C:\Windows\win.ini` | 信息性 | ⚠️ ALLOWED | OS 文件，见 §5 |
| E 写 容器内工作区 | 允许 | ✅ **ALLOWED** | `W` |
| F 写 容器外（仓库目录） | 拒绝 | ✅ **DENIED** | 文件未生成 |

### 网络（单独测，用 System32 自带 `curl.exe` 与 `ping`）

| 探针 | 实测 |
|---|---|
| `curl http://example.com` | ✅ **失败**，rc=1，无输出文件 |
| `curl http://1.1.1.1`（裸 IP，绕过 DNS/代理） | ✅ **失败**，rc=1，无输出文件 |
| `ping 1.1.1.1` | ✅ **失败**：`Unable to contact IP driver. General failure.` |
| `certutil -urlcache http://...` | ✅ **连启动都被拒**（`CreateProcessW` error 5） |

**这是 OS 网络栈层面的拒绝**，不是代理环境变量、不是防火墙规则。首轮 E1 里「raw socket 绕过代理
变量」那条攻击路径在这里**直接失效**——裸 IP 也连不出去。且**不需要管理员权限**。

## 4. 运行时 bootstrap 可行

把一个二进制**复制进包目录再执行**：

```
copied C:\Windows\System32\curl.exe -> <AC>\Temp\ws\copied_curl.exe  (818,512 bytes)
执行 rc = 0
输出：curl 8.21.0 (Windows) libcurl/8.21.0 Schannel ...
```

复制进包目录的二进制**可以正常执行**。所以「Python/Node 安装目录没有 ACE」这个首轮的拦路虎，
解法不是给系统目录授权，而是**把运行时放进容器自己的包目录**。这是一次性的、容器内的、
不触碰任何系统位置的操作。

## 5. 诚实的限制

1. **`C:\Windows` 与 `System32` 对容器可读**。这是 Windows 的设计（`ALL APPLICATION PACKAGES`
   在这些位置有 RX），不是配置错误。对我们的威胁模型可以接受：要保护的是**用户的项目文件与
   凭据**，不是 OS 自带的非机密文件。但必须写进 spec，不能让人误以为是全盘读黑洞。
2. **未测**：进程内直接调用 Win32 API 的逃逸尝试（本次探针都经由 `cmd.exe`）、
   AppContainer 已知的历史提权 CVE、以及命名管道/COM 等跨容器 IPC 面。
3. **未测**：把真实的 Node/Python 运行时完整塞进包目录后，其依赖解析是否全部正常
   （本次只验证了单个自包含 exe）。
4. 本次全部在**非管理员** shell 下完成——这正是结论的价值所在。

## 6. 结论：Windows 原生方案成立

| 维度 | Job Object（首轮） | **AppContainer（本次）** |
|---|---|---|
| 读 容器外文件 | ❌ 6/6 逃逸 | ✅ **拒绝** |
| 写 容器外文件 | ❌ 逃逸 | ✅ **拒绝** |
| 网络（含裸 IP） | ❌ 逃逸 | ✅ **拒绝**（OS 强制） |
| 进程树回收 | ✅ | 由 Job Object 补 |
| 内存上限 | ✅ | 由 Job Object 补 |
| 输出截断 | ✅ | 由 Job Object 补 |
| 凭据隔离 | ✅（白名单 env） | 同左 |
| 需要管理员 | 否 | **否** |

**推荐架构：AppContainer（文件 + 网络）× Job Object（进程 + 内存 + 时间）× 白名单 env（凭据）。**
三者组合覆盖 `agent-engine-spec.md` §8 的全部六个维度，**纯 Windows 原生，不需要 Docker 或 WSL2**。

这也正是 Chromium 自己在 Windows 上的沙箱做法（restricted token + job object + AppContainer），
属于经过大规模验证的成熟组合，不是我们发明的新路子。

## 7. 对 ADR-0004 的建议

**不要**把 ADR-0004 写成「默认 WSL2」。改为分层：

1. **首选：Windows 原生 AppContainer + Job Object**。已实测覆盖全部六维度，零管理员、
   零额外依赖、与用户的 Windows 开发环境同构（产物就是在 Windows 上跑的）。
2. **备选：WSL2 / Docker**。当出现以下任一情况时启用：
   - 需要 Linux-only 的工具链；
   - 需要与 CI（通常是 Linux）行为一致；
   - AppContainer 的运行时 bootstrap 在某个真实运行时（Node）上被证明不可行（§5.3 待测）。
3. **必测的遗留项**（进 ADR 前必须补）：把真实 Node 运行时塞进包目录跑通；
   直接 Win32 API 层面的逃逸尝试。

首轮结论中「其他 AI 工具都用管理员预置方案（Codex 的 `CodexSandboxUsers` 组、
`AIProxyGuard_*` 防火墙规则）」这条观察仍然成立，但**不再构成必须跟随的理由**——
那些方案解决的是「给任意已安装的 exe 加网络限制」，而我们的场景是
「我们自己决定在哪里、以什么身份运行agent 产出的代码」，可以从一开始就设计成 AppContainer 友好。
