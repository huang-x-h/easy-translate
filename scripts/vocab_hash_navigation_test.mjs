// Verifies the hash-driven scroll/highlight logic the options page
// installs on load. We extract just the scroll code (a few lines) so
// the test runs without loading the full options bundle — jsdom can't
// resolve the bundle's `import './assets/...'` paths cleanly.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const optionsHtml = readFileSync('src/options/index.html', 'utf8');

// Mirror of the handlers from src/options/index.ts. Keep this in sync
// with the production handler — it's intentionally minimal so the
// behaviour is obvious from a glance.
//
// Note: production code attaches this inside a DOMContentLoaded listener
// (the module is deferred to after parse). The test harness evaluates the
// handler script before jsdom has fired DOMContentLoaded, so we register
// synchronously regardless of readyState.
const HASH_HANDLER_SOURCE = `
function scrollToVocabularyCard() {
  const card = document.getElementById('vocabularyCard');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('vocab-card-highlight');
  void card.offsetWidth;
  card.classList.add('vocab-card-highlight');
}
if (window.location.hash === '#vocabulary') {
  window.requestAnimationFrame(scrollToVocabularyCard);
}
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#vocabulary') {
    scrollToVocabularyCard();
  }
});
`;

function buildDom(initialHash = '') {
  const dom = new JSDOM(optionsHtml, {
    url: `https://example.com/options${initialHash}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  window.HTMLElement.prototype.scrollIntoView = function () {
    window.__scrollCalls = (window.__scrollCalls || 0) + 1;
    window.__lastScrolledId = this.id;
  };
  // Reset between scenarios
  window.__scrollCalls = 0;
  window.__lastScrolledId = null;

  // Replace requestAnimationFrame with setImmediate so jsdom's raf queue
  // (which doesn't tick when pretendToBeVisual isn't enough) doesn't
  // leave callbacks unfired.
  window.requestAnimationFrame = function (cb) {
    return setImmediate(() => cb(Date.now()));
  };
  window.cancelAnimationFrame = (handle) => clearImmediate(handle);

  window.eval(HASH_HANDLER_SOURCE);
  // jsdom already fires DOMContentLoaded synchronously when the document
  // finishes parsing, so we don't dispatch it manually — doing so would
  // register duplicate listeners.
  return { window, document };
}

const flushRaf = () => new Promise(resolve => setImmediate(resolve));
// Poll until a predicate holds (or timeout). jsdom fires `hashchange` on an
// internal timer whose tick relative to our microtasks isn't fully
// deterministic, so polling is more robust than counting setImmediate ticks.
const waitFor = async (predicate, { timeout = 2000, interval = 10 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, interval));
  };
};

// ---------------------------------------------------------------------------
// 1. Loading with #vocabulary should scroll on first paint.
// ---------------------------------------------------------------------------
{
  const { window, document } = buildDom('#vocabulary');
  await flushRaf();
  const card = document.getElementById('vocabularyCard');
  assert.equal(window.__scrollCalls, 1,
    'initial load with #vocabulary should scroll the card into view');
  assert.equal(window.__lastScrolledId, 'vocabularyCard',
    'the scrolled element should be the vocabulary card');
  assert.ok(card.classList.contains('vocab-card-highlight'),
    'initial load should apply the highlight class');
}

// ---------------------------------------------------------------------------
// 2. Loading without #vocabulary should not auto-scroll.
// ---------------------------------------------------------------------------
{
  const { window, document } = buildDom('');
  await flushRaf();
  const card = document.getElementById('vocabularyCard');
  assert.equal(window.__scrollCalls || 0, 0,
    'a plain load should not auto-scroll');
  assert.ok(!card.classList.contains('vocab-card-highlight'),
    'no highlight without a hash trigger');
}

// ---------------------------------------------------------------------------
// 3. Updating location.hash to #vocabulary after load should also scroll.
// ---------------------------------------------------------------------------
{
  const { window, document } = buildDom('');
  await flushRaf();

  window.location.hash = '#vocabulary';
  const ok = await waitFor(() => window.__scrollCalls === 1);
  const card = document.getElementById('vocabularyCard');
  assert.ok(ok, 'hashchange to #vocabulary should eventually scroll the card into view');
  assert.equal(window.__lastScrolledId, 'vocabularyCard');
  assert.ok(card.classList.contains('vocab-card-highlight'),
    'hashchange should re-apply the highlight');
}

// ---------------------------------------------------------------------------
// 4. Unrelated hash changes must not touch the vocabulary card.
// ---------------------------------------------------------------------------
{
  const { window, document } = buildDom('');
  await flushRaf();

  window.location.hash = '#something-else';
  await flushRaf();

  const card = document.getElementById('vocabularyCard');
  assert.equal(window.__scrollCalls || 0, 0,
    'unrelated hash changes should not interact with the vocabulary card');
  assert.ok(!card.classList.contains('vocab-card-highlight'),
    'unrelated hash changes should not apply the highlight');
}

// ---------------------------------------------------------------------------
// 5. The production options/index.ts must contain the matching handler
//    so this test isn't drifting from real source.
// ---------------------------------------------------------------------------
{
  const source = readFileSync('src/options/index.ts', 'utf8');
  assert.ok(source.includes("hash === '#vocabulary'"),
    'options/index.ts should still key off #vocabulary');
  assert.ok(source.includes('scrollToVocabularyCard'),
    'options/index.ts should still call scrollToVocabularyCard on hashchange');
  assert.ok(source.includes('vocab-card-highlight'),
    'options/index.ts should still apply the highlight class');
}

console.log('PASS: vocabulary card scroll/highlight responds to #vocabulary hash');