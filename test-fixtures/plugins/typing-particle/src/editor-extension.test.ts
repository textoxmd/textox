import { describe, expect, it } from 'vitest';
import type { EditorContext } from '@texto/markdown-editor-api';

import { typingParticleEditorExtension } from './editor-extension';

function ctx(): EditorContext {
  return {
    schema: {} as never,
    views: { codeBlock: () => null as never, embed: () => null as never },
    config: {
      get: (() => 8) as never,
      all: (() => ({ count: 8 })) as never,
    },
  };
}

describe('typingParticleEditorExtension', () => {
  it('creates a ProseMirror plugin and reads config lazily', () => {
    const result = typingParticleEditorExtension.create(ctx());
    expect(result.plugins).toHaveLength(1);
  });

  it('does not throw when config is empty', () => {
    const result = typingParticleEditorExtension.create({
      ...ctx(),
      config: { get: (() => undefined) as never, all: (() => ({})) as never },
    });
    expect(result.plugins?.[0]).toBeTruthy();
  });
});
