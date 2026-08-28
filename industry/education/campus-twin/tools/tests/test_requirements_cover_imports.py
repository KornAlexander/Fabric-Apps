"""Every third-party module the server imports must be installed in the image.

⚠️ This is the test that would have caught the real defect, and restating the file would not
have. Before this ran, `server/auth.py` imported `jwt` and `server/intake_store.py` imported
`pyodbc` while `server/requirements.txt` mentioned neither, so the container would have answered
503 to the entire Copilot intake path forever and nothing in the suite would have said a word.

It walks the AST rather than importing, so it sees the LAZY and GUARDED imports too. Those are
exactly the dangerous ones: an import inside `try:` or inside a function does not crash at
start-up, so the gap stays invisible until a user hits the route.
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
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parents[2] / "server"
REQUIREMENTS = SERVER / "requirements.txt"

# Import name -> distribution name, for the few where they differ.
#
# ⚠️ Only for names that CANNOT be derived. The first version of this file mapped the import ROOT
# and immediately produced a false positive: `azure` is a namespace package, and
# `from azure.identity import ...` is served by the `azure-identity` distribution, which was
# declared all along. Candidate names are therefore derived from the dotted path (see
# `candidate_distributions`) and this table only covers the genuinely arbitrary renames.
DISTRIBUTION_OF = {
    "jwt": "pyjwt",
    "dotenv": "python-dotenv",
    "multipart": "python-multipart",
    "yaml": "pyyaml",
    "PIL": "pillow",
    "dateutil": "python-dateutil",
}

# Modules that are genuinely fine to be missing, each with the reason it is fine.
EXEMPT = {
    # Pulled in by fastapi/uvicorn; never imported by our own code as a direct dependency.
    "starlette": "transitive dependency of fastapi",
}


def declared_distributions() -> set[str]:
    """Distribution names in requirements.txt, normalised (PEP 503) and without extras/markers."""
    names: set[str] = set()
    # ⚠️ Explicit utf-8: the file contains non-ASCII, and reading it at the locale encoding is
    # what breaks `pip install -r` on a cp1252 Windows box.
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        for separator in ("[", ">", "<", "=", "!", "~", ";", " "):
            line = line.split(separator, 1)[0]
        if line:
            names.add(line.strip().lower().replace("_", "-").replace(".", "-"))
    return names


def candidate_distributions(module_path: str) -> list[str]:
    """Distribution names that could plausibly provide this dotted module path.

    Longest prefix first, so `azure.identity` is tested as 'azure-identity' before 'azure', and a
    namespace package is not reported missing just because nobody ships the bare namespace.
    """
    parts = module_path.split(".")
    names = []
    for depth in range(len(parts), 0, -1):
        prefix = ".".join(parts[:depth])
        mapped = DISTRIBUTION_OF.get(prefix)
        if mapped:
            names.append(mapped)
        names.append(prefix.replace(".", "-").replace("_", "-").lower())
    return names


def imported_modules() -> dict[str, set[str]]:
    """Dotted module path -> the server files that import it, lazy and guarded included."""
    local = {p.stem for p in SERVER.glob("*.py")} | {
        p.name for p in SERVER.iterdir() if p.is_dir() and (p / "__init__.py").exists()
    }
    found: dict[str, set[str]] = {}
    for path in sorted(SERVER.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                paths = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                # level > 0 is a relative import, so by definition local.
                if node.level or not node.module:
                    continue
                paths = [node.module]
            else:
                continue
            for module_path in paths:
                root = module_path.split(".")[0]
                if root in sys.stdlib_module_names or root in local:
                    continue
                found.setdefault(module_path, set()).add(path.name)
    return found


def main() -> int:
    declared = declared_distributions()
    failures: list[str] = []

    for module, users in sorted(imported_modules().items()):
        if module.split(".")[0] in EXEMPT:
            continue
        candidates = candidate_distributions(module)
        if not any(name in declared for name in candidates):
            where = ", ".join(sorted(users))
            failures.append(
                f"  {module!r} is imported by {where} but requirements.txt declares "
                f"none of {candidates}"
            )

    if failures:
        print("FAIL: the image would not install everything the server imports")
        print("\n".join(failures))
        return 1

    print(f"OK - every third-party import is declared ({len(declared)} distributions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
