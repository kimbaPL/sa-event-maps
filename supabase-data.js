"use strict";

/*
========================================================
SA EVENT MAPS
SUPABASE DATA LAYER
========================================================

Supabase is the source of truth.
This module owns database access and row mapping.
The UI must not write directly to localStorage.

========================================================
*/

(() => {
    const supabase = window.supabaseClient;

    if (!supabase || typeof supabase.from !== "function") {
        console.error("SA Event Maps: Brak poprawnego klienta Supabase.");
        return;
    }

    const PAGE_SIZE = 1000;
    const VALID_PROGRESS_STATUSES = new Set([
        "not_found",
        "found",
        "not_present",
        "uncertain"
    ]);

    function throwDatabaseError(table, error) {
        console.error(`SA Event Maps: Błąd operacji na tabeli ${table}.`, error);
        throw new Error(error?.message || `Nie udało się wykonać operacji na tabeli ${table}.`);
    }

    async function exportOrganizationBackup() {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_export_organization_backup");
        if (error) throwDatabaseError("admin_export_organization_backup", error);
        if (!data || data.schema !== "sa-event-maps-organization-backup" || !data.data) {
            throw new Error("Supabase zwrócił nieprawidłową strukturę kopii organizacji.");
        }
        return data;
    }

    async function previewOrganizationBackup(backup) {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_preview_organization_backup", {
            p_backup: backup
        });
        if (error) throwDatabaseError("admin_preview_organization_backup", error);
        if (!data || typeof data.can_restore !== "boolean" || !data.counts) {
            throw new Error("Nie udało się uzyskać prawidłowego podglądu kopii.");
        }
        return data;
    }

    async function restoreOrganizationBackup(backup) {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_restore_organization_backup", {
            p_backup: backup
        });
        if (error) throwDatabaseError("admin_restore_organization_backup", error);
        if (!data || data.restore_mode !== "merge") {
            throw new Error("Supabase nie potwierdził prawidłowego przywrócenia kopii.");
        }
        return data;
    }

    async function getUserContext() {
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError) {
            throw userError;
        }

        const user = userData?.user;

        if (!user) {
            throw new Error("Użytkownik nie jest zalogowany.");
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, display_name, role, is_owner")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) {
            throwDatabaseError("profiles", profileError);
        }

        if (!profile) {
            throw new Error("Nie znaleziono profilu zalogowanego użytkownika.");
        }

        const context = {
            id: user.id,
            email: user.email || "",
            displayName: profile.display_name || user.email || "Gracz",
            role: profile.role || "player",
            isAdmin: profile.role === "admin",
            isOwner: Boolean(profile.is_owner)
        };

        window.saEventMapsUser = context;
        return context;
    }

    async function requireAdmin() {
        const user = await getUserContext();

        if (!user.isAdmin) {
            throw new Error("Ta operacja jest dostępna wyłącznie dla administratora.");
        }

        return user;
    }

    async function fetchAllRows(table, columns, configureQuery = null) {
        const output = [];

        for (let offset = 0; ; offset += PAGE_SIZE) {
            let query = supabase.from(table).select(columns);

            if (typeof configureQuery === "function") {
                query = configureQuery(query);
            }

            const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

            if (error) {
                throwDatabaseError(table, error);
            }

            const page = data || [];
            output.push(...page);

            if (page.length < PAGE_SIZE) {
                break;
            }
        }

        return output;
    }

    function mapLocation(row) {
        return {
            id: row.id,
            name: row.name,
            area: row.area || "Nie określono",
            description: row.description || "",
            world: {
                x: Number(row.game_x),
                y: Number(row.game_y),
                z: row.game_z === null ? null : Number(row.game_z)
            },
            createdBy: row.created_by,
            isPinned: Boolean(row.is_pinned),
            isArchived: Boolean(row.is_archived),
            archivedAt: row.archived_at,
            archivedBy: row.archived_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    function mapEvent(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description || "",
            startDate: row.start_date || "",
            endDate: row.end_date || "",
            officialCollectibleCount: row.official_collectible_count,
            status: row.status,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            archivedAt: row.archived_at,
            archivedBy: row.archived_by,
            statusBeforeArchive: row.status_before_archive
        };
    }

    function mapEventLocation(row) {
        return {
            id: row.id,
            eventId: row.event_id,
            locationId: row.location_id,
            categoryId: row.category_id,
            addedBy: row.added_by,
            createdAt: row.created_at
        };
    }

    function mapCategory(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description || "",
            color: row.color,
            icon: row.icon,
            sortOrder: row.sort_order,
            isArchived: Boolean(row.is_archived),
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    function mapProgress(row) {
        return {
            userId: row.user_id,
            eventId: row.event_id,
            locationId: row.location_id,
            status: row.status,
            needsCheck: Boolean(row.needs_check),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async function loadCatalog() {
        const user = await getUserContext();

        const [
            locationRows,
            eventRows,
            eventLocationRows,
            categoryRows,
            progressRows
        ] = await Promise.all([
            fetchAllRows(
                "locations",
                "id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at",
                query => query.order("created_at", { ascending: true })
            ),
            fetchAllRows(
                "events",
                "id, name, description, start_date, end_date, official_collectible_count, status, created_by, created_at, updated_at, archived_at, archived_by, status_before_archive",
                query => query.order("created_at", { ascending: true })
            ),
            fetchAllRows(
                "event_locations",
                "id, event_id, location_id, category_id, added_by, created_at",
                query => query.order("created_at", { ascending: true })
            ),
            fetchAllRows(
                "categories",
                "id, name, description, color, icon, sort_order, is_archived, created_by, created_at, updated_at",
                query => query.order("sort_order", { ascending: true }).order("name", { ascending: true })
            ),
            fetchAllRows(
                "player_progress",
                "user_id, event_id, location_id, status, needs_check, created_at, updated_at",
                query => query.eq("user_id", user.id).order("updated_at", { ascending: false })
            )
        ]);

        const catalog = {
            user,
            locations: locationRows.map(mapLocation),
            events: eventRows.map(mapEvent),
            eventLocations: eventLocationRows.map(mapEventLocation),
            categories: categoryRows.map(mapCategory),
            playerProgress: progressRows.map(mapProgress)
        };

        console.info("SA Event Maps: Pobrano dane z Supabase.", {
            locations: catalog.locations.length,
            events: catalog.events.length,
            assignments: catalog.eventLocations.length,
            categories: catalog.categories.length,
            playerProgress: catalog.playerProgress.length
        });

        return catalog;
    }

    async function listAdminEvents() {
        await requireAdmin();
        const rows = await fetchAllRows(
            "events",
            "id, name, description, start_date, end_date, official_collectible_count, status, created_by, created_at, updated_at, archived_at, archived_by, status_before_archive",
            query => query.order("created_at", { ascending: false })
        );
        return rows.map(mapEvent);
    }

    async function listAdminLocations() {
        await requireAdmin();
        const rows = await fetchAllRows(
            "locations",
            "id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at",
            query => query.order("created_at", { ascending: false })
        );
        return rows.map(mapLocation);
    }

    async function listAdminEventLocations() {
        await requireAdmin();
        const rows = await fetchAllRows(
            "event_locations",
            "id, event_id, location_id, category_id, added_by, created_at",
            query => query.order("created_at", { ascending: false })
        );
        return rows.map(mapEventLocation);
    }

    function finiteNumber(value, fieldName, nullable = false) {
        if ((value === null || value === undefined || value === "") && nullable) {
            return null;
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            throw new Error(`Pole ${fieldName} musi zawierać prawidłową liczbę.`);
        }

        return number;
    }

    async function createLocation(input) {
        const user = await getUserContext();

        const name = String(input?.name || "").trim();
        if (!name) {
            throw new Error("Podaj nazwę znajdźki.");
        }

        const world = input.world || {};
        const row = {
            name,
            area: String(input.area || "Nie określono").trim() || "Nie określono",
            game_x: finiteNumber(world.x, "X"),
            game_y: finiteNumber(world.y, "Y"),
            game_z: finiteNumber(world.z, "Z", true),
            description: String(input.description || "").trim(),
            created_by: user.id,
            is_pinned: false,
            is_archived: false
        };

        const { data, error } = await supabase
            .from("locations")
            .insert(row)
            .select("id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at")
            .single();

        if (error) {
            throwDatabaseError("locations", error);
        }

        return mapLocation(data);
    }

    async function updateLocation(locationId, input) {
        if (!locationId) {
            throw new Error("Brakuje identyfikatora lokalizacji.");
        }

        const update = {};

        if (Object.hasOwn(input, "name")) {
            const name = String(input.name || "").trim();
            if (!name) throw new Error("Nazwa znajdźki nie może być pusta.");
            update.name = name;
        }

        if (Object.hasOwn(input, "area")) {
            update.area = String(input.area || "Nie określono").trim() || "Nie określono";
        }

        if (Object.hasOwn(input, "description")) {
            update.description = String(input.description || "").trim();
        }

        if (input.world) {
            if (Object.hasOwn(input.world, "x")) update.game_x = finiteNumber(input.world.x, "X");
            if (Object.hasOwn(input.world, "y")) update.game_y = finiteNumber(input.world.y, "Y");
            if (Object.hasOwn(input.world, "z")) update.game_z = finiteNumber(input.world.z, "Z", true);
        }

        if (Object.keys(update).length === 0) {
            throw new Error("Nie podano żadnych zmian do zapisania.");
        }

        update.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from("locations")
            .update(update)
            .eq("id", locationId)
            .select("id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at")
            .maybeSingle();

        if (error) {
            throwDatabaseError("locations", error);
        }

        if (!data) {
            throw new Error("Nie zapisano zmian. Sprawdź, czy masz prawo edytować tę pinezkę.");
        }

        return mapLocation(data);
    }

    async function setLocationPinned(locationId, pinned) {
        await requireAdmin();

        const { data, error } = await supabase
            .from("locations")
            .update({
                is_pinned: Boolean(pinned),
                updated_at: new Date().toISOString()
            })
            .eq("id", locationId)
            .eq("is_archived", false)
            .select("id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at")
            .maybeSingle();

        if (error) {
            throwDatabaseError("locations", error);
        }

        if (!data) {
            throw new Error("Nie udało się zmienić przypięcia tej lokalizacji.");
        }

        return mapLocation(data);
    }

    async function archiveLocation(locationId) {
        const user = await requireAdmin();

        const { data, error } = await supabase
            .from("locations")
            .update({
                is_archived: true,
                archived_at: new Date().toISOString(),
                archived_by: user.id,
                updated_at: new Date().toISOString()
            })
            .eq("id", locationId)
            .eq("is_archived", false)
            .select("id")
            .maybeSingle();

        if (error) {
            throwDatabaseError("locations", error);
        }

        if (!data) {
            throw new Error("Nie udało się zarchiwizować lokalizacji.");
        }

        return true;
    }

    async function restoreLocation(locationId) {
        await requireAdmin();

        const { data, error } = await supabase
            .from("locations")
            .update({
                is_archived: false,
                archived_at: null,
                archived_by: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", locationId)
            .eq("is_archived", true)
            .select("id, name, area, game_x, game_y, game_z, description, created_by, is_pinned, is_archived, archived_at, archived_by, created_at, updated_at")
            .maybeSingle();

        if (error) throwDatabaseError("locations", error);
        if (!data) throw new Error("Nie udało się przywrócić lokalizacji.");
        return mapLocation(data);
    }

    async function deleteLocation(locationId) {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_delete_location", {
            p_location_id: locationId
        });
        if (error) throwDatabaseError("locations", error);
        if (data !== true) throw new Error("Nie udało się trwale usunąć lokalizacji.");
        return true;
    }

    async function createEvent(input) {
        const user = await requireAdmin();

        const name = String(input?.name || "").trim();
        if (!name) throw new Error("Podaj nazwę wydarzenia.");

        const count = input.officialCollectibleCount === null || input.officialCollectibleCount === ""
            ? null
            : Math.trunc(finiteNumber(input.officialCollectibleCount, "Oficjalna liczba znajdziek"));

        if (count !== null && count < 0) {
            throw new Error("Oficjalna liczba znajdziek nie może być ujemna.");
        }

        const status = String(input.status || "draft").trim();
        if (!["draft", "active", "completed"].includes(status)) {
            throw new Error("Nieprawidłowy status wydarzenia.");
        }

        if (input.startDate && input.endDate && input.endDate < input.startDate) {
            throw new Error("Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.");
        }

        const row = {
            name,
            description: String(input.description || "").trim(),
            start_date: input.startDate || null,
            end_date: input.endDate || null,
            official_collectible_count: count,
            status,
            created_by: user.id
        };

        const { data, error } = await supabase
            .from("events")
            .insert(row)
            .select("id, name, description, start_date, end_date, official_collectible_count, status, created_by, created_at, updated_at, archived_at, archived_by, status_before_archive")
            .single();

        if (error) throwDatabaseError("events", error);
        return mapEvent(data);
    }

    async function updateEvent(eventId, input) {
        await requireAdmin();

        const update = {
            updated_at: new Date().toISOString()
        };

        if (Object.hasOwn(input, "name")) {
            const name = String(input.name || "").trim();
            if (!name) throw new Error("Nazwa wydarzenia nie może być pusta.");
            update.name = name;
        }

        if (Object.hasOwn(input, "description")) {
            update.description = String(input.description || "").trim();
        }

        if (Object.hasOwn(input, "startDate")) {
            update.start_date = input.startDate || null;
        }

        if (Object.hasOwn(input, "endDate")) {
            update.end_date = input.endDate || null;
        }

        if (Object.hasOwn(input, "officialCollectibleCount")) {
            const value = input.officialCollectibleCount;
            const count = value === null || value === ""
                ? null
                : Math.trunc(finiteNumber(value, "Oficjalna liczba znajdziek"));

            if (count !== null && count < 0) {
                throw new Error("Oficjalna liczba znajdziek nie może być ujemna.");
            }

            update.official_collectible_count = count;
        }

        if (Object.hasOwn(input, "status")) {
            const status = String(input.status || "").trim();
            if (!["draft", "active", "completed"].includes(status)) {
                throw new Error("Nieprawidłowy status wydarzenia.");
            }
            update.status = status;
        }

        const { data, error } = await supabase
            .from("events")
            .update(update)
            .eq("id", eventId)
            .neq("status", "archived")
            .select("id, name, description, start_date, end_date, official_collectible_count, status, created_by, created_at, updated_at, archived_at, archived_by, status_before_archive")
            .maybeSingle();

        if (error) throwDatabaseError("events", error);
        if (!data) throw new Error("Nie udało się zapisać wydarzenia.");

        return mapEvent(data);
    }

    async function archiveEvent(eventId) {
        const user = await requireAdmin();

        const { data: current, error: readError } = await supabase
            .from("events")
            .select("id, status")
            .eq("id", eventId)
            .maybeSingle();

        if (readError) throwDatabaseError("events", readError);
        if (!current || current.status === "archived") {
            throw new Error("Nie znaleziono aktywnego wydarzenia do archiwizacji.");
        }

        const now = new Date().toISOString();

        const { error } = await supabase
            .from("events")
            .update({
                status_before_archive: current.status,
                status: "archived",
                archived_at: now,
                archived_by: user.id,
                updated_at: now
            })
            .eq("id", eventId);

        if (error) throwDatabaseError("events", error);
        return true;
    }

    async function restoreEvent(eventId) {
        await requireAdmin();

        const { data: current, error: readError } = await supabase
            .from("events")
            .select("id, status, status_before_archive")
            .eq("id", eventId)
            .maybeSingle();

        if (readError) throwDatabaseError("events", readError);
        if (!current || current.status !== "archived") {
            throw new Error("Nie znaleziono zarchiwizowanego wydarzenia do przywrócenia.");
        }

        const allowedStatuses = new Set(["draft", "active", "completed"]);
        const restoredStatus = allowedStatuses.has(current.status_before_archive)
            ? current.status_before_archive
            : "draft";

        const { data, error } = await supabase
            .from("events")
            .update({
                status: restoredStatus,
                status_before_archive: null,
                archived_at: null,
                archived_by: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", eventId)
            .eq("status", "archived")
            .select("id, name, description, start_date, end_date, official_collectible_count, status, created_by, created_at, updated_at, archived_at, archived_by, status_before_archive")
            .maybeSingle();

        if (error) throwDatabaseError("events", error);
        if (!data) throw new Error("Nie udało się przywrócić wydarzenia. Być może zostało już przywrócone przez innego administratora.");
        return mapEvent(data);
    }

    async function deleteEvent(eventId) {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_delete_event", {
            p_event_id: eventId
        });
        if (error) throwDatabaseError("events", error);
        if (data !== true) throw new Error("Nie udało się trwale usunąć wydarzenia.");
        return true;
    }

    async function assignLocationToEvent(eventId, locationId, categoryId = null) {
        const user = await getUserContext();

        if (!eventId || !locationId) {
            throw new Error("Wybierz wydarzenie i lokalizację.");
        }

        if (categoryId && !user.isAdmin) {
            throw new Error("Kategorię może przypisać wyłącznie administrator.");
        }

        const row = {
            event_id: eventId,
            location_id: locationId,
            category_id: categoryId,
            added_by: user.id
        };

        const { data, error } = await supabase
            .from("event_locations")
            .insert(row)
            .select("id, event_id, location_id, category_id, added_by, created_at")
            .single();

        if (error) {
            if (error.code === "23505") {
                throw new Error("Ta znajdźka jest już przypisana do tego wydarzenia.");
            }
            throwDatabaseError("event_locations", error);
        }

        return mapEventLocation(data);
    }

    async function removeLocationFromEvent(eventId, locationId) {
        await requireAdmin();

        const { data, error } = await supabase
            .from("event_locations")
            .delete()
            .eq("event_id", eventId)
            .eq("location_id", locationId)
            .select("id")
            .maybeSingle();

        if (error) throwDatabaseError("event_locations", error);
        if (!data) throw new Error("Nie udało się usunąć przypisania.");
        return true;
    }

    async function setProgress(eventId, locationId, status, needsCheck) {
        const user = await getUserContext();

        if (!VALID_PROGRESS_STATUSES.has(status)) {
            throw new Error("Nieprawidłowy status znajdźki.");
        }

        const now = new Date().toISOString();

        const row = {
            user_id: user.id,
            event_id: eventId,
            location_id: locationId,
            status,
            needs_check: Boolean(needsCheck),
            updated_at: now
        };

        const { data, error } = await supabase
            .from("player_progress")
            .upsert(row, {
                onConflict: "user_id,event_id,location_id"
            })
            .select("user_id, event_id, location_id, status, needs_check, created_at, updated_at")
            .single();

        if (error) throwDatabaseError("player_progress", error);
        return mapProgress(data);
    }

    async function listCategories() {
        await requireAdmin();

        const { data, error } = await supabase
            .from("categories")
            .select("id, name, description, color, icon, sort_order, is_archived, created_by, created_at, updated_at")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });

        if (error) throwDatabaseError("categories", error);
        return (data || []).map(mapCategory);
    }

    async function createCategory(input) {
        const user = await requireAdmin();
        const name = String(input?.name || "").trim();

        if (!name) throw new Error("Podaj nazwę kategorii.");

        const row = {
            name,
            description: String(input.description || "").trim(),
            color: input.color || null,
            icon: input.icon || null,
            sort_order: Math.trunc(Number(input.sortOrder) || 0),
            created_by: user.id
        };

        const { data, error } = await supabase
            .from("categories")
            .insert(row)
            .select("id, name, description, color, icon, sort_order, is_archived, created_by, created_at, updated_at")
            .single();

        if (error) throwDatabaseError("categories", error);
        return mapCategory(data);
    }

    async function updateCategory(categoryId, input) {
        await requireAdmin();

        const update = {};
        if (Object.hasOwn(input, "name")) update.name = String(input.name || "").trim();
        if (Object.hasOwn(input, "description")) update.description = String(input.description || "").trim();
        if (Object.hasOwn(input, "color")) update.color = input.color || null;
        if (Object.hasOwn(input, "icon")) update.icon = input.icon || null;
        if (Object.hasOwn(input, "sortOrder")) update.sort_order = Math.trunc(Number(input.sortOrder) || 0);

        if (Object.keys(update).length === 0) throw new Error("Nie podano zmian kategorii.");

        const { data, error } = await supabase
            .from("categories")
            .update(update)
            .eq("id", categoryId)
            .eq("is_archived", false)
            .select("id, name, description, color, icon, sort_order, is_archived, created_by, created_at, updated_at")
            .maybeSingle();

        if (error) throwDatabaseError("categories", error);
        if (!data) throw new Error("Nie udało się zmienić kategorii.");
        return mapCategory(data);
    }

    async function archiveCategory(categoryId) {
        await requireAdmin();

        const { data, error } = await supabase
            .from("categories")
            .update({ is_archived: true })
            .eq("id", categoryId)
            .eq("is_archived", false)
            .select("id")
            .maybeSingle();

        if (error) throwDatabaseError("categories", error);
        if (!data) throw new Error("Nie udało się zarchiwizować kategorii.");
        return true;
    }

    async function restoreCategory(categoryId) {
        await requireAdmin();

        const { data, error } = await supabase
            .from("categories")
            .update({ is_archived: false })
            .eq("id", categoryId)
            .eq("is_archived", true)
            .select("id")
            .maybeSingle();

        if (error) throwDatabaseError("categories", error);
        if (!data) throw new Error("Nie udało się przywrócić kategorii. Sprawdź, czy aktywna kategoria o tej samej nazwie już nie istnieje.");
        return true;
    }

    async function deleteCategory(categoryId) {
        await requireAdmin();

        const { data, error } = await supabase.rpc("admin_delete_category", {
            p_category_id: categoryId
        });

        if (error) throwDatabaseError("categories", error);
        if (data !== true) throw new Error("Nie udało się trwale usunąć kategorii.");
        return true;
    }

    window.saEventMapsData = Object.freeze({
        getUserContext,
        loadCatalog,
        exportOrganizationBackup,
        previewOrganizationBackup,
        restoreOrganizationBackup,
        createLocation,
        updateLocation,
        setLocationPinned,
        archiveLocation,
        restoreLocation,
        deleteLocation,
        createEvent,
        updateEvent,
        archiveEvent,
        restoreEvent,
        deleteEvent,
        listAdminEvents,
        listAdminLocations,
        listAdminEventLocations,
        assignLocationToEvent,
        removeLocationFromEvent,
        setProgress,
        listCategories,
        createCategory,
        updateCategory,
        archiveCategory,
        restoreCategory,
        deleteCategory
    });

    console.info("SA Event Maps: Warstwa komunikacji z Supabase została uruchomiona.");
})();
