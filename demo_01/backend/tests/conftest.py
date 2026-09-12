"""测试夹具：把数据目录隔离到临时目录，避免污染真实环境。

必须在导入任何 backend 模块之前设置 STUDIO_DATA_DIR，
因为 config 在导入时即读取该环境变量。
"""

import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="studio_test_")
os.environ["STUDIO_DATA_DIR"] = _TMP_DIR

import pytest  # noqa: E402

from db import init_db  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _prepare_db():
    init_db()
    yield
