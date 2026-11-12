
"use strict";

document.addEventListener("DOMContentLoaded", () => {

    // =========================================================
    // DOM ELEMENTS
    // =========================================================

    const form = document.getElementById("predictionForm");
    const symbolInput = document.getElementById("predictionSymbol");
    const durationInput = document.getElementById("predictionDuration");
    const modelInput = document.getElementById("predictionModel");

    const suggestionsContainer = document.getElementById("predictionStockSuggestions");
    const searchLoading = document.getElementById("predictionSearchLoading");

    const submitButton = document.getElementById("runPredictionButton");
    const submitButtonText = document.getElementById("runPredictionButtonText");

    const pageMessage = document.getElementById("predictionPageMessage");
    const pageDate = document.getElementById("predictionPageDate");

    const placeholder = document.getElementById("predictionPlaceholder");
    const resultContent = document.getElementById("predictionResultContent");
    const resultSubtitle = document.getElementById("predictionResultSubtitle");
    const statusBadge = document.getElementById("predictionStatusBadge");

    const predictedPriceValue = document.getElementById("predictedPriceValue");
    const currentPriceValue = document.getElementById("predictionCurrentPrice");
    const changeValue = document.getElementById("predictionChangeValue");
    const trendIndicator = document.getElementById("predictionTrendIndicator");

    const horizonValue = document.getElementById("predictionHorizonValue");
    const confidenceValue = document.getElementById("predictionConfidenceValue");
    const confidenceNote = document.getElementById("predictionConfidenceNote");

    const recommendationValue = document.getElementById("predictionRecommendationValue");
    const recommendationExplanation = document.getElementById("predictionRecommendationExplanation");
    const explanationList = document.getElementById("predictionExplanationList");
    const savedNote = document.getElementById("predictionSavedNote");

    const logoutButton = document.getElementById("logoutButton");
    const menuButton = document.getElementById("mobileMenuButton");
    const sidebar = document.getElementById("appSidebar");
    const sidebarOverlay = document.getElementById("sidebarOverlay");
    const avatar = document.getElementById("topbarAvatar");

    const investmentContainer = document.getElementById("predictionInvestmentContainer");
    const investButton = document.getElementById("investFromPredictionButton");

    const pageRoot = document.getElementById("predictionsPage");

    // =========================================================
    // CONFIGURATION
    // =========================================================

    const API_ENDPOINTS = [
        "/api/prediction",
        "/api/predict",
        "/api/predictions"
    ];

    const STOCK_SEARCH_ENDPOINT = "/api/stocks/search";

    const SUPPORTED_MODELS = [
        "Random Forest",
        "Linear Regression",
        "LSTM + Transformer"
    ];

    const SUPPORTED_DURATIONS = [1, 7, 30];

    const DEFAULT_MODEL = "Random Forest";

    const WHAT_IF_STORAGE_KEY =
        "marketPlusAI.pendingWhatIfPrediction";

    const WHAT_IF_BUTTON_ID =
        "openWhatIfFromPredictionButton";

    // =========================================================
    // APPLICATION STATE
    // =========================================================

    let isSubmitting = false;
    let latestPrediction = null;
    let authenticatedAccount = null;

    let searchTimer = null;
    let searchController = null;
    let searchResults = [];
    let activeSuggestionIndex = -1;
    let selectedStock = null;
    let searchRequestNumber = 0;

    // =========================================================
    // MESSAGE AND STATUS
    // =========================================================

    function setMessage(message, type = "info") {

        if (!pageMessage) return;

        pageMessage.textContent = message;
        pageMessage.hidden = !message;
        pageMessage.className = "prediction-page-message";

        if (type === "error") {
            pageMessage.classList.add("message-error");
        } else if (type === "success") {
            pageMessage.classList.add("message-success");
        }
    }

    function setStatus(message, type = "") {

        if (!statusBadge) return;

        statusBadge.textContent = message;
        statusBadge.className = "result-status";

        if (type) {
            statusBadge.classList.add(`status-${type}`);
        }
    }

    function setLoading(loading) {

        isSubmitting = loading;

        if (submitButton) {
            submitButton.disabled = loading;
            submitButton.setAttribute("aria-busy", String(loading));
        }

        if (submitButtonText) {
            submitButtonText.textContent = loading
                ? "Generating prediction..."
                : "Generate AI Prediction";
        }

        if (loading) {
            hideWhatIfButton();
            setStatus("ANALYSING", "loading");

            setMessage(
                "Requesting market data and generating your prediction. This may take a little time."
            );
        }
    }

    // =========================================================
    // GENERAL HELPERS
    // =========================================================

    function safeNumber(value) {

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

    function firstValue(objects, keys) {

        for (const object of objects) {

            if (!object || typeof object !== "object") {
                continue;
            }

            for (const key of keys) {

                if (
                    Object.prototype.hasOwnProperty.call(object, key) &&
                    object[key] !== null &&
                    object[key] !== undefined &&
                    object[key] !== ""
                ) {
                    return object[key];
                }
            }
        }

        return null;
    }

    function formatCurrency(value, currency = "INR") {

        const number = safeNumber(value);

        if (number === null) {
            return "Not available";
        }

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(number);

        } catch {
            return `${currency} ${number.toFixed(2)}`;
        }
    }

    function formatPercent(value) {

        const number = safeNumber(value);

        if (number === null) {
            return "Not available";
        }

        const prefix = number > 0 ? "+" : "";

        return `${prefix}${number.toFixed(2)}%`;
    }

    function getDurationLabel(days) {

        const numericDays = Number(days);

        const labels = {
            1: "1 day",
            7: "7 days",
            30: "30 days (about 1 month)"
        };

        return labels[numericDays] || `${numericDays} days`;
    }

    function getSelectedModel() {

        const selected = modelInput
            ? String(modelInput.value || "").trim()
            : DEFAULT_MODEL;

        return SUPPORTED_MODELS.includes(selected)
            ? selected
            : DEFAULT_MODEL;
    }

    function extractResponseMessage(data, fallback) {

        if (!data || typeof data !== "object") {
            return fallback;
        }

        if (typeof data.message === "string" && data.message.trim()) {
            return data.message;
        }

        if (
            data.error &&
            typeof data.error.message === "string" &&
            data.error.message.trim()
        ) {
            return data.error.message;
        }

        if (typeof data.detail === "string" && data.detail.trim()) {
            return data.detail;
        }

        if (typeof data.error === "string" && data.error.trim()) {
            return data.error;
        }

        return fallback;
    }

    async function readResponse(response) {

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            return response.json();
        }

        const text = await response.text();

        return {
            success: false,
            message: text.trim()
                ? text.trim().slice(0, 300)
                : `The server returned HTTP ${response.status}.`
        };
    }

    async function apiRequest(url, options = {}) {

        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {})
            }
        });

        if (response.status === 401) {

            setMessage(
                "Your login session has expired. Please log in again.",
                "error"
            );

            window.location.assign("/login");

            throw new Error("Authentication required.");
        }

        const data = await readResponse(response);

        return { response, data };
    }

    // =========================================================
    // STOCK AUTOCOMPLETE
    // =========================================================

    function normalizeStockResults(data) {

        let items = [];

        if (Array.isArray(data)) {
            items = data;

        } else if (data && typeof data === "object") {

            const wrappers = [
                data.results,
                data.stocks,
                data.assets,
                data.items,
                data.matches,
                data.quotes,
                data.data
            ];

            for (const wrapper of wrappers) {

                if (Array.isArray(wrapper)) {
                    items = wrapper;
                    break;
                }

                if (wrapper && typeof wrapper === "object") {

                    for (const key of [
                        "results",
                        "stocks",
                        "assets",
                        "items",
                        "matches",
                        "quotes"
                    ]) {
                        if (Array.isArray(wrapper[key])) {
                            items = wrapper[key];
                            break;
                        }
                    }

                    if (items.length) break;
                }
            }
        }

        const normalized = items.map(item => {

            if (!item || typeof item !== "object") {
                return null;
            }

            const symbol = firstValue([item], [
                "symbol",
                "ticker",
                "stock_symbol",
                "stockSymbol"
            ]);

            const name = firstValue([item], [
                "name",
                "company_name",
                "companyName",
                "longname",
                "longName",
                "shortname",
                "shortName",
                "display_name",
                "displayName"
            ]);

            if (!symbol || !name) return null;

            const exchange = firstValue([item], [
                "exchange",
                "exchange_name",
                "exchangeName",
                "market"
            ]);

            return {
                symbol: String(symbol).trim().toUpperCase(),
                name: String(name).trim(),
                exchange: exchange ? String(exchange).trim() : ""
            };

        }).filter(Boolean);

        const unique = new Map();

        normalized.forEach(stock => {
            if (!unique.has(stock.symbol)) {
                unique.set(stock.symbol, stock);
            }
        });

        return Array.from(unique.values());
    }

    function closeStockSuggestions() {

        if (!suggestionsContainer) return;

        suggestionsContainer.hidden = true;
        suggestionsContainer.replaceChildren();

        activeSuggestionIndex = -1;

        symbolInput?.setAttribute("aria-expanded", "false");
        symbolInput?.removeAttribute("aria-activedescendant");
    }

    function setStockSearchLoading(loading) {

        if (searchLoading) {
            searchLoading.hidden = !loading;
        }
    }

    function highlightActiveSuggestion() {

        if (!suggestionsContainer) return;

        const options = suggestionsContainer.querySelectorAll(
            ".stock-suggestion-option"
        );

        options.forEach((option, index) => {

            const active = index === activeSuggestionIndex;

            option.classList.toggle("active", active);
            option.setAttribute("aria-selected", String(active));
        });

        const activeOption = options[activeSuggestionIndex];

        if (activeOption) {

            symbolInput?.setAttribute(
                "aria-activedescendant",
                activeOption.id
            );

            activeOption.scrollIntoView({ block: "nearest" });

        } else {
            symbolInput?.removeAttribute("aria-activedescendant");
        }
    }

    function renderStockSuggestions(stocks) {

        if (!suggestionsContainer) return;

        suggestionsContainer.replaceChildren();

        searchResults = stocks;
        activeSuggestionIndex = -1;

        if (!stocks.length) {

            const empty = document.createElement("div");
            empty.className = "stock-suggestions-empty";
            empty.textContent = "No matching stock found.";

            suggestionsContainer.appendChild(empty);
            suggestionsContainer.hidden = false;

            symbolInput?.setAttribute("aria-expanded", "true");

            return;
        }

        stocks.forEach((stock, index) => {

            const option = document.createElement("button");

            option.type = "button";
            option.id = `prediction-stock-option-${index}`;
            option.className = "stock-suggestion-option";
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");
            option.dataset.index = String(index);

            const information = document.createElement("span");
            information.className = "stock-suggestion-information";

            const name = document.createElement("strong");
            name.className = "stock-suggestion-name";
            name.textContent = stock.name;

            const details = document.createElement("small");
            details.className = "stock-suggestion-details";
            details.textContent = [
                stock.symbol,
                stock.exchange
            ].filter(Boolean).join(" · ");

            information.append(name, details);

            const arrow = document.createElement("span");
            arrow.className = "stock-suggestion-arrow";
            arrow.textContent = "→";
            arrow.setAttribute("aria-hidden", "true");

            option.append(information, arrow);

            option.addEventListener("click", () => {
                selectStock(stock);
            });

            suggestionsContainer.appendChild(option);
        });

        suggestionsContainer.hidden = false;
        symbolInput?.setAttribute("aria-expanded", "true");
    }

    function selectStock(stock) {

        if (!stock || !symbolInput) return;

        selectedStock = stock;
        symbolInput.value = stock.symbol;

        closeStockSuggestions();

        setMessage(
            `${stock.name} (${stock.symbol}) selected successfully.`,
            "success"
        );

        symbolInput.dispatchEvent(
            new Event("change", { bubbles: true })
        );
    }

    async function searchStocks(query, options = {}) {

        const searchTerm = String(query || "").trim();

        if (!searchTerm) {
            closeStockSuggestions();
            setStockSearchLoading(false);
            return [];
        }

        if (searchController) {
            searchController.abort();
        }

        searchController = new AbortController();

        const controller = searchController;
        const requestNumber = ++searchRequestNumber;

        if (options.showLoading !== false) {
            setStockSearchLoading(true);
        }

        try {

            const response = await fetch(
                `${STOCK_SEARCH_ENDPOINT}?q=${encodeURIComponent(searchTerm)}`,
                {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { Accept: "application/json" },
                    signal: controller.signal
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Stock search failed with HTTP ${response.status}.`
                );
            }

            const data = await response.json();

            if (requestNumber !== searchRequestNumber) {
                return [];
            }

            if (
                data.success === false ||
                data.status === "error"
            ) {
                throw new Error(
                    extractResponseMessage(
                        data,
                        "Unable to search for stocks."
                    )
                );
            }

            const stocks = normalizeStockResults(data);

            if (options.render !== false) {
                renderStockSuggestions(stocks);
            }

            return stocks;

        } catch (error) {

            if (error.name === "AbortError") {
                return [];
            }

            console.error(
                "[Market Plus AI] Stock autocomplete error:",
                error
            );

            if (requestNumber === searchRequestNumber) {

                if (options.render !== false) {
                    renderStockSuggestions([]);
                }

                if (options.showError) {
                    setMessage(
                        "Unable to search stocks right now. Please try again.",
                        "error"
                    );
                }
            }

            return [];

        } finally {

            if (requestNumber === searchRequestNumber) {
                setStockSearchLoading(false);
            }
        }
    }

    function handleStockInput() {

        const query = symbolInput.value.trim();

        selectedStock = null;

        if (searchTimer) clearTimeout(searchTimer);
        if (searchController) searchController.abort();

        if (!query) {
            closeStockSuggestions();
            setStockSearchLoading(false);
            return;
        }

        searchTimer = setTimeout(() => {
            searchStocks(query);
        }, 300);
    }

    function handleStockKeyboard(event) {

        if (!suggestionsContainer || suggestionsContainer.hidden) {
            return;
        }

        const options = suggestionsContainer.querySelectorAll(
            ".stock-suggestion-option"
        );

        if (!options.length) return;

        if (event.key === "ArrowDown") {

            event.preventDefault();

            activeSuggestionIndex =
                (activeSuggestionIndex + 1) % options.length;

            highlightActiveSuggestion();

        } else if (event.key === "ArrowUp") {

            event.preventDefault();

            activeSuggestionIndex =
                activeSuggestionIndex <= 0
                    ? options.length - 1
                    : activeSuggestionIndex - 1;

            highlightActiveSuggestion();

        } else if (event.key === "Enter") {

            if (activeSuggestionIndex >= 0) {

                event.preventDefault();

                selectStock(searchResults[activeSuggestionIndex]);

            } else if (searchResults.length === 1) {

                event.preventDefault();
                selectStock(searchResults[0]);
            }

        } else if (event.key === "Escape") {
            closeStockSuggestions();
        }
    }

    // =========================================================
    // AUTHENTICATION
    // =========================================================

    function getUserObject(data) {

        if (!data || typeof data !== "object") return {};

        if (data.user && typeof data.user === "object") {
            return data.user;
        }

        if (data.account && typeof data.account === "object") {
            return data.account;
        }

        if (data.data && typeof data.data === "object") {

            if (data.data.user && typeof data.data.user === "object") {
                return data.data.user;
            }

            return data.data;
        }

        return data;
    }

    async function getAuthenticatedUserIdentifier() {

        const { response, data } = await apiRequest(
            "/api/auth/me",
            { method: "GET" }
        );

        if (!response.ok || data.success === false) {
            throw new Error(
                extractResponseMessage(
                    data,
                    "Could not identify your account. Please log in again."
                )
            );
        }

        const user = getUserObject(data);

        const identifier = firstValue([user], [
            "user_identifier",
            "user_id",
            "userId",
            "id",
            "email",
            "user_email"
        ]);

        if (
            identifier === null ||
            String(identifier).trim() === ""
        ) {
            throw new Error(
                "Your account details were not returned by /api/auth/me."
            );
        }

        if (avatar) {

            const displayName = firstValue([user], [
                "name",
                "full_name",
                "fullName",
                "username"
            ]);

            if (displayName) {

                avatar.textContent = String(displayName)
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map(part => part.charAt(0).toUpperCase())
                    .join("");

            } else {

                avatar.textContent = String(identifier)
                    .charAt(0)
                    .toUpperCase();
            }
        }

        authenticatedAccount = {
            identifier: String(identifier),
            user
        };

        return authenticatedAccount;
    }

    // =========================================================
    // PREDICTION RESPONSE NORMALIZATION
    // =========================================================

    function normalizePredictionResponse(data) {

        if (!data || typeof data !== "object") {
            throw new Error(
                "The prediction server returned an invalid response."
            );
        }

        const predictionBlock =
            data.prediction && typeof data.prediction === "object"
                ? data.prediction
                : {};

        const assetBlock =
            data.asset && typeof data.asset === "object"
                ? data.asset
                : {};

        const modelBlock =
            data.model && typeof data.model === "object"
                ? data.model
                : {};

        const confidenceBlock =
            data.confidence && typeof data.confidence === "object"
                ? data.confidence
                : {};

        const historyBlock =
            data.history && typeof data.history === "object"
                ? data.history
                : {};

        const objects = [
            predictionBlock,
            data,
            assetBlock,
            modelBlock
        ];

        const predictedRaw = firstValue(objects, [
            "predicted_price",
            "predictedPrice",
            "future_price",
            "futurePrice",
            "forecast_price",
            "forecastPrice",
            "prediction_price",
            "predictionPrice",
            "estimated_price",
            "estimatedPrice",
            "price_prediction",
            "price"
        ]);

        const currentRaw = firstValue(objects, [
            "current_price",
            "currentPrice",
            "reference_price",
            "referencePrice",
            "latest_price",
            "latestPrice",
            "last_close",
            "lastClose",
            "close_price",
            "closePrice"
        ]);

        const predictedPrice = safeNumber(predictedRaw);
        const currentPrice = safeNumber(currentRaw);

        if (predictedPrice === null || predictedPrice <= 0) {

            const status = String(data.status || "").toLowerCase();

            if (
                data.success === false ||
                status === "error" ||
                data.error
            ) {
                throw new Error(
                    extractResponseMessage(
                        data,
                        "The prediction service could not generate a forecast."
                    )
                );
            }

            throw new Error(
                "The API did not return a valid predicted price."
            );
        }

        let changePercent = safeNumber(
            firstValue(objects, [
                "change_percent",
                "changePercent",
                "expected_change_percent",
                "expectedChangePercent",
                "percent_change",
                "percentChange",
                "return_percent",
                "returnPercent",
                "predicted_return_percent",
                "predictedReturnPercent"
            ])
        );

        if (
            changePercent === null &&
            currentPrice !== null &&
            currentPrice > 0
        ) {
            changePercent =
                ((predictedPrice - currentPrice) / currentPrice) * 100;
        }

        let confidence = firstValue(
            [confidenceBlock, predictionBlock, data, modelBlock],
            [
                "confidence_percent",
                "confidencePercent",
                "confidence",
                "confidence_score",
                "confidenceScore",
                "reliability_percent",
                "reliabilityPercent",
                "reliability"
            ]
        );

        if (confidence && typeof confidence === "object") {
            confidence = firstValue([confidence], [
                "value",
                "score",
                "percent",
                "percentage"
            ]);
        }

        let confidenceNumber = safeNumber(confidence);

        if (confidenceNumber !== null) {

            if (confidenceNumber > 0 && confidenceNumber <= 1) {
                confidenceNumber *= 100;
            }

            confidenceNumber = Math.max(
                0,
                Math.min(100, confidenceNumber)
            );
        }

        const currencyValue = firstValue(
            [assetBlock, predictionBlock, data],
            ["currency", "currency_code", "currencyCode"]
        );

        const directionRaw = firstValue(
            [predictionBlock, data, modelBlock],
            ["direction", "trend", "signal", "recommendation", "indication"]
        );

        const explanationRaw = firstValue(
            [predictionBlock, data, modelBlock],
            [
                "explanation",
                "reasoning",
                "summary",
                "analysis",
                "recommendation_explanation",
                "recommendationExplanation",
                "nutty_text"
            ]
        );

        const factorsRaw = firstValue(
            [predictionBlock, data, modelBlock],
            [
                "factors",
                "reasons",
                "explanations",
                "key_factors",
                "keyFactors",
                "feature_importance",
                "featureImportance"
            ]
        );

        const historyRaw = firstValue(
            [data, historyBlock],
            [
                "history",
                "saved_prediction",
                "savedPrediction"
            ]
        );

        const savedRaw = firstValue(
            [data, predictionBlock],
            ["saved", "history_saved", "historySaved"]
        );

        const returnedModel = firstValue(
            [modelBlock, predictionBlock, data],
            [
                "model_name",
                "modelName",
                "model",
                "algorithm",
                "algorithm_name",
                "algorithmName"
            ]
        );

        // Prediction ID is passed to What-If when the backend provides it.
        const predictionId = firstValue(
            [historyBlock, data, predictionBlock],
            [
                "prediction_id",
                "predictionId",
                "history_id",
                "historyId",
                "id"
            ]
        );

        const assetName = firstValue(
            [assetBlock, predictionBlock, data],
            [
                "asset_name",
                "company_name",
                "companyName",
                "stock_name",
                "stockName",
                "name"
            ]
        );

        return {
            symbol: String(
                firstValue(
                    [assetBlock, predictionBlock, data],
                    [
                        "symbol",
                        "ticker",
                        "asset_symbol",
                        "assetSymbol"
                    ]
                ) ||
                selectedStock?.symbol ||
                symbolInput.value.trim().toUpperCase()
            ),

            assetName: String(
                assetName ||
                selectedStock?.name ||
                selectedStock?.symbol ||
                symbolInput.value.trim()
            ),

            predictedPrice,
            currentPrice,
            changePercent,
            confidence: confidenceNumber,

            currency: currencyValue
                ? String(currencyValue).toUpperCase()
                : "INR",

            direction: directionRaw ? String(directionRaw) : "",
            explanation: explanationRaw,
            factors: factorsRaw,

            horizon: firstValue(
                [predictionBlock, data],
                [
                    "horizon_days",
                    "horizonDays",
                    "horizon",
                    "duration_days",
                    "durationDays"
                ]
            ),

            modelName: returnedModel
                ? String(
                    typeof returnedModel === "object"
                        ? firstValue([returnedModel], ["name", "model_name", "algorithm"])
                        : returnedModel
                )
                : getSelectedModel(),

            predictionId: predictionId,
            saved: savedRaw,
            history: historyRaw,
            raw: data
        };
    }

    // =========================================================
    // WHAT-IF MARKET INTEGRATION
    // =========================================================

    function getWhatIfUrl() {

        // Prefer the Flask-generated URL supplied by the HTML.
        if (pageRoot?.dataset.whatIfUrl) {
            return pageRoot.dataset.whatIfUrl;
        }

        // Fallback route. The HTML data attribute above is recommended.
        return "/what-if-market";
    }

    function hideWhatIfButton() {

        const existingButton = document.getElementById(WHAT_IF_BUTTON_ID);

        if (existingButton) {
            existingButton.hidden = true;
        }
    }

    function buildWhatIfContext(result, requestedDays) {

        const context = {
            symbol: String(result.symbol || "").toUpperCase(),
            asset_name: result.assetName || result.symbol,
            company_name: result.assetName || result.symbol,

            current_price: result.currentPrice,
            predicted_price: result.predictedPrice,

            currency: result.currency || "INR",

            duration: Number(requestedDays),
            horizon: Number(requestedDays),
            horizon_days: Number(requestedDays),

            model_name: result.modelName || getSelectedModel(),

            prediction_id:
                result.predictionId !== null &&
                result.predictionId !== undefined
                    ? result.predictionId
                    : null,

            change_percent: result.changePercent,

            prediction_direction: result.direction || "",

            created_at: new Date().toISOString(),

            source: "predictions_page"
        };

        return context;
    }

    function navigateToWhatIf(context) {

        try {

            // Save the complete object for the What-If page.
            sessionStorage.setItem(
                WHAT_IF_STORAGE_KEY,
                JSON.stringify(context)
            );

            // Also provide query parameters as a secondary transfer method.
            const params = new URLSearchParams();

            params.set("symbol", context.symbol);
            params.set("asset_name", context.asset_name);

            if (context.current_price !== null) {
                params.set(
                    "current_price",
                    String(context.current_price)
                );
            }

            params.set(
                "predicted_price",
                String(context.predicted_price)
            );

            params.set("currency", context.currency);
            params.set("duration", String(context.duration));
            params.set("horizon", String(context.horizon));
            params.set("model_name", context.model_name);

            if (context.prediction_id !== null) {
                params.set(
                    "prediction_id",
                    String(context.prediction_id)
                );
            }

            params.set("source", "predictions_page");

            const destination = getWhatIfUrl();

            window.location.assign(
                `${destination}?${params.toString()}`
            );

        } catch (error) {

            console.error(
                "[Market Plus AI] Could not transfer prediction to What-If:",
                error
            );

            setMessage(
                "Unable to open What-If Market. Please try again.",
                "error"
            );
        }
    }

    function createWhatIfButton(result, requestedDays) {

        if (!resultContent) {
            console.error(
                "[Market Plus AI] Prediction result container was not found."
            );
            return;
        }

        let button = document.getElementById(WHAT_IF_BUTTON_ID);

        if (!button) {

            button = document.createElement("button");

            button.id = WHAT_IF_BUTTON_ID;
            button.type = "button";
            button.className = "what-if-action-button";

            button.innerHTML = `
                <span class="what-if-button-icon" aria-hidden="true">✦</span>
                <span class="what-if-button-text">
                    Explore What-If Market
                </span>
                <span class="what-if-button-arrow" aria-hidden="true">→</span>
            `;

            button.style.display = "flex";
            button.style.alignItems = "center";
            button.style.justifyContent = "center";
            button.style.gap = "12px";
            button.style.width = "100%";
            button.style.marginTop = "18px";
            button.style.padding = "15px 20px";
            button.style.border = "1px solid rgba(99, 102, 241, 0.45)";
            button.style.borderRadius = "12px";
            button.style.background =
                "linear-gradient(135deg, #4f46e5, #7c3aed)";
            button.style.color = "#ffffff";
            button.style.fontWeight = "700";
            button.style.fontSize = "14px";
            button.style.cursor = "pointer";
            button.style.boxShadow =
                "0 8px 24px rgba(79, 70, 229, 0.20)";

            resultContent.appendChild(button);
        }

        button.hidden = false;
        button.disabled = false;

        // Always replace the click handler with the newest result.
        button.onclick = () => {

            if (!latestPrediction) {
                setMessage(
                    "Generate a prediction before opening What-If Market.",
                    "error"
                );
                return;
            }

            const context = buildWhatIfContext(
                result,
                requestedDays
            );

            navigateToWhatIf(context);
        };
    }

    function initializeWhatIfSidebarLink() {

        const navigation = document.querySelector(".sidebar-navigation");

        if (!navigation) return;

        if (
            navigation.querySelector(
                '[data-marketplus-nav="what-if"]'
            )
        ) {
            return;
        }

        const link = document.createElement("a");

        link.className = "sidebar-link";
        link.href = getWhatIfUrl();
        link.dataset.marketplusNav = "what-if";

        link.innerHTML = `
            <span class="sidebar-link-icon" aria-hidden="true">✦</span>
            <span>What-If Market</span>
        `;

        const predictionLink = navigation.querySelector(
            'a[href*="predictions"]'
        );

        if (predictionLink && predictionLink.nextElementSibling) {
            predictionLink.after(link);
        } else {
            navigation.appendChild(link);
        }
    }

    // =========================================================
    // INVESTMENT BUTTON
    // =========================================================

    function updateInvestmentButton(result) {

        if (!investmentContainer || !investButton) {
            console.error(
                "[Market Plus AI] Investment button elements were not found."
            );
            return;
        }

        const raw = result.raw || {};

        const predictionBlock =
            raw.prediction && typeof raw.prediction === "object"
                ? raw.prediction
                : {};

        const assetBlock =
            raw.asset && typeof raw.asset === "object"
                ? raw.asset
                : {};

        const assetName = firstValue(
            [assetBlock, predictionBlock, raw],
            [
                "asset_name",
                "company_name",
                "companyName",
                "stock_name",
                "stockName"
            ]
        ) || selectedStock?.name || result.symbol;

        const params = new URLSearchParams();

        params.set("asset_name", String(assetName));
        params.set("symbol", String(result.symbol));

        const currency = String(result.currency || "INR").toUpperCase();

        params.set("currency", currency);

        if (
            currency === "INR" &&
            Number.isFinite(result.currentPrice) &&
            result.currentPrice > 0
        ) {
            params.set(
                "investment_price",
                result.currentPrice.toFixed(2)
            );
        }

        investButton.href =
            `/profile?${params.toString()}#investmentTracker`;

        investmentContainer.hidden = false;

        console.log(
            "[Market Plus AI] Investment button enabled:",
            investButton.href
        );
    }

    // =========================================================
    // EXPLANATION RENDERING
    // =========================================================

    function addExplanationItems(factors) {

        if (!explanationList) return;

        explanationList.replaceChildren();

        let items = [];

        if (Array.isArray(factors)) {

            items = factors.map(item => {

                if (typeof item === "string") {
                    return item;
                }

                if (item && typeof item === "object") {

                    const label = firstValue([item], [
                        "label",
                        "name",
                        "factor",
                        "feature",
                        "title"
                    ]);

                    const detail = firstValue([item], [
                        "explanation",
                        "description",
                        "reason",
                        "value"
                    ]);

                    if (label && detail) {
                        return `${label}: ${detail}`;
                    }

                    return label || detail || "";
                }

                return String(item);

            }).filter(Boolean);

        } else if (factors && typeof factors === "object") {

            items = Object.entries(factors).map(([key, value]) => {

                if (value && typeof value === "object") {
                    return `${key}: ${JSON.stringify(value)}`;
                }

                return `${key}: ${value}`;
            });

        } else if (
            typeof factors === "string" &&
            factors.trim()
        ) {

            items = factors
                .split(/\r?\n/)
                .map(item =>
                    item.replace(/^[\s•*-]+/, "").trim()
                )
                .filter(Boolean);
        }

        if (!items.length) {
            items = [
                "The prediction service did not provide detailed model explanations for this result."
            ];
        }

        items.slice(0, 8).forEach(item => {

            const li = document.createElement("li");
            li.textContent = item;

            explanationList.appendChild(li);
        });
    }

    // =========================================================
    // DISPLAY PREDICTION
    // =========================================================

    function showPrediction(result, requestedDays) {

        latestPrediction = result;

        updateInvestmentButton(result);

        if (placeholder) {
            placeholder.hidden = true;
        }

        if (resultContent) {
            resultContent.hidden = false;
        }

        if (predictedPriceValue) {
            predictedPriceValue.textContent = formatCurrency(
                result.predictedPrice,
                result.currency
            );
        }

        if (currentPriceValue) {
            currentPriceValue.textContent = formatCurrency(
                result.currentPrice,
                result.currency
            );
        }

        if (changeValue) {
            changeValue.textContent =
                result.changePercent === null
                    ? "Not available"
                    : formatPercent(result.changePercent);
        }

        if (trendIndicator) {

            trendIndicator.className = "trend-indicator";

            const direction = result.direction.toLowerCase();

            if (
                direction.includes("up") ||
                direction.includes("bull")
            ) {

                trendIndicator.textContent = result.direction;
                trendIndicator.classList.add("trend-up");

            } else if (
                direction.includes("down") ||
                direction.includes("bear")
            ) {

                trendIndicator.textContent = result.direction;
                trendIndicator.classList.add("trend-down");

            } else if (result.changePercent !== null) {

                if (result.changePercent > 0) {
                    trendIndicator.textContent = "↑ Potential increase";
                    trendIndicator.classList.add("trend-up");

                } else if (result.changePercent < 0) {
                    trendIndicator.textContent = "↓ Potential decrease";
                    trendIndicator.classList.add("trend-down");

                } else {
                    trendIndicator.textContent = "Little or no change";
                }

            } else {
                trendIndicator.textContent = "Direction unavailable";
            }
        }

        if (horizonValue) {
            horizonValue.textContent = getDurationLabel(requestedDays);
        }

        if (confidenceValue) {
            confidenceValue.textContent =
                result.confidence === null
                    ? "Not provided"
                    : `${result.confidence.toFixed(1)}%`;
        }

        if (confidenceNote) {
            confidenceNote.textContent =
                result.confidence === null
                    ? "The model did not return a confidence value."
                    : "Value supplied by the prediction service; it is not a guarantee of accuracy.";
        }

        const direction = result.direction.trim();

        if (recommendationValue) {

            if (direction) {
                recommendationValue.textContent = direction;

            } else if (
                result.changePercent !== null &&
                result.changePercent > 0
            ) {
                recommendationValue.textContent =
                    "Potential upward movement";

            } else if (
                result.changePercent !== null &&
                result.changePercent < 0
            ) {
                recommendationValue.textContent =
                    "Potential downward movement";

            } else {
                recommendationValue.textContent =
                    "Forecast generated";
            }
        }

        if (recommendationExplanation) {

            if (
                typeof result.explanation === "string" &&
                result.explanation.trim()
            ) {
                recommendationExplanation.textContent =
                    result.explanation;

            } else {
                recommendationExplanation.textContent =
                    "This is a model-based estimate, not a guaranteed outcome. " +
                    "Review the available forecast and conduct independent research.";
            }
        }

        addExplanationItems(result.factors);

        if (savedNote) {

            const saved =
                result.saved === true ||
                result.saved === 1 ||
                String(result.saved).toLowerCase() === "true";

            const historyExists = Boolean(result.history);

            savedNote.textContent =
                saved || historyExists
                    ? "The server reports that this prediction was saved."
                    : "History saving was not confirmed by the server.";
        }

        if (resultSubtitle) {
            resultSubtitle.textContent =
                `${result.symbol} · ${getDurationLabel(requestedDays)} · ${result.modelName}`;
        }

        // New What-If button appears only after successful result rendering.
        createWhatIfButton(result, requestedDays);

        setStatus("COMPLETE", "success");

        setMessage(
            "Prediction received successfully. Forecasts are estimates and may be inaccurate.",
            "success"
        );
    }

    // =========================================================
    // PREDICTION API
    // =========================================================

    async function requestPrediction(payload) {

        let lastMessage = "No prediction endpoint is available.";

        for (const endpoint of API_ENDPOINTS) {

            let response;
            let data;

            try {

                ({ response, data } = await apiRequest(
                    endpoint,
                    {
                        method: "POST",
                        body: JSON.stringify(payload)
                    }
                ));

            } catch (error) {

                if (
                    error.message === "Authentication required." ||
                    error.name === "AbortError"
                ) {
                    throw error;
                }

                lastMessage = error.message || lastMessage;
                continue;
            }

            if (
                response.status === 404 ||
                response.status === 405
            ) {
                lastMessage =
                    `Prediction endpoint ${endpoint} is not available.`;
                continue;
            }

            if (
                !response.ok ||
                data.success === false ||
                data.status === "error"
            ) {
                throw new Error(
                    extractResponseMessage(
                        data,
                        `Prediction failed with HTTP ${response.status}.`
                    )
                );
            }

            return data;
        }

        throw new Error(
            `${lastMessage} The Flask application must register a working prediction API.`
        );
    }

    // =========================================================
    // SUBMIT PREDICTION
    // =========================================================

    async function handlePredictionSubmit(event) {

        event.preventDefault();

        if (isSubmitting) return;

        const symbol = symbolInput
            ? symbolInput.value.trim()
            : "";

        const horizon = Number(
            durationInput ? durationInput.value : 1
        );

        const selectedModel = getSelectedModel();

        if (!symbol) {
            setMessage(
                "Please enter a stock name or symbol.",
                "error"
            );
            symbolInput?.focus();
            return;
        }

        if (
            !selectedStock ||
            selectedStock.symbol !== symbol.toUpperCase()
        ) {
            setMessage(
                "Please select a stock from the matching suggestions before generating a prediction.",
                "error"
            );

            symbolInput?.focus();

            if (symbol) {
                await searchStocks(symbol);
            }

            return;
        }

        if (
            !Number.isInteger(horizon) ||
            !SUPPORTED_DURATIONS.includes(horizon)
        ) {
            setMessage(
                "Please select a supported prediction duration: 1, 7, or 30 days.",
                "error"
            );
            durationInput?.focus();
            return;
        }

        if (!SUPPORTED_MODELS.includes(selectedModel)) {
            setMessage(
                "Please select a supported AI prediction model.",
                "error"
            );
            modelInput?.focus();
            return;
        }

        closeStockSuggestions();

        if (investmentContainer) {
            investmentContainer.hidden = true;
        }

        if (placeholder) {
            placeholder.hidden = false;
        }

        if (resultContent) {
            resultContent.hidden = true;
        }

        latestPrediction = null;
        hideWhatIfButton();

        setLoading(true);

        try {

            const account =
                await getAuthenticatedUserIdentifier();

            const requestPayload = {

                user_identifier: account.identifier,
                user_id: account.identifier,

                email:
                    account.user.email ||
                    account.user.user_email ||
                    "",

                symbol: selectedStock.symbol,
                asset: selectedStock.symbol,

                horizon: horizon,
                horizon_days: horizon,
                duration: String(horizon),

                model_name: selectedModel,

                language: "en",
                save_history: true,
                offline: false
            };

            console.log(
                "[Market Plus AI] Prediction request:",
                {
                    symbol: requestPayload.symbol,
                    horizon: requestPayload.horizon_days,
                    model: requestPayload.model_name
                }
            );

            const data = await requestPrediction(requestPayload);

            const normalized =
                normalizePredictionResponse(data);

            showPrediction(normalized, horizon);

        } catch (error) {

            console.error(
                "[Market Plus AI] Prediction request failed:",
                error
            );

            if (placeholder) {
                placeholder.hidden = false;
            }

            if (resultContent) {
                resultContent.hidden = true;
            }

            if (investmentContainer) {
                investmentContainer.hidden = true;
            }

            latestPrediction = null;
            hideWhatIfButton();

            setStatus("FAILED", "error");

            setMessage(
                error.message ||
                "The prediction could not be generated. Please try again.",
                "error"
            );

        } finally {
            setLoading(false);
        }
    }

    // =========================================================
    // SIDEBAR
    // =========================================================

    function closeSidebar() {

        document.body.classList.remove("sidebar-open");

        if (sidebar) {
            sidebar.classList.remove("sidebar-open");
        }

        if (menuButton) {
            menuButton.setAttribute("aria-expanded", "false");
        }

        if (sidebarOverlay) {
            sidebarOverlay.hidden = true;
        }
    }

    function openSidebar() {

        document.body.classList.add("sidebar-open");

        if (sidebar) {
            sidebar.classList.add("sidebar-open");
        }

        if (menuButton) {
            menuButton.setAttribute("aria-expanded", "true");
        }

        if (sidebarOverlay) {
            sidebarOverlay.hidden = false;
        }
    }

    // =========================================================
    // LOGOUT
    // =========================================================

    async function handleLogout() {

        if (logoutButton) {
            logoutButton.disabled = true;
            logoutButton.setAttribute("aria-busy", "true");
        }

        try {

            await fetch(
                "/api/auth/logout",
                {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({})
                }
            );

        } catch (error) {

            console.warn(
                "[Market Plus AI] Logout request could not be confirmed.",
                error
            );

        } finally {
            window.location.assign("/login");
        }
    }

    // =========================================================
    // DATE
    // =========================================================

    function initializeDate() {

        if (!pageDate) return;

        pageDate.textContent =
            new Intl.DateTimeFormat(
                "en-IN",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            ).format(new Date());
    }

    // =========================================================
    // URL STOCK INITIALIZATION
    // =========================================================

    async function initializeFromQueryString() {

        const params = new URLSearchParams(
            window.location.search
        );

        const symbolFromUrl =
            params.get("symbol") ||
            params.get("stock");

        if (!symbolFromUrl || !symbolInput) {
            return;
        }

        const query = symbolFromUrl.trim();

        symbolInput.value = query;

        const stocks = await searchStocks(
            query,
            {
                render: false,
                showLoading: false
            }
        );

        const exactMatch = stocks.find(stock =>
            stock.symbol.toUpperCase() === query.toUpperCase()
        );

        if (exactMatch) {
            selectStock(exactMatch);
        } else {
            renderStockSuggestions(stocks);
        }
    }

    // =========================================================
    // MODEL SELECTOR INITIALIZATION
    // =========================================================

    function initializeModelSelector() {

        if (!modelInput) {
            console.warn(
                "[Market Plus AI] Model selector was not found. Random Forest will be used."
            );
            return;
        }

        if (!SUPPORTED_MODELS.includes(modelInput.value)) {
            modelInput.value = DEFAULT_MODEL;
        }

        modelInput.addEventListener("change", () => {

            const selected = getSelectedModel();

            console.log(
                "[Market Plus AI] Selected prediction model:",
                selected
            );

            if (selected === "LSTM + Transformer") {

                setMessage(
                    "LSTM + Transformer selected. Deep-learning forecasting may take longer because the model needs to train.",
                    "info"
                );

            } else {

                setMessage(
                    `${selected} selected successfully.`,
                    "success"
                );
            }
        });
    }

    // =========================================================
    // EVENT LISTENERS
    // =========================================================

    if (symbolInput) {

        symbolInput.addEventListener(
            "input",
            handleStockInput
        );

        symbolInput.addEventListener(
            "keydown",
            handleStockKeyboard
        );

        symbolInput.addEventListener(
            "focus",
            () => {

                const query = symbolInput.value.trim();

                if (query && !selectedStock) {
                    handleStockInput();
                }
            }
        );
    }

    document.addEventListener("click", event => {

        if (
            suggestionsContainer &&
            !suggestionsContainer.contains(event.target) &&
            !symbolInput?.contains(event.target)
        ) {
            closeStockSuggestions();
        }
    });

    if (form) {
        form.addEventListener(
            "submit",
            handlePredictionSubmit
        );
    }

    if (menuButton) {

        menuButton.addEventListener("click", () => {

            const isOpen =
                menuButton.getAttribute("aria-expanded") === "true";

            if (isOpen) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", closeSidebar);
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSidebar();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener("click", handleLogout);
    }

    // =========================================================
    // INITIALIZATION
    // =========================================================

    initializeDate();

    initializeModelSelector();

    initializeWhatIfSidebarLink();

    initializeFromQueryString();

    // No automatic prediction on page load.
    // User must select a stock, choose a model,
    // choose a duration, and submit explicitly.

});
