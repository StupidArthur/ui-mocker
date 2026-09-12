"""FastAPI 应用入口。

挂载各业务路由于 /api 前缀下，启动时初始化数据库并创建默认管理员。
自动生成 OpenAPI 文档：/docs（Swagger）与 /redoc。
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from db import init_db
from routers import admin, auth, datasets, lineage, projects

logger = logging.getLogger("studio")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Data-Algorithm Studio API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(datasets.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(lineage.router, prefix="/api")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """兜底异常处理：避免 500 只有一句 Internal Server Error。

    记录堆栈便于排查，同时返回可读的中文错误信息，前端能直接 Toast 展示。
    """
    logger.exception("未处理异常：%s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"服务器内部错误：{exc}"})


@app.get("/api/health", tags=["系统"])
async def health():
    return {"status": "ok"}
