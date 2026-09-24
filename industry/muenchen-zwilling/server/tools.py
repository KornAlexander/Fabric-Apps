"""The deterministic tools the agent may call.

⚠️ EVERY TOOL ANSWERS FROM A SOURCE, NEVER FROM THE MODEL. That is the whole design: the agent
decides *which* question to ask and how to phrase the answer, and these functions decide *what is
true*. Each one is also exposed at `POST /api/tools/{name}` so that somebody who does not believe
the chat can press a button and get the same numbers.

⚠️ THE CITY'S OPEN DATA DOES NOT SAY WHO IS DIGGING. `mor_wfs:baustellen_opendata` publishes what
the restriction is, where it is and when it runs. It carries no owning organisation. So no tool
here may answer "is this M-net or SWM" — and `baustellen_ueberschneidungen` reports that two
notified restrictions coincide, never that two companies are in conflict. That gap is exactly what
the coordination notes exist to fill, and pretending the gap is not there would be the single
most misleading thing this service could do in front of the organisations concerned.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import notes_store
import sources

#: Munich Airport reference position, OSM relation/20786018.
AIRPORT = (48.3538, 11.7861)

#: Hard ceilings so a single answer cannot become a wall of text the model then summarises badly.
MAX_ROWS = 40
MAX_PAIRS = 30


# ------------------------------------------------------------------ small geometry


def _rings(geometry: dict[str, Any] | None) -> list[list[list[float]]]:
    if not geometry or not isinstance(geometry.get("coordinates"), list):
        return []
    kind = geometry.get("type")
    if kind == "MultiPolygon":
        return [poly[0] for poly in geometry["coordinates"] if poly and isinstance(poly[0], list)]
    if kind == "Polygon":
        return [geometry["coordinates"][0]] if geometry["coordinates"] else []
    if kind == "Point":
        x, y = geometry["coordinates"][0], geometry["coordinates"][1]
        return [[[x, y]]]
    return []


def _centroid(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    """Mean vertex position in EPSG:25832.

    ⚠️ A CENTROID, NOT THE SHAPE. Everything downstream measures distances between these points,
    so two long trenches running parallel down the same street can be further apart by centroid
    than they are on the ground. The tool says "in der Nähe", never "überlappt sich", and the
    radius is reported with the answer so the reader can judge it.
    """
    points = [p for ring in _rings(geometry) for p in ring if isinstance(p, list) and len(p) >= 2]
    if not points:
        return None
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def _distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Plain Euclidean distance. EPSG:25832 is a metric projection, so this is metres."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


_DATE = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})")


def _parse_date(value: Any) -> date | None:
    """The city writes `TT.MM.JJJJ`. Anything else is treated as unknown rather than guessed."""
    if not isinstance(value, str):
        return None
    match = _DATE.match(value)
    if not match:
        return None
    day, month, year = (int(g) for g in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _overlaps(a_from, a_to, b_from, b_to) -> bool:
    """Do two date ranges demonstrably overlap?

    ⚠️ AN UNKNOWN DATE IS NOT AN OPEN-ENDED ONE, AND CONFLATING THEM INVENTED EVIDENCE. An
    earlier version returned True whenever a bound was missing, so two nearby records with no
    published dates at all were counted and reported as "mit Zeitüberschneidung" — a claim about
    time made from an absence of time. Callers that want those cases must ask for them
    explicitly; see `_overlap_state`.
    """
    return _overlap_state(a_from, a_to, b_from, b_to) == "overlap"


def _overlap_state(a_from, a_to, b_from, b_to) -> str:
    """'overlap', 'disjoint' or 'unbekannt' for two date ranges.

    A range with one known bound is treated as genuinely open at the other end, because that is
    how the city publishes ongoing work. A range with NO known bound tells us nothing.
    """
    if (a_from is None and a_to is None) or (b_from is None and b_to is None):
        return "unbekannt"
    if a_from and b_to and a_from > b_to:
        return "disjoint"
    if b_from and a_to and b_from > a_to:
        return "disjoint"
    return "overlap"


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalise(value: str) -> str:
    """Fold a German street name to a form that matches however it happens to be written.

    ⚠️ WITHOUT THIS, THE OBVIOUS QUESTION RETURNS NOTHING. The city writes `Lothstr. 16 - 18`;
    a person asks about the `Lothstraße`. Measured: a plain substring search for "lothstraße"
    found **0** of the 10 records a search for "lothstr" found, and the assistant then correctly
    but uselessly reported that there were no roadworks in that street.

    The fold is deliberately blunt — case, ß, the Straße/Str. alternation, and every separator —
    because all of those vary in the source and none of them carry meaning here.
    """
    folded = value.lower().replace("\u00df", "ss")
    folded = re.sub(r"stra(?:ss)?e\b", "str", folded)
    folded = re.sub(r"\bstr\.", "str", folded)
    # Drop everything that is not a letter or a digit: dots, hyphens, spaces and house numbers
    # are written inconsistently on both sides of the comparison.
    return re.sub(r"[^a-z0-9]+", "", folded)


# ------------------------------------------------------------------ Baustellen


def _baustelle_row(feature: dict[str, Any]) -> dict[str, Any]:
    """One roadworks record, flattened.

    ⚠️ THE IDENTIFIER IS `feature.id`, NOT `properties.fachliche_id`. Measured 2026-09-21 over
    400 records: `fachliche_id` is present on 317 of them and **null on 83**, while `feature.id`
    is present and distinct on all 400. Keying on the city's own reference therefore left a fifth
    of the dataset unaddressable — the agent could not attach a note to those Baustellen at all,
    and the failure was silent because an empty id simply never matched anything.

    ⚠️ A GeoServer FEATURE ID IS NOT A PERMANENT KEY. It looks like `baustellen_opendata.42` and
    is tied to the row's position in the published layer, so a republish can hand the same id to a
    different Baustelle. That is why a note stores its own copy of the location, the coordinates
    and the dates: it has to stay readable and checkable even if the id it was filed under later
    points somewhere else.
    """
    props = feature.get("properties") or {}
    centre = _centroid(feature.get("geometry"))
    return {
        "id": _text(feature.get("id")) or "",
        "fachliche_id": _text(props.get("fachliche_id")),
        "art": _text(props.get("art")),
        "ort": _text(props.get("strasse_hausnr")),
        "bereiche": _text(props.get("betroffene_bereiche")),
        "beeintraechtigung": _text(props.get("beeintraechtigung")),
        "beschreibung": _text(props.get("beschreibung")),
        "beginn": _text(props.get("beginn_datum_kombiniert")),
        "ende": _text(props.get("ende_datum_kombiniert")),
        "easting": round(centre[0], 1) if centre else None,
        "northing": round(centre[1], 1) if centre else None,
    }


def baustellen_suchen(
    strasse: str | None = None,
    art: str | None = None,
    datum_von: str | None = None,
    datum_bis: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Find notified roadworks and parking bans, filtered by street, kind and period."""
    features = sources.baustellen()
    needle = _normalise(strasse or "")
    want_art = (art or "").strip().lower()
    von = _parse_date(datum_von) if datum_von else None
    bis = _parse_date(datum_bis) if datum_bis else None

    rows: list[dict[str, Any]] = []
    for feature in features:
        row = _baustelle_row(feature)
        if needle:
            haystack = _normalise(" ".join(
                filter(None, [row["ort"], row["bereiche"], row["beschreibung"]])
            ))
            if needle not in haystack:
                continue
        if want_art and want_art not in (row["art"] or "").lower():
            continue
        if von or bis:
            if not _overlaps(_parse_date(row["beginn"]), _parse_date(row["ende"]), von, bis):
                continue
        rows.append(row)

    total = len(rows)
    capped = min(max(int(limit or 20), 1), MAX_ROWS)
    return {
        "treffer": total,
        "angezeigt": min(total, capped),
        "eintraege": rows[:capped],
        "quelle": "Landeshauptstadt München, offene Daten (mor_wfs:baustellen_opendata)",
        "hinweis": (
            "Der Datensatz nennt keine ausführende Organisation. "
            "Wer gräbt, geht aus diesen Daten nicht hervor."
        ),
    }


def baustellen_ueberschneidungen(
    strasse: str | None = None,
    radius_m: int = 150,
    nur_baumassnahmen: bool = True,
    limit: int = 15,
) -> dict[str, Any]:
    """Pairs of notified restrictions that are close together AND overlap in time.

    This is the cross-organisation question: the same stretch of street dug up twice in the same
    window. The tool reports the coincidence and the measured distance; it cannot and does not say
    who the parties are, because the open data does not carry that.
    """
    radius = min(max(int(radius_m or 150), 10), 2000)
    features = sources.baustellen()

    candidates: list[dict[str, Any]] = []
    needle = _normalise(strasse or "")
    for feature in features:
        row = _baustelle_row(feature)
        if row["easting"] is None:
            continue
        if nur_baumassnahmen and (row["art"] or "").lower() != "baumaßnahme":
            continue
        if needle:
            haystack = _normalise(" ".join(filter(None, [row["ort"], row["bereiche"]])))
            if needle not in haystack:
                continue
        candidates.append(row)

    pairs: list[dict[str, Any]] = []
    unverifiable = 0
    for i in range(len(candidates)):
        a = candidates[i]
        a_from, a_to = _parse_date(a["beginn"]), _parse_date(a["ende"])
        for j in range(i + 1, len(candidates)):
            b = candidates[j]
            distance = _distance_m((a["easting"], a["northing"]), (b["easting"], b["northing"]))
            if distance > radius:
                continue
            state = _overlap_state(a_from, a_to, _parse_date(b["beginn"]), _parse_date(b["ende"]))
            if state == "disjoint":
                continue
            if state == "unbekannt":
                # Counted and named, never folded into the overlap figure.
                unverifiable += 1
                continue
            pairs.append(
                {
                    "abstand_m": round(distance),
                    "a": {k: a[k] for k in ("id", "ort", "beginn", "ende", "beschreibung")},
                    "b": {k: b[k] for k in ("id", "ort", "beginn", "ende", "beschreibung")},
                }
            )
    pairs.sort(key=lambda p: p["abstand_m"])
    capped = min(max(int(limit or 15), 1), MAX_PAIRS)
    return {
        "geprueft": len(candidates),
        "radius_m": radius,
        "paare": len(pairs),
        "angezeigt": min(len(pairs), capped),
        "paare_ohne_datumsangabe": unverifiable,
        "eintraege": pairs[:capped],
        "quelle": "Landeshauptstadt München, offene Daten (mor_wfs:baustellen_opendata)",
        "hinweis": (
            "Nähe wird zwischen den Flächenmittelpunkten gemessen, nicht zwischen den Rändern. "
            "Eine Überschneidung in Ort und Zeit ist ein Hinweis, kein nachgewiesener Konflikt. "
            "'paare_ohne_datumsangabe' liegen räumlich nah beieinander, haben aber keine "
            "veröffentlichten Zeiträume; über ihre zeitliche Lage ist nichts bekannt. "
            "Die ausführenden Organisationen sind in den offenen Daten nicht enthalten."
        ),
    }


def haltestellen_betroffen(baustelle_id: str, radius_m: int = 200) -> dict[str, Any]:
    """MVG stops close to one notified restriction."""
    radius = min(max(int(radius_m or 200), 10), 1000)
    target = None
    for feature in sources.baustellen():
        row = _baustelle_row(feature)
        if row["id"] and row["id"] == str(baustelle_id).strip():
            target = row
            break
    if not target or target["easting"] is None:
        return {
            "gefunden": False,
            "baustelle_id": baustelle_id,
            "hinweis": "Zu dieser Kennung ist keine Baustelle mit Geometrie veröffentlicht.",
        }

    stops: list[dict[str, Any]] = []
    for feature in sources.haltestellen():
        centre = _centroid(feature.get("geometry"))
        if not centre:
            continue
        distance = _distance_m((target["easting"], target["northing"]), centre)
        if distance > radius:
            continue
        props = feature.get("properties") or {}
        stops.append(
            {
                "name": _text(props.get("haltestelle")) or _text(props.get("name")) or "",
                "abstand_m": round(distance),
            }
        )
    stops.sort(key=lambda s: s["abstand_m"])
    return {
        "gefunden": True,
        "baustelle": {k: target[k] for k in ("id", "ort", "art", "beginn", "ende")},
        "radius_m": radius,
        "haltestellen": stops[:MAX_ROWS],
        "anzahl": len(stops),
        "quelle": "Landeshauptstadt München, offene Daten (ÖPNV-Haltestellen, Baustellen)",
    }


# ------------------------------------------------------------------ Luftqualität

_MUNICH = "München"


def _station_rows() -> list[dict[str, Any]]:
    payload = sources.uba_stations()
    names = payload.get("indices") or []
    rows = payload.get("data") or {}

    def col(row, column):
        if column not in names:
            return None
        at = names.index(column)
        if not isinstance(row, list) or at >= len(row):
            return None
        value = row[at]
        if value is None:
            return None
        text = str(value).strip()
        # ⚠️ The API sends the STRING "null" for an empty cell, not JSON null.
        return None if text in ("", "null") else text

    out = []
    for station_id, row in rows.items():
        if not isinstance(row, list):
            continue
        city = col(row, "station city")
        # ⚠️ NOT AN EQUALITY TEST. Station 523 carries "München, Stadtteil Johanneskirchen".
        if not city or not (city == _MUNICH or city.startswith(_MUNICH + ",")):
            continue
        if col(row, "station active to") is not None:
            continue
        out.append(
            {
                "id": station_id,
                "name": col(row, "station name") or station_id,
                "typ": col(row, "station type name") or "",
                "umgebung": col(row, "station setting name") or "",
                "adresse": " ".join(
                    filter(None, [col(row, "station street"), col(row, "station street nr")])
                ),
            }
        )
    out.sort(key=lambda s: s["name"])
    return out


def _component_meta() -> dict[str, dict[str, str]]:
    payload = sources.uba_components()
    names = payload.get("indices") or []

    def col(row, column):
        if column not in names:
            return ""
        at = names.index(column)
        return str(row[at]).strip() if isinstance(row, list) and at < len(row) else ""

    meta = {}
    for key, row in payload.items():
        # ⚠️ This endpoint puts rows at the TOP LEVEL beside `indices`, unlike /stations.
        if not key.isdigit() or not isinstance(row, list):
            continue
        meta[key] = {
            "symbol": col(row, "component symbol") or key,
            "einheit": col(row, "component unit"),
            "name": col(row, "component name"),
        }
    return meta


def _cet_param(instant: datetime) -> tuple[str, int]:
    """⚠️ The API runs on CET all year and counts hours 1..24, where H ends at H:00."""
    cet = instant + timedelta(hours=1)
    return cet.strftime("%Y-%m-%d"), cet.hour + 1


def luftqualitaet(station: str | None = None, stunden: int = 3) -> dict[str, Any]:
    """Latest published hour per Munich measuring station."""
    stations = _station_rows()
    if station:
        needle = str(station).strip().lower()
        stations = [s for s in stations if needle in s["name"].lower() or needle == s["id"]]
    if not stations:
        return {"stationen": [], "hinweis": "Keine passende Münchner Messstation gefunden."}

    meta = _component_meta()
    hours = min(max(int(stunden or 3), 1), 24)
    now = datetime.now(timezone.utc)
    date_from, hour_from = _cet_param(now - timedelta(hours=hours + 5))
    date_to, hour_to = _cet_param(now)

    results = []
    for entry in stations[:6]:
        try:
            payload = sources.uba_airquality(entry["id"], date_from, hour_from, date_to, hour_to)
        except sources.SourceUnavailable as exc:
            results.append({**entry, "messwerte": None, "fehler": str(exc)})
            continue
        by_time = (payload.get("data") or {}).get(entry["id"]) or {}
        starts = sorted(by_time)
        if not starts:
            results.append({**entry, "messwerte": None})
            continue
        row = by_time[starts[-1]]
        values = []
        for item in row[3:]:
            if not isinstance(item, list) or len(item) < 3:
                continue
            info = meta.get(str(item[0]), {})
            values.append(
                {
                    "komponente": info.get("name") or f"Komponente {item[0]}",
                    "symbol": info.get("symbol"),
                    "wert": item[1],
                    "einheit": info.get("einheit"),
                    "index": item[2],
                }
            )
        results.append(
            {
                **entry,
                "von": starts[-1],
                "bis": row[0] if row else None,
                "gesamtindex": row[1] if len(row) > 1 else None,
                # ⚠️ Field 2 is named "data incomplete" in the response's own `indices`.
                "unvollstaendig": bool(len(row) > 2 and row[2] == 1),
                "messwerte": values,
            }
        )

    return {
        "stationen": results,
        "zeitangabe": "MEZ",
        "quelle": "Umweltbundesamt, Air Data (luftdaten.umweltbundesamt.de)",
        "hinweis": (
            "Die Schnittstelle veröffentlicht keine Definition der Indexskala und keine Benennung "
            "der Stufen. Nenne deshalb nur die Zahl und die Messwerte, keine Einstufung wie "
            "'gut' oder 'mäßig', und keinen Maximalwert."
        ),
    }


# ------------------------------------------------------------------ Flugverkehr


def flugverkehr_jetzt(radius_nm: int = 25) -> dict[str, Any]:
    radius = min(max(int(radius_nm or 25), 1), 60)
    payload = sources.adsb(AIRPORT[0], AIRPORT[1], radius)
    aircraft = payload.get("ac") or []
    on_ground = sum(1 for a in aircraft if a.get("alt_baro") == "ground")
    rows = []
    for item in aircraft[:MAX_ROWS]:
        rows.append(
            {
                "kennung": (item.get("flight") or item.get("r") or item.get("hex") or "").strip(),
                "muster": (item.get("t") or "").strip() or None,
                "am_boden": item.get("alt_baro") == "ground",
                "hoehe_ft": item.get("alt_baro") if item.get("alt_baro") != "ground" else None,
            }
        )
    return {
        "anzahl": len(aircraft),
        "am_boden": on_ground,
        "radius_nm": radius,
        "eintraege": rows,
        "quelle": "adsb.lol, ehrenamtliche Empfängergemeinschaft, ODbL",
        "hinweis": (
            "Nicht jedes Luftfahrzeug sendet ADS-B; Abdeckung ist nicht zugesichert. "
            "Die Höhe ist eine Druckhöhe (1013,25 hPa), keine Höhe über Grund."
        ),
    }


# ------------------------------------------------------------------ Koordinationsnotizen


def notizen_lesen(baustelle_id: str | None = None, limit: int = 20) -> dict[str, Any]:
    capped = min(max(int(limit or 20), 1), MAX_ROWS)
    rows = notes_store.list_notes(baustelle_id=baustelle_id, limit=capped)
    return {
        "anzahl": len(rows),
        "eintraege": rows,
        "quelle": "München Zwilling, app-eigene Koordinationsnotizen",
        "hinweis": (
            "Diese Notizen stammen aus dieser Anwendung und sind KEIN amtlicher Datensatz. "
            "Sie ändern nichts an den offenen Daten der Landeshauptstadt."
        ),
    }


def notiz_entwurf(
    baustelle_id: str,
    kategorie: str,
    text: str,
    zeitraum_von: str | None = None,
    zeitraum_bis: str | None = None,
) -> dict[str, Any]:
    """Prepare a note for a human to confirm.

    ⚠️ THIS WRITES NOTHING, AND THAT IS THE POINT. The agent may compose a note; only a person
    pressing "Speichern" in the app turns it into a stored row. Letting a language model write
    into a coordination record that other organisations read would be indefensible, and the
    approval gate is what makes "die KI hat unsere Daten geändert" a sentence nobody can say.
    """
    target = None
    for feature in sources.baustellen():
        row = _baustelle_row(feature)
        if row["id"] and row["id"] == str(baustelle_id).strip():
            target = row
            break
    if not target:
        return {
            "ok": False,
            "grund": "Zu dieser Kennung ist keine Baustelle veröffentlicht.",
            "baustelle_id": baustelle_id,
        }

    draft = notes_store.create_draft(
        baustelle_id=target["id"],
        ort=target["ort"] or "",
        easting=target["easting"],
        northing=target["northing"],
        kategorie=kategorie,
        text=text,
        zeitraum_von=zeitraum_von,
        zeitraum_bis=zeitraum_bis,
    )
    return {
        "ok": True,
        "entwurfId": draft["entwurfId"],
        "baustelle": {k: target[k] for k in ("id", "ort", "beginn", "ende")},
        "kategorie": draft["kategorie"],
        "text": draft["text"],
        "hinweis": (
            "Entwurf. Es wurde noch nichts gespeichert. "
            "Die Notiz wird erst gespeichert, wenn eine Person in der Anwendung bestätigt."
        ),
    }


# ------------------------------------------------------------------ dispatch

REGISTRY = {
    "baustellen_suchen": baustellen_suchen,
    "baustellen_ueberschneidungen": baustellen_ueberschneidungen,
    "haltestellen_betroffen": haltestellen_betroffen,
    "luftqualitaet": luftqualitaet,
    "flugverkehr_jetzt": flugverkehr_jetzt,
    "notizen_lesen": notizen_lesen,
    "notiz_entwurf": notiz_entwurf,
}


def run(name: str, args: dict[str, Any]) -> Any:
    fn = REGISTRY.get(name)
    if not fn:
        return {"fehler": f"Unbekanntes Werkzeug: {name}"}
    try:
        return fn(**(args or {}))
    except TypeError as exc:
        # A wrong argument shape is the agent's mistake and it can correct it; say so precisely.
        return {"fehler": f"Falsche Argumente für {name}: {exc}"}
    except sources.SourceUnavailable as exc:
        return {"fehler": f"Quelle derzeit nicht erreichbar: {exc}"}
    except notes_store.StoreUnavailable as exc:
        return {"fehler": f"Notizspeicher derzeit nicht erreichbar: {exc}"}
