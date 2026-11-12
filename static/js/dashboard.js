
"use strict";

/* =========================================================
   MARKET PLUS AI — DASHBOARD
   File: static/js/dashboard.js
   Version: 3.0.0

   Features:
   - Language-aware dashboard messages
   - Locale-aware number, date and currency formatting
   - User preferred currency support
   - Dynamic language-change handling
   - Dashboard summary and investment calculations
   - Recent prediction history
   - Asset search and sorting
   - Mobile sidebar navigation
   - Logout and session handling
   - Compatible with common.js v5.0.0
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const page = document.querySelector(".dashboard-page");

    if (!page) return;

    const elements = {
        welcomeUserName: document.getElementById("welcomeUserName"),
        topbarUserName: document.getElementById("topbarUserName"),
        topbarAvatar: document.getElementById("topbarAvatar"),

        opportunitiesInitialState: document.getElementById("opportunitiesInitialState"),
        opportunitiesLoading: document.getElementById("opportunitiesLoading"),
        opportunitiesError: document.getElementById("opportunitiesError"),
        opportunitiesErrorMessage: document.getElementById("opportunitiesErrorMessage"),
        opportunitiesEmpty: document.getElementById("opportunitiesEmpty"),
        opportunitiesTableWrapper: document.getElementById("opportunitiesTableWrapper"),
        opportunitiesTableBody: document.getElementById("opportunitiesTableBody"),
        opportunitiesResultTitle: document.getElementById("opportunitiesResultTitle"),
        opportunitiesResultCount: document.getElementById("opportunitiesResultCount"),
        opportunitiesSort: document.getElementById("opportunitiesSort"),

        trackedAssetsValue: document.getElementById("trackedAssetsValue"),
        predictionsCreatedValue: document.getElementById("predictionsCreatedValue"),
        profitLossValue: document.getElementById("profitLossValue"),
        profitLossCaption: document.getElementById("profitLossCaption"),
        activeAlertsValue: document.getElementById("activeAlertsValue"),

        recentPredictionsBody: document.getElementById("recentPredictionsBody"),
        dashboardMessage: document.getElementById("dashboardMessage"),

        dashboardSearchForm: document.getElementById("dashboardSearchForm"),
        dashboardAssetSearch: document.getElementById("dashboardAssetSearch"),

        logoutButton: document.getElementById("logoutButton"),
        mobileMenuButton: document.getElementById("mobileMenuButton"),
        appSidebar: document.getElementById("appSidebar"),
        sidebarOverlay: document.getElementById("sidebarOverlay"),
        sidebarAlertCount: document.getElementById("sidebarAlertCount")
    };

    const endpoints = {
        dashboard: "/api/dashboard",
        investments: "/api/investments",
        logout: "/api/auth/logout",
        stockSearch: "/api/stocks/search"
    };

    const app = window.MarketPlusAI || {};

    let dashboardRequestInProgress = false;
    let investmentRequestInProgress = false;

    let currentCurrency = "INR";
    let currentUser = {};

    let dashboardData = null;
    let investmentData = null;

    let opportunityResults = [];
    let opportunitySearchController = null;
    let lastOpportunityQuery = "";

    let opportunitySearchState = "initial";
    let logoutInProgress = false;

    // --------------------------------------------------
    // TRANSLATION FALLBACKS
    // --------------------------------------------------

    const FALLBACK_TEXT = {
        recorded: "Recorded",
        unknownAsset: "Unknown asset",

        recentPredictions:
            "Your recent predictions will appear here",

        createPredictionDescription:
            "Create a prediction to begin building your history.",

        createPrediction:
            "Create a prediction →",

        day: "day",
        days: "days",

        realizedProfitLoss:
            "Realized P/L from completed investments",

        investmentUnavailable:
            "Investment summary temporarily unavailable",

        loading: "Searching...",
        noMatches: "No matching assets",
        searchFailed: "Search failed",
        viewAsset: "View asset",

        loggingOut: "Logging out...",
        logOut: "Log out",

        openNavigation: "Open navigation",
        closeNavigation: "Close navigation",

        searchRequired:
            "Enter a company name or asset symbol to search.",

        searchTooLong:
            "Your search must be 120 characters or fewer.",

        searchFailedMessage:
            "Unable to retrieve matching assets.",

        searchRequestFailed:
            "The asset search request failed.",

        dashboardLoadFailed:
            "The dashboard data could not be loaded.",

        dashboardUnavailable:
            "Unable to load dashboard data. Please try again.",

        investmentLoadFailed:
            "Unable to load investment records.",

        sessionExpired:
            "Your session has expired. Please log in again.",

        logoutFailed:
            "Logout could not be completed. Please try again.",

        requestFailed:
            "The request could not be completed.",

        matchingAssets: "matching assets",
        matchingAsset: "matching asset",
        resultsFor: "Results for",

        statusPending: "Pending",
        statusCompleted: "Completed",
        statusActive: "Active",
        statusFailed: "Failed",
        statusCancelled: "Cancelled",
        statusTriggered: "Triggered",
        statusProcessing: "Processing",
        statusRecorded: "Recorded"
    };

    // --------------------------------------------------
    // LANGUAGE AND TRANSLATION
    // --------------------------------------------------

    function translate(key, fallback) {

        const defaultText =
            fallback ??
            FALLBACK_TEXT[key] ??
            key;

        if (typeof app.translate !== "function") {
            return defaultText;
        }

        try {
            const result = app.translate(key);

            if (
                typeof result === "string" &&
                result.trim() &&
                result !== key
            ) {
                return result;
            }

        } catch (error) {
            console.warn(
                "Translation lookup failed:",
                key,
                error
            );
        }

        return defaultText;
    }

    function getLocale() {

        if (typeof app.getLocale === "function") {
            const locale = app.getLocale();

            if (
                typeof locale === "string" &&
                locale.trim()
            ) {
                return locale;
            }
        }

        return document.documentElement.lang || "en-IN";
    }

    function getLanguage() {

        if (typeof app.getLanguage === "function") {
            return app.getLanguage();
        }

        return document.documentElement.lang || "en";
    }

    function getCurrency() {
        return currentCurrency || "INR";
    }

    function updatePreferredCurrency(data) {

        const candidates = [
            data?.user,
            data?.account,
            data?.profile,
            data?.data?.user,
            data?.data?.account,
            data?.data?.profile,
            data
        ].filter(
            item => item && typeof item === "object"
        );

        let currency = null;

        for (const user of candidates) {

            currency = firstDefined(
                user.preferred_currency,
                user.preferredCurrency,
                user.currency
            );

            if (currency) break;
        }

        if (
            typeof currency === "string" &&
            /^[A-Z]{3}$/i.test(currency.trim())
        ) {
            currentCurrency = currency.trim().toUpperCase();
        }
    }

    // --------------------------------------------------
    // GENERAL HELPERS
    // --------------------------------------------------

    function firstDefined(...values) {

        return values.find(
            value =>
                value !== undefined &&
                value !== null
        );
    }

    function toNumber(value) {

        if (
            typeof value === "number" &&
            Number.isFinite(value)
        ) {
            return value;
        }

        if (
            typeof value === "string" &&
            value.trim() !== ""
        ) {
            const parsed = Number(
                value.replace(/,/g, "").trim()
            );

            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    function showMessage(message, type = "info") {

        const box = elements.dashboardMessage;

        if (!box) return;

        box.textContent = message;

        box.classList.remove(
            "message-error",
            "message-success"
        );

        if (type === "error") {
            box.classList.add("message-error");

        } else if (type === "success") {
            box.classList.add("message-success");
        }

        box.hidden = false;
    }

    function clearMessage() {

        if (!elements.dashboardMessage) return;

        elements.dashboardMessage.textContent = "";
        elements.dashboardMessage.hidden = true;

        elements.dashboardMessage.classList.remove(
            "message-error",
            "message-success"
        );
    }

    // --------------------------------------------------
    // NUMBER FORMATTING
    // --------------------------------------------------

    function formatCount(value) {

        const number = toNumber(value);

        if (number === null) return "—";

        try {

            if (typeof app.formatNumber === "function") {
                return app.formatNumber(number, {
                    maximumFractionDigits: 0
                });
            }

            return new Intl.NumberFormat(
                getLocale(),
                {
                    maximumFractionDigits: 0
                }
            ).format(number);

        } catch (error) {
            return String(number);
        }
    }

    // --------------------------------------------------
    // CURRENCY FORMATTING
    // --------------------------------------------------

    function formatCurrency(
        value,
        currency = getCurrency()
    ) {

        const number = toNumber(value);

        if (number === null) return "—";

        const currencyCode = String(
            currency || getCurrency()
        ).trim().toUpperCase();

        try {

            if (typeof app.formatPrice === "function") {
                return app.formatPrice(
                    number,
                    currencyCode
                );
            }

            return new Intl.NumberFormat(
                getLocale(),
                {
                    style: "currency",
                    currency: currencyCode,
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2
                }
            ).format(number);

        } catch (error) {

            console.warn(
                "Currency formatting fallback:",
                error
            );

            return `${currencyCode} ${number.toFixed(2)}`;
        }
    }

    // --------------------------------------------------
    // DATE FORMATTING
    // --------------------------------------------------

    function formatDate(value) {

        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        try {

            if (typeof app.formatDate === "function") {
                return app.formatDate(date);
            }

            return new Intl.DateTimeFormat(
                getLocale(),
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            ).format(date);

        } catch (error) {
            return date.toLocaleDateString(getLocale());
        }
    }

    // --------------------------------------------------
    // PERCENTAGE FORMATTING
    // --------------------------------------------------

    function formatPercentage(value) {

        const number = toNumber(value);

        if (number === null) return "—";

        try {

            return new Intl.NumberFormat(
                getLocale(),
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    signDisplay: "exceptZero"
                }
            ).format(number) + "%";

        } catch (error) {
            return `${number.toFixed(2)}%`;
        }
    }

    // --------------------------------------------------
    // STATUS TRANSLATION
    // --------------------------------------------------

    function normalizeStatus(value) {

        if (!value) {
            return translate(
                "recorded",
                FALLBACK_TEXT.recorded
            );
        }

        const normalized = String(value)
            .replace(/[_-]+/g, " ")
            .trim()
            .toLowerCase();

        const statusKeys = {
            pending: ["statusPending", "Pending"],
            completed: ["statusCompleted", "Completed"],
            active: ["statusActive", "Active"],
            failed: ["statusFailed", "Failed"],
            cancelled: ["statusCancelled", "Cancelled"],
            triggered: ["statusTriggered", "Triggered"],
            processing: ["statusProcessing", "Processing"],
            recorded: ["statusRecorded", "Recorded"]
        };

        if (statusKeys[normalized]) {

            const [key, fallback] =
                statusKeys[normalized];

            return translate(key, fallback);
        }

        return normalized
            .split(/\s+/)
            .map(word =>
                word.charAt(0).toUpperCase() +
                word.slice(1)
            )
            .join(" ");
    }

    // --------------------------------------------------
    // API REQUEST HANDLER
    // --------------------------------------------------

    async function requestJSON(url, options = {}) {

        if (typeof app.api === "function") {

            const result = await app.api(url, options);

            if (
                result?.success === false
            ) {
                throw new Error(
                    result.message ||
                    result.error ||
                    translate(
                        "request_failed",
                        FALLBACK_TEXT.requestFailed
                    )
                );
            }

            return result;
        }

        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        const contentType =
            response.headers.get("content-type") || "";

        let data;

        if (contentType.includes("application/json")) {
            data = await response.json();

        } else {
            data = {
                message: await response.text()
            };
        }

        if (response.status === 401) {

            window.location.assign("/login");

            throw new Error(
                translate(
                    "sessionExpired",
                    FALLBACK_TEXT.sessionExpired
                )
            );
        }

        if (!response.ok) {
            throw new Error(
                data?.message ||
                data?.error ||
                `Request failed with status ${response.status}.`
            );
        }

        if (data?.success === false) {
            throw new Error(
                data.message ||
                data.error ||
                translate(
                    "request_failed",
                    FALLBACK_TEXT.requestFailed
                )
            );
        }

        return data;
    }

    // --------------------------------------------------
    // ACCOUNT INFORMATION
    // --------------------------------------------------

    function updateUserInformation(data) {

        const user =
            data?.user ||
            data?.account ||
            data?.profile ||
            {};

        currentUser = {
            ...currentUser,
            ...user
        };

        updatePreferredCurrency(data);

        const name = firstDefined(
            user.name,
            user.full_name,
            user.fullName,
            data?.user_name,
            data?.userName,
            data?.name
        );

        if (
            typeof name !== "string" ||
            !name.trim()
        ) {
            return;
        }

        const cleanName = name.trim();

        if (elements.welcomeUserName) {
            elements.welcomeUserName.textContent =
                cleanName;
        }

        if (elements.topbarUserName) {
            elements.topbarUserName.textContent =
                cleanName;
        }

        if (elements.topbarAvatar) {
            elements.topbarAvatar.textContent =
                cleanName.charAt(0).toUpperCase();
        }
    }

    // --------------------------------------------------
    // DASHBOARD SUMMARY
    // --------------------------------------------------

    function updateSummary(data) {

        const summary =
            data?.summary ||
            data?.stats ||
            data ||
            {};

        const predictionCount = firstDefined(
            summary.predictions_created,
            summary.predictionsCreated,
            summary.prediction_count,
            summary.predictionCount,
            summary.total_predictions,
            summary.totalPredictions
        );

        const activeAlerts = firstDefined(
            summary.active_alerts,
            summary.activeAlerts,
            summary.active_alerts_count,
            summary.activeAlertsCount
        );

        if (
            elements.predictionsCreatedValue &&
            predictionCount !== undefined
        ) {
            elements.predictionsCreatedValue.textContent =
                formatCount(predictionCount);
        }

        if (
            elements.activeAlertsValue &&
            activeAlerts !== undefined
        ) {
            elements.activeAlertsValue.textContent =
                formatCount(activeAlerts);
        }

        if (
            activeAlerts !== undefined &&
            elements.sidebarAlertCount
        ) {

            const count = toNumber(activeAlerts);

            if (count !== null && count > 0) {

                elements.sidebarAlertCount.textContent =
                    formatCount(count);

                elements.sidebarAlertCount.hidden = false;

            } else {
                elements.sidebarAlertCount.hidden = true;
            }
        }
    }

    // --------------------------------------------------
    // INVESTMENT SUMMARY
    // --------------------------------------------------

    function extractInvestmentData(response) {

        if (
            response?.data &&
            typeof response.data === "object"
        ) {
            return response.data;
        }

        return response || {};
    }

    function getInvestmentRecords(data) {

        if (Array.isArray(data.trades)) {
            return data.trades;
        }

        const open = Array.isArray(data.open_investments)
            ? data.open_investments
            : [];

        const completed = Array.isArray(data.completed_investments)
            ? data.completed_investments
            : [];

        return [...open, ...completed];
    }

    function countUniqueAssets(records) {

        const assets = new Set();

        records.forEach(record => {

            const identifier = firstDefined(
                record.symbol,
                record.asset_symbol,
                record.ticker,
                record.asset_name,
                record.name
            );

            if (identifier !== undefined) {

                const normalized = String(identifier)
                    .trim()
                    .toUpperCase();

                if (normalized) {
                    assets.add(normalized);
                }
            }
        });

        return assets.size;
    }

    function calculateRealizedProfitLoss(data, records) {

        const summary = data.summary || {};

        const apiProfitLoss = toNumber(
            firstDefined(
                summary.total_realized_profit_loss,
                summary.total_realized_pnl,
                summary.realized_profit_loss,
                data.total_realized_profit_loss
            )
        );

        if (apiProfitLoss !== null) {
            return apiProfitLoss;
        }

        const completed =
            Array.isArray(data.completed_investments)
                ? data.completed_investments
                : records.filter(record =>
                    String(record.status || "")
                        .toUpperCase() === "COMPLETED"
                );

        return completed.reduce((total, record) => {

            const profit = toNumber(
                firstDefined(
                    record.profit_loss,
                    record.realized_profit_loss,
                    record.realized_pnl
                )
            );

            return total + (profit ?? 0);

        }, 0);
    }

    function displayInvestmentSummary(
        assetCount,
        profitLoss
    ) {

        if (elements.trackedAssetsValue) {
            elements.trackedAssetsValue.textContent =
                formatCount(assetCount);
        }

        if (elements.profitLossValue) {

            elements.profitLossValue.textContent =
                formatCurrency(profitLoss);

            elements.profitLossValue.classList.remove(
                "value-positive",
                "value-negative"
            );

            if (profitLoss > 0) {

                elements.profitLossValue.classList.add(
                    "value-positive"
                );

            } else if (profitLoss < 0) {

                elements.profitLossValue.classList.add(
                    "value-negative"
                );
            }
        }

        if (elements.profitLossCaption) {

            elements.profitLossCaption.textContent =
                translate(
                    "realized_profit_loss",
                    FALLBACK_TEXT.realizedProfitLoss
                );
        }
    }

    async function loadInvestmentSummary() {

        if (investmentRequestInProgress) return;

        investmentRequestInProgress = true;

        try {

            const response = await requestJSON(
                endpoints.investments
            );

            const data = extractInvestmentData(response);

            investmentData = data;

            updatePreferredCurrency(response);
            updatePreferredCurrency(data);

            const records = getInvestmentRecords(data);

            const assetCount =
                countUniqueAssets(records);

            const profitLoss =
                calculateRealizedProfitLoss(
                    data,
                    records
                );

            displayInvestmentSummary(
                assetCount,
                profitLoss
            );

        } catch (error) {

            console.error(
                "Investment summary loading failed:",
                error
            );

            if (elements.trackedAssetsValue) {
                elements.trackedAssetsValue.textContent = "—";
            }

            if (elements.profitLossValue) {

                elements.profitLossValue.textContent = "—";

                elements.profitLossValue.classList.remove(
                    "value-positive",
                    "value-negative"
                );
            }

            if (elements.profitLossCaption) {

                elements.profitLossCaption.textContent =
                    translate(
                        "investment_summary_unavailable",
                        FALLBACK_TEXT.investmentUnavailable
                    );
            }

        } finally {
            investmentRequestInProgress = false;
        }
    }

    // --------------------------------------------------
    // RECENT PREDICTIONS TABLE
    // --------------------------------------------------

    function createCell(text, className = "") {

        const cell = document.createElement("td");

        if (className) {
            cell.className = className;
        }

        cell.textContent = text ?? "—";

        return cell;
    }

    function renderEmptyPredictions(message) {

        const tbody = elements.recentPredictionsBody;

        if (!tbody) return;

        const emptyMessage = message ||
            translate(
                "recent_predictions_empty",
                FALLBACK_TEXT.recentPredictions
            );

        tbody.replaceChildren();

        const row = document.createElement("tr");
        row.className = "dashboard-table-empty";

        const cell = document.createElement("td");
        cell.colSpan = 5;

        const state = document.createElement("div");
        state.className = "table-empty-state";

        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "◷";

        const title = document.createElement("strong");
        title.textContent = emptyMessage;

        const description = document.createElement("p");
        description.textContent = translate(
            "create_prediction_description",
            FALLBACK_TEXT.createPredictionDescription
        );

        const link = document.createElement("a");
        link.className = "text-link";
        link.href = "/predictions";
        link.textContent = translate(
            "create_prediction",
            FALLBACK_TEXT.createPrediction
        );

        state.append(
            icon,
            title,
            description,
            link
        );

        cell.appendChild(state);
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function getPredictionAsset(prediction) {

        return firstDefined(
            prediction.symbol,
            prediction.ticker,
            prediction.asset_symbol,
            prediction.assetSymbol,
            prediction.stock_symbol,
            prediction.stockSymbol,
            prediction.asset,
            prediction.stock_name,
            prediction.stockName,
            prediction.company_name,
            prediction.companyName,
            prediction.name
        );
    }

    function getPredictionDate(prediction) {

        return firstDefined(
            prediction.created_at,
            prediction.createdAt,
            prediction.prediction_date,
            prediction.predictionDate,
            prediction.date,
            prediction.timestamp
        );
    }

    function getForecastPrice(prediction) {

        return firstDefined(
            prediction.predicted_price,
            prediction.predictedPrice,
            prediction.forecast_price,
            prediction.forecastPrice,
            prediction.prediction_price,
            prediction.predictionPrice,
            prediction.target_price,
            prediction.targetPrice
        );
    }

    function getPredictionDuration(prediction) {

        const value = firstDefined(
            prediction.duration,
            prediction.horizon,
            prediction.period,
            prediction.prediction_days,
            prediction.predictionDays,
            prediction.days
        );

        if (value === undefined) return "—";

        if (typeof value === "number") {

            const unit = value === 1
                ? translate("day", FALLBACK_TEXT.day)
                : translate("days", FALLBACK_TEXT.days);

            return `${formatCount(value)} ${unit}`;
        }

        return String(value);
    }

    function renderPredictions(predictions) {

        const tbody = elements.recentPredictionsBody;

        if (!tbody) return;

        if (
            !Array.isArray(predictions) ||
            predictions.length === 0
        ) {
            renderEmptyPredictions();
            return;
        }

        tbody.replaceChildren();

        predictions.slice(0, 5).forEach(prediction => {

            const row = document.createElement("tr");

            const assetCell = document.createElement("td");
            const assetName = document.createElement("span");

            assetName.className = "asset-name";

            const asset = getPredictionAsset(prediction);

            assetName.textContent = asset
                ? String(asset)
                : translate(
                    "unknown_asset",
                    FALLBACK_TEXT.unknownAsset
                );

            assetCell.appendChild(assetName);

            const date = getPredictionDate(prediction);

            const forecast = toNumber(
                getForecastPrice(prediction)
            );

            const forecastText = forecast === null
                ? "—"
                : formatCurrency(forecast);

            const status = firstDefined(
                prediction.status,
                prediction.state,
                prediction.result_status
            );

            const statusCell = document.createElement("td");
            const statusBadge = document.createElement("span");

            statusBadge.className = "prediction-status";
            statusBadge.textContent = normalizeStatus(status);

            statusCell.appendChild(statusBadge);

            row.append(
                assetCell,
                createCell(formatDate(date)),
                createCell(forecastText),
                createCell(getPredictionDuration(prediction)),
                statusCell
            );

            tbody.appendChild(row);
        });
    }

    // --------------------------------------------------
    // DASHBOARD RESPONSE HELPERS
    // --------------------------------------------------

    function extractPredictions(data) {

        const candidates = [
            data?.recent_predictions,
            data?.recentPredictions,
            data?.predictions,
            data?.recent_activity,
            data?.recentActivity
        ];

        return candidates.find(Array.isArray);
    }

    function extractDashboardData(data) {

        if (
            data?.dashboard &&
            typeof data.dashboard === "object"
        ) {
            return data.dashboard;
        }

        if (
            data?.data &&
            typeof data.data === "object"
        ) {
            return data.data;
        }

        return data;
    }

    // --------------------------------------------------
    // LOAD DASHBOARD DATA
    // --------------------------------------------------

    async function loadDashboard() {

        if (dashboardRequestInProgress) return;

        dashboardRequestInProgress = true;

        try {

            const responseData = await requestJSON(
                endpoints.dashboard
            );

            const data =
                extractDashboardData(responseData);

            if (
                responseData?.success === false ||
                data?.success === false
            ) {
                throw new Error(
                    responseData?.message ||
                    data?.message ||
                    translate(
                        "dashboardLoadFailed",
                        FALLBACK_TEXT.dashboardLoadFailed
                    )
                );
            }

            dashboardData = data;

            updateUserInformation(data);
            updatePreferredCurrency(responseData);
            updateSummary(data);

            const predictions =
                extractPredictions(data);

            if (predictions) {
                renderPredictions(predictions);
            }

            clearMessage();

        } catch (error) {

            console.error(
                "Dashboard loading failed:",
                error
            );

            showMessage(
                error.message ||
                translate(
                    "dashboardUnavailable",
                    FALLBACK_TEXT.dashboardUnavailable
                ),
                "error"
            );

        } finally {
            dashboardRequestInProgress = false;
        }
    }

    // --------------------------------------------------
    // DISCOVER OPPORTUNITIES
    // --------------------------------------------------

    function setOpportunityState(state) {

        opportunitySearchState = state;

        const states = [
            elements.opportunitiesInitialState,
            elements.opportunitiesLoading,
            elements.opportunitiesError,
            elements.opportunitiesEmpty,
            elements.opportunitiesTableWrapper
        ];

        states.forEach(item => {
            if (item) item.hidden = true;
        });

        const selected = {
            initial: elements.opportunitiesInitialState,
            loading: elements.opportunitiesLoading,
            error: elements.opportunitiesError,
            empty: elements.opportunitiesEmpty,
            results: elements.opportunitiesTableWrapper
        }[state];

        if (selected) {
            selected.hidden = false;
        }
    }

    function extractOpportunityResults(response) {

        const containers = [
            response?.results,
            response?.stocks,
            response?.assets,
            response?.items,
            response?.data?.results,
            response?.data?.stocks,
            response?.data?.assets,
            response?.data?.items,
            response?.data
        ];

        return containers.find(Array.isArray) || [];
    }

    function normalizeOpportunity(item) {

        const symbol = firstDefined(
            item.symbol,
            item.ticker,
            item.asset_symbol,
            item.stock_symbol
        );

        const name = firstDefined(
            item.name,
            item.company_name,
            item.companyName,
            item.asset_name,
            item.title,
            symbol
        );

        const exchange = firstDefined(
            item.exchange,
            item.market,
            item.exchange_name
        );

        const price = toNumber(
            firstDefined(
                item.current_price,
                item.currentPrice,
                item.price,
                item.last_price,
                item.lastPrice
            )
        );

        const change = toNumber(
            firstDefined(
                item.change_percent,
                item.changePercent,
                item.percentage_change,
                item.percentageChange,
                item.percent_change
            )
        );

        return {
            symbol: symbol
                ? String(symbol).trim()
                : "",

            name: name
                ? String(name).trim()
                : translate(
                    "unknown_asset",
                    FALLBACK_TEXT.unknownAsset
                ),

            exchange: exchange
                ? String(exchange).trim()
                : "—",

            price,
            change
        };
    }

    function createOpportunityCell(
        value,
        className = ""
    ) {

        const cell = document.createElement("td");

        if (className) {
            cell.className = className;
        }

        cell.textContent = value ?? "—";

        return cell;
    }

    function updateOpportunityHeading() {

        if (elements.opportunitiesResultTitle) {

            elements.opportunitiesResultTitle.textContent =
                `${translate(
                    "results_for",
                    FALLBACK_TEXT.resultsFor
                )} "${lastOpportunityQuery}"`;
        }
    }

    function updateOpportunityCount(count) {

        if (!elements.opportunitiesResultCount) return;

        const label = count === 1
            ? translate(
                "matching_asset",
                FALLBACK_TEXT.matchingAsset
            )
            : translate(
                "matching_assets",
                FALLBACK_TEXT.matchingAssets
            );

        elements.opportunitiesResultCount.textContent =
            `${formatCount(count)} ${label}`;
    }

    function renderOpportunityResults() {

        const tbody = elements.opportunitiesTableBody;

        if (!tbody) return;

        const sortValue =
            elements.opportunitiesSort?.value ||
            "relevance";

        const results = [...opportunityResults];

        if (sortValue === "name") {

            results.sort((a, b) =>
                a.name.localeCompare(
                    b.name,
                    getLocale()
                )
            );
        }

        if (sortValue === "price_high") {

            results.sort((a, b) =>
                (b.price ?? -Infinity) -
                (a.price ?? -Infinity)
            );
        }

        if (sortValue === "price_low") {

            results.sort((a, b) =>
                (a.price ?? Infinity) -
                (b.price ?? Infinity)
            );
        }

        if (sortValue === "change_high") {

            results.sort((a, b) =>
                (b.change ?? -Infinity) -
                (a.change ?? -Infinity)
            );
        }

        if (sortValue === "change_low") {

            results.sort((a, b) =>
                (a.change ?? Infinity) -
                (b.change ?? Infinity)
            );
        }

        tbody.replaceChildren();

        results.forEach(asset => {

            const row = document.createElement("tr");

            const nameCell =
                createOpportunityCell(asset.name);

            nameCell.classList.add(
                "opportunity-asset-name"
            );

            const symbolCell =
                createOpportunityCell(asset.symbol);

            symbolCell.classList.add(
                "opportunity-symbol"
            );

            const exchangeCell =
                createOpportunityCell(asset.exchange);

            const priceCell =
                createOpportunityCell(
                    asset.price === null
                        ? "—"
                        : formatCurrency(asset.price)
                );

            const changeCell =
                document.createElement("td");

            if (asset.change === null) {

                changeCell.textContent = "—";

            } else {

                changeCell.textContent =
                    formatPercentage(asset.change);

                changeCell.classList.add(
                    asset.change > 0
                        ? "opportunity-positive"
                        : asset.change < 0
                            ? "opportunity-negative"
                            : "opportunity-neutral"
                );
            }

            const actionCell =
                document.createElement("td");

            const viewButton =
                document.createElement("a");

            viewButton.className =
                "opportunity-view-button";

            viewButton.textContent =
                translate(
                    "view_asset",
                    FALLBACK_TEXT.viewAsset
                );

            viewButton.href =
                `/stock/${encodeURIComponent(asset.symbol)}`;

            actionCell.appendChild(viewButton);

            row.append(
                nameCell,
                symbolCell,
                exchangeCell,
                priceCell,
                changeCell,
                actionCell
            );

            tbody.appendChild(row);
        });

        updateOpportunityCount(results.length);

        setOpportunityState("results");
    }

    async function searchDashboardAssets(query) {

        if (!query) return;

        lastOpportunityQuery = query;

        if (opportunitySearchController) {
            opportunitySearchController.abort();
        }

        opportunitySearchController =
            new AbortController();

        const controller =
            opportunitySearchController;

        setOpportunityState("loading");

        updateOpportunityHeading();

        if (elements.opportunitiesResultCount) {

            elements.opportunitiesResultCount.textContent =
                translate(
                    "searching",
                    FALLBACK_TEXT.loading
                );
        }

        if (elements.opportunitiesSort) {

            elements.opportunitiesSort.disabled = true;
            elements.opportunitiesSort.value = "relevance";
        }

        try {

            const url = new URL(
                endpoints.stockSearch,
                window.location.origin
            );

            url.searchParams.set("q", query);
            url.searchParams.set("limit", "10");

            const response = await fetch(
                url.toString(),
                {
                    method: "GET",
                    credentials: "same-origin",
                    signal: controller.signal,
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

            const contentType =
                response.headers.get("content-type") || "";

            const data =
                contentType.includes("application/json")
                    ? await response.json()
                    : {};

            if (response.status === 401) {

                window.location.assign("/login");
                return;
            }

            if (
                !response.ok ||
                data?.success === false
            ) {
                throw new Error(
                    data?.message ||
                    data?.error ||
                    translate(
                        "searchRequestFailed",
                        FALLBACK_TEXT.searchRequestFailed
                    )
                );
            }

            opportunityResults =
                extractOpportunityResults(data)
                    .map(normalizeOpportunity)
                    .filter(asset => asset.symbol);

            if (elements.opportunitiesSort) {

                elements.opportunitiesSort.disabled =
                    opportunityResults.length === 0;
            }

            if (opportunityResults.length === 0) {

                if (elements.opportunitiesResultCount) {

                    elements.opportunitiesResultCount.textContent =
                        translate(
                            "no_matching_assets",
                            FALLBACK_TEXT.noMatches
                        );
                }

                setOpportunityState("empty");
                return;
            }

            renderOpportunityResults();

        } catch (error) {

            if (error.name === "AbortError") return;

            console.error(
                "Dashboard asset search failed:",
                error
            );

            if (elements.opportunitiesErrorMessage) {

                elements.opportunitiesErrorMessage.textContent =
                    error.message ||
                    translate(
                        "asset_search_failed",
                        FALLBACK_TEXT.searchFailedMessage
                    );
            }

            if (elements.opportunitiesResultCount) {

                elements.opportunitiesResultCount.textContent =
                    translate(
                        "search_failed",
                        FALLBACK_TEXT.searchFailed
                    );
            }

            setOpportunityState("error");

        } finally {

            if (
                opportunitySearchController === controller
            ) {
                opportunitySearchController = null;
            }
        }
    }

    // --------------------------------------------------
    // SEARCH FORM
    // --------------------------------------------------

    if (elements.dashboardSearchForm) {

        elements.dashboardSearchForm.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                clearMessage();

                const query =
                    elements.dashboardAssetSearch?.value.trim();

                if (!query) {

                    showMessage(
                        translate(
                            "enter_asset_search",
                            FALLBACK_TEXT.searchRequired
                        ),
                        "error"
                    );

                    elements.dashboardAssetSearch?.focus();
                    return;
                }

                if (query.length > 120) {

                    showMessage(
                        translate(
                            "search_too_long",
                            FALLBACK_TEXT.searchTooLong
                        ),
                        "error"
                    );

                    return;
                }

                searchDashboardAssets(query);
            }
        );
    }

    elements.opportunitiesSort?.addEventListener(
        "change",
        renderOpportunityResults
    );

    // --------------------------------------------------
    // MOBILE SIDEBAR
    // --------------------------------------------------

    function setSidebarOpen(open) {

        page.classList.toggle(
            "sidebar-open",
            open
        );

        if (elements.mobileMenuButton) {

            elements.mobileMenuButton.setAttribute(
                "aria-expanded",
                String(open)
            );

            elements.mobileMenuButton.setAttribute(
                "aria-label",
                translate(
                    open
                        ? "close_navigation"
                        : "open_navigation",
                    open
                        ? FALLBACK_TEXT.closeNavigation
                        : FALLBACK_TEXT.openNavigation
                )
            );

            elements.mobileMenuButton.textContent =
                open ? "×" : "☰";
        }

        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.hidden = !open;
        }

        document.body.style.overflow =
            open && window.innerWidth <= 980
                ? "hidden"
                : "";
    }

    elements.mobileMenuButton?.addEventListener(
        "click",
        () => {

            const open =
                !page.classList.contains("sidebar-open");

            setSidebarOpen(open);
        }
    );

    elements.sidebarOverlay?.addEventListener(
        "click",
        () => setSidebarOpen(false)
    );

    elements.appSidebar
        ?.querySelectorAll(".nav-link")
        .forEach(link => {

            link.addEventListener(
                "click",
                () => setSidebarOpen(false)
            );
        });

    document.addEventListener(
        "keydown",
        event => {

            if (event.key === "Escape") {
                setSidebarOpen(false);
            }
        }
    );

    window.addEventListener(
        "resize",
        () => {

            if (window.innerWidth > 980) {
                setSidebarOpen(false);
            }
        }
    );

    // --------------------------------------------------
    // LOGOUT
    // --------------------------------------------------

    if (elements.logoutButton) {

        elements.logoutButton.addEventListener(
            "click",
            async () => {

                const button = elements.logoutButton;

                if (
                    button.disabled ||
                    logoutInProgress
                ) {
                    return;
                }

                logoutInProgress = true;

                const originalText =
                    button.textContent.trim();

                button.disabled = true;

                button.setAttribute(
                    "aria-busy",
                    "true"
                );

                const label = button.querySelector(
                    "span:last-child"
                );

                if (label) {

                    label.textContent =
                        translate(
                            "logging_out",
                            FALLBACK_TEXT.loggingOut
                        );
                }

                try {

                    await requestJSON(
                        endpoints.logout,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({})
                        }
                    );

                    window.location.assign("/login");

                } catch (error) {

                    console.error(
                        "Logout failed:",
                        error
                    );

                    showMessage(
                        translate(
                            "logout_failed",
                            FALLBACK_TEXT.logoutFailed
                        ),
                        "error"
                    );

                    button.disabled = false;

                    button.removeAttribute(
                        "aria-busy"
                    );

                    logoutInProgress = false;

                    if (label) {

                        label.textContent =
                            translate(
                                "logout",
                                FALLBACK_TEXT.logOut
                            );

                    } else {

                        button.textContent =
                            originalText;
                    }
                }
            }
        );
    }

    // --------------------------------------------------
    // REFRESH AFTER LANGUAGE CHANGE
    // --------------------------------------------------

    function refreshDashboardFormatting() {

        // Re-render account and dashboard information.
        if (dashboardData) {

            updateUserInformation(dashboardData);
            updateSummary(dashboardData);

            const predictions =
                extractPredictions(dashboardData);

            if (predictions) {
                renderPredictions(predictions);
            }
        }

        // Re-render investment figures using the
        // selected locale and preferred currency.
        if (investmentData) {

            const records =
                getInvestmentRecords(investmentData);

            displayInvestmentSummary(
                countUniqueAssets(records),
                calculateRealizedProfitLoss(
                    investmentData,
                    records
                )
            );
        }

        // Re-render asset search results.
        if (opportunityResults.length > 0) {

            updateOpportunityHeading();
            renderOpportunityResults();

        } else if (
            lastOpportunityQuery &&
            opportunitySearchState === "empty"
        ) {

            updateOpportunityHeading();

            if (elements.opportunitiesResultCount) {

                elements.opportunitiesResultCount.textContent =
                    translate(
                        "no_matching_assets",
                        FALLBACK_TEXT.noMatches
                    );
            }

        } else if (
            lastOpportunityQuery &&
            opportunitySearchState === "loading"
        ) {

            updateOpportunityHeading();

            if (elements.opportunitiesResultCount) {

                elements.opportunitiesResultCount.textContent =
                    translate(
                        "searching",
                        FALLBACK_TEXT.loading
                    );
            }

        } else if (
            lastOpportunityQuery &&
            opportunitySearchState === "error"
        ) {

            updateOpportunityHeading();

            if (elements.opportunitiesResultCount) {

                elements.opportunitiesResultCount.textContent =
                    translate(
                        "search_failed",
                        FALLBACK_TEXT.searchFailed
                    );
            }
        }

        // Refresh mobile navigation accessibility text.
        if (elements.mobileMenuButton) {

            const isOpen =
                page.classList.contains("sidebar-open");

            elements.mobileMenuButton.setAttribute(
                "aria-label",
                translate(
                    isOpen
                        ? "close_navigation"
                        : "open_navigation",
                    isOpen
                        ? FALLBACK_TEXT.closeNavigation
                        : FALLBACK_TEXT.openNavigation
                )
            );
        }

        // Refresh logout button text if a request
        // is not currently in progress.
        if (
            elements.logoutButton &&
            !logoutInProgress
        ) {

            const label =
                elements.logoutButton.querySelector(
                    "span:last-child"
                );

            if (label) {
                label.textContent =
                    translate(
                        "logout",
                        FALLBACK_TEXT.logOut
                    );
            }
        }
    }

    window.addEventListener(
        "marketplus:languagechange",
        refreshDashboardFormatting
    );

    // --------------------------------------------------
    // INITIALIZE
    // --------------------------------------------------

    renderEmptyPredictions();

    loadDashboard();

    loadInvestmentSummary();

    console.info(
        "Market Plus AI dashboard initialized.",
        {
            language: getLanguage(),
            locale: getLocale(),
            currency: getCurrency()
        }
    );

});
