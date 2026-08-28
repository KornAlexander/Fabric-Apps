"""The rule catalogue — the numbers the solver obeys, as data instead of constants.

PLAN §26.5-26.8 and §39. Until now every one of these lived as a literal in `tools.py`: the break
between sessions on line 23, and the four soft costs on lines 606-612. A planner saying *"I would
rather move the room than the time"* is expressing a one-line preference, and it was a `3` against a
`6` that nobody outside this repository could see and nobody at all could change without a deploy.

⚠️ **THE ORDERING IS EXPOSED, NOT THE INTEGERS** (§26.8, ratified 2026-08-20). The planner ranks
what they would rather keep; the app maps that ranking onto the ladder below. A ranking cannot be
incoherent, whereas free weights let somebody set `move_room > campus_change`, which nobody means —
and the ladder can be rebalanced later without invalidating a preference anyone expressed.

⚠️ **`kind` IS NOT EDITABLE.** Hard stays hard. Reclassifying "two lectures may not share a room" as
a preference is how a plan becomes illegal while every screen still shows green.

⚠️ **IN-PROCESS ONLY, exactly like `publish` and `set_availability`.** The container scales to zero
and this is not a database. Every response says so rather than letting a planner infer durability
from a green banner.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any

#: Cost ladder, cheapest change first. The ORDER a planner gives is mapped onto these, so the
#: numbers stay comparable however the ranking is rearranged.
#: ⚠️ These are the values `propose_repairs` used as literals before this module existed
#: (`tools.py:606-612`: room 3, slot 6, desirability 8, campus 10), so an untouched catalogue
#: reproduces the previous solver behaviour exactly. That is what makes this refactor checkable.
COST_LADDER: tuple[int, ...] = (3, 6, 8, 10)

#: The four things a repair can change, in the order that reproduces the old literals.
DEFAULT_ORDER: tuple[str, ...] = ("room", "slot", "desirability", "campus")

CONFIG_DIR = pathlib.Path(__file__).resolve().parents[1] / "config" / "rules"


def _defaults() -> dict[str, Any]:
    return {
        "order": list(DEFAULT_ORDER),
        "breakMin": 15,
        "solverSeconds": 5.0,
        "options": 3,
    }


#: Provenance and bounds per numeric rule. Carried to the UI so a planner can see they are
#: correcting a GUESS rather than overriding a measurement — which is the whole reason §39 wanted
#: this surface: `breakMin` has never been put to OTH or LMU.
META: dict[str, dict[str, Any]] = {
    "breakMin": {
        "unit": "min", "min": 0, "max": 60, "kind": "hard", "provenance": "assumed",
        "note": "Nie mit der Hochschule abgestimmt — bitte prüfen.",
    },
    "solverSeconds": {
        "unit": "s", "min": 1, "max": 10, "kind": "budget", "provenance": "chosen",
        # ⚠️ No "Solver" on a planner's screen. `catalogue.test.ts` bans that word in the i18n
        # files, but it cannot see text the SERVER writes — and this note is rendered verbatim
        # under the field. The python suite carries the same word list for exactly that reason.
        "note": "Die Planung liefert den besten Vorschlag, den sie in dieser Zeit findet.",
    },
    "options": {
        "unit": "", "min": 1, "max": 5, "kind": "budget", "provenance": "chosen",
        "note": "Wie viele Alternativvorschläge berechnet werden.",
    },
}

#: What each orderable term means, for the UI. Kept here so the label and the weight cannot drift.
ORDER_LABELS: dict[str, str] = {
    "room": "Raum beibehalten",
    "slot": "Zeit beibehalten",
    "desirability": "Gute Tageszeit bevorzugen",
    "campus": "Standort beibehalten",
}

_state: dict[str, dict[str, Any]] = {}


def _site() -> str:
    return os.getenv("SCHEDULER_SITE", "oth")


def _load(site: str) -> dict[str, Any]:
    """Defaults, overlaid with `config/rules/<site>.json` if a site ships one."""
    values = _defaults()
    path = CONFIG_DIR / f"{site}.json"
    if path.exists():
        try:
            shipped = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            # ⚠️ A broken config must not take the backend down at import — the solver has working
            # defaults and a site that cannot be read is a fact to report, not a reason to refuse
            # to start. `sites_boot` would otherwise fail for every site on one bad file.
            return values
        for k in ("order", "breakMin", "solverSeconds", "options"):
            if k in shipped:
                values[k] = shipped[k]
    return values


def current(site: str | None = None) -> dict[str, Any]:
    site = site or _site()
    if site not in _state:
        _state[site] = _load(site)
    return _state[site]


def weights(site: str | None = None) -> dict[str, int]:
    """The four soft costs, derived from the ranking rather than stored."""
    order = current(site)["order"]
    return {term: COST_LADDER[min(i, len(COST_LADDER) - 1)] for i, term in enumerate(order)}


def break_min(site: str | None = None) -> int:
    return int(current(site)["breakMin"])


def solver_seconds(site: str | None = None) -> float:
    return float(current(site)["solverSeconds"])


def option_count(site: str | None = None) -> int:
    return int(current(site)["options"])


def describe(site: str | None = None) -> dict[str, Any]:
    """Everything the Regelwerk page needs, in one response."""
    values = current(site)
    w = weights(site)
    return {
        "site": site or _site(),
        "order": [
            {"id": term, "label": ORDER_LABELS.get(term, term), "weight": w[term], "rank": i + 1}
            for i, term in enumerate(values["order"])
        ],
        "numbers": [
            {"id": k, "value": values[k], **META[k]} for k in ("breakMin", "solverSeconds", "options")
        ],
        "defaults": _defaults(),
        "$durability": (
            "Änderungen gelten für diese laufende Instanz. Der Dienst startet nach einer Pause neu "
            "und beginnt dann wieder mit den hinterlegten Werten."
        ),
    }


def apply(patch: dict[str, Any], site: str | None = None) -> dict[str, Any]:
    """Change the rules, refusing anything that would make the catalogue incoherent.

    ⚠️ Refusals are returned, not raised, and each names the field — a settings screen that fails
    with a stack trace teaches the planner nothing about what it wanted instead.
    """
    site = site or _site()
    values = current(site)
    refused: list[dict[str, str]] = []
    changed: list[dict[str, Any]] = []

    if "order" in patch:
        new_order = list(patch["order"] or [])
        if sorted(new_order) != sorted(DEFAULT_ORDER):
            # ⚠️ A ranking that drops or duplicates a term is not a preference, it is a broken
            # form. Silently completing it would invent a preference the planner never expressed.
            refused.append({"field": "order",
                            "reason": f"Die Reihenfolge muss genau {len(DEFAULT_ORDER)} Einträge "
                                      f"enthalten: {', '.join(DEFAULT_ORDER)}."})
        elif new_order != values["order"]:
            changed.append({"field": "order", "from": list(values["order"]), "to": new_order})
            values["order"] = new_order

    for key in ("breakMin", "solverSeconds", "options"):
        if key not in patch:
            continue
        meta = META[key]
        try:
            v = float(patch[key])
        except (TypeError, ValueError):
            refused.append({"field": key, "reason": "Kein gültiger Zahlenwert."})
            continue
        if v < meta["min"] or v > meta["max"]:
            refused.append({"field": key,
                            "reason": f"Muss zwischen {meta['min']} und {meta['max']} "
                                      f"{meta['unit']} liegen."})
            continue
        v = int(v) if key != "solverSeconds" else v
        if v != values[key]:
            changed.append({"field": key, "from": values[key], "to": v})
            values[key] = v

    return {"changed": changed, "refused": refused, "rules": describe(site)}


def reset(site: str | None = None) -> dict[str, Any]:
    site = site or _site()
    _state[site] = _load(site)
    return describe(site)
