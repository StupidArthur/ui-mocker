"""数据集服务测试：上传解析、预览、删除与错误处理。"""

import uuid

import pytest

from services import dataset_service, project_service, user_service

CSV_BYTES = (
    b"time,a,b,label\n"
    b"2024-01-01,1,5,x\n"
    b"2024-01-02,2,4,y\n"
    b"2024-01-03,3,3,z\n"
)


def make_user() -> dict:
    return user_service.create_user(f"data_{uuid.uuid4().hex[:8]}", "pass1234")


def test_create_and_preview_正常路径():
    user = make_user()
    dataset = dataset_service.create_dataset(user["id"], "示例", "sample.csv", CSV_BYTES)
    assert dataset["row_count"] == 3
    assert dataset["col_count"] == 4
    assert dataset["time_column"] == "time"
    assert [c["name"] for c in dataset["columns"]] == ["time", "a", "b", "label"]

    preview = dataset_service.preview_dataset(dataset["id"], 2)
    assert len(preview["rows"]) == 2
    assert {s["name"] for s in preview["summary"]} == {"a", "b"}
    a_stat = next(s for s in preview["summary"] if s["name"] == "a")
    assert a_stat["mean"] == 2.0


def test_create_非法格式():
    user = make_user()
    with pytest.raises(ValueError):
        dataset_service.create_dataset(user["id"], "bad", "bad.txt", b"hello")


def test_get_不存在的id():
    assert dataset_service.get_dataset("not-exist") is None
    assert dataset_service.preview_dataset("not-exist") is None


def test_list_and_delete():
    user = make_user()
    dataset = dataset_service.create_dataset(user["id"], "d", "d.csv", CSV_BYTES)
    assert any(d["id"] == dataset["id"] for d in dataset_service.list_datasets(user["id"]))
    assert dataset_service.delete_dataset(dataset["id"]) is True
    assert dataset_service.get_dataset(dataset["id"]) is None
    assert dataset_service.delete_dataset(dataset["id"]) is False


def test_空数据文件报错():
    user = make_user()
    with pytest.raises(ValueError):
        dataset_service.create_dataset(user["id"], "empty", "empty.csv", b"")


def test_数据集被项目引用时计数():
    user = make_user()
    dataset = dataset_service.create_dataset(user["id"], "d", "d.csv", CSV_BYTES)
    assert dataset_service.count_referencing_projects(dataset["id"]) == 0
    project_service.create_project(user["id"], "p", "", dataset["id"])
    assert dataset_service.count_referencing_projects(dataset["id"]) == 1
