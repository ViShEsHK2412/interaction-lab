import { describe, expect, it } from 'vitest';
import { copyName } from './lab-fs';

describe('copyName', () => {
  it('appends -copy when nothing is in the way', () => {
    expect(copyName('feed', ['feed'])).toBe('feed-copy');
  });

  it('numbers the next one rather than clobbering the first', () => {
    expect(copyName('feed', ['feed', 'feed-copy'])).toBe('feed-copy-2');
    expect(copyName('feed', ['feed', 'feed-copy', 'feed-copy-2'])).toBe('feed-copy-3');
  });

  it('copies a copy without compounding the suffix forever', () => {
    expect(copyName('feed-copy', ['feed-copy'])).toBe('feed-copy-copy');
  });
});
