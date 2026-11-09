"use strict";

/*
========================================================
SA EVENT MAPS
FULL-SCREEN ADMINISTRATOR WORKSPACE
========================================================

Privileged operations are performed through guarded Supabase
functions or the admin-only data layer. This module owns only UI.
========================================================
*/

(() => {
    const supabase = window.supabaseClient;
    const dataApi = window.saEventMapsData;
    const byId = id => document.getElementById(id);

    const navButton = byId("admin-nav-button");
    const appShell = document.querySelector(".app-shell");
    const workspace = byId("admin-workspace");
    const backButton = byId("admin-back-to-map");
    const workspaceTitle = byId("admin-workspace-title");
    const workspaceNavigation = workspace?.querySelector(".admin-navigation");

    const refreshButton = byId("admin-refresh-users");
    const searchInput = byId("admin-users-search");
    const usersCount = byId("admin-users-count");
    const statusElement = byId("admin-panel-status");
    const tableBody = byId("admin-users-table-body");

    const addCategoryButton = byId("admin-add-category");
    const categoryFormCard = byId("admin-category-form-card");
    const categoryForm = byId("admin-category-form");
    const categoryFormTitle = byId("admin-category-form-title");
    const categoryIdInput = byId("admin-category-id");
    const categoryNameInput = byId("admin-category-name");
    const categoryDescriptionInput = byId("admin-category-description");
    const categoryIconInput = byId("admin-category-icon");
    const categoryColorInput = byId("admin-category-color");
    const categorySortInput = byId("admin-category-sort");
    const cancelCategoryButton = byId("admin-cancel-category");
    const categorySearchInput = byId("admin-categories-search");
    const categoryFilter = byId("admin-categories-filter");
    const categoryCount = byId("admin-categories-count");
    const categoryList = byId("admin-categories-list");
    const categoryStatus = byId("admin-category-status");

    const requiredElements = [
        supabase,
        dataApi,
        navButton,
        appShell,
        workspace,
        backButton,
        workspaceTitle,
        workspaceNavigation,
        refreshButton,
        searchInput,
        usersCount,
        statusElement,
        tableBody,
        addCategoryButton,
        categoryFormCard,
        categoryForm,
        categoryFormTitle,
        categoryIdInput,
        categoryNameInput,
        categoryDescriptionInput,
        categoryIconInput,
        categoryColorInput,
        categorySortInput,
        cancelCategoryButton,
        categorySearchInput,
        categoryFilter,
        categoryCount,
        categoryList,
        categoryStatus
    ];

    if (requiredElements.some(element => !element)) {
        console.error("SA Event Maps: Brakuje elementów pełnoekranowego panelu administracyjnego.");
        return;
    }

    let currentUser = null;
    let users = [];
    let categories = [];
    let isLoadingUsers = false;
    let isLoadingCategories = false;
    let hasLoadedUsers = false;
    let hasLoadedCategories = false;
    let activeSection = "users";
    let mapScrollPosition = 0;

    const sectionTitles = {
        users: "Użytkownicy i uprawnienia",
        events: "Wydarzenia",
        categories: "Kategorie",
        locations: "Pinezki i lokalizacje",
        settings: "Ustawienia globalne",
        help: "Instrukcje i regulamin"
    };

    function setStatus(message, type = "info") {
        statusElement.textContent = String(message || "");
        statusElement.dataset.state = type;
    }

    function setCategoryStatus(message, type = "info") {
        categoryStatus.textContent = String(message || "");
        categoryStatus.dataset.state = type;
    }

    function closeAdminWorkspace() {
        workspace.hidden = true;
        appShell.hidden = false;
        navButton.classList.remove("is-active");
        document.body.classList.remove("is-admin-workspace");
        window.scrollTo({ top: mapScrollPosition, behavior: "auto" });
    }

    function setAdminAccess(allowed) {
        navButton.hidden = !allowed;

        if (!allowed) {
            closeAdminWorkspace();
            users = [];
            categories = [];
            hasLoadedUsers = false;
            hasLoadedCategories = false;
            tableBody.replaceChildren();
            categoryList.replaceChildren();
            usersCount.textContent = "—";
            categoryCount.textContent = "—";
            categoryFormCard.hidden = true;
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

    function activateSection(section) {
        if (!Object.hasOwn(sectionTitles, section)) {
            return;
        }

        activeSection = section;
        workspaceTitle.textContent = sectionTitles[section];

        workspaceNavigation.querySelectorAll("[data-admin-section]").forEach(button => {
            button.classList.toggle("is-active", button.dataset.adminSection === section);
        });

        workspace.querySelectorAll("[data-admin-view]").forEach(view => {
            const active = view.dataset.adminView === section;
            view.hidden = !active;
            view.classList.toggle("is-active", active);
        });

        if (section === "users" && !hasLoadedUsers) {
            void loadUsers();
        }

        if (section === "categories") {
            void loadCategories();
        }
    }

    async function openAdminWorkspace() {
        try {
            await getFreshAdminContext();
            mapScrollPosition = window.scrollY || 0;
            appShell.hidden = true;
            workspace.hidden = false;
            navButton.classList.add("is-active");
            document.body.classList.add("is-admin-workspace");
            window.scrollTo({ top: 0, behavior: "auto" });
            activateSection("users");
            if (!hasLoadedUsers) {
                await loadUsers();
            }
        } catch (error) {
            console.error("SA Event Maps: Odmowa dostępu do panelu.", error);
            setStatus(error.message || "Brak dostępu do panelu administracyjnego.", "error");
            setAdminAccess(false);
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
        if (className) cell.className = className;
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
            if (user.is_owner) row.classList.add("is-owner");

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
            roleBadge.className = user.is_owner
                ? "admin-role-badge is-owner"
                : user.role === "admin"
                    ? "admin-role-badge is-admin"
                    : "admin-role-badge is-player";
            roleBadge.textContent = user.is_owner
                ? "Właściciel"
                : user.role === "admin"
                    ? "Administrator"
                    : "Gracz";
            if (user.is_owner) {
                roleBadge.title = "Stałe konto właściciela projektu SA Event Maps";
            }
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

            if (user.is_owner) {
                actionButton.disabled = true;
                actionButton.textContent = "Właściciel projektu";
                actionButton.title = "To konto ma stałe uprawnienia właściciela i nie można odebrać mu rangi administratora.";
            } else if (currentUser?.id === user.user_id) {
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
        if (isLoadingUsers) return false;

        isLoadingUsers = true;
        refreshButton.disabled = true;
        refreshButton.textContent = "Pobieranie...";
        setStatus("Pobieranie listy użytkowników z Supabase...", "loading");

        try {
            await getFreshAdminContext();
            const { data, error } = await supabase.rpc("admin_list_users");
            if (error) throw error;

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
            isLoadingUsers = false;
            refreshButton.disabled = false;
            refreshButton.textContent = "Odśwież listę";
        }
    }

    async function changeUserRole(userId, nextRole) {
        if (!userId || !["player", "admin"].includes(nextRole)) return;

        const target = users.find(user => user.user_id === userId);
        if (!target) {
            setStatus("Nie znaleziono użytkownika na aktualnej liście. Odśwież ją.", "error");
            return;
        }
        if (target.is_owner && nextRole !== "admin") {
            setStatus("Nie można odebrać rangi właścicielowi projektu SA Event Maps.", "error");
            return;
        }
        if (currentUser?.id === userId && nextRole === "player") {
            setStatus("Nie możesz odebrać rangi administratora własnemu kontu.", "error");
            return;
        }

        const targetName = target.display_name || target.email || "wybranemu użytkownikowi";
        const confirmation = nextRole === "admin"
            ? `Nadać użytkownikowi ${targetName} rangę administratora? Otrzyma dostęp do funkcji administracyjnych.`
            : `Odebrać użytkownikowi ${targetName} rangę administratora? Jego konto pozostanie aktywne jako konto gracza.`;
        if (!window.confirm(confirmation)) return;

        try {
            await getFreshAdminContext();
            const { error } = await supabase.rpc("admin_set_user_role", {
                p_target_user_id: userId,
                p_new_role: nextRole
            });
            if (error) throw error;

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

    function showCategoryForm(category = null) {
        categoryForm.reset();
        categoryIdInput.value = category?.id || "";
        categoryNameInput.value = category?.name || "";
        categoryDescriptionInput.value = category?.description || "";
        categoryIconInput.value = category?.icon || "";
        categoryColorInput.value = /^#[0-9a-fA-F]{6}$/.test(category?.color || "")
            ? category.color
            : "#65d6a3";
        categorySortInput.value = Number.isFinite(Number(category?.sortOrder))
            ? String(category.sortOrder)
            : "0";
        categoryFormTitle.textContent = category ? "Edytuj kategorię" : "Nowa kategoria";
        categoryFormCard.hidden = false;
        categoryNameInput.focus();
        categoryFormCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function hideCategoryForm() {
        categoryFormCard.hidden = true;
        categoryForm.reset();
        categoryIdInput.value = "";
    }

    function createCategoryAction(label, action, categoryId, extraClass = "") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `admin-category-action ${extraClass}`.trim();
        button.textContent = label;
        button.dataset.categoryAction = action;
        button.dataset.categoryId = categoryId;
        return button;
    }

    function renderCategories() {
        const query = categorySearchInput.value.trim().toLocaleLowerCase("pl-PL");
        const filter = categoryFilter.value;
        const filteredCategories = categories.filter(category => {
            const matchesArchive = filter === "all"
                || (filter === "archived" ? category.isArchived : !category.isArchived);
            const name = String(category.name || "").toLocaleLowerCase("pl-PL");
            const description = String(category.description || "").toLocaleLowerCase("pl-PL");
            return matchesArchive && (!query || name.includes(query) || description.includes(query));
        });

        categoryCount.textContent = filter === "all"
            ? `${filteredCategories.length} / ${categories.length}`
            : `${filteredCategories.length}`;
        categoryList.replaceChildren();

        if (filteredCategories.length === 0) {
            const empty = document.createElement("div");
            empty.className = "admin-empty-state";
            empty.textContent = categories.length === 0
                ? "Nie ma jeszcze żadnych kategorii. Możesz utworzyć pierwszą kategorię."
                : "Nie znaleziono kategorii pasujących do wybranego filtra lub wyszukiwania.";
            categoryList.appendChild(empty);
            return;
        }

        for (const category of filteredCategories) {
            const card = document.createElement("article");
            card.className = `admin-category-card${category.isArchived ? " is-archived" : ""}`;

            const heading = document.createElement("div");
            heading.className = "admin-category-card-heading";

            const color = /^#[0-9a-fA-F]{6}$/.test(category.color || "")
                ? category.color
                : "#65d6a3";
            const swatch = document.createElement("span");
            swatch.className = "admin-category-swatch";
            swatch.style.setProperty("--category-color", color);
            swatch.textContent = category.icon || "◇";
            swatch.setAttribute("aria-hidden", "true");

            const headingText = document.createElement("div");
            headingText.className = "admin-category-heading-text";
            const name = document.createElement("strong");
            name.textContent = category.name;
            headingText.appendChild(name);

            if (category.description) {
                const description = document.createElement("p");
                description.textContent = category.description;
                headingText.appendChild(description);
            }

            const state = document.createElement("span");
            state.className = "admin-category-state";
            state.textContent = category.isArchived ? "Zarchiwizowana" : "Aktywna";
            heading.append(swatch, headingText, state);

            const meta = document.createElement("div");
            meta.className = "admin-category-meta";
            meta.textContent = `Kolejność wyświetlania: ${Number(category.sortOrder) || 0}`;

            const actions = document.createElement("div");
            actions.className = "admin-category-actions";
            if (category.isArchived) {
                actions.appendChild(createCategoryAction("Przywróć", "restore", category.id));
            } else {
                actions.appendChild(createCategoryAction("Edytuj", "edit", category.id));
                actions.appendChild(createCategoryAction("Archiwizuj", "archive", category.id));
            }
            actions.appendChild(createCategoryAction("Usuń na stałe", "delete", category.id, "is-danger"));

            card.append(heading, meta, actions);
            categoryList.appendChild(card);
        }
    }

    async function loadCategories() {
        if (isLoadingCategories) return false;

        isLoadingCategories = true;
        setCategoryStatus("Pobieranie kategorii z Supabase...", "loading");

        try {
            await getFreshAdminContext();
            categories = await dataApi.listCategories();
            hasLoadedCategories = true;
            renderCategories();
            const activeCount = categories.filter(category => !category.isArchived).length;
            const archivedCount = categories.length - activeCount;
            setCategoryStatus(
                `Pobrano ${categories.length} kategorii: ${activeCount} aktywnych i ${archivedCount} zarchiwizowanych.`,
                "success"
            );
            return true;
        } catch (error) {
            console.error("SA Event Maps: Nie udało się pobrać kategorii.", error);
            setCategoryStatus(error.message || "Nie udało się pobrać kategorii.", "error");
            if (/wyłącznie dla administratora|ranga administratora/i.test(error.message || "")) {
                setAdminAccess(false);
            }
            return false;
        } finally {
            isLoadingCategories = false;
        }
    }

    async function saveCategory(event) {
        event.preventDefault();
        const name = categoryNameInput.value.trim();
        if (!name) {
            setCategoryStatus("Podaj nazwę kategorii.", "error");
            categoryNameInput.focus();
            return;
        }

        const id = categoryIdInput.value.trim();
        const input = {
            name,
            description: categoryDescriptionInput.value.trim(),
            icon: categoryIconInput.value.trim() || null,
            color: categoryColorInput.value || null,
            sortOrder: Math.max(0, Math.min(9999, Math.trunc(Number(categorySortInput.value) || 0)))
        };

        const duplicate = categories.find(category =>
            category.id !== id
            && !category.isArchived
            && category.name.trim().toLocaleLowerCase("pl-PL") === name.toLocaleLowerCase("pl-PL")
        );
        if (duplicate) {
            setCategoryStatus("Aktywna kategoria o takiej nazwie już istnieje.", "error");
            return;
        }

        const submitButton = categoryForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = "Zapisywanie...";
        setCategoryStatus("Zapisywanie kategorii...", "loading");

        try {
            await getFreshAdminContext();
            if (id) {
                await dataApi.updateCategory(id, input);
            } else {
                await dataApi.createCategory(input);
            }

            hideCategoryForm();
            await loadCategories();
            setCategoryStatus(id ? `Zapisano zmiany kategorii „${name}”.` : `Dodano kategorię „${name}”.`, "success");
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać kategorii.", error);
            setCategoryStatus(error.message || "Nie udało się zapisać kategorii.", "error");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Zapisz kategorię";
        }
    }

    async function handleCategoryAction(action, categoryId) {
        const category = categories.find(item => item.id === categoryId);
        if (!category) {
            setCategoryStatus("Nie znaleziono kategorii. Odśwież listę.", "error");
            return;
        }

        if (action === "edit") {
            if (category.isArchived) return;
            showCategoryForm(category);
            return;
        }

        if (action === "archive") {
            const accepted = window.confirm(
                `Zarchiwizować kategorię „${category.name}”?\n\nKategoria zostanie ukryta przed nowymi przypisaniami, ale istniejące przypisania pozostaną zachowane.`
            );
            if (!accepted) return;
        } else if (action === "restore") {
            const accepted = window.confirm(
                `Przywrócić kategorię „${category.name}”?\n\nJeżeli istnieje już aktywna kategoria o tej samej nazwie, baza odrzuci operację.`
            );
            if (!accepted) return;
        } else if (action === "delete") {
            const accepted = window.confirm(
                `Czy trwale usunąć kategorię „${category.name}”?\n\nUsuwanie jest możliwe wyłącznie wtedy, gdy kategoria nie jest przypisana do żadnej lokalizacji wydarzenia. Jeżeli jest używana, baza zablokuje operację — wtedy należy ją zarchiwizować. Tej czynności nie można cofnąć.`
            );
            if (!accepted) return;
        } else {
            return;
        }

        setCategoryStatus("Wykonywanie operacji...", "loading");
        categoryList.querySelectorAll("button").forEach(button => {
            button.disabled = true;
        });

        try {
            await getFreshAdminContext();
            if (action === "archive") {
                await dataApi.archiveCategory(categoryId);
            } else if (action === "restore") {
                await dataApi.restoreCategory(categoryId);
            } else if (action === "delete") {
                await dataApi.deleteCategory(categoryId);
            }

            await loadCategories();
            const messages = {
                archive: `Zarchiwizowano kategorię „${category.name}”.`,
                restore: `Przywrócono kategorię „${category.name}”.`,
                delete: `Trwale usunięto kategorię „${category.name}”.`
            };
            setCategoryStatus(messages[action], "success");
        } catch (error) {
            console.error("SA Event Maps: Operacja na kategorii nie powiodła się.", error);
            setCategoryStatus(error.message || "Nie udało się wykonać operacji.", "error");
        } finally {
            categoryList.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });
        }
    }

    navButton.addEventListener("click", () => {
        void openAdminWorkspace();
    });

    backButton.addEventListener("click", closeAdminWorkspace);

    workspaceNavigation.addEventListener("click", event => {
        const button = event.target.closest("[data-admin-section]");
        if (!button) return;
        activateSection(button.dataset.adminSection);
    });

    refreshButton.addEventListener("click", () => {
        void loadUsers();
    });
    searchInput.addEventListener("input", renderUsers);
    tableBody.addEventListener("click", event => {
        const button = event.target.closest('button[data-action="change-role"]');
        if (!button || button.disabled) return;
        void changeUserRole(button.dataset.userId, button.dataset.nextRole);
    });

    addCategoryButton.addEventListener("click", () => showCategoryForm());
    cancelCategoryButton.addEventListener("click", hideCategoryForm);
    categoryForm.addEventListener("submit", saveCategory);
    categorySearchInput.addEventListener("input", renderCategories);
    categoryFilter.addEventListener("change", renderCategories);
    categoryList.addEventListener("click", event => {
        const button = event.target.closest("button[data-category-action]");
        if (!button || button.disabled) return;
        void handleCategoryAction(button.dataset.categoryAction, button.dataset.categoryId);
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
            if (error) throw error;
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

    console.info("SA Event Maps: Pełnoekranowy panel administracyjny został uruchomiony.");
})();
