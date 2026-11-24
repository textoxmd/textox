import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { openDocument, openDocumentOrThrow } from '../openDocument';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('openDocument', () => {
  it('一次 IPC 完成打开，参数与结果原样透传', async () => {
    const result = { kind: 'file', content: '# hello' } as const;
    invokeMock.mockResolvedValue(result);

    await expect(openDocument('/tmp/a.md')).resolves.toBe(result);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('open_document', { path: '/tmp/a.md' });
  });

  it('missing 结果原样透传（content 为空）', async () => {
    const result = { kind: 'missing' } as const;
    invokeMock.mockResolvedValue(result);

    await expect(openDocument('/tmp/gone.md')).resolves.toBe(result);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('open_document', { path: '/tmp/gone.md' });
  });

  it('invoke 失败时封装不吞错', async () => {
    invokeMock.mockRejectedValue(new Error('denied'));

    await expect(openDocument('/x')).rejects.toThrow('denied');
  });
});

describe('openDocumentOrThrow', () => {
  it('missing 转为异常，消息包含路径', async () => {
    invokeMock.mockResolvedValue({ kind: 'missing' });

    await expect(openDocumentOrThrow('/tmp/gone.md')).rejects.toThrow(
      'File not found: /tmp/gone.md',
    );
  });

  it('非 missing 结果原样返回', async () => {
    const result = { kind: 'directory' } as const;
    invokeMock.mockResolvedValue(result);

    await expect(openDocumentOrThrow('/notes')).resolves.toBe(result);
    expect(invokeMock).toHaveBeenCalledWith('open_document', { path: '/notes' });
  });

  it('file 结果带内容返回', async () => {
    invokeMock.mockResolvedValue({ kind: 'temp', content: 'draft' });

    await expect(openDocumentOrThrow('/tmp/t.md')).resolves.toEqual({
      kind: 'temp',
      content: 'draft',
    });
  });
});
