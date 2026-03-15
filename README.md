# Termux AI Assistant

Osobisty asystent AI działający lokalnie na Android (Termux + Ollama), dostępny przez Telegram.

## Funkcjonalności

- 💬 **Konwersacja** z pamięcią kontekstu (auto-summarisation gdy za długa)
- 🧠 **Pamięć persystentna** faktów o Tobie (`/remember`, `/memory`, `/forget`)
- 📝 **Notatki** (`/note`, `/notes`)
- ✅ **Todo list** (`/task`, `/todo`, `/done`)
- 🔍 **Web search** DuckDuckGo bez klucza API (`/search` lub auto)
- ⚡ **Inteligentny routing modeli** — mały model do prostych zadań, duży do kodowania
- 💻 **Code execution** — bot pisze i odpala kod JS (`/run`)
- 🎭 **Persony** — zmień charakter asystenta (`/persona coder`, `/persona planner`)
- 🔀 **Multi-model** — przełącz model ręcznie (`/model llama3:8b`)

## Instalacja w Termux

```bash
# 1. Upewnij się, że Ollama działa
ollama serve &
ollama pull llama3.2:3b   # szybki model
ollama pull llama3:8b     # mocny model

# 2. Zainstaluj Node.js (jeśli nie masz)
pkg install nodejs

# 3. Sklonuj / skopiuj projekt
cd ~/projects/termux-ai-assistant

# 4. Zainstaluj zależności
npm install

# 5. Skonfiguruj
cp .env.example .env
# Wypełnij TELEGRAM_BOT_TOKEN w .env (token od @BotFather)
# Opcjonalnie: ALLOWED_USER_IDS=TwojeID

# 6. Uruchom
npm start
```

## Konfiguracja (.env)

| Zmienna | Opis | Domyślnie |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bota z @BotFather | — |
| `ALLOWED_USER_IDS` | Dozwolone ID (puste = wszyscy) | — |
| `OLLAMA_BASE_URL` | Adres Ollamy | `http://127.0.0.1:11434` |
| `MODEL_SMALL` | Szybki model (proste zadania) | `llama3.2:3b` |
| `MODEL_LARGE` | Mocny model (kodowanie, analiza) | `llama3:8b` |
| `CONTEXT_TOKEN_LIMIT` | Próg tokenów do sumaryzacji | `3000` |

## Routing modeli (automatyczny)

Bot automatycznie wybiera model na podstawie treści wiadomości:

| Task | Model |
|---|---|
| Czat, notatki, todo, pamięć | ⚡ `MODEL_SMALL` |
| Kodowanie, debugging, analiza | 🧠 `MODEL_LARGE` |
| Długie wiadomości (>200 znaków) | 🧠 `MODEL_LARGE` |
| Ręczny override `/model name` | Ustawiony przez użytkownika |

## Komendy

| Komenda | Opis |
|---|---|
| `/start` | Pomoc i lista komend |
| `/status` | Status systemu (Ollama, modele) |
| `/clear` | Wyczyść kontekst rozmowy |
| `/model [name]` | Przełącz model Ollama |
| `/models` | Lista dostępnych modeli |
| `/persona [name]` | Zmień osobowość (`default`, `coder`, `polish`, `researcher`, `planner`) |
| `/remember [fakt]` | Zapisz fakt o sobie |
| `/memory` | Pokaż zapamiętane fakty |
| `/forget` | Wyczyść pamięć |
| `/note [tekst]` | Dodaj notatkę |
| `/notes` | Pokaż notatki |
| `/task [tekst]` | Dodaj zadanie do listy |
| `/todo` | Pokaż listę zadań |
| `/done [n]` | Oznacz zadanie n jako done |
| `/search [query]` | Szukaj w DuckDuckGo |
| `/run [kod JS]` | Uruchom kod JavaScript |

## Struktura projektu

```
termux-ai-assistant/
├── index.js                  # Entry point
├── config/
│   └── personas.json         # System prompts
├── src/
│   ├── agent/
│   │   └── router.js         # Inteligentny routing modeli
│   ├── db/
│   │   └── database.js       # JSON persistence layer
│   ├── handlers/
│   │   └── commands.js       # Telegram command handlers
│   ├── llm/
│   │   └── ollama.js         # Ollama client + summarisation
│   └── tools/
│       ├── search.js         # DuckDuckGo web search
│       └── coder.js          # JS code execution
└── data/                     # JSON data files (gitignored)
    ├── chat.json
    ├── memory.json
    ├── notes.json
    ├── todos.json
    └── config.json
```

## Działanie w tle (Termux)

```bash
# Zainstaluj termux-services lub użyj nohup
nohup npm start > assistant.log 2>&1 &
echo "Bot PID: $!"
```
