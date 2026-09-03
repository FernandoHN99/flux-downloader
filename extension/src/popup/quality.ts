// Turning a detected video's renditions into the list a row offers.

import type { VideoInfo, VideoQuality } from '../lib/types';
import { formatBandwidth, formatFileSize, getQualityLabel, getSizeLabel } from './format';

export interface QualityOption {
  label: string;
  bandwidth: number;
  bandwidthLabel: string;
  resolution?: string;
  url: string;
  height?: number;
  width?: number;
  sizeLabel?: string;
  formatArgs?: string[];
  formatId?: string;
  ext?: string;
  fps?: number;
  fileSize?: number;
  kind?: VideoQuality['kind'];
  language?: string;
}

export function buildQualityOptions(video: VideoInfo): QualityOption[] {
  const options: QualityOption[] = (video.qualities || []).map((q) => ({
    label: q.label || getQualityLabel(q.height),
    bandwidth: q.bitrate || 0,
    bandwidthLabel: q.bitrate ? formatBandwidth(q.bitrate) : 'Unknown',
    resolution: q.width && q.height ? `${q.width}x${q.height}` : undefined,
    url: q.url,
    height: q.height,
    width: q.width,
    sizeLabel: getSizeLabel(q, video),
    formatArgs: q.formatArgs,
    formatId: q.formatId,
    ext: q.ext,
    fps: q.fps,
    fileSize: q.fileSize,
    kind: q.kind,
    language: q.language
  }));

  // Nothing parsed out of the manifest — offer the link itself. YouTube is the
  // exception: its formats arrive later, from yt-dlp.
  if (options.length === 0 && video.type !== 'ytdlp') {
    return [{
      label: 'Direct',
      bandwidth: 0,
      bandwidthLabel: 'Unknown',
      url: video.url,
      sizeLabel: video.fileSize ? formatFileSize(video.fileSize) : undefined
    }];
  }
  return options;
}

/**
 * The lowest option that is actually video. Audio-only and subtitle tracks
 * sort below every rendition, so "Lowest" would otherwise pick a subtitle.
 */
export function lowestQualityIndex(options: QualityOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if ((options[i].height || 0) > 0) return i;
  }
  return Math.max(0, options.length - 1);
}

/**
 * Best and Lowest are shortcuts to an option in the list, not modes, so each
 * is lit only while the option it points at is the chosen one.
 */
export function activeShortcut(options: QualityOption[], selected: number): 'best' | 'worst' | null {
  if (options.length === 0) return null;
  if (selected === 0) return 'best';
  if (selected === lowestQualityIndex(options)) return 'worst';
  return null;
}
