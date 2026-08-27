# Governance Hub

**Who may create what, where — and why.**

<!-- TODO(phase-1e): no preview yet. Once `docs/previews/governance-hub.webp` exists, replace this comment with:
     ![Governance Hub](../../docs/previews/governance-hub.webp) -->

A self-hosted governance accelerator for Microsoft 365, Fabric and Power Platform.
It answers one question no single Microsoft admin surface can answer today:

> *Who, right now, can create a Copilot Studio agent / a Power App / a Fabric App /
> a Fabric data agent / a Power BI report — and who said they could?*

Built as a **Fabric App** (Rayfin). Deployed into **your** tenant. Your data never leaves it.

> **Status: Phases 1–11 of 17.** The module contract, setup pre-flight, bootstrap, **T0
> degraded mode with a live Inventory**, the **four server-side collectors**, the
> **Governance Model read path with module-owned pages**, the **entitlement model with a
> Personas & Recipes editor**, the **Can-Do Explorer**, the **drift engine, the
> `POL-001…027` policy pack, the Entitlements store and the Default-environment posture
> score**, the **server-side write-gate framework with an audit trail**,
> **Requests → Approvals → verification**, the **licence-free Power Platform actuator set**,
> and the **manual task queue** are implemented and tested.
> Seven binding kinds can be written: Entra group membership, Fabric workspace role, and the
> five Power Platform ones. The five with no write API become guided tasks instead.
> See PLAN.md §17 for the full roadmap.
>
> Everything is verified **offline**: the logic is unit-tested against fixtures and the
> collectors are inlined into the notebooks verbatim. Nothing has executed against a real
> tenant yet — that needs the admin prerequisites below.

---

## What it does

- Tenant settings and their propagation delay, collected on a schedule
- Capacity and workspace posture in one view
- Power Platform environments alongside Fabric, because nobody asks about only one
- Collector notebooks that hold no secrets - everything resolves at run time

## Why this exists

Creation rights for those artifacts live in **four different control planes** with
incompatible granularity — and several of them have **no preventive control at all**:

| | Fact |
|---|---|
| 🔴 | **Copilot Studio agent creation cannot be disabled.** Microsoft's documented mitigation is to block *usage* via data policies. |
| 🔴 | **Fabric has no per-item-type workspace role.** A Contributor can create every item type not separately gated by a tenant setting. |
| 🟡 | **Org App audience membership has no public write API.** Portal only. |
| 🟡 | **M365 Copilot agent controls are admin-center only.** No documented API. |
| ⚠️ | **Fabric tenant settings are explicitly "not a security measure"** — Microsoft's own words. |

So this tool does not pretend to be a universal enforcement engine. It is an
**entitlement system of record** that compiles a human-readable model —
*"Alex is a Report Author in Finance"* — into the concrete bindings each plane
understands, writes them where an API exists, raises a guided task where it does
not, and then **continuously verifies that reality still matches the model**.

Every capability in the UI carries its honest control mode:

| Badge | Meaning |
|---|---|
| 🟢 **Preventive-automated** | The app writes the control. Creation is actually gated. |
| 🟡 **Preventive-manual** | The control exists, but portal-only → guided task + machine verification. |
| 🔴 **Detective only** | No preventive control exists → inventory, alert, clean-up. |

Being honest about this split *is* the product.

---

## The four modules

Switchable independently, in-app, live. The app must be useful with any subset —
including exactly one.

| Module | Covers | Needs |
|---|---|---|
| **M-FABRIC** | Tenant settings, capacity overrides, workspaces + roles, items by type, org apps + audiences | Fabric capacity; Fabric Admin for tenant-wide read |
| **M-PP** | Environments, Dataverse security roles + table privileges, data policies, environment-creation settings, maker inventory | An unlicensed Dataverse **application user** |
| **M-AGENT** | Agent 365 registry, Entra Agent ID, blueprints + sponsors, Copilot Studio `bot` privileges | Agent 365 licence (degrades gracefully without it) |
| **M-ENTRA** | Security groups, transitive membership, group-based licensing | Graph read |

**Entra is everyone's substrate.** Security groups are the one currency all four planes
accept, so the per-user write path is usually a single Graph call — not forty admin APIs.

---

## Licence position

**The Governance Hub itself needs no Power Apps, Power Automate or Copilot Studio licence,
and its Power Platform controls work without Managed Environments.** Verified against
Microsoft Learn:

- Dataverse **application users are unlicensed by design** — *"you can create an unlicensed
  application user"*; a service-principal app user *"can't have a user license associated with it"*.
- **Admins administer without a licence** — Global and Power Platform admins explicitly do
  not need one.
- Application users **bypass environment security groups**, so one app user reaches every
  environment without joining anything.
- **DLP has no licence prerequisite** and is absent from the licensing FAQ's
  "security and governance licensing requirements" list.
- Managed Environments licensing is tied to **active usage**, not membership.

What you genuinely lose without Managed Environments: default-environment routing,
environment groups, proactive sharing limits, solution-checker enforcement, usage
insights, IP firewall, and Power Platform pipelines. The app **reports exactly which of
these you are missing** rather than arguing about it. Details in PLAN.md §8.5.

> ⚠️ **The Default environment is the one real hole.** A security group **cannot** be
> bound to it, and `Basic User` + `Environment Maker` auto-assignment there **survives the
> opt-out**. There is no supported way to remove Environment Maker in Default. The app
> ships a dedicated posture view for the six licence-free hardening levers instead of
> pretending otherwise (§8.6).

---

## Reach tiers — start with no admin consent

The **default first-run experience needs no admin consent at all**. A tool that shows
something useful in the first five minutes is the one that gets a pilot.

| Tier | Identity | Reach | Unlocks |
|---|---|---|---|
| **T0 — Explore** *(default)* | your own token | only what you can already see | Setup, Inventory, partial Can-Do Explorer |
| **T1 — Observe** | + `SP-READ` with tenant-wide read | whole tenant, read-only | Drift, Policies, Simulation, Evidence export |
| **T2 — Act** | + `SP-FABRIC` / `SP-GRAPH` / `SP-PP` | writes, behind four gates | Requests → Approvals → automatic grant |

Every screen renders at T0 with an honest *"this view is limited"* banner — never an error.

---

## Safety model

This tool can, in later phases, grant workspace roles and Entra group membership. That
makes it a privilege-escalation primitive if built carelessly. So:

**Four write gates, all evaluated server-side in the actuator notebook — the browser's
opinion is never trusted:**

1. **Master kill switch** — ships `false`.
2. **Per binding kind** — ships with nothing armed.
3. **Per scope allow-list** — ships empty. A pilot runs against three workspaces, not a tenant.
4. **Prior successful dry run** for that kind × scope within 30 days — so *"we tested it"*
   is a machine fact, not a claim.

**Plus unconditional invariants no configuration can override:**

- `Admin`, `System Administrator`, `Owner`, `Global Administrator` are **never** granted.
- Unjustified access (`Extra` drift) is **never** auto-removed — that is how a governance
  tool takes production down at 03:00. Removal is always an explicit human decision.
- Every attempt writes an audit row, **including refusals**, with before/after JSON.
- Service principals cannot modify their own entitlements.
- No secrets in the SPA. The bundle is served anonymously; all secrets live in your
  Key Vault and are read only inside notebooks.
- **No telemetry.** `telemetry.enabled` exists as a config key purely so that
  "we send nothing" is auditable rather than asserted.

A permanent header chip shows `WRITES: OFF` or `ARMED: n kinds · m scopes`. Nobody should
ever have to guess whether this tool is live.

---

## What Phases 1–2 deliver

```
src/
  modules/            ← the module contract: types, registry, four plane modules
    types.ts            GovernanceModule, ModuleAvailability, InventoryResult, BindingKindDef
    index.ts            registry: compile-time flags, probes, collectors, tier maths
    fabric/ pp/ agent/ entra/
  domain/
    writeGates.ts     ← the four gates + invariants (pure, 20 tests)
    preflight.ts      ← pre-flight derivation (pure, 9 tests)
    inventoryView.ts  ← gap reporting, filtering, counting (pure)
    govSchema.ts      ← the table/column allow-list every DAX query is validated against
    dax.ts            ← injection-proof query construction (pure)
    capabilities.ts   ← what each creation right *is*, and how it compiles into a plane
    personas.ts       ← the shipped persona seed + override merge + the compiler
    effective.ts      ← the Can-Do engine: collected facts → who can do what, and why
  i18n/               ← EN/DE, key-parity enforced by test
  services/
    govConfig.ts      ← gov_config key/value store, conservative defaults
    udfClient.ts      ← fabric_proxy + Graph read hops
  hooks/
    GovernanceContext.tsx  ← config, live availability and inventory, one source of truth
  components/
    TierBadge.tsx · PartialViewBanner.tsx · WriteChip.tsx · CheckRow.tsx · StatusPill.tsx
  pages/
    SetupPage.tsx     ← live pre-flight, module status, bootstrap trigger
    InventoryPage.tsx ← live T0/T1 inventory with per-plane gap reporting
    SettingsPage.tsx  ← module toggles (the demo lever) + write-gate view
    DashboardPage.tsx ← honest placeholder
bootstrap/
  gov_bootstrap.py       ← idempotent provisioning, dry-run by default (schema v2)
  gov_create_model.py    ← Direct Lake semantic model over governance_lh
  gov_collect_fabric.py  ← tenant settings, workspaces, roles, items, org apps
  gov_collect_entra.py   ← groups, effective membership, group-based licensing
  gov_collect_pp.py      ← environments, Dataverse roles + privileges, DLP, resources
  gov_collect_agent.py   ← Agent 365 registry + Entra Agent ID + Dataverse bots, merged
  build_ipynb.py         ← percent-cell → .ipynb, with an #@include directive
collectors/
  shape_common.py  shape_fabric.py  shape_entra.py  shape_pp.py  shape_agent.py
  runtime.py             ← REST retry/backoff + Delta write helpers
  tests/                 ← 84 offline pytest tests
rayfin/data/
  GovConfig.ts, GovSchemaMigration.ts
```

### How the collectors are testable

The risky part of a collector is not the HTTP call — it is the **shaping**: which fields become
which columns, and which flags a governance decision later depends on. So all of that lives in
`collectors/shape_*.py` as pure Python with no Spark and no network, is unit tested offline, and
is then **inlined verbatim** into the notebooks by an `#@include` directive at build time.

The code that runs in your tenant is byte-for-byte the code the tests ran against, and a
structural test fails the build if a `.py` changed without `npm run notebooks` being re-run.

Three flags carry most of the value, and all three are documented Microsoft constraints:

| Flag | Why it matters |
|---|---|
| `is_customizable = false` on predefined roles | **Environment Maker cannot be edited.** Planning around editing it is planning to fail. |
| `security_group_assignable = false` on Default/Developer environments | Security groups **cannot** be bound there — the one hole the tool can only contain. |
| `membership_known = false` on org-app audiences | There is **no public API** for audience membership. The app must never imply it knows. |

### The T0 inventory

The Inventory page reads live with **your own token and no admin consent**:

| Plane | At T0 | At T1 |
|---|---|---|
| **Fabric** | your workspaces + their items (first 15 workspaces expanded) | tenant-wide admin list |
| **Entra** | your own group memberships | the directory |
| **Power Platform** | *nothing* — the admin APIs are not CORS-reachable from a browser | server-side collector |
| **Agents** | *nothing* — the Agent 365 registry needs AI Administrator | server-side collector |

The two "nothing" rows are the point. They render as **stated gaps with reasons**, not as
empty tables. A governance tool that silently truncates is worse than one that shows
nothing, because truncated data still looks like an answer.

### The entitlement model

An entitlement is *“this person is a **Report Author** in **Finance**”*. The compiler turns
that into the concrete bindings each plane understands:

```
persona report-author @ workspace Finance
  → entra_group_member(GOV-FAB-WS-Finance-Contributor)   per user   — one Graph call
  → fabric_workspace_role(Finance, Contributor)          per scope  — set once
```

**What is editable and what is not** is a deliberate split:

| | Editable? | Why |
|---|---|---|
| **Personas** | Yes, fully | “Report Author” means something different in every org |
| **Capabilities** | No — code | They encode which control *actually* gates creating a thing |
| **Binding recipes** | No — code | Being able to “fix” a documented impossibility would make the tool lie |

A capability whose module is switched off is **struck through with the reason**, never hidden.
Hiding it would make the persona look smaller than it is.

### The Can-Do Explorer

The headline view. It answers, from **collected reality** rather than from intent:

> *Who can create a Copilot Studio agent / a Power App / a Fabric data agent / a Power BI
> report — right now, and why?*

Every answer carries a **derivation path**, because an answer an admin cannot argue with is
one they will not act on:

```
Marcel can create:CopilotStudioAgent in environment "CoE"
  1. member of "GOV-PP-ENV-CoE-AgentAuthor"
  2. environment "CoE"
  3. role "Agent Author"
  4. role "Agent Author" has Create on bot (Organization)
```

Three behaviours matter more than the table itself:

| Behaviour | Why |
|---|---|
| **`Everyone` is a real answer** | A tenant setting enabled org-wide, or the Default environment where Environment Maker is auto-assigned and cannot be removed, genuinely grants to everybody. Rendering that as an empty list would be the most misleading thing this app could do. |
| **`Unknown` ≠ `nobody`** | M365 declarative agents are admin-center-only with no API. Reporting “nobody can” would be the opposite of the truth in most tenants. |
| **A failed source is announced** | If a table could not be read, the answer **under-reports access** — the dangerous direction for a governance answer to be wrong in — so the page says so instead of quietly returning less. |

## Drift, policies and the Default environment

**Entitlements** record who *should* hold which persona in which scope. Recording one changes
nothing in any control plane — it only describes intent, so the gap is visible long before a
write gate is armed.

**Drift** compares that intent against what the collectors actually found:

| Type | Meaning | Auto-fixable |
|---|---|---|
| `Missing` | entitled, but the capability is not held | yes — granting what was already approved |
| `Extra` | held, but no entitlement justifies it | **never** |
| `Blocked` | entitled and nominally granted, but a tenant setting blocks it | no |
| `Unknown` | held, but the platform cannot tell us whether it is effective | no |

> **`Extra` access is reported, never revoked automatically.** Auto-revoking is how a
> governance tool takes production down at 03:00. Removal is always an explicit human
> decision. This is asserted by test across every capability, not just documented here.

**Policies** ship as `POL-001…027`. Rules whose data is not collectable yet are listed as
**pending with the reason**, never silently skipped — a pack that quietly drops half its
rules produces a clean report and false comfort.

**Default-environment posture** scores the six containment levers that actually work for the
one environment whose membership cannot be controlled (a security group cannot be bound to
it, and `Basic User` + `Environment Maker` are auto-assigned in a way that survives the
opt-out). All six are **licence-free** and none needs Managed Environments. An un-run
collector scores `unknown`, never `fail`: not having looked is not evidence of a wide-open
tenant.

## The write path

Nothing in this app writes to a control plane. Every privileged change goes through one
Fabric notebook — `Gov Actuator` — which re-evaluates **all four gates server-side** on every
call:

| Gate | Ships as | Refusal |
|---|---|---|
| 1 · master switch | **off** | `gate:master` |
| 2 · armed binding kind | **none armed** | `gate:kind` |
| 3 · scope allow-list | **empty** | `gate:scope` |
| 4 · a successful dry run for this kind × scope in the last 30 days | **no evidence** | `gate:dryRun` |

Plus invariants no configuration can override: `Admin` / `Owner` / `System Administrator` /
`Global Administrator` are never granted, a switched-off module cannot be written to, and a
manual-only binding kind is never written however hard someone arms it.

Three properties are worth stating plainly, because a customer security team will ask:

- **The app cannot grant itself permission.** The gate configuration is read from
  `gov_config` *inside* the notebook. The app's own evaluation exists only to explain a
  refusal before the click; when the two disagree, the notebook wins.
- **The app cannot forge its dry-run evidence.** `gov_dry_runs` is written only by the
  actuator, and only when a dry run actually succeeded. A dry run that errored earns nothing.
- **Every attempt is audited, including refusals.** A refusal nobody recorded is
  indistinguishable from a write that never happened.

The gates are implemented twice — TypeScript for the UI, Python for the actuator — against
one shared specification in [spec/write_gate_cases.json](spec/write_gate_cases.json) that
**both test suites run**. Two implementations of one rule set drift silently, and here the
drift would mean the tool writing something it promised it would not.

## Requests → approvals → verification

The front door. Somebody asks for a persona in a scope; an approver decides; approving does
three things **in this order**:

1. **write the entitlement** — the desired state drift is measured against;
2. **apply** the compiled bindings through the four write gates;
3. **verify** by re-reading the plane.

Step 1 comes first on purpose. If the write fails, the customer is left with an approved
entitlement that drift immediately reports as `Missing` — visible, explainable, retryable.
The reverse order leaves access in the tenant that no entitlement justifies, which is exactly
the state this tool exists to eliminate.

Rules that are enforced, not just documented:

- **Nobody approves their own request.** An approval chain of one is not an approval chain,
  and it is the first thing an auditor tests.
- **"Approved" never means "applied".** A request whose bindings were refused by a gate lands
  as `Failed` with the gate named. A request that compiled to nothing also lands as `Failed` —
  telling a requester they can now do something they cannot is the worst outcome available.
- **Verification is not an HTTP 200.** It asks the same effective-permissions engine the
  Can-Do Explorer uses whether the principal *now actually derives* what was promised.
- **Executors read before they write.** Re-running a grant is `already_present`, never a
  duplicate — a duplicate assignment makes the later revoke ambiguous.

> **What the end-to-end test proves, and the demo should say out loud:** after a successful
> *"report author in Finance"* request, the `Missing` drift closes — and three `Extra` rows
> remain: `create:FabricItem`, `create:FabricDataAgent`, `create:FabricApp`. That is not a
> defect. Fabric has **no per-item-type role**, so the only way to grant report authoring is
> `Contributor`, which grants those too. The tool cannot fix it, and it refuses to hide it.

## The licence position, machine-checked

**This tool needs no premium licence to run, and its Power Platform controls work without
Managed Environments.** That is a claim worth making only if it is checkable, so every binding
kind records its licence impact and a test fails if any kind is missing one.

| Binding | Licence impact |
|---|---|
| Entra group membership · Fabric workspace role · Fabric tenant setting | free |
| PP environment security group · Dataverse role (group team) · data policy · tenant isolation · tenant settings | free |
| **Managed Environments** | **makes a premium licence a requirement for active usage** |

Managed Environments is therefore the one binding kind flagged
`enables-premium-requirement` — and it is **never registered as an executor**. A governance
tool must not change a customer's licence position as a side effect of granting somebody
access. The Write-gates console says so before the kind can be armed, and the Approvals page
states the licence impact of a request before it is approved.

Two Power Platform executors refuse work on principle rather than on permission:

- **`pp_dataverse_role` will not target an individual.** A role held by a person is access
  that no group membership explains: the Can-Do Explorer cannot derive it, and revoking it
  means hunting down every individual row. Group team or nothing.
- **`pp_env_security_group` refuses Default and Developer environments** with the real reason
  — a security group *cannot* be bound there. Failing with a raw API error would send an
  admin hunting for a permission that would not have helped.

What you give up without Managed Environments is stated as capability loss, not as a reason
to buy: Default-environment routing, environment groups, proactive sharing limits,
solution-checker enforcement, usage insights, IP firewall, CMK, vNet.

## The honest half: tasks

Five binding kinds have **no write API at all** — org-app audience membership, Microsoft 365
Copilot agent access, Agent 365 registry actions, Power Platform routing rules, and Fabric
item-level permissions. The tool cannot do them, so it hands each one to a person with the
exact click-path and a link to the right portal.

The distinction that makes this a governance feature rather than a to-do list:

| State | Means | Set by |
|---|---|---|
| **Attested** | *"I did it"* — a claim, attributed by name and time | a human clicking |
| **Verified** | the plane was re-read and confirms it | a machine check only |

They are counted separately and styled differently — **Attested is deliberately not green** —
because a queue where a click becomes governance evidence is worse than no queue, since it
launders a claim into a fact.

**Of those five kinds, exactly one can be machine-verified today** (the Agent 365 registry
exposes list and get, even though the *actions* are UI-only). The page says so, and shows the
count of work that can never be proven by machine. That is a property of the platform, not of
this tool — and stating it is more useful than a queue that looks uniformly green.

Deep links go to the **portal root**, never to a guessed blade URL: these admin surfaces
reorganise regularly, and one link that 404s destroys trust in the whole queue.

**414 TypeScript tests + 170 Python tests**, including seven structural guards that keep the
design honest:

- **Module boundaries** — no module may import another; nothing outside `src/modules` may
  reach into a module folder. Enforced by both a test *and* an ESLint rule.
- **i18n parity** — DE must define exactly EN's keys, with identical placeholders, no empty
  strings, and no ASCII umlaut substitutes.
- **No literal user-facing strings** in components.
- **The T0 exit criterion itself** — a render test asserts that a user with no admin consent
  sees real objects, per-plane gap reasons and the tier badge, in both languages.
- **Notebook integrity** — every generated `.ipynb` must parse as valid Python, carry exactly
  one `parameters` cell, contain the inlined shaping layer, default to `dry_run = True`, and
  match the current source.
- **Schema agreement** — the TypeScript table catalogue, the bootstrap notebook and the
  semantic-model notebook are three descriptions of one schema; a test fails the build if any
  of them drift.
- **Write-gate conformance** — the TypeScript and Python gate implementations are checked
  against one shared case file by both suites, and every gate id must be exercised by at
  least one case.

---

## Prerequisite runbook

Work through this in order. The in-app **Setup** page checks each item live and gives you
the exact command to fix it.

### 1. Fabric

- A Fabric capacity (**F2+**) and a workspace to deploy into.
- **Fabric Administrator** for tenant-wide read (T1). Prefer PIM elevation over standing rights.
- Tenant setting **"Service principals can access admin APIs used for updates"** — needed
  later for writes.

### 2. App registration (SPA)

- A public-client app registration for the Power BI / Graph token hops.
- Delegated permissions: Power BI service, plus Graph `User.Read`. Add
  `Directory.Read.All` / `Group.Read.All` to lift the Entra module to T1.

### 3. Power Platform — **one step only a human can do**

A service principal **cannot register itself**. A Power Platform Administrator must run
this once, interactively:

```powershell
New-PowerAppManagementApp -ApplicationId <your-app-registration-client-id>
```

> ⚠️ **Understand what this grants before you run it.** A registered management app is
> *"treated like a normal user with the Power Platform Administrator role assigned"*, and
> *"granular roles and permissions can't be assigned to limit their capabilities."* There is
> no least-privilege model for the BAP admin API. Compensating controls: scope the
> **Dataverse application user** with a purpose-built role per environment, keep the write
> gates tight, and read `gov_audit`. This is disclosed here deliberately — your security
> team will find it anyway, and finding it themselves is worse.

### 4. Deploy

```powershell
npm install
npm run build:fabric
npx rayfin up --workspace-id <workspace-id> --tenant <tenant-id> -y
```

### 5. Bootstrap

```powershell
python bootstrap/build_ipynb.py
# upload the .ipynb files to the workspace, then set the notebook ids in .env
```

Then, in the app: **Setup → Preview bootstrap (dry run)** first. It reports
`Created | Already present | Skipped (no permission) | Failed` for every step and changes
nothing. Run it for real once the preview looks right. It is idempotent — a second run
must report `Already present` throughout.

### 6. Semantic model

Run **Gov Create Model** once, then put the `model_id` it returns into `VITE_GOV_MODEL_ID`
and rebuild. The module pages then read live data.

> ⚠️ It refuses to recreate an existing model by default. Regenerating **changes the model
> id**, which silently breaks the deployed app's config — and the failure looks like "the
> collectors are broken". Later tables must be added with TOM `add_table` in a migration.

### 6. Configure

Copy `.env` and fill in your ids. Nothing tenant-specific is hard-coded anywhere; a
customer deployment is a config file, not a fork.

### 7. The write path (optional — the app is fully useful read-only)

Upload **Gov Actuator** and set `VITE_GOV_ACTUATOR_NOTEBOOK_ID`. Until you do, the app
cannot write anything at all, which is the safe default and costs you nothing: drift,
policies, the Can-Do Explorer and the posture score are all read-only.

Then, in **Write gates**: turn on the master switch, arm one binding kind, add one concrete
scope, and press **Dry run**. Only after that dry run succeeds will gate 4 let the real write
through — for that kind and that scope, for 30 days.

---

## Development

```powershell
npm install
npm test              # 414 TypeScript tests
npm run test:py       # 170 collector, gate and actuator tests (offline, no tenant needed)
npm run lint
npm run build:fabric  # tsc -b && vite build
npm run notebooks     # rebuild all .ipynb from percent-cell source
```

**Adding a fifth control plane** should be a folder under `src/modules/`, a `GovernanceModule`
export, and a registry entry — never a refactor. The boundary tests exist to keep it that way.

---

## What this is not

- Not a replacement for **Entra ID Governance**, **Purview**, **Defender**, or the
  **Agent 365 registry** — it consumes them (Agent 365 analysis in PLAN.md §7).
- Not multi-tenant SaaS. Self-hosted only.
- Not an ISV product: no billing, no marketplace listing, no SLA.
- Not a runtime agent security tool — that is Defender's job.

## Credits

Request/approval patterns adapted from
[DaSenf1860/fabricplatformgovernance](https://github.com/DaSenf1860/fabricplatformgovernance)
by Andreas J. Rederer (MIT). Built on
[Rayfin](https://github.com/microsoft/awesome-rayfin) and the Fabric platform.

## Fabric architecture

`npx rayfin up` provisions:

- Entra sign-in (Fabric identity)
- Fabric SQL database
- Static web app

## Getting started

```bash
npm install
npm run dev
npx rayfin up --workspace-id <your-workspace-guid> --tenant <your-tenant-guid>
```

Any workspace or item id this app needs is read from the environment, with no default.

## Project structure

```
bootstrap/      one-off setup notebooks
collectors/     scheduled collectors
rayfin/         deployment config - redirect URIs are loopback only
spec/
src/            the application
```

## Scripts

| Script | What it does |
|---|---|
| `npm run bench` |  |
| `npm run build` | production build |
| `npm run build:fabric` | build the bundle Fabric static hosting serves |
| `npm run dev` | dev server on http://localhost:5173 |
| `npm run lint` | lint |
| `npm run notebooks` |  |
| `npm run rayfin:up` | deploy to your Fabric workspace |
| `npm run test` | unit tests |
| `npm run test:py` |  |

## Data

Your own tenant, read with your own identity. Nothing is bundled.
