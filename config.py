import os
from pathlib import Path
from dotenv import load_dotenv

# Project root directory
BASE_DIR = Path(__file__).resolve().parent

# Load local environment variables
load_dotenv(BASE_DIR / ".env")


class Config:
    # Application
    APP_NAME = "Market Plus AI"
    APP_VERSION = "1.0.0"
    SECRET_KEY = os.getenv(
        "SECRET_KEY",
        "development-only-change-this-before-deployment"
    )

    # Flask
    DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    # Database
    DATA_DIR = BASE_DIR / "data"
    DATABASE_PATH = DATA_DIR / "market_plus.db"

    # Logs
    LOG_DIR = BASE_DIR / "logs"
    LOG_FILE = LOG_DIR / "market_plus.log"

    # Timezone
    TIMEZONE = "Asia/Kolkata"

    # Stock data
    STOCK_PROVIDER = os.getenv("STOCK_PROVIDER", "yfinance")
    STOCK_CACHE_SECONDS = int(
        os.getenv("STOCK_CACHE_SECONDS", "60")
    )
    HISTORY_CACHE_SECONDS = int(
        os.getenv("HISTORY_CACHE_SECONDS", "86400")
    )

    # Prediction
    MINIMUM_HISTORY_ROWS = int(
        os.getenv("MINIMUM_HISTORY_ROWS", "120")
    )
    DEFAULT_PREDICTION_HORIZONS = (1, 7, 30)
    RANDOM_STATE = 42

    # News provider configuration
    NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
    NEWS_PROVIDER = os.getenv("NEWS_PROVIDER", "none")

    # Email configuration
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
    MAIL_USE_TLS = os.getenv("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "")
    MAIL_APP_PASSWORD = os.getenv("MAIL_APP_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.getenv(
        "MAIL_DEFAULT_SENDER",
        os.getenv("MAIL_USERNAME", "")
    )

    # Alert processing
    ALERT_CHECK_INTERVAL_SECONDS = max(
        30,
        int(os.getenv("ALERT_CHECK_INTERVAL_SECONDS", "60"))
    )

    # Security
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = (
        os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    )

    # Local development defaults
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("PORT", "5000"))

    @classmethod
    def ensure_directories(cls):
        """Create required local application directories."""
        cls.DATA_DIR.mkdir(parents=True, exist_ok=True)
        cls.LOG_DIR.mkdir(parents=True, exist_ok=True)


Config.ensure_directories()
