
"""Input validation utilities for Market Plus AI."""

import math
import re
from datetime import date


# Supported prediction horizons, measured in trading days.
ALLOWED_PREDICTION_HORIZONS = {1, 7, 30}

# Supported risk categories.
ALLOWED_RISK_CATEGORIES = {"low", "middle", "high"}

# Supported alert conditions.
ALLOWED_ALERT_CONDITIONS = {"reaches", "above", "below"}

# General symbol pattern for stocks and other supported market assets.
SYMBOL_PATTERN = re.compile(
    r"^(?:[A-Z0-9][A-Z0-9.^=_-]{0,24}|\^[A-Z0-9][A-Z0-9.^=_-]{0,23})$"
)


def validate_text(value, field_name="Value", min_length=1, max_length=200):
    """Validate and normalize a basic text field."""

    if value is None:
        return False, f"{field_name} is required."

    if not isinstance(value, str):
        return False, f"{field_name} must be text."

    cleaned = value.strip()

    if len(cleaned) < min_length:
        return False, f"{field_name} must contain at least {min_length} characters."

    if len(cleaned) > max_length:
        return False, f"{field_name} must not exceed {max_length} characters."

    return True, cleaned


def validate_stock_symbol(symbol):
    """Validate the format of a stock ticker symbol."""

    if not isinstance(symbol, str):
        return False, "Stock symbol must be text."

    symbol = symbol.strip().upper()

    if not symbol:
        return False, "Enter a stock symbol."

    if len(symbol) > 25:
        return False, "Stock symbol is too long."

    if not SYMBOL_PATTERN.fullmatch(symbol):
        return False, "Stock symbol contains invalid characters."

    return True, symbol


def validate_prediction_horizon(horizon):
    """Validate a prediction horizon of 1, 7, or 30 trading days."""

    try:
        if isinstance(horizon, bool):
            raise ValueError

        if isinstance(horizon, float) and not horizon.is_integer():
            raise ValueError

        if isinstance(horizon, str):
            horizon = horizon.strip()

            if not horizon.isdigit():
                raise ValueError

        horizon = int(horizon)

    except (TypeError, ValueError, OverflowError):
        return False, "Prediction duration must be 1, 7, or 30 trading days."

    if horizon not in ALLOWED_PREDICTION_HORIZONS:
        return False, "Choose a prediction duration of 1, 7, or 30 trading days."

    return True, horizon


def validate_positive_price(price, field_name="Price"):
    """Validate a positive, finite numeric price."""

    try:
        if isinstance(price, bool):
            raise ValueError

        if isinstance(price, str):
            price = price.strip()

            if not price:
                raise ValueError

        price = float(price)

    except (TypeError, ValueError, OverflowError):
        return False, f"{field_name} must be a valid number."

    if not math.isfinite(price):
        return False, f"{field_name} must be a finite number."

    if price <= 0:
        return False, f"{field_name} must be greater than zero."

    if price > 1_000_000_000_000:
        return False, f"{field_name} is outside the supported range."

    return True, price


def validate_alert_condition(condition):
    """Validate a price-alert condition."""

    if not isinstance(condition, str):
        return False, "Alert condition must be text."

    condition = condition.strip().lower()

    if condition not in ALLOWED_ALERT_CONDITIONS:
        return False, "Choose reaches, above, or below."

    return True, condition


def validate_risk_category(category):
    """Validate the user's selected risk category."""

    if not isinstance(category, str):
        return False, "Risk category must be text."

    category = category.strip().lower()

    if category not in ALLOWED_RISK_CATEGORIES:
        return False, "Choose low, middle, or high risk."

    return True, category


def validate_email(email):
    """Perform basic email format validation."""

    if not isinstance(email, str):
        return False, "Email address must be text."

    email = email.strip().lower()

    if not email:
        return False, "Email address is required."

    if len(email) > 254:
        return False, "Email address is too long."

    pattern = re.compile(
        r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
        r"[A-Za-z]{2,63}$"
    )

    if not pattern.fullmatch(email):
        return False, "Please enter a valid email address."

    return True, email


def validate_phone(phone):
    """Validate an optional phone number."""

    if phone is None:
        return True, ""

    if not isinstance(phone, str):
        return False, "Phone number must be text."

    phone = phone.strip()

    if not phone:
        return True, ""

    if not re.fullmatch(r"[0-9+\-()\s]{7,25}", phone):
        return False, "Phone number contains invalid characters."

    digits = re.sub(r"\D", "", phone)

    if not 7 <= len(digits) <= 15:
        return False, "Phone number must contain 7 to 15 digits."

    return True, phone


def validate_pagination(page=1, per_page=10, max_per_page=100):
    """Validate pagination parameters for list endpoints."""

    try:
        if isinstance(page, bool) or isinstance(per_page, bool):
            raise ValueError

        if isinstance(page, float) or isinstance(per_page, float):
            raise ValueError

        page = int(page)
        per_page = int(per_page)
        max_per_page = int(max_per_page)

    except (TypeError, ValueError, OverflowError):
        return False, "Page and page size must be whole numbers."

    if page < 1:
        return False, "Page must be at least 1."

    if per_page < 1:
        return False, "Page size must be at least 1."

    if max_per_page < 1 or per_page > max_per_page:
        return False, f"Page size cannot exceed {max_per_page}."

    return True, {
        "page": page,
        "per_page": per_page,
        "offset": (page - 1) * per_page,
    }


def validate_date_range(start_date, end_date):
    """Validate ISO-format dates supplied as YYYY-MM-DD."""

    try:
        start = date.fromisoformat(str(start_date))
        end = date.fromisoformat(str(end_date))

    except (TypeError, ValueError):
        return False, "Dates must use YYYY-MM-DD format."

    if start > end:
        return False, "Start date must not be after end date."

    return True, {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }


def validate_search_query(query, min_length=1, max_length=100):
    """Validate a search query before passing it to a data provider."""

    if not isinstance(query, str):
        return False, "Search query must be text."

    query = query.strip()

    if len(query) < min_length:
        return False, "Enter a search term."

    if len(query) > max_length:
        return False, "Search query is too long."

    if any(ord(character) < 32 for character in query):
        return False, "Search query contains invalid characters."

    return True, query
