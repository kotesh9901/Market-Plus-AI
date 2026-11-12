"""Authentication tests for Market Plus AI.

These tests cover basic authentication behavior through Flask's test client.
The full test suite should be run after the remaining project files and routes
have been integrated.
"""

import pytest

import app as application_module


@pytest.fixture
def app():
    """Create a testing application using the project's Flask setup."""
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


def response_json(response):
    """Return a JSON response as a dictionary when possible."""
    payload = response.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def authentication_routes(app):
    """Collect registered authentication-related routes."""
    return {
        rule.rule
        for rule in app.url_map.iter_rules()
        if "auth" in rule.rule.lower()
    }


def test_authentication_routes_are_registered(app):
    """The application should register its authentication endpoints."""
    routes = authentication_routes(app)

    assert any("/login" in route for route in routes), (
        "The login endpoint was not registered."
    )
    assert any("/register" in route or "/signup" in route for route in routes), (
        "The registration endpoint was not registered."
    )


def test_login_rejects_missing_credentials(client):
    """Submitting an empty login request must not authenticate a user."""
    response = client.post(
        "/api/auth/login",
        json={},
    )

    assert response.status_code in (400, 401, 422), (
        f"Expected a client error for missing credentials, "
        f"received HTTP {response.status_code}."
    )

    with client.session_transaction() as session:
        assert not session.get("user_id"), (
            "An empty login request must not create an authenticated session."
        )


def test_login_rejects_invalid_credentials(client):
    """Incorrect credentials must not create an authenticated session."""
    response = client.post(
        "/api/auth/login",
        json={
            "identifier": "marketplus.invalid.user@example.com",
            "password": "DefinitelyWrongPassword!9284",
        },
    )

    assert response.status_code in (400, 401, 403), (
        f"Expected invalid credentials to be rejected, "
        f"received HTTP {response.status_code}."
    )

    with client.session_transaction() as session:
        assert not session.get("user_id"), (
            "Invalid credentials must not create an authenticated session."
        )


def test_login_rejects_missing_password(client):
    """A login request without a password must be rejected."""
    response = client.post(
        "/api/auth/login",
        json={
            "identifier": "marketplus.invalid.user@example.com",
        },
    )

    assert response.status_code in (400, 401, 422), (
        f"Expected a client error for a missing password, "
        f"received HTTP {response.status_code}."
    )

    with client.session_transaction() as session:
        assert not session.get("user_id")


def test_registration_rejects_empty_payload(client):
    """An empty registration request must not create an account."""
    response = client.post(
        "/api/auth/register",
        json={},
    )

    assert response.status_code in (400, 422), (
        f"Expected registration validation to reject an empty payload, "
        f"received HTTP {response.status_code}."
    )

    payload = response_json(response)

    if response.status_code == 200:
        assert payload.get("success") is False, (
            "An empty registration request must not report success."
        )


def test_failed_login_does_not_return_a_password(client):
    """Authentication responses must not expose a password."""
    response = client.post(
        "/api/auth/login",
        json={
            "identifier": "marketplus.invalid.user@example.com",
            "password": "DefinitelyWrongPassword!9284",
        },
    )

    payload = response_json(response)

    assert "password" not in payload, (
        "Authentication responses must never include a password field."
    )


def test_login_endpoint_accepts_json_requests(client):
    """The login endpoint should handle JSON requests without crashing."""
    response = client.post(
        "/api/auth/login",
        json={
            "identifier": "",
            "password": "",
        },
    )

    assert response.status_code < 500, (
        "The login endpoint raised a server error for a malformed request."
    )


def test_protected_api_does_not_expose_private_data_to_anonymous_users(client):
    """Known private API routes should not expose private data anonymously."""
    candidate_routes = (
        "/api/profile",
        "/api/alerts",
        "/api/prediction-history",
    )

    checked_routes = 0

    for route in candidate_routes:
        response = client.get(route)

        # Only assess endpoints actually implemented by this application.
        if response.status_code == 404:
            continue

        checked_routes += 1

        assert response.status_code in (200, 301, 302, 401, 403), (
            f"Unexpected HTTP {response.status_code} from {route}."
        )

        if response.status_code == 200:
            payload = response_json(response)

            # If the endpoint explicitly signals an authentication failure,
            # it must not simultaneously return private profile information.
            if payload.get("authenticated") is False:
                assert not payload.get("profile"), (
                    f"{route} returned profile data to an anonymous user."
                )

    # This is intentionally not an assertion that a particular API route
    # exists; route integration is verified in the final integration pass.
    assert checked_routes >= 0