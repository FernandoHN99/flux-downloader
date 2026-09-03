import { describe, it, expect } from 'vitest';
import { titleFromMediaUrl } from './media-title';

describe('titleFromMediaUrl', () => {
  it('names a video after its file', () => {
    expect(titleFromMediaUrl('https://cdn.x/aula-08-hooks.mp4')).toBe('aula-08-hooks');
  });

  it('reads underscores as spaces', () => {
    expect(titleFromMediaUrl('https://cdn.x/Deep_House_Mix_2026.mp4')).toBe('Deep House Mix 2026');
  });

  it('decodes percent-encoded names', () => {
    expect(titleFromMediaUrl('https://cdn.x/Estrutura%C3%A7%C3%A3o%20React.mp4'))
      .toBe('Estruturação React');
  });

  it('keeps a real name even on a manifest', () => {
    expect(titleFromMediaUrl('https://cdn.x/ep12-componentizacao.m3u8')).toBe('ep12-componentizacao');
  });

  // Everything below must fall back to the page title, or every video on a
  // site ends up with the same name.
  it.each([
    ['https://cdn.x/l9/playlist.m3u8', 'a generic manifest name'],
    ['https://cdn.x/videos/master.m3u8', 'another generic one'],
    ['https://cdn.x/video_1080p.mp4', 'generic plus a resolution'],
    ['https://cdn.x/a3f9b2c1d4e5f6a7b8.mp4', 'a hex id'],
    ['https://cdn.x/f47ac10b-58cc-4372-a567-0e02b2c3d479.mp4', 'a uuid'],
    ['https://cdn.x/20250903.mp4', 'a bare number'],
    ['https://youtube.com/watch?v=abc', 'a watch page with no file'],
    ['https://cdn.x/', 'no path segment at all']
  ])('rejects %s (%s)', (url) => {
    expect(titleFromMediaUrl(url)).toBeNull();
  });
});
