import { describe, expect, it, vi } from 'vitest';

import { insertEmbedReference } from '../embedInsert';
import type { EmbedInsert, PluginHost } from '../types';

const embed: EmbedInsert = {
  id: 'test.embed',
  extensions: ['.excalidraw'],
  insertLabelKey: 'test.insertRef',
};

function makeHost(overrides: {
  canEdit?: boolean;
  picked?: string | null;
}): {
  host: PluginHost;
  pickFile: ReturnType<typeof vi.fn>;
  insertImageRef: ReturnType<typeof vi.fn>;
} {
  const pickFile = vi.fn(async () => overrides.picked ?? null);
  const insertImageRef = vi.fn();
  const host = {
    edition: 'full',
    documents: {
      openFile: vi.fn(async () => {}),
      getCurrentFile: () => '/docs/note.md',
      getDocumentDir: () => '/docs',
      toDocumentRelative: (abs: string) => abs.replace(/^\/docs\//, ''),
      createNewDocument: vi.fn(async () => {}),
    },
    editor: {
      insertImageRef,
      canEdit: () => overrides.canEdit ?? true,
    },
    config: { get: vi.fn(async () => undefined) },
    i18n: { t: (k: string) => k, language: () => 'en' },
    theme: { appearance: () => 'light', subscribe: () => () => {} },
    events: { on: () => () => {}, emit: () => {} },
    toast: { info: () => {}, success: () => {}, error: () => {} },
    dialogs: { pickFile, confirm: vi.fn(async () => true) },
    window: { isMain: () => true },
    log: { log: () => {}, warn: () => {}, error: () => {} },
  } as unknown as PluginHost;
  return { host, pickFile, insertImageRef };
}

describe('insertEmbedReference', () => {
  it('picks a file with the embed extensions and inserts a relative reference', async () => {
    const { host, pickFile, insertImageRef } = makeHost({
      picked: '/docs/drawings/flow.excalidraw',
    });
    await insertEmbedReference(host, embed);
    expect(pickFile).toHaveBeenCalledWith({
      filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
      defaultPath: '/docs',
    });
    expect(insertImageRef).toHaveBeenCalledWith('drawings/flow.excalidraw', 'flow');
  });

  it('does nothing when the editor is not editable', async () => {
    const { host, pickFile, insertImageRef } = makeHost({ canEdit: false });
    await insertEmbedReference(host, embed);
    expect(pickFile).not.toHaveBeenCalled();
    expect(insertImageRef).not.toHaveBeenCalled();
  });

  it('does nothing when the picker is cancelled', async () => {
    const { host, insertImageRef } = makeHost({ picked: null });
    await insertEmbedReference(host, embed);
    expect(insertImageRef).not.toHaveBeenCalled();
  });
});
