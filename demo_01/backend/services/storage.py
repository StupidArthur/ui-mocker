"""文件存储：上传原始文件与算法派生数据的落盘管理。

所有路径拼接使用 pathlib，天然跨平台；派生文件带时间戳，
符合规范"多次运行生成的输出文件必须带时间戳标签"。
"""

import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import CSV_EXTENSIONS, DERIVED_DIR, PARQUET_EXTENSIONS, UPLOAD_DIR

_SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]+")


def _safe_stem(name: str) -> str:
    """把用户文件名清洗成安全的 stem，防止路径穿越与非法字符。"""
    stem = Path(name).stem
    cleaned = _SAFE_NAME.sub("_", stem).strip("._") or "data"
    return cleaned[:48]


def detect_format(filename: str) -> str:
    """根据扩展名判断数据集格式，未知则抛错。"""
    suffix = Path(filename).suffix.lower()
    if suffix in CSV_EXTENSIONS:
        return "csv"
    if suffix in PARQUET_EXTENSIONS:
        return "parquet"
    raise ValueError(f"不支持的文件格式：{suffix or '(无扩展名)'}")


def save_upload(original_filename: str, content: bytes) -> tuple[Path, str]:
    """保存上传文件，返回 (落盘路径, 格式)。文件名加 uuid 防冲突。"""
    fmt = detect_format(original_filename)
    suffix = Path(original_filename).suffix.lower()
    stored = UPLOAD_DIR / f"{_safe_stem(original_filename)}_{uuid.uuid4().hex[:8]}{suffix}"
    stored.write_bytes(content)
    return stored, fmt


def derived_parquet_path(project_id: str, algorithm: str) -> Path:
    """为一次算法派生数据生成带时间戳的 parquet 路径。"""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    filename = f"{project_id[:8]}_{algorithm}_{stamp}_{uuid.uuid4().hex[:6]}.parquet"
    return DERIVED_DIR / filename


def copy_file(src: str | Path, dest_dir: Path, tag: str = "") -> Path:
    """把文件复制到目标目录并加随机后缀，用于克隆项目时的数据副本。"""
    src = Path(src)
    suffix = src.suffix
    name = f"{_safe_stem(src.stem)}_{tag}_{uuid.uuid4().hex[:8]}{suffix}".strip("_")
    dest = dest_dir / name
    shutil.copy2(src, dest)
    return dest


def remove_file(path: str | Path | None) -> None:
    """删除文件，忽略不存在的情况。"""
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass
