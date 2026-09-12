"""管理路由：用户列表、创建账号、重置密码。仅管理员可访问。"""

from fastapi import APIRouter, Depends, HTTPException, status

from deps import require_admin
from models.schemas import CreateUserRequest, ResetPasswordRequest
from services import user_service

router = APIRouter(prefix="/admin", tags=["管理"])


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    return user_service.list_users()


@router.post("/users")
async def create_user(payload: CreateUserRequest, _: dict = Depends(require_admin)):
    try:
        return user_service.create_user(payload.username, payload.password, payload.role)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str, payload: ResetPasswordRequest, _: dict = Depends(require_admin)
):
    if not user_service.reset_password(user_id, payload.new_password):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用户不存在")
    return {"success": True}
