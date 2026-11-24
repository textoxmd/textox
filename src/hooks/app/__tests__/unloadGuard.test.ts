import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined));
const messageMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined));
const confirmMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(false));
const saveDialogMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...a: unknown[]) => messageMock(...a),
  confirm: (...a: unknown[]) => confirmMock(...a),
  save: (...a: unknown[]) => saveDialogMock(...a),
}));

import {
  applyUnloadPreparation,
  prepareWindowUnload,
  type UnloadGuardDeps,
} from '../unloadGuard';

/** t 用恒等函数：测试里直接以 key 作为按钮返回值。 */
const t = (key: string) => key;

function deps(overrides: Partial<UnloadGuardDeps> = {}): UnloadGuardDeps {
  return {
    file: '/tmp/a.md',
    content: 'hello',
    isModified: false,
    isTemp: false,
    isCustomSave: false,
    editor: null,
    t,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  messageMock.mockReset();
  confirmMock.mockReset();
  saveDialogMock.mockReset();
});

describe('prepareWindowUnload', () => {
  it('无文件：直接放行', async () => {
    await expect(prepareWindowUnload(deps({ file: null }))).resolves.toEqual({ proceed: true });
  });

  it('普通文件未修改：放行', async () => {
    await expect(prepareWindowUnload(deps())).resolves.toEqual({ proceed: true });
  });

  it('普通文件已修改：确认后放行、取消则拒绝', async () => {
    confirmMock.mockResolvedValueOnce(true);
    await expect(
      prepareWindowUnload(deps({ isModified: true })),
    ).resolves.toEqual({ proceed: true });

    confirmMock.mockResolvedValueOnce(false);
    await expect(
      prepareWindowUnload(deps({ isModified: true })),
    ).resolves.toEqual({ proceed: false });
  });

  it('空白临时文件：放行并标记删除', async () => {
    await expect(
      prepareWindowUnload(deps({ isTemp: true, file: '/tmp/untitled', content: '  ' })),
    ).resolves.toEqual({ proceed: true, deleteTemp: true });
  });

  it('临时文件有内容：另存为成功后返回 savedPath', async () => {
    messageMock.mockResolvedValueOnce(t('unsavedChanges.save'));
    saveDialogMock.mockResolvedValueOnce('/tmp/saved.md');
    await expect(
      prepareWindowUnload(deps({ isTemp: true, file: '/tmp/untitled', content: 'x' })),
    ).resolves.toEqual({ proceed: true, savedPath: '/tmp/saved.md', deleteTemp: true });
    expect(invokeMock).toHaveBeenCalledWith('write_file', {
      path: '/tmp/saved.md',
      content: 'x',
    });
  });

  it('临时文件有内容：另存为对话框取消则拒绝', async () => {
    messageMock.mockResolvedValueOnce(t('unsavedChanges.save'));
    saveDialogMock.mockResolvedValueOnce(null);
    await expect(
      prepareWindowUnload(deps({ isTemp: true, file: '/tmp/untitled', content: 'x' })),
    ).resolves.toEqual({ proceed: false });
  });

  it('临时文件有内容：不保存放行并标记删除，取消则拒绝', async () => {
    messageMock.mockResolvedValueOnce(t('unsavedChanges.dontSave'));
    await expect(
      prepareWindowUnload(deps({ isTemp: true, file: '/tmp/untitled', content: 'x' })),
    ).resolves.toEqual({ proceed: true, deleteTemp: true, discard: true });

    messageMock.mockResolvedValueOnce(t('unsavedChanges.cancel'));
    await expect(
      prepareWindowUnload(deps({ isTemp: true, file: '/tmp/untitled', content: 'x' })),
    ).resolves.toEqual({ proceed: false });
  });

  it('customSave 编辑器：保存成功放行、保存失败/取消拒绝、放弃放行', async () => {
    const editorOk = { save: vi.fn(async () => ({ ok: true })) };
    messageMock.mockResolvedValueOnce(t('unsavedChanges.save'));
    await expect(
      prepareWindowUnload(deps({ isCustomSave: true, isModified: true, editor: editorOk })),
    ).resolves.toEqual({ proceed: true });
    expect(editorOk.save).toHaveBeenCalledTimes(1);

    const editorFail = { save: vi.fn(async () => ({ ok: false })) };
    messageMock.mockResolvedValueOnce(t('unsavedChanges.save'));
    await expect(
      prepareWindowUnload(deps({ isCustomSave: true, isModified: true, editor: editorFail })),
    ).resolves.toEqual({ proceed: false });

    messageMock.mockResolvedValueOnce(t('unsavedChanges.dontSave'));
    await expect(
      prepareWindowUnload(deps({ isCustomSave: true, isModified: true, editor: editorOk })),
    ).resolves.toEqual({ proceed: true, deleteTemp: false, discard: true });

    messageMock.mockResolvedValueOnce(t('unsavedChanges.cancel'));
    await expect(
      prepareWindowUnload(deps({ isCustomSave: true, isModified: true, editor: editorOk })),
    ).resolves.toEqual({ proceed: false });
  });

  it('customSave 编辑器且临时文件：不保存时标记删除', async () => {
    const editorOk = { save: vi.fn(async () => ({ ok: true })) };
    messageMock.mockResolvedValueOnce(t('unsavedChanges.dontSave'));
    await expect(
      prepareWindowUnload(
        deps({ isCustomSave: true, isModified: true, isTemp: true, editor: editorOk }),
      ),
    ).resolves.toEqual({ proceed: true, deleteTemp: true, discard: true });
  });

  it('customSave 编辑器未修改：放行', async () => {
    await expect(
      prepareWindowUnload(deps({ isCustomSave: true, isModified: false })),
    ).resolves.toEqual({ proceed: true, deleteTemp: false });
  });
});

describe('applyUnloadPreparation', () => {
  function io() {
    return {
      updateWindowFile: vi.fn(async () => {}),
      deleteTempFile: vi.fn(async () => {}),
    };
  }

  it('savedPath 且 deleteTemp：先指向新文件，再删除原临时文件', async () => {
    const calls = io();
    await applyUnloadPreparation(
      { proceed: true, savedPath: '/tmp/saved.md', deleteTemp: true },
      '/tmp/untitled',
      calls,
    );
    expect(calls.updateWindowFile).toHaveBeenCalledWith('/tmp/saved.md');
    expect(calls.deleteTempFile).toHaveBeenCalledWith('/tmp/untitled');
    expect(calls.updateWindowFile.mock.invocationCallOrder[0]).toBeLessThan(
      calls.deleteTempFile.mock.invocationCallOrder[0],
    );
  });

  it('discard 且 deleteTemp：先删除临时文件，再清空窗口当前文件', async () => {
    const calls = io();
    await applyUnloadPreparation(
      { proceed: true, deleteTemp: true, discard: true },
      '/tmp/untitled',
      calls,
    );
    expect(calls.deleteTempFile).toHaveBeenCalledWith('/tmp/untitled');
    expect(calls.updateWindowFile).toHaveBeenCalledWith(null);
    expect(calls.deleteTempFile.mock.invocationCallOrder[0]).toBeLessThan(
      calls.updateWindowFile.mock.invocationCallOrder[0],
    );
  });

  it('无 savedPath 且无 discard：不触碰窗口文件与临时文件', async () => {
    const calls = io();
    await applyUnloadPreparation({ proceed: true, deleteTemp: true }, '/tmp/untitled', calls);
    expect(calls.updateWindowFile).not.toHaveBeenCalled();
    expect(calls.deleteTempFile).not.toHaveBeenCalled();
  });

  it('discard 但为持久文件（deleteTemp:false）：不触碰 io，重载后重新打开原文件', async () => {
    const calls = io();
    await applyUnloadPreparation(
      { proceed: true, discard: true, deleteTemp: false },
      '/tmp/a.md',
      calls,
    );
    expect(calls.updateWindowFile).not.toHaveBeenCalled();
    expect(calls.deleteTempFile).not.toHaveBeenCalled();
  });
});
