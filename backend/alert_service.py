
"""Price-alert management for Market Plus AI.

Features:
- Create, list, retrieve and cancel user price alerts.
- Store the selected currency with each alert.
- Evaluate active alerts against supplied market prices.
- Create in-app notifications when alerts trigger.
- Send actual email alerts through backend.email_service.
- Track email and SMS delivery independently.
- Support notification read/unread status.
- Preserve user ownership and existing SQLite records.

Notification defaults:
- In-app: enabled automatically for every triggered alert.
- Email: enabled by default.
- SMS: enabled by default as a notification preference.
- SMS delivery remains not_configured until provider integration.
"""

import logging
import math
import sqlite3
from typing import Any, Optional

from backend.database import get_db, utc_now
from backend.email_service import send_email

logger = logging.getLogger(__name__)

VALID_CONDITIONS = {"reaches", "above", "below"}
VALID_STATUSES = {"active", "triggered", "cancelled"}
VALID_DELIVERY_STATUSES = {
    "pending",
    "sent",
    "failed",
    "not_configured",
}

# ISO 4217 currency codes.
VALID_CURRENCIES = {
    "INR", "USD", "GBP", "EUR", "CAD", "AUD", "JPY",
    "AED", "SGD", "CHF", "CNY", "NZD", "SAR", "BDT",
    "PKR", "NPR", "LKR", "ZAR", "KRW", "BRL", "MYR",
    "IDR", "THB", "MXN", "NGN", "KES", "EGP", "TRY",
    "SEK", "NOK", "DKK", "PLN", "QAR", "KWD", "BHD",
    "OMR", "PHP", "VND", "ARS",
}


# ---------------------------------------------------------------------
# VALIDATION HELPERS
# ---------------------------------------------------------------------

def _normalize_symbol(symbol: Any) -> str:
    """Normalize and validate a market symbol."""
    if not isinstance(symbol, str):
        raise ValueError("A valid asset symbol is required.")

    normalized = symbol.strip().upper()

    if not normalized:
        raise ValueError("A valid asset symbol is required.")

    if len(normalized) > 50:
        raise ValueError("The asset symbol must not exceed 50 characters.")

    if any(ord(character) < 32 for character in normalized):
        raise ValueError("The asset symbol contains invalid characters.")

    return normalized


def _normalize_currency(currency: Any) -> str:
    """Validate and normalize an ISO currency code."""
    if not isinstance(currency, str):
        raise ValueError("A valid currency code is required.")

    normalized = currency.strip().upper()

    if normalized not in VALID_CURRENCIES:
        raise ValueError("Select a supported currency.")

    return normalized


def _positive_price(value: Any, field_name: str = "Price") -> float:
    """Convert a value into a finite positive floating-point price."""
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a positive number.")

    try:
        price = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(
            f"{field_name} must be a positive number."
        ) from None

    if not math.isfinite(price) or price <= 0:
        raise ValueError(f"{field_name} must be a positive number.")

    return price


def _normalize_condition(condition: Any) -> str:
    """Validate an alert condition."""
    if not isinstance(condition, str):
        raise ValueError("A valid alert condition is required.")

    normalized = condition.strip().lower()

    # Support the fixed frontend alert condition.
    if normalized == "target_reached":
        normalized = "reaches"

    if normalized not in VALID_CONDITIONS:
        raise ValueError(
            "Condition must be 'reaches', 'above', or 'below'."
        )

    return normalized


def _normalize_user_id(user_id: Any) -> str:
    """Validate the application's generated user ID."""
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("A valid user ID is required.")

    normalized = user_id.strip()

    if len(normalized) > 100:
        raise ValueError("The user ID is invalid.")

    return normalized


def _normalize_id(value: Any, field_name: str) -> int:
    """Validate a positive database ID."""
    if isinstance(value, bool):
        raise ValueError(f"A valid {field_name} is required.")

    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"A valid {field_name} is required.") from None

    if result < 1:
        raise ValueError(f"A valid {field_name} is required.")

    return result


def _row_to_dict(row: Any) -> Optional[dict]:
    """Convert a SQLite row to a regular dictionary."""
    if row is None:
        return None

    return dict(row)


def _validate_boolean(value: Any, field_name: str) -> bool:
    """Validate an actual boolean setting."""
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be true or false.")

    return value


# ---------------------------------------------------------------------
# CREATE ALERT
# ---------------------------------------------------------------------

def create_alert(
    user_id: str,
    symbol: str,
    target_price: float,
    condition: str = "reaches",
    email_enabled: bool = True,
    sms_enabled: bool = True,
    currency: str = "INR",
) -> dict:
    """Create a price alert for an existing user.

    Defaults:
    - In-app notifications are automatically created when triggered.
    - Email notifications are enabled.
    - SMS notifications are enabled as a preference, but delivery
      remains not_configured until an SMS provider is integrated.
    - Currency defaults to INR when not supplied.
    """
    normalized_user_id = _normalize_user_id(user_id)
    normalized_symbol = _normalize_symbol(symbol)
    normalized_target = _positive_price(target_price, "Target price")
    normalized_condition = _normalize_condition(condition)
    normalized_currency = _normalize_currency(currency)

    email_enabled = _validate_boolean(
        email_enabled,
        "email_enabled",
    )

    sms_enabled = _validate_boolean(
        sms_enabled,
        "sms_enabled",
    )

    now = utc_now()

    try:
        with get_db() as db:
            user = db.execute(
                """
                SELECT user_id
                FROM users
                WHERE user_id = ?
                """,
                (normalized_user_id,),
            ).fetchone()

            if user is None:
                raise ValueError("The specified user does not exist.")

            cursor = db.execute(
                """
                INSERT INTO alerts (
                    user_id,
                    symbol,
                    target_price,
                    currency,
                    condition,
                    status,
                    email_enabled,
                    sms_enabled,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
                """,
                (
                    normalized_user_id,
                    normalized_symbol,
                    normalized_target,
                    normalized_currency,
                    normalized_condition,
                    int(email_enabled),
                    int(sms_enabled),
                    now,
                    now,
                ),
            )

            alert_id = cursor.lastrowid

            row = db.execute(
                """
                SELECT *
                FROM alerts
                WHERE id = ? AND user_id = ?
                """,
                (alert_id, normalized_user_id),
            ).fetchone()

            return _row_to_dict(row)

    except sqlite3.IntegrityError as exc:
        raise ValueError(
            "Unable to create the alert. Check the user and alert details."
        ) from exc


# ---------------------------------------------------------------------
# LIST AND RETRIEVE ALERTS
# ---------------------------------------------------------------------

def get_alerts(
    user_id: str,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Return alerts belonging to a user."""
    normalized_user_id = _normalize_user_id(user_id)

    if isinstance(limit, bool) or not isinstance(limit, int):
        raise ValueError("Limit must be an integer.")

    if limit < 1 or limit > 500:
        raise ValueError("Limit must be between 1 and 500.")

    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("Offset must be a non-negative integer.")

    conditions = ["user_id = ?"]
    parameters: list[Any] = [normalized_user_id]

    if status is not None:
        if not isinstance(status, str):
            raise ValueError("Invalid alert status.")

        normalized_status = status.strip().lower()

        if normalized_status not in VALID_STATUSES:
            raise ValueError(
                "Status must be active, triggered, or cancelled."
            )

        conditions.append("status = ?")
        parameters.append(normalized_status)

    if symbol is not None:
        conditions.append("symbol = ?")
        parameters.append(_normalize_symbol(symbol))

    where_clause = " AND ".join(conditions)

    with get_db() as db:
        rows = db.execute(
            f"""
            SELECT *
            FROM alerts
            WHERE {where_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (*parameters, limit, offset),
        ).fetchall()

    return [_row_to_dict(row) for row in rows]


def get_alert(user_id: str, alert_id: int) -> Optional[dict]:
    """Return one alert only if it belongs to the specified user."""
    normalized_user_id = _normalize_user_id(user_id)
    normalized_alert_id = _normalize_id(alert_id, "alert ID")

    with get_db() as db:
        row = db.execute(
            """
            SELECT *
            FROM alerts
            WHERE id = ? AND user_id = ?
            """,
            (normalized_alert_id, normalized_user_id),
        ).fetchone()

    return _row_to_dict(row)


# ---------------------------------------------------------------------
# CANCEL ALERT
# ---------------------------------------------------------------------

def cancel_alert(user_id: str, alert_id: int) -> dict:
    """Cancel an active alert owned by the specified user."""
    normalized_user_id = _normalize_user_id(user_id)
    normalized_alert_id = _normalize_id(alert_id, "alert ID")

    with get_db() as db:
        row = db.execute(
            """
            SELECT *
            FROM alerts
            WHERE id = ? AND user_id = ?
            """,
            (normalized_alert_id, normalized_user_id),
        ).fetchone()

        if row is None:
            raise ValueError("Alert not found.")

        if row["status"] != "active":
            raise ValueError(
                f"Only active alerts can be cancelled. "
                f"Current status: {row['status']}."
            )

        db.execute(
            """
            UPDATE alerts
            SET status = 'cancelled',
                updated_at = ?
            WHERE id = ?
              AND user_id = ?
              AND status = 'active'
            """,
            (
                utc_now(),
                normalized_alert_id,
                normalized_user_id,
            ),
        )

        updated = db.execute(
            """
            SELECT *
            FROM alerts
            WHERE id = ? AND user_id = ?
            """,
            (normalized_alert_id, normalized_user_id),
        ).fetchone()

        return _row_to_dict(updated)


# ---------------------------------------------------------------------
# ALERT CONDITION EVALUATION
# ---------------------------------------------------------------------

def _condition_is_met(
    current_price: float,
    target_price: float,
    condition: str,
) -> bool:
    """Return whether the current price satisfies an alert condition."""
    if condition == "reaches":
        return current_price >= target_price

    if condition == "above":
        return current_price > target_price

    if condition == "below":
        return current_price < target_price

    return False


def _deliver_email(
    notification_id: int,
    recipient: str,
    subject: str,
    message: str,
) -> dict:
    """Send email and persist its actual delivery result."""
    try:
        result = send_email(
            to_email=recipient,
            subject=subject,
            body=message,
        )

        status = result.get("status", "failed")

        if status not in VALID_DELIVERY_STATUSES:
            status = "failed"

        error_message = result.get("error", "")

        if status == "failed" and not error_message:
            error_message = result.get("message", "Email delivery failed.")

    except Exception:
        # Do not let an SMTP failure undo an already-triggered alert.
        logger.exception(
            "Email delivery failed for notification ID %s.",
            notification_id,
        )
        status = "failed"
        error_message = "Unexpected email delivery error."

    try:
        update_notification_delivery(
            notification_id=notification_id,
            delivery_status=status,
            error_message=error_message,
        )
    except Exception:
        logger.exception(
            "Could not save email delivery status for notification ID %s.",
            notification_id,
        )

    return {
        "notification_id": notification_id,
        "email_delivery_status": status,
        "success": status == "sent",
    }


def evaluate_alerts(symbol: str, current_price: float) -> dict:
    """Evaluate active alerts for one symbol against a supplied price.

    The alert and in-app notification are committed before attempting
    email delivery. This prevents SMTP failures from rolling back alerts.

    SMS is enabled as a preference by default, but delivery remains
    not_configured until an SMS provider is integrated.
    """
    normalized_symbol = _normalize_symbol(symbol)
    normalized_price = _positive_price(current_price, "Current price")
    now = utc_now()

    triggered_alerts: list[dict] = []
    email_jobs: list[dict] = []
    evaluated_count = 0

    with get_db() as db:
        rows = db.execute(
            """
            SELECT
                a.*,
                u.email AS recipient_email
            FROM alerts AS a
            INNER JOIN users AS u
                ON u.user_id = a.user_id
            WHERE a.symbol = ?
              AND a.status = 'active'
            ORDER BY a.id ASC
            """,
            (normalized_symbol,),
        ).fetchall()

        evaluated_count = len(rows)

        for row in rows:
            alert = dict(row)

            if not _condition_is_met(
                normalized_price,
                float(alert["target_price"]),
                alert["condition"],
            ):
                continue

            cursor = db.execute(
                """
                UPDATE alerts
                SET status = 'triggered',
                    triggered_price = ?,
                    triggered_at = ?,
                    updated_at = ?
                WHERE id = ?
                  AND status = 'active'
                """,
                (
                    normalized_price,
                    now,
                    now,
                    alert["id"],
                ),
            )

            if cursor.rowcount != 1:
                continue

            currency = alert.get("currency") or "INR"

            subject = f"Price alert triggered: {normalized_symbol}"

            message = (
                f"Hello,\n\n"
                f"Your Market Plus AI price alert has been triggered.\n\n"
                f"Asset: {normalized_symbol}\n"
                f"Target price: {currency} "
                f"{float(alert['target_price']):,.2f}\n"
                f"Observed price: {currency} "
                f"{normalized_price:,.2f}\n"
                f"Condition: {alert['condition']}\n"
                f"Alert ID: {alert['id']}\n\n"
                f"This is an informational price notification, "
                f"not a recommendation to buy or sell.\n\n"
                f"Market Plus AI"
            )

            email_enabled = bool(alert["email_enabled"])
            sms_enabled = bool(alert["sms_enabled"])

            email_status = (
                "pending" if email_enabled else "not_configured"
            )

            # SMS is not integrated. Do not mark it as sent.
            # sms_enabled records the user's notification preference.
            sms_status = "not_configured"

            # In-app notification is always created for triggered alerts.
            legacy_delivery_status = email_status

            notification_cursor = db.execute(
                """
                INSERT INTO notifications (
                    user_id,
                    alert_id,
                    notification_type,
                    subject,
                    message,
                    delivery_status,
                    email_delivery_status,
                    sms_delivery_status,
                    is_read,
                    error_message,
                    created_at
                )
                VALUES (
                    ?, ?, 'price_alert', ?, ?, ?, ?, ?, 0, '', ?
                )
                """,
                (
                    alert["user_id"],
                    alert["id"],
                    subject,
                    message,
                    legacy_delivery_status,
                    email_status,
                    sms_status,
                    now,
                ),
            )

            notification_id = notification_cursor.lastrowid

            updated_row = db.execute(
                """
                SELECT *
                FROM alerts
                WHERE id = ?
                """,
                (alert["id"],),
            ).fetchone()

            triggered_alerts.append({
                "alert": _row_to_dict(updated_row),
                "notification_id": notification_id,
                "email_delivery_status": email_status,
                "sms_delivery_status": sms_status,
                "in_app_delivery_status": "created",
            })

            if email_enabled:
                email_jobs.append({
                    "notification_id": notification_id,
                    "recipient": alert["recipient_email"],
                    "subject": subject,
                    "message": message,
                })

            # Keep the preference visible in logs without claiming delivery.
            if sms_enabled:
                logger.info(
                    "SMS notification preference enabled for alert %s; "
                    "SMS delivery is not configured.",
                    alert["id"],
                )

    # The database transaction has committed at this point.
    # Perform network operations outside the database transaction.
    delivery_results = []

    for job in email_jobs:
        delivery_results.append(
            _deliver_email(
                notification_id=job["notification_id"],
                recipient=job["recipient"],
                subject=job["subject"],
                message=job["message"],
            )
        )

    delivery_by_id = {
        item["notification_id"]: item
        for item in delivery_results
    }

    for item in triggered_alerts:
        delivery = delivery_by_id.get(item["notification_id"])

        if delivery:
            item["email_delivery_status"] = (
                delivery["email_delivery_status"]
            )

    return {
        "success": True,
        "symbol": normalized_symbol,
        "current_price": normalized_price,
        "evaluated_count": evaluated_count,
        "triggered_count": len(triggered_alerts),
        "triggered_alerts": triggered_alerts,
        "email_attempted_count": len(delivery_results),
        "email_sent_count": sum(
            1 for item in delivery_results if item["success"]
        ),
        "email_failed_count": sum(
            1 for item in delivery_results if not item["success"]
        ),
        "email_results": delivery_results,
        "evaluated_at": now,
    }


# ---------------------------------------------------------------------
# NOTIFICATION MANAGEMENT
# ---------------------------------------------------------------------

def get_notifications(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
) -> list[dict]:
    """Return notifications belonging to a user."""
    normalized_user_id = _normalize_user_id(user_id)

    if isinstance(limit, bool) or not isinstance(limit, int):
        raise ValueError("Limit must be an integer.")

    if limit < 1 or limit > 500:
        raise ValueError("Limit must be between 1 and 500.")

    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("Offset must be a non-negative integer.")

    if not isinstance(unread_only, bool):
        raise ValueError("unread_only must be true or false.")

    query = """
        SELECT *
        FROM notifications
        WHERE user_id = ?
    """

    parameters: list[Any] = [normalized_user_id]

    if unread_only:
        query += " AND is_read = 0"

    query += """
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    """

    parameters.extend([limit, offset])

    with get_db() as db:
        rows = db.execute(query, parameters).fetchall()

    return [_row_to_dict(row) for row in rows]


def mark_notification_read(user_id: str, notification_id: int) -> dict:
    """Mark a notification as read, only for its owning user."""
    normalized_user_id = _normalize_user_id(user_id)
    normalized_notification_id = _normalize_id(
        notification_id,
        "notification ID",
    )

    with get_db() as db:
        existing = db.execute(
            """
            SELECT id
            FROM notifications
            WHERE id = ? AND user_id = ?
            """,
            (normalized_notification_id, normalized_user_id),
        ).fetchone()

        if existing is None:
            raise ValueError("Notification not found.")

        db.execute(
            """
            UPDATE notifications
            SET is_read = 1,
                read_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                utc_now(),
                normalized_notification_id,
                normalized_user_id,
            ),
        )

        row = db.execute(
            """
            SELECT *
            FROM notifications
            WHERE id = ? AND user_id = ?
            """,
            (normalized_notification_id, normalized_user_id),
        ).fetchone()

    return _row_to_dict(row)


def mark_all_notifications_read(user_id: str) -> dict:
    """Mark all unread notifications as read for one user."""
    normalized_user_id = _normalize_user_id(user_id)
    now = utc_now()

    with get_db() as db:
        cursor = db.execute(
            """
            UPDATE notifications
            SET is_read = 1,
                read_at = ?
            WHERE user_id = ?
              AND is_read = 0
            """,
            (now, normalized_user_id),
        )

        updated_count = cursor.rowcount

    return {
        "success": True,
        "updated_count": updated_count,
    }


def get_unread_notification_count(user_id: str) -> int:
    """Return the number of unread notifications belonging to the user."""
    normalized_user_id = _normalize_user_id(user_id)

    with get_db() as db:
        row = db.execute(
            """
            SELECT COUNT(*) AS total
            FROM notifications
            WHERE user_id = ?
              AND is_read = 0
            """,
            (normalized_user_id,),
        ).fetchone()

    return int(row["total"])


def update_notification_delivery(
    notification_id: int,
    delivery_status: str,
    error_message: str = "",
    channel: str = "email",
) -> dict:
    """Update email or SMS delivery status for a notification.

    The legacy delivery_status column continues to mirror email status
    for compatibility with existing code.
    """
    normalized_id = _normalize_id(
        notification_id,
        "notification ID",
    )

    if not isinstance(delivery_status, str):
        raise ValueError("Invalid delivery status.")

    normalized_status = delivery_status.strip().lower()

    if normalized_status not in VALID_DELIVERY_STATUSES:
        raise ValueError("Invalid delivery status.")

    if not isinstance(error_message, str):
        raise ValueError("Error message must be text.")

    if not isinstance(channel, str):
        raise ValueError("Delivery channel must be email or sms.")

    normalized_channel = channel.strip().lower()

    if normalized_channel not in {"email", "sms"}:
        raise ValueError("Delivery channel must be email or sms.")

    safe_error_message = error_message.strip()[:1000]

    with get_db() as db:
        existing = db.execute(
            """
            SELECT *
            FROM notifications
            WHERE id = ?
            """,
            (normalized_id,),
        ).fetchone()

        if existing is None:
            raise ValueError("Notification not found.")

        sent_at = (
            utc_now()
            if normalized_status == "sent"
            else existing["sent_at"]
        )

        if normalized_channel == "email":
            db.execute(
                """
                UPDATE notifications
                SET email_delivery_status = ?,
                    delivery_status = ?,
                    error_message = ?,
                    sent_at = ?
                WHERE id = ?
                """,
                (
                    normalized_status,
                    normalized_status,
                    safe_error_message,
                    sent_at,
                    normalized_id,
                ),
            )
        else:
            db.execute(
                """
                UPDATE notifications
                SET sms_delivery_status = ?
                WHERE id = ?
                """,
                (
                    normalized_status,
                    normalized_id,
                ),
            )

        updated = db.execute(
            """
            SELECT *
            FROM notifications
            WHERE id = ?
            """,
            (normalized_id,),
        ).fetchone()

    return _row_to_dict(updated)


# ---------------------------------------------------------------------
# ALERT SUMMARY
# ---------------------------------------------------------------------

def get_alert_summary(user_id: str) -> dict:
    """Return alert and notification counts for a user."""
    normalized_user_id = _normalize_user_id(user_id)

    with get_db() as db:
        rows = db.execute(
            """
            SELECT status, COUNT(*) AS total
            FROM alerts
            WHERE user_id = ?
            GROUP BY status
            """,
            (normalized_user_id,),
        ).fetchall()

        notification_row = db.execute(
            """
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(
                    CASE WHEN is_read = 0 THEN 1 ELSE 0 END
                ), 0) AS unread
            FROM notifications
            WHERE user_id = ?
            """,
            (normalized_user_id,),
        ).fetchone()

    counts = {
        "active": 0,
        "triggered": 0,
        "cancelled": 0,
    }

    for row in rows:
        counts[row["status"]] = int(row["total"])

    return {
        "total_alerts": sum(counts.values()),
        "active_alerts": counts["active"],
        "triggered_alerts": counts["triggered"],
        "cancelled_alerts": counts["cancelled"],
        "total_notifications": int(notification_row["total"]),
        "unread_notifications": int(notification_row["unread"]),
    }
