"""血缘服务：节点、算法执行与审核。

血缘语义：
- 项目绑定数据集时创建 root 节点，data_path 指向数据集文件，attributes 记录 schema/摘要。
- 在节点上执行算法生成一次 pending 运行；只有审核通过才沉淀为 result 子节点，
  其 data_path 指向派生数据（预测类）或沿用父节点数据（统计类），attributes 记录算法产物。
- 因此可在任意已通过节点上继续执行，形成单根血缘树。
"""

import json
import uuid
from datetime import datetime, timezone

from config import DEFAULT_PREVIEW_ROWS
from db import db
from services import algorithm_service, dataset_service, storage


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def node_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "parent_id": row["parent_id"],
        "title": row["title"],
        "node_type": row["node_type"],
        "data_path": row["data_path"],
        "attributes": json.loads(row["attributes_json"]),
        "source_run_id": row["source_run_id"],
        "created_at": row["created_at"],
    }


def run_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "input_node_id": row["input_node_id"],
        "algorithm": row["algorithm"],
        "params": json.loads(row["params_json"]),
        "status": row["status"],
        "result": json.loads(row["result_json"]),
        "result_node_id": row["result_node_id"],
        "created_by": row["created_by"],
        "reviewed_by": row["reviewed_by"],
        "reviewed_at": row["reviewed_at"],
        "created_at": row["created_at"],
    }


def create_root_node(project_id: str, dataset_id: str, dataset_name: str) -> dict:
    """项目绑定数据集时创建根节点。"""
    storage_path = dataset_service.get_storage_path(dataset_id)
    attributes = {
        "kind": "dataset",
        "dataset_id": dataset_id,
        "dataset_name": dataset_name,
        "schema": None,
    }
    if storage_path:
        try:
            df = dataset_service.load_dataframe_auto(storage_path)
            attributes["schema"] = dataset_service.columns_meta(df)
            attributes["row_count"] = int(df.shape[0])
            attributes["preview"] = dataset_service.preview_dataframe(df, DEFAULT_PREVIEW_ROWS)
        except Exception as exc:  # 文件异常时仍允许建节点，只是缺少预览
            attributes["error"] = str(exc)
    node_id = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO lineage_nodes (id, project_id, parent_id, title, node_type,"
            " data_path, attributes_json, source_run_id, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                node_id,
                project_id,
                None,
                f"数据集：{dataset_name}",
                "root",
                storage_path,
                json.dumps(attributes, ensure_ascii=False),
                None,
                _now(),
            ),
        )
    return get_node(node_id)


def get_node(node_id: str, project_id: str | None = None) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM lineage_nodes WHERE id = ?", (node_id,)).fetchone()
    if row is None:
        return None
    if project_id is not None and row["project_id"] != project_id:
        return None
    return node_to_dict(row)


def list_nodes(project_id: str) -> list[dict]:
    """返回项目的全部节点（扁平列表，前端据 parent_id 组树）。"""
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM lineage_nodes WHERE project_id = ? ORDER BY created_at ASC",
            (project_id,),
        ).fetchall()
    return [node_to_dict(r) for r in rows]


def node_preview(node_id: str, rows: int = DEFAULT_PREVIEW_ROWS) -> dict | None:
    """读取节点数据文件并生成预览。"""
    node = get_node(node_id)
    if node is None or not node["data_path"]:
        return None
    try:
        df = dataset_service.load_dataframe_auto(node["data_path"])
    except Exception:
        return None
    return dataset_service.preview_dataframe(df, rows)


def run_algorithm(
    project_id: str, node_id: str, algorithm: str, params: dict, user_id: str
) -> dict:
    """在指定节点上执行算法，生成一次待审核运行。"""
    node = get_node(node_id, project_id)
    if node is None:
        raise ValueError("节点不存在")
    if not node["data_path"]:
        raise ValueError("该节点没有可用数据")
    spec = algorithm_service.get_algorithm(algorithm)
    if spec is None:
        raise ValueError(f"未知算法：{algorithm}")

    try:
        df = dataset_service.load_dataframe_auto(node["data_path"])
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise ValueError(f"节点数据不可读，数据集可能已被删除：{exc}") from exc
    outcome = algorithm_service.run_algorithm(algorithm, params, df)

    derived_path = None
    preview_source = df
    if outcome["derived"] is not None:
        derived_path = str(storage.derived_parquet_path(project_id, algorithm))
        outcome["derived"].to_parquet(derived_path, index=False)
        preview_source = outcome["derived"]

    result_payload = {
        "algorithm": algorithm,
        "name": spec["name"],
        "category": spec["category"],
        "summary": outcome["summary"],
        "derived_columns": outcome["derived_columns"],
        "derived_path": derived_path,
        "row_count": int(len(preview_source)),
        "preview": dataset_service.preview_dataframe(preview_source, DEFAULT_PREVIEW_ROWS),
    }

    run_id = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO algorithm_runs (id, project_id, input_node_id, algorithm,"
            " params_json, status, result_json, created_by, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                run_id,
                project_id,
                node_id,
                algorithm,
                json.dumps(params, ensure_ascii=False),
                "pending",
                json.dumps(result_payload, ensure_ascii=False),
                user_id,
                _now(),
            ),
        )
    return get_run(run_id, project_id)


def get_run(run_id: str, project_id: str | None = None) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM algorithm_runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        return None
    if project_id is not None and row["project_id"] != project_id:
        return None
    return run_to_dict(row)


def list_runs(project_id: str) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM algorithm_runs WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
    return [run_to_dict(r) for r in rows]


def review_run(
    project_id: str, run_id: str, decision: str, reviewer_id: str
) -> dict | None:
    """审核算法结果。通过则沉淀为子节点，驳回则不落节点。"""
    run = get_run(run_id, project_id)
    if run is None:
        return None
    if run["status"] != "pending":
        raise ValueError("该结果已审核，不能重复操作")
    if decision not in ("approve", "reject"):
        raise ValueError("非法的审核结论")

    new_status = "approved" if decision == "approve" else "rejected"
    result_node_id = None
    if decision == "approve":
        input_node = get_node(run["input_node_id"], project_id)
        derived_path = run["result"].get("derived_path")
        data_path = derived_path or (input_node["data_path"] if input_node else None)
        attributes = {
            "kind": "algorithm",
            "algorithm": run["algorithm"],
            "name": run["result"].get("name"),
            "category": run["result"].get("category"),
            "summary": run["result"].get("summary"),
            "derived_columns": run["result"].get("derived_columns", []),
            "source_run_id": run_id,
        }
        result_node_id = uuid.uuid4().hex
        with db() as conn:
            conn.execute(
                "INSERT INTO lineage_nodes (id, project_id, parent_id, title, node_type,"
                " data_path, attributes_json, source_run_id, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    result_node_id,
                    project_id,
                    run["input_node_id"],
                    run["result"].get("name") or run["algorithm"],
                    "result",
                    data_path,
                    json.dumps(attributes, ensure_ascii=False),
                    run_id,
                    _now(),
                ),
            )

    with db() as conn:
        conn.execute(
            "UPDATE algorithm_runs SET status = ?, result_node_id = ?, reviewed_by = ?,"
            " reviewed_at = ? WHERE id = ?",
            (new_status, result_node_id, reviewer_id, _now(), run_id),
        )
    return get_run(run_id, project_id)


def delete_run(project_id: str, run_id: str) -> bool:
    """删除运行记录。已通过（已沉淀节点）的记录不允许删除。"""
    run = get_run(run_id, project_id)
    if run is None:
        return False
    if run["status"] == "approved":
        raise ValueError("已通过的结果已沉淀为血缘节点，不能删除")
    derived_path = run["result"].get("derived_path")
    with db() as conn:
        conn.execute("DELETE FROM algorithm_runs WHERE id = ?", (run_id,))
    storage.remove_file(derived_path)
    return True
