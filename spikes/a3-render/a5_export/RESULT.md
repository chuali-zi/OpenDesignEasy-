# A5 / Q6 Spike 最终结果：导出物重渲染一致性

> 状态：**通过（10/10）**。10 个 A4 materialized artifact 均成功导出 ZIP、解压并真实重渲染；CRC、成员清单和逐文件 SHA-256 全匹配，10/10 原始截图对逐像素一致，已记录的渲染诊断为零。

## 1. 假设

> **A5 / Q6**：ZIP 导出物解压并重新进入真实渲染后，与 Artifact 自身的真实渲染一致；验证不能退化为只检查 ZIP 存在或只比较一个包哈希。

- 正式样本固定为 A4 `trial_01..10/materialized/`，不枚举 `trial_99`。
- 通过条件：ZIP 可完整读取；source、ZIP、unzip 的成员清单和逐文件内容一致；Artifact 与解压导出物同尺寸且 `diff_ratio <= 0.002`；无渲染错误。
- A4 的 resume/recovery provenance 不改变 A5 样本单位。A5 对每个已完成 artifact 独立打包、解压、校验并渲染，不读取其他 trial 的内容。

## 2. 离线复核方法

本次没有调用 API，也没有重新导出或覆盖正式产物：

1. 对 10 个 `export.zip` 执行 ZIP CRC 检查，并检查成员名无绝对路径、`..` 和重复项。
2. 分别枚举 A4 source materialized、ZIP 和 `export_unzipped/`；要求三方清单完全相等。
3. 对每个成员计算 source bytes、ZIP 解压流、落盘 unzip bytes 的 SHA-256，要求三方逐文件相等；另记录每个 ZIP 自身的 SHA-256 供证据定位。
4. 从已存的 20 张 A5 PNG 独立重算尺寸和像素 diff；另在系统临时目录对 10 对 artifact/export 做当前本地健康重渲染，不覆盖原始证据。
5. 将复核值与 `SUMMARY.json` 的 file count、zip bytes、diff 和错误字段交叉检查。

## 3. 原始数据

### 3.1 ZIP、manifest 与 hash

| trial | ZIP bytes | files | ZIP SHA-256 | CRC | source=ZIP=unzip 清单/逐文件 hash |
|---|---:|---:|---|---:|---:|
| 01 | 4,948 | 8 | `76a4366d876510eb5a391ae48beabce8360966a1a87519755baaf607d2893ee3` | 通过 | 通过 |
| 02 | 5,040 | 4 | `a43e486fe9ce450dd680fd55f6674c0def24b35a202890a7a61384988eb00c10` | 通过 | 通过 |
| 03 | 5,391 | 4 | `dff6534ddafc667bc00cc9b3bda15b5a7f742aa2c4d14091d8085390be2e7340` | 通过 | 通过 |
| 04 | 3,434 | 3 | `9d9bb0ab8a49f8e478466753a0365e35dd902f81f9e08a215724bde66f3920b8` | 通过 | 通过 |
| 05 | 6,090 | 6 | `c8ff822a5cf85622cd653c4aca784a174b9c70b6c9723319482b471534c0a1a9` | 通过 | 通过 |
| 06 | 4,793 | 10 | `d2e763f0bc13368db3ac08e3fad1b343aa05424eabbeb416c2f95cda08fa23d3` | 通过 | 通过 |
| 07 | 2,614 | 3 | `f64c4b81a225f0a2db913d8e92427c38cd29f93de1be7b761fd107bb0e56d993` | 通过 | 通过 |
| 08 | 3,945 | 6 | `bfd0337903c71fef47d11708143929f0658ccd3d254a1252cabf4d20f1642e4f` | 通过 | 通过 |
| 09 | 3,954 | 7 | `065c69c6b0d001a6227d02ee17e89f7558a30fe47f0855a72e0100940b460e30` | 通过 | 通过 |
| 10 | 2,545 | 3 | `9565e3a346360e2b279663edc545e77e2eddc3da668849f68d1941c82f44cc79` | 通过 | 通过 |

汇总：10/10 ZIP CRC 正常、成员路径安全且无重复；三方清单 **10/10** 相等，三方逐文件 SHA-256 **54/54** 相等。共 54 个文件、42,754 ZIP bytes，单包范围 2,545..6,090 bytes。ZIP 自身 hash 用于标识具体包；内容等价结论来自逐成员三方 hash，而不是假设 ZIP 容器 bytes 与目录相同。

### 3.2 重渲染 diff 与健康

| trial | Artifact 尺寸 | Export 尺寸 | diff pixels | diff ratio | 原始渲染诊断 |
|---|---|---|---:|---:|---:|
| 01 | 1440 x 2618 | 1440 x 2618 | 0 | 0 | 0 |
| 02 | 1440 x 2176 | 1440 x 2176 | 0 | 0 | 0 |
| 03 | 1440 x 2848 | 1440 x 2848 | 0 | 0 | 0 |
| 04 | 1440 x 2235 | 1440 x 2235 | 0 | 0 | 0 |
| 05 | 1440 x 1848 | 1440 x 1848 | 0 | 0 | 0 |
| 06 | 1440 x 1503 | 1440 x 1503 | 0 | 0 | 0 |
| 07 | 1440 x 1210 | 1440 x 1210 | 0 | 0 | 0 |
| 08 | 1440 x 1454 | 1440 x 1454 | 0 | 0 | 0 |
| 09 | 1440 x 1534 | 1440 x 1534 | 0 | 0 | 0 |
| 10 | 1440 x 1272 | 1440 x 1272 | 0 | 0 | 0 |

- 原始证据：同尺寸 10/10，阈值内 10/10，逐像素一致 10/10；总比较 26,925,120 像素，差异 0。
- 原始健康：10 个 artifact 和 10 个 export 的 console errors、failed requests 均为空，10 条记录无顶层 `error`。原 A5 harness 没有把 `page_errors` 写入 `SUMMARY.json`，因此不能宣称原始 page-error 字段为零；本次当前复核补查为零。
- 当前离线健康复核：20 次本地页面渲染的 console error、failed request、page error 均为零；10/10 当前截图对仍逐像素一致。
- trial 05 在 A5 原始运行和本次复核中均能完整加载 `asset_4.svg`，进一步确认 A4 原始记录中的一次超时不是导出物遗留缺陷。

## 4. Resume / Recovery 与独立性

- A5 本身不生成模型内容，也不 resume 模型会话。它只消费 A4 已通过当前 HTML 校验、manifest 完整和真实渲染检查的 10 个 artifact。
- A4 trial 07..09 的 recovery 是从各自有效 attempt/HTML 无 API 重建确定性 checkpoint；A5 随后仍为每个 trial 单独创建 ZIP 和全新解压目录，并独立比较清单、hash 与截图。
- recovery 没有跨 trial 拼接文件，也没有放宽 A5 的任何判据。因此执行恢复只影响何时产生 checkpoint，不影响 10 个独立 export trial 的判定。

## 5. 原始文件

- `SUMMARY.json`：最终 10 条 ZIP、清单、渲染健康和 diff 记录。
- `trial_01..10/export.zip`、`export_unzipped/`、`artifact.png`、`export.png`。
- 上游 source：`../a4_materialize/trial_01..10/materialized/`。

## 6. 结论

**A5：通过。Q6：通过。** 10/10 导出物通过 ZIP 完整性、清单、逐文件内容 hash 和真实重渲染四层检查；54/54 文件内容保持，10/10 截图逐像素一致，原始已记录诊断与当前完整健康复核均没有 error。

## 7. 仅对 Spec 的建议

1. 导出验证必须包含 source/ZIP/unzip 三方成员清单和逐文件 cryptographic hash；ZIP 自身 hash 仅用于证据定位，不能替代内容比较。
2. 要求 ZIP CRC、重复成员、绝对路径和 `..` 路径检查，避免“可打开”被误当成“可安全交付”。
3. 保留“解压后进入真实 Renderer 并做尺寸 + 像素 diff”的硬要求；hash 一致只能证明字节保持，不能替代渲染健康。
4. Harness 与报告应分别持久化 manifest/hash、渲染 diff、console error、failed request、page error；不能因未保存 `page_errors` 就推定其为零，同时应说明 recovery provenance 不改变逐 trial 判据。
