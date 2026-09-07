// Test-only entry point. Bundles the shared vocabulary module as an
// IIFE that exposes its public surface on globalThis so jsdom-based
// test scripts can drive it. Not loaded by the extension itself.
import { VocabularyManager } from './vocabulary';

declare global {
  // eslint-disable-next-line no-var
  var __easyTranslateClasses: {
    VocabularyManager: typeof VocabularyManager;
  };
}

(globalThis as any).__easyTranslateClasses = {
  VocabularyManager,
};