"""
What a building IS, from the survey — PLAN §5.11.

Roof colour is measured from a photograph, and that photograph sees roughly thirty per cent of a
building. The other seventy is wall — 68–71 % of 3D surface area in every height band. A lecture
hall that is 68 % wall is barely touched by a roof sample, however good that sample is.

Walls cannot be measured: they are invisible from directly above, and OpenStreetMap carries
`building:colour` for a fraction of a per cent. But *what the building is* very much can be.
Bavarian LoD2 carries the ALKIS `bldg:function` code on every building, plus a measured height and
footprint, and a lecture hall is not a bin store is not a church.








Only 1.1 % of LGL buildings carry a `gml:name` at all — but the ones that do are overwhelmingly the
public buildings, exactly as in Rhineland-Palatinate, so the codes that matter are the codes that
can be confirmed. `31001_1312`/`1313` sit in the *dwelling* branch of the catalogue and are unnamed,
so they are judged the way `31001_2000` is: at a median of 13–27 m² and 3.6 m they are garden houses
and are treated as such, not as homes.

**What is measured and what is convention, stated plainly.** The class is measured: cadastral
function, the survey's own dimensions, and the operator tag. The colour each class is painted is a
convention, chosen to match Bavarian urban practice, and is not a claim about any individual wall.
"""

from __future__ import annotations

#: Wall treatments. Small integers because they cross to the browser in JSON once per building;
#: the names travel in the metadata block so the file stays readable.
RENDER = 0
"""Warm off-white render — the Bavarian urban default, and most of both cities."""

UTILITY = 1
"""Bin stores, garages, substations, carports. Grey blockwork, not a house colour."""

WHITEWASH = 2
"""The brighter, cooler lime of a church, chapel, synagogue or monastery."""

CIVIC = 3
"""Institutional: universities, clinics, schools, government, museums. Flatter and cooler."""

CONCRETE = 4
"""Parking decks and transport works. Bare grey, and deliberately not a building colour."""

WALL_CLASS_NAMES = {
    RENDER: "render",
    UTILITY: "utility",
    WHITEWASH: "whitewash",
    CIVIC: "civic",
    CONCRETE: "concrete",
}

#: Places of worship and religious houses
_WORSHIP = {
    "31001_3041",  # church
    "31001_3043",  # chapel
    "31001_3042",  # synagogue
    "31001_3048",  # monastery
}

_CIVIC = {
    "31001_3000",  # public building
    "31001_3010",  # BW: public administration
    "31001_3012",  # town hall
    "31001_3017",  # district administration
    "31001_3018",  # regional government
    "31001_3020",  # school / university
    "31001_3021",  # BW: school
    "31001_3023",  # BW: research / university
    "31001_3024",  # BW: university institute
    "31001_3031",  # palace / museum
    "31001_3034",  # BW: historic public
    "31001_3036",  # BW: public assembly
    "31001_3037",  # BW: library
    "31001_3044",  # BW: parish centre
    "31001_3051",  # hospital
    "31001_3052",  # clinic
    "31001_3065",  # kindergarten
    "31001_3071",  # police
    "31001_3072",  # fire station
    "31001_3075",  # prison
    "31001_3091",  # station / large public
    "31001_3210",  # BW: sports hall
    "31001_3211",  # BW: sports hall
    "31001_3221",  # BW: public baths
    "51001_1008",  # BW: tower
    "51001_1009",  # BW: tower
}

#: Parking decks and transport works. Concrete in life, and large enough to matter in view.
_CONCRETE = {
    "31001_2461",  # multi-storey car park
    "53001_1800",  # transport works
    "53009_2050",
    "52003_1020",
}

#: Open structures
_SHELTER = {"51009_1610", "51009_1700", "51007_1500"}

#: "Trade or commerce" and its neighbours: the group the size test exists for.
#:
#: The Baden-Württemberg entries are unnamed in the survey, so they are admitted on their measured
#: size alone
#: 15 m², `31001_1313` of 13 m². Nothing that small is a shop or a home. Where one of them IS large
#: (a works rather than a lock-up) the size test below still sends it to RENDER, so admitting them
#: here costs nothing if the reading is wrong.
_TRADE = {
    "31001_2000",
    "31001_2463",
    "31001_2465",
    "31001_2513",
    "31001_2523",
    "31001_2072",
    "31001_1312",  # BW, 27 m² / 4.1 m
    "31001_1313",  # BW, 13 m² / 3.6 m
    "31001_2112",  # BW, 96 m² / 5.9 m
    "31001_2120",  # BW, 71 m² / 5.6 m
    "31001_2130",  # BW, 154 m² / 4.0 m
    "31001_2140",  # BW, 33 m² / 5.6 m
    "31001_2612",  # BW, 15 m² / 3.1 m
    "31001_2721",  # BW, 70 m² / 10.5 m
    "31001_2723",  # BW, 15 m² / 3.2 m
    "31001_2724",  # BW, 20 m² / 5.0 m
    "31001_2740",  # BW, 137 m² / 3.8 m
}

#: Above this footprint or height, a "trade" building is a hall or a works rather than a shed.
#: Set above the 31–43 m² median of that group and below anything that could be commercial.
_SHED_FOOTPRINT_M2 = 120.0
_SHED_HEIGHT_M = 7.0


def wall_class(
    function_code: str,
    footprint_m2: float,
    height_m: float,
    institutional: bool = False,
) -> int:
    """Which wall treatment a building gets, from its cadastral class and its measured size.


    """
    if function_code in _WORSHIP:
        return WHITEWASH
    if function_code in _CIVIC:
        return CIVIC
    if function_code in _CONCRETE:
        return CONCRETE
    if function_code in _SHELTER:
        return UTILITY

    if function_code in _TRADE:
        # Small and low is a garage or a bin store; big is a hall or a works, and those are
        # rendered or clad rather than left as blockwork.
        small = footprint_m2 < _SHED_FOOTPRINT_M2 and height_m < _SHED_HEIGHT_M
        return UTILITY if small else RENDER

    if institutional:
        return CIVIC

    # In a city the unspecified group is dominated by ordinary urban blocks, which is what RENDER is.
    return RENDER
