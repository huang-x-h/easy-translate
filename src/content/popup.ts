import { TranslationAPI } from '../shared/api';
import { StorageManager } from '../shared/storage';

export class SelectionPopup {
  private floatingButton: HTMLElement | null = null;
  private popup: HTMLElement | null = null;
  private currentText: string = '';
  private currentTranslation: string = '';
  private isTranslating: boolean = false;
  private selectionRect: DOMRect | null = null;

  constructor() {
    this.createFloatingButton();
    this.createPopup();
  }

  private createFloatingButton(): void {
    this.floatingButton = document.createElement('div');
    this.floatingButton.className = 'immersive-translate-floating-button';
    this.floatingButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 8l6 6"/>
        <path d="M4 14l6-6 2-3"/>
        <path d="M2 5h12"/>
        <path d="M7 2h1"/>
        <path d="M22 22l-5-10-5 10"/>
        <path d="M14 18h6"/>
      </svg>
    `;
    this.floatingButton.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #222222 0%, #696969 100%);
      color: #ffc736;
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
    this.selectionRect = rect;
    this.hidePopup();

    const buttonX = rect.right + 8;
    const buttonY = rect.top;
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
    const popupWidth = Math.min(420, window.innerWidth - 24);
    const popupHeight = 260;
    let popupX = rect.right + 12;
    let popupY = rect.top;

    if (popupX + popupWidth > window.innerWidth - 12) {
      popupX = rect.left - popupWidth - 12;
    }

    if (popupY + popupHeight > window.innerHeight - 12) {
      popupY = window.innerHeight - popupHeight - 12;
    }

    this.popup.style.left = `${Math.max(12, popupX)}px`;
    this.popup.style.top = `${Math.max(12, popupY)}px`;
    this.popup.style.transform = 'translate(0px, 0px)';
  }

  private renderPopupShell(bodyHtml: string): string {
    return `
      <div class="immersive-translate-modal-title imt-notranslate" style="cursor: move;">
        <div class="immersive-translate-modal-title-left">
          ${this.renderLogoSvg()}
          <span class="immersive-translate-title-text">EasyTranslate</span>
        </div>
        <div class="immersive-translate-modal-title-right">
          <div class="immersive-translate-service-select">
            <div class="service-select-content">
              <span class="service-icon" aria-hidden="true"></span>
              <div class="select-service-name">&#x7ffb;&#x8bd1;&#x670d;&#x52a1;</div>
            </div>
          </div>
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

  private renderLogoSvg(): string {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" class="logo" width="18" height="18" viewBox="0 0 1024 1024" fill="none">
        <path d="M0 160C0 71.6344 71.6344 0 160 0H864C952.366 0 1024 71.6344 1024 160V864C1024 952.366 952.366 1024 864 1024H160C71.6344 1024 0 952.366 0 864V160Z" fill="#EC4C8C"/>
        <path d="M512.274 210.03V252.664C512.274 261.501 519.438 268.664 528.274 268.664H670.954C707.914 268.664 737.877 298.622 737.877 335.577V396.785C737.877 405.622 745.04 412.785 753.877 412.785H796.521C805.357 412.785 812.521 405.622 812.521 396.785V335.577C812.521 257.403 749.139 194.03 670.954 194.03H528.274C519.438 194.03 512.274 201.194 512.274 210.03Z" fill="white"/>
        <path d="M185.035 705.453V586.819C185.035 577.982 192.199 570.819 201.035 570.819H243.68C252.516 570.819 259.68 577.982 259.68 586.819V705.453C259.68 742.408 289.642 772.366 326.602 772.366H421.282C430.118 772.366 437.282 779.529 437.282 788.366V831C437.282 839.837 430.118 847 421.282 847H326.602C248.417 847 185.035 783.627 185.035 705.453Z" fill="white"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M854.394 847C865.706 847 873.446 835.581 869.256 825.074L725.006 463.315C722.58 457.232 716.693 453.242 710.144 453.242H657.19C650.641 453.242 644.753 457.232 642.328 463.315L498.077 825.074C493.887 835.581 501.627 847 512.939 847H558.148C564.763 847 570.696 842.929 573.077 836.758L605.871 751.726C608.251 745.554 614.184 741.483 620.799 741.483H746.534C753.149 741.483 759.082 745.554 761.462 751.726L794.257 836.758C796.637 842.929 802.57 847 809.185 847H854.394ZM717.068 666.849C722.685 666.849 726.553 661.212 724.532 655.971L691.131 569.366C688.497 562.538 678.836 562.538 676.203 569.366L642.802 655.971C640.78 661.212 644.648 666.849 650.266 666.849H717.068Z" fill="white"/>
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

    this.currentTranslation = text;
    this.replacePopupBody(`
      <div class="translation-result-container">
        <div id="immersive-translate-original" class="immersive-translate-original-text">${this.escapeHtml(this.currentText)}</div>
        <div id="immersive-translate-result" class="immersive-translate-result-text">${this.escapeHtml(text)}</div>
        <div class="immersive-translate-actions">
          <button id="btn-copy" class="immersive-translate-action-button" type="button">&#x590d;&#x5236;&#x8bd1;&#x6587;</button>
          <button id="btn-swap" class="immersive-translate-action-button" type="button">&#x4ea4;&#x6362;</button>
        </div>
      </div>
    `);
    this.popup.querySelector('#btn-copy')?.addEventListener('click', () => this.copyTranslation());
    this.popup.querySelector('#btn-swap')?.addEventListener('click', () => this.swapLanguages());
  }

  private showError(message: string): void {
    this.replacePopupBody(`
      <div class="immersive-translate-error">
        <div class="immersive-translate-error-text">
          &#x7ffb;&#x8bd1;&#x5931;&#x8d25;&#x3002;<br><br>&#x9519;&#x8bef;&#x539f;&#x56e0;&#xff1a;${this.escapeHtml(message)}
        </div>
      </div>
    `);
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
