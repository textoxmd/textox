export interface CanvasLayerOptions {
  container: HTMLElement
  onResize?: (width: number, height: number) => void
}

export class CanvasLayer {
  readonly canvas: HTMLCanvasElement
  private wrapper: HTMLElement
  private container: HTMLElement
  private ro: ResizeObserver | null = null
  private scrollParent: HTMLElement | null = null
  private onScroll: (() => void) | null = null

  constructor(opts: CanvasLayerOptions) {
    this.container = opts.container
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative"
    }
    this.wrapper = document.createElement("div")
    this.wrapper.className = "typing-particle-container"
    this.canvas = document.createElement("canvas")
    this.canvas.style.display = "block"
    this.wrapper.append(this.canvas)
    opts.container.append(this.wrapper)

    this.syncSize()
    this.ro = new ResizeObserver(() => {
      this.syncSize()
      opts.onResize?.(this.canvas.width, this.canvas.height)
    })
    this.ro.observe(opts.container)
    this.listenScroll()
  }

  private syncSize(): void {
    const rect = this.container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = rect.width * dpr
    this.canvas.height = rect.height * dpr
    this.canvas.style.width = `${rect.width}px`
    this.canvas.style.height = `${rect.height}px`
    const ctx = this.canvas.getContext("2d")
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private listenScroll(): void {
    let el: HTMLElement | null = this.container.parentElement
    while (el) {
      const style = getComputedStyle(el)
      if (style.overflowY === "auto" || style.overflowY === "scroll") break
      el = el.parentElement
    }
    this.scrollParent = el
    if (el) {
      this.onScroll = () => this.syncSize()
      el.addEventListener("scroll", this.onScroll, { passive: true })
    }
  }

  get ctx(): CanvasRenderingContext2D | null {
    return this.canvas.getContext("2d")
  }

  destroy(): void {
    this.ro?.disconnect()
    if (this.scrollParent && this.onScroll) {
      this.scrollParent.removeEventListener("scroll", this.onScroll)
    }
    this.wrapper.remove()
  }
}
