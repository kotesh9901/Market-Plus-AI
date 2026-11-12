
"""
Stock services for Market Plus AI.

Features:
- Dynamic Yahoo Finance stock and asset search.
- Indian NSE/BSE search prioritization.
- Validated ticker symbols.
- Detailed stock quote and company information.
- Historical OHLCV chart data.
- Price-change summaries.
- Recent stock-search history.
- Centralized caching through data_fetcher.py.
- Safe JSON-compatible output.
- Stock overview combining quote and chart data.
- Search results enriched with available market quotes.

Yahoo Finance may delay, limit, or temporarily block requests.
This service does not guarantee real-time exchange prices
or investment returns.
"""

from __future__ import annotations

import logging
import math
import threading
import time

from typing import Any

import numpy as np
import pandas as pd

from backend.data_fetcher import (
    get_historical_data,
    get_stock_info,
    normalize_symbol,
    search_stock_symbols,
)

from backend.validation import (
    validate_stock_symbol,
    validate_search_query,
)


logger = logging.getLogger(__name__)


# =========================================================
# CONFIGURATION
# =========================================================

CHART_PERIODS = {
    "1d": ("1d", "1m"),
    "5d": ("5d", "5m"),
    "1mo": ("1mo", "1d"),
    "3mo": ("3mo", "1d"),
    "6mo": ("6mo", "1d"),
    "1y": ("1y", "1d"),
    "2y": ("2y", "1d"),
    "5y": ("5y", "1d"),
    "max": ("max", "1mo"),
}

DEFAULT_SEARCH_LIMIT = 10
MAX_SEARCH_LIMIT = 25

MAX_RECENT_SEARCHES = 30

_recent_searches: list[dict[str, Any]] = []

_recent_searches_lock = threading.RLock()


class StockServiceError(Exception):
    """Raised when a stock-service operation cannot be completed."""


# =========================================================
# SAFE CONVERSION HELPERS
# =========================================================

def _to_float(value: Any) -> float | None:
    """Convert a value into a finite JSON-compatible float."""

    try:
        if value is None or isinstance(value, bool):
            return None

        result = float(value)

        if not math.isfinite(result):
            return None

        return result

    except (TypeError, ValueError, OverflowError):
        return None


def _to_int(value: Any) -> int | None:
    """Convert a numeric value into an integer."""

    number = _to_float(value)

    if number is None:
        return None

    try:
        return int(number)

    except (TypeError, ValueError, OverflowError):
        return None


def _safe_text(
    value: Any,
    default: str = "",
) -> str:
    """Convert optional text safely."""

    if value is None:
        return default

    try:
        result = str(value).strip()

        if result.lower() in {
            "",
            "none",
            "nan",
            "nat",
        }:
            return default

        return result

    except Exception:
        return default


def _normalize_query(query: str) -> str:
    """Validate and normalize a search query."""

    if not isinstance(query, str):
        raise StockServiceError(
            "Search query must be text."
        )

    valid, result = validate_search_query(
        query.strip(),
        min_length=1,
        max_length=100,
    )

    if not valid:
        raise StockServiceError(str(result))

    return str(result).strip()


def _normalize_stock_symbol(symbol: str) -> str:
    """Validate and normalize a ticker symbol."""

    try:
        return normalize_symbol(symbol)

    except (ValueError, TypeError) as exc:
        raise StockServiceError(str(exc)) from exc


# =========================================================
# SEARCH RESULT PRIORITIZATION
# =========================================================

def _search_priority(
    item: dict[str, Any],
    query: str,
) -> tuple[int, int]:
    """
    Rank search results.

    Priority:
    1. Exact symbol match.
    2. Exact NSE symbol match.
    3. Exact BSE symbol match.
    4. Other NSE listings.
    5. Other BSE listings.
    6. Other international listings.
    """

    symbol = _safe_text(
        item.get("symbol")
    ).upper()

    query_upper = query.strip().upper()

    if symbol == query_upper:
        return (0, 0)

    if symbol.endswith(".NS"):
        return (1, 0)

    if symbol.endswith(".BO"):
        return (2, 0)

    exchange = _safe_text(
        item.get("exchange")
    ).upper()

    if exchange in {"NSI", "NSE"}:
        return (1, 1)

    if exchange in {"BSE", "BOM"}:
        return (2, 1)

    return (3, 0)


# =========================================================
# SEARCH QUOTE ENRICHMENT
# =========================================================

def _get_search_quote(
    symbol: str,
) -> dict[str, Any]:
    """
    Retrieve quote information for one search result.

    Uses the existing get_stock_info() function in
    data_fetcher.py, including its centralized quote cache.

    If quote retrieval fails, the stock search result is
    preserved with unavailable price fields.
    """

    unavailable = {
        "current_price": None,
        "price": None,
        "last_price": None,
        "previous_close": None,
        "price_change": None,
        "change_percent": None,
        "price_available": False,
        "quote_timestamp": None,
        "quote_source": "Yahoo Finance",
    }

    try:
        info = get_stock_info(
            symbol,
            use_cache=True,
        )

        if not isinstance(info, dict):
            return unavailable

        current = _to_float(
            info.get("last_price")
        )

        previous = _to_float(
            info.get("previous_close")
        )

        price_change = _to_float(
            info.get("price_change")
        )

        change_percent = _to_float(
            info.get("change_percent")
        )

        # Calculate missing change values only when
        # both current price and previous close are valid.
        if (
            current is not None
            and previous is not None
            and previous > 0
        ):

            if price_change is None:
                price_change = current - previous

            if change_percent is None:
                change_percent = (
                    (current - previous) / previous
                ) * 100

        if current is None or current <= 0:
            return {
                **unavailable,
                "previous_close": previous,
                "price_change": price_change,
                "change_percent": change_percent,
            }

        return {
            "current_price": current,
            "price": current,
            "last_price": current,
            "previous_close": previous,
            "price_change": price_change,
            "change_percent": change_percent,
            "price_available": True,
            "quote_timestamp": info.get(
                "quote_timestamp"
            ),
            "quote_source": _safe_text(
                info.get("source"),
                "Yahoo Finance",
            ),
            "currency": _safe_text(
                info.get("currency")
            ),
        }

    except Exception:

        logger.debug(
            "Search quote unavailable for %s",
            symbol,
            exc_info=True,
        )

        return unavailable


def _enrich_search_result(
    item: dict[str, Any],
) -> dict[str, Any]:
    """
    Add quote fields to a search result without allowing
    quote failures to interrupt the search operation.
    """

    result = dict(item)

    quote = _get_search_quote(
        result["symbol"]
    )

    result.update(quote)

    # Prefer quote currency when available.
    quote_currency = _safe_text(
        quote.get("currency")
    )

    if quote_currency:
        result["currency"] = quote_currency

    result.setdefault(
        "currency",
        "",
    )

    return result


# =========================================================
# RECENT SEARCH HISTORY
# =========================================================

def _remember_search(
    query: str,
    symbol: str,
    name: str,
) -> None:
    """Store a recent stock search in application memory."""

    item = {
        "query": query,
        "symbol": symbol,
        "name": name,
        "searched_at": time.time(),
    }

    with _recent_searches_lock:

        _recent_searches[:] = [
            existing
            for existing in _recent_searches
            if existing["symbol"] != symbol
        ]

        _recent_searches.insert(0, item)

        del _recent_searches[MAX_RECENT_SEARCHES:]


def get_recent_searches(
    limit: int = 10,
) -> list[dict[str, Any]]:
    """
    Return recently searched stocks.

    This is application-memory history. It is not permanent
    or user-specific database history.
    """

    try:
        limit = int(limit)

    except (TypeError, ValueError, OverflowError):
        limit = 10

    limit = max(
        1,
        min(limit, MAX_RECENT_SEARCHES),
    )

    with _recent_searches_lock:

        return [
            {
                "query": item["query"],
                "symbol": item["symbol"],
                "name": item["name"],
            }
            for item in _recent_searches[:limit]
        ]


# =========================================================
# STOCK SEARCH
# =========================================================

def search_stocks(
    query: str,
    limit: int = DEFAULT_SEARCH_LIMIT,
) -> list[dict[str, Any]]:
    """
    Dynamically search Yahoo Finance.

    Supports:
    - Company names.
    - Indian stock symbols.
    - NSE and BSE listings.
    - US stock symbols.
    - International symbols.
    - Other Yahoo Finance-supported assets.

    Search results include available market quote information.

    Examples:
        search_stocks("Infosys")
        search_stocks("TCS")
        search_stocks("TCS.NS")
        search_stocks("Apple")
    """

    query = _normalize_query(query)

    try:
        limit = int(limit)

    except (TypeError, ValueError, OverflowError):
        limit = DEFAULT_SEARCH_LIMIT

    limit = max(
        1,
        min(limit, MAX_SEARCH_LIMIT),
    )

    try:
        provider_limit = min(
            max(limit * 2, 10),
            20,
        )

        raw_results = search_stock_symbols(
            query,
            max_results=provider_limit,
            use_cache=True,
        )

        if not isinstance(raw_results, list):
            raise StockServiceError(
                "The market-data provider returned an invalid search response."
            )

        valid_results = []
        seen_symbols = set()

        for item in raw_results:

            if not isinstance(item, dict):
                continue

            raw_symbol = item.get("symbol")

            if not raw_symbol:
                continue

            valid, normalized = validate_stock_symbol(
                raw_symbol
            )

            if not valid:
                continue

            symbol = str(normalized).upper()

            if symbol in seen_symbols:
                continue

            seen_symbols.add(symbol)

            name = _safe_text(
                item.get("name"),
                symbol,
            )

            exchange = _safe_text(
                item.get("exchange"),
                "Unknown",
            )

            quote_type = _safe_text(
                item.get("quote_type")
                or item.get("type")
                or item.get("type_display"),
                "EQUITY",
            )

            currency = _safe_text(
                item.get("currency"),
                "",
            )

            valid_results.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "exchange": exchange,
                    "type": quote_type,
                    "currency": currency,
                    "source": "Yahoo Finance",
                }
            )

        # Prioritize exact and Indian exchange matches.
        valid_results.sort(
            key=lambda item: _search_priority(
                item,
                query,
            )
        )

        # Apply the requested result limit first.
        results = valid_results[:limit]

        # Enrich only the results that will be returned.
        # Each quote uses data_fetcher.py's existing cache.
        enriched_results = []

        for item in results:

            enriched = _enrich_search_result(
                item
            )

            enriched_results.append(enriched)

            _remember_search(
                query=query,
                symbol=enriched["symbol"],
                name=enriched["name"],
            )

        return enriched_results

    except StockServiceError:
        raise

    except Exception as exc:

        logger.exception(
            "Stock search failed for query %s",
            query,
        )

        raise StockServiceError(
            "Stock search is temporarily unavailable. "
            "Please try again."
        ) from exc


# =========================================================
# STOCK DETAILS
# =========================================================

def get_stock_details(
    symbol: str,
) -> dict[str, Any]:
    """
    Retrieve detailed stock information.
    """

    normalized = _normalize_stock_symbol(symbol)

    try:
        info = get_stock_info(normalized)

        if not isinstance(info, dict):
            raise StockServiceError(
                "The market-data provider returned invalid stock information."
            )

        current = _to_float(
            info.get("last_price")
        )

        previous = _to_float(
            info.get("previous_close")
        )

        if current is None or current <= 0:
            raise StockServiceError(
                f"No usable market price is currently available for {normalized}."
            )

        price_change = _to_float(
            info.get("price_change")
        )

        change_percent = _to_float(
            info.get("change_percent")
        )

        if (
            price_change is None
            and previous is not None
        ):
            price_change = current - previous

        if (
            change_percent is None
            and previous is not None
            and previous > 0
        ):
            change_percent = (
                (current - previous) / previous
            ) * 100

        result = {
            "symbol": normalized,

            "name": _safe_text(
                info.get("name"),
                normalized,
            ),

            "exchange": _safe_text(
                info.get("exchange"),
                "Unknown",
            ),

            "currency": _safe_text(
                info.get("currency"),
                "INR",
            ),

            "last_price": current,
            "previous_close": previous,
            "price_change": price_change,
            "change_percent": change_percent,

            "open": _to_float(
                info.get("open")
            ),

            "day_high": _to_float(
                info.get("day_high")
            ),

            "day_low": _to_float(
                info.get("day_low")
            ),

            "volume": _to_int(
                info.get("volume")
            ),

            "market_cap": _to_float(
                info.get("market_cap")
            ),

            "year_high": _to_float(
                info.get("year_high")
            ),

            "year_low": _to_float(
                info.get("year_low")
            ),

            "average_volume": _to_int(
                info.get("average_volume")
            ),

            "quote_timestamp": info.get(
                "quote_timestamp"
            ),

            "last_updated": info.get(
                "last_updated"
            ),

            "source": _safe_text(
                info.get("source"),
                "Yahoo Finance",
            ),

            "data_available": True,

            "disclaimer": (
                "Market information is supplied by Yahoo Finance. "
                "Quotes may be delayed and are not guaranteed "
                "to represent real-time exchange prices."
            ),
        }

        _remember_search(
            query=normalized,
            symbol=normalized,
            name=result["name"],
        )

        return result

    except StockServiceError:
        raise

    except Exception as exc:

        logger.exception(
            "Stock details retrieval failed for %s",
            normalized,
        )

        raise StockServiceError(
            f"Could not retrieve stock details for {normalized}. "
            "The market-data provider may be unavailable."
        ) from exc


# =========================================================
# CHART DATA NORMALIZATION
# =========================================================

def _normalise_chart_data(
    history: pd.DataFrame,
) -> pd.DataFrame:
    """Normalize historical data for frontend chart rendering."""

    if history is None or history.empty:
        raise StockServiceError(
            "No historical prices are available."
        )

    df = history.copy()

    if isinstance(df.columns, pd.MultiIndex):

        normalized_columns = []

        for column in df.columns:

            parts = [
                str(part).strip().lower()
                for part in column
            ]

            match = next(
                (
                    part
                    for part in parts
                    if part in {
                        "open",
                        "high",
                        "low",
                        "close",
                        "volume",
                    }
                ),
                parts[0] if parts else "",
            )

            normalized_columns.append(match)

        df.columns = normalized_columns

    else:

        df.columns = [
            str(column).strip().lower()
            for column in df.columns
        ]

    if "close" not in df.columns:
        raise StockServiceError(
            "Historical data does not contain closing prices."
        )

    for column in (
        "open",
        "high",
        "low",
        "volume",
    ):

        if column not in df.columns:
            df[column] = np.nan

    df = df[
        [
            "open",
            "high",
            "low",
            "close",
            "volume",
        ]
    ].copy()

    if not isinstance(df.index, pd.DatetimeIndex):

        df.index = pd.to_datetime(
            df.index,
            errors="coerce",
            utc=True,
        )

    df = df.loc[
        ~df.index.isna()
    ]

    df = df.sort_index()

    df = df[
        ~df.index.duplicated(keep="last")
    ]

    for column in (
        "open",
        "high",
        "low",
        "close",
        "volume",
    ):

        df[column] = pd.to_numeric(
            df[column],
            errors="coerce",
        )

    df = df.replace(
        [np.inf, -np.inf],
        np.nan,
    )

    df = df.dropna(
        subset=["close"]
    )

    df = df[
        df["close"] > 0
    ]

    if df.empty:
        raise StockServiceError(
            "No valid historical closing prices are available."
        )

    return df


# =========================================================
# STOCK CHART
# =========================================================

def get_stock_chart(
    symbol: str,
    period: str = "6mo",
) -> dict[str, Any]:
    """
    Retrieve OHLCV chart data.

    Supported periods:
        1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max.
    """

    normalized = _normalize_stock_symbol(symbol)

    period = str(period).strip().lower()

    if period not in CHART_PERIODS:
        raise StockServiceError(
            "Unsupported chart period. Choose 1d, 5d, 1mo, "
            "3mo, 6mo, 1y, 2y, 5y, or max."
        )

    provider_period, interval = CHART_PERIODS[period]

    try:
        history = get_historical_data(
            normalized,
            period=provider_period,
            interval=interval,
            use_cache=True,
        )

        df = _normalise_chart_data(history)

        points = []

        for timestamp, row in df.iterrows():

            points.append(
                {
                    "date": timestamp.isoformat(),

                    "open": _to_float(
                        row.get("open")
                    ),

                    "high": _to_float(
                        row.get("high")
                    ),

                    "low": _to_float(
                        row.get("low")
                    ),

                    "close": _to_float(
                        row.get("close")
                    ),

                    "volume": _to_int(
                        row.get("volume")
                    ),
                }
            )

        closes = df["close"].dropna()

        if closes.empty:
            raise StockServiceError(
                "No valid closing prices are available for this chart."
            )

        first_close = _to_float(
            closes.iloc[0]
        )

        last_close = _to_float(
            closes.iloc[-1]
        )

        period_change = None
        period_change_percent = None

        if (
            first_close is not None
            and last_close is not None
        ):

            period_change = last_close - first_close

            if first_close > 0:
                period_change_percent = (
                    period_change / first_close
                ) * 100

        return {
            "symbol": normalized,

            "period": period,

            "interval": interval,

            "count": len(points),

            "first_date": points[0]["date"],

            "last_date": points[-1]["date"],

            "first_close": first_close,

            "last_close": last_close,

            "period_change": _to_float(
                period_change
            ),

            "period_change_percent": _to_float(
                period_change_percent
            ),

            "points": points,

            "source": "Yahoo Finance",

            "disclaimer": (
                "Historical prices are supplied by Yahoo Finance "
                "and may be delayed or incomplete."
            ),
        }

    except StockServiceError:
        raise

    except Exception as exc:

        logger.exception(
            "Stock chart retrieval failed for %s",
            normalized,
        )

        raise StockServiceError(
            f"Could not retrieve chart data for {normalized}. "
            "Please try another chart period."
        ) from exc


# =========================================================
# STOCK OVERVIEW
# =========================================================

def get_stock_overview(
    symbol: str,
    period: str = "6mo",
) -> dict[str, Any]:
    """
    Return stock details and chart data together.

    Intended for the Explore Assets stock-details page.
    """

    normalized = _normalize_stock_symbol(symbol)

    details = get_stock_details(
        normalized
    )

    chart = get_stock_chart(
        normalized,
        period,
    )

    chart["currency"] = details.get(
        "currency"
    )

    return {
        "stock": details,
        "chart": chart,

        "disclaimer": (
            "Market information may be delayed. Historical "
            "performance does not guarantee future results. "
            "This application does not execute trades."
        ),
    }


# =========================================================
# CACHE MANAGEMENT
# =========================================================

def clear_stock_service_cache() -> None:
    """
    Clear recent-search history.

    Quote, historical and search caches are maintained
    centrally in backend.data_fetcher.
    """

    with _recent_searches_lock:
        _recent_searches.clear()


def get_stock_service_status() -> dict[str, Any]:
    """Return basic stock-service diagnostic information."""

    with _recent_searches_lock:
        recent_count = len(_recent_searches)

    return {
        "service": "Market Plus AI Stock Service",

        "status": "available",

        "search_provider": "Yahoo Finance",

        "chart_periods": list(
            CHART_PERIODS.keys()
        ),

        "recent_search_count": recent_count,

        "max_recent_searches": MAX_RECENT_SEARCHES,
    }
