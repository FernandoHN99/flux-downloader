import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadTracker, type ActiveDownload } from './download-tracker';

function download(overrides: Partial<ActiveDownload> = {}): ActiveDownload {
  return {
    type: 'direct',
    directory: '/downloads',
    filename: 'lesson.mp4',
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadTracker', () => {
  it('tracks entries and finds the active download for a tab', () => {
    const tracker = new DownloadTracker();
    const first = download({ tabId: 1 });
    const second = download({ tabId: 2 });
    tracker.set('one', first).set('two', second);

    expect(tracker.get('one')).toBe(first);
    expect([...tracker.values()]).toEqual([first, second]);
    expect(tracker.findForTab(2)).toEqual(['two', second]);
    expect(tracker.findForTab(3)).toBeUndefined();
  });

  it('delivers an outcome that arrives before the batch waits', async () => {
    const tracker = new DownloadTracker();
    const active = download();
    tracker.set('quick', active);

    expect(tracker.finish('quick', true)).toBe(active);
    expect(tracker.get('quick')).toBeUndefined();
    await expect(tracker.wait('quick')).resolves.toBe(true);
  });

  it('resolves every waiter already attached to an active ID', async () => {
    const tracker = new DownloadTracker();
    tracker.set('running', download());
    const first = tracker.wait('running');
    const second = tracker.wait('running');

    tracker.finish('running', false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it('ignores a duplicate callback after an ID has finished', async () => {
    const tracker = new DownloadTracker();
    tracker.set('cancelled', download());
    tracker.finish('cancelled', false);
    expect(tracker.finish('cancelled', true)).toBeUndefined();
    await expect(tracker.wait('cancelled')).resolves.toBe(false);
  });

  it('marks cancellation before an asynchronous abort finishes', () => {
    vi.useFakeTimers();
    const tracker = new DownloadTracker();
    const active = download({ type: 'convert', tabId: 1 });
    tracker.set('convert_1', active);

    expect(tracker.beginCancel('convert_1')).toBe(active);
    expect(tracker.isRunning('convert_1')).toBe(false);
    expect(tracker.cancelledType('convert_1')).toBe('convert');
    expect(tracker.findForTab(1)).toBeUndefined();
  });

  it('retains a short cancellation tombstone for a late process PID', () => {
    vi.useFakeTimers();
    const tracker = new DownloadTracker(100);
    tracker.set('ytdlp_1', download({ type: 'ytdlp' }));
    tracker.beginCancel('ytdlp_1');
    tracker.finish('ytdlp_1', false);

    expect(tracker.cancelledType('ytdlp_1')).toBe('ytdlp');
    vi.advanceTimersByTime(100);
    expect(tracker.cancelledType('ytdlp_1')).toBeUndefined();
  });

  it('clears an old cached outcome when an ID is reused', () => {
    vi.useFakeTimers();
    const tracker = new DownloadTracker(100);
    tracker.set('same', download());
    tracker.finish('same', true);
    tracker.set('same', download({ filename: 'new.mp4' }));

    vi.advanceTimersByTime(100);
    expect(tracker.get('same')?.filename).toBe('new.mp4');
  });
});
