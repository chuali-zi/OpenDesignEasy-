# R5 章节分节与本轮验收门

2026-10-13。现有 DocSection 已定义 nextPage、continuous、evenPage、oddPage；本轮没有新增分节种类、首偶页专用页眉、罗马页码或多栏正文。实施计划明确要求章节、页面参数、页眉页脚、跨页表格、中文、原生 DOCX/PDF 与实际 Word 复核；本次完成可独立验证的共享分节编辑及有界原生往返。

`doc.section.update` 可修改 breakType，null 恢复默认 nextPage；Web「章节分节规则」、CLI 通用 document apply、Pi Doc 操作说明使用同一模型/历史。基准版本中相同规则的冲突拒绝，独立名称修改可合并。无效种类/未知更新字段及无效批次不留下部分状态，撤销重做、重排与重开保留规则。没有加入隐含的章节页眉继承：每节明确的内容/空内容仍与原生生产一致。

nextPage、evenPage、oddPage 的浏览器分页计算本节开始的物理页；必要时增加一个奇偶空白页，展示明确空白纸页、全书 PAGE/NUMPAGES。编辑本节正文、页脚、纸张或重排章节后从相同页面计数重新派生，不将空白页写成新的正文节点。首节仍从第 1 页开始，奇偶规则作用于后续分节。每节最多展示 200 张内容纸页，真实计数与原正文保留。

continuous 可通过共享命令编辑并准确保留/导出/重导；连续节文档的浏览器继续采用可编辑正文流与明确的原生预览提示。相邻节同一页的精确拼接、Word 字体/docGrid 特有布局并未承诺为完整浏览器排版引擎，不能把分别按节计数伪装为准确 PAGE。原生 LibreOffice 已实际验证两段连续节在 1 页中显示；目标 Microsoft Word 仍待验。连续节不是丢弃的输入，也不阻塞既有正文/历史/导出能力。

## 原生空白页与损坏输入

LibreOffice PDF 默认 IsSkipEmptyPages=true 会省略自动奇偶空白页，曾导致真实 PAGE/NUMPAGES 显示总 7 页而 PDF 只有 5 页。本轮显式设置 IsSkipEmptyPages=false；源安装注册表定义和失败/修正结果保留。再次导出有 7 个物理 PDF 页，3、6 页无正文/页眉/页脚文字，其他页为 SECTION 0/1/2/3/4 对应 PAGE 1/2/4/5/7 OF 7。没有用字段字符串验证替代 PDF 页数验证。

原生四种分节类型逐一重导保持规则与正文。无效节种类、丢失默认页眉页脚关系、重复关系拒绝；失败保留输入，不建立部分文档。页码重启/特殊格式不在当前 page|pages 字段模型内，明确拒绝可编辑模板导入；原件仍可保留为资料。首偶页特定页眉、多栏/自定义列宽、合并/嵌套表、复杂域与未支持锚点继续不支持；不为追求全部 Office 特性无限扩张。

## Library 与交接

此前 CLI 工具发现失败在 prepare 之前，没有产生上传会话或文件身份。按本轮用户明确要求检查另一个已提供的官方路径，确认宿主 create_library_file 接受本地路径，使用官方直传保存现有 DOCX/PDF 与两张真实截图成功，逐项关联返回身份并通过官方 apply-xattrs 写入 4 份稳定副本。源文件和原报告目录未覆盖，没有公开临时网站、手动传签名 URL 或改变权限。

现有 Library 身份记录在 `oey-cloud-evidence/r5-paged-editing/library-identities.json`；旧 CLI 网络失败仍属于真实历史，不再作为附件未交付的现状。新章节产物另行保存新身份，冻结已保存副本，测试产生的新夹具不会覆盖它们。

## 停止门与仍需用户参与

本轮可独立完成的代码、共享历史、浏览器编辑、原生生产/往返和损坏输入按结果验收，随后停止增加功能。剩余最小事项：在用户目标 Microsoft Word/实际字体环境打开提供的混排、奇偶及连续节 DOCX，确认其可编辑性/分页/字体；由用户给新截图/产物的审美反馈。Word 与审美分别未验，LibreOffice 和自动回归不能替代。没有新增真实模型请求、模型费用或代码 ZIP；没有主分支合并。

复现：Node 24.21.0，OEY_BROWSER_EXECUTABLE 指向预置 Chromium，OEY_TEST_DOCX_RENDERER/OEY_DOCX_RENDERER 指向本地 LibreOffice；npm test / npm run build / npm run build:web / npm run test:web。证据在 `oey-cloud-evidence/r5-section-rules`，原生生成脚本 native-probe.mts，测试为 doc-section-rules.test.ts、doc-native-pdf.test.ts、doc-section-rules.spec.ts。

最终回归（2026-10-13）：Node 147/147、Chromium 31/31、类型检查及核心/网页两项构建均通过。两次全量浏览器运行暴露测试等待问题（规则重做时纸页异步替换、创建 Doc 后读取选择器过早）；保留失败日志，修正等待条件后完整回归通过，未删减行为断言。本轮真实模型调用 0。原生奇偶夹具 7 页（3/6 页空白）、连续节夹具 1 页；截图为实际浏览器与原生 PDF 输出，不能替代用户审美判断。
