// MediaGrabber Content Script
// Runs on every page to detect video streams

import {
  announcedVideo, detectionReplayKey, emptyMseState, mseDetection
} from './content/mse-media';
import type { DetectedMedia, MseState } from './content/mse-media';
import {
  collectPageMetadata, detectedTitle, pageDuration, pageThumbnail
} from './content/page-metadata';
import { isMediaUrl, mediaTypeFromUrl, resolveMediaUrl } from './lib/media-url';

class MediaDetector {
  private mediaUrls = new Set<string>();
  // Everything this page has announced, keyed by media URL.
  private announced = new Map<string, DetectedMedia>();
  private lastMetadataKey = '';
  private metadataTimer: number | undefined;
  private pageUrl = window.location.href;
  private pageGeneration = 0;
  private mseState: MseState = emptyMseState();

  constructor() {
    this.setupRescanListener();
    this.setupNavigationListener();
    this.setupMSEListener();
    this.setupDOMObserver();
    this.scanExistingMedia();
    this.scheduleMetadataSend();

    document.addEventListener('DOMContentLoaded', () => this.sendPageMetadata(), { once: true });
    window.addEventListener('load', () => this.sendPageMetadata(), { once: true });
  }

  /**
   * The background's media map lives only in memory, so an idle service
   * worker restart wipes it. This lets it ask every page to say again what
   * it has, instead of the user having to reload tabs.
   */
  private setupRescanListener(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'RESCAN') return undefined;
      for (const media of this.announced.values()) this.sendToBackground(media);
      this.scanExistingMedia();
      this.lastMetadataKey = '';
      this.sendPageMetadata();
      sendResponse({ success: true, count: this.announced.size });
      return undefined;
    });
  }

  private setupNavigationListener(): void {
    const checkForUrlChange = () => this.handleNavigation(window.location.href);

    window.addEventListener('popstate', checkForUrlChange);
    window.addEventListener('hashchange', checkForUrlChange);
  }

  private handleNavigation(pageUrl: string, generation?: number): void {
    if (pageUrl === this.pageUrl && (generation === undefined || generation <= this.pageGeneration)) return;

    this.pageUrl = pageUrl;
    this.pageGeneration = generation ?? this.pageGeneration + 1;
    this.mediaUrls.clear();
    this.announced.clear();
    this.lastMetadataKey = '';
    this.mseState = emptyMseState();
    this.sendNavigation(pageUrl, this.pageGeneration);
    this.scheduleMetadataSend();
  }

  private sendNavigation(pageUrl: string, generation: number): void {
    try {
      chrome.runtime.sendMessage({ type: 'PAGE_NAVIGATION', pageUrl, generation }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated (extension was reloaded)
    }
  }

  private setupMSEListener(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.source !== 'MediaGrabber-MSE') return;

      const msg = event.data;
      if (msg.type === 'navigation') {
        if (typeof msg.pageUrl === 'string' && typeof msg.generation === 'number') {
          this.handleNavigation(msg.pageUrl, msg.generation);
        }
        return;
      }
      if (msg.pageUrl !== this.pageUrl || msg.generation !== this.pageGeneration) {
        if (msg.pageUrl === window.location.href && msg.generation > this.pageGeneration) {
          this.handleNavigation(msg.pageUrl, msg.generation);
        }
        if (msg.pageUrl !== this.pageUrl || msg.generation !== this.pageGeneration) return;
      }

      switch (msg.type) {
        case 'source-buffer':
          this.mseState.blobUrl = msg.blobUrl;
          this.mseState.mimeType = msg.mimeType;
          this.mseState.codecs = msg.codecs;
          this.sendMSEToBackground();
          break;

        case 'segment-url':
          if (msg.isInit && !this.mseState.initSegmentUrl) {
            this.mseState.initSegmentUrl = msg.url;
          }
          if (this.mseState.segmentUrls.length < 500 && !this.mseState.segmentUrls.includes(msg.url)) {
            this.mseState.segmentUrls.push(msg.url);
          }
          if (this.mseState.segmentUrls.length === 1 || this.mseState.segmentUrls.length % 20 === 0) {
            this.sendMSEToBackground();
          }
          break;

        case 'duration':
          this.mseState.duration = msg.duration;
          this.sendMSEToBackground();
          break;

        case 'media-url-map':
          if (typeof msg.originalUrl === 'string' && typeof msg.relayUrl === 'string') {
            try {
              chrome.runtime.sendMessage({
                type: 'MEDIA_URL_MAP',
                originalUrl: msg.originalUrl,
                relayUrl: msg.relayUrl,
                pageUrl: this.pageUrl,
                generation: this.pageGeneration
              }, () => { void chrome.runtime.lastError; });
            } catch {
              // Extension context invalidated
            }
          }
          break;

        case 'progress':
          this.mseState.totalBytes = msg.totalBytes;
          break;
      }
    });
  }

  private sendMSEToBackground(): void {
    const media = mseDetection(this.mseState, this.pageUrl, this.pageGeneration);
    if (media) this.sendToBackground(media);
  }

  /**
   * Set up DOM observer for dynamically added media elements
   */
  private setupDOMObserver(): void {
    // Watch for dynamically added video/audio elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
            this.handleMediaElement(node as HTMLVideoElement);
          }
          // Check if it's an element with src attribute
          if (node instanceof Element) {
            const src = node.getAttribute('src');
            if (src && isMediaUrl(src, window.location.href)) {
              this.handleMediaUrl(src);
            }
            // Check for source elements inside video
            const sources = node.querySelectorAll('source[src]');
            sources.forEach(source => {
              const sourceSrc = source.getAttribute('src');
              if (sourceSrc) this.handleMediaUrl(sourceSrc);
            });
          }
        });
      });

      this.scheduleMetadataSend();
    });

    const startObserving = () => {
      const target = document.body || document.documentElement;
      if (!target) {
        return;
      }

      observer.observe(target, { childList: true, subtree: true });
    };

    if (document.body || document.documentElement) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
  }

  /**
   * Scan for existing media elements on page load
   */
  private scanExistingMedia(): void {
    if (!document.body && !document.documentElement) {
      document.addEventListener('DOMContentLoaded', () => this.scanExistingMedia(), { once: true });
      return;
    }

    // Check existing video elements
    document.querySelectorAll('video, audio').forEach(el => {
      this.handleMediaElement(el as HTMLVideoElement);
    });

    // Check for media source elements
    document.querySelectorAll('source[src]').forEach(source => {
      const src = source.getAttribute('src');
      if (src) this.handleMediaUrl(src);
    });

    // Check for iframe elements that might contain media
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const src = iframe.getAttribute('src');
        if (src && isMediaUrl(src, window.location.href)) {
          this.handleMediaUrl(src);
        }
      } catch {
        // Cross-origin iframe, ignore
      }
    });
  }

  /**
   * Handle a media element (video/audio)
   */
  private handleMediaElement(el: HTMLVideoElement): void {
    const src = el.currentSrc || el.src;
    if (src) {
      this.handleMediaUrl(src);
    }

    // Also check for source elements inside
    el.querySelectorAll('source[src]').forEach(source => {
      const sourceSrc = source.getAttribute('src');
      if (sourceSrc) this.handleMediaUrl(sourceSrc);
    });

    // Listen for source changes
    el.addEventListener('loadedmetadata', () => {
      const currentSrc = el.currentSrc;
      if (currentSrc) this.handleMediaUrl(currentSrc);
      this.sendPageMetadata();
    });
  }

  private scheduleMetadataSend(): void {
    if (this.metadataTimer !== undefined) return;
    this.metadataTimer = window.setTimeout(() => {
      this.metadataTimer = undefined;
      this.sendPageMetadata();
    }, 250);
  }

  private sendPageMetadata(): void {
    const metadata = collectPageMetadata(document, window.location.href, this.pageGeneration);
    const key = JSON.stringify(metadata);
    if (key === this.lastMetadataKey) return;
    this.lastMetadataKey = key;

    try {
      chrome.runtime.sendMessage({ type: 'PAGE_METADATA', metadata }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated (extension was reloaded)
    }
  }

  /**
   * Handle a detected media URL
   */
  private handleMediaUrl(url: string): void {
    const pageUrl = window.location.href;
    const normalizedUrl = resolveMediaUrl(url, pageUrl);
    if (!normalizedUrl || this.mediaUrls.has(normalizedUrl)) return;
    this.mediaUrls.add(normalizedUrl);

    console.log('[MediaGrabber] Media URL detected:', normalizedUrl);

    const media: DetectedMedia = {
      type: mediaTypeFromUrl(normalizedUrl),
      url: normalizedUrl,
      pageUrl,
      generation: this.pageGeneration
    };

    this.sendToBackground(media);
  }

  /**
   * Send detected media to background script
   */
  private sendToBackground(media: DetectedMedia): void {
    this.announced.set(detectionReplayKey(media), media);
    const video = announcedVideo(
      media,
      this.generateVideoId(media),
      detectedTitle(document, media.type === 'mse' ? undefined : media.url),
      {
        duration: pageDuration(document),
        thumbnail: pageThumbnail(document, media.pageUrl)
      }
    );
    try {
      chrome.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        video
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated (extension was reloaded)
    }
  }

  /**
   * Generate a unique ID for a video
   */
  private generateVideoId(media: DetectedMedia): string {
    const prefix = media.type === 'mse' ? 'mse' : 'video';
    try {
      return `${prefix}_${btoa(encodeURIComponent(media.url)).substring(0, 20)}_${Date.now()}`;
    } catch {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
    }
  }
}

// Initialize when DOM is ready
new MediaDetector();
