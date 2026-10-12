"""Generate the building report (PBIR) that the app opens in its report window.

One step of docs/POWER-BI-EMBED.md. Generated rather than drawn by hand for the same reason the
semantic model is: `fabric/` is generator output, the report must never drift from the measures it
shows, and the next site needs the same page with other names, not a second hand-built report.

It writes the folder; `publish_report.py` sends it. Nothing here talks to Fabric.

⚠️ ONE PAGE, AND ITS NAME IS AN INTERFACE. The app addresses the page as `pageName=gebaeude` and
filters it with `Building/building_code eq '<code>'`. `PAGE` below and the filter column are what
`SITE_REPORTS` in `src/config/powerbi.ts` must say; renaming either here without the app is a
report window that opens on the wrong page, or unfiltered, with nothing looking broken.

⚠️ 1280 x 720, NOT THE 1920 x 1080 OF THE FULL-PAGE TEMPLATE. This page is read inside a floating
window roughly 720 px wide. A full-size canvas scaled into that makes 8 pt text about 3 pt.

⚠️ THE PAGE SAYS WHAT IT IS SHOWING, TWICE. The title is the measure `Gebäude im Filter`, so a URL
filter that did not apply reads "Alle Gebäude (kein Gebäudefilter aktiv)" instead of passing off
campus totals as one building's. The line beside it is `Datenstand`, the load stamp, so the page
names its source and its date itself rather than relying on whoever embedded it.

⚠️ A SECOND LANGUAGE IS A SECOND REPORT ON THE SAME MODEL, WITH THE SAME PAGE NAME. `--lang en`
writes `<artefact>EN.Report` for a site that has an English report (`sites.py`). It shows the same
measures under English headers; see `LABELS`.

Usage
  python tools/fabric/build_report.py                       # base theme only
  python tools/fabric/build_report.py --theme <theme.json>  # with a custom theme file
  python tools/fabric/build_report.py --site campus-demo --lang en
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from sites import SITES, English, Site, add_language_argument, add_site_argument

ROOT = Path(__file__).resolve().parents[2]

#: Set in `main()`. The page is the same for every site; what differs is in `sites.py`.
SITE: Site = SITES["garching"]
#: The site's texts in the report's language: the site itself for German, its `English` otherwise.
TEXTS: Site | English = SITE
#: The same for both languages. The app addresses the page by this name whatever language it shows.
PAGE = "gebaeude"

#: Everything on the page that is a word, per language.
#:
#: ⚠️ THE NUMBERS ARE NOT IN HERE, ON PURPOSE. Both languages show the same measures under another
#: header (`displayName`), so a figure cannot differ between the German and the English page. Only
#: the two measures that answer in words are swapped (`title_measure`, `stamp_measure`), and the
#: weekday column. Data values such as usage types stay as the app shows them, in both languages.
LABELS: dict[str, dict[str, str]] = {
    "de": {
        "page": "Gebäude",
        "title_measure": "Gebäude im Filter",
        "stamp_measure": "Datenstand",
        "rooms": "Räume",
        "teaching_rooms": "Lehrräume",
        "area": "Fläche (m²)",
        "booked_hours": "Belegte Stunden",
        "utilisation": "Auslastung Lehrräume",
        "week_grid": "Wochenraster: Anteil belegter Räume mit Kalender",
        "hour": "Uhr",
        "day": "Tag",
        "day_column": "day_de",
        "occupancy": "Belegung",
        "room": "Raum",
        "name": "Name",
        "level": "Ebene",
        "usage": "Nutzung",
        # Empty: the header is the model's own name, 'Plätze (synthetisch)'. These seats are
        # invented, and the column header is the badge AGENTS.md asks for.
        "seats": "",
    },
    "en": {
        "page": "Building",
        "title_measure": "Building in filter",
        "stamp_measure": "Data status",
        "rooms": "Rooms",
        "teaching_rooms": "Teaching rooms",
        "area": "Area (m²)",
        "booked_hours": "Booked hours",
        "utilisation": "Utilisation, teaching rooms",
        "week_grid": "Week grid: share of rooms with a calendar that are booked",
        "hour": "Hour",
        "day": "Day",
        "day_column": "day_en",
        "occupancy": "Occupancy",
        "room": "Room",
        "name": "Name",
        "level": "Level",
        "usage": "Usage",
        "seats": "Seats (synthetic)",
    },
}
T: dict[str, str] = LABELS["de"]
WIDTH, HEIGHT = 1280, 720

SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition"
BASE_THEME = "Fluent2-CY26SU04"
VERSIONS = {"visual": "2.8.0", "report": "3.2.0", "page": "2.3.1"}

INK = "#000028"
ACCENT = "#00557C"
MUTED = "#808080"
LINE = "#C3C3C3"


def lit(value: str) -> dict:
    return {"expr": {"Literal": {"Value": value}}}


def text(value: str) -> dict:
    return lit("'" + value.replace("'", "''") + "'")


def colour(value: str) -> dict:
    return {"solid": {"color": text(value)}}


def measure_ref(name: str) -> dict:
    return {"Measure": {"Expression": {"SourceRef": {"Entity": "Measure"}}, "Property": name}}


def measure(name: str, display: str | None = None) -> dict:
    projection = {"field": measure_ref(name), "queryRef": f"Measure.{name}", "nativeQueryRef": name}
    if display:
        projection["displayName"] = display
    return projection


def column(table: str, name: str, display: str | None = None) -> dict:
    projection = {
        "field": {"Column": {"Expression": {"SourceRef": {"Entity": table}}, "Property": name}},
        "queryRef": f"{table}.{name}",
        "nativeQueryRef": name,
    }
    if display:
        projection["displayName"] = display
    return projection


def frame(title: str | None = None) -> dict:
    """The container every tile shares: white, hairline border, optional bold title."""
    container: dict = {
        "background": [{"properties": {"show": lit("true"), "color": colour("#FFFFFF"), "transparency": lit("0D")}}],
        "border": [{"properties": {"show": lit("true"), "color": colour(LINE), "radius": lit("4D")}}],
        "title": [{"properties": {"show": lit("false")}}],
    }
    if title:
        container["title"] = [
            {
                "properties": {
                    "show": lit("true"),
                    "text": text(title),
                    "fontSize": lit("10D"),
                    "bold": lit("true"),
                    "fontColor": colour(INK),
                }
            }
        ]
    return container


def bare() -> dict:
    return {
        "background": [{"properties": {"show": lit("false")}}],
        "border": [{"properties": {"show": lit("false")}}],
        "title": [{"properties": {"show": lit("false")}}],
    }


def visual(name: str, kind: str, box: tuple[int, int, int, int], z: int, *, query: dict | None = None,
           objects: dict | None = None, container: dict | None = None, sort: dict | None = None) -> tuple[str, dict]:
    # ⚠️ `name` IS AN ID AND MUST BE ASCII. The import refuses anything else with a message about
    # "unsupported characters" that does not say which visual (see publish_report.py).
    x, y, w, h = box
    body: dict = {"visualType": kind, "drillFilterOtherVisuals": True}
    if query is not None:
        body["query"] = {"queryState": query}
        if sort:
            body["query"]["sortDefinition"] = sort
    if objects:
        body["objects"] = objects
    if container:
        body["visualContainerObjects"] = container
    return name, {
        "$schema": f"{SCHEMA}/visualContainer/2.8.0/schema.json",
        "name": name,
        "position": {"x": x, "y": y, "z": z, "height": h, "width": w, "tabOrder": z},
        "visual": body,
    }


def text_card(name: str, measure_name: str, box: tuple[int, int, int, int], z: int, size: int, tint: str,
              bold: bool) -> tuple[str, dict]:
    """A measure that returns text, shown as a line of the page rather than as a tile."""
    objects = {
        "labels": [
            {
                "properties": {
                    "fontSize": lit(f"{size}D"),
                    "color": colour(tint),
                    "bold": lit("true" if bold else "false"),
                }
            }
        ],
        "categoryLabels": [{"properties": {"show": lit("false")}}],
        "wordWrap": [{"properties": {"show": lit("true")}}],
    }
    return visual(name, "card", box, z, query={"Values": {"projections": [measure(measure_name)]}},
                  objects=objects, container=bare())


def kpi(name: str, measure_name: str, display: str, box: tuple[int, int, int, int], z: int) -> tuple[str, dict]:
    objects = {
        "labels": [{"properties": {"fontSize": lit("22D"), "color": colour(ACCENT), "labelDisplayUnits": lit("1D")}}],
        "categoryLabels": [{"properties": {"show": lit("true"), "fontSize": lit("10D"), "color": colour(INK)}}],
    }
    return visual(name, "card", box, z, query={"Values": {"projections": [measure(measure_name, display)]}},
                  objects=objects, container=frame())


def week_grid(box: tuple[int, int, int, int], z: int) -> tuple[str, dict]:
    share = "Belegung im Zeitfenster %"
    # ⚠️ COLOUR BY A MEASURE, NOT BY A GRADIENT RULE. A min-max gradient rescales per building, so
    # the darkest cell of a nearly empty building looks like the darkest cell of a full one. The
    # measure `Belegung Farbe` uses fixed steps, and returns grey for "no calendar" instead of
    # putting unknown on the same scale as empty.
    cells = {"data": [{"dataViewWildcard": {"matchingOption": 1}}], "metadata": f"Measure.{share}"}
    objects = {
        "values": [
            {"properties": {"fontSize": lit("9D")}},
            {
                "properties": {
                    "backColor": {"solid": {"color": {"expr": measure_ref("Belegung Farbe")}}},
                    "fontColor": {"solid": {"color": {"expr": measure_ref("Belegung Schriftfarbe")}}},
                },
                "selector": cells,
            },
        ],
        "columnHeaders": [
            {"properties": {"fontSize": lit("9D"), "bold": lit("true"), "autoSizeColumnWidth": lit("false")}}
        ],
        "rowHeaders": [{"properties": {"fontSize": lit("9D")}}],
        "subTotals": [{"properties": {"rowSubtotals": lit("false"), "columnSubtotals": lit("false")}}],
        # Fixed widths and some row padding, so five days and fourteen hours fill the tile instead
        # of huddling in its corner at whatever width the longest weekday name needs.
        "columnWidth": [
            {"properties": {"value": lit("86D")}, "selector": {"metadata": f"Measure.{share}"}},
            {"properties": {"value": lit("52D")}, "selector": {"metadata": "Time Slot.hour"}},
        ],
        "grid": [{"properties": {"rowPadding": lit("6D")}}],
    }
    query = {
        "Rows": {"projections": [column("Time Slot", "hour", T["hour"])]},
        "Columns": {"projections": [column("Time Slot", T["day_column"], T["day"])]},
        "Values": {"projections": [measure(share, T["occupancy"])]},
    }
    return visual("weekgrid", "pivotTable", box, z, query=query, objects=objects,
                  container=frame(T["week_grid"]))


def room_table(box: tuple[int, int, int, int], z: int) -> tuple[str, dict]:
    hours = "Belegte Stunden (Kalender)"
    # ⚠️ WIDTHS ARE SET, NOT LEFT TO AUTO-SIZE. Room names here are long ("Besprechungsraum
    # Fachschaft Mathe Physik Informatik Chemie / MPIC"), and auto-size gives the name column
    # everything, pushing area, seats and booked hours out of a 700 px tile behind a scrollbar.
    widths = {
        "Room.room_code": 92, "Room.room_name": 168, "Room.level": 54, "Room.usage": 104,
        "Measure.Fläche m2": 64, "Measure.Plätze (synthetisch)": 84, f"Measure.{hours}": 72,
    }
    if not SITE.room_names:
        # No names to show: the usage column takes the room, which is what tells rooms apart there.
        del widths["Room.room_name"]
        widths["Room.room_code"], widths["Room.usage"] = 120, 244
    objects = {
        "columnHeaders": [
            {
                "properties": {
                    "fontSize": lit("9D"),
                    "bold": lit("true"),
                    "wordWrap": lit("true"),
                    "autoSizeColumnWidth": lit("false"),
                }
            }
        ],
        "values": [{"properties": {"fontSize": lit("9D"), "wordWrap": lit("false")}}],
        "total": [{"properties": {"totals": lit("false")}}],
        "columnWidth": [
            {"properties": {"value": lit(f"{width}D")}, "selector": {"metadata": ref}} for ref, width in widths.items()
        ],
    }
    query = {
        "Values": {
            "projections": [
                column("Room", "room_code", T["room"]),
                *([column("Room", "room_name", T["name"])] if SITE.room_names else []),
                column("Room", "level", T["level"]),
                column("Room", "usage", T["usage"]),
                measure("Fläche m2", T["area"]),
                # The model's own name stays visible: these seats are invented, and the column
                # header is the badge AGENTS.md asks for.
                measure("Plätze (synthetisch)", T["seats"]),
                measure(hours, T["booked_hours"]),
            ]
        }
    }
    sort = {"sort": [{"field": measure_ref(hours), "direction": "Descending"}], "isDefaultSort": True}
    return visual("roomtable", "tableEx", box, z, query=query, objects=objects, sort=sort,
                  container=frame(T["rooms"]))


def footnote(box: tuple[int, int, int, int], z: int) -> tuple[str, dict]:
    paragraphs = [{"textRuns": [{"value": TEXTS.footnote, "textStyle": {"fontSize": "8pt", "color": MUTED}}]}]
    return visual("footnote", "textbox", box, z, objects={"general": [{"properties": {"paragraphs": paragraphs}}]},
                  container=bare())


def page_visuals() -> list[tuple[str, dict]]:
    kpis = [
        ("kpirooms", "Räume", T["rooms"]),
        ("kpiteaching", "Lehrräume im Filter", T["teaching_rooms"]),
        ("kpiarea", "Fläche m2", T["area"]),
        ("kpihours", "Belegte Stunden (Kalender)", T["booked_hours"]),
        ("kpiutilisation", "Zeitliche Auslastung Lehrräume %", T["utilisation"]),
    ]
    tile, gap = 236, 15
    visuals = [
        # Tall enough for a descender: at 46 px the "g" of "Building" lost its lower half, which the
        # German title ("Gebäude") has no letter to show. It ends 2 px above the tile row.
        text_card("pagetitle", T["title_measure"], (20, 4, 520, 58), 1000, 18, INK, True),
        # ⚠️ A GENERATED SITE SAYS SO IN INK, NOT IN GREY. On a real site the stamp is a source
        # note; on a generated one it is the badge that keeps every number on the page from being
        # read as a university's own, and a badge nobody notices is not one.
        text_card("datastamp", T["stamp_measure"], (560, 6, 700, 52), 1010, 9,
                  INK if SITE.fixed_semantics == "synthetic" else MUTED, SITE.fixed_semantics == "synthetic"),
    ]
    for index, (name, measure_name, display) in enumerate(kpis):
        visuals.append(kpi(name, measure_name, display, (20 + index * (tile + gap), 64, tile, 100), 1020 + index * 10))
    visuals.append(week_grid((20, 176, 520, 500), 1100))
    visuals.append(room_table((555, 176, 705, 500), 1110))
    visuals.append(footnote((20, 682, 1240, 30), 1120))
    return visuals


def build(theme: Path | None) -> dict[str, bytes]:
    parts: dict[str, bytes] = {}

    def put(path: str, payload: dict) -> None:
        parts[path] = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")

    put("definition/version.json", {"$schema": f"{SCHEMA}/versionMetadata/1.0.0/schema.json", "version": "2.0.0"})

    themes: dict = {"baseTheme": {"name": BASE_THEME, "reportVersionAtImport": VERSIONS, "type": "SharedResources"}}
    packages: list[dict] = [
        {
            "name": "SharedResources",
            "type": "SharedResources",
            "items": [{"name": BASE_THEME, "path": f"BaseThemes/{BASE_THEME}.json", "type": "BaseTheme"}],
        }
    ]
    if theme:
        # Registered under its own file name, which is how the service looks it up again.
        themes["customTheme"] = {"name": theme.name, "reportVersionAtImport": VERSIONS, "type": "RegisteredResources"}
        packages.append(
            {
                "name": "RegisteredResources",
                "type": "RegisteredResources",
                "items": [{"name": theme.name, "path": theme.name, "type": "CustomTheme"}],
            }
        )
        parts[f"StaticResources/RegisteredResources/{theme.name}"] = theme.read_bytes()
    put("definition/report.json", {
        "$schema": f"{SCHEMA}/report/3.2.0/schema.json",
        "themeCollection": themes,
        "resourcePackages": packages,
    })

    put("definition/pages/pages.json", {
        "$schema": f"{SCHEMA}/pagesMetadata/1.0.0/schema.json",
        "pageOrder": [PAGE],
        "activePageName": PAGE,
    })
    put(f"definition/pages/{PAGE}/page.json", {
        "$schema": f"{SCHEMA}/page/2.1.0/schema.json",
        "name": PAGE,
        "displayName": T["page"],
        "displayOption": "FitToPage",
        "height": HEIGHT,
        "width": WIDTH,
        "objects": {"background": [{"properties": {"color": colour("#F5F5F5"), "transparency": lit("0D")}}]},
    })
    for name, payload in page_visuals():
        put(f"definition/pages/{PAGE}/visuals/{name}/visual.json", payload)
    return parts


def select(site: str, lang: str) -> Path:
    """Point the generator at one site's report in one language; returns the folder it writes."""
    global SITE, TEXTS, T
    # Everything that can refuse comes first, so a refusal leaves the generator where it was and
    # not pointed at one site with another site's texts.
    texts = SITES[site].in_language(lang)
    target = SITES[site].report_dir_in(lang)
    SITE, TEXTS, T = SITES[site], texts, LABELS[lang]
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate one site's building report as a PBIR folder.")
    add_site_argument(parser)
    add_language_argument(parser)
    parser.add_argument("--theme", type=Path, help="a Power BI theme JSON to register as the custom theme")
    args = parser.parse_args()
    if args.theme and not args.theme.is_file():
        raise SystemExit(f"theme file not found: {args.theme}")
    OUT = select(args.site, args.lang)

    parts = build(args.theme)
    # Rebuilt from nothing each time, so a visual removed from this script is removed from the folder.
    if OUT.exists():
        shutil.rmtree(OUT)
    for path, raw in parts.items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    print(f"wrote {len(parts)} parts to {OUT.relative_to(ROOT)}")
    print(f"publish: python tools/fabric/publish_report.py --site {SITE.key}" + ("" if args.lang == "de" else f" --lang {args.lang}"))
    print(f"embed  : pageName={PAGE}, filter Building/building_code")


if __name__ == "__main__":
    main()
