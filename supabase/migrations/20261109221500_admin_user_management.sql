-- SA Event Maps: secure administrator user listing and role management.
-- The public profiles table intentionally does not store email addresses.
-- Email data is read from auth.users only inside this SECURITY DEFINER function,
-- and is returned only to a caller whose current database role is admin.

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
    user_id uuid,
    email text,
    display_name text,
    role text,
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
        auth_user.created_at,
        auth_user.last_sign_in_at,
        auth_user.email_confirmed_at
    FROM auth.users AS auth_user
    INNER JOIN public.profiles AS profile
        ON profile.id = auth_user.id
    ORDER BY auth_user.created_at DESC, auth_user.id;
END;
$function$;

COMMENT ON FUNCTION public.admin_list_users() IS
    'Returns account details to authenticated administrators only; email addresses remain outside public.profiles.';

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

    -- Serialize all role changes. This prevents two concurrent demotions
    -- from both observing that more than one administrator exists.
    PERFORM pg_catalog.pg_advisory_xact_lock(73481260412001::bigint);

    -- Re-check the caller after acquiring the lock, because another
    -- administrator may have changed this caller's role while it waited.
    IF NOT private.is_admin() THEN
        RAISE EXCEPTION 'Twoja ranga administratora nie pozwala już na tę operację.'
            USING ERRCODE = '42501';
    END IF;

    SELECT profile.role
      INTO v_current_role
      FROM public.profiles AS profile
     WHERE profile.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono profilu wskazanego użytkownika.'
            USING ERRCODE = 'P0002';
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
    'Changes a profile role for administrators only, serializes changes, prevents self-demotion and protects the last administrator.';

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
