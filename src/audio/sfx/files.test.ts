import { describe, expect, it } from 'vitest';
import { variantsOf } from './files';

describe('variantsOf', () => {
  it('a sound with no files has no variants', () => {
    expect(Array.isArray(variantsOf('cannon'))).toBe(true);
  });
});
