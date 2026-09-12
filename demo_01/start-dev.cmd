@echo off
REM 启动后端(8000)与前端(5173)，用于本地演示与 UI 冒烟测试
start "studio-backend"  cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --port 8000"
start "studio-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo 后端文档: http://localhost:8000/docs
echo 前端入口: http://localhost:5173
echo 管理员:   admin / admin123
