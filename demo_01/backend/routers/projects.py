"""项目路由：增删改查、公开切换、克隆。"""

from fastapi import APIRouter, Depends, HTTPException, status

from deps import get_current_user
from models.schemas import ProjectCreateRequest, ProjectUpdateRequest, PublishRequest
from services import project_service

router = APIRouter(prefix="/projects", tags=["项目"])


def _get_visible(project_id: str, user: dict) -> dict:
    project = project_service.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    if not project_service.can_view(project, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权访问该项目")
    return project


def _get_editable(project_id: str, user: dict) -> dict:
    project = project_service.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    if not project_service.can_edit(project, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权修改该项目")
    return project


@router.get("")
async def list_projects(scope: str = "mine", user: dict = Depends(get_current_user)):
    return project_service.list_projects(user, scope)


@router.post("")
async def create_project(
    payload: ProjectCreateRequest, user: dict = Depends(get_current_user)
):
    try:
        return project_service.create_project(
            user["id"], payload.name, payload.description, payload.dataset_id
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    return _get_visible(project_id, user)


@router.patch("/{project_id}")
async def update_project(
    project_id: str, payload: ProjectUpdateRequest, user: dict = Depends(get_current_user)
):
    _get_editable(project_id, user)
    return project_service.update_project(project_id, payload.name, payload.description)


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    _get_editable(project_id, user)
    project_service.delete_project(project_id)
    return {"success": True}


@router.post("/{project_id}/publish")
async def publish_project(
    project_id: str, payload: PublishRequest, user: dict = Depends(get_current_user)
):
    _get_editable(project_id, user)
    return project_service.publish_project(project_id, payload.is_public)


@router.post("/{project_id}/clone")
async def clone_project(project_id: str, user: dict = Depends(get_current_user)):
    project = _get_visible(project_id, user)
    if not project["is_public"] and project["owner_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "仅可克隆已公开项目")
    return project_service.clone_project(project, user["id"])
