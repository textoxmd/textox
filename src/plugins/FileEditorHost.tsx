import { Suspense, lazy, useMemo, type MutableRefObject } from 'react';

import { PluginErrorBoundary } from './PluginErrorBoundary';
import type { FileEditorContribution, FileEditorHandle, PluginHost } from './types';

interface FileEditorHostProps {
  contribution: FileEditorContribution;
  fileEditorRef: MutableRefObject<FileEditorHandle | null>;
  host: PluginHost;
  /** 活动文件路径；非活动（隐藏保留）时为 null */
  filePath: string | null;
  isTemp: boolean;
  editable: boolean;
  onModifiedChange: (modified: boolean) => void;
  onPathChange: (path: string) => void;
}

/** 懒加载并渲染当前文件类型编辑器的贡献，把通用句柄 ref 交给插件组件。 */
export function FileEditorHost({
  contribution,
  fileEditorRef,
  host,
  filePath,
  isTemp,
  editable,
  onModifiedChange,
  onPathChange,
}: FileEditorHostProps) {
  const Editor = useMemo(() => lazy(contribution.load), [contribution]);
  return (
    <PluginErrorBoundary>
      <Suspense fallback={<div className="plugin-editor-loading">Loading…</div>}>
        <Editor
          filePath={filePath}
          isTemp={isTemp}
          editable={editable}
          onModifiedChange={onModifiedChange}
          onPathChange={onPathChange}
          host={host}
          handleRef={fileEditorRef}
        />
      </Suspense>
    </PluginErrorBoundary>
  );
}
