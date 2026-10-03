"""Generate the Fabric Empires PBIR report: three pages in the Hochschul house style.

Generated rather than hand-authored because PBIR is ~25 visuals of deeply
nested JSON where every field binding repeats an Entity/Property/queryRef trio.
Hand-editing that is how a queryRef ends up disagreeing with its projection,
which does not fail validation: it renders an empty visual.

Layout is 1920x1080 FitToPage, matching the house template so the shared
background image and theme land at the right scale.

NOTE ON IBCS: the house style normally uses the IBCS custom visuals, and they
are deliberately NOT used here. The measures that carry this report are
percentages (Accuracy, Win Rate, Pressure Gap), and the IBCS visual renders a
percentage measure as `1` because it rounds and ignores the model format
string. Binding the report's main charts to a visual that would display 64.1%
as "1" is worse than using a core bar chart in the house palette.
"""

import json
import pathlib
import shutil
import uuid

import _config

ROOT = _config.REPORT_DIR

# The workspace name and the model id are written as placeholders and resolved
# by deploy_report.py, so the committed definition names no real workspace.
MODEL_NAME = _config.MODEL_NAME

# Stable and derived, exactly as in build_semantic_model.py, so a regeneration
# never churns the diff. It is git-integration identity and nothing more: it
# names no workspace and no tenant.
LOGICAL_ID = str(uuid.uuid5(_config.LINEAGE_NS, "report/platform"))

BG = "hochschul_bg42585168491328588.png"
THEME = "HochschulInsights.Theme.json"
BASE_THEME = "Fluent2-CY26SU04"

TEAL = "#147A67"
CREAM = "#FFF6DD"
INK = "#1C1C1C"

W, H = 1920, 1080
MARGIN = 36.0
BAND_H = 66.8
CONTENT_W = W - 2 * MARGIN

VC_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/1.0.0/schema.json"


def lit(value: str) -> dict:
    return {"expr": {"Literal": {"Value": value}}}


def solid(color: str) -> dict:
    return {"solid": {"color": lit(f"'{color}'")}}


def field(entity: str, prop: str, *, measure: bool) -> dict:
    key = "Measure" if measure else "Column"
    return {
        "field": {key: {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}},
        "queryRef": f"{entity}.{prop}",
        "nativeQueryRef": prop,
    }


def m(prop: str) -> dict:
    return field("Measure", prop, measure=True)


def c(entity: str, prop: str) -> dict:
    return field(entity, prop, measure=False)


def container(name, x, y, w, h, visual, z=0):
    return {
        "$schema": VC_SCHEMA,
        "name": name,
        "position": {"x": float(x), "y": float(y), "z": z,
                     "width": float(w), "height": float(h), "tabOrder": z},
        "visual": visual,
    }


def titled(text: str, *, size=None) -> dict:
    """Title block, with the auto-subtitle explicitly OFF.

    An enabled subtitle on a titled visual adds a scroll bar to the header,
    which is the single most common cosmetic defect in these reports.
    """
    props = {"text": lit(f"'{text}'"), "fontColor": solid(TEAL), "bold": lit("true")}
    if size:
        props["fontSize"] = lit(f"{size}D")
    return {
        "title": [{"properties": props}],
        "subTitle": [{"properties": {"show": lit("false")}}],
    }


def card(name, x, y, w, h, measure, label, *, value_size=None):
    """KPI card. `value_size` matters for TEXT measures: a card renders its value
    at a large default size and clips what does not fit, so a skill name arrives
    as "Enrich data by adding ne...", which is not an answer."""
    visual = {
        "visualType": "card",
        "query": {"queryState": {"Values": {"projections": [m(measure)]}}},
        "visualContainerObjects": titled(label),
    }
    if value_size:
        visual["objects"] = {"labels": [{"properties": {
            "fontSize": lit(f"{value_size}D"),
            "color": solid(INK),
        }}]}
    return container(name, x, y, w, h, visual)


def chart(name, x, y, w, h, vtype, category, values, label, *, data_colors=None):
    visual = {
        "visualType": vtype,
        "query": {"queryState": {
            "Category": {"projections": [category]},
            "Y": {"projections": values},
        }},
        "visualContainerObjects": titled(label),
    }
    if data_colors:
        visual["objects"] = {"dataPoint": [
            {"properties": {"fill": solid(data_colors)}, "selector": {"id": "default"}}]}
    return container(name, x, y, w, h, visual)


def table(name, x, y, w, h, projections, label, *, sort_by=None, direction="Ascending"):
    query = {"queryState": {"Values": {"projections": projections}}}
    if sort_by:
        # Without an explicit sort a table falls back to its first column, so a
        # title like "weakest first" would be a claim the visual does not honour.
        query["sortDefinition"] = {
            "sort": [{"field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Measure"}},
                                            "Property": sort_by}},
                      "direction": direction}],
            "isDefaultSort": True,
        }
    return container(name, x, y, w, h, {
        "visualType": "tableEx",
        "query": query,
        "visualContainerObjects": titled(label),
    })


def header(prefix, title, pages):
    """The house nav bar: a full-width band, the page title, and a page navigator."""
    band = container(f"{prefix}_band", 0, 0, W, BAND_H, {
        "visualType": "shape",
        "objects": {
            "shape": [{"properties": {"tileShape": lit("'rectangle'")}}],
            "fill": [
                {"properties": {"show": lit("true")}},
                {"properties": {"fillColor": solid(TEAL)}, "selector": {"id": "default"}},
            ],
        },
        "visualContainerObjects": {
            "general": [{"properties": {"keepLayerOrder": lit("true")}}],
            "background": [{"properties": {"show": lit("false")}}],
        },
        "drillFilterOtherVisuals": True,
    }, z=5000)

    label = container(f"{prefix}_title", MARGIN, 10, 460, 46, {
        "visualType": "textbox",
        "objects": {"general": [{"properties": {"paragraphs": [{
            "textRuns": [{"value": title, "textStyle": {
                "fontSize": "20pt", "fontWeight": "bold", "color": CREAM,
                "fontFamily": "Segoe UI Semibold"}}],
        }]}}]},
        "visualContainerObjects": {"background": [{"properties": {"show": lit("false")}}]},
    }, z=9500)

    nav = container(f"{prefix}_nav", 540, 0, W - 540, 66, {
        "visualType": "pageNavigator",
        "objects": {
            "layout": [{"properties": {"cellPadding": lit("2L")}}],
            "fill": [{"properties": {"show": lit("false")}}],
            "outline": [{"properties": {"show": lit("false"), "weight": lit("0L")},
                         "selector": {"id": "default"}}],
            "text": [
                {"properties": {"fontSize": lit("16D"), "fontColor": solid(CREAM),
                                "fontFamily": lit("'Segoe UI'")},
                 "selector": {"id": "default"}},
                {"properties": {"fontSize": lit("16D"), "fontColor": solid(CREAM),
                                "bold": lit("true")}, "selector": {"id": "selected"}},
            ],
        },
        "visualContainerObjects": {"background": [{"properties": {"show": lit("false")}}]},
    }, z=9000)
    return [band, label, nav]


def player_slicer(prefix):
    """Player dropdown, synced across pages.

    Filtering Game also filters Attempt, because Game is the one side of the
    Game -> Attempt relationship. So one slicer governs all three pages.
    """
    return container(f"{prefix}_slicer", W - MARGIN - 300, 80, 300, 44, {
        "visualType": "slicer",
        "query": {"queryState": {"Values": {"projections": [c("Game", "Player")]}}},
        "objects": {
            "data": [{"properties": {"mode": lit("'Dropdown'")}}],
            "header": [{"properties": {"show": lit("false")}}],
            "items": [{"properties": {"fontColor": solid(INK), "textSize": lit("11D")}}],
        },
        "visualContainerObjects": {
            "title": [{"properties": {"show": lit("false")}}],
            "background": [{"properties": {"show": lit("false")}}],
        },
    }, z=9600)


def page(name, display, visuals):
    return {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
        "name": name,
        "displayName": display,
        "displayOption": "FitToPage",
        "height": H,
        "width": W,
        "objects": {"background": [{"properties": {"image": {
            "name": lit(f"'{BG}'"),
            "url": {"expr": {"ResourcePackageItem": {
                "PackageName": "RegisteredResources", "PackageType": 1, "ItemName": BG}}},
            "scaling": lit("'Fit'"),
        }}}]},
    }, visuals


def row_of_cards(prefix, specs, y=96.0, h=118.0, widths=None):
    """Card row. `widths` exists because a text measure in an equal-width card
    gets abbreviated to "Enrich data by ad...", which hides the answer the card
    was added to give."""
    gap = 12.0
    n = len(specs)
    if widths is None:
        widths = [(CONTENT_W - gap * (n - 1)) / n] * n
    out = []
    x = MARGIN
    for i, (spec, w) in enumerate(zip(specs, widths)):
        meas, label = spec[0], spec[1]
        size = spec[2] if len(spec) > 2 else None
        out.append(card(f"{prefix}_c{i}", x, y, w, h, meas, label, value_size=size))
        x += w + gap
    return out


# ---------------------------------------------------------------- pages

def overview():
    p = "ov"
    v = header(p, "Overview", None) + [player_slicer(p)]
    v += row_of_cards(p, [
        ("Games", "Games played"),
        ("Win Rate", "Win rate"),
        ("Avg Readiness %", "Avg readiness"),
        ("Attempts", "Questions answered"),
        ("Accuracy", "Overall accuracy"),
    ])
    half = (CONTENT_W - 12) / 2
    v.append(chart(f"{p}_trend", MARGIN, 232, CONTENT_W * 0.62, 390, "lineChart",
                   c("Game", "Started At"), [m("Avg Readiness %")],
                   "Readiness over time", data_colors=TEAL))
    v.append(chart(f"{p}_outcome", MARGIN + CONTENT_W * 0.62 + 12, 232,
                   CONTENT_W * 0.38 - 12, 390, "clusteredColumnChart",
                   c("Game", "Outcome"), [m("Games")], "Games by outcome", data_colors=TEAL))
    v.append(chart(f"{p}_diff", MARGIN, 638, half, 340, "clusteredBarChart",
                   c("Game", "Difficulty"), [m("Accuracy")],
                   "Accuracy by difficulty", data_colors=TEAL))
    v.append(chart(f"{p}_turns", MARGIN + half + 12, 638, half, 340, "clusteredBarChart",
                   c("Game", "Outcome"), [m("Avg Turns")],
                   "Average turns by outcome", data_colors=TEAL))
    v.append(card(f"{p}_notice", MARGIN, 992, CONTENT_W, 56, "Data Notice", "", value_size=11))
    meta, _ = page("p_overview", "Overview", None)
    return meta, v


def skills():
    p = "sk"
    v = header(p, "Skills", None) + [player_slicer(p)]
    v += row_of_cards(p, [
        ("Skills Practised", "Skills practised"),
        ("Skill Coverage", "Coverage of the 41"),
        ("Accuracy", "Overall accuracy"),
        ("Weakest Skill", "Weakest skill", 12),
        ("Strongest Skill", "Strongest skill", 12),
    ], widths=[280, 280, 280, 480, 480])
    half = (CONTENT_W - 12) / 2
    v.append(chart(f"{p}_domacc", MARGIN, 232, half, 350, "clusteredBarChart",
                   c("Skill", "Domain"), [m("Accuracy")],
                   "Accuracy by exam domain", data_colors=TEAL))
    v.append(chart(f"{p}_domn", MARGIN + half + 12, 232, half, 350, "clusteredBarChart",
                   c("Skill", "Domain"), [m("Attempts")],
                   "Questions answered by exam domain", data_colors=TEAL))
    v.append(table(f"{p}_tbl", MARGIN, 598, CONTENT_W, 450, [
        c("Skill", "Domain"), c("Skill", "Skill"),
        m("Attempts"), m("Accuracy"), m("Avg Answer Seconds"),
    ], "Every skill, weakest first", sort_by="Accuracy", direction="Ascending"))
    meta, _ = page("p_skills", "Skills", None)
    return meta, v


def pressure():
    p = "pr"
    v = header(p, "Under Pressure", None) + [player_slicer(p)]
    v += row_of_cards(p, [
        ("Attempts", "Questions answered"),
        ("Accuracy", "Overall accuracy"),
        ("Avg Answer Seconds", "Avg answer time"),
        ("Avg Seconds When Right", "Avg time when right"),
        ("Avg Seconds When Wrong", "Avg time when wrong"),
    ])
    half = (CONTENT_W - 12) / 2
    v.append(chart(f"{p}_acc", MARGIN, 232, half, 350, "clusteredBarChart",
                   c("Attempt", "Context"), [m("Accuracy")],
                   "Accuracy by where the question was asked", data_colors=TEAL))
    v.append(chart(f"{p}_secs", MARGIN + half + 12, 232, half, 350, "clusteredBarChart",
                   c("Attempt", "Context"), [m("Avg Answer Seconds")],
                   "Answer time by where the question was asked", data_colors=TEAL))
    v.append(chart(f"{p}_gap", MARGIN, 598, half, 340, "clusteredBarChart",
                   c("Attempt", "Context"), [m("Pressure Gap")],
                   "Gap against the player's own average", data_colors=TEAL))
    v.append(table(f"{p}_tbl", MARGIN + half + 12, 598, half, 340, [
        c("Attempt", "Context"), m("Attempts"), m("Accuracy"),
        m("Avg Answer Seconds"), m("Pressure Gap"),
    ], "Context detail, hardest first", sort_by="Accuracy", direction="Ascending"))
    meta, _ = page("p_pressure", "Under Pressure", None)
    return meta, v


def main() -> None:
    hoch = _config.theme_source()
    template_report = hoch / "Hochschul-Insights Import.Report"

    if ROOT.exists():
        shutil.rmtree(ROOT)
    (ROOT / "definition" / "pages").mkdir(parents=True)
    res = ROOT / "StaticResources" / "RegisteredResources"
    res.mkdir(parents=True)
    shared = ROOT / "StaticResources" / "SharedResources" / "BaseThemes"
    shared.mkdir(parents=True)

    shutil.copy2(template_report / "StaticResources" / "RegisteredResources" / BG, res / BG)
    shutil.copy2(hoch / "ReportAssets" / "HochschulInsights.Theme.json", res / THEME)
    shutil.copy2(template_report / "StaticResources" / "SharedResources" / "BaseThemes"
                 / f"{BASE_THEME}.json", shared / f"{BASE_THEME}.json")

    def w(path: pathlib.Path, obj) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8", newline="\n")

    w(ROOT / ".platform", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Report", "displayName": "Fabric Empires"},
        "config": {"version": "2.0", "logicalId": LOGICAL_ID},
    })
    w(ROOT / "definition.pbir", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byConnection": {
            "connectionString": 'Data Source="powerbi://api.powerbi.com/v1.0/myorg/'
                                '{{FE_WORKSPACE_NAME}}";'
                                f'initial catalog="{MODEL_NAME}";integrated security=ClaimsToken;'
                                'semanticmodelid={{FE_MODEL_ID}}',
        }},
    })
    w(ROOT / "definition" / "version.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
        "version": "2.0.0",
    })
    w(ROOT / "definition" / "report.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.0.0/schema.json",
        "themeCollection": {
            "baseTheme": {"name": BASE_THEME, "reportVersionAtImport": "5.61", "type": "SharedResources"},
            "customTheme": {"name": THEME, "reportVersionAtImport": "5.61", "type": "RegisteredResources"},
        },
        "resourcePackages": [
            {"name": "SharedResources", "type": "SharedResources", "items": [
                {"name": BASE_THEME, "path": f"BaseThemes/{BASE_THEME}.json", "type": "BaseTheme"}]},
            {"name": "RegisteredResources", "type": "RegisteredResources", "items": [
                {"name": THEME, "path": THEME, "type": "CustomTheme"},
                {"name": BG, "path": BG, "type": "Image"}]},
        ],
        "settings": {"useStylableVisualContainerHeader": True, "defaultDrillFilterOtherVisuals": True},
    })

    builders = [overview, skills, pressure]
    order = []
    for build in builders:
        meta, visuals = build()
        order.append(meta["name"])
        base = ROOT / "definition" / "pages" / meta["name"]
        w(base / "page.json", meta)
        for vis in visuals:
            w(base / "visuals" / vis["name"] / "visual.json", vis)

    w(ROOT / "definition" / "pages" / "pages.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
        "pageOrder": order,
        "activePageName": order[0],
    })

    files = [p for p in ROOT.rglob("*") if p.is_file()]
    visuals = [p for p in files if p.name == "visual.json"]
    print(f"wrote {len(files)} files, {len(visuals)} visuals, pages: {order}")


if __name__ == "__main__":
    main()
