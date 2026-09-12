# debug-round-01 summary

本轮目标是：只做必要修改（reset + MCP 版本固定），然后通过真实运行暴露问题。
以下内容以“观察到了什么”为主，除本轮已修阻断性 bug 外，不包含解决方案设计。

---

## 一、环境

```text
Node 版本：      v22.23.1
npm 版本：       10.9.8
Python 版本：    3.11.16（demo_01/backend/.venv）
Chrome 版本：    153.0.8010.37（macOS，可视 Chrome）
chrome-devtools-mcp 版本： 1.7.0（固定）
webui-agent commit： 1fceba3 + 本轮未提交改动（见 git-diff.patch）
demo_01 commit：      1fceba3 + 本轮未提交改动（见 git-diff.patch）
```

关于 MCP 版本：仓库 README 记录的端到端验证日期是 2026-08-23，当日 `@latest`
解析到 **1.7.0**（1.8.0 发布于 2026-08-25）。因此“当前验证可用版本”即 1.7.0。
实测 1.9.0 会直接破坏现有 adapter（见问题 P1）。

---

## 二、修改内容（仅描述实际做过的改动）

### 1. `demo_01`：新增确定性 reset（本轮要求）
- 新增 `demo_01/reset_demo.py`：删除 `config.DATA_DIR`（SQLite + uploads + derived），
  再复用既有 `db.init_db()` 重建表与默认管理员 `admin/admin123`；幂等、无新框架。
- `demo_01/README.md`、`demo_01/docs/runbook.md`：补充 reset 用法。

### 2. `webui-agent`：固定 MCP 版本（本轮要求）
- `src/mcp-adapter.ts`：新增常量 `CHROME_DEVTOOLS_MCP_VERSION = "1.7.0"`，
  `defaultMcpArgs()` 由 `@latest` 改为 `@${CHROME_DEVTOOLS_MCP_VERSION}`；结构未动。
- `README.md`：同步为 `npx -y chrome-devtools-mcp@1.7.0 --isolated` 并记录固定原因。
- `test/adapter.test.ts`：断言固定版本字符串。

### 3. 本轮由真实运行暴露、允许直接修的阻断性 bug（已修并保留原始失败现场）
- **`src/minimax-provider.ts` `parseJson`**：模型可能连续返回两个 JSON 对象，
  旧逻辑“首个 `{` 到末个 `}`”切片后无法解析，首个决策即 `blocked`（actions=0）。
  改为失败后提取**第一个完整平衡的 JSON 对象**（带字符串/转义感知）。
  原始现场保留在 `agent/case-b-run1-attempt1-blocked.jsonl`。
- **`src/cli.ts` `normalizeCase`**：文件用例的 `requiredOperations` 被静默丢弃
  （artifact 中 `requiredOperations: []`）。补上字段透传。
  原始现场保留在 `agent/case-b-run1-attempt2-blocked.jsonl`。
- 对应单测：`test/minimax-provider.test.ts`、`test/case-loader.test.ts` 各 +1。

未改动（按要求）：`requiredOperations`/`completedOperationIds`/`operation.completes`/
`completion.mode`/`operation_succeeded`/`state_reached` 语义、Case Compiler/Runner 状态机、
Observation Scheduler 策略、Artifact 数据结构、Provider/MCP Adapter/Session 模块拆分。

---

## 三、静态验证结果

```text
webui-agent typecheck:      pass（tsc --noEmit，无输出）
webui-agent tests:          pass（7 files / 30 tests）
webui-agent build:          pass（tsc）
demo backend tests:         pass（29 passed in 5.75s，pytest）
demo frontend tests/build:  pass（tsc --noEmit && vite build，1659 modules）
                             注：前端无独立测试脚本，执行的是 build 中的类型检查
demo reset:                 pass（连续两次执行输出一致，幂等）
demo reset 后可登录:        pass（/api/health=ok，admin/admin123 返回 token）
```

`reset → 启动 demo → 冒烟登录 → 再次 reset → 再次登录` 两轮均成功，无残留导致差异。

---

## 四、Case 结果

### Case A：短链路自然语言任务
任务（普通自然语言入口，未手写 MCP 步骤）：

```text
打开 Data-Algorithm Studio 登录页 http://localhost:5173/login，
使用默认管理员账号 admin/admin123 登录，并确认进入数据集页面（URL 包含 /datasets）。
```

| 项 | 值 |
|----|----|
| 最终状态 | `passed` |
| 耗时 | 约 13s（driver 计时） |
| actionCount | 3 |
| modelCallCount | 4 |
| contract correction | 无 |
| 重复 action | 无 |
| no progress | 无 |
| timeout | 无 |

Compiler 结果（artifact `case-a.jsonl`）：
- name: `Login to Data-Algorithm Studio as admin and reach datasets page`
- completion.mode: `state_reached`（用户明确要求“确认进入数据集页面”，合理）
- success: `["Browser URL contains '/datasets'"]`
- requiredOperations: `navigate_to_login_page` / `fill_admin_credentials` / `submit_login_form`
- timing: expected 8s / timeout 30s，limits: maxActions 12 / maxNoProgress 4

实际动作序列：
1. `navigate_page` → completes `navigate_to_login_page`
2. `fill_form`（uid 批量填 admin/admin123）→ completes `fill_admin_credentials`
3. `click`（登录按钮）→ completes `submit_login_form`
4. 模型直接 `passed`（URL=/datasets，页面出现「数据集」「admin/管理员」「登录成功」）

观察结论：compiler 的 mode 与 requiredOperations 与用户任务一致；未出现重复动作、
contract correction、无意义观察；登录成功后及时判定 passed。未见 Case A 侧问题。

### Case B：多步骤业务链路（run1）
用例来源：把 `demo_01/docs/ui-smoke-test-case.md`（已有优化版冒烟测试）的业务链路
编码为 `agent/case-b.yaml`（登录→上传数据集→建项目→执行描述性统计→审核通过→血缘新增节点）。
**该用例本轮未能跑通，run1 共 3 次尝试：**

| 尝试 | 最终状态 | 耗时 | actionCount | modelCallCount | 说明 |
|------|---------|------|-------------|----------------|------|
| attempt1 | `blocked` | ~6s | 0 | 1 | 首个决策模型连续返回两个 JSON，parseJson 失败 |
| attempt2 | `blocked` | ~81s | 1 | 10 | `maxNoProgress`：填表后不断 observe，页面不变 |
| attempt3（canonical run1） | `failed` | ~598s | 4 | 14 | 模型在逼近 600s 硬超时时主动判 failed |

attempt3 动作序列（`agent/case-b-run1.jsonl`）：
1. `fill_form` → completes `fill_login_credentials` ✅ 执行
2. `click` 登录 → completes `submit_login` ✅ 执行
3. `click`「上传数据集」按钮 → completes `upload_dataset` ✅ 执行（**过早完成**）
4. `upload_file`（`filePath=` 单数）→ completes `upload_dataset` ❌ 未执行（contract 拒绝）
5. `upload_file`（同上，重复）→ completes `upload_dataset` ❌ 未执行（contract 拒绝）
6. observe（6 次轮询，无变化）
7. `click`（uid 4_8）→ completes `create_project` ✅ 执行（**完成 ID 明显错配**）
8. `click` → completes `[]` ❌ 未执行（contract 拒绝）
9. `navigate_page /datasets` → completes `[]` ❌ 未执行（contract 拒绝）
10-13. observe（各 4 次轮询，无变化）
14. 模型主动 `failed`

contract correction：4 次（it4/it5 `completes` 已完成 ID；it8/it9 `completes=[]`）。
重复 action：有（it4/it5 相同 `upload_file`），但因先被 contract 拦截而未被 duplicate 抑制。
no progress：是（反复无变化 checkpoint）。
timeout：无 runner 超时；模型在 598s 主动 failed，逼近 10 分钟上限。

### Case B run2（reset 后重复）
- 已执行：停后端 → `python3 reset_demo.py`（成功）→ 重启后端 → health 200、admin 登录成功。
- 随后启动 Case B run2；driver 在 setup 阶段被**用户中止**（用户判断完整链路跑不通）。
- 产物 `agent/case-b-run2.jsonl` 仅含 1 条 setup 记录，无 case 结果。
- 未发现“依赖上一轮残留数据”的迹象：reset 后数据目录为空，登录链路正常。

---

## 五、Case B 两轮差异

本轮只完成 1 个可分析的 Case B 结果（run1 attempt3，`failed`），run2 被中止，故无法完成
“reset 前后同用例行为对比”。已确认的差异仅限环境层面：

```text
run1 前：环境已 reset 并启动，但 Case A 已产生 1 个登录会话 token（无业务数据）
run1 后：reset（删除 DB+uploads+derived）→ 重启后端，初始库仅 admin
run2：   setup 导航成功后被用户中止，未进入业务步骤
```

因此“第二轮是否出现不同 selector / 页面状态 / 数据冲突”本轮**没有证据**，不应据此下结论。

---

## 六、发现的问题（只记录现象）

### P1：chrome-devtools-mcp 1.8.0+ 将 `pageId` 改为必填，直接打挂现有 adapter
```text
现象：navigate_page / take_snapshot 调用返回 -32602 Input validation error: Required at pageId
发生位置：webui-agent/src/mcp-adapter.ts setup()/captureShot() 及模型下发的 page 工具
相关 artifact iteration：mcp 探测脚本（mcp-probe.mts / mcp-schema-version.mts）
页面当时状态：不适用
模型决定：不适用
MCP 实际结果：1.9.0 下 required=["pageId"]，setup 与 takeShotBefore 均报错
最终影响：若固定到 1.9.0，Agent 无法启动/取证；本轮通过固定 1.7.0 规避（未改 adapter 结构）
是否稳定复现：是（1.9.0 必现；1.7.0 的 required=null）
```

### P2：模型单次返回两个 JSON 对象导致解析失败
```text
现象：MiniMax returned invalid JSON，内容为两个连续 {"kind":"operation",...} 对象
发生位置：webui-agent/src/minimax-provider.ts parseJson
相关 artifact iteration：case-b-run1 attempt1（首个决策，尚未产生 iteration 即 blocked）
页面当时状态：登录页（setup 刚导航）
模型决定：先填用户名，再填密码，拼成两个 JSON 一起返回
MCP 实际结果：未执行任何 MCP 调用（actionCount=0）
最终影响：整个 Case 在首个决策即 blocked
是否稳定复现：概念上稳定（同 prompt/温度 0 下模型倾向逐操作输出）；本轮已做最小解析修复
```

### P3：文件用例加载器丢弃 `requiredOperations`
```text
现象：case-b.yaml 声明了 6 个 requiredOperations，artifact.testCase.requiredOperations 为 []
发生位置：webui-agent/src/cli.ts normalizeCase
相关 artifact iteration：case-b-run1 attempt2
页面当时状态：不适用
模型决定：it1 fill_form 任意填 completes=["login_submit"]，无契约约束
MCP 实际结果：操作被执行，但 requiredOperations 未参与
最终影响：文件用例的 requiredOperations 契约失效，模型无 pending 列表可依
是否稳定复现：是（用例加载必现）；本轮已做字段透传修复
```

### P4：模型把“打开上传对话框”误判为 `upload_dataset` 完成（过早完成）
```text
现象：it3 仅点击「上传数据集」按钮，就让 completes=["upload_dataset"]
发生位置：案例决策（MiniMax CaseAgent），影响 Case Runner 的 completedOperationIds
相关 artifact iteration：case-b-run1 attempt3 it3、it4、it5
页面当时状态：数据集页，刚弹出「上传数据集」对话框，尚未选择文件
模型决定：click 上传按钮即视为 upload_dataset 完成
MCP 实际结果：click 成功返回；未发生上传
最终影响：后续真实 upload_file 因“ID 已完成”被 contract correction 拒绝，业务链路死锁
是否稳定复现：本轮稳定出现（attempt3）
```

### P5：模型把 `create_project` 完成 ID 挂到一次错误点击上
```text
现象：it7 click（uid 4_8，且上传并未成功）却 completes=["create_project"]
发生位置：同上
相关 artifact iteration：case-b-run1 attempt3 it7
页面当时状态：仍在上传对话框 / 数据页面，项目并未创建
模型决定：认为该点击完成了 create_project
MCP 实际结果：click 成功返回，但业务上未创建任何项目
最终影响：契约状态被污染，后续 completes=[] 又被连续拒绝
是否稳定复现：本轮出现一次
```

### P6：相同 `upload_file` 重复下发
```text
现象：it4 与 it5 参数完全一致（uid 4_3，filePath=...sensor_sample.csv）
发生位置：案例决策；Case Runner 的 duplicate 抑制逻辑
相关 artifact iteration：case-b-run1 attempt3 it4/it5
页面当时状态：上传对话框打开
模型决定：连续两次请求同一个上传
MCP 实际结果：两次均未执行（先被 contract correction 拦截），无法观察 duplicate 抑制
最终影响：浪费模型轮次；未能验证“执行级重复抑制”是否生效
是否稳定复现：本轮出现一次
```

### P7：`upload_file` 参数名与固定版本 schema 不一致
```text
现象：模型下发 {"uid": "...","filePath":"..."}，而 1.7.0 schema 要求 filePaths（数组）
发生位置：模型参数构造（MCP schema 已随 capabilities 提供给模型）
相关 artifact iteration：case-b-run1 attempt3 it4/it5
页面当时状态：上传对话框打开
模型决定：用单数 filePath
MCP 实际结果：该调用被 contract 拦截，未真正打到 MCP，故无 MCP 返回
最终影响：即便绕过契约，该参数名大概率也会被 MCP 判为非法（待确认）
是否稳定复现：本轮出现两次（相同错误）
```

### P8：observe 反复无变化即累积 noProgress，并触发 blocked
```text
现象：attempt2 填表后连续 8 次 observe，每次 checkpoint（页面无变化），最终 maxNoProgress blocked
发生位置：webui-agent/src/case-runner.ts + observation-scheduler.ts
相关 artifact iteration：case-b-run1 attempt2 it2-it10
页面当时状态：登录页未提交（模型只填表未点击提交），页面自然不变
模型决定：始终 observe，等待登录跳转
MCP 实际结果：captureShot 每轮返回相同 DOM，调度器 checkpoint
最终影响：Agent 未意识到“还差一个 click”，进入观察死循环到 blocked
是否稳定复现：attempt2 稳定；attempt3 也多次 observe
```

### P9：模型在逼近硬超时时主动判 failed
```text
现象：it14 模型返回 kind=failed，理由为“在允许窗口内未完成描述性统计”，elapsed≈598s
发生位置：案例决策
相关 artifact iteration：case-b-run1 attempt3 it14
页面当时状态：数据集页/工作区未到达
模型决定：放弃并判 failed
MCP 实际结果：无操作
最终影响：结果记录为 failed 而非 timeout；行为边界接近但未触发 runner 超时
是否稳定复现：本轮一次
```

### P10：MCP stderr 提示文件写入工具被限制到临时目录
```text
现象：The connecting client did not negotiate the MCP roots capability.
      File-writing tools will be restricted to the OS temp directory.
发生位置：webui-agent/src/mcp-adapter.ts 连接初始化（未声明 roots 能力）
相关 artifact iteration：mcp-stderr.log（每次会话均出现）
页面当时状态：不适用
模型决定：不适用
MCP 实际结果：提示级日志，未观察到对 navigate/snapshot 的直接影响
最终影响：可能影响未来需要写文件的 MCP 工具（如快照落盘）；本轮未证实影响业务
是否稳定复现：是（每次连接重复出现）
```

### P11：MCP 固定版本会持续提示可升级到 1.9.0
```text
现象：stderr 每次都打印 Update available: 1.7.0 -> 1.9.0
发生位置：chrome-devtools-mcp 自身
相关 artifact iteration：mcp-stderr.log
最终影响：仅日志噪音；升级到 1.9.0 会触发 P1
是否稳定复现：是
```

### P12：模型返回的 JSON 外可能附加说明/多对象（解析鲁棒性）
```text
现象：除 attempt1 的双对象外，现有测试已要求“JSON 周围有注释也能解析”
发生位置：minimax-provider parseJson
相关 artifact iteration：case-b-run1 attempt1；test/minimax-provider.test.ts
最终影响：本轮用“取第一个完整对象”覆盖；多操作是否应合并执行仍未定论
是否稳定复现：概念上稳定
```

---

## 七、本轮结束时的状态（观察，不含方案）

- reset 已可用且幂等；MCP 已固定 1.7.0；现有 typecheck/tests/build 全绿。
- Case A 已跑通并保留 artifact，未暴露问题。
- Case B 完整链路运行 3 次均未通过（blocked / blocked / failed），核心卡点集中在
  **模型对 `completes` 的粒度判断**（P4/P5）与 **observe 死循环**（P8），
  以及一个已修的加载器契约丢失（P3）。
- Case B run2 因用户判断“完整链路跑不过”被中止，未取得 reset 前后对比证据。
- 所有原始 artifact、MCP 日志、demo 日志、git diff 均已保留在本目录，供下一轮决定改进方向。
