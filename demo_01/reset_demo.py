"""测试环境重置：清空运行期数据并恢复 Demo 初始状态。

用途：UI 自动化测试重复运行时，数据集、项目、算法运行记录、血缘节点、
用户账号、公开状态等业务数据会残留，导致两次测试结果不可比。
本脚本删除整个运行期数据目录（SQLite 库与上传/派生文件），再复用
`db.init_db()` 重建表结构与默认管理员，保证多次执行结果一致（幂等）。

用法：
    cd demo_01
    python reset_demo.py
"""

import shutil
import sys
from pathlib import Path

# 复用 backend 既有模块：config / db / security，不重复实现初始化逻辑。
BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import DATA_DIR  # noqa: E402
from db import init_db  # noqa: E402


def reset() -> None:
    """删除运行期数据目录并重新初始化数据库。可重复执行。"""
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
    init_db()


if __name__ == "__main__":
    reset()
    print(f"demo reset complete: {DATA_DIR}")
