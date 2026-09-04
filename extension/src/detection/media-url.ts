import type { VideoInfo } from '../shared/types';

export type UrlMediaType = Extract<VideoInfo['type'], 'hls' | 'dash' | 'mp4' | 'webm' | 'direct'>;

function parseUrl(value: string | URL, baseUrl?: string): URL | null {
  if (value instanceof URL) return value;
  try {
    return baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }
}

function typeFromPath(pathname: string): UrlMediaType {
  const path = pathname.toLowerCase();
  if (path.includes('.m3u8')) return 'hls';
  if (path.includes('.mpd')) return 'dash';
  if (path.endsWith('.mp4')) return 'mp4';
  if (path.endsWith('.webm')) return 'webm';
  return 'direct';
}

/** Resolve a page-relative media URL once, so dedup and messages share a key. */
export function resolveMediaUrl(value: string, baseUrl: string): string | null {
  return parseUrl(value, baseUrl)?.href ?? null;
}

/**
 * Classify a URL by path. Unknown and malformed values are direct because a
 * media element itself is still evidence even when its URL has no extension.
 */
export function mediaTypeFromUrl(value: string | URL, baseUrl?: string): UrlMediaType {
  const parsed = parseUrl(value, baseUrl);
  return parsed ? typeFromPath(parsed.pathname) : 'direct';
}

/**
 * Whether an arbitrary attribute/request is recognizable media. Unlike a
 * media element, an arbitrary DOM node is not enough evidence for `direct`.
 */
export function isMediaUrl(value: string | URL, baseUrl?: string): boolean {
  const parsed = parseUrl(value, baseUrl);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return false;
  return typeFromPath(parsed.pathname) !== 'direct';
}

export function isYouTubeUrl(value: string | URL): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  return [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
  ].includes(parsed.hostname);
}
