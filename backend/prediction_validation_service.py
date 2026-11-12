"""
Market Plus AI - Prediction Validation Service

Validates prediction requests and checks whether historical data contains
enough observations for basic forecasting and evaluation.

This module validates inputs only. It does not generate predictions,
guarantee accuracy, or provide investment advice.
"""

from __future__ import annotations

import math
from typing import Any, Mapping


MINIMUM_HISTORY_ROWS = 30
RECOMMENDED_HISTORY_ROWS = 252
MAXIMUM_HORIZON_DAYS = 365


def _finite_number(value: Any) -> float | None:
    """Convert a value to a finite float."""
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return number if math.isfinite(number) else None


def validate_prediction_request(
    *,
    symbol: Any,
    duration_days: Any,
    current_price: Any,
    target_price: Any = None,
    user_risk_category: Any = None,
) -> dict[str, Any]:
    """
    Validate user inputs before a prediction request is processed.

    Expected duration is expressed in calendar days.

    Returns a JSON-serializable report containing errors and warnings.
    """
    errors: list[str] = []
    warnings: list[str] = []

    normalized_symbol = (
        symbol.strip().upper()
        if isinstance(symbol, str)
        else ""
    )

    if not normalized_symbol:
        errors.append("A valid asset symbol is required.")
    elif len(normalized_symbol) > 30:
        errors.append("The asset symbol is too long.")
    elif any(character.isspace() for character in normalized_symbol):
        errors.append("The asset symbol must not contain spaces.")

    duration = None

    if isinstance(duration_days, bool):
        errors.append("Duration must be a positive whole number.")
    else:
        try:
            duration = int(duration_days)
        except (TypeError, ValueError, OverflowError):
            errors.append("Duration must be a positive whole number.")
        else:
            if str(duration_days).strip() not in {
                str(duration),
                f"{duration}.0",
            }:
                errors.append("Duration must be a whole number.")

            if duration < 1:
                errors.append("Duration must be at least one day.")
            elif duration > MAXIMUM_HORIZON_DAYS:
                errors.append(
                    f"Duration cannot exceed {MAXIMUM_HORIZON_DAYS} days."
                )

    price = _finite_number(current_price)

    if price is None or price <= 0:
        errors.append("Current price must be a positive finite number.")

    target = None

    if target_price is not None and str(target_price).strip() != "":
        target = _finite_number(target_price)

        if target is None or target <= 0:
            errors.append("Target price must be a positive finite number.")
        elif price is not None and price > 0:
            if target > price:
                warnings.append(
                    "The requested target is above the current price."
                )
            elif target < price:
                warnings.append(
                    "The requested target is below the current price."
                )
            else:
                warnings.append(
                    "The target price equals the current price."
                )

    risk_category = None

    if user_risk_category is not None:
        if not isinstance(user_risk_category, str):
            errors.append("Risk category must be low, middle, or high.")
        else:
            risk_category = user_risk_category.strip().lower()

            if risk_category not in {"low", "middle", "high"}:
                errors.append(
                    "Risk category must be low, middle, or high."
                )

    return {
        "valid": not errors,
        "symbol": normalized_symbol or None,
        "duration_days": duration,
        "current_price": price,
        "target_price": target,
        "risk_category": risk_category,
        "errors": errors,
        "warnings": warnings,
    }


def validate_historical_data(
    *,
    row_count: Any,
    requested_horizon_days: Any,
    available_start_date: Any = None,
    available_end_date: Any = None,
) -> dict[str, Any]:
    """
    Assess whether a historical dataset is large enough for forecasting.

    This is a basic data-volume check, not a substitute for backtesting
    or checking data quality.
    """
    errors: list[str] = []
    warnings: list[str] = []

    try:
        rows = int(row_count)
    except (TypeError, ValueError, OverflowError):
        rows = -1

    if isinstance(row_count, bool) or rows < 0:
        errors.append("Historical row count must be a nonnegative integer.")
    elif rows < MINIMUM_HISTORY_ROWS:
        errors.append(
            f"At least {MINIMUM_HISTORY_ROWS} historical observations "
            "are recommended before attempting a prediction."
        )
    elif rows < RECOMMENDED_HISTORY_ROWS:
        warnings.append(
            "The dataset contains fewer than 252 observations. "
            "Longer history may improve evaluation reliability."
        )

    try:
        horizon = int(requested_horizon_days)
    except (TypeError, ValueError, OverflowError):
        horizon = -1

    if (
        isinstance(requested_horizon_days, bool)
        or horizon < 1
        or str(requested_horizon_days).strip()
        not in {str(horizon), f"{horizon}.0"}
    ):
        errors.append("Prediction horizon must be a positive whole number.")
    elif horizon > MAXIMUM_HORIZON_DAYS:
        errors.append(
            f"Prediction horizon cannot exceed {MAXIMUM_HORIZON_DAYS} days."
        )
    elif rows > 0 and horizon > rows:
        warnings.append(
            "The requested horizon is longer than the number of available "
            "historical observations."
        )

    return {
        "valid": not errors,
        "row_count": rows if rows >= 0 else None,
        "requested_horizon_days": horizon if horizon > 0 else None,
        "available_start_date": available_start_date,
        "available_end_date": available_end_date,
        "errors": errors,
        "warnings": warnings,
    }


def validate_prediction_output(
    *,
    predicted_prices: Any,
    expected_count: int | None = None,
) -> dict[str, Any]:
    """
    Check whether a model returned a usable sequence of predicted prices.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(predicted_prices, (list, tuple)):
        return {
            "valid": False,
            "prediction_count": 0,
            "minimum_price": None,
            "maximum_price": None,
            "errors": [
                "Predicted prices must be supplied as a list or tuple."
            ],
            "warnings": [],
        }

    if not predicted_prices:
        errors.append("The model returned no predicted prices.")

    values: list[float] = []

    for index, raw_value in enumerate(predicted_prices):
        value = _finite_number(raw_value)

        if value is None:
            errors.append(
                f"Prediction at position {index} is not a finite number."
            )
        elif value <= 0:
            errors.append(
                f"Prediction at position {index} is not a positive price."
            )
        else:
            values.append(value)

    if expected_count is not None:
        if (
            isinstance(expected_count, bool)
            or not isinstance(expected_count, int)
            or expected_count < 1
        ):
            errors.append("Expected prediction count must be a positive integer.")
        elif len(predicted_prices) != expected_count:
            errors.append(
                f"Expected {expected_count} predictions, "
                f"but received {len(predicted_prices)}."
            )

    if values and len(values) != len(predicted_prices):
        warnings.append(
            "Some predictions were invalid and were excluded from summary "
            "statistics."
        )

    return {
        "valid": not errors,
        "prediction_count": len(predicted_prices),
        "valid_prediction_count": len(values),
        "minimum_price": min(values) if values else None,
        "maximum_price": max(values) if values else None,
        "errors": errors,
        "warnings": warnings,
    }


def validate_model_metrics(
    metrics: Mapping[str, Any],
) -> dict[str, Any]:
    """
    Validate common prediction-evaluation metrics.

    Recognized fields:
        mae, mse, rmse, mape, smape, directional_accuracy

    Unknown fields are ignored.
    """
    if not isinstance(metrics, Mapping):
        raise ValueError("Metrics must be supplied as a mapping.")

    errors: list[str] = []
    warnings: list[str] = []
    normalized: dict[str, float] = {}

    supported = {
        "mae",
        "mse",
        "rmse",
        "mape",
        "smape",
        "directional_accuracy",
    }

    for raw_name, raw_value in metrics.items():
        name = str(raw_name).strip().lower()

        if name not in supported:
            continue

        value = _finite_number(raw_value)

        if value is None:
            errors.append(f"Metric '{name}' must be a finite number.")
            continue

        if name in {"mae", "mse", "rmse", "mape", "smape"} and value < 0:
            errors.append(f"Metric '{name}' cannot be negative.")
            continue

        if name == "directional_accuracy":
            if 0 <= value <= 1:
                value *= 100

            if not 0 <= value <= 100:
                errors.append(
                    "Directional accuracy must be between 0 and 100."
                )
                continue

        normalized[name] = round(value, 6)

    if not normalized and not errors:
        warnings.append("No supported evaluation metrics were supplied.")

    return {
        "valid": not errors,
        "metrics": normalized,
        "errors": errors,
        "warnings": warnings,
    }
