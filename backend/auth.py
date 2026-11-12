
import re
import secrets
import sqlite3
import string
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import get_db, log_event, utc_now


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

ALLOWED_RISK_CATEGORIES = {"low", "middle", "high"}

# Country-to-default-currency mapping.
COUNTRY_CURRENCIES = {
    "India": "INR",
    "United States": "USD",
    "United Kingdom": "GBP",
    "Canada": "CAD",
    "Australia": "AUD",
    "Germany": "EUR",
    "France": "EUR",
    "Italy": "EUR",
    "Spain": "EUR",
    "Netherlands": "EUR",
    "Belgium": "EUR",
    "Ireland": "EUR",
    "Portugal": "EUR",
    "Finland": "EUR",
    "Switzerland": "CHF",
    "Sweden": "SEK",
    "Norway": "NOK",
    "Denmark": "DKK",
    "Poland": "PLN",
    "Japan": "JPY",
    "China": "CNY",
    "South Korea": "KRW",
    "Singapore": "SGD",
    "Malaysia": "MYR",
    "Indonesia": "IDR",
    "Thailand": "THB",
    "Philippines": "PHP",
    "Vietnam": "VND",
    "United Arab Emirates": "AED",
    "Saudi Arabia": "SAR",
    "Qatar": "QAR",
    "Kuwait": "KWD",
    "Oman": "OMR",
    "Bahrain": "BHD",
    "South Africa": "ZAR",
    "Nigeria": "NGN",
    "Kenya": "KES",
    "Egypt": "EGP",
    "Brazil": "BRL",
    "Mexico": "MXN",
    "Argentina": "ARS",
    "New Zealand": "NZD",
    "Turkey": "TRY",
    "Bangladesh": "BDT",
    "Pakistan": "PKR",
    "Nepal": "NPR",
    "Sri Lanka": "LKR",
}

# Supported currencies for user preferences.
ALLOWED_CURRENCIES = {
    "INR", "USD", "GBP", "EUR", "JPY", "AED",
    "CAD", "AUD", "CHF", "CNY", "SGD", "SAR",
    "KRW", "BRL", "ZAR", "NZD", "MYR", "IDR",
    "THB", "MXN", "BDT", "PKR", "NPR", "LKR",
    "NGN", "KES", "EGP", "TRY", "SEK", "NOK",
    "DKK", "PLN", "QAR", "KWD", "BHD", "OMR",
    "PHP", "VND", "ARS",
}

# Indian and international language codes used by signup.html.
ALLOWED_LANGUAGES = {
    "en", "as", "bn", "brx", "doi", "gu", "hi",
    "kn", "ks", "kok", "mai", "ml", "mni", "mr",
    "ne", "or", "pa", "sa", "sat", "sd", "ta",
    "te", "ur", "tcy", "bho", "raj", "hne",
    "bgc", "kha", "lus", "grt", "es", "fr",
    "de", "ja", "ar", "zh", "ko", "pt", "ru",
    "it", "nl", "tr", "id", "ms", "th", "vi",
}


# --------------------------------------------------
# RESPONSE HELPERS
# --------------------------------------------------

def success_response(message, data=None, status=200):
    response = {
        "success": True,
        "message": message,
    }

    if data is not None:
        response["data"] = data

    return jsonify(response), status


def error_response(message, status=400):
    return jsonify({
        "success": False,
        "message": message,
    }), status


def get_request_data():
    """Accept JSON requests and form submissions."""

    if request.is_json:
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}

    return request.form.to_dict()


def public_user(user):
    """Return safe user information without the password hash."""

    return {
        "user_id": user["user_id"],
        "name": user["name"],
        "email": user["email"],
        "phone": user["phone"] or "",
        "risk_category": user["risk_category"],
        "country": user["country"] or "India",
        "language": user["language"] or "en",
        "preferred_currency": (
            user["preferred_currency"] or "INR"
        ),
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
    }


def get_current_user():
    """Get the currently authenticated user."""

    user_id = session.get("user_id")

    if not user_id:
        return None

    with get_db() as db:
        return db.execute(
            """
            SELECT
                user_id,
                name,
                email,
                phone,
                risk_category,
                country,
                language,
                preferred_currency,
                password_hash,
                created_at,
                updated_at
            FROM users
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()


# --------------------------------------------------
# AUTHENTICATION DECORATOR
# --------------------------------------------------

def login_required(view_function):
    """Protect routes that require a logged-in user."""

    @wraps(view_function)
    def decorated_function(*args, **kwargs):

        if not session.get("user_id"):
            return error_response(
                "Please log in to continue.",
                401,
            )

        user = get_current_user()

        if user is None:
            session.clear()

            return error_response(
                "Your session is no longer valid. Please log in again.",
                401,
            )

        return view_function(*args, **kwargs)

    return decorated_function


# --------------------------------------------------
# USER ID GENERATION
# --------------------------------------------------

def generate_user_id():
    """Generate a unique ID such as MPA-A1B2C3D4."""

    alphabet = string.ascii_uppercase + string.digits

    for _ in range(10):

        generated_id = "MPA-" + "".join(
            secrets.choice(alphabet)
            for _ in range(8)
        )

        with get_db() as db:
            existing_user = db.execute(
                """
                SELECT 1
                FROM users
                WHERE user_id = ?
                """,
                (generated_id,),
            ).fetchone()

        if existing_user is None:
            return generated_id

    raise RuntimeError("Unable to generate a unique user ID.")


# --------------------------------------------------
# USER PREFERENCE VALIDATION
# --------------------------------------------------

def validate_preferences(data, existing=None):
    """Validate country, language and preferred currency."""

    existing = existing or {}

    country = str(
        data.get(
            "country",
            existing.get("country", "India"),
        ) or "India"
    ).strip()

    language = str(
        data.get(
            "language",
            existing.get("language", "en"),
        ) or "en"
    ).strip().lower()

    currency = str(
        data.get(
            "preferred_currency",
            data.get(
                "currency",
                existing.get("preferred_currency", ""),
            ),
        ) or ""
    ).strip().upper()

    if country not in COUNTRY_CURRENCIES:
        return None, "Please select a supported country."

    if language not in ALLOWED_LANGUAGES:
        return None, "Please select a supported language."

    # If the client does not provide a currency,
    # derive it from the selected country.
    if not currency:
        currency = COUNTRY_CURRENCIES[country]

    if currency not in ALLOWED_CURRENCIES:
        return None, "Please select a supported currency."

    return {
        "country": country,
        "language": language,
        "preferred_currency": currency,
    }, None


# --------------------------------------------------
# INPUT VALIDATION
# --------------------------------------------------

def validate_registration(data):

    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    phone = str(data.get("phone", "")).strip()
    password = str(data.get("password", ""))

    risk_category = str(
        data.get("risk_category", "middle")
    ).strip().lower()

    if len(name) < 2 or len(name) > 80:
        return None, "Name must contain between 2 and 80 characters."

    if any(ord(character) < 32 for character in name):
        return None, "Name contains invalid characters."

    email_pattern = (
        r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"
    )

    if not re.fullmatch(email_pattern, email):
        return None, "Please enter a valid email address."

    if len(email) > 254:
        return None, "Email address is too long."

    # Phone is optional.
    if phone:
        digits = re.sub(r"\D", "", phone)

        if not 7 <= len(digits) <= 15:
            return None, "Please enter a valid phone number."

        if not re.fullmatch(r"[0-9+\-()\s]{7,20}", phone):
            return None, "Phone number contains invalid characters."

    if len(password) < 8:
        return None, "Password must contain at least 8 characters."

    if len(password) > 128:
        return None, "Password must not exceed 128 characters."

    if risk_category not in ALLOWED_RISK_CATEGORIES:
        return None, "Risk category must be low, middle, or high."

    preferences, preference_error = validate_preferences(data)

    if preference_error:
        return None, preference_error

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "password": password,
        "risk_category": risk_category,
        **preferences,
    }, None


# --------------------------------------------------
# REGISTER
# POST /api/auth/register
# --------------------------------------------------

@auth_bp.route("/register", methods=["POST"])
def register():

    data = get_request_data()

    validated, validation_error = validate_registration(data)

    if validation_error:
        return error_response(validation_error, 400)

    user_id = generate_user_id()
    timestamp = utc_now()

    password_hash = generate_password_hash(
        validated["password"],
        method="scrypt",
    )

    try:
        with get_db() as db:

            db.execute(
                """
                INSERT INTO users (
                    user_id,
                    name,
                    email,
                    phone,
                    password_hash,
                    risk_category,
                    country,
                    language,
                    preferred_currency,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    validated["name"],
                    validated["email"],
                    validated["phone"],
                    password_hash,
                    validated["risk_category"],
                    validated["country"],
                    validated["language"],
                    validated["preferred_currency"],
                    timestamp,
                    timestamp,
                ),
            )

        log_event(
            "user_registered",
            "New account registered",
            user_id,
        )

        return success_response(
            "Registration successful. Your user ID is ready.",
            {
                "user": {
                    "user_id": user_id,
                    "name": validated["name"],
                    "email": validated["email"],
                    "phone": validated["phone"],
                    "risk_category": validated["risk_category"],
                    "country": validated["country"],
                    "language": validated["language"],
                    "preferred_currency": validated["preferred_currency"],
                },
                "login_hint": (
                    "Use your generated user ID or email address to log in."
                ),
            },
            201,
        )

    except sqlite3.IntegrityError:
        return error_response(
            "An account with this email already exists.",
            409,
        )

    except Exception:
        import logging
        logging.exception("Registration failed.")

        return error_response(
            "Registration could not be completed. Please try again.",
            500,
        )


# --------------------------------------------------
# LOGIN
# POST /api/auth/login
# --------------------------------------------------

@auth_bp.route("/login", methods=["POST"])
def login():

    data = get_request_data()

    identifier = str(
        data.get("identifier", data.get("email", ""))
    ).strip()

    password = str(data.get("password", ""))

    if not identifier or not password:
        return error_response(
            "Enter your user ID or email and password.",
            400,
        )

    with get_db() as db:

        user = db.execute(
            """
            SELECT
                user_id,
                name,
                email,
                phone,
                risk_category,
                country,
                language,
                preferred_currency,
                password_hash,
                created_at,
                updated_at
            FROM users
            WHERE user_id = ? OR email = ? COLLATE NOCASE
            """,
            (identifier, identifier),
        ).fetchone()

    if user is None or not check_password_hash(
        user["password_hash"],
        password,
    ):
        return error_response(
            "Invalid user ID/email or password.",
            401,
        )

    session.clear()
    session["user_id"] = user["user_id"]

    log_event(
        "user_login",
        "User logged in",
        user["user_id"],
    )

    return success_response(
        "Login successful.",
        {"user": public_user(user)},
    )


# --------------------------------------------------
# CURRENT USER
# GET /api/auth/me
# --------------------------------------------------

@auth_bp.route("/me", methods=["GET"])
@login_required
def current_user():

    user = get_current_user()

    if user is None:
        session.clear()
        return error_response("User account not found.", 401)

    return success_response(
        "Current user loaded.",
        {"user": public_user(user)},
    )


# --------------------------------------------------
# UPDATE PROFILE
# PATCH /api/auth/profile
# --------------------------------------------------

@auth_bp.route("/profile", methods=["PATCH"])
@login_required
def update_profile():

    data = get_request_data()
    user_id = session["user_id"]

    allowed_fields = {
        "name",
        "email",
        "phone",
        "risk_category",
        "country",
        "language",
        "preferred_currency",
    }

    if not any(field in data for field in allowed_fields):
        return error_response(
            "Provide at least one profile field to update."
        )

    with get_db() as db:

        user = db.execute(
            """
            SELECT
                user_id,
                name,
                email,
                phone,
                risk_category,
                country,
                language,
                preferred_currency
            FROM users
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()

    if user is None:
        session.clear()
        return error_response("User account not found.", 401)

    name = str(data.get("name", user["name"])).strip()
    email = str(data.get("email", user["email"])).strip().lower()
    phone = str(data.get("phone", user["phone"] or "")).strip()

    risk_category = str(
        data.get("risk_category", user["risk_category"])
    ).strip().lower()

    if len(name) < 2 or len(name) > 80:
        return error_response(
            "Name must contain between 2 and 80 characters."
        )

    if any(ord(character) < 32 for character in name):
        return error_response("Name contains invalid characters.")

    email_pattern = (
        r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
        r"@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"
    )

    if not re.fullmatch(email_pattern, email):
        return error_response("Please enter a valid email address.")

    if len(email) > 254:
        return error_response("Email address is too long.")

    if phone:
        digits = re.sub(r"\D", "", phone)

        if (
            not 7 <= len(digits) <= 15
            or not re.fullmatch(r"[0-9+\-()\s]{7,20}", phone)
        ):
            return error_response("Please enter a valid phone number.")

    if risk_category not in ALLOWED_RISK_CATEGORIES:
        return error_response(
            "Risk category must be low, middle or high."
        )

    preferences, preference_error = validate_preferences(
        data,
        existing=dict(user),
    )

    if preference_error:
        return error_response(preference_error)

    try:

        with get_db() as db:

            existing_email = db.execute(
                """
                SELECT user_id
                FROM users
                WHERE email = ? COLLATE NOCASE
                AND user_id != ?
                LIMIT 1
                """,
                (email, user_id),
            ).fetchone()

            if existing_email:
                return error_response(
                    "That email address is already registered to another account.",
                    409,
                )

            db.execute(
                """
                UPDATE users
                SET
                    name = ?,
                    email = ?,
                    phone = ?,
                    risk_category = ?,
                    country = ?,
                    language = ?,
                    preferred_currency = ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (
                    name,
                    email,
                    phone,
                    risk_category,
                    preferences["country"],
                    preferences["language"],
                    preferences["preferred_currency"],
                    utc_now(),
                    user_id,
                ),
            )

            updated_user = db.execute(
                """
                SELECT
                    user_id,
                    name,
                    email,
                    phone,
                    risk_category,
                    country,
                    language,
                    preferred_currency,
                    created_at,
                    updated_at
                FROM users
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()

        log_event(
            "profile_updated",
            "User profile updated",
            user_id,
        )

        return success_response(
            "Profile updated successfully.",
            {"user": public_user(updated_user)},
        )

    except sqlite3.IntegrityError:
        return error_response(
            "That email address is already registered to another account.",
            409,
        )

    except Exception:
        import logging
        logging.exception("Profile update failed.")

        return error_response(
            "Profile update failed. Please try again.",
            500,
        )


# --------------------------------------------------
# LOGOUT
# POST /api/auth/logout
# --------------------------------------------------

@auth_bp.route("/logout", methods=["POST"])
def logout():

    user_id = session.get("user_id")

    session.clear()

    if user_id:
        try:
            log_event(
                "user_logout",
                "User logged out",
                user_id,
            )
        except Exception:
            pass

    return success_response("Logged out successfully.")
