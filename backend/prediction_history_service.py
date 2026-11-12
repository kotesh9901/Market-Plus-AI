
"""
Market Plus AI - Prediction History Service
Version: 2.1.0

SQLite-backed prediction history and lifecycle management.

Prediction lifecycle:
    pending -> target_reached -> completed
    pending -> cancelled

Important:
    - Target reached is not the same as an actual sale.
    - Realized profit/loss is recorded only after withdrawal confirmation.
    - Existing prediction records are preserved.
    - User ownership is enforced in database operations.
    - Target notifications are linked using prediction_id.
    - Failed email attempts can be retried.
"""

from __future__ import annotations

import json
import logging
import math
import sqlite3

from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

try:
    from .database import get_db
except ImportError:
    from backend.database import get_db

logger = logging.getLogger(__name__)

VALID_STATUSES = {
    "pending",
    "target_reached",
    "completed",
    "cancelled",
}

SUPPORTED_HORIZONS = {1, 7, 30}


# ---------------------------------------------------------------------
# General helpers
# ---------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime(
            value.year,
            value.month,
            value.day,
            tzinfo=timezone.utc,
        )
    elif isinstance(value, str):
        text = value.strip()

        if not text:
            return None

        try:
            result = datetime.fromisoformat(
                text.replace("Z", "+00:00")
            )
        except ValueError:
            try:
                parsed_date = date.fromisoformat(text)
                result = datetime(
                    parsed_date.year,
                    parsed_date.month,
                    parsed_date.day,
                    tzinfo=timezone.utc,
                )
            except ValueError:
                return None
    else:
        return None

    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)

    return result.astimezone(timezone.utc)


def _iso_datetime(value: Any = None) -> str:
    parsed = _parse_datetime(value) if value is not None else _now()

    if parsed is None:
        raise ValueError("A valid date or timestamp is required.")

    return parsed.isoformat()


def _number(
    value: Any,
    *,
    positive: bool = False,
    nonnegative: bool = False,
) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("A valid numeric value is required.") from exc

    if not math.isfinite(result):
        raise ValueError("Numeric values must be finite.")

    if positive and result <= 0:
        raise ValueError("Price values must be greater than zero.")

    if nonnegative and result < 0:
        raise ValueError("The value cannot be negative.")

    return result


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Metadata must contain JSON-serializable values."
        ) from exc

    return value


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None

    result = dict(row)

    if result.get("metadata_json"):
        try:
            result["metadata"] = json.loads(result["metadata_json"])
        except (TypeError, ValueError):
            result["metadata"] = {}
    else:
        result["metadata"] = {}

    result.pop("metadata_json", None)

    return result


def _get_connection():
    """
    Return the project's SQLite connection context manager.

    The database module owns connection lifecycle and commits.
    """
    return get_db()


# ---------------------------------------------------------------------
# Database migration
# ---------------------------------------------------------------------

def init_prediction_history_schema() -> None:
    """
    Add prediction lifecycle fields without deleting existing records.

    Also adds notifications.prediction_id so each prediction-target
    notification can be updated independently.

    Safe to call repeatedly.
    """
    migrations = {
        "status": "TEXT NOT NULL DEFAULT 'pending'",
        "target_date": "TEXT",
        "target_reached_at": "TEXT",
        "last_price_checked_at": "TEXT",
        "last_observed_price": "REAL",
        "actual_withdrawal_price": "REAL",
        "withdrawal_date": "TEXT",
        "actual_quantity": "REAL",
        "actual_profit_loss": "REAL",
        "actual_return_percent": "REAL",
        "notification_sent_at": "TEXT",
        "notification_attempted_at": "TEXT",
        "notification_error": "TEXT",
        "confidence_score": "REAL",
        "metadata_json": "TEXT NOT NULL DEFAULT '{}'",
        "cancelled_at": "TEXT",
    }

    with _get_connection() as db:
        cursor = db.cursor()

        # Prediction lifecycle columns.
        cursor.execute("PRAGMA table_info(predictions)")

        existing = {
            row["name"] if isinstance(row, sqlite3.Row) else row[1]
            for row in cursor.fetchall()
        }

        if not existing:
            raise RuntimeError(
                "The predictions table does not exist. "
                "Run database.init_db() first."
            )

        for column, definition in migrations.items():
            if column not in existing:
                cursor.execute(
                    f"ALTER TABLE predictions "
                    f"ADD COLUMN {column} {definition}"
                )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_predictions_user_status
            ON predictions(user_id, status)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_predictions_symbol_status
            ON predictions(symbol, status)
            """
        )

        # Completed prediction records.
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS completed_predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prediction_id INTEGER NOT NULL UNIQUE,
                user_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                reference_price REAL NOT NULL,
                predicted_price REAL NOT NULL,
                actual_withdrawal_price REAL NOT NULL,
                actual_quantity REAL,
                actual_profit_loss REAL,
                actual_return_percent REAL,
                withdrawal_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (prediction_id)
                    REFERENCES predictions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_completed_predictions_user
            ON completed_predictions(user_id, withdrawal_date)
            """
        )

        # Notification-to-prediction relationship.
        cursor.execute("PRAGMA table_info(notifications)")

        notification_columns = {
            row["name"] if isinstance(row, sqlite3.Row) else row[1]
            for row in cursor.fetchall()
        }

        if not notification_columns:
            raise RuntimeError(
                "The notifications table does not exist. "
                "Run database.init_db() first."
            )

        if "prediction_id" not in notification_columns:
            cursor.execute(
                """
                ALTER TABLE notifications
                ADD COLUMN prediction_id INTEGER
                """
            )

        # A prediction can have only one target-reached notification.
        # Other notification types are unaffected.
        cursor.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
            idx_notifications_prediction_target
            ON notifications(prediction_id)
            WHERE prediction_id IS NOT NULL
              AND notification_type = 'prediction_target_reached'
            """
        )

        # Existing predictions receive the default pending status.
        # Their target date is reconstructed from the original horizon.
        cursor.execute(
            """
            SELECT id, created_at, horizon_days
            FROM predictions
            WHERE target_date IS NULL OR target_date = ''
            """
        )

        rows = cursor.fetchall()

        for row in rows:
            created = _parse_datetime(row["created_at"])
            horizon = int(row["horizon_days"] or 1)

            if created is None:
                continue

            target = created + timedelta(days=max(1, horizon))

            cursor.execute(
                """
                UPDATE predictions
                SET target_date = ?
                WHERE id = ?
                """,
                (target.isoformat(), row["id"]),
            )


# ---------------------------------------------------------------------
# Prediction creation
# ---------------------------------------------------------------------

def create_prediction_record(
    *,
    user_id: Any,
    symbol: str,
    company_name: str | None = None,
    predicted_price: Any,
    reference_price: Any,
    prediction_date: Any = None,
    target_date: Any = None,
    model_name: str,
    horizon_days: Any,
    confidence_score: Any = None,
    metadata: Mapping[str, Any] | None = None,
    risk_category: str = "moderate",
) -> dict[str, Any]:
    """
    Save a prediction to the existing SQLite predictions table.

    Returns the saved database record.
    """
    if user_id is None or not str(user_id).strip():
        raise ValueError("A user ID is required.")

    if not isinstance(symbol, str) or not symbol.strip():
        raise ValueError("A stock or asset symbol is required.")

    if not isinstance(model_name, str) or not model_name.strip():
        raise ValueError("A model name is required.")

    if not isinstance(risk_category, str) or not risk_category.strip():
        raise ValueError("A risk category is required.")

    predicted = _number(predicted_price, positive=True)
    reference = _number(reference_price, positive=True)

    try:
        horizon = int(horizon_days)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Invalid prediction horizon.") from exc

    if isinstance(horizon_days, bool) or horizon not in SUPPORTED_HORIZONS:
        raise ValueError("Prediction horizon must be 1, 7, or 30 days.")

    created = _parse_datetime(
        prediction_date if prediction_date is not None else _now()
    )

    if created is None:
        raise ValueError("Invalid prediction date.")

    target = _parse_datetime(target_date) if target_date else (
        created + timedelta(days=horizon)
    )

    if target is None or target < created:
        raise ValueError("Invalid prediction target date.")

    confidence = None

    if confidence_score is not None:
        confidence = _number(confidence_score)

        if not 0 <= confidence <= 100:
            raise ValueError("Confidence must be between 0 and 100.")

    safe_metadata = dict(metadata or {})
    _json_safe(safe_metadata)

    if company_name:
        safe_metadata.setdefault("company_name", str(company_name))

    change = predicted - reference
    change_percent = (change / reference) * 100.0

    init_prediction_history_schema()

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            INSERT INTO predictions (
                user_id,
                symbol,
                horizon_days,
                reference_price,
                predicted_price,
                predicted_change,
                predicted_change_percent,
                model_name,
                evaluation_rmse,
                evaluation_mae,
                risk_category,
                explanation,
                created_at,
                status,
                target_date,
                confidence_score,
                metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(user_id),
                symbol.strip().upper(),
                horizon,
                reference,
                predicted,
                change,
                change_percent,
                model_name.strip(),
                risk_category.strip().lower(),
                str(safe_metadata.get("explanation", "")),
                created.isoformat(),
                "pending",
                target.isoformat(),
                confidence,
                json.dumps(safe_metadata, allow_nan=False),
            ),
        )

        prediction_id = cursor.lastrowid

    return get_prediction_record(
        prediction_id,
        user_id=str(user_id),
    )


# ---------------------------------------------------------------------
# Retrieve prediction history
# ---------------------------------------------------------------------

def get_prediction_record(
    prediction_id: Any,
    *,
    user_id: Any,
) -> dict[str, Any] | None:
    if user_id is None:
        raise ValueError("A user ID is required.")

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            SELECT *
            FROM predictions
            WHERE id = ? AND user_id = ?
            LIMIT 1
            """,
            (prediction_id, str(user_id)),
        )

        return _row_to_dict(cursor.fetchone())


def get_prediction_history(
    *,
    user_id: Any,
    status: str | None = None,
    symbol: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    if user_id is None:
        raise ValueError("A user ID is required.")

    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("Limit must be a positive integer.")

    if limit > 5000:
        limit = 5000

    conditions = ["user_id = ?"]
    parameters: list[Any] = [str(user_id)]

    if status:
        normalized_status = status.strip().lower()

        if normalized_status not in VALID_STATUSES:
            raise ValueError("Invalid prediction status.")

        conditions.append("status = ?")
        parameters.append(normalized_status)

    if symbol:
        conditions.append("symbol = ?")
        parameters.append(symbol.strip().upper())

    parameters.append(limit)

    query = f"""
        SELECT *
        FROM predictions
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    """

    with _get_connection() as db:
        cursor = db.cursor()
        cursor.execute(query, parameters)

        return [
            _row_to_dict(row)
            for row in cursor.fetchall()
        ]


# ---------------------------------------------------------------------
# Target notification creation and delivery updates
# ---------------------------------------------------------------------

def _create_target_notification(
    db: Any,
    *,
    user_id: str,
    symbol: str,
    target_price: float,
    current_price: float,
    prediction_id: int,
) -> None:
    """
    Create one in-app notification linked to its prediction.

    The unique index on prediction_id prevents duplicate target
    notifications for the same prediction.
    """
    cursor = db.cursor()

    subject = f"Price target reached: {symbol}"

    message = (
        f"Your predicted target price for {symbol} has been reached. "
        f"Target price: {target_price:.2f}. "
        f"Observed price: {current_price:.2f}. "
        f"Prediction ID: {prediction_id}. "
        "This notification does not mean that an investment was sold "
        "or that profit has been realized."
    )

    cursor.execute(
        """
        INSERT OR IGNORE INTO notifications (
            user_id,
            notification_type,
            subject,
            message,
            delivery_status,
            email_delivery_status,
            sms_delivery_status,
            is_read,
            created_at,
            sent_at,
            prediction_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
        """,
        (
            user_id,
            "prediction_target_reached",
            subject,
            message,
            "pending",
            "pending",
            "not_configured",
            _now().isoformat(),
            prediction_id,
        ),
    )


def _record_target_email_result(
    *,
    user_id: str,
    prediction_id: int,
    result: Mapping[str, Any] | None,
) -> bool:
    """
    Record one email attempt on both the prediction and its notification.

    Returns True when the email service reports success.
    """
    email_result = dict(result or {})

    success = bool(email_result.get("success"))

    attempted_at = _now().isoformat()
    sent_at = attempted_at if success else None

    error_message = (
        ""
        if success
        else str(
            email_result.get("message")
            or "Email delivery failed."
        )
    )

    email_status = (
        "sent"
        if success
        else str(email_result.get("status") or "failed")
    )

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            UPDATE predictions
            SET notification_attempted_at = ?,
                notification_sent_at = ?,
                notification_error = ?
            WHERE id = ?
              AND user_id = ?
              AND status = 'target_reached'
            """,
            (
                attempted_at,
                sent_at,
                error_message,
                prediction_id,
                user_id,
            ),
        )

        cursor.execute(
            """
            UPDATE notifications
            SET delivery_status = ?,
                email_delivery_status = ?,
                sent_at = ?,
                error_message = ?
            WHERE user_id = ?
              AND prediction_id = ?
              AND notification_type = 'prediction_target_reached'
            """,
            (
                "sent" if success else "failed",
                email_status,
                sent_at,
                error_message,
                user_id,
                prediction_id,
            ),
        )

    return success


# ---------------------------------------------------------------------
# Target-price monitoring
# ---------------------------------------------------------------------

def _target_is_reached(
    reference_price: float,
    predicted_price: float,
    current_price: float,
) -> bool:
    """
    Check target direction.

    Upward forecast: current price must reach or exceed target.
    Downward forecast: current price must reach or fall below target.
    """
    if predicted_price >= reference_price:
        return current_price >= predicted_price

    return current_price <= predicted_price


def _get_user_email(db: Any, user_id: str) -> str | None:
    cursor = db.cursor()

    cursor.execute(
        """
        SELECT email
        FROM users
        WHERE user_id = ?
        LIMIT 1
        """,
        (user_id,),
    )

    row = cursor.fetchone()

    if not row:
        return None

    return row["email"]


def _send_target_email(
    user_id: str,
    symbol: str,
    target_price: float,
    current_price: float,
    prediction_id: int,
) -> dict[str, Any]:
    """
    Send the target-reached email using the existing email service.
    """
    try:
        from backend.email_service import (
            get_email_service_status,
            send_email,
        )

        service_status = get_email_service_status()

        if not service_status.get("configured"):
            return {
                "success": False,
                "status": "not_configured",
                "message": "SMTP email service is not configured.",
            }

        with _get_connection() as db:
            email = _get_user_email(db, user_id)

        if not email:
            return {
                "success": False,
                "status": "failed",
                "message": "User email address was not found.",
            }

        subject = f"Market Plus AI: {symbol} target price reached"

        body = (
            f"Hello,\n\n"
            f"Your predicted target price for {symbol} has been reached.\n\n"
            f"Prediction ID: {prediction_id}\n"
            f"Target price: {target_price:.2f}\n"
            f"Observed stock price: {current_price:.2f}\n\n"
            "Please note:\n"
            "Reaching a predicted price does not mean an investment "
            "has been sold or that profit has been realized. "
            "Confirm your actual withdrawal separately if you sold "
            "your investment.\n\n"
            "Market Plus AI\n"
            "AI-based stock and asset prediction system"
        )

        html_body = f"""
        <html>
        <body style="font-family:Arial,sans-serif;color:#1f2937;
                     line-height:1.6">
            <div style="max-width:600px;margin:auto;padding:24px;
                        border:1px solid #e5e7eb;border-radius:12px">
                <h2 style="color:#2563eb">Market Plus AI</h2>
                <h3>Predicted target price reached</h3>
                <p>Your prediction target for
                   <strong>{symbol}</strong> has been reached.</p>
                <p><strong>Target price:</strong>
                   {target_price:.2f}</p>
                <p><strong>Observed price:</strong>
                   {current_price:.2f}</p>
                <p><strong>Prediction ID:</strong>
                   {prediction_id}</p>
                <hr>
                <p style="color:#b45309">
                    Important: Reaching a predicted target does not
                    confirm a sale or realized profit. Confirm your
                    actual withdrawal separately.
                </p>
                <p>Market Plus AI</p>
            </div>
        </body>
        </html>
        """

        return send_email(
            email,
            subject,
            body,
            html_body=html_body,
        )

    except Exception:
        logger.exception(
            "Target-reached email processing failed for prediction %s.",
            prediction_id,
        )

        return {
            "success": False,
            "status": "failed",
            "message": "Email processing failed.",
        }


def monitor_prediction_targets(
    current_prices: Mapping[str, Any],
) -> dict[str, Any]:
    """
    Evaluate pending predictions against supplied current prices.

    The caller obtains current prices from the project's market
    data service. This function does not make external market requests.
    """
    if not isinstance(current_prices, Mapping):
        raise ValueError("Current prices must be supplied as a mapping.")

    normalized_prices = {}

    for symbol, value in current_prices.items():
        if not isinstance(symbol, str) or not symbol.strip():
            continue

        try:
            normalized_prices[symbol.strip().upper()] = _number(
                value,
                positive=True,
            )
        except ValueError:
            logger.warning("Ignoring invalid price for %s.", symbol)

    if not normalized_prices:
        return {
            "checked": 0,
            "target_reached": 0,
            "emails_sent": 0,
            "email_failures": 0,
            "results": [],
        }

    init_prediction_history_schema()

    checked = 0
    reached = 0
    emails_sent = 0
    email_failures = 0
    results = []

    with _get_connection() as db:
        cursor = db.cursor()

        placeholders = ",".join("?" for _ in normalized_prices)

        cursor.execute(
            f"""
            SELECT *
            FROM predictions
            WHERE status IN ('pending', 'target_reached')
              AND symbol IN ({placeholders})
            """,
            list(normalized_prices.keys()),
        )

        records = cursor.fetchall()

    for raw_record in records:
        record = _row_to_dict(raw_record)

        if not record:
            continue

        prediction_id = record["id"]
        symbol = record["symbol"].upper()
        current_price = normalized_prices[symbol]

        reference_price = _number(
            record["reference_price"],
            positive=True,
        )

        predicted_price = _number(
            record["predicted_price"],
            positive=True,
        )

        checked += 1
        checked_at = _now().isoformat()

        has_reached = _target_is_reached(
            reference_price,
            predicted_price,
            current_price,
        )

        should_send_email = False

        with _get_connection() as db:
            cursor = db.cursor()

            if has_reached and record["status"] == "pending":
                cursor.execute(
                    """
                    UPDATE predictions
                    SET status = 'target_reached',
                        target_reached_at = ?,
                        last_price_checked_at = ?,
                        last_observed_price = ?
                    WHERE id = ?
                      AND user_id = ?
                      AND status = 'pending'
                    """,
                    (
                        checked_at,
                        checked_at,
                        current_price,
                        prediction_id,
                        record["user_id"],
                    ),
                )

                if cursor.rowcount:
                    reached += 1
                    should_send_email = True

                    _create_target_notification(
                        db,
                        user_id=str(record["user_id"]),
                        symbol=symbol,
                        target_price=predicted_price,
                        current_price=current_price,
                        prediction_id=prediction_id,
                    )

            elif record["status"] == "target_reached":
                cursor.execute(
                    """
                    UPDATE predictions
                    SET last_price_checked_at = ?,
                        last_observed_price = ?
                    WHERE id = ?
                      AND user_id = ?
                      AND status = 'target_reached'
                    """,
                    (
                        checked_at,
                        current_price,
                        prediction_id,
                        record["user_id"],
                    ),
                )

        email_result = None

        if should_send_email:
            email_result = _send_target_email(
                str(record["user_id"]),
                symbol,
                predicted_price,
                current_price,
                prediction_id,
            )

            email_success = _record_target_email_result(
                user_id=str(record["user_id"]),
                prediction_id=prediction_id,
                result=email_result,
            )

            if email_success:
                emails_sent += 1
            else:
                email_failures += 1

        results.append({
            "prediction_id": prediction_id,
            "symbol": symbol,
            "current_price": current_price,
            "predicted_price": predicted_price,
            "target_reached": has_reached,
            "status": (
                "target_reached" if has_reached else record["status"]
            ),
            "email": email_result,
        })

    return {
        "checked": checked,
        "target_reached": reached,
        "emails_sent": emails_sent,
        "email_failures": email_failures,
        "results": results,
    }


# ---------------------------------------------------------------------
# Email retry
# ---------------------------------------------------------------------

def retry_target_reached_emails(
    *,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Retry target-reached predictions whose email has not been sent.

    Both prediction and corresponding notification delivery fields
    are updated after every attempt.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("Limit must be a positive integer.")

    init_prediction_history_schema()

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            SELECT *
            FROM predictions
            WHERE status = 'target_reached'
              AND notification_sent_at IS NULL
            ORDER BY target_reached_at ASC
            LIMIT ?
            """,
            (min(limit, 500),),
        )

        records = [
            _row_to_dict(row)
            for row in cursor.fetchall()
        ]

    sent = 0
    failed = 0

    for record in records:
        if not record:
            continue

        result = _send_target_email(
            str(record["user_id"]),
            record["symbol"],
            float(record["predicted_price"]),
            float(
                record.get("last_observed_price")
                or record["predicted_price"]
            ),
            int(record["id"]),
        )

        success = _record_target_email_result(
            user_id=str(record["user_id"]),
            prediction_id=int(record["id"]),
            result=result,
        )

        if success:
            sent += 1
        else:
            failed += 1

    return {
        "attempted": len(records),
        "sent": sent,
        "failed": failed,
    }


# ---------------------------------------------------------------------
# Complete prediction after actual withdrawal
# ---------------------------------------------------------------------

def complete_prediction_record(
    prediction_id: Any,
    *,
    user_id: Any,
    actual_withdrawal_price: Any,
    withdrawal_date: Any = None,
    actual_quantity: Any = None,
) -> dict[str, Any]:
    """
    Confirm actual withdrawal and complete a target-reached prediction.

    Profit/loss is calculated only when actual_quantity is supplied.
    Without quantity, the service records the actual withdrawal price
    but does not invent a realized monetary profit/loss.
    """
    if user_id is None:
        raise ValueError("A user ID is required.")

    withdrawal_price = _number(
        actual_withdrawal_price,
        positive=True,
    )

    withdrawal_at = _parse_datetime(
        withdrawal_date if withdrawal_date is not None else _now()
    )

    if withdrawal_at is None:
        raise ValueError("Invalid withdrawal date.")

    quantity = None

    if actual_quantity is not None:
        quantity = _number(
            actual_quantity,
            positive=True,
        )

    init_prediction_history_schema()

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            SELECT *
            FROM predictions
            WHERE id = ? AND user_id = ?
            LIMIT 1
            """,
            (prediction_id, str(user_id)),
        )

        row = cursor.fetchone()

        if not row:
            raise ValueError("Prediction record was not found.")

        record = _row_to_dict(row)

        if record["status"] == "completed":
            raise ValueError("This prediction is already completed.")

        if record["status"] != "target_reached":
            raise ValueError(
                "Only target-reached predictions can be completed."
            )

        reference_price = _number(
            record["reference_price"],
            positive=True,
        )

        profit_loss = None
        return_percent = None

        if quantity is not None:
            profit_loss = (
                withdrawal_price - reference_price
            ) * quantity

            invested_amount = reference_price * quantity

            return_percent = (
                profit_loss / invested_amount
            ) * 100.0

        cursor.execute(
            """
            UPDATE predictions
            SET status = 'completed',
                actual_withdrawal_price = ?,
                withdrawal_date = ?,
                actual_quantity = ?,
                actual_profit_loss = ?,
                actual_return_percent = ?
            WHERE id = ?
              AND user_id = ?
              AND status = 'target_reached'
            """,
            (
                withdrawal_price,
                withdrawal_at.isoformat(),
                quantity,
                profit_loss,
                return_percent,
                prediction_id,
                str(user_id),
            ),
        )

        if cursor.rowcount != 1:
            raise ValueError(
                "Prediction status changed before completion."
            )

        cursor.execute(
            """
            INSERT INTO completed_predictions (
                prediction_id,
                user_id,
                symbol,
                reference_price,
                predicted_price,
                actual_withdrawal_price,
                actual_quantity,
                actual_profit_loss,
                actual_return_percent,
                withdrawal_date,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                prediction_id,
                str(user_id),
                record["symbol"],
                reference_price,
                record["predicted_price"],
                withdrawal_price,
                quantity,
                profit_loss,
                return_percent,
                withdrawal_at.isoformat(),
                _now().isoformat(),
            ),
        )

    return get_prediction_record(
        prediction_id,
        user_id=str(user_id),
    )


# ---------------------------------------------------------------------
# Cancel prediction
# ---------------------------------------------------------------------

def cancel_prediction_record(
    prediction_id: Any,
    *,
    user_id: Any,
) -> dict[str, Any]:
    if user_id is None:
        raise ValueError("A user ID is required.")

    init_prediction_history_schema()

    with _get_connection() as db:
        cursor = db.cursor()

        cursor.execute(
            """
            UPDATE predictions
            SET status = 'cancelled',
                cancelled_at = ?
            WHERE id = ?
              AND user_id = ?
              AND status = 'pending'
            """,
            (
                _now().isoformat(),
                prediction_id,
                str(user_id),
            ),
        )

        if cursor.rowcount == 0:
            cursor.execute(
                """
                SELECT status
                FROM predictions
                WHERE id = ? AND user_id = ?
                """,
                (prediction_id, str(user_id)),
            )

            row = cursor.fetchone()

            if not row:
                raise ValueError("Prediction record was not found.")

            raise ValueError(
                "Only pending predictions can be cancelled."
            )

    return get_prediction_record(
        prediction_id,
        user_id=str(user_id),
    )


# ---------------------------------------------------------------------
# Filtering and summary
# ---------------------------------------------------------------------

def filter_prediction_history(
    records: Iterable[Mapping[str, Any]],
    *,
    user_id: Any = None,
    symbol: str | None = None,
    status: str | None = None,
    start_date: Any = None,
    end_date: Any = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("Limit must be a positive integer.")

    start = _parse_datetime(start_date) if start_date is not None else None
    end = _parse_datetime(end_date) if end_date is not None else None

    if start_date is not None and start is None:
        raise ValueError("Invalid start date.")

    if end_date is not None and end is None:
        raise ValueError("Invalid end date.")

    if start and end and start > end:
        raise ValueError("Start date cannot be after end date.")

    normalized_status = status.strip().lower() if status else None

    if normalized_status and normalized_status not in VALID_STATUSES:
        raise ValueError("Invalid prediction status.")

    normalized_symbol = symbol.strip().upper() if symbol else None

    results = []

    for item in records:
        if not isinstance(item, Mapping):
            continue

        if user_id is not None and str(item.get("user_id")) != str(user_id):
            continue

        if normalized_symbol and (
            str(item.get("symbol", "")).upper() != normalized_symbol
        ):
            continue

        if normalized_status and (
            str(item.get("status", "")).lower() != normalized_status
        ):
            continue

        record_date = _parse_datetime(
            item.get("created_at") or item.get("prediction_date")
        )

        if record_date is None:
            continue

        if start and record_date < start:
            continue

        if end and record_date > end:
            continue

        results.append(dict(item))

    results.sort(
        key=lambda item: (
            _parse_datetime(
                item.get("created_at") or item.get("prediction_date")
            )
            or datetime.min.replace(tzinfo=timezone.utc)
        ),
        reverse=True,
    )

    return results[:limit]


def summarize_prediction_history(
    records: Iterable[Mapping[str, Any]],
    *,
    user_id: Any = None,
) -> dict[str, Any]:
    scoped = [
        dict(record)
        for record in records
        if isinstance(record, Mapping)
        and (
            user_id is None
            or str(record.get("user_id")) == str(user_id)
        )
    ]

    counts = {
        status: sum(
            str(record.get("status", "")).lower() == status
            for record in scoped
        )
        for status in VALID_STATUSES
    }

    evaluated_errors = []

    for record in scoped:
        predicted = _safe_float(record.get("predicted_price"))
        actual = _safe_float(record.get("actual_price"))

        if predicted is not None and actual is not None and actual > 0:
            evaluated_errors.append(abs(predicted - actual))

    completed_returns = [
        value
        for record in scoped
        if record.get("status") == "completed"
        and (
            value := _safe_float(record.get("actual_return_percent"))
        ) is not None
    ]

    return {
        "total_predictions": len(scoped),
        "pending_predictions": counts["pending"],
        "target_reached_predictions": counts["target_reached"],
        "completed_predictions": counts["completed"],
        "cancelled_predictions": counts["cancelled"],
        "evaluated_predictions": len(evaluated_errors),
        "mean_absolute_error": (
            round(sum(evaluated_errors) / len(evaluated_errors), 6)
            if evaluated_errors else None
        ),
        "average_actual_return_percent": (
            round(sum(completed_returns) / len(completed_returns), 6)
            if completed_returns else None
        ),
        "note": (
            "Target reached does not mean an investment was sold. "
            "Realized profit/loss requires confirmed withdrawal details."
        ),
    }


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None

    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return result if math.isfinite(result) else None
