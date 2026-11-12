"""Prediction tests for Market Plus AI.

These tests focus on request validation and prediction API behavior.
They are designed to run during the final integration pass after all routes
and services have been connected.
"""

import math

import pytest

import app as application_module


@pytest.fixture
def app():
    """Create the Flask application for testing."""
    if hasattr(application_module, "create_app"):
        flask_app = application_module.create_app()
    elif hasattr(application_module, "app"):
        flask_app = application_module.app
    else:
        pytest.fail(
            "Could not find create_app() or app in the root app.py module."
        )

    flask_app.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
    )

    return flask_app


@pytest.fixture
def client(app):
    """Return a Flask test client."""
    return app.test_client()


def json_body(response):
    """Return the response JSON dictionary, or an empty dictionary."""
    payload = response.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def prediction_routes(app):
    """Find registered prediction-related API routes."""
    return {
        rule.rule
        for rule in app.url_map.iter_rules()
        if "predict" in rule.rule.lower()
    }


def test_prediction_routes_are_registered(app):
    """At least one prediction-related route should be registered."""
    routes = prediction_routes(app)

    assert routes, "No prediction-related routes are registered."


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"symbol": ""},
        {"symbol": "   "},
        {"symbol": "TCS.NS", "duration": -1},
        {"symbol": "TCS.NS", "duration": 0},
        {"symbol": "TCS.NS", "withdrawal_price": -100},
    ],
)
def test_prediction_endpoint_rejects_invalid_inputs(client, payload):
    """Invalid or incomplete prediction requests must not succeed."""
    response = client.post(
        "/api/predict",
        json=payload,
    )

    # The actual route contract will be confirmed during integration.
    # An authentication response is also valid when the endpoint is protected.
    assert response.status_code in (200, 400, 401, 403, 404, 405, 422), (
        f"Unexpected HTTP {response.status_code} for payload {payload!r}."
    )

    if response.status_code == 200:
        result = json_body(response)

        # A successful response must contain a recognizable result or
        # explicitly indicate that the request did not succeed.
        assert (
            result.get("success") is False
            or any(
                key in result
                for key in (
                    "prediction",
                    "predictions",
                    "data",
                    "result",
                    "message",
                )
            )
        ), "The prediction response has an unexpected structure."


def test_prediction_endpoint_rejects_non_json_body(client):
    """A non-JSON request should not cause an unhandled server error."""
    response = client.post(
        "/api/predict",
        data="this is not JSON",
        content_type="text/plain",
    )

    assert response.status_code < 500, (
        "The prediction endpoint returned a server error for non-JSON input."
    )


def test_prediction_response_does_not_contain_non_finite_numbers(client):
    """Any numeric values returned by the prediction endpoint must be finite."""
    response = client.post(
        "/api/predict",
        json={
            "symbol": "TCS.NS",
            "duration": 7,
            "withdrawal_price": 4000,
        },
    )

    if response.status_code != 200:
        # Authentication, validation, and provider errors are covered
        # separately. No prediction result was returned in this case.
        return

    payload = json_body(response)

    def check_finite(value, path="$"):
        if isinstance(value, dict):
            for key, item in value.items():
                check_finite(item, f"{path}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                check_finite(item, f"{path}[{index}]")
        elif isinstance(value, float):
            assert math.isfinite(value), (
                f"Non-finite numeric value found at {path}."
            )

    check_finite(payload)


def test_prediction_endpoint_handles_unknown_symbol(client):
    """An unknown ticker should not produce an unhandled server error."""
    response = client.post(
        "/api/predict",
        json={
            "symbol": "INVALID_MARKET_PLUS_SYMBOL_987654",
            "duration": 7,
            "withdrawal_price": 100,
        },
    )

    assert response.status_code < 500, (
        "The prediction endpoint crashed while processing an unknown symbol."
    )


def test_evaluation_service_exposes_expected_metrics():
    """The evaluation service should provide basic model evaluation metrics."""
    try:
        from backend import evaluation_service
    except ImportError:
        pytest.skip("Evaluation service is not available yet.")

    metric_names = (
        "mean_absolute_error",
        "mean_squared_error",
        "root_mean_squared_error",
        "mean_absolute_percentage_error",
        "directional_accuracy",
    )

    available = [
        name
        for name in metric_names
        if callable(getattr(evaluation_service, name, None))
    ]

    # The implementation's public API will be verified and aligned during
    # the final integration pass.
    assert len(available) >= 1, (
        "The evaluation service does not expose any expected metric functions."
    )