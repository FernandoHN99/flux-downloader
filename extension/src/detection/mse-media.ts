import type { UrlMediaType } from './media-url';
import type { VideoInfo, VideoQuality } from '../shared/types';

export interface DetectedMedia {
  type: UrlMediaType | 'mse';
  url: string;
  qualities?: VideoQuality[];
  pageUrl: string;
  generation: number;
  duration?: number;
}

export interface MseState {
  blobUrl?: string;
  mimeType?: string;
  codecs?: string;
  totalBytes: number;
  segmentUrls: string[];
  initSegmentUrl?: string;
  duration?: number;
}

export type AnnouncedVideo = VideoInfo & { pageUrl: string; generation: number };

export function emptyMseState(): MseState {
  return { totalBytes: 0, segmentUrls: [] };
}

/** MSE observations evolve from a blob URL to an init URL; replay only the latest one. */
export function detectionReplayKey(media: DetectedMedia): string {
  return media.type === 'mse' ? 'mse' : media.url;
}

/** Convert accumulated page-world observations into one replayable detection. */
export function mseDetection(
  state: MseState,
  pageUrl: string,
  generation: number
): DetectedMedia | null {
  if (!state.mimeType) return null;
  const url = state.initSegmentUrl || state.blobUrl || '';
  if (!url) return null;

  const codec = state.codecs || '';
  const isAudioOnly = state.mimeType.startsWith('audio/');
  const qualities: VideoQuality[] = [{
    height: 0,
    url,
    bitrate: 0,
    label: isAudioOnly ? 'Audio' : (codec ? codec.split(',')[0] : 'MSE Stream'),
    kind: isAudioOnly ? 'audio' : 'video'
  }];

  if (state.segmentUrls.length > 0 && state.initSegmentUrl) {
    qualities.push({
      height: 0,
      url: state.initSegmentUrl,
      bitrate: 0,
      label: 'All Segments',
      kind: 'video',
      formatArgs: [
        '-i',
        state.initSegmentUrl,
        ...state.segmentUrls.slice(1, 200).flatMap((segment) => ['-i', segment]),
        '-c',
        'copy'
      ]
    });
  }

  return {
    type: 'mse',
    url,
    qualities,
    pageUrl,
    generation,
    duration: state.duration
  };
}

/** Build the background payload without touching DOM, Chrome, clocks, or IDs. */
export function announcedVideo(
  media: DetectedMedia,
  id: string,
  title: string,
  fallback: { duration?: number; thumbnail?: string }
): AnnouncedVideo {
  return {
    id,
    title,
    url: media.url,
    type: media.type,
    qualities: media.qualities || [],
    duration: media.duration || fallback.duration,
    thumbnail: fallback.thumbnail,
    pageUrl: media.pageUrl,
    generation: media.generation
  };
}
