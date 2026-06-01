import { StorageManager } from '../shared/storage';
import { TranslationConfig, DEFAULT_CONFIG } from '../shared/types';
import { TranslationAPI } from '../shared/api';

document.addEventListener('DOMContentLoaded', async () => {
  const apiEndpointInput = document.getElementById('apiEndpoint') as HTMLInputElement;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  const modelInput = document.getElementById('model') as HTMLInputElement;
  const targetLangSelect = document.getElementById('targetLang') as HTMLSelectElement;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
  const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
  const clearCacheBtn = document.getElementById('clearCacheBtn') as HTMLButtonElement;
  const alertDiv = document.getElementById('alert') as HTMLDivElement;
  const testResult = document.getElementById('testResult') as HTMLDivElement;
  const serviceCards = document.querySelectorAll('.service-card');

  let currentService = 'zhipu';

  // Load current configuration
  async function loadConfig() {
    const config = await StorageManager.getConfig();
    apiEndpointInput.value = config.apiEndpoint;
    apiKeyInput.value = config.apiKey;
    modelInput.value = config.model;
    targetLangSelect.value = config.targetLang;
    updateServiceCards();
  }

  function updateServiceCards() {
    serviceCards.forEach((card: Element) => {
      const htmlCard = card as HTMLElement;
      const isActive = htmlCard.dataset.service === currentService;
      htmlCard.classList.toggle('active', isActive);
    });
  }

  // Service card selection
  serviceCards.forEach(card => {
    card.addEventListener('click', () => {
      currentService = (card as HTMLElement).dataset.service || 'custom';
      updateServiceCards();
      
      if (currentService === 'zhipu') {
        apiEndpointInput.value = 'https://open.bigmodel.cn/api/paas/v4';
        modelInput.value = 'glm-4-flash';
      }
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const config: TranslationConfig = {
      apiEndpoint: apiEndpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim() || 'glm-4-flash',
      targetLang: 'zh-CN',
      translationStyle: 'natural',
    };

    if (!config.apiKey) {
      showTestResult('请输入 API Key', 'error');
      return;
    }

    showTestResult('正在测试连接...', 'loading');
    testBtn.disabled = true;

    try {
      const api = new TranslationAPI(config);
      const result = await api.translate({
        text: 'Hello World',
        targetLang: 'zh-CN',
      });

      if (result.error) {
        showTestResult('连接失败: ' + result.error, 'error');
      } else if (result.translatedText) {
        showTestResult('连接成功! 翻译结果: ' + result.translatedText, 'success');
      } else {
        showTestResult('连接失败: 未知错误', 'error');
      }
    } catch (error) {
      showTestResult('连接失败: ' + (error instanceof Error ? error.message : '网络错误'), 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  function showTestResult(message: string, type: 'success' | 'error' | 'loading') {
    testResult.textContent = message;
    testResult.className = 'test-result ' + type;
    testResult.style.display = 'block';
  }

  // Save configuration
  saveBtn.addEventListener('click', async () => {
    const config: TranslationConfig = {
      apiEndpoint: apiEndpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      targetLang: targetLangSelect.value,
      translationStyle: 'natural',
    };

    try {
      await StorageManager.setConfig(config);
      showAlert('设置已保存', 'success');
    } catch (error) {
      showAlert('保存失败: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
    }
  });

  // Reset to defaults
  resetBtn.addEventListener('click', async () => {
    if (confirm('确定要恢复默认设置吗？')) {
      await StorageManager.setConfig(DEFAULT_CONFIG);
      await loadConfig();
      showAlert('已恢复默认设置', 'success');
    }
  });

  // Clear cache
  clearCacheBtn.addEventListener('click', async () => {
    if (confirm('确定要清除翻译缓存吗？')) {
      await StorageManager.clearCache();
      showAlert('缓存已清除', 'success');
    }
  });

  function showAlert(message: string, type: 'success' | 'error') {
    alertDiv.textContent = message;
    alertDiv.className = 'alert alert-' + type;
    alertDiv.style.display = 'block';
    
    setTimeout(() => {
      alertDiv.style.display = 'none';
    }, 3000);
  }

  // Initialize
  await loadConfig();
});
