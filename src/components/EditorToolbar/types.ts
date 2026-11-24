import type { ComponentType, RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { TextoEditorRef } from '../TextoEditor/TextoEditorRef';
import type { ToolbarActiveState } from '../TextoEditor/src/features/toolbar-state';

export type ToolbarGroupId = 'inline' | 'blocks' | 'lists' | 'insert';

export interface ToolbarGroup {
  id: ToolbarGroupId;
  /** bar 中从左到右的顺序（溢出按位置从右往左折叠，越靠右越先折叠） */
  order: number;
}

/** 工具栏渲染单元：由 `buildToolbarEntries` 从 `ToolbarItem` + 编辑器 active 状态投影而来。 */
export interface ToolbarEntry {
  id: string;
  section: ToolbarGroupId;
  order: number;
  /** 是否为所属 section 的首项：前导分隔线挂在该项上，随其一起折叠 */
  isSectionStart: boolean;
  icon: ComponentType<{ size?: number | string }>;
  labelKey: string;
  active: boolean;
  disabled: boolean;
  /** 聚焦编辑器并执行该项动作 */
  run(): void;
}

export interface ToolbarContext {
  editorRef: RefObject<TextoEditorRef>;
  /** 调用时取最新 view，避免闭包拿到旧引用 */
  getView(): EditorView | null;
  active: ToolbarActiveState;
  isSingleFileMode: boolean;
}

/** 可作为按钮激活/禁用来源的布尔状态键（headingLevel 由标题下拉专用，marks 由 activeMark 专用） */
export type ToolbarActiveFlag = Exclude<keyof ToolbarActiveState, 'headingLevel' | 'marks'>;

export interface ToolbarItem {
  id: string;
  group: ToolbarGroupId;
  order: number;
  labelKey: string;
  icon: ComponentType<{ size?: number | string }>;
  run(ctx: ToolbarContext): void;
  activeKey?: ToolbarActiveFlag;
  /** 插件贡献项：按 editor 的 `ToolbarActiveState.marks` 判激活。 */
  activeMark?: string;
  /** 插件贡献项：自定义激活判定（优先于 activeMark）。 */
  isActive?(ctx: ToolbarContext): boolean;
  isDisabled?(ctx: ToolbarContext): boolean;
}
