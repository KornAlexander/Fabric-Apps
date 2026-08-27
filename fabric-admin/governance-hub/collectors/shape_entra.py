"""M-ENTRA shaping (PLAN.md §12.2, §15).

Entra is the compiler's target instruction set, so the correctness that matters
most here is **effective** membership: nested groups mean the person who can
create a Fabric data agent is often three hops away from the group the
entitlement was written against.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

try:
    from .shape_common import as_json, as_str
except ImportError:  # pragma: no cover - notebook path
    from shape_common import as_json, as_str  # type: ignore


#: Groups the app created and therefore may manage. Anything else is read-only
#: to us — a governance tool that edits groups it did not create is a liability.
APP_MANAGED_PREFIX = "GOV-"


def shape_groups(payload: dict[str, Any]) -> list[dict]:
    rows: list[dict] = []
    for group in payload.get("value", []) or []:
        name = as_str(group.get("displayName")) or ""
        types = group.get("groupTypes") or []
        rows.append(
            {
                "group_id": as_str(group.get("id")),
                "display_name": name,
                "mail": as_str(group.get("mail")),
                "group_type": "Microsoft365" if "Unified" in types else "Security",
                "security_enabled": as_str(group.get("securityEnabled")),
                "is_app_managed": as_str(name.startswith(APP_MANAGED_PREFIX)),
                "description": as_str(group.get("description")),
            }
        )
    return rows


def shape_group_members(group_id: str, payload: dict[str, Any]) -> list[dict]:
    """Direct members of one group.

    `#microsoft.graph.group` members are nested groups — kept, because they are
    edges in the membership graph, not leaves.
    """
    rows: list[dict] = []
    for member in payload.get("value", []) or []:
        odata_type = str(member.get("@odata.type", ""))
        if odata_type.endswith("user"):
            principal_type = "User"
        elif odata_type.endswith("group"):
            principal_type = "Group"
        elif odata_type.endswith("servicePrincipal"):
            principal_type = "ServicePrincipal"
        else:
            principal_type = "Other"
        rows.append(
            {
                "group_id": as_str(group_id),
                "principal_id": as_str(member.get("id")),
                "principal_type": principal_type,
                "principal_name": as_str(
                    member.get("displayName") or member.get("userPrincipalName")
                ),
                "is_transitive": "false",
            }
        )
    return rows


def resolve_transitive_members(
    direct: dict[str, list[dict]],
    *,
    max_depth: int = 20,
) -> list[dict]:
    """Expand nested groups into effective membership.

    `direct` maps group_id → its direct member rows.

    Returns one row per (group, effective principal), with `is_transitive`
    marking members that are only reachable through a nested group and `depth`
    recording how far away they are.

    Cycles are survivable: Entra permits them and a naive walk would hang. The
    visited-set is per starting group, and `max_depth` is a second belt.
    """
    resolved: list[dict] = []

    for root, _ in direct.items():
        seen_groups: set[str] = {root}
        # (group_to_expand, depth_of_its_members)
        frontier: list[tuple[str, int]] = [(root, 0)]
        seen_principals: set[str] = set()

        while frontier:
            current, depth = frontier.pop(0)
            if depth > max_depth:
                break
            for member in direct.get(current, []):
                principal_id = member.get("principal_id")
                if not principal_id:
                    continue
                principal_type = member.get("principal_type")

                if principal_type == "Group":
                    if principal_id not in seen_groups:
                        seen_groups.add(principal_id)
                        frontier.append((principal_id, depth + 1))
                    # A nested group is itself a member — keep the edge.
                if principal_id in seen_principals:
                    continue
                seen_principals.add(principal_id)
                resolved.append(
                    {
                        "group_id": root,
                        "principal_id": principal_id,
                        "principal_type": principal_type,
                        "principal_name": member.get("principal_name"),
                        "is_transitive": as_str(depth > 0),
                        "depth": as_str(depth),
                    }
                )

    return resolved


def shape_licenses(
    users_payload: dict[str, Any],
    sku_names: dict[str, str] | None = None,
) -> list[dict]:
    """User → licence rows.

    `assigned_via` distinguishes a direct assignment from group-based licensing,
    because only the latter is something an entitlement can compile onto.
    """
    names = sku_names or {}
    rows: list[dict] = []
    for user in users_payload.get("value", []) or []:
        user_id = as_str(user.get("id"))
        states = {
            str(s.get("skuId")): s
            for s in (user.get("licenseAssignmentStates") or [])
            if s.get("skuId")
        }
        for licence in user.get("assignedLicenses") or []:
            sku_id = as_str(licence.get("skuId"))
            state = states.get(str(sku_id), {})
            assigned_by_group = state.get("assignedByGroup")
            rows.append(
                {
                    "principal_id": user_id,
                    "principal_name": as_str(
                        user.get("userPrincipalName") or user.get("displayName")
                    ),
                    "sku_id": sku_id,
                    "sku_name": as_str(names.get(str(sku_id))),
                    "assigned_via": "Group" if assigned_by_group else "Direct",
                    "group_id": as_str(assigned_by_group),
                    "disabled_plans_json": as_json(licence.get("disabledPlans") or []),
                }
            )
    return rows


def index_sku_names(payload: dict[str, Any]) -> dict[str, str]:
    """`GET /v1.0/subscribedSkus` → {skuId: skuPartNumber}."""
    return {
        str(sku.get("skuId")): str(sku.get("skuPartNumber"))
        for sku in payload.get("value", []) or []
        if sku.get("skuId")
    }


def paged(
    fetch: Callable[[str], dict[str, Any]],
    first_url: str,
    *,
    max_pages: int = 50,
) -> Iterable[dict[str, Any]]:
    """Follow `@odata.nextLink`, with a hard page cap.

    An unbounded follow against a large directory is how a nightly job becomes a
    six-hour job; the cap is reported by the caller as a partial run rather than
    silently truncating.
    """
    url = first_url
    for _ in range(max_pages):
        payload = fetch(url)
        yield payload
        url = payload.get("@odata.nextLink")
        if not url:
            return
