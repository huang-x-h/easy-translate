/**
 * Translation engine registry.
 *
 * Not every translation backend can do the same things. A general-purpose
 * LLM can be asked to return an IPA phonetic alongside the translation;
 * a purpose-built translation model cannot. Rather than hard-coding
 * engine checks in the request builder, each engine declares its
 * capabilities here and the rest of the code reads them off the spec.
 */

import { ProviderId } from './types';

export interface ProviderSpec {
  id: ProviderId;
  /** Display name shown in the options page. */
  name: string;
  /** Short note shown under the name. */
  description: string;
  /** Default API base URL. */
  endpoint: string;
  /** Default model id. */
  model: string;
  /** Default API key. */
  apiKey: string;
  /**
   * Ask the model for `{ translation, pronunciation }` JSON instead of
   * plain text. Only general-purpose LLMs can be prompted this way.
   */
  jsonOutput: boolean;
  /**
   * Whether the model can produce IPA phonetics. Purpose-built
   * translation models are trained to emit a translation only.
   */
  askPhonetic: boolean;
  /**
   * Whether the endpoint honours OpenAI's `response_format:
   * { type: 'json_object' }`. Some servers reject it outright.
   */
  jsonMode: boolean;
  /**
   * Extra top-level fields merged into every request body. vLLM-backed
   * servers use `chat_template_kwargs.enable_thinking` to suppress the
   * reasoning preamble, which otherwise eats the whole token budget.
   */
  extraBody?: Record<string, unknown>;
  /**
   * The upstream CDN rejects requests whose `Origin` header carries a
   * browser-extension scheme (`chrome-extension://`, `moz-extension://`)
   * with HTTP 412 + a bot-challenge page. The service's own docs tell
   * browser extensions to route calls through a local proxy, which sends
   * no `Origin` at all — so we strip the header on our own requests via
   * declarativeNetRequest instead of shipping a proxy.
   */
  stripOriginHeader?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  zhipu: {
    id: 'zhipu',
    name: '智谱 AI',
    description: '国内大模型，中文优化好',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    apiKey: '',
    jsonOutput: true,
    askPhonetic: true,
    jsonMode: true,
  },
  'index-translate': {
    id: 'index-translate',
    name: '哔哩哔哩 Index-Translate',
    description: '免费公网 API · 150 语言 · 无需密钥',
    endpoint: 'https://index-translate.bilibili.com/v1',
    model: 'Index-Translate-35B-A3B',
    // The public API does not validate the key; any non-empty value works.
    apiKey: 'EMPTY',
    // A dedicated translation model: it emits a translation and nothing
    // else. Asking for JSON or IPA would only produce garbage.
    jsonOutput: false,
    askPhonetic: false,
    jsonMode: false,
    // vLLM servers run the model with "thinking" enabled by default,
    // which prepends a long reasoning block to the answer.
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    // The CDN in front of this API 412s any request carrying a
    // chrome-extension:// Origin.
    stripOriginHeader: true,
  },
  custom: {
    id: 'custom',
    name: '自定义',
    description: '使用自己的 API 服务',
    endpoint: '',
    model: '',
    apiKey: '',
    jsonOutput: true,
    askPhonetic: true,
    jsonMode: true,
  },
};

/** The spec for a given engine id, falling back to the generic one. */
export function getProvider(id: ProviderId | undefined): ProviderSpec {
  if (id && id in PROVIDERS) return PROVIDERS[id];
  return PROVIDERS.custom;
}
