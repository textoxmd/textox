import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';

// Mock the heavy toolbar module so the shell can be exercised without
// React / icons / CSS. The factory must be reachable from the hoisted
// `vi.mock` factory, hence `vi.hoisted`.
const { createTableToolbar } = vi.hoisted(() => ({
  createTableToolbar: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })),
}));

vi.mock('./toolbar', () => ({ createTableToolbar }));

import { lazyTableToolbarPlugin } from './lazy';

type ToolbarHandle = { update(): void; destroy(): void };

function createHandle(): ToolbarHandle {
  const plugin = lazyTableToolbarPlugin();
  const spec = (
    plugin as unknown as {
      spec: { view: (v: EditorView) => ToolbarHandle };
    }
  ).spec;
  // The lazy shell never touches `view.dom` itself — it is only forwarded
  // to the (mocked) toolbar factory — so a minimal fake is enough.
  return spec.view({ dom: document.createElement('div'), editable: true } as unknown as EditorView);
}

describe('lazyTableToolbarPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paints the first frame once the toolbar chunk resolves', async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    createTableToolbar.mockReturnValue({ update, destroy });

    const handle = createHandle();
    // Before the chunk resolves `handle` is null — this must stay a no-op.
    expect(() => handle.update()).not.toThrow();

    await vi.waitFor(() => expect(createTableToolbar).toHaveBeenCalledTimes(1));
    // PM does not call update() on view construction and the pre-chunk
    // update above was swallowed, so the shell must call it explicitly.
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('does not construct the toolbar when destroyed before the chunk resolves', async () => {
    const handle = createHandle();
    handle.destroy();

    // Let the dynamic import settle and its .then handler run.
    await import('./toolbar');
    await Promise.resolve();

    expect(createTableToolbar).not.toHaveBeenCalled();
  });
});
