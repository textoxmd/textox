import { useEffect, useRef, useCallback, forwardRef, type ReactNode } from 'react';
import { logger } from '@/utils/logger';
import type { Plugin } from 'prosemirror-state';
import { TextoEditor } from './TextoEditor/TextoEditor';
import type { TextoEditorRef } from './TextoEditor/TextoEditorRef';
import type { ChangeMeta } from './TextoEditor/src/history/types';
import { revealHeadingRef } from './headingReveal';

import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { pictureDir } from '@tauri-apps/api/path';
import { toast } from 'sonner';
import i18n, { isRTLLanguage } from '@/i18n';
import { resolveImageUploader } from '@/plugins/imageUploader';
import { preloadImage } from '@/utils/preloadImage';
import type { EmbedInsert } from '@/plugins/types';

interface SaveImageResult {
  path: string;
  filename: string;
  relative_path: string;
}

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string, meta?: ChangeMeta) => void;
  onSave?: () => void;
  appearance?: 'light' | 'dark' | 'system';
  codeBlockWordWrap?: boolean;
  showLineNumbers?: boolean;
  readableLineLength?: boolean;
  typewriterEnabled?: boolean;
  scrollToLine?: number;
  scrollToTrigger?: number;
  scrollToHeading?: string;
  /**
   * 编辑器内容变化时向外发射大纲。
   * 传 `undefined` 表示当前不计算大纲（大纲面板关闭、侧栏大纲不可见且未处于 `#` 命令模式）。
   * 回调必须保持稳定引用；身份变化会触发一次大纲补发。
   */
  onOutlineChange?: (outline: { level: number; text: string; line: number; pos?: number; excerpt?: string }[]) => void;
  editorMode?: 'ir' | 'sv';
  positionKey?: number;
  documentPath?: string;
  isSingleFileMode?: boolean;
  openableExtensions?: string[];
  onOpenFileLink?: (path: string) => void;
  autoCapitalize?: boolean;
  editable?: boolean;
  /** 由骨架注入的"插入嵌入引用"流程（命令面板与 slash 共用） */
  onInsertEmbed?: (embed: EmbedInsert) => void;
  extraPlugins?: Plugin[];
  /**
   * IR 页顶部的骨架槽位（骨架把顶部格式操作栏放这里）。渲染在 IR pane **内部**，
   * 因此切换模式时随 IR 页一起平移；放在 pane 外则原地不动。
   */
  irHeader?: ReactNode;
}

export const MarkdownEditor = forwardRef<TextoEditorRef, MarkdownEditorProps>(function MarkdownEditor({
  content, onChange, onSave, appearance = 'system', codeBlockWordWrap, showLineNumbers, readableLineLength, typewriterEnabled, scrollToLine, scrollToTrigger, scrollToHeading, onOutlineChange, editorMode = 'ir', positionKey, documentPath, isSingleFileMode, openableExtensions, onOpenFileLink, autoCapitalize, editable = true, onInsertEmbed, extraPlugins, irHeader
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const insertImageRef = useRef<((imageUrl: string, fileName: string, title?: string, slashPos?: number) => void) | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleChange = useCallback((value: string, meta?: ChangeMeta) => {
    onChangeRef.current(value, meta);
  }, []);

  const handleSave = useCallback(() => {
    onSaveRef.current?.();
  }, []);

  // 大纲跳转兜底：标题拿不到 ProseMirror pos 时按文本定位（命令面板与侧栏共用该入口）。
  useEffect(() => {
    const fn = (_line: number, text: string) => {
      (ref as React.RefObject<TextoEditorRef | null> | null)?.current?.scrollToHeadingText(text);
    };
    revealHeadingRef.current = fn;
    return () => {
      if (revealHeadingRef.current === fn) revealHeadingRef.current = null;
    };
  }, [ref]);

  const isImageInsertAllowed = useCallback(async (): Promise<boolean> => {
    if (!documentPath) return false;
    if (isSingleFileMode) return false;
    try {
      return !(await invoke<boolean>('is_temp_path', { path: documentPath }));
    } catch {
      return false;
    }
  }, [documentPath, isSingleFileMode]);

  const getImageInsertBlockMessage = useCallback((): string => {
    if (!documentPath) return i18n.t('message.imageInsertNotAllowed');
    if (isSingleFileMode) return i18n.t('message.imageInsertNotAllowedSingleFile');
    return i18n.t('message.imageInsertNotAllowed');
  }, [documentPath, isSingleFileMode]);

  const handleInsertImage = useCallback(async () => {
    const allowed = await isImageInsertAllowed();
    if (!allowed) { toast.info(getImageInsertBlockMessage()); return; }
    try {
      const defaultPath = await pictureDir();
      const selected = await open({ multiple: false, defaultPath, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] });
      if (!selected || typeof selected !== 'string') return;
      const fileData = await readFile(selected);
      const fileName = selected.split(/[/\\]/).pop() || 'image.png';
      const base64Data = btoa(Array.from(fileData).map((byte) => String.fromCharCode(byte as number)).join(''));
      const result = await invoke<SaveImageResult>('save_image', { base64Data, filename: fileName, documentPath });

      const uploader = resolveImageUploader();
      if (uploader) {
        // Mark as uploading before insert so decoration picks it up on first render
        (ref as React.RefObject<TextoEditorRef>)?.current?.setImageUploading(result.relative_path);
        if (insertImageRef.current) insertImageRef.current(result.relative_path, result.filename);
        try {
          const remoteUrl = await uploader.upload(result.path);
          await preloadImage(remoteUrl);
          (ref as React.RefObject<TextoEditorRef>)?.current?.clearImageUploading(result.relative_path);
          (ref as React.RefObject<TextoEditorRef>)?.current?.replaceImageSrc(result.relative_path, remoteUrl);
          invoke('delete_file', { path: result.path }).catch(() => {});
        } catch {
          (ref as React.RefObject<TextoEditorRef>)?.current?.clearImageUploading(result.relative_path);
        }
      } else {
        if (insertImageRef.current) insertImageRef.current(result.relative_path, result.filename);
      }
    } catch (error) {
      logger.error('[MarkdownEditor] 插入图片失败:', error);
      toast.error(i18n.t('message.imageInsertFailed') || '插入图片失败');
    }
  }, [documentPath, isImageInsertAllowed]);

  if (!documentPath) {
    return <div ref={containerRef} id="writer" className={`markdown-editor empty-state-no-divider ${isRTLLanguage(i18n.language) ? 'editor-content-rtl' : ''}`} />;
  }

  // 编辑器始终整篇渲染：不做分块/窗口，保存、撤销与大纲都以全文为准。
  return (
    <TextoEditor
      ref={ref}
      editorMode={editorMode}
      content={content}
      onChange={handleChange}
      onSave={handleSave}
      onInsertImage={(callback) => { insertImageRef.current = callback; }}
      onInsertImageRequest={handleInsertImage}
      onInsertEmbedRequest={onInsertEmbed}
      appearance={appearance}
      codeBlockWordWrap={codeBlockWordWrap}
      showLineNumbers={showLineNumbers}
      readableLineLength={readableLineLength}
      typewriterEnabled={typewriterEnabled}
      scrollToLine={scrollToLine}
      scrollTrigger={scrollToTrigger}
      scrollToHeading={scrollToHeading}
      onOutlineChange={onOutlineChange}
      positionKey={positionKey}
      documentPath={documentPath}
      isSingleFileMode={isSingleFileMode}
      openableExtensions={openableExtensions}
      onOpenFileLink={onOpenFileLink}
      autoCapitalize={autoCapitalize}
      editable={editable}
      extraPlugins={extraPlugins}
      irHeader={irHeader}
      rtl={isRTLLanguage(i18n.language)}
    />
  );
});
