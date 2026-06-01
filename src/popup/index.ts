import { StorageManager } from '../shared/storage';

document.addEventListener('DOMContentLoaded', async () => {
  // Set logo URL using chrome.runtime.getURL for proper extension path
  const logoImg = document.getElementById('logo-img') as HTMLImageElement;
  if (logoImg) {
    logoImg.src = chrome.runtime.getURL('icons/logo.png');
  }
  
  const translateBtn = document.getElementById('translateBtn') as HTMLButtonElement;
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  const optionsBtn = document.getElementById('optionsBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const statusDot = statusEl.querySelector('.status-dot') as HTMLElement;
  const statusText = statusEl.querySelector('.status-text') as HTMLElement;

  // Check configuration
  const config = await StorageManager.getConfig();
  
  if (config.apiKey) {
    statusDot.classList.remove('warning');
    statusText.textContent = '已配置 API';
    translateBtn.disabled = false;
  } else {
    statusText.textContent = '请配置 API Key';
    translateBtn.disabled = true;
  }

  // Get current tab status
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
      if (response?.isTranslated) {
        resetBtn.disabled = false;
      }
    } catch {
      // Content script not loaded or no response
    }
  }

  // Translate button
  translateBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    translateBtn.disabled = true;
    translateBtn.textContent = '翻译中...';

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE' });
      window.close();
    } catch {
      // Inject content script if not loaded
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'TRANSLATE_PAGE' });
        } catch (e) {
          console.error('Failed to translate:', e);
          translateBtn.textContent = '翻译失败';
          setTimeout(() => {
            translateBtn.textContent = '🔄 翻译当前页面';
            translateBtn.disabled = false;
          }, 2000);
        }
      }, 100);
    }
  });

  // Reset button
  resetBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESET_PAGE' });
      window.close();
    } catch (e) {
      console.error('Failed to reset:', e);
    }
  });

  // Options button
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
});
