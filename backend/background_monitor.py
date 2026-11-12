
"""
Automatic background price-alert monitoring for Market Plus AI.

Run independently from Flask:
    python -m backend.background_monitor

Check once:
    python -m backend.background_monitor --once

The monitor:
- Reads all active alert symbols from SQLite.
- Fetches fresh Yahoo Finance quotes.
- Evaluates alerts using the existing alert service.
- Sends email through the existing notification pipeline.
- Continues monitoring when users are not logged in.
"""

import argparse
import logging
import os
import signal
import threading
import time
from typing import Any

from backend.database import get_db
from backend.data_fetcher import get_stock_info
from backend.alert_service import evaluate_alerts


logger = logging.getLogger("market_plus_ai.background_monitor")

DEFAULT_INTERVAL_SECONDS = 60
MIN_INTERVAL_SECONDS = 15

_stop_event = threading.Event()


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

def get_monitor_interval() -> int:
    """Return the configured monitoring interval in seconds."""
    try:
        from config import Config

        configured = getattr(
            Config,
            "ALERT_MONITOR_INTERVAL_SECONDS",
            os.getenv(
                "ALERT_MONITOR_INTERVAL_SECONDS",
                DEFAULT_INTERVAL_SECONDS,
            ),
        )

        interval = int(configured)

    except (ImportError, TypeError, ValueError):
        interval = DEFAULT_INTERVAL_SECONDS

    if interval < MIN_INTERVAL_SECONDS:
        logger.warning(
            "Monitor interval is too short. Using %s seconds.",
            MIN_INTERVAL_SECONDS,
        )
        interval = MIN_INTERVAL_SECONDS

    return interval


# ---------------------------------------------------------
# ACTIVE ALERT SYMBOLS
# ---------------------------------------------------------

def get_active_alert_symbols() -> list[str]:
    """
    Retrieve distinct symbols that currently have active alerts.

    Multiple users monitoring the same symbol require only one
    market quote per monitoring cycle.
    """
    with get_db() as db:
        rows = db.execute(
            """
            SELECT DISTINCT symbol
            FROM alerts
            WHERE status = 'active'
            ORDER BY symbol ASC
            """
        ).fetchall()

    return [
        str(row["symbol"]).strip().upper()
        for row in rows
        if row["symbol"]
    ]


# ---------------------------------------------------------
# MONITOR ONE CYCLE
# ---------------------------------------------------------

def monitor_once() -> dict[str, Any]:
    """
    Check every symbol with at least one active price alert.

    A fresh market quote is requested for each symbol.
    Individual provider failures do not stop other symbols.
    """
    started_at = time.time()

    summary = {
        "success": True,
        "symbols_found": 0,
        "symbols_checked": 0,
        "symbols_failed": 0,
        "alerts_evaluated": 0,
        "alerts_triggered": 0,
        "emails_sent": 0,
        "emails_failed": 0,
        "results": [],
    }

    try:
        symbols = get_active_alert_symbols()
    except Exception:
        logger.exception(
            "Could not retrieve active alerts from SQLite."
        )
        summary["success"] = False
        return summary

    summary["symbols_found"] = len(symbols)

    if not symbols:
        logger.info("No active price alerts to monitor.")
        summary["duration_seconds"] = round(
            time.time() - started_at, 2
        )
        return summary

    logger.info(
        "Starting monitoring cycle for %s symbols.",
        len(symbols),
    )

    for symbol in symbols:
        try:
            # Bypass the 30-second quote cache so that each cycle
            # requests a fresh quote from the market-data provider.
            quote = get_stock_info(
                symbol,
                use_cache=False,
            )

            current_price = quote.get("last_price")

            if current_price is None or current_price <= 0:
                raise ValueError(
                    f"No valid current price returned for {symbol}."
                )

            result = evaluate_alerts(
                symbol=symbol,
                current_price=current_price,
            )

            summary["symbols_checked"] += 1
            summary["alerts_evaluated"] += result.get(
                "evaluated_count", 0
            )
            summary["alerts_triggered"] += result.get(
                "triggered_count", 0
            )
            summary["emails_sent"] += result.get(
                "email_sent_count", 0
            )
            summary["emails_failed"] += result.get(
                "email_failed_count", 0
            )

            summary["results"].append({
                "symbol": symbol,
                "current_price": current_price,
                "triggered_count": result.get(
                    "triggered_count", 0
                ),
                "email_sent_count": result.get(
                    "email_sent_count", 0
                ),
                "email_failed_count": result.get(
                    "email_failed_count", 0
                ),
            })

            logger.info(
                "%s: price=%s, evaluated=%s, triggered=%s, "
                "emails_sent=%s",
                symbol,
                current_price,
                result.get("evaluated_count", 0),
                result.get("triggered_count", 0),
                result.get("email_sent_count", 0),
            )

        except Exception as exc:
            summary["symbols_failed"] += 1

            logger.error(
                "Monitoring failed for %s: %s",
                symbol,
                exc,
                exc_info=True,
            )

            summary["results"].append({
                "symbol": symbol,
                "error": str(exc),
            })

    summary["duration_seconds"] = round(
        time.time() - started_at, 2
    )

    logger.info(
        "Monitoring cycle completed: checked=%s, failed=%s, "
        "triggered=%s, emails_sent=%s, duration=%ss",
        summary["symbols_checked"],
        summary["symbols_failed"],
        summary["alerts_triggered"],
        summary["emails_sent"],
        summary["duration_seconds"],
    )

    return summary


# ---------------------------------------------------------
# CONTINUOUS BACKGROUND MONITOR
# ---------------------------------------------------------

def run_monitor() -> None:
    """
    Continuously monitor active price alerts.

    This process must remain running independently of Flask.
    """
    interval = get_monitor_interval()

    logger.info("Market Plus AI background monitor started.")
    logger.info(
        "Monitoring interval: %s seconds.",
        interval,
    )

    logger.info(
        "Monitoring continues even when users are not logged in."
    )

    while not _stop_event.is_set():
        try:
            monitor_once()

        except Exception:
            logger.exception(
                "Unexpected error in monitoring cycle."
            )

        # Wait between cycles. This also allows graceful shutdown.
        _stop_event.wait(interval)

    logger.info("Background monitor stopped.")


# ---------------------------------------------------------
# GRACEFUL SHUTDOWN
# ---------------------------------------------------------

def _handle_shutdown(signum, frame) -> None:
    """Request a graceful monitor shutdown."""
    logger.info("Shutdown signal received.")
    _stop_event.set()


# ---------------------------------------------------------
# COMMAND LINE
# ---------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Market Plus AI automatic price-alert monitor."
    )

    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one monitoring cycle and exit.",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
        ),
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if args.once:
        monitor_once()
        return

    signal.signal(signal.SIGINT, _handle_shutdown)

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_shutdown)

    run_monitor()


if __name__ == "__main__":
    main()
