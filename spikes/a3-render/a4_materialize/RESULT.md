# A4 Spike 最终结果：交付化渲染不变性

> 状态：**通过（n=10）**。`trial_01..10` 均为独立有效输入并完成单文件、物化文件真实渲染；10/10 同尺寸且 `diff_ratio <= 0.002`，其中 9/10 原始截图逐像素一致，max `0.00011461339586339586`。

## 1. 假设

> **A4**：确定性的交付化处理，即把单文件 HTML 拆为 `index.html + styles.css + assets/`，不改变真实渲染结果。

- 正式判据为 10 个独立有效 trial；每个 trial 的单文件与物化文件整页截图同尺寸，且 `diff_ratio <= 0.002`。
- 单像素 RGB 三通道绝对差之和大于 24 才计为差异。视口固定为 1440 x 900，使用 Playwright `channel="chrome"` 真实整页渲染。
- 独立性指每个主题都以固定 system/user prompt 单独生成，不携带前一 trial 的页面或消息历史。执行是否 resume/recovery 不改变该定义。

## 2. 离线复核方法

本次没有调用 API，也没有重跑生成。复核以最新 `SUMMARY.json`、`trial_01..10/generation_attempt_*.json`、HTML、物化清单和 PNG 为依据：

1. 重新执行与 harness 相同的 HTML fail-fast 规则：文档闭合、至少 3 区、每区至少 2 个 object、至少 1 个可解码 base64 图片、无外部 URL 和动效。
2. 核对 10 个连续且唯一的 idx、每项顶层 `error`、manifest 中样式拆分和每个 asset 的实际存在性/字节数。
3. 从已存的 20 张原始 PNG 重新计算尺寸、差异像素、bbox 和 ratio，不直接采信 `SUMMARY.json` 的 diff 字段。
4. 另在系统临时目录对 10 对页面做纯本地健康重渲染，不覆盖原始证据；汇总 console error、failed request、page error，并重算当前 diff。
5. usage/elapsed 从当前正式目录内全部 12 份 attempt JSON 求和；accepted 与无效重试分开，避免只计成功调用。

## 3. 原始数据

### 3.1 每 trial 结果

`HTML bytes` 是生成响应在写盘前的 UTF-8 字节口径；`tokens/elapsed` 是最终被接受 attempt 的值。

| trial | attempts | HTML bytes | sections | min objects | data URI | accepted tokens | accepted elapsed (s) | 原始尺寸 | diff pixels | diff ratio |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 01 | 1 | 11,813 | 5 | 2 | 6 | 11,805 | 320.419 | 1440 x 2618 | 0 | 0 |
| 02 | 1 | 14,869 | 5 | 4 | 2 | 7,004 | 219.253 | 1440 x 2176 | 0 | 0 |
| 03 | 1 | 16,646 | 7 | 4 | 2 | 13,961 | 387.048 | 1440 x 2848 | 0 | 0 |
| 04 | 1 | 9,107 | 4 | 4 | 1 | 3,350 | 98.512 | 1440 x 2235 | 0 | 0 |
| 05 | 1 | 17,650 | 6 | 4 | 4 | 6,486 | 188.863 | 1440 x 1848 | 305 | 0.00011461339586339586 |
| 06 | 3 | 10,964 | 4 | 3 | 8 | 10,829 | 275.221 | 1440 x 1503 | 0 | 0 |
| 07 | 1 | 5,001 | 4 | 2 | 1 | 2,199 | 62.805 | 1440 x 1210 | 0 | 0 |
| 08 | 1 | 7,849 | 4 | 2 | 4 | 3,477 | 110.823 | 1440 x 1454 | 0 | 0 |
| 09 | 1 | 8,762 | 5 | 2 | 5 | 3,822 | 108.402 | 1440 x 1534 | 0 | 0 |
| 10 | 1 | 5,399 | 4 | 2 | 1 | 2,210 | 42.688 | 1440 x 1272 | 0 | 0 |

复核汇总：HTML 有效 **10/10**；manifest/asset 完整 **10/10**；同尺寸 **10/10**；阈值内 **10/10**；原始逐像素一致 **9/10**。高度范围 1210..2848，宽度均为 1440；总比较 26,925,120 像素、差异 305 像素，加权 ratio `0.000011327711817069`。最大单 trial ratio 是阈值的 5.73%。

### 3.2 生成重试、usage 与 elapsed

| 口径 | attempts | prompt | completion | total tokens | reasoning | API elapsed (s) |
|---|---:|---:|---:|---:|---:|---:|
| 被接受生成 | 10 | 4,338 | 60,805 | 65,143 | 24,716 | 1,814.035 |
| 无效重试 | 2 | 846 | 32,000 | 32,846 | 31,994 | 824.551 |
| 全部正式 attempts | 12 | 5,184 | 92,805 | 97,989 | 56,710 | 2,638.586 |

- 9/10 trial 首次成功；仅 trial 06 重试 2 次。其 attempt 1、2 均为空响应且各达到 16,000 completion tokens，attempt 3 有效。
- 两次重试另有配置内的 5 + 10 = 15 秒退避；表中 elapsed 是 attempt 记录的 API elapsed，不含退避。
- accepted total token 的 min/median/max 为 2,199 / 5,154 / 13,961；accepted elapsed 的 min/median/max 为 42.688 / 149.843 / 387.048 秒。

### 3.3 错误与健康

- 10 条最终记录均无顶层 `error`，10 份被接受 HTML 的 validation errors 均为空；不存在旧 `trial_07` 阻塞错误遗留在最新 `SUMMARY.json`。
- 原始记录中，trial 05 的 materialized 渲染保留 1 条 console error 和 1 条 failed request，二者是同一次本地 `asset_4.svg` `ERR_CONNECTION_TIMED_OUT`；对应原始差异为 305 像素，bbox `(947, 796, 967, 818)`。其余原始记录诊断为零，所有 page error 为零。
- 本次纯本地复核重渲染中，10/10 单文件和 10/10 物化文件的 console/failed request/page error 全为零，10/10 当前截图对逐像素一致。后续 A5 对 trial 05 的 artifact 和 export 重渲染也均健康。因此该历史事件不是当前资源缺失或遗留产物错误，但原始诊断不能从报告中抹去。

## 4. Resume / Recovery 说明

- `--resume` 只接受从 trial 01 开始连续、`error` 缺失、validation 有效、四项交付文件齐全且当前 HTML 再校验有效的前缀；首个不满足项及其后目录会被视为 pending，而不是拼接进结果。
- trial 07..09 在外部 runner 中断后，由各自已经落盘的有效 `generation_attempt_01.json` 和 `single/index.html` 无 API 重建 checkpoint：重新校验 HTML、重新物化、重新渲染并重算 diff。trial 10 是 resume 后的新生成；最新记录中 07..09 标为 `recovered_after_external_interrupt`，10 标为 `resumed`。
- 恢复只重做确定性后处理，不创建或修补模型响应，也不把无效 attempt 算作有效 trial。每个 trial 仍由自己的主题、有效 attempt、HTML、manifest 和截图独立判定，既不消费其他 trial 内容，也不共享成功条件，因此不会改变独立 trial 判定。
- `resume.stdout.log` 是中断时留下的过程片段，不是最终结果源；最终口径是最新 `SUMMARY.json` 加当前磁盘证据的重新计算。

## 5. 原始文件

- `SUMMARY.json`：最终连续 `trial_01..10` 记录。
- `trial_01..10/generation_attempt_*.json`：12 次正式生成 attempt 的脱敏 message、usage、elapsed 和 validation。
- `trial_01..10/single/index.html`、`materialized/`、`single.png`、`materialized.png`。
- `resume.stdout.log`、`resume.stderr.log`：外部中断前的过程片段。
- `trial_99/`：非正式目录，未被枚举、未计入 n=10。

## 6. 结论

**A4：通过（n=10）。** 10 个独立有效输入均完成确定性交付化和真实渲染，10/10 在既定 `0.002` 阈值内。原始证据 9/10 逐像素一致，唯一非零差异与一次历史本地资源超时一致；当前全面重渲染及 A5 后续渲染均为零诊断、零 diff，不存在持续性 artifact error。

## 7. 仅对 Spec 的建议

1. 在交付化验证条款写明 `diff_ratio <= 0.002`、尺寸必须一致，并同时报告阈值内率与逐像素一致率，不能只写“通过”。
2. 把 resume 契约写成“连续有效前缀 + HTML 再校验 + 四项产物齐全”；把 recovery 限定为从同 trial 的有效 attempt/HTML 无模型重建确定性 checkpoint，并记录 `run_mode`。
3. 成本口径要求同时报告 accepted usage 与全部 attempt usage/elapsed；否则重试成本会被漏掉。
4. 区分“原始运行诊断”和“当前健康复核”。历史错误必须保留，但只有在同一资源当前仍失败或 manifest/hash 不完整时才标记为遗留 artifact error。
