import { useEffect, useRef, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listenMcpRpc, type McpCreateEntryRequest, type McpTextPoint } from '@/mcp/bridge';
import { logger } from '@/utils/logger';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import { normalizePath, resolveWorkspacePath } from '@/utils/workspacePath';
import type { useDocumentState } from './core/useDocumentState';

type DocumentState = ReturnType<typeof useDocumentState>;

export interface UseMcpBridgeParams {
  doc: DocumentState;
  /** 当前视觉模式；仅用于在快照里告诉外部客户端 */
  editorMode: string;
  editorRef: RefObject<TextoEditorRef | null>;
  /** 当前工作区根目录（打开文件夹时有值） */
  workspaceRoot: string | null;
  refreshDirectory: () => Promise<void>;
  executeOpenFile: (path: string, isDirectory: boolean) => Promise<boolean>;
}

/**
 * MCP 原型桥接：外部 AI 客户端经本机回环读写当前文档 / 工作区。
 *
 * 服务端见 `src-tauri/src/mcp.rs`（事件 `mcp-rpc` / `mcp-rpc-response`）。
 * 只订阅一次：处理函数内部全部读 ref，避免依赖变化导致重复监听。
 */
export function useMcpBridge({
  doc,
  editorMode,
  editorRef,
  workspaceRoot,
  refreshDirectory,
  executeOpenFile,
}: UseMcpBridgeParams) {
  const { currentFileRef, currentContentRef, isModifiedRef } = doc;
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;
  const refreshDirectoryRef = useRef(refreshDirectory);
  refreshDirectoryRef.current = refreshDirectory;
  const executeOpenFileRef = useRef(executeOpenFile);
  executeOpenFileRef.current = executeOpenFile;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const createEntry = async (
      request: McpCreateEntryRequest,
    ): Promise<Record<string, unknown>> => {
      const root = workspaceRootRef.current;
      if (!root) throw new Error('当前没有打开工作区（文件夹），无法新建文件或文件夹');

      const raw = typeof request?.path === 'string' ? request.path.trim() : '';
      if (!raw) throw new Error('缺少参数 path');
      const path = resolveWorkspacePath(raw, root);
      if (path === normalizePath(root)) {
        throw new Error('path 不能是工作区根目录本身');
      }

      const kind = request.kind === 'folder' ? 'folder' : 'file';
      const exists = await invoke<boolean>('path_exists', { path }).catch(() => false);
      if (exists) throw new Error(`路径已存在: ${path}`);

      if (kind === 'folder') {
        await invoke('create_folder', { path });
      } else {
        await invoke('create_file', { path });
        if (typeof request.content === 'string' && request.content.length > 0) {
          await invoke('write_file', { path, content: request.content });
        }
      }

      // 目录监听也会触发刷新，这里主动刷一次保证立即反映到侧栏
      await refreshDirectoryRef.current().catch((error) => {
        logger.warn('[mcp] failed to refresh directory', error);
      });

      let opened = false;
      if (kind === 'file' && request.open) {
        opened = await executeOpenFileRef.current(path, false).catch((error) => {
          logger.warn('[mcp] failed to open created file', error);
          return false;
        });
      }

      return { path, kind, opened };
    };

    listenMcpRpc({
      getActiveDocument: () => {
        const selection = editorRef.current?.getSelection() ?? null;
        const root = workspaceRootRef.current;
        return {
          path: currentFileRef.current || null,
          markdown: currentContentRef.current ?? '',
          modified: isModifiedRef.current,
          mode: editorModeRef.current,
          selection,
          workspace: root ? { root } : null,
        };
      },
      insertText: (text: string, at?: McpTextPoint, stream = true) => {
        const editor = editorRef.current;
        if (!editor) throw new Error('编辑器尚未就绪');
        // 逐字插入是异步的（最长 8s），新一轮会取消上一轮 —— 静默丢字比报错更糟。
        if (editor.isStreamingInsert()) {
          throw new Error('上一次逐字插入尚未完成，请等待其结束（约 8 秒上限）后再插入');
        }
        editor.insertTextStreamed(text, at, { stream });
        return {
          inserted: text.length,
          // 源码视图下退化为整段插入，逐字效果只在 IR 生效
          streaming: stream && editorModeRef.current !== 'sv',
        };
      },
      setSelection: (start: McpTextPoint, end?: McpTextPoint) => {
        const editor = editorRef.current;
        if (!editor) throw new Error('编辑器尚未就绪');
        const selection = editor.setSelection(start, end);
        if (!selection) throw new Error('无法定位到该位置');
        return { ...selection };
      },
      replaceDocument: (markdown: string) => {
        const editor = editorRef.current;
        if (!editor) throw new Error('编辑器尚未就绪');
        editor.replaceDocument(markdown);
        return { replaced: true, selection: editor.getSelection() };
      },
      createEntry,
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => logger.warn('[mcp] failed to listen for bridge requests', error));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [currentContentRef, currentFileRef, editorRef, isModifiedRef]);
}
