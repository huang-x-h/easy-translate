import { TranslationConfig, TranslationRequest, TranslationResponse } from './types';
import { isChinese } from './text';
import { getProvider } from './providers';

/** How long to wait for the background service worker to answer. */
const BACKGROUND_TIMEOUT_MS = 30_000;

export class TranslationAPI {
  private config: TranslationConfig;

  constructor(config: TranslationConfig) {
    this.config = config;
  }

  /**
   * Translate `request`, routing the actual network call through the
   * background service worker when we are running in a content script.
   *
   * Why the detour? Chrome attributes content-script fetches to the
   * *host page's* origin. Most LLM APIs (Zhipu/OpenAI-compatible ones)
   * don't echo `Access-Control-Allow-Origin` for arbitrary origins, so
   * the preflight fails and the request dies with a bare
   * "TypeError: Failed to fetch" — the real cause (bad key, quota,
   * unsupported parameter) is never surfaced. Extension service workers
   * and extension pages, on the other hand, hold host permissions and
   * are exempt from that check.
   *
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
   */
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (this.canDelegateToBackground()) {
      return this.translateViaBackground(request);
    }
    return this.translateDirect(request);
  }

  /**
   * Perform the HTTP call inline. Called by the background service
   * worker (which must not delegate, or we'd recurse) and by the
   * fallback path when messaging is unavailable.
   */
  async translateDirect(request: TranslationRequest): Promise<TranslationResponse> {
    const { text, context, targetLang } = request;

    // 修复 endpoint URL，确保正确拼接
    const baseUrl = this.config.apiEndpoint.replace(/\/+$/, '');
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    // 我们让模型同步返回译文 + 源文本的 IPA 音标。一次拿两个数据点，
    // 省掉前端再调 dictionaryapi.dev 的覆盖度问题（很多词查不到）。
    //
    // Prompt 根据方向动态生成：英→中模式侧重意译；中→英模式侧重
    // 自然地道的英文（Twitter/Reddit 等口语场景）。
    //
    // 但并非所有引擎都能这么做：专用翻译模型（如 Index-Translate）
    // 只会输出译文，既不认 JSON 输出指令也不会生成音标。对这类引擎
    // 我们改用官方推荐的「纯翻译」提示语，并让前端另找音标来源。
    const provider = getProvider(this.config.providerId);
    const sourceIsChinese = isChinese(text);
    const systemPrompt = provider.jsonOutput
      ? (sourceIsChinese
        ? `You are a professional translator writing for casual online conversation (Twitter, Reddit, Discord).

Translate the input text from Chinese (or other source language) into natural, idiomatic ${targetLang}. Match the casual register — contractions, common slang, and emoji are fine. Keep proper nouns, brand names, and code snippets verbatim. Never leave the translation empty.

Return a JSON object with EXACTLY these two fields:

1. "translation": the natural ${targetLang} translation of the input text. Write it as if a native speaker were replying to the original message in a chat thread.

2. "pronunciation": always return an empty string "" for non-word inputs.

Rules:
- Output ONLY the JSON object. No markdown fences, no commentary.
- Keep the translation concise — chat replies should be punchy.`
        : `You are a professional translator.

Return a JSON object with exactly these two fields:

1. "translation": the translation of the input text into ${targetLang}. Keep it natural and fluent, preserve proper nouns and brand names. Never leave it empty.

2. "pronunciation": the IPA phonetic transcription of the SOURCE text wrapped in slashes (e.g. "/əˈpærəntli/"). Use the source text's ORIGINAL language (e.g. Pinyin for Chinese, IPA for English). Provide this ONLY when the source is a single word or a hyphenated/apostrophized word (e.g. "self-esteem", "don't"). For phrases, sentences, or anything that is not a single word, return an empty string.

Rules:
- Output ONLY the JSON object. No markdown fences, no commentary.
- "pronunciation" must start with "/" and end with "/" when non-empty.
- Do not invent phonetics for non-word input.`)
      : buildPlainTranslatePrompt(sourceIsChinese, targetLang, text);

    const userPrompt = context
      ? `Context: ${context}\n\nText to translate: ${text}`
      : text;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    };

    // Only ask for structured output when the engine both understands the
    // instruction and the endpoint accepts the parameter.
    if (provider.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (provider.extraBody) {
      Object.assign(body, provider.extraBody);
    }

    try {
      console.log('[EasyTranslate] Fetching from:', endpoint);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new ApiError(response.status, errorBody);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content?.trim() || '';
      const parsed = parseTranslationResponse(rawContent);

      return parsed;
    } catch (error) {
      console.error('[EasyTranslate] translate error:', error);
      return {
        translatedText: '',
        error: describeError(error, endpoint),
      };
    }
  }

  /**
   * True when we should hand the request to the background service
   * worker instead of hitting the network ourselves.
   *
   * Service workers have no `window`, so the check doubles as "am I the
   * background?" — which prevents infinite delegation.
   */
  private canDelegateToBackground(): boolean {
    if (typeof window === 'undefined') return false;
    return typeof chrome !== 'undefined'
      && !!chrome.runtime
      && typeof chrome.runtime.sendMessage === 'function';
  }

  private translateViaBackground(request: TranslationRequest): Promise<TranslationResponse> {
    return new Promise((resolve) => {
      // Guard against a background that never replies (service worker
      // asleep, message dropped). Without this the popup would spin on
      // "translating..." forever.
      let settled = false;
      const finish = (response: TranslationResponse) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(response);
      };

      const timer = window.setTimeout(() => {
        finish({
          translatedText: '',
          error: '后台翻译服务超时（30 秒无响应）。请重试，或检查扩展是否被禁用。',
        });
      }, BACKGROUND_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage({ type: 'TRANSLATE', request }, (response: any) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            finish({
              translatedText: '',
              error: `后台翻译服务调用失败：${lastError.message}`,
            });
            return;
          }
          if (!response) {
            finish({ translatedText: '', error: '后台翻译服务无响应' });
            return;
          }
          if (response.success === false) {
            finish({
              translatedText: '',
              error: response.error || '后台翻译服务返回错误',
            });
            return;
          }
          finish({
            translatedText: response.translatedText ?? '',
            pronunciation: response.pronunciation,
            error: response.error,
          });
        });
      } catch (error) {
        finish({
          translatedText: '',
          error: describeError(error, this.buildEndpoint()),
        });
      }
    });
  }

  private buildEndpoint(): string {
    const baseUrl = this.config.apiEndpoint.replace(/\/+$/, '');
    return baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;
  }
}

/**
 * An HTTP-level failure. Carries the status + body so we can translate
 * them into an actionable message for the user.
 */
class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`API error: ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * Turns a thrown error into a message the user can act on. A bare
 * "Failed to fetch" tells them nothing — this is where we explain what
 * actually went wrong.
 */
function describeError(error: unknown, endpoint: string): string {
  if (error instanceof ApiError) {
    return describeHttpError(error.status, error.body);
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/failed to fetch|networkerror|err_failed|load failed/i.test(message)) {
    return `无法连接到 ${endpoint}。请检查：① API Endpoint 是否正确且可访问；② 网络或代理是否拦截；③ API Key 是否有效。`;
  }

  return message;
}

function describeHttpError(status: number, body: string): string {
  const detail = body.trim().slice(0, 300);
  const suffix = detail ? ` 服务端返回：${detail}` : '';

  switch (status) {
    case 400:
      return `请求参数不被服务端接受（HTTP 400）。当前模型可能不支持所选参数。${suffix}`;
    case 401:
    case 403:
      return `API Key 无效或无权访问（HTTP ${status}）。请检查设置中的 API Key。${suffix}`;
    case 404:
      return `接口地址不存在（HTTP 404）。请检查 API Endpoint 是否填全。${suffix}`;
    case 429:
      return `请求过于频繁或额度已用尽（HTTP 429）。请稍后重试或检查账户余额。${suffix}`;
    default:
      if (status >= 500) {
        return `服务端错误（HTTP ${status}），请稍后重试。${suffix}`;
      }
      return `API 请求失败（HTTP ${status}）。${suffix}`;
  }
}

/**
 * Prompt for engines that only emit a plain translation (dedicated
 * translation models). The wording mirrors Bilibili's own reference
 * script so the model behaves the way it was tuned to.
 */
function buildPlainTranslatePrompt(sourceIsChinese: boolean, targetLang: string, text: string): string {
  const style = sourceIsChinese
    ? `Translate the input text from Chinese (or other source language) into natural, idiomatic ${targetLang}. Match the casual register — contractions, common slang, and emoji are fine. Keep proper nouns, brand names, and code snippets verbatim.`
    : `Translate the input text into ${targetLang}. Keep it natural and fluent, preserve proper nouns and brand names.`;

  return `You are a professional translator.

${style}

Translate the following text into ${targetLang}. Output ONLY the translated text — no explanations, no notes, no quotes, no JSON, no reasoning.

Text to translate:
${text}`;
}

/**
 * Parses the model's JSON output and extracts translation + pronunciation.
 * Falls back gracefully when the model wraps the JSON in a markdown fence
 * or emits a plain-text translation without the structured fields.
 */
function parseTranslationResponse(raw: string): TranslationResponse {
  if (!raw) {
    return { translatedText: '' };
  }

  // Try direct parse first.
  const direct = tryJsonParse(raw);
  if (direct) {
    return extractFields(direct);
  }

  // Strip markdown code fences (```json ... ``` or ``` ... ```) and retry.
  const stripped = stripCodeFence(raw);
  if (stripped !== raw) {
    const fromFence = tryJsonParse(stripped);
    if (fromFence) {
      return extractFields(fromFence);
    }
  }

  // Last resort: treat the raw text as a plain translation (older models
  // or stripped responses that didn't follow the JSON contract).
  return {
    translatedText: stripCodeFence(raw).trim(),
  };
}

function tryJsonParse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Pulls out the JSON object embedded in a markdown fence. Matches the
 * first ```json (or just ```) block and returns its inner text. Returns
 * the original string unchanged when no fence is present.
 */
function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text;
}

function extractFields(obj: Record<string, unknown>): TranslationResponse {
  const translation = typeof obj.translation === 'string' ? obj.translation.trim() : '';
  const rawPronunciation = typeof obj.pronunciation === 'string' ? obj.pronunciation.trim() : '';
  const pronunciation = looksLikeIpa(rawPronunciation) ? rawPronunciation : undefined;
  return {
    translatedText: translation,
    pronunciation,
  };
}

/**
 * Validates that a value is a non-empty IPA wrapped in slashes (or wrapped
 * in IPA brackets `[...]`). Anything else is dropped so the UI doesn't
 * surface garbage like free-form translations shoved into the wrong field.
 */
function looksLikeIpa(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/') && value.endsWith('/') && value.length > 2) return true;
  if (value.startsWith('[') && value.endsWith(']') && value.length > 2) return true;
  return false;
}