-- SA Event Maps: one optional screenshot per location, optimized in the browser.
-- Private Storage bucket, authenticated reads, admin-only archive/delete, player upload lock.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    allow_player_image_uploads boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.app_settings (id, allow_player_image_uploads)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.location_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT,
    object_path text NOT NULL UNIQUE,
    original_name text NOT NULL DEFAULT '',
    mime_type text NOT NULL DEFAULT 'image/webp' CHECK (mime_type = 'image/webp'),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 500000),
    image_width integer NOT NULL CHECK (image_width BETWEEN 1 AND 5000),
    image_height integer NOT NULL CHECK (image_height BETWEEN 1 AND 5000),
    uploaded_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_archived boolean NOT NULL DEFAULT false,
    archived_at timestamptz NULL,
    archived_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT location_images_object_path_format CHECK (
        object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
        AND pg_catalog.split_part(object_path, '/', 1) = location_id::text
    ),
    CONSTRAINT location_images_archive_metadata CHECK (
        (is_archived = true AND archived_at IS NOT NULL)
        OR (is_archived = false AND archived_at IS NULL AND archived_by IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS location_images_archived_idx
    ON public.location_images (is_archived, created_at DESC);

CREATE OR REPLACE FUNCTION private.set_location_image_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.is_archived := COALESCE(NEW.is_archived, false);
        IF NEW.is_archived THEN
            NEW.archived_at := COALESCE(NEW.archived_at, pg_catalog.now());
            NEW.archived_by := COALESCE(NEW.archived_by, auth.uid());
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;
        NEW.updated_at := pg_catalog.now();
        RETURN NEW;
    END IF;

    IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
        IF NEW.is_archived THEN
            NEW.archived_at := pg_catalog.now();
            NEW.archived_by := auth.uid();
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;
    ELSE
        NEW.archived_at := OLD.archived_at;
        NEW.archived_by := OLD.archived_by;
    END IF;

    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS location_images_metadata_trigger ON public.location_images;
CREATE TRIGGER location_images_metadata_trigger
BEFORE INSERT OR UPDATE ON public.location_images
FOR EACH ROW EXECUTE FUNCTION private.set_location_image_metadata();

CREATE OR REPLACE FUNCTION private.can_upload_location_image(p_location_id_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location_id uuid;
    v_allow_players boolean;
BEGIN
    IF auth.uid() IS NULL OR COALESCE(p_location_id_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;

    v_location_id := p_location_id_text::uuid;

    -- Administrators may upload during backup restoration even when the location
    -- is not yet restored or the player upload switch is disabled.
    IF private.is_admin() THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.location_images AS image_row
         WHERE image_row.location_id = v_location_id
    ) OR EXISTS (
        SELECT 1 FROM storage.objects AS object_row
         WHERE object_row.bucket_id = 'location-screenshots'
           AND pg_catalog.split_part(object_row.name, '/', 1) = v_location_id::text
    ) THEN
        RETURN false;
    END IF;

    SELECT settings_row.allow_player_image_uploads
      INTO v_allow_players
      FROM public.app_settings AS settings_row
     WHERE settings_row.id = 1;

    RETURN COALESCE(v_allow_players, true) AND EXISTS (
        SELECT 1 FROM public.locations AS location_row
         WHERE location_row.id = v_location_id
           AND location_row.created_by = auth.uid()
           AND location_row.is_pinned = false
           AND location_row.is_archived = false
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.can_upload_location_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_upload_location_image(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.owns_location_image_object(p_object_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM storage.objects AS object_row
             WHERE object_row.bucket_id = 'location-screenshots'
               AND object_row.name = p_object_path
               AND object_row.owner_id = auth.uid()::text
       );
$function$;

REVOKE ALL ON FUNCTION private.owns_location_image_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owns_location_image_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_delete_unattached_location_image_object(p_object_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM storage.objects AS object_row
             WHERE object_row.bucket_id = 'location-screenshots'
               AND object_row.name = p_object_path
               AND object_row.owner_id = auth.uid()::text
       )
       AND NOT EXISTS (
            SELECT 1
              FROM public.location_images AS image_row
             WHERE image_row.object_path = p_object_path
       );
$function$;

REVOKE ALL ON FUNCTION private.can_delete_unattached_location_image_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_delete_unattached_location_image_object(text) TO authenticated;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_authenticated_read ON public.app_settings;
CREATE POLICY app_settings_authenticated_read
ON public.app_settings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS app_settings_admin_update ON public.app_settings;
CREATE POLICY app_settings_admin_update
ON public.app_settings FOR UPDATE TO authenticated
USING (private.is_admin())
WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS location_images_authenticated_read ON public.location_images;
CREATE POLICY location_images_authenticated_read
ON public.location_images FOR SELECT TO authenticated
USING (
    private.is_admin()
    OR (
        is_archived = false
        AND EXISTS (
            SELECT 1 FROM public.locations AS location_row
             WHERE location_row.id = location_images.location_id
               AND location_row.is_archived = false
        )
    )
);

DROP POLICY IF EXISTS location_images_authenticated_insert ON public.location_images;
CREATE POLICY location_images_authenticated_insert
ON public.location_images FOR INSERT TO authenticated
WITH CHECK (
    uploaded_by = auth.uid()
    AND pg_catalog.split_part(object_path, '/', 1) = location_id::text
    AND private.can_upload_location_image(location_id::text)
    AND private.owns_location_image_object(object_path)
);

DROP POLICY IF EXISTS location_images_admin_update ON public.location_images;
CREATE POLICY location_images_admin_update
ON public.location_images FOR UPDATE TO authenticated
USING (private.is_admin())
WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS location_images_admin_delete ON public.location_images;
CREATE POLICY location_images_admin_delete
ON public.location_images FOR DELETE TO authenticated
USING (private.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_images TO authenticated;
GRANT SELECT ON public.app_settings TO authenticated;
GRANT UPDATE (allow_player_image_uploads, updated_by) ON public.app_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_image_upload_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_enabled boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby odczytać ustawienia zdjęć.' USING ERRCODE = '42501';
    END IF;

    SELECT allow_player_image_uploads INTO v_enabled
      FROM public.app_settings WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object(
        'allow_player_image_uploads', COALESCE(v_enabled, true),
        'administrator_can_upload', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_image_upload_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_image_upload_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_player_image_uploads_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Tylko administrator może zmieniać globalne ustawienia galerii.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.app_settings
       SET allow_player_image_uploads = COALESCE(p_enabled, false),
           updated_by = auth.uid(),
           updated_at = pg_catalog.now()
     WHERE id = 1;

    RETURN pg_catalog.jsonb_build_object(
        'allow_player_image_uploads', COALESCE(p_enabled, false),
        'administrator_can_upload', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_player_image_uploads_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_player_image_uploads_enabled(boolean) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'location-screenshots',
    'location-screenshots',
    false,
    500000,
    ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 500000,
    allowed_mime_types = ARRAY['image/webp']::text[];

DROP POLICY IF EXISTS location_screenshots_authenticated_read ON storage.objects;
CREATE POLICY location_screenshots_authenticated_read
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'location-screenshots'
    AND EXISTS (
        SELECT 1
          FROM public.location_images AS image_row
          JOIN public.locations AS location_row ON location_row.id = image_row.location_id
         WHERE image_row.object_path = storage.objects.name
           AND (
                private.is_admin()
                OR (image_row.is_archived = false AND location_row.is_archived = false)
           )
    )
);

DROP POLICY IF EXISTS location_screenshots_authenticated_insert ON storage.objects;
CREATE POLICY location_screenshots_authenticated_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'location-screenshots'
    AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    AND private.can_upload_location_image((storage.foldername(name))[1])
);

DROP POLICY IF EXISTS location_screenshots_admin_or_failed_upload_delete ON storage.objects;
CREATE POLICY location_screenshots_admin_or_failed_upload_delete
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'location-screenshots'
    AND (
        private.is_admin()
        OR private.can_delete_unattached_location_image_object(name)
    )
);

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
            ), '[]'::jsonb),
            'location_images', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(image_row) ORDER BY image_row.location_id)
                FROM public.location_images AS image_row
            ), '[]'::jsonb)
        ),
        'excluded', pg_catalog.jsonb_build_array(
            'hasła, tokeny, sesje i dane uwierzytelniające Supabase Auth',
            'rangi i oznaczenie właściciela nie są zmieniane podczas przywracania'
        )
    ) INTO v_backup;

    RETURN v_backup;
END;
$function$;

CREATE OR REPLACE FUNCTION private.organization_backup_validate_images(p_backup jsonb)
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

    IF v_data ? 'location_images' AND pg_catalog.jsonb_typeof(v_data -> 'location_images') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłową listę zdjęć.' USING ERRCODE = '22023';
    END IF;
    IF v_data ? 'storage_files' AND pg_catalog.jsonb_typeof(v_data -> 'storage_files') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłową listę plików Storage.' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_array_length(COALESCE(v_data -> 'location_images', '[]'::jsonb))
       <> pg_catalog.jsonb_array_length(COALESCE(v_data -> 'storage_files', '[]'::jsonb)) THEN
        RAISE EXCEPTION 'Liczba metadanych zdjęć nie zgadza się z liczbą plików w kopii.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS image_row(value)
         WHERE COALESCE(image_row.value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR COALESCE(image_row.value ->> 'location_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR COALESCE(image_row.value ->> 'object_path', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
            OR pg_catalog.split_part(COALESCE(image_row.value ->> 'object_path', ''), '/', 1) IS DISTINCT FROM image_row.value ->> 'location_id'
            OR COALESCE(image_row.value ->> 'mime_type', '') <> 'image/webp'
            OR COALESCE((image_row.value ->> 'size_bytes')::integer, 0) NOT BETWEEN 1 AND 500000
            OR COALESCE((image_row.value ->> 'image_width')::integer, 0) NOT BETWEEN 1 AND 5000
            OR COALESCE((image_row.value ->> 'image_height')::integer, 0) NOT BETWEEN 1 AND 5000
            OR COALESCE((image_row.value ->> 'is_archived')::boolean, false)
               IS DISTINCT FROM (NULLIF(image_row.value ->> 'archived_at', '') IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłowe metadane zdjęcia.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT image_row.value ->> 'location_id'
          FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS image_row(value)
         GROUP BY image_row.value ->> 'location_id'
        HAVING pg_catalog.count(*) > 1
    ) OR EXISTS (
        SELECT file_row.value ->> 'object_path'
          FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'storage_files', '[]'::jsonb)) AS file_row(value)
         GROUP BY file_row.value ->> 'object_path'
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera powtórzone zdjęcia lub ścieżki plików.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS image_row(value)
          LEFT JOIN pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'storage_files', '[]'::jsonb)) AS file_row(value)
            ON file_row.value ->> 'object_path' = image_row.value ->> 'object_path'
         WHERE file_row.value IS NULL
            OR file_row.value ->> 'mime_type' IS DISTINCT FROM image_row.value ->> 'mime_type'
            OR (file_row.value ->> 'size_bytes')::integer IS DISTINCT FROM (image_row.value ->> 'size_bytes')::integer
    ) THEN
        RAISE EXCEPTION 'Metadane zdjęć nie odpowiadają plikom dołączonym do kopii.' USING ERRCODE = '22023';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_validate_images(jsonb) FROM PUBLIC, anon, authenticated;

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
    v_count_images integer := 0;
    v_activity_sequence regclass;
    v_activity_sequence_last bigint;
    v_activity_backup_max bigint;
    v_activity_current_max bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Przywracanie kopii jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_images(p_backup);
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
        public.activity_log,
        public.location_images
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

    -- Storage objects are uploaded and verified by the authenticated client before this RPC.
    -- Refuse to create metadata pointing to a missing object.
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS image_row(value)
         WHERE NOT EXISTS (
            SELECT 1 FROM storage.objects AS object_row
             WHERE object_row.bucket_id = 'location-screenshots'
               AND object_row.name = image_row.value ->> 'object_path'
         )
    ) THEN
        RAISE EXCEPTION 'Nie wszystkie zdjęcia z kopii zostały wcześniej wysłane do Storage. Przywracanie zostało przerwane.'
            USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.location_images AS current_row (
        id, location_id, object_path, original_name, mime_type, size_bytes,
        image_width, image_height, uploaded_by, is_archived, archived_at,
        archived_by, created_at, updated_at
    )
    SELECT
        (source_row.value ->> 'id')::uuid,
        (source_row.value ->> 'location_id')::uuid,
        source_row.value ->> 'object_path',
        COALESCE(source_row.value ->> 'original_name', ''),
        source_row.value ->> 'mime_type',
        (source_row.value ->> 'size_bytes')::integer,
        NULLIF(source_row.value ->> 'image_width', '')::integer,
        NULLIF(source_row.value ->> 'image_height', '')::integer,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'uploaded_by', '')::uuid, v_user_map),
        COALESCE((source_row.value ->> 'is_archived')::boolean, false),
        NULLIF(source_row.value ->> 'archived_at', '')::timestamptz,
        private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'archived_by', '')::uuid, v_user_map),
        COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
        COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now())
    FROM pg_catalog.jsonb_array_elements(COALESCE(v_data -> 'location_images', '[]'::jsonb)) AS source_row(value)
    ON CONFLICT (location_id) DO UPDATE SET
        id = EXCLUDED.id,
        object_path = EXCLUDED.object_path,
        original_name = EXCLUDED.original_name,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        image_width = EXCLUDED.image_width,
        image_height = EXCLUDED.image_height,
        uploaded_by = EXCLUDED.uploaded_by,
        is_archived = EXCLUDED.is_archived,
        archived_at = EXCLUDED.archived_at,
        archived_by = EXCLUDED.archived_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
    GET DIAGNOSTICS v_count_images = ROW_COUNT;

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
        'images_processed', v_count_images,
        'preserved_roles_and_owner', true,
        'deleted_current_only_records', 0
    );
END;
$function$;

COMMENT ON TABLE public.location_images IS
    'One optional optimized WebP screenshot per shared location. Image files live in the private location-screenshots Storage bucket.';

COMMIT;
