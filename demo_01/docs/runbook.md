# 部署与运行手册：Data-Algorithm Studio

## 环境要求

- Python 3.11+
- Node.js 18+（实测 24）
- 无需数据库服务，SQLite 与文件存储自动创建于 `backend/data/`

## 后端

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

- API 根：`http://localhost:8000/api`
- Swagger：`http://localhost:8000/docs`，ReDoc：`http://localhost:8000/redoc`
- 首次启动自动建表并创建默认管理员：**admin / admin123**

### 数据目录

| 路径 | 内容 |
|------|------|
| `backend/data/studio.db` | SQLite 元数据 |
| `backend/data/uploads/` | 上传的 csv/parquet |
| `backend/data/derived/` | 算法派生数据（带时间戳的 parquet） |

可用环境变量 `STUDIO_DATA_DIR` 覆盖数据目录（测试即用此隔离）。

## 前端

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173，/api 自动代理到 :8000
```

生产构建与本地预览：

```bash
npm run build        # 先 tsc --noEmit 再 vite build，产物在 dist/
npm run preview
```

## 生产部署（可选）

```bash
pip install gunicorn
cd backend
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

前端 `dist/` 交给 Nginx 等静态服务器，并将 `/api` 反向代理到后端。
生产环境请把 `main.py` 中 CORS 的 `allow_origins` 收敛为前端域名。

## 测试

```bash
cd backend
python -m pytest -v
```

## 演示主链路

1. 用 `admin/admin123` 登录，或注册新用户。
2. 数据集页上传 CSV（行=时间，列=位号）。
3. 我的项目页新建项目并绑定数据集 → 进入工作区，看到血缘根节点。
4. 在根节点执行「描述性统计」→ 查看结果 → 通过（沉淀为子节点）。
5. 在子节点执行「线性回归外推」→ 查看结果 → 通过。
6. 项目「公开」；换另一账号登录，在公开项目页「克隆」。
7. 管理员登录管理后台，创建账号或重置密码。
