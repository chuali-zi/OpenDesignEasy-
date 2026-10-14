# ChatGPT 账号连接与模型兼容

2026-10-13：按用户审核方案实现。产品使用 Pi 1.2.0 公共 SDK；一方代码仍为 TypeScript，Web 和 CLI 共用 runtime。

## 使用

Web 的「模型设置 → AI 连接方式 → 使用 ChatGPT 账号」提供 Continue with ChatGPT。浏览器授权完成后，OEY 验证身份并选择该账号目录中的首个受支持模型；也可手动选择账号及模型。支持添加连接、重新连接、启用套餐权限和退出。

对话栏提供带文字的「模型设置」按钮；`/?settings=ai` 可直接展开此面板。

CLI 使用同一账号存储，可在没有 Web host 时运行：

```powershell
npm run oey -- agent chatgpt-login <project>
npm run oey -- agent chatgpt-status <project>
npm run oey -- agent chatgpt-models <project> --profile <id>
npm run oey -- agent chatgpt-select <project> --profile <id> --model <slug>
npm run oey -- agent chatgpt-logout <project> --profile <id>
```

这些动作也接受 `--host http://127.0.0.1:<port>` 接续本地 owner。登录可用 `--no-browser` 打印授权地址供手动打开，重新授权使用 `--profile <id>`；显式启用套餐使用 `--enable-plan`。新增接口在 `/api/agent/chatgpt` 下，账号信息只返回公开摘要。

## 身份与存储

首次登录使用 `dynamic_agent_client`、稳定 host ID、OEYdesign 名称、PKCE/state/nonce 和 `127.0.0.1` loopback 回调。保存回调签发的 client ID 后交换 tokens，并用 OpenAI JWKS 验证 ID token 的 issuer、audience、有效期和 nonce。再次登录复用 client ID；同一邮箱的多个注册不合并。

账号文件位于当前 OS 用户的应用目录：Windows 为 `%LOCALAPPDATA%/OEYdesign/auth/chatgpt.json`，其他平台为 XDG config 下的 `oeydesign/auth`。Windows 收紧目录 ACL，Unix 使用私有目录/文件权限；当前是受文件权限保护的本地存储，并未声称实现 OS 加密。文件采用原子替换与跨进程锁。项目数据库只保存 profileId 和模型配置；凭据不放入浏览器、作品、导出包或 Git。

Pi CredentialStore 绑定确定的 profile，避免切换账号影响已有 runtime。Pi 管理刷新锁，OEY OAuth hook 验证身份并保存 rotating refresh token。带新 ID token 的轮换先原子保存待验证状态，JWKS 暂时失败时保留后继 token，下一次继续验证。终止性刷新错误清除不可用凭据，普通网络错误保留连接。退出尝试远端撤销并清除本机 tokens，保留账号注册；无法确认撤销时返回真实状态。

## 模型和请求

登录身份与套餐权限分开。只有实际授权包含 `chatgpt.tokens.use.direct` 时启用模型请求；身份登录成功但未授予套餐权限时显示可重新授权的连接。

模型目录使用当前账号的 `GET https://api.openai.com/v1/models`，保留可展示项与服务顺序，以 slug 请求模型。Pi 尚未认识的模型列为当前 SDK 未支持，不虚构上下文长度或图片能力。

ChatGPT 请求使用 Pi OpenAI provider 与公共 `POST /v1/responses`。专用适配固定 `store:false`、`stream:true`，以 developer/instructions 语义传提示，移除预览不支持的参数，并将本地设计工具声明放入 `additional_tools`。保留本地消息与工具结果的往返；对 `response.incomplete`、`response.failed` 和中断流报失败。用量限制提供 ChatGPT Usage 链接，不自动切到 API key 计费。

API key、自定义 provider 和独立 ARK 生图继续使用各自凭据。此通道不宣称支持 OpenAI 托管生图、文件搜索、Code Interpreter 或 tool_search。普通手工编辑和不依赖模型的导出不要求登录。

## 验证边界

确定性检查覆盖实际本地 OAuth 回调、签名身份验证、权限不足、账号错配、并发刷新、JWKS 失败恢复、模型目录、退出和 Pi Responses 工具往返/流失败。浏览器检查使用模拟账号验证产品控件；这些检查不证明真实账号的服务资格、可用模型或套餐计费已通过。

真实验收仍需用户在浏览器完成授权，然后验证「选模型 → 多轮对话 → 文档修改 → 截图识别 → 重启继续 → 退出」。不得把登录状态或目录成功单独称为完整验收。

官方开放范围面向符合条件的本地/开源应用；付费或远程托管产品需另行确认接入资格。OpenAI DevKit 源码未纳入产品。

## 依据

- [OpenAI 登录与注册](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [账号、刷新与退出](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [错误恢复](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Pi 1.2.0](https://github.com/earendil-works/pi/tree/v1.2.0)
