import { Plugin } from "prosemirror-state";

let _isInComposition = false;

export function isInComposition(): boolean {
  return _isInComposition;
}

export function setComposition(value: boolean): void {
  _isInComposition = value;
}

// WebKit splits an EMPTY textblock's IME composition on commit: the block
// contains only a `<br>` placeholder, so during composition WebKit keeps
// adding/removing the `<br>` and on confirm it inserts a paragraph break —
// the raw pinyin stays in the block and the confirmed character lands on a
// new line. Give the block a real zero-width text node at compositionstart
// so WebKit anchors to inline text instead, then drop it at compositionend.
// Code blocks have the same precondition (`<pre><code><br></code></pre>`)
// and hit the same failure, so they are anchored too.
const ZWSP = "\u200b";

function isCompositionAnchorTarget($head: import("prosemirror-model").ResolvedPos): boolean {
  const parent = $head.parent;
  if (!parent.isTextblock) return false;
  return parent.content.size === 0;
}

// Composition that starts in a nested widget input (e.g. the code block's
// language selector, which lives inside the editor DOM but outside the
// editable content) must not touch the document: the PM selection merely
// points at the block being edited, so anchoring would insert a ZWSP into
// the code body while the user is typing in the input.
function isNestedWidgetTarget(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="false"]'));
}

function removeAnchor(view: import("prosemirror-view").EditorView): void {
  if (view.isDestroyed) return;
  const $head = view.state.selection.$head;
  const parent = $head.parent;
  if (!parent.isTextblock) return;
  const blockStart = $head.start();
  let from = -1;
  let to = -1;
  let offset = 0;
  parent.content.forEach((child) => {
    if (child.isText && child.text != null) {
      const t = child.text;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === ZWSP) {
          const p = blockStart + offset + i;
          if (from < 0) from = p;
          to = p + 1;
        }
      }
    }
    offset += child.nodeSize;
  });
  if (from < 0) return;
  view.dispatch(view.state.tr.delete(from, to));
}

export function compositionPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        compositionstart: (view, event) => {
          _isInComposition = true;
          if (isNestedWidgetTarget(event)) return false;
          const $head = view.state.selection.$head;
          if (isCompositionAnchorTarget($head)) {
            view.dispatch(view.state.tr.insertText(ZWSP, $head.pos));
          }
          return false;
        },
        compositionend: (view) => {
          _isInComposition = false;
          // Run after PM has synced the committed composition into the doc.
          setTimeout(() => removeAnchor(view), 0);
          return false;
        },
      },
    },
  });
}
