// Download Manager — VDH-style RPC handlers
// Registers: downloads.download, downloads.search, downloads.cancel

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';
import rpc from './rpc';

function requestStream(url: string, options: any, redirects = 0): PassThrough {
  const output = new PassThrough();
  if (redirects > 5) {
    process.nextTick(() => output.emit('error', new Error('Too many download redirects')));
    return output;
  }

  const client = url.startsWith('https:') ? https : http;
  const request = client.get(url, {
    headers: options.headers,
    rejectUnauthorized: options.rejectUnauthorized !== false
  }, response => {
    const location = response.headers.location;
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      const redirected = requestStream(new URL(location, url).toString(), options, redirects + 1);
      redirected.on('response', redirectedResponse => output.emit('response', redirectedResponse));
      redirected.on('error', error => output.emit('error', error));
      redirected.pipe(output);
      return;
    }

    if (!response.statusCode || response.statusCode >= 400) {
      response.resume();
      output.emit('error', new Error(`Download failed with HTTP ${response.statusCode || 'unknown'}`));
      return;
    }

    output.emit('response', response);
    response.on('error', error => output.emit('error', error));
    response.pipe(output);
  });
  request.on('error', error => output.emit('error', error));
  return output;
}

const defaultDownloadFolder = path.join(os.homedir(), 'Downloads');

let currentDownloadId = 0;
const downloads: Record<number, any> = {};

function cleanupEntry(downloadId: number): void {
  setTimeout(() => { delete downloads[downloadId]; }, 60000);
}

rpc.listen({
  'downloads.download': async (options: any = {}) => {
    const filename = path.join(
      options.directory || defaultDownloadFolder,
      options.filename || 'download'
    );

    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const dlOptions: any = {
      rejectUnauthorized: options.rejectUnauthorized !== false,
      headers: {}
    };
    (options.headers || []).forEach((header: any) => {
      dlOptions.headers[header.name] = header.value;
    });

    const downloadId = ++currentDownloadId;
    const stream = requestStream(options.url, dlOptions);

    downloads[downloadId] = {
      stream,
      totalBytes: 0,
      bytesReceived: 0,
      url: options.url,
      filename,
      state: 'in_progress',
      error: null
    };

    stream.on('response', (response: any) => {
      const contentLength = response.headers['content-length'];
      if (contentLength) {
        downloads[downloadId].totalBytes = parseInt(contentLength, 10);
        response.on('data', (data: Buffer) => {
          downloads[downloadId].bytesReceived += data.length;
        });
      }
    });

    stream.on('error', (error: any) => {
      const entry = downloads[downloadId];
      if (!entry) return;
      // ECONNRESET after receiving data usually means the server closed
      // the connection after a complete transfer — treat as complete.
      if (error.code === 'ECONNRESET' && entry.bytesReceived > 0) {
        entry.state = 'complete';
      } else {
        entry.state = 'interrupted';
        entry.error = error.message || String(error);
        rpc.call('downloadError', downloadId, entry.error).catch(() => {});
      }
      cleanupEntry(downloadId);
    });

    const fileStream = fs.createWriteStream(filename);
    stream.pipe(fileStream)
      .on('finish', () => {
        const entry = downloads[downloadId];
        if (entry && entry.state === 'in_progress') {
          entry.state = 'complete';
          rpc.call('downloadComplete', downloadId, filename).catch(() => {});
        }
        cleanupEntry(downloadId);
      })
      .on('error', (err: Error) => {
        const entry = downloads[downloadId];
        if (entry) {
          entry.state = 'interrupted';
          entry.error = err.message || String(err);
          rpc.call('downloadError', downloadId, entry.error).catch(() => {});
        }
        cleanupEntry(downloadId);
      });

    return downloadId;
  },

  'downloads.search': (query: any = {}) => {
    const entry = downloads[query.id];
    if (entry) {
      return [{
        totalBytes: entry.totalBytes,
        bytesReceived: entry.bytesReceived,
        url: entry.url,
        filename: entry.filename,
        state: entry.state,
        error: entry.error
      }];
    }
    return [];
  },

  // Cheap liveness check for a media URL — the extension uses it to tell an
  // expired link apart from a real download failure. Body is never read.
  'downloads.probeStatus': (url: string, referer?: string) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: any) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const headers: Record<string, string> = {};
      if (referer) {
        headers.Referer = referer;
        try { headers.Origin = new URL(referer).origin; } catch { /* referer isn't a URL */ }
      }

      const stream = requestStream(url, { headers });
      stream.on('response', (response: any) => {
        done({ status: response.statusCode });
        stream.destroy();
      });
      stream.on('error', (error: any) => {
        const match = /HTTP (\d{3})/.exec(error?.message || '');
        done(match ? { status: Number(match[1]) } : { error: error?.message || String(error) });
      });
      setTimeout(() => done({ error: 'Probe timed out' }), 10000);
    });
  },

  'downloads.cancel': (downloadId: number) => {
    const entry = downloads[downloadId];
    if (entry && entry.state === 'in_progress') {
      entry.state = 'interrupted';
      entry.error = 'Aborted';
      try { entry.stream.destroy(); } catch { /* already destroyed */ }
    }
  }
});

console.error('[Flux Downloader CoApp] Downloads module loaded (default folder: %s)', defaultDownloadFolder);
