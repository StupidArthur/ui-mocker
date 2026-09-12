"""数据集服务：上传解析、元数据登记、预览与删除。

负责把 CSV/Parquet 解析为 DataFrame，推断时间列与列类型，
并生成前端可直接渲染的预览结构。业务纯逻辑，可独立 pytest。
"""

import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from config import DEFAULT_PREVIEW_ROWS
from db import db
from services import storage

TIME_HINTS = {"time", "timestamp", "datetime", "date", "ts", "时间", "时间戳"}


def _is_numeric(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _json_value(value):
    """把 DataFrame 单元值转成 JSON 可序列化类型。"""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def dtype_label(series: pd.Series) -> str:
    """把 pandas dtype 归类为前端易用的标签。"""
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_bool_dtype(series):
        return "bool"
    if pd.api.types.is_integer_dtype(series):
        return "int"
    if pd.api.types.is_float_dtype(series):
        return "float"
    return "string"


def infer_time_column(df: pd.DataFrame) -> str | None:
    """推断时间轴列：优先命中时间特征名，其次可被解析为日期的列，兜底首列。"""
    if df.shape[1] == 0:
        return None
    for col in df.columns:
        if str(col).strip().lower() in TIME_HINTS:
            return str(col)
    for col in df.columns[:3]:
        series = df[col].dropna()
        if series.empty or pd.api.types.is_numeric_dtype(series):
            continue
        try:
            parsed = pd.to_datetime(series.head(20), errors="coerce")
        except (ValueError, TypeError):
            continue
        if parsed.notna().mean() >= 0.8:
            return str(col)
    return str(df.columns[0])


def load_dataframe(path: str | Path, fmt: str) -> pd.DataFrame:
    """按格式读取数据文件为 DataFrame。"""
    path = Path(path)
    if fmt == "csv":
        return pd.read_csv(path)
    if fmt == "parquet":
        return pd.read_parquet(path)
    raise ValueError(f"未知数据格式：{fmt}")


def load_dataframe_auto(path: str | Path) -> pd.DataFrame:
    """按文件扩展名自动判定格式并读取，供血缘节点数据使用。"""
    suffix = Path(path).suffix.lower()
    if suffix in (".parquet", ".pq"):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def columns_meta(df: pd.DataFrame) -> list[dict]:
    """生成列元信息列表。"""
    return [{"name": str(col), "dtype": dtype_label(df[col])} for col in df.columns]


def preview_dataframe(df: pd.DataFrame, rows: int = DEFAULT_PREVIEW_ROWS) -> dict:
    """生成预览：列信息 + 前 N 行 + 数值列统计摘要。"""
    head = df.head(rows)
    records = [
        {str(col): _json_value(row[col]) for col in df.columns}
        for _, row in head.iterrows()
    ]
    summary = []
    for col in df.columns:
        series = df[col]
        if not pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
            continue
        valid = series.dropna()
        count = int(valid.count())
        summary.append(
            {
                "name": str(col),
                "count": count,
                "missing_rate": round(float(series.isna().mean()), 4),
                "mean": round(float(valid.mean()), 4) if count else None,
                "std": round(float(valid.std()), 4) if count > 1 else None,
                "min": round(float(valid.min()), 4) if count else None,
                "max": round(float(valid.max()), 4) if count else None,
            }
        )
    return {"columns": columns_meta(df), "rows": records, "summary": summary}


def row_to_dict(row) -> dict:
    """把 datasets 表行转成对外 dict。"""
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "name": row["name"],
        "filename": row["filename"],
        "format": row["format"],
        "row_count": row["row_count"],
        "col_count": row["col_count"],
        "time_column": row["time_column"],
        "columns": json.loads(row["columns_json"]),
        "size_bytes": row["size_bytes"],
        "created_at": row["created_at"],
    }


def create_dataset(owner_id: str, name: str, filename: str, content: bytes) -> dict:
    """保存上传文件、解析并登记数据集元数据。解析失败会清理文件后抛出。"""
    storage_path, fmt = storage.save_upload(filename, content)
    try:
        df = load_dataframe(storage_path, fmt)
    except Exception as exc:
        storage.remove_file(storage_path)
        raise ValueError(f"数据文件解析失败：{exc}") from exc

    dataset_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    cols = columns_meta(df)
    time_column = infer_time_column(df)
    with db() as conn:
        conn.execute(
            "INSERT INTO datasets (id, owner_id, name, filename, storage_path, format,"
            " row_count, col_count, time_column, columns_json, size_bytes, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                dataset_id,
                owner_id,
                name or Path(filename).stem,
                filename,
                str(storage_path),
                fmt,
                int(df.shape[0]),
                int(df.shape[1]),
                time_column,
                json.dumps(cols, ensure_ascii=False),
                len(content),
                now,
            ),
        )
    return get_dataset(dataset_id, owner_id)


def list_datasets(owner_id: str) -> list[dict]:
    """列出某用户拥有的数据集，按创建时间倒序。"""
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM datasets WHERE owner_id = ? ORDER BY created_at DESC",
            (owner_id,),
        ).fetchall()
    return [row_to_dict(r) for r in rows]


def get_dataset(dataset_id: str, owner_id: str | None = None) -> dict | None:
    """按 id 获取数据集，可选校验所有者。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
    if row is None:
        return None
    if owner_id is not None and row["owner_id"] != owner_id:
        return None
    return row_to_dict(row)


def load_dataset_frame(dataset_id: str) -> pd.DataFrame | None:
    """加载数据集对应的 DataFrame。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
    if row is None:
        return None
    return load_dataframe(row["storage_path"], row["format"])


def get_storage_path(dataset_id: str) -> str | None:
    """获取数据集在磁盘上的路径。"""
    with db() as conn:
        row = conn.execute(
            "SELECT storage_path FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
    return row["storage_path"] if row else None


def preview_dataset(dataset_id: str, rows: int = DEFAULT_PREVIEW_ROWS) -> dict | None:
    """获取数据集预览。"""
    storage_path = get_storage_path(dataset_id)
    if storage_path is None:
        return None
    return preview_dataframe(load_dataframe_auto(storage_path), rows)


def count_referencing_projects(dataset_id: str) -> int:
    """统计引用该数据集的项目数量。

    删除数据集前必须先校验：若仍被项目引用，直接删除会让项目的血缘根节点
    指向已失效的文件，导致项目不可用，因此由调用方据此阻止删除。
    """
    with db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM projects WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()
    return int(row["c"])


def delete_dataset(dataset_id: str) -> bool:
    """删除数据集记录及其文件（调用方需先确认无项目引用）。"""
    with db() as conn:
        row = conn.execute(
            "SELECT storage_path FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
    storage.remove_file(row["storage_path"])
    return True
