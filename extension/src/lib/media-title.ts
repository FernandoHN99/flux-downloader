// Naming a detected video from its own URL.

/**
 * Manifests and progressive files are very often served under a name that
 * says nothing — playlist.m3u8, index.mp4, 1080.ts. Treating those as titles
 * would give every video on a site the same name, so they are rejected and
 * the caller falls back to the page title.
 */
const GENERIC_NAMES = new Set([
  'playlist', 'index', 'master', 'manifest', 'stream', 'chunklist', 'prog_index',
  'video', 'media', 'audio', 'movie', 'file', 'content', 'source', 'src',
  'out', 'output', 'main', 'default', 'init', 'segment', 'seg', 'track',
  'hls', 'dash', 'mpd', 'play', 'watch', 'embed', 'download', 'download.mp4',
  'videoplayback', 'blob', 'temp', 'tmp'
]);

/** Hex blobs, UUIDs and bare numbers are identifiers, not names. */
function looksLikeAnIdentifier(value: string): boolean {
  const bare = value.replace(/[-_]/g, '');
  if (/^\d+$/.test(bare)) return true;
  if (/^[0-9a-f]{16,}$/i.test(bare)) return true;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)) return true;
  return false;
}

/**
 * A human-readable title taken from the last path segment, or null when that
 * segment carries no information.
 */
export function titleFromMediaUrl(url: string): string | null {
  let segment: string;
  try {
    const path = new URL(url, 'https://invalid.local').pathname;
    segment = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  } catch {
    return null;
  }

  if (!segment) return null;

  // Drop the extension, but only a real one — a dot inside a name stays.
  const stem = segment.replace(/\.[a-z0-9]{1,5}$/i, '');
  const normalized = stem.trim().toLowerCase();
  if (!normalized || GENERIC_NAMES.has(normalized)) return null;

  // A generic name with a resolution glued on (video_1080p) is still generic.
  const withoutQuality = normalized.replace(/[-_.]?\d{3,4}p?$/i, '');
  if (withoutQuality && GENERIC_NAMES.has(withoutQuality)) return null;

  if (looksLikeAnIdentifier(stem)) return null;

  const title = stem.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (title.length < 2) return null;
  return title;
}
