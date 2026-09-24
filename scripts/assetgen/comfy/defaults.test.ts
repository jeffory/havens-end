import { describe, expect, it } from 'vitest';
import { fillWidgetDefaults, type NodeInfo } from './defaults';

const birefnet: NodeInfo = {
  input: {
    required: { image: ['IMAGE'], model: [['BiRefNet-general', 'BiRefNet_lite']] },
    optional: {
      mask_blur: ['INT', { default: 0, min: 0, max: 64 }],
      background: [['Alpha', 'Color'], { default: 'Alpha' }],
      refine_foreground: ['BOOLEAN', { default: false }],
      background_color: ['COLORCODE', { default: '#222222' }],
      sampler: ['COMBO', { options: ['euler', 'dpmpp'] }],
      extra: ['IMAGE'],
    },
  },
};

describe('fillWidgetDefaults', () => {
  it('adds omitted widget inputs with their declared defaults, as the ComfyUI page does', () => {
    const graph = { '1': { class_type: 'BiRefNetRMBG', inputs: { image: ['0', 0], model: 'BiRefNet-general' } } };

    const filled = fillWidgetDefaults(graph, { BiRefNetRMBG: birefnet });

    expect(filled['1'].inputs).toEqual({
      image: ['0', 0],
      model: 'BiRefNet-general',
      mask_blur: 0,
      background: 'Alpha',
      refine_foreground: false,
      background_color: '#222222',
      sampler: 'euler', // a combo without a default takes its first option
    });
  });

  it('never overrides given values or invents links for optional connections', () => {
    const graph = { '1': { class_type: 'BiRefNetRMBG', inputs: { image: ['0', 0], model: 'BiRefNet_lite', mask_blur: 8 } } };

    const filled = fillWidgetDefaults(graph, { BiRefNetRMBG: birefnet });

    expect(filled['1'].inputs.mask_blur).toBe(8);
    expect(filled['1'].inputs.model).toBe('BiRefNet_lite');
    expect('extra' in filled['1'].inputs).toBe(false);
  });

  it('leaves nodes it has no schema for untouched', () => {
    const graph = { '1': { class_type: 'Mystery', inputs: { a: 1 } } };
    expect(fillWidgetDefaults(graph, {})).toEqual(graph);
  });
});
