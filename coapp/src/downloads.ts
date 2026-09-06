// Direct-download RPC handlers. The transfer engine lives in http-download.ts
// so range behavior can be verified without booting the native transport.

import * as os from 'os';
import * as path from 'path';
import rpc from './rpc';
import {
  DEFAULT_HTTP_CONNECTIONS,
  DirectDownloadManager,
  requestResponse
} from './http-download';

const defaultDownloadFolder = path.join(os.homedir(), 'Downloads');

const manager = new DirectDownloadManager({
  maxConnections: DEFAULT_HTTP_CONNECTIONS,
  onComplete: (downloadId, filename) => {
    return rpc.call('downloadComplete', downloadId, filename).catch(() => {});
  },
  onError: (downloadId, error) => {
    return rpc.call('downloadError', downloadId, error).catch(() => {});
  }
});

rpc.listen({
  'downloads.download': (options: any = {}) => {
    const filename = path.join(
      options.directory || defaultDownloadFolder,
      options.filename || 'download'
    );
    const headers: Record<string, string> = {};
    for (const header of options.headers || []) {
      if (typeof header?.name === 'string' && header.value !== undefined) {
        headers[header.name] = String(header.value);
      }
    }

    return manager.start({
      url: String(options.url || ''),
      filename,
      headers,
      rejectUnauthorized: options.rejectUnauthorized !== false
    });
  },

  'downloads.search': (query: any = {}) => {
    const entry = manager.search(Number(query.id));
    return entry ? [entry] : [];
  },

  // Cheap liveness check for a media URL. The body is never retained.
  'downloads.probeStatus': async (url: string, referer?: string) => {
    const headers: Record<string, string> = {};
    if (referer) {
      headers.Referer = referer;
      try { headers.Origin = new URL(referer).origin; } catch { /* not a URL */ }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await requestResponse(url, {
        headers,
        signal: controller.signal,
        timeoutMs: 10_000
      });
      const status = response.statusCode;
      response.on('error', () => {});
      response.destroy();
      return { status };
    } catch (error: any) {
      return { error: controller.signal.aborted ? 'Probe timed out' : error?.message || String(error) };
    } finally {
      clearTimeout(timeout);
    }
  },

  'downloads.cancel': (downloadId: number) => ({
    success: manager.cancel(downloadId)
  })
});

console.error(
  '[Flux Downloader CoApp] Downloads module loaded (default folder: %s, HTTP connections: %d)',
  defaultDownloadFolder,
  DEFAULT_HTTP_CONNECTIONS
);
