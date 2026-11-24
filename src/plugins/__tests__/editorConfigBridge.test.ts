import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerContributions,
  resetExtensionPointsForTests,
  resetPluginConfigSnapshotsForTests,
  setPluginConfigSnapshot,
  unregisterOwner,
} from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_EXTENSION,
  type EditorContext,
} from '@texto/markdown-editor-api';

// app.ts 顶层会初始化 i18n / sonner：只要求可 import，不订阅真实 Tauri 事件
vi.mock('@/i18n', () => ({ default: { language: 'en', getFixedT: () => (key: string) => key } }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import {
  collectEditorExtensions,
  declareMarkdownEditorExtensionPoint,
} from '@/components/TextoEditor/src/extension/registry';
import { setEditorHost } from '@/components/TextoEditor/src/host';
import { readPluginConfig } from '@/plugins/pluginConfigReader';
import { createPluginApp } from '@/plugins/runtime/app';

const RUNTIME_ID = 'app.textox.runtime-demo';
const LEGACY_ID = 'app.textox.legacy-demo';

/** 编辑器创建扩展时只要 `config`（`collectEditorExtensions` 会覆盖它）。 */
const editorCtx = {} as EditorContext;

/** 把 `readPluginConfig` 装进宿主：与 `installEditorHost()` 的接法一致。 */
function installHost(): void {
  setEditorHost({
    getImageUploader: async () => null,
    resolveImageSrc: (src) => src,
    showDialog: async (options) => options.dismissValue as never,
    saveMedia: async () => ({ saved: false }),
    readPluginConfig,
  });
}

/**
 * 构造运行中的运行时插件：设置链只需要 `createAgentCapability` / `createThemeApi` /
 * `createDialogsApi` 在构造期被调用一次，其余宿主依赖不参与这条链。
 */
function makeRuntimeApp(
  settings: unknown[],
  stored: Record<string, unknown> = {},
): ReturnType<typeof createPluginApp> {
  return createPluginApp({
    manifest: {
      id: RUNTIME_ID,
      name: 'Runtime demo',
      version: '1.0.0',
      minAppVersion: '2.5.0',
      author: { name: 'x' },
      settings,
    },
    registry: { register: vi.fn() } as never,
    deps: {
      createAgentCapability: () => ({
        available: () => false,
        run: () => ({ abort: () => {} }),
        present: () => ({ abort: () => {} }),
        profiles: { list: () => [] },
        tools: { list: () => [], call: async () => ({ content: '' }) },
      }),
      createThemeApi: () => ({
        appearance: 'light' as const,
        applyCodeHighlightTheme: () => {},
        subscribe: () => ({ dispose: () => {} }),
        codeHighlightThemeDefaults: async () => ({}),
      }),
      createDialogsApi: () => ({
        pickFile: async () => null,
        confirm: async () => false,
      }),
    } as never,
    data: { settings: stored, plugin: {} },
    writeData: vi.fn(async () => undefined),
    subscribeDataChanged: () => () => {},
  });
}

/** 登记一个只观察 `ctx.config` 的编辑器扩展，返回它看到的快照。 */
function registerProbeExtension(ownerId: string, seen: Array<Record<string, unknown>>): void {
  registerContributions(ownerId, {
    [MARKDOWN_EDITOR_EXTENSION]: [
      {
        id: `${ownerId}.probe`,
        create: (ctx) => {
          seen.push(ctx.config.all<Record<string, unknown>>());
          return {};
        },
      },
    ],
  });
}

beforeEach(() => {
  resetPluginConfigSnapshotsForTests();
  resetExtensionPointsForTests();
  declareMarkdownEditorExtensionPoint();
  setEditorHost({
    getImageUploader: async () => null,
    resolveImageSrc: (src) => src,
    showDialog: async (options) => options.dismissValue as never,
    saveMedia: async () => ({ saved: false }),
  });
});

describe('editor extension config', () => {
  it('gives a runtime plugin its own settings instead of an empty object', () => {
    const app = makeRuntimeApp(
      [
        { type: 'text', key: 'mode', labelKey: 'mode', default: 'compact' },
        { type: 'boolean', key: 'showLineEnding', labelKey: 'showLineEnding', default: true },
      ],
      { mode: 'expanded' },
    );

    const seen: Array<Record<string, unknown>> = [];
    registerProbeExtension(RUNTIME_ID, seen);
    installHost();
    collectEditorExtensions(editorCtx);

    // 清单默认值回填 + 已存值优先
    expect(seen).toEqual([{ mode: 'expanded', showLineEnding: true }]);
    expect(app.settings.get('mode')).toBe('expanded');
    app.dispose();
  });

  it('falls back to the legacy config snapshot for legacy plugins', () => {
    setPluginConfigSnapshot(LEGACY_ID, { size: 3, color: 'red' });
    const seen: Array<Record<string, unknown>> = [];
    registerProbeExtension(LEGACY_ID, seen);
    installHost();

    collectEditorExtensions(editorCtx);

    expect(seen).toEqual([{ size: 3, color: 'red' }]);
  });

  it('prefers runtime settings over a stale legacy snapshot with the same id', () => {
    // 同一个 id 同时存在两种来源时以运行时为准（迁移期不应该读到旧快照）
    setPluginConfigSnapshot(RUNTIME_ID, { mode: 'legacy' });
    const app = makeRuntimeApp([
      { type: 'text', key: 'mode', labelKey: 'mode', default: 'compact' },
    ]);

    const seen: Array<Record<string, unknown>> = [];
    registerProbeExtension(RUNTIME_ID, seen);
    installHost();
    collectEditorExtensions(editorCtx);

    expect(seen).toEqual([{ mode: 'compact' }]);
    app.dispose();
  });

  it('hands out an empty reader when the host has no config for the owner', () => {
    const seen: Array<Record<string, unknown>> = [];
    let reader: { get(key: string): unknown } | null = null;
    registerContributions(LEGACY_ID, {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: `${LEGACY_ID}.probe`,
          create: (ctx) => {
            seen.push(ctx.config.all<Record<string, unknown>>());
            reader = ctx.config as unknown as { get(key: string): unknown };
            return {};
          },
        },
      ],
    });
    installHost();

    collectEditorExtensions(editorCtx);

    expect(seen).toEqual([{}]);
    expect(reader!.get('missing')).toBeUndefined();
  });

  it('keeps the legacy snapshot reader when the host does not implement the hook', () => {
    // 未注入 `readPluginConfig`（旧宿主 / 单测）时编辑器自己读快照，行为不变
    setPluginConfigSnapshot(LEGACY_ID, { size: 3 });
    const seen: Array<Record<string, unknown>> = [];
    registerProbeExtension(LEGACY_ID, seen);

    collectEditorExtensions(editorCtx);

    expect(seen).toEqual([{ size: 3 }]);
  });

  it('only queries the host for the owner of each contribution', () => {
    const seen: string[] = [];
    const app = makeRuntimeApp([
      { type: 'text', key: 'mode', labelKey: 'mode', default: 'compact' },
    ]);
    registerContributions(LEGACY_ID, {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: `${LEGACY_ID}.probe`,
          create: (ctx) => {
            seen.push(ctx.config.all<{ mode?: string }>().mode ?? 'none');
            return {};
          },
        },
      ],
    });
    registerProbeExtension(RUNTIME_ID, []);
    setEditorHost({
      getImageUploader: async () => null,
      resolveImageSrc: (src) => src,
      showDialog: async (options) => options.dismissValue as never,
      saveMedia: async () => ({ saved: false }),
      readPluginConfig: (pluginId) => {
        const reader = readPluginConfig(pluginId);
        seen.push(`asked:${pluginId}`);
        return reader;
      },
    });

    collectEditorExtensions(editorCtx);

    expect(seen).toEqual([`asked:${LEGACY_ID}`, 'none', `asked:${RUNTIME_ID}`]);
    app.dispose();
  });
});

afterEach(() => {
  unregisterOwner(RUNTIME_ID);
  unregisterOwner(LEGACY_ID);
  resetPluginConfigSnapshotsForTests();
});
