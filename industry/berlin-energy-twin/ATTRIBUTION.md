# Data sources and licences

Every baked file in `public/data/` carries the same information in its `meta` block. The app's attribution footer must name each source whose layer is visible.

| File | Source | Licence | Attribution line |
|---|---|---|---|
| `charging.json` | Geoportal Berlin, WFS `eladesaeulen` (stations, points per district, charging kWh per district) | DL-DE-Zero 2.0 | Geoportal Berlin / Elektro-Ladesäulen und Ladepunkte |
| `units.json` | Marktstammdatenregister (Bundesnetzagentur), public unit overview, operator filter "Berliner Stadtwerke", "degewo", "Berliner Verkehrsbetriebe"; legal entities only | DL-DE-BY 2.0 | Bundesnetzagentur, Marktstammdatenregister |
| `sites.json` | Geoportal Berlin solar atlas `ua_solarpotenzial_solarrechner` and postcode areas; OpenStreetMap outlines; curated sources per site (`tools/curated/sites.json`) | DL-DE-Zero 2.0; ODbL 1.0 | Geoportal Berlin (Solarkataster, PLZ); © OpenStreetMap contributors |
| `aerial.json`, `aerial-*.jpg` | Geoportal Berlin, TrueDOP Sommer 2025 (TrueDOP20RGB), WMS `truedop_2025_sommer` | DL-DE-Zero 2.0 | Geoportal Berlin / TrueDOP Sommer 2025 |
| `terrain.json`, `terrain/<z>/<x>/<y>.webp` | Geoportal Berlin, ATKIS DGM (1 m Rasterweite), Atom `dgm1`; pixels outside the survey filled from AWS Terrain Tiles | DL-DE-Zero 2.0 (fill: EU-DEM © Copernicus, SRTM © NASA) | Geoportal Berlin / ATKIS DGM1 |
| `buildings.json`, `buildings*.bin` | Geoportal Berlin, 3D-Gebäudemodelle LoD2 (Atom `a_lod2`); roof colours measured from TrueDOP 2025 | DL-DE-Zero 2.0 | Geoportal Berlin / 3D-Gebäudemodelle LoD2 |
| `context.json` | Geoportal Berlin district outlines (DL-DE-Zero); Energieatlas district heating areas incl. 250 m buffer (DL-DE-Zero); Umweltatlas Einwohnerdichte 2025 (CC BY 3.0 DE); OpenStreetMap substations (ODbL) | mixed, see left | Amt für Statistik Berlin-Brandenburg / Einwohnerdichte 2025 (Umweltatlas); Geoportal Berlin; © OpenStreetMap contributors |

Live sources (not baked): **solar now** (D56) from the nearest DWD station measuring radiation (Potsdam 03987; Tempelhof has no radiation sensor) via Bright Sky (`api.brightsky.dev/current_weather`, DWD open data, CC BY 4.0 / GeoNutzV), estimate = irradiance × installed kWp × performance ratio 0.8 (Fraunhofer ISE); **BVG live vehicles** (D55) via the community API `v6.bvg.transport.rest/radar` (HAFAS, unofficial, computed positions, not GPS), credited in the map footer while the layer is on.

Basemap: © OpenStreetMap contributors, © CARTO. Terrain: Geoportal Berlin ATKIS DGM1 (DL-DE-Zero 2.0) inside Berlin, AWS Terrain Tiles (EU-DEM © Copernicus, SRTM © NASA) outside. Buildings and aerials (Phase 2): Geoportal Berlin LoD2 and TrueDOP 2025, DL-DE-Zero 2.0. Street trees (Phase 2): Geoportal Berlin `baumbestand`, DL-DE-Zero 2.0. Photoreal mesh (Phase 2, D25, not yet downloaded): Berlin 3D-Meshmodell 2025, Berlin 3D Downloadportal; licence and attribution line to be copied from the portal's terms once they are readable (datenregister names "Berlin Partner für Wirtschaft und Technologie GmbH").

The MaStR JSON route behind the web table is undocumented; the data is MaStR (BNetzA, DL-DE-BY 2.0) whatever the fetch route. Fallback: the official Gesamtdatenexport.
