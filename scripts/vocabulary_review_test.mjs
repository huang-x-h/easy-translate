import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------
// 1. Bootstrapping jsdom with the inlined VocabularyManager
// ---------------------------------------------------------------------------

const dom = new JSDOM(
  '<!doctype html><html><body></body></html>',
  {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  },
);
const { window } = dom;

// In-memory chrome.storage.local mock
const storageStore = new Map();
window.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) {
          return Object.fromEntries(storageStore);
        }
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) {
          if (storageStore.has(key)) out[key] = storageStore.get(key);
        }
        return out;
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) {
          storageStore.set(key, value);
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
          storageStore.delete(key);
        }
      },
    },
  },
};
window.console = console;

// Use the standalone IIFE test bundle (built via vite.config.ts -> test-vocabulary.iife.js).
// It already inlines every chunk the vocabulary module depends on, so we can
// drop it straight into the JSDOM window without rewriting imports.
const vocabularyBundle = readFileSync('dist/test-vocabulary.iife.js', 'utf8');
window.eval(vocabularyBundle + '\nwindow.__VocabularyManager = __easyTranslateClasses.VocabularyManager;');
const VM = window.__VocabularyManager;
assert.ok(VM, 'VocabularyManager should be exposed on window');

// ---------------------------------------------------------------------------
// 2. getTodayEntries only returns entries created today (local time)
// ---------------------------------------------------------------------------

// Pin a deterministic "now" so the assertions do not depend on the system
// clock. We reach into storage after each saveEntry call to rewrite the
// createdAt/updatedAt to fixed timestamps.
const now = new Date('2025-04-15T10:00:00');
const startOfToday = new Date(now);
startOfToday.setHours(0, 0, 0, 0);
const yesterday = new Date(startOfToday);
yesterday.setDate(yesterday.getDate() - 1);

await VM.saveEntry({
  originalText: 'yesterday-word',
  translation: '昨天的词',
  targetLang: 'zh-CN',
  sourceUrl: 'https://example.com/yesterday',
});
const yesterdayEntryId = Array.from(storageStore.keys()).find((k) => k.startsWith('vocab_'));
const yesterdayEntry = storageStore.get(yesterdayEntryId);
yesterdayEntry.createdAt = yesterday.getTime();
yesterdayEntry.updatedAt = yesterday.getTime();
storageStore.set(yesterdayEntryId, yesterdayEntry);

await VM.saveEntry({
  originalText: 'today-word-one',
  translation: '今天的词一',
  targetLang: 'zh-CN',
  sourceUrl: 'https://example.com/one',
});
const todayOneId = Array.from(storageStore.keys()).filter((k) => k.startsWith('vocab_'))
  .find((k) => storageStore.get(k).originalText === 'today-word-one');
const todayOneEntry = storageStore.get(todayOneId);
todayOneEntry.createdAt = now.getTime();
todayOneEntry.updatedAt = now.getTime();
storageStore.set(todayOneId, todayOneEntry);

await VM.saveEntry({
  originalText: 'today-word-two',
  translation: '今天的词二',
  targetLang: 'zh-CN',
  sourceUrl: 'https://example.com/two',
});
const todayTwoId = Array.from(storageStore.keys()).filter((k) => k.startsWith('vocab_'))
  .find((k) => storageStore.get(k).originalText === 'today-word-two');
const todayTwoEntry = storageStore.get(todayTwoId);
todayTwoEntry.createdAt = now.getTime();
todayTwoEntry.updatedAt = now.getTime();
storageStore.set(todayTwoId, todayTwoEntry);

const todayEntries = await VM.getTodayEntries(now.getTime());
assert.equal(todayEntries.length, 2, 'only the two entries created today should be returned');
const actualTexts = todayEntries.map((e) => e.originalText);
assert.equal(
  JSON.stringify(actualTexts),
  JSON.stringify(['today-word-one', 'today-word-two']),
  'today entries should be returned in insertion order',
);
assert.ok(
  todayEntries.every((e) => e.createdAt >= startOfToday.getTime()),
  'every returned entry must be at or after today midnight',
);

// ---------------------------------------------------------------------------
// 3. markReviewed increments reviewCount and records lastReviewedAt
// ---------------------------------------------------------------------------

const firstToday = todayEntries[0];
const beforeReview = storageStore.get(firstToday.id);
assert.equal(beforeReview.reviewCount, undefined, 'reviewCount should be absent before first review');

const updated = await VM.markReviewed(firstToday.id);
assert.ok(updated, 'markReviewed should return the updated entry');
assert.equal(updated.reviewCount, 1, 'reviewCount should be incremented to 1');
assert.ok(typeof updated.lastReviewedAt === 'number' && updated.lastReviewedAt > 0, 'lastReviewedAt should be a positive number');
assert.equal(updated.updatedAt, updated.lastReviewedAt, 'updatedAt should follow the review timestamp');

const updatedAgain = await VM.markReviewed(firstToday.id);
assert.equal(updatedAgain.reviewCount, 2, 'subsequent reviews should keep incrementing reviewCount');

// ---------------------------------------------------------------------------
// 4. Reading from a different "today" reference excludes stale entries
// ---------------------------------------------------------------------------

const tomorrow = new Date(startOfToday);
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowEntries = await VM.getTodayEntries(tomorrow.getTime());
assert.equal(tomorrowEntries.length, 0, 'no entries should be considered "today" when reading from tomorrow');

// ---------------------------------------------------------------------------
// 5. enrichWithPronunciation fills in phonetic + audio via dictionaryapi.dev
// ---------------------------------------------------------------------------

// Mock the network for the dictionary lookup.
let lastFetchUrl = null;
let mockDictionaryResponse = null;
window.fetch = async (url) => {
  lastFetchUrl = url;
  if (url.startsWith('https://api.dictionaryapi.dev/')) {
    if (!mockDictionaryResponse) {
      return { ok: false, json: async () => null };
    }
    return {
      ok: true,
      json: async () => mockDictionaryResponse,
    };
  }
  return { ok: true, text: async () => '', json: async () => ({}) };
};

// Save an entry without pronunciation and verify enrichment patches it.
await VM.saveEntry({
  originalText: 'ephemeral',
  translation: '短暂的',
  targetLang: 'zh-CN',
  sourceUrl: 'https://example.com/ephemeral',
});
const enrichableId = Array.from(storageStore.keys()).filter((k) => k.startsWith('vocab_'))
  .find((k) => storageStore.get(k).originalText === 'ephemeral');

mockDictionaryResponse = [
  {
    word: 'ephemeral',
    phonetic: '/ɪˈfem(ə)rəl/',
    phonetics: [
      { text: '/ɪˈfem(ə)rəl/', audio: 'https://audio.example.com/ephemeral.mp3' },
    ],
  },
];

const enriched = await VM.enrichWithPronunciation(enrichableId);
assert.ok(enriched, 'enrichWithPronunciation should return the entry');
assert.equal(enriched.pronunciation, '/ɪˈfem(ə)rəl/', 'pronunciation should be filled in from the dictionary response');
assert.equal(enriched.audioUrl, 'https://audio.example.com/ephemeral.mp3', 'audio URL should be filled in from the dictionary response');
assert.equal(lastFetchUrl, 'https://api.dictionaryapi.dev/api/v2/entries/en/ephemeral', 'dictionaryapi.dev should be queried with the lookup URL');
assert.equal(
  storageStore.get(enrichableId).pronunciation,
  '/ɪˈfem(ə)rəl/',
  'enrichment should persist pronunciation back to storage',
);

// Calling again should be a no-op (already has pronunciation).
lastFetchUrl = null;
const reEnriched = await VM.enrichWithPronunciation(enrichableId);
assert.equal(reEnriched.pronunciation, '/ɪˈfem(ə)rəl/', 'pronunciation should be preserved');
assert.equal(lastFetchUrl, null, 'a second enrich should not re-hit the network when pronunciation is already present');

// Non-English text should be skipped without hitting the network.
await VM.saveEntry({
  originalText: '你好世界',
  translation: 'hello world',
  targetLang: 'zh-CN',
});
const chineseId = Array.from(storageStore.keys()).filter((k) => k.startsWith('vocab_'))
  .find((k) => storageStore.get(k).originalText === '你好世界');
lastFetchUrl = null;
const chineseResult = await VM.enrichWithPronunciation(chineseId);
assert.equal(chineseResult.pronunciation, undefined, 'non-English text should remain without pronunciation');
assert.equal(lastFetchUrl, null, 'non-English text should not trigger a network call');

console.log('PASS: daily review vocabulary selection and review tracking work correctly');