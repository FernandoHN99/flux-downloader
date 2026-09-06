import { describe, expect, it } from 'vitest';
import { progressCallbackArgs } from './progress-callback';

describe('progressCallbackArgs', () => {
  it('preserves the legacy three arguments and appends the logical key', () => {
    const info = { percent: 42 };
    expect(progressCallbackArgs(1000, 12.5, info, 'convert_123_4')).toEqual([
      1000, 12.5, info, 'convert_123_4'
    ]);
    expect(progressCallbackArgs(1000, 0, info, undefined)).toEqual([
      1000, 0, info, null
    ]);
  });
});
