> **历史资料：已被 2026-09-12 的 D 路线替代。** 当前方案见 [文档入口](../README.md)与 [ADR-0006](0006-full-typescript-design-platform.md)：全 TypeScript、Pi SDK、完整直接编辑、人机双向同步、Web/CLI/TUI/Desktop 共用核心。
> 下文的“当前”“冻结”“已接受”、Python/sidecar/兼容层建议和阶段验收只适用于旧版本，不约束新实现。原文保留用于理解旧代码、研究结论与数据迁入；不能据此宣布新重构已完成。

# ADR-0005：框架应用基底

> 状态：**已被 ADR-0006 取代；仅作历史记录。**
> 原状态（历史）：**已接受（受限 P6 profile）**。
> 日期：2026-08-03。
> 决策范围：第三种 Design 实现基底及其 Artifact 工作表示、构建和主题纪律。

## 上下文

已冻结的 Design v0.4 只有 `bespoke` / `system`，Artifact v0.4 主要描述静态 Web 项目。E8–E13
证明组件框架可行，但只在固定 React/MUI/native-esbuild、trusted renderer 和严格主题工厂的 profile
下成立。通用 Node/Vite 仍受 AppContainer pipe 语义限制；E12 的 provider 长推理风险已被显式接受。

## 决策

- 增加第三种实现基底 `framework`，P6 允许使用；`bespoke` 与 `system` 继续保留。
- 首版唯一支持的 framework profile：
  - React `19.1.1`；
  - MUI `7.3.1` + Emotion 固定依赖；
  - 原生 esbuild `0.25.12` trusted builder；
  - trusted host renderer；
  - 引擎生成并锁定的 strict six-token theme。
- 不承诺 Vite plugin、HMR、Vue SFC、SSR、任意 Node codegen 或容器内 dev server。
- framework Artifact 工作表示包含 `src/`、固定 manifest/lockfile、builder profile、`dist/` 和
  `artifact-manifest.json`；交付默认包含可复现源码与已验证 `dist/`，具体清单由 delivery profile 固定。
- `data-oey-*` 身份由业务层生成并经 props 显式透传，必须在构建后 DOM 中唯一存活；不得使用随机数、
  数组下标或 React 自动 ID 作为持久对象身份。
- agent 只提交六个不透明角色 token；trusted theme factory 填满 palette/status/grey/action 和组件
  override。rest/hover/focus/disabled 的 computed color 并集不得超出声明 token。
- 新依赖遵循 ADR-0004 的 trusted fetch broker；运行产物仍不得依赖外链。
- E12 超时不视为成功：超过 900 秒必须返回未完成。该风险不再阻塞 P6 启动，但进入稳定发布前必须
  用真实样本报告完成率、成本与时延。

## 跨冻结规范效力

本 ADR 是 Design v0.4 §4.2.2/§7 与 Artifact v0.4 §3/§3.1 的规范化扩展。两份原文不被静默改写；
发生冲突时，本 ADR 仅在 `framework` profile 范围内优先。其他基底继续遵循原规范。

## 备选方案

### 不接受 framework

边界最小，但放弃已通过 E8–E11/E13 的组件复用、锚点和确定构建能力。

### 接受任意 React/Vue/Vite 工具链

超出实验覆盖并破坏 AppContainer 运行时结论，拒绝采用。

### 只交付 `dist/`

运行简单但失去可复现编辑与后续局部修改依据，因此源码、lockfile 与 dist 一并纳入交付清单。

## 影响

P6 可以搭建真实组件化工作台，并保持离线运行、对象定位和主题纪律。代价是首版技术栈较窄、需要
trusted builder/theme factory，且 provider 超时必须作为真实失败观测。

## 替换条件

新增框架或构建器必须在零网络沙箱、确定构建、锚点存活、主题状态和导出重渲染上通过 E8–E13 等价
套件，再通过新 ADR/版本化 Spec 纳入。不能仅凭开发便利扩大 profile。
