import { describe, it, expect } from 'vitest';
import { M3U8ParserWrapper as M3U8 } from './m3u8-parser';

const BASE = 'https://cdn.example.com/videos/lesson9/master.m3u8';

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Portugues",LANGUAGE="pt",DEFAULT=NO,AUTOSELECT=YES,URI="audio/pt.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aac"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aac"
480p/index.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:9.009,
seg0.ts
#EXTINF:9.009,
seg1.ts
#EXTINF:3.500,
seg2.ts
#EXT-X-ENDLIST
`;

describe('M3U8ParserWrapper.parse', () => {
  it('refuses anything that is not a playlist', () => {
    const parsed = M3U8.parse('<html>404</html>', BASE);
    expect(parsed).toEqual({ type: 'media', variants: [], segments: [], duration: undefined });
  });

  describe('a master playlist', () => {
    const parsed = M3U8.parse(MASTER, BASE);

    it('is recognised as a master', () => {
      expect(parsed.type).toBe('master');
    });

    it('returns its variants sorted by bandwidth, best first', () => {
      expect(parsed.variants.map((v) => v.height)).toEqual([1080, 720, 480]);
      expect(parsed.variants.map((v) => v.bandwidth)).toEqual([2800000, 1400000, 700000]);
    });

    it('reads resolution, codecs and the audio group off each variant', () => {
      const best = parsed.variants[0];
      expect(best.width).toBe(1920);
      expect(best.height).toBe(1080);
      expect(best.codecs).toBe('avc1.640028,mp4a.40.2');
      expect(best.audioGroupId).toBe('aac');
      expect(best.name).toBe('1080p');
    });

    it('resolves each variant against the manifest it came from', () => {
      expect(parsed.variants[0].url).toBe('https://cdn.example.com/videos/lesson9/1080p/index.m3u8');
    });

    it('keeps the alternate audio renditions with their languages', () => {
      expect(parsed.mediaRenditions).toHaveLength(2);
      const [en, pt] = parsed.mediaRenditions!;
      expect(en).toMatchObject({ type: 'AUDIO', groupId: 'aac', language: 'en', default: true });
      expect(pt).toMatchObject({ language: 'pt', default: false, autoselect: true });
      expect(en.uri).toBe('https://cdn.example.com/videos/lesson9/audio/en.m3u8');
    });

    it('lists every child playlist once', () => {
      expect(parsed.childUrls).toHaveLength(5);   // 3 variants + 2 audio
      expect(new Set(parsed.childUrls).size).toBe(5);
    });

    it('has no segments of its own', () => {
      expect(parsed.segments).toBeUndefined();
      expect(parsed.duration).toBeUndefined();
    });
  });

  describe('a media playlist', () => {
    const parsed = M3U8.parse(MEDIA, 'https://cdn.example.com/videos/lesson9/720p/index.m3u8');

    it('is recognised as media, not master', () => {
      expect(parsed.type).toBe('media');
      expect(parsed.variants).toEqual([]);
    });

    it('resolves its segments', () => {
      expect(parsed.segments).toEqual([
        'https://cdn.example.com/videos/lesson9/720p/seg0.ts',
        'https://cdn.example.com/videos/lesson9/720p/seg1.ts',
        'https://cdn.example.com/videos/lesson9/720p/seg2.ts'
      ]);
    });

    it('adds up the segment durations', () => {
      expect(parsed.duration).toBeCloseTo(21.518, 3);
    });

    // Some encoders write EXTINF without a duration; the target duration is
    // the only estimate left.
    it('falls back to target duration × segments when EXTINF carries no number', () => {
      const noDurations = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:,
a.ts
#EXTINF:,
b.ts
`;
      const out = M3U8.parse(noDurations, BASE);
      expect(out.segments).toHaveLength(2);
      expect(out.duration).toBe(12);
    });
  });

  describe('absolute and relative URLs', () => {
    it('leaves an absolute variant URL alone', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
https://other-cdn.net/hls/720.m3u8
`;
      expect(M3U8.parse(manifest, BASE).variants[0].url).toBe('https://other-cdn.net/hls/720.m3u8');
    });

    it('resolves a root-relative path against the origin', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000
/hls/720.m3u8
`;
      expect(M3U8.parse(manifest, BASE).variants[0].url).toBe('https://cdn.example.com/hls/720.m3u8');
    });
  });

  describe('deduplication', () => {
    it('drops variants that are identical in every respect', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,CODECS="avc1.4d401f"
a/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,CODECS="avc1.4d401f"
b/index.m3u8
`;
      expect(M3U8.parse(manifest, BASE).variants).toHaveLength(1);
    });

    // Same picture, different audio: these are real choices, not duplicates.
    it('keeps same-resolution variants whose audio groups differ', () => {
      const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Stereo",LANGUAGE="en"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="surround",NAME="5.1",LANGUAGE="en"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="stereo"
a/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="surround"
b/index.m3u8
`;
      expect(M3U8.parse(manifest, BASE).variants).toHaveLength(2);
    });

    it('treats audio groups holding the same renditions as one', () => {
      const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g1",NAME="English",LANGUAGE="en",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="g2",NAME="English",LANGUAGE="en",DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="g1"
a/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="g2"
b/index.m3u8
`;
      expect(M3U8.parse(manifest, BASE).variants).toHaveLength(1);
    });
  });

  describe('malformed input', () => {
    it('ignores a stream line with no playlist after it', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
`;
      expect(M3U8.parse(manifest, BASE).variants).toEqual([]);
    });

    it('ignores a stream line followed by another tag', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1400000
#EXT-X-ENDLIST
`;
      expect(M3U8.parse(manifest, BASE).variants).toEqual([]);
    });

    it('survives a variant with no attributes at all', () => {
      const manifest = `#EXTM3U
#EXT-X-STREAM-INF:
720/index.m3u8
`;
      const variant = M3U8.parse(manifest, BASE).variants[0];
      expect(variant.bandwidth).toBe(0);
      expect(variant.height).toBeUndefined();
      expect(variant.name).toBe('Unknown');
    });

    // Production always parses through fetchAndParse, which passes the
    // response URL — but calling parse() bare silently yields nothing, which
    // is worth knowing before someone does it.
    it('yields no variants at all without a base url to resolve against', () => {
      expect(M3U8.parse(MASTER).variants).toEqual([]);
      expect(M3U8.parse(MEDIA).segments).toBeUndefined();
    });

    it('tolerates windows line endings', () => {
      const parsed = M3U8.parse(MASTER.replace(/\n/g, '\r\n'), BASE);
      expect(parsed.variants).toHaveLength(3);
      expect(parsed.variants[0].url).toBe('https://cdn.example.com/videos/lesson9/1080p/index.m3u8');
    });
  });
});

describe('M3U8ParserWrapper.resolveUrl', () => {
  it('resolves against the base', () => {
    expect(M3U8.resolveUrl('720/i.m3u8', BASE))
      .toBe('https://cdn.example.com/videos/lesson9/720/i.m3u8');
  });

  it('hands back the original when the base is unusable', () => {
    expect(M3U8.resolveUrl('720/i.m3u8', 'not a url')).toBe('720/i.m3u8');
  });
});

describe('M3U8ParserWrapper.getQualityName', () => {
  it.each([[2160, '4K'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']])(
    'names %ip as %s', (h, name) => expect(M3U8.getQualityName(h)).toBe(name));

  it('passes an odd height through', () => expect(M3U8.getQualityName(240)).toBe('240p'));
  it('says Unknown without a height', () => expect(M3U8.getQualityName(undefined)).toBe('Unknown'));
});

describe('M3U8ParserWrapper.selectQuality', () => {
  const variants = M3U8.parse(MASTER, BASE).variants;

  it('takes the top variant for best', () => {
    expect(M3U8.selectQuality(variants, 'best')!.height).toBe(1080);
  });

  it('takes the bottom one for worst', () => {
    expect(M3U8.selectQuality(variants, 'worst')!.height).toBe(480);
  });

  it('takes the best that fits inside a bandwidth cap', () => {
    expect(M3U8.selectQuality(variants, 1500000)!.height).toBe(720);
  });

  it('falls back to the best when nothing fits the cap', () => {
    expect(M3U8.selectQuality(variants, 100)!.height).toBe(1080);
  });

  it('returns nothing when there is nothing to choose from', () => {
    expect(M3U8.selectQuality([], 'best')).toBeNull();
  });
});
