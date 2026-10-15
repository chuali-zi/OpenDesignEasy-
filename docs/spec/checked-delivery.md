# 三媒介交付检查与版本绑定产物

2026-10-15，接续 R5。此切片不表示 R6 TUI/Desktop 已实现，不把浏览器检查或合成夹具当真实模型创作验收。研究依据见 [竞品与取舍](../competitive-analysis/design-agents-2026-10-15.md)。

## 用户可感知的行为

工作台新增“交付检查”。用户选择格式，查看当前修订的错误、提醒及未运行的检查，再下载所选产物与报告组成的交付包。作品被人工/Agent 修改或撤销后，旧报告显示过期并禁用交付；刷新后才能继续。取消/关闭不修改作品，重开重新检查。原普通导出入口继续可用，不增加审批流程。

Doc 默认 DOCX，Deck 默认 PPTX，Web 默认全部路由的静态站点 ZIP；源码 ZIP、构建应用、HTML/PDF/PNG 等沿用各媒介已有支持范围。单页 HTML 交付多页 Web 时明确提醒只包含首页。

## 共用核心与收据

`media/delivery.ts` 提供纯检查与打包，`runtime/delivery.ts` 检查本地素材并导出；CLI、HTTP 和 Pi 调用同一服务。没有 Web 服务或可见浏览器时，DOCX/PPTX/静态 Web 交付也能执行；需要栅格/构建的格式仍使用其既有渲染器。

- 只读检查不提交文档命令、不改变修订、撤销栈或设计事件。
- 交付必须带 `expectedRevision`。开始、素材读取后、打包后及 Agent 服务发布文件时核对当前修订；任何期间出现人工修改，返回冲突并不登记成功产物。
- 重新检查一次后，在内存冻结文档快照和素材字节，导出器只读取检查过的字节。素材逐项限制、最多 512 个、合计最多 128 MiB；不额外遍历项目目录。
- 新导入图片/资料保存 SHA-256；已有登记摘要、尺寸、类型、模板原件 hash 与真实字节不一致，或素材缺失，作为错误阻止交付。旧资产没有原始 hash 时只能核对已有元数据并记录本次 hash，不能证明历史原件未被修改。
- `delivery.json` 包含媒介/格式/documentId/revision、排序后文档 JSON 的 SHA-256、素材字节摘要、问题位置、检查范围和产物文件名/字节数/SHA-256。外部接收者可直接核对产物摘要；重算文档摘要需要对应项目快照，本包不另带项目数据库。
- ZIP 只有所选产物、`delivery.json` 和 `README.txt`。不打仓库代码 ZIP，不归档运行项目、独立资料库或聊天；源码格式本身仍包含用户网页源码，所有产物内容均未脱敏。
- 缺失/损坏/不支持的内容是错误；疑似越界、待完成文案、空链接/替代文字、空幻灯片为提醒。提醒随包保留，不自动删除或改写对象，也不把有意出血当强制错误。

有限静态检查包含 Deck 逐层旋转后的页面边界、Doc 正文栏的图片/浮动对象/显式表格列宽、富文本分 run 的 TODO/TBD/待补充等标记、Web 原生图片 alt/链接占位。它不是文字测量、遮挡检测、任意响应式 CSS 分析或完整 DOCX 支持检测。

报告固定区分：结构/素材“已检查”；视觉/真实分页、Microsoft Word/PowerPoint、事实/来源/许可“未运行”。**导出成功不改变这三项状态。** 研发的本机 Office 合成验收另存证据，不能替代每次交付的目标软件审核。

## 入口

```text
oey document check <project> <documentId> [--format docx|pptx|zip|...] [--revision N]
oey document deliver <project> <documentId> --revision N --output <file.delivery.zip> [--format ...]
GET  /api/documents/:id/delivery-check?revision=N&format=...
POST /api/documents/:id/delivery.zip { expectedRevision: N, format?: ... }
Pi: artifact_check(documentId, expectedRevision, format?)
Pi: artifact_deliver(documentId, expectedRevision, format?)
```

HTTP 报告禁止缓存，继续使用本机 host 的 Origin 保护；HTTP 交付不写项目文件。Agent 成功后才登记 `exports`，取消/故障清理本次临时文件。CLI 失败时不覆盖既有目标文件。Pi 提示明确未验检查不是通过；工具编排测试使用离线 faux provider，未调用真实模型。

## Windows 实测中修复的读取问题

Word/PowerPoint 16.0 的真实另存文件使用 DEFLATE `flags=6`。旧 ZIP 安全读取器只接受数据描述符/UTF-8 标记，误拒绝了正常文件。现仅对 method 8 接受压缩级别位，仍拒绝加密、强加密、STORE 错用、损坏头、路径、CRC、大小及宏/OLE 等；依据 [PKWARE APPNOTE 4.4.4](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)。PPTX 资料按段落拼接格式/语言 run，保留真正的 `a:br`，不在每个 run 之间插入假换行。

LibreOffice 在本机显示“合成分页报告”正确，PDF 字流却按“合成分 / 告 / 页报”发出。资料读取仅对连续同基线、非旋转、非 RTL 的纯中文类文字片段在出现倒序时按横坐标重排，丢弃实际字形覆盖的合成空白，并附需复核提醒；混合 Latin、旋转、竖排、分栏不做全页重排，不猜缺字。PDF/PPTX 派生文字缓存使用 v2，原件和文档历史不迁移、不删除。

## 可复现验收与边界

本轮 Windows 使用项目已缓存 Node 24.21.0 与本机 Chrome；锁文件依赖安装在独立工作树。`npm run test:web` 现在先构建界面，证据目录默认 `.tmp/evidence`，可用 `OEY_EVIDENCE_DIR` 覆盖，不再硬编码 Linux `/workspace`。

```powershell
npm test
npm run build
npm run test:web
# 只在已安装 LibreOffice 的 Windows 上显式启用原生 PDF 用例：
$env:OEY_TEST_DOCX_RENDERER='C:\Program Files\LibreOffice\program\soffice.exe'
npm test
# 浏览器合成用例生成本轮文件后，仅检测指定文件：
node --import tsx scripts/ts/check-delivery-windows.ts
```

Office 脚本打开 `.tmp/evidence/r6-delivery` 中固定合成 DOCX/PPTX，实际渲染、编辑、另存副本、重开并读取原生文字。发现已有 Word/PowerPoint 会话即跳过，不能据此写成功。脚本不修改 Office 全局设置，不打开用户资料，不使用 LibreOffice 冒充 Word。

固定合成内容来自 OEY 命令/API，不是模型创作样本；真实 K2.8 从产品入口到创作/导出的整轮能力本次仍未验证。

## 本轮最终结果

- Windows Node 24.21.0：170 项，**167 通过、0 失败、3 明确跳过**。跳过 Unix shebang/进程组夹具、未配置栅格器的原生图片可见面积夹具、未启用的专用英文 OCR 子夹具；没有把它们计为 Windows 通过。
- 本机 Chrome 完整 37/37；最后直接解析 UI 下载 ZIP 的交付针对检查 4/4。覆盖反复编辑、取消/关闭/重开、撤销/重做、迟到/并发人工修改、缺失/损坏素材、过期版本、三媒介几何/导出、Origin 和 ZIP/路径/CRC 保护。所有固定内容明确为合成夹具。
- 类型检查、核心打包 `dist/oey.mjs`/OCR worker、Web production 构建通过。生产界面有既有大 chunk 提醒，不是测试失败。
- 真实 **Microsoft Word 16.0，Build 16.0.20430**：本夹具 1 页；595.3 × 841.9pt，四边 72pt；正文 12pt、一级标题 18pt、二级标题 15pt。指定正文的浏览器/Word 实测均 2 行；打开、PDF 渲染、编辑另存、重开及原生段落标记读取通过。
- 真实 **Microsoft PowerPoint 16.0，Build 20430**：本夹具 1 页，960 × 540pt；实际导出 1280 × 720 PNG，打开、编辑另存、重开及原生段落标记读取通过。没有把 PowerPoint 的失败 PDF COM 调用冒报为 PDF 成功。
- 本机 LibreOffice 原生 PDF 的两个内容/分页场景通过；跨表格页眉/字段、中文、横向附录、奇偶页空白页与 continuous 分节均按测试范围检查。中文字体回退字序问题已在最小夹具中复现、视觉查看并修复资料提取。

证据位于工作树 `.tmp/evidence`：`node-tests-final.log`、`browser-tests-final.log`、`delivery-browser-final.log`、`build-final.log`，以及 `r6-delivery/office-results.json`、`doc/deck/web-delivery.json`、三个 UI 下载的 `*.delivery.zip`、对应原生文件和实际截图。Office 的 `inputSha256` 与 UI 下载包内产物摘要对应。后续稳定附件另存，不把重复运行覆盖的工作文件冒充已上传版本。

本轮曾因 COM 退出参数错误留下空 Word 进程。首次清理被自动审批拒绝；只读证据确认唯一进程的精确 PID/启动时间且文档数为 0 后，受相同条件保护的退出获准完成，未关闭用户文档。Office 脚本之后的退出与重开均已实际执行。

仍待验：Word/浏览器实际字体替代存在可见差异，未绑定/嵌入统一字体；两行正文一致不是逐像素一致或任意模板兼容。新界面与导出截图供人工视觉审核。事实引用、自动审美修复、复杂 Word/PPT 特性、真正 K2.8 产品创作闭环、TUI/Desktop/跨平台发行和 Python 退役仍未完成。
