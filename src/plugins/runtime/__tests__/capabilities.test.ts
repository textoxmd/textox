import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// app.ts / deps.ts 顶层会初始化 i18n / sonner；只提供可 import 的最小面，不触发真实翻译与 UI。
vi.mock('@/i18n', () => ({
  default: { getFixedT: () => (key: string) => key },
  registerPluginMessages: vi.fn(async () => {}),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { PluginManifest } from '@textox/plugin-sdk';
import { declareAppExtensionPoints } from '@texto/app-api';

import { resolveImageUploader } from '@/plugins/imageUploader';
import { listExporters, resetExportersForTests } from '@/utils/export/registry';

import { createPluginApp, runManifestAction, type PluginData } from '../app';
import { createHostDeps, resetHostDepsForTests } from '../deps';
import { PluginRegistry } from '../registry';

const ID = 'app.textox.capabilities';

const manifest: PluginManifest = {
  id: ID,
  name: 'Capabilities',
  version: '1.0.0',
  minAppVersion: '2.5.0',
  author: { name: 'Textox' },
};

const EMPTY_DATA: PluginData = { settings: {}, plugin: {} };

/** 用真实的宿主桥接（`createHostDeps`）+ 真实插件注册表构造 app，不 mock 被测逻辑。 */
async function makeApp(overrides: Partial<PluginManifest> = {}) {
  const deps = await createHostDeps();
  const registry = new PluginRegistry();
  const app = createPluginApp({
    manifest: { ...manifest, ...overrides },
    registry,
    deps,
    data: EMPTY_DATA,
    writeData: async () => {},
    readData: async () => EMPTY_DATA,
    subscribeDataChanged: () => () => {},
  });
  return { app, registry, deps };
}

beforeEach(() => {
  // 运行入口（`src/plugins/index.ts`）启动时会声明；单测里手动补一次（幂等）
  declareAppExtensionPoints();
  resetExportersForTests();
  resetHostDepsForTests();
});

afterEach(() => {
  resetExportersForTests();
  resetHostDepsForTests();
});

describe('app.exporters.register', () => {
  it('registers an exporter with the plugin-scoped labelKey and text default', async () => {
    const { app } = await makeApp();

    const sub = app.exporters.register({
      id: 'demo-html',
      labelKey: 'exportHtml',
      extension: 'html',
      menuAction: 'export_demo_html',
      run: async () => ({ data: '<h1>hi</h1>', suggestedName: 'a.html' }),
    });

    const exporters = listExporters();
    expect(exporters).toHaveLength(1);
    // 作者写裸 key，桥接层补插件 id 前缀（否则 i18n 命中不到插件文案）
    expect(exporters[0]!.labelKey).toBe(`${ID}.exportHtml`);
    expect(exporters[0]!.kind).toBe('text');
    expect(exporters[0]!.menuAction).toBe('export_demo_html');
    await expect(
      exporters[0]!.run({ currentFile: null, documentDir: null }),
    ).resolves.toEqual({ data: '<h1>hi</h1>', suggestedName: 'a.html' });

    sub.dispose();
    expect(listExporters()).toEqual([]);
  });

  it('lets the later registration of the same id win', async () => {
    const { app } = await makeApp();

    const first = app.exporters.register({
      id: 'demo-html',
      labelKey: 'first',
      extension: 'html',
      run: async () => ({ data: 'first', suggestedName: 'a.html' }),
    });
    const second = app.exporters.register({
      id: 'demo-html',
      labelKey: 'second',
      extension: 'html',
      run: async () => ({ data: 'second', suggestedName: 'b.html' }),
    });

    expect(listExporters()).toHaveLength(1);
    await expect(
      listExporters()[0]!.run({ currentFile: null, documentDir: null }),
    ).resolves.toEqual({ data: 'second', suggestedName: 'b.html' });

    second.dispose();
    expect(listExporters()).toEqual([]);
    first.dispose();
    expect(listExporters()).toEqual([]);
  });
});

describe('app.imageUploader.register', () => {
  it('routes uploads through the plugin own PluginApp and unregisters on dispose', async () => {
    const { app } = await makeApp();
    const seenApps: unknown[] = [];
    const seenPaths: string[] = [];

    const sub = app.imageUploader.register({
      async upload(receivedApp, filePath) {
        seenApps.push(receivedApp);
        seenPaths.push(filePath);
        return 'https://cdn.example.com/x.png';
      },
    });

    const uploader = resolveImageUploader();
    expect(uploader).not.toBeNull();
    await expect(uploader!.upload('/notes/x.png')).resolves.toBe(
      'https://cdn.example.com/x.png',
    );
    // 作者拿到的是它自己的 PluginApp，而不是旧体系的 PluginHost
    expect(seenApps).toEqual([app]);
    expect(seenPaths).toEqual(['/notes/x.png']);

    sub.dispose();
    expect(resolveImageUploader()).toBeNull();
  });

  it('rejects when the owning plugin app is no longer running', async () => {
    const { app } = await makeApp();
    const sub = app.imageUploader.register({
      upload: async () => 'https://cdn.example.com/x.png',
    });

    const uploader = resolveImageUploader();
    app.dispose();

    await expect(uploader!.upload('/notes/x.png')).rejects.toThrow(/is not running/);
    sub.dispose();
  });
});

describe('app.agent', () => {
  it('reports unavailable for every profile while no model is configured', async () => {
    const { app } = await makeApp();

    // 默认配置 enabled=false、profiles=[]：空 id 与任意 id 都不可用，且不抛错
    expect(app.agent.available('')).toBe(false);
    expect(app.agent.available('p_missing')).toBe(false);
    expect(app.agent.profiles.list()).toEqual([]);
  });
});

describe('settings action fields', () => {
  it('keeps action fields out of stored values and does not fill a default', async () => {
    const { app } = await makeApp({
      settings: [
        { key: 'shout', type: 'boolean', default: false, labelKey: 'shout' },
        { key: 'testConnection', type: 'action', labelKey: 'test', command: `${ID}.test` },
      ],
    });

    // action 不承载存储值：既没有 `default` 可回填，也不该出现在快照里
    expect(app.settings.all().values).toEqual({ shout: false });
    expect(app.settings.get('testConnection')).toBeUndefined();
  });

  it('dispatches an action field to the command its plugin registered', async () => {
    const seen: string[] = [];
    const action = {
      key: 'ping',
      type: 'action' as const,
      labelKey: 'ping',
      command: `${ID}.ping`,
    };
    const { app, registry } = await makeApp({ settings: [action] });
    // 命令由插件自己注册（`addCommand` → `app.register('command', ...)`）
    registry.register(ID, 'command', action.command, {
      id: action.command,
      name: 'Ping',
      callback: () => {
        seen.push(action.command);
      },
    });

    await expect(runManifestAction(ID, action)).resolves.toBe(true);
    expect(seen).toEqual([action.command]);

    // 非 action 字段 / 缺命令引用的字段 ⇒ 没有可执行入口
    await expect(
      runManifestAction(ID, { key: 'shout', type: 'boolean', default: false, labelKey: 'shout' }),
    ).resolves.toBe(false);
    await expect(runManifestAction(ID, { key: 'ping', type: 'action', labelKey: 'ping' })).resolves.toBe(
      false,
    );

    // 插件没注册该命令 ⇒ false（面板据此提示「未启用或未注册该命令」）
    await expect(
      runManifestAction(ID, { key: 'pong', type: 'action', labelKey: 'pong', command: `${ID}.pong` }),
    ).resolves.toBe(false);

    // 停了插件（注册表按 owner 清理）后同一字段也不可执行
    app.dispose();
    await expect(runManifestAction(ID, action)).resolves.toBe(false);
  });

  it('refuses to run a command registered by another plugin', async () => {
    const action = {
      key: 'ping',
      type: 'action' as const,
      labelKey: 'ping',
      command: 'app.textox.other.ping',
    };
    const { app, registry } = await makeApp({ settings: [action] });
    const callback = vi.fn();
    registry.register('app.textox.other', 'command', action.command, {
      id: action.command,
      name: 'Ping',
      callback,
    });

    // 命令 id 可跨插件重名：只认本插件注册的那一条
    await expect(runManifestAction(ID, action)).resolves.toBe(false);
    expect(callback).not.toHaveBeenCalled();
    app.dispose();
  });
});
