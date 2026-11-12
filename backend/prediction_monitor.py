
"""Background prediction target monitor for Market Plus AI.

Run separately from Flask:
    python -m backend.prediction_monitor

Responsibilities:
- Find symbols with pending predictions.
- Retrieve current prices through the existing data_fetcher.
- Evaluate prediction targets.
- Retry failed target-reached emails.
- Keep monitoring independent of browser sessions.

Uses local SQLite and existing backend services.
"""

from __future__ import annotations

import logging
import math
import os
import time
from typing import Any

from backend.database import get_db
from backend.data_fetcher import get_stock_info
from backend.prediction_history_service import (
    monitor_prediction_targets,
    retry_target_reached_emails,
)


logger = logging.getLogger("market_plus_ai.prediction_monitor")

DEFAULT_INTERVAL_SECONDS = 60
MINIMUM_INTERVAL_SECONDS = 15
MAX_EMAIL_RETRIES_PER_CYCLE = 50


def configure_logging() -> None:
    """Configure logging for the standalone monitoring process."""

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(asctime)s | %(levelname)s | "
            "%(name)s | %(message)s"
        ),
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(
                "prediction_monitor.log",
                encoding="utf-8",
            ),
        ],
    )


def get_monitor_interval() -> int:
    """Read and validate the monitoring interval."""

    raw_value = os.getenv(
        "MPA_PREDICTION_MONITOR_INTERVAL",
        str(DEFAULT_INTERVAL_SECONDS),
    )

    try:
        interval = int(raw_value)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid monitor interval %r. Using %s seconds.",
            raw_value,
            DEFAULT_INTERVAL_SECONDS,
        )
        return DEFAULT_INTERVAL_SECONDS

    if interval < MINIMUM_INTERVAL_SECONDS:
        logger.warning(
            "Monitor interval cannot be below %s seconds. "
            "Using the minimum.",
            MINIMUM_INTERVAL_SECONDS,
        )
        return MINIMUM_INTERVAL_SECONDS

    return interval


def get_pending_symbols() -> list[str]:
    """Return distinct symbols that have pending predictions."""

    with get_db() as db:
        rows = db.execute(
            """
            SELECT DISTINCT symbol
            FROM predictions
            WHERE status = 'pending'
              AND symbol IS NOT NULL
              AND TRIM(symbol) != ''
            ORDER BY symbol
            """
        ).fetchall()

    return [
        str(row["symbol"]).strip().upper()
        for row in rows
        if row["symbol"]
    ]


def fetch_current_prices(
    symbols: list[str],
) -> dict[str, float]:
    """Fetch valid current prices for the supplied symbols."""

    prices: dict[str, float] = {}

    for symbol in symbols:
        try:
            quote = get_stock_info(
                symbol,
                use_cache=True,
            )

            if not isinstance(quote, dict):
                logger.warning(
                    "Invalid quote response for %s.",
                    symbol,
                )
                continue

            raw_price: Any = quote.get("last_price")

            try:
                price = float(raw_price)
            except (TypeError, ValueError, OverflowError):
                logger.warning(
                    "Invalid market price for %s: %r",
                    symbol,
                    raw_price,
                )
                continue

            if not math.isfinite(price) or price <= 0:
                logger.warning(
                    "Non-positive or non-finite price for %s.",
                    symbol,
                )
                continue

            prices[symbol] = price

            logger.info(
                "Current price fetched: %s = %.4f",
                symbol,
                price,
            )

        except Exception:
            logger.exception(
                "Could not fetch current price for %s.",
                symbol,
            )

    return prices


def run_monitor_cycle() -> dict[str, Any]:
    """Run one complete prediction-monitoring cycle."""

    result: dict[str, Any] = {
        "symbols_found": 0,
        "prices_fetched": 0,
        "targets_checked": False,
        "email_retry_result": None,
    }

    # Retry previously failed target-reached emails first.
    try:
        retry_result = retry_target_reached_emails(
            limit=MAX_EMAIL_RETRIES_PER_CYCLE,
        )

        result["email_retry_result"] = retry_result

        logger.info(
            "Target email retry process completed."
        )

    except Exception:
        logger.exception(
            "Target email retry process failed."
        )

    # Find predictions that still need target monitoring.
    try:
        symbols = get_pending_symbols()
        result["symbols_found"] = len(symbols)

    except Exception:
        logger.exception(
            "Could not retrieve pending prediction symbols."
        )
        return result

    if not symbols:
        logger.info(
            "No pending predictions currently require monitoring."
        )
        return result

    logger.info(
        "Monitoring %s distinct pending symbols.",
        len(symbols),
    )

    # Retrieve current prices through the existing market-data service.
    prices = fetch_current_prices(symbols)
    result["prices_fetched"] = len(prices)

    if not prices:
        logger.warning(
            "No valid current prices were available this cycle."
        )
        return result

    # Evaluate targets and let the history service manage notifications.
    try:
        monitor_prediction_targets(prices)

        result["targets_checked"] = True

        logger.info(
            "Prediction target monitoring completed for %s symbols.",
            len(prices),
        )

    except Exception:
        logger.exception(
            "Prediction target evaluation failed."
        )

    return result


def run_forever(
    interval_seconds: int | None = None,
) -> None:
    """Continuously execute monitoring cycles."""

    interval = (
        interval_seconds
        if interval_seconds is not None
        else get_monitor_interval()
    )

    if (
        isinstance(interval, bool)
        or not isinstance(interval, int)
        or interval < MINIMUM_INTERVAL_SECONDS
    ):
        raise ValueError(
            f"Monitoring interval must be at least "
            f"{MINIMUM_INTERVAL_SECONDS} seconds."
        )

    logger.info(
        "Market Plus AI prediction monitor started. "
        "Interval: %s seconds.",
        interval,
    )

    while True:
        cycle_started = time.monotonic()

        try:
            run_monitor_cycle()

        except Exception:
            logger.exception(
                "Unexpected error during monitoring cycle."
            )

        elapsed = time.monotonic() - cycle_started
        sleep_seconds = max(1, interval - int(elapsed))

        logger.info(
            "Monitoring cycle finished in %.2f seconds. "
            "Next cycle in %s seconds.",
            elapsed,
            sleep_seconds,
        )

        time.sleep(sleep_seconds)


def main() -> None:
    configure_logging()

    try:
        run_forever()

    except KeyboardInterrupt:
        logger.info(
            "Market Plus AI prediction monitor stopped by user."
        )


if __name__ == "__main__":
    main()
