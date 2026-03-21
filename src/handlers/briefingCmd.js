/**
 * briefingCmd.js — /briefing command handler
 *
 * Subcommands:
 *   /briefing                        — show status
 *   /briefing add <url> <label> [category]  — add RSS feed
 *   /briefing remove <label>         — remove feed
 *   /briefing list                   — list configured feeds
 *   /briefing on                     — enable morning+evening
 *   /briefing off                    — disable all
 *   /briefing time morning HH:MM     — set morning time
 *   /briefing time evening HH:MM     — set evening time
 *   /briefing now morning|evening    — trigger immediately
 */
'use strict';

const db        = require('../db/database');
const bScheduler = require('../scheduler/briefingScheduler');

const HELP = `
*📰 /briefing — Poranny i wieczorny raport*

\`/briefing\` — status
\`/briefing on\` — włącz raporty (domyślnie 08:00 i 20:00)
\`/briefing off\` — wyłącz raporty
\`/briefing time morning 07:30\` — zmień godzinę poranną
\`/briefing time evening 21:00\` — zmień godzinę wieczorną
\`/briefing add <url> <label>\` — dodaj feed RSS
\`/briefing add <url> <label> jobs\` — dodaj z kategorią
\`/briefing remove <label>\` — usuń feed
\`/briefing list\` — lista feedów
\`/briefing keywords add <słowo>\` — dodaj filtr ofert pracy
\`/briefing keywords remove <słowo>\` — usuń filtr
\`/briefing keywords list\` — lista filtrów
\`/briefing now morning\` — wyślij teraz poranny raport
\`/briefing now evening\` — wyślij teraz wieczorny raport

*Przykładowe feedy:*
\`/briefing add https://remotive.io/rss/remote-jobs/product remotive jobs\`
\`/briefing add https://justjoin.it/rss.xml justjoinit jobs\`
`.trim();

async function handle(bot, msg, args) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const sub    = args[0]?.toLowerCase();

  // store chatId so scheduler can send proactive messages
  await db.setBriefingConfig(userId, { chatId });

  // ── /briefing (no args) ───────────────────────────────────────────────────
  if (!sub) {
    const cfg      = await db.getBriefingConfig(userId);
    const feeds    = await db.getBriefingFeeds(userId);
    const keywords = await db.getBriefingKeywords(userId);
    const lines = [
      `*📰 Daily Briefing — status*`,
      ``,
      `Poranny raport: ${cfg.morningEnabled ? `✅ ${cfg.morningTime}` : '❌ wyłączony'}`,
      `Wieczorny raport: ${cfg.eveningEnabled ? `✅ ${cfg.eveningTime}` : '❌ wyłączony'}`,
      ``,
      `Feedy RSS: ${feeds.length ? feeds.map(f => `\`${f.label}\``).join(', ') : '_brak_'}`,
      `Filtry ofert (jobs): ${keywords.length ? keywords.map(k => `\`${k}\``).join(', ') : '_brak (wszystkie oferty)_'}`,
      ``,
      `Użyj \`/briefing help\` po więcej opcji.`,
    ];
    return bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  }

  // ── /briefing help ────────────────────────────────────────────────────────
  if (sub === 'help') {
    return bot.sendMessage(chatId, HELP, { parse_mode: 'Markdown' });
  }

  // ── /briefing on ─────────────────────────────────────────────────────────
  if (sub === 'on') {
    const feeds = await db.getBriefingFeeds(userId);
    if (!feeds.length) {
      return bot.sendMessage(chatId,
        '⚠️ Najpierw dodaj feed RSS:\n`/briefing add <url> <label>`',
        { parse_mode: 'Markdown' }
      );
    }
    await db.setBriefingConfig(userId, { morningEnabled: true, eveningEnabled: true, chatId });
    await bScheduler.reload(userId, chatId);
    const cfg = await db.getBriefingConfig(userId);
    return bot.sendMessage(chatId,
      `✅ Raporty włączone.\nPoranny: *${cfg.morningTime}* | Wieczorny: *${cfg.eveningTime}*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /briefing off ─────────────────────────────────────────────────────────
  if (sub === 'off') {
    await db.setBriefingConfig(userId, { morningEnabled: false, eveningEnabled: false });
    await bScheduler.reload(userId, chatId);
    return bot.sendMessage(chatId, '⏹ Raporty wyłączone.');
  }

  // ── /briefing time morning|evening HH:MM ─────────────────────────────────
  if (sub === 'time') {
    const type = args[1]?.toLowerCase();
    const time = args[2];
    if (!['morning', 'evening'].includes(type) || !time?.match(/^\d{1,2}:\d{2}$/)) {
      return bot.sendMessage(chatId,
        'Użycie: `/briefing time morning HH:MM` lub `/briefing time evening HH:MM`',
        { parse_mode: 'Markdown' }
      );
    }
    const key = type === 'morning' ? 'morningTime' : 'eveningTime';
    await db.setBriefingConfig(userId, { [key]: time });
    await bScheduler.reload(userId, chatId);
    return bot.sendMessage(chatId,
      `✅ Godzina ${type === 'morning' ? 'porannego' : 'wieczornego'} raportu: *${time}*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /briefing add <url> <label> [category] ────────────────────────────────
  if (sub === 'add') {
    const url      = args[1];
    const label    = args[2];
    const category = args[3] || 'general';
    if (!url || !label) {
      return bot.sendMessage(chatId,
        'Użycie: `/briefing add <url> <label> [category]`\nKategorie: `jobs`, `news`, `tech`, `general`',
        { parse_mode: 'Markdown' }
      );
    }
    await db.addBriefingFeed(userId, url, label, category);
    return bot.sendMessage(chatId,
      `✅ Feed dodany: \`${label}\` (${category})\n${url}`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── /briefing remove <label> ──────────────────────────────────────────────
  if (sub === 'remove') {
    const label = args.slice(1).join(' ');
    if (!label) {
      return bot.sendMessage(chatId, 'Użycie: `/briefing remove <label>`', { parse_mode: 'Markdown' });
    }
    const ok = await db.removeBriefingFeed(userId, label);
    return bot.sendMessage(chatId, ok ? `✅ Feed \`${label}\` usunięty.` : `❌ Nie znaleziono feeda \`${label}\`.`, { parse_mode: 'Markdown' });
  }

  // ── /briefing list ────────────────────────────────────────────────────────
  if (sub === 'list') {
    const feeds = await db.getBriefingFeeds(userId);
    if (!feeds.length) {
      return bot.sendMessage(chatId, '_Brak skonfigurowanych feedów._\nDodaj: `/briefing add <url> <label>`', { parse_mode: 'Markdown' });
    }
    const lines = [`*📰 Twoje feedy RSS (${feeds.length}):*`, ''];
    for (const f of feeds) {
      lines.push(`• \`${f.label}\` [${f.category}]\n  ${f.url}`);
    }
    return bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  }

  // ── /briefing keywords add|remove|list ───────────────────────────────────
  if (sub === 'keywords') {
    const action  = args[1]?.toLowerCase();
    const keyword = args.slice(2).join(' ').trim();

    if (action === 'list') {
      const kws = await db.getBriefingKeywords(userId);
      if (!kws.length) {
        return bot.sendMessage(chatId,
          '_Brak filtrów. Dodaj: `/briefing keywords add <słowo>`_\n' +
          '_Bez filtrów — wszystkie oferty z kategorii jobs są pokazywane._',
          { parse_mode: 'Markdown' }
        );
      }
      return bot.sendMessage(chatId,
        `*🔍 Filtry ofert pracy (${kws.length}):*\n${kws.map(k => `• \`${k}\``).join('\n')}`,
        { parse_mode: 'Markdown' }
      );
    }

    if (action === 'add') {
      if (!keyword) {
        return bot.sendMessage(chatId, 'Użycie: `/briefing keywords add <słowo>`', { parse_mode: 'Markdown' });
      }
      const added = await db.addBriefingKeyword(userId, keyword);
      return bot.sendMessage(chatId,
        added ? `✅ Filtr \`${keyword.toLowerCase()}\` dodany.` : `ℹ️ Filtr \`${keyword.toLowerCase()}\` już istnieje.`,
        { parse_mode: 'Markdown' }
      );
    }

    if (action === 'remove') {
      if (!keyword) {
        return bot.sendMessage(chatId, 'Użycie: `/briefing keywords remove <słowo>`', { parse_mode: 'Markdown' });
      }
      const ok = await db.removeBriefingKeyword(userId, keyword);
      return bot.sendMessage(chatId,
        ok ? `✅ Filtr \`${keyword.toLowerCase()}\` usunięty.` : `❌ Nie znaleziono filtru \`${keyword.toLowerCase()}\`.`,
        { parse_mode: 'Markdown' }
      );
    }

    return bot.sendMessage(chatId,
      'Użycie: `/briefing keywords add|remove|list [słowo]`',
      { parse_mode: 'Markdown' }
    );
  }

  // ── /briefing now morning|evening ─────────────────────────────────────────
  if (sub === 'now') {
    const type = args[1]?.toLowerCase();
    if (!['morning', 'evening'].includes(type)) {
      return bot.sendMessage(chatId, 'Użycie: `/briefing now morning` lub `/briefing now evening`', { parse_mode: 'Markdown' });
    }
    const feeds = await db.getBriefingFeeds(userId);
    if (!feeds.length) {
      return bot.sendMessage(chatId, '⚠️ Brak feedów. Dodaj: `/briefing add <url> <label>`', { parse_mode: 'Markdown' });
    }
    await bot.sendMessage(chatId, `⏳ Generuję ${type === 'morning' ? 'poranny' : 'wieczorny'} raport…`);
    await bScheduler.runNow(userId, chatId, type);
    return;
  }

  // ── unknown subcommand ────────────────────────────────────────────────────
  return bot.sendMessage(chatId, HELP, { parse_mode: 'Markdown' });
}

module.exports = { handle };
