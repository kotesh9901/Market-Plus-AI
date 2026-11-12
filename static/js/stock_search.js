
/* =========================================================
   MARKET PLUS AI — EXPLORE ASSETS
   File: static/js/stock_search.js
   Version: 2.1.0

   Improvements:
   - Displays all results returned by the search API
   - Clear, readable autocomplete dropdown
   - Search result count
   - Company name, ticker and exchange display
   - Scrollable autocomplete
   - Prevents stale search results
   - Direct navigation on selection or Enter
   - Keyboard navigation and accessibility
   - Real Yahoo Finance recommended quotes
   - Safe DOM rendering
   - Dashboard account information
   - Logout and responsive sidebar
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    /* -----------------------------------------------------
       1. DOM ELEMENTS
    ----------------------------------------------------- */

    const searchForm = document.getElementById("stockSearchForm");
    const searchInput = document.getElementById("stockSearchInput");
    const searchButton = document.getElementById("stockSearchButton");

    const searchButtonLabel = searchButton?.querySelector(
        ".search-button-label"
    );

    const searchButtonLoader = searchButton?.querySelector(
        ".search-button-loader"
    );

    const searchMessage = document.getElementById(
        "stockSearchMessage"
    );

    const recommendedContainer = document.getElementById(
        "recommendedStocksContainer"
    );

    const resultsContainer = document.getElementById(
        "stockResultsContainer"
    );

    const resultsDescription = document.getElementById(
        "stockResultsDescription"
    );

    const resultsCount = document.getElementById(
        "stockResultsCount"
    );

    const topbarUserName = document.getElementById(
        "topbarUserName"
    );

    const topbarAvatar = document.getElementById(
        "topbarAvatar"
    );

    const sidebarAlertCount = document.getElementById(
        "sidebarAlertCount"
    );

    const logoutButton = document.getElementById(
        "logoutButton"
    );

    const mobileMenuButton = document.getElementById(
        "mobileMenuButton"
    );

    const sidebarOverlay = document.getElementById(
        "sidebarOverlay"
    );

    const pageBody = document.body;

    /* -----------------------------------------------------
       2. CONFIGURATION
    ----------------------------------------------------- */

    const API_BASE = "/api";

    const SEARCH_DELAY = 250;
    const MIN_SEARCH_LENGTH = 1;
    const MAX_SEARCH_LENGTH = 100;

    const RECOMMENDED_SYMBOLS = [
        "TCS.NS",
        "INFY.NS",
        "RELIANCE.NS",
        "HDFCBANK.NS"
    ];

    let debounceTimer = null;
    let searchController = null;
    let searchRequestNumber = 0;

    let activeSuggestionIndex = -1;
    let currentSuggestions = [];
    let isNavigating = false;

    let autocompleteContainer = null;

    /* -----------------------------------------------------
       3. GENERAL HELPERS
    ----------------------------------------------------- */

    function isObject(value) {
        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );
    }

    function safeText(value, fallback = "") {
        if (value === null || value === undefined) {
            return fallback;
        }

        const result = String(value).trim();
        return result || fallback;
    }

    function getFirstValue(object, keys) {
        if (!isObject(object)) {
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

    function toFiniteNumber(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        if (typeof value === "string") {
            value = value.replace(/,/g, "").trim();

            if (
                !value ||
                value === "-" ||
                value.toUpperCase() === "N/A"
            ) {
                return null;
            }
        }

        const number = Number(value);

        return Number.isFinite(number) ? number : null;
    }

    function normalizeSymbol(value) {
        return typeof value === "string"
            ? value.trim().toUpperCase()
            : "";
    }

    function formatCurrency(value, currency = "INR") {
        const amount = toFiniteNumber(value);

        if (amount === null) {
            return "Price unavailable";
        }

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: currency || "INR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return `${currency || "INR"} ${amount.toFixed(2)}`;
        }
    }

    function formatPercentage(value) {
        const percentage = toFiniteNumber(value);

        if (percentage === null) {
            return null;
        }

        const sign = percentage > 0 ? "+" : "";

        return `${sign}${percentage.toFixed(2)}%`;
    }

    function formatDateTime(value) {
        if (!value) {
            return "";
        }

        let date;

        if (typeof value === "number") {
            date = new Date(
                value < 100000000000
                    ? value * 1000
                    : value
            );
        } else {
            date = new Date(value);
        }

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return `Updated ${new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date)}`;
    }

    function getCompanyInitials(name, symbol) {
        const companyName = safeText(name);

        if (companyName) {
            const words = companyName
                .split(/\s+/)
                .filter(Boolean);

            if (words.length >= 2) {
                return (
                    words[0][0] + words[1][0]
                ).toUpperCase();
            }

            return words[0].slice(0, 2).toUpperCase();
        }

        return safeText(symbol, "ST")
            .slice(0, 2)
            .toUpperCase();
    }

    /* -----------------------------------------------------
       4. API HELPERS
    ----------------------------------------------------- */

    async function readResponse(response) {
        const contentType =
            response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            return response.json();
        }

        const responseText = await response.text();

        return {
            message: responseText || `HTTP ${response.status}`
        };
    }

    function getErrorMessage(data, fallback) {
        if (typeof data === "string" && data.trim()) {
            return data;
        }

        if (!isObject(data)) {
            return fallback;
        }

        return safeText(
            getFirstValue(data, [
                "message",
                "error",
                "detail",
                "description"
            ]),
            fallback
        );
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        const data = await readResponse(response);

        if (response.status === 401) {
            window.location.assign("/login");
            throw new Error("Your session has expired.");
        }

        if (!response.ok) {
            throw new Error(
                getErrorMessage(
                    data,
                    `Request failed with status ${response.status}.`
                )
            );
        }

        if (isObject(data) && data.success === false) {
            throw new Error(
                getErrorMessage(
                    data,
                    "The request could not be completed."
                )
            );
        }

        return data;
    }

    /* -----------------------------------------------------
       5. STOCK NORMALIZATION
    ----------------------------------------------------- */

    function unwrapStock(data) {
        if (!isObject(data)) {
            return null;
        }

        const candidates = [
            data.stock,
            data.asset,
            data.quote,
            data.data?.stock,
            data.data?.asset,
            data.data?.quote,
            data.data
        ];

        for (const candidate of candidates) {
            if (
                isObject(candidate) &&
                getFirstValue(candidate, [
                    "symbol",
                    "ticker",
                    "stock_symbol"
                ])
            ) {
                return candidate;
            }
        }

        if (
            getFirstValue(data, [
                "symbol",
                "ticker",
                "stock_symbol"
            ])
        ) {
            return data;
        }

        return null;
    }

    function normalizeStock(raw) {
        if (!isObject(raw)) {
            return null;
        }

        const nestedQuote = isObject(raw.quote)
            ? raw.quote
            : {};

        const combined = {
            ...nestedQuote,
            ...raw
        };

        const symbol = normalizeSymbol(
            getFirstValue(combined, [
                "symbol",
                "ticker",
                "stock_symbol",
                "stockSymbol",
                "instrument"
            ])
        );

        if (!symbol) {
            return null;
        }

        const name = safeText(
            getFirstValue(combined, [
                "name",
                "company_name",
                "companyName",
                "longName",
                "shortName",
                "stock_name",
                "stockName"
            ]),
            symbol
        );

        const dataAvailable =
            combined.data_available !== false &&
            combined.dataAvailable !== false;

        const rawPrice = getFirstValue(combined, [
            "last_price",
            "current_price",
            "currentPrice",
            "latest_price",
            "latestPrice",
            "regularMarketPrice",
            "price",
            "lastPrice",
            "close",
            "last_close"
        ]);

        const rawChangePercent = getFirstValue(combined, [
            "change_percent",
            "changePercent",
            "percent_change",
            "percentChange",
            "daily_change_percent",
            "dailyChangePercent",
            "regularMarketChangePercent"
        ]);

        const previousClose = toFiniteNumber(
            getFirstValue(combined, [
                "previous_close",
                "previousClose",
                "prev_close",
                "prevClose",
                "regularMarketPreviousClose"
            ])
        );

        const price = dataAvailable
            ? toFiniteNumber(rawPrice)
            : null;

        let changePercent = dataAvailable
            ? toFiniteNumber(rawChangePercent)
            : null;

        let changeAmount = dataAvailable
            ? toFiniteNumber(
                getFirstValue(combined, [
                    "price_change",
                    "priceChange",
                    "change",
                    "change_amount",
                    "changeAmount",
                    "regularMarketChange"
                ])
            )
            : null;

        if (
            changeAmount === null &&
            price !== null &&
            previousClose !== null
        ) {
            changeAmount = price - previousClose;
        }

        if (
            changePercent === null &&
            changeAmount !== null &&
            previousClose !== null &&
            previousClose !== 0
        ) {
            changePercent =
                (changeAmount / previousClose) * 100;
        }

        const currency = safeText(
            getFirstValue(combined, [
                "currency",
                "currency_code",
                "currencyCode"
            ]),
            "INR"
        ).toUpperCase();

        const updatedAt = getFirstValue(combined, [
            "quote_timestamp",
            "updated_at",
            "updatedAt",
            "timestamp",
            "last_updated",
            "lastUpdated",
            "regularMarketTime"
        ]);

        const exchange = safeText(
            getFirstValue(combined, [
                "exchange",
                "exchange_name",
                "exchangeName",
                "market"
            ])
        );

        return {
            symbol,
            name,
            price,
            changeAmount,
            changePercent,
            previousClose,
            currency,
            updatedAt,
            exchange,
            dataAvailable,
            source: safeText(combined.source)
        };
    }

    /* -----------------------------------------------------
       6. EXTRACT SEARCH RESULTS

       Supports common Flask response formats:
       results, stocks, assets, items, matches and data.
    ----------------------------------------------------- */

    function extractStockList(data) {
        if (Array.isArray(data)) {
            return data;
        }

        if (!isObject(data)) {
            return [];
        }

        const possibleLists = [
            data.results,
            data.stocks,
            data.assets,
            data.items,
            data.matches,
            data.quotes,
            data.data?.results,
            data.data?.stocks,
            data.data?.assets,
            data.data?.items,
            data.data?.matches,
            data.data
        ];

        for (const candidate of possibleLists) {
            if (Array.isArray(candidate)) {
                return candidate;
            }

            if (isObject(candidate)) {
                for (const key of [
                    "results",
                    "stocks",
                    "assets",
                    "items",
                    "quotes",
                    "matches"
                ]) {
                    if (Array.isArray(candidate[key])) {
                        return candidate[key];
                    }
                }
            }
        }

        const singleStock = unwrapStock(data);

        return singleStock ? [singleStock] : [];
    }

    /* -----------------------------------------------------
       7. AUTOCOMPLETE CONTAINER
       Uses stocks.css classes instead of a separate
       injected visual design.
    ----------------------------------------------------- */

    function createAutocomplete() {
        if (!searchForm || !searchInput) {
            return;
        }

        if (document.getElementById("stockAutocomplete")) {
            autocompleteContainer = document.getElementById(
                "stockAutocomplete"
            );
            return;
        }

        autocompleteContainer = document.createElement("div");

        autocompleteContainer.className =
            "stock-search-suggestions";

        autocompleteContainer.id = "stockAutocomplete";

        autocompleteContainer.setAttribute(
            "role",
            "listbox"
        );

        autocompleteContainer.setAttribute(
            "aria-label",
            "Matching companies and stock symbols"
        );

        autocompleteContainer.hidden = true;

        searchForm.appendChild(autocompleteContainer);

        searchInput.setAttribute("autocomplete", "off");
        searchInput.setAttribute("aria-autocomplete", "list");
        searchInput.setAttribute("aria-controls", "stockAutocomplete");
        searchInput.setAttribute("aria-expanded", "false");
    }

    function clearSuggestionState() {
        currentSuggestions = [];
        activeSuggestionIndex = -1;

        searchInput?.removeAttribute(
            "aria-activedescendant"
        );
    }

    function closeAutocomplete() {
        if (!autocompleteContainer) {
            return;
        }

        autocompleteContainer.hidden = true;
        autocompleteContainer.replaceChildren();

        clearSuggestionState();

        searchInput?.setAttribute(
            "aria-expanded",
            "false"
        );
    }

    function showAutocomplete() {
        if (!autocompleteContainer) {
            return;
        }

        autocompleteContainer.hidden = false;

        searchInput?.setAttribute(
            "aria-expanded",
            "true"
        );
    }

    function renderAutocompleteStatus(message) {
        if (!autocompleteContainer) {
            return;
        }

        autocompleteContainer.replaceChildren();

        const status = document.createElement("div");

        status.className =
            "stock-search-suggestion-message";

        status.textContent = message;

        autocompleteContainer.appendChild(status);

        showAutocomplete();
    }

    /* -----------------------------------------------------
       8. DIRECT NAVIGATION
    ----------------------------------------------------- */

    function navigateToStock(stockOrSymbol) {
        if (isNavigating) {
            return;
        }

        const symbol = normalizeSymbol(
            typeof stockOrSymbol === "string"
                ? stockOrSymbol
                : stockOrSymbol?.symbol
        );

        if (!symbol) {
            showMessage(
                "A valid stock symbol was not returned.",
                "error"
            );
            return;
        }

        isNavigating = true;

        clearTimeout(debounceTimer);

        if (searchController) {
            searchController.abort();
        }

        searchRequestNumber++;

        closeAutocomplete();
        setSearchLoading(true);

        window.location.assign(
            `/stock/${encodeURIComponent(symbol)}`
        );
    }

    /* -----------------------------------------------------
       9. RENDER ALL AUTOCOMPLETE RESULTS
    ----------------------------------------------------- */

    function renderSuggestions(stocks) {
        if (!autocompleteContainer) {
            return;
        }

        autocompleteContainer.replaceChildren();

        /*
         * Important:
         * Do not slice the results to 8 items.
         * Display every valid unique result returned by
         * the backend API.
         */

        currentSuggestions = stocks;
        activeSuggestionIndex = -1;

        if (!currentSuggestions.length) {
            renderAutocompleteStatus(
                "No matching companies or stock symbols found."
            );
            return;
        }

        const header = document.createElement("div");

        header.className =
            "stock-search-suggestions-header";

        header.textContent =
            `${currentSuggestions.length} matching result` +
            (currentSuggestions.length === 1 ? "" : "s");

        autocompleteContainer.appendChild(header);

        const fragment = document.createDocumentFragment();

        currentSuggestions.forEach((stock, index) => {
            const button = document.createElement("button");

            button.type = "button";

            button.className =
                "stock-search-suggestion";

            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");

            button.id = `stock-search-suggestion-${index}`;

            const mark = document.createElement("span");

            mark.className =
                "stock-search-suggestion-mark";

            mark.textContent = getCompanyInitials(
                stock.name,
                stock.symbol
            );

            mark.setAttribute("aria-hidden", "true");

            const details = document.createElement("span");

            details.className =
                "stock-search-suggestion-details";

            const name = document.createElement("span");

            name.className =
                "stock-search-suggestion-name";

            name.textContent = stock.name;

            const symbol = document.createElement("span");

            symbol.className =
                "stock-search-suggestion-symbol";

            symbol.textContent = stock.symbol;

            details.append(name, symbol);

            button.append(mark, details);

            if (stock.exchange) {
                const exchange = document.createElement("span");

                exchange.className =
                    "stock-search-suggestion-exchange";

                exchange.textContent = stock.exchange;

                button.appendChild(exchange);
            }

            const arrow = document.createElement("span");

            arrow.className =
                "stock-search-suggestion-arrow";

            arrow.textContent = "→";
            arrow.setAttribute("aria-hidden", "true");

            button.appendChild(arrow);

            button.addEventListener("click", () => {
                navigateToStock(stock);
            });

            fragment.appendChild(button);
        });

        autocompleteContainer.appendChild(fragment);

        showAutocomplete();
    }

    function setActiveSuggestion(index) {
        const buttons = autocompleteContainer?.querySelectorAll(
            ".stock-search-suggestion"
        );

        if (!buttons?.length) {
            return;
        }

        activeSuggestionIndex =
            (index + buttons.length) % buttons.length;

        buttons.forEach((button, buttonIndex) => {
            const active =
                buttonIndex === activeSuggestionIndex;

            button.classList.toggle("active", active);

            button.setAttribute(
                "aria-selected",
                String(active)
            );
        });

        const activeButton = buttons[activeSuggestionIndex];

        searchInput?.setAttribute(
            "aria-activedescendant",
            activeButton.id
        );

        activeButton.scrollIntoView({
            block: "nearest"
        });
    }

    /* -----------------------------------------------------
       10. SEARCH API
    ----------------------------------------------------- */

    async function searchStocks(query, signal) {
        const url = new URL(
            `${API_BASE}/stocks/search`,
            window.location.origin
        );

        url.searchParams.set("q", query);

        const response = await fetch(url.toString(), {
            method: "GET",
            credentials: "same-origin",
            signal,
            headers: {
                Accept: "application/json"
            }
        });

        const data = await readResponse(response);

        if (response.status === 401) {
            window.location.assign("/login");
            throw new Error("Please log in to continue.");
        }

        if (!response.ok) {
            throw new Error(
                getErrorMessage(
                    data,
                    `Stock search failed with status ${response.status}.`
                )
            );
        }

        if (isObject(data) && data.success === false) {
            throw new Error(
                getErrorMessage(data, "Stock search failed.")
            );
        }

        const seen = new Set();

        return extractStockList(data)
            .map(normalizeStock)
            .filter(stock => {
                if (!stock || seen.has(stock.symbol)) {
                    return false;
                }

                seen.add(stock.symbol);
                return true;
            });
    }

    /* -----------------------------------------------------
       11. LIVE AUTOCOMPLETE
    ----------------------------------------------------- */

    async function loadSuggestions(query) {
        const requestNumber = ++searchRequestNumber;

        if (searchController) {
            searchController.abort();
        }

        searchController = new AbortController();

        const signal = searchController.signal;

        try {
            renderAutocompleteStatus("Searching companies and symbols...");

            const stocks = await searchStocks(query, signal);

            if (requestNumber !== searchRequestNumber) {
                return;
            }

            renderSuggestions(stocks);

        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }

            if (requestNumber !== searchRequestNumber) {
                return;
            }

            console.error(
                "[Market Plus AI] Autocomplete error:",
                error
            );

            renderAutocompleteStatus(
                "Unable to load suggestions. Please try again."
            );
        }
    }

    function handleSearchInput() {
        if (!searchInput) {
            return;
        }

        const query = searchInput.value.trim();

        clearMessage();
        clearTimeout(debounceTimer);

        /*
         * Invalidate the previous request immediately.
         * This prevents old results appearing for a new query.
         */

        searchRequestNumber++;

        if (searchController) {
            searchController.abort();
            searchController = null;
        }

        clearSuggestionState();

        if (query.length < MIN_SEARCH_LENGTH) {
            closeAutocomplete();
            return;
        }

        if (query.length > MAX_SEARCH_LENGTH) {
            renderAutocompleteStatus(
                "Search must contain no more than 100 characters."
            );
            return;
        }

        debounceTimer = setTimeout(() => {
            loadSuggestions(query);
        }, SEARCH_DELAY);
    }

    /* -----------------------------------------------------
       12. BEST MATCH
    ----------------------------------------------------- */

    function findBestMatch(stocks, query) {
        if (!stocks.length) {
            return null;
        }

        const normalizedQuery = query.trim().toUpperCase();
        const lowerQuery = query.trim().toLowerCase();

        return (
            stocks.find(stock =>
                stock.symbol.toUpperCase() === normalizedQuery
            ) ||
            stocks.find(stock =>
                stock.name.toLowerCase() === lowerQuery
            ) ||
            stocks.find(stock =>
                stock.symbol.toUpperCase().startsWith(normalizedQuery)
            ) ||
            stocks.find(stock =>
                stock.name.toLowerCase().startsWith(lowerQuery)
            ) ||
            stocks[0]
        );
    }

    /* -----------------------------------------------------
       13. ENTER / FORM SUBMISSION
    ----------------------------------------------------- */

    async function handleSearchSubmit(event) {
        event.preventDefault();

        if (!searchInput) {
            return;
        }

        const query = searchInput.value.trim();

        if (!query) {
            showMessage(
                "Enter a company name or stock symbol.",
                "error"
            );

            closeAutocomplete();
            searchInput.focus();
            return;
        }

        if (query.length > MAX_SEARCH_LENGTH) {
            showMessage(
                "Your search must contain no more than 100 characters.",
                "error"
            );
            return;
        }

        clearTimeout(debounceTimer);
        clearMessage();

        /*
         * If suggestions match the current query, use them.
         * Otherwise, perform a fresh search.
         */

        if (currentSuggestions.length) {
            const bestMatch = findBestMatch(
                currentSuggestions,
                query
            );

            if (bestMatch) {
                navigateToStock(bestMatch);
                return;
            }
        }

        if (searchController) {
            searchController.abort();
        }

        const requestNumber = ++searchRequestNumber;

        searchController = new AbortController();

        setSearchLoading(true);

        renderAutocompleteStatus(
            "Finding the best matching stock..."
        );

        try {
            const stocks = await searchStocks(
                query,
                searchController.signal
            );

            if (requestNumber !== searchRequestNumber) {
                return;
            }

            if (!stocks.length) {
                closeAutocomplete();

                showMessage(
                    `No matching stocks found for "${query}".`,
                    "error"
                );

                setSearchLoading(false);
                return;
            }

            const bestMatch = findBestMatch(stocks, query);

            if (bestMatch) {
                navigateToStock(bestMatch);
            }

        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }

            if (requestNumber !== searchRequestNumber) {
                return;
            }

            console.error(
                "[Market Plus AI] Search submission error:",
                error
            );

            closeAutocomplete();

            showMessage(
                error.message || "Unable to search stocks.",
                "error"
            );

            setSearchLoading(false);
        }
    }

    /* -----------------------------------------------------
       14. STOCK DETAILS API
    ----------------------------------------------------- */

    async function fetchStockDetails(symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);

        if (!normalizedSymbol) {
            throw new Error("A valid stock symbol is required.");
        }

        const url =
            `${API_BASE}/stocks/${encodeURIComponent(normalizedSymbol)}`;

        const data = await apiRequest(url, {
            method: "GET"
        });

        const rawStock = unwrapStock(data);

        if (!rawStock) {
            throw new Error(
                `No stock details returned for ${normalizedSymbol}.`
            );
        }

        const stock = normalizeStock(rawStock);

        if (!stock) {
            throw new Error(
                `Invalid stock data returned for ${normalizedSymbol}.`
            );
        }

        return stock;
    }

    /* -----------------------------------------------------
       15. SEARCH MESSAGES
    ----------------------------------------------------- */

    function showMessage(message, type = "info") {
        if (!searchMessage) {
            return;
        }

        searchMessage.textContent = message;
        searchMessage.className = "stock-search-message";

        if (type === "error") {
            searchMessage.classList.add("error");
        } else if (type === "success") {
            searchMessage.classList.add("success");
        }

        searchMessage.hidden = false;
    }

    function clearMessage() {
        if (!searchMessage) {
            return;
        }

        searchMessage.textContent = "";
        searchMessage.className = "stock-search-message";
        searchMessage.hidden = true;
    }

    function setSearchLoading(isLoading) {
        if (searchButton) {
            searchButton.disabled = isLoading;

            searchButton.setAttribute(
                "aria-busy",
                String(isLoading)
            );
        }

        if (searchButtonLabel) {
            searchButtonLabel.textContent = isLoading
                ? "Searching..."
                : "Search";
        }

        if (searchButtonLoader) {
            searchButtonLoader.hidden = !isLoading;
        }
    }

    /* -----------------------------------------------------
       16. RECOMMENDED STOCK CARDS
    ----------------------------------------------------- */

    function createStockCard(stock) {
        const card = document.createElement("article");

        card.className = "stock-result-card";
        card.tabIndex = 0;
        card.setAttribute("role", "link");
        card.setAttribute(
            "aria-label",
            `View details for ${stock.name} (${stock.symbol})`
        );

        const top = document.createElement("div");
        top.className = "stock-result-top";

        const symbolMark = document.createElement("div");

        symbolMark.className =
            "stock-result-symbol-mark";

        symbolMark.textContent = getCompanyInitials(
            stock.name,
            stock.symbol
        );

        symbolMark.setAttribute("aria-hidden", "true");

        const identity = document.createElement("div");

        identity.className = "stock-result-identity";

        const name = document.createElement("span");

        name.className = "stock-result-name";
        name.textContent = stock.name;

        const symbol = document.createElement("span");

        symbol.className = "stock-result-symbol";
        symbol.textContent = stock.symbol;

        identity.append(name, symbol);
        top.append(symbolMark, identity);

        if (stock.exchange) {
            const exchange = document.createElement("span");

            exchange.className = "stock-result-exchange";
            exchange.textContent = stock.exchange;

            top.appendChild(exchange);
        }

        const priceRow = document.createElement("div");

        priceRow.className = "stock-result-price-row";

        const priceBlock = document.createElement("div");

        priceBlock.className = "stock-result-price-block";

        const priceLabel = document.createElement("span");

        priceLabel.className = "stock-price-label";
        priceLabel.textContent = "Latest available price";

        const price = document.createElement("strong");

        price.className = "stock-result-price";

        price.textContent = stock.price !== null
            ? formatCurrency(stock.price, stock.currency)
            : "Price unavailable";

        priceBlock.append(priceLabel, price);
        priceRow.appendChild(priceBlock);

        const change = document.createElement("span");

        change.className = "stock-result-change";

        if (stock.changePercent !== null) {
            if (stock.changePercent > 0) {
                change.classList.add("positive");

                change.textContent =
                    `↑ ${formatPercentage(stock.changePercent)}`;

            } else if (stock.changePercent < 0) {
                change.classList.add("negative");

                change.textContent =
                    `↓ ${formatPercentage(stock.changePercent)}`;

            } else {
                change.classList.add("neutral");
                change.textContent = "— 0.00%";
            }
        } else {
            change.classList.add("neutral");
            change.textContent = "Change unavailable";
        }

        priceRow.appendChild(change);

        const footer = document.createElement("div");

        footer.className = "stock-result-footer";

        const updated = document.createElement("span");

        updated.className = "stock-result-updated";

        updated.textContent =
            formatDateTime(stock.updatedAt) ||
            "Quote timestamp unavailable";

        const link = document.createElement("a");

        link.className = "stock-view-details";
        link.href = `/stock/${encodeURIComponent(stock.symbol)}`;

        const linkText = document.createElement("span");

        linkText.textContent = "View Details";

        const arrow = document.createElement("span");

        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");

        link.append(linkText, arrow);
        footer.append(updated, link);

        card.append(top, priceRow, footer);

        card.addEventListener("click", event => {
            if (event.target.closest("a")) {
                return;
            }

            navigateToStock(stock);
        });

        card.addEventListener("keydown", event => {
            if (
                event.key === "Enter" ||
                event.key === " "
            ) {
                event.preventDefault();
                navigateToStock(stock);
            }
        });

        return card;
    }

    function createEmptyState(title, description) {
        const wrapper = document.createElement("div");

        wrapper.className = "stock-results-empty";

        const heading = document.createElement("h3");
        heading.textContent = title;

        const paragraph = document.createElement("p");
        paragraph.textContent = description;

        wrapper.append(heading, paragraph);

        return wrapper;
    }

    function renderRecommendedStocks(stocks) {
        if (!recommendedContainer) {
            return;
        }

        recommendedContainer.replaceChildren();

        if (!stocks.length) {
            recommendedContainer.appendChild(
                createEmptyState(
                    "Recommended stocks unavailable",
                    "The market-data provider did not return stock information. Try searching for a company or symbol."
                )
            );

            recommendedContainer.setAttribute(
                "aria-busy",
                "false"
            );

            return;
        }

        const fragment = document.createDocumentFragment();

        stocks.forEach(stock => {
            fragment.appendChild(createStockCard(stock));
        });

        recommendedContainer.appendChild(fragment);

        recommendedContainer.setAttribute(
            "aria-busy",
            "false"
        );
    }

    function renderRecommendedSkeletons(count = 4) {
        if (!recommendedContainer) {
            return;
        }

        recommendedContainer.replaceChildren();

        for (let index = 0; index < count; index++) {
            const skeleton = document.createElement("article");

            skeleton.className = "stock-result-skeleton";
            skeleton.setAttribute("aria-hidden", "true");

            const line1 = document.createElement("div");
            line1.className = "skeleton-line skeleton-short";

            const line2 = document.createElement("div");
            line2.className = "skeleton-line skeleton-medium";

            const line3 = document.createElement("div");
            line3.className = "skeleton-line skeleton-large";

            skeleton.append(line1, line2, line3);

            recommendedContainer.appendChild(skeleton);
        }

        recommendedContainer.setAttribute(
            "aria-busy",
            "true"
        );
    }

    async function loadRecommendedStocks() {
        if (!recommendedContainer) {
            return;
        }

        renderRecommendedSkeletons(4);

        const outcomes = await Promise.allSettled(
            RECOMMENDED_SYMBOLS.map(symbol =>
                fetchStockDetails(symbol)
            )
        );

        const stocks = outcomes
            .filter(result => result.status === "fulfilled")
            .map(result => result.value);

        const uniqueStocks = [];
        const seenSymbols = new Set();

        for (const stock of stocks) {
            if (!seenSymbols.has(stock.symbol)) {
                seenSymbols.add(stock.symbol);
                uniqueStocks.push(stock);
            }
        }

        renderRecommendedStocks(uniqueStocks);

        if (!uniqueStocks.length) {
            console.warn(
                "[Market Plus AI] No recommended stock quotes returned."
            );
        }
    }

    /* -----------------------------------------------------
       17. REMOVE OLD INTERMEDIATE SEARCH RESULTS
    ----------------------------------------------------- */

    function disableIntermediateResults() {
        if (resultsContainer) {
            resultsContainer.replaceChildren();
            resultsContainer.hidden = true;
        }

        if (resultsDescription) {
            resultsDescription.hidden = true;
        }

        if (resultsCount) {
            resultsCount.hidden = true;
        }
    }

    /* -----------------------------------------------------
       18. DASHBOARD ACCOUNT INFORMATION
    ----------------------------------------------------- */

    async function loadAccountInformation() {
        try {
            const data = await apiRequest(
                `${API_BASE}/dashboard`
            );

            const user =
                data.user ||
                data.account ||
                data.profile ||
                data.data?.user ||
                {};

            const name = safeText(
                getFirstValue(user, [
                    "name",
                    "full_name",
                    "fullName",
                    "user_name",
                    "userName",
                    "username"
                ]),
                "Your Account"
            );

            if (topbarUserName) {
                topbarUserName.textContent = name;
            }

            if (topbarAvatar) {
                topbarAvatar.textContent =
                    getCompanyInitials(name, "U").slice(0, 1);
            }

            const summary =
                data.summary ||
                data.stats ||
                data.data?.summary ||
                {};

            const alertCount = toFiniteNumber(
                getFirstValue(summary, [
                    "active_alerts",
                    "activeAlerts",
                    "alert_count",
                    "alertCount",
                    "unread_alerts",
                    "unreadAlerts"
                ])
            );

            if (
                sidebarAlertCount &&
                alertCount !== null
            ) {
                sidebarAlertCount.textContent = String(
                    Math.max(0, Math.floor(alertCount))
                );

                sidebarAlertCount.hidden = alertCount <= 0;
            }

        } catch (error) {
            console.warn(
                "[Market Plus AI] Account summary unavailable:",
                error.message
            );
        }
    }

    /* -----------------------------------------------------
       19. LOGOUT
    ----------------------------------------------------- */

    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            logoutButton.disabled = true;

            try {
                await apiRequest(
                    `${API_BASE}/auth/logout`,
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
                    "[Market Plus AI] Logout response:",
                    error.message
                );

            } finally {
                window.location.assign("/login");
            }
        });
    }

    /* -----------------------------------------------------
       20. MOBILE SIDEBAR
    ----------------------------------------------------- */

    function setSidebarOpen(isOpen) {
        pageBody.classList.toggle(
            "sidebar-open",
            isOpen
        );

        if (mobileMenuButton) {
            mobileMenuButton.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

            mobileMenuButton.setAttribute(
                "aria-label",
                isOpen
                    ? "Close navigation menu"
                    : "Open navigation menu"
            );
        }

        if (sidebarOverlay) {
            sidebarOverlay.hidden = !isOpen;
        }
    }

    if (mobileMenuButton) {
        mobileMenuButton.addEventListener("click", () => {
            const isOpen =
                pageBody.classList.contains("sidebar-open");

            setSidebarOpen(!isOpen);
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", () => {
            setSidebarOpen(false);
        });
    }

    /* -----------------------------------------------------
       21. KEYBOARD AND OUTSIDE CLICK
    ----------------------------------------------------- */

    if (searchInput) {
        searchInput.addEventListener(
            "input",
            handleSearchInput
        );

        searchInput.addEventListener("keydown", event => {
            if (event.key === "ArrowDown") {
                if (!currentSuggestions.length) {
                    return;
                }

                event.preventDefault();

                setActiveSuggestion(
                    activeSuggestionIndex + 1
                );

            } else if (event.key === "ArrowUp") {
                if (!currentSuggestions.length) {
                    return;
                }

                event.preventDefault();

                setActiveSuggestion(
                    activeSuggestionIndex <= 0
                        ? currentSuggestions.length - 1
                        : activeSuggestionIndex - 1
                );

            } else if (event.key === "Escape") {
                closeAutocomplete();

            } else if (
                event.key === "Enter" &&
                activeSuggestionIndex >= 0 &&
                currentSuggestions[activeSuggestionIndex]
            ) {
                event.preventDefault();

                navigateToStock(
                    currentSuggestions[activeSuggestionIndex]
                );
            }
        });

        searchInput.addEventListener("focus", () => {
            if (
                currentSuggestions.length &&
                searchInput.value.trim()
            ) {
                showAutocomplete();
            }
        });
    }

    if (searchForm) {
        searchForm.addEventListener(
            "submit",
            handleSearchSubmit
        );
    }

    document.addEventListener("click", event => {
        if (
            searchForm &&
            !searchForm.contains(event.target)
        ) {
            closeAutocomplete();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeAutocomplete();
            setSidebarOpen(false);
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) {
            setSidebarOpen(false);
        }
    });

    /* -----------------------------------------------------
       22. INITIALIZE PAGE
    ----------------------------------------------------- */

    async function initializePage() {
        createAutocomplete();
        disableIntermediateResults();

        const params = new URLSearchParams(
            window.location.search
        );

        const initialQuery = safeText(
            params.get("q") || params.get("query")
        );

        if (initialQuery && searchInput) {
            searchInput.value = initialQuery;
            await loadSuggestions(initialQuery);
        }

        await Promise.allSettled([
            loadAccountInformation(),
            loadRecommendedStocks()
        ]);
    }

    initializePage();

});
