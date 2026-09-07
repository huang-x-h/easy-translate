/**
 * Unified pronunciation playback: tries a real audio recording first
 * (from dictionaryapi.dev), falls back to the browser's built-in
 * speechSynthesis if no recording is available or playback fails.
 *
 * Works in both content scripts (isolated world) and extension pages.
 * speechSynthesis is part of the DOM API and is available in Chromium.
 */

export interface PlayOptions {
  /** A pre-recorded audio URL (from dictionaryapi.dev). */
  audioUrl?: string;
  /** The original word to speak via TTS (NOT the IPA string). */
  word: string;
  /** Optional button element that should get the `is-playing` class. */
  button?: HTMLElement | null;
}

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

  // No recording — straight to TTS.
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
  audio.addEventListener('ended', done);
  audio.addEventListener('error', () => {
    done();
    if (word) ttsSpeak(word, button);
  });
  if (button) button.classList.add('is-playing');
  audio.play().catch(() => {
    done();
    if (word) ttsSpeak(word, button);
  });
}

/**
 * Speaks `text` using the browser's speechSynthesis API. Picks en-US or
 * zh-CN based on whether the text contains Latin letters.
 */
export function ttsSpeak(text: string, button?: HTMLElement | null): void {
  if (!text || !('speechSynthesis' in window)) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = /\p{Script=Latin}/u.test(text) ? 'en-US' : 'zh-CN';
  utter.rate = 0.85;

  const done = () => {
    if (button) button.classList.remove('is-playing');
  };
  utter.onend = done;
  utter.onerror = done;

  if (button) button.classList.add('is-playing');

  // Cancel any in-flight utterance so rapid clicks don't queue up.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}