/**
 * app 注入给编辑器的宿主能力。编辑器不直接依赖骨架实现；
 * app 启动时调用 setEditorHost()。缺省时使用安全降级实现。
 */
import type { Language } from '@codemirror/language';
import type { PluginConfigReader } from '@texto/plugin-sdk';

export interface EditorDialogButton<T> {
  text: string;
  variant: 'primary' | 'secondary';
  value: T;
}

export interface EditorDialogOptions<T> {
  title: string;
  content?: string | HTMLElement;
  buttons: EditorDialogButton<T>[];
  dismissValue?: T;
  focusButtonIndex?: number;
}

export type SaveMediaSource =
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string; mimeType: string };

export interface SaveMediaRequest {
  source: SaveMediaSource;
  /** 含扩展名，如 mermaid.svg */
  suggestedName: string;
  /** 非 macOS 保存面板的筛选名，如 Image / SVG */
  filterName: string;
  /** 不带点，如 svg */
  extension: string;
}

export interface SaveMediaResult {
  /** false 表示用户取消；保存失败以 reject 表达。浏览器降级只表示已触发下载。 */
  saved: boolean;
  path?: string;
}

export type CodeLanguageSupport = (lang: string) => Language | null;

export interface EditorHost {
  /** 取当前生效的图片上传器；返回 null 表示仅本地保存。 */
  getImageUploader(): Promise<{ upload(filePath: string): Promise<string> } | null>;
  /** 把 Markdown 图片 src 解析成可显示的 URL（不可解析返回 null）。 */
  resolveImageSrc(src: string, documentDir: string | null): string | null;
  /** 应用级对话框渲染（选项与内容由编辑器给出）。 */
  showDialog<T>(options: EditorDialogOptions<T>): Promise<T>;
  /** 保存放大层里的媒体：宿主负责保存面板与写盘。 */
  saveMedia(request: SaveMediaRequest): Promise<SaveMediaResult>;
  /** 同步语言支持；能同步提供时使用。未注入返回 null。 */
  getCodeLanguageSupport?(lang: string): Language | null;
  /**
   * 异步加载语言支持。骨架用动态 import 提供，避免把 CodeMirror 语言包
   * 打进启动入口；SV 在 provider 就绪后重配语言扩展。
   */
  loadCodeLanguageSupport?(): Promise<CodeLanguageSupport | null>;
  /** 语法管线变化后重建编辑器状态（保留光标与滚动位置）。 */
  reloadSyntax?(): void;
  /**
   * 补做被推迟的语法重载（逐字插入 / 源码模式期间跳过的请求）。
   * 编辑器在逐字插入结束、取消插入等「条件解除」的时机调用。
   */
  flushPendingSyntaxReload?(): void;
  /**
   * 编辑器登记自己的重建函数，宿主在语法管线变化（插件贡献增删）时调用。
   * 返回注销函数；编辑器销毁时必须调用，避免打到已销毁的视图。
   * 返回 `false` 表示这次没有重建（源码模式 / 逐字插入进行中）。
   */
  registerSyntaxReloader?(reload: () => boolean): () => void;
  /**
   * 读取某个插件贡献所属插件的实时配置（`EditorContext.config` 的来源）。
   *
   * 契约方按「运行时插件设置 → 旧体系配置快照」的顺序自行回退；返回 `undefined`
   * 表示宿主没有该插件的配置，编辑器用空读取器兜底。**只能由宿主注入**——
   * 编辑器不允许直接 import 骨架的插件运行时（见 `check:editor-boundary`）。
   */
  readPluginConfig?(pluginId: string): PluginConfigReader | undefined;
}

/**
 * 未注入宿主时的图片路径降级：只有直链可直接显示；相对路径与绝对文件路径
 * 依赖宿主的 asset 协议（convertFileSrc）和文档目录，未注入时不可解析，故返回
 * null，让编辑器回落到编辑态。
 */
function defaultResolveImageSrc(src: string): string | null {
  if (
    src.startsWith('data:') ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('blob:') ||
    src.startsWith('tauri://') ||
    src.startsWith('asset://') ||
    src.startsWith('//')
  ) {
    return src;
  }
  return null;
}

/**
 * 无 Tauri 宿主时的保存降级：直接触发浏览器下载。
 * 浏览器没有目录选择能力，文件落到默认下载目录；桌面端由真实宿主接管。
 */
export async function downloadInBrowser(
  request: SaveMediaRequest,
): Promise<SaveMediaResult> {
  let blob: Blob;
  if (request.source.kind === 'text') {
    blob = new Blob([request.source.text], { type: request.source.mimeType });
  } else {
    const response = await fetch(request.source.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = request.suggestedName;
  anchor.style.display = 'none';
  try {
    if (!document.body) throw new Error('No document body');
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  return { saved: true };
}

let host: EditorHost = {
  getImageUploader: async () => null,
  resolveImageSrc: (src) => defaultResolveImageSrc(src),
  showDialog: async <T>(options: EditorDialogOptions<T>): Promise<T> =>
    options.dismissValue as T,
  saveMedia: downloadInBrowser,
  getCodeLanguageSupport: () => null,
  loadCodeLanguageSupport: async () => null,
};

/** app 启动时注入宿主能力。 */
export function setEditorHost(next: EditorHost): void {
  host = next;
}

export function getEditorHost(): EditorHost {
  return host;
}
