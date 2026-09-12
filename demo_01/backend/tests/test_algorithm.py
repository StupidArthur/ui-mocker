"""算法纯逻辑测试：覆盖正常/空/非法/边界四类场景。"""

import pandas as pd
import pytest

from services import algorithm_service as alg


def sample_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=5, freq="D"),
            "a": [1.0, 2.0, 3.0, 4.0, 5.0],
            "b": [5.0, 4.0, 3.0, 2.0, 1.0],
            "label": ["x", "y", "z", "w", "v"],
        }
    )


def test_describe_正常路径():
    result = alg.describe(sample_df())
    names = [item["name"] for item in result]
    assert names == ["a", "b"]
    a = next(item for item in result if item["name"] == "a")
    assert a["count"] == 5
    assert a["mean"] == 3.0
    assert a["min"] == 1.0 and a["max"] == 5.0
    assert a["missing_rate"] == 0.0


def test_describe_空数据():
    assert alg.describe(pd.DataFrame()) == []
    assert alg.describe(pd.DataFrame({"label": ["a", "b"]})) == []


def test_describe_含缺失():
    df = pd.DataFrame({"a": [1.0, None, 3.0]})
    result = alg.describe(df)
    assert result[0]["count"] == 2
    assert round(result[0]["missing_rate"], 4) == 0.3333


def test_correlation_正常与反向():
    result = alg.correlation(sample_df())
    assert result["columns"] == ["a", "b"]
    i, j = result["columns"].index("a"), result["columns"].index("b")
    assert result["matrix"][i][i] == 1.0
    assert result["matrix"][i][j] == -1.0


def test_correlation_不足两列():
    result = alg.correlation(pd.DataFrame({"a": [1, 2, 3]}))
    assert result["columns"] == ["a"]
    assert result["matrix"] == []


def test_trend_上升与下降():
    result = {item["name"]: item for item in alg.trend(sample_df())}
    assert result["a"]["slope"] == pytest.approx(1.0)
    assert result["a"]["direction"] == "up"
    assert result["b"]["slope"] == pytest.approx(-1.0)
    assert result["b"]["direction"] == "down"
    assert result["a"]["r2"] == pytest.approx(1.0)


def test_trend_样本不足():
    result = alg.trend(pd.DataFrame({"a": [1.0, None]}))
    assert result[0]["slope"] is None


def test_moving_average_正常():
    derived, new_cols = alg.moving_average(sample_df(), 2)
    assert new_cols == ["a_ma2", "b_ma2"]
    assert derived["a_ma2"].iloc[-1] == pytest.approx(4.5)
    assert len(derived) == 5


def test_moving_average_窗口大于数据量():
    derived, new_cols = alg.moving_average(pd.DataFrame({"a": [1.0, 3.0]}), 10)
    assert new_cols == ["a_ma10"]
    assert derived["a_ma10"].iloc[-1] == pytest.approx(2.0)


def test_linear_forecast_外推():
    derived, cols = alg.linear_forecast(sample_df(), 2)
    assert cols == ["a", "b"]
    assert len(derived) == 7
    assert derived["a"].iloc[-1] == pytest.approx(7.0)
    assert derived["b"].iloc[-1] == pytest.approx(-1.0)
    assert derived["label"].iloc[-1] is None or pd.isna(derived["label"].iloc[-1])


def test_linear_forecast_步数下限():
    derived, _ = alg.linear_forecast(sample_df(), 0)
    assert len(derived) == 6


def test_run_algorithm_统计类无派生():
    result = alg.run_algorithm("describe", {}, sample_df())
    assert result["category"] == "statistics"
    assert result["derived"] is None
    assert isinstance(result["summary"], list)


def test_run_algorithm_预测类有派生():
    result = alg.run_algorithm("linear_forecast", {"horizon": 3}, sample_df())
    assert result["category"] == "prediction"
    assert result["derived"] is not None
    assert result["summary"]["total_rows"] == 8


def test_run_algorithm_未知算法():
    with pytest.raises(ValueError):
        alg.run_algorithm("not_exist", {}, sample_df())


def test_list_algorithms_字段完整():
    keys = {a["key"] for a in alg.list_algorithms()}
    assert {"describe", "corr", "trend", "moving_average", "linear_forecast"} <= keys
