import { invoke } from '@tauri-apps/api/core';

/**
 * 判别联合：`temp` / `file` 必然带内容，`directory` / `missing` 不带内容。
 * 后端 `open_document` 对可读文件总是返回 `content: Some(..)`，见 `src-tauri/src/document.rs`。
 */
export type OpenDocumentResult =
  | { kind: 'temp' | 'file'; content: string }
  | { kind: 'directory'; content?: null }
  | { kind: 'missing'; content?: null };

/** 冷启动打开文档：一次 IPC 完成 temp 判定、类型判定与内容读取。 */
export function openDocument(path: string): Promise<OpenDocumentResult> {
  return invoke<OpenDocumentResult>('open_document', { path });
}

/**
 * 打开文档；`missing` 转成异常（与旧 `check_path_type` 的 reject 语义一致），
 * 其余 kind 原样返回。调用方据此分支。
 */
export async function openDocumentOrThrow(
  path: string,
): Promise<Exclude<OpenDocumentResult, { kind: 'missing' }>> {
  const doc = await openDocument(path);
  if (doc.kind === 'missing') throw new Error(`File not found: ${path}`);
  return doc;
}
