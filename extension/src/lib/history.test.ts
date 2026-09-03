import { describe, expect, it } from 'vitest';
import type { HistoryEntry, VideoInfo } from './types';
import { mergeDetectedVideosIntoHistory, sameHistoryContent } from './history';
import { domainOf } from './video-key';

const lessonUrl = 'https://app.rocketseat.com.br/jornada/react-2025/aula/testando-com-babel-repl';
const mediaUrl = 'https://vz-dc851587-83d.b-cdn.net/course/playlist.m3u8?token=new';

function video(patch: Partial<VideoInfo> = {}): VideoInfo {
  return {
    id: 'video-1',
    title: 'Testando com Babel REPL',
    url: mediaUrl,
    type: 'hls',
    qualities: [],
    ...patch
  };
}

function entry(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return { ...video(), detectedAt: 1, ...patch };
}

describe('mergeDetectedVideosIntoHistory', () => {
  it('uses the page that detected a video instead of its CDN host', () => {
    const [merged] = mergeDetectedVideosIntoHistory(
      [],
      [video({ pageUrl: lessonUrl })],
      {},
      10,
      50
    );

    expect(merged.pageUrl).toBe(lessonUrl);
    expect(domainOf(merged.pageUrl, merged.url)).toBe('app.rocketseat.com.br');
  });

  it('lets authoritative tab metadata repair an older wrong source', () => {
    const old = entry({ pageUrl: 'https://vz-dc851587-83d.b-cdn.net/' });
    const [merged] = mergeDetectedVideosIntoHistory(
      [old],
      [video()],
      { pageUrl: lessonUrl, pageTitle: 'Estruturação | React | Rocketseat' },
      10,
      50
    );

    expect(merged.pageUrl).toBe(lessonUrl);
    expect(merged.pageTitle).toBe('Estruturação | React | Rocketseat');
  });

  it('restores a current video after it was deleted from history', () => {
    const restored = mergeDetectedVideosIntoHistory([], [video()], { pageUrl: lessonUrl }, 10, 50);

    expect(restored).toHaveLength(1);
    expect(restored[0].url).toBe(mediaUrl);
  });

  it('does not persist content-script generation bookkeeping', () => {
    const detected = { ...video(), generation: 7 };
    const [merged] = mergeDetectedVideosIntoHistory([], [detected], {}, 10, 50);

    expect(merged).not.toHaveProperty('generation');
  });

  it('keeps older videos in their existing order and obeys the limit', () => {
    const older = entry({ id: 'old', url: 'https://cdn.example.com/old.mp4' });
    const oldest = entry({ id: 'oldest', url: 'https://cdn.example.com/oldest.mp4' });
    const merged = mergeDetectedVideosIntoHistory([older, oldest], [video()], {}, 10, 2);

    expect(merged.map((item) => item.id)).toEqual(['video-1', 'old']);
  });
});

describe('sameHistoryContent', () => {
  it('ignores only a refreshed detection timestamp', () => {
    expect(sameHistoryContent([entry({ detectedAt: 1 })], [entry({ detectedAt: 99 })])).toBe(true);
  });

  it('notices when the source page is learned later', () => {
    expect(sameHistoryContent(
      [entry({ pageUrl: undefined })],
      [entry({ pageUrl: lessonUrl })]
    )).toBe(false);
  });
});
