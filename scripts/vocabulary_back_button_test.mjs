import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------
// Regression test for the "返回生词本" button that visually did nothing.
//
// Root cause: the review panel, summary, and answer block all set
// `display: flex` in vocabulary.css. Author CSS outranks the browser's
// default `[hidden] { display: none }` user-agent rule, so toggling
// `.hidden = true` did not collapse the element. The click handler ran
// (no JS error) but the panel stayed on screen.
//
// This test guards against regressions in two ways:
//   1. Static check: vocabulary.css must contain explicit `[hidden]`
//      overrides for the elements that set `display: flex`.
//   2. Dynamic check: load the production options page + bundled options.js
//      and walk through the full review flow. After clicking the back
//      button the panel's `hidden` attribute must be true.
// ---------------------------------------------------------------------------

const css = readFileSync('src/options/vocabulary.css', 'utf8');

// 1. Static: CSS must contain explicit `[hidden]` overrides for the
//    elements that set their own `display`.
const requiredSelectors = [
  '.vocab-review-banner[hidden]',
  '.vocab-review-panel[hidden]',
  '.vocab-review-summary[hidden]',
  '.vocab-review-answer[hidden]',
  '.vocab-review-audio[hidden]',
];
for (const selector of requiredSelectors) {
  assert.ok(
    css.includes(selector),
    `vocabulary.css must include a rule for ${selector} so the hidden attribute actually hides the element`,
  );
}

// 2. Dynamic: simulate the full review round-trip and verify the panel's
//    hidden attribute flips back and forth correctly.

const html = readFileSync('src/options/index.html', 'utf8');
const optionsJs = readFileSync('dist/options.js', 'utf8');
const { readdirSync } = await import('node:fs');
const assetsDir = 'dist/assets';
const storageFile = readdirSync(assetsDir).find((f) => f.startsWith('storage-') && f.endsWith('.js'));
const vocabFile = readdirSync(assetsDir).find((f) => f.startsWith('vocabulary-') && f.endsWith('.js'));
assert.ok(storageFile, 'storage chunk must exist in dist/assets');
assert.ok(vocabFile, 'vocabulary chunk must exist in dist/assets');
const storageSource = readFileSync(`${assetsDir}/${storageFile}`, 'utf8');
const vocabSource = readFileSync(`${assetsDir}/${vocabFile}`, 'utf8');
const typesFile = readdirSync(assetsDir).find((f) => f.startsWith('types-') && f.endsWith('.js'));
assert.ok(typesFile, `expected types chunk in ${assetsDir}`);
const typesSource = readFileSync(`${assetsDir}/${typesFile}`, 'utf8');

const dom = new JSDOM(html, {
  url: 'chrome-extension://test/options.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// In-memory chrome.storage.local so the page sees today's entries.
const storageStore = new Map();
window.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    onMessage: { addListener() {} },
  },
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
window.fetch = async () => ({ ok: false, text: async () => '', json: async () => ({}) });
window.console = console;
window.Audio = class {
  constructor() {}
  play() { return Promise.resolve(); }
};
window.confirm = () => true;
window.alert = () => undefined;

// Seed: today's entry.
const now = new Date();
storageStore.set('translation_config', {
  apiEndpoint: 'https://example.com/v1',
  apiKey: 'test-key',
  targetLang: 'zh-CN',
  model: 'test-model',
  translationStyle: 'natural',
});
storageStore.set('vocabulary_index', ['vocab_1']);
storageStore.set('vocab_1', {
  id: 'vocab_1',
  originalText: 'apple',
  normalizedText: 'apple',
  translation: '苹果',
  sourceUrl: 'https://example.com',
  targetLang: 'zh-CN',
  createdAt: now.getTime(),
  updatedAt: now.getTime(),
});

// Load the production options bundle. Inline the storage + vocabulary
// chunks directly (rolling back their import/export preamble) and strip
// the remaining import statements from options.js so jsdom can eval it
// as a single classic script. Wrap the whole thing in an IIFE so we don't
// pollute the global scope and so duplicate `const` declarations stay
// isolated.
const storageInlined = storageSource
  .replace(/^import\s+.*$/gm, '')
  .replace(/export\s*\{[\s\S]*?\};?/g, '');
const typesInlined = typesSource.replace(/export\s*\{[\s\S]*?\};?/g, '');
const vocabInlined = vocabSource
  .replace(/^import\s+.*$/gm, '')
  .replace(/export\s*\{[\s\S]*?\};?/g, '');
const optionsStripped = optionsJs.replace(/^import\s+.*$/gm, '');
const optionsBundle = `
  (function () {
    ${typesInlined}
    ${storageInlined}
    ${vocabInlined}
    ${optionsStripped}
  })();
`;
window.eval(optionsBundle);
document.dispatchEvent(new window.Event('DOMContentLoaded'));

// Allow async init (loadConfig + initVocabularyManager) to settle.
await new Promise((resolve) => window.setTimeout(resolve, 50));

const panel = document.querySelector('#vocabReviewPanel');
const summary = document.querySelector('#vocabReviewSummary');
const banner = document.querySelector('#vocabReviewBanner');
const backBtn = document.querySelector('#vocabReviewBackBtn');
const startBtn = document.querySelector('#vocabStartReviewBtn');

assert.ok(panel, 'review panel must exist in the markup');
assert.ok(summary, 'review summary must exist in the markup');
assert.ok(banner, 'review banner must exist in the markup');
assert.ok(backBtn, 'review back button must exist in the markup');
assert.ok(startBtn, 'review start button must exist in the markup');

// Initial state: panel + summary hidden, banner visible (today has 1 entry).
assert.equal(panel.hidden, true, 'panel should start hidden');
assert.equal(summary.hidden, true, 'summary should start hidden');
assert.equal(banner.hidden, false, 'banner should be visible when today has entries');

// Start the review: panel becomes visible, banner hides.
startBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => window.setTimeout(resolve, 20));
assert.equal(panel.hidden, false, 'panel should be visible after starting review');
assert.equal(banner.hidden, true, 'banner should be hidden during review');

// Click the "返回生词本" button.
backBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => window.setTimeout(resolve, 50));
assert.equal(
  panel.hidden,
  true,
  'panel.hidden should be true after clicking 返回生词本 (this is the regression: previously the CSS kept it visible)',
);
assert.equal(summary.hidden, true, 'summary should remain hidden');

// Going back should also restore the banner so the user can re-enter review.
assert.equal(banner.hidden, false, 'banner should re-appear after exiting review');

// Round-trip from the summary view: start review again, finish, then use
// the summary's "返回生词本" button.
startBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => window.setTimeout(resolve, 20));

const knownBtn = document.querySelector('#vocabReviewRateKnown');
knownBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => window.setTimeout(resolve, 50));

assert.equal(summary.hidden, false, 'summary should be visible after finishing review');
assert.equal(panel.hidden, true, 'panel should be hidden once summary is shown');

const doneBtn = document.querySelector('#vocabReviewDoneBtn');
doneBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((resolve) => window.setTimeout(resolve, 50));
assert.equal(
  summary.hidden,
  true,
  'summary.hidden should be true after clicking the summary 返回生词本 button',
);
assert.equal(panel.hidden, true, 'panel should remain hidden after exiting summary');

console.log('PASS: 返回生词本 button correctly toggles the review panel/summary hidden state');