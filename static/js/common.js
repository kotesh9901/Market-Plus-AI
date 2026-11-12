
"use strict";

/* =========================================================
   MARKET PLUS AI — COMMON APPLICATION SERVICES
   File: static/js/common.js
   Version: 5.0.0

   Features:
   - Centralized API requests
   - Support for all 47 signup language codes
   - English and Kannada translation dictionaries
   - English fallback for untranslated language packs
   - Dynamic content translation
   - Profile language synchronization
   - RTL language support
   - Currency, date and number formatting
   - Common message handling
   ========================================================= */

window.MarketPlusAI = (() => {

    /* =====================================================
       1. LANGUAGE CONFIGURATION
       ===================================================== */

    const LANGUAGE_STORAGE_KEY = "market_plus_ai_language";

    const SUPPORTED_LANGUAGES = {
        en:   { name: "English", locale: "en-IN" },
        as:   { name: "Assamese", locale: "as-IN" },
        bn:   { name: "Bengali", locale: "bn-IN" },
        brx:  { name: "Bodo", locale: "brx-IN" },
        doi:  { name: "Dogri", locale: "doi-IN" },
        gu:   { name: "Gujarati", locale: "gu-IN" },
        hi:   { name: "Hindi", locale: "hi-IN" },
        kn:   { name: "Kannada", locale: "kn-IN" },
        ks:   { name: "Kashmiri", locale: "ks-IN" },
        kok:  { name: "Konkani", locale: "kok-IN" },
        mai:  { name: "Maithili", locale: "mai-IN" },
        ml:   { name: "Malayalam", locale: "ml-IN" },
        mni:  { name: "Manipuri", locale: "mni-IN" },
        mr:   { name: "Marathi", locale: "mr-IN" },
        ne:   { name: "Nepali", locale: "ne-NP" },
        or:   { name: "Odia", locale: "or-IN" },
        pa:   { name: "Punjabi", locale: "pa-IN" },
        sa:   { name: "Sanskrit", locale: "sa-IN" },
        sat:  { name: "Santali", locale: "sat-IN" },
        sd:   { name: "Sindhi", locale: "sd-IN" },
        ta:   { name: "Tamil", locale: "ta-IN" },
        te:   { name: "Telugu", locale: "te-IN" },
        ur:   { name: "Urdu", locale: "ur-PK" },
        tcy:  { name: "Tulu", locale: "tcy-IN" },
        bho:  { name: "Bhojpuri", locale: "bho-IN" },
        raj:  { name: "Rajasthani", locale: "raj-IN" },
        hne:  { name: "Chhattisgarhi", locale: "hne-IN" },
        bgc:  { name: "Haryanvi", locale: "bgc-IN" },
        kha:  { name: "Khasi", locale: "kha-IN" },
        lus:  { name: "Mizo", locale: "lus-IN" },
        grt:  { name: "Garo", locale: "grt-IN" },
        es:   { name: "Spanish", locale: "es-ES" },
        fr:   { name: "French", locale: "fr-FR" },
        de:   { name: "German", locale: "de-DE" },
        ja:   { name: "Japanese", locale: "ja-JP" },
        ar:   { name: "Arabic", locale: "ar-SA" },
        zh:   { name: "Chinese", locale: "zh-CN" },
        ko:   { name: "Korean", locale: "ko-KR" },
        pt:   { name: "Portuguese", locale: "pt-PT" },
        ru:   { name: "Russian", locale: "ru-RU" },
        it:   { name: "Italian", locale: "it-IT" },
        nl:   { name: "Dutch", locale: "nl-NL" },
        tr:   { name: "Turkish", locale: "tr-TR" },
        id:   { name: "Indonesian", locale: "id-ID" },
        ms:   { name: "Malay", locale: "ms-MY" },
        th:   { name: "Thai", locale: "th-TH" },
        vi:   { name: "Vietnamese", locale: "vi-VN" }
    };

    const RTL_LANGUAGES = new Set([
        "ar", "ur", "sd", "ks"
    ]);

    let currentLanguage = "en";
    let translationObserver = null;
    let languageInitialized = false;

    /* =====================================================
       2. TRANSLATION DICTIONARIES
       ===================================================== */

    const translations = {

        en: {
            // General
            app_name: "Market Plus AI",
            dashboard: "Dashboard",
            home: "Home",
            profile: "Profile",
            settings: "Settings",
            logout: "Logout",
            login: "Login",
            signup: "Sign Up",
            register: "Register",
            save: "Save Changes",
            cancel: "Cancel",
            close: "Close",
            edit: "Edit",
            delete: "Delete",
            update: "Update",
            refresh: "Refresh",
            search: "Search",
            clear: "Clear",
            submit: "Submit",
            back: "Back",
            next: "Next",
            previous: "Previous",
            view_all: "View All",
            loading: "Loading...",
            unavailable: "Unavailable",
            no_data: "No data available",
            actions: "Actions",
            status: "Status",
            date: "Date",
            time: "Time",
            price: "Price",
            amount: "Amount",
            currency: "Currency",
            symbol: "Symbol",
            name: "Name",
            email: "Email",
            phone: "Phone",
            country: "Country",
            language: "Language",

            // Navigation
            nav_dashboard: "Dashboard",
            nav_explore_assets: "Explore Assets",
            nav_predictions: "AI Predictions",
            nav_prediction_history: "Prediction History",
            nav_news_sentiment: "News & Sentiment",
            nav_price_alerts: "Price Alerts",
            nav_investments: "Investments",
            nav_profile: "My Profile",
            nav_assistant: "AI Assistant",

            // Dashboard
            welcome_back: "Welcome Back",
            market_overview: "Market Overview",
            discover_opportunities: "Discover Opportunities",
            top_performers: "Top Performers",
            market_movers: "Market Movers",
            recent_activity: "Recent Activity",
            total_investments: "Total Investments",
            total_profit_loss: "Total Profit / Loss",
            active_predictions: "Active Predictions",
            active_alerts: "Active Alerts",
            tracked_assets: "Tracked Assets",
            predictions_created: "Predictions Created",
            realized_profit_loss: "Realized P/L from completed investments",
            investment_summary_unavailable: "Investment summary temporarily unavailable",

            // Stock search
            explore_assets: "Explore Assets",
            search_stocks: "Search Stocks",
            search_assets: "Search assets by name or symbol",
            recommended_stocks: "Recommended Stocks",
            stock_details: "Stock Details",
            company_name: "Company Name",
            current_price: "Current Price",
            market_cap: "Market Capitalization",
            volume: "Trading Volume",
            day_high: "Day High",
            day_low: "Day Low",
            previous_close: "Previous Close",
            price_change: "Price Change",
            percentage_change: "Percentage Change",
            historical_chart: "Historical Price Chart",

            // Predictions
            ai_predictions: "AI Predictions",
            prediction_history: "Prediction History",
            generate_prediction: "Generate Prediction",
            prediction_result: "Prediction Result",
            predicted_price: "Predicted Price",
            prediction_duration: "Prediction Duration",
            prediction_date: "Prediction Date",
            prediction_status: "Prediction Status",
            model_accuracy: "Model Accuracy",
            confidence_score: "Confidence Score",
            select_asset: "Select Asset",
            select_duration: "Select Duration",
            create_prediction: "Create a prediction",
            unknown_asset: "Unknown asset",
            recorded: "Recorded",
            day: "day",
            days: "days",

            // News
            news_sentiment: "News & Sentiment",
            latest_news: "Latest News",
            positive_sentiment: "Positive Sentiment",
            negative_sentiment: "Negative Sentiment",
            neutral_sentiment: "Neutral Sentiment",
            sentiment_analysis: "Sentiment Analysis",
            no_news: "No news available",

            // Alerts
            price_alerts: "Price Alerts",
            create_alert: "Create Price Alert",
            create_new_alert: "Create New Alert",
            asset_symbol: "Asset Symbol",
            target_price: "Target Price",
            target_price_reached: "Target Price Reached",
            alert_created: "Price alert created successfully.",
            no_alerts: "No price alerts found.",
            all_alerts: "All Alerts",
            active: "Active",
            triggered: "Triggered",
            cancelled: "Cancelled",
            notification_preferences: "Notification Preferences",

            // Investments
            investments: "Investments",
            add_investment: "Add Investment",
            investment_history: "Investment History",
            open_investments: "Open Investments",
            completed_investments: "Completed Investments",
            purchase_price: "Purchase Price",
            purchase_date: "Purchase Date",
            quantity: "Quantity",
            investment_amount: "Investment Amount",
            sell_price: "Sell Price",
            sell_date: "Sell Date",
            profit: "Profit",
            loss: "Loss",
            no_investments: "No investments found.",

            // Profile
            my_profile: "My Profile",
            personal_information: "Personal Information",
            account_information: "Account Information",
            edit_profile: "Edit Profile",
            full_name: "Full Name",
            user_id: "User ID",
            preferred_currency: "Preferred Currency",
            preferred_language: "Preferred Language",
            risk_category: "Risk Category",
            account_created: "Account Created",
            update_profile: "Update Profile",

            // Authentication
            welcome: "Welcome",
            create_account: "Create Your Account",
            already_have_account: "Already have an account?",
            dont_have_account: "Don't have an account?",
            password: "Password",
            confirm_password: "Confirm Password",
            forgot_password: "Forgot Password?",

            // Assistant
            ai_assistant: "Market Plus AI Assistant",
            ask_question: "Ask your question",
            send_message: "Send Message",

            // Dashboard dynamic messages
            recent_predictions_empty: "Your recent predictions will appear here",
            create_prediction_description: "Create a prediction to begin building your history.",
            results_for: "Results for",
            searching: "Searching...",
            matching_assets: "matching assets",
            no_matching_assets: "No matching assets",
            search_failed: "Search failed",
            enter_asset_search: "Enter a company name or asset symbol to search.",
            search_too_long: "Your search must be 120 characters or fewer.",
            asset_search_failed: "Unable to retrieve matching assets.",
            view_asset: "View asset",
            logging_out: "Logging out...",
            logout_failed: "Logout could not be completed. Please try again.",
            open_navigation: "Open navigation",
            close_navigation: "Close navigation",

            // Messages
            request_failed: "The request could not be completed.",
            something_went_wrong: "Something went wrong. Please try again.",
            save_success: "Changes saved successfully.",
            update_success: "Updated successfully.",
            delete_success: "Deleted successfully.",
            login_required: "Please log in to continue.",
            select_language: "Select Language",
            language_updated: "Language updated successfully.",

            // Disclaimer
            investment_disclaimer:
                "Predictions are estimates, not guaranteed financial advice. Always do your own research."
        },

        kn: {
            // General
            app_name: "ಮಾರ್ಕೆಟ್ ಪ್ಲಸ್ ಎಐ",
            dashboard: "ಮುಖ್ಯ ಫಲಕ",
            home: "ಮುಖಪುಟ",
            profile: "ಪ್ರೊಫೈಲ್",
            settings: "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",
            logout: "ಲಾಗ್ ಔಟ್",
            login: "ಲಾಗಿನ್",
            signup: "ಸೈನ್ ಅಪ್",
            register: "ನೋಂದಣಿ",
            save: "ಬದಲಾವಣೆಗಳನ್ನು ಉಳಿಸಿ",
            cancel: "ರದ್ದುಮಾಡಿ",
            close: "ಮುಚ್ಚಿ",
            edit: "ತಿದ್ದುಪಡಿ",
            delete: "ಅಳಿಸಿ",
            update: "ನವೀಕರಿಸಿ",
            refresh: "ಮತ್ತೆ ಲೋಡ್ ಮಾಡಿ",
            search: "ಹುಡುಕಿ",
            clear: "ಅಳಿಸಿ",
            submit: "ಸಲ್ಲಿಸಿ",
            back: "ಹಿಂದೆ",
            next: "ಮುಂದೆ",
            previous: "ಹಿಂದಿನದು",
            view_all: "ಎಲ್ಲವನ್ನೂ ನೋಡಿ",
            loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
            unavailable: "ಲಭ್ಯವಿಲ್ಲ",
            no_data: "ಯಾವುದೇ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ",
            actions: "ಕ್ರಿಯೆಗಳು",
            status: "ಸ್ಥಿತಿ",
            date: "ದಿನಾಂಕ",
            time: "ಸಮಯ",
            price: "ಬೆಲೆ",
            amount: "ಮೊತ್ತ",
            currency: "ಕರೆನ್ಸಿ",
            symbol: "ಸಂಕೇತ",
            name: "ಹೆಸರು",
            email: "ಇಮೇಲ್",
            phone: "ದೂರವಾಣಿ",
            country: "ದೇಶ",
            language: "ಭಾಷೆ",

            // Navigation
            nav_dashboard: "ಮುಖ್ಯ ಫಲಕ",
            nav_explore_assets: "ಷೇರುಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
            nav_predictions: "ಎಐ ಮುನ್ಸೂಚನೆಗಳು",
            nav_prediction_history: "ಮುನ್ಸೂಚನೆಗಳ ಇತಿಹಾಸ",
            nav_news_sentiment: "ಸುದ್ದಿ ಮತ್ತು ಭಾವನೆ ವಿಶ್ಲೇಷಣೆ",
            nav_price_alerts: "ಬೆಲೆ ಎಚ್ಚರಿಕೆಗಳು",
            nav_investments: "ಹೂಡಿಕೆಗಳು",
            nav_profile: "ನನ್ನ ಪ್ರೊಫೈಲ್",
            nav_assistant: "ಎಐ ಸಹಾಯಕ",

            // Dashboard
            welcome_back: "ಮತ್ತೆ ಸ್ವಾಗತ",
            market_overview: "ಮಾರುಕಟ್ಟೆಯ ಅವಲೋಕನ",
            discover_opportunities: "ಹೂಡಿಕೆ ಅವಕಾಶಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
            top_performers: "ಅತ್ಯುತ್ತಮ ಪ್ರದರ್ಶನ ನೀಡಿದವು",
            market_movers: "ಮಾರುಕಟ್ಟೆಯ ಪ್ರಮುಖ ಬದಲಾವಣೆಗಳು",
            recent_activity: "ಇತ್ತೀಚಿನ ಚಟುವಟಿಕೆಗಳು",
            total_investments: "ಒಟ್ಟು ಹೂಡಿಕೆಗಳು",
            total_profit_loss: "ಒಟ್ಟು ಲಾಭ / ನಷ್ಟ",
            active_predictions: "ಸಕ್ರಿಯ ಮುನ್ಸೂಚನೆಗಳು",
            active_alerts: "ಸಕ್ರಿಯ ಎಚ್ಚರಿಕೆಗಳು",
            tracked_assets: "ಟ್ರ್ಯಾಕ್ ಮಾಡಿದ ಆಸ್ತಿಗಳು",
            predictions_created: "ರಚಿಸಿದ ಮುನ್ಸೂಚನೆಗಳು",
            realized_profit_loss: "ಪೂರ್ಣಗೊಂಡ ಹೂಡಿಕೆಗಳ ನಿಜವಾದ ಲಾಭ / ನಷ್ಟ",
            investment_summary_unavailable: "ಹೂಡಿಕೆ ಸಾರಾಂಶ ತಾತ್ಕಾಲಿಕವಾಗಿ ಲಭ್ಯವಿಲ್ಲ",

            // Stock search
            explore_assets: "ಷೇರುಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
            search_stocks: "ಷೇರುಗಳನ್ನು ಹುಡುಕಿ",
            search_assets: "ಹೆಸರು ಅಥವಾ ಸಂಕೇತದ ಮೂಲಕ ಷೇರುಗಳನ್ನು ಹುಡುಕಿ",
            recommended_stocks: "ಶಿಫಾರಸು ಮಾಡಿದ ಷೇರುಗಳು",
            stock_details: "ಷೇರಿನ ವಿವರಗಳು",
            company_name: "ಕಂಪನಿಯ ಹೆಸರು",
            current_price: "ಪ್ರಸ್ತುತ ಬೆಲೆ",
            market_cap: "ಮಾರುಕಟ್ಟೆ ಬಂಡವಾಳ",
            volume: "ವಹಿವಾಟಿನ ಪ್ರಮಾಣ",
            day_high: "ದಿನದ ಗರಿಷ್ಠ ಬೆಲೆ",
            day_low: "ದಿನದ ಕನಿಷ್ಠ ಬೆಲೆ",
            previous_close: "ಹಿಂದಿನ ಮುಕ್ತಾಯದ ಬೆಲೆ",
            price_change: "ಬೆಲೆ ಬದಲಾವಣೆ",
            percentage_change: "ಶೇಕಡಾವಾರು ಬದಲಾವಣೆ",
            historical_chart: "ಹಿಂದಿನ ಬೆಲೆಗಳ ಚಾರ್ಟ್",

            // Predictions
            ai_predictions: "ಎಐ ಮುನ್ಸೂಚನೆಗಳು",
            prediction_history: "ಮುನ್ಸೂಚನೆಗಳ ಇತಿಹಾಸ",
            generate_prediction: "ಮುನ್ಸೂಚನೆ ರಚಿಸಿ",
            prediction_result: "ಮುನ್ಸೂಚನೆಯ ಫಲಿತಾಂಶ",
            predicted_price: "ಅಂದಾಜು ಬೆಲೆ",
            prediction_duration: "ಮುನ್ಸೂಚನೆಯ ಅವಧಿ",
            prediction_date: "ಮುನ್ಸೂಚನೆಯ ದಿನಾಂಕ",
            prediction_status: "ಮುನ್ಸೂಚನೆಯ ಸ್ಥಿತಿ",
            model_accuracy: "ಮಾದರಿಯ ನಿಖರತೆ",
            confidence_score: "ವಿಶ್ವಾಸಾರ್ಹತೆಯ ಅಂಕ",
            select_asset: "ಷೇರನ್ನು ಆಯ್ಕೆಮಾಡಿ",
            select_duration: "ಅವಧಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
            create_prediction: "ಮುನ್ಸೂಚನೆ ರಚಿಸಿ",
            unknown_asset: "ಅಜ್ಞಾತ ಆಸ್ತಿ",
            recorded: "ದಾಖಲಿಸಲಾಗಿದೆ",
            day: "ದಿನ",
            days: "ದಿನಗಳು",

            // News
            news_sentiment: "ಸುದ್ದಿ ಮತ್ತು ಭಾವನೆ ವಿಶ್ಲೇಷಣೆ",
            latest_news: "ಇತ್ತೀಚಿನ ಸುದ್ದಿ",
            positive_sentiment: "ಸಕಾರಾತ್ಮಕ ಭಾವನೆ",
            negative_sentiment: "ನಕಾರಾತ್ಮಕ ಭಾವನೆ",
            neutral_sentiment: "ತಟಸ್ಥ ಭಾವನೆ",
            sentiment_analysis: "ಭಾವನೆ ವಿಶ್ಲೇಷಣೆ",
            no_news: "ಯಾವುದೇ ಸುದ್ದಿ ಲಭ್ಯವಿಲ್ಲ",

            // Alerts
            price_alerts: "ಬೆಲೆ ಎಚ್ಚರಿಕೆಗಳು",
            create_alert: "ಬೆಲೆ ಎಚ್ಚರಿಕೆ ರಚಿಸಿ",
            create_new_alert: "ಹೊಸ ಎಚ್ಚರಿಕೆ ರಚಿಸಿ",
            asset_symbol: "ಷೇರಿನ ಸಂಕೇತ",
            target_price: "ಗುರಿ ಬೆಲೆ",
            target_price_reached: "ಗುರಿ ಬೆಲೆ ತಲುಪಿದೆ",
            alert_created: "ಬೆಲೆ ಎಚ್ಚರಿಕೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ರಚಿಸಲಾಗಿದೆ.",
            no_alerts: "ಯಾವುದೇ ಬೆಲೆ ಎಚ್ಚರಿಕೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",
            all_alerts: "ಎಲ್ಲಾ ಎಚ್ಚರಿಕೆಗಳು",
            active: "ಸಕ್ರಿಯ",
            triggered: "ಪ್ರಚೋದಿತ",
            cancelled: "ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ",
            notification_preferences: "ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳು",

            // Investments
            investments: "ಹೂಡಿಕೆಗಳು",
            add_investment: "ಹೂಡಿಕೆ ಸೇರಿಸಿ",
            investment_history: "ಹೂಡಿಕೆಗಳ ಇತಿಹಾಸ",
            open_investments: "ಪ್ರಸ್ತುತ ಹೂಡಿಕೆಗಳು",
            completed_investments: "ಪೂರ್ಣಗೊಂಡ ಹೂಡಿಕೆಗಳು",
            purchase_price: "ಖರೀದಿ ಬೆಲೆ",
            purchase_date: "ಖರೀದಿ ದಿನಾಂಕ",
            quantity: "ಪ್ರಮಾಣ",
            investment_amount: "ಹೂಡಿಕೆ ಮೊತ್ತ",
            sell_price: "ಮಾರಾಟದ ಬೆಲೆ",
            sell_date: "ಮಾರಾಟದ ದಿನಾಂಕ",
            profit: "ಲಾಭ",
            loss: "ನಷ್ಟ",
            no_investments: "ಯಾವುದೇ ಹೂಡಿಕೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",

            // Profile
            my_profile: "ನನ್ನ ಪ್ರೊಫೈಲ್",
            personal_information: "ವೈಯಕ್ತಿಕ ಮಾಹಿತಿ",
            account_information: "ಖಾತೆಯ ಮಾಹಿತಿ",
            edit_profile: "ಪ್ರೊಫೈಲ್ ತಿದ್ದುಪಡಿ",
            full_name: "ಪೂರ್ಣ ಹೆಸರು",
            user_id: "ಬಳಕೆದಾರರ ಐಡಿ",
            preferred_currency: "ಆದ್ಯತೆಯ ಕರೆನ್ಸಿ",
            preferred_language: "ಆದ್ಯತೆಯ ಭಾಷೆ",
            risk_category: "ಅಪಾಯದ ವರ್ಗ",
            account_created: "ಖಾತೆ ರಚಿಸಿದ ದಿನಾಂಕ",
            update_profile: "ಪ್ರೊಫೈಲ್ ನವೀಕರಿಸಿ",

            // Authentication
            welcome: "ಸ್ವಾಗತ",
            create_account: "ನಿಮ್ಮ ಖಾತೆಯನ್ನು ರಚಿಸಿ",
            already_have_account: "ಈಗಾಗಲೇ ಖಾತೆ ಇದೆಯೇ?",
            dont_have_account: "ಖಾತೆ ಇಲ್ಲವೇ?",
            password: "ಪಾಸ್‌ವರ್ಡ್",
            confirm_password: "ಪಾಸ್‌ವರ್ಡ್ ದೃಢೀಕರಿಸಿ",
            forgot_password: "ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರುವಿರಾ?",

            // Assistant
            ai_assistant: "ಮಾರ್ಕೆಟ್ ಪ್ಲಸ್ ಎಐ ಸಹಾಯಕ",
            ask_question: "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕೇಳಿ",
            send_message: "ಸಂದೇಶ ಕಳುಹಿಸಿ",

            // Dashboard dynamic messages
            recent_predictions_empty: "ನಿಮ್ಮ ಇತ್ತೀಚಿನ ಮುನ್ಸೂಚನೆಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ",
            create_prediction_description: "ನಿಮ್ಮ ಇತಿಹಾಸವನ್ನು ಪ್ರಾರಂಭಿಸಲು ಮುನ್ಸೂಚನೆಯನ್ನು ರಚಿಸಿ.",
            results_for: "ಇದಕ್ಕಾಗಿ ಫಲಿತಾಂಶಗಳು",
            searching: "ಹುಡುಕಲಾಗುತ್ತಿದೆ...",
            matching_assets: "ಹೊಂದಾಣಿಕೆಯ ಆಸ್ತಿಗಳು",
            no_matching_assets: "ಹೊಂದಾಣಿಕೆಯ ಆಸ್ತಿಗಳು ಕಂಡುಬಂದಿಲ್ಲ",
            search_failed: "ಹುಡುಕಾಟ ವಿಫಲವಾಗಿದೆ",
            enter_asset_search: "ಹುಡುಕಲು ಕಂಪನಿಯ ಹೆಸರು ಅಥವಾ ಆಸ್ತಿ ಸಂಕೇತವನ್ನು ನಮೂದಿಸಿ.",
            search_too_long: "ನಿಮ್ಮ ಹುಡುಕಾಟವು 120 ಅಕ್ಷರಗಳು ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ಇರಬೇಕು.",
            asset_search_failed: "ಹೊಂದಾಣಿಕೆಯ ಆಸ್ತಿಗಳನ್ನು ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
            view_asset: "ಆಸ್ತಿಯನ್ನು ವೀಕ್ಷಿಸಿ",
            logging_out: "ಲಾಗ್ ಔಟ್ ಆಗುತ್ತಿದೆ...",
            logout_failed: "ಲಾಗ್ ಔಟ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
            open_navigation: "ನ್ಯಾವಿಗೇಶನ್ ತೆರೆಯಿರಿ",
            close_navigation: "ನ್ಯಾವಿಗೇಶನ್ ಮುಚ್ಚಿ",

            // Messages
            request_failed: "ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
            something_went_wrong: "ಏನೋ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
            save_success: "ಬದಲಾವಣೆಗಳನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಉಳಿಸಲಾಗಿದೆ.",
            update_success: "ಯಶಸ್ವಿಯಾಗಿ ನವೀಕರಿಸಲಾಗಿದೆ.",
            delete_success: "ಯಶಸ್ವಿಯಾಗಿ ಅಳಿಸಲಾಗಿದೆ.",
            login_required: "ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು ಲಾಗಿನ್ ಮಾಡಿ.",
            select_language: "ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
            language_updated: "ಭಾಷೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ನವೀಕರಿಸಲಾಗಿದೆ.",

            // Disclaimer
            investment_disclaimer:
                "ಮುನ್ಸೂಚನೆಗಳು ಅಂದಾಜುಗಳು ಮಾತ್ರ. ಅವು ಖಚಿತವಾದ ಹಣಕಾಸು ಸಲಹೆಯಲ್ಲ. ಹೂಡಿಕೆ ಮಾಡುವ ಮೊದಲು ಸ್ವತಃ ಪರಿಶೀಲಿಸಿ."
        }
    };

    /* =====================================================
       3. LANGUAGE HELPERS
       ===================================================== */

    function normalizeLanguage(language) {

        if (!language) return "en";

        const normalized = String(language)
            .trim()
            .toLowerCase()
            .replace(/_/g, "-");

        if (SUPPORTED_LANGUAGES[normalized]) {
            return normalized;
        }

        const baseLanguage = normalized.split("-")[0];

        if (SUPPORTED_LANGUAGES[baseLanguage]) {
            return baseLanguage;
        }

        const matchingEntry = Object.entries(SUPPORTED_LANGUAGES)
            .find(([, details]) =>
                details.name.toLowerCase() === normalized
            );

        return matchingEntry ? matchingEntry[0] : "en";
    }

    function getLocale() {
        return SUPPORTED_LANGUAGES[currentLanguage]?.locale ||
            SUPPORTED_LANGUAGES.en.locale;
    }

    function translate(key, fallback = "") {

        const languageDictionary =
            translations[currentLanguage] || {};

        return (
            languageDictionary[key] ??
            translations.en[key] ??
            fallback ??
            key
        );
    }

    /* =====================================================
       4. DOM TRANSLATION
       ===================================================== */

    function translateElement(element) {

        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        if (element.hasAttribute("data-i18n")) {
            const key = element.getAttribute("data-i18n");

            if (key) {
                element.textContent = translate(key);
            }
        }

        if (element.hasAttribute("data-i18n-placeholder")) {
            const key = element.getAttribute("data-i18n-placeholder");

            element.setAttribute(
                "placeholder",
                translate(key)
            );
        }

        if (element.hasAttribute("data-i18n-title")) {
            const key = element.getAttribute("data-i18n-title");

            element.setAttribute(
                "title",
                translate(key)
            );
        }

        if (element.hasAttribute("data-i18n-aria-label")) {
            const key = element.getAttribute("data-i18n-aria-label");

            element.setAttribute(
                "aria-label",
                translate(key)
            );
        }

        if (element.hasAttribute("data-i18n-value")) {
            const key = element.getAttribute("data-i18n-value");

            if (
                element instanceof HTMLInputElement &&
                ["button", "submit", "reset"].includes(element.type)
            ) {
                element.value = translate(key);
            }
        }

        if (
            element instanceof HTMLOptionElement &&
            element.hasAttribute("data-i18n")
        ) {
            element.textContent = translate(
                element.getAttribute("data-i18n")
            );
        }
    }

    function applyTranslations(root = document) {

        if (!root) return;

        if (root.nodeType === Node.ELEMENT_NODE) {
            translateElement(root);
        }

        if (typeof root.querySelectorAll !== "function") {
            return;
        }

        const selector = [
            "[data-i18n]",
            "[data-i18n-placeholder]",
            "[data-i18n-title]",
            "[data-i18n-aria-label]",
            "[data-i18n-value]"
        ].join(",");

        root.querySelectorAll(selector).forEach(translateElement);
    }

    /* =====================================================
       5. DYNAMIC CONTENT TRANSLATION
       ===================================================== */

    function observeDynamicContent() {

        if (!document.body || translationObserver) return;

        translationObserver = new MutationObserver(mutations => {

            mutations.forEach(mutation => {

                mutation.addedNodes.forEach(node => {

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        applyTranslations(node);
                    }
                });

                if (mutation.type === "attributes") {
                    translateElement(mutation.target);
                }
            });
        });

        translationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "data-i18n",
                "data-i18n-placeholder",
                "data-i18n-title",
                "data-i18n-aria-label",
                "data-i18n-value"
            ]
        });
    }

    /* =====================================================
       6. LANGUAGE PERSISTENCE
       ===================================================== */

    function saveLanguageLocally(language) {

        try {
            localStorage.setItem(
                LANGUAGE_STORAGE_KEY,
                language
            );
        } catch (error) {
            console.warn(
                "Unable to save language preference locally.",
                error
            );
        }
    }

    function getSavedLanguage() {

        try {
            return normalizeLanguage(
                localStorage.getItem(LANGUAGE_STORAGE_KEY)
            );
        } catch (error) {
            return "en";
        }
    }

    function setLanguage(language, options = {}) {

        const normalizedLanguage = normalizeLanguage(language);

        currentLanguage = normalizedLanguage;

        if (options.persist !== false) {
            saveLanguageLocally(normalizedLanguage);
        }

        document.documentElement.lang = normalizedLanguage;

        document.documentElement.dir =
            RTL_LANGUAGES.has(normalizedLanguage) ? "rtl" : "ltr";

        document.documentElement.setAttribute(
            "data-language",
            normalizedLanguage
        );

        applyTranslations();

        window.dispatchEvent(
            new CustomEvent("marketplus:languagechange", {
                detail: {
                    language: normalizedLanguage,
                    locale: getLocale(),
                    direction: RTL_LANGUAGES.has(normalizedLanguage)
                        ? "rtl"
                        : "ltr"
                }
            })
        );

        return normalizedLanguage;
    }

    /* =====================================================
       7. LOAD LANGUAGE FROM USER PROFILE
       ===================================================== */

    function extractProfileLanguage(response) {

        if (!response || typeof response !== "object") {
            return null;
        }

        const possibleObjects = [
            response,
            response.data,
            response.user,
            response.profile,
            response.data?.user,
            response.data?.profile
        ].filter(Boolean);

        for (const item of possibleObjects) {

            const language =
                item.language ||
                item.preferred_language ||
                item.preferredLanguage;

            if (language) return language;
        }

        return null;
    }

    async function loadSavedLanguage() {

        // Apply local preference immediately.
        setLanguage(getSavedLanguage(), {
            persist: false
        });

        try {

            // Correct backend endpoint:
            // GET /api/auth/me
            const response = await api("/api/auth/me", {
                method: "GET"
            });

            const profileLanguage =
                extractProfileLanguage(response);

            if (profileLanguage) {
                setLanguage(profileLanguage);
                return currentLanguage;
            }

        } catch (error) {

            // A logged-out visitor may not have a profile.
            // Keep the local language preference.
        }

        return currentLanguage;
    }

    /* =====================================================
       8. LANGUAGE SELECTOR SUPPORT
       ===================================================== */

    function initializeLanguageSelectors() {

        const selectors = [
            "#language",
            "#preferredLanguage",
            "#profileLanguage",
            "[data-language-selector]"
        ].join(",");

        document.querySelectorAll(selectors).forEach(selector => {

            if (selector.dataset.languageHandler === "true") {
                return;
            }

            selector.dataset.languageHandler = "true";

            selector.addEventListener("change", () => {

                if (selector.value) {
                    setLanguage(selector.value);
                }
            });
        });
    }

    /* =====================================================
       9. CURRENCY FORMATTING
       ===================================================== */

    function formatPrice(value, currency = "INR") {

        const number = Number(value);

        if (!Number.isFinite(number)) {
            return translate("unavailable");
        }

        const currencyCode = String(currency || "INR")
            .trim()
            .toUpperCase();

        try {
            return new Intl.NumberFormat(getLocale(), {
                style: "currency",
                currency: currencyCode,
                maximumFractionDigits: 2
            }).format(number);

        } catch (error) {
            return `${currencyCode} ${number.toFixed(2)}`;
        }
    }

    /* =====================================================
       10. DATE FORMATTING
       ===================================================== */

    function formatDate(value, options = {}) {

        if (!value) {
            return translate("unavailable");
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        try {
            return new Intl.DateTimeFormat(
                getLocale(),
                {
                    dateStyle: "medium",
                    ...options
                }
            ).format(date);

        } catch (error) {
            return date.toLocaleDateString();
        }
    }

    function formatDateTime(value) {

        if (!value) return translate("unavailable");

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        try {
            return new Intl.DateTimeFormat(getLocale(), {
                dateStyle: "medium",
                timeStyle: "short"
            }).format(date);

        } catch (error) {
            return date.toLocaleString();
        }
    }

    /* =====================================================
       11. NUMBER FORMATTING
       ===================================================== */

    function formatNumber(value, options = {}) {

        const number = Number(value);

        if (!Number.isFinite(number)) {
            return translate("unavailable");
        }

        try {
            return new Intl.NumberFormat(
                getLocale(),
                options
            ).format(number);

        } catch (error) {
            return String(number);
        }
    }

    /* =====================================================
       12. API REQUEST HANDLER
       ===================================================== */

    async function api(url, options = {}) {

        const headers = {
            Accept: "application/json",
            ...(options.headers || {})
        };

        if (
            options.body &&
            typeof options.body === "string"
        ) {
            headers["Content-Type"] =
                headers["Content-Type"] || "application/json";
        }

        const response = await fetch(url, {
            ...options,
            headers,
            credentials: "same-origin"
        });

        const contentType =
            response.headers.get("content-type") || "";

        let result;

        if (contentType.includes("application/json")) {
            result = await response.json();
        } else {
            result = {
                success: response.ok,
                message: await response.text()
            };
        }

        if (!response.ok) {
            throw new Error(
                result.message || translate("request_failed")
            );
        }

        return result;
    }

    /* =====================================================
       13. COMMON MESSAGE HANDLER
       ===================================================== */

    function showMessage(element, message, type = "info") {

        if (!element) return;

        element.textContent = message;
        element.dataset.type = type;
        element.hidden = false;
    }

    function hideMessage(element) {

        if (!element) return;

        element.textContent = "";
        element.hidden = true;
    }

    /* =====================================================
       14. INITIALIZE LANGUAGE SYSTEM
       ===================================================== */

    function initializeLanguage() {

        if (languageInitialized) return;

        languageInitialized = true;

        setLanguage(getSavedLanguage(), {
            persist: false
        });

        if (document.readyState === "loading") {

            document.addEventListener("DOMContentLoaded", () => {
                applyTranslations();
                initializeLanguageSelectors();
                observeDynamicContent();
                loadSavedLanguage();
            }, { once: true });

        } else {

            applyTranslations();
            initializeLanguageSelectors();
            observeDynamicContent();
            loadSavedLanguage();
        }
    }

    /* =====================================================
       15. PUBLIC API
       ===================================================== */

    initializeLanguage();

    return {

        // API
        api,

        // Formatting
        formatPrice,
        formatDate,
        formatDateTime,
        formatNumber,

        // Messages
        showMessage,
        hideMessage,

        // Translation
        translate,
        t: translate,
        applyTranslations,

        // Language
        setLanguage,
        getLanguage: () => currentLanguage,
        getLocale,
        getLanguageName: language =>
            SUPPORTED_LANGUAGES[normalizeLanguage(language)]?.name || "English",

        getSupportedLanguages: () => ({
            ...SUPPORTED_LANGUAGES
        }),

        isRTL: () => RTL_LANGUAGES.has(currentLanguage),

        // Profile synchronization
        loadSavedLanguage
    };

})();
