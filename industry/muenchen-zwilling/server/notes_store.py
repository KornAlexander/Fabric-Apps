"""The coordination notes store: a Fabric SQL Database reached with the container's identity.

⚠️ THE APPROVAL GATE LIVES HERE, NOT IN THE PROMPT. `create_draft` is the only entry point the
agent can reach, and it writes to `NotizEntwurf`. Turning a draft into a note requires
`publish_draft`, which is only called from the route a person's click triggers. A rule written in
a system prompt is a request; a rule written as two tables and two functions is a constraint.

⚠️ THE AUTHOR IS CLIENT-REPORTED AND THE COLUMN SAYS SO. The Fabric session in the browser knows
who is signed in, and the app sends that along. It is not a server-verified token: Rayfin's auth
provider yields a Rayfin session rather than an access token for this API's audience, so this
service cannot independently prove who wrote a note. `autorGemeldet` is named to keep that
distinction visible to anyone reading the table later.
"""

from __future__ import annotations

import os
import struct
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

#: ODBC connection string for the Fabric SQL Database, without credentials.
NOTES_ODBC = os.getenv("ZWILLING_NOTES_ODBC", "").strip()

#: Entra scope for a Fabric SQL endpoint.
_SQL_SCOPE = "https://database.windows.net/.default"

#: SQL_COPT_SS_ACCESS_TOKEN. The documented way to hand an AAD token to the ODBC driver.
_SQL_COPT_SS_ACCESS_TOKEN = 1256

#: How long a draft stays usable.
DRAFT_MINUTES = 30

KATEGORIEN = ("Hinweis", "Konflikt vermutet", "Eigene Maßnahme geplant", "Abstimmung erfolgt")

MAX_TEXT = 2000


class StoreUnavailable(RuntimeError):
    """Configured correctly, unreachable right now.

    Paused Fabric capacity is the ordinary case in this tenant, not the exotic one, and it must
    not be reported as "your request was wrong".
    """


class StoreNotConfigured(RuntimeError):
    """No connection string at all. A deployment problem, not a runtime one."""


def enabled() -> bool:
    return bool(NOTES_ODBC)


def _token_struct() -> bytes:
    """⚠️ UTF-16-LE, LENGTH-PREFIXED. A raw string silently fails to authenticate and the driver
    reports a generic login error, which sends you looking at firewall rules instead."""
    from azure.identity import DefaultAzureCredential

    token = DefaultAzureCredential().get_token(_SQL_SCOPE).token
    raw = token.encode("utf-16-le")
    return struct.pack("<i", len(raw)) + raw


def _connect():
    if not NOTES_ODBC:
        raise StoreNotConfigured("ZWILLING_NOTES_ODBC ist nicht gesetzt")
    import pyodbc

    try:
        return pyodbc.connect(
            NOTES_ODBC, attrs_before={_SQL_COPT_SS_ACCESS_TOKEN: _token_struct()}
        )
    except pyodbc.Error as exc:
        # ⚠️ Only the driver's own connect errors. A broad `except Exception` would turn a real
        # bug in `_token_struct` into a soothing "try again later", which is how a permanent
        # failure gets mistaken for a transient one for a week.
        raise StoreUnavailable(str(exc).split("\n")[0][:200]) from exc


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_schema() -> None:
    """Apply `sql/koordination.sql`. Idempotent; safe on every boot."""
    script = (Path(__file__).parent / "sql" / "koordination.sql").read_text(encoding="utf-8")
    # ⚠️ Split on GO-free batches: the file deliberately uses `IF OBJECT_ID ... CREATE TABLE`
    # statements that pyodbc can execute one at a time.
    statements = [s.strip() for s in script.split("\n\n") if s.strip() and not s.strip().startswith("--")]
    with _connect() as conn:
        cursor = conn.cursor()
        for statement in statements:
            cursor.execute(statement)
        conn.commit()


def _clean_text(value: Any) -> str:
    text = (str(value or "")).strip()
    if not text:
        raise ValueError("Der Notiztext darf nicht leer sein.")
    return text[:MAX_TEXT]


def _clean_kategorie(value: Any) -> str:
    text = (str(value or "")).strip()
    if text not in KATEGORIEN:
        raise ValueError(f"Unbekannte Kategorie. Erlaubt: {', '.join(KATEGORIEN)}")
    return text


def create_draft(
    baustelle_id: str,
    ort: str,
    easting: float | None,
    northing: float | None,
    kategorie: str,
    text: str,
    zeitraum_von: str | None = None,
    zeitraum_bis: str | None = None,
) -> dict[str, Any]:
    """Store a draft and return its single-use id. Never creates a note."""
    draft_id = uuid.uuid4()
    clean = _clean_text(text)
    kind = _clean_kategorie(kategorie)
    expires = _now() + timedelta(minutes=DRAFT_MINUTES)

    with _connect() as conn:
        conn.cursor().execute(
            """
            INSERT INTO dbo.NotizEntwurf
                (entwurfId, baustelleId, ort, easting, northing, kategorie, text,
                 zeitraumVon, zeitraumBis, laeuftAbAm)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            str(draft_id), str(baustelle_id)[:128], (ort or "")[:256], easting, northing,
            kind, clean, (zeitraum_von or None), (zeitraum_bis or None), expires,
        )
        conn.commit()

    return {
        "entwurfId": str(draft_id),
        "kategorie": kind,
        "text": clean,
        "laeuftAbAm": expires.isoformat(),
    }


def publish_draft(entwurf_id: str, autor_gemeldet: str | None) -> dict[str, Any]:
    """Turn a draft into a stored note. Called only from the human confirmation route.

    ⚠️ SINGLE USE, ENFORCED IN SQL RATHER THAN IN PYTHON. The UPDATE that stamps `verwendetAm`
    matches only rows where it is still NULL, so two simultaneous confirmations cannot both win.
    Checking first and writing afterwards would leave a window between them.
    """
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE dbo.NotizEntwurf
               SET verwendetAm = SYSUTCDATETIME()
             OUTPUT inserted.baustelleId, inserted.ort, inserted.easting, inserted.northing,
                    inserted.kategorie, inserted.text, inserted.zeitraumVon, inserted.zeitraumBis
             WHERE entwurfId = ?
               AND verwendetAm IS NULL
               AND laeuftAbAm > SYSUTCDATETIME()
            """,
            str(entwurf_id),
        )
        row = cursor.fetchone()
        if row is None:
            conn.rollback()
            return {"ok": False, "grund": "Entwurf unbekannt, bereits gespeichert oder abgelaufen."}

        note_id = uuid.uuid4()
        cursor.execute(
            """
            INSERT INTO dbo.Koordinationsnotiz
                (notizId, baustelleId, ort, easting, northing, kategorie, text,
                 zeitraumVon, zeitraumBis, autorGemeldet, quelleKanal, entwurfId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            str(note_id), row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7],
            (autor_gemeldet or None), "agent-entwurf", str(entwurf_id),
        )
        conn.commit()

    return {"ok": True, "notizId": str(note_id), "baustelleId": row[0], "text": row[5]}


def create_note(
    baustelle_id: str,
    ort: str,
    easting: float | None,
    northing: float | None,
    kategorie: str,
    text: str,
    autor_gemeldet: str | None,
    zeitraum_von: str | None = None,
    zeitraum_bis: str | None = None,
) -> dict[str, Any]:
    """Write a note the user composed directly in the app, with no agent involved."""
    note_id = uuid.uuid4()
    clean = _clean_text(text)
    kind = _clean_kategorie(kategorie)
    with _connect() as conn:
        conn.cursor().execute(
            """
            INSERT INTO dbo.Koordinationsnotiz
                (notizId, baustelleId, ort, easting, northing, kategorie, text,
                 zeitraumVon, zeitraumBis, autorGemeldet, quelleKanal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            str(note_id), str(baustelle_id)[:128], (ort or "")[:256], easting, northing,
            kind, clean, (zeitraum_von or None), (zeitraum_bis or None),
            (autor_gemeldet or None), "app",
        )
        conn.commit()
    return {"ok": True, "notizId": str(note_id)}


def withdraw_note(notiz_id: str, autor_gemeldet: str | None) -> dict[str, Any]:
    """Mark a note as withdrawn.

    ⚠️ A STAMP, NOT A DELETE. Other organisations may already have read it, so the record that it
    existed is part of the coordination history.
    """
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE dbo.Koordinationsnotiz
               SET zurueckgezogenAm = SYSUTCDATETIME()
             WHERE notizId = ? AND zurueckgezogenAm IS NULL
            """,
            str(notiz_id),
        )
        changed = cursor.rowcount
        conn.commit()
    return {"ok": changed > 0, "notizId": str(notiz_id)}


def list_notes(baustelle_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    capped = min(max(int(limit or 50), 1), 200)
    sql = """
        SELECT TOP (?) notizId, baustelleId, ort, easting, northing, kategorie, text,
               zeitraumVon, zeitraumBis, autorGemeldet, quelleKanal, erstelltAm
          FROM dbo.Koordinationsnotiz
         WHERE zurueckgezogenAm IS NULL
    """
    params: list[Any] = [capped]
    if baustelle_id:
        sql += " AND baustelleId = ?"
        params.append(str(baustelle_id)[:128])
    sql += " ORDER BY erstelltAm DESC"

    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, *params)
        rows = cursor.fetchall()

    return [
        {
            "notizId": str(r[0]),
            "baustelleId": r[1],
            "ort": r[2],
            "easting": r[3],
            "northing": r[4],
            "kategorie": r[5],
            "text": r[6],
            "zeitraumVon": r[7],
            "zeitraumBis": r[8],
            "autorGemeldet": r[9],
            "quelleKanal": r[10],
            "erstelltAm": r[11].isoformat() if r[11] else None,
        }
        for r in rows
    ]
