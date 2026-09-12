"""密码哈希与会话 token 生成。

选用标准库实现，避免引入 bcrypt/jwt 等额外依赖：
- 密码用 PBKDF2-HMAC-SHA256 加盐哈希，绝不明文存库。
- 会话用不可预测的随机 token，落库以便支持登出（删除会话）。
"""

import hashlib
import os
import secrets

from config import PBKDF2_ITERATIONS, SESSION_TOKEN_BYTES


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """对密码加盐哈希，返回 (hash_hex, salt_hex)。salt 为空时现场生成。"""
    if salt is None:
        salt = os.urandom(16).hex()
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return derived.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """校验明文密码是否匹配存储的哈希。使用常量时间比较防时序攻击。"""
    candidate, _ = hash_password(password, salt)
    return secrets.compare_digest(candidate, password_hash)


def new_session_token() -> str:
    """生成 URL 安全的随机会话 token。"""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)
