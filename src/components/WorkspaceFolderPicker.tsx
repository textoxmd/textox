import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';

/** 仅显示路径的最后一级目录名（如 /a/b/c/d → d） */
function lastPathSegment(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

interface WorkspaceFolderPickerProps {
  /** 当前选择的工作区目录（未选择时为 null） */
  value: string | null;
  /** 未选择目录时显示的占位文案，同时用作目录选择对话框标题 */
  placeholder: string;
  /** 用户选择目录后回调（持久化由调用方负责） */
  onSelect: (path: string) => void;
  /** 目录选择/持久化失败时回调 */
  onError?: (error: unknown) => void;
}

/**
 * 工作区目录选择组件：一个可点击的路径按钮，点击打开系统目录选择器。
 * 已选目录时显示完整路径，未选择时显示占位文案。
 */
export function WorkspaceFolderPicker({
  value,
  placeholder,
  onSelect,
  onError,
}: WorkspaceFolderPickerProps) {
  return (
    <Button
      variant="outline"
      aria-label={placeholder}
      title={value || placeholder}
      className="flex h-8 w-46 items-center justify-start gap-2 px-2.5"
      onClick={async () => {
        try {
          const selected = await open({
            directory: true,
            multiple: false,
            title: placeholder,
          });
          if (selected && typeof selected === 'string') {
            onSelect(selected);
          }
        } catch (error) {
          console.error('Failed to select workspace folder:', error);
          onError?.(error);
        }
      }}
    >
      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-left text-sm font-normal text-foreground">
        {value ? lastPathSegment(value) : placeholder}
      </span>
    </Button>
  );
}
