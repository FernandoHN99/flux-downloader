import { describe, expect, it } from 'vitest';
import { DownloadRunGate } from './download-run-gate';

describe('DownloadRunGate', () => {
  it('grants exactly one synchronous lease', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('single');

    expect(first).toEqual({ kind: 'single' });
    expect(gate.busy).toBe(true);
    expect(gate.acquire('batch')).toBeNull();
    expect(gate.owns(first!)).toBe(true);
  });

  it('allows a new run after the owner releases its lease', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('batch')!;

    expect(gate.release(first)).toBe(true);
    expect(gate.busy).toBe(false);
    expect(gate.acquire('single')).toEqual({ kind: 'single' });
  });

  it('does not let a forged or stale lease release the current owner', () => {
    const gate = new DownloadRunGate();
    const first = gate.acquire('single')!;
    const forged = { kind: 'single' as const };

    expect(gate.release(forged)).toBe(false);
    expect(gate.busy).toBe(true);
    expect(gate.release(first)).toBe(true);

    const second = gate.acquire('batch')!;
    expect(gate.release(first)).toBe(false);
    expect(gate.owns(second)).toBe(true);
  });
});
