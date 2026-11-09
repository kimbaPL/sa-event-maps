
"use strict";

/*
========================================================
SA EVENT MAPS
SUPABASE CLIENT CONFIGURATION
========================================================
*/

(() => {

    const SUPABASE_URL =
        "https://krvnptolqqayssqhruuc.supabase.co";

    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_4i9a6HRScZaQIQ4a6EN7Sw_wkONYjgd";


    // Check whether Supabase JS was loaded.

    if (
        !window.supabase ||
        typeof window.supabase.createClient !== "function"
    ) {

        console.error(
            "SA Event Maps: Nie załadowano biblioteki Supabase JS."
        );

        return;

    }


    // Validate public key format.

    if (
        !SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")
    ) {

        console.error(
            "SA Event Maps: Nieprawidłowy Publishable Key."
        );

        return;

    }


    // Initialize Supabase client.

    window.supabaseClient =
        window.supabase.createClient(

            SUPABASE_URL,

            SUPABASE_PUBLISHABLE_KEY,

            {
                auth: {

                    autoRefreshToken: true,

                    persistSession: true,

                    detectSessionInUrl: true

                }
            }

        );


    console.info(
        "SA Event Maps: Klient Supabase został zainicjalizowany."
    );


    // Connection diagnostic.

    window.checkSupabaseConnection = async function () {

        try {

            const response = await fetch(
                `${SUPABASE_URL}/auth/v1/health`,
                {
                    method: "GET",
                    headers: {
                        apikey: SUPABASE_PUBLISHABLE_KEY
                    },
                    cache: "no-store"
                }
            );

            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}: ${await response.text()}`
                );

            }

            console.info(
                `SA Event Maps: Supabase odpowiada. HTTP ${response.status}.`
            );

            return true;

        } catch (error) {

            console.error(
                "SA Event Maps: Nie udało się połączyć z Supabase.",
                error
            );

            return false;

        }

    };

})();
