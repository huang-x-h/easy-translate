# EasyTranslate Privacy Policy

**Effective Date:** 2025-06-04

## 1. What Data We Collect

EasyTranslate **does not collect, store, or transmit any personal information** to our own servers.

The only data stored by the extension is:

| Data | Purpose | Storage Location | Duration |
|------|---------|------------------|----------|
| API Key (user-provided) | Authenticate with translation services | Browser local storage (`chrome.storage.local`) | Until user clears it |
| Translation settings | Language preference, model selection | Browser local storage (`chrome.storage.local`) | Until user clears it |
| Translation cache | Avoid redundant API calls for repeated text | Browser local storage (`chrome.storage.local`) | 7 days, then auto-deleted |

## 2. Third-Party Services

When you use EasyTranslate, your selected text is sent to the **translation API endpoint you configure** (e.g., Groq, OpenRouter, Ollama, or any custom OpenAI-compatible service).

- We do **not** control these third-party APIs.
- Please review the privacy policy of your chosen provider.
- All API requests are made **directly from your browser** to the provider; we do not proxy or intercept them.

## 3. Data Sharing

We do **not** sell, share, or transfer your data to any third parties, except:
- Sending text to the translation API endpoint **you explicitly configure**.

## 4. Local Storage

All configuration and cache data is stored **locally on your device** using the browser's `chrome.storage.local` API. This data:
- Never leaves your device (except to the translation API you choose).
- Is not synced to Google accounts or cloud services.
- Can be cleared at any time by uninstalling the extension or clearing site data for the extension.

## 5. Permissions

The extension requests the following permissions solely for its core functionality:

- **`storage`**: Save your settings and translation cache locally.
- **`activeTab`**: Read the current page content for translation.
- **`scripting`**: Inject the translation UI into web pages.
- **`<all_urls>`**: Allow translation on any website you visit.

## 6. Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/huangxinghui/easy-translate/issues

## 7. Changes

We may update this privacy policy as the extension evolves. Any changes will be reflected in the GitHub repository.
