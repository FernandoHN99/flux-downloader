// Type definitions for extension

export interface NativeMessage {
  type: string;
  payload: any;
}

export interface DownloadRequest {
  url: string;
  quality?: string;
  format?: 'mp4' | 'webm' | 'mkv';
  savePath?: string;
  filename?: string;
  duration?: number;
}

export interface DownloadResponse {
  success: boolean;
  downloadId?: string;
  error?: string;
}

export interface VideoQuality {
  height: number;
  width?: number;
  bitrate?: number;
  url: string;
  label?: string;
  formatArgs?: string[];
  formatId?: string;
  ext?: string;
  fps?: number;
  fileSize?: number;
  kind?: 'video' | 'audio' | 'subtitle';
  language?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  /** The page that exposed this media; its own URL may belong to a CDN. */
  pageUrl?: string;
  url: string;
  /**
   * The title was taken from the page, not from the media URL. Single-page
   * sites often set the real title after the media request has already been
   * seen, so a page-derived title stays replaceable by a later, better one.
   */
  titleFromPage?: boolean;
  type: 'm3u8' | 'mpd' | 'direct' | 'hls' | 'dash' | 'mp4' | 'webm' | 'ytdlp' | 'mse';
  qualities: VideoQuality[];
  childUrls?: string[];
  referer?: string;
  thumbnail?: string;
  duration?: number;
  fileSize?: number;
}

// A video kept in the global detection history, with the page it came from.
export interface HistoryEntry extends VideoInfo {
  pageTitle?: string;
  /**
   * The user typed this title. Detection must not overwrite it: a video that
   * leaves the current list and comes back is still the one they named.
   */
  titleByUser?: boolean;
  /** When this video was last detected. */
  detectedAt: number;
  /** Set when broadcasting: this video was downloaded at least once. */
  downloaded?: boolean;
  /** Set when broadcasting: the last download attempt failed. */
  failed?: boolean;
}

export interface DownloadProgress {
  downloadId: string;
  percent: number;
  speed?: number;
  eta?: number;
  complete: boolean;
  error?: string;
}
