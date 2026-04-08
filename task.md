# Task: Termux AI Assistant

- [x] Konfiguracja projektu i narzędzi
    - [x] `npm init` z podstawowymi zależnościami (node-telegram-bot-api, lowdb, axios, duck-duck-scrape)
    - [x] Utworzenie struktury katalogów `src/`, `config/`, `data/`

- [ ] System Pamięci i Bazy Danych
    - [ ] Przygotowanie pliku w module `src/db/` na połączenie w LowDB (lub innej strukturze w czystym JSON)
    - [ ] Struktura pliku JSON do schematu notatek, historii wiadomości i persystentnych faktów

- [ ] Integracja z Ollama
    - [ ] Interfejs z Ollama (korzystając np. z axios na `http://127.0.0.1:11434`)
    - [ ] Zarządzanie kontekstem AI: wyciąganie historii z bazy i konstruowanie promptu z wiadomościami systemowymi (Personas)
    - [ ] Implementacja sumaryzowania starych wiadomości (aby nie przekraczać context window)

- [ ] Moduł Search (Web)
    - [ ] Integracja skryptu korzystającego z mechanizmów DuckDuckGo
    - [ ] Wstrzykiwanie w zapytania LLM rezultatów search'a (system pod-promptu)

- [ ] System Agenta (Inspiracja NanoBOT / OpenClaw)
    - [ ] Detektor intencji (Router API) do wyboru modelu (szybki dla prostych, mocny dla skomplikowanych zadań)
    - [ ] Implementacja narzędzia kodera (uruchamianie `node` i odczyt STDOUT z poziomu Termuxa)
- [ ] Bot Telegram - Podstawa i Routing Eventów
    - [ ] Setup long-pollingu by bot działał gładko w Termux API
    - [ ] Routing komend (`/memory`, `/notes`, `/todo`, `/clear`, `/help`, `/model`)

- [ ] Bot Telegram - Command Handlers
    - [ ] Obsługa wbudowanych w chat list (`todo`, `notes`)
    - [ ] Przełączanie w locie zdefiniowanych modeli `/model llama3` poprzez zmianę globalnej flagi preferencji

- [x] Dokumentacja i Verification
    - [x] Upewnienie się że działa w Termuxie, bez native C++
    - [x] Finalne testy end-to-end (manualne via Telegram aplikację)

- [x] Funkcje Zaawansowane (Sesja 6/7)
    - [x] Job Search Wizard (interaktywne dobieranie ofert)
    - [x] News Digest (3-kategoryjny przegląd wiadomości)
    - [x] Schedulery (Weather, News, Jobs) z obsługą błędów Markdown

- [x] Hardening i Stabilizacja (Sesja 9)
    - [x] Implementacja 30+ error boundaries w warstwie DB (`database.js`)
    - [x] Globalny safety net (`unhandledRejection`, `uncaughtException`) w `index.js`
    - [x] Refaktoryzacja regexów NL dla wsparcia polskich odmian
    - [x] Utworzenie testu reprodukcji crashu (`repro_crash.js`)
    - [x] Rozszerzenie testów NL do 58 wariantów (`nl_routing_test.js`)
