import { TranslationAPI } from '../shared/api';
import { StorageManager } from '../shared/storage';
import { extractArticle, extractParagraphs, getMainContentElement, ParagraphInfo } from './readability';

export class BilingualTranslator {
  private isTranslated: boolean = false;
  private isTranslating: boolean = false;
  private isCancelling: boolean = false;
  private originalParagraphs: ParagraphInfo[] = [];
  private translatedParagraphs: Map<number, string> = new Map();
  private translationElements: Map<number, HTMLElement> = new Map();
  private currentHighlightIndex: number = -1;

  public isTranslatedState(): boolean {
    return this.isTranslated;
  }

  public isTranslatingState(): boolean {
    return this.isTranslating;
  }

  /**
   * Cancel ongoing translation
   */
  public cancelTranslation(): void {
    if (!this.isTranslating) return;
    
    this.isCancelling = true;
    this.showNotification('翻译已取消');
    this.hideProgress();
  }

  /**
   * Find DOM element that contains the given text content.
   * Uses Readability's extracted content to locate the corresponding element.
   * Prefers the smallest container with high overlap so single-article pages
   * stay precise, while social feeds (e.g. X/Twitter) that spread content
   * across multiple articles fall back to the broader wrapper (main/section).
   */
  private findContentElement(textContent: string): HTMLElement | null {
    // Common selectors
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.entry-content',
      '.content',
      '.article-content',
      '.article-body',
      '.post',
      '.article',
      '.story-body',
      '.markdown-body',
      '#content',
      '#main',
      '.main-content',
    ];

    // Collect all matching candidates with scores instead of returning on first hit
    const candidates: { element: HTMLElement; overlap: number }[] = [];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of Array.from(elements)) {
        const elementText = element.textContent || '';
        const overlap = this.calculateOverlap(elementText, textContent);
        if (overlap > 0.3) {
          candidates.push({ element: element as HTMLElement, overlap });
        }
      }
    }

    // Also consider broader candidates when no selector matched well
    if (candidates.length === 0) {
      const broadCandidates = document.querySelectorAll('section, div, article, main');
      for (const candidate of Array.from(broadCandidates)) {
        const candidateText = (candidate as HTMLElement).textContent || '';
        if (candidateText.length < 500) continue;
        const overlap = this.calculateOverlap(candidateText, textContent);
        if (overlap > 0.3) {
          candidates.push({ element: candidate as HTMLElement, overlap });
        }
      }
    }

    if (candidates.length === 0) {
      return document.body;
    }

    // Prefer the candidate with the highest overlap; tie-break by choosing
    // the smallest container (shorter text length) for precision on normal
    // article pages. This lets X/Twitter feeds select the broader wrapper
    // when its overlap is materially higher than a single article.
    candidates.sort((a, b) => {
      if (Math.abs(b.overlap - a.overlap) > 0.05) {
        return b.overlap - a.overlap;
      }
      return (a.element.textContent?.length || 0) - (b.element.textContent?.length || 0);
    });

    return candidates[0].element;
  }

  /**
   * Calculate overlap between two texts (0-1)
   */
  private calculateOverlap(text1: string, text2: string): number {
    const words1 = new Set(this.getWords(text1));
    const words2 = new Set(this.getWords(text2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    let matches = 0;
    for (const word of words2) {
      if (words1.has(word)) matches++;
    }
    
    return matches / words2.size;
  }

  /**
   * Extract meaningful words from text
   */
  private getWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-zA-Z\u4e00-\u9fa5]/g, ' ') // Keep letters and CJK
      .split(/\s+/)
      .filter(w => w.length > 2); // Filter short words
  }

  private findFallbackContentElement(): HTMLElement | null {
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.entry-content',
      '.content',
      '.article-content',
      '.article-body',
      '.markdown-body',
      '#content',
      '#main',
      'body',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && extractParagraphs(element as HTMLElement).length > 0) {
        return element as HTMLElement;
      }
    }

    return null;
  }

  public async translatePage(): Promise<void> {
    if (this.isTranslating || this.isTranslated) return;

    this.isTranslating = true;

    try {
      // Extract article content using Readability
      const article = extractArticle();
      const fallbackRootElement = getMainContentElement() || this.findFallbackContentElement();
      if ((!article || !article.textContent || article.textContent.length < 100) && !fallbackRootElement) {
        this.showNotification('无法提取文章内容，请确保页面有可读内容');
        this.isTranslating = false;
        return;
      }

      // Get configuration
      const config = await StorageManager.getConfig();
      if (!config.apiKey) {
        this.showNotification('请先设置 API Key');
        this.isTranslating = false;
        return;
      }


      // Find the main content element using Readability's extracted content
      // Try to match the extracted content back to a DOM element
      const rootElement = article?.textContent && article.textContent.length >= 100
        ? this.findContentElement(article.textContent)
        : fallbackRootElement;
      if (!rootElement) {
        this.showNotification('无法定位页面正文内容');
        this.isTranslating = false;
        return;
      }

      this.originalParagraphs = extractParagraphs(rootElement);

      if (this.originalParagraphs.length === 0) {
        this.showNotification('页面没有可翻译的内容');
        this.isTranslating = false;
        return;
      }

      // Show progress indicator
      this.showProgress(0, this.originalParagraphs.length);

      // Translate paragraph by paragraph for progressive display
      const api = new TranslationAPI(config);
      let translatedCount = 0;

      for (let i = 0; i < this.originalParagraphs.length; i++) {
        // Check if translation was cancelled
        if (this.isCancelling) {
          break;
        }
        
        const para = this.originalParagraphs[i];
        
        // Clear previous highlight
        this.clearHighlight();

        // Check cache first
        let translatedText: string | null = await StorageManager.getCachedTranslation(para.text, config.targetLang);

        if (!translatedText) {
          // Highlight current paragraph being translated
          this.highlightParagraph(para.index);

          // Translate
          const result = await api.translate({
            text: para.text,
            targetLang: config.targetLang,
          });

          if (result.error) {
            console.error('Translation error for paragraph', para.index, result.error);
            translatedText = `[翻译失败] ${para.text.substring(0, 50)}...`;
          } else {
            translatedText = result.translatedText;
            // Cache the result
            await StorageManager.setCachedTranslation(para.text, translatedText, config.targetLang);
          }
        }

        // Store and render immediately
        this.translatedParagraphs.set(para.index, translatedText);
        this.renderSingleParagraph(para.index, translatedText);
        
        translatedCount++;
        this.showProgress(translatedCount, this.originalParagraphs.length);

        // Small delay to prevent overwhelming the API
        await this.delay(50);
      }

      // Clear state
      this.isTranslated = !this.isCancelling && translatedCount > 0;
      this.isTranslating = false;
      this.isCancelling = false;
      this.hideProgress();
      
      if (!this.isCancelling) {
        this.showNotification(`翻译完成 (${translatedCount} 段落)`);
      }

    } catch (error) {
      console.error('Translation error:', error);
      this.showNotification('翻译失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      this.isTranslating = false;
      this.currentHighlightIndex = -1;
      this.isCancelling = false;
    }
  }

  private renderSingleParagraph(index: number, translatedText: string): void {
    const para = this.originalParagraphs.find(p => p.index === index);
    if (!para) return;

    // Check if already rendered
    let translationElement = this.translationElements.get(index);
    if (translationElement) {
      translationElement.textContent = translatedText;
      return;
    }

    // Create new translation element
    translationElement = document.createElement('div');
    translationElement.className = 'immersive-translate-bilingual';
    translationElement.textContent = translatedText;
    translationElement.style.cssText = `
      margin-top: 8px;
      padding: 12px 16px;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border-left: 3px solid #0ea5e9;
      border-radius: 0 8px 8px 0;
      font-size: 0.95em;
      line-height: 1.6;
      color: #0c4a6e;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    `;

    // Insert after original paragraph
    para.element.insertAdjacentElement('afterend', translationElement);
    this.translationElements.set(index, translationElement);
  }

  private highlightParagraph(index: number): void {
    const para = this.originalParagraphs.find(p => p.index === index);
    if (!para) return;

    this.currentHighlightIndex = index;
    para.element.style.cssText = `
      background: linear-gradient(90deg, #fef3c7 0%, #fde68a 100%);
      border-left: 3px solid #f59e0b;
      padding: 4px 8px;
      margin: 4px 0;
      border-radius: 4px;
      transition: background 0.3s, border-color 0.3s;
    `;
  }

  private clearHighlight(): void {
    if (this.currentHighlightIndex < 0) return;

    const para = this.originalParagraphs.find(p => p.index === this.currentHighlightIndex);
    if (para) {
      para.element.style.cssText = '';
    }
    this.currentHighlightIndex = -1;
  }

  public resetPage(): void {
    // Clear highlight first
    this.clearHighlight();

    // Remove all translation elements
    for (const element of this.translationElements.values()) {
      element.remove();
    }
    this.translationElements.clear();
    this.translatedParagraphs.clear();
    this.originalParagraphs = [];
    this.isTranslated = false;
    this.hideProgress();
  }

  private showProgress(current: number, total: number): void {
    const existingProgress = document.getElementById('immersive-translate-progress');
    if (existingProgress) {
      const percentage = Math.round((current / total) * 100);
      const progressBar = existingProgress.querySelector('.progress-bar') as HTMLElement;
      const progressText = existingProgress.querySelector('.progress-text') as HTMLElement;
      if (progressBar) progressBar.style.width = `${percentage}%`;
      if (progressText) progressText.textContent = `翻译中... ${current}/${total}`;
      return;
    }

    const progress = document.createElement('div');
    progress.id = 'immersive-translate-progress';
    progress.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      width: 200px;
      padding: 12px 16px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    progress.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-size: 13px; font-weight: 500; color: #374151;">翻译中...</span>
        <span class="progress-text" style="font-size: 12px; color: #6b7280;">0/${total}</span>
      </div>
      <div style="width: 100%; height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden;">
        <div class="progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4f46e5, #0ea5e9); border-radius: 2px; transition: width 0.3s ease;"></div>
      </div>
    `;

    document.body.appendChild(progress);
  }

  private hideProgress(): void {
    const progress = document.getElementById('immersive-translate-progress');
    if (progress) {
      progress.style.opacity = '0';
      setTimeout(() => progress.remove(), 300);
    }
  }

  private showNotification(message: string): void {
    const existing = document.getElementById('immersive-translate-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'immersive-translate-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      padding: 12px 20px;
      background: #1f2937;
      color: white;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
