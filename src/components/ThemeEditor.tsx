import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/GlassDialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { showGlassDialog } from '@/components/GlassDialog'

import {
  BUILTIN_THEMES,
  initThemeRegistry,
  deleteUserTheme,
  loadUserThemeCss,
  getAvailableThemes,
  type ColorThemeConfig,
} from '@/components/styles/theme-registry'
import { getBuiltinThemeCss, setColorTheme, setAppearance, getCurrentAppearance, getColorThemeTranslationKey, type Appearance } from '@/components/styles/theme'
import { loadThemeQuickSettings, saveThemeQuickSettings } from '@/components/styles/theme-quick-settings'
import { ThemePreviewCard } from '@/components/ThemeEditor/ThemePreviewCard'
import { ThemeQuickSettings } from '@/components/ThemeEditor/ThemeQuickSettings'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'


const isFreeVersion = import.meta.env.VITE_FREE_VERSION === "true";

export function ThemeEditor() {
  const { t } = useTranslation()
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    try { return localStorage.getItem('texto-color-theme') || 'default' } catch { return 'default' }
  })
  const [themes, setThemes] = useState<ColorThemeConfig[]>(BUILTIN_THEMES)
  const [duplicateTarget, setDuplicateTarget] = useState<ColorThemeConfig | null>(null)
  const [duplicateName, setDuplicateName] = useState('')

  const [renameTarget, setRenameTarget] = useState<ColorThemeConfig | null>(null)
  const [renameName, setRenameName] = useState('')
  const [currentAppearance, setCurrentAppearance] = useState<Appearance>(() => {
    try { return getCurrentAppearance() } catch { return 'system' }
  })

  const loadThemeList = useCallback(async () => {
    await initThemeRegistry()
    const list = getAvailableThemes()
    setThemes(list.length > 0 ? list : BUILTIN_THEMES)
  }, [])

  useEffect(() => {
    loadThemeList()
  }, [loadThemeList])

  // 监听外部（如菜单栏）的配置变更，同步外观和主题状态
  useEffect(() => {
    const unlisten = listen('config-changed', (event: any) => {
      const config = event.payload as any
      if (config.appearance) {
        setCurrentAppearance(config.appearance as Appearance)
        setAppearance(config.appearance as Appearance)
      }
      if (config.color_theme) {
        setSelectedTheme(config.color_theme as string)
        setColorTheme(config.color_theme as string)
      }
    })
    return () => { unlisten.then((fn: any) => fn()) }
  }, [])

  const handleExport = async (themeId: string) => {
    try {
      await invoke<string>('export_theme', { id: themeId })
      toast.success(t('settings.themeExportSuccess'))
    } catch (e) {
      const msg = String(e)
      if (msg !== 'Export cancelled') {
        console.error('Failed to export theme:', e)
        toast.error(t('settings.themeExportFailed'))
      }
    }
  }

  const handleImport = async () => {
    try {
      const result = await invoke<{ success: boolean; css?: string; suggested_name?: string; error?: string }>('preview_import')
      if (result.success && result.css && result.suggested_name) {
        const id = crypto.randomUUID()
        await invoke('save_theme_css', { request: { id, name: result.suggested_name.trim(), css: result.css } })
        toast.success(t('settings.themeImportSuccess'))
        await loadThemeList()
        setSelectedTheme(id)
      } else if (result.error && result.error !== 'No file selected') {
        toast.error(result.error)
      }
    } catch (error) {
      console.error('Failed to import theme:', error)
      toast.error(t('settings.themeImportFailed'))
    }
  }

  const handleLiteImport = async () => {
    if (themes.filter(t => !t.isBuiltin).length >= 2) {
      const { showUpgradePrompt } = await import('@/utils/upgradePrompt')
      await showUpgradePrompt('upgrade.features.themeLimit')
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        filters: [{ name: 'CSS Theme Files', extensions: ['css'] }],
        multiple: false,
      })
      if (!selected) return
      const css = await invoke<string>('read_file', { path: selected })
      if (/@import|url\(https?:\/\/|@font-face/i.test(css)) {
        toast.error(t('settings.themeImportFailed'))
        return
      }
      const name = selected.split(/[/\\]/).pop()?.replace(/\.css$/i, '') || 'Imported Theme'
      const id = crypto.randomUUID()
      await invoke('save_theme_css', { request: { id, name, css } })
      toast.success(t('settings.themeImportSuccess'))
      await loadThemeList()
      setSelectedTheme(id)
    } catch (error) {
      console.error('Failed to import theme:', error)
      toast.error(t('settings.themeImportFailed'))
    }
  }

  const handleSelectTheme = async (id: string) => {
    setSelectedTheme(id)
    setColorTheme(id)
    try {
      const current = await invoke<any>('get_config')
      await invoke('set_config', { config: { ...current, color_theme: id } })
    } catch (e) {
      console.error('Failed to save theme config:', e)
      toast.error(String(e))
    }
  }

  const handleDuplicateRequest = (theme: ColorThemeConfig) => {
    if (isFreeVersion) {
      import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.customThemes'))
      return
    }
    const suffix = t('settings.duplicateThemeSuffix') || 'Copy'
    setDuplicateTarget(theme)
    const baseName = theme.label || theme.name
    setDuplicateName(`${baseName} ${suffix}`)
  }

  const handleDuplicateConfirm = async () => {
    if (!duplicateTarget || !duplicateName.trim()) {
      toast.error(t('settings.themeNameRequired'))
      return
    }
    try {
      const builtin = BUILTIN_THEMES.some(t => t.id === duplicateTarget.id)
      let css: string | null = ''
      if (builtin) {
        css = getBuiltinThemeCss(duplicateTarget.id) || ''
      } else {
        css = await loadUserThemeCss(duplicateTarget.id)
      }
      if (!css) {
        toast.error(t('settings.themeDuplicateFailed'))
        return
      }
      const id = crypto.randomUUID()
      await invoke('save_theme_css', {
        request: { id, name: duplicateName.trim(), css },
      })
      // 快速编辑覆盖配置跟随主题一起复制（与 CSS 解耦，需单独拷贝）
      try {
        const quick = await loadThemeQuickSettings(duplicateTarget.id)
        if (quick) {
          await saveThemeQuickSettings(id, quick)
        }
      } catch (e) {
        console.warn('Failed to copy theme quick settings:', e)
      }
      toast.success(t('settings.themeDuplicateSuccess'))
      await loadThemeList()
      setDuplicateTarget(null)
      setDuplicateName('')
      setSelectedTheme(id)
      setColorTheme(id)
      const current = await invoke<any>('get_config')
      await invoke('set_config', { config: { ...current, color_theme: id } })
    } catch (e) {
      console.error('Failed to duplicate theme:', e)
      toast.error(t('settings.themeDuplicateFailed'))
    }
  }

  const handleDeleteTheme = async (theme: ColorThemeConfig) => {
    const confirmed = await showGlassDialog<boolean>({
      title: t('settings.deleteTheme'),
      content: t('settings.deleteThemeConfirm', { name: theme.label || theme.name }),
      buttons: [
        { text: t('common.cancel'), variant: 'secondary', value: false },
        { text: t('common.delete'), variant: 'primary', value: true },
      ],
      dismissValue: false,
      focusButtonIndex: 0,
    })
    if (!confirmed) return

    const wasActive = theme.id === selectedTheme
    await deleteUserTheme(theme.id)
    toast.success(t('settings.themeDeleteSuccess'))
    if (wasActive) {
      setSelectedTheme('default')
      setColorTheme('default')
      try {
        const current = await invoke<any>('get_config')
        await invoke('set_config', { config: { ...current, color_theme: 'default' } })
      } catch (e) { console.error(e) }
    }
    loadThemeList()
  }

  const handleRenameRequest = (theme: ColorThemeConfig) => {
    setRenameTarget(theme)
    setRenameName(theme.label || theme.name)
  }

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameName.trim()) {
      toast.error(t('settings.themeNameRequired'))
      return
    }
    try {
      const css = await loadUserThemeCss(renameTarget.id)
      if (!css) {
        toast.error(t('settings.themeSaveFailed'))
        return
      }
      await invoke('save_theme_css', {
        request: { id: renameTarget.id, name: renameName.trim(), css },
      })
      toast.success(t('settings.themeSaveSuccess'))
      await loadThemeList()
      setRenameTarget(null)
      setRenameName('')
    } catch (e) {
      console.error('Failed to rename theme:', e)
      toast.error(t('settings.themeSaveFailed'))
    }
  }

  const getThemeDisplayName = (theme: ColorThemeConfig) => {
    if (theme.isBuiltin) {
      return t(getColorThemeTranslationKey(theme.id))
    }
    return theme.label || theme.name
  }

  const builtinThemes = themes.filter(t => t.isBuiltin)
  let userThemes = themes.filter(t => !t.isBuiltin)
  if (isFreeVersion) {
    userThemes = userThemes.slice(0, 2)
  }

  return (
    <>
      <Card className="flex-shrink-0 bg-background ring-0">
        <CardHeader>
          <CardTitle>{t('settings.themeManagement')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <span className="text-xs text-muted-foreground mb-2 block">
              {t('settings.themePresets')}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {builtinThemes.map(theme => (
                <ThemePreviewCard
                  key={theme.id}
                  themeId={theme.id}
                  name={getThemeDisplayName(theme)}
                  selected={theme.id === selectedTheme}
                  isBuiltin
                  isFreeVersion={isFreeVersion}
                  onClick={() => handleSelectTheme(theme.id)}
                  onDuplicate={() => handleDuplicateRequest(theme)}
                  onUpgradePrompt={() => import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.customThemes'))}
                />
              ))}
            </div>
          </div>

          {userThemes.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground mb-2 block">
                {t('settings.themeCustomProfiles')}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {userThemes.map(theme => (
                  <ThemePreviewCard
                    key={theme.id}
                    themeId={theme.id}
                    name={getThemeDisplayName(theme)}
                    selected={theme.id === selectedTheme}
                    isBuiltin={false}
                    isFreeVersion={isFreeVersion}
                    onClick={() => handleSelectTheme(theme.id)}
                    onDuplicate={() => handleDuplicateRequest(theme)}
                    onRename={() => handleRenameRequest(theme)}
                    onExport={() => handleExport(theme.id)}
                    onDelete={() => handleDeleteTheme(theme)}
                    onUpgradePrompt={() => import('@/utils/upgradePrompt').then(m => m.showUpgradePrompt('upgrade.features.customThemes'))}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label">{t('settings.appearance')}</span>
              <span className="settings-item-description">{t('settings.appearanceDesc')}</span>
            </div>
            <Select
              value={currentAppearance}
              onValueChange={async (value: Appearance) => {
                setCurrentAppearance(value)
                setAppearance(value)
                try {
                  const current = await invoke<any>('get_config')
                  await invoke('set_config', { config: { ...current, appearance: value } })
                } catch (e) {
                  console.error('Failed to save appearance config:', e)
                  toast.error(String(e))
                }
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('settings.appearanceLight')}</SelectItem>
                <SelectItem value="dark">{t('settings.appearanceDark')}</SelectItem>
                <SelectItem value="system">{t('settings.appearanceSystem')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <span className="settings-item-label flex items-center gap-1.5">
                {t('settings.importTheme')}
                <Popover>
                  <PopoverTrigger className="flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Info className="h-3 w-3" />
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-4" side="bottom" align="start">
                    <p className="text-xs text-foreground mb-3">{t('settings.themeRepoLink')}</p>
                    <a
                      href="https://github.com/textoxmd/themes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md bg-muted p-3 font-mono text-xs break-all text-muted-foreground hover:text-foreground transition-colors"
                    >
                      github.com/textoxmd/themes
                    </a>
                  </PopoverContent>
                </Popover>
              </span>
              <span className="settings-item-description">
                {isFreeVersion ? t('settings.themeFreeLimitHint') : t('settings.themeManagementDesc')}
              </span>
            </div>
            <Button variant="outline" onClick={() => {
              if (isFreeVersion) {
                handleLiteImport();
              } else {
                handleImport();
              }
            }}>
              {t('settings.importTheme')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isFreeVersion && (
        <>
          <hr className="border-t border-border/60 mx-4" />
          <ThemeQuickSettings
            themeId={selectedTheme}
          />
        </>
      )}

      <Dialog open={!!duplicateTarget} onOpenChange={(open) => { if (!open) { setDuplicateTarget(null); setDuplicateName('') } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-muted-foreground font-normal">{t('settings.duplicateTheme')}</DialogTitle>
          </DialogHeader>
          <Input
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            placeholder={t('settings.themeNamePlaceholder')}
            aria-label={t('settings.themeName')}
            onKeyDown={(e) => e.key === 'Enter' && handleDuplicateConfirm()}
            className="mt-2"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setDuplicateTarget(null); setDuplicateName('') }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" className="rounded-lg" onClick={handleDuplicateConfirm}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) { setRenameTarget(null); setRenameName('') } }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-muted-foreground font-normal">{t('settings.renameTheme')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder={t('settings.themeNamePlaceholder')}
            aria-label={t('settings.themeName')}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
            className="mt-2"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setRenameTarget(null); setRenameName('') }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" className="rounded-lg" onClick={handleRenameConfirm}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  )
}
