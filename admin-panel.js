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

    const addEventButton = byId("admin-add-event");
    const eventFormCard = byId("admin-event-form-card");
    const eventForm = byId("admin-event-form");
    const eventFormTitle = byId("admin-event-form-title");
    const eventIdInput = byId("admin-event-id");
    const eventNameInput = byId("admin-event-name");
    const eventDescriptionInput = byId("admin-event-description");
    const eventStartInput = byId("admin-event-start-date");
    const eventEndInput = byId("admin-event-end-date");
    const eventCountInput = byId("admin-event-count");
    const eventStatusSelect = byId("admin-event-status-select");
    const cancelEventButton = byId("admin-cancel-event");
    const eventSearchInput = byId("admin-events-search");
    const eventFilter = byId("admin-events-filter");
    const refreshEventsButton = byId("admin-refresh-events");
    const eventsCount = byId("admin-events-count");
    const eventsList = byId("admin-events-list");
    const eventStatus = byId("admin-event-status");
    const eventAssignmentsCard = byId("admin-event-assignments-card");
    const eventAssignmentsTitle = byId("admin-event-assignments-title");
    const eventAssignmentsDescription = byId("admin-event-assignments-description");
    const closeEventAssignmentsButton = byId("admin-close-event-assignments");
    const eventAddLocationSelect = byId("admin-event-add-location-select");
    const eventAssignLocationButton = byId("admin-event-assign-location");
    const eventCreateLocationButton = byId("admin-event-create-location");
    const eventAssignedLocations = byId("admin-event-assigned-locations");

    const addLocationButton = byId("admin-add-location");
    const locationFormCard = byId("admin-location-form-card");
    const locationForm = byId("admin-location-form");
    const locationFormTitle = byId("admin-location-form-title");
    const locationIdInput = byId("admin-location-id");
    const locationNameInput = byId("admin-location-name");
    const locationAreaInput = byId("admin-location-area");
    const locationXInput = byId("admin-location-x");
    const locationYInput = byId("admin-location-y");
    const locationZInput = byId("admin-location-z");
    const locationDescriptionInput = byId("admin-location-description");
    const cancelLocationButton = byId("admin-cancel-location");
    const locationSearchInput = byId("admin-locations-search");
    const locationFilter = byId("admin-locations-filter");
    const refreshLocationsButton = byId("admin-refresh-locations");
    const locationsCount = byId("admin-locations-count");
    const locationsList = byId("admin-locations-list");
    const locationStatus = byId("admin-location-status");

    const createBackupButton = byId("admin-create-backup");
    const backupFileInput = byId("admin-backup-file");
    const previewBackupButton = byId("admin-preview-backup");
    const backupStatus = byId("admin-backup-status");
    const backupPreviewCard = byId("admin-backup-preview");
    const backupPreviewDescription = byId("admin-backup-preview-description");
    const backupPreviewState = byId("admin-backup-preview-state");
    const backupCounts = byId("admin-backup-counts");
    const backupUnmatched = byId("admin-backup-unmatched");
    const backupEmailMatches = byId("admin-backup-email-matches");
    const restoreBackupButton = byId("admin-restore-backup");

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
        categoryStatus,
        addEventButton,
        eventFormCard,
        eventForm,
        eventFormTitle,
        eventIdInput,
        eventNameInput,
        eventDescriptionInput,
        eventStartInput,
        eventEndInput,
        eventCountInput,
        eventStatusSelect,
        cancelEventButton,
        eventSearchInput,
        eventFilter,
        refreshEventsButton,
        eventsCount,
        eventsList,
        eventStatus,
        eventAssignmentsCard,
        eventAssignmentsTitle,
        eventAssignmentsDescription,
        closeEventAssignmentsButton,
        eventAddLocationSelect,
        eventAssignLocationButton,
        eventCreateLocationButton,
        eventAssignedLocations,
        addLocationButton,
        locationFormCard,
        locationForm,
        locationFormTitle,
        locationIdInput,
        locationNameInput,
        locationAreaInput,
        locationXInput,
        locationYInput,
        locationZInput,
        locationDescriptionInput,
        cancelLocationButton,
        locationSearchInput,
        locationFilter,
        refreshLocationsButton,
        locationsCount,
        locationsList,
        locationStatus,
        createBackupButton,
        backupFileInput,
        previewBackupButton,
        backupStatus,
        backupPreviewCard,
        backupPreviewDescription,
        backupPreviewState,
        backupCounts,
        backupUnmatched,
        backupEmailMatches,
        restoreBackupButton
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
    let events = [];
    let locations = [];
    let eventLocations = [];
    let isLoadingManagementData = false;
    let hasLoadedManagementData = false;
    let selectedEventId = null;
    let locationReturnEventId = null;
    let activeSection = "users";
    let mapScrollPosition = 0;
    let selectedBackup = null;
    let backupPreviewResult = null;

    const sectionTitles = {
        users: "Użytkownicy i uprawnienia",
        events: "Wydarzenia",
        categories: "Kategorie",
        locations: "Pinezki i lokalizacje",
        backup: "Kopie zapasowe",
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

    function setEventStatus(message, type = "info") {
        eventStatus.textContent = String(message || "");
        eventStatus.dataset.state = type;
    }

    function setLocationStatus(message, type = "info") {
        locationStatus.textContent = String(message || "");
        locationStatus.dataset.state = type;
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
            events = [];
            locations = [];
            eventLocations = [];
            hasLoadedManagementData = false;
            selectedEventId = null;
            eventAssignmentsCard.hidden = true;
            eventFormCard.hidden = true;
            locationFormCard.hidden = true;
            eventsList.replaceChildren();
            locationsList.replaceChildren();
            eventAssignedLocations.replaceChildren();
            eventsCount.textContent = "—";
            locationsCount.textContent = "—";
            clearBackupPreview();
            backupFileInput.value = "";
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

        if (section === "events" || section === "locations") {
            void loadManagementData();
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

    function setBackupStatus(message, type = "info") {
        backupStatus.textContent = String(message || "");
        backupStatus.dataset.state = type;
    }

    function getCurrentProjectRef() {
        const configuredUrl = String(supabase?.supabaseUrl || "");
        let hostname = "";
        try {
            hostname = new URL(configuredUrl).hostname;
        } catch {
            throw new Error("Nie udało się odczytać identyfikatora projektu Supabase.");
        }
        const projectRef = hostname.split(".")[0];
        if (!projectRef || !hostname.endsWith(".supabase.co")) {
            throw new Error("Adres Supabase nie wygląda na prawidłowy projekt.");
        }
        return projectRef;
    }

    async function sha256Hex(value) {
        if (!window.crypto?.subtle) {
            throw new Error("Ta przeglądarka nie udostępnia kontroli integralności SHA-256. Otwórz stronę przez HTTPS.");
        }
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const digest = await window.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function formatBackupBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
        const units = ["B", "KB", "MB", "GB"];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
    }

    function clearBackupPreview() {
        selectedBackup = null;
        backupPreviewResult = null;
        backupPreviewCard.hidden = true;
        backupPreviewButton.disabled = !backupFileInput.files?.length;
        restoreBackupButton.disabled = true;
        backupCounts.replaceChildren();
        backupUnmatched.replaceChildren();
        backupUnmatched.hidden = true;
        backupEmailMatches.replaceChildren();
        backupEmailMatches.hidden = true;
        backupPreviewState.textContent = "Oczekuje na kontrolę";
        backupPreviewState.className = "admin-status-pill";
    }

    async function createOrganizationBackupFile() {
        createBackupButton.disabled = true;
        createBackupButton.textContent = "Tworzenie kopii…";
        setBackupStatus("Pobieranie pełnego zestawu danych organizacji z Supabase…", "loading");

        try {
            await getFreshAdminContext();
            const backup = await dataApi.exportOrganizationBackup();
            backup.project_ref = getCurrentProjectRef();
            backup.integrity = {
                algorithm: "SHA-256",
                digest: await sha256Hex(backup)
            };

            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: "application/json;charset=utf-8" });
            const maxBytes = 100 * 1024 * 1024;
            if (blob.size > maxBytes) {
                throw new Error(`Kopia ma ${formatBackupBytes(blob.size)} i przekracza limit ${formatBackupBytes(maxBytes)} tej wersji. Nie zapisano niekompletnej kopii.`);
            }
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            anchor.href = objectUrl;
            anchor.download = `sa-event-maps-backup-${timestamp}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

            const counts = Object.entries(backup.data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.length : 0}`).join(" · ");
            setBackupStatus(`Kopia została przygotowana i pobrana (${formatBackupBytes(blob.size)}). ${counts}`, "success");
        } catch (error) {
            console.error("SA Event Maps: Nie udało się utworzyć pełnej kopii.", error);
            setBackupStatus(error.message || "Nie udało się utworzyć kopii organizacji.", "error");
        } finally {
            createBackupButton.disabled = false;
            createBackupButton.textContent = "Utwórz i pobierz kopię";
        }
    }

    function renderBackupPreview(preview, fileName) {
        const labels = {
            accounts: "Konta użytkowników",
            events: "Wydarzenia",
            locations: "Lokalizacje / znajdźki",
            event_locations: "Przypisania do wydarzeń",
            categories: "Kategorie",
            player_progress: "Wpisy postępu graczy",
            activity_log: "Historia aktywności"
        };

        backupCounts.replaceChildren();
        for (const [key, label] of Object.entries(labels)) {
            const item = document.createElement("div");
            item.className = "admin-backup-count-item";
            const name = document.createElement("span");
            name.textContent = label;
            const value = document.createElement("strong");
            value.textContent = String(preview.counts?.[key] ?? 0);
            item.append(name, value);
            backupCounts.appendChild(item);
        }

        const emailMatches = Array.isArray(preview.email_fallback_accounts)
            ? preview.email_fallback_accounts
            : [];
        backupEmailMatches.replaceChildren();
        backupEmailMatches.hidden = emailMatches.length === 0;
        if (emailMatches.length > 0) {
            const heading = document.createElement("h4");
            heading.textContent = "Konta dopasowane po adresie e-mail";
            const explanation = document.createElement("p");
            explanation.textContent = "Identyfikatory Auth tych kont różnią się od zapisanych w kopii. Przed przywróceniem sprawdź, czy każdy adres e-mail należy do tej samej osoby.";
            const list = document.createElement("ul");
            for (const account of emailMatches) {
                const item = document.createElement("li");
                item.textContent = `${account.email || "Brak e-maila"} — ${account.display_name || "Gracz"}`;
                list.appendChild(item);
            }
            backupEmailMatches.append(heading, explanation, list);
        }

        const unmatched = Array.isArray(preview.unmatched_progress_accounts)
            ? preview.unmatched_progress_accounts
            : [];
        backupUnmatched.replaceChildren();
        backupUnmatched.hidden = unmatched.length === 0;
        if (unmatched.length > 0) {
            const heading = document.createElement("h4");
            heading.textContent = "Nie znaleziono kont z zapisanym postępem";
            const explanation = document.createElement("p");
            explanation.textContent = "Przed przywróceniem te konta muszą istnieć w Supabase pod tym samym adresem e-mail lub identyfikatorem. Import został zablokowany, aby nie zgubić ich postępów.";
            const list = document.createElement("ul");
            for (const account of unmatched) {
                const item = document.createElement("li");
                const identity = account.email || account.display_name || account.user_id;
                item.textContent = `${identity} — ${account.progress_rows} wpisów postępu`;
                list.appendChild(item);
            }
            backupUnmatched.append(heading, explanation, list);
        }

        backupPreviewDescription.textContent = `${fileName} · dopasowano ${preview.matched_accounts} z ${preview.counts.accounts} kont z kopii.`;
        backupPreviewState.textContent = preview.can_restore ? "Kopia gotowa do przywrócenia" : "Wymaga dopasowania kont";
        backupPreviewState.className = preview.can_restore
            ? "admin-status-pill is-active"
            : "admin-status-pill is-archived";
        restoreBackupButton.disabled = !preview.can_restore;
        backupPreviewCard.hidden = false;
    }

    async function previewOrganizationBackupFile() {
        clearBackupPreview();
        const file = backupFileInput.files?.[0];
        if (!file) {
            setBackupStatus("Najpierw wybierz plik kopii zapasowej.", "error");
            return;
        }
        const maxBytes = 100 * 1024 * 1024;
        if (file.size <= 0 || file.size > maxBytes) {
            setBackupStatus(`Plik musi mieć rozmiar od 1 B do ${formatBackupBytes(maxBytes)}.`, "error");
            return;
        }

        previewBackupButton.disabled = true;
        previewBackupButton.textContent = "Sprawdzanie…";
        setBackupStatus("Sprawdzanie formatu, projektu i sumy kontrolnej kopii…", "loading");

        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || parsed.schema !== "sa-event-maps-organization-backup" || parsed.version !== 1) {
                throw new Error("Wybrany plik nie jest obsługiwaną kopią organizacji SA Event Maps.");
            }
            if (parsed.project_ref !== getCurrentProjectRef()) {
                throw new Error("Ta kopia pochodzi z innego projektu Supabase. Przywracanie w tym projekcie zostało zablokowane.");
            }
            if (!parsed.integrity || parsed.integrity.algorithm !== "SHA-256" || typeof parsed.integrity.digest !== "string") {
                throw new Error("Kopia nie zawiera prawidłowej sumy kontrolnej. Wybierz oryginalny, niezmieniony plik kopii.");
            }

            const unsignedBackup = { ...parsed };
            delete unsignedBackup.integrity;
            const actualDigest = await sha256Hex(unsignedBackup);
            if (actualDigest !== parsed.integrity.digest.toLowerCase()) {
                throw new Error("Suma kontrolna kopii jest niezgodna. Plik mógł zostać uszkodzony lub zmieniony.");
            }

            await getFreshAdminContext();
            const preview = await dataApi.previewOrganizationBackup(parsed);
            selectedBackup = parsed;
            backupPreviewResult = preview;
            renderBackupPreview(preview, file.name);

            if (preview.can_restore) {
                setBackupStatus("Kontrola zakończona. Kopia jest zgodna z tym projektem i można ją przywrócić.", "success");
            } else {
                setBackupStatus("Kopia jest poprawna, ale nie wszystkie konta z zapisanym postępem mają odpowiedniki w obecnym projekcie. Przywracanie pozostaje zablokowane.", "error");
            }
        } catch (error) {
            console.error("SA Event Maps: Kontrola kopii nie powiodła się.", error);
            selectedBackup = null;
            backupPreviewResult = null;
            setBackupStatus(error instanceof SyntaxError ? "Plik nie jest prawidłowym JSON-em." : (error.message || "Nie udało się sprawdzić kopii."), "error");
        } finally {
            previewBackupButton.disabled = !backupFileInput.files?.length;
            previewBackupButton.textContent = "Sprawdź kopię";
        }
    }

    async function restoreOrganizationBackupFile() {
        if (!selectedBackup || !backupPreviewResult?.can_restore) return;
        const emailMatches = Array.isArray(backupPreviewResult.email_fallback_accounts)
            ? backupPreviewResult.email_fallback_accounts
            : [];
        const emailWarning = emailMatches.length > 0
            ? `\n\nUwaga: ${emailMatches.length} konto/konta dopasowano po e-mailu, a nie po identyfikatorze Auth. Sprawdź listę w podglądzie przed kontynuacją.`
            : "";
        const confirmation = window.prompt(
            "Przywrócenie połączy dane z kopii z obecną bazą. Rekordy zawarte w kopii zostaną dodane lub zaktualizowane; pozostałe rekordy nie zostaną usunięte." + emailWarning + "\n\nAby potwierdzić, wpisz dokładnie: PRZYWRÓĆ DANE"
        );
        if (confirmation !== "PRZYWRÓĆ DANE") {
            setBackupStatus("Przywracanie anulowane. Baza nie została zmieniona.", "info");
            return;
        }

        restoreBackupButton.disabled = true;
        createBackupButton.disabled = true;
        previewBackupButton.disabled = true;
        setBackupStatus("Przywracanie danych w jednej transakcji Supabase… Nie zamykaj tej strony.", "loading");

        try {
            await getFreshAdminContext();
            const result = await dataApi.restoreOrganizationBackup(selectedBackup);
            notifyCatalogChanged();
            hasLoadedManagementData = false;
            hasLoadedCategories = false;
            hasLoadedUsers = false;
            await getFreshAdminContext();
            await loadUsers();
            clearBackupPreview();
            backupFileInput.value = "";
            setBackupStatus(
                `Przywracanie zakończone. Wydarzenia: ${result.events_processed}; lokalizacje: ${result.locations_processed}; przypisania: ${result.assignments_processed}; kategorie: ${result.categories_processed}; wpisy postępu: ${result.progress_rows_processed}; wpisy historii: ${result.activity_log_rows_processed}. Rangi i właściciel projektu pozostały bez zmian.`,
                "success"
            );
        } catch (error) {
            console.error("SA Event Maps: Przywracanie kopii nie powiodło się.", error);
            setBackupStatus(error.message || "Nie udało się przywrócić kopii. Transakcja została wycofana.", "error");
            restoreBackupButton.disabled = !backupPreviewResult?.can_restore;
        } finally {
            createBackupButton.disabled = false;
            previewBackupButton.disabled = !backupFileInput.files?.length;
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

    function makeActionButton(label, action, id, attribute, danger = false, disabled = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `admin-category-action${danger ? " is-danger" : ""}`;
        button.textContent = label;
        button.dataset[attribute] = action;
        button.dataset.recordId = id;
        button.disabled = Boolean(disabled);
        return button;
    }

    function statusLabel(status) {
        return ({
            draft: "Robocze",
            active: "Aktywne",
            completed: "Zakończone",
            archived: "Zarchiwizowane"
        })[status] || status || "Nieznany";
    }

    function dateRangeLabel(start, end) {
        const formattedStart = start ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${start}T00:00:00`)) : null;
        const formattedEnd = end ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${end}T00:00:00`)) : null;
        if (formattedStart && formattedEnd) return `${formattedStart} – ${formattedEnd}`;
        if (formattedStart) return `Od ${formattedStart}`;
        if (formattedEnd) return `Do ${formattedEnd}`;
        return "Nie określono dat";
    }

    function assignmentCountForEvent(eventId) {
        return eventLocations.filter(item => item.eventId === eventId).length;
    }

    function assignmentCountForLocation(locationId) {
        return eventLocations.filter(item => item.locationId === locationId).length;
    }

    function showEventForm(event = null) {
        eventForm.reset();
        eventIdInput.value = event?.id || "";
        eventNameInput.value = event?.name || "";
        eventDescriptionInput.value = event?.description || "";
        eventStartInput.value = event?.startDate || "";
        eventEndInput.value = event?.endDate || "";
        eventCountInput.value = event?.officialCollectibleCount ?? "";
        eventStatusSelect.value = event?.status || "draft";
        eventFormTitle.textContent = event ? "Edytuj wydarzenie" : "Nowe wydarzenie";
        eventFormCard.hidden = false;
        eventNameInput.focus();
        eventFormCard.scrollIntoView({behavior:"smooth", block:"nearest"});
    }

    function hideEventForm() {
        eventFormCard.hidden = true;
        eventForm.reset();
        eventIdInput.value = "";
    }

    function renderEvents() {
        const query = eventSearchInput.value.trim().toLocaleLowerCase("pl-PL");
        const filter = eventFilter.value;
        const filtered = events.filter(event => {
            const matchesQuery = !query
                || String(event.name || "").toLocaleLowerCase("pl-PL").includes(query)
                || String(event.description || "").toLocaleLowerCase("pl-PL").includes(query);
            let matchesFilter = true;
            if (filter === "active") matchesFilter = event.status === "draft" || event.status === "active";
            else if (filter === "active-only") matchesFilter = event.status === "active";
            else if (filter === "draft" || filter === "completed" || filter === "archived") matchesFilter = event.status === filter;
            return matchesQuery && matchesFilter;
        });

        eventsCount.textContent = filter === "all" && !query ? String(events.length) : `${filtered.length} / ${events.length}`;
        eventsList.replaceChildren();

        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "admin-empty-state";
            empty.textContent = events.length ? "Brak wydarzeń pasujących do wybranych filtrów." : "Nie ma jeszcze żadnych wydarzeń.";
            eventsList.appendChild(empty);
            return;
        }

        for (const event of filtered) {
            const card = document.createElement("article");
            card.className = `admin-record-card${event.status === "archived" ? " is-archived" : ""}`;

            const main = document.createElement("div");
            main.className = "admin-record-main";
            const heading = document.createElement("div");
            heading.className = "admin-record-heading";
            const title = document.createElement("h3");
            title.textContent = event.name;
            const state = document.createElement("span");
            state.className = `admin-status-pill is-${event.status}`;
            state.textContent = statusLabel(event.status);
            heading.append(title, state);

            const description = document.createElement("p");
            description.className = "admin-record-description";
            description.textContent = event.description || "Brak opisu.";
            const meta = document.createElement("div");
            meta.className = "admin-record-meta";
            const dates = document.createElement("span");
            dates.textContent = dateRangeLabel(event.startDate, event.endDate);
            const count = document.createElement("span");
            const assignmentCount = assignmentCountForEvent(event.id);
            count.textContent = `${assignmentCount} przypisanych znajdziek`;
            const official = document.createElement("span");
            official.textContent = event.officialCollectibleCount === null || event.officialCollectibleCount === undefined
                ? "Oficjalna liczba: nie określono"
                : `Oficjalna liczba: ${event.officialCollectibleCount}`;
            meta.append(dates, count, official);
            main.append(heading, description, meta);

            const actions = document.createElement("div");
            actions.className = "admin-record-actions";
            if (event.status !== "archived") {
                actions.appendChild(makeActionButton("Zarządzaj znajdźkami", "manage", event.id, "eventAction"));
                actions.appendChild(makeActionButton("Edytuj", "edit", event.id, "eventAction"));
                actions.appendChild(makeActionButton("Archiwizuj", "archive", event.id, "eventAction"));
            } else {
                actions.appendChild(makeActionButton("Przywróć", "restore", event.id, "eventAction"));
            }
            actions.appendChild(makeActionButton("Usuń na stałe", "delete", event.id, "eventAction", true));
            card.append(main, actions);
            eventsList.appendChild(card);
        }
    }

    function renderEventLocationOptions() {
        const assignedIds = new Set(eventLocations
            .filter(item => item.eventId === selectedEventId)
            .map(item => item.locationId));
        const previousValue = eventAddLocationSelect.value;
        eventAddLocationSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Wybierz lokalizację…";
        eventAddLocationSelect.appendChild(placeholder);

        locations
            .filter(location => !location.isArchived && !assignedIds.has(location.id))
            .sort((a, b) => a.name.localeCompare(b.name, "pl"))
            .forEach(location => {
                const option = document.createElement("option");
                option.value = location.id;
                option.textContent = `${location.name} — ${location.area}`;
                eventAddLocationSelect.appendChild(option);
            });

        if ([...eventAddLocationSelect.options].some(option => option.value === previousValue)) {
            eventAddLocationSelect.value = previousValue;
        }
        eventAssignLocationButton.disabled = eventAddLocationSelect.options.length <= 1 || !selectedEventId;
    }

    function renderEventAssignments() {
        const event = events.find(item => item.id === selectedEventId);
        if (!event || event.status === "archived") {
            eventAssignmentsCard.hidden = true;
            selectedEventId = null;
            return;
        }

        eventAssignmentsCard.hidden = false;
        eventAssignmentsTitle.textContent = `Znajdźki: ${event.name}`;
        eventAssignmentsDescription.textContent = `Wydarzenie ma przypisanych ${assignmentCountForEvent(event.id)} znajdziek. Dodawaj istniejące lokalizacje lub twórz nowe.`;
        renderEventLocationOptions();
        eventAssignedLocations.replaceChildren();

        const assignments = eventLocations
            .filter(item => item.eventId === selectedEventId)
            .map(assignment => ({assignment, location: locations.find(location => location.id === assignment.locationId)}))
            .filter(item => item.location)
            .sort((a, b) => a.location.name.localeCompare(b.location.name, "pl"));

        if (!assignments.length) {
            const empty = document.createElement("div");
            empty.className = "admin-empty-state";
            empty.textContent = "To wydarzenie nie ma jeszcze przypisanych znajdziek.";
            eventAssignedLocations.appendChild(empty);
            return;
        }

        for (const {assignment, location} of assignments) {
            const card = document.createElement("article");
            card.className = `admin-record-card admin-assignment-card${location.isArchived ? " is-archived" : ""}`;
            const main = document.createElement("div");
            main.className = "admin-record-main";
            const heading = document.createElement("div");
            heading.className = "admin-record-heading";
            const title = document.createElement("h3");
            title.textContent = location.name;
            const state = document.createElement("span");
            state.className = `admin-status-pill ${location.isArchived ? "is-archived" : location.isPinned ? "is-pinned" : "is-active"}`;
            state.textContent = location.isArchived ? "Lokalizacja zarchiwizowana" : location.isPinned ? "Pinezka zablokowana" : "Aktywna";
            heading.append(title, state);
            const meta = document.createElement("div");
            meta.className = "admin-record-meta";
            const area = document.createElement("span");
            area.textContent = location.area || "Nie określono";
            const coords = document.createElement("span");
            coords.textContent = `X: ${location.world.x} · Y: ${location.world.y} · Z: ${location.world.z ?? "—"}`;
            meta.append(area, coords);
            main.append(heading, meta);
            const actions = document.createElement("div");
            actions.className = "admin-record-actions";
            actions.appendChild(makeActionButton("Edytuj lokalizację", "edit", location.id, "assignmentAction"));
            actions.appendChild(makeActionButton("Usuń przypisanie", "unlink", location.id, "assignmentAction", true));
            card.append(main, actions);
            eventAssignedLocations.appendChild(card);
        }
    }

    function showLocationForm(location = null, assignToEventId = null) {
        locationForm.reset();
        locationIdInput.value = location?.id || "";
        locationNameInput.value = location?.name || "";
        locationAreaInput.value = location?.area || "Nie określono";
        locationXInput.value = location?.world?.x ?? "";
        locationYInput.value = location?.world?.y ?? "";
        locationZInput.value = location?.world?.z ?? "";
        locationDescriptionInput.value = location?.description || "";
        locationReturnEventId = location ? null : assignToEventId;
        locationFormTitle.textContent = location
            ? "Edytuj znajdźkę"
            : assignToEventId ? "Nowa znajdźka do wydarzenia" : "Nowa znajdźka";
        locationFormCard.hidden = false;
        locationNameInput.focus();
        locationFormCard.scrollIntoView({behavior:"smooth", block:"nearest"});
    }

    function hideLocationForm() {
        locationFormCard.hidden = true;
        locationForm.reset();
        locationIdInput.value = "";
        locationReturnEventId = null;
    }

    function renderLocations() {
        const query = locationSearchInput.value.trim().toLocaleLowerCase("pl-PL");
        const filter = locationFilter.value;
        const filtered = locations.filter(location => {
            const matchesQuery = !query
                || String(location.name || "").toLocaleLowerCase("pl-PL").includes(query)
                || String(location.area || "").toLocaleLowerCase("pl-PL").includes(query)
                || String(location.description || "").toLocaleLowerCase("pl-PL").includes(query);
            const matchesFilter = filter === "all"
                || (filter === "archived" ? location.isArchived : !location.isArchived);
            return matchesQuery && matchesFilter;
        });

        locationsCount.textContent = filter === "all" && !query ? String(locations.length) : `${filtered.length} / ${locations.length}`;
        locationsList.replaceChildren();

        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "admin-empty-state";
            empty.textContent = locations.length ? "Brak znajdziek pasujących do wybranych filtrów." : "Wspólny katalog lokalizacji jest pusty.";
            locationsList.appendChild(empty);
            return;
        }

        for (const location of filtered) {
            const card = document.createElement("article");
            card.className = `admin-record-card${location.isArchived ? " is-archived" : ""}`;
            const main = document.createElement("div");
            main.className = "admin-record-main";
            const heading = document.createElement("div");
            heading.className = "admin-record-heading";
            const title = document.createElement("h3");
            title.textContent = location.name;
            const state = document.createElement("span");
            state.className = `admin-status-pill ${location.isArchived ? "is-archived" : location.isPinned ? "is-pinned" : "is-active"}`;
            state.textContent = location.isArchived ? "Zarchiwizowana" : location.isPinned ? "Zablokowana" : "Aktywna";
            heading.append(title, state);
            const description = document.createElement("p");
            description.className = "admin-record-description";
            description.textContent = location.description || "Brak opisu.";
            const meta = document.createElement("div");
            meta.className = "admin-record-meta";
            const area = document.createElement("span");
            area.textContent = location.area || "Nie określono";
            const coords = document.createElement("span");
            coords.textContent = `X: ${location.world.x} · Y: ${location.world.y} · Z: ${location.world.z ?? "—"}`;
            const assignments = document.createElement("span");
            const assignmentCount = assignmentCountForLocation(location.id);
            assignments.textContent = `Przypisania do wydarzeń: ${assignmentCount}`;
            meta.append(area, coords, assignments);
            main.append(heading, description, meta);
            const actions = document.createElement("div");
            actions.className = "admin-record-actions";
            actions.appendChild(makeActionButton("Edytuj", "edit", location.id, "locationAction"));
            if (!location.isArchived) {
                actions.appendChild(makeActionButton(location.isPinned ? "Odblokuj" : "Zablokuj", location.isPinned ? "unpin" : "pin", location.id, "locationAction"));
                actions.appendChild(makeActionButton("Archiwizuj", "archive", location.id, "locationAction"));
            } else {
                actions.appendChild(makeActionButton("Przywróć", "restore", location.id, "locationAction"));
            }
            actions.appendChild(makeActionButton("Usuń na stałe", "delete", location.id, "locationAction", true, assignmentCount > 0));
            card.append(main, actions);
            locationsList.appendChild(card);
        }
    }

    async function loadManagementData() {
        if (isLoadingManagementData) return false;
        isLoadingManagementData = true;
        setEventStatus("Pobieranie wydarzeń i powiązań…", "loading");
        setLocationStatus("Pobieranie wspólnego katalogu lokalizacji…", "loading");
        try {
            await getFreshAdminContext();
            const [loadedEvents, loadedLocations, loadedAssignments] = await Promise.all([
                dataApi.listAdminEvents(),
                dataApi.listAdminLocations(),
                dataApi.listAdminEventLocations()
            ]);
            events = loadedEvents;
            locations = loadedLocations;
            eventLocations = loadedAssignments;
            hasLoadedManagementData = true;
            renderEvents();
            renderLocations();
            renderEventAssignments();
            setEventStatus(`Pobrano ${events.length} wydarzeń.`, "success");
            setLocationStatus(`Pobrano ${locations.length} lokalizacji.`, "success");
            return true;
        } catch (error) {
            console.error("SA Event Maps: Nie udało się pobrać danych wydarzeń i lokalizacji.", error);
            setEventStatus(error.message || "Nie udało się pobrać wydarzeń.", "error");
            setLocationStatus(error.message || "Nie udało się pobrać lokalizacji.", "error");
            if (/wyłącznie dla administratora|ranga administratora/i.test(error.message || "")) setAdminAccess(false);
            return false;
        } finally {
            isLoadingManagementData = false;
        }
    }

    async function refreshManagementData() {
        hasLoadedManagementData = false;
        await loadManagementData();
    }

    function notifyCatalogChanged() {
        window.dispatchEvent(new Event("sa-event-maps:catalog-changed"));
    }

    async function saveEvent(event) {
        event.preventDefault();
        const name = eventNameInput.value.trim();
        if (!name) {
            setEventStatus("Podaj nazwę wydarzenia.", "error");
            eventNameInput.focus();
            return;
        }
        if (eventStartInput.value && eventEndInput.value && eventEndInput.value < eventStartInput.value) {
            setEventStatus("Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.", "error");
            eventEndInput.focus();
            return;
        }
        const id = eventIdInput.value.trim();
        const input = {
            name,
            description: eventDescriptionInput.value.trim(),
            startDate: eventStartInput.value || null,
            endDate: eventEndInput.value || null,
            officialCollectibleCount: eventCountInput.value === "" ? null : Number(eventCountInput.value),
            status: eventStatusSelect.value
        };
        const submit = eventForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        submit.textContent = "Zapisywanie…";
        setEventStatus("Zapisywanie wydarzenia…", "loading");
        try {
            await getFreshAdminContext();
            if (id) await dataApi.updateEvent(id, input);
            else await dataApi.createEvent(input);
            notifyCatalogChanged();
            hideEventForm();
            await refreshManagementData();
            setEventStatus(id ? `Zapisano wydarzenie „${name}”.` : `Utworzono wydarzenie „${name}”.`, "success");
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać wydarzenia.", error);
            setEventStatus(error.message || "Nie udało się zapisać wydarzenia.", "error");
        } finally {
            submit.disabled = false;
            submit.textContent = "Zapisz wydarzenie";
        }
    }

    async function handleEventAction(action, eventId) {
        const event = events.find(item => item.id === eventId);
        if (!event) {
            setEventStatus("Nie znaleziono wydarzenia. Odśwież listę.", "error");
            return;
        }
        if (action === "manage") {
            selectedEventId = eventId;
            eventAssignmentsCard.hidden = false;
            renderEventAssignments();
            eventAssignmentsCard.scrollIntoView({behavior:"smooth", block:"start"});
            return;
        }
        if (action === "edit") {
            if (event.status === "archived") return;
            showEventForm(event);
            return;
        }

        let accepted = true;
        if (action === "archive") {
            accepted = window.confirm(`Zarchiwizować wydarzenie „${event.name}”?\n\nWydarzenie zniknie z aktywnego widoku graczy, ale wszystkie przypisania i postępy zostaną zachowane. Można je później przywrócić.`);
        } else if (action === "restore") {
            accepted = window.confirm(`Przywrócić wydarzenie „${event.name}”?\n\nWydarzenie wróci ze statusem sprzed archiwizacji.`);
        } else if (action === "delete") {
            accepted = window.confirm(`Trwale usunąć wydarzenie „${event.name}”?\n\nPrzypisania znajdziek do tego wydarzenia zostaną usunięte, ale same pinezki pozostaną w katalogu. Jeżeli istnieje choć jeden zapis postępu gracza, baza zablokuje usunięcie. Tej operacji nie można cofnąć.`);
        } else return;
        if (!accepted) return;

        setEventStatus("Wykonywanie operacji…", "loading");
        eventsList.querySelectorAll("button").forEach(button => button.disabled = true);
        try {
            await getFreshAdminContext();
            if (action === "archive") await dataApi.archiveEvent(eventId);
            else if (action === "restore") await dataApi.restoreEvent(eventId);
            else if (action === "delete") {
                await dataApi.deleteEvent(eventId);
                if (selectedEventId === eventId) {
                    selectedEventId = null;
                    eventAssignmentsCard.hidden = true;
                }
            }
            notifyCatalogChanged();
            await refreshManagementData();
            const label = {archive:"Zarchiwizowano",restore:"Przywrócono",delete:"Trwale usunięto"}[action];
            setEventStatus(`${label} wydarzenie „${event.name}”.`, "success");
        } catch (error) {
            console.error("SA Event Maps: Operacja na wydarzeniu nie powiodła się.", error);
            setEventStatus(error.message || "Nie udało się wykonać operacji na wydarzeniu.", "error");
        } finally {
            eventsList.querySelectorAll("button").forEach(button => button.disabled = false);
        }
    }

    async function addLocationAssignment() {
        if (!selectedEventId) return;
        const locationId = eventAddLocationSelect.value;
        if (!locationId) {
            setEventStatus("Wybierz lokalizację, którą chcesz przypisać.", "error");
            return;
        }
        eventAssignLocationButton.disabled = true;
        setEventStatus("Przypisywanie znajdźki do wydarzenia…", "loading");
        try {
            await getFreshAdminContext();
            await dataApi.assignLocationToEvent(selectedEventId, locationId, null);
            notifyCatalogChanged();
            await refreshManagementData();
            setEventStatus("Przypisano znajdźkę do wydarzenia.", "success");
        } catch (error) {
            console.error("SA Event Maps: Nie udało się przypisać znajdźki.", error);
            setEventStatus(error.message || "Nie udało się przypisać znajdźki.", "error");
        } finally {
            eventAssignLocationButton.disabled = false;
        }
    }

    async function removeEventAssignment(locationId) {
        const location = locations.find(item => item.id === locationId);
        const event = events.find(item => item.id === selectedEventId);
        if (!location || !event) return;
        const accepted = window.confirm(`Usunąć „${location.name}” z wydarzenia „${event.name}”?\n\nUsunięte zostanie tylko przypisanie do tego wydarzenia. Wspólna pinezka i zapisane postępy graczy pozostaną w bazie. Po ponownym przypisaniu wcześniejsze postępy będą nadal widoczne.`);
        if (!accepted) return;
        setEventStatus("Usuwanie przypisania…", "loading");
        try {
            await getFreshAdminContext();
            await dataApi.removeLocationFromEvent(selectedEventId, locationId);
            notifyCatalogChanged();
            await refreshManagementData();
            setEventStatus(`Usunięto przypisanie „${location.name}” z wydarzenia „${event.name}”.`, "success");
        } catch (error) {
            console.error("SA Event Maps: Nie udało się usunąć przypisania.", error);
            setEventStatus(error.message || "Nie udało się usunąć przypisania.", "error");
        }
    }

    async function saveLocation(event) {
        event.preventDefault();
        const name = locationNameInput.value.trim();
        const x = Number(locationXInput.value);
        const y = Number(locationYInput.value);
        const z = locationZInput.value === "" ? null : Number(locationZInput.value);
        if (!name || locationXInput.value === "" || locationYInput.value === "" || !Number.isFinite(x) || !Number.isFinite(y) || (z !== null && !Number.isFinite(z))) {
            setLocationStatus("Podaj nazwę oraz prawidłowe współrzędne X i Y. Z może pozostać puste.", "error");
            return;
        }
        const id = locationIdInput.value.trim();
        const returnEventId = locationReturnEventId;
        const input = {
            name,
            area: locationAreaInput.value.trim() || "Nie określono",
            description: locationDescriptionInput.value.trim(),
            world: {x, y, z}
        };
        const submit = locationForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        submit.textContent = "Zapisywanie…";
        setLocationStatus("Zapisywanie lokalizacji…", "loading");
        try {
            await getFreshAdminContext();
            let saved;
            if (id) {
                saved = await dataApi.updateLocation(id, input);
            } else {
                saved = await dataApi.createLocation(input);
            }

            let assignmentError = null;
            if (!id && returnEventId) {
                try {
                    await dataApi.assignLocationToEvent(returnEventId, saved.id, null);
                } catch (error) {
                    assignmentError = error;
                }
            }
            notifyCatalogChanged();

            hideLocationForm();
            await refreshManagementData();
            if (returnEventId) {
                activateSection("events");
                selectedEventId = returnEventId;
                renderEventAssignments();
                eventAssignmentsCard.hidden = false;
                eventAssignmentsCard.scrollIntoView({behavior:"smooth", block:"start"});
            }
            if (assignmentError) {
                const message = `Utworzono znajdźkę „${saved.name}”, ale nie udało się przypisać jej do wydarzenia: ${assignmentError.message}`;
                setLocationStatus(message, "error");
                if (returnEventId) setEventStatus(message, "error");
            } else {
                const message = id ? `Zapisano zmiany znajdźki „${name}”.` : `Utworzono znajdźkę „${name}”.`;
                setLocationStatus(message, "success");
                if (returnEventId) setEventStatus(`${message} Znajdźka została przypisana do wydarzenia.`, "success");
            }
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać lokalizacji.", error);
            setLocationStatus(error.message || "Nie udało się zapisać lokalizacji.", "error");
        } finally {
            submit.disabled = false;
            submit.textContent = "Zapisz znajdźkę";
        }
    }

    async function handleLocationAction(action, locationId) {
        const location = locations.find(item => item.id === locationId);
        if (!location) {
            setLocationStatus("Nie znaleziono lokalizacji. Odśwież listę.", "error");
            return;
        }
        if (action === "edit") {
            showLocationForm(location);
            return;
        }
        let accepted = true;
        if (action === "pin" || action === "unpin") {
            accepted = window.confirm(`${action === "pin" ? "Zablokować" : "Odblokować"} pinezkę „${location.name}”?\n\n${action === "pin" ? "Gracze nie będą mogli edytować tej lokalizacji." : "Właściciel lokalizacji będzie mógł ponownie edytować własną pinezkę."}`);
        } else if (action === "archive") {
            accepted = window.confirm(`Zarchiwizować lokalizację „${location.name}”?\n\nTo działanie jest globalne: pinezka zostanie ukryta we wszystkich wydarzeniach. Przypisania i postępy graczy zostaną zachowane. Można ją później przywrócić.`);
        } else if (action === "restore") {
            accepted = window.confirm(`Przywrócić lokalizację „${location.name}”?\n\nPinezka ponownie będzie dostępna w przypisanych wydarzeniach.`);
        } else if (action === "delete") {
            accepted = window.confirm(`Trwale usunąć znajdźkę „${location.name}”?\n\nBaza pozwoli na to wyłącznie wtedy, gdy lokalizacja nie jest przypisana do żadnego wydarzenia i nie ma zapisanych postępów graczy. Tej operacji nie można cofnąć.`);
        } else return;
        if (!accepted) return;

        setLocationStatus("Wykonywanie operacji…", "loading");
        locationsList.querySelectorAll("button").forEach(button => button.disabled = true);
        try {
            await getFreshAdminContext();
            if (action === "pin" || action === "unpin") await dataApi.setLocationPinned(locationId, action === "pin");
            else if (action === "archive") await dataApi.archiveLocation(locationId);
            else if (action === "restore") await dataApi.restoreLocation(locationId);
            else if (action === "delete") await dataApi.deleteLocation(locationId);
            notifyCatalogChanged();
            await refreshManagementData();
            const labels = {pin:"Zablokowano",unpin:"Odblokowano",archive:"Zarchiwizowano",restore:"Przywrócono",delete:"Trwale usunięto"};
            setLocationStatus(`${labels[action]} znajdźkę „${location.name}”.`, "success");
        } catch (error) {
            console.error("SA Event Maps: Operacja na lokalizacji nie powiodła się.", error);
            setLocationStatus(error.message || "Nie udało się wykonać operacji na lokalizacji.", "error");
        } finally {
            locationsList.querySelectorAll("button").forEach(button => button.disabled = false);
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

    addEventButton.addEventListener("click", () => showEventForm());
    cancelEventButton.addEventListener("click", hideEventForm);
    eventForm.addEventListener("submit", saveEvent);
    eventSearchInput.addEventListener("input", renderEvents);
    eventFilter.addEventListener("change", renderEvents);
    refreshEventsButton.addEventListener("click", () => void refreshManagementData());
    eventsList.addEventListener("click", event => {
        const button = event.target.closest("button[data-event-action]");
        if (!button || button.disabled) return;
        void handleEventAction(button.dataset.eventAction, button.dataset.recordId);
    });
    closeEventAssignmentsButton.addEventListener("click", () => {
        eventAssignmentsCard.hidden = true;
        selectedEventId = null;
    });
    eventAssignLocationButton.addEventListener("click", () => void addLocationAssignment());
    eventCreateLocationButton.addEventListener("click", () => {
        if (!selectedEventId) return;
        activateSection("locations");
        showLocationForm(null, selectedEventId);
    });
    eventAssignedLocations.addEventListener("click", event => {
        const button = event.target.closest("button[data-assignment-action]");
        if (!button || button.disabled) return;
        if (button.dataset.assignmentAction === "unlink") {
            void removeEventAssignment(button.dataset.recordId);
        } else if (button.dataset.assignmentAction === "edit") {
            const location = locations.find(item => item.id === button.dataset.recordId);
            if (location) {
                activateSection("locations");
                showLocationForm(location);
            }
        }
    });

    addLocationButton.addEventListener("click", () => showLocationForm());
    cancelLocationButton.addEventListener("click", hideLocationForm);
    locationForm.addEventListener("submit", saveLocation);
    locationSearchInput.addEventListener("input", renderLocations);
    locationFilter.addEventListener("change", renderLocations);
    refreshLocationsButton.addEventListener("click", () => void refreshManagementData());
    locationsList.addEventListener("click", event => {
        const button = event.target.closest("button[data-location-action]");
        if (!button || button.disabled) return;
        void handleLocationAction(button.dataset.locationAction, button.dataset.recordId);
    });

    createBackupButton.addEventListener("click", () => void createOrganizationBackupFile());
    backupFileInput.addEventListener("change", () => {
        clearBackupPreview();
        const file = backupFileInput.files?.[0];
        setBackupStatus(file ? `Wybrano plik: ${file.name} (${formatBackupBytes(file.size)}). Kliknij „Sprawdź kopię”, aby zweryfikować zawartość.` : "Nie wybrano pliku kopii.");
    });
    previewBackupButton.addEventListener("click", () => void previewOrganizationBackupFile());
    restoreBackupButton.addEventListener("click", () => void restoreOrganizationBackupFile());

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
