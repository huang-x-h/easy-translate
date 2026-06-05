/**
 * Integration test: simulates the first half of BilingualTranslator.translatePage()
 * on a Twitter/X DOM to ensure both root-element selection and paragraph
 * extraction find multiple tweets.
 */
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const html = `
<!DOCTYPE html>
<html lang="en">
<head><title>Mario Zechner on X</title></head>
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

const dom = new JSDOM(html, { url: 'https://x.com/badlogicgames/status/12345' });
const document = dom.window.document;
global.document = document;
global.window = dom.window;
global.NodeFilter = dom.window.NodeFilter;

// ---- Mirror updated readability.ts ----
const leafTags = ['p', 'li', 'td', 'th', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt'];
const containerTags = ['section', 'article', 'div', 'main', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr'];
const ignoredSubtreeTags = ['aside', 'nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio', 'form', 'button', 'input', 'select', 'textarea'];
const leafContentSelectors = [
  '[data-testid="tweetText"]',
  '[data-testid="postText"]',
  '.tweet-text',
  '.post-text',
];

function isHiddenElement(element) { return false; }

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
  clone.querySelectorAll('script, style, noscript, iframe, svg, canvas, video, audio, img, button, input, select, textarea, nav, header, footer, aside, a, code, pre')
    .forEach(el => el.remove());
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
        ) return NodeFilter.FILTER_REJECT;
        if (containerTags.includes(tagName) && !isLeafContent(element)) return NodeFilter.FILTER_SKIP;
        if (!isLeafContent(element)) return NodeFilter.FILTER_SKIP;
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

// ---- Mirror updated bilingual.ts findContentElement ----
function getWords(text) {
  return text.toLowerCase().replace(/[^a-zA-Z\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function calculateOverlap(text1, text2) {
  const words1 = new Set(getWords(text1));
  const words2 = new Set(getWords(text2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let matches = 0;
  for (const word of words2) if (words1.has(word)) matches++;
  return matches / words2.size;
}

function findContentElement(textContent) {
  const selectors = [
    'article', '[role="main"]', 'main', '.post-content', '.entry-content', '.content',
    '.article-content', '.article-body', '.post', '.article', '.story-body',
    '.markdown-body', '#content', '#main', '.main-content',
  ];
  const candidates = [];
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of Array.from(elements)) {
      const overlap = calculateOverlap(element.textContent || '', textContent);
      if (overlap > 0.3) candidates.push({ element, overlap });
    }
  }
  if (candidates.length === 0) return document.body;
  candidates.sort((a, b) => {
    if (Math.abs(b.overlap - a.overlap) > 0.05) return b.overlap - a.overlap;
    return (a.element.textContent?.length || 0) - (b.element.textContent?.length || 0);
  });
  return candidates[0].element;
}

// ---- Simulate translatePage() flow ----
const reader = new Readability(document.cloneNode(true), { charThreshold: 100 });
const article = reader.parse();
if (!article || !article.textContent || article.textContent.length < 100) {
  console.error('FAIL: Readability did not extract meaningful text');
  process.exit(1);
}

const rootElement = findContentElement(article.textContent);
console.log('Selected root element:', rootElement.tagName, rootElement.getAttribute?.('data-testid') || rootElement.className || '');

const paragraphs = extractParagraphs(rootElement);
console.log('Extracted paragraphs:', paragraphs.length);
paragraphs.forEach((p, i) => {
  console.log(`[${i}] ${p.element.tagName}[data-testid=${p.element.getAttribute('data-testid')}] "${p.text.substring(0, 60)}..."`);
});

if (paragraphs.length < 2) {
  console.error('FAIL: Expected at least 2 tweet paragraphs');
  process.exit(1);
}

if (rootElement.tagName.toLowerCase() !== 'main') {
  console.error('FAIL: Expected root element to be <main> for Twitter/X feed');
  process.exit(1);
}

console.log('PASS: Twitter/X integration test');
