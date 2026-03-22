# DEVLOG — Termux AI Assistant

## 2026-03-22 — Session 2: code review + 3 new features + streaming

### Files changed
- **`src/tools/summarizer.js`** (NEW) — fetch URL, strip HTML, summarize via LLM (OR_MODEL_MEDIUM)
- **`src/handlers/nlRouter.js`** — added `summarize_url` + `daily_digest` intents; URL_PRECHECK_RE, SUMMARIZE_TRIGGER_RE, DAILY_DIGEST_RE prechecks; CHAT_OVERRIDE gap widened `.{0,15}` → `.{0,40}`; `callLLM` now logs warning when both providers fail; `SCHEDULE_ADD_RE` limit `.{0,40}` → `.{0,100}`
- **`src/handlers/commands.js`** — `summarize_url` + `daily_digest` cases in executeIntent(); `/sum` + `/dzisiaj` slash commands; streaming via `chatStream` with `setInterval`-based debounced edits (800ms); 3× inline `require(briefingScheduler)` removed; `handleSearch` escapes query with `esc()`
- **`src/llm/openrouter.js`** — `completeStream()` SSE parser
- **`src/llm/ollama.js`** — `completeRawStream()` NDJSON parser
- **`src/llm/client.js`** — `chatStream()` with non-streaming fallback on error
- **`config/personas.json`** — Telegram Markdown V1 rules added to `planner` and `polish` personas

### Key behavior changes
- `/sum <url>` or pasting URL + "podsumuj" → fetches page, LLM streszcza w 4-5 zdaniach
- `/dzisiaj` or "co mam dziś" → aggreguje todos + dzisiejsze przypomnienia + zaplanowane wyszukiwania
- Wszystkie odpowiedzi czatu streamowane (token po tokenie, edit co 800ms)
- Routing: "zaplanuj sobie jutro trasę o 8:00" nie trafia już do schedule_add (CHAT_OVERRIDE fix)

### Commits
- `f44ccda` — code review fixes (inline require, esc(), CHAT_OVERRIDE, personas)
- `ddb67a5` — SCHEDULE_ADD_RE limit 40→100
- `a2225c9` — feat: URL summarizer, daily digest, streaming (initial)
- `83774dc` — fix: summarizer uses medium model, streaming setInterval

### Pending
- Przetestować streaming na Minisforum (Ollama) — czy NDJSON parser działa tak samo jak SSE
- Rozważyć `/export` (backup wszystkich danych) jako kolejna funkcjonalność

## 2026-03-22 — Unified NL router (nlRouter.js)

### Files changed
- **`src/handlers/nlRouter.js`** (NEW) — replaces intentHandler.js + scattered regex routing; single LLM call classifies every message into `bot_command | web_search | chat`; 8s timeout, always falls back to `chat`
- **`src/handlers/commands.js`** — removed intentHandler import, TRIGGER_RE, needsSearch, isBotCommand guard, 5 NL routing regex blocks; added nlRouter, READ_ONLY_INTENTS set, showConfirmation(), extractWeatherCity(), new list intents in executeIntent() (list_todos, list_notes, list_reminders, list_memory, list_schedules, list_feeds)
- **`src/handlers/intentHandler.js`** — DELETED (superseded by nlRouter.js)

### Key behavior changes
- Every plain-text message now goes through one LLM router call instead of regex heuristics
- "Sprawdź pogodę" → web_search → weather tool (no longer misses)
- "Pokaż zadania/notatki/przypomnienia/pamięć" → bot_command/list_* (no longer hits web search)
- Weather queries with city name → direct Open-Meteo lookup (no web search intermediary)
- LLM router timeout: 8s → falls back to chat on any error

### Pending
- Test all routing paths in Telegram (see DEVLOG plan verification table)
- Consider /update on Minisforum + phone to deploy

## 2026-03-21 — Briefing bugfix + web search + /update + auto-restart

### Files changed
- **`src/tools/briefing.js`** — BUGFIX: missing `await` on `filterNew`, `applyKeywordFilter`, `markSeen` call sites in `buildMorning` + `buildEvening` (caused "Brak nowych pozycji" every time)
- **`src/handlers/commands.js`** — expanded `needsSearch` heuristics (dzisiaj/wczoraj/wyniki/kto wygrał/news/kurs/crypto); added `/update` command (git fetch → diff → pull → npm install if package.json changed → process.exit(0)); added to `/help`
- **`config/personas.json`** — default persona now mentions web search capability; removed "running locally via Ollama" claim
- **`start.js`** (NEW) — self-restarting wrapper; `node start.js` instead of `node index.js`; restarts automatically on exit (e.g. after `/update`); Ctrl+C stops completely

### Pending (test tomorrow)
- Full integration test: Turso migration, instance lock, briefing dedup, web search auto-trigger, `/update`
- Run `node src/db/migrate.js` on Minisforum before first start with Turso
- Setup on Galaxy S8+ / Termux

## 2026-03-21 — Turso cloud DB migration + instance lock

### Files changed
- **`src/db/turso.js`** (NEW) — libsql client singleton
- **`src/db/database.js`** (REWRITE) — full async Turso SQL layer; identical export interface
- **`src/db/instanceLock.js`** (NEW) — distributed lock via `instance_lock` table; 15s heartbeat, 45s expiry, standby polls 30s
- **`src/db/migrate.js`** (NEW) — one-time migration script from JSON flat files to Turso
- **`src/llm/client.js`** — added `await` to db calls
- **`src/tools/briefing.js`** — made `filterNew`, `markSeen`, `applyKeywordFilter` async; added `await` to db calls
- **`src/scheduler/briefingScheduler.js`** — made `init` and `reload` async
- **`src/scheduler/scheduler.js`** — made `init` async
- **`src/tools/reminder.js`** — made `init` async; `persist()` now fire-and-forgets async save
- **`src/handlers/commands.js`** — added `await` to all ~30 db.* calls
- **`src/handlers/briefingCmd.js`** — added `await` to all db.* calls
- **`index.js`** — added `db.init()`, instance lock acquisition, graceful shutdown SIGINT/SIGTERM
- **`.env.example`** — added `TURSO_URL` and `TURSO_AUTH_TOKEN`

### Setup required
1. Add to `.env` on each machine:
   ```
   TURSO_URL=libsql://ai-assistant-krexator.aws-eu-west-1.turso.io
   TURSO_AUTH_TOKEN=<token>
   ```
2. Run migration once on Minisforum (if existing JSON data): `node src/db/migrate.js`
3. Start bot on Minisforum → should log `[lock] Acquired`
4. Start bot on Galaxy S8+ → should log `[lock] Standby`

### Previous sessions
- 2026-03-20 — NL intent pipeline with confirmation buttons; briefing dedup fix; schedule NL patterns; callback_query fix; OR model fixes; bot capabilities in persona
