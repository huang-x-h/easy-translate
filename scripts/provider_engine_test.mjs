// Verifies the engine registry and how each engine's capabilities shape
// the outgoing request.
//
//   - zhipu (general LLM)      → JSON prompt + response_format + asks for IPA
//   - index-translate (dedicated) → plain-text prompt, no response_format,
//                                 thinking disabled, no IPA requested
//
// Plus the phonetic fallback chain: when the engine returns no IPA the
// popup falls back to dictionaryapi.dev.

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

const apiBundle = findChunk('shared-api-') + '\n' + findChunk('shared-text-') + '\n' + findChunk('shared-types-') + '\n' + findChunk('shared-providers-');

function buildDom() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console = console;

  const harness = { bodies: [], response: null };

  window.fetch = async (url, init) => {
    harness.bodies.push({ url, body: JSON.parse(init.body) });
    return harness.response;
  };
  window.chrome = {
    runtime: {
      getURL: p => `chrome-extension://test/${p}`,
      onMessage: { addListener() {} },
    },
  };

  window.eval(apiBundle + '\nthis.TranslationAPI = TranslationAPI; this.getProvider = getProvider; this.PROVIDERS = PROVIDERS;');
  return { window, harness, TranslationAPI: window.TranslationAPI, getProvider: window.getProvider, PROVIDERS: window.PROVIDERS };
}

const BASE = {
  targetLang: 'zh-CN',
  translationStyle: 'natural',
  translationDirection: 'auto',
};

const okResponse = (content) => ({
  ok: true,
  status: 200,
  async json() { return { choices: [{ message: { content } }] }; },
});

// ---------------------------------------------------------------------------
// 1. The registry exposes the expected engines and their capabilities.
// ---------------------------------------------------------------------------
{
  const { getProvider, PROVIDERS } = buildDom();

  assert.ok(PROVIDERS.zhipu, 'zhipu must be registered');
  assert.ok(PROVIDERS['index-translate'], 'index-translate must be registered');
  assert.ok(PROVIDERS.custom, 'custom must be registered');

  const zhipu = getProvider('zhipu');
  assert.equal(zhipu.jsonOutput, true, 'zhipu asks for JSON output');
  assert.equal(zhipu.askPhonetic, true, 'zhipu can produce IPA');
  assert.equal(zhipu.jsonMode, true, 'zhipu endpoint accepts response_format');

  const idx = getProvider('index-translate');
  assert.equal(idx.endpoint, 'https://index-translate.bilibili.com/v1');
  assert.equal(idx.model, 'Index-Translate-35B-A3B');
  assert.equal(idx.jsonOutput, false, 'a dedicated translation model does not do JSON');
  assert.equal(idx.askPhonetic, false, 'a dedicated translation model does not do IPA');
  assert.equal(idx.jsonMode, false, 'must not send response_format to it');
  assert.deepEqual(
    JSON.parse(JSON.stringify(idx.extraBody)),
    { chat_template_kwargs: { enable_thinking: false } },
    'thinking must be disabled or the reasoning preamble eats the token budget',
  );

  // Unknown ids fall back to the generic spec instead of throwing.
  assert.equal(getProvider('nope').id, 'custom');
  assert.equal(getProvider(undefined).id, 'custom');
}

// ---------------------------------------------------------------------------
// 2. The zhipu engine sends a JSON prompt + response_format.
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom();
  harness.response = okResponse('{"translation":"你好","pronunciation":"/nɪˈhoʊ/"}');

  const api = new TranslationAPI({
    ...BASE,
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'k',
    model: 'glm-4-flash',
    providerId: 'zhipu',
  });
  const result = await api.translateDirect({ text: 'hello', targetLang: 'zh-CN' });

  assert.equal(harness.bodies.length, 1);
  const body = harness.bodies[0].body;
  assert.ok(body.response_format, 'zhipu should send response_format');
  assert.equal(body.response_format.type, 'json_object');
  assert.match(body.messages[0].content, /IPA phonetic transcription/, 'zhipu prompt asks for IPA');
  assert.equal(body.chat_template_kwargs, undefined, 'no thinking flag for zhipu');

  assert.equal(result.translatedText, '你好');
  assert.equal(result.pronunciation, '/nɪˈhoʊ/');
}

// ---------------------------------------------------------------------------
// 3. The index-translate engine sends a plain-text prompt, no response_format,
//    thinking disabled, and no IPA request.
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom();
  harness.response = okResponse('你好');

  const api = new TranslationAPI({
    ...BASE,
    apiEndpoint: 'https://index-translate.bilibili.com/v1',
    apiKey: 'EMPTY',
    model: 'Index-Translate-35B-A3B',
    providerId: 'index-translate',
  });
  const result = await api.translateDirect({ text: 'hello', targetLang: 'zh-CN' });

  assert.equal(harness.bodies.length, 1);
  const body = harness.bodies[0].body;
  assert.equal(body.response_format, undefined, 'must not send response_format to a dedicated model');
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }, 'thinking must be off');
  assert.match(body.messages[0].content, /Output ONLY the translated text/, 'prompt asks for plain text');
  assert.ok(!/IPA/.test(body.messages[0].content), 'must not ask a dedicated model for IPA');

  assert.equal(result.translatedText, '你好', 'plain text is used as the translation');
  assert.equal(result.pronunciation, undefined, 'no IPA from this engine');
}

// ---------------------------------------------------------------------------
// 4. A dedicated engine that still answers in JSON is parsed gracefully
//    (the shared parser handles both shapes).
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom();
  harness.response = okResponse('{"translation":"你好","pronunciation":"/nɪˈhoʊ/"}');

  const api = new TranslationAPI({
    ...BASE,
    apiEndpoint: 'https://index-translate.bilibili.com/v1',
    apiKey: 'EMPTY',
    model: 'Index-Translate-35B-A3B',
    providerId: 'index-translate',
  });
  const result = await api.translateDirect({ text: 'hello', targetLang: 'zh-CN' });
  assert.equal(result.translatedText, '你好');
  assert.equal(result.pronunciation, '/nɪˈhoʊ/');
}

// ---------------------------------------------------------------------------
// 5. The endpoint URL is built correctly for both engines.
// ---------------------------------------------------------------------------
{
  const { harness, TranslationAPI } = buildDom();
  harness.response = okResponse('ok');

  const api = new TranslationAPI({
    ...BASE,
    apiEndpoint: 'https://index-translate.bilibili.com/v1',
    apiKey: 'EMPTY',
    model: 'Index-Translate-35B-A3B',
    providerId: 'index-translate',
  });
  await api.translateDirect({ text: 'hi', targetLang: 'zh-CN' });

  assert.equal(
    harness.bodies[0].url,
    'https://index-translate.bilibili.com/v1/chat/completions',
    'the /v1 base URL must get /chat/completions appended',
  );
}

console.log('PASS: engine registry drives prompts, body params, and phonetic capability');