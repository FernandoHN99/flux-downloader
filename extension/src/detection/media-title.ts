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

/**
 * A title from the page's own URL, for sites that name the content in the
 * path — `/jornada/react-2025/aula/testando-com-babel-repl` is the lesson.
 * Used when the page offers no usable title of its own.
 */
export function titleFromPageUrl(pageUrl: string): string | null {
  let segments: string[];
  try {
    segments = new URL(pageUrl).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }

  // A bare route like /watch or /video names the player, not the video.
  const last = segments.pop();
  if (!last || segments.length === 0) return null;

  const stem = last.replace(/\.[a-z0-9]{1,5}$/i, '');
  if (!stem || GENERIC_NAMES.has(stem.toLowerCase())) return null;
  if (looksLikeAnIdentifier(stem)) return null;

  const words = stem.split(/[-_+]+/).filter(Boolean);
  if (words.length === 0) return null;

  const title = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return title.length >= 2 ? title : null;
}
