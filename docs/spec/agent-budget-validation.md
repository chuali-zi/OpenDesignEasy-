# 整轮 Agent 有界验收

2026-10-13，TS/Pi 路线。本轮实现与验证使用 Node 24.21.0、Pi 0.85.1、Linux；全部新增检查使用离线 faux provider，不发模型请求。

## 生效范围与失败行为

`AgentServiceOptions.runLimits` 是显式启用的验收限制，直接包裹 Pi 公共 `streamFunction`、`beforeToolCall` 和会话生命周期；不另建模型循环。一个 run 内所有模型 turn 共用请求数、输入预留量、输出预留量、工具数和总截止时间。未配置时不改变正常产品的预算策略。

- 首次传输前预留输入/输出额度；每次请求最多一次 HTTP 传输、禁止重定向、核对 endpoint/model/max_tokens。SDK 和 Pi 会话自动重试均关闭，自动压缩关闭，thinking 显式关闭。
- 输入按序列化上下文的 UTF-8 字节数加 4096 预留，包含系统提示、工具 schema、历史与工具结果；累计预留不退回。它是保守的文本准入检查，**不是供应商 tokenizer，也不是服务端计费的硬担保**。收到的 input/cacheRead/cacheWrite 与 output 累加并检查，超限不再执行工具或发下一次请求。无响应时的 SDK 零 usage 不能当作计费为零。
- 输出额度按每次请求上限预留，未用余额不退回。图像内容在传输前拒绝；单独计费的图片生成等服务不在此预算保证内，当前验收只开放 `document_read`。
- 超时覆盖 session 准备、模型流和工具等待。失败持久化 run/usage，打断该轮全部已接收/已投递输入，清空队列并 abort。即使 provider 或工具忽略 abort，调用方的有界等待仍结束；晚到的模型工具和同批后续工具不能写入。
- 正在执行且自行忽略取消的外部工具副作用无法回滚；本次 live 入口只准许只读工具。恢复应关闭/重开会话；不能假定任意第三方工具可被进程内强制终止。

`scripts/ts/check-r3-native.ts` 已替换旧无上限的视觉验收入口：不加载 `.env` 或凭据文件、不调用截图/生成工具，仅使用已注入 `KIMI_API_KEY`，创建单独的合成红方块项目。失败关闭 runtime 并删除该入口自己创建的 fixture；成功保留本地合成结果与纯元数据 `acceptance.json`。外层另有 60 秒进程看门狗。它不代表旧视觉验收、用户作品或完整 R3/R4 的通过。

## 下一次最小 live 范围（须另行授权，本轮未运行）

| 项目 | 上限/范围 |
|---|---|
| 目标 | `kimi-coding` / `kimi-for-coding`，Anthropic messages，`https://api.kimi.com/coding/v1/messages` |
| 模型请求 | 最多 2 次：读取合成文档的工具请求 + 工具结果后的文本回复 |
| 输入预留总量 | 32000，按上述保守方法准入；实际 usage 单独报告 |
| 输出预留总量 | 1024，每请求最多 512 tokens，thinking 关闭 |
| 工具 | 最多 1 次，仅 `document_read`，无写入、图像或外部服务 |
| 截止 | 整轮 45 秒，入口进程 60 秒 |
| 重试/重定向/压缩 | 均关闭；超限、错模型或未按要求调用工具即失败，不自动扩大额度 |

获批的新任务在迁移包的准确 commit 上运行：

```sh
node --import tsx scripts/ts/check-r3-native.ts --live-tools
```

需现有凭据注入、官方域名网络准许及兼容 Node/Pi；不创建或读取密钥文件。命令输出只含协议、模型、限制、usage 与文档未改动结论，不回显模型内容/错误原文。失败保留退出码与清理边界，未知 usage 不补算。新任务先核对提交和离线回归，不在旧基线直接运行同名脚本。

## 离线证据

`packages/runtime/test/agent-budget.test.ts` 经真实 Pi AgentSession + faux provider 验证：两轮共享额度、请求数上限、累计输出预留、输入准入、同批工具上限、provider 错误零重试、HTTP 重复/错目标/错上限、实际 usage 超限、挂起工具/模型截止及晚到写入阻断、失败状态重开保留。HTTP 测试替换本地 fetch，不访问外网。

验收入口无 `--live-tools` 时在凭据检查和项目创建前退出。文本单请求探针继续独立存在；其通过不能替代这组整轮工具保护测试。最终回归结果与迁移说明随交付包保存。

补充 `scripts/ts/native-acceptance.test.ts` 在独立子进程使用合成凭据、真实 Pi 序列化和完全拦截的 fetch；确认仅一次官方目标传输尝试、redirect=error、失败不输出原始异常/凭据，并删除自己创建的项目。没有外网请求。

最终检查：完整离线套件 95/95（35.4 秒）；之后增加入口清理用例和关闭后的异步状态保护，受影响 runtime 与入口回归 33/33（8.4 秒）；CLI 构建（含 tsc）和 Web 构建通过，Chromium E2E 12/12（31.5 秒）。无跳过项、无模型费用。Web 仍有原有 bundle 大于 500 kB 警告。测试子进程仅继承启动必需环境，未继承真实模型凭据。
