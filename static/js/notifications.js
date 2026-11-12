
/* =========================================================
   MARKET PLUS AI — NOTIFICATIONS & UPDATES
   File: static/js/notifications.js
   Version: 1.0.0

   Features:
   - Backend-powered notifications
   - Unread notification count
   - All / unread / price alert / updates filters
   - Mark one notification as read
   - Mark all notifications as read
   - Pagination
   - Email and SMS delivery statuses
   - Safe DOM rendering
   - No fabricated announcements or delivery statuses
========================================================= */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const PAGE_SIZE = 10;

    const elements = {
        refreshButton: document.getElementById("refreshNotificationsButton"),
        markAllButton: document.getElementById("markAllReadButton"),

        totalCount: document.getElementById("totalNotificationsCount"),
        unreadCount: document.getElementById("unreadNotificationsCount"),
        emailCount: document.getElementById("emailNotificationsCount"),

        status: document.getElementById("notificationsStatus"),
        loading: document.getElementById("notificationsLoading"),
        empty: document.getElementById("notificationsEmpty"),
        emptyTitle: document.getElementById("notificationsEmptyTitle"),
        emptyMessage: document.getElementById("notificationsEmptyMessage"),
        list: document.getElementById("notificationsList"),

        pagination: document.getElementById("notificationsPagination"),
        previousButton: document.getElementById("previousNotificationsButton"),
        nextButton: document.getElementById("nextNotificationsButton"),
        pageInfo: document.getElementById("notificationsPageInfo"),

        sidebarNotificationCount:
            document.getElementById("sidebarNotificationCount"),

        topbarNotificationCount:
            document.getElementById("topbarNotificationCount"),

        sidebarAlertCount:
            document.getElementById("sidebarAlertCount"),

        sidebarUserName:
            document.getElementById("sidebarUserName"),

        sidebarUserAvatar:
            document.getElementById("sidebarUserAvatar"),

        logoutButton:
            document.getElementById("logoutButton"),

        sidebar:
            document.getElementById("sidebar"),

        mobileMenuButton:
            document.getElementById("mobileMenuButton"),

        sidebarOverlay:
            document.getElementById("sidebarOverlay")
    };

    const state = {
        notifications: [],
        filter: "all",
        page: 1,
        totalCount: 0,
        unreadCount: 0,
        loading: false,
        markingRead: new Set()
    };

    /* -----------------------------------------------------
       HELPERS
    ----------------------------------------------------- */

    function safeNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            character => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[character]
        );
    }

    function setText(element, value) {
        if (element) {
            element.textContent = String(value ?? "");
        }
    }

    function showStatus(message, type = "info") {
        if (!elements.status) return;

        elements.status.textContent = message;
        elements.status.className =
            `notifications-status visible ${type}`;

        window.clearTimeout(showStatus.timeout);

        showStatus.timeout = window.setTimeout(() => {
            elements.status.className = "notifications-status";
        }, 5000);
    }

    function setLoading(loading) {
        state.loading = loading;

        if (elements.loading) {
            elements.loading.classList.toggle("visible", loading);
        }

        if (elements.refreshButton) {
            elements.refreshButton.disabled = loading;
        }

        if (elements.markAllButton) {
            elements.markAllButton.disabled =
                loading || state.unreadCount === 0;
        }
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                "Accept": "application/json",
                ...(options.headers || {})
            }
        });

        let result;

        try {
            result = await response.json();
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (response.status === 401) {
            window.location.href = "/login";
            throw new Error("Your session has expired. Please log in again.");
        }

        if (!response.ok || result.success === false) {
            throw new Error(
                result.message ||
                result.error ||
                `Request failed (${response.status}).`
            );
        }

        return result;
    }

    function extractData(result) {
        return result?.data && typeof result.data === "object"
            ? result.data
            : result;
    }

    function getNotificationType(notification) {
        const rawType = String(
            notification.notification_type ||
            notification.type ||
            ""
        ).toLowerCase();

        if (
            rawType.includes("alert") ||
            notification.alert_id
        ) {
            return "price_alert";
        }

        if (
            rawType.includes("update") ||
            rawType.includes("announcement")
        ) {
            return "updates";
        }

        return "other";
    }

    function isUnread(notification) {
        return (
            notification.is_read === false ||
            notification.is_read === 0 ||
            notification.is_read === "0"
        );
    }

    function formatDate(value) {
        if (!value) return "Date unavailable";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "Date unavailable";
        }

        return new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function getDeliveryStatus(value) {
        const status = String(value || "not_configured")
            .trim()
            .toLowerCase();

        const allowed = [
            "sent",
            "failed",
            "pending",
            "not_configured"
        ];

        return allowed.includes(status)
            ? status
            : "not_configured";
    }

    function deliveryLabel(status) {
        const labels = {
            sent: "Accepted by SMTP server",
            failed: "Failed",
            pending: "Pending",
            not_configured: "Not configured"
        };

        return labels[status] || "Not configured";
    }

    function getEmailStatus(notification) {
        return getDeliveryStatus(
            notification.email_delivery_status ||
            notification.delivery_status
        );
    }

    function getSmsStatus(notification) {
        return getDeliveryStatus(
            notification.sms_delivery_status
        );
    }

    function updateUnreadBadges(count) {
        const unread = Math.max(0, safeNumber(count));

        const badges = [
            elements.sidebarNotificationCount,
            elements.topbarNotificationCount
        ];

        badges.forEach(badge => {
            if (!badge) return;

            badge.textContent = unread > 99 ? "99+" : String(unread);
            badge.classList.toggle("visible", unread > 0);
            badge.setAttribute(
                "aria-label",
                `${unread} unread notifications`
            );
        });
    }

    /* -----------------------------------------------------
       SIDEBAR ACCOUNT INFORMATION
    ----------------------------------------------------- */

    async function loadDashboardSummary() {
        try {
            const result = await apiRequest("/api/dashboard");
            const data = extractData(result);

            const user = data.user || {};

            const name =
                user.name ||
                user.full_name ||
                data.user_name ||
                "User";

            if (elements.sidebarUserName) {
                elements.sidebarUserName.textContent = name;
            }

            if (elements.sidebarUserAvatar) {
                elements.sidebarUserAvatar.textContent =
                    name.trim().charAt(0).toUpperCase() || "U";
            }

            const activeAlerts = safeNumber(
                data.active_alerts ??
                data.active_alert_count ??
                data.alert_count
            );

            if (elements.sidebarAlertCount) {
                elements.sidebarAlertCount.textContent =
                    activeAlerts > 99 ? "99+" : String(activeAlerts);

                elements.sidebarAlertCount.style.display =
                    activeAlerts > 0 ? "inline-flex" : "none";
            }

            const unread = safeNumber(
                data.unread_notifications ??
                data.unread_notification_count
            );

            state.unreadCount = unread;
            updateUnreadBadges(unread);
            updateSummaryCards();
        } catch (error) {
            console.warn(
                "Could not load dashboard notification summary:",
                error.message
            );
        }
    }

    /* -----------------------------------------------------
       FILTERING
    ----------------------------------------------------- */

    function getFilteredNotifications() {
        return state.notifications.filter(notification => {
            if (state.filter === "unread") {
                return isUnread(notification);
            }

            if (state.filter === "price_alert") {
                return getNotificationType(notification) === "price_alert";
            }

            if (state.filter === "updates") {
                return getNotificationType(notification) === "updates";
            }

            return true;
        });
    }

    function updateFilterButtons() {
        document.querySelectorAll("[data-filter]").forEach(button => {
            const active =
                button.dataset.filter === state.filter;

            button.classList.toggle("active", active);
            button.setAttribute(
                "aria-pressed",
                active ? "true" : "false"
            );
        });
    }

    /* -----------------------------------------------------
       SUMMARY CARDS
    ----------------------------------------------------- */

    function updateSummaryCards() {
        setText(elements.totalCount, state.totalCount);
        setText(elements.unreadCount, state.unreadCount);

        const emailNotifications = state.notifications.filter(
            notification =>
                notification.email_delivery_status ||
                notification.delivery_status
        ).length;

        setText(elements.emailCount, emailNotifications);

        if (elements.markAllButton) {
            elements.markAllButton.disabled =
                state.loading || state.unreadCount === 0;
        }

        updateUnreadBadges(state.unreadCount);
    }

    /* -----------------------------------------------------
       DELIVERY STATUS HTML
    ----------------------------------------------------- */

    function renderDeliveryStatuses(notification) {
        const emailStatus = getEmailStatus(notification);
        const smsStatus = getSmsStatus(notification);

        return `
            <div class="notification-delivery-statuses">
                <span class="notification-delivery-status ${emailStatus.replace("_", "-")}">
                    <span aria-hidden="true">✉</span>
                    Email: ${escapeHTML(deliveryLabel(emailStatus))}
                </span>

                <span class="notification-delivery-status ${smsStatus.replace("_", "-")}">
                    <span aria-hidden="true">▣</span>
                    SMS: ${escapeHTML(deliveryLabel(smsStatus))}
                </span>
            </div>
        `;
    }

    /* -----------------------------------------------------
       NOTIFICATION ITEM
    ----------------------------------------------------- */

    function renderNotification(notification) {
        const id = safeNumber(notification.id, -1);
        const unread = isUnread(notification);
        const type = getNotificationType(notification);

        const icon =
            type === "price_alert" ? "↗" :
            type === "updates" ? "✦" : "●";

        const iconClass =
            type === "price_alert" ? "price-alert" :
            type === "updates" ? "update" : "";

        const typeLabel =
            type === "price_alert" ? "Price Alert" :
            type === "updates" ? "Application Update" :
            "Notification";

        const title =
            notification.subject ||
            notification.title ||
            "Notification";

        const message =
            notification.message ||
            notification.body ||
            "No message content is available.";

        const date =
            notification.created_at ||
            notification.timestamp;

        const actionButton = unread && id > 0
            ? `
                <button
                    type="button"
                    class="notification-mark-read-button"
                    data-mark-read="${id}"
                    ${state.markingRead.has(id) ? "disabled" : ""}
                >
                    Mark as read
                </button>
            `
            : `
                <span class="notification-read-label">
                    Read
                </span>
            `;

        return `
            <article
                class="notification-item ${unread ? "unread" : ""}"
                data-notification-id="${id}"
            >
                <div class="notification-item-icon ${iconClass}"
                     aria-hidden="true">
                    ${icon}
                </div>

                <div class="notification-item-content">
                    <div class="notification-item-top">
                        <h3 class="notification-item-title">
                            ${escapeHTML(title)}
                        </h3>

                        <time class="notification-item-time">
                            ${escapeHTML(formatDate(date))}
                        </time>
                    </div>

                    <p class="notification-item-message">
                        ${escapeHTML(message)}
                    </p>

                    <div class="notification-item-meta">
                        <span class="notification-type-label">
                            ${escapeHTML(typeLabel)}
                        </span>

                        ${unread ? `
                            <span class="notification-type-label">
                                Unread
                            </span>
                        ` : ""}
                    </div>

                    ${renderDeliveryStatuses(notification)}

                    <div class="notification-item-actions">
                        ${actionButton}
                    </div>
                </div>
            </article>
        `;
    }

    /* -----------------------------------------------------
       EMPTY STATE
    ----------------------------------------------------- */

    function showEmptyState() {
        if (elements.empty) {
            elements.empty.classList.add("visible");
        }

        if (elements.list) {
            elements.list.innerHTML = "";
        }

        const emptyMessages = {
            all: {
                title: "No notifications yet",
                message:
                    "When a price alert is triggered or an application update is available, it will appear here."
            },
            unread: {
                title: "No unread notifications",
                message:
                    "You are all caught up. There are no unread notifications."
            },
            price_alert: {
                title: "No price alert notifications",
                message:
                    "Triggered price alert notifications will appear here."
            },
            updates: {
                title: "No application updates",
                message:
                    "There are no application update notifications available."
            }
        };

        const content =
            emptyMessages[state.filter] || emptyMessages.all;

        setText(elements.emptyTitle, content.title);
        setText(elements.emptyMessage, content.message);
    }

    function hideEmptyState() {
        if (elements.empty) {
            elements.empty.classList.remove("visible");
        }
    }

    /* -----------------------------------------------------
       RENDER LIST
    ----------------------------------------------------- */

    function renderNotifications() {
        if (!elements.list) return;

        const filtered = getFilteredNotifications();

        const totalPages = Math.max(
            1,
            Math.ceil(filtered.length / PAGE_SIZE)
        );

        state.page = Math.min(state.page, totalPages);

        const start = (state.page - 1) * PAGE_SIZE;
        const visible = filtered.slice(start, start + PAGE_SIZE);

        if (visible.length === 0) {
            showEmptyState();

            if (elements.pagination) {
                elements.pagination.classList.remove("visible");
            }

            return;
        }

        hideEmptyState();

        elements.list.innerHTML = visible
            .map(renderNotification)
            .join("");

        const showPagination = totalPages > 1;

        if (elements.pagination) {
            elements.pagination.classList.toggle(
                "visible",
                showPagination
            );
        }

        setText(
            elements.pageInfo,
            `Page ${state.page} of ${totalPages}`
        );

        if (elements.previousButton) {
            elements.previousButton.disabled = state.page <= 1;
        }

        if (elements.nextButton) {
            elements.nextButton.disabled =
                state.page >= totalPages;
        }
    }

    /* -----------------------------------------------------
       LOAD NOTIFICATIONS
    ----------------------------------------------------- */

    async function loadNotifications(showMessage = false) {
        if (state.loading) return;

        setLoading(true);

        try {
            const offset = 0;

            const result = await apiRequest(
                `/api/notifications?limit=100&offset=${offset}&unread_only=false`
            );

            const data = extractData(result);

            const notifications =
                Array.isArray(data.notifications)
                    ? data.notifications
                    : Array.isArray(result.notifications)
                        ? result.notifications
                        : [];

            state.notifications = notifications;

            state.totalCount = safeNumber(
                data.count ??
                result.count ??
                notifications.length
            );

            state.unreadCount = safeNumber(
                data.unread_count ??
                result.unread_count ??
                notifications.filter(isUnread).length
            );

            state.page = 1;

            updateSummaryCards();
            updateFilterButtons();
            renderNotifications();

            if (showMessage) {
                showStatus(
                    "Notifications refreshed successfully.",
                    "success"
                );
            }
        } catch (error) {
            console.error("Notification loading failed:", error);

            showStatus(
                error.message || "Could not load notifications.",
                "error"
            );

            if (state.notifications.length === 0) {
                showEmptyState();
            }
        } finally {
            setLoading(false);
        }
    }

    /* -----------------------------------------------------
       MARK ONE AS READ
    ----------------------------------------------------- */

    async function markAsRead(notificationId) {
        const id = safeNumber(notificationId, -1);

        if (id <= 0 || state.markingRead.has(id)) return;

        state.markingRead.add(id);
        renderNotifications();

        try {
            await apiRequest(
                `/api/notifications/${id}/read`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({})
                }
            );

            const notification = state.notifications.find(
                item => safeNumber(item.id) === id
            );

            if (notification) {
                notification.is_read = 1;
            }

            state.unreadCount = Math.max(
                0,
                state.unreadCount - 1
            );

            updateSummaryCards();
            renderNotifications();

            showStatus(
                "Notification marked as read.",
                "success"
            );
        } catch (error) {
            console.error("Mark-as-read failed:", error);

            showStatus(
                error.message || "Could not mark notification as read.",
                "error"
            );
        } finally {
            state.markingRead.delete(id);
            renderNotifications();
        }
    }

    /* -----------------------------------------------------
       MARK ALL AS READ
    ----------------------------------------------------- */

    async function markAllAsRead() {
        if (
            state.unreadCount === 0 ||
            !elements.markAllButton
        ) {
            return;
        }

        if (!window.confirm(
            "Mark all notifications as read?"
        )) {
            return;
        }

        elements.markAllButton.disabled = true;

        try {
            await apiRequest(
                "/api/notifications/read-all",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({})
                }
            );

            state.notifications.forEach(notification => {
                notification.is_read = 1;
            });

            state.unreadCount = 0;

            updateSummaryCards();
            renderNotifications();

            showStatus(
                "All notifications marked as read.",
                "success"
            );
        } catch (error) {
            console.error("Mark-all-read failed:", error);

            showStatus(
                error.message || "Could not update notifications.",
                "error"
            );

            elements.markAllButton.disabled = false;
        }
    }

    /* -----------------------------------------------------
       FILTER EVENTS
    ----------------------------------------------------- */

    document.querySelectorAll("[data-filter]").forEach(button => {
        button.addEventListener("click", () => {
            const filter = button.dataset.filter;

            const allowedFilters = [
                "all",
                "unread",
                "price_alert",
                "updates"
            ];

            if (!allowedFilters.includes(filter)) return;

            state.filter = filter;
            state.page = 1;

            updateFilterButtons();
            renderNotifications();
        });
    });

    /* -----------------------------------------------------
       LIST EVENTS
    ----------------------------------------------------- */

    if (elements.list) {
        elements.list.addEventListener("click", event => {
            const button = event.target.closest(
                "[data-mark-read]"
            );

            if (!button) return;

            markAsRead(button.dataset.markRead);
        });
    }

    /* -----------------------------------------------------
       PAGINATION EVENTS
    ----------------------------------------------------- */

    if (elements.previousButton) {
        elements.previousButton.addEventListener("click", () => {
            if (state.page <= 1) return;

            state.page--;
            renderNotifications();
        });
    }

    if (elements.nextButton) {
        elements.nextButton.addEventListener("click", () => {
            const totalPages = Math.max(
                1,
                Math.ceil(
                    getFilteredNotifications().length / PAGE_SIZE
                )
            );

            if (state.page >= totalPages) return;

            state.page++;
            renderNotifications();
        });
    }

    /* -----------------------------------------------------
       REFRESH / MARK ALL EVENTS
    ----------------------------------------------------- */

    if (elements.refreshButton) {
        elements.refreshButton.addEventListener("click", () => {
            loadNotifications(true);
            loadDashboardSummary();
        });
    }

    if (elements.markAllButton) {
        elements.markAllButton.addEventListener(
            "click",
            markAllAsRead
        );
    }

    /* -----------------------------------------------------
       SIDEBAR MOBILE CONTROLS
    ----------------------------------------------------- */

    function closeSidebar() {
        elements.sidebar?.classList.remove("active");
        elements.sidebarOverlay?.classList.remove("active");
        document.body.classList.remove("sidebar-open");
    }

    if (elements.mobileMenuButton) {
        elements.mobileMenuButton.addEventListener("click", () => {
            elements.sidebar?.classList.toggle("active");
            elements.sidebarOverlay?.classList.toggle("active");
            document.body.classList.toggle(
                "sidebar-open",
                elements.sidebar?.classList.contains("active")
            );
        });
    }

    if (elements.sidebarOverlay) {
        elements.sidebarOverlay.addEventListener(
            "click",
            closeSidebar
        );
    }

    /* -----------------------------------------------------
       LOGOUT
    ----------------------------------------------------- */

    if (elements.logoutButton) {
        elements.logoutButton.addEventListener("click", async () => {
            if (!window.confirm("Are you sure you want to log out?")) {
                return;
            }

            elements.logoutButton.disabled = true;

            try {
                const result = await apiRequest("/api/logout", {
                    method: "POST"
                });

                if (result.success !== false) {
                    window.location.href = "/login";
                }
            } catch (error) {
                console.error("Logout failed:", error);
                showStatus(
                    error.message || "Logout failed.",
                    "error"
                );
                elements.logoutButton.disabled = false;
            }
        });
    }

    /* -----------------------------------------------------
       INITIALIZATION
    ----------------------------------------------------- */

    updateFilterButtons();
    loadDashboardSummary();
    loadNotifications();

});
