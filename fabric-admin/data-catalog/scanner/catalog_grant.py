# Fabric notebook source
# Catalog Grant — fulfils an approved access request by granting a workspace
# role under the Data Catalog Grant service principal, using Andreas Rederer's
# msfabricpysdkcore (github.com/DaSenf1860/ms-fabric-sdk-core, MIT). This is the
# same mechanism as DaSenf1860/fabricplatformgovernance's /approve route.
#
# The SP client secret is read from Azure Key Vault at run time — it is never in
# the app, the notebook, or git. Convert with build_ipynb.py.

# %% [markdown]
# # Catalog Grant (service-principal fulfilment)
#
# Grants `role` to `principal_id` on `workspace_id`. Requires:
# 1. The tenant setting **"Service principals can use Fabric APIs"** enabled.
# 2. The grant SP added as **Admin** on the target workspace.
# 3. The runner having **get** access to the Key Vault secret.

# %% tags=["parameters"]
workspace_id = ""
principal_id = ""
principal_type = "User"          # User | ServicePrincipal | Group
role = "Viewer"                   # Viewer | Contributor | Member | Admin
kv_name = os.environ["KEY_VAULT_URL"]
secret_name = "grant-sp-secret"
client_id = os.environ["APP_CLIENT_ID"]
tenant_id = "${FABRIC_TENANT_ID}"

# %%
try:
    import msfabricpysdkcore  # noqa: F401
except ImportError:
    import importlib
    import subprocess
    import sys

    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "msfabricpysdkcore"],
        check=True,
    )
    importlib.invalidate_caches()

# %%
import json

import notebookutils

result = {"ok": False, "detail": ""}
try:
    if not workspace_id or not principal_id:
        raise ValueError("workspace_id and principal_id are required")
    if role == "Admin":
        # Safety: never let the automated path grant Admin.
        raise ValueError("Admin grants must be performed manually")

    client_secret = notebookutils.credentials.getSecret(kv_name, secret_name)

    from msfabricpysdkcore import FabricClientCore

    fcc = FabricClientCore(
        tenant_id=tenant_id, client_id=client_id, client_secret=client_secret
    )
    fcc.add_workspace_role_assignment(
        workspace_id=workspace_id,
        principal={"id": principal_id, "type": principal_type},
        role=role,
    )
    result = {
        "ok": True,
        "detail": f"Granted {role} to {principal_type} {principal_id} on workspace {workspace_id}",
    }
except Exception as exc:  # noqa: BLE001
    import traceback

    result = {"ok": False, "detail": str(exc)[:600], "trace": traceback.format_exc()[-600:]}

print(result)

# %%
notebookutils.notebook.exit(json.dumps(result))
