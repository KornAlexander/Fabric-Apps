"""The intake router: how a request from Copilot becomes a reviewable row (PLAN §41.8).

Mounted by `app.py` with `app.include_router(intake.router)`. Kept in its own module so the
Copilot-facing surface can be reasoned about, and tested, without reading 960 lines of `app.py`.

⚠️ EVERY ENDPOINT HERE REQUIRES A VERIFIED IDENTITY. Not the app key. §15.1 established on
2026-08-02 that `X-App-Key` is a speed bump compiled into a publicly served bundle, and §44.3
measured that Easy Auth was never actually configured. This module is where that stops being true
for the intake path.

The three rules that are not negotiable, each inherited from a failure this project already had:

  1. `preview` before `submit`, and the preview is a DURABLE row (§41.17.4). "The same
     conversation" is not verifiable on a container that scales to zero.
  2. `teacherId` comes from the token, never from the request body. Otherwise a professor submits
     unavailability for a colleague by asking nicely.
  3. Roles are enforced HERE, server side. The agent's role-aware instructions are a user
     experience affordance, not a permission boundary.
"""

from __future__ import annotations

import functools
import re
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

import intake_store
from auth import Principal, require_user
from schedule_store import known_sites, store_for
from tools import get_affected_sessions, propose_repairs

router = APIRouter(prefix="/api", tags=["intake"])

#: Which kinds may be submitted.
#:
#: ⚠️ ONLY `availability`. `room_issue` and `move_request` were listed here and were a lie:
#: `preview` can only build `forbid` entries of the shape `{teacher, day}` or `{teacher, slotId}`,
#: so a room complaint was either rejected for having no day, or answered with CP-SAT numbers for
#: blocking that teacher's Friday. The planning office would then receive a `kind: room_issue` row
#: whose payload described an availability change. Accepting a kind you cannot model is worse than
#: refusing it, because the refusal is visible and the wrong number is not. Found by review
#: 2026-08-21. Add each kind back WITH its constraint shape and its own test, not before.
ACCEPTED_KINDS = {"availability"}

#: The one sentence the agent is shown about `kind`, built from the set above so that removing or
#: adding a kind cannot leave the published contract describing the old list.
_KIND_DESCRIPTION = "Accepted: " + " | ".join(sorted(ACCEPTED_KINDS))

#: How many settled requests `listMyIntakeRequests` hands back.
#:
#: ⚠️ A LIMIT, NOT A DATE CUTOFF. A cutoff sounds friendlier and behaves worse: somebody who filed
#: nothing this term would get an empty history and conclude the system had forgotten them, while
#: somebody in a bad month could still receive dozens. A count is boring and predictable, and the
#: total is reported alongside so nobody has to guess whether the list was trimmed.
DECIDED_HISTORY_LIMIT = 10

#: Every machine-readable `code` this router can put in an error body, and what the agent should
#: DO about it.
#:
#: ⚠️ THIS EXISTS BECAUSE THE CODES WERE INVENTED AND THE AGENT WAS NEVER TOLD. Three of them were
#: added in one session to fix real defects, and the declarative agent's instructions still
#: described a world with none of them. `already_submitted` is the dangerous one: it means the
#: caller ALREADY SUCCEEDED, and a model reading it as a plain failure will apologise to a
#: professor whose request is sitting in the planner's queue, who will then file it again.
#:
#: `tools/agent/build_agent_package.py` renders this into the agent's instructions, and
#: `tools/tests/test_error_codes_documented.py` fails if the router can emit a code that is not
#: here, or if a code here never reaches the agent. A hand-kept list would drift the same way the
#: `kind` description did.
ERROR_CODES: dict[str, str] = {
    "already_submitted": (
        "Das Anliegen wurde bereits eingereicht, von derselben Person. Es ist NICHT "
        "fehlgeschlagen. Im Feld requestId steht das bestehende Anliegen. Sage der Person, dass "
        "es erfasst ist, und reiche es NICHT erneut ein."
    ),
    "preview_unusable": (
        "Die previewId ist unbekannt, abgelaufen, gehört jemand anderem oder wurde gegen einen "
        "älteren Plan gerechnet. Rufe previewAvailabilityChange erneut auf und nenne die neuen "
        "Zahlen, bevor du wieder einreichst."
    ),
    "store_unavailable": (
        "Die Datenbank ist momentan nicht erreichbar. Das Anliegen wurde NICHT abgelehnt, es ist "
        "gar nicht erst angekommen. Bitte die Person, es in ein paar Minuten erneut zu "
        "versuchen, und formuliere die Anfrage NICHT um."
    ),
    "unknown_day": (
        "Diesen Vorlesungstag gibt es an diesem Standort nicht. Im Feld knownDays stehen die "
        "möglichen Tage. Nenne sie und frage nach, statt einen Tag zu raten."
    ),
    "unknown_slot": (
        "Diese Zeitfenster gibt es an diesem Standort nicht. Nenne die betroffenen Ids aus "
        "unknownSlotIds und frage nach."
    ),
    "teacher_attribution_not_published": (
        "An diesem Standort ist nicht veröffentlicht, wer welche Veranstaltung hält. Die "
        "Auswirkung lässt sich deshalb NICHT berechnen. Sage das offen. Nenne KEINE Zahl und "
        "sage insbesondere nicht, die Änderung habe keine Auswirkung."
    ),
    "teacher_not_found": (
        "Diese Lehrperson ist am Standort nicht auffindbar. In didYouMean stehen ähnliche "
        "Namen. FRAGE NACH, welche gemeint ist. Wähle NIEMALS selbst eine aus: die Zahlen "
        "wären echt, aber über die falsche Person."
    ),
    "preview_unavailable": (
        "Die Auswirkung lässt sich aus einem anderen Grund nicht berechnen. Gib den Grund "
        "woertlich wieder und nenne KEINE Zahl."
    ),    "site_ambiguous": (
        "Diese Person ist an mehreren Standorten hinterlegt. In sites stehen die möglichen. "
        "FRAGE NACH, welcher gemeint ist, und gib ihn im Feld site mit. Wähle NIEMALS selbst "
        "einen aus: die Anfrage landete sonst bei der falschen Hochschule."
    ),}


# ------------------------------------------------------------------------------------------------
# Request models.
# ------------------------------------------------------------------------------------------------
# These exist for TWO reasons, and the second is the important one:
#   1. validation at the boundary,
#   2. they are the source of the OpenAPI document the Copilot agent is driven by. A hand written
#      spec drifts from the code silently, and the failure mode is an agent confidently sending a
#      field the server has not read since March.
#
# ⚠️ `teacherId` IS ABSENT FROM EVERY MODEL, ON PURPOSE. It is resolved from the token. Extra keys
# are ignored rather than rejected (Pydantic's default), because an agent that invents a stray
# field should get a working call, not a 422. It is already provably ignored: see
# `test_intake_auth.py::test_identity`.


class PreviewRequest(BaseModel):
    # ⚠️ OPTIONAL IN THE MODEL, REQUIRED IN THE HANDLER, and that is not sloppiness. Declaring
    # `kind: str` makes Pydantic answer a bad call with a 422 validation blob; leaving it optional
    # lets the handler answer with "unsupported kind 'x' - accepted: [...]". An agent can act on
    # the sentence. It cannot act on the blob.
    #
    # ⚠️ The description is DERIVED from `ACCEPTED_KINDS`, never written out by hand. It used to
    # read "availability | room_issue | move_request" and stayed that way after the other two kinds
    # were removed, so the published contract invited the agent to send a kind the handler answers
    # 400 to and the CHECK constraint would refuse anyway. A hand-copied list of a constant is a
    # second source of truth that nothing keeps honest.
    kind: str | None = Field(default=None, description=_KIND_DESCRIPTION, examples=["availability"])
    site: str | None = Field(default=None, description="Campus id. Defaults to the server's site.")
    day: str | None = Field(default=None, description="Whole weekday to block, e.g. 'Fr'.", examples=["Fr"])
    slotIds: list[str] | None = Field(
        default=None, description="Individual slots to block instead of a whole day.",
        examples=[["Fr-5", "Fr-6"]],
    )


class SubmitRequest(BaseModel):
    kind: str | None = Field(default=None, description=f"Must match the kind used for the preview. {_KIND_DESCRIPTION}", examples=["availability"])
    previewId: str | None = Field(default=None, description="REQUIRED. Obtained from /api/intake/preview.")
    site: str | None = None
    day: str | None = None
    slotIds: list[str] | None = None
    # ⚠️ NO `utterance` FIELD, DELIBERATELY. See the note above `_site`. Extra keys are ignored, so
    # an agent that sends one gets a working call and the text is discarded at the model boundary
    # rather than being cleaned up later by a regex that cannot see what it is missing.
    sourceChannel: str | None = Field(default="copilot", description="copilot | cockpit | api")
    correlationId: str | None = None


class DecideRequest(BaseModel):
    accept: bool = Field(description="true accepts the request, false rejects it.")
    site: str | None = None
    note: str | None = Field(default=None, description="Short note shown to the requester.")
    # ⚠️ NO `draftId` FROM THE CALLER. It was accepted and stored without checking that any such
    # draft existed, so a planner could mark a request "accepted, draft D123" pointing at nothing,
    # and the cockpit would later fail to open a draft the audit trail insists was created. When
    # accept actually creates a §24 draft, the SERVER will supply the id it just made.


# ------------------------------------------------------------------------------------------------
# §41.17.1 / §9.1 item 11 - free text is not accepted at all.
# ------------------------------------------------------------------------------------------------
# ⚠️ THERE WAS A `redact_reason()` HERE AND IT WAS NOT A PRIVACY BOUNDARY. It stripped German
# causal clauses (weil, wegen, aufgrund, da ich, krankheitsbedingt) from a free-text note, which
# sounds thorough and is not: it misses every sensitive sentence that contains no causal marker.
#
#     "Meine Tochter ist krank"        - third-party health data, no marker, stored verbatim
#     "Ich habe freitags Chemotherapie" - Art. 9 DSGVO data, no marker, stored verbatim
#     "Personalratssitzung"             - works-council activity, no marker, stored verbatim
#     "my child is sick"                - not German, so no marker exists to find
#
# A blocklist can only remove what somebody thought of. §9.1 item 11 states the actual position:
# *the reason is a liability we should be unable to store*. "Unable" is the operative word, so the
# field is gone, the column is gone, and there is no parameter to pass one through. A field that
# does not exist cannot be filtered incorrectly.
#
# ⚠️ THE TRADEOFF, STATED: §43's later typed-rule parsing wanted residual text for forensics. This
# chooses privacy over parse forensics. When §43 needs it, capture STRUCTURED fields with their own
# consent story, do not reopen this one.


def _site(site: str | None) -> str:
    """Resolve and validate the site, refusing an unknown one rather than defaulting.

    Same rule as `app._store()`: falling back would answer a question about one university with
    another university's timetable, and the caller could not tell.

    ⚠️ THE DEFAULT IS THE DEPLOYMENT'S OWN SITE, NOT `known_sites()[0]`. That looks equivalent and
    is not: `known_sites()` is alphabetical, so it returns "fau", while a container started with
    `SCHEDULER_SITE=oth` serves Regensburg. Found by the real-server test on 2026-08-21, where it
    presented as a 403 ("not mapped to a person at this site") rather than as a wrong site, because
    the professor genuinely has no identity row at Erlangen. Had they also taught at the site the
    fallback picked, this would instead have filed their request against the wrong university.
    """
    resolved = site or store_for(None).site
    if resolved not in known_sites():
        raise HTTPException(400, f"unknown site '{resolved}' - known: {', '.join(known_sites())}")
    return resolved


def _identity(user: Principal, site: str) -> dict[str, Any]:
    if not intake_store.intake_enabled():
        raise HTTPException(503, "the intake Warehouse is not configured")
    ident = intake_store.resolve_identity(user.oid, site)
    if not ident:
        # ⚠️ Unmapped is NOT "ordinary user". No mapping means no role, and no role means no.
        raise HTTPException(403, "this account is not mapped to a person at this site")
    return ident


def _where_and_who(user: Principal, requested: str | None) -> tuple[str, dict[str, Any]]:
    """Which university this call is about, and who the caller is there.

    ⚠️ AN EXPLICIT SITE IS HONOURED EXACTLY. Only an ABSENT one is inferred. Quietly redirecting a
    caller who named a site would be the `_site` fallback bug wearing a friendlier face: they
    would get a real answer about a university they did not ask about.

    ⚠️ INFERENCE EXISTS BECAUSE THE DEFAULT MADE EIGHT OF NINE UNIVERSITIES UNREACHABLE. With no
    site, `_site(None)` returns the container's own, so everybody else got "this account is not
    mapped to a person at this site" - true, and unactionable. The agent could not route around it
    either: it would need the site to call `getMyIdentity`, and `getMyIdentity` is where you learn
    the site.

    ⚠️ SEVERAL MATCHES ARE A QUESTION, NOT A CHOICE. Somebody really can teach at two campuses.
    Picking one would file an absence against the wrong university, and every number in the reply
    would be real, which is what makes it dangerous. Same rule `tools.py` applies to a near-miss
    teacher name.
    """
    if requested:
        s = _site(requested)
        return s, _identity(user, s)

    if not intake_store.intake_enabled():
        raise HTTPException(503, "the intake Warehouse is not configured")

    matches = [m for m in intake_store.identity_sites(user.oid) if m.get("site") in known_sites()]
    if not matches:
        raise HTTPException(403, "this account is not mapped to a person at any site here")

    if len(matches) > 1:
        # ⚠️ A RECORDED PREFERENCE BEATS A QUESTION, but only an unambiguous one. Exactly one
        # primary means the person has told us where they mostly are; two would mean the flag was
        # set carelessly, and picking either would be guessing while looking like a decision.
        primary = [m for m in matches if m.get("isPrimary")]
        if len(primary) == 1:
            matches = primary
        else:
            raise HTTPException(409, {
                "code": "site_ambiguous",
                "message": "Diese Person ist an mehreren Standorten hinterlegt und es ist kein "
                           "eindeutiger Hauptstandort gesetzt. Frage nach, welcher gemeint ist, "
                           "und gib ihn im Feld site mit.",
                "sites": [m["site"] for m in matches],
            })

    only = matches[0]
    return only["site"], {"teacherId": only["teacherId"], "role": only["role"],
                          "provenance": only.get("provenance")}


def _require_planner(ident: dict[str, Any]) -> None:
    if ident.get("role") != "planner":
        raise HTTPException(403, "planner role required")


def resolve_caller(user: Principal, requested: str | None) -> tuple[str, dict[str, Any]]:
    """Public name for `_where_and_who`, so other routers can share the decision.

    ⚠️ THIS EXISTS TO STOP A SECOND COPY OF AN AUTHORISATION RULE BEING WRITTEN. `consumer.py`
    needs exactly the answer this function gives: which university a call is about, and who the
    caller is there. Re-deriving that from `identity_sites()` would be a second implementation of
    deny-by-default, the single-primary tie-break and the 409 on a genuine ambiguity, and this
    repository has already paid for divergent second copies three times over: `store_contract.py`
    exists because hand-written fakes drifted from the real store, and every one of those drifts
    was invisible until something behaved differently in production than in a test.

    A private name imported across modules is a smell. Two implementations of "may this person see
    this" is a vulnerability. This is the cheaper of the two.
    """
    return _where_and_who(user, requested)


def _resolve_day(store: Any, day: str) -> str | None:
    """Turn what a person typed into the token this site uses, or None if it is not a day here.

    ⚠️ THE TARGETS COME FROM THE SITE'S OWN SLOTS. `oth-real` teaches on Saturday and the other
    eight do not, so a German weekday list written into this file would be wrong somewhere no
    matter what it contained. The aliases below are only the SPELLINGS; which of them exist is
    decided by the data.

    ⚠️ NARROW ON PURPOSE, AND NOT FUZZY. Full names, three-letter and two-letter forms, in any
    case. It will not correct a typo like "Freitg". `tools.py` is emphatic that a near-miss
    teacher name must be asked about rather than resolved, because answering returns real numbers
    about the wrong person; silently correcting something a user did not quite say is the same
    shape of mistake, and the only thing that makes it feel safer is that a weekday is cheaper
    than a professor. Exact-alias-or-refuse keeps the honest failure and removes only the case
    where the user was unambiguously right and merely verbose.
    """
    known = {s["day"] for s in getattr(store, "slots", []) or [] if s.get("day")}
    if day in known:
        return day

    #: spelling -> canonical two-letter token. Only ever consulted against `known`.
    aliases = {
        "montag": "Mo", "mon": "Mo", "mo": "Mo",
        "dienstag": "Di", "die": "Di", "di": "Di", "tue": "Di", "tues": "Di",
        "mittwoch": "Mi", "mit": "Mi", "mi": "Mi", "wed": "Mi",
        "donnerstag": "Do", "don": "Do", "do": "Do", "thu": "Do", "thur": "Do",
        "freitag": "Fr", "fre": "Fr", "fr": "Fr", "fri": "Fr",
        "samstag": "Sa", "sonnabend": "Sa", "sam": "Sa", "sa": "Sa", "sat": "Sa",
        "sonntag": "So", "son": "So", "so": "So", "sun": "So",
    }
    canonical = aliases.get(day.strip().lower().rstrip("."))
    # ⚠️ Only if the site really has that day. Recognising "Samstag" at a university that does not
    # teach on Saturdays would turn a clear refusal into a request nobody can ever apply.
    return canonical if canonical in known else None


def _validate_when(store: Any, site: str, day: str | None, slot_ids: list[str] | None) -> None:
    """Refuse a day or a slot that does not exist AT THIS SITE.

    ⚠️ AN UNRECOGNISED DAY USED TO BE PRICED, NOT REFUSED, AND THE NUMBER WAS THE WHOLE TIMETABLE.
    `get_affected_sessions` treats a day it cannot match as **no filter at all**, so asking FAU
    "what if I stop teaching on Saturday?" returned the teacher's entire 18-session load rather
    than 0. The agent then reports 18 affected sessions as the cost of the change: a large,
    alarming, completely fictitious number that came out of the real solver and therefore looks
    authoritative. A typo does the same thing, and "Freitag" instead of "Fr" is a thing a German
    speaker types every day.
    ⚠️ An unknown slotId fails the other way, matching nothing, so the change is priced at zero
    and reads as free. Reassuring and equally false.
    Measured 2026-08-22 across all nine sites.

    ⚠️ THE VALID DAYS COME FROM THE SITE'S OWN SLOTS, never from a weekday list in this file.
    `oth-real` teaches on **Saturday** and the other eight do not, so any hard-coded list is wrong
    at one site or the other. It also makes the refusal self-documenting: the caller is told what
    this university actually offers.

    Validated here rather than in `tools.py` because this is the layer that knows which site was
    asked about, and because a caller deserves the answer "that day does not exist here" instead
    of a number about a question nobody asked.
    """
    slots = getattr(store, "slots", []) or []
    if day:
        known_days = sorted({s["day"] for s in slots if s.get("day")})
        if day not in known_days:
            raise HTTPException(400, {
                "code": "unknown_day",
                "message": f"'{day}' ist kein Vorlesungstag an '{site}'. "
                           f"Mögliche Tage: {', '.join(known_days)}.",
                "site": site,
                "knownDays": known_days,
            })
    if slot_ids:
        known_slots = {s["slotId"] for s in slots if s.get("slotId")}
        unknown = [s for s in slot_ids if s not in known_slots]
        if unknown:
            raise HTTPException(400, {
                "code": "unknown_slot",
                "message": f"Diese Zeitfenster gibt es an '{site}' nicht: {', '.join(unknown)}.",
                "site": site,
                "unknownSlotIds": unknown,
            })


def _store_guard(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Turn "the database is unreachable" into a 503 the caller can act on.

    ⚠️ APPLIED AS A DECORATOR RATHER THAN AS AN APP-LEVEL EXCEPTION HANDLER, on purpose. A handler
    registered with `add_exception_handler` belongs to one app object. This router is mounted in
    `server/intake_app.py` today and is meant to be mounted in `server/app.py` later, and an
    exception handler does not travel with a router. Whoever mounts it would inherit the routes
    and silently lose the error translation, which is the kind of regression that only shows up
    the day the capacity is paused.

    ⚠️ It catches exactly one class. `StoreUnavailable` is raised only where the driver failed to
    connect, so a `KeyError` or a `TypeError` still becomes a 500 and still gets investigated.
    Turning every exception into "try again later" would hide real defects behind a message that
    invites the user to keep trying something that can never work.
    """
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except intake_store.StoreUnavailable as exc:
            raise HTTPException(503, {
                "code": "store_unavailable",
                "message": "The timetable database cannot be reached right now. Nothing was "
                           "changed and nothing was lost, because the request never got that "
                           "far. Tell the requester to try again in a few minutes rather than "
                           "rephrasing, and do not report this as a refusal.",
                "cause": str(exc),
            }) from None
    return wrapper


# ------------------------------------------------------------------------------------------------
# Endpoints.
# ------------------------------------------------------------------------------------------------


@router.get("/me", operation_id="getMyIdentity")
@_store_guard
def me(site: str | None = Query(default=None), user: Principal = Depends(require_user)) -> dict[str, Any]:
    """Who the caller is, as the backend sees them. Everything else depends on this."""
    s, ident = _where_and_who(user, site)
    return {
        "upn": user.upn, "name": user.name, "site": s,
        "teacherId": ident["teacherId"], "role": ident["role"],
        "identityProvenance": ident.get("provenance"),
    }


@router.post("/intake/preview", operation_id="previewAvailabilityChange")
@_store_guard
def preview(
    body: PreviewRequest,
    user: Principal = Depends(require_user),
) -> dict[str, Any]:
    """What would this change cost? Reads only, writes a durable preview row.

    ⚠️ THE NUMBERS COME FROM CP-SAT, NOT FROM A MODEL. That is the whole point of §41.3 step 2, and
    it is why the constraint is passed to `propose_repairs` as `forbid` **by this code** rather than
    by a sentence in a prompt.
    """
    payload = body.model_dump()
    s, ident = _where_and_who(user, payload.get("site"))
    store = store_for(s)

    kind = payload.get("kind")
    if kind not in ACCEPTED_KINDS:
        raise HTTPException(400, f"unsupported kind '{kind}' - accepted: {sorted(ACCEPTED_KINDS)}")

    # Rule 2: the subject is the caller, resolved server side.
    teacher = ident["teacherId"]
    day = payload.get("day")
    slot_ids = payload.get("slotIds") or None

    # ⚠️ RESOLVED BEFORE VALIDATION, and the result is reported back. "Freitag" is what a German
    # speaker types; refusing it was honest but it was still a dead end mid-sentence. What must
    # NOT happen is a silent correction, so `interpretedDay` goes into the response whenever the
    # server understood something other than the literal input, and the agent is told to say it.
    interpreted_day = None
    if day:
        canonical = _resolve_day(store, day)
        if canonical and canonical != day:
            interpreted_day = canonical
        if canonical:
            day = canonical

    # ⚠️ BEFORE the solver, not after. Once `get_affected_sessions` has silently widened an
    # unrecognised day into "no filter", every number downstream is about a different question.
    _validate_when(store, s, day, slot_ids)

    affected = get_affected_sessions(store, teacher=teacher, day=day, slot_ids=slot_ids)

    # ⚠️ THE SOLVER'S REFUSAL WAS BEING READ AS A ZERO. `get_affected_sessions` returns an
    # `error` key instead of `sessions` in two cases, and this handler only ever looked at
    # `sessions`, so a deliberate refusal became `affectedSessions: 0` and the agent reported
    # that the change costs nothing.
    #
    # It is not hypothetical and it is not rare: at `tum` the teacher attribution is invented, so
    # `tools.py` refuses EVERY request there on purpose, and every professor at that university
    # would have been told their absence has no effect. Measured 2026-08-22 while checking all
    # nine sites; the other eight answer normally, which is exactly why one site's silence went
    # unnoticed.
    #
    # ⚠️ `didYouMean` is passed through rather than resolved. `tools.py` is explicit that a near
    # miss is a question, not an answer: picking the closest name returns real numbers about the
    # wrong person, and nothing on screen would reveal it.
    error = affected.get("error")
    if error == "teacher_not_published":
        raise HTTPException(409, {
            "code": "teacher_attribution_not_published",
            "message": f"An '{s}' ist nicht veröffentlicht, wer welche Veranstaltung hält. "
                       "Die Auswirkung dieser Änderung lässt sich hier nicht berechnen.",
            "site": s,
        })
    if error == "teacher_not_found":
        raise HTTPException(409, {
            "code": "teacher_not_found",
            "message": f"'{affected.get('asked')}' ist an '{s}' nicht auffindbar.",
            "site": s,
            "didYouMean": affected.get("didYouMean") or [],
        })
    if error:
        # An error kind nobody has taught this handler about. Refusing is the only safe default:
        # the alternative is pricing it at zero, which is the bug above wearing a different name.
        raise HTTPException(409, {
            "code": "preview_unavailable",
            "message": f"Die Auswirkung lässt sich nicht berechnen ({error}).",
            "site": s,
        })
    session_ids = [s0["sessionId"] for s0 in affected.get("sessions", [])]

    # ⚠️ THE SHAPE OF `forbid` IS LOAD BEARING. `tools.py` documents it as
    # `[{'teacher': 'Hinterberger', 'day': 'Fr'}]` and refuses to no-op silently when it is empty,
    # precisely because on 2026-07-30 it was omitted and the model reported "keine konfliktfreie
    # Umplanung" about a question nobody had asked the solver.
    forbid: list[dict[str, Any]] = []
    if day:
        forbid.append({"teacher": teacher, "day": day})
    for sid in slot_ids or []:
        forbid.append({"teacher": teacher, "slotId": sid})
    if not forbid:
        raise HTTPException(400, "either day or slotIds must be given, or nothing is being asked")

    repair = propose_repairs(store, session_ids=session_ids, k=3, forbid=forbid) if session_ids else {}

    options = repair.get("options") or []
    best = options[0] if options else None
    result = {
        "affectedSessions": len(session_ids),
        "affectedCohorts": len({s0.get("cohortId") for s0 in affected.get("sessions", []) if s0.get("cohortId")}),
        "wouldMove": best.get("sessionsMoved") if best else None,
        "feasible": bool(options),
        "optimalityProven": repair.get("optimalityProven"),
        # ⚠️ Passed through verbatim when the solver refuses. §26.4: the action's own return value
        # is the only acceptable source for what the agent says next.
        "solverNote": repair.get("note") or repair.get("error"),
    }

    preview_id = intake_store.save_preview(
        site=s, requested_by=user.oid,
        constraints=forbid, result=result,
        plan_version=str(store.plan_version), rule_version=None,
    )
    out = {"previewId": preview_id, "planVersion": str(store.plan_version), **result}
    if interpreted_day:
        # ⚠️ Only when the server understood something OTHER than what was typed. Always sending
        # it would train the agent to ignore it, which is how a field meant to surface a
        # correction ends up hiding one.
        out["interpretedDay"] = interpreted_day
        out["interpretedFrom"] = payload.get("day")
    return out


@router.post("/intake/submit", operation_id="submitIntakeRequest")
@_store_guard
def submit(
    body: SubmitRequest,
    user: Principal = Depends(require_user),
) -> dict[str, Any]:
    """Record the request. Nothing binds: it lands as `pending` for the planning office."""
    payload = body.model_dump()
    s, ident = _where_and_who(user, payload.get("site"))
    store = store_for(s)

    kind = payload.get("kind")
    if kind not in ACCEPTED_KINDS:
        raise HTTPException(400, f"unsupported kind '{kind}'")

    preview_id = payload.get("previewId")
    if not preview_id:
        # Rule 1. A submit with no preview is a submit whose impact nobody saw.
        raise HTTPException(400, "previewId is required: run /api/intake/preview first")

    # ⚠️ ONE OPERATION, NOT TWO. Claiming the preview and writing the request used to be separate
    # calls with a commit between them, which meant ANY failure in the second one (a truncated
    # column, a dropped connection, a serialisation error) left the preview consumed and no request
    # written. The user sees "I confirmed it and it vanished", retries, and is told the preview is
    # already used. There was no state in which the request existed or the preview was still usable.
    #
    # ⚠️ OWNERSHIP IS THE `oid`, NOT THE UPN. A UPN is renameable; the whole reason `TeacherIdentity`
    # keys on `oid` is that a renamed professor must not become a different person. Binding the
    # preview to the UPN reintroduced exactly that bug one layer up: rename between preview and
    # submit and your own preview stops being yours.
    claimed = intake_store.claim_preview_and_insert(
        preview_id,
        owner_oid=user.oid,
        plan_version=str(store.plan_version),
        row_of=lambda snap: {
            "site": s, "kind": kind,
            "submittedByOid": user.oid,
            "submittedByUpn": user.upn, "submittedByName": user.name,
            "teacherId": ident["teacherId"], "role": ident["role"],
            "payload": {"constraints": snap["constraints"], "day": payload.get("day"),
                        "slotIds": payload.get("slotIds")},
            "previewId": preview_id,
            "sourceChannel": payload.get("sourceChannel", "copilot"),
            "correlationId": payload.get("correlationId"),
            "impactSessions": snap["result"].get("affectedSessions"),
            "impactMoves": snap["result"].get("wouldMove"),
            "impactFeasible": snap["result"].get("feasible"),
            "planVersion": snap["planVersion"], "ruleVersion": snap.get("ruleVersion"),
        },
    )
    if not claimed:
        # ⚠️ ONE OF THESE FIVE CAUSES MEANS "YOU ALREADY SUCCEEDED", so answering all five with the
        # same sentence makes an agent lie. A submit that times out on the wire is retried, the
        # retry hits an already-claimed preview, and a single opaque 409 tells the model the
        # request failed. It then apologises to the professor, who files the same absence again
        # through a fresh preview, and the planner gets it twice. The 409 was written to stop a
        # duplicate; kept opaque, it causes one.
        #
        # ⚠️ Looked up BY THE CALLER'S OWN oid. Without that predicate this endpoint turns a
        # preview id into somebody else's request id.
        existing = intake_store.request_for_preview(preview_id, owner_oid=user.oid)
        if existing:
            raise HTTPException(409, {
                "code": "already_submitted",
                "requestId": existing["requestId"],
                "status": existing.get("status"),
                "message": "This preview was already submitted, by you. Nothing new was filed "
                           f"and nothing was lost: request {existing['requestId']} is "
                           f"{existing.get('status')}. Tell the requester it is on record, do "
                           "not submit it again.",
            })
        # ⚠️ REFUSED, NOT RE-COSTED. §24's `stale_draft` rule one step earlier: a preview computed
        # against a plan that has since moved is not evidence about the plan now.
        raise HTTPException(409, {
            "code": "preview_unusable",
            "message": "preview is unknown, expired, not yours, or computed against an older "
                       "plan. Run the preview again and show the fresh numbers before submitting.",
        })
    request_id, snap = claimed
    return {
        "requestId": request_id, "status": "pending",
        "impact": snap["result"], "planVersion": snap["planVersion"],
    }


@router.get("/intake/mine", operation_id="listMyIntakeRequests")
@_store_guard
def mine(site: str | None = Query(default=None), user: Principal = Depends(require_user)) -> dict[str, Any]:
    s, _ = _where_and_who(user, site)
    # Matched on the immutable oid, for the same reason ownership is: a rename must not hide
    # somebody's own requests from them.
    #
    # ⚠️ `failed` IS INCLUDED, and leaving it out was a real defect rather than an omission. A
    # request whose availability write did not land is neither accepted nor rejected, so filtering
    # to `pending` made it VANISH FROM THE REQUESTER'S OWN LIST. From where the professor sits,
    # they told the university they cannot teach on Friday, watched the request appear, and then
    # watched it silently disappear having never been answered.
    rows = [r for status in ("pending", "failed")
            for r in intake_store.list_queue(s, status=status)
            if r.get("submittedByOid") == user.oid]

    # ⚠️ THE OUTCOME, NOT JUST THE WAIT. Until now this returned only what was in flight, so a
    # requester could watch a request leave and never learn what was decided about it. "Did they
    # accept my Friday?" is the question they actually have.
    #
    # ⚠️ BOUNDED BY COUNT. Somebody three years into using this should not be handed their whole
    # history every time the agent asks what they have filed, and an unbounded list is the kind of
    # slow leak that only ever shows up on the person who has used the system most.
    decided = [r for status in ("accepted", "rejected")
               for r in intake_store.list_queue(s, status=status)
               if r.get("submittedByOid") == user.oid]
    decided.sort(key=lambda r: r.get("createdAt") or "", reverse=True)

    return {"site": s, "requests": rows,
            "decided": decided[:DECIDED_HISTORY_LIMIT],
            "decidedShown": min(len(decided), DECIDED_HISTORY_LIMIT),
            "decidedTotal": len(decided)}


@router.get("/intake/queue", operation_id="listIntakeQueue")
@_store_guard
def queue(
    site: str | None = Query(default=None),
    status: str = Query(default="pending"),
    user: Principal = Depends(require_user),
) -> dict[str, Any]:
    s, ident = _where_and_who(user, site)
    _require_planner(ident)
    requests = intake_store.list_queue(s, status=status)
    # ⚠️ REPORTED WHATEVER THE FILTER IS, because the default filter is exactly the one that hides
    # this. `status` defaults to `pending`, so a planner opening the queue saw precisely the
    # requests that do NOT need them and none of the ones that do. Making `failed` recoverable was
    # worth nothing while nothing said a failed request existed: an empty pending queue looked
    # like a finished day, and a lecture still had a lecturer who had told them they cannot teach.
    failed = requests if status == "failed" else intake_store.list_queue(s, status="failed")
    return {
        "site": s, "status": status, "requests": requests,
        "needsAttention": {
            "count": len(failed),
            "requestIds": [r["requestId"] for r in failed],
            "what": "These were accepted but the availability write did not land, so nothing "
                    "changed in the timetable. Decide them again to retry; it is safe, because "
                    "applying the same absence twice converges rather than doubling up.",
        },
    }


@router.post("/intake/{request_id}/decide", operation_id="decideIntakeRequest")
@_store_guard
def decide(
    request_id: str = Path(...),
    body: DecideRequest = Body(...),
    user: Principal = Depends(require_user),
) -> dict[str, Any]:
    """Accept or reject. ⚠️ ACCEPT DOES NOT PUBLISH, per §26.5 and §41.9 (confirmed 2026-08-21).

    Accepting is a decision about an *input*. Publishing is a decision about the *plan*, it stays in
    the cockpit where the person doing it can see what they are changing.

    ⚠️ ACCEPTING DOES, HOWEVER, WRITE THE ABSENCE ITSELF, and that is not a contradiction. HEAD's
    own commit message puts it exactly: *"a stated absence changes the constraint, not only the
    plan"*. The availability table records what is TRUE about a lecturer's week; the timetable is
    what somebody decided to do about it. Writing the first is the whole point of accepting; writing
    the second would be publishing, and this route still cannot.
    """
    payload = body.model_dump()
    s, ident = _where_and_who(user, payload.get("site"))
    _require_planner(ident)

    accept = bool(payload.get("accept"))

    # Read the request BEFORE deciding: its payload is what has to be applied, and after `decide`
    # it is no longer `pending` and no longer in this queue.
    #
    # ⚠️ `failed` IS SEARCHED TOO, and forgetting that is a worse bug than the one being fixed. If
    # the row is not found here, `decide` below still succeeds and the `if accept and row` block is
    # skipped, so a retry would mark the request accepted while applying NOTHING. That is the exact
    # green-tick-over-an-unchanged-week outcome the failure path exists to prevent, arrived at from
    # the opposite direction.
    open_rows = {r["requestId"]: r for r in intake_store.list_queue(s, status="pending")}
    for r in intake_store.list_queue(s, status="failed"):
        open_rows.setdefault(r["requestId"], r)
    row = open_rows.get(request_id)

    ok = intake_store.decide(
        request_id,
        decided_by_upn=user.upn, decided_by_role=ident["role"],
        accept=accept, note=payload.get("note"),
    )
    if not ok:
        # Someone else decided it first. Say so rather than overwriting them.
        raise HTTPException(409, "this request is no longer pending")

    applied: dict[str, int] | None = None
    if accept and row:
        # ⚠️ AFTER winning the race, never before. A caller who applied first and then LOST would
        # have changed a lecturer's availability for a request somebody else rejected.
        constraints = (row.get("payload") or {}).get("constraints") or []
        slot_ids = [c["slotId"] for c in constraints if c.get("slotId")]
        days = [c["day"] for c in constraints if c.get("day")]
        if days and not slot_ids:
            # A whole-day block names a day, not slots. ⚠️ EXPANDED FROM THE STORE'S OWN `day`
            # FIELD, never by splitting the slot id. An earlier version did `slotId.split("-")[0]`,
            # which happens to work for "Mo-1" and is a guess about a naming scheme this router has
            # no business knowing. `store.slots` carries `{"slotId": "Mo-1", "day": "Mo", ...}`.
            store = store_for(s)
            wanted = set(days)
            slot_ids = [sl["slotId"] for sl in getattr(store, "slots", [])
                        if sl.get("day") in wanted]
        try:
            if not slot_ids:
                raise ValueError("die Anfrage nennt keine Zeitfenster")
            applied = intake_store.apply_accepted_availability(
                site=s, teacher_id=row["teacherId"], slot_ids=slot_ids,
                state="nicht_verfuegbar", updated_by=user.upn,
            )
            intake_store.record_application(
                request_id, applied_rows=applied["inserted"] + applied["updated"],
                failure_reason=None, actor_upn=user.upn, actor_role=ident["role"],
            )
        except Exception as exc:  # noqa: BLE001 - recorded, never swallowed
            # ⚠️ THE REQUEST BECOMES `failed`, NOT `accepted`. §13.7: a UI that reports success for
            # a write that did not land is worse than one that refuses. The planner sees that their
            # acceptance did not take effect, instead of a green tick over an unchanged week.
            intake_store.record_application(
                request_id, applied_rows=0, failure_reason=str(exc)[:900],
                actor_upn=user.upn, actor_role=ident["role"],
            )
            raise HTTPException(500, f"angenommen, aber nicht angewendet: {exc}") from None

    return {
        "requestId": request_id,
        "status": "accepted" if accept else "rejected",
        "published": False,
        "applied": applied,
    }


__all__ = ["router", "ACCEPTED_KINDS"]
