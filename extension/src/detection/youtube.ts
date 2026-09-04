import type { PageMetadata } from '../catalog/tab-state';
import type { VideoInfo, VideoQuality } from '../shared/types';

export interface YtdlpInfo {
  title?: string;
  duration?: number;
  thumbnail?: string;
  qualities?: unknown;
}

export function fallbackYtdlpQualities(url: string): VideoInfo['qualities'] {
  return [
    {
      label: 'Best',
      height: 0,
      url,
      bitrate: 0,
      kind: 'video',
      formatArgs: ['-f', 'bv*+ba/b']
    },
    {
      label: 'Audio MP3',
      height: 0,
      url,
      bitrate: 0,
      kind: 'audio',
      ext: 'mp3',
      formatArgs: ['-f', 'ba', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
    }
  ];
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function qualityKind(
  value: unknown,
  formatArgs: string[],
  extension?: string
): VideoQuality['kind'] {
  if (value === 'video' || value === 'audio' || value === 'subtitle') return value;
  if (formatArgs.includes('--write-subs') || formatArgs.includes('--write-auto-subs')) {
    return 'subtitle';
  }
  if (formatArgs.includes('-x') || formatArgs.includes('--audio-format') || extension === 'mp3') {
    return 'audio';
  }
  return 'video';
}

/**
 * Treat the native response as untrusted wire data. The kind inference keeps
 * compatibility with CoApps that predate explicit video/audio markers.
 */
export function normalizeYtdlpQualities(
  url: string,
  value: unknown
): VideoInfo['qualities'] {
  if (!Array.isArray(value)) return [];
  const normalized: VideoQuality[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    if (!Array.isArray(raw.formatArgs)) continue;
    const formatArgs = raw.formatArgs.filter((arg): arg is string => typeof arg === 'string');
    if (formatArgs.length === 0) continue;

    const ext = optionalString(raw.ext);
    normalized.push({
      height: finiteNumber(raw.height) || 0,
      width: finiteNumber(raw.width),
      bitrate: finiteNumber(raw.bitrate) || 0,
      url,
      label: optionalString(raw.label),
      formatArgs,
      formatId: optionalString(raw.formatId),
      ext,
      fps: finiteNumber(raw.fps),
      fileSize: finiteNumber(raw.fileSize),
      kind: qualityKind(raw.kind, formatArgs, ext),
      language: optionalString(raw.language)
    });
  }

  return normalized;
}

export function buildYtdlpVideo(
  id: string,
  url: string,
  metadata: PageMetadata,
  info?: YtdlpInfo
): VideoInfo {
  const qualities = normalizeYtdlpQualities(url, info?.qualities);
  return {
    id,
    title: info?.title || metadata.title || 'YouTube Video',
    pageUrl: metadata.pageUrl,
    url,
    type: 'ytdlp',
    qualities: qualities.length > 0 ? qualities : fallbackYtdlpQualities(url),
    thumbnail: info?.thumbnail || metadata.thumbnail,
    duration: info?.duration || metadata.duration
  };
}
