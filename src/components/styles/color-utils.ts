import {
  converter,
  type Oklch,
  type Hsl,
} from 'culori'

export type OklchColor = { l: number; c: number; h: number; alpha?: number }
export type HslColor = { h: number; s: number; l: number; alpha?: number }

const toOklch = converter('oklch')
const toHsl = converter('hsl')

export function oklchParse(value: string): OklchColor {
  try {
    const c = toOklch(value) as Oklch | undefined
    if (c) {
      return { l: c.l ?? 0, c: c.c ?? 0, h: c.h ?? 0, alpha: c.alpha }
    }
  } catch {}
  return { l: 0, c: 0, h: 0 }
}

export function oklchFormat(color: OklchColor): string {
  const lStr = color.l.toFixed(3)
  const cStr = color.c.toFixed(3)
  const hStr = (color.h ?? 0).toFixed(1)
  if (color.alpha !== undefined && color.alpha < 1) {
    return `oklch(${lStr} ${cStr} ${hStr} / ${color.alpha})`
  }
  return `oklch(${lStr} ${cStr} ${hStr})`
}

export function oklchToHsl(color: OklchColor): HslColor {
  try {
    const hsl = toHsl(`oklch(${color.l} ${color.c} ${color.h})`) as Hsl | undefined
    if (hsl) {
      const s = Math.round(((hsl.s ?? 0) * 100) * 100) / 100
      const l = Math.round(((hsl.l ?? 0) * 100) * 100) / 100
      return { h: hsl.h ?? 0, s: clampHsl(s), l: clampHsl(l), alpha: hsl.alpha }
    }
  } catch {}
  return { h: 0, s: 0, l: 50 }
}

function clampHsl(v: number): number {
  if (Math.abs(v) < 0.001) return 0
  if (v > 100) return 100
  if (v < 0) return 0
  return v
}

export function hslToOklch(color: HslColor): OklchColor {
  try {
    const oklch = toOklch(`hsl(${color.h}, ${color.s}%, ${color.l}%)`) as Oklch | undefined
    if (oklch) {
      return { l: oklch.l ?? 0, c: oklch.c ?? 0, h: oklch.h ?? 0, alpha: oklch.alpha }
    }
  } catch {}
  return { l: 0, c: 0, h: 0 }
}

export function oklchToHex(color: OklchColor): string {
  try {
    const c = converter('rgb')(`oklch(${color.l} ${color.c} ${color.h})`) as any
    const r = Math.round(c.r * 255).toString(16).padStart(2, '0')
    const g = Math.round(c.g * 255).toString(16).padStart(2, '0')
    const b = Math.round(c.b * 255).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  } catch {
    return '#000000'
  }
}
