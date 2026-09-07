import { TranslationConfig, CacheEntry, DEFAULT_CONFIG, STORAGE_KEYS } from './types';

export class StorageManager {
  // Configuration methods
  static async getConfig(): Promise<TranslationConfig> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    return { ...DEFAULT_CONFIG, ...(result[STORAGE_KEYS.CONFIG] || {}) };
  }

  static async setConfig(config: TranslationConfig): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config });
  }

  // Cache methods
  static async getCachedTranslation(
    text: string,
    targetLang: string,
  ): Promise<{ translatedText: string; pronunciation?: string } | null> {
    const cacheKey = this.generateCacheKey(text, targetLang);
    const result = await chrome.storage.local.get(cacheKey);
    const entry: CacheEntry | undefined = result[cacheKey];

    if (!entry) return null;

    // Check if cache is expired (7 days)
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (now - entry.timestamp > sevenDays) {
      await chrome.storage.local.remove(cacheKey);
      return null;
    }

    return {
      translatedText: entry.translatedText,
      pronunciation: entry.pronunciation,
    };
  }

  static async setCachedTranslation(
    text: string,
    translatedText: string,
    targetLang: string,
    pronunciation?: string,
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(text, targetLang);
    const entry: CacheEntry = {
      originalText: text,
      translatedText,
      pronunciation,
      timestamp: Date.now(),
      targetLang,
    };
    await chrome.storage.local.set({ [cacheKey]: entry });
  }

  private static generateCacheKey(text: string, targetLang: string): string {
    // Simple hash function for cache key
    let hash = 0;
    const str = text + targetLang;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `cache_${hash}`;
  }

  static async clearCache(): Promise<void> {
    const allData = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith('cache_'));
    await chrome.storage.local.remove(cacheKeys);
  }
}
