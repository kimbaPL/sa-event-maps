BEGIN;

-- Server-only lookup of physical screenshot objects owned by an Auth user.
-- The manage-access Edge Function uses this to find files even when the
-- location_images.uploaded_by metadata does not match Storage owner_id.
CREATE OR REPLACE FUNCTION public.admin_list_user_location_screenshot_objects(
    p_user_id uuid
)
RETURNS TABLE (object_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT object_row.name::text
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'location-screenshots'
      AND object_row.owner_id = p_user_id::text
    ORDER BY object_row.name;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_user_location_screenshot_objects(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_user_location_screenshot_objects(uuid)
    TO service_role;

COMMENT ON FUNCTION public.admin_list_user_location_screenshot_objects(uuid) IS
    'Server-only helper for account deletion: lists location screenshot objects by their actual Storage owner_id.';

COMMIT;
