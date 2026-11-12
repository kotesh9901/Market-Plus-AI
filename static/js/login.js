/* =========================================================
   MARKET PLUS AI — LOGIN PAGE
   File: static/js/login.js
   ========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const identifierInput = document.getElementById("identifier");
    const passwordInput = document.getElementById("password");
    const togglePasswordButton = document.getElementById("togglePassword");
    const loginButton = document.getElementById("loginButton");
    const loginMessage = document.getElementById("loginMessage");

    // Stop safely if this script is loaded on a page without the login form.
    if (
        !loginForm ||
        !identifierInput ||
        !passwordInput ||
        !loginButton ||
        !loginMessage
    ) {
        return;
    }

    const originalButtonHTML = loginButton.innerHTML;

    /* -----------------------------------------------------
       DISPLAY MESSAGE
       ----------------------------------------------------- */

    function showMessage(message, type = "error") {
        loginMessage.textContent = message;
        loginMessage.hidden = false;

        loginMessage.classList.remove(
            "success",
            "error",
            "is-success",
            "is-error"
        );

        loginMessage.classList.add(type);
        loginMessage.setAttribute("role", "alert");
    }

    function clearMessage() {
        loginMessage.textContent = "";
        loginMessage.hidden = true;

        loginMessage.classList.remove(
            "success",
            "error",
            "is-success",
            "is-error"
        );
    }

    /* -----------------------------------------------------
       LOADING STATE
       ----------------------------------------------------- */

    function setLoading(isLoading) {
        loginButton.disabled = isLoading;
        identifierInput.disabled = isLoading;
        passwordInput.disabled = isLoading;

        if (togglePasswordButton) {
            togglePasswordButton.disabled = isLoading;
        }

        if (isLoading) {
            loginButton.innerHTML = `
                <span class="button-label">Signing in...</span>
                <span class="button-arrow" aria-hidden="true">⏳</span>
            `;
            loginButton.setAttribute("aria-busy", "true");
        } else {
            loginButton.innerHTML = originalButtonHTML;
            loginButton.removeAttribute("aria-busy");
        }
    }

    /* -----------------------------------------------------
       SHOW / HIDE PASSWORD
       ----------------------------------------------------- */

    if (togglePasswordButton) {
        togglePasswordButton.addEventListener("click", () => {
            const isPasswordHidden =
                passwordInput.type === "password";

            passwordInput.type = isPasswordHidden
                ? "text"
                : "password";

            togglePasswordButton.textContent = isPasswordHidden
                ? "Hide"
                : "Show";

            togglePasswordButton.setAttribute(
                "aria-label",
                isPasswordHidden ? "Hide password" : "Show password"
            );

            togglePasswordButton.setAttribute(
                "aria-pressed",
                String(isPasswordHidden)
            );

            passwordInput.focus();
        });
    }

    /* -----------------------------------------------------
       CLEAR MESSAGES WHILE EDITING
       ----------------------------------------------------- */

    identifierInput.addEventListener("input", clearMessage);
    passwordInput.addEventListener("input", clearMessage);

    /* -----------------------------------------------------
       LOGIN FORM SUBMISSION
       ----------------------------------------------------- */

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        clearMessage();

        const identifier = identifierInput.value.trim();
        const password = passwordInput.value;

        // Validate identifier.
        if (!identifier) {
            showMessage(
                "Please enter your User ID or registered email address."
            );

            identifierInput.focus();
            return;
        }

        // Validate password.
        if (!password) {
            showMessage("Please enter your password.");

            passwordInput.focus();
            return;
        }

        setLoading(true);

        try {
            /*
             * Expected API:
             * POST /api/auth/login
             *
             * Request:
             * {
             *     "identifier": "User ID or email",
             *     "password": "account password"
             * }
             *
             * The backend must accept these field names.
             */

            const response = await fetch("/api/auth/login", {
                method: "POST",

                credentials: "same-origin",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify({
                    identifier: identifier,
                    password: password
                })
            });

            // Handle responses that are not JSON.
            const contentType =
                response.headers.get("content-type") || "";

            let data = {};

            if (contentType.includes("application/json")) {
                data = await response.json();
            } else {
                const responseText = await response.text();

                if (!response.ok) {
                    throw new Error(
                        "The login service returned an unexpected response. " +
                        "Please try again."
                    );
                }

                if (responseText.trim()) {
                    throw new Error(
                        "The login server returned an unsupported response."
                    );
                }
            }

            // Handle failed authentication.
            if (!response.ok || data.success === false) {
                const message =
                    data.message ||
                    data.error ||
                    "Login failed. Check your User ID/email and password.";

                showMessage(message);
                return;
            }

            // Handle APIs that explicitly return success=false.
            if (data.success === undefined && data.error) {
                showMessage(data.error);
                return;
            }

            showMessage(
                data.message || "Login successful! Redirecting...",
                "success"
            );

            /*
             * Prefer a redirect supplied by the backend.
             * Only allow local relative paths to prevent external redirects.
             */

            const requestedRedirect =
                data.redirect_url || data.redirect || "/dashboard";

            let redirectUrl = "/dashboard";

            if (
                typeof requestedRedirect === "string" &&
                requestedRedirect.startsWith("/") &&
                !requestedRedirect.startsWith("//") &&
                !requestedRedirect.includes("\\")
            ) {
                redirectUrl = requestedRedirect;
            }

            window.setTimeout(() => {
                window.location.assign(redirectUrl);
            }, 350);

        } catch (error) {
            console.error("Market Plus AI login error:", error);

            showMessage(
                error instanceof TypeError
                    ? "Unable to connect to the server. Check that Market Plus AI is running and try again."
                    : error.message ||
                      "Something went wrong while signing in. Please try again."
            );

        } finally {
            setLoading(false);
        }
    });
});