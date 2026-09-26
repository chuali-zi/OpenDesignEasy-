# R4 Web 实现与验证

> 状态更新：2026-09-26。R4 正在实施，当前已交付 Web 文档、无头生产与 DOM 编辑基础；完整 R4 尚未验收。后续状态以[实施计划](implementation-plan.md)为准。

## 本阶段已实现

- `WebDocument` 从边界类型接入正式运行路径：页面/路由、原生节点树、flow/flex/grid/position 布局、断点覆盖、图片资产、受管 TS/TSX/CSS 模块和组件绑定。
- Web 命令通过同一个 runtime/SQLite 提交，保存修订、事件和统一历史。支持撤销、重做、版本恢复与关闭后重开；无关属性的陈旧操作可合并，同属性和删除已修改子树返回冲突。
- CLI 可以创建 Web 文档、提交命令、修改文本、读取、渲染 HTML，以及导出静态 ZIP、React/Vite 源码 ZIP、PDF 和 PNG。全过程不需要 Web 服务或可见浏览器。
- Web host 的创建、读取、命令、历史和导出接口支持两种已实现媒介。HTML 预览位于独立沙箱文档中；agent 的 schema、编辑、预览和导出读取同一文档。
- 静态 HTML、PDF 与编辑用 DOM 共用原生结构/CSS 投影。源码输出保留稳定节点 ID、页面路由、响应式样式、本地图片和组件引用；表单默认是本地演示，不发送数据。
- Web 工作台可新建/切换文档，编辑页面名称/路由，选择原生 DOM 元素、拖动重排/重新归属容器、自由移动定位元素、缩放、旋转、调整样式和断点；图层支持锁定、隐藏、复制、删除，图片使用共享资产。
- 属性草稿保留起始修订；同字段冲突保留输入，可重新应用或恢复已保存值。拖动在固定快照上完成一次命令。CSS/TS/TSX 源码编辑进入同一历史，保存期间锁定输入，陈旧源码修改不会覆盖远端版本。
- 产品提供 `build.zip`：从已提交修订生成源码，在临时目录以固定配置调用 Vite，返回生产 HTML/JS/CSS/资产和修订元数据。CLI、host、agent 共用同一入口，支持取消与构建超时；不执行项目安装脚本或自定义构建配置。
- 图形编辑器可以将原生容器绑定到受管 TSX 导出，编辑组件 props，再通过“更多导出 → 构建应用 ZIP”生成应用。语法错误会返回构建信息，源码可通过统一历史撤销恢复。

## 使用入口

```powershell
npm run oey -- project create .tmp/my-site
npm run oey -- document create .tmp/my-site --kind web --name "My site"
npm run oey -- document read .tmp/my-site
npm run oey -- document apply .tmp/my-site command.json
npm run oey -- document render .tmp/my-site <documentId> --output .tmp/site.html
npm run oey -- document export .tmp/my-site <documentId> --output .tmp/site.zip
npm run oey -- document export .tmp/my-site <documentId> --output .tmp/site.source.zip
npm run oey -- document export .tmp/my-site <documentId> --output .tmp/site.build.zip
```

命令文件采用现有 `CommandEnvelope`；页面和节点使用 `web.page.*`、`web.node.*`、`web.style.update`、`web.layout.update`、`web.breakpoints.update`，源码通过 `source.update`/`source.remove` 修改。`position` 是显式定位布局模式，具体定位由 `layout.position` 和 CSS 的 left/top 等属性表达。它不改变流式对象的拖动语义。

源模块的 `path` 相对于生成项目的 `src/`；不允许覆盖生成入口。绑定组件公开导出名与 props，由源码构建运行，静态导出遇到组件时返回明确错误。导出的 React/Vite 项目运行 `npm install`、`npm run build`；生产托管需要页面路由回落到 `index.html`。

`source.zip` 包含可继续修改的源码项目；`build.zip` 包含已构建的应用文件，解压后交给静态 Web 服务器托管。当前内置构建支持已管理的本地模块、CSS、React 与 React DOM，额外第三方依赖需另行接入。编辑器里的 DOM 预览仍显示自定义组件边界，静态 HTML/PDF/PNG 尚不运行组件代码。

## 本轮检查

验证使用 Windows、Node 24.21.0 与 headless Chrome；未调用真实模型服务。

- runtime/host/CLI 集成：Web 创建、保存、同属性冲突、无关修改合并、删除子树保护、解锁、源码冲突、撤销重开和两种 ZIP 导出。
- Pi faux provider：真实 SDK 工具读取 Web schema，保留人工标题并改样式，导出同一修订的 HTML。
- 实际 Vite 构建和 Chrome：中文与大括号文本、打包图片解码、表单反馈、受管组件计数器、两页导航及桌面/移动宽度变化。
- 原 Deck 内核、编辑操作、PPTX、图像/PDF、会话恢复和 CLI 回归继续运行，避免引入第二媒介后破坏已完成路径。
- DOM 编辑阶段：TypeScript 检查、Web 生产构建和 Chrome 9/9 场景通过；覆盖 Deck 4 个既有场景，以及 Web 路由/响应式/历史重开、图层/源码、真实拖动/缩放/旋转/图片、属性冲突与源码并发保存。已查看实际工作台截图。
- 审查修复：文档切换时清空 agent 选择上下文，忽略跨文档迟到响应，抑制同修订无效刷新；修复 Deck 富文本键盘选区过程中自动保存的竞争，并用持续超过保存延时的键盘选区验证。
- 构建阶段：Node 24 全套 TS 测试 70/70；Chrome 11 个场景连续两轮 22/22。新增组件绑定/props、生产应用下载、语法错误反馈与撤销恢复；Deck 自动保存结束后恢复光标，用户转移焦点时不抢焦点。
- 打包后的 `dist/oey.mjs` 实际创建项目、添加 React 计数器并生成 `build.zip`，检查压缩包的应用入口、资产和文档修订元数据；全过程未启动 Web host。媒体测试还在 Chrome 中点击构建后的计数器，确认交互实际运行。
- 重复回归使用各自独立的 Deck 文档；富文本用真实点击和逐字键盘输入验证。测试还发现并修复了新文档已显示但选择器列表尚未更新的时序问题。

## 后续必做

已有工程的受支持结构导入、构建应用的内置交互预览仍在推进。当前编辑预览显示自定义组件边界；组件实际交互由构建后的应用承载。Web 的富文本细节、多选/对齐与完整编辑能力需逐项完成，不能用本阶段的基础编辑宣称 R4 已完成。R5 Doc、R6 TUI/Desktop 与 R7 迁移和无 Python 发行继续保持必做范围。
