# R4 Web 实现与验证

> 状态更新：2026-10-13。R4 正在实施，当前已交付 Web 文档、无头生产、DOM 编辑基础与内置应用交互预览；完整 R4 尚未验收。后续状态以[实施计划](implementation-plan.md)为准。

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

OEY 源码 ZIP 的受支持工程导入与往返已经实现，详见[导入边界](web-source-import.md)；不带 OEY 快照的一般 React/HTML 工程结构解析仍未完成。当前编辑画布显示自定义组件边界；组件内部交互通过“运行应用”进入独立预览。Web 的富文本细节、多选/对齐与完整编辑能力需逐项完成，不能用本阶段的基础编辑宣称 R4 已完成。R5 Doc、R6 TUI/Desktop 与 R7 迁移和无 Python 发行继续保持必做范围。

### 2026-10-13 收尾时的未完成清单

- [x] OEY 导出的源码项目导入、外部受管模块修改与往返保存；原生内容仍可编辑，原文档不覆盖。
- [ ] 不带 OEY 快照的既有 React/HTML 工程的受支持结构导入；不能宣称任意第三方工程无损可视编辑。
- [ ] Web 富文本细节、多选/框选、对齐/分布及完整编辑能力逐项实现并验证；当前基础 DOM 编辑不等于完整范围。
- [ ] 自定义组件内部的编辑映射与边界继续完善；当前运行应用验证的是独立预览的真实交互。
- [ ] 远程浏览器的应用预览代理/部署路由；当前 loopback 预览只支持 host 同机浏览器。
- [ ] 按实施计划完成 R4 的导航、表单演示、响应式、继续编辑/共同创作和原生交付综合验收；本轮最小只读 K2.8 工具测试不替代完整任务。
- [x] 用户已认可此前两张真实编辑器截图的视觉方向。
- [ ] 新的显著视觉变化仍须用户审核；此前认可不扩展为未实现界面或完整产品已获认可。

R5 Doc/模板/分页、R6 TUI/Desktop/四端接续、R7 旧项目迁移/三平台干净安装/无 Python 发行仍未完成。本轮停在可恢复、可交接的验证状态；后续投入选择是先补 R4 导入与完整编辑，或依用户明确选择重新排序其他阶段。清单中的必做范围不会因选择顺序而取消。已有 >500 kB Web bundle 提示也尚未处理。

## 2026-10-13：内置应用交互预览

Web 工作台“运行应用”从已保存修订构建受管源码，在模态窗口中运行真实 React 组件、页面链接与本地交互。预览显示构建修订；作品变更后提示修订已更新，手动重建才切换快照。构建失败显示错误并保留上一份可用预览；修复重建成功后关闭旧服务。关闭窗口取消进行中的构建，宿主退出关闭预览，完成的预览也有 30 分钟存活上限。

构建文件由独立的 loopback 临时端口提供，只暴露内存中的不可变文件及声明的页面路由，不提供项目 API。iframe 使用 `sandbox="allow-scripts"`，未开放 same-origin，CSP 禁止 fetch/WebSocket 和表单提交。此路径面向与 host 同机的浏览器；远程浏览器需要后续设计代理/部署路由，不能直接使用服务器的 127.0.0.1 地址。这里不发布网站，也不允许预览网络后端。

Linux / Node 24.21.0 / 系统 Chromium 的真实 E2E 覆盖：点击计数器、两页导航、文档修订不变、不能读取父页面、预览 origin 没有项目 API、错误源码保留旧预览、修复后的新组件及旧端口关闭、Esc 关闭窗口。HTTP 检查覆盖只读方法、路由/资产、CSP 和关闭清理。截图 `.tmp/r4-application-preview.png` 为实际浏览器中的合成组件。用户已认可此前两张编辑器截图的视觉方向，这不扩展为未实现界面或完整产品已获审美批准。

## 2026-10-13：源码工程导入与往返

工作台“导入源码”和 CLI `document import-source` 共享 runtime；支持带 OEY 快照的源码项目。受管模块的外部修改进入新的文档，原生节点/页面/路由/图片继续可编辑，原文档保留。生成入口不匹配、越界/未声明模块、ZIP 路径/尺寸/校验错误会拒绝，安装脚本和自定义构建配置不执行。安全边界与一般工程导入的未完成项见[导入规范](web-source-import.md)。

实际浏览器合成截图 `.tmp/r4-source-import.png` 展示导入、人工修改并再次往返后的文档。界面沿用已获认可的方向，仅新增入口；该截图作为运行证据，不另行宣称完整设计质量通过。
