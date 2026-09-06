import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import type { IncomingMessage } from 'http';

export const DEFAULT_HTTP_CONNECTIONS = 8;
export const MIN_BYTES_PER_CONNECTION = 4 * 1024 * 1024;

const DEFAULT_CLEANUP_DELAY_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const RANGE_RETRIES = 3;
const RETRY_DELAY_MS = 150;

export type DirectDownloadState = 'in_progress' | 'complete' | 'interrupted';
export type DirectDownloadMode = 'probing' | 'single' | 'parallel';

export interface DirectDownloadOptions {
  url: string;
  filename: string;
  headers?: Record<string, string>;
  rejectUnauthorized?: boolean;
}

export interface DirectDownloadSnapshot {
  totalBytes: number;
  bytesReceived: number;
  url: string;
  filename: string;
  state: DirectDownloadState;
  error: string | null;
  mode: DirectDownloadMode;
  connections: number;
}

export interface DirectDownloadManagerOptions {
  maxConnections?: number;
  cleanupDelayMs?: number;
  requestTimeoutMs?: number;
  onComplete?: (downloadId: number, filename: string) => void | Promise<void>;
  onError?: (downloadId: number, error: string) => void | Promise<void>;
}

interface DownloadEntry extends DirectDownloadSnapshot {
  controller: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  rejectUnauthorized: boolean;
  headers: Record<string, string>;
}

interface ParsedContentRange {
  start: number;
  end: number;
  total: number;
}

interface ByteRange {
  start: number;
  end: number;
}

interface RequestOptions {
  headers?: Record<string, string>;
  rejectUnauthorized?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Download failed with HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

class RangeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeProtocolError';
  }
}

/**
 * Resolve one HTTP(S) response while preserving headers across redirects.
 * The response body belongs to the caller and must be consumed or destroyed.
 */
export function requestResponse(
  url: string,
  options: RequestOptions = {},
  redirects = 0
): Promise<IncomingMessage> {
  if (redirects > MAX_REDIRECTS) {
    return Promise.reject(new Error('Too many download redirects'));
  }

  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid download URL: ${url}`));
      return;
    }

    const client = parsed.protocol === 'https:'
      ? https
      : parsed.protocol === 'http:'
        ? http
        : null;
    if (!client) {
      reject(new Error(`Unsupported download protocol: ${parsed.protocol}`));
      return;
    }

    const request = client.get(parsed, {
      headers: options.headers,
      rejectUnauthorized: options.rejectUnauthorized !== false,
      signal: options.signal
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        discardInBackground(response);
        requestResponse(new URL(location, parsed).toString(), options, redirects + 1)
          .then(resolve, reject);
        return;
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        response.setTimeout(options.timeoutMs, () => {
          response.destroy(new Error('Download response timed out'));
        });
      }
      resolve(response);
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error('Download request timed out'));
      });
    }
    request.once('error', reject);
  });
}

/**
 * Owns direct HTTP transfers. Large files are split into disjoint byte ranges
 * and written at fixed offsets, so connections can fill one file concurrently.
 */
export class DirectDownloadManager {
  private currentDownloadId = 0;
  private readonly downloads = new Map<number, DownloadEntry>();
  private readonly maxConnections: number;
  private readonly cleanupDelayMs: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: DirectDownloadManagerOptions = {}) {
    this.maxConnections = clampInteger(options.maxConnections, 1, 16, DEFAULT_HTTP_CONNECTIONS);
    this.cleanupDelayMs = Math.max(0, options.cleanupDelayMs ?? DEFAULT_CLEANUP_DELAY_MS);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  }

  start(options: DirectDownloadOptions): number {
    const directory = path.dirname(options.filename);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

    const downloadId = ++this.currentDownloadId;
    const entry: DownloadEntry = {
      totalBytes: 0,
      bytesReceived: 0,
      url: options.url,
      filename: options.filename,
      state: 'in_progress',
      error: null,
      mode: 'probing',
      connections: 1,
      controller: new AbortController(),
      rejectUnauthorized: options.rejectUnauthorized !== false,
      headers: { ...(options.headers || {}) }
    };
    this.downloads.set(downloadId, entry);

    // Let the RPC reply carrying the numeric ID leave before a very fast
    // failure/completion callback can race it back to the extension.
    setImmediate(() => { void this.run(downloadId, entry); });
    return downloadId;
  }

  search(downloadId: number): DirectDownloadSnapshot | undefined {
    const entry = this.downloads.get(downloadId);
    if (!entry) return undefined;
    const { controller: _controller, cleanupTimer: _cleanupTimer,
      rejectUnauthorized: _rejectUnauthorized, headers: _headers, ...snapshot } = entry;
    return snapshot;
  }

  cancel(downloadId: number): boolean {
    const entry = this.downloads.get(downloadId);
    if (!entry || entry.state !== 'in_progress') return false;
    entry.state = 'interrupted';
    entry.error = 'Aborted';
    entry.controller.abort();
    return true;
  }

  private async run(downloadId: number, entry: DownloadEntry): Promise<void> {
    try {
      await this.download(entry);
      if (entry.state !== 'in_progress') {
        await fs.promises.rm(entry.filename, { force: true }).catch(() => {});
        return;
      }
      entry.state = 'complete';
      this.callHook(this.options.onComplete, downloadId, entry.filename);
    } catch (error: any) {
      if (entry.state === 'in_progress') {
        entry.state = 'interrupted';
        entry.error = error?.message || String(error);
        this.callHook(this.options.onError, downloadId, entry.error);
      }
      await fs.promises.rm(entry.filename, { force: true }).catch(() => {});
    } finally {
      this.scheduleCleanup(downloadId, entry);
    }
  }

  private async download(entry: DownloadEntry): Promise<void> {
    const identityHeaders = setHeader(entry.headers, 'Accept-Encoding', 'identity');
    const probeHeaders = setHeader(identityHeaders, 'Range', 'bytes=0-0');
    const probe = await requestResponse(entry.url, {
      headers: probeHeaders,
      rejectUnauthorized: entry.rejectUnauthorized,
      signal: entry.controller.signal,
      timeoutMs: this.requestTimeoutMs
    });

    const status = probe.statusCode || 0;
    if (status === 200) {
      entry.mode = 'single';
      entry.connections = 1;
      entry.totalBytes = headerNumber(probe.headers['content-length']);
      await this.writeSequentialResponse(entry, probe);
      return;
    }

    const contentRange = parseContentRange(probe.headers['content-range']);
    if (status !== 206 || !contentRange || contentRange.start !== 0 || contentRange.total <= 0) {
      discardInBackground(probe);
      if (status >= 400 && status !== 416) throw new HttpStatusError(status);
      await this.downloadSequential(entry, identityHeaders);
      return;
    }

    await discardResponse(probe);
    entry.totalBytes = contentRange.total;
    const ranges = splitRanges(contentRange.total, this.maxConnections);
    entry.mode = ranges.length > 1 ? 'parallel' : 'single';
    entry.connections = ranges.length;

    const handle = await fs.promises.open(entry.filename, 'w');
    try {
      await handle.truncate(contentRange.total);
    } finally {
      await handle.close();
    }

    const validator = rangeValidator(probe);
    const rangeController = new AbortController();
    const abortRanges = () => rangeController.abort();
    entry.controller.signal.addEventListener('abort', abortRanges, { once: true });
    const jobs = ranges.map((range) => this.downloadRange(
      entry,
      range,
      identityHeaders,
      validator,
      rangeController.signal
    ));

    try {
      await Promise.all(jobs);
      if (entry.bytesReceived !== entry.totalBytes) {
        throw new Error(`Incomplete ranged download (${entry.bytesReceived}/${entry.totalBytes} bytes)`);
      }
    } catch (error) {
      rangeController.abort();
      await Promise.allSettled(jobs);
      if (entry.controller.signal.aborted) throw abortError();
      if (isFilesystemError(error)) throw error;

      // CDNs sometimes advertise ranges but reject a burst of range requests.
      // Restart once as a normal stream rather than failing the user's file.
      console.error(
        '[Flux Downloader CoApp] Parallel ranges failed for %s; retrying with one connection: %s',
        entry.url,
        error instanceof Error ? error.message : String(error)
      );
      await fs.promises.rm(entry.filename, { force: true }).catch(() => {});
      entry.bytesReceived = 0;
      await this.downloadSequential(entry, identityHeaders);
    } finally {
      entry.controller.signal.removeEventListener('abort', abortRanges);
    }
  }

  private async downloadSequential(
    entry: DownloadEntry,
    headers: Record<string, string>
  ): Promise<void> {
    entry.mode = 'single';
    entry.connections = 1;
    const response = await requestResponse(entry.url, {
      headers: removeHeader(headers, 'Range'),
      rejectUnauthorized: entry.rejectUnauthorized,
      signal: entry.controller.signal,
      timeoutMs: this.requestTimeoutMs
    });
    const status = response.statusCode || 0;
    if (status < 200 || status >= 300) {
      discardInBackground(response);
      throw new HttpStatusError(status);
    }
    if (status === 206) {
      const range = parseContentRange(response.headers['content-range']);
      if (!range || range.start !== 0 || range.end !== range.total - 1) {
        discardInBackground(response);
        throw new RangeProtocolError('Sequential fallback returned only partial content');
      }
      entry.totalBytes = range.total;
    } else {
      entry.totalBytes = headerNumber(response.headers['content-length']);
    }
    await this.writeSequentialResponse(entry, response);
  }

  private async writeSequentialResponse(
    entry: DownloadEntry,
    response: IncomingMessage
  ): Promise<void> {
    entry.bytesReceived = 0;
    const handle = await fs.promises.open(entry.filename, 'w');
    let position = 0;
    try {
      for await (const value of response) {
        if (entry.controller.signal.aborted) throw abortError();
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        await writeAll(handle, chunk, position);
        position += chunk.length;
        entry.bytesReceived = position;
      }
    } finally {
      await handle.close();
    }

    if (entry.totalBytes > 0 && position !== entry.totalBytes) {
      throw new Error(`Incomplete download (${position}/${entry.totalBytes} bytes)`);
    }
  }

  private async downloadRange(
    entry: DownloadEntry,
    range: ByteRange,
    headers: Record<string, string>,
    validator: string | undefined,
    signal: AbortSignal
  ): Promise<void> {
    let position = range.start;
    let failures = 0;

    while (position <= range.end) {
      if (signal.aborted) throw abortError();
      try {
        const rangeHeaders = setHeader(headers, 'Range', `bytes=${position}-${range.end}`);
        const guardedHeaders = validator
          ? setHeader(rangeHeaders, 'If-Range', validator)
          : rangeHeaders;
        const response = await requestResponse(entry.url, {
          headers: guardedHeaders,
          rejectUnauthorized: entry.rejectUnauthorized,
          signal,
          timeoutMs: this.requestTimeoutMs
        });
        const parsed = parseContentRange(response.headers['content-range']);
        if (response.statusCode !== 206 || !parsed || parsed.start !== position ||
            parsed.end !== range.end || parsed.total !== entry.totalBytes) {
          discardInBackground(response);
          throw new RangeProtocolError(
            `Server rejected byte range ${position}-${range.end} (HTTP ${response.statusCode || 'unknown'})`
          );
        }

        const handle = await fs.promises.open(entry.filename, 'r+');
        try {
          for await (const value of response) {
            if (signal.aborted) throw abortError();
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            if (position + chunk.length - 1 > range.end) {
              throw new RangeProtocolError(`Server exceeded byte range ${range.start}-${range.end}`);
            }
            await writeAll(handle, chunk, position);
            position += chunk.length;
            entry.bytesReceived += chunk.length;
          }
        } finally {
          await handle.close();
        }

        if (position <= range.end) {
          throw new Error(`Range ended early at byte ${position}`);
        }
      } catch (error) {
        if (signal.aborted) throw abortError();
        if (error instanceof RangeProtocolError || isFilesystemError(error)) throw error;
        failures += 1;
        if (failures > RANGE_RETRIES) throw error;
        await abortableDelay(RETRY_DELAY_MS * (2 ** (failures - 1)), signal);
      }
    }
  }

  private callHook(
    hook: ((downloadId: number, value: string) => void | Promise<void>) | undefined,
    downloadId: number,
    value: string
  ): void {
    if (!hook) return;
    Promise.resolve(hook(downloadId, value)).catch(() => {});
  }

  private scheduleCleanup(downloadId: number, entry: DownloadEntry): void {
    if (entry.cleanupTimer) return;
    entry.cleanupTimer = setTimeout(() => {
      if (this.downloads.get(downloadId) === entry) this.downloads.delete(downloadId);
    }, this.cleanupDelayMs);
  }
}

function splitRanges(totalBytes: number, maxConnections: number): ByteRange[] {
  const connectionCount = Math.min(
    maxConnections,
    Math.max(1, Math.floor(totalBytes / MIN_BYTES_PER_CONNECTION))
  );
  const size = Math.ceil(totalBytes / connectionCount);
  const ranges: ByteRange[] = [];
  for (let start = 0; start < totalBytes; start += size) {
    ranges.push({ start, end: Math.min(totalBytes - 1, start + size - 1) });
  }
  return ranges;
}

function parseContentRange(value: string | string[] | undefined): ParsedContentRange | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(raw || '');
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) {
    return undefined;
  }
  return { start, end, total };
}

function rangeValidator(response: IncomingMessage): string | undefined {
  const etag = firstHeader(response.headers.etag);
  if (etag && !etag.startsWith('W/')) return etag;
  return firstHeader(response.headers['last-modified']);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function headerNumber(value: string | string[] | undefined): number {
  const number = Number(firstHeader(value));
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string
): Record<string, string> {
  const next = removeHeader(headers, name);
  next[name] = value;
  return next;
}

function removeHeader(headers: Record<string, string>, name: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name.toLowerCase()) next[key] = value;
  }
  return next;
}

async function writeAll(
  handle: fs.promises.FileHandle,
  buffer: Buffer,
  position: number
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (result.bytesWritten <= 0) throw new Error('Could not write download data');
    offset += result.bytesWritten;
  }
}

async function discardResponse(response: IncomingMessage): Promise<void> {
  for await (const _chunk of response) {
    // Drain the one-byte range probe so its socket closes cleanly.
  }
}

function discardInBackground(response: IncomingMessage): void {
  response.on('error', () => {});
  response.destroy();
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', aborted, { once: true });

    function done(): void {
      signal.removeEventListener('abort', aborted);
      resolve();
    }

    function aborted(): void {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function isFilesystemError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EDQUOT' || code === 'EFBIG' ||
    code === 'ENOSPC' || code === 'EPERM' || code === 'EROFS';
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value!)));
}
