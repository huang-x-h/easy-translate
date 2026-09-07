import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const contentScript = readFileSync('dist/content.js', 'utf8');

const dom = new JSDOM(
  '<!doctype html><html><body><p id="page-text">hello world</p></body></html>',
  {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  },
);

const { window } = dom;
const { document } = window;
const pageText = document.querySelector('#page-text').firstChild;

// Mock chrome.storage.local as an in-memory Map so the vocabulary manager
// behaves the same way it would in the browser.
const storageStore = new Map();
window.chrome = {
  runtime: {
    getURL: path => `chrome-extension://test/${path}`,
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

window.fetch = async () => ({
  ok: true,
  text: async () => '',
  json: async () => ({ choices: [{ message: { content: '你好' } }] }),
});
window.console = console;
window.Audio = class {
  constructor() {}
  play() { return Promise.resolve(); }
};
window.confirm = () => true;

let selectionAnchor = pageText;
let selectionText = 'hello';
window.getSelection = () => ({
  anchorNode: selectionAnchor,
  toString: () => selectionText,
  getRangeAt: () => ({
    getBoundingClientRect: () => ({
      left: 20,
      right: 80,
      top: 20,
      bottom: 40,
      width: 60,
      height: 20,
    }),
  }),
});

window.eval(contentScript);
document.dispatchEvent(new window.Event('DOMContentLoaded'));

// Provide an API key so the popup renders the translation result UI rather
// than the "set API Key first" error.
storageStore.set('translation_config', {
  apiEndpoint: 'https://example.com/v1',
  apiKey: 'test-key',
  targetLang: 'zh-CN',
  model: 'test-model',
  translationStyle: 'natural',
});

// ---------------------------------------------------------------------------
// 1. Selection popup exposes a vocabulary button with the default "未保存" state
// ---------------------------------------------------------------------------

document.querySelector('#page-text').dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
const floatingButton = document.querySelector('.immersive-translate-floating-button');
assert.equal(floatingButton.style.visibility, 'visible', 'page selection should show the floating button');

// Trigger translation; showResult runs and wires up the action buttons.
floatingButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

const popup = document.querySelector('.immersive-translate-modal');
const vocabButton = popup.querySelector('#btn-vocab');
assert.ok(vocabButton, 'popup should render a vocabulary button');
assert.equal(vocabButton.dataset.state, 'unsaved', 'vocabulary button starts in the unsaved state');
assert.equal(vocabButton.textContent.includes('加入生词本'), true, 'unsaved label should be in Chinese');

// ---------------------------------------------------------------------------
// 2. Clicking the button persists an entry and switches to the saved state
// ---------------------------------------------------------------------------

vocabButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

assert.equal(vocabButton.dataset.state, 'saved', 'vocabulary button should switch to saved state after clicking');
assert.equal(vocabButton.textContent.includes('已加入'), true, 'saved label should be in Chinese');

const storedKeys = Array.from(storageStore.keys());
const entryKeys = storedKeys.filter(key => key.startsWith('vocab_'));
assert.equal(entryKeys.length, 1, 'one vocabulary entry should be persisted');
const storedEntry = storageStore.get(entryKeys[0]);
assert.equal(storedEntry.originalText, 'hello', 'entry should preserve the original selection');
assert.equal(storedEntry.targetLang, 'zh-CN', 'entry should record the target language from config');
assert.equal(storedEntry.sourceUrl, 'https://example.com/', 'entry should record the source URL');

// ---------------------------------------------------------------------------
// 3. Reopening the popup with the same selection reflects the saved state
// ---------------------------------------------------------------------------

document.body.click();
await new Promise(resolve => window.setTimeout(resolve, 0));

document.querySelector('#page-text').dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
floatingButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

const reopenedVocabButton = document.querySelector('#btn-vocab');
assert.equal(reopenedVocabButton.dataset.state, 'saved', 'reopening the popup should show the saved state for previously saved entries');

// ---------------------------------------------------------------------------
// 4. Clicking again removes the entry (toggle behavior)
// ---------------------------------------------------------------------------

reopenedVocabButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

const remainingEntryKeys = Array.from(storageStore.keys()).filter(key => key.startsWith('vocab_'));
assert.equal(remainingEntryKeys.length, 0, 'toggling should remove the entry from storage');
assert.equal(document.querySelector('#btn-vocab').dataset.state, 'unsaved', 'button should fall back to unsaved after removal');

// ---------------------------------------------------------------------------
// 5. Vocabulary list operations use the persisted entry set
// ---------------------------------------------------------------------------

// Direct API smoke test (we can't load the options page inside jsdom without
// recreating its DOM, so we exercise VocabularyManager via the popup click
// path which is the same code path the options page uses).
floatingButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));
document.querySelector('#btn-vocab').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

const finalEntryKeys = Array.from(storageStore.keys()).filter(key => key.startsWith('vocab_'));
assert.equal(finalEntryKeys.length, 1, 'save should append exactly one entry');

console.log('PASS: vocabulary save/unsave toggle works through the selection popup');