"use strict";

/*
========================================================
SA EVENT MAPS
COMMUNITY COLLECTIBLE CATALOG
========================================================

DATA SOURCE:
Supabase (PostgreSQL + RLS)

MAP:
assets/gtasa-map-shadows.jpg

CALIBRATION:
4096 x 4096

LOCATION IDENTIFIERS:
UUIDs are internal only. No visible location numbering.

========================================================
*/

(() => {
    // ================================================
    // 1. CONFIGURATION
    // ================================================

    const MAP_IMAGE_URL = "assets/gtasa-map-shadows.jpg";
    const IMAGE_WIDTH = 4096;
    const IMAGE_HEIGHT = 4096;

    const GRID_SPACING = 500;
    const GRID_LIMIT = 3000;
    const PAN_DISTANCE = 120;

    const CALIBRATION = {
        gameX: [
            1.4646995104596296,
            0.00027169485400127535,
            -3000.2306191026823
        ],
        gameY: [
            -0.0006535976662411791,
            -1.4681786449442777,
            3006.465088839544
        ]
    };

    const PROGRESS_STATUS = {
        not_found: {
            label: "Nieznaleziona",
            color: "#e34848"
        },
        found: {
            label: "Znaleziono",
            color: "#35b779"
        },
        not_present: {
            label: "Nie ma",
            color: "#242424"
        },
        uncertain: {
            label: "Niepewne",
            color: "#e9bf39"
        }
    };

    // ================================================
    // 2. DEPENDENCIES AND HTML ELEMENTS
    // ================================================

    const byId = id => document.getElementById(id);
    const supabase = window.supabaseClient;
    const dataApi = window.saEventMapsData;
    const mapElement = byId("game-map");
    const appShell = document.querySelector(".app-shell");

    if (!mapElement || !appShell) {
        console.error("SA Event Maps: Brakuje głównego kontenera aplikacji.");
        return;
    }

    if (typeof L === "undefined") {
        mapElement.textContent =
            "Nie udało się załadować Leaflet. Sprawdź połączenie z internetem.";
        return;
    }

    if (!supabase || !dataApi) {
        mapElement.textContent =
            "Nie udało się uruchomić połączenia z Supabase. Odśwież stronę.";
        console.error("SA Event Maps: Brak klienta lub warstwy danych Supabase.");
        return;
    }

    if (mapElement.dataset.initialized === "true") {
        return;
    }

    mapElement.dataset.initialized = "true";

    const elements = {
        storageStatus: byId("storage-status"),

        exportButton: byId("export-locations"),
        importButton: byId("import-locations"),
        importFile: byId("import-file"),

        globalLocationCount: byId("global-location-count"),
        globalEventCount: byId("global-event-count"),

        eventFilter: byId("event-filter"),
        createEvent: byId("create-event"),
        editEvent: byId("edit-event"),
        deleteEvent: byId("delete-event"),
        permanentlyDeleteEvent: byId("permanently-delete-event"),

        eventEditor: byId("event-editor"),
        eventEditorTitle: byId("event-editor-title"),
        eventName: byId("event-name"),
        eventDescription: byId("event-description"),
        eventStart: byId("event-start"),
        eventEnd: byId("event-end"),
        eventOfficialCount: byId("event-official-count"),

        saveEvent: byId("save-event"),
        cancelEvent: byId("cancel-event"),
        eventEditorStatus: byId("event-editor-status"),

        assignEventSelect: byId("assign-event-select"),
        assignLocation: byId("assign-selected-location"),
        removeAssignment: byId("remove-event-assignment"),

        locationCount: byId("location-count"),

        toggleGrid: byId("toggle-grid"),
        gridStatus: byId("grid-status"),
        resetMap: byId("reset-map"),

        readoutX: byId("map-coordinate-x"),
        readoutY: byId("map-coordinate-y"),
        useCoordinates: byId("use-map-coordinates"),
        coordinateStatus: byId("map-coordinate-status"),

        emptyDetails: byId("pin-details"),
        selectedDetails: byId("pin-details-content"),

        selectedName: byId("selected-pin-name"),
        selectedDescription: byId("selected-pin-description"),
        selectedImageContainer: byId("selected-pin-image-container"),
        selectedImage: byId("selected-pin-image"),
        selectedImageOpen: byId("open-selected-pin-image"),
        selectedImageArchivedLabel: byId("selected-pin-image-archived-label"),
        selectedImageAdminActions: byId("selected-pin-image-admin-actions"),
        selectedImageOwnerActions: byId("selected-pin-image-owner-actions"),
        deleteOwnSelectedImage: byId("delete-own-selected-pin-image"),
        archiveSelectedImage: byId("archive-selected-pin-image"),
        restoreSelectedImage: byId("restore-selected-pin-image"),
        deleteSelectedImage: byId("delete-selected-pin-image"),
        imageLightbox: byId("location-image-lightbox"),
        imageLightboxImage: byId("location-image-lightbox-img"),
        closeImageLightbox: byId("close-location-image-lightbox"),
        selectedStatus: byId("pin-status"),
        selectedEvents: byId("selected-pin-events"),

        deleteSelected: byId("delete-selected-pin"),

        addPin: byId("add-pin"),
        clearForm: byId("clear-pin-form"),
        editorStatus: byId("pin-editor-status"),

        locationSearch: byId("location-search"),
        locationSort: byId("location-sort"),
        catalogList: byId("catalog-list"),
        catalogLocationCount: byId("catalog-location-count"),
        catalogStatus: byId("catalog-status"),
        clearCatalogProgress: byId("clear-catalog-progress"),
        clearCatalogProgressDialog: byId("clear-catalog-progress-dialog"),
        cancelClearCatalogProgress: byId("cancel-clear-catalog-progress"),
        confirmClearCatalogProgress: byId("confirm-clear-catalog-progress"),
        clearCatalogProgressStatus: byId("clear-catalog-progress-status")
    };

    const form = {
        name: document.querySelector(".pin-editor #pin-name"),
        area: document.querySelector(".pin-editor #pin-area"),
        x: document.querySelector(".pin-editor #pin-x"),
        y: document.querySelector(".pin-editor #pin-y"),
        z: document.querySelector(".pin-editor #pin-z"),
        description: document.querySelector(".pin-editor #pin-description"),
        imageFile: byId("pin-image-file"),
        imageFileStatus: byId("pin-image-file-status"),
        imageUploadGroup: byId("pin-image-upload-group"),
        coordinateLockNote: byId("pin-coordinate-lock-note")
    };

    const detailFields = {
        area: byId("selected-pin-area"),
        owner: byId("selected-pin-owner"),
        x: byId("selected-pin-x"),
        y: byId("selected-pin-y"),
        z: byId("selected-pin-z")
    };

    const requiredElements = [
        ...Object.values(elements),
        ...Object.values(form),
        ...Object.values(detailFields)
    ];

    if (requiredElements.some(element => !element)) {
        console.error("SA Event Maps: Brakuje elementów interfejsu. Sprawdź index.html.");
        mapElement.textContent =
            "Nie udało się uruchomić aplikacji. Sprawdź zgodność plików.";
        return;
    }

    // ================================================
    // 3. APPLICATION STATE
    // ================================================

    const database = {
        locations: [],
        events: [],
        eventLocations: [],
        categories: [],
        playerProgress: [],
        playerCatalogProgress: []
    };

    let currentUser = null;
    let selectedLocationId = null;
    let selectedMapCoordinate = null;
    let currentFilterId = "all";
    let editingEventId = null;
    let editingLocationId = null;
    let editingLocationHasImage = false;
    let editingLocationCanUploadImage = false;
    let imageUploadsEnabled = true;
    let selectedLocationImage = null;
    let selectedImageRenderToken = 0;

    // ================================================
    // PROFILE DISPLAY NAME EDITOR (TOP BAR)
    // ================================================

    function refreshTopbarDisplayName() {
        const nameElement = document.querySelector(
            ".auth-user-control .auth-user-info strong"
        );
        const nextDisplayName = currentUser?.displayName
            ? String(currentUser.displayName)
            : "";

        // Avoid replacing the text node when the value is already current.
        // This is important because the top-bar observer watches DOM changes.
        if (nameElement && nextDisplayName && nameElement.textContent !== nextDisplayName) {
            nameElement.textContent = nextDisplayName;
        }
    }

    function installTopbarDisplayNameEditor() {
        const authControl = document.querySelector(".auth-user-control");
        const userInfo = authControl?.querySelector(".auth-user-info");
        const nameElement = userInfo?.querySelector("strong");

        if (!authControl || !userInfo || !nameElement) return false;

        if (authControl.querySelector(".auth-profile-name-editor")) {
            refreshTopbarDisplayName();
            return true;
        }

        const editor = document.createElement("div");
        editor.className = "auth-profile-name-editor";

        const changeButton = document.createElement("button");
        changeButton.type = "button";
        changeButton.className = "auth-profile-name-trigger";
        changeButton.textContent = "Zmień nazwę";
        changeButton.setAttribute("aria-expanded", "false");
        changeButton.setAttribute("aria-label", "Zmień swój pseudonim");

        const formElement = document.createElement("form");
        formElement.className = "auth-profile-name-form";
        formElement.hidden = true;

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.maxLength = 80;
        nameInput.minLength = 2;
        nameInput.required = true;
        nameInput.autocomplete = "nickname";
        nameInput.placeholder = "Nowy pseudonim";
        nameInput.setAttribute("aria-label", "Nowy pseudonim");

        const saveButton = document.createElement("button");
        saveButton.type = "submit";
        saveButton.className = "auth-profile-name-save";
        saveButton.textContent = "Zatwierdź";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "auth-profile-name-cancel";
        cancelButton.textContent = "Anuluj";

        const status = document.createElement("div");
        status.className = "auth-profile-name-status";
        status.hidden = true;
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");

        formElement.append(nameInput, saveButton, cancelButton);
        editor.append(changeButton, formElement, status);
        authControl.insertBefore(editor, userInfo);

        const closeEditor = () => {
            formElement.hidden = true;
            changeButton.hidden = false;
            changeButton.setAttribute("aria-expanded", "false");
            nameInput.value = currentUser?.displayName || nameElement.textContent || "";
            status.hidden = true;
            status.textContent = "";
            status.classList.remove("is-error", "is-success");
            saveButton.disabled = false;
            cancelButton.disabled = false;
            nameInput.disabled = false;
        };

        changeButton.addEventListener("click", () => {
            if (!currentUser) return;
            nameInput.value = currentUser.displayName || nameElement.textContent || "";
            status.hidden = true;
            status.textContent = "";
            status.classList.remove("is-error", "is-success");
            changeButton.hidden = true;
            formElement.hidden = false;
            changeButton.setAttribute("aria-expanded", "true");
            nameInput.focus();
            nameInput.select();
        });

        cancelButton.addEventListener("click", closeEditor);

        formElement.addEventListener("submit", async event => {
            event.preventDefault();
            const nextName = nameInput.value.trim();
            const nextLength = Array.from(nextName).length;

            status.hidden = true;
            status.classList.remove("is-error", "is-success");

            if (nextLength < 2 || nextLength > 80) {
                status.textContent = "Pseudonim musi mieć od 2 do 80 znaków.";
                status.classList.add("is-error");
                status.hidden = false;
                nameInput.focus();
                return;
            }

            if (!currentUser || !dataReady) {
                status.textContent = "Poczekaj, aż profil użytkownika zostanie wczytany.";
                status.classList.add("is-error");
                status.hidden = false;
                return;
            }

            saveButton.disabled = true;
            cancelButton.disabled = true;
            nameInput.disabled = true;

            try {
                const savedName = await dataApi.updateMyDisplayName(nextName);
                currentUser.displayName = savedName;
                refreshTopbarDisplayName();
                const selectedLocation = getLocationById(selectedLocationId);
                if (selectedLocation?.createdBy === currentUser.id) {
                    detailFields.owner.textContent = savedName;
                }
                closeEditor();
                status.textContent = "Pseudonim został zmieniony.";
                status.classList.add("is-success");
                status.hidden = false;
            } catch (error) {
                status.textContent = error.message || "Nie udało się zmienić pseudonimu.";
                status.classList.add("is-error");
                status.hidden = false;
                nameInput.disabled = false;
                saveButton.disabled = false;
                cancelButton.disabled = false;
                nameInput.focus();
            }
        });

        refreshTopbarDisplayName();
        return true;
    }

    function observeTopbarAccountControl() {
        installTopbarDisplayNameEditor();

        const observer = new MutationObserver(() => {
            const authControl = document.querySelector(".auth-user-control");
            const nameElement = authControl?.querySelector(".auth-user-info strong");
            const editorExists = authControl?.querySelector(".auth-profile-name-editor");

            // Retry only while the account control exists but the editor has
            // not been installed yet. Inserting/updating our own editor must
            // never trigger another installation cycle.
            if (authControl && nameElement && !editorExists) {
                installTopbarDisplayNameEditor();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    let imageWidth = 0;
    let imageHeight = 0;
    let imageBounds = null;
    let mapReady = false;
    let dataReady = false;

    let gridLayer = null;
    let gridVisible = false;
    let bootstrapPromise = null;
    let helpDocumentsLoaded = false;
    let helpDocumentSections = [];
    let activeHelpDocumentType = "instructions";
    let helpWorkspaceScrollPosition = 0;
    let helpReturnNavigationButton = null;

    // ================================================
    // 4. SMALL HELPERS
    // ================================================

    function formatCoordinate(value) {
        return Number(value).toFixed(3);
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[character]);
    }

    function setEditorStatus(message) {
        elements.editorStatus.textContent = String(message ?? "");
    }

    function updateImageUploadAvailability() {
        const isEditingLocation = Boolean(editingLocationId);
        const hasImage = isEditingLocation && editingLocationHasImage;
        const canUpload = isEditingLocation
            ? editingLocationCanUploadImage
            : Boolean(currentUser?.isAdmin || imageUploadsEnabled);

        if (form.imageFile) {
            form.imageFile.disabled = !canUpload || hasImage;
        }
        if (form.imageUploadGroup) {
            form.imageUploadGroup.hidden = false;
        }
        if (form.imageFileStatus) {
            if (hasImage) {
                form.imageFileStatus.textContent = isAdmin()
                    ? "Ta znajdźka ma już zdjęcie. Aby dodać inne, najpierw usuń obecne z podglądu w prawym panelu za pomocą przycisku administratora."
                    : "Ta znajdźka ma już zdjęcie. Aby dodać inne, usuń obecne przyciskiem „Usuń swoje zdjęcie” w prawym panelu. Ta możliwość jest dostępna tylko przed przypięciem pinezki.";
            } else if (!canUpload) {
                form.imageFileStatus.textContent = "Administrator zablokował dodawanie nowych zdjęć. Istniejące zdjęcia pozostają widoczne.";
            } else if (isEditingLocation) {
                form.imageFileStatus.textContent = "Ta znajdźka nie ma zdjęcia. Możesz dodać jedno teraz — zostanie automatycznie skompresowane do WebP.";
            } else {
                form.imageFileStatus.textContent = "Opcjonalnie — jedno zdjęcie na znajdźkę. Zostanie automatycznie zmniejszone do WebP przed wysłaniem.";
            }
        }
    }

    async function prepareImageForLocation(file) {
        if (!file) return null;
        const settings = await dataApi.getImageUploadSettings();
        if (!settings.allowPlayerUploads && !currentUser?.isAdmin) {
            return { blocked: true };
        }
        return dataApi.prepareLocationImage(file);
    }

    async function renderSelectedLocationImage(locationId) {
        const token = ++selectedImageRenderToken;
        selectedLocationImage = null;
        elements.selectedImageContainer.hidden = true;
        elements.selectedImageAdminActions.hidden = true;
        elements.selectedImageOwnerActions.hidden = true;
        elements.selectedImageArchivedLabel.hidden = true;
        elements.selectedImage.removeAttribute("src");
        if (!locationId) return;

        try {
            const image = await dataApi.getLocationImage(locationId);
            if (token !== selectedImageRenderToken || selectedLocationId !== locationId) return;
            if (!image) return;

            selectedLocationImage = image;
            elements.selectedImage.src = image.signedUrl;
            elements.selectedImage.alt = `Zdjęcie znajdźki: ${elements.selectedName.textContent}`;
            elements.selectedImageContainer.hidden = false;
            elements.selectedImageArchivedLabel.hidden = !image.is_archived;
            const imageLocation = getLocationById(locationId);
            const ownerCanDeleteImage = Boolean(
                !isAdmin() &&
                imageLocation &&
                imageLocation.createdBy === currentUser?.id &&
                !imageLocation.isPinned &&
                !imageLocation.isArchived &&
                !imageLocation.isDeletionPending
            );
            elements.selectedImageAdminActions.hidden = !isAdmin() || Boolean(imageLocation?.isDeletionPending);
            elements.selectedImageOwnerActions.hidden = !ownerCanDeleteImage;
            elements.deleteOwnSelectedImage.disabled = !ownerCanDeleteImage;
            elements.archiveSelectedImage.hidden = image.is_archived;
            elements.restoreSelectedImage.hidden = !image.is_archived;
            updateImageUploadAvailability();
        } catch (error) {
            console.warn("SA Event Maps: Nie udało się wczytać zdjęcia znajdźki.", error);
        }
    }

    async function openLocationImageLightbox() {
        if (!selectedLocationId || !selectedLocationImage?.signedUrl) return;
        try {
            const refreshedImage = await dataApi.getLocationImage(selectedLocationId);
            if (!refreshedImage?.signedUrl || refreshedImage.id !== selectedLocationImage.id) return;
            selectedLocationImage = refreshedImage;
            elements.selectedImage.src = refreshedImage.signedUrl;
            elements.imageLightboxImage.src = refreshedImage.signedUrl;
            elements.imageLightboxImage.alt = `Pełny podgląd: ${elements.selectedName.textContent}`;
            elements.imageLightbox.hidden = false;
            document.body.classList.add("has-image-lightbox");
            elements.closeImageLightbox.focus();
        } catch (error) {
            setEditorStatus(error.message || "Nie udało się otworzyć zdjęcia.");
        }
    }

    function closeLocationImageLightbox() {
        elements.imageLightbox.hidden = true;
        elements.imageLightboxImage.removeAttribute("src");
        document.body.classList.remove("has-image-lightbox");
        elements.selectedImageOpen.focus({ preventScroll: true });
    }

    async function runSelectedImageAction(action) {
        const location = getLocationById(selectedLocationId);
        if (!location || !selectedLocationImage || location.isDeletionPending) return;

        const isOwner = location.createdBy === currentUser?.id;
        const ownerCanDelete = isOwner && !location.isPinned && !location.isArchived;
        if ((action === "archive" || action === "restore") && !isAdmin()) return;
        if (action === "delete" && !isAdmin() && !ownerCanDelete) return;
        if (!(action === "archive" || action === "restore" || action === "delete")) return;

        const image = selectedLocationImage;
        if (action === "delete") {
            const message = isAdmin()
                ? `Czy na pewno trwale usunąć zdjęcie znajdźki „${elements.selectedName.textContent}”?\n\nPlik zostanie usunięty z prywatnego Supabase Storage. Sama pinezka, jej przypisania i postępy pozostaną bez zmian.`
                : `Czy na pewno usunąć Twoje zdjęcie znajdźki „${elements.selectedName.textContent}”?\n\nUsunięty zostanie wyłącznie plik zdjęcia i jego metadane. Pinezka, przypisania do wydarzeń oraz postępy wszystkich graczy pozostaną bez zmian.\n\nPo usunięciu będzie można dodać nowe zdjęcie, dopóki pinezka pozostaje nieprzypięta.`;
            if (!window.confirm(message)) return;
        }

        const actionButtons = [
            elements.archiveSelectedImage,
            elements.restoreSelectedImage,
            elements.deleteSelectedImage,
            elements.deleteOwnSelectedImage
        ];

        try {
            actionButtons.forEach(button => { button.disabled = true; });
            if (action === "archive") await dataApi.archiveLocationImage(image.id);
            if (action === "restore") await dataApi.restoreLocationImage(image.id);
            if (action === "delete") await dataApi.deleteLocationImage(image.id);

            selectedLocationImage = null;
            if (action === "delete" && editingLocationId === selectedLocationId) {
                editingLocationHasImage = false;
                editingLocationCanUploadImage = Boolean(currentUser?.isAdmin || imageUploadsEnabled);
                try {
                    const imageState = await dataApi.getLocationImageUploadState(selectedLocationId);
                    editingLocationHasImage = imageState.hasImage;
                    editingLocationCanUploadImage = imageState.canUpload;
                    imageUploadsEnabled = imageState.playerUploadsEnabled;
                } catch (stateError) {
                    console.warn("SA Event Maps: Nie udało się odświeżyć stanu pola zdjęcia po usunięciu.", stateError);
                }
                form.imageFile.value = "";
                updateImageUploadAvailability();
            }
            await renderSelectedLocationImage(selectedLocationId);
            setEditorStatus(
                action === "archive" ? "Zdjęcie zostało zarchiwizowane. Plik nadal zajmuje miejsce w Storage." :
                action === "restore" ? "Zdjęcie zostało przywrócone." :
                "Zdjęcie zostało trwale usunięte. Możesz dodać nowe, jeśli pinezka nadal jest nieprzypięta."
            );
        } catch (error) {
            console.error("SA Event Maps: Operacja na zdjęciu nie powiodła się.", error);
            setEditorStatus(error.message || "Nie udało się wykonać operacji na zdjęciu.");
        } finally {
            actionButtons.forEach(button => { button.disabled = false; });
            updateImageUploadAvailability();
        }
    }

    function setCoordinateStatus(message) {
        elements.coordinateStatus.textContent = String(message ?? "");
    }

    function setCatalogStatus(message) {
        elements.catalogStatus.textContent = String(message ?? "");
    }

    function updateStorageStatus(message, success = true) {
        elements.storageStatus.textContent = message;

        const dot = document.querySelector(".sidebar-footer .status-dot");
        if (dot) {
            dot.style.background = success ? "#65d6a3" : "#ed7777";
        }
    }

    function isAdmin() {
        return currentUser?.role === "admin";
    }

    function getLocationById(locationId) {
        return database.locations.find(item => item.id === locationId) || null;
    }

    function getEventById(eventId) {
        return database.events.find(item => item.id === eventId) || null;
    }

    function getEventLocation(eventId, locationId) {
        return database.eventLocations.find(
            item => item.eventId === eventId && item.locationId === locationId
        ) || null;
    }

    function locationBelongsToEvent(locationId, eventId) {
        return Boolean(getEventLocation(eventId, locationId));
    }

    function getEventsForLocation(locationId) {
        const eventIds = new Set(
            database.eventLocations
                .filter(item => item.locationId === locationId)
                .map(item => item.eventId)
        );

        return database.events.filter(event => eventIds.has(event.id));
    }

    function getLocationsForEvent(eventId) {
        const ids = new Set(
            database.eventLocations
                .filter(item => item.eventId === eventId)
                .map(item => item.locationId)
        );

        return database.locations.filter(location => ids.has(location.id));
    }

    function getProgress(eventId, locationId) {
        return database.playerProgress.find(
            item =>
                item.userId === currentUser?.id &&
                item.eventId === eventId &&
                item.locationId === locationId
        ) || {
            userId: currentUser?.id || null,
            eventId,
            locationId,
            status: "not_found",
            needsCheck: false
        };
    }

    function getCatalogProgress(locationId) {
        return database.playerCatalogProgress.find(
            item => item.userId === currentUser?.id && item.locationId === locationId
        ) || {
            userId: currentUser?.id || null,
            locationId,
            status: "not_found",
            needsCheck: false
        };
    }

    function getProgressContextEventId() {
        if (currentFilterId !== "all") {
            return currentFilterId;
        }

        // In the global catalog this selector is only for assigning/removing
        // a location from an event. Global-catalog progress is independent.
        return elements.assignEventSelect.value || null;
    }

    function getFoundCountForEvent(eventId) {
        const assignedLocationIds = new Set(
            database.eventLocations
                .filter(item => item.eventId === eventId)
                .map(item => item.locationId)
        );

        return database.playerProgress.filter(
            item =>
                item.eventId === eventId &&
                item.status === "found" &&
                assignedLocationIds.has(item.locationId)
        ).length;
    }

    function canEditLocation(location) {
        if (!location || location.isArchived || location.isDeletionPending) return false;
        if (isAdmin()) return true;

        return (
            !location.isPinned &&
            location.createdBy === currentUser?.id
        );
    }

    function canMoveLocation(location) {
        return Boolean(
            canEditLocation(location) &&
            !location.isPinned &&
            !location.isArchived
        );
    }

    function getVisibleLocations() {
        const available = database.locations.filter(
            location => !location.isArchived || isAdmin()
        );

        if (currentFilterId === "all") {
            return available;
        }

        return available.filter(location =>
            locationBelongsToEvent(location.id, currentFilterId)
        );
    }

    function updateGlobalCounters() {
        elements.globalLocationCount.textContent =
            database.locations.filter(item => !item.isArchived).length;

        elements.globalEventCount.textContent =
            database.events.filter(item => item.status !== "archived").length;
    }

    // ================================================
    // 5. COORDINATE CONVERSION
    // ================================================

    function pixelToWorld(pixelX, pixelY) {
        return {
            x:
                CALIBRATION.gameX[0] * pixelX +
                CALIBRATION.gameX[1] * pixelY +
                CALIBRATION.gameX[2],
            y:
                CALIBRATION.gameY[0] * pixelX +
                CALIBRATION.gameY[1] * pixelY +
                CALIBRATION.gameY[2]
        };
    }

    function worldToPixel(worldX, worldY) {
        const a = CALIBRATION.gameX[0];
        const b = CALIBRATION.gameX[1];
        const c = CALIBRATION.gameX[2];
        const d = CALIBRATION.gameY[0];
        const e = CALIBRATION.gameY[1];
        const f = CALIBRATION.gameY[2];

        const determinant = a * e - b * d;

        if (Math.abs(determinant) < 1e-15) {
            throw new Error("Nie można odwrócić kalibracji.");
        }

        const dx = worldX - c;
        const dy = worldY - f;

        return {
            x: (e * dx - b * dy) / determinant,
            y: (-d * dx + a * dy) / determinant
        };
    }

    function worldToLatLng(worldX, worldY) {
        const pixel = worldToPixel(worldX, worldY);

        if (!isPixelInsideImage(pixel.x, pixel.y)) {
            return null;
        }

        return [
            imageHeight - pixel.y,
            pixel.x
        ];
    }

    function isPixelInsideImage(x, y) {
        return (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            x >= 0 &&
            x <= imageWidth &&
            y >= 0 &&
            y <= imageHeight
        );
    }

    function parseOptionalNumber(value) {
        const text = String(value).trim();

        if (text === "") return null;

        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    // ================================================
    // 7. DYNAMIC DETAIL CONTROLS
    // ================================================

    let progressPanel = null;
    let progressSelect = null;
    let needsCheckInput = null;
    let editLocationButton = null;
    let pinLocationButton = null;
    let permanentlyDeleteLocationButton = null;

    function ensureProgressPanel() {
        if (progressPanel) return;

        progressPanel = document.createElement("section");
        progressPanel.className = "progress-editor";
        progressPanel.innerHTML = `
            <div class="eyebrow">POSTĘP W WYDARZENIU</div>
            <div class="progress-context" id="progress-context-label">
                Wybierz wydarzenie, aby zmienić status.
            </div>
            <div class="form-field">
                <label for="progress-status-select">STATUS ZNAJDŹKI</label>
                <select id="progress-status-select">
                    <option value="not_found">Nieznaleziona</option>
                    <option value="found">Znaleziono</option>
                    <option value="not_present">Nie ma</option>
                    <option value="uncertain">Niepewne</option>
                </select>
            </div>
            <label class="needs-check-control" for="progress-needs-check">
                <input id="progress-needs-check" type="checkbox">
                <span>Do sprawdzenia</span>
            </label>
            <div class="progress-help" id="progress-help">
                Status jest indywidualny dla Ciebie i wybranego wydarzenia.
            </div>
        `;

        const detailsData = elements.selectedDetails.querySelector(".details-data");
        const eventAssignment = elements.selectedDetails.querySelector(".event-assignment");

        if (detailsData && eventAssignment) {
            elements.selectedDetails.insertBefore(progressPanel, eventAssignment);
        } else {
            elements.selectedDetails.appendChild(progressPanel);
        }

        progressSelect = byId("progress-status-select");
        needsCheckInput = byId("progress-needs-check");

        progressSelect.addEventListener("change", () => {
            void saveSelectedProgress();
        });

        needsCheckInput.addEventListener("change", () => {
            void saveSelectedProgress();
        });
    }

    function ensureDetailActionButtons() {
        const actions = elements.selectedDetails.querySelector(".details-actions");
        if (!actions) return;

        if (!editLocationButton) {
            editLocationButton = document.createElement("button");
            editLocationButton.type = "button";
            editLocationButton.id = "edit-selected-pin";
            editLocationButton.className = "secondary-location-action";
            editLocationButton.textContent = "Edytuj własną znajdźkę";
            editLocationButton.addEventListener("click", () => {
                void beginEditSelectedLocation();
            });
            actions.prepend(editLocationButton);
        }

        if (!permanentlyDeleteLocationButton) {
            permanentlyDeleteLocationButton = document.createElement("button");
            permanentlyDeleteLocationButton.type = "button";
            permanentlyDeleteLocationButton.id = "permanently-delete-selected-pin";
            permanentlyDeleteLocationButton.className = "danger-location-action permanently-delete-location-action";
            permanentlyDeleteLocationButton.textContent = "Usuń znajdźkę na stałe";
            permanentlyDeleteLocationButton.addEventListener("click", () => {
                void permanentlyDeleteSelectedLocation();
            });
            editLocationButton.after(permanentlyDeleteLocationButton);
        }

        if (!pinLocationButton) {
            pinLocationButton = document.createElement("button");
            pinLocationButton.type = "button";
            pinLocationButton.id = "toggle-selected-pin";
            pinLocationButton.className = "secondary-location-action";
            pinLocationButton.textContent = "Zatwierdź i przypnij pinezkę";
            pinLocationButton.addEventListener("click", () => {
                void toggleSelectedPin();
            });
            actions.prepend(pinLocationButton);
        }

        elements.deleteSelected.textContent = "Archiwizuj znajdźkę";
    }

    // ================================================
    // 8. STATUS AND EVENT CONTEXT
    // ================================================

    function renderProgressEditor(location) {
        ensureProgressPanel();

        const contextEventId = getProgressContextEventId();
        const contextEvent = contextEventId ? getEventById(contextEventId) : null;
        const contextLabel = byId("progress-context-label");
        const help = byId("progress-help");
        const heading = progressPanel.querySelector(".eyebrow");
        if (heading) {
            heading.textContent = currentFilterId === "all"
                ? "POSTĘP W KATALOGU"
                : "POSTĘP W WYDARZENIU";
        }

        if (currentFilterId === "all") {
            const progress = getCatalogProgress(location.id);

            progressSelect.value = progress.status || "not_found";
            needsCheckInput.checked = Boolean(progress.needsCheck);
            progressSelect.disabled = Boolean(location.isArchived || location.isDeletionPending);
            needsCheckInput.disabled = Boolean(location.isArchived || location.isDeletionPending);

            contextLabel.textContent = "Wszystkie respy znajdziek";
            help.textContent = location.isDeletionPending
                ? "Trwa trwałe usuwanie tej lokalizacji. Zmiana statusów jest chwilowo zablokowana."
                : location.isArchived
                    ? "Zarchiwizowana lokalizacja jest tylko do odczytu."
                    : "Te statusy są wyłącznie Twoje. Nie przypisują znajdźki do wydarzenia ani nie zmieniają jego postępu.";

            elements.selectedStatus.textContent =
                `${PROGRESS_STATUS[progress.status]?.label || "Nieznaleziona"}${progress.needsCheck ? " · Do sprawdzenia" : ""}`;
            return;
        }

        if (!contextEvent) {
            progressSelect.disabled = true;
            needsCheckInput.disabled = true;
            contextLabel.textContent = "Wybierz wydarzenie, aby zmienić status.";
            help.textContent = "Postęp jest zapisywany osobno dla każdego wydarzenia.";
            elements.selectedStatus.textContent = "—";
            return;
        }

        const archived = contextEvent.status === "archived";
        const progress = getProgress(contextEvent.id, location.id);

        progressSelect.value = progress.status || "not_found";
        needsCheckInput.checked = Boolean(progress.needsCheck);

        progressSelect.disabled = archived || location.isArchived || location.isDeletionPending;
        needsCheckInput.disabled = archived || location.isArchived || location.isDeletionPending;

        contextLabel.textContent = `Wydarzenie: ${contextEvent.name}`;
        help.textContent = location.isDeletionPending
            ? "Trwa trwałe usuwanie tej lokalizacji. Zmiana statusów jest chwilowo zablokowana."
            : archived
                ? "Zarchiwizowane wydarzenie jest tylko do odczytu."
                : "Zmiana dotyczy wyłącznie Twojego postępu w tym wydarzeniu.";

        elements.selectedStatus.textContent =
            `${PROGRESS_STATUS[progress.status]?.label || "Nieznaleziona"}${progress.needsCheck ? " · Do sprawdzenia" : ""}`;
    }

    async function saveSelectedProgress() {
        const location = getLocationById(selectedLocationId);
        if (!location || !progressSelect || !needsCheckInput) return;

        const status = progressSelect.value;
        const needsCheck = needsCheckInput.checked;

        if (currentFilterId === "all") {
            if (location.isArchived) {
                setEditorStatus("Nie można zmieniać postępu zarchiwizowanej lokalizacji.");
                renderProgressEditor(location);
                return;
            }

            try {
                const saved = await dataApi.setCatalogProgress(
                    location.id,
                    status,
                    needsCheck
                );

                database.playerCatalogProgress = database.playerCatalogProgress.filter(
                    item => !(item.userId === saved.userId && item.locationId === saved.locationId)
                );
                database.playerCatalogProgress.push(saved);

                renderProgressEditor(location);
                renderLocationMarkers();
                renderCatalog();

                setEditorStatus(
                    `Zapisano status „${PROGRESS_STATUS[status].label}” w katalogu „Wszystkie respy”.`
                );
            } catch (error) {
                console.error("SA Event Maps: Nie udało się zapisać postępu katalogowego.", error);
                setEditorStatus(error.message || "Nie udało się zapisać statusu katalogowego.");
                renderProgressEditor(location);
            }
            return;
        }

        const eventId = currentFilterId;
        const event = getEventById(eventId);
        if (!event) return;

        if (event.status === "archived") {
            setEditorStatus("Nie można zmieniać postępu w zarchiwizowanym wydarzeniu.");
            renderProgressEditor(location);
            return;
        }

        try {
            const saved = await dataApi.setProgress(
                event.id,
                location.id,
                status,
                needsCheck
            );

            database.playerProgress = database.playerProgress.filter(
                item => !(
                    item.userId === saved.userId &&
                    item.eventId === saved.eventId &&
                    item.locationId === saved.locationId
                )
            );
            database.playerProgress.push(saved);

            renderProgressEditor(location);
            renderLocationMarkers();
            renderCatalog();
            renderEventSelectors();

            setEditorStatus(
                `Zapisano status „${PROGRESS_STATUS[status].label}” dla wydarzenia „${event.name}”.`
            );
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać postępu.", error);
            setEditorStatus(error.message || "Nie udało się zapisać statusu.");
            renderProgressEditor(location);
        }
    }

    let ownerNameRequestToken = 0;

    async function refreshLocationOwnerName(location) {
        const token = ++ownerNameRequestToken;
        if (!location?.createdBy) {
            detailFields.owner.textContent = "Nieznany użytkownik";
            return;
        }

        // Show the current user's live session name immediately. For other
        // creators fetch the current profile name whenever the pin is opened.
        if (location.createdBy === currentUser?.id) {
            detailFields.owner.textContent = currentUser.displayName || "Nieznany użytkownik";
            return;
        }

        detailFields.owner.textContent = "Ładowanie…";
        try {
            const displayName = await dataApi.getProfileDisplayName(location.createdBy);
            if (token !== ownerNameRequestToken || selectedLocationId !== location.id) return;
            detailFields.owner.textContent = displayName || "Nieznany użytkownik";
        } catch (error) {
            console.warn("SA Event Maps: Nie udało się pobrać pseudonimu właściciela znajdźki.", error);
            if (token !== ownerNameRequestToken || selectedLocationId !== location.id) return;
            detailFields.owner.textContent = "Nie udało się wczytać";
        }
    }

    // ================================================
    // 9. EVENT HELPERS AND SELECTORS
    // ================================================

    function renderEventSelectors() {
        const previousContext = elements.assignEventSelect.value;
        elements.eventFilter.replaceChildren();
        elements.assignEventSelect.replaceChildren();

        const allOption = document.createElement("option");
        allOption.value = "all";
        allOption.textContent = "Wszystkie respy znajdziek";
        elements.eventFilter.appendChild(allOption);

        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "Wybierz wydarzenie";
        elements.assignEventSelect.appendChild(emptyOption);

        database.events.forEach(event => {
            const found = getFoundCountForEvent(event.id);
            const official = event.officialCollectibleCount;
            const progressLabel = official === null || official === undefined
                ? `${found} znalezionych`
                : `${found}/${official}`;

            const suffix = event.status === "archived" ? " · archiwum" : "";
            const label = `${event.name} (${progressLabel})${suffix}`;

            const filterOption = document.createElement("option");
            filterOption.value = event.id;
            filterOption.textContent = label;
            elements.eventFilter.appendChild(filterOption);

            if (event.status !== "archived") {
                const assignmentOption = document.createElement("option");
                assignmentOption.value = event.id;
                assignmentOption.textContent = label;
                elements.assignEventSelect.appendChild(assignmentOption);
            }
        });

        if (
            currentFilterId !== "all" &&
            !getEventById(currentFilterId)
        ) {
            currentFilterId = "all";
        }

        elements.eventFilter.value = currentFilterId;

        if (currentFilterId !== "all") {
            elements.assignEventSelect.value = currentFilterId;
            elements.assignEventSelect.disabled = true;
        } else {
            elements.assignEventSelect.disabled = false;
            elements.assignEventSelect.value =
                [...elements.assignEventSelect.options].some(
                    option => option.value === previousContext
                )
                    ? previousContext
                    : "";
        }

        const selectedEvent = getEventById(currentFilterId);
        const canManageEvent = isAdmin() &&
            currentFilterId !== "all" &&
            selectedEvent &&
            selectedEvent.status !== "archived";

        elements.createEvent.hidden = !isAdmin();
        elements.editEvent.hidden = !isAdmin();
        elements.deleteEvent.hidden = !isAdmin();
        elements.permanentlyDeleteEvent.hidden =
            !isAdmin() || currentFilterId === "all" || !selectedEvent;

        elements.editEvent.disabled = !canManageEvent;
        elements.deleteEvent.disabled = !canManageEvent;
        elements.deleteEvent.textContent = "Archiwizuj event";
        elements.permanentlyDeleteEvent.disabled =
            !isAdmin() || currentFilterId === "all" || !selectedEvent;

        if (selectedEvent?.status === "archived") {
            elements.editEvent.disabled = true;
            elements.deleteEvent.disabled = true;
        }

        updateAssignmentControls();
    }

    function updateAssignmentControls() {
        const location = getLocationById(selectedLocationId);
        const eventId = getProgressContextEventId();
        const event = eventId ? getEventById(eventId) : null;

        const activeEvent = event && event.status !== "archived";
        const alreadyAssigned = location && event
            ? locationBelongsToEvent(location.id, event.id)
            : false;

        elements.assignLocation.disabled =
            !location || !activeEvent || alreadyAssigned || location.isArchived || location.isDeletionPending;

        elements.removeAssignment.hidden = !isAdmin();
        elements.removeAssignment.disabled =
            !isAdmin() || !location || !activeEvent || !alreadyAssigned || location.isDeletionPending;

        if (!location || !event) {
            elements.assignLocation.textContent = "Przypisz do eventu";
        } else if (alreadyAssigned) {
            elements.assignLocation.textContent = "Już przypisano";
        } else {
            elements.assignLocation.textContent = "Przypisz do eventu";
        }
    }

    // ================================================
    // 10. EVENT EDITOR
    // ================================================

    function openEventEditor(mode, event = null) {
        if (!isAdmin()) return;

        editingEventId = event?.id || null;
        elements.eventEditor.hidden = false;
        elements.eventEditorTitle.textContent =
            mode === "edit" ? "Edytuj event" : "Nowy event";

        elements.eventName.value = event?.name || "";
        elements.eventDescription.value = event?.description || "";
        elements.eventStart.value = event?.startDate || "";
        elements.eventEnd.value = event?.endDate || "";
        elements.eventOfficialCount.value =
            event?.officialCollectibleCount ?? "";

        elements.eventEditorStatus.textContent =
            mode === "edit"
                ? "Zmień informacje o wydarzeniu i zapisz."
                : "Wpisz nazwę, opis oraz opcjonalną oficjalną liczbę znajdziek.";

        elements.eventName.focus();
    }

    function closeEventEditor() {
        elements.eventEditor.hidden = true;
        elements.eventName.value = "";
        elements.eventDescription.value = "";
        elements.eventStart.value = "";
        elements.eventEnd.value = "";
        elements.eventOfficialCount.value = "";
        editingEventId = null;
    }

    async function saveEvent() {
        if (!isAdmin()) return;

        const name = elements.eventName.value.trim();
        const description = elements.eventDescription.value.trim();
        const startDate = elements.eventStart.value;
        const endDate = elements.eventEnd.value;
        const officialText = elements.eventOfficialCount.value.trim();

        if (!name) {
            elements.eventEditorStatus.textContent = "Podaj nazwę wydarzenia.";
            return;
        }

        if (startDate && endDate && endDate < startDate) {
            elements.eventEditorStatus.textContent =
                "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.";
            return;
        }

        if (officialText !== "" && (
            !Number.isInteger(Number(officialText)) ||
            Number(officialText) < 0
        )) {
            elements.eventEditorStatus.textContent =
                "Oficjalna liczba znajdziek musi być liczbą całkowitą nieujemną.";
            return;
        }

        const payload = {
            name,
            description,
            startDate,
            endDate,
            officialCollectibleCount: officialText === "" ? null : Number(officialText)
        };

        elements.saveEvent.disabled = true;

        try {
            if (editingEventId) {
                const updated = await dataApi.updateEvent(editingEventId, payload);
                database.events = database.events.map(
                    item => item.id === updated.id ? updated : item
                );
                setEditorStatus(`Zaktualizowano event „${updated.name}”.`);
            } else {
                const created = await dataApi.createEvent(payload);
                database.events.push(created);
                currentFilterId = created.id;
                setEditorStatus(`Utworzono event „${created.name}”.`);
            }

            closeEventEditor();
            renderApplication();
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać eventu.", error);
            elements.eventEditorStatus.textContent =
                error.message || "Nie udało się zapisać wydarzenia.";
        } finally {
            elements.saveEvent.disabled = false;
        }
    }

    async function archiveCurrentEvent() {
        if (!isAdmin()) return;

        const event = getEventById(currentFilterId);
        if (!event || event.status === "archived") return;

        const confirmation = window.confirm(
            `Czy zarchiwizować wydarzenie „${event.name}”?\n\n` +
            "Wydarzenie zostanie ukryte przed graczami. Przypisane lokalizacje pozostaną w katalogu głównym."
        );

        if (!confirmation) return;

        elements.deleteEvent.disabled = true;

        try {
            await dataApi.archiveEvent(event.id);
            event.statusBeforeArchive = event.status;
            event.status = "archived";
            event.archivedAt = new Date().toISOString();
            currentFilterId = "all";
            renderApplication();
            closeEventEditor();
            setEditorStatus(`Zarchiwizowano event „${event.name}”.`);
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zarchiwizować eventu.", error);
            setEditorStatus(error.message || "Nie udało się zarchiwizować wydarzenia.");
        } finally {
            elements.deleteEvent.disabled = false;
        }
    }

    async function permanentlyDeleteCurrentEvent() {
        if (!isAdmin() || currentFilterId === "all") return;

        const event = getEventById(currentFilterId);
        if (!event) return;

        const assignmentCount = database.eventLocations.filter(
            item => item.eventId === event.id
        ).length;
        const accepted = window.confirm(
            `Trwale usunąć wydarzenie „${event.name}”?\n\n` +
            `Usunięte zostaną przypisania ${assignmentCount} znajdziek oraz wszystkie osobiste statusy graczy zapisane dla tego wydarzenia.\n\n` +
            "Globalne pinezki, ich zdjęcia oraz osobiste postępy w „Wszystkich respach” pozostaną bez zmian.\n\n" +
            "Tej operacji nie można cofnąć."
        );
        if (!accepted) return;

        elements.permanentlyDeleteEvent.disabled = true;
        elements.editEvent.disabled = true;
        elements.deleteEvent.disabled = true;

        try {
            await dataApi.deleteEvent(event.id);

            database.events = database.events.filter(item => item.id !== event.id);
            database.eventLocations = database.eventLocations.filter(item => item.eventId !== event.id);
            database.playerProgress = database.playerProgress.filter(item => item.eventId !== event.id);

            if (editingEventId === event.id) closeEventEditor();
            currentFilterId = "all";
            renderApplication();
            setEditorStatus(`Trwale usunięto wydarzenie „${event.name}”. Globalne lokalizacje i postępy katalogowe pozostały bez zmian.`);
        } catch (error) {
            console.error("SA Event Maps: Nie udało się trwale usunąć wydarzenia.", error);
            setEditorStatus(error.message || "Nie udało się trwale usunąć wydarzenia.");
        } finally {
            const current = getEventById(currentFilterId);
            elements.permanentlyDeleteEvent.disabled =
                !isAdmin() || currentFilterId === "all" || !current;
            renderEventSelectors();
        }
    }

    elements.createEvent.addEventListener("click", () => openEventEditor("create"));
    elements.editEvent.addEventListener("click", () => {
        const event = getEventById(currentFilterId);
        if (event && event.status !== "archived") openEventEditor("edit", event);
    });
    elements.saveEvent.addEventListener("click", () => void saveEvent());
    elements.cancelEvent.addEventListener("click", closeEventEditor);
    elements.deleteEvent.addEventListener("click", () => void archiveCurrentEvent());
    elements.permanentlyDeleteEvent.addEventListener("click", () => void permanentlyDeleteCurrentEvent());

    // ================================================
    // PERSONAL PROGRESS RESET — GLOBAL CATALOG ONLY
    // ================================================

    elements.clearCatalogProgress.addEventListener("click", () => {
        if (!dataReady || !currentUser || currentFilterId !== "all") return;

        elements.clearCatalogProgressStatus.hidden = true;
        elements.clearCatalogProgressStatus.textContent = "";
        if (typeof elements.clearCatalogProgressDialog.showModal === "function") {
            elements.clearCatalogProgressDialog.showModal();
        } else {
            const confirmed = window.confirm(
                "Czy na pewno usunąć wszystkie Twoje statusy w katalogu „Wszystkie respy”?\n\n" +
                "Postępy w wydarzeniach, pinezki, zdjęcia i opisy pozostaną bez zmian. Operacji nie można cofnąć."
            );
            if (confirmed) void clearMyCatalogProgress();
        }
    });

    elements.cancelClearCatalogProgress.addEventListener("click", () => {
        if (!elements.confirmClearCatalogProgress.disabled) {
            elements.clearCatalogProgressDialog.close();
        }
    });

    elements.clearCatalogProgressDialog.addEventListener("cancel", event => {
        if (elements.confirmClearCatalogProgress.disabled) event.preventDefault();
    });

    elements.clearCatalogProgressDialog.addEventListener("click", event => {
        if (event.target === elements.clearCatalogProgressDialog
            && !elements.confirmClearCatalogProgress.disabled) {
            elements.clearCatalogProgressDialog.close();
        }
    });

    async function clearMyCatalogProgress() {
        if (!dataReady || !currentUser || currentFilterId !== "all") return;

        const confirmButton = elements.confirmClearCatalogProgress;
        confirmButton.disabled = true;
        confirmButton.textContent = "Usuwanie...";
        elements.cancelClearCatalogProgress.disabled = true;
        elements.clearCatalogProgress.disabled = true;

        try {
            const result = await dataApi.clearCatalogProgress();
            database.playerCatalogProgress = database.playerCatalogProgress.filter(
                item => item.userId !== currentUser.id
            );

            if (elements.clearCatalogProgressDialog.open) {
                elements.clearCatalogProgressDialog.close();
            }

            renderApplication();
            setEditorStatus(
                `Usunięto ${result.deletedCount} zapisanych statusów w katalogu „Wszystkie respy”. Postępy w wydarzeniach pozostały bez zmian.`
            );
        } catch (error) {
            console.error("SA Event Maps: Nie udało się wyczyścić postępów katalogowych.", error);
            elements.clearCatalogProgressStatus.textContent = error.message || "Nie udało się usunąć postępów katalogowych.";
            elements.clearCatalogProgressStatus.hidden = false;
            setEditorStatus(error.message || "Nie udało się usunąć postępów katalogowych.");
        } finally {
            confirmButton.disabled = false;
            confirmButton.textContent = "Tak, usuń postępy";
            elements.cancelClearCatalogProgress.disabled = false;
            elements.clearCatalogProgress.disabled = false;
        }
    }

    elements.confirmClearCatalogProgress.addEventListener("click", () => {
        void clearMyCatalogProgress();
    });

    // ================================================
    // 11. EVENT FILTER AND ASSIGNMENTS
    // ================================================

    elements.eventFilter.addEventListener("change", () => {
        currentFilterId = elements.eventFilter.value || "all";
        if (selectedLocationId) {
            const location = getLocationById(selectedLocationId);
            if (location && currentFilterId !== "all" &&
                !locationBelongsToEvent(location.id, currentFilterId)) {
                clearSelectedLocation();
            }
        }
        renderApplication();
    });

    elements.assignEventSelect.addEventListener("change", () => {
        updateAssignmentControls();
        const location = getLocationById(selectedLocationId);
        if (location) {
            renderProgressEditor(location);
            renderLocationMarkers();
            renderCatalog();
        }
    });

    elements.assignLocation.addEventListener("click", async () => {
        const location = getLocationById(selectedLocationId);
        const eventId = getProgressContextEventId();
        const event = eventId ? getEventById(eventId) : null;

        if (!location || !event || event.status === "archived") return;

        try {
            const relation = await dataApi.assignLocationToEvent(event.id, location.id);
            database.eventLocations.push(relation);
            renderApplication();
            showLocationDetails(location);
            setEditorStatus(`Przypisano „${location.name}” do eventu „${event.name}”.`);
        } catch (error) {
            setEditorStatus(error.message || "Nie udało się przypisać znajdźki.");
        }
    });

    elements.removeAssignment.addEventListener("click", async () => {
        if (!isAdmin()) return;

        const location = getLocationById(selectedLocationId);
        const eventId = getProgressContextEventId();
        const event = eventId ? getEventById(eventId) : null;

        if (!location || !event) return;

        const confirmation = window.confirm(
            `Czy usunąć „${location.name}” z wydarzenia „${event.name}”?\n\n` +
            "Sama lokalizacja pozostanie w katalogu głównym."
        );

        if (!confirmation) return;

        try {
            await dataApi.removeLocationFromEvent(event.id, location.id);
            database.eventLocations = database.eventLocations.filter(
                item => !(item.eventId === event.id && item.locationId === location.id)
            );
            renderApplication();
            clearSelectedLocation();
            setEditorStatus(`Usunięto przypisanie „${location.name}” do eventu „${event.name}”.`);
        } catch (error) {
            setEditorStatus(error.message || "Nie udało się usunąć przypisania.");
        }
    });

    // ================================================
    // 12. LEAFLET MAP
    // ================================================

    const map = L.map("game-map", {
        crs: L.CRS.Simple,
        minZoom: -4,
        maxZoom: 2.5,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        scrollWheelZoom: true,
        wheelDebounceTime: 40,
        wheelPxPerZoomLevel: 60,
        doubleClickZoom: false,
        zoomControl: true,
        keyboard: false,
        dragging: true,
        touchZoom: true,
        zoomAnimation: true
    });

    const locationLayer = L.layerGroup().addTo(map);

    function createMarkerIcon(location) {
        const progress = currentFilterId === "all"
            ? getCatalogProgress(location.id)
            : getProgress(currentFilterId, location.id);

        const status = PROGRESS_STATUS[progress.status] || PROGRESS_STATUS.not_found;
        const classes = [
            "sa-map-pin",
            `status-${progress.status || "not_found"}`,
            location.isPinned ? "is-pinned" : "",
            progress.needsCheck ? "needs-check" : "",
            location.isArchived ? "is-archived" : ""
        ].filter(Boolean).join(" ");

        return L.divIcon({
            className: "sa-location-marker",
            html: `
                <div class="${classes}" style="--pin-color:${status.color}">
                    <span class="sa-map-pin-core"></span>
                    ${location.isPinned ? '<span class="sa-map-pin-lock" aria-hidden="true">◆</span>' : ""}
                    ${progress.needsCheck ? '<span class="sa-map-pin-check" aria-hidden="true">!</span>' : ""}
                </div>
            `,
            iconSize: [34, 42],
            iconAnchor: [17, 40],
            popupAnchor: [0, -36]
        });
    }

    function addLocationMarker(location) {
        const position = worldToLatLng(location.world.x, location.world.y);
        if (!position) {
            console.warn("SA Event Maps: Lokalizacja poza mapą:", location.name);
            return;
        }

        const draggable = canMoveLocation(location);

        const marker = L.marker(position, {
            icon: createMarkerIcon(location),
            draggable,
            title: location.name,
            keyboard: true,
            bubblingMouseEvents: false
        });

        marker.addTo(locationLayer);
        location.marker = marker;

        marker.bindTooltip(escapeHTML(location.name), {
            direction: "top",
            offset: [0, -27]
        });

        marker.on("click", () => showLocationDetails(location));

        if (draggable) {
            marker.on("dragend", async () => {
                const newPosition = marker.getLatLng();
                const pixelX = newPosition.lng;
                const pixelY = imageHeight - newPosition.lat;

                if (!isPixelInsideImage(pixelX, pixelY)) {
                    const oldPosition = worldToLatLng(location.world.x, location.world.y);
                    if (oldPosition) marker.setLatLng(oldPosition);
                    setEditorStatus("Nie można przesunąć znajdźki poza granice mapy.");
                    return;
                }

                const world = pixelToWorld(pixelX, pixelY);
                const oldWorld = { ...location.world };

                marker.dragging.disable();
                try {
                    const updated = await dataApi.updateLocation(location.id, {
                        world: {
                            x: world.x,
                            y: world.y
                        }
                    });

                    location.world = updated.world;
                    location.updatedAt = updated.updatedAt;
                    setEditorStatus(
                        `Zaktualizowano położenie „${location.name}”. ` +
                        `X: ${formatCoordinate(world.x)}, Y: ${formatCoordinate(world.y)}.`
                    );

                    renderCatalog();
                    if (selectedLocationId === location.id) {
                        showLocationDetails(location);
                    }
                } catch (error) {
                    location.world = oldWorld;
                    const oldLatLng = worldToLatLng(oldWorld.x, oldWorld.y);
                    if (oldLatLng) marker.setLatLng(oldLatLng);
                    setEditorStatus(error.message || "Nie udało się zapisać nowego położenia.");
                } finally {
                    if (canMoveLocation(location)) marker.dragging.enable();
                }
            });
        }
    }

    function renderLocationMarkers() {
        locationLayer.clearLayers();

        getVisibleLocations().forEach(location => {
            location.marker = null;
            addLocationMarker(location);
        });

        updateMapLocationCount();
    }

    function updateMapLocationCount() {
        elements.locationCount.textContent =
            `${getVisibleLocations().length} widocznych znajdziek`;
    }

    // ================================================
    // 13. SELECTED LOCATION DETAILS AND ACTIONS
    // ================================================

    function clearSelectedLocation() {
        selectedLocationId = null;
        elements.emptyDetails.hidden = false;
        elements.selectedDetails.hidden = true;

        elements.deleteSelected.disabled = true;
        elements.assignLocation.disabled = true;
        elements.removeAssignment.disabled = true;

        elements.selectedEvents.textContent = "—";
        selectedImageRenderToken += 1;
        selectedLocationImage = null;
        elements.selectedImageContainer.hidden = true;
        elements.selectedImageAdminActions.hidden = true;
        elements.selectedImageOwnerActions.hidden = true;
        elements.selectedImage.removeAttribute("src");

        if (progressPanel) progressPanel.hidden = true;
        if (editLocationButton) editLocationButton.hidden = true;
        if (pinLocationButton) pinLocationButton.hidden = true;
        if (permanentlyDeleteLocationButton) {
            permanentlyDeleteLocationButton.hidden = true;
            permanentlyDeleteLocationButton.disabled = true;
        }
    }

    function showLocationDetails(location) {
        selectedLocationId = location.id;

        if (editingLocationId === location.id) {
            const coordinatesLocked = Boolean(location.isPinned);
            form.x.disabled = coordinatesLocked;
            form.y.disabled = coordinatesLocked;
            form.z.disabled = coordinatesLocked;
            form.coordinateLockNote.hidden = !coordinatesLocked;
        }

        elements.emptyDetails.hidden = true;
        elements.selectedDetails.hidden = false;

        elements.selectedName.textContent = location.name;
        elements.selectedDescription.textContent =
            location.description || "Brak opisu.";

        const pinnedState = byId("selected-pin-pinned");
        if (pinnedState) {
            pinnedState.textContent = location.isPinned ? "Przypięta" : "Nieprzypięta";
        }

        detailFields.area.textContent = location.area || "Nie określono";
        void refreshLocationOwnerName(location);
        detailFields.x.textContent = formatCoordinate(location.world.x);
        detailFields.y.textContent = formatCoordinate(location.world.y);
        detailFields.z.textContent =
            location.world.z === null || location.world.z === undefined
                ? "Nie podano"
                : formatCoordinate(location.world.z);

        const associatedEvents = getEventsForLocation(location.id);

        elements.selectedEvents.textContent =
            associatedEvents.length
                ? associatedEvents.map(event => event.name).join(", ")
                : "Brak przypisań";

        elements.deleteSelected.hidden = !isAdmin() || location.isArchived || location.isDeletionPending;
        elements.deleteSelected.disabled = !isAdmin() || location.isArchived || location.isDeletionPending;

        ensureDetailActionButtons();

        const canEdit = canEditLocation(location);
        editLocationButton.hidden = !canEdit;
        editLocationButton.disabled = !canEdit;

        const isOwner = location.createdBy === currentUser?.id;
        const canSeePermanentDelete =
            isAdmin() || (isOwner && !location.isPinned && !location.isArchived);
        const canDeleteAsOwner = isOwner && !location.isPinned && !location.isArchived &&
            (!location.isDeletionPending || location.deletionRequestedBy === currentUser?.id);
        permanentlyDeleteLocationButton.hidden = !canSeePermanentDelete;
        permanentlyDeleteLocationButton.disabled = !isAdmin() && !canDeleteAsOwner;
        permanentlyDeleteLocationButton.title = location.isPinned && !isAdmin()
            ? "Pinezka została zatwierdzona i przypięta. Może ją odpiąć lub usunąć wyłącznie administrator."
            : location.isDeletionPending && !isAdmin() && location.deletionRequestedBy !== currentUser?.id
                ? "Usuwanie tej pinezki rozpoczął administrator. Może je dokończyć wyłącznie administrator."
                : "Trwale usuwa lokalizację, przypisania do wydarzeń, statusy wszystkich graczy i zdjęcie.";

        const canPinAsOwner = isOwner && !location.isPinned && !location.isArchived;
        pinLocationButton.hidden = location.isArchived || location.isDeletionPending || (!isAdmin() && !canPinAsOwner);
        pinLocationButton.disabled = location.isDeletionPending || (!isAdmin() && !canPinAsOwner);
        pinLocationButton.textContent = isAdmin()
            ? (location.isPinned ? "Odepnij pinezkę" : "Przypnij pinezkę")
            : "Zatwierdź i przypnij pinezkę";

        void renderSelectedLocationImage(location.id);
        updateImageUploadAvailability();

        updateAssignmentControls();
        renderProgressEditor(location);
    }

    async function toggleSelectedPin() {
        const location = getLocationById(selectedLocationId);
        if (!location || location.isArchived || location.isDeletionPending) return;
        if (!isAdmin() && (
            location.createdBy !== currentUser?.id || location.isPinned
        )) return;

        const accepted = isAdmin()
            ? window.confirm(
                `${location.isPinned ? "Odpiąć" : "Przypiąć"} pinezkę „${location.name}”?\n\n` +
                (location.isPinned
                    ? "Właściciel ponownie będzie mógł edytować i zarządzać własną lokalizacją."
                    : "Właściciel straci możliwość edycji i odpięcia tej pinezki. Tylko administrator będzie mógł ją później odblokować.")
            )
            : window.confirm(
                `Czy zatwierdzasz i przypinasz pinezkę „${location.name}”?\n\n` +
                "Przypięcie oznacza, że sprawdziłeś nazwę, opis i współrzędne. Po zatwierdzeniu nie będziesz mógł już edytować, przesuwać, odpinać ani trwale usunąć tej pinezki. W razie błędu będzie mógł ją odpiąć administrator.\n\n" +
                "Czy na pewno chcesz ją zatwierdzić?"
            );
        if (!accepted) return;

        try {
            pinLocationButton.disabled = true;
            const updated = await dataApi.setLocationPinned(
                location.id,
                !location.isPinned
            );

            Object.assign(location, updated);
            renderApplication();
            showLocationDetails(location);

            setEditorStatus(
                location.isPinned
                    ? (isAdmin()
                        ? `Przypięto „${location.name}”. Właściciel nie może jej już edytować ani odpiąć.`
                        : `Zatwierdzono i przypięto „${location.name}”. Od tej chwili tylko administrator może ją edytować lub odpiąć.`)
                    : `Odpięto „${location.name}”. Właściciel może ponownie edytować pinezkę.`
            );
        } catch (error) {
            setEditorStatus(error.message || "Nie udało się zmienić przypięcia.");
        } finally {
            if (pinLocationButton) pinLocationButton.disabled = false;
        }
    }

    async function permanentlyDeleteSelectedLocation() {
        const location = getLocationById(selectedLocationId);
        if (!location) return;

        const isOwner = location.createdBy === currentUser?.id;
        if (!isAdmin() && (
            !isOwner || location.isPinned || location.isArchived ||
            (location.isDeletionPending && location.deletionRequestedBy !== currentUser?.id)
        )) return;

        permanentlyDeleteLocationButton.disabled = true;
        try {
            const impact = await dataApi.getLocationDeleteImpact(location.id);
            const events = impact.eventNames.length
                ? impact.eventNames.map(name => `• ${name}`).join("\n")
                : "Brak przypisań do wydarzeń.";
            const message = impact.deletionPending
                ? `Usuwanie znajdźki „${impact.locationName}” zostało już rozpoczęte, ale nie zostało zakończone.\n\nPonowienie spróbuje dokończyć usuwanie zdjęć i powiązanych danych. Pinezka pozostaje zablokowana dla innych operacji.\n\nCzy kontynuować?`
                : `Czy na pewno trwale usunąć znajdźkę „${impact.locationName}”?\n\n` +
                `Przypisania do wydarzeń (${impact.assignmentCount}):\n${events}\n\n` +
                `Zostanie usuniętych również:\n` +
                `• Statusy w wydarzeniach wszystkich graczy: ${impact.eventProgressCount}\n` +
                `• Osobiste statusy w „Wszystkich respach”: ${impact.catalogProgressCount}\n` +
                `• Zdjęcie i pliki Storage: ${impact.storageObjectCount}\n\n` +
                `Pinezka jest wspólna dla wszystkich wydarzeń, więc zniknie z każdego z nich.\n` +
                `To usunięcie jest trwałe i nie można go cofnąć.`;

            if (!window.confirm(message)) return;

            permanentlyDeleteLocationButton.disabled = true;
            setEditorStatus(`Usuwanie „${location.name}” i wszystkich powiązanych danych…`);
            const result = await dataApi.deleteLocation(location.id);

            database.locations = database.locations.filter(item => item.id !== location.id);
            database.eventLocations = database.eventLocations.filter(item => item.locationId !== location.id);
            database.playerProgress = database.playerProgress.filter(item => item.locationId !== location.id);
            database.playerCatalogProgress = database.playerCatalogProgress.filter(item => item.locationId !== location.id);

            selectedLocationImage = null;
            editingLocationHasImage = false;
            editingLocationCanUploadImage = false;
            editingLocationId = null;
            clearPinForm();
            clearSelectedLocation();
            renderApplication();

            const removedAssignments = Number(result?.assignments_deleted) || impact.assignmentCount;
            const removedEventProgress = Number(result?.event_progress_deleted) || impact.eventProgressCount;
            const removedCatalogProgress = Number(result?.catalog_progress_deleted) || impact.catalogProgressCount;
            setEditorStatus(
                `Trwale usunięto „${location.name}”. Usunięto ${removedAssignments} przypisań do wydarzeń, ` +
                `${removedEventProgress} statusów wydarzeń i ${removedCatalogProgress} statusów katalogowych.`
            );
        } catch (error) {
            console.error("SA Event Maps: Trwałe usuwanie lokalizacji nie powiodło się.", error);
            if (error?.locationDeletionPending) {
                location.isDeletionPending = true;
                location.deletionRequestedBy = currentUser?.id || location.deletionRequestedBy;
                renderApplication();
                showLocationDetails(location);
            }
            setEditorStatus(error.message || "Nie udało się trwale usunąć znajdźki.");
        } finally {
            if (permanentlyDeleteLocationButton) {
                const current = getLocationById(selectedLocationId);
                permanentlyDeleteLocationButton.disabled = !current || (!isAdmin() && (
                    current.isPinned || current.isArchived || current.createdBy !== currentUser?.id ||
                    (current.isDeletionPending && current.deletionRequestedBy !== currentUser?.id)
                ));
            }
        }
    }

    elements.deleteSelected.addEventListener("click", async () => {
        if (!isAdmin()) return;

        const location = getLocationById(selectedLocationId);
        if (!location || location.isArchived) return;

        const associatedCount = getEventsForLocation(location.id).length;
        const confirmation = window.confirm(
            `Czy zarchiwizować znajdźkę „${location.name}”?\n\n` +
            `Jest przypisana do ${associatedCount} wydarzeń.\n\n` +
            "Lokalizacja zostanie ukryta przed graczami, ale jej historia pozostanie w bazie."
        );

        if (!confirmation) return;

        elements.deleteSelected.disabled = true;

        try {
            await dataApi.archiveLocation(location.id);
            location.isArchived = true;
            location.archivedAt = new Date().toISOString();

            clearSelectedLocation();
            renderApplication();
            setEditorStatus(`Zarchiwizowano znajdźkę „${location.name}”.`);
        } catch (error) {
            elements.deleteSelected.disabled = false;
            setEditorStatus(error.message || "Nie udało się zarchiwizować znajdźki.");
        }
    });

    // ================================================
    // 14. CREATE AND EDIT LOCATIONS
    // ================================================

    async function beginEditSelectedLocation() {
        const location = getLocationById(selectedLocationId);
        if (!location || !canEditLocation(location)) return;

        editingLocationId = location.id;
        editingLocationHasImage = true; // Fail closed until the slot is checked.
        editingLocationCanUploadImage = false;
        form.name.value = location.name;
        form.area.value = location.area || "";
        form.x.value = String(location.world.x);
        form.y.value = String(location.world.y);
        form.z.value =
            location.world.z === null || location.world.z === undefined
                ? ""
                : String(location.world.z);
        const coordinatesLocked = Boolean(location.isPinned);
        form.x.disabled = coordinatesLocked;
        form.y.disabled = coordinatesLocked;
        form.z.disabled = coordinatesLocked;
        form.coordinateLockNote.hidden = !coordinatesLocked;
        form.description.value = location.description || "";
        form.imageFile.value = "";

        elements.addPin.textContent = "Zapisz zmiany znajdźki";
        form.imageFileStatus.textContent = "Sprawdzanie, czy znajdźka ma już zdjęcie…";
        updateImageUploadAvailability();
        elements.clearForm.textContent = "Anuluj edycję";

        try {
            const imageState = await dataApi.getLocationImageUploadState(location.id);
            if (editingLocationId !== location.id) return;
            if (imageState.deletionPending) {
                clearPinForm();
                setEditorStatus("Ta pinezka jest już w trakcie trwałego usuwania. Nie można jej dalej edytować.");
                return;
            }
            editingLocationHasImage = imageState.hasImage;
            editingLocationCanUploadImage = imageState.canUpload;
            imageUploadsEnabled = imageState.playerUploadsEnabled;
            updateImageUploadAvailability();
        } catch (error) {
            editingLocationHasImage = true;
            editingLocationCanUploadImage = false;
            updateImageUploadAvailability();
            setEditorStatus(`Nie udało się sprawdzić dostępności zdjęcia: ${error.message}. Edycja tekstu nadal jest dostępna, ale wysyłanie zdjęcia pozostaje zablokowane.`);
        }

        setEditorStatus(`Edytujesz własną lokalizację „${location.name}”.`);
        form.name.focus();
        document.querySelector(".pin-editor")?.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
        });
    }

    async function saveLocationFromForm() {
        const name = form.name.value.trim();
        const area = form.area.value.trim() || "Nie określono";
        const editingLocation = editingLocationId ? getLocationById(editingLocationId) : null;
        const coordinatesLocked = Boolean(editingLocation?.isPinned);
        const xText = coordinatesLocked ? String(editingLocation.world.x) : form.x.value.trim();
        const yText = coordinatesLocked ? String(editingLocation.world.y) : form.y.value.trim();
        const zValue = coordinatesLocked ? editingLocation.world.z : parseOptionalNumber(form.z.value);
        const description = form.description.value.trim();

        if (!name) {
            setEditorStatus("Podaj nazwę znajdźki.");
            form.name.focus();
            return;
        }

        if (xText === "" || yText === "") {
            setEditorStatus("Podaj X i Y albo odczytaj współrzędne, klikając mapę.");
            return;
        }

        const x = Number(xText);
        const y = Number(yText);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            setEditorStatus("Współrzędne X i Y muszą być prawidłowymi liczbami.");
            return;
        }

        if (Number.isNaN(zValue)) {
            setEditorStatus("Współrzędna Z musi być liczbą albo pozostać pusta.");
            return;
        }

        let preparedImage = null;
        let imageWarning = "";
        const selectedImageFile = form.imageFile.files?.[0] || null;
        try {
            if (selectedImageFile) {
                const prepared = await prepareImageForLocation(selectedImageFile);
                if (prepared?.blocked) {
                    imageWarning = " Zdjęcie pominięto, ponieważ administrator zablokował nowe wysyłki.";
                } else {
                    preparedImage = prepared;
                }
            }
        } catch (imageError) {
            imageWarning = ` Zdjęcie pominięto: ${imageError.message || "nie udało się przygotować obrazu."}`;
        }

        if (!coordinatesLocked) {
            const pixel = worldToPixel(x, y);
            if (!isPixelInsideImage(pixel.x, pixel.y)) {
                setEditorStatus("Podane współrzędne znajdują się poza granicami mapy.");
                return;
            }
        }

        elements.addPin.disabled = true;

        try {
            if (editingLocationId) {
                const location = getLocationById(editingLocationId);

                if (!location || !canEditLocation(location)) {
                    throw new Error("Nie masz uprawnień do edycji tej pinezki.");
                }

                const updateInput = { name, area, description };
                if (!location.isPinned) updateInput.world = { x, y, z: zValue };
                const updated = await dataApi.updateLocation(location.id, updateInput);

                Object.assign(location, updated);
                if (preparedImage) {
                    try {
                        await dataApi.uploadLocationImage(location.id, preparedImage);
                        editingLocationHasImage = true;
                        editingLocationCanUploadImage = false;
                    } catch (imageError) {
                        imageWarning = ` Zdjęcie nie zostało dodane: ${imageError.message}`;
                    }
                }
                setEditorStatus(`Zapisano zmiany w lokalizacji „${location.name}”.${imageWarning}`);
            } else {
                const created = await dataApi.createLocation({
                    name,
                    area,
                    description,
                    world: { x, y, z: zValue }
                });

                database.locations.push(created);

                let assignmentWarning = "";

                if (preparedImage) {
                    try {
                        await dataApi.uploadLocationImage(created.id, preparedImage);
                    } catch (imageError) {
                        imageWarning = ` Zdjęcie nie zostało dodane: ${imageError.message}`;
                    }
                }

                // When creating a pin in a specific event view,
                // add it to that event. In the global view it stays
                // in the common catalog until explicitly assigned.
                if (currentFilterId !== "all") {
                    const event = getEventById(currentFilterId);

                    if (event && event.status !== "archived") {
                        try {
                            const relation = await dataApi.assignLocationToEvent(
                                event.id,
                                created.id
                            );
                            database.eventLocations.push(relation);
                        } catch (assignmentError) {
                            console.warn(
                                "Lokalizacja została utworzona, ale nie udało się przypisać jej do wydarzenia.",
                                assignmentError
                            );
                            assignmentWarning =
                                ` Pinezka została utworzona, ale nie udało się przypisać jej do eventu: ${assignmentError.message}`;
                        }
                    }
                }

                selectedLocationId = created.id;
                setEditorStatus(
                    `Dodano „${created.name}” do wspólnego katalogu.${assignmentWarning}${imageWarning}`
                );
            }

            editingLocationId = null;
            editingLocationHasImage = false;
            clearPinForm();
            renderApplication();

            const selected = getLocationById(selectedLocationId);
            if (selected) showLocationDetails(selected);
            elements.addPin.textContent = "Dodaj znajdźkę do katalogu";
            elements.clearForm.textContent = "Wyczyść formularz";
        } catch (error) {
            console.error("SA Event Maps: Nie udało się zapisać lokalizacji.", error);
            setEditorStatus(error.message || "Nie udało się zapisać znajdźki.");
        } finally {
            elements.addPin.disabled = false;
        }
    }

    function clearPinForm() {
        form.name.value = "";
        form.area.value = "";
        form.x.value = "";
        form.y.value = "";
        form.z.value = "";
        form.description.value = "";
        form.imageFile.value = "";
        form.x.disabled = false;
        form.y.disabled = false;
        form.z.disabled = false;
        form.coordinateLockNote.hidden = true;
        form.imageFileStatus.textContent = "Opcjonalnie — jedno zdjęcie na znajdźkę. Zostanie automatycznie zmniejszone do WebP przed wysłaniem.";
        editingLocationId = null;
        editingLocationHasImage = false;
        editingLocationCanUploadImage = false;
        elements.addPin.textContent = "Dodaj znajdźkę do katalogu";
        elements.clearForm.textContent = "Wyczyść formularz";
        updateImageUploadAvailability();
    }

    elements.addPin.addEventListener("click", () => void saveLocationFromForm());

    form.imageFile.addEventListener("change", async () => {
        const file = form.imageFile.files?.[0];
        if (!file) {
            updateImageUploadAvailability();
            return;
        }

        form.imageFile.disabled = true;
        form.imageFileStatus.textContent = "Sprawdzanie ustawień wysyłania zdjęć…";
        let fileStatusMessage = "";
        try {
            const settings = await dataApi.getImageUploadSettings();
            imageUploadsEnabled = settings.allowPlayerUploads;
            if (!settings.allowPlayerUploads && !currentUser?.isAdmin) {
                form.imageFile.value = "";
                fileStatusMessage = "Administrator zablokował nowe wysyłki. Możesz zapisać znajdźkę bez zdjęcia.";
            } else {
                fileStatusMessage = `Wybrano: ${file.name}. Obraz zostanie skompresowany do WebP przed wysłaniem.`;
            }
        } catch (error) {
            imageUploadsEnabled = false;
            form.imageFile.value = "";
            fileStatusMessage = `Nie udało się sprawdzić ustawień galerii: ${error.message}. Znajdźkę możesz dodać bez zdjęcia.`;
        } finally {
            updateImageUploadAvailability();
            if (fileStatusMessage) form.imageFileStatus.textContent = fileStatusMessage;
        }
    });

    elements.selectedImageOpen.addEventListener("click", () => void openLocationImageLightbox());
    elements.closeImageLightbox.addEventListener("click", closeLocationImageLightbox);
    elements.imageLightbox.addEventListener("click", event => {
        if (event.target === elements.imageLightbox) closeLocationImageLightbox();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !elements.imageLightbox.hidden) closeLocationImageLightbox();
    });
    elements.archiveSelectedImage.addEventListener("click", () => void runSelectedImageAction("archive"));
    elements.restoreSelectedImage.addEventListener("click", () => void runSelectedImageAction("restore"));
    elements.deleteSelectedImage.addEventListener("click", () => void runSelectedImageAction("delete"));
    elements.deleteOwnSelectedImage.addEventListener("click", () => void runSelectedImageAction("delete"));

    elements.clearForm.addEventListener("click", () => {
        clearPinForm();
        setEditorStatus("Formularz został wyczyszczony.");
    });

    // ================================================
    // 15. COORDINATE READER
    // ================================================

    map.on("click", event => {
        if (!mapReady) return;

        const pixelX = event.latlng.lng;
        const pixelY = imageHeight - event.latlng.lat;

        if (!isPixelInsideImage(pixelX, pixelY)) {
            selectedMapCoordinate = null;
            elements.readoutX.textContent = "—";
            elements.readoutY.textContent = "—";
            elements.useCoordinates.disabled = true;
            setCoordinateStatus("Kliknij wewnątrz obrazu mapy.");
            return;
        }

        const world = pixelToWorld(pixelX, pixelY);
        selectedMapCoordinate = { x: world.x, y: world.y };

        elements.readoutX.textContent = formatCoordinate(world.x);
        elements.readoutY.textContent = formatCoordinate(world.y);
        elements.useCoordinates.disabled = false;

        setCoordinateStatus(
            `Odczytano X=${formatCoordinate(world.x)}, Y=${formatCoordinate(world.y)}.`
        );
    });

    elements.useCoordinates.addEventListener("click", () => {
        if (!selectedMapCoordinate) return;

        form.x.value = formatCoordinate(selectedMapCoordinate.x);
        form.y.value = formatCoordinate(selectedMapCoordinate.y);

        setEditorStatus("Współrzędne mapy zostały przeniesione do formularza.");
        form.name.focus();
    });

    // ================================================
    // 16. CATALOG SEARCH AND DISPLAY
    // ================================================

    function renderCatalog() {
        elements.catalogList.replaceChildren();

        let locations = [...getVisibleLocations()];
        const query = elements.locationSearch.value.trim().toLowerCase();

        if (query) {
            locations = locations.filter(location => {
                const searchable = [
                    location.name,
                    location.area,
                    location.description
                ].join(" ").toLowerCase();

                return searchable.includes(query);
            });
        }

        const sortMode = elements.locationSort.value;

        locations.sort((a, b) => {
            if (sortMode === "area-asc") {
                return (a.area || "").localeCompare(b.area || "", "pl");
            }

            if (sortMode === "created-desc") {
                return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
            }

            return a.name.localeCompare(b.name, "pl");
        });

        elements.catalogLocationCount.textContent = locations.length;

        if (locations.length === 0) {
            const empty = document.createElement("div");
            empty.className = "catalog-empty";
            empty.textContent = query
                ? "Nie znaleziono pasujących lokalizacji."
                : "Katalog nie zawiera jeszcze lokalizacji.";
            elements.catalogList.appendChild(empty);

            setCatalogStatus(
                query
                    ? "Brak wyników wyszukiwania."
                    : "Katalog nie zawiera jeszcze lokalizacji."
            );
            return;
        }

        const eventId = currentFilterId === "all" ? null : currentFilterId;

        locations.forEach(location => {
            const row = document.createElement("div");
            row.className = "catalog-row";
            row.tabIndex = 0;
            row.setAttribute("role", "button");

            const progress = currentFilterId === "all"
                ? getCatalogProgress(location.id)
                : getProgress(eventId, location.id);

            const statusCell = document.createElement("span");
            statusCell.className = "catalog-status-cell";

            const dot = document.createElement("span");
            dot.className =
                `catalog-status-dot status-${progress.status || "not_found"}` +
                (progress.needsCheck ? " needs-check" : "");
            dot.title =
                `${PROGRESS_STATUS[progress.status]?.label || "Nieznaleziona"}` +
                (progress.needsCheck ? " · Do sprawdzenia" : "");
            statusCell.appendChild(dot);

            const name = document.createElement("span");
            name.className = "catalog-name";
            name.textContent = location.name;

            const area = document.createElement("span");
            area.className = "catalog-area";
            area.textContent = location.area || "Nie określono";

            const events = document.createElement("span");
            events.className = "catalog-events";
            const associated = getEventsForLocation(location.id);
            events.textContent = associated.length
                ? associated.map(event => event.name).join(", ")
                : "Brak przypisania";

            row.append(statusCell, name, area, events);

            row.addEventListener("click", () => selectLocationOnMap(location));
            row.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectLocationOnMap(location);
                }
            });

            elements.catalogList.appendChild(row);
        });

        setCatalogStatus(`Wyświetlono ${locations.length} lokalizacji.`);
    }

    elements.locationSearch.addEventListener("input", renderCatalog);
    elements.locationSort.addEventListener("change", renderCatalog);

    function selectLocationOnMap(location) {
        showLocationDetails(location);

        const position = worldToLatLng(location.world.x, location.world.y);
        if (!position) return;

        map.setView(position, Math.max(map.getZoom(), 0), { animate: true });

        if (location.marker) {
            location.marker.openTooltip();
        }
    }

    // ================================================
    // 17. RENDER APPLICATION
    // ================================================

    function renderApplication() {
        if (!dataReady) return;

        renderEventSelectors();
        updateGlobalCounters();
        elements.clearCatalogProgress.hidden = !dataReady || !currentUser || currentFilterId !== "all";

        if (mapReady) {
            renderLocationMarkers();
        }

        renderCatalog();

        if (selectedLocationId) {
            const selected = getLocationById(selectedLocationId);
            if (selected) {
                showLocationDetails(selected);
            } else {
                clearSelectedLocation();
            }
        }

        const isPlayer = !isAdmin();
        elements.createEvent.hidden = isPlayer;
        elements.editEvent.hidden = isPlayer;
        elements.deleteEvent.hidden = isPlayer;
    }

    // ================================================
    // 18. LEGACY INCOMPLETE IMPORT / EXPORT
    // ================================================

    // The old map toolbar export contained only the currently signed-in
    // player's progress. Full organization backups now live in the secured
    // administrator workspace and include every player's progress.
    elements.exportButton.hidden = true;
    elements.importButton.hidden = true;
    elements.importFile.hidden = true;

    // ================================================
    // 19. GRID
    // ================================================

    function addGridSegment(points) {
        if (points.length < 2) return;

        L.polyline(points, {
            color: "#65d6a3",
            weight: 1,
            opacity: 0.34,
            interactive: false,
            smoothFactor: 1
        }).addTo(gridLayer);
    }

    function createGridLine(axis, fixedValue) {
        let segment = [];
        const sampleStep = 50;

        for (
            let variable = -GRID_LIMIT;
            variable <= GRID_LIMIT;
            variable += sampleStep
        ) {
            const worldX = axis === "x" ? fixedValue : variable;
            const worldY = axis === "y" ? fixedValue : variable;
            const pixel = worldToPixel(worldX, worldY);

            if (isPixelInsideImage(pixel.x, pixel.y)) {
                segment.push([imageHeight - pixel.y, pixel.x]);
            } else {
                addGridSegment(segment);
                segment = [];
            }
        }

        addGridSegment(segment);
    }

    function buildGrid() {
        if (gridLayer) map.removeLayer(gridLayer);

        gridLayer = L.layerGroup();

        for (
            let value = -GRID_LIMIT;
            value <= GRID_LIMIT;
            value += GRID_SPACING
        ) {
            createGridLine("x", value);
            createGridLine("y", value);
        }

        if (gridVisible) gridLayer.addTo(map);
    }

    function setGridVisibility(visible) {
        gridVisible = visible;

        if (gridVisible) {
            if (!gridLayer) buildGrid();
            if (!map.hasLayer(gridLayer)) gridLayer.addTo(map);
        } else if (gridLayer && map.hasLayer(gridLayer)) {
            map.removeLayer(gridLayer);
        }

        elements.toggleGrid.classList.toggle("active", gridVisible);
        elements.toggleGrid.textContent =
            gridVisible ? "Siatka: włączona" : "Siatka: wyłączona";
        elements.gridStatus.textContent =
            gridVisible ? "SIATKA WŁĄCZONA" : "SIATKA WYŁĄCZONA";
    }

    elements.toggleGrid.addEventListener("click", () => {
        if (!mapReady) return;
        if (!gridLayer) buildGrid();
        setGridVisibility(!gridVisible);
    });

    // ================================================
    // 20. MAP RESET AND KEYBOARD
    // ================================================

    function resetMapView() {
        if (!imageBounds) return;

        map.fitBounds(imageBounds, {
            animate: true,
            padding: [12, 12]
        });
    }

    elements.resetMap.addEventListener("click", resetMapView);

    mapElement.addEventListener("keydown", event => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        let handled = true;

        switch (event.key) {
            case "+":
            case "=":
            case "Add":
                map.zoomIn();
                break;
            case "-":
            case "_":
            case "Subtract":
                map.zoomOut();
                break;
            case "ArrowUp":
                map.panBy([0, -PAN_DISTANCE]);
                break;
            case "ArrowDown":
                map.panBy([0, PAN_DISTANCE]);
                break;
            case "ArrowLeft":
                map.panBy([-PAN_DISTANCE, 0]);
                break;
            case "ArrowRight":
                map.panBy([PAN_DISTANCE, 0]);
                break;
            case "Home":
                resetMapView();
                break;
            default:
                handled = false;
        }

        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    });

    mapElement.addEventListener("pointerdown", () => {
        mapElement.focus({ preventScroll: true });
    });

    window.addEventListener("resize", () => {
        map.invalidateSize({ pan: false });
    });

    // ================================================
    // 21. NAVIGATION
    // ================================================

    function escapeHelpHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function renderHelpMarkdown(source) {
        const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
        const output = [];
        let paragraph = [];
        let listItems = [];

        const inline = value => escapeHelpHtml(value)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>");
        const flushParagraph = () => {
            if (paragraph.length) {
                output.push(`<p>${inline(paragraph.join(" "))}</p>`);
                paragraph = [];
            }
        };
        const flushList = () => {
            if (listItems.length) {
                output.push(`<ul>${listItems.map(item => `<li>${inline(item)}</li>`).join("")}</ul>`);
                listItems = [];
            }
        };

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                flushParagraph();
                flushList();
                continue;
            }
            const heading = line.match(/^(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                flushList();
                const level = Math.min(4, heading[1].length + 1);
                output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
                continue;
            }
            const bullet = line.match(/^[-*]\s+(.+)$/);
            if (bullet) {
                flushParagraph();
                listItems.push(bullet[1]);
                continue;
            }
            flushList();
            paragraph.push(line);
        }
        flushParagraph();
        flushList();
        return output.join("");
    }

    function renderHelpDocument() {
        const content = byId("help-document-content");
        const status = byId("help-document-status");
        if (!content || !status) return;

        content.replaceChildren();
        content.setAttribute(
            "aria-labelledby",
            activeHelpDocumentType === "instructions" ? "help-tab-instructions" : "help-tab-rules"
        );

        const sections = helpDocumentSections.filter(section => section.documentType === activeHelpDocumentType);
        if (sections.length === 0) {
            const empty = document.createElement("div");
            empty.className = "help-document-empty";
            empty.textContent = activeHelpDocumentType === "instructions"
                ? "Instrukcja jest obecnie przygotowywana przez administratora."
                : "Regulamin nie został jeszcze opublikowany. Administrator może go uzupełnić w panelu administracyjnym.";
            content.appendChild(empty);
            status.textContent = "Nie ma obecnie opublikowanych rozdziałów tej części.";
            return;
        }

        status.textContent = `Opublikowane rozdziały: ${sections.length}.`;
        for (const section of sections) {
            const article = document.createElement("article");
            article.className = "help-document-article";
            const heading = document.createElement("h3");
            heading.textContent = section.title;
            const body = document.createElement("div");
            body.className = "help-document-article-body";
            body.innerHTML = renderHelpMarkdown(section.content);
            article.append(heading, body);
            content.appendChild(article);
        }
    }

    async function loadHelpCenter(force = false) {
        const status = byId("help-document-status");
        if (!status) return;
        if (helpDocumentsLoaded && !force) {
            renderHelpDocument();
            return;
        }

        status.textContent = "Pobieranie instrukcji i regulaminu…";
        try {
            helpDocumentSections = await dataApi.getPublishedHelpSections();
            helpDocumentsLoaded = true;
            renderHelpDocument();
        } catch (error) {
            console.error("SA Event Maps: Nie udało się pobrać instrukcji i regulaminu.", error);
            status.textContent = error.message || "Nie udało się pobrać treści. Spróbuj odświeżyć stronę.";
            const content = byId("help-document-content");
            if (content) {
                const empty = document.createElement("div");
                empty.className = "help-document-empty is-error";
                empty.textContent = "Nie udało się załadować dokumentu. Sprawdź połączenie i spróbuj ponownie.";
                content.replaceChildren(empty);
            }
        }
    }

    function openHelpWorkspace() {
        const workspace = byId("help-workspace");
        const navigationButton = byId("help-nav-button");
        if (!workspace || !workspace.hidden) return;

        helpWorkspaceScrollPosition = window.scrollY || 0;
        helpReturnNavigationButton = document.querySelector(".navigation .nav-item.is-active");

        document.querySelectorAll(".navigation .nav-item").forEach(button => {
            button.classList.remove("is-active");
        });
        navigationButton?.classList.add("is-active");

        appShell.hidden = true;
        workspace.hidden = false;
        document.body.classList.add("is-help-workspace");
        window.scrollTo({ top: 0, behavior: "auto" });
        void loadHelpCenter(true);
    }

    function closeHelpWorkspace() {
        const workspace = byId("help-workspace");
        if (!workspace || workspace.hidden) return;

        workspace.hidden = true;
        appShell.hidden = false;
        document.body.classList.remove("is-help-workspace");
        byId("help-nav-button")?.classList.remove("is-active");

        if (helpReturnNavigationButton?.isConnected) {
            helpReturnNavigationButton.classList.add("is-active");
        } else {
            document.querySelector(".navigation .nav-item")?.classList.add("is-active");
        }
        helpReturnNavigationButton = null;
        window.scrollTo({ top: helpWorkspaceScrollPosition, behavior: "auto" });
    }

    function setupNavigation() {
        const buttons = [
            ...document.querySelectorAll(".navigation .nav-item:not(#admin-nav-button)")
        ];

        const targets = [
            document.querySelector(".workspace-grid"),
            document.querySelector(".catalog-panel"),
            document.querySelector(".event-management")
        ];

        buttons.forEach((button, index) => {
            button.addEventListener("click", () => {
                if (index === 3) {
                    openHelpWorkspace();
                    return;
                }

                const target = targets[index];
                if (!target) return;

                if (index === 0) {
                    currentFilterId = "all";
                    elements.eventFilter.value = "all";
                    renderApplication();
                }

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

                buttons.forEach(item => item.classList.remove("is-active"));
                button.classList.add("is-active");
            });
        });

        byId("help-back-to-map")?.addEventListener("click", closeHelpWorkspace);

        document.querySelectorAll("[data-help-document-tab]").forEach(button => {
            if (button.closest("#admin-workspace")) return;
            button.addEventListener("click", () => {
                activeHelpDocumentType = button.dataset.helpDocumentTab;
                document.querySelectorAll("#help-center [data-help-document-tab]").forEach(tab => {
                    const active = tab === button;
                    tab.classList.toggle("is-active", active);
                    tab.setAttribute("aria-selected", active ? "true" : "false");
                });
                renderHelpDocument();
            });
        });
    }

    // ================================================
    // 22. MAP IMAGE
    // ================================================

    function loadMapImage() {
        const image = new Image();

        image.onload = () => {
            imageWidth = image.naturalWidth;
            imageHeight = image.naturalHeight;

            if (imageWidth !== IMAGE_WIDTH || imageHeight !== IMAGE_HEIGHT) {
                mapElement.textContent =
                    `Nieprawidłowa rozdzielczość mapy: ${imageWidth} × ${imageHeight}. Wymagane 4096 × 4096.`;
                console.error("SA Event Maps: Rozdzielczość obrazu nie pasuje do kalibracji.");
                return;
            }

            imageBounds = [
                [0, 0],
                [imageHeight, imageWidth]
            ];

            L.imageOverlay(
                MAP_IMAGE_URL,
                imageBounds,
                { alt: "Mapa GTA San Andreas z cieniami" }
            ).addTo(map);

            const allowedBounds = L.latLngBounds(
                [
                    [-imageHeight * 0.35, -imageWidth * 0.35],
                    [imageHeight * 1.35, imageWidth * 1.35]
                ]
            );

            map.setMaxBounds(allowedBounds);
            map.options.maxBoundsViscosity = 0.6;

            requestAnimationFrame(() => {
                map.invalidateSize();
                resetMapView();

                mapReady = true;
                buildGrid();
                setGridVisibility(false);

                elements.useCoordinates.disabled = true;

                if (dataReady) {
                    renderApplication();
                }

                setCoordinateStatus(
                    "Kliknij mapę, aby odczytać współrzędne X i Y."
                );

                console.info("SA Event Maps: Mapa załadowana.", {
                    image: MAP_IMAGE_URL,
                    width: imageWidth,
                    height: imageHeight
                });
            });
        };

        image.onerror = () => {
            mapElement.textContent =
                `Nie udało się załadować ${MAP_IMAGE_URL}. Sprawdź plik w folderze assets.`;
            console.error("SA Event Maps: Nie znaleziono obrazu mapy:", MAP_IMAGE_URL);
        };

        image.src = MAP_IMAGE_URL;
    }

    // ================================================
    // 23. SUPABASE BOOTSTRAP AND AUTH STATE
    // ================================================

    async function bootstrapFromSupabase() {
        if (bootstrapPromise) return bootstrapPromise;

        bootstrapPromise = (async () => {
            updateStorageStatus("Łączenie z Supabase...", true);
            setEditorStatus("Pobieranie katalogu ze wspólnej bazy danych...");

            try {
                const catalog = await dataApi.loadCatalog();

                currentUser = catalog.user;
                refreshTopbarDisplayName();
                installTopbarDisplayNameEditor();
                try {
                    const imageSettings = await dataApi.getImageUploadSettings();
                    imageUploadsEnabled = imageSettings.allowPlayerUploads;
                } catch (settingsError) {
                    imageUploadsEnabled = false;
                    console.warn("SA Event Maps: Nie udało się pobrać ustawień galerii. Nowe zdjęcia zostają tymczasowo zablokowane.", settingsError);
                }

                database.locations = catalog.locations;
                database.events = catalog.events;
                database.eventLocations = catalog.eventLocations;
                database.categories = catalog.categories;
                database.playerProgress = catalog.playerProgress;
                database.playerCatalogProgress = catalog.playerCatalogProgress;

                dataReady = true;
                updateImageUploadAvailability();

                updateStorageStatus("Połączono z Supabase", true);
                setEditorStatus(
                    `Katalog pobrany. Lokalizacje: ${database.locations.length}, wydarzenia: ${database.events.length}.`
                );

                renderApplication();

                console.info("SA Event Maps: Katalog został połączony z Supabase.", {
                    role: currentUser.role,
                    locations: database.locations.length,
                    events: database.events.length,
                    assignments: database.eventLocations.length,
                    categories: database.categories.length,
                    progress: database.playerProgress.length,
                    catalogProgress: database.playerCatalogProgress.length
                });
            } catch (error) {
                console.error("SA Event Maps: Nie udało się pobrać katalogu.", error);
                updateStorageStatus("Błąd połączenia z bazą", false);
                setEditorStatus(
                    error.message || "Nie udało się pobrać danych z Supabase."
                );
            }
        })();

        try {
            await bootstrapPromise;
        } finally {
            bootstrapPromise = null;
        }
    }

    function clearCloudState() {
        if (!byId("help-workspace")?.hidden) closeHelpWorkspace();
        currentUser = null;
        dataReady = false;
        imageUploadsEnabled = false;
        updateImageUploadAvailability();

        database.locations = [];
        database.events = [];
        database.eventLocations = [];
        database.categories = [];
        database.playerProgress = [];
        database.playerCatalogProgress = [];
        elements.clearCatalogProgress.hidden = true;
        if (elements.clearCatalogProgressDialog.open) {
            elements.clearCatalogProgressDialog.close();
        }

        selectedLocationId = null;
        currentFilterId = "all";

        clearSelectedLocation();

        updateGlobalCounters();
        renderEventSelectors();

        if (mapReady) {
            renderLocationMarkers();
            renderCatalog();
        }

        updateStorageStatus("Zaloguj się, aby wczytać katalog", true);
    }

    // Administrator workspace writes directly through the Supabase data layer.
    // Refresh the in-memory map catalog after those writes so returning to the map
    // never shows stale events, locations, or event-location assignments.
    window.addEventListener("sa-event-maps:catalog-changed", () => {
        window.setTimeout(async () => {
            if (!currentUser || !dataReady) return;

            // Wait for any initial or previous catalog load, then fetch again so
            // the result necessarily includes the administrator's committed write.
            if (bootstrapPromise) {
                try {
                    await bootstrapPromise;
                } catch {
                    // bootstrapFromSupabase already reports its own errors.
                }
            }

            if (currentUser && dataReady) {
                void bootstrapFromSupabase();
            }
        }, 0);
    });

    supabase.auth.onAuthStateChange((event, session) => {
        window.setTimeout(() => {
            if (session && event !== "PASSWORD_RECOVERY") {
                void bootstrapFromSupabase();
            } else if (!session) {
                clearCloudState();
            }
        }, 0);
    });

    // ================================================
    // 24. START APPLICATION
    // ================================================

    setupNavigation();
    observeTopbarAccountControl();
    ensureProgressPanel();
    elements.useCoordinates.disabled = true;

    // A cloud export replaces the old localStorage export/import workflow.
    elements.importButton.hidden = true;
    elements.importFile.hidden = true;

    loadMapImage();

    supabase.auth.getSession()
        .then(({ data, error }) => {
            if (error) {
                throw error;
            }

            if (data?.session) {
                void bootstrapFromSupabase();
            } else {
                updateStorageStatus("Zaloguj się, aby wczytać katalog", true);
                setEditorStatus("Po zalogowaniu aplikacja pobierze wspólny katalog z Supabase.");
            }
        })
        .catch(error => {
            console.error("SA Event Maps: Nie udało się sprawdzić sesji.", error);
            updateStorageStatus("Błąd sesji Supabase", false);
        });

    clearSelectedLocation();
    updateGlobalCounters();

    console.info("SA Event Maps: Aplikacja mapy uruchomiona; źródłem danych jest Supabase.");
})();
