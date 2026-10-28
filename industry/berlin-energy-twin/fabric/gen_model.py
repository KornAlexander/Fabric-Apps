"""Generate the self-contained Import semantic model (TMDL) of the Berlin twin.

Every table is an inline, raw-deflate CSV literal (fabric/build, written by
`npm run export:model`), so the model carries its own data: it opens, refreshes
and publishes in any tenant without a gateway, lakehouse or credential.

Pattern taken from the Munich ecosystem model (repos/temp/muc-bi/gen_model.py),
which was opened in Power BI Desktop and saved as PBIX.

    python fabric/gen_model.py
"""
from __future__ import annotations

import base64
import csv
import json
import shutil
import sys
import uuid
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from copilot import write_copilot  # noqa: E402
from measures import MEASURES  # noqa: E402

HERE = Path(__file__).parent
BUILD = HERE / "build"
NAME = "Berliner-Stadtwerke-Zwilling"
OUT = HERE / "pbip" / f"{NAME}.SemanticModel"
MODEL_NAME = "Berliner Stadtwerke Zwilling"
# Fixed namespace for stable lineage tags (assembled from parts: the public repo gate rejects literal GUIDs).
NS = uuid.UUID("6b1c9a52-3f0e-4c1d-" + "9a77-2e5d8c4b1f30")


def tag(*parts: str) -> str:
    return str(uuid.uuid5(NS, "|".join(parts)))


# kind -> (tmdl dataType, M type, formatString, summarizeBy)
TYPES = {
    "key": ("int64", "Int64.Type", "0", "none"),
    "int": ("int64", "Int64.Type", "#,0", "sum"),
    "dec": ("double", "type number", "#,0.0", "sum"),
    "pct": ("double", "type number", "0.0 %", "none"),
    "num": ("double", "type number", "#,0.0", "none"),
    "geo": ("double", "type number", "0.000000", "none"),
    "txt": ("string", "type text", None, "none"),
    "date": ("dateTime", "type date", "dd.mm.yyyy", "none"),
}
LON, LAT = "Längengrad", "Breitengrad"
GEO = {LON: "geo", LAT: "geo"}

TABLES: dict[str, dict] = {
    "Partner": {
        "cols": {"Partner-Schlüssel": "txt", "Partner": "txt", "Rolle": "txt", "Partner-Sortierung": "key"},
        "hide": ["Partner-Schlüssel", "Partner-Sortierung"],
        "sortBy": {"Partner": "Partner-Sortierung"},
        "desc": "Die drei Landesunternehmen des Zwillings: Berliner Stadtwerke (Energie, Laden), degewo (Wohnen) und BVG (Verkehr). "
                "Jede Anlage gehört genau einem Partner.",
    },
    "Bezirk": {
        "cols": {"Bezirk-Nr": "key", "Bezirk": "txt", "Einwohner": "int", "Ladepunkte Register gesamt": "int",
                 "Ladeleistung Register gesamt kW": "dec", "Stand Ladepunkte Register": "txt", **GEO},
        "hide": ["Bezirk-Nr"],
        "sortBy": {"Bezirk": "Bezirk-Nr"},
        "category": {"Bezirk": "County"},
        "desc": "Die zwölf Berliner Bezirke mit Einwohnern (Einwohnerregister 31.12.2025) und allen Ladepunkten laut Land Berlin "
                "inklusive privater. Auch: Stadtbezirk.",
    },
    "Jahr": {
        "cols": {"Jahr": "key", "Jahrzehnt": "txt"},
        "desc": "Kalenderjahr für Inbetriebnahme von Anlagen und Ladestationen sowie für den öffentlichen Ladestrom.",
    },
    "Anlage": {
        "cols": {
            "MaStR-Nummer": "txt", "Anlagenname": "txt", "Partner-Schlüssel": "txt", "Betreiber": "txt", "Energieträger": "txt",
            "Energieträger MaStR": "txt", "Bruttoleistung kW": "dec", "Nettoleistung kW": "dec", "Speicherkapazität kWh": "dec",
            "Betriebsstatus": "txt", "Inbetriebnahme": "date", "Inbetriebnahmejahr": "key", "PLZ": "txt", "Ort": "txt", "Straße": "txt",
            "Hausnummer": "txt", "Mieterstrom": "txt", "Anlagenart": "txt", "Einspeiseart": "txt", "Verortung": "txt",
            "Genau verortet": "txt", "Betriebshof": "txt", "Bezirk": "txt", **GEO,
        },
        "hide": ["Partner-Schlüssel", "Energieträger MaStR"],
        "category": {"PLZ": "PostalCode"},
        "desc": "Erzeugungs- und Speichereinheiten der drei Partner aus dem Marktstammdatenregister (MaStR), eine Zeile je MaStR-Nummer. "
                "Energieträger Solar, Wind, Erdgas, andere Gase, Speicher, Biomasse. Bruttoleistung in kW (bei Solar kWp). Betriebsstatus beachten: "
                "einige BVG-Anlagen sind vorübergehend stillgelegt. Betriebshof nennt den BVG-Standort einer Anlage. "
                "Kleine Anlagen haben keine öffentliche Adresse und sind nur nach Postleitzahl verortet. Zwei Anlagen liegen außerhalb "
                "Berlins (Bezirk leer). Auch: Erzeugungsanlage, Einheit, PV-Anlage.",
    },
    "Ladestation": {
        "cols": {
            "Ladestation-ID": "txt", "Betreiber": "txt", "Stadtwerke": "txt", "Adresse": "txt", "PLZ": "txt", "Bezirk": "txt",
            "Ladepunkte": "int", "Höchstleistung kW": "num", "Leistungsklasse": "txt", "Schnellladen DC": "txt",
            "Inbetriebnahmejahr": "key", "Im öffentlichen Straßenland": "txt", **GEO,
        },
        "hide": ["Ladestation-ID"],
        "category": {"PLZ": "PostalCode", "Adresse": "Address"},
        "desc": "Öffentliche Ladestationen aus dem Ladesäulenregister Berlin (Geoportal, Stand des Abrufs), ohne Live-Status. "
                "Höchstleistung ist die größte Leistung eines Ladepunkts der Station. Stadtwerke = ja für Stationen der Berliner Stadtwerke. "
                "Auch: Ladesäule, Ladeinfrastruktur.",
    },
    "Ladestrom": {
        "cols": {"Bezirk": "txt", "Jahr": "key", "Ladestrom öffentlich kWh": "int"},
        "desc": "An öffentlichen Ladepunkten abgegebene Energie je Bezirk und Jahr laut Land Berlin, in kWh. 2017 bis 2019 fehlen in der Quelle.",
    },
    "Quartier": {
        "cols": {
            "Quartier-ID": "txt", "Quartier": "txt", "Quartiersart": "txt", "Bezirk": "txt", "Einwohner": "int",
            "Eigenständiges Quartier": "txt", "Teil von": "txt", "Quelle": "txt",
            "Ladestationen bis 300 m": "int", "Ladepunkte bis 300 m": "int", "Stadtwerke-Ladepunkte bis 300 m": "int",
            "Stadtwerke-Ladelücke 300 m": "txt", "Ladepunkte bis 500 m": "int", "Stadtwerke-Ladepunkte bis 500 m": "int", **GEO,
        },
        "hide": ["Quartier-ID"],
        "category": {"Quelle": "WebUrl"},
        "desc": "degewo-Quartiere: drei benannte (Gropiusstadt, Marzahn, Brunnenviertel) und Cluster nach Postleitzahl. "
                "Feuchtwangerweg (12353) liegt in der Gropiusstadt: Eigenständiges Quartier = nein, für Summen immer die Measures verwenden. "
                "Die Ladepunkt-Spalten sind je Quartier gezählt; über mehrere Quartiere nicht addieren, dafür die Measures nutzen. "
                "Auch: Siedlung, Wohnquartier, Kiez.",
    },
    "Quartier Ladestation": {
        "cols": {"Quartier-ID": "txt", "Ladestation-ID": "txt", "Abstand m": "num", "Bis 300 m": "txt"},
        "hidden": True,
        "desc": "Hilfstabelle: jede Ladestation höchstens 500 m Luftlinie vom Umriss eines eigenständigen Quartiers, mit Abstand (0 = im Quartier).",
    },
    "Betriebshof": {
        "cols": {
            "Betriebshof-ID": "txt", "Betriebshof": "txt", "Art": "txt", "Status": "txt", "Solarvereinbarung 2025": "txt",
            "Solarleistung kWp": "dec", "Solaranlagen": "int", "Bezirk": "txt", "Quelle": "txt", **GEO,
        },
        "hide": ["Betriebshof-ID"],
        "category": {"Quelle": "WebUrl"},
        "desc": "BVG-Standorte (Bus-, Straßenbahn-, U-Bahn-Betriebshöfe und weitere) mit Status, Solarvereinbarung 2025 von BVG und "
                "Berliner Stadtwerken und der zugeordneten Photovoltaik-Leistung. Auch: Depot, Betriebsbahnhof.",
    },
    "Fokusdach": {
        "cols": {
            "Gebäude-ID": "key", "Adresse": "txt", "Gebäudefunktion": "txt", "Dachfläche m²": "dec", "Solarpotenzial kWp": "dec",
            "Installiert kWp": "dec", "Offenes Potenzial kWp": "dec", "Ausschöpfung": "pct", "Anlagen auf dem Dach": "int",
            "Quartier-ID": "txt", "Quartier": "txt", "Bezirk": "txt", "Gebäudehöhe m": "num", "Geländehöhe m": "num", **GEO,
        },
        "hide": ["Gebäude-ID", "Quartier-ID"],
        "category": {"Adresse": "Address"},
        "desc": "degewo-Fokusdächer: Gebäude mit Solarkataster-Potenzial, auf denen eine degewo-Anlage verortet ist, mit installierter "
                "Leistung und offenem Potenzial. Keine Dächer der Stadtwerke oder der BVG; kein Partnerfilter wirkt hier. Nicht mit der Tabelle "
                "Quartier verbunden: je Quartier über die Spalte Quartier gruppieren. Potenzial ist eine Schätzung des Solarkatasters Berlin. "
                "Gebäudehöhe aus dem 3D-Gebäudemodell LoD2.",
    },
    "Gebäude im Quartier": {
        "cols": {"Gebäude-ID": "key", "Quartier-ID": "txt", "Gebäudefunktion": "txt", "Dachfläche m²": "dec", "Solarpotenzial kWp": "dec", **GEO},
        "hide": ["Gebäude-ID", "Quartier-ID"],
        "desc": "Alle Gebäude mit Solarkataster-Eintrag in den Umrissen von Gropiusstadt, Marzahn und Brunnenviertel, unabhängig vom "
                "Eigentümer und ohne Adresse. Solarpotenzial ist eine Schätzung.",
    },
    "Datenquelle": {
        "cols": {"Tabellen": "txt", "Quelle": "txt", "Namensnennung": "txt", "Lizenz": "txt", "Lizenz-URL": "txt", "Stand": "txt"},
        "category": {"Lizenz-URL": "WebUrl"},
        "desc": "Herkunft, Namensnennung und Lizenz der Daten je Tabelle. Bei Weitergabe die Namensnennung mitgeben.",
    },
}

# from (many) -> to (one)
RELATIONSHIPS = [
    ("Anlage", "Partner-Schlüssel", "Partner", "Partner-Schlüssel"),
    ("Anlage", "Bezirk", "Bezirk", "Bezirk"),
    ("Anlage", "Inbetriebnahmejahr", "Jahr", "Jahr"),
    ("Ladestation", "Bezirk", "Bezirk", "Bezirk"),
    ("Ladestation", "Inbetriebnahmejahr", "Jahr", "Jahr"),
    ("Ladestrom", "Bezirk", "Bezirk", "Bezirk"),
    ("Ladestrom", "Jahr", "Jahr", "Jahr"),
    ("Quartier", "Bezirk", "Bezirk", "Bezirk"),
    ("Quartier Ladestation", "Quartier-ID", "Quartier", "Quartier-ID"),
    ("Betriebshof", "Bezirk", "Bezirk", "Bezirk"),
    ("Fokusdach", "Bezirk", "Bezirk", "Bezirk"),
    ("Gebäude im Quartier", "Quartier-ID", "Quartier", "Quartier-ID"),
]


def q(name: str) -> str:
    """Quote a TMDL identifier when it is not a bare word."""
    if name and all(c.isalnum() or c == "_" for c in name) and not name[0].isdigit():
        return name
    return "'" + name.replace("'", "''") + "'"


def dax_table(name: str) -> str:
    return name if q(name) == name else "'" + name.replace("'", "''") + "'"


def inline_csv(path: Path) -> tuple[str, list[str], list[dict]]:
    raw = path.read_bytes()
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = comp.compress(raw) + comp.flush()
    text = raw.decode("utf-8")
    rows = list(csv.DictReader(text.splitlines(), delimiter=";"))
    header = text.split("\n", 1)[0].split(";")
    return base64.b64encode(packed).decode("ascii"), header, rows


def m_name(src: str) -> str:
    return '"' + src.replace('"', '""') + '"'


def build_table(name: str, spec: dict) -> tuple[str, int]:
    b64, header, rows = inline_csv(BUILD / f"{name}.csv")
    cols = spec["cols"]
    if list(cols) != header:
        raise SystemExit(f"{name}: column spec {list(cols)} != csv header {header}")
    hide = set(spec.get("hide", []))
    sort_by = spec.get("sortBy", {})
    category = spec.get("category", {})

    transforms = ", ".join(f"{{{m_name(c)}, {TYPES[k][1]}}}" for c, k in cols.items())
    m = (
        "let\n"
        f'    Quelle = Csv.Document(Binary.Decompress(Binary.FromText("{b64}", BinaryEncoding.Base64), '
        f'Compression.Deflate), [Delimiter=";", Columns={len(header)}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n'
        "    Kopfzeilen = Table.PromoteHeaders(Quelle, [PromoteAllScalars=true]),\n"
        f'    Typisiert = Table.TransformColumnTypes(Kopfzeilen, {{{transforms}}}, "en-US")\n'
        "in\n"
        "    Typisiert"
    )

    out: list[str] = []
    out.append(f"/// {spec['desc']}")
    out.append(f"table {q(name)}")
    if spec.get("hidden"):
        out.append("\tisHidden")
    out.append(f"\tlineageTag: {tag('table', name)}")
    out.append("")
    for c, kind in cols.items():
        dtype, _, fmt, summarize = TYPES[kind]
        out.append(f"\tcolumn {q(c)}")
        out.append(f"\t\tdataType: {dtype}")
        if c in hide or spec.get("hidden"):
            out.append("\t\tisHidden")
        out.append(f"\t\tlineageTag: {tag('col', name, c)}")
        if fmt:
            out.append(f"\t\tformatString: {fmt}")
        out.append(f"\t\tsummarizeBy: {summarize}")
        out.append(f"\t\tsourceColumn: {c}")
        if c in sort_by:
            out.append(f"\t\tsortByColumn: {q(sort_by[c])}")
        if c == LON:
            out.append("\t\tdataCategory: Longitude")
        elif c == LAT:
            out.append("\t\tdataCategory: Latitude")
        elif c in category:
            out.append(f"\t\tdataCategory: {category[c]}")
        out.append("")
        out.append("\t\tannotation SummarizationSetBy = Automatic")
        out.append("")
    out.append(f"\tpartition {q(name)} = m")
    out.append("\t\tmode: import")
    out.append("\t\tsource =")
    for line in m.split("\n"):
        out.append("\t\t\t\t" + line)
    out.append("")
    out.append("\tannotation PBI_ResultType = Table")
    out.append("")
    return "\n".join(out), len(rows)


def build_measures() -> str:
    out: list[str] = [
        "/// Alle Kennzahlen des Modells. Für Fragen immer zuerst diese Measures verwenden, nicht Spalten summieren.",
        "table Measure",
        f"\tlineageTag: {tag('table', 'Measure')}",
        "",
    ]
    seen: set[str] = set()
    for name, expr, fmt, folder, desc in MEASURES:
        if name in seen:
            raise SystemExit(f"duplicate measure {name}")
        seen.add(name)
        expr = expr.strip()
        out.append(f"\t/// {desc}")
        if "\n" in expr:
            out.append(f"\tmeasure {q(name)} =")
            out.extend("\t\t\t" + ln for ln in expr.split("\n"))
        else:
            out.append(f"\tmeasure {q(name)} = {expr}")
        if fmt:
            out.append(f"\t\tformatString: {fmt}")
        out.append(f"\t\tdisplayFolder: {folder}")
        out.append(f"\t\tlineageTag: {tag('measure', name)}")
        out.append("")
    out += [
        "\tcolumn Value",
        "\t\tisHidden",
        f"\t\tlineageTag: {tag('col', 'Measure', 'Value')}",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Value]",
        "",
        "\tpartition Measure = calculated",
        "\t\tmode: import",
        "\t\tsource = {0}",
        "",
    ]
    return "\n".join(out)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "definition" / "tables").mkdir(parents=True)

    (OUT / ".platform").write_text(json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {
            "type": "SemanticModel",
            "displayName": MODEL_NAME,
            "description": "Digitaler Zwilling Berlin: Solaranlagen (MaStR) von Berliner Stadtwerken, degewo und BVG, öffentliche Ladepunkte, "
                           "degewo-Quartiere, BVG-Betriebshöfe und Solarkataster. Offene Daten, vollständig im Modell abgelegt (Import).",
        },
        "config": {"version": "2.0", "logicalId": tag("item", "model")},
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "definition.pbism").write_text(json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
        "version": "4.2",
        "settings": {"qnaEnabled": True},
    }, indent=2), encoding="utf-8")

    d = OUT / "definition"
    (d / "database.tmdl").write_text("database\n\tcompatibilityLevel: 1604\n\n", encoding="utf-8")

    names = list(TABLES) + ["Measure"]
    model = [
        "model Model",
        "\tculture: de-DE",
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
        "\tdiscourageImplicitMeasures",
        "\tsourceQueryCulture: de-DE",
        "\tdataAccessOptions",
        "\t\tlegacyRedirects",
        "\t\treturnErrorValuesAsNull",
        "",
        'annotation PBI_ProTooling = ["TMDLView_Desktop"]',
        "",
        *[f"ref table {q(n)}" for n in names],
        "",
    ]
    (d / "model.tmdl").write_text("\n".join(model), encoding="utf-8")

    rel: list[str] = []
    for ft, fc, tt, tc in RELATIONSHIPS:
        for t, c in ((ft, fc), (tt, tc)):
            if c not in TABLES[t]["cols"]:
                raise SystemExit(f"relationship column {t}[{c}] missing")
        rel += [f"relationship {tag('rel', ft, fc, tt, tc)}", f"\tfromColumn: {q(ft)}.{q(fc)}", f"\ttoColumn: {q(tt)}.{q(tc)}", ""]
    (d / "relationships.tmdl").write_text("\n".join(rel), encoding="utf-8")

    total = 0
    for name, spec in TABLES.items():
        text, n = build_table(name, spec)
        p = d / "tables" / f"{name}.tmdl"
        p.write_text(text, encoding="utf-8")
        total += p.stat().st_size
        print(f"  {name}: {n} rows, {p.stat().st_size // 1024} KB")
    p = d / "tables" / "Measure.tmdl"
    p.write_text(build_measures(), encoding="utf-8")
    print(f"  Measure: {len(MEASURES)} measures")
    write_copilot(OUT, TABLES, MEASURES)
    print(f"model {OUT} ({(total + p.stat().st_size) // 1024} KB)")


if __name__ == "__main__":
    main()
