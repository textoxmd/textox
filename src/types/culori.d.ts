declare module 'culori' {
  export interface Rgb {
    mode: 'rgb'
    r: number
    g: number
    b: number
    alpha?: number
  }
  export interface Hsl {
    mode: 'hsl'
    h?: number
    s?: number
    l?: number
    alpha?: number
  }
  export interface Oklch {
    mode: 'oklch'
    l?: number
    c?: number
    h?: number
    alpha?: number
  }
  type Color = Rgb | Hsl | Oklch

  export function converter(mode: 'oklch'): (color: string) => Oklch | undefined
  export function converter(mode: 'hsl'): (color: string) => Hsl | undefined
  export function converter(mode: 'rgb'): (color: string) => Rgb | undefined
  export function converter(mode: string): (color: string) => Color | undefined
}
