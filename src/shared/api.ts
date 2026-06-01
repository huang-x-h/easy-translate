import { TranslationConfig, TranslationRequest, TranslationResponse } from './types';

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
    
    const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}. 
Keep the original meaning accurate and the translation natural and fluent.
Preserve proper nouns, technical terms, and brand names in their original form.
Only return the translated text without any explanations or notes.`;

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
        }),
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const translatedText = data.choices[0]?.message?.content?.trim() || '';

      return { translatedText };
    } catch (error) {
      console.error('[EasyTranslate] translate error:', error);
      return {
        translatedText: '',
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async *translateStream(request: TranslationRequest): AsyncGenerator<string, TranslationResponse, unknown> {
    const { text, context, targetLang } = request;
    
    const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}. 
Keep the original meaning accurate and the translation natural and fluent.
Preserve proper nouns, technical terms, and brand names in their original form.
Only return the translated text without any explanations or notes.`;

    const userPrompt = context 
      ? `Context: ${context}\n\nText to translate: ${text}`
      : text;

    try {
      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
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
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let fullText = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield fullText;
              return { translatedText: fullText };
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                yield fullText;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      return { translatedText: fullText };
    } catch (error) {
      return {
        translatedText: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async translateBatch(texts: string[], targetLang: string): Promise<string[]> {
    const systemPrompt = `You are a professional translator. Translate the following texts to ${targetLang}. 
Keep the original meaning accurate and the translation natural and fluent.
Preserve proper nouns, technical terms, and brand names in their original form.
Return the translations as a JSON array in the same order as the input texts.`;

    const userPrompt = JSON.stringify(texts, null, 2);

    try {
      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
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
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '[]';
      const translations = JSON.parse(content);
      
      return Array.isArray(translations) ? translations : texts.map(() => '');
    } catch (error) {
      console.error('Batch translation error:', error);
      return texts.map(() => '');
    }
  }
}