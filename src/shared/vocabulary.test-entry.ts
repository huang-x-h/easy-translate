// Test-only entry point. Bundles the shared modules as an IIFE that exposes
// their public surface on globalThis so jsdom-based test scripts can drive
// them. Not loaded by the extension itself.
import { VocabularyManager } from './vocabulary';
import { playPronunciation, ttsSpeak } from './speech';

declare global {
  // eslint-disable-next-line no-var
  var __easyTranslateClasses: {
    VocabularyManager: typeof VocabularyManager;
    playPronunciation: typeof playPronunciation;
    ttsSpeak: typeof ttsSpeak;
  };
}

(globalThis as any).__easyTranslateClasses = {
  VocabularyManager,
  playPronunciation,
  ttsSpeak,
};