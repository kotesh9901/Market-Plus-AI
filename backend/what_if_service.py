
"""
What-If Market scenario calculator for Market Plus AI.

Features:
- Dynamic stock lookup through the existing stock service.
- Current market price as the default entry price.
- Custom investment amount and entry price.
- Optimistic, neutral, pessimistic and custom scenarios.
- Estimated quantity, final value, profit/loss and ROI.
- Strict input validation and safe numeric handling.
- No hard-coded stock symbols.
- No paid cloud services or external AI dependency.

Important:
This service performs hypothetical mathematical calculations.
It does not predict future prices or execute trades.
"""

from __future__ import annotations

import logging
import math
import re

from typing import Any

from backend.stock_service import (
    StockServiceError,
    get_stock_details,
)


logger = logging.getLogger(__name__)


# =========================================================
# CONFIGURATION
# =========================================================

DEFAULT_SCENARIOS = {
    "optimistic": 15.0,
    "neutral": 0.0,
    "pessimistic": -15.0,
}

MIN_INVESTMENT = 0.01
MAX_INVESTMENT = 1_000_000_000_000.0

MIN_ENTRY_PRICE = 0.000001
MAX_ENTRY_PRICE = 1_000_000_000_000.0

MIN_SCENARIO_CHANGE = -99.99
MAX_SCENARIO_CHANGE = 1000.0

MAX_CUSTOM_SCENARIOS = 5

SCENARIO_NAME_PATTERN = re.compile(
    r"^[a-zA-Z][a-zA-Z0-9 _-]{0,29}$"
)


class WhatIfServiceError(Exception):
    """Raised when a What-If Market operation fails."""


# =========================================================
# VALIDATION HELPERS
# =========================================================

def _to_number(
    value: Any,
    field_name: str,
) -> float:
    """Convert a supplied value into a finite float."""

    if isinstance(value, bool) or value is None:
        raise WhatIfServiceError(
            f"{field_name} must be a valid number."
        )

    try:
        number = float(value)

    except (TypeError, ValueError, OverflowError) as exc:
        raise WhatIfServiceError(
            f"{field_name} must be a valid number."
        ) from exc

    if not math.isfinite(number):
        raise WhatIfServiceError(
            f"{field_name} must be a finite number."
        )

    return number


def _validate_investment_amount(
    investment_amount: Any,
) -> float:
    """Validate the hypothetical investment amount."""

    amount = _to_number(
        investment_amount,
        "Investment amount",
    )

    if amount < MIN_INVESTMENT:
        raise WhatIfServiceError(
            "Investment amount must be greater than zero."
        )

    if amount > MAX_INVESTMENT:
        raise WhatIfServiceError(
            "Investment amount exceeds the supported limit."
        )

    return amount


def _validate_entry_price(
    entry_price: Any,
) -> float:
    """Validate the hypothetical buying price."""

    price = _to_number(
        entry_price,
        "Entry price",
    )

    if price < MIN_ENTRY_PRICE:
        raise WhatIfServiceError(
            "Entry price must be greater than zero."
        )

    if price > MAX_ENTRY_PRICE:
        raise WhatIfServiceError(
            "Entry price exceeds the supported limit."
        )

    return price


def _validate_scenario_change(
    change: Any,
    scenario_name: str,
) -> float:
    """Validate a scenario's assumed percentage movement."""

    percentage = _to_number(
        change,
        f"{scenario_name} percentage change",
    )

    if not (
        MIN_SCENARIO_CHANGE
        <= percentage
        <= MAX_SCENARIO_CHANGE
    ):
        raise WhatIfServiceError(
            f"{scenario_name} percentage change must "
            f"be between {MIN_SCENARIO_CHANGE}% "
            f"and {MAX_SCENARIO_CHANGE}%."
        )

    return percentage


def _validate_scenario_name(
    name: Any,
) -> str:
    """Validate and normalize a scenario name."""

    if not isinstance(name, str):
        raise WhatIfServiceError(
            "Scenario names must be text."
        )

    normalized = name.strip()

    if not SCENARIO_NAME_PATTERN.fullmatch(normalized):
        raise WhatIfServiceError(
            "Scenario names must contain 1–30 letters, "
            "numbers, spaces, underscores or hyphens, "
            "and must start with a letter."
        )

    return normalized


def _round(
    value: float,
    digits: int = 4,
) -> float:
    """Round a finite calculation result."""

    result = round(float(value), digits)

    if not math.isfinite(result):
        raise WhatIfServiceError(
            "The calculation produced an invalid result."
        )

    return result


# =========================================================
# SCENARIO CONFIGURATION
# =========================================================

def _build_scenarios(
    scenario_changes: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Build scenario definitions.

    When no custom scenario mapping is supplied, the service
    uses three default hypothetical scenarios.

    Supplying scenario_changes replaces the default scenarios.
    This allows the frontend to send custom scenario sets.
    """

    if scenario_changes is None:
        scenario_changes = DEFAULT_SCENARIOS.copy()

    if not isinstance(scenario_changes, dict):
        raise WhatIfServiceError(
            "Scenario changes must be supplied as an object."
        )

    if not scenario_changes:
        raise WhatIfServiceError(
            "At least one scenario is required."
        )

    if len(scenario_changes) > MAX_CUSTOM_SCENARIOS:
        raise WhatIfServiceError(
            f"A maximum of {MAX_CUSTOM_SCENARIOS} "
            "scenarios is supported."
        )

    scenarios = []
    seen_names = set()

    for raw_name, raw_change in scenario_changes.items():

        name = _validate_scenario_name(raw_name)

        normalized_name = name.lower()

        if normalized_name in seen_names:
            raise WhatIfServiceError(
                "Scenario names must be unique."
            )

        seen_names.add(normalized_name)

        percentage = _validate_scenario_change(
            raw_change,
            name,
        )

        scenarios.append(
            {
                "name": name,
                "change_percent": percentage,
            }
        )

    return scenarios


# =========================================================
# SCENARIO CALCULATIONS
# =========================================================

def _calculate_scenario(
    *,
    name: str,
    change_percent: float,
    investment_amount: float,
    entry_price: float,
    quantity: float,
    currency: str,
) -> dict[str, Any]:
    """Calculate the hypothetical result of one scenario."""

    multiplier = 1 + (
        change_percent / 100
    )

    future_price = entry_price * multiplier

    if (
        not math.isfinite(future_price)
        or future_price <= 0
    ):
        raise WhatIfServiceError(
            f"The calculated future price for {name} "
            "is invalid."
        )

    final_value = quantity * future_price

    profit_loss = final_value - investment_amount

    return_percent = (
        profit_loss / investment_amount
    ) * 100

    return {
        "name": name,

        "change_percent": _round(
            change_percent,
            2,
        ),

        "assumed_future_price": _round(
            future_price,
        ),

        "quantity": _round(
            quantity,
            8,
        ),

        "investment_amount": _round(
            investment_amount,
        ),

        "estimated_final_value": _round(
            final_value,
        ),

        "profit_loss": _round(
            profit_loss,
        ),

        "return_percent": _round(
            return_percent,
            2,
        ),

        "currency": currency,

        "outcome": (
            "profit"
            if profit_loss > 0
            else "loss"
            if profit_loss < 0
            else "break_even"
        ),
    }


# =========================================================
# MAIN WHAT-IF CALCULATOR
# =========================================================

def calculate_what_if_scenarios(
    symbol: str,
    investment_amount: Any,
    entry_price: Any = None,
    scenario_changes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Calculate hypothetical investment scenarios.

    Args:
        symbol:
            A supported Yahoo Finance ticker symbol.

        investment_amount:
            Amount the user hypothetically invests.

        entry_price:
            Hypothetical buying price. When omitted,
            the latest available market price is used.

        scenario_changes:
            Optional mapping of scenario names to assumed
            percentage movements.

            Example:
                {
                    "optimistic": 20,
                    "neutral": 5,
                    "pessimistic": -10,
                    "custom": 12
                }

            If omitted, the defaults are:
                optimistic: +15%
                neutral: 0%
                pessimistic: -15%

    Returns:
        A JSON-compatible dictionary containing:
        - Stock information.
        - Investment details.
        - Current market value.
        - Current hypothetical profit/loss.
        - Scenario calculations.
        - Calculation assumptions and disclaimer.

    Notes:
        - Fractional quantities are used for mathematical
          comparison, even where fractional stock ownership
          may not be supported by a broker.
        - Brokerage, taxes, slippage, dividends and other
          charges are not included.
        - Future scenario prices are user-defined assumptions,
          not AI-generated predictions.
    """

    # -----------------------------------------------------
    # Validate user inputs
    # -----------------------------------------------------

    amount = _validate_investment_amount(
        investment_amount
    )

    # -----------------------------------------------------
    # Retrieve current stock information
    # -----------------------------------------------------

    if not isinstance(symbol, str) or not symbol.strip():
        raise WhatIfServiceError(
            "Please provide a valid stock symbol."
        )

    try:
        stock = get_stock_details(
            symbol.strip()
        )

    except StockServiceError as exc:
        raise WhatIfServiceError(
            str(exc)
        ) from exc

    except Exception as exc:

        logger.exception(
            "What-If stock lookup failed for %s",
            symbol,
        )

        raise WhatIfServiceError(
            "Could not retrieve the stock's market price. "
            "Please try again later."
        ) from exc

    current_price = _to_number(
        stock.get("last_price"),
        "Current market price",
    )

    if current_price <= 0:
        raise WhatIfServiceError(
            "The stock does not currently have a usable market price."
        )

    # -----------------------------------------------------
    # Resolve hypothetical entry price
    # -----------------------------------------------------

    if entry_price is None or entry_price == "":
        buying_price = current_price
        entry_price_source = "current_market_price"

    else:
        buying_price = _validate_entry_price(
            entry_price
        )

        entry_price_source = "user_supplied"

    # -----------------------------------------------------
    # Calculate investment quantity
    # -----------------------------------------------------

    quantity = amount / buying_price

    if not math.isfinite(quantity) or quantity <= 0:
        raise WhatIfServiceError(
            "Could not calculate the hypothetical share quantity."
        )

    # -----------------------------------------------------
    # Current market valuation
    # -----------------------------------------------------

    current_value = quantity * current_price

    current_profit_loss = current_value - amount

    current_return_percent = (
        current_profit_loss / amount
    ) * 100

    if not all(
        math.isfinite(value)
        for value in (
            current_value,
            current_profit_loss,
            current_return_percent,
        )
    ):
        raise WhatIfServiceError(
            "Current market valuation produced invalid results."
        )

    # -----------------------------------------------------
    # Calculate scenarios
    # -----------------------------------------------------

    scenario_definitions = _build_scenarios(
        scenario_changes
    )

    currency = str(
        stock.get("currency") or ""
    ).strip().upper()

    results = []

    for scenario in scenario_definitions:

        result = _calculate_scenario(
            name=scenario["name"],
            change_percent=scenario["change_percent"],
            investment_amount=amount,
            entry_price=buying_price,
            quantity=quantity,
            currency=currency,
        )

        results.append(result)

    # -----------------------------------------------------
    # Identify best and worst scenarios
    # -----------------------------------------------------

    best_scenario = max(
        results,
        key=lambda item: item["profit_loss"],
    )

    worst_scenario = min(
        results,
        key=lambda item: item["profit_loss"],
    )

    # -----------------------------------------------------
    # Final response
    # -----------------------------------------------------

    return {
        "success": True,

        "service": "Market Plus AI What-If Market",

        "symbol": stock.get("symbol"),

        "stock_name": stock.get("name"),

        "exchange": stock.get("exchange"),

        "currency": currency,

        "market_data": {
            "current_price": _round(
                current_price
            ),

            "quote_timestamp": stock.get(
                "quote_timestamp"
            ),

            "source": stock.get(
                "source",
                "Yahoo Finance",
            ),
        },

        "investment": {
            "investment_amount": _round(
                amount
            ),

            "entry_price": _round(
                buying_price
            ),

            "entry_price_source": entry_price_source,

            "quantity": _round(
                quantity,
                8,
            ),

            "current_market_value": _round(
                current_value
            ),

            "current_profit_loss": _round(
                current_profit_loss
            ),

            "current_return_percent": _round(
                current_return_percent,
                2,
            ),

            "currency": currency,
        },

        "scenarios": results,

        "comparison": {
            "best_scenario": best_scenario["name"],

            "worst_scenario": worst_scenario["name"],

            "scenario_count": len(results),
        },

        "calculation_method": {
            "quantity": (
                "Investment amount divided by hypothetical "
                "entry price."
            ),

            "future_price": (
                "Entry price multiplied by one plus the "
                "assumed percentage change."
            ),

            "final_value": (
                "Hypothetical quantity multiplied by "
                "the assumed future price."
            ),

            "profit_loss": (
                "Estimated final value minus investment amount."
            ),

            "return_percent": (
                "Profit or loss divided by investment amount, "
                "multiplied by 100."
            ),
        },

        "assumptions": [
            "Scenario percentage changes are hypothetical.",
            "Fractional share quantities are used for calculation.",
            "Brokerage and transaction charges are excluded.",
            "Taxes and other statutory charges are excluded.",
            "Slippage and liquidity effects are excluded.",
            "Dividends and corporate actions are excluded.",
            "The calculator does not execute trades.",
            "Scenario results are not guaranteed returns.",
        ],

        "disclaimer": (
            "What-If Market provides hypothetical financial "
            "calculations using user-defined price assumptions. "
            "It does not predict or guarantee future market prices "
            "and is not investment advice. Actual returns may differ "
            "because of market movements, brokerage, taxes, "
            "slippage and other costs."
        ),
    }


# =========================================================
# SERVICE STATUS
# =========================================================

def get_what_if_service_status() -> dict[str, Any]:
    """Return What-If Market service information."""

    return {
        "service": "Market Plus AI What-If Market",

        "status": "available",

        "default_scenarios": DEFAULT_SCENARIOS.copy(),

        "max_custom_scenarios": MAX_CUSTOM_SCENARIOS,

        "supports_custom_entry_price": True,

        "supports_custom_scenarios": True,

        "uses_live_market_lookup": True,

        "uses_paid_cloud": False,

        "uses_ai_prediction": False,
    }
