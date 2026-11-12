"""
Market Plus AI — Investment Scenario Simulator
Version: 1.0.0

Provides hypothetical investment calculations:
- Estimated units purchasable
- Estimated profit and loss
- Return percentage
- Target-price calculations
- Scenario comparisons
- Optional transaction-cost estimates

This module performs arithmetic only. It does not predict prices,
execute trades, or guarantee investment returns.

All prices and investment amounts must use the same currency.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


# ============================================================
# VALIDATION
# ============================================================

def _finite_number(value: Any, field: str) -> float:
    """Convert a value to a finite floating-point number."""

    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{field} must be a valid number.") from exc

    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite.")

    return result


def _positive_number(value: Any, field: str) -> float:
    """Validate a strictly positive number."""

    result = _finite_number(value, field)

    if result <= 0:
        raise ValueError(f"{field} must be greater than zero.")

    return result


def _non_negative_number(value: Any, field: str) -> float:
    """Validate a non-negative number."""

    result = _finite_number(value, field)

    if result < 0:
        raise ValueError(f"{field} cannot be negative.")

    return result


def _round(value: float, digits: int = 2) -> float:
    """Round a numeric result for display."""

    return round(value, digits)


def _validate_cost_rate(
    cost_rate_percent: Any,
) -> float:
    """
    Validate a transaction-cost percentage.

    The value is expressed as a percentage:
        0.5 means 0.5%, not 50%.
    """

    rate = _non_negative_number(
        cost_rate_percent,
        "cost_rate_percent",
    )

    if rate >= 100:
        raise ValueError(
            "cost_rate_percent must be less than 100."
        )

    return rate / 100.0


# ============================================================
# PURCHASE ESTIMATE
# ============================================================

def calculate_purchase(
    investment_amount: Any,
    purchase_price: Any,
    transaction_cost_percent: Any = 0,
) -> dict[str, Any]:
    """
    Estimate how many units can be purchased.

    Transaction costs are modeled as a percentage of the amount
    invested in the asset.

    Fractional units are allowed in the calculation. Actual brokers
    may require whole shares or apply different fee structures.
    """

    try:
        amount = _positive_number(
            investment_amount,
            "investment_amount",
        )
        price = _positive_number(
            purchase_price,
            "purchase_price",
        )
        cost_rate = _validate_cost_rate(
            transaction_cost_percent
        )
    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }

    asset_budget = amount / (1.0 + cost_rate)
    units = asset_budget / price
    asset_cost = units * price
    transaction_cost = asset_cost * cost_rate
    total_cost = asset_cost + transaction_cost

    return {
        "success": True,
        "investment_amount": _round(amount),
        "purchase_price": _round(price, 4),
        "estimated_units": round(units, 8),
        "asset_cost": _round(asset_cost),
        "estimated_transaction_cost": _round(
            transaction_cost
        ),
        "estimated_total_cost": _round(total_cost),
        "transaction_cost_percent": _round(
            cost_rate * 100,
            4,
        ),
        "assumptions": [
            "The supplied purchase price is used as the execution price.",
            "Fractional units are permitted by this calculation.",
            "Taxes, exchange fees, slippage, and other charges are "
            "excluded unless represented by the supplied cost rate.",
        ],
    }


# ============================================================
# PROFIT AND LOSS ESTIMATE
# ============================================================

def calculate_profit_loss(
    investment_amount: Any,
    purchase_price: Any,
    exit_price: Any,
    transaction_cost_percent: Any = 0,
) -> dict[str, Any]:
    """
    Estimate hypothetical profit or loss.

    The transaction-cost percentage is applied to both the purchase
    and exit asset values.

    The initial investment amount includes purchase-side costs.
    """

    try:
        amount = _positive_number(
            investment_amount,
            "investment_amount",
        )
        buy_price = _positive_number(
            purchase_price,
            "purchase_price",
        )
        sell_price = _positive_number(
            exit_price,
            "exit_price",
        )
        cost_rate = _validate_cost_rate(
            transaction_cost_percent
        )
    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }

    units = amount / (buy_price * (1.0 + cost_rate))

    purchase_value = units * buy_price
    purchase_cost = purchase_value * cost_rate
    total_purchase_cost = purchase_value + purchase_cost

    exit_value = units * sell_price
    exit_cost = exit_value * cost_rate
    net_exit_value = exit_value - exit_cost

    profit_loss = net_exit_value - total_purchase_cost
    return_percent = (
        profit_loss / total_purchase_cost
    ) * 100.0

    if profit_loss > 0:
        outcome = "profit"
    elif profit_loss < 0:
        outcome = "loss"
    else:
        outcome = "break_even"

    return {
        "success": True,
        "investment_amount": _round(amount),
        "purchase_price": _round(buy_price, 4),
        "exit_price": _round(sell_price, 4),
        "estimated_units": round(units, 8),
        "purchase_asset_value": _round(purchase_value),
        "purchase_transaction_cost": _round(
            purchase_cost
        ),
        "exit_asset_value": _round(exit_value),
        "exit_transaction_cost": _round(exit_cost),
        "net_exit_value": _round(net_exit_value),
        "total_purchase_cost": _round(
            total_purchase_cost
        ),
        "estimated_profit_loss": _round(profit_loss),
        "estimated_return_percent": _round(
            return_percent,
            4,
        ),
        "outcome": outcome,
        "transaction_cost_percent": _round(
            cost_rate * 100,
            4,
        ),
        "disclaimer": (
            "This is a hypothetical calculation, not a price forecast. "
            "Actual execution prices, taxes, fees, and market conditions "
            "may change the result."
        ),
    }


# ============================================================
# TARGET PRICE CALCULATION
# ============================================================

def calculate_target_price(
    purchase_price: Any,
    target_profit_percent: Any,
    transaction_cost_percent: Any = 0,
) -> dict[str, Any]:
    """
    Calculate the exit price needed for a desired profit percentage.

    The target profit percentage is measured against the total
    purchase cost, including the modeled purchase transaction cost.

    The modeled exit transaction cost is also included.
    """

    try:
        buy_price = _positive_number(
            purchase_price,
            "purchase_price",
        )
        profit_target = _finite_number(
            target_profit_percent,
            "target_profit_percent",
        )
        cost_rate = _validate_cost_rate(
            transaction_cost_percent
        )
    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }

    if profit_target <= -100:
        return {
            "success": False,
            "error": (
                "target_profit_percent must be greater than -100."
            ),
        }

    target_multiplier = 1.0 + profit_target / 100.0

    # For one unit:
    # Total purchase cost = buy_price * (1 + cost_rate)
    # Net exit value = exit_price * (1 - cost_rate)
    # Required net exit value = purchase cost * target_multiplier
    required_exit_price = (
        buy_price
        * (1.0 + cost_rate)
        * target_multiplier
        / (1.0 - cost_rate)
    )

    return {
        "success": True,
        "purchase_price": _round(buy_price, 4),
        "target_profit_percent": _round(
            profit_target,
            4,
        ),
        "estimated_target_exit_price": _round(
            required_exit_price,
            4,
        ),
        "transaction_cost_percent": _round(
            cost_rate * 100,
            4,
        ),
        "explanation": (
            "This is the theoretical exit price needed to reach the "
            "requested return under the supplied transaction-cost "
            "assumption. It does not mean the market will reach it."
        ),
    }


# ============================================================
# PRICE SCENARIO COMPARISON
# ============================================================

def compare_price_scenarios(
    investment_amount: Any,
    purchase_price: Any,
    scenarios: Mapping[str, Any],
    transaction_cost_percent: Any = 0,
) -> dict[str, Any]:
    """
    Compare hypothetical exit-price scenarios.

    Example:
        scenarios={
            "pessimistic": 95,
            "baseline": 105,
            "optimistic": 115,
        }

    The caller must supply the scenario prices. This function does
    not generate forecasts or assign probabilities to scenarios.
    """

    if not isinstance(scenarios, Mapping) or not scenarios:
        return {
            "success": False,
            "error": (
                "scenarios must be a non-empty mapping of names "
                "to hypothetical exit prices."
            ),
        }

    results: list[dict[str, Any]] = []

    for scenario_name, scenario_price in scenarios.items():
        if (
            not isinstance(scenario_name, str)
            or not scenario_name.strip()
        ):
            return {
                "success": False,
                "error": (
                    "Every scenario must have a non-empty name."
                ),
            }

        result = calculate_profit_loss(
            investment_amount=investment_amount,
            purchase_price=purchase_price,
            exit_price=scenario_price,
            transaction_cost_percent=transaction_cost_percent,
        )

        if not result["success"]:
            return {
                "success": False,
                "error": (
                    f"Scenario '{scenario_name}' is invalid: "
                    f"{result['error']}"
                ),
            }

        results.append(
            {
                "scenario": scenario_name,
                "exit_price": result["exit_price"],
                "estimated_profit_loss": (
                    result["estimated_profit_loss"]
                ),
                "estimated_return_percent": (
                    result["estimated_return_percent"]
                ),
                "outcome": result["outcome"],
            }
        )

    results.sort(
        key=lambda item: item["estimated_profit_loss"]
    )

    return {
        "success": True,
        "scenario_count": len(results),
        "scenarios": results,
        "best_case_in_supplied_scenarios": results[-1],
        "worst_case_in_supplied_scenarios": results[0],
        "disclaimer": (
            "These are hypothetical scenarios, not probability-weighted "
            "forecasts. The best and worst cases refer only to the "
            "scenario prices supplied by the caller."
        ),
    }


# ============================================================
# COMPLETE SCENARIO REPORT
# ============================================================

def build_scenario_report(
    investment_amount: Any,
    current_price: Any,
    predicted_price: Any,
    withdrawal_target_price: Any | None = None,
    transaction_cost_percent: Any = 0,
) -> dict[str, Any]:
    """
    Build a scenario report using supplied prices.

    Includes:
    - Purchase estimate
    - Hypothetical outcome at the model's predicted price
    - Optional outcome at the user's desired withdrawal price

    The predicted price is treated only as an input. This function
    does not evaluate whether the model's prediction is accurate.
    """

    try:
        amount = _positive_number(
            investment_amount,
            "investment_amount",
        )
        current = _positive_number(
            current_price,
            "current_price",
        )
        predicted = _positive_number(
            predicted_price,
            "predicted_price",
        )
        cost_rate = _non_negative_number(
            transaction_cost_percent,
            "transaction_cost_percent",
        )

        if cost_rate >= 100:
            raise ValueError(
                "transaction_cost_percent must be less than 100."
            )

    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }

    purchase = calculate_purchase(
        investment_amount=amount,
        purchase_price=current,
        transaction_cost_percent=cost_rate,
    )

    predicted_outcome = calculate_profit_loss(
        investment_amount=amount,
        purchase_price=current,
        exit_price=predicted,
        transaction_cost_percent=cost_rate,
    )

    if not purchase["success"]:
        return purchase

    if not predicted_outcome["success"]:
        return predicted_outcome

    report: dict[str, Any] = {
        "success": True,
        "investment_amount": _round(amount),
        "current_price": _round(current, 4),
        "predicted_price": _round(predicted, 4),
        "purchase_estimate": purchase,
        "predicted_price_scenario": predicted_outcome,
        "disclaimer": (
            "The predicted-price scenario is hypothetical. It is not "
            "a guarantee that the predicted price will be reached."
        ),
    }

    if withdrawal_target_price is not None:
        target = _finite_number(
            withdrawal_target_price,
            "withdrawal_target_price",
        )

        if target is None or target <= 0:
            return {
                "success": False,
                "error": (
                    "withdrawal_target_price must be greater than zero."
                ),
            }

        target_outcome = calculate_profit_loss(
            investment_amount=amount,
            purchase_price=current,
            exit_price=target,
            transaction_cost_percent=cost_rate,
        )

        if not target_outcome["success"]:
            return target_outcome

        report["withdrawal_target_scenario"] = target_outcome

    return report


# ============================================================
# PUBLIC API
# ============================================================

__all__ = [
    "calculate_purchase",
    "calculate_profit_loss",
    "calculate_target_price",
    "compare_price_scenarios",
    "build_scenario_report",
]