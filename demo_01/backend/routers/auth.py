"""认证路由：注册、登录、登出、当前用户、修改密码。"""

from fastapi import APIRouter, Depends, Header, HTTPException, status

from deps import get_current_user
from models.schemas import ChangePasswordRequest, LoginRequest, RegisterRequest
from services import user_service

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/register")
async def register(payload: RegisterRequest):
    """注册并自动登录，直接返回会话 token。"""
    try:
        user = user_service.create_user(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    token = user_service.create_session(user["id"])
    return {"token": token, "user": user}


@router.post("/login")
async def login(payload: LoginRequest):
    user = user_service.authenticate(payload.username, payload.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    token = user_service.create_session(user["id"])
    return {"token": token, "user": user}


@router.post("/logout")
async def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        user_service.delete_session(authorization[len("Bearer "):])
    return {"success": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest, user: dict = Depends(get_current_user)
):
    try:
        user_service.change_password(user["id"], payload.old_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return {"success": True}
