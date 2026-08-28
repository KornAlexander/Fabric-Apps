"""Ein Raum kann ausfallen, und der Solver muss das koennen, ohne eine Person zu nennen (PLAN §1).

Run: python tools/tests/test_room_closure.py

⚠️ GEPRUEFT WIRD AN TUM, UND ZWAR ABSICHTLICH. Dort sind Veranstaltungen, Raeume und Stunden echt
und nur die Person vorne ist erfunden, weshalb die Werkzeugschicht jede namentliche Personenfrage
verweigert. Bis diese Tuer aufging, hatte ausgerechnet der Standort mit den besten Daten UEBERHAUPT
KEINEN Weg zum Solver: die eine Faehigkeit, fuer die das Produkt existiert, war dort unerreichbar.
Ein Test an OTH wuerde das nicht zeigen, weil dort schon die Personentuer offen ist.

⚠️ DER EIGENTLICHE TEST IST NICHT "es kommt ein Vorschlag". Eine falsch verdrahtete Sperre liefert
ebenfalls Vorschlaege, sie sehen plausibel aus, und der gesperrte Raum ist am Freitag trotzdem
belegt. Deshalb wird jede zurueckgegebene Variante daraufhin durchsucht.

⚠️ UND DIE PERSONENTUER MUSS ZU BLEIBEN. Eine Raumsperre ist keine Hintertuer zu der Auskunft, die
nebenan verweigert wird, also wird die Verweigerung hier gleich mitgeprueft.
"""
import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "server"))
sys.path.insert(0, os.path.join(ROOT, "Campus-Scheduler", "server"))

from schedule_store import store_for  # noqa: E402
import tools  # noqa: E402

SITE = "tum"
DAY = "Fr"
failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + label)
    if not ok:
        failures.append(label)


store = store_for(SITE)
print(f"{SITE}: {len(store.rooms)} Räume, {len(store.assignments)} Belegungen, "
      f"Lehrende erfunden = {store.teacher_attribution_invented}")
check(store.teacher_attribution_invented,
      "TUM gilt weiterhin als Standort mit erfundener Lehrendenzuordnung")

# Den am Testtag am staerksten belegten Raum nehmen, sonst prueft der Test nichts.
slots_day = set(store.slots_of_day(DAY))
per_room: dict[str, int] = {}
for a in store.assignments:
    if a["slotId"] in slots_day:
        per_room[a["roomId"]] = per_room.get(a["roomId"], 0) + 1
room_id = max(per_room, key=per_room.get) if per_room else None
check(room_id is not None, f"am {DAY} ist überhaupt etwas gebucht")

if room_id:
    print(f"gewählter Raum: {room_id} mit {per_room[room_id]} Terminen am {DAY}")

    aff = tools.get_affected_sessions(store, room=room_id, day=DAY)
    check(not aff.get("error"), f"betroffene Termine je Raum werden geliefert ({aff.get('error')})")
    check("teacher" not in aff, "die Raumauskunft nennt keine Lehrperson")
    ids = [s["sessionId"] for s in aff.get("sessions", [])]
    check(len(ids) > 0, "es sind Termine betroffen")

    prop = tools.propose_repairs(store, ids, k=3, forbid=[{"room": room_id, "day": DAY}])
    check(not prop.get("error"), f"der Solver liefert einen Vorschlag ({prop.get('error')})")
    options = prop.get("options") or []
    check(len(options) > 0, "mindestens eine Variante")

    # Der Kern: keine Variante darf den gesperrten Raum am gesperrten Tag wieder belegen.
    violations = []
    for i, opt in enumerate(options, 1):
        for mv in opt.get("moves", []):
            to = mv.get("to") or mv
            if to.get("roomId") == room_id and to.get("slotId") in slots_day:
                violations.append((i, mv.get("sessionId"), to.get("slotId")))
    check(not violations, f"keine Variante belegt {room_id} am {DAY} erneut ({violations[:3]})")

# Die Personentuer bleibt zu, die Raumtuer oeffnet sie nicht.
by_teacher = tools.get_affected_sessions(store, teacher="Mustermann", day=DAY)
check(by_teacher.get("error") == "teacher_not_published",
      f"die namentliche Personenfrage wird weiterhin verweigert ({by_teacher.get('error')})")

# Ein unbekannter Raum wird nicht geraten.
miss = tools.get_affected_sessions(store, room="gibtesnicht", day=DAY)
check(miss.get("error") == "room_not_found", "ein unbekannter Raum wird abgelehnt, nicht geraten")

print()
if failures:
    print(f"{len(failures)} Prüfung(en) fehlgeschlagen")
    sys.exit(1)
print("alle Prüfungen bestanden")
