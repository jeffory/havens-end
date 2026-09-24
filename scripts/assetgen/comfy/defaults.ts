import type { ApiGraph } from './graph';

type InputSpec = [unknown, Record<string, unknown>?] | [unknown];

/** A node's schema as GET /object_info/<class> returns it (only the parts used here). */
export interface NodeInfo {
  input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
}

/**
 * Fills in omitted optional widget inputs (numbers, strings, toggles, combos) with the
 * node's declared defaults. The ComfyUI page always sends every widget value, and some
 * custom nodes fail without them (BiRefNet raises KeyError 'mask_blur'; Deep Bump
 * treats a missing auto_download as off). Optional connections such as an IMAGE input
 * are never invented, and values already set are kept.
 */
export function fillWidgetDefaults(graph: ApiGraph, info: Record<string, NodeInfo>): ApiGraph {
  const out: ApiGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    const inputs = { ...node.inputs };
    for (const [name, spec] of Object.entries(info[node.class_type]?.input.optional ?? {})) {
      if (name in inputs) continue;
      const value = widgetDefault(spec);
      if (value !== undefined) inputs[name] = value;
    }
    out[id] = { class_type: node.class_type, inputs };
  }
  return out;
}

function widgetDefault([type, options = {}]: InputSpec): unknown {
  if (options.forceInput) return undefined; // a widget turned into a socket
  if ('default' in options) return options.default;
  if (Array.isArray(type)) return type[0]; // legacy combo: the list of choices
  if (type === 'COMBO' && Array.isArray(options.options)) return options.options[0];
  return undefined;
}
