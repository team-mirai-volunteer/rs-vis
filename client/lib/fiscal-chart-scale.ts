/** Zero-anchored scale for policy-minus-baseline differences. Units are yen. */
export function differenceChartScale(values: number[]) {
  const magnitude = Math.max(1e12, ...values.map(Math.abs));
  const rawStep = magnitude / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map(m => m * power).find(s => s >= rawStep) ?? 10 * power;
  const low = Math.min(0, Math.floor(Math.min(...values) / step) * step);
  const high = Math.max(step, Math.ceil(Math.max(...values) / step) * step);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + i * step);
  return { low, high, ticks };
}

/** Keep SVG work bounded even for very large supply scenarios. Units are yen.
 * The floor is NOT zero: any chart using this scale must say so. */
export function fiscalChartScale(values: number[]) {
  const minimumStep = 50e12;
  const lowValue = Math.min(...values), highValue = Math.max(...values);
  const desiredStep = Math.max(minimumStep, (highValue - lowValue) / 6);
  const step = minimumStep * 10 ** Math.ceil(Math.log10(desiredStep / minimumStep));
  const low = Math.floor(lowValue / step) * step;
  const high = Math.max(low + step, Math.ceil(highValue / step) * step);
  const ticks = Array.from({ length: Math.min(9, Math.round((high - low) / step) + 1) }, (_, i) => low + i * step);
  return { low, high, ticks };
}
