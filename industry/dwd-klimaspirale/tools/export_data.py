#!/usr/bin/env python3
"""Export real DWD daily mean temperature into the Klimaspirale web app shape.

Reads a long-format table of daily observations (the same grain as the
Lakehouse fact ``Wetter.BeobachtungenTag``) and writes
``webapp/klimaspirale/data/klimaspirale.json`` — the dataset the standalone
HTML/TypeScript Klimaspirale renders.

The input is a CSV (or ``.tsv``) with at least these columns (header names are
matched case-insensitively, German or English):

    Datum/date,  Parameter/parameter,  Wert/value   [, Station_Id/station_id]

For each calendar date the value is averaged across all stations to a single
national (or region-scoped) daily mean, then grouped into the nested
``{region, parameter, years:[{year, days:[{date, tMean}]}]}`` structure.

This script is **dependency-light** (Python standard library only) so it runs
anywhere. Inside Fabric, prefer the Spark export cell in
``DWD-Wetter-Insights Finalize.ipynb`` which reads the Lakehouse table directly;
both produce the identical JSON shape.

Usage:
    python export_data.py --input observations.csv \
        --output ../data/klimaspirale.json --region "Deutschland"
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable

DEFAULT_PARAMETER = "temperature_air_mean_2m"

# Accepted header aliases (lower-cased) → canonical field.
_ALIASES = {
    "datum": "date",
    "date": "date",
    "parameter": "parameter",
    "param": "parameter",
    "wert": "value",
    "value": "value",
}


def _resolve_columns(header: list[str]) -> dict[str, str]:
    """Map canonical field → actual column name present in *header*."""
    found: dict[str, str] = {}
    for col in header:
        canon = _ALIASES.get(col.strip().lower())
        if canon and canon not in found:
            found[canon] = col
    return found


def aggregate_daily_mean(
    rows: Iterable[dict[str, str]],
    columns: dict[str, str],
    parameter: str,
) -> dict[str, float]:
    """Average the parameter's value across stations per date.

    Returns ``{ "YYYY-MM-DD": mean_value }`` for the requested parameter.
    """
    date_col = columns["date"]
    param_col = columns["parameter"]
    value_col = columns["value"]

    sums: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        if row.get(param_col) != parameter:
            continue
        raw = row.get(value_col)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        date = (row.get(date_col) or "").strip()
        if not date:
            continue
        # Normalise an ISO timestamp ("2014-03-21T00:00:00") to a plain date.
        date = date[:10]
        sums[date] += value
        counts[date] += 1

    return {d: sums[d] / counts[d] for d in sums if counts[d] > 0}


def build_dataset(
    daily_mean: dict[str, float],
    region: str,
    parameter: str,
) -> dict:
    """Group per-date means into the nested web-app structure."""
    years: dict[int, list[dict]] = defaultdict(list)
    for date in sorted(daily_mean):
        try:
            year = int(date[:4])
        except ValueError:
            continue
        years[year].append({"date": date, "tMean": round(daily_mean[date], 1)})

    return {
        "region": region,
        "parameter": parameter,
        "years": [
            {"year": year, "days": years[year]} for year in sorted(years)
        ],
    }


def _read_rows(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        header = reader.fieldnames or []
        return list(reader), header


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path,
                        help="CSV/TSV of long-format daily observations.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "klimaspirale.json",
        help="Destination JSON (default: webapp data/klimaspirale.json).",
    )
    parser.add_argument("--parameter", default=DEFAULT_PARAMETER,
                        help=f"Parameter to export (default: {DEFAULT_PARAMETER}).")
    parser.add_argument("--region", default="Deutschland",
                        help="Region label stored in the dataset.")
    args = parser.parse_args(argv)

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 2

    rows, header = _read_rows(args.input)
    columns = _resolve_columns(header)
    missing = [c for c in ("date", "parameter", "value") if c not in columns]
    if missing:
        print(
            f"Input is missing required column(s) {missing}. "
            f"Found header: {header}",
            file=sys.stderr,
        )
        return 2

    daily_mean = aggregate_daily_mean(rows, columns, args.parameter)
    if not daily_mean:
        print(
            f"No rows matched parameter '{args.parameter}'. Nothing written.",
            file=sys.stderr,
        )
        return 1

    dataset = build_dataset(daily_mean, args.region, args.parameter)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset), encoding="utf-8")
    days = sum(len(y["days"]) for y in dataset["years"])
    print(
        f"Wrote {args.output} — {len(dataset['years'])} years, {days} days "
        f"({args.parameter}, {args.region})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
