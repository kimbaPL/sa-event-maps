SA EVENT MAPS — PAKIET INTEGRACJI SUPABASE

Pliki:
- index.html
- style.css
- app.js
- supabase-data.js

UWAGA:
1. Zrób kopię zapasową aktualnych plików index.html, style.css, app.js i supabase-data.js.
2. Podmień je razem na wersje z tego pakietu.
3. Zachowaj bez zmian supabase-client.js oraz assets/gtasa-map-shadows.jpg.
4. Pakiet nie zawiera żadnych kluczy ani haseł Supabase.
5. Import starej lokalnej bazy jest chwilowo wyłączony; eksport tworzy kopię danych pobranych z Supabase.
6. Cztery tymczasowe punkty kontrolne (R) nadal są widoczne. Usunąć je przed publikacją po końcowej weryfikacji kalibracji.

Test techniczny:
- node --check app.js
- node --check supabase-data.js

Nie oznacza to jeszcze testu w przeglądarce z projektem Supabase. Po podmianie należy wykonać test w przeglądarce krok po kroku.
