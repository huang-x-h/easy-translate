// Verifies the unified pronunciation player: recorded-audio-first with a
// TTS fallback. speechSynthesis / Audio are mocked so we can assert the
// routing (which source plays, which lang is chosen) without a real audio
// stack. Loads the standalone vocabulary test bundle (which also exposes
// the speech helpers).

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
    audioEnded: false,
    spoken: [],
    cancelled: 0,
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
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.onend = null; this.onerror = null; }
  };
  window.speechSynthesis = {
    cancel() { harness.cancelled++; },
    speak(utter) { harness.spoken.push({ text: utter.text, lang: utter.lang }); },
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

// ---------------------------------------------------------------------------
// 1. Recorded audio present → plays the mp3, does NOT fall to TTS.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  const b = btn(window);
  playPronunciation({ audioUrl: 'https://x/a.mp3', word: 'apple', button: b });
  assert.deepEqual(harness.audioUrls, ['https://x/a.mp3'], 'should construct Audio with the recording url');
  assert.equal(harness.spoken.length, 0, 'should not invoke TTS when a recording is present');
  assert.ok(b.classList.contains('is-playing'), 'button should be marked playing');
}

// ---------------------------------------------------------------------------
// 2. No recording → TTS speaks the word (not the IPA) in en-US.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  const b = btn(window);
  playPronunciation({ word: 'apple', button: b });
  assert.deepEqual(harness.audioUrls, [], 'should not construct Audio when there is no url');
  assert.equal(harness.spoken.length, 1, 'should invoke TTS once');
  assert.equal(harness.spoken[0].text, 'apple', 'TTS should speak the original word');
  assert.equal(harness.spoken[0].lang, 'en-US', 'latin word should use en-US');
  assert.ok(harness.cancelled >= 1, 'should cancel in-flight utterance before speaking');
}

// ---------------------------------------------------------------------------
// 3. Chinese word → TTS picks zh-CN.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  playPronunciation({ word: '苹果' });
  assert.equal(harness.spoken.length, 1);
  assert.equal(harness.spoken[0].lang, 'zh-CN', 'CJK word should use zh-CN');
}

// ---------------------------------------------------------------------------
// 4. Recorded audio fails (play rejects) → falls back to TTS.
// ---------------------------------------------------------------------------
{
  const { window, harness, playPronunciation } = buildDom();
  harness.audioPlayRejected = true;
  playPronunciation({ audioUrl: 'https://x/a.mp3', word: 'apple', button: undefined });
  assert.deepEqual(harness.audioUrls, ['https://x/a.mp3'], 'attempted the recording');
  // play()'s rejection is handled in an async .catch — flush a microtask.
  await new Promise(r => setImmediate(r));
  assert.equal(harness.spoken.length, 1, 'fell back to TTS when play() rejected');
  assert.equal(harness.spoken[0].text, 'apple');
}

console.log('PASS: pronunciation player prefers recordings and falls back to TTS');