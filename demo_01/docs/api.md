# API 文档：Data-Algorithm Studio

> 与源码同步。所有接口前缀 `/api`，鉴权用 `Authorization: Bearer <token>`。
> 运行后访问 `http://localhost:8000/docs` 查看可交互的 Swagger。

## 通用

- 请求/响应体为 JSON（数据集上传为 `multipart/form-data`）。
- 错误统一返回 `{ "detail": "错误信息" }`，HTTP 状态码语义化。
- 401 会话失效；403 无权限；404 资源不存在；400 参数/业务错误。

## 认证 `/api/auth`

| 方法 | 路径 | 鉴权 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | /register | 否 | {username, password} | {token, user} |
| POST | /login | 否 | {username, password} | {token, user} |
| POST | /logout | 否 | - | {success} |
| GET | /me | 是 | - | user |
| POST | /change-password | 是 | {old_password, new_password} | {success} |

## 管理 `/api/admin`（仅管理员）

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| GET | /users | - | user[] |
| POST | /users | {username, password, role} | user |
| POST | /users/{id}/reset-password | {new_password} | {success} |

## 数据集 `/api/datasets`

| 方法 | 路径 | 请求/参数 | 响应 |
|------|------|-----------|------|
| GET | "" | - | dataset[] |
| POST | "" | multipart: file, name | dataset |
| GET | /{id} | - | dataset |
| GET | /{id}/preview | ?rows=20 | {columns, rows, summary} |
| DELETE | /{id} | - | {success}；若被项目引用返回 409 |

## 项目 `/api/projects`

| 方法 | 路径 | 请求/参数 | 响应 |
|------|------|-----------|------|
| GET | "" | ?scope=mine\|public | project[] |
| POST | "" | {name, description, dataset_id} | project |
| GET | /{id} | - | project |
| PATCH | /{id} | {name?, description?} | project |
| DELETE | /{id} | - | {success} |
| POST | /{id}/publish | {is_public} | project |
| POST | /{id}/clone | - | project |

## 血缘 `/api`

| 方法 | 路径 | 请求/参数 | 响应 |
|------|------|-----------|------|
| GET | /algorithms | - | algorithm[] |
| GET | /projects/{pid}/nodes | - | node[]（扁平，含 parent_id） |
| GET | /projects/{pid}/nodes/{nid} | - | node |
| GET | /projects/{pid}/nodes/{nid}/preview | ?rows=20 | {columns, rows, summary} |
| POST | /projects/{pid}/nodes/{nid}/run | {algorithm, params} | run |
| GET | /projects/{pid}/runs | - | run[] |
| GET | /projects/{pid}/runs/{rid} | - | run |
| POST | /projects/{pid}/runs/{rid}/review | {decision: approve\|reject} | run |
| DELETE | /projects/{pid}/runs/{rid} | - | {success} |

## 数据结构

```ts
user     = { id, username, role, created_at }
dataset  = { id, name, filename, format, row_count, col_count, time_column, columns[], size_bytes, created_at }
project  = { id, owner_id, owner_name, name, description, dataset_id, dataset_name, is_public, node_count, created_at, updated_at }
node     = { id, project_id, parent_id, title, node_type, data_path, attributes, source_run_id, created_at }
run      = { id, project_id, input_node_id, algorithm, params, status, result, result_node_id, created_by, reviewed_by, reviewed_at, created_at }
preview  = { columns: [{name, dtype}], rows: object[], summary: [{name,count,missing_rate,mean,std,min,max}] }
algorithm= { key, name, category, description, params: [{name,label,type,default}] }
```
