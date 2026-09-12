"""血缘路由：算法清单、节点、运行与审核。"""

from fastapi import APIRouter, Depends, HTTPException, status

from config import DEFAULT_PREVIEW_ROWS
from deps import get_current_user
from models.schemas import ReviewRequest, RunRequest
from services import algorithm_service, lineage_service, project_service

router = APIRouter(tags=["血缘"])


def _visible_project(project_id: str, user: dict) -> dict:
    project = project_service.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    if not project_service.can_view(project, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权访问该项目")
    return project


def _editable_project(project_id: str, user: dict) -> dict:
    project = project_service.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "项目不存在")
    if not project_service.can_edit(project, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权操作该项目")
    return project


@router.get("/algorithms")
async def list_algorithms(_: dict = Depends(get_current_user)):
    return algorithm_service.list_algorithms()


@router.get("/projects/{project_id}/nodes")
async def list_nodes(project_id: str, user: dict = Depends(get_current_user)):
    _visible_project(project_id, user)
    return lineage_service.list_nodes(project_id)


@router.get("/projects/{project_id}/nodes/{node_id}")
async def get_node(project_id: str, node_id: str, user: dict = Depends(get_current_user)):
    _visible_project(project_id, user)
    node = lineage_service.get_node(node_id, project_id)
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "节点不存在")
    return node


@router.get("/projects/{project_id}/nodes/{node_id}/preview")
async def preview_node(
    project_id: str,
    node_id: str,
    rows: int = DEFAULT_PREVIEW_ROWS,
    user: dict = Depends(get_current_user),
):
    _visible_project(project_id, user)
    preview = lineage_service.node_preview(node_id, rows)
    if preview is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "节点数据不可用")
    return preview


@router.post("/projects/{project_id}/nodes/{node_id}/run")
async def run_algorithm(
    project_id: str,
    node_id: str,
    payload: RunRequest,
    user: dict = Depends(get_current_user),
):
    _editable_project(project_id, user)
    try:
        return lineage_service.run_algorithm(
            project_id, node_id, payload.algorithm, payload.params, user["id"]
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/projects/{project_id}/runs")
async def list_runs(project_id: str, user: dict = Depends(get_current_user)):
    _visible_project(project_id, user)
    return lineage_service.list_runs(project_id)


@router.get("/projects/{project_id}/runs/{run_id}")
async def get_run(project_id: str, run_id: str, user: dict = Depends(get_current_user)):
    _visible_project(project_id, user)
    run = lineage_service.get_run(run_id, project_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "运行记录不存在")
    return run


@router.post("/projects/{project_id}/runs/{run_id}/review")
async def review_run(
    project_id: str,
    run_id: str,
    payload: ReviewRequest,
    user: dict = Depends(get_current_user),
):
    _editable_project(project_id, user)
    try:
        run = lineage_service.review_run(project_id, run_id, payload.decision, user["id"])
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "运行记录不存在")
    return run


@router.delete("/projects/{project_id}/runs/{run_id}")
async def delete_run(project_id: str, run_id: str, user: dict = Depends(get_current_user)):
    _editable_project(project_id, user)
    try:
        deleted = lineage_service.delete_run(project_id, run_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "运行记录不存在")
    return {"success": True}
