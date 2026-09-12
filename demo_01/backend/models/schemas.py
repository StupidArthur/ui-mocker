"""请求体数据模型（Pydantic）。

仅定义需要强校验的请求结构；响应结构以 JSON dict 直接返回，
因为字段常随算法类型变化，用 dict 更灵活且不牺牲可读性。
"""

from typing import Any, Literal

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=4, max_length=64)


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=4, max_length=64)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=4, max_length=64)
    role: Literal["user", "admin"] = "user"


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=4, max_length=64)


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = ""
    dataset_id: str


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class PublishRequest(BaseModel):
    is_public: bool


class RunRequest(BaseModel):
    algorithm: str
    params: dict[str, Any] = Field(default_factory=dict)


class ReviewRequest(BaseModel):
    decision: Literal["approve", "reject"]
