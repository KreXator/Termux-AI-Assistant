## [2026-03-24] — Scheduler & Geocoding Reliability
**[PATTERN]**
Context: Fixing weather extraction and telegram markdown errors.
Mistake: Fixed `commands.js` but forgot `scheduler.js` used a separate regex. Also, didn't account for Polish case endings in geocoding.
Rule: 
1. Always apply extraction fixes to BOTH `handlers/` and `scheduler/` if they share similar logic.
2. For Polish city names, use a normalization mapping (locative -> nominative) before geocoding.
3. Automated push messages (schedulers) MUST have a Markdown-to-Plain-Text fallback in `sendLong` to prevent hanging on 400 Bad Request.
4. Escape special characters (`*`, `_`, `` ` ``) at the source in search tools.

## [2026-03-25] — Anti-Hallucination & Time Parsing
**[CRITICAL/PATTERN]**
Context: Fixing hallucinations and relative time parsing for reminders.
Mistake: LLM classification for "jutro" was unreliable (sometimes chat, sometimes web).
Rule:
1. Always implement **deterministic regex pre-checks** inside `nlRouter.js` for high-risk intents (reminders, todos).
2. For relative dates like "jutro", normalization in `reminder.js` must happen BEFORE absolute time parsing.
3. Use a strict **STRIKT ANTI-HALLUCINATION RULE** in `personas.json` to force the bot into "interface-only" mode.
4. Don't rely on LLM for parameter extraction if the pattern is simple enough for regex (boosts speed + reliability).
