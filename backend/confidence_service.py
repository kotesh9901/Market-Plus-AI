"""
Market Plus AI - Prediction Confidence Service

Estimates a prediction reliability score using measurable model evidence.

Important:
    - This is a heuristic reliability indicator, NOT a probability that
      a prediction will be correct.
    - A high score does not guarantee profit or a correct forecast.
    - Missing evaluation evidence reduces the score.
    - The service does not generate stock-price predictions.
"""

from __future__ import annotations

import math
from typing import Any, Iterable


def _finite_number(value: Any) -> float | None:
    """Convert a value to a finite float, or return None."""
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return number if math.isfinite(number) else None


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    """Clamp a numeric score to a defined range."""
    return max(minimum, min(maximum, value))


def _score_label(score: float) -> str:
    """Translate a numeric reliability score into a cautious label."""
    if score >= 80:
        return "stronger historical evidence"
    if score >= 60:
        return "moderate historical evidence"
    if score >= 40:
        return "limited historical evidence"
    return "weak historical evidence"


def calculate_error_score(
    rmse: Any,
    reference_price: Any,
) -> dict[str, Any]:
    """
    Calculate a score based on RMSE relative to a reference price.

    Lower normalized RMSE produces a higher score.

    The score uses a simple linear scale and is not a statistical
    probability or a guarantee of future performance.
    """
    error = _finite_number(rmse)
    price = _finite_number(reference_price)

    if error is None or price is None:
        return {
            "available": False,
            "score": None,
            "normalized_rmse_percent": None,
            "reason": "A valid RMSE and reference price are required.",
        }

    if error < 0:
        return {
            "available": False,
            "score": None,
            "normalized_rmse_percent": None,
            "reason": "RMSE cannot be negative.",
        }

    if price <= 0:
        return {
            "available": False,
            "score": None,
            "normalized_rmse_percent": None,
            "reason": "Reference price must be positive.",
        }

    normalized_error = (error / price) * 100.0

    # 0% normalized RMSE -> 100 points.
    # 10% or higher -> 0 points.
    score = _clamp(100.0 * (1.0 - normalized_error / 10.0))

    return {
        "available": True,
        "score": round(score, 2),
        "normalized_rmse_percent": round(normalized_error, 4),
        "reason": (
            "Score is based on RMSE relative to the supplied reference price."
        ),
    }


def calculate_model_agreement_score(
    predicted_prices: Iterable[Any],
) -> dict[str, Any]:
    """
    Measure agreement among multiple model price estimates.

    Uses population standard deviation divided by the absolute mean,
    expressed as a percentage.

    At least two valid predictions are required.
    """
    try:
        values = [
            number
            for item in predicted_prices
            if (number := _finite_number(item)) is not None
        ]
    except TypeError:
        values = []

    if len(values) < 2:
        return {
            "available": False,
            "score": None,
            "dispersion_percent": None,
            "model_count": len(values),
            "reason": "At least two valid model predictions are required.",
        }

    mean_price = sum(values) / len(values)

    if mean_price == 0:
        return {
            "available": False,
            "score": None,
            "dispersion_percent": None,
            "model_count": len(values),
            "reason": "The mean predicted price cannot be zero.",
        }

    variance = sum(
        (value - mean_price) ** 2 for value in values
    ) / len(values)

    standard_deviation = math.sqrt(variance)

    dispersion_percent = (
        standard_deviation / abs(mean_price)
    ) * 100.0

    # A dispersion of 0% receives 100 points.
    # Dispersion of 5% or greater receives 0 points.
    score = _clamp(100.0 * (1.0 - dispersion_percent / 5.0))

    return {
        "available": True,
        "score": round(score, 2),
        "dispersion_percent": round(dispersion_percent, 4),
        "model_count": len(values),
        "reason": (
            "Score measures agreement among supplied model estimates; "
            "agreement alone does not establish accuracy."
        ),
    }


def calculate_directional_score(
    directional_accuracy: Any,
) -> dict[str, Any]:
    """
    Score historical directional accuracy.

    Accepts either:
        0.0 to 1.0 as a fraction, or
        0 to 100 as a percentage.

    Values from 0 through 1 are interpreted as fractions.
    """
    value = _finite_number(directional_accuracy)

    if value is None or value < 0 or value > 100:
        return {
            "available": False,
            "score": None,
            "reason": "Directional accuracy must be between 0 and 100.",
        }

    percentage = value * 100.0 if value <= 1.0 else value

    return {
        "available": True,
        "score": round(_clamp(percentage), 2),
        "accuracy_percent": round(percentage, 2),
        "reason": (
            "Based on the supplied historical directional-accuracy metric."
        ),
    }


def calculate_confidence(
    *,
    rmse: Any = None,
    reference_price: Any = None,
    model_predictions: Iterable[Any] | None = None,
    directional_accuracy: Any = None,
    validation_sample_count: Any = None,
) -> dict[str, Any]:
    """
    Calculate a heuristic prediction reliability indicator.

    Available components:
        - RMSE normalized by reference price: 45% weight
        - Model agreement: 30% weight
        - Historical directional accuracy: 25% weight

    Only available components are included in the weighted score.
    Missing components are reported rather than silently treated as zero.

    A sample-size adjustment reduces the final score when very little
    historical validation evidence is available.

    Returns a JSON-serializable dictionary.
    """
    components: dict[str, dict[str, Any]] = {
        "historical_error": calculate_error_score(
            rmse,
            reference_price,
        ),
        "model_agreement": calculate_model_agreement_score(
            model_predictions
            if model_predictions is not None
            else []
        ),
        "directional_accuracy": calculate_directional_score(
            directional_accuracy
        ),
    }

    weights = {
        "historical_error": 0.45,
        "model_agreement": 0.30,
        "directional_accuracy": 0.25,
    }

    available_weight = sum(
        weights[name]
        for name, component in components.items()
        if component["available"]
    )

    if available_weight == 0:
        return {
            "status": "insufficient_evidence",
            "score": None,
            "label": "insufficient historical evidence",
            "components": components,
            "available_weight_percent": 0,
            "validation_sample_count": None,
            "warnings": [
                "No valid evaluation evidence was supplied.",
                "A confidence score cannot be calculated responsibly.",
            ],
            "interpretation": (
                "This indicator is not a probability of profit or a "
                "guarantee that the forecast will be accurate."
            ),
        }

    weighted_score = sum(
        weights[name] * component["score"]
        for name, component in components.items()
        if component["available"]
    ) / available_weight

    sample_count = _finite_number(validation_sample_count)
    warnings: list[str] = []

    if sample_count is None:
        warnings.append(
            "The historical validation sample count is unavailable."
        )
        sample_factor = 0.80
    elif sample_count < 0:
        sample_count = None
        sample_factor = 0.80
        warnings.append(
            "The validation sample count was invalid and was not used."
        )
    elif sample_count < 10:
        sample_factor = 0.50
        warnings.append(
            "Fewer than 10 validation observations are available."
        )
    elif sample_count < 30:
        sample_factor = 0.70
        warnings.append(
            "The validation sample is small; reliability may be unstable."
        )
    elif sample_count < 100:
        sample_factor = 0.85
        warnings.append(
            "The validation sample is moderate in size."
        )
    else:
        sample_factor = 1.0

    # Missing evidence is separately penalized through available_weight.
    evidence_factor = 0.70 + 0.30 * available_weight

    final_score = _clamp(
        weighted_score * sample_factor * evidence_factor
    )

    if len(components) != sum(
        1 for component in components.values()
        if component["available"]
    ):
        warnings.append(
            "Some confidence components are missing. The result uses "
            "only the available components."
        )

    return {
        "status": "calculated",
        "score": round(final_score, 2),
        "label": _score_label(final_score),
        "components": components,
        "available_weight_percent": round(
            available_weight * 100.0, 2
        ),
        "validation_sample_count": (
            int(sample_count)
            if sample_count is not None
            and sample_count.is_integer()
            else sample_count
        ),
        "warnings": warnings,
        "interpretation": (
            "This is a heuristic reliability indicator derived from "
            "historical evaluation evidence. It is not a probability "
            "of profit, and it does not guarantee future accuracy."
        ),
    }