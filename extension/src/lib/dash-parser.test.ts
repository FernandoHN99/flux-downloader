import { describe, it, expect } from 'vitest';
import { DashParserWrapper as Dash } from './dash-parser';

const URL_ = 'https://cdn.example.com/dash/lesson/manifest.mpd';

const MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT0H25M23.000S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4" segmentAlignment="true">
      <Representation id="v0" bandwidth="2800000" width="1920" height="1080" codecs="avc1.640028" frameRate="30"/>
      <Representation id="v1" bandwidth="1400000" width="1280" height="720" codecs="avc1.4d401f" frameRate="30"/>
      <Representation id="v2" bandwidth="700000" width="854" height="480" codecs="avc1.4d401e" frameRate="30"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
      <Representation id="a0" bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="text/vtt" lang="pt">
      <BaseURL>subs/pt.vtt</BaseURL>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('DashParserWrapper.parse', () => {
  it('refuses anything that is not an MPD', () => {
    expect(Dash.parse('<html>nope</html>', URL_)).toEqual({ type: 'media', variants: [] });
  });

  it('accepts a manifest identified only by its namespace', () => {
    const bare = '<Something xmlns="urn:mpeg:dash:schema:mpd:2011"></Something>';
    expect(Dash.parse(bare, URL_).type).toBe('master');
  });

  describe('a typical manifest', () => {
    const parsed = Dash.parse(MPD, URL_);

    it('returns the video renditions, best bandwidth first', () => {
      expect(parsed.variants.map((v) => v.height)).toEqual([1080, 720, 480]);
      expect(parsed.variants.map((v) => v.bandwidth)).toEqual([2800000, 1400000, 700000]);
    });

    it('reads the details off each rendition', () => {
      expect(parsed.variants[0]).toMatchObject({
        width: 1920, height: 1080, codecs: 'avc1.640028', frameRate: '30',
        mimeType: 'video/mp4', name: '1080p', encrypted: false
      });
    });

    // DASH renditions are segments of one manifest, not separate playlists,
    // so every variant points back at the manifest itself.
    it('points every rendition at the manifest', () => {
      expect(parsed.variants.every((v) => v.url === URL_)).toBe(true);
    });

    it('leaves the audio-only set out of the video list', () => {
      expect(parsed.variants).toHaveLength(3);
      expect(parsed.variants.some((v) => v.bandwidth === 128000)).toBe(false);
    });

    it('collects subtitles separately, with their language', () => {
      expect(parsed.subtitleTracks).toEqual([
        { url: 'https://cdn.example.com/dash/lesson/subs/pt.vtt', lang: 'pt', mimeType: 'text/vtt' }
      ]);
    });

    it('reads the presentation duration', () => {
      expect(parsed.duration).toBe(25 * 60 + 23);
    });
  });

  describe('attribute inheritance', () => {
    // Many packagers put width/height on the AdaptationSet and leave the
    // Representations carrying only a bitrate.
    it('lets a representation inherit from its adaptation set', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video" mimeType="video/mp4" maxWidth="1920" maxHeight="1080" codecs="avc1.640028">
          <Representation id="v0" bandwidth="2800000"/>
        </AdaptationSet></MPD>`;
      const variant = Dash.parse(manifest, URL_).variants[0];
      expect(variant).toMatchObject({ width: 1920, height: 1080, codecs: 'avc1.640028' });
    });

    it('lets the representation win over the set', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video" maxHeight="1080">
          <Representation id="v0" bandwidth="1400000" height="720"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants[0].height).toBe(720);
    });

    // Some manifests type the media only on the representation.
    it('recognises video from the representation when the set says nothing', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet segmentAlignment="true">
          <Representation id="v0" bandwidth="1400000" width="1280" height="720"/>
          <Representation id="a0" bandwidth="128000" mimeType="audio/mp4"/>
        </AdaptationSet></MPD>`;
      const variants = Dash.parse(manifest, URL_).variants;
      expect(variants).toHaveLength(1);
      expect(variants[0].height).toBe(720);
    });
  });

  describe('DRM', () => {
    it('flags a protected adaptation set', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>
          <Representation id="v0" bandwidth="2800000" width="1920" height="1080"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants[0].encrypted).toBe(true);
    });
  });

  describe('durations', () => {
    it.each([
      ['PT0H25M23.000S', 1523],
      ['PT1H2M3S', 3723],
      ['PT45S', 45],
      ['PT4M', 240],
      ['PT2H', 7200]
    ])('reads %s as %i seconds', (iso, seconds) => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="${iso}"></MPD>`;
      expect(Dash.parse(manifest, URL_).duration).toBe(seconds);
    });

    it('leaves the duration unknown when the manifest omits it', () => {
      const manifest = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"></MPD>';
      expect(Dash.parse(manifest, URL_).duration).toBeUndefined();
    });

    // Some packagers emit the full ISO-8601 form with the date part.
    it('reads the full P…T… form some packagers emit', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="P0Y0M0DT0H25M23.000S"></MPD>`;
      expect(Dash.parse(manifest, URL_).duration).toBe(1523);
    });

    it('reads a day component', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="P1DT2H"></MPD>`;
      expect(Dash.parse(manifest, URL_).duration).toBe(86400 + 7200);
    });

    // A month has no fixed length, so converting one would be a guess. No
    // real media duration uses them, and a wrong number is worse than none.
    it('refuses a duration in years or months rather than guessing', () => {
      for (const iso of ['P1Y', 'P2M', 'P1Y0M0DT1H']) {
        const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="${iso}"></MPD>`;
        expect(Dash.parse(manifest, URL_).duration).toBeUndefined();
      }
    });

    it.each(['', 'P', 'PT', '25M23S', 'PT25X', 'garbage'])(
      'refuses %s rather than returning a bogus number', (iso) => {
        const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="${iso}"></MPD>`;
        expect(Dash.parse(manifest, URL_).duration).toBeUndefined();
      });
  });

  describe('deduplication and ordering', () => {
    it('drops renditions matching on both height and bandwidth', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <Representation id="a" bandwidth="1400000" width="1280" height="720"/>
          <Representation id="b" bandwidth="1400000" width="1280" height="720"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants).toHaveLength(1);
    });

    it('keeps two bitrates of the same resolution', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <Representation id="a" bandwidth="1400000" width="1280" height="720"/>
          <Representation id="b" bandwidth="900000" width="1280" height="720"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants).toHaveLength(2);
    });

    it('merges renditions across several adaptation sets into one order', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <Representation id="a" bandwidth="700000" width="854" height="480"/>
        </AdaptationSet>
        <AdaptationSet contentType="video">
          <Representation id="b" bandwidth="2800000" width="1920" height="1080"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants.map((v) => v.height)).toEqual([1080, 480]);
    });
  });

  describe('malformed input', () => {
    it('skips a rendition with no usable bitrate', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <Representation id="a" width="1280" height="720"/>
          <Representation id="b" bandwidth="0" width="854" height="480"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants).toEqual([]);
    });

    it('survives a self-closing adaptation set', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video" mimeType="video/mp4"/>
        <AdaptationSet contentType="video">
          <Representation id="a" bandwidth="1400000" width="1280" height="720"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).variants).toHaveLength(1);
    });

    it('survives an adaptation set that is never closed', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <Representation id="a" bandwidth="1400000" width="1280" height="720"/>`;
      expect(Dash.parse(manifest, URL_).variants).toHaveLength(1);
    });

    it('reports nothing rather than throwing on an empty manifest body', () => {
      const manifest = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"></MPD>';
      const parsed = Dash.parse(manifest, URL_);
      expect(parsed.variants).toEqual([]);
      expect(parsed.subtitleTracks).toBeUndefined();
      expect(parsed.childUrls).toBeUndefined();
    });
  });

  describe('child urls', () => {
    it('collects BaseURL entries, resolved against the manifest', () => {
      const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
        <AdaptationSet contentType="video">
          <BaseURL>video/1080/</BaseURL>
          <Representation id="a" bandwidth="2800000" width="1920" height="1080"/>
        </AdaptationSet></MPD>`;
      expect(Dash.parse(manifest, URL_).childUrls)
        .toEqual(['https://cdn.example.com/dash/lesson/video/1080/']);
    });
  });
});

describe('DashParserWrapper.getQualityName', () => {
  it.each([[2160, '4K'], [1080, '1080p'], [480, '480p']])(
    'names %ip as %s', (h, n) => expect(Dash.getQualityName(h)).toBe(n));
  it('says Unknown without a height', () => expect(Dash.getQualityName(0)).toBe('Unknown'));
});
