"""Measures of the import model, all on the `Measure` home table.

(name, DAX, format string, display folder, description). The description is what
Copilot and Fabric IQ read first, so it says what is counted, what is NOT counted
and which unit the number has.
"""
from __future__ import annotations

KW = "#,0.0"
KWH = "#,0"
N = "#,0"
PCT = "0.0 %"

SOLAR = 'KEEPFILTERS ( Anlage[Energieträger] = "Solar" )'
OWN = 'KEEPFILTERS ( Quartier[Eigenständiges Quartier] = "ja" )'

def near(measure: str, flt: str | None) -> str:
    """Charge points near the estates, each station once (TREATAS over the distinct station ids)."""
    filters = ([flt] if flt else []) + [OWN]
    return (
        "VAR ids =\n"
        "    CALCULATETABLE (\n"
        "        VALUES ( 'Quartier Ladestation'[Ladestation-ID] ),\n"
        + ",\n".join(f"        {f}" for f in filters)
        + "\n    )\n"
        "RETURN\n"
        + "    IF (\n"
        "        NOT ISEMPTY ( ids ),\n"
        f"        CALCULATE ( {measure}, TREATAS ( ids, Ladestation[Ladestation-ID] ), REMOVEFILTERS ( Bezirk ), REMOVEFILTERS ( Ladestation[Bezirk] ) )\n"
        "    )"
    )


def prior_year(measure: str) -> str:
    return (
        "VAR y = MAX ( Jahr[Jahr] )\n"
        "RETURN\n"
        f"    IF ( HASONEVALUE ( Jahr[Jahr] ), CALCULATE ( {measure}, REMOVEFILTERS ( Jahr ), Jahr[Jahr] = y - 1 ) )"
    )


def cumulative(measure: str) -> str:
    return (
        "VAR y = MAX ( Jahr[Jahr] )\n"
        "RETURN\n"
        f"    CALCULATE ( {measure}, REMOVEFILTERS ( Jahr ), Jahr[Jahr] <= y )"
    )


def expected_by_residents(measure: str) -> str:
    return (
        f"VAR stadt = CALCULATE ( {measure}, REMOVEFILTERS ( Bezirk ) )\n"
        "VAR einwohnerStadt = CALCULATE ( [Einwohner], REMOVEFILTERS ( Bezirk ) )\n"
        "RETURN\n"
        "    IF ( HASONEVALUE ( Bezirk[Bezirk] ), DIVIDE ( stadt, einwohnerStadt ) * [Einwohner] )"
    )


MEASURES: list[tuple[str, str, str | None, str, str]] = [
    # ---------------------------------------------------------------- Solar und Anlagen
    ("Solarleistung kWp", f"CALCULATE ( SUM ( Anlage[Bruttoleistung kW] ), {SOLAR} )", KW, "Solar und Anlagen",
     "Registrierte Photovoltaik-Leistung in kWp (Bruttoleistung laut Marktstammdatenregister), nur Energieträger Solar, "
     "alle Betriebsstatus inklusive vorübergehend oder endgültig stillgelegter Anlagen (wie in der App). Nur laufende Anlagen: "
     "[Solarleistung in Betrieb kWp]. Nach Partner filtern für Berliner Stadtwerke, degewo oder BVG. Auch: PV-Leistung, Solarkapazität."),
    ("Solarleistung in Betrieb kWp", 'CALCULATE ( [Solarleistung kWp], KEEPFILTERS ( Anlage[Betriebsstatus] = "In Betrieb" ) )', KW,
     "Solar und Anlagen",
     "Photovoltaik-Leistung in kWp nur der Anlagen mit Betriebsstatus In Betrieb, ohne vorübergehend oder endgültig stillgelegte."),
    ("Solarleistung MWp", "DIVIDE ( [Solarleistung kWp], 1000 )", "#,0.0", "Solar und Anlagen",
     "Wie Solarleistung kWp, in Megawatt peak (1 MWp = 1.000 kWp)."),
    ("Solaranlagen", f"CALCULATE ( COUNTROWS ( Anlage ), {SOLAR} )", N, "Solar und Anlagen",
     "Anzahl Photovoltaikanlagen (MaStR-Einheiten mit Energieträger Solar). Eine Zeile je MaStR-Nummer, keine Doppelzählung."),
    ("Anlagen", "COUNTROWS ( Anlage )", N, "Solar und Anlagen",
     "Anzahl aller Erzeugungs- und Speichereinheiten der Partner im Marktstammdatenregister, alle Energieträger."),
    ("Installierte Leistung kW", "SUM ( Anlage[Bruttoleistung kW] )", KW, "Solar und Anlagen",
     "Bruttoleistung aller Energieträger in kW (Solar, Wind, Erdgas, andere Gase, Speicher, Biomasse). "
     "Für Photovoltaik allein [Solarleistung kWp] verwenden."),
    ("Leistung andere Energieträger kW",
     'CALCULATE ( SUM ( Anlage[Bruttoleistung kW] ), KEEPFILTERS ( Anlage[Energieträger] <> "Solar" ) )', KW, "Solar und Anlagen",
     "Bruttoleistung aller Energieträger außer Solar in kW (Wind, Erdgas, andere Gase, Speicher, Biomasse)."),
    ("Mieterstrom-Solaranlagen", 'CALCULATE ( [Solaranlagen], KEEPFILTERS ( Anlage[Mieterstrom] = "ja" ) )', N, "Solar und Anlagen",
     "Photovoltaikanlagen, die laut Marktstammdatenregister Mieterstrom liefern."),
    ("Mieterstrom-Solarleistung kWp", 'CALCULATE ( [Solarleistung kWp], KEEPFILTERS ( Anlage[Mieterstrom] = "ja" ) )', KW, "Solar und Anlagen",
     "Photovoltaik-Leistung der Mieterstromanlagen in kWp."),
    ("Solaranlagen nur nach PLZ verortet",
     'CALCULATE ( [Solaranlagen], KEEPFILTERS ( Anlage[Verortung] = "nur Postleitzahl" ) )', N, "Solar und Anlagen",
     "Photovoltaikanlagen ohne öffentliche Adresse oder Koordinate (kleine Anlagen); sie sind nur der Postleitzahl zugeordnet."),
    ("Mittlere Solaranlagengröße kWp", "DIVIDE ( [Solarleistung kWp], [Solaranlagen] )", KW, "Solar und Anlagen",
     "Durchschnittliche Leistung einer Photovoltaikanlage in kWp."),
    ("Solarleistung je 1.000 Einwohner kWp", "DIVIDE ( [Solarleistung kWp], [Einwohner] ) * 1000", KW, "Solar und Anlagen",
     "Photovoltaik-Leistung in kWp je 1.000 Einwohner des Bezirks (Einwohnerregister 31.12.2025)."),
    ("Solarleistung erwartet nach Einwohnern kWp", expected_by_residents("[Solarleistung kWp]"), KW, "Solar und Anlagen",
     "Rechenwert, kein Ziel: die stadtweite Solarleistung (im aktuellen Partnerfilter) auf den Bezirk nach seinem Einwohneranteil "
     "verteilt. Nur je Bezirk definiert."),
    ("Solarleistung Vorjahr kWp", prior_year("[Solarleistung kWp]"), KW, "Solar und Anlagen",
     "Im Vorjahr in Betrieb genommene Photovoltaik-Leistung in kWp, für den Vergleich je Inbetriebnahmejahr. Nur je Jahr definiert."),
    ("Solarleistung kumuliert kWp", cumulative("[Solarleistung kWp]"), KW, "Solar und Anlagen",
     "Photovoltaik-Leistung aller bis einschließlich zum Jahr in Betrieb genommenen Anlagen in kWp (Bestand heute registrierter Anlagen)."),
    # ------------------------------------------------------------------------- Laden
    ("Ladestationen", "COUNTROWS ( Ladestation )", N, "Laden",
     "Anzahl öffentlicher Ladestationen im Ladesäulenregister Berlin (Geoportal), ohne Live-Status."),
    ("Ladepunkte", "SUM ( Ladestation[Ladepunkte] )", N, "Laden",
     "Anzahl öffentlicher Ladepunkte im Ladesäulenregister Berlin. Private Ladepunkte zählt [Ladepunkte Register gesamt]."),
    ("Ladepunkte Stadtwerke", 'CALCULATE ( [Ladepunkte], KEEPFILTERS ( Ladestation[Stadtwerke] = "ja" ) )', N, "Laden",
     "Öffentliche Ladepunkte, die die Berliner Stadtwerke betreiben (inklusive Berliner Stadtwerke EnergiePartner)."),
    ("Ladepunkte andere Betreiber", 'CALCULATE ( [Ladepunkte], KEEPFILTERS ( Ladestation[Stadtwerke] = "nein" ) )', N, "Laden",
     "Öffentliche Ladepunkte aller anderen Betreiber."),
    ("Anteil Stadtwerke an Ladepunkten", "DIVIDE ( [Ladepunkte Stadtwerke], [Ladepunkte] )", PCT, "Laden",
     "Anteil der Berliner Stadtwerke an den öffentlichen Ladepunkten."),
    ("Schnellladepunkte", 'CALCULATE ( [Ladepunkte], KEEPFILTERS ( Ladestation[Schnellladen DC] = "ja" ) )', N, "Laden",
     "Öffentliche Ladepunkte an Stationen mit Gleichstrom-Schnellladen (DC)."),
    ("Ladepunkte je 1.000 Einwohner", "DIVIDE ( [Ladepunkte], [Einwohner] ) * 1000", "#,0.00", "Laden",
     "Öffentliche Ladepunkte je 1.000 Einwohner."),
    ("Ladepunkte erwartet nach Einwohnern", expected_by_residents("[Ladepunkte]"), N, "Laden",
     "Rechenwert, kein Ziel: die stadtweiten öffentlichen Ladepunkte auf den Bezirk nach seinem Einwohneranteil verteilt. "
     "Nur je Bezirk definiert."),
    ("Ladepunkte Stadtwerke erwartet nach Einwohnern", expected_by_residents("[Ladepunkte Stadtwerke]"), N, "Laden",
     "Rechenwert, kein Ziel: die stadtweiten Ladepunkte der Berliner Stadtwerke auf den Bezirk nach seinem Einwohneranteil verteilt. "
     "Nur je Bezirk definiert."),
    ("Ladepunkte Vorjahr", prior_year("[Ladepunkte]"), N, "Laden",
     "Im Vorjahr in Betrieb genommene öffentliche Ladepunkte, für den Vergleich je Inbetriebnahmejahr. Nur je Jahr definiert."),
    ("Ladepunkte Register gesamt", "SUM ( Bezirk[Ladepunkte Register gesamt] )", N, "Laden",
     "Alle Ladepunkte je Bezirk laut Land Berlin, inklusive privater Ladepunkte. Nicht mit [Ladepunkte] addieren."),
    ("Ladestrom öffentlich kWh", "SUM ( Ladestrom[Ladestrom öffentlich kWh] )", KWH, "Laden",
     "An öffentlichen Ladepunkten abgegebene Energie in kWh je Bezirk und Jahr (Land Berlin). Jahre 2017 bis 2019 fehlen in der Quelle."),
    ("Ladestrom öffentlich MWh", "DIVIDE ( [Ladestrom öffentlich kWh], 1000 )", "#,0.0", "Laden",
     "Wie Ladestrom öffentlich kWh, in MWh."),
    ("Ladestrom öffentlich Vorjahr MWh", prior_year("[Ladestrom öffentlich MWh]"), "#,0.0", "Laden",
     "Öffentlicher Ladestrom des Vorjahres in MWh. Nur je Jahr definiert."),
    # ---------------------------------------------------------------------- Quartiere
    ("Quartiere", f"CALCULATE ( COUNTROWS ( Quartier ), {OWN} )", N, "Quartiere",
     "Anzahl degewo-Quartiere. Feuchtwangerweg (12353) liegt in der Gropiusstadt und zählt dort mit, nicht als eigenes Quartier."),
    ("Einwohner Quartiere", f"CALCULATE ( SUM ( Quartier[Einwohner] ), {OWN} )", N, "Quartiere",
     "Einwohner in den Umrissen der degewo-Quartiere (Einwohnerregister 31.12.2025, alle Mieter, nicht nur degewo)."),
    ("Ladepunkte bis 300 m um Quartiere", near("[Ladepunkte]", "KEEPFILTERS ( 'Quartier Ladestation'[Bis 300 m] = \"ja\" )"), N, "Quartiere",
     "Öffentliche Ladepunkte im Quartier oder höchstens 300 m Luftlinie vom Quartiersumriss. Jeder Ladepunkt zählt einmal, "
     "auch wenn er nahe zwei Quartieren liegt."),
    ("Stadtwerke-Ladepunkte bis 300 m um Quartiere",
     near("[Ladepunkte Stadtwerke]", "KEEPFILTERS ( 'Quartier Ladestation'[Bis 300 m] = \"ja\" )"), N, "Quartiere",
     "Ladepunkte der Berliner Stadtwerke im Quartier oder höchstens 300 m Luftlinie vom Umriss, jeder einmal."),
    ("Anteil Stadtwerke bis 300 m um Quartiere",
     "DIVIDE ( [Stadtwerke-Ladepunkte bis 300 m um Quartiere], [Ladepunkte bis 300 m um Quartiere] )", PCT, "Quartiere",
     "Anteil der Berliner Stadtwerke an den Ladepunkten bis 300 m um die degewo-Quartiere (zum Vergleich mit [Anteil Stadtwerke an Ladepunkten] stadtweit)."),
    ("Ladepunkte bis 500 m um Quartiere", near("[Ladepunkte]", None), N, "Quartiere",
     "Öffentliche Ladepunkte im Quartier oder höchstens 500 m Luftlinie vom Quartiersumriss, jeder einmal."),
    ("Stadtwerke-Ladepunkte bis 500 m um Quartiere", near("[Ladepunkte Stadtwerke]", None), N, "Quartiere",
     "Ladepunkte der Berliner Stadtwerke bis 500 m Luftlinie um die degewo-Quartiere, jeder einmal."),
    ("Quartiere ohne Stadtwerke-Ladepunkt",
     f'CALCULATE ( COUNTROWS ( Quartier ), KEEPFILTERS ( Quartier[Stadtwerke-Ladelücke 300 m] = "ja" ), {OWN} ) + 0', N, "Quartiere",
     "degewo-Quartiere ohne Ladepunkt der Berliner Stadtwerke bis 300 m Luftlinie (Ladelücke). Öffentliche Ladepunkte anderer Betreiber "
     "gibt es bei allen Quartieren."),
    # --------------------------------------------------------------------------- Dächer
    ("Fokusdächer", "COUNTROWS ( Fokusdach )", N, "Dächer",
     "Anzahl der degewo-Fokusdächer: Gebäude, auf denen eine degewo-Anlage verortet ist. Dächer der Stadtwerke und der BVG sind nicht "
     "enthalten. Je Quartier über Fokusdach[Quartier] gruppieren, nicht über die Tabelle Quartier."),
    ("Solarpotenzial Fokusdächer kWp", "SUM ( Fokusdach[Solarpotenzial kWp] )", KW, "Dächer",
     "Geschätztes Photovoltaik-Potenzial der degewo-Fokusdächer laut Solarkataster Berlin in kWp. Schätzung, kein Messwert."),
    ("Installiert Fokusdächer kWp", "SUM ( Fokusdach[Installiert kWp] )", KW, "Dächer",
     "Auf den degewo-Fokusdächern bereits installierte Photovoltaik-Leistung in kWp (MaStR-Anlagen, die dem Dach zugeordnet sind)."),
    ("Offenes Potenzial Fokusdächer kWp", "SUM ( Fokusdach[Offenes Potenzial kWp] )", KW, "Dächer",
     "Noch nicht genutztes Potenzial der degewo-Fokusdächer in kWp: Potenzial minus installiert, je Dach nie negativ. Schätzung."),
    ("Ausschöpfung Fokusdächer", "DIVIDE ( [Installiert Fokusdächer kWp], [Solarpotenzial Fokusdächer kWp] )", PCT, "Dächer",
     "Installierte Leistung im Verhältnis zum geschätzten Potenzial der degewo-Fokusdächer."),
    ("Fokusdächer mit offenem Potenzial", "CALCULATE ( COUNTROWS ( Fokusdach ), KEEPFILTERS ( Fokusdach[Offenes Potenzial kWp] > 0 ) ) + 0",
     N, "Dächer", "degewo-Fokusdächer, auf denen noch Potenzial frei ist."),
    ("Gebäude im Quartier", "COUNTROWS ( 'Gebäude im Quartier' )", N, "Dächer",
     "Gebäude mit Solarkataster-Eintrag in den Umrissen von Gropiusstadt, Marzahn und Brunnenviertel, unabhängig vom Eigentümer."),
    ("Solarpotenzial Gebäude im Quartier kWp", "SUM ( 'Gebäude im Quartier'[Solarpotenzial kWp] )", KW, "Dächer",
     "Geschätztes Photovoltaik-Potenzial aller Gebäude in den Quartiersumrissen laut Solarkataster in kWp, unabhängig vom Eigentümer."),
    # ------------------------------------------------------------------------------ BVG
    ("Betriebshöfe", "COUNTROWS ( Betriebshof )", N, "BVG",
     "Anzahl der BVG-Standorte im Modell (Bus-, Straßenbahn- und U-Bahn-Betriebshöfe sowie weitere Standorte)."),
    ("Betriebshöfe im Bau", 'CALCULATE ( COUNTROWS ( Betriebshof ), KEEPFILTERS ( Betriebshof[Status] = "im Bau" ) )', N, "BVG",
     "BVG-Standorte, die gerade gebaut werden."),
    ("Betriebshöfe mit Solarvereinbarung 2025",
     'CALCULATE ( COUNTROWS ( Betriebshof ), KEEPFILTERS ( Betriebshof[Solarvereinbarung 2025] = "ja" ) )', N, "BVG",
     "BVG-Standorte aus der Solarvereinbarung von BVG und Berliner Stadtwerken vom Juli 2025."),
    ("Solarleistung Betriebshöfe kWp", "SUM ( Betriebshof[Solarleistung kWp] )", KW, "BVG",
     "Photovoltaik-Leistung der MaStR-Anlagen, die einem BVG-Standort zugeordnet sind, in kWp."),
    # --------------------------------------------------------------------------- Bezirk
    ("Einwohner", "IF ( NOT ISFILTERED ( Quartier ), SUM ( Bezirk[Einwohner] ) )", N, "Bezirk",
     "Einwohner der Bezirke mit Hauptwohnsitz laut Einwohnerregister am 31.12.2025 (höher als die amtliche Zensuszahl). Nur für Berlin "
     "oder je Bezirk; leer, sobald nach Quartier gefiltert wird. Für Quartiere [Einwohner Quartiere] verwenden."),
]

