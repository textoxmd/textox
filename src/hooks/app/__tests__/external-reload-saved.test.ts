import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { EditorDocumentSession } from '../../../components/TextoEditor/src/history/session';
import type { TextoEditorRef } from '../../../components/TextoEditor/TextoEditorRef';
import type { useDocumentState } from '../core/useDocumentState';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/FileModifiedDialog', () => ({
  showSaveConflictDialog: vi.fn(async () => 'cancel'),
}));

import { useExternalChangeGuard } from '../core/useExternalChangeGuard';

type DocumentState = ReturnType<typeof useDocumentState>;

const PATH = '/tmp/note.md';
const DISK_CONTENT = '磁盘上的新内容';

/** 文档状态层的最小替身：只提供外部变更守卫实际读写的字段。 */
function createDoc() {
  const setters = {
    setCurrentContent: vi.fn(),
    setOriginalContent: vi.fn(),
    setIsModified: vi.fn(),
    setEditorKey: vi.fn(),
    setHasExternalConflict: vi.fn(),
    setCurrentFileDeleted: vi.fn(),
    clearCurrentFileDeleted: vi.fn(),
  };
  const doc = {
    currentFile: PATH,
    currentContentRef: { current: '' },
    originalContentRef: { current: '' },
    lastWrittenContentRef: { current: new Map<string, string>() },
    currentFileRef: { current: PATH },
    fileFingerprintRef: { current: new Map() },
    externalConflictRef: { current: new Set<string>() },
    conflictPromptedRef: { current: new Set<string>() },
    ignoreExternalModifyRef: { current: new Set<string>() },
    icloudSyncWindowRef: { current: new Set<string>() },
    icloudSyncTimersRef: { current: new Map() },
    currentFileDeletedRef: { current: false },
    deletedReconcileTimerRef: { current: null },
    ...setters,
  };
  return { doc: doc as unknown as DocumentState, setters };
}

describe('外部重载保存点', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let guard: ReturnType<typeof useExternalChangeGuard> | null = null;

  beforeEach(() => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') return DISK_CONTENT;
      if (cmd === 'get_file_metadata') return { size: 12, mtimeMs: 1000 };
      return undefined;
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    guard = null;
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    invokeMock.mockReset();
  });

  it('silentReloadFile 原位重载后把会话保存点推进到当前状态', async () => {
    const { doc, setters } = createDoc();
    const markSaved = vi.fn();
    const editorRef = {
      current: { markSaved } as unknown as TextoEditorRef,
    };

    function Harness(): ReactElement {
      guard = useExternalChangeGuard(doc, false, editorRef);
      return createElement('div');
    }

    await act(async () => {
      root!.render(createElement(Harness));
    });

    let reloaded = false;
    await act(async () => {
      reloaded = await guard!.silentReloadFile(PATH);
    });

    expect(reloaded).toBe(true);
    expect(setters.setCurrentContent).toHaveBeenCalledWith(DISK_CONTENT);
    expect(setters.setOriginalContent).toHaveBeenCalledWith(DISK_CONTENT);
    expect(setters.setIsModified).toHaveBeenCalledWith(false);
    expect(markSaved).toHaveBeenCalledTimes(1);
    // 先清未保存标记，再推进保存点：顺序颠倒会让未保存标记与保存点短暂失配
    expect(setters.setIsModified.mock.invocationCallOrder[0]).toBeLessThan(
      markSaved.mock.invocationCallOrder[0],
    );
  });

  it('markSaved 后 dirty=false，且历史清空', () => {
    const session = new EditorDocumentSession('a', { onChange: () => {} });
    session.commit({
      md: 'ab',
      selection: { anchor: { line: 1, col: 2 }, head: { line: 1, col: 2 } },
      source: 'ir',
    });
    session.reset('xyz', 'ir');
    // reset 只换内容、保留保存点代次：脏状态要靠 markSaved 结算
    expect(session.isDirty).toBe(true);
    session.markSaved();
    expect(session.isDirty).toBe(false);
    expect(session.undo('ir')).toBe(false);
  });
});
