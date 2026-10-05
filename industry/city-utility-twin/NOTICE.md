# Map data notices

The MIT license covers application code, not third-party geodata. All data below is public, and
the map assets are processed offline. The app makes no claim that any organisation supplied these
datasets to it.

## Bavarian survey data

Terrain (DGM1), imagery (DOP20), LoD2 building geometry, and tree locations/heights are from
Bayerische Vermessungsverwaltung under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de [Daten bearbeitet]

Measured properties of the two shipped cores:

| | München Zentrum | Flughafen München |
|---|---|---|
| height grid | 2 m posting, rendered at 4 m | 4 m posting, rendered at 8 m |
| imagery | ~0.96 m/px, one image | ~1.05 m/px, four quadrants |
| buildings | 15 746 | 2 550 |
| trees | 29 580 | none built |

The surrounding coarse imagery is approximately 29.25 m per pixel. Building coordinates are
decoded into metres. Tree crown radius is estimated from height; species are unknown. Aircraft
visible in the orthophoto are part of the photograph, taken on the survey flight, and are not
live data.

## Hamburg survey data

Terrain (DGM1, 2022 airborne laser scan), imagery (DOP, leaf-on series) and LoD2 building geometry
(vintage 2026-04-28) of the Hamburg core are from the Landesbetrieb Geoinformation und Vermessung
under [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0).

Datenquelle: Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), dl-de/by-2-0

| | Hamburg Innenstadt |
|---|---|
| height grid | 2 m posting, rendered at 4 m |
| imagery | ~0.70 m/px, one image |
| buildings | 2 338 |
| trees | none built |

The LGV imagery service covers Hamburg only, so the coarse surrounding imagery is blank where the
shell reaches into Schleswig-Holstein and Niedersachsen.

## Baden-Württemberg survey data

Terrain (DGM1), imagery (DOP20) and LoD2 building geometry of the Stuttgart core are from the
Landesamt für Geoinformation und Landentwicklung Baden-Württemberg under
[Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0).

Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0

| | Stuttgart Zentrum |
|---|---|
| height grid | 2 m posting, rendered at 4 m |
| imagery | ~0.94 m/px, one image |
| buildings | 15 219 |
| trees | none built |

## Copernicus DEM

produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

The coarse shell is resampled and seam-aligned to the core. It is a surface model, not a bare-earth survey. [Source and license](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

## OpenStreetMap

© OpenStreetMap contributors. Land cover, and the aerodrome, runway, terminal and station
geometry used to define the airport area of interest, are provided under the
[Open Database License](https://www.openstreetmap.org/copyright).

## Public transport service data (MVV)

The vehicle layer's service data (`public/data/fahrplan-munich.json`, baked by
`tools/transit/bake_fahrplan.py`) is an extract of the MVV
Gesamt-Soll-Fahrplandaten (GTFS), feed 09/2026, extracted on 2026-09-22. The publisher's licence
statement on its developer page (mvv-muenchen.de, "MVV-Content für Entwickler"), quoted verbatim:

> Die von uns angebotenen GTFS-Daten stehen unter der Creative Commons Attribution License (cc-by).
> Als Quellenangabe notieren Sie bitte „Münchner Verkehrs- und Tarifverbund GmbH (MVV)“ sowie das
> Datum des Abrufs und ggf. die Feed-Versionsnummer.

Quellenangabe: Münchner Verkehrs- und Tarifverbund GmbH (MVV), Soll-Fahrplandaten (GTFS),
Feed 09/2026, abgerufen am 22.09.2026.

## Public transport service data (hvv, VVS)

Extracts baked by `tools/transit/bake_fahrplan.py` on 2026-10-05:

* `public/data/fahrplan-hamburg.json`: Hamburger Verkehrsverbund (hvv), hvv Fahrplandaten (GTFS),
  feed version 2026-09-03, from the [Transparenzportal Hamburg](https://suche.transparenz.hamburg.de/?q=hvv%20Fahrplandaten%20GTFS), under
  [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0).
* `public/data/fahrplan-stuttgart.json`: Verkehrs- und Tarifverbund Stuttgart (VVS),
  Soll-Fahrplandaten (GTFS), feed version 20261004, via
  [MobiData BW](https://www.mobidata-bw.de/dataset/soll-fahrplandaten-vvs), under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (the dataset record names CC BY for the
  VVS data, deviating from the portal's default).

Only line labels, headsigns, stop coordinates and planned times are kept. Positions are
interpolated between stops, not tracked. Ferries and the rack railway are drawn as position
symbols, because no verified vehicle dimensions are on file.

## Live sources

These are queried at runtime and nothing from them is stored:

* **Air traffic** — ADS-B from [adsb.lol](https://adsb.lol/), a volunteer receiver community,
  published as open data under ODbL. Coverage and availability are not guaranteed and not every
  aircraft transmits ADS-B.
* **Construction and temporary no-parking** — Landeshauptstadt München, `mor_wfs:baustellen_opendata`
  via geoportal.muenchen.de, open data.
* **Roadworks Hamburg** — Freie und Hansestadt Hamburg, Behörde für Verkehr und Mobilitätswende
  (credit as prescribed by the service), "Baustellen Hamburg" (`de.hh.up:baustelle`, roadworks
  profiles from the Bauweiser platform), provided by the Landesbetrieb Geoinformation und
  Vermessung (LGV)
  via [geodienste.hamburg.de](https://geodienste.hamburg.de/hh_wfs_baustellen?Service=WFS&Version=1.1.0&Request=GetCapabilities), dl-de/by-2-0.
* **Roadworks on federal, state and district roads (Stuttgart)** — Verkehrsministerium
  Baden-Württemberg, ["Baustelleninformationen Baden-Württemberg"](https://www.mobidata-bw.de/dataset/baustelleninformationen-baden-wurttemberg)
  via MobiData BW (api.mobidata-bw.de), dl-de/by-2-0. Classified roads only, no municipal streets.
* **Public transport stops and departures** — Landeshauptstadt München (`mor_wfs:oepnv_u_t_b_mvg_neu`)
  and Münchner Verkehrsgesellschaft (public departures interface). This interface is unofficial and
  publishes no terms for third-party use, so the public build ships with it switched off
  (`VITE_UNOFFICIAL_FEEDS`, see `src/config/feeds.ts`).
* **Official air quality** — Umweltbundesamt (German Environment Agency), Air Data API
  (luftdaten.umweltbundesamt.de), hourly station readings.
* **Citizen air-quality sensors** — [Sensor.Community](https://sensor.community/), open data
  under ODbL; not officially calibrated.

## Reuse

The source attribution wording above is preserved verbatim. The app provides these notices in its map attribution control. The imported metadata retains source licenses, while application-specific place labels are omitted.

The JavaScript bundle includes Three.js and OrbitControls, React, React DOM and Scheduler, the
Microsoft Authentication Library and the Fabric Apps client libraries, all under MIT. Their
copyright and license texts are included in [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt), which travels with the built app.