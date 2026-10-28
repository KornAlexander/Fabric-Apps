"""Copilot / Fabric IQ preparation ("Prep data for AI") for the import model.

Writes <Model>.SemanticModel/Copilot: AI data schema with synonyms, AI
instructions and example prompts. Same file layout as the EuroUni-Insights
model (repos/EuroUni-Insights), which was published with it.
"""
from __future__ import annotations

import json
from pathlib import Path

V = "https://developer.microsoft.com/json-schemas/fabric/item/version/1.0.0/schema.json"
COPILOT = "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/copilot"

TABLE_SYNONYMS = {
    "Partner": ["Unternehmen", "Landesunternehmen", "Gesellschaft", "partner company"],
    "Bezirk": ["Stadtbezirk", "Bezirke", "district", "borough"],
    "Jahr": ["Inbetriebnahmejahr", "year"],
    "Anlage": ["Erzeugungsanlage", "Einheit", "MaStR-Einheit", "PV-Anlage", "Solaranlage", "Kraftwerk", "unit", "plant"],
    "Ladestation": ["Ladesäule", "Ladepunkt", "Ladeinfrastruktur", "E-Ladesäule", "charging station", "charger"],
    "Ladestrom": ["Ladeenergie", "geladene Energie", "charged energy"],
    "Quartier": ["Siedlung", "Wohnquartier", "Kiez", "degewo-Quartier", "Wohnanlage", "estate"],
    "Betriebshof": ["Depot", "Betriebsbahnhof", "BVG-Standort", "Busdepot", "depot"],
    "Fokusdach": ["Dach", "Dachfläche", "Gebäude", "Fokusgebäude", "roof"],
    "Gebäude im Quartier": ["Gebäude", "Häuser", "buildings in estate"],
    "Datenquelle": ["Quelle", "Lizenz", "source"],
}
COLUMN_SYNONYMS = {
    ("Partner", "Partner"): ["Unternehmen", "Stadtwerke", "degewo", "BVG"],
    ("Anlage", "Energieträger"): ["Energiequelle", "Technologie", "Brennstoff", "energy source"],
    ("Anlage", "Bruttoleistung kW"): ["Leistung", "Nennleistung", "kWp", "capacity"],
    ("Anlage", "Inbetriebnahme"): ["Inbetriebnahmedatum", "seit wann in Betrieb", "commissioning date"],
    ("Anlage", "Mieterstrom"): ["Mieterstromanlage", "tenant electricity"],
    ("Anlage", "Betreiber"): ["Anlagenbetreiber", "Eigentümer", "operator"],
    ("Ladestation", "Stadtwerke"): ["von den Stadtwerken", "Stadtwerke-Ladestation", "BSW"],
    ("Ladestation", "Betreiber"): ["Ladepunktbetreiber", "Anbieter", "operator"],
    ("Ladestation", "Schnellladen DC"): ["Schnelllader", "DC", "HPC", "fast charging"],
    ("Ladestation", "Höchstleistung kW"): ["Ladeleistung", "kW", "power"],
    ("Quartier", "Stadtwerke-Ladelücke 300 m"): ["Ladelücke", "ohne Stadtwerke-Ladepunkt", "Versorgungslücke"],
    ("Betriebshof", "Solarvereinbarung 2025"): ["Solarvertrag", "Vereinbarung mit den Stadtwerken"],
    ("Fokusdach", "Offenes Potenzial kWp"): ["freies Potenzial", "ungenutztes Potenzial", "noch möglich"],
}
MEASURE_SYNONYMS = {
    "Solarleistung kWp": ["PV-Leistung", "Photovoltaikleistung", "Solarkapazität", "installierte Solarleistung", "solar capacity"],
    "Solaranlagen": ["Anzahl PV-Anlagen", "Photovoltaikanlagen", "number of solar plants"],
    "Ladepunkte": ["Anzahl Ladepunkte", "öffentliche Ladepunkte", "charge points"],
    "Ladepunkte Stadtwerke": ["Stadtwerke-Ladepunkte", "BSW-Ladepunkte"],
    "Anteil Stadtwerke an Ladepunkten": ["Marktanteil Stadtwerke", "Stadtwerke-Anteil"],
    "Offenes Potenzial Fokusdächer kWp": ["Dachpotenzial", "freies Solarpotenzial"],
    "Quartiere ohne Stadtwerke-Ladepunkt": ["Ladelücken", "Quartiere mit Ladelücke"],
    "Einwohner": ["Bevölkerung Bezirk", "Einwohner Berlin", "population"],
    "Einwohner Quartiere": ["Einwohner im Quartier", "Bewohner des Quartiers", "Bevölkerung Quartier"],
    "Ladestrom öffentlich kWh": ["Ladestrom", "geladene Energie", "Ladeenergie"],
}

INSTRUCTIONS_TEMPLATE = """# Berliner Stadtwerke Zwilling: Hinweise für Copilot und Fabric IQ

Antworte in der Sprache der Frage (Deutsch oder Englisch). Nenne Einheiten (kWp, kW, kWh) und bei Schätzungen das Wort "Schätzung".

## Die drei wichtigsten Regeln
1. **Immer die Measures der Tabelle `Measure` verwenden**, keine Spalten selbst summieren. Besonders die Ladepunkt-Spalten der Tabelle `Quartier` dürfen nicht über mehrere Quartiere addiert werden (ein Ladepunkt kann nahe zwei Quartieren liegen); dafür gibt es `[Ladepunkte bis 300 m um Quartiere]` und `[Stadtwerke-Ladepunkte bis 300 m um Quartiere]`.
2. **"Solar" heißt nur Photovoltaik.** `[Solarleistung kWp]` und `[Solaranlagen]` zählen nur den Energieträger Solar. `[Installierte Leistung kW]` enthält zusätzlich Wind, Erdgas, andere Gase, Speicher und Biomasse; nenne das ausdrücklich, wenn du es verwendest.
3. **Partner über `Partner[Partner]` filtern** ("Berliner Stadtwerke", "degewo", "BVG"). Jede Anlage gehört genau einem Partner. Ladestationen hängen nicht an der Tabelle Partner: Stadtwerke-Ladepunkte über `[Ladepunkte Stadtwerke]` oder `Ladestation[Stadtwerke] = "ja"`.

## Was das Modell enthält
- **Anlage:** {units} Erzeugungs- und Speichereinheiten der Berliner Stadtwerke ({units_bsw}), der degewo ({units_degewo}) und der BVG ({units_bvg}) aus dem Marktstammdatenregister, abgerufen am {mastr_date}. Solar: Stadtwerke {mwp_bsw} MWp in {solar_bsw} Anlagen, degewo {mwp_degewo} MWp, BVG {mwp_bvg} MWp. Dazu {other_mw} MW anderer Energieträger (der größte Block ist Wind der Stadtwerke in Großbeeren, außerhalb Berlins).
- **Ladestation:** {stations} öffentliche Ladestationen mit {points} Ladepunkten aus dem Ladesäulenregister Berlin, davon {bsw_points} Ladepunkte der Berliner Stadtwerke (rund {bsw_share} Prozent). Registerdaten, kein Live-Status. Private Ladepunkte nur in `[Ladepunkte Register gesamt]` (je Bezirk, Land Berlin); nie mit `[Ladepunkte]` addieren.
- **Quartier:** degewo-Quartiere: Gropiusstadt, Marzahn, Brunnenviertel und Cluster nach Postleitzahl. Feuchtwangerweg (12353) liegt in der Gropiusstadt und zählt dort mit; daher {estates} Quartiere. Bis 300 m Luftlinie um diese Quartiere liegen {near} öffentliche Ladepunkte, {bsw_near} davon von den Stadtwerken (rund {near_share} Prozent). Ladelücke der Stadtwerke (kein Stadtwerke-Ladepunkt bis 300 m): {gaps}.
- **Fokusdach:** {roofs} degewo-Dächer (Gebäude mit einer degewo-Anlage) mit geschätztem Solarpotenzial (Solarkataster), installierter Leistung und offenem Potenzial. Keine Dächer der Stadtwerke oder der BVG; der Partnerfilter wirkt hier nicht. Je Quartier über `Fokusdach[Quartier]` gruppieren, nicht über die Tabelle Quartier. **Gebäude im Quartier:** alle Gebäude mit Solarkataster-Eintrag in Gropiusstadt, Marzahn und Brunnenviertel, unabhängig vom Eigentümer.
- **Betriebshof:** {depots} BVG-Standorte, {depots_building} im Bau, mit der Solarvereinbarung 2025 von BVG und Stadtwerken.
- **Bezirk:** 12 Bezirke, Einwohner laut Einwohnerregister 31.12.2025 (rund {residents_mio} Millionen; höher als die amtliche Zensuszahl 3,7 Millionen).
- **Ladestrom:** öffentlicher Ladestrom je Bezirk und Jahr in kWh; 2017 bis 2019 fehlen in der Quelle.

## Jahre
- `Jahr[Jahr]` ist das Inbetriebnahmejahr (Anlage, Ladestation) bzw. das Verbrauchsjahr (Ladestrom). Nach Jahr gefiltert zeigt `[Solarleistung kWp]` den Zubau in diesem Jahr, nicht den Bestand; für den Bestand bis zu einem Jahr `[Solarleistung kumuliert kWp]`.
- Ohne Jahresfilter zeigen die Anlagen- und Ladestations-Measures den heutigen Bestand. `[Ladestrom öffentlich kWh]` ist dagegen eine Summe über alle Jahre der Quelle; für "wie viel Ladestrom" immer ein Jahr nennen (das letzte ist {last_kwh_year}).

## Einwohner und Status
- `[Einwohner]` gilt für Berlin oder je Bezirk und ist leer, sobald nach Quartier gefiltert wird. Für Quartiere `[Einwohner Quartiere]`.
- `[Solarleistung kWp]` zählt wie die App alle registrierten Solaranlagen, auch vorübergehend oder endgültig stillgelegte ({stopped_kw} kWp, alle bei der BVG). Nur laufende Anlagen: `[Solarleistung in Betrieb kWp]`; bei der BVG den Unterschied nennen.

## Was die Daten nicht sagen
- Potenziale sind Schätzungen des Solarkatasters, keine Planung.
- Abstände sind Luftlinie zum Quartiersumriss, kein Fußweg.
- "erwartet nach Einwohnern" ist ein Rechenwert (Verteilung nach Einwohneranteil), kein Ziel.
- Kleine Solaranlagen haben im Register keine Adresse und sind nur nach Postleitzahl verortet (`Anlage[Verortung] = "nur Postleitzahl"`).
- Es gibt keine Netz-, Last- oder Erzeugungszeitreihen.

## Namen und Schreibweisen
- Berliner Stadtwerke = Stadtwerke = BSW = Berliner Stadtwerke EnergiePartner. degewo wird klein geschrieben. BVG = Berliner Verkehrsbetriebe.
- Quartiere über `Quartier[Quartier]` mit CONTAINSSTRING suchen (z. B. "Gropiusstadt", "Himbeersteig").
"""

EXAMPLE_PROMPTS = [
    "Wie viel Solarleistung haben die Berliner Stadtwerke, die degewo und die BVG jeweils installiert?",
    "In welchem Bezirk betreiben die Stadtwerke die meisten öffentlichen Ladepunkte, und wie hoch ist ihr Anteil dort?",
    "Welche degewo-Quartiere haben keinen Ladepunkt der Stadtwerke im Umkreis von 300 Metern?",
    "Auf welchen Dächern ist noch das meiste Solarpotenzial frei?",
    "Wie hat sich der Solarzubau der Partner seit 2015 je Jahr entwickelt?",
    "Welche BVG-Betriebshöfe gehören zur Solarvereinbarung 2025 und wie viel kWp haben sie?",
    "How many public charge points per 1,000 residents does each district have?",
]


def _de(x: float, digits: int = 1) -> str:
    return f"{x:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def instructions(build: Path) -> str:
    """The instructions with every figure read from the exported tables, so a re-bake cannot leave them stale."""
    import csv

    def rows(name: str) -> list[dict]:
        return list(csv.DictReader((build / f"{name}.csv").read_text(encoding="utf-8").splitlines(), delimiter=";"))

    exp = json.loads((build / "expected.json").read_text(encoding="utf-8"))
    units = rows("Anlage")
    st = rows("Ladestation")
    dep = rows("Betriebshof")
    src = {r["Tabellen"]: r["Stand"] for r in rows("Datenquelle")}
    by = lambda p: sum(1 for u in units if u["Partner-Schlüssel"] == p)  # noqa: E731
    pts = sum(int(r["Ladepunkte"]) for r in st)
    d = exp["mastr_date"] if "mastr_date" in exp else next(v for k, v in src.items() if k.startswith("Anlage"))
    y, m, dd = d.split("-")
    return INSTRUCTIONS_TEMPLATE.format(
        units=len(units), units_bsw=by("bsw"), units_degewo=by("degewo"), units_bvg=by("bvg"), mastr_date=f"{dd}.{m}.{y}",
        mwp_bsw=_de(exp["solarKwp"]["bsw"] / 1000), mwp_degewo=_de(exp["solarKwp"]["degewo"] / 1000), mwp_bvg=_de(exp["solarKwp"]["bvg"] / 1000),
        solar_bsw=exp["solarUnits"]["bsw"], other_mw=_de(exp["otherKw"] / 1000),
        stations=_de(len(st), 0), points=_de(pts, 0), bsw_points=_de(exp["bswChargingPoints"], 0),
        bsw_share=round(100 * exp["bswChargingPoints"] / pts), estates=exp["estates"], near=exp["pointsNear300"], bsw_near=exp["bswPointsNear300"],
        near_share=round(100 * exp["bswPointsNear300"] / exp["pointsNear300"]), gaps=", ".join(exp["bswGaps300"]) or "keine",
        roofs=len(rows("Fokusdach")), depots=len(dep), depots_building=sum(1 for r in dep if r["Status"] == "im Bau"),
        residents_mio=_de(exp["residents"] / 1e6),
        last_kwh_year=max(int(r["Jahr"]) for r in rows("Ladestrom")),
        stopped_kw=_de(sum(float(u["Bruttoleistung kW"] or 0) for u in units if u["Energieträger"] == "Solar" and u["Betriebsstatus"] != "In Betrieb"), 0),
    )


def _dump(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def write_copilot(model_dir: Path, tables: dict[str, dict], measures: list[tuple]) -> None:
    c = model_dir / "Copilot"
    _dump(c / "version.json", {"$schema": V, "version": "1.0.0"})
    _dump(c / "settings.json", {"$schema": f"{COPILOT}/settings/1.0.0/schema.json", "indexingEnabled": True})
    _dump(c / "examplePrompts.json", {"$schema": f"{COPILOT}/examplePrompts/1.0.0/schema.json", "prompts": EXAMPLE_PROMPTS})
    (c / "Instructions").mkdir(parents=True, exist_ok=True)
    (c / "Instructions" / "instructions.md").write_text(instructions(model_dir.parent.parent / "build"), encoding="utf-8")
    _dump(c / "Instructions" / "version.json", {"$schema": V, "version": "1.0.0"})

    schema_tables = []
    for name, spec in tables.items():
        hidden = spec.get("hidden", False)
        t: dict = {"name": name, "visibility": "Hidden" if hidden else "Visible"}
        if name in TABLE_SYNONYMS:
            t["synonyms"] = TABLE_SYNONYMS[name]
        cols = []
        for col in spec["cols"]:
            entry: dict = {"name": col, "visibility": "Hidden" if hidden or col in spec.get("hide", []) else "Visible"}
            if (name, col) in COLUMN_SYNONYMS:
                entry["synonyms"] = COLUMN_SYNONYMS[(name, col)]
            cols.append(entry)
        t["columns"] = cols
        schema_tables.append(t)
    ms = []
    for m in measures:
        entry = {"name": m[0], "visibility": "Visible"}
        if m[0] in MEASURE_SYNONYMS:
            entry["synonyms"] = MEASURE_SYNONYMS[m[0]]
        ms.append(entry)
    schema_tables.append({"name": "Measure", "visibility": "Visible", "measures": ms})
    for key in [*COLUMN_SYNONYMS, *MEASURE_SYNONYMS, *TABLE_SYNONYMS]:
        tn, cn = key if isinstance(key, tuple) else (key, None)
        if cn is None and tn not in tables and tn not in [m[0] for m in measures]:
            raise SystemExit(f"synonym for unknown {key}")
        if cn is not None and cn not in tables.get(tn, {}).get("cols", {}):
            raise SystemExit(f"synonym for unknown column {key}")
    _dump(c / "schema.json", {"$schema": f"{COPILOT}/schema/1.0.0/schema.json", "tables": schema_tables})
