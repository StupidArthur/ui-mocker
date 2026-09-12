# debug-round-04 summary

针对 **DeepSeek flash + low thinking** 的容错改造与验证。

## 环境

```text
Node：v22.23.1 / Python 3.11.16 / Chrome 153.0.8010.37 / chrome-devtools-mcp 1.7.0
模型：DeepSeek official API，LLM_BASE_URL=https://api.deepseek.com/v1，
      LLM_MODEL=deepseek-flash，LLM_REASONING_EFFORT=low
API key：仅经环境变量注入，未写入仓库
```

## 本轮改动（webui-agent）

1. **state_reached 的 observe 前置终态验证**：模型返回 observe 时先跑 verifier；
   并用 snapshot 指纹缓存，同一快照只验证一次，不重复调用。
2. **独立精简的 state_reached prompt**（不再与 operation_succeeded 共用一个巨型 prompt）：
   - CURRENT page 优先于旧预期；
   - 控件消失通常意味着状态已转换，不要等待旧控件重现；
   - 同一 observe 无变化不要重复；
   - **弹窗会遮挡证明成功的页面，若内部无更多操作就先关闭再看**。
3. **observe 重复抑制**：同一快照连续 observe 只允许 1 次纠正，超出即 blocked
   （不再由 `maxNoProgress=8` 承担全部职责）。
4. **结构化 `lastTransition` + `consecutiveNoChangeObservations`** 注入模型上下文。
5. **异常退出前 final-state rescue**：blocked/timeout/failed 前补验一次当前快照，可证成功则转 passed。
6. **实验指标**写入 artifact：`firstSuccessIteration` / `sameSnapshotObserveCount` / `rescue`。
7. 修复 artifact 脱敏把 `totalTokens` 等用量字段红成 `[REDACTED]`。
8. provider 层与供应商解耦：`minimax-provider.ts` → `llm-providers.ts`，默认 DeepSeek，
   移除内置明文 Key。

## 关键现场：为什么之前会长时间卡住

用 trial 1 的快照逐条比对：

```text
it9  （点“通过”前）：快照含“通过并沉淀为节点”按钮；无血缘树
it10 （点“通过”后）：按钮消失，只剩“关闭”；快照里没有 数据集：sensor_sample / 已通过
it11 / it12        ：同一快照，模型仍 observe
```

后端可查：`describe` 已 approved、血缘子节点已生成——**业务其实早已完成**。
结果详情对话框一直开着，把工作区/血缘树挡在下面；verifier 只看当前快照 → 看不到终态；
low 模型又不去点“关闭”，于是反复 observe 到 blocked。trial 2 同样卡在此处（长时间无结果）。

## 验证结果（单次，按要求不跑 10 次）

| 项 | trial 1（旧 prompt，无自动关弹窗） | trial 4（最终代码） |
|----|-----------------------------------|---------------------|
| 最终状态 | blocked | **passed** |
| actionCount | 9 | 10 |
| modelCallCount | 13 | 12 |
| 耗时 | 27s | 19s |
| firstSuccessIteration | - | 11 |
| sameSnapshotObserveCount | 2 | 0 |
| rescue | - | agent |
| 业务是否完成 | 是（后端已验证） | 是 |

trial 4 动作序列：登录 → 建项目 → 执行描述性统计 → 点“通过” → **点“关闭”关掉结果弹窗** →
看到血缘树「描述性统计」+「已通过」→ `passed`（verifier 确认，`rescue=agent`）。

指标含义：
- `terminalLag = finalIteration - firstSuccessIteration = 11 - 11 = 0`（业务到终态后，0 个多余决策周期）。
- `sameSnapshotObserveCount = 0`（无重复 observe）。
- `rescue = agent`（模型主动提出 passed，verifier 复核通过）。

## 结论（观察）

- verify-before-observe + 重复观察抑制把“业务已完成但模型误判”的失败从 80s/8 轮压到 27s/3 轮。
- 加入“弹窗会遮挡页面，先关闭再看”这条**通用**规则后，DeepSeek flash low 能一次性把完整链路
  （登录→建项目→算法→审核→血缘节点）走到终态并被 verifier 确认，terminalLag 为 0。
- 本轮未做任何业务硬编码；所有改动均为通用机制。

## 尚未验证

- 只跑了 1 次（按用户要求，控制 token 成本），未做稳定性统计。
- DeepSeek high / MiniMax 在新代码下的表现未重跑。
