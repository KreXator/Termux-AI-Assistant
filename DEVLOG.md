# DEVLOG — Termux AI Assistant

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
