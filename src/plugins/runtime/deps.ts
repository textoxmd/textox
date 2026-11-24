import {
  toDisposable,
  type AgentCapability,
  type Disposable,
  type EmbedBridgeOptions,
  type EmbedNodeLike,
  type FileEditorBridgeOptions,
  type PluginDialogsApi,
  type PluginExporter,
  type PluginImageUploader,
  type PluginThemeApi,
} from '@textox/plugin-sdk';

import type { Contributes, PluginHost } from '@texto/plugin-sdk';
import type {
  EditorContext,
  EditorExtension,
  EditorExtensionResult,
  InsertCommandMeta,
} from '@texto/markdown-editor-api';
import type { Node as PMNode } from 'prosemirror-model';

import { requestSyntaxReload } from '@/editor/syntaxReload';
import { syncEditorInsertSurfaces } from '@/plugins/editorInsertSurfaces';

import type { PluginHostDeps } from './app';
import { createEditorBridge, scopeLocalizedKeys } from './editorBridge';

/** 文本桥接：`insertText` 在旧体系里没有等价能力（旧宿主只有 insertImageRef），保留占位。 */
const NOOP_INSERT_TEXT = (): boolean => false;

/** 嵌入分发扩展的固定 owner（不属于任何插件）。 */
const EMBED_DISPATCH_OWNER = 'plugin-runtime';

/**
 * 扩展点贡献的去重键：`id` 优先、缺省用 `name`。
 * 必须与 `@texto/plugin-sdk` 的 `registerContributions` 内部规则一致，否则注销定位不到条目。
 */
function contributionKeyOf(value: unknown): string | undefined {
  const record = value as { id?: string; name?: string } | null;
  return record?.id ?? record?.name;
}

/**
 * 无键贡献的合成 id 序号。只用于让「本来不可定位」的贡献变得可注销：
 * 同一个值只需要在**同一次登记**里自洽（登记与注销共用同一个 id），无需跨次可预测。
 */
let keylessSeq = 0;

/**
 * 给无 `id` / `name` 的贡献补一个合成 `id`（如 `SyntaxHighlightContribution` 形状只有
 * `languages`）。消费方只读自己的字段，多一个 `id` 无害；没有它时 SDK 既不去重，
 * `unregisterContribution` 也定位不到条目，贡献会永久留在全局表里。
 */
export function withContributionKey(value: unknown, pointId: string, ownerId: string): unknown {
  if (contributionKeyOf(value) !== undefined) return value;
  // 贡献契约都是对象；非对象无法附加字段，原样交给 SDK（保持既有行为）
  if (typeof value !== 'object' || value === null) return value;
  keylessSeq += 1;
  return {
    ...(value as Record<string, unknown>),
    id: `runtime.keyless.${ownerId}.${pointId}.${keylessSeq}`,
  };
}

/** SDK 扩展点注册表的最小面：生产由 `@texto/plugin-sdk` 提供，测试可注入真实实现。 */
export interface ContributionRegistry {
  registerContributions(ownerId: string, contributes: Contributes | undefined): void;
  unregisterContribution(pointId: string, ownerId: string, key: string): void;
}

/**
 * 构造可逆的编辑器贡献登记器：登记前给无键贡献补合成 id，注销时用同一个 id 定位。
 *
 * SDK 未导出内部去重键函数，这里按同一规则（`id ?? name`）定位；经 `withContributionKey`
 * 补过 id 的贡献也能单条注销（此前是空操作，贡献会永久留在全局表）。
 */
export function createContributionRegistrar(sdk: ContributionRegistry) {
  return (pointId: string, value: unknown, ownerId: string): Disposable => {
    const keyed = withContributionKey(value, pointId, ownerId);
    sdk.registerContributions(ownerId, { [pointId]: [keyed] });
    const key = contributionKeyOf(keyed);
    return toDisposable(() => {
      if (key !== undefined) sdk.unregisterContribution(pointId, ownerId, key);
    });
  };
}

/** 是否已有一轮重建排进了微任务（同一同步批次内的后续请求直接并入）。 */
let reloadScheduled = false;

/**
 * 同一轮同步批处理内只重建一次；实际重建推迟到微任务。
 *
 * 外部插件装载/卸载是同步批处理（例如 `app.textox.mkdext` 一次装配 12 个语法特性，
 * 就是 12 次登记 + 每次释放各一次注销）。逐次重建会让编辑器连续 `view.destroy()` 并
 * 重建全文、反复恢复选区/滚动，表现为界面闪烁、卡顿，正在输入的 IME 也会被打断。
 *
 * 推迟用微任务而不是定时器：微任务在当前任务结束后立刻执行，仍在同一帧内，
 * 不会把首屏看到的语法推迟到下一帧之后。重建本身走 `requestSyntaxReload()`，
 * 因此「尚无 reloader / 逐字插入中」的 pending 语义完全不变。
 */
function scheduleSyntaxReload(): void {
  if (reloadScheduled) return;
  reloadScheduled = true;
  queueMicrotask(() => {
    reloadScheduled = false;
    requestSyntaxReload();
  });
}

/**
 * 贡献增删后先对齐快捷键派生表（`SHORTCUT_IDS` / `DEFAULT_SHORTCUTS` /
 * `SHORTCUT_ACTIONS`），再调度编辑器重建。
 *
 * 同步失败只记日志：一张配置表没对上不能阻断编辑器按新贡献重建
 * （否则插入命令本身也看不到）。顺序在重建之前也有意义——重建后快捷键分派
 * 立刻就要用最新的 id 集合。快捷键表每批都同步（幂等且开销小），
 * 只有重建这一步按批合并。
 */
function syncInsertSurfacesAndReload(): void {
  try {
    syncEditorInsertSurfaces();
  } catch (error) {
    console.warn('[plugin] sync editor insert shortcut surfaces failed', error);
  }
  scheduleSyntaxReload();
}

/**
 * 按 owner 清空该插件在全部扩展点上的贡献，并请求一次编辑器重建。
 *
 * `stopPlugin` 与 onload 失败回滚都会调用：插件忘了在 `onunload` 里 dispose 时，
 * 贡献也不会泄漏到下次启用（否则禁用/启用循环会无界追加）。
 */
export async function unregisterOwnerContributions(ownerId: string): Promise<void> {
  try {
    const sdk = await import('@texto/plugin-sdk');
    sdk.unregisterOwner(ownerId);
    // 命令已被撤掉：快捷键表也要跟着撤，否则会留下点不动的表项
    syncInsertSurfacesAndReload();
  } catch (error) {
    console.error('[plugin] clear extension point contributions failed', { ownerId, error });
  }
}

let cached: Promise<PluginHostDeps> | null = null;
// 仅测试：替换 builder 以验证「失败后可重试」，避免用模块 mock 污染后续用例
let buildOverride: (() => Promise<PluginHostDeps>) | null = null;

/**
 * 把新运行时的桥接能力接到旧体系：
 * - `registerEmbed` → 单个 `image_ref` 分发扩展 + 实时 Map（`Disposable` 立即生效）
 * - `registerFileEditor` → `app:fileEditor` 贡献（注销需重启，T2b 处理）
 * - `createNewDocument` → `App` 注入的宿主依赖（`getInstalledHostDeps().createNewDocument`）
 * - `addMessages` → `registerPluginMessages`（`plugins` 命名空间，顶层键为插件 id）
 * - `parseEmbedRef` → 宿主的引用语法解析（避免插件自带副本漂移）
 */
export function createHostDeps(): Promise<PluginHostDeps> {
  cached ??= (buildOverride ? buildOverride() : buildHostDeps()).catch((error: unknown) => {
    // 首次构建失败不应永久污染：清掉缓存，允许下次重试。
    cached = null;
    throw error;
  });
  return cached;
}

/** @internal 仅测试：清掉 memoize，验证重建与失败重试。 */
export function resetHostDepsForTests(): void {
  cached = null;
  buildOverride = null;
}

/** @internal 仅测试：注入自定义 builder（用于制造构建失败，不触碰模块 mock）。 */
export function setHostDepsBuilderForTests(
  builder: (() => Promise<PluginHostDeps>) | null,
): void {
  buildOverride = builder;
  cached = null;
}

async function buildHostDeps(): Promise<PluginHostDeps> {
  const [
    sdk,
    editorApi,
    appApi,
    i18nModule,
    hostModule,
    agentModule,
    exportRegistry,
    exportMenu,
    themeModule,
    quickSettingsModule,
    highlightModule,
    platformModule,
    dialogModule,
  ] = await Promise.all([
    import('@texto/plugin-sdk'),
    import('@texto/markdown-editor-api'),
    import('@texto/app-api'),
    import('@/i18n'),
    import('@/plugins/host'),
    import('@/agent/capability'),
    import('@/utils/export/registry'),
    import('@/app/menu/exportMenu'),
    import('@/components/styles/theme'),
    import('@/components/styles/theme-quick-settings'),
    import('@/components/TextoEditor/src/highlight-theme'),
    import('@/utils/platform'),
    // 原生对话框：非 Tauri 环境下面的实现会绕开它（浏览器里调用会直接抛）
    import('@tauri-apps/plugin-dialog'),
  ]);

  // 单次导入后桥接方法与旧体系同步调用（不留「登记完成」的异步窗口）：
  // 导出器的 dispose 必须立刻从注册表消失，否则禁用插件后仍能被导出一遍。
  const syncExportMenu = (): void => {
    // 非 Tauri 环境（浏览器 dev / 单测）没有原生菜单，`invoke` 会 reject：吞掉即可
    void exportMenu.syncExportMenu().catch(() => {});
  };

  // 单条可逆的扩展点登记器：登记时补合成 id，注销时按同一键定位（编辑器贡献与图床共用）
  const registerContribution = createContributionRegistrar(sdk);

  // 实时表：分发扩展在 nodeView 创建时读取，因此 dispose 立即生效（无需重启）
  const embeds = new Map<string, EmbedBridgeOptions>();
  // 文件编辑器注销需要旧体系支持移除贡献，本轮只记录（T2b 处理）
  const fileEditors = new Map<string, FileEditorBridgeOptions>();
  let dispatcherRegistered = false;

  const toLike = (node: {
    textContent: string;
    attrs: Record<string, unknown>;
    type: { name: string };
  }): EmbedNodeLike => ({
    textContent: node.textContent,
    attrs: node.attrs,
    type: node.type.name,
  });

  /** 把插件的预览区适配成编辑器的 `PreviewRegion`（含 `update` 转发）。 */
  function createPreviewRegion(options: EmbedBridgeOptions, node: PMNode) {
    let region = options.createPreview(toLike(node));
    const dom = document.createElement('div');
    region.render(dom);
    return {
      dom,
      update: (next: PMNode) => {
        const like = toLike(next);
        if (region.update) {
          region.update(like);
          return;
        }
        // 实现方没提供 update：销毁后按新节点重建（避免继续显示上一个 src 的内容）
        region.destroy?.();
        dom.replaceChildren();
        region = options.createPreview(like);
        region.render(dom);
      },
      destroy: () => region.destroy?.(),
    };
  }

  /** 只注册一次分发扩展：它读实时 Map，因此后注册/释放都立即生效。 */
  function ensureEmbedDispatcher(): void {
    if (dispatcherRegistered) return;
    dispatcherRegistered = true;
    const dispatcher: EditorExtension = {
      id: 'runtime.embeds',
      create: (ctx: EditorContext): EditorExtensionResult => ({
        nodeViews: {
          image_ref: (node: PMNode, view, getPos, decorations) => {
            const ref = editorApi.parseEmbedRef(node.textContent);
            if (!ref) return null;
            // 注册顺序即优先级：第一个匹配的插件接管
            const options = [...embeds.values()].find((item) => item.matches(ref.src));
            if (!options) return null;
            return ctx.views.embed({
              node,
              view,
              getPos,
              decorations,
              preview: createPreviewRegion(options, node),
            });
          },
        },
      }),
    };
    sdk.registerContributions(EMBED_DISPATCH_OWNER, {
      [editorApi.MARKDOWN_EDITOR_EXTENSION]: [dispatcher],
    });
  }

  function registerEmbed(options: EmbedBridgeOptions, ownerId: string): Disposable {
    if (embeds.has(options.id)) {
      console.warn(`[plugin] duplicate embed id ${options.id} (owner ${ownerId})`);
    }
    embeds.set(options.id, options);
    ensureEmbedDispatcher();

    return toDisposable(() => {
      // 实时表：删掉后分发扩展不再命中（无需重启）
      embeds.delete(options.id);
    });
  }

  function registerFileEditor(options: FileEditorBridgeOptions, ownerId: string): Disposable {
    if (fileEditors.has(options.id)) {
      console.warn(`[plugin] duplicate file editor id ${options.id} (owner ${ownerId})`);
    }
    fileEditors.set(options.id, options);
    sdk.registerContributions(ownerId, {
      [appApi.APP_FILE_EDITOR]: [
        {
          id: options.id,
          extensions: options.extensions,
          // 旧体系把 label 与默认文件名拆成两个 key；这里约定 `<newFile>.defaultFileName`
          newFile: {
            labelKey: options.newFile,
            defaultFileNameKey: `${options.newFile}.defaultFileName`,
          },
          createEmptyContent: (path?: string) => options.createEmptyContent(path),
          // 插件实际导出的是 React 组件；契约包刻意不依赖 React，故此处需要 cast
          load: options.load as never,
          preload: options.preload
            ? (ctx: { isSingleFileMode: boolean; currentFile: string | null }) => {
                void options.preload?.({
                  singleFileMode: ctx.isSingleFileMode,
                  currentFile: ctx.currentFile,
                });
              }
            : undefined,
          capabilities: options.capabilities,
        },
      ],
    });

    return toDisposable(() => {
      // TODO(T2b)：旧体系无 unregister，文件编辑器贡献会保留到重启
      fileEditors.delete(options.id);
    });
  }

  /**
   * 导出器：作者只写裸 `labelKey`，这里补插件 id 前缀；`kind` 缺省收敛为 `text`。
   * 登记 / 注销后都要同步原生「导出」子菜单，否则禁用的插件仍留在菜单里。
   */
  function registerExporter(exporter: PluginExporter, ownerId: string): Disposable {
    const scoped = scopeLocalizedKeys(exporter, ownerId);
    exportRegistry.registerExporter({
      id: scoped.id,
      labelKey: scoped.labelKey,
      extension: scoped.extension,
      kind: scoped.kind ?? 'text',
      menuAction: scoped.menuAction,
      order: scoped.order,
      run: (context) => scoped.run(context),
    });
    syncExportMenu();

    return toDisposable(() => {
      exportRegistry.unregisterExporter(scoped.id);
      syncExportMenu();
    });
  }

  /**
   * 图片上传器：`app:imageUploader` 贡献的 `upload(host, path)` 收旧体系宿主，
   * 而作者实现收 `PluginApp`（按插件隔离的 config / toast）。桥接层按 ownerId
   * 取运行中的 app；取不到（插件已停用）时 reject，让调用方走本地保存而不是静默失败。
   */
  function registerImageUploader(
    uploader: PluginImageUploader,
    ownerId: string,
  ): Disposable {
    const id = uploader.id ?? ownerId;
    return registerContribution(
      appApi.APP_IMAGE_UPLOADER,
      {
        id,
        upload: (_host: PluginHost, filePath: string): Promise<string> => {
          // 惰性 import：`./app` 顶层会初始化 i18n（真实环境里订阅 Tauri 事件），
          // 只 import 编辑器桥的单元测试不该被它拖进来。
          return import('./app').then(({ getPluginApp }) => {
            const app = getPluginApp(ownerId);
            if (!app) {
              throw new Error(
                `image uploader "${id}" is unavailable: plugin ${ownerId} is not running`,
              );
            }
            return uploader.upload(app, filePath);
          });
        },
      },
      ownerId,
    );
  }

  /** Agent 能力：宿主沿用旧体系的 `PluginHost`（工具执行需要编辑器/配置），按插件绑定。 */
  function createAgentCapability(ownerId: string): AgentCapability {
    const installed = (): Parameters<typeof hostModule.createPluginHost>[0] =>
      hostModule.getInstalledHostDeps() ?? hostModule.NOOP_HOST_DEPS;
    const createHostFor = (id: string) => hostModule.createPluginHost(installed(), id);
    return agentModule.agentCapability(createHostFor(ownerId), createHostFor);
  }

  /**
   * 当前外观：以 `<html class="dark">` 为准，而不是读外观设置——设置可能是
   * `system`，只有 class 反映系统偏好的实际结果。
   */
  const currentAppearance = (): 'light' | 'dark' =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light';

  /**
   * 主题能力：落到与旧体系 `PluginHost['theme']` 同一批宿主函数，插件侧只看到契约面。
   *
   * 订阅走 `appearancechange`：用户切亮/暗时由 `setAppearance` 广播，
   * 外观为 `system` 时系统偏好改变由 `src/main.tsx` 的 `matchMedia` 监听广播。
   */
  function createThemeApi(ownerId: string): PluginThemeApi {
    return {
      get appearance() {
        return currentAppearance();
      },
      applyCodeHighlightTheme: (light, dark) => {
        const theme = currentAppearance() === 'dark' ? dark : light;
        // 空串 = 跟随默认（不覆盖宿主配色）；主题 CSS 由 highlight-theme 按需加载
        if (theme) void highlightModule.applyHighlightTheme(theme);
      },
      subscribe: (listener) => {
        const handler = (): void => {
          try {
            listener(currentAppearance());
          } catch (error) {
            // 单个订阅者抛错不影响其它插件
            console.error(`[plugin:${ownerId}] appearance listener threw`, error);
          }
        };
        window.addEventListener('appearancechange', handler);
        return toDisposable(() => {
          window.removeEventListener('appearancechange', handler);
        });
      },
      codeHighlightThemeDefaults: async () => {
        const settings = await quickSettingsModule.loadThemeQuickSettings(
          themeModule.getCurrentColorTheme(),
        );
        const raw = (settings ?? {}) as Record<string, unknown>;
        const pick = (key: string): string | undefined =>
          typeof raw[key] === 'string' && raw[key] !== '' ? (raw[key] as string) : undefined;
        return { light: pick('codeEditorThemeLight'), dark: pick('codeEditorThemeDark') };
      },
    };
  }

  /**
   * 原生对话框能力：非 Tauri 环境（浏览器预览 / 单测）一律降级为「用户取消」。
   *
   * 降级不能抛：插件拿不到补救手段，抛错只会让「点了按钮什么也没发生」变成
   * 崩溃日志。面板调用失败（如权限被拒）同样按取消处理。
   */
  function createDialogsApi(ownerId: string): PluginDialogsApi {
    const unavailable = (action: string): void => {
      console.debug(`[plugin:${ownerId}] dialogs.${action} is unavailable outside Tauri`);
    };

    return {
      pickFile: async (options) => {
        if (!platformModule.isTauriRuntime()) {
          unavailable('pickFile');
          return null;
        }
        try {
          const picked = await dialogModule.open({
            multiple: false,
            directory: false,
            title: options?.title,
            defaultPath: options?.defaultPath,
            filters: options?.filters,
          });
          return typeof picked === 'string' ? picked : null;
        } catch (error) {
          console.warn(`[plugin:${ownerId}] pickFile failed`, error);
          return null;
        }
      },
      confirm: async (options) => {
        if (!platformModule.isTauriRuntime()) {
          unavailable('confirm');
          return false;
        }
        try {
          return await dialogModule.confirm(options.message, {
            title: options.title,
            okLabel: options.confirmLabel,
            cancelLabel: options.cancelLabel,
          });
        } catch (error) {
          console.warn(`[plugin:${ownerId}] confirm failed`, error);
          return false;
        }
      },
    };
  }

  // 编辑器贡献适配：登记走 `registerContributions`，注销走可逆的
  // `unregisterContribution`（立即生效，不必等重启）。无键贡献登记前会补合成 id，
  // 因此所有经此入口登记的贡献都能单条注销。
  const editorBridge = createEditorBridge({
    register: registerContribution,
    requestReload: syncInsertSurfacesAndReload,
  });

  function addMessages(
    locales: Record<string, Record<string, unknown>>,
    defaultLocale: string | undefined,
    ownerId: string,
  ): void {
    void i18nModule
      .registerPluginMessages(ownerId, locales as never, defaultLocale)
      .catch((error: unknown) => {
        console.error(`[plugin:${ownerId}] i18n injection failed`, error);
      });
  }

  function parseEmbedRef(text: string): { src: string; alt: string; title?: string } | null {
    const ref = editorApi.parseEmbedRef(text);
    if (!ref) return null;
    return ref.title
      ? { src: ref.src, alt: ref.alt, title: ref.title }
      : { src: ref.src, alt: ref.alt };
  }

  // 惰性读取：`main.tsx` 是「先 render 再 createHostDeps()」，App 注入可能晚于构造时刻
  return {
    getActiveFilePath: () => hostModule.getInstalledHostDeps()?.getCurrentFile() ?? null,
    getDocumentDir: () => hostModule.getInstalledHostDeps()?.getDocumentDir() ?? null,
    openFile: async (path: string) => {
      await hostModule.getInstalledHostDeps()?.openFile(path);
    },
    insertText: NOOP_INSERT_TEXT,
    canEdit: () => hostModule.getInstalledHostDeps()?.canEdit() ?? false,
    registerEmbed,
    registerFileEditor,
    // 7 个编辑器贡献入口由 editorBridge 提供；insert 命令的入参形状在桥内收窄。
    registerSyntaxFeature: editorBridge.registerSyntaxFeature,
    registerExtension: editorBridge.registerExtension,
    registerFormatToolbarItem: editorBridge.registerFormatToolbarItem,
    registerContextMenuItem: editorBridge.registerContextMenuItem,
    registerSelectionAction: editorBridge.registerSelectionAction,
    registerSyntaxHighlight: editorBridge.registerSyntaxHighlight,
    registerInsertCommand: (command: unknown, ownerId: string) =>
      editorBridge.registerInsertCommand(command as InsertCommandMeta, ownerId),
    registerExporter,
    registerImageUploader,
    createAgentCapability,
    createThemeApi,
    createDialogsApi,
    requestReload: syncInsertSurfacesAndReload,
    createNewDocument: async (options: { content: string; extension?: string }) => {
      // 每次调用重新读取：App 可能在运行时才注入/更新 host deps
      const deps = hostModule.getInstalledHostDeps();
      if (!deps) {
        throw new Error('documents bridge is not ready: host deps are not installed yet');
      }
      await deps.createNewDocument(options);
    },
    addMessages,
    parseEmbedRef,
  };
}
