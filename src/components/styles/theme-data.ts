export interface ThemeData {
  light: Record<string, string>
  dark: Record<string, string>
}

export interface VariableGroup {
  id: string
  translationKey: string
  vars: string[]
}

export const VARIABLE_GROUPS: VariableGroup[] = [
  {
    id: 'surface',
    translationKey: 'settings.group.surface',
    vars: [
      '--background', '--foreground',
      '--card', '--card-foreground',
      '--popover', '--popover-foreground',
    ],
  },
  {
    id: 'accents',
    translationKey: 'settings.group.accents',
    vars: [
      '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground',
      '--accent', '--accent-foreground',
      '--breathe-color',
    ],
  },
  {
    id: 'feedback',
    translationKey: 'settings.group.feedback',
    vars: [
      '--destructive',
      '--muted', '--muted-foreground',
    ],
  },
  {
    id: 'boundaries',
    translationKey: 'settings.group.boundaries',
    vars: [
      '--border', '--input', '--ring',
    ],
  },
  {
    id: 'charts',
    translationKey: 'settings.group.charts',
    vars: [
      '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
    ],
  },
  {
    id: 'sidebar',
    translationKey: 'settings.group.sidebar',
    vars: [
      '--sidebar', '--sidebar-foreground',
      '--sidebar-primary', '--sidebar-primary-foreground',
      '--sidebar-accent', '--sidebar-accent-foreground',
      '--sidebar-border', '--sidebar-ring',
    ],
  },
]

export const ALL_VARIABLES = VARIABLE_GROUPS.flatMap(g => g.vars)

export function isOklchValue(value: string): boolean {
  return value.trim().startsWith('oklch(')
}

export const SCOPE_VARS: string[] = [
  '--source-code-theme-light',
  '--source-code-theme-dark',
]

export function emptyThemeData(): ThemeData {
  const empty: Record<string, string> = {}
  for (const v of ALL_VARIABLES) {
    empty[v] = 'oklch(0 0 0)'
  }
  return { light: { ...empty }, dark: { ...empty } }
}
