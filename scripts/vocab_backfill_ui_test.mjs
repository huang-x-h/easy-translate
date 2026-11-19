// Verifies the options-page backfill banner: it appears when entries are
// missing phonetics, the "一键补全" button drives a live run, and the
// result message reflects success / skip / failure. Loads the production
// options bundle the same way the back-button test does.

import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const html = readFileSync('src/options/index.html', 'utf8');
const optionsJs = readFileSync('dist/options.js', 'utf8');
const assetsDir = 'dist/assets';

const load = (prefix) => {
  const f = readdirSync(assetsDir).find((x) => x.startsWith(prefix) && x.endsWith('.js'));
  assert.ok(f, `${prefix} chunk must exist`);
  return readFileSync(`${assetsDir}/${f}`, 'utf8');
};
const storageSource = load('shared-storage');
const vocabSource = load('shared-vocabulary');
const typesSource = load('shared-types');
// TranslationAPI lives in its own shared chunk.
const apiSource = load('shared-api');
const speechSource = load('shared-speech');
// The provider registry (engine capabilities) is its own chunk.
const providersSource = load('shared-providers');
// isChinese / isWordLike live in their own chunk; api.ts depends on
// text.ts so this chunk must be loaded for the api translate() call
// to not throw.
const textSource = load('shared-text');

const strip = (s) => s.replace(/^import\s+.*$/gm, '').replace(/export\s*\{[\s\S]*?\};?/g, '');

const dom = new JSDOM(html, {
  url: 'chrome-extension://test/options.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

const storageStore = new Map();
window.chrome = {
  runtime: { getURL: (p) => `chrome-extension://test/${p}`, onMessage: { addListener() {} } },
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries(storageStore);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (storageStore.has(k)) out[k] = storageStore.get(k);
        return out;
      },
      async set(items) { for (const [k, v] of Object.entries(items)) storageStore.set(k, v); },
      async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) storageStore.delete(k); },
    },
  },
};
window.console = console;
window.Audio = class { play() { return Promise.resolve(); } };
window.confirm = () => true;
window.alert = () => undefined;
window.fetch = async () => ({ ok: false, text: async () => '', json: async () => ({}) });

const now = Date.now();
storageStore.set('translation_config', {
  apiEndpoint: 'https://example.com/v1', apiKey: 'test-key',
  targetLang: 'zh-CN', model: 'test-model', translationStyle: 'natural',
});
// Two entries missing phonetics.
storageStore.set('vocabulary_index', ['vocab_a', 'vocab_b']);
storageStore.set('vocab_a', { id: 'vocab_a', originalText: 'apple', normalizedText: 'apple', translation: '苹果', sourceUrl: 'x', targetLang: 'zh-CN', createdAt: now, updatedAt: now });
storageStore.set('vocab_b', { id: 'vocab_b', originalText: 'banana', normalizedText: 'banana', translation: '香蕉', sourceUrl: 'x', targetLang: 'zh-CN', createdAt: now, updatedAt: now });

const optionsBundle = `(function(){\n${strip(typesSource)}\n${strip(textSource)}\n${strip(storageSource)}\n${strip(providersSource)}\n${strip(apiSource)}\n${strip(speechSource)}\n${strip(vocabSource)}\n${strip(optionsJs)}\n})();`;
window.eval(optionsBundle);
document.dispatchEvent(new window.Event('DOMContentLoaded'));

const settle = (ms = 40) => new Promise(r => window.setTimeout(r, ms));
const waitFor = async (pred, ms = 2000) => {
  const deadline = Date.now() + ms;
  for (;;) { if (pred()) return true; if (Date.now() > deadline) return false; await settle(15); }
};

const banner = document.querySelector('#vocabBackfillBanner');
const countEl = document.querySelector('#vocabBackfillCount');
const backfillBtn = document.querySelector('#vocabBackfillBtn');
const progress = document.querySelector('#vocabBackfillProgress');
const resultEl = document.querySelector('#vocabBackfillResult');

assert.ok(banner, 'backfill banner element must exist');
assert.ok(await waitFor(() => countEl.textContent === '2'),
  'banner should report 2 missing entries after the list loads');
assert.equal(banner.hidden, false, 'banner should be visible when entries lack phonetics');
assert.ok(backfillBtn, 'backfill button must exist');

// Kick off the run. fetch() returns ok:false so the LLM call fails -> the
// entries are counted as failed, but the result line must render.
backfillBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(80);

assert.ok(await waitFor(() => resultEl.hidden === false),
  'the run should complete and surface a result message');
assert.equal(progress.hidden, true, 'progress bar should hide when the run finishes');
assert.equal(backfillBtn.disabled, false, 'button should re-enable after the run');
assert.ok(resultEl.textContent.includes('不是单词'),
  'result should mention skipped entries when the LLM returned no phonetic');

console.log('PASS: options backfill banner drives a run and surfaces the result');