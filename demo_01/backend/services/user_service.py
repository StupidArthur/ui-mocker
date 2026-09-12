"""用户与会话服务。

封装注册、登录鉴权、密码修改/重置、会话签发与校验。
对外只暴露不含密码哈希的用户 dict。
"""

import uuid
from datetime import datetime, timedelta, timezone

from config import SESSION_TTL_DAYS
from db import db
from security import hash_password, new_session_token, verify_password


def _now() -> datetime:
    return datetime.now(timezone.utc)


def public_user(row) -> dict:
    """把用户行转成对外安全结构（剔除密码与盐）。"""
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "created_at": row["created_at"],
    }


def create_user(username: str, password: str, role: str = "user") -> dict:
    """创建用户，用户名重复时抛错。"""
    username = username.strip()
    with db() as conn:
        exists = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if exists is not None:
            raise ValueError("用户名已存在")
        password_hash, salt = hash_password(password)
        user_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO users (id, username, password_hash, salt, role, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (user_id, username, password_hash, salt, role, _now().isoformat()),
        )
    return get_user(user_id)


def get_user(user_id: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return public_user(row) if row else None


def list_users() -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
    return [public_user(r) for r in rows]


def authenticate(username: str, password: str) -> dict | None:
    """校验用户名密码，成功返回用户 dict，失败返回 None。"""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username.strip(),)
        ).fetchone()
    if row is None:
        return None
    if not verify_password(password, row["password_hash"], row["salt"]):
        return None
    return public_user(row)


def reset_password(user_id: str, new_password: str) -> bool:
    """管理员重置密码。"""
    password_hash, salt = hash_password(new_password)
    with db() as conn:
        cur = conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user_id),
        )
        if cur.rowcount == 0:
            return False
    return True


def change_password(user_id: str, old_password: str, new_password: str) -> None:
    """用户自助改密，需校验旧密码。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise ValueError("用户不存在")
        if not verify_password(old_password, row["password_hash"], row["salt"]):
            raise ValueError("原密码不正确")
        password_hash, salt = hash_password(new_password)
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user_id),
        )


def create_session(user_id: str) -> str:
    """签发会话 token 并落库。"""
    token = new_session_token()
    created = _now()
    expires = created + timedelta(days=SESSION_TTL_DAYS)
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, created.isoformat(), expires.isoformat()),
        )
    return token


def get_user_by_token(token: str) -> dict | None:
    """校验 token 与有效期，返回对应用户；过期则顺带清理。"""
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            "SELECT u.*, s.expires_at AS expires_at FROM sessions s"
            " JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()
        if row is None:
            return None
        if datetime.fromisoformat(row["expires_at"]) < _now():
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
    return public_user(row)


def delete_session(token: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
