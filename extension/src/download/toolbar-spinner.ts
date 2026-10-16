/** What the spinner needs from the browser, so its timing can be tested without one. */
export interface SpinnerPorts {
  /** Draws frame `frame` of `frames` on the toolbar icon. */
  paint(frame: number, frames: number): Promise<void>;
  /** Puts the ordinary icon back. */
  restore(): Promise<void>;
}

export interface SpinnerOptions {
  frames: number;
  intervalMs: number;
}

export const DEFAULT_SPINNER: SpinnerOptions = { frames: 12, intervalMs: 90 };

/**
 * Animates the toolbar icon for as long as a download is running, the way a
 * browser tab spins while it loads, so it is clear from any tab that Flux is
 * working even with the popup closed.
 *
 * Painting is serialized and drops a frame rather than queueing behind a slow
 * one, and a frame that lands after `setBusy(false)` is discarded: otherwise
 * the icon could be left frozen mid-turn once the download is over.
 */
export class ToolbarSpinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private painting = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ports: SpinnerPorts,
    private readonly options: SpinnerOptions = DEFAULT_SPINNER
  ) {}

  get spinning(): boolean {
    return this.timer !== null;
  }

  /** Idempotent: calling it with the state it is already in does nothing. */
  setBusy(busy: boolean): void {
    if (busy === this.spinning) return;
    if (busy) {
      this.frame = 0;
      this.tick();
      this.timer = setInterval(() => this.tick(), this.options.intervalMs);
      return;
    }
    clearInterval(this.timer!);
    this.timer = null;
    this.enqueue(() => this.ports.restore());
  }

  private tick(): void {
    if (this.painting) return;
    this.painting = true;
    const frame = this.frame;
    this.frame = (frame + 1) % this.options.frames;
    this.enqueue(async () => {
      try {
        if (this.spinning) await this.ports.paint(frame, this.options.frames);
      } finally {
        this.painting = false;
      }
    });
  }

  private enqueue(task: () => Promise<void>): void {
    // A failed paint (a worker going away, a closing window) must never stop
    // the ones after it, and the animation is cosmetic: swallow it here.
    this.chain = this.chain.then(task).catch(() => { /* cosmetic */ });
  }
}

/** Start and end of the bright arc for one frame, in radians, turning clockwise from the top. */
export function spinnerArc(frame: number, frames: number): { start: number; end: number } {
  const top = -Math.PI / 2;
  const start = top + (frame / frames) * Math.PI * 2;
  // A little over a quarter of the ring, so the motion reads even at 16px.
  return { start, end: start + Math.PI * 0.75 };
}
