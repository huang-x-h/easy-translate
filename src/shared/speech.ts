/**
 * Unified pronunciation playback: tries a real audio recording first
 * (from dictionaryapi.dev), falls back to a TTS request sent to the
 * background service worker, which invokes `chrome.tts`.
 *
 * Why not `window.speechSynthesis`?
 *
 *   Chrome 130+ silently drops `speechSynthesis.speak()` calls in many
 *   scenarios — no `start`/`end`/`error` events fire, no audio plays.
 *   `chrome.tts` is a separate extension API that drives the OS speech
 *   engine directly and is unaffected by that bug.
 *
 *   See https://support.google.com/chrome/a/thread/303329396
 */

import { isWordLike } from './text';

export interface PlayOptions {
  /** A pre-recorded audio URL (from dictionaryapi.dev). */
  audioUrl?: string;
  /** The original word to speak via TTS (NOT the IPA string). */
  word: string;
  /** Optional button element that should get the `is-playing` class. */
  button?: HTMLElement | null;
}

const TTS_MESSAGE_TYPE = 'SPEAK';

/**
 * Plays pronunciation for a word. Tries the recorded audio URL first;
 * if none is available, or playback fails, falls back to TTS.
 */
export function playPronunciation(options: PlayOptions): void {
  const { audioUrl, word, button } = options;

  if (audioUrl) {
    tryPlayAudio(audioUrl, word, button);
    return;
  }

  ttsSpeak(word, button);
}

/**
 * Plays a recorded <audio>. On failure (404, CORS, autoplay block) it
 * falls back to TTS so the user still hears the pronunciation.
 */
function tryPlayAudio(url: string, word: string, button?: HTMLElement | null): void {
  const audio = new Audio(url);
  const done = () => {
    if (button) button.classList.remove('is-playing');
  };
  // Both the `error` event and `play().catch` can fire for the same
  // failure. Guard with a flag so we only fall back to TTS once.
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    if (word) ttsSpeak(word, button);
  };
  audio.addEventListener('ended', done);
  audio.addEventListener('error', () => {
    done();
    fallback();
  });
  if (button) button.classList.add('is-playing');
  audio.play().catch(() => {
    done();
    fallback();
  });
}

// ---------------------------------------------------------------------------
// TTS via chrome.runtime.sendMessage -> background -> chrome.tts
// ---------------------------------------------------------------------------

interface SpeakMessage {
  type: typeof TTS_MESSAGE_TYPE;
  text: string;
  lang: string;
  rate: number;
}

const PENDING_PLAYED_FOR = 2_000; // ms — how long to keep the is-playing class on
const inflightByText = new Map<string, number>();

function ttsSpeak(text: string, button?: HTMLElement | null): void {
  if (!text) return;

  // Only dispatch TTS for single-word / short CJK tokens. Sentences
  // and phrases silently drop here — the UI should already have
  // hidden the horn for those, but the guard is cheap and prevents
  // accidental dispatches from keyboard handlers etc.
  if (!isWordLike(text)) return;

  if (!isRuntimeMessagingAvailable()) {
    console.warn(
      '[EasyTranslate] chrome.runtime is not available in this context; '
      + 'TTS playback is unavailable.',
    );
    return;
  }

  // De-dupe rapid clicks: skip if the same word is already in flight,
  // or if the same word was played very recently (so the button
  // highlight has a moment to settle before re-firing).
  const now = Date.now();
  const lastPlayed = inflightByText.get(text);
  if (lastPlayed && now - lastPlayed < PENDING_PLAYED_FOR) {
    return;
  }
  inflightByText.set(text, now);

  const lang = /\p{Script=Latin}/u.test(text) ? 'en-US' : 'zh-CN';

  if (button) button.classList.add('is-playing');

  const message: SpeakMessage = {
    type: TTS_MESSAGE_TYPE,
    text,
    lang,
    rate: 0.95,
  };

  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[EasyTranslate] TTS dispatch failed:',
          chrome.runtime.lastError.message,
        );
      }
      if (response && response.success === false) {
        console.warn('[EasyTranslate] TTS background rejected the request:', response.error);
      }
      // We don't have an `onend` from chrome.tts (it only reports
      // success/failure at speak time), so we drop the highlight after
      // a short delay proportional to the word length.
      const dropMs = Math.max(800, text.length * 120);
      window.setTimeout(() => {
        if (button) button.classList.remove('is-playing');
      }, dropMs);
    });
  } catch (error) {
    if (button) button.classList.remove('is-playing');
    console.warn('[EasyTranslate] TTS sendMessage threw:', error);
  }
}

function isRuntimeMessagingAvailable(): boolean {
  return (
    typeof chrome !== 'undefined'
    && typeof chrome.runtime !== 'undefined'
    && typeof chrome.runtime.sendMessage === 'function'
  );
}
