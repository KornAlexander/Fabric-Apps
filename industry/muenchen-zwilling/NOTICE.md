# Map data notices

The MIT license covers application code, not third-party geodata. All data below is public, and
the map assets are processed offline. The app makes no claim that any of the organisations it was
built for supplied these datasets.

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

## Live sources

These are queried at runtime and nothing from them is stored:

* **Air traffic** — ADS-B from [adsb.lol](https://adsb.lol/), a volunteer receiver community,
  published as open data under ODbL. Coverage and availability are not guaranteed and not every
  aircraft transmits ADS-B.
* **Construction and temporary no-parking** — Landeshauptstadt München, `mor_wfs:baustellen_opendata`
  via geoportal.muenchen.de, open data.
* **Public transport stops and departures** — Landeshauptstadt München (`mor_wfs:oepnv_u_t_b_mvg_neu`)
  and Münchner Verkehrsgesellschaft (public departures interface).

## Reuse

The source attribution wording above is preserved verbatim. The app provides these notices in its map attribution control. The imported metadata retains source licenses, while application-specific place labels are omitted.

The JavaScript bundle includes Three.js and OrbitControls under MIT. Their copyright and license are included in [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt), which travels with the built app.