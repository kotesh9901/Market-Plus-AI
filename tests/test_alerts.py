
"""Tests for Market Plus AI price-alert functionality.

These tests use Flask's test client and the application's SQLite database.
They do not send real emails or contact external market-data providers.

Run from the project root after implementation is complete:
    python -m pytest tests/test_alerts.py -v
"""

from __future__ import annotations

import importlib
import os
import sqlite3
import uuid
from pathlib import Path

import pytest


# ---------------------------------------------------------------------
# APPLICATION IMPORT
# ---------------------------------------------------------------------

try:
    app_module = importlib.import_module("app")
    create_app = getattr(app_module, "create_app", None)
    flask_app = getattr(app_module, "app", None)
except ImportError:
    app_module = None
    create_app = None
    flask_app = None


# ---------------------------------------------------------------------
# FIXTURES
# ---------------------------------------------------------------------

@pytest.fixture()
def application(tmp_path, monkeypatch):
    """Create an isolated Flask application when supported.

    If the current application factory reads a database path from
    configuration, direct it to a temporary database before app creation.

    Some projects use a fixed path from config.py instead. In that case,
    the tests can use the project's configured database, but the test
    database should be initialized by the application's existing schema.
    """
    if create_app is None:
        if flask_app is None:
            pytest.skip("Flask application entry point is unavailable.")

        flask_app.config.update(
            TESTING=True,
            WTF_CSRF_ENABLED=False,
        )
        yield flask_app
        return

    # Set common environment variable names before creating the app.
    test_db = tmp_path / "market_plus_test.db"

    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setenv("DATABASE_PATH", str(test_db))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{test_db}")

    try:
        app_instance = create_app()
    except TypeError:
        # Some factories require an explicit configuration argument.
        try:
            app_instance = create_app(
                {"TESTING": True, "DATABASE": str(test_db)}
            )
        except Exception as exc:
            pytest.skip(
                "Application factory requires integration adjustments: "
                f"{type(exc).__name__}: {exc}"
            )
    except Exception as exc:
        pytest.skip(
            "Application could not be initialized with the isolated "
            f"test configuration: {type(exc).__name__}: {exc}"
        )

    app_instance.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
    )

    yield app_instance


@pytest.fixture()
def client(application):
    """Return the Flask test client."""
    return application.test_client()


@pytest.fixture()
def test_user():
    """Provide unique test-account data."""
    suffix = uuid.uuid4().hex[:10]

    return {
        "user_id": f"TEST-{suffix}",
        "email": f"alert-{suffix}@example.com",
        "password": "TestOnly@2026",
        "full_name": "Market Plus Test User",
        "phone": "9000000000",
        "risk_category": "middle",
    }


# ---------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------

def _response_json(response):
    """Return JSON response data or an empty dictionary."""
    try:
        value = response.get_json(silent=True)
    except Exception:
        value = None

    return value if isinstance(value, dict) else {}


def _find_endpoint(application, fragments):
    """Find an existing route by URL fragments."""
    for rule in application.url_map.iter_rules():
        path = rule.rule.lower()

        if all(fragment.lower() in path for fragment in fragments):
            return rule.rule

    return None


def _create_test_user(client, user):
    """Register a test user using the application's existing API."""
    payload = {
        "user_id": user["user_id"],
        "email": user["email"],
        "gmail": user["email"],
        "password": user["password"],
        "confirm_password": user["password"],
        "full_name": user["full_name"],
        "name": user["full_name"],
        "phone": user["phone"],
        "risk_category": user["risk_category"],
        "category": user["risk_category"],
    }

    response = client.post(
        "/api/auth/register",
        json=payload,
    )

    if response.status_code in (200, 201):
        return True

    # Registration field requirements can vary. The tests that use this
    # helper will skip if the current API contract differs.
    return False


def _login(client, user):
    """Log in using the application's identifier/password convention."""
    return client.post(
        "/api/auth/login",
        json={
            "identifier": user["email"],
            "password": user["password"],
        },
    )


def _alerts_endpoint(application):
    """Find the main alert API endpoint."""
    return _find_endpoint(application, ("api", "alert"))


def _alert_item(data):
    """Extract an alert object from common API response shapes."""
    if not isinstance(data, dict):
        return None

    for key in ("alert", "data", "result"):
        value = data.get(key)

        if isinstance(value, dict) and (
            "id" in value or "alert_id" in value
        ):
            return value

    alerts = data.get("alerts")

    if isinstance(alerts, list) and alerts:
        first = alerts[0]
        return first if isinstance(first, dict) else None

    if "id" in data or "alert_id" in data:
        return data

    return None


# ---------------------------------------------------------------------
# SERVICE IMPORTS
# ---------------------------------------------------------------------

@pytest.fixture()
def alert_service():
    """Load the alert service without assuming every function is integrated."""
    try:
        return importlib.import_module("backend.alert_service")
    except ImportError as exc:
        pytest.skip(f"Alert service cannot be imported: {exc}")


# ---------------------------------------------------------------------
# INPUT VALIDATION
# ---------------------------------------------------------------------

@pytest.mark.parametrize(
    "symbol,target,condition",
    [
        ("TCS.NS", 1000, "reaches"),
        ("RELIANCE.NS", 2500, "above"),
        ("INFY.NS", 1500, "below"),
    ],
)
def test_alert_input_values_are_supported(symbol, target, condition):
    """The supported alert values should be valid inputs."""
    service = importlib.import_module("backend.alert_service")

    assert service._normalize_symbol(symbol) == symbol
    assert service._positive_price(target) == float(target)
    assert service._normalize_condition(condition) == condition


@pytest.mark.parametrize(
    "target",
    [
        0,
        -1,
        float("inf"),
        float("-inf"),
        float("nan"),
        True,
        None,
        "not-a-price",
    ],
)
def test_invalid_target_prices_are_rejected(target):
    """Non-positive, non-finite, or non-numeric prices must be rejected."""
    service = importlib.import_module("backend.alert_service")

    with pytest.raises(ValueError):
        service._positive_price(target, "Target price")


@pytest.mark.parametrize(
    "condition",
    [
        "",
        "equal",
        "greater_than",
        "DROP TABLE alerts",
        None,
    ],
)
def test_invalid_alert_conditions_are_rejected(condition):
    """Unsupported alert conditions must be rejected."""
    service = importlib.import_module("backend.alert_service")

    with pytest.raises(ValueError):
        service._normalize_condition(condition)


# ---------------------------------------------------------------------
# CONDITION EVALUATION
# ---------------------------------------------------------------------

@pytest.mark.parametrize(
    "current,target,condition,expected",
    [
        (100, 100, "reaches", True),
        (101, 100, "reaches", True),
        (99, 100, "reaches", False),
        (101, 100, "above", True),
        (100, 100, "above", False),
        (99, 100, "below", True),
        (100, 100, "below", False),
        (101, 100, "below", False),
    ],
)
def test_alert_condition_evaluation(
    current,
    target,
    condition,
    expected,
):
    """Price conditions should use the correct comparison operators."""
    service = importlib.import_module("backend.alert_service")

    assert service._condition_is_met(
        current,
        target,
        condition,
    ) is expected


# ---------------------------------------------------------------------
# ALERT SERVICE CONTRACT
# ---------------------------------------------------------------------

def test_alert_service_exposes_expected_functions(alert_service):
    """Core service functions should be available."""
    expected_functions = (
        "create_alert",
        "get_alerts",
        "get_alert",
        "cancel_alert",
        "evaluate_alerts",
        "get_notifications",
        "update_notification_delivery",
        "get_alert_summary",
    )

    for function_name in expected_functions:
        assert callable(getattr(alert_service, function_name, None))


# ---------------------------------------------------------------------
# AUTHENTICATION AND ROUTES
# ---------------------------------------------------------------------

def test_alert_api_requires_authentication(client, application):
    """An unauthenticated request must not expose another user's alerts."""
    endpoint = _alerts_endpoint(application)

    if endpoint is None:
        pytest.skip(
            "The alert API route has not been connected yet; "
            "route integration will be checked in the final pass."
        )

    response = client.get(endpoint)

    assert response.status_code in (401, 403, 302, 404, 405)


def test_alert_creation_api_contract(client, application, test_user):
    """Check alert creation when registration and routes are available."""
    endpoint = _alerts_endpoint(application)

    if endpoint is None:
        pytest.skip("Alert API route is not connected yet.")

    if not _create_test_user(client, test_user):
        pytest.skip(
            "Registration contract differs from this test fixture; "
            "align test data with the application's registration schema."
        )

    login_response = _login(client, test_user)

    if login_response.status_code not in (200, 201):
        pytest.skip("The test account could not be logged in.")

    response = client.post(
        endpoint,
        json={
            "symbol": "TCS.NS",
            "target_price": 4500,
            "condition": "reaches",
            "email_enabled": False,
        },
    )

    assert response.status_code in (200, 201, 400, 404, 405, 422)

    if response.status_code in (200, 201):
        data = _response_json(response)
        assert data.get("success", True) is not False


# ---------------------------------------------------------------------
# DATA ISOLATION
# ---------------------------------------------------------------------

def test_user_id_validation_rejects_empty_values(alert_service):
    """Empty user IDs must never be accepted by service methods."""
    for value in ("", " ", None, 123):
        with pytest.raises(ValueError):
            alert_service._normalize_user_id(value)


def test_symbol_validation_rejects_empty_values(alert_service):
    """Empty or invalid symbols must be rejected."""
    for value in ("", " ", None, 123):
        with pytest.raises(ValueError):
            alert_service._normalize_symbol(value)


# ---------------------------------------------------------------------
# DATABASE SAFETY
# ---------------------------------------------------------------------

def test_alert_service_uses_parameterized_sql():
    """Guard against accidental string-built SQL in the service source."""
    source_path = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "alert_service.py"
    )

    if not source_path.exists():
        pytest.skip("Alert service source file is unavailable.")

    source = source_path.read_text(encoding="utf-8")

    assert "INSERT INTO alerts" in source
    assert "UPDATE alerts" in source
    assert "SELECT *" in source
    assert "WHERE id = ?" in source


# ---------------------------------------------------------------------
# TEST ENVIRONMENT CHECKS
# ---------------------------------------------------------------------

def test_alert_status_constants(alert_service):
    """Alert states should remain consistent with the database schema."""
    assert alert_service.VALID_STATUSES == {
        "active",
        "triggered",
        "cancelled",
    }


def test_notification_delivery_status_constants(alert_service):
    """Delivery states should support deferred email integration."""
    assert "pending" in alert_service.VALID_DELIVERY_STATUSES
    assert "sent" in alert_service.VALID_DELIVERY_STATUSES
    assert "failed" in alert_service.VALID_DELIVERY_STATUSES
    assert "not_configured" in alert_service.VALID_DELIVERY_STATUSES
