BEGIN;

-- Complete the organization snapshot with the global upload setting and ensure
-- all creator/owner references can be resolved before a restore is allowed.
-- Older snapshots remain valid: missing optional keys do not overwrite current
-- settings or location deletion-request metadata.

CREATE OR REPLACE FUNCTION private.organization_backup_validate_complete_snapshot(p_backup jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_setting jsonb;
    v_location jsonb;
    v_timestamp timestamptz;
BEGIN
    PERFORM private.organization_backup_validate_help_documents(p_backup);
    v_data := p_backup -> 'data';

    IF v_data ? 'app_settings' THEN
        IF pg_catalog.jsonb_typeof(v_data -> 'app_settings') IS DISTINCT FROM 'array'
           OR pg_catalog.jsonb_array_length(v_data -> 'app_settings') <> 1 THEN
            RAISE EXCEPTION 'Kopia zawiera nieprawidłową sekcję ustawień globalnych.'
                USING ERRCODE = '22023';
        END IF;

        SELECT value INTO v_setting
        FROM pg_catalog.jsonb_array_elements(v_data -> 'app_settings') AS setting_row(value);

        IF COALESCE(v_setting ->> 'id', '') <> '1'
           OR pg_catalog.jsonb_typeof(v_setting -> 'allow_player_image_uploads') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'Kopia zawiera nieprawidłowe ustawienie możliwości wysyłania zdjęć.'
                USING ERRCODE = '22023';
        END IF;

        IF NULLIF(v_setting ->> 'updated_by', '') IS NOT NULL
           AND (v_setting ->> 'updated_by') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Kopia zawiera nieprawidłowego autora ustawień globalnych.'
                USING ERRCODE = '22023';
        END IF;

        IF NULLIF(v_setting ->> 'updated_at', '') IS NOT NULL THEN
            BEGIN
                v_timestamp := (v_setting ->> 'updated_at')::timestamptz;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Kopia zawiera nieprawidłową datę zmiany ustawień globalnych.'
                    USING ERRCODE = '22023';
            END;
        END IF;
    END IF;

    -- The current schema keeps deletion requests on the location row. The
    -- historical restore function predates these two columns, so the wrapper
    -- below restores them explicitly when present in a newer snapshot.
    FOR v_location IN
        SELECT value
        FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS location_row(value)
        WHERE value ? 'deletion_requested_at'
           OR value ? 'deletion_requested_by'
    LOOP
        IF NULLIF(v_location ->> 'deletion_requested_by', '') IS NOT NULL
           AND (v_location ->> 'deletion_requested_by') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'Kopia zawiera nieprawidłowe konto zgłaszające usunięcie znajdźki.'
                USING ERRCODE = '22023';
        END IF;

        IF NULLIF(v_location ->> 'deletion_requested_at', '') IS NOT NULL THEN
            BEGIN
                v_timestamp := (v_location ->> 'deletion_requested_at')::timestamptz;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Kopia zawiera nieprawidłową datę zgłoszenia usunięcia znajdźki.'
                    USING ERRCODE = '22023';
            END;
        END IF;
    END LOOP;

    -- Validate every optional profile reference used for ownership, authorship,
    -- archival history, image uploads, settings, and the activity log.
    IF EXISTS (
        WITH refs AS (
            SELECT value ->> 'created_by' AS user_id FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS r(value)
            UNION ALL SELECT value ->> 'archived_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS r(value)
            UNION ALL SELECT value ->> 'deletion_requested_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS r(value)
            UNION ALL SELECT value ->> 'created_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'events') AS r(value)
            UNION ALL SELECT value ->> 'archived_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'events') AS r(value)
            UNION ALL SELECT value ->> 'created_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'categories') AS r(value)
            UNION ALL SELECT value ->> 'added_by' FROM pg_catalog.jsonb_array_elements(v_data -> 'event_locations') AS r(value)
            UNION ALL SELECT value ->> 'uploaded_by' FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS r(value)
            UNION ALL SELECT value ->> 'archived_by' FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS r(value)
            UNION ALL SELECT value ->> 'created_by' FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'help_document_sections', '[]'::jsonb)) AS r(value)
            UNION ALL SELECT value ->> 'updated_by' FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'help_document_sections', '[]'::jsonb)) AS r(value)
            UNION ALL SELECT value ->> 'updated_by' FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'app_settings', '[]'::jsonb)) AS r(value)
            UNION ALL SELECT value ->> 'actor_id' FROM pg_catalog.jsonb_array_elements(v_data -> 'activity_log') AS r(value)
        )
        SELECT 1 FROM refs
        WHERE NULLIF(user_id, '') IS NOT NULL
          AND user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłowe powiązanie z profilem użytkownika.'
            USING ERRCODE = '22023';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_validate_complete_snapshot(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.organization_backup_unmatched_profile_references(
    p_data jsonb,
    p_user_map jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
    WITH refs AS (
        SELECT NULLIF(value ->> 'created_by', '') AS user_id, 'właściciel znajdźki'::text AS reference_type
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'locations', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'archived_by', ''), 'archiwizacja znajdźki'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'locations', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'deletion_requested_by', ''), 'zgłoszenie usunięcia znajdźki'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'locations', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'created_by', ''), 'autor wydarzenia'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'events', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'archived_by', ''), 'archiwizacja wydarzenia'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'events', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'created_by', ''), 'autor kategorii'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'categories', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'added_by', ''), 'przypisanie znajdźki do wydarzenia'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'event_locations', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'uploaded_by', ''), 'autor zdjęcia znajdźki'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'location_images', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'archived_by', ''), 'archiwizacja zdjęcia'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'location_images', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'created_by', ''), 'autor rozdziału instrukcji lub regulaminu'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'help_document_sections', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'updated_by', ''), 'ostatni redaktor rozdziału instrukcji lub regulaminu'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'help_document_sections', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'updated_by', ''), 'autor zmiany ustawień globalnych'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'app_settings', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'actor_id', ''), 'wpis historii aktywności'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'activity_log', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'user_id', ''), 'postęp w wydarzeniu'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'player_progress', '[]'::jsonb)) AS r(value)
        UNION ALL
        SELECT NULLIF(value ->> 'user_id', ''), 'postęp w katalogu Wszystkie respy'
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'player_catalog_progress', '[]'::jsonb)) AS r(value)
    ),
    grouped AS (
        SELECT user_id,
               pg_catalog.count(*)::integer AS reference_count,
               pg_catalog.array_agg(DISTINCT reference_type ORDER BY reference_type) AS reference_types
        FROM refs
        WHERE user_id IS NOT NULL
        GROUP BY user_id
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'user_id', grouped.user_id,
                'email', COALESCE(account_row.value ->> 'email', ''),
                'display_name', COALESCE(account_row.value ->> 'display_name', 'Nieznane konto'),
                'reference_count', grouped.reference_count,
                'reference_types', pg_catalog.to_jsonb(grouped.reference_types)
            ) ORDER BY COALESCE(account_row.value ->> 'display_name', ''), grouped.user_id
        ),
        '[]'::jsonb
    )
    FROM grouped
    LEFT JOIN LATERAL (
        SELECT value
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_data -> 'accounts', '[]'::jsonb)) AS a(value)
        WHERE value ->> 'user_id' = grouped.user_id
        LIMIT 1
    ) AS account_row ON true
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_user_map, '[]'::jsonb)) AS m(value)
        WHERE m.value ->> 'source_id' = grouped.user_id
          AND NULLIF(m.value ->> 'target_id', '') IS NOT NULL
    );
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_unmatched_profile_references(jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;

-- Extend export: profile display names and location creator IDs were already
-- included in accounts/locations. Add the only missing persisted global setting.
ALTER FUNCTION public.admin_export_organization_backup()
    RENAME TO admin_export_organization_backup_before_complete_snapshot;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup_before_complete_snapshot()
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_export_organization_backup()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_backup jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Pełna kopia organizacji jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    v_backup := public.admin_export_organization_backup_before_complete_snapshot();

    RETURN pg_catalog.jsonb_set(
        v_backup,
        '{data,app_settings}',
        COALESCE((
            SELECT pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(settings_row)
                ORDER BY settings_row.id
            )
            FROM public.app_settings AS settings_row
        ), '[{"id":1,"allow_player_image_uploads":true,"updated_at":null,"updated_by":null}]'::jsonb),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_export_organization_backup() TO authenticated;

-- Extend preview with explicit counts and missing-account checks for every
-- profile reference. This prevents losing the creator attribution on restore.
ALTER FUNCTION public.admin_preview_organization_backup(jsonb)
    RENAME TO admin_preview_organization_backup_before_complete_snapshot;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup_before_complete_snapshot(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_preview_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_user_map jsonb;
    v_unmatched_refs jsonb;
    v_result jsonb;
    v_owner_count integer := 0;
    v_settings_count integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Podgląd kopii jest dostępny wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_complete_snapshot(p_backup);
    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');
    v_unmatched_refs := private.organization_backup_unmatched_profile_references(v_data, v_user_map);

    SELECT pg_catalog.count(*)::integer
      INTO v_owner_count
      FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS location_row(value)
     WHERE NULLIF(location_row.value ->> 'created_by', '') IS NOT NULL;

    IF v_data ? 'app_settings' THEN
        v_settings_count := pg_catalog.jsonb_array_length(v_data -> 'app_settings');
    END IF;

    v_result := public.admin_preview_organization_backup_before_complete_snapshot(p_backup);
    v_result := pg_catalog.jsonb_set(v_result, '{counts,app_settings}', pg_catalog.to_jsonb(v_settings_count), true);
    v_result := pg_catalog.jsonb_set(v_result, '{counts,location_owners}', pg_catalog.to_jsonb(v_owner_count), true);
    v_result := pg_catalog.jsonb_set(v_result, '{unmatched_profile_references}', v_unmatched_refs, true);
    v_result := pg_catalog.jsonb_set(
        v_result,
        '{can_restore}',
        pg_catalog.to_jsonb(
            COALESCE((v_result ->> 'can_restore')::boolean, false)
            AND pg_catalog.jsonb_array_length(v_unmatched_refs) = 0
        ),
        true
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_organization_backup(jsonb) TO authenticated;

-- Extend restore atomically. Preserve current security roles/owner, but restore
-- profile names, owner attribution, global upload settings and legacy location
-- deletion-request fields. Old backups without app_settings remain compatible.
ALTER FUNCTION public.admin_restore_organization_backup(jsonb)
    RENAME TO admin_restore_organization_backup_before_complete_snapshot;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup_before_complete_snapshot(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_restore_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_user_map jsonb;
    v_unmatched_refs jsonb;
    v_result jsonb;
    v_setting jsonb;
    v_settings_processed integer := 0;
    v_owner_count integer := 0;
    v_deletion_requests_count integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Przywracanie kopii jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_complete_snapshot(p_backup);
    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');
    v_unmatched_refs := private.organization_backup_unmatched_profile_references(v_data, v_user_map);

    IF pg_catalog.jsonb_array_length(v_unmatched_refs) > 0 THEN
        RAISE EXCEPTION 'Nie można przywrócić kopii: część kont powiązanych z właścicielami znajdziek, postępami lub historią nie ma dopasowanego konta. Przywróć lub utwórz brakujące konta, a następnie ponów podgląd.'
            USING ERRCODE = '23503', DETAIL = v_unmatched_refs::text;
    END IF;

    LOCK TABLE public.app_settings, public.locations IN SHARE ROW EXCLUSIVE MODE;

    v_result := public.admin_restore_organization_backup_before_complete_snapshot(p_backup);

    -- Restore request timestamps/actors added to locations after the original
    -- restore routine was introduced. Missing keys in old snapshots are left
    -- untouched for merge/backward compatibility.
    UPDATE public.locations AS current_row
       SET deletion_requested_at = CASE
               WHEN source_row.value ? 'deletion_requested_at'
               THEN NULLIF(source_row.value ->> 'deletion_requested_at', '')::timestamptz
               ELSE current_row.deletion_requested_at
           END,
           deletion_requested_by = CASE
               WHEN source_row.value ? 'deletion_requested_by'
               THEN private.organization_backup_map_user_id(
                   NULLIF(source_row.value ->> 'deletion_requested_by', '')::uuid,
                   v_user_map
               )
               ELSE current_row.deletion_requested_by
           END
      FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS source_row(value)
     WHERE current_row.id = (source_row.value ->> 'id')::uuid
       AND (source_row.value ? 'deletion_requested_at' OR source_row.value ? 'deletion_requested_by');
    GET DIAGNOSTICS v_deletion_requests_count = ROW_COUNT;

    IF v_data ? 'app_settings' THEN
        SELECT value INTO v_setting
        FROM pg_catalog.jsonb_array_elements(v_data -> 'app_settings') AS setting_row(value);

        INSERT INTO public.app_settings AS current_row (
            id, allow_player_image_uploads, updated_at, updated_by
        ) VALUES (
            1,
            (v_setting ->> 'allow_player_image_uploads')::boolean,
            COALESCE(NULLIF(v_setting ->> 'updated_at', '')::timestamptz, pg_catalog.now()),
            private.organization_backup_map_user_id(NULLIF(v_setting ->> 'updated_by', '')::uuid, v_user_map)
        )
        ON CONFLICT (id) DO UPDATE SET
            allow_player_image_uploads = EXCLUDED.allow_player_image_uploads,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by;

        GET DIAGNOSTICS v_settings_processed = ROW_COUNT;
    END IF;

    SELECT pg_catalog.count(*)::integer
      INTO v_owner_count
      FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS location_row(value)
     WHERE NULLIF(location_row.value ->> 'created_by', '') IS NOT NULL;

    RETURN v_result || pg_catalog.jsonb_build_object(
        'app_settings_processed', v_settings_processed,
        'location_owners_processed', v_owner_count,
        'location_deletion_requests_processed', v_deletion_requests_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_organization_backup(jsonb) TO authenticated;

COMMIT;
