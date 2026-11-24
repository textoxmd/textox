import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { wrapIn } from "prosemirror-commands";
import type { Schema } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import {
  Heading1,
  Heading2,
  Heading3,
  Heading,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  TextQuote,
  Minus,
  Image,
  Link,
  PenTool,
  type LucideIcon,
} from "lucide-react";
import { dismissMenu, getTriggerCoords, getFilterText } from "./index.ts";
import type { EmbedInsert } from "@texto/markdown-editor-api";
import { editorEmbedInserts, editorInsertCommands } from "../../extension/registry.ts";
import { iconComponentFromSpec } from "../../editorIcons.ts";

type SlashCommand = {
  keyword: string;
  labelKey: string;
  icon: LucideIcon;
  handler: (view: EditorView, triggerPos: number) => void;
  /** 已解析的显示文案（embed 贡献命令用）；存在时优先于 labelKey */
  label?: string;
  /** 嵌入引用命令：单文件模式下隐藏（与 image 一致） */
  isEmbed?: boolean;
};

function buildCommands(
  onInsertImageRequest?: () => void,
): SlashCommand[] {
  function h(keyword: string, labelKey: string, level: number, Icon: LucideIcon): SlashCommand {
    return {
      keyword,
      labelKey,
      icon: Icon,
      handler: (view, triggerPos) => {
        executeBlockCommand(view, triggerPos, (schema) =>
          schema.nodes.heading!.create({ level }),
        );
      },
    };
  }

  return [
    h("h1", "h1", 1, Heading1),
    h("h2", "h2", 2, Heading2),
    h("h3", "h3", 3, Heading3),
    h("h4", "h4", 4, Heading),
    h("h5", "h5", 5, Heading),
    h("h6", "h6", 6, Heading),

    { keyword: "ul", labelKey: "ul", icon: List, handler: wrapInHandler("bullet_list") },
    { keyword: "ol", labelKey: "ol", icon: ListOrdered, handler: wrapInHandler("ordered_list") },
    { keyword: "task", labelKey: "task", icon: CheckSquare, handler: taskHandler },
    { keyword: "code", labelKey: "code", icon: Code, handler: blockCommandHandler("code_block") },
    {
      keyword: "quote",
      labelKey: "quote",
      icon: TextQuote,
      handler: wrapInHandler("blockquote"),
    },
    {
      keyword: "hr",
      labelKey: "hr",
      icon: Minus,
      handler: hrHandler,
    },
    {
      keyword: "image",
      labelKey: "image",
      icon: Image,
      handler: imageHandler(onInsertImageRequest),
    },
    { keyword: "link", labelKey: "link", icon: Link, handler: linkHandler },
  ];
}

function executeBlockCommand(
  view: EditorView,
  triggerPos: number,
  buildNode: (schema: Schema) => any,
) {
  const { state } = view;
  const $trigger = state.doc.resolve(triggerPos);
  if ($trigger.parent.type.name !== "paragraph") return;
  const paraStart = $trigger.before();
  const paraEnd = $trigger.after();
  const node = buildNode(state.schema);
  const tr = state.tr.replaceWith(paraStart, paraEnd, node);
  view.dispatch(tr);
  view.focus();
}

function delTriggerText(view: EditorView, triggerPos: number) {
  const { state } = view;
  const from = triggerPos;
  const to = state.selection.from;
  if (from < to) {
    const tr = state.tr.delete(from, to);
    view.dispatch(tr);
  }
}

function wrapInHandler(type: string) {
  const nodeTypeKey = type as keyof Schema["nodes"];
  return (view: EditorView, triggerPos: number) => {
    delTriggerText(view, triggerPos);
    const nodeType = view.state.schema.nodes[nodeTypeKey]!;
    wrapIn(nodeType)(view.state, view.dispatch, view);
    view.focus();
  };
}

function blockCommandHandler(type: string, attrs?: Record<string, any>) {
  const nodeTypeKey = type as keyof Schema["nodes"];
  return (view: EditorView, triggerPos: number) => {
    executeBlockCommand(view, triggerPos, (schema) =>
      schema.nodes[nodeTypeKey]!.create(attrs ?? undefined),
    );
  };
}

const taskHandler = (view: EditorView, triggerPos: number) => {
  const { state } = view;
  const $trigger = state.doc.resolve(triggerPos);
  const paraStart = $trigger.before();
  const paraEnd = $trigger.after();
  const keywordLen = state.selection.from - triggerPos;
  const remaining = $trigger.parent.content.cut(keywordLen);
  const taskMarker = state.schema.nodes.task_marker!.create({ checked: false });
  const content = Fragment.from(taskMarker).append(remaining);
  const para = state.schema.nodes.paragraph!.create(null, content);
  const listItem = state.schema.nodes.list_item!.create(null, para);
  const bulletList = state.schema.nodes.bullet_list!.create(null, listItem);
  const tr = state.tr.replaceWith(paraStart, paraEnd, bulletList);
  view.dispatch(tr);
  view.focus();
};

const hrHandler = (view: EditorView, triggerPos: number) => {
  const { state } = view;
  const $trigger = state.doc.resolve(triggerPos);
  const paraStart = $trigger.before();
  const paraEnd = $trigger.after();
  const hr = state.schema.nodes.horizontal_rule!.create();
  const empty = state.schema.nodes.paragraph!.create();
  const tr = state.tr.replaceWith(paraStart, paraEnd, [hr, empty]);
  view.dispatch(tr);
  view.focus();
};

function imageHandler(onInsertImageRequest?: () => void) {
  return (view: EditorView, triggerPos: number) => {
    delTriggerText(view, triggerPos);
    onInsertImageRequest?.();
  };
}

const linkHandler = (view: EditorView, triggerPos: number) => {
  const { state } = view;
  const textFrom = triggerPos;
  const textTo = state.selection.from;
  const insText = "[link text](url)";
  const tr = state.tr.delete(textFrom, textTo).insertText(insText);
  tr.setSelection(TextSelection.create(tr.doc, textFrom + 1, textFrom + 10));
  view.dispatch(tr);
  view.focus();
};

interface SlashMenuProps {
  view: EditorView;
  triggerPos: number;
  onClose: () => void;
  onInsertImageRequest?: () => void;
  /** 由 embed 贡献的"插入引用"命令触发（骨架负责弹框选文件并插入） */
  onInsertEmbedRequest?: (embed: EmbedInsert) => void;
  isSingleFileMode?: boolean;
}

export function SlashMenu({
  view,
  triggerPos,
  onClose,
  onInsertImageRequest,
  onInsertEmbedRequest,
  isSingleFileMode,
}: SlashMenuProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(selectedIndex);
  const isKeyboardNavigating = useRef(false);
  const keyboardTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const menuRef = useRef<HTMLDivElement>(null);
  const filterText = getFilterText(view, triggerPos);

  const labelOf = useCallback(
    (cmd: SlashCommand) => cmd.label ?? t(`slash.${cmd.labelKey}`),
    [t],
  );

  const commands = useMemo(() => {
    // 嵌入引用命令由 embed 贡献驱动（骨架不写死任何具体类型）。
    const embedCommands: SlashCommand[] = editorEmbedInserts()
      .filter((e) => !!e.insertLabelKey)
      .map((embed) => {
        const ext = embed.extensions[0]?.replace(/^\./, "") ?? embed.id;
        return {
          keyword: ext,
          labelKey: "",
          label: t(embed.insertLabelKey!),
          icon: PenTool,
          isEmbed: true,
          handler: (view, triggerPos) => {
            delTriggerText(view, triggerPos);
            onInsertEmbedRequest?.(embed);
          },
        };
      });
    const insertCommands: SlashCommand[] = editorInsertCommands().map((cmd) => ({
      keyword: cmd.keyword,
      labelKey: "",
      label: t(cmd.labelKey),
      icon: iconComponentFromSpec(cmd.icon) as unknown as LucideIcon,
      handler: (view, triggerPos) => {
        delTriggerText(view, triggerPos);
        cmd.insert(view);
      },
    }));
    return [...buildCommands(onInsertImageRequest), ...insertCommands, ...embedCommands].filter(
      (cmd) => (cmd.keyword !== "image" && !cmd.isEmbed) || !isSingleFileMode,
    );
  }, [onInsertImageRequest, onInsertEmbedRequest, isSingleFileMode, t]);

  const filtered = useMemo(
    () =>
      filterText
        ? commands.filter((cmd) => {
            const q = filterText.toLowerCase();
            return (
              cmd.keyword.includes(q) ||
              labelOf(cmd).toLowerCase().includes(q)
            );
          })
        : commands,
    [commands, filterText, labelOf],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filterText]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      dismissMenu(view);
      onClose();
      setTimeout(() => cmd.handler(view, triggerPos), 0);
    },
    [view, triggerPos, onClose],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter" && e.key !== "Tab")
        return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === "Enter" || e.key === "Tab") {
        const cmd = filtered[selectedIndexRef.current];
        if (cmd) selectCommand(cmd);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        isKeyboardNavigating.current = true;
        clearTimeout(keyboardTimeoutRef.current);
        keyboardTimeoutRef.current = setTimeout(() => {
          isKeyboardNavigating.current = false;
        }, 100);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [filtered, selectCommand]);

  useEffect(() => {
    if (filtered.length === 0) return;
    const el = document.getElementById(`slash-cmd-${filtered[selectedIndex]?.keyword}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filtered]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        dismissMenu(view);
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [view, onClose]);

  const coords = getTriggerCoords(view, triggerPos);
  if (!coords) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-activedescendant={
        selectedIndex >= 0 && selectedIndex < filtered.length
          ? `slash-cmd-${filtered[selectedIndex]!.keyword}`
          : undefined
      }
      tabIndex={-1}
      className="fixed z-[9999] max-h-64 overflow-y-auto rounded-lg border bg-popover p-1.5 shadow-md min-w-[120px] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      style={{ top: coords.bottom + 4, left: coords.left }}
    >
      {filtered.length === 0 && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          {t("slash.noMatch")}
        </div>
      )}
      {filtered.map((cmd, i) => {
        const Icon = cmd.icon;
        const q = filterText.toLowerCase();
const kw = cmd.keyword;
const idx = kw.toLowerCase().indexOf(q);
return (
  <div
    key={cmd.keyword}
    id={`slash-cmd-${cmd.keyword}`}
    role="option"
    aria-selected={i === selectedIndex}
    onMouseEnter={() => {
      if (!isKeyboardNavigating.current) setSelectedIndex(i);
    }}
    onMouseDown={(e) => {
      e.preventDefault();
      e.stopPropagation();
      selectCommand(cmd);
    }}
    className={`flex items-center gap-3 px-3 py-1.5 text-sm cursor-default outline-none whitespace-nowrap rounded-md ${
      i === selectedIndex ? "bg-muted text-foreground" : "text-muted-foreground"
    }`}
  >
    <span className="flex size-4 items-center justify-center text-foreground/70 shrink-0">
      <Icon size={16} />
    </span>
    <span className="text-foreground">{labelOf(cmd)}</span>
    <span className="font-mono text-xs w-[52px] shrink-0 ml-auto">
      <span className="text-muted-foreground/50">/</span>
      {idx !== -1 ? (
        <>
          <span className="text-muted-foreground/50">{kw.slice(0, idx)}</span>
          <span className="text-foreground font-semibold underline decoration-primary/40 decoration-2 underline-offset-2">
            {kw.slice(idx, idx + q.length)}
          </span>
          <span className="text-muted-foreground/50">{kw.slice(idx + q.length)}</span>
        </>
      ) : (
        <span className="text-muted-foreground/50">{kw}</span>
      )}
    </span>
  </div>
        );
      })}
    </div>,
    document.body,
  );
}
