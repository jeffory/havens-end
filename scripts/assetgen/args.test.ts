import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('parses gen with name="prompt" items, common options and typed recipe flags', () => {
    const cmd = parseArgs(['gen', 'block', 'sand=pale beach sand', 'dirt=brown dirt', '--size', '32', '--tile=x', '--variants', '2', '--seed', '9']);

    expect(cmd).toEqual({
      command: 'gen',
      recipe: 'block',
      items: [
        { name: 'sand', prompt: 'pale beach sand' },
        { name: 'dirt', prompt: 'brown dirt' },
      ],
      model: 'nano-banana-pro',
      variants: 2,
      seed: 9,
      flags: { size: 32, colors: 12, tile: 'x', repair: 'auto', downscale: 'detail' },
      yes: false,
    });
  });

  it('reads boolean flags as --flag / --no-flag', () => {
    const cmd = parseArgs(['gen', 'material', 'deck=oak planks', '--no-maps']);
    expect(cmd.command === 'gen' && cmd.flags.maps).toBe(false);
  });

  it('lets --model override the recipe default', () => {
    const cmd = parseArgs(['gen', 'sprite', 'captain=a captain', '--model', 'klein']);
    expect(cmd.command === 'gen' && cmd.model).toBe('klein');
  });

  it('rejects unknown recipes, flags, models and malformed items with a helpful message', () => {
    expect(() => parseArgs(['gen', 'hat', 'a=b'])).toThrow(/recipes: block, pattern/);
    expect(() => parseArgs(['gen', 'block', 'a=b', '--sise', '16'])).toThrow(/--sise.*--size/);
    expect(() => parseArgs(['gen', 'block', 'a=b', '--model', 'dalle'])).toThrow(/nano-banana-pro/);
    expect(() => parseArgs(['gen', 'block', 'no prompt'])).toThrow(/name="prompt"/);
    expect(() => parseArgs(['gen', 'block'])).toThrow(/at least one/);
  });

  it('rejects values outside a flag’s choices before anything is spent', () => {
    expect(() => parseArgs(['gen', 'block', 'a=b', '--downscale', 'detial'])).toThrow(/--downscale.*detial.*did you mean detail/);
    expect(() => parseArgs(['gen', 'block', 'a=b', '--repair', 'sometimes'])).toThrow(/auto, always, never/);
    expect(() => parseArgs(['gen', 'block', 'a=b', '--tile', 'y'])).toThrow(/xy, x/);
  });

  it('checks number flags against their bounds, allowing --turns 0', () => {
    const cmd = parseArgs(['gen', 'vox', 'chest=a chest', '--turns', '0']);
    expect(cmd.command === 'gen' && cmd.flags.turns).toBe(0);
    expect(() => parseArgs(['gen', 'vox', 'chest=a chest', '--turns', '4'])).toThrow(/--turns.*0 to 3/);
    expect(() => parseArgs(['gen', 'block', 'a=b', '--size', '0'])).toThrow(/--size/);
  });

  it('rejects the same item name twice', () => {
    expect(() => parseArgs(['gen', 'block', 'sand=a', 'sand=b'])).toThrow(/sand.*twice/);
  });

  it('accepts true/false after a boolean flag', () => {
    const cmd = parseArgs(['gen', 'material', 'deck=oak', '--maps', 'false']);
    expect(cmd.command === 'gen' && cmd.flags.maps).toBe(false);
  });

  it('takes --yes to skip the spending confirmation', () => {
    const cmd = parseArgs(['gen', 'block', 'a=b', '--yes']);
    expect(cmd.command === 'gen' && cmd.yes).toBe(true);
  });

  it('parses pick, build, list and doctor', () => {
    expect(parseArgs(['pick', 'sand', '3'])).toEqual({ command: 'pick', name: 'sand', variant: 3 });
    expect(parseArgs(['pick', 'sand'])).toEqual({ command: 'pick', name: 'sand', variant: 1 });
    expect(parseArgs(['build', 'sand', 'dirt'])).toEqual({ command: 'build', names: ['sand', 'dirt'], all: false, yes: false });
    expect(parseArgs(['build', '--all', '--yes'])).toEqual({ command: 'build', names: [], all: true, yes: true });
    expect(() => parseArgs(['build'])).toThrow(/names.*--all/);
    expect(parseArgs(['list'])).toEqual({ command: 'list' });
    expect(parseArgs(['doctor'])).toEqual({ command: 'doctor' });
    expect(parseArgs([])).toEqual({ command: 'help' });
  });
});
