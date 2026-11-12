"""Main Flask application for Market Plus AI.

Local-first Flask + SQLite application.
Includes authentication, stock search, predictions, What-If Market,
historical pattern analysis, investments, alerts, news and notifications.
"""

import importlib
import inspect
import io
import json
import logging
import math
import os
import re
import statistics

from datetime import timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import (
    Flask, jsonify, redirect, render_template,
    request, session, url_for, send_file,
)

from config import Config
from backend.auth import auth_bp, get_current_user
from backend.database import get_db, health_check, init_db, utc_now


# ================================================================
# CONSTANTS
# ================================================================

SUPPORTED_PREDICTION_MODELS = {
    "random forest": "Random Forest",
    "linear regression": "Linear Regression",
    "lstm + transformer": "LSTM + Transformer",
}

SUPPORTED_PREDICTION_HORIZONS = {1, 7, 30}
SUPPORTED_RISK_CATEGORIES = {"low", "middle", "high"}

WHAT_IF_DEFAULT_SCENARIOS = {
    "optimistic": 15.0,
    "neutral": 0.0,
    "pessimistic": -15.0,
}

WHAT_IF_DISCLAIMER = (
    "What-If scenarios are hypothetical calculations, not AI predictions "
    "or investment advice. Actual market prices and returns can differ."
)

PREDICTION_DISCLAIMER = (
    "AI predictions are estimates based on available historical data. "
    "They are not guaranteed and are not financial advice."
)

logger = logging.getLogger(__name__)


# ================================================================
# GENERAL HELPERS
# ================================================================

def json_safe(value):
    """Convert Python, NumPy, pandas and SQLite values to JSON-safe data."""

    if value is None or isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if isinstance(value, dict):
        return {
            str(key): json_safe(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]

    if hasattr(value, "keys") and callable(value.keys):
        try:
            return {
                str(key): json_safe(value[key])
                for key in value.keys()
            }
        except (TypeError, ValueError, KeyError, IndexError):
            pass

    if hasattr(value, "item"):
        try:
            return json_safe(value.item())
        except (ValueError, TypeError):
            pass

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except (ValueError, TypeError):
            pass

    if hasattr(value, "to_dict"):
        try:
            return json_safe(value.to_dict())
        except (ValueError, TypeError):
            pass

    return str(value)


def api_success(data=None, message="Success", status=200, **extra):
    payload = {
        "success": True,
        "message": message,
        "data": json_safe(data),
    }
    payload.update(json_safe(extra))
    return jsonify(payload), status


def api_error(message, status=400, **extra):
    payload = {
        "success": False,
        "message": str(message),
    }
    payload.update(json_safe(extra))
    return jsonify(payload), status


def import_service(module_name, function_name):
    module = importlib.import_module(module_name)
    function = getattr(module, function_name)

    if not callable(function):
        raise TypeError(
            f"{module_name}.{function_name} is not callable."
        )

    return function


def service_call(function, **kwargs):
    """Pass only arguments supported by the service function."""

    signature = inspect.signature(function)
    parameters = signature.parameters

    accepts_kwargs = any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    )

    if accepts_kwargs:
        return function(**kwargs)

    accepted = {
        name: value
        for name, value in kwargs.items()
        if name in parameters
        and parameters[name].kind not in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.VAR_POSITIONAL,
        )
    }

    return function(**accepted)


def get_user_value(user, key, default=None):
    if user is None:
        return default

    if isinstance(user, dict):
        return user.get(key, default)

    try:
        value = user[key]
        return default if value is None else value
    except (KeyError, TypeError, IndexError):
        return getattr(user, key, default)


def get_user_id(user):
    return (
        get_user_value(user, "user_id")
        or get_user_value(user, "id")
    )


def require_user_id(user):
    user_id = get_user_id(user)

    if not user_id:
        raise ValueError(
            "The authenticated account has no valid user ID."
        )

    return str(user_id)


def authenticated_user():
    if not session.get("user_id"):
        return None, api_error(
            "Please log in to continue.",
            401,
        )

    try:
        user = get_current_user()
    except Exception:
        logger.exception("Unable to retrieve authenticated user.")
        user = None

    if user is None:
        session.clear()
        return None, api_error(
            "Your session has expired. Please log in again.",
            401,
        )

    return user, None


def get_request_user():
    return authenticated_user()


def request_json():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def positive_number(value, field_name):
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a valid number.")

    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number.") from None

    if not math.isfinite(number) or number <= 0:
        raise ValueError(
            f"{field_name} must be greater than zero."
        )

    return number


def normalized_symbol(value):
    symbol = str(value or "").strip().upper()

    if not symbol:
        raise ValueError("Please provide an asset symbol.")

    if len(symbol) > 50:
        raise ValueError("The asset symbol is too long.")

    if any(ord(character) < 32 for character in symbol):
        raise ValueError("The asset symbol contains invalid characters.")

    return symbol


def normalized_prediction_model(value):
    model = str(value or "Random Forest").strip().lower()
    canonical = SUPPORTED_PREDICTION_MODELS.get(model)

    if canonical is None:
        supported = ", ".join(
            SUPPORTED_PREDICTION_MODELS.values()
        )
        raise ValueError(
            f"Unsupported prediction model. Choose one of: {supported}."
        )

    return canonical


def requested_limit(default=10, maximum=50):
    try:
        value = int(request.args.get("limit", str(default)))
    except (TypeError, ValueError):
        raise ValueError("Limit must be an integer.") from None

    if value < 1 or value > maximum:
        raise ValueError(
            f"Limit must be between 1 and {maximum}."
        )

    return value


def requested_offset(default=0, maximum=100000):
    try:
        value = int(request.args.get("offset", str(default)))
    except (TypeError, ValueError):
        raise ValueError("Offset must be an integer.") from None

    if value < 0 or value > maximum:
        raise ValueError(
            f"Offset must be between 0 and {maximum}."
        )

    return value


def parse_boolean(value, default=False):
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, int):
        return value == 1

    normalized = str(value).strip().lower()

    if normalized in {"true", "1", "yes", "on"}:
        return True

    if normalized in {"false", "0", "no", "off"}:
        return False

    raise ValueError("Invalid boolean value.")


def optional_float(value):
    if value is None or value == "":
        return None

    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def resolve_alert_symbol(value):
    """Resolve a company name or ticker to a provider symbol."""

    original = str(value or "").strip()

    if not original:
        raise ValueError("Please enter a valid stock symbol.")

    symbol = normalized_symbol(original)

    if "." in symbol:
        return symbol

    from backend.stock_service import search_stocks

    results = search_stocks(
        query=original,
        limit=10,
    )

    if isinstance(results, dict):
        results = (
            results.get("results")
            or results.get("stocks")
            or results.get("assets")
            or []
        )

    if not results:
        raise ValueError(
            f"No stock or asset was found for '{original}'."
        )

    nse_result = next(
        (
            item for item in results
            if str(item.get("symbol", "")).upper().endswith(".NS")
        ),
        None,
    )

    if nse_result:
        return normalized_symbol(nse_result["symbol"])

    exact_result = next(
        (
            item for item in results
            if str(item.get("symbol", "")).upper() == symbol
        ),
        None,
    )

    if exact_result:
        return normalized_symbol(exact_result["symbol"])

    return normalized_symbol(results[0]["symbol"])


def unwrap_data(payload):
    """Unwrap common API/service response wrappers."""

    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return payload["data"]

    return payload


# ================================================================
# WHAT-IF DATABASE INITIALIZATION
# ================================================================

def ensure_what_if_schema():
    """Create What-If history storage without changing existing tables."""

    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS what_if_scenarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                scenario_name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                company_name TEXT DEFAULT '',
                investment_amount REAL NOT NULL,
                entry_price REAL NOT NULL,
                predicted_price REAL,
                horizon_days INTEGER,
                model_name TEXT DEFAULT '',
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id)
                    ON DELETE CASCADE
            )
            """
        )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_what_if_user_created
            ON what_if_scenarios(user_id, created_at DESC)
            """
        )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_what_if_symbol
            ON what_if_scenarios(symbol)
            """
        )


# ================================================================
# WHAT-IF CHART DATA HELPERS
# ================================================================

def extract_chart_rows(chart_result):
    """Normalize supported stock chart response shapes."""

    if isinstance(chart_result, dict):
        chart_result = unwrap_data(chart_result)

    if isinstance(chart_result, list):
        rows = chart_result

    elif isinstance(chart_result, dict):
        rows = None

        for key in (
            "data", "history", "prices", "points",
            "candles", "chart", "ohlcv",
        ):
            candidate = chart_result.get(key)

            if isinstance(candidate, list):
                rows = candidate
                break

            if isinstance(candidate, dict):
                for nested_key in (
                    "data", "history", "prices",
                    "points", "candles", "ohlcv",
                ):
                    nested = candidate.get(nested_key)
                    if isinstance(nested, list):
                        rows = nested
                        break

            if rows is not None:
                break

        if rows is None:
            rows = []

    else:
        rows = []

    normalized = []

    for item in rows:
        if not isinstance(item, dict):
            continue

        close = optional_float(
            item.get("close")
            if item.get("close") is not None
            else item.get("Close")
            if item.get("Close") is not None
            else item.get("adj_close")
            if item.get("adj_close") is not None
            else item.get("Adj Close")
            if item.get("Adj Close") is not None
            else item.get("price")
            if item.get("price") is not None
            else item.get("last_price")
        )

        if close is None or close <= 0:
            continue

        high = optional_float(
            item.get("high")
            if item.get("high") is not None
            else item.get("High")
        )
        low = optional_float(
            item.get("low")
            if item.get("low") is not None
            else item.get("Low")
        )
        open_price = optional_float(
            item.get("open")
            if item.get("open") is not None
            else item.get("Open")
        )

        date_value = (
            item.get("date")
            or item.get("Date")
            or item.get("datetime")
            or item.get("timestamp")
            or item.get("time")
        )

        normalized.append({
            "date": str(date_value) if date_value is not None else "",
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": optional_float(
                item.get("volume")
                if item.get("volume") is not None
                else item.get("Volume")
            ),
        })

    return normalized


def load_pattern_chart(symbol, period="5y"):
    chart_function = import_service(
        "backend.stock_service",
        "get_stock_chart",
    )

    result = service_call(
        chart_function,
        symbol=symbol,
        period=period,
    )

    rows = extract_chart_rows(result)

    if len(rows) < 30:
        raise ValueError(
            "Not enough historical price data is available "
            "to analyse this asset."
        )

    return rows


def find_pivots(values, distance=3):
    peaks = []
    troughs = []

    for index in range(distance, len(values) - distance):
        window = values[index - distance:index + distance + 1]
        current = values[index]

        if current == max(window):
            peaks.append(index)

        if current == min(window):
            troughs.append(index)

    return peaks, troughs


def percentage_difference(first, second):
    denominator = (abs(first) + abs(second)) / 2

    if denominator == 0:
        return 100.0

    return abs(first - second) / denominator * 100.0


def analyse_technical_patterns(rows):
    """Identify candidate chart patterns using historical OHLC prices."""

    closes = [row["close"] for row in rows]
    highs = [
        row["high"] if row["high"] is not None else row["close"]
        for row in rows
    ]
    lows = [
        row["low"] if row["low"] is not None else row["close"]
        for row in rows
    ]

    recent_start = max(0, len(closes) - 100)
    recent_highs = highs[recent_start:]
    recent_lows = lows[recent_start:]

    peaks, _ = find_pivots(recent_highs, distance=2)
    _, troughs = find_pivots(recent_lows, distance=2)

    patterns = []

    if len(peaks) >= 2:
        first, second = peaks[-2], peaks[-1]

        if second - first >= 5:
            p1 = recent_highs[first]
            p2 = recent_highs[second]

            if percentage_difference(p1, p2) <= 3.5:
                patterns.append({
                    "name": "Double Top",
                    "signal": "Potential bearish reversal",
                    "confidence": round(
                        max(50, min(
                            90,
                            90 - percentage_difference(p1, p2) * 8
                        )),
                        1,
                    ),
                    "description": (
                        "Two nearby price peaks were detected. "
                        "A support breakdown is needed for confirmation."
                    ),
                    "dates": [
                        rows[recent_start + first]["date"],
                        rows[recent_start + second]["date"],
                    ],
                })

    if len(troughs) >= 2:
        first, second = troughs[-2], troughs[-1]

        if second - first >= 5:
            p1 = recent_lows[first]
            p2 = recent_lows[second]

            if percentage_difference(p1, p2) <= 3.5:
                patterns.append({
                    "name": "Double Bottom",
                    "signal": "Potential bullish reversal",
                    "confidence": round(
                        max(50, min(
                            90,
                            90 - percentage_difference(p1, p2) * 8
                        )),
                        1,
                    ),
                    "description": (
                        "Two nearby price lows were detected. "
                        "A resistance breakout is needed for confirmation."
                    ),
                    "dates": [
                        rows[recent_start + first]["date"],
                        rows[recent_start + second]["date"],
                    ],
                })

    if len(peaks) >= 3:
        a, b, c = peaks[-3:]
        left = recent_highs[a]
        head = recent_highs[b]
        right = recent_highs[c]

        if (
            head > left
            and head > right
            and percentage_difference(left, right) <= 8
        ):
            patterns.append({
                "name": "Head and Shoulders",
                "signal": "Potential bearish reversal",
                "confidence": 68.0,
                "description": (
                    "A three-peak structure with a higher middle peak "
                    "was detected. Neckline confirmation is required."
                ),
                "dates": [
                    rows[recent_start + a]["date"],
                    rows[recent_start + b]["date"],
                    rows[recent_start + c]["date"],
                ],
            })

    if len(troughs) >= 3:
        a, b, c = troughs[-3:]
        left = recent_lows[a]
        head = recent_lows[b]
        right = recent_lows[c]

        if (
            head < left
            and head < right
            and percentage_difference(left, right) <= 8
        ):
            patterns.append({
                "name": "Inverse Head and Shoulders",
                "signal": "Potential bullish reversal",
                "confidence": 68.0,
                "description": (
                    "A three-trough structure with a lower middle trough "
                    "was detected. Neckline confirmation is required."
                ),
                "dates": [
                    rows[recent_start + a]["date"],
                    rows[recent_start + b]["date"],
                    rows[recent_start + c]["date"],
                ],
            })

    if len(peaks) >= 3 and len(troughs) >= 3:
        peak_values = [recent_highs[index] for index in peaks[-3:]]
        trough_values = [recent_lows[index] for index in troughs[-3:]]

        highs_flat = (
            max(peak_values) - min(peak_values)
        ) / max(peak_values) <= 0.025

        lows_rising = trough_values[-1] > trough_values[0] * 1.015

        lows_flat = (
            max(trough_values) - min(trough_values)
        ) / max(trough_values) <= 0.025

        highs_falling = peak_values[-1] < peak_values[0] * 0.985

        if highs_flat and lows_rising:
            patterns.append({
                "name": "Ascending Triangle",
                "signal": "Potential bullish continuation",
                "confidence": 62.0,
                "description": (
                    "Recent highs appear relatively flat while lows rise. "
                    "A resistance breakout is not yet confirmed."
                ),
                "dates": [],
            })

        if lows_flat and highs_falling:
            patterns.append({
                "name": "Descending Triangle",
                "signal": "Potential bearish continuation",
                "confidence": 62.0,
                "description": (
                    "Recent lows appear relatively flat while highs fall. "
                    "A support breakdown is not yet confirmed."
                ),
                "dates": [],
            })

    last = rows[-1]

    if (
        last["open"] is not None
        and last["high"] is not None
        and last["low"] is not None
    ):
        candle_range = last["high"] - last["low"]

        if candle_range > 0:
            body = abs(last["close"] - last["open"])
            lower_wick = (
                min(last["open"], last["close"]) - last["low"]
            )
            upper_wick = (
                last["high"] - max(last["open"], last["close"])
            )

            if body / candle_range <= 0.10:
                patterns.append({
                    "name": "Doji",
                    "signal": "Market indecision",
                    "confidence": 55.0,
                    "description": (
                        "The latest candle has a small body relative "
                        "to its full range."
                    ),
                    "dates": [last["date"]],
                })

            elif (
                lower_wick >= body * 2
                and upper_wick <= body
                and last["close"] >= last["open"]
            ):
                patterns.append({
                    "name": "Hammer-like Candle",
                    "signal": "Potential bullish reversal",
                    "confidence": 55.0,
                    "description": (
                        "The latest candle has a long lower wick. "
                        "Further confirmation is required."
                    ),
                    "dates": [last["date"]],
                })

    return patterns


def find_historical_similarities(
    rows,
    lookback=252,
    match_count=5,
    window=20,
):
    """Compare recent normalized price movement with past windows."""

    closes = [row["close"] for row in rows]

    if len(closes) < window * 3:
        raise ValueError(
            "There is not enough price history for similarity analysis."
        )

    lookback = min(lookback, len(closes) - window - 5)
    current = closes[-window:]

    if current[0] <= 0:
        raise ValueError("Invalid latest price window.")

    current_normalized = [
        value / current[0] for value in current
    ]

    start_index = max(0, len(closes) - lookback - window - 5)
    end_index = len(closes) - window - 5

    candidates = []

    for start in range(start_index, end_index):
        sample = closes[start:start + window]

        if len(sample) != window or sample[0] <= 0:
            continue

        normalized = [
            value / sample[0] for value in sample
        ]

        rmse = math.sqrt(
            sum(
                (a - b) ** 2
                for a, b in zip(current_normalized, normalized)
            ) / window
        )

        similarity = max(
            0.0,
            min(100.0, 100.0 * (1.0 - rmse / 0.20)),
        )

        after_index = start + window
        after_5_index = min(after_index + 5, len(closes) - 1)
        after_20_index = min(after_index + 20, len(closes) - 1)

        return_5 = (
            (closes[after_5_index] / closes[after_index] - 1) * 100
            if after_index < len(closes) else None
        )

        return_20 = (
            (closes[after_20_index] / closes[after_index] - 1) * 100
            if after_index < len(closes) else None
        )

        candidates.append({
            "start_index": start,
            "start_date": rows[start]["date"],
            "end_date": rows[start + window - 1]["date"],
            "similarity_score": round(similarity, 2),
            "historical_return_after_5_days": (
                round(return_5, 2) if return_5 is not None else None
            ),
            "historical_return_after_20_days": (
                round(return_20, 2) if return_20 is not None else None
            ),
        })

    candidates.sort(
        key=lambda item: item["similarity_score"],
        reverse=True,
    )

    selected = []

    for candidate in candidates:
        if len(selected) >= match_count:
            break

        candidate_start = candidate["start_index"]

        if any(
            abs(candidate_start - item["start_index"]) < window
            for item in selected
        ):
            continue

        selected.append(candidate)

    for item in selected:
        item.pop("start_index", None)
        item["name"] = "Historical price movement"
        item["similarity"] = item["similarity_score"]
        item["date"] = item["start_date"]
        item["description"] = (
            f"Similar movement from {item['start_date']} "
            f"to {item['end_date']}."
        )
        item["direction"] = (
            "Bullish"
            if (item["historical_return_after_20_days"] or 0) > 0
            else "Bearish"
            if (item["historical_return_after_20_days"] or 0) < 0
            else "Neutral"
        )

    return selected


# ================================================================
# PROFILE VALIDATION
# ================================================================

def validate_profile_data(data, current_user):
    name = str(
        data.get("name", get_user_value(current_user, "name", "")) or ""
    ).strip()

    email = str(
        data.get("email", get_user_value(current_user, "email", "")) or ""
    ).strip().lower()

    phone = str(
        data.get("phone", get_user_value(current_user, "phone", "")) or ""
    ).strip()

    risk_category = str(
        data.get(
            "risk_category",
            get_user_value(current_user, "risk_category", "middle"),
        ) or "middle"
    ).strip().lower()

    if not 2 <= len(name) <= 100:
        raise ValueError(
            "Name must contain between 2 and 100 characters."
        )

    email_pattern = (
        r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"
    )

    if len(email) > 254 or not re.fullmatch(email_pattern, email):
        raise ValueError("Please enter a valid email address.")

    if not re.fullmatch(r"[0-9+\-()\s]{7,20}", phone):
        raise ValueError("Please enter a valid phone number.")

    digits = sum(character.isdigit() for character in phone)

    if not 7 <= digits <= 15:
        raise ValueError("Phone number must contain 7 to 15 digits.")

    risk_mapping = {
        "low": "low",
        "medium": "middle",
        "middle": "middle",
        "high": "high",
    }

    if risk_category not in risk_mapping:
        raise ValueError("Risk category must be Low, Medium or High.")

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "risk_category": risk_mapping[risk_category],
    }


# ================================================================
# APPLICATION FACTORY
# ================================================================

def create_app():

    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )

    app.config.from_object(Config)

    if not app.config.get("SECRET_KEY"):
        raise RuntimeError(
            "SECRET_KEY is missing. Set it in your environment or .env file."
        )

    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=(
            os.getenv("COOKIE_SECURE", "false").strip().lower()
            in {"1", "true", "yes"}
        ),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )

    Config.ensure_directories()

    log_file = Path(
        getattr(Config, "LOG_FILE", "logs/market_plus_ai.log")
    )
    log_file.parent.mkdir(parents=True, exist_ok=True)

    if not any(
        isinstance(handler, RotatingFileHandler)
        for handler in app.logger.handlers
    ):
        handler = RotatingFileHandler(
            log_file,
            maxBytes=1_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        handler.setLevel(logging.INFO)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)s | %(message)s"
            )
        )
        app.logger.addHandler(handler)

    app.logger.setLevel(logging.INFO)

    with app.app_context():
        init_db()
        ensure_what_if_schema()

    app.register_blueprint(auth_bp)

    # ============================================================
    # SECURITY HEADERS
    # ============================================================

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = (
            "strict-origin-when-cross-origin"
        )
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )

        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"

        return response

    # ============================================================
    # ERROR HANDLERS
    # ============================================================

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith("/api/"):
            return api_error("API endpoint not found.", 404)
        return render_template("landing.html"), 404

    @app.errorhandler(413)
    def request_too_large(error):
        if request.path.startswith("/api/"):
            return api_error("Request is too large.", 413)
        return "Request is too large.", 413

    @app.errorhandler(500)
    def internal_server_error(error):
        app.logger.exception("Unexpected application error.")
        if request.path.startswith("/api/"):
            return api_error("An internal error occurred.", 500)
        return (
            "An internal error occurred. Check the application logs.",
            500,
        )

    # ============================================================
    # PAGE ROUTES
    # ============================================================

    @app.route("/", endpoint="index")
    def landing_page():
        return render_template("landing.html")

    @app.route("/login", endpoint="login")
    def login_page():
        return render_template("login.html")

    @app.route("/signup", endpoint="signup")
    def signup_page():
        return render_template("signup.html")

    def authenticated_page(template_name):
        user, error = authenticated_user()
        if error:
            return redirect(url_for("login"))
        return render_template(template_name)

    @app.route("/dashboard", endpoint="dashboard")
    def dashboard_page():
        return authenticated_page("dashboard.html")

    @app.route("/stock-search", endpoint="stock_search")
    def stock_search_page():
        return authenticated_page("stock_search.html")

    @app.route("/stock/<path:symbol>", endpoint="stock_details")
    def stock_details_page(symbol):
        return authenticated_page("stock_details.html")

    @app.route("/predictions", endpoint="predictions")
    def predictions_page():
        return authenticated_page("predictions.html")

    @app.route("/prediction-history", endpoint="prediction_history")
    def prediction_history_page():
        return authenticated_page("prediction_history.html")

    @app.route("/news-sentiment", endpoint="news_sentiment")
    def news_sentiment_page():
        return authenticated_page("news_sentiment.html")

    @app.route("/alerts", endpoint="alerts")
    def alerts_page():
        return authenticated_page("alerts.html")

    @app.route("/notifications", endpoint="notifications")
    def notifications_page():
        return authenticated_page("notifications.html")

    @app.route("/profile", endpoint="profile")
    def profile_page():
        return authenticated_page("profile.html")

    @app.route("/what-if-market", endpoint="what_if_market")
    def what_if_market_page():
        return authenticated_page("what_if_market.html")

    # ============================================================
    # LOGOUT
    # ============================================================

    @app.route("/api/logout", methods=["POST"])
    def api_logout_alias():
        session.clear()
        return api_success({}, "Logged out successfully.")

    # ============================================================
    # PROFILE API
    # ============================================================

    @app.route("/api/profile", methods=["GET"])
    @app.route("/api/user/profile", methods=["GET"])
    def api_profile():
        user, error = get_request_user()
        if error:
            return error

        user_id = require_user_id(user)

        with get_db() as db:
            prediction_count = db.execute(
                "SELECT COUNT(*) FROM predictions WHERE user_id = ?",
                (user_id,),
            ).fetchone()[0]

        profile = {
            "user": json_safe(user),
            "user_id": user_id,
            "name": get_user_value(user, "name", ""),
            "email": get_user_value(user, "email", ""),
            "phone": get_user_value(user, "phone", ""),
            "risk_category": get_user_value(
                user, "risk_category", "middle"
            ),
            "created_at": get_user_value(user, "created_at"),
            "prediction_count": int(prediction_count or 0),
            "realized_profit_loss": None,
            "profit_loss_available": False,
        }

        return api_success(profile)

    @app.route("/api/profile", methods=["PUT", "PATCH"])
    @app.route("/api/user/profile", methods=["PUT", "PATCH"])
    def api_update_profile():
        user, error = get_request_user()
        if error:
            return error

        user_id = require_user_id(user)

        try:
            fields = validate_profile_data(request_json(), user)

            with get_db() as db:
                existing = db.execute(
                    """
                    SELECT user_id FROM users
                    WHERE email = ? COLLATE NOCASE AND user_id != ?
                    LIMIT 1
                    """,
                    (fields["email"], user_id),
                ).fetchone()

                if existing:
                    return api_error(
                        "This email address is already registered.",
                        409,
                    )

                db.execute(
                    """
                    UPDATE users
                    SET name = ?, email = ?, phone = ?,
                        risk_category = ?, updated_at = ?
                    WHERE user_id = ?
                    """,
                    (
                        fields["name"],
                        fields["email"],
                        fields["phone"],
                        fields["risk_category"],
                        utc_now(),
                        user_id,
                    ),
                )

                updated = db.execute(
                    """
                    SELECT user_id, name, email, phone,
                           risk_category, created_at, updated_at
                    FROM users WHERE user_id = ?
                    """,
                    (user_id,),
                ).fetchone()

            if updated is None:
                return api_error("Unable to find your account.", 404)

            profile = dict(updated)

            if profile["risk_category"] == "middle":
                profile["risk_category"] = "medium"

            return api_success(
                {"user": profile, **profile},
                "Your profile has been updated successfully.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to update user profile.")
            return api_error("Unable to save your profile changes.", 500)

    # ============================================================
    # INVESTMENT TRACKER
    # ============================================================

    @app.route("/api/investments/search", methods=["GET"])
    @app.route("/api/profile/investments/search", methods=["GET"])
    def api_search_investment_assets():
        user, error = get_request_user()
        if error:
            return error

        query = (
            request.args.get("q")
            or request.args.get("query")
            or request.args.get("search")
            or ""
        ).strip()

        if len(query) > 100:
            return api_error("Search query is too long.", 400)

        if len(query) < 2:
            payload = {"results": [], "assets": [], "count": 0}
            return jsonify({
                "success": True,
                "data": payload,
                **payload,
            })

        try:
            function = import_service(
                "backend.investment_service",
                "search_investment_assets",
            )
            results = service_call(
                function,
                query=query,
                limit=requested_limit(10, 20),
            ) or []

            payload = {
                "results": results,
                "assets": results,
                "count": len(results),
            }

            return jsonify({
                "success": True,
                "data": json_safe(payload),
                **json_safe(payload),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Investment asset search failed.")
            return api_error(
                "Unable to search investment assets right now.",
                502,
            )

    @app.route("/api/investments", methods=["GET"])
    @app.route("/api/profile/investments", methods=["GET"])
    def api_get_investments():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.investment_service",
                "get_investment_summary",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
            )
            return api_success(result, "Investment records loaded.")
        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to retrieve investment records.")
            return api_error("Unable to retrieve investment records.", 500)

    @app.route("/api/investments", methods=["POST"])
    @app.route("/api/profile/investments", methods=["POST"])
    def api_add_investment():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.investment_service",
                "add_investment_trade",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                data=request_json(),
            )
            return api_success(
                result,
                "Investment record added successfully.",
                201,
            )
        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to add investment record.")
            return api_error("Unable to add investment record.", 500)

    @app.route(
        "/api/investments/<int:trade_id>/close",
        methods=["POST", "PATCH"],
    )
    @app.route(
        "/api/profile/investments/<int:trade_id>/close",
        methods=["POST", "PATCH"],
    )
    def api_close_investment(trade_id):
        user, error = get_request_user()
        if error:
            return error

        data = request_json()
        withdrawal_price = (
            data.get("withdrawal_price")
            if data.get("withdrawal_price") is not None
            else data.get("sell_price")
        )
        withdrawal_date = (
            data.get("withdrawal_date") or data.get("sell_date")
        )

        try:
            function = import_service(
                "backend.investment_service",
                "close_investment_trade",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                trade_id=trade_id,
                withdrawal_price=withdrawal_price,
                sell_price=withdrawal_price,
                sell_date=withdrawal_date,
            )
            return api_success(
                result,
                "Investment completed successfully.",
            )
        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to complete investment %s.", trade_id
            )
            return api_error("Unable to complete investment record.", 500)

    @app.route("/api/investments/<int:trade_id>", methods=["DELETE"])
    @app.route(
        "/api/profile/investments/<int:trade_id>",
        methods=["DELETE"],
    )
    def api_delete_investment(trade_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.investment_service",
                "delete_investment_trade",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                trade_id=trade_id,
            )
            return api_success(result, "Investment record deleted.")
        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to delete investment %s.", trade_id
            )
            return api_error("Unable to delete investment record.", 500)

    # ============================================================
    # DASHBOARD
    # ============================================================

    @app.route("/api/dashboard", methods=["GET"])
    @app.route("/api/dashboard/summary", methods=["GET"])
    def api_dashboard():
        user, error = get_request_user()
        if error:
            return error

        user_id = require_user_id(user)

        try:
            with get_db() as db:
                prediction_count = db.execute(
                    """
                    SELECT COUNT(*) FROM predictions
                    WHERE user_id = ?
                    """,
                    (user_id,),
                ).fetchone()[0]

                recent = db.execute(
                    """
                    SELECT id, symbol, horizon_days, reference_price,
                           predicted_price, predicted_change,
                           predicted_change_percent, model_name,
                           risk_category, explanation, created_at
                    FROM predictions
                    WHERE user_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT 5
                    """,
                    (user_id,),
                ).fetchall()

                active_alerts = db.execute(
                    """
                    SELECT COUNT(*) FROM alerts
                    WHERE user_id = ? AND status = 'active'
                    """,
                    (user_id,),
                ).fetchone()[0]

                triggered_alerts = db.execute(
                    """
                    SELECT COUNT(*) FROM alerts
                    WHERE user_id = ? AND status = 'triggered'
                    """,
                    (user_id,),
                ).fetchone()[0]

                unread = db.execute(
                    """
                    SELECT COUNT(*) FROM notifications
                    WHERE user_id = ? AND is_read = 0
                    """,
                    (user_id,),
                ).fetchone()[0]

            predictions = json_safe([dict(row) for row in recent])
            safe_user = json_safe(user)

            payload = {
                "user": safe_user,
                "profile": safe_user,
                "prediction_count": int(prediction_count or 0),
                "total_predictions": int(prediction_count or 0),
                "active_alerts": int(active_alerts or 0),
                "triggered_alerts": int(triggered_alerts or 0),
                "unread_notifications": int(unread or 0),
                "unread_notification_count": int(unread or 0),
                "recent_predictions": predictions,
                "predictions": predictions,
                "message": "Dashboard data loaded.",
            }

            return jsonify({
                "success": True,
                "data": payload,
                **payload,
            })

        except Exception:
            app.logger.exception("Unable to load dashboard.")
            return api_error("Unable to load dashboard data.", 500)

    # ============================================================
    # STOCK SEARCH
    # ============================================================

    @app.route("/api/stocks/search", methods=["GET"])
    @app.route("/api/assets/search", methods=["GET"])
    @app.route("/api/stock/search", methods=["GET"])
    def api_stock_search():
        user, error = get_request_user()
        if error:
            return error

        query = (
            request.args.get("q")
            or request.args.get("query")
            or request.args.get("search")
            or ""
        ).strip()

        if not query:
            return api_error(
                "Please enter a stock name or symbol.",
                400,
            )

        try:
            function = import_service(
                "backend.stock_service",
                "search_stocks",
            )
            results = service_call(
                function,
                query=query,
                limit=requested_limit(10, 30),
            )

            if isinstance(results, dict):
                results = (
                    results.get("results")
                    or results.get("stocks")
                    or results.get("assets")
                    or []
                )

            if not isinstance(results, list):
                results = []

            payload = {
                "results": results,
                "stocks": results,
                "assets": results,
                "count": len(results),
            }

            return jsonify({
                "success": True,
                "data": json_safe(payload),
                **json_safe(payload),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Stock search failed.")
            return api_error("Unable to search stocks right now.", 502)

    # ============================================================
    # STOCK DETAILS
    # ============================================================

    @app.route("/api/stocks/<path:symbol>", methods=["GET"])
    @app.route("/api/assets/<path:symbol>", methods=["GET"])
    @app.route("/api/stock/<path:symbol>", methods=["GET"])
    def api_stock_details(symbol):
        user, error = get_request_user()
        if error:
            return error

        try:
            resolved = resolve_alert_symbol(symbol)
            function = import_service(
                "backend.stock_service",
                "get_stock_details",
            )
            result = service_call(function, symbol=resolved)

            if not isinstance(result, dict):
                return api_error(
                    "The stock service returned invalid data.",
                    502,
                )

            result = dict(result)
            result.setdefault("symbol", resolved)

            if result.get("last_volume") is None:
                result["last_volume"] = result.get("volume")

            try:
                current_price = next(
                    (
                        optional_float(result.get(key))
                        for key in (
                            "last_price",
                            "current_price",
                            "price",
                            "regular_market_price",
                        )
                        if optional_float(result.get(key)) is not None
                    ),
                    None,
                )

                if current_price is not None:
                    evaluate_function = import_service(
                        "backend.alert_service",
                        "evaluate_alerts",
                    )
                    service_call(
                        evaluate_function,
                        symbol=resolved,
                        current_price=current_price,
                    )
            except Exception:
                app.logger.exception(
                    "Alert evaluation failed for %s.", resolved
                )

            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to load stock details for %s.", symbol
            )
            return api_error("Unable to load stock details right now.", 502)

    # ============================================================
    # STOCK CHART
    # ============================================================

    @app.route("/api/stocks/<path:symbol>/chart", methods=["GET"])
    def api_stock_chart(symbol):
        user, error = get_request_user()
        if error:
            return error

        period = (
            request.args.get("period") or "6mo"
        ).strip().lower()

        allowed = {
            "1d", "5d", "1mo", "3mo", "6mo",
            "1y", "2y", "5y", "max",
        }

        if period not in allowed:
            return api_error("Unsupported chart period.", 400)

        try:
            resolved = resolve_alert_symbol(symbol)
            function = import_service(
                "backend.stock_service",
                "get_stock_chart",
            )
            result = service_call(
                function,
                symbol=resolved,
                period=period,
            )
            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to load chart for %s.", symbol
            )
            return api_error("Unable to load stock chart right now.", 502)

    # ============================================================
    # AI PREDICTIONS
    # ============================================================

    @app.route("/api/prediction", methods=["POST"])
    @app.route("/api/predict", methods=["POST"])
    @app.route("/api/predictions", methods=["POST"])
    def api_predict():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()
        symbol_input = (
            data.get("symbol")
            or data.get("ticker")
            or data.get("asset")
            or ""
        )

        raw_horizon = (
            data.get("horizon_days")
            or data.get("duration_days")
            or data.get("duration")
            or data.get("days")
            or 1
        )

        user_id = require_user_id(user)

        try:
            symbol = resolve_alert_symbol(symbol_input)

            try:
                horizon = int(raw_horizon)
            except (TypeError, ValueError):
                return api_error(
                    "Prediction duration must be a valid number.",
                    400,
                )

            if horizon not in SUPPORTED_PREDICTION_HORIZONS:
                return api_error(
                    "Supported prediction durations are 1, 7 and 30 days.",
                    400,
                )

            risk = str(
                data.get("risk_category")
                or get_user_value(user, "risk_category", "middle")
                or "middle"
            ).strip().lower()

            if risk == "medium":
                risk = "middle"

            if risk not in SUPPORTED_RISK_CATEGORIES:
                return api_error(
                    "Risk category must be Low, Medium or High.",
                    400,
                )

            model = normalized_prediction_model(data.get("model_name"))

            function = import_service(
                "backend.predictor",
                "generate_prediction",
            )
            prediction = service_call(
                function,
                symbol=symbol,
                horizon_days=horizon,
                risk_category=risk,
                model_name=model,
                save_to_database=False,
            )

            if not isinstance(prediction, dict):
                return api_error(
                    "The prediction service returned invalid data.",
                    502,
                )

            prediction = dict(prediction)
            prediction.setdefault("symbol", symbol)
            prediction.setdefault("horizon_days", horizon)
            prediction.setdefault("model_name", model)
            prediction.setdefault("disclaimer", PREDICTION_DISCLAIMER)

            save_history = parse_boolean(
                data.get("save_history"),
                default=True,
            )

            prediction_id = None
            save_note = None

            if save_history:
                try:
                    save_function = import_service(
                        "backend.predictor",
                        "save_prediction_for_user",
                    )
                    saved = service_call(
                        save_function,
                        prediction=prediction,
                        user_id=user_id,
                    )

                    if isinstance(saved, dict):
                        prediction_id = (
                            saved.get("id")
                            or saved.get("prediction_id")
                        )
                    else:
                        prediction_id = saved

                except Exception:
                    app.logger.exception(
                        "Prediction generated but history saving failed."
                    )
                    save_note = (
                        "Prediction generated, but it could not "
                        "be saved to prediction history."
                    )

            prediction["prediction_id"] = prediction_id
            prediction["id"] = prediction_id
            prediction["saved"] = prediction_id is not None
            prediction["save_note"] = save_note

            return jsonify({
                "success": True,
                "message": "Prediction generated successfully.",
                "data": json_safe(prediction),
                **json_safe(prediction),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Prediction generation failed.")
            return api_error(
                "Unable to generate a prediction right now. "
                "Check the backend logs for details.",
                502,
            )

    # ============================================================
    # PREDICTION HISTORY
    # ============================================================

    @app.route("/api/predictions/history", methods=["GET"])
    @app.route("/api/prediction/history", methods=["GET"])
    @app.route("/api/prediction-history", methods=["GET"])
    @app.route("/api/history", methods=["GET"])
    @app.route("/api/history/predictions", methods=["GET"])
    @app.route("/api/user/predictions", methods=["GET"])
    def api_prediction_history():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.predictor",
                "get_prediction_history",
            )
            records = service_call(
                function,
                user_id=require_user_id(user),
                limit=requested_limit(50, 100),
            ) or []

            payload = {
                "history": records,
                "predictions": records,
                "records": records,
                "count": len(records),
            }

            return jsonify({
                "success": True,
                "data": json_safe(payload),
                **json_safe(payload),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to load prediction history.")
            return api_error("Unable to load prediction history.", 500)

    # ============================================================
    # WHAT-IF MARKET — CALCULATOR
    # ============================================================

    @app.route("/api/what-if/calculate", methods=["POST"])
    def api_what_if_calculate():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            symbol = resolve_alert_symbol(
                data.get("symbol")
                or data.get("ticker")
                or data.get("asset")
            )

            investment = positive_number(
                data.get("investment_amount", 10000),
                "Investment amount",
            )

            manual_entry = data.get("current_price")
            if manual_entry in (None, ""):
                manual_entry = data.get("entry_price")

            entry_price = (
                positive_number(manual_entry, "Current price")
                if manual_entry not in (None, "")
                else None
            )

            predicted_raw = data.get("predicted_price")
            if predicted_raw in (None, ""):
                predicted_raw = data.get("ai_predicted_price")

            predicted_price = (
                positive_number(predicted_raw, "Predicted price")
                if predicted_raw not in (None, "")
                else None
            )

            adjusted_raw = data.get("adjusted_price")
            adjusted_price = (
                positive_number(adjusted_raw, "Adjusted price")
                if adjusted_raw not in (None, "")
                else None
            )

            horizon_raw = data.get(
                "horizon_days",
                data.get("duration", 7),
            )

            try:
                horizon = int(horizon_raw)
            except (TypeError, ValueError):
                raise ValueError(
                    "Duration must be a valid number."
                ) from None

            if horizon not in {1, 7, 30, 90}:
                raise ValueError(
                    "What-If duration must be 1, 7, 30 or 90 days."
                )

            model_name = str(
                data.get("model_name")
                or data.get("model")
                or ""
            ).strip()[:80]

            scenario_changes = dict(WHAT_IF_DEFAULT_SCENARIOS)

            reference_price = adjusted_price or predicted_price

            if reference_price is not None and entry_price is not None:
                neutral_change = (
                    (reference_price / entry_price) - 1
                ) * 100

                if not math.isfinite(neutral_change):
                    raise ValueError(
                        "The adjusted price is outside the valid range."
                    )

                scenario_changes["neutral"] = neutral_change

            function = import_service(
                "backend.what_if_service",
                "calculate_what_if_scenarios",
            )

            result = service_call(
                function,
                symbol=symbol,
                investment_amount=investment,
                entry_price=entry_price,
                current_price=entry_price,
                scenarios=scenario_changes,
            )

            if not isinstance(result, dict):
                return api_error(
                    "The What-If calculator returned invalid data.",
                    502,
                )

            result = dict(result)
            result["symbol"] = result.get("symbol") or symbol
            result["investment_amount"] = investment
            result["ai_predicted_price"] = predicted_price
            result["adjusted_price"] = adjusted_price
            result["horizon_days"] = horizon
            result["model_name"] = model_name
            result["prediction_id"] = data.get("prediction_id")
            result["scenario_changes"] = scenario_changes
            result["calculation_type"] = "hypothetical_scenario"
            result["disclaimer"] = WHAT_IF_DISCLAIMER

            # Add a stable response shape for the frontend.
            result.setdefault("current_price", entry_price)
            result.setdefault("entry_price", entry_price)

            scenarios = result.get("scenarios") or result.get("results")

            if isinstance(scenarios, list):
                scenarios = {
                    str(item.get("name", "")).lower(): item
                    for item in scenarios
                    if isinstance(item, dict)
                }

            if isinstance(scenarios, dict):
                result["scenarios"] = scenarios
                result["results"] = scenarios

            return api_success(
                result,
                "What-If scenarios calculated successfully.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("What-If calculation failed.")
            return api_error(
                "Unable to calculate What-If scenarios right now.",
                502,
            )

    # ============================================================
    # WHAT-IF MARKET — TECHNICAL PATTERN SEARCH
    # ============================================================

    @app.route(
        "/api/what-if/patterns/technical",
        methods=["POST"],
    )
    def api_what_if_technical_patterns():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            symbol = resolve_alert_symbol(
                data.get("symbol")
                or data.get("ticker")
                or data.get("asset")
            )

            period = str(data.get("period") or "1y").lower().strip()

            if period not in {"6mo", "1y", "2y", "5y", "max"}:
                period = "1y"

            rows = load_pattern_chart(symbol, period=period)
            patterns = analyse_technical_patterns(rows)

            requested_patterns = data.get("patterns")

            if isinstance(requested_patterns, list) and requested_patterns:
                requested_names = {
                    str(item).strip().lower()
                    for item in requested_patterns
                }

                patterns = [
                    item for item in patterns
                    if item["name"].lower() in requested_names
                ]

            payload = {
                "symbol": symbol,
                "patterns": patterns,
                "results": patterns,
                "matches": patterns,
                "count": len(patterns),
                "sample_count": len(rows),
                "latest_price": rows[-1]["close"],
                "latest_date": rows[-1]["date"],
                "analysis_type": "rule_based_technical_scan",
                "disclaimer": (
                    "Patterns are candidate technical formations, "
                    "not confirmed signals. They do not predict "
                    "future returns."
                ),
            }

            return api_success(
                payload,
                "Technical pattern scan completed.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Technical pattern search failed."
            )
            return api_error(
                "Unable to analyse technical patterns right now.",
                502,
            )

    # ============================================================
    # WHAT-IF MARKET — HISTORICAL SIMILARITY SEARCH
    # ============================================================

    @app.route(
        "/api/what-if/patterns/similarity",
        methods=["POST"],
    )
    def api_what_if_similarity():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            symbol = resolve_alert_symbol(
                data.get("symbol")
                or data.get("ticker")
                or data.get("asset")
            )

            try:
                lookback = int(
                    data.get(
                        "lookback_days",
                        data.get("lookback", 252),
                    )
                )
                match_count = int(data.get("match_count", 5))
                window = int(data.get("window", 20))
            except (TypeError, ValueError):
                raise ValueError(
                    "Similarity search settings must be whole numbers."
                ) from None

            if not 60 <= lookback <= 1260:
                raise ValueError(
                    "Lookback must be between 60 and 1260 trading days."
                )

            if not 1 <= match_count <= 10:
                raise ValueError(
                    "Match count must be between 1 and 10."
                )

            if not 10 <= window <= 60:
                raise ValueError(
                    "Pattern window must be between 10 and 60 days."
                )

            rows = load_pattern_chart(symbol, period="5y")

            matches = find_historical_similarities(
                rows,
                lookback=lookback,
                match_count=match_count,
                window=window,
            )

            payload = {
                "symbol": symbol,
                "matches": matches,
                "results": matches,
                "patterns": matches,
                "count": len(matches),
                "lookback": lookback,
                "lookback_days": lookback,
                "window": window,
                "sample_count": len(rows),
                "latest_price": rows[-1]["close"],
                "method": "normalized_price_path_rmse",
                "disclaimer": (
                    "Historical similarity measures resemblance between "
                    "past price paths. Subsequent historical returns are "
                    "not forecasts and do not guarantee future outcomes."
                ),
            }

            return api_success(
                payload,
                "Historical similarity search completed.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Historical similarity search failed."
            )
            return api_error(
                "Unable to search historical price patterns right now.",
                502,
            )

    # ============================================================
    # WHAT-IF MARKET — SAVE SCENARIO
    # ============================================================

    @app.route("/api/what-if/scenarios", methods=["POST"])
    def api_save_what_if_scenario():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            user_id = require_user_id(user)

            scenario_name = str(
                data.get("scenario_name")
                or data.get("name")
                or "My What-If Scenario"
            ).strip()

            if not scenario_name or len(scenario_name) > 100:
                raise ValueError(
                    "Scenario name must contain 1 to 100 characters."
                )

            result = data.get("result")

            if result is None:
                result = data.get("scenario")

            if result is None:
                result = data.get("data")

            if not isinstance(result, dict):
                raise ValueError(
                    "A valid calculated scenario result is required."
                )

            result = json_safe(result)

            symbol = normalized_symbol(
                result.get("symbol") or data.get("symbol")
            )

            investment_value = (
                result.get("investment_amount")
                or data.get("investment_amount")
            )

            if investment_value is None:
                input_data = data.get("input")
                if isinstance(input_data, dict):
                    investment_value = input_data.get("investment_amount")

            investment = positive_number(
                investment_value,
                "Investment amount",
            )

            input_data = data.get("input")
            if not isinstance(input_data, dict):
                input_data = {}

            entry_price = (
                optional_float(result.get("entry_price"))
                or optional_float(result.get("current_price"))
                or optional_float(input_data.get("current_price"))
                or optional_float(data.get("entry_price"))
            )

            if entry_price is None or entry_price <= 0:
                raise ValueError(
                    "The scenario result does not contain a valid entry price."
                )

            predicted_price = (
                optional_float(result.get("ai_predicted_price"))
                or optional_float(input_data.get("predicted_price"))
                or optional_float(data.get("predicted_price"))
            )

            horizon = (
                result.get("horizon_days")
                or input_data.get("duration")
                or data.get("horizon_days")
            )

            try:
                horizon = int(horizon) if horizon is not None else None
            except (TypeError, ValueError):
                horizon = None

            model_name = str(
                result.get("model_name")
                or input_data.get("model")
                or data.get("model_name")
                or data.get("model")
                or ""
            )[:80]

            company_name = str(
                result.get("company_name")
                or result.get("name")
                or data.get("company_name")
                or ""
            )[:200]

            result["symbol"] = symbol
            result["investment_amount"] = investment
            result["entry_price"] = entry_price
            result["ai_predicted_price"] = predicted_price
            result["horizon_days"] = horizon
            result["model_name"] = model_name

            result_json = json.dumps(
                result,
                ensure_ascii=False,
                allow_nan=False,
            )

            if len(result_json) > 200_000:
                raise ValueError(
                    "Scenario result is too large to save."
                )

            now = utc_now()

            with get_db() as db:
                cursor = db.execute(
                    """
                    INSERT INTO what_if_scenarios (
                        user_id,
                        scenario_name,
                        symbol,
                        company_name,
                        investment_amount,
                        entry_price,
                        predicted_price,
                        horizon_days,
                        model_name,
                        result_json,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        scenario_name,
                        symbol,
                        company_name,
                        investment,
                        entry_price,
                        predicted_price,
                        horizon,
                        model_name,
                        result_json,
                        now,
                        now,
                    ),
                )

                scenario_id = cursor.lastrowid

            return api_success(
                {
                    "id": scenario_id,
                    "scenario_id": scenario_id,
                    "scenario_name": scenario_name,
                    "symbol": symbol,
                    "created_at": now,
                },
                "What-If scenario saved successfully.",
                201,
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to save What-If scenario.")
            return api_error(
                "Unable to save this What-If scenario.",
                500,
            )

    # ============================================================
    # WHAT-IF MARKET — LIST SCENARIOS
    # ============================================================

    @app.route("/api/what-if/scenarios", methods=["GET"])
    def api_get_what_if_scenarios():
        user, error = get_request_user()
        if error:
            return error

        try:
            user_id = require_user_id(user)
            limit = requested_limit(20, 100)
            offset = requested_offset()

            with get_db() as db:
                rows = db.execute(
                    """
                    SELECT
                        id,
                        scenario_name,
                        symbol,
                        company_name,
                        investment_amount,
                        entry_price,
                        predicted_price,
                        horizon_days,
                        model_name,
                        result_json,
                        created_at,
                        updated_at
                    FROM what_if_scenarios
                    WHERE user_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT ? OFFSET ?
                    """,
                    (user_id, limit, offset),
                ).fetchall()

                total = db.execute(
                    """
                    SELECT COUNT(*)
                    FROM what_if_scenarios
                    WHERE user_id = ?
                    """,
                    (user_id,),
                ).fetchone()[0]

            scenarios = []

            for row in rows:
                item = dict(row)

                try:
                    item["result"] = json.loads(
                        item.pop("result_json")
                    )
                except (TypeError, ValueError, json.JSONDecodeError):
                    item["result"] = {}

                scenarios.append(item)

            payload = {
                "scenarios": scenarios,
                "count": len(scenarios),
                "total": int(total or 0),
                "limit": limit,
                "offset": offset,
            }

            return api_success(
                payload,
                "What-If scenario history loaded.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to load What-If scenario history."
            )
            return api_error(
                "Unable to load What-If scenario history.",
                500,
            )

    # ============================================================
    # WHAT-IF MARKET — GET ONE SAVED SCENARIO
    # ============================================================

    @app.route(
        "/api/what-if/scenarios/<int:scenario_id>",
        methods=["GET"],
    )
    def api_get_single_what_if_scenario(scenario_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            user_id = require_user_id(user)

            with get_db() as db:
                row = db.execute(
                    """
                    SELECT
                        id,
                        scenario_name,
                        symbol,
                        company_name,
                        investment_amount,
                        entry_price,
                        predicted_price,
                        horizon_days,
                        model_name,
                        result_json,
                        created_at,
                        updated_at
                    FROM what_if_scenarios
                    WHERE id = ? AND user_id = ?
                    LIMIT 1
                    """,
                    (scenario_id, user_id),
                ).fetchone()

            if row is None:
                return api_error("What-If scenario not found.", 404)

            item = dict(row)

            try:
                item["result"] = json.loads(item.pop("result_json"))
            except (TypeError, ValueError, json.JSONDecodeError):
                item["result"] = {}

            item["scenario"] = item["result"]

            return api_success(
                item,
                "Saved What-If scenario loaded.",
            )

        except Exception:
            app.logger.exception(
                "Unable to load What-If scenario %s.",
                scenario_id,
            )
            return api_error(
                "Unable to load the saved What-If scenario.",
                500,
            )

    # ============================================================
    # WHAT-IF MARKET — DELETE SCENARIO
    # ============================================================

    @app.route(
        "/api/what-if/scenarios/<int:scenario_id>",
        methods=["DELETE"],
    )
    def api_delete_what_if_scenario(scenario_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            user_id = require_user_id(user)

            with get_db() as db:
                cursor = db.execute(
                    """
                    DELETE FROM what_if_scenarios
                    WHERE id = ? AND user_id = ?
                    """,
                    (scenario_id, user_id),
                )

                deleted = cursor.rowcount

            if not deleted:
                return api_error(
                    "What-If scenario not found.",
                    404,
                )

            return api_success(
                {"id": scenario_id},
                "What-If scenario deleted successfully.",
            )

        except Exception:
            app.logger.exception(
                "Unable to delete What-If scenario %s.",
                scenario_id,
            )
            return api_error(
                "Unable to delete What-If scenario.",
                500,
            )

    # ============================================================
    # WHAT-IF MARKET — PDF REPORT
    # ============================================================

    @app.route("/api/what-if/report", methods=["POST"])
    def api_what_if_report():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            result = data.get("result")

            if result is None:
                result = data.get("scenario")

            if not isinstance(result, dict):
                raise ValueError(
                    "A valid What-If result is required to create a report."
                )

            result = json_safe(result)

            # ReportLab is used when installed. If it is not installed,
            # return a clear dependency error instead of a broken file.
            try:
                from reportlab.lib import colors
                from reportlab.lib.pagesizes import A4
                from reportlab.lib.styles import getSampleStyleSheet
                from reportlab.lib.units import mm
                from reportlab.platypus import (
                    SimpleDocTemplate,
                    Paragraph,
                    Spacer,
                    Table,
                    TableStyle,
                )
            except ImportError:
                return api_error(
                    "PDF export requires ReportLab. Install it with: "
                    "pip install reportlab",
                    501,
                )

            buffer = io.BytesIO()

            document = SimpleDocTemplate(
                buffer,
                pagesize=A4,
                rightMargin=18 * mm,
                leftMargin=18 * mm,
                topMargin=18 * mm,
                bottomMargin=18 * mm,
                title="Market Plus AI - What-If Report",
                author="Market Plus AI",
            )

            styles = getSampleStyleSheet()
            story = []

            story.append(
                Paragraph(
                    "Market Plus AI - What-If Market Report",
                    styles["Title"],
                )
            )
            story.append(Spacer(1, 8))

            symbol = str(result.get("symbol") or "N/A")
            company = str(
                result.get("company_name")
                or result.get("name")
                or symbol
            )

            story.append(
                Paragraph(
                    f"<b>Asset:</b> {company} ({symbol})",
                    styles["Normal"],
                )
            )
            story.append(
                Paragraph(
                    f"<b>Generated:</b> {utc_now()}",
                    styles["Normal"],
                )
            )
            story.append(Spacer(1, 12))

            summary_rows = [
                ["Metric", "Value"],
                [
                    "Investment amount",
                    str(result.get("investment_amount", "N/A")),
                ],
                [
                    "Entry price",
                    str(result.get("entry_price", "N/A")),
                ],
                [
                    "Current price",
                    str(result.get("current_price", "N/A")),
                ],
                [
                    "AI predicted price",
                    str(result.get("ai_predicted_price", "N/A")),
                ],
                [
                    "Duration (days)",
                    str(result.get("horizon_days", "N/A")),
                ],
                [
                    "Prediction model",
                    str(result.get("model_name", "N/A")),
                ],
            ]

            summary_table = Table(
                summary_rows,
                colWidths=[65 * mm, 95 * mm],
                repeatRows=1,
            )
            summary_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18243A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ("PADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            story.append(summary_table)
            story.append(Spacer(1, 14))

            scenarios = result.get("scenarios") or result.get("results") or {}

            if isinstance(scenarios, list):
                scenarios = {
                    str(item.get("name", f"Scenario {index + 1}")): item
                    for index, item in enumerate(scenarios)
                    if isinstance(item, dict)
                }

            if isinstance(scenarios, dict) and scenarios:
                story.append(
                    Paragraph("Scenario Comparison", styles["Heading2"])
                )

                scenario_rows = [[
                    "Scenario",
                    "Future price",
                    "Final value",
                    "Profit / Loss",
                    "ROI",
                ]]

                for scenario_name, scenario in scenarios.items():
                    if not isinstance(scenario, dict):
                        continue

                    scenario_rows.append([
                        str(scenario_name).title(),
                        str(scenario.get("future_price", "N/A")),
                        str(scenario.get("final_value", "N/A")),
                        str(scenario.get("profit_loss", "N/A")),
                        (
                            f"{scenario.get('roi')}%"
                            if scenario.get("roi") is not None
                            else "N/A"
                        ),
                    ])

                scenario_table = Table(
                    scenario_rows,
                    repeatRows=1,
                )
                scenario_table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18243A")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                    ("PADDING", (0, 0), (-1, -1), 6),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]))
                story.append(scenario_table)

            story.append(Spacer(1, 14))
            story.append(
                Paragraph(
                    WHAT_IF_DISCLAIMER,
                    styles["Italic"],
                )
            )

            document.build(story)
            buffer.seek(0)

            filename = f"Market_Plus_AI_What_If_{symbol}.pdf"

            return send_file(
                buffer,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=filename,
                max_age=0,
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to generate What-If PDF report.")
            return api_error(
                "Unable to generate the What-If PDF report.",
                500,
            ) 
            # ============================================================
    # PRICE ALERTS
    # ============================================================

    @app.route("/api/alerts", methods=["GET"])
    def api_get_alerts():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "get_alerts",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                status=request.args.get("status"),
                symbol=(
                    normalized_symbol(request.args["symbol"])
                    if request.args.get("symbol")
                    else None
                ),
                limit=requested_limit(100, 100),
                offset=requested_offset(),
            )

            if isinstance(result, dict):
                alerts = result.get("alerts") or result.get("results") or []
            elif isinstance(result, list):
                alerts = result
            else:
                alerts = []

            payload = {
                "alerts": alerts,
                "count": len(alerts),
                "limit": requested_limit(100, 100),
                "offset": requested_offset(),
            }

            return jsonify({
                "success": True,
                "data": json_safe(payload),
                **json_safe(payload),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to load price alerts.")
            return api_error("Unable to load price alerts.", 500)

    @app.route("/api/alerts", methods=["POST"])
    def api_create_alert():
        user, error = get_request_user()
        if error:
            return error

        data = request_json()

        try:
            symbol = resolve_alert_symbol(
                data.get("symbol")
                or data.get("ticker")
                or data.get("asset")
            )

            target = (
                data.get("target_price")
                if data.get("target_price") is not None
                else data.get("target")
            )

            if target is None:
                target = data.get("price")

            target = positive_number(target, "Target price")

            condition = str(
                data.get("alert_type")
                or data.get("condition")
                or "target_reached"
            ).strip().lower()

            if condition == "target_reached":
                condition = "reaches"

            if condition not in {"reaches", "above", "below"}:
                raise ValueError("Invalid alert condition.")

            raw_channels = (
                data.get("notification_channels")
                if data.get("notification_channels") is not None
                else data.get("channels")
            )

            if isinstance(raw_channels, str):
                channels = {
                    item.strip().lower()
                    for item in raw_channels.split(",")
                    if item.strip()
                }
            elif isinstance(raw_channels, (list, tuple, set)):
                channels = {
                    str(item).strip().lower()
                    for item in raw_channels
                    if str(item).strip()
                }
            elif raw_channels is None:
                channels = set()
            else:
                raise ValueError("Invalid notification channels.")

            if channels - {"in_app", "email", "sms"}:
                raise ValueError(
                    "One or more notification channels are unsupported."
                )

            if "sms" in channels:
                return api_error(
                    "SMS notifications are not currently supported. "
                    "Please choose in-app notifications or email.",
                    400,
                    unsupported_channel="sms",
                )

            currency = (
                data.get("currency")
                or data.get("preferred_currency")
                or get_user_value(user, "preferred_currency", "INR")
                or "INR"
            )

            if not isinstance(currency, str) or not currency.strip():
                raise ValueError("Please select a valid currency.")

            function = import_service(
                "backend.alert_service",
                "create_alert",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                symbol=symbol,
                target_price=target,
                condition=condition,
                currency=currency.strip().upper(),
                email_enabled="email" in channels,
                sms_enabled=False,
            )

            return api_success(
                result,
                "Price alert created successfully.",
                201,
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to create price alert.")
            return api_error("Unable to create price alert.", 500)

    @app.route("/api/alerts/<int:alert_id>", methods=["GET"])
    def api_get_single_alert(alert_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "get_alert",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                alert_id=alert_id,
            )

            if result is None:
                return api_error("Alert not found.", 404)

            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to retrieve alert %s.", alert_id)
            return api_error("Unable to retrieve alert.", 500)

    @app.route(
        "/api/alerts/<int:alert_id>",
        methods=["DELETE"],
    )
    @app.route(
        "/api/alerts/<int:alert_id>/cancel",
        methods=["POST"],
    )
    def api_cancel_alert(alert_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "cancel_alert",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                alert_id=alert_id,
            )
            return api_success(
                result,
                "Price alert cancelled successfully.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to cancel alert %s.", alert_id)
            return api_error("Unable to cancel price alert.", 500)

    @app.route("/api/alerts/summary", methods=["GET"])
    def api_alert_summary():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "get_alert_summary",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
            )
            return api_success(result)

        except Exception:
            app.logger.exception("Unable to load alert summary.")
            return api_error("Unable to load alert summary.", 500)

    # ============================================================
    # NOTIFICATIONS
    # ============================================================

    @app.route("/api/notifications", methods=["GET"])
    def api_get_notifications():
        user, error = get_request_user()
        if error:
            return error

        try:
            user_id = require_user_id(user)
            limit = requested_limit(50, 200)
            offset = requested_offset()
            unread_only = parse_boolean(
                request.args.get("unread_only"),
                default=False,
            )

            function = import_service(
                "backend.alert_service",
                "get_notifications",
            )
            notifications = service_call(
                function,
                user_id=user_id,
                limit=limit,
                offset=offset,
                unread_only=unread_only,
            )

            if isinstance(notifications, dict):
                notifications = (
                    notifications.get("notifications")
                    or notifications.get("results")
                    or []
                )

            if not isinstance(notifications, list):
                notifications = []

            count_function = import_service(
                "backend.alert_service",
                "get_unread_notification_count",
            )
            unread_count = service_call(
                count_function,
                user_id=user_id,
            )

            payload = {
                "notifications": notifications,
                "count": len(notifications),
                "unread_count": unread_count,
                "limit": limit,
                "offset": offset,
                "unread_only": unread_only,
            }

            return jsonify({
                "success": True,
                "data": json_safe(payload),
                **json_safe(payload),
            })

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to load notifications.")
            return api_error("Unable to load notifications.", 500)

    @app.route("/api/notifications/unread-count", methods=["GET"])
    def api_unread_notification_count():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "get_unread_notification_count",
            )
            count = service_call(
                function,
                user_id=require_user_id(user),
            )
            return jsonify({
                "success": True,
                "count": count,
                "unread_count": count,
            })
        except Exception:
            app.logger.exception(
                "Unable to load unread notification count."
            )
            return api_error(
                "Unable to load unread notification count.",
                500,
            )

    @app.route(
        "/api/notifications/<int:notification_id>/read",
        methods=["POST", "PATCH"],
    )
    def api_mark_notification_read(notification_id):
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "mark_notification_read",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
                notification_id=notification_id,
            )
            return api_success(result, "Notification marked as read.")
        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception(
                "Unable to mark notification as read."
            )
            return api_error("Unable to update notification.", 500)

    @app.route("/api/notifications/read-all", methods=["POST"])
    def api_mark_all_notifications_read():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.alert_service",
                "mark_all_notifications_read",
            )
            result = service_call(
                function,
                user_id=require_user_id(user),
            )
            return api_success(
                result,
                "All notifications marked as read.",
            )
        except Exception:
            app.logger.exception(
                "Unable to mark all notifications as read."
            )
            return api_error("Unable to update notifications.", 500)

    # ============================================================
    # NEWS AND SENTIMENT
    # ============================================================

    def news_limit():
        return requested_limit(10, 50)

    def news_refresh():
        return parse_boolean(
            request.args.get("refresh"),
            default=False,
        )

    def news_symbol():
        value = (
            request.args.get("symbol")
            or request.args.get("ticker")
            or request.args.get("query")
            or ""
        ).strip()

        if not value:
            raise ValueError(
                "Please provide a stock symbol or company name."
            )

        return value

    @app.route("/api/news", methods=["GET"])
    def api_stock_news():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.news_service",
                "get_stock_news",
            )
            result = service_call(
                function,
                symbol=news_symbol(),
                limit=news_limit(),
                refresh=news_refresh(),
            )
            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to load stock news.")
            return api_error("Unable to load stock news.", 502)

    @app.route("/api/news/sentiment", methods=["GET"])
    def api_news_sentiment():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.news_service",
                "get_news_sentiment",
            )
            result = service_call(
                function,
                symbol=news_symbol(),
                limit=news_limit(),
                refresh=news_refresh(),
            )
            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to analyse news sentiment.")
            return api_error("Unable to analyse news sentiment.", 502)

    @app.route("/api/news/market", methods=["GET"])
    def api_market_news():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.news_service",
                "get_market_news",
            )
            result = service_call(
                function,
                limit=news_limit(),
                refresh=news_refresh(),
            )
            return api_success(result)

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Unable to load market news.")
            return api_error("Unable to load market news.", 502)

    # ============================================================
    # MARKET PLUS AI ASSISTANT
    # ============================================================

    @app.route("/api/assistant/chat", methods=["POST"])
    def api_assistant_chat():
        user, error = get_request_user()
        if error:
            return error

        try:
            user_id = require_user_id(user)
            data = request_json()

            question = str(data.get("question") or "").strip()

            if not question:
                return api_error("Please enter a question.", 400)

            if len(question) > 2000:
                return api_error(
                    "Your question must not exceed 2000 characters.",
                    400,
                )

            page_context = data.get("page_context")

            if page_context is not None and not isinstance(page_context, dict):
                return api_error("Invalid assistant page context.", 400)

            function = import_service(
                "backend.assistant_service",
                "chat_with_assistant",
            )

            result = service_call(
                function,
                user_id=user_id,
                question=question,
                page_context=page_context,
            )

            if not isinstance(result, dict):
                return api_error(
                    "The assistant returned an invalid response.",
                    502,
                )

            return api_success(
                result,
                "Assistant response generated successfully.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Assistant chat failed.")
            return api_error(
                "The assistant could not process your question.",
                500,
            )

    # ------------------------------------------------------------
    # LOAD CONVERSATION HISTORY
    # ------------------------------------------------------------

    @app.route("/api/assistant/history", methods=["GET"])
    def api_assistant_history():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.assistant_service",
                "get_assistant_history",
            )

            result = service_call(
                function,
                user_id=require_user_id(user),
                limit=requested_limit(30, 100),
                offset=requested_offset(),
            )

            return api_success(
                result,
                "Assistant conversation history loaded.",
            )

        except ValueError as exc:
            return api_error(str(exc), 400)
        except Exception:
            app.logger.exception("Assistant history loading failed.")
            return api_error(
                "Unable to load assistant history.",
                500,
            )

    # ------------------------------------------------------------
    # CLEAR CONVERSATION HISTORY
    # ------------------------------------------------------------

    @app.route("/api/assistant/history", methods=["DELETE"])
    def api_clear_assistant_history():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.assistant_service",
                "clear_assistant_history",
            )

            result = service_call(
                function,
                user_id=require_user_id(user),
            )

            return api_success(
                result,
                "Assistant conversation history cleared.",
            )

        except Exception:
            app.logger.exception("Assistant history clearing failed.")
            return api_error(
                "Unable to clear assistant history.",
                500,
            )

    # ------------------------------------------------------------
    # ASSISTANT STATUS
    # ------------------------------------------------------------

    @app.route("/api/assistant/status", methods=["GET"])
    def api_assistant_status():
        user, error = get_request_user()
        if error:
            return error

        try:
            function = import_service(
                "backend.assistant_service",
                "get_assistant_status",
            )

            result = service_call(function)

            return api_success(
                result,
                "Assistant status loaded.",
            )

        except Exception:
            app.logger.exception("Assistant status loading failed.")
            return api_error(
                "Unable to retrieve assistant status.",
                500,
            )

    # ============================================================
    # HEALTH CHECK
    # ============================================================

    @app.route("/api/health", methods=["GET"])
    def api_health():
        try:
            database_health = health_check()

            if isinstance(database_health, dict):
                services = database_health
                healthy = bool(
                    database_health.get(
                        "healthy",
                        database_health.get("status", True),
                    )
                )
            else:
                healthy = bool(database_health)
                services = {
                    "database": (
                        "connected" if healthy else "unavailable"
                    )
                }

            return jsonify({
                "success": healthy,
                "application": Config.APP_NAME,
                "version": Config.APP_VERSION,
                "status": "healthy" if healthy else "unhealthy",
                "database": (
                    "connected" if healthy else "unavailable"
                ),
                "services": json_safe(services),
            }), (200 if healthy else 503)

        except Exception:
            app.logger.exception("Health check failed.")
            return jsonify({
                "success": False,
                "application": Config.APP_NAME,
                "version": Config.APP_VERSION,
                "status": "unhealthy",
                "database": "unavailable",
            }), 503

    # ============================================================
    # APPLICATION INFORMATION
    # ============================================================

    @app.route("/api/info", methods=["GET"])
    def api_info():
        return jsonify({
            "success": True,
            "application": Config.APP_NAME,
            "version": Config.APP_VERSION,
            "description": getattr(
                Config,
                "APP_DESCRIPTION",
                "AI-Based Intelligent Stock and Asset Prediction System",
            ),
            "prediction_horizons": [1, 7, 30],
            "prediction_models": list(
                SUPPORTED_PREDICTION_MODELS.values()
            ),
            "database": "SQLite",
            "storage": "Local",
            "trading_enabled": False,
            "what_if_market": True,
            "technical_pattern_search": True,
            "historical_similarity_search": True,
            "what_if_scenario_history": True,
            "what_if_pdf_report": True,
            "prediction_disclaimer": PREDICTION_DISCLAIMER,
            "what_if_disclaimer": WHAT_IF_DISCLAIMER,
            "ai_assistant": True,
            "ai_assistant_local_only": True,
        })

    # ============================================================
    # API DISCOVERY
    # ============================================================

    @app.route("/api", methods=["GET"])
    def api_root():
        return jsonify({
            "success": True,
            "application": Config.APP_NAME,
            "version": Config.APP_VERSION,
            "message": "Market Plus AI API is running.",
            "endpoints": {
                "health": "GET /api/health",
                "info": "GET /api/info",
                "profile": "GET /api/profile",
                "update_profile": "PATCH /api/profile",
                "dashboard": "GET /api/dashboard",
                "stock_search": "GET /api/stocks/search?q=INFY",
                "stock_details": "GET /api/stocks/<symbol>",
                "stock_chart": (
                    "GET /api/stocks/<symbol>/chart?period=6mo"
                ),
                "prediction": "POST /api/predict",
                "prediction_history": "GET /api/predictions/history",
                "what_if_page": "GET /what-if-market",
                "what_if_calculate": "POST /api/what-if/calculate",
                "technical_patterns": (
                    "POST /api/what-if/patterns/technical"
                ),
                "historical_similarity": (
                    "POST /api/what-if/patterns/similarity"
                ),
                "save_what_if_scenario": (
                    "POST /api/what-if/scenarios"
                ),
                "list_what_if_scenarios": (
                    "GET /api/what-if/scenarios"
                ),
                "get_what_if_scenario": (
                    "GET /api/what-if/scenarios/<id>"
                ),
                "delete_what_if_scenario": (
                    "DELETE /api/what-if/scenarios/<id>"
                ),
                "what_if_pdf_report": (
                    "POST /api/what-if/report"
                ),
                "news": "GET /api/news?symbol=INFY",
                "news_sentiment": (
                    "GET /api/news/sentiment?symbol=INFY"
                ),
                "market_news": "GET /api/news/market",
                "alerts": "GET /api/alerts",
                "create_alert": "POST /api/alerts",
                "cancel_alert": "DELETE /api/alerts/<id>",
                "alert_summary": "GET /api/alerts/summary",
                "notifications": "GET /api/notifications",
                "unread_notifications": (
                    "GET /api/notifications/unread-count"
                ),
                "mark_notification_read": (
                    "POST /api/notifications/<id>/read"
                ),
                "mark_all_notifications_read": (
                    "POST /api/notifications/read-all"
                ),
                "logout": "POST /api/logout",
                "assistant_chat": "POST /api/assistant/chat",
                "assistant_history": "GET /api/assistant/history",
                "clear_assistant_history": "DELETE /api/assistant/history",
                "assistant_status": "GET /api/assistant/status",
            },
            "investment_endpoints": {
                "search_assets": "GET /api/investments/search?q=INFY",
                "list_and_summary": "GET /api/investments",
                "add": "POST /api/investments",
                "close": "POST /api/investments/<id>/close",
                "delete_open_investment": (
                    "DELETE /api/investments/<id>"
                ),
            },
        })

    return app


# ================================================================
# APPLICATION ENTRY POINT
# ================================================================

app = create_app()


if __name__ == "__main__":
    app.run(
        host=getattr(Config, "HOST", "127.0.0.1"),
        port=getattr(Config, "PORT", 5000),
        debug=getattr(Config, "DEBUG", False),
    )