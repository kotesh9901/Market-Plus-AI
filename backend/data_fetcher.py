"""
Market data collection and caching for Market Plus AI.

Features:
- Dynamic Yahoo Finance stock and asset search.
- Validated ticker symbols.
- Stock quote and company information.
- Historical OHLCV data for charts and predictions.
- Intraday, daily, weekly, and monthly intervals.
- Thread-safe in-memory caching.
- SQLite storage for asset information and price history.
- Safe handling of missing, invalid, and non-finite market values.

Yahoo Finance may delay, limit, or temporarily block requests.
This application does not guarantee real-time exchange prices.
"""

from __future__ import annotations

import logging
import math
import threading
import time

from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from config import Config
from backend.database import get_db
from backend.validation import (
    validate_search_query,
    validate_stock_symbol,
)


logger = logging.getLogger(__name__)


# =========================================================
# CONFIGURATION
# =========================================================

QUOTE_CACHE_TTL = 30
HISTORY_CACHE_TTL = 300
SEARCH_CACHE_TTL = 300

MAX_SEARCH_RESULTS = 20

ALLOWED_PERIODS = {
    "1d",
    "5d",
    "1mo",
    "3mo",
    "6mo",
    "1y",
    "2y",
    "5y",
    "10y",
    "ytd",
    "max",
}

ALLOWED_INTERVALS = {
    "1m",
    "2m",
    "5m",
    "15m",
    "30m",
    "60m",
    "90m",
    "1h",
    "1d",
    "5d",
    "1wk",
    "1mo",
    "3mo",
}

INTRADAY_INTERVALS = {
    "1m",
    "2m",
    "5m",
    "15m",
    "30m",
    "60m",
    "90m",
    "1h",
}

# Yahoo Finance has historical restrictions for intraday data.
INTRADAY_MAX_PERIODS = {
    "1m": {"1d", "5d"},
    "2m": {"1d", "5d", "1mo"},
    "5m": {"1d", "5d", "1mo"},
    "15m": {"1d", "5d", "1mo"},
    "30m": {"1d", "5d", "1mo"},
    "60m": {"1d", "5d", "1mo"},
    "90m": {"1d", "5d", "1mo"},
    "1h": {"1d", "5d", "1mo"},
}


# =========================================================
# CACHE STORAGE
# =========================================================

_cache_lock = threading.RLock()

_quote_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_history_cache: dict[str, tuple[float, pd.DataFrame]] = {}
_search_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _cache_get(cache: dict, key: str, ttl: int):
    """Return a cached value if it has not expired."""
    with _cache_lock:
        entry = cache.get(key)

        if entry is None:
            return None

        created_at, value = entry

        if time.monotonic() - created_at > ttl:
            cache.pop(key, None)
            return None

        return value


def _cache_set(cache: dict, key: str, value: Any):
    """Store a value in the in-memory cache."""
    with _cache_lock:
        cache[key] = (time.monotonic(), value)


# =========================================================
# GENERAL HELPERS
# =========================================================

def utc_now() -> str:
    """Return the current UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


def _safe_float(value: Any, default=None):
    """Convert a value to a finite float."""
    try:
        if value is None:
            return default

        result = float(value)

        if not math.isfinite(result):
            return default

        return result

    except (TypeError, ValueError, OverflowError):
        return default


def _safe_int(value: Any, default=None):
    """Convert a value to an integer safely."""
    number = _safe_float(value)

    if number is None:
        return default

    try:
        return int(number)
    except (TypeError, ValueError, OverflowError):
        return default


def _normalise_currency(value: Any) -> str:
    """Return a safe currency code."""
    if not value:
        return "INR"

    return str(value).strip().upper()[:10]


def _normalise_text(value: Any, default: str = "") -> str:
    """Convert a value to safe display text."""
    if value is None:
        return default

    result = str(value).strip()

    return result if result else default


def _get_config_value(name: str, default: Any):
    """Read an optional setting from Config."""
    return getattr(Config, name, default)


# =========================================================
# SYMBOL VALIDATION
# =========================================================

def normalize_symbol(symbol: str) -> str:
    """
    Validate and normalize a Yahoo Finance ticker.

    Examples:
        tcs.ns  -> TCS.NS
        infy    -> INFY
    """
    if not isinstance(symbol, str):
        raise ValueError("A valid stock symbol is required.")

    symbol = symbol.strip().upper()

    if not symbol:
        raise ValueError("Stock symbol cannot be empty.")

    valid, result = validate_stock_symbol(symbol)

    if not valid:
        raise ValueError(str(result))

    return str(result).strip().upper()


def _validate_search_query(query: str) -> str:
    """Validate a stock-search query."""
    if not isinstance(query, str):
        raise ValueError("Search query must be text.")

    query = query.strip()

    if not query:
        raise ValueError("Enter a company name or stock symbol.")

    valid, result = validate_search_query(query)

    if not valid:
        raise ValueError(str(result))

    return str(result).strip()


# =========================================================
# DATAFRAME NORMALIZATION
# =========================================================

def _normalise_history_dataframe(
    history: pd.DataFrame,
) -> pd.DataFrame:
    """Normalize Yahoo Finance history into standard OHLCV columns."""

    if history is None or history.empty:
        return pd.DataFrame(
            columns=["Open", "High", "Low", "Close", "Volume"]
        )

    df = history.copy()

    # Handle yfinance MultiIndex output.
    if isinstance(df.columns, pd.MultiIndex):
        normalized_columns = []

        for column in df.columns:
            matched = None

            for part in column:
                name = str(part).strip().lower()

                if name in {
                    "open",
                    "high",
                    "low",
                    "close",
                    "volume",
                }:
                    matched = name.title()
                    break

            normalized_columns.append(
                matched or str(column[0]).strip().title()
            )

        df.columns = normalized_columns

    else:
        df.columns = [
            str(column).strip().title()
            for column in df.columns
        ]

    # Keep only standard market fields.
    required_columns = [
        "Open",
        "High",
        "Low",
        "Close",
        "Volume",
    ]

    for column in required_columns:
        if column not in df.columns:
            df[column] = np.nan

    df = df[required_columns].copy()

    # Normalize the datetime index.
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(
            df.index,
            errors="coerce",
            utc=True,
        )

    else:
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
        else:
            df.index = df.index.tz_convert("UTC")

    df = df.loc[~df.index.isna()]
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]

    # Normalize numerical columns.
    for column in required_columns:
        df[column] = pd.to_numeric(
            df[column],
            errors="coerce",
        )

    df = df.replace(
        [np.inf, -np.inf],
        np.nan,
    )

    # A usable historical row must have a positive closing price.
    df = df.dropna(subset=["Close"])
    df = df[df["Close"] > 0]

    # Remove impossible OHLC rows.
    valid_high = (
        df["High"].isna()
        | (df["High"] >= df[["Open", "Low", "Close"]].max(axis=1))
    )

    valid_low = (
        df["Low"].isna()
        | (df["Low"] <= df[["Open", "High", "Close"]].min(axis=1))
    )

    df = df[valid_high & valid_low]

    # Volume should not be negative.
    df.loc[df["Volume"] < 0, "Volume"] = np.nan

    return df


# =========================================================
# DATABASE STORAGE
# =========================================================

def save_asset_info(
    symbol: str,
    name: str,
    exchange: str,
    currency: str,
    last_price: float | None,
    price_change: float | None,
    change_percent: float | None,
) -> bool:
    """
    Insert or update an asset in the local SQLite database.

    Expected assets columns:
        symbol, name, exchange, currency, last_price,
        price_change, change_percent, last_updated,
        created_at, updated_at
    """
    try:
        symbol = normalize_symbol(symbol)

        name = _normalise_text(name, symbol)
        exchange = _normalise_text(exchange, "Unknown")
        currency = _normalise_currency(currency)

        last_price = _safe_float(last_price)
        price_change = _safe_float(price_change)
        change_percent = _safe_float(change_percent)

        timestamp = utc_now()

        with get_db() as connection:
            connection.execute(
                """
                INSERT INTO assets (
                    symbol,
                    name,
                    exchange,
                    currency,
                    last_price,
                    price_change,
                    change_percent,
                    last_updated,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    name = excluded.name,
                    exchange = excluded.exchange,
                    currency = excluded.currency,
                    last_price = excluded.last_price,
                    price_change = excluded.price_change,
                    change_percent = excluded.change_percent,
                    last_updated = excluded.last_updated,
                    updated_at = excluded.updated_at
                """,
                (
                    symbol,
                    name,
                    exchange,
                    currency,
                    last_price,
                    price_change,
                    change_percent,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )

        return True

    except Exception:
        logger.exception(
            "Could not save asset information for %s",
            symbol,
        )
        return False


def save_price_history(
    symbol: str,
    history: pd.DataFrame,
    interval: str = "1d",
) -> int:
    """
    Save historical OHLCV rows to SQLite.

    Returns the number of rows written.

    Expected price_history columns:
        symbol, interval, recorded_at, open, high,
        low, close, volume

    Expected unique constraint:
        UNIQUE(symbol, interval, recorded_at)
    """
    if history is None or history.empty:
        return 0

    try:
        symbol = normalize_symbol(symbol)
        interval = str(interval).strip().lower()

        if interval not in ALLOWED_INTERVALS:
            raise ValueError("Unsupported historical interval.")

        df = _normalise_history_dataframe(history)

        if df.empty:
            return 0

        records = []

        for timestamp, row in df.iterrows():
            records.append(
                (
                    symbol,
                    interval,
                    timestamp.isoformat(),
                    _safe_float(row["Open"]),
                    _safe_float(row["High"]),
                    _safe_float(row["Low"]),
                    _safe_float(row["Close"]),
                    _safe_int(row["Volume"], 0),
                )
            )

        if not records:
            return 0

        with get_db() as connection:
            connection.executemany(
                """
                INSERT INTO price_history (
                    symbol,
                    interval,
                    recorded_at,
                    open,
                    high,
                    low,
                    close,
                    volume
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, interval, recorded_at)
                DO UPDATE SET
                    open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    close = excluded.close,
                    volume = excluded.volume
                """,
                records,
            )

        return len(records)

    except Exception:
        logger.exception(
            "Could not save price history for %s",
            symbol,
        )
        return 0


# =========================================================
# DYNAMIC STOCK SEARCH
# =========================================================

def search_stock_symbols(
    query: str,
    max_results: int = 10,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """
    Search stocks and assets dynamically using Yahoo Finance.

    Returns:
        [
            {
                "symbol": "TCS.NS",
                "name": "Tata Consultancy Services",
                "exchange": "NSI",
                "type": "EQUITY",
                "currency": "INR",
                "source": "Yahoo Finance"
            }
        ]

    Provider failures raise RuntimeError instead of silently
    returning an empty search result.
    """
    query = _validate_search_query(query)

    try:
        max_results = int(max_results)
    except (TypeError, ValueError):
        max_results = 10

    max_results = max(
        1,
        min(max_results, MAX_SEARCH_RESULTS),
    )

    cache_key = f"{query.lower()}:{max_results}"

    if use_cache:
        cached = _cache_get(
            _search_cache,
            cache_key,
            SEARCH_CACHE_TTL,
        )

        if cached is not None:
            return [item.copy() for item in cached]

    try:
        search_result = yf.Search(
            query,
            max_results=max_results,
            news_count=0,
        )

        quotes = getattr(search_result, "quotes", None) or []

        results = []
        seen_symbols = set()

        for item in quotes:
            if not isinstance(item, dict):
                continue

            raw_symbol = item.get("symbol")

            if not raw_symbol:
                continue

            try:
                symbol = normalize_symbol(raw_symbol)
            except ValueError:
                continue

            if symbol in seen_symbols:
                continue

            seen_symbols.add(symbol)

            name = (
                item.get("longname")
                or item.get("shortname")
                or item.get("name")
                or symbol
            )

            exchange = (
                item.get("exchange")
                or item.get("exchDisp")
                or "Unknown"
            )

            asset_type = (
                item.get("quoteType")
                or item.get("typeDisp")
                or "EQUITY"
            )

            currency = (
                item.get("currency")
                or "INR"
            )

            results.append(
                {
                    "symbol": symbol,
                    "name": _normalise_text(name, symbol),
                    "exchange": _normalise_text(
                        exchange,
                        "Unknown",
                    ),
                    "type": _normalise_text(
                        asset_type,
                        "EQUITY",
                    ),
                    "currency": _normalise_currency(currency),
                    "source": "Yahoo Finance",
                }
            )

            if len(results) >= max_results:
                break

        _cache_set(
            _search_cache,
            cache_key,
            results,
        )

        return [item.copy() for item in results]

    except Exception as exc:
        logger.exception(
            "Yahoo Finance search failed for query: %s",
            query,
        )

        raise RuntimeError(
            "Stock search is temporarily unavailable. "
            "Check your internet connection and try again."
        ) from exc


# =========================================================
# STOCK QUOTE INFORMATION
# =========================================================

def _extract_fast_info(ticker) -> dict[str, Any]:
    """Extract quote fields from yfinance fast_info."""
    result = {}

    try:
        fast_info = ticker.fast_info

        if fast_info is None:
            return result

        fields = {
            "last_price": "lastPrice",
            "previous_close": "previousClose",
            "open": "open",
            "day_high": "dayHigh",
            "day_low": "dayLow",
            "volume": "lastVolume",
            "currency": "currency",
            "exchange": "exchange",
            "year_high": "yearHigh",
            "year_low": "yearLow",
            "market_cap": "marketCap",
            "average_volume": "threeMonthAverageVolume",
        }

        for target, source in fields.items():
            try:
                value = fast_info.get(source)
            except Exception:
                try:
                    value = fast_info[source]
                except Exception:
                    value = None

            if value is not None:
                result[target] = value

    except Exception:
        logger.debug(
            "Could not read fast_info.",
            exc_info=True,
        )

    return result


def _extract_full_info(ticker) -> dict[str, Any]:
    """Extract supplementary company and quote information."""
    try:
        info = ticker.get_info()

        if not isinstance(info, dict):
            return {}

        return info

    except Exception:
        logger.debug(
            "Could not retrieve full Yahoo Finance information.",
            exc_info=True,
        )
        return {}


def _get_quote_timestamp(info: dict[str, Any]):
    """Convert Yahoo's market timestamp into an ISO timestamp."""
    timestamp = (
        info.get("regularMarketTime")
        or info.get("postMarketTime")
        or info.get("preMarketTime")
    )

    try:
        if timestamp:
            return datetime.fromtimestamp(
                int(timestamp),
                tz=timezone.utc,
            ).isoformat()

    except (TypeError, ValueError, OverflowError, OSError):
        pass

    return None


def get_stock_info(
    symbol: str,
    use_cache: bool = True,
) -> dict[str, Any]:
    """
    Retrieve current quote and company information.

    The function uses fast_info first and supplementary company
    information second. Historical prices are used as a fallback
    when the provider does not return a usable quote.

    Returns a dictionary compatible with stock_service.py.
    """
    symbol = normalize_symbol(symbol)

    if use_cache:
        cached = _cache_get(
            _quote_cache,
            symbol,
            QUOTE_CACHE_TTL,
        )

        if cached is not None:
            return cached.copy()

    try:
        ticker = yf.Ticker(symbol)

        fast_info = _extract_fast_info(ticker)
        full_info = _extract_full_info(ticker)

        name = (
            full_info.get("longName")
            or full_info.get("shortName")
            or full_info.get("displayName")
            or symbol
        )

        exchange = (
            full_info.get("exchange")
            or full_info.get("fullExchangeName")
            or fast_info.get("exchange")
            or "Unknown"
        )

        currency = (
            full_info.get("currency")
            or fast_info.get("currency")
            or "INR"
        )

        last_price = _safe_float(
            fast_info.get("last_price")
        )

        previous_close = _safe_float(
            fast_info.get("previous_close")
        )

        open_price = _safe_float(
            fast_info.get("open")
        )

        day_high = _safe_float(
            fast_info.get("day_high")
        )

        day_low = _safe_float(
            fast_info.get("day_low")
        )

        volume = _safe_int(
            fast_info.get("volume")
        )

        market_cap = _safe_float(
            fast_info.get("market_cap")
        )

        year_high = _safe_float(
            fast_info.get("year_high")
        )

        year_low = _safe_float(
            fast_info.get("year_low")
        )

        average_volume = _safe_int(
            fast_info.get("average_volume")
        )

        # Fill missing values using supplementary Yahoo fields.
        last_price = last_price or _safe_float(
            full_info.get("regularMarketPrice")
        )

        previous_close = previous_close or _safe_float(
            full_info.get("regularMarketPreviousClose")
        )

        open_price = open_price or _safe_float(
            full_info.get("regularMarketOpen")
        )

        day_high = day_high or _safe_float(
            full_info.get("regularMarketDayHigh")
        )

        day_low = day_low or _safe_float(
            full_info.get("regularMarketDayLow")
        )

        volume = volume or _safe_int(
            full_info.get("regularMarketVolume")
        )

        market_cap = market_cap or _safe_float(
            full_info.get("marketCap")
        )

        year_high = year_high or _safe_float(
            full_info.get("fiftyTwoWeekHigh")
        )

        year_low = year_low or _safe_float(
            full_info.get("fiftyTwoWeekLow")
        )

        average_volume = average_volume or _safe_int(
            full_info.get("averageVolume")
        )

        # If the quote is incomplete, try recent intraday history.
        quote_timestamp = _get_quote_timestamp(full_info)

        if last_price is None or previous_close is None:
            try:
                intraday = ticker.history(
                    period="1d",
                    interval="1m",
                    auto_adjust=False,
                    actions=False,
                )

                intraday = _normalise_history_dataframe(
                    intraday
                )

                if not intraday.empty:
                    latest = intraday.iloc[-1]

                    if last_price is None:
                        last_price = _safe_float(
                            latest["Close"]
                        )

                    if open_price is None:
                        open_price = _safe_float(
                            latest["Open"]
                        )

                    if day_high is None:
                        day_high = _safe_float(
                            latest["High"]
                        )

                    if day_low is None:
                        day_low = _safe_float(
                            latest["Low"]
                        )

                    quote_timestamp = (
                        intraday.index[-1].isoformat()
                    )

            except Exception:
                logger.debug(
                    "Intraday quote fallback failed for %s",
                    symbol,
                    exc_info=True,
                )

        # Daily fallback for missing quote information.
        if last_price is None or previous_close is None:
            try:
                daily = ticker.history(
                    period="5d",
                    interval="1d",
                    auto_adjust=False,
                    actions=False,
                )

                daily = _normalise_history_dataframe(daily)

                if not daily.empty:
                    latest = daily.iloc[-1]

                    if last_price is None:
                        last_price = _safe_float(
                            latest["Close"]
                        )

                    if previous_close is None and len(daily) >= 2:
                        previous_close = _safe_float(
                            daily["Close"].iloc[-2]
                        )

                    if open_price is None:
                        open_price = _safe_float(
                            latest["Open"]
                        )

                    if day_high is None:
                        day_high = _safe_float(
                            latest["High"]
                        )

                    if day_low is None:
                        day_low = _safe_float(
                            latest["Low"]
                        )

                    if volume is None:
                        volume = _safe_int(
                            latest["Volume"]
                        )

                    if quote_timestamp is None:
                        quote_timestamp = (
                            daily.index[-1].isoformat()
                        )

            except Exception:
                logger.debug(
                    "Daily quote fallback failed for %s",
                    symbol,
                    exc_info=True,
                )

        if last_price is None or last_price <= 0:
            raise RuntimeError(
                f"No valid market price is available for {symbol}."
            )

        price_change = None
        change_percent = None

        if previous_close is not None and previous_close > 0:
            price_change = last_price - previous_close

            change_percent = (
                price_change / previous_close
            ) * 100

        result = {
            "symbol": symbol,
            "name": _normalise_text(name, symbol),
            "exchange": _normalise_text(
                exchange,
                "Unknown",
            ),
            "currency": _normalise_currency(currency),
            "last_price": _safe_float(last_price),
            "previous_close": _safe_float(previous_close),
            "price_change": _safe_float(price_change),
            "change_percent": _safe_float(change_percent),
            "open": _safe_float(open_price),
            "day_high": _safe_float(day_high),
            "day_low": _safe_float(day_low),
            "volume": _safe_int(volume),
            "market_cap": _safe_float(market_cap),
            "year_high": _safe_float(year_high),
            "year_low": _safe_float(year_low),
            "average_volume": _safe_int(average_volume),
            "quote_timestamp": quote_timestamp,
            "last_updated": utc_now(),
            "source": "Yahoo Finance",
        }

        _cache_set(
            _quote_cache,
            symbol,
            result,
        )

        # Store quote information locally.
        save_asset_info(
            symbol=result["symbol"],
            name=result["name"],
            exchange=result["exchange"],
            currency=result["currency"],
            last_price=result["last_price"],
            price_change=result["price_change"],
            change_percent=result["change_percent"],
        )

        return result.copy()

    except Exception as exc:
        logger.exception(
            "Failed to retrieve stock information for %s",
            symbol,
        )

        raise RuntimeError(
            f"Could not retrieve market information for {symbol}. "
            "Please try again later."
        ) from exc


# =========================================================
# HISTORICAL MARKET DATA
# =========================================================

def _validate_history_request(
    period: str,
    interval: str,
):
    """Validate Yahoo Finance period and interval combinations."""
    period = str(period).strip().lower()
    interval = str(interval).strip().lower()

    if period not in ALLOWED_PERIODS:
        raise ValueError(
            f"Unsupported period: {period}"
        )

    if interval not in ALLOWED_INTERVALS:
        raise ValueError(
            f"Unsupported interval: {interval}"
        )

    if interval in INTRADAY_INTERVALS:
        allowed_periods = INTRADAY_MAX_PERIODS[interval]

        if period not in allowed_periods:
            raise ValueError(
                f"Yahoo Finance does not reliably support "
                f"period '{period}' with interval '{interval}'. "
                f"Supported periods: "
                f"{', '.join(sorted(allowed_periods))}."
            )

    if interval == "5d":
        raise ValueError(
            "The 5d interval is not supported for Yahoo Finance "
            "historical requests. Use 1d or 1wk instead."
        )

    if interval == "3mo":
        raise ValueError(
            "The 3mo interval is not supported for Yahoo Finance "
            "historical requests. Use 1mo instead."
        )

    return period, interval


def get_historical_data(
    symbol: str,
    period: str = "2y",
    interval: str = "1d",
    use_cache: bool = True,
) -> pd.DataFrame:
    """
    Retrieve historical OHLCV data.

    Supported chart examples:
        get_historical_data("TCS.NS", "1d", "1m")
        get_historical_data("TCS.NS", "5d", "5m")
        get_historical_data("TCS.NS", "1mo", "1d")
        get_historical_data("TCS.NS", "1y", "1d")
        get_historical_data("TCS.NS", "5y", "1wk")
        get_historical_data("TCS.NS", "max", "1mo")

    Returns a normalized pandas DataFrame with:
        Open, High, Low, Close, Volume

    Raises RuntimeError when Yahoo Finance cannot provide data.
    """
    symbol = normalize_symbol(symbol)

    period, interval = _validate_history_request(
        period,
        interval,
    )

    cache_key = f"{symbol}:{period}:{interval}"

    if use_cache:
        cached = _cache_get(
            _history_cache,
            cache_key,
            HISTORY_CACHE_TTL,
        )

        if cached is not None:
            return cached.copy(deep=True)

    try:
        ticker = yf.Ticker(symbol)

        history = ticker.history(
            period=period,
            interval=interval,
            auto_adjust=False,
            actions=False,
            raise_errors=True,
        )

        normalized = _normalise_history_dataframe(
            history
        )

        if normalized.empty:
            raise RuntimeError(
                f"No historical market data was returned for {symbol}."
            )

        # Save a copy in the local SQLite database.
        save_price_history(
            symbol=symbol,
            history=normalized,
            interval=interval,
        )

        _cache_set(
            _history_cache,
            cache_key,
            normalized.copy(deep=True),
        )

        return normalized.copy(deep=True)

    except Exception as exc:
        logger.exception(
            "Historical data retrieval failed for %s (%s, %s)",
            symbol,
            period,
            interval,
        )

        raise RuntimeError(
            f"Historical data for {symbol} is temporarily unavailable. "
            "Check your internet connection or try another chart period."
        ) from exc


# =========================================================
# STOCK SUMMARY
# =========================================================

def get_stock_summary(symbol: str) -> dict[str, Any]:
    """Return a combined quote and historical market summary."""
    symbol = normalize_symbol(symbol)

    quote = get_stock_info(symbol)

    history = get_historical_data(
        symbol,
        period="1y",
        interval="1d",
    )

    if history.empty:
        raise RuntimeError(
            f"No historical data is available for {symbol}."
        )

    closes = history["Close"].astype(float)

    moving_average_10 = (
        closes.tail(10).mean()
        if len(closes) >= 10
        else None
    )

    moving_average_50 = (
        closes.tail(50).mean()
        if len(closes) >= 50
        else None
    )

    highest_price = closes.max()
    lowest_price = closes.min()

    return {
        "symbol": symbol,
        "quote": quote,
        "history_rows": len(history),
        "first_historical_date": history.index[0].isoformat(),
        "last_historical_date": history.index[-1].isoformat(),
        "highest_close": _safe_float(highest_price),
        "lowest_close": _safe_float(lowest_price),
        "moving_average_10": _safe_float(moving_average_10),
        "moving_average_50": _safe_float(moving_average_50),
    }


# =========================================================
# CACHE MANAGEMENT
# =========================================================

def clear_market_cache(symbol: str | None = None) -> dict[str, int]:
    """
    Clear cached quote, history, and search data.

    If symbol is supplied, clear quote and history entries
    associated with that symbol. Search cache is cleared only
    when clearing all caches.
    """
    removed = {
        "quotes": 0,
        "history": 0,
        "search": 0,
    }

    with _cache_lock:
        if symbol:
            normalized_symbol = normalize_symbol(symbol)

            if _quote_cache.pop(normalized_symbol, None) is not None:
                removed["quotes"] += 1

            history_keys = [
                key
                for key in _history_cache
                if key.startswith(
                    normalized_symbol + ":"
                )
            ]

            for key in history_keys:
                _history_cache.pop(key, None)
                removed["history"] += 1

        else:
            removed["quotes"] = len(_quote_cache)
            removed["history"] = len(_history_cache)
            removed["search"] = len(_search_cache)

            _quote_cache.clear()
            _history_cache.clear()
            _search_cache.clear()

    return removed


def get_market_cache_status() -> dict[str, Any]:
    """Return cache counts and configured expiration times."""
    with _cache_lock:
        return {
            "quote_cache_entries": len(_quote_cache),
            "history_cache_entries": len(_history_cache),
            "search_cache_entries": len(_search_cache),
            "quote_cache_ttl_seconds": QUOTE_CACHE_TTL,
            "history_cache_ttl_seconds": HISTORY_CACHE_TTL,
            "search_cache_ttl_seconds": SEARCH_CACHE_TTL,
        }