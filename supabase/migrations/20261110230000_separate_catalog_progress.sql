BEGIN;

-- Personal status in the global "Wszystkie respy" catalog is deliberately
-- independent from event-specific player_progress rows.
CREATE TABLE public.player_catalog_progress (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'not_found'
        CHECK (status IN ('not_found', 'found', 'not_present', 'uncertain')),
    needs_check boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT player_catalog_progress_pkey PRIMARY KEY (user_id, location_id)
);

CREATE INDEX player_catalog_progress_location_id_idx
    ON public.player_catalog_progress (location_id);

CREATE INDEX player_catalog_progress_user_updated_idx
    ON public.player_catalog_progress (user_id, updated_at DESC);

ALTER TABLE public.player_catalog_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.player_catalog_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.player_catalog_progress TO authenticated;

CREATE POLICY player_catalog_progress_select_own
    ON public.player_catalog_progress
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY player_catalog_progress_insert_own_active_location
    ON public.player_catalog_progress
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.locations AS location_row
            WHERE location_row.id = player_catalog_progress.location_id
              AND location_row.is_archived = false
        )
    );

CREATE POLICY player_catalog_progress_update_own_active_location
    ON public.player_catalog_progress
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.locations AS location_row
            WHERE location_row.id = player_catalog_progress.location_id
              AND location_row.is_archived = false
        )
    );

CREATE POLICY player_catalog_progress_delete_own
    ON public.player_catalog_progress
    FOR DELETE TO authenticated
    USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.player_catalog_progress IS
    'Each player’s personal status in the global collectible catalog. Independent from event-specific player_progress.';

-- Add the table to organization backups without changing the long-standing
-- backup payload shape for installations and snapshots created before this migration.
ALTER FUNCTION public.admin_export_organization_backup()
    RENAME TO admin_export_organization_backup_without_catalog_progress;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup_without_catalog_progress()
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

    v_backup := public.admin_export_organization_backup_without_catalog_progress();

    RETURN pg_catalog.jsonb_set(
        v_backup,
        '{data,player_catalog_progress}',
        COALESCE((
            SELECT pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(progress_row)
                ORDER BY progress_row.user_id, progress_row.location_id
            )
            FROM public.player_catalog_progress AS progress_row
        ), '[]'::jsonb),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_export_organization_backup() TO authenticated;

CREATE OR REPLACE FUNCTION private.organization_backup_validate_catalog_progress(p_backup jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
BEGIN
    PERFORM private.organization_backup_validate(p_backup);
    v_data := p_backup -> 'data';

    IF v_data ? 'player_catalog_progress'
       AND pg_catalog.jsonb_typeof(v_data -> 'player_catalog_progress') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłową listę postępów katalogowych.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
            COALESCE(v_data -> 'player_catalog_progress', '[]'::jsonb)
        ) AS source_row(value)
        WHERE COALESCE(source_row.value ->> 'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR COALESCE(source_row.value ->> 'location_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR COALESCE(source_row.value ->> 'status', '') NOT IN ('not_found', 'found', 'not_present', 'uncertain')
           OR (
                source_row.value ? 'needs_check'
                AND pg_catalog.jsonb_typeof(source_row.value -> 'needs_check') IS DISTINCT FROM 'boolean'
           )
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera postęp katalogowy z nieprawidłowymi danymi.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT source_row.value ->> 'user_id', source_row.value ->> 'location_id'
        FROM pg_catalog.jsonb_array_elements(
            COALESCE(v_data -> 'player_catalog_progress', '[]'::jsonb)
        ) AS source_row(value)
        GROUP BY source_row.value ->> 'user_id', source_row.value ->> 'location_id'
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera powtórzone statusy katalogowe dla tego samego użytkownika i znajdźki.'
            USING ERRCODE = '22023';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_validate_catalog_progress(jsonb)
    FROM PUBLIC, anon, authenticated;

-- Extend the existing backup preview so account matching also covers users
-- who have catalog progress but no event-specific progress rows.
ALTER FUNCTION public.admin_preview_organization_backup(jsonb)
    RENAME TO admin_preview_organization_backup_without_catalog_progress;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup_without_catalog_progress(jsonb)
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
    v_check_data jsonb;
    v_unmatched jsonb;
    v_result jsonb;
    v_catalog_progress_count integer;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Podgląd kopii jest dostępny wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_catalog_progress(p_backup);
    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');
    v_catalog_progress_count := pg_catalog.jsonb_array_length(
        COALESCE(v_data -> 'player_catalog_progress', '[]'::jsonb)
    );

    v_check_data := pg_catalog.jsonb_set(
        v_data,
        '{player_progress}',
        COALESCE(v_data -> 'player_progress', '[]'::jsonb) || COALESCE((
            SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('user_id', catalog_row.value ->> 'user_id')
            )
            FROM pg_catalog.jsonb_array_elements(
                COALESCE(v_data -> 'player_catalog_progress', '[]'::jsonb)
            ) AS catalog_row(value)
        ), '[]'::jsonb),
        true
    );

    v_unmatched := private.organization_backup_unmatched_progress_accounts(v_check_data, v_user_map);
    v_result := public.admin_preview_organization_backup_without_catalog_progress(p_backup);

    v_result := pg_catalog.jsonb_set(
        v_result,
        '{counts,player_catalog_progress}',
        pg_catalog.to_jsonb(v_catalog_progress_count),
        true
    );
    v_result := pg_catalog.jsonb_set(
        v_result,
        '{unmatched_progress_accounts}',
        v_unmatched,
        true
    );
    v_result := pg_catalog.jsonb_set(
        v_result,
        '{can_restore}',
        pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_unmatched) = 0),
        true
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_organization_backup(jsonb) TO authenticated;

-- Wrap the existing restore function. PostgreSQL executes both function calls
-- in the same transaction, so a failure while restoring catalog statuses also
-- rolls back the main organization restore.
ALTER FUNCTION public.admin_restore_organization_backup(jsonb)
    RENAME TO admin_restore_organization_backup_without_catalog_progress;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup_without_catalog_progress(jsonb)
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
    v_result jsonb;
    v_catalog_progress_count integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Przywracanie kopii jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_catalog_progress(p_backup);
    v_data := p_backup -> 'data';

    IF v_data ? 'player_catalog_progress' THEN
        v_user_map := private.organization_backup_user_map(v_data -> 'accounts');

        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(v_data -> 'player_catalog_progress') AS source_row(value)
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_array_elements(v_user_map) AS map_row(value)
                WHERE map_row.value ->> 'source_id' = source_row.value ->> 'user_id'
                  AND NULLIF(map_row.value ->> 'target_id', '') IS NOT NULL
            )
        ) THEN
            RAISE EXCEPTION 'Nie można przywrócić postępów katalogowych: co najmniej jedno konto nie ma dopasowanego użytkownika.'
                USING ERRCODE = '23503';
        END IF;
    END IF;

    LOCK TABLE public.player_catalog_progress IN SHARE ROW EXCLUSIVE MODE;

    v_result := public.admin_restore_organization_backup_without_catalog_progress(p_backup);

    IF v_data ? 'player_catalog_progress' THEN
        INSERT INTO public.player_catalog_progress AS current_row (
            user_id, location_id, status, needs_check, created_at, updated_at
        )
        SELECT
            private.organization_backup_map_user_id((source_row.value ->> 'user_id')::uuid, v_user_map),
            (source_row.value ->> 'location_id')::uuid,
            source_row.value ->> 'status',
            COALESCE((source_row.value ->> 'needs_check')::boolean, false),
            COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
            COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now())
        FROM pg_catalog.jsonb_array_elements(v_data -> 'player_catalog_progress') AS source_row(value)
        ON CONFLICT (user_id, location_id) DO UPDATE SET
            status = EXCLUDED.status,
            needs_check = EXCLUDED.needs_check,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at;

        GET DIAGNOSTICS v_catalog_progress_count = ROW_COUNT;
    END IF;

    RETURN v_result || pg_catalog.jsonb_build_object(
        'catalog_progress_rows_processed', v_catalog_progress_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_organization_backup(jsonb) TO authenticated;

COMMIT;
