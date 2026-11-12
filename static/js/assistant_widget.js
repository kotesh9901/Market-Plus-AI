
/* ============================================================
   MARKET PLUS AI - FLOATING AI ASSISTANT
   File: static/js/assistant_widget.js

   Features:
   - Floating robot assistant
   - Local Ollama integration through Flask
   - SQLite conversation history
   - Current application page awareness
   - Stock Details context
   - Safe Markdown rendering
   - Bold, italic, headings and lists
   - Quick prompts
   - Clear history
   - Typing indicator
   - Responsive interaction
============================================================ */

(() => {
    "use strict";

    /* ========================================================
       CONFIGURATION
    ======================================================== */

    const CONFIG = {
        apiBase: "/api/assistant",

        endpoints: {
            chat: "/chat",
            history: "/history",
            status: "/status"
        },

        historyLimit: 50,
        maximumQuestionLength: 2000
    };

    /* ========================================================
       INITIALIZATION
    ======================================================== */

    function initializeAssistant() {
        const root = document.getElementById(
            "mpaiAssistant"
        );

        if (!root || root.dataset.initialized === "true") {
            return;
        }

        const elements = {
            launcher: document.getElementById(
                "mpaiAssistantLauncher"
            ),

            panel: document.getElementById(
                "mpaiAssistantPanel"
            ),

            closeButton: document.getElementById(
                "mpaiAssistantCloseButton"
            ),

            clearButton: document.getElementById(
                "mpaiAssistantClearButton"
            ),

            form: document.getElementById(
                "mpaiAssistantForm"
            ),

            input: document.getElementById(
                "mpaiAssistantInput"
            ),

            sendButton: document.getElementById(
                "mpaiAssistantSendButton"
            ),

            messages: document.getElementById(
                "mpaiAssistantMessages"
            ),

            status: document.getElementById(
                "mpaiAssistantStatus"
            ),

            onlineDot: document.getElementById(
                "mpaiAssistantOnlineDot"
            ),

            launcherStatus: document.getElementById(
                "mpaiAssistantLauncherStatus"
            ),

            quickPrompts: document.getElementById(
                "mpaiAssistantQuickPrompts"
            ),

            error: document.getElementById(
                "mpaiAssistantError"
            )
        };

        const requiredElements = [
            elements.launcher,
            elements.panel,
            elements.closeButton,
            elements.clearButton,
            elements.form,
            elements.input,
            elements.sendButton,
            elements.messages
        ];

        if (requiredElements.some(item => !item)) {
            console.error(
                "Market Plus AI: Required assistant HTML elements are missing."
            );
            return;
        }

        root.dataset.initialized = "true";

        /* ====================================================
           STATE
        ==================================================== */

        const state = {
            isOpen: false,
            isSending: false,
            historyLoaded: false,
            historyLoading: false,
            statusLoaded: false,
            typingElement: null,
            historyPromise: null
        };

        /* ====================================================
           API REQUEST HANDLER
        ==================================================== */

        async function apiRequest(endpoint, options = {}) {
            const requestOptions = {
                method: options.method || "GET",
                credentials: "same-origin",
                cache: "no-store",

                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    ...(options.headers || {})
                }
            };

            if (options.body !== undefined) {
                requestOptions.body = JSON.stringify(
                    options.body
                );
            }

            let response;

            try {
                response = await fetch(
                    CONFIG.apiBase + endpoint,
                    requestOptions
                );
            } catch (error) {
                throw new Error(
                    "Cannot connect to Market Plus AI. Check whether Flask is running."
                );
            }

            let payload;

            try {
                payload = await response.json();
            } catch (error) {
                throw new Error(
                    "The server returned an invalid response."
                );
            }

            if (
                !response.ok ||
                payload.success === false
            ) {
                throw new Error(
                    payload.message ||
                    `Server request failed (${response.status}).`
                );
            }

            return payload.data !== undefined
                ? payload.data
                : payload;
        }

        /* ====================================================
           SAFE ELEMENT VALUE READING
        ==================================================== */

        function readElement(selector) {
            const element = document.querySelector(
                selector
            );

            if (!element) {
                return "";
            }

            let value = "";

            if (
                element instanceof HTMLInputElement ||
                element instanceof HTMLSelectElement ||
                element instanceof HTMLTextAreaElement
            ) {
                value = element.value;
            } else {
                value =
                    element.dataset.assistantValue ||
                    element.dataset.value ||
                    element.dataset.symbol ||
                    element.textContent ||
                    "";
            }

            value = String(value).trim();

            if (!value) {
                return "";
            }

            const unavailableValues = [
                "—",
                "-",
                "--",
                "loading",
                "loading...",
                "unavailable",
                "not available",
                "daily change unavailable",
                "market status unavailable"
            ];

            if (
                unavailableValues.includes(
                    value.toLowerCase()
                )
            ) {
                return "";
            }

            return value.slice(0, 300);
        }

        function readFirstAvailable(selectors) {
            for (const selector of selectors) {
                const value = readElement(selector);

                if (value) {
                    return value;
                }
            }

            return "";
        }

        function addContextValue(context, key, selectors) {
            const value = readFirstAvailable(
                selectors
            );

            if (value) {
                context[key] = value;
            }
        }

        /* ====================================================
           PAGE CONTEXT
        ==================================================== */

        function buildPageContext() {
            const context = {
                page: window.location.pathname,
                page_title: document.title
            };
            // Automatically identify the stock from /stock/TCS.NS,
            // even when the stock details HTML has no matching symbol element.
            const stockRoute = window.location.pathname.match(
               /^\/stock\/(.+)$/i
            );

if (stockRoute) {
    try {
        context.symbol = decodeURIComponent(
            stockRoute[1]
        ).toUpperCase();
    } catch (error) {
        console.warn(
            "Unable to read stock symbol from page URL."
        );
    }
}

            /* STOCK DETAILS */

            addContextValue(
                context,
                "symbol",
                [
                    "#assetSymbol",
                    "#stockSymbol",
                    "#predictionSymbol",
                    "#whatIfSymbol",
                    "#whatifSymbol",
                    "#scenarioSymbol",
                    "[data-assistant-symbol]",
                    "[data-symbol]"
                ]
            );

            addContextValue(
                context,
                "company_name",
                [
                    "#assetName",
                    "#companyName",
                    "#stockCompanyName",
                    "[data-company-name]"
                ]
            );

            addContextValue(
                context,
                "current_price",
                [
                    "#assetCurrentPrice",
                    "#currentPrice",
                    "#stockCurrentPrice",
                    "#currentPriceValue",
                    "[data-current-price]"
                ]
            );

            addContextValue(
                context,
                "price_change",
                [
                    "#assetPriceChange",
                    "#stockPriceChange",
                    "#dailyPriceChange"
                ]
            );

            addContextValue(
                context,
                "exchange",
                [
                    "#assetExchange",
                    "#stockExchange"
                ]
            );

            addContextValue(
                context,
                "asset_category",
                [
                    "#assetCategory",
                    "#stockCategory"
                ]
            );

            /* MARKET STATISTICS */

            addContextValue(
                context,
                "previous_close",
                ["#assetPreviousClose"]
            );

            addContextValue(
                context,
                "open_price",
                ["#assetOpenPrice"]
            );

            addContextValue(
                context,
                "day_high",
                ["#assetDayHigh"]
            );

            addContextValue(
                context,
                "day_low",
                ["#assetDayLow"]
            );

            addContextValue(
                context,
                "volume",
                ["#assetVolume"]
            );

            addContextValue(
                context,
                "market_cap",
                ["#assetMarketCap"]
            );

            addContextValue(
                context,
                "fifty_two_week_high",
                ["#asset52WeekHigh"]
            );

            addContextValue(
                context,
                "fifty_two_week_low",
                ["#asset52WeekLow"]
            );

            /* CHART INFORMATION */

            addContextValue(
                context,
                "chart_period",
                ["#chartPeriodSelect"]
            );

            addContextValue(
                context,
                "chart_data_count",
                ["#chartDataCount"]
            );

            addContextValue(
                context,
                "chart_latest_close",
                ["#chartLatestClose"]
            );

            /* PREDICTION INFORMATION */

            addContextValue(
                context,
                "predicted_price",
                [
                    "[data-predicted-price]",
                    "#predictedPrice",
                    "#predictionPrice"
                ]
            );

            addContextValue(
                context,
                "horizon_days",
                [
                    "[data-horizon-days]",
                    "#predictionDuration",
                    "#whatIfHorizon",
                    "#scenarioHorizon"
                ]
            );

            addContextValue(
                context,
                "risk_category",
                [
                    "#predictionRiskProfile",
                    "#riskProfile",
                    "#riskCategory"
                ]
            );

            /* INVESTMENT AND WHAT-IF */

            addContextValue(
                context,
                "investment_amount",
                [
                    "[data-investment-amount]",
                    "#investmentAmount"
                ]
            );

            addContextValue(
                context,
                "entry_price",
                [
                    "[data-entry-price]",
                    "#entryPrice"
                ]
            );

            addContextValue(
                context,
                "scenario_name",
                [
                    "[data-scenario-name]",
                    "#scenarioName"
                ]
            );

            /* ALERTS */

            addContextValue(
                context,
                "target_price",
                [
                    "#alertTargetPrice",
                    "[data-target-price]"
                ]
            );

            addContextValue(
                context,
                "alert_status",
                [
                    "#alertStatus",
                    "[data-alert-status]"
                ]
            );

            /* PAGE SELECTION */

            addContextValue(
                context,
                "selected_tab",
                [
                    "[role='tab'][aria-selected='true']",
                    ".tab-button.active",
                    ".nav-tab.active"
                ]
            );

            addContextValue(
                context,
                "currency",
                [
                    "[data-currency]",
                    "#currency"
                ]
            );

            /*
             * Provide a consolidated market-data field
             * supported by the assistant context service.
             */

            const priceDetails = [];

            const priceFields = [
                ["Current price", context.current_price],
                ["Daily change", context.price_change],
                ["Previous close", context.previous_close],
                ["Open", context.open_price],
                ["Day high", context.day_high],
                ["Day low", context.day_low],
                ["Volume", context.volume],
                ["Market cap", context.market_cap],
                ["52-week high", context.fifty_two_week_high],
                ["52-week low", context.fifty_two_week_low]
            ];

            priceFields.forEach(([label, value]) => {
                if (value) {
                    priceDetails.push(
                        `${label}: ${value}`
                    );
                }
            });

            if (priceDetails.length > 0) {
                context.prices = priceDetails.join("; ");
            }

            return context;
        }

        /* ====================================================
           SAFE MARKDOWN INLINE RENDERER

           Supported:
           **bold**
           __bold__
           *italic*
           _italic_
           `inline code`

           Text is always inserted through text nodes.
           Model-generated HTML is never executed.
        ==================================================== */

        function renderInlineMarkdown(container, text) {
            const source = String(text || "");

            const tokenPattern =
                /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+?\*|_[^_\n]+?_)/g;

            let lastIndex = 0;
            let match;

            while (
                (match = tokenPattern.exec(source)) !== null
            ) {
                const plainText = source.slice(
                    lastIndex,
                    match.index
                );

                if (plainText) {
                    container.appendChild(
                        document.createTextNode(plainText)
                    );
                }

                const token = match[0];
                let element = null;
                let innerText = "";

                if (
                    token.startsWith("**") &&
                    token.endsWith("**")
                ) {
                    element = document.createElement("strong");

                    innerText = token.slice(2, -2);

                } else if (
                    token.startsWith("__") &&
                    token.endsWith("__")
                ) {
                    element = document.createElement("strong");

                    innerText = token.slice(2, -2);

                } else if (
                    token.startsWith("`") &&
                    token.endsWith("`")
                ) {
                    element = document.createElement("code");

                    innerText = token.slice(1, -1);

                } else if (
                    token.startsWith("*") &&
                    token.endsWith("*")
                ) {
                    element = document.createElement("em");

                    innerText = token.slice(1, -1);

                } else if (
                    token.startsWith("_") &&
                    token.endsWith("_")
                ) {
                    element = document.createElement("em");

                    innerText = token.slice(1, -1);
                }

                if (element) {
                    element.textContent = innerText;
                    container.appendChild(element);
                } else {
                    container.appendChild(
                        document.createTextNode(token)
                    );
                }

                lastIndex =
                    match.index + token.length;
            }

            const remainingText = source.slice(lastIndex);

            if (remainingText) {
                container.appendChild(
                    document.createTextNode(remainingText)
                );
            }
        }

        /* ====================================================
           MARKDOWN BLOCK RENDERER

           Supported blocks:
           - Paragraphs
           - Headings (# through ####)
           - Bullet lists (-, * or +)
           - Numbered lists (1. or 1))
           - Blockquotes
           - Fenced code blocks
        ==================================================== */

        function renderMarkdown(container, content) {
            const source = String(content || "")
                .replace(/\r\n?/g, "\n");

            const lines = source.split("\n");

            let index = 0;

            function appendParagraph(linesToRender) {
                if (!linesToRender.length) {
                    return;
                }

                const paragraph =
                    document.createElement("p");

                paragraph.className =
                    "mpai-markdown-paragraph";

                linesToRender.forEach((line, lineIndex) => {
                    if (lineIndex > 0) {
                        paragraph.appendChild(
                            document.createElement("br")
                        );
                    }

                    renderInlineMarkdown(
                        paragraph,
                        line
                    );
                });

                container.appendChild(paragraph);
            }

            function appendHeading(level, text) {
                const heading =
                    document.createElement(
                        level <= 2 ? "h3" : "h4"
                    );

                heading.className =
                    "mpai-markdown-heading";

                renderInlineMarkdown(
                    heading,
                    text
                );

                container.appendChild(heading);
            }

            function appendList(items, ordered) {
                const list = document.createElement(
                    ordered ? "ol" : "ul"
                );

                list.className =
                    "mpai-markdown-list";

                items.forEach(itemText => {
                    const listItem =
                        document.createElement("li");

                    renderInlineMarkdown(
                        listItem,
                        itemText
                    );

                    list.appendChild(listItem);
                });

                container.appendChild(list);
            }

            function appendBlockquote(quoteLines) {
                const quote =
                    document.createElement("blockquote");

                quote.className =
                    "mpai-markdown-quote";

                quoteLines.forEach((line, lineIndex) => {
                    if (lineIndex > 0) {
                        quote.appendChild(
                            document.createElement("br")
                        );
                    }

                    renderInlineMarkdown(
                        quote,
                        line
                    );
                });

                container.appendChild(quote);
            }

            function appendCodeBlock(codeLines) {
                const pre =
                    document.createElement("pre");

                pre.className =
                    "mpai-markdown-code-block";

                const code =
                    document.createElement("code");

                code.textContent = codeLines.join("\n");

                pre.appendChild(code);
                container.appendChild(pre);
            }

            function isBullet(line) {
                return /^\s*[-*+]\s+/.test(line);
            }

            function isNumbered(line) {
                return /^\s*\d+[.)]\s+/.test(line);
            }

            function isBlockquote(line) {
                return /^\s*>\s?/.test(line);
            }

            function isHeading(line) {
                return /^\s{0,3}#{1,6}\s+/.test(line);
            }

            function isCodeFence(line) {
                return /^\s*```/.test(line);
            }

            function isHorizontalRule(line) {
                return /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line);
            }

            function getListText(line, ordered) {
                if (ordered) {
                    return line
                        .replace(/^\s*\d+[.)]\s+/, "")
                        .trim();
                }

                return line
                    .replace(/^\s*[-*+]\s+/, "")
                    .trim();
            }

            while (index < lines.length) {
                const currentLine = lines[index];

                if (!currentLine.trim()) {
                    index += 1;
                    continue;
                }

                /* FENCED CODE BLOCK */

                if (isCodeFence(currentLine)) {
                    index += 1;

                    const codeLines = [];

                    while (
                        index < lines.length &&
                        !isCodeFence(lines[index])
                    ) {
                        codeLines.push(lines[index]);
                        index += 1;
                    }

                    if (
                        index < lines.length &&
                        isCodeFence(lines[index])
                    ) {
                        index += 1;
                    }

                    appendCodeBlock(codeLines);
                    continue;
                }

                /* HEADING */

                if (isHeading(currentLine)) {
                    const headingMatch =
                        currentLine.match(
                            /^\s{0,3}(#{1,6})\s+(.*)$/
                        );

                    if (headingMatch) {
                        appendHeading(
                            headingMatch[1].length,
                            headingMatch[2]
                        );
                    }

                    index += 1;
                    continue;
                }

                /* HORIZONTAL RULE */

                if (isHorizontalRule(currentLine)) {
                    const divider =
                        document.createElement("hr");

                    divider.className =
                        "mpai-markdown-divider";

                    container.appendChild(divider);

                    index += 1;
                    continue;
                }

                /* BULLET LIST */

                if (isBullet(currentLine)) {
                    const items = [];

                    while (
                        index < lines.length &&
                        isBullet(lines[index])
                    ) {
                        items.push(
                            getListText(
                                lines[index],
                                false
                            )
                        );

                        index += 1;
                    }

                    appendList(items, false);
                    continue;
                }

                /* NUMBERED LIST */

                if (isNumbered(currentLine)) {
                    const items = [];

                    while (
                        index < lines.length &&
                        isNumbered(lines[index])
                    ) {
                        items.push(
                            getListText(
                                lines[index],
                                true
                            )
                        );

                        index += 1;
                    }

                    appendList(items, true);
                    continue;
                }

                /* BLOCKQUOTE */

                if (isBlockquote(currentLine)) {
                    const quoteLines = [];

                    while (
                        index < lines.length &&
                        isBlockquote(lines[index])
                    ) {
                        quoteLines.push(
                            lines[index]
                                .replace(/^\s*>\s?/, "")
                        );

                        index += 1;
                    }

                    appendBlockquote(quoteLines);
                    continue;
                }

                /* NORMAL PARAGRAPH */

                const paragraphLines = [];

                while (
                    index < lines.length &&
                    lines[index].trim() &&
                    !isHeading(lines[index]) &&
                    !isBullet(lines[index]) &&
                    !isNumbered(lines[index]) &&
                    !isBlockquote(lines[index]) &&
                    !isCodeFence(lines[index]) &&
                    !isHorizontalRule(lines[index])
                ) {
                    paragraphLines.push(lines[index]);
                    index += 1;
                }

                appendParagraph(paragraphLines);
            }
        }

        /* ====================================================
           MESSAGE CREATION
        ==================================================== */

        function createMessage(role, content) {
            const isUser = role === "user";

            const article =
                document.createElement("article");

            article.className =
                "mpai-assistant-message " +
                (
                    isUser
                        ? "user-message"
                        : "assistant-message"
                );

            if (!isUser) {
                const avatar =
                    document.createElement("div");

                avatar.className =
                    "mpai-message-avatar";

                avatar.setAttribute(
                    "aria-hidden",
                    "true"
                );

                avatar.textContent = "M+";

                article.appendChild(avatar);
            }

            const contentWrapper =
                document.createElement("div");

            contentWrapper.className =
                "mpai-message-content";

            const name =
                document.createElement("div");

            name.className =
                "mpai-message-name";

            name.textContent =
                isUser ? "You" : "Market Plus AI";

            const bubble =
                document.createElement("div");

            bubble.className =
                "mpai-message-bubble";

            renderMarkdown(
                bubble,
                String(content || "")
            );

            contentWrapper.appendChild(name);
            contentWrapper.appendChild(bubble);

            article.appendChild(contentWrapper);

            return article;
        }

        function appendMessage(role, content) {
            const element = createMessage(
                role,
                content
            );

            elements.messages.appendChild(element);

            scrollToLatest();

            return element;
        }

        function clearMessages() {
            elements.messages.replaceChildren();
        }

        function showWelcomeMessage() {
            clearMessages();

            appendMessage(
                "assistant",
                "Hello! I'm your Market Plus AI Assistant.\n\n" +
                "I can help you understand market data, predictions, " +
                "investment records, What-If scenarios, alerts, " +
                "and application features.\n\n" +
                "What would you like to know?"
            );
        }

        function scrollToLatest() {
            requestAnimationFrame(() => {
                elements.messages.scrollTop =
                    elements.messages.scrollHeight;
            });
        }

        /* ====================================================
           TYPING INDICATOR
        ==================================================== */

        function showTypingIndicator() {
            removeTypingIndicator();

            const wrapper =
                document.createElement("div");

            wrapper.className =
                "mpai-assistant-typing";

            const avatar =
                document.createElement("div");

            avatar.className =
                "mpai-message-avatar";

            avatar.textContent = "M+";

            const bubble =
                document.createElement("div");

            bubble.className =
                "mpai-typing-bubble";

            for (let index = 0; index < 3; index += 1) {
                const dot =
                    document.createElement("span");

                dot.className =
                    "mpai-typing-dot";

                bubble.appendChild(dot);
            }

            wrapper.appendChild(avatar);
            wrapper.appendChild(bubble);

            elements.messages.appendChild(wrapper);

            state.typingElement = wrapper;

            scrollToLatest();
        }

        function removeTypingIndicator() {
            if (state.typingElement) {
                state.typingElement.remove();
                state.typingElement = null;
            }
        }

        /* ====================================================
           ERROR DISPLAY
        ==================================================== */

        function showError(message) {
            if (!elements.error) {
                return;
            }

            elements.error.textContent = String(message);
            elements.error.hidden = false;
        }

        function clearError() {
            if (!elements.error) {
                return;
            }

            elements.error.textContent = "";
            elements.error.hidden = true;
        }

        /* ====================================================
           ASSISTANT STATUS
        ==================================================== */

        function setStatus(message, type = "online") {
            if (elements.status) {
                elements.status.textContent = message;

                elements.status.classList.remove(
                    "is-offline",
                    "is-error"
                );

                if (type === "offline") {
                    elements.status.classList.add(
                        "is-offline"
                    );
                }

                if (type === "error") {
                    elements.status.classList.add(
                        "is-error"
                    );
                }
            }

            const offline =
                type === "offline" ||
                type === "error";

            if (elements.onlineDot) {
                elements.onlineDot.classList.toggle(
                    "is-offline",
                    offline
                );
            }

            if (elements.launcherStatus) {
                elements.launcherStatus.classList.toggle(
                    "is-offline",
                    offline
                );
            }
        }

        function updateStatusFromResponse(result) {
            if (!result || typeof result !== "object") {
                setStatus(
                    "Status unavailable",
                    "offline"
                );
                return;
            }

            const configured =
                result.ollama_configured === true;

            const fallback =
                result.fallback_available === true;

            const modelMissing =
                result.model_available === false ||
                result.ollama_model_available === false;

            const unavailable =
                result.ollama_available === false ||
                result.ollama_running === false ||
                result.available === false ||
                modelMissing;

            if (unavailable) {
                setStatus(
                    fallback
                        ? "Offline fallback available"
                        : "Local AI unavailable",
                    "offline"
                );

                return;
            }

            if (configured) {
                setStatus(
                    "Local AI configured",
                    "online"
                );
                return;
            }

            if (fallback) {
                setStatus(
                    "Fallback assistant available",
                    "offline"
                );
                return;
            }

            setStatus(
                "Assistant status unknown",
                "offline"
            );
        }

        async function loadAssistantStatus() {
            try {
                const result = await apiRequest(
                    CONFIG.endpoints.status
                );

                updateStatusFromResponse(result);

                return result;

            } catch (error) {
                console.error(
                    "Assistant status error:",
                    error
                );

                setStatus(
                    "Unable to check AI status",
                    "offline"
                );

                return null;

            } finally {
                state.statusLoaded = true;
            }
        }

        /* ====================================================
           CONVERSATION HISTORY
        ==================================================== */

        function normalizeHistory(messages) {
            if (!Array.isArray(messages)) {
                return [];
            }

            return messages
                .filter(
                    item =>
                        item &&
                        typeof item === "object"
                )
                .sort((first, second) => {
                    const firstDate = Date.parse(
                        first.created_at || ""
                    );

                    const secondDate = Date.parse(
                        second.created_at || ""
                    );

                    if (
                        !Number.isFinite(firstDate) ||
                        !Number.isFinite(secondDate)
                    ) {
                        return 0;
                    }

                    return firstDate - secondDate;
                });
        }

        async function loadConversationHistory() {
    if (state.historyLoaded) {
        return;
    }

    // If another part of the widget is already loading history,
    // wait for that same request instead of starting another.
    if (state.historyPromise) {
        return state.historyPromise;
    }

    state.historyLoading = true;

    state.historyPromise = (async () => {
        try {
            const result = await apiRequest(
                `${CONFIG.endpoints.history}?limit=${CONFIG.historyLimit}&offset=0`
            );

            const messages = normalizeHistory(
                Array.isArray(result)
                    ? result
                    : (
                        result.messages ||
                        result.history ||
                        result.items ||
                        []
                    )
            );

            clearMessages();

            if (messages.length > 0) {
                messages.forEach(item => {
                    const question =
                        item.question ||
                        item.user_message ||
                        item.user ||
                        "";

                    const answer =
                        item.answer ||
                        item.assistant_message ||
                        item.assistant ||
                        "";

                    if (question) {
                        appendMessage("user", question);
                    }

                    if (answer) {
                        appendMessage("assistant", answer);
                    }
                });
            } else {
                showWelcomeMessage();
            }

            state.historyLoaded = true;

        } catch (error) {
            console.error(
                "Assistant history error:",
                error
            );

            showWelcomeMessage();

            // Allow another attempt later.
            state.historyLoaded = false;

        } finally {
            state.historyLoading = false;
            state.historyPromise = null;
        }
    })();

    return state.historyPromise;
}
        /* ====================================================
           INPUT HANDLING
        ==================================================== */

        function setSending(isSending) {
            state.isSending = isSending;

            elements.sendButton.disabled = isSending;
            elements.input.disabled = isSending;

            elements.sendButton.setAttribute(
                "aria-busy",
                String(isSending)
            );

            if (elements.quickPrompts) {
                elements.quickPrompts
                    .querySelectorAll("button")
                    .forEach(button => {
                        button.disabled = isSending;
                    });
            }
        }

        function resizeInput() {
            elements.input.style.height = "auto";

            elements.input.style.height =
                Math.min(
                    elements.input.scrollHeight,
                    110
                ) + "px";
        }

        /* ====================================================
           SEND MESSAGE
        ==================================================== */

        async function sendQuestion(questionOverride = "") {
            if (state.isSending) {
                return;
            }

            const question = String(
                questionOverride ||
                elements.input.value
            ).trim();

            if (!question) {
                elements.input.focus();
                return;
            }

            if (
                question.length >
                CONFIG.maximumQuestionLength
            ) {
                showError(
                    "Your message is too long. Use 2,000 characters or fewer."
                );
                return;
            }

            clearError();

            if (!state.historyLoaded) {
                await loadConversationHistory();
            }

            appendMessage("user", question);

            elements.input.value = "";
            resizeInput();

            setSending(true);
            showTypingIndicator();

            try {
                const result = await apiRequest(
                    CONFIG.endpoints.chat,
                    {
                        method: "POST",

                        body: {
                            question: question,
                            page_context: buildPageContext()
                        }
                    }
                );

                removeTypingIndicator();

                const answer = String(
                    result.answer || ""
                ).trim();

                if (!answer) {
                    throw new Error(
                        "The assistant returned an empty response."
                    );
                }

                appendMessage(
                    "assistant",
                    answer
                );

                const engine = String(
                    result.engine || ""
                ).toLowerCase();

                if (
                    engine.includes("fallback") ||
                    engine.includes("offline")
                ) {
                    setStatus(
                        "Using offline assistant",
                        "offline"
                    );
                } else if (engine) {
                    setStatus(
                        `Responded using ${result.model || engine}`,
                        "online"
                    );
                }

            } catch (error) {
                removeTypingIndicator();

                console.error(
                    "Assistant chat error:",
                    error
                );

                showError(
                    error.message ||
                    "Unable to get a response from the assistant."
                );

                if (
                    /session|login|log in|unauthorized|401/i.test(
                        error.message || ""
                    )
                ) {
                    setStatus(
                        "Please log in again",
                        "error"
                    );
                } else {
                    setStatus(
                        "Assistant request failed",
                        "error"
                    );
                }

                if (!elements.input.value) {
                    elements.input.value = question;
                    resizeInput();
                }

            } finally {
                setSending(false);

                if (state.isOpen) {
                    elements.input.focus();
                }
            }
        }

        /* ====================================================
           CLEAR CONVERSATION
        ==================================================== */

        async function clearConversation() {
            if (state.isSending) {
                return;
            }

            const confirmed = window.confirm(
                "Clear your saved Market Plus AI Assistant conversation history?"
            );

            if (!confirmed) {
                return;
            }

            clearError();

            elements.clearButton.disabled = true;

            try {
                await apiRequest(
                    CONFIG.endpoints.history,
                    {
                        method: "DELETE"
                    }
                );

                state.historyLoaded = true;

                showWelcomeMessage();

                setStatus(
                    "Conversation history cleared",
                    "online"
                );

            } catch (error) {
                console.error(
                    "Clear history error:",
                    error
                );

                showError(
                    error.message ||
                    "Unable to clear conversation history."
                );

            } finally {
                elements.clearButton.disabled = false;
            }
        }

        /* ====================================================
           PANEL OPEN / CLOSE
        ==================================================== */

        function openAssistant() {
            state.isOpen = true;

            elements.panel.hidden = false;

            elements.launcher.setAttribute(
                "aria-expanded",
                "true"
            );

            loadConversationHistory();

            if (!state.statusLoaded) {
                loadAssistantStatus();
            }

            window.setTimeout(() => {
                elements.input.focus();
                scrollToLatest();
            }, 80);
        }

        function closeAssistant() {
            state.isOpen = false;

            elements.panel.hidden = true;

            elements.launcher.setAttribute(
                "aria-expanded",
                "false"
            );

            elements.launcher.focus();
        }

        function toggleAssistant() {
            if (state.isOpen) {
                closeAssistant();
            } else {
                openAssistant();
            }
        }

        /* ====================================================
           QUICK PROMPTS
        ==================================================== */

        function handleQuickPrompt(event) {
            const button = event.target.closest(
                "[data-assistant-prompt]"
            );

            if (!button || state.isSending) {
                return;
            }

            const prompt =
                button.dataset.assistantPrompt || "";

            if (prompt.trim()) {
                sendQuestion(prompt);
            }
        }

        /* ====================================================
           EVENT LISTENERS
        ==================================================== */

        elements.launcher.addEventListener(
            "click",
            toggleAssistant
        );

        elements.closeButton.addEventListener(
            "click",
            closeAssistant
        );

        elements.clearButton.addEventListener(
            "click",
            clearConversation
        );

        elements.form.addEventListener(
            "submit",
            event => {
                event.preventDefault();
                sendQuestion();
            }
        );

        elements.input.addEventListener(
            "input",
            resizeInput
        );

        elements.input.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.isComposing
                ) {
                    event.preventDefault();

                    if (!state.isSending) {
                        elements.form.requestSubmit();
                    }
                }
            }
        );

        if (elements.quickPrompts) {
            elements.quickPrompts.addEventListener(
                "click",
                handleQuickPrompt
            );
        }

        document.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Escape" &&
                    state.isOpen
                ) {
                    closeAssistant();
                }
            }
        );

        window.addEventListener(
            "online",
            loadAssistantStatus
        );

        window.addEventListener(
            "offline",
            () => {
                setStatus(
                    "Browser is offline",
                    "offline"
                );
            }
        );

        /* ====================================================
           INITIAL STATE
        ==================================================== */

        elements.panel.hidden = true;

        elements.launcher.setAttribute(
            "aria-expanded",
            "false"
        );

        showWelcomeMessage();

        setStatus(
            "Assistant available",
            "online"
        );

        console.info(
            "Market Plus AI Assistant initialized successfully."
        );
    }

    /* ========================================================
       DOM READY
    ======================================================== */

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializeAssistant,
            { once: true }
        );
    } else {
        initializeAssistant();
    }

})();
