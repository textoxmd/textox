import { useMemo } from 'react'
import { oklchParse, oklchToHex, oklchFormat } from '@/components/styles/color-utils'

interface ColorControlProps {
  name: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function ColorControl({ name, value, onChange, disabled }: ColorControlProps) {
  const hex = useMemo(() => oklchToHex(oklchParse(value)), [value])

  if (disabled) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-1 rounded w-full text-left text-xs font-mono opacity-50 cursor-not-allowed select-none">
        <span
          className="w-4 h-4 rounded border border-border shrink-0 inline-block"
          style={{ background: hex }}
        />
        <span className="flex-1 text-foreground/80">{name}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
    )
  }

  return (
    <label className="relative flex items-center gap-2 py-1.5 px-1 rounded w-full text-left cursor-pointer hover:bg-muted/50 transition-colors text-xs font-mono">
      <span
        className="w-4 h-4 rounded border border-border shrink-0 inline-block"
        style={{ background: hex }}
      />
      <span className="flex-1 text-foreground/80 truncate min-w-0">{name}</span>
      <span className="text-muted-foreground shrink-0">{value}</span>
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          onChange(oklchFormat(oklchParse(e.target.value)))
        }}
        className="absolute inset-0 opacity-0 w-full h-full"
      />
    </label>
  )
}
