# debug-round-05 summary

本轮：在 `webui-agent + demo_01` 上扩到 9 个 Case（覆盖登录/表单/Modal/上传/路由/算法结果/状态切换/删除确认/负向失败），
统一用 **DeepSeek official API / deepseek-flash / low thinking**，先每 Case ×1（phase 1），再每个有效 Case ×5（phase 2）。
只看证据，不为通过率改 Case、不重构 Agent。

## 环境与配置

```text
Node v22.23.1 / Python 3.11.16 / Chrome 153.0.8010.37 / chrome-devtools-mcp 1.7.0
provider: DeepSeek official API  base: https://api.deepseek.com/v1
model: deepseek-flash            thinking: low (LLM_REASONING_EFFORT=low)
API key 仅经环境变量注入，未落盘
```

## 本轮改动（仅阻断性）

1. `mcp-adapter.ts` `defaultMcpArgs` 增加 `--allowUnrestrictedPaths`。
   原因：客户端未协商 MCP roots 时，文件工具被限制在 OS 临时目录，导致 Case 03 上传仓库内 fixture
   被拒（`Access denied: path ... outside the allowed workspace root`）。属确定性 MCP 参数配置 blocker。
2. `case-runner.ts` metrics 增加 4 个纯计数指标：`verificationCount` / `malformedModelResponseCount` /
   `mcpErrorCount` / `duplicateOperationCount`（不改状态机）。
3. 其余机制（verify-before-observe、重复 observe 抑制、final rescue、prompt、scheduler、provider 架构）
   本轮**未修改**。

## Case Suite（debug-round-05/cases）

| # | Case | 交互模式 | 数据集 |
|---|------|---------|--------|
| 01 | 登录并进入数据集页 | login + navigation | - |
| 02 | 创建账号弹窗 | modal form | - |
| 03 | 上传数据集 | file upload | - |
| 04 | 创建项目并进入工作区 | create + route change | 预置 |
| 05 | 执行算法并查看结果 | operation + result panel | 预置 |
| 06 | 公开项目 | state toggle / control change | 预置 |
| 07 | 删除数据集并确认 | destructive + confirm + disappear | 预置 |
| 08 | 完整业务链（Case B） | full multi-step | 预置 |
| 09 | 错误密码登录失败 | failure condition（负向） | - |
| 02-search | 搜索/筛选 | **not_applicable**（demo 无此能力，未新增） | - |

## 结果（phase 2，每 Case ×5）

完整矩阵见 `case-matrix.md`。摘要：Case 01–08 真实通过 **39/40 = 97.5%**；**false positive = 0**；
**false negative = 1**（Case 08 run 2）；Case 09 5/5 正确 `failed`（期望值）。

- Case 01–07：各 5/5，`terminalLag=0`、`sameSnapshotObserveCount=0`、`mcpErrorCount=0`、`malformed=0`、`duplicate=0`。
- Case 08：4/5 passed；run 2 业务已 `approved`（后端复核 businessCheck=ok）但 Agent 未在窗口内收敛，被 harness watchdog 截断 → false negative。
- Case 09：5/5 `failed`，理由均为“页面提示用户名或密码错误”，无 false positive。
- 所有 passed 均通过**独立后端业务状态复核**（businessCheck=ok），与 Agent 的 verifier 相互印证。

## 回答五个问题

### 1. DeepSeek flash low 能稳定处理哪些 UI 模式？

```text
login / form fill / submit:      stable   (Case 01, 5/5)
navigation / route change:       stable   (Case 01, 04, 5/5)
modal open/fill/submit/close:    stable   (Case 02, 5/5)
file upload (fixture 允许后):     stable   (Case 03, 5/5)
create record + 进入新页面:        stable   (Case 04, 5/5)
operation + 结果面板出现:          stable   (Case 05, 5/5)
状态切换 / 控件变化:               stable   (Case 06, 5/5)
destructive + confirm dialog:    stable   (Case 07, 5/5)
failure condition 判定:           stable   (Case 09, 5/5 正确 failed)
完整多步业务链:                    mostly stable (Case 08, 4/5)
```

### 2. 哪些失败是重复出现的？

phase 2 中没有任何失败重复出现 ≥2 次。全部失败/异常只有：
- Case 08 run 2：完整链业务完成后 Agent 未收敛（1 次）。
- Case 03 phase 1：MCP 路径限制（确定性 blocker，已修）。

跨轮次看，**“完整链审核后终态识别”** 是唯一反复出现的失败家族（debug-round-04 曾复现），
本轮在 verify-before-observe + “关闭遮挡弹窗”规则后降到 1/5，但未归零。

### 3. 是否存在 false positive？

**没有。** phase 2 的 45 次运行中，所有 `passed` 都经过独立后端业务复核（businessCheck=ok），
没有出现“业务未完成却 passed”。Case 09（负向）5/5 正确 `failed`，未误报成功。

### 4. Case B 的成功是否可以泛化到其他 Case？

可以。Case B 所依赖的通用能力（登录、填表、Modal、列表状态判断、终态验证、弹窗关闭后重新观察）
在 Case 01–07 上全部 5/5 稳定复现，说明不是只适配 Case B。唯一残留是完整链的收敛偶发变慢。

### 5. 当前最大的 1～3 个真实瓶颈（artifact 支持）

1. **完整业务链的终态收敛偶发失败**：Case 08 run 2 业务已 approved，但 Agent 在 360s 窗口内未结束；
   artifact 只有 setup（被 watchdog 截断），后端可证业务完成。属 B/G（终态识别/观察收敛），
   发生频率 1/5。注：harness `case_timeout=340s` 小于 Case 08 自身的 600s 上限，属截断因素之一。
2. **MCP 文件访问路径限制**：未协商 roots 时本地 fixture 被拒；已用 `--allowUnrestrictedPaths` 修复，
   属环境配置瓶颈（已解决，不再复现）。
3. **Token 随页面复杂度线性上升，且以 prompt 为主**：简单 Case ~17.6k，完整链 ~72.8k；
   `decisionEfficiency=actionCount/modelCallCount ≈ 0.83`（稳定，无决策浪费循环），
   即 token 高来自大 DOM 快照本身，而非模型空转。本轮不优化，仅记录。

## 未做/未改

- 未新增 demo 搜索/筛选能力；Case 02 记为 `not_applicable`。
- 未为通过率放宽任何 success 条件；success 仍为可观察业务状态。
- 未裁剪上下文、未改 prompt/scheduler/verifier/runner 主状态机。
