// Verifies the unified pronunciation player: recorded-audio-first with a
// TTS fallback routed through chrome.runtime.sendMessage -> background
// -> chrome.tts. Loads the standalone vocabulary test bundle which
// also exposes the speech helpers.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const bundle = readFileSync('dist/test-vocabulary.iife.js', 'utf8');

function buildDom() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console = console;

  const harness = {
    audioUrls: [],
    audioPlayRejected: false,
    sentMessages: [],
    sendResponse: null,
    lastError: null,
  };

  window.Audio = class {
    constructor(url) { harness.audioUrls.push(url); this.url = url; }
    addEventListener() {}
    play() {
      return harness.audioPlayRejected
        ? Promise.reject(new Error('autoplay blocked'))
        : Promise.resolve();
    }
  };

  window.chrome = {
    runtime: {
      sendMessage: (message, callback) => {
        harness.sentMessages.push(message);
        if (typeof callback === 'function') {
          // Simulate the background's response on the next microtask.
          Promise.resolve().then(() => callback({ success: true }));
        }
      },
      get lastError() { return harness.lastError; },
    },
  };

  window.eval(bundle);
  const classes = window.__easyTranslateClasses;
  if (!classes || !classes.playPronunciation) {
    throw new Error('speech helpers not exposed on __easyTranslateClasses');
  }
  return { window, harness, playPronunciation: classes.playPronunciation };
}

const btn = (window) => {
  const el = window.document.createElement('button');
  window.document.body.appendChild(el);
  return el;
};

const settle = () => new Promise(r => setImmediate(r));

// ---------------------------------------------------------------------------
// 1. Recorded audio present → plays the mp3, does NOT dispatch TTS.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  const b = btn(window);
  playPronunciation({ audioUrl: 'https://x/a.mp3', word: 'apple', button: b });
  assert.deepEqual(harness.audioUrls, ['https://x/a.mp3'], 'should construct Audio with the recording url');
  assert.equal(harness.sentMessages.length, 0, 'should not dispatch TTS when a recording is present');
  assert.ok(b.classList.contains('is-playing'), 'button should be marked playing');
}

// ---------------------------------------------------------------------------
// 2. No recording → TTS dispatch carries the right text + lang + rate.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  const b = btn(window);
  playPronunciation({ word: 'apple', button: b });
  assert.deepEqual(harness.audioUrls, [], 'should not construct Audio when there is no url');
  assert.equal(harness.sentMessages.length, 1, 'should dispatch TTS once');
  const m = harness.sentMessages[0];
  assert.equal(m.type, 'SPEAK', 'message type should be SPEAK');
  assert.equal(m.text, 'apple', 'should send the original word, not the IPA');
  assert.equal(m.lang, 'en-US', 'latin word should use en-US');
  assert.ok(typeof m.rate === 'number' && m.rate > 0 && m.rate <= 1, 'rate should be <= 1');
  assert.ok(b.classList.contains('is-playing'), 'button should be marked playing while TTS runs');
}

// ---------------------------------------------------------------------------
// 3. Chinese word → lang picks zh-CN.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  playPronunciation({ word: '苹果' });
  assert.equal(harness.sentMessages[0].lang, 'zh-CN', 'CJK word should use zh-CN');
}

// ---------------------------------------------------------------------------
// 4. Recorded audio fails (play rejects) → falls back to TTS dispatch.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  harness.audioPlayRejected = true;
  playPronunciation({ audioUrl: 'https://x/a.mp3', word: 'apple', button: undefined });
  assert.deepEqual(harness.audioUrls, ['https://x/a.mp3'], 'attempted the recording');
  await settle();
  assert.equal(harness.sentMessages.length, 1, 'fell back to TTS when play() rejected');
  assert.equal(harness.sentMessages[0].text, 'apple');
}

// ---------------------------------------------------------------------------
// 5. Rapid duplicate clicks for the same word are de-duped.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  playPronunciation({ word: 'apple' });
  playPronunciation({ word: 'apple' });
  playPronunciation({ word: 'apple' });
  assert.equal(harness.sentMessages.length, 1, 'duplicate clicks for the same word should be de-duped');
  playPronunciation({ word: 'banana' });
  assert.equal(harness.sentMessages.length, 2, 'a different word should be allowed through');
}

// ---------------------------------------------------------------------------
// 6. Without chrome.runtime available, TTS is skipped silently (no throw).
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  // Yank the runtime to simulate contexts where chrome.runtime is not
  // exposed (e.g. some chrome:// pages, or strict isolated worlds).
  window.chrome = {};
  playPronunciation({ word: 'apple' });
  assert.equal(harness.sentMessages.length, 0, 'no dispatch without runtime');
  // No throw → test passes by reaching this line.
}

console.log('PASS: pronunciation player prefers recordings, dispatches TTS via chrome.tts, de-dupes rapid clicks');