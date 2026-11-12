
"""Investment tracking service for Market Plus AI.

Investment lifecycle:
1. Create an OPEN investment using purchase details.
2. Close the investment using withdrawal price and withdrawal date.
3. Completed investments are permanently read-only.

Currency support:
- Each investment stores its own ISO 4217 currency code.
- Withdrawal calculations use the investment's saved currency.
- Financial summaries are grouped by currency.
- Values in different currencies are never added together.

Database columns:
- buy_price: investment price per share
- quantity: internally calculated quantity
- sell_price: withdrawal price per share
- buy_date: investment date
- sell_date: withdrawal date
- currency: ISO currency code
- notes: retained for compatibility, always stored empty

Quantity is never returned to the frontend.
"""

import math
import re
from collections import defaultdict
from datetime import date, datetime, timezone

from backend.database import get_db


# ---------------------------------------------------------
# SUPPORTED CURRENCIES
# ---------------------------------------------------------

SUPPORTED_CURRENCIES = {
    "INR", "USD", "GBP", "EUR", "JPY",
    "AED", "CAD", "AUD", "CHF", "CNY",
    "SGD", "SAR", "KRW", "BRL", "ZAR",
    "NZD", "MYR", "IDR", "THB", "MXN",
    "BDT", "PKR", "NPR", "LKR", "NGN",
    "KES", "EGP", "TRY", "SEK", "NOK",
    "DKK", "PLN", "QAR", "KWD", "BHD",
    "OMR", "PHP", "VND", "ARS",
}


# ---------------------------------------------------------
# GENERAL HELPERS
# ---------------------------------------------------------

def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _validate_user_id(user_id):
    user_id = str(user_id or "").strip()

    if not user_id:
        raise ValueError("A valid user ID is required.")

    return user_id


def _validate_date(value, field_name):
    if not value:
        raise ValueError(f"{field_name} is required.")

    try:
        value = str(value).strip()
        parsed = date.fromisoformat(value)

        if parsed.isoformat() != value:
            raise ValueError

        return parsed.isoformat()

    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must use YYYY-MM-DD format.")


def _validate_positive_number(value, field_name):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a valid number.")

    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{field_name} must be greater than zero.")

    return number


def _validate_currency(value):
    """Validate and normalize an ISO currency code."""

    currency = str(value or "INR").strip().upper()

    if currency not in SUPPORTED_CURRENCIES:
        raise ValueError(
            "Please select a supported investment currency."
        )

    return currency


def _normalize_search_text(value):
    """Normalize text for case-insensitive pattern matching."""

    value = str(value or "").strip().casefold()
    return re.sub(r"[^a-z0-9]+", "", value)


# ---------------------------------------------------------
# ASSET SEARCH AND PATTERN MATCHING
# ---------------------------------------------------------

def search_investment_assets(query, limit=10):
    """Search assets by partial company name or ticker symbol."""

    query = str(query or "").strip()

    if len(query) < 2:
        return []

    query_normalized = _normalize_search_text(query)

    if not query_normalized:
        return []

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 10

    limit = max(1, min(limit, 20))

    try:
        import yfinance as yf

        search = yf.Search(
            query,
            max_results=limit * 2,
            news_count=0,
        )

        quotes = getattr(search, "quotes", []) or []

    except Exception as exc:
        raise ValueError(
            "Asset search is temporarily unavailable. "
            "Please try again."
        ) from exc

    matches = []
    seen_symbols = set()

    for item in quotes:
        if not isinstance(item, dict):
            continue

        symbol = str(item.get("symbol") or "").strip().upper()

        asset_name = (
            item.get("shortname")
            or item.get("longname")
            or item.get("displayName")
            or ""
        )

        asset_name = str(asset_name).strip()

        if not symbol or not asset_name:
            continue

        symbol_normalized = _normalize_search_text(symbol)
        name_normalized = _normalize_search_text(asset_name)

        if symbol in seen_symbols:
            continue

        if (
            query_normalized not in symbol_normalized
            and query_normalized not in name_normalized
        ):
            continue

        if (
            symbol_normalized == query_normalized
            or name_normalized == query_normalized
        ):
            score = 0
        elif (
            symbol_normalized.startswith(query_normalized)
            or name_normalized.startswith(query_normalized)
        ):
            score = 1
        else:
            score = 2

        seen_symbols.add(symbol)

        matches.append({
            "_score": score,
            "asset_name": asset_name,
            "symbol": symbol,
            "exchange": str(item.get("exchange") or ""),
            "quote_type": str(item.get("quoteType") or ""),
        })

    matches.sort(
        key=lambda item: (
            item["_score"],
            item["asset_name"].casefold(),
        )
    )

    results = []

    for item in matches[:limit]:
        item.pop("_score", None)
        results.append(item)

    return results


# ---------------------------------------------------------
# CALCULATIONS
# ---------------------------------------------------------

def _calculate_trade_values(
    investment_price,
    investment_amount,
    withdrawal_price=None,
):
    """Calculate internal quantity and investment results."""

    quantity = investment_amount / investment_price

    result = {
        "investment_price": round(investment_price, 4),
        "investment_amount": round(investment_amount, 2),
        "withdrawal_price": None,
        "withdrawal_amount": None,
        "profit_loss": None,
        "profit_loss_percentage": None,
        "return_percentage": None,
    }

    if withdrawal_price is not None:
        withdrawal_amount = quantity * withdrawal_price
        profit_loss = withdrawal_amount - investment_amount

        return_percentage = (
            profit_loss / investment_amount
        ) * 100

        result.update({
            "withdrawal_price": round(withdrawal_price, 4),
            "withdrawal_amount": round(withdrawal_amount, 2),
            "profit_loss": round(profit_loss, 2),
            "profit_loss_percentage": round(return_percentage, 2),
            "return_percentage": round(return_percentage, 2),
        })

    return quantity, result


# ---------------------------------------------------------
# DATABASE ROW CONVERSION
# ---------------------------------------------------------

def _trade_to_dict(row):
    """Convert a database row into a safe frontend record."""

    if not row:
        return None

    trade = dict(row)

    investment_price = float(trade["buy_price"])
    quantity = float(trade["quantity"])

    investment_amount = round(
        investment_price * quantity,
        2,
    )

    withdrawal_price = (
        float(trade["sell_price"])
        if trade["sell_price"] is not None
        else None
    )

    currency = _validate_currency(
        trade.get("currency") or "INR"
    )

    _, calculations = _calculate_trade_values(
        investment_price,
        investment_amount,
        withdrawal_price,
    )

    # Never expose internal quantity or legacy price columns.
    trade.pop("quantity", None)
    trade.pop("buy_price", None)
    trade.pop("sell_price", None)
    trade.pop("notes", None)

    trade.update(calculations)
    trade["currency"] = currency

    trade["status"] = (
        "COMPLETED"
        if withdrawal_price is not None
        else "OPEN"
    )

    trade["is_editable"] = False
    trade["can_withdraw"] = trade["status"] == "OPEN"

    return trade


# ---------------------------------------------------------
# CURRENCY-GROUPED SUMMARY
# ---------------------------------------------------------

def _build_currency_summaries(trades):
    """Calculate separate financial totals for every currency."""

    grouped = defaultdict(lambda: {
        "currency": "",
        "total_invested_amount": 0.0,
        "total_withdrawal_amount": 0.0,
        "total_realized_profit_loss": 0.0,
        "total_invested_in_open_trades": 0.0,
        "total_invested_in_completed_trades": 0.0,
        "completed_trades": 0,
        "open_investments": 0,
        "profitable_trades": 0,
        "loss_making_trades": 0,
        "breakeven_trades": 0,
    })

    for trade in trades:
        currency = trade["currency"]
        summary = grouped[currency]
        summary["currency"] = currency

        amount = float(trade["investment_amount"] or 0)

        summary["total_invested_amount"] += amount

        if trade["status"] == "OPEN":
            summary["open_investments"] += 1
            summary["total_invested_in_open_trades"] += amount
            continue

        summary["completed_trades"] += 1
        summary["total_invested_in_completed_trades"] += amount

        withdrawal_amount = float(
            trade["withdrawal_amount"] or 0
        )

        profit_loss = float(trade["profit_loss"] or 0)

        summary["total_withdrawal_amount"] += withdrawal_amount
        summary["total_realized_profit_loss"] += profit_loss

        if profit_loss > 0:
            summary["profitable_trades"] += 1
        elif profit_loss < 0:
            summary["loss_making_trades"] += 1
        else:
            summary["breakeven_trades"] += 1

    results = {}

    for currency, summary in grouped.items():
        invested_completed = summary[
            "total_invested_in_completed_trades"
        ]

        summary["overall_return_percentage"] = (
            round(
                (
                    summary["total_realized_profit_loss"]
                    / invested_completed
                ) * 100,
                2,
            )
            if invested_completed > 0
            else 0.0
        )

        monetary_fields = (
            "total_invested_amount",
            "total_withdrawal_amount",
            "total_realized_profit_loss",
            "total_invested_in_open_trades",
            "total_invested_in_completed_trades",
        )

        for field in monetary_fields:
            summary[field] = round(summary[field], 2)

        results[currency] = summary

    return results


# ---------------------------------------------------------
# CREATE OPEN INVESTMENT
# ---------------------------------------------------------

def add_investment_trade(user_id, data):
    """Create a new OPEN investment with its selected currency."""

    user_id = _validate_user_id(user_id)

    if not isinstance(data, dict):
        raise ValueError("Invalid investment details.")

    asset_name = str(data.get("asset_name") or "").strip()
    symbol = str(data.get("symbol") or "").strip().upper()

    if not asset_name:
        raise ValueError("Please select an asset from the search results.")

    if not symbol:
        raise ValueError("Please select a valid ticker symbol.")

    if len(asset_name) > 150 or len(symbol) > 30:
        raise ValueError("Asset name or ticker symbol is too long.")

    investment_price = _validate_positive_number(
        data.get("investment_price"),
        "Investment price per share",
    )

    investment_amount = _validate_positive_number(
        data.get("investment_amount"),
        "Total investment amount",
    )

    currency = _validate_currency(data.get("currency") or "INR")

    buy_date = _validate_date(
        data.get("buy_date") or data.get("investment_date"),
        "Investment date",
    )

    quantity = investment_amount / investment_price

    if not math.isfinite(quantity) or quantity <= 0:
        raise ValueError("Unable to calculate investment quantity.")

    timestamp = _now()

    with get_db() as db:
        user = db.execute(
            "SELECT user_id FROM users WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if not user:
            raise ValueError("User account was not found.")

        cursor = db.execute(
            """
            INSERT INTO investment_trades (
                user_id,
                symbol,
                asset_name,
                quantity,
                buy_price,
                sell_price,
                buy_date,
                sell_date,
                currency,
                notes,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, '', ?, ?)
            """,
            (
                user_id,
                symbol,
                asset_name,
                quantity,
                investment_price,
                buy_date,
                currency,
                timestamp,
                timestamp,
            ),
        )

        trade_id = cursor.lastrowid
        db.commit()

        row = db.execute(
            """
            SELECT *
            FROM investment_trades
            WHERE id = ? AND user_id = ?
            """,
            (trade_id, user_id),
        ).fetchone()

    return _trade_to_dict(row)


# ---------------------------------------------------------
# GET INVESTMENTS
# ---------------------------------------------------------

def get_investment_trades(user_id):
    """Return all investment records belonging to a user."""

    user_id = _validate_user_id(user_id)

    with get_db() as db:
        rows = db.execute(
            """
            SELECT *
            FROM investment_trades
            WHERE user_id = ?
            ORDER BY buy_date DESC, id DESC
            """,
            (user_id,),
        ).fetchall()

    return [_trade_to_dict(row) for row in rows]


def get_investment_summary(user_id):
    """Return investment records and currency-separated totals."""

    trades = get_investment_trades(user_id)

    open_trades = [
        trade for trade in trades
        if trade["status"] == "OPEN"
    ]

    completed_trades = [
        trade for trade in trades
        if trade["status"] == "COMPLETED"
    ]

    currency_summaries = _build_currency_summaries(trades)

    # Compatibility values are only provided when all investments
    # use one currency. Never add INR, USD, EUR, etc. together.
    single_currency = (
        next(iter(currency_summaries))
        if len(currency_summaries) == 1
        else None
    )

    single_summary = (
        currency_summaries[single_currency]
        if single_currency
        else None
    )

    return {
        "total_trades": len(trades),
        "completed_trades": len(completed_trades),
        "open_investments": len(open_trades),

        "currency_summaries": currency_summaries,

        "summary_currency": single_currency,

        "total_invested_amount": (
            single_summary["total_invested_amount"]
            if single_summary else None
        ),
        "total_invested_in_completed_trades": (
            single_summary["total_invested_in_completed_trades"]
            if single_summary else None
        ),
        "total_invested_in_open_trades": (
            single_summary["total_invested_in_open_trades"]
            if single_summary else None
        ),
        "total_withdrawal_amount": (
            single_summary["total_withdrawal_amount"]
            if single_summary else None
        ),
        "total_realized_profit_loss": (
            single_summary["total_realized_profit_loss"]
            if single_summary else None
        ),
        "overall_return_percentage": (
            single_summary["overall_return_percentage"]
            if single_summary else None
        ),

        "profitable_trades": (
            single_summary["profitable_trades"]
            if single_summary else None
        ),
        "loss_making_trades": (
            single_summary["loss_making_trades"]
            if single_summary else None
        ),
        "breakeven_trades": (
            single_summary["breakeven_trades"]
            if single_summary else None
        ),

        "open_investments_list": open_trades,
        "completed_investments_list": completed_trades,

        # Existing frontend compatibility.
        "open_investments_records": open_trades,
        "completed_investments_records": completed_trades,
        "trades": trades,
    }


# ---------------------------------------------------------
# COMPLETE / WITHDRAW OPEN INVESTMENT
# ---------------------------------------------------------

def close_investment_trade(
    user_id,
    trade_id,
    sell_price=None,
    sell_date=None,
    withdrawal_price=None,
):
    """Complete an OPEN investment using its original currency."""

    user_id = _validate_user_id(user_id)

    try:
        trade_id = int(trade_id)
    except (TypeError, ValueError):
        raise ValueError("Invalid investment ID.")

    if trade_id <= 0:
        raise ValueError("Invalid investment ID.")

    if withdrawal_price in (None, ""):
        withdrawal_price = sell_price

    withdrawal_price = _validate_positive_number(
        withdrawal_price,
        "Withdrawal price per share",
    )

    withdrawal_date = _validate_date(
        sell_date,
        "Withdrawal date",
    )

    with get_db() as db:
        row = db.execute(
            """
            SELECT buy_date, sell_price, currency
            FROM investment_trades
            WHERE id = ? AND user_id = ?
            """,
            (trade_id, user_id),
        ).fetchone()

        if not row:
            raise ValueError("Investment record was not found.")

        if row["sell_price"] is not None:
            raise ValueError(
                "This investment is already completed and cannot be edited."
            )

        if withdrawal_date < row["buy_date"]:
            raise ValueError(
                "Withdrawal date cannot be earlier than investment date."
            )

        # The saved investment currency is intentionally retained.
        # A withdrawal cannot change the currency of an existing trade.
        _validate_currency(row["currency"] or "INR")

        cursor = db.execute(
            """
            UPDATE investment_trades
            SET sell_price = ?,
                sell_date = ?,
                updated_at = ?
            WHERE id = ?
              AND user_id = ?
              AND sell_price IS NULL
            """,
            (
                withdrawal_price,
                withdrawal_date,
                _now(),
                trade_id,
                user_id,
            ),
        )

        if cursor.rowcount != 1:
            raise ValueError(
                "Investment could not be completed. Please refresh."
            )

        db.commit()

        updated = db.execute(
            """
            SELECT *
            FROM investment_trades
            WHERE id = ? AND user_id = ?
            """,
            (trade_id, user_id),
        ).fetchone()

    return _trade_to_dict(updated)


# ---------------------------------------------------------
# DELETE OPEN INVESTMENT ONLY
# ---------------------------------------------------------

def delete_investment_trade(user_id, trade_id):
    """Delete an OPEN investment only."""

    user_id = _validate_user_id(user_id)

    try:
        trade_id = int(trade_id)
    except (TypeError, ValueError):
        raise ValueError("Invalid investment ID.")

    if trade_id <= 0:
        raise ValueError("Invalid investment ID.")

    with get_db() as db:
        row = db.execute(
            """
            SELECT sell_price
            FROM investment_trades
            WHERE id = ? AND user_id = ?
            """,
            (trade_id, user_id),
        ).fetchone()

        if not row:
            raise ValueError("Investment record was not found.")

        if row["sell_price"] is not None:
            raise ValueError(
                "Completed investments cannot be deleted."
            )

        cursor = db.execute(
            """
            DELETE FROM investment_trades
            WHERE id = ?
              AND user_id = ?
              AND sell_price IS NULL
            """,
            (trade_id, user_id),
        )

        if cursor.rowcount != 1:
            raise ValueError(
                "Investment could not be deleted. Please refresh."
            )

        db.commit()

    return {
        "success": True,
        "message": "Open investment deleted successfully.",
    }
