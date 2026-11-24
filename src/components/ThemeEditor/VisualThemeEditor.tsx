import { useState, useEffect, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/GlassDialog'
import { toast } from 'sonner'
import { Sun, Moon, Palette, Code, ChevronDown, ChevronRight } from 'lucide-react'
import {
  BUILTIN_THEMES,
  initThemeRegistry,
  loadUserThemeCss,
  getAvailableThemes,
  type ColorThemeConfig,
} from '@/components/styles/theme-registry'
import { getBuiltinThemeCss } from '@/components/styles/theme'
import { VARIABLE_GROUPS } from '@/components/styles/theme-data'
import { CODE_BLOCK_THEMES } from '@/utils/codeBlockThemes'
import { parseThemeCss, replaceThemeBlocks, getScopeVars } from '@/components/styles/theme-css-parser'
import type { ThemeData } from '@/components/styles/theme-data'
import { oklchParse, oklchToHex, oklchFormat } from '@/components/styles/color-utils'
import { ThemeVariableGroup } from './ThemeVariableGroup'
import { ThemeSourcePreview } from './ThemeSourcePreview'

interface VisualThemeEditorProps {
  selectedTheme: string
  onListChange?: () => void
  listVersion?: number
}

type EditorMode = 'visual' | 'source'

const isFreeVersion = import.meta.env.VITE_FREE_VERSION === "true";

export function VisualThemeEditor({ selectedTheme, onListChange, listVersion }: VisualThemeEditorProps) {
  const { t } = useTranslation()
  const [themes, setThemes] = useState<ColorThemeConfig[]>(BUILTIN_THEMES)
  const [sourceCss, setSourceCss] = useState('')
  const [themeData, setThemeData] = useState<ThemeData>({ light: {}, dark: {} })
  const [scopeVars, setScopeVars] = useState<Record<string, string>>({})
  const [editMode, setEditMode] = useState<'light' | 'dark'>('light')
  const [editorMode, setEditorMode] = useState<EditorMode>('visual')
  const [overwriteDialogOpen, setOverwriteDialogOpen] = useState(false)
  const [overwriting, setOverwriting] = useState(false)
  const [dirtyGroup, setDirtyGroup] = useState<string | null>(null)
  const [originalData, setOriginalData] = useState<ThemeData>({ light: {}, dark: {} })

  const isBuiltinTheme = BUILTIN_THEMES.some(t => t.id === selectedTheme)

  const loadThemeList = useCallback(async () => {
    await initThemeRegistry()
    const list = getAvailableThemes()
    setThemes(list.length > 0 ? list : BUILTIN_THEMES)
  }, [])

  const loadTheme = useCallback(async (id: string) => {
    try {
      const builtin = BUILTIN_THEMES.some(t => t.id === id)
      let css: string | null = ''
      if (builtin) {
        css = getBuiltinThemeCss(id) || ''
      } else {
        css = await loadUserThemeCss(id)
      }
      if (css) {
        setSourceCss(css)
        const parsed = parseThemeCss(css)
        setThemeData(parsed)
        setOriginalData(parsed)
        setScopeVars(getScopeVars(css))
        setDirtyGroup(null)
      }
    } catch (e) {
      console.error('[VisualThemeEditor] loadTheme failed:', e)
    }
  }, [])

  useEffect(() => {
    loadThemeList()
  }, [loadThemeList, listVersion])

  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    setIsDirty(false)
  }, [selectedTheme])

  useEffect(() => {
    loadTheme(selectedTheme)
  }, [selectedTheme, loadTheme])



  const handleSourceCssChange = useCallback((css: string) => {
    setIsDirty(true)
    setSourceCss(css)
    try {
      const parsed = parseThemeCss(css)
      if (parsed.light && Object.keys(parsed.light).length > 0) {
        setThemeData(parsed)
      }
      setScopeVars(getScopeVars(css))
    } catch {
      // CSS 正在编辑中，暂不解析
    }
  }, [])

  const handleVarChange = useCallback((name: string, value: string) => {
    setIsDirty(true)
    for (const g of VARIABLE_GROUPS) {
      if (g.vars.includes(name)) {
        setDirtyGroup(g.id)
        break
      }
    }
    setThemeData(prev => {
      const next = { ...prev, [editMode]: { ...prev[editMode], [name]: value } }
      setSourceCss(prevCss => {
        try {
          return replaceThemeBlocks(prevCss, next)
        } catch {
          return prevCss
        }
      })
      return next
    })
  }, [editMode])

  const handleGroupCancel = useCallback((groupId: string) => {
    const group = VARIABLE_GROUPS.find(g => g.id === groupId)
    if (!group) return
    setThemeData(prev => {
      const next = { ...prev, [editMode]: { ...prev[editMode] } }
      for (const v of group.vars) {
        const orig = originalData[editMode]?.[v]
        if (orig !== undefined) {
          next[editMode][v] = orig
        }
      }
      setSourceCss(prevCss => {
        try {
          return replaceThemeBlocks(prevCss, next)
        } catch {
          return prevCss
        }
      })
      return next
    })
    setDirtyGroup(null)
    setIsDirty(false)
  }, [editMode, originalData])

  const handleCodeThemeChange = useCallback((name: string, value: string) => {
    setIsDirty(true)
    setScopeVars(prev => {
      const next = { ...prev, [name]: value }
      setSourceCss(prevCss => {
        try {
          return replaceThemeBlocks(prevCss, themeData, next)
        } catch {
          return prevCss
        }
      })
      // 实时预览源码主题切换（跨窗口通信）
      if (name === '--source-code-theme-light' || name === '--source-code-theme-dark') {
        localStorage.setItem('texto-source-code-theme-light', next['--source-code-theme-light'] || '')
        localStorage.setItem('texto-source-code-theme-dark', next['--source-code-theme-dark'] || '')
      }
      return next
    })
  }, [themeData])

  const handleBreatheColorChange = useCallback((hex: string) => {
    const oklch = oklchParse(hex)
    const oklchStr = oklchFormat(oklch)
    handleVarChange('--breathe-color', oklchStr)
  }, [handleVarChange])

  const [quickEditOpen, setQuickEditOpen] = useState(true)

  const currentBreatheHex = (() => {
    const raw = themeData[editMode]?.['--breathe-color']
    if (!raw) return '#d48806'
    try {
      const hex = oklchToHex(oklchParse(raw))
      if (/^#[0-9a-f]{6}$/i.test(hex)) return hex
    } catch {}
    return '#d48806'
  })()

  const previewCss = useMemo(() => {
    if (!sourceCss) return ''
    try {
      return replaceThemeBlocks(sourceCss, themeData, scopeVars)
    } catch {
      return sourceCss
    }
  }, [sourceCss, themeData, scopeVars])

  const currentValues = themeData[editMode]

  const switchEditorMode = useCallback((mode: EditorMode) => {
    setEditorMode(mode)
  }, [])

  const handleOverwrite = async () => {
    const theme = themes.find(t => t.id === selectedTheme)
    if (!theme || isBuiltinTheme) return
    const css = replaceThemeBlocks(sourceCss, themeData, scopeVars)
    setOverwriting(true)
    try {
      await invoke('save_theme_css', {
        request: { id: theme.id, name: theme.label || theme.name, css },
      })
      toast.success(t('settings.themeSaveSuccess'))
      setIsDirty(false)
      setDirtyGroup(null)
      setOverwriteDialogOpen(false)
      await loadThemeList()
      onListChange?.()
      await invoke('preview_theme_css', { css: previewCss })
      // 覆盖保存后同步 localStorage（覆盖由 preview_theme_css 触发的 codethemeschanged）
      const nextLight = scopeVars['--source-code-theme-light']
      const nextDark = scopeVars['--source-code-theme-dark']
      if (nextLight) localStorage.setItem('texto-source-code-theme-light', nextLight)
      if (nextDark) localStorage.setItem('texto-source-code-theme-dark', nextDark)
    } catch (e) {
      console.error('Failed to overwrite theme:', e)
      toast.error(t('settings.themeSaveFailed'))
    } finally {
      setOverwriting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ────────── Color Card ────────── */}
      <Card className="bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.themeEdit')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditMode(editMode === 'light' ? 'dark' : 'light')}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-150 cursor-pointer"
              >
                {editMode === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              </button>
              <div className="flex items-center rounded-lg bg-muted p-0.5 shadow-inner">
                <button
                  type="button"
                  onClick={() => switchEditorMode('visual')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                    editorMode === 'visual'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  Visual
                </button>
                <button
                  type="button"
                  onClick={() => switchEditorMode('source')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                    editorMode === 'source'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Code className="w-3.5 h-3.5" />
                  Source
                </button>
              </div>
            </div>
          </div>

          {isFreeVersion && (
            <div className="alert-banner info">
              {t('upgrade.banner')}
            </div>
          )}

          {isBuiltinTheme && !isFreeVersion && (
            <div className="alert-banner warning">
              {t('settings.readonlyThemeBanner')}
            </div>
          )}

          {editorMode === 'visual' ? (
            <div className="space-y-3">
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setQuickEditOpen(!quickEditOpen)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  {quickEditOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {t('settings.quickEdit')}
                </button>
                {quickEditOpen && (
                  <div className="space-y-3">
                    <div className="settings-item">
                      <div className="settings-item-info">
                        <span className="settings-item-label">{t('settings.breatheColor')}</span>
                        <span className="settings-item-description">{t('settings.breatheColorDesc')}</span>
                      </div>
                      <label className={`relative ${isBuiltinTheme ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <div
                          className="w-6 h-6 rounded-full border-2 transition-colors"
                          style={{ backgroundColor: currentBreatheHex, borderColor: currentBreatheHex }}
                        />
                        <input
                          type="color"
                          value={currentBreatheHex}
                          onChange={(e) => handleBreatheColorChange(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full"
                          disabled={isBuiltinTheme}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
              {VARIABLE_GROUPS.map(group => (
                <ThemeVariableGroup
                  key={group.id}
                  label={t(group.translationKey)}
                  vars={group.vars}
                  values={currentValues}
                  onVarChange={handleVarChange}
                  showSave={!isBuiltinTheme && isDirty && dirtyGroup === group.id}
                  onSave={() => setOverwriteDialogOpen(true)}
                  onCancel={() => handleGroupCancel(group.id)}
                  disabled={isBuiltinTheme}
                />
              ))}
            </div>
          ) : (
            <div className="min-h-[300px]">
              <ThemeSourcePreview
                css={sourceCss}
                onChange={isBuiltinTheme ? undefined : handleSourceCssChange}
                editable={!isBuiltinTheme}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ────────── Code & Display Card ────────── */}
      <Card className="bg-background ring-0">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{t('settings.codeDisplay')}</CardTitle>
            {!isBuiltinTheme && isDirty && (
              <Button
                variant="outline"
                onClick={() => setOverwriteDialogOpen(true)}
                disabled={overwriting}
              >
                {t('common.save')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.sourceCodeThemeLight')}</span>
              <span className="settings-item-description">{t('settings.sourceCodeThemeLightDesc')}</span>
            </div>
            <Select
              value={scopeVars['--source-code-theme-light'] || 'githubLight'}
              onValueChange={(v) => handleCodeThemeChange('--source-code-theme-light', v)}
              disabled={isBuiltinTheme}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_BLOCK_THEMES.filter(t => !t.isDark).map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
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
              value={scopeVars['--source-code-theme-dark'] || 'vscodeDark'}
              onValueChange={(v) => handleCodeThemeChange('--source-code-theme-dark', v)}
              disabled={isBuiltinTheme}
            >
              <SelectTrigger className="w-46">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_BLOCK_THEMES.filter(t => t.isDark).map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Dialog open={overwriteDialogOpen} onOpenChange={setOverwriteDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-muted-foreground font-normal">{t('common.save')}</DialogTitle>
            <DialogDescription>
              {t('settings.overwriteThemeConfirm', { name: themes.find(t => t.id === selectedTheme)?.label || themes.find(t => t.id === selectedTheme)?.name || selectedTheme })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setOverwriteDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" className="rounded-lg" onClick={handleOverwrite} disabled={overwriting}>
              {overwriting ? '...' : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
