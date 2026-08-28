"""The deterministic id of one availability cell. A THIRD implementation, pinned to the other two.

    from availability_id import availability_id
    availability_id("oth", "IM-T007", "Di-6")   # -> the same id the app and the seeder compute

⚠️ No example OUTPUT here on purpose: it would be a guid literal in a shipping file, and the one
place those values belong is the seeding tool, which is not part of the public tree.

⚠️ THIS IS DUPLICATED CODE AND THAT IS THE LEAST BAD OPTION. The same function already exists twice:

    src/api/planStore.ts            `assignmentId` / `availabilityId`   (the app writes rows)
    tools/fabric/seed_plan_assignments.py `assignment_id`               (the seeder writes rows)

A third copy is obviously worse than importing one of them, and it is here anyway because the
BACKEND CANNOT REACH EITHER. The Dockerfile copies exactly `server/` and `data/`; `tools/` is not
in the image, so `from tools.fabric...` is an ImportError in the container and works fine on a
laptop, which is the worst possible combination. TypeScript is not importable at all.

⚠️ SO THE ORACLE IS THE POINT, NOT THE CODE. `tools/tests/test_availability_id.py` asserts this
implementation against the SAME two rows the deployed app itself wrote into
`dbo.TeacherAvailabilities`, which is exactly what the seeding tool uses.
If any of the three drifts, that test fails. Three implementations agreeing by test is a real
guarantee; three implementations agreeing by inspection is a wish.

Getting this wrong does not error. It writes a SECOND row for a cell that already has one, and the
planner sees a lecturer both available and not.
"""

from __future__ import annotations

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK = 0xFFFFFFFF


def assignment_id(site: str, session_id: str) -> str:
    """FNV-1a over `site:sessionId`, four salted passes, folded into the RFC 4122 v4 LAYOUT.

    ⚠️ The version and variant nibbles are set only so a `uniqueidentifier` column accepts the
    value. This is a stable identifier, not a random one and not a secure one: FNV-1a is a hash
    for lookup tables. Nothing here should ever be treated as unguessable.
    """
    key = f"{site}:{session_id}"
    parts = []
    for salt in range(4):
        h = (_FNV_OFFSET ^ salt) & _MASK
        for ch in key:
            h ^= ord(ch)
            h = (h * _FNV_PRIME) & _MASK
        parts.append(f"{h:08x}")
    raw = "".join(parts)
    # ⚠️ Note the gaps: `raw[13:16]` after a literal "4", and `raw[17:20]` after the variant
    # nibble. Two of the 32 hex digits are DISCARDED. That is what the other two implementations
    # do, so it is what this one must do; "fixing" it silently repoints every id ever written.
    return "-".join([
        raw[0:8],
        raw[8:12],
        "4" + raw[13:16],
        f"{(int(raw[16], 16) & 0x3) | 0x8:x}" + raw[17:20],
        raw[20:32],
    ])


def availability_id(site: str, teacher_id: str, slot_id: str) -> str:
    """One cell of one lecturer's week. Key shape: `<site>:<teacherId>@<slotId>`."""
    return assignment_id(site, f"{teacher_id}@{slot_id}")


#: ⚠️ NO ORACLE VALUES IN THIS FILE. They live where oracles belong, in the test, and there is
#: exactly ONE copy of them, in the seeding tool, which is not published:
#: which `tools/tests/test_availability_id.py` imports and asserts this module against. A second
#: copy here would have needed its own entry in `verify_publishable.py`'s allowlist, and an
#: oracle that exists twice is no longer an oracle.

__all__ = ["assignment_id", "availability_id"]
