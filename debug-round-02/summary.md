# debug-round-02 summary

第二轮：按评审结论只改 `webui-agent` 的“动作进度契约”，`demo_01` 未动。

## 环境

```text
Node 版本：              v22.23.1
Python 版本：            3.11.16（demo_01/backend/.venv）
Chrome 版本：            153.0.8010.37
chrome-devtools-mcp：    1.7.0（固定，未变）
webui-agent commit：     651c517 + 本轮未提交改动（见 git-diff.patch）
demo_01 commit：         651c517（本轮未修改 demo_01）
```

## 修改内容（仅 webui-agent）

1. `src/case-runner.ts`：
   - `state_reached` 下允许 `operation.completes=[]`（prerequisite/中间动作不再强制消费 operation ID）；
   - `operation_succeeded` 仍要求每个 MCP 操作至少 `completes` 一个 pending ID；
   - 若填了 `completes`，仍只允许 pending ID（未完成的、已存在的 ID 视为非法）。
2. `src/case-runner.ts`：MCP 操作失败时
   - 把真实 MCP 错误写入下一轮 history（`tool <name> failed: <error>`）；
   - 清空 `lastOperationFingerprint`，允许模型用相同参数重试；
   - 不登记任何 `completes`。
3. `src/minimax-provider.ts` `CASE_DECIDE_PROMPT`：
   - 明确 `state_reached` 下 prerequisite/中间动作可以用 `completes=[]`；
   - 只有真正完成该业务操作时才填 operation ID；
   - 还有可执行动作时不要无理由 observe。
4. 单测：`test/case-runner.test.ts` +3（state_reached 空 completes 放行 / operation_succeeded 仍拒绝 / MCP 错误回传且允许同参重试）。

## 静态验证

```text
typecheck:  pass
tests:      33 passed（7 files，含新增 3 条）
build:      pass
demo:       未改；后端 29 tests、前端 tsc+build 沿用上一轮基线
```

## Case B（无上传版）

按用户决定，“文件上传相关操作先不处理”：每次 reset 后用后端 API 预置
`sensor_sample` 数据集（`debug-round-02/demo/seed_dataset.sh`，环境准备，非 agent UI 操作），
Case B 改为：登录 → 创建项目（绑定预置数据集）→ 工作区执行描述性统计 → 审核通过 → 血缘新增节点。

### Case B run1 结果

```text
Case：            Data-Algorithm Studio 冒烟业务链路（无上传）
最终状态：        passed（假通过，未创建项目）
耗时：            约 85s（driver 计时；agent 自身 80s）
actionCount：     15
modelCallCount：  20
contract correction： 无（本轮放开 completes=[] 后，模型没有触发 correction）
重复 action：     有（it13/it15 均 click 新建项目；it16/17/18 相同 fill_form）
no progress：     未触发 maxNoProgress（observe 间隔穿插，模型在 it20 直接判 passed）
timeout：         无
```

### run1 关键迭代（新建项目步骤卡住的真相）

| iteration | 模型决定 | MCP 实际结果 |
|-----------|---------|-------------|
| it13 | `click` 新建项目（uid=19_22）| Error: Element uid "uid=19_22" not found |
| it14 | observe（无变化）| 页面无变化 |
| it15 | `click`（uid=19_*，快照仍旧）| 成功但无对话框实际可交互 |
| it16/17/18 | `fill_form`（uid=25_3，写项目名）| 连续 3 次 Error: Element uid "uid=25_3" not found |
| it19 | `navigate_page` → `completes=['run_descriptive_statistics','approve_algorithm_result']` | 导航成功 |
| it20 | `passed`：理由“全部 ID 已在 completedOperationIds，pending 为空” | —（页面实为 /projects 且显示「暂无项目」）|

最终 artifact 中 `completedOperationIds` 为全部 5 个 ID，但业务上：项目未创建、算法未执行、结果未审核。

## 发现的问题（只记录现象）

### R2-P1：`completes` 为模型自报，Runner 不校验“该 tool call 是否真的完成该业务操作”
```text
现象：navigate_page 被填 completes=['run_descriptive_statistics','approve_algorithm_result']；
      fill_form 也可被填完成 ID；最终在 /projects「暂无项目」页面判 passed
发生位置：webui-agent/src/case-runner.ts（登记 completes 处）+ 模型决策
相关 artifact iteration：case-b-run1.jsonl it17/it18/it19/it20
页面当时状态：/projects，无项目创建成功
模型决定：把剩余 pending ID 一次性全部 completes，然后判 passed
MCP 实际结果：导航成功；业务未完成
最终影响：本轮放开 completes=[] 解决了“中间动作无法表达”，却暴露出“自报完成无验证”——
        上一轮是过早完成 1 个，这一轮是提前完成全部。这是比 P8 更本质的一层
是否稳定复现：本轮稳定出现（run1 完整复现）
```

### R2-P2：模型反复使用过期 DOM uid，导致 MCP “Element uid not found”
```text
现象：同一表单 uid=25_3 连续 3 次 fill_form 报 not found；click uid=19_22 也报 not found
发生位置：模型决策（uid 来自旧 snapshot）；本轮 MCP 错误已回传 history（修复生效）
相关 artifact iteration：it13、it16/17/18
页面当时状态：新建项目对话框（实际是否打开存疑），快照过期
模型决定：沿用上一轮 snapshot 的 uid 重试
MCP 实际结果：Error: Element uid "uid=25_3" not found（参数校验级错误）
最终影响：浪费动作轮次；agent 没有从错误中学会先取新快照（只学会了换参数）
是否稳定复现：本轮连续 3 次
```

### R2-P3：模型在“无任何业务完成”时仍判 passed
```text
现象：模型理由中自己都写明“页面仍显示 暂无项目”，却以“completedOperationIds 全满 + 历史有状态变化标记”
      为据判 passed
发生位置：模型终态判断
相关 artifact iteration：it20
页面当时状态：/projects，暂无项目
模型决定：passed
MCP 实际结果：无操作
最终影响：产生假阳性，测试无法发现业务未完成
是否稳定复现：本轮一次（run1）
```

## 本轮结论（观察，不含方案）

- 契约放松按计划落地且静态验证全绿；中间动作不再被 contract 拦截。
- 但 run1 暴露：`completes` 自报无验证导致“假通过”，比上一轮更接近根因。
  在“新建项目”步骤，模型卡在过期 uid 上重试，随后直接全量完成剩余 ID 并判 passed。
- 按用户决定，run1 作为关键取证保留，run2 暂停，等待评审结论后再定下一步。
- demo_01 未做任何修改；上传相关操作按要求未处理（数据集为 API 预置）。
