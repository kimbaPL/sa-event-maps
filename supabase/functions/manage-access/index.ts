import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Nie udało się wykonać operacji.";
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ?? Deno.env.get("SUPABASE_SECRET_KEY")
  ?? "";
const appSiteUrl = Deno.env.get("APP_SITE_URL") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("manage-access: missing Supabase server environment variables");
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Zaloguj się ponownie.");

  const { data: authData, error: authError } = await adminClient.auth.getUser(match[1]);
  if (authError || !authData.user) throw new Error("Sesja użytkownika jest nieprawidłowa lub wygasła.");

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, is_owner")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.role !== "admin") throw new Error("Ta operacja jest dostępna wyłącznie dla administratora.");

  return { user: authData.user, profile };
}

async function deleteRequest(requestId: string) {
  const { data, error } = await adminClient
    .from("access_requests")
    .delete()
    .eq("id", requestId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Nie znaleziono oczekującego zgłoszenia. Odśwież listę.");
  return { ok: true };
}

async function approveRequest(requestId: string) {
  if (!appSiteUrl) throw new Error("Brakuje ustawienia APP_SITE_URL dla zaproszeń.");

  const { data: accessRequest, error: requestError } = await adminClient
    .from("access_requests")
    .select("id, display_name, email")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) throw requestError;
  if (!accessRequest) throw new Error("Nie znaleziono oczekującego zgłoszenia. Odśwież listę.");

  const displayName = String(accessRequest.display_name ?? "").trim();
  const email = String(accessRequest.email ?? "").trim().toLowerCase();
  if (displayName.length < 2 || displayName.length > 80 || !email) {
    throw new Error("Zgłoszenie zawiera nieprawidłowe dane. Usuń je i poproś tę osobę o ponowne wysłanie.");
  }

  // The profiles trigger automatically adds a suffix to duplicate names.
  // Check first so an applicant is not silently invited under a different name.
  // Escape LIKE metacharacters so the case-insensitive pattern is an exact match.
  const nicknamePattern = displayName.replace(/[\\%_]/g, "\\$&");
  const { data: nicknameConflicts, error: nicknameCheckError } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("display_name", nicknamePattern)
    .limit(1);

  if (nicknameCheckError) throw nicknameCheckError;
  if (nicknameConflicts?.length) {
    throw new Error("Ten pseudonim jest już zajęty. Usuń zgłoszenie i poproś tę osobę o wybranie innego.");
  }

  const redirectTo = new URL("/", appSiteUrl);
  redirectTo.searchParams.set("invite", "1");

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo: redirectTo.toString(),
  });

  if (inviteError) throw inviteError;
  const invitedUserId = inviteData.user?.id;
  if (!invitedUserId) throw new Error("Supabase nie zwrócił identyfikatora zaproszonego konta.");

  // A concurrent approval may claim the same nickname after the pre-check.
  // The database trigger then adds a suffix; verify the actual profile and
  // revoke this invite rather than silently changing the requested nickname.
  const { data: invitedProfile, error: profileLookupError } = await adminClient
    .from("profiles")
    .select("id, display_name")
    .eq("id", invitedUserId)
    .maybeSingle();

  const actualDisplayName = String(invitedProfile?.display_name ?? "").trim();
  if (profileLookupError || !invitedProfile || actualDisplayName !== displayName) {
    const cleanup = await adminClient.auth.admin.deleteUser(invitedUserId);
    if (cleanup.error) {
      throw new Error(`Zaproszenie utworzyło konto, ale nie udało się potwierdzić pseudonimu ani wycofać zaproszenia. ${profileLookupError?.message ?? cleanup.error.message}`);
    }
    if (profileLookupError) throw profileLookupError;
    if (!invitedProfile) {
      throw new Error("Nie znaleziono profilu zaproszonego użytkownika. Zaproszenie zostało wycofane; sprawdź zgłoszenie przed ponowną próbą.");
    }
    throw new Error("Ten pseudonim został zajęty podczas zatwierdzania. Zaproszenie zostało wycofane. Poproś tę osobę o wybranie innego pseudonimu.");
  }

  const { error: requestDeleteError } = await adminClient
    .from("access_requests")
    .delete()
    .eq("id", requestId);

  if (requestDeleteError) {
    // If the request cannot be cleared, revoke the just-created invite so the
    // same pending request can be approved again without duplicate accounts.
    console.error("Invite sent, but access request cleanup failed:", requestDeleteError);
    const cleanup = await adminClient.auth.admin.deleteUser(invitedUserId);
    if (cleanup.error) {
      throw new Error(`Zaproszenie zostało wysłane, ale nie udało się zamknąć zgłoszenia ani wycofać zaproszenia. Usuń zgłoszenie po ręcznej kontroli konta. ${requestDeleteError.message}; ${cleanup.error.message}`);
    }
    throw new Error(`Nie udało się zamknąć zgłoszenia. Utworzone zaproszenie zostało wycofane; spróbuj ponownie. ${requestDeleteError.message}`);
  }

  return { ok: true, invitedEmail: email };
}

async function listStorageObjectsOwnedByUser(userId: string): Promise<string[]> {
  const pageSize = 500;
  const paths: string[] = [];

  // PostgREST may cap one response (often at 1,000 rows), so page explicitly.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .rpc("admin_list_user_location_screenshot_objects", { p_user_id: userId })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Nie udało się sprawdzić właścicieli plików Storage. Konto nie zostało usunięte. ${error.message}`);
    }

    const page = (data ?? [])
      .map((row: { object_path?: unknown }) => String(row.object_path ?? ""))
      .filter((path: string) => path.length > 0);

    paths.push(...page);
    if (page.length < pageSize) break;
  }

  return paths;
}

async function listImagesUploadedByUser(userId: string) {
  const pageSize = 500;
  const images: Array<{
    id: string;
    location_id: string;
    object_path: string;
    mime_type: string | null;
  }> = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .from("location_images")
      .select("id, location_id, object_path, mime_type")
      .eq("uploaded_by", userId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as typeof images;
    images.push(...page);
    if (page.length < pageSize) break;
  }

  return images;
}

async function listImageRowsForPaths(paths: string[]) {
  const batchSize = 100;
  const images: Array<{
    id: string;
    location_id: string;
    object_path: string;
    mime_type: string | null;
  }> = [];

  // Keep each .in() request small to avoid oversized REST URLs.
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    const batch = paths.slice(offset, offset + batchSize);
    const { data, error } = await adminClient
      .from("location_images")
      .select("id, location_id, object_path, mime_type")
      .in("object_path", batch);

    if (error) throw error;
    images.push(...((data ?? []) as typeof images));
  }

  return images;
}

async function transferUserImages(userId: string) {
  const bucket = "location-screenshots";

  // Check both sources of ownership:
  // 1) image metadata says who uploaded the screenshot;
  // 2) Storage owner_id says which Auth account owns the physical object.
  // They may differ after restoring an organization backup.
  const uploadedImages = await listImagesUploadedByUser(userId);
  const ownedPaths = await listStorageObjectsOwnedByUser(userId);
  const allPaths = [...new Set([
    ...(uploadedImages ?? []).map((image: { object_path?: unknown }) => String(image.object_path ?? "")),
    ...ownedPaths,
  ].filter((path) => path.length > 0))];

  if (allPaths.length === 0) {
    return { transferredImages: 0, removedOrphanedFiles: 0 };
  }

  // Find metadata for every Storage object actually owned by this account.
  // This catches images whose uploaded_by value belongs to another account.
  const ownedImageRows = ownedPaths.length > 0
    ? await listImageRowsForPaths(ownedPaths)
    : [];

  const imagesByPath = new Map<string, {
    id: string;
    location_id: string;
    object_path: string;
    mime_type: string | null;
  }>();

  for (const image of [...(uploadedImages ?? []), ...(ownedImageRows ?? [])]) {
    imagesByPath.set(String(image.object_path), image as {
      id: string;
      location_id: string;
      object_path: string;
      mime_type: string | null;
    });
  }

  let transferredImages = 0;
  let removedOrphanedFiles = 0;

  for (const oldPath of allPaths) {
    const image = imagesByPath.get(oldPath);

    // A file owned by the departing user but absent from location_images is
    // an orphaned upload. It is not a shared screenshot, so remove the object.
    if (!image) {
      const { error: orphanRemoveError } = await adminClient.storage
        .from(bucket)
        .remove([oldPath]);

      if (orphanRemoveError) {
        throw new Error(`Nie udało się usunąć niepowiązanego pliku ${oldPath}. Konto nie zostało usunięte. ${orphanRemoveError.message}`);
      }

      removedOrphanedFiles += 1;
      continue;
    }

    const locationId = String(image.location_id ?? "");
    const expectedPath = new RegExp(
      `^${locationId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`,
      "i",
    );

    if (!locationId || !expectedPath.test(oldPath)) {
      throw new Error(`Nieprawidłowa ścieżka zdjęcia ${oldPath}. Konto nie zostało usunięte.`);
    }

    const { data: originalFile, error: downloadError } = await adminClient.storage
      .from(bucket)
      .download(oldPath);

    if (downloadError || !originalFile) {
      throw new Error(`Nie udało się zabezpieczyć zdjęcia ${oldPath}. Konto nie zostało usunięte. ${downloadError?.message ?? "Brak pliku."}`);
    }

    // A server-key upload has no departing user's owner_id. Keep the required
    // location-id/UUID.webp format used by the application.
    const newPath = `${locationId}/${crypto.randomUUID()}.webp`;
    const bytes = new Uint8Array(await originalFile.arrayBuffer());
    const { error: uploadError } = await adminClient.storage
      .from(bucket)
      .upload(newPath, bytes, {
        cacheControl: "31536000",
        contentType: String(image.mime_type || "image/webp"),
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Nie udało się przenieść zdjęcia ${oldPath}. Konto nie zostało usunięte. ${uploadError.message}`);
    }

    const { data: updatedImage, error: updateError } = await adminClient
      .from("location_images")
      .update({ object_path: newPath })
      .eq("id", image.id)
      .eq("object_path", oldPath)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedImage) {
      const cleanup = await adminClient.storage.from(bucket).remove([newPath]);
      if (cleanup.error) {
        throw new Error(`Nie udało się zaktualizować metadanych zdjęcia ${oldPath}, a nowy plik ${newPath} wymaga kontroli. Konto nie zostało usunięte. ${updateError?.message ?? "Rekord zdjęcia uległ zmianie."}; ${cleanup.error.message}`);
      }
      throw new Error(`Nie udało się zaktualizować metadanych zdjęcia ${oldPath}. Konto nie zostało usunięte. ${updateError?.message ?? "Rekord zdjęcia uległ zmianie."}`);
    }

    const { error: removeError } = await adminClient.storage.from(bucket).remove([oldPath]);
    if (removeError) {
      const rollback = await adminClient
        .from("location_images")
        .update({ object_path: oldPath })
        .eq("id", image.id)
        .eq("object_path", newPath);
      const cleanup = await adminClient.storage.from(bucket).remove([newPath]);

      if (rollback.error || cleanup.error) {
        throw new Error(`Nie udało się bezpiecznie zakończyć przenoszenia zdjęcia ${oldPath}. Nie usuwaj konta ręcznie; potrzebna jest kontrola administratora. ${removeError.message}; ${rollback.error?.message ?? ""}; ${cleanup.error?.message ?? ""}`);
      }
      throw new Error(`Nie udało się bezpiecznie przenieść zdjęcia ${oldPath}. Konto nie zostało usunięte. ${removeError.message}`);
    }

    transferredImages += 1;
  }

  // Final fail-closed check: the account must own no objects in this bucket.
  const remainingOwnedPaths = await listStorageObjectsOwnedByUser(userId);
  if (remainingOwnedPaths.length > 0) {
    throw new Error(`Po zabezpieczeniu zdjęć konto nadal posiada ${remainingOwnedPaths.length} plik(ów) w Storage. Konto nie zostało usunięte. Wymagana jest kontrola administratora.`);
  }

  return { transferredImages, removedOrphanedFiles };
}

async function deleteUser(targetUserId: string, callerId: string) {
  if (!targetUserId) throw new Error("Nie wskazano konta do usunięcia.");
  if (targetUserId === callerId) throw new Error("Nie możesz usunąć własnego konta z panelu. Poproś innego administratora.");

  const { data: targetProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, is_owner, display_name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!targetProfile) throw new Error("Nie znaleziono profilu użytkownika.");
  if (targetProfile.is_owner) throw new Error("Nie można usunąć stałego właściciela projektu SA Event Maps.");

  if (targetProfile.role === "admin") {
    const { count, error: countError } = await adminClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw countError;
    if ((count ?? 0) <= 1) throw new Error("Nie można usunąć ostatniego administratora projektu.");
  }

  // Transfer every registered screenshot before deleting Auth. If any
  // transfer fails, the Auth account is left intact and the operation can be retried.
  const imageCleanup = await transferUserImages(targetUserId);

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    throw new Error(`Zdjęcia zostały zachowane, ale Supabase nie usunął konta. Konto nadal istnieje; można bezpiecznie ponowić próbę. ${deleteError.message}`);
  }

  return {
    ok: true,
    displayName: targetProfile.display_name,
    transferredImages: imageCleanup.transferredImages,
    removedOrphanedFiles: imageCleanup.removedOrphanedFiles,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Niedozwolona metoda." });
  if (!supabaseUrl || !serviceKey) return jsonResponse(500, { error: "Brakuje konfiguracji serwera Supabase." });

  try {
    const { user } = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "approve_request") {
      const result = await approveRequest(String(body?.requestId ?? ""));
      return jsonResponse(200, result);
    }

    if (action === "delete_request") {
      const result = await deleteRequest(String(body?.requestId ?? ""));
      return jsonResponse(200, result);
    }

    if (action === "delete_user") {
      const result = await deleteUser(String(body?.userId ?? ""), user.id);
      return jsonResponse(200, result);
    }

    return jsonResponse(400, { error: "Nieznana operacja panelu administracyjnego." });
  } catch (error) {
    console.error("manage-access failed:", error);
    const message = cleanError(error);
    const status = /wyłącznie dla administratora|zaloguj się|sesja użytkownika/i.test(message)
      ? 403
      : 400;
    return jsonResponse(status, { error: message });
  }
});
