import { describe, expect, it } from 'vitest';
import { numberPrefix } from './file-number';

describe('numberPrefix', () => {
  it('is two digits for a short course and widens with the total', () => {
    expect(numberPrefix(1, 5)).toBe('01-');
    expect(numberPrefix(99, 99)).toBe('99-');
    expect(numberPrefix(7, 100)).toBe('007-');
    expect(numberPrefix(1, 1000)).toBe('0001-');
  });

  it('is empty when nothing needs ordering', () => {
    expect(numberPrefix(1, 1)).toBe('');
  });
});
