/**
 * Selection-replacement helpers used to swap the user's currently
 * selected text with a translation. Twitter's composer, Slack's draft
 * box, and most rich editors expose `contenteditable="true"`; plain
 * `<input>` and `<textarea>` also work.
 *
 * Implementation notes:
 *
 * - We deliberately avoid `document.execCommand('insertText')`. It's
 *   deprecated, behaves inconsistently across editors, and breaks in
 *   contenteditable surfaces managed by frameworks (React re-renders
 *   wipe the change). The Selection API + InputEvent approach works in
 *   both plain inputs and React-managed textareas.
 *
 * - We dispatch an `input` event with `bubbles: true` so frameworks that
 *   observe native input events pick up the change. Without this, the
 *   new text shows up but the editor's internal state is stale and the
 *   next keystroke / send wipes it out.
 */

const EDITABLE_SELECTOR =
  '[contenteditable="true"], [contenteditable=""], input, textarea';

/**
 * Whether the current document selection lives inside something
 * editable. Returns the editable element if so, otherwise null.
 */
export function findEditableForSelection(): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  if (!node) return null;

  // Node.ELEMENT_NODE === 1. We use the literal so this module can be
  // imported under Node 24's experimental TS strip-types loader for
  // testing without DOM globals bleeding into module init.
  const ELEMENT_NODE = 1;
  const root = node.nodeType === ELEMENT_NODE
    ? node as unknown as Element
    : node.parentElement;
  if (!root) return null;

  // `closest` walks up until it finds a match. Include the root itself
  // by checking the root first.
  if (root instanceof HTMLElement && root.matches(EDITABLE_SELECTOR)) {
    return root;
  }
  return root.closest<HTMLElement>(EDITABLE_SELECTOR);
}

/**
 * Replaces the current selection with `text`. Returns true on success.
 *
 * If there is no active selection, or the selection is not inside an
 * editable element, returns false without touching the DOM — caller
 * should fall back to clipboard copy.
 */
export function replaceSelection(text: string): boolean {
  const editable = findEditableForSelection();
  if (!editable) return false;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);

  // For plain <input> / <textarea>, the selection lives on the element
  // itself — set its value directly. setSelectionRange keeps the caret
  // in a sensible place after the insert.
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    const start = editable.selectionStart ?? editable.value.length;
    const end = editable.selectionEnd ?? editable.value.length;
    editable.value = editable.value.slice(0, start) + text + editable.value.slice(end);
    const caret = start + text.length;
    try {
      editable.setSelectionRange(caret, caret);
    } catch {
      // Some input types (number, email) reject setSelectionRange.
    }
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    editable.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    return true;
  }

  // contentEditable path.
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  // Move the caret to the end of the inserted text.
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  return true;
}
