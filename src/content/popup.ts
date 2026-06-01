import { TranslationAPI } from '../shared/api';
import { StorageManager } from '../shared/storage';

export class SelectionPopup {
  private floatingButton: HTMLElement | null = null;
  private popup: HTMLElement | null = null;
  private currentText: string = '';
  private isTranslating: boolean = false;
  private selectionRect: DOMRect | null = null;
  private buttonHost: HTMLElement | null = null;
  private popupHost: HTMLElement | null = null;

  constructor() {
    this.createFloatingButton();
    this.createPopup();
  }

  private createFloatingButton(): void {
    this.floatingButton = document.createElement('div');
    this.floatingButton.className = 'immersive-translate-floating-button';
    // Use logo.png as icon
    const iconUrl = chrome.runtime.getURL('icons/logo.png');
    this.floatingButton.innerHTML = `<img src="${iconUrl}" alt="Translate" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />`;
    this.floatingButton.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #4f46e5;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s, box-shadow 0.2s;
      pointer-events: auto;
      opacity: 0;
      visibility: hidden;
    `;

    this.floatingButton.addEventListener('mouseenter', () => {
      if (this.floatingButton) {
        this.floatingButton.style.transform = 'scale(1.1)';
        this.floatingButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
      }
    });

    this.floatingButton.addEventListener('mouseleave', () => {
      if (this.floatingButton) {
        this.floatingButton.style.transform = 'scale(1)';
        this.floatingButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }
    });

    this.floatingButton.addEventListener('click', () => {
      this.showPopup();
    });

    this.injectToPage(this.floatingButton, 'buttonHost');
  }

  private createPopup(): void {
    this.popup = document.createElement('div');
    this.popup.className = 'immersive-translate-popup';
    this.popup.style.cssText = `
      position: fixed;
      z-index: 2147483646;
      min-width: 280px;
      max-width: 320px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    `;

    this.injectToPage(this.popup, 'popupHost');

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.popup || !this.popupHost) return;
      const shadowRoot = this.popupHost.shadowRoot;
      if (!shadowRoot) return;
      if (!shadowRoot.contains(e.target as Node)) {
        this.hidePopup();
      }
    });
  }

  private injectToPage(element: HTMLElement, saveAs: 'buttonHost' | 'popupHost'): void {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; pointer-events: none;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(element);
    
    if (saveAs === 'buttonHost') {
      this.buttonHost = host;
    } else {
      this.popupHost = host;
    }
  }

  public showButton(rect: DOMRect, text: string): void {
    if (!this.floatingButton || !this.buttonHost) return;

    this.currentText = text;
    this.selectionRect = rect;

    const buttonX = rect.right + 8;
    const buttonY = rect.top;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const finalX = Math.min(buttonX, viewportWidth - 40);
    const finalY = Math.min(buttonY, viewportHeight - 40);

    this.buttonHost.style.zIndex = '2147483647';
    this.buttonHost.style.left = `${finalX}px`;
    this.buttonHost.style.top = `${finalY}px`;
    this.floatingButton.style.opacity = '1';
    this.floatingButton.style.visibility = 'visible';
    this.floatingButton.style.pointerEvents = 'auto';
  }

  public hideButton(): void {
    if (!this.floatingButton) return;
    this.floatingButton.style.opacity = '0';
    this.floatingButton.style.visibility = 'hidden';
    this.floatingButton.style.pointerEvents = 'none';
  }

  private async showPopup(): Promise<void> {
    if (!this.popup || !this.selectionRect || !this.popupHost) return;

    const rect = this.selectionRect;
    const popupWidth = 320;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let popupX = rect.right + 12;
    let popupY = rect.top;

    if (popupX + popupWidth > viewportWidth - 16) {
      popupX = rect.left - popupWidth - 12;
    }
    
    if (popupY + 200 > viewportHeight) {
      popupY = viewportHeight - 220;
    }

    this.popupHost.style.zIndex = '2147483646';
    this.popupHost.style.left = `${popupX}px`;
    this.popupHost.style.top = `${popupY}px`;

    this.popup.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-weight: 600; color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Original</div>
        <div style="padding: 12px; background: #f9fafb; border-radius: 8px; color: #4b5563; font-size: 13px; line-height: 1.5; max-height: 120px; overflow-y: auto;">${this.escapeHtml(this.currentText)}</div>
        <div style="font-weight: 600; color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Translation</div>
        <div id="immersive-translate-result" style="padding: 12px; background: #eff6ff; border-radius: 8px; color: #1e40af; font-size: 13px; line-height: 1.5; min-height: 40px;">
          <div style="display: flex; align-items: center; gap: 8px; color: #6b7280;">
            <span style="width: 16px; height: 16px; border: 2px solid #d1d5db; border-top-color: #4f46e5; border-radius: 50%; animation: spin 1s linear infinite;"></span>
            Translating...
          </div>
        </div>
      </div>
    `;

    this.popup.style.opacity = '1';
    this.popup.style.visibility = 'visible';
    this.popup.style.pointerEvents = 'auto';

    await this.translateSelection();
  }

  public hidePopup(): void {
    if (!this.popup) return;
    this.popup.style.opacity = '0';
    this.popup.style.visibility = 'hidden';
    this.popup.style.pointerEvents = 'none';
    this.isTranslating = false;
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

      const cached = await StorageManager.getCachedTranslation(this.currentText, config.targetLang);
      if (cached) {
        this.showResult(cached);
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
        await StorageManager.setCachedTranslation(this.currentText, result.translatedText, config.targetLang);
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Translation failed');
    } finally {
      this.isTranslating = false;
    }
  }

  private showResult(text: string): void {
    if (!this.popup) return;
    
    const shadowRoot = this.popup.parentNode as ShadowRoot | null;
    if (!shadowRoot) return;
    
    const resultDiv = shadowRoot.querySelector('#immersive-translate-result');
    if (resultDiv) {
      resultDiv.textContent = text;
    }
  }

  private showError(message: string): void {
    if (!this.popup) return;
    
    const shadowRoot = this.popup.parentNode as ShadowRoot | null;
    if (!shadowRoot) return;
    
    const resultElement = shadowRoot.querySelector('#immersive-translate-result');
    if (resultElement) {
      resultElement.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; color: #dc2626;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>${this.escapeHtml(message)}</span>
        </div>
      `;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}