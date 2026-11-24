import {
  APP_AGENT_TOOL,
  APP_COMMAND,
  APP_EXPORTER,
  APP_FILE_EDITOR,
  APP_IMAGE_UPLOADER,
  APP_SETTINGS_SECTION,
} from '@texto/app-api';
import type { ImageUploaderContribution } from '@texto/app-api';
import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import {
  declareExtensionPoint,
  getContributions,
  getContributionsWithOwner,
  hasExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
} from '@texto/plugin-sdk';

import { editorEmbedInserts } from '@/components/TextoEditor/src/extension/registry';
import { registerExporter, resetExportersForTests } from '@/utils/export/registry';

import { isPluginEnabled } from './pluginStatus';
import type {
  CommandContribution,
  EmbedInsert,
  FileEditorContribution,
  TextoPlugin,
} from './types';

const DEV = import.meta.env.DEV;

const plugins = new Map<string, TextoPlugin>();

/** 启用判定：用户选择优先，未设置时回退到清单的 defaultEnabled（缺省启用）。 */
function isPluginActive(plugin: TextoPlugin): boolean {
  return isPluginEnabled(plugin.id, plugin.defaultEnabled ?? true);
}

/** 注册插件清单（同 id 覆盖清单；被禁用插件只保留清单，不注册其贡献——设置段除外）。切换启用状态后需重启生效。 */
export function registerPlugins(list: TextoPlugin[]): void {
  const active: TextoPlugin[] = [];
  const disabled: TextoPlugin[] = [];
  for (const plugin of list) {
    if (plugins.has(plugin.id) && DEV) {
      console.warn(`[plugins] 插件 id 冲突，后者覆盖前者：${plugin.id}`);
    }
    plugins.set(plugin.id, plugin); // 全量保留，供设置页展示
    if (!isPluginActive(plugin)) {
      disabled.push(plugin);
      continue;
    }
    active.push(plugin);
  }
  // 第一趟：先声明启用插件自有的扩展点，保证下一趟的贡献与注册顺序无关地命中。
  for (const plugin of active) {
    for (const point of plugin.extensionPoints ?? []) {
      declareExtensionPoint(point, plugin.id);
    }
  }
  // 第二趟：登记贡献；导出器投影进运行时权威注册表。
  if (DEV && !hasExtensionPoint(APP_FILE_EDITOR)) {
    console.warn('[plugins] 应用级扩展点未声明，app:* 贡献会被忽略（应先在入口调用 declareAppExtensionPoints）');
  }
  for (const plugin of active) {
    validatePlugin(plugin);
    registerContributions(plugin.id, plugin.contributes);
    // 导出器的权威运行时表是 src/utils/export/registry.ts；plugin-sdk 侧贡献副本仅用于扩展点一致性。
    for (const c of plugin.contributes?.[APP_EXPORTER] ?? []) registerExporter(c);
  }
  // 设置段不受启用门控：用户需要先配置插件再启用（如上传器插件的服务器地址）。
  for (const plugin of disabled) {
    const sections = plugin.contributes?.[APP_SETTINGS_SECTION];
    if (sections?.length) {
      registerContributions(plugin.id, { [APP_SETTINGS_SECTION]: sections });
    }
  }
  if (DEV) reportOverlaps();
}

export function listPlugins(): TextoPlugin[] {
  return [...plugins.values()];
}

/** 当前启用的插件（读 localStorage；切换后需重启生效）。 */
export function listEnabledPlugins(): TextoPlugin[] {
  return [...plugins.values()].filter((p) => isPluginActive(p));
}

function normalizeExtension(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

/** 收集符合筛选条件的插件声明的扩展名（小写、去点、去重）。 */
function collectPluginExtensions(accept: (plugin: TextoPlugin) => boolean): string[] {
  const out = new Set<string>();
  for (const plugin of plugins.values()) {
    if (!accept(plugin)) continue;
    for (const editor of plugin.contributes?.[APP_FILE_EDITOR] ?? []) {
      for (const ext of editor.extensions) out.add(normalizeExtension(ext));
    }
    for (const ext of plugin.contributes?.[MARKDOWN_EDITOR_EXTENSION] ?? []) {
      if (ext.embed) for (const e of ext.embed.extensions) out.add(normalizeExtension(e));
    }
  }
  return [...out];
}

/** 被禁用插件声明的扩展名。读全部清单，覆盖被禁用插件。 */
export function disabledFileExtensions(): string[] {
  return collectPluginExtensions((plugin) => !isPluginActive(plugin));
}

/** 给定文件路径的扩展名是否属于被禁用的插件。 */
export function isDisabledFileExtension(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return disabledFileExtensions().includes(normalizeExtension(name.slice(dot + 1)));
}

/** 启用插件声明的扩展名。 */
export function enabledFileExtensions(): string[] {
  return collectPluginExtensions((plugin) => isPluginActive(plugin));
}

/**
 * 实际生效的可打开扩展名。
 *
 * 用户配置只是基线；插件声明的扩展名不写进配置，而是在这里按启用状态合并：
 * 启用插件的扩展名追加进来，被禁用插件的扩展名从基线里扣掉。这样「导入并启用
 * 插件」才获得该类文件的支持，禁用或卸载后自动失效。
 */
export function resolveOpenableExtensions(base: readonly string[]): string[] {
  const disabled = new Set(disabledFileExtensions());
  const out = base.filter((ext) => !disabled.has(normalizeExtension(ext)));
  for (const ext of enabledFileExtensions()) {
    if (!out.some((e) => normalizeExtension(e) === ext)) out.push(ext);
  }
  return out;
}

export function listFileEditors(): FileEditorContribution[] {
  return getContributions(APP_FILE_EDITOR);
}

/** 列出文件编辑器贡献及其所属插件 id（注册序）。用于把调用回调时的 host 绑定到 owner。 */
export function listFileEditorsWithOwner(): {
  pluginId: string;
  contribution: FileEditorContribution;
}[] {
  return getContributionsWithOwner(APP_FILE_EDITOR).map((c) => ({
    pluginId: c.ownerId,
    contribution: c.value,
  }));
}

/** 解析路径对应的文件编辑器贡献及其所属插件 id；重叠时后注册者优先。 */
export function resolveFileEditorWithOwner(
  path: string | null | undefined,
): { pluginId: string; contribution: FileEditorContribution } | null {
  if (!path) return null;
  const lower = path.toLowerCase();
  const items = getContributionsWithOwner(APP_FILE_EDITOR);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const c = items[i]!;
    if (c.value.extensions.some((ext) => lower.endsWith(ext.toLowerCase()))) {
      return { pluginId: c.ownerId, contribution: c.value };
    }
  }
  return null;
}

/** 按扩展名（大小写不敏感）解析文件编辑器；重叠时后注册者优先。 */
export function resolveFileEditor(
  path: string | null | undefined,
): FileEditorContribution | null {
  return resolveFileEditorWithOwner(path)?.contribution ?? null;
}

/** 列出图片上传器贡献及其所属插件 id（注册序）。 */
export function listImageUploadersWithOwner(): {
  pluginId: string;
  contribution: ImageUploaderContribution;
}[] {
  return getContributionsWithOwner(APP_IMAGE_UPLOADER).map((c) => ({
    pluginId: c.ownerId,
    contribution: c.value,
  }));
}

/** 解析当前生效的图片上传器；重叠时后注册者优先。（`app:imageUploader` 仍受启用门控：仅启用插件的上传器在注册表内。） */
export function resolveImageUploaderWithOwner(): {
  pluginId: string;
  contribution: ImageUploaderContribution;
} | null {
  const items = listImageUploadersWithOwner();
  const last = items[items.length - 1];
  return last ?? null;
}

export function listEmbeds(): EmbedInsert[] {
  return editorEmbedInserts();
}

export function listCommands(): CommandContribution[] {
  return getContributions(APP_COMMAND);
}

/** 列出插件命令及其所属插件 id（注册序）。用于把命令回调拿到的 host 绑定到 owner。 */
export function listCommandsWithOwner(): { pluginId: string; command: CommandContribution }[] {
  return getContributionsWithOwner(APP_COMMAND).map((c) => ({
    pluginId: c.ownerId,
    command: c.value,
  }));
}

export function findCommandByMenuAction(action: string): CommandContribution | undefined {
  const items = getContributions(APP_COMMAND);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]!.menuAction === action) return items[i];
  }
  return undefined;
}

/** DEV-only：校验单个插件的贡献声明，发现问题只告警不阻断。 */
function validatePlugin(plugin: TextoPlugin): void {
  if (!DEV) return;
  const warn = (msg: string) => console.warn(`[plugins] ${plugin.id}: ${msg}`);
  const fileEditors = plugin.contributes?.[APP_FILE_EDITOR];
  const exporters = plugin.contributes?.[APP_EXPORTER];
  const commands = plugin.contributes?.[APP_COMMAND];
  const uploaders = plugin.contributes?.[APP_IMAGE_UPLOADER];
  const agentTools = plugin.contributes?.[APP_AGENT_TOOL];

  // 显式声明为空数组时告警（原 checkEmpty 的等价语义）
  for (const [name, arr] of [
    [APP_FILE_EDITOR, fileEditors],
    [APP_EXPORTER, exporters],
    [APP_COMMAND, commands],
    [APP_IMAGE_UPLOADER, uploaders],
    [APP_AGENT_TOOL, agentTools],
  ] as const) {
    if (arr && arr.length === 0) warn(`${name} 声明了空数组`);
  }

  for (const c of fileEditors ?? []) {
    if (!c.extensions.length) warn(`fileEditor ${c.id} 缺少 extensions`);
    for (const ext of c.extensions) {
      if (!ext.startsWith('.')) warn(`fileEditor ${c.id} 扩展名 "${ext}" 应以 "." 开头`);
    }
    if (typeof c.load !== 'function') warn(`fileEditor ${c.id} 缺少 load()`);
  }
  for (const c of exporters ?? []) {
    if (typeof c.run !== 'function') warn(`exporter ${c.id} 缺少 run()`);
  }
  for (const c of commands ?? []) {
    if (typeof c.run !== 'function') warn(`command ${c.id} 缺少 run()`);
  }
  for (const u of uploaders ?? []) {
    if (typeof u.upload !== 'function') warn(`imageUploader ${u.id} 缺少 upload()`);
  }
  for (const t of agentTools ?? []) {
    if (!t.name.includes('.')) warn(`agentTool "${t.name}" 应以 "<owner>.<name>" 形式命名`);
    if (!t.description.trim()) warn(`agentTool ${t.name} 缺少 description`);
    if (typeof t.execute !== 'function') warn(`agentTool ${t.name} 缺少 execute()`);
  }
}

/** DEV-only：报告跨插件的重叠声明（同 kind 内）。 */
function reportOverlaps(): void {
  warnDuplicates(getContributions(APP_FILE_EDITOR), (c) => c.extensions.map(normalizeExtension), 'fileEditor 扩展名');
  warnDuplicates(getContributions(APP_COMMAND), (c) => (c.menuAction ? [c.menuAction] : []), 'command menuAction');
  warnDuplicates(getContributions(APP_AGENT_TOOL), (t) => [t.name], 'agentTool name');
}

function warnDuplicates<T extends { id?: string; name?: string }>(
  items: T[],
  keysOf: (item: T) => string[],
  label: string,
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    const owner = item.id ?? item.name ?? '?';
    for (const key of keysOf(item)) {
      const prev = seen.get(key);
      if (prev !== undefined) {
        console.warn(`[plugins] ${label} 冲突："${key}" 同时由 ${prev} 与 ${owner} 声明`);
      } else {
        seen.set(key, owner);
      }
    }
  }
}

/** 仅供测试：清空注册表（含插件写入的运行时导出器注册表）。 */
export function resetPluginRegistryForTests(): void {
  plugins.clear();
  resetExportersForTests();
  resetExtensionPointsForTests();
}
