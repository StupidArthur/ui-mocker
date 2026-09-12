"""项目服务：项目的增删改查、公开切换与克隆。

权限模型：
- 可见：所有者 / 管理员 / 已公开。
- 可编辑（改名、删除、发布、执行、审核）：所有者 / 管理员。
- 克隆：登录用户可克隆已公开项目（或自己的项目），得到完全属于自己的副本。
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import DERIVED_DIR, UPLOAD_DIR
from db import db
from services import dataset_service, lineage_service, storage

PROJECT_SELECT = """
SELECT p.*, u.username AS owner_name, d.name AS dataset_name,
       (SELECT COUNT(*) FROM lineage_nodes n WHERE n.project_id = p.id) AS node_count
FROM projects p
JOIN users u ON u.id = p.owner_id
LEFT JOIN datasets d ON d.id = p.dataset_id
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "owner_name": row["owner_name"],
        "name": row["name"],
        "description": row["description"],
        "dataset_id": row["dataset_id"],
        "dataset_name": row["dataset_name"],
        "is_public": bool(row["is_public"]),
        "node_count": row["node_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def can_view(project: dict, user: dict) -> bool:
    return (
        user["role"] == "admin"
        or project["owner_id"] == user["id"]
        or project["is_public"]
    )


def can_edit(project: dict, user: dict) -> bool:
    return user["role"] == "admin" or project["owner_id"] == user["id"]


def create_project(
    owner_id: str, name: str, description: str, dataset_id: str
) -> dict:
    """创建项目并绑定数据集，同时生成血缘根节点。"""
    dataset = dataset_service.get_dataset(dataset_id)
    if dataset is None:
        raise ValueError("数据集不存在")
    if dataset["owner_id"] != owner_id:
        raise ValueError("只能使用自己的数据集创建项目")

    project_id = uuid.uuid4().hex
    now = _now()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id, owner_id, name, description, dataset_id,"
            " is_public, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)",
            (project_id, owner_id, name.strip(), description, dataset_id, now, now),
        )
    lineage_service.create_root_node(project_id, dataset_id, dataset["name"])
    return get_project(project_id)


def get_project(project_id: str) -> dict | None:
    with db() as conn:
        row = conn.execute(
            PROJECT_SELECT + " WHERE p.id = ?", (project_id,)
        ).fetchone()
    return project_to_dict(row) if row else None


def list_projects(user: dict, scope: str = "mine") -> list[dict]:
    """列出项目。scope=mine 仅本人；scope=public 列出全部公开项目。"""
    with db() as conn:
        if scope == "public":
            rows = conn.execute(
                PROJECT_SELECT
                + " WHERE p.is_public = 1 ORDER BY p.updated_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                PROJECT_SELECT
                + " WHERE p.owner_id = ? ORDER BY p.updated_at DESC",
                (user["id"],),
            ).fetchall()
    return [project_to_dict(r) for r in rows]


def update_project(project_id: str, name: str | None, description: str | None) -> dict:
    fields, values = [], []
    if name is not None:
        fields.append("name = ?")
        values.append(name.strip())
    if description is not None:
        fields.append("description = ?")
        values.append(description)
    if fields:
        fields.append("updated_at = ?")
        values.append(_now())
        values.append(project_id)
        with db() as conn:
            conn.execute(f"UPDATE projects SET {', '.join(fields)} WHERE id = ?", values)
    return get_project(project_id)


def publish_project(project_id: str, is_public: bool) -> dict:
    with db() as conn:
        conn.execute(
            "UPDATE projects SET is_public = ?, updated_at = ? WHERE id = ?",
            (1 if is_public else 0, _now(), project_id),
        )
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    """删除项目，并清理其血缘节点产生的派生数据文件。"""
    with db() as conn:
        rows = conn.execute(
            "SELECT data_path FROM lineage_nodes WHERE project_id = ? AND node_type = 'result'",
            (project_id,),
        ).fetchall()
        pending = conn.execute(
            "SELECT result_json FROM algorithm_runs WHERE project_id = ?", (project_id,)
        ).fetchall()
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if cur.rowcount == 0:
            return False

    derived_root = str(DERIVED_DIR)
    for row in rows:
        path = row["data_path"]
        if path and str(path).startswith(derived_root):
            storage.remove_file(path)
    for row in pending:
        path = json.loads(row["result_json"]).get("derived_path")
        if path and str(path).startswith(derived_root):
            storage.remove_file(path)
    return True


def _clone_dataset(dataset_id: str, new_owner_id: str) -> tuple[str, str]:
    """复制数据集文件与记录，返回 (新数据集 id, 新文件路径)。"""
    with db() as conn:
        src = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
    if src is None:
        raise ValueError("源数据集不存在")
    new_path = storage.copy_file(src["storage_path"], UPLOAD_DIR, "clone")
    new_id = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO datasets (id, owner_id, name, filename, storage_path, format,"
            " row_count, col_count, time_column, columns_json, size_bytes, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                new_id,
                new_owner_id,
                src["name"],
                src["filename"],
                str(new_path),
                src["format"],
                src["row_count"],
                src["col_count"],
                src["time_column"],
                src["columns_json"],
                src["size_bytes"],
                _now(),
            ),
        )
    return new_id, str(new_path)


def clone_project(source: dict, new_owner_id: str) -> dict:
    """克隆项目：复制数据集、血缘节点与运行记录，得到独立副本。"""
    new_dataset_id, _ = _clone_dataset(source["dataset_id"], new_owner_id)
    new_project_id = uuid.uuid4().hex
    now = _now()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id, owner_id, name, description, dataset_id,"
            " is_public, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)",
            (
                new_project_id,
                new_owner_id,
                f"{source['name']}（副本）",
                source["description"],
                new_dataset_id,
                now,
                now,
            ),
        )

    with db() as conn:
        nodes = conn.execute(
            "SELECT * FROM lineage_nodes WHERE project_id = ? ORDER BY created_at ASC",
            (source["id"],),
        ).fetchall()
        runs = conn.execute(
            "SELECT * FROM algorithm_runs WHERE project_id = ? ORDER BY created_at ASC",
            (source["id"],),
        ).fetchall()

    node_map: dict[str, str] = {}
    for node in nodes:
        new_node_id = uuid.uuid4().hex
        node_map[node["id"]] = new_node_id
        if node["node_type"] == "root":
            data_path = dataset_service.get_storage_path(new_dataset_id)
        elif node["data_path"]:
            copied = storage.copy_file(node["data_path"], DERIVED_DIR, "clone")
            data_path = str(copied)
        else:
            data_path = None
        parent_id = node_map.get(node["parent_id"])
        with db() as conn:
            conn.execute(
                "INSERT INTO lineage_nodes (id, project_id, parent_id, title, node_type,"
                " data_path, attributes_json, source_run_id, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    new_node_id,
                    new_project_id,
                    parent_id,
                    node["title"],
                    node["node_type"],
                    data_path,
                    node["attributes_json"],
                    None,
                    node["created_at"],
                ),
            )

    for run in runs:
        result = json.loads(run["result_json"])
        if result.get("derived_path"):
            mapped = node_map.get(run["result_node_id"])
            result["derived_path"] = (
                lineage_service.get_node(mapped)["data_path"] if mapped else None
            )
        with db() as conn:
            conn.execute(
                "INSERT INTO algorithm_runs (id, project_id, input_node_id, algorithm,"
                " params_json, status, result_json, result_node_id, created_by,"
                " reviewed_by, reviewed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex,
                    new_project_id,
                    node_map.get(run["input_node_id"], run["input_node_id"]),
                    run["algorithm"],
                    run["params_json"],
                    run["status"],
                    json.dumps(result, ensure_ascii=False),
                    node_map.get(run["result_node_id"]),
                    new_owner_id,
                    run["reviewed_by"],
                    run["reviewed_at"],
                    run["created_at"],
                ),
            )
    return get_project(new_project_id)
