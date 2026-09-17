// Verifies isWordLike: the front-end gate that decides whether a
// selected text gets a phonetic + audio button, and whether a TTS
// request should be dispatched.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const textBundle = readFileSync('dist/test-vocabulary.iife.js', 'utf8');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.console = console;
window.eval(textBundle);

// The shared text module isn't exposed on the test bundle (it has no
// runtime side effects worth testing inside the bundle). Eval it
// directly here.
const textSource = readFileSync('src/shared/text.ts', 'utf8')
  // Strip TypeScript types / imports that the test harness can't run.
  .replace(/import[^;]+;\s*/g, '')
  .replace(/\bexport\s+function/g, 'function')
  .replace(/:\s*boolean/g, '')
  .replace(/:\s*string/g, '')
  .replace(/:\s*number/g, '');

window.eval(textSource);
const isWordLike = window.isWordLike;

const YES = (input, note = '') => {
  assert.equal(isWordLike(input), true, `expected true for: ${JSON.stringify(input)} ${note}`);
};
const NO = (input, note = '') => {
  assert.equal(isWordLike(input), false, `expected false for: ${JSON.stringify(input)} ${note}`);
};

// ---------------------------------------------------------------------------
// English single tokens
// ---------------------------------------------------------------------------
YES('apple');
YES('Apple');
YES('self-esteem', 'hyphenated');
YES("don't", 'apostrophe');
YES('state-of-the-art', 'multi-hyphen');
YES("it's", 'apostrophe in middle');

// ---------------------------------------------------------------------------
// English phrases / sentences
// ---------------------------------------------------------------------------
NO('How are you?');
NO("I'm happy");
NO('Hello world');
NO('a b', 'two letters with space');
NO('one two three');
YES('  spaced  ', 'trims down to a single word');
NO('   ', 'whitespace only');

// ---------------------------------------------------------------------------
// Multi-line
// ---------------------------------------------------------------------------
NO('first line\nsecond line');
NO('apple\nbanana');
NO('one\r\ntwo', 'Windows line endings');

// ---------------------------------------------------------------------------
// CJK
// ---------------------------------------------------------------------------
YES('我', 'single Han');
YES('你', 'single Han');
YES('好', 'single Han');
YES('你好', 'two Han, still a word');
YES('我今', 'two Han');
NO('我今天', 'three Han, not a word');
NO('你好世界', 'four Han');
NO('こんにちは世界', '> 2 Kana, not a word');

// ---------------------------------------------------------------------------
// Mixed / edge cases
// ---------------------------------------------------------------------------
NO('iPhone 15', 'word + number = 2 tokens, not a single word');
YES('Ctrl+C', 'single Latin token with a symbol');
NO('12', 'pure digits');
NO('?!', 'pure punctuation');
NO('---', 'pure symbols');
NO('   ', 'whitespace only');
NO('', 'empty');

// ---------------------------------------------------------------------------
// Length limit
// ---------------------------------------------------------------------------
NO('a'.repeat(31), 'over the 30-char limit');
YES('a'.repeat(30), 'exactly at the limit');

// ---------------------------------------------------------------------------
// Whitespace detection
// ---------------------------------------------------------------------------
NO('two  spaces', 'double space = multi-word');
NO('tab\there', 'tab = multi-word');

console.log('PASS: isWordLike gates phonetic + TTS correctly across English, CJK, and edge cases');