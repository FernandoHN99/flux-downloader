import type { VideoInfo } from '../shared/types';

export interface HttpHeaderLike {
  name: string;
  value?: string;
}

export function getContentType(headers?: HttpHeaderLike[]): string {
  const header = headers?.find((item) => item.name.toLowerCase() === 'content-type');
  return (header?.value || '').split(';', 1)[0].trim().toLowerCase();
}

export function getMediaTypeFromContentType(
  contentType: string
): VideoInfo['type'] | undefined {
  if ([
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl'
  ].includes(contentType)) {
    return 'hls';
  }
  if (contentType === 'application/dash+xml') return 'dash';
  return undefined;
}

/** Reduce a request initiator to the origin FFmpeg/CDNs expect as Referer. */
export function getRequestReferer(initiator?: string): string | undefined {
  if (!initiator || initiator === 'null') return undefined;
  try {
    const url = new URL(initiator);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

export function getFfmpegHttpArgs(referer?: string): string[] {
  if (!referer) return [];
  try {
    return ['-referer', referer, '-headers', `Origin: ${new URL(referer).origin}\r\n`];
  } catch {
    return ['-referer', referer];
  }
}

/** Browser page context forwarded to every direct HTTP/range request. */
export function getDirectHttpHeaders(referer?: string): Array<{ name: string; value: string }> {
  if (!referer) return [];
  const headers = [{ name: 'Referer', value: referer }];
  try {
    headers.push({ name: 'Origin', value: new URL(referer).origin });
  } catch {
    // A non-URL referer is still useful as-is.
  }
  return headers;
}
