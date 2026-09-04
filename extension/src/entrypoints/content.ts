// Flux Downloader Content Script
// Runs on every page to detect video streams

import {
  announcedVideo, detectionReplayKey, emptyMseState, mseDetection
} from '../detection/mse-media';
import type { DetectedMedia, MseState } from '../detection/mse-media';
import {
  isMseBridgeMessage, isMseStateMessage, reduceMseState
} from '../detection/mse-bridge';
import { collectDomMediaUrls } from '../detection/dom-media';
import {
  collectPageMetadata, detectedTitle, pageDuration, pageThumbnail
} from '../detection/page-metadata';
import { isContentCommand } from '../shared/content-protocol';
import type { RuntimeRequest } from '../shared/content-protocol';
import { mediaTypeFromUrl, resolveMediaUrl } from '../detection/media-url';

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
    this.setupMediaMetadataListener();
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
      if (!isContentCommand(message)) return undefined;
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
    this.sendRuntime({ type: 'PAGE_NAVIGATION', pageUrl, generation });
  }

  private sendRuntime(message: RuntimeRequest): void {
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated (extension was reloaded)
    }
  }

  private setupMSEListener(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !isMseBridgeMessage(event.data)) return;

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

      if (msg.type === 'media-url-map') {
        this.sendRuntime({
          type: 'MEDIA_URL_MAP',
          originalUrl: msg.originalUrl,
          relayUrl: msg.relayUrl,
          pageUrl: this.pageUrl,
          generation: this.pageGeneration
        });
      } else if (isMseStateMessage(msg)) {
        const update = reduceMseState(this.mseState, msg);
        this.mseState = update.state;
        if (update.announce) this.sendMSEToBackground();
      }
    });
  }

  private sendMSEToBackground(): void {
    const media = mseDetection(this.mseState, this.pageUrl, this.pageGeneration);
    if (media) this.sendToBackground(media);
  }

  /** `loadedmetadata` does not bubble, so one capture listener owns all media. */
  private setupMediaMetadataListener(): void {
    document.addEventListener('loadedmetadata', (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      this.scanMediaNode(event.target);
      this.sendPageMetadata();
    }, true);
  }

  /**
   * Set up DOM observer for dynamically added media elements
   */
  private setupDOMObserver(): void {
    // Watch for dynamically added video/audio elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            this.scanMediaNode(node);
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

    this.scanMediaNode(document);
  }

  private scanMediaNode(root: ParentNode): void {
    for (const url of collectDomMediaUrls(root, window.location.href)) {
      this.handleMediaUrl(url);
    }
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

    this.sendRuntime({ type: 'PAGE_METADATA', metadata });
  }

  /**
   * Handle a detected media URL
   */
  private handleMediaUrl(url: string): void {
    const pageUrl = window.location.href;
    const normalizedUrl = resolveMediaUrl(url, pageUrl);
    if (!normalizedUrl || this.mediaUrls.has(normalizedUrl)) return;
    this.mediaUrls.add(normalizedUrl);

    console.log('[Flux] Media URL detected:', normalizedUrl);

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
    const named = detectedTitle(
      document,
      media.type === 'mse' ? undefined : media.url,
      media.pageUrl
    );
    const video = announcedVideo(
      media,
      this.generateVideoId(media),
      named.title,
      {
        duration: pageDuration(document),
        thumbnail: pageThumbnail(document, media.pageUrl),
        titleFromPage: named.fromPage
      }
    );
    this.sendRuntime({ type: 'VIDEO_DETECTED', video });
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
