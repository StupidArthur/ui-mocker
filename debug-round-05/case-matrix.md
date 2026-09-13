# debug-round-05 case-matrix

模型：DeepSeek official API / `deepseek-flash` / thinking `low`。阶段：phase 2（每 Case ×5）。

| Case | Interaction Type | Runs | Passed | False Positive | False Negative | Avg Actions | Avg Calls | Avg Tokens | Avg Time(ms) |
| ---- | ---------------- | ---: | -----: | -------------: | -------------: | ----------: | --------: | ---------: | -----------: |
| 01 | login + navigation | 5 | 5 | 0 | 0 | 2.0 | 4.0 | 17616.8 | 8430.2 |
| 02 | modal form (create account) | 5 | 5 | 0 | 0 | 6.0 | 8.0 | 41338.6 | 12425.8 |
| 03 | file upload | 5 | 5 | 0 | 0 | 5.0 | 7.0 | 35054.4 | 11109.6 |
| 04 | create record + route change | 5 | 5 | 0 | 0 | 6.0 | 8.0 | 44489.8 | 13299.2 |
| 05 | operation + result panel (async-ish) | 5 | 5 | 0 | 0 | 8.0 | 10.0 | 54889.4 | 14950.0 |
| 06 | state toggle / control change (publish) | 5 | 5 | 0 | 0 | 7.0 | 9.0 | 52129.6 | 14074.0 |
| 07 | destructive + confirm + disappear (delete) | 5 | 5 | 0 | 0 | 5.0 | 7.0 | 36725.0 | 11504.4 |
| 08 | full multi-step business chain | 5 | 4 | 0 | 1 | 10.0 | 12.0 | 72770.0 | 86292.0 |
| 09 | failure condition (negative) | 5 | 0 | 0 | 0 | 2.0 | 4.0 | 17208.4 | 7433.8 |

**Overall real pass rate (Case 01–08, phase 2):** 39/40 = 97.5%
**False positive count:** 0
**False negative count:** 1  (Case 08 run 2: 业务已 approved，Agent 未在窗口内收敛/被 watchdog 截断)
**Total runs (all cases, phase 2):** 45
**Median elapsed:** 12161 ms
**Median totalTokens:** 41325

## 补充
- Case 02 = 搜索/筛选：demo_01 无搜索/筛选能力，`not_applicable`（未新增功能）。
- Case 03 首轮因 MCP 文件路径限制失败（`Access denied: outside allowed workspace root`），
  加 `--allowUnrestrictedPaths` 后 5/5 通过。
- Case 09 为负向用例，期望 `failed`；5/5 正确 `failed`，无 false positive。
- 所有 phase-2 passed 均通过独立后端业务状态复核（businessCheck=ok），false positive = 0。
- Case 08 的 Avg Time 含 1 次 360s hung；仅统计 4 次 passed 时均值为 ~17.9s。
