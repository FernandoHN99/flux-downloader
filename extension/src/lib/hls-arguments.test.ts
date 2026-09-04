import { describe, expect, it, vi } from 'vitest';
import { prepareHlsInputArguments } from './hls-arguments';

describe('prepareHlsInputArguments', () => {
  it('leaves arguments and their input array unchanged when no rewrite is needed', async () => {
    const args = ['-referer', 'https://app.example/', '-i', 'https://cdn.example/video.m3u8', '-c', 'copy'];
    const original = [...args];
    const rewrite = vi.fn(async () => null);

    await expect(prepareHlsInputArguments(args, rewrite)).resolves.toEqual({
      args,
      manifestFiles: []
    });
    expect(args).toEqual(original);
    expect(rewrite).toHaveBeenCalledWith('https://cdn.example/video.m3u8', 0);
  });

  it('rewrites every HTTP input, including separate video and audio playlists', async () => {
    const rewrite = vi.fn(async (url: string, index: number) => ({
      placeholder: `__MANIFEST_${index}__`,
      content: `rewritten:${url}`
    }));
    const result = await prepareHlsInputArguments([
      '-i', 'https://cdn.example/video.m3u8',
      '-i', 'https://cdn.example/audio.m3u8',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy'
    ], rewrite);

    expect(rewrite.mock.calls).toEqual([
      ['https://cdn.example/video.m3u8', 0],
      ['https://cdn.example/audio.m3u8', 1]
    ]);
    expect(result.manifestFiles).toEqual([
      { placeholder: '__MANIFEST_0__', content: 'rewritten:https://cdn.example/video.m3u8' },
      { placeholder: '__MANIFEST_1__', content: 'rewritten:https://cdn.example/audio.m3u8' }
    ]);
    expect(result.args).toEqual([
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data', '-extension_picky', '0',
      '-i', '__MANIFEST_0__',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data', '-extension_picky', '0',
      '-i', '__MANIFEST_1__',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy'
    ]);
  });

  it('does not offer local, data, or placeholder inputs to the network rewriter', async () => {
    const rewrite = vi.fn(async () => null);
    const args = [
      '-i', '/tmp/local.m3u8',
      '-i', 'data:application/vnd.apple.mpegurl;base64,AAAA',
      '-i', '__ALREADY_REWRITTEN__'
    ];

    expect(await prepareHlsInputArguments(args, rewrite)).toEqual({
      args,
      manifestFiles: []
    });
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('keeps mixed rewritten and ordinary HTTP inputs in their original order', async () => {
    const result = await prepareHlsInputArguments([
      '-headers', 'X: 1',
      '-i', 'https://cdn.example/plain.m3u8',
      '-i', 'https://opaque.example/relay.m3u8',
      '-y', '/downloads/video.mp4'
    ], async (url, index) => url.includes('opaque')
      ? { placeholder: `__MANIFEST_${index}__`, content: '#EXTM3U' }
      : null);

    expect(result.args).toEqual([
      '-headers', 'X: 1',
      '-i', 'https://cdn.example/plain.m3u8',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data', '-extension_picky', '0',
      '-i', '__MANIFEST_0__',
      '-y', '/downloads/video.mp4'
    ]);
  });

  it('propagates rewrite failures without returning a partial argument list', async () => {
    await expect(prepareHlsInputArguments(
      ['-i', 'https://cdn.example/video.m3u8'],
      async () => { throw new Error('incomplete relay map'); }
    )).rejects.toThrow('incomplete relay map');
  });
});
