import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { onStreamLine } from './line-buffer';

describe('onStreamLine', () => {
  it('preserves records split across arbitrary process chunks', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const ended = new Promise<void>((resolve) => stream.once('end', resolve));
    onStreamLine(stream, (line) => lines.push(line));

    stream.write('[download] 12.');
    stream.write('5% at 2 MiB/s\nprogress=con');
    stream.end('tinue\nlast line');
    await ended;

    expect(lines).toEqual([
      '[download] 12.5% at 2 MiB/s',
      'progress=continue',
      'last line'
    ]);
  });
});
