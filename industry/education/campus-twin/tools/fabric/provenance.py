"""What a lakehouse load is made of, and whether it may be loaded at all.

Shared by the loader (`build_lakehouse_tables.py`, which writes the stamp) and the gate
(`verify_model_agreement.py`, which reads it back), so the two cannot define "real" differently.

⚠️ THE TABLES LOOK THE SAME EITHER WAY. A rooms file built from real TUMonline bookings and one
built by the synthetic generator have the same shape, and a report over them shows equally
plausible numbers. The only thing that tells them apart is the `semantics` stamp inside the rooms
file, which is the rule `tools/check_release.mjs` already applies. Everything here reads that stamp
rather than a file name or a belief.

⚠️ AND WHAT A MISSING STAMP MEANS DEPENDS ON THE SITE. For Garching it means real, because that is
what its rooms builder writes when it is not told otherwise. For the demo site it means nothing:
that file never carries a stamp, and every room in it is generated. `Site.fixed_semantics`
(`sites.py`) says so, instead of this module guessing from an absent key.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from sites import Site

ROOT = Path(__file__).resolve().parents[2]


def release_mode() -> str:
    """`navigatumData` from config/release.json, failing CLOSED like `src/config/release.ts`."""
    try:
        raw = json.loads((ROOT / "config" / "release.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "exclude"
    value = raw.get("navigatumData")
    return value if value in {"include", "synthetic", "exclude"} else "exclude"


def source_semantics(site: Site, meta: dict) -> str:
    """What the rooms file was built from, for this site."""
    if site.fixed_semantics:
        # Fixed, but not blind: a stamp in the file that says otherwise means the file is not what
        # this site's profile takes it for, and that must stop the run rather than be overruled.
        stamped = meta.get("semantics")
        if stamped and stamped != site.fixed_semantics:
            raise SystemExit(
                f"{site.aoi}/rooms.json is stamped {stamped!r}, but {site.label} is {site.fixed_semantics} by "
                "definition (tools/fabric/sites.py). One of the two is wrong."
            )
        return site.fixed_semantics
    # A missing stamp means real, as in `check_release.mjs`.
    return meta.get("semantics") or "navigatum"


def source_hash(rooms: bytes, occupancy: bytes) -> str:
    """One hash over BOTH files a load is made of.

    ⚠️ THE BOOKINGS ARE NOT IN `rooms.json`. That file holds the rooms and an index per room; the
    booked hours themselves are `occupancy.bin`. A hash of the rooms file alone stays the same when
    the bookings are swapped, which is exactly the change the stamp exists to notice. The length
    prefix keeps two different splits of the same bytes from hashing alike.
    """
    digest = hashlib.sha256()
    digest.update(len(rooms).to_bytes(8, "big"))
    digest.update(rooms)
    digest.update(occupancy)
    return digest.hexdigest()


def problem_with(site: Site, semantics: str) -> str | None:
    """Why this source must not be in this site's model under the current release posture, or `None`.

    The model must hold the data state the app shows, in both directions.

    ⚠️ REAL DATA NEEDS `include`. A rooms file with real bookings while the switch says anything
    else is the half-flipped state docs/internal/deployment.md warns about: loading it would put
    withheld data into a model that reports are built on.
    """
    if semantics not in site.source_labels:
        return f"semantics {semantics!r} is not a data state {site.label} can have"
    if site.governed_by != "navigatumData":
        return None
    mode = release_mode()
    if semantics == "navigatum" and mode != "include":
        return f'the source carries REAL bookings, but config/release.json says navigatumData = "{mode}"'
    # ⚠️ AND THE OTHER DIRECTION. Under "include" the app shows the real bookings and offers the
    # report window beside them (`src/config/powerbi.ts`). A synthetic load in the model then puts an
    # invented week in that window next to a panel showing the real one. The report would label
    # itself synthetic, which is honest and still a second, different answer about the same room.
    if semantics == "synthetic" and mode == "include":
        return 'the source is SYNTHETIC, but config/release.json says navigatumData = "include" and the app shows the real week'
    return None
