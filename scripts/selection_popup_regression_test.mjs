import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const contentScript = readFileSync('dist/content.js', 'utf8');

const dom = new JSDOM(
  '<!doctype html><html><body><p id="page-text">hello world</p></body></html>',
  {
    url: 'https://example.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  },
);

const { window } = dom;
const { document } = window;
const pageText = document.querySelector('#page-text').firstChild;

window.chrome = {
  runtime: {
    getURL: path => `chrome-extension://test/${path}`,
    onMessage: {
      addListener() {},
    },
  },
  storage: {
    local: {
      async get() {
        throw new Error('Extension context invalidated.');
      },
      async set() {},
      async remove() {},
    },
  },
};

window.fetch = async () => ({ ok: false });
window.console = console;

let selectionAnchor = pageText;
let selectionText = 'hello';
window.getSelection = () => ({
  anchorNode: selectionAnchor,
  toString: () => selectionText,
  getRangeAt: () => ({
    getBoundingClientRect: () => ({
      left: 20,
      right: 80,
      top: 20,
      bottom: 40,
      width: 60,
      height: 20,
    }),
  }),
});

window.eval(contentScript);
document.dispatchEvent(new window.Event('DOMContentLoaded'));

document.querySelector('#page-text').dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

const floatingButton = document.querySelector('.immersive-translate-floating-button');
assert.equal(floatingButton.style.visibility, 'visible', 'page selection should show the floating button');

floatingButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(resolve => window.setTimeout(resolve, 0));

const popup = document.querySelector('.immersive-translate-modal');
assert.equal(popup.textContent.includes('Extension context invalidated'), false, 'stale extension errors should not be shown raw');
assert.equal(popup.textContent.includes('翻译失败'), false, 'stale extension errors should not be rendered as translation failures');
assert.equal(popup.textContent.includes('扩展已重新加载'), true, 'stale extension errors should ask the user to refresh the page');

const popupText = popup.querySelector('.immersive-translate-error-text').firstChild;
selectionAnchor = popupText;
selectionText = '扩展';
popup.querySelector('.immersive-translate-error-text').dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));

assert.notEqual(floatingButton.style.visibility, 'visible', 'selection inside the translation popup should not show the floating button');

console.log('PASS: selection popup ignores its own selection and handles stale extension context');
