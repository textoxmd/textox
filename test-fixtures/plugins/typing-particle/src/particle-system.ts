import type { ParticleEffectConfig, ParticleShape } from './config';
import { PALETTES } from './config';

const COLOR_VARY_RANGE = 80
const DT_CAP = 0.05
const RADIUS_CULL = 0.3

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  life: number
  decay: number
  color: string
  alpha: number
  gravity: number
  shape: ParticleShape
}

function parseRgb(color: string): [number, number, number] | null {
  const tmp = document.createElement("div")
  tmp.style.color = color
  document.body.append(tmp)
  const rgb = getComputedStyle(tmp).color
  tmp.remove()
  const m = rgb.match(/\d+/g)
  if (!m || m.length < 3) return null
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

function varyRgb(rgb: [number, number, number], range: number): string {
  const r = Math.min(255, Math.max(0, rgb[0] + (Math.random() - 0.5) * range))
  const g = Math.min(255, Math.max(0, rgb[1] + (Math.random() - 0.5) * range))
  const b = Math.min(255, Math.max(0, rgb[2] + (Math.random() - 0.5) * range))
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.beginPath()
  switch (p.shape) {
    case "square":
      ctx.rect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2)
      break
    case "star": {
      const spikes = 5
      const outer = p.radius
      const inner = p.radius * 0.4
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (Math.PI * i) / spikes - Math.PI / 2
        i === 0 ? ctx.moveTo(p.x + r * Math.cos(a), p.y + r * Math.sin(a)) : ctx.lineTo(p.x + r * Math.cos(a), p.y + r * Math.sin(a))
      }
      ctx.closePath()
      break
    }
    case "diamond": {
      const r = p.radius
      ctx.moveTo(p.x, p.y - r)
      ctx.lineTo(p.x + r, p.y)
      ctx.lineTo(p.x, p.y + r)
      ctx.lineTo(p.x - r, p.y)
      ctx.closePath()
      break
    }
    case "triangle":
      ctx.moveTo(p.x, p.y - p.radius)
      ctx.lineTo(p.x + p.radius, p.y + p.radius)
      ctx.lineTo(p.x - p.radius, p.y + p.radius)
      ctx.closePath()
      break
    default:
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
  }
  ctx.fill()
}

function randomFromPalette(palette: string[]): string {
  return palette[Math.floor(Math.random() * palette.length)] ?? "#888"
}

function launchAngle(direction: string, spread: number): number {
  const spreadRad = (spread / 180) * Math.PI
  switch (direction) {
    case "up": return -Math.PI / 2 + (Math.random() - 0.5) * spreadRad
    case "down": return Math.PI / 2 + (Math.random() - 0.5) * spreadRad
    case "radial": return Math.random() * Math.PI * 2
    case "random": return Math.random() * Math.PI * 2
    default: return -Math.PI / 2 + (Math.random() - 0.5) * spreadRad
  }
}

export class ParticleSystem {
  private particles: Particle[] = []
  private rafId: number | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private _enabled = false
  private baseRgb: [number, number, number] = [128, 128, 128]

  setContext(ctx: CanvasRenderingContext2D | null): void {
    this.ctx = ctx
    if (ctx) {
      const rgb = parseRgb("var(--foreground)")
      if (rgb) this.baseRgb = rgb
    }
  }

  get enabled(): boolean {
    return this._enabled
  }

  setEnabled(on: boolean): void {
    this._enabled = on
    if (on) {
      this.startLoop()
    } else {
      this.stopLoop()
      this.particles = []
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return
    const loop = (now: number) => {
      if (!this._enabled || !this.ctx) {
        this.stopLoop()
        return
      }
      this.update(now)
      this.render()
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private lastTime = 0

  private update(now: number): void {
    const dt = Math.min((now - this.lastTime) / 1000, DT_CAP)
    this.lastTime = now
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.gravity * dt
      p.life -= p.decay * dt
      p.alpha = Math.max(0, p.life)
      p.radius *= 0.98
      if (p.life <= 0 || p.radius < RADIUS_CULL) {
        this.particles.splice(i, 1)
      }
    }
  }

  private render(): void {
    const ctx = this.ctx
    if (!ctx) return
    const w = ctx.canvas.width / (window.devicePixelRatio || 1)
    const h = ctx.canvas.height / (window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, w, h)
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      drawParticle(ctx, p)
    }
    ctx.globalAlpha = 1
  }

  emit(x: number, y: number, config: ParticleEffectConfig): void {
    if (!this._enabled) return
    const count = config.count
    for (let i = 0; i < count; i++) {
      let color: string
      switch (config.colorMode) {
        case "fixed":
          color = varyRgb(parseRgb(config.color) ?? this.baseRgb, COLOR_VARY_RANGE)
          break
        case "random":
          color = randomFromPalette(PALETTES[config.palette] || PALETTES.rainbow)
          break
        default:
          color = varyRgb(this.baseRgb, COLOR_VARY_RANGE)
      }
      const angle = launchAngle(config.direction, config.spread)
      const speed = config.speed * (0.7 + Math.random() * 0.6)
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: config.size * (0.7 + Math.random() * 0.6),
        life: 1,
        decay: 1 / config.duration * (0.8 + Math.random() * 0.4),
        color,
        alpha: 1,
        gravity: config.gravity * (0.8 + Math.random() * 0.4),
        shape: config.shape,
      })
    }
    if (this.rafId === null && this._enabled) {
      this.lastTime = performance.now()
      this.startLoop()
    }
  }

  destroy(): void {
    this.stopLoop()
    this.particles = []
    this.ctx = null
  }
}
