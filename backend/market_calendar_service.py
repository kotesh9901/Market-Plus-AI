"""
Market Plus AI - Market Calendar Service

Provides basic trading-calendar utilities for prediction horizons.

Important:
    This is a weekday-based approximation, not an official NSE or BSE
    holiday calendar. Exchange holidays are not automatically included.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any


def _parse_date(value: Any) -> date:
    """Convert a date, datetime, or ISO date string into a date."""
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if isinstance(value, str):
        text = value.strip()

        try:
            return date.fromisoformat(text[:10])
        except ValueError as exc:
            raise ValueError(
                "Date must be a date object or ISO-format date string."
            ) from exc

    raise ValueError("A valid date is required.")


def is_weekday_trading_day(value: Any) -> bool:
    """
    Return True for Monday through Friday.

    Exchange holidays are not considered by this approximation.
    """
    parsed = _parse_date(value)
    return parsed.weekday() < 5


def next_weekday(value: Any, *, include_current: bool = False) -> date:
    """Return the next weekday, optionally including the supplied date."""
    current = _parse_date(value)

    if include_current and current.weekday() < 5:
        return current

    current += timedelta(days=1)

    while current.weekday() >= 5:
        current += timedelta(days=1)

    return current


def add_trading_days(
    start_date: Any,
    trading_days: int,
    *,
    include_start: bool = False,
) -> date:
    """
    Add an approximate number of trading days to a starting date.

    Args:
        start_date: Starting date.
        trading_days: Number of weekdays to advance; must be nonnegative.
        include_start: Count the starting day if it is a weekday.

    Returns:
        Estimated target date.

    Note:
        Public exchange holidays are not excluded.
    """
    if (
        isinstance(trading_days, bool)
        or not isinstance(trading_days, int)
        or trading_days < 0
    ):
        raise ValueError("trading_days must be a nonnegative integer.")

    current = _parse_date(start_date)
    remaining = trading_days

    if include_start and remaining > 0 and current.weekday() < 5:
        remaining -= 1

    while remaining > 0:
        current += timedelta(days=1)

        if current.weekday() < 5:
            remaining -= 1

    return current


def count_weekday_trading_days(
    start_date: Any,
    end_date: Any,
    *,
    include_start: bool = False,
) -> int:
    """
    Count weekdays between two dates.

    The end date is included when it is a weekday.
    The start date is excluded by default.
    """
    start = _parse_date(start_date)
    end = _parse_date(end_date)

    if end < start:
        raise ValueError("End date cannot be earlier than start date.")

    count = 0
    current = start

    if not include_start:
        current += timedelta(days=1)

    while current <= end:
        if current.weekday() < 5:
            count += 1

        current += timedelta(days=1)

    return count


def trading_horizon_summary(
    start_date: Any,
    trading_days: int,
) -> dict[str, Any]:
    """
    Build a JSON-serializable summary for a prediction horizon.

    The estimated target date uses weekdays only and may differ from the
    actual exchange trading calendar because of holidays or special sessions.
    """
    start = _parse_date(start_date)

    target = add_trading_days(
        start,
        trading_days,
        include_start=False,
    )

    calendar_days = (target - start).days

    return {
        "start_date": start.isoformat(),
        "trading_days_requested": trading_days,
        "estimated_target_date": target.isoformat(),
        "calendar_days_elapsed": calendar_days,
        "calendar_days_approximation": True,
        "warning": (
            "Target date is estimated using weekdays only. "
            "NSE/BSE holidays and special trading sessions are not included."
        ),
    }


def current_utc_date() -> str:
    """Return the current UTC date in ISO format."""
    return datetime.now(timezone.utc).date().isoformat()