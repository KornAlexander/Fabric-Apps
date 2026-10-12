"""Generate and publish the Direct Lake semantic model.

PLAN Phase 4. This is what turns a 3D map into a platform demo: the same rooms and bookings the
app draws become a model anyone can query with DAX, build a report on, or ask a question of in
natural language.

The TMDL is generated rather than hand-written so the model cannot drift from the tables — the
column list comes from the same place the Delta writer used.

⚠️ **Two things fail silently if you get them wrong, and both are handled here.**

1. `entityName` in a partition must be the DELTA table name (`room_hour`), not the model's
   display name (`'Room Hour'`). TMDL accepts either at deploy time; the wrong one fails at query
   time with "cannot find table".
2. A freshly deployed Direct Lake model must be REFRAMED before it will answer anything. Without
   it every query fails even though the deployment reported success.

Usage
  python tools/fabric/build_semantic_model.py
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from fabric_ids import folder_id, lakehouse_id, tenant_id, workspace_id
from sites import SITES, add_site_argument, expect_lakehouse

_parser = argparse.ArgumentParser(description="Generate and publish one site's Direct Lake semantic model.")
add_site_argument(_parser)
_parser.add_argument("--write-only", action="store_true",
                     help="write the TMDL to fabric/ and stop: nothing is published or reframed")
ARGS = _parser.parse_args()
SITE = SITES[ARGS.site]
OUT = SITE.model_dir

WORKSPACE_ID = workspace_id()
LAKEHOUSE_ID = lakehouse_id()
MODEL_NAME = SITE.model_name
EXPRESSION = "DirectLake - campus_lh"

AZ = shutil.which("az") or "az"

#: The site's teaching week, read from the same rooms file the loader reads.
#:
#: ⚠️ THIS WAS THE CONSTANT 70, AND 70 IS GARCHING'S WEEK (Monday to Friday, 07:00 to 20:59). The
#: demo site's week is 60 hours (08:00 to 19:59). Every utilisation measure divides by this number,
#: so the wrong one does not fail: it reports every room about 14 % emptier than the app does.
if not (SITE.terrain / "rooms.json").exists():
    raise SystemExit(f"{SITE.terrain / 'rooms.json'} not found: run tools/geodata/build_rooms.py for {SITE.aoi} first")
_GRID = json.loads((SITE.terrain / "rooms.json").read_text(encoding="utf-8"))["occupancyGrid"]
WEEK_SLOTS = int(_GRID["slots"])
FIRST_HOUR = int(_GRID["firstHour"])
LAST_HOUR = FIRST_HOUR + int(_GRID["hours"]) - 1
WEEK_HOURS = f"Mo-Fr, {FIRST_HOUR:02d}:00-{LAST_HOUR:02d}:59"

#: Deterministic lineage tags, so republishing does not churn the definition.
NAMESPACE = uuid.UUID("6f1d1c4e-9f1a-4b7c-9c0e-2f7a5a1b8d33")


def tag(name: str) -> str:
    return str(uuid.uuid5(NAMESPACE, name))


def token(resource: str) -> str:
    command = [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"]
    if tenant_id():
        command += ["--tenant", tenant_id()]
    out = subprocess.run(command, capture_output=True, text=True, check=True)  # noqa: S603
    return out.stdout.strip()


# ── The model, as data ──────────────────────────────────────────────────────────────────
# (display name, delta table, [(column, dataType, summarizeBy, description)])
TABLES: list[tuple[str, str, list[tuple[str, str, str, str]]]] = [
    (
        "Building",
        "building",
        [
            ("building_code", "string", "none", "Official TUM Gebäudekennung."),
            ("room_count", "int64", "sum", "Rooms mapped indoors in OpenStreetMap."),
            ("area_m2", "double", "sum", "Sum of room floor areas. Derived from the polygons."),
            ("level_count", "int64", "none", "Storeys with at least one mapped room."),
            ("rooms_with_calendar", "int64", "sum", "Rooms TUMonline publishes a calendar for."),
        ],
    ),
    (
        "Room",
        "room",
        [
            ("room_code", "string", "none", "Official TUM Raumkennung, e.g. 5606.EG.041."),
            ("building_code", "string", "none", "Gebäudekennung this room belongs to."),
            ("level", "int64", "none", "Storey. 0 is ground level, negative is below it."),
            ("usage", "string", "none", "Controlled usage type from NavigaTUM."),
            ("category", "string", "none", "teaching, service or other."),
            ("room_name", "string", "none", "Room name where TUMonline publishes one."),
            ("area_m2", "double", "sum", "Floor area, computed from the surveyed outline."),
            (
                "seats_synthetic",
                "int64",
                "sum",
                "⚠️ SYNTHETIC. Floor area divided by a planning density — seat counts are not "
                "published. Every figure derived from this is synthetic too.",
            ),
            ("has_calendar", "boolean", "none", "Whether TUMonline publishes bookings for it."),
        ],
    ),
    (
        "Usage Type",
        "usage_type",
        [
            ("usage", "string", "none", "Controlled usage type from NavigaTUM."),
            ("category", "string", "none", "teaching, service or other."),
        ],
    ),
    (
        "Time Slot",
        "time_slot",
        [
            ("slot", "int64", "none",
             f"0-{WEEK_SLOTS - 1}: Monday {FIRST_HOUR:02d}:00 through Friday {LAST_HOUR:02d}:00."),
            ("weekday", "int64", "none", "0 = Monday."),
            ("day_de", "string", "none", "Wochentag."),
            ("day_en", "string", "none", "Weekday."),
            ("hour", "int64", "none", f"Hour of day, {FIRST_HOUR}-{LAST_HOUR}."),
            ("label", "string", "none", "Short label, e.g. 'Di 10:00'."),
        ],
    ),
    (
        "Room Hour",
        "room_hour",
        [
            ("room_code", "string", "none", "Raumkennung."),
            ("slot", "int64", "none", "Hour of the teaching week."),
            (
                "weeks_booked",
                "int64",
                "sum",
                "Distinct semester weeks in which this hour carried a booking. A room used every "
                "week reads high; one used twice does not.",
            ),
        ],
    ),
    (
        "Course",
        "course",
        [
            ("room_code", "string", "none", "Raumkennung."),
            ("title", "string", "none", "Course title as TUMonline publishes it."),
            ("bookings", "int64", "sum", "Bookings this course made in this room."),
        ],
    ),
    (
        # ⚠️ ONE ROW, NO RELATIONSHIPS, AND THAT IS THE DESIGN. It describes the load as a whole,
        # so no building or time filter may change what it says. See build_lakehouse_tables.py.
        "Data Load",
        "data_load",
        [
            ("aoi", "string", "none", "The site this load is made of."),
            ("semantics", "string", "none", "navigatum (real bookings) or synthetic."),
            ("source_label", "string", "none", "What a report may call this load, in German."),
            ("semester", "string", "none", "Reference semester of the bookings."),
            ("source_sha256", "string", "none", "Hash of the rooms file that was loaded."),
            ("loaded_at_utc", "string", "none", "When the load ran, ISO 8601 UTC."),
            ("loaded_on", "string", "none", "The same moment as a German date, for display."),
        ],
    ),
]

if SITE.english:
    # ⚠️ ONLY FOR A SITE WITH AN ENGLISH REPORT, AND ITS LAKEHOUSE MUST HAVE BEEN RELOADED FIRST. The
    # loader writes these three columns under the same condition. On a site without them the model
    # must not name them: a Direct Lake table that lists a column its Delta table lacks fails to
    # reframe, and then the German report stops answering too.
    next(columns for display, _, columns in TABLES if display == "Data Load").extend(
        [
            ("source_label_en", "string", "none", "What a report may call this load, in English."),
            ("semester_en", "string", "none", "Reference semester of the bookings, in English."),
            ("loaded_on_en", "string", "none", "When the load ran, as an English date, for display."),
        ]
    )

#: (table, column) -> the column it sorts by. Without it Power BI orders weekdays alphabetically,
#: and a week that runs Dienstag, Donnerstag, Freitag, Mittwoch, Montag reads as a broken chart.
SORT_BY = {
    ("Time Slot", "day_de"): "weekday",
    ("Time Slot", "day_en"): "weekday",
    ("Time Slot", "label"): "slot",
}

RELATIONSHIPS = [
    ("Building", "building_code", "Room", "building_code"),
    ("Room", "room_code", "Room Hour", "room_code"),
    ("Time Slot", "slot", "Room Hour", "slot"),
    ("Usage Type", "usage", "Room", "usage"),
    ("Room", "room_code", "Course", "room_code"),
]

# (name, expression, formatString, description)
MEASURES: list[tuple[str, str, str, str]] = [
    ("Räume", "COUNTROWS('Room')", "#,0", "Rooms mapped indoors and joined to a usage type."),
    ("Gebäude", "COUNTROWS('Building')", "#,0", "Buildings with indoor mapping."),
    (
        "Räume mit Kalender",
        "CALCULATE(COUNTROWS('Room'), 'Room'[has_calendar] = TRUE())",
        "#,0",
        "Rooms TUMonline publishes bookings for. The rest are unknown, not empty.",
    ),
    ("Lehrräume", "CALCULATE(COUNTROWS('Room'), 'Room'[category] = \"teaching\")", "#,0",
     "Hörsäle, Seminarräume, Übungsräume and the like."),
    ("Fläche m2", "SUM('Room'[area_m2])", "#,0", "Floor area, computed from surveyed outlines."),
    (
        "Lehrfläche m2",
        "CALCULATE(SUM('Room'[area_m2]), 'Room'[category] = \"teaching\")",
        "#,0",
        "Floor area of teaching space.",
    ),
    (
        "Plätze (synthetisch)",
        "SUM('Room'[seats_synthetic])",
        "#,0",
        "⚠️ SYNTHETIC. Seat counts are not published anywhere; these are floor area divided by a "
        "planning density. Shown only where it is labelled as such.",
    ),
    (
        "m2 je Platz",
        "DIVIDE([Fläche m2], [Plätze (synthetisch)])",
        "#,0.0",
        "⚠️ Partly synthetic — the numerator is measured, the denominator is not.",
    ),
    (
        "Belegte Stunden",
        "COUNTROWS('Room Hour')",
        "#,0",
        "Hours of the teaching week that carried at least one booking, summed over rooms.",
    ),
    (
        "Verfügbare Stunden",
        f"[Räume mit Kalender] * {WEEK_SLOTS}",
        "#,0",
        f"{WEEK_SLOTS} hours per week ({WEEK_HOURS}) for every room with a calendar.",
    ),
    (
        "Zeitliche Auslastung %",
        # ⚠️ AVERAGEX per room, NOT total booked / total available. The app averages each room's
        # own utilisation, and a sum-over-sum would quietly weight big rooms more heavily and
        # disagree with it. This is the measure the agreement gate checks.
        #
        # ⚠️ COALESCE is load-bearing. 'Room Hour' is sparse — a room that was never booked has no
        # rows at all — so COUNTROWS returns BLANK, DIVIDE returns BLANK, and AVERAGEX *skips*
        # blanks rather than treating them as zero. Without it the average silently runs over only
        # the rooms that were booked, which is how this measure read 53.8 % when the honest figure
        # across all 310 calendared rooms is 30.5 %. The 134 never-booked rooms are the finding,
        # not noise to be excluded.
        "AVERAGEX(\n"
        "                    FILTER('Room', 'Room'[has_calendar] = TRUE()),\n"
        f"                    DIVIDE(COALESCE(CALCULATE(COUNTROWS('Room Hour')), 0), {WEEK_SLOTS})\n"
        "                )",
        "0.0%",
        "Share of the teaching week a room is committed, averaged over rooms with a calendar.",
    ),
    (
        "Zeitliche Auslastung Lehrräume %",
        "AVERAGEX(\n"
        "                    FILTER('Room', 'Room'[has_calendar] = TRUE() && 'Room'[category] = \"teaching\"),\n"
        f"                    DIVIDE(COALESCE(CALCULATE(COUNTROWS('Room Hour')), 0), {WEEK_SLOTS})\n"
        "                )",
        "0.0%",
        "The same measure restricted to teaching space — what the app's building panel shows.",
    ),
    (
        "Räume ohne Belegung",
        # COUNTROWS over an empty filter returns BLANK, not 0 — so this read as "no answer" where
        # the app reads "none", and the agreement gate rejected it. A count of nothing is zero.
        "COALESCE(\n"
        "                    COUNTROWS(\n"
        "                        FILTER(\n"
        "                            FILTER('Room', 'Room'[has_calendar] = TRUE()),\n"
        "                            ISBLANK(CALCULATE(COUNTROWS('Room Hour')))\n"
        "                        )\n"
        "                    ),\n"
        "                    0\n"
        "                )",
        "#,0",
        "Rooms that publish a calendar and were never booked in the reference semester.",
    ),
    # ── For the building report (tools/fabric/build_report.py) ───────────────────────────
    (
        "Belegung im Zeitfenster %",
        # ⚠️ NOT 'Zeitliche Auslastung %' IN A HEATMAP. That measure divides each room's hours by
        # the whole 70-hour week, so inside one weekday-and-hour cell a fully booked room reads
        # 1.4 %. This one divides by the hours actually in the filter: in a cell it is the share of
        # calendared rooms booked in that hour.
        #
        # ⚠️ BLANK WITHOUT A CALENDAR, ZERO WITH ONE. No calendared room means nobody knows, and
        # the report must not say 0 %. A calendared room with no booking in the hour is a known 0.
        "VAR calendared = [Räume mit Kalender]\n"
        "                RETURN\n"
        "                    IF(\n"
        "                        calendared > 0,\n"
        "                        DIVIDE(COALESCE(COUNTROWS('Room Hour'), 0), calendared * COUNTROWS('Time Slot'))\n"
        "                    )",
        "0%",
        "Share of calendared rooms booked in the hours in the filter. Blank where no room has a calendar.",
    ),
    (
        "Belegung Farbe",
        # Fixed steps rather than a min-max gradient, so the same colour means the same thing in
        # every building. Grey is "unknown" and deliberately not on the scale.
        "VAR v = [Belegung im Zeitfenster %]\n"
        "                RETURN\n"
        "                    SWITCH(\n"
        "                        TRUE(),\n"
        '                        ISBLANK(v), "#E6E6E6",\n'
        '                        v = 0, "#FFFFFF",\n'
        '                        v <= 0.2, "#D9EEF2",\n'
        '                        v <= 0.4, "#A6D5DE",\n'
        '                        v <= 0.6, "#5FAFC0",\n'
        '                        v <= 0.8, "#1F7F99",\n'
        '                        "#00557C"\n'
        "                    )",
        "",
        "Cell colour for the week grid. Grey means no calendar, white means known and free.",
    ),
    (
        "Belegung Schriftfarbe",
        'IF([Belegung im Zeitfenster %] > 0.6, "#FFFFFF", "#000028")',
        "",
        "Text colour that stays readable on the cell colour.",
    ),
    (
        "Belegte Stunden (Kalender)",
        "IF([Räume mit Kalender] > 0, COALESCE(COUNTROWS('Room Hour'), 0))",
        "#,0",
        "Booked hours where a calendar exists: 0 for a calendared room never booked, blank for a "
        "room without a calendar. 'Belegte Stunden' cannot tell those two apart.",
    ),
    (
        "Lehrräume im Filter",
        # ⚠️ 'Lehrräume' ALONE READS A KNOWN ZERO AS UNKNOWN. COUNTROWS over nothing is BLANK, so a
        # building with fifteen rooms and no teaching room showed "(Leer)" in the report's tile:
        # the same glyph the page uses for "no calendar, nobody knows". That count is known, and it
        # is zero. Blank is kept for the case where the filter holds no rooms at all.
        "IF([Räume] > 0, COALESCE([Lehrräume], 0))",
        "#,0",
        "Teaching rooms with a known zero: 0 where the filter holds rooms and none is a teaching room, "
        "blank where it holds no rooms at all.",
    ),
    (
        "Gebäude im Filter",
        # The report is opened with a URL filter, and a filter that did not apply looks exactly
        # like a correct page: plausible totals for the whole campus. This says which it is.
        # Three answers, because "no filter" and "a filter that matches no building" are different
        # mistakes: the first is the embed address, the second is a code the model does not hold.
        "SWITCH(\n"
        "                    TRUE(),\n"
        "                    HASONEVALUE('Building'[building_code]),\n"
        "                    \"Gebäude \" & SELECTEDVALUE('Building'[building_code]),\n"
        "                    ISFILTERED('Building'[building_code]),\n"
        '                    "Gebäude nicht im Datenbestand",\n'
        '                    "Alle Gebäude (kein Gebäudefilter aktiv)"\n'
        "                )",
        "",
        "Names the one building in the filter, says when the filter matches none, or that there is no filter.",
    ),
    (
        "Datenstand",
        "\"Datenquelle: \" & MAX('Data Load'[source_label]) & \" | Semester \" & MAX('Data Load'[semester])"
        " & \" | geladen am \" & MAX('Data Load'[loaded_on])",
        "",
        "What the model was loaded from and when, from the stamp the loader writes.",
    ),
]

if SITE.english:
    # ⚠️ ONLY THE TWO MEASURES THAT RETURN TEXT EXIST TWICE. A report can rename a column header or
    # a tile by itself, but not what a measure answers, and these two answer in words. Every number
    # on the English page is the SAME measure the German page shows, so the two cannot disagree.
    # The three answers of the title are the same three, for the same reason (see 'Gebäude im Filter').
    MEASURES += [
        (
            "Building in filter",
            "SWITCH(\n"
            "                    TRUE(),\n"
            "                    HASONEVALUE('Building'[building_code]),\n"
            "                    \"Building \" & SELECTEDVALUE('Building'[building_code]),\n"
            "                    ISFILTERED('Building'[building_code]),\n"
            '                    "Building not in the data",\n'
            '                    "All buildings (no building filter active)"\n'
            "                )",
            "",
            "'Gebäude im Filter' in English, for the English report.",
        ),
        (
            "Data status",
            "\"Data source: \" & MAX('Data Load'[source_label_en]) & \" | Semester: \" & MAX('Data Load'[semester_en])"
            " & \" | loaded on \" & MAX('Data Load'[loaded_on_en])",
            "",
            "'Datenstand' in English, for the English report.",
        ),
    ]


#: What the descriptions say about a site whose data is generated, keyed by the Garching wording.
#:
#: ⚠️ THE DESCRIPTIONS ARE CLAIMS, AND THEY TRAVEL. They show up as tooltips in Power BI and are what
#: Copilot and Q&A read to decide what a column means. "Official TUM Gebäudekennung" on the demo
#: site's building codes would tell every one of them that an invented code is a real university's.
#: `wording()` refuses to generate a demo model in which any TUM claim survives.
GENERATED_WORDING = {
    # Says nothing about whether the LETTER is real: the outlines are real buildings, and which of
    # their codes are kept and which are ours differs by building. What is certain is stated.
    "Official TUM Gebäudekennung.":
        "Building code as the app shows it for this site. The institution is invented and so is "
        "everything inside the buildings; only the building outlines are real.",
    "Storeys with at least one mapped room.": "Storeys with at least one generated room.",
    "⚠️ Partly synthetic — the numerator is measured, the denominator is not.":
        "⚠️ SYNTHETIC: a generated floor area over generated seats.",
    "Rooms mapped indoors in OpenStreetMap.": "Rooms generated inside the real building outline.",
    "Sum of room floor areas. Derived from the polygons.": "Sum of room floor areas, from the generated outlines.",
    "Rooms TUMonline publishes a calendar for.": "Rooms the generated timetable uses.",
    "Official TUM Raumkennung, e.g. 5606.EG.041.": "Room code, generated, e.g. AA 001.",
    "Controlled usage type from NavigaTUM.": "Usage type, assigned by the generator.",
    "Room name where TUMonline publishes one.": "Not filled for this site.",
    "Floor area, computed from the surveyed outline.": "Floor area of the generated room outline.",
    "Whether TUMonline publishes bookings for it.": "Whether the generated timetable uses the room.",
    "Course title as TUMonline publishes it.": "Course label from the generated timetable.",
    "Rooms mapped indoors and joined to a usage type.": "Rooms generated for this site.",
    "Buildings with indoor mapping.": "Buildings with generated rooms.",
    "Rooms TUMonline publishes bookings for. The rest are unknown, not empty.":
        "Rooms the generated timetable uses. The rest are unknown, not empty.",
    "Floor area, computed from surveyed outlines.": "Floor area of the generated room outlines.",
    "Rooms that publish a calendar and were never booked in the reference semester.":
        "Rooms in the generated timetable's pool that it never uses.",
    "navigatum (real bookings) or synthetic.": "Always synthetic for this site.",
}


def wording(description: str) -> str:
    """The description as it is true for this site."""
    if SITE.fixed_semantics != "synthetic":
        return description
    text = GENERATED_WORDING.get(description, description)
    # Seats are synthetic on every site; on a generated one the sentence explaining why they are
    # the exception would itself be misleading.
    if text.startswith("⚠️ SYNTHETIC."):
        text = "⚠️ SYNTHETIC, like everything about this site's rooms."
    for claim in ("TUM", "NavigaTUM", "surveyed", "OpenStreetMap", "measured", "mapped", "Official", "publishes"):
        if claim in text:
            raise SystemExit(f"a description still claims {claim!r} for a generated site: {text!r}")
    return text


def table_tmdl(display: str, delta: str, columns: list[tuple[str, str, str, str]]) -> str:
    lines = [f"table '{display}'", f"\tlineageTag: {tag(display)}", ""]
    for name, data_type, summarize, description in columns:
        description = wording(description)
        for part in description.split("\n"):
            lines.append(f"\t/// {part}")
        lines.append(f"\tcolumn {name}")
        lines.append(f"\t\tdataType: {data_type}")
        lines.append(f"\t\tlineageTag: {tag(display + '.' + name)}")
        lines.append(f"\t\tsummarizeBy: {summarize}")
        lines.append(f"\t\tsourceColumn: {name}")
        if (display, name) in SORT_BY:
            lines.append(f"\t\tsortByColumn: {SORT_BY[(display, name)]}")
        lines.append("")
    # ⚠️ entityName is the DELTA table, not the display name.
    lines.append(f"\tpartition '{delta}' = entity")
    lines.append("\t\tmode: directLake")
    lines.append("\t\tsource")
    lines.append(f"\t\t\tentityName: {delta}")
    lines.append(f"\t\t\texpressionSource: '{EXPRESSION}'")
    lines.append("")
    return "\n".join(lines)


def measure_tmdl() -> str:
    lines = ["table 'Measure'", f"\tlineageTag: {tag('Measure')}", ""]
    # A single hidden row. Direct Lake tables cannot host measures, so the model needs one small
    # calculated table to put them on — which is also what keeps them findable in one place.
    lines.append("\tcolumn 'Value'")
    lines.append("\t\tdataType: int64")
    lines.append("\t\tisHidden")
    lines.append(f"\t\tlineageTag: {tag('Measure.Value')}")
    lines.append("\t\tsummarizeBy: none")
    lines.append("\t\tsourceColumn: [Value]")
    lines.append("")
    for name, expression, fmt, description in MEASURES:
        description = wording(description)
        for part in description.split("\n"):
            lines.append(f"\t/// {part}")
        if "\n" in expression:
            # ⚠️ Nothing after the '=' for a multi-line measure, or the deploy fails with
            # "UnsupportedObjectType - VAR is not a supported property".
            lines.append(f"\tmeasure '{name}' =")
            for part in expression.split("\n"):
                lines.append(f"\t\t\t{part.strip() if part.strip().startswith(')') else part}")
        else:
            lines.append(f"\tmeasure '{name}' = {expression}")
        if fmt:  # a text measure carries none
            lines.append(f"\t\tformatString: {fmt}")
        lines.append(f"\t\tlineageTag: {tag('measure.' + name)}")
        lines.append("")
    lines.append("\tpartition 'Measure' = calculated")
    lines.append("\t\tmode: import")
    lines.append("\t\tsource = {0}")
    lines.append("")
    return "\n".join(lines)


def build_parts() -> dict[str, str]:
    parts: dict[str, str] = {}

    parts[".platform"] = json.dumps(
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
            "metadata": {"type": "SemanticModel", "displayName": MODEL_NAME},
            # Garching keeps the id it has always had; every other site gets its own, because two
            # items sharing a logicalId are one item as far as git integration is concerned.
            "config": {"version": "2.0", "logicalId": tag("model" if SITE.key == "garching" else f"model:{SITE.key}")},
        },
        indent=2,
    )
    parts["definition.pbism"] = json.dumps(
        {"version": "4.0", "settings": {"qnaEnabled": True}}, indent=2
    )
    parts["definition/database.tmdl"] = "database\n\tcompatibilityLevel: 1605\n"
    parts["definition/model.tmdl"] = (
        "model Model\n"
        "\tculture: de-DE\n"
        + (f"\tcollation: {SITE.collation}\n" if SITE.collation else "")
        +
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3\n"
        "\tdiscourageImplicitMeasures\n"
        "\tsourceQueryCulture: de-DE\n"
        "\tdataAccessOptions\n"
        "\t\tlegacyRedirects\n"
        "\t\treturnErrorValuesAsNull\n"
        "\n"
        + "".join(f"ref table '{display}'\n" for display, _, _ in TABLES)
        + "ref table 'Measure'\n"
    )
    parts["definition/expressions.tmdl"] = (
        f"expression '{EXPRESSION}' =\n"
        "\t\tlet\n"
        f'\t\t\tSource = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/'
        f'{WORKSPACE_ID}/{LAKEHOUSE_ID}", [HierarchicalNavigation=true])\n'
        "\t\tin\n"
        "\t\t\tSource\n"
        f"\tlineageTag: {tag('expression')}\n"
        "\n"
        "\tannotation PBI_IncludeFutureArtifacts = False\n"
    )

    relationship_lines = []
    for from_table, from_col, to_table, to_col in RELATIONSHIPS:
        name = tag(f"{from_table}-{to_table}")
        relationship_lines.append(f"relationship {name}")
        relationship_lines.append(f"\tfromColumn: '{to_table}'.{to_col}")
        relationship_lines.append(f"\ttoColumn: '{from_table}'.{from_col}")
        relationship_lines.append("")
    parts["definition/relationships.tmdl"] = "\n".join(relationship_lines)

    for display, delta, columns in TABLES:
        parts[f"definition/tables/{display}.tmdl"] = table_tmdl(display, delta, columns)
    parts["definition/tables/Measure.tmdl"] = measure_tmdl()
    return parts


def publish(parts: dict[str, str]) -> str:
    fabric = token("https://api.fabric.microsoft.com")
    headers = {"Authorization": f"Bearer {fabric}", "Content-Type": "application/json"}

    # The model binds to the lakehouse in the environment. Is that this site's lakehouse?
    lakehouse = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/lakehouses/{LAKEHOUSE_ID}",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    expect_lakehouse(SITE, lakehouse["displayName"])

    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    existing = next((m for m in listing.get("value", []) if m["displayName"] == MODEL_NAME), None)

    definition = {
        "parts": [
            {
                "path": path,
                "payload": base64.b64encode(content.encode("utf-8")).decode("ascii"),
                "payloadType": "InlineBase64",
            }
            for path, content in parts.items()
        ]
    }

    if existing:
        print(f"updating existing model {existing['id']}")
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}"
            f"/semanticModels/{existing['id']}/updateDefinition"
        )
        body: dict = {"definition": definition}
    else:
        print("creating model")
        url = f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels"
        body = {"displayName": MODEL_NAME, "definition": definition}
        if folder_id():
            body["folderId"] = folder_id()

    try:
        response = urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"),
            timeout=300,
        )
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"publish failed: {exc.code}\n{exc.read().decode('utf-8', 'replace')}")

    if response.status == 202:
        location = response.headers.get("Location")
        for _ in range(60):
            time.sleep(4)
            status = json.loads(
                urllib.request.urlopen(  # noqa: S310
                    urllib.request.Request(location, headers=headers), timeout=120
                ).read()
            )
            state = status.get("status")
            if state in {"Succeeded", "Failed"}:
                if state == "Failed":
                    raise SystemExit(f"publish failed: {json.dumps(status, indent=2)}")
                break

    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    model = next(m for m in listing["value"] if m["displayName"] == MODEL_NAME)
    return model["id"]


def reframe(model_id: str) -> None:
    """Reframe a Direct Lake model so it can answer queries.

    ⚠️ Not optional and not obvious. A model that has just deployed successfully will fail every
    query with "cannot find table" until it has been reframed once.
    """
    """
    ⚠️ AND THE REQUEST BEING ACCEPTED IS NOT THE REFRAME HAVING WORKED. This used to post the
    request, sleep 20 seconds and return. On 2026-10-10 a table added to the lakehouse seconds
    earlier (`data_load`) was not yet registered there (the Delta folder existed in OneLake, the
    lakehouse's table list did not show it for about two minutes), and the reframe failed with
    "source tables either do not exist or access was denied". The script printed "reframe
    requested" and exited 0, leaving a model whose new table and every measure over it failed at
    query time. So the outcome is read back, and a failure is retried while discovery catches up.
    """
    powerbi = token("https://analysis.windows.net/powerbi/api")
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE_ID}/datasets/{model_id}/refreshes"
    headers = {"Authorization": f"Bearer {powerbi}", "Content-Type": "application/json"}

    def newest_id() -> str | None:
        raw = urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(f"{url}?$top=1", headers=headers), timeout=120
        ).read()
        return ((json.loads(raw).get("value") or [{}])[0]).get("requestId")

    def latest(before: str | None) -> dict:
        # ⚠️ ONLY A REFRESH THAT WAS NOT THERE BEFORE THE REQUEST COUNTS. The history's newest
        # entry, read a few seconds after asking, can still be the PREVIOUS refresh, and that one
        # is usually "Completed". Taking it at its word reports success for a run that has not
        # started.
        raw = urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(f"{url}?$top=1", headers=headers), timeout=120
        ).read()
        entry = (json.loads(raw).get("value") or [{}])[0]
        return entry if entry.get("requestId") and entry.get("requestId") != before else {"status": "Unknown"}

    attempts = 6
    for attempt in range(1, attempts + 1):
        previous = newest_id()
        try:
            urllib.request.urlopen(  # noqa: S310
                urllib.request.Request(url, data=b'{"type":"full"}', headers=headers, method="POST"),
                timeout=120,
            )
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"reframe request refused: {exc.code} {exc.read().decode('utf-8', 'replace')[:300]}")

        status: dict = {}
        for _ in range(45):  # a reframe is seconds; six minutes is a hung service, not a slow one
            time.sleep(8)
            status = latest(previous)
            if status.get("status") != "Unknown":
                break
        if status.get("status") == "Completed":
            print(f"  reframed (attempt {attempt})")
            return
        reason = str(status.get("serviceExceptionJson") or status.get("status"))[:300]
        if attempt == attempts:
            raise SystemExit(f"reframe failed {attempts} times, the model cannot answer queries:\n{reason}")
        print(f"  reframe attempt {attempt} failed, retrying in 45 s (a new table can take minutes to register)")
        time.sleep(45)


def require_collation(model_id: str) -> None:
    """Ask the model itself whether it tells `a` from `A`, where the site needs it to.

    ⚠️ A COLLATION ONLY TAKES EFFECT WHEN THE MODEL IS CREATED. Sending the property with an update
    of a model that was created without it changes nothing that this script can see: the update
    succeeds, and the model goes on merging `AA` and `aa`. So the definition is not trusted. One
    DAX comparison says how the model really compares text.
    """
    if not SITE.collation:
        return
    # ⚠️ NOT `"a" = "A"`. That comparison is true in BOTH kinds of model: measured on 2026-10-10, the
    # formula engine compares two literals without regard to case whatever the collation is, while
    # the storage engine, which is what holds keys and applies report filters, does respect it. The
    # first version of this probe therefore refused a model that was working correctly. Counting the
    # distinct values of {"a", "A"} asks the part of the engine that matters: 1 without, 2 with.
    probe = 'EVALUATE ROW("distinct", COUNTROWS(DISTINCT(UNION(ROW("x", "a"), ROW("x", "A")))))'
    powerbi = token("https://analysis.windows.net/powerbi/api")
    body = json.dumps({"queries": [{"query": probe}]}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE_ID}/datasets/{model_id}/executeQueries",
        data=body,
        headers={"Authorization": f"Bearer {powerbi}", "Content-Type": "application/json"},
        method="POST",
    )
    rows = json.loads(urllib.request.urlopen(request, timeout=180).read())["results"][0]["tables"][0]["rows"]  # noqa: S310
    if list(rows[0].values())[0] != 2:
        raise SystemExit(
            f"the model {MODEL_NAME!r} ignores letter case, but {SITE.label} has codes that differ only by case.\n"
            "It was created without the collation. Delete the model and its report in the workspace and run this "
            "script again: the collation can only be set at creation."
        )
    print("  the model compares text with regard to case, as this site needs")


def main() -> None:
    parts = build_parts()

    # Written to disk as well as published: the model belongs in the repository, where it can be
    # reviewed and diffed like anything else.
    for path, content in parts.items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    print(f"wrote {len(parts)} TMDL parts to {OUT.relative_to(ROOT)}")
    if ARGS.write_only:
        return

    model_id = publish(parts)
    print(f"model id: {model_id}")
    reframe(model_id)
    require_collation(model_id)
    print(f"\nOpen it: https://app.fabric.microsoft.com/groups/{WORKSPACE_ID}/datasets/{model_id}")


if __name__ == "__main__":
    main()
