import type { Geometry } from "./model.ts";

export type Point = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number];
export type KonvaTransform = Partial<Geometry> & { scaleX?: number; scaleY?: number; offsetX?: number; offsetY?: number };

export function identityMatrix(): Matrix { return [1, 0, 0, 1, 0, 0]; }
export function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function transformPoint(matrix: Matrix, point: Point): Point { return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }; }
export function invertMatrix(matrix: Matrix): Matrix {
  const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("matrix is not invertible");
  return [matrix[3] / det, -matrix[1] / det, -matrix[2] / det, matrix[0] / det, (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / det, (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / det];
}
export function geometryMatrix(geometry: Geometry): Matrix {
  const radians = geometry.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return [cos, sin, -sin, cos, geometry.x, geometry.y];
}
export function parentToWorld(point: Point, parentMatrices: Matrix[] = []): Point { return parentMatrices.reduce((result, matrix) => transformPoint(matrix, result), point); }
export function worldToParent(point: Point, parentMatrices: Matrix[] = []): Point { return [...parentMatrices].reverse().reduce((result, matrix) => transformPoint(invertMatrix(matrix), result), point); }
export function normalizeKonvaTransform(transform: KonvaTransform): Geometry {
  const scaleX = transform.scaleX ?? 1, scaleY = transform.scaleY ?? 1;
  const width = Math.abs((transform.width ?? 0) * scaleX), height = Math.abs((transform.height ?? 0) * scaleY);
  return { x: (transform.x ?? 0) - (transform.offsetX ?? 0), y: (transform.y ?? 0) - (transform.offsetY ?? 0), width, height, rotation: normalizeRotation(transform.rotation ?? 0) };
}
export function normalizeRotation(rotation: number): number { const result = ((rotation + 180) % 360 + 360) % 360 - 180; return Object.is(result, -0) ? 0 : result; }
