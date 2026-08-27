"""Convert percent-cell Python files into Fabric notebook .ipynb files.

Handles `# %%`, `# %% [markdown]`, and `# %% tags=[...]`.

**Include directive.** A line of the form

    #@include collectors/shape_fabric.py

is replaced by the contents of that file (its module docstring stripped, and the
relative-import shim removed). That is how the unit-tested shaping layer reaches
a Fabric notebook without a package upload: the code that runs in the tenant is
byte-for-byte the code the tests ran against.

Usage:
    python bootstrap/build_ipynb.py                      # build everything
    python bootstrap/build_ipynb.py bootstrap/x.py       # build one file
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_OUT_NAMES = {
    "gov_bootstrap": "Gov Bootstrap.ipynb",
    "gov_create_model": "Gov Create Model.ipynb",
    "gov_collect_fabric": "Gov Collect Fabric.ipynb",
    "gov_collect_entra": "Gov Collect Entra.ipynb",
    "gov_collect_pp": "Gov Collect PowerPlatform.ipynb",
    "gov_collect_agent": "Gov Collect Agents.ipynb",
    "gov_actuator": "Gov Actuator.ipynb",
}

INCLUDE_RE = re.compile(r"^#@include\s+(\S+)\s*$")

# The relative-import shim exists so the shaping modules are importable both as
# a package (tests) and as flat files (notebook). Inlined, neither applies.
#
# Scoped deliberately tight: a top-level `try:` whose body is *only* relative
# imports. A looser pattern would also eat the legitimate
# `try: import notebookutils / except ImportError:` fallbacks in runtime.py.
_SHIM_RE = re.compile(
    r"^try:.*\n(?:[ \t]+from \.[^\n]*\n)+except ImportError:.*\n(?:[ \t]+from [^\n]*\n)+",
    re.MULTILINE,
)


def _strip_module_docstring(text: str) -> str:
    stripped = text.lstrip()
    if not stripped.startswith(('"""', "'''")):
        return text
    quote = stripped[:3]
    end = stripped.find(quote, 3)
    return stripped[end + 3 :].lstrip("\n") if end != -1 else text


def expand_includes(text: str) -> str:
    out_lines = []
    for line in text.splitlines():
        match = INCLUDE_RE.match(line)
        if not match:
            out_lines.append(line)
            continue
        target = ROOT / match.group(1)
        if not target.exists():
            raise SystemExit(f"#@include target not found: {target}")
        body = _SHIM_RE.sub("", _strip_module_docstring(target.read_text(encoding="utf-8")))
        out_lines.append(f"# --- inlined from {match.group(1)} (unit-tested offline) ---")
        out_lines.extend(body.rstrip().splitlines())
    return "\n".join(out_lines)


def parse(text: str):
    lines = text.splitlines()
    # Drop the leading file-comment banner before the first cell marker.
    start = next(i for i, ln in enumerate(lines) if ln.startswith("# %%"))
    lines = lines[start:]
    cells, cur, is_md, tags = [], None, False, []

    def flush():
        if cur is None:
            return
        body = "\n".join(cur).strip("\n")
        if is_md:
            md = "\n".join(re.sub(r"^# ?", "", ln) for ln in body.splitlines())
            cells.append({"cell_type": "markdown", "metadata": {}, "source": md})
        else:
            meta = {"tags": tags} if tags else {}
            cells.append(
                {
                    "cell_type": "code",
                    "metadata": meta,
                    "execution_count": None,
                    "outputs": [],
                    "source": body,
                }
            )

    for ln in lines:
        if ln.startswith("# %%"):
            flush()
            is_md = "[markdown]" in ln
            m = re.search(r"tags=(\[[^\]]*\])", ln)
            tags = json.loads(m.group(1).replace("'", '"')) if m else []
            cur = []
        else:
            cur.append(ln)
    flush()

    for c in cells:
        c["source"] = [line + "\n" for line in c["source"].splitlines()]
        if c["source"]:
            c["source"][-1] = c["source"][-1].rstrip("\n")
    return cells


def build(src: Path) -> Path:
    out = src.with_name(_OUT_NAMES.get(src.stem, src.stem + ".ipynb"))
    cells = parse(expand_includes(src.read_text(encoding="utf-8")))
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "synapse_pyspark",
                "name": "synapse_pyspark",
                "language": "Python",
            },
            "language_info": {"name": "python"},
            "microsoft": {"language": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    # UTF-8 without BOM — PowerShell 5.1 would otherwise mangle the file on any
    # later round-trip (see user memory `powershell_utf8.md`).
    out.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out.name} ({len(cells)} cells)")
    return out


def main():
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            build(Path(arg))
        return
    for stem in _OUT_NAMES:
        src = ROOT / "bootstrap" / f"{stem}.py"
        if src.exists():
            build(src)


if __name__ == "__main__":
    main()
