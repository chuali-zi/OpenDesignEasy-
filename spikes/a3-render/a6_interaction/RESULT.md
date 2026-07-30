# A6 Spike 结果：声明交互路径自动检查

> 状态：**通过**。3 个真实页面、5 条 `INTERACTIONS.json` 声明路径全部找到目标、完成真实点击并观察到声明状态变化。

## 假设与方法

> A6：交互可用性可通过机器可读声明自动检查。

- 模型生成页面及同目录 `INTERACTIONS.json`。
- Harness 通过本地 HTTP 服务加载页面，使用 Playwright `channel="chrome"` 创建真实 DOM 页面。
- 每条声明在独立页面中检查 trigger 与 expect selector，读取点击前属性，执行真实 click，等待 600 ms，再读取点击后属性并按 `changed` 或 `contains` 判断。
- page 03 通过同源 `fetch('mock/reviews.json')` 验证 mock 数据层。

## 命令

```powershell
$env:PYTHONIOENCODING='utf-8'; python spikes/a3-render/a6_interaction/run.py
```

## 原始数据

| 页面 | 声明路径 | trigger/target | clicked | before | after | 结果 |
|---|---|---|---:|---|---|---:|
| page 01 | `counter_increment` | 找到/找到 | 是 | `0` | `1` | 通过 |
| page 01 | `tabs_switch_to_b` | 找到/找到 | 是 | `panel hidden` | `panel` | 通过 |
| page 02 | `mobile_nav_toggle` | 找到/找到 | 是 | `nav-menu` | `nav-menu open` | 通过 |
| page 02 | `faq_accordion_item_1` | 找到/找到 | 是 | `true` | `false` | 通过 |
| page 03 | `load-reviews` | 找到/找到 | 是 | 空字符串 | 5 条评论文本 | 通过 |

汇总：页面生成 **3/3**，声明 JSON 可解析 **3/3**，trigger 找到 **5/5**，expect target 找到 **5/5**，真实点击 **5/5**，断言通过 **5/5**。生成耗时分别为 28.11 s、53.09 s、20.44 s，总计 101.64 s；总 token 为 4,684。page 03 的 `mock/reviews.json` 请求返回 HTTP 200。

每个页面首次运行均记录一次未声明的 `favicon.ico` HTTP 404；它不属于任何声明交互路径，5 条交互断言均完成。该事实保留在 `SUMMARY.json` 的 `console_errors`，未被静默忽略。

## 原始文件

- `SUMMARY.json`：完整 usage、耗时、声明、selector 命中、before/after、click 与 pass 记录。
- `page_01_tabs_counter/index.html`、`INTERACTIONS.json`
- `page_02_nav_faq/index.html`、`INTERACTIONS.json`
- `page_03_mock_reviews/index.html`、`INTERACTIONS.json`、`MOCK.md`、`mock/reviews.json`

## 结论

**A6：通过。** `INTERACTIONS.json` 足以驱动真实 Chrome 对声明路径执行可复现的点击与状态断言，本次覆盖计数器、标签页、导航、FAQ 和异步 mock fetch，共 5/5 通过。favicon 404 是独立的渲染健康观察，不改变“声明路径可点击”的判定。
