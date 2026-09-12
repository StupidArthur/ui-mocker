"""血缘服务测试：根节点、算法运行、审核沉淀与删除约束。"""

import uuid

import pytest

from services import dataset_service, lineage_service, project_service, user_service

CSV_BYTES = (
    b"time,a,b\n"
    b"2024-01-01,1,5\n"
    b"2024-01-02,2,4\n"
    b"2024-01-03,3,3\n"
)


def setup_project():
    user = user_service.create_user(f"line_{uuid.uuid4().hex[:8]}", "pass1234")
    dataset = dataset_service.create_dataset(user["id"], "ds", "d.csv", CSV_BYTES)
    project = project_service.create_project(user["id"], "proj", "", dataset["id"])
    return user, dataset, project


def test_create_project_生成根节点():
    _, _, project = setup_project()
    nodes = lineage_service.list_nodes(project["id"])
    assert len(nodes) == 1
    assert nodes[0]["node_type"] == "root"
    assert nodes[0]["parent_id"] is None


def test_run_and_approve_沉淀子节点():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]

    run = lineage_service.run_algorithm(project["id"], root["id"], "describe", {}, user["id"])
    assert run["status"] == "pending"
    assert run["result"]["category"] == "statistics"

    reviewed = lineage_service.review_run(project["id"], run["id"], "approve", user["id"])
    assert reviewed["status"] == "approved"
    assert reviewed["result_node_id"]

    nodes = lineage_service.list_nodes(project["id"])
    assert len(nodes) == 2
    child = next(n for n in nodes if n["node_type"] == "result")
    assert child["parent_id"] == root["id"]
    assert child["attributes"]["algorithm"] == "describe"


def test_reject_不沉淀节点():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]
    run = lineage_service.run_algorithm(project["id"], root["id"], "corr", {}, user["id"])
    reviewed = lineage_service.review_run(project["id"], run["id"], "reject", user["id"])
    assert reviewed["status"] == "rejected"
    assert reviewed["result_node_id"] is None
    assert len(lineage_service.list_nodes(project["id"])) == 1
    assert lineage_service.delete_run(project["id"], run["id"]) is True


def test_预测算法产生派生数据并可继续执行():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]

    run = lineage_service.run_algorithm(
        project["id"], root["id"], "linear_forecast", {"horizon": 2}, user["id"]
    )
    assert run["result"]["derived_path"]
    assert run["result"]["row_count"] == 5

    approved = lineage_service.review_run(project["id"], run["id"], "approve", user["id"])
    child = lineage_service.get_node(approved["result_node_id"])
    assert child["data_path"].endswith(".parquet")
    assert child["attributes"]["derived_columns"] == ["a", "b"]

    second = lineage_service.run_algorithm(
        project["id"], child["id"], "moving_average", {"window": 2}, user["id"]
    )
    lineage_service.review_run(project["id"], second["id"], "approve", user["id"])
    assert len(lineage_service.list_nodes(project["id"])) == 3


def test_重复审核报错():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]
    run = lineage_service.run_algorithm(project["id"], root["id"], "trend", {}, user["id"])
    lineage_service.review_run(project["id"], run["id"], "approve", user["id"])
    with pytest.raises(ValueError):
        lineage_service.review_run(project["id"], run["id"], "approve", user["id"])


def test_已通过结果不可删除():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]
    run = lineage_service.run_algorithm(project["id"], root["id"], "describe", {}, user["id"])
    lineage_service.review_run(project["id"], run["id"], "approve", user["id"])
    with pytest.raises(ValueError):
        lineage_service.delete_run(project["id"], run["id"])


def test_未知算法报错():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]
    with pytest.raises(ValueError):
        lineage_service.run_algorithm(project["id"], root["id"], "nope", {}, user["id"])


def test_克隆项目_独立副本():
    user, _, project = setup_project()
    root = lineage_service.list_nodes(project["id"])[0]
    run = lineage_service.run_algorithm(project["id"], root["id"], "describe", {}, user["id"])
    lineage_service.review_run(project["id"], run["id"], "approve", user["id"])

    other = user_service.create_user(f"clone_{uuid.uuid4().hex[:8]}", "pass1234")
    clone = project_service.clone_project(project_service.get_project(project["id"]), other["id"])
    assert clone["owner_id"] == other["id"]
    assert clone["dataset_id"] != project["dataset_id"]
    assert clone["node_count"] == 2
    assert len(lineage_service.list_nodes(clone["id"])) == 2
