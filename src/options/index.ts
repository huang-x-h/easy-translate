import { StorageManager } from '../shared/storage';
import { TranslationConfig, DEFAULT_CONFIG, VocabularyEntry, ReviewRating } from '../shared/types';
import { TranslationAPI } from '../shared/api';
import { VocabularyManager, BackfillResult } from '../shared/vocabulary';
import { playPronunciation } from '../shared/speech';

/**
 * Scrolls the vocabulary card into view and pulses a short highlight.
 * Called when the page is loaded with `#vocabulary` in the URL (e.g. via
 * the popup's "生词本" button) and on subsequent `hashchange` events.
 */
function scrollToVocabularyCard(): void {
  const card = document.getElementById('vocabularyCard');
  if (!card) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('vocab-card-highlight');
  // Force reflow so removing + re-adding the class restarts the animation.
  void card.offsetWidth;
  card.classList.add('vocab-card-highlight');
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash === '#vocabulary') {
    // Wait one frame so layout settles before scrolling.
    window.requestAnimationFrame(scrollToVocabularyCard);
  }
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#vocabulary') {
      scrollToVocabularyCard();
    }
  });
});

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
  void initVocabularyManager();
});

async function initVocabularyManager(): Promise<void> {
  const searchInput = document.getElementById('vocabSearch') as HTMLInputElement;
  const listEl = document.getElementById('vocabList') as HTMLElement;
  const emptyEl = document.getElementById('vocabEmpty') as HTMLElement;
  const summaryEl = document.getElementById('vocabSummary') as HTMLElement;
  const exportJsonBtn = document.getElementById('vocabExportJsonBtn') as HTMLButtonElement;
  const exportCsvBtn = document.getElementById('vocabExportCsvBtn') as HTMLButtonElement;
  const clearAllBtn = document.getElementById('vocabClearAllBtn') as HTMLButtonElement;

  // Daily review elements
  const reviewBanner = document.getElementById('vocabReviewBanner') as HTMLElement;
  const reviewTodayCountEl = document.getElementById('vocabTodayCount') as HTMLElement;
  const reviewStartBtn = document.getElementById('vocabStartReviewBtn') as HTMLButtonElement;
  const reviewPanel = document.getElementById('vocabReviewPanel') as HTMLElement;
  const reviewBackBtn = document.getElementById('vocabReviewBackBtn') as HTMLButtonElement;
  const reviewProgressText = document.getElementById('vocabReviewProgressText') as HTMLElement;
  const reviewProgressFill = document.getElementById('vocabReviewProgressFill') as HTMLElement;
  const reviewOriginalEl = document.getElementById('vocabReviewOriginal') as HTMLElement;
  const reviewAudioBtn = document.getElementById('vocabReviewAudioBtn') as HTMLButtonElement;
  const reviewRevealBtn = document.getElementById('vocabReviewRevealBtn') as HTMLButtonElement;
  const reviewAnswerEl = document.getElementById('vocabReviewAnswer') as HTMLElement;
  const reviewTranslationEl = document.getElementById('vocabReviewTranslation') as HTMLElement;
  const reviewPronunciationEl = document.getElementById('vocabReviewPronunciation') as HTMLElement;
  const reviewSourceEl = document.getElementById('vocabReviewSource') as HTMLElement;
  const reviewRatingButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.vocab-review-rating'),
  );
  const reviewSummaryEl = document.getElementById('vocabReviewSummary') as HTMLElement;
  const reviewSummaryTotalEl = document.getElementById('vocabReviewSummaryTotal') as HTMLElement;
  const reviewSummaryKnownEl = document.getElementById('vocabReviewSummaryKnown') as HTMLElement;
  const reviewSummaryFuzzyEl = document.getElementById('vocabReviewSummaryFuzzy') as HTMLElement;
  const reviewSummaryUnknownEl = document.getElementById('vocabReviewSummaryUnknown') as HTMLElement;
  const reviewAgainBtn = document.getElementById('vocabReviewAgainBtn') as HTMLButtonElement;
  const reviewDoneBtn = document.getElementById('vocabReviewDoneBtn') as HTMLButtonElement;

  // Pronunciation backfill elements
  const backfillBanner = document.getElementById('vocabBackfillBanner') as HTMLElement;
  const backfillCountEl = document.getElementById('vocabBackfillCount') as HTMLElement;
  const backfillBtn = document.getElementById('vocabBackfillBtn') as HTMLButtonElement;
  const backfillProgress = document.getElementById('vocabBackfillProgress') as HTMLElement;
  const backfillProgressFill = document.getElementById('vocabBackfillProgressFill') as HTMLElement;
  const backfillProgressText = document.getElementById('vocabBackfillProgressText') as HTMLElement;
  const backfillCancelBtn = document.getElementById('vocabBackfillCancelBtn') as HTMLButtonElement;
  const backfillResult = document.getElementById('vocabBackfillResult') as HTMLElement;

  if (!searchInput || !listEl || !emptyEl || !summaryEl) return;

  let allEntries: VocabularyEntry[] = [];
  let todayEntries: VocabularyEntry[] = [];

  interface ReviewSession {
    queue: VocabularyEntry[];
    index: number;
    ratings: ReviewRating[];
  }
  let reviewSession: ReviewSession | null = null;

  function render(entries: VocabularyEntry[]): void {
    listEl.innerHTML = '';
    const filtered = applyFilter(entries, searchInput.value);
    emptyEl.classList.toggle('vocab-hidden', filtered.length > 0);

    if (filtered.length === 0) {
      summaryEl.textContent = entries.length === 0
        ? '\u8fd8\u6ca1\u6709\u4fdd\u5b58\u7684\u8bcd\u6761'
        : '\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u8bcd\u6761';
    } else {
      const total = entries.length;
      const shown = filtered.length;
      summaryEl.textContent = total === shown
        ? `\u5171 ${total} \u4e2a\u8bcd\u6761`
        : `\u5171 ${total} \u4e2a\u8bcd\u6761\uff0c\u5339\u914d ${shown} \u6761`;
    }

    const hasEntries = entries.length > 0;
    exportJsonBtn.disabled = !hasEntries;
    exportCsvBtn.disabled = !hasEntries;
    clearAllBtn.disabled = !hasEntries;

    for (const entry of filtered) {
      listEl.appendChild(renderItem(entry));
    }
  }

  function renderItem(entry: VocabularyEntry): HTMLElement {
    const item = document.createElement('div');
    item.className = 'vocab-item';
    item.setAttribute('role', 'listitem');
    item.dataset.id = entry.id;

    const body = document.createElement('div');
    body.className = 'vocab-item-body';

    const original = document.createElement('div');
    original.className = 'vocab-item-original';
    original.textContent = entry.originalText;
    body.appendChild(original);

    const translation = document.createElement('div');
    translation.className = 'vocab-item-translation';
    translation.textContent = entry.translation;
    body.appendChild(translation);

    if (entry.pronunciation || entry.audioUrl) {
      const pronunciation = document.createElement('div');
      pronunciation.className = 'vocab-item-pronunciation';
      if (entry.pronunciation) {
        const text = document.createElement('span');
        text.textContent = entry.pronunciation;
        pronunciation.appendChild(text);
      }
      // The horn shows whenever a phonetic (or a recording) exists; the
      // click falls back to TTS when there is no recorded audioUrl.
      if (entry.pronunciation || entry.audioUrl) {
        const audioBtn = document.createElement('button');
        audioBtn.type = 'button';
        audioBtn.className = 'vocab-item-pronunciation-audio';
        audioBtn.title = '\u64ad\u653e\u53d1\u97f3';
        audioBtn.setAttribute('aria-label', 'Play pronunciation');
        audioBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5c1.2 1 2 2.1 2 3.5s-.8 2.6-2 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        audioBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          playPronunciation({
            audioUrl: entry.audioUrl,
            word: entry.originalText,
            button: audioBtn,
          });
        });
        pronunciation.appendChild(audioBtn);
      }
      body.appendChild(pronunciation);
    }

    const meta = document.createElement('div');
    meta.className = 'vocab-item-meta';
    if (entry.sourceUrl) {
      const source = document.createElement('span');
      source.className = 'vocab-item-source';
      const link = document.createElement('a');
      link.href = entry.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = entry.sourceTitle ? `${entry.sourceTitle}\n${entry.sourceUrl}` : entry.sourceUrl;
      link.textContent = entry.sourceTitle || entry.sourceUrl;
      source.appendChild(link);
      meta.appendChild(source);
    }
    const time = document.createElement('span');
    time.textContent = formatRelativeTime(entry.updatedAt);
    time.title = new Date(entry.updatedAt).toLocaleString();
    meta.appendChild(time);
    body.appendChild(meta);

    if (entry.notes) {
      const notes = document.createElement('div');
      notes.className = 'vocab-item-notes';
      notes.textContent = entry.notes;
      body.appendChild(notes);
    }

    const actions = document.createElement('div');
    actions.className = 'vocab-item-actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'vocab-item-delete';
    deleteBtn.textContent = '\u5220\u9664';
    deleteBtn.addEventListener('click', async () => {
      const originalText = entry.originalText.length > 24
        ? entry.originalText.slice(0, 24) + '\u2026'
        : entry.originalText;
      if (!confirm(`\u5220\u9664\u8bcd\u6761 "${originalText}" \u5417\uff1f`)) {
        return;
      }
      await VocabularyManager.removeEntry(entry.id);
      await refresh();
    });
    actions.appendChild(deleteBtn);

    item.appendChild(body);
    item.appendChild(actions);
    return item;
  }

  function applyFilter(entries: VocabularyEntry[], query: string): VocabularyEntry[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return entries;
    return entries.filter((entry) => {
      return (
        entry.originalText.toLowerCase().includes(trimmed) ||
        entry.translation.toLowerCase().includes(trimmed) ||
        (entry.notes || '').toLowerCase().includes(trimmed)
      );
    });
  }

  async function refresh(): Promise<void> {
    allEntries = await VocabularyManager.getAllEntries();
    todayEntries = await VocabularyManager.getTodayEntries();
    render(allEntries);
    renderReviewBanner();
    renderBackfillBanner();
  }

  function renderReviewBanner(): void {
    const count = todayEntries.length;
    reviewTodayCountEl.textContent = String(count);
    reviewBanner.hidden = count === 0;
  }

  function renderBackfillBanner(): void {
    const missingCount = allEntries.filter(e => !e.pronunciation).length;
    backfillCountEl.textContent = String(missingCount);
    // Keep the banner up while a run's result message is still showing so
    // the user can read it; otherwise show it only when entries are
    // missing a phonetic.
    backfillBanner.hidden = missingCount === 0 && backfillResult.hidden;
  }

  // -------------------------------------------------------------------------
  // Pronunciation backfill — walks every entry without a phonetic and asks
  // the LLM to fill one in. Serial, cancellable, with live progress.
  // -------------------------------------------------------------------------
  let backfillAbort: AbortController | null = null;

  backfillBtn.addEventListener('click', () => {
    void startBackfill();
  });
  backfillCancelBtn.addEventListener('click', () => {
    backfillAbort?.abort();
  });

  async function startBackfill(): Promise<void> {
    const config = await StorageManager.getConfig();
    if (!config.apiKey) {
      showBackfillResult('需要先配置 API Key 才能调用 LLM。', 'info');
      return;
    }

    backfillAbort = new AbortController();
    backfillResult.hidden = true;
    backfillProgress.hidden = false;
    backfillBtn.disabled = true;
    backfillCancelBtn.disabled = false;
    backfillProgressText.textContent = '0 / 0';
    backfillProgressFill.style.width = '0%';

    const api = new TranslationAPI(config);
    let result: BackfillResult;
    try {
      result = await VocabularyManager.backfillMissingPronunciations(
        async (text, targetLang) => api.translate({ text, targetLang }),
        {
          signal: backfillAbort.signal,
          onProgress: (done, total) => {
            const pct = total === 0 ? 0 : (done / total) * 100;
            backfillProgressFill.style.width = `${pct}%`;
            backfillProgressText.textContent = `${done} / ${total}`;
          },
        },
      );
    } catch (error) {
      console.error('[EasyTranslate] backfill error:', error);
      showBackfillResult(
        error instanceof Error ? error.message : '补全失败，请重试。',
        'error',
      );
      backfillProgress.hidden = true;
      backfillBtn.disabled = false;
      backfillAbort = null;
      return;
    }

    backfillProgress.hidden = true;
    backfillBtn.disabled = false;
    backfillAbort = null;

    const parts: string[] = [];
    if (result.updated > 0) parts.push(`补全 ${result.updated} 条`);
    if (result.skipped > 0) parts.push(`${result.skipped} 条不是单词`);
    if (result.failed > 0) parts.push(`${result.failed} 条调用失败`);
    const prefix = result.cancelled ? '已取消：' : '完成：';
    showBackfillResult(
      parts.length > 0 ? prefix + parts.join('，') : '没有需要补全的词条。',
      result.cancelled ? 'info' : (result.failed > 0 ? 'info' : 'success'),
    );

    // Refresh entries so the count + list reflect the new phonetics.
    await refresh();
  }

  function showBackfillResult(message: string, tone: 'success' | 'info' | 'error'): void {
    backfillResult.textContent = message;
    backfillResult.dataset.tone = tone;
    backfillResult.hidden = false;
  }

  function showListView(): void {
    reviewPanel.hidden = true;
    reviewSummaryEl.hidden = true;
    reviewBanner.hidden = todayEntries.length === 0;
  }

  function startReview(): void {
    if (todayEntries.length === 0) return;
    reviewSession = {
      queue: todayEntries.slice(),
      index: 0,
      ratings: [],
    };
    reviewPanel.hidden = false;
    reviewSummaryEl.hidden = true;
    reviewBanner.hidden = true;
    loadCurrentReviewCard();
  }

  function loadCurrentReviewCard(): void {
    if (!reviewSession) return;
    const entry = reviewSession.queue[reviewSession.index];
    if (!entry) {
      showReviewSummary();
      return;
    }
    reviewOriginalEl.textContent = entry.originalText;
    reviewTranslationEl.textContent = entry.translation;

    // Independent audio button next to the original word \u2014 visible
    // whenever we can pronounce (phonetic or recording), even before
    // "Show answer" is clicked. Clicking falls back to TTS when there
    // is no recorded audioUrl.
    if (entry.audioUrl || entry.pronunciation) {
      reviewAudioBtn.hidden = false;
      reviewAudioBtn.dataset.word = entry.originalText;
      if (entry.audioUrl) reviewAudioBtn.dataset.audioUrl = entry.audioUrl;
      else reviewAudioBtn.removeAttribute('data-audio-url');
    } else {
      reviewAudioBtn.hidden = true;
      reviewAudioBtn.removeAttribute('data-audio-url');
    }

    // Pronunciation (phonetic) shown inside the answer area
    reviewPronunciationEl.innerHTML = '';
    if (entry.pronunciation) {
      const text = document.createElement('span');
      text.textContent = entry.pronunciation;
      reviewPronunciationEl.appendChild(text);
    }
    // Horn in the answer area mirrors the one by the original word:
    // shown whenever we can pronounce, with TTS fallback on click.
    if (entry.pronunciation || entry.audioUrl) {
      const audioBtn = document.createElement('button');
      audioBtn.type = 'button';
      audioBtn.className = 'vocab-item-pronunciation-audio';
      audioBtn.title = '\u64ad\u653e\u53d1\u97f3';
      audioBtn.setAttribute('aria-label', 'Play pronunciation');
      audioBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5c1.2 1 2 2.1 2 3.5s-.8 2.6-2 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      audioBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        playPronunciation({
          audioUrl: entry.audioUrl,
          word: entry.originalText,
          button: audioBtn,
        });
      });
      reviewPronunciationEl.appendChild(audioBtn);
    }

    // Source
    reviewSourceEl.innerHTML = '';
    if (entry.sourceUrl) {
      const link = document.createElement('a');
      link.href = entry.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.sourceTitle || entry.sourceUrl;
      reviewSourceEl.appendChild(link);
    }

    reviewAnswerEl.hidden = true;
    reviewRevealBtn.hidden = false;

    const total = reviewSession.queue.length;
    const current = reviewSession.index + 1;
    reviewProgressText.textContent = `${current} / ${total}`;
    const percentage = total === 0 ? 0 : (reviewSession.index / total) * 100;
    reviewProgressFill.style.width = `${percentage}%`;

    // Auto-play pronunciation when a new card loads so the user can recall
    // from sound first, then check the translation. Uses the recorded
    // audio when available, otherwise TTS — so every pronounceable card
    // makes a sound, not just the ones with a dict recording.
    if (entry.audioUrl || entry.pronunciation) {
      window.setTimeout(() => {
        // Guard against the user having navigated away mid-flight.
        if (reviewSession && reviewSession.queue[reviewSession.index] === entry) {
          playPronunciation({
            audioUrl: entry.audioUrl,
            word: entry.originalText,
            button: reviewAudioBtn,
          });
        }
      }, 350);
    }
  }

  function revealAnswer(): void {
    reviewAnswerEl.hidden = false;
    reviewRevealBtn.hidden = true;
  }

  async function rateCurrent(rating: ReviewRating): Promise<void> {
    if (!reviewSession) return;
    const entry = reviewSession.queue[reviewSession.index];
    if (!entry) return;

    reviewSession.ratings.push(rating);
    try {
      await VocabularyManager.markReviewed(entry.id);
    } catch (error) {
      console.error('[EasyTranslate] failed to mark entry as reviewed:', error);
    }
    reviewSession.index += 1;
    if (reviewSession.index >= reviewSession.queue.length) {
      showReviewSummary();
    } else {
      loadCurrentReviewCard();
    }
  }

  function showReviewSummary(): void {
    if (!reviewSession) return;
    const ratings = reviewSession.ratings;
    const known = ratings.filter((r) => r === 'known').length;
    const fuzzy = ratings.filter((r) => r === 'fuzzy').length;
    const unknown = ratings.filter((r) => r === 'unknown').length;

    reviewSummaryTotalEl.textContent = String(ratings.length);
    reviewSummaryKnownEl.textContent = String(known);
    reviewSummaryFuzzyEl.textContent = String(fuzzy);
    reviewSummaryUnknownEl.textContent = String(unknown);

    reviewProgressFill.style.width = '100%';
    reviewPanel.hidden = true;
    reviewSummaryEl.hidden = false;
  }

  async function exitReview(): Promise<void> {
    reviewSession = null;
    showListView();
    await refresh();
  }

  function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '\u521a\u521a';
    if (diff < hour) return `${Math.floor(diff / minute)} \u5206\u949f\u524d`;
    if (diff < day) return `${Math.floor(diff / hour)} \u5c0f\u65f6\u524d`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} \u5929\u524d`;
    return new Date(timestamp).toLocaleDateString();
  }

  function download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  searchInput.addEventListener('input', () => render(allEntries));
  exportJsonBtn.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    download(
      `easy-translate-vocabulary-${new Date().toISOString().slice(0, 10)}.json`,
      VocabularyManager.exportAsJson(allEntries),
      'application/json',
    );
  });
  exportCsvBtn.addEventListener('click', () => {
    if (allEntries.length === 0) return;
    download(
      `easy-translate-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`,
      VocabularyManager.exportAsCsv(allEntries),
      'text/csv;charset=utf-8',
    );
  });
  clearAllBtn.addEventListener('click', async () => {
    if (allEntries.length === 0) return;
    if (!confirm(`\u786e\u5b9a\u8981\u6e05\u7a7a\u6240\u6709 ${allEntries.length} \u4e2a\u8bcd\u6761\u5417\uff1f`)) {
      return;
    }
    await VocabularyManager.clearAll();
    await refresh();
  });

  // ----- Daily review event wiring -----
  reviewStartBtn.addEventListener('click', () => startReview());
  reviewBackBtn.addEventListener('click', () => {
    void exitReview();
  });
  reviewRevealBtn.addEventListener('click', () => revealAnswer());
  reviewAudioBtn.addEventListener('click', () => {
    playPronunciation({
      audioUrl: reviewAudioBtn.dataset.audioUrl || undefined,
      word: reviewAudioBtn.dataset.word || '',
      button: reviewAudioBtn,
    });
  });
  for (const btn of reviewRatingButtons) {
    const rating = btn.dataset.rating as ReviewRating | undefined;
    if (!rating) continue;
    btn.addEventListener('click', () => {
      void rateCurrent(rating);
    });
  }
  reviewAgainBtn.addEventListener('click', () => startReview());
  reviewDoneBtn.addEventListener('click', () => {
    void exitReview();
  });

  await refresh();
}
