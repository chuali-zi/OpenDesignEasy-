# R5 TS 资料读取与执行器恢复验收

2026-10-13。执行器断连后同一工作区恢复，先将未推的 13 个文件保存在独立检查点 `2256447409179c0b33b8c108c4e36ef4b03d6b33` 并正常推送。检查点保留原始未验收状态；后续修复在 `codex/r5-material-validation` 完成。R4/Doc 核心稳定起点 `7c7b741004d18b26684962989a4b7175493d5c42` 未丢失，主分支和原工程未改动。

## 实际可用读取

`ProjectAssets` 保留不可变原件，`parseReference` 读取真实文件；CLI `asset read <dir> <assetId>` 和 Pi `reference_read` 共用该路径。Web 资料入口支持相同格式，附件进入 Pi 前提取正文与具体读取限制；工具返回正文、格式、范围、警告和是否仍有内容，不再把警告只放入模型看不到的元数据。

| 输入 | 实际读取 | 明确边界 |
|---|---|---|
| TXT/Markdown/JSON、TS/TSX/JS/JSX/CSS/HTML/Python 源文件 | 严格 UTF-8 文本；JSON 校验 | 不执行源码/脚本；并非任意工程可编辑导入 |
| CSV | 引号、双引号转义、跨行值与空单元格 | 字符串单元格，不执行公式；10,000 行、256 列 |
| DOCX | 正文段落与表格单元格文字、页眉/页脚文字 | 不解释字段、图形、批注；原件保留；可编辑模板结构导入见 [模板规范](doc-templates.md) |
| PPTX | 按 presentation relationships 的实际幻灯片顺序读取形状/表格文本 | 100 页上限；图表数据、备注和媒体仍不解释 |
| XLSX | 工作表名、shared/inline strings、原始值与公式缓存；保留稀疏行列位置 | 100 表、行坐标 1..10,000、列 A..IV；重复地址/无效共享串拒绝；公式不执行，日期/显示格式须复核 |
| PDF | PDF.js 真实逐页文字 | 100 页、45 秒；无文字页明确说明需要 OCR |
| 图片/扫描 PDF | Tesseract.js 本地 WASM OCR，返回可复核文字 | 显式 OCR；45 秒覆盖线程初始化/识别，20 MP；不自动下载语言数据 |

原始资料 1 byte–20 MiB。Office ZIP 使用有界内存读取：8 MiB archive / 4 MiB part / 16 MiB expanded / 256 entries，路径、CRC、重叠、压缩类型与链接校验；仅 Office 模式接受合法 `_rels/.rels`，既有 Web ZIP 默认边界不放宽。宏/ActiveX/OLE 包、DOCTYPE/ENTITY、XML 深度超过 64、损坏关系或非法 UTF-8 拒绝。不解压到磁盘、不执行外部链接或安装脚本。提取文本最多 1,000,000 字符，截断带明确标记；`reference_read` 每次范围 1–50,000，默认 12,000。

解析结果缓存到 SQLite，重复读取和保存重开复用文本、格式与警告；原件字节和文档修订/历史不变。失败读取不会写入成功缓存，也不自动重试。

## OCR 运行与交付

OCR 现随 media 安装固定 `@tesseract.js-data/eng@1.0.0` 与 `@tesseract.js-data/chi_sim@1.0.0`（npm 元数据标 MIT，integrity 固定在 lockfile），默认读取依赖中的 `4.0.0_best_int/*.traineddata.gz`。安装按 npm 标准依赖下载，识别过程不访问网络/CDN；压缩语言文件合计约 4.6 MiB。可用 `OEY_OCR_DATA_DIR` 显式覆盖为既有本地原始 `eng.traineddata` / `chi_sim.traineddata`（单文件最多 40 MiB），覆盖路径缺失立即失败，不回落自动下载。

可信应用线程承载 WASM 引擎；图像和语言路径仅作为数据传递。外层 45 秒 signal 覆盖创建与识别，取消后等待线程终止，不只取消结果。构建同时产出 `dist/oey.mjs` 和 `dist/ocr-worker.mjs`，两者须一起交付。实际已构建 CLI 在独立合成项目中读取图片，输出准确的 `SYNTHETIC EVIDENCE 42` 并正常退出。测试可通过 `OEY_TEST_OCR_DATA_DIR` 指定本地英文数据；缺数据时 OCR 子场景明确 skip，不冒报引擎通过。本机子场景没有跳过。

## 恢复中发现并修正的问题

CLI asset read 原先被前面的通用 asset 路由截获，也误用同步 withRuntime：现已合入正确路由并在 open/await/finally close 中读取。损坏 ZIP 测试原先误传 ZIP 生成 Promise，现先 await 字节，再分别断言宏和 XML entity 拒绝原因。原件对比采用字节比较，避免 Buffer 与 Uint8Array 的类型差异误判。PDF 光栅化在分配 canvas 前检查像素上限，失败也释放 canvas。XML 限制用解析器公开的 maxNestedTags 配置验证，未传不存在的 validator 字段。

合成场景验证原件、读取内容、警告、分页、CSV 引号、XLSX 稀疏/损坏地址、宏/实体/深层 XML 拒绝、OCR 缺数据与初始化取消、缓存/重开、真实子进程 CLI，以及 Pi 附件和工具共享读取。Pi 场景使用本地 faux provider；本阶段没有新增真实 K2.8/provider 请求、模型 usage 或费用。旧 `5c5a4eb` 有界 K2.8 结果仍只属于其当时版本。

最终 Node 全套 137/137（0 skip）、Chromium 全套 24/24、核心与 Web 构建均通过；编译 CLI 的独立 OCR 验收另行通过。证据目录为独立 `oey-cloud-evidence/r5-materials`。Library 此前网络失败，未重试或生成分享链接。完整 R5 仍需 DOCX 模板结构/OOXML、浮动锚点、分页编辑与实际 Word 验收；此次资料读取不冒称这些功能完成。

## 中文 OCR 接续验收

实际合成图片和扫描 PDF 读到 `合成 中 文 资料 测试 42`，按空白归一后准确为“合成中文资料测试42”；OCR 保留原文空格并标 inferred/需复核，不悄悄替换原件。默认本地英文包同样实测，运行取消覆盖初始化。CLI/资料工具共用资产缓存、范围与警告，保存重开保留原图字节；失败取消没有写入成功缓存。

实际编译 `dist/oey.mjs` + `dist/ocr-worker.mjs` 在新合成项目中读取中文原图，CLI 和继承 Worker 的 HTTP/HTTPS/socket/fetch 均用验收钩子禁止，仍返回准确内容、0 模型请求并正常退出，约 1.023 秒。实际结果在 `oey-cloud-evidence/r5-chinese-ocr/compiled-cli.json`；安装、原图、扫描 PDF、生成与复核脚本也保留。

中文数据接续后 Node 全套 143/143（0 skip）与核心构建通过；Web 代码没有变化，其最近完整 Chromium 回归为浮动对象提交时 26/26。本轮实际模型请求 0，usage 不属于 K2.8 验收。
