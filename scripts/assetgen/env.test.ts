import { afterEach, describe, expect, it } from 'vitest';
import { userPath } from './env';

describe('userPath', () => {
  const saved = process.env.INIT_CWD;
  afterEach(() => {
    if (saved === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = saved;
  });

  it('resolves relative paths against the directory npm was run from', () => {
    process.env.INIT_CWD = '/home/me/art';
    expect(userPath('concept.png')).toBe('/home/me/art/concept.png');
    expect(userPath('/abs/x.png')).toBe('/abs/x.png');
  });
});
