import { describe, expect, it, vi } from 'vitest';
import { rewriteHlsManifestUris } from './hls-rewrite';

const MANIFEST_URL = 'https://cdn.example/course/720/index.m3u8';

describe('rewriteHlsManifestUris', () => {
  it('rewrites relative, root-relative, and absolute segment URLs', () => {
    const manifest = `#EXTM3U
segment-1.ts
/shared/segment-2.ts
https://media.example/segment-3.ts`;
    const resolver = vi.fn((url: string) => `https://relay.example/?source=${encodeURIComponent(url)}`);

    const result = rewriteHlsManifestUris(manifest, MANIFEST_URL, resolver);

    expect(resolver.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.example/course/720/segment-1.ts',
      'https://cdn.example/shared/segment-2.ts',
      'https://media.example/segment-3.ts'
    ]);
    expect(result.rewrittenCount).toBe(3);
    expect(result.unresolvedUrls).toEqual([]);
    expect(result.content).toContain(encodeURIComponent('https://cdn.example/course/720/segment-1.ts'));
  });

  it('rewrites URI attributes used by encryption keys and init maps', () => {
    const manifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"
#EXT-X-MAP:URI="init.mp4",BYTERANGE="1000@0"
segment.m4s`;
    const relay = new Map([
      ['https://cdn.example/course/keys/key.bin', 'https://relay.example/key'],
      ['https://cdn.example/course/720/init.mp4', 'https://relay.example/init'],
      ['https://cdn.example/course/720/segment.m4s', 'https://relay.example/segment']
    ]);

    const result = rewriteHlsManifestUris(manifest, MANIFEST_URL, (url) => relay.get(url));

    expect(result.content).toBe(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://relay.example/key"
#EXT-X-MAP:URI="https://relay.example/init",BYTERANGE="1000@0"
https://relay.example/segment`);
    expect(result.rewrittenCount).toBe(3);
    expect(result.unresolvedUrls).toEqual([]);
  });

  it('preserves surrounding whitespace and normalizes CRLF like the existing pipeline', () => {
    const result = rewriteHlsManifestUris(
      '#EXTM3U\r\n  segment.ts  \r\n',
      MANIFEST_URL,
      () => 'https://relay.example/segment'
    );

    expect(result.content).toBe('#EXTM3U\n  https://relay.example/segment  \n');
  });

  it('reports each unresolved absolute URL once and leaves its source text intact', () => {
    const manifest = `#EXTM3U
missing.ts
missing.ts
#EXT-X-KEY:METHOD=AES-128,URI="missing.key"`;
    const result = rewriteHlsManifestUris(manifest, MANIFEST_URL, () => undefined);

    expect(result.content).toBe(manifest);
    expect(result.rewrittenCount).toBe(0);
    expect(result.unresolvedUrls).toEqual([
      'https://cdn.example/course/720/missing.ts',
      'https://cdn.example/course/720/missing.key'
    ]);
  });

  it('does not treat ordinary comments as media URLs', () => {
    const resolver = vi.fn();
    const result = rewriteHlsManifestUris(
      '#EXTM3U\n#EXTINF:6,\n# a comment',
      MANIFEST_URL,
      resolver
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: '#EXTM3U\n#EXTINF:6,\n# a comment',
      rewrittenCount: 0,
      unresolvedUrls: []
    });
  });
});
