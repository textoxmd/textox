import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isValueField, type SettingsField } from '@texto/plugin-sdk';

import { coerceSettingsPatch } from '@/components/settings/settingsPatch';
import { parseManifestSettings, toHostSettingsFields } from '@/plugins/runtime/app';
import { pluginIpc, subscribePluginDataChanged } from '@/plugins/runtime/ipc';
import type { RuntimeEntry } from '@/plugins/runtime/index';

/** 单个插件的设置读写面；`fields` / `values` 只针对 `activeId` 指向的插件。 */
export interface PluginSettingsApi {
  /** 当前插件的设置字段（清单字段已桥接为渲染器富字段）。 */
  readonly fields: SettingsField[];
  /** 当前插件已落盘的设置值（`data.json` 的 `settings` 命名空间）。 */
  readonly values: Record<string, unknown>;
  /** 写入单个键；被字段声明拒绝或写盘失败返回 `false`。 */
  setValue(pluginId: string, key: string, value: unknown): Promise<boolean>;
  /** 写入一组键（`preset` 多键补丁）；任一键非法即整体拒绝并返回 `false`。 */
  setPatch(pluginId: string, patch: Record<string, unknown>): Promise<boolean>;
  /** 把声明过的值字段写回各自默认值（未声明的键原样保留）；失败返回 `false`。 */
  resetToDefaults(pluginId: string): Promise<boolean>;
}

/** 稳定引用：空字段列表复用同一常量，避免每次渲染都产生新数组。 */
const EMPTY_FIELDS: SettingsField[] = [];

/**
 * 插件设置的状态与读写（插件管理面板的数据层）。
 *
 * - 字段：对**全部** `entries` 预先派生（`useMemo`），返回值只给 `activeId` 的那份。
 * - 读盘：`activeId` 变化时读一次；`plugin:data-changed` 只对当前 `activeId` 重读。
 * - 旧读不覆盖新读：每次发出读盘时取单调序号，只有最后发出的那次结果被接受。
 * - 写入：逐键按字段声明校验，任一非法即整体拒绝（只提示、不落盘），成功整份回写。
 */
export function usePluginSettings(
  entries: readonly RuntimeEntry[],
  activeId: string | null,
): PluginSettingsApi {
  /** 当前插件的设置值（`data.json` 的 `settings` 命名空间）。 */
  const [values, setValues] = useState<Record<string, unknown>>({});
  /**
   * 读盘的单调序号：`plugin:data-changed` 会触发多次并行读，慢的旧读若晚于新读返回
   * 就会用过期值覆盖；只接受最后一次发出的读结果。
   */
  const readSeq = useRef(0);

  const fieldsByPlugin = useMemo(() => {
    const map = new Map<string, SettingsField[]>();
    for (const entry of entries) {
      map.set(
        entry.id,
        entry.manifest ? toHostSettingsFields(parseManifestSettings(entry.manifest, console)) : [],
      );
    }
    return map;
  }, [entries]);

  useEffect(() => {
    if (!activeId) {
      setValues({});
      return;
    }
    let cancelled = false;
    setValues({});
    const read = () => {
      // 并行读按发出顺序取最后一次：慢的旧读晚到不能覆盖新值
      const seq = (readSeq.current += 1);
      void pluginIpc
        .readData(activeId)
        .then((data) => {
          if (!cancelled && seq === readSeq.current) {
            setValues(data.settings ?? {});
          }
        })
        .catch((error: unknown) => {
          if (!cancelled && seq === readSeq.current) {
            console.error('Failed to read plugin data:', error);
          }
        });
    };
    read();
    const unsubscribe = subscribePluginDataChanged((pluginId) => {
      if (pluginId === activeId) read();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeId]);

  const setPatch = useCallback(
    async (pluginId: string, patch: Record<string, unknown>): Promise<boolean> => {
      try {
        const data = await pluginIpc.readData(pluginId);
        const applied = coerceSettingsPatch(fieldsByPlugin.get(pluginId) ?? EMPTY_FIELDS, patch);
        if (!applied) {
          toast.error('设置值无效，已保留原值');
          // 受控控件已经把非法输入画进 DOM，但 state 未变：换引用强制回写磁盘里的原值。
          setValues((prev) => ({ ...prev }));
          return false;
        }
        await pluginIpc.writeData(pluginId, {
          ...data,
          settings: { ...data.settings, ...applied },
        });
        // 同窗口没有订阅广播回环前先落本地，避免控件回跳到旧值。
        setValues((prev) => ({ ...prev, ...applied }));
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [fieldsByPlugin],
  );

  const resetToDefaults = useCallback(
    async (pluginId: string): Promise<boolean> => {
      const fields = fieldsByPlugin.get(pluginId) ?? EMPTY_FIELDS;
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        if (isValueField(field)) patch[field.key] = field.default;
      }
      if (Object.keys(patch).length === 0) return true;
      return setPatch(pluginId, patch);
    },
    [fieldsByPlugin, setPatch],
  );

  const setValue = useCallback(
    (pluginId: string, key: string, value: unknown): Promise<boolean> =>
      setPatch(pluginId, { [key]: value }),
    [setPatch],
  );

  const fields = activeId ? (fieldsByPlugin.get(activeId) ?? EMPTY_FIELDS) : EMPTY_FIELDS;

  return useMemo(
    () => ({ fields, values, setValue, setPatch, resetToDefaults }),
    [fields, values, setValue, setPatch, resetToDefaults],
  );
}
