"""The consumer surface: one person, their own week, and a chat that cannot look past it.

The planner app answers questions about a whole university. This answers questions about ONE
lecturer, and it is a separate router rather than a flag on the existing one because the two have
opposite defaults: `app.py` is built so a planner can see everybody, and everything here is built
so a caller can see nobody but themselves.

⚠️ THIS EXISTS BECAUSE `app.py` HAS NO AUTHENTICATION AND SAYS SO. Its only gate is `X-App-Key`,
and its own comment is blunt about what that is worth: "It is compiled into the Vite bundle, and
that bundle is served anonymously from the Fabric static host - a plain GET of /assets/index-*.js
returns it to anyone. It stops a casual caller who has not looked, and nothing more. It is a speed
bump, not auth." Concretely, `GET /api/calendar?scope=teacher&key=<anyone>` returns any lecturer's
week to anybody who opened the browser devtools once. Row-level security cannot be added to that
endpoint by filtering it, because there is no identity in the request to filter BY. So the consumer
path goes through Entra, like `intake.py`, and takes its subject from a validated token.

Row-level security here is enforced in THREE places, and it needs all three:

  1. **Subject binding.** No endpoint below accepts `scope` or `key`. They are derived from the
     bearer token. An endpoint that takes the row key from the client is not access control, it is
     a suggestion box.

  2. **Tool-argument clamping.** The chat's tools each take a free `teacher` argument. Without (2),
     (1) is theatre: a caller who cannot GET a colleague's week can simply ask the assistant for
     it, and the assistant will helpfully call `get_calendar(scope="teacher", key="M-T042")`.

  3. **Deny by default.** An Entra account with no row in `dbo.IntakeIdentity` gets 403, not a
     read-only guest view. Inherited from `intake.py`: no mapping means no role, and no role means
     no.

⚠️ "RLS" IS APPLICATION-LEVEL HERE, AND THAT IS A STATEMENT ABOUT THE ARCHITECTURE RATHER THAN A
SHORTCUT. A SQL security policy would be the usual answer and would protect nothing that matters:
`schedule_store.py` reads the timetable out of `data/<site>/*.json` on disk. The only consumer-
relevant table in Fabric SQL is `dbo.TeacherAvailabilities`. Writing a security policy and calling
the app secure would be the more dangerous outcome, because it would look like the box was ticked.

Run it:

    uvicorn consumer_app:app --app-dir server --port 8082
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import proposals
from auth import Principal, require_user
from calendar_view import calendar_view
from intake import resolve_caller
from schedule_store import store_for
from tools import get_affected_sessions, get_calendar

router = APIRouter(prefix="/api/me", tags=["consumer"])


#: The only tools a consumer's assistant may actually run.
#:
#: ⚠️ THE MODEL IS STILL OFFERED ALL SEVEN, AND THAT IS NOT THE BUG IT LOOKS LIKE. `foundry.py`
#: bakes `TOOL_SCHEMAS` into the request body, so the menu cannot be narrowed from here without
#: editing a file another task is holding. It does not need to be: the model proposing a call is
#: not the same event as the call happening, and `_executor` below is the thing that happens.
#: Restricting the menu would be a nicety for the model's benefit; refusing at execution is the
#: security boundary. If the two ever disagree, the executor wins, which is the correct direction.
#:
#: ⚠️ `find_substitute` AND `propose_repairs` ARE ABSENT ON PURPOSE. They answer "who else could
#: teach this", which is a question about OTHER PEOPLE'S availability. There is no way to clamp
#: them to the caller, because a substitute who is the caller is not a substitute. They are not
#: dangerous tools; they are simply not consumer tools.
CONSUMER_TOOLS: dict[str, Callable[..., dict[str, Any]]] = {
    "get_calendar": get_calendar,
    "get_affected_sessions": get_affected_sessions,
}


class AskRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    site: str | None = None


def _subject(user: Principal, site: str | None) -> tuple[str, Any, dict[str, Any], str]:
    """Which university, which store, who the caller is, and the ONE row key they may read.

    ⚠️ THE `teacherId` IS THE WHOLE OF THE ACCESS DECISION, so a missing one is a refusal rather
    than an empty result. `dbo.IntakeIdentity.teacherId` is nullable: a planner can hold a row with
    no teacher attached, because planning is not teaching. Such an account has no own week to show,
    and inventing one - or falling through to an unfiltered read - is exactly the failure this
    module exists to prevent.
    """
    resolved_site, ident = resolve_caller(user, site)
    teacher_id = (ident.get("teacherId") or "").strip()
    if not teacher_id:
        raise HTTPException(403, {
            "code": "no_own_timetable",
            "message": "Dieses Konto ist an diesem Standort hinterlegt, aber keiner Lehrperson "
                       "zugeordnet. Es gibt daher keinen eigenen Stundenplan, der angezeigt "
                       "werden könnte.",
        })
    return resolved_site, store_for(resolved_site), ident, teacher_id


@router.get("")
def me(site: str | None = None, user: Principal = Depends(require_user)) -> dict[str, Any]:
    """Who the caller is, at which university, and what this surface will show them.

    Deliberately the first call a client makes: it is the only way to learn the site when somebody
    teaches at more than one, and it is where a 403 for an unmapped account surfaces once rather
    than on every panel.
    """
    resolved_site, store, ident, teacher_id = _subject(user, site)
    teacher = store.teacher_by_id.get(teacher_id) if hasattr(store, "teacher_by_id") else None
    return {
        "site": resolved_site,
        "siteLabel": getattr(store, "label", resolved_site),
        "teacherId": teacher_id,
        "displayName": (teacher or {}).get("name") or user.name or user.upn,
        "role": ident.get("role"),
        # ⚠️ REPORTED, NOT ENFORCED FROM THE CLIENT. A planner using the consumer app still only
        # sees their own week here; the flag exists so the UI can offer a link to the planner app,
        # not so the client can ask for more.
        "canPlan": ident.get("role") == "planner",
        "scope": "self",
        "$scopeComment": "Every endpoint on /api/me answers about this teacherId and no other. "
                         "The subject is taken from the bearer token, never from the request.",
    }


@router.get("/week")
def my_week(site: str | None = None, user: Principal = Depends(require_user)) -> dict[str, Any]:
    """The caller's own teaching week, in the same grid shape the planner UI already renders.

    ⚠️ NO `scope`, NO `key`, AND NO `draftId`, EACH FOR ITS OWN REASON. The first two are the row
    key and taking them from the client would be the hole this module was written to close. The
    third is subtler: a `draftId` names a planner's UNPUBLISHED working copy, and a lecturer
    reading one would be told about a change nobody has committed to. Consumers see the published
    plan, which is the one that is true.
    """
    resolved_site, store, _ident, teacher_id = _subject(user, site)
    rows = proposals.assignments_for(store, None)
    view = calendar_view(store, "teacher", teacher_id, assignments=rows, draft_id=None)
    if view.get("error"):
        # A subject that does not resolve is a data problem, not an authorisation one, and saying
        # so plainly beats an empty grid that looks like a free week.
        raise HTTPException(404, {
            "code": "own_timetable_not_found",
            "message": "Zu diesem Konto ist eine Lehrperson hinterlegt, die im aktuellen Plan "
                       "dieses Standorts nicht vorkommt.",
            "teacherId": teacher_id,
            "site": resolved_site,
        })
    return view


def _clamp(name: str, args: dict[str, Any], store: Any, teacher_id: str) -> dict[str, Any]:
    """Force a tool call onto the caller's own row, or refuse it.

    ⚠️ REFUSE, DO NOT SILENTLY SUBSTITUTE. The tempting version of this function rewrites whatever
    subject was asked for into the caller's own and returns the answer. It would never leak a row,
    and it would be worse: somebody asking "wann unterrichtet Professor Weber?" would receive a
    real, correct, precisely formatted timetable for THEMSELVES, with no indication that the
    question had been changed. Answering a different question with true-looking numbers is the
    exact failure this repository refuses elsewhere - `tools.py` asks about a near-miss teacher
    name rather than resolving it, for the same reason. An absent subject is filled in, because
    "when do I teach on Friday" genuinely means the caller. A DIFFERENT subject is an error.
    """
    out = dict(args)

    if name == "get_calendar":
        scope = (out.get("scope") or "teacher").strip()
        if scope != "teacher":
            raise _Refused(
                "scope_not_available",
                f"In dieser Ansicht ist nur der eigene Stundenplan sichtbar. Die Auswertung "
                f"'{scope}' steht der Planung zur Verfügung, nicht der Einzelansicht.")
        out["scope"] = "teacher"
        out["key"] = _same_person_or_refuse(out.get("key"), store, teacher_id)
        return out

    if name == "get_affected_sessions":
        out["teacher"] = _same_person_or_refuse(out.get("teacher"), store, teacher_id)
        return out

    raise _Refused("tool_not_available", f"'{name}' is not available on the consumer surface.")


def _same_person_or_refuse(asked: Any, store: Any, teacher_id: str) -> str:
    """Return the caller's own id, refusing if something else was named.

    ⚠️ COMPARE RESOLVED IDS, NOT STRINGS. A model will happily pass a display name, a Kürzel or an
    id, and all three can denote the caller. Comparing raw text would refuse "Professor Weber" for
    the actual Professor Weber, and the user would experience their own timetable as forbidden.
    """
    text = str(asked or "").strip()
    if not text:
        return teacher_id
    if text == teacher_id:
        return teacher_id

    resolved = None
    finder = getattr(store, "find_teacher", None)
    if callable(finder):
        try:
            resolved = finder(text)
        except Exception:  # noqa: BLE001 - a lookup failure is a refusal, not a 500
            resolved = None
    resolved_id = (resolved or {}).get("teacherId") if isinstance(resolved, dict) else None
    if resolved_id == teacher_id:
        return teacher_id

    raise _Refused(
        "other_person_not_visible",
        "In dieser Ansicht ist ausschließlich der eigene Stundenplan sichtbar. Fragen zu anderen "
        "Personen beantwortet das Planungsbüro.")


class _Refused(Exception):
    """A tool call that will not be run, expressed so the model can relay it to the user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _executor(store: Any, teacher_id: str) -> Callable[[str, dict[str, Any]], dict[str, Any]]:
    """The security boundary. Everything the assistant actually does passes through here."""

    def execute(name: str, args: dict[str, Any]) -> dict[str, Any]:
        fn = CONSUMER_TOOLS.get(name)
        if fn is None:
            # ⚠️ A REFUSAL IS AN ANSWER. Returned as data rather than raised, so the model reads it
            # and tells the user, instead of the stream dying and the user seeing a spinner stop.
            return {"error": "tool_not_available",
                    "name": name,
                    "message": "Diese Auswertung steht nur der Planung zur Verfügung."}
        try:
            safe = _clamp(name, args or {}, store, teacher_id)
        except _Refused as refusal:
            return {"error": refusal.code, "name": name, "message": refusal.message}
        try:
            return fn(store, **safe)
        except TypeError as exc:
            return {"error": "bad_arguments", "name": name, "message": str(exc)}
        except Exception as exc:  # noqa: BLE001 - a tool failure must not kill the stream
            return {"error": "tool_failed", "name": name, "message": str(exc)}

    return execute


@router.post("/assistant")
def assistant(
    body: AskRequest,
    user: Principal = Depends(require_user),
) -> StreamingResponse:
    """Ask about your own week. NDJSON, same event vocabulary as the planner chat.

    ⚠️ THE STREAM IS OPENED ONLY AFTER THE SUBJECT RESOLVES. Authorising inside the generator would
    turn a 403 into a 200 whose body happens to start with an error event, because the status line
    is sent when the response begins. A client checking `response.ok` would then treat a refusal as
    a successful answer.
    """
    resolved_site, store, _ident, teacher_id = _subject(user, body.site)

    # Imported here rather than at module scope: `foundry` reaches for Azure credentials as it
    # loads, and importing it eagerly would make the identity and week endpoints depend on the
    # chat being configured. A consumer with no assistant should still see their timetable.
    from foundry import FoundryClient, FoundryConfig

    client = FoundryClient(FoundryConfig.from_env())

    def events() -> Iterator[bytes]:
        for event in client.stream_with_tools(
            body.prompt, _executor(store, teacher_id), site=resolved_site
        ):
            yield json.dumps(event, ensure_ascii=False).encode("utf-8") + b"\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get("/health")
def health() -> dict[str, Any]:
    """Unauthenticated on purpose: a probe that needs a token cannot tell you the token is broken."""
    return {
        "ok": True,
        "surface": "consumer",
        "tools": sorted(CONSUMER_TOOLS),
        "authRequired": not os.getenv("ENTRA_AUTH_DISABLED", "").lower() in {"1", "true", "yes"},
    }


__all__ = ["router", "CONSUMER_TOOLS"]
