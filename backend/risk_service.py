"""
Market Plus AI — Risk Analysis Service
Version: 1.0.0

Provides descriptive historical risk measurements:
- Historical volatility
- Maximum drawdown
- Historical downside frequency
- Optional prediction uncertainty
- Transparent rule-based risk classification
- Comparison with a user's selected risk preference

This service does not guarantee future risk or returns.

Design:
- Pure Python; no paid APIs or cloud services required.
- No database or Flask dependency.
- Designed to be integrated with the existing application later.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Mapping, Sequence
from typing import Any


# ============================================================
# VALIDATION
# ============================================================

VALID_RISK_CATEGORIES = {"low", "middle", "high"}


def _finite_number(value: Any) -> float | None:
    """Convert a value to a finite float, or return None."""

    if value is None:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    if not math.isfinite(number):
        return None

    return number


def _number_list(
    values: Sequence[Any],
    field_name: str,
) -> list[float]:
    """Validate and convert a sequence of finite numbers."""

    if isinstance(values, (str, bytes)):
        raise ValueError(f"{field_name} must be a sequence of numbers.")

    try:
        converted = [float(value) for value in values]
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(
            f"{field_name} contains an invalid numeric value."
        ) from exc

    if not all(math.isfinite(value) for value in converted):
        raise ValueError(
            f"{field_name} must contain only finite numbers."
        )

    return converted


def _round(value: float | None, digits: int = 6) -> float | None:
    """Round finite numbers for API-friendly output."""

    if value is None or not math.isfinite(value):
        return None

    return round(value, digits)


def _validate_prices(
    prices: Sequence[Any],
) -> list[float]:
    """Validate historical prices."""

    values = _number_list(prices, "prices")

    if len(values) < 2:
        raise ValueError(
            "At least two historical prices are required."
        )

    if any(value <= 0 for value in values):
        raise ValueError(
            "Historical prices must be greater than zero."
        )

    return values


# ============================================================
# HISTORICAL RETURNS
# ============================================================

def calculate_returns(
    prices: Sequence[Any],
) -> list[float]:
    """
    Calculate simple percentage returns from chronological prices.

    The input must be ordered oldest to newest.

    Example:
        [100, 105, 102]
        -> [0.05, -0.028571...]

    Returns are decimals, not percentages.
    """

    values = _validate_prices(prices)

    return [
        (current / previous) - 1.0
        for previous, current in zip(values[:-1], values[1:])
    ]


# ============================================================
# HISTORICAL VOLATILITY
# ============================================================

def calculate_historical_volatility(
    prices: Sequence[Any],
    periods_per_year: int = 252,
) -> dict[str, Any]:
    """
    Estimate historical volatility from simple daily returns.

    Annualized volatility:
        sample standard deviation of returns * sqrt(periods_per_year)

    This assumes equally spaced observations and is conventionally
    used with daily market observations when periods_per_year=252.

    It is a historical estimate, not a forecast of future volatility.
    """

    if (
        not isinstance(periods_per_year, int)
        or isinstance(periods_per_year, bool)
        or periods_per_year <= 0
    ):
        raise ValueError(
            "periods_per_year must be a positive integer."
        )

    returns = calculate_returns(prices)

    if len(returns) < 2:
        return {
            "success": False,
            "error": (
                "At least three prices are needed to estimate "
                "sample volatility."
            ),
        }

    daily_volatility = statistics.stdev(returns)
    annualized_volatility = (
        daily_volatility * math.sqrt(periods_per_year)
    )

    return {
        "success": True,
        "return_observations": len(returns),
        "daily_volatility_percent": _round(
            daily_volatility * 100
        ),
        "annualized_volatility_percent": _round(
            annualized_volatility * 100
        ),
        "periods_per_year": periods_per_year,
        "method": "sample_standard_deviation_of_simple_returns",
        "interpretation": (
            "Historical volatility describes variation in past "
            "returns. It does not predict the direction of future prices."
        ),
    }


# ============================================================
# MAXIMUM DRAWDOWN
# ============================================================

def calculate_max_drawdown(
    prices: Sequence[Any],
) -> dict[str, Any]:
    """
    Calculate the largest peak-to-trough percentage decline.

    Input prices must be ordered oldest to newest.

    Maximum drawdown is returned as a positive percentage.
    The associated peak and trough prices are also reported.
    """

    values = _validate_prices(prices)

    peak_price = values[0]
    peak_index = 0

    maximum_drawdown = 0.0
    maximum_peak = peak_price
    maximum_trough = peak_price
    maximum_peak_index = 0
    maximum_trough_index = 0

    for index, price in enumerate(values):
        if price > peak_price:
            peak_price = price
            peak_index = index

        drawdown = (peak_price - price) / peak_price

        if drawdown > maximum_drawdown:
            maximum_drawdown = drawdown
            maximum_peak = peak_price
            maximum_trough = price
            maximum_peak_index = peak_index
            maximum_trough_index = index

    return {
        "success": True,
        "maximum_drawdown_percent": _round(
            maximum_drawdown * 100
        ),
        "peak_price": _round(maximum_peak, 4),
        "trough_price": _round(maximum_trough, 4),
        "peak_index": maximum_peak_index,
        "trough_index": maximum_trough_index,
        "observation_count": len(values),
        "interpretation": (
            "Maximum drawdown measures the largest observed "
            "peak-to-trough decline in the supplied historical period."
        ),
    }


# ============================================================
# DOWNSIDE FREQUENCY
# ============================================================

def calculate_downside_statistics(
    prices: Sequence[Any],
) -> dict[str, Any]:
    """
    Summarize negative returns in the supplied historical period.

    Reports:
    - Number of return observations
    - Number and percentage of negative returns
    - Mean negative return
    - Worst observed return

    These are descriptive historical statistics.
    """

    returns = calculate_returns(prices)

    negative_returns = [
        value for value in returns if value < 0
    ]

    negative_count = len(negative_returns)
    total_count = len(returns)

    mean_negative_return = (
        statistics.mean(negative_returns)
        if negative_returns
        else None
    )

    worst_return = min(returns)

    return {
        "success": True,
        "return_observations": total_count,
        "negative_return_observations": negative_count,
        "negative_return_frequency_percent": _round(
            negative_count / total_count * 100
        ),
        "mean_negative_return_percent": _round(
            mean_negative_return * 100
            if mean_negative_return is not None
            else None
        ),
        "worst_observed_return_percent": _round(
            worst_return * 100
        ),
        "interpretation": (
            "Historical downside frequency shows how often the "
            "observed returns were negative. It is not the probability "
            "of a future loss."
        ),
    }


# ============================================================
# RULE-BASED RISK CLASSIFICATION
# ============================================================

def classify_historical_risk(
    annualized_volatility_percent: Any,
    maximum_drawdown_percent: Any,
) -> dict[str, Any]:
    """
    Assign a transparent descriptive risk category.

    The thresholds are application heuristics, not validated
    investment suitability thresholds.

    Classification:
        HIGH:
            Annualized volatility >= 40%, or maximum drawdown >= 30%.

        MEDIUM:
            Annualized volatility >= 20%, or maximum drawdown >= 15%.

        LOW:
            Both measurements are below the medium thresholds.

    If either measurement is unavailable, classification is
    unavailable because both measurements are required.
    """

    volatility = _finite_number(
        annualized_volatility_percent
    )
    drawdown = _finite_number(maximum_drawdown_percent)

    if volatility is None or drawdown is None:
        return {
            "success": False,
            "risk_level": "unavailable",
            "error": (
                "Both annualized volatility and maximum drawdown "
                "are required for this classification."
            ),
        }

    if volatility < 0 or drawdown < 0:
        return {
            "success": False,
            "risk_level": "unavailable",
            "error": (
                "Volatility and maximum drawdown must be "
                "non-negative percentages."
            ),
        }

    reasons: list[str] = []

    if volatility >= 40:
        reasons.append(
            "Annualized historical volatility is at least 40%."
        )

    if drawdown >= 30:
        reasons.append(
            "Historical maximum drawdown is at least 30%."
        )

    if reasons:
        level = "high"
    elif volatility >= 20 or drawdown >= 15:
        level = "medium"

        if volatility >= 20:
            reasons.append(
                "Annualized historical volatility is at least 20%."
            )

        if drawdown >= 15:
            reasons.append(
                "Historical maximum drawdown is at least 15%."
            )
    else:
        level = "low"
        reasons.append(
            "Both measurements are below the configured medium-risk "
            "thresholds for this application."
        )

    return {
        "success": True,
        "risk_level": level,
        "measurements": {
            "annualized_volatility_percent": _round(volatility),
            "maximum_drawdown_percent": _round(drawdown),
        },
        "reasons": reasons,
        "classification_method": "transparent_rule_based_heuristic",
        "thresholds": {
            "medium_volatility_percent": 20,
            "high_volatility_percent": 40,
            "medium_drawdown_percent": 15,
            "high_drawdown_percent": 30,
        },
        "warning": (
            "This classification is an application heuristic, not "
            "a validated forecast, regulatory risk rating, or personal "
            "investment recommendation."
        ),
    }


# ============================================================
# USER RISK-PREFERENCE COMPARISON
# ============================================================

def compare_user_risk_preference(
    historical_risk_level: str,
    user_risk_category: str,
) -> dict[str, Any]:
    """
    Compare a historical risk classification with the user's
    selected risk preference.

    The comparison is informational only. It does not determine
    whether an asset is suitable for the user.
    """

    historical_level = (
        str(historical_risk_level).strip().lower()
        if historical_risk_level is not None
        else ""
    )

    user_category = (
        str(user_risk_category).strip().lower()
        if user_risk_category is not None
        else ""
    )

    valid_levels = {"low", "medium", "high"}

    if historical_level not in valid_levels:
        return {
            "success": False,
            "error": (
                "historical_risk_level must be low, medium, or high."
            ),
        }

    if user_category not in VALID_RISK_CATEGORIES:
        return {
            "success": False,
            "error": (
                "user_risk_category must be low, middle, or high."
            ),
        }

    # The account uses "middle"; historical classification uses
    # "medium". Normalize these equivalent labels for comparison.
    normalized_user_category = (
        "medium" if user_category == "middle" else user_category
    )

    levels = {
        "low": 1,
        "medium": 2,
        "high": 3,
    }

    difference = (
        levels[historical_level]
        - levels[normalized_user_category]
    )

    if difference > 0:
        alignment = "above_selected_preference"
        message = (
            "The asset's historical risk classification is above "
            "the selected risk preference. Review its downside history "
            "carefully."
        )
    elif difference < 0:
        alignment = "below_selected_preference"
        message = (
            "The asset's historical risk classification is below "
            "the selected risk preference. This does not mean that "
            "future losses are impossible."
        )
    else:
        alignment = "same_category"
        message = (
            "The historical classification matches the selected "
            "risk category. This does not establish personal suitability."
        )

    return {
        "success": True,
        "historical_risk_level": historical_level,
        "user_risk_category": user_category,
        "alignment": alignment,
        "message": message,
        "disclaimer": (
            "Risk preferences alone are insufficient to determine "
            "whether an investment is suitable for an individual."
        ),
    }


# ============================================================
# COMBINED RISK REPORT
# ============================================================

def analyze_historical_risk(
    prices: Sequence[Any],
    user_risk_category: str | None = None,
    periods_per_year: int = 252,
) -> dict[str, Any]:
    """
    Generate a combined historical risk report.

    The function uses only the supplied historical prices.

    Required:
        At least three valid, positive, chronological prices.

    Optional:
        user_risk_category: low, middle, or high.

    No future price is inferred by this function.
    """

    try:
        values = _validate_prices(prices)
    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }

    volatility_result = calculate_historical_volatility(
        values,
        periods_per_year=periods_per_year,
    )

    drawdown_result = calculate_max_drawdown(values)

    downside_result = calculate_downside_statistics(values)

    if not volatility_result.get("success"):
        return {
            "success": False,
            "error": volatility_result.get(
                "error",
                "Unable to calculate historical volatility.",
            ),
        }

    volatility = volatility_result[
        "annualized_volatility_percent"
    ]

    drawdown = drawdown_result[
        "maximum_drawdown_percent"
    ]

    classification = classify_historical_risk(
        volatility,
        drawdown,
    )

    if not classification.get("success"):
        return {
            "success": False,
            "error": classification.get(
                "error",
                "Unable to classify historical risk.",
            ),
        }

    result: dict[str, Any] = {
        "success": True,
        "observation_count": len(values),
        "historical_volatility": volatility_result,
        "maximum_drawdown": drawdown_result,
        "downside_statistics": downside_result,
        "classification": classification,
        "limitations": [
            "Historical risk measurements can change over time.",
            "Past volatility and drawdown do not predict future losses.",
            "The calculation excludes transaction costs, taxes, and liquidity.",
            "The classification thresholds are heuristics and have not "
            "been validated as personal investment suitability criteria.",
        ],
        "disclaimer": (
            "For educational purposes only. This report is not "
            "financial advice and does not guarantee future outcomes."
        ),
    }

    if user_risk_category is not None:
        result["risk_preference_comparison"] = (
            compare_user_risk_preference(
                classification["risk_level"],
                user_risk_category,
            )
        )

    return result


# ============================================================
# PUBLIC API
# ============================================================

__all__ = [
    "calculate_returns",
    "calculate_historical_volatility",
    "calculate_max_drawdown",
    "calculate_downside_statistics",
    "classify_historical_risk",
    "compare_user_risk_preference",
    "analyze_historical_risk",
]