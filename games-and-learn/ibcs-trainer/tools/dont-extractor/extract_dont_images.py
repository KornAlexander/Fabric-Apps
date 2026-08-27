#!/usr/bin/env python3
"""Reusable batch tool: crop the per-rule "Don't" charts out of the IBCS poster
photos and remove the black diagonal strike-through line.

For every entry in a JSON manifest this tool:

  1. opens the source poster picture (it is never modified -- a copy is worked on),
  2. crops to the rectangle of a single "Don't" chart cell,
  3. detects the black corner-to-corner strike-through line and paints it out
     (OpenCV inpainting), and
  4. writes the cleaned chart to ``public/game/img/dont/<CODE>.png`` using the
     filename convention from ``public/game/ibcs_rules.js`` (spaces and dots in the
     rule code become hyphens, e.g. ``ST 2.2`` -> ``ST-2-2.png``).

Missing files fall back to the procedural glyph in ``ibcs_charts.js``, so the
bank can be filled in incrementally -- run this tool again whenever you add more
crop boxes to the manifest.

Usage:
    python extract_dont_images.py --manifest crops.json
    python extract_dont_images.py --manifest crops.json --only "ST 2.2" --debug
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def image_code(code: str) -> str:
    """Mirror IBCS.imageCode(): spaces and dots in a rule code become hyphens."""
    out = []
    for ch in str(code):
        out.append("-" if ch in " ." else ch)
    return "".join(out)


def find_strike_line(gray: np.ndarray, dark_threshold: int):
    """Return the endpoints of the dominant diagonal dark line, or None.

    The strike-through runs roughly border-to-border, so we keep the longest
    Hough segment whose angle is clearly diagonal (between 15 and 75 degrees).
    """
    h, w = gray.shape[:2]
    dark = (gray < dark_threshold).astype(np.uint8) * 255
    min_len = int(0.45 * min(h, w))
    lines = cv2.HoughLinesP(
        dark,
        rho=1,
        theta=np.pi / 360,
        threshold=50,
        minLineLength=min_len,
        maxLineGap=max(20, min(h, w) // 6),
    )
    if lines is None:
        return None
    best = None
    for x1, y1, x2, y2 in lines[:, 0, :]:
        angle = abs(np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1))))
        length = float(np.hypot(x2 - x1, y2 - y1))
        if 15 < angle < 75 and (best is None or length > best[0]):
            best = (length, (int(x1), int(y1), int(x2), int(y2)))
    return None if best is None else best[1]


def extend_to_border(x1, y1, x2, y2, w, h):
    """Extend a segment along its own direction until it hits the crop borders."""
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return x1, y1, x2, y2
    ts = []
    if dx != 0:
        ts += [(0 - x1) / dx, (w - 1 - x1) / dx]
    if dy != 0:
        ts += [(0 - y1) / dy, (h - 1 - y1) / dy]
    pts = []
    for t in ts:
        px, py = x1 + t * dx, y1 + t * dy
        if -1 <= px <= w and -1 <= py <= h:
            pts.append((px, py))
    if len(pts) < 2:
        return x1, y1, x2, y2
    # the two extreme points along the direction are the border intersections
    pts.sort(key=lambda p: p[0] * dx + p[1] * dy)
    (ax, ay), (bx, by) = pts[0], pts[-1]
    return int(round(ax)), int(round(ay)), int(round(bx)), int(round(by))


def remove_strike(cell: np.ndarray, dark_threshold: int, line_width: int, debug=None):
    """Inpaint the black diagonal strike-through line out of a single cell."""
    h, w = cell.shape[:2]
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    seg = find_strike_line(gray, dark_threshold)
    mask = np.zeros((h, w), np.uint8)
    if seg is not None:
        x1, y1, x2, y2 = extend_to_border(*seg, w, h)
        cv2.line(mask, (x1, y1), (x2, y2), 255, line_width)
        # only repaint pixels that are actually dark, so text the line missed is kept
        dark = (gray < dark_threshold + 30).astype(np.uint8) * 255
        mask = cv2.bitwise_and(mask, cv2.dilate(dark, np.ones((3, 3), np.uint8)))
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    if debug is not None:
        cv2.imwrite(debug, mask)
    if not mask.any():
        return cell, False
    cleaned = cv2.inpaint(cell, mask, 4, cv2.INPAINT_TELEA)
    return cleaned, True


def process(entry, source_dir, output_dir, defaults, debug_dir=None):
    code = entry["code"]
    src = os.path.join(source_dir, entry["source"])
    img = cv2.imread(src)
    if img is None:
        raise FileNotFoundError(f"cannot read source image: {src}")

    x1, y1, x2, y2 = entry["box"]
    cell = img[y1:y2, x1:x2].copy()  # work on a copy; source stays untouched

    thr = entry.get("dark_threshold", defaults["dark_threshold"])
    lw = entry.get("line_width", defaults["line_width"])
    debug = os.path.join(debug_dir, image_code(code) + ".mask.png") if debug_dir else None
    cleaned, removed = remove_strike(cell, thr, lw, debug)

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, image_code(code) + ".png")
    cv2.imwrite(out_path, cleaned)
    return out_path, removed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", default=os.path.join(HERE, "crops.json"),
                    help="JSON manifest of crop boxes (default: crops.json)")
    ap.add_argument("--only", action="append", default=None,
                    help="only process the given rule code(s); repeatable")
    ap.add_argument("--debug", action="store_true",
                    help="also write the strike-line mask next to each output")
    args = ap.parse_args(argv)

    with open(args.manifest, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    source_dir = os.path.join(REPO_ROOT, manifest.get("source_dir", "docs/poster"))
    output_dir = os.path.join(REPO_ROOT, manifest.get("output_dir", "public/game/img/dont"))
    defaults = {
        "dark_threshold": manifest.get("dark_threshold", 110),
        "line_width": manifest.get("line_width", 7),
    }
    debug_dir = output_dir if args.debug else None

    cells = manifest.get("cells", [])
    if args.only:
        wanted = set(args.only)
        cells = [c for c in cells if c["code"] in wanted]
    if not cells:
        print("No cells to process. Add entries to the manifest 'cells' array.")
        return 0

    failures = 0
    for entry in cells:
        try:
            out_path, removed = process(entry, source_dir, output_dir, defaults, debug_dir)
            note = "" if removed else "  (no strike line detected)"
            print(f"  {entry['code']:<10} -> {os.path.relpath(out_path, REPO_ROOT)}{note}")
        except Exception as exc:  # noqa: BLE001 - report and continue the batch
            failures += 1
            print(f"  {entry.get('code', '?'):<10} FAILED: {exc}", file=sys.stderr)

    print(f"Done: {len(cells) - failures}/{len(cells)} cells written to "
          f"{os.path.relpath(output_dir, REPO_ROOT)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
