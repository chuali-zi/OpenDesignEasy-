# R5 资料解析恢复检查点

2026-10-13，执行器断连后恢复。起点与此前已推稳定节点为 `7c7b741004d18b26684962989a4b7175493d5c42`，工作分支为 `codex/r4-web-editor`。本检查点保留未推的 13 个资料解析文件，尚未通过最终类型检查和全量回归，不作为阶段完成或 live K2.8 结果。

内容：TS Office XML/安全 ZIP 读取，DOCX/PPTX/XLSX/CSV/源码/PDF 与本地 WASM 英文 OCR，runtime 文本缓存、reference_read 与 CLI asset read、UI 资料扩展名、锁定 npm 依赖及构建 external。实际首测读取与本地英文 OCR 2/2 通过；这不替代损坏输入边界、缓存/CLI 生命周期及整套回归。

已知待修：CLI asset read 误用同步 withRuntime，类型错误且异步解析前 runtime 会提前关闭，应改为直接 open/await/finally close；宏与 XML entity 拒绝测试错误地传入 ZIP 生成 Promise，应先 await 字节再断言具体原因。断连前最后一次修复脚本未执行，parsers-second.log 不存在。本地 chi_sim 数据缺失，不声称中文 OCR 通过。OCR 初始化的 45 秒取消覆盖须继续核实。

恢复后在新的验证分支继续，保持本检查点引用不动；验证完成才普通 fast-forward 推进功能分支，不改主分支、远端默认设置或 force push。不要开第二个写入执行器。若本地工作区丢失，可从这个已保存检查点恢复；即使只能取得 `7c7b741`，也可以仅重做资料解析切片，R4 和 Doc 核心已推成果不会丢失。完整 R5 模板/浮动对象/分页/Word 验收仍未完成。
