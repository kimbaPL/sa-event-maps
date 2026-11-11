-- SA Event Maps: final community ownership flow for shared locations.
-- Owners may submit/pin their own unpinned locations and permanently delete
-- only their own unpinned locations. Administrators retain full control.
-- Location deletion uses a two-phase Storage + database operation so that
-- private screenshot objects are removed through the Storage API, not SQL.

BEGIN;

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS deletion_requested_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS locations_deletion_pending_idx
    ON public.locations (deletion_requested_at)
    WHERE deletion_requested_at IS NOT NULL;

-- Prevent a pending deletion from being edited, reassigned, given new progress,
-- or receiving a new screenshot while the Storage object is being removed.
CREATE OR REPLACE FUNCTION private.guard_location_deletion_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location_id uuid;
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on' THEN
        IF TG_TABLE_NAME = 'locations' AND TG_OP = 'UPDATE' THEN
            NEW.deletion_requested_at := NULL;
            NEW.deletion_requested_by := NULL;
        END IF;
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF pg_catalog.current_setting('sa_event_maps.location_delete_finalize', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_delete_cancel', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.admin_event_delete', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'locations' THEN
        IF TG_OP = 'DELETE' THEN
            v_location_id := OLD.id;
        ELSE
            v_location_id := NEW.id;
        END IF;

        IF TG_OP = 'UPDATE' AND OLD.deletion_requested_at IS NOT NULL THEN
            RAISE EXCEPTION 'Ta pinezka jest w trakcie trwałego usuwania. Ponów usuwanie lub skontaktuj się z administratorem.'
                USING ERRCODE = '55000';
        END IF;
    ELSE
        IF TG_OP = 'UPDATE' THEN
            -- KEY SHARE serializes child-row writes against begin_location_deletion's
            -- FOR UPDATE lock. A write already in flight finishes before the
            -- deletion plan is measured; a later write sees the pending flag.
            PERFORM 1
              FROM public.locations AS location_row
             WHERE location_row.id IN (OLD.location_id, NEW.location_id)
               AND location_row.deletion_requested_at IS NOT NULL
             FOR KEY SHARE;
            IF FOUND THEN
                RAISE EXCEPTION 'Ta pinezka jest w trakcie trwałego usuwania. Zmiana powiązanych danych jest chwilowo zablokowana.'
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
            v_location_id := OLD.location_id;
        ELSE
            v_location_id := NEW.location_id;
        END IF;
    END IF;

    IF v_location_id IS NOT NULL THEN
        PERFORM 1
          FROM public.locations AS location_row
         WHERE location_row.id = v_location_id
           AND location_row.deletion_requested_at IS NOT NULL
         FOR KEY SHARE;
        IF FOUND THEN
            RAISE EXCEPTION 'Ta pinezka jest w trakcie trwałego usuwania. Zmiana powiązanych danych jest chwilowo zablokowana.'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS locations_deletion_pending_guard ON public.locations;
CREATE TRIGGER locations_deletion_pending_guard
BEFORE UPDATE OR DELETE ON public.locations
FOR EACH ROW EXECUTE FUNCTION private.guard_location_deletion_pending();

-- Independently enforce the one-way pin/owner contract at the database layer.
-- RLS policies remain the primary row filter; this trigger prevents a direct
-- REST UPDATE from bypassing the approval RPC or changing ownership/lock fields.
CREATE OR REPLACE FUNCTION private.guard_player_location_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('sa_event_maps.organization_backup_restore', true) = 'on'
       OR pg_catalog.current_setting('sa_event_maps.location_delete_begin', true) = 'on' THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zmienić znajdźkę.' USING ERRCODE = '42501';
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

DROP TRIGGER IF EXISTS locations_player_update_guard ON public.locations;
CREATE TRIGGER locations_player_update_guard
BEFORE UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION private.guard_player_location_changes();

DROP TRIGGER IF EXISTS event_locations_deletion_pending_guard ON public.event_locations;
CREATE TRIGGER event_locations_deletion_pending_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.event_locations
FOR EACH ROW EXECUTE FUNCTION private.guard_location_deletion_pending();

DROP TRIGGER IF EXISTS player_progress_deletion_pending_guard ON public.player_progress;
CREATE TRIGGER player_progress_deletion_pending_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.player_progress
FOR EACH ROW EXECUTE FUNCTION private.guard_location_deletion_pending();

DROP TRIGGER IF EXISTS player_catalog_progress_deletion_pending_guard ON public.player_catalog_progress;
CREATE TRIGGER player_catalog_progress_deletion_pending_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.player_catalog_progress
FOR EACH ROW EXECUTE FUNCTION private.guard_location_deletion_pending();

DROP TRIGGER IF EXISTS location_images_deletion_pending_guard ON public.location_images;
CREATE TRIGGER location_images_deletion_pending_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.location_images
FOR EACH ROW EXECUTE FUNCTION private.guard_location_deletion_pending();

-- Upload checks include the pending-deletion flag. This is a fail-closed
-- redefinition of the helper introduced by the screenshot-gallery migration.
CREATE OR REPLACE FUNCTION private.can_upload_location_image(p_location_id_text text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location_id uuid;
    v_allow_players boolean;
    v_location_found boolean := false;
    v_deletion_pending boolean := false;
BEGIN
    IF auth.uid() IS NULL OR COALESCE(p_location_id_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;

    v_location_id := p_location_id_text::uuid;

    -- Serialize Storage uploads with the location-delete lock. During backup
    -- restoration an admin may upload before the location row is reinserted.
    SELECT true, COALESCE(location_row.deletion_requested_at IS NOT NULL, false)
      INTO v_location_found, v_deletion_pending
      FROM public.locations AS location_row
     WHERE location_row.id = v_location_id
     FOR KEY SHARE;
    v_location_found := COALESCE(v_location_found, false);
    v_deletion_pending := COALESCE(v_deletion_pending, false);

    IF v_deletion_pending THEN
        RETURN false;
    END IF;

    IF private.is_admin() THEN
        -- Organization backup restoration uploads its binary objects before
        -- the transactional RPC replaces image metadata. An administrator
        -- must therefore be able to stage a new object even when an older
        -- image for this location still exists. Normal application uploads
        -- remain single-image guarded by get_location_image_upload_state(),
        -- uploadLocationImage(), and can_register_uploaded_location_image().
        -- The deletion-pending check above still blocks staging during delete.
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

    RETURN v_location_found
       AND COALESCE(v_allow_players, true)
       AND EXISTS (
            SELECT 1 FROM public.locations AS location_row
             WHERE location_row.id = v_location_id
               AND location_row.created_by = auth.uid()
               AND location_row.is_pinned = false
               AND location_row.is_archived = false
               AND location_row.deletion_requested_at IS NULL
       );
END;
$function$;

REVOKE ALL ON FUNCTION private.can_upload_location_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_upload_location_image(text) TO authenticated;

-- The Storage upload and metadata registration are two separate requests.
-- The Storage INSERT policy uses can_upload_location_image() while the later
-- location_images INSERT must allow the exact already-uploaded, caller-owned
-- object. This helper prevents that second step from being rejected just
-- because its own Storage object now exists.
CREATE OR REPLACE FUNCTION private.can_register_uploaded_location_image(
    p_location_id_text text,
    p_object_path text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location_id uuid;
    v_is_admin boolean;
    v_allow_players boolean;
    v_location public.locations%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL
       OR COALESCE(p_location_id_text, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(p_object_path, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
       OR pg_catalog.split_part(p_object_path, '/', 1) <> p_location_id_text THEN
        RETURN false;
    END IF;

    v_location_id := p_location_id_text::uuid;
    v_is_admin := private.is_admin();

    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = v_location_id
     FOR KEY SHARE;

    IF NOT FOUND OR v_location.deletion_requested_at IS NOT NULL THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.location_images AS image_row
         WHERE image_row.location_id = v_location_id
    ) THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM storage.objects AS object_row
         WHERE object_row.bucket_id = 'location-screenshots'
           AND object_row.name = p_object_path
           AND object_row.owner_id = auth.uid()::text
    ) THEN
        RETURN false;
    END IF;

    IF v_is_admin THEN
        RETURN true;
    END IF;

    SELECT settings_row.allow_player_image_uploads
      INTO v_allow_players
      FROM public.app_settings AS settings_row
     WHERE settings_row.id = 1;

    RETURN COALESCE(v_allow_players, true)
       AND v_location.created_by = auth.uid()
       AND NOT v_location.is_pinned
       AND NOT v_location.is_archived;
END;
$function$;

REVOKE ALL ON FUNCTION private.can_register_uploaded_location_image(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_register_uploaded_location_image(text, text) TO authenticated;

DROP POLICY IF EXISTS location_images_authenticated_insert ON public.location_images;
CREATE POLICY location_images_authenticated_insert
ON public.location_images FOR INSERT TO authenticated
WITH CHECK (
    uploaded_by = auth.uid()
    AND pg_catalog.split_part(object_path, '/', 1) = location_id::text
    AND private.can_register_uploaded_location_image(location_id::text, object_path)
    AND private.owns_location_image_object(object_path)
);

-- Owners may remove a screenshot only as part of deleting their own
-- unpinned location. Administrators can always remove location screenshots.
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
               AND location_row.deletion_requested_at IS NOT NULL
               AND (
                    private.is_admin()
                    OR (
                        location_row.created_by = auth.uid()
                        AND location_row.is_pinned = false
                        AND location_row.is_archived = false
                        AND location_row.deletion_requested_by = auth.uid()
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

-- Return the exact blast radius before the confirmation dialog is shown.
CREATE OR REPLACE FUNCTION public.get_location_delete_impact(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
    v_event_names jsonb;
    v_assignment_count integer;
    v_event_progress_count integer;
    v_catalog_progress_count integer;
    v_image_count integer;
    v_storage_object_count integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby usunąć znajdźkę.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();
    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono znajdźki.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_is_admin AND (
        v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
    ) THEN
        RAISE EXCEPTION 'Możesz trwale usunąć tylko własną, nieprzypiętą i niearchiwalną znajdźkę. Przypiętą pinezkę może usunąć administrator.'
            USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(event_row.name ORDER BY event_row.name), '[]'::jsonb), COUNT(*)::integer
      INTO v_event_names, v_assignment_count
      FROM public.event_locations AS assignment_row
      JOIN public.events AS event_row ON event_row.id = assignment_row.event_id
     WHERE assignment_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_event_progress_count
      FROM public.player_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_catalog_progress_count
      FROM public.player_catalog_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_image_count
      FROM public.location_images AS image_row
     WHERE image_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_storage_object_count
      FROM storage.objects AS object_row
     WHERE object_row.bucket_id = 'location-screenshots'
       AND pg_catalog.split_part(object_row.name, '/', 1) = p_location_id::text;

    RETURN pg_catalog.jsonb_build_object(
        'location_id', p_location_id,
        'location_name', v_location.name,
        'is_pinned', v_location.is_pinned,
        'is_archived', v_location.is_archived,
        'event_names', v_event_names,
        'assignment_count', v_assignment_count,
        'event_progress_count', v_event_progress_count,
        'catalog_progress_count', v_catalog_progress_count,
        'image_count', v_image_count,
        'storage_object_count', v_storage_object_count,
        'deletion_pending', v_location.deletion_requested_at IS NOT NULL
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_location_delete_impact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_location_delete_impact(uuid) TO authenticated;

-- First phase: atomically authorize and lock the location against further
-- edits/progress/assignments, then return every Storage object under its UUID.
CREATE OR REPLACE FUNCTION public.begin_location_deletion(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
    v_event_names jsonb;
    v_assignment_count integer;
    v_event_progress_count integer;
    v_catalog_progress_count integer;
    v_image_count integer;
    v_storage_paths jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby usunąć znajdźkę.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();
    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono znajdźki.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_is_admin AND (
        v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
    ) THEN
        RAISE EXCEPTION 'Możesz trwale usunąć tylko własną, nieprzypiętą i niearchiwalną znajdźkę. Przypiętą pinezkę może usunąć administrator.'
            USING ERRCODE = '42501';
    END IF;

    IF v_location.deletion_requested_at IS NOT NULL
       AND v_location.deletion_requested_by IS DISTINCT FROM auth.uid()
       AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Trwa już usuwanie tej pinezki przez inną osobę. W razie problemu poproś administratora o dokończenie operacji.'
            USING ERRCODE = '55000';
    END IF;

    IF v_location.deletion_requested_at IS NULL THEN
        PERFORM pg_catalog.set_config('sa_event_maps.location_delete_begin', 'on', true);
        UPDATE public.locations
           SET deletion_requested_at = pg_catalog.now(),
               deletion_requested_by = auth.uid()
         WHERE id = p_location_id;
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(event_row.name ORDER BY event_row.name), '[]'::jsonb), COUNT(*)::integer
      INTO v_event_names, v_assignment_count
      FROM public.event_locations AS assignment_row
      JOIN public.events AS event_row ON event_row.id = assignment_row.event_id
     WHERE assignment_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_event_progress_count
      FROM public.player_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_catalog_progress_count
      FROM public.player_catalog_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;

    SELECT COUNT(*)::integer INTO v_image_count
      FROM public.location_images AS image_row
     WHERE image_row.location_id = p_location_id;

    SELECT COALESCE(pg_catalog.jsonb_agg(object_row.name ORDER BY object_row.name), '[]'::jsonb)
      INTO v_storage_paths
      FROM storage.objects AS object_row
     WHERE object_row.bucket_id = 'location-screenshots'
       AND pg_catalog.split_part(object_row.name, '/', 1) = p_location_id::text;

    RETURN pg_catalog.jsonb_build_object(
        'location_id', p_location_id,
        'location_name', v_location.name,
        'event_names', v_event_names,
        'assignment_count', v_assignment_count,
        'event_progress_count', v_event_progress_count,
        'catalog_progress_count', v_catalog_progress_count,
        'image_count', v_image_count,
        'storage_paths', v_storage_paths
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_location_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_location_deletion(uuid) TO authenticated;

-- Second phase: run only after the Storage API confirms that all objects under
-- the location UUID are gone. Related database records are deleted atomically.
CREATE OR REPLACE FUNCTION public.finalize_location_deletion(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
    v_assignment_count integer;
    v_event_progress_count integer;
    v_catalog_progress_count integer;
    v_image_count integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zakończyć usuwanie znajdźki.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();
    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono znajdźki lub została już usunięta.' USING ERRCODE = 'P0002';
    END IF;

    IF v_location.deletion_requested_at IS NULL THEN
        RAISE EXCEPTION 'Usuwanie nie zostało rozpoczęte. Odśwież widok i spróbuj ponownie.' USING ERRCODE = '55000';
    END IF;

    IF NOT v_is_admin AND (
        v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.deletion_requested_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
    ) THEN
        RAISE EXCEPTION 'Nie masz uprawnień do zakończenia usuwania tej pinezki.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM storage.objects AS object_row
         WHERE object_row.bucket_id = 'location-screenshots'
           AND pg_catalog.split_part(object_row.name, '/', 1) = p_location_id::text
    ) THEN
        RAISE EXCEPTION 'Nie wszystkie pliki zdjęć zostały usunięte z prywatnego Storage. Ponów operację.'
            USING ERRCODE = '55000';
    END IF;

    SELECT COUNT(*)::integer INTO v_assignment_count
      FROM public.event_locations AS assignment_row
     WHERE assignment_row.location_id = p_location_id;
    SELECT COUNT(*)::integer INTO v_event_progress_count
      FROM public.player_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;
    SELECT COUNT(*)::integer INTO v_catalog_progress_count
      FROM public.player_catalog_progress AS progress_row
     WHERE progress_row.location_id = p_location_id;
    SELECT COUNT(*)::integer INTO v_image_count
      FROM public.location_images AS image_row
     WHERE image_row.location_id = p_location_id;

    PERFORM pg_catalog.set_config('sa_event_maps.location_delete_finalize', 'on', true);

    DELETE FROM public.event_locations WHERE location_id = p_location_id;
    DELETE FROM public.player_progress WHERE location_id = p_location_id;
    DELETE FROM public.player_catalog_progress WHERE location_id = p_location_id;
    DELETE FROM public.location_images WHERE location_id = p_location_id;
    DELETE FROM public.locations WHERE id = p_location_id;

    RETURN pg_catalog.jsonb_build_object(
        'deleted', true,
        'location_id', p_location_id,
        'assignments_deleted', v_assignment_count,
        'event_progress_deleted', v_event_progress_count,
        'catalog_progress_deleted', v_catalog_progress_count,
        'image_metadata_deleted', v_image_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_location_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_location_deletion(uuid) TO authenticated;

-- Pinning is intentionally one-way for a player. Only administrators may unpin.
CREATE OR REPLACE FUNCTION public.set_location_pinned(p_location_id uuid, p_pinned boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby zatwierdzić pinezkę.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();
    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono pinezki.' USING ERRCODE = 'P0002';
    END IF;

    IF v_location.is_archived OR v_location.deletion_requested_at IS NOT NULL THEN
        RAISE EXCEPTION 'Nie można zmienić przypięcia zarchiwizowanej pinezki ani pinezki w trakcie usuwania.' USING ERRCODE = '55000';
    END IF;

    IF v_is_admin THEN
        UPDATE public.locations
           SET is_pinned = COALESCE(p_pinned, false),
               updated_at = pg_catalog.now()
         WHERE id = p_location_id;
    ELSE
        IF v_location.created_by IS DISTINCT FROM auth.uid()
           OR v_location.is_pinned
           OR COALESCE(p_pinned, false) IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Możesz przypiąć wyłącznie własną, nieprzypiętą pinezkę. Odpięcie i ponowne zarządzanie należy do administratora.'
                USING ERRCODE = '42501';
        END IF;

        PERFORM pg_catalog.set_config('sa_event_maps.location_pin_approval', 'on', true);
        UPDATE public.locations
           SET is_pinned = true,
               updated_at = pg_catalog.now()
         WHERE id = p_location_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object('id', p_location_id, 'is_pinned', COALESCE(p_pinned, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_location_pinned(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_location_pinned(uuid, boolean) TO authenticated;

-- UI helper: reveal only whether a screenshot occupies the one-image slot and
-- whether the current editor may upload. Archived image metadata remains hidden
-- from players; this RPC reports only availability, not the image or its path.
CREATE OR REPLACE FUNCTION public.get_location_image_upload_state(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_location public.locations%ROWTYPE;
    v_is_admin boolean;
    v_has_image boolean;
    v_enabled boolean;
    v_can_upload boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Zaloguj się, aby sprawdzić możliwość dodania zdjęcia.' USING ERRCODE = '42501';
    END IF;

    v_is_admin := private.is_admin();
    SELECT * INTO v_location
      FROM public.locations AS location_row
     WHERE location_row.id = p_location_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nie znaleziono znajdźki.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_is_admin AND (
        v_location.created_by IS DISTINCT FROM auth.uid()
        OR v_location.is_pinned
        OR v_location.is_archived
    ) THEN
        RAISE EXCEPTION 'Możesz zarządzać zdjęciem wyłącznie we własnej, nieprzypiętej znajdźce.' USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.location_images AS image_row
         WHERE image_row.location_id = p_location_id
    ) OR EXISTS (
        SELECT 1 FROM storage.objects AS object_row
         WHERE object_row.bucket_id = 'location-screenshots'
           AND pg_catalog.split_part(object_row.name, '/', 1) = p_location_id::text
    ) INTO v_has_image;

    SELECT COALESCE(settings_row.allow_player_image_uploads, true)
      INTO v_enabled
      FROM public.app_settings AS settings_row
     WHERE settings_row.id = 1;

    v_can_upload := NOT v_has_image
        AND v_location.deletion_requested_at IS NULL
        AND (v_is_admin OR (v_enabled AND v_location.created_by = auth.uid() AND NOT v_location.is_pinned AND NOT v_location.is_archived));

    RETURN pg_catalog.jsonb_build_object(
        'has_image', v_has_image,
        'can_upload', COALESCE(v_can_upload, false),
        'player_uploads_enabled', COALESCE(v_enabled, true),
        'is_admin', v_is_admin,
        'deletion_pending', v_location.deletion_requested_at IS NOT NULL
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_location_image_upload_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_location_image_upload_state(uuid) TO authenticated;

-- Deleting an event removes only its own assignments and per-event player
-- progress. Global locations, screenshots and catalog progress remain intact.
CREATE OR REPLACE FUNCTION public.admin_delete_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Trwałe usuwanie wydarzeń jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
      FROM public.events AS event_row
     WHERE event_row.id = p_event_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- This admin-only transaction may remove event rows even when one of its
    -- locations is concurrently pending deletion. The global location delete
    -- will still clean any remaining references before deleting that location.
    PERFORM pg_catalog.set_config('sa_event_maps.admin_event_delete', 'on', true);

    DELETE FROM public.player_progress
     WHERE event_id = p_event_id;

    DELETE FROM public.event_locations
     WHERE event_id = p_event_id;

    DELETE FROM public.events
     WHERE id = p_event_id;

    RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated;

COMMIT;
