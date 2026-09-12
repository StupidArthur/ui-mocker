# WebUI 测试 Agent

这是一个由大模型驱动、通过 `chrome-devtools-mcp` 操作浏览器的交互式 UI 测试 Agent。目前处于 MVP 阶段。

核心原则：一个 Agent 进程持有一个长期 MCP/Chrome 会话；一个测试用例描述业务目标、结束条件和时间预期，Agent 可以执行多个受控原子操作，直到成功、失败、阻塞或超时。不使用 Playwright，也不要求用户编写代码、XPath 或 CSS selector。

## 当前状态（2026-08-23）

已经完成：

- 进程级 MCP/Chrome 长期会话；
- 交互式 REPL，可运行 YAML/JSON 业务测试用例；
- MiniMax-M3 驱动 Think 和 Judge；
- 每轮模型决策最多执行一个原子操作，一个用例可以包含多轮；
- 短任务高频、长任务退避式的自适应观察；页面无变化时不重复调用模型；
- 操作前、操作后瞬时状态、等待后稳定状态的完整取证；
- `passed`、`failed`、`blocked` 三种结果；
- JSONL artifact 持久化和敏感字段脱敏；
- 独立 Chrome profile、项目内 npm cache、可选 headless；
- 28 项单元测试，类型检查和构建均通过；
- 真实可视 Chrome + MCP + MiniMax 登录用例端到端通过。

真实验收使用 `examples/debug-login.html` 和 `examples/debug-login.case.yaml`：Agent 依次执行 `fill_form`、`click`，进入短期观察；页面在 800ms 后出现业务反馈，调度器检测到变化后再次调用模型，最终以 2 个业务操作、4 次模型决策判定 `passed`。Chrome/MCP 需要允许启动桌面进程；权限受限时导航会返回超时并正确记录为 `blocked`。

## 流程设计

Agent 启动时只建立一次 MCP 连接，并由 `chrome-devtools-mcp` 启动一个隔离 Chrome。每个业务用例执行以下循环：

```text
读取目标、成功/失败条件和时间预算
→ 获取当前页面证据
→ 模型返回：一个原子操作 / 观察 / passed / failed / blocked
→ 原子操作后立即获取证据，再进入下一轮
→ 观察时按 short/long 策略轮询
→ 页面无有效变化：不调用模型
→ 页面发生变化：携带当前状态和最近摘要进入下一轮
→ 达到硬超时：timeout
```

- `expected` 决定默认采用短期还是长期观察节奏，`timeout` 是程序强制执行的硬截止时间。
- 短期观察间隔从 0.5 秒逐步增加到 3 秒；长期观察从 5 秒逐步增加到 5 分钟。
- 原始 DOM/截图写入 artifact；模型只接收当前证据和最多 10 条近期动作/变化摘要，避免上下文无限增长。
- 终态判断和下一动作合并成一次模型调用，减少成本，并避免已成功时继续误操作。
- `state_reached` 的 `passed` 不再信任 Agent 自报：由独立 Verifier 只看 `completion.success/failure` 与当前最新 snapshot 复核一次，未证实则拒绝并继续。

步骤结果含义：

- `passed`：证据能够确认步骤目标已经达成；
- `failed`：操作完成，但证据与目标矛盾，或操作明确失败；
- `blocked`：页面、工具或证据不足以安全继续；
- `timeout`：超过用例明确配置的最长时间。

某一步 `failed` 或 `blocked` 不会关闭浏览器，用户仍可在同一页面会话中继续输入步骤。

## 启动与交互

环境要求：Node.js 18+、npm，以及本机可用的 Chrome。

```powershell
npm install
npm run dev
```

程序当前内置了项目提供的临时 MiniMax 测试 Key。可以用环境变量覆盖：

```powershell
$env:MINIMAX_API_KEY = "你的 API key"
npm run dev
```

启动成功后：

```text
WebUI step agent connected. session=<session-id>
Artifact: artifacts/session-<session-id>.jsonl
> /open http://localhost:3000/login
opened http://localhost:3000/login
> /run examples/login.case.yaml
running case: 正确账号登录
[2] passed: ... actions=3 modelCalls=4
> /exit
```

REPL 命令：

```text
/open <url>   在当前 Chrome 会话中打开 URL
/run <file>   运行 YAML 或 JSON 业务测试用例
/status       显示 session id、连接状态和当前序号
/help         显示帮助
/exit         关闭 MCP/Chrome 并退出
```

`/run` 用于具有明确结束条件和时间预算的正式用例。普通自然语言输入也统一进入 V2：MiniMax 会先将它编译为稳定的 Case Contract，并拆出带唯一 ID 的 `requiredOperations`。每次 MCP 工具成功后，程序登记本次完成的操作 ID；`operation_succeeded` 的全部 ID 完成时由程序直接判定通过，不再依赖模型记忆或额外页面变化。明确包含等待、检查、出现、跳转或业务结果时生成 `state_reached`，才允许进入观察。控制台会显示 mode、expected 和 timeout。

测试用例格式：

```yaml
name: 正确账号登录
description: 使用测试账号完成登录，根据页面依次完成必要输入和提交
start_url: http://localhost:3000/login
completion:
  mode: state_reached
  success:
    - 页面进入首页
    - 页面显示当前用户名
  failure:
    - 页面提示账号或密码错误
timing:
  expected: 3秒
  timeout: 15秒
limits:
  maxActions: 10
  maxNoProgress: 5
```

时间支持毫秒、秒、分钟和小时，例如 `500毫秒`、`3秒`、`30分钟`、`1小时`。示例见 `examples/`。

## 配置

默认 MCP 启动方式：

```text
npx -y chrome-devtools-mcp@1.7.0 --isolated
```

MCP 版本固定在 `src/mcp-adapter.ts` 的 `CHROME_DEVTOOLS_MCP_VERSION`，不使用 `@latest`，避免同一仓库 commit 因 npx 拉到不同版本而行为漂移。当前固定 **1.7.0**：这是 README 记录的端到端验证日期（2026-08-23）时 `@latest` 实际解析到的版本；更新的 1.8.0+ 将 `navigate_page` / `take_snapshot` 的 `pageId` 改为必填，会破坏现有 adapter 的 `setup` 与快照采集。

常用环境变量：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `MINIMAX_API_KEY` | 覆盖内置临时 MiniMax Key | 内置测试 Key |
| `LLM_API_KEY` | 通用 LLM Key，优先于 `MINIMAX_API_KEY`/`OPENAI_API_KEY` | 无 |
| `LLM_PROTOCOL` | `chat_completions` 或 `responses`，切换协议 | `chat_completions` |
| `LLM_BASE_URL` | 供应商 API 根路径（含 `/v1`） | 按协议默认 |
| `LLM_MODEL` | 覆盖模型名 | `MiniMax-M3`（chat）/ `gpt-5`（responses） |
| `WEBUI_HEADLESS=1` | 使用 headless Chrome | 可视 Chrome |
| `WEBUI_ARTIFACT_PATH` | 指定 artifact 文件 | `artifacts/session-<id>.jsonl` |
| `WEBUI_SESSION_ID` | 指定会话 ID | 自动生成 UUID |
| `NPM_CONFIG_CACHE` | 指定 MCP 子进程 npm cache | 项目内 `.npm-cache` |
| `WEBUI_MCP_LOG_PATH` | 指定 MCP stderr 日志文件 | `artifacts/mcp-stderr.log` |
| `WEBUI_MCP_STDERR=inherit` | 调试时让 MCP 日志直接显示在终端 | 默认写入日志文件 |

`--isolated` 会为每次 Agent 会话创建独立 Chrome profile，并在浏览器关闭后清理，避免与本机已有 Chrome profile 冲突。

Chrome DevTools MCP 的 stderr 默认不会写入 REPL，避免 `No handler registered for issue code PerformanceIssue` 等重复日志打断输入。这些日志保存在 `artifacts/mcp-stderr.log`；只有设置 `WEBUI_MCP_STDERR=inherit` 时才会恢复终端输出。

## Artifact 与调试

每个 `/open` 和测试步骤占 JSONL 文件中的一行。步骤记录包含：

- `sessionId`、`stepId`、`sequence` 和时间戳；
- 用户输入；
- MCP 能力列表；
- 每个阶段的原始模型/MCP 返回；
- 实际工具名、参数、返回和错误；
- DOM、截图等证据；
- 最终状态与原因。

排查问题时按以下顺序查看：

1. `takeShotBefore.raw`：模型操作前实际看到了什么；
2. `think.raw`：模型选择了什么工具和参数；
3. `operate.toolCalls`：MCP 是否执行成功；
4. `takeShotImmediate.raw`：是否出现瞬时 Loading、弹窗或错误；
5. `wait.raw`：页面是否稳定或超时；
6. `takeShotSettled.raw`：最终页面状态；
7. `judge.raw`：模型根据哪些证据得出结论。

artifact 保存前会脱敏名称包含 API key、Authorization、password、secret、token 或 credential 的字段，也会替换常见 Bearer Token 和 `sk-` Key 字符串。

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
```

当前验证基线：28 项测试通过。

主要代码：

```text
src/cli.ts               REPL 和进程生命周期
src/session.ts           长期 MCP/Chrome 会话
src/case-runner.ts       多原子操作业务用例循环
src/observation-scheduler.ts 自适应观察调度
src/runner.ts            兼容的旧版单步骤执行
src/mcp-adapter.ts       Chrome DevTools MCP 适配
src/llm.ts               协议无关的 LLM 客户端（Chat Completions / Responses）
src/minimax-provider.ts  MiniMax Think/Judge/Compiler
src/artifact-store.ts    JSONL 保存与脱敏
src/types.ts             输入、阶段和 artifact 类型
```

## 已知限制

- 页面变化检测目前使用完整 DOM snapshot 指纹，尚未提取更精确的业务字段或网络信号；
- 长任务目前要求 Agent 进程和 Chrome 持续运行，尚未实现任务持久化恢复；
- 尚未实现 Agent 主动向用户提问来消除歧义；
- 尚未实现会话恢复，Agent 进程退出后不能继续旧 Chrome 状态；
- MiniMax 输出采用 JSON 文本解析，尚未使用服务端强约束的 structured output；
- 临时测试 Key 明文存在于原型代码，正式使用前必须移除并轮换；
- 启动可视 Chrome 需要桌面进程权限；受限沙箱中可能出现导航超时。

## 下次继续工作的建议顺序

1. 使用真实业务页面运行 `/run <case.yaml>`，继续积累不同控件和失败场景的 artifact；
2. 增加长时间任务的真实端到端验证和进程恢复；
3. 支持一次加载并汇总多个业务测试用例；
4. 为 `blocked` 增加澄清交互，而不是让 Agent 擅自执行额外操作；
5. 补充会话级汇总报告，再考虑 CI 或批量执行；
6. 正式部署前移除内置 Key，改为安全配置并完成密钥轮换。
