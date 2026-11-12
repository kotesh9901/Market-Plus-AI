"""
Market Plus AI — Prediction Evaluation Service
Version: 1.0.0

Responsibilities:
- Calculate MAE, RMSE, MAPE, and sMAPE.
- Compare actual prices with predicted prices.
- Evaluate directional accuracy.
- Perform walk-forward time-series evaluation.
- Support model comparison.
- Return JSON-friendly Python dictionaries.

Important:
- This module does not train a particular ML model.
- The predictor supplied to walk_forward_evaluate must train using
  historical training data only.
- Evaluation metrics measure historical performance and do not
  guarantee future prediction accuracy.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable, Sequence
from typing import Any

logger = logging.getLogger(__name__)


# ============================================================
# VALIDATION AND CONVERSION
# ============================================================

def _to_float_list(
    values: Sequence[Any],
    field_name: str,
) -> list[float]:
    """Convert numeric values to floats and reject invalid inputs."""

    if isinstance(values, (str, bytes)):
        raise ValueError(f"{field_name} must be a sequence of numbers.")

    try:
        converted = [float(value) for value in values]
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(
            f"{field_name} contains an invalid numeric value."
        ) from exc

    if not converted:
        raise ValueError(f"{field_name} cannot be empty.")

    if not all(math.isfinite(value) for value in converted):
        raise ValueError(
            f"{field_name} must contain only finite numbers."
        )

    return converted


def _validate_prediction_pairs(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> tuple[list[float], list[float]]:
    """Validate and normalize actual and predicted values."""

    actual_values = _to_float_list(actual, "actual")
    predicted_values = _to_float_list(predicted, "predicted")

    if len(actual_values) != len(predicted_values):
        raise ValueError(
            "Actual and predicted values must have the same length."
        )

    return actual_values, predicted_values


def _round_metric(
    value: float | None,
    digits: int = 6,
) -> float | None:
    """Round a finite metric for readable API responses."""

    if value is None:
        return None

    if not math.isfinite(value):
        return None

    return round(float(value), digits)


# ============================================================
# CORE EVALUATION METRICS
# ============================================================

def calculate_mae(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> float:
    """
    Calculate Mean Absolute Error.

    Formula:
        MAE = mean(abs(actual - predicted))

    Lower values indicate smaller average absolute errors.
    The result uses the same units as the supplied prices.
    """

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    errors = [
        abs(actual_value - predicted_value)
        for actual_value, predicted_value
        in zip(actual_values, predicted_values)
    ]

    return sum(errors) / len(errors)


def calculate_mse(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> float:
    """Calculate Mean Squared Error."""

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    squared_errors = [
        (actual_value - predicted_value) ** 2
        for actual_value, predicted_value
        in zip(actual_values, predicted_values)
    ]

    return sum(squared_errors) / len(squared_errors)


def calculate_rmse(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> float:
    """
    Calculate Root Mean Squared Error.

    RMSE penalizes larger errors more heavily than MAE.
    """

    return math.sqrt(calculate_mse(actual, predicted))


def calculate_mape(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> float | None:
    """
    Calculate Mean Absolute Percentage Error as a percentage.

    Actual values equal to zero are excluded because percentage
    error is undefined for those observations.

    Returns None if every actual value is zero.
    """

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    percentage_errors = [
        abs(actual_value - predicted_value) / abs(actual_value)
        for actual_value, predicted_value
        in zip(actual_values, predicted_values)
        if actual_value != 0
    ]

    if not percentage_errors:
        return None

    return (
        sum(percentage_errors) / len(percentage_errors)
    ) * 100.0


def calculate_smape(
    actual: Sequence[Any],
    predicted: Sequence[Any],
) -> float:
    """
    Calculate symmetric Mean Absolute Percentage Error.

    Returns a percentage between 0 and 200 for finite inputs.
    When both actual and predicted values are zero, that observation
    contributes zero error.
    """

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    percentage_errors: list[float] = []

    for actual_value, predicted_value in zip(
        actual_values,
        predicted_values,
    ):
        denominator = abs(actual_value) + abs(predicted_value)

        if denominator == 0:
            percentage_errors.append(0.0)
        else:
            percentage_errors.append(
                2.0
                * abs(actual_value - predicted_value)
                / denominator
            )

    return (
        sum(percentage_errors) / len(percentage_errors)
    ) * 100.0


def calculate_directional_accuracy(
    actual: Sequence[Any],
    predicted: Sequence[Any],
    previous_actual: float | None = None,
) -> float | None:
    """
    Calculate directional accuracy as a percentage.

    Each prediction is compared with the previous actual price.

    Example:
        Previous actual price: 100
        Actual next price:     105
        Predicted next price:  103

    Both actual and predicted directions are upward, so the
    prediction is directionally correct.

    If previous_actual is omitted, the first observation cannot
    be evaluated directionally. The function uses subsequent
    observations only.

    Returns None if no directional comparisons are available.
    """

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    if previous_actual is not None:
        try:
            previous_actual = float(previous_actual)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(
                "previous_actual must be a finite number."
            ) from exc

        if not math.isfinite(previous_actual):
            raise ValueError(
                "previous_actual must be a finite number."
            )

        previous_values = [previous_actual, *actual_values[:-1]]
        actual_next_values = actual_values
        predicted_next_values = predicted_values
    else:
        if len(actual_values) < 2:
            return None

        previous_values = actual_values[:-1]
        actual_next_values = actual_values[1:]
        predicted_next_values = predicted_values[1:]

    correct = 0
    comparisons = 0

    for previous, actual_next, predicted_next in zip(
        previous_values,
        actual_next_values,
        predicted_next_values,
    ):
        actual_direction = actual_next - previous
        predicted_direction = predicted_next - previous

        # Ignore completely unchanged actual observations because
        # a strict up/down classification is not meaningful for them.
        if actual_direction == 0:
            continue

        comparisons += 1

        actual_is_up = actual_direction > 0
        predicted_is_up = predicted_direction > 0

        if actual_is_up == predicted_is_up:
            correct += 1

    if comparisons == 0:
        return None

    return (correct / comparisons) * 100.0


# ============================================================
# COMBINED EVALUATION
# ============================================================

def evaluate_predictions(
    actual: Sequence[Any],
    predicted: Sequence[Any],
    previous_actual: float | None = None,
    include_details: bool = True,
) -> dict[str, Any]:
    """
    Calculate the principal metrics for a prediction series.

    Returns a JSON-friendly dictionary containing:
    - observation count
    - MAE
    - MSE
    - RMSE
    - MAPE
    - sMAPE
    - directional accuracy
    - optional actual/predicted/error records

    MAPE and directional accuracy may be None when they cannot
    be calculated reliably.
    """

    actual_values, predicted_values = _validate_prediction_pairs(
        actual,
        predicted,
    )

    errors = [
        predicted_value - actual_value
        for actual_value, predicted_value
        in zip(actual_values, predicted_values)
    ]

    absolute_errors = [abs(error) for error in errors]

    mae = sum(absolute_errors) / len(absolute_errors)
    mse = sum(error ** 2 for error in errors) / len(errors)
    rmse = math.sqrt(mse)

    mape = calculate_mape(actual_values, predicted_values)
    smape = calculate_smape(actual_values, predicted_values)

    directional_accuracy = calculate_directional_accuracy(
        actual_values,
        predicted_values,
        previous_actual=previous_actual,
    )

    result: dict[str, Any] = {
        "success": True,
        "observation_count": len(actual_values),
        "metrics": {
            "mae": _round_metric(mae),
            "mse": _round_metric(mse),
            "rmse": _round_metric(rmse),
            "mape_percent": _round_metric(mape),
            "smape_percent": _round_metric(smape),
            "directional_accuracy_percent": _round_metric(
                directional_accuracy
            ),
        },
        "interpretation": {
            "mae": (
                "Average absolute prediction error in price units."
            ),
            "rmse": (
                "Root mean squared error in price units; "
                "larger errors receive more weight."
            ),
            "mape_percent": (
                "Average absolute percentage error over non-zero "
                "actual values."
            ),
            "directional_accuracy_percent": (
                "Percentage of eligible observations for which "
                "the predicted price direction matched the actual "
                "direction."
            ),
        },
    }

    if include_details:
        result["details"] = [
            {
                "index": index,
                "actual": _round_metric(actual_value),
                "predicted": _round_metric(predicted_value),
                "error": _round_metric(error),
                "absolute_error": _round_metric(abs(error)),
            }
            for index, (
                actual_value,
                predicted_value,
                error,
            ) in enumerate(
                zip(actual_values, predicted_values, errors)
            )
        ]

    return result


# ============================================================
# WALK-FORWARD EVALUATION
# ============================================================

PredictorFunction = Callable[
    [list[float], int],
    Sequence[float],
]


def walk_forward_evaluate(
    historical_prices: Sequence[Any],
    predictor: PredictorFunction,
    initial_train_size: int,
    horizon: int = 1,
    step: int | None = None,
    max_folds: int = 4,
) -> dict[str, Any]:
    """
    Perform expanding-window walk-forward evaluation.

    Parameters:
        historical_prices:
            Chronologically ordered historical prices, oldest first.

        predictor:
            Callable accepting:
                predictor(training_prices, forecast_horizon)

            It must return exactly forecast_horizon predictions.

            The callable is responsible for fitting its model using
            only the training_prices supplied to it.

        initial_train_size:
            Number of observations in the first training window.

        horizon:
            Number of consecutive future observations to predict
            per fold.

        step:
            Number of observations to advance between folds.
            Defaults to horizon.

        max_folds:
            Maximum number of evaluation windows.

    Returns:
        A dictionary containing overall metrics, individual fold
        metrics, and out-of-sample actual/predicted values.

    Important:
        This is an expanding-window evaluation. Each fold uses
        observations before its test window for training. Test
        observations from one fold may become training observations
        in a later fold, which reflects a sequential forecasting
        process.

        This function does not itself prevent leakage inside a
        user-supplied predictor. The predictor must fit preprocessing,
        feature selection, and model parameters on training data only.
    """

    prices = _to_float_list(
        historical_prices,
        "historical_prices",
    )

    if not callable(predictor):
        raise ValueError("predictor must be callable.")

    if (
        not isinstance(initial_train_size, int)
        or isinstance(initial_train_size, bool)
        or initial_train_size < 2
    ):
        raise ValueError(
            "initial_train_size must be an integer of at least 2."
        )

    if (
        not isinstance(horizon, int)
        or isinstance(horizon, bool)
        or horizon < 1
    ):
        raise ValueError("horizon must be a positive integer.")

    if step is None:
        step = horizon

    if (
        not isinstance(step, int)
        or isinstance(step, bool)
        or step < 1
    ):
        raise ValueError("step must be a positive integer.")

    if (
        not isinstance(max_folds, int)
        or isinstance(max_folds, bool)
        or max_folds < 1
    ):
        raise ValueError("max_folds must be a positive integer.")

    if initial_train_size >= len(prices):
        raise ValueError(
            "initial_train_size must be smaller than the "
            "number of historical prices."
        )

    folds: list[dict[str, Any]] = []
    all_actual: list[float] = []
    all_predicted: list[float] = []

    train_end = initial_train_size
    fold_number = 1

    while (
        train_end + horizon <= len(prices)
        and fold_number <= max_folds
    ):
        training_prices = prices[:train_end]
        actual_test_prices = prices[
            train_end:train_end + horizon
        ]

        try:
            raw_predictions = predictor(
                list(training_prices),
                horizon,
            )

            predicted_test_prices = _to_float_list(
                raw_predictions,
                "predictions",
            )

            if len(predicted_test_prices) != horizon:
                raise ValueError(
                    "The predictor must return exactly "
                    f"{horizon} predictions."
                )

            fold_metrics = evaluate_predictions(
                actual_test_prices,
                predicted_test_prices,
                previous_actual=training_prices[-1],
                include_details=True,
            )

            folds.append(
                {
                    "fold": fold_number,
                    "training_observations": len(training_prices),
                    "test_observations": len(actual_test_prices),
                    "training_end_index": train_end - 1,
                    "test_start_index": train_end,
                    "test_end_index": train_end + horizon - 1,
                    "metrics": fold_metrics["metrics"],
                    "details": fold_metrics["details"],
                }
            )

            all_actual.extend(actual_test_prices)
            all_predicted.extend(predicted_test_prices)

        except Exception as exc:
            logger.exception(
                "Walk-forward evaluation failed on fold %s.",
                fold_number,
            )

            return {
                "success": False,
                "error": (
                    f"Evaluation failed on fold {fold_number}: "
                    f"{type(exc).__name__}: {exc}"
                ),
                "folds_completed": len(folds),
                "folds": folds,
            }

        fold_number += 1
        train_end += step

    if not folds:
        return {
            "success": False,
            "error": (
                "Insufficient historical data to create a complete "
                "walk-forward test window."
            ),
            "folds_completed": 0,
            "folds": [],
        }

    overall_metrics = evaluate_predictions(
        all_actual,
        all_predicted,
        include_details=True,
    )

    return {
        "success": True,
        "evaluation_method": "expanding_window_walk_forward",
        "folds_completed": len(folds),
        "initial_train_size": initial_train_size,
        "forecast_horizon": horizon,
        "step": step,
        "metrics": overall_metrics["metrics"],
        "folds": folds,
        "out_of_sample": overall_metrics["details"],
        "disclaimer": (
            "Historical evaluation results do not guarantee "
            "future performance. Metrics depend on the selected "
            "asset, evaluation period, data quality, and model."
        ),
    }


# ============================================================
# MODEL COMPARISON
# ============================================================

def compare_prediction_models(
    actual: Sequence[Any],
    model_predictions: dict[str, Sequence[Any]],
) -> dict[str, Any]:
    """
    Compare multiple models using the same actual observations.

    Example:
        compare_prediction_models(
            actual=[100, 102, 104],
            model_predictions={
                "Linear Regression": [99, 103, 103],
                "Random Forest": [101, 101, 105],
            },
        )

    Results are ranked by RMSE, with lower RMSE ranked first.

    All models must have predictions for the same actual observations.
    """

    if not isinstance(model_predictions, dict) or not model_predictions:
        raise ValueError(
            "model_predictions must be a non-empty dictionary."
        )

    actual_values = _to_float_list(actual, "actual")

    comparisons: list[dict[str, Any]] = []

    for model_name, predictions in model_predictions.items():
        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError(
                "Every model must have a non-empty string name."
            )

        metrics = evaluate_predictions(
            actual_values,
            predictions,
            include_details=False,
        )

        comparisons.append(
            {
                "model": model_name,
                "observation_count": metrics["observation_count"],
                "metrics": metrics["metrics"],
            }
        )

    comparisons.sort(
        key=lambda item: (
            item["metrics"]["rmse"] is None,
            (
                item["metrics"]["rmse"]
                if item["metrics"]["rmse"] is not None
                else float("inf")
            ),
        )
    )

    for rank, comparison in enumerate(comparisons, start=1):
        comparison["rank"] = rank

    return {
        "success": True,
        "ranking_metric": "rmse",
        "models_evaluated": len(comparisons),
        "results": comparisons,
        "best_model_by_rmse": (
            comparisons[0]["model"]
            if (
                comparisons
                and comparisons[0]["metrics"]["rmse"] is not None
            )
            else None
        ),
        "disclaimer": (
            "The lowest historical RMSE does not guarantee that a "
            "model will perform best on future market data."
        ),
    }


# ============================================================
# PUBLIC API
# ============================================================

__all__ = [
    "calculate_mae",
    "calculate_mse",
    "calculate_rmse",
    "calculate_mape",
    "calculate_smape",
    "calculate_directional_accuracy",
    "evaluate_predictions",
    "walk_forward_evaluate",
    "compare_prediction_models",
]