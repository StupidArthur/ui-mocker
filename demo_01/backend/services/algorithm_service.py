"""算法服务：在 DataFrame 上执行统计与预测算法。

全部为纯函数，不依赖 FastAPI/SQLite，可用 pytest 独立覆盖。
算法分两类：
- statistics：只产出属性（指标），不改变数据状态。
- prediction：产出派生数据（新增列或新增行），供后续节点继续计算。
"""

import numpy as np
import pandas as pd

from config import DEFAULT_FORECAST_HORIZON, DEFAULT_MA_WINDOW


def _numeric_columns(df: pd.DataFrame) -> list[str]:
    """返回数值列名（排除布尔列）。"""
    return [
        str(c)
        for c in df.columns
        if pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c])
    ]


ALGORITHMS: list[dict] = [
    {
        "key": "describe",
        "name": "描述性统计",
        "category": "statistics",
        "description": "统计每位号的数量、均值、标准差、最值与缺失率",
        "params": [],
    },
    {
        "key": "corr",
        "name": "相关系数",
        "category": "statistics",
        "description": "计算数值位号之间的皮尔逊相关系数矩阵",
        "params": [],
    },
    {
        "key": "trend",
        "name": "趋势分析",
        "category": "statistics",
        "description": "对每位号随时间做线性拟合，给出斜率、截距与 R²",
        "params": [],
    },
    {
        "key": "moving_average",
        "name": "移动平均",
        "category": "prediction",
        "description": "对每位号做滑动窗口平滑，派生 _ma 列",
        "params": [
            {"name": "window", "label": "窗口大小", "type": "int", "default": DEFAULT_MA_WINDOW}
        ],
    },
    {
        "key": "linear_forecast",
        "name": "线性回归外推",
        "category": "prediction",
        "description": "对每位号做线性趋势外推，追加未来若干行",
        "params": [
            {
                "name": "horizon",
                "label": "预测步数",
                "type": "int",
                "default": DEFAULT_FORECAST_HORIZON,
            }
        ],
    },
]

_ALGORITHM_MAP = {a["key"]: a for a in ALGORITHMS}


def list_algorithms() -> list[dict]:
    return ALGORITHMS


def get_algorithm(key: str) -> dict | None:
    return _ALGORITHM_MAP.get(key)


def describe(df: pd.DataFrame) -> list[dict]:
    """描述性统计：每位号的 count/mean/std/min/max/缺失率。"""
    result = []
    for col in _numeric_columns(df):
        series = df[col]
        valid = series.dropna()
        count = int(valid.count())
        result.append(
            {
                "name": col,
                "count": count,
                "missing_rate": round(float(series.isna().mean()), 4),
                "mean": round(float(valid.mean()), 4) if count else None,
                "std": round(float(valid.std()), 4) if count > 1 else None,
                "min": round(float(valid.min()), 4) if count else None,
                "max": round(float(valid.max()), 4) if count else None,
            }
        )
    return result


def correlation(df: pd.DataFrame) -> dict:
    """相关系数矩阵。"""
    cols = _numeric_columns(df)
    if len(cols) < 2:
        return {"columns": cols, "matrix": []}
    corr = df[cols].corr()
    matrix = [
        [None if pd.isna(v) else round(float(v), 4) for v in corr.iloc[i]]
        for i in range(len(cols))
    ]
    return {"columns": cols, "matrix": matrix}


def trend(df: pd.DataFrame) -> list[dict]:
    """趋势：以行序为时间轴，对每位号做一次线性回归。"""
    result = []
    x = np.arange(len(df), dtype=float)
    for col in _numeric_columns(df):
        series = df[col]
        mask = series.notna().to_numpy()
        if mask.sum() < 2:
            result.append(
                {"name": col, "slope": None, "intercept": None, "r2": None, "direction": "n/a"}
            )
            continue
        slope, intercept = np.polyfit(x[mask], series.to_numpy()[mask].astype(float), 1)
        predicted = slope * x[mask] + intercept
        actual = series.to_numpy()[mask].astype(float)
        ss_res = float(((actual - predicted) ** 2).sum())
        ss_tot = float(((actual - actual.mean()) ** 2).sum())
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
        direction = "up" if slope > 0 else "down" if slope < 0 else "flat"
        result.append(
            {
                "name": col,
                "slope": round(float(slope), 6),
                "intercept": round(float(intercept), 4),
                "r2": round(r2, 4),
                "direction": direction,
            }
        )
    return result


def moving_average(df: pd.DataFrame, window: int) -> tuple[pd.DataFrame, list[str]]:
    """移动平均平滑，返回 (派生 DataFrame, 新增列名)。"""
    window = max(1, int(window))
    out = df.copy()
    new_cols: list[str] = []
    for col in _numeric_columns(df):
        new_col = f"{col}_ma{window}"
        out[new_col] = df[col].rolling(window=window, min_periods=1).mean().round(6)
        new_cols.append(new_col)
    return out, new_cols


def _extend_time(df: pd.DataFrame, time_col: str, horizon: int) -> list:
    """根据时间列推算出未来的时间值。"""
    series = df[time_col]
    try:
        parsed = pd.to_datetime(series, errors="coerce")
    except (ValueError, TypeError):
        parsed = None
    if parsed is not None and parsed.notna().sum() >= 2:
        delta = parsed.diff().dropna().median()
        last = parsed.dropna().iloc[-1]
        return [last + delta * (i + 1) for i in range(horizon)]
    return [None] * horizon


def linear_forecast(
    df: pd.DataFrame, horizon: int, time_col: str | None = None
) -> tuple[pd.DataFrame, list[str]]:
    """线性回归外推，返回 (含未来行的 DataFrame, 被预测的列名)。"""
    horizon = max(1, int(horizon))
    numeric = _numeric_columns(df)
    x = np.arange(len(df), dtype=float)
    future_x = np.arange(len(df), len(df) + horizon, dtype=float)

    future_rows = []
    for step in range(horizon):
        future_rows.append({})
    for col in numeric:
        series = df[col]
        mask = series.notna().to_numpy()
        if mask.sum() >= 2:
            slope, intercept = np.polyfit(x[mask], series.to_numpy()[mask].astype(float), 1)
            predictions = slope * future_x + intercept
        else:
            predictions = np.full(horizon, np.nan)
        for i in range(horizon):
            future_rows[i][col] = round(float(predictions[i]), 6)

    future = pd.DataFrame(future_rows)
    if time_col and time_col in df.columns and not future.empty:
        future[time_col] = _extend_time(df, time_col, horizon)

    ordered_cols = list(df.columns) + [c for c in future.columns if c not in df.columns]
    future = future.reindex(columns=ordered_cols)
    out = pd.concat([df, future], ignore_index=True)
    return out, numeric


def run_algorithm(algorithm: str, params: dict, df: pd.DataFrame) -> dict:
    """算法统一入口。返回分类、摘要、派生数据与派生列信息。"""
    spec = get_algorithm(algorithm)
    if spec is None:
        raise ValueError(f"未知算法：{algorithm}")

    result: dict = {
        "algorithm": algorithm,
        "name": spec["name"],
        "category": spec["category"],
        "derived_columns": [],
        "derived": None,
        "summary": None,
    }

    if algorithm == "describe":
        result["summary"] = describe(df)
    elif algorithm == "corr":
        result["summary"] = correlation(df)
    elif algorithm == "trend":
        result["summary"] = trend(df)
    elif algorithm == "moving_average":
        window = int(params.get("window", DEFAULT_MA_WINDOW))
        derived, new_cols = moving_average(df, window)
        result["derived"] = derived
        result["derived_columns"] = new_cols
        result["summary"] = {"window": window, "new_columns": new_cols}
    elif algorithm == "linear_forecast":
        horizon = int(params.get("horizon", DEFAULT_FORECAST_HORIZON))
        derived, forecast_cols = linear_forecast(df, horizon)
        result["derived"] = derived
        result["derived_columns"] = forecast_cols
        result["summary"] = {
            "horizon": horizon,
            "forecast_columns": forecast_cols,
            "original_rows": int(len(df)),
            "total_rows": int(len(derived)),
        }
    else:  # pragma: no cover - 注册表与分支保持同步，防御性兜底
        raise ValueError(f"算法未实现：{algorithm}")
    return result
