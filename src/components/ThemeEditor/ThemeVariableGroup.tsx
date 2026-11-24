import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { ColorControl } from './ColorControl'

interface ThemeVariableGroupProps {
  label: string
  vars: string[]
  values: Record<string, string>
  onVarChange: (name: string, value: string) => void
  showSave?: boolean
  onSave?: () => void
  onCancel?: () => void
  disabled?: boolean
}

export function ThemeVariableGroup({ label, vars, values, onVarChange, showSave, onSave, onCancel, disabled }: ThemeVariableGroupProps) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="flex items-center justify-between mb-1 mt-3 first:mt-0">
        <h4 className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">
          {label}
        </h4>
        {showSave && onSave && (
          <div className="flex items-center gap-1">
            {onCancel && (
              <Button variant="ghost" size="xs" className="text-xs rounded-lg" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
            <Button variant="outline" size="xs" className="text-xs rounded-lg" onClick={onSave}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>
      {vars.map(v => (
        <ColorControl
          key={v}
          name={v}
          value={values[v] || 'oklch(0 0 0)'}
          onChange={(val) => onVarChange(v, val)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}