import './styles.css';
import { SelectionPopup } from './popup';
import { BilingualTranslator } from './bilingual';

class ContentScript {
  private selectionPopup: SelectionPopup;
  private bilingualTranslator: BilingualTranslator;

  constructor() {
    this.selectionPopup = new SelectionPopup();
    this.bilingualTranslator = new BilingualTranslator();
    this.init();
  }

  private init(): void {
    // Listen for selection changes (mouseup event)
    document.addEventListener('mouseup', this.handleTextSelection.bind(this));
    
    // Listen for messages from background/popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse).catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
      return true;
    });
    
    // Listen for keyboard shortcuts
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private handleTextSelection(_event: MouseEvent): void {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length > 0) {
      // Show floating button near selection
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (rect) {
        this.selectionPopup.showButton(rect, selectedText);
      }
    } else {
      // Hide button if no selection
      this.selectionPopup.hideButton();
    }
  }

  private async handleMessage(
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    switch (message.type) {
      case 'TRANSLATE_PAGE':
        await this.bilingualTranslator.translatePage();
        sendResponse({ success: true });
        break;
      
      case 'RESET_PAGE':
        this.bilingualTranslator.resetPage();
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse({ 
          isTranslated: this.bilingualTranslator.isTranslatedState(),
          isTranslating: this.bilingualTranslator.isTranslatingState(),
        });
        break;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Alt+T to translate page
    if (event.altKey && event.key === 't') {
      event.preventDefault();
      this.bilingualTranslator.translatePage();
    }
    
    // Escape to cancel translation or close popup
    if (event.key === 'Escape') {
      if (this.bilingualTranslator.isTranslatingState()) {
        // Cancel ongoing translation
        this.bilingualTranslator.cancelTranslation();
      }
      // Close popup
      this.selectionPopup.hidePopup();
      this.selectionPopup.hideButton();
    }
  }
}

// Initialize content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ContentScript());
} else {
  new ContentScript();
}
