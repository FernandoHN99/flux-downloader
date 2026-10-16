import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spinnerArc, ToolbarSpinner } from './toolbar-spinner';

function ports() {
  return { paint: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
}

/** Lets the serialized paint chain run to completion. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('ToolbarSpinner', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('paints at once when a download starts, then turns one frame per interval', async () => {
    const p = ports();
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });

    spinner.setBusy(true);
    await settle();
    expect(p.paint).toHaveBeenCalledTimes(1);
    expect(p.paint).toHaveBeenLastCalledWith(0, 4);

    await vi.advanceTimersByTimeAsync(100);
    expect(p.paint).toHaveBeenLastCalledWith(1, 4);
    await vi.advanceTimersByTimeAsync(300);
    // 0, 1, 2, 3 and back round to 0.
    expect(p.paint).toHaveBeenLastCalledWith(0, 4);
    expect(spinner.spinning).toBe(true);
  });

  it('puts the ordinary icon back, once, when the download ends', async () => {
    const p = ports();
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });
    spinner.setBusy(true);
    await vi.advanceTimersByTimeAsync(250);

    spinner.setBusy(false);
    await settle();
    expect(p.restore).toHaveBeenCalledTimes(1);
    expect(spinner.spinning).toBe(false);

    const painted = p.paint.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.paint).toHaveBeenCalledTimes(painted);
  });

  it('does nothing when told the state it is already in', async () => {
    const p = ports();
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });

    spinner.setBusy(false);
    spinner.setBusy(true);
    spinner.setBusy(true);
    await settle();

    expect(p.paint).toHaveBeenCalledTimes(1);
    expect(p.restore).not.toHaveBeenCalled();
  });

  it('never paints a frame after the icon was restored', async () => {
    let finishPaint!: () => void;
    const p = {
      paint: vi.fn(() => new Promise<void>((resolve) => { finishPaint = resolve; })),
      restore: vi.fn(async () => {})
    };
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });

    spinner.setBusy(true);
    await settle();
    expect(p.paint).toHaveBeenCalledTimes(1);

    // The download ends while that frame is still being drawn.
    spinner.setBusy(false);
    finishPaint();
    await vi.advanceTimersByTimeAsync(500);

    expect(p.restore).toHaveBeenCalledTimes(1);
    expect(p.paint).toHaveBeenCalledTimes(1);
  });

  it('drops a frame rather than queueing behind a slow one', async () => {
    let finishPaint!: () => void;
    const p = {
      paint: vi.fn(() => new Promise<void>((resolve) => { finishPaint = resolve; })),
      restore: vi.fn(async () => {})
    };
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });

    spinner.setBusy(true);
    await vi.advanceTimersByTimeAsync(450);
    expect(p.paint).toHaveBeenCalledTimes(1);

    finishPaint();
    await vi.advanceTimersByTimeAsync(100);
    expect(p.paint).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a paint fails', async () => {
    const p = {
      paint: vi.fn().mockRejectedValueOnce(new Error('window closed')).mockResolvedValue(undefined),
      restore: vi.fn(async () => {})
    };
    const spinner = new ToolbarSpinner(p, { frames: 4, intervalMs: 100 });

    spinner.setBusy(true);
    await vi.advanceTimersByTimeAsync(250);

    expect(p.paint.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('spinnerArc', () => {
  it('starts at the top and turns clockwise a full circle over the frames', () => {
    expect(spinnerArc(0, 12).start).toBeCloseTo(-Math.PI / 2);
    expect(spinnerArc(3, 12).start).toBeCloseTo(0);
    expect(spinnerArc(6, 12).start).toBeCloseTo(Math.PI / 2);
  });

  it('draws a visible stretch of the ring, never all of it', () => {
    const { start, end } = spinnerArc(5, 12);
    expect(end - start).toBeGreaterThan(Math.PI / 2);
    expect(end - start).toBeLessThan(Math.PI * 2);
  });
});
