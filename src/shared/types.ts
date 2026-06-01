export interface TranslationConfig {
  apiEndpoint: string;
  apiKey: string;
  targetLang: string;
  model: string;
  translationStyle: 'natural' | 'literal';
}

export interface TranslationRequest {
  text: string;
  context?: string;
  targetLang: string;
  stream?: boolean;
}

export interface TranslationResponse {
  translatedText: string;
  error?: string;
}

export interface CacheEntry {
  originalText: string;
  translatedText: string;
  timestamp: number;
  targetLang: string;
}

export type TranslationMode = 'selection' | 'page';

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
};

export const STORAGE_KEYS = {
  CONFIG: 'translation_config',
  CACHE: 'translation_cache',
};
