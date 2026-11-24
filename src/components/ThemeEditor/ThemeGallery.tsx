import { ThemePreviewCard } from './ThemePreviewCard';
import { type ColorThemeConfig } from '@/components/styles/theme-registry';

interface ThemeGalleryProps {
  themes: ColorThemeConfig[];
  selectedTheme: string;
  onSelect: (id: string) => void;
  getThemeName: (theme: ColorThemeConfig) => string;
  isFreeVersion?: boolean;
  onDuplicate?: (theme: ColorThemeConfig) => void;
  onRename?: (theme: ColorThemeConfig) => void;
  onExport?: (theme: ColorThemeConfig) => void;
  onDelete?: (theme: ColorThemeConfig) => void;
  onUpgradePrompt?: () => void;
  /** 隐藏每张卡片右上角的编辑菜单（只读场景） */
  hideEditMenu?: boolean;
}

/**
 * 主题画廊
 * 以网格形式展示所有可用主题，每张卡片同时显示亮/暗效果
 */
export function ThemeGallery({
  themes,
  selectedTheme,
  onSelect,
  getThemeName,
  isFreeVersion,
  onDuplicate,
  onRename,
  onExport,
  onDelete,
  onUpgradePrompt,
  hideEditMenu = false,
}: ThemeGalleryProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {themes.map(theme => (
        <ThemePreviewCard
          key={theme.id}
          themeId={theme.id}
          name={getThemeName(theme)}
          selected={theme.id === selectedTheme}
          isBuiltin={theme.isBuiltin}
          isFreeVersion={isFreeVersion}
          onClick={() => onSelect(theme.id)}
          onDuplicate={() => onDuplicate?.(theme)}
          onRename={() => onRename?.(theme)}
          onExport={() => onExport?.(theme)}
          onDelete={() => onDelete?.(theme)}
          onUpgradePrompt={onUpgradePrompt}
          showEditMenu={!hideEditMenu}
        />
      ))}
    </div>
  );
}
