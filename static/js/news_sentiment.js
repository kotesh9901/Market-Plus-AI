"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const API = {
        stockSearch: "/api/stocks/search",
        marketNews: "/api/news/market",
        companyNews: (symbol) =>
            `/api/news?symbol=${encodeURIComponent(symbol)}&limit=10`,
        sentiment: (symbol) =>
            `/api/news/sentiment?symbol=${encodeURIComponent(symbol)}&limit=10`
    };

    const elements = {
        form: document.getElementById("stockNewsForm"),
        input: document.getElementById("stockSymbol"),
        searchButton: document.getElementById("searchButton"),
        searchButtonText: document.getElementById("searchButtonText"),
        refreshAllButton: document.getElementById("refreshAllButton"),
        refreshMarketButton: document.getElementById("refreshMarketButton"),
        pageStatus: document.getElementById("pageStatus"),

        sentimentSymbol: document.getElementById("sentimentSymbol"),
        overallSentiment: document.getElementById("overallSentiment"),
        sentimentDescription: document.getElementById("overallSentimentDescription"),
        sentimentMeter: document.getElementById("sentimentMeterFill"),
        positiveCount: document.getElementById("positiveCount"),
        neutralCount: document.getElementById("neutralCount"),
        negativeCount: document.getElementById("negativeCount"),

        companyDescription: document.getElementById("companyNewsDescription"),
        companyArticleCount: document.getElementById("companyArticleCount"),
        companyLoading: document.getElementById("companyNewsLoading"),
        companyList: document.getElementById("companyNewsList"),

        marketLoading: document.getElementById("marketNewsLoading"),
        marketList: document.getElementById("marketNewsList"),

        sidebar: document.getElementById("sidebar"),
        menuToggle: document.getElementById("menuToggle"),
        sidebarOverlay: document.getElementById("sidebarOverlay"),

        modal: document.getElementById("articleModal"),
        closeModal: document.getElementById("closeArticleModal"),
        modalSymbol: document.getElementById("articleModalSymbol"),
        modalMeta: document.getElementById("articleModalMeta"),
        modalTitle: document.getElementById("articleModalTitle"),
        modalSummary: document.getElementById("articleModalSummary"),
        modalKeyPoints: document.getElementById("articleModalKeyPoints"),
        modalImpact: document.getElementById("articleModalImpact"),
        modalSentiment: document.getElementById("articleModalSentiment"),
        modalSource: document.getElementById("articleModalSource"),
        modalDate: document.getElementById("articleModalDate")
    };

    let selectedSymbol = "";
    let currentView = "market";
    let stockSearchTimer = null;
    let activeSearchController = null;
    let searchResults = [];
    let activeSuggestionIndex = -1;
    let lastCompanyRequest = 0;
    let lastMarketRequest = 0;
    let currentArticles = [];
    let previousFocusedElement = null;

    // ---------------------------------------------------------
    // General helpers
    // ---------------------------------------------------------

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[character]);
    }

    function setStatus(message, type = "info") {
        if (!elements.pageStatus) return;

        elements.pageStatus.textContent = message;
        elements.pageStatus.dataset.status = type;
        elements.pageStatus.hidden = !message;
    }

    function setButtonLoading(button, loading, originalText) {
        if (!button) return;

        button.disabled = loading;

        if (button === elements.searchButton && elements.searchButtonText) {
            elements.searchButtonText.textContent = loading
                ? "Searching..."
                : originalText || "Search";
        }
    }

    function formatDate(value) {
        if (!value) return "Date unavailable";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function normalizeSymbol(value) {
        return String(value || "").trim().toUpperCase();
    }

    function safeArticleURL(value) {
        if (!value) return "";

        try {
            const url = new URL(value);

            if (url.protocol !== "https:" && url.protocol !== "http:") {
                return "";
            }

            return url.href;
        } catch {
            return "";
        }
    }

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        let payload;

        try {
            payload = await response.json();
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (response.status === 401 || response.status === 403) {
            throw new Error("Your session may have expired. Please log in again.");
        }

        if (!response.ok || payload?.success === false) {
            throw new Error(
                payload?.message ||
                payload?.error ||
                `Request failed (${response.status}).`
            );
        }

        return payload;
    }

    function unwrapPayload(payload) {
        if (!payload || typeof payload !== "object") {
            return {};
        }

        if (
            payload.data &&
            typeof payload.data === "object" &&
            !Array.isArray(payload.data)
        ) {
            return {
                ...payload,
                ...payload.data
            };
        }

        return payload;
    }

    function extractArray(payload, keys) {
        if (Array.isArray(payload)) return payload;

        const root = unwrapPayload(payload);

        for (const key of keys) {
            if (Array.isArray(root[key])) {
                return root[key];
            }
        }

        if (Array.isArray(root.data)) {
            return root.data;
        }

        return [];
    }

    // ---------------------------------------------------------
    // View handling
    // ---------------------------------------------------------

    function setView(view) {
        currentView = view;

        const companySection = elements.companyList?.closest("section");
        const marketSection = elements.marketList?.closest("section");

        if (companySection) {
            companySection.hidden = view !== "company";
        }

        if (marketSection) {
            marketSection.hidden = view !== "market";
        }

        if (view === "market") {
            if (elements.sentimentSymbol) {
                elements.sentimentSymbol.textContent = "Market";
            }
        } else if (selectedSymbol && elements.sentimentSymbol) {
            elements.sentimentSymbol.textContent = selectedSymbol;
        }
    }

    // ---------------------------------------------------------
    // Stock search and autocomplete
    // ---------------------------------------------------------

    function getOrCreateSuggestionContainer() {
        if (!elements.input) return null;

        const inputWrapper = elements.input.closest(".search-input-wrapper");

        if (!inputWrapper) return null;

        let outerWrapper = inputWrapper.parentElement;

        if (!outerWrapper?.classList.contains("news-stock-search-wrapper")) {
            outerWrapper = document.createElement("div");
            outerWrapper.className = "news-stock-search-wrapper";

            inputWrapper.parentNode.insertBefore(outerWrapper, inputWrapper);
            outerWrapper.appendChild(inputWrapper);
        }

        let dropdown = outerWrapper.querySelector(".news-stock-suggestions");

        if (!dropdown) {
            dropdown = document.createElement("div");
            dropdown.className = "news-stock-suggestions";
            dropdown.hidden = true;
            dropdown.setAttribute("role", "listbox");

            outerWrapper.appendChild(dropdown);
        }

        return dropdown;
    }

    const suggestionContainer = getOrCreateSuggestionContainer();

    function extractStockResults(payload) {
        const results = extractArray(payload, [
            "results",
            "stocks",
            "assets",
            "matches",
            "items"
        ]);

        return results
            .map((item) => {
                if (!item || typeof item !== "object") return null;

                const symbol = normalizeSymbol(
                    item.symbol || item.ticker || item.stock_symbol
                );

                if (!symbol) return null;

                return {
                    symbol,
                    name:
                        item.name ||
                        item.company_name ||
                        item.company ||
                        item.short_name ||
                        symbol,
                    exchange: item.exchange || "",
                    price: item.price ?? item.current_price ?? null
                };
            })
            .filter(Boolean);
    }

    function hideSuggestions() {
        if (!suggestionContainer) return;

        suggestionContainer.innerHTML = "";
        suggestionContainer.hidden = true;
        activeSuggestionIndex = -1;

        elements.input?.removeAttribute("aria-activedescendant");
        elements.input?.setAttribute("aria-expanded", "false");
    }

    function renderSuggestions(results) {
        if (!suggestionContainer) return;

        searchResults = results;
        activeSuggestionIndex = -1;

        if (!results.length) {
            hideSuggestions();
            return;
        }

        suggestionContainer.innerHTML = results.map((stock, index) => `
            <button
                type="button"
                class="news-stock-suggestion"
                role="option"
                aria-selected="false"
                data-index="${index}"
                id="news-stock-option-${index}"
            >
                <span class="news-stock-suggestion-main">
                    <strong>${escapeHTML(stock.name)}</strong>
                    <small>${escapeHTML(stock.symbol)}</small>
                </span>
                <span class="news-stock-suggestion-exchange">
                    ${escapeHTML(stock.exchange)}
                </span>
            </button>
        `).join("");

        suggestionContainer.hidden = false;
        elements.input?.setAttribute("aria-expanded", "true");
    }

    async function searchStocks(query) {
        if (!query || query.length < 1) {
            hideSuggestions();
            return;
        }

        if (activeSearchController) {
            activeSearchController.abort();
        }

        activeSearchController = new AbortController();

        try {
            const payload = await fetchJSON(
                `${API.stockSearch}?q=${encodeURIComponent(query)}`,
                { signal: activeSearchController.signal }
            );

            renderSuggestions(extractStockResults(payload));
        } catch (error) {
            if (error.name !== "AbortError") {
                hideSuggestions();
            }
        }
    }

    function chooseSuggestion(index) {
        const stock = searchResults[index];

        if (!stock) return;

        elements.input.value = stock.symbol;
        hideSuggestions();

        selectStock(stock.symbol);
    }

    function updateActiveSuggestion(index) {
        const options = suggestionContainer?.querySelectorAll(
            ".news-stock-suggestion"
        );

        if (!options?.length) return;

        activeSuggestionIndex = Math.max(
            0,
            Math.min(index, options.length - 1)
        );

        options.forEach((option, optionIndex) => {
            const active = optionIndex === activeSuggestionIndex;

            option.classList.toggle("active", active);
            option.setAttribute("aria-selected", String(active));
        });

        const activeOption = options[activeSuggestionIndex];

        elements.input?.setAttribute(
            "aria-activedescendant",
            activeOption.id
        );

        activeOption.scrollIntoView({
            block: "nearest"
        });
    }

    elements.input?.addEventListener("input", () => {
        clearTimeout(stockSearchTimer);

        const query = elements.input.value.trim();

        if (!query) {
            hideSuggestions();
            return;
        }

        stockSearchTimer = setTimeout(() => {
            searchStocks(query);
        }, 250);
    });

    elements.input?.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && searchResults.length) {
            event.preventDefault();
            updateActiveSuggestion(activeSuggestionIndex + 1);
        }

        if (event.key === "ArrowUp" && searchResults.length) {
            event.preventDefault();
            updateActiveSuggestion(
                activeSuggestionIndex < 0
                    ? searchResults.length - 1
                    : activeSuggestionIndex - 1
            );
        }

        if (event.key === "Escape") {
            hideSuggestions();
        }

        if (event.key === "Enter") {
            event.preventDefault();

            if (
                activeSuggestionIndex >= 0 &&
                searchResults[activeSuggestionIndex]
            ) {
                chooseSuggestion(activeSuggestionIndex);
                return;
            }

            const query = normalizeSymbol(elements.input.value);

            const exactMatch = searchResults.find(
                (stock) => stock.symbol === query
            );

            if (exactMatch) {
                chooseSuggestion(searchResults.indexOf(exactMatch));
            } else {
                hideSuggestions();
                selectStock(query);
            }
        }
    });

    suggestionContainer?.addEventListener("click", (event) => {
        const option = event.target.closest(".news-stock-suggestion");

        if (!option) return;

        chooseSuggestion(Number(option.dataset.index));
    });

    document.addEventListener("click", (event) => {
        if (
            !event.target.closest(".news-stock-search-wrapper")
        ) {
            hideSuggestions();
        }
    });

    // ---------------------------------------------------------
    // Article normalization and rendering
    // ---------------------------------------------------------

    function normalizeArticle(article) {
        if (!article || typeof article !== "object") return null;

        const title =
            article.title ||
            article.headline ||
            article.name ||
            "";

        if (!title.trim()) return null;

        const source = article.source;

        return {
            id: article.id || "",
            symbol: article.symbol || selectedSymbol || "",
            title: title.trim(),
            summary:
                article.summary ||
                article.description ||
                article.snippet ||
                "",
            source:
                typeof source === "object"
                    ? source.name || source.title || "Source unavailable"
                    : source || article.publisher || "Source unavailable",
            url: safeArticleURL(article.url || article.link),
            publishedAt:
                article.published_at ||
                article.publishedAt ||
                article.pubDate ||
                article.date ||
                "",
            sentiment: String(article.sentiment || "unavailable").toLowerCase(),
            sentimentScore: article.sentiment_score ?? null
        };
    }

    function extractArticles(payload) {
        const rawArticles = extractArray(payload, [
            "articles",
            "news",
            "results",
            "items"
        ]);

        return rawArticles
            .map(normalizeArticle)
            .filter(Boolean);
    }

    function sentimentClass(value) {
        const sentiment = String(value || "").toLowerCase();

        if (sentiment === "positive") return "positive";
        if (sentiment === "negative") return "negative";
        if (sentiment === "neutral") return "neutral";

        return "unavailable";
    }

    function sentimentLabel(value) {
        const sentiment = sentimentClass(value);

        if (sentiment === "positive") return "Positive";
        if (sentiment === "negative") return "Negative";
        if (sentiment === "neutral") return "Neutral";

        return "Not available";
    }

    function renderArticleCard(article, index) {
        const sentiment = sentimentClass(article.sentiment);

        return `
            <article
                class="news-article-card"
                data-article-index="${index}"
                tabindex="0"
                role="button"
                aria-label="Read article: ${escapeHTML(article.title)}"
            >
                <div class="news-article-header">
                    <span class="news-article-source">
                        ${escapeHTML(article.source)}
                    </span>
                    <span class="news-sentiment-badge ${sentiment}">
                        ${sentimentLabel(article.sentiment)}
                    </span>
                </div>

                <h3 class="news-article-title">
                    ${escapeHTML(article.title)}
                </h3>

                <p class="news-article-summary">
                    ${escapeHTML(
                        article.summary || "No article summary was provided by the source."
                    )}
                </p>

                <div class="news-article-footer">
                    <span>${escapeHTML(formatDate(article.publishedAt))}</span>
                    <span class="news-read-more">Read details</span>
                </div>
            </article>
        `;
    }

    function renderArticleList(container, articles, emptyMessage) {
        if (!container) return;

        if (!articles.length) {
            container.innerHTML = `
                <div class="news-empty-state">
                    <p>${escapeHTML(emptyMessage)}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = articles
            .map(renderArticleCard)
            .join("");
    }

    // ---------------------------------------------------------
    // Sentiment summary
    // ---------------------------------------------------------

    function extractSentimentSummary(payload) {
        const root = unwrapPayload(payload);

        const counts =
            root.sentiment_counts ||
            root.sentimentCounts ||
            {};

        const positive = Number(
            counts.positive ??
            root.positive_count ??
            root.positive ??
            0
        );

        const neutral = Number(
            counts.neutral ??
            root.neutral_count ??
            root.neutral ??
            0
        );

        const negative = Number(
            counts.negative ??
            root.negative_count ??
            root.negative ??
            0
        );

        const rawScore = Number(root.average_sentiment_score);

        return {
            overall: String(
                root.overall_sentiment || "unavailable"
            ).toLowerCase(),
            score: Number.isFinite(rawScore) ? rawScore : null,
            positive: Number.isFinite(positive) ? positive : 0,
            neutral: Number.isFinite(neutral) ? neutral : 0,
            negative: Number.isFinite(negative) ? negative : 0,
            message: root.message || ""
        };
    }

    function updateSentimentUI(payload) {
        const summary = extractSentimentSummary(payload);

        if (elements.sentimentSymbol) {
            elements.sentimentSymbol.textContent =
                selectedSymbol || "Market";
        }

        if (elements.overallSentiment) {
            elements.overallSentiment.textContent =
                sentimentLabel(summary.overall);
            elements.overallSentiment.className =
                `sentiment-value ${sentimentClass(summary.overall)}`;
        }

        if (elements.sentimentDescription) {
            elements.sentimentDescription.textContent =
                summary.message ||
                (
                    summary.overall === "unavailable"
                        ? "Sentiment information is not available for this stock."
                        : "Sentiment is calculated from the available news articles."
                );
        }

        if (elements.positiveCount) {
            elements.positiveCount.textContent = summary.positive;
        }

        if (elements.neutralCount) {
            elements.neutralCount.textContent = summary.neutral;
        }

        if (elements.negativeCount) {
            elements.negativeCount.textContent = summary.negative;
        }

        if (elements.sentimentMeter) {
            let percentage = 50;

            if (summary.score !== null) {
                const boundedScore = Math.max(
                    -1,
                    Math.min(1, summary.score)
                );

                percentage = ((boundedScore + 1) / 2) * 100;
            } else {
                const total =
                    summary.positive +
                    summary.neutral +
                    summary.negative;

                if (total > 0) {
                    percentage =
                        ((summary.positive + summary.neutral * 0.5) / total) *
                        100;
                }
            }

            elements.sentimentMeter.style.width =
                `${Math.max(0, Math.min(100, percentage))}%`;
        }
    }

    function resetSentimentUI() {
        updateSentimentUI({
            overall_sentiment: "unavailable",
            average_sentiment_score: 0,
            sentiment_counts: {
                positive: 0,
                neutral: 0,
                negative: 0
            },
            message: "Sentiment information is not available."
        });
    }

    // ---------------------------------------------------------
    // Company news
    // ---------------------------------------------------------

    async function loadSelectedStockNews(symbol) {
        const requestId = ++lastCompanyRequest;

        if (elements.companyLoading) {
            elements.companyLoading.hidden = false;
        }

        if (elements.companyList) {
            elements.companyList.innerHTML = "";
        }

        if (elements.companyDescription) {
            elements.companyDescription.textContent =
                `Latest available news for ${symbol}.`;
        }

        if (elements.companyArticleCount) {
            elements.companyArticleCount.textContent = "Loading...";
        }

        try {
            const [newsResult, sentimentResult] = await Promise.allSettled([
                fetchJSON(API.companyNews(symbol)),
                fetchJSON(API.sentiment(symbol))
            ]);

            if (requestId !== lastCompanyRequest) return;

            if (newsResult.status === "fulfilled") {
                const articles = extractArticles(newsResult.value);

                currentArticles = articles;

                renderArticleList(
                    elements.companyList,
                    articles,
                    `No news articles are currently available for ${symbol}.`
                );

                if (elements.companyArticleCount) {
                    elements.companyArticleCount.textContent =
                        `${articles.length} articles`;
                }
            } else {
                currentArticles = [];

                renderArticleList(
                    elements.companyList,
                    [],
                    newsResult.reason?.message ||
                    "Unable to load company news."
                );

                if (elements.companyArticleCount) {
                    elements.companyArticleCount.textContent = "Unavailable";
                }
            }

            if (sentimentResult.status === "fulfilled") {
                updateSentimentUI(sentimentResult.value);
            } else {
                resetSentimentUI();
            }

            if (
                newsResult.status === "rejected" &&
                sentimentResult.status === "rejected"
            ) {
                setStatus(
                    newsResult.reason?.message ||
                    "Unable to load stock news.",
                    "error"
                );
            } else {
                setStatus(`Showing available news for ${symbol}.`, "success");
            }
        } catch (error) {
            if (requestId !== lastCompanyRequest) return;

            setStatus(error.message || "Unable to load stock news.", "error");
        } finally {
            if (
                requestId === lastCompanyRequest &&
                elements.companyLoading
            ) {
                elements.companyLoading.hidden = true;
            }
        }
    }

    async function selectStock(symbol) {
        const cleanSymbol = normalizeSymbol(symbol);

        if (!cleanSymbol) {
            setStatus("Enter a valid stock symbol or company name.", "error");
            return;
        }

        selectedSymbol = cleanSymbol;

        setView("company");

        if (elements.input) {
            elements.input.value = cleanSymbol;
        }

        if (elements.searchButton) {
            setButtonLoading(elements.searchButton, true, "Search");
        }

        hideSuggestions();

        try {
            await loadSelectedStockNews(cleanSymbol);
        } finally {
            setButtonLoading(elements.searchButton, false, "Search");
        }
    }

    elements.form?.addEventListener("submit", (event) => {
        event.preventDefault();

        const query = elements.input?.value.trim();

        if (!query) {
            setStatus("Enter a stock name or symbol to search.", "error");
            elements.input?.focus();
            return;
        }

        const normalizedQuery = normalizeSymbol(query);

        const exactMatch = searchResults.find(
            (stock) =>
                stock.symbol === normalizedQuery ||
                stock.name.toLowerCase() === query.toLowerCase()
        );

        if (exactMatch) {
            chooseSuggestion(searchResults.indexOf(exactMatch));
        } else {
            selectStock(query);
        }
    });

    // ---------------------------------------------------------
    // Market news
    // ---------------------------------------------------------

    async function loadMarketNews() {
        const requestId = ++lastMarketRequest;

        if (elements.marketLoading) {
            elements.marketLoading.hidden = false;
        }

        if (elements.marketList) {
            elements.marketList.innerHTML = "";
        }

        try {
            const payload = await fetchJSON(
                `${API.marketNews}?limit=10`
            );

            if (requestId !== lastMarketRequest) return;

            const articles = extractArticles(payload);

            renderArticleList(
                elements.marketList,
                articles,
                "No market news articles are currently available."
            );

            if (currentView === "market") {
                setStatus(
                    articles.length
                        ? "Market news refreshed."
                        : "No market news is currently available.",
                    "success"
                );
            }
        } catch (error) {
            if (requestId !== lastMarketRequest) return;

            renderArticleList(
                elements.marketList,
                [],
                error.message || "Unable to load market news."
            );

            if (currentView === "market") {
                setStatus(error.message || "Unable to load market news.", "error");
            }
        } finally {
            if (
                requestId === lastMarketRequest &&
                elements.marketLoading
            ) {
                elements.marketLoading.hidden = true;
            }
        }
    }

    // ---------------------------------------------------------
    // Refresh controls
    // ---------------------------------------------------------

    elements.refreshMarketButton?.addEventListener("click", async () => {
        elements.refreshMarketButton.disabled = true;

        try {
            await loadMarketNews();
        } finally {
            elements.refreshMarketButton.disabled = false;
        }
    });

    elements.refreshAllButton?.addEventListener("click", async () => {
        elements.refreshAllButton.disabled = true;

        try {
            const tasks = [loadMarketNews()];

            if (currentView === "company" && selectedSymbol) {
                tasks.push(loadSelectedStockNews(selectedSymbol));
            }

            await Promise.allSettled(tasks);
        } finally {
            elements.refreshAllButton.disabled = false;
        }
    });

    // ---------------------------------------------------------
    // Article modal
    // ---------------------------------------------------------

    function openArticleModal(article) {
        if (!elements.modal || !article) return;

        previousFocusedElement = document.activeElement;

        if (elements.modalSymbol) {
            elements.modalSymbol.textContent =
                article.symbol || selectedSymbol || "News";
        }

        if (elements.modalMeta) {
            elements.modalMeta.textContent =
                `${article.source} • ${formatDate(article.publishedAt)}`;
        }

        if (elements.modalTitle) {
            elements.modalTitle.textContent = article.title;
        }

        if (elements.modalSummary) {
            elements.modalSummary.textContent =
                article.summary || "No article summary was provided by the source.";
        }

        if (elements.modalKeyPoints) {
            elements.modalKeyPoints.innerHTML = "";

            const item = document.createElement("li");
            item.textContent =
                "The news provider did not supply separate key points.";

            elements.modalKeyPoints.appendChild(item);
        }

        if (elements.modalImpact) {
            elements.modalImpact.textContent =
                "No separate market impact assessment was supplied by the news provider.";
        }

        if (elements.modalSentiment) {
            elements.modalSentiment.textContent =
                sentimentLabel(article.sentiment);
            elements.modalSentiment.className =
                `news-sentiment-badge ${sentimentClass(article.sentiment)}`;
        }

        if (elements.modalSource) {
            elements.modalSource.textContent = article.source;
        }

        if (elements.modalDate) {
            elements.modalDate.textContent =
                formatDate(article.publishedAt);
        }

        elements.modal.hidden = false;
        elements.modal.classList.add("active");
        document.body.classList.add("modal-open");

        elements.closeModal?.focus();
    }

    function closeArticleModal() {
        if (!elements.modal) return;

        elements.modal.hidden = true;
        elements.modal.classList.remove("active");
        document.body.classList.remove("modal-open");

        previousFocusedElement?.focus();
    }

    function handleArticleClick(event) {
        const card = event.target.closest("[data-article-index]");

        if (!card) return;

        const index = Number(card.dataset.articleIndex);
        const article = currentArticles[index];

        if (article) {
            openArticleModal(article);
        }
    }

    elements.companyList?.addEventListener("click", handleArticleClick);
    elements.marketList?.addEventListener("click", (event) => {
        const card = event.target.closest("[data-article-index]");

        if (!card) return;

        const index = Number(card.dataset.articleIndex);
        const article = marketArticles[index];

        if (article) {
            openArticleModal(article);
        }
    });

    // Keep market articles separate from company articles.
    let marketArticles = [];

    const originalRenderArticleList = renderArticleList;

    function renderMarketArticleList(articles) {
        marketArticles = articles;
        originalRenderArticleList(
            elements.marketList,
            articles,
            "No market news articles are currently available."
        );
    }

    // Replace market rendering with the dedicated market article collection.
    const originalLoadMarketNews = loadMarketNews;

    // The market list is rendered directly here to preserve its own article data.
    async function refreshMarketNews() {
        const requestId = ++lastMarketRequest;

        if (elements.marketLoading) {
            elements.marketLoading.hidden = false;
        }

        try {
            const payload = await fetchJSON(`${API.marketNews}?limit=10`);

            if (requestId !== lastMarketRequest) return;

            renderMarketArticleList(extractArticles(payload));

            if (currentView === "market") {
                setStatus(
                    marketArticles.length
                        ? "Market news refreshed."
                        : "No market news is currently available.",
                    "success"
                );
            }
        } catch (error) {
            if (requestId !== lastMarketRequest) return;

            renderMarketArticleList([]);

            if (currentView === "market") {
                setStatus(error.message || "Unable to load market news.", "error");
            }
        } finally {
            if (
                requestId === lastMarketRequest &&
                elements.marketLoading
            ) {
                elements.marketLoading.hidden = true;
            }
        }
    }

    // Use the market-specific loader for all market refresh actions.
    loadMarketNews = refreshMarketNews;

    elements.closeModal?.addEventListener("click", closeArticleModal);

    document.querySelectorAll("[data-close-article]").forEach((element) => {
        element.addEventListener("click", closeArticleModal);
    });

    elements.modal?.addEventListener("click", (event) => {
        if (event.target === elements.modal) {
            closeArticleModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && elements.modal && !elements.modal.hidden) {
            closeArticleModal();
        }

        if (event.key === "Enter" || event.key === " ") {
            const card = event.target.closest?.("[data-article-index]");

            if (card && event.target === card) {
                event.preventDefault();
                card.click();
            }
        }
    });

    // ---------------------------------------------------------
    // Mobile sidebar
    // ---------------------------------------------------------

    function closeSidebar() {
        elements.sidebar?.classList.remove("active");
        elements.sidebarOverlay?.classList.remove("active");
        document.body.classList.remove("sidebar-open");
    }

    elements.menuToggle?.addEventListener("click", () => {
        elements.sidebar?.classList.toggle("active");
        elements.sidebarOverlay?.classList.toggle("active");
        document.body.classList.toggle(
            "sidebar-open",
            elements.sidebar?.classList.contains("active") || false
        );
    });

    elements.sidebarOverlay?.addEventListener("click", closeSidebar);

    // ---------------------------------------------------------
    // Initial page state
    // ---------------------------------------------------------

    if (elements.input) {
        elements.input.value = "";
        elements.input.setAttribute("autocomplete", "off");
        elements.input.setAttribute("aria-autocomplete", "list");
        elements.input.setAttribute("aria-expanded", "false");
    }

    setView("market");
    resetSentimentUI();

    loadMarketNews();
});