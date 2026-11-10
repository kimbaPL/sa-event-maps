-- SA Event Maps: guarded permanent deletion for events and global locations.
-- Events with player progress and locations with assignments/progress must be archived instead.

BEGIN;

CREATE INDEX IF NOT EXISTS player_progress_location_id_idx
    ON public.player_progress (location_id);

CREATE OR REPLACE FUNCTION public.admin_delete_event(
    p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_progress_count bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Ta operacja jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'Nie wskazano wydarzenia do usunięcia.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the parent row. FK checks from concurrent progress inserts require a key-share lock.
    PERFORM 1
      FROM public.events AS event_row
     WHERE event_row.id = p_event_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono wskazanego wydarzenia.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_progress_count
      FROM public.player_progress AS progress_row
     WHERE progress_row.event_id = p_event_id;

    IF v_progress_count > 0 THEN
        RAISE EXCEPTION 'Nie można trwale usunąć tego wydarzenia: istnieje zapisany postęp graczy. Zarchiwizuj wydarzenie, aby zachować historię.'
            USING ERRCODE = '23503';
    END IF;

    -- event_locations is removed by its FK cascade. locations themselves are not touched.
    DELETE FROM public.events
     WHERE id = p_event_id;

    RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.admin_delete_event(uuid) IS
    'Permanently deletes an event only when no player progress exists; event-location assignments cascade, shared locations remain.';

REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_location(
    p_location_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_assignment_count bigint;
    v_progress_count bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Ta operacja jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF p_location_id IS NULL THEN
        RAISE EXCEPTION 'Nie wskazano lokalizacji do usunięcia.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the parent row against concurrent event/progress references.
    PERFORM 1
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono wskazanej lokalizacji.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_assignment_count
      FROM public.event_locations AS assignment_row
     WHERE assignment_row.location_id = p_location_id;

    IF v_assignment_count > 0 THEN
        RAISE EXCEPTION 'Nie można trwale usunąć tej znajdźki: nadal jest przypisana do % wydarzeń. Najpierw usuń przypisania albo zarchiwizuj lokalizację.', v_assignment_count
            USING ERRCODE = '23503';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_progress_count
      FROM public.player_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;

    IF v_progress_count > 0 THEN
        RAISE EXCEPTION 'Nie można trwale usunąć tej znajdźki: istnieją zapisane postępy graczy. Zarchiwizuj lokalizację, aby zachować historię.'
            USING ERRCODE = '23503';
    END IF;

    DELETE FROM public.locations
     WHERE id = p_location_id;

    RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.admin_delete_location(uuid) IS
    'Permanently deletes a global location only when it has no event assignments and no player progress.';

REVOKE ALL ON FUNCTION public.admin_delete_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_location(uuid) TO authenticated;

COMMIT;
