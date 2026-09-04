import { describe, expect, it } from 'vitest';
import { TabStateStore } from './tab-state';

describe('TabStateStore', () => {
  it('returns the same state for repeated access to one tab', () => {
    const store = new TabStateStore();

    expect(store.ensure(7)).toBe(store.ensure(7));
  });

  it('resets page data while preserving navigation identity', () => {
    const store = new TabStateStore();
    const state = store.ensure(7);
    state.currentPageUrl = 'https://example.com/watch';
    state.navigationGeneration = 4;
    state.media = [];
    state.interceptedMedia = new Set(['https://cdn.example/video.m3u8']);
    state.pageMetadata = { title: 'Old page' };
    state.ytdlpFormatUrl = 'https://example.com/watch';
    state.relayMappings = new Map([['original', 'relay']]);
    state.relayCodecs = new Map();

    const reset = store.resetPage(7);

    expect(reset.pageGeneration).not.toBe(state.pageGeneration);
    expect(reset.currentPageUrl).toBe('https://example.com/watch');
    expect(reset.navigationGeneration).toBe(4);
    expect(reset.media).toBeUndefined();
    expect(reset.interceptedMedia).toBeUndefined();
    expect(reset.pageMetadata).toBeUndefined();
    expect(reset.ytdlpFormatUrl).toBeUndefined();
    expect(reset.relayMappings).toBeUndefined();
    expect(reset.relayCodecs).toBeUndefined();
  });

  it('does not reuse a generation after a tab is removed', () => {
    const store = new TabStateStore();
    const removedGeneration = store.ensure(7).pageGeneration;

    store.delete(7);
    expect(store.isCurrentPageGeneration(7, removedGeneration)).toBe(false);
    expect(store.get(7)).toBeUndefined();

    const replacementGeneration = store.ensure(7).pageGeneration;

    expect(store.get(7)?.pageGeneration).toBe(replacementGeneration);
    expect(replacementGeneration).not.toBe(removedGeneration);
  });

  it('distinguishes an untouched media state from a known empty result', () => {
    const store = new TabStateStore();
    store.ensure(7);

    expect(store.hasMediaState()).toBe(false);
    expect([...store.mediaEntries()]).toEqual([]);

    store.ensure(7).media = [];

    expect(store.hasMediaState()).toBe(true);
    expect([...store.mediaEntries()]).toEqual([[7, []]]);
  });
});
