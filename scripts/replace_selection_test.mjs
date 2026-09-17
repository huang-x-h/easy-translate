// Verifies the selection-replacement helper against jsdom. The
// contentEditable path is what powers the "replace selection with
// English" feature in the popup when the user is replying on Twitter.
//
// We read the .ts source, strip the type annotations + exports, then
// run it inside a jsdom window so that `window.getSelection()` etc.
// resolve. This avoids the need to wire up a real bundler just to test
// a 60-line helper.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const source = readFileSync('src/shared/replace.ts', 'utf8')
  .replace(/^export\s+/gm, '')
  .replace(/^import[^;]+;\s*/gm, '')
  // Strip TS-only annotations.
  // Replace type-only return annotations on function signatures BEFORE
  // the broad `: HTMLElement` strip would eat them.
  .replace(/: HTMLElement \| null \{/g, ' {')
  .replace(/: HTMLElement.*$/gm, '')
  .replace(/: HTMLInputElement.*$/gm, '')
  .replace(/:\s*boolean/g, '')
  .replace(/:\s*string/g, '')
  .replace(/:\s*number/g, '')
  .replace(/\s+as\s+(unknown\s+as\s+)?Element/g, '')
  .replace(/\.closest<HTMLElement>/g, '.closest')
  // Rewrite bare `window.X` accesses to read from the `_g` parameter so
  // the body runs inside a vm context without needing a real browser
  // global.
  .replace(/\bwindow\./g, '_g.');

function loadHelpers(window) {
  const ctx = vm.createContext({
    _g: window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    InputEvent: window.InputEvent || class InputEvent {},
    FocusEvent: window.FocusEvent || class FocusEvent {},
  });
  vm.runInContext(
    source + '\nthis.replaceSelection = replaceSelection; this.findEditableForSelection = findEditableForSelection;',
    ctx,
  );
  return {
    replaceSelection: ctx.replaceSelection,
    findEditableForSelection: ctx.findEditableForSelection,
  };
}

// ---------------------------------------------------------------------------
// 1. Plain <input>: replace selected text + dispatch input event.
// ---------------------------------------------------------------------------
{
  const dom = new JSDOM('<!doctype html><body><input id="t" value="你好世界" /></body>');
  const { window } = dom;
  const { replaceSelection } = loadHelpers(window);
  const input = window.document.getElementById('t');
  input.focus();
  input.setSelectionRange(2, 4); // select "世界"

  const ok = replaceSelection('world');
  assert.equal(ok, true);
  assert.equal(input.value, '你好world', 'input value should be replaced');
  assert.equal(input.selectionStart, 7, 'caret should be at end of inserted text');
}

// ---------------------------------------------------------------------------
// 2. Plain <textarea>: same behaviour, dispatch input event.
// ---------------------------------------------------------------------------
{
  const dom = new JSDOM('<!doctype html><body><textarea id="t">one two three</textarea></body>');
  const { window } = dom;
  const { replaceSelection } = loadHelpers(window);
  const ta = window.document.getElementById('t');
  ta.focus();
  ta.setSelectionRange(4, 7); // select "two"

  let inputFired = false;
  ta.addEventListener('input', () => { inputFired = true; });
  const ok = replaceSelection('TWO');
  assert.equal(ok, true);
  assert.equal(ta.value, 'one TWO three');
  assert.equal(inputFired, true, 'input event should fire so React notices');
}

// ---------------------------------------------------------------------------
// 3. contentEditable: Range.deleteContents + insertNode + input event.
// ---------------------------------------------------------------------------
{
  const dom = new JSDOM(`
    <!doctype html>
    <body>
      <div id="t" contenteditable="true">hello <b>brave</b> world</div>
    </body>
  `);
  const { window } = dom;
  const { document } = window;
  const { replaceSelection } = loadHelpers(window);
  const div = document.getElementById('t');
  div.focus();

  const range = document.createRange();
  const bold = div.querySelector('b');
  range.selectNodeContents(bold);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let inputFired = false;
  div.addEventListener('input', () => { inputFired = true; });
  const ok = replaceSelection('WORLD');
  assert.equal(ok, true, 'replaceSelection should succeed in contentEditable');
  assert.match(div.innerHTML, /WORLD/, 'inserted text should appear in the DOM');
  assert.equal(inputFired, true, 'contentEditable should receive an input event');
}

// ---------------------------------------------------------------------------
// 4. Selection outside any editable element returns false.
// ---------------------------------------------------------------------------
{
  const dom = new JSDOM('<!doctype html><body><p id="p">plain text</p></body>');
  const { window } = dom;
  const { document } = window;
  const { replaceSelection } = loadHelpers(window);

  const range = document.createRange();
  range.selectNodeContents(document.getElementById('p'));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const ok = replaceSelection('whatever');
  assert.equal(ok, false, 'replace should refuse to write into a non-editable surface');
}

// ---------------------------------------------------------------------------
// 5. findEditableForSelection recognises common surfaces.
// ---------------------------------------------------------------------------
{
  const dom = new JSDOM(`
    <!doctype html><body>
      <input id="i" />
      <textarea id="t"></textarea>
      <div id="d" contenteditable="true"></div>
      <p id="p">static</p>
    </body>
  `);
  const { window } = dom;
  const { document } = window;
  const { findEditableForSelection } = loadHelpers(window);

  const input = document.getElementById('i');
  input.focus();
  input.setSelectionRange(0, 0);
  assert.equal(findEditableForSelection()?.id, 'i', 'input is editable');

  const ta = document.getElementById('t');
  ta.focus();
  assert.equal(findEditableForSelection()?.id, 't', 'textarea is editable');

  const div = document.getElementById('d');
  div.focus();
  assert.equal(findEditableForSelection()?.id, 'd', 'contentEditable is editable');

  const p = document.getElementById('p');
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  assert.equal(findEditableForSelection(), null, 'a <p> is not editable');
}

console.log('PASS: replaceSelection handles input, textarea, contentEditable, non-editable, empty selection');