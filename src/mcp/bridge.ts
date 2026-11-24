import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '@/utils/logger';

/** Rust 侧 `mcp-rpc` 事件载荷（见 src-tauri/src/mcp.rs）。 */
interface McpRpcRequest {
  id: number;
  method: string;
  params: Record<string, unknown> | null;
  /** 目标窗口 label：Tauri 的 JS 监听默认收全量事件，非目标窗口必须自行忽略。 */
  target?: string;
}

/** 前端应答：Rust 按 id 唤醒等待中的 HTTP 请求。 */
interface McpRpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  /** 回包的窗口 label：多窗口下 Rust 只认目标窗口的应答。 */
  window: string;
}

/** 文本位置：行 1 起、列 1 起（对外统一口径，编辑器内部列从 0 起由编辑器自行换算）。 */
export interface McpTextPoint {
  line: number;
  column: number;
}

/** 工作区内新建文件 / 文件夹（path 可为绝对路径，也可为相对工作区根目录的路径）。 */
export interface McpCreateEntryRequest {
  kind?: 'file' | 'folder';
  path: string;
  content?: string;
  /** 新建文件后是否在主窗口打开（默认 false，避免打断用户当前文档） */
  open?: boolean;
}

export interface McpBridgeHandlers {
  /** 当前文档快照（路径 / Markdown / 未保存状态 / 模式 / 选区 / 工作区）。 */
  getActiveDocument: () => Record<string, unknown>;
  /** 插入文本；给了 at 就先移动光标。默认逐字（打字机）呈现，stream=false 时整段插入。 */
  insertText: (
    text: string,
    at?: McpTextPoint,
    stream?: boolean,
  ) => Record<string, unknown> | null;
  /** 移动光标 / 设置选区。返回落点。 */
  setSelection: (
    start: McpTextPoint,
    end?: McpTextPoint,
  ) => Record<string, unknown> | null;
  /** 整篇替换 Markdown（普通编辑事务：会上报变更、可撤销、不自动保存）。 */
  replaceDocument: (markdown: string) => Record<string, unknown> | null;
  /** 在当前工作区新建文件 / 文件夹。 */
  createEntry: (request: McpCreateEntryRequest) => Promise<Record<string, unknown>>;
}

function parsePoint(value: unknown, field: string): McpTextPoint {
  if (!value || typeof value !== 'object') throw new Error(`缺少参数 ${field}`);
  const record = value as Record<string, unknown>;
  const line = record.line;
  const column = record.column;
  if (typeof line !== 'number' || typeof column !== 'number') {
    throw new Error(`${field} 需要 { line, column } 两个数字`);
  }
  return { line, column };
}

/**
 * 订阅 Rust 侧 MCP 服务的桥接请求。
 *
 * 每个承载编辑器的窗口都会订阅，但 Rust 只把请求投递给**一个**目标窗口
 * （默认当前聚焦窗口，见 `mcp::resolve_window`）；应答里带上本窗口 label，
 * 让 Rust 能校验回包来源。返回注销函数。
 */
export async function listenMcpRpc(handlers: McpBridgeHandlers): Promise<() => void> {
  const self = getCurrentWindow().label;
  return listen<McpRpcRequest>('mcp-rpc', async (event) => {
    const { id, method, params, target } = event.payload;
    // 多窗口下事件可能被所有窗口收到，只处理明确发给本窗口的请求。
    if (target && target !== self) return;
    try {
      let result: unknown;
      switch (method) {
        case 'activeDocument':
          result = handlers.getActiveDocument();
          break;
        case 'insertText': {
          const text = typeof params?.text === 'string' ? params.text : '';
          if (!text) throw new Error('text 不能为空');
          const at =
            params?.line != null && params?.column != null
              ? parsePoint({ line: params.line, column: params.column }, 'insertText')
              : undefined;
          const stream = params?.stream === false ? false : true;
          result = handlers.insertText(text, at, stream) ?? { inserted: text.length };
          break;
        }
        case 'setSelection': {
          const start = parsePoint(params?.start, 'start');
          const end = params?.end != null ? parsePoint(params.end, 'end') : undefined;
          result = handlers.setSelection(start, end) ?? { moved: false };
          break;
        }
        case 'replaceDocument': {
          const markdown = typeof params?.markdown === 'string' ? params.markdown : null;
          if (markdown == null) throw new Error('缺少参数 markdown');
          result = handlers.replaceDocument(markdown) ?? { replaced: false };
          break;
        }
        case 'createEntry':
          result = await handlers.createEntry(params as unknown as McpCreateEntryRequest);
          break;
        default:
          throw new Error(`未知的 MCP 方法: ${method}`);
      }
      const response: McpRpcResponse = { id, ok: true, result, window: getCurrentWindow().label };
      await emit('mcp-rpc-response', response);
    } catch (error) {
      logger.warn('[mcp] bridge request failed', method, error);
      const response: McpRpcResponse = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        window: getCurrentWindow().label,
      };
      await emit('mcp-rpc-response', response);
    }
  });
}
