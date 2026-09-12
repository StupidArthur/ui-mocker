"""全局配置与路径管理。

集中定义存储目录、会话与安全参数、算法默认参数等运行期可能调整的配置项，
避免魔法数字散落在业务代码中（遵循编码规范：可配置项置于模块顶部）。
"""

import os
from pathlib import Path

# 项目根目录：backend/ 的上一级
BASE_DIR = Path(__file__).resolve().parent

# 数据目录：数据库与上传/派生文件都放这里，便于整体迁移与清理。
# 允许用环境变量 STUDIO_DATA_DIR 覆盖，便于测试时隔离到临时目录。
DATA_DIR = Path(os.environ.get("STUDIO_DATA_DIR", str(BASE_DIR / "data")))
UPLOAD_DIR = DATA_DIR / "uploads"
DERIVED_DIR = DATA_DIR / "derived"
DB_PATH = DATA_DIR / "studio.db"

# 允许上传的数据格式及其扩展名
SUPPORTED_FORMATS = {"csv", "parquet"}
CSV_EXTENSIONS = {".csv"}
PARQUET_EXTENSIONS = {".parquet", ".pq"}

# 会话 token 有效期（天）与字节长度
SESSION_TTL_DAYS = 7
SESSION_TOKEN_BYTES = 32

# 密码哈希迭代次数，兼顾演示性能与基本安全
PBKDF2_ITERATIONS = 120_000

# 数据集预览默认返回行数
DEFAULT_PREVIEW_ROWS = 20

# 默认管理员账号（首次启动时若不存在则创建）
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"

# 算法默认参数
DEFAULT_MA_WINDOW = 3
DEFAULT_FORECAST_HORIZON = 5


def ensure_dirs() -> None:
    """确保运行所需目录存在。"""
    for path in (DATA_DIR, UPLOAD_DIR, DERIVED_DIR):
        path.mkdir(parents=True, exist_ok=True)
