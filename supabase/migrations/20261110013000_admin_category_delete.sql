-- SA Event Maps: guarded permanent deletion for unused categories.
-- Categories with event-location assignments must be archived instead.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_category(
    p_category_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_assignment_count bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Ta operacja jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'Nie wskazano kategorii do usunięcia.'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
      FROM public.categories AS category
     WHERE category.id = p_category_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono wskazanej kategorii.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_assignment_count
      FROM public.event_locations AS assignment
     WHERE assignment.category_id = p_category_id;

    IF v_assignment_count > 0 THEN
        RAISE EXCEPTION
            'Nie można usunąć tej kategorii, ponieważ jest przypisana do % lokalizacji wydarzeń. Zarchiwizuj ją zamiast usuwać.',
            v_assignment_count
            USING ERRCODE = '23503';
    END IF;

    DELETE FROM public.categories AS category
     WHERE category.id = p_category_id;

    RETURN FOUND;
END;
$function$;

COMMENT ON FUNCTION public.admin_delete_category(uuid) IS
    'Allows administrators to permanently delete only categories that are not assigned to any event location. Used categories must be archived.';

REVOKE ALL ON FUNCTION public.admin_delete_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(uuid) TO authenticated;

COMMIT;
