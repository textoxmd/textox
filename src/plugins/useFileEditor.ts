import { useMemo, useRef, type MutableRefObject } from 'react';

import { fileEditorCapabilities, type FileEditorCapabilities } from './fileEditorCapabilities';
import { resolveFileEditorWithOwner } from './registry';
import type { FileEditorContribution, FileEditorHandle } from './types';

export interface ActiveFileEditor extends FileEditorCapabilities {
  /** 当前文件对应的编辑器贡献（Markdown 等骨架编辑器为 null） */
  contribution: FileEditorContribution | null;
  /** 当前编辑器贡献所属插件 id（无贡献时为 null），用于绑定该插件的 host */
  pluginId: string | null;
  /** 骨架持有的通用句柄 ref，交给 FileEditorHost 下的插件组件写入 */
  ref: MutableRefObject<FileEditorHandle | null>;
}

/**
 * 按当前文件解析活动的文件类型编辑器，返回其贡献、所属插件 id、通用句柄 ref 与能力开关。
 * Markdown 等由骨架自身渲染的文件不注册贡献，返回 contribution=null（能力为默认）。
 *
 * 返回对象整体 memo：下游可能把它放进 effect 依赖。
 * ref 的清理由宿主/插件组件负责（编辑器卸载时插件组件把 handleRef.current 置空）。
 */
export function useFileEditor(currentFile: string | null): ActiveFileEditor {
  const resolved = useMemo(() => resolveFileEditorWithOwner(currentFile), [currentFile]);
  const ref = useRef<FileEditorHandle | null>(null);
  return useMemo(
    () => ({
      contribution: resolved?.contribution ?? null,
      pluginId: resolved?.pluginId ?? null,
      ref,
      ...fileEditorCapabilities(resolved?.contribution ?? null),
    }),
    [resolved, ref],
  );
}
