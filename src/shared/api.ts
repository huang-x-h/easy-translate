import { TranslationConfig, TranslationRequest, TranslationResponse } from './types';
import { isChinese } from './text';

export class TranslationAPI {
  private config: TranslationConfig;

  constructor(config: TranslationConfig) {
    this.config = config;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
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
    const sourceIsChinese = isChinese(text);
    const systemPrompt = sourceIsChinese
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
- Do not invent phonetics for non-word input.`;

    const userPrompt = context
      ? `Context: ${context}\n\nText to translate: ${text}`
      : text;

    try {
      console.log('[EasyTranslate] Fetching from:', endpoint);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0]?.message?.content?.trim() || '';
      const parsed = parseTranslationResponse(rawContent);

      return parsed;
    } catch (error) {
      console.error('[EasyTranslate] translate error:', error);
      return {
        translatedText: '',
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }
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