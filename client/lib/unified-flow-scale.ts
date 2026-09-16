/** Displayed 1× corresponds to the former layout scale 0.5. Keep URL th in layout units. */
export const FLOW_SCALE_BASE = .5;
export const FLOW_SCALE_DEFAULT = 1;
export const FLOW_SCALE_MIN = .1;
export const FLOW_SCALE_MAX = 16;

export function parseFlowScale(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? Math.min(FLOW_SCALE_MAX, Math.max(FLOW_SCALE_MIN, Math.round(value / FLOW_SCALE_BASE * 10) / 10))
    : FLOW_SCALE_DEFAULT;
}
