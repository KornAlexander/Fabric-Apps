"""Generate the PBIR report (4 pages) for the Berlin twin import model.

Style from Alexander's Hochschul-Insights Import template: its theme, background
image, logo, title textbox and page navigator are copied, 1920x1080 canvas,
IBCS Multi-Tier visuals (time category -> column, anything else -> bar). Builders
follow the Munich ecosystem report (repos/temp/muc-bi/gen_report.py).

IBCS rule kept from there: percentage measures are never bound to an IBCS field
well (the visual renders them as 1), shares stay on cards.

    python fabric/gen_report.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

HERE = Path(__file__).parent
TEMPLATE = Path(os.environ.get("HOCHSCHUL_TEMPLATE", Path.home() / "OneDrive - Microsoft" / "Dokumente" / "03. Demo" / "Hochschul-Insights" / "Hochschul-Insights Import.Report"))
NAME = "Berliner-Stadtwerke-Zwilling"
OUT = HERE / "pbip" / f"{NAME}.Report"
REPORT_NAME = "Berliner Stadtwerke Zwilling"

IBCS_BAR = "ibcsMultiTierBarECA4F65BFFB141198B7A6391AFFC946A"
IBCS_COL = "ibcsMultiTierColumnB84BA14B8B6A4201A7F698B3B38DD148"
THEME = "MS_Default_Theme_Korn5610309886308295.json"
BG = "hochschul_bg4504259618932576.png"
LOGO = "actionablereportinglogo42073863795969413.png"

VS = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.8.0/schema.json"
PS = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json"

TEAL = "'#147A67'"
INK = "'#1F2D2A'"
LINE = "'#D5E6DF'"
WHITE = "'#FFFFFF'"
FONT = "'''Segoe UI'', wf_segoe-ui_normal, helvetica, arial, sans-serif'"

_z = [1000]


def nid(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:20]


def lit(value: str) -> dict:
    return {"expr": {"Literal": {"Value": value}}}


def colour(hexish: str) -> dict:
    return {"solid": {"color": {"expr": {"Literal": {"Value": hexish}}}}}


def theme_colour(i: int) -> dict:
    return {"solid": {"color": {"expr": {"ThemeDataColor": {"ColorId": i, "Percent": 0}}}}}


def pos(x, y, w, h) -> dict:
    _z[0] += 1
    return {"x": x, "y": y, "z": _z[0], "height": h, "width": w, "tabOrder": _z[0]}


def field(entity: str, prop: str, kind: str) -> dict:
    key = "Measure" if kind == "m" else "Column"
    return {key: {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}}


def projection(entity: str, prop: str, kind: str, active: bool = False) -> dict:
    p = {"field": field(entity, prop, kind), "queryRef": f"{entity}.{prop}", "nativeQueryRef": prop}
    if active:
        p["active"] = True
    return p


def chrome_title(text: str) -> dict:
    return {
        "title": [{"properties": {
            "text": lit(f"'{text}'"), "show": lit("true"), "fontSize": lit("13D"), "bold": lit("true"),
            "fontColor": colour(TEAL), "fontFamily": lit(FONT),
        }}],
        "subTitle": [{"properties": {"show": lit("false")}}],
        "background": [{"properties": {"show": lit("true"), "color": colour(WHITE), "transparency": lit("8D")}}],
        "border": [{"properties": {"show": lit("true"), "color": colour(LINE), "radius": lit("10D")}}],
        "dropShadow": [{"properties": {"show": lit("false")}}],
    }


def categorical(name: str, entity: str, prop: str, values: list[str]) -> dict:
    return {
        "name": name,
        "field": field(entity, prop, "c"),
        "type": "Categorical",
        "filter": {
            "Version": 2,
            "From": [{"Name": "t", "Entity": entity, "Type": 0}],
            "Where": [{"Condition": {"In": {
                "Expressions": [{"Column": {"Expression": {"SourceRef": {"Source": "t"}}, "Property": prop}}],
                "Values": [[{"Literal": {"Value": v}}] for v in values],
            }}}],
        },
        "howCreated": "User",
    }


# ------------------------------------------------------------------ visual builders
def v_logo(name) -> dict:
    return {
        "$schema": VS, "name": name, "position": pos(17.13, 0, 48.46, 66.84),
        "visual": {
            "visualType": "image",
            "objects": {"image": [{"properties": {"sourceFile": {"image": {
                "name": lit("'actionablereportinglogo.png'"),
                "url": {"expr": {"ResourcePackageItem": {"PackageName": "RegisteredResources", "PackageType": 1, "ItemName": LOGO}}},
                "scaling": lit("'Normal'"),
            }}}}]},
            "drillFilterOtherVisuals": True,
        },
    }


def v_textbox(name, x, y, w, h, runs) -> dict:
    return {
        "$schema": VS, "name": name, "position": pos(x, y, w, h),
        "visual": {
            "visualType": "textbox",
            "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": runs}]}}]},
            "drillFilterOtherVisuals": True,
        },
    }


def run(text, size="11pt", color="#3A4A46", bold=False) -> dict:
    style = {"fontFamily": "Segoe UI", "fontSize": size, "color": color}
    if bold:
        style["fontWeight"] = "bold"
    return {"value": text, "textStyle": style}


def v_nav(name) -> dict:
    """Page navigator exactly as on the Hochschul pages (16pt, ThemeDataColor0, bold when selected)."""
    text = {"fontSize": lit("16D"), "fontColor": theme_colour(0), "fontFamily": lit(FONT)}
    return {
        "$schema": VS, "name": name, "position": pos(514, 0, 1406, 66),
        "visual": {
            "visualType": "pageNavigator",
            "objects": {
                "pages": [{"properties": {"showHiddenPages": lit("true")}}],
                "layout": [{"properties": {"cellPadding": lit("2L")}}],
                "text": [
                    {"properties": dict(text, bold=lit("false")), "selector": {"id": "default"}},
                    {"properties": dict(text, bold=lit("true")), "selector": {"id": "selected"}},
                    {"properties": {"bold": lit("true")}, "selector": {"id": "hover"}},
                    {"properties": {"fontColor": theme_colour(0), "bold": lit("true")}, "selector": {"id": "press"}},
                ],
                "fill": [{"properties": {"show": lit("false")}}],
            },
            "visualContainerObjects": {"general": [{"properties": {"keepLayerOrder": lit("true")}}]},
            "drillFilterOtherVisuals": True,
        },
        "howCreated": "InsertVisualButton",
    }


def v_card(name, x, y, w, h, measure, label) -> dict:
    return {
        "$schema": VS, "name": name, "position": pos(x, y, w, h),
        "visual": {
            "visualType": "card",
            "query": {"queryState": {"Values": {"projections": [projection("Measure", measure, "m")]}}},
            "objects": {
                "labels": [{"properties": {
                    "fontSize": lit("30D"), "color": colour(TEAL), "bold": lit("true"), "labelDisplayUnits": lit("1D"), "fontFamily": lit(FONT),
                }}],
                "categoryLabels": [{"properties": {"show": lit("false")}}],
            },
            "visualContainerObjects": chrome_title(label),
            "drillFilterOtherVisuals": True,
        },
    }


def v_ibcs(name, x, y, w, h, *, column: bool, cat, actual, reference, title, top=12, decimals=0, percent_tier=True, years=None,
           scenario="PL", abs_tier=True, sort_by="actual") -> dict:
    """scenario PY for a prior-year reference (grey), PL for any other reference (outlined), per the IBCS notation."""
    cat_entity, cat_prop = cat
    sort_field = field(cat_entity, cat_prop, "c") if column else field("Measure", reference if sort_by == "reference" else actual, "m")
    visual = {
        "$schema": VS, "name": name, "position": pos(x, y, w, h),
        "visual": {
            "visualType": IBCS_COL if column else IBCS_BAR,
            "query": {
                "queryState": {
                    "category": {"projections": [projection(cat_entity, cat_prop, "c")]},
                    "actual": {"projections": [projection("Measure", actual, "m")]},
                    "reference": {"projections": [projection("Measure", reference, "m")]},
                },
                "sortDefinition": {"sort": [{"field": sort_field, "direction": "Ascending" if column else "Descending"}], "isDefaultSort": True},
            },
            "objects": {
                "general": [{"properties": {
                    "scenario": lit(f"'{scenario}'"),
                    "sortBy": lit("'category'" if column else f"'{sort_by}'"),
                    "sortDir": lit("'asc'" if column else "'desc'"),
                    "maxVisibleCategories": lit(f"{top}D"),
                    "decimals": lit(f"{decimals}D"),
                    "decimalsAbs": lit(f"{decimals}D"),
                    "showPercentTier": lit("true" if percent_tier else "false"),
                    "showAbsoluteTier": lit("true" if abs_tier else "false"),
                    "absOutlierCutoff": lit("0D"),
                    "pctOutlierCutoff": lit("10D"),
                }}],
                "text": [{"properties": {"fontFamily": lit(FONT), "fontSize": lit("13D"), "color": colour(INK)}}],
            },
            "visualContainerObjects": chrome_title(title),
            "drillFilterOtherVisuals": True,
        },
    }
    if years:
        visual["filterConfig"] = {"filters": [categorical(nid(name, "years"), "Jahr", "Jahr", [f"{y}L" for y in years])]}
    return visual


def v_table(name, x, y, w, h, columns, title, sort) -> dict:
    e, p, k, direction = sort
    return {
        "$schema": VS, "name": name, "position": pos(x, y, w, h),
        "visual": {
            "visualType": "tableEx",
            "query": {
                "queryState": {"Values": {"projections": [projection(e_, p_, k_) for e_, p_, k_ in columns]}},
                "sortDefinition": {"sort": [{"field": field(e, p, k), "direction": direction}], "isDefaultSort": True},
            },
            "objects": {
                "grid": [{"properties": {"gridVertical": lit("true"), "gridVerticalColor": colour(LINE), "gridHorizontalColor": colour(LINE)}}],
                "columnHeaders": [{"properties": {"fontColor": colour(TEAL), "bold": lit("true"), "fontSize": lit("11D")}}],
                "values": [{"properties": {"fontSize": lit("11D"), "fontColor": colour(INK)}}],
                "total": [{"properties": {"totals": lit("false")}}],
            },
            "visualContainerObjects": chrome_title(title),
            "drillFilterOtherVisuals": True,
        },
    }


def v_slicer(name, x, y, w, h, entity, prop, sync_group) -> dict:
    return {
        "$schema": VS, "name": name, "position": pos(x, y, w, h),
        "visual": {
            "visualType": "slicer",
            "query": {
                "queryState": {"Values": {"projections": [projection(entity, prop, "c", active=True)]}},
                "sortDefinition": {"isDefaultSort": True},
            },
            "objects": {
                "data": [{"properties": {"mode": lit("'Dropdown'")}}],
                "header": [{"properties": {"show": lit("false")}}],
                "items": [{"properties": {"textSize": lit("12D"), "fontColor": colour(INK)}}],
                "selection": [{"properties": {"singleSelect": lit("false"), "strictSingleSelect": lit("false")}}],
            },
            "visualContainerObjects": {
                "title": [{"properties": {"text": lit("''"), "show": lit("false")}}],
                "background": [{"properties": {"show": lit("true"), "color": colour(WHITE)}}],
                "border": [{"properties": {"show": lit("true"), "color": colour(LINE), "radius": lit("6D")}}],
                "subTitle": [{"properties": {"show": lit("false")}}],
            },
            "syncGroup": {"groupName": sync_group, "fieldChanges": True, "filterChanges": True},
            "drillFilterOtherVisuals": True,
        },
    }


# --------------------------------------------------------------------------- layout
KPI_Y, KPI_H, KPI_W = 116, 104, 456
KPI_X = [24, 496, 968, 1440]
ROW_A_Y, ROW_H = 232, 404
ROW_B_Y, ROW_B_H = 648, 408
COL_X = [24, 972]
COL_W = 924
YEARS = list(range(2015, 2027))
# A subset against its own total (review 2026-10-28): the total as a grey reference, no variance tiers,
# so "the others" are not drawn as a green plan deviation.
SUBSET = {"scenario": "PY", "abs_tier": False, "percent_tier": False}


def kpis(p, items):
    return [v_card(nid(p, "kpi", str(i)), KPI_X[i], KPI_Y, KPI_W, KPI_H, m, label) for i, (m, label) in enumerate(items)]


def chrome(p, subtitle, slicer=True) -> list[dict]:
    out = [
        v_logo(nid(p, "logo")),
        v_textbox(nid(p, "brand"), 90, 18.57, 380, 47.14, [run("Berlin-Zwilling", "16pt", "#ffffff", bold=True)]),
        v_nav(nid(p, "nav")),
        v_textbox(nid(p, "sub"), 24, 70, 1600, 40, [run(subtitle, "11.5pt", "#1F4F45")]),
    ]
    if slicer:
        out.append(v_slicer(nid(p, "slicer"), 1660, 72, 236, 38, "Bezirk", "Bezirk", "Bezirk"))
    return out


PAGES: list[dict] = []


def page(pid, display, subtitle, build, partner=None, slicer=True):
    PAGES.append({"id": pid, "display": display, "subtitle": subtitle, "build": build, "partner": partner, "slicer": slicer})


def build_stadtwerke(p):
    return kpis(p, [
        ("Solarleistung MWp", "Solarleistung in MWp"),
        ("Solaranlagen", "Solaranlagen"),
        ("Mieterstrom-Solaranlagen", "davon Mieterstrom"),
        ("Ladepunkte Stadtwerke", "Öffentliche Ladepunkte der Stadtwerke"),
    ]) + [
        v_ibcs(nid(p, "v1"), COL_X[0], ROW_A_Y, COL_W, ROW_H, column=True, cat=("Jahr", "Jahr"),
               actual="Solarleistung kWp", reference="Solarleistung Vorjahr kWp",
               title="Solarzubau je Inbetriebnahmejahr: Jahr gegen Vorjahr (kWp)", years=YEARS, percent_tier=False, scenario="PY"),
        v_ibcs(nid(p, "v2"), COL_X[1], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Bezirk", "Bezirk"),
               actual="Solarleistung kWp", reference="Solarleistung erwartet nach Einwohnern kWp",
               title="Solarleistung je Bezirk: Ist gegen Verteilung nach Einwohnern (kWp)", percent_tier=False),
        v_ibcs(nid(p, "v3"), COL_X[0], ROW_B_Y, COL_W, ROW_B_H, column=False, cat=("Bezirk", "Bezirk"),
               actual="Ladepunkte Stadtwerke", reference="Ladepunkte Stadtwerke erwartet nach Einwohnern",
               title="Stadtwerke-Ladepunkte je Bezirk: Ist gegen Verteilung nach Einwohnern", percent_tier=False),
        v_table(nid(p, "v4"), COL_X[1], ROW_B_Y, COL_W, ROW_B_H, [
            ("Anlage", "Anlagenname", "c"), ("Anlage", "Energieträger", "c"), ("Anlage", "Bezirk", "c"),
            ("Anlage", "Inbetriebnahmejahr", "c"), ("Anlage", "MaStR-Nummer", "c"), ("Measure", "Installierte Leistung kW", "m"),
        ], "Größte Anlagen der Stadtwerke, alle Energieträger (kW)", ("Measure", "Installierte Leistung kW", "m", "Descending")),
    ]


def build_degewo(p):
    return kpis(p, [
        ("Solarleistung kWp", "Solarleistung degewo in kWp"),
        ("Offenes Potenzial Fokusdächer kWp", "Offenes Dachpotenzial kWp (Schätzung)"),
        ("Quartiere", "degewo-Quartiere"),
        ("Einwohner Quartiere", "Einwohner in den Quartieren"),
    ]) + [
        v_ibcs(nid(p, "v1"), COL_X[0], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Fokusdach", "Adresse"),
               actual="Solarpotenzial Fokusdächer kWp", reference="Installiert Fokusdächer kWp",
               title="Dächer mit dem größten Potenzial: Potenzial (Schätzung) gegen installiert (kWp)", percent_tier=False),
        v_ibcs(nid(p, "v2"), COL_X[1], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Bezirk", "Bezirk"),
               actual="Solarleistung kWp", reference="Solarleistung erwartet nach Einwohnern kWp",
               title="Solarleistung je Bezirk: Ist gegen Verteilung nach Einwohnern (kWp)", percent_tier=False),
        v_ibcs(nid(p, "v3"), COL_X[0], ROW_B_Y, COL_W, ROW_B_H, column=True, cat=("Jahr", "Jahr"),
               actual="Solarleistung kWp", reference="Solarleistung Vorjahr kWp",
               title="Solarzubau je Inbetriebnahmejahr: Jahr gegen Vorjahr (kWp)", years=YEARS, percent_tier=False, scenario="PY"),
        v_table(nid(p, "v4"), COL_X[1], ROW_B_Y, COL_W, ROW_B_H, [
            ("Fokusdach", "Adresse", "c"), ("Fokusdach", "Quartier", "c"), ("Fokusdach", "Gebäudefunktion", "c"),
            ("Measure", "Solarpotenzial Fokusdächer kWp", "m"), ("Measure", "Installiert Fokusdächer kWp", "m"),
            ("Measure", "Offenes Potenzial Fokusdächer kWp", "m"),
        ], "Fokusdächer: offenes Potenzial zuerst (kWp, Schätzung des Solarkatasters)",
            ("Measure", "Offenes Potenzial Fokusdächer kWp", "m", "Descending")),
    ]


def build_bvg(p):
    return kpis(p, [
        ("Betriebshöfe", "BVG-Standorte"),
        ("Betriebshöfe im Bau", "davon im Bau"),
        ("Betriebshöfe mit Solarvereinbarung 2025", "in der Solarvereinbarung 2025"),
        ("Solarleistung kWp", "Solarleistung BVG in kWp"),
    ]) + [
        v_table(nid(p, "v1"), COL_X[0], ROW_A_Y, COL_W, ROW_H, [
            ("Betriebshof", "Betriebshof", "c"), ("Betriebshof", "Art", "c"), ("Betriebshof", "Status", "c"),
            ("Betriebshof", "Solarvereinbarung 2025", "c"), ("Betriebshof", "Bezirk", "c"), ("Measure", "Solarleistung Betriebshöfe kWp", "m"),
        ], "BVG-Standorte und ihre Solarleistung (kWp)", ("Measure", "Solarleistung Betriebshöfe kWp", "m", "Descending")),
        v_ibcs(nid(p, "v2"), COL_X[1], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Betriebshof", "Art"),
               actual="Betriebshöfe mit Solarvereinbarung 2025", reference="Betriebshöfe",
               title="Standorte je Art: in der Solarvereinbarung 2025 (schwarz) von allen (grau)", **SUBSET),
        v_ibcs(nid(p, "v3"), COL_X[0], ROW_B_Y, COL_W, ROW_B_H, column=True, cat=("Jahr", "Jahr"),
               actual="Solarleistung kWp", reference="Solarleistung Vorjahr kWp",
               title="Solarzubau der BVG je Inbetriebnahmejahr: Jahr gegen Vorjahr (kWp)", years=YEARS, percent_tier=False, scenario="PY"),
        v_ibcs(nid(p, "v4"), COL_X[1], ROW_B_Y, COL_W, ROW_B_H, column=False, cat=("Bezirk", "Bezirk"),
               actual="Betriebshöfe im Bau", reference="Betriebshöfe",
               title="Standorte je Bezirk: im Bau (schwarz) von allen (grau)", sort_by="reference", **SUBSET),
    ]


def build_laden(p):
    return kpis(p, [
        ("Ladepunkte", "Öffentliche Ladepunkte"),
        ("Anteil Stadtwerke an Ladepunkten", "Anteil der Stadtwerke"),
        ("Ladepunkte bis 300 m um Quartiere", "bis 300 m um degewo-Quartiere"),
        ("Quartiere ohne Stadtwerke-Ladepunkt", "Quartiere ohne Stadtwerke-Ladepunkt (300 m)"),
    ]) + [
        v_ibcs(nid(p, "v1"), COL_X[0], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Bezirk", "Bezirk"),
               actual="Ladepunkte", reference="Ladepunkte erwartet nach Einwohnern",
               title="Öffentliche Ladepunkte je Bezirk: Ist gegen Verteilung nach Einwohnern", percent_tier=False),
        v_ibcs(nid(p, "v2"), COL_X[1], ROW_A_Y, COL_W, ROW_H, column=False, cat=("Quartier", "Quartier"),
               actual="Stadtwerke-Ladepunkte bis 300 m um Quartiere", reference="Ladepunkte bis 300 m um Quartiere",
               title="Ladepunkte bis 300 m Luftlinie je degewo-Quartier: Stadtwerke (schwarz) von allen (grau)", sort_by="reference", **SUBSET),
        v_ibcs(nid(p, "v3"), COL_X[0], ROW_B_Y, COL_W, ROW_B_H, column=True, cat=("Jahr", "Jahr"),
               actual="Ladestrom öffentlich MWh", reference="Ladestrom öffentlich Vorjahr MWh",
               title="Öffentlicher Ladestrom je Jahr: Jahr gegen Vorjahr (MWh, 2017 bis 2019 fehlen in der Quelle)",
               years=list(range(2014, 2025)), percent_tier=False, scenario="PY"),
        v_ibcs(nid(p, "v4"), COL_X[1], ROW_B_Y, COL_W, ROW_B_H, column=False, cat=("Ladestation", "Leistungsklasse"),
               actual="Ladepunkte Stadtwerke", reference="Ladepunkte",
               title="Ladepunkte je Leistungsklasse: Stadtwerke (schwarz) von allen (grau)", top=5, sort_by="reference", **SUBSET),
    ]


page("stadtwerke", "Stadtwerke",
     "Für die Berliner Stadtwerke · Solaranlagen im Marktstammdatenregister und öffentliche Ladepunkte. "
     "Die Referenz „nach Einwohnern“ ist ein Rechenwert, kein Ziel.", build_stadtwerke, partner="Berliner Stadtwerke")
page("degewo", "degewo",
     "Für die degewo · Solaranlagen, Dachpotenzial (Schätzung des Solarkatasters Berlin) und die Quartiere.",
     build_degewo, partner="degewo")
page("bvg", "BVG",
     "Für die BVG · Betriebshöfe, Solarvereinbarung 2025 mit den Berliner Stadtwerken und Solaranlagen im Marktstammdatenregister.",
     build_bvg, partner="BVG", slicer=False)
page("laden", "Laden",
     "Für Stadtwerke und degewo · Öffentliche Ladepunkte im Ladesäulenregister Berlin, Luftlinie zu den degewo-Quartieren, kein Live-Status.",
     build_laden)


# --------------------------------------------------------------------------- writer
def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _writable(func, path, _exc) -> None:
    """Files copied from the OneDrive template keep their read-only attribute; clear it and retry."""
    import os
    import stat

    os.chmod(path, stat.S_IWRITE)
    func(path)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT, onexc=_writable)
    # copyfile, not copy2: no OneDrive attributes travel along
    for vis in (IBCS_BAR, IBCS_COL):
        shutil.copytree(TEMPLATE / "CustomVisuals" / vis, OUT / "CustomVisuals" / vis, copy_function=shutil.copyfile)
    for res in (THEME, BG, LOGO):
        (OUT / "StaticResources" / "RegisteredResources").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TEMPLATE / "StaticResources" / "RegisteredResources" / res, OUT / "StaticResources" / "RegisteredResources" / res)
    shutil.copytree(TEMPLATE / "StaticResources" / "SharedResources", OUT / "StaticResources" / "SharedResources", copy_function=shutil.copyfile)

    dump(OUT / ".platform", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Report", "displayName": REPORT_NAME,
                     "description": "Vier Seiten zu Berliner Stadtwerken, degewo, BVG und öffentlichem Laden."},
        "config": {"version": "2.0", "logicalId": nid("item", "report")[:8] + "-0000-0000-0000-" + nid("item", "report")[:12]},
    })
    dump(OUT / "definition.pbir", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byPath": {"path": f"../{NAME}.SemanticModel"}},
    })
    d = OUT / "definition"
    dump(d / "version.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
        "version": "2.0.0",
    })
    template_report = json.loads((TEMPLATE / "definition" / "report.json").read_text(encoding="utf-8"))
    dump(d / "report.json", {
        "$schema": template_report["$schema"],
        "themeCollection": template_report["themeCollection"],
        "objects": template_report.get("objects", {}),
        "resourcePackages": [
            next(p for p in template_report["resourcePackages"] if p["name"] == "SharedResources"),
            {"name": "RegisteredResources", "type": "RegisteredResources", "items": [
                {"name": LOGO, "path": LOGO, "type": "Image"},
                {"name": BG, "path": BG, "type": "Image"},
                {"name": THEME, "path": THEME, "type": "CustomTheme"},
            ]},
            {"name": IBCS_BAR, "type": "CustomVisual", "items": [
                {"name": f"{IBCS_BAR}.pbiviz.json", "path": f"{IBCS_BAR}.pbiviz.json", "type": "CustomVisualMetadata"}]},
            {"name": IBCS_COL, "type": "CustomVisual", "items": [
                {"name": f"{IBCS_COL}.pbiviz.json", "path": f"{IBCS_COL}.pbiviz.json", "type": "CustomVisualMetadata"}]},
        ],
        "settings": template_report.get("settings", {}),
    })

    background = {"background": [{"properties": {"image": {"image": {
        "name": lit("'hochschul_bg4.png'"),
        "url": {"expr": {"ResourcePackageItem": {"PackageName": "RegisteredResources", "PackageType": 1, "ItemName": BG}}},
        "scaling": lit("'Fit'"),
    }}}}]}
    total = 0
    for spec in PAGES:
        pid = spec["id"]
        pg = {"$schema": PS, "name": pid, "displayName": spec["display"], "displayOption": "FitToPage", "height": 1080, "width": 1920,
              "objects": background}
        if spec["partner"]:
            pg["filterConfig"] = {"filters": [categorical(nid(pid, "partner"), "Partner", "Partner", [f"'{spec['partner']}'"])]}
        dump(d / "pages" / pid / "page.json", pg)
        visuals = chrome(pid, spec["subtitle"], spec["slicer"]) + spec["build"](pid)
        names = [v["name"] for v in visuals]
        assert len(set(names)) == len(names), pid
        for v in visuals:
            dump(d / "pages" / pid / "visuals" / v["name"] / "visual.json", v)
        total += len(visuals)
        print(f"  {spec['display']}: {len(visuals)} visuals")
    dump(d / "pages" / "pages.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
        "pageOrder": [p["id"] for p in PAGES],
        "activePageName": PAGES[0]["id"],
    })
    print(f"report {OUT}: {len(PAGES)} pages, {total} visuals")
    check_fields(d)
    dump(OUT.parent / f"{NAME}.pbip", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
        "version": "1.0",
        "artifacts": [{"report": {"path": f"{NAME}.Report"}}],
        "settings": {"enableAutoRecovery": True},
    })


def check_fields(d: Path) -> None:
    """Every Column/Measure a visual or filter names must exist in the model, so Desktop opens without broken visuals."""
    import sys

    sys.path.insert(0, str(HERE))
    from gen_model import TABLES  # noqa: PLC0415
    from measures import MEASURES  # noqa: PLC0415

    measures = {m[0] for m in MEASURES}
    bad: list[str] = []

    def walk(o, where):
        if isinstance(o, dict):
            for kind in ("Column", "Measure"):
                f = o.get(kind)
                if isinstance(f, dict) and "Property" in f and "Entity" in f.get("Expression", {}).get("SourceRef", {}):
                    e, p = f["Expression"]["SourceRef"]["Entity"], f["Property"]
                    ok = (p in measures and e == "Measure") if kind == "Measure" else (p in TABLES.get(e, {}).get("cols", {}))
                    if not ok:
                        bad.append(f"{where}: {kind} {e}[{p}]")
            for v in o.values():
                walk(v, where)
        elif isinstance(o, list):
            for v in o:
                walk(v, where)

    for f in d.rglob("*.json"):
        walk(json.loads(f.read_text(encoding="utf-8")), f.relative_to(d))
    if bad:
        raise SystemExit("unknown fields:\n  " + "\n  ".join(bad))
    print("fields: all bound to the model")


if __name__ == "__main__":
    main()
