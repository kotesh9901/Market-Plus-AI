
"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const $ = id => document.getElementById(id);

    const elements = {
        search: $("historySearchInput"),
        status: $("historyStatusFilter"),
        period: $("historyPeriodFilter"),
        sort: $("historySortSelect"),

        table: $("historyTableBody"),
        tableContainer: $("historyTableContainer"),

        completedTable: $("completedTableBody"),
        completedTableContainer: $("completedTableContainer"),
        completedSection: $("completedPredictionsSection"),
        completedEmpty: $("completedEmptyState"),
        completedCount: $("completedPredictionCount"),

        loading: $("historyLoadingState"),
        empty: $("historyEmptyState"),
        emptyTitle: $("historyEmptyTitle"),
        emptyDescription: $("historyEmptyDescription"),

        message: $("historyPageMessage"),
        resultCount: $("historyResultCount"),

        totalCount: $("historyCountValue"),
        totalProfitLoss: $("historyTotalProfitLoss"),
        winRate: $("historyWinRate"),
        averageReturn: $("historyAverageReturn"),

        refresh: $("refreshHistoryButton"),
        export: $("exportHistoryButton"),

        pagination: $("historyPagination"),
        pageIndicator: $("historyPageIndicator"),
        previous: $("historyPreviousPage"),
        next: $("historyNextPage"),

        pageDate: $("historyPageDate"),
        avatar: $("topbarAvatar"),

        logout: $("logoutButton"),
        menu: $("mobileMenuButton"),
        sidebar: $("appSidebar"),
        overlay: $("sidebarOverlay")
    };

    const API = {
        history: "/api/predictions/history",
        investments: "/api/investments",
        stock: symbol => `/api/stocks/${encodeURIComponent(symbol)}`
    };

    const PAGE_SIZE = 10;
    const QUOTE_REFRESH_INTERVAL = 60000;

    let allRecords = [];
    let filteredRecords = [];
    let completedRecords = [];
    let currentPage = 1;
    let loading = false;
    let quoteTimer = null;

    const quoteCache = new Map();

    // ---------------------------------------------------------
    // GENERAL HELPERS
    // ---------------------------------------------------------

    function showMessage(message, type = "info") {
        if (!elements.message) return;

        elements.message.textContent = message;
        elements.message.hidden = !message;
        elements.message.className = "history-message";

        if (type === "error") {
            elements.message.classList.add("is-error");
        } else if (type === "success") {
            elements.message.classList.add("is-success");
        }
    }

    function safeNumber(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        if (typeof value === "string") {
            value = value
                .replace(/,/g, "")
                .replace(/[₹$€£]/g, "")
                .trim();
        }

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function firstValue(objects, keys) {
        for (const object of objects) {
            if (!object || typeof object !== "object") continue;

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

    function parseMetadata(record) {
        if (record.metadata && typeof record.metadata === "object") {
            return record.metadata;
        }

        if (typeof record.metadata_json === "string") {
            try {
                const parsed = JSON.parse(record.metadata_json);

                if (parsed && typeof parsed === "object") {
                    return parsed;
                }
            } catch (error) {
                console.warn("Prediction metadata could not be parsed.");
            }
        }

        return {};
    }

    function unwrapData(data) {
        if (!data || typeof data !== "object") return {};

        let result = data;

        for (let i = 0; i < 4; i++) {
            if (
                result.data &&
                typeof result.data === "object" &&
                !Array.isArray(result.data)
            ) {
                result = result.data;
            } else {
                break;
            }
        }

        return result;
    }

    function formatCurrency(value, currency = "INR") {
        const number = safeNumber(value);

        if (number === null) return "—";

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

        if (number === null) return "—";

        return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function dateValue(value) {
        if (!value) return 0;

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? 0
            : date.getTime();
    }

    function getDurationLabel(value) {
        if (value === null || value === undefined || value === "") {
            return "—";
        }

        const number = safeNumber(value);

        if (number !== null) {
            return `${number} ${number === 1 ? "day" : "days"}`;
        }

        const text = String(value).trim();

        const labels = {
            "1d": "1 day",
            "7d": "7 days",
            "30d": "30 days",
            "1mo": "1 month",
            "3mo": "3 months",
            "6mo": "6 months",
            "1y": "1 year"
        };

        return labels[text.toLowerCase()] || text;
    }

    // ---------------------------------------------------------
    // AI MODEL NAME NORMALIZATION
    // ---------------------------------------------------------

    function normalizeModelName(value) {
        if (value && typeof value === "object") {
            value = firstValue([value], [
                "model_name",
                "modelName",
                "name",
                "type",
                "algorithm",
                "label"
            ]);
        }

        if (value === null || value === undefined || value === "") {
            return "Not recorded";
        }

        const original = String(value).trim();

        if (!original) {
            return "Not recorded";
        }

        const key = original
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const modelLabels = {
            "random forest": "Random Forest",
            "randomforest": "Random Forest",
            "rf": "Random Forest",

            "linear regression": "Linear Regression",
            "linearregression": "Linear Regression",
            "linear": "Linear Regression",

            "lstm transformer": "LSTM + Transformer",
            "lstm + transformer": "LSTM + Transformer",
            "lstm and transformer": "LSTM + Transformer",
            "lstm transformer encoder": "LSTM + Transformer",
            "lstm with transformer": "LSTM + Transformer",

            "lstm": "LSTM",
            "transformer": "Transformer"
        };

        return modelLabels[key] || original;
    }

    // ---------------------------------------------------------
    // HTTP / API
    // ---------------------------------------------------------

    async function requestJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        if (response.status === 401) {
            window.location.assign("/login");
            throw new Error("Your session has expired. Please log in again.");
        }

        const contentType = response.headers.get("content-type") || "";

        let data;

        if (contentType.includes("application/json")) {
            data = await response.json();
        } else {
            const responseText = await response.text();

            data = {
                message: responseText.slice(0, 300)
            };
        }

        if (!response.ok || data.success === false) {
            throw new Error(
                data.message ||
                data.error ||
                `Request failed (${response.status}).`
            );
        }

        return data;
    }

    function extractRecords(data) {
        if (Array.isArray(data)) return data;

        if (!data || typeof data !== "object") return [];

        const containers = [
            data,
            data.data,
            data.history,
            data.predictions,
            data.records
        ];

        for (const container of containers) {
            if (!container || typeof container !== "object") continue;

            if (Array.isArray(container)) {
                return container;
            }

            for (const key of [
                "history",
                "predictions",
                "records",
                "results",
                "items"
            ]) {
                if (Array.isArray(container[key])) {
                    return container[key];
                }
            }
        }

        return [];
    }

    // ---------------------------------------------------------
    // STATUS NORMALIZATION
    // ---------------------------------------------------------

    function normalizeStatus(value) {
        const status = String(value || "pending")
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_");

        if ([
            "complete",
            "completed",
            "success",
            "successful",
            "withdrawn",
            "closed"
        ].includes(status)) {
            return "completed";
        }

        if ([
            "target_reached",
            "price_reached",
            "withdrawal_available"
        ].includes(status)) {
            return "target_reached";
        }

        if ([
            "active",
            "running",
            "monitoring",
            "in_progress"
        ].includes(status)) {
            return "monitoring";
        }

        if (["cancelled", "canceled"].includes(status)) {
            return "cancelled";
        }

        if (["failed", "error"].includes(status)) {
            return "failed";
        }

        return "pending";
    }

    // ---------------------------------------------------------
    // NORMALIZE BACKEND RECORD
    // ---------------------------------------------------------

    function normalizeRecord(record, index) {
        record = record || {};

        const asset = record.asset &&
            typeof record.asset === "object"
            ? record.asset
            : {};

        const prediction = record.prediction &&
            typeof record.prediction === "object"
            ? record.prediction
            : {};

        const outcome = record.outcome &&
            typeof record.outcome === "object"
            ? record.outcome
            : {};

        const metadata = parseMetadata(record);

        const modelObject = record.model &&
            typeof record.model === "object"
            ? record.model
            : {};

        const modelInfo = record.model_info &&
            typeof record.model_info === "object"
            ? record.model_info
            : record.model_details &&
                typeof record.model_details === "object"
                ? record.model_details
                : {};

        const objects = [
            record,
            prediction,
            outcome,
            asset,
            metadata,
            modelObject,
            modelInfo
        ];

        const symbol = firstValue(objects, [
            "symbol",
            "ticker",
            "asset_symbol",
            "assetSymbol"
        ]);

        const name = firstValue(objects, [
            "company_name",
            "companyName",
            "asset_name",
            "assetName",
            "name"
        ]);

        // Read the selected model from the actual prediction record.
        // Supports multiple API naming conventions and nested objects.
        const modelValue = firstValue(objects, [
            "model_name",
            "modelName",
            "model_type",
            "modelType",
            "algorithm_name",
            "algorithmName",
            "algorithm",
            "selected_model",
            "selectedModel",
            "model_used",
            "modelUsed",
            "forecast_model",
            "forecastModel",
            "prediction_model",
            "predictionModel"
        ]);

        const modelName = normalizeModelName(
            modelValue !== null
                ? modelValue
                : typeof record.model === "string"
                    ? record.model
                    : null
        );

        const entryPrice = safeNumber(firstValue(objects, [
            "entry_price",
            "entryPrice",
            "reference_price",
            "referencePrice",
            "buy_price",
            "buyPrice"
        ]));

        const predictedPrice = safeNumber(firstValue(objects, [
            "predicted_price",
            "predictedPrice",
            "target_price",
            "targetPrice",
            "future_price",
            "futurePrice",
            "forecast_price"
        ]));

        const currentPrice = safeNumber(firstValue(objects, [
            "current_price",
            "currentPrice",
            "latest_price",
            "latestPrice",
            "last_observed_price",
            "lastObservedPrice",
            "market_price",
            "marketPrice"
        ]));

        const actualExitPrice = safeNumber(firstValue(objects, [
            "actual_withdrawal_price",
            "actualWithdrawalPrice",
            "actual_exit_price",
            "actualExitPrice",
            "withdrawal_price",
            "withdrawalPrice",
            "sell_price",
            "sellPrice",
            "exit_price",
            "exitPrice"
        ]));

        const profitLoss = safeNumber(firstValue(objects, [
            "actual_profit_loss",
            "actualProfitLoss",
            "realized_profit_loss",
            "realizedProfitLoss",
            "profit_loss",
            "profitLoss",
            "pnl"
        ]));

        const returnPercent = safeNumber(firstValue(objects, [
            "actual_return_percent",
            "actualReturnPercent",
            "realized_return_percent",
            "realizedReturnPercent",
            "return_percent",
            "returnPercent"
        ]));

        const createdAt = firstValue(objects, [
            "created_at",
            "createdAt",
            "prediction_date",
            "predictionDate",
            "timestamp",
            "date"
        ]);

        const completedAt = firstValue(objects, [
            "withdrawal_date",
            "withdrawalDate",
            "completed_at",
            "completedAt",
            "sell_date",
            "sellDate"
        ]);

        const duration = firstValue(objects, [
            "horizon_days",
            "horizonDays",
            "duration_days",
            "durationDays",
            "duration",
            "horizon"
        ]);

        const id = firstValue(objects, [
            "id",
            "prediction_id",
            "predictionId",
            "record_id",
            "recordId"
        ]);

        const status = normalizeStatus(firstValue(objects, [
            "status",
            "prediction_status",
            "predictionStatus"
        ]));

        const currency = firstValue(objects, [
            "currency",
            "currency_code",
            "currencyCode"
        ]) || "INR";

        return {
            id: id === null ? `record-${index}` : String(id),
            symbol: String(symbol || "Unknown").toUpperCase(),
            name: String(name || ""),
            modelName,
            entryPrice,
            predictedPrice,
            currentPrice,
            actualExitPrice,
            profitLoss,
            returnPercent,
            createdAt,
            completedAt,
            duration,
            status,
            currency: String(currency).toUpperCase(),

            targetDate: firstValue(objects, [
                "target_date",
                "targetDate"
            ]),

            targetReachedAt: firstValue(objects, [
                "target_reached_at",
                "targetReachedAt"
            ]),

            cancelledAt: firstValue(objects, [
                "cancelled_at",
                "cancelledAt"
            ]),

            confidenceScore: safeNumber(firstValue(objects, [
                "confidence_score",
                "confidenceScore"
            ])),

            metadata
        };
    }

    // ---------------------------------------------------------
    // LOAD HISTORY
    // ---------------------------------------------------------

    async function fetchHistory() {
        const data = await requestJSON(API.history);
        return extractRecords(data);
    }

    // ---------------------------------------------------------
    // INVESTMENT SUMMARY
    // ---------------------------------------------------------

    async function loadInvestmentSummary() {
        if (!elements.totalProfitLoss) return;

        try {
            const response = await requestJSON(API.investments);
            const data = unwrapData(response);

            const summary = data.summary &&
                typeof data.summary === "object"
                ? data.summary
                : {};

            const portfolio = data.portfolio &&
                typeof data.portfolio === "object"
                ? data.portfolio
                : {};

            const totalPL = safeNumber(firstValue(
                [data, summary, portfolio],
                [
                    "total_realized_profit_loss",
                    "totalRealizedProfitLoss",
                    "realized_profit_loss",
                    "realizedProfitLoss",
                    "total_profit_loss",
                    "totalProfitLoss",
                    "total_pnl",
                    "totalPnl"
                ]
            ));

            if (totalPL === null) {
                elements.totalProfitLoss.textContent = "Not recorded";

                elements.totalProfitLoss.classList.remove(
                    "history-positive",
                    "history-negative"
                );

                return;
            }

            elements.totalProfitLoss.textContent =
                formatCurrency(totalPL);

            elements.totalProfitLoss.classList.toggle(
                "history-positive",
                totalPL > 0
            );

            elements.totalProfitLoss.classList.toggle(
                "history-negative",
                totalPL < 0
            );

        } catch (error) {
            console.error(
                "Investment summary could not be loaded:",
                error
            );

            elements.totalProfitLoss.textContent = "Not available";
        }
    }

    // ---------------------------------------------------------
    // PERFORMANCE SUMMARY
    // ---------------------------------------------------------

    function calculatePredictionPerformance(records) {
        const completed = records.filter(record =>
            record.status === "completed"
        );

        const recordsWithPL = completed.filter(record =>
            record.profitLoss !== null
        );

        const wins = recordsWithPL.filter(record =>
            record.profitLoss > 0
        );

        const recordsWithReturn = completed.filter(record =>
            record.returnPercent !== null
        );

        const averageReturn = recordsWithReturn.length
            ? recordsWithReturn.reduce(
                (sum, record) => sum + record.returnPercent,
                0
            ) / recordsWithReturn.length
            : null;

        if (elements.totalCount) {
            elements.totalCount.textContent =
                records.length.toLocaleString("en-IN");
        }

        if (elements.winRate) {
            elements.winRate.textContent = recordsWithPL.length
                ? `${(
                    wins.length / recordsWithPL.length * 100
                ).toFixed(1)}%`
                : "Not available";
        }

        if (elements.averageReturn) {
            elements.averageReturn.textContent =
                averageReturn === null
                    ? "Not available"
                    : formatPercent(averageReturn);

            elements.averageReturn.classList.toggle(
                "history-positive",
                averageReturn !== null && averageReturn > 0
            );

            elements.averageReturn.classList.toggle(
                "history-negative",
                averageReturn !== null && averageReturn < 0
            );
        }
    }

    // ---------------------------------------------------------
    // DOM HELPERS
    // ---------------------------------------------------------

    function createCell(value, className = "") {
        const cell = document.createElement("td");
        cell.textContent = value;

        if (className) {
            cell.className = className;
        }

        return cell;
    }

    function createAssetCell(record) {
        const cell = document.createElement("td");

        const wrapper = document.createElement("div");
        wrapper.className = "history-asset";

        const icon = document.createElement("span");
        icon.className = "history-asset-icon";

        icon.textContent = record.symbol === "UNKNOWN"
            ? "?"
            : record.symbol
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 2);

        const identity = document.createElement("div");

        const symbol = document.createElement("span");
        symbol.className = "history-asset-symbol";
        symbol.textContent = record.symbol;

        const name = document.createElement("span");
        name.className = "history-asset-name";
        name.textContent = record.name || "Asset";

        identity.append(symbol, name);
        wrapper.append(icon, identity);
        cell.appendChild(wrapper);

        return cell;
    }

    // ---------------------------------------------------------
    // AI MODEL TABLE CELL
    // ---------------------------------------------------------

    function createModelCell(record) {
        const cell = document.createElement("td");
        cell.className = "history-model-cell";

        const badge = document.createElement("span");
        badge.className = "history-model-badge";
        badge.textContent = record.modelName || "Not recorded";

        if (badge.textContent === "Not recorded") {
            badge.classList.add("history-model-unavailable");
        }

        cell.appendChild(badge);

        return cell;
    }

    function createStatusBadge(status) {
        const badge = document.createElement("span");

        badge.className = `history-badge history-badge-${status}`;

        const labels = {
            pending: "Pending",
            monitoring: "Monitoring",
            target_reached: "Target reached",
            completed: "Completed",
            cancelled: "Cancelled",
            failed: "Failed"
        };

        badge.textContent = labels[status] || "Pending";

        return badge;
    }

    function createAssetLink(record) {
        const link = document.createElement("a");

        link.className = "history-row-action";
        link.textContent = "View Asset";

        link.href = record.symbol && record.symbol !== "UNKNOWN"
            ? `/stock/${encodeURIComponent(record.symbol)}`
            : "/stock-search";

        return link;
    }

    // ---------------------------------------------------------
    // PENDING / ACTIVE HISTORY TABLE
    // ---------------------------------------------------------

    function renderPendingTable(records) {
        if (!elements.table) return;

        elements.table.replaceChildren();

        if (!records.length) {
            const row = document.createElement("tr");

            const cell = createCell(
                "No predictions match your filters.",
                "history-muted-value"
            );

            cell.colSpan = 9;
            row.appendChild(cell);
            elements.table.appendChild(row);

            return;
        }

        records.forEach(record => {
            const row = document.createElement("tr");

            // Asset
            row.appendChild(createAssetCell(record));

            // AI Model
            row.appendChild(createModelCell(record));

            // Created
            row.appendChild(createCell(formatDate(record.createdAt)));

            // Duration
            row.appendChild(createCell(getDurationLabel(record.duration)));

            // Entry Price
            row.appendChild(
                createCell(formatCurrency(
                    record.entryPrice,
                    record.currency
                ))
            );

            // Predicted Price
            row.appendChild(
                createCell(formatCurrency(
                    record.predictedPrice,
                    record.currency
                ))
            );

            // Current Price
            const quote = quoteCache.get(record.symbol);
            const currentPrice = quote?.price ?? record.currentPrice;

            row.appendChild(
                createCell(
                    currentPrice === null
                        ? "Unavailable"
                        : formatCurrency(currentPrice, record.currency),
                    currentPrice === null
                        ? "history-muted-value"
                        : ""
                )
            );

            // Status
            const statusCell = document.createElement("td");
            statusCell.appendChild(createStatusBadge(record.status));
            row.appendChild(statusCell);

            // Action
            const actionCell = document.createElement("td");
            actionCell.appendChild(createAssetLink(record));
            row.appendChild(actionCell);

            elements.table.appendChild(row);
        });
    }

    // ---------------------------------------------------------
    // COMPLETED PREDICTIONS TABLE
    // ---------------------------------------------------------

    function renderCompletedTable() {
        if (!elements.completedTable) return;

        elements.completedTable.replaceChildren();

        completedRecords = allRecords
            .filter(record => record.status === "completed")
            .sort((a, b) =>
                dateValue(b.completedAt || b.createdAt) -
                dateValue(a.completedAt || a.createdAt)
            );

        if (elements.completedCount) {
            elements.completedCount.textContent =
                `${completedRecords.length} completed`;
        }

        if (elements.completedEmpty) {
            elements.completedEmpty.hidden =
                completedRecords.length > 0;
        }

        if (elements.completedTableContainer) {
            elements.completedTableContainer.hidden =
                completedRecords.length === 0;
        }

        if (elements.completedSection) {
            elements.completedSection.hidden = false;
        }

        completedRecords.forEach(record => {
            const row = document.createElement("tr");

            // Asset
            row.appendChild(createAssetCell(record));

            // AI Model
            row.appendChild(createModelCell(record));

            // Created
            row.appendChild(createCell(formatDate(record.createdAt)));

            // Duration
            row.appendChild(createCell(getDurationLabel(record.duration)));

            // Entry Price
            row.appendChild(
                createCell(formatCurrency(
                    record.entryPrice,
                    record.currency
                ))
            );

            // Predicted Target
            row.appendChild(
                createCell(formatCurrency(
                    record.predictedPrice,
                    record.currency
                ))
            );

            // Actual Exit Price
            row.appendChild(
                createCell(formatCurrency(
                    record.actualExitPrice,
                    record.currency
                ))
            );

            // Completed On
            row.appendChild(
                createCell(formatDate(record.completedAt))
            );

            // Outcome
            const outcomeCell = document.createElement("td");

            if (record.profitLoss === null) {
                outcomeCell.textContent = "Outcome not recorded";
                outcomeCell.className = "history-muted-value";
            } else {
                const outcome = document.createElement("span");

                outcome.className = record.profitLoss > 0
                    ? "history-badge history-badge-completed"
                    : record.profitLoss < 0
                        ? "history-badge history-badge-failed"
                        : "history-badge history-badge-neutral";

                outcome.textContent = record.profitLoss > 0
                    ? "Profit"
                    : record.profitLoss < 0
                        ? "Loss"
                        : "Break-even";

                outcomeCell.appendChild(outcome);
            }

            row.appendChild(outcomeCell);
            elements.completedTable.appendChild(row);
        });
    }

    // ---------------------------------------------------------
    // FILTERS AND SORTING
    // ---------------------------------------------------------

    function applyFilters() {
        const query = (elements.search?.value || "")
            .trim()
            .toLowerCase();

        const selectedStatus = elements.status?.value || "all";
        const selectedPeriod = elements.period?.value || "all";
        const selectedSort = elements.sort?.value || "newest";

        let records = allRecords.filter(record =>
            record.status !== "completed"
        );

        if (query) {
            records = records.filter(record =>
                record.symbol.toLowerCase().includes(query) ||
                record.name.toLowerCase().includes(query)
            );
        }

        if (selectedStatus !== "all") {
            records = records.filter(record => {
                if (selectedStatus === "monitoring") {
                    return [
                        "pending",
                        "monitoring"
                    ].includes(record.status);
                }

                return record.status === selectedStatus;
            });
        }

        if (selectedPeriod !== "all") {
            const days = Number(selectedPeriod);
            const cutoff = Date.now() -
                days * 24 * 60 * 60 * 1000;

            records = records.filter(record => {
                const timestamp = dateValue(record.createdAt);

                return timestamp > 0 && timestamp >= cutoff;
            });
        }

        if (selectedSort === "oldest") {
            records.sort((a, b) =>
                dateValue(a.createdAt) - dateValue(b.createdAt)
            );
        } else if (selectedSort === "price_high") {
            records.sort((a, b) =>
                (b.predictedPrice ?? -Infinity) -
                (a.predictedPrice ?? -Infinity)
            );
        } else if (selectedSort === "price_low") {
            records.sort((a, b) =>
                (a.predictedPrice ?? Infinity) -
                (b.predictedPrice ?? Infinity)
            );
        } else {
            records.sort((a, b) =>
                dateValue(b.createdAt) - dateValue(a.createdAt)
            );
        }

        filteredRecords = records;
        currentPage = 1;

        renderCurrentPage();
    }

    // ---------------------------------------------------------
    // PAGINATION AND TABLE DISPLAY
    // ---------------------------------------------------------

    function renderCurrentPage() {
        const total = filteredRecords.length;

        const totalPages = Math.max(
            1,
            Math.ceil(total / PAGE_SIZE)
        );

        currentPage = Math.min(currentPage, totalPages);

        const start = (currentPage - 1) * PAGE_SIZE;

        const pageRecords = filteredRecords.slice(
            start,
            start + PAGE_SIZE
        );

        if (elements.resultCount) {
            elements.resultCount.textContent =
                `${total} record${total === 1 ? "" : "s"}`;
        }

        const hasRecords = total > 0;

        if (elements.tableContainer) {
            elements.tableContainer.hidden = !hasRecords;
        }

        if (elements.empty) {
            elements.empty.hidden = hasRecords;
        }

        if (
            !hasRecords &&
            elements.emptyTitle &&
            elements.emptyDescription
        ) {
            const hasAnyPending = allRecords.some(record =>
                record.status !== "completed"
            );

            elements.emptyTitle.textContent = hasAnyPending
                ? "No matching predictions"
                : "No pending predictions";

            elements.emptyDescription.textContent = hasAnyPending
                ? "Try changing your search or filter options."
                : "New predictions will appear here while they are being monitored.";
        }

        renderPendingTable(pageRecords);

        const showPagination = total > PAGE_SIZE;

        if (elements.pagination) {
            elements.pagination.hidden = !showPagination;
        }

        if (elements.pageIndicator) {
            elements.pageIndicator.textContent =
                `Page ${currentPage} of ${totalPages}`;
        }

        if (elements.previous) {
            elements.previous.disabled = currentPage <= 1;
        }

        if (elements.next) {
            elements.next.disabled = currentPage >= totalPages;
        }
    }

    // ---------------------------------------------------------
    // CURRENT MARKET PRICE
    // ---------------------------------------------------------

    function extractQuotePrice(response) {
        const data = unwrapData(response);

        const quote = data.quote &&
            typeof data.quote === "object"
            ? data.quote
            : {};

        const stock = data.stock &&
            typeof data.stock === "object"
            ? data.stock
            : {};

        return safeNumber(firstValue(
            [data, quote, stock],
            [
                "current_price",
                "currentPrice",
                "regularMarketPrice",
                "last_price",
                "lastPrice",
                "price",
                "market_price",
                "marketPrice"
            ]
        ));
    }

    async function refreshCurrentPrices() {
        const symbols = [
            ...new Set(
                allRecords
                    .filter(record =>
                        record.status !== "completed" &&
                        record.symbol &&
                        record.symbol !== "UNKNOWN"
                    )
                    .map(record => record.symbol)
            )
        ];

        await Promise.allSettled(
            symbols.map(async symbol => {
                const response = await requestJSON(API.stock(symbol));
                const price = extractQuotePrice(response);

                if (price !== null) {
                    quoteCache.set(symbol, {
                        price,
                        updatedAt: Date.now()
                    });
                }
            })
        );

        renderCurrentPage();
    }

    function startQuoteRefresh() {
        if (quoteTimer) {
            clearInterval(quoteTimer);
        }

        quoteTimer = setInterval(() => {
            if (document.visibilityState === "visible") {
                refreshCurrentPrices().catch(error => {
                    console.warn(
                        "Current price refresh failed:",
                        error
                    );
                });
            }
        }, QUOTE_REFRESH_INTERVAL);
    }

    // ---------------------------------------------------------
    // PDF / PRINT EXPORT
    // Includes model names and all prediction records.
    // ---------------------------------------------------------

    function escapeHTML(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            character => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[character]
        );
    }

    function exportPDF() {
        if (!allRecords.length) {
            showMessage(
                "There are no prediction records to export.",
                "error"
            );
            return;
        }

        const records = [...allRecords].sort((a, b) =>
            dateValue(b.createdAt) - dateValue(a.createdAt)
        );

        const completed = records.filter(
            record => record.status === "completed"
        );

        const statusLabels = {
            pending: "Pending",
            monitoring: "Monitoring",
            target_reached: "Target reached",
            completed: "Completed",
            cancelled: "Cancelled",
            failed: "Failed"
        };

        const money = (value, currency) =>
            value === null
                ? "Not recorded"
                : escapeHTML(formatCurrency(value, currency));

        const rows = records.map(record => `
            <tr>
                <td>
                    <strong>${escapeHTML(record.symbol)}</strong>
                    <span class="asset-name">
                        ${escapeHTML(record.name || "Asset")}
                    </span>
                </td>

                <td>
                    ${escapeHTML(record.modelName || "Not recorded")}
                </td>

                <td>
                    ${escapeHTML(formatDate(record.createdAt))}
                    <span class="sub-value">
                        ${escapeHTML(getDurationLabel(record.duration))}
                    </span>
                </td>

                <td>
                    <strong>${money(record.entryPrice, record.currency)}</strong>
                    <span class="sub-value">
                        Target: ${money(record.predictedPrice, record.currency)}
                    </span>
                </td>

                <td>
                    <span class="status status-${escapeHTML(record.status)}">
                        ${escapeHTML(statusLabels[record.status] || "Pending")}
                    </span>
                </td>

                <td>
                    ${money(record.actualExitPrice, record.currency)}
                </td>
            </tr>
        `).join("");

        const generatedAt = new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date());

        const reportHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">

            <title>Market Plus AI - Prediction History</title>

            <style>
                @page {
                    size: A4 landscape;
                    margin: 12mm;
                }

                * {
                    box-sizing: border-box;
                }

                html,
                body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    font-family: Arial, Helvetica, sans-serif;
                    color: #17243a;
                    background: #ffffff;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }

                .report {
                    width: 100%;
                    max-width: 273mm;
                    margin: 0 auto;
                    padding: 0;
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    padding-bottom: 15px;
                    border-bottom: 3px solid #357de8;
                }

                .brand {
                    margin: 0;
                    color: #17345e;
                    font-size: 22px;
                    font-weight: 800;
                }

                .brand-caption {
                    margin-top: 4px;
                    color: #71829b;
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 2px;
                }

                .meta {
                    color: #71829b;
                    font-size: 9px;
                    line-height: 1.7;
                    text-align: right;
                }

                .title {
                    margin: 22px 0 6px;
                    color: #17345e;
                    font-size: 22px;
                }

                .subtitle {
                    margin: 0;
                    color: #71829b;
                    font-size: 10px;
                    line-height: 1.6;
                }

                .summary {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 9px;
                    margin: 20px 0 23px;
                }

                .summary-card {
                    padding: 12px;
                    border: 1px solid #dce6f3;
                    border-radius: 8px;
                    background: #f5f8fd;
                }

                .summary-label {
                    display: block;
                    margin-bottom: 7px;
                    color: #71829b;
                    font-size: 8px;
                    font-weight: 700;
                    text-transform: uppercase;
                }

                .summary-value {
                    color: #173b70;
                    font-size: 19px;
                    font-weight: 800;
                }

                .section-title {
                    margin: 0 0 10px;
                    color: #17345e;
                    font-size: 14px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    font-size: 8px;
                }

                th {
                    padding: 9px 5px;
                    background: #17345e;
                    color: #ffffff;
                    font-size: 7px;
                    text-align: left;
                    text-transform: uppercase;
                }

                td {
                    padding: 9px 5px;
                    border-bottom: 1px solid #e1e8f1;
                    color: #34445d;
                    vertical-align: top;
                    overflow-wrap: anywhere;
                }

                tbody tr:nth-child(even) {
                    background: #f5f8fc;
                }

                tbody tr {
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                .asset-name,
                .sub-value {
                    display: block;
                    margin-top: 4px;
                    color: #71829b;
                    font-size: 7px;
                    line-height: 1.4;
                }

                .status {
                    display: inline-block;
                    padding: 4px 5px;
                    border-radius: 10px;
                    background: #edf2f8;
                    color: #34445d;
                    font-size: 7px;
                    font-weight: 700;
                }

                .status-pending,
                .status-monitoring {
                    background: #fff4d6;
                    color: #916500;
                }

                .status-completed {
                    background: #dff7eb;
                    color: #087a4b;
                }

                .status-target_reached {
                    background: #dceaff;
                    color: #1b58a5;
                }

                .status-cancelled,
                .status-failed {
                    background: #fde8e8;
                    color: #a12e2e;
                }

                .empty-row {
                    padding: 18px;
                    text-align: center;
                    color: #71829b;
                }

                .disclaimer {
                    margin-top: 22px;
                    padding: 12px;
                    border: 1px solid #dce6f3;
                    border-radius: 7px;
                    background: #f5f8fd;
                    color: #64748b;
                    font-size: 8px;
                    line-height: 1.6;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }

                .footer {
                    margin-top: 15px;
                    padding-top: 10px;
                    border-top: 1px solid #dce5f1;
                    color: #8290a5;
                    font-size: 8px;
                    text-align: center;
                }

                @media screen {
                    body {
                        padding: 20px;
                        background: #e9eef6;
                    }

                    .report {
                        max-width: 273mm;
                        min-height: 190mm;
                        padding: 15mm;
                        background: #ffffff;
                        box-shadow: 0 2px 15px rgba(0,0,0,0.08);
                    }
                }

                @media print {
                    html,
                    body {
                        width: 100%;
                        margin: 0;
                        padding: 0;
                        background: #ffffff;
                    }

                    .report {
                        width: 100%;
                        max-width: none;
                        min-height: 0;
                        margin: 0;
                        padding: 0;
                        box-shadow: none;
                    }

                    thead {
                        display: table-header-group;
                    }

                    tr {
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                }
            </style>
        </head>

        <body>
            <main class="report">

                <header class="header">
                    <div>
                        <h1 class="brand">Market Plus AI</h1>
                        <div class="brand-caption">AI INTELLIGENCE</div>
                    </div>

                    <div class="meta">
                        <strong>Prediction History Report</strong><br>
                        Generated: ${escapeHTML(generatedAt)}<br>
                        Report: Complete History
                    </div>
                </header>

                <h2 class="title">Your Prediction History</h2>

                <p class="subtitle">
                    A summary of saved AI predictions, the models used
                    and their recorded outcomes.
                </p>

                <section class="summary">
                    <div class="summary-card">
                        <span class="summary-label">Total Predictions</span>
                        <strong class="summary-value">${records.length}</strong>
                    </div>

                    <div class="summary-card">
                        <span class="summary-label">Completed</span>
                        <strong class="summary-value">${completed.length}</strong>
                    </div>

                    <div class="summary-card">
                        <span class="summary-label">Pending / Other</span>
                        <strong class="summary-value">${records.length - completed.length}</strong>
                    </div>
                </section>

                <section>
                    <h3 class="section-title">All Prediction Records</h3>

                    <table>
                        <colgroup>
                            <col style="width:15%">
                            <col style="width:17%">
                            <col style="width:15%">
                            <col style="width:22%">
                            <col style="width:14%">
                            <col style="width:17%">
                        </colgroup>

                        <thead>
                            <tr>
                                <th>Asset</th>
                                <th>AI Model</th>
                                <th>Created / Duration</th>
                                <th>Entry / Target Price</th>
                                <th>Status</th>
                                <th>Actual Exit</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${rows || `
                                <tr>
                                    <td colspan="6" class="empty-row">
                                        No prediction records available.
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </section>

                <section class="disclaimer">
                    <strong>Important Disclaimer:</strong>
                    AI predictions are estimates and do not guarantee future
                    stock prices or profits. A target being reached does not
                    automatically mean a trade or withdrawal has occurred.
                    Actual outcomes must be recorded separately.
                </section>

                <footer class="footer">
                    Market Plus AI - AI-Based Intelligent Stock and Asset Prediction System
                </footer>

            </main>

            <script>
                window.onload = function () {
                    window.focus();
                    window.print();
                };
            <\/script>
        </body>
        </html>
        `;

        const printWindow = window.open("", "_blank");

        if (!printWindow) {
            showMessage(
                "The report window was blocked. Allow pop-ups and try again.",
                "error"
            );
            return;
        }

        printWindow.document.open();
        printWindow.document.write(reportHTML);
        printWindow.document.close();

        showMessage(
            "Prediction report opened. Choose Save as PDF.",
            "success"
        );
    }

    // ---------------------------------------------------------
    // LOADING
    // ---------------------------------------------------------

    function setLoading(value) {
        loading = value;

        if (elements.loading) {
            elements.loading.hidden = !value;
        }

        if (elements.refresh) {
            elements.refresh.disabled = value;
        }

        if (value) {
            if (elements.tableContainer) {
                elements.tableContainer.hidden = true;
            }

            if (elements.empty) {
                elements.empty.hidden = true;
            }

            if (elements.pagination) {
                elements.pagination.hidden = true;
            }
        }
    }

    // ---------------------------------------------------------
    // MAIN HISTORY LOADER
    // ---------------------------------------------------------

    async function loadHistory() {
        if (loading) return;

        setLoading(true);
        showMessage("");

        try {
            const [historyResult] = await Promise.all([
                fetchHistory(),
                loadInvestmentSummary()
            ]);

            allRecords = historyResult.map((record, index) =>
                normalizeRecord(record, index)
            );

            calculatePredictionPerformance(allRecords);

            renderCompletedTable();
            applyFilters();

            await refreshCurrentPrices();

            if (!allRecords.length) {
                showMessage(
                    "No saved prediction records were returned by the server."
                );
            }

        } catch (error) {
            console.error(
                "[Market Plus AI] Prediction history error:",
                error
            );

            allRecords = [];
            filteredRecords = [];
            completedRecords = [];

            calculatePredictionPerformance([]);
            renderCompletedTable();
            renderCurrentPage();

            showMessage(
                error.message || "Unable to load prediction history.",
                "error"
            );

        } finally {
            setLoading(false);
        }
    }

    // ---------------------------------------------------------
    // DATE AND PROFILE AVATAR
    // ---------------------------------------------------------

    function initializeDate() {
        if (elements.pageDate) {
            elements.pageDate.textContent =
                new Intl.DateTimeFormat("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }).format(new Date());
        }
    }

    async function loadProfileAvatar() {
        if (!elements.avatar) return;

        try {
            const response = await requestJSON("/api/profile");
            const data = unwrapData(response);

            const user = data.user &&
                typeof data.user === "object"
                ? data.user
                : data;

            const name = String(
                user.name || user.full_name || ""
            ).trim();

            if (name) {
                elements.avatar.textContent = name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map(part => part.charAt(0).toUpperCase())
                    .join("");
            }

        } catch (error) {
            console.warn(
                "Profile avatar could not be loaded:",
                error
            );
        }
    }

    // ---------------------------------------------------------
    // MOBILE SIDEBAR
    // ---------------------------------------------------------

    function openSidebar() {
        document.body.classList.add("sidebar-open");

        elements.sidebar?.classList.add("sidebar-open");

        elements.menu?.setAttribute("aria-expanded", "true");

        if (elements.overlay) {
            elements.overlay.hidden = false;
        }
    }

    function closeSidebar() {
        document.body.classList.remove("sidebar-open");

        elements.sidebar?.classList.remove("sidebar-open");

        elements.menu?.setAttribute("aria-expanded", "false");

        if (elements.overlay) {
            elements.overlay.hidden = true;
        }
    }

    // ---------------------------------------------------------
    // EVENT LISTENERS
    // ---------------------------------------------------------

    elements.search?.addEventListener("input", applyFilters);
    elements.status?.addEventListener("change", applyFilters);
    elements.period?.addEventListener("change", applyFilters);
    elements.sort?.addEventListener("change", applyFilters);

    elements.refresh?.addEventListener("click", loadHistory);
    elements.export?.addEventListener("click", exportPDF);

    elements.previous?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
        }
    });

    elements.next?.addEventListener("click", () => {
        const totalPages = Math.ceil(
            filteredRecords.length / PAGE_SIZE
        );

        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
        }
    });

    elements.menu?.addEventListener("click", () => {
        const isOpen =
            elements.menu.getAttribute("aria-expanded") === "true";

        if (isOpen) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    elements.overlay?.addEventListener("click", closeSidebar);

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSidebar();
        }
    });

    elements.logout?.addEventListener("click", async () => {
        try {
            await requestJSON("/api/auth/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({})
            });
        } catch (error) {
            console.warn(
                "Logout request could not be confirmed:",
                error
            );
        } finally {
            window.location.assign("/login");
        }
    });

    // ---------------------------------------------------------
    // INITIALIZATION
    // ---------------------------------------------------------

    initializeDate();
    loadProfileAvatar();
    loadHistory();
    startQuoteRefresh();

    window.addEventListener("beforeunload", () => {
        if (quoteTimer) {
            clearInterval(quoteTimer);
        }
    });
});
