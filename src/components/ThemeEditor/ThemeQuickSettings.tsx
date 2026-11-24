import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Sun, Moon } from 'lucide-react'
import { loadUserThemeCss } from '@/components/styles/theme-registry'
import { CODE_BLOCK_THEMES } from '@/utils/codeBlockThemes'
import { parseThemeCss, getScopeVars } from '@/components/styles/theme-css-parser'
import { oklchParse, oklchToHex, oklchFormat } from '@/components/styles/color-utils'
import {
  type ThemeQuickSettings,
  compactThemeQuickSettings,
  loadThemeQuickSettings,
  saveThemeQuickSettings,
} from '@/components/styles/theme-quick-settings'
import {
  composeThemeCss,
  getBuiltinThemeCss,
  syncSourceCodeThemeStorage,
} from '@/components/styles/theme'

interface ThemeQuickSettingsProps {
  themeId: string
}

type CodeThemeField =
  | 'sourceCodeThemeLight'
  | 'sourceCodeThemeDark'

function extractQuickDefaults(css: string): ThemeQuickSettings {
  const parsed = parseThemeCss(css)
  const scopeVars = getScopeVars(css)
  return {
    breatheLight: parsed.light?.['--breathe-color'] ?? null,
    breatheDark: parsed.dark?.['--breathe-color'] ?? null,
    sourceCodeThemeLight: scopeVars['--source-code-theme-light'] ?? null,
    sourceCodeThemeDark: scopeVars['--source-code-theme-dark'] ?? null,
  }
}

/**
 * 主题快速编辑（与 theme.css 解耦）。
 *
 * 所有取值保存在独立 JSON（quick-settings.json）中，应用主题时由
 * composeThemeCss 把 JSON 覆盖层追加在主题 CSS 之后生效，优先级高于 CSS 文件，
 * 因此这里不再改写或整体保存 theme.css。JSON 只记录用户实际改过的项，
 * 未改动的项实时跟随主题 CSS（含内置主题随版本更新的新取值）。
 */
export function ThemeQuickSettings({ themeId }: ThemeQuickSettingsProps) {
  const { t } = useTranslation()
  const [stored, setStored] = useState<ThemeQuickSettings | null>(null)
  const storedRef = useRef<ThemeQuickSettings | null>(null)
  const [cssDefaults, setCssDefaults] = useState<ThemeQuickSettings>({})
  // 串行化保存/预览，避免快速连续操作时旧请求后完成覆盖新值
  const persistChainRef = useRef<Promise<void>>(Promise.resolve())
  const [editMode, setEditMode] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    storedRef.current = stored
  }, [stored])

  const loadBaseCss = useCallback(async (id: string): Promise<string | null> => {
    return (await loadUserThemeCss(id)) || getBuiltinThemeCss(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [saved, css] = await Promise.all([
          loadThemeQuickSettings(themeId),
          loadBaseCss(themeId),
        ])
        if (cancelled) return
        // 旧 JSON 可能含显式 null（Rust Option 序列化），
        // 剔除后空字段才能正确落到 cssDefaults 上展示主题真实值。
        const nextStored = compactThemeQuickSettings(saved)
        setStored(nextStored)
        storedRef.current = nextStored
        setCssDefaults(css ? extractQuickDefaults(css) : {})
      } catch (e) {
        console.error('[ThemeQuickSettings] Load failed:', e)
        if (cancelled) return
        setStored({})
        storedRef.current = {}
        setCssDefaults({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [themeId, loadBaseCss])

  /** 更新 JSON 并实时预览：合成「主题 CSS + 覆盖层」并广播到各窗口 */
  const commit = useCallback(async (patch: Partial<ThemeQuickSettings>) => {
    const next: ThemeQuickSettings = { ...storedRef.current, ...patch }
    storedRef.current = next
    setStored(next)
    const persist = persistChainRef.current.catch(() => {}).then(async () => {
      await saveThemeQuickSettings(themeId, next)
      const css = await composeThemeCss(themeId)
      if (css) {
        // 源码模式主题沿用现有跨窗口同步通道（storage + codethemeschanged）
        syncSourceCodeThemeStorage(css)
        await invoke('preview_theme_css', { css })
      }
    })
    persistChainRef.current = persist
    try {
      await persist
    } catch (e) {
      console.error('[ThemeQuickSettings] Save failed:', e)
      toast.error(t('settings.themeSaveFailed'))
    }
  }, [themeId, t])

  const handleBreatheColorChange = useCallback((hex: string) => {
    const key = editMode === 'light' ? 'breatheLight' : 'breatheDark'
    commit({ [key]: oklchFormat(oklchParse(hex)) } as Partial<ThemeQuickSettings>)
  }, [editMode, commit])

  const handleCodeThemeChange = useCallback((field: CodeThemeField, value: string) => {
    commit({ [field]: value })
  }, [commit])

  // 实际生效值 = JSON 覆盖项 ?? 主题 CSS 当前值；未加载完成前退化为静态默认值
  const effective = useMemo<ThemeQuickSettings>(
    () => ({ ...cssDefaults, ...(stored ?? {}) }),
    [cssDefaults, stored],
  )

  const breatheValue = effective[editMode === 'light' ? 'breatheLight' : 'breatheDark']
  const currentBreatheHex = (() => {
    if (!breatheValue) return '#d48806'
    try {
      const hex = oklchToHex(oklchParse(breatheValue))
      if (/^#[0-9a-f]{6}$/i.test(hex)) return hex
    } catch {}
    return '#d48806'
  })()

  const scopeFieldValue = (field: CodeThemeField, fallback: string): string =>
    effective[field] || fallback

  return (
    <div className="flex flex-col gap-4">
      {/* ────────── Quick Colors ────────── */}
      <Card className="bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.quickEdit')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditMode(editMode === 'light' ? 'dark' : 'light')}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-150 cursor-pointer"
              title={editMode === 'light' ? t('settings.appearanceDark') : t('settings.appearanceLight')}
            >
              {editMode === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>
            <span className="text-xs text-muted-foreground">
              {editMode === 'light' ? t('settings.appearanceLight') : t('settings.appearanceDark')}
            </span>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.breatheColor')}</span>
              <span className="settings-item-description">{t('settings.breatheColorDesc')}</span>
            </div>
            <label className="relative cursor-pointer">
              <div
                className="w-6 h-6 rounded-full border-2 transition-colors"
                style={{ backgroundColor: currentBreatheHex, borderColor: currentBreatheHex }}
              />
              <input
                type="color"
                value={currentBreatheHex}
                onChange={(e) => handleBreatheColorChange(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ────────── Code & Display ────────── */}
      <Card className="bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.codeDisplay')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.sourceCodeThemeLight')}</span>
              <span className="settings-item-description">{t('settings.sourceCodeThemeLightDesc')}</span>
            </div>
            <Select
              value={scopeFieldValue('sourceCodeThemeLight', 'githubLight')}
              onValueChange={(v) => handleCodeThemeChange('sourceCodeThemeLight', v)}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_BLOCK_THEMES.filter(theme => !theme.isDark).map(theme => (
                  <SelectItem key={theme.value} value={theme.value}>{theme.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.sourceCodeThemeDark')}</span>
              <span className="settings-item-description">{t('settings.sourceCodeThemeDarkDesc')}</span>
            </div>
            <Select
              value={scopeFieldValue('sourceCodeThemeDark', 'vscodeDark')}
              onValueChange={(v) => handleCodeThemeChange('sourceCodeThemeDark', v)}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_BLOCK_THEMES.filter(theme => theme.isDark).map(theme => (
                  <SelectItem key={theme.value} value={theme.value}>{theme.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
