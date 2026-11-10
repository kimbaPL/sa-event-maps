-- SA Event Maps: administrator-only organization backup and safe merge restore.
-- The backup includes events, global locations, event assignments, categories,
-- every player's progress, account/profile metadata, and activity history.
-- Auth credentials, sessions, roles on restore, and Storage objects are excluded.

BEGIN;

-- During an authenticated restore RPC, preserve the exact archive and updated_at
-- metadata contained in the backup instead of letting normal UI triggers rewrite it.
CREATE OR REPLACE FUNCTION private.set_event_archive_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'archived' THEN
            NEW.status_before_archive := COALESCE(NEW.status_before_archive, 'draft');
            NEW.archived_at := pg_catalog.now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.status_before_archive := NULL;
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status <> 'archived' AND NEW.status = 'archived' THEN
        NEW.status_before_archive := OLD.status;
        NEW.archived_at := pg_catalog.now();
        NEW.archived_by := (SELECT auth.uid());
    ELSIF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
        NEW.status := COALESCE(OLD.status_before_archive, NEW.status);
        NEW.status_before_archive := NULL;
        NEW.archived_at := NULL;
        NEW.archived_by := NULL;
    ELSE
        NEW.status_before_archive := OLD.status_before_archive;
        NEW.archived_at := OLD.archived_at;
        NEW.archived_by := OLD.archived_by;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_location_archive_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_archived THEN
            NEW.archived_at := pg_catalog.now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
        IF NEW.is_archived THEN
            NEW.archived_at := pg_catalog.now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;
    ELSE
        NEW.archived_at := OLD.archived_at;
        NEW.archived_by := OLD.archived_by;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_categories_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_event_location_category_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.category_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.categories AS category_row
             WHERE category_row.id = NEW.category_id
               AND category_row.is_archived = false
        ) THEN
            RAISE EXCEPTION 'Nie można przypisać kategorii, która nie istnieje lub jest zarchiwizowana.'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.category_id IS DISTINCT FROM OLD.category_id
           AND NEW.category_id IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM public.categories AS category_row
                 WHERE category_row.id = NEW.category_id
                   AND category_row.is_archived = false
           ) THEN
            RAISE EXCEPTION 'Nie można przypisać kategorii, która nie istnieje lub jest zarchiwizowana.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- Build a private mapping from account IDs in the backup to accounts that
-- currently exist in this Supabase project. Stable IDs are preferred; email
-- is used only when an account was recreated with a new Auth UUID.
CREATE OR REPLACE FUNCTION private.organization_backup_user_map(p_accounts jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'source_id', mapped.source_id,
                'target_id', mapped.target_id,
                'match_method', mapped.match_method,
                'email', mapped.email,
                'display_name', mapped.display_name
            ) ORDER BY mapped.source_id
        ),
        '[]'::jsonb
    )
    FROM (
        SELECT
            backup_account.source_id,
            current_account.id AS target_id,
            current_account.match_method,
            backup_account.email,
            backup_account.display_name
        FROM (
            SELECT
                (account_row.value ->> 'user_id')::uuid AS source_id,
                NULLIF(pg_catalog.lower(pg_catalog.btrim(account_row.value ->> 'email')), '') AS email,
                COALESCE(account_row.value ->> 'display_name', 'Gracz') AS display_name
            FROM pg_catalog.jsonb_array_elements(COALESCE(p_accounts, '[]'::jsonb)) AS account_row(value)
        ) AS backup_account
        JOIN LATERAL (
            SELECT
                auth_user.id,
                CASE WHEN auth_user.id = backup_account.source_id THEN 'user_id' ELSE 'email' END AS match_method
            FROM auth.users AS auth_user
            JOIN public.profiles AS profile_row
              ON profile_row.id = auth_user.id
            WHERE auth_user.id = backup_account.source_id
               OR (
                    backup_account.email IS NOT NULL
                    AND pg_catalog.lower(auth_user.email) = backup_account.email
               )
            ORDER BY (auth_user.id = backup_account.source_id) DESC
            LIMIT 1
        ) AS current_account ON true
    ) AS mapped;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_user_map(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.organization_backup_map_user_id(
    p_source_user_id uuid,
    p_user_map jsonb
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
    SELECT (map_row.value ->> 'target_id')::uuid
    FROM pg_catalog.jsonb_array_elements(COALESCE(p_user_map, '[]'::jsonb)) AS map_row(value)
    WHERE map_row.value ->> 'source_id' = p_source_user_id::text
    LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_map_user_id(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.organization_backup_validate(p_backup jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    v_collection text;
BEGIN
    IF p_backup IS NULL
       OR p_backup ->> 'schema' IS DISTINCT FROM 'sa-event-maps-organization-backup'
       OR p_backup ->> 'version' IS DISTINCT FROM '1'
       OR pg_catalog.jsonb_typeof(p_backup -> 'data') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Plik nie jest obsługiwaną kopią organizacji SA Event Maps (format lub wersja).'
            USING ERRCODE = '22023';
    END IF;

    FOREACH v_collection IN ARRAY ARRAY[
        'accounts', 'events', 'locations', 'event_locations', 'categories', 'player_progress', 'activity_log'
    ] LOOP
        IF pg_catalog.jsonb_typeof(p_backup -> 'data' -> v_collection) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Kopia jest niekompletna: pole data.% musi być tablicą.', v_collection
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_backup -> 'data' -> 'accounts') AS account_row(value)
        WHERE COALESCE(account_row.value ->> 'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłowy identyfikator konta.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT account_row.value ->> 'user_id'
        FROM pg_catalog.jsonb_array_elements(p_backup -> 'data' -> 'accounts') AS account_row(value)
        GROUP BY account_row.value ->> 'user_id'
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera zduplikowane identyfikatory kont.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_backup -> 'data' -> 'activity_log') AS log_row(value)
        WHERE pg_catalog.jsonb_typeof(log_row.value -> 'id') IS DISTINCT FROM 'number'
           OR (log_row.value ->> 'id')::numeric < 1
           OR (log_row.value ->> 'id')::numeric > 9223372036854775807
           OR pg_catalog.trunc((log_row.value ->> 'id')::numeric) <> (log_row.value ->> 'id')::numeric
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłowe identyfikatory wpisów historii aktywności.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT (log_row.value ->> 'id')::numeric
        FROM pg_catalog.jsonb_array_elements(p_backup -> 'data' -> 'activity_log') AS log_row(value)
        GROUP BY (log_row.value ->> 'id')::numeric
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera powtórzone identyfikatory historii aktywności.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_backup -> 'data' -> 'activity_log') AS log_row(value)
        WHERE COALESCE(log_row.value ->> 'entity_type', '') NOT IN ('location', 'event', 'event_location')
           OR COALESCE(log_row.value ->> 'action', '') NOT IN ('created', 'updated', 'pinned', 'unpinned', 'archived', 'restored', 'linked_to_event', 'unlinked_from_event', 'deleted')
           OR COALESCE(log_row.value ->> 'entity_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR (
                NULLIF(log_row.value ->> 'actor_id', '') IS NOT NULL
                AND log_row.value ->> 'actor_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           )
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłowy wpis historii aktywności.'
            USING ERRCODE = '22023';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_validate(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.organization_backup_unmatched_progress_accounts(
    p_data jsonb,
    p_user_map jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
    WITH progress_users AS (
        SELECT
            (progress_row.value ->> 'user_id')::uuid AS source_user_id,
            pg_catalog.count(*)::integer AS progress_rows
        FROM pg_catalog.jsonb_array_elements(p_data -> 'player_progress') AS progress_row(value)
        GROUP BY (progress_row.value ->> 'user_id')::uuid
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'user_id', progress_users.source_user_id,
                'email', COALESCE(backup_account.value ->> 'email', ''),
                'display_name', COALESCE(backup_account.value ->> 'display_name', 'Nieznane konto'),
                'progress_rows', progress_users.progress_rows
            ) ORDER BY COALESCE(backup_account.value ->> 'email', ''), progress_users.source_user_id
        ),
        '[]'::jsonb
    )
    FROM progress_users
    LEFT JOIN LATERAL (
        SELECT account_row.value
        FROM pg_catalog.jsonb_array_elements(p_data -> 'accounts') AS account_row(value)
        WHERE account_row.value ->> 'user_id' = progress_users.source_user_id::text
        LIMIT 1
    ) AS backup_account ON true
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(COALESCE(p_user_map, '[]'::jsonb)) AS map_row(value)
        WHERE map_row.value ->> 'source_id' = progress_users.source_user_id::text
    );
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_unmatched_progress_accounts(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Export all organization data in one database snapshot. Email addresses are
-- included only for restoring progress if an account's Auth UUID changes.
CREATE OR REPLACE FUNCTION public.admin_export_organization_backup()
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

    SELECT pg_catalog.jsonb_build_object(
        'schema', 'sa-event-maps-organization-backup',
        'version', 1,
        'exported_at', pg_catalog.statement_timestamp(),
        'exported_by', auth.uid(),
        'data', pg_catalog.jsonb_build_object(
            'accounts', COALESCE((
                SELECT pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                        'user_id', profile_row.id,
                        'email', auth_user.email,
                        'display_name', profile_row.display_name,
                        'role', profile_row.role,
                        'is_owner', COALESCE(profile_row.is_owner, false),
                        'created_at', profile_row.created_at
                    ) ORDER BY auth_user.created_at, auth_user.id
                )
                FROM auth.users AS auth_user
                JOIN public.profiles AS profile_row ON profile_row.id = auth_user.id
            ), '[]'::jsonb),
            'events', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(event_row) ORDER BY event_row.created_at, event_row.id)
                FROM public.events AS event_row
            ), '[]'::jsonb),
            'locations', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(location_row) ORDER BY location_row.created_at, location_row.id)
                FROM public.locations AS location_row
            ), '[]'::jsonb),
            'event_locations', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(assignment_row) ORDER BY assignment_row.created_at, assignment_row.id)
                FROM public.event_locations AS assignment_row
            ), '[]'::jsonb),
            'categories', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(category_row) ORDER BY category_row.created_at, category_row.id)
                FROM public.categories AS category_row
            ), '[]'::jsonb),
            'player_progress', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(progress_row) ORDER BY progress_row.user_id, progress_row.event_id, progress_row.location_id)
                FROM public.player_progress AS progress_row
            ), '[]'::jsonb),
            'activity_log', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(log_row) ORDER BY log_row.id)
                FROM public.activity_log AS log_row
            ), '[]'::jsonb)
        ),
        'excluded', pg_catalog.jsonb_build_array(
            'hasła, tokeny, sesje i dane uwierzytelniające Supabase Auth',
            'rangi i oznaczenie właściciela nie są zmieniane podczas przywracania',
            'pliki Storage — galeria screenshotów nie jest jeszcze wdrożona'
        )
    ) INTO v_backup;

    RETURN v_backup;
END;
$function$;

COMMENT ON FUNCTION public.admin_export_organization_backup() IS
    'Exports organization data and every player progress row for administrators. Never exports passwords, tokens, or sessions.';
REVOKE ALL ON FUNCTION public.admin_export_organization_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_export_organization_backup() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_preview_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_user_map jsonb;
    v_unmatched jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Podgląd kopii jest dostępny wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate(p_backup);
    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');
    v_unmatched := private.organization_backup_unmatched_progress_accounts(v_data, v_user_map);

    RETURN pg_catalog.jsonb_build_object(
        'restore_mode', 'merge',
        'counts', pg_catalog.jsonb_build_object(
            'accounts', pg_catalog.jsonb_array_length(v_data -> 'accounts'),
            'events', pg_catalog.jsonb_array_length(v_data -> 'events'),
            'locations', pg_catalog.jsonb_array_length(v_data -> 'locations'),
            'event_locations', pg_catalog.jsonb_array_length(v_data -> 'event_locations'),
            'categories', pg_catalog.jsonb_array_length(v_data -> 'categories'),
            'player_progress', pg_catalog.jsonb_array_length(v_data -> 'player_progress'),
            'activity_log', pg_catalog.jsonb_array_length(v_data -> 'activity_log')
        ),
        'matched_accounts', pg_catalog.jsonb_array_length(v_user_map),
        'email_fallback_accounts', COALESCE((
            SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'user_id', map_row.value ->> 'source_id',
                    'matched_user_id', map_row.value ->> 'target_id',
                    'email', map_row.value ->> 'email',
                    'display_name', map_row.value ->> 'display_name'
                ) ORDER BY map_row.value ->> 'email'
            )
            FROM pg_catalog.jsonb_array_elements(v_user_map) AS map_row(value)
            WHERE map_row.value ->> 'match_method' = 'email'
        ), '[]'::jsonb),
        'unmatched_progress_accounts', v_unmatched,
        'can_restore', pg_catalog.jsonb_array_length(v_unmatched) = 0,
        'current_restore_policy', 'Scalanie: rekordy z kopii są dodawane lub aktualizowane. Rekordy obecne w bazie, ale nieobecne w kopii, nie są usuwane.'
    );
END;
$function$;

COMMENT ON FUNCTION public.admin_preview_organization_backup(jsonb) IS
    'Validates an organization backup and checks that all progress owners can be mapped to current Auth accounts.';
REVOKE ALL ON FUNCTION public.admin_preview_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_organization_backup(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_restore_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_user_map jsonb;
    v_unmatched jsonb;
    v_count_events integer;
    v_count_locations integer;
    v_count_assignments integer;
    v_count_categories integer;
    v_count_progress integer;
    v_count_profiles integer;
    v_count_activity_log integer;
    v_activity_sequence regclass;
    v_activity_sequence_last bigint;
    v_activity_backup_max bigint;
    v_activity_current_max bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Przywracanie kopii jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate(p_backup);
    PERFORM pg_catalog.pg_advisory_xact_lock(73481260412005::bigint);

    -- Prevent concurrent writes to data tables while the snapshot is merged.
    -- This also ensures no audit trigger advances activity_log between reading
    -- its identity sequence and setting it beyond the restored historical IDs.
    LOCK TABLE
        public.profiles,
        public.events,
        public.locations,
        public.categories,
        public.event_locations,
        public.player_progress,
        public.activity_log
    IN SHARE ROW EXCLUSIVE MODE;

    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');
    v_unmatched := private.organization_backup_unmatched_progress_accounts(v_data, v_user_map);

    IF pg_catalog.jsonb_array_length(v_unmatched) > 0 THEN
        RAISE EXCEPTION 'Nie można przywrócić kopii: % kont z zapisanym postępem nie ma obecnie dopasowanego konta. Utwórz lub przywróć te konta, a następnie ponów podgląd.',
            pg_catalog.jsonb_array_length(v_unmatched)
            USING ERRCODE = '23503', DETAIL = v_unmatched::text;
    END IF;

    -- Move the activity-log identity sequence past both the current and backed-up
    -- IDs before normal table upserts fire audit triggers. The sequence is never
    -- moved backwards; gaps after a rolled-back transaction are harmless.
    v_activity_sequence := pg_catalog.pg_get_serial_sequence('public.activity_log', 'id')::regclass;
    IF v_activity_sequence IS NULL THEN
        RAISE EXCEPTION 'Nie znaleziono sekwencji identyfikatorów dziennika activity_log.'
            USING ERRCODE = '55000';
    END IF;
    SELECT COALESCE(pg_catalog.max(log_row.id), 0)
      INTO v_activity_current_max
      FROM public.activity_log AS log_row;
    SELECT COALESCE(pg_catalog.max((log_row.value ->> 'id')::bigint), 0)
      INTO v_activity_backup_max
      FROM pg_catalog.jsonb_array_elements(v_data -> 'activity_log') AS log_row(value);
    v_activity_sequence_last := pg_catalog.pg_sequence_last_value(v_activity_sequence);
    IF GREATEST(v_activity_current_max, v_activity_backup_max, COALESCE(v_activity_sequence_last, 0)) > 0 THEN
        PERFORM pg_catalog.setval(
            v_activity_sequence,
            GREATEST(v_activity_current_max, v_activity_backup_max, COALESCE(v_activity_sequence_last, 0)),
            true
        );
    END IF;

    -- This transaction-local flag makes archival and updated_at triggers preserve
    -- the historical values in the backup. Normal application writes are unchanged.
    PERFORM pg_catalog.set_config('sa_event_maps.organization_backup_restore', 'on', true);

    UPDATE public.profiles AS profile_row
       SET display_name = COALESCE(NULLIF(pg_catalog.btrim(account_row.value ->> 'display_name'), ''), 'Gracz')
      FROM pg_catalog.jsonb_array_elements(v_data -> 'accounts') AS account_row(value)
      JOIN pg_catalog.jsonb_array_elements(v_user_map) AS map_row(value)
        ON map_row.value ->> 'source_id' = account_row.value ->> 'user_id'
     WHERE profile_row.id = (map_row.value ->> 'target_id')::uuid;
    GET DIAGNOSTICS v_count_profiles = ROW_COUNT;

    INSERT INTO public.events AS current_row (
        id, name, description, start_date, end_date,
        official_collectible_count, status, created_at, updated_at,
        archived_at, archived_by, status_before_archive, created_by
    )
    SELECT
        (source_row.value ->> 'id')::uuid,
        source_row.value ->> 'name',
        COALESCE(source_row.value ->> 'description', ''),
        NULLIF(source_row.value ->> 'start_date', '')::date,
        NULLIF(source_row.value ->> 'end_date', '')::date,
        NULLIF(source_row.value ->> 'official_collectible_count', '')::integer,
        source_row.value ->> 'status',
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
        COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now()),
        NULLIF(source_row.value ->> 'archived_at', '')::timestamptz,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'archived_by', '')::uuid, v_user_map),
        NULLIF(source_row.value ->> 'status_before_archive', ''),
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'created_by', '')::uuid, v_user_map)
    FROM pg_catalog.jsonb_array_elements(v_data -> 'events') AS source_row(value)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        official_collectible_count = EXCLUDED.official_collectible_count,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        archived_at = EXCLUDED.archived_at,
        archived_by = EXCLUDED.archived_by,
        status_before_archive = EXCLUDED.status_before_archive,
        created_by = EXCLUDED.created_by;
    GET DIAGNOSTICS v_count_events = ROW_COUNT;

    INSERT INTO public.locations AS current_row (
        id, name, area, game_x, game_y, game_z, description,
        is_pinned, is_archived, archived_at, archived_by,
        created_at, updated_at, created_by
    )
    SELECT
        (source_row.value ->> 'id')::uuid,
        source_row.value ->> 'name',
        COALESCE(source_row.value ->> 'area', 'Nie określono'),
        (source_row.value ->> 'game_x')::double precision,
        (source_row.value ->> 'game_y')::double precision,
        NULLIF(source_row.value ->> 'game_z', '')::double precision,
        COALESCE(source_row.value ->> 'description', ''),
        COALESCE((source_row.value ->> 'is_pinned')::boolean, false),
        COALESCE((source_row.value ->> 'is_archived')::boolean, false),
        NULLIF(source_row.value ->> 'archived_at', '')::timestamptz,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'archived_by', '')::uuid, v_user_map),
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
        COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now()),
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'created_by', '')::uuid, v_user_map)
    FROM pg_catalog.jsonb_array_elements(v_data -> 'locations') AS source_row(value)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        area = EXCLUDED.area,
        game_x = EXCLUDED.game_x,
        game_y = EXCLUDED.game_y,
        game_z = EXCLUDED.game_z,
        description = EXCLUDED.description,
        is_pinned = EXCLUDED.is_pinned,
        is_archived = EXCLUDED.is_archived,
        archived_at = EXCLUDED.archived_at,
        archived_by = EXCLUDED.archived_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        created_by = EXCLUDED.created_by;
    GET DIAGNOSTICS v_count_locations = ROW_COUNT;

    INSERT INTO public.categories AS current_row (
        id, name, description, color, icon, sort_order,
        is_archived, created_by, created_at, updated_at
    )
    SELECT
        (source_row.value ->> 'id')::uuid,
        source_row.value ->> 'name',
        COALESCE(source_row.value ->> 'description', ''),
        NULLIF(source_row.value ->> 'color', ''),
        NULLIF(source_row.value ->> 'icon', ''),
        COALESCE(NULLIF(source_row.value ->> 'sort_order', '')::integer, 0),
        COALESCE((source_row.value ->> 'is_archived')::boolean, false),
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'created_by', '')::uuid, v_user_map),
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
        COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now())
    FROM pg_catalog.jsonb_array_elements(v_data -> 'categories') AS source_row(value)
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        color = EXCLUDED.color,
        icon = EXCLUDED.icon,
        sort_order = EXCLUDED.sort_order,
        is_archived = EXCLUDED.is_archived,
        created_by = EXCLUDED.created_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
    GET DIAGNOSTICS v_count_categories = ROW_COUNT;

    INSERT INTO public.event_locations AS current_row (
        id, event_id, location_id, category_id, added_by, created_at
    )
    SELECT
        (source_row.value ->> 'id')::uuid,
        (source_row.value ->> 'event_id')::uuid,
        (source_row.value ->> 'location_id')::uuid,
        NULLIF(source_row.value ->> 'category_id', '')::uuid,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'added_by', '')::uuid, v_user_map),
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now())
    FROM pg_catalog.jsonb_array_elements(v_data -> 'event_locations') AS source_row(value)
    ON CONFLICT ON CONSTRAINT event_locations_unique DO UPDATE SET
        category_id = EXCLUDED.category_id,
        added_by = EXCLUDED.added_by,
        created_at = EXCLUDED.created_at;
    GET DIAGNOSTICS v_count_assignments = ROW_COUNT;

    INSERT INTO public.player_progress AS current_row (
        user_id, event_id, location_id, status, needs_check, created_at, updated_at
    )
    SELECT
        private.organization_backup_map_user_id((source_row.value ->> 'user_id')::uuid, v_user_map),
        (source_row.value ->> 'event_id')::uuid,
        (source_row.value ->> 'location_id')::uuid,
        source_row.value ->> 'status',
        COALESCE((source_row.value ->> 'needs_check')::boolean, false),
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
        COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now())
    FROM pg_catalog.jsonb_array_elements(v_data -> 'player_progress') AS source_row(value)
    ON CONFLICT (user_id, event_id, location_id) DO UPDATE SET
        status = EXCLUDED.status,
        needs_check = EXCLUDED.needs_check,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
    GET DIAGNOSTICS v_count_progress = ROW_COUNT;

    -- Restore the historical activity log after data upserts have completed.
    -- Their audit-trigger entries received fresh IDs above the backup's max ID.
    INSERT INTO public.activity_log AS current_row (
        id, actor_id, entity_type, entity_id, action, old_data, new_data, created_at
    ) OVERRIDING SYSTEM VALUE
    SELECT
        (source_row.value ->> 'id')::bigint,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'actor_id', '')::uuid, v_user_map),
        source_row.value ->> 'entity_type',
        (source_row.value ->> 'entity_id')::uuid,
        source_row.value ->> 'action',
        CASE WHEN source_row.value -> 'old_data' IS NULL OR pg_catalog.jsonb_typeof(source_row.value -> 'old_data') = 'null' THEN NULL ELSE source_row.value -> 'old_data' END,
        CASE WHEN source_row.value -> 'new_data' IS NULL OR pg_catalog.jsonb_typeof(source_row.value -> 'new_data') = 'null' THEN NULL ELSE source_row.value -> 'new_data' END,
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now())
    FROM pg_catalog.jsonb_array_elements(v_data -> 'activity_log') AS source_row(value)
    ON CONFLICT (id) DO UPDATE SET
        actor_id = EXCLUDED.actor_id,
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        action = EXCLUDED.action,
        old_data = EXCLUDED.old_data,
        new_data = EXCLUDED.new_data,
        created_at = EXCLUDED.created_at;
    GET DIAGNOSTICS v_count_activity_log = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'restore_mode', 'merge',
        'profiles_updated', v_count_profiles,
        'events_processed', v_count_events,
        'locations_processed', v_count_locations,
        'assignments_processed', v_count_assignments,
        'categories_processed', v_count_categories,
        'progress_rows_processed', v_count_progress,
        'activity_log_rows_processed', v_count_activity_log,
        'preserved_roles_and_owner', true,
        'deleted_current_only_records', 0
    );
END;
$function$;

COMMENT ON FUNCTION public.admin_restore_organization_backup(jsonb) IS
    'Atomically merges a validated organization backup including activity history. Maps account references by Auth UUID or email, preserves current roles/owner, and never deletes records absent from the backup.';
REVOKE ALL ON FUNCTION public.admin_restore_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_organization_backup(jsonb) TO authenticated;

COMMIT;
