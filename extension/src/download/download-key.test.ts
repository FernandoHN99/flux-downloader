import { describe, expect, it } from 'vitest';
import { ProcessDownloadKeyFactory } from './download-key';

describe('ProcessDownloadKeyFactory', () => {
  it('keeps simultaneous process starts unique and route-prefixed', () => {
    const keys = new ProcessDownloadKeyFactory(() => 1234);
    expect([
      keys.next('convert'),
      keys.next('convert'),
      keys.next('ytdlp')
    ]).toEqual([
      'convert_1234_1',
      'convert_1234_2',
      'ytdlp_1234_3'
    ]);
  });
});
