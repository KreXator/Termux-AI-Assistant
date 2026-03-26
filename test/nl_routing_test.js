/**
 * test/nl_routing_test.js
 * 
 * Verifies that Natural Language Routing (Sticky Intent) correctly identifies 
 * system commands and extracts parameters without falling back to LLM/Web Search.
 */
'use strict';

// Set dummy env vars to prevent DB initialization errors
process.env.TURSO_URL = 'libsql://dummy.turso.io';
process.env.TURSO_AUTH_TOKEN = 'dummy';

const nlRouter = require('../src/handlers/nlRouter');

const testCases = [
  // Reminders
  { text: 'Dodaj przypomnienie: jutro o 19:00 karmienie ryb', expected: { intent: 'remind', params: { when: 'jutro o 19:00', text: 'karmienie ryb' } } },
  { text: 'przypomnij o 19:00 ryby', expected: { intent: 'remind', params: { when: '19:00', text: 'ryby' } } },
  { text: 'Dodaj przypomnienie jutro ryby', expected: { intent: 'remind', params: { when: 'jutro', text: 'ryby' } } },
  { text: 'remind me at 5pm to call mom', expected: { intent: 'remind', params: { when: '5pm', text: 'call mom' } } },
  { text: 'ustaw alarm na 7:00', expected: { intent: 'remind' } },
  { text: 'przypomnij mi za 30min o kawie', expected: { intent: 'remind' } },

  // Todos (add)
  { text: 'Dodaj zadanie: Wyczyścić ekspres', expected: { intent: 'todo_add', params: { task: 'Wyczyścić ekspres' } } },
  { text: 'nowe zadanie: sprzedać auto', expected: { intent: 'todo_add', params: { task: 'sprzedać auto' } } },
  { text: 'add todo: buy milk', expected: { intent: 'todo_add', params: { task: 'buy milk' } } },
  { text: 'zapisz zadanie: Naprawić kran', expected: { intent: 'todo_add', params: { task: 'Naprawić kran' } } },
  { text: 'dodaj task: wynieść śmieci', expected: { intent: 'todo_add', params: { task: 'wynieść śmieci' } } },

  // Notes (add)
  { text: 'Dodaj notatkę: Projekt X to priorytet', expected: { intent: 'note_add', params: { note: 'Projekt X to priorytet' } } },
  { text: 'zapisz notatkę kup prezent', expected: { intent: 'note_add', params: { note: 'kup prezent' } } },
  { text: 'nowa notatka: lista zakupów', expected: { intent: 'note_add', params: { note: 'lista zakupów' } } },
  { text: 'nowa notatka lista zakupów', expected: { intent: 'note_add', params: { note: 'lista zakupów' } } },

  // Memory
  { text: 'Zapamiętaj że szukam pracy jako Java Developer', expected: { intent: 'remember', params: { fact: 'szukam pracy jako Java Developer' } } },
  { text: 'remember that I like coffee', expected: { intent: 'remember', params: { fact: 'I like coffee' } } },
  { text: 'zapisz fakt: mam kota', expected: { intent: 'remember' } },

  // List Commands
  { text: 'Wyświetl listę zadań', expected: { intent: 'list_todos' } },
  { text: 'pokaż zadania', expected: { intent: 'list_todos' } },
  { text: 'moje zadania', expected: { intent: 'list_todos' } },
  { text: 'lista zadań', expected: { intent: 'list_todos' } },
  { text: 'listę zadań poproszę', expected: { intent: 'list_todos' } },
  { text: 'zadania', expected: { intent: 'list_todos' } },
  { text: 'list todos', expected: { intent: 'list_todos' } },

  { text: 'Pokaż notatki', expected: { intent: 'list_notes' } },
  { text: 'moje notatki', expected: { intent: 'list_notes' } },
  { text: 'lista notatek', expected: { intent: 'list_notes' } },
  { text: 'wyświetl notatkę', expected: { intent: 'list_notes' } },
  { text: 'pokaż notatkę', expected: { intent: 'list_notes' } },
  { text: 'listę notatek', expected: { intent: 'list_notes' } },
  { text: 'show notes', expected: { intent: 'list_notes' } },

  { text: 'Pokaż przypomnienia', expected: { intent: 'list_reminders' } },
  { text: 'lista przypomnień', expected: { intent: 'list_reminders' } },
  { text: 'moje przypomnienia', expected: { intent: 'list_reminders' } },
  { text: 'wyświetl listę przypomnień', expected: { intent: 'list_reminders' } },

  { text: 'Pokaż pamięć', expected: { intent: 'list_memory' } },
  { text: 'zapamiętane fakty', expected: { intent: 'list_memory' } },
  { text: 'moja pamięć', expected: { intent: 'list_memory' } },

  { text: 'Pokaż feedy', expected: { intent: 'list_feeds' } },
  { text: 'lista rss', expected: { intent: 'list_feeds' } },
  { text: 'moje feedy', expected: { intent: 'list_feeds' } },

  { text: 'Pokaż harmonogram', expected: { intent: 'list_schedules' } },
  { text: 'zaplanowane wyszukiwania', expected: { intent: 'list_schedules' } },

  // Briefing
  { text: 'włącz briefing', expected: { intent: 'briefing_on' } },
  { text: 'wyłącz raporty', expected: { intent: 'briefing_off' } },
  { text: 'odpal briefing', expected: { intent: 'briefing_run_now', params: { type: 'morning' } } },
  { text: 'generuj wieczorny briefing', expected: { intent: 'briefing_run_now', params: { type: 'evening' } } },

  // System
  { text: 'wyczyść historię', expected: { intent: 'clear_history' } },
  { text: 'usuń czat', expected: { intent: 'clear_history' } },
  { text: 'zapomnij wszystko', expected: { intent: 'forget_all' } },
  { text: 'aktualizuj bota', expected: { intent: 'system_update' } },
  { text: 'zaktualizuj kod', expected: { intent: 'system_update' } },

  // Polish ordinal hours in remind (ordinals get normalized to HH:MM before capture)
  { text: 'przypomnij mi jutro o dziewiętnastej zadzwonić do mamy', expected: { intent: 'remind', params: { when: 'jutro o 19:00', text: 'zadzwonić do mamy' } } },
  { text: 'Dodaj przypomnienie: jutro o osiemnastej spotkanie z Kamilem', expected: { intent: 'remind', params: { when: 'jutro o 18:00', text: 'spotkanie z Kamilem' } } },
  { text: 'przypomnij o dwudziestej pierwszej leki', expected: { intent: 'remind', params: { when: '21:00', text: 'leki' } } },

  // Multiline / bullet todo
  { text: 'dodaj zadania:\n- kupić mleko\n- kupić chleb', expected: { intent: 'todo_add', params: { task: '- kupić mleko\n- kupić chleb' } } },

  // Fallbacks
  { text: 'Co tam u Ciebie?', expectedType: 'chat' },
  { text: 'Jaka jest dzisiaj pogoda w Berlinie?', expectedType: 'web_search' },
  { text: 'Ile kosztuje Bitcoin?', expectedType: 'web_search' },
  { text: 'Napisz funkcję w JS', expectedType: 'chat' },
  { text: 'Who is Elon Musk?', expectedType: 'web_search' },
];

async function runTests() {
  console.log('🧪 Starting NL Routing Tests...\n');
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const result = nlRouter.precheck(tc.text);
    
    let isOk = false;
    if (tc.expectedType) {
      isOk = (result === null && tc.expectedType !== 'bot_command') || (result?.type === tc.expectedType);
    } else {
      isOk = result?.type === 'bot_command' && 
             result.intent === tc.expected.intent &&
             (!tc.expected.params || JSON.stringify(result.params) === JSON.stringify(tc.expected.params));
    }

    if (isOk) {
      console.log(`✅ PASS: "${tc.text}"`);
      passed++;
    } else {
      console.log(`❌ FAIL: "${tc.text}"`);
      console.log(`   Expected: ${JSON.stringify(tc.expected || tc.expectedType)}`);
      console.log(`   Actual:   ${JSON.stringify(result)}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
