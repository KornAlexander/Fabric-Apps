"""Publish every Fabric item in this folder to a target workspace.

Environment variables
---------------------
Required
    FABRIC_WORKSPACE_ID          Target workspace GUID.

Authentication (pick one)
    AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
                                 Service principal (used by CI).
    (none)                       Falls back to DefaultAzureCredential, i.e. the
                                 current `az login` session for local runs.

Optional
    FABRIC_ENVIRONMENT           Environment key for parameter.yml. Default DEV.
    SKIP_UNPUBLISH               Set to 1 to keep orphaned items in the target.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from azure.identity import ClientSecretCredential, DefaultAzureCredential
from fabric_cicd import FabricWorkspace, publish_all_items, unpublish_all_orphan_items

HERE = Path(__file__).resolve().parent

# Everything the solution is made of. Order does not matter - fabric-cicd
# resolves inter-item dependencies itself.
ITEM_TYPES = [
    "Lakehouse",
    "Eventhouse",
    "KQLDatabase",
    "KQLQueryset",
    "KQLDashboard",
    "Eventstream",
    "Notebook",
]


def build_credential():
    sp_vars = ("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET")
    if all(os.environ.get(v) for v in sp_vars):
        return ClientSecretCredential(
            tenant_id=os.environ["AZURE_TENANT_ID"],
            client_id=os.environ["AZURE_CLIENT_ID"],
            client_secret=os.environ["AZURE_CLIENT_SECRET"],
        )
    print("No service principal in environment - using DefaultAzureCredential.")
    return DefaultAzureCredential()


def parameter_file() -> Path | None:
    """Path to parameter.yml, or None when it is absent."""
    source = HERE / "parameter.yml"
    return source if source.is_file() else None


def main() -> None:
    workspace_id = os.environ.get("FABRIC_WORKSPACE_ID")
    if not workspace_id:
        sys.exit("Missing required environment variable: FABRIC_WORKSPACE_ID")

    workspace = FabricWorkspace(
        workspace_id=workspace_id,
        environment=os.environ.get("FABRIC_ENVIRONMENT", "DEV"),
        repository_directory=str(HERE),
        item_type_in_scope=ITEM_TYPES,
        token_credential=build_credential(),
        parameter_file_path=str(parameter_file() or ""),
    )

    publish_all_items(workspace)

    if os.environ.get("SKIP_UNPUBLISH") != "1":
        unpublish_all_orphan_items(workspace)


if __name__ == "__main__":
    main()

