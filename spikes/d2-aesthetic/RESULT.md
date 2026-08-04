# Phase 5 T6: D2 / E2 / Q2 / Q3 审美审核物料

**状态：✅ E2 已于 2026-08-03 人工审核通过并冻结**

本目录记录候选生成、自验证过程、审美发现原始输出、重复评估数据和审核页完整性。2026-08-03
人工审核确认 E2 物料无问题；该裁决只回答“agent 能否看截图发现并修复视觉问题”，不在本文给四个
候选做审美排序。

## 运行设置

- Kimi 模型：`k3`
- temperature：`1`
- Python 输出编码：`PYTHONIOENCODING=utf-8`
- 浏览器：Playwright 系统 Chrome，`channel="chrome"`
- API：单次超时 1200 秒；HTTP 429、HTTP 5xx 和超时最多重试 5 次，退避 5、10、20、40、60 秒
- 本次补跑没有出现重试耗尽或响应解析错误

## 完整性

| 阶段 | 落盘物料 | 当前数量 | 本次处理 |
|---|---|---:|---|
| D2 候选生成 | `candidates/cand{1..4}/v1/`、原始响应、reasoning、meta | 4 个候选，22 个 `v1` 文件 | 4 份已有产物及 `_gen_summary.json` 完整，未重刷 |
| E2 自验证 | `rounds.json`、各轮截图、`final/` | 4 个最终候选，9 轮、9 张截图 | 复用候选 1-3；补跑候选 4 的 3 轮 |
| Q2 审美发现 | `q2/cand{1..4}.json`、4 份 raw、`_summary.json` | 4 组，15 条原始发现 | 本次生成 |
| Q3 重复评估 | `q3/cand{1..4}.json`、`_summary.json` | 4 组，20 次评估，79 条原始发现 | 本次生成；每组 repeats=5 |
| 人工审核页 | `review.html` | 1 份，4 个候选区块、13 张图片引用 | 本次构建 |

候选各轮数：cand1=2、cand2=2、cand3=2、cand4=3。Q2 四份响应和 Q3 二十次响应的 `parse_error` 均为空。

## 客观边界

Q2 使用静态源码正则提取 `data-oey-*` 锚点。四个候选提取数依次为 0、1、3、9，锚点匹配条数依次为 0/4、3/3、3/3、5/5。cand1 的锚点由运行时 JavaScript 生成，因此静态提取结果为 0；审核时应把该数值视为当前采集口径记录，不把它当作审美结论。

Chrome 以 `file://` 打开 `review.html` 后识别 4 个候选区块；滚动触发懒加载后 13/13 张图片均有有效自然宽度，破图数为 0。

## E2 冻结裁决

四个候选首轮分别发现 3、3、4、4 个具体问题，并实际修改文件；cand1–3 在第二轮均收敛为
`issue_count=0`，cand4 在第三轮达到零 console error、零失败请求、零 page error、零 overflow。
人工复核九轮截图后确认问题识别与修复成立，E2 通过并冻结。

## 缺失项

- 机器生成与审核物料：无缺失。
- 候选审美排序仍未填写；它不属于 E2 技术假设的冻结条件。
- `_repair_summary.json` 记录本次缺失项补跑的 cand4；四个候选的完整逐轮记录分别以各自 `rounds.json` 为准。

## 实际命令

已有生成物未执行重刷：

```powershell
$env:PYTHONIOENCODING='utf-8'; python "spikes/d2-aesthetic/generate_candidates.py" 1 2 3 4
```

本次实际执行：

```powershell
$env:PYTHONIOENCODING='utf-8'; python "spikes/d2-aesthetic/selfrepair.py" 4
$env:PYTHONIOENCODING='utf-8'; python "spikes/d2-aesthetic/aesthetic_findings.py" 1 2 3 4
$env:PYTHONIOENCODING='utf-8'; python "spikes/d2-aesthetic/stability.py" 1 2 3 4 --repeats 5
$env:PYTHONIOENCODING='utf-8'; python "spikes/d2-aesthetic/build_review.py"
```

## 审核入口

双击打开：`D:\projects2\OEYdesign\spikes\d2-aesthetic\review.html`
