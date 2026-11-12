
/* =========================================================
   MARKET PLUS AI — PROFILE PAGE
   File: static/js/profile.js
   Version: 7.0.0

   PROFILE:
   - Load authenticated profile
   - Display country, language and preferred currency
   - Edit name, email, phone and risk category
   - Edit country, language and preferred currency
   - Keep generated User ID read-only
   - Save preferences through /api/auth/profile
   - Load prediction performance

   INVESTMENTS:
   - Combined company/ticker search
   - Receive assets from Prediction and History pages
   - Currency selection for every investment
   - Default investment currency from user preferences
   - Support international currencies
   - Store investment currency with each trade
   - Use the same currency when recording withdrawals
   - Show currency-aware open/completed tables
   - Group realized P/L by currency
   - Calculate quantity internally only
   - Never display quantity
   - Completed investments are read-only

   SECURITY:
   - Same-origin authenticated requests
   - Safe DOM rendering with textContent
   - No user-provided HTML insertion
   ========================================================= */

(() => {
    "use strict";

    /* =====================================================
       API CONFIGURATION
    ===================================================== */

    const API = {
        profile: [
            "/api/auth/me",
            "/api/profile",
            "/api/user/profile"
        ],

        updateProfile: [
            "/api/auth/profile",
            "/api/profile",
            "/api/user/profile"
        ],

        predictionHistory: [
            "/api/predictions/history",
            "/api/prediction-history",
            "/api/history"
        ],

        investments: [
            "/api/investments",
            "/api/profile/investments"
        ],

        investmentSearch: [
            "/api/investments/search",
            "/api/profile/investments/search"
        ]
    };

    /* =====================================================
       COUNTRY AND CURRENCY CONFIGURATION
    ===================================================== */

    const COUNTRY_CURRENCIES = {
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
        "Sri Lanka": "LKR"
    };

    const CURRENCIES = {
        INR: { name: "Indian Rupee", symbol: "₹" },
        USD: { name: "US Dollar", symbol: "$" },
        GBP: { name: "British Pound", symbol: "£" },
        EUR: { name: "Euro", symbol: "€" },
        JPY: { name: "Japanese Yen", symbol: "¥" },
        AED: { name: "UAE Dirham", symbol: "د.إ" },
        CAD: { name: "Canadian Dollar", symbol: "$" },
        AUD: { name: "Australian Dollar", symbol: "$" },
        CHF: { name: "Swiss Franc", symbol: "CHF" },
        CNY: { name: "Chinese Yuan", symbol: "¥" },
        SGD: { name: "Singapore Dollar", symbol: "$" },
        SAR: { name: "Saudi Riyal", symbol: "﷼" },
        KRW: { name: "South Korean Won", symbol: "₩" },
        BRL: { name: "Brazilian Real", symbol: "R$" },
        ZAR: { name: "South African Rand", symbol: "R" },
        NZD: { name: "New Zealand Dollar", symbol: "$" },
        MYR: { name: "Malaysian Ringgit", symbol: "RM" },
        IDR: { name: "Indonesian Rupiah", symbol: "Rp" },
        THB: { name: "Thai Baht", symbol: "฿" },
        MXN: { name: "Mexican Peso", symbol: "$" },
        BDT: { name: "Bangladeshi Taka", symbol: "৳" },
        PKR: { name: "Pakistani Rupee", symbol: "₨" },
        NPR: { name: "Nepalese Rupee", symbol: "रू" },
        LKR: { name: "Sri Lankan Rupee", symbol: "Rs" },
        NGN: { name: "Nigerian Naira", symbol: "₦" },
        KES: { name: "Kenyan Shilling", symbol: "KSh" },
        EGP: { name: "Egyptian Pound", symbol: "E£" },
        TRY: { name: "Turkish Lira", symbol: "₺" },
        SEK: { name: "Swedish Krona", symbol: "kr" },
        NOK: { name: "Norwegian Krone", symbol: "kr" },
        DKK: { name: "Danish Krone", symbol: "kr" },
        PLN: { name: "Polish Zloty", symbol: "zł" },
        QAR: { name: "Qatari Riyal", symbol: "﷼" },
        KWD: { name: "Kuwaiti Dinar", symbol: "د.ك" },
        BHD: { name: "Bahraini Dinar", symbol: "د.ب" },
        OMR: { name: "Omani Rial", symbol: "ر.ع." },
        PHP: { name: "Philippine Peso", symbol: "₱" },
        VND: { name: "Vietnamese Dong", symbol: "₫" },
        ARS: { name: "Argentine Peso", symbol: "$" }
    };

    const ALLOWED_CURRENCIES = new Set(
        Object.keys(CURRENCIES)
    );

    /* =====================================================
       LANGUAGE CONFIGURATION
    ===================================================== */

    const LANGUAGES = {
        en: "English",
        as: "Assamese",
        bn: "Bengali",
        brx: "Bodo",
        doi: "Dogri",
        gu: "Gujarati",
        hi: "Hindi",
        kn: "Kannada",
        ks: "Kashmiri",
        kok: "Konkani",
        mai: "Maithili",
        ml: "Malayalam",
        mni: "Manipuri",
        mr: "Marathi",
        ne: "Nepali",
        or: "Odia",
        pa: "Punjabi",
        sa: "Sanskrit",
        sat: "Santali",
        sd: "Sindhi",
        ta: "Tamil",
        te: "Telugu",
        ur: "Urdu",
        tcy: "Tulu",
        bho: "Bhojpuri",
        raj: "Rajasthani",
        hne: "Chhattisgarhi",
        bgc: "Haryanvi",
        kha: "Khasi",
        lus: "Mizo",
        grt: "Garo",
        es: "Spanish",
        fr: "French",
        de: "German",
        ja: "Japanese",
        ar: "Arabic",
        zh: "Chinese",
        ko: "Korean",
        pt: "Portuguese",
        ru: "Russian",
        it: "Italian",
        nl: "Dutch",
        tr: "Turkish",
        id: "Indonesian",
        ms: "Malay",
        th: "Thai",
        vi: "Vietnamese"
    };

    const LANGUAGE_LOCALES = {
        en: "en-IN",
        hi: "hi-IN",
        kn: "kn-IN",
        ta: "ta-IN",
        te: "te-IN",
        ml: "ml-IN",
        bn: "bn-IN",
        mr: "mr-IN",
        gu: "gu-IN",
        pa: "pa-IN",
        ur: "ur-PK",
        or: "or-IN",
        as: "as-IN",
        es: "es-ES",
        fr: "fr-FR",
        de: "de-DE",
        ja: "ja-JP",
        zh: "zh-CN",
        ko: "ko-KR",
        ar: "ar-SA",
        pt: "pt-BR",
        ru: "ru-RU",
        it: "it-IT",
        nl: "nl-NL",
        tr: "tr-TR",
        id: "id-ID",
        ms: "ms-MY",
        th: "th-TH",
        vi: "vi-VN"
    };

    /* =====================================================
       STATE
    ===================================================== */

    const state = {
        profile: null,

        openInvestments: [],
        completedInvestments: [],

        selectedAsset: null,
        selectedWithdrawal: null,

        searchTimer: null,
        searchController: null,

        loadingInvestments: false,
        savingInvestment: false,
        savingWithdrawal: false,
        savingProfile: false,

        predictionHistory: [],

        profileCurrencyManuallyChanged: false
    };

    const $ = (id) => document.getElementById(id);

    /* =====================================================
       DOM ELEMENTS
    ===================================================== */

    const elements = {
        profileMessage: $("profileMessage"),
        profileLoading: $("profileLoading"),
        profileGrid: $("profileGrid"),
        profileErrorState: $("profileErrorState"),
        profileErrorDescription: $("profileErrorDescription"),
        retryProfileButton: $("retryProfileButton"),

        profileStatusBadge: $("profileStatusBadge"),
        topbarAvatar: $("topbarAvatar"),
        topbarUserName: $("topbarUserName"),
        profileLargeAvatar: $("profileLargeAvatar"),
        profileFullName: $("profileFullName"),
        profileEmail: $("profileEmail"),
        profileUserId: $("profileUserId"),

        detailUserId: $("detailUserId"),
        detailFullName: $("detailFullName"),
        detailEmail: $("detailEmail"),
        detailPhone: $("detailPhone"),
        detailCountry: $("detailCountry"),
        detailLanguage: $("detailLanguage"),
        detailPreferredCurrency: $("detailPreferredCurrency"),
        detailRiskCategory: $("detailRiskCategory"),
        detailCreatedAt: $("detailCreatedAt"),

        logoutButton: $("logoutButton"),

        profileProfitLoss: $("profileProfitLoss"),
        profileProfitLossCaption: $("profileProfitLossCaption"),
        profileCompletedPredictions: $("profileCompletedPredictions"),
        profileProfitablePredictions: $("profileProfitablePredictions"),
        profileLossMakingPredictions: $("profileLossMakingPredictions"),

        editProfileButton: $("editProfileButton"),
        editProfileForm: $("editProfileForm"),
        editProfileName: $("editProfileName"),
        editProfileEmail: $("editProfileEmail"),
        editProfilePhone: $("editProfilePhone"),
        editProfileRiskCategory: $("editProfileRiskCategory"),
        editProfileUserId: $("editProfileUserId"),
        editProfileCountry: $("editProfileCountry"),
        editProfileLanguage: $("editProfileLanguage"),
        editProfileCurrencySearch: $("editProfileCurrencySearch"),
        profileCurrencyOptions: $("profileCurrencyOptions"),
        editProfileCurrency: $("editProfileCurrency"),
        editProfileMessage: $("editProfileMessage"),
        cancelProfileEditButton: $("cancelProfileEditButton"),
        saveProfileButton: $("saveProfileButton"),

        investmentRealizedPL: $("investmentRealizedPL"),
        investmentOpenCount: $("investmentOpenCount"),
        investmentCompletedCount: $("investmentCompletedCount"),
        investmentProfitableCount: $("investmentProfitableCount"),

        investmentForm: $("investmentForm"),
        investmentAssetSearch: $("investmentAssetSearch"),
        investmentAssetSuggestions: $("investmentAssetSuggestions"),
        investmentSelectedAsset: $("investmentSelectedAsset"),
        investmentSelectedAssetName: $("investmentSelectedAssetName"),
        investmentSelectedAssetSymbol: $("investmentSelectedAssetSymbol"),
        clearInvestmentAssetButton: $("clearInvestmentAssetButton"),
        investmentAssetName: $("investmentAssetName"),
        investmentSymbol: $("investmentSymbol"),
        investmentCurrencySearch: $("investmentCurrencySearch"),
        investmentCurrencyOptions: $("investmentCurrencyOptions"),
        investmentCurrency: $("investmentCurrency"),
        investmentPriceCurrencySymbol: $("investmentPriceCurrencySymbol"),
        investmentAmountCurrencySymbol: $("investmentAmountCurrencySymbol"),
        investmentPrice: $("investmentPrice"),
        investmentAmount: $("investmentAmount"),
        investmentBuyDate: $("investmentBuyDate"),
        saveInvestmentButton: $("saveInvestmentButton"),
        investmentFormStatus: $("investmentFormStatus"),

        openInvestmentsBody: $("openInvestmentsBody"),
        completedInvestmentsBody: $("completedInvestmentsBody"),
        refreshInvestmentsButton: $("refreshInvestmentsButton"),
        investmentListMessage: $("investmentListMessage"),

        withdrawalModal: $("withdrawalModal"),
        withdrawalModalBackdrop: $("withdrawalModalBackdrop"),
        closeWithdrawalModalButton: $("closeWithdrawalModalButton"),
        cancelWithdrawalButton: $("cancelWithdrawalButton"),
        withdrawalForm: $("withdrawalForm"),
        withdrawalInvestmentId: $("withdrawalInvestmentId"),
        withdrawalAssetName: $("withdrawalAssetName"),
        withdrawalAssetSymbol: $("withdrawalAssetSymbol"),
        investmentWithdrawalPrice: $("investmentWithdrawalPrice"),
        investmentSellDate: $("investmentSellDate"),
        withdrawalCurrencySymbol: $("withdrawalCurrencySymbol"),
        withdrawalFormMessage: $("withdrawalFormMessage"),
        confirmWithdrawalButton: $("confirmWithdrawalButton")
    };

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

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

    function unwrapObject(payload) {
        if (!payload || typeof payload !== "object") {
            return {};
        }

        let result = payload;

        for (let i = 0; i < 4; i += 1) {
            if (
                result.data &&
                typeof result.data === "object" &&
                !Array.isArray(result.data)
            ) {
                result = result.data;
                continue;
            }

            if (
                result.profile &&
                typeof result.profile === "object"
            ) {
                result = result.profile;
                continue;
            }

            if (
                result.user &&
                typeof result.user === "object"
            ) {
                result = result.user;
                continue;
            }

            break;
        }

        return result;
    }

    function getErrorMessage(payload, fallback) {
        if (!payload || typeof payload !== "object") {
            return fallback;
        }

        return firstValue(
            payload,
            ["message", "error", "detail", "description"],
            fallback
        );
    }

    async function apiRequest(url, options = {}) {
        const controller = new AbortController();

        const timeout = window.setTimeout(
            () => controller.abort(),
            15000
        );

        try {
            const response = await fetch(url, {
                credentials: "same-origin",
                ...options,

                headers: {
                    Accept: "application/json",

                    ...(options.body ? {
                        "Content-Type": "application/json"
                    } : {}),

                    ...(options.headers || {})
                },

                signal: controller.signal
            });

            let payload = {};

            try {
                payload = await response.json();
            } catch {
                payload = {};
            }

            if (
                response.status === 401 ||
                response.status === 403
            ) {
                window.location.href = "/login";

                throw new Error(
                    "Your session has expired. Please log in again."
                );
            }

            if (
                !response.ok ||
                payload.success === false
            ) {
                throw new Error(
                    getErrorMessage(
                        payload,
                        `Request failed (${response.status}).`
                    )
                );
            }

            return payload;

        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error(
                    "The request timed out. Please try again."
                );
            }

            throw error;

        } finally {
            window.clearTimeout(timeout);
        }
    }

    function setText(element, value, fallback = "—") {
        if (!element) return;

        element.textContent =
            value === undefined ||
            value === null ||
            value === ""
                ? fallback
                : String(value);
    }

    function setMessage(element, message, type = "info") {
        if (!element) return;

        element.textContent = message || "";
        element.dataset.state = type;

        element.classList.remove(
            "success",
            "error",
            "info",
            "warning"
        );

        if (type) {
            element.classList.add(type);
        }

        element.hidden = !message;
    }

    function setButtonLoading(button, loading, normalText) {
        if (!button) return;

        button.disabled = Boolean(loading);

        if (loading) {
            if (!button.dataset.originalText) {
                button.dataset.originalText =
                    button.textContent.trim() ||
                    normalText ||
                    "Submit";
            }

            button.textContent = "Please wait...";

        } else {
            button.textContent =
                button.dataset.originalText ||
                normalText ||
                "Submit";
        }
    }

    function numberValue(value, fallback = 0) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function localDateString(date = new Date()) {
        const year = date.getFullYear();

        const month = String(
            date.getMonth() + 1
        ).padStart(2, "0");

        const day = String(
            date.getDate()
        ).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function getToday() {
        return localDateString();
    }

    function formatDate(value) {
        if (!value) return "—";

        const text = String(value);

        const match = text.match(
            /^(\d{4})-(\d{2})-(\d{2})/
        );

        let date;

        if (match) {
            date = new Date(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3])
            );
        } else {
            date = new Date(value);
        }

        if (Number.isNaN(date.getTime())) {
            return text;
        }

        const locale = getPreferredLocale();

        return date.toLocaleDateString(locale, {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
    }

    function normalizeDate(value) {
        if (!value) return "";

        const match = String(value).match(
            /^(\d{4}-\d{2}-\d{2})/
        );

        return match ? match[1] : "";
    }

    function getInitials(name) {
        const words = String(name || "User")
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        if (words.length === 1) {
            return words[0].slice(0, 2).toUpperCase();
        }

        return (
            words[0][0] +
            words[words.length - 1][0]
        ).toUpperCase();
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }

        return element;
    }

    function appendCell(row, value, className = "") {
        const cell = createElement("td", className, value);

        row.appendChild(cell);

        return cell;
    }

    function showProfileError(message) {
        if (elements.profileLoading) {
            elements.profileLoading.hidden = true;
        }

        if (elements.profileGrid) {
            elements.profileGrid.hidden = true;
        }

        if (elements.profileErrorState) {
            elements.profileErrorState.hidden = false;
        }

        setText(
            elements.profileErrorDescription,
            message || "Unable to load your profile."
        );
    }

    function showProfileContent() {
        if (elements.profileLoading) {
            elements.profileLoading.hidden = true;
        }

        if (elements.profileErrorState) {
            elements.profileErrorState.hidden = true;
        }

        if (elements.profileGrid) {
            elements.profileGrid.hidden = false;
        }
    }

    /* =====================================================
       CURRENCY HELPERS
    ===================================================== */

    function normalizeCurrency(value, fallback = "INR") {
        const code = String(value || "")
            .trim()
            .toUpperCase();

        return ALLOWED_CURRENCIES.has(code)
            ? code
            : fallback;
    }

    function currencyLabel(code) {
        const currency = normalizeCurrency(code);

        const details = CURRENCIES[currency];

        return `${currency} — ${details.name} (${details.symbol})`;
    }

    function parseCurrencyCode(value) {
        const text = String(value || "")
            .trim();

        if (!text) return "";

        const upper = text.toUpperCase();

        if (ALLOWED_CURRENCIES.has(upper)) {
            return upper;
        }

        const prefixMatch = upper.match(/^([A-Z]{3})\s*(?:—|-|–)/);

        if (
            prefixMatch &&
            ALLOWED_CURRENCIES.has(prefixMatch[1])
        ) {
            return prefixMatch[1];
        }

        for (const [code, details] of Object.entries(CURRENCIES)) {
            if (
                text.toLowerCase() ===
                `${code} — ${details.name} (${details.symbol})`.toLowerCase()
            ) {
                return code;
            }
        }

        return "";
    }

    function currencySymbol(code) {
        const currency = normalizeCurrency(code);

        return CURRENCIES[currency]?.symbol || currency;
    }

    function formatCurrency(value, currencyCode = null) {
        const amount = numberValue(value);

        const currency = normalizeCurrency(
            currencyCode ||
            state.profile?.preferredCurrency ||
            "INR"
        );

        const locale = currency === "INR"
            ? "en-IN"
            : "en-US";

        try {
            return new Intl.NumberFormat(locale, {
                style: "currency",
                currency,
                currencyDisplay: "code",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);

        } catch {
            return `${currency} ${amount.toFixed(2)}`;
        }
    }

    function getPreferredLocale() {
        const language = state.profile?.language || "en";

        return LANGUAGE_LOCALES[language] || "en-IN";
    }

    function setCurrencyInput(searchElement, hiddenElement, code) {
        const currency = normalizeCurrency(code);

        if (searchElement) {
            searchElement.value = currencyLabel(currency);
        }

        if (hiddenElement) {
            hiddenElement.value = currency;
        }
    }

    function updateCurrencySymbols() {
        const investmentCurrency = normalizeCurrency(
            elements.investmentCurrency?.value ||
            state.profile?.preferredCurrency ||
            "INR"
        );

        const investmentSymbol = currencySymbol(
            investmentCurrency
        );

        setText(
            elements.investmentPriceCurrencySymbol,
            investmentSymbol
        );

        setText(
            elements.investmentAmountCurrencySymbol,
            investmentSymbol
        );

        const withdrawalCurrency = normalizeCurrency(
            state.selectedWithdrawal?.currency ||
            investmentCurrency
        );

        setText(
            elements.withdrawalCurrencySymbol,
            currencySymbol(withdrawalCurrency)
        );
    }

    function setupCurrencyDatalist(datalist) {
        if (!datalist) return;

        datalist.replaceChildren();

        Object.keys(CURRENCIES)
            .sort()
            .forEach((code) => {
                const option = document.createElement("option");

                option.value = currencyLabel(code);

                datalist.appendChild(option);
            });
    }

    function setupCountryOptions() {
        if (!elements.editProfileCountry) return;

        const select = elements.editProfileCountry;

        const existing = new Set(
            Array.from(select.options).map(
                (option) => option.value
            )
        );

        Object.keys(COUNTRY_CURRENCIES)
            .sort()
            .forEach((country) => {
                if (existing.has(country)) return;

                const option = document.createElement("option");

                option.value = country;
                option.textContent = country;

                select.appendChild(option);
            });
    }

    function setupLanguageOptions() {
        if (!elements.editProfileLanguage) return;

        const select = elements.editProfileLanguage;

        const existing = new Set(
            Array.from(select.options).map(
                (option) => option.value
            )
        );

        Object.entries(LANGUAGES)
            .forEach(([code, name]) => {
                if (existing.has(code)) return;

                const option = document.createElement("option");

                option.value = code;
                option.textContent = name;

                select.appendChild(option);
            });
    }

    function setupCurrencyOptions() {
        setupCurrencyDatalist(elements.profileCurrencyOptions);
        setupCurrencyDatalist(elements.investmentCurrencyOptions);
    }

    function setupCurrencyInputs() {
        setupCurrencyOptions();

        if (elements.editProfileCurrencySearch) {
            elements.editProfileCurrencySearch.addEventListener(
                "input",
                () => {
                    const code = parseCurrencyCode(
                        elements.editProfileCurrencySearch.value
                    );

                    if (elements.editProfileCurrency) {
                        elements.editProfileCurrency.value = code;
                    }

                    state.profileCurrencyManuallyChanged = true;
                }
            );

            elements.editProfileCurrencySearch.addEventListener(
                "change",
                () => {
                    const code = parseCurrencyCode(
                        elements.editProfileCurrencySearch.value
                    );

                    if (code) {
                        setCurrencyInput(
                            elements.editProfileCurrencySearch,
                            elements.editProfileCurrency,
                            code
                        );
                    }
                }
            );
        }

        if (elements.investmentCurrencySearch) {
            elements.investmentCurrencySearch.addEventListener(
                "input",
                () => {
                    const code = parseCurrencyCode(
                        elements.investmentCurrencySearch.value
                    );

                    if (elements.investmentCurrency) {
                        elements.investmentCurrency.value = code;
                    }

                    updateCurrencySymbols();
                }
            );

            elements.investmentCurrencySearch.addEventListener(
                "change",
                () => {
                    const code = parseCurrencyCode(
                        elements.investmentCurrencySearch.value
                    );

                    if (code) {
                        setCurrencyInput(
                            elements.investmentCurrencySearch,
                            elements.investmentCurrency,
                            code
                        );

                        updateCurrencySymbols();
                    }
                }
            );
        }

        elements.editProfileCountry?.addEventListener(
            "change",
            () => {
                const country =
                    elements.editProfileCountry.value;

                const defaultCurrency =
                    COUNTRY_CURRENCIES[country];

                if (!defaultCurrency) return;

                state.profileCurrencyManuallyChanged = false;

                setCurrencyInput(
                    elements.editProfileCurrencySearch,
                    elements.editProfileCurrency,
                    defaultCurrency
                );
            }
        );
    }

    /* =====================================================
       PROFILE LOADING AND DISPLAY
    ===================================================== */

    function normalizeProfile(payload) {
        const user = unwrapObject(payload);

        const country = firstValue(
            user,
            ["country", "country_name"],
            "India"
        );

        const preferredCurrency = normalizeCurrency(
            firstValue(
                user,
                [
                    "preferred_currency",
                    "preferredCurrency",
                    "currency"
                ],
                COUNTRY_CURRENCIES[country] || "INR"
            )
        );

        return {
            name: firstValue(
                user,
                ["full_name", "fullName", "name", "username"],
                "User"
            ),

            email: firstValue(
                user,
                ["email", "email_address"],
                ""
            ),

            phone: firstValue(
                user,
                ["phone", "phone_number", "mobile"],
                ""
            ),

            userId: firstValue(
                user,
                ["user_id", "userId"],
                ""
            ),

            country,

            language: firstValue(
                user,
                ["language", "preferred_language"],
                "en"
            ),

            preferredCurrency,

            riskCategory: firstValue(
                user,
                [
                    "risk_category",
                    "riskCategory",
                    "risk_level",
                    "riskLevel",
                    "category"
                ],
                "Not specified"
            ),

            createdAt: firstValue(
                user,
                ["created_at", "createdAt", "registered_at"],
                ""
            )
        };
    }

    function displayRiskCategory(value) {
        const risk = String(value || "")
            .trim()
            .toLowerCase();

        if (risk === "middle" || risk === "medium") {
            return "Medium";
        }

        if (risk === "low") return "Low";
        if (risk === "high") return "High";

        return value || "Not specified";
    }

    function renderProfile(profile) {
        state.profile = profile;

        setText(elements.profileFullName, profile.name);
        setText(elements.profileEmail, profile.email);
        setText(elements.profileUserId, profile.userId);

        setText(elements.detailUserId, profile.userId);
        setText(elements.detailFullName, profile.name);
        setText(elements.detailEmail, profile.email);
        setText(elements.detailPhone, profile.phone);
        setText(elements.detailCountry, profile.country);
        setText(
            elements.detailLanguage,
            LANGUAGES[profile.language] || profile.language
        );
        setText(
            elements.detailPreferredCurrency,
            currencyLabel(profile.preferredCurrency)
        );

        setText(
            elements.detailRiskCategory,
            displayRiskCategory(profile.riskCategory)
        );

        setText(
            elements.detailCreatedAt,
            profile.createdAt
                ? formatDate(profile.createdAt)
                : "—"
        );

        setText(elements.topbarUserName, profile.name);

        const initials = getInitials(profile.name);

        setText(elements.topbarAvatar, initials);
        setText(elements.profileLargeAvatar, initials);

        if (elements.profileStatusBadge) {
            elements.profileStatusBadge.textContent = "Active";
            elements.profileStatusBadge.dataset.status = "active";
        }

        if (elements.editProfileUserId) {
            elements.editProfileUserId.value =
                profile.userId || "";

            elements.editProfileUserId.readOnly = true;
        }

        if (elements.investmentCurrency && !elements.investmentCurrency.value) {
            setCurrencyInput(
                elements.investmentCurrencySearch,
                elements.investmentCurrency,
                profile.preferredCurrency
            );
        }

        updateCurrencySymbols();
    }

    async function requestFirstSuccessful(endpoints, options = {}) {
        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                return await apiRequest(endpoint, options);

            } catch (error) {
                lastError = error;

                if (
                    error.message.includes("session has expired")
                ) {
                    throw error;
                }
            }
        }

        throw lastError || new Error(
            "No API endpoint was available."
        );
    }

    async function loadProfile() {
        if (elements.profileLoading) {
            elements.profileLoading.hidden = false;
        }

        if (elements.profileGrid) {
            elements.profileGrid.hidden = true;
        }

        if (elements.profileErrorState) {
            elements.profileErrorState.hidden = true;
        }

        try {
            const payload = await requestFirstSuccessful(
                API.profile
            );

            const profile = normalizeProfile(payload);

            if (!profile.userId && !profile.email) {
                throw new Error(
                    "The profile response did not contain user details."
                );
            }

            renderProfile(profile);
            showProfileContent();

            await loadPredictionPerformance();

        } catch (error) {
            showProfileError(
                error.message || "Unable to load your profile."
            );
        }
    }

    /* =====================================================
       PROFILE EDITING
    ===================================================== */

    function normalizeRiskForSelect(value) {
        const risk = String(value || "")
            .trim()
            .toLowerCase();

        if (risk.includes("low")) return "low";
        if (risk.includes("high")) return "high";

        return "medium";
    }

    function populateProfileEditForm() {
        if (!state.profile) return;

        if (elements.editProfileName) {
            elements.editProfileName.value =
                state.profile.name || "";
        }

        if (elements.editProfileEmail) {
            elements.editProfileEmail.value =
                state.profile.email || "";
        }

        if (elements.editProfilePhone) {
            elements.editProfilePhone.value =
                state.profile.phone || "";
        }

        if (elements.editProfileRiskCategory) {
            elements.editProfileRiskCategory.value =
                normalizeRiskForSelect(
                    state.profile.riskCategory
                );
        }

        if (elements.editProfileCountry) {
            elements.editProfileCountry.value =
                state.profile.country || "India";
        }

        if (elements.editProfileLanguage) {
            elements.editProfileLanguage.value =
                state.profile.language || "en";
        }

        setCurrencyInput(
            elements.editProfileCurrencySearch,
            elements.editProfileCurrency,
            state.profile.preferredCurrency
        );

        if (elements.editProfileUserId) {
            elements.editProfileUserId.value =
                state.profile.userId || "";

            elements.editProfileUserId.readOnly = true;
        }

        state.profileCurrencyManuallyChanged = false;
    }

    function openProfileEditor() {
        if (!state.profile || !elements.editProfileForm) return;

        populateProfileEditForm();

        setMessage(elements.editProfileMessage, "");

        elements.editProfileForm.hidden = false;

        elements.editProfileButton?.setAttribute(
            "aria-expanded",
            "true"
        );

        elements.editProfileForm.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
        });

        elements.editProfileName?.focus();
    }

    function closeProfileEditor() {
        if (state.savingProfile) return;

        if (elements.editProfileForm) {
            elements.editProfileForm.hidden = true;
        }

        elements.editProfileButton?.setAttribute(
            "aria-expanded",
            "false"
        );

        populateProfileEditForm();

        setMessage(elements.editProfileMessage, "");
    }

    function setupProfileEditor() {
        elements.editProfileButton?.addEventListener(
            "click",
            openProfileEditor
        );

        elements.cancelProfileEditButton?.addEventListener(
            "click",
            closeProfileEditor
        );

        elements.editProfileForm?.addEventListener(
            "submit",
            saveProfileChanges
        );

        if (elements.editProfileUserId) {
            elements.editProfileUserId.readOnly = true;
        }
    }

    function validateProfileEdit(
        name,
        email,
        phone,
        riskCategory,
        country,
        language,
        currency
    ) {
        if (name.length < 2 || name.length > 100) {
            return "Enter a valid full name between 2 and 100 characters.";
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return "Enter a valid email address.";
        }

        if (email.length > 254) {
            return "Email address is too long.";
        }

        const digits = phone.replace(/\D/g, "");

        if (
            phone.length < 7 ||
            phone.length > 20 ||
            digits.length < 7 ||
            digits.length > 15 ||
            !/^[0-9+\-()\s]+$/.test(phone)
        ) {
            return "Enter a valid phone number.";
        }

        if (!["low", "medium", "high"].includes(riskCategory)) {
            return "Select a valid risk category.";
        }

        if (!COUNTRY_CURRENCIES[country]) {
            return "Select a valid country.";
        }

        if (!LANGUAGES[language]) {
            return "Select a valid language.";
        }

        if (!ALLOWED_CURRENCIES.has(currency)) {
            return "Search for and select a valid currency.";
        }

        return "";
    }

    async function saveProfileChanges(event) {
        event.preventDefault();

        if (state.savingProfile) return;

        const name =
            elements.editProfileName?.value.trim() || "";

        const email =
            elements.editProfileEmail?.value.trim() || "";

        const phone =
            elements.editProfilePhone?.value.trim() || "";

        const riskCategory =
            elements.editProfileRiskCategory?.value || "";

        const country =
            elements.editProfileCountry?.value || "";

        const language =
            elements.editProfileLanguage?.value || "";

        const currency = parseCurrencyCode(
            elements.editProfileCurrencySearch?.value ||
            elements.editProfileCurrency?.value
        );

        if (elements.editProfileCurrency) {
            elements.editProfileCurrency.value = currency;
        }

        const validationError = validateProfileEdit(
            name,
            email,
            phone,
            riskCategory,
            country,
            language,
            currency
        );

        if (validationError) {
            setMessage(
                elements.editProfileMessage,
                validationError,
                "error"
            );

            return;
        }

        state.savingProfile = true;

        setButtonLoading(
            elements.saveProfileButton,
            true,
            "Save changes"
        );

        setMessage(
            elements.editProfileMessage,
            "Saving your profile changes...",
            "info"
        );

        try {
            const requestData = {
                name,
                email,
                phone,
                risk_category: riskCategory,
                country,
                language,
                preferred_currency: currency
            };

            const payload = await requestFirstSuccessful(
                API.updateProfile,
                {
                    method: "PATCH",
                    body: JSON.stringify(requestData)
                }
            );

            const updated = normalizeProfile(payload);

            const updatedProfile = {
                ...state.profile,

                name:
                    updated.name && updated.name !== "User"
                        ? updated.name
                        : name,

                email: updated.email || email,

                phone:
                    updated.phone !== ""
                        ? updated.phone
                        : phone,

                riskCategory:
                    updated.riskCategory !== "Not specified"
                        ? updated.riskCategory
                        : riskCategory,

                country: updated.country || country,
                language: updated.language || language,
                preferredCurrency:
                    updated.preferredCurrency || currency,

                // Never change the generated ID from frontend data.
                userId: state.profile.userId
            };

            renderProfile(updatedProfile);

            setCurrencyInput(
                elements.investmentCurrencySearch,
                elements.investmentCurrency,
                updatedProfile.preferredCurrency
            );

            updateCurrencySymbols();

            setMessage(
                elements.editProfileMessage,
                "Your profile and preferences have been updated successfully.",
                "success"
            );

            window.setTimeout(() => {
                if (!state.savingProfile && elements.editProfileForm) {
                    elements.editProfileForm.hidden = true;

                    elements.editProfileButton?.setAttribute(
                        "aria-expanded",
                        "false"
                    );
                }
            }, 1000);

        } catch (error) {
            setMessage(
                elements.editProfileMessage,
                error.message || "Unable to update your profile.",
                "error"
            );

        } finally {
            state.savingProfile = false;

            setButtonLoading(
                elements.saveProfileButton,
                false,
                "Save changes"
            );
        }
    }

    /* =====================================================
       PREDICTION PERFORMANCE
    ===================================================== */

    function extractPredictionArray(payload) {
        if (Array.isArray(payload)) return payload;

        const source = unwrapObject(payload);

        const candidates = [
            payload?.predictions,
            payload?.history,
            payload?.records,
            payload?.results,
            source?.predictions,
            source?.history,
            source?.records,
            source?.results
        ];

        return candidates.find(Array.isArray) || [];
    }

    function getRealizedPredictionPL(item) {
        const explicit = firstValue(
            item,
            [
                "realized_profit_loss",
                "realizedProfitLoss",
                "actual_profit_loss",
                "actualProfitLoss",
                "profit_loss",
                "profitLoss"
            ],
            null
        );

        if (explicit !== null && explicit !== "") {
            const status = String(
                firstValue(item, ["status", "state"], "")
            ).toLowerCase();

            if (
                status.includes("complete") ||
                status.includes("closed") ||
                item.is_realized === true ||
                item.realized === true ||
                item.actual_profit_loss !== undefined ||
                item.realized_profit_loss !== undefined
            ) {
                return numberValue(explicit, NaN);
            }
        }

        const entry = numberValue(
            firstValue(
                item,
                ["actual_entry_price", "entry_price", "buy_price"],
                0
            )
        );

        const exit = numberValue(
            firstValue(
                item,
                ["actual_exit_price", "exit_price", "sell_price"],
                0
            )
        );

        const quantity = numberValue(item.quantity, 0);

        const status = String(
            firstValue(item, ["status", "state"], "")
        ).toLowerCase();

        if (
            entry > 0 &&
            exit > 0 &&
            quantity > 0 &&
            (
                status.includes("complete") ||
                status.includes("closed") ||
                item.is_realized === true
            )
        ) {
            return (exit - entry) * quantity;
        }

        return NaN;
    }

    async function loadPredictionPerformance() {
        let history = [];

        for (const endpoint of API.predictionHistory) {
            try {
                const payload = await apiRequest(endpoint);

                history = extractPredictionArray(payload);

                if (history.length || payload.success !== false) {
                    break;
                }

            } catch {
                // Try the next compatible endpoint.
            }
        }

        state.predictionHistory = history;

        let completed = 0;
        let profitable = 0;
        let lossMaking = 0;

        const totalsByCurrency = {};

        history.forEach((item) => {
            const status = String(
                firstValue(item, ["status", "state"], "")
            ).toLowerCase();

            const isCompleted =
                status.includes("complete") ||
                status.includes("closed") ||
                item.is_realized === true ||
                item.realized === true;

            if (!isCompleted) return;

            const pl = getRealizedPredictionPL(item);

            if (!Number.isFinite(pl)) return;

            const currency = normalizeCurrency(
                firstValue(
                    item,
                    ["currency", "preferred_currency"],
                    state.profile?.preferredCurrency || "INR"
                )
            );

            completed += 1;

            totalsByCurrency[currency] =
                (totalsByCurrency[currency] || 0) + pl;

            if (pl > 0) profitable += 1;
            if (pl < 0) lossMaking += 1;
        });

        setText(elements.profileCompletedPredictions, completed);
        setText(elements.profileProfitablePredictions, profitable);
        setText(elements.profileLossMakingPredictions, lossMaking);

        const currencies = Object.keys(totalsByCurrency);

        if (elements.profileProfitLoss) {
            if (currencies.length) {
                elements.profileProfitLoss.textContent =
                    currencies
                        .sort()
                        .map((currency) => {
                            return formatCurrency(
                                totalsByCurrency[currency],
                                currency
                            );
                        })
                        .join("\n");
            } else {
                elements.profileProfitLoss.textContent =
                    formatCurrency(
                        0,
                        state.profile?.preferredCurrency || "INR"
                    );
            }

            elements.profileProfitLoss.classList.toggle(
                "positive",
                currencies.length === 1 &&
                totalsByCurrency[currencies[0]] > 0
            );

            elements.profileProfitLoss.classList.toggle(
                "negative",
                currencies.length === 1 &&
                totalsByCurrency[currencies[0]] < 0
            );

            elements.profileProfitLoss.style.whiteSpace = "pre-line";
        }

        setText(
            elements.profileProfitLossCaption,
            completed
                ? "Based on completed predictions. Different currencies are shown separately."
                : "No completed prediction outcomes recorded yet"
        );
    }

    /* =====================================================
       ASSET SEARCH AND SELECTION
    ===================================================== */

    function normalizeAsset(asset) {
        if (!asset || typeof asset !== "object") {
            return null;
        }

        const name = firstValue(
            asset,
            [
                "asset_name",
                "company_name",
                "companyName",
                "longname",
                "shortname",
                "name",
                "stock_name",
                "stockName"
            ],
            ""
        );

        const symbol = firstValue(
            asset,
            [
                "symbol",
                "ticker",
                "ticker_symbol",
                "tickerSymbol",
                "stock_symbol",
                "stockSymbol"
            ],
            ""
        );

        if (!name || !symbol) return null;

        return {
            asset_name: String(name).trim(),
            symbol: String(symbol).trim().toUpperCase(),

            exchange: firstValue(
                asset,
                ["exchange", "exchange_name"],
                ""
            ),

            quote_type: firstValue(
                asset,
                ["quote_type", "type", "asset_type"],
                ""
            )
        };
    }

    function setSelectedAsset(asset, options = {}) {
        const normalized = normalizeAsset(asset);

        if (!normalized) {
            setMessage(
                elements.investmentFormStatus,
                "The selected asset does not contain a valid company name and ticker.",
                "error"
            );

            return false;
        }

        state.selectedAsset = normalized;

        if (elements.investmentAssetName) {
            elements.investmentAssetName.value =
                normalized.asset_name;
        }

        if (elements.investmentSymbol) {
            elements.investmentSymbol.value =
                normalized.symbol;
        }

        if (elements.investmentAssetSearch) {
            elements.investmentAssetSearch.value =
                `${normalized.asset_name} (${normalized.symbol})`;
        }

        setText(
            elements.investmentSelectedAssetName,
            normalized.asset_name
        );

        setText(
            elements.investmentSelectedAssetSymbol,
            normalized.symbol
        );

        if (elements.investmentSelectedAsset) {
            elements.investmentSelectedAsset.hidden = false;
        }

        if (elements.clearInvestmentAssetButton) {
            elements.clearInvestmentAssetButton.hidden = false;
        }

        clearAssetSuggestions();

        setMessage(elements.investmentFormStatus, "");

        if (options.focusPrice) {
            elements.investmentPrice?.focus();
        }

        return true;
    }

    function selectAsset(asset) {
        setSelectedAsset(asset, {
            focusPrice: true
        });
    }

    function clearSelectedAsset() {
        state.selectedAsset = null;

        if (elements.investmentAssetName) {
            elements.investmentAssetName.value = "";
        }

        if (elements.investmentSymbol) {
            elements.investmentSymbol.value = "";
        }

        if (elements.investmentSelectedAsset) {
            elements.investmentSelectedAsset.hidden = true;
        }

        if (elements.clearInvestmentAssetButton) {
            elements.clearInvestmentAssetButton.hidden = true;
        }
    }

    function clearAssetSuggestions() {
        if (!elements.investmentAssetSuggestions) return;

        elements.investmentAssetSuggestions.replaceChildren();

        elements.investmentAssetSuggestions.hidden = true;

        elements.investmentAssetSearch?.setAttribute(
            "aria-expanded",
            "false"
        );
    }

    function extractAssetResults(payload) {
        if (Array.isArray(payload)) return payload;

        const candidates = [
            payload?.results,
            payload?.assets,
            payload?.items,
            payload?.data?.results,
            payload?.data?.assets,
            payload?.data?.items,
            payload?.data?.data,
            payload?.data
        ];

        return candidates.find(Array.isArray) || [];
    }

    function renderAssetSuggestions(assets) {
        const container = elements.investmentAssetSuggestions;

        if (!container) return;

        container.replaceChildren();

        const validAssets = assets
            .map(normalizeAsset)
            .filter(Boolean);

        if (!validAssets.length) {
            container.appendChild(
                createElement(
                    "div",
                    "investment-search-empty",
                    "No matching assets found. Try another company name or ticker."
                )
            );

            container.hidden = false;

            elements.investmentAssetSearch?.setAttribute(
                "aria-expanded",
                "true"
            );

            return;
        }

        validAssets.forEach((asset) => {
            const button = createElement(
                "button",
                "investment-asset-suggestion"
            );

            button.type = "button";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");

            const title = createElement(
                "span",
                "investment-suggestion-name",
                asset.asset_name
            );

            const ticker = createElement(
                "span",
                "investment-suggestion-symbol",
                asset.symbol
            );

            const details = [
                asset.exchange,
                asset.quote_type
            ].filter(Boolean).join(" · ");

            button.append(title, ticker);

            if (details) {
                button.appendChild(
                    createElement(
                        "small",
                        "investment-suggestion-details",
                        details
                    )
                );
            }

            button.addEventListener("click", () => {
                selectAsset(asset);
            });

            container.appendChild(button);
        });

        container.hidden = false;

        elements.investmentAssetSearch?.setAttribute(
            "aria-expanded",
            "true"
        );
    }

    async function searchInvestmentAssets(query) {
        if (query.length < 2) {
            clearAssetSuggestions();
            return;
        }

        if (state.searchController) {
            state.searchController.abort();
        }

        const controller = new AbortController();

        state.searchController = controller;

        let lastError = null;

        for (const endpoint of API.investmentSearch) {
            try {
                const url =
                    `${endpoint}?q=${encodeURIComponent(query)}`;

                const response = await fetch(url, {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json"
                    },
                    signal: controller.signal
                });

                let payload = {};

                try {
                    payload = await response.json();
                } catch {
                    payload = {};
                }

                if (
                    response.status === 401 ||
                    response.status === 403
                ) {
                    window.location.href = "/login";
                    return;
                }

                if (
                    !response.ok ||
                    payload.success === false
                ) {
                    throw new Error(
                        getErrorMessage(
                            payload,
                            "Asset search failed."
                        )
                    );
                }

                if (state.searchController !== controller) {
                    return;
                }

                renderAssetSuggestions(
                    extractAssetResults(payload)
                );

                return;

            } catch (error) {
                if (error.name === "AbortError") return;

                lastError = error;
            }
        }

        if (state.searchController !== controller) return;

        clearAssetSuggestions();

        setMessage(
            elements.investmentFormStatus,
            lastError?.message || "Unable to search assets right now.",
            "error"
        );
    }

    function handleAssetSearchInput() {
        clearSelectedAsset();

        const query =
            elements.investmentAssetSearch?.value.trim() || "";

        if (state.searchController) {
            state.searchController.abort();
            state.searchController = null;
        }

        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
        }

        if (query.length < 2) {
            clearAssetSuggestions();
            return;
        }

        state.searchTimer = window.setTimeout(() => {
            searchInvestmentAssets(query);
        }, 350);
    }

    function setupAssetSearch() {
        if (!elements.investmentAssetSearch) return;

        elements.investmentAssetSearch.addEventListener(
            "input",
            handleAssetSearchInput
        );

        elements.investmentAssetSearch.addEventListener(
            "keydown",
            (event) => {
                const container =
                    elements.investmentAssetSuggestions;

                if (!container || container.hidden) return;

                const options = Array.from(
                    container.querySelectorAll("button")
                );

                if (!options.length) return;

                const activeIndex = options.indexOf(
                    document.activeElement
                );

                if (event.key === "ArrowDown") {
                    event.preventDefault();

                    options[
                        Math.min(
                            activeIndex + 1,
                            options.length - 1
                        )
                    ].focus();

                } else if (event.key === "ArrowUp") {
                    event.preventDefault();

                    if (activeIndex <= 0) {
                        elements.investmentAssetSearch.focus();
                    } else {
                        options[activeIndex - 1].focus();
                    }

                } else if (event.key === "Enter") {
                    if (activeIndex >= 0) {
                        event.preventDefault();
                        options[activeIndex].click();
                    }

                } else if (event.key === "Escape") {
                    clearAssetSuggestions();
                }
            }
        );

        elements.investmentAssetSearch.addEventListener(
            "focus",
            () => {
                if (
                    elements.investmentAssetSearch.value.trim().length >= 2 &&
                    elements.investmentAssetSuggestions?.children.length
                ) {
                    elements.investmentAssetSuggestions.hidden = false;
                }
            }
        );

        document.addEventListener("click", (event) => {
            if (
                !elements.investmentAssetSearch?.contains(event.target) &&
                !elements.investmentAssetSuggestions?.contains(event.target)
            ) {
                clearAssetSuggestions();
            }
        });

        elements.clearInvestmentAssetButton?.addEventListener(
            "click",
            () => {
                if (elements.investmentAssetSearch) {
                    elements.investmentAssetSearch.value = "";
                }

                clearSelectedAsset();
                clearAssetSuggestions();

                elements.investmentAssetSearch?.focus();
            }
        );
    }

    /* =====================================================
       PREDICTION / HISTORY ASSET INTEGRATION
    ===================================================== */

    function getAssetFromURL() {
        const params = new URLSearchParams(
            window.location.search
        );

        const name = firstValue(
            Object.fromEntries(params.entries()),
            [
                "asset_name",
                "company_name",
                "companyName",
                "stock_name",
                "stockName",
                "name"
            ],
            ""
        );

        const symbol = firstValue(
            Object.fromEntries(params.entries()),
            [
                "symbol",
                "ticker",
                "ticker_symbol",
                "stock_symbol"
            ],
            ""
        );

        if (!name && !symbol) return null;

        return {
            asset_name: name || symbol,
            symbol: symbol || name
        };
    }

    function applyAssetFromURL() {
        const asset = getAssetFromURL();

        if (!asset) return;

        const selected = setSelectedAsset(asset);

        if (!selected) return;

        const params = new URLSearchParams(
            window.location.search
        );

        const investmentPrice = Number(
            params.get("investment_price")
        );

        const currency = normalizeCurrency(
            params.get("currency") ||
            state.profile?.preferredCurrency ||
            "INR"
        );

        if (
            Number.isFinite(investmentPrice) &&
            investmentPrice > 0 &&
            elements.investmentPrice
        ) {
            elements.investmentPrice.value =
                investmentPrice.toFixed(2);
        }

        setCurrencyInput(
            elements.investmentCurrencySearch,
            elements.investmentCurrency,
            currency
        );

        updateCurrencySymbols();

        setMessage(
            elements.investmentFormStatus,
            "Asset received from your prediction. Review the price and currency, enter your investment amount and date, then save.",
            "success"
        );

        elements.investmentForm?.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    function exposeAssetSelection() {
        window.MarketPlusProfileSelectAsset = (asset) => {
            const selected = setSelectedAsset(asset);

            if (selected) {
                elements.investmentForm?.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }

            return selected;
        };
    }

    /* =====================================================
       INVESTMENT DATA NORMALIZATION
    ===================================================== */

    function normalizeInvestment(item) {
        const investmentPrice = numberValue(
            firstValue(
                item,
                [
                    "investment_price",
                    "buy_price",
                    "purchase_price"
                ],
                0
            )
        );

        const investmentAmount = numberValue(
            firstValue(
                item,
                [
                    "investment_amount",
                    "amount_invested",
                    "total_investment"
                ],
                0
            )
        );

        const currency = normalizeCurrency(
            firstValue(
                item,
                [
                    "currency",
                    "currency_code",
                    "preferred_currency"
                ],
                state.profile?.preferredCurrency || "INR"
            )
        );

        const withdrawalPriceValue = firstValue(
            item,
            [
                "withdrawal_price",
                "sell_price",
                "exit_price"
            ],
            null
        );

        const withdrawalPrice =
            withdrawalPriceValue === null
                ? null
                : numberValue(withdrawalPriceValue);

        const withdrawalAmountValue = firstValue(
            item,
            [
                "withdrawal_amount",
                "sell_amount",
                "exit_amount"
            ],
            null
        );

        const withdrawalAmount =
            withdrawalAmountValue === null
                ? null
                : numberValue(withdrawalAmountValue);

        const investmentDate = normalizeDate(
            firstValue(
                item,
                [
                    "investment_date",
                    "buy_date",
                    "purchase_date"
                ],
                ""
            )
        );

        const withdrawalDate = normalizeDate(
            firstValue(
                item,
                [
                    "withdrawal_date",
                    "sell_date",
                    "exit_date"
                ],
                ""
            )
        );

        const statusText = String(
            firstValue(item, ["status", "state"], "")
        ).toUpperCase();

        const completed =
            statusText === "COMPLETED" ||
            statusText === "CLOSED" ||
            withdrawalPrice !== null ||
            Boolean(withdrawalDate);

        // Quantity is calculated internally only.
        const quantity =
            investmentPrice > 0 && investmentAmount > 0
                ? investmentAmount / investmentPrice
                : 0;

        const calculatedWithdrawalAmount =
            withdrawalPrice !== null
                ? quantity * withdrawalPrice
                : null;

        const finalWithdrawalAmount =
            withdrawalAmount !== null
                ? withdrawalAmount
                : calculatedWithdrawalAmount;

        const profitLossValue = firstValue(
            item,
            [
                "profit_loss",
                "realized_profit_loss",
                "profitLoss"
            ],
            null
        );

        const profitLoss =
            profitLossValue !== null
                ? numberValue(profitLossValue)
                : (
                    finalWithdrawalAmount !== null
                        ? finalWithdrawalAmount - investmentAmount
                        : null
                );

        const returnValue = firstValue(
            item,
            [
                "return_percentage",
                "profit_loss_percentage",
                "profitLossPercentage"
            ],
            null
        );

        const returnPercentage =
            returnValue !== null
                ? numberValue(returnValue)
                : (
                    profitLoss !== null && investmentAmount > 0
                        ? (profitLoss / investmentAmount) * 100
                        : null
                );

        return {
            id: firstValue(
                item,
                ["id", "trade_id", "investment_id"],
                ""
            ),

            assetName: firstValue(
                item,
                ["asset_name", "name"],
                "Unknown asset"
            ),

            symbol: firstValue(
                item,
                ["symbol", "ticker"],
                ""
            ),

            currency,

            investmentDate,
            investmentPrice,
            investmentAmount,

            withdrawalDate,
            withdrawalPrice,
            withdrawalAmount: finalWithdrawalAmount,

            profitLoss,
            returnPercentage,
            completed
        };
    }

    function extractInvestmentSummary(payload) {
        const source = unwrapObject(payload);

        let open = Array.isArray(source.open_investments)
            ? source.open_investments
            : null;

        let completed = Array.isArray(
            source.completed_investments
        )
            ? source.completed_investments
            : null;

        const allTrades = Array.isArray(source.trades)
            ? source.trades
            : Array.isArray(source.investments)
                ? source.investments
                : [];

        if (!open || !completed) {
            const normalized = allTrades.map(normalizeInvestment);

            if (!open) {
                open = normalized.filter(
                    (item) => !item.completed
                );
            }

            if (!completed) {
                completed = normalized.filter(
                    (item) => item.completed
                );
            }
        }

        return {
            open: open
                .map(normalizeInvestment)
                .filter((item) => !item.completed),

            completed: completed
                .map(normalizeInvestment)
                .filter((item) => item.completed)
        };
    }

    /* =====================================================
       INVESTMENT TABLE RENDERING
    ===================================================== */

    function showInvestmentMessage(message, type = "info") {
        setMessage(
            elements.investmentListMessage,
            message,
            type
        );
    }

    function renderEmptyRow(tbody, columnCount, message) {
        if (!tbody) return;

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = columnCount;
        cell.textContent = message;
        cell.className = "investment-empty-cell";

        row.appendChild(cell);
        tbody.replaceChildren(row);
    }

    function renderOpenInvestments(investments) {
        const tbody = elements.openInvestmentsBody;

        if (!tbody) return;

        tbody.replaceChildren();

        if (!investments.length) {
            renderEmptyRow(
                tbody,
                5,
                "You don't have any open investments yet."
            );

            return;
        }

        investments.forEach((investment) => {
            const row = document.createElement("tr");

            const assetCell = appendCell(row, "");

            const assetName = createElement(
                "strong",
                "",
                investment.assetName
            );

            const symbol = createElement(
                "small",
                "investment-table-symbol",
                investment.symbol
            );

            const currency = createElement(
                "small",
                "investment-table-currency",
                investment.currency
            );

            assetCell.append(
                assetName,
                document.createElement("br"),
                symbol,
                document.createElement("br"),
                currency
            );

            appendCell(
                row,
                formatDate(investment.investmentDate)
            );

            appendCell(
                row,
                formatCurrency(
                    investment.investmentPrice,
                    investment.currency
                )
            );

            appendCell(
                row,
                formatCurrency(
                    investment.investmentAmount,
                    investment.currency
                )
            );

            const actionCell = document.createElement("td");

            const button = createElement(
                "button",
                "investment-withdrawal-button",
                "Record withdrawal"
            );

            button.type = "button";
            button.disabled = !investment.id;

            button.addEventListener("click", () => {
                openWithdrawalModal(investment);
            });

            actionCell.appendChild(button);
            row.appendChild(actionCell);

            tbody.appendChild(row);
        });
    }

    function renderCompletedInvestments(investments) {
        const tbody = elements.completedInvestmentsBody;

        if (!tbody) return;

        tbody.replaceChildren();

        if (!investments.length) {
            renderEmptyRow(
                tbody,
                10,
                "No completed investments yet. Record a withdrawal to see it here."
            );

            return;
        }

        investments.forEach((investment) => {
            const row = document.createElement("tr");

            const assetCell = appendCell(row, "");

            const assetName = createElement(
                "strong",
                "",
                investment.assetName
            );

            const symbol = createElement(
                "small",
                "investment-table-symbol",
                investment.symbol
            );

            const currency = createElement(
                "small",
                "investment-table-currency",
                investment.currency
            );

            assetCell.append(
                assetName,
                document.createElement("br"),
                symbol,
                document.createElement("br"),
                currency
            );

            appendCell(
                row,
                formatDate(investment.investmentDate)
            );

            appendCell(
                row,
                formatCurrency(
                    investment.investmentPrice,
                    investment.currency
                )
            );

            appendCell(
                row,
                formatCurrency(
                    investment.investmentAmount,
                    investment.currency
                )
            );

            appendCell(
                row,
                formatDate(investment.withdrawalDate)
            );

            appendCell(
                row,
                investment.withdrawalPrice === null
                    ? "—"
                    : formatCurrency(
                        investment.withdrawalPrice,
                        investment.currency
                    )
            );

            appendCell(
                row,
                investment.withdrawalAmount === null
                    ? "—"
                    : formatCurrency(
                        investment.withdrawalAmount,
                        investment.currency
                    )
            );

            const plCell = appendCell(
                row,
                investment.profitLoss === null
                    ? "—"
                    : formatCurrency(
                        investment.profitLoss,
                        investment.currency
                    )
            );

            if (investment.profitLoss > 0) {
                plCell.classList.add("positive");
            } else if (investment.profitLoss < 0) {
                plCell.classList.add("negative");
            }

            const returnCell = appendCell(
                row,
                investment.returnPercentage === null
                    ? "—"
                    : formatPercentage(investment.returnPercentage)
            );

            if (investment.returnPercentage > 0) {
                returnCell.classList.add("positive");
            } else if (investment.returnPercentage < 0) {
                returnCell.classList.add("negative");
            }

            const statusCell = appendCell(row, "Completed");

            statusCell.classList.add(
                "investment-completed-status"
            );

            // Completed investments are read-only.
            tbody.appendChild(row);
        });
    }

    function groupProfitLossByCurrency(investments) {
        const totals = {};

        investments.forEach((investment) => {
            if (investment.profitLoss === null) return;

            const currency = normalizeCurrency(
                investment.currency
            );

            totals[currency] =
                (totals[currency] || 0) +
                numberValue(investment.profitLoss);
        });

        return totals;
    }

    function renderInvestmentSummary(open, completed) {
        const totals = groupProfitLossByCurrency(completed);

        const currencies = Object.keys(totals).sort();

        const profitableCount = completed.filter(
            (investment) => {
                return numberValue(investment.profitLoss) > 0;
            }
        ).length;

        setText(elements.investmentOpenCount, open.length);

        setText(
            elements.investmentCompletedCount,
            completed.length
        );

        setText(
            elements.investmentProfitableCount,
            profitableCount
        );

        if (elements.investmentRealizedPL) {
            if (currencies.length) {
                elements.investmentRealizedPL.textContent =
                    currencies
                        .map((currency) => {
                            return formatCurrency(
                                totals[currency],
                                currency
                            );
                        })
                        .join("\n");
            } else {
                elements.investmentRealizedPL.textContent =
                    formatCurrency(
                        0,
                        state.profile?.preferredCurrency || "INR"
                    );
            }

            elements.investmentRealizedPL.style.whiteSpace =
                "pre-line";

            const allPositive =
                currencies.length > 0 &&
                currencies.every((currency) => totals[currency] >= 0);

            const allNegative =
                currencies.length > 0 &&
                currencies.every((currency) => totals[currency] <= 0);

            elements.investmentRealizedPL.classList.toggle(
                "positive",
                allPositive
            );

            elements.investmentRealizedPL.classList.toggle(
                "negative",
                allNegative
            );
        }
    }

    async function loadInvestments() {
        if (state.loadingInvestments) return;

        state.loadingInvestments = true;

        if (elements.refreshInvestmentsButton) {
            elements.refreshInvestmentsButton.disabled = true;
        }

        showInvestmentMessage(
            "Loading investments...",
            "info"
        );

        try {
            const payload = await requestFirstSuccessful(
                API.investments
            );

            const result = extractInvestmentSummary(payload);

            state.openInvestments = result.open;
            state.completedInvestments = result.completed;

            renderOpenInvestments(state.openInvestments);

            renderCompletedInvestments(
                state.completedInvestments
            );

            renderInvestmentSummary(
                state.openInvestments,
                state.completedInvestments
            );

            showInvestmentMessage(
                state.openInvestments.length ||
                state.completedInvestments.length
                    ? "Investment records loaded successfully."
                    : "Add your first investment to start tracking performance.",
                "success"
            );

        } catch (error) {
            showInvestmentMessage(
                error.message || "Unable to load investments.",
                "error"
            );

            renderEmptyRow(
                elements.openInvestmentsBody,
                5,
                "Unable to load open investments."
            );

            renderEmptyRow(
                elements.completedInvestmentsBody,
                10,
                "Unable to load completed investments."
            );

        } finally {
            state.loadingInvestments = false;

            if (elements.refreshInvestmentsButton) {
                elements.refreshInvestmentsButton.disabled = false;
            }
        }
    }

    /* =====================================================
       ADD INVESTMENT
    ===================================================== */

    function setupInvestmentForm() {
        if (!elements.investmentForm) return;

        if (elements.investmentBuyDate) {
            elements.investmentBuyDate.max = getToday();

            if (!elements.investmentBuyDate.value) {
                elements.investmentBuyDate.value = getToday();
            }
        }

        elements.investmentForm.addEventListener(
            "submit",
            saveInvestment
        );

        elements.refreshInvestmentsButton?.addEventListener(
            "click",
            loadInvestments
        );
    }

    async function saveInvestment(event) {
        event.preventDefault();

        if (state.savingInvestment) return;

        let assetName =
            elements.investmentAssetName?.value.trim() || "";

        let symbol =
            elements.investmentSymbol?.value.trim() || "";

        if (
            (!assetName || !symbol) &&
            state.selectedAsset
        ) {
            assetName = state.selectedAsset.asset_name;
            symbol = state.selectedAsset.symbol;
        }

        if (
            assetName &&
            symbol &&
            !state.selectedAsset
        ) {
            state.selectedAsset = {
                asset_name: assetName,
                symbol: symbol.toUpperCase()
            };
        }

        const investmentPrice =
            Number(elements.investmentPrice?.value);

        const investmentAmount =
            Number(elements.investmentAmount?.value);

        const buyDate =
            elements.investmentBuyDate?.value || "";

        const currency = parseCurrencyCode(
            elements.investmentCurrencySearch?.value ||
            elements.investmentCurrency?.value
        );

        if (!assetName || !symbol) {
            setMessage(
                elements.investmentFormStatus,
                "Search for an asset and select one of the suggestions first.",
                "error"
            );

            elements.investmentAssetSearch?.focus();

            return;
        }

        if (!ALLOWED_CURRENCIES.has(currency)) {
            setMessage(
                elements.investmentFormStatus,
                "Search for and select a valid investment currency.",
                "error"
            );

            elements.investmentCurrencySearch?.focus();

            return;
        }

        if (elements.investmentCurrency) {
            elements.investmentCurrency.value = currency;
        }

        if (elements.investmentAssetName) {
            elements.investmentAssetName.value = assetName;
        }

        if (elements.investmentSymbol) {
            elements.investmentSymbol.value = symbol;
        }

        if (
            !Number.isFinite(investmentPrice) ||
            investmentPrice <= 0
        ) {
            setMessage(
                elements.investmentFormStatus,
                "Enter a valid investment price per share.",
                "error"
            );

            elements.investmentPrice?.focus();

            return;
        }

        if (
            !Number.isFinite(investmentAmount) ||
            investmentAmount <= 0
        ) {
            setMessage(
                elements.investmentFormStatus,
                "Enter a valid total investment amount.",
                "error"
            );

            elements.investmentAmount?.focus();

            return;
        }

        if (!buyDate || buyDate > getToday()) {
            setMessage(
                elements.investmentFormStatus,
                "Choose a valid investment date. Future dates are not allowed.",
                "error"
            );

            return;
        }

        state.savingInvestment = true;

        setButtonLoading(
            elements.saveInvestmentButton,
            true,
            "Save investment"
        );

        setMessage(
            elements.investmentFormStatus,
            "Saving your investment...",
            "info"
        );

        try {
            const requestData = {
                asset_name: assetName,
                symbol: symbol.toUpperCase(),
                investment_price: investmentPrice,
                investment_amount: investmentAmount,
                buy_date: buyDate,
                currency
            };

            await requestFirstSuccessful(
                API.investments,
                {
                    method: "POST",
                    body: JSON.stringify(requestData)
                }
            );

            elements.investmentForm.reset();

            clearSelectedAsset();
            clearAssetSuggestions();

            // Reset currency to the user's preferred currency.
            setCurrencyInput(
                elements.investmentCurrencySearch,
                elements.investmentCurrency,
                state.profile?.preferredCurrency || "INR"
            );

            updateCurrencySymbols();

            if (elements.investmentBuyDate) {
                elements.investmentBuyDate.value = getToday();
                elements.investmentBuyDate.max = getToday();
            }

            setMessage(
                elements.investmentFormStatus,
                "Investment saved successfully. It is now listed under Open Investments.",
                "success"
            );

            await loadInvestments();

        } catch (error) {
            setMessage(
                elements.investmentFormStatus,
                error.message || "Unable to save this investment.",
                "error"
            );

        } finally {
            state.savingInvestment = false;

            setButtonLoading(
                elements.saveInvestmentButton,
                false,
                "Save investment"
            );
        }
    }

    /* =====================================================
       WITHDRAWAL MODAL
    ===================================================== */

    function setWithdrawalMessage(message, type = "info") {
        setMessage(
            elements.withdrawalFormMessage,
            message,
            type
        );
    }

    function openWithdrawalModal(investment) {
        if (!elements.withdrawalModal) return;

        state.selectedWithdrawal = investment;

        if (elements.withdrawalInvestmentId) {
            elements.withdrawalInvestmentId.value =
                investment.id;
        }

        setText(
            elements.withdrawalAssetName,
            investment.assetName
        );

        setText(
            elements.withdrawalAssetSymbol,
            investment.symbol
        );

        if (elements.investmentWithdrawalPrice) {
            elements.investmentWithdrawalPrice.value = "";
        }

        if (elements.investmentSellDate) {
            elements.investmentSellDate.value = getToday();

            elements.investmentSellDate.max = getToday();

            elements.investmentSellDate.min =
                investment.investmentDate || "";
        }

        updateCurrencySymbols();

        setWithdrawalMessage("");

        elements.withdrawalModal.hidden = false;

        elements.withdrawalModal.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.style.overflow = "hidden";

        window.setTimeout(() => {
            elements.investmentWithdrawalPrice?.focus();
        }, 50);
    }

    function closeWithdrawalModal() {
        if (
            state.savingWithdrawal ||
            !elements.withdrawalModal
        ) {
            return;
        }

        elements.withdrawalModal.hidden = true;

        elements.withdrawalModal.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.style.overflow = "";

        state.selectedWithdrawal = null;

        updateCurrencySymbols();
    }

    function setupWithdrawalModal() {
        elements.withdrawalForm?.addEventListener(
            "submit",
            saveWithdrawal
        );

        elements.closeWithdrawalModalButton?.addEventListener(
            "click",
            closeWithdrawalModal
        );

        elements.cancelWithdrawalButton?.addEventListener(
            "click",
            closeWithdrawalModal
        );

        elements.withdrawalModalBackdrop?.addEventListener(
            "click",
            closeWithdrawalModal
        );

        elements.withdrawalModal?.addEventListener(
            "click",
            (event) => {
                if (
                    event.target === elements.withdrawalModal ||
                    event.target === elements.withdrawalModalBackdrop
                ) {
                    closeWithdrawalModal();
                }
            }
        );
    }

    async function saveWithdrawal(event) {
        event.preventDefault();

        if (state.savingWithdrawal) return;

        const investment = state.selectedWithdrawal;

        const id =
            elements.withdrawalInvestmentId?.value || "";

        const withdrawalPrice =
            Number(elements.investmentWithdrawalPrice?.value);

        const withdrawalDate =
            elements.investmentSellDate?.value || "";

        if (!investment || !id) {
            setWithdrawalMessage(
                "Select an open investment first.",
                "error"
            );

            return;
        }

        if (
            !Number.isFinite(withdrawalPrice) ||
            withdrawalPrice <= 0
        ) {
            setWithdrawalMessage(
                "Enter a valid withdrawal price per share.",
                "error"
            );

            return;
        }

        if (!withdrawalDate || withdrawalDate > getToday()) {
            setWithdrawalMessage(
                "Choose a valid withdrawal date. Future dates are not allowed.",
                "error"
            );

            return;
        }

        if (
            investment.investmentDate &&
            withdrawalDate < investment.investmentDate
        ) {
            setWithdrawalMessage(
                "Withdrawal date cannot be earlier than the investment date.",
                "error"
            );

            return;
        }

        state.savingWithdrawal = true;

        setButtonLoading(
            elements.confirmWithdrawalButton,
            true,
            "Complete investment"
        );

        try {
            await apiRequest(
                `/api/investments/${encodeURIComponent(id)}/close`,
                {
                    method: "POST",

                    body: JSON.stringify({
                        withdrawal_price: withdrawalPrice,
                        withdrawal_date: withdrawalDate,

                        // Withdrawal must use the original trade currency.
                        currency: investment.currency
                    })
                }
            );

            closeWithdrawalModal();

            await loadInvestments();

            showInvestmentMessage(
                "Investment completed successfully. It has moved to Completed Investments.",
                "success"
            );

        } catch (error) {
            setWithdrawalMessage(
                error.message || "Unable to complete this investment.",
                "error"
            );

        } finally {
            state.savingWithdrawal = false;

            setButtonLoading(
                elements.confirmWithdrawalButton,
                false,
                "Complete investment"
            );
        }
    }

    /* =====================================================
       SIDEBAR AND LOGOUT
    ===================================================== */

    function setupSidebar() {
        const sidebar = $("appSidebar");
        const overlay = $("sidebarOverlay");

        const openButton =
            $("mobileMenuButton") ||
            document.querySelector("[data-sidebar-toggle]");

        const closeSidebar = () => {
            sidebar?.classList.remove("active", "open");
            overlay?.classList.remove("active", "visible");

            document.body.classList.remove("sidebar-open");

            openButton?.setAttribute("aria-expanded", "false");
        };

        const openSidebar = () => {
            sidebar?.classList.add("active", "open");
            overlay?.classList.add("active", "visible");

            document.body.classList.add("sidebar-open");

            openButton?.setAttribute("aria-expanded", "true");
        };

        openButton?.addEventListener("click", () => {
            const isOpen =
                sidebar?.classList.contains("active") ||
                sidebar?.classList.contains("open");

            if (isOpen) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });

        overlay?.addEventListener("click", closeSidebar);

        sidebar?.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= 900) {
                    closeSidebar();
                }
            });
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 900) {
                closeSidebar();
            }
        });
    }

    async function logout() {
        if (elements.logoutButton) {
            elements.logoutButton.disabled = true;
        }

        try {
            await apiRequest("/api/auth/logout", {
                method: "POST",
                body: JSON.stringify({})
            });

        } catch {
            // Continue to login if logout endpoint is unavailable.

        } finally {
            window.location.href = "/login";
        }
    }

    function setupLogout() {
        elements.logoutButton?.addEventListener(
            "click",
            logout
        );
    }

    function setupRetry() {
        elements.retryProfileButton?.addEventListener(
            "click",
            loadProfile
        );
    }

    function setupEscapeKey() {
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;

            if (
                elements.withdrawalModal &&
                !elements.withdrawalModal.hidden
            ) {
                closeWithdrawalModal();
            }

            clearAssetSuggestions();
        });
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function initializeProfilePage() {
        setupSidebar();
        setupLogout();
        setupRetry();

        setupCountryOptions();
        setupLanguageOptions();
        setupCurrencyInputs();

        setupProfileEditor();

        setupAssetSearch();
        setupInvestmentForm();
        setupWithdrawalModal();
        setupEscapeKey();

        exposeAssetSelection();

        // Load the registered user's preferences first.
        await loadProfile();

        // Apply a passed asset only after the user's currency is known.
        applyAssetFromURL();

        // Load investment records after profile preferences.
        await loadInvestments();

        updateCurrencySymbols();
    }

    /* =====================================================
       PUBLIC PROFILE API
    ===================================================== */

    window.MarketPlusProfile = {
        reload: loadProfile,

        reloadInvestments: loadInvestments,

        selectAsset: setSelectedAsset,

        getState: () => ({
            openInvestmentCount:
                state.openInvestments.length,

            completedInvestmentCount:
                state.completedInvestments.length,

            profileLoaded:
                Boolean(state.profile),

            preferredCurrency:
                state.profile?.preferredCurrency || null,

            country:
                state.profile?.country || null,

            language:
                state.profile?.language || null,

            selectedAsset:
                state.selectedAsset
                    ? {
                        asset_name: state.selectedAsset.asset_name,
                        symbol: state.selectedAsset.symbol
                    }
                    : null
        })
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializeProfilePage,
            { once: true }
        );
    } else {
        initializeProfilePage();
    }
})();
