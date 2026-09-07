// End-to-end verification for the LLM-driven pronunciation flow.
// Drives the bundled content.js inside jsdom and asserts that the
// selection popup shows / hides / falls back to dictionary audio
// correctly across realistic model outputs.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const contentScript = readFileSync('dist/content.js', 'utf8');

// Per-test mock state set in each scenario.
let mockFetch = async () => ({ ok: true, text: async () => '', json: async () => ({}) });

function buildDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><p id="page-text">placeholder</p></body></html>',
    { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const { window } = dom;
  const { document } = window;
  const pageText = document.querySelector('#page-text').firstChild;

  const storageStore = new Map();
  window.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onCommand: { addListener() {} },
      action: { onClicked: { addListener() {} } },
      tabs: {
        async query() { return [{ id: 1 }]; },
        async sendMessage() { return {}; },
      },
      scripting: { async executeScript() {} },
    },
    storage: {
      local: {
        async get(key) {
          if (key === null || key === undefined) {
            return Object.fromEntries(storageStore);
          }
          if (Array.isArray(key)) {
            const out = {};
            for (const k of key) if (storageStore.has(k)) out[k] = storageStore.get(k);
            return out;
          }
          return storageStore.has(key) ? { [key]: storageStore.get(key) } : {};
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) storageStore.set(k, v);
        },
        async remove(key) {
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) storageStore.delete(k);
        },
      },
      sync: { async get() { return {}; }, async set() {}, async remove() {} },
      onChanged: { addListener() {} },
    },
  };

  window.fetch = (...args) => mockFetch(...args);
  window.Audio = class { constructor() {} play() { return Promise.resolve(); } };
  window.confirm = () => true;
  window.console = console;

  window.getSelection = () => ({
    anchorNode: pageText,
    toString: () => 'apple',
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 40, width: 60, height: 20 }),
    }),
  });

  window.eval(contentScript);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  // Seed an API key so the popup enters the translation flow.
  storageStore.set('translation_config', {
    apiEndpoint: 'https://example.com/v1',
    apiKey: 'test-key',
    targetLang: 'zh-CN',
    model: 'test-model',
    translationStyle: 'natural',
  });

  return { dom, document, storageStore };
}

function tick(ms = 50) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function selectAndTranslate(document) {
  document.querySelector('#page-text').dispatchEvent(new document.defaultView.MouseEvent('mouseup', { bubbles: true }));
  const btn = document.querySelector('.immersive-translate-floating-button');
  btn.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await tick(80);
  return document.querySelector('.immersive-translate-modal');
}

// ---------------------------------------------------------------------------
// Scenario 1: Clean JSON — word gets both phonetic + audio fallback
// ---------------------------------------------------------------------------
{
  mockFetch = async (url) => {
    if (String(url).includes('dictionaryapi.dev')) {
      return {
        ok: true,
        json: async () => [{
          phonetic: '/dɪkʃəˌnɛri/',
          phonetics: [
            { text: '/dɪkʃəˌnɛri/', audio: 'https://audio.example/dict.mp3' },
          ],
        }],
      };
    }
    return {
      ok: true,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '{"translation":"苹果","pronunciation":"/ˈæp.əl/"}' } }],
      }),
    };
  };

  const { document } = buildDom();
  const popup = await selectAndTranslate(document);

  const phoneticEl = popup.querySelector('.immersive-translate-pronunciation-text');
  assert.ok(phoneticEl, 'pronunciation row should render for a single word');
  assert.equal(phoneticEl.textContent, '/ˈæp.əl/', 'phonetic should come from LLM, not the dictionary');

  // The horn is rendered alongside the phonetic immediately (it no longer
  // waits for the dict audio fallback — TTS covers the no-recording case).
  const audioBtn = popup.querySelector('#btn-pronunciation-audio');
  assert.ok(audioBtn, 'audio button should render together with the phonetic');
}

// ---------------------------------------------------------------------------
// Scenario 2: Empty pronunciation — sentence shows no IPA row
// ---------------------------------------------------------------------------
{
  mockFetch = async (url) => {
    if (String(url).includes('dictionaryapi.dev')) {
      throw new Error('dictionaryapi.dev should not be hit when LLM gave an empty pronunciation');
    }
    return {
      ok: true,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '{"translation":"你好吗？","pronunciation":""}' } }],
      }),
    };
  };

  const { document } = buildDom();
  const win = document.defaultView;
  win.getSelection = () => {
    const pageText = document.querySelector('#page-text').firstChild;
    return {
      anchorNode: pageText,
      toString: () => 'How are you?',
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 40, width: 60, height: 20 }),
      }),
    };
  };

  document.querySelector('#page-text').dispatchEvent(new document.defaultView.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const popup = document.querySelector('.immersive-translate-modal');
  assert.equal(popup.querySelector('.immersive-translate-pronunciation'), null,
    'sentence input should not render the pronunciation row');
}

// ---------------------------------------------------------------------------
// Scenario 3: Markdown-fenced JSON — parser strips it
// ---------------------------------------------------------------------------
{
  mockFetch = async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({
      choices: [{
        message: {
          content: '```json\n{"translation":"字典","pronunciation":"/ˈdɪkʃəˌnɛri/"}\n```',
        },
      }],
    }),
  });

  const { document } = buildDom();
  const win = document.defaultView;
  win.getSelection = () => {
    const pageText = document.querySelector('#page-text').firstChild;
    return {
      anchorNode: pageText,
      toString: () => 'dictionary',
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 40, width: 60, height: 20 }),
      }),
    };
  };

  document.querySelector('#page-text').dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const popup = document.querySelector('.immersive-translate-modal');
  assert.equal(popup.querySelector('.immersive-translate-pronunciation-text').textContent,
    '/ˈdɪkʃəˌnɛri/', 'markdown fence should be stripped before parsing');
}

// ---------------------------------------------------------------------------
// Scenario 4: Plain-text fallback — model returns raw translation
// ---------------------------------------------------------------------------
{
  mockFetch = async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: '你好世界' } }] }),
  });

  const { document } = buildDom();
  const win = document.defaultView;
  win.getSelection = () => {
    const pageText = document.querySelector('#page-text').firstChild;
    return {
      anchorNode: pageText,
      toString: () => 'hello world',
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 40, width: 60, height: 20 }),
      }),
    };
  };

  document.querySelector('#page-text').dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const popup = document.querySelector('.immersive-translate-modal');
  assert.equal(popup.querySelector('#immersive-translate-result').textContent, '你好世界',
    'plain-text response should still surface as the translation');
  assert.equal(popup.querySelector('.immersive-translate-pronunciation'), null,
    'plain-text fallback should not invent a pronunciation');
}

// ---------------------------------------------------------------------------
// Scenario 5: Cache hit stores pronunciation and reuses it
// ---------------------------------------------------------------------------
{
  // Seed the cache by translating once.
  mockFetch = async () => ({
    ok: true,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { content: '{"translation":"苹果","pronunciation":"/ˈæp.əl/"}' } }],
    }),
  });
  const { document, storageStore } = buildDom();

  document.querySelector('#page-text').dispatchEvent(new document.defaultView.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await tick(80);
  // Close the popup so the next selection re-triggers a full flow.
  document.body.click();
  await tick(20);

  // Now the LLM would crash — if the cache path is wrong, the popup errors.
  mockFetch = async () => { throw new Error('should not be called on cache hit'); };
  document.querySelector('#page-text').dispatchEvent(new document.defaultView.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await tick(80);

  const popup = document.querySelector('.immersive-translate-modal');
  assert.equal(popup.querySelector('#immersive-translate-result').textContent, '苹果',
    'cached translation should be reused without hitting the LLM');
  assert.equal(popup.querySelector('.immersive-translate-pronunciation-text').textContent, '/ˈæp.əl/',
    'cached pronunciation should be restored without hitting the LLM');
}

// ---------------------------------------------------------------------------
// Scenario 6: LLM gives IPA, dictionary has no audio — button stays absent
// ---------------------------------------------------------------------------
{
  mockFetch = async (url) => {
    if (String(url).includes('dictionaryapi.dev')) {
      return { ok: false, json: async () => null }; // 404 — no entry for this word
    }
    return {
      ok: true,
      text: async () => '',
      json: async () => ({
        choices: [{
          message: {
            content: '{"translation":"Kubernetes","pronunciation":"/ˌkuːbərˈnɛtiːz/"}',
          },
        }],
      }),
    };
  };

  const { document } = buildDom();
  const win = document.defaultView;
  win.getSelection = () => {
    const pageText = document.querySelector('#page-text').firstChild;
    return {
      anchorNode: pageText,
      toString: () => 'Kubernetes',
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, right: 80, top: 20, bottom: 40, width: 60, height: 20 }),
      }),
    };
  };

  document.querySelector('#page-text').dispatchEvent(new document.defaultView.MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.immersive-translate-floating-button').dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await tick(80);
  await tick(60);

  const popup = document.querySelector('.immersive-translate-modal');
  assert.ok(popup.querySelector('.immersive-translate-pronunciation-text'), 'LLM phonetic should still render');
  // The horn stays visible even without a dict recording — clicking it
  // falls back to TTS at click-time rather than hiding the affordance.
  assert.ok(popup.querySelector('#btn-pronunciation-audio'),
    'audio button should still render when dictionary returns 404');
}

console.log('PASS: LLM-driven pronunciation flow works across all expected inputs');