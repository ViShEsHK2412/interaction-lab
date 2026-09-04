import { describe, expect, it } from 'vitest';
import { addSwatch, MAX_SWATCHES, normaliseHex } from './canvas-colour';

describe('normaliseHex', () => {
  it('takes what people actually type', () => {
    expect(normaliseHex('fff')).toBe('#ffffff');
    expect(normaliseHex('#FFF')).toBe('#ffffff');
    expect(normaliseHex('  #F1F1F1  ')).toBe('#f1f1f1');
  });

  it('refuses anything that is not a hex colour', () => {
    expect(normaliseHex('rebeccapurple')).toBeNull();
    expect(normaliseHex('#ff')).toBeNull();
    expect(normaliseHex('#fffff')).toBeNull();
    expect(normaliseHex('')).toBeNull();
    expect(normaliseHex('#gggggg')).toBeNull();
  });
});

describe('addSwatch', () => {
  it('puts the newest first', () => {
    expect(addSwatch(['#000000'], '#ffffff')).toEqual(['#ffffff', '#000000']);
  });

  it('moves a colour you already have up rather than repeating it', () => {
    expect(addSwatch(['#000000', '#ffffff'], '#ffffff')).toEqual(['#ffffff', '#000000']);
  });

  it('dedupes across notations, since they are the same colour', () => {
    expect(addSwatch(['#ffffff'], 'FFF')).toEqual(['#ffffff']);
  });

  it('drops the oldest at the cap', () => {
    const full = Array.from({ length: MAX_SWATCHES }, (_, i) => `#${String(i).repeat(6)}`);
    const out = addSwatch(full, '#abcdef');
    expect(out).toHaveLength(MAX_SWATCHES);
    expect(out[0]).toBe('#abcdef');
    expect(out).not.toContain(full[MAX_SWATCHES - 1]);
  });

  it('leaves the row alone when handed nonsense', () => {
    expect(addSwatch(['#000000'], 'not a colour')).toEqual(['#000000']);
  });
});
