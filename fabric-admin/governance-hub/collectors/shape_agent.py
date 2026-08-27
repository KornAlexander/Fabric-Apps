"""M-AGENT shaping (PLAN.md §7, §12.2).

Three sources, one table. Precedence matters:

  1. **Agent 365 registry** — the widest view, but preview API, needs AI
     Administrator, and does not show draft agents outside Copilot Studio.
  2. **Entra Agent ID** — identities, blueprints and the mandatory human sponsor.
  3. **Dataverse `bot` table** — the Copilot Studio truth, including drafts, and
     the fallback when the tenant has no Agent 365 licence.

Merging them is where the honesty lives: an agent seen only by the registry and
not by any of our governed sources is a **shadow agent**, and an agent with no
owner or sponsor is `is_ownerless` — both are Critical findings, and neither is
discoverable from a single source.
"""

from __future__ import annotations

from typing import Any, Iterable

try:
    from .shape_common import as_json, as_str
except ImportError:  # pragma: no cover - notebook path
    from shape_common import as_json, as_str  # type: ignore


#: Registry platform strings → our normalised platform.
PLATFORM_MAP = {
    "mcs": "CopilotStudio",
    "copilotstudio": "CopilotStudio",
    "agentbuilder": "AgentBuilder",
    "declarative": "AgentBuilder",
    "sharepoint": "SharePoint",
    "foundry": "Foundry",
    "toolkit": "ToolkitSDK",
}

#: Third-party platforms Registry sync supports today. Anything else that shows
#: up is unmanaged by definition.
SYNCED_THIRD_PARTY = {"bedrock", "vertex", "agentforce", "genie"}


def normalise_platform(raw: str | None) -> str:
    if not raw:
        return "Unknown"
    value = raw.strip().lower().replace(" ", "").replace("-", "")
    for needle, platform in PLATFORM_MAP.items():
        if needle in value:
            return platform
    for needle in SYNCED_THIRD_PARTY:
        if needle in value:
            return "ThirdParty"
    return "Unknown"


def shape_registry_agents(payload: dict[str, Any]) -> list[dict]:
    """Agent 365 registry (`List Copilot packages`, preview)."""
    rows: list[dict] = []
    for pkg in payload.get("value", []) or []:
        owner = pkg.get("owner") or {}
        rows.append(
            {
                "agent_id": as_str(pkg.get("id")),
                "name": as_str(pkg.get("displayName") or pkg.get("name")),
                "platform": normalise_platform(
                    as_str(pkg.get("platform") or pkg.get("agentType"))
                ),
                "source": "A365Registry",
                "state": as_str(pkg.get("state") or pkg.get("publishingState")),
                "owner_principal": as_str(
                    owner.get("id") or owner.get("userPrincipalName") or pkg.get("ownerId")
                ),
                "sponsor_principal": None,
                "blueprint_id": None,
                "agent_identity_id": as_str(pkg.get("agentIdentityId")),
                "environment_id": as_str(pkg.get("environmentId")),
                "risk_flags_json": as_json(pkg.get("risks")),
                "created_at": as_str(pkg.get("createdDateTime")),
            }
        )
    return rows


def shape_agent_identities(payload: dict[str, Any]) -> list[dict]:
    """Entra `agentIdentity` service principals.

    Every agent identity requires a human sponsor; if the sponsor leaves,
    sponsorship transfers to their manager. A missing sponsor is therefore not a
    data-quality problem, it is a governance finding.
    """
    rows: list[dict] = []
    for identity in payload.get("value", []) or []:
        sponsors = identity.get("sponsors") or []
        sponsor = sponsors[0] if sponsors else identity.get("sponsor")
        rows.append(
            {
                "agent_id": as_str(identity.get("id")),
                "name": as_str(identity.get("displayName")),
                "platform": normalise_platform(as_str(identity.get("agentIdentityType"))),
                "source": "EntraAgentID",
                "state": as_str(
                    "Disabled" if identity.get("accountEnabled") is False else "Published"
                ),
                "owner_principal": as_str((identity.get("owners") or [{}])[0].get("id"))
                if identity.get("owners")
                else None,
                "sponsor_principal": as_str(
                    sponsor.get("id") if isinstance(sponsor, dict) else sponsor
                ),
                "blueprint_id": as_str(identity.get("agentIdentityBlueprintId")),
                "agent_identity_id": as_str(identity.get("id")),
                "environment_id": None,
                "risk_flags_json": None,
                "created_at": as_str(identity.get("createdDateTime")),
            }
        )
    return rows


def shape_blueprints(payload: dict[str, Any]) -> list[dict]:
    rows: list[dict] = []
    for blueprint in payload.get("value", []) or []:
        name = as_str(blueprint.get("displayName")) or ""
        rows.append(
            {
                "blueprint_id": as_str(blueprint.get("id")),
                "display_name": name,
                "is_multitenant": as_str(
                    blueprint.get("signInAudience") not in (None, "AzureADMyOrg")
                ),
                "sponsor_principal": as_str(
                    ((blueprint.get("sponsors") or [{}])[0] or {}).get("id")
                ),
                "granted_permissions_json": as_json(
                    blueprint.get("requiredResourceAccess")
                ),
                "is_app_managed": as_str(name.startswith("GOV-")),
            }
        )
    return rows


def shape_dataverse_bots(environment_id: str, payload: dict[str, Any]) -> list[dict]:
    """Copilot Studio agents from the Dataverse `bot` table.

    This is the **licence-free fallback**: it needs no Agent 365 entitlement, and
    it is the only source that sees *draft* agents.
    """
    rows: list[dict] = []
    for bot in payload.get("value", []) or []:
        published = bot.get("publishedon")
        rows.append(
            {
                "agent_id": as_str(bot.get("botid")),
                "name": as_str(bot.get("name") or bot.get("schemaname")),
                "platform": "CopilotStudio",
                "source": "Dataverse",
                "state": "Published" if published else "Draft",
                "owner_principal": as_str(bot.get("_ownerid_value")),
                "sponsor_principal": None,
                "blueprint_id": None,
                "agent_identity_id": None,
                "environment_id": as_str(environment_id),
                "risk_flags_json": None,
                "created_at": as_str(bot.get("createdon")),
            }
        )
    return rows


#: Source precedence when the same agent is seen more than once. The registry
#: has the widest metadata; Dataverse is authoritative for Copilot Studio state
#: (it is the only source that distinguishes Draft).
_SOURCE_RANK = {"A365Registry": 3, "EntraAgentID": 2, "Dataverse": 1}


def _key(row: dict) -> str:
    return (
        as_str(row.get("agent_identity_id"))
        or as_str(row.get("agent_id"))
        or f"name:{as_str(row.get('name'))}"
    )


def merge_agents(*sources: Iterable[dict]) -> list[dict]:
    """Merge agent rows from every source into one deduplicated inventory.

    Rules:
      * merge on agent identity id when present, else agent id, else name
      * higher-ranked sources win on conflicting scalars, but a **non-empty**
        value always beats an empty one — a sponsor known only to Entra must not
        be erased by a registry row that omits it
      * `sources_json` records every source that saw the agent, which is what
        makes shadow detection possible
    """
    merged: dict[str, dict] = {}
    seen_sources: dict[str, set[str]] = {}

    for source in sources:
        for row in source:
            key = _key(row)
            seen_sources.setdefault(key, set()).add(str(row.get("source")))
            existing = merged.get(key)
            if existing is None:
                merged[key] = dict(row)
                continue

            incoming_rank = _SOURCE_RANK.get(str(row.get("source")), 0)
            existing_rank = _SOURCE_RANK.get(str(existing.get("source")), 0)
            for field, value in row.items():
                if value in (None, ""):
                    continue
                if existing.get(field) in (None, "") or incoming_rank > existing_rank:
                    existing[field] = value
            if incoming_rank > existing_rank:
                existing["source"] = row.get("source")

    out: list[dict] = []
    for key, row in merged.items():
        sources_seen = sorted(seen_sources.get(key, set()))
        owner = row.get("owner_principal")
        sponsor = row.get("sponsor_principal")
        row["sources_json"] = as_json(sources_seen)
        # Seen only by the tenant-wide registry and by none of the sources we
        # actually govern → nobody here provisioned it.
        row["is_shadow"] = as_str(sources_seen == ["A365Registry"])
        row["is_ownerless"] = as_str(not owner and not sponsor)
        out.append(row)

    return sorted(out, key=lambda r: (str(r.get("name") or ""), str(r.get("agent_id") or "")))
