"""Which wall treatment a building gets, for the Ahr valley and the Eifel.

⚠️ **This is NOT the Bavarian version, and it must not be.** The sibling project (Gleitschirm)
read its rules off the LDBV cadastre for Oberstdorf and the Tegelberg, where `31001_2000` is
dominated by boarded alpine huts and weathered timber is the right default for a small outbuilding.
Neither the code distribution nor the vernacular survives the journey to Rheinland-Pfalz and
Nordrhein-Westfalen, and the differences were measured, not assumed
(`lod2_function_spike.py`, 53 300 Ahr + 12 530 Steinbach buildings):

* **The codes differ.** `31001_2460` (n=3015, median 28 m² / 2.9 m) and `31001_2700` (n=1777,
  30 m² / 4.6 m) are the second and third largest groups in the Steinbach AOI and appear in the
  Bavarian AOIs not at all. In the Ahr, `31001_2000` is the second largest group at a median of
  **27 m² and 3.3 m** — the same "trade or commerce" trap as Bavaria, but even more one-sided.
* **The AdV catalogue was not reachable** from this network (`fetch_alkis_codes.py` records the
  attempt), so no code's official meaning could be looked up.

So the rule leans on the two things the survey measured directly — footprint and height — and on
the one thing this region's own data confirms: its building names.

**What the names confirm.** RP writes real names for public buildings, and every single named
`31001_3xxx` in either AOI is a public building, with no counterexample:

    31001_3041  "kath. Kirche St. Quirinus", "kath. Kirche Maria Verkündigung", "St. Martinus"
    31001_3043  "St. Maternus Kapelle", "St. Antonius Kapelle"
    31001_3021  "Ahrtalschule Realschule plus Altenahr", "Grundschule Altenahr"
    31001_3012  "Verbandsgemeindeverwaltung Altenahr", "Gemeindeverwaltung Grafschaft"
    31001_3051  "Dr. von Ehrenwallsche Klinik"        31001_3052  "Knappschaftsklinik"
    31001_3030  "Stadthalle"                          31001_3000  "Handwerkskammer", "Backes"
    31001_3031  "Schloss Burg Flamersheim"

That is ten independent confirmations across two states that `31001_3xxx` is the public block, which
is stronger evidence than a code list would have been — it comes from the survey that wrote the
codes. Everything outside that block is judged on size alone, because a building of 27 m² and 3.3 m
is an outbuilding whatever a catalogue calls it, and that inference cannot be invalidated by a
catalogue version.

Codes whose meaning is neither name-confirmed nor size-decided get the default. Guessing one would
be inventing evidence.

**What is measured and what is convention.** The class is measured. The colour each class is
painted is a convention — chosen to read as Rhineland render and slate, not as a claim about any
individual wall — and NOTICE.md says so.
"""

from __future__ import annotations

#: Wall treatments. Small integers because they cross to the browser once per building.
RENDER = 0
"""Rendered masonry in a warm off-white. The default, and most of both valleys."""

OUTBUILDING = 1
"""Garages, sheds, carports and wood stores: greyer and flatter, without the render's warmth."""

WHITEWASH = 2
"""The brighter, cooler lime of a church or chapel — deliberately lighter than a house."""

CIVIC = 3
"""Schools, clinics, administration, halls: rendered, but flatter and cooler than a house."""

WALL_CLASS_NAMES = {
    RENDER: "render",
    OUTBUILDING: "outbuilding",
    WHITEWASH: "whitewash",
    CIVIC: "civic",
}

#: Churches and chapels, confirmed by the survey's own names in both states.
_CHURCH = {"31001_3041", "31001_3043", "31001_3044"}

#: The public block. Confirmed as a block by ten named buildings and no counterexample.
_PUBLIC_PREFIX = "31001_3"

#: Above either of these, a building is a house rather than a shed. Set from the measured
#: distributions, which leave a wide gap: the outbuilding codes cluster at 14–30 m² and 2.9–4.6 m,
#: dwellings (`31001_1000`) at 87 m² and 8.2–9.1 m in BOTH AOIs. The threshold is not delicately
#: placed, which is the point — it should not need retuning for the next German valley.
MAX_OUTBUILDING_FOOTPRINT_M2 = 50.0
MAX_OUTBUILDING_HEIGHT_M = 5.0


def wall_class(function_code: str, footprint_m2: float, height_m: float) -> int:
    """Which wall treatment a building gets, from its confirmed class or its measured size.

    Height is consulted only when it was actually measured. `measuredHeight` is optional in the
    source and a missing one arrives here as 0.0; treating that as "very low" would sweep every
    unmeasured building into the outbuilding class, so a zero height falls back to footprint alone.
    """
    if function_code in _CHURCH:
        return WHITEWASH
    if function_code.startswith(_PUBLIC_PREFIX):
        return CIVIC

    if footprint_m2 >= MAX_OUTBUILDING_FOOTPRINT_M2:
        return RENDER
    if height_m <= 0.0:
        return OUTBUILDING  # small, and nothing measured says otherwise
    return OUTBUILDING if height_m < MAX_OUTBUILDING_HEIGHT_M else RENDER
