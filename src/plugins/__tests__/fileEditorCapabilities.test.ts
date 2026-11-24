import { describe, expect, it } from 'vitest';

import { fileEditorCapabilities } from '../fileEditorCapabilities';
import type { FileEditorContribution } from '../types';

function contribution(capabilities?: FileEditorContribution['capabilities']): FileEditorContribution {
  return { id: 'x', extensions: ['.x'], load: async () => ({ default: () => null }), capabilities };
}

describe('fileEditorCapabilities', () => {
  it('defaults to markdown-like behavior when there is no contribution', () => {
    expect(fileEditorCapabilities(null)).toEqual({ customSave: false, externalModify: false, exportable: true });
    expect(fileEditorCapabilities(undefined)).toEqual({ customSave: false, externalModify: false, exportable: true });
  });

  it('defaults when the contribution declares no capabilities', () => {
    expect(fileEditorCapabilities(contribution())).toEqual({ customSave: false, externalModify: false, exportable: true });
  });

  it('reads declared capabilities', () => {
    expect(fileEditorCapabilities(contribution({ customSave: true, externalModify: true, exportable: false }))).toEqual({
      customSave: true,
      externalModify: true,
      exportable: false,
    });
  });

  it('treats exportable: undefined as exportable', () => {
    expect(fileEditorCapabilities(contribution({ customSave: true })).exportable).toBe(true);
  });
});
