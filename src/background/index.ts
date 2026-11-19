// Background Service Worker (Manifest V3)

import { StorageManager } from '../shared/storage';
import { TranslationAPI } from '../shared/api';
import { DEFAULT_CONFIG } from '../shared/types';
import { installOriginStripRules } from '../shared/dnr';

class BackgroundService {
  constructor() {
    this.init();
  }

  private init(): void {
    // Install extension on install
    chrome.runtime.onInstalled.addListener(this.handleInstall.bind(this));

    // The service worker can be torn down and revived at any time, so
    // make sure the header-rewriting rules are in place on every start
    // (dynamic rules survive restarts, but this also covers upgrades).
    void installOriginStripRules(chrome.runtime.id);

    // Listen for messages from content scripts and popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse).catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
      return true;
    });

    // Handle keyboard shortcuts
    chrome.commands.onCommand.addListener(this.handleCommand.bind(this));

    // Handle extension icon click
    chrome.action.onClicked.addListener(this.handleActionClick.bind(this));
  }

  private async handleInstall(details: chrome.runtime.InstalledDetails): Promise<void> {
    // Install the DNR rules that strip the Origin header for engines
    // whose CDN rejects browser-extension origins.
    await installOriginStripRules(chrome.runtime.id);

    if (details.reason === 'install') {
      // Set default configuration
      await StorageManager.setConfig(DEFAULT_CONFIG);
      
      // Open options page on first install
      chrome.runtime.openOptionsPage();
      
      console.log('Immersive Translate extension installed');
    }
  }

  private async handleMessage(
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): Promise<void> {
    switch (message.type) {
      case 'GET_CONFIG':
        const config = await StorageManager.getConfig();
        sendResponse({ config });
        break;

      case 'SET_CONFIG':
        await StorageManager.setConfig(message.config);
        sendResponse({ success: true });
        break;

      case 'TRANSLATE': {
        // Content scripts can't call the LLM API directly: Chrome
        // attributes their fetches to the host page's origin, so the
        // API's preflight rejects them ("Failed to fetch"). The service
        // worker holds host permissions and is exempt, so we do the
        // actual request here and hand the parsed result back.
        const translateConfig = await StorageManager.getConfig();
        const translateApi = new TranslationAPI(translateConfig);
        const result = await translateApi.translateDirect(message.request);
        sendResponse(result);
        break;
      }

      case 'TRANSLATE_TAB':
        await this.translateCurrentTab();
        sendResponse({ success: true });
        break;

      case 'RESET_TAB':
        await this.resetCurrentTab();
        sendResponse({ success: true });
        break;

      case 'GET_TAB_STATUS':
        const status = await this.getTabStatus();
        sendResponse(status);
        break;

      case 'CLEAR_CACHE':
        await StorageManager.clearCache();
        sendResponse({ success: true });
        break;

      case 'SPEAK':
        // TTS request from a content script / popup / options page.
        // We delegate to chrome.tts — a Chrome extension API backed by
        // the OS speech engine (SAPI 5 on Windows, Google TTS on macOS,
        // speech-dispatcher on Linux). This bypasses the window.speechSynthesis
        // API, which is broken in Chrome 130+ (silent speak() with no callbacks).
        chrome.tts.stop();
        chrome.tts.speak(
          message.text,
          {
            lang: message.lang ?? 'en-US',
            rate: message.rate ?? 1.0,
            enqueue: false,
          },
          () => {
            if (chrome.runtime.lastError) {
              console.warn('[EasyTranslate] chrome.tts error:', chrome.runtime.lastError.message);
            }
          },
        );
        sendResponse({ success: true });
        break;
    }
  }

  private handleCommand(command: string, _tab: chrome.tabs.Tab): void {
    if (command === 'translate-page') {
      this.translateCurrentTab();
    }
  }

  private async handleActionClick(_tab: chrome.tabs.Tab): Promise<void> {
    // Toggle translation state
    const status = await this.getTabStatus();
    
    if (status.isTranslated) {
      await this.resetCurrentTab();
    } else {
      await this.translateCurrentTab();
    }
  }

  private async translateCurrentTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE' });
    } catch (error) {
      // Content script might not be loaded, inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      
      // Try again after injection
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'TRANSLATE_PAGE' });
        } catch (e) {
          console.error('Failed to translate tab:', e);
        }
      }, 100);
    }
  }

  private async resetCurrentTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESET_PAGE' });
    } catch (error) {
      console.error('Failed to reset tab:', error);
    }
  }

  private async getTabStatus(): Promise<{ isTranslated: boolean; isTranslating: boolean }> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { isTranslated: false, isTranslating: false };
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
      return response || { isTranslated: false, isTranslating: false };
    } catch {
      return { isTranslated: false, isTranslating: false };
    }
  }
}

// Initialize background service
new BackgroundService();
