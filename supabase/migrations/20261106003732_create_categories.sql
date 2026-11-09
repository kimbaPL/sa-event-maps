
-- =========================================================
-- MIGRATION: CREATE CATEGORIES
-- Interaktywna mapa MTA
-- =========================================================

BEGIN;

-- 1. Tabela kategorii
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    name text NOT NULL,
    description text,
    color text,
    icon text,

    sort_order integer NOT NULL DEFAULT 0,
    is_archived boolean NOT NULL DEFAULT false,

    created_by uuid DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT categories_name_not_blank
        CHECK (length(btrim(name)) > 0)
);

-- 2. Aktywne kategorie muszą mieć unikalne nazwy
CREATE UNIQUE INDEX categories_name_active_unique_idx
ON public.categories (lower(btrim(name)))
WHERE is_archived = false;

-- 3. Indeks kolejności wyświetlania
CREATE INDEX categories_active_sort_idx
ON public.categories (sort_order, name)
WHERE is_archived = false;

-- 4. Automatyczna aktualizacja updated_at
CREATE OR REPLACE FUNCTION public.set_categories_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER categories_set_updated_at
BEFORE UPDATE ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.set_categories_updated_at();

-- 5. Dodanie kategorii do lokalizacji wydarzeń
ALTER TABLE public.event_locations
ADD COLUMN category_id uuid NULL;

ALTER TABLE public.event_locations
ADD CONSTRAINT event_locations_category_id_fkey
FOREIGN KEY (category_id)
REFERENCES public.categories(id)
ON DELETE RESTRICT;

-- 6. Indeks powiązania kategorii z lokalizacjami
CREATE INDEX event_locations_category_id_idx
ON public.event_locations(category_id);

-- 7. Zabezpieczenie przed przypisywaniem
-- kategorii zarchiwizowanych lub nieistniejących
CREATE OR REPLACE FUNCTION public.check_event_location_category_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN

        IF NEW.category_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM public.categories c
            WHERE c.id = NEW.category_id
              AND c.is_archived = false
        ) THEN
            RAISE EXCEPTION
                'Nie można przypisać kategorii, która nie istnieje lub jest zarchiwizowana.'
                USING ERRCODE = '23514';
        END IF;

    ELSIF TG_OP = 'UPDATE' THEN

        IF NEW.category_id IS DISTINCT FROM OLD.category_id
           AND NEW.category_id IS NOT NULL
           AND NOT EXISTS (
                SELECT 1
                FROM public.categories c
                WHERE c.id = NEW.category_id
                  AND c.is_archived = false
           ) THEN
            RAISE EXCEPTION
                'Nie można przypisać kategorii, która nie istnieje lub jest zarchiwizowana.'
                USING ERRCODE = '23514';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER event_locations_check_category
BEFORE INSERT OR UPDATE OF category_id
ON public.event_locations
FOR EACH ROW
EXECUTE FUNCTION public.check_event_location_category_active();

-- 8. Włączenie RLS dla kategorii
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- 9. Uprawnienia do tabeli kategorii
REVOKE ALL PRIVILEGES ON TABLE public.categories
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.categories
TO authenticated;

GRANT ALL PRIVILEGES
ON TABLE public.categories
TO service_role;

-- 10. Odczyt kategorii przez zalogowanych użytkowników
CREATE POLICY categories_read_authenticated
ON public.categories
FOR SELECT
TO authenticated
USING (
    NOT is_archived
    OR (SELECT private.is_admin())
);

-- 11. Tworzenie kategorii tylko przez administratora
CREATE POLICY categories_insert_admin
ON public.categories
FOR INSERT
TO authenticated
WITH CHECK (
    (SELECT private.is_admin())
    AND created_by = (SELECT auth.uid())
);

-- 12. Edycja kategorii tylko przez administratora
CREATE POLICY categories_update_admin
ON public.categories
FOR UPDATE
TO authenticated
USING (
    (SELECT private.is_admin())
)
WITH CHECK (
    (SELECT private.is_admin())
);

-- 13. Zmiana istniejącej polityki dodawania lokalizacji
-- Zwykli gracze mogą dodawać lokalizacje bez kategorii.
-- Przypisywanie kategorii jest zarezerwowane dla administratora.

DROP POLICY IF EXISTS event_locations_insert_authenticated
ON public.event_locations;

CREATE POLICY event_locations_insert_authenticated
ON public.event_locations
FOR INSERT
TO authenticated
WITH CHECK (
    added_by = (SELECT auth.uid())

    AND EXISTS (
        SELECT 1
        FROM public.locations l
        WHERE l.id = event_locations.location_id
          AND l.is_archived = false
    )

    AND EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = event_locations.event_id
          AND e.status <> 'archived'
    )

    AND (
        category_id IS NULL
        OR (
            (SELECT private.is_admin())
            AND EXISTS (
                SELECT 1
                FROM public.categories c
                WHERE c.id = event_locations.category_id
                  AND c.is_archived = false
            )
        )
    )
);

-- 14. Zmiana przypisanej kategorii tylko przez administratora
CREATE POLICY event_locations_update_admin
ON public.event_locations
FOR UPDATE
TO authenticated
USING (
    (SELECT private.is_admin())
)
WITH CHECK (
    (SELECT private.is_admin())
);

-- Prawo do aktualizacji kolumny kategorii.
-- RLS nadal ogranicza operację do administratora.
GRANT UPDATE (category_id)
ON TABLE public.event_locations
TO authenticated;

COMMIT;

-- =========================================================
-- KONIEC MIGRACJI
-- =========================================================
