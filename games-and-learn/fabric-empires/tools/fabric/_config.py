"""Where this deployment lives, and why none of it is committed.

Every value below identifies one workspace inside one tenant. A GUID like that
is not a secret in the password sense, but it is a coordinate: it names a real
workspace, a real database and a real report, and it does not belong in a public
repository. `tools/verify_publishable.py` fails the build if one reappears.

Two rules shape this file.

**Read from the environment, and never supply a default.** A default would be a
coordinate by another name, and worse, a wrong default deploys into somebody
else's workspace and reports success. A missing value must stop the script.

**Paths are derived from this file's own location.** The scripts used to carry
absolute paths under a Windows user profile, which named a person and a machine
layout and broke for every other clone. `parents[2]` is the repository root
because this file sits at `tools/fabric/_config.py`.

Copy `.env.example` to `.env`, fill it in, and either export the variables or
load the file before running anything in this folder.
"""

from __future__ import annotations

import os
import pathlib
import uuid

REPO = pathlib.Path(__file__).resolve().parents[2]
MODEL_DIR = REPO / "fabric" / "Fabric Empires.SemanticModel"
REPORT_DIR = REPO / "fabric" / "Fabric Empires.Report"
OUTLINE = REPO / "learn" / "content" / "dp-600" / "outline.json"

# Scratch output (deployed item ids, mostly). Gitignored, and beside the scripts
# rather than in some sibling folder that only exists on one machine.
OUT = pathlib.Path(__file__).resolve().parent / ".out"

MODEL_NAME = "Fabric Empires"
REPORT_NAME = "Fabric Empires"

# The namespace every `lineageTag`, `logicalId` and relationship name in the
# generated definitions is derived from, via uuid5. It is an arbitrary constant
# invented for this repository and names nothing outside it; it lives here so
# there is one of it rather than one per generator, and so the publishability
# gate has a single line to excuse.
#
# ⚠️ Changing it re-tags every column in the model, which detaches the report
# bindings from the deployed one. It is fixed for the life of the project.
LINEAGE_NS = uuid.UUID("6f2b1c44-1f7d-4a52-9b0e-7c1d5c2f0a11")

# The committed definitions carry these instead of real ids. The deploy scripts
# substitute them on the way to the API, so the files on disk stay publishable
# and the thing that is uploaded is still correct.
PLACEHOLDERS = {
    "{{FE_WORKSPACE_ID}}": "FE_WORKSPACE_ID",
    "{{FE_WORKSPACE_NAME}}": "FE_WORKSPACE_NAME",
    "{{FE_SQLDB_ITEM_ID}}": "FE_SQLDB_ITEM_ID",
    "{{FE_MODEL_ID}}": "FE_MODEL_ID",
}


def need(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(
            f"{name} is not set.\n"
            f"These scripts act on one specific Fabric workspace, and its\n"
            f"coordinates are deliberately not committed. See\n"
            f"tools/fabric/.env.example for the full list."
        )
    return value


def workspace_id() -> str:
    return need("FE_WORKSPACE_ID")


def workspace_name() -> str:
    return need("FE_WORKSPACE_NAME")


def sqldb_item_id() -> str:
    return need("FE_SQLDB_ITEM_ID")


def model_id() -> str:
    return need("FE_MODEL_ID")


def sql_server() -> str:
    return need("FE_SQL_SERVER")


def sql_database() -> str:
    return need("FE_SQL_DATABASE")


def theme_source() -> pathlib.Path:
    """The Hochschul-Insights report the theme and background are taken from."""
    return pathlib.Path(need("FE_THEME_SOURCE"))


def resolve(text: str) -> str:
    """Replace every `{{FE_...}}` placeholder with its real value.

    ⚠️ Raises if one survives. A silent miss uploads a definition containing the
    literal string `{{FE_MODEL_ID}}`, which the service accepts and which then
    fails at query time, far away from the cause.
    """
    for token, var in PLACEHOLDERS.items():
        if token in text:
            text = text.replace(token, need(var))
    if "{{FE_" in text:
        raise SystemExit(f"unresolved placeholder in payload: {text[:200]}")
    return text
