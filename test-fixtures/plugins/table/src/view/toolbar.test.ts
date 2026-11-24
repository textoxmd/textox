import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { tableToolbarPlugin } from './toolbar';

// createTableToolbar only touches `view.dom` at construction (to register
// listeners) and reads `view` lazily inside deferred handlers, so a minimal
// fake view is enough to assert the plugin's view lifecycle. Using a real
// EditorView would couple this test to the editor skeleton.
function makeFakeView(): EditorView {
  return {
    dom: document.createElement('div'),
    editable: true,
  } as unknown as EditorView;
}

describe('tableToolbarPlugin', () => {
  it('is a ProseMirror plugin with a view lifecycle', () => {
    const plugin = tableToolbarPlugin();
    const spec = (plugin as unknown as { spec: { view?: (v: EditorView) => unknown } }).spec;
    expect(typeof spec.view).toBe('function');
    const handle = (spec.view as (v: EditorView) => { update?: unknown; destroy?: unknown })(
      makeFakeView(),
    );
    try {
      expect(typeof handle.update).toBe('function');
      expect(typeof handle.destroy).toBe('function');
    } finally {
      // createTableToolbar registers window listeners; always tear down so
      // the test does not leak them (and unmounts any icon roots).
      (handle.destroy as () => void)();
    }
  });
});
