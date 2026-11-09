SET local check_function_bodies = off;

CREATE SCHEMA "private";

CREATE TABLE "public"."activity_log" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "actor_id"    uuid,
  "entity_type" text                     NOT NULL,
  "entity_id"   uuid                     NOT NULL,
  "action"      text                     NOT NULL,
  "old_data"    jsonb,
  "new_data"    jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "activity_log_action_check"
    CHECK
    ((action = ANY (ARRAY['created'::text, 'updated'::text, 'pinned'::text, 'unpinned'::text, 'archived'::text, 'restored'::text, 'linked_to_event'::text,
    'unlinked_from_event'::text, 'deleted'::text]))),
  CONSTRAINT "activity_log_entity_type_check" CHECK ((entity_type = ANY (ARRAY['location'::text, 'event'::text, 'event_location'::text]))),
  CONSTRAINT "activity_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."activity_log"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."activity_log" FROM "anon";

CREATE TABLE "public"."event_locations" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "event_id"    uuid                     NOT NULL,
  "location_id" uuid                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "event_locations_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_locations_unique" UNIQUE (event_id, location_id),
  "added_by"    uuid                     DEFAULT auth.uid()
);

ALTER TABLE "public"."event_locations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_locations" FROM "anon";

CREATE TABLE "public"."events" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                       text                     NOT NULL,
  "description"                text                     NOT NULL DEFAULT ''::text,
  "start_date"                 date,
  "end_date"                   date,
  "official_collectible_count" integer,
  "status"                     text                     NOT NULL DEFAULT 'draft'::text,
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at"                timestamp with time zone,
  "archived_by"                uuid,
  "status_before_archive"      text,
  CONSTRAINT "events_archive_state_check" CHECK ((((status = 'archived'::text) AND (archived_at IS
    NOT NULL)) OR ((status <> 'archived'::text) AND (archived_at IS NULL) AND (archived_by IS NULL)))),
  CONSTRAINT "events_date_check" CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date))),
  CONSTRAINT "events_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT "events_official_collectible_count_check" CHECK (((official_collectible_count IS NULL) OR (official_collectible_count >= 0))),
  CONSTRAINT "events_pkey" PRIMARY KEY (id),
  CONSTRAINT "events_previous_status_check"
    CHECK
    ((((status = 'archived'::text) AND ((status_before_archive IS NULL) OR (status_before_archive = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text])))) OR ((status <>
    'archived'::text) AND (status_before_archive IS NULL)))),
  CONSTRAINT "events_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'archived'::text]))),
  "created_by"                 uuid                     DEFAULT auth.uid()
);

ALTER TABLE "public"."events"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."events" FROM "anon";

CREATE TABLE "public"."locations" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"        text                     NOT NULL,
  "game_x"      double precision         NOT NULL,
  "game_y"      double precision         NOT NULL,
  "game_z"      double precision,
  "description" text                     NOT NULL DEFAULT ''::text,
  "is_pinned"   boolean                  NOT NULL DEFAULT false,
  "is_archived" boolean                  NOT NULL DEFAULT false,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "locations_archive_state_check" CHECK ((((is_archived = false) AND (archived_at IS NULL) AND (archived_by IS NULL)) OR ((is_archived = true) AND (archived_at IS
    NOT NULL)))),
  CONSTRAINT "locations_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
  CONSTRAINT "locations_pkey" PRIMARY KEY (id),
  "created_by"  uuid                     DEFAULT auth.uid()
);

ALTER TABLE "public"."locations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."locations" FROM "anon";

CREATE TABLE "public"."player_progress" (
  "event_id"    uuid                     NOT NULL,
  "location_id" uuid                     NOT NULL,
  "status"      text                     NOT NULL DEFAULT 'not_found'::text,
  "needs_check" boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_progress_status_check" CHECK ((status = ANY (ARRAY['not_found'::text, 'found'::text, 'not_present'::text, 'uncertain'::text]))),
  "user_id"     uuid                     NOT NULL DEFAULT auth.uid(),
  CONSTRAINT "player_progress_pkey" PRIMARY KEY (user_id, event_id, location_id)
);

ALTER TABLE "public"."player_progress"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."player_progress" FROM "anon";

CREATE TABLE "public"."profiles" (
  "id"           uuid                     NOT NULL,
  "display_name" text                     NOT NULL DEFAULT 'Gracz'::text,
  "role"         text                     NOT NULL DEFAULT 'player'::text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_display_name_check" CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 40))),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['player'::text, 'admin'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

CREATE OR REPLACE FUNCTION private.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    select exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'admin'
    );
$function$;

CREATE OR REPLACE FUNCTION private.log_activity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
    v_entity_id uuid;
    v_action text;
    v_old jsonb;
    v_new jsonb;
BEGIN

    IF TG_OP = 'INSERT' THEN

        v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
        v_new := to_jsonb(NEW);

        IF TG_ARGV[0] = 'event_location' THEN
            v_action := 'linked_to_event';
        ELSE
            v_action := 'created';
        END IF;

        INSERT INTO public.activity_log (
            actor_id,
            entity_type,
            entity_id,
            action,
            new_data
        )
        VALUES (
            (SELECT auth.uid()),
            TG_ARGV[0],
            v_entity_id,
            v_action,
            v_new
        );

        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN

        v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);

        IF TG_ARGV[0] = 'location' THEN

            IF OLD.is_pinned IS DISTINCT FROM NEW.is_pinned THEN
                v_action := CASE
                    WHEN NEW.is_pinned THEN 'pinned'
                    ELSE 'unpinned'
                END;

            ELSIF OLD.is_archived IS DISTINCT FROM NEW.is_archived THEN
                v_action := CASE
                    WHEN NEW.is_archived THEN 'archived'
                    ELSE 'restored'
                END;

            ELSE
                v_action := 'updated';
            END IF;

        ELSIF TG_ARGV[0] = 'event' THEN

            IF OLD.status IS DISTINCT FROM NEW.status
               AND NEW.status = 'archived' THEN
                v_action := 'archived';

            ELSIF OLD.status = 'archived'
               AND NEW.status IS DISTINCT FROM OLD.status THEN
                v_action := 'restored';

            ELSE
                v_action := 'updated';
            END IF;

        ELSE

            v_action := 'updated';

        END IF;

        INSERT INTO public.activity_log (
            actor_id,
            entity_type,
            entity_id,
            action,
            old_data,
            new_data
        )
        VALUES (
            (SELECT auth.uid()),
            TG_ARGV[0],
            v_entity_id,
            v_action,
            v_old,
            v_new
        );

        RETURN NEW;

    ELSE

        v_entity_id := (to_jsonb(OLD) ->> 'id')::uuid;
        v_old := to_jsonb(OLD);

        IF TG_ARGV[0] = 'event_location' THEN
            v_action := 'unlinked_from_event';
        ELSE
            v_action := 'deleted';
        END IF;

        INSERT INTO public.activity_log (
            actor_id,
            entity_type,
            entity_id,
            action,
            old_data
        )
        VALUES (
            (SELECT auth.uid()),
            TG_ARGV[0],
            v_entity_id,
            v_action,
            v_old
        );

        RETURN OLD;

    END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION private.set_event_archive_metadata()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN

    IF TG_OP = 'INSERT' THEN

        IF NEW.status = 'archived' THEN
            NEW.status_before_archive :=
                COALESCE(NEW.status_before_archive, 'draft');

            NEW.archived_at := now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.status_before_archive := NULL;
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;

        RETURN NEW;
    END IF;

    -- First transition into archived state.
    IF OLD.status <> 'archived'
       AND NEW.status = 'archived' THEN

        NEW.status_before_archive := OLD.status;
        NEW.archived_at := now();
        NEW.archived_by := (SELECT auth.uid());

    -- Restore the previously saved status.
    ELSIF OLD.status = 'archived'
       AND NEW.status <> 'archived' THEN

        NEW.status := COALESCE(
            OLD.status_before_archive,
            NEW.status
        );

        NEW.status_before_archive := NULL;
        NEW.archived_at := NULL;
        NEW.archived_by := NULL;

    ELSE

        -- Prevent manual changes to archive metadata.
        NEW.status_before_archive := OLD.status_before_archive;
        NEW.archived_at := OLD.archived_at;
        NEW.archived_by := OLD.archived_by;

    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_location_archive_metadata()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN

    IF TG_OP = 'INSERT' THEN

        IF NEW.is_archived THEN
            NEW.archived_at := now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;

        RETURN NEW;
    END IF;

    IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN

        IF NEW.is_archived THEN
            NEW.archived_at := now();
            NEW.archived_by := (SELECT auth.uid());
        ELSE
            NEW.archived_at := NULL;
            NEW.archived_by := NULL;
        END IF;

    ELSE

        NEW.archived_at := OLD.archived_at;
        NEW.archived_by := OLD.archived_by;

    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_location_for_event (
  p_name        text,
  p_game_x      double precision,
  p_game_y      double precision,
  p_game_z      double precision DEFAULT NULL::double precision,
  p_description text             DEFAULT ''::text,
  p_event_id    uuid             DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
    v_location_id uuid;
begin

    if (select auth.uid()) is null then
        raise exception 'Authentication required';
    end if;

    if p_event_id is not null then
        if not exists (
            select 1
            from public.events e
            where e.id = p_event_id
              and e.status <> 'archived'
        ) then
            raise exception 'Event does not exist or is archived';
        end if;
    end if;

    insert into public.locations (
        name,
        game_x,
        game_y,
        game_z,
        description,
        created_by,
        is_pinned,
        is_archived
    )
    values (
        btrim(p_name),
        p_game_x,
        p_game_y,
        p_game_z,
        coalesce(p_description, ''),
        (select auth.uid()),
        false,
        false
    )
    returning id into v_location_id;

    if p_event_id is not null then
        insert into public.event_locations (
            event_id,
            location_id,
            added_by
        )
        values (
            p_event_id,
            v_location_id,
            (select auth.uid())
        );
    end if;

    return v_location_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_location_for_event"(text, double precision, double precision, double precision, text, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(
            nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
            'Gracz'
        )
    );

    return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.set_location_progress (
  p_event_id    uuid,
  p_location_id uuid,
  p_status      text,
  p_needs_check boolean DEFAULT false
)
  RETURNS TABLE (
    event_id    uuid,
    location_id uuid,
    status      text,
    needs_check boolean
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN

    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_status IS NULL OR p_status NOT IN (
        'not_found',
        'found',
        'not_present',
        'uncertain'
    ) THEN
        RAISE EXCEPTION 'Invalid progress status';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND e.status <> 'archived'
    ) THEN
        RAISE EXCEPTION 'Event does not exist or is archived';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.locations l
        WHERE l.id = p_location_id
          AND l.is_archived = false
    ) THEN
        RAISE EXCEPTION 'Location does not exist or is archived';
    END IF;

    INSERT INTO public.player_progress (
        user_id,
        event_id,
        location_id,
        status,
        needs_check
    )
    VALUES (
        (SELECT auth.uid()),
        p_event_id,
        p_location_id,
        p_status,
        COALESCE(p_needs_check, false)
    )
    ON CONFLICT ON CONSTRAINT player_progress_pkey
    DO UPDATE SET
        status = EXCLUDED.status,
        needs_check = EXCLUDED.needs_check;

    IF p_status = 'found' THEN

        INSERT INTO public.event_locations (
            event_id,
            location_id,
            added_by
        )
        VALUES (
            p_event_id,
            p_location_id,
            (SELECT auth.uid())
        )
        ON CONFLICT (event_id, location_id)
        DO NOTHING;

    END IF;

    RETURN QUERY
    SELECT
        pp.event_id,
        pp.location_id,
        pp.status,
        pp.needs_check
    FROM public.player_progress pp
    WHERE pp.user_id = (SELECT auth.uid())
      AND pp.event_id = p_event_id
      AND pp.location_id = p_location_id;

END;
$function$;

REVOKE ALL ON FUNCTION "public"."set_location_progress"(uuid, uuid, text, boolean) FROM PUBLIC, "anon";

ALTER TABLE "public"."event_locations"
  ADD CONSTRAINT "event_locations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_locations"
  ADD CONSTRAINT "event_locations_location_id_fkey" FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_progress"
  ADD CONSTRAINT "player_progress_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE "public"."player_progress"
  ADD CONSTRAINT "player_progress_location_id_fkey" FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."activity_log"
  ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_archived_by_fkey" FOREIGN KEY (archived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."locations"
  ADD CONSTRAINT "locations_archived_by_fkey" FOREIGN KEY (archived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX activity_log_created_at_idx ON public.activity_log USING btree (created_at DESC);

CREATE INDEX activity_log_entity_idx ON public.activity_log USING btree (entity_type, entity_id);

CREATE INDEX event_locations_location_id_idx ON public.event_locations USING btree (location_id);

CREATE INDEX events_archived_at_idx ON public.events USING btree (archived_at DESC)
  WHERE (status = 'archived'::text);

CREATE INDEX events_status_idx ON public.events USING btree (status);

CREATE INDEX locations_active_idx ON public.locations USING btree (is_archived);

CREATE INDEX locations_archived_at_idx ON public.locations USING btree (archived_at DESC)
  WHERE (is_archived = true);

CREATE INDEX player_progress_event_location_idx ON public.player_progress USING btree (event_id, location_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER event_locations_activity_log
  AFTER INSERT OR DELETE OR UPDATE ON public.event_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.log_activity('event_location');

CREATE TRIGGER events_activity_log
  AFTER INSERT OR DELETE OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION private.log_activity('event');

CREATE TRIGGER events_archive_metadata
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION private.set_event_archive_metadata();

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER locations_activity_log
  AFTER INSERT OR DELETE OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.log_activity('location');

CREATE TRIGGER locations_archive_metadata
  BEFORE INSERT OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.set_location_archive_metadata();

CREATE TRIGGER locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER player_progress_updated_at
  BEFORE UPDATE ON public.player_progress
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY "activity_log_read_authenticated" ON "public"."activity_log"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "event_locations_delete_admin" ON "public"."event_locations"
  FOR DELETE
  TO "authenticated"
  USING (( SELECT private.is_admin() AS is_admin));

CREATE POLICY "event_locations_read_authenticated" ON "public"."event_locations"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "events_read_authenticated" ON "public"."events"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "events_update_admin" ON "public"."events"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_admin() AS is_admin))
  WITH CHECK (( SELECT private.is_admin() AS is_admin));

CREATE POLICY "locations_read_active" ON "public"."locations"
  FOR SELECT
  TO "authenticated"
  USING (((NOT is_archived) OR ( SELECT private.is_admin() AS is_admin)));

CREATE POLICY "locations_update_admin" ON "public"."locations"
  FOR UPDATE
  TO "authenticated"
  USING (( SELECT private.is_admin() AS is_admin))
  WITH CHECK (( SELECT private.is_admin() AS is_admin));

CREATE POLICY "profiles_read_authenticated" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "profiles_update_own_name" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((id = ( SELECT auth.uid() AS uid)));

REVOKE ALL ON FUNCTION "private"."is_admin"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "private"."log_activity"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."set_event_archive_metadata"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."set_location_archive_metadata"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_location_for_event"(text, double precision, double precision, double precision, text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_location_for_event"(text, double precision, double precision, double precision, text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_location_for_event"(text, double precision, double precision, double precision, text, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_location_for_event"(text, double precision, double precision, double precision, text, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_location_progress"(uuid, uuid, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_location_progress"(uuid, uuid, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_location_progress"(uuid, uuid, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_location_progress"(uuid, uuid, text, boolean) TO "service_role";

GRANT USAGE ON SCHEMA "private" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."activity_log_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."activity_log_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."activity_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."activity_log_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."activity_log_id_seq" TO "service_role";

REVOKE ALL ON TABLE "public"."activity_log" FROM "authenticated";

GRANT SELECT ON TABLE "public"."activity_log" TO "authenticated";

REVOKE ALL ON TABLE "public"."activity_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_log" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_log" TO "service_role";

REVOKE ALL ON TABLE "public"."event_locations" FROM "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."event_locations" TO "authenticated";

REVOKE ALL ON TABLE "public"."event_locations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_locations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."event_locations" TO "service_role";

REVOKE ALL ON TABLE "public"."events" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."events" TO "authenticated";

REVOKE ALL ON TABLE "public"."events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."events" TO "service_role";

REVOKE ALL ON TABLE "public"."locations" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."locations" TO "authenticated";

REVOKE ALL ON TABLE "public"."locations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "service_role";

REVOKE ALL ON TABLE "public"."player_progress" FROM "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."player_progress" TO "authenticated";

REVOKE ALL ON TABLE "public"."player_progress" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_progress" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_progress" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

REVOKE ALL ("display_name") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("display_name") ON TABLE "public"."profiles" TO "authenticated";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

ALTER TABLE "public"."event_locations"
  ADD CONSTRAINT "event_locations_added_by_fkey" FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE POLICY "event_locations_insert_authenticated" ON "public"."event_locations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((added_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.locations l
  WHERE ((l.id = event_locations.location_id) AND (l.is_archived = false)))) AND (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_locations.event_id) AND (e.status <> 'archived'::text))))));

ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE POLICY "events_insert_admin" ON "public"."events"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((( SELECT private.is_admin() AS is_admin) AND (created_by = ( SELECT auth.uid() AS uid))));

ALTER TABLE "public"."locations"
  ADD CONSTRAINT "locations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX locations_created_by_idx ON public.locations USING btree (created_by);

CREATE POLICY "locations_insert_authenticated" ON "public"."locations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (is_pinned = false) AND (is_archived = false)));

CREATE POLICY "locations_update_own_unpinned" ON "public"."locations"
  FOR UPDATE
  TO "authenticated"
  USING (((created_by = ( SELECT auth.uid() AS uid)) AND (is_pinned = false) AND (is_archived = false)))
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (is_pinned = false) AND (is_archived = false)));

ALTER TABLE "public"."player_progress"
  ADD CONSTRAINT "player_progress_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "player_progress_delete_own" ON "public"."player_progress"
  FOR DELETE
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "player_progress_insert_own" ON "public"."player_progress"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "player_progress_read_own" ON "public"."player_progress"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "player_progress_update_own" ON "public"."player_progress"
  FOR UPDATE
  TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
