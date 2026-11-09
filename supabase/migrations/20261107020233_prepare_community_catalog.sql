BEGIN;

-- Preserve the area information used by the application.
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS area text
    NOT NULL DEFAULT 'Nie określono';


-- Archived events are visible only to administrators.
DROP POLICY IF EXISTS events_read_authenticated
ON public.events;

CREATE POLICY events_read_authenticated
ON public.events
FOR SELECT
TO authenticated
USING (
    status <> 'archived'
    OR (SELECT private.is_admin())
);

COMMIT;
