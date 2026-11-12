/* ============================================================
   MARKET PLUS AI — STOCK DETAILS
   File: static/js/stock_details.js
   Version: 1.1.0

   Features:
   - Loads stock details from the Flask stock API
   - Supports backend field names from stock_service.py
   - Currency-aware price formatting
   - Daily price movement and update timestamp
   - Market statistics and company information
   - Historical Chart.js graph
   - Historical OHLCV table and pagination
   - Safe related-news rendering
   - AI prediction navigation
   - Dashboard account information
   - Mobile sidebar and logout
   - Prevents outdated chart requests from overwriting
     newer period selections
   ============================================================ */

(() => {
    "use strict";

    const API = "/api";
    const PAGE_SIZE = 10;

    const state = {
        symbol: "",
        asset: null,
        history: [],
        chart: null,
        chartPeriod: "3mo",
        historyPage: 1,
        chartRequestId: 0,
        chartController: null
    };

    const $ = (id) => document.getElementById(id);

    document.addEventListener("DOMContentLoaded", init);

    /* ========================================================
       INITIALIZATION
       ======================================================== */

    function init() {
        state.symbol = getSymbolFromURL();

        setupNavigation();
        setupChartPeriod();
        setupHistoryPagination();
        setupPredictionButton();
        setupNewsLink();

        if (!state.symbol) {
            setMessage(
                "No stock symbol was provided. Return to Explore Assets and select a stock.",
                "error"
            );

            setUnavailableState();
            return;
        }

        updateSymbolLabels();
        updatePredictionLink();

        loadStockDetails();
    }

    /* ========================================================
       URL AND GENERAL UTILITIES
       ======================================================== */

    function getSymbolFromURL() {
        const parts = window.location.pathname
            .split("/")
            .filter(Boolean);

        const stockIndex = parts.lastIndexOf("stock");

        if (stockIndex >= 0 && parts[stockIndex + 1]) {
            try {
                return decodeURIComponent(parts[stockIndex + 1])
                    .trim()
                    .toUpperCase();
            } catch {
                return parts[stockIndex + 1]
                    .trim()
                    .toUpperCase();
            }
        }

        const params = new URLSearchParams(window.location.search);

        return (
            params.get("symbol") ||
            params.get("ticker") ||
            ""
        ).trim().toUpperCase();
    }

    function firstValue(object, keys) {
        if (!object || typeof object !== "object") {
            return undefined;
        }

        for (const key of keys) {
            const value = object[key];

            if (
                value !== undefined &&
                value !== null &&
                value !== ""
            ) {
                return value;
            }
        }

        return undefined;
    }

    function numberValue(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        const number = Number(value);

        return Number.isFinite(number) ? number : null;
    }

    function getCurrency() {
        return (
            state.asset?.currency ||
            "INR"
        ).toUpperCase();
    }

    function formatCurrency(value) {
        const number = numberValue(value);

        if (number === null) {
            return "—";
        }

        const currency = getCurrency();

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(number);
        } catch {
            return `${currency} ${formatNumber(number)}`;
        }
    }

    function formatNumber(value) {
        const number = numberValue(value);

        if (number === null) {
            return "—";
        }

        return new Intl.NumberFormat("en-IN", {
            maximumFractionDigits: 2
        }).format(number);
    }

    function formatCompactNumber(value) {
        const number = numberValue(value);

        if (number === null) {
            return "—";
        }

        return new Intl.NumberFormat("en-IN", {
            notation: "compact",
            maximumFractionDigits: 2
        }).format(number);
    }

    function formatVolume(value) {
        const number = numberValue(value);

        if (number === null) {
            return "—";
        }

        return new Intl.NumberFormat("en-IN", {
            maximumFractionDigits: 0
        }).format(number);
    }

    function parseDate(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        // Support Unix timestamps in seconds.
        if (
            typeof value === "number" ||
            /^\d{10,13}$/.test(String(value))
        ) {
            let timestamp = Number(value);

            if (String(Math.trunc(timestamp)).length === 10) {
                timestamp *= 1000;
            }

            const date = new Date(timestamp);

            return Number.isNaN(date.getTime())
                ? null
                : date;
        }

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    function formatDate(value) {
        const date = parseDate(value);

        if (!date) {
            return value ? String(value) : "Date unavailable";
        }

        return new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeZone: "Asia/Kolkata"
        }).format(date);
    }

    function formatDateTime(value) {
        const date = parseDate(value);

        if (!date) {
            return value
                ? String(value)
                : "Update time unavailable";
        }

        return new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata"
        }).format(date);
    }

    function setText(id, value) {
        const element = $(id);

        if (!element) {
            return;
        }

        element.textContent =
            value === undefined ||
            value === null ||
            value === ""
                ? "—"
                : String(value);
    }

    function setMessage(message, type = "info") {
        const element = $("stockDetailsMessage");

        if (!element) {
            return;
        }

        element.textContent = message;
        element.hidden = false;
        element.className =
            `stock-search-message is-${type}`;

        element.setAttribute(
            "role",
            type === "error" ? "alert" : "status"
        );
    }

    function clearMessage() {
        const element = $("stockDetailsMessage");

        if (!element) {
            return;
        }

        element.textContent = "";
        element.hidden = true;
    }

    function setChangeStyle(element, value) {
        if (!element) {
            return;
        }

        element.classList.remove(
            "positive",
            "negative",
            "neutral",
            "is-positive",
            "is-negative"
        );

        const number = numberValue(value);

        if (number === null || number === 0) {
            element.classList.add("neutral");
        } else if (number > 0) {
            element.classList.add("positive");
        } else {
            element.classList.add("negative");
        }
    }

    /* ========================================================
       API UTILITIES
       ======================================================== */

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        if (response.status === 401) {
            window.location.assign("/login");

            const error = new Error(
                "Your session has expired. Please log in again."
            );

            error.status = 401;
            throw error;
        }

        const contentType =
            response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
            const error = new Error(
                response.status === 404
                    ? "The requested API endpoint was not found."
                    : "The server returned an unexpected response."
            );

            error.status = response.status;
            throw error;
        }

        const result = await response.json();

        if (
            !response.ok ||
            result.success === false
        ) {
            const error = new Error(
                result.message ||
                result.error ||
                `Request failed with status ${response.status}.`
            );

            error.status = response.status;
            throw error;
        }

        return result;
    }

    function unwrapObject(response) {
        if (!response || typeof response !== "object") {
            return {};
        }

        let result =
            response.asset ??
            response.stock ??
            response.details ??
            response.data ??
            response.result ??
            response;

        if (Array.isArray(result)) {
            result = result[0] || {};
        }

        return (
            result && typeof result === "object"
                ? result
                : {}
        );
    }

    /* ========================================================
       PAGE LABELS AND EMPTY STATE
       ======================================================== */

    function updateSymbolLabels() {
        setText("assetSymbol", state.symbol);
        setText("chartAssetSymbol", state.symbol);

        const logo = $("assetLogo");

        if (logo) {
            logo.textContent = state.symbol
                .replace(/\.(NS|BO)$/i, "")
                .replace(/[^A-Z0-9]/gi, "")
                .slice(0, 4) || "M+";
        }

        document.title =
            `${state.symbol} Details | Market Plus AI`;
    }

    function setUnavailableState() {
        const ids = [
            "assetName",
            "assetCategory",
            "assetExchange",
            "assetCurrentPrice",
            "assetPriceChange",
            "assetPriceTimestamp",
            "assetMarketStatus",
            "assetPreviousClose",
            "assetOpenPrice",
            "assetDayHigh",
            "assetDayLow",
            "assetVolume",
            "assetMarketCap",
            "asset52WeekHigh",
            "asset52WeekLow",
            "assetSector",
            "assetIndustry",
            "assetEmployees",
            "assetDescription"
        ];

        ids.forEach((id) => setText(id, "—"));

        setText("chartDataCount", "Unavailable");
        setText("chartLatestClose", "—");

        renderEmptyChart(
            "Select a stock to view its historical price chart."
        );

        renderEmptyHistory(
            "No stock has been selected."
        );
    }

    /* ========================================================
       STOCK DETAILS REQUEST
       ======================================================== */

    async function loadStockDetails() {
        if (!state.symbol) {
            return;
        }

        clearMessage();

        setText("assetName", "Loading stock information...");
        setText("assetCurrentPrice", "Loading...");

        const requestedSymbol = state.symbol;
        const encodedSymbol =
            encodeURIComponent(requestedSymbol);

        try {
            const response = await fetchJSON(
                `${API}/stocks/${encodedSymbol}`
            );

            if (state.symbol !== requestedSymbol) {
                return;
            }

            const raw = unwrapObject(response);

            state.asset = normalizeAsset(
                raw,
                requestedSymbol
            );

            renderAsset(state.asset);

            // Chart loading is independent of stock details.
            // A chart failure must not erase the quote.
            loadHistoricalData(state.chartPeriod);

            loadRelatedNews().catch((error) => {
                console.warn(
                    "Related news unavailable:",
                    error.message
                );

                renderNewsUnavailable();
            });

        } catch (error) {
            console.error(
                "Stock details request failed:",
                error
            );

            setUnavailableState();

            setMessage(
                error.message ||
                "Unable to retrieve stock details. Please try again later.",
                "error"
            );
        }
    }

    /* ========================================================
       NORMALIZE BACKEND STOCK DATA

       Supports stock_service.py fields:
       last_price, price_change, change_percent,
       previous_close, day_high, day_low, year_high,
       year_low, last_volume, market_cap, currency,
       quote_timestamp, last_updated, data_available.
       ======================================================== */

    function normalizeAsset(raw, requestedSymbol) {
        const symbol = String(
            firstValue(raw, [
                "symbol",
                "ticker",
                "stock_symbol",
                "stockSymbol"
            ]) || requestedSymbol
        ).toUpperCase();

        const currentPrice = numberValue(
            firstValue(raw, [
                "last_price",
                "current_price",
                "currentPrice",
                "latest_price",
                "latestPrice",
                "price",
                "regularMarketPrice",
                "close"
            ])
        );

        const previousClose = numberValue(
            firstValue(raw, [
                "previous_close",
                "regular_market_previous_close",
                "previousClose",
                "regularMarketPreviousClose"
            ])
        );

        let change = numberValue(
            firstValue(raw, [
                "price_change",
                "change",
                "daily_change",
                "priceChange",
                "regularMarketChange"
            ])
        );

        let changePercent = numberValue(
            firstValue(raw, [
                "change_percent",
                "percent_change",
                "changePercent",
                "percentChange",
                "regularMarketChangePercent"
            ])
        );

        if (
            change === null &&
            currentPrice !== null &&
            previousClose !== null
        ) {
            change = currentPrice - previousClose;
        }

        if (
            changePercent === null &&
            change !== null &&
            previousClose !== null &&
            previousClose !== 0
        ) {
            changePercent =
                (change / previousClose) * 100;
        }

        return {
            symbol,

            name: firstValue(raw, [
                "name",
                "company_name",
                "companyName",
                "longName",
                "shortName"
            ]) || symbol,

            category: firstValue(raw, [
                "category",
                "asset_category",
                "assetCategory",
                "type"
            ]) || "Listed asset",

            exchange: firstValue(raw, [
                "exchange",
                "exchange_name",
                "exchangeName",
                "fullExchangeName",
                "market"
            ]) || inferExchange(symbol),

            currentPrice,
            previousClose,
            change,
            changePercent,

            open: numberValue(
                firstValue(raw, [
                    "open",
                    "day_open",
                    "dayOpen",
                    "regularMarketOpen"
                ])
            ),

            high: numberValue(
                firstValue(raw, [
                    "day_high",
                    "dayHigh",
                    "high",
                    "regularMarketDayHigh"
                ])
            ),

            low: numberValue(
                firstValue(raw, [
                    "day_low",
                    "dayLow",
                    "low",
                    "regularMarketDayLow"
                ])
            ),

            volume: numberValue(
                firstValue(raw, [
                    "last_volume",
                    "volume",
                    "regularMarketVolume",
                    "trading_volume"
                ])
            ),

            marketCap: numberValue(
                firstValue(raw, [
                    "market_cap",
                    "marketCap",
                    "marketCapitalization"
                ])
            ),

            high52: numberValue(
                firstValue(raw, [
                    "year_high",
                    "52_week_high",
                    "fiftyTwoWeekHigh",
                    "fifty_two_week_high",
                    "52WeekHigh"
                ])
            ),

            low52: numberValue(
                firstValue(raw, [
                    "year_low",
                    "52_week_low",
                    "fiftyTwoWeekLow",
                    "fifty_two_week_low",
                    "52WeekLow"
                ])
            ),

            sector: firstValue(raw, [
                "sector"
            ]) || "Not available",

            industry: firstValue(raw, [
                "industry"
            ]) || "Not available",

            website: firstValue(raw, [
                "website",
                "company_website",
                "companyWebsite"
            ]) || "",

            employees: numberValue(
                firstValue(raw, [
                    "employees",
                    "fullTimeEmployees",
                    "full_time_employees"
                ])
            ),

            description: firstValue(raw, [
                "description",
                "longBusinessSummary",
                "company_description",
                "companyDescription"
            ]) || "Company description is not available from the data provider.",

            timestamp: firstValue(raw, [
                "quote_timestamp",
                "price_timestamp",
                "timestamp",
                "last_updated",
                "lastUpdated",
                "updated_at",
                "updatedAt",
                "regularMarketTime"
            ]),

            marketStatus: firstValue(raw, [
                "market_status",
                "marketStatus"
            ]) || "Market status not provided",

            currency: firstValue(raw, [
                "currency"
            ]) || "INR",

            dataAvailable: raw.data_available !== false
        };
    }

    function inferExchange(symbol) {
        if (symbol.endsWith(".NS")) {
            return "NSE";
        }

        if (symbol.endsWith(".BO")) {
            return "BSE";
        }

        return "Exchange information unavailable";
    }

    /* ========================================================
       RENDER STOCK DETAILS
       ======================================================== */

    function renderAsset(asset) {
        setText("assetSymbol", asset.symbol);
        setText("assetName", asset.name);
        setText("assetCategory", asset.category);
        setText("assetExchange", asset.exchange);

        setText(
            "assetCurrentPrice",
            asset.currentPrice === null
                ? "Price unavailable"
                : formatCurrency(asset.currentPrice)
        );

        let changeText = "Daily change unavailable";

        if (
            asset.change !== null ||
            asset.changePercent !== null
        ) {
            const amount = asset.change === null
                ? "—"
                : `${asset.change > 0 ? "+" : ""}${formatCurrency(asset.change)}`;

            const percent = asset.changePercent === null
                ? "—"
                : `${asset.changePercent > 0 ? "+" : ""}${asset.changePercent.toFixed(2)}%`;

            changeText = `${amount} (${percent})`;
        }

        setText("assetPriceChange", changeText);

        setChangeStyle(
            $("assetPriceChange"),
            asset.changePercent ?? asset.change
        );

        setText(
            "assetPriceTimestamp",
            asset.timestamp
                ? `Last updated: ${formatDateTime(asset.timestamp)}`
                : "Price update time unavailable"
        );

        setText(
            "assetMarketStatus",
            asset.marketStatus
        );

        setText(
            "assetPreviousClose",
            formatCurrency(asset.previousClose)
        );

        setText(
            "assetOpenPrice",
            formatCurrency(asset.open)
        );

        setText(
            "assetDayHigh",
            formatCurrency(asset.high)
        );

        setText(
            "assetDayLow",
            formatCurrency(asset.low)
        );

        setText(
            "assetVolume",
            formatVolume(asset.volume)
        );

        setText(
            "assetMarketCap",
            asset.marketCap === null
                ? "—"
                : formatCurrency(asset.marketCap)
        );

        setText(
            "asset52WeekHigh",
            formatCurrency(asset.high52)
        );

        setText(
            "asset52WeekLow",
            formatCurrency(asset.low52)
        );

        setText("assetSector", asset.sector);
        setText("assetIndustry", asset.industry);

        setText(
            "assetEmployees",
            asset.employees === null
                ? "—"
                : formatNumber(asset.employees)
        );

        setText(
            "assetDescription",
            asset.description
        );

        renderCompanyWebsite(asset.website);

        updateSymbolLabels();
        updatePredictionLink();
        setupNewsLink();

        if (!asset.dataAvailable) {
            setMessage(
                "The provider returned limited information for this stock.",
                "info"
            );
        } else if (asset.currentPrice === null) {
            setMessage(
                "Stock information loaded, but the provider did not return a latest price.",
                "info"
            );
        }
    }

    function renderCompanyWebsite(value) {
        const link = $("assetWebsite");
        const unavailable = $("assetWebsiteUnavailable");

        if (!link || !unavailable) {
            return;
        }

        let parsedURL = null;

        if (value) {
            try {
                parsedURL = new URL(
                    /^https?:\/\//i.test(value)
                        ? value
                        : `https://${value}`
                );
            } catch {
                parsedURL = null;
            }
        }

        if (
            parsedURL &&
            ["http:", "https:"].includes(parsedURL.protocol)
        ) {
            link.href = parsedURL.href;
            link.hidden = false;
            unavailable.hidden = true;
        } else {
            link.removeAttribute("href");
            link.hidden = true;
            unavailable.hidden = false;
            unavailable.textContent = "Not available";
        }
    }

    /* ========================================================
       CHART PERIOD CONTROL
       ======================================================== */

    function setupChartPeriod() {
        const select = $("chartPeriodSelect");

        if (!select) {
            return;
        }

        state.chartPeriod = select.value || "3mo";

        select.addEventListener("change", () => {
            const period = select.value;

            if (!period || period === state.chartPeriod) {
                return;
            }

            state.chartPeriod = period;
            state.historyPage = 1;

            loadHistoricalData(period);
        });
    }

    /* ========================================================
       HISTORICAL DATA REQUEST

       Each new request cancels the previous request.
       This prevents a slow older request from blocking
       the newly selected chart period.
       ======================================================== */

    async function loadHistoricalData(period) {
        if (!state.symbol) {
            return;
        }

        if (state.chartController) {
            state.chartController.abort();
        }

        const controller = new AbortController();
        state.chartController = controller;

        const requestId = ++state.chartRequestId;
        const requestedSymbol = state.symbol;

        const encodedSymbol =
            encodeURIComponent(requestedSymbol);

        const encodedPeriod =
            encodeURIComponent(period);

        const container = $("stockChartContainer");

        if (container) {
            container.setAttribute("aria-busy", "true");
        }

        setText("chartAssetSymbol", requestedSymbol);
        setText("chartDataCount", "Loading…");
        setText("chartLatestClose", "—");

        renderEmptyChart("Loading historical price data…");

        try {
            const response = await fetchJSON(
                `${API}/stocks/${encodedSymbol}/chart?period=${encodedPeriod}`,
                {
                    signal: controller.signal
                }
            );

            // Ignore stale responses.
            if (
                requestId !== state.chartRequestId ||
                state.symbol !== requestedSymbol ||
                state.chartPeriod !== period
            ) {
                return;
            }

            const rows = extractHistory(response);

            if (!rows.length) {
                state.history = [];

                setText("chartDataCount", "No data");
                setText("chartLatestClose", "—");

                renderEmptyChart(
                    "No historical prices were returned for this period."
                );

                renderEmptyHistory(
                    "No historical records are available for this period."
                );

                setText(
                    "chartDataNote",
                    "Try another period or check again later. No prices have been fabricated."
                );

                return;
            }

            state.history = rows;
            state.historyPage = 1;

            renderChart(rows);
            renderHistoryTable();

            setText(
                "chartDataCount",
                formatNumber(rows.length)
            );

            const latest = rows[rows.length - 1];

            setText(
                "chartLatestClose",
                latest.close === null
                    ? "—"
                    : formatCurrency(latest.close)
            );

            setText(
                "chartDataNote",
                "Historical prices are supplied by the market-data provider. They may be delayed or incomplete. Past performance does not guarantee future results."
            );

        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }

            if (requestId !== state.chartRequestId) {
                return;
            }

            console.error(
                "Historical data request failed:",
                error
            );

            state.history = [];

            setText("chartDataCount", "Unavailable");
            setText("chartLatestClose", "—");

            renderEmptyChart(
                "Unable to retrieve historical data from the provider."
            );

            renderEmptyHistory(
                "Historical data could not be retrieved."
            );

            setText(
                "chartDataNote",
                "Please try another period or reload the page later."
            );

        } finally {
            if (requestId === state.chartRequestId) {
                if (container) {
                    container.setAttribute(
                        "aria-busy",
                        "false"
                    );
                }

                state.chartController = null;
            }
        }
    }

    /* ========================================================
       NORMALIZE HISTORICAL DATA
       ======================================================== */

    function extractHistory(response) {
        if (!response || typeof response !== "object") {
            return [];
        }

        let rows =
            response.history ??
            response.prices ??
            response.chart ??
            response.points ??
            response.records ??
            response.chart_data ??
            response.data ??
            response.results;

        if (
            rows &&
            !Array.isArray(rows) &&
            typeof rows === "object"
        ) {
            rows =
                rows.history ??
                rows.prices ??
                rows.chart ??
                rows.points ??
                rows.records ??
                rows.chart_data ??
                rows.data ??
                rows.results;
        }

        if (!Array.isArray(rows)) {
            return [];
        }

        return rows
            .map(normalizeHistoryRow)
            .filter((row) => (
                row &&
                row.date !== null &&
                row.close !== null
            ))
            .sort((a, b) => {
                const dateA = parseDate(a.date)?.getTime() || 0;
                const dateB = parseDate(b.date)?.getTime() || 0;

                return dateA - dateB;
            });
    }

    function normalizeHistoryRow(row) {
        if (!row) {
            return null;
        }

        if (Array.isArray(row)) {
            return {
                date: row[0],
                open: numberValue(row[1]),
                high: numberValue(row[2]),
                low: numberValue(row[3]),
                close: numberValue(row[4]),
                adjustedClose: numberValue(row[5]),
                volume: numberValue(row[6])
            };
        }

        if (typeof row !== "object") {
            return null;
        }

        return {
            date: firstValue(row, [
                "date",
                "datetime",
                "timestamp",
                "time",
                "Date"
            ]),

            open: numberValue(
                firstValue(row, [
                    "open",
                    "Open"
                ])
            ),

            high: numberValue(
                firstValue(row, [
                    "high",
                    "High"
                ])
            ),

            low: numberValue(
                firstValue(row, [
                    "low",
                    "Low"
                ])
            ),

            close: numberValue(
                firstValue(row, [
                    "close",
                    "Close",
                    "price",
                    "value"
                ])
            ),

            adjustedClose: numberValue(
                firstValue(row, [
                    "adj_close",
                    "adjClose",
                    "adjusted_close",
                    "adjustedClose",
                    "Adj Close"
                ])
            ),

            volume: numberValue(
                firstValue(row, [
                    "volume",
                    "Volume"
                ])
            )
        };
    }

    /* ========================================================
       CHART RENDERING
       ======================================================== */

    function renderChart(rows) {
        const empty = $("stockChartEmpty");
        const wrapper = $("stockChartCanvasWrapper");
        const canvas = $("stockPriceChart");

        if (!canvas || !wrapper) {
            renderEmptyChart(
                "The chart canvas is missing from the page template."
            );
            return;
        }

        if (typeof Chart === "undefined") {
            renderEmptyChart(
                "Chart.js could not be loaded. Check your internet connection."
            );
            return;
        }

        if (empty) {
            empty.hidden = true;
        }

        wrapper.hidden = false;

        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }

        const context = canvas.getContext("2d");

        if (!context) {
            renderEmptyChart(
                "Your browser could not render the price chart."
            );
            return;
        }

        const labels = rows.map((row) =>
            formatChartDate(row.date)
        );

        const prices = rows.map((row) => row.close);

        const gradient = context.createLinearGradient(
            0,
            0,
            0,
            360
        );

        gradient.addColorStop(
            0,
            "rgba(52, 211, 153, 0.24)"
        );

        gradient.addColorStop(
            1,
            "rgba(52, 211, 153, 0.01)"
        );

        state.chart = new Chart(context, {
            type: "line",

            data: {
                labels,

                datasets: [{
                    label: `${state.symbol} closing price`,
                    data: prices,
                    borderColor: "#34d399",
                    backgroundColor: gradient,
                    fill: true,
                    borderWidth: 2,
                    tension: 0.22,
                    pointRadius: rows.length > 100 ? 0 : 2,
                    pointHoverRadius: 5,
                    pointHitRadius: 8,
                    spanGaps: false
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                    intersect: false,
                    mode: "index"
                },

                plugins: {
                    legend: {
                        display: false
                    },

                    tooltip: {
                        callbacks: {
                            label(context) {
                                return (
                                    `Close: ${formatCurrency(context.parsed.y)}`
                                );
                            }
                        }
                    }
                },

                scales: {
                    x: {
                        grid: {
                            display: false
                        },

                        ticks: {
                            color: "#94a3b8",
                            maxTicksLimit: 7,
                            maxRotation: 0
                        },

                        border: {
                            display: false
                        }
                    },

                    y: {
                        grid: {
                            color: "rgba(148, 163, 184, 0.14)"
                        },

                        ticks: {
                            color: "#94a3b8",

                            callback(value) {
                                return compactCurrency(value);
                            }
                        },

                        border: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    function formatChartDate(value) {
        const date = parseDate(value);

        if (!date) {
            return String(value);
        }

        const shortPeriod = [
            "1d",
            "5d"
        ].includes(state.chartPeriod);

        return new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            ...(shortPeriod ? {} : { year: "2-digit" }),
            timeZone: "Asia/Kolkata"
        }).format(date);
    }

    function compactCurrency(value) {
        const number = numberValue(value);

        if (number === null) {
            return "—";
        }

        return `${getCurrency()} ${new Intl.NumberFormat("en-IN", {
            notation: "compact",
            maximumFractionDigits: 2
        }).format(number)}`;
    }

    function renderEmptyChart(message) {
        const empty = $("stockChartEmpty");
        const wrapper = $("stockChartCanvasWrapper");

        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }

        if (wrapper) {
            wrapper.hidden = true;
        }

        if (!empty) {
            return;
        }

        empty.hidden = false;
        empty.replaceChildren();

        const icon = document.createElement("div");
        icon.className = "chart-empty-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "↗";

        const heading = document.createElement("h3");
        heading.textContent = "Historical price chart";

        const paragraph = document.createElement("p");
        paragraph.textContent = message;

        empty.append(icon, heading, paragraph);
    }

    /* ========================================================
       HISTORY TABLE AND PAGINATION
       ======================================================== */

    function setupHistoryPagination() {
        const previous = $("stockHistoryPrevious");
        const next = $("stockHistoryNext");

        if (previous) {
            previous.addEventListener("click", () => {
                if (state.historyPage > 1) {
                    state.historyPage -= 1;
                    renderHistoryTable();
                }
            });
        }

        if (next) {
            next.addEventListener("click", () => {
                const totalPages = Math.max(
                    1,
                    Math.ceil(state.history.length / PAGE_SIZE)
                );

                if (state.historyPage < totalPages) {
                    state.historyPage += 1;
                    renderHistoryTable();
                }
            });
        }
    }

    function renderHistoryTable() {
        const tbody = $("stockHistoryTableBody");

        if (!tbody) {
            return;
        }

        if (!state.history.length) {
            renderEmptyHistory(
                "No historical records available."
            );
            return;
        }

        const totalPages = Math.max(
            1,
            Math.ceil(state.history.length / PAGE_SIZE)
        );

        state.historyPage = Math.min(
            Math.max(1, state.historyPage),
            totalPages
        );

        const start =
            (state.historyPage - 1) * PAGE_SIZE;

        const pageRows = state.history.slice(
            start,
            start + PAGE_SIZE
        );

        tbody.replaceChildren();

        pageRows
            .slice()
            .reverse()
            .forEach((row) => {
                const tr = document.createElement("tr");

                appendCell(tr, formatDate(row.date));
                appendCell(tr, formatCurrency(row.open));
                appendCell(tr, formatCurrency(row.high));
                appendCell(tr, formatCurrency(row.low));
                appendCell(tr, formatCurrency(row.close));

                appendCell(
                    tr,
                    row.adjustedClose === null
                        ? "—"
                        : formatCurrency(row.adjustedClose)
                );

                appendCell(
                    tr,
                    formatVolume(row.volume)
                );

                tbody.appendChild(tr);
            });

        setText(
            "stockHistorySummary",
            `Showing ${start + 1}–${Math.min(
                start + pageRows.length,
                state.history.length
            )} of ${formatNumber(state.history.length)} records`
        );

        setText(
            "stockHistoryPageNumber",
            `Page ${state.historyPage} of ${totalPages}`
        );

        const previous = $("stockHistoryPrevious");
        const next = $("stockHistoryNext");

        if (previous) {
            previous.disabled = state.historyPage <= 1;
        }

        if (next) {
            next.disabled = state.historyPage >= totalPages;
        }
    }

    function appendCell(row, value) {
        const cell = document.createElement("td");

        cell.textContent = value ?? "—";

        row.appendChild(cell);
    }

    function renderEmptyHistory(message) {
        const tbody = $("stockHistoryTableBody");

        if (!tbody) {
            return;
        }

        tbody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 7;
        cell.className = "stock-table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.appendChild(row);

        setText("stockHistorySummary", message);
        setText("stockHistoryPageNumber", "Page 1");

        const previous = $("stockHistoryPrevious");
        const next = $("stockHistoryNext");

        if (previous) {
            previous.disabled = true;
        }

        if (next) {
            next.disabled = true;
        }
    }

    /* ========================================================
       COMPANY WEBSITE
       ======================================================== */

    // Company profile fields are populated only when the API
    // supplies them. Missing information remains unavailable.

    /* ========================================================
       AI PREDICTION NAVIGATION
       ======================================================== */

    function setupPredictionButton() {
        const button = $("createPredictionButton");

        if (!button) {
            return;
        }

        button.addEventListener("click", (event) => {
            if (!state.symbol) {
                event.preventDefault();

                setMessage(
                    "Select a stock before opening AI Predictions.",
                    "error"
                );

                return;
            }

            updatePredictionLink();
        });
    }

    function updatePredictionLink() {
        const button = $("createPredictionButton");

        if (!button || !state.symbol) {
            return;
        }

        button.href =
            `/predictions?symbol=${encodeURIComponent(state.symbol)}`;
    }

    /* ========================================================
       RELATED NEWS
       ======================================================== */

    function setupNewsLink() {
        const link = $("viewAssetNewsLink");

        if (link && state.symbol) {
            link.href =
                `/news-sentiment?symbol=${encodeURIComponent(state.symbol)}`;
        }
    }

    async function loadRelatedNews() {
        const container = $("stockRelatedNewsContainer");

        if (!container || !state.symbol) {
            return;
        }

        const symbol = encodeURIComponent(state.symbol);

        const response = await fetchJSON(
            `${API}/news?symbol=${symbol}`
        );

        let articles =
            response.articles ??
            response.news ??
            response.results ??
            response.data ??
            [];

        if (
            articles &&
            !Array.isArray(articles) &&
            typeof articles === "object"
        ) {
            articles =
                articles.articles ??
                articles.news ??
                articles.results ??
                [];
        }

        if (!Array.isArray(articles) || !articles.length) {
            renderNewsUnavailable();
            return;
        }

        container.replaceChildren();

        articles.slice(0, 4).forEach((article) => {
            const card = document.createElement("article");

            card.className = "stock-related-news-item";

            const heading = document.createElement("h3");

            heading.textContent =
                article.title ||
                article.headline ||
                "Market update";

            card.appendChild(heading);

            const description =
                article.summary ||
                article.description ||
                "";

            if (description) {
                const paragraph =
                    document.createElement("p");

                paragraph.textContent = description;
                card.appendChild(paragraph);
            }

            const published =
                article.published_at ||
                article.publishedAt ||
                article.date;

            if (published) {
                const date =
                    document.createElement("small");

                date.textContent =
                    formatDateTime(published);

                card.appendChild(date);
            }

            const articleURL =
                article.url ||
                article.link;

            if (articleURL) {
                try {
                    const parsed = new URL(
                        articleURL,
                        window.location.origin
                    );

                    if (
                        ["http:", "https:"].includes(parsed.protocol)
                    ) {
                        const link =
                            document.createElement("a");

                        link.href = parsed.href;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.textContent = "Read article →";

                        card.appendChild(link);
                    }
                } catch {
                    // Ignore malformed article URLs.
                }
            }

            container.appendChild(card);
        });
    }

    function renderNewsUnavailable() {
        const container = $("stockRelatedNewsContainer");

        if (!container) {
            return;
        }

        container.replaceChildren();

        const message = document.createElement("p");

        message.className = "stock-results-empty";

        message.textContent =
            "Related news is currently unavailable. Please try again later.";

        container.appendChild(message);
    }

    /* ========================================================
       SIDEBAR AND MOBILE NAVIGATION
       ======================================================== */

    function setupNavigation() {
        const menuButton = $("mobileMenuButton");
        const sidebar = $("dashboardSidebar");
        const overlay = $("sidebarOverlay");

        function closeSidebar() {
            document.body.classList.remove("sidebar-open");

            if (sidebar) {
                sidebar.classList.remove("sidebar-open");
            }

            if (overlay) {
                overlay.hidden = true;
            }

            if (menuButton) {
                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        }

        function openSidebar() {
            document.body.classList.add("sidebar-open");

            if (sidebar) {
                sidebar.classList.add("sidebar-open");
            }

            if (overlay) {
                overlay.hidden = false;
            }

            if (menuButton) {
                menuButton.setAttribute(
                    "aria-expanded",
                    "true"
                );
            }
        }

        if (menuButton && sidebar) {
            menuButton.addEventListener("click", () => {
                const isOpen =
                    document.body.classList.contains("sidebar-open");

                if (isOpen) {
                    closeSidebar();
                } else {
                    openSidebar();
                }
            });
        }

        if (overlay) {
            overlay.addEventListener(
                "click",
                closeSidebar
            );
        }

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeSidebar();
            }
        });

        const logoutButton = $("logoutButton");

        if (logoutButton) {
            logoutButton.addEventListener(
                "click",
                handleLogout
            );
        }

        loadAccountSummary();
    }

    /* ========================================================
       ACCOUNT SUMMARY
       ======================================================== */

    async function loadAccountSummary() {
        try {
            const response = await fetchJSON(
                `${API}/dashboard`
            );

            const data =
                response.dashboard ||
                response.data ||
                response;

            const user =
                data.user ||
                data.account ||
                response.user ||
                {};

            const name = firstValue(user, [
                "name",
                "full_name",
                "fullName",
                "username",
                "user_name"
            ]) || "User";

            setText("topbarUserName", name);

            const avatar = $("topbarAvatar");

            if (avatar) {
                avatar.textContent =
                    String(name).trim().charAt(0).toUpperCase() || "U";
            }

            const alertCount = numberValue(
                firstValue(data, [
                    "active_alerts",
                    "activeAlerts",
                    "alert_count",
                    "alertCount"
                ])
            );

            const badge = $("sidebarAlertCount");

            if (badge && alertCount !== null) {
                badge.textContent = String(alertCount);
                badge.hidden = alertCount <= 0;
            }

        } catch (error) {
            console.warn(
                "Account summary could not be loaded:",
                error.message
            );
        }
    }

    /* ========================================================
       LOGOUT
       ======================================================== */

    async function handleLogout(event) {
        event.preventDefault();

        const button = $("logoutButton");

        if (button) {
            button.disabled = true;
        }

        try {
            await fetchJSON(
                `${API}/auth/logout`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({})
                }
            );

        } catch (error) {
            console.warn(
                "Logout request failed:",
                error.message
            );

        } finally {
            window.location.assign("/login");
        }
    }

})()