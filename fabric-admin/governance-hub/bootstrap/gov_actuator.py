"""Gov Actuator — the single write path (PLAN.md §8.7, §14, Phase 8).

Percent-cell source. Build with `python bootstrap/build_ipynb.py`.

Every privileged write this product performs enters here. Nothing writes to a
control plane except through an executor registered in this notebook, and no
executor runs until all four gates have passed **server-side**.

Why the enforcement lives here and not in the app:

* The SPA can be opened with a debugger. `gov_config` can be read from a
  notebook, and only the notebook holds the service-principal secrets.
* The app's gate evaluation exists to *explain* a refusal before the click. It
  is a courtesy, not a control. This notebook re-decides from scratch, and its
  decision is the only one that matters.

Phase 8 shipped the framework with **no plane executors registered**. Phases 9–10
added the Entra, Fabric and Power Platform sets — all reversible, all with a
documented API, and the Power Platform set deliberately **licence-free**
(PLAN.md §8.5). A binding kind that still has no executor is refused with
`executor:not-implemented` and audited, which is the truthful answer for a plane
this build cannot write to. Returning `ok` would claim a grant that does not
exist — and the drift engine would then report the *platform* as wrong.
"""

# %% [markdown]
# # Gov Actuator
#
# **Input** (notebook parameters, JSON string `request_json`):
#
# ```json
# { "correlation_id": "...", "request_id": "...", "actor": "alkorn@...",
#   "dry_run": true,
#   "binding": { "kind": "entra_group_member", "module": "entra",
#                "target_id": "ws-pilot", "target_type": "Workspace",
#                "principal_id": "...", "role": "Contributor",
#                "writable": true } }
# ```
#
# **Output** (`exitValue`): the actuator contract —
# `{ ok, dry_run, before, after, verified, verify_after_s, detail, error }`.
#
# A refused call returns `ok:false` with `error:"gate:<name>"` **and still writes
# `gov_audit`**. A refusal nobody recorded is indistinguishable from a write that
# never happened.

# %% tags=["parameters"]
lakehouse_name = "governance_lh"
request_json = "{}"
# Escape hatch for a customer running the notebook by hand: it changes nothing
# about the gates, only whether the audit row is persisted.
persist_audit = True
# Power Platform writes authenticate as the registered management app. A human
# Power Platform Administrator must have run `New-PowerAppManagementApp` once —
# a service principal cannot register itself.
key_vault_uri = ""
sp_client_id_secret = "gov-pp-client-id"
sp_secret_secret = "gov-pp-secret"
tenant_id = ""

# %%
#@include collectors/shape_common.py

# %%
#@include collectors/runtime.py

# %%
#@include collectors/gates.py

# %%
#@include collectors/executors.py

# %%
#@include collectors/executors_pp.py

# %%
#@include collectors/actuator.py

# %%
import json

try:
    import notebookutils  # type: ignore
except ImportError:  # pragma: no cover - local syntax checks
    notebookutils = None

try:
    spark  # type: ignore[name-defined]
except NameError:  # pragma: no cover - local syntax checks
    spark = None

steps = []


def log(step, status, detail=""):
    steps.append({"step": step, "status": status, "detail": detail})
    print(f"[{status:>22}] {step}{(' — ' + detail) if detail else ''}")


request = json.loads(request_json or "{}")
binding = request.get("binding") or {}
log(
    "request",
    "Parsed",
    f"kind={binding.get('kind')} scope={binding.get('target_id')} "
    f"dry_run={request.get('dry_run', True)}",
)

# %% [markdown]
# ## Read the gate configuration — from the lakehouse, never from the caller
#
# The request carries *what* to do. It never carries permission to do it: the
# configuration is read here, server-side, on every call. A caller that could
# supply its own `writes_enabled` would have no gates at all.

# %%
def _config_value(key, default):
    if spark is None:
        return default
    try:
        rows = spark.sql(
            f"SELECT config_value FROM {lakehouse_name}.gov_config "  # noqa: S608 - fixed table
            f"WHERE config_key = '{key}'"
        ).collect()
    except Exception as exc:  # noqa: BLE001
        log(f"config:{key}", "Failed", f"{type(exc).__name__}: {exc}")
        return default
    if not rows:
        return default
    try:
        return json.loads(rows[0]["config_value"])
    except (TypeError, ValueError):
        return rows[0]["config_value"]


config = {
    "writes_enabled": bool(_config_value("writes.enabled", False)),
    "armed_kinds": _config_value("writes.kinds", []) or [],
    "scope_allowlist": _config_value("writes.scopeAllowlist", []) or [],
    "enabled_modules": _config_value("modules.enabled", []) or [],
}
log(
    "config",
    "Read",
    f"writes_enabled={config['writes_enabled']} "
    f"kinds={len(config['armed_kinds'])} scopes={len(config['scope_allowlist'])}",
)

# %% [markdown]
# ## Gate 4 evidence — prior successful dry runs
#
# Read narrowly: this binding kind, this scope, inside the 30-day window. Gate 4
# is what turns *"we tested it"* from a claim into a machine fact.

# %%
dry_runs = []
if spark is not None:
    try:
        rows = spark.sql(
            f"SELECT binding_kind, scope_id, succeeded_at "  # noqa: S608 - fixed table
            f"FROM {lakehouse_name}.gov_dry_runs"
        ).collect()
        dry_runs = [
            {
                "binding_kind": r["binding_kind"],
                "scope_id": r["scope_id"],
                "succeeded_at": r["succeeded_at"],
            }
            for r in rows
        ]
    except Exception as exc:  # noqa: BLE001
        # An unreadable ledger must fail *closed*: no evidence means no write.
        log("dry_runs", "Failed", f"{type(exc).__name__}: {exc}")
log("dry_runs", "Read", f"{len(dry_runs)} recorded")

# %% [markdown]
# ## Executors
#
# Only the executors whose transport actually exists are registered. A
# registered executor with no credential would fail at the HTTP call and be
# audited as `executor:failed` — which reads like the plane rejected us. Leaving
# it unregistered produces `executor:not-implemented`, which is the truth: this
# deployment cannot write there.
#
# The Power Platform set is the **licence-free** one (PLAN.md §8.5): environment
# security group, Dataverse role via a group team, data policy, tenant isolation
# and the environment-creation tenant settings. `pp_managed_env` is deliberately
# **not** registered — enabling Managed Environments makes premium licences a
# requirement for active usage, and a governance tool must never trigger that as
# a side effect of granting somebody access.

# %%
graph_http = None
fabric_http = None
bap_http = None
dataverse_http = None

try:
    _graph_token = graph_token()
    graph_http = lambda method, url, body: graph_call(_graph_token, method, url, body)  # noqa: E731
    log("transport:graph", "Ready", "delegated token acquired")
except Exception as exc:  # noqa: BLE001
    log("transport:graph", "Unavailable", f"{type(exc).__name__}: {exc}")

try:
    _fabric_client = fabric_client()
    fabric_http = lambda method, url, body: fabric_call(  # noqa: E731
        _fabric_client, method, url.replace(FABRIC, ""), body
    )
    log("transport:fabric", "Ready", "sempy client")
except Exception as exc:  # noqa: BLE001
    log("transport:fabric", "Unavailable", f"{type(exc).__name__}: {exc}")


def _sp_token(resource):
    """Client-credentials token for the Power Platform management app.

    The FULL Key Vault URI is required — a short name fails with
    'Invalid vault uri' (learned in the Data Catalog build).
    """
    import urllib.parse
    import urllib.request

    client_id = notebookutils.credentials.getSecret(key_vault_uri, sp_client_id_secret)
    client_secret = notebookutils.credentials.getSecret(key_vault_uri, sp_secret_secret)
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": f"{resource}/.default",
            "grant_type": "client_credentials",
        }
    ).encode()
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    with urllib.request.urlopen(  # noqa: S310 - fixed host
        urllib.request.Request(url, data=data)
    ) as response:
        return json.loads(response.read().decode("utf-8"))["access_token"]


if key_vault_uri and tenant_id and notebookutils is not None:
    try:
        _bap_token = _sp_token("https://service.powerapps.com")
        bap_http = lambda method, url, body: graph_call(_bap_token, method, url, body)  # noqa: E731
        log("transport:bap", "Ready", "management app token")
    except Exception as exc:  # noqa: BLE001
        log("transport:bap", "Unavailable", f"{type(exc).__name__}: {exc}")

    # Dataverse is a *different* audience, per environment — so it is acquired
    # separately rather than assumed to work because BAP does.
    _env_url = (binding.get("environment_url") or "").rstrip("/")
    if _env_url:
        try:
            _dv_token = _sp_token(_env_url)
            dataverse_http = lambda method, url, body: graph_call(  # noqa: E731
                _dv_token, method, url, body
            )
            log("transport:dataverse", "Ready", _env_url)
        except Exception as exc:  # noqa: BLE001
            log("transport:dataverse", "Unavailable", f"{type(exc).__name__}: {exc}")
else:
    log("transport:pp", "Unavailable", "key_vault_uri / tenant_id not configured")

EXECUTORS = build_executors(graph_http, fabric_http)
EXECUTORS.update(build_pp_executors(bap_http, dataverse_http))

log("executors", "Registered", ", ".join(sorted(EXECUTORS)) or "none (framework only)")

# %% [markdown]
# ## Decide, execute, audit
#
# `run_actuator` is pure and unit-tested offline. This cell is only IO.

# %%
outcome = run_actuator(request, config, dry_runs, EXECUTORS)
audit_row = outcome["audit"]
log("decision", audit_row["outcome"], outcome["result"].get("error") or "")

if persist_audit and spark is not None:
    try:
        spark.createDataFrame([audit_row]).write.mode("append").option(
            "mergeSchema", "true"
        ).saveAsTable(f"{lakehouse_name}.gov_audit")
        log("gov_audit", "Appended", audit_row["audit_id"])
    except Exception as exc:  # noqa: BLE001
        log("gov_audit", "Failed", f"{type(exc).__name__}: {exc}")

if outcome["dry_run_row"] is not None and spark is not None:
    try:
        spark.createDataFrame([outcome["dry_run_row"]]).write.mode("append").option(
            "mergeSchema", "true"
        ).saveAsTable(f"{lakehouse_name}.gov_dry_runs")
        log("gov_dry_runs", "Appended", "gate 4 credit granted")
    except Exception as exc:  # noqa: BLE001
        log("gov_dry_runs", "Failed", f"{type(exc).__name__}: {exc}")

# %%
exit_value = json.dumps(outcome["result"], default=str)
print(exit_value)
if notebookutils is not None:
    notebookutils.notebook.exit(exit_value)
