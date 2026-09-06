import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';
import { settleChild, spawnFailure } from './child-process';

describe('child process settlement', () => {
  it('turns a missing executable into a settled error instead of an unhandled event', async () => {
    const child = spawn(`flux-tool-that-does-not-exist-${process.pid}`, []);

    const result = await settleChild(child);

    expect(result.exitCode).toBeNull();
    expect((result.error as NodeJS.ErrnoException)?.code).toBe('ENOENT');
  });

  it('formats an actionable spawn failure', () => {
    expect(spawnFailure('ffprobe', '/missing/ffprobe', new Error('spawn ENOENT')))
      .toBe('Could not start ffprobe (/missing/ffprobe): spawn ENOENT');
  });
});
