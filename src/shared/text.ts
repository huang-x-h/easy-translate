/**
 * Text-shape helpers used to decide whether a piece of text deserves
 * a phonetic + audio button, and whether a TTS request makes sense.
 *
 * The same predicate is used in three places: the selection popup,
 * the vocabulary list, and the review card. Centralising it here keeps
 * the rules consistent and easy to evolve.
 *
 * Rules (deliberately permissive about CJK, strict about whitespace):
 *
 *   - empty / whitespace-only              → false
 *   - contains a line break                → false
 *   - longer than 30 characters            → false
 *   - 3 or more Han / Kana / Hangul chars   → false  (long CJK phrase)
 *   - 2+ whitespace-separated tokens        → false  (multi-word English)
 *   - only digits / punctuation / symbols  → false
 *   - 1 CJK character (or 2)               → true
 *   - 1 Latin token (with optional - / ')  → true
 */

const MAX_LENGTH = 30;

export function isWordLike(text: string): boolean {
  if (!text) return false;

  const t = text.trim();
  if (!t) return false;
  if (t.length > MAX_LENGTH) return false;

  // Multi-line input never gets a phonetic.
  if (/\r?\n/.test(t)) return false;

  // Pure digits / punctuation / symbols (e.g. "12", "?!", "...")
  // never get a phonetic.
  if (/^[\d\p{P}\p{S}]+$/u.test(t)) return false;

  // Count CJK characters (Han, Kana, Hangul). If there are 3+ in a row
  // we treat it as a phrase, not a word.
  const cjkCount = countCjk(t);
  if (cjkCount >= 3) return false;
  if (cjkCount > 0) {
    // 1 or 2 CJK chars (with optional surrounding punctuation) → word.
    return true;
  }

  // Latin path: collapse runs of whitespace and count tokens.
  if (/ {2,}|\t/.test(t)) return false;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;

  // Single Latin token — require at least one letter. Pure symbols
  // (e.g. "--") are caught above, this is the letter-only case.
  return /[A-Za-z]/.test(t);
}

function countCjk(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (isCjk(ch)) count++;
  }
  return count;
}

function isCjk(ch: string): boolean {
  // Han (CJK Unified Ideographs + extensions), Hiragana, Katakana,
  // Hangul syllables — the four "single word" CJK alphabets.
  return (
    /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/u.test(ch)
    || /[\u3040-\u309F\u30A0-\u30FF]/u.test(ch)
    || /[\uAC00-\uD7AF]/u.test(ch)
  );
}
