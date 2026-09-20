# R2 / R3 实现与验收

> 2026-09-20，Windows 开发环境。阶段完成状态以[实施计划](implementation-plan.md)为准。本页记录本轮可运行入口、实际验证与格式边界。

## 可运行入口

使用 Node 24，运行 `npm ci`、`npm run build:web`，然后：

```powershell
npm run web -- --project .tmp/workbench
```

打开 `http://localhost:4318`。同一窗口提供设计对话、Deck 编辑器、版本与导出。可以关闭对话栏以扩大画布。项目保存为目录内 SQLite、原始素材、Pi 会话和导出文件，重新使用同一目录即可接续。

已有 `.env` 的 `MODEL`、`BASE_URL`、`API_KEY` 可用于兼容服务。服务端加载密钥，Web 设置只显示密钥环境变量名。自定义兼容服务默认使用 `system` 角色；需要不同协议或兼容参数时，通过 CLI 配置 JSON 设置 `api`、`compat` 等字段。没有 `baseUrl` 时使用 Pi 原生 provider 注册表。

```json
{
  "providerId": "oey-compatible",
  "modelId": "k3",
  "baseUrl": "https://api.kimi.com/coding/v1",
  "apiKeyEnv": "API_KEY",
  "api": "openai-completions",
  "thinkingLevel": "low"
}
```

无 Web 服务时可直接运行同一 agent：

```powershell
npm run oey -- agent config .tmp/workbench --file model-config.json
npm run oey -- agent run .tmp/workbench --text "先讨论叙事方向，暂不修改作品"
```

Web 已持有项目时，通过 owner 接续，避免第二个进程打开同一项目写库：

```powershell
npm run oey -- agent list --host http://127.0.0.1:4318
npm run oey -- agent send --host http://127.0.0.1:4318 --session <sessionId> --text "沿用当前布局继续" --wait
npm run oey -- agent steer --host http://127.0.0.1:4318 --session <sessionId> --text "保留刚才手动移动的标题"
npm run oey -- agent cancel --host http://127.0.0.1:4318 --session <sessionId>
```

`follow-up`、`answer --question <questionId>`、`status`、`compact` 使用同一会话。独立 CLI 会保持运行到本轮结束或留下可恢复的问题，Ctrl+C 取消当前执行。

## R2 实现

- 统一文档支持多页、主题、原生文字/形状/图片/表格和柱状、折线、饼图。图片原件单独保存，裁切、fit 与透明度保存在文档中。
- 编辑器支持拖拽、角点缩放、旋转、框选/多选、图层和分组、组内编辑、对齐/分布、网格及对象吸附、参考线、复制粘贴、键盘移动和共享撤销重做。视口缩放不产生文档 revision。
- ProseMirror 提交文本步骤，支持中文输入、局部字体/字号/颜色/粗斜体/下划线/删除线和段落格式。画布投影、预览和导出读取同一份结构化内容。
- PPTX 保留文字、图片、形状、表格与图表为原生对象。PDF/PNG 在无可见浏览器的 Chromium 中输出。导出固定一次文档快照，不会因后续编辑混入其他 revision。

实际 Office 检查使用 `scripts/ts/check-r2-deck.ts` 生成三页混排夹具，再由 `scripts/ts/check-office.ts` 在已安装的 PowerPoint 中打开、枚举对象并导出 PDF/PNG。它发现并修复了表格 `anchor="mid"` 无效值；仅检查 XML 可解析不足以发现该问题。

PowerPoint 是开发验收工具，不是产品运行依赖。PDF/PNG 需要可用的 Chromium；Windows 开发环境已验证已安装 Chrome。混合页面尺寸的 Deck 当前明确拒绝 PPTX 导出，避免静默改变页面比例。字体依赖目标系统，跨平台字体与干净安装继续在 R7 验证。

## R3 实现

runtime 直接组合 Pi 公共 `AgentSession`，没有第二个 agent loop。Web 与 CLI 共用项目、工具、输入和历史。

- 用户输入在确认接收前持久化；相同 inputId 的相同请求返回原结果，不重复触发模型。不同请求复用 ID 会报错。
- 支持 steer、follow-up、停止、结构化问题与回答。问题落库后结束本轮；同一模型批次中排在提问后的写入会被拦截。
- 当前选区、近期人工修改、设计决定与最新 revision 进入模型上下文。工具使用共享命令，冲突可重读，无关属性可合并，人工可以撤销 agent 的修改。
- 重启将未结束执行标记为 interrupted，不自动重放外部调用。待答问题继续存在；Pi 会话文件和项目输入共同支持恢复。
- 支持文本参考、图片读取、已有项目图片服务生成、截图检查和 PPTX/PDF/PNG 导出。R3 参考文本范围为 TXT/MD/CSV/JSON，完整 PDF、Office、OCR 解析仍属 R5。

真实兼容服务验收由 `scripts/ts/check-r3-real.ts` 和 `scripts/ts/check-r3-image.ts` 单独运行，不进入普通测试。仅创建新的合成测试项目，不上传用户作品：

1. 讨论虚构阅读计划而不改文档，再生成三页含原生表格和图表的作品。
2. 人工改变标题位置，再由 agent 保留现有布局扩展第四页。
3. 提问、关闭项目、重新打开后回答，保持文档不变。
4. 项目图片服务生成一张合成插画，兼容模型读取图片、将其插入为可编辑对象并检查截图。

上述实际兼容服务流程已通过。原生 provider 验收脚本为 `scripts/ts/check-r3-native.ts`，使用新的合成红色方形画面，检查文本、工具和截图；原生 endpoint 的执行授权与结果尚待确认，不能据兼容服务结果宣称原生协议已验证。

普通自动化检查覆盖文档冲突、共享历史、原始素材、可靠输入、Pi 队列/取消/问题恢复、CLI 子进程与 Web owner 接续；Chrome 检查直接编辑行为。Node 24 单元/集成测试 53/53、Chrome 4/4、TypeScript 检查及 CLI/Web 构建通过。三页混排及实际模型生成的四页作品均在 PowerPoint 打开；最终视觉复验通过。原生 provider 的真实验证尚未结案，R3 目前不能标记为全部完成。
