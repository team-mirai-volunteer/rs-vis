type Point = { x: number; y: number };
export type SelectionAnchor = Point & { id: string };

/** Keep a selection in the unobscured canvas, so its position is visible alongside surrounding nodes. */
export function selectionPan({ pan, zoom, current, width, height, panelWidth }: {
  pan: Point; zoom: number; current: SelectionAnchor;
  width: number; height: number; panelWidth: number;
}): Point {
  const left = Math.min(panelWidth + 24, width - 48);
  const right = Math.max(left, width - Math.min(200, (width - left) / 3));
  const top = Math.min(100, height / 4);
  const bottom = Math.max(top, width < 640 ? height * 0.42 : height - 80);
  const keep = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const x = keep(current.x * zoom + pan.x, left, right);
  const y = keep(current.y * zoom + pan.y, top, bottom);
  const next = { x: x - current.x * zoom, y: y - current.y * zoom };
  return next.x === pan.x && next.y === pan.y ? pan : next;
}
