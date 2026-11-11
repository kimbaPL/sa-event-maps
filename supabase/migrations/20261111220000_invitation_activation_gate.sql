BEGIN;

-- Existing profiles remain active by default. Only invitations created without
-- a password are moved into the pending state so already-working accounts stay
-- available after this migration.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles AS profile_row
   SET is_active = false
  FROM auth.users AS auth_user
 WHERE auth_user.id = profile_row.id
   AND auth_user.invited_at IS NOT NULL
   AND COALESCE(auth_user.encrypted_password, '') = ''
   AND COALESCE(profile_row.is_owner, false) = false;

-- New Auth users created by an administrator invitation start inactive.
-- The server also supplies a private metadata marker as a defensive fallback
-- in case Auth's invited_at value is not available during the insert trigger.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_is_invited boolean;
BEGIN
    v_is_invited := NEW.invited_at IS NOT NULL
        OR pg_catalog.lower(COALESCE(NEW.raw_user_meta_data ->> 'sa_event_maps_access_pending', 'false'))
            IN ('true', '1', 'yes');

    INSERT INTO public.profiles (id, display_name, is_active)
    VALUES (
        NEW.id,
        COALESCE(
            NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'display_name'), ''),
            'Gracz'
        ),
        NOT v_is_invited
    );

    RETURN NEW;
END;
$function$;

-- The previously installed restrictive RLS policies call this function.
-- Replacing its body immediately blocks inactive invitation accounts from all
-- RLS-protected public tables and the private screenshot bucket.
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
              AND profile_row.is_active = true
       );
$function$;

REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;

-- The client can ask only about its own account. SECURITY DEFINER allows this
-- status check to work even while the restrictive RLS gate blocks profiles.
CREATE OR REPLACE FUNCTION public.get_my_access_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT pg_catalog.jsonb_build_object(
        'is_active', COALESCE((
            SELECT profile_row.is_active
            FROM public.profiles AS profile_row
            WHERE profile_row.id = auth.uid()
        ), false),
        'is_invited', COALESCE((
            SELECT auth_user.invited_at IS NOT NULL
            FROM auth.users AS auth_user
            WHERE auth_user.id = auth.uid()
        ), false)
    );
$function$;

REVOKE ALL ON FUNCTION public.get_my_access_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_access_status() TO authenticated;

-- Protect is_active from direct profile updates. Only the activation RPC below
-- may set its transaction-local authorization flag.
CREATE OR REPLACE FUNCTION private.guard_profile_activation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active
       AND COALESCE(pg_catalog.current_setting('sa_event_maps.allow_profile_activation', true), '') <> 'on' THEN
        RAISE EXCEPTION 'Status aktywacji konta może zmieniać wyłącznie bezpieczna procedura aktywacji.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_profile_activation_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_activation_status ON public.profiles;
CREATE TRIGGER profiles_guard_activation_status
BEFORE UPDATE OF is_active ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION private.guard_profile_activation_status();

-- Activation is possible only for the authenticated user whose Auth record
-- was created through an invitation and whose password has actually been set.
CREATE OR REPLACE FUNCTION public.activate_my_invited_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_invited_at timestamptz;
    v_encrypted_password text;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się przez link zaproszeniowy, aby aktywować konto.'
            USING ERRCODE = '42501';
    END IF;

    SELECT auth_user.invited_at, auth_user.encrypted_password
      INTO v_invited_at, v_encrypted_password
      FROM auth.users AS auth_user
     WHERE auth_user.id = v_user_id
     FOR UPDATE;

    IF NOT FOUND OR v_invited_at IS NULL THEN
        RAISE EXCEPTION 'To konto nie zostało utworzone przez zaproszenie administracji.'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(v_encrypted_password, '') = '' THEN
        RAISE EXCEPTION 'Najpierw ustaw hasło do konta.'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.set_config('sa_event_maps.allow_profile_activation', 'on', true);

    UPDATE public.profiles
       SET is_active = true
     WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono profilu zaproszonego użytkownika.'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN pg_catalog.jsonb_build_object('activated', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_my_invited_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_my_invited_account() TO authenticated;

COMMENT ON COLUMN public.profiles.is_active IS
    'Controls access to SA Event Maps. New invitation accounts remain inactive until their password is set and activate_my_invited_account succeeds.';
COMMENT ON FUNCTION public.get_my_access_status() IS
    'Returns only the authenticated user own activation and invitation state, including while restrictive RLS blocks profile reads.';
COMMENT ON FUNCTION public.activate_my_invited_account() IS
    'Activates only the calling invited account after Auth has stored a password.';

COMMIT;
