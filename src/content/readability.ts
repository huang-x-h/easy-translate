// Mozilla Readability integration for content extraction
// https://github.com/mozilla/readability

import { Readability } from '@mozilla/readability';

export interface ArticleData {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
}

export interface ParagraphInfo {
  element: HTMLElement;
  text: string;
  index: number;
}

/**
 * Extract article content using Mozilla Readability
 * This is the main entry point for article extraction
 */
export function extractArticle(): ArticleData | null {
  try {
    // Clone the document to avoid modifying the original
    const documentClone = document.cloneNode(true) as Document;
    
    // Use Mozilla Readability to extract article
    const reader = new Readability(documentClone, {
      debug: false,
      maxElemsToParse: 0,
      nbTopCandidates: 5,
      charThreshold: 500,
      classesToPreserve: ['immersive-translate-bilingual'],
      keepClasses: false,
    });

    const article = reader.parse();
    
    if (!article) {
      console.warn('[Immersive Translate] Readability could not parse article');
      return null;
    }

    return {
      title: article.title || document.title,
      content: article.content,
      textContent: article.textContent,
      length: article.length,
      excerpt: article.excerpt || article.textContent.slice(0, 200) + '...',
      byline: article.byline || '',
      dir: article.dir || 'ltr',
      siteName: article.siteName || '',
      lang: document.documentElement.lang || 'en',
    };
  } catch (error) {
    console.error('[Immersive Translate] Readability extraction failed:', error);
    return null;
  }
}

// Platform-specific selectors that mark divs as leaf content containers
const leafContentSelectors = [
  '[data-testid="tweetText"]',
  '[data-testid="postText"]',
  '.tweet-text',
  '.post-text',
];

// Leaf elements are the actual content containers
const leafTags = ['p', 'li', 'td', 'th', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dd', 'dt'];
// Container elements are skipped - they contain other elements
const containerTags = ['section', 'article', 'div', 'main', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr'];
// These subtrees are page chrome or controls, not translatable content
const ignoredSubtreeTags = ['aside', 'nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio', 'form', 'button', 'input', 'select', 'textarea'];

/**
 * Check if an element should be treated as a leaf content container.
 * Supports traditional leaf tags plus platform-specific div wrappers
 * (e.g. Twitter/X tweetText, Facebook postText) and a generic heuristic
 * for divs that only contain inline content and substantial text.
 */
function isLeafContent(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();

  if (leafTags.includes(tagName)) {
    return true;
  }

  // Platform-specific content markers (e.g. Twitter/X)
  for (const selector of leafContentSelectors) {
    if (element.matches(selector)) {
      return true;
    }
  }

  // Generic heuristic: a div without block/container children and with substantial text
  if (tagName === 'div') {
    const hasBlockChildren = Array.from(element.children).some((child) => {
      const childTag = child.tagName.toLowerCase();
      return containerTags.includes(childTag) || leafTags.includes(childTag);
    });
    if (hasBlockChildren) {
      return false;
    }
    const text = (element.textContent || '').trim();
    return text.length >= 20;
  }

  return false;
}

/**
 * Extract paragraphs from a root element
 * Only extracts leaf elements to avoid duplicates
 */
export function extractParagraphs(rootElement: HTMLElement): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  const seenTexts = new Set<string>();
  
  // Walk through all elements in the root
  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const element = node as HTMLElement;
        const tagName = element.tagName.toLowerCase();

        if (
          ignoredSubtreeTags.includes(tagName) ||
          element.closest('.immersive-translate-floating-button, .immersive-translate-modal, .immersive-translate-bilingual, #immersive-translate-progress, #immersive-translate-notification') ||
          isHiddenElement(element)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip container elements unless they are recognized as leaf content
        if (containerTags.includes(tagName) && !isLeafContent(element)) {
          return NodeFilter.FILTER_SKIP;
        }

        // Only accept leaf content elements with text
        if (!isLeafContent(element)) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node = walker.nextNode() as HTMLElement;
  let index = 0;

  while (node) {
    const text = getCleanText(node);
    
    // Skip if text is too short or already seen (deduplicate by content)
    if (text.length >= 20 && !seenTexts.has(text)) {
      seenTexts.add(text);
      paragraphs.push({
        element: node,
        text,
        index: index++,
      });
    }
    node = walker.nextNode() as HTMLElement;
  }

  return paragraphs;
}

function isHiddenElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}

/**
 * Get clean text content from an element
 * Removes scripts, styles, and extra whitespace
 */
export function getCleanText(element: HTMLElement): string {
  // Clone to avoid modifying original
  const clone = element.cloneNode(true) as HTMLElement;
  
  // Remove script, style, and other non-content elements
  const elementsToRemove = clone.querySelectorAll('script, style, noscript, iframe, svg, canvas, video, audio, img, button, input, select, textarea, nav, header, footer, aside, a, code, pre');
  elementsToRemove.forEach(el => el.remove());
  
  // Get text content
  let text = clone.textContent || '';
  
  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/^\s+|\s+$/g, '')
    .trim();
  
  return text;
}

/**
 * Check if current page is likely to be an article/readable page
 */
export function isReadablePage(): boolean {
  try {
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();
    
    return !!(article && article.textContent && article.textContent.length > 500);
  } catch {
    return false;
  }
}

/**
 * Get the main content element after Readability processing
 */
export function getMainContentElement(): HTMLElement | null {
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.article-content',
    '#content',
    '.content',
    '.post',
    '.article',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && isValidContent(element as HTMLElement)) {
      return element as HTMLElement;
    }
  }

  const article = extractArticle();
  if (article && article.content) {
    const allElements = document.querySelectorAll('article, [role="main"], main, .content, #content, body');
    let bestElement: HTMLElement | null = null;
    let maxMatchScore = 0;

    for (const el of Array.from(allElements)) {
      const score = calculateMatchScore(el as HTMLElement, article.textContent);
      if (score > maxMatchScore) {
        maxMatchScore = score;
        bestElement = el as HTMLElement;
      }
    }

    return bestElement;
  }

  return null;
}

function isValidContent(element: HTMLElement): boolean {
  const text = element.textContent || '';
  return text.length > 500 && text.split(/\s+/).length > 50;
}

function calculateMatchScore(element: HTMLElement, articleText: string): number {
  const elementText = element.textContent || '';
  const articleWords = new Set(articleText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const elementWords = elementText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  let matches = 0;
  for (const word of elementWords) {
    if (articleWords.has(word)) {
      matches++;
    }
  }
  
  return matches / Math.sqrt(elementWords.length + 1);
}

// Re-export Readability for advanced use cases
export { Readability };
