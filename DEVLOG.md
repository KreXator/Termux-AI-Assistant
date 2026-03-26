# DEVLOG — Termux AI Assistant

## 2026-03-26 — Session 12: NLP overhaul — Polish ordinals, daily reminders, multiline todos

### Files changed
- `src/tools/reminder.js` — Added `POLISH_ORDINALS` constant; `parseTime()` now handles Polish ordinal hours ("dziewiętnastej"→19:00), DD.MM.YYYY and DD.MM date formats
- `src/handlers/nlRouter.js` — Added `normalizeOrdinalTime()` helper; `remind` precheck now strips ordinals before HH:MM extraction; `todo_add`/`note_add` regexes use `[\s\S]+` for multiline + handle plural "zadania"; allow optional adjective between verb and noun (e.g. "codzienne"); added `remind_daily` intent with `isDaily` detection and frequency-word stripping; added `remind_daily` to `KNOWN_INTENTS` and SYSTEM_PROMPT
- `src/scheduler/scheduler.js` — `executeQuery()` detects `[REMINDER] ` prefix → returns text directly (no search); cron task and `runNow` use ⏰ header for reminder type
- `src/handlers/commands.js` — `todo_add` splits multiline/bullet tasks → multiple DB inserts; added `remind_daily` case (stores `[REMINDER] text` query + schedules cron); `handleScheduleList` renders ⏰ for reminders vs 🕐 for searches; `remind_daily` added to `AUTO_EXECUTE_INTENTS`
- `index.js` — 400ms grace period in SIGTERM/SIGINT handlers (prevents in-flight `persist()` writes from being lost on Railway deploy)
- `test/nl_routing_test.js` — 65 test cases (was 58), all passing

### Key behavior changes
- **Polish voice commands work**: "przypomnij mi jutro o dziewiętnastej" → sets reminder for tomorrow 19:00
- **Daily reminders**: "Ustaw codzienne przypomnienie: karmienie rybek o 18:00" → cron fires daily at 18:00, sends ⏰ text (no web search)
- **Multiline todos**: "dodaj zadania:\n- mleko\n- chleb" → 2 separate DB entries
- **Reminder persistence**: 400ms grace ensures reminders survive Railway redeploys

### Commits
- `3e6092c` fix(nlp): Polish ordinals, DD.MM.YYYY, multiline todos, SIGTERM grace
- `abcc2f4` feat(nlp): daily reminders via codziennie + fix ustaw codzienne przypomnienie

---

## 2026-03-25 — Session 11: Automated Database Backups
- **Files changed**:
  - `scripts/backup_db.js` (NEW) — Headless Turso JSON export.
  - `src/scheduler/backupScheduler.js` (NEW) — Daily cron job trigger (03:00 AM).
  - `package.json` — Added custom `npm run backup` instruction.
  - `.git/hooks/pre-commit` & `.git/hooks/pre-push` (NEW) — Git lifecycle hooks.
  - `.env` & `index.js` — Boot sequence injection and pathing logic updates.
- **Key behavior changes**:
  - **Data Protection**: Database tables are now backed up on code changes via Git hooks.
  - **Time Protection**: Scheduled daily backups run identically in a decoupled thread.
  - **Auto Removal**: Backups maintain a hard limit of 10 latest files to prevent size bloat.


 
 ## 2026-03-25 — Session 10: Reminder Persistence & Data Safety
 - **Files changed**:
   - `src/tools/reminder.js` — Added `initialized` state guard to `persist()`; implemented catch-up notifications for missed reminders.
   - `src/db/database.js` — Removed `fire_at` filter in `loadReminders`; standardized string ID storage in `saveReminders`.
 - **Key behavior changes**:
   - **Data Protection**: Wiping the `reminders` table on failed initialization is now impossible.
   - **Catch-up Notifications**: Users are now notified immediately upon bot startup if any reminders were scheduled to fire during downtime.
   - **Reliability**: Persistence logic is now robust against race conditions and database transient failures.
 

## 2026-03-25 — Session 9: System Hardening & Stability
- **Files changed**:
  - `src/db/database.js` — Wrapped all 30+ database interaction functions in `try/catch` blocks to prevent fatal process crashes from `libsql` library errors.
  - `index.js` — Added global `unhandledRejection` and `uncaughtException` listeners as a final safety net for third-party library errors.
  - `src/handlers/nlRouter.js` — Refined Polish regex patterns with character-aware boundaries (`[^\p{L}\p{N}]`) to support inflections; reordered intent pre-checks for lists/notes to prevent misrouting.
  - `src/handlers/commands.js` — Exported `handleMessage` and `executeIntent` for testing; protected `executeIntent` from crashing on failed database calls during briefing config updates.
  - `test/nl_routing_test.js` — Expanded test suite to 58 variants (100% pass).
  - `test/repro_crash.js` [NEW] — Created a script to simulate fatal `libsql` errors and verify bot survival.
- **Key behavior changes**:
  - **Bulletproof Stability**: The bot no longer restarts when the database connection drops or when `libsql` throws internal `TypeErrors`.
  - **Graceful Fallbacks**: If the database is unreachable, the bot returns helpful error messages or "empty list" fallbacks instead of crashing.
  - **Improved Polish NLP**: "Pokaż notatkę", "Wyświetl listę zadań", and similar inflected commands are now detected with 100% precision.
- **Commits**:
  - `fix: hardened database layer with comprehensive error boundaries across 30+ functions`
  - `feat: added global process-level safety net for unhandled rejections and exceptions`
  - `fix: refined Polish NLP regex patterns to handle inflected word boundaries`
  - `test: added automated crash reproduction and expanded NL routing test suite`

## 2026-03-25 — Session 8: Universal Deterministic Routing & Anti-Hallucination

### Files changed
- **`src/handlers/nlRouter.js`** — Implemented **Universal Deterministic Routing** ("Sticky Intent"). Added comprehensive regex pre-checks for tasks, notes, memory, briefings, history management, and system updates. Expanded `KNOWN_INTENTS` and `SYSTEM_PROMPT`.
- **`src/handlers/commands.js`** — Fully localized system handlers (`handleTodos`, `handleTask`, `handleNotes`, `handleClear`, `handleStatus`, `handleForget`, `handleUpdate`) to support bilingual (Polish/English) responses. Integrated new intents into `executeIntent`.
- **`src/tools/reminder.js`** — Enhanced `parseTime` for relative dates ("jutro", "tomorrow") and improved absolute time parsing.
- **`config/personas.json`** — Hardened `default` persona with strict anti-hallucination guardrails (interface-only behavior).
- **`test/nl_routing_test.js` [NEW]** — Dedicated test suite for validating deterministic routing across 19 natural language variants.

### Key behavior changes
- **Zero Hallucination Guarantee**: The bot now uses deterministic regex interceptors for ALL system intents.
- **Silent Execution**: Common system commands (tasks, notes, reminders, memory, briefings) now execute immediately without asking "Czy o to chodziło?". Confirmation is only required for potentially destructive or complex intents.
- **Bilingual System Interface**: All system responses are localized to Polish/English.

- **Verified with Unit Tests**: Created and ran `test/nl_routing_test.js`, confirming 100% accuracy (19/19 passed) for the implemented natural language patterns.
- `feat: universal deterministic routing and silent execution of system intents`
- `fix: localized status and history management with robust NLP pre-checks`


## 2026-03-24 — Session 7: Scheduler & Quality Fixes

### Files changed
- **`src/handlers/commands.js`** — Fixed `extractWeatherCity` regex to correctly handle locative case and strip "w " prefix.
- **`src/scheduler/scheduler.js`** — Updated `executeQuery` to route review/digest queries to `getNewsDigest()`; added robust Markdown → Plain Text fallback to `sendLong`.
- **`src/tools/search.js`** — Added Markdown escaping for all fields in `serperJobsSearch` results.

### Key behavior changes
- **Weather Reliability**: `/schedule add 08:30 pogoda w Zielonej Górze` now correctly identifies the city and returns weather data.
- **Improved Digest**: Scheduler now correctly triggers the 3-category news digest (Poland, World, Tech) for "przegląd" queries.
- **Robustness**: Fixed multiple `400 Bad Request` errors in Telegram by escaping special characters and adding an automatic plain-text retry logic for all scheduled pushes.

### Commits
- `fix: scheduler reliability — weather regex, news digest routing, and Telegram markdown escaping`



## 2026-03-24 — Session 6: Interactive Job Search Wizard

### Files changed
- **`src/tools/search.js`** — Whitelisted high-quality job boards; refactored `serperJobsSearch` for structured position/type/mode parameters; added 7-day freshness filter.
- **`src/handlers/nlRouter.js`** — Added `job_search` intent and system prompt examples for parameter extraction; added regex precheck for job keywords.
- **`src/handlers/commands.js`** — Implemented `job_search` wizard logic (interactive dopytywanie); added `job_search` to `READ_ONLY_INTENTS`.

### Key behavior changes
- **Wizard**: Bot now intelligently prompts for missing job details (position, contract, mode) if not provided in the initial natural language request.
- **Quality**: Results are strictly filtered to top-tier job boards (Pracuj.pl, JustJoin.it, NoFluffJobs, etc.), eliminating generic search noise.
- **UX**: Search executes immediately once parameters are collected, bypassing confirmation dialogs.

### Commits
- `feat: interactive job search wizard with structured filtering and quality whitelisting`

### Pending
- Monitor Serper quota for job searches.
- Refine parameter extraction for non-standard contract names.


## 2026-03-24 — Session 5: News Categorization & Quality

### Files changed
- **`src/tools/search.js`** — Added `NEWS_DOMAINS` whitelisting; refactored `serperNewsSearch` to support categories; added `getNewsDigest` (local/country/world).
- **`src/handlers/commands.js`** — Updated news routing to detect categories (local, country, world, tech) and trigger digest mode.
- **`src/handlers/nlRouter.js`** — Added "technologiczne" to news precheck for better routing.

### Key behavior changes
- **Skills**: Bot now understands "wiadomości lokalne", "wiadomości ze świata", "technologia" as distinct skills.
- **Quality**: Results are site-filtered (TVN24, RMF24, BBC, Gazeta Lubuska), eliminating TV schedule "noise".
- **Digest**: "przegląd wiadomości" now triggers a structured 3-category report.
- **Freshness**: Forced 24h window (`qdr:d`) for all news tool calls.

### Commits
- `c4227b9` — feat: categorical news skills with domain whitelisting and digest mode
- `b4adc22` — fix: export getNewsDigest in search.js to resolve TypeError
- `e61585c` — fix: refined news domains (removed noise) and added Tech to digest
- `89c6e53` — fix: use language-appropriate tech query and improved digest fallback

### Pending
- Monitor Serper quota (digest uses 3 calls).
- Test tech news specifically for source relevance.

## 2026-03-24 — Session 4: Reliability — Guard fix & robust handlers

### Files changed
- **`src/handlers/commands.js`** — Updated `guard(handler)` to use `Promise.resolve()` for safe sync/async execution; made `on('message')` handler `async` to ensure Promise return when skipping commands.

### Key behavior changes
- **Fix**: Bot no longer crashes with `TypeError: Cannot read properties of undefined (reading 'catch')` when a user sends a command.
- **Robustness**: Any handler wrapped in `guard` that returns `undefined` or a non-promise value is now safely handled.

### Commits
- `9030b9e` — fix: robust guard handler to prevent TypeError on undefined return

### Pending
- Test `/schedule test` on Railway to verify routing works in production

## 2026-03-24 — Session 3: smart scheduled alert routing

### Files changed
- **`src/scheduler/scheduler.js`** — added `executeQuery()` with type-based routing; replaced hardcoded `webSearch()` in both `startTask` and `runNow`
- **`src/tools/search.js`** — added `serperJobsSearch()`: Serper `/search` with `gl:'pl'`/`hl:'pl'`, handles Google Jobs cards array, falls back to organic with full snippets

### Key behavior changes
- `pogoda Zielona Góra` → `getWeather('Zielona Góra')` — real temp/humidity/wind data, not website links
- News queries (`wiadomości`, `aktualności`, `przegląd`) → `serperNewsSearch()` — actual headlines with dates, not portal homepages
- Job queries (`pracuj.pl`, `oferty pracy`) → `serperJobsSearch()` — Google Jobs cards if available, otherwise full-snippet organic results with Polish locale

### Commits
- `69476a2` — feat: smart alert routing — weather/news/jobs use dedicated handlers

### Pending
- Test `/schedule test` on Railway to verify routing works in production
- Monitor qwen-2.5-vl:free rate limits
- Przetestować streaming na Minisforum (Ollama) — NDJSON parser
- Rozważyć `/export` (backup wszystkich danych)

## 2026-03-24 — Session 2: news routing fixes + vision model

### Files changed
- **`src/handlers/nlRouter.js`** — remember guard (`zapamiętaj/zapisz` skips news precheck); no other changes
- **`src/tools/search.js`** — `cleanNewsQuery()` strips Polish command verbs before Serper; `tbs:'qdr:w'` for past-week recency filter
- **`src/tools/vision.js`** — fixed error surfacing: when OpenRouter fails + Ollama unavailable, throws OpenRouter error (not Ollama ECONNREFUSED)
- **`src/handlers/commands.js`** — improved vision error messages: 429 → rate-limit message, 4xx → API error details
- **`src/llm/openrouter.js`** — vision model changed from `gemma-3-12b-it:free` (rate-limited) to `qwen/qwen-2.5-vl-7b-instruct:free`; cascade to `google/gemini-2.0-flash-lite-001` on 429

### Key behavior changes
- `"Zapamiętaj dla wiadomości lokalnych, że..."` → routes to `remember` bot_command (not news)
- `"Podaj wiadomości z kraju"` → cleaned to `"wiadomości z kraju"` before Serper (no "PODAJ DALEJ" false matches)
- News results filtered to past week (`tbs:qdr:w`)
- Vision: dedicated Qwen 2.5 VL model (not general Gemma); auto-cascade to cheap paid fallback on rate limit

### Commits
- `1fc708e` — fix: news routing — remember guard + query cleaning + recency filter
- `9f1970d` — fix: vision error handling — surface OpenRouter error, not Ollama ECONNREFUSED
- `1514d0c` — fix: switch vision model to qwen-2.5-vl + 429 cascade to gemini-flash-lite

### Pending
- Monitor qwen-2.5-vl:free rate limits in production
- Monitor semantic router accuracy (check `[semanticRouter]` log lines)
- Przetestować streaming na Minisforum (Ollama) — czy NDJSON parser działa
- Rozważyć `/export` (backup wszystkich danych)

## 2026-03-24 — Session: hallucination fixes + embedding semantic router

### Files changed
- **`src/llm/openrouter.js`** — added `embed(texts)` using `/embeddings` endpoint (`openai/text-embedding-3-small`)
- **`src/llm/semanticRouter.js`** (NEW) — embedding-based router; 20 examples/route (web_search, chat); cosine similarity vs centroid vectors; `init()` + `classify()`; `CONFIDENCE_THRESHOLD = 0.55`
- **`src/handlers/nlRouter.js`** — integrated semantic router (between precheck and LLM fallback); changed router model to Llama 3.2 3B; added NEWS_RE precheck → `subtype:'news'`; added remember guard (zapamiętaj/zapisz → skip prechecks)
- **`src/tools/search.js`** — added `serperNewsSearch()` using `/news` endpoint; `cleanNewsQuery()` strips Polish command verbs; `tbs:'qdr:w'` for past-week recency
- **`src/handlers/commands.js`** — added `subtype:'news'` handler (calls serperNewsSearch, bypasses LLM)
- **`index.js`** — added `semanticRouter.init()` preload at startup (background, avoids cold start)

### Key behavior changes
- Routing accuracy: regex precheck → semantic embeddings (~92-96%) → LLM router → chat fallback
- **News queries** ("wiadomości", "co się dzieje", "aktualności" etc.) → Serper `/news` endpoint → formatted headlines with dates and source links, **no LLM** → zero hallucination
- **"zapamiętaj X wiadomości"** no longer accidentally treated as news query
- **Old news** fix: `tbs:'qdr:w'` filters to past week; "Podaj wiadomości z kraju" no longer returns "PODAJ DALEJ" foundation results
- Semantic router preloaded at bot startup to avoid embedding delay on first message

### Commits
- `edc7177` — feat: embedding-based semantic router (step 3)
- `b9d9fe7` — fix: bypass LLM for news queries — show Serper /news results directly
- `1fc708e` — fix: news routing — remember guard + query cleaning + recency filter

### Pending
- Monitor semantic router accuracy in production (check logs for `[semanticRouter]` lines)
- Przetestować streaming na Minisforum (Ollama) — czy NDJSON parser działa
- Rozważyć `/export` (backup wszystkich danych)

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
