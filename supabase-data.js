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

    const IMAGE_BUCKET = "location-screenshots";
    const MAX_COMPRESSED_IMAGE_BYTES = 500000;
    const TARGET_COMPRESSED_IMAGE_BYTES = 300000;
    const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
    const MAX_SOURCE_IMAGE_PIXELS = 40 * 1000 * 1000;

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
        }
        return btoa(binary);
    }

    function base64ToBytes(value) {
        if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
            throw new Error("Kopia zawiera nieprawidłowe dane binarne zdjęcia.");
        }
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    function bytesEqual(left, right) {
        if (left.byteLength !== right.byteLength) return false;
        for (let index = 0; index < left.byteLength; index += 1) {
            if (left[index] !== right[index]) return false;
        }
        return true;
    }

    function validateBackupImages(backup, { requireBinary = false } = {}) {
        const data = backup?.data || {};
        const images = Array.isArray(data.location_images) ? data.location_images : [];
        const files = Array.isArray(data.storage_files) ? data.storage_files : [];

        if (images.length !== files.length) {
            throw new Error("Kopia ma niezgodną liczbę metadanych zdjęć i plików Storage.");
        }

        const locations = new Set();
        const paths = new Set();
        const filesByPath = new Map();

        for (const file of files) {
            if (!file || typeof file.object_path !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i.test(file.object_path)) {
                throw new Error("Kopia zawiera nieprawidłową ścieżkę zdjęcia.");
            }
            if (paths.has(file.object_path)) throw new Error("Kopia zawiera powtórzoną ścieżkę zdjęcia.");
            paths.add(file.object_path);
            if (file.mime_type !== "image/webp" || !Number.isInteger(Number(file.size_bytes)) || Number(file.size_bytes) < 1 || Number(file.size_bytes) > MAX_COMPRESSED_IMAGE_BYTES) {
                throw new Error("Kopia zawiera zdjęcie z nieprawidłowym formatem lub rozmiarem.");
            }
            if (requireBinary) {
                if (typeof file.data_base64 !== "string" || file.data_base64.length > 670000) {
                    throw new Error("Kopia zawiera zbyt duży lub nieprawidłowy zapis binarny zdjęcia.");
                }
                const bytes = base64ToBytes(file.data_base64);
                if (bytes.byteLength !== Number(file.size_bytes)) {
                    throw new Error(`Rozmiar pliku „${file.object_path}” nie zgadza się z metadanymi kopii.`);
                }
                const isWebP = bytes.byteLength >= 12
                    && bytes[0] === 0x52 && bytes[1] === 0x49
                    && bytes[2] === 0x46 && bytes[3] === 0x46
                    && bytes[8] === 0x57 && bytes[9] === 0x45
                    && bytes[10] === 0x42 && bytes[11] === 0x50;
                if (!isWebP) throw new Error(`Plik „${file.object_path}” nie zawiera prawidłowego obrazu WebP.`);
            }
            filesByPath.set(file.object_path, file);
        }

        for (const image of images) {
            if (!image || typeof image.location_id !== "string" || !image.id || !paths.has(image.object_path)) {
                throw new Error("Kopia zawiera zdjęcie bez zgodnego pliku Storage.");
            }
            if (!image.object_path.startsWith(`${image.location_id}/`)) {
                throw new Error("Ścieżka pliku zdjęcia nie odpowiada identyfikatorowi znajdźki.");
            }
            if (locations.has(image.location_id)) throw new Error("Kopia zawiera więcej niż jedno zdjęcie dla tej samej znajdźki.");
            locations.add(image.location_id);
            const file = filesByPath.get(image.object_path);
            if (image.mime_type !== file.mime_type || Number(image.size_bytes) !== Number(file.size_bytes)) {
                throw new Error(`Metadane zdjęcia „${image.object_path}” nie zgadzają się z plikiem.`);
            }
            if (!Number.isInteger(Number(image.image_width)) || !Number.isInteger(Number(image.image_height))) {
                throw new Error("Kopia zawiera nieprawidłową rozdzielczość zdjęcia.");
            }
        }

        return { images, files };
    }

    function backupWithoutBinaryPayload(backup) {
        const copy = JSON.parse(JSON.stringify(backup));
        const files = Array.isArray(copy?.data?.storage_files) ? copy.data.storage_files : [];
        copy.data.storage_files = files.map(({ data_base64, ...manifest }) => manifest);
        return copy;
    }

    async function getImageUploadSettings() {
        const { data, error } = await supabase.rpc("get_image_upload_settings");
        if (error) throwDatabaseError("get_image_upload_settings", error);
        return {
            allowPlayerUploads: Boolean(data?.allow_player_image_uploads),
            administratorsCanUpload: Boolean(data?.administrator_can_upload)
        };
    }

    async function setPlayerImageUploadsEnabled(enabled) {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_set_player_image_uploads_enabled", {
            p_enabled: Boolean(enabled)
        });
        if (error) throwDatabaseError("admin_set_player_image_uploads_enabled", error);
        return {
            allowPlayerUploads: Boolean(data?.allow_player_image_uploads),
            administratorsCanUpload: Boolean(data?.administrator_can_upload)
        };
    }

    async function compressLocationImage(file) {
        if (!(file instanceof Blob) || file.size <= 0) {
            throw new Error("Wybierz prawidłowy plik graficzny.");
        }
        if (file.size > MAX_SOURCE_IMAGE_BYTES) {
            throw new Error("Wybrane zdjęcie jest większe niż 20 MB. Zmniejsz je przed dodaniem.");
        }
        if (file.type && !file.type.startsWith("image/")) {
            throw new Error("Wybrany plik nie jest obrazem.");
        }
        if (typeof createImageBitmap !== "function") {
            throw new Error("Ta przeglądarka nie udostępnia bezpiecznej konwersji zdjęć. Zaktualizuj przeglądarkę.");
        }

        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (error) {
            throw new Error("Przeglądarka nie potrafi odczytać tego formatu. Użyj PNG, JPG lub WebP (HEIC może wymagać wcześniejszej konwersji).");
        }

        try {
            const pixels = bitmap.width * bitmap.height;
            if (pixels > MAX_SOURCE_IMAGE_PIXELS) {
                throw new Error("Zdjęcie ma zbyt dużą rozdzielczość. Maksymalnie 40 megapikseli.");
            }

            const dimensions = [1600, 1440, 1280, 1152, 1024];
            const qualities = [0.68, 0.62, 0.56, 0.50];
            let targetCandidate = null;
            let fallbackCandidate = null;

            for (const maxDimension of dimensions) {
                const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
                const width = Math.max(1, Math.round(bitmap.width * scale));
                const height = Math.max(1, Math.round(bitmap.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("Nie udało się przygotować obrazu do kompresji.");
                context.fillStyle = "#ffffff";
                context.fillRect(0, 0, width, height);
                context.drawImage(bitmap, 0, 0, width, height);

                for (const quality of qualities) {
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
                    if (!blob || blob.type !== "image/webp") {
                        throw new Error("Przeglądarka nie potrafi zapisać zdjęcia w formacie WebP.");
                    }
                    const candidate = { blob, width, height, quality };
                    if (blob.size <= MAX_COMPRESSED_IMAGE_BYTES
                        && (!fallbackCandidate || blob.size < fallbackCandidate.blob.size)) {
                        fallbackCandidate = candidate;
                    }
                    // Prefer the smallest file that retains at least 1152 px on its
                    // longest side and a moderate WebP quality. Continue testing all
                    // candidates instead of stopping at the first file below target.
                    if (Math.max(width, height) >= 1152
                        && quality >= 0.56
                        && blob.size <= TARGET_COMPRESSED_IMAGE_BYTES
                        && (!targetCandidate || blob.size < targetCandidate.blob.size)) {
                        targetCandidate = candidate;
                    }
                }
            }

            const chosen = targetCandidate || fallbackCandidate;
            if (!chosen) {
                throw new Error("Nie udało się zmniejszyć zdjęcia do bezpiecznego limitu 500 KB. Wybierz mniej szczegółowy obraz.");
            }
            return {
                blob: chosen.blob,
                width: chosen.width,
                height: chosen.height,
                originalName: String(file.name || "screenshot").replace(/[\\/\r\n\0]/g, "_").slice(0, 180)
            };
        } finally {
            bitmap.close?.();
        }
    }

    async function uploadLocationImage(locationId, file) {
        const user = await getUserContext();
        if (!locationId) throw new Error("Brakuje identyfikatora znajdźki.");
        if (!file) return null;

        const settings = await getImageUploadSettings();
        if (!settings.allowPlayerUploads && !user.isAdmin) {
            throw new Error("Administrator zablokował dodawanie nowych zdjęć. Istniejące zdjęcia nadal są widoczne.");
        }

        const processed = file?.blob instanceof Blob
            ? file
            : await compressLocationImage(file);
        if (!(processed.blob instanceof Blob) || processed.blob.size > MAX_COMPRESSED_IMAGE_BYTES) {
            throw new Error("Przygotowany obraz przekracza limit 500 KB albo ma nieprawidłowy format.");
        }
        const { data: existingImage, error: existingError } = await supabase
            .from("location_images")
            .select("id")
            .eq("location_id", locationId)
            .maybeSingle();
        if (existingError) throwDatabaseError("location_images", existingError);
        if (existingImage) throw new Error("Ta znajdźka ma już przypisane zdjęcie. Jedna lokalizacja może mieć tylko jeden screenshot.");

        const objectPath = `${locationId}/${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage
            .from(IMAGE_BUCKET)
            .upload(objectPath, processed.blob, {
                cacheControl: "31536000",
                contentType: "image/webp",
                upsert: false
            });

        if (uploadError) throwDatabaseError("Storage — location-screenshots", uploadError);

        const row = {
            location_id: locationId,
            object_path: objectPath,
            original_name: processed.originalName,
            mime_type: "image/webp",
            size_bytes: processed.blob.size,
            image_width: processed.width,
            image_height: processed.height,
            uploaded_by: user.id
        };

        const { data, error } = await supabase
            .from("location_images")
            .insert(row)
            .select("id, location_id, object_path, original_name, mime_type, size_bytes, image_width, image_height, uploaded_by, is_archived, archived_at, archived_by, created_at, updated_at")
            .single();

        if (error) {
            const cleanup = await supabase.storage.from(IMAGE_BUCKET).remove([objectPath]);
            if (cleanup.error) console.warn("SA Event Maps: Nie udało się posprzątać niepowiązanego pliku po błędzie rejestracji zdjęcia.", cleanup.error);
            throwDatabaseError("location_images", error);
        }
        return data;
    }

    function validateCatalogProgressBackup(backup) {
        const rows = backup?.data?.player_catalog_progress;
        if (rows === undefined) return []; // Backups created before the catalog-progress feature remain valid.
        if (!Array.isArray(rows)) {
            throw new Error("Kopia zawiera nieprawidłową listę postępów katalogowych.");
        }

        const allowedStatuses = new Set(["not_found", "found", "not_present", "uncertain"]);
        const seen = new Set();
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        for (const row of rows) {
            if (!row || !uuidPattern.test(String(row.user_id || "")) || !uuidPattern.test(String(row.location_id || ""))) {
                throw new Error("Kopia zawiera postęp katalogowy bez prawidłowego użytkownika lub znajdźki.");
            }
            if (!allowedStatuses.has(row.status)) {
                throw new Error("Kopia zawiera nieprawidłowy status postępu katalogowego.");
            }
            if (row.needs_check !== undefined && typeof row.needs_check !== "boolean") {
                throw new Error("Kopia zawiera nieprawidłowe oznaczenie „Do sprawdzenia”.");
            }
            const key = `${row.user_id}:${row.location_id}`;
            if (seen.has(key)) {
                throw new Error("Kopia zawiera powtórzony status katalogowy dla tej samej osoby i znajdźki.");
            }
            seen.add(key);
        }

        return rows;
    }

    async function getLocationImage(locationId) {
        if (!locationId) return null;
        const { data: image, error } = await supabase
            .from("location_images")
            .select("id, location_id, object_path, original_name, mime_type, size_bytes, image_width, image_height, uploaded_by, is_archived, archived_at, archived_by, created_at, updated_at")
            .eq("location_id", locationId)
            .maybeSingle();
        if (error) throwDatabaseError("location_images", error);
        if (!image) return null;

        const { data: signed, error: signedError } = await supabase.storage
            .from(IMAGE_BUCKET)
            .createSignedUrl(image.object_path, 300);
        if (signedError) throwDatabaseError("Storage — podpisany adres zdjęcia", signedError);
        return { ...image, signedUrl: signed?.signedUrl || "" };
    }

    async function archiveLocationImage(imageId) {
        await requireAdmin();
        const { data, error } = await supabase
            .from("location_images")
            .update({ is_archived: true })
            .eq("id", imageId)
            .eq("is_archived", false)
            .select("id")
            .maybeSingle();
        if (error) throwDatabaseError("location_images", error);
        if (!data) throw new Error("Nie udało się zarchiwizować zdjęcia.");
        return true;
    }

    async function restoreLocationImage(imageId) {
        await requireAdmin();
        const { data, error } = await supabase
            .from("location_images")
            .update({ is_archived: false })
            .eq("id", imageId)
            .eq("is_archived", true)
            .select("id")
            .maybeSingle();
        if (error) throwDatabaseError("location_images", error);
        if (!data) throw new Error("Nie udało się przywrócić zdjęcia.");
        return true;
    }

    async function deleteLocationImage(imageId) {
        await requireAdmin();
        const { data: image, error: imageError } = await supabase
            .from("location_images")
            .select("id, object_path")
            .eq("id", imageId)
            .maybeSingle();
        if (imageError) throwDatabaseError("location_images", imageError);
        if (!image) throw new Error("Nie znaleziono zdjęcia.");

        const { error: storageError } = await supabase.storage
            .from(IMAGE_BUCKET)
            .remove([image.object_path]);
        if (storageError && !/not found|does not exist|404/i.test(storageError.message || "")) {
            throwDatabaseError("Storage — trwałe usuwanie zdjęcia", storageError);
        }

        const { error: deleteError } = await supabase
            .from("location_images")
            .delete()
            .eq("id", image.id);
        if (deleteError) throwDatabaseError("location_images", deleteError);
        return true;
    }

    async function exportOrganizationBackup() {
        await requireAdmin();
        const { data, error } = await supabase.rpc("admin_export_organization_backup");
        if (error) throwDatabaseError("admin_export_organization_backup", error);
        if (!data || data.schema !== "sa-event-maps-organization-backup" || !data.data) {
            throw new Error("Supabase zwrócił nieprawidłową strukturę kopii organizacji.");
        }

        const imageRows = await fetchAllRows(
            "location_images",
            "id, location_id, object_path, original_name, mime_type, size_bytes, image_width, image_height, uploaded_by, is_archived, archived_at, archived_by, created_at, updated_at",
            query => query.order("location_id", { ascending: true })
        );
        data.data.location_images = imageRows;
        data.data.storage_files = [];

        for (const imageRow of imageRows) {
            const { data: blob, error: downloadError } = await supabase.storage
                .from(IMAGE_BUCKET)
                .download(imageRow.object_path);
            if (downloadError) {
                throw new Error(`Nie udało się pobrać zdjęcia „${imageRow.original_name || imageRow.object_path}” do kopii: ${downloadError.message}`);
            }
            const buffer = await blob.arrayBuffer();
            if (buffer.byteLength !== Number(imageRow.size_bytes)) {
                throw new Error(`Rozmiar zdjęcia „${imageRow.original_name || imageRow.object_path}” nie zgadza się z metadanymi. Kopia nie została utworzona.`);
            }
            data.data.storage_files.push({
                object_path: imageRow.object_path,
                mime_type: imageRow.mime_type,
                size_bytes: buffer.byteLength,
                data_base64: arrayBufferToBase64(buffer)
            });
        }
        return data;
    }

    async function previewOrganizationBackup(backup) {
        await requireAdmin();
        const { images, files } = validateBackupImages(backup, { requireBinary: true });
        const catalogProgress = validateCatalogProgressBackup(backup);
        const sanitized = backupWithoutBinaryPayload(backup);
        const { data, error } = await supabase.rpc("admin_preview_organization_backup", {
            p_backup: sanitized
        });
        if (error) throwDatabaseError("admin_preview_organization_backup", error);
        if (!data || typeof data.can_restore !== "boolean" || !data.counts) {
            throw new Error("Nie udało się uzyskać prawidłowego podglądu kopii.");
        }
        data.counts.location_images = images.length;
        data.counts.storage_files = files.length;
        data.counts.player_catalog_progress = catalogProgress.length;
        return data;
    }

    async function restoreOrganizationBackup(backup) {
        await requireAdmin();
        const { images, files } = validateBackupImages(backup, { requireBinary: true });
        validateCatalogProgressBackup(backup);
        const sanitized = backupWithoutBinaryPayload(backup);
        const backupPaths = new Set(files.map(file => file.object_path));
        const locationIds = images.map(image => image.location_id);

        let oldImages = [];
        if (locationIds.length > 0) {
            const { data, error } = await supabase
                .from("location_images")
                .select("location_id, object_path")
                .in("location_id", locationIds);
            if (error) throwDatabaseError("location_images — kontrola przed przywróceniem", error);
            oldImages = data || [];
        }

        const newlyUploaded = [];
        try {
            for (const file of files) {
                const bytes = base64ToBytes(file.data_base64);
                const blob = new Blob([bytes], { type: "image/webp" });
                const { error: uploadError } = await supabase.storage
                    .from(IMAGE_BUCKET)
                    .upload(file.object_path, blob, {
                        cacheControl: "31536000",
                        contentType: "image/webp",
                        upsert: false
                    });

                if (!uploadError) {
                    newlyUploaded.push(file.object_path);
                    continue;
                }

                // Immutable image paths are reused when restoring the same snapshot.
                // A collision is accepted only if the existing bytes are identical.
                const { data: existingBlob, error: existingError } = await supabase.storage
                    .from(IMAGE_BUCKET)
                    .download(file.object_path);
                if (existingError) throwDatabaseError("Storage — przywracanie zdjęcia", uploadError);
                const existingBytes = new Uint8Array(await existingBlob.arrayBuffer());
                if (!bytesEqual(existingBytes, bytes)) {
                    throw new Error(`Plik „${file.object_path}” już istnieje, ale ma inną zawartość. Przywracanie zostało zatrzymane.`);
                }
            }

            const { data, error } = await supabase.rpc("admin_restore_organization_backup", {
                p_backup: sanitized
            });
            if (error) throwDatabaseError("admin_restore_organization_backup", error);
            if (!data || data.restore_mode !== "merge") {
                throw new Error("Supabase nie potwierdził prawidłowego przywrócenia kopii.");
            }

            const obsoletePaths = [...new Set(oldImages
                .filter(image => !backupPaths.has(image.object_path))
                .map(image => image.object_path))];
            let orphanedStorageFiles = 0;
            if (obsoletePaths.length > 0) {
                const { error: cleanupError } = await supabase.storage.from(IMAGE_BUCKET).remove(obsoletePaths);
                if (cleanupError) {
                    orphanedStorageFiles = obsoletePaths.length;
                    console.warn("SA Event Maps: Dane zostały przywrócone, ale nie udało się usunąć wszystkich zastąpionych plików Storage.", cleanupError);
                }
            }

            return { ...data, orphaned_storage_files: orphanedStorageFiles };
        } catch (error) {
            if (newlyUploaded.length > 0) {
                const { error: cleanupError } = await supabase.storage.from(IMAGE_BUCKET).remove(newlyUploaded);
                if (cleanupError) {
                    console.error("SA Event Maps: Nie udało się usunąć plików przesłanych podczas nieudanego przywracania.", cleanupError);
                }
            }
            throw error;
        }
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

    function mapCatalogProgress(row) {
        return {
            userId: row.user_id,
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
            progressRows,
            catalogProgressRows
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
            ),
            fetchAllRows(
                "player_catalog_progress",
                "user_id, location_id, status, needs_check, created_at, updated_at",
                query => query.eq("user_id", user.id).order("updated_at", { ascending: false })
            )
        ]);

        const catalog = {
            user,
            locations: locationRows.map(mapLocation),
            events: eventRows.map(mapEvent),
            eventLocations: eventLocationRows.map(mapEventLocation),
            categories: categoryRows.map(mapCategory),
            playerProgress: progressRows.map(mapProgress),
            playerCatalogProgress: catalogProgressRows.map(mapCatalogProgress)
        };

        console.info("SA Event Maps: Pobrano dane z Supabase.", {
            locations: catalog.locations.length,
            events: catalog.events.length,
            assignments: catalog.eventLocations.length,
            categories: catalog.categories.length,
            playerProgress: catalog.playerProgress.length,
            playerCatalogProgress: catalog.playerCatalogProgress.length
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

    async function setCatalogProgress(locationId, status, needsCheck) {
        const user = await getUserContext();

        if (!locationId) throw new Error("Brakuje identyfikatora znajdźki.");
        if (!VALID_PROGRESS_STATUSES.has(status)) {
            throw new Error("Nieprawidłowy status znajdźki.");
        }

        const now = new Date().toISOString();
        const row = {
            user_id: user.id,
            location_id: locationId,
            status,
            needs_check: Boolean(needsCheck),
            updated_at: now
        };

        const { data, error } = await supabase
            .from("player_catalog_progress")
            .upsert(row, { onConflict: "user_id,location_id" })
            .select("user_id, location_id, status, needs_check, created_at, updated_at")
            .single();

        if (error) throwDatabaseError("player_catalog_progress", error);
        return mapCatalogProgress(data);
    }

    async function clearCatalogProgress() {
        const user = await getUserContext();
        const { data, error, count } = await supabase
            .from("player_catalog_progress")
            .delete({ count: "exact" })
            .eq("user_id", user.id)
            .select("location_id");

        if (error) throwDatabaseError("player_catalog_progress", error);
        return { deletedCount: Number.isInteger(count) ? count : (data || []).length };
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
        getImageUploadSettings,
        setPlayerImageUploadsEnabled,
        prepareLocationImage: compressLocationImage,
        uploadLocationImage,
        getLocationImage,
        archiveLocationImage,
        restoreLocationImage,
        deleteLocationImage,
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
        setCatalogProgress,
        clearCatalogProgress,
        listCategories,
        createCategory,
        updateCategory,
        archiveCategory,
        restoreCategory,
        deleteCategory
    });

    console.info("SA Event Maps: Warstwa komunikacji z Supabase została uruchomiona.");
})();
