# D3 + Q1/Q4 Spike 结果：渲染后 contract 与硬检查

> 状态：**D3、Q1、Q4 均完成**。
> 对应假设：`design-intelligence-spec.md` §11 D3、`quality-governance-spec.md` §11 Q1/Q4。
> 抽取器实现：`lib/extract_source.py`（CSS 源码正则）、`lib/extract_computed.py`（浏览器计算后样式）、
> `lib/contract_common.py`（共用 contract 构建与规范化序列化）、`lib/colors.py`（颜色归一化 + WCAG 对比度）。
> Q1/Q4 实现：`lib/hard_checks.py`、`lib/contract_drift.py`；runner 为
> `scripts/run_q1.py`、`scripts/run_q4.py`。

## 1. 假设原文

> **D3**：design contract 抽取在 agent 自由产出的代码上稳定。
> 判定标准：token 抽取的召回率与跨次一致性。

附带要回答的子问题：**计算后样式 vs CSS 源码正则，哪种抽取方式更稳？**

## 2. 方法

**样本不是人造的**：直接用 E4 spike 里 k3 自由生成的 **8 个真实 agent 工作台前端**
（`spikes/e4-mock/runs/run-01..08/`）作为被测输入。这些产物是多文件结构
（`index.html` + `styles.css` + `app.js` [+ `mock*.js`]），正是
`artifact-production-spec.md` §3 定义的「可运行项目」形态。

两种抽取路径对同一批产物各跑一遍：

- **源码正则**：`extract_from_source(html)`，只扫 `index.html` 文本；
- **计算后样式**：`extract_from_computed(page)`，用真实 Chrome 加载整个产物目录
  （本地静态 server，外链请求 `route.abort` 阻断），遍历 DOM 读 `getComputedStyle`。

每个产物的计算后样式抽取**重复 3 次**，比对 `canonical_json` 是否完全一致（确定性要求，
见 `design-intelligence-spec.md` §3「同一份代码必须抽出同一份 contract」）。

## 3. 原始数据

| 产物 | 源码正则：颜色 / 字号 / 间距 / 锚点 | 计算后样式：颜色 / 字号 / 间距 / 锚点 | 3× 确定性 |
|---|---|---|---|
| run-01 | **0 / 0 / 0** / 42 | 9 / 7 / 15 / 40 | ✓ |
| run-02 | **0 / 0 / 0** / 35 | 10 / 6 / 15 / 28 | ✓ |
| run-03 | **0 / 0 / 0** / 21 | 10 / 5 / 17 / 26 | ✓ |
| run-04 | **0 / 0 / 0** / 29 | 11 / 9 / 13 / 44 | ✓ |
| run-05 | **0 / 0 / 0** / 24 | 2 / 6 / 10 / 24 | ✓ |
| run-06 | **0 / 0 / 0** / 24 | 12 / 8 / 15 / 24 | ✓ |
| run-07 | **0 / 0 / 0** / 22 | 12 / 6 / 9 / 25 | ✓ |
| run-08 | **0 / 0 / 0** / 37 | 12 / 16 / 17 / 46 | ✓ |

## 4. 结论

### 4.1 源码正则在真实产物上**完全失效**（0/8）

8 个产物，源码正则抽出的颜色、字号、间距**全部为 0**。

原因不是正则写得差，是**结构性的**：agent 产出的是多文件项目，CSS 在独立的 `styles.css` 里，
而 `extract_from_source(html)` 只扫 `index.html` 的文本。这不是可以靠「再多扫几个文件」修好的
小问题——真实产物还会有 `@import`、CSS 变量、JS 动态注入样式、媒体查询下的不同取值，
源码静态分析要正确处理这些等于重新实现一个浏览器。

### 4.2 计算后样式在 8/8 上都work，且 100% 确定性

- 颜色 2–12 个、字号 5–16 阶、间距 9–17 阶，全部抽出；
- **3 次重复抽取结果字节级一致（8/8）**，满足 spec §3 的确定性硬要求。

（run-05 只抽到 2 个颜色，与它的产物本身简单有关——它是 completion token 撞顶被截断的那两个之一。）

### 4.3 意外发现：锚点数量两种方式不一致，且计算后样式**更多**

| 产物 | 源码锚点 | DOM 锚点 | 差 |
|---|---|---|---|
| run-04 | 29 | **44** | +15 |
| run-08 | 37 | **46** | +9 |
| run-01 | 42 | 40 | −2 |
| run-02 | 35 | 28 | −7 |

差异双向，但多数情况 DOM 锚点更多。原因：产物用 mock 数据在**运行时生成 DOM**
（项目列表、消息气泡等），这些元素带 `data-oey-*` 锚点，但**不在静态 HTML 源码里**。

这是一个对 spec 有直接影响的发现，见 §5.3。

### 4.4 D3 判定：**通过，但必须绑定到计算后样式路径**

假设「contract 抽取在 agent 自由产出的代码上稳定」成立——**前提是用计算后样式**。
如果实现选了源码正则，这条假设是**被证伪**的。

## 5. 对 Spec 的修订建议

1. **`design-intelligence-spec.md` §3 必须明确抽取方式**。当前 spec 只说「抽取器必须是纯确定性
   代码，不调用模型」，没说从哪里抽。实测证明这个留白很危险：源码正则同样满足「确定性、不调模型」，
   但在真实产物上产出全 0。
   建议改为：**「抽取器必须基于真实渲染后的计算样式（computed style），不得只做源码静态分析。」**

2. **「不调模型」≠「不需要浏览器」**。spec §3 说抽取是确定性代码，容易让人以为它很轻。
   实测它需要起浏览器、加载整个产物、遍历 DOM。这对 `commit_direction` 的耗时与依赖有实际影响，
   spec 应写明抽取依赖渲染能力。

3. **锚点清单必须从渲染后的 DOM 取，不能从源码取**（§4.3 的发现）。
   否则：产物用 mock 在运行时生成的带锚点元素不会进 contract，之后 Quality 做契约比对时会把
   这些运行时锚点当成「新增」，或反过来把源码里有、渲染后被 JS 替换掉的锚点判为「丢失」——
   两种都是假警报。这条要同时写进 `design-intelligence-spec.md` §4.4 与
   `quality-governance-spec.md` §3.3。

4. **抽取失败的判定要重新定义**。spec §3 说「抽取失败（例如代码无法解析）必须报
   `DETERMINISTIC_FAILURE`」。但 `extract_computed.py` 的注释里记录了一个真实限制：
   **浏览器的 HTML5 解析器有强制错误恢复，几乎永远不会拒绝产出 DOM**——纯垃圾文本也会渲染成
   一个几乎空的页面。所以「无法解析」这个失败态在计算后样式路径下**基本不会触发**，
   取而代之的是「产出了一个可疑地空的 contract」。
   建议 spec 增加一条：**抽取结果为空或异常稀疏时判为失败**，而不是只依赖解析异常。

## 6. Q1：硬检查检出率与误报率

### 6.1 假设与标注

> **Q1**：对比度、溢出、焦点可见性能可靠检出。

构造 **12 个单一违规 fixture + 6 个干净 fixture**。每个违规页只标一个预期类别，因此对某类别而言，
另外 8 个其他类别违规页与 6 个干净页都是负例。这个标注方式可同时计算每类 TP/FN/FP/TN，避免只报
“12 个坏例都抓到”而没有类别级误报数据。

### 6.2 方法

- 浏览器：Playwright Chromium，明确 `channel="chrome"`，实测 Chrome `150.0.7871.187`；脚本将 stdout/stderr
  设为 UTF-8。
- 视口：桌面 `1280×900` 与移动 `390×844`，每个 fixture 都在两个视口真实加载。
- 信号来源只有**渲染后的 DOM + `getComputedStyle()` + 键盘 Tab**，finding 必须带
  `data-oey-object` / `data-oey-section` 的 `target_ref`；没有使用源码正则。
- 对比度：只评估可见、带 DOM anchor 的直接文本；从根到元素合成 computed background，随后把 alpha
  前景叠到有效背景，再按 WCAG AA 的普通文本 4.5、大字 3.0 判定。
- 溢出：检查锚点真实 bbox 是否横向超出视口，以及 computed `overflow:hidden|clip` 下
  `scrollWidth/Height > clientWidth/Height` 的内容截断；`overflow:auto` 的有意滚动是干净对照。
- 焦点：从页面主体开始实际按 Tab，检查 active element 的 `:focus-visible` 与聚焦前后 computed
  outline / box-shadow / border / background 差异，不把源码中存在 `:focus` 规则当作可见证据。

fixture 由 `scripts/gen_fixtures.py` 确定性生成到 `fixtures/q1/`，期望标注在
`fixtures/q1/manifest.json`。完整 finding（包括 alpha 合成色、ratio、bbox、scroll/client size、聚焦前后样式）
在 `data/q1-results.json`。

### 6.3 原始数据

| Fixture | 预期 | 检出 |
|---|---|---|
| `violation_contrast_opaque` | contrast | contrast |
| `violation_contrast_alpha_text` | contrast | contrast |
| `violation_contrast_alpha_background` | contrast | contrast |
| `violation_contrast_nested_alpha` | contrast | contrast |
| `violation_overflow_fixed_width` | overflow | overflow |
| `violation_overflow_nowrap_clip` | overflow | overflow |
| `violation_overflow_vertical_clip` | overflow | overflow |
| `violation_overflow_min_grid` | overflow | overflow |
| `violation_focus_button` | focus | focus |
| `violation_focus_link` | focus | focus |
| `violation_focus_input` | focus | focus |
| `violation_focus_tabindex` | focus | focus |
| `clean_opaque_accessible` | 无 | 无 |
| `clean_alpha_accessible` | 无 | 无 |
| `clean_responsive_wrap` | 无 | 无 |
| `clean_intentional_scroll` | 无 | 无 |
| `clean_custom_focus` | 无 | 无 |
| `clean_browser_focus` | 无 | 无 |

alpha 样本不是只看 CSS 字面值：alpha text 的 computed `rgba(0,0,0,0.35)` 合成为 `#a6a6a6` / `#ffffff`，
实测比率 **2.434**；alpha background 合成为 `#a6a6a6` 背景，白字比率同为 **2.434**；嵌套 alpha
样本合成后为 `#6d747d` / `#1f2937`，比率 **3.107**，均低于普通文本 4.5。

| 类别 | TP | FN | FP | TN | 检出率 | 误报率 |
|---|---:|---:|---:|---:|---:|---:|
| 对比度 | 4 | 0 | 0 | 14 | 100% | 0% |
| 溢出 | 4 | 0 | 0 | 14 | 100% | 0% |
| 焦点可见性 | 4 | 0 | 0 | 14 | 100% | 0% |
| **总体（54 个类别判定）** | **12** | **0** | **0** | **42** | **100%** | **0%** |

### 6.4 Q1 结论

**Q1 在本受控 corpus 上通过**：12/12 违规检出，6/6 干净页未报错；类别级总体检出率 100%，
误报率 0%。这证明所选确定性信号对本次覆盖的 alpha 对比度、固定/裁切溢出、原生/自定义/缺失焦点环
可行，不证明其对任意网页都是 100%。

## 7. Q4：契约漂移误报率

### 7.1 假设与独立性

> **Q4**：契约偏离检测的误报率可接受。

Q4 有自己的 `fixtures/q4/baseline.html`、computed contract 基线、14 个变体与
`lib/contract_drift.py`，未复用 A3 的判断结果。A3 的 10/10 contract keep 只作背景旁证：A3 使用源码正则，
其 `contract_00.json` 的字号和间距集合为空，不能回答 D3 已发现的真实渲染问题。

### 7.2 方法

- 基线与每个变体都在 Chrome `1280×900` 独立渲染，再调用 D3 的
  `d3-computed-style-v1` 从 computed styles 和 DOM anchors 抽取。
- 独立比较器只实现 spec 当前定义：新增 color / font-size / space token，或基线 DOM anchor 丢失即漂移；
  token 计数变化、锚点顺序变化、新增锚点不报漂移。`extractor_version` 不同则拒绝比较，不默认通过。
- 8 个 control 覆盖改文案、卡片重排、用已有 token 加卡片、加 wrapper、CSS 等价值、改属性、组合编辑、
  保持相同运行时 DOM；6 个 drift 覆盖新颜色、新字号、新间距、静态锚点丢失、JS 运行时锚点丢失、组合漂移。
- 基线并非空 contract：3 个颜色、3 个字号、3 个间距、7 个 DOM anchor，其中
  `cards.runtime` 是脚本渲染后才出现的锚点。

独立基线保存于 `data/q4-baseline-contract.json`，逐变体完整 contract 与差集保存于
`data/q4-results.json`。

### 7.3 原始数据

| Fixture | 预期 | 检出 | 分类 |
|---|---|---|---|
| `control_copy_edit` | 无 | 无 | TN |
| `control_reorder` | 无 | 无 | TN |
| `control_add_existing_card` | 无 | 无 | TN |
| `control_wrapper` | 无 | 无 | TN |
| `control_equivalent_css` | 无 | 无 | TN |
| `control_attribute_edit` | 无 | 无 | TN |
| `control_copy_and_reorder` | 无 | 无 | TN |
| `control_runtime_same_dom` | 无 | 无 | TN |
| `drift_new_color` | color | color | TP |
| `drift_new_font_size` | font-size | font-size | TP |
| `drift_new_space` | space | space | TP |
| `drift_missing_static_anchor` | anchor | anchor | TP |
| `drift_missing_runtime_anchor` | anchor | anchor | TP |
| `drift_combined` | color + anchor | color + anchor | TP |

| TP | FN | FP | TN | 漂移检出率 | control 误报率 |
|---:|---:|---:|---:|---:|---:|
| **6** | **0** | **0** | **8** | **100%** | **0%** |

### 7.4 Q4 结论

**Q4 在本独立 corpus 上通过**：6/6 漂移被检出，8/8 正常编辑未误报，control 误报率 0%。尤其是
运行时锚点丢失可检出，证明 Q4 遵守 D3 的 DOM anchor 路径；A3 的 10/10 不能替代这项结果。

## 8. 对 Spec 的修订建议

1. `quality-governance-spec.md` §3.1/§3.3 应把硬检查与 contract 比对的输入明确锁定为**真实 Chrome
   渲染后的 computed styles + DOM anchors**，禁止回退到源码正则；缺少渲染结果仍按现有规则阻断。
2. 对比度条款应明确 alpha 前景与逐层背景必须先合成再算 WCAG；遇到渐变、背景图、混合模式等无法可靠
   归约的背景应报告“不可确定”，不能默认为通过。
3. 溢出条款应列出代表性桌面/移动视口，并区分 `hidden|clip` 内容截断与 `auto|scroll` 的有意滚动区域，
   finding 必须指向 DOM anchor。
4. 焦点可见性应要求由**键盘导航实际触发**并读取聚焦后的计算样式；源码里出现 `:focus` 选择器不构成证据。
5. 契约漂移维度应固定为 color / font-size / space 新增与 anchor 丢失，并明确 token 频次变化、anchor 重排、
   新增 anchor 是否不算漂移；`extractor_version` 不一致时拒绝比较。
6. Q1/Q4 的验收数据应按类别保存 TP/FN/FP/TN 与逐 finding 原始证据，且报告必须附样本边界，禁止把受控
   fixture 的 100% 外推为生产网页的 100%。

## 9. 诚实说明

- D3 样本仍只有 8 个且来自同一类 agent 工作台，没有独立 token ground truth；其结论是 computed 路径
  相对源码正则可靠，不是跨场景召回率承诺。
- Q1 是 18 个手工、单一标签 fixture。未覆盖渐变/图片背景、`mix-blend-mode`、祖先 `opacity`、transform、
  元素重叠、复杂 shadow 对比度、焦点动画和 iframe；这些都可能产生 FN/FP。
- Q1 的总体矩阵以“fixture × 类别”为单位，共 54 个判定；不是按页面中的每个 DOM 元素计数。
- Q4 control 只有 8 个，且共享一个基线设计系统；0/8 误报的置信范围很宽，不能代表所有正常编辑。
- computed contract 当前会遍历 DOM 中所有元素而不筛掉 `display:none`；隐藏内容引入新 token 时是否应算漂移
  尚未由本 corpus 定义，因此没有把含新隐藏 token 的样本强行标成 control。
- fixture 均为本地静态 HTML，无外部请求；未执行任何模型产生的命令。
