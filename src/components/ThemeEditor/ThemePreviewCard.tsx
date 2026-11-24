import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Copy, Trash2, Download, Pencil } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useThemeColors, type ThemeColors, type ThemeColorPair } from './useThemeColors';

interface ThemePreviewCardProps {
  themeId: string;
  name: string;
  selected?: boolean;
  isBuiltin?: boolean;
  isFreeVersion?: boolean;
  onClick?: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onUpgradePrompt?: () => void;
  /** 隐藏右上角编辑菜单（只读场景，如设置向导） */
  showEditMenu?: boolean;
}

/**
 * 单个主题预览卡片
 * 采用 macOS 风格比例，左右分别展示亮/暗模式下的简化界面骨架
 */
export function ThemePreviewCard({
  themeId,
  name,
  selected,
  isBuiltin,
  isFreeVersion,
  onClick,
  onDuplicate,
  onRename,
  onExport,
  onDelete,
  onUpgradePrompt,
  showEditMenu = true,
}: ThemePreviewCardProps) {
  const { loading, colors } = useThemeColors(themeId);

  if (loading || !colors) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="w-full aspect-[16/10] rounded-xl bg-muted animate-pulse border border-border/40" />
        <span className="text-xs text-muted-foreground">{name}</span>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={[
        'group flex flex-col items-center gap-2 w-full text-left',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl',
      ].join(' ')}
      aria-pressed={selected}
    >
      <ThemeSwatch
        colors={colors}
        selected={selected}
        isBuiltin={isBuiltin}
        isFreeVersion={isFreeVersion}
        onDuplicate={onDuplicate}
        onRename={onRename}
        onExport={onExport}
        onDelete={onDelete}
        onUpgradePrompt={onUpgradePrompt}
        showEditMenu={showEditMenu}
      />
      <span
        className={[
          'text-xs truncate max-w-full px-1',
          selected ? 'text-foreground font-medium' : 'text-muted-foreground',
        ].join(' ')}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}

/**
 * 主题色块
 * 横向 16:10，左侧亮色背景，右侧暗色背景，均带简化骨架元素
 */
function ThemeSwatch({
  colors,
  selected,
  isBuiltin,
  isFreeVersion,
  onDuplicate,
  onRename,
  onExport,
  onDelete,
  onUpgradePrompt,
  showEditMenu = true,
}: {
  colors: ThemeColorPair;
  selected?: boolean;
  isBuiltin?: boolean;
  isFreeVersion?: boolean;
  onDuplicate?: () => void;
  onRename?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onUpgradePrompt?: () => void;
  showEditMenu?: boolean;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  // 选中时给整张卡片外圈加一层淡淡的主题主色背景，形成"托起"效果
  const isDark = document.documentElement.classList.contains('dark');
  const themePrimary = isDark ? colors.dark.primary : colors.light.primary;
  const highlightBg = selected
    ? `color-mix(in oklch, ${themePrimary} 12%, transparent)`
    : 'transparent';

  return (
    <div
      className={[
        'w-full rounded-xl transition-all duration-200 p-1.5',
        selected ? 'shadow-md' : '',
      ].join(' ')}
      style={{ backgroundColor: highlightBg }}
    >
      <div
        className={[
          'relative w-full aspect-[16/10] rounded-lg overflow-hidden flex',
          'transition-all duration-200',
          selected ? '' : 'ring-1 ring-border/40 group-hover:ring-border',
        ].join(' ')}
      >
        {/* 亮色背景与骨架 */}
        <div
          className="flex-1 relative"
          style={{ backgroundColor: colors.light.background }}
        >
          <MiniEditorSkeleton colors={colors.light} />
        </div>

        {/* 暗色背景与骨架 */}
        <div
          className="flex-1 relative"
          style={{ backgroundColor: colors.dark.background }}
        >
          <MiniEditorSkeleton colors={colors.dark} />
        </div>

        {/* 编辑菜单（设置页保留；只读场景可隐藏） */}
        {showEditMenu && (
          <div
            className="absolute top-1 right-1 z-10"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              title={t('common.edit')}
              className={[
              'inline-flex items-center justify-center',
              'size-6 rounded-full bg-muted/90 backdrop-blur-sm border border-border shadow-sm',
              'text-muted-foreground hover:text-foreground hover:bg-muted',
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-200 cursor-pointer',
            ].join(' ')}
            onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-auto min-w-0 p-1 [font-size:var(--font-size-settings)]"
            >
              <div className="flex flex-col">
                {!(isFreeVersion && !isBuiltin) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      if (isFreeVersion) {
                        onUpgradePrompt?.();
                      } else {
                        onDuplicate?.();
                      }
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted text-foreground"
                  >
                    <Copy className="size-3.5" />
                    {t('settings.duplicateTheme')}
                  </button>
                )}
                {!isBuiltin && !isFreeVersion && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onRename?.();
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted text-foreground"
                  >
                    <Pencil className="size-3.5" />
                    {t('settings.renameTheme')}
                  </button>
                )}
                {!isBuiltin && !isFreeVersion && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onExport?.();
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted text-foreground"
                  >
                    <Download className="size-3.5" />
                    {t('settings.exportTheme')}
                  </button>
                )}
                {!isBuiltin && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete?.();
                    }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    {t('settings.deleteTheme')}
                  </button>
                )}
              </div>
            </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 简化版编辑器骨架
 * 仅保留顶部标题栏按钮与内容区横线，去掉侧边栏以节省空间
 */
function MiniEditorSkeleton({ colors }: { colors: ThemeColors }) {
  return (
    <div className="absolute inset-0 flex flex-col p-1.5">
      {/* 顶部窗口按钮 */}
      <div className="flex items-center gap-0.5 mb-1.5">
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: colors.destructive }} />
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: colors.muted }} />
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: colors.accent }} />
      </div>

      {/* 内容区横线 */}
      <div className="flex-1 flex flex-col gap-1 relative">
        <span className="w-full h-0.5 rounded-full" style={{ backgroundColor: colors.foreground, opacity: 0.7 }} />
        <span className="w-5/6 h-0.5 rounded-full" style={{ backgroundColor: colors.foreground, opacity: 0.5 }} />
        <span className="w-3/4 h-0.5 rounded-full" style={{ backgroundColor: colors.foreground, opacity: 0.5 }} />

        {/* 底部强调圆点 */}
        <span
          className="absolute right-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: colors.primary }}
        />
      </div>
    </div>
  );
}
