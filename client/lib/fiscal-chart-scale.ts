/** Keep SVG work bounded even for very large supply scenarios. Units are yen. */
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
