
"use strict";

document.addEventListener("DOMContentLoaded", () => {

    // --------------------------------------------------
    // ELEMENT REFERENCES
    // --------------------------------------------------

    const signupForm = document.getElementById("signupForm");

    const fullNameInput = document.getElementById("fullName");
    const emailInput = document.getElementById("email");
    const phoneInput = document.getElementById("phone");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const agreeTermsInput = document.getElementById("agreeTerms");

    const countryInput = document.getElementById("country");
    const languageInput = document.getElementById("language");
    const currencyInput = document.getElementById("preferredCurrency");
    const currencyPreview = document.getElementById("currencyPreview");

    const signupButton = document.getElementById("signupButton");
    const signupButtonText = document.getElementById("signupButtonText");
    const signupMessage = document.getElementById("signupMessage");

    const togglePassword = document.getElementById("togglePassword");
    const toggleConfirmPassword = document.getElementById(
        "toggleConfirmPassword"
    );

    if (!signupForm) {
        console.error("Signup form was not found.");
        return;
    }

    const originalButtonText = signupButtonText
        ? signupButtonText.textContent.trim()
        : "Create Account";

    let isSubmitting = false;

    // --------------------------------------------------
    // COUNTRY AND CURRENCY CONFIGURATION
    // --------------------------------------------------

    const countrySettings = {
        "India": ["INR", "₹", "Indian Rupee"],
        "United States": ["USD", "$", "US Dollar"],
        "United Kingdom": ["GBP", "£", "British Pound"],
        "Canada": ["CAD", "C$", "Canadian Dollar"],
        "Australia": ["AUD", "A$", "Australian Dollar"],
        "Germany": ["EUR", "€", "Euro"],
        "France": ["EUR", "€", "Euro"],
        "Italy": ["EUR", "€", "Euro"],
        "Spain": ["EUR", "€", "Euro"],
        "Netherlands": ["EUR", "€", "Euro"],
        "Switzerland": ["CHF", "CHF", "Swiss Franc"],
        "Belgium": ["EUR", "€", "Euro"],
        "Ireland": ["EUR", "€", "Euro"],
        "Portugal": ["EUR", "€", "Euro"],
        "Sweden": ["SEK", "kr", "Swedish Krona"],
        "Norway": ["NOK", "kr", "Norwegian Krone"],
        "Denmark": ["DKK", "kr", "Danish Krone"],
        "Finland": ["EUR", "€", "Euro"],
        "Poland": ["PLN", "zł", "Polish Zloty"],
        "Japan": ["JPY", "¥", "Japanese Yen"],
        "China": ["CNY", "¥", "Chinese Yuan"],
        "South Korea": ["KRW", "₩", "South Korean Won"],
        "Singapore": ["SGD", "S$", "Singapore Dollar"],
        "Malaysia": ["MYR", "RM", "Malaysian Ringgit"],
        "Indonesia": ["IDR", "Rp", "Indonesian Rupiah"],
        "Thailand": ["THB", "฿", "Thai Baht"],
        "Philippines": ["PHP", "₱", "Philippine Peso"],
        "Vietnam": ["VND", "₫", "Vietnamese Dong"],
        "United Arab Emirates": ["AED", "د.إ", "UAE Dirham"],
        "Saudi Arabia": ["SAR", "ر.س", "Saudi Riyal"],
        "Qatar": ["QAR", "ر.ق", "Qatari Riyal"],
        "Kuwait": ["KWD", "د.ك", "Kuwaiti Dinar"],
        "Oman": ["OMR", "ر.ع.", "Omani Rial"],
        "Bahrain": ["BHD", "د.ب", "Bahraini Dinar"],
        "South Africa": ["ZAR", "R", "South African Rand"],
        "Nigeria": ["NGN", "₦", "Nigerian Naira"],
        "Kenya": ["KES", "KSh", "Kenyan Shilling"],
        "Egypt": ["EGP", "E£", "Egyptian Pound"],
        "Brazil": ["BRL", "R$", "Brazilian Real"],
        "Mexico": ["MXN", "Mex$", "Mexican Peso"],
        "Argentina": ["ARS", "$", "Argentine Peso"],
        "New Zealand": ["NZD", "NZ$", "New Zealand Dollar"],
        "Turkey": ["TRY", "₺", "Turkish Lira"],
        "Bangladesh": ["BDT", "৳", "Bangladeshi Taka"],
        "Pakistan": ["PKR", "Rs", "Pakistani Rupee"],
        "Nepal": ["NPR", "रू", "Nepalese Rupee"],
        "Sri Lanka": ["LKR", "Rs", "Sri Lankan Rupee"]
    };

    function updateCountryPreferences() {

        if (!countryInput || !currencyInput || !currencyPreview) {
            return false;
        }

        const country = countryInput.value;
        const settings = countrySettings[country];

        if (!settings) {
            currencyInput.value = "";
            currencyPreview.value = "Currency unavailable";
            return false;
        }

        const [code, symbol, name] = settings;

        currencyInput.value = code;
        currencyPreview.value = `${symbol} ${code} — ${name}`;

        return true;
    }

    if (countryInput) {
        countryInput.addEventListener("change", () => {
            updateCountryPreferences();
            clearMessage();
        });
    }

    if (languageInput) {
        languageInput.addEventListener("change", clearMessage);
    }

    // --------------------------------------------------
    // MESSAGE DISPLAY
    // --------------------------------------------------

    function showMessage(message, type = "error") {

        if (!signupMessage) {
            window.alert(message);
            return;
        }

        signupMessage.textContent = message;

        signupMessage.classList.remove(
            "success",
            "error",
            "warning",
            "is-success",
            "is-error"
        );

        signupMessage.classList.add(
            type === "success" ? "success" : "error"
        );

        signupMessage.setAttribute("role", "alert");
        signupMessage.hidden = false;
    }

    function clearMessage() {

        if (!signupMessage) return;

        signupMessage.textContent = "";
        signupMessage.hidden = true;

        signupMessage.classList.remove(
            "success",
            "error",
            "warning",
            "is-success",
            "is-error"
        );
    }

    // --------------------------------------------------
    // PASSWORD VISIBILITY
    // --------------------------------------------------

    function setupPasswordToggle(button, input) {

        if (!button || !input) return;

        button.setAttribute("aria-label", "Show password");

        button.addEventListener("click", () => {

            const isHidden = input.type === "password";

            input.type = isHidden ? "text" : "password";

            button.setAttribute(
                "aria-label",
                isHidden ? "Hide password" : "Show password"
            );

            button.setAttribute(
                "aria-pressed",
                String(isHidden)
            );

            button.textContent = isHidden ? "Hide" : "Show";
        });
    }

    setupPasswordToggle(togglePassword, passwordInput);
    setupPasswordToggle(toggleConfirmPassword, confirmPasswordInput);

    // --------------------------------------------------
    // INPUT VALIDATION
    // --------------------------------------------------

    function validateForm() {

        const fullName = fullNameInput?.value.trim() || "";
        const email = emailInput?.value.trim() || "";
        const phone = phoneInput?.value.trim() || "";

        const password = passwordInput?.value || "";
        const confirmPassword = confirmPasswordInput?.value || "";

        const country = countryInput?.value || "";
        const language = languageInput?.value || "";
        const currency = currencyInput?.value || "";

        const selectedRisk = signupForm.querySelector(
            'input[name="risk_category"]:checked'
        );

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneDigits = phone.replace(/\D/g, "");

        if (fullName.length < 2) {
            showMessage("Please enter your full name.");
            fullNameInput?.focus();
            return false;
        }

        if (fullName.length > 100) {
            showMessage("Your name must be 100 characters or fewer.");
            fullNameInput?.focus();
            return false;
        }

        if (!emailPattern.test(email)) {
            showMessage("Please enter a valid email address.");
            emailInput?.focus();
            return false;
        }

        if (email.length > 254) {
            showMessage("Please use a shorter email address.");
            emailInput?.focus();
            return false;
        }

        if (phoneDigits.length < 7 || phoneDigits.length > 15) {
            showMessage(
                "Please enter a valid phone number with 7–15 digits."
            );
            phoneInput?.focus();
            return false;
        }

        if (!country || !countrySettings[country]) {
            showMessage("Please select a valid country.");
            countryInput?.focus();
            return false;
        }

        if (!language) {
            showMessage("Please select your preferred language.");
            languageInput?.focus();
            return false;
        }

        if (!currency || !countrySettings[country]) {
            showMessage("Unable to determine your display currency.");
            return false;
        }

        if (password.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters."
            );
            passwordInput?.focus();
            return false;
        }

        if (password.length > 128) {
            showMessage("Your password must be 128 characters or fewer.");
            passwordInput?.focus();
            return false;
        }

        if (password !== confirmPassword) {
            showMessage("The passwords do not match.");
            confirmPasswordInput?.focus();
            return false;
        }

        if (!selectedRisk) {
            showMessage("Please select a risk category.");
            return false;
        }

        if (!agreeTermsInput?.checked) {
            showMessage(
                "Please agree to the terms and prediction disclaimer."
            );
            agreeTermsInput?.focus();
            return false;
        }

        return true;
    }

    // --------------------------------------------------
    // BUTTON LOADING STATE
    // --------------------------------------------------

    function setLoading(loading) {

        if (signupButton) {
            signupButton.disabled = loading;

            signupButton.setAttribute(
                "aria-busy",
                String(loading)
            );
        }

        if (signupButtonText) {
            signupButtonText.textContent = loading
                ? "Creating Account..."
                : originalButtonText;
        }
    }

    // --------------------------------------------------
    // API RESPONSE HANDLING
    // --------------------------------------------------

    async function readResponse(response) {

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            return await response.json();
        }

        const responseText = await response.text();

        return {
            message: responseText ||
                "The server returned an unexpected response."
        };
    }

    function getErrorMessage(data, status) {

        if (typeof data?.message === "string" && data.message.trim()) {
            return data.message;
        }

        if (typeof data?.error === "string" && data.error.trim()) {
            return data.error;
        }

        if (status === 400) {
            return "Please check your registration details and try again.";
        }

        if (status === 409) {
            return "An account with this email address may already exist.";
        }

        if (status === 429) {
            return "Too many attempts. Please wait and try again.";
        }

        if (status >= 500) {
            return "The server encountered an error. Please try again later.";
        }

        return "Registration failed. Please check your details and try again.";
    }

    function getGeneratedUserId(data) {

        return (
            data?.user_id ||
            data?.userId ||
            data?.user?.user_id ||
            data?.user?.userId ||
            data?.user?.id ||
            ""
        );
    }

    // --------------------------------------------------
    // REGISTRATION
    // --------------------------------------------------

    signupForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        if (isSubmitting) return;

        clearMessage();

        // Recalculate currency immediately before submission.
        if (!updateCountryPreferences()) {
            showMessage("Please select a valid country.");
            countryInput?.focus();
            return;
        }

        if (!validateForm()) return;

        const fullName = fullNameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();

        const password = passwordInput.value;

        const riskCategory = signupForm.querySelector(
            'input[name="risk_category"]:checked'
        ).value;

        const country = countryInput.value;
        const language = languageInput.value;
        const preferredCurrency = currencyInput.value;

        // --------------------------------------------------
        // REGISTRATION PAYLOAD
        // --------------------------------------------------

        const registrationData = {

            name: fullName,
            full_name: fullName,

            email: email,
            phone: phone,

            password: password,
            confirm_password: confirmPasswordInput.value,

            risk_category: riskCategory,

            // New international preferences.
            country: country,
            language: language,
            preferred_currency: preferredCurrency
        };

        isSubmitting = true;
        setLoading(true);

        try {

            const response = await fetch("/api/auth/register", {

                method: "POST",

                credentials: "same-origin",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify(registrationData)

            });

            const data = await readResponse(response);

            if (!response.ok || data?.success === false) {

                throw new Error(
                    getErrorMessage(data, response.status)
                );
            }

            const generatedUserId = getGeneratedUserId(data);

            if (generatedUserId) {

                showMessage(
                    `Account created successfully! Your User ID is ${generatedUserId}. Redirecting to login...`,
                    "success"
                );

            } else {

                showMessage(
                    "Your account was created successfully. Redirecting to login...",
                    "success"
                );
            }

            signupForm.reset();

            // Restore default country and currency.
            if (countryInput) {
                countryInput.value = "India";
            }

            if (languageInput) {
                languageInput.value = "en";
            }

            updateCountryPreferences();

            // Restore default risk category.
            const defaultRisk = signupForm.querySelector(
                'input[name="risk_category"][value="middle"]'
            );

            if (defaultRisk) {
                defaultRisk.checked = true;
            }

            // Redirect after the success message.
            window.setTimeout(() => {
                window.location.assign("/login");
            }, 2200);

        } catch (error) {

            console.error("Signup error:", error);

            showMessage(
                error instanceof TypeError
                    ? "Unable to connect to the server. Check that Market Plus AI is running and try again."
                    : error.message ||
                      "Something went wrong. Please try again."
            );

        } finally {

            isSubmitting = false;
            setLoading(false);
        }
    });

    // --------------------------------------------------
    // CLEAR ERRORS WHILE EDITING
    // --------------------------------------------------

    [
        fullNameInput,
        emailInput,
        phoneInput,
        passwordInput,
        confirmPasswordInput,
        agreeTermsInput,
        countryInput,
        languageInput
    ].forEach((input) => {

        if (!input) return;

        input.addEventListener("input", clearMessage);
        input.addEventListener("change", clearMessage);

    });

    signupForm.querySelectorAll(
        'input[name="risk_category"]'
    ).forEach((input) => {

        input.addEventListener("change", clearMessage);

    });

    // --------------------------------------------------
    // PASSWORD CONFIRMATION FEEDBACK
    // --------------------------------------------------

    if (confirmPasswordInput && passwordInput) {

        confirmPasswordInput.addEventListener("input", () => {

            if (!confirmPasswordInput.value) {
                confirmPasswordInput.setCustomValidity("");
                return;
            }

            const matches =
                confirmPasswordInput.value === passwordInput.value;

            confirmPasswordInput.setCustomValidity(
                matches ? "" : "Passwords do not match."
            );
        });

        passwordInput.addEventListener("input", () => {

            if (!confirmPasswordInput.value) return;

            const matches =
                confirmPasswordInput.value === passwordInput.value;

            confirmPasswordInput.setCustomValidity(
                matches ? "" : "Passwords do not match."
            );
        });
    }

    // --------------------------------------------------
    // INITIALIZE
    // --------------------------------------------------

    updateCountryPreferences();

    console.info("Market Plus AI signup page initialized.");

});
