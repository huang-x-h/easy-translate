// Live smoke test against the real engines. Skipped unless
// EASYTRANSLATE_LIVE=1 is set, so the normal test suite stays offline.
//
//   EASYTRANSLATE_LIVE=1 node scripts/live_engine_test.mjs

import assert from 'node:assert/strict';

const LIVE = process.env.EASYTRANSLATE_LIVE === '1';
if (!LIVE) {
  console.log('SKIP: live engine test (set EASYTRANSLATE_LIVE=1 to run)');
  process.exit(0);
}

const ENGINES = [
  {
    name: 'index-translate',
    endpoint: 'https://index-translate.bilibili.com/v1',
    model: 'Index-Translate-35B-A3B',
    apiKey: 'EMPTY',
    jsonOutput: false,
    jsonMode: false,
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
  },
];

async function call(spec, text, targetLang) {
  const base = spec.endpoint.replace(/\/+$/, '');
  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const prompt = `Translate the following text into ${targetLang}. Output ONLY the translated text — no explanations, no notes, no quotes, no JSON, no reasoning.

Text to translate:
${text}`;

  const body = {
    model: spec.model,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  };
  if (spec.jsonMode) body.response_format = { type: 'json_object' };
  if (spec.extraBody) Object.assign(body, spec.extraBody);

  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${spec.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - started;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json();
  return { content: data.choices[0]?.message?.content ?? '', elapsed, reasoning: data.choices[0]?.message?.reasoning_content ?? '' };
}

for (const spec of ENGINES) {
  const result = await call(spec, 'Hello, world. How are you today?', 'zh-CN');
  console.log(`\n[${spec.name}] ${result.elapsed}ms`);
  console.log('  content  :', JSON.stringify(result.content.slice(0, 200)));
  if (result.reasoning) {
    console.log('  reasoning:', JSON.stringify(result.reasoning.slice(0, 200)));
    console.log('  ⚠️ 推理输出未关闭 —— 会占用 token 预算');
  }
  assert.ok(result.content.trim(), 'engine returned empty content');
  assert.ok(!/^\s*\{/.test(result.content), 'plain-text engine should not return JSON');
}

console.log('\nOK: live engines behave as expected');