"""数据集路由：上传、列表、详情、预览、删除。

数据集仅所有者可访问（管理员通过管理功能不直接操作他人数据）。
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from config import DEFAULT_PREVIEW_ROWS
from deps import get_current_user
from services import dataset_service

router = APIRouter(prefix="/datasets", tags=["数据集"])


def _require_owned(dataset_id: str, user: dict) -> dict:
    dataset = dataset_service.get_dataset(dataset_id)
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "数据集不存在")
    if dataset["owner_id"] != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "无权访问该数据集")
    return dataset


@router.get("")
async def list_datasets(user: dict = Depends(get_current_user)):
    return dataset_service.list_datasets(user["id"])


@router.post("")
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "上传文件为空")
    try:
        return dataset_service.create_dataset(
            user["id"], name or file.filename, file.filename, content
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str, user: dict = Depends(get_current_user)):
    return _require_owned(dataset_id, user)


@router.get("/{dataset_id}/preview")
async def preview_dataset(
    dataset_id: str, rows: int = DEFAULT_PREVIEW_ROWS, user: dict = Depends(get_current_user)
):
    _require_owned(dataset_id, user)
    preview = dataset_service.preview_dataset(dataset_id, rows)
    if preview is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "预览失败")
    return preview


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: str, user: dict = Depends(get_current_user)):
    _require_owned(dataset_id, user)
    references = dataset_service.count_referencing_projects(dataset_id)
    if references > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"该数据集已被 {references} 个项目引用，请先删除相关项目后再删除数据集",
        )
    if not dataset_service.delete_dataset(dataset_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "数据集不存在")
    return {"success": True}
