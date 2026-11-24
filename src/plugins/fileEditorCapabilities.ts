import type { FileEditorContribution } from './types';

export interface FileEditorCapabilities {
  /** 编辑器自行保存（含临时文件另存为），骨架不参与写盘 */
  customSave: boolean;
  /** 编辑器自行处理外部修改 */
  externalModify: boolean;
  /** 是否允许导出/打印（默认允许；显式 false 表示禁用） */
  exportable: boolean;
}

/** 把（可能为空的）文件编辑器贡献归一为骨架消费的能力开关。 */
export function fileEditorCapabilities(
  contribution: FileEditorContribution | null | undefined,
): FileEditorCapabilities {
  return {
    customSave: contribution?.capabilities?.customSave === true,
    externalModify: contribution?.capabilities?.externalModify === true,
    exportable: contribution?.capabilities?.exportable !== false,
  };
}
