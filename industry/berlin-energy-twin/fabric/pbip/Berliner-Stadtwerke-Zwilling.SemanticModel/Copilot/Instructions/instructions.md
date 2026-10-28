# Berliner Stadtwerke Zwilling: Hinweise für Copilot und Fabric IQ

Antworte in der Sprache der Frage (Deutsch oder Englisch). Nenne Einheiten (kWp, kW, kWh) und bei Schätzungen das Wort "Schätzung".

## Die drei wichtigsten Regeln
1. **Immer die Measures der Tabelle `Measure` verwenden**, keine Spalten selbst summieren. Besonders die Ladepunkt-Spalten der Tabelle `Quartier` dürfen nicht über mehrere Quartiere addiert werden (ein Ladepunkt kann nahe zwei Quartieren liegen); dafür gibt es `[Ladepunkte bis 300 m um Quartiere]` und `[Stadtwerke-Ladepunkte bis 300 m um Quartiere]`.
2. **"Solar" heißt nur Photovoltaik.** `[Solarleistung kWp]` und `[Solaranlagen]` zählen nur den Energieträger Solar. `[Installierte Leistung kW]` enthält zusätzlich Wind, Erdgas, andere Gase, Speicher und Biomasse; nenne das ausdrücklich, wenn du es verwendest.
3. **Partner über `Partner[Partner]` filtern** ("Berliner Stadtwerke", "degewo", "BVG"). Jede Anlage gehört genau einem Partner. Ladestationen hängen nicht an der Tabelle Partner: Stadtwerke-Ladepunkte über `[Ladepunkte Stadtwerke]` oder `Ladestation[Stadtwerke] = "ja"`.

## Was das Modell enthält
- **Anlage:** 370 Erzeugungs- und Speichereinheiten der Berliner Stadtwerke (257), der degewo (94) und der BVG (19) aus dem Marktstammdatenregister, abgerufen am 27.10.2026. Solar: Stadtwerke 19,4 MWp in 248 Anlagen, degewo 2,2 MWp, BVG 2,1 MWp. Dazu 6,6 MW anderer Energieträger (der größte Block ist Wind der Stadtwerke in Großbeeren, außerhalb Berlins).
- **Ladestation:** 4.960 öffentliche Ladestationen mit 7.582 Ladepunkten aus dem Ladesäulenregister Berlin, davon 1.764 Ladepunkte der Berliner Stadtwerke (rund 23 Prozent). Registerdaten, kein Live-Status. Private Ladepunkte nur in `[Ladepunkte Register gesamt]` (je Bezirk, Land Berlin); nie mit `[Ladepunkte]` addieren.
- **Quartier:** degewo-Quartiere: Gropiusstadt, Marzahn, Brunnenviertel und Cluster nach Postleitzahl. Feuchtwangerweg (12353) liegt in der Gropiusstadt und zählt dort mit; daher 9 Quartiere. Bis 300 m Luftlinie um diese Quartiere liegen 464 öffentliche Ladepunkte, 71 davon von den Stadtwerken (rund 15 Prozent). Ladelücke der Stadtwerke (kein Stadtwerke-Ladepunkt bis 300 m): 14129 · Himbeersteig, Quendelsteig, Waldrebensteig.
- **Fokusdach:** 28 degewo-Dächer (Gebäude mit einer degewo-Anlage) mit geschätztem Solarpotenzial (Solarkataster), installierter Leistung und offenem Potenzial. Keine Dächer der Stadtwerke oder der BVG; der Partnerfilter wirkt hier nicht. Je Quartier über `Fokusdach[Quartier]` gruppieren, nicht über die Tabelle Quartier. **Gebäude im Quartier:** alle Gebäude mit Solarkataster-Eintrag in Gropiusstadt, Marzahn und Brunnenviertel, unabhängig vom Eigentümer.
- **Betriebshof:** 17 BVG-Standorte, 3 im Bau, mit der Solarvereinbarung 2025 von BVG und Stadtwerken.
- **Bezirk:** 12 Bezirke, Einwohner laut Einwohnerregister 31.12.2025 (rund 3,9 Millionen; höher als die amtliche Zensuszahl 3,7 Millionen).
- **Ladestrom:** öffentlicher Ladestrom je Bezirk und Jahr in kWh; 2017 bis 2019 fehlen in der Quelle.

## Jahre
- `Jahr[Jahr]` ist das Inbetriebnahmejahr (Anlage, Ladestation) bzw. das Verbrauchsjahr (Ladestrom). Nach Jahr gefiltert zeigt `[Solarleistung kWp]` den Zubau in diesem Jahr, nicht den Bestand; für den Bestand bis zu einem Jahr `[Solarleistung kumuliert kWp]`.
- Ohne Jahresfilter zeigen die Anlagen- und Ladestations-Measures den heutigen Bestand. `[Ladestrom öffentlich kWh]` ist dagegen eine Summe über alle Jahre der Quelle; für "wie viel Ladestrom" immer ein Jahr nennen (das letzte ist 2024).

## Einwohner und Status
- `[Einwohner]` gilt für Berlin oder je Bezirk und ist leer, sobald nach Quartier gefiltert wird. Für Quartiere `[Einwohner Quartiere]`.
- `[Solarleistung kWp]` zählt wie die App alle registrierten Solaranlagen, auch vorübergehend oder endgültig stillgelegte (839 kWp, alle bei der BVG). Nur laufende Anlagen: `[Solarleistung in Betrieb kWp]`; bei der BVG den Unterschied nennen.

## Was die Daten nicht sagen
- Potenziale sind Schätzungen des Solarkatasters, keine Planung.
- Abstände sind Luftlinie zum Quartiersumriss, kein Fußweg.
- "erwartet nach Einwohnern" ist ein Rechenwert (Verteilung nach Einwohneranteil), kein Ziel.
- Kleine Solaranlagen haben im Register keine Adresse und sind nur nach Postleitzahl verortet (`Anlage[Verortung] = "nur Postleitzahl"`).
- Es gibt keine Netz-, Last- oder Erzeugungszeitreihen.

## Namen und Schreibweisen
- Berliner Stadtwerke = Stadtwerke = BSW = Berliner Stadtwerke EnergiePartner. degewo wird klein geschrieben. BVG = Berliner Verkehrsbetriebe.
- Quartiere über `Quartier[Quartier]` mit CONTAINSSTRING suchen (z. B. "Gropiusstadt", "Himbeersteig").
