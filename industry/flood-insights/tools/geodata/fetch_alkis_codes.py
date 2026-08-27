"""Fetch the AdV ALKIS `Gebaeudefunktion` code list and check it against what we measured.

⚠️ The sibling project read code meanings off the survey's own `gml:name`. That is not available
here: NRW and RP write the cadastral ID into `gml:name` (`DENW42AL10007PmX`), not a building name,
so only a handful of churches and one castle carry anything human-readable.

So the meaning has to come from the catalogue that produced the codes — which is the AdV's own,
not a third party's guess — and the catalogue is then CHECKED against the measured footprint and
height. A code list can be the wrong version; a median of 28 m² and 2.9 m cannot be argued with.
Where the two disagree, the disagreement is printed and the size wins.
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

try:  # corporate TLS interception — see /memories (truststore note)
    import truststore

    truststore.inject_into_ssl()
except Exception:  # pragma: no cover
    pass

SOURCES = [
    "http://repository.gdi-de.org/schemas/adv/citygml/Codelisten/BuildingFunctionTypeAdV.xml",
    "https://repository.gdi-de.org/schemas/adv/citygml/Codelisten/BuildingFunctionTypeAdV.xml",
]


def fetch(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": "Flut-Insights/geodata (contact via repo)"})
    with urlopen(req, timeout=60) as r:
        return r.read()


def parse(xml: bytes) -> dict[str, str]:
    root = ET.fromstring(xml)
    out: dict[str, str] = {}
    for entry in root.iter():
        if entry.tag.rsplit("}", 1)[-1] != "Definition":
            continue
        code = ""
        label = ""
        for child in entry.iter():
            t = child.tag.rsplit("}", 1)[-1]
            if t == "identifier" and child.text:
                code = child.text.strip().rsplit("/", 1)[-1]
            elif t in ("name", "description") and child.text and not label:
                label = child.text.strip()
        if code:
            out[code] = label
    return out


def main() -> None:
    codes: dict[str, str] = {}
    for url in SOURCES:
        try:
            codes = parse(fetch(url))
            if codes:
                print(f"fetched {len(codes)} codes from {url}")
                break
        except Exception as exc:  # noqa: BLE001
            print(f"  {url} -> {type(exc).__name__}: {exc}")
    if not codes:
        print("\nNo catalogue reachable. The size-driven rules stand on their own; see PLAN.")
        sys.exit(2)

    out = Path("data/derived/alkis_gebaeudefunktion.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(codes, ensure_ascii=False, indent=1, sort_keys=True), "utf-8")
    print(f"wrote {out} ({len(codes)} codes)")

    wanted = [c.strip() for c in sys.argv[1:]] or []
    for code in wanted:
        print(f"  {code}: {codes.get(code, '(not in catalogue)')}")


if __name__ == "__main__":
    main()
