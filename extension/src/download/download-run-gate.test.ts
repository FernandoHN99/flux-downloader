import { describe, expect, it, vi } from 'vitest';
import { DownloadRunGate } from './download-run-gate';

describe('DownloadRunGate', () => {
  it('grants exactly one synchronous lease', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('single');

    expect(first).toMatchObject({ kind: 'single' });
    expect(gate.busy).toBe(true);
    expect(gate.acquire('batch')).toBeNull();
    expect(gate.owns(first!)).toBe(true);
  });

  it('allows a new run after the owner releases its lease', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('batch')!;

    expect(gate.release(first)).toBe(true);
    expect(gate.busy).toBe(false);
    expect(gate.acquire('single')).toMatchObject({ kind: 'single' });
  });

  it('does not let a forged or stale lease release the current owner', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('single')!;
    const forged = { kind: 'single' as const, keys: new Set<string>() };

    expect(gate.release(forged)).toBe(false);
    expect(gate.busy).toBe(true);
    expect(gate.release(first)).toBe(true);

    const second = gate.acquire('batch')!;
    expect(gate.release(first)).toBe(false);
    expect(gate.owns(second)).toBe(true);
  });

  it('tells whoever is listening when a run starts and when it ends', () => {
    const changed = vi.fn();
    const gate = new DownloadRunGate(changed);

    const lease = gate.acquire('batch')!;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(gate.acquire('single')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);

    gate.release(lease);
    expect(changed).toHaveBeenCalledTimes(2);
    // A stale release changes nothing, so it must not announce anything.
    gate.release(lease);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('locks exactly the videos of the run in flight', () => {
    const gate = new DownloadRunGate();
    expect([...gate.lockedKeys]).toEqual([]);

    const lease = gate.acquire('batch', ['a', 'b'])!;
    expect([...gate.lockedKeys]).toEqual(['a', 'b']);

    gate.release(lease);
    expect([...gate.lockedKeys]).toEqual([]);
  });
});
