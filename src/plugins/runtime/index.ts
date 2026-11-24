import {
  isValidPluginId,
  Plugin,
  validateManifest,
  type PluginApp,
  type PluginManifest,
} from '@textox/plugin-sdk';
import { toast } from 'sonner';

import { createPluginApp, type PluginHostDeps } from './app';
import { unregisterOwnerContributions } from './deps';
import { pluginIpc, type InstalledPluginDto } from './ipc';
import { loadPluginClass } from './loader';
import { PluginRegistry } from './registry';
import { PluginStateStore } from './state';

export const pluginRegistry = new PluginRegistry();
export const pluginState = new PluginStateStore();

export type { PluginStatus, RuntimeEntry } from './state';

interface LoadedPlugin {
  instance: Plugin;
  /** 宿主句柄（契约面 + `dispose`）：`stopPlugin` 时释放设置订阅者与 `plugin:data-changed` 监听。 */
  app: PluginApp & { dispose(): void };
  removeStyles: () => void;
}

const loaded = new Map<string, LoadedPlugin>();

let runtimeDeps: PluginHostDeps | null = null;
// 由 `initPluginRuntime` 注入，生产路径为空；仅测试/将来的 dev 目录用它覆盖 importer 与超时
let runtimeOptions: StartPluginOptions = {};

const DEFAULT_ONLOAD_TIMEOUT_MS = 10_000;

export interface StartPluginOptions {
  /** 覆盖模块 import；默认走 `plugin_read_asset` + blob URL。测试与将来的 dev 目录用它。 */
  importModule?: (pluginId: string) => Promise<{ default?: unknown }>;
  /** onload 超时，默认 10s；测试用短值。 */
  onloadTimeoutMs?: number;
}

/** `atob` 返回 latin1 字符串，`charCodeAt` 与原始字节一一对应；非法输入由 `atob` 抛错，由上层收敛。 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 插件目录里由构建期产出的本地化资源（`dist/locales.json`）。 */
interface PluginLocalesFile {
  defaultLocale?: string;
  locales?: Record<string, Record<string, unknown>>;
}

const LOCALES_ASSET = 'locales.json';

/**
 * 注入插件自带的本地化资源，**不依赖插件是否加载**。
 *
 * 插件的 `addMessages` 只在 `onload` 里执行，而默认停用的插件根本不会被加载：
 * 设置页会退化成清单里的英文名与裸 key。因此构建期额外产出 `locales.json`，
 * 扫描后统一注入；缺失该文件（旧包）时静默跳过，仍由 `onload` 自注入。
 */
async function injectPluginLocales(entry: InstalledPluginDto): Promise<void> {
  try {
    const base64 = await pluginIpc.readAsset(entry.id, LOCALES_ASSET);
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64(base64))) as PluginLocalesFile;
    const locales = parsed.locales;
    if (!locales || typeof locales !== 'object' || Array.isArray(locales)) return;
    const { registerPluginMessages } = await import('@/i18n');
    await registerPluginMessages(entry.id, locales as never, parsed.defaultLocale);
  } catch {
    // 没有 locales.json：旧包或读取失败，不影响插件本身
  }
}

/** 逐个注入（并行）；单个失败不影响其它插件与启动链。 */
async function injectAllPluginLocales(entries: readonly InstalledPluginDto[]): Promise<void> {
  await Promise.allSettled(entries.map((entry) => injectPluginLocales(entry)));
}

async function importPluginModule(pluginId: string): Promise<{ default?: unknown }> {
  const base64 = await pluginIpc.readAsset(pluginId, 'main.js');
  // TS 5.7 起 `Uint8Array<ArrayBufferLike>` 与 `BlobPart` 不兼容，此 cast 是必要的。
  // 若将来启用 CSP，需要放行 `script-src blob:`（否则 blob 模块无法执行）。
  const blob = new Blob([decodeBase64(base64) as unknown as BlobPart], {
    type: 'text/javascript',
  });
  const url = URL.createObjectURL(blob);
  try {
    return (await import(/* @vite-ignore */ url)) as { default?: unknown };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function injectStyles(pluginId: string, css: string): () => void {
  const element = document.createElement('style');
  element.dataset.plugin = pluginId;
  element.textContent = css;
  document.head.appendChild(element);
  return () => {
    element.remove();
  };
}

function isPluginClass(value: unknown): boolean {
  return typeof value === 'function' && value.prototype instanceof Plugin;
}

/** 模块能导入但默认导出不是插件类时的可诊断消息（判定点只有 `loadPluginClass` 一处）。 */
function describeInvalidExport(value: unknown): string {
  if (typeof value !== 'function') return 'default export is not a function';
  return 'class does not extend the host Plugin (did the bundle inline @textox/plugin-sdk?)';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `Promise.race` + 清理定时器；超时也走 onload 失败的回滚分支。 */
function withTimeout<T>(promise: Promise<T>, ms: number, pluginId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`onload timed out after ${ms}ms (${pluginId})`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 加载并启动一个已启用插件。清单缺失/不匹配、模块无效、`onload` 抛错或超时都会记为
 * `load-failed` 并回滚本插件已注册的贡献；**永不向外抛错**。
 */
export async function startPlugin(
  entry: InstalledPluginDto,
  deps: PluginHostDeps,
  options: StartPluginOptions = {},
): Promise<void> {
  let instance: Plugin | null = null;
  let app: (PluginApp & { dispose(): void }) | null = null;
  let removeStyles: (() => void) | null = null;

  // 幂等回滚：dispose / disposeOwner / 扩展点清理均可重复调用
  const rollback = async (): Promise<void> => {
    removeStyles?.();
    removeStyles = null;
    instance?.dispose();
    instance = null;
    // onload 失败时 app 已经被创建（订阅已挂上），同样要释放
    app?.dispose();
    app = null;
    loaded.delete(entry.id);
    pluginRegistry.disposeOwner(entry.id);
    // 插件自己没释放的扩展点贡献也要清掉，否则失败重试会不断追加
    await unregisterOwnerContributions(entry.id);
  };

  try {
    const manifest = entry.manifest;
    if (!manifest) {
      pluginState.markFailed(entry.id, 'manifest is missing');
      return;
    }
    if (manifest.id !== entry.id) {
      // Rust 扫描/安装都要求二者一致（不一致时 entry.error 非空）；这里再兜一层，
      // 避免 IPC 用清单 id、注册表用目录名导致两套键。
      pluginState.markFailed(
        entry.id,
        `manifest id ${manifest.id} does not match directory ${entry.id}`,
      );
      return;
    }

    const data = await pluginIpc.readData(manifest.id);
    const importModule = options.importModule ?? importPluginModule;

    // 判定点只有 loadPluginClass 一处；失败时用捕获到的模块生成可诊断消息
    let capturedModule: { default?: unknown } | undefined;
    const loadedClass = await loadPluginClass<
      new (app: PluginApp, manifest: PluginManifest) => Plugin
    >({
      importModule: async () => {
        capturedModule = await importModule(manifest.id);
        return capturedModule;
      },
      isPluginClass,
    });

    if (!loadedClass.ok) {
      pluginState.markFailed(
        entry.id,
        loadedClass.failure === 'invalid-export'
          ? describeInvalidExport(capturedModule?.default)
          : loadedClass.message,
      );
      return;
    }

    // 设置字段一律取自清单（`manifest.settings`，0.2.0 起不再读插件类的静态字段）
    app = createPluginApp({ manifest, registry: pluginRegistry, deps, data });

    instance = new loadedClass.value(app, manifest);

    const styleBase64 = await pluginIpc.readAsset(manifest.id, 'styles.css').catch(() => null);
    if (styleBase64) {
      removeStyles = injectStyles(manifest.id, new TextDecoder().decode(decodeBase64(styleBase64)));
    }

    await withTimeout(
      Promise.resolve(instance.onload()),
      options.onloadTimeoutMs ?? DEFAULT_ONLOAD_TIMEOUT_MS,
      manifest.id,
    );

    loaded.set(entry.id, { instance, app, removeStyles: removeStyles ?? (() => {}) });
    pluginState.markStatus(entry.id, 'enabled');
  } catch (error) {
    await rollback();
    pluginState.markFailed(entry.id, describe(error));
  }
}

/**
 * 停用一个已加载插件；幂等（未加载时仍会清理注册表与状态）。
 * 只做运行态清理，**不修改**持久化开关；需要同步 `plugins.json` 请走 `disablePlugin`。
 */
export async function stopPlugin(pluginId: string): Promise<void> {
  const record = loaded.get(pluginId);
  if (record) {
    try {
      await record.instance.onunload?.();
    } catch (error) {
      console.warn(`[plugin] ${pluginId} onunload failed`, error);
    }
    record.instance.dispose();
    record.app.dispose();
    record.removeStyles?.();
    loaded.delete(pluginId);
  }
  pluginRegistry.disposeOwner(pluginId);
  // 插件忘了在 onunload 里 dispose 时，贡献也不能留到重启 / 下次启用
  await unregisterOwnerContributions(pluginId);
  pluginState.markStatus(pluginId, 'installed');
}

/**
 * 是否已加载并运行。`loaded`（运行态）是唯一真源；`pluginState.status` 只是 UI 展示的派生值，
 * 重扫（`initPluginRuntime`）不会自动停掉已不在 enabled 列表里的插件。
 */
export function isPluginRunning(pluginId: string): boolean {
  return loaded.has(pluginId);
}

/** 内置插件（随应用分发）的 id 前缀；安全模式只允许它们运行。 */
export function isBuiltinPluginId(pluginId: string): boolean {
  return pluginId.startsWith('app.textox.');
}

/** 面板用：初始化完成后才能启停插件。 */
export function getRuntimeDeps(): PluginHostDeps {
  if (!runtimeDeps) {
    throw new Error('plugin runtime is not initialized (call initPluginRuntime first)');
  }
  return runtimeDeps;
}

/**
 * 面板用：先持久化启用状态，再加载插件（顺序由运行时保证，UI 不必自己拼）。
 * `getRuntimeDeps()` 放在最前：未初始化时直接失败，不会先落盘 true 再抛错。
 */
export async function enablePlugin(entry: InstalledPluginDto): Promise<void> {
  const deps = getRuntimeDeps();
  if (pluginState.isSafeMode() && !isBuiltinPluginId(entry.id)) {
    throw new Error('safe mode is enabled: only built-in plugins can be enabled');
  }
  await pluginIpc.setEnabled(entry.id, true);
  pluginState.markEnabled(entry.id, true);
  await startPlugin(entry, deps, runtimeOptions);
  // 设置窗口与编辑器窗口是两套 WebView：这里只影响本窗口的内存态
  toast.info('编辑器窗口需重启 Textox 后加载该插件');
}

/** 重新扫描磁盘并把结果灌进 pluginState（安装/卸载后调用）。 */
export async function refreshPlugins(): Promise<void> {
  const [plugins, state] = await Promise.all([pluginIpc.scan(), pluginIpc.getState()]);
  await injectAllPluginLocales(plugins);
  pluginState.setSnapshot(plugins, state);
}

/** 从本地 .zip 安装插件，成功后刷新列表；返回最新的插件列表。 */
export async function installPluginFromFile(path: string): Promise<InstalledPluginDto[]> {
  // 覆盖安装时，运行中的旧实例必须停掉：否则面板显示「已启用」但跑的是旧模块
  const runningBefore = [...loaded.keys()];
  const installed = await pluginIpc.installFromFile(path);
  for (const pluginId of runningBefore) {
    await stopPlugin(pluginId);
  }
  await refreshPlugins();
  toast.info('编辑器窗口需重启 Textox 后加载该插件');
  return installed;
}

/** 卸载插件（先停掉运行中的实例，避免残留注册与样式）。 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  await stopPlugin(pluginId);
  await pluginIpc.uninstall(pluginId);
  await refreshPlugins();
}

/** 面板用：先持久化停用状态，再卸载并清理贡献。 */
export async function disablePlugin(pluginId: string): Promise<void> {
  await pluginIpc.setEnabled(pluginId, false);
  pluginState.markEnabled(pluginId, false);
  await stopPlugin(pluginId);
}

/** 启动链：先播种出厂插件，拉一次快照，再串行启动所有应当加载的插件（v1 不并发）。 */
export async function initPluginRuntime(
  deps: PluginHostDeps,
  options: StartPluginOptions = {},
): Promise<void> {
  runtimeDeps = deps;
  runtimeOptions = options;
  // 播种必须先完成再扫描：scan 只读目录，看不到还没复制的出厂插件。
  try {
    await pluginIpc.seedBundled();
  } catch (error) {
    // 非 Tauri 环境或打包遗漏时没有该命令：降级为无出厂插件，不阻断启动
    console.warn('[plugin] seed bundled plugins failed', error);
  }
  const [plugins, state] = await Promise.all([pluginIpc.scan(), pluginIpc.getState()]);
  // 先注入本地化资源：默认停用的插件不会 onload，设置页需要这份文案
  await injectAllPluginLocales(plugins);
  pluginState.setSnapshot(plugins, state);

  for (const entry of plugins) {
    if (!entry.enabled) continue;
    if (entry.error) {
      pluginState.markFailed(entry.id, entry.error);
      continue;
    }
    if (state.safe_mode && !isBuiltinPluginId(entry.id)) {
      pluginState.markStatus(entry.id, 'blocked');
      continue;
    }
    if (!isValidPluginId(entry.id)) {
      pluginState.markFailed(entry.id, 'invalid plugin id');
      continue;
    }
    if (!entry.manifest) {
      pluginState.markFailed(entry.id, 'manifest is missing');
      continue;
    }
    if (!validateManifest(entry.manifest).ok) {
      pluginState.markFailed(entry.id, 'invalid manifest.json');
      continue;
    }

    try {
      await startPlugin(entry, deps, options);
    } catch (error) {
      // 纵深防御：startPlugin 已保证不外抛，这里兜住将来改动引入的漏网异常
      pluginState.markFailed(entry.id, describe(error));
      pluginRegistry.disposeOwner(entry.id);
    }
  }
}

/**
 * @internal 仅测试使用：清空已加载插件与状态快照。
 * 刻意不改 `PluginStateStore` / `PluginRegistry` 的 API（跨任务改动），
 * 而是用公开方法把单例恢复到初始态。
 */
export async function resetPluginRuntimeForTests(): Promise<void> {
  for (const pluginId of [...loaded.keys()]) {
    await stopPlugin(pluginId);
  }
  loaded.clear();
  runtimeDeps = null;
  runtimeOptions = {};
  pluginState.setSnapshot([], { safe_mode: false, enabled: [] });
  for (const element of document.querySelectorAll('style[data-plugin]')) {
    element.remove();
  }
}

// 宿主桥接的构造器单独放在 deps.ts（内部用动态 import 拉旧体系模块），
// 这里只做转发，保证 `runtime/index` 的静态依赖保持轻量（面板/测试都 import 它）。
export { createHostDeps, resetHostDepsForTests, setHostDepsBuilderForTests } from './deps';
