"""Join Copernicus EMSR517 observed damage grades onto the LoD2 buildings.

⚠️ READ THIS BEFORE CHANGING ANYTHING HERE ⚠️

This attaches a real, official damage assessment to a real, identifiable building. That is a
significant step and it is only defensible under specific conditions:

1. **It is an attributed observation, never our assertion.** The grade comes from Copernicus EMS,
   was produced by photo-interpretation of post-event imagery, and is published by the European
   Union. The app says "Copernicus-Einstufung", cites the activation, and never renders the grade
   as if the twin had determined it.

2. **It is separated from anything we modelled.** Our simulated depth is labelled "simulierte
   Wassertiefe". The two never merge into a single verdict about a building.

3. **No money is ever shown against an individual real address.** This is the line the script
   enforces by simply not exporting it: `sumInsuredEur`, `estimatedLossEur` and coverage outcomes
   stay aggregate. A real address plus a euro figure plus "nicht gedeckt" reads as a factual claim
   about a real household's finances, and it would be false — the portfolio is synthetic.

4. **Nothing here identifies a person.** No names, no addresses beyond the street already in OSM,
   no occupancy. The grade describes a structure.

The join is nearest-point within a tolerance, because Copernicus grades building *points* while
LoD2 gives building *volumes*. Unmatched buildings stay unmatched — inventing a grade for them
would be exactly the kind of quiet fabrication §2 exists to prevent.

Usage
  python tools/geodata/join_observed_damage.py
"""

from __future__ import annotations

import argparse
import json
import struct
import zipfile
from pathlib import Path

import numpy as np

from aoi import load_aoi
from utm import wgs84_to_utm32

# Copernicus grades, kept in the original English so the attribution is unambiguous, with the
# German rendering the UI shows alongside.
GRADE_LABELS = {
    "Destroyed": "zerstört",
    "Damaged": "beschädigt",
    "Possibly damaged": "möglicherweise beschädigt",
    "Negligible to slight damage": "geringfügig beschädigt",
    "Not Analysed": "nicht bewertet",
}

MATCH_TOLERANCE_M = 2.0


def point_in_ring(ring: list[list[float]], x: float, y: float) -> bool:
    """Even-odd ray casting."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) / (y2 - y1) * (x2 - x1):
                inside = not inside
    return inside


def read_points(zip_path: Path) -> list[dict]:
    """Read the graded building points (shape type 1) with their damage attribute."""
    with zipfile.ZipFile(zip_path) as zf:
        shp_name = next(n for n in zf.namelist() if n.endswith(".shp") and "builtUpP" in n)
        dbf_name = shp_name[:-4] + ".dbf"
        shp = zf.read(shp_name)
        dbf = zf.read(dbf_name)

    # Points
    coords = []
    offset = 100
    while offset < len(shp):
        _rec, content_len = struct.unpack(">II", shp[offset : offset + 8])
        start = offset + 8
        shape_type = struct.unpack("<i", shp[start : start + 4])[0]
        if shape_type == 1:
            x, y = struct.unpack("<2d", shp[start + 4 : start + 20])
            coords.append((x, y))
        offset = start + content_len * 2

    # Attributes
    fields = []
    off = 32
    while off < len(dbf) and dbf[off] != 0x0D:
        raw = dbf[off : off + 32]
        fields.append((raw[:11].split(b"\x00")[0].decode("latin-1"), raw[16]))
        off += 32
    count, header_len, record_len = struct.unpack("<IHH", dbf[4:12])

    rows = []
    for i in range(count):
        pos = header_len + i * record_len + 1
        row = {}
        for name, length in fields:
            row[name] = dbf[pos : pos + length].decode("latin-1").strip()
            pos += length
        rows.append(row)

    return [
        {"lon": c[0], "lat": c[1], "grade": r.get("damage_gra", ""), "method": r.get("det_method", "")}
        for c, r in zip(coords, rows)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="ahrtal-2021")
    parser.add_argument(
        "--product",
        default="EMSR517_AOI15_GRA_PRODUCT_r1_RTP01_v1_vector.zip",
        help="grading product with the graded building points",
    )
    parser.add_argument("--emsr", type=Path, default=Path("data/raw/emsr517"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = Path("public/terrain") / cfg["id"]

    # The footprints file, not the one the browser downloads. Matching needs the ground rings, and
    # the per-building grade must not travel to the client anyway: PLAN 2.2 allows the Copernicus
    # grading to be reported in aggregate, never attached to an individual real address in the UI.
    # It lives under data/derived/ for exactly that reason — under public/ it was being served.
    meta_path = Path("data/derived") / cfg["id"] / "buildings_lod2_footprints.json"
    if not meta_path.exists():
        raise SystemExit(f"missing {meta_path} — run build_lod2_mesh.py first")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    buildings = meta["buildings"]

    points = read_points(args.emsr / args.product)
    print(f"{len(points)} graded points, {len(buildings)} LoD2 buildings")

    projected = np.array([wgs84_to_utm32(p["lon"], p["lat"]) for p in points])
    grades = [p["grade"] for p in points]

    building_xy = np.array([[b["easting"], b["northing"]] for b in buildings])

    # CONTAINMENT, not proximity.
    #
    # The first attempt used a nearest-point join at 18 m. The distances showed why that was
    # unsafe: the median nearest graded point is 255 m, and the two datasets digitise buildings
    # independently, so "closest point within 18 m" can easily belong to the house next door.
    # Attaching "zerstört" to the wrong real address is the specific harm to avoid here, so a grade
    # is only accepted when the Copernicus point falls INSIDE this building's own footprint.
    matched = 0
    ambiguous = 0
    counts: dict[str, int] = {}
    for i, b in enumerate(buildings):
        b["observedGrade"] = None
        b["observedGradeDe"] = None
        ring = b.get("footprint")
        if not ring or len(ring) < 4:
            continue

        d2 = ((projected - building_xy[i]) ** 2).sum(axis=1)
        # Only points plausibly near this building need the containment test.
        candidates = np.flatnonzero(d2 < 60.0**2)
        hits = [
            j for j in candidates if point_in_ring(ring, float(projected[j][0]), float(projected[j][1]))
        ]
        if not hits:
            continue
        if len({grades[j] for j in hits}) > 1:
            # Two points inside one footprint disagreeing about the grade. Rather than pick one,
            # leave it unmatched and count it — an honest gap beats a confident guess.
            ambiguous += 1
            continue

        grade = grades[hits[0]]
        b["observedGrade"] = grade
        b["observedGradeDe"] = GRADE_LABELS.get(grade, grade)
        b["observedPointsInside"] = len(hits)
        matched += 1
        counts[grade] = counts.get(grade, 0) + 1

    print(
        f"matched {matched} ({matched / len(buildings) * 100:.0f}%) by containment; "
        f"{ambiguous} ambiguous left unmatched"
    )
    print(f"grades: {dict(sorted(counts.items()))}")

    meta["observedDamage"] = {
        "source": "Copernicus EMS EMSR517, Grading, AOI15 Bad Neuenahr-Ahrweiler",
        "method": "Photo-interpretation post-event imagery",
        "attribution": "© European Union, Copernicus Emergency Management Service (EMSR517)",
        "matched": matched,
        "counts": counts,
        "toleranceM": MATCH_TOLERANCE_M,
        "note": (
            "Amtliche Einstufung des Copernicus-Notfallkartierungsdienstes, erhoben durch "
            "Auswertung von Satelliten- und Luftbildern nach dem Ereignis. Sie ist eine "
            "Beobachtung Dritter, keine Aussage dieser Anwendung und kein Ergebnis der "
            "Simulation."
        ),
    }
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"wrote {meta_path} ({meta_path.stat().st_size / 1024:.0f} KB)")

    # The aggregate travels to the app; the per-building grades do not.
    app_path = out_dir / "buildings_lod2.json"
    if app_path.exists():
        app_meta = json.loads(app_path.read_text(encoding="utf-8"))
        app_meta["observedDamage"] = meta["observedDamage"]
        app_path.write_text(
            json.dumps(app_meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"wrote the aggregate into {app_path}")


if __name__ == "__main__":
    main()
