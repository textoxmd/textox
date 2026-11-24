// 未保存文件信息
export interface TempFile {
  path: string;
  created_at: number;
}

export type FileHandle =
  | { kind: 'none' }
  | { kind: 'temp'; path: string }
  | { kind: 'persistent'; path: string; displayName: string }

// 大纲样式归一化：仅 text/minimap 为有效值，其余（含 off/空）一律视为关闭
export type OutlineStyle = 'off' | 'text' | 'minimap';
