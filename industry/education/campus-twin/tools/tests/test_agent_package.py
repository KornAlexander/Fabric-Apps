"""Is the generated agent package actually valid, or merely produced?

    python tools\\tests\\test_agent_package.py

⚠️ "THE BUILD SCRIPT EXITED 0" IS NOT EVIDENCE. The spike proved the packaging pipeline works, and
the way these fail is not a crash: the zip imports fine and the agent then cannot call anything,
because an operationId did not match, or a `$ref` was not followed, or the document claims OpenAPI
3.0 while containing 3.1-only constructs. Every one of those is silent until a user asks a question
and gets an apology.

So this checks the artefact, not the intention.
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

import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ⚠️ THE PACKAGE IS NOT IN THE REPOSITORY, and that is deliberate: it necessarily embeds a backend
# URL and an app id, so a committed copy points every clone at one deployment. This test therefore
# BUILDS it first, which also means the builder itself is exercised on every run rather than being
# a script somebody remembered to execute.
#
# Must agree with the default in tools/agent/build_agent_package.py, which is the OS temp directory
# for the same reason: a literal home path is "off the tree" on exactly one machine.
PKG = Path(os.getenv("CAMPUS_AGENT_OUT") or Path(tempfile.gettempdir()) / "campus-agent")
ZIP_PATH = PKG.with_suffix(".zip")

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


def main() -> int:
    build = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "agent" / "build_agent_package.py")],
        capture_output=True, text=True, cwd=str(ROOT))
    if build.returncode != 0:
        print("the builder failed, so there is nothing to validate:")
        print(build.stdout[-800:] + build.stderr[-800:])
        return 1

    if not PKG.exists():
        print(f"the builder reported success but wrote nothing to {PKG}")
        return 1

    import yaml

    spec = yaml.safe_load((PKG / "campus-intake.yaml").read_text(encoding="utf-8"))
    spec_text = (PKG / "campus-intake.yaml").read_text(encoding="utf-8")
    plugin = json.loads((PKG / "ai-plugin.json").read_text(encoding="utf-8"))
    agent = json.loads((PKG / "declarativeAgent.json").read_text(encoding="utf-8"))
    mani = json.loads((PKG / "manifest.json").read_text(encoding="utf-8"))

    print("\n[1] the OpenAPI document is really 3.0, not 3.1 wearing a 3.0 label")
    check("declares 3.0.x", str(spec.get("openapi", "")).startswith("3.0"), spec.get("openapi"))
    check("no 3.1-only 'type: null' survives", "'null'" not in spec_text and "type: null" not in spec_text)
    check("no unresolved $ref remains", "$ref" not in spec_text)
    check("no 3.1-only 'const' remains", not re.search(r"^\s*const:", spec_text, re.M))
    check("optional fields use nullable", "nullable: true" in spec_text)

    print("\n[2] the server is a real https host")
    servers = spec.get("servers") or []
    check("exactly one server", len(servers) == 1, servers)
    url = servers[0]["url"] if servers else ""
    check("server is https", url.startswith("https://"), url)
    check("manifest validDomains covers the server host",
          any(d in url for d in mani.get("validDomains", [])), mani.get("validDomains"))
    # ⚠️ An unconfigured build must be VISIBLY undeployable rather than quietly pointing at a real
    # host. `.invalid` is reserved by RFC 2606 and can never resolve.
    if url.endswith(".invalid"):
        print("        NOTE: built without CAMPUS_AGENT_BACKEND_URL, so the package targets an")
        print("              RFC 2606 .invalid host and cannot call anything. Set it to deploy.")

    print("\n[3] every advertised function maps to a real operation")
    op_ids = {op["operationId"] for path in spec["paths"].values()
              for op in path.values() if isinstance(op, dict) and "operationId" in op}
    fn_names = {f["name"] for f in plugin["functions"]}
    run_for = set(plugin["runtimes"][0]["run_for_functions"])

    check("no function without an operation", not (fn_names - op_ids), fn_names - op_ids)
    check("no operation left unadvertised", not (op_ids - fn_names), op_ids - fn_names)
    check("run_for_functions matches the function list", run_for == fn_names, run_for ^ fn_names)
    check("every function has a description",
          all(f.get("description") for f in plugin["functions"]))

    print("\n[4] the preview gate is expressed in the contract, not only in code")
    submit = spec["paths"]["/api/intake/submit"]["post"]
    body = submit["requestBody"]["content"]["application/json"]["schema"]
    check("submit takes a previewId", "previewId" in body.get("properties", {}), sorted(body.get("properties", {})))
    check("the previewId is described as required",
          "REQUIRED" in body["properties"]["previewId"].get("description", ""))
    # ⚠️ The agent must not even be OFFERED somewhere to put a reason. This used to assert that the
    # `utterance` field's description warned that reasons are stripped; the field is now gone
    # entirely, because a filter is not a privacy boundary and a field that does not exist cannot
    # be filtered wrongly. Asserting its absence is the stronger statement.
    #
    # ⚠️ THE NAME OF THIS CHECK USED TO SAY "the contract" AND IT ONLY EVER READ `submit`. That
    # was not a small imprecision: `decide` carries a `note` field, which is in the forbidden set
    # right below, and this check was silently green about it for as long as it existed. The
    # whole-contract audit now lives in `test_contract_conformance.py`, where it covers every
    # operation and has to justify each field it tolerates.
    props = body.get("properties", {})
    check("SUBMIT offers no free-text field",
          not ({"utterance", "reason", "note", "comment", "text"} & set(props)), sorted(props))
    check("no endpoint accepts teacherId from the caller",
          "teacherId" not in json.dumps([p for p in spec["paths"].values()]),
          "teacherId is settable by the caller")

    print("\n[5] auth is configured as the docs specify, and honestly")
    auth = plugin["runtimes"][0]["auth"]
    # Verified on Microsoft Learn 2026-08-21. `EntraOboPluginVault` is NOT a real value.
    check("auth type is OAuthPluginVault", auth.get("type") == "OAuthPluginVault", auth.get("type"))
    check("a reference_id is present", bool(auth.get("reference_id")))
    ref = auth.get("reference_id", "")
    is_placeholder = "REPLACE" in ref.upper()
    is_guid = bool(re.fullmatch(r"[0-9a-fA-F-]{36}", ref))
    check("reference_id is either an obvious placeholder or a real id",
          is_placeholder or is_guid, ref)
    if is_placeholder:
        print("        NOTE: still a placeholder. The package will import but NOT authenticate")
        print("              until an auth config is created in the Teams Developer Portal.")

    print("\n[6] the agent's instructions carry the rules the backend cannot enforce")
    instr = agent["instructions"]
    for needle, why in [
        ("ERFINDE NIEMALS ZAHLEN", "no invented numbers"),
        ("solverNote", "quote the solver verbatim"),
        # ⚠️ Spelled with real umlauts, matching the instructions. These needles are deliberately
        # LITERAL rather than derived from the instruction text: a check that reads a string from
        # the package and then asserts the package contains it proves nothing at all. The cost of
        # that choice is exactly this, that correcting the German breaks them, and the break is
        # the check doing its job.
        ("veröffentlicht", "never claim it published"),
        ("FRAGE NICHT NACH GRÜNDEN", "never ask for a reason"),
        ("previewId", "no submit without a preview"),
        ("403", "explain a refusal instead of routing around it"),
    ]:
        check(f"instructions cover: {why}", needle in instr)
    check("declarativeAgent version is v1.2", agent.get("version") == "v1.2")
    check("actions point at the plugin file",
          agent["actions"][0]["file"] == "ai-plugin.json")

    print("\n[7] the zip is shaped the way Teams requires")
    check("zip exists", ZIP_PATH.exists(), str(ZIP_PATH))
    if ZIP_PATH.exists():
        names = zipfile.ZipFile(ZIP_PATH).namelist()
        check("zip is flat, no folder prefix", all("/" not in n for n in names), names)
        expected = {"manifest.json", "declarativeAgent.json", "ai-plugin.json",
                    "campus-intake.yaml", "color.png", "outline.png"}
        check("zip holds exactly the six required files", set(names) == expected, sorted(names))
        for icon in ("color.png", "outline.png"):
            head = zipfile.ZipFile(ZIP_PATH).read(icon)[:8]
            check(f"{icon} is a real PNG", head == b"\x89PNG\r\n\x1a\n", head)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("agent package is structurally valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
