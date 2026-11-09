-- SA Event Maps: immutable project owner and owner badge support.
-- The first account created in Supabase Auth becomes the permanent owner.
-- The owner remains an administrator and cannot be demoted by another admin.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_owner IS
    'Marks the single permanent SA Event Maps project owner. This flag is not editable by authenticated users.';

DO $owner_bootstrap$
DECLARE
    v_owner_id uuid;
BEGIN
    -- Use the earliest existing Auth account as the original project owner.
    SELECT auth_user.id
      INTO v_owner_id
      FROM auth.users AS auth_user
     ORDER BY auth_user.created_at ASC, auth_user.id ASC
     LIMIT 1;

    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Nie znaleziono konta w Supabase Auth. Nie można przypisać właściciela projektu.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
         WHERE profile.id = v_owner_id
    ) THEN
        RAISE EXCEPTION 'Pierwsze konto Auth nie ma profilu w public.profiles. Migracja została przerwana.';
    END IF;

    -- Ensure exactly the first account is the owner and restore its admin role.
    -- All other users keep their current role.
    UPDATE public.profiles AS profile
       SET is_owner = (profile.id = v_owner_id),
           role = CASE
               WHEN profile.id = v_owner_id THEN 'admin'
               ELSE profile.role
           END
     WHERE profile.is_owner IS DISTINCT FROM (profile.id = v_owner_id)
        OR (profile.id = v_owner_id AND profile.role <> 'admin');
END;
$owner_bootstrap$;

DO $owner_constraint$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_row
         WHERE constraint_row.conrelid = 'public.profiles'::regclass
           AND constraint_row.conname = 'profiles_owner_must_be_admin'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_owner_must_be_admin
            CHECK (NOT is_owner OR role = 'admin');
    END IF;
END;
$owner_constraint$;

-- Enforce at most one owner in the database, even if a privileged code path is added later.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_single_owner_idx
    ON public.profiles ((is_owner))
    WHERE is_owner IS TRUE;

-- Authenticated users may read the flag, but cannot change it through the Data API.
REVOKE UPDATE (is_owner) ON TABLE public.profiles FROM anon, authenticated;

-- The return shape is extended with is_owner, so recreate the list function.
DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (
    user_id uuid,
    email text,
    display_name text,
    role text,
    is_owner boolean,
    created_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    email_confirmed_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Ta operacja jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        auth_user.id,
        COALESCE(auth_user.email::text, ''::text),
        profile.display_name::text,
        profile.role::text,
        profile.is_owner,
        auth_user.created_at,
        auth_user.last_sign_in_at,
        auth_user.email_confirmed_at
    FROM auth.users AS auth_user
    INNER JOIN public.profiles AS profile
        ON profile.id = auth_user.id
    ORDER BY profile.is_owner DESC, auth_user.created_at DESC, auth_user.id;
END;
$function$;

COMMENT ON FUNCTION public.admin_list_users() IS
    'Returns account details and owner marker to authenticated administrators only; email addresses remain outside public.profiles.';

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
    p_target_user_id uuid,
    p_new_role text
)
RETURNS TABLE (
    user_id uuid,
    display_name text,
    role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_new_role text;
    v_current_role text;
    v_target_is_owner boolean;
    v_admin_count bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Ta operacja jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Nie wskazano użytkownika.'
            USING ERRCODE = '22023';
    END IF;

    v_new_role := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_new_role, '')));

    IF v_new_role NOT IN ('player', 'admin') THEN
        RAISE EXCEPTION 'Nieprawidłowa ranga. Dozwolone wartości to player i admin.'
            USING ERRCODE = '22023';
    END IF;

    -- Serialize all role changes and re-check the caller after acquiring the lock.
    PERFORM pg_catalog.pg_advisory_xact_lock(73481260412001::bigint);

    IF NOT private.is_admin() THEN
        RAISE EXCEPTION 'Twoja ranga administratora nie pozwala już na tę operację.'
            USING ERRCODE = '42501';
    END IF;

    SELECT profile.role, profile.is_owner
      INTO v_current_role, v_target_is_owner
      FROM public.profiles AS profile
     WHERE profile.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono profilu wskazanego użytkownika.'
            USING ERRCODE = 'P0002';
    END IF;

    -- The owner is permanent: another administrator cannot demote this account.
    IF v_target_is_owner AND v_new_role <> 'admin' THEN
        RAISE EXCEPTION 'Nie można odebrać rangi właścicielowi projektu SA Event Maps.'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_user_id = auth.uid()
       AND v_current_role = 'admin'
       AND v_new_role = 'player' THEN
        RAISE EXCEPTION 'Nie możesz odebrać rangi administratora własnemu kontu. Poproś innego administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_role = v_new_role THEN
        RETURN QUERY
        SELECT profile.id, profile.display_name, profile.role
          FROM public.profiles AS profile
         WHERE profile.id = p_target_user_id;
        RETURN;
    END IF;

    IF v_current_role = 'admin' AND v_new_role = 'player' THEN
        SELECT pg_catalog.count(*)
          INTO v_admin_count
          FROM public.profiles AS profile
         WHERE profile.role = 'admin';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Nie można odebrać rangi ostatniemu administratorowi.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE public.profiles AS profile
       SET role = v_new_role,
           updated_at = pg_catalog.now()
     WHERE profile.id = p_target_user_id;

    RETURN QUERY
    SELECT profile.id, profile.display_name, profile.role
      FROM public.profiles AS profile
     WHERE profile.id = p_target_user_id;
END;
$function$;

COMMENT ON FUNCTION public.admin_set_user_role(uuid, text) IS
    'Changes profile roles for administrators only, serializes changes, protects the permanent project owner, prevents self-demotion and protects the last administrator.';

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;

COMMIT;
