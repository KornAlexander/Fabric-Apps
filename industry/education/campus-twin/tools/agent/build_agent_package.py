"""Build the Campus declarative agent package from the code that actually serves the API.

    python tools\\agent\\build_agent_package.py

Writes `copilot/campus-agent/` and a zip in `repos\\temp\\`. Everything is generated, so there is
one source of truth: `server/intake.py`. ⚠️ A HAND WRITTEN OPENAPI SPEC IS A LIE WITH A TIMESTAMP.
It agrees with the code on the day it is written and silently stops agreeing later, and the failure
lands on a professor being told their request was filed when the server rejected the field.

Two conversions happen here that are easy to get wrong:

  1. **3.1 -> 3.0.3.** FastAPI emits OpenAPI 3.1. API plugins want 3.0.x. Pydantic v2 renders an
     optional field as `anyOf: [{type: string}, {type: null}]`; `{"type": "null"}` is JSON Schema
     2020-12, legal in 3.1 and INVALID in 3.0, where it must be `nullable: true`. Changing only the
     version string produces a document that claims 3.0 and is not.
  2. **$ref inlining.** FastAPI puts request bodies in `components.schemas`. Some plugin validators
     do not follow `$ref` in a request body, so the models are inlined.

The auth story: `OAuthPluginVault` + a `reference_id` that is an **auth config ID created in the
Teams Developer Portal**. Verified against Microsoft Learn 2026-08-21. ⚠️ `EntraOboPluginVault` does
NOT exist; it is a plausible sounding invention. The reference_id CANNOT be generated here, because
it does not exist until the auth config is created, so it stays an obvious placeholder.

Configuration, all optional, all env:
    CAMPUS_AGENT_BACKEND_URL   the API host the agent calls (default: an RFC 2606 .invalid host)
    CAMPUS_AGENT_APP_ID        manifest id      (default: derived, see below)
    CAMPUS_AGENT_AUTH_REF      auth config id   (default: an obvious placeholder)
    CAMPUS_AGENT_OUT           output directory (default: outside the repository)
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

# ⚠️ THE PACKAGE IS A BUILD ARTEFACT AND IS NOT COMMITTED. It necessarily contains a reachable
# backend URL and an app id, so a copy checked into the tree points every clone of this repository
# at one deployment. `npm run check:publishable` caught exactly that. Output therefore lands
# outside the repo by default; override with CAMPUS_AGENT_OUT.
#
# ⚠️ THE DEFAULT IS THE OS TEMP DIRECTORY, NOT A LITERAL PATH. It used to name one developer's
# home directory, which meant "outside the repo" only on that one machine and simply failed to
# resolve anywhere else. `gettempdir()` is what "somewhere scratch, off the tree" actually means.
OUT_DIR = Path(os.getenv("CAMPUS_AGENT_OUT") or Path(tempfile.gettempdir()) / "campus-agent")
ZIP_PATH = OUT_DIR.with_suffix(".zip")

# ⚠️ NO LITERAL HOST. Unset means an obviously invalid placeholder, so a package built without
# configuration is visibly not deployable rather than quietly pointing somewhere real.
# `.invalid` is reserved by RFC 2606 and can never resolve.
BACKEND = os.getenv("CAMPUS_AGENT_BACKEND_URL", "https://campus-scheduler.example.invalid").rstrip("/")
BACKEND_HOST = BACKEND.split("//", 1)[1]

#: Where the consumer web app lives, for the "Stundenplan öffnen" button on a card.
#:
#: ⚠️ SAME PLACEHOLDER RULE AS `BACKEND`, and it matters more here: this URL is put inside an
#: `Action.OpenUrl`, so a literal host checked into the tree would be a button in somebody else's
#: Copilot that opens our deployment.
#:
#: ⚠️ AND ITS DOMAIN MUST BE IN `validDomains`. Microsoft's own guidance on Action.OpenUrl is
#: explicit: "make sure to include the domain of the target URL in the validDomains property. If
#: the domain isn't listed, Teams displays the message URL may lead to untrusted content." That is
#: the failure this constant exists to make impossible to forget, because it does not break the
#: package build, the import, or any test. It breaks one button, in production, for the user.
CONSUMER_URL = os.getenv(
    "CAMPUS_AGENT_CONSUMER_URL", "https://campus-scheduler.example.invalid/consumer.html").rstrip("/")
CONSUMER_HOST = CONSUMER_URL.split("//", 1)[1].split("/", 1)[0]

# ⚠️ DERIVED, NOT WRITTEN DOWN. A manifest id must be a guid, and a guid literal in source is
# indistinguishable from a tenant id to any scanner, including this repository's own. uuid5 over a
# stdlib namespace is reproducible across machines and contains no literal at all.
APP_ID = os.getenv("CAMPUS_AGENT_APP_ID") or str(
    uuid.uuid5(uuid.NAMESPACE_URL, "campus-scheduler/declarative-agent"))

AUTH_REFERENCE_ID = os.getenv(
    "CAMPUS_AGENT_AUTH_REF", "REPLACE_WITH_AUTH_CONFIG_ID_FROM_DEV_PORTAL")

#: Only these reach the agent. `/api/intake/{id}/decide` and `/api/intake/queue` are planner
#: operations and ARE included: the server enforces the role, so exposing them is safe and hiding
#: them would be security by menu, which §41 rejected explicitly.
AGENT_PATHS = {
    "/api/me", "/api/intake/preview", "/api/intake/submit",
    "/api/intake/mine", "/api/intake/queue", "/api/intake/{request_id}/decide",
}


def _error_codes() -> dict[str, str]:
    """The router's own `code` -> guidance map, read from the source of truth.

    ⚠️ Imported rather than copied. These strings tell the model what to DO about each failure,
    and `already_submitted` in particular means the caller already succeeded. A duplicate list
    here would go stale exactly the way the `kind` description did, and the symptom would be an
    agent apologising for a request that is sitting in the planner's queue.
    """
    os.environ.setdefault("ENTRA_AUTH_DISABLED", "1")
    import intake

    return dict(intake.ERROR_CODES)


def _normalise_31_keywords(node: dict[str, Any]) -> dict[str, Any]:
    """Replace the 3.1-only spellings that a 3.0 Schema Object is not allowed to carry.

    ⚠️ This lives in its own function because it USED TO BE inline at the bottom of
    `downgrade_to_30`, where the `anyOf` merge below returned before ever reaching it. Every
    optional field took that early return, so every `examples:` on a `| None` field survived into
    the output and the document was invalid OpenAPI 3.0. It looked fine, because the four fields
    that carry examples are all optional, so nothing was left half-converted to notice.
    """
    # `examples: [...]` (3.1, a list) vs `example: x` (3.0, a single value).
    if isinstance(node.get("examples"), list) and node["examples"]:
        node["example"] = node.pop("examples")[0]
    elif "examples" in node:
        node.pop("examples")

    # `const` is 3.1 only.
    if "const" in node:
        node["enum"] = [node.pop("const")]

    return node


def downgrade_to_30(node: Any) -> Any:
    """Recursively convert OpenAPI 3.1 nullability into 3.0 `nullable: true`."""
    if isinstance(node, list):
        return [downgrade_to_30(n) for n in node]
    if not isinstance(node, dict):
        return node

    node = {k: downgrade_to_30(v) for k, v in node.items()}

    for key in ("anyOf", "oneOf"):
        if key in node and isinstance(node[key], list):
            variants = [v for v in node[key] if v != {"type": "null"}]
            if len(variants) < len(node[key]):
                node["nullable"] = True
                if len(variants) == 1:
                    merged = dict(variants[0])
                    merged["nullable"] = True
                    for k, v in node.items():
                        if k not in (key, "nullable"):
                            merged.setdefault(k, v)
                    return _normalise_31_keywords(merged)
                node[key] = variants

    return _normalise_31_keywords(node)


def inline_refs(node: Any, components: dict[str, Any], depth: int = 0) -> Any:
    if depth > 8:
        return node
    if isinstance(node, list):
        return [inline_refs(n, components, depth + 1) for n in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        target = components.get(ref.rsplit("/", 1)[1], {})
        return inline_refs(json.loads(json.dumps(target)), components, depth + 1)
    return {k: inline_refs(v, components, depth + 1) for k, v in node.items()}


def build_openapi() -> dict[str, Any]:
    import os
    os.environ.setdefault("ENTRA_AUTH_DISABLED", "1")
    from fastapi import FastAPI

    import intake

    app = FastAPI(title="Campus Scheduler Intake", version="1.0.0")
    app.include_router(intake.router)
    spec = app.openapi()

    components = spec.get("components", {}).get("schemas", {})
    paths = {p: v for p, v in spec["paths"].items() if p in AGENT_PATHS}
    missing = AGENT_PATHS - set(paths)
    if missing:
        raise SystemExit(f"expected paths absent from the router: {sorted(missing)}")

    paths = inline_refs(paths, components)

    # ⚠️ 422 bodies reference HTTPValidationError and are noise to an agent. Drop them.
    for ops in paths.values():
        for op in ops.values():
            if isinstance(op, dict):
                op.get("responses", {}).pop("422", None)

    return downgrade_to_30({
        "openapi": "3.0.3",
        "info": {
            "title": "Campus Scheduler Intake",
            "version": "1.0.0",
            "description": (
                "Stundenplan-Anliegen erfassen und prüfen. Ändert den Plan nicht: "
                "jede Anfrage landet als Vorschlag beim Planungsbüro."
            ),
        },
        "servers": [{"url": BACKEND}],
        "paths": paths,
    })


def declarative_agent() -> dict[str, Any]:
    return {
        "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.2/schema.json",
        "version": "v1.2",
        "name": "Campus Stundenplan",
        "description": "Verfügbarkeiten melden und Stundenplan-Anliegen einreichen.",
        "instructions": "\n".join([
            "Du hilfst Lehrenden und dem Planungsbüro einer Hochschule bei Stundenplan-Anliegen.",
            "Antworte auf Deutsch, kurz und sachlich.",
            "",
            "## Ablauf",
            "1. Rufe zuerst getMyIdentity auf, um zu wissen, wer fragt und welche Rolle die Person hat.",
            "2. Bei einer Änderung IMMER zuerst previewAvailabilityChange aufrufen.",
            "3. Nenne die Auswirkung (betroffene Termine, noetige Verschiebungen) und frage nach Bestaetigung.",
            "4. Erst nach ausdruecklicher Bestaetigung submitIntakeRequest mit der previewId aufrufen.",
            "",
            "## Harte Regeln",
            "- ERFINDE NIEMALS ZAHLEN. Betroffene Termine, Verschiebungen und Machbarkeit stammen",
            "  ausschließlich aus der Antwort von previewAvailabilityChange. Wenn du keine Zahl hast,",
            "  sag das, statt zu schaetzen.",
            "- Wenn die Antwort ein Feld solverNote enthaelt, gib dessen Inhalt woertlich wieder und",
            "  denke dir keine eigene Begruendung aus.",
            "- Sage NIEMALS, dass etwas geändert, freigegeben oder veröffentlicht wurde. Du kannst",
            "  ausschließlich Anliegen einreichen. Der Plan wird nur im Cockpit veröffentlicht.",
            "- Formuliere das Ergebnis immer als 'als Anliegen erfasst, das Planungsbüro entscheidet'.",
            "- FRAGE NICHT NACH GRÜNDEN. Kein 'warum', keine Krankheits- oder Familiengründe. Wenn",
            "  jemand von sich aus einen Grund nennt, gib ihn nicht weiter und wiederhole ihn nicht.",
            "- Ohne previewId ist kein submitIntakeRequest möglich. Schlage keinen Umweg vor.",
            "",
            "## Rollen",
            "- Lehrende: eigene Anliegen einreichen, eigene Anliegen mit listMyIntakeRequests ansehen.",
            "- Planungsbüro: zusätzlich listIntakeQueue und decideIntakeRequest.",
            "- Wenn ein Aufruf 403 zurückgibt, erkläre sachlich, dass die Rolle dafür nicht reicht.",
            "  Versuche NICHT, es über einen anderen Aufruf zu umgehen.",
            "",
            "## Fehler richtig lesen",
            "Ein Fehler kann im Feld detail.code stehen. Diese Codes bedeuten:",
            # ⚠️ DERIVED FROM `intake.ERROR_CODES`, never typed out here. The router grew three codes
            # in one session and these instructions still described a world with none of them.
            *[f"- {code}: {text}" for code, text in sorted(_error_codes().items())],
            "",
            "## Fehlgeschlagene Anwendungen",
            "listIntakeQueue liefert zusätzlich needsAttention. Ist count größer als 0, wurden",
            "diese Anliegen angenommen, aber die Änderung ist NICHT im Plan gelandet. Nenne sie dem",
            "Planungsbüro und weise darauf hin, dass ein erneutes decideIntakeRequest sie nachholt.",
            "",
            "## Wenn der Server den Tag anders verstanden hat",
            "Enthält die Antwort interpretedDay, hat der Server einen anderen Tag verstanden als",
            "eingegeben (interpretedFrom). SAGE DAS AUSDRÜCKLICH, zum Beispiel 'ich habe Freitag",
            "als Fr gelesen', bevor du nach der Bestätigung fragst. Eine stille Korrektur ist",
            "genau das, was der Person die Möglichkeit nimmt zu widersprechen.",
        ]),
        "conversation_starters": [
            {"title": "Freitag blockieren", "text": "Ich kann freitags nicht mehr unterrichten. Was würde das bedeuten?"},
            {"title": "Meine Anliegen", "text": "Welche Anliegen habe ich offen?"},
            {"title": "Raumproblem melden", "text": "Der Raum in meiner Dienstagsvorlesung ist zu klein."},
        ],
        "actions": [{"id": "campusIntake", "file": "ai-plugin.json"}],
    }


#: Adaptive Card schema version. 1.5 is what Microsoft's own API-plugin examples use.
CARD_VERSION = "1.5"


def _text(text: str, **kw: Any) -> dict[str, Any]:
    return {"type": "TextBlock", "text": text, "wrap": True, **kw}


def _facts(*pairs: tuple[str, str], **kw: Any) -> dict[str, Any]:
    return {"type": "FactSet", "facts": [{"title": t, "value": v} for t, v in pairs], **kw}


def _card(*body: dict[str, Any], actions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    card: dict[str, Any] = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": CARD_VERSION,
        "body": list(body),
    }
    if actions:
        card["actions"] = actions
    return card


def _open(title: str, url: str) -> dict[str, Any]:
    """An Action.OpenUrl. ⚠️ Its host MUST be in `validDomains` or Teams warns on every click."""
    return {"type": "Action.OpenUrl", "title": title, "url": url}


#: What each operation renders as, inside the Copilot chat window.
#:
#: ⚠️ THIS IS THE ANSWER TO "PUT AN APP IN THE CHAT", AND IT IS NOT A POWER APP. A Power Apps
#: canvas app cannot be embedded in the Microsoft 365 Copilot chat window: every Microsoft
#: capability with those two words in it runs the other way round, putting Copilot INSIDE a canvas
#: or model-driven app. PLAN §42 had already declined to build a standalone Power App on licence
#: grounds; §54 records why the embedded version is not merely unwise but unavailable. The two
#: supported ways to make a Copilot answer interactive are Adaptive Card response templates, built
#: here, and MCP apps, which are UI widgets served at runtime by an MCP server and which this
#: repository has no server for yet.
#:
#: ⚠️ EVERY FIELD REFERENCED BELOW WAS READ OUT OF `server/intake.py`, NOT REMEMBERED. A template
#: that names a field the API does not return does not fail: it renders the `if(...)` fallback, so
#: the card looks like the API answered with nothing. `test_agent_cards.py` asserts the two agree.
#:
#: ⚠️ NO `Action.Submit` ANYWHERE. Only `Action.OpenUrl` is documented as supported here. A submit
#: button would render and then do nothing, which is worse than no button, and it would also
#: contradict §41: submitting is a decision a person makes in the conversation, having read the
#: cost, not a button that posts a form.
def response_semantics() -> dict[str, dict[str, Any]]:
    return {
        "getMyIdentity": {
            "data_path": "$",
            "properties": {"title": "$.name", "subtitle": "$.site"},
            "static_template": _card(
                _text("${if(name, name, 'Unbekannte Person')}", weight="Bolder", size="Medium"),
                _facts(
                    ("Standort", "${if(site, site, 'nicht ermittelt')}"),
                    ("Rolle", "${if(role, role, 'keine Rolle hinterlegt')}"),
                    ("Kennung", "${if(teacherId, teacherId, 'keiner Lehrperson zugeordnet')}"),
                ),
                # ⚠️ The provenance is shown, not hidden. An identity resolved from a mapping
                # somebody typed by hand is a different claim from one the university published,
                # and the person reading the card is the one who can tell us it is wrong.
                _text("Herkunft: ${if(identityProvenance, identityProvenance, 'nicht angegeben')}",
                      isSubtle=True, size="Small"),
            ),
        },
        "previewAvailabilityChange": {
            "data_path": "$",
            "properties": {"title": "$.previewId", "subtitle": "$.affectedSessions"},
            "static_template": _card(
                _text("Auswirkung berechnet", weight="Bolder", size="Medium"),
                # ⚠️ THE CORRECTION IS SHOWN FIRST, AND ONLY WHEN THERE WAS ONE. `interpretedDay`
                # is present in the response ONLY if the server understood something other than
                # what the person typed. Rendering it always would train everybody to ignore it,
                # which is how a field meant to surface a correction ends up hiding one.
                _text("Gelesen als **${interpretedDay}**, eingegeben war „${interpretedFrom}“.",
                      **{"$when": "${interpretedDay != null}"}),
                _facts(
                    ("Betroffene Termine", "${if(affectedSessions, affectedSessions, 0)}"),
                    ("Betroffene Kohorten", "${if(affectedCohorts, affectedCohorts, 0)}"),
                    ("Nötige Verschiebungen",
                     "${if(wouldMove != null, wouldMove, 'nicht berechenbar')}"),
                    ("Lösbar", "${if(feasible, 'ja', 'nein')}"),
                ),
                # ⚠️ VERBATIM FROM THE SOLVER. §26.4: when the solver refuses, its own words are
                # the only acceptable source for what is said next. Paraphrasing a refusal into
                # the card's own prose is how "cannot be checked" becomes "checked, fine".
                _text("Hinweis des Solvers: ${solverNote}",
                      isSubtle=True, **{"$when": "${solverNote != null}"}),
                _text("Optimalität bewiesen: ${if(optimalityProven, 'ja', 'nein')}",
                      isSubtle=True, size="Small"),
                _text("Diese Berechnung ändert den Plan nicht. Zum Einreichen wird die previewId "
                      "benötigt.", isSubtle=True, size="Small"),
                actions=[_open("Eigenen Stundenplan öffnen", CONSUMER_URL)],
            ),
        },
        "submitIntakeRequest": {
            "data_path": "$",
            "properties": {"title": "$.requestId", "subtitle": "$.status"},
            "static_template": _card(
                _text("Anliegen eingereicht", weight="Bolder", size="Medium"),
                _facts(
                    ("Vorgang", "${if(requestId, requestId, 'ohne Nummer')}"),
                    ("Status", "${if(status, status, 'unbekannt')}"),
                    ("Planstand", "${if(planVersion, planVersion, 'unbekannt')}"),
                ),
                _text("Das Planungsbüro entscheidet darüber. Der Plan ist dadurch nicht geändert.",
                      isSubtle=True, size="Small"),
            ),
        },
        "listMyIntakeRequests": {
            "data_path": "$",
            "properties": {"title": "$.site"},
            "static_template": _card(
                _text("Eigene Anliegen", weight="Bolder", size="Medium"),
                {
                    "type": "Container",
                    "$data": "${requests}",
                    "items": [_facts(
                        ("Vorgang", "${requestId}"),
                        ("Art", "${kind}"),
                        ("Status", "${status}"),
                    )],
                },
                _text("Keine offenen Anliegen.", isSubtle=True,
                      **{"$when": "${count(requests) == 0}"}),
                # ⚠️ THE TOTAL IS SHOWN BESIDE THE SHOWN COUNT. `listMyIntakeRequests` trims the
                # settled history to a limit; a list that silently stops at ten reads as "that is
                # everything", and somebody who filed twelve would conclude two were lost.
                _text("Entschieden: ${decidedShown} von ${decidedTotal} angezeigt.",
                      isSubtle=True, size="Small", **{"$when": "${decidedTotal > 0}"}),
            ),
        },
        "listIntakeQueue": {
            "data_path": "$",
            "properties": {"title": "$.site", "subtitle": "$.status"},
            "static_template": _card(
                _text("Eingang Planungsbüro", weight="Bolder", size="Medium"),
                # ⚠️ THE BANNER IS THE REASON THIS CARD USES `data_path: $` RATHER THAN
                # `$.requests`. Pointing the data path at the array is the documented pattern for
                # a list, and it would drop `needsAttention` on the floor, which is the one field
                # that says a request has been sitting there failing.
                {
                    "type": "Container",
                    "style": "attention",
                    "$when": "${needsAttention.count > 0}",
                    "items": [_text(
                        "⚠️ ${needsAttention.count} Anliegen brauchen Aufmerksamkeit: "
                        "${needsAttention.what}", weight="Bolder")],
                },
                {
                    "type": "Container",
                    "$data": "${requests}",
                    "items": [_facts(
                        ("Vorgang", "${requestId}"),
                        # ⚠️ THE PERSON'S NAME, NOT THEIR KENNUNG. `submittedByName` is in the row
                        # already. A queue that lists `M-T042` makes the planner look somebody up
                        # before they can even decide whether the request is urgent, and the same
                        # argument already won once for the availability spreadsheet filename.
                        ("Person", "${if(submittedByName, submittedByName, teacherId)}"),
                        ("Art", "${kind}"),
                        ("Status", "${status}"),
                    )],
                },
                _text("Nichts offen.", isSubtle=True, **{"$when": "${count(requests) == 0}"}),
            ),
        },
        "decideIntakeRequest": {
            "data_path": "$",
            "properties": {"title": "$.requestId", "subtitle": "$.status"},
            "static_template": _card(
                _text("Entscheidung festgehalten", weight="Bolder", size="Medium"),
                _facts(
                    ("Vorgang", "${if(requestId, requestId, 'ohne Nummer')}"),
                    ("Status", "${if(status, status, 'unbekannt')}"),
                    ("Veröffentlicht", "${if(published, 'ja', 'nein')}"),
                    ("Übernommen", "${if(applied, 'ja', 'nein')}"),
                ),
                # ⚠️ SAID ON THE CARD, not only in the instructions. Accepting a request records a
                # decision; it does not publish a plan. A planner who reads "angenommen" and
                # assumes the timetable changed is the failure this line exists to prevent.
                _text("Eine Annahme veröffentlicht den Plan nicht.", isSubtle=True, size="Small"),
            ),
        },
    }


def ai_plugin() -> dict[str, Any]:
    _CARDS = response_semantics()
    return {
        "$schema": "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.1/schema.json",
        # v2.1 is used because it is the version EMPIRICALLY PROVEN to import in this tenant on
        # 2026-08-21 (the Campus Spike). 2.4 exists; the runtime auth object is identical. Do not
        # change this and the auth config in the same step, or a failure is unattributable.
        "schema_version": "v2.1",
        "name_for_human": "Campus Stundenplan",
        "description_for_human": "Stundenplan-Anliegen erfassen und prüfen.",
        "description_for_model": (
            "Erfasst Stundenplan-Anliegen von Lehrenden. Rechnet die Auswirkung einer Änderung mit "
            "einem Solver aus, bevor etwas eingereicht wird. Ändert den Plan selbst nicht."
        ),
        "namespace": "campusintake",
        # ⚠️ THE CARD IS ATTACHED HERE, NOT DESCRIBED IN THE INSTRUCTIONS. `response_semantics`
        # is read by Copilot to render the answer; the agent's prose instructions cannot make a
        # card appear and should not try to describe one. Built from `response_semantics()` so
        # the function list and the templates cannot drift apart: a function without a template
        # is caught by `test_agent_cards.py` rather than by noticing a plain answer in Teams.
        "functions": [
            dict(fn, capabilities={"response_semantics": _CARDS[fn["name"]]})
            if fn["name"] in _CARDS else fn
            for fn in [
                {"name": "getMyIdentity",
                 "description": "Wer ist die anfragende Person und welche Rolle hat sie."},
                {"name": "previewAvailabilityChange",
                 "description": ("Berechnet mit dem Solver, was eine Änderung kosten würde. Ändert nichts. "
                                 "Liefert eine previewId, die zum Einreichen noetig ist.")},
                {"name": "submitIntakeRequest",
                 "description": ("Reicht das Anliegen ein. Benötigt zwingend eine previewId. Das Anliegen "
                                 "ist danach 'pending' und wird vom Planungsbüro entschieden.")},
                {"name": "listMyIntakeRequests", "description": "Eigene offene Anliegen."},
                {"name": "listIntakeQueue", "description": "Nur Planungsbüro: offene Anliegen des Standorts."},
                {"name": "decideIntakeRequest",
                 "description": ("Nur Planungsbüro: Anliegen annehmen oder ablehnen. "
                                 "Veroeffentlicht den Plan NICHT.")},
            ]
        ],
        "runtimes": [{
            "type": "OpenApi",
            "auth": {"type": "OAuthPluginVault", "reference_id": AUTH_REFERENCE_ID},
            "spec": {"url": "campus-intake.yaml"},
            "run_for_functions": [
                "getMyIdentity", "previewAvailabilityChange", "submitIntakeRequest",
                "listMyIntakeRequests", "listIntakeQueue", "decideIntakeRequest",
            ],
        }],
    }


def manifest() -> dict[str, Any]:
    return {
        "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.19/MicrosoftTeams.schema.json",
        "manifestVersion": "1.19",
        "version": "1.0.0",
        "id": APP_ID,
        "developer": {
            "name": "Campus Scheduler",
            "websiteUrl": BACKEND,
            "privacyUrl": f"{BACKEND}/privacy",
            "termsOfUseUrl": f"{BACKEND}/terms",
        },
        "icons": {"color": "color.png", "outline": "outline.png"},
        "name": {"short": "Campus Stundenplan", "full": "Campus Stundenplan Assistent"},
        "description": {
            "short": "Stundenplan-Anliegen erfassen und prüfen.",
            "full": ("Meldet Verfügbarkeiten und Stundenplan-Anliegen, rechnet die Auswirkung mit "
                     "einem Solver aus und reicht sie beim Planungsbüro ein. Der Plan wird dadurch "
                     "nicht verändert."),
        },
        "accentColor": "#0F6CBD",
        "copilotAgents": {"declarativeAgents": [{"id": "campusStundenplan", "file": "declarativeAgent.json"}]},
        # ⚠️ THE CONSUMER HOST IS HERE BECAUSE A CARD LINKS TO IT. Microsoft's guidance on
        # Action.OpenUrl: "make sure to include the domain of the target URL in the validDomains
        # property. If the domain isn't listed, Teams displays the message URL may lead to
        # untrusted content." Deduplicated because the two usually ARE the same host, and a
        # repeated entry is the kind of thing a manifest validator rejects for no useful reason.
        "validDomains": sorted({BACKEND_HOST, CONSUMER_HOST}),
    }


def png(path: Path, size: int, rgb: tuple[int, int, int]) -> None:
    """A solid PNG without Pillow. Icons are a packaging requirement, not artwork."""
    import struct
    import zlib

    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    spec = build_openapi()

    import yaml  # PyYAML ships with the venv via other tooling
    (OUT_DIR / "campus-intake.yaml").write_text(
        yaml.safe_dump(spec, sort_keys=False, allow_unicode=True), encoding="utf-8")

    for name, obj in (("manifest.json", manifest()),
                      ("declarativeAgent.json", declarative_agent()),
                      ("ai-plugin.json", ai_plugin())):
        (OUT_DIR / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")

    png(OUT_DIR / "color.png", 192, (15, 108, 189))
    png(OUT_DIR / "outline.png", 32, (255, 255, 255))

    ZIP_PATH.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT_DIR.iterdir()):
            z.write(f, f.name)  # FLAT. A folder prefix makes Teams reject the package.

    print(f"wrote {OUT_DIR}")
    print(f"wrote {ZIP_PATH} ({ZIP_PATH.stat().st_size} bytes)")
    print(f"operations: {sum(len(v) for v in spec['paths'].values())} across {len(spec['paths'])} paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
