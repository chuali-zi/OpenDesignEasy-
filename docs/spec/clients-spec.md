# Web、CLI、TUI 与 Desktop 客户端规范

> TS 重构 v1，2026-09-12；状态更新：2026-09-20。四端均为正式交付范围。R1 CLI 无头基础路径已完成；R2 基础 Web 编辑路径已通过 Chrome 实测，但 R2 整体未完成。TUI 与 Desktop 产品尚未开始。
> 核心依赖方向见 [架构](../architecture.md)，共享命令见 [系统规范](system-spec.md)。

## 1. 共同能力与边界

四端共用项目、文档操作、资料、设置、会话、输入、版本与导出服务。不能各自实现另一份 agent 循环、文档存储、编辑规则或格式转换。

CLI/TUI 在没有浏览器界面和 Web 服务时可用。图形预览/导出可按需调用无头渲染组件，这与启动 Web UI 无关。

Web 与 Desktop 共享完整图形编辑器。终端侧通过节点树、命令和结构化属性操作同一文档，不要求在字符终端复刻图形画布。

## 2. 客户端能力矩阵

下表描述的是目标能力，不代表当前都已实现。当前分阶段状态见本节后的说明及[实施计划](implementation-plan.md)。

| 能力 | Web | CLI | TUI | Desktop |
|---|---|---|---|---|
| 项目与资料 | 图形操作 | 命令/JSON | 交互列表 | 图形 + 本地文件 |
| Agent 对话 | 流式对话 | 一次任务或附加会话 | 持续交互 | 流式对话 |
| 纠偏、停止、回答 | 对话控件 | 子命令/输入协议 | 快捷键/输入区 | 对话控件 |
| 直接改文档 | 完整图形编辑 | 语义命令 | 文档树/属性 | 完整图形编辑 |
| 版本与导出 | 可视列表 | 命令/JSON | 列表操作 | 可视列表/文件 |
| 配置 | 设置界面 | 配置命令/环境 | 配置面板 | 设置/系统凭据 |
| 历史与恢复 | 共享 runtime | 共享 runtime | 共享 runtime | 共享 runtime |

TUI 不是只包一层聊天文本，Desktop 不是只打开一个远程网页。

## 3. CLI

以下为目标命令形态，用于约束完整 CLI 能力：

~~~text
oey project create/open/list
oey reference import/list
oey document read/query/apply
oey agent prompt/attach/steer/follow-up/answer/cancel
oey version list/create/restore
oey render
oey export
oey config
~~~

当前 R1 CLI 已实现项目、文档、节点、共享命令、版本、事件和基本渲染的无头 JSON 路径，可用 `npm run oey -- --help` 查看实际命令。参考资料导入、agent prompt/attach/steer/follow-up/answer/cancel、完整 export 与配置命令仍按后续阶段实现；Pi 产品 agent 接入属于 R3。

document apply 接收系统规范中的操作，支持文件或 stdin 输入，不能仅提供“重新生成整份作品”命令。执行 document/read/export 等不涉及模型的操作，不要求 API key。

非交互模式输出稳定 JSON；长任务可输出 JSONL 事件。业务结果写 stdout，诊断写 stderr，不混入动画或日志文字。命令参数、结果和退出状态在实现时写入 CLI 帮助和相应测试。

建议退出状态区分成功、失败、需要用户输入与项目占用；具体数字一次确定后保持一致。非交互 agent 遇到问题，保存 questionId 与会话，返回 needs_input；不能挂住无人值守终端或擅自代答。

关闭 stdin 或终端不删除项目。取消按 runtime 语义处理；重新 attach 可看到当前设计和待处理输入。

## 4. TUI

使用 Pi 的 TS TUI 组件作为终端绘制基线，业务调用 OEY runtime。它不是启动 Pi CLI 后屏幕抓取，也不复用 Pi 默认文件工具替代设计工具。

界面提供会话与文档导航、输入、模型/工具活动、选区上下文、待答问题、版本和导出结果。运行中可以纠偏和停止，目标节点通过共享稳定 ID 选择。

终端无法显示图形时输出适用摘要与预览文件入口。支持 Unicode/CJK、窗口尺寸变化、快捷键及粘贴；节点属性修改可以通过表单或命令完成。

TUI 与 CLI 不导入 React/DOM/editor；终端显示应与图形 UI 无关。

## 5. Web

React/Vite 提供项目界面、对话、画布、图层、属性、资料和版本。Deck 使用 Konva 编辑视图，Web 用实际 DOM overlay，Doc 用富文本和分页视图。

当前 R2 已通过 Node 24 全 workspace TypeScript 检查、Web production build、29/29 单元/集成检查与 Chrome 3/3 基础路径实测。浏览器验证覆盖基本文字保存、几何属性、撤销/重做、重新载入、PPTX 下载、鼠标拖动、角点缩放、属性旋转，以及切换文档时不被延迟的旧版本响应覆盖；单纯缩放视口不增加文档修订。PPTX 重复 `pPr` 已修复，三页 XML 检查通过。完整 R2 仍未完成图片、完整富文本、吸附/对齐、PDF、实际 Office 打开与全部验收。

构建并启动单一 production host 即可试用当前路径：

```powershell
npm run build:web
npm run web -- --project .tmp/workbench
npm run dev:web
```

`npm run build:web` 后，`npm run web -- --project .tmp/workbench` 会从 `apps/web/dist` 提供 UI 和本地 API，默认地址为 `localhost:4318`。`npm run dev:web` 会单独启动 Vite（默认 `localhost:5173`）并代理到 host，只在开发时需要。当前 3/3 浏览器检查不表示所有编辑能力或完整 R2 验收均已通过。

Web host 采用 TS HTTP + SSE，业务处理调用共享 runtime。HTTP schema 是共享命令的传输表示，不重新命名业务身份或引入旧 Studio run 协议。

用户产物预览运行在隔离的预览边界，不能访问管理 API 或凭据。浏览器刷新/断网通过 seq 和快照恢复，未确认的本地手势不能标记为已保存。

本版以本地宿主为基线，不把云端多人 SaaS 当成完成前置条件。

## 6. Desktop

采用 Electron，复用 packages/editor 与图形产品界面。主进程管理窗口、文件入口和系统集成；核心在受控运行进程，renderer 通过 preload 暴露有限业务接口。

核心不导入 Electron。Node 24.21.0 Windows x64 binary 和 Electron 44.3.0 utilityProcess（内嵌 Node 24.20.0）的 `node:sqlite` 探测已在 R1 通过；完整 Desktop 应用、进程通信与打包仍按 R6/R7 验证，不另写存储逻辑。

必须提供本地打开/保存项目、文件拖入、菜单/快捷键、模型设置、完整编辑和导出，并处理关闭窗口时的活动任务状态。不能默认关闭窗口后仍在后台付费生成而不给用户提示。

桌面分发包含可用的核心、资源和需要的第三方渲染运行时，普通用户不必另开 Python、Web dev server 或终端配环境。

## 7. 同一个项目跨端继续

CLI 开始时可以直接创建 runtime；Desktop/Web/TUI 可成为项目 owner。后来的客户端连接现有 owner 或清楚报占用，具体规则见 [恢复规范](runtime-recovery.md)。

所有客户端收到相同 document.changed，使用相同修订。切换客户端不导出再导入、不复制数据库，也不新建互不关联的模型会话。

跨端不表示多人实时协作。第一版保证单用户和 agent 的一致性与同机进程访问，云同步是另一个范围。

## 8. 配置、安装和平台

模型配置与密钥留在 runtime 的用户配置/系统凭据位置；各端通过共同设置服务管理。环境变量可以用于自动化，但不是普通用户唯一配置方式。

目标覆盖 Windows、macOS、Linux。R1 完成的是 Windows 开发宿主基线；跨平台干净安装、CLI/TUI 三平台运行与 Desktop 对应安装包的实际验证留到 R7。未测的平台明确标记，不能提前声称已支持。

native npm 依赖应采用预编译发行或受控随包运行时，不能要求用户安装 Python 以编译依赖。字体、Chromium/OCR 资源的体积、下载和离线可用范围需要在发行说明中准确列出。

## 9. 交付检查

目标交付检查仍是 CLI 无头建项目并修改节点；Web 打开后拖拽；TUI 继续改选中对象；Desktop 打开同一版本调整并导出。四端的读取、撤销、版本和取消结果一致。当前 R1 CLI 路径完成；R2 的基础 Web 编辑路径已通过 Chrome 实测，但图片、完整富文本、吸附/对齐、PDF、Office 打开和完整验收未完成；TUI 与 Desktop 尚未开始。

完整图形操作见 [编辑规范](editor-document-spec.md)。先完成 CLI 的原因是验证核心独立性，不能据此取消其余客户端。

## 10. 依据

[Pi TUI](https://github.com/earendil-works/pi/blob/v0.85.1/packages/tui/README.md)提供终端 UI 构件，[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)提供桌面宿主结构。OEY 的文档树、设置、项目管理与交互仍需实现。
