"""Split an oversized drape mosaic into quadrants the browser can actually sample.



⚠️ THE GRID MUST DIVIDE THE MOSAIC EXACTLY. Tiles of unequal size would need per-tile uv scaling
in the shader, which is a second thing to get wrong for no benefit; if the mosaic does not divide
evenly this script says so and stops rather than rounding.

Usage
  python tools/geodata/split_drape.py --aoi flughafen
  python tools/geodata/split_drape.py --aoi flughafen --cols 2 --rows 2
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

from aoi import load_aoi, terrain_dir

#: The largest tile that uploads with a complete mipmap chain in practice. See the module note.
MAX_TILE_PX = 4096


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--cols", type=int, default=None)
    parser.add_argument("--rows", type=int, default=None)
    parser.add_argument("--quality", type=int, default=86)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = terrain_dir(cfg)
    meta_path = out_dir / "drape.json"
    image_path = out_dir / "drape.jpg"
    if not meta_path.exists() or not image_path.exists():
        raise SystemExit(f"No drape to split in {out_dir}. Run fetch_dop20.py first.")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("tiles") and not args.force:
        print(f"already split into {meta['tiles']['cols']} x {meta['tiles']['rows']} "
              "(use --force to redo)")
        return 0

    declared = (cfg.get("drape") or {}).get("tiles") or {}
    cols = args.cols or int(declared.get("cols", 2))
    rows = args.rows or int(declared.get("rows", 2))

    width = int(meta["width"])
    height = int(meta["height"])
    if width % cols or height % rows:
        raise SystemExit(
            f"{width} x {height} px does not divide evenly into {cols} x {rows}. "
            "Re-fetch the drape at a size that does, rather than rounding here."
        )
    tile_w = width // cols
    tile_h = height // rows
    if tile_w > MAX_TILE_PX or tile_h > MAX_TILE_PX:
        raise SystemExit(
            f"tiles would be {tile_w} x {tile_h} px, above the {MAX_TILE_PX} px limit that "
            "uploads reliably. Use more columns or rows."
        )

    print(f"{width} x {height} px -> {cols} x {rows} tiles of {tile_w} x {tile_h} px")

    # ⚠️ Row 0 is NORTH, the same convention as every other raster in this pipeline, and the
    # shader's quadrant index is computed in the already-flipped sampling space so that the two
    # agree. Naming the files by row/col rather than by compass direction keeps that single source
    # of truth: the shader indexes, it does not interpret.
    source = Image.open(image_path)
    items: list[dict] = []
    for row in range(rows):
        for col in range(cols):
            box = (col * tile_w, row * tile_h, (col + 1) * tile_w, (row + 1) * tile_h)
            name = f"drape_{row}_{col}.jpg"
            tile = source.crop(box)
            tile.save(out_dir / name, "JPEG", quality=args.quality, optimize=True,
                      progressive=True)
            size = (out_dir / name).stat().st_size
            print(f"  {name}  {tile_w} x {tile_h}  {size / 1_048_576:.2f} MB")
            items.append({"file": name, "row": row, "col": col,
                          "width": tile_w, "height": tile_h, "bytes": size})

    meta["tiles"] = {
        "cols": cols,
        "rows": rows,
        "tileWidth": tile_w,
        "tileHeight": tile_h,
        "items": items,
        "note": (
            "Row 0 is north, column 0 is west. The full mosaic stays in drape.jpg for reference "
            "and is NOT loaded by the app when this block is present."
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {meta_path}")

    # ⚠️ MOVED, NOT DELETED, AND NOT LEFT IN PLACE EITHER.
    #
    # Left in public/ it ships: 6.4 MB of a photograph the app never reads, because the tiles
    # replace it. Deleted outright it takes the ROOF COLOURS with it
    # this exact mosaic to colour every roof, and without it every roof silently falls back to
    # its wall class and the whole airfield renders as one flat colour. That happened once, and
    # the only reason it was caught is that the build prints a warning about it.
    #
    # So it goes to data/, which is a build cache and does not ship, and stays available for a
    # rebuild of the buildings or a re-split at a different grid.
    archive_dir = Path("data") / "drape-source" / str(cfg["id"])
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive = archive_dir / "drape.jpg"
    shutil.move(str(image_path), str(archive))
    print(f"\nmoved the {archive.stat().st_size / 1_048_576:.1f} MB mosaic out of the shipped set:"
          f"\n  {archive}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
