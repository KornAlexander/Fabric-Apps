"""Plane executors — the first two 🟢 preventive-auto bindings (PLAN.md §14, Phase 9).

`entra_group_member` and `fabric_workspace_role`: both reversible, both with a
documented API, both the currency the rest of the model compiles onto.

Every executor obeys the same three rules, and they are all learned from real
failures rather than invented:

* **Read before write.** Re-running a grant must be a no-op, never a duplicate.
  A duplicate role assignment is not harmless — it makes the later revoke
  ambiguous.
* **Report what was already true.** `already_present` is a success, but it is a
  *different* success from `created`, and the audit row must be able to tell an
  auditor which one happened.
* **Never claim verification.** An executor returns `verified: False` and a
  `verify_after_s` hint. Confirmation comes from re-reading the plane later
  (PLAN.md §14) — "the API returned 200" is not evidence that a tenant setting
  took effect.

Pure orchestration: the HTTP callable is injected, so all of this is tested
offline against fakes.
"""

from __future__ import annotations

from typing import Any, Callable

#: `(method, url, body) -> dict`. Injected so the executors never import a
#: transport and can be tested without one.
HttpCall = Callable[[str, str, dict | None], Any]

GRAPH = "https://graph.microsoft.com/v1.0"
FABRIC = "https://api.fabric.microsoft.com/v1"

#: Fabric workspace roles this tool will assign. `Admin` is absent on purpose
#: and is *also* blocked by the gate invariants — belt and braces, because this
#: is the one mistake that cannot be undone by the tool itself.
FABRIC_ROLES = ("Viewer", "Contributor", "Member")

#: How long before a verify pass should run. Group membership propagates fast;
#: workspace roles are read-your-writes but the app's collector is not.
VERIFY_AFTER_S = 900


def _need(binding: dict, *keys: str) -> None:
    missing = [k for k in keys if not binding.get(k)]
    if missing:
        raise ValueError(f"binding is missing {', '.join(missing)}")


def entra_group_member(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Add a principal to an Entra security group.

    The group is the one currency all four planes accept, so most entitlements
    reduce to exactly this call.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "target_id", "principal_id")
        group_id = binding["target_id"]
        principal_id = binding["principal_id"]

        # Read first: `POST /members/$ref` on an existing member returns 400
        # "One or more added object references already exist", which is
        # indistinguishable from a real failure at the call site.
        members = http("GET", f"{GRAPH}/groups/{group_id}/members?$select=id&$top=999", None)
        existing = {m.get("id") for m in (members or {}).get("value", []) or []}
        already = principal_id in existing

        before = {"is_member": already}
        if already:
            return {
                "ok": True,
                "before": before,
                "after": {"is_member": True},
                "detail": "already_present",
                "verified": True,  # we just read it — this one really is proven
            }

        if dry_run:
            return {
                "ok": True,
                "before": before,
                "after": {"is_member": True, "planned": True},
                "detail": f"would POST {GRAPH}/groups/{group_id}/members/$ref",
            }

        http(
            "POST",
            f"{GRAPH}/groups/{group_id}/members/$ref",
            {"@odata.id": f"{GRAPH}/directoryObjects/{principal_id}"},
        )
        return {
            "ok": True,
            "before": before,
            "after": {"is_member": True},
            "detail": "created",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def fabric_workspace_role(http: HttpCall) -> Callable[[dict, bool], dict]:
    """Assign a workspace role to a principal (usually a group).

    Fabric has no per-item-type role, so `Contributor` here grants every create
    capability not separately gated by a tenant setting. That is a documented
    platform property, and the entitlement model already accounts for it — but
    it is why this executor refuses to invent a role it was not given.
    """

    def execute(binding: dict, dry_run: bool) -> dict:
        _need(binding, "target_id", "principal_id", "role")
        workspace_id = binding["target_id"]
        principal_id = binding["principal_id"]
        role = binding["role"]
        principal_type = binding.get("principal_type") or "Group"

        if role not in FABRIC_ROLES:
            # Includes `Admin`. The gates refuse it too; this is the second lock.
            return {
                "ok": False,
                "error": f"role:{role} is not assignable by this tool",
                "detail": f"allowed roles: {', '.join(FABRIC_ROLES)}",
            }

        assignments = http(
            "GET", f"{FABRIC}/workspaces/{workspace_id}/roleAssignments", None
        )
        current = None
        for entry in (assignments or {}).get("value", []) or []:
            if ((entry.get("principal") or {}).get("id")) == principal_id:
                current = entry
                break

        before = {"role": current.get("role") if current else None}

        if current and current.get("role") == role:
            return {
                "ok": True,
                "before": before,
                "after": {"role": role},
                "detail": "already_present",
                "verified": True,
            }

        # A principal can hold only one role per workspace, so a change is a
        # PATCH of the existing assignment — POSTing again returns a conflict.
        if current:
            method, url, body = (
                "PATCH",
                f"{FABRIC}/workspaces/{workspace_id}/roleAssignments/{current.get('id')}",
                {"role": role},
            )
        else:
            method, url, body = (
                "POST",
                f"{FABRIC}/workspaces/{workspace_id}/roleAssignments",
                {"principal": {"id": principal_id, "type": principal_type}, "role": role},
            )

        if dry_run:
            return {
                "ok": True,
                "before": before,
                "after": {"role": role, "planned": True},
                "detail": f"would {method} {url}",
            }

        http(method, url, body)
        return {
            "ok": True,
            "before": before,
            "after": {"role": role},
            "detail": "changed" if current else "created",
            "verified": False,
            "verify_after_s": VERIFY_AFTER_S,
        }

    return execute


def build_executors(graph_http: HttpCall | None, fabric_http: HttpCall | None) -> dict:
    """Register only the executors whose transport actually exists.

    A registered executor with no credential would fail at the HTTP call and be
    audited as `executor:failed` — which reads like the plane rejected us. Not
    registering it produces `executor:not-implemented`, which is the truth: this
    deployment cannot write there.
    """
    executors: dict[str, Callable[[dict, bool], dict]] = {}
    if graph_http is not None:
        executors["entra_group_member"] = entra_group_member(graph_http)
    if fabric_http is not None:
        executors["fabric_workspace_role"] = fabric_workspace_role(fabric_http)
    return executors