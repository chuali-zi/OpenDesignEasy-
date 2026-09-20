# R1 依赖兼容性验证

版本基线：2026-09-12；R1 Windows 开发宿主与 Pi faux 检查更新于 2026-09-20。本文记录已经从 npm 发布包或实际运行时核实的结果。R1 的 faux provider 检查不代表真实 provider 交互或产品 agent 接入；真实 provider、图片和产品 runtime 集成属于 R3。

## 建议固定版本

| 作用 | 固定值 | 依据与状态 |
|---|---|---|
| Node 核心运行时 | `v24.21.0` | Node 官方 v24 发布页与 2026-09-09 LTS 发布公告；Windows x64 binary 已于 2026-09-20 实际运行，`node:sqlite` 通过 |
| TypeScript | `typescript@5.9.3` | Pi 0.85.1 发布包的 devDependency 也是 5.9.3；成熟工具链基线 |
| TypeScript 执行器 | `tsx@4.23.13` | npm 发布版本查询；用于 CLI/脚本执行 |
| Node 类型 | `@types/node@24.13.4` | npm 发布版本查询，与 Node 24 主线一致 |
| Pi 公共 SDK | `@earendil-works/pi-coding-agent@0.85.1` | npm tarball `sha512-FGRN+OHbWaefBPGaTggAdLjrIHW+s2PzLyglz/5dfLzb9of7uuXMXYC0fJIeZTw+shS32o2cuQ9jF7YSDuL/oQ==`；已实际解包检查 d.ts/文档 |
| Pi agent core | 由 Pi SDK 固定 `@earendil-works/pi-agent-core@0.85.1` | Pi SDK 0.85.1 的运行依赖；公共 `AgentOptions` 暴露控制 hook |
| Pi AI（R1 faux 探测） | `@earendil-works/pi-ai@0.85.1` | Pi SDK 运行依赖；发布包公开 `fauxProvider`，只用于本地确定性检查 |
| Pi 工具 schema | `typebox@1.3.7` | Pi SDK 运行依赖；`customTools` 参数 schema 使用 |
| Konva | `konva@10.5.0` | npm 发布版本查询；坐标归一化探测已通过 |
| Electron | `electron@44.3.0` | Windows x64 官方 binary 已于 2026-09-20 实际运行；内嵌 Node `v24.20.0` 的 `node:sqlite` 和真实 `utilityProcess` 均通过 |
| ProseMirror 模型 | `prosemirror-model@1.25.11` | npm 发布版本查询 |
| ProseMirror 变换 | `prosemirror-transform@1.12.1` | npm 发布版本查询 |

Node 与 Electron 的小版本应分别固定。Electron 44.3.0 的内嵌 Node 是 24.20.0，不能把 Electron 的内嵌版本当作核心 CLI 使用的 Node 24.21.0；Node 的 `node:sqlite` 也必须在两个宿主中分别探测。

## Pi 发布包核验

从 npm 下载并解包 `@earendil-works/pi-coding-agent@0.85.1` 后，发布包的 `docs/sdk.md` 和 `dist/**/*.d.ts` 确认了以下公共表面：

- `createAgentSession({ customTools })` 注册自定义工具。
- `AgentSession.steer(text, images?)` 和 `followUp(text, images?)` 分别排队 steering 与 follow-up 输入。
- `AgentSession.sendCustomMessage(...)` 写入 custom message entry；`AgentSession.abort()` 取消当前操作。
- 低层公开依赖 `@earendil-works/pi-agent-core@0.85.1` 的 `AgentOptions` 和 `Agent` 实例暴露 `beforeToolCall` 与 `shouldStopAfterTurn`。
- `beforeToolCall` 返回 `{ block: true, reason, terminate }` 可以阻止工具执行；混合工具批次的终止语义仍以 Pi 规则为准。
- `shouldStopAfterTurn` 在当前 turn 与工具执行正常完成后运行，返回 `true` 时在轮询队列、发起下一次模型请求前结束；它不会取消已经运行的工具。

### 无网络、无凭据的隔离 AgentSession 检查

[`scripts/ts/check-compatibility.ts`](../../scripts/ts/check-compatibility.ts) 使用 Pi 发布的 `faux` provider、内存凭据/设置/会话和随机临时目录创建真实 `AgentSession`。`DefaultResourceLoader` 关闭 extensions、skills、prompt templates、themes、context files；`ModelRuntime` 关闭模型网络刷新。没有 API key、用户凭据、默认扩展加载或真实 provider 请求。检查内容是：

1. 确认 `customTools` 注册并成功执行一次；在进行中的 faux 请求期间通过公开 session API 排入 steer 与 follow-up，并检查两条输入确实出现在后续模型上下文中；发送 custom message。
2. faux tool call 实际触发 `beforeToolCall`，返回 block 后工具执行数为 0。
3. faux 工具批次执行完成后调用 `shouldStopAfterTurn`，返回 true 并在下一次模型请求前停止。
4. faux 模型响应工厂停在 AbortSignal 上，调用 `AgentSession.abort()` 实际中止正在进行的模型请求；run 正常收敛，session 回到 idle。
5. 每个运行与等待操作设置有限超时；finally 中 abort/等待 idle/dispose session，并删除隔离临时目录。

在根 workspace 和 Node 24.21.0 Windows binary 下均运行通过：

```text
status: pass
package: @earendil-works/pi-coding-agent@0.85.1
provider: Pi faux provider
network: false
credentials: false
extensions: false
agentSession: customToolRegistered=true, successfulToolExecutions=1, fauxCalls=3, steerDelivered=true, followUpDelivered=true
beforeToolCall: calls=1, blockedToolExecutions=0, fauxCalls=1
shouldStopAfterTurn: calls=1, toolExecutionsBeforeStop=1, fauxCalls=1
activeAbort: abortedInFlightModelRequest=true, sessionIdleAfterAbort=true, fauxCalls=1
```

运行命令：`npm run check:compat`；目标 binary 复跑命令：`node-v24.21.0-win-x64.exe --import tsx scripts/ts/check-compatibility.ts`。首次直接启动 Node 24 binary 总耗时约 22 秒，而 probe 自报运行时间约 0.1 秒。原 `npm run check:compat` 首次等待 10 秒时仍在运行，随后轮询已看到 exit 0 和完整输出；本轮没有复现挂起，表现为启动时长与输出延迟。此检查验证 Pi SDK 的本地 AgentSession 接法和 faux 行为，不验证真实 provider 的流式、图片、工具格式或计费行为；真实会话接入仍按 R3 做 provider 配置检查。

## Node、Electron、SQLite 与 Konva 探测

[`scripts/ts/check-runtime-compatibility.ts`](../../scripts/ts/check-runtime-compatibility.ts) 提供四个可执行探测：

```powershell
npx tsx scripts/ts/check-runtime-compatibility.ts
$env:ELECTRON_BIN = 'C:\path\to\electron.exe'
npx tsx scripts/ts/check-runtime-compatibility.ts
```

- Node：动态导入 `node:sqlite`，创建内存数据库、写入并读取一行数据。
- Electron：只有设置 `ELECTRON_BIN` 才运行；先用 `ELECTRON_RUN_AS_NODE=1` 探测内嵌 Node，再启动 Electron 主进程，由真实 `utilityProcess` 执行内存 SQLite 操作并回报它的 Node/SQLite 版本。utility probe 不创建窗口。
- Konva：用 `konva/lib/Util.js` 的 `Transform` 生成平移/旋转矩阵，把绝对点通过逆矩阵归一化回局部坐标，检查误差小于 `1e-9`。

Node v25.6.1 的早期探测只用于检查脚本；目标版本结论以 2026-09-20 的 Node 24.21.0 与 Electron 44.3.0 Windows x64 binary 复核为准，结果见下文。

## 一手资料

- [Node.js releases](https://nodejs.org/en/about/previous-releases) 与 [Node 24.21.0 发布公告](https://nodejs.org/en/blog/release/v24.21.0)。
- [Node `node:sqlite` 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。
- [Electron 44.3.0 release matrix](https://releases.electronjs.org/release/v44.3.0)。
- [Electron 44 官方公告](https://www.electronjs.org/blog/electron-44-0)。
- [Pi v0.85.1 SDK 文档](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)。实际 API 还以 npm 发布 tarball 中的 `dist/**/*.d.ts` 为准。
- [Pi agent-core 类型](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/types.ts)。
- [Konva Transformer 文档](https://konvajs.org/docs/react/Transformer.html)。
- [ProseMirror guide](https://prosemirror.net/docs/guide/)。

真实 Pi provider 流式请求、steer/follow-up 发生在工具执行中时的时序与取消后的晚到结果仍按 R3 验证；Node/Electron 目标 binary 的宿主检查已在 2026-09-20 完成，完整 Desktop 应用仍按 R6 验证。

## Windows x64 宿主复核（2026-09-20）

用官方预编译文件完成目标小版本运行，没有安装系统级 Node 或 Electron：Node binary 位于 `.tmp/r1-host/node-v24.21.0-win-x64.exe`；Electron 44.3.0 官方 `win32-x64` 压缩包解到 `.tmp/r1-host/electron-v44.3.0-win32-x64/`。Node 文件 SHA256 与 Node 官方 `SHASUMS256.txt` 一致。它们是本机临时验证文件，不是产品交付目录。

宿主检查结果：Node `v24.21.0` 的 `node:sqlite` 内存库读写通过（SQLite `3.53.4`）；Electron 主进程的内嵌 Node `v24.20.0` 也通过同一接口；真实 Electron `utilityProcess` 在 Electron 内嵌 Node `v24.20.0` 下创建、写入并读取 SQLite 成功（SQLite `3.53.4`）。因此 Desktop 核心进程可按架构计划运行在 Electron utility process 中使用 `node:sqlite`；Node `v24.21.0` 仍是独立 CLI/runtime 基线。Konva 坐标反变换也通过，最大误差约 `1.8e-15`。

同一 Node 24.21.0 binary 运行 R1 核心和 CLI 测试，18/18 通过；其中包括真实 CLI 子进程往返、跨进程 owner 锁，以及进程在 SQLite 事务中退出后的回滚检查。owner 锁偶发测试失败已定位为测试 fixture 问题：fixture 没保留 runtime 引用，空闲 SQLite 连接因此可被 GC 回收；强制 GC 可以复现，修正 fixture 保留引用后通过，owner 实现无需改动。packages、CLI 和 TS scripts 使用根 tsconfig strict 选项单独 typecheck 通过。`scripts/ts/build.ts` 的 CLI esbuild 构建通过，生成的 `dist/oey.mjs --help` 可在 Node 24.21.0 下运行。文档操作检查还覆盖图层重排最终索引、reparent 默认追加、祖先锁，以及无关位置修改不阻止文本步骤。

R1 目标范围的核心 typecheck、测试与 CLI 构建均通过。2026-09-20 的最终宿主与 R2 基础检查中，Node 24 全 workspace TypeScript 检查、Web production build、29/29 单元/集成检查及 Chrome 3/3 通过；`npm install` lockfile 同步完成。R2 实测范围包括基本文字与几何编辑、撤销/重做、重载、PPTX 下载、画布拖动/缩放/旋转和切换文档时旧版本响应保护；PPTX 重复 `pPr` 已修复，三页 XML 检查通过。Node 24 重建的 CLI bundle 也通过真实进程端到端检查：创建项目和文档、插入文字并导出 PPTX，产物为一页原生 `p:sp`，其中的文本与 revision 1 相符；未在 Office 应用中打开验证。R2 仍未完成图片、完整富文本、吸附/对齐、PDF、实际 Office 打开和完整验收。Web 相关结果不改变 R1 的 Windows 开发基线和跨平台干净安装仍待 R7 的范围说明。

当前 PPTX 导出依赖链中的 PptxGenJS 4.0.1 带入 `image-size@1.2.1`，`npm audit` 报告 2 个 high 漏洞（影响 ICNS/JXL/HEIF 解析）。现有导出不接受 image 节点，且 PptxGenJS 发布产物中未发现对 `image-size` 的调用，因此当前没有新增图片解析路径；R2 启用图片解析前需处理该依赖告警。

## 历史收尾记录（2026-09-12；已由 2026-09-20 宿主复核更新）

- 本机 Node v25.6.1：`npm test` 最终 18/18 通过；`npm run build`（含 strict typecheck）通过；构建后的 `node dist/oey.mjs --help` 可运行。
- 当时 Node 24.21.0 binary 尚未完成验证；该状态已由上文 2026-09-20 Windows x64 检查替代。
- 当时 owner 测试的偶发失败原因尚未定位；已由上文确认是测试 fixture 未保留 runtime 引用，owner 实现本身无需修改。
- R1 当时仍在进行；现已按 Windows 开发基线完成。跨平台干净安装仍待 R7。
