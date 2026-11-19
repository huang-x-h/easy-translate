// Verifies the declarativeNetRequest rules that strip the Origin header
// for engines whose CDN rejects browser-extension origins.
//
// The upstream behaviour was confirmed empirically:
//   Origin: chrome-extension://...  → 412 + HTML bot-challenge page
//   Origin: https://example.com     → 200
//   (no Origin header)              → 200
// The service's own docs tell extensions to use a local proxy, which
// sends no Origin header — so removing it produces the documented shape.

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

const bundle = findChunk('shared-dnr-') + '\n' + findChunk('shared-providers-') + '\n' + findChunk('shared-types-');

function buildDom() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console = console;

  const harness = { updated: null };

  window.chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
    declarativeNetRequest: {
      async updateDynamicRules(payload) { harness.updated = payload; },
    },
  };

  window.eval(bundle + '\nthis.buildOriginStripRules = buildOriginStripRules;\nthis.installOriginStripRules = installOriginStripRules;');
  return { window, harness, buildOriginStripRules: window.buildOriginStripRules, installOriginStripRules: window.installOriginStripRules };
}

// ---------------------------------------------------------------------------
// 1. A rule is produced for the engine that needs it, scoped tightly.
// ---------------------------------------------------------------------------
{
  const { buildOriginStripRules } = buildDom();
  const rules = buildOriginStripRules('abcdefghijklmnopabcdefghijklmnop');

  assert.equal(rules.length, 1, 'exactly one rule should be needed');
  const rule = rules[0];

  assert.equal(rule.action.type, 'modifyHeaders');
  assert.equal(rule.action.requestHeaders.length, 1);
  assert.equal(rule.action.requestHeaders[0].header, 'Origin', 'the Origin header is the one to remove');
  assert.equal(rule.action.requestHeaders[0].operation, 'remove', 'remove it rather than forging a value');

  // Scoped to our own requests only.
  assert.deepEqual(JSON.parse(JSON.stringify(rule.condition.initiatorDomains)), ['abcdefghijklmnopabcdefghijklmnop']);
  // Scoped to POSTs only.
  assert.deepEqual(JSON.parse(JSON.stringify(rule.condition.requestMethods)), ['post']);
  // Scoped to the host that actually rejects extension origins.
  assert.match(rule.condition.urlFilter, /index-translate\.bilibili\.com/);
  // And to the right resource type.
  assert.deepEqual(JSON.parse(JSON.stringify(rule.condition.resourceTypes)), ['xmlhttprequest']);
}

// ---------------------------------------------------------------------------
// 2. The rule is installed via updateDynamicRules, replacing any stale copy.
// ---------------------------------------------------------------------------
{
  const { harness, installOriginStripRules } = buildDom();
  const ok = await installOriginStripRules('abcdefghijklmnopabcdefghijklmnop');

  assert.equal(ok, true, 'installation should succeed when the API is available');
  assert.ok(harness.updated, 'updateDynamicRules should have been called');
  assert.ok(Array.isArray(harness.updated.removeRuleIds));
  assert.ok(harness.updated.removeRuleIds.length >= 1, 'stale rules should be removed first');
  assert.equal(harness.updated.addRules.length, 1, 'one rule should be added');
}

// ---------------------------------------------------------------------------
// 3. Missing declarativeNetRequest support is handled gracefully.
// ---------------------------------------------------------------------------
{
  const { window, harness, installOriginStripRules } = buildDom();
  window.chrome.declarativeNetRequest = undefined;
  const ok = await installOriginStripRules('abcdefghijklmnopabcdefghijklmnop');
  assert.equal(ok, false, 'should report failure rather than throw');
  assert.equal(harness.updated, null, 'nothing should have been installed');
}

// ---------------------------------------------------------------------------
// 4. A throwing updateDynamicRules is caught and reported.
// ---------------------------------------------------------------------------
{
  const { window, harness, installOriginStripRules } = buildDom();
  window.chrome.declarativeNetRequest.updateDynamicRules = async () => {
    throw new Error('quota exceeded');
  };
  const ok = await installOriginStripRules('abcdefghijklmnopabcdefghijklmnop');
  assert.equal(ok, false, 'should report failure rather than throw');
}

// ---------------------------------------------------------------------------
// 5. Only the engine that needs the workaround is covered — the generic
//    LLM endpoint must stay untouched.
// ---------------------------------------------------------------------------
{
  const { buildOriginStripRules } = buildDom();
  const rules = buildOriginStripRules('abcdefghijklmnopabcdefghijklmnop');
  const filter = rules[0].condition.urlFilter;
  assert.ok(!filter.includes('bigmodel'), 'the Zhipu endpoint must not be affected');
}

console.log('PASS: DNR rules strip the Origin header, scoped to the host that needs it');