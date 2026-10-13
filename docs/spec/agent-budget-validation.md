# 整轮 Agent 有界验收

2026-10-13，TS/Pi 路线。预算实现先通过 Node 24.21.0、Pi 0.85.1、Linux 的离线检查，随后完成另行获批的 K2.8 最小只读 live 验证；范围与结果见下文。

## 生效范围与失败行为

`AgentServiceOptions.runLimits` 是显式启用的验收限制，直接包裹 Pi 公共 `streamFunction`、`beforeToolCall` 和会话生命周期；不另建模型循环。一个 run 内所有模型 turn 共用请求数、输入预留量、输出预留量、工具数和总截止时间。未配置时不改变正常产品的预算策略。

- 首次传输前预留输入/输出额度；每次请求最多一次 HTTP 传输、禁止重定向、核对 endpoint/model/max_tokens。SDK 和 Pi 会话自动重试均关闭，自动压缩关闭，thinking 显式关闭。
- 输入按序列化上下文的 UTF-8 字节数加 4096 预留，包含系统提示、工具 schema、历史与工具结果；累计预留不退回。它是保守的文本准入检查，**不是供应商 tokenizer，也不是服务端计费的硬担保**。收到的 input/cacheRead/cacheWrite 与 output 累加并检查，超限不再执行工具或发下一次请求。无响应时的 SDK 零 usage 不能当作计费为零。
- 输出额度按每次请求上限预留，未用余额不退回。图像内容在传输前拒绝；单独计费的图片生成等服务不在此预算保证内，当前验收只开放 `document_read`。
- 超时覆盖 session 准备、模型流和工具等待。失败持久化 run/usage，打断该轮全部已接收/已投递输入，清空队列并 abort。即使 provider 或工具忽略 abort，调用方的有界等待仍结束；晚到的模型工具和同批后续工具不能写入。
- 正在执行且自行忽略取消的外部工具副作用无法回滚；本次 live 入口只准许只读工具。恢复应关闭/重开会话；不能假定任意第三方工具可被进程内强制终止。

`scripts/ts/check-r3-native.ts` 已替换旧无上限的视觉验收入口：不加载 `.env` 或凭据文件、不调用截图/生成工具，仅使用已注入 `KIMI_API_KEY`，创建单独的合成红方块项目。失败关闭 runtime 并删除该入口自己创建的 fixture；成功保留本地合成结果与纯元数据 `acceptance.json`。外层另有 60 秒进程看门狗。它不代表旧视觉验收、用户作品或完整 R3/R4 的通过。

## 固定最小 live 范围（追加运行须另行授权）

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
npm run check:native-tools -- --live-tools
```

需现有凭据注入、官方域名网络准许及兼容 Node/Pi；不创建或读取密钥文件。命令输出只含协议、模型、限制、usage 与文档未改动结论，不回显模型内容/错误原文。失败保留退出码与清理边界，未知 usage 不补算。新任务先核对提交和离线回归，不在旧基线直接运行同名脚本。

## 代理启动规范与诊断

从仓库根目录使用上述 npm 入口；它通过 Node 官方 `--use-env-proxy --use-system-ca` 启动同一个有界脚本。npm 正常继承现有 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`（及小写变量）、`NODE_EXTRA_CA_CERTS`、`SSL_CERT_FILE`/`SSL_CERT_DIR`。不把值写进源码、日志或提交，不创建新代理/凭据，不改 DNS、网络、白名单或 TLS 校验。只使用现有 CA 信任设置；不设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。如果外层隔离环境变量，必须保留已有代理和 CA 设置，不能仅保留 PATH 与模型 key。无 `--live-tools` 时入口在调用模型前拒绝执行。

Pi 的 Anthropic messages provider 将传入的 fetch 交给官方 SDK；预算边界最终使用 Node 全局 fetch。Node 不会仅因环境里存在代理变量就自动采用它们，必须启用受支持的环境代理选项。

先做无凭据诊断，禁止先重复模型 POST：仅报告代理/CA 变量名和是否存在，比较系统无认证 HEAD 与 Node HEAD。2026-10-13 的对照中，系统 HEAD 返回 HTTP404；Node 直连报 `EAI_AGAIN`，仅开启代理而缺少现有 CA 设置时报 `SELF_SIGNED_CERT_IN_CHAIN`；保留既有代理/CA 并开启官方选项后 Node HEAD 返回 HTTP404。404 仅证明该 HEAD 得到 HTTP 响应，不证明模型认证或工具能力。原失败来自隔离启动配置，不应只凭该错误判断模型服务永久不可达。诊断不得打印带认证的代理 URL、签名 URL或原始请求 headers，也不得用关闭 TLS 校验解决证书问题。

`scripts/ts/native-acceptance.test.ts` 从真实 npm 入口启动 Node，用合成凭据和完全拦截的 fetch，验证代理/CA 设置保留、官方启动选项生效、TLS 默认校验保留、一次失败无重试以及 fixture 清理；不访问代理或模型服务。离线复现先 `mkdir -p .tmp`，再 `node --import tsx --test scripts/ts/native-acceptance.test.ts`。

## 2026-10-13 云验证与交接边界

live 验证使用准确目标 `5c5a4ebd021ed615405018b6f9179ffcd8114373`，后续收尾只持久化启动规范与离线检查，不追加模型请求。迁移核对保留全部五个提交及 tree；原分支和远端不改。

- 目标完整离线套件 96/96、预算/runtime/host/native 入口 23/23、Chromium E2E 12/12，CLI 与 Web build 通过。Web bundle 的既有 >500 kB 提示仍在。
- 第一次隔离启动的 live 为一次 fetch 尝试、零 HTTP响应/工具，`EAI_AGAIN`，usage 未知；原始失败保留，不把内部零 usage 作为实际零费用。
- 修复启动配置后，重新获批的单轮为两次 HTTP200、一次 `document_read`、6.725 秒。仅合成红色正方形；工具返回与文档快照完全一致，文档未改变，最终描述准确。
- 供应商 usage 经 Pi 解析：首轮 input631/output71；第二轮 input494/output44/cacheRead512；合计非缓存输入1125、缓存读取512、输出115，总1752 tokens。程序输入预留14524、输出预留1024，没有提额或重试。Pi cost 字段是静态目录估算，未读取供应商实际账单。
- 此证据仅覆盖最小 K2.8 只读工具链。审美反馈、完整设计质量、Web 的完整编辑/导入和四端三媒介产品范围没有据此判为通过；R4 清单见 [R4 记录](r4-web-validation.md)。

交接包保留原始失败、代理对照、成功 usage、运行脚本、离线日志与提交身份。恢复后核对 HEAD、tree、依赖的 workspace 包是否解析到当前 checkout，再跑离线检查；不要把 node_modules 整体链接到旧 checkout 而误测基线。未来 live 须新授权，继续使用同一预算，不自动重放历史请求。

持久化收尾的独立离线入口检查 2/2、最终完整套件 97/97（无跳过）、CLI build/tsc 通过；该轮不发模型请求。既有 Web build 与 Chromium 12/12 来自上述准确 live 目标，收尾未修改 Web/runtime 实现，不伪称已在收尾提交另跑 live 或浏览器。

## 离线证据

`packages/runtime/test/agent-budget.test.ts` 经真实 Pi AgentSession + faux provider 验证：两轮共享额度、请求数上限、累计输出预留、输入准入、同批工具上限、provider 错误零重试、HTTP 重复/错目标/错上限、实际 usage 超限、挂起工具/模型截止及晚到写入阻断、失败状态重开保留。HTTP 测试替换本地 fetch，不访问外网。

验收入口无 `--live-tools` 时在凭据检查和项目创建前退出。文本单请求探针继续独立存在；其通过不能替代这组整轮工具保护测试。最终回归结果与迁移说明随交付包保存。

补充 `scripts/ts/native-acceptance.test.ts` 在独立子进程使用合成凭据、真实 Pi 序列化和完全拦截的 fetch；确认仅一次官方目标传输尝试、redirect=error、失败不输出原始异常/凭据，并删除自己创建的项目。没有外网请求。

最终检查：完整离线套件 95/95（35.4 秒）；之后增加入口清理用例和关闭后的异步状态保护，受影响 runtime 与入口回归 33/33（8.4 秒）；CLI 构建（含 tsc）和 Web 构建通过，Chromium E2E 12/12（31.5 秒）。无跳过项、无模型费用。Web 仍有原有 bundle 大于 500 kB 警告。测试子进程仅继承启动必需环境，未继承真实模型凭据。
