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

## Copernicus DEM

produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

The coarse shell is resampled and seam-aligned to the core. It is a surface model, not a bare-earth survey. [Source and license](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

## OpenStreetMap

© OpenStreetMap contributors. Land cover, and the aerodrome, runway, terminal and station
geometry used to define the airport area of interest, are provided under the
[Open Database License](https://www.openstreetmap.org/copyright).

## Public transport service data (MVV)

The vehicle layer's service data (`public/data/fahrplan.json`) is an extract of the MVV
Gesamt-Soll-Fahrplandaten (GTFS), feed 09/2026, extracted on 2026-09-22. The publisher's licence
statement on its developer page (mvv-muenchen.de, "MVV-Content für Entwickler"), quoted verbatim:

> Die von uns angebotenen GTFS-Daten stehen unter der Creative Commons Attribution License (cc-by).
> Als Quellenangabe notieren Sie bitte „Münchner Verkehrs- und Tarifverbund GmbH (MVV)“ sowie das
> Datum des Abrufs und ggf. die Feed-Versionsnummer.

Quellenangabe: Münchner Verkehrs- und Tarifverbund GmbH (MVV), Soll-Fahrplandaten (GTFS),
Feed 09/2026, abgerufen am 22.09.2026.

## Live sources

These are queried at runtime and nothing from them is stored:

* **Air traffic** — ADS-B from [adsb.lol](https://adsb.lol/), a volunteer receiver community,
  published as open data under ODbL. Coverage and availability are not guaranteed and not every
  aircraft transmits ADS-B.
* **Construction and temporary no-parking** — Landeshauptstadt München, `mor_wfs:baustellen_opendata`
  via geoportal.muenchen.de, open data.
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