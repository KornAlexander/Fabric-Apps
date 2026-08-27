"""Generate the Flut-Insights PBIR report (3 pages, PLAN §10.2).

Everything is written as UTF-8 JSON directly — deliberately NOT via
`pbir add visual --from-json`, which double-encodes UTF-8 and would corrupt
every German measure reference in this report.
"""

import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = REPO / "fabric" / "Flut-Insights.Report"
ASSETS = HERE / "assets"

WORKSPACE = "Rayfin Apps"
MODEL_NAME = "Flut-Insights — Portfolio & Schaden"
MODEL_ID = "<your-report-id>"

IBCS_BAR = "ibcsMultiTierBarECA4F65BFFB141198B7A6391AFFC946A"

# --- palette: a flood reckoning, not a sales dashboard ----------------------
INK = "#12212E"        # header / deep slate
PAPER = "#F2EFEA"      # page background
WATER = "#2E6F8E"      # the river
LOSS = "#A8443A"       # uncovered loss
MUTED = "#7A8590"

V_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.10.0/schema.json"
V_SCHEMA_28 = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.8.0/schema.json"

PAGE_W, PAGE_H = 1280, 720
HEADER_H = 52
ROW1_Y, ROW1_H = 152, 262
ROW2_Y, ROW2_H = 422, 232
NOTE_Y, NOTE_H = 660, 54
KPI_Y, KPI_H = 60, 84


# --- tiny expression helpers ------------------------------------------------
def lit(value: str) -> dict:
    return {"expr": {"Literal": {"Value": value}}}


def s_lit(text: str) -> dict:
    return lit(f"'{text}'")


def colour(hex_code: str) -> dict:
    return {"solid": {"color": {"expr": {"Literal": {"Value": f"'{hex_code}'"}}}}}


def measure(name: str) -> dict:
    return {
        "field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Measure"}}, "Property": name}},
        "queryRef": f"Measure.{name}",
        "nativeQueryRef": name,
    }


def column(entity: str, prop: str, active: bool = True) -> dict:
    proj = {
        "field": {"Column": {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}},
        "queryRef": f"{entity}.{prop}",
        "nativeQueryRef": prop,
    }
    if active:
        proj["active"] = True
    return proj


def title_objects(text: str, *, size: int = 13, colour_hex: str = INK) -> dict:
    """Title + the mandatory subTitle kill switch (auto-subtitles add a scrollbar)."""
    return {
        "title": [{"properties": {
            "text": s_lit(text),
            "show": lit("true"),
            "fontSize": s_lit(str(size)),
            "fontColor": colour(colour_hex),
            "fontFamily": s_lit("Segoe UI Semibold"),
        }}],
        "subTitle": [{"properties": {"show": lit("false")}}],
        "background": [{"properties": {"show": lit("true"), "color": colour("#FFFFFF")}}],
        "border": [{"properties": {"show": lit("true"), "color": colour("#E2DED7"), "radius": lit("4D")}}],
    }


# --- visual builders --------------------------------------------------------
def container(name, x, y, w, h, z, body, schema=V_SCHEMA) -> dict:
    return {
        "$schema": schema,
        "name": name,
        "position": {"x": x, "y": y, "z": z, "height": h, "width": w, "tabOrder": z},
        "visual": body,
    }


def header_shape(name):
    return container(name, 0, 0, PAGE_W, HEADER_H, 100, {
        "visualType": "shape",
        "objects": {
            "shape": [{"properties": {"tileShape": s_lit("rectangle")}}],
            "fill": [
                {"properties": {"show": lit("true")}},
                {"properties": {"fillColor": colour(INK)}, "selector": {"id": "default"}},
            ],
        },
        "visualContainerObjects": {"general": [{"properties": {"keepLayerOrder": lit("true")}}]},
        "drillFilterOtherVisuals": True,
    }, schema=V_SCHEMA_28)


def run(text, size="9pt", colour_hex=INK, bold=False, italic=False):
    style = {"fontFamily": "Segoe UI", "fontSize": size, "color": colour_hex}
    if bold:
        style["fontWeight"] = "bold"
    if italic:
        style["fontStyle"] = "italic"
    return {"value": text, "textStyle": style}


def textbox(name, x, y, w, h, paragraphs, z=200, align="left"):
    return container(name, x, y, w, h, z, {
        "visualType": "textbox",
        "objects": {"general": [{"properties": {"paragraphs": [
            {"horizontalTextAlignment": align, "textRuns": p} for p in paragraphs
        ]}}]},
        "drillFilterOtherVisuals": True,
    }, schema=V_SCHEMA_28)


def page_title(name, text):
    return textbox(name, 24, 6, 380, 40, [[run(text, "15pt", "#FFFFFF", bold=True)]])


def navigator(name):
    def state(sid, fill):
        return {"properties": {"show": lit("true"), "fillColor": colour(fill)}, "selector": {"id": sid}}

    return container(name, 420, 5, 620, 42, 9001, {
        "visualType": "pageNavigator",
        "objects": {
            "layout": [{"properties": {"cellPadding": lit("2L")}}],
            "outline": [
                {"properties": {"show": lit("false"), "weight": lit("0L")}, "selector": {"id": sid}}
                for sid in ("default", "selected", "hover", "press")
            ],
            "fill": [state("default", INK), state("selected", WATER), state("hover", "#1D3646")],
            "text": [
                {"properties": {"fontFamily": s_lit("Segoe UI"), "fontSize": s_lit("10")}},
                {"properties": {"fontColor": colour("#FFFFFF")}, "selector": {"id": "default"}},
                {"properties": {"fontColor": colour("#FFFFFF")}, "selector": {"id": "selected"}},
            ],
        },
        "drillFilterOtherVisuals": True,
    })


def kpi_card(name, x, y, w, h, entries, display_units="0D", precision=None):
    value_props = {
        "fontSize": s_lit("20"),
        "fontFamily": s_lit("Segoe UI Semibold"),
        "fontColor": colour(INK),
        "labelDisplayUnits": lit(display_units),
    }
    if precision is not None:
        value_props["labelPrecision"] = lit(f"{precision}D")
    return container(name, x, y, w, h, 300, {
        "visualType": "cardVisual",
        "query": {"queryState": {"Data": {"projections": [
            dict(measure(m), displayName=label) for m, label in entries
        ]}}},
        "objects": {
            "value": [{"properties": value_props, "selector": {"id": "default"}}],
            "label": [{"properties": {
                "fontSize": s_lit("9"),
                "fontColor": colour(MUTED),
            }, "selector": {"id": "default"}}],
        },
        "visualContainerObjects": {
            "title": [{"properties": {"show": lit("false")}}],
            "subTitle": [{"properties": {"show": lit("false")}}],
            "background": [{"properties": {"show": lit("true"), "color": colour("#FFFFFF")}}],
            "border": [{"properties": {"show": lit("true"), "color": colour("#E2DED7"), "radius": lit("4D")}}],
        },
        "drillFilterOtherVisuals": True,
    })


def ibcs_bar(name, x, y, w, h, *, title, cat_entity, cat_prop, actual, reference,
             scenario="PL", sort_by="actual", sort_dir="desc", decimals=0,
             max_categories=None):
    """IBCS multi-tier bar. actual/reference MUST be absolute measures — the visual
    renders a percentage measure as a flat 1. It also cannot scale its own axis,
    so money measures must already be expressed in the unit named in the title.

    `max_categories` matters once a category has more members than the height can seat.
    The valley went from 3 named places to 20, and without a cap the visual drew a partial
    final row that looked like a rendering fault rather than a list continuing. Measured on
    the deployed report: about five rows fit in 234 px and six in 262 px, title included.
    Whenever this is set the title must say the list is topped — a silent truncation of
    twenty villages to five is a worse bug than the clipped row it fixes.
    """
    general = {
        "scenario": s_lit(scenario),
        "showAbsoluteTier": lit("true"),
        "showPercentTier": lit("true"),
        "sortBy": s_lit(sort_by),
        "sortDir": s_lit(sort_dir),
        "decimals": lit(f"{decimals}D"),
        "decimalsAbs": lit(f"{decimals}D"),
        "decimalsPct": lit("0D"),
    }
    if max_categories:
        general["maxVisibleCategories"] = lit(f"{max_categories}D")
        general["enableScrollbar"] = lit("true")
    return container(name, x, y, w, h, 302, {
        "visualType": IBCS_BAR,
        "query": {
            "queryState": {
                "category": {"projections": [column(cat_entity, cat_prop)]},
                "actual": {"projections": [measure(actual)]},
                "reference": {"projections": [measure(reference)]},
            },
        },
        "objects": {"general": [{"properties": general}]},
        "visualContainerObjects": title_objects(title),
        "drillFilterOtherVisuals": True,
    })


def bar_chart(name, x, y, w, h, *, title, cat_entity, cat_prop, value,
              bar_colour=WATER, sort=None, sort_dir="Descending",
              label_units="1D", label_precision=0, categorical_axis=False):
    body = {
        "visualType": "clusteredBarChart",
        "query": {"queryState": {
            "Category": {"projections": [column(cat_entity, cat_prop)]},
            "Y": {"projections": [measure(value)]},
        }},
        "objects": {
            "dataPoint": [{"properties": {"defaultColor": colour(bar_colour)}}],
            "categoryAxis": [{"properties": {
                "show": lit("true"),
                "axisType": s_lit("Categorical" if categorical_axis else "Scalar"),
                "gridlineShow": lit("false"),
                "fontSize": s_lit("9"),
                "labelColor": colour(INK),
            }}],
            "valueAxis": [{"properties": {"show": lit("false"), "gridlineShow": lit("false")}}],
            "labels": [{"properties": {
                "show": lit("true"),
                "fontSize": s_lit("9"),
                "color": colour(INK),
                "labelDisplayUnits": lit(label_units),
                "labelPrecision": lit(f"{label_precision}D"),
            }}],
            "legend": [{"properties": {"show": lit("false")}}],
        },
        "visualContainerObjects": title_objects(title),
        "drillFilterOtherVisuals": True,
    }
    if sort is not None:
        field = column(cat_entity, cat_prop)["field"] if sort == "__category__" else measure(sort)["field"]
        body["query"]["sortDefinition"] = {"sort": [{"field": field, "direction": sort_dir}]}
    return container(name, x, y, w, h, 303, body)


def matrix(name, x, y, w, h, *, title, rows, columns, values):
    return container(name, x, y, w, h, 304, {
        "visualType": "pivotTable",
        "query": {"queryState": {
            "Rows": {"projections": [column(*rows)]},
            "Columns": {"projections": [column(*columns)]},
            "Values": {"projections": [measure(v) for v in values]},
        }},
        "objects": {
            "grid": [{"properties": {"gridVertical": lit("false"), "gridHorizontal": lit("true")}}],
            "values": [{"properties": {"fontSize": s_lit("9")}}],
            "columnHeaders": [{"properties": {"fontSize": s_lit("9")}}],
            "rowHeaders": [{"properties": {"fontSize": s_lit("9")}}],
        },
        "visualContainerObjects": title_objects(title),
        "drillFilterOtherVisuals": True,
    })


def ort_slicer(name, x, y, w, h):
    return container(name, x, y, w, h, 350, {
        "visualType": "slicer",
        "query": {"queryState": {"Values": {"projections": [column("Gebäude", "Ort")]}}},
        "objects": {
            "data": [{"properties": {"mode": s_lit("Dropdown")}}],
            "header": [{"properties": {"show": lit("false")}}],
            "items": [{"properties": {"textSize": s_lit("9"), "fontColor": colour(INK)}}],
        },
        "visualContainerObjects": {
            "title": [{"properties": {"show": lit("false")}}],
            "subTitle": [{"properties": {"show": lit("false")}}],
        },
        "syncGroup": {"groupName": "FlutOrt", "fieldChanges": True, "filterChanges": True},
        "drillFilterOtherVisuals": True,
    }, schema=V_SCHEMA_28)


# --- pages ------------------------------------------------------------------
def page_one():
    v = [
        header_shape("visP1Header"),
        page_title("visP1Title", "Betroffenheit"),
        navigator("visP1Nav"),
        kpi_card("visP1Kpis", 24, KPI_Y, 924, KPI_H, [
            ("Gebäude #", "Gebäude im Portfolio"),
            ("Gebäude überflutet #", "vom Wasser erreicht"),
            ("Ø Wassertiefe (m)", "Ø Wassertiefe in m"),
            ("Elementar-Quote %", "mit Elementarbaustein"),
        ], display_units="1D"),
        kpi_card("visP1KpiSum", 956, KPI_Y, 300, KPI_H, [
            ("Versicherungssumme Σ überflutet", "Versicherungssumme unter Wasser"),
        ], precision=2),
        ibcs_bar("visP1Hazard", 24, ROW1_Y, 608, ROW1_H,
                 title="Erreicht gegen Bestand je Gefährdungsklasse",
                 cat_entity="Gebäude", cat_prop="Gefährdungsklasse",
                 actual="Gebäude überflutet #", reference="Gebäude #",
                 sort_by="category", sort_dir="asc"),
        bar_chart("visP1Depth", 648, ROW1_Y, 608, ROW1_H,
                  title="Gebäude je Überflutungsklasse",
                  cat_entity="Gebäude", cat_prop="Überflutungsklasse",
                  value="Gebäude #", sort="Gebäude #", categorical_axis=True),
        ibcs_bar("visP1Ort", 24, ROW2_Y, 608, ROW2_H,
                 title="Erreicht gegen Bestand — die fünf am stärksten betroffenen Orte",
                 cat_entity="Gebäude", cat_prop="Ort",
                 actual="Gebäude überflutet #", reference="Gebäude #",
                 max_categories=5),
        matrix("visP1Matrix", 648, ROW2_Y, 608, ROW2_H,
               title="Vom Wasser erreicht — Ort × Gefährdungsklasse",
               rows=("Gebäude", "Ort"), columns=("Gebäude", "Gefährdungsklasse"),
               values=["Gebäude überflutet #"]),
        textbox("visP1Note", 24, NOTE_Y, 1232, NOTE_H, [[
            run("Lesehilfe:  ", bold=True),
            run("Die Gefährdungsklassen GK2–GK4 wurden aus derselben Simulation abgeleitet, die auch "
                "die Wassertiefen liefert. Dass sie hier zu 100 % überflutet sind, ist deshalb keine "
                "Bestätigung der Gefahrenkarte, sondern eine Folge der Herleitung. Aussagekräftig sind "
                "allein die GK1-Gebäude, die trotz niedriger Klasse Wasser bekamen.", colour_hex=MUTED),
        ]]),
        ort_slicer("visP1Slicer", 1054, 2, 202, 48),
    ]
    return "pagebetroffenheit", "Betroffenheit", v


def page_two():
    v = [
        header_shape("visP2Header"),
        page_title("visP2Title", "Was hätte geholfen"),
        navigator("visP2Nav"),
        kpi_card("visP2Kpis", 24, KPI_Y, 1232, KPI_H, [
            ("Schaden geschätzt Σ", "geschätzter Schaden"),
            ("Entschädigung Σ", "tatsächlich entschädigt"),
            ("Nicht gedeckt Σ", "nicht gedeckt"),
            ("Nicht gedeckt %", "Anteil nicht gedeckt"),
            ("Schaden-Kosten-Quote", "Schaden je Versicherungssumme"),
        ], precision=1),
        ibcs_bar("visP2Gap", 24, ROW1_Y, 608, ROW1_H,
                 title="Entschädigung — die sechs größten Deckungslücken (Mio. €)",
                 cat_entity="Gebäude", cat_prop="Ort",
                 actual="Entschädigung Mio €", reference="Entschädigung bei voller Deckung Mio €",
                 decimals=0, max_categories=6),
        bar_chart("visP2Reason", 648, ROW1_Y, 608, ROW1_H,
                  title="Warum das Geld nicht floss — nicht gedeckter Schaden je Grund",
                  cat_entity="Schaden", cat_prop="Deckungsgrund",
                  value="Nicht gedeckt Σ", bar_colour=LOSS, sort="Nicht gedeckt Σ",
                  label_units="1000000D", categorical_axis=True),
        bar_chart("visP2Sockel", 24, ROW2_Y, 608, ROW2_H,
                  title="Hebel Sockelhöhe: vermeidbarer Schaden je Höhe (obere Schranke)",
                  cat_entity="Sockelhöhe", cat_prop="Sockelhöhe m",
                  value="Vermeidbarer Schaden Σ (Sockel)",
                  sort="__category__", sort_dir="Ascending",
                  label_units="1000000D", categorical_axis=True),
        ibcs_bar("visP2Elem", 648, ROW2_Y, 608, ROW2_H,
                 title="Hebel Elementarbaustein: tatsächlich gegen 100 % Elementar (Mio. €)",
                 cat_entity="Gebäude", cat_prop="Gefährdungsklasse",
                 actual="Entschädigung Mio €", reference="Entschädigung bei 100 % Elementar Mio €",
                 sort_by="category", sort_dir="asc", decimals=0),
        textbox("visP2Note", 24, NOTE_Y, 1232, NOTE_H, [[
            run("Wie die Gegenrechnung entsteht:  ", bold=True),
            run("Die Kontrafaktik unterstellt keine bessere Regulierung, sondern rechnet die nicht "
                "gedeckten Schäden mit der Quote hoch, die bei gedeckten Schäden tatsächlich erreicht "
                "wurde. Der Sockel-Hebel ist eine obere Schranke: er unterstellt, dass unterhalb der "
                "Sockelhöhe gar kein Schaden entsteht — Keller und Gründung schützt eine höhere "
                "Schwelle nicht.", colour_hex=MUTED),
        ]]),
        ort_slicer("visP2Slicer", 1054, 2, 202, 48),
    ]
    return "pagegeholfen", "Was hätte geholfen", v


def page_three():
    heading = "12pt"
    v = [
        header_shape("visP3Header"),
        page_title("visP3Title", "Validierung & Quellen"),
        navigator("visP3Nav"),

        textbox("visP3Val", 24, 60, 608, 250, [
            [run("Validierung gegen Copernicus EMS (EMSR517)", heading, INK, bold=True)],
            [run(" ")],
            [run("IoU 0,509 gegen ein Ziel von 0,70 — das Ziel ist nicht erreicht.", colour_hex=LOSS, bold=True)],
            [run(" ")],
            [run("Beobachtet 3,207 km²  ·  simuliert 5,214 km²  ·  gemeinsam 2,842 km²")],
            [run("Trefferquote 0,886  ·  Fehlalarmquote 0,455  ·  Überzeichnung Faktor 1,63")],
            [run(" ")],
            [run("Die Überzeichnung ist kein flacher Saum: die Fehlalarmfläche hat einen Median von "
                 "1,65 m Wassertiefe (p75 3,18 m), nur 12,3 % liegen unter 0,5 m. Vier Proben haben "
                 "den Wert nicht bewegt — Spitzenabfluss, Rauheit, Ausschluss bebauter Flächen "
                 "(0,496, also schlechter) und ein Tiefenschwellwert bis 1 m (0,461).",
                 colour_hex=MUTED)],
        ], z=210),

        textbox("visP3Method", 648, 60, 608, 250, [
            [run("Was dieses Modell ist — und was nicht", heading, INK, bold=True)],
            [run(" ")],
            [run("Es ist eine Rekonstruktion der Nacht vom 14. auf den 15. Juli 2021 auf einem "
                 "Geländemodell, das nach Flut und Wiederaufbau erfasst wurde. Ein Teil der "
                 "Abweichung ist echte Geländeveränderung, kein Modellfehler.")],
            [run(" ")],
            [run("Die Referenz ist die von Copernicus kartierte maximale Ausdehnung (Flood trace), "
                 "nicht das zum Aufnahmezeitpunkt noch stehende Wasser. Die Satellitenbilder "
                 "entstanden nach dem Scheitel.")],
            [run(" ")],
            [run("Portfolio, Policen und Schäden sind synthetisch. Sie bilden eine plausible "
                 "Bestandsstruktur ab, aber keinen realen Versicherungsbestand. Kein Wert auf diesen "
                 "Seiten ist eine Aussage über eine tatsächliche Person, ein tatsächliches Gebäude "
                 "oder einen tatsächlichen Schadenfall.", colour_hex=LOSS)],
        ], z=210),

        matrix("visP3Matrix", 24, 318, 608, 248,
               title="Modellabdeckung — Ort × Überflutungsklasse",
               rows=("Gebäude", "Ort"), columns=("Gebäude", "Überflutungsklasse"),
               values=["Gebäude #"]),

        textbox("visP3Sources", 648, 318, 608, 248, [
            [run("Quellen & Lizenzen", heading, INK, bold=True)],
            [run(" ")],
            [run("Überflutungsbeobachtung  ", bold=True),
             run("© European Union, Copernicus Emergency Management Service (EMSR517)")],
            [run("Gelände  ", bold=True),
             run("Digitales Geländemodell Rheinland-Pfalz, LVermGeo RLP, dl-de/by-2-0")],
            [run("Gebäude & Ortsnamen  ", bold=True),
             run("© OpenStreetMap-Mitwirkende, ODbL")],
            [run("Abfluss & Pegel  ", bold=True),
             run("Landesamt für Umwelt Rheinland-Pfalz, Pegel Altenahr")],
            [run("Portfolio, Policen, Schäden  ", bold=True),
             run("synthetisch erzeugt für dieses Projekt")],
            [run(" ")],
            [run("Die vollständige Attribution und die offenen Punkte des Modells stehen in "
                 "docs/open-decisions.md im Repository.", colour_hex=MUTED)],
        ], z=210),

        textbox("visP3Note", 24, 576, 1232, 138, [
            [run("Warum diese Seite existiert", heading, INK, bold=True)],
            [run(" ")],
            [run("Ein Zwilling, der seine eigene Unsicherheit verschweigt, ist eine Behauptung. Die "
                 "Zahlen oben sind unbequem: das Modell überzeichnet die Ausdehnung um zwei Drittel "
                 "und verfehlt sein eigenes Gütekriterium. Sie stehen hier trotzdem — an erster Stelle "
                 "und nicht im Anhang —, weil ein Ergebnis ohne seine Fehlergrenze in der Aufarbeitung "
                 "einer Katastrophe nichts wert ist.")],
        ], z=210),
    ]
    return "pagevalidierung", "Validierung & Quellen", v


# --- assembly ---------------------------------------------------------------
def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "definition" / "pages").mkdir(parents=True)

    def write(path: Path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    write(OUT / ".platform", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Report", "displayName": "Flut-Insights — Betroffenheit & Deckung"},
        "config": {"version": "2.0", "logicalId": "00000000-0000-0000-0000-000000000000"},
    })
    write(OUT / "definition.pbir", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byConnection": {
            "connectionString": (
                f'Data Source="powerbi://api.powerbi.com/v1.0/myorg/{WORKSPACE}";'
                f'initial catalog="{MODEL_NAME}";integrated security=ClaimsToken;'
                f'semanticmodelid={MODEL_ID}'
            )
        }},
    })
    write(OUT / "definition" / "version.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
        "version": "2.0.0",
    })
    write(OUT / "definition" / "report.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json",
        "themeCollection": {"baseTheme": {
            "name": "Fluent2-CY26SU04",
            "reportVersionAtImport": {"visual": "2.8.0", "report": "3.2.0", "page": "2.3.1"},
            "type": "SharedResources",
        }},
        "objects": {"outspacePane": [{"properties": {"expanded": lit("false")}}]},
        "resourcePackages": [
            {"name": IBCS_BAR, "type": "CustomVisual", "items": [
                {"name": f"{IBCS_BAR}.pbiviz.json", "path": f"{IBCS_BAR}.pbiviz.json",
                 "type": "CustomVisualMetadata"},
            ]},
            {"name": "SharedResources", "type": "SharedResources", "items": [
                {"name": "Fluent2-CY26SU04", "path": "BaseThemes/Fluent2-CY26SU04.json", "type": "BaseTheme"},
            ]},
        ],
        "settings": {"useStylableVisualContainerHeader": True, "useEnhancedTooltips": False},
    })

    pages = [page_one(), page_two(), page_three()]
    for page_name, display, visuals in pages:
        page_dir = OUT / "definition" / "pages" / page_name
        names = [v["name"] for v in visuals]
        slicers = [n for n in names if n.endswith("Slicer")]
        chartish = [n for n in names if not n.endswith(("Header", "Title", "Nav", "Note", "Slicer"))]
        interactions = [
            {"source": src, "target": tgt, "type": "DataFilter"}
            for src in slicers + chartish for tgt in chartish if src != tgt
        ]
        write(page_dir / "page.json", {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
            "name": page_name,
            "displayName": display,
            "displayOption": "FitToPage",
            "height": PAGE_H,
            "width": PAGE_W,
            "objects": {"background": [{"properties": {
                "color": colour(PAPER),
                "transparency": lit("0D"),
            }}]},
            "visualInteractions": interactions,
        })
        for v in visuals:
            write(page_dir / "visuals" / v["name"] / "visual.json", v)

    write(OUT / "definition" / "pages" / "pages.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
        "pageOrder": [p[0] for p in pages],
        "activePageName": pages[0][0],
    })

    shutil.copytree(ASSETS / "CustomVisuals" / IBCS_BAR, OUT / "CustomVisuals" / IBCS_BAR)
    shutil.copytree(ASSETS / "StaticResources", OUT / "StaticResources")

    total = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"built {OUT} — {total} files, {len(pages)} pages")
    for page_name, display, visuals in pages:
        print(f"  {page_name:<20} {display:<24} {len(visuals)} visuals")


if __name__ == "__main__":
    build()
