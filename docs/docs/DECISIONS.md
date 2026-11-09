
# Interaktywna mapa MTA — decyzje techniczne

## 1. Ustalenia na obecnym etapie

- Kod projektu przechowujemy w prywatnym repozytorium GitHub.
- Stronę budujemy modułowo.
- Interfejs, logika serwera, baza danych i magazyn plików mają być rozdzielone.
- Projekt ma być możliwie niezależny od dostawcy hostingu.
- Dane muszą być możliwe do eksportowania i przenoszenia.

## 2. Wstępnie wybrane technologie

### Interfejs strony
- HTML
- CSS
- JavaScript

### Interaktywna mapa
- Leaflet
- Obraz mapy GTA San Andreas jako podkład.
- Obsługa przybliżania, przesuwania i pinezek.

## 3. Technologie jeszcze niewybrane

- Hosting strony.
- Backend i API.
- Baza danych.
- System logowania.
- Magazyn screenshotów.
- System kopii zapasowych.

Wybór nastąpi po sprawdzeniu bezpieczeństwa, limitów, kosztów i możliwości migracji.

## 4. Ważne decyzje dotyczące bezpieczeństwa

- Nie publikujemy prywatnych map w publicznym hostingu statycznym.
- Nie przechowujemy sekretów w kodzie.
- Niezalogowany użytkownik nie może pobierać danych map.
- Uprawnienia są sprawdzane po stronie serwera.
- Screenshoty prywatnych lokalizacji nie mogą być dostępne przez niechronione linki.

## 5. Zasady dalszego rozwoju

- Większe zmiany najpierw testujemy.
- Przed migracją wykonujemy kopię zapasową.
- Zmiany bazy danych wykonujemy poprzez kontrolowane migracje.
- Nie usuwamy dotychczasowych danych podczas zmiany interfejsu.
- Nowe funkcje dodajemy w możliwie niezależnych modułach.

## 6. Status decyzji

Dokument jest roboczy.
Decyzje mogą być zmieniane wraz z rozwojem projektu.
