import { useState, useRef, useCallback, useEffect } from 'react';
import { parse } from '@/components/TextoEditor/src/parser';
import { serialize } from '@/components/TextoEditor/src/serializer';
import { isSourcePreserveEnabled } from '@/components/TextoEditor/src/source-preserve-config';
import type { FileHandle } from '@/app/types';

/** 打开时同步计算 dirty 基线的最大字符数；更大的文档推迟到空闲时段。 */
const BASELINE_EAGER_MAX_CHARS = 32 * 1024;

/**
 * 文档状态：当前文件身份/内容、未保存句柄、外部变更与冲突相关的可变引用、
 * 以及文档生命周期用到的镜像 ref 与辅助判断。
 * 这是文档核心最底层，不依赖任何其他核心层。
 */
export function useDocumentState() {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isModified, setIsModified] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // 未保存文件相关状态
  const [fileHandle, setFileHandle] = useState<FileHandle>({ kind: 'none' });
  const fileHandleRef = useRef(fileHandle);
  fileHandleRef.current = fileHandle;

  // 外部文件修改检测状态
  const ignoreExternalModifyRef = useRef<Set<string>>(new Set());
  // 记录应用最近一次写入的内容，用于区分"自身写入回显"与"真实外部修改"
  const lastWrittenContentRef = useRef<Map<string, string>>(new Map());
  // 外部修改冲突：当前文件在磁盘上已被外部修改，但编辑器里有未保存内容
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  const externalConflictRef = useRef<Set<string>>(new Set());
  // 记录已为某路径弹过冲突确认框的路径，避免同一冲突被重复打扰
  const conflictPromptedRef = useRef<Set<string>>(new Set());
  // 记录已知的磁盘状态（修改时间 + 大小），用于事件/保存前的廉价去噪，避免反复读文件
  const fileFingerprintRef = useRef<Map<string, { size: number; mtimeMs: number | null }>>(new Map());

  // 当前打开文件在磁盘上被删除（VS Code 式：保留缓冲，等待同名重建或保存重建）
  const [currentFileDeleted, setCurrentFileDeleted] = useState(false);
  const currentFileDeletedRef = useRef(false);
  // 删除事件兜底：create 事件可能丢失或乱序，短暂延迟后确认文件是否已同名重建
  const deletedReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清除“文件已删除”标记（同名重建、成功保存重建、切换/关闭文件时调用）
  const clearCurrentFileDeleted = useCallback(() => {
    currentFileDeletedRef.current = false;
    setCurrentFileDeleted(false);
    if (deletedReconcileTimerRef.current) {
      clearTimeout(deletedReconcileTimerRef.current);
      deletedReconcileTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (deletedReconcileTimerRef.current) clearTimeout(deletedReconcileTimerRef.current);
    };
  }, []);

  const icloudSyncWindowRef = useRef<Set<string>>(new Set());
  const icloudSyncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 使用 ref 来存储最新的状态，避免闭包问题
  const currentFileRef = useRef(currentFile);
  const currentContentRef = useRef(currentContent);
  const isModifiedRef = useRef(isModified);
  const originalContentRef = useRef(originalContent);
  const originalBaselineRef = useRef('');
  const editorMountVersionRef = useRef(0);
  const editorSettleVersionRef = useRef(-1);
  const editorKeyRef = useRef(editorKey);

  // 同步 ref
  currentFileRef.current = currentFile;
  currentContentRef.current = currentContent;
  isModifiedRef.current = isModified;
  originalContentRef.current = originalContent;
  editorKeyRef.current = editorKey;

  // 重算“干净基线”，用于判断编辑器内容是否相对原文被修改。
  // 基线只服务于 dirty 判断：首次用户编辑时才会读取，因此大文档不必在打开时
  // 同步付一次 parse + 全文 serialize（600KB 约 150-200ms）。小文档直接算；
  // 大文档推迟到空闲时段，若用户在空闲回调前就编辑，ensureOriginalBaseline()
  // 会同步补算。
  const baselineSourceRef = useRef<string | null>(null);
  const computeBaseline = useCallback((source: string) => {
    baselineSourceRef.current = source;
    try {
      if (isSourcePreserveEnabled()) {
        // 保真输出未编辑时 === 原文：基线直接取原文，dirty 判断退化为严格比较。
        originalBaselineRef.current = source;
      } else {
        const doc = parse(source);
        originalBaselineRef.current = serialize(doc);
      }
    } catch {
      originalBaselineRef.current = source;
    }
  }, []);

  /** 确保基线对应当前原文；未计算（或已失效）时同步计算。 */
  const ensureOriginalBaseline = useCallback(() => {
    const source = originalContentRef.current ?? '';
    if (baselineSourceRef.current === source) return;
    computeBaseline(source);
  }, [computeBaseline]);

  useEffect(() => {
    const source = originalContent ?? '';
    // 先失效：避免空闲回调尚未跑完时误用上一份文档的基线。
    baselineSourceRef.current = null;
    if (source.length <= BASELINE_EAGER_MAX_CHARS || isSourcePreserveEnabled()) {
      computeBaseline(source);
      return;
    }
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number }).requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(() => computeBaseline(source), { timeout: 4000 });
      const cancelIdle = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      return () => cancelIdle?.(id);
    }
    const timer = setTimeout(() => computeBaseline(source), 800);
    return () => clearTimeout(timer);
  }, [originalContent, computeBaseline]);

  // 当前缓冲是否有需要确认保留的内容：有正文，且满足“未保存修改 / 未保存临时文件 /
  // 文件已被删除或移走（缓冲里可能还有值得保存回原位置的内容）”之一。
  const hasBufferToKeep = useCallback(
    () =>
      !!currentContentRef.current.trim() &&
      (isModifiedRef.current ||
        fileHandleRef.current.kind === 'temp' ||
        currentFileDeletedRef.current),
    [],
  );

  return {
    currentFile,
    setCurrentFile,
    currentContent,
    setCurrentContent,
    originalContent,
    setOriginalContent,
    isModified,
    setIsModified,
    editorKey,
    setEditorKey,
    fileHandle,
    setFileHandle,
    fileHandleRef,
    ignoreExternalModifyRef,
    lastWrittenContentRef,
    hasExternalConflict,
    setHasExternalConflict,
    externalConflictRef,
    conflictPromptedRef,
    fileFingerprintRef,
    currentFileDeleted,
    setCurrentFileDeleted,
    currentFileDeletedRef,
    deletedReconcileTimerRef,
    clearCurrentFileDeleted,
    icloudSyncWindowRef,
    icloudSyncTimersRef,
    currentFileRef,
    currentContentRef,
    isModifiedRef,
    originalContentRef,
    originalBaselineRef,
    editorMountVersionRef,
    editorSettleVersionRef,
    editorKeyRef,
    hasBufferToKeep,
    ensureOriginalBaseline,
  };
}
