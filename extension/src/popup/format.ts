// Turning raw numbers into the short strings the rows and panels show.

import type { VideoInfo, VideoQuality } from '../shared/types';

export function getTypeLabel(type: string): string {
  switch (type) {
    case 'hls':
    case 'm3u8':
      return 'HLS';
    case 'dash':
    case 'mpd':
      return 'DASH';
    case 'mp4':
      return 'MP4';
    case 'webm':
      return 'WebM';
    case 'ytdlp':
      return 'YT-DLP';
    case 'mse':
      return 'MSE';
    default:
      return 'Video';
  }
}

export function getQualityLabel(height?: number): string {
  if (!height) return 'Unknown';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

export function formatBandwidth(bps: number): string {
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)} Mbps`;
  }
  return `${Math.round(bps / 1000)} Kbps`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  if (bytesPerSec > 1000000) {
    return `${(bytesPerSec / 1000000).toFixed(1)} MB/s`;
  }
  if (bytesPerSec > 1000) {
    return `${(bytesPerSec / 1000).toFixed(0)} KB/s`;
  }
  return `${bytesPerSec} B/s`;
}

export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * How long a video is, spelled out so a row identifies it at a glance:
 * "16 min 20 s", "45 s". Minutes are never folded into hours, because
 * "75 min 03 s" is read faster than "1:15:03" in a list of lessons.
 */
export function formatLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes === 0) return `${secs} s`;
  return `${minutes} min ${secs.toString().padStart(2, '0')} s`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function getSizeLabel(quality: VideoQuality, video: VideoInfo): string | undefined {
  if (quality.fileSize) return formatFileSize(quality.fileSize);
  if (video.fileSize) return formatFileSize(video.fileSize);
  if (quality.bitrate && video.duration) {
    return `~${formatFileSize((quality.bitrate * video.duration) / 8)}`;
  }
  return undefined;
}
