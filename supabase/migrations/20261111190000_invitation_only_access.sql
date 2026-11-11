BEGIN;

-- SA Event Maps: organization-approved access, safe account deletion,
-- preservation of shared records, and protection against stale JWTs.

-- ------------------------------------------------------------
-- 1. Requests for access (no Auth account is created yet).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.access_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
    email text NOT NULL,
    email_normalized text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT access_requests_email_format CHECK (
        email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS access_requests_email_normalized_uidx
    ON public.access_requests (email_normalized);
CREATE INDEX IF NOT EXISTS access_requests_created_at_idx
    ON public.access_requests (created_at ASC);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.access_requests TO service_role;

CREATE OR REPLACE FUNCTION public.submit_access_request(
    p_display_name text,
    p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_display_name text := pg_catalog.btrim(COALESCE(p_display_name, ''));
    v_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
BEGIN
    IF pg_catalog.char_length(v_display_name) < 2
       OR pg_catalog.char_length(v_display_name) > 80 THEN
        RAISE EXCEPTION 'Pseudonim musi mieć od 2 do 80 znaków.'
            USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.char_length(v_email) > 254
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'Podaj prawidłowy adres e-mail.'
            USING ERRCODE = '22023';
    END IF;

    -- Do not reveal whether an email already has an account. The public
    -- response is identical to a newly accepted request.
    IF EXISTS (
        SELECT 1 FROM auth.users AS auth_user
        WHERE pg_catalog.lower(auth_user.email::text) = v_email
    ) THEN
        RETURN pg_catalog.jsonb_build_object('accepted', true);
    END IF;

    INSERT INTO public.access_requests (display_name, email, email_normalized)
    VALUES (v_display_name, v_email, v_email)
    ON CONFLICT (email_normalized) DO NOTHING;

    RETURN pg_catalog.jsonb_build_object('accepted', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_access_request(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_access_request(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_access_requests()
RETURNS TABLE (
    request_id uuid,
    display_name text,
    email text,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Lista oczekujących jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT request_row.id, request_row.display_name, request_row.email, request_row.created_at
    FROM public.access_requests AS request_row
    ORDER BY request_row.created_at ASC, request_row.id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_access_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_access_requests() TO authenticated;

-- ------------------------------------------------------------
-- 2. Creator/audit references must not cascade-delete shared data.
-- Any public-table FK to profiles/auth.users that is not part of a
-- primary key becomes nullable. The delete trigger below nulls these
-- references before the Auth row is removed. User-keyed progress rows
-- are deliberately deleted instead.
-- ------------------------------------------------------------
DO $preserve_profile_references$
DECLARE
    v_fk record;
BEGIN
    FOR v_fk IN
        SELECT
            constraint_row.conrelid AS child_table,
            constraint_row.conname AS constraint_name,
            constraint_row.conkey[1] AS child_attnum,
            child_namespace.nspname AS child_schema,
            child_table.relname AS child_name,
            child_attribute.attname AS child_column,
            EXISTS (
                SELECT 1
                FROM pg_catalog.pg_index AS primary_index
                WHERE primary_index.indrelid = constraint_row.conrelid
                  AND primary_index.indisprimary
                  AND constraint_row.conkey[1] = ANY(primary_index.indkey::smallint[])
            ) AS is_primary_key_column,
            pg_catalog.cardinality(constraint_row.conkey) AS key_count
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_class AS child_table
          ON child_table.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace AS child_namespace
          ON child_namespace.oid = child_table.relnamespace
        JOIN pg_catalog.pg_attribute AS child_attribute
          ON child_attribute.attrelid = constraint_row.conrelid
         AND child_attribute.attnum = constraint_row.conkey[1]
        WHERE constraint_row.contype = 'f'
          AND constraint_row.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
          AND child_namespace.nspname = 'public'
          AND constraint_row.conrelid <> 'public.profiles'::regclass
    LOOP
        IF v_fk.key_count <> 1 THEN
            RAISE EXCEPTION 'Nieobsługiwany złożony klucz obcy do profilu/użytkownika: %.%',
                v_fk.child_name, v_fk.constraint_name;
        END IF;

        IF NOT v_fk.is_primary_key_column THEN
            EXECUTE pg_catalog.format(
                'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
                v_fk.child_schema, v_fk.child_name, v_fk.child_column
            );
        END IF;
    END LOOP;
END;
$preserve_profile_references$;

-- ------------------------------------------------------------
-- 3. Active-user gate. A deleted user's already-issued JWT can remain
-- cryptographically valid until expiry. These restrictive policies make
-- database and private screenshot access fail as soon as the profile is gone.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.profiles AS profile_row
            WHERE profile_row.id = auth.uid()
       );
$function$;

REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;

DO $active_user_policies$
DECLARE
    v_table record;
BEGIN
    FOR v_table IN
        SELECT namespace_row.nspname AS schema_name, table_row.relname AS table_name
        FROM pg_catalog.pg_class AS table_row
        JOIN pg_catalog.pg_namespace AS namespace_row
          ON namespace_row.oid = table_row.relnamespace
        WHERE namespace_row.nspname = 'public'
          AND table_row.relkind IN ('r', 'p')
          AND table_row.relrowsecurity = true
    LOOP
        EXECUTE pg_catalog.format(
            'DROP POLICY IF EXISTS sa_event_maps_active_member_gate ON %I.%I',
            v_table.schema_name, v_table.table_name
        );
        EXECUTE pg_catalog.format(
            'CREATE POLICY sa_event_maps_active_member_gate ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.is_active_user()) WITH CHECK (private.is_active_user())',
            v_table.schema_name, v_table.table_name
        );
    END LOOP;
END;
$active_user_policies$;

DROP POLICY IF EXISTS location_screenshots_active_member_gate ON storage.objects;
CREATE POLICY location_screenshots_active_member_gate
ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
    bucket_id <> 'location-screenshots'
    OR private.is_active_user()
)
WITH CHECK (
    bucket_id <> 'location-screenshots'
    OR private.is_active_user()
);

-- ------------------------------------------------------------
-- 4. Safe Auth deletion. Shared records survive with NULL creator/audit
-- references; only the departing user's personal progress is removed.
-- The permanent owner and the last administrator are protected at DB level.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.preserve_sa_event_maps_data_before_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_profile_role text;
    v_is_owner boolean;
    v_admin_count bigint;
    v_fk record;
BEGIN
    -- Serialize with admin_set_user_role so concurrent account removals or
    -- role changes cannot accidentally remove the final administrator.
    PERFORM pg_catalog.pg_advisory_xact_lock(73481260412001::bigint);

    SELECT profile_row.role, profile_row.is_owner
      INTO v_profile_role, v_is_owner
      FROM public.profiles AS profile_row
     WHERE profile_row.id = OLD.id
     FOR UPDATE;

    IF COALESCE(v_is_owner, false) THEN
        RAISE EXCEPTION 'Nie można usunąć stałego właściciela projektu SA Event Maps.'
            USING ERRCODE = '42501';
    END IF;

    IF v_profile_role = 'admin' THEN
        SELECT pg_catalog.count(*)
          INTO v_admin_count
          FROM public.profiles AS profile_row
         WHERE profile_row.role = 'admin';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Nie można usunąć ostatniego administratora projektu.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Use the same narrowly scoped bypass already reserved for controlled
    -- organization restore. Existing location/image guards would otherwise
    -- mistake creator-reference cleanup for an ordinary player edit.
    PERFORM pg_catalog.set_config('sa_event_maps.organization_backup_restore', 'on', true);

    -- These tables contain only personal progress. Never remove progress
    -- belonging to any other user, and never touch shared locations/events.
    DELETE FROM public.player_progress WHERE user_id = OLD.id;
    DELETE FROM public.player_catalog_progress WHERE user_id = OLD.id;

    -- Preserve public records that reference this account through profile or
    -- Auth foreign keys. Primary-key references represent user-owned rows and
    -- are removed (the known cases above are the two personal progress tables).
    FOR v_fk IN
        SELECT
            constraint_row.conrelid AS child_table,
            child_namespace.nspname AS child_schema,
            child_table.relname AS child_name,
            child_attribute.attname AS child_column,
            EXISTS (
                SELECT 1
                FROM pg_catalog.pg_index AS primary_index
                WHERE primary_index.indrelid = constraint_row.conrelid
                  AND primary_index.indisprimary
                  AND constraint_row.conkey[1] = ANY(primary_index.indkey::smallint[])
            ) AS is_primary_key_column,
            pg_catalog.cardinality(constraint_row.conkey) AS key_count
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_class AS child_table
          ON child_table.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace AS child_namespace
          ON child_namespace.oid = child_table.relnamespace
        JOIN pg_catalog.pg_attribute AS child_attribute
          ON child_attribute.attrelid = constraint_row.conrelid
         AND child_attribute.attnum = constraint_row.conkey[1]
        WHERE constraint_row.contype = 'f'
          AND constraint_row.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
          AND child_namespace.nspname = 'public'
          AND constraint_row.conrelid <> 'public.profiles'::regclass
    LOOP
        IF v_fk.key_count <> 1 THEN
            RAISE EXCEPTION 'Nie można bezpiecznie usunąć konta: znaleziono złożone powiązanie %.%',
                v_fk.child_name, v_fk.child_column;
        END IF;

        IF v_fk.is_primary_key_column THEN
            -- Only the explicitly known per-user progress tables may be
            -- deleted. Unknown tables fail closed instead of risking removal
            -- of shared organizational records.
            IF v_fk.child_schema = 'public'
               AND v_fk.child_name IN ('player_progress', 'player_catalog_progress') THEN
                EXECUTE pg_catalog.format(
                    'DELETE FROM %I.%I WHERE %I = $1',
                    v_fk.child_schema, v_fk.child_name, v_fk.child_column
                ) USING OLD.id;
            ELSE
                RAISE EXCEPTION 'Nie można bezpiecznie usunąć konta: tabela %.% ma klucz główny powiązany z użytkownikiem. Wymagana jest osobna reguła zachowania danych.',
                    v_fk.child_schema, v_fk.child_name
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            EXECUTE pg_catalog.format(
                'UPDATE %I.%I SET %I = NULL WHERE %I = $1',
                v_fk.child_schema, v_fk.child_name, v_fk.child_column, v_fk.child_column
            ) USING OLD.id;
        END IF;
    END LOOP;

    RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION private.preserve_sa_event_maps_data_before_user_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sa_event_maps_preserve_data_before_auth_user_delete ON auth.users;
CREATE TRIGGER sa_event_maps_preserve_data_before_auth_user_delete
BEFORE DELETE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.preserve_sa_event_maps_data_before_user_delete();

COMMENT ON TABLE public.access_requests IS
    'Requests to join SA Event Maps. No Auth account is created until an administrator sends an invitation.';
COMMENT ON FUNCTION public.submit_access_request(text, text) IS
    'Public request form endpoint. Always returns a generic accepted response to avoid email/account enumeration.';

COMMIT;
