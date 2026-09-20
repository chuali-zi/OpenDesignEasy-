> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../README.md)与 [ADR-0006](../adr/0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# Phase 6 framework and Luna handoff

> 状态：**P6 首个真实纵切已于 2026-08-04 闭环，八个 capability 槽全部由实际运行对象绑定并
> 通过同一次 acceptance。P6.6 的扩展故障注入和用户验收仍是发布前工作。**
> 场景：只读本仓库 → agent 前端工作台（含经 broker 驱动的真实或声明式 mock 后端）。
> 媒介：Web。生图默认关闭。G5 首个纵切通过，扩展验收仍为进行中。

## 1. 本轮交付边界

本轮已把八槽接入同一 `Phase6Application` 对象图：

- `SQLiteApplication` 接受 Design、Artifact、Quality、Delivery adapter 注入，旧的 P1～P4 调用保持
  确定性 fallback；
- `Phase6Application` 固定首片 profile，并列出八个真实 capability 槽；
- P6.1 `RepositoryIngestion` 接收用户授权句柄，生成受控只读快照、file/line-range native evidence，
  并可经通用 resolver 在重启后读取；
- fallback 和 `*-stub/*` 明确不计入 readiness；槽位不齐时 `require_real_slice_ready()` 必须失败；
- `WindowsAppContainerLauncher` 在包目录内以随机临时盘符启动零 capability 进程，并在 resume 前绑定
  Job Object；`NativeEsbuildBuilder` 使用冻结依赖镜像产出可渲染站点和逐层哈希；
- `TrustedWebRenderer` 通过短生命周期 `127.0.0.1` origin 启动系统 Chrome，阻断外链并记录截图、
  Chrome 版本、DOM 锚点和运行错误；Agent 完成门要求新鲜 build、健康 render 和截图后模型回合。
- `TerritoryDesignIntelligence` 产生 2～4 个外部分配的视觉领地；`WebArtifactProduction` 负责 Artifact、
  确定性 ZIP、安全解包和独立重渲染；`WebQualityPort` 使用真实 Chrome/computed-style/export 证据；
  Delivery 链固定为 `Validated → Durable → LocalImmutable`，重启可对账且不重复发布。

最新可复查证据：`spikes/phase6-closure/evidence/latest.json`。2026-08-04 运行在 900 秒预算内完成
AppContainer 双构建、Kimi 看图会话、repository ingestion、两个 Design 候选、Artifact Chrome 验证、
ZIP CRC/hash、安全解包重渲染、export Quality、immutable delivery 与 SQLite 重启恢复。

## 2. 冻结边界

Luna 接手时默认不得改动下列选择；需要改动时走新 ADR 或版本化 Spec：

| 边界 | 冻结选择 |
|---|---|
| Renderer | Playwright + 系统 Chrome；零外链；computed style；导出物重渲染 |
| Provider | vendor-neutral slots，首批 Kimi；生图可选且默认关闭 |
| Sandbox | AppContainer + Job Object + allowlist env；网络和真实后端经 trusted broker |
| Framework | React 19.1.1、MUI 7.3.1、固定 Emotion、native esbuild 0.25.12 |
| Theme | 六个不透明角色 token + trusted strict theme factory |
| Budget | 60 steps / 250k total token / 900s / 3 renders；超时如实失败 |
| Identity | 稳定业务 ID 经 props 透传，构建后 `data-oey-*` 唯一存活 |

规范来源为 ADR-0002～0005 与四份已冻结 Phase 5 Spec。E5 spool/named-pipe、E7 多 provider
校准、E12 降时延、E13 registry/`postinstall` 加固保留为后续优化，不阻塞 P6 首片；不得以优化为由
弱化现有安全和失败语义。

## 3. 组合框架

```text
Phase6Application
  ├─ durable project/runtime/evidence foundation (P1-P4)
  ├─ context.repository       P6.1
  ├─ agent.engine             P6.2
  ├─ design.intelligence      P6.3
  ├─ artifact.production      P6.4
  ├─ render.web               P6.4
  ├─ framework.build          P6.4
  ├─ quality.governance       P6.5
  └─ delivery.release         P6.5
```

readiness 从最终对象图计算：固定八槽，要求对象的 `p6_slot`、`ready_for_p6`、非 stub 版本和完整方法集。
`Phase6Bindings.infrastructure_versions` 只为旧调用者保留，已不能参与 ready 判定；缩减八槽会直接失败。

## 4. Luna 执行计划

### P6.1 — 仓库接入与 Context（已完成）

交付：实现授权根内的只读 `CODE_REPOSITORY` ingestion；排除 `.git/`、`node_modules/`、构建目录、
`.env` 与凭据模式；产生 file + line-range locator 和 Context Package。

验证：路径穿越/软链接/大小写边界攻击；仓库不可写；原生观察与机器解释分层；重启后 lineage 不变。

退出：已完成。`context.repository` 在 `Phase6Application` 默认组合中自动绑定
`repository-ingestion/1`；fixture 已验证快照、排除、locator、Context persistence 与重启读取。

### P6.2 — Agent session、沙箱与 broker（首个纵切已完成）

已完成的骨架：`AgentEngineScaffold`、持久 `repo/work/out/.agent` workspace、session turn history、
累积预算账本、repo 只读 API，以及严格 JSON action envelope 的 `AgentLoop`。session JSON 只保存工具
摘要、哈希、计量和错误类别，不保存 prompt、文件正文或凭据；预算续跑不重置。`SandboxCommand` /
`SandboxLauncher` 已把执行边界固定为无 shell、work/out cwd 和显式环境，`TrustedFetchBroker` 已把
E13 的精确 HTTPS URL、大小上限、重定向拒绝、整包 SHA-256 与审计元数据固定下来。

已完成：正式 Windows AppContainer + Job launcher、包目录工作区、随机盘符、allowlist env、超时/内存/
进程数约束，以及 build → Chrome render → 截图送模 → 完成门的真实 Kimi 会话。`agent.engine` 绑定
`agent-engine-appcontainer/1`。非 Windows 继续 fail closed；loopback backend broker 留给需要真实后端的纵切。

验证：复跑 E1、E5、E6、E7、E13；凭据不进入 env/workspace/ledger；取消回收完整进程树；续跑不重置预算。

退出：`agent.engine` 绑定 native launcher/session loop，复跑 E1、E5、E6、E7、E13；安全与恢复套件通过。

### P6.3 — Design Intelligence（首个纵切已完成）

已完成的基础：vendor-neutral capability registry、slot version/探针、trusted Kimi adapter 的
凭据隔离和空响应失败语义；不把 provider payload 写入 domain。

已完成：`graphite`/`paper`/`cobalt`/`moss` 四个外部分配领地、2～4 候选、稳定 anchor、方向修订与
approval 精确绑定；首片不依赖生图。真实 acceptance 生成并批准两个候选。

验证：provider payload 不进入 domain；computed-style 抽取确定；事实可回溯；候选分离度与六色纪律。

退出：`design.intelligence` 真实 adapter 通过同一 Port conformance。

### P6.4 — Framework Artifact、构建与渲染（首个纵切已完成）

已完成的确定性契约：固定 profile manifest、依赖版本校验、lockfile/tree hash、strict six-token theme
factory、构建后 `data-oey-*` anchor registry、外链拒绝，以及强制经 `SandboxLauncher` 的
`NativeEsbuildBuilder` 和 trusted Playwright/system-Chrome renderer 边界；已挂到
`SQLiteApplication.framework_artifact` / `.framework_builder` / `.renderer`。builder/renderer 在依赖
不可用时明确返回 `CAPABILITY_UNAVAILABLE`。

已完成：冻结依赖镜像经目标 Windows launcher 执行 native-esbuild，两次构建逐文件与 tree hash 一致；
系统 Chrome 真渲染、截图 SHA-256、DOM 锚点和 console/page/request 证据均已写入 closure evidence。
已完成：`WebArtifactProduction` 实现真实 `ArtifactProductionPort`；局部修改保持 anchor，Artifact 经系统
Chrome 验证，export 为固定顺序/timestamp/permission 的 ZIP，拒绝穿越、重复项、symlink 和超限内容，
安全解包后再次 Chrome 渲染并以 `0.002` diff 门验证。

验证：两次构建哈希一致；零外链；20 个复用锚点构建后唯一存活；strict theme 状态并集仅六色；
局部视觉差阈值 `0.002`；console/page/request 全记录。

退出：`artifact.production`、`framework.build`、`render.web` 三槽真实绑定并通过 A/E 等价套件；
当前契约层通过不等于三槽 ready。

### P6.5 — Quality、export 与 Delivery（首个纵切已完成）

已完成：Quality 要求真实 Chrome、运行时 anchor 唯一、无 overflow、computed style、运行错误为空；
export 必须有 CRC、逐文件 hash、独立解包重渲染和截图 diff。Delivery 精确校验 export revision、Quality
与 approval，外层 validation 在 durable claim 之前；immutable ZIP/receipt 可 reconcile，重启后 ID 不变。

验证：Artifact 截图不能冒充 export 验证；manifest/CRC/逐文件哈希；未批准发布拒绝；重试不重复副作用。

退出：`quality.governance` 与 `delivery.release` 真实绑定，完整场景可交付可使用产物。

### P6.6 — 恢复、成本、时延与 G5 证据

已交付：同一次真实运行的成本/时延、完整交付和跨进程恢复。待补扩展故障注入矩阵与外部用户验收记录。

验证：解析、provider、构建、renderer、Quality、export、Delivery 各阶段失败可区分；adapter 替换不改
Project 生命周期；900 秒超时不会被半成品伪装为成功。

退出：实施计划 Phase 6 的四项退出条件全部有可复查证据，届时才能关闭 G5。

## 5. 接手起点

下一步进入 P6.6：补 provider/build/render/export/delivery 故障注入矩阵、并发 side-effect claim 和外部用户
验收；不要再以字符串或改名 stub 修改八槽 readiness。

```bash
python -m pytest
python -m oeydesign.phase6_acceptance
```

接手前先查看 `Phase6Application.readiness.missing`。每完成一个真实能力，只在其 conformance 和安全测试
通过后登记 `capability_version`；不要删除 readiness 门，也不要把 deterministic stub 改名伪装成 real。
