    "use strict";

    /* --------------------------------------------------------
       CONFIGURATION
    -------------------------------------------------------- */

    const CONFIG = {
        apiBase: "/api",

        endpoints: {
            search: "/stocks/search",
            stock: symbol => `/stocks/${encodeURIComponent(symbol)}`,
            chart: symbol => `/stocks/${encodeURIComponent(symbol)}/chart`,
            calculate: "/what-if/calculate",
            technicalPatterns: "/what-if/patterns/technical",
            similarity: "/what-if/patterns/similarity",
            scenarios: "/what-if/scenarios",
            scenario: id => `/what-if/scenarios/${encodeURIComponent(id)}`,
            report: "/what-if/report"
        },

        predictionStorageKey: "marketPlusAI.pendingWhatIfPrediction",

        quoteRefreshSeconds: 15,
        searchDebounceMs: 350,
        searchLimit: 10,
        defaultInvestment: 10000,
        defaultDuration: 7,
        defaultChartPeriod: "1y",
        defaultLookback: 365,
        defaultMatchCount: 5,

        requestTimeout: 30000
    };

    /* --------------------------------------------------------
       STATE
    -------------------------------------------------------- */

    const state = {
        symbol: "",
        companyName: "",
        currency: "INR",

        quote: null,
        chartPoints: [],

        prediction: null,
        calculation: null,

        technicalResults: [],
        similarityResults: [],

        scenarios: [],
        selectedScenario: null,

        quoteCountdown: CONFIG.quoteRefreshSeconds,
        quoteTimer: null,
        countdownTimer: null,
        searchTimer: null,

        searchSequence: 0,
        isSearching: false,
        isRefreshingQuote: false,
        isCalculating: false,
        isSaving: false,
        isLoadingHistory: false,
        isSearchingPatterns: false,
        isSearchingSimilarity: false,
        isExporting: false,

        lastQuoteError: null,
        currentLocale: "en-IN",

        chartResizeObserver: null
    };

    /* --------------------------------------------------------
       DOM ELEMENTS
    -------------------------------------------------------- */

    const $ = id => document.getElementById(id);

    const elements = {
        page: $("whatIfPage"),

        pageDate: $("whatIfPageDate"),
        avatar: $("topbarAvatar"),

        sidebar: $("appSidebar"),
        sidebarOverlay: $("sidebarOverlay"),
        mobileMenuButton: $("mobileMenuButton"),
        sidebarCloseButton: $("sidebarCloseButton"),

        message: $("whatIfMessage"),

        predictionSourceCard: $("predictionSourceCard"),
        sourcePredictionTitle: $("sourcePredictionTitle"),
        sourcePredictionDescription: $("sourcePredictionDescription"),
        sourcePredictionStatus: $("sourcePredictionStatus"),

        stockSearch: $("whatIfStockSearch"),
        searchLoading: $("whatIfSearchLoading"),
        stockSuggestions: $("whatIfStockSuggestions"),

        companyName: $("whatIfCompanyName"),
        selectedSymbol: $("whatIfSelectedSymbol"),
        currentPriceDisplay: $("whatIfCurrentPriceDisplay"),
        marketChange: $("whatIfMarketChange"),
        currency: $("whatIfCurrency"),
        quoteTimestamp: $("whatIfQuoteTimestamp"),
        refreshCountdown: $("whatIfRefreshCountdown"),
        refreshButton: $("refreshMarketPriceButton"),

        form: $("whatIfForm"),
        currentPrice: $("whatIfCurrentPrice"),
        currentCurrency: $("whatIfCurrentCurrency"),
        predictedPrice: $("whatIfPredictedPrice"),
        predictedCurrency: $("whatIfPredictedCurrency"),
        investmentAmount: $("whatIfInvestmentAmount"),
        investmentCurrency: $("whatIfInvestmentCurrency"),
        duration: $("whatIfDuration"),
        calculateButton: $("calculateWhatIfButton"),
        calculateButtonText: $("calculateWhatIfButtonText"),
        resetButton: $("resetWhatIfButton"),

        comparisonCurrentPrice: $("comparisonCurrentPrice"),
        comparisonPredictedPrice: $("comparisonAIPredictedPrice"),
        comparisonAdjustedPrice: $("comparisonAdjustedPrice"),
        comparisonAdjustedMovement: $("comparisonAdjustedMovement"),
        comparisonAdjustedMovementNote: $("comparisonAdjustedMovementNote"),

        resultsSection: $("whatIfResultsSection"),
        analysisStatus: $("scenarioAnalysisStatus"),

        optimisticFuturePrice: $("optimisticFuturePrice"),
        optimisticFinalValue: $("optimisticFinalValue"),
        optimisticProfitLoss: $("optimisticProfitLoss"),
        optimisticROI: $("optimisticROI"),

        neutralFuturePrice: $("neutralFuturePrice"),
        neutralFinalValue: $("neutralFinalValue"),
        neutralProfitLoss: $("neutralProfitLoss"),
        neutralROI: $("neutralROI"),

        pessimisticFuturePrice: $("pessimisticFuturePrice"),
        pessimisticFinalValue: $("pessimisticFinalValue"),
        pessimisticProfitLoss: $("pessimisticProfitLoss"),
        pessimisticROI: $("pessimisticROI"),

        bestScenario: $("bestScenarioValue"),
        worstScenario: $("worstScenarioValue"),
        quantity: $("whatIfQuantityValue"),

        chart: $("whatIfMarketChart"),
        chartPlaceholder: $("whatIfChartPlaceholder"),
        chartPeriod: $("whatIfChartPeriod"),
        chartStatus: $("whatIfChartDataStatus"),

        technicalButton: $("technicalPatternSearchButton"),
        similarityButton: $("historicalSimilaritySearchButton"),
        similarityLookback: $("similarityLookback"),
        similarityMatchCount: $("similarityMatchCount"),

        patternPanel: $("patternResultsPanel"),
        patternSubtitle: $("patternResultsSubtitle"),
        patternPlaceholder: $("patternResultsPlaceholder"),
        patternList: $("patternResultsList"),

        riskMeter: $("whatIfRiskMeter"),
        riskPointer: $("whatIfRiskPointer"),
        riskLevel: $("whatIfRiskLevel"),
        riskExplanation: $("whatIfRiskExplanation"),

        scenarioName: $("whatIfScenarioName"),
        saveButton: $("saveWhatIfScenarioButton"),
        refreshHistoryButton: $("refreshWhatIfHistoryButton"),
        historyList: $("whatIfScenarioHistory"),

        exportButton: $("exportWhatIfReportButton")
    };

    /* --------------------------------------------------------
       GENERAL HELPERS
    -------------------------------------------------------- */

    function hasElement(element) {
        return Boolean(element);
    }

    function setText(element, value) {
        if (element) {
            element.textContent =
                value === undefined || value === null ? "" : String(value);
        }
    }

    function show(element) {
        if (element) {
            element.hidden = false;
        }
    }

    function hide(element) {
        if (element) {
            element.hidden = true;
        }
    }

    function setDisabled(element, disabled) {
        if (element) {
            element.disabled = Boolean(disabled);
        }
    }

    function numberValue(value, fallback = null) {
        if (value === null || value === undefined || value === "") {
            return fallback;
        }

        const number = Number(
            String(value).replace(/,/g, "").replace(/[₹$€£]/g, "").trim()
        );

        return Number.isFinite(number) ? number : fallback;
    }

    function firstValue(object, keys, fallback = null) {
        if (!object || typeof object !== "object") {
            return fallback;
        }

        for (const key of keys) {
            const value = object[key];

            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }

        return fallback;
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[character]);
    }

    function safeJSONParse(value) {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    function getNestedObject(value) {
        let current = value;

        for (let index = 0; index < 5; index++) {
            if (!current || typeof current !== "object" || Array.isArray(current)) {
                break;
            }

            const nested = firstValue(
                current,
                ["data", "result", "payload", "response"],
                null
            );

            if (!nested || typeof nested !== "object") {
                break;
            }

            current = nested;
        }

        return current || {};
    }

    function extractArray(value, keys = []) {
        if (Array.isArray(value)) {
            return value;
        }

        if (!value || typeof value !== "object") {
            return [];
        }

        for (const key of keys) {
            if (Array.isArray(value[key])) {
                return value[key];
            }
        }

        for (const key of ["data", "result", "payload", "response"]) {
            const nested = value[key];

            if (Array.isArray(nested)) {
                return nested;
            }

            if (nested && typeof nested === "object") {
                const found = extractArray(nested, keys);

                if (found.length) {
                    return found;
                }
            }
        }

        return [];
    }

    function normalizeSymbol(value) {
        return String(value || "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, "");
    }

    function getCurrentLocale() {
        try {
            if (window.MarketPlusAI &&
                typeof window.MarketPlusAI.getLocale === "function") {
                return window.MarketPlusAI.getLocale() || "en-IN";
            }
        } catch (error) {
            console.warn("Unable to read application locale:", error);
        }

        return navigator.language || "en-IN";
    }

    function translate(key, fallback) {
        try {
            if (window.MarketPlusAI &&
                typeof window.MarketPlusAI.translate === "function") {
                return window.MarketPlusAI.translate(key, fallback || key);
            }
        } catch (error) {
            console.warn("Translation error:", error);
        }

        return fallback || key;
    }

    function formatMoney(value, currency = state.currency) {
        const amount = numberValue(value);

        if (amount === null) {
            return "--";
        }

        const locale = getCurrentLocale();

        try {
            return new Intl.NumberFormat(locale, {
                style: "currency",
                currency: currency || "INR",
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return `${currency || "INR"} ${amount.toFixed(2)}`;
        }
    }

    function formatNumber(value, maximumFractionDigits = 2) {
        const number = numberValue(value);

        if (number === null) {
            return "--";
        }

        try {
            return new Intl.NumberFormat(getCurrentLocale(), {
                maximumFractionDigits
            }).format(number);
        } catch {
            return number.toFixed(maximumFractionDigits);
        }
    }

    function formatPercent(value) {
        const number = numberValue(value);

        if (number === null) {
            return "--";
        }

        const sign = number > 0 ? "+" : "";

        return `${sign}${formatNumber(number, 2)}%`;
    }

    function formatDate(value) {
        if (!value) {
            return "--";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        try {
            return new Intl.DateTimeFormat(getCurrentLocale(), {
                dateStyle: "medium",
                timeStyle: "short"
            }).format(date);
        } catch {
            return date.toLocaleString();
        }
    }

    function showMessage(message, type = "info") {
        if (!elements.message) {
            return;
        }

        elements.message.textContent = message;
        elements.message.className = `page-message ${type}`;
        elements.message.setAttribute("role", type === "error" ? "alert" : "status");
        show(elements.message);
    }

    function clearMessage() {
        if (!elements.message) {
            return;
        }

        elements.message.textContent = "";
        hide(elements.message);
    }

    function setButtonLoading(button, loading, normalText, loadingText) {
        if (!button) {
            return;
        }

        button.disabled = Boolean(loading);
        button.setAttribute("aria-busy", loading ? "true" : "false");

        if (button === elements.calculateButton && elements.calculateButtonText) {
            setText(
                elements.calculateButtonText,
                loading ? loadingText : normalText
            );
        } else {
            button.textContent = loading ? loadingText : normalText;
        }
    }

    /* --------------------------------------------------------
       API HELPERS
    -------------------------------------------------------- */

    async function apiRequest(path, options = {}) {
        const url = path.startsWith("http")
            ? path
            : `${CONFIG.apiBase}${path}`;

        const controller = new AbortController();

        const timeout = window.setTimeout(
            () => controller.abort(),
            CONFIG.requestTimeout
        );

        const requestOptions = {
            method: options.method || "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {})
            },
            signal: controller.signal
        };

        if (options.body !== undefined) {
            requestOptions.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, requestOptions);

            const contentType = response.headers.get("content-type") || "";
            let payload;

            if (contentType.includes("application/json")) {
                payload = await response.json();
            } else {
                const text = await response.text();
                payload = text ? { message: text } : {};
            }

            if (!response.ok) {
                const errorMessage = firstValue(
                    payload,
                    ["message", "error", "detail", "description"],
                    `Request failed (${response.status})`
                );

                throw new Error(errorMessage);
            }

            if (payload && payload.success === false) {
                throw new Error(
                    firstValue(payload, ["message", "error"], "The request was unsuccessful.")
                );
            }

            return payload;

        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("The request timed out. Please try again.");
            }

            throw error;

        } finally {
            window.clearTimeout(timeout);
        }
    }

    function getAPIPath(endpoint) {
        return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    }

    /* --------------------------------------------------------
       PREDICTION PAGE DATA TRANSFER
    -------------------------------------------------------- */

    function readPredictionContext() {
        let storedPrediction = null;

        try {
            storedPrediction = safeJSONParse(
                sessionStorage.getItem(CONFIG.predictionStorageKey)
            );
        } catch (error) {
            console.warn("Unable to read prediction session:", error);
        }

        const params = new URLSearchParams(window.location.search);
        const hasPredictionQuery =
            params.get("source") === "predictions_page" ||
            params.get("source") === "prediction_page";

        // Prefer the complete session object, then fill any missing values
        // from the URL. This supports both the new and older transfer formats.
        const prediction =
            storedPrediction && typeof storedPrediction === "object"
                ? { ...storedPrediction }
                : {};

        const queryFields = {
            symbol: ["symbol", "ticker", "asset"],
            asset_name: ["asset_name", "company_name", "companyName"],
            current_price: ["current_price", "currentPrice"],
            predicted_price: ["predicted_price", "predictedPrice", "target_price"],
            currency: ["currency"],
            duration: ["duration", "horizon", "horizon_days"],
            model_name: ["model_name", "model", "modelName"],
            prediction_id: ["prediction_id", "predictionId"],
            change_percent: ["change_percent", "changePercent"],
            prediction_direction: ["prediction_direction", "direction"],
            source: ["source"]
        };

        Object.entries(queryFields).forEach(([field, aliases]) => {
            const existing = prediction[field];
            if (existing !== undefined && existing !== null && existing !== "") {
                return;
            }

            for (const alias of aliases) {
                const value = params.get(alias);
                if (value !== null && value !== "") {
                    prediction[field] = value;
                    break;
                }
            }
        });

        const symbol = normalizeSymbol(firstValue(
            prediction,
            ["symbol", "ticker", "asset", "stock_symbol", "asset_symbol"],
            ""
        ));

        const predictedPrice = numberValue(firstValue(
            prediction,
            [
                "predicted_price",
                "predictedPrice",
                "target_price",
                "targetPrice",
                "prediction",
                "forecast_price",
                "future_price"
            ],
            null
        ));

        const currentPrice = numberValue(firstValue(
            prediction,
            ["current_price", "currentPrice", "reference_price", "referencePrice"],
            null
        ));

        if (!symbol && predictedPrice === null) {
            return null;
        }

        const duration = numberValue(firstValue(
            prediction,
            ["duration", "horizon", "horizon_days", "horizonDays", "days", "prediction_days"],
            CONFIG.defaultDuration
        ), CONFIG.defaultDuration);

        const model = firstValue(
            prediction,
            ["model", "model_name", "modelName", "algorithm"],
            "AI Model"
        );

        const predictionId = firstValue(
            prediction,
            ["prediction_id", "predictionId", "history_id", "historyId", "id"],
            null
        );

        const assetName = firstValue(
            prediction,
            ["asset_name", "company_name", "companyName", "stock_name", "stockName", "name"],
            symbol
        );

        const currency = String(firstValue(
            prediction,
            ["currency", "currency_code", "currencyCode"],
            "INR"
        )).toUpperCase();

        const normalized = {
            ...prediction,
            symbol,
            asset_name: String(assetName || symbol),
            company_name: String(assetName || symbol),
            current_price: currentPrice,
            predicted_price: predictedPrice,
            currency,
            duration,
            horizon: duration,
            horizon_days: duration,
            model: String(model),
            model_name: String(model),
            prediction_id: predictionId,
            change_percent: numberValue(firstValue(
                prediction,
                ["change_percent", "changePercent", "expected_change_percent"],
                null
            )),
            prediction_direction: String(firstValue(
                prediction,
                ["prediction_direction", "direction", "trend"],
                ""
            )),
            source: String(firstValue(
                prediction,
                ["source"],
                hasPredictionQuery ? "predictions_page" : ""
            ))
        };

        // The URL now contains the complete transfer payload. Consuming the
        // session copy prevents an old prediction from being imported later
        // when the user opens What-If Market directly from the sidebar.
        if (hasPredictionQuery) {
            try {
                sessionStorage.removeItem(CONFIG.predictionStorageKey);
            } catch (error) {
                console.warn("Unable to clear imported prediction session:", error);
            }
        }

        return normalized;
    }

    function applyPredictionContext(prediction) {
        if (!prediction) {
            state.prediction = null;

            show(elements.predictionSourceCard);
            setText(elements.sourcePredictionTitle, "No prediction selected");
            setText(
                elements.sourcePredictionDescription,
                "Generate a prediction on the AI Predictions page. You can then open What-If Market to automatically transfer its stock and predicted price."
            );
            setText(elements.sourcePredictionStatus, "Waiting for prediction");

            return;
        }

        // Keep one consistent internal shape for calculations, history and PDF.
        state.prediction = {
            ...prediction,
            symbol: normalizeSymbol(prediction.symbol),
            predicted_price: numberValue(prediction.predicted_price),
            current_price: numberValue(prediction.current_price),
            duration: numberValue(prediction.duration, CONFIG.defaultDuration),
            model: prediction.model || prediction.model_name || "AI Model",
            model_name: prediction.model_name || prediction.model || "AI Model",
            prediction_id: prediction.prediction_id ?? null,
            currency: String(prediction.currency || "INR").toUpperCase()
        };

        state.currency = state.prediction.currency;
        state.companyName = prediction.asset_name || prediction.company_name || prediction.symbol;

        show(elements.predictionSourceCard);

        setText(
            elements.sourcePredictionTitle,
            `${state.companyName} (${state.prediction.symbol || "Asset"})`
        );

        const predictionDescription = [
            state.prediction.predicted_price !== null
                ? `AI predicted price: ${formatMoney(state.prediction.predicted_price, state.currency)}`
                : "Predicted price not provided",
            `Duration: ${state.prediction.duration} day(s)`,
            `Model: ${state.prediction.model || "AI Model"}`,
            state.prediction.prediction_id !== null
                ? `Prediction ID: ${state.prediction.prediction_id}`
                : ""
        ].filter(Boolean).join(" · ");

        setText(elements.sourcePredictionDescription, predictionDescription);
        setText(elements.sourcePredictionStatus, "Prediction imported successfully");

        if (elements.stockSearch && state.prediction.symbol) {
            elements.stockSearch.value = state.prediction.symbol;
        }

        if (elements.predictedPrice && state.prediction.predicted_price !== null) {
            elements.predictedPrice.value = state.prediction.predicted_price;
        }

        if (elements.currentPrice && state.prediction.current_price !== null) {
            // This is a fallback value. The live quote request below replaces
            // it when the stock service returns a newer market price.
            elements.currentPrice.value = state.prediction.current_price;
            delete elements.currentPrice.dataset.userEdited;
        }

        if (elements.duration && state.prediction.duration) {
            const duration = String(state.prediction.duration);

            if ([...elements.duration.options].some(option => option.value === duration)) {
                elements.duration.value = duration;
            }
        }

        setText(elements.currency, state.currency);
        setText(elements.currentCurrency, currencySymbol(state.currency));
        setText(elements.predictedCurrency, currencySymbol(state.currency));
        setText(elements.investmentCurrency, currencySymbol(state.currency));

        if (state.prediction.symbol) {
            selectStock(state.prediction.symbol, {
                preservePrediction: true,
                loadChart: true
            }).catch(error => {
                console.error("Unable to load imported prediction stock:", error);
                showMessage(
                    `Prediction was imported, but stock data could not be loaded: ${error.message}`,
                    "warning"
                );
            });
        }

        updateComparison();
    }

    /* --------------------------------------------------------
       STOCK SEARCH
    -------------------------------------------------------- */

    function normalizeStockResult(item) {    function normalizeStockResult(item) {
        const stock = getNestedObject(item);

        const symbol = normalizeSymbol(firstValue(
            stock,
            ["symbol", "ticker", "stock_symbol", "code"],
            ""
        ));

        const name = firstValue(
            stock,
            ["name", "company_name", "companyName", "longName", "shortName"],
            symbol
        );

        const price = numberValue(firstValue(
            stock,
            ["price", "last_price", "current_price", "regularMarketPrice"],
            null
        ));

        const changePercent = numberValue(firstValue(
            stock,
            ["change_percent", "changePercent", "percent_change", "regularMarketChangePercent"],
            null
        ));

        return {
            symbol,
            name: String(name || symbol),
            price,
            changePercent,
            currency: firstValue(stock, ["currency"], "INR")
        };
    }

    function renderStockSuggestions(items) {
        if (!elements.stockSuggestions) {
            return;
        }

        elements.stockSuggestions.replaceChildren();

        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "suggestion-empty";
            empty.textContent = "No matching stocks found.";
            elements.stockSuggestions.appendChild(empty);
            show(elements.stockSuggestions);
            return;
        }

        items.forEach(stock => {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "stock-suggestion-item";
            button.setAttribute("role", "option");

            const information = document.createElement("span");
            information.className = "suggestion-stock-information";

            const name = document.createElement("strong");
            name.textContent = stock.name;

            const symbol = document.createElement("small");
            symbol.textContent = stock.symbol;

            information.append(name, symbol);

            const price = document.createElement("span");
            price.className = "suggestion-stock-price";
            price.textContent = stock.price === null
                ? ""
                : formatMoney(stock.price, stock.currency);

            button.append(information, price);

            button.addEventListener("click", () => {
                hide(elements.stockSuggestions);

                if (elements.stockSearch) {
                    elements.stockSearch.value = stock.symbol;
                }

                selectStock(stock.symbol, {
                    preservePrediction: false,
                    loadChart: true
                }).catch(error => {
                    showMessage(error.message, "error");
                });
            });

            elements.stockSuggestions.appendChild(button);
        });

        show(elements.stockSuggestions);
    }

    async function searchStocks(query) {
        const searchTerm = String(query || "").trim();

        if (searchTerm.length < 1) {
            hide(elements.stockSuggestions);
            hide(elements.searchLoading);
            return;
        }

        const requestSequence = ++state.searchSequence;

        show(elements.searchLoading);

        try {
            const params = new URLSearchParams({
                q: searchTerm,
                limit: String(CONFIG.searchLimit)
            });

            const payload = await apiRequest(
                `${CONFIG.endpoints.search}?${params.toString()}`
            );

            if (requestSequence !== state.searchSequence) {
                return;
            }

            const root = getNestedObject(payload);

            const items = extractArray(root, [
                "stocks",
                "results",
                "items",
                "suggestions",
                "assets"
            ]);

            const normalized = items
                .map(normalizeStockResult)
                .filter(stock => stock.symbol);

            renderStockSuggestions(normalized);

        } catch (error) {
            if (requestSequence === state.searchSequence) {
                console.error("Stock search failed:", error);
                renderStockSuggestions([]);
            }
        } finally {
            if (requestSequence === state.searchSequence) {
                hide(elements.searchLoading);
            }
        }
    }

    function handleStockSearchInput() {
        const query = elements.stockSearch?.value || "";

        window.clearTimeout(state.searchTimer);

        if (!query.trim()) {
            state.searchSequence++;
            hide(elements.stockSuggestions);
            hide(elements.searchLoading);
            return;
        }

        state.searchTimer = window.setTimeout(
            () => searchStocks(query),
            CONFIG.searchDebounceMs
        );
    }

    /* --------------------------------------------------------
       QUOTE NORMALIZATION
    -------------------------------------------------------- */

    function normalizeQuote(payload, requestedSymbol = state.symbol) {
        const root = getNestedObject(payload);

        const quote = firstValue(
            root,
            ["quote", "stock", "details", "market_data", "marketData"],
            root
        );

        const object = quote && typeof quote === "object" ? quote : root;

        const price = numberValue(firstValue(
            object,
            [
                "last_price",
                "current_price",
                "price",
                "market_price",
                "regularMarketPrice",
                "close",
                "lastPrice",
                "ltp"
            ],
            null
        ));

        const previousClose = numberValue(firstValue(
            object,
            [
                "previous_close",
                "previousClose",
                "regularMarketPreviousClose",
                "prev_close"
            ],
            null
        ));

        let change = numberValue(firstValue(
            object,
            ["change", "price_change", "regularMarketChange"],
            null
        ));

        let changePercent = numberValue(firstValue(
            object,
            [
                "change_percent",
                "changePercent",
                "percent_change",
                "regularMarketChangePercent"
            ],
            null
        ));

        if (change === null && price !== null && previousClose !== null) {
            change = price - previousClose;
        }

        if (changePercent === null &&
            change !== null &&
            previousClose !== null &&
            previousClose !== 0) {
            changePercent = (change / previousClose) * 100;
        }

        return {
            symbol: normalizeSymbol(firstValue(
                object,
                ["symbol", "ticker", "stock_symbol"],
                requestedSymbol
            )),

            name: String(firstValue(
                object,
                ["name", "company_name", "companyName", "longName", "shortName"],
                requestedSymbol
            )),

            price,
            previousClose,
            change,
            changePercent,

            currency: String(firstValue(
                object,
                ["currency", "financial_currency"],
                "INR"
            )),

            timestamp: firstValue(
                object,
                [
                    "quote_timestamp",
                    "timestamp",
                    "last_updated",
                    "updated_at",
                    "regularMarketTime"
                ],
                null
            ),

            exchange: firstValue(
                object,
                ["exchange", "fullExchangeName", "market"],
                ""
            ),

            raw: object
        };
    }

    /* --------------------------------------------------------
       STOCK SELECTION AND QUOTE
    -------------------------------------------------------- */

    async function selectStock(symbol, options = {}) {
        const normalizedSymbol = normalizeSymbol(symbol);

        if (!normalizedSymbol) {
            throw new Error("Please select a valid stock symbol.");
        }

        const preservePrediction = options.preservePrediction === true;

        state.symbol = normalizedSymbol;
        state.quote = null;
        state.chartPoints = [];
        state.calculation = null;

        if (!preservePrediction) {
            state.prediction = null;

            if (elements.predictedPrice) {
                elements.predictedPrice.value = "";
            }

            setText(elements.sourcePredictionTitle, "No prediction selected");
            setText(
                elements.sourcePredictionDescription,
                "You selected a stock directly. Enter an AI predicted price if you want to compare it."
            );
            setText(elements.sourcePredictionStatus, "Manual stock selection");
        }

        setText(elements.companyName, normalizedSymbol);
        setText(elements.selectedSymbol, normalizedSymbol);
        setText(elements.currentPriceDisplay, "Loading...");
        setText(elements.marketChange, "Loading quote...");
        setText(elements.quoteTimestamp, "Loading...");
        setText(elements.quoteCountdown, `${CONFIG.quoteRefreshSeconds}s`);

        if (elements.currency) {
            setText(elements.currency, state.currency);
        }

        hide(elements.stockSuggestions);

        await refreshQuote({ silent: false });

        if (options.loadChart !== false) {
            await loadChart();
        }

        updateComparison();
        updateActionButtons();

        startQuoteRefresh();

        return state.quote;
    }

    async function refreshQuote(options = {}) {
        if (!state.symbol || state.isRefreshingQuote) {
            return;
        }

        state.isRefreshingQuote = true;

        if (elements.refreshButton) {
            elements.refreshButton.disabled = true;
            elements.refreshButton.textContent = "Refreshing...";
        }

        try {
            const payload = await apiRequest(
                CONFIG.endpoints.stock(state.symbol)
            );

            const quote = normalizeQuote(payload, state.symbol);

            if (quote.price === null || quote.price <= 0) {
                throw new Error("The server did not return a valid market price.");
            }

            state.quote = quote;
            state.companyName = quote.name;
            state.currency = quote.currency || "INR";
            state.lastQuoteError = null;

            renderQuote();
            updateComparison();

            if (elements.currentPrice &&
                !elements.currentPrice.dataset.userEdited) {
                elements.currentPrice.value = quote.price;
            }

            if (elements.currentPrice) {
                elements.currentPrice.dataset.lastQuote = String(quote.price);
            }

            if (!options.silent) {
                showMessage("Latest available market quote loaded.", "success");
            }

        } catch (error) {
            state.lastQuoteError = error.message;

            console.error("Quote refresh failed:", error);

            if (!options.silent) {
                showMessage(`Unable to load market quote: ${error.message}`, "error");
            }

        } finally {
            state.isRefreshingQuote = false;

            if (elements.refreshButton) {
                elements.refreshButton.disabled = false;
                elements.refreshButton.textContent = "↻ Refresh Market Price";
            }
        }
    }

    function renderQuote() {
        const quote = state.quote;

        if (!quote) {
            return;
        }

        setText(elements.companyName, quote.name);
        setText(elements.selectedSymbol, quote.symbol);
        setText(elements.currentPriceDisplay, formatMoney(quote.price));
        setText(elements.currency, quote.currency);

        setText(elements.currentCurrency, currencySymbol(quote.currency));
        setText(elements.predictedCurrency, currencySymbol(quote.currency));
        setText(elements.investmentCurrency, currencySymbol(quote.currency));

        setText(
            elements.marketChange,
            quote.changePercent === null
                ? "--"
                : `${formatMoney(quote.change, quote.currency)} (${formatPercent(quote.changePercent)})`
        );

        if (elements.marketChange) {
            elements.marketChange.classList.toggle(
                "positive",
                numberValue(quote.changePercent, 0) > 0
            );

            elements.marketChange.classList.toggle(
                "negative",
                numberValue(quote.changePercent, 0) < 0
            );
        }

        setText(
            elements.quoteTimestamp,
            quote.timestamp ? formatDate(quote.timestamp) : "Latest available quote"
        );
    }

    function currencySymbol(currency) {
        const symbols = {
            INR: "₹",
            USD: "$",
            EUR: "€",
            GBP: "£",
            JPY: "¥",
            CNY: "¥"
        };

        return symbols[currency] || `${currency || "INR"} `;
    }

    /* --------------------------------------------------------
       QUOTE REFRESH TIMER
    -------------------------------------------------------- */

    function stopQuoteRefresh() {
        if (state.quoteTimer) {
            window.clearInterval(state.quoteTimer);
            state.quoteTimer = null;
        }

        if (state.countdownTimer) {
            window.clearInterval(state.countdownTimer);
            state.countdownTimer = null;
        }
    }

    function startQuoteRefresh() {
        stopQuoteRefresh();

        state.quoteCountdown = CONFIG.quoteRefreshSeconds;

        state.countdownTimer = window.setInterval(() => {
            if (document.hidden) {
                return;
            }

            state.quoteCountdown = Math.max(0, state.quoteCountdown - 1);

            setText(elements.refreshCountdown, `${state.quoteCountdown}s`);

            if (state.quoteCountdown <= 0) {
                state.quoteCountdown = CONFIG.quoteRefreshSeconds;
            }
        }, 1000);

        state.quoteTimer = window.setInterval(() => {
            if (!document.hidden && state.symbol) {
                state.quoteCountdown = CONFIG.quoteRefreshSeconds;
                refreshQuote({ silent: true });
            }
        }, CONFIG.quoteRefreshSeconds * 1000);

        setText(elements.refreshCountdown, `${CONFIG.quoteRefreshSeconds}s`);
    }

    /* --------------------------------------------------------
       CHART DATA NORMALIZATION
    -------------------------------------------------------- */

    function normalizeChartPoint(item) {
        if (Array.isArray(item)) {
            return {
                date: item[0],
                close: numberValue(item[4] ?? item[1], null),
                open: numberValue(item[1], null),
                high: numberValue(item[2], null),
                low: numberValue(item[3], null),
                volume: numberValue(item[5], null)
            };
        }

        if (!item || typeof item !== "object") {
            return null;
        }

        return {
            date: firstValue(
                item,
                ["date", "datetime", "timestamp", "time", "Date"],
                null
            ),

            close: numberValue(firstValue(
                item,
                ["close", "Close", "price", "value", "last_price", "adjclose", "adj_close"],
                null
            ), null),

            open: numberValue(firstValue(item, ["open", "Open"], null)),
            high: numberValue(firstValue(item, ["high", "High"], null)),
            low: numberValue(firstValue(item, ["low", "Low"], null)),
            volume: numberValue(firstValue(item, ["volume", "Volume"], null))
        };
    }

    function normalizeChartPoints(payload) {
        const root = getNestedObject(payload);

        let rows = extractArray(root, [
            "points",
            "history",
            "rows",
            "prices",
            "candles",
            "ohlcv",
            "chart_data",
            "chartData"
        ]);

        if (!rows.length && Array.isArray(root.data)) {
            rows = root.data;
        }

        if (!rows.length && root.chart && typeof root.chart === "object") {
            rows = extractArray(root.chart, [
                "points",
                "history",
                "rows",
                "prices",
                "data"
            ]);
        }

        return rows
            .map(normalizeChartPoint)
            .filter(point =>
                point &&
                point.close !== null &&
                Number.isFinite(point.close)
            );
    }

    /* --------------------------------------------------------
       LOAD AND DRAW CHART
    -------------------------------------------------------- */

    async function loadChart() {
        if (!state.symbol) {
            return;
        }

        const period = elements.chartPeriod?.value || CONFIG.defaultChartPeriod;

        setText(elements.chartStatus, "Loading historical market data...");
        show(elements.chartPlaceholder);

        try {
            const params = new URLSearchParams({ period });            const payload = await apiRequest(
                `${CONFIG.endpoints.chart(state.symbol)}?${params.toString()}`
            );

            const points = normalizeChartPoints(payload);

            if (!points.length) {
                state.chartPoints = [];
                drawChart();
                setText(elements.chartStatus, "No historical chart data was returned.");
                setText(elements.chartPlaceholder.querySelector("p"), "No chart data is available for this stock and period.");
                show(elements.chartPlaceholder);
                return;
            }

            state.chartPoints = points;

            hide(elements.chartPlaceholder);
            setText(
                elements.chartStatus,
                `${points.length} historical data points loaded`
            );

            drawChart();

        } catch (error) {
            console.error("Chart loading failed:", error);

            state.chartPoints = [];
            drawChart();

            setText(elements.chartStatus, `Chart unavailable: ${error.message}`);
            show(elements.chartPlaceholder);
        }
    }

    function drawChart() {
        const canvas = elements.chart;

        if (!canvas) {
            return;
        }

        const context = canvas.getContext("2d");

        if (!context) {
            return;
        }

        const rect = canvas.getBoundingClientRect();

        const width = Math.max(320, rect.width || 700);
        const height = Math.max(220, rect.height || 320);
        const ratio = window.devicePixelRatio || 1;

        canvas.width = Math.floor(width * ratio);
        canvas.height = Math.floor(height * ratio);

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);

        const points = state.chartPoints;

        if (!points.length) {
            return;
        }

        const values = points.map(point => point.close);
        const predicted = numberValue(elements.predictedPrice?.value, null);
        const current = numberValue(elements.currentPrice?.value, null);

        const allValues = [...values];

        if (predicted !== null) {
            allValues.push(predicted);
        }

        if (current !== null) {
            allValues.push(current);
        }

        let minimum = Math.min(...allValues);
        let maximum = Math.max(...allValues);

        if (minimum === maximum) {
            minimum *= 0.98;
            maximum *= 1.02;
        }

        const range = maximum - minimum;
        const padding = {
            left: 62,
            right: 18,
            top: 24,
            bottom: 34
        };

        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const x = index =>
            padding.left + (index / Math.max(1, values.length - 1)) * chartWidth;

        const y = value =>
            padding.top + ((maximum - value) / range) * chartHeight;

        context.font = "11px Arial";
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillStyle = "#8b95a7";
        context.strokeStyle = "rgba(130, 145, 165, 0.18)";
        context.lineWidth = 1;

        for (let index = 0; index <= 4; index++) {
            const value = minimum + (range * index / 4);
            const position = y(value);

            context.beginPath();
            context.moveTo(padding.left, position);
            context.lineTo(width - padding.right, position);
            context.stroke();

            context.fillText(
                formatNumber(value, 2),
                padding.left - 8,
                position
            );
        }

        context.beginPath();

        values.forEach((value, index) => {
            const positionX = x(index);
            const positionY = y(value);

            if (index === 0) {
                context.moveTo(positionX, positionY);
            } else {
                context.lineTo(positionX, positionY);
            }
        });

        context.strokeStyle = "#4f8cff";
        context.lineWidth = 2.2;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.stroke();

        const gradient = context.createLinearGradient(
            0,
            padding.top,
            0,
            height - padding.bottom
        );

        gradient.addColorStop(0, "rgba(79, 140, 255, 0.24)");
        gradient.addColorStop(1, "rgba(79, 140, 255, 0.01)");

        context.lineTo(x(values.length - 1), height - padding.bottom);
        context.lineTo(x(0), height - padding.bottom);
        context.closePath();

        context.fillStyle = gradient;
        context.fill();

        drawReferenceLine(
            context,
            width,
            padding,
            chartWidth,
            y,
            current,
            "#16a085"
        );

        drawReferenceLine(
            context,
            width,
            padding,
            chartWidth,
            y,
            predicted,
            "#e6a23c"
        );

        if (points.length > 1) {
            context.fillStyle = "#8b95a7";
            context.textAlign = "center";
            context.textBaseline = "top";

            context.fillText(
                shortDate(points[0].date),
                padding.left,
                height - padding.bottom + 10
            );

            context.fillText(
                shortDate(points[points.length - 1].date),
                width - padding.right,
                height - padding.bottom + 10
            );
        }
    }

    function drawReferenceLine(context, width, padding, chartWidth, y, value, color) {
        if (value === null || value === undefined || !Number.isFinite(value)) {
            return;
        }

        const position = y(value);

        if (position < padding.top || position > padding.top + (context.canvas.clientHeight || 300)) {
            return;
        }

        context.save();
        context.setLineDash([5, 5]);
        context.strokeStyle = color;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(padding.left, position);
        context.lineTo(width - padding.right, position);
        context.stroke();
        context.restore();
    }

    function shortDate(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value).slice(0, 10);
        }

        return new Intl.DateTimeFormat(getCurrentLocale(), {
            month: "short",
            day: "numeric"
        }).format(date);
    }

    /* --------------------------------------------------------
       COMPARISON SECTION
    -------------------------------------------------------- */

    function updateComparison() {
        const current = numberValue(elements.currentPrice?.value, state.quote?.price ?? null);
        const predicted = numberValue(elements.predictedPrice?.value, state.prediction?.predicted_price ?? null);

        setText(
            elements.comparisonCurrentPrice,
            current === null ? "--" : formatMoney(current)
        );

        setText(
            elements.comparisonPredictedPrice,
            predicted === null ? "--" : formatMoney(predicted)
        );

        const adjusted = predicted !== null ? predicted : current;

        setText(
            elements.comparisonAdjustedPrice,
            adjusted === null ? "--" : formatMoney(adjusted)
        );

        if (current !== null && adjusted !== null && current !== 0) {
            const movement = ((adjusted - current) / current) * 100;

            setText(elements.comparisonAdjustedMovement, formatPercent(movement));
            setText(
                elements.comparisonAdjustedMovementNote,
                "Change from current price"
            );
        } else {
            setText(elements.comparisonAdjustedMovement, "--");
            setText(
                elements.comparisonAdjustedMovementNote,
                "Waiting for price values"
            );
        }

        if (state.chartPoints.length) {
            drawChart();
        }
    }

    /* --------------------------------------------------------
       CALCULATE WHAT-IF SCENARIOS
    -------------------------------------------------------- */

    function getCalculationInputs() {
        const currentPrice = numberValue(elements.currentPrice?.value);
        const predictedPrice = numberValue(elements.predictedPrice?.value);
        const investmentAmount = numberValue(elements.investmentAmount?.value);
        const duration = numberValue(elements.duration?.value, CONFIG.defaultDuration);

        if (!state.symbol) {
            throw new Error("Please search for and select a stock first.");
        }

        if (currentPrice === null || currentPrice <= 0) {
            throw new Error("Enter a valid current price.");
        }

        if (predictedPrice !== null && predictedPrice <= 0) {
            throw new Error("Predicted price must be greater than zero.");
        }

        if (investmentAmount === null || investmentAmount <= 0) {
            throw new Error("Enter a valid investment amount.");
        }

        return {
            symbol: state.symbol,
            current_price: currentPrice,
            entry_price: currentPrice,
            predicted_price: predictedPrice,
            investment_amount: investmentAmount,
            duration,
            prediction_id: state.prediction?.prediction_id || null,
            model: state.prediction?.model || null,
            currency: state.currency
        };
    }

    async function calculateWhatIf(event) {
        if (event) {
            event.preventDefault();
        }

        if (state.isCalculating) {
            return;
        }

        clearMessage();

        let inputs;

        try {
            inputs = getCalculationInputs();
        } catch (error) {
            showMessage(error.message, "error");
            return;
        }

        state.isCalculating = true;

        setButtonLoading(
            elements.calculateButton,
            true,
            "Calculate What-If Scenarios",
            "Calculating scenarios..."
        );

        try {
            const payload = await apiRequest(CONFIG.endpoints.calculate, {
                method: "POST",
                body: inputs
            });

            const result = normalizeCalculation(payload);

            if (!result.scenarios.length) {
                throw new Error(
                    "The server response did not contain scenario results. Check the What-If calculate API response."
                );
            }

            state.calculation = {
                inputs,
                result,
                raw: payload,
                createdAt: new Date().toISOString()
            };

            renderCalculation(result);
            updateComparison();
            updateActionButtons();

            show(elements.resultsSection);

            showMessage("What-If scenario analysis completed successfully.", "success");

        } catch (error) {
            console.error("What-If calculation failed:", error);
            showMessage(`Scenario calculation failed: ${error.message}`, "error");

        } finally {
            state.isCalculating = false;

            setButtonLoading(
                elements.calculateButton,
                false,
                "Calculate What-If Scenarios",
                "Calculating scenarios..."
            );
        }
    }

    /* --------------------------------------------------------
       NORMALIZE CALCULATION RESPONSE
    -------------------------------------------------------- */

    function normalizeCalculation(payload) {
        const root = getNestedObject(payload);

        let rawScenarios = firstValue(
            root,
            ["scenarios", "scenario_results", "results", "outcomes"],
            null
        );

        if (!rawScenarios && payload && payload.scenarios) {
            rawScenarios = payload.scenarios;
        }

        const scenarios = [];

        if (Array.isArray(rawScenarios)) {
            rawScenarios.forEach((item, index) => {
                const scenario = normalizeScenario(item, index);
                if (scenario) {
                    scenarios.push(scenario);
                }
            });
        } else if (rawScenarios && typeof rawScenarios === "object") {
            Object.entries(rawScenarios).forEach(([name, item], index) => {
                const scenario = normalizeScenario(
                    { ...(item || {}), name: firstValue(item, ["name", "scenario"], name) },
                    index,
                    name
                );

                if (scenario) {
                    scenarios.push(scenario);
                }
            });
        }

        const quantity = numberValue(firstValue(
            root,
            ["quantity", "shares", "estimated_quantity", "units"],
            null
        ));

        const best = firstValue(
            root,
            ["best_scenario", "bestScenario", "best"],
            null
        );

        const worst = firstValue(
            root,
            ["worst_scenario", "worstScenario", "worst"],
            null
        );

        return {
            symbol: firstValue(root, ["symbol", "ticker"], state.symbol),
            currentPrice: numberValue(firstValue(
                root,
                ["current_price", "entry_price", "market_price"],
                null
            )),
            predictedPrice: numberValue(firstValue(
                root,
                ["predicted_price", "ai_predicted_price", "target_price"],
                null
            )),
            quantity,
            best,
            worst,
            scenarios,
            risk: firstValue(root, ["risk", "risk_analysis", "risk_assessment"], null),
            disclaimer: firstValue(root, ["disclaimer"], ""),
            raw: root
        };
    }

    function normalizeScenario(item, index, fallbackName = "") {
        if (!item || typeof item !== "object") {
            return null;
        }

        const name = String(firstValue(
            item,
            ["name", "scenario", "type", "label"],
            fallbackName || ["optimistic", "neutral", "pessimistic"][index] || `scenario_${index + 1}`
        )).toLowerCase();

        const futurePrice = numberValue(firstValue(
            item,
            [
                "future_price",
                "estimated_price",
                "predicted_price",
                "price",
                "target_price",
                "scenario_price"
            ],
            null
        ));

        const finalValue = numberValue(firstValue(
            item,
            [
                "final_value",
                "ending_value",
                "market_value",
                "investment_value",
                "future_value"
            ],
            null
        ));

        const profitLoss = numberValue(firstValue(
            item,
            ["profit_loss", "pnl", "profit", "loss", "gain"],
            null
        ));

        const roi = numberValue(firstValue(
            item,
            ["roi", "return_percentage", "return_percent", "percentage_return"],
            null
        ));

        return {
            name,
            futurePrice,
            finalValue,
            profitLoss,
            roi,
            raw: item
        };
    }

    function scenarioType(name) {
        const value = String(name || "").toLowerCase().replace(/[\s-]+/g, "_");

        if (value.includes("optimistic") || value.includes("bull")) {
            return "optimistic";
        }

        if (value.includes("pessimistic") || value.includes("bear")) {
            return "pessimistic";
        }

        if (value.includes("neutral") || value.includes("stable")) {
            return "neutral";
        }

        return value;
    }

    function findScenario(result, type) {
        return result.scenarios.find(item => scenarioType(item.name) === type) || null;
    }

    /* --------------------------------------------------------
       RENDER SCENARIO RESULTS
    -------------------------------------------------------- */

    function renderCalculation(result) {
        const optimistic = findScenario(result, "optimistic");
        const neutral = findScenario(result, "neutral");
        const pessimistic = findScenario(result, "pessimistic");

        renderScenario("optimistic", optimistic);
        renderScenario("neutral", neutral);
        renderScenario("pessimistic", pessimistic);

        const ranked = [...result.scenarios]
            .filter(item => item.roi !== null)
            .sort((a, b) => b.roi - a.roi);

        setText(
            elements.bestScenario,
            ranked.length ? `${ranked[0].name} (${formatPercent(ranked[0].roi)})` : "--"
        );

        setText(
            elements.worstScenario,
            ranked.length ? `${ranked[ranked.length - 1].name} (${formatPercent(ranked[ranked.length - 1].roi)})` : "--"
        );

        const quantity = result.quantity ??
            (state.calculation?.inputs.investment_amount /
                state.calculation?.inputs.current_price);

        setText(
            elements.quantity,
            quantity === null || quantity === undefined
                ? "--"
                : formatNumber(quantity, 6)
        );

        setText(elements.analysisStatus, "Analysis completed");

        renderRiskAnalysis(result);
        updateComparison();
    }

    function renderScenario(type, scenario) {
        const fields = {
            optimistic: {
                future: elements.optimisticFuturePrice,
                final: elements.optimisticFinalValue,
                pnl: elements.optimisticProfitLoss,
                roi: elements.optimisticROI
            },
            neutral: {
                future: elements.neutralFuturePrice,
                final: elements.neutralFinalValue,
                pnl: elements.neutralProfitLoss,
                roi: elements.neutralROI
            },
            pessimistic: {
                future: elements.pessimisticFuturePrice,
                final: elements.pessimisticFinalValue,
                pnl: elements.pessimisticProfitLoss,
                roi: elements.pessimisticROI
            }
        };

        const target = fields[type];

        if (!target) {
            return;
        }

        if (!scenario) {
            setText(target.future, "--");
            setText(target.final, "--");
            setText(target.pnl, "--");
            setText(target.roi, "--");
            return;
        }

        setText(
            target.future,
            scenario.futurePrice === null ? "--" : formatMoney(scenario.futurePrice)
        );

        setText(
            target.final,
            scenario.finalValue === null ? "--" : formatMoney(scenario.finalValue)
        );

        setText(
            target.pnl,
            scenario.profitLoss === null ? "--" : formatMoney(scenario.profitLoss)
        );

        setText(
            target.roi,
            scenario.roi === null ? "--" : formatPercent(scenario.roi)
        );

        if (target.pnl) {
            target.pnl.classList.toggle("positive", numberValue(scenario.profitLoss, 0) > 0);
            target.pnl.classList.toggle("negative", numberValue(scenario.profitLoss, 0) < 0);
        }
    }        setText(
            target.pnl,
            scenario.profitLoss === null ? "--" : formatMoney(scenario.profitLoss)
        );

        setText(
            target.roi,
            scenario.roi === null ? "--" : formatPercent(scenario.roi)
        );

        if (target.pnl) {
            target.pnl.classList.toggle(
                "positive",
                numberValue(scenario.profitLoss, 0) > 0
            );

            target.pnl.classList.toggle(
                "negative",
                numberValue(scenario.profitLoss, 0) < 0
            );
        }
    }

    /* --------------------------------------------------------
       RISK ANALYSIS
    -------------------------------------------------------- */

    function renderRiskAnalysis(result) {
        const risk = result.risk;

        let score = numberValue(firstValue(
            risk,
            ["score", "risk_score", "value", "percentage"],
            null
        ));

        let level = firstValue(
            risk,
            ["level", "risk_level", "category"],
            null
        );

        let explanation = firstValue(
            risk,
            ["explanation", "description", "message", "reason"],
            null
        );

        if (score === null) {
            const optimistic = findScenario(result, "optimistic");
            const pessimistic = findScenario(result, "pessimistic");

            const spread = optimistic?.roi !== null && pessimistic?.roi !== null
                ? Math.abs(optimistic.roi - pessimistic.roi)
                : 30;

            score = Math.min(100, Math.max(5, spread * 1.5));
        }

        score = Math.min(100, Math.max(0, score));

        if (!level) {
            if (score < 30) {
                level = "Low";
            } else if (score < 65) {
                level = "Moderate";
            } else {
                level = "High";
            }
        }

        if (!explanation) {
            explanation =
                `The estimated risk indicator is ${level.toLowerCase()}. ` +
                "This is a simplified scenario-based measure, not a prediction " +
                "of the probability of loss. Market volatility and unexpected " +
                "events can produce different outcomes.";
        }

        setText(elements.riskLevel, `${level} Risk`);
        setText(elements.riskExplanation, explanation);

        if (elements.riskPointer) {
            elements.riskPointer.style.left = `${score}%`;
        }

        if (elements.riskMeter) {
            elements.riskMeter.setAttribute("aria-valuenow", String(Math.round(score)));
            elements.riskMeter.setAttribute("role", "meter");
            elements.riskMeter.setAttribute("aria-valuemin", "0");
            elements.riskMeter.setAttribute("aria-valuemax", "100");
        }
    }

    /* --------------------------------------------------------
       TECHNICAL PATTERN DETECTION
    -------------------------------------------------------- */

    async function searchTechnicalPatterns() {
        if (!state.symbol) {
            showMessage("Select a stock before running technical pattern detection.", "warning");
            return;
        }

        if (state.isSearchingPatterns) {
            return;
        }

        state.isSearchingPatterns = true;
        setButtonLoading(
            elements.technicalButton,
            true,
            "Detect Technical Patterns",
            "Detecting patterns..."
        );

        try {
            const payload = await apiRequest(CONFIG.endpoints.technicalPatterns, {
                method: "POST",
                body: {
                    symbol: state.symbol,
                    period: elements.chartPeriod?.value || CONFIG.defaultChartPeriod,
                    lookback_days: numberValue(
                        elements.similarityLookback?.value,
                        CONFIG.defaultLookback
                    )
                }
            });

            const root = getNestedObject(payload);

            const patterns = extractArray(root, [
                "patterns",
                "results",
                "detections",
                "matches",
                "technical_patterns"
            ]);

            state.technicalResults = patterns;

            renderPatternResults(patterns, "technical");

            if (!patterns.length) {
                showMessage(
                    "Technical pattern search completed. No matching patterns were returned.",
                    "info"
                );
            } else {
                showMessage(
                    `${patterns.length} technical pattern result(s) found.`,
                    "success"
                );
            }

        } catch (error) {
            console.error("Technical pattern search failed:", error);
            showMessage(`Technical pattern search failed: ${error.message}`, "error");

        } finally {
            state.isSearchingPatterns = false;

            setButtonLoading(
                elements.technicalButton,
                false,
                "Detect Technical Patterns",
                "Detecting patterns..."
            );
        }
    }

    /* --------------------------------------------------------
       HISTORICAL SIMILARITY SEARCH
    -------------------------------------------------------- */

    async function searchHistoricalSimilarities() {
        if (!state.symbol) {
            showMessage("Select a stock before searching historical similarities.", "warning");
            return;
        }

        if (state.isSearchingSimilarity) {
            return;
        }

        state.isSearchingSimilarity = true;

        setButtonLoading(
            elements.similarityButton,
            true,
            "Search Historical Similarities",
            "Searching history..."
        );

        try {
            const lookback = numberValue(
                elements.similarityLookback?.value,
                CONFIG.defaultLookback
            );

            const matchCount = numberValue(
                elements.similarityMatchCount?.value,
                CONFIG.defaultMatchCount
            );

            const payload = await apiRequest(CONFIG.endpoints.similarity, {
                method: "POST",
                body: {
                    symbol: state.symbol,
                    lookback_days: lookback,
                    lookback,
                    match_count: matchCount,
                    limit: matchCount
                }
            });

            const root = getNestedObject(payload);

            const results = extractArray(root, [
                "matches",
                "similarities",
                "results",
                "patterns",
                "historical_matches"
            ]);

            state.similarityResults = results;

            renderPatternResults(results, "similarity");

            if (!results.length) {
                showMessage(
                    "Historical similarity search completed. No matching periods were returned.",
                    "info"
                );
            } else {
                showMessage(
                    `${results.length} historical similarity result(s) found.`,
                    "success"
                );
            }

        } catch (error) {
            console.error("Historical similarity search failed:", error);
            showMessage(`Historical similarity search failed: ${error.message}`, "error");

        } finally {
            state.isSearchingSimilarity = false;

            setButtonLoading(
                elements.similarityButton,
                false,
                "Search Historical Similarities",
                "Searching history..."
            );
        }
    }

    /* --------------------------------------------------------
       PATTERN RESULTS DISPLAY
    -------------------------------------------------------- */

    function renderPatternResults(items, type) {
        if (!elements.patternList) {
            return;
        }

        elements.patternList.replaceChildren();

        const title = type === "technical"
            ? "Technical Pattern Detection"
            : "Historical Price Similarities";

        setText(
            elements.patternSubtitle,
            `${title} · ${items.length} result(s)`
        );

        if (!items.length) {
            show(elements.patternPlaceholder);
            setText(
                elements.patternPlaceholder.querySelector("p"),
                "No matching results were found for the selected stock."
            );
            return;
        }

        hide(elements.patternPlaceholder);

        items.forEach((item, index) => {
            const card = document.createElement("article");
            card.className = "pattern-result-card";

            const heading = document.createElement("div");
            heading.className = "pattern-result-heading";

            const name = document.createElement("strong");
            name.textContent = String(firstValue(
                item,
                ["name", "pattern", "pattern_name", "title", "type"],
                type === "technical" ? `Pattern ${index + 1}` : `Historical match ${index + 1}`
            ));

            const confidence = numberValue(firstValue(
                item,
                ["confidence", "confidence_score", "similarity", "similarity_score", "match_percentage"],
                null
            ));

            const score = document.createElement("span");
            score.className = "pattern-confidence";
            score.textContent = confidence === null
                ? "Score unavailable"
                : `${formatNumber(confidence, 2)}${confidence <= 1 ? "" : "%"} confidence`;

            heading.append(name, score);

            const description = document.createElement("p");
            description.textContent = String(firstValue(
                item,
                ["description", "summary", "explanation", "details"],
                "No additional description was provided."
            ));

            const metadata = document.createElement("div");
            metadata.className = "pattern-result-metadata";

            const start = firstValue(
                item,
                ["start_date", "date", "from_date", "period_start"],
                null
            );

            const end = firstValue(
                item,
                ["end_date", "to_date", "period_end"],
                null
            );

            const movement = numberValue(firstValue(
                item,
                ["price_change_percent", "change_percent", "return_percent", "movement"],
                null
            ));

            const details = [];

            if (start) {
                details.push(`Start: ${formatDate(start)}`);
            }

            if (end) {
                details.push(`End: ${formatDate(end)}`);
            }

            if (movement !== null) {
                details.push(`Movement: ${formatPercent(movement)}`);
            }

            metadata.textContent = details.join(" · ");

            card.append(heading, description);

            if (details.length) {
                card.appendChild(metadata);
            }

            elements.patternList.appendChild(card);
        });
    }

    /* --------------------------------------------------------
       SAVE SCENARIO
    -------------------------------------------------------- */

    async function saveScenario() {
        if (!state.calculation) {
            showMessage("Calculate a scenario before saving it.", "warning");
            return;
        }

        if (state.isSaving) {
            return;
        }

        const name = String(elements.scenarioName?.value || "").trim();

        if (!name) {
            showMessage("Enter a name for this scenario before saving.", "warning");
            elements.scenarioName?.focus();
            return;
        }

        state.isSaving = true;

        setButtonLoading(
            elements.saveButton,
            true,
            "Save Scenario",
            "Saving..."
        );

        try {
            const body = {
                name,
                scenario_name: name,
                symbol: state.symbol,
                inputs: state.calculation.inputs,
                input: state.calculation.inputs,
                result: state.calculation.result,
                calculation: state.calculation.result,
                prediction_id: state.prediction?.prediction_id || null
            };

            await apiRequest(CONFIG.endpoints.scenarios, {
                method: "POST",
                body
            });

            showMessage("Scenario saved successfully.", "success");

            if (elements.scenarioName) {
                elements.scenarioName.value = "";
            }

            await loadScenarioHistory();

        } catch (error) {
            console.error("Save scenario failed:", error);
            showMessage(`Unable to save scenario: ${error.message}`, "error");

        } finally {
            state.isSaving = false;

            setButtonLoading(
                elements.saveButton,
                false,
                "Save Scenario",
                "Saving..."
            );

            updateActionButtons();
        }
    }

    /* --------------------------------------------------------
       SCENARIO HISTORY
    -------------------------------------------------------- */

    function normalizeHistoryItem(item) {
        const root = getNestedObject(item);

        return {
            id: firstValue(
                root,
                ["id", "scenario_id", "scenarioId", "record_id"],
                null
            ),

            name: firstValue(
                root,
                ["name", "scenario_name", "title"],
                "Saved scenario"
            ),

            symbol: normalizeSymbol(firstValue(
                root,
                ["symbol", "ticker"],
                ""
            )),

            createdAt: firstValue(
                root,
                ["created_at", "createdAt", "timestamp", "date"],
                null
            ),

            raw: root
        };
    }

    async function loadScenarioHistory() {
        if (state.isLoadingHistory) {
            return;
        }

        state.isLoadingHistory = true;

        setButtonLoading(
            elements.refreshHistoryButton,
            true,
            "↻ Refresh History",
            "Loading..."
        );

        try {
            const payload = await apiRequest(CONFIG.endpoints.scenarios);
            const root = getNestedObject(payload);

            const items = extractArray(root, [
                "scenarios",
                "history",
                "results",
                "items",
                "records"
            ]);

            state.scenarios = items.map(normalizeHistoryItem);
            renderScenarioHistory();

        } catch (error) {
            console.error("Scenario history loading failed:", error);

            if (!state.scenarios.length) {
                renderHistoryEmpty("Unable to load saved scenarios.");
            }

        } finally {
            state.isLoadingHistory = false;

            setButtonLoading(
                elements.refreshHistoryButton,
                false,
                "↻ Refresh History",
                "Loading..."
            );
        }
    }

    function renderHistoryEmpty(message) {
        if (!elements.historyList) {
            return;
        }

        elements.historyList.replaceChildren();

        const empty = document.createElement("div");
        empty.className = "history-empty-state";

        const icon = document.createElement("span");
        icon.textContent = "◷";

        const text = document.createElement("p");
        text.textContent = message;

        empty.append(icon, text);
        elements.historyList.appendChild(empty);
    }

    function renderScenarioHistory() {
        if (!elements.historyList) {
            return;
        }

        elements.historyList.replaceChildren();

        if (!state.scenarios.length) {
            renderHistoryEmpty("No saved scenarios available.");
            return;
        }

        state.scenarios.forEach(item => {
            const card = document.createElement("article");
            card.className = "scenario-history-item";

            const details = document.createElement("div");
            details.className = "scenario-history-details";

            const name = document.createElement("strong");
            name.textContent = item.name;

            const metadata = document.createElement("small");
            metadata.textContent = [
                item.symbol || "Unknown asset",
                item.createdAt ? formatDate(item.createdAt) : ""
            ].filter(Boolean).join(" · ");

            details.append(name, metadata);
            card.appendChild(details);

            const actions = document.createElement("div");
            actions.className = "scenario-history-actions";

            if (item.id !== null && item.id !== undefined) {
                const viewButton = document.createElement("button");
                viewButton.type = "button";
                viewButton.className = "secondary-button";
                viewButton.textContent = "View";

                viewButton.addEventListener("click", () => {
                    loadSavedScenario(item.id);
                });

                const deleteButton = document.createElement("button");
                deleteButton.type = "button";
                deleteButton.className = "danger-button";
                deleteButton.textContent = "Delete";

                deleteButton.addEventListener("click", () => {
                    deleteSavedScenario(item.id);
                });

                actions.append(viewButton, deleteButton);
            }

            card.appendChild(actions);
            elements.historyList.appendChild(card);
        });
    }