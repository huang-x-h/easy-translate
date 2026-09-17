export interface TranslationConfig {
  apiEndpoint: string;
  apiKey: string;
  targetLang: string;
  model: string;
  translationStyle: 'natural' | 'literal';
  /**
   * Which way to translate:
   * - 'auto' (default) — pick direction from the source text
   * - 'en-to-zh' / 'zh-to-en' — explicit, overrides auto-detection
   */
  translationDirection: TranslationDirection;
}

export interface TranslationRequest {
  text: string;
  context?: string;
  targetLang: string;
  stream?: boolean;
}

export interface TranslationResponse {
  translatedText: string;
  /**
   * IPA phonetic for the source text, wrapped in slashes
   * (e.g. `/əˈpærəntli/`). Undefined when the source is a phrase/sentence
   * or when extraction failed.
   */
  pronunciation?: string;
  error?: string;
}

export interface CacheEntry {
  originalText: string;
  translatedText: string;
  pronunciation?: string;
  timestamp: number;
  targetLang: string;
}

export interface VocabularyEntry {
  id: string;
  originalText: string;
  normalizedText: string;
  translation: string;
  pronunciation?: string;
  audioUrl?: string;
  sourceUrl: string;
  sourceTitle?: string;
  notes?: string;
  targetLang: string;
  createdAt: number;
  updatedAt: number;
  reviewCount?: number;
  lastReviewedAt?: number;
}

export type ReviewRating = 'unknown' | 'fuzzy' | 'known';

export interface PronunciationInfo {
  phonetic: string;
  audioUrl?: string;
}

export type TranslationMode = 'selection' | 'page';

export type TranslationDirection = 'auto' | 'en-to-zh' | 'zh-to-en';

export const DEFAULT_DIRECTION: TranslationDirection = 'auto';

export interface ParagraphData {
  element: HTMLElement;
  text: string;
  translatedText?: string;
}

export const DEFAULT_CONFIG: TranslationConfig = {
  apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  targetLang: 'zh-CN',
  model: 'glm-4-flash',
  translationStyle: 'natural',
  translationDirection: 'auto',
};

export const STORAGE_KEYS = {
  CONFIG: 'translation_config',
  CACHE: 'translation_cache',
  VOCABULARY_INDEX: 'vocabulary_index',
};

// Vocabulary entries are stored individually under `vocab_<id>` keys
// to keep reads/writes granular. `vocabulary_index` holds the list of ids.
export const VOCABULARY_KEY_PREFIX = 'vocab_';
