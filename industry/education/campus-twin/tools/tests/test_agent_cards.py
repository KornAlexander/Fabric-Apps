"""The Adaptive Cards the agent renders, checked against the API that fills them.

⚠️ THE FAILURE THIS FILE EXISTS FOR IS SILENT. An Adaptive Card template that references a field
the API does not return does not error: `${if(foo, foo, 'N/A')}` renders the fallback, and the card
looks exactly like an API that answered with nothing. Nobody notices in a build, a schema check or
an import. It is noticed by a professor in Teams reading "Betroffene Termine: 0" for a change that
moves eighteen.

So every `${identifier}` in every card is compared against the keys the corresponding route in
`server/intake.py` actually puts in its response, extracted from the source rather than recalled.

    python tools/tests/test_agent_cards.py
"""

from __future__ import annotations

# ⚠️ UTF-8 REGARDLESS OF WHERE THE OUTPUT GOES. Python uses the console encoding for a terminal but
# the LOCALE encoding for a redirected stream (cp1252 on this machine), so printing a German name or
# a warning sign raised UnicodeEncodeError as soon as anything captured stdout — a runner, CI, or a
# pipe. The suite reported 54/54 for a while purely because the shell that ran it happened to carry
# PYTHONIOENCODING; without it, 23 of 54 files failed on output rather than on anything they test.
# Imported here rather than relied upon from below: this runs before the rest of the imports.
import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import ast
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "agent"))

# Build against placeholders, never a real deployment.
os.environ.setdefault("CAMPUS_AGENT_BACKEND_URL", "https://backend.example.invalid")
os.environ.setdefault("CAMPUS_AGENT_CONSUMER_URL",
                      "https://consumer.example.invalid/consumer.html")

import build_agent_package as pkg  # noqa: E402

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


# ------------------------------------------------------------------------------------------------
# What each route actually returns, read out of the source.
# ------------------------------------------------------------------------------------------------

def response_keys() -> dict[str, set[str]]:
    """Every string key assigned into a dict inside each operation's function body.

    Deliberately broader than "keys of the returned literal": `previewAvailabilityChange` builds a
    `result` dict, splats it into `out`, and then adds `interpretedDay` by subscript assignment.
    A narrow extractor would miss two thirds of that response and the test would pass while
    asserting nothing about the most important card in the package.
    """
    src = (ROOT / "server" / "intake.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    out: dict[str, set[str]] = {}

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        op = None
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call):
                for kw in dec.keywords:
                    if kw.arg == "operation_id" and isinstance(kw.value, ast.Constant):
                        op = str(kw.value.value)
        if not op:
            continue
        keys: set[str] = set()
        for sub in ast.walk(node):
            if isinstance(sub, ast.Dict):
                for k in sub.keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        keys.add(k.value)
            # out["interpretedDay"] = ...
            if isinstance(sub, ast.Subscript) and isinstance(sub.slice, ast.Constant):
                if isinstance(sub.slice.value, str):
                    keys.add(sub.slice.value)
        out[op] = keys
    return out


IDENT = re.compile(r"\$\{([^}]*)\}")
WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
#: ⚠️ QUOTED TEXT IS NOT A FIELD REFERENCE, and the first version of this test did not know that.
#: `${if(name, name, 'Unbekannte Person')}` contains the words "Unbekannte" and "Person", and
#: reporting them as unknown API fields drowned six real answers in eleven lines of noise. Every
#: German fallback string in every card looked like a bug. Strip the literals first.
LITERAL = re.compile(r"'[^']*'|\"[^\"]*\"")
# Template-language builtins and literals that are not response fields.
BUILTINS = {
    "if", "count", "formatNumber", "formatDateTime", "string", "json", "root", "data",
    "index", "length", "substr", "toUpper", "toLower", "and", "or", "not", "null",
    "true", "false",
}


def store_fields() -> set[str]:
    """Field names the STORE puts inside a row, as opposed to the route's top-level response.

    ⚠️ WITHOUT THIS THE TEST IS WRONG IN THE OTHER DIRECTION. The list cards iterate
    `${requests}` and read `requestId`, `kind`, `status` and `submittedByName` off each item. Those
    are built in `intake_store.py`, never in the route, so validating them against the route alone
    reported four real, correct field names as unknown. A test that cries wolf about correct code
    gets its assertion deleted, and then it is not there for the typo it was written to catch.
    """
    src = (ROOT / "server" / "intake_store.py").read_text(encoding="utf-8")
    keys: set[str] = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Dict):
            for k in node.keys:
                if isinstance(k, ast.Constant) and isinstance(k.value, str):
                    keys.add(k.value)
    return keys


def referenced_fields(card: object) -> set[str]:
    """Every response field a card template reads, ignoring quoted fallback text."""
    text = json.dumps(card, ensure_ascii=False)
    fields: set[str] = set()
    for expr in IDENT.findall(text):
        expr = LITERAL.sub(" ", expr)
        for word in WORD.findall(expr):
            if word in BUILTINS:
                continue
            # `needsAttention.count` reads the field `needsAttention`; `count` is a builtin.
            fields.add(word)
    return fields


# ------------------------------------------------------------------------------------------------

print("=== every operation has a card ===")
plugin = pkg.ai_plugin()
functions = {f["name"]: f for f in plugin["functions"]}
run_for = set(plugin["runtimes"][0]["run_for_functions"])

check("plugin declares 6 functions", len(functions) == 6, str(sorted(functions)))
check("every declared function is in run_for_functions",
      set(functions) == run_for, str(set(functions) ^ run_for))

for name, fn in sorted(functions.items()):
    caps = (fn.get("capabilities") or {}).get("response_semantics") or {}
    check(f"{name} has a response template", bool(caps.get("static_template")), str(list(caps)))
    check(f"{name} declares a data_path", bool(caps.get("data_path")), str(caps.get("data_path")))

print("\n=== the cards are structurally valid ===")
for name, fn in sorted(functions.items()):
    card = fn["capabilities"]["response_semantics"]["static_template"]
    check(f"{name} card type", card.get("type") == "AdaptiveCard", str(card.get("type")))
    check(f"{name} card version {pkg.CARD_VERSION}",
          card.get("version") == pkg.CARD_VERSION, str(card.get("version")))
    check(f"{name} card has a body", bool(card.get("body")), "empty body")
    check(f"{name} card is JSON-serialisable", isinstance(json.dumps(card), str))

print("\n=== ⚠️ every templated field is one the API really returns ===")
keys = response_keys()
items = store_fields()
for name, fn in sorted(functions.items()):
    card = fn["capabilities"]["response_semantics"]["static_template"]
    referenced = referenced_fields(card)
    known = keys.get(name, set()) | items
    unknown = sorted(f for f in referenced if f not in known)
    check(f"{name}: no template field is unknown to the API",
          not unknown,
          f"unknown={unknown}")

print("\n=== actions ===")
for name, fn in sorted(functions.items()):
    card = fn["capabilities"]["response_semantics"]["static_template"]
    for action in card.get("actions") or []:
        kind = action.get("type")
        check(f"{name}: action {kind} is OpenUrl",
              kind == "Action.OpenUrl",
              "only Action.OpenUrl is documented as supported here")

# ⚠️ The check that costs a support call if it is missing.
manifest = pkg.manifest()
valid = set(manifest["validDomains"])
print(f"  validDomains: {sorted(valid)}")
for name, fn in sorted(functions.items()):
    card = fn["capabilities"]["response_semantics"]["static_template"]
    for action in card.get("actions") or []:
        url = action.get("url", "")
        host = url.split("//", 1)[-1].split("/", 1)[0]
        check(f"{name}: {host} is in validDomains", host in valid,
              f"Teams would warn 'URL may lead to untrusted content' on this button")

no_submit = json.dumps(plugin, ensure_ascii=False)
check("no Action.Submit anywhere in the package", "Action.Submit" not in no_submit)
check("no Action.Execute anywhere in the package", "Action.Execute" not in no_submit)

print("\n=== ⚠️ negative control: the field check must be able to FAIL ===")
# A check that has never been seen to fail is a check nobody has tested. Both halves matter:
# a typo in a field name, and a fallback string that merely LOOKS like one.
sabotage = pkg._card(
    pkg._text("${if(affectedSesions, affectedSesions, 'N/A')}"),   # deliberate typo
    pkg._facts(("Person", "${submittedByName}")),                  # real, from the store
    pkg._text("${if(name, name, 'Unbekannte Person')}"),           # literal, must NOT be flagged
)
caught = referenced_fields(sabotage)
known_all = response_keys().get("previewAvailabilityChange", set()) | store_fields()
missed = sorted(f for f in caught if f not in known_all)
check("a misspelled field IS detected", "affectedSesions" in missed, str(missed))
check("a real store field is NOT flagged", "submittedByName" not in missed, str(missed))
check("words inside a German fallback string are NOT flagged",
      not {"Unbekannte", "Person"} & set(missed), str(missed))

print("\n=== the package still builds and carries the cards ===")
built = json.loads(json.dumps(plugin, ensure_ascii=False))
check("static templates survive a JSON round trip",
      all((built["functions"][i].get("capabilities") or {}).get("response_semantics")
          for i in range(len(built["functions"]))))

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
    raise SystemExit(1)
print("agent cards: all checks pass")
