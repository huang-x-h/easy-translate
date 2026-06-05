/**
 * Regression test for Twitter/X DOM paragraph extraction.
 * Reproduces the issue where translate-extension reports
 * "页面没有可翻译的内容" on x.com because tweet text lives in
 * div[data-testid="tweetText"] and div was classified as a container.
 */
import { JSDOM } from 'jsdom';

const html = `
<!DOCTYPE html>
<html lang="en">
<head><title>X</title></head>
<body>
  <main role="main">
    <div data-testid="primaryColumn">
      <section>
        <article data-testid="tweet">
          <div role="link">
            <div data-testid="User-Name">
              <a href="/badlogicgames">
                <span>Mario Zechner</span>
                <span>@badlogicgames</span>
              </a>
            </div>
            <div data-testid="tweetText" lang="en">
              <span>After 14 years of working on libGDX, I've decided to step down as the lead maintainer. It's been an incredible journey building this game framework with all of you.</span>
            </div>
            <div data-testid="tweetPhoto">
              <img alt="Screenshot of code" src="...">
            </div>
          </div>
        </article>
        <article data-testid="tweet">
          <div data-testid="tweetText" lang="en">
            <span>I'm excited to see what the community does next. The project is in good hands with the new core team.</span>
          </div>
        </article>
      </section>
    </div>
  </main>
</body>
</html>
`;

const dom = new JSDOM(html, { runScripts: 'outside-only' });
const document = dom.window.document;
global.document = document;
global.window = dom.window;
global.NodeFilter = dom.window.NodeFilter;

// Import the actual source module logic (mirrored in Node via jsdom)
// Since the TS module imports Readability and browser APIs, we mirror
// the relevant parts here to keep the test deterministic and fast.
const leafTags = ['p', 'li', 'td', 'th', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt'];
const containerTags = ['section', 'article', 'div', 'main', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr'];
const ignoredSubtreeTags = ['aside', 'nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio', 'form', 'button', 'input', 'select', 'textarea'];
const leafContentSelectors = [
  '[data-testid="tweetText"]',
  '[data-testid="postText"]',
  '.tweet-text',
  '.post-text',
];

function isHiddenElement(element) {
  return false;
}

function isLeafContent(element) {
  const tagName = element.tagName.toLowerCase();
  if (leafTags.includes(tagName)) return true;
  for (const selector of leafContentSelectors) {
    if (element.matches(selector)) return true;
  }
  if (tagName === 'div') {
    const hasBlockChildren = Array.from(element.children).some((child) => {
      const childTag = child.tagName.toLowerCase();
      return containerTags.includes(childTag) || leafTags.includes(childTag);
    });
    if (hasBlockChildren) return false;
    const text = (element.textContent || '').trim();
    return text.length >= 20;
  }
  return false;
}

function getCleanText(element) {
  const clone = element.cloneNode(true);
  const elementsToRemove = clone.querySelectorAll('script, style, noscript, iframe, svg, canvas, video, audio, img, button, input, select, textarea, nav, header, footer, aside, a, code, pre');
  elementsToRemove.forEach(el => el.remove());
  let text = clone.textContent || '';
  text = text.replace(/\s+/g, ' ').replace(/\n+/g, '\n').replace(/^\s+|\s+$/g, '').trim();
  return text;
}

function extractParagraphs(rootElement) {
  const paragraphs = [];
  const seenTexts = new Set();

  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const element = node;
        const tagName = element.tagName.toLowerCase();
        if (
          ignoredSubtreeTags.includes(tagName) ||
          element.closest('.immersive-translate-floating-button, .immersive-translate-modal, .immersive-translate-bilingual, #immersive-translate-progress, #immersive-translate-notification') ||
          isHiddenElement(element)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        if (containerTags.includes(tagName) && !isLeafContent(element)) {
          return NodeFilter.FILTER_SKIP;
        }
        if (!isLeafContent(element)) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node = walker.nextNode();
  let index = 0;
  while (node) {
    const text = getCleanText(node);
    if (text.length >= 20 && !seenTexts.has(text)) {
      seenTexts.add(text);
      paragraphs.push({ element: node, text, index: index++ });
    }
    node = walker.nextNode();
  }

  return paragraphs;
}

// Run assertions
const root = document.body;
const paragraphs = extractParagraphs(root);

console.log('Extracted paragraphs:', paragraphs.length);
paragraphs.forEach((p, i) => {
  const testid = p.element.getAttribute('data-testid');
  console.log(`[${i}] ${p.element.tagName}${testid ? `[data-testid=${testid}]` : ''}: "${p.text.substring(0, 80)}..."`);
});

if (paragraphs.length < 2) {
  console.error('FAIL: Expected at least 2 tweet paragraphs');
  process.exit(1);
}

if (!paragraphs.every(p => p.element.matches('[data-testid="tweetText"]'))) {
  console.error('FAIL: All paragraphs should come from tweetText divs');
  process.exit(1);
}

console.log('PASS: Twitter/X DOM paragraphs extracted correctly');
