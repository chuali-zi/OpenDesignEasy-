import type { WebBounds } from './web-selection.ts';
export type SnapGuide = { axis: 'x' | 'y'; coordinate: number };
export type SnapTarget = Pick<WebBounds, 'x' | 'y' | 'width' | 'height'>;

/** Snap the selection envelope as one body; preserve every member's offsets. */
export function snapWebMove(moving: SnapTarget[], targets: SnapTarget[], dx: number, dy: number, tolerance = 6) {
  if (!moving.length || ![dx, dy, tolerance, ...[...moving, ...targets].flatMap(box => [box.x, box.y, box.width, box.height])].every(Number.isFinite) || tolerance < 0) throw new Error('吸附需要可靠的边界。');
  const x = Math.min(...moving.map(box => box.x)), y = Math.min(...moving.map(box => box.y));
  const width = Math.max(...moving.map(box => box.x + box.width)) - x, height = Math.max(...moving.map(box => box.y + box.height)) - y;
  const guides: SnapGuide[] = [];
  const adjust = (axis: 'x' | 'y', start: number, size: number, delta: number) => {
    let distance = Infinity, correction = 0, coordinate: number | undefined;
    const length = axis === 'x' ? 'width' : 'height';
    for (const target of targets) for (const line of [target[axis], target[axis] + target[length] / 2, target[axis] + target[length]]) {
      for (const edge of [start + delta, start + delta + size / 2, start + delta + size]) {
        const difference = line - edge;
        if (Math.abs(difference) <= tolerance && Math.abs(difference) < distance) { distance = Math.abs(difference); correction = difference; coordinate = line; }
      }
    }
    if (coordinate !== undefined) guides.push({ axis, coordinate });
    return delta + correction;
  };
  return { dx: adjust('x', x, width, dx), dy: adjust('y', y, height, dy), guides };
}
