import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectDownloadManager } from './http-download';

const servers: http.Server[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of tempDirectories.splice(0)) {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

describe('DirectDownloadManager', () => {
  it('writes validated ranges concurrently with page context on every request', async () => {
    const data = randomBytes(12 * 1024 * 1024 + 123);
    const requests: Array<{ range?: string; referer?: string; origin?: string; ifRange?: string }> = [];
    const url = await serve((request, response) => {
      requests.push({
        range: header(request, 'range'),
        referer: header(request, 'referer'),
        origin: header(request, 'origin'),
        ifRange: header(request, 'if-range')
      });
      sendRange(data, request, response, '"version-one"');
    });
    const filename = await tempFile('parallel.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    const id = manager.start({
      url,
      filename,
      headers: { Referer: 'https://course.example/lesson', Origin: 'https://course.example' }
    });
    await result.done;

    expect((await fs.promises.readFile(filename)).equals(data)).toBe(true);
    expect(manager.search(id)).toMatchObject({
      state: 'complete',
      mode: 'parallel',
      connections: 3,
      bytesReceived: data.length,
      totalBytes: data.length
    });
    expect(requests[0].range).toBe('bytes=0-0');
    expect(requests.slice(1)).toHaveLength(3);
    expect(requests.slice(1).every((item) => item.ifRange === '"version-one"')).toBe(true);
    expect(requests.every((item) =>
      item.referer === 'https://course.example/lesson' &&
      item.origin === 'https://course.example'
    )).toBe(true);
  });

  it('reuses a full 200 response when the server ignores Range', async () => {
    const data = randomBytes(512 * 1024);
    let requests = 0;
    const url = await serve((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'Content-Length': data.length });
      response.end(data);
    });
    const filename = await tempFile('single.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    const id = manager.start({ url, filename });
    await result.done;

    expect(requests).toBe(1);
    expect((await fs.promises.readFile(filename)).equals(data)).toBe(true);
    expect(manager.search(id)).toMatchObject({ mode: 'single', connections: 1 });
  });

  it('falls back cleanly when advertised ranges are rejected under load', async () => {
    const data = randomBytes(8 * 1024 * 1024 + 7);
    let probeSeen = false;
    let fullRequests = 0;
    const url = await serve((request, response) => {
      const range = header(request, 'range');
      if (range === 'bytes=0-0' && !probeSeen) {
        probeSeen = true;
        sendRange(data, request, response, '"stable"');
        return;
      }
      if (range) {
        response.writeHead(200, { 'Content-Length': 0 });
        response.end();
        return;
      }
      fullRequests += 1;
      response.writeHead(200, { 'Content-Length': data.length });
      response.end(data);
    });
    const filename = await tempFile('fallback.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    const id = manager.start({ url, filename });
    await result.done;

    expect(fullRequests).toBe(1);
    expect((await fs.promises.readFile(filename)).equals(data)).toBe(true);
    expect(manager.search(id)).toMatchObject({
      state: 'complete', mode: 'single', connections: 1, bytesReceived: data.length
    });
  });

  it('resumes only the unfinished tail of a disconnected range', async () => {
    const data = randomBytes(8 * 1024 * 1024);
    const firstRangeEnd = data.length / 2 - 1;
    const firstPartStarts: number[] = [];
    let interrupted = false;
    const url = await serve((request, response) => {
      const parsed = requestedRange(request, data.length);
      if (!parsed) {
        response.writeHead(200, { 'Content-Length': data.length });
        response.end(data);
        return;
      }
      if (parsed.end === firstRangeEnd) firstPartStarts.push(parsed.start);
      response.writeHead(206, {
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${data.length}`,
        'Content-Length': parsed.end - parsed.start + 1,
        ETag: '"resume"'
      });
      if (parsed.start === 0 && parsed.end > 0 && !interrupted) {
        interrupted = true;
        const midpoint = parsed.start + Math.floor((parsed.end - parsed.start + 1) / 2);
        response.write(data.subarray(parsed.start, midpoint), () => response.destroy());
        return;
      }
      response.end(data.subarray(parsed.start, parsed.end + 1));
    });
    const filename = await tempFile('resume.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    manager.start({ url, filename });
    await result.done;

    expect((await fs.promises.readFile(filename)).equals(data)).toBe(true);
    expect(interrupted).toBe(true);
    // The retry no longer starts at zero; the exact value depends on stream chunking.
    expect(firstPartStarts[0]).toBe(0);
    expect(firstPartStarts.some((start) => start > 0 && start <= firstRangeEnd)).toBe(true);
  });

  it('never reports a truncated connection reset as complete', async () => {
    const data = randomBytes(1024 * 1024);
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': data.length });
      response.write(data.subarray(0, data.length / 2), () => response.destroy());
    });
    const filename = await tempFile('truncated.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    const id = manager.start({ url, filename });
    await expect(result.done).rejects.toThrow();
    await vi.waitFor(() => expect(fs.existsSync(filename)).toBe(false));
    expect(manager.search(id)).toMatchObject({ state: 'interrupted' });
  });

  it('rejects a partial 206 response from the sequential fallback', async () => {
    const data = randomBytes(8 * 1024 * 1024);
    let probeSeen = false;
    const url = await serve((request, response) => {
      const range = header(request, 'range');
      if (range === 'bytes=0-0' && !probeSeen) {
        probeSeen = true;
        sendRange(data, request, response, '"partial"');
        return;
      }
      if (range) {
        response.writeHead(200, { 'Content-Length': 0 });
        response.end();
        return;
      }
      response.writeHead(206, {
        'Content-Range': `bytes 0-9/${data.length}`,
        'Content-Length': 10
      });
      response.end(data.subarray(0, 10));
    });
    const filename = await tempFile('partial-fallback.bin');
    const result = deferredResult();
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: result.complete,
      onError: result.fail
    });

    const id = manager.start({ url, filename });
    await expect(result.done).rejects.toThrow('Sequential fallback returned only partial content');
    await vi.waitFor(() => expect(fs.existsSync(filename)).toBe(false));
    expect(manager.search(id)).toMatchObject({ state: 'interrupted' });
  });

  it('aborts all ranged requests and removes a cancelled partial file', async () => {
    const data = Buffer.alloc(8 * 1024 * 1024, 7);
    const url = await serve((request, response) => {
      const range = requestedRange(request, data.length);
      if (!range) {
        response.writeHead(200, { 'Content-Length': data.length });
        response.end(data);
        return;
      }
      response.writeHead(206, {
        'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`,
        'Content-Length': range.end - range.start + 1,
        ETag: '"slow"'
      });
      if (range.start === 0 && range.end === 0) {
        response.end(data.subarray(0, 1));
        return;
      }

      let position = range.start;
      const timer = setInterval(() => {
        if (position > range.end) {
          clearInterval(timer);
          response.end();
          return;
        }
        const end = Math.min(range.end + 1, position + 64 * 1024);
        response.write(data.subarray(position, end));
        position = end;
      }, 5);
      response.once('close', () => clearInterval(timer));
    });
    const filename = await tempFile('cancelled.bin');
    let completed = false;
    let failed = false;
    const manager = new DirectDownloadManager({
      cleanupDelayMs: 5_000,
      onComplete: () => { completed = true; },
      onError: () => { failed = true; }
    });

    const id = manager.start({ url, filename });
    await vi.waitFor(() => {
      expect(manager.search(id)).toMatchObject({ mode: 'parallel', state: 'in_progress' });
      expect((manager.search(id)?.bytesReceived || 0) > 0).toBe(true);
    });
    expect(manager.cancel(id)).toBe(true);

    await vi.waitFor(() => expect(fs.existsSync(filename)).toBe(false));
    expect(manager.search(id)).toMatchObject({ state: 'interrupted', error: 'Aborted' });
    expect(completed).toBe(false);
    expect(failed).toBe(false);
  });
});

// Starts a loopback server and returns one URL served by it.
async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/media`;
}

async function tempFile(name: string): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flux-http-test-'));
  tempDirectories.push(directory);
  return path.join(directory, name);
}

function deferredResult(): {
  done: Promise<void>;
  complete: () => void;
  fail: (_id: number, error: string) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const done = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return {
    done,
    complete: resolve,
    fail: (_id, error) => reject(new Error(error))
  };
}

function sendRange(
  data: Buffer,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  etag: string
): void {
  const range = requestedRange(request, data.length);
  if (!range) {
    response.writeHead(200, { 'Content-Length': data.length, ETag: etag });
    response.end(data);
    return;
  }
  response.writeHead(206, {
    'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`,
    'Content-Length': range.end - range.start + 1,
    ETag: etag
  });
  response.end(data.subarray(range.start, range.end + 1));
}

function requestedRange(
  request: http.IncomingMessage,
  total: number
): { start: number; end: number } | undefined {
  const match = /^bytes=(\d+)-(\d+)$/.exec(header(request, 'range') || '');
  if (!match) return undefined;
  return {
    start: Number(match[1]),
    end: Math.min(total - 1, Number(match[2]))
  };
}

function header(request: http.IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
