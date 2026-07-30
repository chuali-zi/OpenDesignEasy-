# 2026-07-26 E4+Q7 spike 搭建

- 读完 spikes/README.md、agent-engine-spec §10、artifact-production-spec §4.7、
  quality-governance-spec §3.4。
- 写 generate.py：用 <<<FILE:...>>>/<<<END>>> 定界格式让 k3 一次性产出多文件，
  max_tokens=16000（单次实测 ~370s、~11-12k completion tokens）。8 次生成串行跑，
  已后台启动 run-02~08。
- 写 detector.py（Q7 核心）：只扫代码文件，绝不读 MOCK.md，检出 5 类信号
  （fetch/XHR 拦截、Service Worker、内联假数据、setTimeout 假延迟、mock 路径引用）。
  在 run-01 上验证：正确抓到 DB/REPLY_RULES 内联数组 + Promise+setTimeout 延迟。
- 写 compare.py：单独读 MOCK.md，用关键词做「声明覆盖率」核对，不进 detector。
- 写 verify.py（Playwright, channel=chrome，起本地静态 server 避免 file:// CORS）：
  按 data-oey-section 关键词定位项目列表/对话区，找「重复行」而非全部
  data-oey-object（避免点到刷新按钮/筛选框），点击+发消息，比对 DOM 是否真变化。
  run-01 上验证 FULLY_INTERACTIVE。
- 已建反例 attacks/no-mock-control（纯静态页，detector 0 误报）与两个未声明攻击样本
  attacks/undeclared-full、undeclared-partial（均被 compare.py 正确判 HARD_ERROR）。
- 待 8 次生成跑完后统一跑 detector/verify/compare --all，汇总写 RESULT.md。
