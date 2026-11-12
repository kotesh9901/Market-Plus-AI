/* =========================================================
   MARKET PLUS AI — PRICE ALERTS
   File: static/js/alerts.js
   Version: 4.0.0

   FEATURES
   - Authenticated price-alert loading and creation
   - Stock symbol and company-name autocomplete
   - Automatic asset trading-currency selection
   - Manual searchable currency override
   - User preferred-currency fallback
   - Target-price-reached alerts only
   - In-app, email and SMS enabled together
   - SMS delivery remains pending until integration
   - Per-alert currency formatting
   - Search, filter, sorting and pagination
   - Dashboard summary and sidebar count
   - Automatic modal close and list refresh
   - Accessible modal and keyboard controls
   - Responsive sidebar
   - Safe DOM rendering

   API
   GET  /api/alerts
   POST /api/alerts
   GET  /api/stocks/search?q=...&limit=...
   GET  /api/auth/me
   GET  /api/profile
   ========================================================= */

"use strict";

(() => {
    /* =====================================================
       1. CONFIGURATION
       ===================================================== */

    const CONFIG = {
        pageSize: 8,
        alertsEndpoint: "/api/alerts",
        stockSearchEndpoint: "/api/stocks/search",

        profileEndpoints: [
            "/api/auth/me",
            "/api/profile"
        ],

        requestTimeout: 15000,
        searchDelay: 300,
        searchLimit: 8,
        loginPage: "/login",

        defaultCurrency: "INR",
        defaultLocale: "en-IN",

        notificationChannels: [
            "in_app",
            "email",
            "sms"
        ],

        alertCondition: "reaches"
    };

    const CURRENCIES = {
        INR: { name: "Indian Rupee", symbol: "₹", locale: "en-IN" },
        USD: { name: "US Dollar", symbol: "$", locale: "en-US" },
        GBP: { name: "British Pound", symbol: "£", locale: "en-GB" },
        EUR: { name: "Euro", symbol: "€", locale: "de-DE" },
        CAD: { name: "Canadian Dollar", symbol: "CA$", locale: "en-CA" },
        AUD: { name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
        JPY: { name: "Japanese Yen", symbol: "¥", locale: "ja-JP" },
        AED: { name: "UAE Dirham", symbol: "د.إ", locale: "en-AE" },
        SGD: { name: "Singapore Dollar", symbol: "S$", locale: "en-SG" },
        CHF: { name: "Swiss Franc", symbol: "CHF", locale: "de-CH" },
        CNY: { name: "Chinese Yuan", symbol: "CN¥", locale: "zh-CN" },
        NZD: { name: "New Zealand Dollar", symbol: "NZ$", locale: "en-NZ" },
        SAR: { name: "Saudi Riyal", symbol: "﷼", locale: "en-SA" },
        BDT: { name: "Bangladeshi Taka", symbol: "৳", locale: "en-BD" },
        PKR: { name: "Pakistani Rupee", symbol: "₨", locale: "en-PK" },
        NPR: { name: "Nepalese Rupee", symbol: "रू", locale: "en-NP" },
        LKR: { name: "Sri Lankan Rupee", symbol: "Rs", locale: "en-LK" },
        ZAR: { name: "South African Rand", symbol: "R", locale: "en-ZA" },
        KRW: { name: "South Korean Won", symbol: "₩", locale: "ko-KR" },
        BRL: { name: "Brazilian Real", symbol: "R$", locale: "pt-BR" },
        MYR: { name: "Malaysian Ringgit", symbol: "RM", locale: "ms-MY" },
        IDR: { name: "Indonesian Rupiah", symbol: "Rp", locale: "id-ID" },
        THB: { name: "Thai Baht", symbol: "฿", locale: "th-TH" },
        MXN: { name: "Mexican Peso", symbol: "MX$", locale: "es-MX" },
        NGN: { name: "Nigerian Naira", symbol: "₦", locale: "en-NG" },
        KES: { name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE" },
        EGP: { name: "Egyptian Pound", symbol: "E£", locale: "en-EG" },
        TRY: { name: "Turkish Lira", symbol: "₺", locale: "tr-TR" },
        SEK: { name: "Swedish Krona", symbol: "kr", locale: "sv-SE" },
        NOK: { name: "Norwegian Krone", symbol: "kr", locale: "nb-NO" },
        DKK: { name: "Danish Krone", symbol: "kr", locale: "da-DK" },
        PLN: { name: "Polish Zloty", symbol: "zł", locale: "pl-PL" },
        QAR: { name: "Qatari Riyal", symbol: "ر.ق", locale: "en-QA" },
        KWD: { name: "Kuwaiti Dinar", symbol: "د.ك", locale: "en-KW" },
        BHD: { name: "Bahraini Dinar", symbol: "د.ب", locale: "en-BH" },
        OMR: { name: "Omani Rial", symbol: "ر.ع.", locale: "en-OM" },
        PHP: { name: "Philippine Peso", symbol: "₱", locale: "en-PH" },
        VND: { name: "Vietnamese Dong", symbol: "₫", locale: "vi-VN" },
        ARS: { name: "Argentine Peso", symbol: "AR$", locale: "es-AR" }
    };

    const COUNTRY_CURRENCIES = {
        India: "INR",
        "United States": "USD",
        "United Kingdom": "GBP",
        Canada: "CAD",
        Australia: "AUD",
        Germany: "EUR",
        France: "EUR",
        Italy: "EUR",
        Spain: "EUR",
        Netherlands: "EUR",
        Belgium: "EUR",
        Ireland: "EUR",
        Portugal: "EUR",
        Finland: "EUR",
        Switzerland: "CHF",
        Sweden: "SEK",
        Norway: "NOK",
        Denmark: "DKK",
        Poland: "PLN",
        Japan: "JPY",
        China: "CNY",
        "South Korea": "KRW",
        Singapore: "SGD",
        Malaysia: "MYR",
        Indonesia: "IDR",
        Thailand: "THB",
        Philippines: "PHP",
        Vietnam: "VND",
        "United Arab Emirates": "AED",
        "Saudi Arabia": "SAR",
        Qatar: "QAR",
        Kuwait: "KWD",
        Oman: "OMR",
        Bahrain: "BHD",
        "South Africa": "ZAR",
        Nigeria: "NGN",
        Kenya: "KES",
        Egypt: "EGP",
        Brazil: "BRL",
        Mexico: "MXN",
        Argentina: "ARS",
        "New Zealand": "NZD",
        Turkey: "TRY",
        Bangladesh: "BDT",
        Pakistan: "PKR",
        Nepal: "NPR",
        "Sri Lanka": "LKR"
    };

    /*
     * Exchange-based fallback is used only when the stock API
     * does not provide an explicit currency.
     */
    const EXCHANGE_CURRENCIES = {
        NSE: "INR",
        BSE: "INR",
        "NSEI": "INR",
        "BOM": "INR",
        LSE: "GBP",
        NYSE: "USD",
        NASDAQ: "USD",
        AMEX: "USD",
        TSX: "CAD",
        ASX: "AUD",
        TSE: "JPY",
        JPX: "JPY",
        SGX: "SGD"
    };

    const state = {
        alerts: [],
        filteredAlerts: [],
        currentPage: 1,

        searchQuery: "",
        statusFilter: "all",
        sortOrder: "newest",

        loading: false,
        creating: false,

        requestController: null,
        requestId: 0,
        lastUpdated: null,

        messageTimer: null,
        modalPreviousFocus: null,

        profile: null,
        preferredCurrency: CONFIG.defaultCurrency,

        selectedAsset: null,
        assetSuggestions: [],
        selectedSuggestionIndex: -1,
        assetSearchTimer: null,
        assetSearchController: null,

        currencySearchValid: false,
        manuallySelectedCurrency: false
    };

    const elements = {};

    /* =====================================================
       2. DOM HELPERS
       ===================================================== */

    function getElement(id) {
        return document.getElementById(id);
    }

    function cacheElements() {
        const ids = [
            "alertsMessage",

            "totalAlertsValue",
            "activeAlertsValue",
            "triggeredAlertsValue",
            "alertsLastUpdated",

            "alertsSearchInput",
            "alertsStatusFilter",
            "alertsSortSelect",
            "alertsResultCount",

            "alertsClearFilters",
            "clearAlertsFiltersButton",

            "alertsLoadingState",
            "alertsList",
            "alertsEmptyState",
            "alertsEmptyIcon",
            "alertsEmptyTitle",
            "alertsEmptyDescription",

            "alertsPagination",
            "alertsPreviousPage",
            "alertsPageIndicator",
            "alertsNextPage",

            "alertsRefreshButton",
            "refreshAlertsButton",

            "sidebarAlertCount",
            "appSidebar",
            "sidebarOverlay",
            "mobileMenuButton",

            "topbarAvatar",
            "topbarUserName",

            "openCreateAlertButton",
            "emptyCreateAlertButton",

            "createAlertModal",
            "closeCreateAlertButton",
            "createAlertForm",

            "alertSymbol",
            "alertSelectedSymbol",
            "alertSymbolSuggestions",
            "alertSymbolSearchIndicator",

            "alertSelectedAsset",
            "alertSelectedAssetName",
            "clearAlertSelectedAsset",

            "alertCurrencySearch",
            "alertCurrencyOptions",
            "alertCurrency",
            "alertPriceCurrencySymbol",
            "alertCurrencyHelp",

            "alertTargetPrice",

            "alertNotificationChannels",
            "alertType",

            "createAlertFormMessage",
            "submitCreateAlertButton",
            "cancelCreateAlertButton"
        ];

        ids.forEach((id) => {
            elements[id] = getElement(id);
        });

        if (!elements.alertsRefreshButton) {
            elements.alertsRefreshButton =
                elements.refreshAlertsButton;
        }

        if (!elements.alertsClearFilters) {
            elements.alertsClearFilters =
                elements.clearAlertsFiltersButton;
        }
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);

        if (className) {
            element.className = className;
        }

        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }

        return element;
    }

    function appendTextElement(parent, tagName, className, text) {
        const element = createElement(tagName, className, text);
        parent.appendChild(element);
        return element;
    }

    function setText(element, value) {
        if (!element) return;

        element.textContent =
            value === undefined || value === null
                ? ""
                : String(value);
    }

    function showElement(element, displayValue = "") {
        if (!element) return;

        element.hidden = false;
        element.style.display = displayValue;
    }

    function hideElement(element) {
        if (!element) return;

        element.hidden = true;
        element.style.display = "none";
    }

    function normalizeString(value) {
        if (value === undefined || value === null) {
            return "";
        }

        return String(value).trim();
    }

    function firstValue(object, keys, fallback = "") {
        if (!object || typeof object !== "object") {
            return fallback;
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

        return fallback;
    }

    function normalizeNumber(value) {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value === "string") {
            const cleaned = value.replace(/[^\d.+-]/g, "");
            const number = Number(cleaned);

            return cleaned !== "" && Number.isFinite(number)
                ? number
                : null;
        }

        return null;
    }

    function setButtonLoading(button, loading) {
        if (!button) return;

        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel =
                button.textContent.trim() || "Refresh";
        }

        button.disabled = loading;
        button.classList.toggle("is-loading", loading);
        button.setAttribute("aria-busy", String(loading));

        button.textContent = loading
            ? "Refreshing..."
            : button.dataset.originalLabel;
    }

    /* =====================================================
       3. CURRENCY HELPERS
       ===================================================== */

    function normalizeCurrency(value) {
        const code = normalizeString(value).toUpperCase();

        return Object.prototype.hasOwnProperty.call(
            CURRENCIES,
            code
        )
            ? code
            : null;
    }

    function currencyLabel(code) {
        const currency = normalizeCurrency(code);

        if (!currency) return "";

        return `${currency} — ${CURRENCIES[currency].name}`;
    }

    function parseCurrencyCode(value) {
        const text = normalizeString(value);

        if (!text) return null;

        const direct = normalizeCurrency(text);

        if (direct) return direct;

        const match = text.match(/^([A-Z]{3})\s*[—-]/i);

        if (match) {
            return normalizeCurrency(match[1]);
        }

        const upper = text.toUpperCase();

        for (const [code, details] of Object.entries(CURRENCIES)) {
            if (
                upper === details.name.toUpperCase() ||
                upper === `${code} ${details.name}`.toUpperCase()
            ) {
                return code;
            }
        }

        return null;
    }

    function getCurrencySymbol(code) {
        const currency = normalizeCurrency(code);

        return currency
            ? CURRENCIES[currency].symbol
            : "¤";
    }

    function getCurrencyLocale(code) {
        const currency = normalizeCurrency(code);

        return currency
            ? CURRENCIES[currency].locale
            : CONFIG.defaultLocale;
    }

    function formatCurrency(value, currencyCode) {
        const number = normalizeNumber(value);

        if (number === null) return "—";

        const currency = normalizeCurrency(
            currencyCode || state.preferredCurrency
        ) || CONFIG.defaultCurrency;

        try {
            return new Intl.NumberFormat(
                getCurrencyLocale(currency),
                {
                    style: "currency",
                    currency,
                    currencyDisplay: "code",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            ).format(number);
        } catch (error) {
            return `${currency} ${number.toFixed(2)}`;
        }
    }

    function populateCurrencyOptions() {
        const datalist = elements.alertCurrencyOptions;

        if (!datalist) return;

        datalist.replaceChildren();

        Object.entries(CURRENCIES).forEach(([code, details]) => {
            const option = document.createElement("option");
            option.value = `${code} — ${details.name}`;
            datalist.appendChild(option);
        });
    }

    function setSelectedCurrency(code, options = {}) {
        const currency = normalizeCurrency(code);

        if (!currency) return false;

        state.currencySearchValid = true;

        if (options.manual === true) {
            state.manuallySelectedCurrency = true;
        }

        if (elements.alertCurrency) {
            elements.alertCurrency.value = currency;
        }

        if (elements.alertCurrencySearch) {
            elements.alertCurrencySearch.value =
                currencyLabel(currency);
        }

        setText(
            elements.alertPriceCurrencySymbol,
            getCurrencySymbol(currency)
        );

        if (elements.alertCurrencyHelp) {
            setText(
                elements.alertCurrencyHelp,
                `Target price will be saved in ${currency} (${CURRENCIES[currency].name}).`
            );
        }

        return true;
    }

    function handleCurrencyInput() {
        const input = elements.alertCurrencySearch;

        if (!input) return;

        const currency = parseCurrencyCode(input.value);

        if (currency) {
            setSelectedCurrency(currency, { manual: true });
            return;
        }

        state.currencySearchValid = false;

        if (elements.alertCurrency) {
            elements.alertCurrency.value = "";
        }

        setText(elements.alertPriceCurrencySymbol, "¤");

        setText(
            elements.alertCurrencyHelp,
            "Select a supported currency from the suggestions."
        );
    }

    /* =====================================================
       4. PROFILE AND DEFAULT CURRENCY
       ===================================================== */

    function unwrapProfile(payload) {
        if (!payload || typeof payload !== "object") {
            return {};
        }

        let result =
            payload.user ||
            payload.profile ||
            payload.data ||
            payload;

        if (result && result.user) {
            result = result.user;
        }

        return result && typeof result === "object"
            ? result
            : {};
    }

    async function loadProfilePreferences() {
        for (const endpoint of CONFIG.profileEndpoints) {
            try {
                const payload = await requestJSON(endpoint);
                const profile = unwrapProfile(payload);

                if (!profile || !Object.keys(profile).length) {
                    continue;
                }

                state.profile = profile;

                const country = normalizeString(
                    firstValue(
                        profile,
                        ["country", "user_country"],
                        ""
                    )
                );

                const savedCurrency = normalizeCurrency(
                    firstValue(
                        profile,
                        [
                            "preferred_currency",
                            "preferredCurrency",
                            "currency"
                        ],
                        ""
                    )
                );

                state.preferredCurrency =
                    savedCurrency ||
                    COUNTRY_CURRENCIES[country] ||
                    CONFIG.defaultCurrency;

                setSelectedCurrency(state.preferredCurrency);

                const name = normalizeString(
                    firstValue(
                        profile,
                        ["name", "full_name", "username"],
                        ""
                    )
                );

                if (name) {
                    setText(elements.topbarUserName, name);

                    setText(
                        elements.topbarAvatar,
                        name.charAt(0).toUpperCase()
                    );
                }

                return profile;

            } catch (error) {
                if (error.status === 401 || error.status === 403) {
                    throw error;
                }

                console.warn(
                    `[Market Plus AI] Profile lookup failed: ${endpoint}`,
                    error
                );
            }
        }

        state.preferredCurrency = CONFIG.defaultCurrency;
        setSelectedCurrency(CONFIG.defaultCurrency);

        return null;
    }

    /* =====================================================
       5. DATE AND NUMBER FORMATTERS
       ===================================================== */

    function formatInteger(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) return "0";

        return new Intl.NumberFormat(
            getCurrencyLocale(state.preferredCurrency),
            { maximumFractionDigits: 0 }
        ).format(number);
    }

    function parseDate(value) {
        if (!value) return null;

        const date = value instanceof Date
            ? value
            : new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    function formatDate(value) {
        const date = parseDate(value);

        if (!date) return "Date unavailable";

        return new Intl.DateTimeFormat(
            getCurrencyLocale(state.preferredCurrency),
            {
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }

    function formatDateTime(value) {
        const date = parseDate(value);

        if (!date) return "Creation date unavailable";

        return new Intl.DateTimeFormat(
            getCurrencyLocale(state.preferredCurrency),
            {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
            }
        ).format(date);
    }

    function formatTimeOnly(date) {
        if (
            !(date instanceof Date) ||
            Number.isNaN(date.getTime())
        ) {
            return "Not updated";
        }

        return new Intl.DateTimeFormat(
            getCurrencyLocale(state.preferredCurrency),
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            }
        ).format(date);
    }

    /* =====================================================
       6. STATUS NORMALIZATION
       ===================================================== */

    function normalizeStatus(alert) {
        const rawStatus = normalizeString(
            firstValue(
                alert,
                ["status", "alert_status", "state"],
                ""
            )
        ).toLowerCase();

        const isActive = firstValue(
            alert,
            ["is_active", "active", "enabled"],
            undefined
        );

        const isTriggered = firstValue(
            alert,
            ["is_triggered", "triggered", "has_triggered"],
            undefined
        );

        if (
            isTriggered === true ||
            isTriggered === 1 ||
            String(isTriggered).toLowerCase() === "true"
        ) {
            return "triggered";
        }

        if (
            rawStatus.includes("trigger") ||
            rawStatus.includes("hit") ||
            rawStatus.includes("reached")
        ) {
            return "triggered";
        }

        if (
            rawStatus.includes("expired") ||
            rawStatus.includes("expiry")
        ) {
            return "expired";
        }

        if (
            rawStatus.includes("cancel") ||
            rawStatus.includes("deleted")
        ) {
            return "cancelled";
        }

        if (
            rawStatus.includes("pause") ||
            rawStatus.includes("disabled") ||
            rawStatus.includes("inactive")
        ) {
            return "paused";
        }

        if (
            isActive === false ||
            isActive === 0 ||
            String(isActive).toLowerCase() === "false"
        ) {
            return "paused";
        }

        if (
            rawStatus.includes("active") ||
            rawStatus.includes("pending") ||
            rawStatus.includes("watch")
        ) {
            return "active";
        }

        if (isActive === true || isActive === 1) {
            return "active";
        }

        return rawStatus || "unknown";
    }

    function getStatusLabel(status) {
        const labels = {
            active: "Active",
            triggered: "Target reached",
            paused: "Paused",
            expired: "Expired",
            cancelled: "Cancelled",
            unknown: "Status unavailable"
        };

        return labels[status] || (
            status.charAt(0).toUpperCase() + status.slice(1)
        );
    }

    function getStatusClass(status) {
        const allowed = [
            "active",
            "triggered",
            "paused",
            "expired",
            "cancelled"
        ];

        return allowed.includes(status)
            ? status
            : "unknown";
    }

    function isActiveAlert(alert) {
        return normalizeStatus(alert) === "active";
    }

    function isTriggeredAlert(alert) {
        return normalizeStatus(alert) === "triggered";
    }

    /* =====================================================
       7. ALERT DATA NORMALIZATION
       ===================================================== */

    function normalizeAlert(raw, index) {
        const alert = raw && typeof raw === "object"
            ? raw
            : {};

        const symbol = normalizeString(
            firstValue(
                alert,
                [
                    "symbol",
                    "ticker",
                    "asset_symbol",
                    "stock_symbol",
                    "stockSymbol"
                ],
                ""
            )
        );

        const name = normalizeString(
            firstValue(
                alert,
                [
                    "asset_name",
                    "company_name",
                    "company",
                    "name",
                    "stock_name",
                    "stockName"
                ],
                symbol || "Unknown asset"
            )
        );

        const targetPrice = normalizeNumber(
            firstValue(
                alert,
                [
                    "target_price",
                    "targetPrice",
                    "target",
                    "desired_price",
                    "desiredPrice",
                    "price_target"
                ],
                null
            )
        );

        const currentPrice = normalizeNumber(
            firstValue(
                alert,
                [
                    "current_price",
                    "currentPrice",
                    "market_price",
                    "marketPrice",
                    "last_price",
                    "lastPrice"
                ],
                null
            )
        );

        const createdAt = firstValue(
            alert,
            ["created_at", "createdAt", "created", "timestamp"],
            null
        );

        const updatedAt = firstValue(
            alert,
            [
                "updated_at",
                "updatedAt",
                "last_checked_at",
                "lastCheckedAt"
            ],
            null
        );

        const rawId = firstValue(
            alert,
            ["id", "alert_id", "alertId", "uuid"],
            `unknown-${index}`
        );

        const currency = normalizeCurrency(
            firstValue(
                alert,
                [
                    "currency",
                    "target_currency",
                    "preferred_currency"
                ],
                state.preferredCurrency
            )
        ) || state.preferredCurrency;

        const channels = [];

        /*
         * Existing alerts may have been created before the
         * three-channel implementation. Their saved settings
         * are displayed accurately.
         */
        if (
            alert.in_app_enabled !== false &&
            alert.in_app_enabled !== 0
        ) {
            channels.push("in_app");
        }

        if (
            alert.email_enabled === true ||
            alert.email_enabled === 1 ||
            String(alert.email_enabled).toLowerCase() === "true"
        ) {
            channels.push("email");
        }

        if (
            alert.sms_enabled === true ||
            alert.sms_enabled === 1 ||
            String(alert.sms_enabled).toLowerCase() === "true"
        ) {
            channels.push("sms");
        }

        /*
         * New alerts created by this page always request all
         * three channels. This fallback is for legacy records
         * whose backend response has no channel fields.
         */
        if (
            !Object.prototype.hasOwnProperty.call(alert, "email_enabled") &&
            !Object.prototype.hasOwnProperty.call(alert, "sms_enabled")
        ) {
            channels.splice(0, channels.length, ...CONFIG.notificationChannels);
        }

        return {
            id: String(rawId),
            symbol: symbol || "N/A",
            name,
            targetPrice,
            currentPrice,
            currency,
            channels,
            status: normalizeStatus(alert),
            createdAt,
            updatedAt,
            original: alert
        };
    }

    /* =====================================================
       8. MESSAGE HANDLING
       ===================================================== */

    function showMessage(message, type = "info") {
        const element = elements.alertsMessage;

        if (!element) return;

        element.textContent = message;
        element.className = "alerts-message";
        element.classList.add(type);

        showElement(element);

        if (state.messageTimer) {
            window.clearTimeout(state.messageTimer);
        }

        if (type !== "error") {
            state.messageTimer = window.setTimeout(
                clearMessage,
                5000
            );
        }
    }

    function clearMessage() {
        const element = elements.alertsMessage;

        if (!element) return;

        element.textContent = "";
        element.className = "alerts-message";
        hideElement(element);

        if (state.messageTimer) {
            window.clearTimeout(state.messageTimer);
            state.messageTimer = null;
        }
    }

    function showFormMessage(message, type = "error") {
        const element = elements.createAlertFormMessage;

        if (!element) return;

        element.textContent = message;
        element.className = "alerts-form-message";
        element.classList.add(type);

        showElement(element);
    }

    function clearFormMessage() {
        const element = elements.createAlertFormMessage;

        if (!element) return;

        element.textContent = "";
        element.className = "alerts-form-message";
        hideElement(element);
    }

    /* =====================================================
       9. API REQUEST HELPER
       ===================================================== */

    async function requestJSON(url, options = {}) {
        const controller =
            options.controller || new AbortController();

        const timeout = window.setTimeout(
            () => controller.abort(),
            CONFIG.requestTimeout
        );

        const headers = {
            Accept: "application/json",
            ...(options.headers || {})
        };

        if (options.body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        try {
            const response = await fetch(url, {
                method: options.method || "GET",
                credentials: "same-origin",
                headers,
                cache: "no-store",
                signal: controller.signal,
                body: options.body
            });

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                const error = new Error(
                    "Your session may have expired. Please sign in again."
                );

                error.status = response.status;
                throw error;
            }

            const contentType =
                response.headers.get("content-type") || "";

            let payload;

            if (contentType.includes("application/json")) {
                payload = await response.json();
            } else {
                const responseText = await response.text();

                if (!response.ok) {
                    const error = new Error(
                        responseText.trim().slice(0, 250) ||
                        `Request failed (${response.status}).`
                    );

                    error.status = response.status;
                    throw error;
                }

                try {
                    payload = JSON.parse(responseText);
                } catch (error) {
                    throw new Error(
                        "The server returned an unexpected response."
                    );
                }
            }

            if (!response.ok) {
                const error = new Error(
                    String(
                        firstValue(
                            payload,
                            ["message", "error", "detail"],
                            `Request failed (${response.status}).`
                        )
                    )
                );

                error.status = response.status;
                throw error;
            }

            if (
                payload &&
                typeof payload === "object" &&
                payload.success === false
            ) {
                throw new Error(
                    normalizeString(
                        firstValue(
                            payload,
                            ["message", "error"],
                            "The request was unsuccessful."
                        )
                    )
                );
            }

            return payload;

        } catch (error) {
            if (error.name === "AbortError") {
                const timeoutError = new Error(
                    "The request timed out. Please try again."
                );

                timeoutError.name = "TimeoutError";
                throw timeoutError;
            }

            throw error;

        } finally {
            window.clearTimeout(timeout);
        }
    }

    function extractAlerts(payload) {
        if (Array.isArray(payload)) return payload;

        if (!payload || typeof payload !== "object") {
            return [];
        }

        const candidates = [
            payload.alerts,
            payload.items,
            payload.results,
            payload.data,
            payload.records
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) {
                return candidate;
            }

            if (candidate && typeof candidate === "object") {
                for (const key of [
                    "alerts",
                    "items",
                    "results",
                    "records"
                ]) {
                    if (Array.isArray(candidate[key])) {
                        return candidate[key];
                    }
                }
            }
        }

        return [];
    }

    /* =====================================================
       10. LOADING STATE
       ===================================================== */

    function setLoading(loading) {
        state.loading = loading;

        if (loading) {
            showElement(elements.alertsLoadingState);
            hideElement(elements.alertsEmptyState);
        } else {
            hideElement(elements.alertsLoadingState);
        }

        if (elements.alertsList) {
            elements.alertsList.setAttribute(
                "aria-busy",
                String(loading)
            );
        }

        setButtonLoading(
            elements.alertsRefreshButton,
            loading
        );
    }

    /* =====================================================
       11. LOAD ALERTS
       ===================================================== */

    async function loadAlerts(options = {}) {
        if (state.loading && !options.force) return;

        const currentRequestId = ++state.requestId;

        if (state.requestController) {
            state.requestController.abort();
        }

        const controller = new AbortController();
        state.requestController = controller;

        setLoading(true);
        clearMessage();

        try {
            const payload = await requestJSON(
                CONFIG.alertsEndpoint,
                { controller }
            );

            if (currentRequestId !== state.requestId) {
                return;
            }

            state.alerts = extractAlerts(payload).map(
                (alert, index) => normalizeAlert(alert, index)
            );

            state.lastUpdated = new Date();

            updateSummary();
            updateLastUpdated();
            updateSidebarCount();
            applyFilters();

            if (options.showSuccess) {
                showMessage(
                    "Price alerts refreshed successfully.",
                    "success"
                );
            }

        } catch (error) {
            if (
                currentRequestId !== state.requestId ||
                (
                    controller.signal.aborted &&
                    error.name === "AbortError"
                )
            ) {
                return;
            }

            console.error(
                "[Market Plus AI] Failed to load alerts:",
                error
            );

            state.alerts = [];
            state.filteredAlerts = [];

            updateSummary();
            updateSidebarCount();
            renderAlerts();

            if (
                error.status === 401 ||
                error.status === 403
            ) {
                showMessage(
                    "Your session has expired. Please sign in again.",
                    "error"
                );

                window.setTimeout(() => {
                    window.location.href = CONFIG.loginPage;
                }, 1200);

            } else {
                showMessage(
                    error.message ||
                    "Unable to load alerts. Please try again later.",
                    "error"
                );

                showEmptyState(
                    "Unable to load alerts",
                    "We couldn't retrieve your price alerts. Check your connection and try refreshing.",
                    "!"
                );
            }

        } finally {
            if (currentRequestId === state.requestId) {
                state.loading = false;
                setLoading(false);
                state.requestController = null;
            }
        }
    }

    /* =====================================================
       12. SUMMARY STATISTICS
       ===================================================== */

    function updateSummary() {
        const total = state.alerts.length;

        const active = state.alerts.filter(
            isActiveAlert
        ).length;

        const triggered = state.alerts.filter(
            isTriggeredAlert
        ).length;

        setText(
            elements.totalAlertsValue,
            formatInteger(total)
        );

        setText(
            elements.activeAlertsValue,
            formatInteger(active)
        );

        setText(
            elements.triggeredAlertsValue,
            formatInteger(triggered)
        );
    }

    function updateLastUpdated() {
        if (!elements.alertsLastUpdated) return;

        if (!state.lastUpdated) {
            setText(
                elements.alertsLastUpdated,
                "Not updated"
            );

            return;
        }

        setText(
            elements.alertsLastUpdated,
            formatTimeOnly(state.lastUpdated)
        );

        elements.alertsLastUpdated.setAttribute(
            "title",
            state.lastUpdated.toLocaleString()
        );
    }

    function updateSidebarCount() {
        const activeCount = state.alerts.filter(
            isActiveAlert
        ).length;

        setText(
            elements.sidebarAlertCount,
            formatInteger(activeCount)
        );

        if (elements.sidebarAlertCount) {
            elements.sidebarAlertCount.setAttribute(
                "aria-label",
                `${activeCount} active price alerts`
            );

            elements.sidebarAlertCount.hidden =
                activeCount === 0;
        }
    }

    /* =====================================================
       13. SEARCH, FILTER AND SORT
       ===================================================== */

    function applyFilters() {
        const query = state.searchQuery.trim().toLowerCase();
        const status = state.statusFilter;

        let result = state.alerts.filter((alert) => {
            const searchableText = [
                alert.name,
                alert.symbol,
                alert.status,
                alert.currency
            ].join(" ").toLowerCase();

            const matchesSearch =
                !query || searchableText.includes(query);

            let matchesStatus = true;

            if (status === "inactive") {
                matchesStatus = [
                    "paused",
                    "expired",
                    "cancelled"
                ].includes(alert.status);
            } else if (status !== "all") {
                matchesStatus = alert.status === status;
            }

            return matchesSearch && matchesStatus;
        });

        result = sortAlerts(result);

        state.filteredAlerts = result;
        state.currentPage = Math.max(1, state.currentPage);

        renderAlerts();
    }

    function sortAlerts(alerts) {
        const result = [...alerts];

        result.sort((a, b) => {
            if (state.sortOrder === "oldest") {
                return compareDates(a.createdAt, b.createdAt);
            }

            if (
                state.sortOrder === "target_low" ||
                state.sortOrder === "target-low"
            ) {
                return compareNullableNumbers(
                    a.targetPrice,
                    b.targetPrice,
                    "ascending"
                );
            }

            if (
                state.sortOrder === "target_high" ||
                state.sortOrder === "target-high"
            ) {
                return compareNullableNumbers(
                    a.targetPrice,
                    b.targetPrice,
                    "descending"
                );
            }

            return compareDates(b.createdAt, a.createdAt);
        });

        return result;
    }

    function compareDates(a, b) {
        const first = parseDate(a);
        const second = parseDate(b);

        if (!first && !second) return 0;
        if (!first) return 1;
        if (!second) return -1;

        return first.getTime() - second.getTime();
    }

    function compareNullableNumbers(a, b, direction) {
        const first = normalizeNumber(a);
        const second = normalizeNumber(b);

        if (first === null && second === null) return 0;
        if (first === null) return 1;
        if (second === null) return -1;

        return direction === "ascending"
            ? first - second
            : second - first;
    }

    function clearFilters() {
        state.searchQuery = "";
        state.statusFilter = "all";
        state.sortOrder = "newest";
        state.currentPage = 1;

        if (elements.alertsSearchInput) {
            elements.alertsSearchInput.value = "";
        }

        if (elements.alertsStatusFilter) {
            elements.alertsStatusFilter.value = "all";
        }

        if (elements.alertsSortSelect) {
            elements.alertsSortSelect.value = "newest";
        }

        applyFilters();
    }

    /* =====================================================
       14. ALERT CARD CREATION
       ===================================================== */

    function createAlertCard(alert) {
        const card = createElement(
            "article",
            "alert-card"
        );

        card.dataset.alertId = alert.id;

        const header = createElement(
            "div",
            "alert-card-header"
        );

        const asset = createElement(
            "div",
            "alert-asset"
        );

        const icon = createElement(
            "div",
            "alert-asset-icon",
            getSymbolInitials(alert.symbol)
        );

        icon.setAttribute("aria-hidden", "true");

        const details = createElement(
            "div",
            "alert-asset-details"
        );

        appendTextElement(
            details,
            "h3",
            "alert-asset-name",
            alert.name
        );

        appendTextElement(
            details,
            "p",
            "alert-asset-symbol",
            alert.symbol
        );

        asset.append(icon, details);

        const status = createElement(
            "span",
            `alert-status ${getStatusClass(alert.status)}`,
            getStatusLabel(alert.status)
        );

        header.append(asset, status);
        card.appendChild(header);

        const priceDetails = createElement(
            "div",
            "alert-price-details"
        );

        addPriceDetail(
            priceDetails,
            "Target price",
            formatCurrency(alert.targetPrice, alert.currency),
            "target"
        );

        addPriceDetail(
            priceDetails,
            "Latest price",
            alert.currentPrice === null
                ? "Not available"
                : formatCurrency(
                    alert.currentPrice,
                    alert.currency
                ),
            ""
        );

        addPriceDetail(
            priceDetails,
            "Condition",
            "Target price reached",
            ""
        );

        addPriceDetail(
            priceDetails,
            "Notifications",
            formatNotificationChannels(alert.channels),
            ""
        );

        card.appendChild(priceDetails);

        const footer = createElement(
            "div",
            "alert-card-footer"
        );

        const metadata = createElement(
            "div",
            "alert-created-at",
            `Created: ${formatDateTime(alert.createdAt)}`
        );

        footer.appendChild(metadata);
        card.appendChild(footer);

        return card;
    }

    function getSymbolInitials(symbol) {
        if (!symbol || symbol === "N/A") return "—";

        const cleaned = symbol
            .replace(/\.NS$/i, "")
            .replace(/\.BO$/i, "")
            .replace(/[^a-zA-Z0-9]/g, "");

        return (cleaned.slice(0, 3) || "—").toUpperCase();
    }

    function formatNotificationChannels(channels) {
        const labels = {
            in_app: "In-app",
            email: "Email",
            sms: "SMS"
        };

        const selected = (channels || [])
            .map((channel) => labels[channel])
            .filter(Boolean);

        return selected.length
            ? selected.join(" · ")
            : "No notification channels";
    }

    function addPriceDetail(parent, label, value, extraClass) {
        const item = createElement(
            "div",
            "alert-price-detail"
        );

        appendTextElement(
            item,
            "span",
            "alert-price-label",
            label
        );

        appendTextElement(
            item,
            "span",
            `alert-price-value${extraClass ? ` ${extraClass}` : ""}`,
            value
        );

        parent.appendChild(item);
    }

    /* =====================================================
       15. RENDER RESULTS
       ===================================================== */

    function renderAlerts() {
        const list = elements.alertsList;

        if (!list) return;

        list.replaceChildren();

        const totalFiltered = state.filteredAlerts.length;

        const totalPages = Math.max(
            1,
            Math.ceil(totalFiltered / CONFIG.pageSize)
        );

        if (state.currentPage > totalPages) {
            state.currentPage = totalPages;
        }

        const startIndex =
            (state.currentPage - 1) * CONFIG.pageSize;

        const pageAlerts = state.filteredAlerts.slice(
            startIndex,
            startIndex + CONFIG.pageSize
        );

        if (totalFiltered === 0) {
            hideElement(list);

            if (state.alerts.length === 0) {
                showEmptyState(
                    "No price alerts yet",
                    "Create a price alert to keep track of your target prices. Your alerts will appear here when available.",
                    "◎"
                );
            } else {
                showEmptyState(
                    "No matching alerts",
                    "Try changing your search or filters to find the alerts you are looking for.",
                    "⌕"
                );
            }

            updateResultsCount(0, 0);
            updatePagination(0, 1);

            return;
        }

        hideElement(elements.alertsEmptyState);
        showElement(list, "flex");

        const fragment = document.createDocumentFragment();

        pageAlerts.forEach((alert) => {
            fragment.appendChild(createAlertCard(alert));
        });

        list.appendChild(fragment);

        updateResultsCount(
            Math.min(
                startIndex + pageAlerts.length,
                totalFiltered
            ),
            totalFiltered,
            startIndex
        );

        updatePagination(totalFiltered, totalPages);
    }

    function updateResultsCount(
        displayedEnd,
        total,
        startIndex = 0
    ) {
        if (!elements.alertsResultCount) return;

        if (total === 0) {
            setText(elements.alertsResultCount, "0 alerts");
            return;
        }

        setText(
            elements.alertsResultCount,
            `${startIndex + 1}–${displayedEnd} of ${formatInteger(total)} alerts`
        );
    }

    function updatePagination(total, totalPages) {
        const pagination = elements.alertsPagination;

        if (!pagination) return;

        if (total === 0) {
            hideElement(pagination);
            return;
        }

        showElement(pagination, "flex");

        if (elements.alertsPreviousPage) {
            elements.alertsPreviousPage.disabled =
                state.currentPage <= 1;
        }

        if (elements.alertsNextPage) {
            elements.alertsNextPage.disabled =
                state.currentPage >= totalPages;
        }

        setText(
            elements.alertsPageIndicator,
            `Page ${state.currentPage} of ${totalPages}`
        );
    }

    function showEmptyState(title, description, icon = "◎") {
        const empty = elements.alertsEmptyState;

        if (!empty) return;

        setText(elements.alertsEmptyTitle, title);
        setText(elements.alertsEmptyDescription, description);
        setText(elements.alertsEmptyIcon, icon);

        showElement(empty);
    }

    /* =====================================================
       16. ASSET SEARCH AND CURRENCY DETECTION
       ===================================================== */

    function extractStockResults(payload) {
        if (Array.isArray(payload)) return payload;

        if (!payload || typeof payload !== "object") {
            return [];
        }

        const candidates = [
            payload.results,
            payload.stocks,
            payload.assets,
            payload.items,
            payload.data
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) return candidate;

            if (candidate && typeof candidate === "object") {
                for (const key of [
                    "results",
                    "stocks",
                    "assets",
                    "items"
                ]) {
                    if (Array.isArray(candidate[key])) {
                        return candidate[key];
                    }
                }
            }
        }

        return [];
    }

    function detectAssetCurrency(asset, symbol, exchange) {
        const explicitCurrency = normalizeCurrency(
            firstValue(
                asset,
                [
                    "currency",
                    "financial_currency",
                    "financialCurrency",
                    "currency_code",
                    "currencyCode",
                    "quote_currency",
                    "quoteCurrency",
                    "trading_currency",
                    "tradingCurrency"
                ],
                ""
            )
        );

        if (explicitCurrency) {
            return explicitCurrency;
        }

        const exchangeCode = normalizeString(exchange)
            .toUpperCase()
            .replace(/\s+/g, "");

        if (EXCHANGE_CURRENCIES[exchangeCode]) {
            return EXCHANGE_CURRENCIES[exchangeCode];
        }

        const upperSymbol = normalizeString(symbol).toUpperCase();

        if (
            upperSymbol.endsWith(".NS") ||
            upperSymbol.endsWith(".BO")
        ) {
            return "INR";
        }

        if (upperSymbol.endsWith(".L")) return "GBP";
        if (upperSymbol.endsWith(".TO")) return "CAD";
        if (upperSymbol.endsWith(".AX")) return "AUD";
        if (upperSymbol.endsWith(".T")) return "JPY";
        if (upperSymbol.endsWith(".SI")) return "SGD";

        return null;
    }

    function normalizeAsset(item) {
        const asset = item && typeof item === "object"
            ? item
            : {};

        const symbol = normalizeString(
            firstValue(
                asset,
                [
                    "symbol",
                    "ticker",
                    "stock_symbol",
                    "ticker_symbol"
                ],
                ""
            )
        ).toUpperCase();

        const name = normalizeString(
            firstValue(
                asset,
                [
                    "name",
                    "company_name",
                    "company",
                    "long_name",
                    "short_name",
                    "display_name"
                ],
                symbol
            )
        );

        const exchange = normalizeString(
            firstValue(
                asset,
                [
                    "exchange",
                    "market",
                    "exchange_name",
                    "full_exchange_name"
                ],
                ""
            )
        );

        const currency = detectAssetCurrency(
            asset,
            symbol,
            exchange
        );

        return {
            symbol,
            name: name || symbol,
            exchange,
            currency,
            original: asset
        };
    }

    function showAssetSearchIndicator(show) {
        if (!elements.alertSymbolSearchIndicator) return;

        if (show) {
            setText(
                elements.alertSymbolSearchIndicator,
                "Searching..."
            );

            showElement(
                elements.alertSymbolSearchIndicator
            );
        } else {
            hideElement(
                elements.alertSymbolSearchIndicator
            );
        }
    }

    function hideAssetSuggestions() {
        const container = elements.alertSymbolSuggestions;

        if (!container) return;

        container.replaceChildren();
        hideElement(container);

        if (elements.alertSymbol) {
            elements.alertSymbol.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        state.assetSuggestions = [];
        state.selectedSuggestionIndex = -1;
    }

    function showAssetSuggestions(assets) {
        const container = elements.alertSymbolSuggestions;

        if (!container) return;

        container.replaceChildren();

        state.assetSuggestions = assets;
        state.selectedSuggestionIndex = -1;

        if (!assets.length) {
            container.appendChild(
                createElement(
                    "div",
                    "alert-suggestion-empty",
                    "No matching assets found."
                )
            );

            showElement(container);
            return;
        }

        const fragment = document.createDocumentFragment();

        assets.forEach((asset, index) => {
            const button = createElement(
                "button",
                "alert-symbol-suggestion"
            );

            button.type = "button";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");
            button.dataset.index = String(index);

            const details = createElement(
                "span",
                "alert-suggestion-details"
            );

            appendTextElement(
                details,
                "strong",
                "alert-suggestion-name",
                asset.name
            );

            appendTextElement(
                details,
                "small",
                "alert-suggestion-symbol",
                asset.symbol
            );

            button.appendChild(details);

            if (asset.exchange) {
                appendTextElement(
                    button,
                    "span",
                    "alert-suggestion-exchange",
                    asset.exchange
                );
            }

            if (asset.currency) {
                appendTextElement(
                    button,
                    "span",
                    "alert-suggestion-currency",
                    asset.currency
                );
            }

            button.addEventListener("click", () => {
                selectAsset(asset);
            });

            fragment.appendChild(button);
        });

        container.appendChild(fragment);
        showElement(container);

        if (elements.alertSymbol) {
            elements.alertSymbol.setAttribute(
                "aria-expanded",
                "true"
            );
        }
    }

    function selectAsset(asset) {
        if (!asset || !asset.symbol) return;

        state.selectedAsset = asset;
        state.manuallySelectedCurrency = false;

        if (elements.alertSymbol) {
            elements.alertSymbol.value = asset.symbol;
        }

        if (elements.alertSelectedSymbol) {
            elements.alertSelectedSymbol.value = asset.symbol;
        }

        setText(
            elements.alertSelectedAssetName,
            `${asset.name} (${asset.symbol})`
        );

        showElement(elements.alertSelectedAsset);

        /*
         * Actual stock currency takes priority over the
         * user's profile currency.
         */
        const selectedCurrency =
            normalizeCurrency(asset.currency) ||
            state.preferredCurrency;

        setSelectedCurrency(selectedCurrency);

        if (!asset.currency && elements.alertCurrencyHelp) {
            setText(
                elements.alertCurrencyHelp,
                `The stock API did not provide a trading currency. Your saved default currency (${selectedCurrency}) is selected. You can change it manually.`
            );
        }

        hideAssetSuggestions();

        if (elements.alertTargetPrice) {
            elements.alertTargetPrice.focus();
        }
    }

    function clearSelectedAsset() {
        state.selectedAsset = null;
        state.manuallySelectedCurrency = false;

        if (elements.alertSelectedSymbol) {
            elements.alertSelectedSymbol.value = "";
        }

        if (elements.alertSymbol) {
            elements.alertSymbol.value = "";
            elements.alertSymbol.focus();
        }

        hideElement(elements.alertSelectedAsset);
        hideAssetSuggestions();

        setSelectedCurrency(state.preferredCurrency);
    }

    async function searchAssets(query) {
        const search = normalizeString(query);

        if (search.length < 2) {
            hideAssetSuggestions();
            showAssetSearchIndicator(false);
            return;
        }

        if (state.assetSearchController) {
            state.assetSearchController.abort();
        }

        const controller = new AbortController();
        state.assetSearchController = controller;

        showAssetSearchIndicator(true);

        try {
            const url = new URL(
                CONFIG.stockSearchEndpoint,
                window.location.origin
            );

            url.searchParams.set("q", search);
            url.searchParams.set(
                "limit",
                String(CONFIG.searchLimit)
            );

            const payload = await requestJSON(
                url.toString(),
                { controller }
            );

            if (controller.signal.aborted) return;

            const results = extractStockResults(payload)
                .map(normalizeAsset)
                .filter((asset) => asset.symbol);

            const unique = [];
            const seen = new Set();

            results.forEach((asset) => {
                const key = asset.symbol.toUpperCase();

                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(asset);
                }
            });

            showAssetSuggestions(unique);

        } catch (error) {
            if (
                error.name !== "AbortError" &&
                !controller.signal.aborted
            ) {
                console.warn(
                    "[Market Plus AI] Asset search failed:",
                    error
                );

                showAssetSuggestions([]);
            }

        } finally {
            if (state.assetSearchController === controller) {
                state.assetSearchController = null;
                showAssetSearchIndicator(false);
            }
        }
    }

    function handleAssetInput() {
        const input = elements.alertSymbol;

        if (!input) return;

        const value = normalizeString(input.value);

        if (
            state.selectedAsset &&
            value.toUpperCase() !==
                state.selectedAsset.symbol.toUpperCase()
        ) {
            state.selectedAsset = null;
            state.manuallySelectedCurrency = false;

            if (elements.alertSelectedSymbol) {
                elements.alertSelectedSymbol.value = "";
            }

            hideElement(elements.alertSelectedAsset);

            setSelectedCurrency(state.preferredCurrency);
        }

        if (state.assetSearchTimer) {
            window.clearTimeout(state.assetSearchTimer);
        }

        if (state.assetSearchController) {
            state.assetSearchController.abort();
        }

        if (value.length < 2) {
            hideAssetSuggestions();
            showAssetSearchIndicator(false);
            return;
        }

        state.assetSearchTimer = window.setTimeout(
            () => searchAssets(value),
            CONFIG.searchDelay
        );
    }

    function moveSuggestionSelection(direction) {
        const suggestions = state.assetSuggestions;

        if (!suggestions.length) return;

        const next =
            state.selectedSuggestionIndex + direction;

        state.selectedSuggestionIndex = Math.max(
            0,
            Math.min(suggestions.length - 1, next)
        );

        const buttons =
            elements.alertSymbolSuggestions?.querySelectorAll(
                ".alert-symbol-suggestion"
            );

        if (!buttons) return;

        buttons.forEach((button, index) => {
            const selected =
                index === state.selectedSuggestionIndex;

            button.setAttribute(
                "aria-selected",
                String(selected)
            );

            button.classList.toggle(
                "is-selected",
                selected
            );
        });
    }

    function bindAssetSearch() {
        if (!elements.alertSymbol) return;

        elements.alertSymbol.addEventListener(
            "input",
            handleAssetInput
        );

        elements.alertSymbol.addEventListener(
            "keydown",
            (event) => {
                if (event.key === "ArrowDown") {
                    if (state.assetSuggestions.length) {
                        event.preventDefault();
                        moveSuggestionSelection(1);
                    }

                } else if (event.key === "ArrowUp") {
                    if (state.assetSuggestions.length) {
                        event.preventDefault();
                        moveSuggestionSelection(-1);
                    }

                } else if (event.key === "Enter") {
                    const selected =
                        state.assetSuggestions[
                            state.selectedSuggestionIndex
                        ];

                    if (selected) {
                        event.preventDefault();
                        selectAsset(selected);
                    }

                } else if (event.key === "Escape") {
                    hideAssetSuggestions();
                }
            }
        );

        elements.alertSymbol.addEventListener(
            "blur",
            () => {
                window.setTimeout(() => {
                    if (
                        !elements.alertSymbolSuggestions?.contains(
                            document.activeElement
                        )
                    ) {
                        hideAssetSuggestions();
                    }
                }, 150);
            }
        );

        if (elements.clearAlertSelectedAsset) {
            elements.clearAlertSelectedAsset.addEventListener(
                "click",
                clearSelectedAsset
            );
        }

        document.addEventListener("click", (event) => {
            if (
                !elements.alertSymbolSuggestions?.contains(
                    event.target
                ) &&
                event.target !== elements.alertSymbol
            ) {
                hideAssetSuggestions();
            }
        });
    }

    /* =====================================================
       17. CREATE ALERT MODAL
       ===================================================== */

    function resetCreateAlertForm() {
        if (elements.createAlertForm) {
            elements.createAlertForm.reset();
        }

        state.selectedAsset = null;
        state.manuallySelectedCurrency = false;

        hideAssetSuggestions();
        hideElement(elements.alertSelectedAsset);

        if (elements.alertSelectedSymbol) {
            elements.alertSelectedSymbol.value = "";
        }

        if (elements.alertSymbol) {
            elements.alertSymbol.value = "";
        }

        if (elements.alertTargetPrice) {
            elements.alertTargetPrice.value = "";
        }

        if (elements.alertNotificationChannels) {
            elements.alertNotificationChannels.value =
                CONFIG.notificationChannels.join(",");
        }

        if (elements.alertType) {
            elements.alertType.value = "target_reached";
        }

        setSelectedCurrency(state.preferredCurrency);
    }

    function openCreateAlertModal() {
        const modal = elements.createAlertModal;

        if (!modal) {
            console.warn(
                "[Market Plus AI] createAlertModal was not found."
            );

            showMessage(
                "The create-alert form is unavailable. Please check alerts.html.",
                "error"
            );

            return;
        }

        if (state.creating) return;

        state.modalPreviousFocus = document.activeElement;

        clearFormMessage();
        resetCreateAlertForm();

        modal.hidden = false;
        modal.style.display = "flex";

        modal.setAttribute("aria-hidden", "false");

        document.body.classList.add("alert-modal-open");

        window.setTimeout(() => {
            elements.alertSymbol?.focus();
        }, 50);
    }

    function closeCreateAlertModal(force = false) {
        const modal = elements.createAlertModal;

        if (!modal) return;

        if (state.creating && !force) return;

        modal.hidden = true;
        modal.style.display = "none";

        modal.setAttribute("aria-hidden", "true");

        document.body.classList.remove("alert-modal-open");

        hideAssetSuggestions();

        if (
            state.modalPreviousFocus &&
            typeof state.modalPreviousFocus.focus === "function"
        ) {
            state.modalPreviousFocus.focus();
        }
    }

    /* =====================================================
       18. CREATE ALERT VALIDATION AND PAYLOAD
       ===================================================== */

    function getCreateAlertPayload() {
        const rawSymbol = normalizeString(
            elements.alertSymbol?.value
        );

        const selectedSymbol = normalizeString(
            elements.alertSelectedSymbol?.value
        );

        const targetPrice = normalizeNumber(
            elements.alertTargetPrice?.value
        );

        const currency = normalizeCurrency(
            elements.alertCurrency?.value
        );

        /*
         * Require a result selected from autocomplete.
         * This avoids creating alerts for invalid/free-typed
         * stock names or symbols.
         */
        if (
            !state.selectedAsset ||
            !selectedSymbol ||
            selectedSymbol !== state.selectedAsset.symbol
        ) {
            throw new Error(
                "Search for a stock and select it from the suggestions."
            );
        }

        if (
            rawSymbol.toUpperCase() !==
            state.selectedAsset.symbol.toUpperCase()
        ) {
            throw new Error(
                "Please select the asset again from the search suggestions."
            );
        }

        if (
            targetPrice === null ||
            targetPrice <= 0
        ) {
            throw new Error(
                "Enter a target price greater than zero."
            );
        }

        if (!currency || !state.currencySearchValid) {
            throw new Error(
                "Please select a valid target-price currency."
            );
        }

        /*
         * All three channels are always enabled.
         * The backend maps:
         * in_app -> automatic in-app notification
         * email  -> email_enabled = true
         * sms    -> sms_enabled = true
         *
         * SMS must remain not_configured until its provider
         * integration is implemented.
         */
        const channels = [...CONFIG.notificationChannels];

        if (elements.alertNotificationChannels) {
            elements.alertNotificationChannels.value =
                channels.join(",");
        }

        if (elements.alertType) {
            elements.alertType.value = "target_reached";
        }

        return {
            symbol: state.selectedAsset.symbol,
            target_price: targetPrice,
            currency,

            condition: CONFIG.alertCondition,
            alert_type: "target_reached",

            notification_channels: channels,

            email_enabled: true,
            sms_enabled: true
        };
    }

    /* =====================================================
       19. SUBMIT CREATE ALERT
       ===================================================== */

    async function submitCreateAlert(event) {
        event.preventDefault();

        if (state.creating) return;

        clearFormMessage();

        let payload;

        try {
            payload = getCreateAlertPayload();
        } catch (error) {
            showFormMessage(error.message, "error");
            return;
        }

        state.creating = true;

        const button = elements.submitCreateAlertButton;

        if (button) {
            if (!button.dataset.originalLabel) {
                button.dataset.originalLabel =
                    button.textContent.trim() || "Create Alert";
            }

            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            button.textContent = "Creating alert...";
        }

        if (elements.cancelCreateAlertButton) {
            elements.cancelCreateAlertButton.disabled = true;
        }

        if (elements.closeCreateAlertButton) {
            elements.closeCreateAlertButton.disabled = true;
        }

        try {
            const response = await requestJSON(
                CONFIG.alertsEndpoint,
                {
                    method: "POST",
                    body: JSON.stringify(payload)
                }
            );

            const message = normalizeString(
                firstValue(
                    response,
                    ["message"],
                    "Your price alert has been created successfully."
                )
            );

            /*
             * Close immediately after the server confirms
             * successful creation.
             */
            state.creating = false;

            closeCreateAlertModal(true);
            resetCreateAlertForm();

            showMessage(message, "success");

            /*
             * Reload alerts after successful creation.
             */
            await loadAlerts({ force: true });

        } catch (error) {
            console.error(
                "[Market Plus AI] Failed to create alert:",
                error
            );

            if (
                error.status === 401 ||
                error.status === 403
            ) {
                showFormMessage(
                    "Your session has expired. Please sign in again.",
                    "error"
                );

                window.setTimeout(() => {
                    window.location.href = CONFIG.loginPage;
                }, 1200);

            } else {
                showFormMessage(
                    error.message ||
                    "Unable to create your alert. Please try again.",
                    "error"
                );
            }

        } finally {
            state.creating = false;

            if (button) {
                button.disabled = false;
                button.removeAttribute("aria-busy");

                button.textContent =
                    button.dataset.originalLabel || "Create Alert";
            }

            if (elements.cancelCreateAlertButton) {
                elements.cancelCreateAlertButton.disabled = false;
            }

            if (elements.closeCreateAlertButton) {
                elements.closeCreateAlertButton.disabled = false;
            }
        }
    }

    /* =====================================================
       20. MODAL EVENT BINDING
       ===================================================== */

    function bindCreateAlertModal() {
        const openButtons = [
            elements.openCreateAlertButton,
            elements.emptyCreateAlertButton
        ].filter(Boolean);

        openButtons.forEach((button) => {
            button.addEventListener(
                "click",
                openCreateAlertModal
            );
        });

        if (elements.closeCreateAlertButton) {
            elements.closeCreateAlertButton.addEventListener(
                "click",
                () => closeCreateAlertModal()
            );
        }

        if (elements.cancelCreateAlertButton) {
            elements.cancelCreateAlertButton.addEventListener(
                "click",
                () => closeCreateAlertModal()
            );
        }

        if (elements.createAlertForm) {
            elements.createAlertForm.addEventListener(
                "submit",
                submitCreateAlert
            );
        }

        if (elements.createAlertModal) {
            elements.createAlertModal.addEventListener(
                "click",
                (event) => {
                    if (
                        event.target.matches(
                            "[data-close-alert-modal]"
                        )
                    ) {
                        closeCreateAlertModal();
                    }
                }
            );
        }

        if (elements.alertCurrencySearch) {
            elements.alertCurrencySearch.addEventListener(
                "input",
                handleCurrencyInput
            );

            elements.alertCurrencySearch.addEventListener(
                "change",
                handleCurrencyInput
            );

            elements.alertCurrencySearch.addEventListener(
                "blur",
                handleCurrencyInput
            );
        }

        populateCurrencyOptions();
        setSelectedCurrency(state.preferredCurrency);
    }

    /* =====================================================
       21. SEARCH AND FILTER EVENTS
       ===================================================== */

    function bindSearch() {
        if (!elements.alertsSearchInput) return;

        elements.alertsSearchInput.addEventListener(
            "input",
            () => {
                state.searchQuery =
                    elements.alertsSearchInput.value || "";

                state.currentPage = 1;
                applyFilters();
            }
        );
    }

    function bindStatusFilter() {
        if (!elements.alertsStatusFilter) return;

        elements.alertsStatusFilter.addEventListener(
            "change",
            () => {
                state.statusFilter =
                    elements.alertsStatusFilter.value || "all";

                state.currentPage = 1;
                applyFilters();
            }
        );
    }

    function bindSort() {
        if (!elements.alertsSortSelect) return;

        elements.alertsSortSelect.addEventListener(
            "change",
            () => {
                state.sortOrder =
                    elements.alertsSortSelect.value || "newest";

                state.currentPage = 1;
                applyFilters();
            }
        );
    }

    function bindClearFilters() {
        if (!elements.alertsClearFilters) return;

        elements.alertsClearFilters.addEventListener(
            "click",
            clearFilters
        );
    }

    function bindRefresh() {
        if (!elements.alertsRefreshButton) return;

        elements.alertsRefreshButton.addEventListener(
            "click",
            () => {
                loadAlerts({
                    force: true,
                    showSuccess: true
                });
            }
        );
    }

    function bindPagination() {
        if (elements.alertsPreviousPage) {
            elements.alertsPreviousPage.addEventListener(
                "click",
                () => {
                    if (state.currentPage > 1) {
                        state.currentPage -= 1;
                        renderAlerts();
                    }
                }
            );
        }

        if (elements.alertsNextPage) {
            elements.alertsNextPage.addEventListener(
                "click",
                () => {
                    const totalPages = Math.max(
                        1,
                        Math.ceil(
                            state.filteredAlerts.length /
                            CONFIG.pageSize
                        )
                    );

                    if (state.currentPage < totalPages) {
                        state.currentPage += 1;
                        renderAlerts();
                    }
                }
            );
        }
    }

    /* =====================================================
       22. SIDEBAR
       ===================================================== */

    function openSidebar() {
        const sidebar = elements.appSidebar;
        const overlay = elements.sidebarOverlay;

        if (!sidebar) return;

        sidebar.classList.add("open");

        sidebar.setAttribute(
            "aria-expanded",
            "true"
        );

        if (overlay) {
            overlay.classList.add("active");

            overlay.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        if (elements.mobileMenuButton) {
            elements.mobileMenuButton.setAttribute(
                "aria-expanded",
                "true"
            );
        }

        document.body.classList.add("sidebar-open");
    }

    function closeSidebar() {
        const sidebar = elements.appSidebar;
        const overlay = elements.sidebarOverlay;

        if (sidebar) {
            sidebar.classList.remove("open", "is-open");

            sidebar.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        if (overlay) {
            overlay.classList.remove(
                "active",
                "is-visible",
                "show"
            );

            overlay.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        if (elements.mobileMenuButton) {
            elements.mobileMenuButton.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        document.body.classList.remove("sidebar-open");
    }

    function bindSidebar() {
        if (elements.mobileMenuButton) {
            elements.mobileMenuButton.addEventListener(
                "click",
                () => {
                    const sidebar = elements.appSidebar;

                    if (
                        sidebar &&
                        sidebar.classList.contains("open")
                    ) {
                        closeSidebar();
                    } else {
                        openSidebar();
                    }
                }
            );
        }

        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.addEventListener(
                "click",
                closeSidebar
            );
        }

        if (elements.appSidebar) {
            elements.appSidebar
                .querySelectorAll("a")
                .forEach((link) => {
                    link.addEventListener(
                        "click",
                        closeSidebar
                    );
                });
        }

        window.addEventListener("resize", () => {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        });
    }

    /* =====================================================
       23. LOGOUT
       ===================================================== */

    function bindLogout() {
        document.querySelectorAll(
            ".logout-button, [data-action='logout']"
        ).forEach((button) => {
            button.addEventListener(
                "click",
                async () => {
                    if (
                        button.tagName === "A" &&
                        button.href
                    ) {
                        return;
                    }

                    if (
                        button.dataset.logoutHandled === "true"
                    ) {
                        return;
                    }

                    button.dataset.logoutHandled = "true";

                    try {
                        const response = await fetch(
                            "/api/auth/logout",
                            {
                                method: "POST",
                                credentials: "same-origin",
                                headers: {
                                    Accept: "application/json"
                                }
                            }
                        );

                        if (response.ok) {
                            window.location.href =
                                CONFIG.loginPage;

                            return;
                        }

                    } catch (error) {
                        console.warn(
                            "[Market Plus AI] Logout request failed:",
                            error
                        );
                    }

                    window.location.href = CONFIG.loginPage;
                }
            );
        });
    }

    /* =====================================================
       24. ACCESSIBILITY
       ===================================================== */

    function setupAccessibility() {
        if (elements.alertsList) {
            elements.alertsList.setAttribute(
                "role",
                "list"
            );

            elements.alertsList.setAttribute(
                "aria-label",
                "Price alerts"
            );
        }

        if (elements.alertsMessage) {
            elements.alertsMessage.setAttribute(
                "role",
                "status"
            );

            elements.alertsMessage.setAttribute(
                "aria-live",
                "polite"
            );
        }

        if (elements.alertsLoadingState) {
            elements.alertsLoadingState.setAttribute(
                "role",
                "status"
            );

            elements.alertsLoadingState.setAttribute(
                "aria-live",
                "polite"
            );
        }

        if (elements.mobileMenuButton) {
            elements.mobileMenuButton.setAttribute(
                "aria-label",
                "Open navigation menu"
            );

            elements.mobileMenuButton.setAttribute(
                "aria-controls",
                "appSidebar"
            );
        }

        if (elements.alertSymbol) {
            elements.alertSymbol.setAttribute(
                "aria-autocomplete",
                "list"
            );

            elements.alertSymbol.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        if (elements.createAlertModal) {
            elements.createAlertModal.setAttribute(
                "aria-hidden",
                elements.createAlertModal.hidden
                    ? "true"
                    : "false"
            );
        }

        document.addEventListener(
            "keydown",
            (event) => {
                if (event.key === "Escape") {
                    if (
                        elements.createAlertModal &&
                        !elements.createAlertModal.hidden
                    ) {
                        closeCreateAlertModal();
                    } else {
                        closeSidebar();
                    }
                }
            }
        );
    }

    /* =====================================================
       25. INITIALIZATION
       ===================================================== */

    async function initialize() {
        cacheElements();

        if (!elements.alertsList) {
            console.warn(
                "[Market Plus AI] alertsList was not found. " +
                "Check templates/alerts.html."
            );

            return;
        }

        setupAccessibility();

        bindSearch();
        bindStatusFilter();
        bindSort();
        bindClearFilters();
        bindRefresh();
        bindPagination();

        bindSidebar();
        bindLogout();

        bindAssetSearch();
        bindCreateAlertModal();

        updateSummary();
        updateSidebarCount();

        hideElement(elements.alertsEmptyState);
        hideElement(elements.alertsPagination);

        try {
            await loadProfilePreferences();

        } catch (error) {
            console.error(
                "[Market Plus AI] Profile loading failed:",
                error
            );

            if (
                error.status === 401 ||
                error.status === 403
            ) {
                window.location.href = CONFIG.loginPage;
                return;
            }

            state.preferredCurrency =
                CONFIG.defaultCurrency;

            setSelectedCurrency(
                CONFIG.defaultCurrency
            );
        }

        await loadAlerts();
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }

    /* =====================================================
       26. PUBLIC INTERFACE
       ===================================================== */

    window.MarketPlusAlerts = Object.freeze({
        refresh: () => loadAlerts({
            force: true,
            showSuccess: true
        }),

        clearFilters,

        openCreateAlert: openCreateAlertModal,

        closeCreateAlert: closeCreateAlertModal,

        getCount: () => state.alerts.length,

        getActiveCount: () =>
            state.alerts.filter(isActiveAlert).length,

        getTriggeredCount: () =>
            state.alerts.filter(isTriggeredAlert).length,

        getPreferredCurrency: () =>
            state.preferredCurrency,

        getState: () => ({
            alerts: [...state.alerts],
            preferredCurrency: state.preferredCurrency,
            currentPage: state.currentPage,
            selectedAsset: state.selectedAsset
                ? { ...state.selectedAsset }
                : null
        })
    });

})();
