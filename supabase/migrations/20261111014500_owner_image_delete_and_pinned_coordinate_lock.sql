BEGIN;

-- A player may remove their own screenshot only while the location is active
-- and unpinned. The Storage operation is deliberately two-phase so a failed
-- object removal can be retried without losing the metadata or unlocking slot.
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS image_deletion_requested_at timestamptz,
    ADD COLUMN IF NOT EXISTS image_deletion_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS locations_image_deletion_pending_idx
    ON public.locations (image_deletion_requested_at)
    WHERE image_deletion_requested_at IS NOT NULL;

-- A pinned location is immovable for everyone, including administrators.
-- Text/description edits remain available to admins; coordinate changes require
-- a separate unpin operation first. The image-deletion flags can only be
-- managed through the dedicated SECURITY DEFINER RPCs below.
CREATE OR REPLACE FUNCTION private.guard_player_location_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_delete_begin', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_delete_finalize', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_image_delete_begin', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_image_delete_finalize', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zmienić znajdźkę.' USING ERRCODE = '42501';
    END IF;

    IF (COALESCE(OLD.is_pinned, false) OR COALESCE(NEW.is_pinned, false))
       AND (
            NEW.game_x IS DISTINCT FROM OLD.game_x
            OR NEW.game_y IS DISTINCT FROM OLD.game_y
            OR NEW.game_z IS DISTINCT FROM OLD.game_z
       ) THEN
        RAISE EXCEPTION 'Przypięta pinezka jest zablokowana przed przesuwaniem. Administrator musi ją najpierw odpiąć.'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.image_deletion_requested_at IS NOT NULL
       AND (
            NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
            OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
            OR NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at
       ) THEN
        RAISE EXCEPTION 'Trwa usuwanie zdjęcia tej znajdźki. Poczekaj na zakończenie operacji przed przypinaniem, archiwizacją lub usuwaniem pinezki.'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.image_deletion_requested_at IS DISTINCT FROM OLD.image_deletion_requested_at
       OR NEW.image_deletion_requested_by IS DISTINCT FROM OLD.image_deletion_requested_by THEN
        RAISE EXCEPTION 'Stan usuwania zdjęcia może być zmieniany wyłącznie przez zabezpieczoną operację galerii.'
            USING ERRCODE = '42501';
    END IF;

    IF private.is_admin() THEN
        RETURN NEW;
    END IF;

    IF OLD.created_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Możesz edytować wyłącznie własną znajdźkę.' USING ERRCODE = '42501';
    END IF;

    IF OLD.is_pinned OR OLD.is_archived OR OLD.deletion_requested_at IS NOT NULL THEN
        RAISE EXCEPTION 'Zatwierdzona, zarchiwizowana lub usuwana pinezka nie może być edytowana przez gracza.' USING ERRCODE = '42501';
    END IF;

    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
       OR NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at
       OR NEW.deletion_requested_by IS DISTINCT FROM OLD.deletion_requested_by THEN
        RAISE EXCEPTION 'Tych pól nie można zmieniać w edycji gracza.' USING ERRCODE = '42501';
    END IF;

    IF NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
       AND NOT (
            pg_catalog.current_setting('sa_event_maps.location_pin_approval', true) = 'on'
            AND NEW.is_pinned = true
       ) THEN
        RAISE EXCEPTION 'Przypięcie pinezki musi przejść przez potwierdzenie zatwierdzenia. Gracz nie może jej później odpiąć.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_player_location_changes() FROM PUBLIC, anon, authenticated;

-- Storage DELETE is allowed to admins as before, and to the location owner
-- only while their dedicated image-delete request is pending. The existing
-- whole-location deletion flow remains supported as a second owner path.
CREATE OR REPLACE FUNCTION private.can_delete_location_screenshot_object(p_object_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT auth.uid() IS NOT NULL
       AND COALESCE(p_object_path, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
       AND EXISTS (
            SELECT 1
              FROM public.locations AS location_row
             WHERE location_row.id::text = pg_catalog.split_part(p_object_path, '/', 1)
               AND (
                    private.is_admin()
                    OR (
                        location_row.created_by = auth.uid()
                        AND location_row.is_pinned = false
                        AND location_row.is_archived = false
                        AND (
                            (
                                location_row.deletion_requested_at IS NOT NULL
                                AND location_row.deletion_requested_by = auth.uid()
                            )
                            OR (
                                location_row.image_deletion_requested_at IS NOT NULL
                                AND location_row.image_deletion_requested_by = auth.uid()
                                AND EXISTS (
                                    SELECT 1
                                      FROM public.location_images AS image_row
                                     WHERE image_row.location_id = location_row.id
                                       AND image_row.object_path = p_object_path
                                )
                            )
                        )
                    )
               )
       );
$function$;

REVOKE ALL ON FUNCTION private.can_delete_location_screenshot_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_delete_location_screenshot_object(text) TO authenticated;

DROP POLICY IF EXISTS location_screenshots_location_owner_delete ON storage.objects;
CREATE POLICY location_screenshots_location_owner_delete
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'location-screenshots'
    AND private.can_delete_location_screenshot_object(name)
);

-- Begin phase: serialize against pin/unpin and full-location deletion, lock
-- the image slot, and return its exact Storage object path for the API call.
CREATE OR REPLACE FUNCTION public.begin_location_image_deletion(p_image_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_image public.location_images%ROWTYPE;
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby usunąć zdjęcie.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();

    SELECT * INTO v_image
      FROM public.location_images AS image_row
     WHERE image_row.id = p_image_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono zdjęcia.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = v_image.location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono lokalizacji przypisanej do zdjęcia.' USING ERRCODE = 'P0002';
    END IF;

    -- Re-read the image after acquiring the location lock so an administrator
    -- or another request cannot race a change to the metadata row.
    SELECT * INTO v_image
      FROM public.location_images AS image_row
     WHERE image_row.id = p_image_id
       AND image_row.location_id = v_location.id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Zdjęcie zostało już usunięte.' USING ERRCODE = 'P0002';
    END IF;

    IF v_location.deletion_requested_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ta pinezka jest już w trakcie trwałego usuwania. Dokończ najpierw usuwanie pinezki.' USING ERRCODE = '55000';
    END IF;

    IF NOT v_is_admin AND (
        v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
    ) THEN
        RAISE EXCEPTION 'Możesz usunąć zdjęcie wyłącznie z własnej, nieprzypiętej i niearchiwalnej pinezki. Archiwizacja zdjęć pozostaje uprawnieniem administratora.'
            USING ERRCODE = '42501';
    END IF;

    IF v_location.image_deletion_requested_at IS NOT NULL
       AND v_location.image_deletion_requested_by IS DISTINCT FROM auth.uid()
       AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Usuwanie zdjęcia zostało już rozpoczęte przez inną osobę. Dokończyć je może administrator lub osoba, która rozpoczęła operację.'
            USING ERRCODE = '55000';
    END IF;

    IF v_location.image_deletion_requested_at IS NULL
       OR (v_is_admin AND v_location.image_deletion_requested_by IS DISTINCT FROM auth.uid()) THEN
        PERFORM pg_catalog.set_config('sa_event_maps.location_image_delete_begin', 'on', true);
        UPDATE public.locations
           SET image_deletion_requested_at = pg_catalog.now(),
               image_deletion_requested_by = auth.uid()
         WHERE id = v_location.id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'image_id', v_image.id,
        'location_id', v_location.id,
        'object_path', v_image.object_path,
        'deletion_pending', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_location_image_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_location_image_deletion(uuid) TO authenticated;

-- Finalize phase: metadata deletion and slot unlock are atomic. If Storage
-- removal fails, the pending marker remains and the same operation is retryable.
CREATE OR REPLACE FUNCTION public.finalize_location_image_deletion(p_image_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_image public.location_images%ROWTYPE;
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zakończyć usuwanie zdjęcia.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();

    SELECT * INTO v_image
      FROM public.location_images AS image_row
     WHERE image_row.id = p_image_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('deleted', true, 'already_deleted', true);
    END IF;

    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = v_image.location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono lokalizacji przypisanej do zdjęcia.' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_image
      FROM public.location_images AS image_row
     WHERE image_row.id = p_image_id
       AND image_row.location_id = v_location.id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('deleted', true, 'already_deleted', true);
    END IF;

    IF v_location.image_deletion_requested_at IS NULL THEN
        RAISE EXCEPTION 'Nie rozpoczęto zabezpieczonego usuwania tego zdjęcia.' USING ERRCODE = '55000';
    END IF;

    IF NOT v_is_admin AND (
        v_location.image_deletion_requested_by IS DISTINCT FROM auth.uid()
        OR v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
        OR v_location.deletion_requested_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Nie masz uprawnień do zakończenia usuwania tego zdjęcia.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.set_config('sa_event_maps.location_image_delete_finalize', 'on', true);
    DELETE FROM public.location_images WHERE id = p_image_id;
    UPDATE public.locations
       SET image_deletion_requested_at = NULL,
           image_deletion_requested_by = NULL,
           updated_at = pg_catalog.now()
     WHERE id = v_location.id;

    RETURN pg_catalog.jsonb_build_object(
        'deleted', true,
        'image_id', p_image_id,
        'location_id', v_location.id
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_location_image_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_location_image_deletion(uuid) TO authenticated;

COMMIT;
