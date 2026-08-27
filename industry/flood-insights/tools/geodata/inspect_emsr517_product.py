"""Inspect the layers and attribute schema of a downloaded EMSR517 vector product.

The grading product carries per-building damage grades — the ground truth for the validation
metric in PLAN §6.5. This prints what is actually in the file so the schema in §8.2 can be written
against reality rather than assumption.

Usage
  python tools/geodata/inspect_emsr517_product.py EMSR517_AOI15_GRA_PRODUCT_r1_RTP01_v1_vector.zip
"""

from __future__ import annotations

import argparse
import struct
import zipfile
from collections import Counter
from pathlib import Path

SHAPE_TYPES = {0: "Null", 1: "Point", 3: "PolyLine", 5: "Polygon", 8: "MultiPoint"}


def read_dbf_fields(data: bytes) -> list[tuple[str, str, int]]:
    """Parse the dBASE III header: 32-byte header, then 32 bytes per field descriptor."""
    fields = []
    offset = 32
    while offset < len(data) and data[offset] != 0x0D:
        raw = data[offset : offset + 32]
        name = raw[:11].split(b"\x00")[0].decode("latin-1")
        ftype = chr(raw[11])
        length = raw[16]
        fields.append((name, ftype, length))
        offset += 32
    return fields


def read_dbf_records(data: bytes, fields: list[tuple[str, str, int]], limit: int) -> list[dict]:
    num_records, header_len, record_len = struct.unpack("<IHH", data[4:12])
    rows = []
    for i in range(min(num_records, limit)):
        start = header_len + i * record_len + 1  # +1 skips the deletion flag
        pos = start
        row = {}
        for name, _ftype, length in fields:
            row[name] = data[pos : pos + length].decode("latin-1").strip()
            pos += length
        rows.append(row)
    return rows


def count_values(data: bytes, fields: list[tuple[str, str, int]], field: str) -> Counter:
    num_records, header_len, record_len = struct.unpack("<IHH", data[4:12])
    offsets = {}
    pos = 1
    for name, _ftype, length in fields:
        offsets[name] = (pos, length)
        pos += length
    start_off, length = offsets[field]
    counter: Counter = Counter()
    for i in range(num_records):
        base = header_len + i * record_len + start_off
        counter[data[base : base + length].decode("latin-1").strip()] += 1
    return counter


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("product", help="zip filename inside --dir")
    parser.add_argument("--dir", type=Path, default=Path("data/raw/emsr517"))
    parser.add_argument("--rows", type=int, default=2, help="sample rows to print per layer")
    args = parser.parse_args()

    path = args.dir / args.product
    with zipfile.ZipFile(path) as zf:
        shp_names = sorted(n for n in zf.namelist() if n.lower().endswith(".shp"))
        print(f"{path.name}\n{len(shp_names)} layers\n")

        for shp in shp_names:
            header = zf.read(shp)[:100]
            shape_type = struct.unpack("<i", header[32:36])[0]
            # ASCII only: the Windows console is cp1252 and box-drawing characters raise
            # UnicodeEncodeError there.
            print(f"-- {Path(shp).name}  [{SHAPE_TYPES.get(shape_type, shape_type)}]")

            dbf_name = shp[:-4] + ".dbf"
            if dbf_name not in zf.namelist():
                print("   (no attribute table)\n")
                continue

            dbf = zf.read(dbf_name)
            record_count = struct.unpack("<I", dbf[4:8])[0]
            fields = read_dbf_fields(dbf)
            print(f"   {record_count} records, {len(fields)} fields")
            print(f"   fields: {', '.join(n for n, _t, _l in fields)}")

            # Damage-grade style fields are the ones we actually need — show their distribution.
            for name, _t, _l in fields:
                if any(k in name.lower() for k in ("grad", "damage", "class", "notation")):
                    counts = count_values(dbf, fields, name)
                    top = ", ".join(f"{k or '(blank)'}={v}" for k, v in counts.most_common(8))
                    print(f"   {name}: {top}")

            for row in read_dbf_records(dbf, fields, args.rows):
                compact = {k: v for k, v in row.items() if v}
                print(f"   sample: {compact}")
            print()


if __name__ == "__main__":
    main()
