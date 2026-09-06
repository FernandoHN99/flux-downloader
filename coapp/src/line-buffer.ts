import type { Readable } from 'stream';

/** Preserve lines split across stream chunks before handing them to parsers. */
export function onStreamLine(stream: Readable | null | undefined, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = '';
  stream.on('data', (data: Buffer | string) => {
    pending += data.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  });
  stream.on('end', () => {
    if (pending.trim()) onLine(pending);
    pending = '';
  });
}
