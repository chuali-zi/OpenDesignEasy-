# A3 Local Edit 最终详细报告（全新 n=20）

## 1. 假设与统计口径

假设：Local Editor 在读取完整工作区后，能够通过独立事后验证约束声明作用域之外的副作用。

- 统计分母是 `RESULTS.json` 中 20 个完成编辑轮；round 00 基线不进入通过率、diff 中位数或每轮成本统计。
- `all_pass` 必须同时满足锚点保留、契约保持、视觉隔离、渲染健康。
- L3 `reflow_skipped` 按现有 spec/harness 为 `pass=true`，但报告中不计作“已比较通过”。
- diff 中位数采用排序后中位；n 为偶数时取中间两项平均值。diff 分母是排除 mask 后的 `considered_pixels`。
- 只使用 JSON、PNG IHDR 尺寸、HTML source diff 和运行日志，不对截图做审美判断。

## 2. 方法

- 核对 `status=COMPLETE`、`round_count=20`、轮号 1..20、`resumed=false`、连续链和五类编辑分布。
- 从聚合 `RESULTS.json` 独立重算四项检查、L1/L2/L3、分类型失败、diff、token 和 elapsed。
- 逐轮解析 `round_01.json` 至 `round_20.json`，与聚合记录做完整 JSON 等值比较。
- 检查每轮 HTML、JSON、viewport PNG、full PNG、computed contract 文件存在，并用 PNG IHDR 对照 JSON 图片尺寸元数据。
- 对第 1 轮比较 round 00/01 的 HTML、几何、新旧作用域 bbox、considered/diff pixels、diff bbox 和图片尺寸。
- 本次未调用 API、未重跑模型、未合并旧中断数据。

## 3. 原始逐轮数据

`A/C/V/H` 依次为锚点、契约、视觉、渲染健康；`P/F` 为通过/失败。

| 轮 | 类型 | 作用域 | A/C/V/H | L1 | L2 diff | L3 | `all_pass` | token | 秒 |
|---:|---|---|---|---|---:|---|---|---:|---:|
| 1 | text | `hero-subtitle` | P/P/**F**/P | P | **0.046646129211918685** | compared **F**, 0.0054384339665114025 | **F** | 14,527 | 180.17 |
| 2 | attribute | `hero-cta-primary` | P/P/P/P | P | 0 | compared P, 0 | P | 14,526 | 179.69 |
| 3 | structure | `intro-title` | P/P/P/P | P | 0 | compared P, 0 | P | 14,546 | 188.53 |
| 4 | delete-element | `nav-menu` | P/P/P/P | P | 0 | compared P, 0 | P | 14,549 | 184.48 |
| 5 | add-element | `hero-visual` | P/P/P/P | P | 0 | compared P, 0 | P | 14,797 | 197.84 |
| 6 | text | `cases-title` | P/P/P/P | P | 0 | compared P, 0 | P | 14,610 | 184.44 |
| 7 | attribute | `cases-lead` | P/P/P/P | P | 0 | compared P, 0 | P | 14,628 | 196.73 |
| 8 | structure | `services-cta-link` | P/P/P/P | P | 0 | compared P, 0 | P | 14,639 | 205.45 |
| 9 | delete-element | `intro-feature-grid` | P/P/P/P | P | 0 | compared P, 0.00003563518989727641 | P | 14,623 | 196.27 |
| 10 | add-element | `case-card-grid` | P/P/P/P | P | 0 | **reflow_skipped**, null | P | 14,911 | 221.59 |
| 11 | text | `contact-title` | P/P/P/P | P | 0 | compared P, 0 | P | 14,681 | 191.75 |
| 12 | attribute | `contact-email-label` | P/P/P/P | P | 0 | compared P, 0 | P | 14,712 | 179.84 |
| 13 | structure | `contact-phone` | P/P/P/P | P | 0 | compared P, 0 | P | 14,803 | 189.19 |
| 14 | delete-element | `testimonial-cards` | P/P/P/P | P | 0 | compared P, 0.000049355168978325043 | P | 14,643 | 220.44 |
| 15 | add-element | `contact-form` | P/P/P/P | P | 0 | compared P, 0 | P | 14,718 | 217.05 |
| 16 | text | `footer-brand` | P/P/P/P | P | 0 | compared P, 0.0003574494717047548 | P | 14,594 | 194.16 |
| 17 | attribute | `footer-social-title` | P/P/P/P | P | 0 | compared P, 0 | P | 14,617 | 210.06 |
| 18 | structure | `footer-join-title` | P/P/P/P | P | 0 | compared P, 0 | P | 14,720 | 187.97 |
| 19 | delete-element | `footer-nav-list` | P/P/P/P | P | 0 | compared P, 0 | P | 14,753 | 215.55 |
| 20 | add-element | `footer-join-list` | P/P/P/P | P | 0 | compared P, 0 | P | 14,643 | 206.84 |

## 4. 精确汇总

### 检查与视觉层

| 指标 | 通过 | 失败/跳过 | 比率 |
|---|---:|---:|---:|
| 锚点保留 | 20 | 0 | **20/20（100%）** |
| 契约保持 | 20 | 0 | **20/20（100%）** |
| 视觉隔离 | 19 | 1 | **19/20（95%）** |
| 渲染健康 | 20 | 0 | **20/20（100%）** |
| `all_pass` | 19 | 1 | **19/20（95%）** |
| L1 | 20 | 0 | **20/20（100%）** |
| L2 | 19 | 1 | **19/20（95%）** |
| L3 已比较 | 18 | 1 | **18/19（94.736842%）** |
| L3 `reflow_skipped` | - | 1 | **1/20（5%）** |
| L3 harness `pass`（含 skip） | 19 | 1 | **19/20（95%）** |

### 类型分布与失败

| 类型 | n | `all_pass` | 失败轮 | 失败项 | L3 skip |
|---|---:|---:|---|---|---:|
| add-element | 4 | 4/4 | 无 | 无 | 1 |
| attribute | 4 | 4/4 | 无 | 无 | 0 |
| delete-element | 4 | 4/4 | 无 | 无 | 0 |
| structure | 4 | 4/4 | 无 | 无 | 0 |
| text | 4 | **3/4** | 1 | visual：L2、L3 | 0 |

### Diff

| 层 | 有效 n | min | median | max | 备注 |
|---|---:|---:|---:|---:|---|
| L2 | 20 | 0 | 0 | **0.046646129211918685** | 第 1 轮为唯一非零值 |
| L3 compared | 19 | 0 | 0 | **0.0054384339665114025** | 第 10 轮 null，不进入统计 |

L3 的 19 个有效值总和为 `0.005880873797091759`；除第 1 轮外，非零值出现在第 9、14、16 轮，均小于 `0.002`。

### Token 与耗时

| 指标（20 个编辑轮） | min | median | max | total | mean |
|---|---:|---:|---:|---:|---:|
| prompt token | 7,569 | 7,614 | 7,674 | 152,321 | 7,616.05 |
| completion token | 6,944 | 7,011 | 7,299 | 140,919 | 7,045.95 |
| total token | 14,526 | **14,641** | 14,911 | **293,240** | 14,662 |
| elapsed（秒） | 179.69 | **195.215** | 221.59 | **3,948.04** | 197.402 |

round 00 基线为 prompt 403、completion 7,223、total 7,626 token，耗时 203.67 秒。含基线总计 300,866 token、4,151.71 秒。

## 5. 第 1 轮 L2/L3 深入检查

### JSON 与截图元数据

| 字段 | L2 | L3 |
|---|---|---|
| `size_a` / `size_b` | `[1440,900]` / `[1440,900]` | `[1440,4831]` / `[1440,4831]` |
| `size_mismatch` | false | false |
| status | 已执行 | `compared` |
| threshold | 0.002 | 0.002 |
| considered pixels | 574,560 | 6,930,120 |
| excluded pixels | 721,440 | 26,520 |
| diff pixels | 26,801 | 37,689 |
| diff ratio | **0.046646129211918685** | **0.0054384339665114025** |
| diff bbox | `[144,215,624,388]` | `[144,215,746,667]` |

L2 比较区域是 `[0,0,1440,399]`。旧作用域 bbox 为 `[144,399.015625,664,450.203125]`，新作用域 bbox 为 `[144,411.8125,664,437.40625]`。L2 差异 bbox 的 `y1=388`，完全在作用域之上，离旧作用域顶部仍约 11px，因此不是目标像素漏遮罩。

L3 明确排除了上述新旧两个 bbox，差异 bbox 仍从 y=215 延伸到 y=667。即使 bbox 边界有小数取整，L2 的独立结果和 11px 间隔也足以排除“scope bbox 排除问题”作为失败原因。

### 几何传播链

| 锚点 | round 00 y0 | round 01 y0 | 位移 |
|---|---:|---:|---:|
| `hero-kicker` | 211.046875 | 223.84375 | +12.796875 |
| `hero-title` | 254.234375 | 267.03125 | +12.796875 |
| `hero-subtitle` | 399.015625 | 411.8125 | +12.796875；高度减少 25.59375 |
| `hero-cta-primary` | 474.203125 | 461.40625 | -12.796875 |
| `hero-stats` | 573.796875 | 561 | -12.796875 |

HTML source diff 仅替换 `hero-subtitle` 文案。`.hero-grid` 的 `align-items:center` 使左栏内容高度减少后重新居中：目标之前的兄弟下移半个高度差，目标之后的兄弟上移半个高度差。L1 的 DOM 顺序、同行/同列关系均未改变，所以 L1 通过；像素位置确实改变，所以 L2/L3 失败。

### 定性

**这是实际阈值超限。不是 scope bbox 排除问题，不是 harness bug，也不是 `reflow_skipped`。**

它不表示模型修改了作用域外源码；锚点检查和 source diff 均支持“源码只改目标”。它表示目标内合法文案变化通过布局系统传播成了作用域外的渲染变化，按当前 spec 的视觉隔离定义应失败。

作为对照，第 10 轮 L3 的图片从 `[1440,4831]` 变成 `[1440,4997]`，`size_mismatch=true`、`status=reflow_skipped`、`diff_ratio=null`；这才是尺寸变化跳过路径。

## 6. 数据完整性

- `RESULTS.json` 为 `COMPLETE`，声明 20 轮，实际 20 条，轮号连续 1..20。
- 五类编辑计数均为 4，聚合 distribution 与逐轮重算一致。
- round 00 基线和 `edit_plan.json` 与聚合字段完整 JSON 等值。
- round 01..20 的独立 JSON 与聚合 `rounds` 逐条完整等值。
- 20 轮所需 HTML、JSON、viewport PNG、full PNG、computed contract 均存在；PNG IHDR 与 JSON 尺寸元数据一致。
- `run.stdout.log` 记录 20 轮并以 `complete: wrote 20-round RESULTS.json` 结束。
- 离线完整性重算错误数为 0。

## 7. 结论

最终结果是 **19/20 `all_pass`**，不是 20/20。锚点、契约、渲染健康各 20/20；视觉隔离 19/20。五类混合编辑中，属性、结构、删除、增加合计 16/16 全过，文案 3/4 全过。

数据**仍支持事后验证设计**，原因不是“模型从不出错”，而是完整工作区下绝大多数首轮产物通过，且独立检查确实拦截了一个源码作用域内、渲染影响越出作用域的产物。没有事后视觉检查时，第 1 轮会被错误接受。

证据边界：本 harness 失败不重置且不执行 spec §8 的失败重试，所以没有重试后成功率数据；连续链后 19 轮通过也不能把第 1 轮改写为通过。

## 8. 仅对 Spec 的建议

1. 更新 A3 证据为 n=20：四项分别 `20/20、20/20、19/20、20/20`，`all_pass=19/20`。
2. L3 必须并列报告 `18/19 compared pass` 与 `1/20 reflow_skipped`，不能把跳过写成 20/20 已比较通过。
3. 保留阈值 `0.002`，不要用本次真实失败反推放宽阈值。
4. 将“回流只影响下方”改为非绝对规则；居中的 Grid/Flex 子项会向上下两侧传播位移。
5. 为视觉作用域定义布局影响边界：严格元素作用域失败后，spec 可要求扩大到最近布局容器并重新确认/重试，或升级为更大作用域编辑；不能仅凭 source diff 局部就豁免 L2/L3。
6. 保持 `reflow_skipped` 只用于整页尺寸不一致；同尺寸且作用域外超阈值必须记真实失败。
