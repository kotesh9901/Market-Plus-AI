# Market Plus AI
### AI-Based Intelligent Stock and Asset Prediction System

**Version:** 1.0.0  
**Application Type:** AI-powered financial prediction and analysis web application  
**Architecture:** Flask backend with HTML, CSS, and JavaScript frontend  
**Database:** Local SQLite  
**Default Market Data Provider:** Yahoo Finance through `yfinance`

---

## 1. Project Overview

Market Plus AI is an intelligent stock and asset prediction system designed to help users explore financial assets, analyze historical price movements, examine market trends, and evaluate potential future price scenarios.

The application combines historical market data, technical indicators, prediction models, risk analysis, and market-related information to provide users with an informative analysis experience.

Predictions and risk assessments are estimates based on available data and model assumptions. They are not guarantees of future market performance or investment returns.

## 2. Project Objectives

- Provide an accessible interface for financial data analysis.
- Retrieve market data from a supported data provider.
- Analyze historical price and volume information.
- Generate model-based price predictions.
- Help users understand potential risks and price scenarios.
- Present market-related news and sentiment when supported by configured providers.
- Allow users to manage their accounts and access relevant application features.
- Support price alerts and notifications when the required services are configured.
- Run locally without requiring paid cloud hosting or cloud storage.

## 3. Main Technologies

| Component | Technology |
|---|---|
| Backend | Python and Flask |
| Frontend | HTML5, CSS3, JavaScript |
| Database | SQLite |
| Market data | `yfinance` |
| Data processing | Pandas and NumPy |
| Machine learning | Scikit-learn |
| HTTP requests | Requests |
| Model persistence utilities | Joblib |
| Configuration | Python Dotenv |
| Development environment | Python virtual environment |

The project does not require Node.js for its current Python-based application setup.

## 4. Application Features

The intended application workflow includes the following areas. The availability of individual features depends on their implementation, route integration, and provider configuration.

### 4.1 User Authentication
- User registration and login.
- Session-based authentication.
- Access to user-specific application pages.
- Password handling through the authentication implementation.

### 4.2 Dashboard
- Central navigation to the application's main sections.
- A starting point for accessing predictions, asset information, alerts, and account details.

### 4.3 Stock and Asset Search
- Search for supported listed assets.
- Retrieve available market information.
- Access asset details and historical price information.

Market-data availability depends on the selected provider, symbol format, network connectivity, and provider limitations.

### 4.4 Price Prediction
- Analyze available historical market data.
- Generate predictions using the implemented prediction service.
- Examine different prediction horizons where supported.
- Compare estimated prices with historical information.

Predictions are model outputs, not guaranteed future prices.

### 4.5 Prediction History
- Access saved prediction records where persistence is implemented.
- Review available prediction results and evaluation information.

### 4.6 Risk and Scenario Analysis
- Examine historical volatility and drawdowns where supported.
- Estimate potential profit or loss for hypothetical price scenarios.
- Compare alternative price assumptions.

These calculations are estimates and should not be interpreted as personalized financial advice.

### 4.7 News and Sentiment
- Display market-related news when a compatible provider is available.
- Present sentiment analysis when supported by the configured implementation.
- Use relevant information to help users investigate possible market influences.

News availability depends on the configured provider and its access requirements.

### 4.8 Price Alerts
- Configure supported price conditions.
- Evaluate alert conditions against available market prices.
- Display alert statuses and notifications where the relevant services are connected.

Automatic email delivery requires valid email configuration and a functioning delivery service.

### 4.9 User Profile
- Display account information.
- Present supported personal prediction or profit-and-loss information where available.

---

## 5. Project Structure

The principal application files are organized as follows:

```text
Market_Plus_AI/
│
├── app.py
├── config.py
├── requirements.txt
├── .env
├── .env.example
├── .gitignore
├── README.md
│
├── backend/
│   ├── __init__.py
│   ├── app-related services
│   ├── auth.py
│   ├── database.py
│   ├── data_fetcher.py
│   ├── data_quality_service.py
│   ├── stock_service.py
│   ├── predictor.py
│   ├── evaluation_service.py
│   ├── prediction_history_service.py
│   ├── confidence_service.py
│   ├── risk_service.py
│   ├── scenario_service.py
│   ├── model_registry_service.py
│   ├── market_calendar_service.py
│   ├── prediction_validation_service.py
│   ├── news_service.py
│   ├── sentiment_service.py
│   ├── alert_service.py
│   ├── email_service.py
│   ├── assistant_service.py
│   └── validation.py
│
├── templates/
│   ├── landing.html
│   ├── login.html
│   ├── signup.html
│   ├── dashboard.html
│   ├── stock_search.html
│   ├── stock_details.html
│   ├── predictions.html
│   ├── prediction_history.html
│   ├── news_sentiment.html
│   ├── alerts.html
│   └── profile.html
│
├── static/
│   ├── css/
│   │   ├── common.css
│   │   ├── landing.css
│   │   ├── auth.css
│   │   ├── dashboard.css
│   │   ├── stocks.css
│   │   ├── predictions.css
│   │   ├── news_sentiment.css
│   │   ├── alerts.css
│   │   └── profile.css
│   │
│   └── js/
│       ├── common.js
│       ├── landing.js
│       ├── login.js
│       ├── signup.js
│       ├── dashboard.js
│       ├── stock_search.js
│       ├── stock_details.js
│       ├── predictions.js
│       ├── prediction_history.js
│       ├── news_sentiment.js
│       ├── alerts.js
│       └── profile.js
│
├── tests/
│   ├── test_auth.py
│   ├── test_alerts.py
│   ├── test_predictions.py
│   └── test_routes.py
│
├── data/
│   └── market_plus.db
│
└── logs/
    └── market_plus.log
```

Some directories and runtime files are created automatically. The actual database and log files may not exist until the application initializes them.

---

## 6. System Requirements

Recommended development environment:

- Windows 10 or Windows 11.
- Python compatible with the installed dependencies.
- Internet connection for retrieving online market data.
- A code editor such as Visual Studio Code.
- PowerShell or another terminal.

The project has been developed in a Python virtual environment. Python 3.14 compatibility should be verified against the installed dependency versions and the complete application.

## 7. Installation

### Step 1: Open the project directory

Open PowerShell and run:

```powershell
cd "$HOME\Desktop\Market_Plus_AI"
```

If your project is stored elsewhere, replace the path with its actual location.

### Step 2: Activate the virtual environment

If `.venv` already exists:

```powershell
.\.venv\Scripts\Activate.ps1
```

If you have not created the virtual environment yet:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### Step 3: Install the dependencies

Upgrade pip if needed:

```powershell
python -m pip install --upgrade pip
```

Install the packages listed in `requirements.txt`:

```powershell
python -m pip install -r requirements.txt
```

### Step 4: Configure environment variables

Create a local `.env` file in the project root.

Use `.env.example` as a template if it contains the appropriate settings. Keep secret values private and do not commit your actual `.env` file to a public repository.

At a minimum, configure a strong secret key before using the application outside local development.

### Step 5: Initialize local directories

The current configuration creates the configured data and log directories when `config.py` is imported.

The database initialization and table creation behavior depends on the application's database initialization code.

### Step 6: Start the application

From the project root, with the virtual environment activated, run:

```powershell
python app.py
```

The default configuration uses:

```text
Host: 127.0.0.1
Port: 5000
```

If startup succeeds, open the local address displayed by Flask in your browser. With the default configuration, it is:

`http://127.0.0.1:5000`

The application must be running for the local website to load.

---

## 8. Configuration

The main configuration is defined in `config.py`. Environment variables can override several defaults.

| Setting | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | Development-only fallback | Flask session security |
| `FLASK_DEBUG` | `false` | Controls Flask debug configuration |
| `STOCK_PROVIDER` | `yfinance` | Selects the configured market-data provider |
| `STOCK_CACHE_SECONDS` | `60` | Market-data cache duration |
| `HISTORY_CACHE_SECONDS` | `86400` | Historical-data cache duration |
| `MINIMUM_HISTORY_ROWS` | `120` | Minimum configured history requirement |
| `NEWS_API_KEY` | Empty | Optional news provider credential |
| `NEWS_PROVIDER` | `none` | News provider selection |
| `MAIL_SERVER` | `smtp.gmail.com` | SMTP server |
| `MAIL_PORT` | `587` | SMTP port |
| `MAIL_USE_TLS` | `true` | SMTP TLS configuration |
| `MAIL_USERNAME` | Empty | Email account |
| `MAIL_APP_PASSWORD` | Empty | Email application password |
| `MAIL_DEFAULT_SENDER` | Configured sender or username | Default email sender |
| `ALERT_CHECK_INTERVAL_SECONDS` | `60` | Configured alert-check interval |
| `HOST` | `127.0.0.1` | Development server host |
| `PORT` | `5000` | Development server port |
| `SESSION_COOKIE_SECURE` | `false` | Enables secure-only session cookies when configured |

### Security notes

- Replace the development fallback secret key with a strong, randomly generated value.
- Keep API keys and email credentials out of source control.
- Do not enable Flask debug mode in production.
- Use HTTPS and appropriate secure-cookie settings when deploying behind a properly configured HTTPS server.
- Do not expose the Flask development server directly to the public internet.

---

## 9. Database and Data Storage

Market Plus AI is configured to use a local SQLite database at:

```text
data/market_plus.db
```

This provides local data storage without requiring a separately hosted database service.

The application also defines a local logs directory:

```text
logs/
```

The exact tables, saved records, and persistence behavior are determined by the database and service implementations.

Local storage does not automatically create backups. Back up important application data securely.

## 10. Market Data

The default market-data provider is `yfinance`.

The application may require internet access to retrieve current prices and historical data. Availability, update frequency, symbol support, and returned data depend on the provider.

For Indian listed assets, symbols may use exchange suffixes, such as `.NS` or `.BO`, when supported by the provider.

Examples:

```text
TCS.NS
RELIANCE.NS
INFY.NS
```

These examples illustrate symbol formats and do not guarantee that a particular request will succeed.

A data-provider response can be delayed, incomplete, unavailable, or subject to provider restrictions. The application should validate incoming data before using it for predictions.

## 11. Prediction Methodology

A prediction workflow generally includes:

1. Retrieve historical price and volume data.
2. Validate dates, prices, volume, and missing values.
3. Prepare the historical dataset.
4. Calculate supported technical indicators.
5. Generate predictions using the implemented model.
6. Evaluate predictions against available historical observations.
7. Present results with suitable limitations and explanations.

Potential technical indicators include moving averages, RSI, MACD, and daily returns when implemented by the relevant services.

Model evaluation can include metrics such as mean absolute error (MAE), root mean squared error (RMSE), and percentage-based errors where appropriate.

Evaluation results measure model behavior on the evaluated data. They do not guarantee future performance.

## 12. Testing

The repository includes test files for authentication, alerts, predictions, and routes.

After the implementation and route integration are complete, run the test suite from the project root:

```powershell
python -m unittest discover -s tests -v
```

Review any failures rather than assuming that a successful test command means every application feature works.

Integration testing should also verify:

- Application startup.
- Registration and login.
- Authenticated page access.
- Dashboard rendering after login.
- Market-data retrieval.
- Stock search and details.
- Prediction requests and validation.
- Prediction history persistence.
- News and sentiment endpoints.
- Alert creation, evaluation, and cancellation.
- Profile information.
- Frontend-to-backend API communication.
- Database initialization and error handling.

Tests that depend on online providers may require network access or suitable test fixtures.

## 13. Troubleshooting

### Application does not start

Activate the virtual environment and install dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Read the complete traceback printed in the terminal.

### Port 5000 is already in use

Another process may already be using the configured port. Stop the conflicting development process or choose an available port using the `PORT` environment variable.

### Market data is unavailable

Check your internet connection, symbol format, provider response, and the application's logs. Provider availability cannot be guaranteed.

### Login works but the dashboard is blank

Check the Flask terminal output and browser developer tools. Inspect failed API requests, JavaScript errors, template rendering, and authentication redirects.

### Email alerts are not delivered

Check the email configuration, SMTP credentials, sender address, TLS settings, and provider requirements. Email delivery will not work until the relevant email service is configured correctly.

### Database errors occur

Verify that the configured data directory is writable and that the database initialization code has created the required tables.

---

## 14. Limitations

- Market-data access depends on the configured provider.
- Historical data may contain gaps or inaccuracies.
- Predictions are estimates and may differ substantially from actual market prices.
- News and sentiment features depend on available data sources.
- Email notifications require valid SMTP configuration.
- Local storage requires appropriate backup and access controls.
- The Flask development server is intended for development, not production deployment.
- The complete application must pass integration and security testing before production use.

## 15. Disclaimer

Market Plus AI is an educational and analytical software project.

It does not guarantee profits, future prices, or investment outcomes. Predictions, confidence indicators, sentiment assessments, and risk calculations may be inaccurate or incomplete.

Nothing presented by the application should be treated as a guarantee of return or as a substitute for independent research and qualified financial advice.

Users are responsible for their own financial decisions.

## 16. Project Status

The project includes backend services, frontend pages, configuration, and an initial test suite.

The next development stage is consolidated integration testing to verify that the modules, database, API routes, authentication, frontend behavior, and prediction workflows operate together correctly.

## 17. License

No open-source license has been specified for this project. Unless a license is added, all rights remain with the applicable copyright holder.