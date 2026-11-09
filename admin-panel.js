"use strict";

/*
========================================================
SA EVENT MAPS
ADMINISTRATOR USER MANAGEMENT
========================================================

All privileged user-list and role-change operations are performed
by guarded PostgreSQL functions. This module never updates profiles.role
with a direct table request.
========================================================
*/

(() => {
    const supabase = window.supabaseClient;
    const dataApi = window.saEventMapsData;

    const byId = id => document.getElementById(id);

    const navButton = byId("admin-nav-button");
    const panel = byId("admin-panel");
    const refreshButton = byId("admin-refresh-users");
    const searchInput = byId("admin-users-search");
    const usersCount = byId("admin-users-count");
    const statusElement = byId("admin-panel-status");
    const tableBody = byId("admin-users-table-body");
    const navigation = document.querySelector(".navigation");

    if (
        !supabase ||
        !dataApi ||
        !navButton ||
        !panel ||
        !refreshButton ||
        !searchInput ||
        !usersCount ||
        !statusElement ||
        !tableBody ||
        !navigation
    ) {
        console.error("SA Event Maps: Brakuje elementów panelu administracyjnego.");
        return;
    }

    let currentUser = null;
    let users = [];
    let isLoading = false;
    let hasLoadedUsers = false;

    function setStatus(message, type = "info") {
        statusElement.textContent = String(message || "");
        statusElement.dataset.state = type;
    }

    function setAdminAccess(allowed) {
        navButton.hidden = !allowed;

        if (!allowed) {
            panel.hidden = true;
            navButton.classList.remove("is-active");
            users = [];
            hasLoadedUsers = false;
            tableBody.replaceChildren();
            usersCount.textContent = "—";
        }
    }

    async function getFreshAdminContext() {
        const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();

        if (sessionError) {
            throw sessionError;
        }

        if (!sessionData?.session) {
            currentUser = null;
            setAdminAccess(false);
            throw new Error("Zaloguj się, aby korzystać z panelu administracyjnego.");
        }

        const user = await dataApi.getUserContext();

        currentUser = user;
        setAdminAccess(user.isAdmin);

        if (!user.isAdmin) {
            throw new Error("Ta sekcja jest dostępna wyłącznie dla administratora.");
        }

        return user;
    }

    async function synchronizeAccess() {
        try {
            const { data: sessionData, error: sessionError } =
                await supabase.auth.getSession();

            if (sessionError) {
                throw sessionError;
            }

            if (!sessionData?.session) {
                currentUser = null;
                setAdminAccess(false);
                return;
            }

            const user = await dataApi.getUserContext();
            currentUser = user;
            setAdminAccess(user.isAdmin);
        } catch (error) {
            currentUser = null;
            setAdminAccess(false);
            console.warn("SA Event Maps: Nie udało się sprawdzić dostępu do panelu.", error);
        }
    }

    function formatDate(value) {
        if (!value) {
            return "Nigdy";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        return new Intl.DateTimeFormat("pl-PL", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    }

    function createCell(className = "") {
        const cell = document.createElement("td");

        if (className) {
            cell.className = className;
        }

        return cell;
    }

    function renderUsers() {
        const query = searchInput.value.trim().toLocaleLowerCase("pl-PL");
        const filteredUsers = users.filter(user => {
            const name = String(user.display_name || "").toLocaleLowerCase("pl-PL");
            const email = String(user.email || "").toLocaleLowerCase("pl-PL");

            return !query || name.includes(query) || email.includes(query);
        });

        usersCount.textContent = query
            ? `${filteredUsers.length} / ${users.length}`
            : `${users.length}`;

        tableBody.replaceChildren();

        if (filteredUsers.length === 0) {
            const row = document.createElement("tr");
            const cell = createCell("admin-table-empty");
            cell.colSpan = 6;
            cell.textContent = users.length === 0
                ? "Nie znaleziono użytkowników."
                : "Brak użytkowników pasujących do wyszukiwania.";
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }

        const adminCount = users.filter(user => user.role === "admin").length;

        for (const user of filteredUsers) {
            const row = document.createElement("tr");
            row.dataset.userId = user.user_id;

            const nameCell = createCell("admin-user-name-cell");
            const name = document.createElement("strong");
            name.textContent = user.display_name || "Gracz";
            nameCell.appendChild(name);

            if (currentUser?.id === user.user_id) {
                const selfLabel = document.createElement("span");
                selfLabel.className = "admin-self-label";
                selfLabel.textContent = "To Twoje konto";
                nameCell.appendChild(selfLabel);
            }

            const emailCell = createCell("admin-user-email-cell");
            const email = document.createElement("span");
            email.textContent = user.email || "Brak adresu e-mail";
            emailCell.appendChild(email);

            const confirmation = document.createElement("small");
            const isConfirmed = Boolean(user.email_confirmed_at);
            confirmation.className = isConfirmed
                ? "admin-email-state is-confirmed"
                : "admin-email-state is-pending";
            confirmation.textContent = isConfirmed
                ? "Adres potwierdzony"
                : "Oczekuje na potwierdzenie";
            emailCell.appendChild(confirmation);

            const roleCell = createCell();
            const roleBadge = document.createElement("span");
            roleBadge.className = user.role === "admin"
                ? "admin-role-badge is-admin"
                : "admin-role-badge is-player";
            roleBadge.textContent = user.role === "admin"
                ? "Administrator"
                : "Gracz";
            roleCell.appendChild(roleBadge);

            const createdCell = createCell("admin-date-cell");
            createdCell.textContent = formatDate(user.created_at);

            const lastLoginCell = createCell("admin-date-cell");
            lastLoginCell.textContent = formatDate(user.last_sign_in_at);

            const actionCell = createCell("admin-action-cell");
            const actionButton = document.createElement("button");
            actionButton.type = "button";
            actionButton.className = user.role === "admin"
                ? "admin-role-action is-demote"
                : "admin-role-action is-promote";
            actionButton.dataset.action = "change-role";
            actionButton.dataset.userId = user.user_id;
            actionButton.dataset.nextRole = user.role === "admin" ? "player" : "admin";

            if (currentUser?.id === user.user_id) {
                actionButton.disabled = true;
                actionButton.textContent = "Twoje konto";
                actionButton.title = "Nie można odebrać rangi administratora własnemu kontu.";
            } else if (user.role === "admin" && adminCount <= 1) {
                actionButton.disabled = true;
                actionButton.textContent = "Ostatni administrator";
                actionButton.title = "Nie można odebrać rangi ostatniemu administratorowi.";
            } else {
                actionButton.textContent = user.role === "admin"
                    ? "Odbierz rangę"
                    : "Nadaj administratora";
            }

            actionCell.appendChild(actionButton);
            row.append(nameCell, emailCell, roleCell, createdCell, lastLoginCell, actionCell);
            tableBody.appendChild(row);
        }
    }

    async function loadUsers() {
        if (isLoading) {
            return false;
        }

        isLoading = true;
        refreshButton.disabled = true;
        refreshButton.textContent = "Pobieranie...";
        setStatus("Pobieranie listy użytkowników z Supabase...", "loading");

        try {
            await getFreshAdminContext();

            const { data, error } = await supabase.rpc("admin_list_users");

            if (error) {
                throw error;
            }

            users = Array.isArray(data) ? data : [];
            hasLoadedUsers = true;
            renderUsers();

            const adminCount = users.filter(user => user.role === "admin").length;
            setStatus(
                `Pobrano ${users.length} użytkowników. Aktywni administratorzy: ${adminCount}.`,
                "success"
            );
            return true;
        } catch (error) {
            console.error("SA Event Maps: Nie udało się pobrać użytkowników.", error);
            setStatus(error.message || "Nie udało się pobrać listy użytkowników.", "error");

            if (/wyłącznie dla administratora|ranga administratora/i.test(error.message || "")) {
                setAdminAccess(false);
            }
            return false;
        } finally {
            isLoading = false;
            refreshButton.disabled = false;
            refreshButton.textContent = "Odśwież listę";
        }
    }

    async function changeUserRole(userId, nextRole) {
        if (!userId || !["player", "admin"].includes(nextRole)) {
            return;
        }

        const target = users.find(user => user.user_id === userId);

        if (!target) {
            setStatus("Nie znaleziono użytkownika na aktualnej liście. Odśwież ją.", "error");
            return;
        }

        if (currentUser?.id === userId && nextRole === "player") {
            setStatus("Nie możesz odebrać rangi administratora własnemu kontu.", "error");
            return;
        }

        const targetName = target.display_name || target.email || "wybranemu użytkownikowi";
        const action = nextRole === "admin"
            ? `Nadać użytkownikowi ${targetName} rangę administratora? Otrzyma dostęp do funkcji administracyjnych.`
            : `Odebrać użytkownikowi ${targetName} rangę administratora? Jego konto pozostanie aktywne jako konto gracza.`;

        if (!window.confirm(action)) {
            return;
        }

        try {
            await getFreshAdminContext();

            const { error } = await supabase.rpc("admin_set_user_role", {
                p_target_user_id: userId,
                p_new_role: nextRole
            });

            if (error) {
                throw error;
            }

            const refreshed = await loadUsers();

            if (refreshed) {
                setStatus(
                    nextRole === "admin"
                        ? `Nadano rangę administratora użytkownikowi: ${targetName}.`
                        : `Odebrano rangę administratora użytkownikowi: ${targetName}. Konto nadal istnieje jako konto gracza.`,
                    "success"
                );
            }
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zmienić rangi użytkownika.", error);
            setStatus(error.message || "Nie udało się zmienić rangi użytkownika.", "error");
        }
    }

    navButton.addEventListener("click", async () => {
        try {
            await getFreshAdminContext();
            panel.hidden = false;

            document.querySelectorAll(".navigation .nav-item").forEach(button => {
                button.classList.toggle("is-active", button === navButton);
            });

            panel.scrollIntoView({ behavior: "smooth", block: "start" });

            if (!hasLoadedUsers) {
                await loadUsers();
            }
        } catch (error) {
            console.error("SA Event Maps: Odmowa dostępu do panelu.", error);
            setStatus(error.message || "Brak dostępu do panelu administracyjnego.", "error");
            setAdminAccess(false);
        }
    });

    navigation.addEventListener("click", event => {
        const button = event.target.closest(".nav-item");

        if (button && button !== navButton) {
            panel.hidden = true;
        }
    });

    refreshButton.addEventListener("click", () => {
        void loadUsers();
    });

    searchInput.addEventListener("input", renderUsers);

    tableBody.addEventListener("click", event => {
        const button = event.target.closest('button[data-action="change-role"]');

        if (!button || button.disabled) {
            return;
        }

        void changeUserRole(button.dataset.userId, button.dataset.nextRole);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
            if (!session) {
                currentUser = null;
                setAdminAccess(false);
                setStatus("Zaloguj się na konto administratora, aby otworzyć tę sekcję.");
                return;
            }

            void synchronizeAccess();
        }, 0);
    });

    supabase.auth.getSession()
        .then(({ data, error }) => {
            if (error) {
                throw error;
            }

            if (data?.session) {
                void synchronizeAccess();
            } else {
                setAdminAccess(false);
            }
        })
        .catch(error => {
            console.error("SA Event Maps: Nie udało się sprawdzić sesji panelu administracyjnego.", error);
            setAdminAccess(false);
        });

    console.info("SA Event Maps: Moduł panelu administracyjnego został uruchomiony.");
})();
