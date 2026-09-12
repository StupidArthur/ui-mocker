# UI 冒烟测试用例（for-AI，优化版）

> 供 `web-ui-case-executor`（Chrome DevTools MCP）逐行执行的冒烟用例。
> 本版已根据两轮执行结果优化：核心元素使用 `data-testid` 定位，并修正了与实际行为不一致的步骤。

## 用例信息

| 项 | 值 |
|----|----|
| 用例名称 | Data-Algorithm Studio 冒烟测试 |
| 测试目标 | 验证「认证—数据集—项目—血缘算法—审核—公开—管理—改密—登出」主链路可用 |
| 测试环境 | 前端 http://localhost:5173 ；后端 http://localhost:8000 |
| 前置条件 | 后端与前端均已启动；数据库已预存管理员 |
| 预存管理员 | 用户名 `admin` / 密码 `admin123` |
| 测试数据 | `G:\cc_demos\ui_mocker\demo_01\backend\sample_data\sensor_sample.csv`（25 行 × 4 列） |
| 预计耗时 | 3–5 分钟 |
| 定位约定 | 优先 `data-testid`，输入框用 `id`，断言用文本 |

## 步骤

| # | 页面区域 | 操作行为 | 元素定位方式 | 预期结果 | 完成标准 |
|---|---------|---------|-------------|---------|---------|
| 1 | 登录页 | 打开 `http://localhost:5173/login` | URL 导航 | 显示登录表单 | 标题「Data-Algorithm Studio」存在，且存在 `#username`、`#password` |
| 2 | 登录页 | `#username` 填 `admin`，`#password` 填 `admin123` | id | 输入框回显 | 两输入框 value 分别等于 `admin`、`admin123` |
| 3 | 登录页 | 点击登录 | `[data-testid=login-submit]` | 跳转数据集页 | URL 为 `/datasets`，侧边栏出现「管理后台」 |
| 4 | 数据集页 | 点击「上传数据集」 | `[data-testid=upload-dataset]` | 弹出上传对话框 | 对话框标题「上传数据集」存在 |
| 5 | 上传对话框 | 选择 `sensor_sample.csv`，点击「上传」 | file input + `[data-testid=upload-submit]` | 上传成功 | 卡片出现且含「25 行 × 4 列」；`#ds-name` 自动回填为 `sensor_sample` |
| 6 | 数据集页 | 点击 `sensor_sample` 卡片 | 文本匹配 | 打开预览对话框 | 出现「数据预览」与「统计摘要」；数值列统一 4 位小数（如 `77.0000`） |
| 7 | 预览对话框 | 点击「删除数据集」→ 确认框「取消」 | `[data-testid=dataset-delete]` + 文本匹配 | 数据集保留 | 确认框出现后取消，数据集卡片仍存在 |
| 8 | 侧边栏 | 点击「我的项目」 | 文本匹配 | 进入项目页 | URL 为 `/projects`，存在 `[data-testid=create-project]` |
| 9 | 项目页 | 点击「新建项目」，`#p-name` 填 `冒烟项目`，`#p-dataset` 选 `sensor_sample`，点击「创建」 | `[data-testid=create-project]` + id + `[data-testid=project-submit]` | 进入工作区 | URL 匹配 `/projects/<id>`，血缘树出现「数据集：sensor_sample」 |
| 10 | 工作区左栏 | 点击「在该节点执行算法」 | `[data-testid=run-algorithm]` | 弹出执行对话框 | 标题「执行算法」与 `#algo` 存在 |
| 11 | 执行对话框 | 保持「描述性统计」，点击「执行」 | `[data-testid=run-submit]` | 生成待审核结果，详情自动打开 | 弹窗标题「描述性统计 · 结果详情」；关闭后列表状态徽标为「待审核」 |
| 12 | 结果列表 | 点击该条「通过」 | `[data-testid=run-approve]` | 审核通过并沉淀节点 | 徽标变「已通过」，血缘树节点数 +1 |
| 13 | 工作区左栏 | 选中子节点「描述性统计」，点击「在该节点执行算法」 | `[data-testid=lineage-node]` + `[data-testid=run-algorithm]` | 弹出执行对话框 | 标题「执行算法」出现 |
| 14 | 执行对话框 | `#algo` 选 `linear_forecast`（value + change），`#param-horizon` 填 `3`，点击「执行」 | id + `[data-testid=run-submit]` | 生成待审核结果 | 弹窗标题「线性回归外推 · 结果详情」，含「派生数据预览（共 28 行）」 |
| 15 | （合并入 14） | — | — | 详情已自动打开 | 无需再次点击「查看结果」 |
| 16 | 结果详情 | 点击「通过并沉淀为节点」，关闭弹窗 | `[data-testid=run-approve-dialog]` | 审核通过 | 血缘树 3 节点（数据集 → 描述性统计 → 线性回归外推） |
| 17 | 顶部栏 | 点击「公开」 | `[data-testid=project-publish]` | 项目公开 | 顶部徽标变「已公开」 |
| 18 | 侧边栏 | 点击「管理后台」 | 文本匹配 | 进入管理页 | 存在 `[data-testid=create-account]` 与用户表格 |
| 19 | 管理后台 | 点击「创建账号」，`#u-name`=`smoke_user`、`#u-pass`=`Passw0rd`，创建 | `[data-testid=create-account]` + id + `[data-testid=account-submit]` | 创建成功 | 表格出现 `smoke_user` 行 |
| 20 | 管理后台 | smoke_user 行「重置密码」，`#reset-pass`=`Reset1234`，确认 | 行内 `[data-testid=reset-password]` + `#reset-pass` + `[data-testid=reset-submit]` | 重置成功 | 出现提示「密码已重置」 |
| 21 | 侧边栏 | 点击登出 | `[data-testid=logout]` | 返回登录页 | URL 为 `/login`，登录表单存在 |

## 附录 A：元素定位表（data-testid）

| 元素 | 定位 |
|------|------|
| 登录提交 | `[data-testid=login-submit]` |
| 上传数据集/确认 | `[data-testid=upload-dataset]` / `[data-testid=upload-submit]` |
| 数据集删除 | `[data-testid=dataset-delete]` |
| 新建项目/确认 | `[data-testid=create-project]` / `[data-testid=project-submit]` |
| 执行算法/确认 | `[data-testid=run-algorithm]` / `[data-testid=run-submit]` |
| 结果通过/驳回（列表） | `[data-testid=run-approve]` / `[data-testid=run-reject]` |
| 结果通过/驳回（弹窗） | `[data-testid=run-approve-dialog]` / `[data-testid=run-reject-dialog]` |
| 血缘树节点 | `[data-testid=lineage-node]`（`data-node-title` 为节点名） |
| 公开项目 | `[data-testid=project-publish]` |
| 创建账号/确认 | `[data-testid=create-account]` / `[data-testid=account-submit]` |
| 重置密码/确认 | `[data-testid=reset-password]` / `[data-testid=reset-submit]` |
| 登出 | `[data-testid=logout]` |
| 输入框 id | `#username` `#password` `#ds-name` `#p-name` `#p-dataset` `#algo` `#param-window` `#param-horizon` `#u-name` `#u-pass` `#u-role` `#reset-pass` `#old` `#new` `#confirm-new` |

## 附录 B：执行注意事项

- 数据集上传为主动等待场景，若出现「上传中…」，最长等待 30 秒。
- 执行算法后结果详情弹窗会自动打开；断言列表状态前先关闭弹窗。
- 原生 `<select>`（`#algo`、`#p-dataset`、`#u-role`）建议用 `value` 赋值并派发 `change` 事件，避免直接交互超时。
- 审核会改变血缘树，步骤 12/16 后需重新查询节点。
- 用例可重复执行；`smoke_user` 重复会报「用户名已存在」，按失败记录即可（或改用带时间戳的用户名）。
