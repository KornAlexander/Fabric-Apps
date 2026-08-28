"""The scheduling tools the Foundry agent calls.

PLAN §4: the agent decides *what* to ask, the solver decides *whether* it is possible. Every
function here is deterministic and callable without an LLM — the chat is a way in, not the
mechanism. That separation is what makes the answers defensible: a planner can run
`detect_conflicts` from a button and get exactly what the agent got.

Four tools, matching the plan:
  get_affected_sessions   who is hit if a teacher loses a slot
  detect_conflicts        what is broken in a draft, independent of how it got that way
  propose_repairs         CP-SAT: up to k conflict-free repairs, ranked by disruption
  explain_infeasibility   why a specific move cannot work, in one sentence
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from schedule_store import ScheduleStore
import rules

# The break between consecutive blocks. Anything longer than this and the attendees cannot make it.
#
# ⚠️ **NOW A DEFAULT, NOT THE ANSWER.** The live value comes from `rules.break_min()` so the
# Regelwerk page can change it (PLAN §39 row 1). This constant remains because it is the shipped
# default and several tests pin it; read it through the accessor below, never directly.
BREAK_MIN = 15


def _break_min() -> int:
    """The transfer break the planner has actually configured.

    ⚠️ Read PER CALL, not captured at import. The rules are editable at runtime, and a module-level
    snapshot would mean a change only took effect after a container restart — which looks exactly
    like the setting not working. Same reasoning as `prefersReducedMotion` being queried each frame.
    """
    return rules.break_min()


def _travel_minutes(store: ScheduleStore, b1: str | None, b2: str | None) -> int:
    """Minutes between two buildings, in whichever direction the table happens to record.

    ⚠️ BOTH DIRECTIONS. `travel_min` is keyed `(from, to)` and is not guaranteed symmetric in the
    data; reading only one order silently returns 0 — "no distance at all" — for a pair that is
    recorded the other way round, which is the same as not checking.
    """
    if not b1 or not b2 or b1 == b2:
        return 0
    return max(store.travel_min.get((b1, b2), 0), store.travel_min.get((b2, b1), 0))


# ──────────────────────────────────────────────────────────────────────────────────────
# 1. Who is affected
# ──────────────────────────────────────────────────────────────────────────────────────
def _find_room(store: ScheduleStore, needle: str) -> dict | None:
    """Turn what a planner typed into a room, or nothing.

    Exact id first, then a case-insensitive exact match, then a unique substring. ⚠️ AMBIGUITY
    RETURNS NOTHING rather than the first hit: "5510" matches a whole building's worth of rooms at
    Garching, and closing the wrong lecture hall would produce real moves for a room that is fine.
    """
    key = (needle or "").strip()
    if not key:
        return None
    exact = store.room_by_id.get(key)
    if exact:
        return exact
    low = key.lower()
    hits = [r for r in store.rooms if r["roomId"].lower() == low]
    if not hits:
        hits = [r for r in store.rooms if low in r["roomId"].lower()]
    return hits[0] if len(hits) == 1 else None


def get_affected_sessions(store: ScheduleStore, teacher: str | None = None, day: str | None = None,
                          slot_ids: list[str] | None = None,
                          room: str | None = None) -> dict[str, Any]:
    """Everything that has to move if this teacher becomes unavailable, or this room closes.

    This is the question the whole product exists for: the planner knows a professor dropped
    Friday and needs to know, before doing anything, how big the hole is.

    ⚠️ A ROOM IS THE SECOND DOOR INTO THE SAME QUESTION, and it is the only one open where the
    lecturer attribution is invented (Garching). A room closing is not a workaround for the
    refusal, it is an ordinary planning event in its own right: renovation, water damage, broken
    projector, a room let to somebody else. It needs NO person, and it uses only data that is real
    wherever the room inventory was surveyed. See docs/plan-umplanen-ohne-lehrperson.md.
    """
    if room:
        return _affected_by_room(store, room, day, slot_ids)

    t = store.find_teacher(teacher or "")
    if store.teacher_attribution_invented:
        # ⚠️ The cascade is the app's headline demo, and on a dataset whose teaching is real but
        # whose lecturers are not it would answer with a fabricated professor's real timetable.
        # Refusing here rather than in the prompt means the agent cannot route around it.
        return {"error": "teacher_not_published", "asked": teacher}
    if not t:
        # ⚠️ A NEAR MISS IS A QUESTION, NOT AN ANSWER. "Achleitner" typed as "Ahleitner" used to end
        # the conversation, which is a poor reply when exactly one lecturer is one letter away.
        # The candidates are offered so the agent can ASK — never auto-resolved, because answering
        # about the nearest professor would return real numbers about the wrong person, and nothing
        # on screen would reveal it.
        return {"error": "teacher_not_found", "asked": teacher,
                "didYouMean": store.suggest_teachers(teacher)}

    targets = set(slot_ids or [])
    if day:
        targets |= set(store.slots_of_day(day))
    if not targets:
        targets = {s["slotId"] for s in store.slots}

    hit = []
    for sess in store.sessions_of_teacher(t["teacherId"]):
        a = store.assignment_by_session.get(sess["sessionId"])
        if not a or a["slotId"] not in targets:
            continue
        room = store.room_by_id.get(a["roomId"], {})
        course = store.course_by_id.get(sess["courseId"], {})
        hit.append({
            "sessionId": sess["sessionId"],
            "course": course.get("title", sess["courseId"]),
            "cohortId": sess["cohortId"],
            "attendees": sess["expectedAttendance"],
            "slotId": a["slotId"],
            "roomId": a["roomId"],
            "buildingId": room.get("buildingId"),
            "campusId": room.get("campusId"),
            "requiredRoomType": sess["requiredRoomType"],
        })

    cohorts = sorted({h["cohortId"] for h in hit})
    # ⚠️ A REAL EXPORT DOES NOT CARRY HEAD COUNTS, AND THE SUM MUST NOT PRETEND OTHERWISE.
    # Untis publishes classes, not their sizes (PLAN §25.5), so `expectedAttendance` is None on
    # every session of the real OTH dataset. Summing that crashed; summing it as zero would have
    # been worse — "0 Studierende betroffen" is a sentence a planner would act on. The count is
    # reported only when every affected session knows its own, and the caller is told which.
    known = [h["attendees"] for h in hit if h["attendees"] is not None]
    students = sum(known) if len(known) == len(hit) and hit else None
    return {
        "teacher": {"id": t["teacherId"], "name": t.get("name"), "facultyId": t.get("facultyId")},
        "slotsConsidered": sorted(targets),
        "affectedCount": len(hit),
        "students": students,
        "studentsKnown": len(known) == len(hit) and bool(hit),
        "cohorts": cohorts,
        "sessions": sorted(hit, key=lambda h: h["slotId"]),
    }


def _affected_by_room(store: ScheduleStore, room: str, day: str | None,
                      slot_ids: list[str] | None) -> dict[str, Any]:
    """Everything booked into this room in the given window.

    Deliberately says nothing about lecturers: a room closure is answerable without naming a
    person, which is exactly why this door stays open where the teacher door is shut.
    """
    r = _find_room(store, room)
    if not r:
        # ⚠️ Same shape of answer as an unknown teacher: a near miss is a QUESTION, not a result.
        # Guessing at "5510" would silently close one of a building's 395 rooms.
        near = [x["roomId"] for x in store.rooms
                if (room or "").strip().lower() in x["roomId"].lower()][:8]
        return {"error": "room_not_found", "asked": room, "didYouMean": near}

    targets = set(slot_ids or [])
    if day:
        targets |= set(store.slots_of_day(day))
    if not targets:
        targets = {s["slotId"] for s in store.slots}

    hit = []
    for a in store.assignments:
        if a["roomId"] != r["roomId"] or a["slotId"] not in targets:
            continue
        sess = store.session_by_id.get(a["sessionId"])
        if not sess:
            continue
        course = store.course_by_id.get(sess["courseId"], {})
        hit.append({
            "sessionId": sess["sessionId"],
            "course": course.get("title", sess["courseId"]),
            "cohortId": sess["cohortId"],
            "attendees": sess["expectedAttendance"],
            "slotId": a["slotId"],
            "roomId": a["roomId"],
            "buildingId": r.get("buildingId"),
            "campusId": r.get("campusId"),
            "requiredRoomType": sess["requiredRoomType"],
        })

    known = [h["attendees"] for h in hit if h["attendees"] is not None]
    return {
        "room": {"id": r["roomId"], "buildingId": r.get("buildingId"),
                 "capacity": r.get("capacity"), "roomType": r.get("roomType")},
        "slotsConsidered": sorted(targets),
        "affectedCount": len(hit),
        "students": sum(known) if len(known) == len(hit) and hit else None,
        "studentsKnown": len(known) == len(hit) and bool(hit),
        "cohorts": sorted({h["cohortId"] for h in hit}),
        "sessions": sorted(hit, key=lambda h: h["slotId"]),
    }


# ──────────────────────────────────────────────────────────────────────────────────────
# 2. What is broken
# ──────────────────────────────────────────────────────────────────────────────────────
def detect_conflicts(store: ScheduleStore, moves: list[dict] | None = None,
                     unavailable: list[dict] | None = None) -> dict[str, Any]:
    """Check the published plan, optionally with hypothetical changes applied.

    `moves` are {sessionId, slotId, roomId} overrides; `unavailable` are {teacher, slotId} pairs
    to treat as blocked. Nothing is written — a what-if must never mutate the plan it is asking
    about.
    """
    # ⚠️ REFUSING IN `get_affected_sessions` ALONE LEFT THE DOOR WIDE OPEN, and its own comment
    # claimed "the agent cannot route around it". It can: `unavailable=[{"teacher": "Meier",
    # "day": "Fr"}]` asks the identical question here, and this tool would resolve that name
    # against an invented attribution and report which REAL lectures break. Same fabrication,
    # different way in. A refusal is only a refusal once every route to the answer is closed.
    named = [u.get("teacher") for u in (unavailable or [])
             if isinstance(u, dict) and u.get("teacher")]
    if named and store.teacher_attribution_invented:
        return {"error": "teacher_not_published", "asked": named[0]}

    placement = {a["sessionId"]: (a["slotId"], a["roomId"]) for a in store.assignments}
    for m in moves or []:
        sid = m.get("sessionId")
        if sid in placement:
            slot, room = placement[sid]
            placement[sid] = (m.get("slotId") or slot, m.get("roomId") or room)

    blocked: set[tuple[str, str]] = set(store.unavailable)
    for u in unavailable or []:
        t = store.find_teacher(u.get("teacher", ""))
        if t and u.get("slotId"):
            blocked.add((t["teacherId"], u["slotId"]))
        elif t and u.get("day"):
            for s in store.slots_of_day(u["day"]):
                blocked.add((t["teacherId"], s))

    conflicts: list[dict] = []
    undecidable: list[dict] = []
    # `room` counts sessions the export gives no room for at all — 266 of OTH's 3 015. Their
    # teacher and cohort checks still run; only the room-shaped ones cannot.
    unchecked: dict[str, int] = {"capacity": 0, "roomType": 0, "room": 0}
    room_slot: dict[tuple[str, str], str] = {}
    teacher_slot: dict[tuple[str, str], str] = {}
    attendee_slot: dict[tuple[str, str], str] = {}
    # cohort -> day -> [(block, buildingId)] for the campus-transition check
    cohort_day: dict[tuple[str, str], list[tuple[int, str, str]]] = defaultdict(list)
    # ⚠️ AND THE SAME FOR LECTURERS, WHICH WAS MISSING ENTIRELY. A cohort could not be sent across
    # 2.5 km in a 15-minute break and a professor could — the same journey, unflagged, because only
    # the cohort side was ever built. A lecturer is arguably the WORSE case: a cohort's day is
    # planned as one block for one group, while a lecturer can be given two different cohorts back
    # to back in two different buildings, and nothing here noticed.
    teacher_day: dict[tuple[str, str], list[tuple[int, str, str]]] = defaultdict(list)

    def share_a_week(a_id: str, b_id: str) -> bool:
        """Can these two sessions be shown to run in the same week?

        ⚠️ THIS IS WHAT STOPS THE PRODUCT ACCUSING A REAL UNIVERSITY OF ~2 400 FAULTS IT DOES NOT
        HAVE. A Untis GPU002 export is a WEEKLY GRID: it says "Tuesday, 2nd period" and never says
        which weeks. Two lessons can sit in one room at one hour all semester and never meet,
        because one runs in the first half and the other fortnightly. Measured on the university's own export:
        of 70 room collisions in the faculty where we HAVE the week data, exactly ONE has every
        participant running weekly.

        So a collision is a conflict only when both sides are provably weekly. Anything else is
        UNDECIDABLE — reported as such, never as a fault and never silently dropped. The fix is a
        date-resolved export from the customer, not a cleverer comparison here.
        """
        a = store.session_by_id.get(a_id) or {}
        b = store.session_by_id.get(b_id) or {}
        # A generated dataset carries no week pattern at all and IS weekly by construction, so a
        # missing field must keep meaning "weekly" — otherwise this quietly disables the conflict
        # detector on the three universities that have been working all along.
        return (a.get("weekPattern", "weekly") == "weekly"
                and b.get("weekPattern", "weekly") == "weekly")

    def clash(kind: str, first: str, second: str, **fields: Any) -> None:
        if share_a_week(first, second):
            conflicts.append({"type": kind, "severity": "hard", "sessions": [first, second], **fields})
        else:
            undecidable.append({"type": kind, "severity": "undecidable",
                                "sessions": [first, second],
                                "why": "the export does not say which weeks these run in",
                                **fields})

    for sid, (slot_id, room_id) in placement.items():
        sess = store.session_by_id.get(sid)
        room = store.room_by_id.get(room_id)
        slot = store.slot_by_id.get(slot_id)
        # ⚠️ A MISSING ROOM MUST NOT EXEMPT A SESSION FROM THE CHECKS THAT DO NOT NEED ONE.
        #
        # This used to be `if not sess or not room or not slot: continue`, which sounds defensive
        # and is the opposite. the university's export leaves `roomId` empty for 266 of 3 015 sessions — a
        # lecture with no room booked yet is an ordinary state — and every one of them was dropped
        # before ANY check ran. Teacher availability, teacher double-booking and cohort
        # double-booking need a session and a slot; none of them needs a room. So 266 sessions were
        # silently exempt, and `detect_conflicts` reported 37 teacher-unavailable findings where
        # counting by hand gives 41. Under-reporting conflicts is the dangerous direction: it says
        # "clean" about something never looked at.
        #
        # This is the failure the comment below already names — "a check that cannot be performed
        # is not a check that passed" — committed three lines above the sentence describing it.
        if not sess or not slot:
            continue

        if room is not None:
            if (room_id, slot_id) in room_slot:
                clash("room_double_booked", room_slot[(room_id, slot_id)], sid,
                      slotId=slot_id, roomId=room_id)
            room_slot[(room_id, slot_id)] = sid
        else:
            unchecked["room"] += 1

        key = (sess["teacherId"], slot_id)
        if key in teacher_slot:
            clash("teacher_double_booked", teacher_slot[key], sid,
                  slotId=slot_id, teacherId=sess["teacherId"])
        teacher_slot[key] = sid

        akey = (sess["attendeeId"], slot_id)
        if akey in attendee_slot:
            clash("cohort_double_booked", attendee_slot[akey], sid,
                  slotId=slot_id, attendeeId=sess["attendeeId"])
        attendee_slot[akey] = sid

        # ⚠️ A CHECK THAT CANNOT BE PERFORMED IS NOT A CHECK THAT PASSED. Untis publishes neither
        # room capacity nor room type nor class size (PLAN §25.5), so on the real OTH dataset both
        # of these are comparisons between two unknowns. Treating that as "fits" would report a
        # clean plan we never actually examined — the same shape as the vacuous `propose_repairs`
        # check in §20, which passed 6 of 6 candidates by omitting the constraint. They are counted
        # as UNCHECKED and the count is returned, so the caller can say so instead of implying it.
        if room is None or room["capacity"] is None or sess["expectedAttendance"] is None:
            unchecked["capacity"] += 1
        elif room["capacity"] < sess["expectedAttendance"]:
            conflicts.append({"type": "over_capacity", "severity": "hard", "sessionId": sid,
                              "roomId": room_id, "capacity": room["capacity"],
                              "attendees": sess["expectedAttendance"]})

        if room is None or room["roomType"] is None or sess["requiredRoomType"] is None:
            unchecked["roomType"] += 1
        elif room["roomType"] != sess["requiredRoomType"]:
            conflicts.append({"type": "wrong_room_type", "severity": "hard", "sessionId": sid,
                              "roomId": room_id, "is": room["roomType"],
                              "needs": sess["requiredRoomType"]})

        if (sess["teacherId"], slot_id) in blocked:
            conflicts.append({"type": "teacher_unavailable", "severity": "hard", "sessionId": sid,
                              "teacherId": sess["teacherId"], "slotId": slot_id})

        cohort_day[(sess["cohortId"], slot["day"])].append(
            (slot["block"], room["buildingId"] if room else None, sid,
             sess.get("attendeeId") or sess["cohortId"], bool(sess.get("isWholeCohort")))
        )
        teacher_day[(sess["teacherId"], slot["day"])].append(
            (slot["block"], room["buildingId"] if room else None, sid, sess["teacherId"], True)
        )

    # Campus transitions: nobody crosses 2.5 km in a 15-minute break — student or professor.
    for kind, key_name, source in (
        ("cohort", "cohortId", cohort_day),
        ("teacher", "teacherId", teacher_day),
    ):
        for (owner_id, day), entries in source.items():
            # ⚠️ SORT BY THE BLOCK ONLY. The tuple's second element is a buildingId, which is None
            # for a real Untis room this project cannot place (Prüfening carries no OSM building
            # letter, §25.4), and a plain `.sort()` compares None with a string and dies. The block
            # is the ordering that matters; the building is payload.
            entries.sort(key=lambda e: (e[0], e[1] or ""))
            for (b1, bld1, s1, at1, w1), (b2, bld2, s2, at2, w2) in zip(entries, entries[1:]):
                # ⚠️ An unplaced room cannot be judged for travel: we do not know where it is, and
                # guessing "same building" would silently permit a transfer nobody checked.
                if b2 != b1 + 1 or bld1 == bld2 or bld1 is None or bld2 is None:
                    continue
                # ⚠️ TWO DIFFERENT GROUPS SHARE NO PROVABLE STUDENT. `…-C5-G2` and `…-C6-G1` are
                # groups of two different courses; this dataset has group SIZES but no membership,
                # so nobody can say whether one student sits in both. Calling that a HARD conflict
                # would enforce something we cannot show is real — the fabrication the plan-quality
                # lens nearly shipped as "147 impossible transfers". The subset relation (a whole
                # cohort contains each of its groups) is the only one the data supports.
                if kind == "cohort" and at1 != at2 and not (w1 or w2):
                    continue
                minutes = _travel_minutes(store, bld1, bld2)
                # ⚠️ `>=`, NOT `>`. A crossing that exactly consumes the break puts somebody on the
                # far campus as the next lecture starts, with no time to leave one room or enter
                # the other — and the cross-campus figure is already a BUS including its wait.
                if minutes >= _break_min():
                    conflicts.append({
                        "type": "campus_transition", "severity": "hard", "ownerKind": kind,
                        key_name: owner_id,
                        "day": day, "fromBuilding": bld1, "toBuilding": bld2,
                        "travelMinutes": minutes, "breakMinutes": _break_min(), "sessions": [s1, s2],
                    })

    hard = [c for c in conflicts if c["severity"] == "hard"]
    by_type: dict[str, int] = defaultdict(int)
    for c in conflicts:
        by_type[c["type"]] += 1
    return {
        "checked": len(placement),
        "conflicts": len(conflicts),
        "hard": len(hard),
        "byType": dict(by_type),
        # ⚠️ Reported so "0 conflicts" can never be read as "everything was examined". On a
        # dataset that publishes no capacities these are non-zero, and the difference between
        # "no clash" and "we could not look" is exactly what the customer needs to hear.
        "unchecked": {k: v for k, v in unchecked.items() if v},
        # ⚠️ Collisions the export cannot resolve into a week. Neither a fault nor a clean bill —
        # the honest third answer, and the number that turns "your plan is broken" into "send us a
        # date-resolved export and we can tell you".
        "undecidable": len(undecidable),
        "undecidableByType": dict(Counter(u["type"] for u in undecidable)),
        "undecidableDetail": undecidable[:20],
        "detail": conflicts[:60],
    }


# ──────────────────────────────────────────────────────────────────────────────────────
# 3. Repair — the solver
# ──────────────────────────────────────────────────────────────────────────────────────
def propose_repairs(store: ScheduleStore, session_ids: list[str], k: int = 3,
                    forbid: list[dict] | None = None, time_limit_s: float = 5.0) -> dict[str, Any]:
    """Re-place the given sessions, disturbing as little else as possible.

    ⚠️ REPAIR IS THE PRODUCT, not generation. The objective is 'minimise change': every session
    that can stay where it is, stays. That is what makes a cascade small enough for a human to
    accept in one sitting, and it is the difference between a tool a planner uses and one they
    fight.

    CP-SAT is an ANYTIME solver: within `time_limit_s` it returns the best solution it has, and
    the response says whether optimality was actually proven rather than implying it.
    """
    # ⚠️ THE THIRD DOOR. A teacher-scoped `forbid` is the cascade question wearing different
    # clothes: on a real timetable with invented staff it would move REAL lectures to accommodate
    # a professor who does not exist, and report the moves as fact.
    #
    # Only a NAMED PERSON is refused. The solver still uses the attribution structurally — keeping
    # one invented lecturer out of two rooms at once — because that only keeps the plan
    # self-consistent, is already badged as invented, and removing it would let repairs produce a
    # plan more broken than the one they started from. Room-scoped repairs are the whole point of
    # unfreezing this site and must keep working.
    named = [f.get("teacher") for f in (forbid or [])
             if isinstance(f, dict) and f.get("teacher")]
    if named and store.teacher_attribution_invented:
        return {"error": "teacher_not_published", "asked": named[0]}

    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return {
            "error": "solver_unavailable",
            "message": "ortools is not installed in this environment (pip install ortools)",
        }

    targets = [sid for sid in session_ids if sid in store.session_by_id]
    if not targets:
        return {"error": "no_such_sessions", "asked": session_ids}

    blocked: set[tuple[str, str]] = set(store.unavailable)

    # ⚠️ A ROOM CLOSURE IS THE SAME SHAPE OF CONSTRAINT AS AN ABSENCE: a forbidden pair of
    # (resource, slot). The model already enumerates candidates as (session, room, slot), so
    # ruling a room out for a day costs one more membership test and no new variables.
    blocked_rooms: set[tuple[str, str]] = set()

    # ⚠️ BE GENEROUS ABOUT THE SHAPE OF `forbid`. The schema documents a list of objects, and the
    # model mostly sends them — but not always: a plain `["Fr"]` used to reach `f.get(...)` and
    # raise AttributeError, which `_run_tool` turned into a tool error, which cost the ENTIRE
    # answer. The agent then correctly refused to invent one and said the planning tools had
    # failed, so the headline cascade demo simply did not work on that run.
    #
    # A bare string has no teacher attached, so it is read as "block this day or slot for whoever
    # owns the sessions being repaired" — which is the only thing it can sensibly mean here, and is
    # what the caller meant every time this was observed.
    owners = {
        store.session_by_id[sid]["teacherId"]
        for sid in targets
        if sid in store.session_by_id
    }

    def _block(teacher_id: str, *, day: str | None = None, slot_id: str | None = None) -> None:
        if slot_id:
            blocked.add((teacher_id, slot_id))
        for s in store.slots_of_day(day) if day else []:
            blocked.add((teacher_id, s))

    for f in forbid or []:
        if isinstance(f, str):
            token = f.strip()
            if not token:
                continue
            # "Fr" is a day, "Fr-2" is one slot. Both are things a planner says out loud.
            is_slot = token in store.slot_by_id
            for teacher_id in owners:
                _block(teacher_id, day=None if is_slot else token, slot_id=token if is_slot else None)
            continue

        if not isinstance(f, dict):
            continue

        # A room, not a person. Checked BEFORE the teacher branch, because a `{room, day}` forbid
        # carries no teacher and would otherwise fall into the "no teacher named" case below and
        # be applied to the wrong resource entirely: it would block the LECTURERS of the affected
        # sessions on that day, so the solver would refuse to move their teaching anywhere on
        # Friday instead of merely out of the closed room.
        if f.get("room"):
            r = _find_room(store, f["room"])
            if r:
                if f.get("slotId"):
                    shut = [f["slotId"]]
                elif f.get("day"):
                    shut = store.slots_of_day(f["day"])
                else:
                    shut = [s["slotId"] for s in store.slots]
                for slot_id in shut:
                    blocked_rooms.add((r["roomId"], slot_id))
            continue

        t = store.find_teacher(f.get("teacher", ""))
        if not t:
            # No teacher named, but a day or slot given: apply it to the sessions' own owners
            # rather than dropping the constraint silently. A forbid that is quietly ignored is
            # how "0 verschoben" once became "there is no conflict-free plan".
            if f.get("day") or f.get("slotId"):
                for teacher_id in owners:
                    _block(teacher_id, day=f.get("day"), slot_id=f.get("slotId"))
            continue
        _block(t["teacherId"], day=f.get("day"), slot_id=f.get("slotId"))

    # What the rest of the plan already occupies. The sessions being repaired are lifted out.
    lifted = set(targets)
    room_slot, teacher_slot, attendee_slot = set(), set(), set()
    for a in store.assignments:
        if a["sessionId"] in lifted:
            continue
        sess = store.session_by_id.get(a["sessionId"])
        if not sess:
            continue
        room_slot.add((a["roomId"], a["slotId"]))
        teacher_slot.add((sess["teacherId"], a["slotId"]))
        attendee_slot.add((sess["attendeeId"], a["slotId"]))

    slots = [s["slotId"] for s in store.slots]
    desirability = {s["slotId"]: s["desirability"] for s in store.slots}

    # ⚠️ WHERE EVERYONE WHO IS *NOT* BEING REPAIRED ALREADY STANDS, PER BLOCK.
    #
    # `detect_conflicts` calls a cross-campus back-to-back a HARD conflict, and the assistant tells
    # planners so in as many words ("Eine Semestergruppe schafft das nicht in einer 15-Minuten-Pause").
    # The solver did not enforce it: campus appeared ONLY as a soft `cost += 10` for leaving the
    # session's CURRENT campus, and nothing at all related one session to the block beside it. So a
    # repair could satisfy every constraint it knew about and still hand back a plan that
    # `detect_conflicts` immediately calls hard — the two halves of the product disagreeing.
    #
    # This is the fixed side of the picture: sessions staying put still pin their owners in place,
    # so a repaired session cannot be dropped next to one of them across the city.
    fixed_where: dict[tuple[str, str, int], str] = {}
    for a in store.assignments:
        if a["sessionId"] in lifted:
            continue
        sess = store.session_by_id.get(a["sessionId"])
        slot = store.slot_by_id.get(a["slotId"])
        room = store.room_by_id.get(a["roomId"])
        if not sess or not slot or not room:
            continue
        for owner in (sess["teacherId"], sess["cohortId"]):
            fixed_where[(owner, slot["day"], slot["block"])] = room["buildingId"]

    def reachable_from_fixed(sess: dict, slot: dict, building: str) -> bool:
        """False when a neighbouring block already has this teacher or cohort too far away."""
        for owner in (sess["teacherId"], sess["cohortId"]):
            for step in (-1, 1):
                other = fixed_where.get((owner, slot["day"], slot["block"] + step))
                if other and _travel_minutes(store, other, building) >= _break_min():
                    return False
        return True

    solutions: list[dict] = []
    seen: list[set[tuple[str, str, str]]] = []

    for attempt in range(k):
        model = cp_model.CpModel()
        choice: dict[tuple[str, str, str], Any] = {}
        per_session: dict[str, list] = defaultdict(list)

        for sid in targets:
            sess = store.session_by_id[sid]
            current = store.assignment_by_session.get(sid, {})
            for room in store.rooms:
                if not room.get("schedulable"):
                    continue
                # ⚠️ UNKNOWN IS NOT A REASON TO RULE A ROOM OUT — NOR TO RULE IT IN QUIETLY. Untis
                # publishes neither room type nor capacity (PLAN §25.5), so on the real OTH dataset
                # both sides of these tests are None. Comparing them crashed the container at
                # `/api/health`. Excluding every room instead would make the solver answer
                # `no_candidate` for every question, which reads as "your plan cannot be repaired"
                # when the truth is "we were not told how big the rooms are". So an unknown passes
                # the filter and `detect_conflicts` reports the check as UNPERFORMED, which is
                # where that fact belongs.
                if (room["roomType"] is not None and sess["requiredRoomType"] is not None
                        and room["roomType"] != sess["requiredRoomType"]):
                    continue
                if (room["capacity"] is not None and sess["expectedAttendance"] is not None
                        and room["capacity"] < sess["expectedAttendance"]):
                    continue
                # ⚠️ AND WHEN NOBODY PUBLISHED THE HEADCOUNT, THE ROOM IT IS IN TODAY IS THE FLOOR.
                #
                # The check above needs `expectedAttendance`, and on the university's real export that is
                # unknown for every one of 3 015 sessions — so it never fires, and the solver was
                # free to move a lecture out of a 95-seat Hörsaal into a 24-seat CIP-Pool and
                # report it as a clean repair. Nothing in the plan said that was wrong, because
                # nothing in the plan said how many people were coming.
                #
                # But the university already answered the question by putting the lecture where it
                # is: whoever timetabled it into K 001 knew the group did not fit in K 006. That is
                # a real decision, and it survives even when the headcount does not. So a repair
                # may keep a room's size or improve on it, and may not shrink it.
                #
                # ⚠️ ONLY WHEN BOTH SIDES ARE KNOWN. Two unknowns compare to nothing, and ruling
                # out every room we have no floor plan for would answer `no_candidate` across the
                # 122 rooms of 148 OTH has never published — "your plan cannot be repaired" when
                # the truth is "we were not told how big the rooms are".
                #
                # ⚠️ AND ONLY WHILE THE HEADCOUNT IS UNKNOWN. Once a real attendance figure arrives
                # (Untis GPU003/GPU022 carry class sizes) it is the better answer, because it also
                # permits the sensible DOWNSIZING of an over-roomed lecture, which this forbids.
                if sess["expectedAttendance"] is None:
                    now = store.room_by_id.get(current.get("roomId") or "", {}).get("capacity")
                    if (now is not None and room["capacity"] is not None
                            and room["capacity"] < now):
                        continue
                for slot_id in slots:
                    if (sess["teacherId"], slot_id) in blocked:
                        continue
                    if (room["roomId"], slot_id) in blocked_rooms:
                        continue
                    if (room["roomId"], slot_id) in room_slot:
                        continue
                    if (sess["teacherId"], slot_id) in teacher_slot:
                        continue
                    if (sess["attendeeId"], slot_id) in attendee_slot:
                        continue
                    # Pruned rather than penalised: a placement stranded across the city from a
                    # session that is NOT moving can never be part of a legal answer, so it should
                    # not be offered as one.
                    if not reachable_from_fixed(
                        sess, store.slot_by_id[slot_id], room["buildingId"]
                    ):
                        continue
                    var = model.NewBoolVar(f"x_{sid}_{room['roomId']}_{slot_id}")
                    choice[(sid, room["roomId"], slot_id)] = var
                    per_session[sid].append(var)

            if not per_session[sid]:
                return {
                    "error": "no_candidate",
                    "sessionId": sid,
                    "message": (
                        f"{sid} has no legal room-and-slot at all: it needs a "
                        f"{sess['requiredRoomType']} for {sess['expectedAttendance']} people and "
                        "every one of those is taken or blocked."
                    ),
                }
            model.AddExactlyOne(per_session[sid])

        # No two repaired sessions may collide with each other either.
        #
        # ⚠️ Built by walking the VARIABLES, not the cross-product of rooms and slots. The first
        # version looped `for slot in 35: for room in 2094:` and rescanned the target list inside,
        # which is ~73 000 iterations of mostly-empty work per option: the individual CP-SAT
        # solves took 0.15–0.53 s while the whole call took 24 s. The solver was never the slow
        # part — building the model was. This keeps the interactive budget in PLAN §4 honest.
        by_room_slot: dict[tuple[str, str], list] = defaultdict(list)
        by_teacher_slot: dict[tuple[str, str], list] = defaultdict(list)
        by_attendee_slot: dict[tuple[str, str], list] = defaultdict(list)
        for (sid, room_id, slot_id), var in choice.items():
            sess = store.session_by_id[sid]
            by_room_slot[(room_id, slot_id)].append(var)
            by_teacher_slot[(sess["teacherId"], slot_id)].append(var)
            by_attendee_slot[(sess["attendeeId"], slot_id)].append(var)

        for group in (by_room_slot, by_teacher_slot, by_attendee_slot):
            for vs in group.values():
                if len(vs) > 1:
                    model.AddAtMostOne(vs)

        # ⚠️ AND TWO *REPAIRED* SESSIONS MUST NOT STRAND EACH OTHER EITHER. Pruning against the
        # fixed plan is only half of it: a cascade moves several sessions at once, and two of them
        # could be placed in consecutive blocks on opposite campuses without either one clashing
        # with anything that stayed still.
        #
        # Grouped by BUILDING rather than paired variable by variable. The comment above records
        # that model BUILDING, not solving, was what once took 24 s; a var-by-var cross product
        # here would put that straight back. Each group already holds at most one true variable —
        # two sessions of the same owner in one block is a double-booking the constraints above
        # forbid — so `sum(A) + sum(B) <= 1` says exactly "not A then B".
        by_owner_block: dict[tuple[str, str, int, str], list] = defaultdict(list)
        for (sid, room_id, slot_id), var in choice.items():
            sess = store.session_by_id[sid]
            slot = store.slot_by_id[slot_id]
            building = store.room_by_id[room_id]["buildingId"]
            for owner in (sess["teacherId"], sess["cohortId"]):
                by_owner_block[(owner, slot["day"], slot["block"], building)].append(var)

        buildings_at: dict[tuple[str, str, int], set[str]] = defaultdict(set)
        for owner, day, block, building in by_owner_block:
            buildings_at[(owner, day, block)].add(building)

        for (owner, day, block), here in buildings_at.items():
            there = buildings_at.get((owner, day, block + 1))
            if not there:
                continue
            for b1 in here:
                for b2 in there:
                    if _travel_minutes(store, b1, b2) < _break_min():
                        continue
                    first = by_owner_block[(owner, day, block, b1)]
                    second = by_owner_block[(owner, day, block + 1, b2)]
                    model.Add(sum(first) + sum(second) <= 1)

        # Objective: stay put if possible, then prefer good slots, then avoid changing campus.
        # The soft costs come from the RANKING the planner set, not from literals (PLAN 26.8).
        w = rules.weights()
        terms = []
        for (sid, room_id, slot_id), var in choice.items():
            current = store.assignment_by_session.get(sid, {})
            cost = 0
            if current.get("roomId") != room_id:
                cost += w["room"]
            if current.get("slotId") != slot_id:
                cost += w["slot"]
            cost += int((1.0 - desirability.get(slot_id, 1.0)) * w["desirability"])
            room = store.room_by_id[room_id]
            if current.get("campusId") and room["campusId"] != current["campusId"]:
                cost += w["campus"]
            terms.append(cost * var)
        model.Minimize(sum(terms))

        # Force a different answer each round, so "3 options" are 3 options.
        for previous in seen:
            model.Add(sum(choice[key] for key in previous if key in choice) <= len(previous) - 1)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_s
        solver.parameters.num_search_workers = 8
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break

        picked = {key for key, var in choice.items() if solver.Value(var)}
        seen.append(picked)
        moves = []
        for sid, room_id, slot_id in sorted(picked):
            current = store.assignment_by_session.get(sid, {})
            room = store.room_by_id[room_id]
            slot = store.slot_by_id[slot_id]
            moves.append({
                "sessionId": sid,
                "course": store.course_by_id.get(store.session_by_id[sid]["courseId"], {}).get("title"),
                "from": {"slotId": current.get("slotId"), "roomId": current.get("roomId")},
                "to": {"slotId": slot_id, "roomId": room_id,
                       "buildingId": room["buildingId"], "campusId": room["campusId"],
                       "day": slot["day"], "start": slot["startTime"]},
                "changed": current.get("slotId") != slot_id or current.get("roomId") != room_id,
            })
        solutions.append({
            "option": attempt + 1,
            "cost": int(solver.ObjectiveValue()),
            "optimalityProven": status == cp_model.OPTIMAL,
            "solveSeconds": round(solver.WallTime(), 2),
            "sessionsMoved": sum(1 for m in moves if m["changed"]),
            "moves": moves,
        })

    unchanged = all(
        not m["changed"] for opt in solutions for m in opt["moves"]
    ) if solutions else False

    result: dict[str, Any] = {
        "requested": targets,
        "options": solutions,
        "note": (
            "Ranked by disruption: option 1 changes the least. `optimalityProven` says whether "
            "CP-SAT proved this is the best possible answer or simply the best it found in the "
            "time limit."
        ) if solutions else "No conflict-free repair exists under the current constraints.",
    }

    # ⚠️ REFUSE TO NO-OP SILENTLY. The agent once called this with no `forbid`, the solver
    # correctly left everything where it was (staying put is free and legal), and the model then
    # told the planner "es existiert keine konfliktfreie Umplanung" — a confident, wrong, and very
    # expensive conclusion drawn from a correct result. A what-if only means something if the
    # hypothetical is actually applied, so when nothing was blocked and nothing moved, the tool
    # says so in words the model has to relay.
    if unchanged and not (forbid or []):
        result["warning"] = (
            "Es wurde nichts gesperrt (`forbid` war leer), deshalb bleibt jeder Termin stehen — "
            "der aktuelle Plan ist bereits konfliktfrei. Das heißt NICHT, dass keine Umplanung "
            "möglich wäre. Für ein Was-wäre-wenn muss die neue Nicht-Verfügbarkeit in `forbid` "
            "übergeben werden, z. B. forbid=[{'teacher': 'Hinterberger', 'day': 'Fr'}]."
        )
    return result


# ──────────────────────────────────────────────────────────────────────────────────────
# 4. Why not
# ──────────────────────────────────────────────────────────────────────────────────────
def explain_infeasibility(store: ScheduleStore, session_id: str, slot_id: str,
                          room_id: str | None = None) -> dict[str, Any]:
    """Why can this session not go there? Answered as reasons, not as a status code.

    Deliberately checks every constraint rather than stopping at the first failure — 'the room is
    too small AND the cohort is busy' is a different conversation from either one alone.
    """
    sess = store.session_by_id.get(session_id)
    slot = store.slot_by_id.get(slot_id)
    if not sess or not slot:
        return {"error": "unknown_session_or_slot", "sessionId": session_id, "slotId": slot_id}

    room_slot, teacher_slot, attendee_slot = store.occupied()
    reasons: list[str] = []

    if (sess["teacherId"], slot_id) in store.unavailable:
        t = store.teacher_by_id.get(sess["teacherId"], {})
        reasons.append(f"{t.get('name', sess['teacherId'])} ist in {slot_id} nicht verfügbar.")
    if (sess["teacherId"], slot_id) in teacher_slot:
        reasons.append(f"Die Lehrperson unterrichtet in {slot_id} bereits.")
    if (sess["attendeeId"], slot_id) in attendee_slot:
        reasons.append(f"Die Gruppe {sess['attendeeId']} hat in {slot_id} bereits Unterricht.")

    candidates = [
        r for r in store.rooms
        if r.get("schedulable")
        and r["roomType"] == sess["requiredRoomType"]
        and r["capacity"] is not None and sess["expectedAttendance"] is not None
        and r["capacity"] >= sess["expectedAttendance"]
    ]
    free = [r for r in candidates if (r["roomId"], slot_id) not in room_slot]
    if not candidates:
        reasons.append(
            f"Es gibt keinen {sess['requiredRoomType']} mit {sess['expectedAttendance']} Plätzen — "
            f"der größte hat {max((r['capacity'] for r in store.rooms if r['roomType'] == sess['requiredRoomType']), default=0)}."
        )
    elif not free:
        reasons.append(
            f"Alle {len(candidates)} geeigneten Räume sind in {slot_id} belegt."
        )

    if room_id:
        room = store.room_by_id.get(room_id)
        if not room:
            reasons.append(f"Raum {room_id} existiert nicht.")
        else:
            # ⚠️ Same rule as the solver's filter: a field the export does not publish cannot be
            # a reason. Saying "X ist ein None, gebraucht wird ein None" would be worse than
            # silence, and claiming the room is too small when nobody stated its size would be a
            # fabricated explanation — the one thing this function must never produce.
            if (room["roomType"] is not None and sess["requiredRoomType"] is not None
                    and room["roomType"] != sess["requiredRoomType"]):
                reasons.append(f"{room_id} ist ein {room['roomType']}, gebraucht wird ein {sess['requiredRoomType']}.")
            if (room["capacity"] is not None and sess["expectedAttendance"] is not None
                    and room["capacity"] < sess["expectedAttendance"]):
                reasons.append(f"{room_id} hat {room['capacity']} Plätze für {sess['expectedAttendance']} Teilnehmende.")
            if (room_id, slot_id) in room_slot:
                reasons.append(f"{room_id} ist in {slot_id} bereits belegt.")

    return {
        "sessionId": session_id,
        "slotId": slot_id,
        "roomId": room_id,
        "feasible": not reasons,
        "reasons": reasons or ["Keine Einschränkung gefunden — der Termin ist möglich."],
        "freeRoomsInSlot": [r["roomId"] for r in free[:10]],
    }


# ──────────────────────────────────────────────────────────────────────────────────────────
# 5. What is there at all
# ──────────────────────────────────────────────────────────────────────────────────────────
#: The bucket for rooms whose type the export does not state. A stable identifier rather than
#: `None` or German prose: it becomes a JSON key the assistant reads, and `$typesNote` explains it.
UNPUBLISHED_ROOM_TYPE = "unpublished"


def get_plan_overview(store: ScheduleStore, room_type: str | None = None) -> dict[str, Any]:
    """Inventory and load: how many rooms of each kind, how full, how split across the campuses.

    ⚠️ THIS TOOL EXISTS BECAUSE THE AGENT REFUSED A FAIR QUESTION. Asked "Wie viele Hörsäle gibt
    es?" it answered, correctly and uselessly, that no tool could tell it. Refusing beats
    inventing — but a planner asking how much lecture-hall capacity exists is the most ordinary
    question there is, and an assistant that can re-plan the week yet cannot count the halls looks
    broken in a way that undermines the parts that work.
    """
    teaching = [r for r in store.rooms if r.get("schedulable")]
    room_slot, _, _ = store.occupied()

    by_type: dict[str, dict[str, Any]] = {}
    for r in teaching:
        # ⚠️ A STABLE KEY, NOT `None`. On OTH's real export 122 of 148 rooms carry no room type, and
        # a `None` key did two bad things: it serialised to a JSON key of `"null"` (so the assistant
        # read "null" as the name of a room type), and it made the `room_type` filter below crash on
        # `None.lower()` — which meant "Wie viele Hörsäle gibt es?", the exact question this tool was
        # added for, raised AttributeError on the one dataset that is real.
        rtype = r.get("roomType") or UNPUBLISHED_ROOM_TYPE
        entry = by_type.setdefault(
            rtype,
            {"count": 0, "capacityMin": None, "capacityMax": None, "seats": 0, "seatsUnknown": 0},
        )
        entry["count"] += 1
        cap = r.get("capacity")
        # ⚠️ AN UNPUBLISHED CAPACITY IS NOT A ZERO, AND IT USED TO CRASH THE WHOLE TOOL.
        # `seats += None` raised TypeError on OTH's real Untis export, where **122 of 148 rooms**
        # carry no headcount at all — so the most ordinary question a planner can ask ("how many
        # lecture halls are there?") returned `tool_failed` on the one dataset that is real.
        # Counting the room but not its seats is the honest repair: treating the gap as 0 would
        # have answered "der Hörsaal hat 0 Plätze", which a planner would act on.
        if cap is None:
            entry["seatsUnknown"] += 1
            continue
        entry["seats"] += cap
        lo, hi = entry["capacityMin"], entry["capacityMax"]
        entry["capacityMin"] = cap if lo is None else min(lo, cap)
        entry["capacityMax"] = cap if hi is None else max(hi, cap)

    # ⚠️ A TYPE WHERE NOBODY PUBLISHED ANYTHING REPORTS None, NOT 0. After the loop above, such a
    # type would carry `seats: 0` — arithmetically true and editorially false, because it reads as
    # "these rooms have no seats" rather than "nobody measured them".
    for entry in by_type.values():
        if entry["seatsUnknown"] and entry["seats"] == 0:
            entry["seats"] = None

    used_by_type: dict[str, int] = defaultdict(int)
    for room_id, _slot in room_slot:
        room = store.room_by_id.get(room_id)
        if room:
            used_by_type[room.get("roomType") or UNPUBLISHED_ROOM_TYPE] += 1

    slots = len(store.slots)
    for name, entry in by_type.items():
        entry["bookedSlots"] = used_by_type.get(name, 0)
        entry["utilisation"] = round(used_by_type.get(name, 0) / max(1, entry["count"] * slots), 3)

    if room_type:
        match = next((k for k in by_type if k.lower() == room_type.lower()), None)
        by_type = {match: by_type[match]} if match else {}

    per_campus: dict[str, int] = defaultdict(int)
    for a in store.assignments:
        per_campus[a["campusId"]] += 1

    surveyed = [r for r in store.rooms if r.get("provenance") == "measured"]
    # ⚠️ SAY THAT A NUMBER IS INCOMPLETE, IN THE SAME BREATH AS THE NUMBER. `seats` is a sum over
    # whatever was published, and on a real export that can be a small minority of the rooms. The
    # assistant reads this dict and speaks from it, so the caveat has to travel WITH the figure —
    # the same rule as `unchecked` in `detect_conflicts`. Absent here, the model would confidently
    # report OTH's seating capacity as the total of the 26 rooms that happen to carry one.
    seats_unknown = sum(e["seatsUnknown"] for e in by_type.values())
    seats_note = None
    if seats_unknown:
        seats_note = (
            f"Für {seats_unknown} von {len(teaching)} Lehrräumen ist keine Platzzahl veröffentlicht. "
            "Die Summe `seats` zählt nur die bekannten — sie ist eine Untergrenze, keine Kapazität, "
            "und `seats: null` bedeutet: für diesen Raumtyp wurde nichts gemessen."
        )
    # ⚠️ The same honesty for the TYPE. `unpublished` is a bucket, not a kind of room, and an
    # assistant reading this dict would otherwise happily report "122 Räume vom Typ unpublished".
    untyped = by_type.get(UNPUBLISHED_ROOM_TYPE, {}).get("count", 0)
    types_note = None
    if untyped:
        types_note = (
            f"`{UNPUBLISHED_ROOM_TYPE}` ist kein Raumtyp, sondern die Sammelgruppe für "
            f"{untyped} Räume, zu denen der Export keine Art angibt."
        )
    return {
        "roomTypes": by_type,
        "teachingRooms": len(teaching),
        "allRooms": len(store.rooms),
        "seatsUnknown": seats_unknown,
        "$seatsNote": seats_note,
        "untypedRooms": untyped,
        "$typesNote": types_note,
        "$roomsNote": (
            "`allRooms` enthält Büros und Serviceflaechen. Auslastung immer gegen `teachingRooms` "
            "rechnen — in einem Büro findet keine Vorlesung statt."
        ),
        "sessionsPerWeek": len(store.sessions),
        "slotsPerWeek": slots,
        "buildings": len(store.buildings),
        "sessionsPerCampus": dict(per_campus),
        "surveyedRooms": len(surveyed),
        "$provenance": (
            f"{len(surveyed)} Räume stammen aus einer echten OpenStreetMap-Vermessung "
            "(Gebäude K, Erdgeschoss). Alle übrigen Raumgrundrisse sind generiert, der "
            "Stundenplan ist synthetisch. Gebäude, Lage und Entfernungen sind echt."
        ),
    }


def get_calendar(store: ScheduleStore, scope: str, key: str) -> dict[str, Any]:
    """One week, read-only: what is booked, what is free, and what the person cannot take.

    ⚠️ This is the ONE calendar function the agent can reach, and it is deliberately a different
    shape from the one the UI uses. `calendar_view` returns a 35-cell grid because a human reads a
    grid; a model reading the same thing would spend most of its context on empty cells. So this
    answers the question actually being asked — "when is this free" — as three short lists.

    It also closes a real gap. The agent could propose moves but could not LOOK at a week, so it
    had no way to answer "wann ist D 104 frei?" except by proposing a repair, and no way to check
    its own prose against the grid the planner is looking at.

    Read-only by construction: it never writes, and there is no draft parameter — the agent
    discusses the published plan, which is the one everybody shares.
    """
    from calendar_view import resolve_subject  # local import: keeps the module boundary visible

    if scope not in ("teacher", "cohort", "room"):
        return {"error": "bad_scope", "message": "scope muss teacher, cohort oder room sein"}

    subject = resolve_subject(store, scope, key)
    if not subject:
        return {"error": "not_found", "scope": scope, "key": key,
                "message": f"kein {scope} passt zu '{key}'"}
    if "ambiguous" in subject:
        return {"error": "ambiguous", "candidates": subject["ambiguous"],
                "message": (
                    f"'{key}' passt auf {' und '.join(subject['ambiguous'])} — das sind "
                    "verschiedene Räume. Bitte genau angeben."
                )}

    field = {"teacher": "teacherId", "cohort": "cohortId", "room": "roomId"}[scope]
    mine = [a for a in store.assignments if a.get(field) == subject["id"]]

    booked = []
    for a in sorted(mine, key=lambda x: (
        store.slot_by_id.get(x.get("slotId", ""), {}).get("dayIndex", 99),
        store.slot_by_id.get(x.get("slotId", ""), {}).get("block", 99),
    )):
        slot = store.slot_by_id.get(a.get("slotId", ""), {})
        course = store.course_by_id.get(a.get("courseId"), {})
        booked.append({
            "slotId": a.get("slotId"),
            "day": slot.get("day"),
            "start": slot.get("startTime"),
            "course": course.get("title"),
            "roomId": a.get("roomId"),
            "cohortId": a.get("cohortId"),
            "teacherId": a.get("teacherId"),
        })

    taken = {a.get("slotId") for a in mine}
    unavailable = {
        s["slotId"] for s in store.slots
        if scope == "teacher" and (subject["id"], s["slotId"]) in store.unavailable
    }
    restricted = {
        s["slotId"] for s in store.slots
        if scope == "teacher" and (subject["id"], s["slotId"]) in store.restricted
    }

    # ⚠️ "Free" excludes slots the person is unavailable for. An empty slot somebody has said no to
    # is not a free slot, and reporting it as one is how a planner gets talked into proposing a
    # move that was never possible.
    free = [
        s["slotId"] for s in sorted(store.slots, key=lambda x: (x["dayIndex"], x["block"]))
        if s["slotId"] not in taken and s["slotId"] not in unavailable
    ]

    return {
        "scope": scope,
        "subject": subject,
        "plan": "published",
        "bookedCount": len(booked),
        "booked": booked,
        "free": free,
        "unavailable": sorted(unavailable),
        "restricted": sorted(restricted),
        "$note": (
            "'free' schließt Zeitfenster aus, in denen die Person nicht verfügbar ist. "
            "Mehrere Termine im selben Zeitfenster sind normal (Parallelgruppen)."
        ),
    }


# ──────────────────────────────────────────────────────────────────────────────────────────
# 7. Who else could take it
# ──────────────────────────────────────────────────────────────────────────────────────────
def find_substitute(store: ScheduleStore, session_id: str, k: int = 5) -> dict[str, Any]:
    """Who could teach this session instead — ranked, with a reason on every name.

    PLAN §40. The shape is borrowed from `Einsatzplanung-Fresenius`' `suggest.py`, whose own
    docstring states the principle this project already holds: *"deliberately explainable (every
    suggestion carries a reason) rather than a black-box model, so a Dekan can trust and adjust
    it."* What is NOT borrowed is its scoring terms — Fresenius rewards internal staff because
    they count toward the 50 % professorale Quote, and that rule is the **nichtstaatlich**
    accreditation regime (BayHIG Teil 3). LMU and OTH are Teil 2, governed by Deputat/LUFV, so the
    same +0.4 is re-pointed at **Deputat headroom**, which is the constraint that actually binds
    them (PLAN §29.2, §40.2).

    ⚠️ **FEASIBILITY FIRST, RANKING SECOND — AND ONLY FEASIBLE NAMES ARE RETURNED.** Fresenius
    ranks but knows nothing about clashes; this store knows exactly who is busy. A plausible name
    that cannot actually take the session is this repository's most expensive recurring bug
    (`find_teacher` answering about ACHLEITNER, `propose_repairs` reporting "no repair" when
    `forbid` was omitted) wearing a helpful face. Nothing infeasible is returned, not even
    annotated — the caller cannot show what it never receives.

    ⚠️ **An empty list is an answer and says why.** Returning the least-bad candidate would be the
    same failure in the other direction, so the rejection reasons are counted and reported.
    """
    if store.teacher_attribution_invented:
        # ⚠️ Same refusal as `get_affected_sessions`, for the same reason and it matters more here:
        # on a dataset whose teaching is real but whose lecturers are invented, this would name a
        # fabricated professor as the person who should take a real lecture.
        return {"error": "teacher_not_published", "sessionId": session_id}

    sess = store.session_by_id.get(session_id)
    if not sess:
        return {"error": "unknown_session", "sessionId": session_id}
    assignment = store.assignment_by_session.get(session_id)
    if not assignment:
        return {"error": "session_not_placed", "sessionId": session_id}

    slot_id = assignment["slotId"]
    here = store.building_of_room(assignment["roomId"])
    incumbent = sess["teacherId"]
    _room_slot, teacher_slot, _attendee_slot = store.occupied()
    slot = store.slot_by_id.get(slot_id, {})
    course = store.course_by_id.get(sess["courseId"], {})

    # Everyone's current load, in one pass: how many sessions, and how many SWS of contract they
    # consume. ⚠️ `sws` is not published by every source, so it is summed only where it is known
    # and the Deputat term is simply omitted otherwise — a check that cannot be performed is not a
    # check that passed, and inventing a load would put a number on the screen nobody measured.
    used: dict[str, int] = {}
    sws_used: dict[str, float] = {}
    sws_known: dict[str, bool] = {}
    for a in store.assignments:
        tid = a.get("teacherId")
        if not tid:
            continue
        used[tid] = used.get(tid, 0) + 1
        c = store.course_by_id.get(a.get("courseId"), {})
        if c.get("sws") is None:
            sws_known[tid] = False
        else:
            sws_used[tid] = sws_used.get(tid, 0.0) + float(c["sws"])
            sws_known.setdefault(tid, True)
    max_used = max(used.values(), default=1) or 1

    # Adjacent blocks, for the travel rule. Two sessions in the same day one block apart are the
    # only pairs a transfer can fail between; everything else has the rest of the day.
    day, block = slot.get("day"), slot.get("block")
    neighbour_slots = {
        s["slotId"] for s in store.slots
        if s.get("day") == day and block is not None and abs(s.get("block", 0) - block) == 1
    }

    rejected: dict[str, int] = {}
    # ⚠️ STABLE CODES BESIDE THE GERMAN LABELS, NEVER INSTEAD OF THEM. `rejected` is prose the
    # assistant already quotes back in its German answers and that path is verified live, so it is
    # left exactly as it was. A UI cannot translate prose, though — every string a human reads comes
    # from the catalogue — so the same counts are published a second time under keys a client can
    # look up. The two are incremented together so they cannot drift.
    rejected_by_code: dict[str, int] = {}
    ranked: list[dict[str, Any]] = []

    def reject(label: str, code: str) -> None:
        rejected[label] = rejected.get(label, 0) + 1
        rejected_by_code[code] = rejected_by_code.get(code, 0) + 1

    for cand in store.teachers:
        tid = cand["teacherId"]
        if tid == incumbent:
            continue
        # ⚠️ Lehrbefähigung is approximated by the faculty, and the response says so. On the
        # generated datasets that is all the evidence there is; on a real export it is the
        # subject alias (PLAN §25.5). Proposing someone from another faculty because they happen
        # to be free would be a scheduling answer to a competence question.
        if cand.get("facultyId") != sess.get("facultyId"):
            continue

        if (tid, slot_id) in store.unavailable:
            reject("nicht verfügbar", "unavailable")
            continue
        if (tid, slot_id) in teacher_slot:
            reject("unterrichtet bereits", "alreadyTeaching")
            continue

        # The transfer they would have to make, either side of this block.
        too_far = None
        for a in store.assignments:
            if a.get("teacherId") != tid or a["slotId"] not in neighbour_slots:
                continue
            minutes = _travel_minutes(store, store.building_of_room(a["roomId"]), here)
            if minutes >= _break_min():
                too_far = minutes
                break
        if too_far is not None:
            reject("Weg zu weit", "travelTooFar")
            continue

        # ── Ranking. Only survivors get here, so every score describes a real option. ──
        mine = used.get(tid, 0)
        score = 1.0 - (mine / max_used)
        reasons: list[dict[str, Any]] = [
            {"code": "load", "value": mine,
             "text": "noch nicht eingeplant" if mine == 0 else f"{mine} Termine in der Woche"}
        ]

        contract = cand.get("contractSws")
        if contract is not None and sws_known.get(tid, True):
            taught = sws_used.get(tid, 0.0)
            headroom = float(contract) - taught
            # ⚠️ `taught` and `contract` ride along as NUMBERS, not only inside the German sentence.
            # The panel projects what taking this session would do to the load (PLAN §40.4 "who
            # SHOULD", not merely "who can"), and parsing that back out of prose would be a second
            # place for the arithmetic to live — and the first one to go wrong after a wording change.
            if headroom > 0:
                score += 0.4
                reasons.append({"code": "deputatHeadroom", "value": headroom,
                                "taught": taught, "contract": float(contract),
                                "text": f"Deputat: {taught:g} von {contract:g} SWS"})
            else:
                reasons.append({"code": "deputatFull", "value": headroom,
                                "taught": taught, "contract": float(contract),
                                "text": f"Deputat bereits erfüllt ({taught:g} von {contract:g} SWS)"})

        if course.get("teacherId") == tid:
            # The strongest signal available: they own the module. This is where Fresenius'
            # `modulverantwortung` column maps onto this dataset.
            score += 0.5
            reasons.append({"code": "moduleOwner", "value": True,
                            "text": "verantwortet dieses Modul"})

        ranked.append({
            "teacherId": tid, "name": cand.get("name"), "score": round(score, 3),
            "reasons": reasons, "feasible": True,
        })

    ranked.sort(key=lambda r: (-r["score"], r["teacherId"]))
    considered = sum(rejected.values()) + len(ranked)
    return {
        "sessionId": session_id,
        "slotId": slot_id,
        "course": course.get("title", sess["courseId"]),
        # ⚠️ May be None, and the caller must then show NO load projection. Not every source
        # publishes SWS per course, and "+0 SWS" would be a measurement nobody took — the same rule
        # the Deputat term above already follows by omitting itself.
        "sessionSws": course.get("sws"),
        "incumbent": {"id": incumbent,
                      "name": store.teacher_by_id.get(incumbent, {}).get("name")},
        "candidates": ranked[:k],
        "consideredCount": considered,
        "rejected": rejected,
        "rejectedByCode": rejected_by_code,
        "$competenceNote": (
            "Lehrbefähigung ist über die Fakultät angenähert — der Datensatz führt keine "
            "Lehrbefähigung pro Fach."
        ),
        "$emptyNote": (
            None if ranked else
            "Keine Lehrperson dieser Fakultät kann den Termin übernehmen. Gründe: "
            + ", ".join(f"{n}× {r}" for r, n in sorted(rejected.items()))
            if rejected else
            "Keine weitere Lehrperson in dieser Fakultät."
        ),
    }


TOOL_IMPLEMENTATIONS = {
    "get_affected_sessions": get_affected_sessions,
    "detect_conflicts": detect_conflicts,
    "propose_repairs": propose_repairs,
    "explain_infeasibility": explain_infeasibility,
    "get_plan_overview": get_plan_overview,
    "get_calendar": get_calendar,
    "find_substitute": find_substitute,
}
