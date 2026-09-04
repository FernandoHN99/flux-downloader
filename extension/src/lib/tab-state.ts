import { VideoInfo } from './types';
import type { RelayCodec } from './relay-codec';

export interface PageMetadata {
  title?: string;
  thumbnail?: string;
  duration?: number;
  pageUrl?: string;
  generation?: number;
}

export interface TabState {
  pageGeneration: number;
  media?: VideoInfo[];
  interceptedMedia?: Set<string>;
  pageMetadata?: PageMetadata;
  ytdlpFormatUrl?: string;
  navigationGeneration?: number;
  currentPageUrl?: string | null;
  relayMappings?: Map<string, string>;
  relayCodecs?: Map<string, RelayCodec>;
}

/** Owns all state whose lifetime is tied to a browser tab. */
export class TabStateStore {
  private readonly states = new Map<number, TabState>();
  private nextPageGeneration = 0;

  get(tabId: number): TabState | undefined {
    return this.states.get(tabId);
  }

  ensure(tabId: number): TabState {
    let state = this.states.get(tabId);
    if (!state) {
      state = { pageGeneration: this.newPageGeneration() };
      this.states.set(tabId, state);
    }
    return state;
  }

  /**
   * Starts a fresh page lifetime while retaining navigation identity, which is
   * managed independently by the browser/content-script navigation handlers.
   */
  resetPage(tabId: number): TabState {
    const previous = this.states.get(tabId);
    const state: TabState = {
      pageGeneration: this.newPageGeneration(),
      currentPageUrl: previous?.currentPageUrl,
      navigationGeneration: previous?.navigationGeneration
    };
    this.states.set(tabId, state);
    return state;
  }

  delete(tabId: number): boolean {
    return this.states.delete(tabId);
  }

  isCurrentPageGeneration(tabId: number, generation: number): boolean {
    return this.states.get(tabId)?.pageGeneration === generation;
  }

  hasMediaState(): boolean {
    for (const state of this.states.values()) {
      if (state.media !== undefined) return true;
    }
    return false;
  }

  *mediaEntries(): IterableIterator<[number, VideoInfo[]]> {
    for (const [tabId, state] of this.states) {
      if (state.media !== undefined) yield [tabId, state.media];
    }
  }

  private newPageGeneration(): number {
    this.nextPageGeneration += 1;
    return this.nextPageGeneration;
  }
}
