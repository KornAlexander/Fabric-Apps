"""Fetch the DOP20 orthophoto drape for a Berlin AOI core, via the Geoportal Berlin WMS.

Like `fetch_dop20_nrw.py` and `fetch_dop20_hamburg.py`, this deliberately does NOT copy
`fetch_dop20.py`'s mosaic logic — the patch splitting, the seam arithmetic, taking the extent from
the generated heightmap so the photograph cannot slide against the terrain, and treating an XML
body on a 200 as the failure it is. None of that is Bavarian. Only the endpoint and the layer
differ, and since TU Berlin the zone does too — which `fetch_dop20.get_map` now derives from the
AOI rather than assuming.

⚠️ **NEVER USE BERLIN'S ATOM DOWNLOAD FOR THE DRAPE.** The catalogue offers both, and the download
service is partitioned by DISTRICT rather than by tile: `Mitte.zip` alone is **3.2 GB** (measured
2026-08-26 by HEAD), for an AOI that needs about 1.5 km². The WMS answers the same imagery for the
exact box in about 200 kB. The 2 km × 2 km "Blattschnitt" the dataset description mentions is how
the imagery is *organised*, not how it is *served*.

⚠️ **THE LAYER IS `dop_2025`, NOT `dop20_2025`.** GetCapabilities advertises both names. Asking for
`dop20_2025` returns a service exception — `LayerNotDefined: dop_2025_fruehjahr:dop20_2025` — which
`fetch_dop20.get_map` correctly raises on rather than saving as a JPEG. This is the same class of
trap the Bavarian fetcher documents for `by_dop20c`: the name the catalogue text suggests is not
the name the service answers to.

Measured 2026-08-26 over the Straße des 17. Juni campus, EPSG:25833, easting-first: real 20 cm
photography of the TU main building, the Spree and the Tiergarten edge — not the uniform tile an
out-of-coverage request returns. Ground resolution 0.20 m, positional accuracy ±0.4 m, flown
spring 2025.

Usage
  python tools/geodata/fetch_dop20_berlin.py --aoi tu-berlin
"""

from __future__ import annotations

import sys

import fetch_dop20

WMS = "https://gdi.berlin.de/services/wms/dop_2025_fruehjahr"

LAYER = "dop_2025"

USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://gdi.berlin.de)"

#: dl-de/zero-2-0 asks for no attribution at all — the most permissive of the five authorities in
#: this pipeline. Credited anyway, because the app tells the user where every layer came from and
#: "we did not have to say" is a poor answer to "whose photograph is this".
ATTRIBUTION = (
    "Datenquelle: Geoportal Berlin / Digitale farbige Orthophotos 2025 (DOP20RGBI), "
    "Land Berlin, dl-de/zero-2-0"
)


def main() -> None:
    # Rebind the service constants on the module that owns the mosaic logic; `get_map` reads these
    # as globals at call time, so there is no second implementation to keep in step.
    fetch_dop20.WMS = WMS
    fetch_dop20.LAYER = LAYER
    fetch_dop20.USER_AGENT = USER_AGENT
    fetch_dop20.main()
    print(ATTRIBUTION)


if __name__ == "__main__":
    sys.exit(main())
