"""What the Ahr and Eifel cadastres actually say about their buildings.

⚠️ Run this BEFORE trusting `building_class.py` on a new region. The wall-class rules were read off
the Bavarian LDBV cadastre for Oberstdorf and the Tegelberg, and two things travel badly:

  * **Catalogue versions differ.** A code that means "chapel" in one state's ALKIS drop may be
    absent or re-used in another's. The only safe confirmation is the survey's OWN `gml:name`
    beside the code, which is why this prints example names rather than a code list.
  * **Vernacular differs.** Bavaria's `31001_2000` is dominated by boarded alpine huts. The Ahr
    valley and the Eifel are slate and render country; the same code here may be workshops and
    farm sheds that are rendered, not timbered. The size distribution is what settles it.

Namespace-agnostic on purpose: the RP tiles are CityGML 1.0 and NRW may not be, and matching on
the local tag name means a version bump shows up as different data rather than as zero buildings.

Usage
  python tools/geodata/lod2_function_spike.py --aoi ahrtal-2021
  python tools/geodata/lod2_function_spike.py --aoi steinbach-2021 --tiles 12
"""

from __future__ import annotations

import argparse
import gzip
import statistics
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from aoi import load_aoi, raw_dir


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def read_gml(path: Path) -> bytes:
    raw = path.read_bytes()
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw


def rings_of(element: ET.Element) -> list[list[tuple[float, float, float]]]:
    rings = []
    for pos in element.iter():
        if local(pos.tag) != "posList" or not pos.text:
            continue
        v = [float(x) for x in pos.text.split()]
        pts = [tuple(v[i : i + 3]) for i in range(0, len(v) - 2, 3)]
        if len(pts) >= 4:
            rings.append(pts)
    return rings


def area_m2(rings) -> float:
    best = 0.0
    for ring in rings:
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        if len(pts) < 3:
            continue
        total = 0.0
        for (x1, y1, _), (x2, y2, _) in zip(pts, pts[1:] + pts[:1]):
            total += x1 * y2 - x2 * y1
        best = max(best, abs(total) * 0.5)
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="ahrtal-2021")
    ap.add_argument("--tiles", type=int, default=0, help="0 = every tile")
    args = ap.parse_args()

    cfg = load_aoi(args.aoi)
    src = raw_dir("lod2", cfg["id"])
    tiles = sorted(src.glob("*.gml"))
    if args.tiles:
        tiles = tiles[: args.tiles]
    print(f"{cfg['id']}: reading {len(tiles)} of {len(sorted(src.glob('*.gml')))} tiles\n")

    codes: dict[str, list[tuple[float, float]]] = defaultdict(list)
    names: dict[str, list[str]] = defaultdict(list)
    semantics = {"RoofSurface": 0, "WallSurface": 0, "GroundSurface": 0, "ClosureSurface": 0}
    appearance = 0
    buildings = 0
    with_roof_semantics = 0
    namespaces: set[str] = set()

    for path in tiles:
        root = ET.fromstring(read_gml(path))
        for el in root.iter():
            if local(el.tag) in ("Appearance", "X3DMaterial"):
                appearance += 1
        for b in root.iter():
            if local(b.tag) != "Building":
                continue
            buildings += 1
            namespaces.add(b.tag.rsplit("}", 1)[0].lstrip("{"))

            code = ""
            name = ""
            height = 0.0
            ground: list = []
            has_roof = False
            for el in b.iter():
                t = local(el.tag)
                if t in semantics:
                    semantics[t] += 1
                    if t == "RoofSurface":
                        has_roof = True
                    if t == "GroundSurface":
                        ground.extend(rings_of(el))
                elif t == "function" and el.text:
                    code = el.text.strip()
                elif t == "name" and el.text and not name:
                    name = el.text.strip()
                elif t == "measuredHeight" and el.text:
                    try:
                        height = float(el.text)
                    except ValueError:
                        pass
            if has_roof:
                with_roof_semantics += 1
            if not ground:
                continue
            codes[code or "(none)"].append((area_m2(ground), height))
            if name and len(names[code or "(none)"]) < 6:
                names[code or "(none)"].append(name)
        print(f"  {path.name}: {buildings} cumulative")

    print(f"\nCityGML namespace(s): {sorted(namespaces)}")
    print(f"buildings: {buildings}")
    print(f"with RoofSurface semantics: {with_roof_semantics} "
          f"({100 * with_roof_semantics / max(buildings, 1):.1f}%)")
    print(f"surface counts: {semantics}")
    print(f"Appearance/X3DMaterial elements (i.e. any colour in the source): {appearance}")

    print(f"\n{'code':<14}{'n':>7}  {'med m2':>8} {'med h':>7}   examples")
    for code, rows in sorted(codes.items(), key=lambda kv: -len(kv[1])):
        med_a = statistics.median(r[0] for r in rows)
        heights = [r[1] for r in rows if r[1] > 0]
        med_h = statistics.median(heights) if heights else 0.0
        ex = ", ".join(names[code][:4]) or "—"
        print(f"{code:<14}{len(rows):>7}  {med_a:>8.0f} {med_h:>7.1f}   {ex[:70]}")


if __name__ == "__main__":
    main()
