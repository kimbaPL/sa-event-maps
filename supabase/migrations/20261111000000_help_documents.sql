BEGIN;

-- Editable help-center documents managed from the administrator workspace.
-- Markdown is stored as text; the frontend renders a safe, limited subset.
CREATE TABLE public.help_document_sections (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    document_type text NOT NULL
        CHECK (document_type IN ('instructions', 'rules')),
    title text NOT NULL
        CHECK (pg_catalog.char_length(pg_catalog.btrim(title)) BETWEEN 1 AND 160),
    content text NOT NULL DEFAULT ''
        CHECK (pg_catalog.char_length(content) <= 40000),
    sort_order integer NOT NULL DEFAULT 0
        CHECK (sort_order BETWEEN 0 AND 1000000),
    is_published boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX help_document_sections_public_order_idx
    ON public.help_document_sections (document_type, is_published, sort_order, created_at);

ALTER TABLE public.help_document_sections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.help_document_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.help_document_sections TO authenticated;

CREATE POLICY help_document_sections_read_published_or_admin
    ON public.help_document_sections
    FOR SELECT TO authenticated
    USING (is_published = true OR private.is_admin());

CREATE POLICY help_document_sections_insert_admin
    ON public.help_document_sections
    FOR INSERT TO authenticated
    WITH CHECK (private.is_admin());

CREATE POLICY help_document_sections_update_admin
    ON public.help_document_sections
    FOR UPDATE TO authenticated
    USING (private.is_admin())
    WITH CHECK (private.is_admin());

CREATE POLICY help_document_sections_delete_admin
    ON public.help_document_sections
    FOR DELETE TO authenticated
    USING (private.is_admin());

CREATE OR REPLACE FUNCTION private.touch_help_document_section()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    NEW.updated_at := pg_catalog.now();
    NEW.updated_by := auth.uid();
    IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
        NEW.created_by := auth.uid();
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.touch_help_document_section() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER help_document_sections_touch_updated_at
    BEFORE INSERT OR UPDATE ON public.help_document_sections
    FOR EACH ROW EXECUTE FUNCTION private.touch_help_document_section();

COMMENT ON TABLE public.help_document_sections IS
    'Editable instructions and community rules displayed in the SA Event Maps help center.';
COMMENT ON COLUMN public.help_document_sections.content IS
    'Plain Markdown source. The frontend renders a safe limited subset and does not execute HTML.';

-- First-time content: instructions are published as a useful starting guide.
-- Rules are saved as unpublished drafts so the project owner can review/edit them
-- before they become visible to players.
INSERT INTO public.help_document_sections
    (document_type, title, content, sort_order, is_published)
VALUES
(
    'instructions',
    'Wprowadzenie do SA Event Maps',
    $$SA Event Maps to wspólny katalog lokalizacji i narzędzie pomocnicze do wydarzeń w MTA: San Andreas.

Po lewej stronie znajdziesz główne obszary aplikacji: **Mapa**, **Katalog znajdziek**, **Zarządzanie eventami** oraz **Instrukcje i Regulamin**. Dostępne czynności zależą od Twoich uprawnień.

Dane lokalizacji są wspólne dla organizacji, natomiast osobiste oznaczenia postępu należą do zalogowanego użytkownika.$$,
    10,
    true
),
(
    'instructions',
    'Wydarzenia a „Wszystkie respy”',
    $$Te dwa widoki służą do różnych celów i mają **oddzielne postępy**.

- **Wydarzenie** — wybierasz konkretny event i zapisujesz swoje oznaczenia w jego kontekście. Ukończenie jednego wydarzenia nie wymaga czyszczenia jego postępu przed rozpoczęciem następnego.
- **Wszystkie respy** — to ogólny katalog pomocny przy wyszukiwaniu lokalizacji i przygotowywaniu się do kolejnych wydarzeń. Oznaczenia zapisane tutaj są osobiste i nie zmieniają postępu w żadnym wydarzeniu.

Ta sama lokalizacja może występować w wielu wydarzeniach. Jej nazwa, opis, współrzędne i zdjęcie opisują wspólną pinezkę, a postęp pozostaje zależny od wybranego widoku.$$,
    20,
    true
),
(
    'instructions',
    'Znaczenie statusów znajdziek',
    $$Statusy pomagają zapisywać aktualny stan poszukiwań:

- **Nieznaleziona** — nie została jeszcze przez Ciebie odnaleziona. To domyślny status.
- **Znaleziono** — potwierdzasz, że udało Ci się ją znaleźć.
- **Nie ma** — oznaczasz, że w sprawdzonym miejscu znajdźki nie było.
- **Niepewne** — lokalizacja lub informacja wymaga dodatkowego potwierdzenia.
- **Do sprawdzenia** — dodatkowe oznaczenie przypominające, że warto ponownie zweryfikować tę lokalizację. Może być używane razem z wybranym statusem.

Statusy są Twoimi osobistymi notatkami. Nie zmieniają wspólnej pinezki ani oznaczeń innych graczy.$$,
    30,
    true
),
(
    'instructions',
    'Resetowanie postępów w „Wszystkich respach”',
    $$Opcja **„Usuń wszystkie postępy”** jest dostępna w katalogu „Wszystkie respy”. Przydaje się, gdy zaczynasz poszukiwania od nowa, na przykład przed kolejnym wydarzeniem.

Po potwierdzeniu operacji usuwane są wyłącznie Twoje osobiste oznaczenia w katalogu „Wszystkie respy”, w tym statusy oraz znacznik „Do sprawdzenia”.

**Ta operacja nie usuwa** pinezek, zdjęć, opisów ani kategorii. Nie zmienia również postępów zapisanych w poszczególnych wydarzeniach ani danych innych graczy.

Przed wykonaniem operacji aplikacja prosi o potwierdzenie. Po zatwierdzeniu resetu nie można go cofnąć. Jeśli nie masz pewności, wybierz „Anuluj”. $$,
    40,
    true
),
(
    'instructions',
    'Wspólne pinezki i edytowanie lokalizacji',
    $$Lokalizacje tworzą wspólny katalog organizacji. Nowa pinezka dodana do katalogu jest widoczna również dla pozostałych użytkowników.

Gracz może edytować własną lokalizację, o ile nie jest ona przypięta ani zarchiwizowana. Administrator może zarządzać lokalizacjami zgodnie z uprawnieniami panelu administracyjnego.

Przed dodaniem nowej pinezki sprawdź, czy podobna lokalizacja już istnieje. W opisie umieszczaj informacje, które ułatwią innym rozpoznanie miejsca.$$,
    50,
    true
),
(
    'instructions',
    'Zdjęcia znajdziek',
    $$Do lokalizacji można dołączyć jedno zdjęcie. Jest ono przypisane do wspólnej pinezki, więc będzie takie samo we wszystkich wydarzeniach, w których ta lokalizacja występuje.

Zdjęcie można otworzyć w większym podglądzie. Aplikacja automatycznie przygotowuje przesyłany obraz do odpowiedniego formatu i rozmiaru.

Możliwość dodawania zdjęć przez graczy może zostać wyłączona w ustawieniach globalnych przez administratora. Zablokowanie nowych wysyłek nie ukrywa zdjęć już zapisanych. Archiwizowanie, przywracanie i trwałe usuwanie zdjęć jest dostępne w panelu administracyjnym.$$,
    60,
    true
),
(
    'rules',
    'Rzetelność informacji',
    $$**Projekt regulaminu — do sprawdzenia i zatwierdzenia przez właściciela projektu.**

Dodawaj lokalizacje i opisy zgodne z tym, co rzeczywiście udało Ci się ustalić. Nie twórz celowo błędnych wpisów, nie oznaczaj przypuszczeń jako potwierdzonych informacji i przed dodaniem pinezki sprawdź, czy nie ma już takiej lokalizacji.

W przypadku wątpliwości użyj statusu „Niepewne” lub „Do sprawdzenia” zamiast przedstawiać niepotwierdzoną informację jako pewnik.$$,
    10,
    false
),
(
    'rules',
    'Wspólny katalog i cudze dane',
    $$**Projekt regulaminu — do sprawdzenia i zatwierdzenia przez właściciela projektu.**

Pamiętaj, że pinezki, opisy i zdjęcia tworzą wspólny katalog organizacji. Nie zmieniaj ani nie usuwaj cudzych lokalizacji bez odpowiednich uprawnień. Nie próbuj obchodzić ograniczeń przypisanych do konta.

Osobiste statusy służą do własnego śledzenia poszukiwań. Nie należy wykorzystywać ich do wprowadzania innych użytkowników w błąd.$$,
    20,
    false
),
(
    'rules',
    'Konto i dostęp do platformy',
    $$**Projekt regulaminu — do sprawdzenia i zatwierdzenia przez właściciela projektu.**

Korzystaj z własnego konta i nie udostępniaj innym osobom danych logowania. Nie próbuj uzyskiwać dostępu do panelu administracyjnego ani danych, do których Twoje konto nie ma uprawnień.

W razie problemów z dostępem lub zauważenia nieprawidłowości skontaktuj się z organizatorem.$$,
    30,
    false
),
(
    'rules',
    'Zdjęcia i publikowane treści',
    $$**Projekt regulaminu — do sprawdzenia i zatwierdzenia przez właściciela projektu.**

Dodawaj wyłącznie materiały związane z lokalizacją i korzystaniem z mapy. Nie umieszczaj w opisach ani na zdjęciach prywatnych danych, haseł, tokenów lub innych informacji, które nie powinny być publicznie udostępniane w organizacji.

Administrator może moderować treści i zarządzać zdjęciami zgodnie z uprawnieniami platformy.$$,
    40,
    false
);

CREATE OR REPLACE FUNCTION private.organization_backup_validate_help_documents(p_backup jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
BEGIN
    PERFORM private.organization_backup_validate_catalog_progress(p_backup);
    v_data := p_backup -> 'data';

    IF v_data ? 'help_document_sections'
       AND pg_catalog.jsonb_typeof(v_data -> 'help_document_sections') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Kopia zawiera nieprawidłową listę rozdziałów instrukcji i regulaminu.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
            COALESCE(v_data -> 'help_document_sections', '[]'::jsonb)
        ) AS source_row(value)
        WHERE COALESCE(source_row.value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR COALESCE(source_row.value ->> 'document_type', '') NOT IN ('instructions', 'rules')
           OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(source_row.value ->> 'title', ''))) NOT BETWEEN 1 AND 160
           OR pg_catalog.char_length(COALESCE(source_row.value ->> 'content', '')) > 40000
           OR COALESCE(source_row.value ->> 'sort_order', '') !~ '^[0-9]{1,7}$'
           OR (source_row.value ? 'is_published'
               AND pg_catalog.jsonb_typeof(source_row.value -> 'is_published') IS DISTINCT FROM 'boolean')
           OR (source_row.value ? 'created_by'
               AND source_row.value -> 'created_by' <> 'null'::jsonb
               AND COALESCE(source_row.value ->> 'created_by', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
           OR (source_row.value ? 'updated_by'
               AND source_row.value -> 'updated_by' <> 'null'::jsonb
               AND COALESCE(source_row.value ->> 'updated_by', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera rozdział instrukcji lub regulaminu z nieprawidłowymi danymi.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT source_row.value ->> 'id'
        FROM pg_catalog.jsonb_array_elements(
            COALESCE(v_data -> 'help_document_sections', '[]'::jsonb)
        ) AS source_row(value)
        GROUP BY source_row.value ->> 'id'
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Kopia zawiera powtórzone identyfikatory rozdziałów.'
            USING ERRCODE = '22023';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.organization_backup_validate_help_documents(jsonb)
    FROM PUBLIC, anon, authenticated;

-- Extend the currently deployed export function while keeping snapshots
-- created before this feature valid.
ALTER FUNCTION public.admin_export_organization_backup()
    RENAME TO admin_export_organization_backup_without_help_documents;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup_without_help_documents()
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_export_organization_backup()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_backup jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Pełna kopia organizacji jest dostępna wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    v_backup := public.admin_export_organization_backup_without_help_documents();

    RETURN pg_catalog.jsonb_set(
        v_backup,
        '{data,help_document_sections}',
        COALESCE((
            SELECT pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(section_row)
                ORDER BY section_row.document_type, section_row.sort_order, section_row.created_at, section_row.id
            )
            FROM public.help_document_sections AS section_row
        ), '[]'::jsonb),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_export_organization_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_export_organization_backup() TO authenticated;

ALTER FUNCTION public.admin_preview_organization_backup(jsonb)
    RENAME TO admin_preview_organization_backup_without_help_documents;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup_without_help_documents(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_preview_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_result jsonb;
    v_sections_count integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Podgląd kopii jest dostępny wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_help_documents(p_backup);
    v_data := p_backup -> 'data';
    v_sections_count := pg_catalog.jsonb_array_length(
        COALESCE(v_data -> 'help_document_sections', '[]'::jsonb)
    );

    v_result := public.admin_preview_organization_backup_without_help_documents(p_backup);
    v_result := pg_catalog.jsonb_set(
        v_result,
        '{counts,help_document_sections}',
        pg_catalog.to_jsonb(v_sections_count),
        true
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_preview_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_organization_backup(jsonb) TO authenticated;

ALTER FUNCTION public.admin_restore_organization_backup(jsonb)
    RENAME TO admin_restore_organization_backup_without_help_documents;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup_without_help_documents(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_restore_organization_backup(p_backup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_data jsonb;
    v_user_map jsonb;
    v_result jsonb;
    v_sections_count integer := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_admin() THEN
        RAISE EXCEPTION 'Przywracanie kopii jest dostępne wyłącznie dla administratora.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM private.organization_backup_validate_help_documents(p_backup);
    v_data := p_backup -> 'data';
    v_user_map := private.organization_backup_user_map(v_data -> 'accounts');

    LOCK TABLE public.help_document_sections IN SHARE ROW EXCLUSIVE MODE;

    -- The previous restore wrapper restores the rest of the organization and
    -- catalog progress in the same transaction. Older backups without this
    -- key leave the currently stored documents untouched.
    v_result := public.admin_restore_organization_backup_without_help_documents(p_backup);

    IF v_data ? 'help_document_sections' THEN
        INSERT INTO public.help_document_sections AS current_row (
            id, document_type, title, content, sort_order, is_published,
            created_by, updated_by, created_at, updated_at
        )
        SELECT
            (source_row.value ->> 'id')::uuid,
            source_row.value ->> 'document_type',
            source_row.value ->> 'title',
            COALESCE(source_row.value ->> 'content', ''),
            (source_row.value ->> 'sort_order')::integer,
            COALESCE((source_row.value ->> 'is_published')::boolean, false),
            COALESCE(
                private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'created_by', '')::uuid, v_user_map),
                auth.uid()
            ),
            COALESCE(
                private.organization_backup_map_user_id(NULLIF(source_row.value ->> 'updated_by', '')::uuid, v_user_map),
                auth.uid()
            ),
            COALESCE(NULLIF(source_row.value ->> 'created_at', '')::timestamptz, pg_catalog.now()),
            COALESCE(NULLIF(source_row.value ->> 'updated_at', '')::timestamptz, pg_catalog.now())
        FROM pg_catalog.jsonb_array_elements(v_data -> 'help_document_sections') AS source_row(value)
        ON CONFLICT (id) DO UPDATE SET
            document_type = EXCLUDED.document_type,
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            sort_order = EXCLUDED.sort_order,
            is_published = EXCLUDED.is_published,
            created_by = EXCLUDED.created_by,
            updated_by = EXCLUDED.updated_by,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at;

        GET DIAGNOSTICS v_sections_count = ROW_COUNT;
    END IF;

    RETURN v_result || pg_catalog.jsonb_build_object(
        'help_document_sections_processed', v_sections_count
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_restore_organization_backup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_organization_backup(jsonb) TO authenticated;

COMMIT;
