// Verifies the LLM-driven pronunciation backfill for existing
// vocabulary entries. Loads the standalone vocabulary test bundle
// (built via `vite.config.ts` -> test-vocabulary.iife.js) into jsdom
// and exercises saveEntry + backfillMissingPronunciations together.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const vocabularyBundle = readFileSync('dist/test-vocabulary.iife.js', 'utf8');

function buildDom() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  const storageStore = new Map();
  window.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onCommand: { addListener() {} },
      action: { onClicked: { addListener() {} } },
      tabs: {
        async query() { return []; },
        async sendMessage() { return {}; },
      },
      scripting: { async executeScript() {} },
    },
    storage: {
      local: {
        async get(key) {
          if (key === null || key === undefined) return Object.fromEntries(storageStore);
          if (Array.isArray(key)) {
            const out = {};
            for (const k of key) if (storageStore.has(k)) out[k] = storageStore.get(k);
            return out;
          }
          return storageStore.has(key) ? { [key]: storageStore.get(key) } : {};
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) storageStore.set(k, v); },
        async remove(key) {
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) storageStore.delete(k);
        },
      },
      sync: { async get() { return {}; }, async set() {}, async remove() {} },
      onChanged: { addListener() {} },
    },
  };

  window.confirm = () => true;
  window.console = console;

  window.eval(vocabularyBundle);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  return { window, document, storageStore };
}

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

function VM(window) {
  if (!window.__easyTranslateClasses?.VocabularyManager) {
    throw new Error('vocabulary test bundle did not expose __easyTranslateClasses');
  }
  return window.__easyTranslateClasses.VocabularyManager;
}

// ---------------------------------------------------------------------------
// 1. backfillMissingPronunciations fills IPA via the injected translator
// ---------------------------------------------------------------------------
{
  const { window } = buildDom();
  const v = VM(window);

  await v.saveEntry({ originalText: 'apple', translation: '苹果', targetLang: 'zh-CN' });
  await v.saveEntry({ originalText: 'banana', translation: '香蕉', targetLang: 'zh-CN' });
  await v.saveEntry({ originalText: 'cherry', translation: '樱桃', targetLang: 'zh-CN', pronunciation: '/ˈtʃɛri/' });

  const translateCalls = [];
  const translate = async (text, targetLang) => {
    translateCalls.push({ text, targetLang });
    const map = {
      apple: { translatedText: '苹果', pronunciation: '/ˈæp.əl/' },
      banana: { translatedText: '香蕉', pronunciation: '/bəˈnænə/' },
    };
    return map[text] ?? { translatedText: '', pronunciation: '' };
  };

  const result = await v.backfillMissingPronunciations(translate);

  assert.equal(result.total, 2, 'should target only entries missing pronunciation');
  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.cancelled, false);
  assert.equal(translateCalls.length, 2);

  const apple = await v.getEntry('apple', 'zh-CN');
  const banana = await v.getEntry('banana', 'zh-CN');
  const cherry = await v.getEntry('cherry', 'zh-CN');
  assert.equal(apple.pronunciation, '/ˈæp.əl/');
  assert.equal(banana.pronunciation, '/bəˈnænə/');
  assert.equal(cherry.pronunciation, '/ˈtʃɛri/', 'pre-existing pronunciation must not be touched');
  assert.equal(apple.translation, '苹果', 'translation should be preserved');
}

// ---------------------------------------------------------------------------
// 2. LLM returning empty pronunciation counts as skipped, not failed
// ---------------------------------------------------------------------------
{
  const { window } = buildDom();
  const v = VM(window);
  await v.saveEntry({ originalText: 'How are you?', translation: '你好吗？', targetLang: 'zh-CN' });
  const translate = async () => ({ translatedText: '', pronunciation: '' });
  const result = await v.backfillMissingPronunciations(translate);
  assert.equal(result.skipped, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.failed, 0);
}

// ---------------------------------------------------------------------------
// 3. Throwing translator counts as failed
// ---------------------------------------------------------------------------
{
  const { window } = buildDom();
  const v = VM(window);
  await v.saveEntry({ originalText: 'apple', translation: '苹果', targetLang: 'zh-CN' });
  await v.saveEntry({ originalText: 'banana', translation: '香蕉', targetLang: 'zh-CN' });
  const translate = async (text) => {
    if (text === 'banana') throw new Error('boom');
    return { translatedText: '', pronunciation: '/ˈæp.əl/' };
  };
  const result = await v.backfillMissingPronunciations(translate);
  assert.equal(result.updated, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 0);
}

// ---------------------------------------------------------------------------
// 4. Abort signal halts the loop and reports cancelled
// ---------------------------------------------------------------------------
{
  const { window } = buildDom();
  const v = VM(window);
  for (const w of ['apple', 'banana', 'cherry', 'date']) {
    await v.saveEntry({ originalText: w, translation: 'x', targetLang: 'zh-CN' });
  }
  const controller = new AbortController();
  const progress = [];
  let callCount = 0;
  const translate = async (text) => {
    callCount++;
    if (callCount === 2) controller.abort();
    return { translatedText: '', pronunciation: `/test-${text}/` };
  };
  const result = await v.backfillMissingPronunciations(translate, {
    signal: controller.signal,
    onProgress: (done, total) => progress.push({ done, total }),
  });
  assert.equal(result.cancelled, true);
  assert.ok(result.updated <= 2, 'should stop after the abort signal fires');
  assert.ok(progress.length >= 2, 'progress callback should fire at least twice');
  assert.equal(progress[progress.length - 1].total, 4);
}

console.log('PASS: pronunciation backfill handles success, skip, failure, and abort');