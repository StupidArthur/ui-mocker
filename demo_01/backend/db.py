"""SQLite 连接与建表。

演示站数据量小，直接使用标准库 sqlite3，不引入 ORM。
连接按操作粒度创建（每次请求独立连接），避免跨线程共享游标的问题。
"""

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from config import (
    DB_PATH,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    ensure_dirs,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS datasets (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    filename     TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    format       TEXT NOT NULL,
    row_count    INTEGER NOT NULL DEFAULT 0,
    col_count    INTEGER NOT NULL DEFAULT 0,
    time_column  TEXT,
    columns_json TEXT NOT NULL DEFAULT '[]',
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dataset_id  TEXT,
    is_public   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lineage_nodes (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL,
    parent_id        TEXT,
    title            TEXT NOT NULL,
    node_type        TEXT NOT NULL,
    data_path        TEXT,
    attributes_json  TEXT NOT NULL DEFAULT '{}',
    source_run_id    TEXT,
    created_at       TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS algorithm_runs (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    input_node_id  TEXT NOT NULL,
    algorithm      TEXT NOT NULL,
    params_json    TEXT NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'pending',
    result_json    TEXT NOT NULL DEFAULT '{}',
    result_node_id TEXT,
    created_by     TEXT NOT NULL,
    reviewed_by    TEXT,
    reviewed_at    TEXT,
    created_at     TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (input_node_id) REFERENCES lineage_nodes(id) ON DELETE CASCADE
);
"""


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """获取一个自动提交/回滚的数据库连接上下文。"""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """建表并确保默认管理员存在。应用启动时调用一次。"""
    from security import hash_password  # 延迟导入避免循环依赖

    ensure_dirs()
    with db() as conn:
        conn.executescript(SCHEMA)
        row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USERNAME,)
        ).fetchone()
        if row is None:
            from datetime import datetime, timezone
            import uuid

            password_hash, salt = hash_password(DEFAULT_ADMIN_PASSWORD)
            conn.execute(
                "INSERT INTO users (id, username, password_hash, salt, role, created_at)"
                " VALUES (?, ?, ?, ?, 'admin', ?)",
                (
                    uuid.uuid4().hex,
                    DEFAULT_ADMIN_USERNAME,
                    password_hash,
                    salt,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
