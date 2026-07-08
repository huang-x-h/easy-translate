import { TranslationAPI } from '../shared/api';
import { StorageManager } from '../shared/storage';

interface PronunciationInfo {
  phonetic: string;
  audioUrl?: string;
}

export class SelectionPopup {
  private floatingButton: HTMLElement | null = null;
  private popup: HTMLElement | null = null;
  private currentText: string = '';
  private currentTranslation: string = '';
  private currentPronunciationAudio: string = '';
  private isTranslating: boolean = false;
  private selectionRect: DOMRect | null = null;

  constructor() {
    this.createFloatingButton();
    this.createPopup();
  }

  private createFloatingButton(): void {
    this.floatingButton = document.createElement('div');
    this.floatingButton.className = 'immersive-translate-floating-button';
    this.floatingButton.innerHTML = this.renderLogo();
    this.floatingButton.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #ffffff;
      color: #ec4c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0px 4px 16px 0px rgba(0, 0, 0, 0.08);
      transition: transform 0.2s, box-shadow 0.2s;
      pointer-events: auto;
      opacity: 0;
      visibility: hidden;
    `;

    this.floatingButton.addEventListener('mouseenter', () => {
      if (this.floatingButton) {
        this.floatingButton.style.transform = 'scale(1.1)';
      }
    });

    this.floatingButton.addEventListener('mouseleave', () => {
      if (this.floatingButton) {
        this.floatingButton.style.transform = 'scale(1)';
      }
    });

    this.floatingButton.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    this.floatingButton.addEventListener('mouseup', (event) => {
      event.stopPropagation();
    });

    this.floatingButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showPopup();
    });

    document.body.appendChild(this.floatingButton);
  }

  private createPopup(): void {
    this.popup = document.createElement('div');
    this.popup.className = 'immersive-translate-modal imt-notranslate light';
    this.popup.setAttribute('dir', 'ltr');
    this.popup.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483647;
      display: none;
      width: min(420px, calc(100vw - 24px));
      box-sizing: border-box;
      background-color: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0px 10px 32px 0px rgba(0, 0, 0, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif, "PingFang SC", "Microsoft YaHei";
      color: #222;
    `;

    document.addEventListener('click', (event) => {
      if (!this.popup) return;
      const target = event.target as Node;
      if (
        !this.popup.contains(target) &&
        !this.floatingButton?.contains(target)
      ) {
        this.hidePopup();
      }
    });

    document.body.appendChild(this.popup);
  }

  public showButton(rect: DOMRect, text: string): void {
    if (!this.floatingButton) return;

    this.currentText = text;
    this.currentTranslation = '';
    this.currentPronunciationAudio = '';
    this.selectionRect = rect;
    this.hidePopup();

    const buttonX = rect.right + 8;
    const buttonY = rect.bottom + 6;
    const finalX = Math.min(Math.max(8, buttonX), window.innerWidth - 40);
    const finalY = Math.min(Math.max(8, buttonY), window.innerHeight - 40);

    this.floatingButton.style.left = `${finalX}px`;
    this.floatingButton.style.top = `${finalY}px`;
    this.floatingButton.style.opacity = '1';
    this.floatingButton.style.visibility = 'visible';
  }

  public hideButton(): void {
    if (!this.floatingButton) return;
    this.floatingButton.style.opacity = '0';
    this.floatingButton.style.visibility = 'hidden';
  }

  public hidePopup(): void {
    if (!this.popup) return;
    this.popup.style.display = 'none';
    this.popup.style.opacity = '0';
    this.isTranslating = false;
  }

  public containsNode(node: Node | null): boolean {
    if (!node) return false;

    return Boolean(
      this.popup?.contains(node) ||
      this.floatingButton?.contains(node)
    );
  }

  private async showPopup(): Promise<void> {
    if (!this.popup || !this.selectionRect) return;

    this.positionPopup();
    this.hideButton();
    this.popup.innerHTML = this.renderPopupShell(this.renderLoadingBody());
    this.bindPopupActions();
    this.popup.style.display = 'block';
    this.popup.style.opacity = '1';

    await this.translateSelection();
  }

  private positionPopup(): void {
    if (!this.popup || !this.selectionRect) return;

    const rect = this.selectionRect;
    const margin = 12;
    const gap = 10;
    const popupWidth = Math.min(420, window.innerWidth - margin * 2);
    const estimatedPopupHeight = 220;
    const selectionCenterX = rect.left + rect.width / 2;

    let popupX = selectionCenterX - popupWidth / 2;
    let popupY = rect.bottom + gap;

    if (popupY + estimatedPopupHeight > window.innerHeight - margin) {
      popupY = rect.top - estimatedPopupHeight - gap;
    }

    popupX = Math.min(Math.max(margin, popupX), window.innerWidth - popupWidth - margin);
    popupY = Math.min(Math.max(margin, popupY), window.innerHeight - estimatedPopupHeight - margin);

    this.popup.style.width = `${popupWidth}px`;
    this.popup.style.left = `${popupX}px`;
    this.popup.style.top = `${popupY}px`;
    this.popup.style.transform = 'translate(0px, 0px)';
  }

  private renderPopupShell(bodyHtml: string): string {
    return `
      <div class="immersive-translate-modal-title imt-notranslate" style="cursor: move;">
        <div class="immersive-translate-modal-title-left">
          ${this.renderLogo()}
          <span class="immersive-translate-title-text">EasyTranslate</span>
        </div>
        <div class="immersive-translate-modal-title-right">
          <span class="icon-wrapper-no-bg close-icon header-icon immersive-translate-close" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14.682 13.9917L18.6826 9.99172C18.8046 9.86977 18.8522 9.69202 18.8076 9.52544C18.7114 9.16649 18.2627 9.04627 18 9.30903L14 13.3096L9.99997 9.30905C9.87802 9.1871 9.70027 9.13947 9.53369 9.18411C9.17474 9.28028 9.05452 9.72896 9.31728 9.99173L13.3179 13.9917L9.38353 17.9254C9.26159 18.0474 9.21396 18.2251 9.2586 18.3917C9.35477 18.7507 9.80345 18.8709 10.0662 18.6081L14 14.6738L17.9337 18.6081C18.0556 18.7301 18.2334 18.7777 18.4 18.7331C18.7589 18.6369 18.8791 18.1882 18.6164 17.9254L14.682 13.9917Z" fill="currentColor"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="immersive-translate-modal-body imt-notranslate">${bodyHtml}</div>
    `;
  }

  private renderLogo(): string {
    const logoUrl = this.getExtensionUrl('icons/icon-32.png');
    if (!logoUrl) {
      return this.renderFallbackLogoSvg();
    }

    return `<img class="logo" src="${logoUrl}" alt="EasyTranslate" width="18" height="18" />`;
  }

  private getExtensionUrl(path: string): string | null {
    try {
      const url = chrome.runtime.getURL(path);
      return url.includes('chrome-extension://invalid') ? null : url;
    } catch {
      return null;
    }
  }

  private renderFallbackLogoSvg(): string {
    return `
      <svg class="logo" width="18" height="18" viewBox="0 0 32 32" fill="none" aria-label="EasyTranslate">
        <rect width="32" height="32" rx="8" fill="#EC4C8C"/>
        <path d="M8 10h9M12.5 7v3M10 10c1.4 3.2 3.8 5.7 7 7.4M17 10c-.9 2.6-2.7 4.9-5.3 6.8" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20.5 22l2.2-6 2.3 6M21.4 20h2.8" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  private renderLoadingBody(): string {
    return `
      <div class="immersive-translate-loading">
        <div class="immersive-translate-loading-dot"></div>
        <div class="immersive-translate-loading-text">&#x6b63;&#x5728;&#x7ffb;&#x8bd1;...</div>
      </div>
    `;
  }

  private replacePopupBody(bodyHtml: string): void {
    const body = this.popup?.querySelector('.immersive-translate-modal-body');
    if (body) {
      body.innerHTML = bodyHtml;
    }
  }

  private bindPopupActions(): void {
    this.popup?.querySelector('.immersive-translate-close')?.addEventListener('click', () => {
      this.hidePopup();
    });
  }

  private async translateSelection(): Promise<void> {
    if (this.isTranslating) return;
    this.isTranslating = true;

    try {
      const config = await StorageManager.getConfig();

      if (!config.apiKey) {
        this.showError('Please set API Key first');
        return;
      }

      const pronunciationPromise = this.getPronunciationForSelection(this.currentText);
      const cached = await StorageManager.getCachedTranslation(this.currentText, config.targetLang);
      if (cached) {
        this.showResult(cached);
        this.renderPronunciationWhenReady(pronunciationPromise);
        return;
      }

      const api = new TranslationAPI(config);
      const result = await api.translate({
        text: this.currentText,
        targetLang: config.targetLang,
      });

      if (result.error) {
        this.showError(result.error);
      } else {
        this.showResult(result.translatedText);
        this.renderPronunciationWhenReady(pronunciationPromise);
        await StorageManager.setCachedTranslation(this.currentText, result.translatedText, config.targetLang);
      }
    } catch (error) {
      if (this.isExtensionContextInvalidated(error)) {
        this.showExtensionContextInvalidated();
      } else {
        this.showError(error instanceof Error ? error.message : 'Translation failed');
      }
    } finally {
      this.isTranslating = false;
    }
  }

  private showResult(text: string, pronunciation?: PronunciationInfo | null): void {
    if (!this.popup) return;

    this.currentTranslation = text;
    this.currentPronunciationAudio = pronunciation?.audioUrl || '';
    this.replacePopupBody(`
      <div class="translation-result-container">
        <div id="immersive-translate-original" class="immersive-translate-original-text">${this.escapeHtml(this.currentText)}</div>
        ${this.renderPronunciation(pronunciation)}
        <div id="immersive-translate-result" class="immersive-translate-result-text">${this.escapeHtml(text)}</div>
        <div class="immersive-translate-actions">
          <button id="btn-copy" class="immersive-translate-action-button" type="button">&#x590d;&#x5236;&#x8bd1;&#x6587;</button>
          <button id="btn-swap" class="immersive-translate-action-button" type="button">&#x4ea4;&#x6362;</button>
        </div>
      </div>
    `);
    this.popup.querySelector('#btn-copy')?.addEventListener('click', () => this.copyTranslation());
    this.popup.querySelector('#btn-swap')?.addEventListener('click', () => this.swapLanguages());
    this.popup.querySelector('#btn-pronunciation-audio')?.addEventListener('click', () => this.playPronunciationAudio());
  }

  private async renderPronunciationWhenReady(pronunciationPromise: Promise<PronunciationInfo | null>): Promise<void> {
    const pronunciation = await pronunciationPromise;
    if (!pronunciation || !this.popup || this.popup.style.display === 'none') return;

    const original = this.popup.querySelector('#immersive-translate-original');
    if (!original || this.popup.querySelector('.immersive-translate-pronunciation')) return;

    this.currentPronunciationAudio = pronunciation.audioUrl || '';
    original.insertAdjacentHTML('afterend', this.renderPronunciation(pronunciation));
    this.popup.querySelector('#btn-pronunciation-audio')?.addEventListener('click', () => this.playPronunciationAudio());
  }

  private renderPronunciation(pronunciation?: PronunciationInfo | null): string {
    if (!pronunciation?.phonetic) return '';

    const audioButton = pronunciation.audioUrl
      ? `<button id="btn-pronunciation-audio" class="immersive-translate-pronunciation-audio" type="button" title="Play pronunciation" aria-label="Play pronunciation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/>
            <path d="M16 8.5c1.2 1 2 2.1 2 3.5s-.8 2.6-2 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>`
      : '';

    return `
      <div class="immersive-translate-pronunciation">
        <span class="immersive-translate-pronunciation-label">&#x8bfb;&#x97f3;</span>
        <span class="immersive-translate-pronunciation-text">${this.escapeHtml(pronunciation.phonetic)}</span>
        ${audioButton}
      </div>
    `;
  }

  private async getPronunciationForSelection(text: string): Promise<PronunciationInfo | null> {
    const word = this.getSingleLatinWord(text);
    if (!word) return null;

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      if (!Array.isArray(data) || !data[0]) return null;

      return this.extractPronunciation(data[0]);
    } catch {
      return null;
    }
  }

  private getSingleLatinWord(text: string): string | null {
    const trimmed = text.trim();
    if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(trimmed)) {
      return null;
    }

    return trimmed.toLowerCase();
  }

  private extractPronunciation(entry: unknown): PronunciationInfo | null {
    if (!entry || typeof entry !== 'object') return null;

    const dictionaryEntry = entry as {
      phonetic?: unknown;
      phonetics?: Array<{ text?: unknown; audio?: unknown }>;
    };
    const phonetics = Array.isArray(dictionaryEntry.phonetics) ? dictionaryEntry.phonetics : [];
    const phonetic = this.asNonEmptyString(dictionaryEntry.phonetic)
      || this.asNonEmptyString(phonetics.find(item => this.asNonEmptyString(item.text))?.text);

    if (!phonetic) return null;

    const audioUrl = this.asNonEmptyString(phonetics.find(item => this.asNonEmptyString(item.audio))?.audio);
    return { phonetic, audioUrl: audioUrl || undefined };
  }

  private asNonEmptyString(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private playPronunciationAudio(): void {
    if (!this.currentPronunciationAudio) return;

    const audio = new Audio(this.currentPronunciationAudio);
    audio.play().catch(error => {
      console.error('Failed to play pronunciation:', error);
    });
  }

  private showError(message: string): void {
    this.replacePopupBody(`
      <div class="immersive-translate-error">
        <div class="immersive-translate-error-text">
          &#x7ffb;&#x8bd1;&#x5931;&#x8d25;&#x3002;<br /><br />&#x9519;&#x8bef;&#x539f;&#x56e0;&#xff1a;${this.escapeHtml(message)}
        </div>
      </div>
    `);
  }

  private showExtensionContextInvalidated(): void {
    this.replacePopupBody(`
      <div class="immersive-translate-error">
        <div class="immersive-translate-error-text">
          &#x6269;&#x5c55;&#x5df2;&#x91cd;&#x65b0;&#x52a0;&#x8f7d;&#x3002;<br /><br />&#x8bf7;&#x5237;&#x65b0;&#x5f53;&#x524d;&#x9875;&#x9762;&#x540e;&#x91cd;&#x8bd5;&#x3002;
        </div>
      </div>
    `);
  }

  private isExtensionContextInvalidated(error: unknown): boolean {
    return this.getErrorMessage(error).includes('Extension context invalidated');
  }

  private getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message);
    }

    return String(error);
  }

  private async copyTranslation(): Promise<void> {
    if (!this.popup) return;

    const text = this.currentTranslation || this.popup.querySelector('#immersive-translate-result')?.textContent || '';

    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        const btn = this.popup.querySelector('#btn-copy');
        if (btn) {
          const originalText = btn.textContent;
          btn.textContent = '\u5df2\u590d\u5236';
          setTimeout(() => {
            if (btn) btn.textContent = originalText;
          }, 1500);
        }
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  }

  private swapLanguages(): void {
    if (!this.popup) return;

    const originalDiv = this.popup.querySelector('#immersive-translate-original') as HTMLElement;
    const resultDiv = this.popup.querySelector('#immersive-translate-result') as HTMLElement;

    if (!originalDiv || !resultDiv) return;

    const tempOriginal = originalDiv.textContent;
    const tempResult = resultDiv.textContent;

    if (tempOriginal && tempResult) {
      originalDiv.textContent = tempResult;
      resultDiv.textContent = tempOriginal;
      this.currentTranslation = tempOriginal;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
