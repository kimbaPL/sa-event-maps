
"use strict";

/*
========================================================
SA EVENT MAPS
AUTHENTICATION SYSTEM
========================================================
*/

(() => {

    const supabase = window.supabaseClient;

    const byId = id => document.getElementById(id);

    const screen = byId("auth-screen");
    const appShell = document.querySelector(".app-shell");
    const form = byId("auth-form");

    if (!screen || !appShell || !form) {
        console.error("SA Event Maps: Brak elementów logowania.");
        return;
    }

    if (!supabase) {
        byId("auth-status").textContent =
            "Nie udało się uruchomić klienta Supabase.";
        byId("auth-status").classList.add("is-error");
        return;
    }


    const fields = {

        nameGroup: byId("auth-name-group"),
        name: byId("auth-display-name"),

        emailGroup: byId("auth-email-group"),
        email: byId("auth-email"),

        passwordGroup: byId("auth-password-group"),
        password: byId("auth-password"),

        confirmGroup: byId("auth-confirm-group"),
        confirm: byId("auth-confirm-password"),

        submit: byId("auth-submit"),

        forgot: byId("auth-forgot-password"),
        back: byId("auth-back-button"),

        status: byId("auth-status"),
        modeSwitch: byId("auth-mode-switch")

    };


    let mode = "login";
let busy = false;
let sessionApplySequence = 0;

const RECOVERY_STORAGE_KEY =
    "sa-event-maps.password-recovery";

let recoveryModeActive =
    sessionStorage.getItem(RECOVERY_STORAGE_KEY) === "true";

// The map may only bootstrap after this module has verified the account
// through the database-side access-status RPC.
window.saEventMapsAccessState = {
    ready: false,
    active: false,
    pendingInvite: false,
    recovery: false
};

function publishAccessState({ active = false, pendingInvite = false, recovery = false } = {}) {
    const state = {
        ready: true,
        active: Boolean(active),
        pendingInvite: Boolean(pendingInvite),
        recovery: Boolean(recovery)
    };

    window.saEventMapsAccessState = state;
    window.dispatchEvent(new CustomEvent("sa-event-maps:access-state", {
        detail: state
    }));
}

function isInviteCallbackUrl() {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return query.get("invite") === "1" ||
        query.get("type") === "invite" ||
        hash.get("type") === "invite";
}

function clearAuthCallbackUrl() {
    window.history.replaceState(
        window.history.state,
        document.title,
        window.location.origin + window.location.pathname
    );
}

function showBlockedAuthScreen() {
    appShell.inert = true;
    appShell.setAttribute("aria-hidden", "true");
    screen.hidden = false;
    document.body.removeAttribute("data-auth-role");
    window.saEventMapsUser = null;
    byId("auth-user-control")?.remove();
}


    // ================================================
    // STATUS
    // ================================================

    function setStatus(message, type = "") {

        fields.status.textContent = message;

        fields.status.className =
            "auth-status" +
            (type ? ` is-${type}` : "");

    }


    // ================================================
    // MODE SWITCHING
    // ================================================

    function setMode(nextMode) {

        mode = nextMode;

        setStatus("");

        fields.nameGroup.hidden =
            mode !== "signup";

        fields.emailGroup.hidden =
            mode === "update";

        fields.passwordGroup.hidden =
            mode === "recovery";

        fields.confirmGroup.hidden =
            mode !== "update";

        // Public registration is disabled for this organization. New members
        // enter through the separate request-and-invitation flow only.
        fields.modeSwitch.hidden = true;

        fields.forgot.hidden =
            mode !== "login";

        fields.back.hidden =
    mode === "login" ||
    (mode === "update" && recoveryModeActive);

        fields.name.required =
            mode === "signup";

        fields.email.required =
            mode !== "update";

        fields.password.required =
            mode !== "recovery";

        fields.confirm.required =
            mode === "update";

        fields.password.autocomplete =
            mode === "login"
                ? "current-password"
                : "new-password";


        const labels = {

            login: "Zaloguj się",

            signup: "Utwórz konto",

            recovery: "Wyślij link odzyskiwania",

            update: "Zapisz nowe hasło"

        };


        fields.submit.textContent =
            labels[mode];


        document
            .querySelectorAll("[data-auth-mode]")
            .forEach(button => {

                button.classList.toggle(
                    "is-active",
                    button.dataset.authMode === mode
                );

            });

    }


    document
        .querySelectorAll("[data-auth-mode]")
        .forEach(button => {

            button.addEventListener("click", () => {

                setMode(button.dataset.authMode);

            });

        });


    fields.back.addEventListener("click", () => {

        setMode("login");

    });


    // ================================================
    // REDIRECT URL
    // ================================================

    function getRedirectURL() {

        return (
            window.location.origin +
            window.location.pathname
        );

    }


// ================================================
// PASSWORD RECOVERY SCREEN
// ================================================

function showRecoveryForm() {
    showBlockedAuthScreen();
    setMode("update");
    setStatus("Wprowadź nowe hasło do swojego konta.");
    publishAccessState({ active: false, recovery: true });
}


    // ================================================
    // USER CONTROL
    // ================================================

    function renderUserControl(user, profile) {

        let container = byId("auth-user-control");

        if (!container) {

            container = document.createElement("div");

            container.id = "auth-user-control";

            container.className = "auth-user-control";


            const info = document.createElement("div");

            info.className = "auth-user-info";


            const name = document.createElement("strong");

            name.id = "auth-user-name";


            const role = document.createElement("span");

            role.id = "auth-user-role";


            info.append(name, role);


            const logout = document.createElement("button");

            logout.type = "button";

            logout.textContent = "Wyloguj";

            logout.addEventListener("click", async () => {

                const { error } = await supabase.auth.signOut();

                if (error) {

                    console.error(error);

                    return;

                }

            });


            container.append(info, logout);

            const actions =
                document.querySelector(".topbar-actions");

            if (actions) {

                actions.appendChild(container);

            }

        }


        byId("auth-user-name").textContent =
            profile.display_name || user.email;


        byId("auth-user-role").textContent =
            profile.role === "admin"
                ? "Administrator"
                : "Gracz";

    }


    // ================================================
    // SESSION AND PROFILE
    // ================================================

    async function applySession(session) {
        const sequence = ++sessionApplySequence;

        if (!session || !session.user) {
            const wasRecoveryMode = recoveryModeActive;
            const wasInviteReturn = isInviteCallbackUrl();

            recoveryModeActive = false;
            sessionStorage.removeItem(RECOVERY_STORAGE_KEY);

            showBlockedAuthScreen();
            setMode("login");

            if (wasRecoveryMode) {
                setStatus("Sesja odzyskiwania hasła wygasła. Poproś o nowy link.", "error");
            } else if (wasInviteReturn) {
                setStatus("Nie udało się potwierdzić sesji zaproszenia. Link mógł wygasnąć. Poproś administrację o ponowne wysłanie zaproszenia.", "error");
            }

            publishAccessState({ active: false });
            return;
        }

        // A password-recovery session never grants map access until its own
        // password-update flow completes and this function runs again.
        if (recoveryModeActive) {
            showRecoveryForm();
            return;
        }

        setStatus("Sprawdzanie uprawnień konta...");

        const { data: accessStatus, error: accessError } = await supabase.rpc(
            "get_my_access_status"
        );

        if (sequence !== sessionApplySequence) return;

        if (accessError || !accessStatus) {
            console.error("SA Event Maps: Nie udało się zweryfikować dostępu.", accessError);
            showBlockedAuthScreen();
            setMode("login");
            setStatus(
                "Nie udało się zweryfikować uprawnień konta. Mapa pozostaje zablokowana. Spróbuj ponownie lub skontaktuj się z administracją.",
                "error"
            );
            publishAccessState({ active: false });
            return;
        }

        if (accessStatus.is_active !== true) {
            showBlockedAuthScreen();
            setMode("login");

            if (accessStatus.is_invited === true) {
                // admin-panel.js owns the dedicated invitation-password form.
                // This module deliberately keeps the app inert and the map blocked.
                fields.modeSwitch.hidden = true;
                fields.forgot.hidden = true;
                fields.back.hidden = true;
                setStatus("Zaproszenie zostało potwierdzone. Ustaw hasło w formularzu aktywacji, aby uzyskać dostęp do mapy.");
                publishAccessState({ active: false, pendingInvite: true });
            } else {
                setStatus("To konto nie ma aktywnego dostępu do mapy. Skontaktuj się z administracją.", "error");
                publishAccessState({ active: false });
            }
            return;
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, display_name, role")
            .eq("id", session.user.id)
            .maybeSingle();

        if (sequence !== sessionApplySequence) return;

        if (profileError || !profile) {
            console.error("SA Event Maps: Nie udało się odczytać aktywnego profilu.", profileError);
            showBlockedAuthScreen();
            setMode("login");
            setStatus(
                "Konto ma sesję, ale nie udało się odczytać profilu. Mapa pozostaje zablokowana. Skontaktuj się z administratorem.",
                "error"
            );
            publishAccessState({ active: false });
            return;
        }

        window.saEventMapsUser = {
            id: session.user.id,
            email: session.user.email,
            displayName: profile.display_name,
            role: profile.role,
            isAdmin: profile.role === "admin",
            isActive: true
        };

        document.body.dataset.authRole = profile.role;
        renderUserControl(session.user, profile);

        appShell.inert = false;
        appShell.removeAttribute("aria-hidden");
        screen.hidden = true;

        if (isInviteCallbackUrl()) {
            clearAuthCallbackUrl();
        }

        publishAccessState({ active: true });

        console.info("SA Event Maps: Użytkownik zalogowany i aktywny.", {
            role: profile.role
        });
    }


    // ================================================
    // FORM SUBMISSION
    // ================================================

    form.addEventListener("submit", async event => {

        event.preventDefault();

        if (busy) {
            return;
        }


        busy = true;

        fields.submit.disabled = true;

        fields.submit.textContent = "Proszę czekać...";

        setStatus("Przetwarzanie...");


        try {

            const email =
                fields.email.value.trim();

            const password =
                fields.password.value;


            if (mode === "login") {

                const { data, error } =
                    await supabase.auth.signInWithPassword({

                        email,

                        password

                    });


                if (error) {
                    throw error;
                }


                await applySession(data.session);

            }


            else if (mode === "signup") {

                const displayName =
                    fields.name.value.trim();


                if (!displayName) {

                    throw new Error(
                        "Podaj nazwę użytkownika."
                    );

                }


                if (password.length < 8) {

                    throw new Error(
                        "Hasło musi mieć przynajmniej 8 znaków."
                    );

                }


                const { data, error } =
                    await supabase.auth.signUp({

                        email,

                        password,

                        options: {

                            data: {

                                display_name: displayName

                            },

                            emailRedirectTo: getRedirectURL()

                        }

                    });


                if (error) {
                    throw error;
                }


                if (data.session) {

                    await applySession(data.session);

                } else {

                    setStatus(
                        "Konto zostało utworzone. Sprawdź swoją pocztę i potwierdź adres e-mail przed pierwszym logowaniem.",
                        "success"
                    );

                    form.reset();

                    setMode("login");

                }

            }


            else if (mode === "recovery") {

                const { error } =
                    await supabase.auth.resetPasswordForEmail(

                        email,

                        {
                            redirectTo: getRedirectURL()
                        }

                    );


                if (error) {
                    throw error;
                }


                setStatus(
                    "Jeżeli konto z tym adresem istnieje, otrzymasz wiadomość z linkiem do zmiany hasła.",
                    "success"
                );

            }


            else if (mode === "update") {

                const newPassword =
                    fields.password.value;

                const confirmation =
                    fields.confirm.value;


                if (newPassword.length < 8) {

                    throw new Error(
                        "Nowe hasło musi mieć przynajmniej 8 znaków."
                    );

                }


                if (newPassword !== confirmation) {

                    throw new Error(
                        "Wprowadzone hasła nie są identyczne."
                    );

                }


                const { error } =
                    await supabase.auth.updateUser({

                        password: newPassword

                    });


                if (error) {
    throw error;
}


// Zakończenie odzyskiwania hasła. Dostęp do mapy jest
// ponownie sprawdzany przez bazę przed pokazaniem aplikacji.
recoveryModeActive = false;
sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
setMode("login");
setStatus("Hasło zostało zmienione. Sprawdzanie dostępu do konta...", "success");

const { data, error: sessionError } = await supabase.auth.getSession();
if (sessionError) throw sessionError;
await applySession(data.session);

            }

        } catch (error) {

            console.error(
                "SA Event Maps Auth:",
                error
            );

            setStatus(
                error.message || "Wystąpił nieoczekiwany błąd.",
                "error"
            );

        } finally {

            busy = false;

            fields.submit.disabled = false;

            if (mode === "login") {
                fields.submit.textContent = "Zaloguj się";
            }

            else if (mode === "signup") {
                fields.submit.textContent = "Utwórz konto";
            }

            else if (mode === "recovery") {
                fields.submit.textContent = "Wyślij link odzyskiwania";
            }

            else if (mode === "update") {
                fields.submit.textContent = "Zapisz nowe hasło";
            }

        }

    });


    // ================================================
    // PASSWORD RECOVERY BUTTON
    // ================================================

    fields.forgot.addEventListener("click", () => {

        setMode("recovery");

    });


    // ================================================
    // AUTH STATE LISTENER
    // ================================================

supabase.auth.onAuthStateChange((event, session) => {

    if (event === "USER_UPDATED" && busy && mode === "update") {
        // The form handler will re-check the session after its password update.
        return;
    }

    if (event === "PASSWORD_RECOVERY") {

        recoveryModeActive = true;

        sessionStorage.setItem(
            RECOVERY_STORAGE_KEY,
            "true"
        );

        window.setTimeout(() => {

            if (session && session.user) {

                showRecoveryForm();

            } else {

                void applySession(session);

            }

        }, 0);

        return;

    }


    window.setTimeout(() => {

        void applySession(session);

    }, 0);

});


    // ================================================
    // INITIAL STATE
    // ================================================

    appShell.inert = true;
    appShell.setAttribute("aria-hidden", "true");
    screen.hidden = false;

setMode(
    recoveryModeActive ? "update" : "login"
);

if (recoveryModeActive) {

    setStatus(
        "Sprawdzanie sesji odzyskiwania hasła..."
    );

}

    console.info(
        "SA Event Maps: System logowania został uruchomiony."
    );

})();
