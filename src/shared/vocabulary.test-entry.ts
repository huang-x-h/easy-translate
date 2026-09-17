// Test-only entry point. Bundles the shared modules as an IIFE that exposes
// their public surface on globalThis so jsdom-based test scripts can drive
// them. Not loaded by the extension itself.
import { VocabularyManager } from './vocabulary';
import { playPronunciation } from './speech';
import { isWordLike, isChinese } from './text';

declare global {
  // eslint-disable-next-line no-var
  var __easyTranslateClasses: {
    VocabularyManager: typeof VocabularyManager;
    playPronunciation: typeof playPronunciation;
    isWordLike: typeof isWordLike;
    isChinese: typeof isChinese;
  };
}

(globalThis as any).__easyTranslateClasses = {
  VocabularyManager,
  playPronunciation,
  isWordLike,
  isChinese,
};