"""Convert scanner/data_catalog_scanner.py (percent-cell format) to a Fabric
notebook .ipynb. Handles `# %%`, `# %% [markdown]`, and `# %% tags=[...]`."""
import json
import re
import sys
from pathlib import Path

_OUT_NAMES = {
    "data_catalog_scanner": "Data Catalog Scanner.ipynb",
    "create_catalog_model": "Create Data Catalog Model.ipynb",
    "catalog_grant": "Catalog Grant.ipynb",
}
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("data_catalog_scanner.py")
OUT = SRC.with_name(_OUT_NAMES.get(SRC.stem, SRC.stem + ".ipynb"))


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
            cells.append({"cell_type": "code", "metadata": meta,
                          "execution_count": None, "outputs": [], "source": body})

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
        c["source"] = [l + "\n" for l in c["source"].splitlines()]
        if c["source"]:
            c["source"][-1] = c["source"][-1].rstrip("\n")
    return cells


def main():
    cells = parse(SRC.read_text(encoding="utf-8"))
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "synapse_pyspark",
                           "name": "synapse_pyspark", "language": "Python"},
            "language_info": {"name": "python"},
            "microsoft": {"language": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    OUT.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({len(cells)} cells)")


if __name__ == "__main__":
    sys.exit(main())
