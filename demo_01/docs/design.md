# 设计文档：Data-Algorithm Studio

> 流程阶段②产出。记录技术选型、模块划分、数据模型、血缘引擎与权限设计。

## 1. 技术选型

| 层 | 技术 | 说明 |
|----|------|------|
| 后端 | Python 3.11 + FastAPI + uvicorn | 自动 OpenAPI 文档，AI/数据生态 |
| 数据 | pandas + pyarrow + numpy | CSV/Parquet 解析与算法计算 |
| 存储 | SQLite + 本地文件目录 | 元数据入库，原始/派生文件落盘 |
| 认证 | 标准库 pbkdf2 + 随机会话 token | 无 bcrypt/JWT 额外依赖，登出即删会话 |
| 前端 | React 18 + TS + Vite + Tailwind v3 + Shadcn UI | 遵循共享前端层与 Notion 式设计 Token |
| 路由 | react-router-dom | 多页面应用 |

选型结论与 skill 约束一致：B/S 网站后端 Python(FastAPI)，前端复用共享层。

## 2. 目录结构

```
demo_01/
├── docs/                          需求/设计/API/测试/运行手册
├── backend/
│   ├── main.py                    应用入口、CORS、路由挂载
│   ├── config.py                  路径与常量、STUDIO_DATA_DIR 覆盖
│   ├── db.py                      SQLite 连接、建表、种子管理员
│   ├── security.py                密码哈希、会话 token
│   ├── deps.py                    当前用户/管理员依赖
│   ├── models/schemas.py          请求体模型
│   ├── routers/                   auth/admin/datasets/projects/lineage
│   ├── services/                  user/dataset/project/algorithm/lineage/storage
│   └── tests/                     pytest（纯逻辑）
└── frontend/
    ├── src/lib/                   api.ts（唯一 fetch 出口）/auth.tsx/utils.ts
    ├── src/components/            ui/（Shadcn）+ Toast/EmptyState/LineageTree 等
    └── src/pages/                 登录/注册/数据集/项目/工作区/公开/账号/管理
```

**分层原则**：`routers/` 只做请求解析与响应；业务逻辑在 `services/`，不依赖 FastAPI，可独立 pytest。

## 3. 数据模型（SQLite）

| 表 | 关键字段 | 说明 |
|----|---------|------|
| users | id, username(unique), password_hash, salt, role, created_at | role ∈ {user, admin} |
| sessions | token(PK), user_id, created_at, expires_at | 支持登出 |
| datasets | id, owner_id, name, filename, storage_path, format, row_count, col_count, time_column, columns_json, size_bytes | 时序数据元信息 |
| projects | id, owner_id, name, description, dataset_id, is_public, created_at, updated_at | 私有/公开 |
| lineage_nodes | id, project_id, parent_id, title, node_type, data_path, attributes_json, source_run_id | node_type ∈ {root, result} |
| algorithm_runs | id, project_id, input_node_id, algorithm, params_json, status, result_json, result_node_id, created_by, reviewed_by, reviewed_at | status ∈ {pending, approved, rejected} |

外键开启；删除项目级联删除节点与运行记录。

## 4. 血缘引擎

- 项目创建并绑定数据集时，生成唯一 **root 节点**：`data_path` 指向数据集文件，`attributes` 记录 schema/行列数/预览。
- 在节点上执行算法 → 生成 `pending` 运行：
  - 统计类只产出 `summary`，`derived_path=null`；
  - 预测类把派生 DataFrame 写为带时间戳的 parquet，`derived_path` 指向它。
- 审核 **approve** → 创建 `result` 子节点：
  - `data_path` = 派生文件（预测类）或沿用父节点数据（统计类）；
  - `attributes` = 算法产物（summary、派生列、来源运行）。
  - 可在该子节点上继续执行，形成单根血缘树。
- 审核 **reject** → 不落节点，运行标记为 rejected。
- 已 approve 的运行不可删除（已沉淀为节点）。

## 5. 算法

`services/algorithm_service.py` 注册表（纯函数）：

| key | 分类 | 输出 |
|-----|------|------|
| describe | statistics | 每位号 count/mean/std/min/max/缺失率 |
| corr | statistics | 皮尔逊相关系数矩阵 |
| trend | statistics | 每位号线性拟合斜率/截距/R²/方向 |
| moving_average | prediction | 派生 `<列>_ma{w}`，滚动窗口平滑 |
| linear_forecast | prediction | 线性趋势外推，追加未来 horizon 行 |

## 6. 权限模型

| 资源 | 规则 |
|------|------|
| 数据集 | 仅所有者（按用户隔离） |
| 项目可见 | 所有者 / 管理员 / is_public |
| 项目编辑（改名/删除/发布/执行/审核） | 所有者 / 管理员 |
| 克隆 | 登录用户可克隆公开项目或自己的项目 |

## 7. API 概览

见 [API 文档](api.md)。统一前缀 `/api`，FastAPI 自动生成 `/docs` 与 `/redoc`。

## 8. 横切规则检查

- **运行安全**：算法同步即时完成，无长任务/批处理，不涉及丢数据的运行安全场景。
- **LLM 集成**：无 LLM 调用，不适用。
- **测试**：核心逻辑（算法/数据集/血缘）用 pytest 覆盖四类场景，临时目录隔离。
