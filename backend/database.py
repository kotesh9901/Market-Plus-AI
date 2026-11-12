"""
SQLite database layer for Market Plus AI.

Supports authentication, predictions, stock data, price alerts,
email/SMS delivery tracking, notifications, news, assistant services,
user-specific investment and trade tracking, and What-If scenarios.

User preferences:
- Country
- Preferred language
- Preferred display currency

Database migrations preserve existing user data and records.
"""

import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from config import Config

logger = logging.getLogger(__name__)


def utc_now():
    """Return a timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _database_path():
    """Return the configured database path and create its parent directory."""
    path = str(Config.DATABASE_PATH)

    if path != ":memory:":
        from pathlib import Path

        Path(path).expanduser().resolve().parent.mkdir(
            parents=True,
            exist_ok=True,
        )

    return path


@contextmanager
def get_db():
    """Yield a SQLite connection with row access and transaction handling."""
    connection = sqlite3.connect(
        _database_path(),
        timeout=30,
    )
    connection.row_factory = sqlite3.Row

    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")

        yield connection

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def _get_table_columns(db, table_name):
    """Return the existing column names for a SQLite table."""
    rows = db.execute(
        f"PRAGMA table_info({table_name})"
    ).fetchall()

    return {row["name"] for row in rows}


def _add_column_if_missing(db, table_name, column_name, definition):
    """Safely add a column only when it does not already exist."""
    columns = _get_table_columns(db, table_name)

    if column_name in columns:
        return False

    db.execute(
        f"ALTER TABLE {table_name} "
        f"ADD COLUMN {column_name} {definition}"
    )

    logger.info(
        "Database migration: added %s.%s",
        table_name,
        column_name,
    )

    return True


def _migrate_user_preferences(db):
    """
    Add country, language and preferred currency to existing users.

    Existing user records are preserved.
    """

    _add_column_if_missing(
        db,
        "users",
        "country",
        "TEXT NOT NULL DEFAULT 'India'",
    )

    _add_column_if_missing(
        db,
        "users",
        "language",
        "TEXT NOT NULL DEFAULT 'en'",
    )

    _add_column_if_missing(
        db,
        "users",
        "preferred_currency",
        "TEXT NOT NULL DEFAULT 'INR'",
    )

    db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_users_country
        ON users(country)
        """
    )

    logger.info("User preference migration completed.")


def _migrate_notification_tables(db):
    """Add email, SMS and read/unread notification support."""

    _add_column_if_missing(
        db,
        "alerts",
        "sms_enabled",
        "INTEGER NOT NULL DEFAULT 0 CHECK (sms_enabled IN (0, 1))",
    )

    _add_column_if_missing(
        db,
        "notifications",
        "is_read",
        "INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1))",
    )

    _add_column_if_missing(
        db,
        "notifications",
        "read_at",
        "TEXT",
    )

    email_column_added = _add_column_if_missing(
        db,
        "notifications",
        "email_delivery_status",
        """
        TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            email_delivery_status IN (
                'pending', 'sent', 'failed', 'not_configured'
            )
        )
        """,
    )

    _add_column_if_missing(
        db,
        "notifications",
        "sms_delivery_status",
        """
        TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (
            sms_delivery_status IN (
                'pending', 'sent', 'failed', 'not_configured'
            )
        )
        """,
    )

    if email_column_added:
        db.execute(
            """
            UPDATE notifications
            SET email_delivery_status = delivery_status
            """
        )

    db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
        ON notifications(user_id, is_read, created_at)
        """
    )

    db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_notifications_delivery
        ON notifications(email_delivery_status, sms_delivery_status)
        """
    )


def _migrate_what_if_scenarios(db):
    """
    Ensure persistent, user-specific What-If scenario storage exists.

    This is safe to run repeatedly and does not delete existing records.
    """

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS what_if_scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id TEXT NOT NULL,

            scenario_name TEXT NOT NULL DEFAULT '',

            symbol TEXT NOT NULL,

            company_name TEXT DEFAULT '',

            investment_amount REAL NOT NULL DEFAULT 0,

            entry_price REAL NOT NULL DEFAULT 0,

            predicted_price REAL NOT NULL DEFAULT 0,

            horizon_days INTEGER NOT NULL DEFAULT 1,

            model_name TEXT DEFAULT '',

            result_json TEXT NOT NULL DEFAULT '{}',

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
        CREATE INDEX IF NOT EXISTS idx_what_if_user_created
        ON what_if_scenarios(user_id, created_at DESC)
        """
    )

    db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_what_if_symbol
        ON what_if_scenarios(symbol)
        """
    )

    logger.info("What-If scenario storage migration completed.")


def init_db():
    """Create application tables and safely migrate existing databases."""
    Config.ensure_directories()

    with get_db() as db:

        if _database_path() != ":memory:":
            db.execute("PRAGMA journal_mode = WAL")

        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                phone TEXT DEFAULT '',
                password_hash TEXT NOT NULL,

                risk_category TEXT NOT NULL DEFAULT 'middle'
                    CHECK (risk_category IN ('low', 'middle', 'high')),

                country TEXT NOT NULL DEFAULT 'India',
                language TEXT NOT NULL DEFAULT 'en',
                preferred_currency TEXT NOT NULL DEFAULT 'INR',

                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                exchange TEXT DEFAULT '',
                currency TEXT DEFAULT '',
                last_price REAL,
                price_change REAL,
                change_percent REAL,
                last_updated TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL COLLATE NOCASE,
                interval TEXT NOT NULL DEFAULT '1d',
                recorded_at TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL NOT NULL,
                volume REAL,
                UNIQUE (symbol, interval, recorded_at)
            );

            CREATE INDEX IF NOT EXISTS idx_price_history_symbol_date
                ON price_history(symbol, recorded_at);

            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                horizon_days INTEGER NOT NULL
                    CHECK (horizon_days IN (1, 7, 30)),
                reference_price REAL NOT NULL,
                predicted_price REAL NOT NULL,
                predicted_change REAL NOT NULL,
                predicted_change_percent REAL NOT NULL,
                model_name TEXT NOT NULL,
                evaluation_rmse REAL,
                evaluation_mae REAL,
                risk_category TEXT NOT NULL,
                explanation TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_predictions_user_date
                ON predictions(user_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_predictions_symbol_date
                ON predictions(symbol, created_at);

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                target_price REAL NOT NULL CHECK (target_price > 0),
                condition TEXT NOT NULL
                    CHECK (condition IN ('reaches', 'above', 'below')),
                status TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'triggered', 'cancelled')),
                email_enabled INTEGER NOT NULL DEFAULT 1
                    CHECK (email_enabled IN (0, 1)),
                sms_enabled INTEGER NOT NULL DEFAULT 0
                    CHECK (sms_enabled IN (0, 1)),
                triggered_price REAL,
                triggered_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_status_symbol
                ON alerts(status, symbol);

            CREATE INDEX IF NOT EXISTS idx_alerts_user_status
                ON alerts(user_id, status);

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                alert_id INTEGER,
                notification_type TEXT NOT NULL DEFAULT 'price_alert',
                subject TEXT NOT NULL,
                message TEXT NOT NULL,

                delivery_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (
                        delivery_status IN (
                            'pending', 'sent', 'failed', 'not_configured'
                        )
                    ),

                email_delivery_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (
                        email_delivery_status IN (
                            'pending', 'sent', 'failed', 'not_configured'
                        )
                    ),

                sms_delivery_status TEXT NOT NULL DEFAULT 'not_configured'
                    CHECK (
                        sms_delivery_status IN (
                            'pending', 'sent', 'failed', 'not_configured'
                        )
                    ),

                is_read INTEGER NOT NULL DEFAULT 0
                    CHECK (is_read IN (0, 1)),

                read_at TEXT,
                error_message TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                sent_at TEXT,

                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE,

                FOREIGN KEY (alert_id)
                    REFERENCES alerts(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_notifications_user_date
                ON notifications(user_id, created_at);

            CREATE TABLE IF NOT EXISTS news_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                source TEXT DEFAULT '',
                published_at TEXT DEFAULT '',
                summary TEXT DEFAULT '',
                sentiment TEXT DEFAULT 'neutral'
                    CHECK (sentiment IN ('positive', 'negative', 'neutral')),
                sentiment_score REAL,
                created_at TEXT NOT NULL,
                UNIQUE(symbol, url)
            );

            CREATE INDEX IF NOT EXISTS idx_news_symbol_date
                ON news_articles(symbol, published_at);

            CREATE TABLE IF NOT EXISTS search_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                query TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_search_history_user_date
                ON search_history(user_id, created_at);

            CREATE TABLE IF NOT EXISTS assistant_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS application_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                event_type TEXT NOT NULL,
                details TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_application_events_date
                ON application_events(created_at);

            -- User-specific investment and completed trade records.
            -- A NULL sell_price means the investment is still open.
            CREATE TABLE IF NOT EXISTS investment_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                user_id TEXT NOT NULL,

                symbol TEXT NOT NULL,
                asset_name TEXT NOT NULL,

                quantity REAL NOT NULL
                    CHECK (quantity > 0),

                buy_price REAL NOT NULL
                    CHECK (buy_price > 0),

                sell_price REAL
                    CHECK (sell_price IS NULL OR sell_price > 0),

                buy_date TEXT NOT NULL,

                sell_date TEXT,

                notes TEXT DEFAULT '',

                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,

                FOREIGN KEY (user_id)
                    REFERENCES users(user_id) ON DELETE CASCADE,

                CHECK (
                    sell_price IS NULL
                    OR sell_date IS NOT NULL
                )
            );

            CREATE INDEX IF NOT EXISTS idx_investment_trades_user_date
                ON investment_trades(user_id, buy_date DESC);

            CREATE INDEX IF NOT EXISTS idx_investment_trades_user_symbol
                ON investment_trades(user_id, symbol);

            CREATE INDEX IF NOT EXISTS idx_investment_trades_user_status
                ON investment_trades(user_id, sell_price);

            -- What-If scenario storage is created by the migration below.
            """
        )

        # Safe migrations for databases created by earlier versions.
        _migrate_user_preferences(db)
        _migrate_notification_tables(db)
        _migrate_what_if_scenarios(db)

    logger.info("Market Plus AI database initialized successfully.")


def log_event(event_type, details="", user_id=None):
    """Record a diagnostic event without storing credentials or passwords."""
    safe_type = str(event_type or "application_event")[:100]
    safe_details = str(details or "")[:2000]

    try:
        with get_db() as db:
            db.execute(
                """
                INSERT INTO application_events (
                    user_id, event_type, details, created_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (user_id, safe_type, safe_details, utc_now()),
            )

    except sqlite3.Error:
        logger.exception("Unable to record application event.")


def health_check():
    """Return True when the database can be queried successfully."""
    try:
        with get_db() as db:
            db.execute("SELECT 1").fetchone()

        return True

    except (sqlite3.Error, OSError, TypeError, ValueError):
        logger.exception("Database health check failed.")
        return False
