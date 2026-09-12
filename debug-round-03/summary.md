# debug-round-03 summary

第三轮：`state_reached` 不再信任模型自报 `completes`，`passed` 走独立终态验证；
并新增 `LLM_REASONING_EFFORT` 支持，先后用 MiniMax-M3 与 DeepSeek official API（flash）
各跑了一次 Case B（thinking high / low）。

## 环境

```text
Node 版本：          v22.23.1
Python 版本：        3.11.16（demo_01/backend/.venv）
Chrome 版本：        153.0.8010.37
chrome-devtools-mcp：1.7.0（固定）
webui-agent commit： 945ca97 + 本轮未提交改动（LLM_REASONING_EFFORT / 取证）
demo_01 commit：     945ca97（本轮未改 demo_01）
```

## 模型配置（本轮验证）

- **MiniMax-M3**：`LLM_BASE_URL=https://api.minimaxi.com/v1`，协议 `chat_completions`
- **DeepSeek official API**：`LLM_BASE_URL=https://api.deepseek.com/v1`，`LLM_MODEL=deepseek-flash`
  - 官方返回支持的模型名是 `deepseek-flash` / `deepseek-v4-pro`；传 `deepseek-chat` 别名也落到 flash
  - 我们的 `extraBody`（`reasoning_split` + `thinking.type`）DeepSeek 接受：
    `high → adaptive` 会返回 `reasoning_content`；`low → disabled` 返回干净回答
  - API key 通过 shell 环境变量 `LLM_API_KEY` 注入，未写入任何仓库文件
- 思考等级：`LLM_REASONING_EFFORT=high|low`（chat 映射 `thinking.adaptive/disabled`，
  responses 映射 `reasoning.effort`），默认 `low`

## 本轮代码改动

- `src/llm.ts`：新增 `LLM_REASONING_EFFORT` 解析与默认 extraBody 映射
- `src/llm.ts` / `src/mcp-adapter.ts` / `src/case-runner.ts` / `src/minimax-provider.ts` /
  `src/types.ts` / `src/session.ts` / `src/cli.ts`：state_reached 契约 + 终态验证 + uid 归一化
  （已提交于 945ca97，详见上一轮；本轮只新增 effort 配置）
- 单测：`test/llm.test.ts` 增加 effort 映射 4 条（共 50 tests）

## 静态验证

```text
typecheck:  pass
tests:      50 passed（8 files）
build:      pass
```

## Case B（无上传版，数据集 API 预置）结果对比

| 运行 | 模型 | 思考 | 最终状态 | actions | modelCalls | 耗时 | 备注 |
|------|------|------|---------|---------|-----------|------|------|
| MiniMax-M3 high | MiniMax-M3 | high | **passed（真实）** | 10 | 13 | ~69s | verifier 确认工作区+血缘子节点+已通过 |
| MiniMax-M3 low | MiniMax-M3 | low | blocked | 2 | 6 | ~25s | 模型输出未转义引号，JSON 解析失败 |
| DeepSeek high | deepseek-flash | high | **passed（真实）** | 10 | 12 | ~28s | verifier 确认终态 |
| DeepSeek low | deepseek-flash | low | blocked | 9 | 18 | ~80s | **业务已完成**（后端可查），模型未识别终态 |

两次 `passed` 都是**真实通过**（非假通过）：verifier 只看 completion + 当前 snapshot，
确认了「工作区 + 血缘树根节点下描述性统计子节点 + 已通过」后才放行。
`completedOperationIds` 在 state_reached 下保持 `[]`（不再登记模型自报），符合预期。

## 发现的问题（只记录现象）

### R3-P1：low thinking 下模型输出稳定性下降
```text
现象：MiniMax-M3 low 在登录后首个决策返回未转义 ASCII 双引号
      "reason":"...已显示"登录成功"..."，JSON.parse 失败 → blocked（25s，actions=2）
发生位置：minimax-provider.parseJson 上游（模型输出质量）
相关 artifact iteration：case-b-thinking-low.jsonl（第 5 次决策，blocked）
页面当时状态：/datasets，登录成功
模型决定：点击数据集卡片进入详情（含中文引号文案）
MCP 实际结果：未执行（解析即失败）
最终影响：Case 直接 blocked；high thinking 未出现该问题
是否稳定复现：low 一次；提示 low 思考模式下格式纪律更差
```

### R3-P2：审核通过后模型无法识别“按钮已消失”的终态
```text
现象：DeepSeek low 在 it9 点击「通过并沉淀为节点」成功后，连续 8 轮 observe，
      反复找「通过并沉淀为节点」按钮 uid（快照只剩「关闭」），最终 maxNoProgress blocked
发生位置：案例决策 + observation 循环
相关 artifact iteration：case-b-deepseek-low.jsonl it10–it18
页面当时状态：结果详情对话框已打开，运行状态已 approved（按钮按业务逻辑消失）
模型决定：始终 observe，等按钮出现
MCP 实际结果：observe 无变化（checkpoint）；后端已 approved、血缘子节点已生成
最终影响：Agent 没认出终态已达成，未发起 passed，verifier 未被调用 → blocked
是否稳定复现：本轮一次；属于“成功后状态变化导致找不到原控件”的识别问题
```

### R3-P3：DeepSeek flash 对 `deepseek-chat` 等别名归一
```text
现象：请求 deepseek-chat / deepseek-reasoner，响应 model 字段均回 deepseek-flash
发生位置：DeepSeek API 服务端
相关：模型探测 curl
最终影响：无；官方支持的显式名称为 deepseek-flash / deepseek-v4-pro
是否稳定复现：是（服务端行为）
```

## 本轮结论（观察，不含方案）

- state_reached 契约 + 独立终态验证设计在两次真实通过中生效：模型无法再靠 checklist 自证。
- 两次 blocked 都发生在“终态之后”：一次是模型输出格式崩坏（MiniMax low），
  一次是模型没认出按钮已消失的终态（DeepSeek low）——后者业务其实已完成，属于识别/判定问题，
  而非执行问题。这也说明 verifier 只覆盖“模型主动 passed”的路径，模型不提 passed 就触发不到。
- 新模型接入零代码改动：DeepSeek official API 走既有 `LLM_BASE_URL/LLM_MODEL/LLM_API_KEY` +
  chat_completions 即可，`thinking.type` 参数被接受。
