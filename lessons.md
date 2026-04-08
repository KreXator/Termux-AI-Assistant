## [2026-03-24] — Scheduler & Geocoding Reliability
**[PATTERN]**
Context: Fixing weather extraction and telegram markdown errors.
Mistake: Fixed `commands.js` but forgot `scheduler.js` used a separate regex. Also, didn't account for Polish case endings in geocoding.
Rule: 
1. Always apply extraction fixes to BOTH `handlers/` and `scheduler/` if they share similar logic.
2. For Polish city names, use a normalization mapping (locative -> nominative) before geocoding.
3. Automated push messages (schedulers) MUST have a Markdown-to-Plain-Text fallback in `sendLong` to prevent hanging on 400 Bad Request.
4. Escape special characters (`*`, `_`, `` ` ``) at the source in search tools.

# Lessons Learned — Termux AI Assistant

## 2026-03-25 — Automated Headless Backups
**[PATTERN/CRITICAL]**
Context: Enforcing the "never touch the database manually" rule and implementing automated backups.
Rule: 
1. **Double Backup Strategy**: Combine event-driven backups (Git hooks `pre-commit`, `pre-push`) with time-driven backgrounds (`node-cron` daily tasks). This ensures safety from both code deployments and time-based incidents.
2. **Environment Pathing**: Services invoked by Git hooks run from the repository root. Ensure `.env` is explicitly present in the working directory to avoid resolution issues that might occur through relative `../` traversals when scripts are run in headless modes.

## 2026-03-25 — State Guard for Persistence
 **DO**
 Context: Implementing a persistence layer that loads from DB and saves back to DB.
 Mistake: The `persist()` function was calling `db.saveReminders()` (which DELETE then INSERT) before `init()` (which loads from DB) had finished or if it failed. Result: Entire database wiped on first "add" operation if initialization was incomplete.
 Rule: Always implement an `initialized` or `loading` flag for in-memory stores that sync to DB. Prevent any writes until the initial load is successfully completed.
 
## [2026-03-25] — System Hardening & Async Safety
**[CRITICAL/PATTERN]**
Context: Preventing bot crashes from third-party library errors (libsql/hrana).
Mistake: Relying on library stability for database calls and assuming `try/catch` in high-level handlers is enough.
Rule:
1. **Lower-Level Hardening**: ALWAYS wrap database interaction functions in their own `try/catch` blocks at the source (`src/db/database.js`).
2. **Global Safety Net**: Always implement `process.on('unhandledRejection')` and `process.on('uncaughtException')` in `index.js` to catch async leaks from libraries.
3. **Deterministic Persistence**: For high-frequency calls (briefing configs, history), protect the write path to ensure a single failed DB write doesn't stall the main event loop.
4. **Resilient Regex**: Use character-aware boundaries `[^\p{L}\p{N}]` for Polish commands to ensure inflected words don't break NL routing.
