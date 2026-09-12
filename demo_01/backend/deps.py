"""FastAPI 依赖：从请求头解析当前用户并做角色校验。

业务服务只接收已解析的用户 dict，不感知 HTTP 细节，
这样 services 层可脱离框架独立测试。
"""

from fastapi import Depends, Header, HTTPException, status

from services import user_service

BEARER_PREFIX = "Bearer "


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """从 Authorization: Bearer <token> 解析当前登录用户。"""
    if not authorization or not authorization.startswith(BEARER_PREFIX):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录或凭证缺失")
    token = authorization[len(BEARER_PREFIX):]
    user = user_service.get_user_by_token(token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "会话已失效，请重新登录")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """在登录基础上要求管理员角色。"""
    if user.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "需要管理员权限")
    return user
