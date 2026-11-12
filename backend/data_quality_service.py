"""
Market Plus AI - Market Data Quality Service

Purpose:
    Validate, normalize, and clean historical OHLCV market data before
    it is passed to prediction models, backtesting, or evaluation.

Features:
    - Handles Yahoo Finance MultiIndex columns.
    - Normalizes common OHLCV column names.
    - Supports datetime indexes and date columns.
    - Converts numeric columns safely.
    - Detects duplicate dates and missing values.
    - Detects non-finite and nonpositive prices.
    - Detects inconsistent OHLC values.
    - Detects negative volume.
    - Generates JSON-serializable quality reports.
    - Returns cleaned data without modifying the original DataFrame.
    - Provides combined validation and cleaning.

This module does not fetch market data or make predictions.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

REQUIRED_COLUMNS = (
    "Open",
    "High",
    "Low",
    "Close",
    "Volume",
)

PRICE_COLUMNS = (
    "Open",
    "High",
    "Low",
    "Close",
)

COLUMN_ALIASES = {
    "open": "Open",
    "high": "High",
    "low": "Low",
    "close": "Close",
    "adj close": "Adj Close",
    "adj_close": "Adj Close",
    "adjusted close": "Adj Close",
    "volume": "Volume",
}

RECOGNIZED_COLUMNS = {
    "open",
    "high",
    "low",
    "close",
    "adj close",
    "volume",
}


# ---------------------------------------------------------
# NUMERIC HELPERS
# ---------------------------------------------------------

def _is_finite_number(value: Any) -> bool:
    """Check whether a value is a finite numeric value."""

    try:
        if value is None:
            return False

        if pd.isna(value):
            return False

        return math.isfinite(float(value))

    except (TypeError, ValueError, OverflowError):
        return False


def _to_python_number(value: Any) -> float | int | None:
    """Convert numeric values into JSON-compatible Python numbers."""

    if not _is_finite_number(value):
        return None

    number = float(value)

    if number.is_integer():
        return int(number)

    return number


def _normalize_column_name(value: Any) -> str:
    """Normalize common market-data column names."""

    text = str(value).strip()

    key = (
        text.lower()
        .replace("-", " ")
        .replace("_", " ")
    )

    key = " ".join(key.split())

    return COLUMN_ALIASES.get(
        key,
        text,
    )


# ---------------------------------------------------------
# MULTIINDEX NORMALIZATION
# ---------------------------------------------------------

def _flatten_columns(data: pd.DataFrame) -> pd.DataFrame:
    """
    Flatten normal and Yahoo Finance MultiIndex columns.

    Handles:
        ('Open', 'TCS.NS')
        ('TCS.NS', 'Open')
        ('Close', 'AAPL')
        ('AAPL', 'Close')
    """

    result = data.copy()

    if not isinstance(
        result.columns,
        pd.MultiIndex,
    ):

        result.columns = [
            _normalize_column_name(column)
            for column in result.columns
        ]

        return result

    best_level = 0
    best_score = -1

    for level in range(result.columns.nlevels):

        labels = [
            str(value).strip().lower().replace("_", " ")
            for value in result.columns.get_level_values(level)
        ]

        score = sum(
            label in RECOGNIZED_COLUMNS
            for label in labels
        )

        if score > best_score:
            best_score = score
            best_level = level

    flattened = [
        _normalize_column_name(value)
        for value in result.columns.get_level_values(best_level)
    ]

    result.columns = flattened

    # Retain the first occurrence of duplicate OHLCV labels.
    result = result.loc[
        :,
        ~result.columns.duplicated(keep="first"),
    ]

    return result


# ---------------------------------------------------------
# DATAFRAME PREPARATION
# ---------------------------------------------------------

def _prepare_dataframe(data: pd.DataFrame) -> pd.DataFrame:
    """Create a normalized copy of the supplied market data."""

    if not isinstance(data, pd.DataFrame):
        raise TypeError(
            "Market data must be a pandas DataFrame."
        )

    result = _flatten_columns(data)

    if result.empty:

        result.index = pd.DatetimeIndex(
            [],
            name="Date",
            tz="UTC",
        )

        return result

    # Support Date, Datetime, and Timestamp columns.
    date_column = next(
        (
            column
            for column in result.columns
            if str(column).strip().lower()
            in {
                "date",
                "datetime",
                "timestamp",
            }
        ),
        None,
    )

    if date_column is not None:

        parsed_dates = pd.to_datetime(
            result[date_column],
            errors="coerce",
            utc=True,
        )

        result = result.drop(
            columns=[date_column]
        )

        result.index = parsed_dates

    else:

        result.index = pd.to_datetime(
            result.index,
            errors="coerce",
            utc=True,
        )

    result.index.name = "Date"

    result = result.loc[
        ~result.index.isna()
    ].copy()

    if not isinstance(
        result.index,
        pd.DatetimeIndex,
    ):

        result.index = pd.DatetimeIndex(
            result.index
        )

    # Convert required OHLCV fields.
    for column in REQUIRED_COLUMNS + ("Adj Close",):

        if column in result.columns:

            result[column] = pd.to_numeric(
                result[column],
                errors="coerce",
            )

    return result


# ---------------------------------------------------------
# ROW VALIDATION
# ---------------------------------------------------------

def _build_valid_row_mask(
    frame: pd.DataFrame,
) -> tuple[pd.Series, dict[str, pd.Series]]:
    """
    Build consistent validity masks for OHLCV data.

    Returns:
        valid row mask and individual error masks.
    """

    prices = frame[list(PRICE_COLUMNS)]

    finite_price_mask = prices.apply(
        lambda column: column.map(_is_finite_number)
    ).all(axis=1)

    positive_price_mask = prices.gt(0).all(axis=1)

    finite_volume_mask = frame["Volume"].map(
        _is_finite_number
    )

    nonnegative_volume_mask = frame["Volume"].ge(0)

    missing_mask = (
        frame[list(REQUIRED_COLUMNS)]
        .isna()
        .any(axis=1)
    )

    invalid_price_mask = (
        ~finite_price_mask
        | ~positive_price_mask
    )

    high_valid = frame["High"].ge(
        frame[
            ["Open", "Close", "Low"]
        ].max(axis=1)
    )

    low_valid = frame["Low"].le(
        frame[
            ["Open", "Close", "High"]
        ].min(axis=1)
    )

    invalid_ohlc_mask = (
        ~(high_valid & low_valid)
        & finite_price_mask
    )

    negative_volume_mask = (
        frame["Volume"].lt(0)
        & finite_volume_mask
    )

    valid_mask = (
        ~missing_mask
        & finite_price_mask
        & positive_price_mask
        & high_valid
        & low_valid
        & finite_volume_mask
        & nonnegative_volume_mask
    )

    masks = {
        "missing": missing_mask,
        "invalid_price": invalid_price_mask,
        "invalid_ohlc": invalid_ohlc_mask,
        "negative_volume": negative_volume_mask,
        "finite_prices": finite_price_mask,
        "positive_prices": positive_price_mask,
        "finite_volume": finite_volume_mask,
    }

    return valid_mask, masks


# ---------------------------------------------------------
# REPORT HELPERS
# ---------------------------------------------------------

def _empty_report(
    message: str,
    input_rows: int = 0,
) -> dict[str, Any]:
    """Return a consistent report for unusable input."""

    return {
        "status": "invalid",
        "quality_score": 0.0,
        "message": message,

        "input_rows": int(input_rows),
        "output_rows": 0,
        "removed_rows": int(input_rows),

        "duplicate_dates": 0,
        "missing_values": {},

        "invalid_price_rows": 0,
        "invalid_ohlc_rows": 0,
        "negative_volume_rows": 0,

        "missing_columns": list(REQUIRED_COLUMNS),

        "warnings": [],
        "errors": [message],

        "usable_for_prediction": False,

        "first_valid_date": None,
        "last_valid_date": None,
    }


def _quality_score(
    input_rows: int,
    valid_rows: int,
) -> float:
    """
    Calculate the percentage of original observations retained.

    This is a data-retention score, not prediction accuracy,
    model confidence, or probability of profit.
    """

    if input_rows <= 0:
        return 0.0

    score = (
        valid_rows / input_rows
    ) * 100

    return round(
        max(0.0, min(100.0, score)),
        2,
    )


# ---------------------------------------------------------
# VALIDATE OHLCV DATA
# ---------------------------------------------------------

def validate_ohlcv_data(
    data: pd.DataFrame,
) -> dict[str, Any]:
    """
    Inspect OHLCV data and return a JSON-serializable report.

    The original DataFrame is never modified.
    """

    if not isinstance(data, pd.DataFrame):
        raise TypeError(
            "Market data must be a pandas DataFrame."
        )

    input_rows = len(data)

    if data.empty:
        return _empty_report(
            "The supplied market-data DataFrame is empty.",
            input_rows,
        )

    warnings = []
    errors = []

    try:

        frame = _prepare_dataframe(data)

    except Exception as exc:

        return _empty_report(
            (
                "Unable to normalize market data: "
                f"{type(exc).__name__}."
            ),
            input_rows,
        )

    if frame.empty:

        return _empty_report(
            "No rows have valid dates after normalization.",
            input_rows,
        )

    # -----------------------------------------------------
    # REQUIRED COLUMNS
    # -----------------------------------------------------

    missing_columns = [
        column
        for column in REQUIRED_COLUMNS
        if column not in frame.columns
    ]

    if missing_columns:

        report = _empty_report(
            "Required OHLCV columns are missing.",
            input_rows,
        )

        report["missing_columns"] = missing_columns

        report["duplicate_dates"] = int(
            frame.index.duplicated(
                keep="last"
            ).sum()
        )

        return report

    # -----------------------------------------------------
    # DUPLICATE DATES
    # -----------------------------------------------------

    duplicate_dates = int(
        frame.index.duplicated(
            keep="last"
        ).sum()
    )

    if duplicate_dates:

        warnings.append(
            f"Found {duplicate_dates} duplicate date row(s). "
            "The cleaning process retains the last occurrence."
        )

    # Use the same duplicate-removal policy for validation
    # and cleaning.
    frame = frame.loc[
        ~frame.index.duplicated(
            keep="last"
        )
    ].copy()

    frame = frame.sort_index()

    # -----------------------------------------------------
    # MISSING VALUES
    # -----------------------------------------------------

    missing_values = {
        column: int(
            frame[column].isna().sum()
        )
        for column in REQUIRED_COLUMNS
    }

    missing_row_mask = (
        frame[list(REQUIRED_COLUMNS)]
        .isna()
        .any(axis=1)
    )

    missing_rows = int(
        missing_row_mask.sum()
    )

    if missing_rows:

        warnings.append(
            f"Found {missing_rows} row(s) with missing or "
            "nonnumeric OHLCV values."
        )

    # -----------------------------------------------------
    # NUMERIC VALIDATION
    # -----------------------------------------------------

    valid_mask, masks = _build_valid_row_mask(
        frame
    )

    invalid_price_rows = int(
        masks["invalid_price"].sum()
    )

    invalid_ohlc_rows = int(
        masks["invalid_ohlc"].sum()
    )

    negative_volume_rows = int(
        masks["negative_volume"].sum()
    )

    if invalid_price_rows:

        warnings.append(
            f"Found {invalid_price_rows} row(s) with "
            "nonpositive or non-finite prices."
        )

    if invalid_ohlc_rows:

        warnings.append(
            f"Found {invalid_ohlc_rows} row(s) with "
            "inconsistent OHLC relationships."
        )

    if negative_volume_rows:

        warnings.append(
            f"Found {negative_volume_rows} row(s) "
            "with negative volume."
        )

    # -----------------------------------------------------
    # CLEANED ROW COUNT
    # -----------------------------------------------------

    cleaned = frame.loc[
        valid_mask
    ].copy()

    cleaned = cleaned.sort_index()

    output_rows = len(cleaned)

    removed_rows = max(
        input_rows - output_rows,
        0,
    )

    if output_rows == 0:

        errors.append(
            "No valid OHLCV rows remain after validation."
        )

    elif output_rows < 30:

        warnings.append(
            "Fewer than 30 valid rows remain. "
            "The data may be insufficient for technical "
            "indicators or model training."
        )

    # -----------------------------------------------------
    # QUALITY SCORE
    # -----------------------------------------------------

    quality_score = _quality_score(
        input_rows,
        output_rows,
    )

    # -----------------------------------------------------
    # STATUS
    # -----------------------------------------------------

    if errors:
        status = "invalid"

    elif warnings:
        status = "warning"

    else:
        status = "good"

    usable_for_prediction = (
        output_rows >= 30
    )

    if status == "good":

        message = (
            "Market data passed basic quality checks."
        )

    elif status == "warning":

        message = (
            "Market data contains issues that should "
            "be reviewed before model training."
        )

    else:

        message = (
            "Market data is invalid or unusable."
        )

    # -----------------------------------------------------
    # FINAL REPORT
    # -----------------------------------------------------

    return {
        "status": status,
        "quality_score": quality_score,
        "message": message,

        "input_rows": int(input_rows),
        "output_rows": int(output_rows),
        "removed_rows": int(removed_rows),

        "duplicate_dates": int(duplicate_dates),

        "missing_values": missing_values,

        "invalid_price_rows": int(invalid_price_rows),
        "invalid_ohlc_rows": int(invalid_ohlc_rows),
        "negative_volume_rows": int(negative_volume_rows),

        "missing_columns": [],

        "warnings": warnings,
        "errors": errors,

        "usable_for_prediction": bool(
            usable_for_prediction
        ),

        "first_valid_date": (
            cleaned.index.min().isoformat()
            if output_rows
            else None
        ),

        "last_valid_date": (
            cleaned.index.max().isoformat()
            if output_rows
            else None
        ),
    }


# ---------------------------------------------------------
# CLEAN OHLCV DATA
# ---------------------------------------------------------

def clean_ohlcv_data(
    data: pd.DataFrame,
    *,
    require_minimum_rows: int = 1,
) -> pd.DataFrame:
    """
    Return a cleaned OHLCV DataFrame.

    Operations:
        - Normalize columns.
        - Normalize date indexes to UTC.
        - Remove invalid dates.
        - Convert required columns to numeric.
        - Remove missing and non-finite values.
        - Remove nonpositive prices.
        - Remove inconsistent OHLC rows.
        - Remove negative volume.
        - Remove duplicate dates.
        - Sort chronologically.

    The caller's original DataFrame is not modified.
    """

    if not isinstance(data, pd.DataFrame):

        raise TypeError(
            "Market data must be a pandas DataFrame."
        )

    if (
        isinstance(require_minimum_rows, bool)
        or not isinstance(require_minimum_rows, int)
        or require_minimum_rows < 1
    ):

        raise ValueError(
            "require_minimum_rows must be a positive integer."
        )

    if data.empty:

        raise ValueError(
            "Cannot clean an empty market-data DataFrame."
        )

    frame = _prepare_dataframe(data)

    missing_columns = [
        column
        for column in REQUIRED_COLUMNS
        if column not in frame.columns
    ]

    if missing_columns:

        raise ValueError(
            "Missing required OHLCV columns: "
            + ", ".join(missing_columns)
        )

    # Remove missing and nonnumeric values.
    for column in REQUIRED_COLUMNS:

        frame[column] = pd.to_numeric(
            frame[column],
            errors="coerce",
        )

    finite_mask = frame[
        list(REQUIRED_COLUMNS)
    ].apply(
        lambda column: column.map(
            _is_finite_number
        )
    ).all(axis=1)

    frame = frame.loc[
        finite_mask
    ].copy()

    if frame.empty:

        raise ValueError(
            "No rows with finite OHLCV values remain."
        )

    # Positive OHLC prices.
    positive_mask = frame[
        list(PRICE_COLUMNS)
    ].gt(0).all(axis=1)

    frame = frame.loc[
        positive_mask
    ].copy()

    if frame.empty:

        raise ValueError(
            "No rows with positive OHLC prices remain."
        )

    # Candle consistency.
    high_valid = frame["High"].ge(
        frame[
            ["Open", "Close", "Low"]
        ].max(axis=1)
    )

    low_valid = frame["Low"].le(
        frame[
            ["Open", "Close", "High"]
        ].min(axis=1)
    )

    frame = frame.loc[
        high_valid & low_valid
    ].copy()

    if frame.empty:

        raise ValueError(
            "No rows with consistent OHLC values remain."
        )

    # Volume cannot be negative.
    frame = frame.loc[
        frame["Volume"].ge(0)
    ].copy()

    # Keep the last record for duplicate timestamps.
    frame = frame.loc[
        ~frame.index.duplicated(
            keep="last"
        )
    ]

    frame = frame.sort_index()

    if len(frame) < require_minimum_rows:

        raise ValueError(
            f"Only {len(frame)} valid row(s) remain; "
            f"{require_minimum_rows} required."
        )

    return frame


# ---------------------------------------------------------
# VALIDATE AND PREPARE IN ONE CALL
# ---------------------------------------------------------

def prepare_ohlcv_data(
    data: pd.DataFrame,
    *,
    minimum_rows: int = 30,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Validate and clean market data in one operation.

    Returns:
        cleaned_dataframe, quality_report

    The quality report describes the original input.
    The DataFrame contains the cleaned observations.
    """

    if (
        isinstance(minimum_rows, bool)
        or not isinstance(minimum_rows, int)
        or minimum_rows < 1
    ):

        raise ValueError(
            "minimum_rows must be a positive integer."
        )

    report = validate_ohlcv_data(
        data
    )

    if report["missing_columns"]:

        raise ValueError(
            "Cannot prepare data because required columns "
            "are missing: "
            + ", ".join(report["missing_columns"])
        )

    if report["output_rows"] < minimum_rows:

        raise ValueError(
            f"Only {report['output_rows']} valid OHLCV "
            f"row(s) remain; {minimum_rows} required. "
            "Fetch more historical data or review the provider data."
        )

    cleaned = clean_ohlcv_data(
        data,
        require_minimum_rows=minimum_rows,
    )

    return cleaned, report
