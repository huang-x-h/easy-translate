import {
  VocabularyEntry,
  PronunciationInfo,
  TranslationResponse,
  STORAGE_KEYS,
  VOCABULARY_KEY_PREFIX,
} from './types';

export interface VocabularySaveInput {
  originalText: string;
  translation: string;
  targetLang: string;
  pronunciation?: string;
  audioUrl?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  notes?: string;
}

export interface BackfillResult {
  total: number;
  updated: number;
  /** LLM returned an empty pronunciation (not a single word). */
  skipped: number;
  /** LLM call itself threw. */
  failed: number;
  cancelled: boolean;
}

/**
 * Persists user-saved vocabulary entries to chrome.storage.local.
 *
 * Entries are keyed individually (`vocab_<id>`) so writes don't have to
 * rewrite the whole collection, and an index array (`vocabulary_index`)
 * keeps ids in insertion order.
 */
export class VocabularyManager {
  static async saveEntry(input: VocabularySaveInput): Promise<VocabularyEntry> {
    const id = this.generateId(input.originalText, input.targetLang);
    const normalizedText = this.normalize(input.originalText);
    const now = Date.now();

    const existing = await this.getEntryById(id);
    const entry: VocabularyEntry = {
      id,
      originalText: input.originalText,
      normalizedText,
      translation: input.translation,
      pronunciation: input.pronunciation || existing?.pronunciation,
      audioUrl: input.audioUrl || existing?.audioUrl,
      sourceUrl: input.sourceUrl || existing?.sourceUrl || '',
      sourceTitle: input.sourceTitle || existing?.sourceTitle,
      notes: input.notes ?? existing?.notes,
      targetLang: input.targetLang,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await chrome.storage.local.set({ [id]: entry });
    await this.addToIndex(id);
    return entry;
  }

  static async removeEntry(id: string): Promise<void> {
    await chrome.storage.local.remove(id);
    await this.removeFromIndex(id);
  }

  static async getEntryById(id: string): Promise<VocabularyEntry | null> {
    const result = await chrome.storage.local.get(id);
    return (result[id] as VocabularyEntry | undefined) ?? null;
  }

  static async getEntry(
    originalText: string,
    targetLang: string,
  ): Promise<VocabularyEntry | null> {
    const id = this.generateId(originalText, targetLang);
    return this.getEntryById(id);
  }

  static async hasEntry(originalText: string, targetLang: string): Promise<boolean> {
    const entry = await this.getEntry(originalText, targetLang);
    return entry !== null;
  }

  static async getAllEntries(): Promise<VocabularyEntry[]> {
    const ids = await this.getIndex();
    if (ids.length === 0) return [];

    const result = await chrome.storage.local.get(ids);
    const entries: VocabularyEntry[] = [];
    for (const id of ids) {
      const entry = result[id] as VocabularyEntry | undefined;
      if (entry) entries.push(entry);
    }

    // Newest first
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return entries;
  }

  /**
   * Returns vocabulary entries saved today (local time), ordered by
   * creation time ascending so the review session walks the user
   * through them in the same order they were saved.
   */
  static async getTodayEntries(now: number = Date.now()): Promise<VocabularyEntry[]> {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = startOfDay.getTime();

    const all = await this.getAllEntries();
    return all
      .filter(entry => entry.createdAt >= startOfDayTs)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  static async markReviewed(id: string): Promise<VocabularyEntry | null> {
    const entry = await this.getEntryById(id);
    if (!entry) return null;

    const updated: VocabularyEntry = {
      ...entry,
      reviewCount: (entry.reviewCount ?? 0) + 1,
      lastReviewedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [id]: updated });
    return updated;
  }

  /**
   * Looks up pronunciation for a saved entry via dictionaryapi.dev and
   * persists it on the entry. Skips entries that already have a phonetic
   * (so re-running never overwrites user data with a slightly different
   * value) and entries whose original text is not a single English-style
   * word (the dictionary only covers those).
   */
  static async enrichWithPronunciation(id: string): Promise<VocabularyEntry | null> {
    const entry = await this.getEntryById(id);
    if (!entry) return null;
    if (entry.pronunciation) return entry;
    if (!DictionaryAPI.isLookupableWord(entry.originalText)) return entry;

    try {
      const pronunciation = await DictionaryAPI.fetchPronunciation(entry.originalText);
      if (!pronunciation) return entry;

      const updated: VocabularyEntry = {
        ...entry,
        pronunciation: pronunciation.phonetic,
        audioUrl: pronunciation.audioUrl || entry.audioUrl,
        updatedAt: Date.now(),
      };
      await chrome.storage.local.set({ [id]: updated });
      return updated;
    } catch (error) {
      console.warn('[EasyTranslate] enrichWithPronunciation failed:', error);
      return entry;
    }
  }

  /**
   * Walks every vocabulary entry whose `pronunciation` is empty and asks
   * the supplied LLM-backed translator to fill in IPA. Intended for the
   * "one-click backfill" banner in the options page that lets users
   * recover phonetics for entries saved before the LLM-driven flow.
   *
   * The translator is injected (rather than constructed here) so this
   * module stays free of translation-API concerns and the options page
   * can swap in the user's configured endpoint.
   *
   * Behaviour:
   * - Serial, one entry at a time, to avoid hammering the LLM endpoint.
   * - `signal` aborts the loop and reports `cancelled: true`.
   * - LLM returning an empty `pronunciation` counts as "skipped" (the
   *   model judged it not a word) — the entry is left untouched so the
   *   banner stays accurate.
   * - Translation / audio / notes / source fields are never overwritten;
   *   only `pronunciation` is added when the LLM provides one.
   */
  static async backfillMissingPronunciations(
    translate: (text: string, targetLang: string) => Promise<TranslationResponse>,
    options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<BackfillResult> {
    const all = await this.getAllEntries();
    const targets = all.filter(entry => !entry.pronunciation);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let cancelled = false;

    for (let i = 0; i < targets.length; i++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      const entry = targets[i];
      try {
        const result = await translate(entry.originalText, entry.targetLang);
        if (result.pronunciation) {
          // Reuse saveEntry so we keep the existing id, audioUrl,
          // source fields and notes intact — only pronunciation is
          // patched in.
          await this.saveEntry({
            originalText: entry.originalText,
            translation: entry.translation,
            targetLang: entry.targetLang,
            pronunciation: result.pronunciation,
            sourceUrl: entry.sourceUrl,
            sourceTitle: entry.sourceTitle,
            notes: entry.notes,
          });
          updated++;
        } else {
          // Model says this isn't a word (sentence / phrase). Leave the
          // entry alone so the banner keeps surfacing it.
          skipped++;
        }
      } catch (error) {
        console.warn('[EasyTranslate] backfill failed for', entry.originalText, error);
        failed++;
      }

      options.onProgress?.(i + 1, targets.length);
    }

    return { total: targets.length, updated, skipped, failed, cancelled };
  }

  static async clearAll(): Promise<void> {
    const ids = await this.getIndex();
    if (ids.length === 0) return;

    const keysToRemove = ids.map(id => `${VOCABULARY_KEY_PREFIX}${this.hashId(id, '')}`);
    // Remove by both raw id and prefixed id to be safe across versions.
    await chrome.storage.local.remove([...ids, ...keysToRemove]);
    await chrome.storage.local.remove(STORAGE_KEYS.VOCABULARY_INDEX);
  }

  static async updateNotes(id: string, notes: string): Promise<VocabularyEntry | null> {
    const entry = await this.getEntryById(id);
    if (!entry) return null;

    const updated: VocabularyEntry = {
      ...entry,
      notes: notes.trim() ? notes : undefined,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [id]: updated });
    return updated;
  }

  static exportAsJson(entries: VocabularyEntry[]): string {
    return JSON.stringify(entries, null, 2);
  }

  static exportAsCsv(entries: VocabularyEntry[]): string {
    const header = [
      'original',
      'translation',
      'pronunciation',
      'sourceUrl',
      'sourceTitle',
      'notes',
      'targetLang',
      'createdAt',
      'updatedAt',
    ];
    const lines = [header.join(',')];
    for (const entry of entries) {
      lines.push(
        [
          entry.originalText,
          entry.translation,
          entry.pronunciation || '',
          entry.sourceUrl || '',
          entry.sourceTitle || '',
          entry.notes || '',
          entry.targetLang,
          new Date(entry.createdAt).toISOString(),
          new Date(entry.updatedAt).toISOString(),
        ]
          .map(this.escapeCsvCell)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  // --- private helpers ---------------------------------------------------

  private static generateId(text: string, targetLang: string): string {
    const normalized = this.normalize(text);
    return `${VOCABULARY_KEY_PREFIX}${this.hashId(normalized, targetLang)}`;
  }

  private static normalize(text: string): string {
    return text.trim().toLowerCase();
  }

  private static hashId(normalizedText: string, targetLang: string): string {
    const str = `${normalizedText}::${targetLang}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // Use unsigned representation so ids stay positive
    return String(hash >>> 0);
  }

  private static async getIndex(): Promise<string[]> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.VOCABULARY_INDEX);
    const index = result[STORAGE_KEYS.VOCABULARY_INDEX];
    return Array.isArray(index) ? (index as string[]) : [];
  }

  private static async addToIndex(id: string): Promise<void> {
    const index = await this.getIndex();
    if (!index.includes(id)) {
      index.push(id);
      await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY_INDEX]: index });
    }
  }

  private static async removeFromIndex(id: string): Promise<void> {
    const index = await this.getIndex();
    const next = index.filter(existing => existing !== id);
    if (next.length !== index.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.VOCABULARY_INDEX]: next });
    }
  }

  private static escapeCsvCell(value: string): string {
    if (value === '') return '';
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// --- module-level helpers --------------------------------------------------

/**
 * Wraps the dictionaryapi.dev lookup that powers pronunciation/audio
 * enrichment. Exported so the selection popup can reuse the same fetch +
 * parsing pipeline when it needs an audio fallback (the LLM only returns
 * IPA, not audio URLs).
 */
export const DictionaryAPI = {
  /** Single English-style token, including "self-esteem" and "don't". */
  isLookupableWord(text: string): boolean {
    return /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(text.trim());
  },

  async fetchPronunciation(
    text: string,
    timeoutMs = 4000,
  ): Promise<PronunciationInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.trim().toLowerCase())}`,
        { signal: controller.signal },
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data) || !data[0]) return null;
      return extractPronunciation(data[0]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
};

function extractPronunciation(entry: unknown): PronunciationInfo | null {
  if (!entry || typeof entry !== 'object') return null;
  const dictionaryEntry = entry as {
    phonetic?: unknown;
    phonetics?: Array<{ text?: unknown; audio?: unknown }>;
  };
  const phonetics = Array.isArray(dictionaryEntry.phonetics) ? dictionaryEntry.phonetics : [];
  const phonetic = asNonEmptyString(dictionaryEntry.phonetic)
    || asNonEmptyString(phonetics.find((p) => asNonEmptyString(p.text))?.text);
  if (!phonetic) return null;
  const audioUrl = asNonEmptyString(phonetics.find((p) => asNonEmptyString(p.audio))?.audio);
  return { phonetic, audioUrl: audioUrl || undefined };
}

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}