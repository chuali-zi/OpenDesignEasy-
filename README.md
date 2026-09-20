# OEYdesign

OEYdesign 的目标是一个可持续协作的多模态设计应用：用户与 agent 共同编辑 Web、演示文稿和文档，既可以对话，也可以直接拖拽、缩放、编辑图层与文字，并从同一项目导出真实产物。

## 当前主线：全 TypeScript 重构

**2026-09-12 用户已选择 D 路线。** 新核心直接组合 Pi SDK；文档编辑、渲染、解析、导出、存储和四种客户端全部采用 TS 应用代码。新产品不运行 Python 服务、sidecar 或旧系统兼容层。

- Web 与 Desktop 提供完整可视化编辑器及 agent 对话。
- CLI 与 TUI 直接使用同一核心，支持项目、设计操作、agent、版本、渲染与导出。
- 人工操作和 agent 操作提交到同一份可编辑文档，共享对象 ID、修订、撤销重做与冲突处理。
- Web、Deck、Doc 保留各自布局语义，共享项目、素材、设计决定和操作机制。

**状态（2026-09-20）：R1 已完成；R2 Deck 编辑与导出已完成本轮验收，R3 产品 agent 已接入并通过真实兼容服务验证。** 现有实现支持富文本、图片裁切、图层与几何、对齐吸附、原生表格/图表、PPTX/PDF/PNG；三页混排及实际模型生成的四页作品均已在 PowerPoint 打开。兼容服务完成讨论、共同编辑、提问重启和图片生成/识图检查，原生 provider 实测仍待授权。Node 24 的单元/集成回归 53/53 通过。详情和未结案项目见 [R2/R3 实现与验收](docs/spec/r2-r3-validation.md)。R4–R7 的其他媒介、TUI/Desktop、旧数据迁移与跨平台发行尚未完成；旧 Python Studio 的测试不作为新架构证据。

## 开发入口

1. [AGENTS.md](AGENTS.md)
2. [文档与状态索引](docs/README.md)
3. [产品需求](docs/prd.md)
4. [总体架构](docs/architecture.md)
5. [完整重构计划](docs/spec/implementation-plan.md)
6. [共享文档与直接编辑](docs/spec/editor-document-spec.md)
7. [多客户端与交付](docs/spec/clients-spec.md)
8. [已采用的 D 路线决策](docs/adr/0006-full-typescript-design-platform.md)
9. [R1 兼容性与状态](docs/spec/r1-compatibility.md)
10. [R2/R3 实现与验收](docs/spec/r2-r3-validation.md)

CLI 和 Web 使用同一无头核心与 Pi 产品会话。TUI、Desktop、Web 文档生产和 Doc 按后续实施计划推进。

## R1 CLI 快速检查

在 Node 24 目标环境中，可以用下面的命令创建项目、创建文档并按 JSON 返回的稳定 ID 读取文档：

```powershell
npm install
npm run oey -- project create .tmp/demo --name "CLI demo"
$created = npm run oey --silent -- document create .tmp/demo --name "Demo deck" | ConvertFrom-Json
npm run oey -- document read .tmp/demo $created.document.documentId
```

命令不需要 Python、Web 服务或模型 key。`document create` 的 stdout JSON 中的 `document.documentId` 是后续命令使用的文档 ID；项目和文档读取结果也都以 JSON 输出。完整检查还包括 `npm test`、`npm run typecheck`、`npm run build` 和构建后的 `node dist/oey.mjs --help`，具体通过状态见 [R1 兼容性与状态](docs/spec/r1-compatibility.md)。

## R2 Web 开发入口

可用单个 production host 试用当前设计对话与 Deck 编辑器：

```powershell
npm run build:web
npm run web -- --project .tmp/workbench
```

`npm run build:web` 生成 `apps/web/dist`，随后 `npm run web` 由本地 host（默认 `localhost:4318`）同时提供 UI 和 API。开发时也可单独运行 `npm run dev:web`，它启动 Vite 并代理到 host。已有 `.env` 的模型配置由服务端读取；无模型凭据也可手工编辑和导出。[验收文档](docs/spec/r2-r3-validation.md)提供 CLI 独立运行及接续 Web owner 的命令。

## 运行现有旧版

查看旧产品和比较结果时，可继续使用：

```powershell
.\start-studio.ps1
```

旧 Studio 使用 FastAPI/Python，默认 API/UI 为 8880、预览为 8881。凭据与启动要求见 [旧 Studio 说明](docs/studio/README.md)。旧 Phase 6 workbench 的说明见 [历史 Phase 6](docs/phase6/README.md)。

这些命令不启动新 TS 应用。完整重构中的旧数据导入、源码退役和交付切换均在新实施计划中；本次文档变更没有删除运行代码或迁移项目数据。
