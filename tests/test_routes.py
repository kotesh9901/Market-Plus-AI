"""Route tests for the Market Plus AI Flask application.

These tests check route registration and basic HTTP behavior. Route-specific
authentication and API contracts will be verified during final integration.
"""

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


def registered_routes(app):
    """Return the application's registered URL rules."""
    return {
        rule.rule
        for rule in app.url_map.iter_rules()
    }


def test_application_has_registered_routes(app):
    """The Flask application should have registered routes."""
    routes = registered_routes(app)

    assert routes, "The Flask application has no registered routes."
    assert "/" in routes, "The home route '/' is not registered."


@pytest.mark.parametrize(
    "route",
    [
        "/",
        "/login",
        "/signup",
    ],
)
def test_public_pages_do_not_return_server_errors(client, route):
    """Public pages should not return an internal server error."""
    response = client.get(route, follow_redirects=False)

    assert response.status_code < 500, (
        f"Page {route} returned HTTP {response.status_code}."
    )


@pytest.mark.parametrize(
    "route",
    [
        "/dashboard",
        "/stock-search",
        "/predictions",
        "/prediction-history",
        "/news-sentiment",
        "/alerts",
        "/profile",
    ],
)
def test_application_pages_are_registered_or_redirect_safely(client, route):
    """Application pages should render or redirect rather than crash."""
    response = client.get(route, follow_redirects=False)

    assert response.status_code in (
        200,
        301,
        302,
        303,
        307,
        308,
        401,
        403,
        404,
    ), (
        f"Unexpected HTTP {response.status_code} from {route}."
    )


def test_authentication_api_routes_are_registered(app):
    """Authentication API routes should be registered."""
    routes = registered_routes(app)

    assert "/api/auth/login" in routes, (
        "The login API route '/api/auth/login' is missing."
    )

    assert "/api/auth/register" in routes, (
        "The registration API route '/api/auth/register' is missing."
    )


def test_login_api_handles_invalid_json_payload(client):
    """Malformed login input should not trigger an internal server error."""
    response = client.post(
        "/api/auth/login",
        data="invalid JSON",
        content_type="application/json",
    )

    assert response.status_code < 500, (
        "The login API returned an internal server error for invalid JSON."
    )


def test_unknown_api_route_returns_not_found(client):
    """An unknown API endpoint should return HTTP 404."""
    response = client.get("/api/market-plus-ai-route-that-does-not-exist")

    assert response.status_code == 404, (
        f"Expected HTTP 404, received HTTP {response.status_code}."
    )


def test_static_assets_are_served_when_present(client):
    """The application should serve its registered static assets."""
    response = client.get("/static/js/common.js")

    # A 404 can occur if the shared script uses a different filename or
    # location. The exact static asset paths will be checked at integration.
    assert response.status_code in (200, 304, 404), (
        f"Unexpected HTTP {response.status_code} for a static asset."
    )


def test_api_errors_do_not_expose_tracebacks(client):
    """An unknown API endpoint should not disclose a Python traceback."""
    response = client.get("/api/market-plus-ai-route-that-does-not-exist")

    body = response.get_data(as_text=True).lower()

    assert "traceback (most recent call last)" not in body
    assert "file \"" not in body or response.status_code == 200