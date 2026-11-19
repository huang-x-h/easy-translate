// Verifies the background-proxy translation path.
//
// Chrome attributes content-script fetches to the host page's origin,
// so LLM APIs whose preflight doesn't echo Access-Control-Allow-Origin
// reject them with a bare "TypeError: Failed to fetch". We route the
// real request through the background service worker, which holds host
// permissions and is exempt from that check.
//
// This test covers:
//   1. A content script delegates to the background via sendMessage.
//   2. The background performs the fetch inline (no delegation loop).
//   3. HTTP error statuses are turned into actionable messages.
//   4. Network-level failures are explained instead of showing a bare
//      "Failed to fetch".

import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function findChunk(prefix) {
  const f = readdirSync('dist/assets').find(x => x.startsWith(prefix) && x.endsWith('.js'));
  if (!f) throw new Error(`${prefix} chunk not found`);
  return readFileSync(`dist/assets/${f}`, 'utf8')
    .replace(/^import\s+.*$/gm, '')
    .replace(/export\s*\{[\s\S]*?\};?/g, '');
}

// api.ts imports isChinese() from text.ts, so we need that chunk too.
const apiBundle = findChunk('shared-api-') + '\n' + findChunk('shared-text-') + '\n' + findChunk('shared-providers-');

function loadApi(window, fetchImpl) {
  window.fetch = fetchImpl;
  window.eval(apiBundle);
  // The bundle exposes the class via its export statement; re-evaluate
  // a tiny wrapper to grab it.
  return window.eval('TranslationAPI');
}

function buildDom({ withSendMessage = true, fetchImpl } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://x.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console = console;

  const harness = {
    sentMessages: [],
    fetchCalls: [],
    lastError: null,
  };

  window.fetch = async (url, init) => {
    harness.fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  };

  window.chrome = {
    runtime: {
      getURL: p => `chrome-extension://test/${p}`,
      onMessage: { addListener() {} },
      ...(withSendMessage
        ? {
          sendMessage(message, callback) {
            harness.sentMessages.push(message);
            // Simulate the background replying with a translation.
            Promise.resolve().then(() => callback({
              translatedText: 'from background',
              pronunciation: '/from-bg/',
            }));
          },
        }
        : {}),
      get lastError() { return harness.lastError; },
    },
  };

  // `class X {}` inside eval() creates a local binding, so we export it
  // onto the window explicitly.
  window.eval(apiBundle + '\nthis.TranslationAPI = TranslationAPI;');
  const TranslationAPI = window.TranslationAPI;
  return { window, harness, TranslationAPI };
}

const CONFIG = {
  apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: 'test-key',
  targetLang: 'zh-CN',
  model: 'glm-4-flash',
  translationStyle: 'natural',
  translationDirection: 'auto',
};

// ---------------------------------------------------------------------------
// 1. A content script delegates to the background instead of fetching.
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom({
    fetchImpl: async () => { throw new Error('content script must NOT fetch directly'); },
  });
  const api = new TranslationAPI(CONFIG);
  const result = await api.translate({ text: 'hello', targetLang: 'zh-CN' });

  assert.equal(harness.sentMessages.length, 1, 'should send one message to the background');
  assert.equal(harness.sentMessages[0].type, 'TRANSLATE');
  assert.equal(harness.sentMessages[0].request.text, 'hello');
  assert.equal(harness.fetchCalls.length, 0, 'content script must not perform the fetch');
  assert.equal(result.translatedText, 'from background');
  assert.equal(result.pronunciation, '/from-bg/');
}

// ---------------------------------------------------------------------------
// 2. Without messaging available, fall back to a direct fetch.
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom({
    withSendMessage: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: '{"translation":"你好","pronunciation":""}' } }] };
      },
    }),
  });
  const api = new TranslationAPI(CONFIG);
  const result = await api.translate({ text: 'hello', targetLang: 'zh-CN' });

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.fetchCalls.length, 1, 'should fall back to a direct fetch');
  assert.equal(result.translatedText, '你好');
}

// ---------------------------------------------------------------------------
// 3. The background's direct fetch maps HTTP errors to actionable text.
// ---------------------------------------------------------------------------
{
  const { TranslationAPI } = buildDom({
    withSendMessage: false,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() { return '{"error":{"message":"invalid api key"}}'; },
    }),
  });
  const api = new TranslationAPI(CONFIG);
  const result = await api.translateDirect({ text: 'hello', targetLang: 'zh-CN' });

  assert.equal(result.translatedText, '');
  assert.match(result.error, /401/, 'should surface the HTTP status');
  assert.match(result.error, /API Key/, 'should explain the likely cause');
  assert.match(result.error, /invalid api key/, 'should include the server response body');
}

// ---------------------------------------------------------------------------
// 4. A network-level failure explains itself instead of a bare "Failed to fetch".
// ---------------------------------------------------------------------------
{
  const { TranslationAPI } = buildDom({
    withSendMessage: false,
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  const api = new TranslationAPI(CONFIG);
  const result = await api.translateDirect({ text: 'hello', targetLang: 'zh-CN' });

  assert.match(result.error, /无法连接/, 'should not surface the raw "Failed to fetch"');
  assert.match(result.error, /API Endpoint/, 'should mention the endpoint');
  assert.match(result.error, /API Key/, 'should mention the API key');
}

// ---------------------------------------------------------------------------
// 5. Other HTTP statuses get their own guidance.
// ---------------------------------------------------------------------------
{
  const cases = [
    [400, /参数/],
    [429, /频繁|额度/],
    [500, /服务端错误/],
  ];
  for (const [status, pattern] of cases) {
    const { TranslationAPI } = buildDom({
      withSendMessage: false,
      fetchImpl: async () => ({ ok: false, status, async text() { return 'boom'; } }),
    });
    const api = new TranslationAPI(CONFIG);
    const result = await api.translateDirect({ text: 'hi', targetLang: 'zh-CN' });
    assert.match(result.error, pattern, `HTTP ${status} should get a specific message`);
  }
}

// ---------------------------------------------------------------------------
// 6. A silent background doesn't hang the popup forever — it times out.
// ---------------------------------------------------------------------------
{
  const { window, TranslationAPI } = buildDom({
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; } }),
  });
  // Replace sendMessage with one that never calls back.
  window.chrome.runtime.sendMessage = () => {};
  // Shorten the timeout so the test doesn't wait 30 real seconds.
  const realSetTimeout = window.setTimeout;
  window.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms, 20));

  const api = new TranslationAPI(CONFIG);
  const result = await api.translate({ text: 'hello', targetLang: 'zh-CN' });
  assert.match(result.error, /超时/, 'a silent background should be reported as a timeout');
}

console.log('PASS: translation routes through the background and surfaces actionable errors');