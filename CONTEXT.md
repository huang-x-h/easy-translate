# Context

## Glossary

### Core Concepts

| Term | Definition | Notes |
|------|------------|-------|
| **Selection Translation** | User selects text on a page, extension shows translation in a floating popup | Triggered by text selection, non-intrusive |
| **Bilingual Translation** | Translates entire page and displays original + translated text side-by-side | Uses paragraph-by-paragraph layout |
| **Vocabulary Book (生词本)** | User-saved entries of selection translations, viewable and exportable from the options page | Per-target-language dedup keyed on normalized original text |
| **Daily Review (每日复习)** | Flashcard session over today's saved entries with self-rated recall (unknown/fuzzy/known) | Tracked via `lastReviewedAt` and `reviewCount` on each entry; audio auto-plays on each new card |
| **Pronunciation Enrichment** | Fallback lookup against dictionaryapi.dev to backfill a phonetic/audio when the engine can't supply one | Fires from the popup for any single-word selection; only used when the engine returned no IPA |
| **Phonetic Text** | The IPA string shown next to the original word | Two sources, in priority order: (1) the translation engine, when it is a general LLM; (2) dictionaryapi.dev, for English tokens only |
| **Pronunciation Audio** | The sound played by the speaker button | Two sources: a recorded mp3 from dictionaryapi.dev, else the system TTS via `chrome.tts` — engine-independent, so it always works |
| **Content Script** | JavaScript injected into web pages to read/modify DOM | Isolated from page scripts via Shadow DOM |
| **Service Worker** | Background script in Manifest V3, handles API calls and storage | Event-driven, not persistent |
| **Readability** | Algorithm to extract main article content from web pages | Based on Mozilla's Readability library |

### Translation Service

| Term | Definition | Notes |
|------|------------|-------|
| **OpenAI-Compatible API** | API following OpenAI's /v1/chat/completions format | Supported by Zhipu, OpenRouter, Ollama, etc. |
| **Translation Engine (Provider)** | The configured backend + its declared capabilities | `zhipu` (general LLM), `index-translate` (dedicated translation model), `custom` |
| **Engine Capability** | What a provider can do: JSON output, IPA generation, response_format support | Declared in `src/shared/providers.ts`; the request builder reads it instead of hard-coding checks |
| **Index-Translate** | Bilibili's open-source translation model family, served as a free OpenAI-compatible public API | `https://index-translate.bilibili.com/v1`, model `Index-Translate-35B-A3B`, key not validated; vLLM-backed so thinking must be disabled |
| **Streaming Response** | Server sends partial translation results progressively | Better UX for real-time feedback |
| **Batch Translation** | Sending multiple paragraphs for parallel translation | Efficient for full-page translation |
| **Translation Cache** | Local storage of translated text keyed by content hash | Reduces API calls, 7-day TTL |
| **Vocabulary Entry** | Saved selection with original, translation, pronunciation, audio, source URL, notes | Keyed by `vocab_<hash(original + targetLang)>`; one index array tracks ids |
| **Today's Entries** | Subset of vocabulary entries where `createdAt >= today 0:00 local` | Powers the daily review queue; re-computed on each options page open |
| **Pronunciation Lookup** | dictionaryapi.dev `/v2/entries/en/<word>` returns phonetic + optional audio URL | Skipped for non-English text or entries that already have pronunciation |

### UI Components

| Term | Definition | Notes |
|------|------------|-------|
| **Floating Button** | Button appearing near selected text to trigger translation | Non-intrusive, user-initiated |
| **Translation Popup** | Overlay showing translation result for selected text | Auto-positions to avoid screen edges |
| **Bilingual Paragraph** | DOM element containing both original and translated paragraph | Styled distinctly from original content |
| **Shadow DOM** | Encapsulated DOM tree isolating extension styles from host page | Prevents CSS conflicts |

### Configuration

| Term | Definition | Notes |
|------|------------|-------|
| **API Endpoint** | Base URL for translation service | Default: Groq API |
| **API Key** | Authentication token for translation service | Stored in chrome.storage.sync |
| **Target Language** | Language to translate content into | Default: zh-CN (Chinese Simplified) |
| **Model** | Specific LLM used for translation | Default: llama-3.1-8b-instant |

## Domain Boundaries

### What This Extension Does
- Translates web page content using open-source LLMs
- Provides selection-based and full-page translation
- Works only in Chromium-based browsers (Chrome, Edge)
- Requires user-provided API key for translation services

### What This Extension Does NOT Do
- Machine translation without external API (always uses LLM service)
- PDF translation (web pages only)
- Real-time chat translation (not a chat extension)
- Image OCR translation (text content only)
- Cloud sync of vocabulary (stored locally only; export to JSON/CSV for portability)

## Related Systems

| System | Relationship | Integration Point |
|--------|--------------|-------------------|
| **Groq API** | Primary translation backend | /v1/chat/completions endpoint |
| **OpenRouter** | Alternative backend | Same OpenAI-compatible format |
| **Ollama** | Local LLM option | Local API endpoint |
| **Readability.js** | Content extraction | Mozilla's library |
| **Chrome Storage** | Configuration persistence | chrome.storage.sync / local |

## Architectural Decisions

1. **Manifest V3** - Required for Chrome Web Store new extensions
2. **Chromium Only** - Simplifies development, covers 80%+ users
3. **OpenAI-Compatible API** - Maximizes service compatibility
4. **TypeScript + Shadow DOM** - Type safety + style isolation
5. **Streaming for selection, Batch for page** - UX vs efficiency trade-off
6. **Readability for content extraction** - Battle-tested, accurate
