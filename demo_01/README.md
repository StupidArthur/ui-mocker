# Data-Algorithm Studio

面向 AI UI 测试自动化的演示站：用户资产管理、时序数据集、算法执行、结果审核与血缘树、项目公开与克隆。

- 后端：Python 3.11 + FastAPI + SQLite + pandas
- 前端：React 18 + TypeScript + Vite + Tailwind v3 + Shadcn UI（Notion 式浅色简约）

## 快速开始

```bash
# 1. 后端
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
# 默认管理员 admin / admin123；接口文档 http://localhost:8000/docs

# 2. 前端（另开终端）
cd frontend
npm install
npm run dev
# 打开 http://localhost:5173
```

## 功能

- 注册 / 登录 / 登出 / 修改密码；管理员创建账号、重置密码
- 数据集：CSV / Parquet 上传、预览、统计摘要、删除
- 项目：绑定数据集、私有/公开、克隆
- 工作区：血缘树（单根）、在节点执行统计/预测算法、结果展示与审核、通过后沉淀为新节点
- 算法：描述性统计、相关系数、趋势分析、移动平均、线性回归外推

## 文档

| 文档 | 说明 |
|------|------|
| [需求文档](docs/requirements.md) | 功能需求与边界 |
| [设计文档](docs/design.md) | 技术选型、模块、数据模型、血缘引擎 |
| [API 文档](docs/api.md) | 接口清单与数据结构 |
| [测试记录](docs/testing.md) | 单元测试与端到端结果 |
| [运行手册](docs/runbook.md) | 部署、数据目录、演示链路 |
