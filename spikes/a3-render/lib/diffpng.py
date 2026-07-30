"""Screenshot diff tool: pure pixel comparison over PNG screenshots.

Dependency cost note (per task step 0): uses Pillow (12.3.0) + numpy (2.4.3),
both already present in the spike environment (see `pip list` at spike start).
No new installs were needed for this spike. If the real Renderer/Quality
pipeline adopts pixel diffing, budget ~2 extra wheels (Pillow, numpy) on top
of Playwright; both are small, pure-C-extension wheels with no known
Windows install friction.

Diff definition: per-pixel Euclidean-ish distance in RGB (0-255 each channel),
a pixel counts as "different" if sum(abs(dR),abs(dG),abs(dB)) > CHANNEL_SUM_TOL.
This tolerance absorbs harmless sub-pixel antialiasing jitter between two
separate headless-Chrome launches while still catching real content changes.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
from PIL import Image

CHANNEL_SUM_TOL = 24  # sum of |dR|+|dG|+|dB| out of 765 max; ~3% per channel


@dataclass
class BBox:
    x0: int
    y0: int
    x1: int
    y1: int

    def as_tuple(self):
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass
class DiffResult:
    size_mismatch: bool
    size_a: tuple[int, int] | None
    size_b: tuple[int, int] | None
    considered_pixels: int
    diff_pixels: int
    diff_ratio: float | None  # diff_pixels / considered_pixels
    diff_bbox: tuple[int, int, int, int] | None  # bounding box of differing pixels, in image coords
    excluded_pixels: int

    def to_dict(self):
        return asdict(self)


def _load_rgb(path: str | Path) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.int16)  # H, W, 3


def _exclusion_mask(shape: tuple[int, int], exclude_bboxes: list[tuple[int, int, int, int]] | None) -> np.ndarray:
    """True where pixel should be IGNORED (inside an excluded bbox)."""
    h, w = shape
    mask = np.zeros((h, w), dtype=bool)
    if not exclude_bboxes:
        return mask
    for (x0, y0, x1, y1) in exclude_bboxes:
        x0c, x1c = max(0, int(x0)), min(w, int(x1))
        y0c, y1c = max(0, int(y0)), min(h, int(y1))
        if x1c > x0c and y1c > y0c:
            mask[y0c:y1c, x0c:x1c] = True
    return mask


def diff_images(
    path_a: str | Path,
    path_b: str | Path,
    exclude_bboxes: list[tuple[int, int, int, int]] | None = None,
    channel_sum_tol: int = CHANNEL_SUM_TOL,
) -> DiffResult:
    """Compare two PNG screenshots.

    exclude_bboxes: list of (x0,y0,x1,y1) rects to EXCLUDE from comparison
    (used by A3's "visual isolation outside scope" check -- the edited
    element's own bbox is excluded so an intentional in-scope change doesn't
    trip the outside-scope diff).
    """
    a = _load_rgb(path_a)
    b = _load_rgb(path_b)
    if a.shape != b.shape:
        return DiffResult(
            size_mismatch=True,
            size_a=(a.shape[1], a.shape[0]),
            size_b=(b.shape[1], b.shape[0]),
            considered_pixels=0,
            diff_pixels=0,
            diff_ratio=None,
            diff_bbox=None,
            excluded_pixels=0,
        )
    h, w, _ = a.shape
    delta = np.abs(a - b).sum(axis=2)  # H, W
    diff_mask = delta > channel_sum_tol

    excl_mask = _exclusion_mask((h, w), exclude_bboxes)
    considered_mask = ~excl_mask
    considered_pixels = int(considered_mask.sum())

    effective_diff_mask = diff_mask & considered_mask
    diff_pixels = int(effective_diff_mask.sum())
    excluded_pixels = int(excl_mask.sum())

    diff_ratio = (diff_pixels / considered_pixels) if considered_pixels else 0.0

    bbox = None
    ys, xs = np.nonzero(effective_diff_mask)
    if len(xs):
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    return DiffResult(
        size_mismatch=False,
        size_a=(w, h),
        size_b=(w, h),
        considered_pixels=considered_pixels,
        diff_pixels=diff_pixels,
        diff_ratio=diff_ratio,
        diff_bbox=bbox,
        excluded_pixels=excluded_pixels,
    )


if __name__ == "__main__":
    import sys

    r = diff_images(sys.argv[1], sys.argv[2])
    print(r.to_dict())
