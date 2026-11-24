import { editorFormatToolbarItems, editorInsertCommands } from '@/components/TextoEditor/src/extension/registry';
import { prefetchIcons } from '@/components/TextoEditor/src/iconLoader';
import { SHORTCUT_IDS } from '@/app/constants';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, clearShortcutsConfigCache } from '@/utils/shortcuts';

type ShortcutCategory = (typeof SHORTCUT_ACTIONS)[number]['category'];

/**
 * 由插件贡献**引入**（而非宿主内置）的快捷键 id。
 *
 * 只有集合里的 id 会在命令消失时被撤回：内置插入命令（`code_block` 等）本来就在
 * `SHORTCUT_IDS` 里、从不会进这个集合，因此卸载插件绝不会误删宿主项。
 */
const contributedShortcutIds = new Set<string>();

function removeShortcutId(id: string): void {
  const index = SHORTCUT_IDS.indexOf(id);
  if (index >= 0) SHORTCUT_IDS.splice(index, 1);
}

function removeShortcutAction(id: string): void {
  for (let index = SHORTCUT_ACTIONS.length - 1; index >= 0; index -= 1) {
    if (SHORTCUT_ACTIONS[index]!.id === id) SHORTCUT_ACTIONS.splice(index, 1);
  }
}

/**
 * 把插件贡献的插入命令接入快捷键体系（id / 默认键 / 设置项），并预热插入命令与
 * 格式项的图标（含 lucide 名称）。
 *
 * **可重复调用**：每次都按当前扩展点注册表重新对齐——运行时插件在启动后才登记
 * 命令、停用/卸载时又会撤掉命令，所以启动早期只同步一次是不够的。
 * 撤回只针对「由插件引入」的 id（见 `contributedShortcutIds`），宿主内置项不受影响。
 *
 * 幂等性：`prefetchIcons` 的已解析图标命中 `iconLoader` 的缓存直接返回；未完成
 * 的加载会共享同一个 `lucide-react/dynamicIconImports` Promise，因此重复调用不会
 * 重复拉取模块（只是多几个微任务）。
 */
export function syncEditorInsertSurfaces(): void {
  const commands = editorInsertCommands();
  const liveIds = new Set(commands.map((cmd) => cmd.id));

  // 1) 撤回已消失的插件命令（含默认键），内置项不在集合里、一律不动。
  for (const id of [...contributedShortcutIds]) {
    if (liveIds.has(id)) continue;
    contributedShortcutIds.delete(id);
    removeShortcutId(id);
    removeShortcutAction(id);
    delete DEFAULT_SHORTCUTS[id];
  }

  // 2) 新增 / 补齐当前命令：已有项一律保留（宿主默认键优先，后注册不覆盖）。
  for (const cmd of commands) {
    if (!SHORTCUT_IDS.includes(cmd.id)) {
      SHORTCUT_IDS.push(cmd.id);
      contributedShortcutIds.add(cmd.id);
    }
    if (cmd.defaultShortcut && DEFAULT_SHORTCUTS[cmd.id] === undefined) {
      DEFAULT_SHORTCUTS[cmd.id] = cmd.defaultShortcut;
    }
    if (!SHORTCUT_ACTIONS.some((action) => action.id === cmd.id)) {
      SHORTCUT_ACTIONS.push({
        id: cmd.id,
        name: cmd.labelKey,
        description: cmd.descriptionKey ?? cmd.labelKey,
        category: (cmd.category as ShortcutCategory) ?? 'paragraph',
        defaultShortcut: cmd.defaultShortcut ?? '',
        currentShortcut: cmd.defaultShortcut ?? null,
      });
    }
  }

  prefetchIcons([
    ...commands.map((cmd) => cmd.icon),
    ...editorFormatToolbarItems().map((item) => item.icon),
  ]);

  // `loadShortcutsConfig()` 在首次读取时把 DEFAULT_SHORTCUTS 合进缓存；缓存早于
  // 运行时插件登记就会漏掉它们的默认键。清一次缓存，下一次按键分派重新合并。
  clearShortcutsConfigCache();
}

/** @internal 仅测试：清空「插件引入」记录（调用方负责还原三张表）。 */
export function resetEditorInsertSurfacesForTests(): void {
  contributedShortcutIds.clear();
}
