"""The Foundry half: one model, seven tools, and a loop that refuses to answer from memory.

⚠️ PLAIN `httpx` AGAINST THE RESPONSES API, NOT `azure-ai-projects`. This mirrors the shape that
already works in an earlier app against the same Azure OpenAI account, deliberately rather than
by omission: a second app that talks to the endpoint the same way is a second piece of evidence
about the endpoint, while a different SDK would only prove something about the SDK.

⚠️ THE ENTIRE `output` ARRAY IS ECHOED BACK INTO THE CONVERSATION, not just the function calls.
The reasoning items travel alongside them and the service rejects a follow-up that drops them.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from typing import Any, Callable, Iterator

import httpx

#: Where the model lives. No default endpoint: a wrong guess here is a confusing 404 rather than
#: an obvious misconfiguration.
ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip().rstrip("/")
DEPLOYMENT = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-chat-latest").strip()
USE_MANAGED_IDENTITY = os.getenv("AZURE_OPENAI_USE_MANAGED_IDENTITY", "").lower() == "true"
API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
USE_CLI_TOKEN = os.getenv("AZURE_OPENAI_USE_AZURE_CLI_TOKEN", "").lower() == "true"

_SCOPE = "https://cognitiveservices.azure.com/.default"

#: Ceiling on generated tokens per model call.
#:
#: ⚠️ THE CONTAINER'S CPU AND MEMORY LIMITS BOUND NOTHING HERE. Inference is billed remotely, so
#: a caller who reads the app key out of the public bundle could otherwise run up Foundry charges
#: that no limit in this deployment touches. Answers in this app are a short paragraph.
MAX_OUTPUT_TOKENS = 1200

#: Ceiling on tool-call rounds in a single request.
#:
#: ⚠️ THIS CONSTANT WAS MISSING AND THE MODULE COULD NOT BE IMPORTED. It is referenced as the
#: default of `stream_with_tools(max_rounds=...)`, which Python evaluates at import time, so its
#: absence raised NameError before the app could start. The running container predates the
#: regression, which is exactly why a working deployment was not evidence of importable source.
#: Keep it defined above its first use.
MAX_ROUNDS = 4

_token_lock = threading.Lock()
_cli_token: tuple[float, str] | None = None


def configured() -> bool:
    return bool(ENDPOINT)


def responses_url() -> str:
    return f"{ENDPOINT}/openai/v1/responses"


def _cli_bearer() -> str:
    """Laptop development only. Cached, because `az` takes about a second per call."""
    global _cli_token
    with _token_lock:
        if _cli_token and time.monotonic() - _cli_token[0] < 45 * 60:
            return _cli_token[1]
    result = subprocess.run(
        ["az", "account", "get-access-token", "--resource",
         "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, shell=True, timeout=60,
    )
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("az konnte kein Token ausstellen")
    with _token_lock:
        _cli_token = (time.monotonic(), token)
    return token


def auth_header() -> dict[str, str]:
    if API_KEY:
        return {"api-key": API_KEY}
    if USE_MANAGED_IDENTITY:
        from azure.identity import DefaultAzureCredential

        return {"Authorization": f"Bearer {DefaultAzureCredential().get_token(_SCOPE).token}"}
    if USE_CLI_TOKEN:
        return {"Authorization": f"Bearer {_cli_bearer()}"}
    raise RuntimeError(
        "Keine Anmeldung für Azure OpenAI konfiguriert "
        "(AZURE_OPENAI_USE_MANAGED_IDENTITY, AZURE_OPENAI_API_KEY oder "
        "AZURE_OPENAI_USE_AZURE_CLI_TOKEN)"
    )


SYSTEM_PROMPT = """Du bist der Koordinationsassistent des München Zwilling, eines 3D-Digital-Twins
von München und dem Flughafen München.

Du antwortest NIE aus dem Gedächtnis. Für alles, was mit Baustellen, Haltestellen, Luftqualität
oder Flugverkehr zu tun hat, rufst du die bereitgestellten Werkzeuge auf und antwortest
ausschließlich mit dem, was sie zurückgeben. Wenn ein Werkzeug einen Fehler meldet, sagst du das
und erfindest keinen Ersatz.

Wichtig, und zwar in dieser Reihenfolge:

- ⚠️ Die offenen Daten der Landeshauptstadt nennen NICHT, welche Organisation gräbt. Du darfst
  niemals behaupten, eine Baustelle gehöre zu M-net, den Stadtwerken, der Stadt oder dem
  Flughafen. Wenn jemand danach fragt, sage klar, dass diese Angabe im Datensatz nicht enthalten
  ist, und biete an, eine Koordinationsnotiz zu hinterlegen.
- ⚠️ `baustellen_ueberschneidungen` findet Meldungen, die räumlich nah beieinander liegen und sich
  zeitlich überlappen. Das ist ein HINWEIS auf Abstimmungsbedarf, kein nachgewiesener Konflikt.
  Formuliere es so.
- ⚠️ Beim Index der Luftqualität nennst du nur die Zahl und die gemessenen Werte. Das
  Umweltbundesamt veröffentlicht über diese Schnittstelle keine Skalendefinition und keine
  Benennung der Stufen. Sage also nie "gut", "mäßig" oder "Index 2 von 5".
- ⚠️ Du kannst KEINE Notiz speichern. `notiz_entwurf` erzeugt einen Entwurf. Gespeichert wird
  erst, wenn eine Person in der Anwendung auf Speichern klickt. Sage nie, du habest etwas
  gespeichert, eingetragen oder gemeldet.
- Koordinationsnotizen stammen aus dieser Anwendung. Sie sind kein amtlicher Datensatz und ändern
  nichts an den Daten der Landeshauptstadt.
- Die Zahlen in den Werkzeugantworten sind echt und tagesaktuell. Sage niemals, diese Daten seien
  Beispiel- oder Testdaten.

Antworte auf Deutsch, knapp und in ganzen Sätzen. Nenne konkrete Zahlen, Straßen und Zeiträume
statt allgemeiner Aussagen. Wenn eine Frage mit den vorhandenen Werkzeugen nicht zu beantworten
ist, sage genau das."""


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "baustellen_suchen",
        "description": (
            "Sucht gemeldete Baumaßnahmen und vorübergehende Haltverbote der Landeshauptstadt "
            "München, optional nach Straße, Art und Zeitraum."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "strasse": {"type": "string", "description": "Teil einer Straße oder Ortsangabe"},
                "art": {"type": "string", "description": "Baumaßnahme oder Haltverbot"},
                "datum_von": {"type": "string", "description": "TT.MM.JJJJ"},
                "datum_bis": {"type": "string", "description": "TT.MM.JJJJ"},
                "limit": {"type": "integer"},
            },
        },
    },
    {
        "type": "function",
        "name": "baustellen_ueberschneidungen",
        "description": (
            "Findet Paare von Meldungen, die räumlich nah beieinander liegen UND sich zeitlich "
            "überlappen. Hinweis auf Abstimmungsbedarf, kein nachgewiesener Konflikt. Die "
            "ausführenden Organisationen sind in den Daten nicht enthalten."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "strasse": {"type": "string"},
                "radius_m": {"type": "integer", "description": "Standard 150"},
                "nur_baumassnahmen": {"type": "boolean"},
                "limit": {"type": "integer"},
            },
        },
    },
    {
        "type": "function",
        "name": "haltestellen_betroffen",
        "description": "MVG-Haltestellen in der Nähe einer bestimmten Baustelle.",
        "parameters": {
            "type": "object",
            "properties": {
                "baustelle_id": {"type": "string"},
                "radius_m": {"type": "integer", "description": "Standard 200"},
            },
            "required": ["baustelle_id"],
        },
    },
    {
        "type": "function",
        "name": "luftqualitaet",
        "description": (
            "Zuletzt veröffentlichte Stundenwerte der amtlichen Münchner Messstationen des "
            "Umweltbundesamtes. Ohne Angabe werden alle Stationen geliefert."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "station": {"type": "string", "description": "Name oder Stations-ID"},
                "stunden": {"type": "integer"},
            },
        },
    },
    {
        "type": "function",
        "name": "flugverkehr_jetzt",
        "description": "Aktuelle ADS-B-Meldungen rund um den Flughafen München.",
        "parameters": {
            "type": "object",
            "properties": {"radius_nm": {"type": "integer", "description": "Standard 25"}},
        },
    },
    {
        "type": "function",
        "name": "notizen_lesen",
        "description": "Vorhandene Koordinationsnotizen dieser Anwendung, optional zu einer Baustelle.",
        "parameters": {
            "type": "object",
            "properties": {
                "baustelle_id": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
    },
    {
        "type": "function",
        "name": "notiz_entwurf",
        "description": (
            "Bereitet eine Koordinationsnotiz zu einer Baustelle VOR. Speichert nichts. "
            "Die Notiz entsteht erst, wenn eine Person in der Anwendung bestätigt."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "baustelle_id": {"type": "string"},
                "kategorie": {
                    "type": "string",
                    "enum": [
                        "Hinweis",
                        "Konflikt vermutet",
                        "Eigene Maßnahme geplant",
                        "Abstimmung erfolgt",
                    ],
                },
                "text": {"type": "string"},
                "zeitraum_von": {"type": "string"},
                "zeitraum_bis": {"type": "string"},
            },
            "required": ["baustelle_id", "kategorie", "text"],
        },
    },
]


def _response_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in payload.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for chunk in item.get("content", []) or []:
            text = chunk.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts).strip()


def _summarise(name: str, result: Any) -> str:
    """One short German line per tool result, so the UI can show what happened without the JSON."""
    if not isinstance(result, dict):
        return "Ergebnis erhalten"
    if result.get("fehler"):
        return str(result["fehler"])
    if name == "baustellen_suchen":
        return f"{result.get('treffer', 0)} Meldungen gefunden"
    if name == "baustellen_ueberschneidungen":
        return (
            f"{result.get('paare', 0)} Paare im Umkreis von "
            f"{result.get('radius_m', '?')} m mit Zeitüberschneidung"
        )
    if name == "haltestellen_betroffen":
        return f"{result.get('anzahl', 0)} Haltestellen in der Nähe"
    if name == "luftqualitaet":
        return f"{len(result.get('stationen') or [])} Messstationen abgefragt"
    if name == "flugverkehr_jetzt":
        return f"{result.get('anzahl', 0)} Luftfahrzeuge gemeldet"
    if name == "notizen_lesen":
        return f"{result.get('anzahl', 0)} Notizen"
    if name == "notiz_entwurf":
        return "Entwurf vorbereitet, noch nicht gespeichert" if result.get("ok") else str(
            result.get("grund", "Entwurf nicht möglich")
        )
    return "Ergebnis erhalten"


def stream_with_tools(
    prompt: str,
    execute: Callable[[str, dict[str, Any]], Any],
    max_rounds: int = MAX_ROUNDS,
) -> Iterator[dict[str, Any]]:
    """Run the tool loop, yielding NDJSON-shaped events."""
    if not configured():
        yield {"type": "error", "error": "not_configured",
               "message": "AZURE_OPENAI_ENDPOINT ist nicht gesetzt."}
        return

    try:
        headers = {"Content-Type": "application/json", **auth_header()}
    except Exception as exc:  # noqa: BLE001 - surfaced to the user as a message, not a 500
        yield {"type": "error", "error": "auth", "message": str(exc)}
        return

    conversation: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    yield {"type": "metadata", "provider": "azure-openai-foundry", "model": DEPLOYMENT}

    with httpx.Client(timeout=120) as client:
        for round_no in range(max_rounds):
            body = {
                "model": DEPLOYMENT,
                "input": conversation,
                "tools": TOOL_SCHEMAS,
                "max_output_tokens": MAX_OUTPUT_TOKENS,
            }
            try:
                response = client.post(responses_url(), headers=headers, json=body)
            except httpx.HTTPError as exc:
                yield {"type": "error", "error": "upstream",
                       "message": f"Modell nicht erreichbar: {type(exc).__name__}"}
                return
            if response.status_code != 200:
                yield {"type": "error", "error": "upstream",
                       "message": f"Modell antwortete mit HTTP {response.status_code}"}
                return

            payload = response.json()
            calls = [o for o in payload.get("output", []) if o.get("type") == "function_call"]

            if not calls:
                text = _response_text(payload)
                if text:
                    yield {"type": "delta", "text": text}
                yield {"type": "done", "rounds": round_no + 1}
                return

            # ⚠️ The WHOLE output, reasoning items included. Dropping them breaks the follow-up.
            conversation.extend(payload.get("output", []))

            for call in calls:
                name = call.get("name") or ""
                try:
                    args = json.loads(call.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                yield {"type": "tool", "name": name, "arguments": args}

                result = execute(name, args)
                event: dict[str, Any] = {
                    "type": "tool_result", "name": name, "summary": _summarise(name, result),
                }
                # The draft id travels to the UI so a person can confirm it with one click.
                if name == "notiz_entwurf" and isinstance(result, dict) and result.get("ok"):
                    event["entwurf"] = {
                        "entwurfId": result.get("entwurfId"),
                        "kategorie": result.get("kategorie"),
                        "text": result.get("text"),
                        "baustelle": result.get("baustelle"),
                    }
                yield event

                conversation.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.get("call_id"),
                        "output": json.dumps(result, ensure_ascii=False)[:60000],
                    }
                )

        yield {"type": "error", "error": "tool_loop_exhausted",
               "message": f"Nach {max_rounds} Werkzeugrunden abgebrochen."}
