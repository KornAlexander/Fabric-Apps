/**
 * English strings — the source of truth for translation keys.
 *
 * `de.ts` must define exactly the same key set; `src/__tests__/i18n.test.ts`
 * fails the build otherwise (PLAN.md §8.9, §18).
 *
 * Rules:
 * - **Never translate Microsoft product or setting names.** "Users can create
 *   Fabric items" stays English inside a German sentence, because that is the
 *   string the admin will search for in the portal.
 * - Placeholders use `{name}` and are substituted by `t(key, { name })`.
 */
export const en = {
  'app.name': 'Governance Hub',
  'app.tagline': 'Who may create what, where — and why',

  'nav.setup': 'Setup',
  'nav.dashboard': 'Dashboard',
  'nav.cando': 'Can-Do Explorer',
  'nav.drift': 'Drift',
  'nav.policies': 'Policies',
  'nav.inventory': 'Inventory',
  'nav.personas': 'Personas',
  'nav.entitlements': 'Entitlements',
  'nav.requests': 'Requests',
  'nav.approvals': 'Approvals',
  'nav.tasks': 'Tasks',
  'nav.writeGates': 'Write gates',
  'nav.settings': 'Settings',
  'nav.workspaces': 'Workspaces',
  'nav.environments': 'Environments',
  'nav.defaultPosture': 'Default posture',
  'nav.groups': 'Groups',
  'nav.agents': 'Agents',

  'common.signOut': 'Sign out',
  'common.recheck': 'Re-check',
  'common.checking': 'Checking…',
  'common.loading': 'Loading…',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.language': 'Language',
  'common.notAvailableYet': 'Not built yet — arrives in a later phase.',
  'common.error': 'Something went wrong.',

  'auth.title': 'Governance Hub',
  'auth.subtitle': 'Sign in with your organizational account to continue.',
  'auth.signIn': 'Sign in',
  'auth.signInWithMicrosoft': 'Sign in with Microsoft',
  'auth.openingFabric': 'Opening Fabric…',
  'auth.signingIn': 'Signing in…',
  'auth.signInFailed': 'Failed to sign in.',

  // ── Modules ────────────────────────────────────────────────────────────────
  'module.fabric.name': 'Fabric',
  'module.fabric.description':
    'Tenant settings, capacity overrides, workspaces and roles, items by type, org apps and audiences.',
  'module.pp.name': 'Power Platform',
  'module.pp.description':
    'Environments, Dataverse security roles and table privileges, data policies, environment-creation settings, maker inventory.',
  'module.agent.name': 'Agents',
  'module.agent.description':
    'Agent 365 registry, Entra Agent ID, blueprints and sponsors, Copilot Studio bot privileges.',
  'module.entra.name': 'Entra',
  'module.entra.description':
    'Security groups, transitive membership and group-based licensing — the substrate every other module compiles onto.',

  'module.status.available': 'Available',
  'module.status.degraded': 'Degraded',
  'module.status.unavailable': 'Unavailable',
  'module.status.disabled': 'Disabled',
  'module.status.checking': 'Checking',

  'module.tier.T0': 'T0 · Explore',
  'module.tier.T1': 'T1 · Observe',
  'module.tier.T2': 'T2 · Act',

  'module.probe.live': 'Live-checked',
  'module.probe.declared': 'Declared in config',

  // Probe reasons — kept deliberately specific and actionable.
  'reason.ok.tenantWide': 'Tenant-wide admin read confirmed.',
  'reason.ok.userScope': 'Reachable with your own token.',
  'reason.fabric.noAdmin':
    'Not a Fabric Administrator, or admin consent is missing — falling back to the workspaces you can already see.',
  'reason.fabric.noProxy':
    'The fabric_proxy User Data Function is not configured. Set VITE_UDF_FABRIC_PROXY_URL.',
  'reason.entra.noGraphConsent':
    'Directory read consent is missing — falling back to your own group memberships.',
  'reason.entra.noToken': 'Could not obtain a Microsoft Graph token for the signed-in user.',
  'reason.pp.needsCollector':
    'The Power Platform admin APIs cannot be called from a browser. This module needs the collector notebook plus a registered Power Platform management app.',
  'reason.pp.noNotebook':
    'Power Platform collector notebook is not configured. Set VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID.',
  'reason.agent.needsCollector':
    'Agent inventory is collected server-side. Configure the agent collector notebook.',
  'reason.agent.noNotebook':
    'Agent collector notebook is not configured. Set VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID.',
  'reason.agent.noLicense':
    'No Agent 365 licence detected — the registry seam is unavailable. Falling back to the Dataverse bot table and Entra Agent ID.',
  'reason.disabledByOperator': 'Switched off in Settings.',
  'reason.disabledAtBuild': 'Compiled out of this build.',
  'reason.probeFailed': 'The availability check itself failed: {detail}',

  // ── Setup page ─────────────────────────────────────────────────────────────
  'setup.title': 'Setup',
  'setup.intro':
    'Everything this deployment needs, and exactly what breaks without it. Nothing here is hidden or assumed.',
  'setup.modules': 'Modules',
  'setup.prerequisites': 'Prerequisites',
  'setup.writes': 'Write gates',
  'setup.tier.current': 'Current reach tier',
  'setup.tier.explain':
    'T0 works with your own token and no admin consent. T1 adds tenant-wide read. T2 adds writes.',
  'setup.connect': 'Connect Power BI and Graph',
  'setup.connect.explain':
    'Reading Fabric and Entra needs a second sign-in: the app session gates this UI, while Power BI and Microsoft Graph tokens authorise the data hops. Consent is asked for once, from this button, because a browser blocks the popup outside a click.',
  'setup.connect.graphMinimal':
    'Graph connected with User.Read only — Directory.Read.All and Group.Read.All were not consented, so Entra stays at T0 and reports fewer groups than exist.',
  'setup.runBootstrap': 'Run bootstrap',
  'setup.runBootstrapDryRun': 'Preview bootstrap (dry run)',
  'setup.bootstrapNotConfigured':
    'Bootstrap notebook is not configured. Set VITE_GOV_BOOTSTRAP_NOTEBOOK_ID after deploying it.',
  'setup.humanStep': 'Needs a human administrator',
  'setup.collectors': 'Server-side collectors',
  'setup.collectors.help':
    'Each enabled module owns one collector notebook. Until its id is set here, that plane never refreshes server-side and stays limited to what your own token can read.',
  'setup.collectors.configured': 'Configured',
  'setup.collectors.missing': 'Not deployed yet',
  'setup.collectors.none': 'No enabled module owns a collector.',

  'check.status.pass': 'Pass',
  'check.status.warn': 'Warning',
  'check.status.fail': 'Fail',
  'check.status.unknown': 'Unknown',

  'check.rayfin.title': 'App backend reachable',
  'check.rayfin.fix': 'Deploy the app with `rayfin up`, then reload.',
  'check.udf.title': 'fabric_proxy function configured',
  'check.udf.fix': 'Set VITE_UDF_FABRIC_PROXY_URL in .env and rebuild.',
  'check.pbiToken.title': 'Power BI token for the signed-in user',
  'check.pbiToken.fix': 'Use the Connect button — an interactive sign-in needs a click.',
  'check.fabricAdmin.title': 'Fabric Administrator (tenant-wide read)',
  'check.fabricAdmin.fix':
    'Elevate via PIM, or run at T0 with a partial view. Fabric admin unlocks tenant settings and the full workspace inventory.',
  'check.graph.title': 'Microsoft Graph access',
  'check.graph.fix': 'Grant Directory.Read.All to the app registration, or stay at T0.',
  'check.ppManagementApp.title': 'Power Platform management app registered',
  'check.ppManagementApp.fix':
    'A human Power Platform Administrator must run this once — a service principal cannot register itself:',
  'check.lakehouse.title': 'Governance lakehouse and semantic model',
  'check.lakehouse.fix': 'Run the bootstrap notebook to provision them.',
  'check.agent365.title': 'Agent 365 licence',
  'check.agent365.fix':
    'Without it the Agents module runs degraded. Check Microsoft 365 admin center → Billing → Licenses.',
  'check.writesDisarmed.title': 'Writes are disarmed',
  'check.writesDisarmed.fix':
    'This is the intended state for a fresh install. Arm individual binding kinds in Settings when you are ready.',
  'check.actuator.title': 'Actuator notebook deployed',
  'check.actuator.fix':
    'The single write path. Deploy Gov Actuator.ipynb and set VITE_GOV_ACTUATOR_NOTEBOOK_ID. Without it nothing can be written — which is harmless while writes are disarmed, and a hard failure once they are not.',

  // ── Write gates ────────────────────────────────────────────────────────────
  'writes.chip.off': 'WRITES: OFF',
  'writes.chip.armed': 'ARMED: {kinds} kinds · {scopes} scopes',
  'writes.gate.master': 'Master switch is off',
  'writes.gate.kind': 'This binding kind is not armed',
  'writes.gate.scope': 'This scope is not in the allow-list',
  'writes.gate.dryRun': 'No successful dry run for this kind and scope in the last 30 days',
  'writes.gate.deniedRole': 'Elevated roles can never be granted by this tool',
  'writes.gate.moduleOff': 'The owning module is switched off',
  'writes.allowed': 'All gates pass',

  // ── Settings ───────────────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.modules.title': 'Modules',
  'settings.modules.help':
    'Switch a control plane on or off. A disabled module contributes no inventory, no policy rules and no writes — and disappears from the navigation.',
  'settings.writes.title': 'Write gates',
  'settings.writes.help':
    'All four gates must pass before anything is changed in a control plane. Every attempt is audited, including refusals.',
  'settings.language.title': 'Language',
  'settings.saved': 'Saved',
  'settings.readOnlyNotice':
    'Configuration is read-only until the app backend is reachable.',

  // ── Dashboard placeholder ──────────────────────────────────────────────────
  'dashboard.title': 'Dashboard',
  'dashboard.phaseNotice':
    'Phase 1 delivers the module contract, the setup pre-flight and the bootstrap. Inventory, the Can-Do Explorer, drift and approvals arrive in Tracks B–D.',
  'dashboard.enabledModules': 'Enabled modules',
  'dashboard.reachTier': 'Reach tier',

  // ── Reach tier & partial views (Phase 2) ────────────────────────────────
  'tier.badge.aria': 'Current reach tier',
  'tier.T0.explain':
    'You are seeing only what your own account can already reach. No admin consent has been granted.',
  'tier.T1.explain': 'Tenant-wide read is available. Writes are still not armed.',
  'tier.T2.explain': 'Tenant-wide read plus armed writes.',

  'partial.title': 'This view is incomplete — on purpose',
  'partial.body':
    'Some planes returned less than the whole truth. Each gap is listed below with its reason. Nothing here is guessed or filled in.',
  'partial.upgradeHint':
    'Granting tenant-wide read (T1) turns most of these into complete answers.',
  'partial.noCollector': 'This module has no browser-reachable inventory.',
  'partial.fabric.capped':
    'Only the first {limit} workspaces were expanded into items. A user-scoped read has no server-side aggregation, so the rest are counted but not itemised.',
  'partial.entra.firstPage':
    'Only the first page of groups was read. The server-side collector reads all of them.',
  'partial.entra.ownMembershipOnly':
    'Only your own group memberships are visible — these are the groups your entitlements would compile onto.',
  'partial.pp.serverSideOnly':
    'The Power Platform admin APIs are not reachable from a browser, so there is no inventory at this tier. The collector notebook fills this in server-side.',
  'partial.agent.serverSideOnly':
    'The Agent 365 registry needs AI Administrator and is collected server-side. Nothing is shown rather than something misleading.',

  // ── Inventory ─────────────────────────────────────────────────
  'inventory.title': 'Inventory',
  'inventory.intro':
    'What actually exists, read live with your own token. This is the raw material the entitlement model is checked against.',
  'inventory.refresh': 'Refresh',
  'inventory.search': 'Search',
  'inventory.searchPlaceholder': 'Name, type or container…',
  'inventory.filter.module': 'Module',
  'inventory.filter.kind': 'Kind',
  'inventory.filter.all': 'All',
  'inventory.empty': 'Nothing found at this reach tier.',
  'inventory.emptyFiltered': 'No results for the current filters.',
  'inventory.showing': 'Showing {shown} of {total}',
  'inventory.errors': '{count} objects could not be read',
  'inventory.column.name': 'Name',
  'inventory.column.kind': 'Kind',
  'inventory.column.type': 'Type',
  'inventory.column.scope': 'Container',
  'inventory.column.module': 'Module',

  'kind.workspace': 'Workspace',
  'kind.fabricItem': 'Fabric item',
  'kind.orgApp': 'Org app',
  'kind.group': 'Group',
  'kind.environment': 'Environment',
  'kind.agent': 'Agent',

  // ── Governance Model (Phase 4) ─────────────────────────────────────
  'model.notProvisioned':
    'The Governance Model is not provisioned yet. Run the bootstrap, then the model notebook, then set VITE_GOV_MODEL_ID and rebuild.',
  'model.collectorNotRun':
    'The model exists but this plane has no rows yet — its collector has not run. This is “we have not looked”, not “nothing is there”.',
  'model.queryFailed': 'The model query failed.',

  // ── M-FABRIC pages ────────────────────────────────────────────
  'fabric.workspaces.title': 'Workspaces',
  'fabric.workspaces.intro':
    'Fabric has no per-item-type role — a Contributor can create every item type not separately gated by a tenant setting. So the workspace is the unit entitlements are written against.',
  'fabric.col.workspace': 'Workspace',
  'fabric.col.capacity': 'Capacity',
  'fabric.col.state': 'State',
  'fabric.stat.workspaces': 'Workspaces',
  'fabric.stat.onCapacity': 'On a capacity',
  'fabric.stat.noCapacity': 'No capacity',

  // ── M-PP pages ───────────────────────────────────────────────
  'pp.environments.title': 'Environments',
  'pp.environments.intro':
    'Environment membership is the main preventive control in Power Platform — and it needs no premium licence. Managed Environments adds proactive features on top, at a licence cost.',
  'pp.col.environment': 'Environment',
  'pp.col.securityGroup': 'Security group',
  'pp.col.managed': 'Managed',
  'pp.col.region': 'Region',
  'pp.flag.sgBound': 'Bound',
  'pp.flag.sgMissing': 'Not bound',
  'pp.flag.sgImpossible': 'Not possible',
  'pp.flag.managedOn': 'Managed',
  'pp.flag.managedOff': 'Not managed',
  'pp.stat.environments': 'Environments',
  'pp.stat.unbound': 'No security group',
  'pp.stat.unmanaged': 'Not managed',
  'pp.defaultHole.title': 'These environments cannot be secured with a group',
  'pp.defaultHole.body':
    'Security groups cannot be assigned to Default or Developer environments, and Basic User plus Environment Maker are auto-assigned in Default — which survives the opt-out. There is no supported way to remove Environment Maker there. Contain it with a data policy, tenant isolation and disabled share-with-everyone instead.',

  // ── M-ENTRA pages ───────────────────────────────────────────
  'entra.groups.title': 'Groups',
  'entra.groups.intro':
    'Security groups are the one currency all four planes accept, so most entitlements compile down to a single group membership.',
  'entra.col.group': 'Group',
  'entra.col.managed': 'Managed by this app',
  'entra.col.mail': 'Mail',
  'entra.flag.appManaged': 'App-managed',
  'entra.flag.preExisting': 'Read-only',
  'entra.stat.groups': 'Groups',
  'entra.stat.appManaged': 'App-managed',
  'entra.stat.readOnly': 'Read-only to us',

  // ── M-AGENT pages ───────────────────────────────────────────
  'agent.agents.title': 'Agents',
  'agent.agents.intro':
    'Every agent across Copilot Studio, Agent Builder, SharePoint, Foundry and third-party platforms — merged from the Agent 365 registry, Entra Agent ID and the Dataverse bot table.',
  'agent.col.name': 'Agent',
  'agent.col.platform': 'Platform',
  'agent.col.state': 'State',
  'agent.col.owner': 'Owner',
  'agent.col.sponsor': 'Sponsor',
  'agent.col.risk': 'Risk',
  'agent.stat.total': 'Agents',
  'agent.stat.shadow': 'Shadow',
  'agent.stat.ownerless': 'Ownerless',
  'agent.stat.drafts': 'Drafts',
  'agent.notPreventable':
    'Agent 365 governs agents after they exist — it does not gate creation, and Copilot Studio agent creation cannot be disabled. This page is inventory and containment, not prevention.',

  // ── Control modes (Phase 5) ───────────────────────────────────────
  'mode.preventiveAuto': 'Preventive · automated',
  'mode.preventiveManual': 'Preventive · manual',
  'mode.detective': 'Detective only',

  // ── Capabilities ─────────────────────────────────────────────
  'cap.read:Report': 'Read reports and org apps in the scope.',
  'cap.create:PowerBIReport':
    'Create Power BI reports. Fabric cannot separate this from creating semantic models — both need Contributor.',
  'cap.create:SemanticModel':
    'Create semantic models. Shares the Contributor role with report creation; Fabric has no per-item-type role.',
  'cap.create:FabricItem':
    'Create Fabric items — lakehouses, notebooks, pipelines. Gated by workspace role plus the “Users can create Fabric items” tenant setting.',
  'cap.create:FabricDataAgent':
    'Create Fabric data agents. No dedicated create switch exists; gated by the Copilot capacity setting and workspace role.',
  'cap.create:FabricApp': 'Create Fabric App items. Gated by a preview tenant setting.',
  'cap.create:Workspace':
    'Create Fabric workspaces. Tenant setting “Create workspaces”, scoped to a security group.',
  'cap.create:OrgApp':
    'Create and publish org apps. Needs Admin, Member or Contributor on the workspace.',
  'cap.manage:OrgAppAudience':
    'Manage who is in an org-app audience. Portal-only — there is no public API, so this is a guided task with verification.',
  'cap.create:CanvasApp':
    'Create canvas apps. Only Environment Maker works — custom security roles are not supported for canvas-app maker scenarios.',
  'cap.create:ModelDrivenApp':
    'Create model-driven apps. Environment Maker or System Customizer.',
  'cap.create:Flow': 'Create Power Automate cloud flows in the environment.',
  'cap.create:CopilotStudioAgent':
    'Author Copilot Studio agents. Preventive per environment via bot table privileges — but agent creation cannot be disabled tenant-wide.',
  'cap.create:M365DeclarativeAgent':
    'Build declarative agents in Microsoft 365 Copilot. Admin-center only, no documented API.',
  'cap.manage:AgentBlueprint':
    'Own agent identity blueprints — the one preventive, class-level agent control, inherited by every instance.',
  'cap.app:Approve': 'Approve access requests for the scope.',
  'cap.app:Administer': 'Manage personas, modules and write gates in this app.',
  'cap.app:Audit': 'Read everything, including the audit trail.',

  // ── Personas & Recipes ────────────────────────────────────────
  'personas.title': 'Personas & Recipes',
  'personas.intro':
    'Personas are your role model and are fully editable. Capabilities and binding recipes are not — they encode documented platform behaviour, and being able to “fix” a documented impossibility would make this tool lie.',
  'personas.add': 'New persona',
  'personas.edit': 'Edit',
  'personas.reset': 'Reset to shipped',
  'personas.show': 'Show capabilities',
  'personas.hide': 'Hide',
  'personas.save': 'Save',
  'personas.cancel': 'Cancel',
  'personas.custom': 'Custom',
  'personas.inactive': 'Inactive',
  'personas.compileError': 'Does not compile',
  'personas.unknownCapability': 'is not a known capability',
  'personas.moduleOff':
    'The {module} module is switched off, so this capability currently grants nothing.',
  'personas.compilesTo': 'Compiles to {count} bindings',
  'personas.seedOnly':
    'The app backend is unreachable, so this is the shipped seed. Edits cannot be saved yet.',
  'personas.saveFailed': 'Could not save — the app backend is unreachable.',
  'personas.stat.total': 'Personas',
  'personas.stat.capabilities': 'Capabilities',
  'personas.stat.broken': 'Not compiling',
  'personas.editor.title': 'Edit persona',
  'personas.field.id': 'Id',
  'personas.field.name': 'Name',
  'personas.field.description': 'Description',
  'personas.field.riskTier': 'Risk tier',
  'personas.field.active': 'Active',
  'personas.field.capabilities': 'Capabilities',

  // ── Can-Do Explorer (Phase 6) ─────────────────────────────────────
  'cando.title': 'Can-Do Explorer',
  'cando.intro':
    'Who can create what, right now — derived from what the collectors actually found, with the reasoning shown. Not what was intended: what is true.',
  'cando.direction.who': 'Who can…',
  'cando.direction.what': 'What can…',
  'cando.capability': 'Capability',
  'cando.principal': 'Person or group',
  'cando.principalPlaceholder': 'Search by name…',
  'cando.includeBlocked': 'Include blocked',
  'cando.showPath': 'Why?',
  'cando.hidePath': 'Hide',
  'cando.showMembers': 'Who exactly?',
  'cando.hideMembers': 'Hide people',
  'cando.moreMembers': '…and {count} more',
  'cando.viaGroup': 'via {group}',
  'cando.noneCan': 'Nobody holds this capability in the collected data.',
  'cando.pickPrincipal': 'Pick a person or group above.',
  'cando.noPrincipals': 'No principals match.',
  'cando.status.granted': 'Granted',
  'cando.status.blocked': 'Blocked',
  'cando.status.unknown': 'Unknown',
  'cando.incomplete':
    'Some sources could not be read, so this answer is incomplete — it under-reports access.',
  'cando.emptySources':
    'These sources are empty, so anything they would have granted is missing here: {tables}',
  'cando.everyone.title': 'Everyone in the tenant holds this',
  'cando.everyone.body':
    'At least one control grants this to the whole organisation — typically a tenant setting enabled for everyone, or the Default environment, where Environment Maker is auto-assigned and cannot be removed.',
  'cando.reach': 'Reach per capability',
  'cando.reach.everyone': 'Everyone',
  'cando.reach.count': '{count} principals',
  'cando.reach.partlyUnknown': 'partly unknown',

  // ── Drift (Phase 7) ─────────────────────────────────────────────
  'drift.title': 'Drift',
  'drift.intro':
    'Entitlements you recorded against access the collectors actually found. Missing means the platform is not keeping a promise; Extra means access nobody asked for.',
  'drift.type.Missing': 'Missing',
  'drift.type.Extra': 'Extra',
  'drift.type.Blocked': 'Blocked',
  'drift.type.Unknown': 'Unknown',
  'drift.none': 'No drift for the current filters.',
  'drift.autoRemediable': 'Can be fixed automatically',
  'drift.neverAuto': 'Never removed automatically',
  'drift.extraNote':
    'Extra access is reported, never revoked automatically. Auto-revoking is how a governance tool causes an outage — removal is always an explicit human decision.',
  'drift.noEntitlements':
    'No entitlements are recorded yet, so every grant shows up as Extra. Record intent on the Entitlements page first — this is a starting point, not a set of findings.',
  'drift.noStore':
    'The entitlement store is unreachable, so there is no desired state to compare against. Everything below is one-sided.',

  // ── Policies (Phase 7) ─────────────────────────────────────────
  'policies.title': 'Policies',
  'policies.intro':
    'The shipped rule pack, evaluated against the collected snapshot. Rules whose data is not collectable yet are listed as pending rather than hidden — a pack that quietly skips rules gives false comfort.',
  'policies.findings': 'Findings',
  'policies.noFindings': 'No findings for the current filter.',
  'policies.rules': 'Rule pack',
  'policies.pending': 'Pending',
  'policies.pendingNote':
    '{count} rules cannot run yet. Each one says exactly what data it is waiting for.',
  'policies.col.id': 'Id',
  'policies.col.statement': 'Checks',
  'policies.col.module': 'Module',
  'policies.col.findings': 'Findings',
  'policies.stat.rules': 'Rules',
  'policies.stat.active': 'Evaluating',
  'policies.stat.findings': 'Findings',

  // ── Entitlements (Phase 7) ───────────────────────────────────
  'entitlements.title': 'Entitlements',
  'entitlements.intro':
    'Who should hold which persona, in which scope. This is the desired state drift is measured against.',
  'entitlements.noWriteNotice':
    'Recording an entitlement changes nothing in any control plane. It only describes intent, so you can see the gap long before any write gate is armed.',
  'entitlements.add': 'Record an entitlement',
  'entitlements.record': 'Record',
  'entitlements.current': 'Recorded entitlements',
  'entitlements.none': 'Nothing recorded yet.',
  'entitlements.revoke': 'Withdraw',
  'entitlements.field.principal': 'Person or group',
  'entitlements.field.persona': 'Persona',
  'entitlements.field.scope': 'Scope',
  'entitlements.field.validUntil': 'Valid until (optional)',
  'entitlements.validUntil': 'Valid until {date}',
  'entitlements.expired': 'Expired on {date}',
  'entitlements.saveFailed': 'Could not save — the app backend is unreachable.',
  'entitlements.storeUnavailable':
    'The entitlement store is unreachable. Nothing can be recorded until the app backend is deployed.',
  'entitlements.noPrincipals':
    'No principals were found in the collected data, so there is nobody to entitle yet.',

  // ── Default environment posture (Phase 7) ──────────────────────────
  'posture.title': 'Default environment posture',
  'posture.intro':
    'Six containment levers for the one environment whose membership cannot be controlled. All of them are licence-free and none of them needs Managed Environments.',
  'posture.score': 'Levers in place',
  'posture.scoreExplain':
    '{known} of {total} levers could be determined from collected data. Unknown levers are never counted as passing.',
  'posture.environment': 'Default environment: {name}',
  'posture.noEnvironment':
    'No Default environment has been collected yet, so this is scored against tenant-wide settings only.',
  'posture.status.pass': 'In place',
  'posture.status.fail': 'Missing',
  'posture.status.unknown': 'Unknown',
  'posture.unknownNote':
    'Unknown means we have not been able to look, not that the lever is missing. Nothing here is guessed.',
  'posture.lever.dlpDefaultBlocked': 'Data policy blocks new connectors by default',
  'posture.lever.dlpCustomConnectorUrls': 'Custom-connector URL patterns are blocked',
  'posture.lever.tenantIsolation': 'Cross-tenant isolation is on',
  'posture.lever.disableShareWithEveryone': 'Sharing apps with everyone is disabled',
  'posture.lever.restrictEnvironmentCreation':
    'Environment and trial creation are restricted to admins',
  'posture.lever.exchangeTransportRule':
    'Exchange transport rule for the Office 365 Outlook connector',

  // ── Write gates console (Phase 8) ───────────────────────────────────
  'writes.title': 'Write gates',
  'writes.intro':
    'Four gates stand between this tool and any change to a control plane. All four must pass, every time, for every write.',
  'writes.serverSideNotice':
    'Everything on this page configures what the actuator notebook will accept. The notebook re-reads this configuration and re-evaluates all four gates server-side on every call — the app’s opinion is never trusted, and the app can neither write to a control plane nor forge its own dry-run evidence.',
  'writes.armed': 'Armed',
  'writes.disarmed': 'Disarmed',
  'writes.notWritable': 'Manual control — never written',
  'writes.saveFailed': 'Could not save — nothing was armed. The app backend is unreachable.',
  'writes.actuatorMissing':
    'The actuator notebook is not configured. Set VITE_GOV_ACTUATOR_NOTEBOOK_ID after deploying it.',
  'writes.noExitValue':
    'The actuator ran but returned no result. Check the notebook run in Fabric before assuming anything changed.',
  'writes.dryRunOk': 'Dry run succeeded — gate 4 is now satisfied for this kind and scope.',

  'writes.gate1.title': 'Gate 1 · Master switch',
  'writes.gate1.help':
    'One click disarms everything, in every plane. Ships off, and a fresh install stays off until somebody decides otherwise.',
  'writes.gate2.title': 'Gate 2 · Armed binding kinds',
  'writes.gate2.help':
    'Arm one kind of change at a time. A tool with a single global write switch is a tenant-wide incident waiting to happen.',
  'writes.gate3.title': 'Gate 3 · Scope allow-list',
  'writes.gate3.help':
    'Workspace, environment or capacity ids this tool may touch. A pilot runs against three workspaces, not the tenant.',
  'writes.gate4.title': 'Gate 4 · Prior successful dry run',
  'writes.gate4.noScopes':
    'Add a concrete scope above. A wildcard cannot be dry-run, so it can never satisfy gate 4.',
  'writes.noScopes': 'No scopes allowed yet — nothing can be written anywhere.',
  'writes.scopePlaceholder': 'workspace or environment id',
  'writes.addScope': 'Add scope',
  'writes.removeScope': 'Remove {scope}',
  'writes.wildcardWarning':
    'The wildcard allows every scope. Gate 4 still applies per scope, but this removes the pilot boundary.',
  'writes.runDryRun': 'Dry run',
  'writes.licenceWarning':
    'Arming this changes the licence position of the environment, not just its access:',
  'writes.dryRun.fresh': 'Dry run valid · {days} d left',
  'writes.dryRun.expired': 'Dry run expired',
  'writes.dryRun.never': 'Never dry-run',

  'writes.audit.title': 'Audit trail',
  'writes.audit.help':
    'Append-only, written by the actuator. Every attempt is here — including refusals, because a refusal nobody recorded is indistinguishable from a write that never happened.',
  'writes.audit.empty': 'Nothing has been attempted yet.',
  'writes.audit.search': 'Actor, action, target…',
  'writes.audit.when': 'When',
  'writes.audit.actor': 'Actor',
  'writes.audit.action': 'Action',
  'writes.audit.target': 'Target',
  'writes.audit.outcome': 'Outcome',
  'writes.audit.detail': 'Detail',
  'writes.audit.unreadable':
    'These ledgers could not be read, so this trail is incomplete: {tables}',
  'writes.outcome.Success': 'Success',
  'writes.outcome.Planned': 'Planned (dry run)',
  'writes.outcome.Refused': 'Refused',
  'writes.outcome.Failed': 'Failed',

  // ── Requests (Phase 9) ─────────────────────────────────────────
  'requests.title': 'Requests',
  'requests.intro':
    'Ask to be able to create something, somewhere. An approver decides; approving records the entitlement and applies it through the write gates.',
  'requests.new': 'New request',
  'requests.submit': 'Submit request',
  'requests.submitted': 'Request submitted — it is now in the approver queue.',
  'requests.submitFailed': 'Could not submit — the app backend is unreachable.',
  'requests.withdraw': 'Withdraw',
  'requests.withdrawFailed': 'Could not withdraw the request.',
  'requests.mine': 'My requests',
  'requests.none': 'You have not asked for anything yet.',
  'requests.storeUnavailable':
    'The request store is unreachable, so nothing can be submitted or shown yet.',
  'requests.field.persona': 'Persona',
  'requests.field.scope': 'Scope',
  'requests.field.justification': 'Why do you need this?',
  'requests.justificationPlaceholder':
    'What you are trying to do, and for which project or team…',
  'requests.justificationTooShort':
    'An approver needs enough to judge this — a few words more.',
  'requests.youWouldGet': 'This persona would let you:',
  'requests.noBindings':
    'This persona compiles to nothing at that scope, so approving it would change nothing. Pick a different scope.',
  'requests.darkBindings':
    '{count} of these need a module that is currently switched off, and would grant nothing until it is on.',
  'requests.capabilityCount': '{count} capabilities',
  'requests.status.Pending': 'Waiting for approval',
  'requests.status.Approved': 'Approved · applied, not yet verified',
  'requests.status.Denied': 'Denied',
  'requests.status.Failed': 'Not applied',
  'requests.status.Verified': 'Verified',
  'requests.status.Withdrawn': 'Withdrawn',

  // ── Approvals (Phase 9) ───────────────────────────────────────
  'approvals.title': 'Approvals',
  'approvals.intro':
    'Approving writes the entitlement first, then applies the compiled bindings through the four write gates, then verifies by re-reading the plane.',
  'approvals.queue': 'Waiting for a decision',
  'approvals.queueEmpty': 'Nothing is waiting.',
  'approvals.approve': 'Approve',
  'approvals.deny': 'Deny',
  'approvals.verify': 'Verify',
  'approvals.notePlaceholder': 'Note for the requester (optional)…',
  'approvals.willWrite': 'Approving will write:',
  'approvals.nothingToApply':
    'Nothing would be written. The request cannot be honoured as it stands.',
  'approvals.darkBindings':
    '{count} further bindings belong to a switched-off module and are skipped.',
  'approvals.applied': 'Approved — {count} bindings applied. Verify to close the loop.',
  'approvals.applyFailed': 'Approved, but not applied: {detail}',
  'approvals.denied': 'Denied.',
  'approvals.actionFailed': 'The decision could not be recorded.',
  'approvals.verified':
    'Verified — the plane now grants what was promised, and the drift row is closed.',
  'approvals.notYetEffective':
    'Not in effect yet. Still missing: {missing}. Some changes take minutes; re-run the collector and verify again.',
  'approvals.notApprover':
    'You are not on the approver list, so you can read this queue but not decide. Approvers are configured in Settings.',
  'approvals.noSelfApproval':
    'You cannot decide your own request. An approval chain of one is not an approval chain.',
  'approvals.awaiting': 'Approved — awaiting verification',
  'approvals.awaitingHelp':
    'Applied but not yet confirmed in the plane. Until a request is verified, treat it as a promise rather than a fact.',
  'approvals.awaitingEmpty': 'Nothing is waiting to be verified.',
  'approvals.stat.pending': 'Pending',
  'approvals.stat.awaiting': 'Awaiting verification',
  'approvals.stat.verified': 'Verified',
  'approvals.licenceFree': 'Consumes no premium licence and does not require Managed Environments.',
  'approvals.licenceTrigger':
    'Careful — {kinds} would make a premium licence a requirement for active usage in that environment.',

  // ── Task queue (Phase 11) ─────────────────────────────────────────
  'tasks.title': 'Tasks',
  'tasks.intro':
    'Controls with no write API. The tool cannot do these, so it hands each one over with the exact click-path — and says honestly how, or whether, the result can be proven.',
  'tasks.queue': 'Waiting to be done',
  'tasks.queueEmpty': 'Nothing is waiting.',
  'tasks.done': 'Completed',
  'tasks.doneEmpty': 'Nothing completed yet.',
  'tasks.none': 'No tasks have been raised.',
  'tasks.storeUnavailable':
    'The task store is unreachable, so nothing can be raised or completed yet.',
  'tasks.openPortal': 'Open the portal',
  'tasks.steps': 'What to do',
  'tasks.claim': 'I’ll do this',
  'tasks.attest': 'Mark as done',
  'tasks.verify': 'Verify now',
  'tasks.cancel': 'Not doing this',
  'tasks.reopen': 'Re-open',
  'tasks.actionFailed': 'That could not be saved.',
  'tasks.attestPrompt': 'What did you change? (recorded as your claim)',
  'tasks.cancelPrompt': 'Why is this not being done?',

  'tasks.status.Open': 'Open',
  'tasks.status.InProgress': 'In progress',
  'tasks.status.Attested': 'Claimed done',
  'tasks.status.Verified': 'Verified',
  'tasks.status.Cancelled': 'Not doing',

  'tasks.stat.open': 'Open',
  'tasks.stat.overdue': 'Overdue',
  'tasks.stat.attestationOnly': 'Cannot be machine-verified',

  'tasks.verification.machine': 'Can be verified by re-reading the plane',
  'tasks.verification.attestation': 'Only a human can attest this',
  'tasks.attestedBy': 'Claimed done by {actor}',
  'tasks.verifiedNote': 'Confirmed by re-reading the plane.',
  'tasks.attestationWarning':
    'This is a claim, not evidence. No API exists to read this back, so the app records who said it and when — and never calls it verified.',
  'tasks.honesty':
    '{count} of these can never be machine-verified. That is a property of the platform, not of this tool.',

  'task.orgAppAudience.title': 'Add the group to an org-app audience',
  'task.m365AgentAccess.title': 'Restrict Microsoft 365 Copilot agent access',
  'task.a365Registry.title': 'Apply an Agent 365 registry action',
  'task.ppRouting.title': 'Configure default-environment routing',
  'task.fabricItemPermission.title': 'Fix an item-level permission',
} as const;

export type TranslationKey = keyof typeof en;
