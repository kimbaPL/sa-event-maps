BEGIN;

-- Existing profiles may contain duplicate names (including case-only duplicates).
-- Keep the first name in stable UUID order and suffix later duplicates so the
-- new case-insensitive uniqueness rule can be installed without losing accounts.
DO $migration$
DECLARE
    profile_row record;
    used_names text[] := ARRAY[]::text[];
    base_name text;
    candidate_name text;
    suffix_number integer;
    suffix_text text;
BEGIN
    FOR profile_row IN
        SELECT id, display_name
        FROM public.profiles
        ORDER BY id
    LOOP
        base_name := left(coalesce(nullif(btrim(profile_row.display_name), ''), 'Gracz'), 80);
        candidate_name := base_name;
        suffix_number := 1;

        WHILE lower(candidate_name) = ANY(used_names) LOOP
            suffix_number := suffix_number + 1;
            suffix_text := ' (' || suffix_number::text || ')';
            candidate_name := left(base_name, greatest(1, 80 - char_length(suffix_text))) || suffix_text;
        END LOOP;

        used_names := array_append(used_names, lower(candidate_name));

        IF profile_row.display_name IS DISTINCT FROM candidate_name THEN
            UPDATE public.profiles
            SET display_name = candidate_name
            WHERE id = profile_row.id;
        END IF;
    END LOOP;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_unique_ci_idx
    ON public.profiles (lower(btrim(display_name)))
    WHERE display_name IS NOT NULL AND btrim(display_name) <> '';

-- Keep legacy/admin restore writes unique as well. Interactive name changes
-- receive a friendly conflict from the RPC below; other profile writes get
-- a deterministic suffix rather than breaking backup restoration.
CREATE OR REPLACE FUNCTION private.ensure_unique_profile_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    base_name text;
    candidate_name text;
    suffix_number integer := 1;
    suffix_text text;
BEGIN
    base_name := left(coalesce(nullif(btrim(NEW.display_name), ''), 'Gracz'), 80);
    candidate_name := base_name;

    WHILE EXISTS (
        SELECT 1
        FROM public.profiles AS existing_profile
        WHERE existing_profile.id IS DISTINCT FROM NEW.id
          AND lower(btrim(existing_profile.display_name)) = lower(candidate_name)
    ) LOOP
        suffix_number := suffix_number + 1;
        suffix_text := ' (' || suffix_number::text || ')';
        candidate_name := left(base_name, greatest(1, 80 - char_length(suffix_text))) || suffix_text;
    END LOOP;

    NEW.display_name := candidate_name;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_ensure_unique_display_name ON public.profiles;
CREATE TRIGGER profiles_ensure_unique_display_name
    BEFORE INSERT OR UPDATE OF display_name ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION private.ensure_unique_profile_display_name();

CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    current_user_id uuid := auth.uid();
    next_display_name text := btrim(coalesce(p_display_name, ''));
BEGIN
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zmienić pseudonim.';
    END IF;

    IF char_length(next_display_name) < 2 OR char_length(next_display_name) > 80 THEN
        RAISE EXCEPTION 'Pseudonim musi mieć od 2 do 80 znaków.';
    END IF;

    IF next_display_name ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'Pseudonim nie może zawierać znaków sterujących.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.profiles AS other_profile
        WHERE other_profile.id <> current_user_id
          AND lower(btrim(other_profile.display_name)) = lower(next_display_name)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Ten pseudonim jest już zajęty. Wybierz inną nazwę.';
    END IF;

    UPDATE public.profiles
    SET display_name = next_display_name
    WHERE id = current_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono profilu zalogowanego użytkownika.';
    END IF;

    RETURN next_display_name;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Ten pseudonim jest już zajęty. Wybierz inną nazwę.';
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;

COMMIT;
