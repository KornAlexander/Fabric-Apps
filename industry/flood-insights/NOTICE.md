# NOTICE — data sources, licences and attribution

Flut-Insights is built entirely from **publicly licensed data**. This file is the licence register.
Every source used anywhere in the repo must appear here **before** the data is committed or processed.

The attribution block below is rendered in the app footer and on the closing "Lehren und Quellen" screen.
It is not optional. See PLAN.md §2.2 rule 6 and §4.6.

---

## Attribution block (verbatim, app footer + closing screen)

```
© GeoBasis-DE / LVermGeoRP 2021–2026, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]
© European Union, Copernicus Emergency Management Service (EMSR517)
© Deutscher Wetterdienst (DWD)
© OpenStreetMap contributors (ODbL)
Depth–damage functions: Huizinga, de Moel & Szewczyk (2017), JRC Technical Report
```

---

## Source register

| Source | Products used | Licence | Root URL | Status |
|---|---|---|---|---|
| **LVermGeo Rheinland-Pfalz** | **DGM1 (148 tiles, acquired 2024/2025)**, **DOM1 (148 tiles, acquired 2024/2025)**, LoD2 CityGML, DOP20, historische Orthophotos (incl. *Sonderbefliegung Hochwasser*), Hausumringe | **dl-de/by-2-0** | <https://lvermgeo.rlp.de/geodaten-geoshop/open-data> · tiles via <https://geobasis-rlp.de/data/dgm1/current/> and <https://geobasis-rlp.de/data/dom1/current/> | ✅ DGM1 downloaded + SHA-256 verified 2026-07-27 · ✅ DOM1 downloaded + SHA-256 verified 2026-07-28 |

### Derived layers

Two things in the app are computed from those tiles rather than taken from them, and both are
labelled as derived where they appear:

* **Terrain** — DGM1 mosaicked and resampled to 4 m (`tools/geodata/build_terrain.py`).
* **Vegetation** — DOM1 minus DGM1 is a normalised height model, so a tree's position and height
  are *measured*. Local maxima of that model give individual tree tops
  (`tools/geodata/build_vegetation.py`). Buildings are excluded using OpenStreetMap footprints and
  a roughness test. **Crown radius** is measured from the canopy around each top, falling back to
  half the distance to the nearest tree where the stand is closed and there is no gap to measure.
  **Crown form** — how high the canopy still stands a short way out from the apex — separates
  conical from rounded crowns, which is drawn as conifer against broadleaf. That is a statement
  about form, *not* a species identification: it is corroborated only by the fact that the conical
  trees come out in patches at more than twice the background rate, as planted stands do.
* **Land cover** — OpenStreetMap `landuse`, `natural` and `leisure` polygons plus the `highway` and
  `railway` network, rasterised to a 2 m class grid (`tools/geodata/build_landuse.py`), shipped
  gzipped because a class raster compresses about 27:1 — 28.6 MB of grid crosses the wire as
  roughly 1 MB. Roads are
  split into paved and unpaved using the OSM `surface` tag, which 58 % of the segments here carry;
  the rest fall back to the habit of their class (a `track` is unmade unless stated, a residential
  street is not). It colours the surface and nothing else: no hydraulics, damage figure or
  validation result reads it. It also shows land cover **as mapped today, not as it stood in July
  2021** — the same caveat that already applies to the terrain, and it is stated in the app.
| **Copernicus EMS — EMSR517** *"Flood in Western Germany"* | Delineation `AOI03_DEL_PRODUCT` + `_MONIT01`, Grading `AOI15_GRA_PRODUCT` (3 814 graded building points, 77 flood polygons) | Copernicus EMS terms (free, attribution) | <https://mapping.emergency.copernicus.eu/activations/EMSR517> | ✅ coverage verified 2026-07-27 — all three focus villages |
| **Deutscher Wetterdienst (DWD)** | RADOLAN hourly radar grids, station climate data | **GeoNutzV / DWD open data** | <https://opendata.dwd.de/> | ✅ verified live |
| **OpenStreetMap** | Ahr centreline, buildings, streets, bridges, land cover (vineyard, forest, farmland, meadow, settlement), road and rail network with surface | **ODbL** | <https://overpass-api.de/> | ✅ known good |
| **opengeodata.NRW** | 3D-Gebäude, Höhenmodelle (future Steinbachtalsperre module only) | dl-de/zero-2-0 | <https://www.opengeodata.nrw.de/produkte/geobasis/> | ✅ verified live |
| ~~PEGELONLINE (WSV)~~ | — | — | — | ❌ **ruled out** — carries no Ahr gauge (federal waterways only) |
| **HVZ / LfU Rheinland-Pfalz** — open JSON API | station master data + **live** 15-min gauge readings (Altenahr `27180403`, Bad Bodendorf `27180607`, Müsch 2 `27180094`) | ⚠️ **licence to confirm** | <https://www.hochwasser.rlp.de/api/v1/config> | ✅ API verified live — see [docs/gauge-data-sources.md](docs/gauge-data-sources.md) |
| **LfU RLP water geodata portal** | Hauptwerte, Jährlichkeiten, Stammdaten for the Ahr gauges (`/api/data/`, `/api/export/`) | ⚠️ **licence to confirm** | <https://geodaten-wasser.rlp-umwelt.de/> | ✅ API recovered 2026-07-27; ⚠️ July 2021 time series still unavailable |
| **HWRM-RL Hochwassergefahrenkarten (RLP)** | HQ10 / HQ100 / HQextrem extents → own hazard-class derivation | dl-de/by-2-0 (to confirm) | <https://hochwassermanagement.rlp.de/> · <https://hwrm.rlp-umwelt.de/> | ⚠️ to confirm |
| **JRC depth–damage curves** | Huizinga, de Moel & Szewczyk (2017) | EU open | JRC Technical Report | ✅ citable |

### Was am Gebäudebild gemessen und was Konvention ist

Seit die Gebäude nicht mehr einfarbig grau sind, leitet die App etwas aus dem Orthophoto ab, und
das gehört hierher — nicht in den Quelltext allein.

- **Dachfarbe: gemessen.** Jedes Gebäude bekommt die Farbe seiner eigenen Dachflächen, abgetastet
  aus genau dem DOP20-Orthophoto, das die App ohnehin als Geländetextur ausliefert. Kein
  zusätzlicher Download, keine erfundene Palette. Die Sonne des Bildflugs wird herausgerechnet,
  damit der Renderer sein eigenes Licht setzen kann; Farbton bleibt unverändert.
  Ahrtal: **23 514 von 30 206 Gebäuden (77,8 %)** gemessen, bei 2,878 m/px.
  Steinbachtalsperre: **5 283 von 5 285 (100,0 %)** bei 0,791 m/px.
  Nicht messbare Gebäude erhalten den Median der gemessenen — also weiterhin Dächer *dieses* Tals.
- ⚠️ **Die Dachfarbe ist eine Momentaufnahme eines Bildflugs, keine Materialaufnahme.** Ein seither
  neu gedecktes Dach erscheint so, wie es damals aussah. Für das Ahrtal stammt das DOP aus der Zeit
  **nach** der Flut und dem Wiederaufbau — dieselbe Einschränkung, die schon für das DGM1 gilt.
- ⚠️ **Das Luftbild zeigt nicht 2021.** Der WMS wird ohne `TIME`-Parameter abgefragt, liefert also
  den aktuellen Stand des Landesdienstes. Zerstörte Gebäude fehlen darauf, wieder aufgebaute stehen
  darin. **Lagerichtig ist es**: gegen 1 200 Katastergrundrisse geprüft, liegt der Vegetationsanteil
  innerhalb der Grundrisse bei 0,22 % im Nullversatz gegen 2,33 % bei ±15 m — ein scharfes Minimum
  genau an der angegebenen Position. Die Abweichung ist zeitlich, nicht räumlich.
- 🔴 **Das DOP20 ist ein Mosaik aus Bildflügen — im Ahrtal aus zweien, und man sieht die Naht.**
  Der Metadatendienst `rp_dop20_info` („Metadaten der DOP20“, GetFeatureInfo, `text/plain`) nennt je
  2-km-Kachel ein `erstellung`-Datum. Für diese AOI:
  **27.05.2023** östlich und **07.09.2023** westlich der Kachelspalte **E = 360 000** (kurz westlich
  von Altenahr). Beide 2023, aber verschiedene Flüge.
  - **Gemessen** auf je 1,5 km vergleichbarem Boden beiderseits der Grenze: der östliche Flug ist
    **20 % dunkler** (mittlere Helligkeit 0,373 → 0,296), **14 % kontrastärmer** und messbar wärmer
    (r−g −0,056 → −0,035). Auf der kartografischen Oberfläche fällt das nicht auf; sobald das
    Luftbild die ganze Fläche trägt, liest es sich wie zwei Datenquellen.
  - **Es gibt nichts anderes abzurufen**: der Dienst veröffentlicht **keine TIME-Dimension und keine
    Jahres-Layer** (GetCapabilities geprüft — 6 Layer, 0 Dimensionen). Ein einzelner Bildflug ist
    über diesen WMS nicht anforderbar.
  - **Angeglichen, und zwar so:** `tools/geodata/match_drape_campaigns.py` misst jeden Bildflug auf
    vergleichbarem Boden neben der Grenze und löst **ein Gamma je Bildflug**, das ihn wie den
    Referenzflug rendern lässt. **Referenz ist der Flug mit dem höchsten gemessenen Detailgradienten**
    (07.09.2023: 10,04 gegen 9,37 Helligkeitsstufen je Bildpunkt) — also der präzisere, nicht der
    größere: er deckt nur 23 % der Fläche ab und bleibt bei **exakt 1,0**, unverändert. Der
    Flug vom 27.05.2023 erhält **0,8114**; damit rendern beide auf 0,373 mittlere Helligkeit.
    Die AOI-weite Belichtung wurde am angeglichenen Bild neu bestimmt (0,6705 → **0,7866**).
  - **Das Bild selbst bleibt unangetastet.** Die Korrektur liegt in `drape_campaigns.json`, nicht in
    `drape.jpg`: die Dachfarben wurden aus dieser Datei gemessen und würden sonst still nicht mehr
    dazu passen, und eine eingebrannte Korrektur wäre weder prüfbar noch umkehrbar. Der Shader
    multipliziert die beiden Exponenten — `pow(pow(x,a),b) == pow(x,a*b)`.
  - **Gamma, keine Verstärkung, nicht je Kanal.** Dieselbe Regel wie bei der AOI-weiten Korrektur:
    sie verschiebt den Mittelwert und lässt 1,0 bei 1,0, erfindet also keinen Farbton. Der
    gemessene **Farbtonunterschied (r−g −0,056 gegen −0,035) bleibt bestehen** und wird nicht
    weggeräumt — das wäre eine Farbentscheidung über amtliches Bildmaterial.
  - **Am gerenderten Bild nachgewiesen** (`e2e/drape-campaigns.spec.ts`): dieselbe Ansicht zweimal,
    einmal mit blockierter Korrektur. Der Unterschied ist eine Stufe an genau einer Stelle —
    **westlich davon höchstens 1,03 Stufen** (der Referenzflug wird nicht angefasst), **östlich im
    Mittel 9,5 Stufen**.
- **Belichtung des Luftbilds ist korrigiert, nicht gefärbt.** Mittlere Bodenhelligkeit je AOI
  gemessen (Ahrtal 0,314, Steinbach 0,437, Horta Sud 0,513) und per Gamma auf 0,46 angehoben; nur
  Aufhellung, Farbton unverändert.
- **Fotorealistische Darstellung: dieselbe Quelle, feiner ausgeschnitten.** Die flächige
  Geländetextur liegt bei **2,878 m je Bildpunkt** — mehr passt für 23,6 km nicht in eine einzige
  Textur (WebGL2 garantiert 8192 px je Kante), während das DOP20 mit **20 cm** geflogen wird.
  `tools/geodata/fetch_drape_detail.py` holt die fehlende Schärfe als Fenster von **1 km bei
  2048 px = 0,50 m/px** um jede der 20 Ortslagen: 20 Kacheln, **20,8 MB** auf der Platte. Es ist
  **derselbe Dienst unter derselben Lizenz** wie das flächige Bild — kein neuer Anbieter, kein
  Schlüssel, keine Nutzungsgrenze.
  - 🔴 **Die Auflösung bestimmt der Host, nicht der Geschmack.** Rayfin lehnt ein Paket über
    **100 MB komprimiert** ab, wovon die App schon 71,9 MB belegt. Ein erster Zuschnitt mit zwei
    Stufen (0,25 und 0,50 m/px, 154 MB) brachte das Paket auf 226,4 MB und wurde abgewiesen.
  - **Nachgewiesen lagerichtig**, nicht angenommen: jede Kachel gegen denselben Ausschnitt des
    bereits geprüften Flächenbilds korreliert — **schlechtestes r = +0,982**, bei Kontrollen
    (senkrecht gespiegelt, waagerecht gespiegelt, 25 % versetzt) von höchstens +0,39.
  - **Belichtung wird vom Flächenbild geerbt, nicht neu gesetzt.** Das Fenster wird in das
    großflächige Bild eingeblendet, muss also die Helligkeit **an genau dieser Stelle** treffen und
    nicht einen absoluten Zielwert. Eine zuerst gebaute Variante mit eigenem Ziel je Kachel
    rechnete jedes Fenster **um den Faktor 1,77 zu dunkel** (am gerenderten Bild gemessen) und
    hätte an der weichen Kante einen sichtbaren Rand erzeugt. Die eigene Helligkeit jeder Kachel
    wird weiterhin gemessen — als **Prüfung**: dieselbe Fläche zweimal fotografiert muss gleich
    hell sein. **Größte Abweichung über alle Kacheln: 0,002.**
  - **Dächer zeigen dort ihre eigenen Bildpunkte** statt der gemessenen Mischfarbe. Wände bleiben
    Klassenfarbe: in einer Senkrechtaufnahme kommt keine Wand vor.
  - Ein Fenster wird **nur geladen, wenn es die Bildbreite auch abdeckt** — sonst wäre es ein
    scharfes Rechteck mitten in einem weichen Bild.
  - ⚠️ **Gleiche Einschränkung wie oben, nur sichtbarer:** die Befliegung ist aktuell, nicht 2021.
  - Die Darstellung ändert **nichts** an der Rechnung: Gelände, Wasserstände, Tiefen, IoU und alle
    Kennzahlen sind unberührt.
  - **Gemessen am gerenderten Bild** (Dernau, Kamera ~750 m, ruhende Kamera): Detailschärfe
    (mittlerer Helligkeitsgradient je Bildpunkt) **+44 %** gegenüber dem Flächenbild. Das Fenster
    zeigt das Luftbild zugleich kontrastreicher, weil die Flächentextur durch die
    Mipmap-Filterung weichgezeichnet und dadurch milchig aufgehellt wird — die scharfe Kachel ist
    die getreuere Wiedergabe der Befliegung.
- **Wandfarbe: nicht gemessen.** Gemessen ist nur die *Klasse* — aus der ALKIS-Gebäudefunktion und
  den Maßen des Katasters (Grundfläche, Höhe). Welche Farbe eine Klasse bekommt, ist eine
  Konvention (rheinischer Putz, grauerer Nebenbau, hellere Kirche) und keine Aussage über eine
  einzelne Wand.
- **Die Farbe bleibt zuerst eine Wassertiefe.** Ab 0,2 m überschreibt die Tiefenskala die
  Gebäudefarbe vollständig. Das Dach ist das, was übrig bleibt, wenn es keine Wassertiefe zu
  berichten gibt — nie ein Urteil über das Gebäude.

### Explicitly NOT used

| Source | Why not |
|---|---|
| **ZÜRS Geo (GDV)** | Proprietary GDV product, not licensable for this purpose. The app derives its own **"Gefährdungsklasse (GK 1–4)"** on the same frequency boundaries, but **explicitly not ZÜRS** — and not from the HWRM-RL hazard maps either, which are listed above as still unconfirmed and have not been downloaded. The classes are computed from the **LfU Jährlichkeiten** (HQ10 175, HQ50 367, HQ100 500 m³/s), the **DGM1** terrain and the per-chainage rating curve: ground is classified by the rarest flood that still reaches it. The **GK1/GK2 boundary needs a 200-year discharge, which the LfU table does not publish**; it is log-extrapolated from HQ50 and HQ100 to 633 m³/s and labelled as an extrapolation wherever it is shown. No ZÜRS logo, no ZÜRS parity claim, no ZÜRS figures. ZÜRS® is a product of the GDV. |
| Any real insurer's portfolio, product names or wording | The insurer, its policies, customers and claims in this app are **entirely fictional and synthetically generated**. |

---

## Post-event reports cited in Act IV

Every factual claim in the "Was hätte geholfen?" act must cite an official document.
⚠️ **Phase 1 research task — this table must be filled before any Act IV copy is written.**

| Claim | Document | Issuer | Year | Link |
|---|---|---|---|---|
| **136 people died in Rheinland-Pfalz** (remembrance screen) | Bericht des Untersuchungsausschusses 18/1 „Flutkatastrophe", Drucksache 18/10000 — **Abschnitt D**, „Würdigung der Beweisaufnahme und Ergebnis der Untersuchung": *„136 Menschen mussten ihr Leben in dieser Katastrophe lassen."* (p. 1455, repeated p. 1639) | Landtag Rheinland-Pfalz, 18. Wahlperiode | 2024 | <https://dokumente.landtag.rlp.de/landtag/drucksachen/10000-18.pdf> |

> ⚠️ **Quote this report only from section D (p. 1455–1862).** From p. 1863 the document carries
> „Abweichende Meinung" annexes written by individual factions; those state 135 and are dissenting
> opinions, not the committee's finding. The figure often seen in the press, 134, was the count as of
> October 2021 and describes Rheinland-Pfalz — not, as this app once claimed, the Landkreis Ahrweiler.
> The report gives **no** district-level death toll.

Rules (PLAN.md §4.8):
- Reconstructed figures (peak stage, peak discharge) are labelled as reconstructions and shown as a range.
- Where the legal or regulatory situation has changed since 2021, state the current status **and its date**.
- **If a claim cannot be sourced, it does not go in the app.**

---

## Steinbachtalsperre — companion case

A second case study, reachable from the header and deliberately **absent from the map**. The dam
stands 13.7 km north-west of Altenahr but drains the other way (Steinbach → Orbach → Jungbach →
Swist → Erft → Rhine), so it has no hydraulic connection to the terrain this app draws. Placing it
on that terrain would assert one that does not exist.

| Claim | Document | Issuer | Year | Link |
|---|---|---|---|---|
| Crest 281 m ü. NHN, full supply 278.7 m, 17.7 m above the valley floor, 1 055 430 m³ storage, spillway designed for 20.3 m³/s | Bericht anlässlich der Wiederinbetriebnahme der sanierten Steinbachtalsperre, 27. April 1990 | Wasserversorgungsverband Euskirchen-Swisttal | 1990 | <http://www.wasser-eu-sw.de/pdf/steinbachtalsperre.pdf> |
| Peak outflow ≈ 69 m³/s on 14 July 2021 | FAQ Steinbachtalsperre nach dem Starkregenereignis am 14.07.2021 (the operator's own account) | e-regio GmbH & Co. KG | 2022 | <https://www.e-regio.de/aktuelle-informationen/faq-steinbachtalsperre-nach-dem-starkregenereignis-am-14072021/> |
| Chronology of the night, 0.40 m over the crest, 134 m of erosion, ≈ 15 000 evacuated | „Geröll blockierte Grundablass — Zukunft der Steinbachtalsperre ungewiss" | Kölner Stadt-Anzeiger | 2021 | <https://www.ksta.de/region/euskirchen-eifel/geroell-blockierte-grundablass-zukunft-der-steinbachtalsperre-ungewiss-38971578> |
| **Dam-break scenario** — 1.5 M m³ released, Schweinheim 3–5 m at 3 m/s after 10 min, Odendorf after 1 h, Heimerzheim no danger (A 61 acts as a dam) | Dammbruchsimulation, presented to the WES assembly on 28 September 2022; reported by Tom Steinicke | Hydrotec Ingenieurgesellschaft für Wasser und Umwelt mbH (commissioned by e-regio); reported in the Kölnische Rundschau | 2022 | <https://www.rundschau-online.de/region/euskirchen-eifel/steinbachtalsperre-talsperre-in-euskirchen-soll-nach-flut-wieder-volllaufen-352099> |

> ⚠️ **The dam did not break.** Every scenario figure above describes a published model of an event
> that did not occur, and the module labels it as such wherever it appears. This app computes **no**
> dam failure of its own and draws none on any map — a rendered break inundation over real, named
> villages is a different class of artefact from reconstructing a flood that happened, and it is not
> what this module does.
>
> The same study found the evacuation of Schweinheim, Palmersheim and Flamersheim to have been
> **correct**, and that no endangered area was left out. That finding is shown alongside the worst
> case, not beneath it.
>
> Where the study published a depth but no arrival time (Palmersheim), the module shows *"nicht
> angegeben"* rather than an interpolated figure. The warning times it displays are differences
> between documented clock times; there is **no evacuation model** behind them and no statement
> about how many people could have left.

---

## Synthetic data

The insurance portfolio (`portfolio.*`, `claims.*`) is generated with `seed=20210714` and is **fictional**.
Building geometry and street names are real; every policy, customer, sum insured, coverage and claim is not.
Every policy field shown in the UI carries a **"synthetisch"** badge.
