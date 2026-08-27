"""Structural tests for the generated notebooks (PLAN.md §18).

The include directive is a small build step with a large blast radius: if it
strips the wrong lines, the notebook still *looks* fine in the portal and then
fails at 02:00 in a tenant. These tests parse every generated notebook and
assert the inlined, unit-tested shaping code actually arrived intact.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "bootstrap"

_spec = importlib.util.spec_from_file_location("build_ipynb", BOOTSTRAP / "build_ipynb.py")
build_ipynb = importlib.util.module_from_spec(_spec)
sys.modules["build_ipynb"] = build_ipynb
assert _spec.loader is not None
_spec.loader.exec_module(build_ipynb)

SOURCES = sorted(BOOTSTRAP.glob("gov_*.py"))
COLLECTORS = [p for p in SOURCES if p.stem.startswith("gov_collect_")]


def test_every_source_has_a_build_target():
    assert SOURCES, "no notebook sources found"
    for src in SOURCES:
        assert src.stem in build_ipynb._OUT_NAMES, f"{src.stem} has no output name"


@pytest.mark.parametrize("src", SOURCES, ids=lambda p: p.stem)
def test_expanded_source_is_valid_python(src: Path):
    expanded = build_ipynb.expand_includes(src.read_text(encoding="utf-8"))
    # Percent-cell markdown is just comments, so the whole file must parse.
    ast.parse(expanded)


@pytest.mark.parametrize("src", SOURCES, ids=lambda p: p.stem)
def test_no_import_shim_survives_inlining(src: Path):
    expanded = build_ipynb.expand_includes(src.read_text(encoding="utf-8"))
    # A surviving relative import would raise ImportError on the first cell.
    # (`try: import notebookutils / except ImportError:` fallbacks are fine and
    # must NOT be stripped, so only relative imports are checked here.)
    survivors = [
        line
        for line in expanded.splitlines()
        if re.match(r"^\s*from \.\w", line)
    ]
    assert survivors == [], f"relative imports survived inlining: {survivors}"


@pytest.mark.parametrize("src", COLLECTORS, ids=lambda p: p.stem)
def test_collectors_inline_the_tested_shaping_layer(src: Path):
    expanded = build_ipynb.expand_includes(src.read_text(encoding="utf-8"))
    # The run ledger and the write helper come from the shared layer...
    assert "class RunLedger" in expanded
    assert "def write_table(" in expanded
    # ...and each collector must carry at least one shape_ function.
    assert "def shape_" in expanded


@pytest.mark.parametrize("src", COLLECTORS, ids=lambda p: p.stem)
def test_collectors_default_to_dry_run(src: Path):
    """A collector that defaults to writing is a collector that surprises someone."""
    text = src.read_text(encoding="utf-8")
    assert "dry_run = True" in text


@pytest.mark.parametrize("src", COLLECTORS, ids=lambda p: p.stem)
def test_collectors_report_a_run_row(src: Path):
    text = src.read_text(encoding="utf-8")
    assert "RunLedger(" in text
    assert "finish(ledger" in text


@pytest.mark.parametrize("src", SOURCES, ids=lambda p: p.stem)
def test_generated_notebook_is_well_formed(src: Path):
    out = BOOTSTRAP / build_ipynb._OUT_NAMES[src.stem]
    if not out.exists():
        pytest.skip(f"{out.name} not built yet")
    nb = json.loads(out.read_text(encoding="utf-8"))
    assert nb["nbformat"] == 4
    assert nb["metadata"]["kernelspec"]["name"] == "synapse_pyspark"
    assert nb["cells"], "notebook has no cells"
    for cell in nb["cells"]:
        assert cell["cell_type"] in {"code", "markdown"}
        assert isinstance(cell["source"], list)

    # The parameters cell is how Fabric passes dry_run in — without the tag the
    # app's runNotebook parameters are silently ignored.
    tagged = [c for c in nb["cells"] if "parameters" in c.get("metadata", {}).get("tags", [])]
    assert len(tagged) == 1, "exactly one cell must carry the `parameters` tag"


@pytest.mark.parametrize("src", SOURCES, ids=lambda p: p.stem)
def test_generated_notebook_matches_current_source(src: Path):
    """Fails when a .py changed but `npm run notebooks` was not re-run."""
    out = BOOTSTRAP / build_ipynb._OUT_NAMES[src.stem]
    if not out.exists():
        pytest.skip(f"{out.name} not built yet")
    expected = build_ipynb.parse(build_ipynb.expand_includes(src.read_text(encoding="utf-8")))
    actual = json.loads(out.read_text(encoding="utf-8"))["cells"]
    assert len(expected) == len(actual), "rebuild the notebooks: cell count differs"
    for i, (exp, act) in enumerate(zip(expected, actual)):
        assert exp["source"] == act["source"], f"rebuild the notebooks: cell {i} differs"
