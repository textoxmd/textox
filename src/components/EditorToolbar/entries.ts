import { TOOLBAR_GROUPS } from './groups';
import type { ToolbarContext, ToolbarEntry, ToolbarGroupId, ToolbarItem } from './types';

const SECTION_ORDER = new Map<ToolbarGroupId, number>(TOOLBAR_GROUPS.map((g) => [g.id, g.order]));

/**
 * 把工具栏项（内置 + 运行时注册 + 插件贡献）投影成有序的渲染单元。
 *
 * - 排序：先按 section 顺序，再按 item.order；即「越靠右越先被折叠」。
 * - `isSectionStart`：每个 section 的首项，前导分隔线挂在该项上。
 * - `active` / `disabled`：从当前编辑器状态解析。
 */
export function buildToolbarEntries(items: ToolbarItem[], ctx: ToolbarContext): ToolbarEntry[] {
  const sorted = [...items].sort((a, b) => {
    const sectionDelta = (SECTION_ORDER.get(a.group) ?? 0) - (SECTION_ORDER.get(b.group) ?? 0);
    return sectionDelta !== 0 ? sectionDelta : a.order - b.order;
  });

  const seenSections = new Set<ToolbarGroupId>();
  return sorted.map((item) => {
    const isSectionStart = !seenSections.has(item.group);
    seenSections.add(item.group);
    return {
      id: item.id,
      section: item.group,
      order: item.order,
      isSectionStart,
      icon: item.icon,
      labelKey: item.labelKey,
      active: item.isActive
        ? item.isActive(ctx)
        : item.activeMark
          ? ctx.active.marks.includes(item.activeMark)
          : item.activeKey
            ? ctx.active[item.activeKey]
            : false,
      disabled: item.isDisabled?.(ctx) ?? false,
      run: () => {
        const view = ctx.getView();
        if (!view) return;
        view.focus();
        item.run(ctx);
      },
    };
  });
}

/**
 * 被折叠的条目。`visibleCount` 为当前可见的最大索引（`-1` 表示全部折叠），
 * 与 `@rc-component/overflow` 的 `onVisibleChange(count)` 语义一致。
 */
export function omittedToolbarEntries(entries: ToolbarEntry[], visibleCount: number): ToolbarEntry[] {
  return entries.slice(visibleCount + 1);
}

export interface ToolbarEntryGroup {
  section: ToolbarGroupId;
  entries: ToolbarEntry[];
}

/** 按 section 顺序把条目分组成连续段，供「更多」菜单渲染分组与分隔线。 */
export function groupEntriesBySection(entries: ToolbarEntry[]): ToolbarEntryGroup[] {
  const groups: ToolbarEntryGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.section === entry.section) {
      last.entries.push(entry);
    } else {
      groups.push({ section: entry.section, entries: [entry] });
    }
  }
  return groups;
}

/**
 * 条目是否可见。与 `@rc-component/overflow` 的 `display: index <= visibleCount` 语义一致；
 * 不可见项应设置 `tabIndex={-1}` 以免进入 Tab 焦点顺序。
 */
export function isEntryVisible(index: number, visibleCount: number): boolean {
  return index <= visibleCount;
}

