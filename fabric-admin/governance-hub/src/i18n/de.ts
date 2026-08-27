import type { en } from './en';

/**
 * German strings. Real umlauts and ß only — never ae/oe/ue/ss.
 *
 * Microsoft product and setting names stay English on purpose: the admin will
 * search for "Users can create Fabric items" in the portal, not for a
 * translation of it.
 */
export const de: Record<keyof typeof en, string> = {
  'app.name': 'Governance Hub',
  'app.tagline': 'Wer darf was erstellen, wo — und warum',

  'nav.setup': 'Einrichtung',
  'nav.dashboard': 'Übersicht',
  'nav.cando': 'Can-Do Explorer',
  'nav.drift': 'Drift',
  'nav.policies': 'Richtlinien',
  'nav.inventory': 'Inventar',
  'nav.personas': 'Personas',
  'nav.entitlements': 'Berechtigungen',
  'nav.requests': 'Anträge',
  'nav.approvals': 'Genehmigungen',
  'nav.tasks': 'Aufgaben',
  'nav.writeGates': 'Schreib-Gates',
  'nav.settings': 'Einstellungen',
  'nav.workspaces': 'Workspaces',
  'nav.environments': 'Umgebungen',
  'nav.defaultPosture': 'Default-Absicherung',
  'nav.groups': 'Gruppen',
  'nav.agents': 'Agents',

  'common.signOut': 'Abmelden',
  'common.recheck': 'Erneut prüfen',
  'common.checking': 'Prüfung läuft…',
  'common.loading': 'Wird geladen…',
  'common.copy': 'Kopieren',
  'common.copied': 'Kopiert',
  'common.language': 'Sprache',
  'common.notAvailableYet': 'Noch nicht gebaut — kommt in einer späteren Phase.',
  'common.error': 'Es ist ein Fehler aufgetreten.',

  'auth.title': 'Governance Hub',
  'auth.subtitle': 'Melden Sie sich mit Ihrem Organisationskonto an, um fortzufahren.',
  'auth.signIn': 'Anmelden',
  'auth.signInWithMicrosoft': 'Mit Microsoft anmelden',
  'auth.openingFabric': 'Fabric wird geöffnet…',
  'auth.signingIn': 'Anmeldung läuft…',
  'auth.signInFailed': 'Die Anmeldung ist fehlgeschlagen.',

  // ── Module ─────────────────────────────────────────────────────────────────
  'module.fabric.name': 'Fabric',
  'module.fabric.description':
    'Tenant Settings, Capacity Overrides, Workspaces und Rollen, Elemente nach Typ, Org Apps und Audiences.',
  'module.pp.name': 'Power Platform',
  'module.pp.description':
    'Umgebungen, Dataverse-Sicherheitsrollen und Tabellenrechte, Data Policies, Einstellungen zur Umgebungserstellung, Maker-Inventar.',
  'module.agent.name': 'Agents',
  'module.agent.description':
    'Agent 365 Registry, Entra Agent ID, Blueprints und Sponsoren, Copilot-Studio-Rechte auf der bot-Tabelle.',
  'module.entra.name': 'Entra',
  'module.entra.description':
    'Sicherheitsgruppen, transitive Mitgliedschaften und gruppenbasierte Lizenzierung — die Grundlage, auf die alle anderen Module kompilieren.',

  'module.status.available': 'Verfügbar',
  'module.status.degraded': 'Eingeschränkt',
  'module.status.unavailable': 'Nicht verfügbar',
  'module.status.disabled': 'Deaktiviert',
  'module.status.checking': 'Prüfung',

  'module.tier.T0': 'T0 · Erkunden',
  'module.tier.T1': 'T1 · Beobachten',
  'module.tier.T2': 'T2 · Handeln',

  'module.probe.live': 'Live geprüft',
  'module.probe.declared': 'Aus der Konfiguration',

  'reason.ok.tenantWide': 'Mandantenweiter administrativer Lesezugriff bestätigt.',
  'reason.ok.userScope': 'Mit Ihrem eigenen Token erreichbar.',
  'reason.fabric.noAdmin':
    'Kein Fabric-Administrator oder fehlende Administratoreinwilligung — es werden nur die Workspaces angezeigt, die Sie ohnehin sehen.',
  'reason.fabric.noProxy':
    'Die User Data Function fabric_proxy ist nicht konfiguriert. Setzen Sie VITE_UDF_FABRIC_PROXY_URL.',
  'reason.entra.noGraphConsent':
    'Die Einwilligung zum Verzeichnis-Lesezugriff fehlt — es werden nur Ihre eigenen Gruppenmitgliedschaften genutzt.',
  'reason.entra.noToken':
    'Für die angemeldete Person konnte kein Microsoft-Graph-Token bezogen werden.',
  'reason.pp.needsCollector':
    'Die Power-Platform-Admin-APIs sind aus dem Browser nicht aufrufbar. Dieses Modul benötigt das Collector-Notebook sowie eine registrierte Power Platform Management App.',
  'reason.pp.noNotebook':
    'Das Power-Platform-Collector-Notebook ist nicht konfiguriert. Setzen Sie VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID.',
  'reason.agent.needsCollector':
    'Das Agent-Inventar wird serverseitig erhoben. Konfigurieren Sie das Agent-Collector-Notebook.',
  'reason.agent.noNotebook':
    'Das Agent-Collector-Notebook ist nicht konfiguriert. Setzen Sie VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID.',
  'reason.agent.noLicense':
    'Keine Agent-365-Lizenz erkannt — die Registry-Anbindung steht nicht zur Verfügung. Rückfall auf die Dataverse-Tabelle bot und Entra Agent ID.',
  'reason.disabledByOperator': 'In den Einstellungen deaktiviert.',
  'reason.disabledAtBuild': 'Aus diesem Build herauskompiliert.',
  'reason.probeFailed': 'Die Verfügbarkeitsprüfung selbst ist fehlgeschlagen: {detail}',

  // ── Einrichtung ────────────────────────────────────────────────────────────
  'setup.title': 'Einrichtung',
  'setup.intro':
    'Alles, was diese Installation benötigt — und was ohne die jeweilige Voraussetzung nicht funktioniert. Nichts davon wird verschwiegen oder angenommen.',
  'setup.modules': 'Module',
  'setup.prerequisites': 'Voraussetzungen',
  'setup.writes': 'Schreib-Gates',
  'setup.tier.current': 'Aktuelle Reichweite',
  'setup.tier.explain':
    'T0 funktioniert ohne Administratoreinwilligung mit Ihrem eigenen Token. T1 ergänzt mandantenweiten Lesezugriff. T2 ergänzt Schreibzugriff.',
  'setup.connect': 'Power BI und Graph verbinden',
  'setup.connect.explain':
    'Das Lesen von Fabric und Entra erfordert eine zweite Anmeldung: Die App-Sitzung schaltet diese Oberfläche frei, während Token für Power BI und Microsoft Graph die Datenzugriffe autorisieren. Die Einwilligung wird einmalig über diese Schaltfläche eingeholt, da der Browser das Popup außerhalb eines Klicks blockiert.',
  'setup.connect.graphMinimal':
    'Graph nur mit User.Read verbunden — Directory.Read.All und Group.Read.All wurden nicht einwilligt, daher bleibt Entra auf T0 und meldet weniger Gruppen, als vorhanden sind.',
  'setup.runBootstrap': 'Bootstrap ausführen',
  'setup.runBootstrapDryRun': 'Bootstrap simulieren (Dry Run)',
  'setup.bootstrapNotConfigured':
    'Das Bootstrap-Notebook ist nicht konfiguriert. Setzen Sie VITE_GOV_BOOTSTRAP_NOTEBOOK_ID nach dem Deployment.',
  'setup.humanStep': 'Erfordert eine administrative Person',
  'setup.collectors': 'Serverseitige Collectors',
  'setup.collectors.help':
    'Jedes aktive Modul besitzt ein Collector-Notebook. Solange dessen Id hier nicht gesetzt ist, wird diese Ebene serverseitig nie aktualisiert und bleibt auf das beschränkt, was Ihr eigenes Token lesen kann.',
  'setup.collectors.configured': 'Konfiguriert',
  'setup.collectors.missing': 'Noch nicht bereitgestellt',
  'setup.collectors.none': 'Kein aktives Modul besitzt einen Collector.',

  'check.status.pass': 'Erfüllt',
  'check.status.warn': 'Warnung',
  'check.status.fail': 'Nicht erfüllt',
  'check.status.unknown': 'Unbekannt',

  'check.rayfin.title': 'App-Backend erreichbar',
  'check.rayfin.fix': 'Die App mit `rayfin up` bereitstellen und neu laden.',
  'check.udf.title': 'Funktion fabric_proxy konfiguriert',
  'check.udf.fix': 'VITE_UDF_FABRIC_PROXY_URL in .env setzen und neu bauen.',
  'check.pbiToken.title': 'Power-BI-Token für die angemeldete Person',
  'check.pbiToken.fix':
    'Nutzen Sie die Verbinden-Schaltfläche — eine interaktive Anmeldung benötigt einen Klick.',
  'check.fabricAdmin.title': 'Fabric-Administrator (mandantenweites Lesen)',
  'check.fabricAdmin.fix':
    'Per PIM erhöhen oder mit eingeschränkter Sicht auf T0 bleiben. Fabric-Administrator schaltet Tenant Settings und das vollständige Workspace-Inventar frei.',
  'check.graph.title': 'Zugriff auf Microsoft Graph',
  'check.graph.fix':
    'Directory.Read.All für die App-Registrierung erteilen oder auf T0 bleiben.',
  'check.ppManagementApp.title': 'Power Platform Management App registriert',
  'check.ppManagementApp.fix':
    'Dies muss eine administrative Person einmalig ausführen — ein Dienstprinzipal kann sich nicht selbst registrieren:',
  'check.lakehouse.title': 'Governance-Lakehouse und semantisches Modell',
  'check.lakehouse.fix': 'Das Bootstrap-Notebook ausführen, um beides anzulegen.',
  'check.agent365.title': 'Agent-365-Lizenz',
  'check.agent365.fix':
    'Ohne sie läuft das Agents-Modul eingeschränkt. Prüfen: Microsoft 365 Admin Center → Abrechnung → Lizenzen.',
  'check.writesDisarmed.title': 'Schreibzugriff ist entschärft',
  'check.writesDisarmed.fix':
    'Das ist der gewollte Zustand einer frischen Installation. Einzelne Binding-Arten in den Einstellungen scharf schalten, wenn Sie so weit sind.',
  'check.actuator.title': 'Actuator-Notebook bereitgestellt',
  'check.actuator.fix':
    'Der einzige Schreibpfad. Stellen Sie Gov Actuator.ipynb bereit und setzen Sie VITE_GOV_ACTUATOR_NOTEBOOK_ID. Ohne dieses Notebook kann nichts geschrieben werden — unkritisch, solange der Schreibzugriff entschärft ist, und ein harter Fehler, sobald er es nicht mehr ist.',

  // ── Schreib-Gates ──────────────────────────────────────────────────────────
  'writes.chip.off': 'SCHREIBEN: AUS',
  'writes.chip.armed': 'SCHARF: {kinds} Arten · {scopes} Bereiche',
  'writes.gate.master': 'Der Hauptschalter ist aus',
  'writes.gate.kind': 'Diese Binding-Art ist nicht scharf geschaltet',
  'writes.gate.scope': 'Dieser Bereich steht nicht auf der Positivliste',
  'writes.gate.dryRun':
    'Kein erfolgreicher Dry Run für diese Art und diesen Bereich in den letzten 30 Tagen',
  'writes.gate.deniedRole':
    'Privilegierte Rollen werden von diesem Werkzeug niemals vergeben',
  'writes.gate.moduleOff': 'Das zuständige Modul ist ausgeschaltet',
  'writes.allowed': 'Alle Gates sind erfüllt',

  // ── Einstellungen ──────────────────────────────────────────────────────────
  'settings.title': 'Einstellungen',
  'settings.modules.title': 'Module',
  'settings.modules.help':
    'Eine Steuerungsebene ein- oder ausschalten. Ein deaktiviertes Modul liefert kein Inventar, keine Richtlinien und keine Schreibvorgänge — und verschwindet aus der Navigation.',
  'settings.writes.title': 'Schreib-Gates',
  'settings.writes.help':
    'Alle vier Gates müssen erfüllt sein, bevor in einer Steuerungsebene etwas geändert wird. Jeder Versuch wird protokolliert, auch abgelehnte.',
  'settings.language.title': 'Sprache',
  'settings.saved': 'Gespeichert',
  'settings.readOnlyNotice':
    'Die Konfiguration ist schreibgeschützt, solange das App-Backend nicht erreichbar ist.',

  // ── Übersicht ──────────────────────────────────────────────────────────────
  'dashboard.title': 'Übersicht',
  'dashboard.phaseNotice':
    'Phase 1 liefert den Modulvertrag, die Einrichtungsprüfung und den Bootstrap. Inventar, Can-Do Explorer, Drift und Genehmigungen folgen in den Tracks B–D.',
  'dashboard.enabledModules': 'Aktive Module',
  'dashboard.reachTier': 'Reichweite',

  // ── Reichweite & unvollständige Sichten (Phase 2) ────────────────────────
  'tier.badge.aria': 'Aktuelle Reichweite',
  'tier.T0.explain':
    'Sie sehen ausschließlich das, was Ihr eigenes Konto ohnehin erreichen kann. Es wurde keine Administratoreinwilligung erteilt.',
  'tier.T1.explain':
    'Mandantenweiter Lesezugriff ist vorhanden. Schreibzugriff ist weiterhin nicht scharf geschaltet.',
  'tier.T2.explain': 'Mandantenweiter Lesezugriff und scharf geschaltete Schreibvorgänge.',

  'partial.title': 'Diese Sicht ist unvollständig — mit Absicht',
  'partial.body':
    'Einige Ebenen haben weniger als die vollständige Wahrheit geliefert. Jede Lücke ist unten mit ihrem Grund aufgeführt. Nichts davon wird geraten oder ergänzt.',
  'partial.upgradeHint':
    'Mit mandantenweitem Lesezugriff (T1) werden die meisten dieser Lücken zu vollständigen Antworten.',
  'partial.noCollector': 'Dieses Modul hat kein im Browser erreichbares Inventar.',
  'partial.fabric.capped':
    'Nur die ersten {limit} Workspaces wurden in Elemente aufgelöst. Ein benutzerbezogener Lesezugriff kennt keine serverseitige Aggregation; die übrigen werden gezählt, aber nicht aufgeschlüsselt.',
  'partial.entra.firstPage':
    'Es wurde nur die erste Seite der Gruppen gelesen. Der serverseitige Collector liest alle.',
  'partial.entra.ownMembershipOnly':
    'Sichtbar sind nur Ihre eigenen Gruppenmitgliedschaften — also genau die Gruppen, auf die Ihre Berechtigungen kompiliert würden.',
  'partial.pp.serverSideOnly':
    'Die Power-Platform-Admin-APIs sind aus dem Browser nicht erreichbar; auf dieser Stufe gibt es daher kein Inventar. Das Collector-Notebook ergänzt es serverseitig.',
  'partial.agent.serverSideOnly':
    'Die Agent 365 Registry erfordert die Rolle AI Administrator und wird serverseitig erhoben. Es wird bewusst nichts angezeigt statt etwas Irreführendes.',

  // ── Inventar ────────────────────────────────────────────────
  'inventory.title': 'Inventar',
  'inventory.intro':
    'Was tatsächlich existiert, live mit Ihrem eigenen Token gelesen. Dies ist die Grundlage, gegen die das Berechtigungsmodell geprüft wird.',
  'inventory.refresh': 'Aktualisieren',
  'inventory.search': 'Suche',
  'inventory.searchPlaceholder': 'Name, Typ oder Container…',
  'inventory.filter.module': 'Modul',
  'inventory.filter.kind': 'Art',
  'inventory.filter.all': 'Alle',
  'inventory.empty': 'Auf dieser Reichweite wurde nichts gefunden.',
  'inventory.emptyFiltered': 'Keine Treffer für die aktuellen Filter.',
  'inventory.showing': '{shown} von {total} werden angezeigt',
  'inventory.errors': '{count} Objekte konnten nicht gelesen werden',
  'inventory.column.name': 'Name',
  'inventory.column.kind': 'Art',
  'inventory.column.type': 'Typ',
  'inventory.column.scope': 'Container',
  'inventory.column.module': 'Modul',

  'kind.workspace': 'Workspace',
  'kind.fabricItem': 'Fabric-Element',
  'kind.orgApp': 'Org App',
  'kind.group': 'Gruppe',
  'kind.environment': 'Umgebung',
  'kind.agent': 'Agent',

  // ── Governance Model (Phase 4) ───────────────────────────────────
  'model.notProvisioned':
    'Das Governance Model ist noch nicht bereitgestellt. Führen Sie den Bootstrap aus, dann das Model-Notebook, setzen Sie anschließend VITE_GOV_MODEL_ID und bauen Sie neu.',
  'model.collectorNotRun':
    'Das Modell existiert, aber diese Ebene hat noch keine Zeilen — ihr Collector ist noch nicht gelaufen. Das heißt „wir haben nicht nachgesehen“, nicht „es gibt nichts“.',
  'model.queryFailed': 'Die Modellabfrage ist fehlgeschlagen.',

  // ── M-FABRIC ────────────────────────────────────────────────
  'fabric.workspaces.title': 'Workspaces',
  'fabric.workspaces.intro':
    'Fabric kennt keine Rolle pro Elementtyp — ein Contributor kann jeden Elementtyp erstellen, der nicht separat über ein Tenant Setting eingeschränkt ist. Der Workspace ist daher die Einheit, gegen die Berechtigungen formuliert werden.',
  'fabric.col.workspace': 'Workspace',
  'fabric.col.capacity': 'Kapazität',
  'fabric.col.state': 'Status',
  'fabric.stat.workspaces': 'Workspaces',
  'fabric.stat.onCapacity': 'Mit Kapazität',
  'fabric.stat.noCapacity': 'Ohne Kapazität',

  // ── M-PP ───────────────────────────────────────────────────
  'pp.environments.title': 'Umgebungen',
  'pp.environments.intro':
    'Die Zugehörigkeit zu einer Umgebung ist die wichtigste präventive Kontrolle in der Power Platform — und sie benötigt keine Premium-Lizenz. Managed Environments ergänzt proaktive Funktionen, allerdings mit Lizenzkosten.',
  'pp.col.environment': 'Umgebung',
  'pp.col.securityGroup': 'Sicherheitsgruppe',
  'pp.col.managed': 'Managed',
  'pp.col.region': 'Region',
  'pp.flag.sgBound': 'Gebunden',
  'pp.flag.sgMissing': 'Nicht gebunden',
  'pp.flag.sgImpossible': 'Nicht möglich',
  'pp.flag.managedOn': 'Managed',
  'pp.flag.managedOff': 'Nicht managed',
  'pp.stat.environments': 'Umgebungen',
  'pp.stat.unbound': 'Ohne Sicherheitsgruppe',
  'pp.stat.unmanaged': 'Nicht managed',
  'pp.defaultHole.title':
    'Diese Umgebungen lassen sich nicht über eine Gruppe absichern',
  'pp.defaultHole.body':
    'Sicherheitsgruppen können Default- und Developer-Umgebungen nicht zugewiesen werden, und in der Default-Umgebung werden Basic User sowie Environment Maker automatisch vergeben — auch nach einem Opt-out. Es gibt keinen unterstützten Weg, Environment Maker dort zu entfernen. Eindämmen lässt sich das über eine Data Policy, Tenant Isolation und deaktiviertes Share-with-everyone.',

  // ── M-ENTRA ─────────────────────────────────────────────────
  'entra.groups.title': 'Gruppen',
  'entra.groups.intro':
    'Sicherheitsgruppen sind die einzige Währung, die alle vier Ebenen akzeptieren — die meisten Berechtigungen reduzieren sich daher auf eine einzige Gruppenmitgliedschaft.',
  'entra.col.group': 'Gruppe',
  'entra.col.managed': 'Von dieser App verwaltet',
  'entra.col.mail': 'E-Mail',
  'entra.flag.appManaged': 'App-verwaltet',
  'entra.flag.preExisting': 'Schreibgeschützt',
  'entra.stat.groups': 'Gruppen',
  'entra.stat.appManaged': 'App-verwaltet',
  'entra.stat.readOnly': 'Für uns schreibgeschützt',

  // ── M-AGENT ─────────────────────────────────────────────────
  'agent.agents.title': 'Agents',
  'agent.agents.intro':
    'Alle Agents aus Copilot Studio, Agent Builder, SharePoint, Foundry und Drittanbieter-Plattformen — zusammengeführt aus der Agent 365 Registry, Entra Agent ID und der Dataverse-Tabelle bot.',
  'agent.col.name': 'Agent',
  'agent.col.platform': 'Plattform',
  'agent.col.state': 'Status',
  'agent.col.owner': 'Besitzer',
  'agent.col.sponsor': 'Sponsor',
  'agent.col.risk': 'Risiko',
  'agent.stat.total': 'Agents',
  'agent.stat.shadow': 'Shadow',
  'agent.stat.ownerless': 'Ohne Besitzer',
  'agent.stat.drafts': 'Entwürfe',
  'agent.notPreventable':
    'Agent 365 regelt Agents erst nach ihrer Entstehung — es verhindert keine Erstellung, und das Erstellen von Copilot-Studio-Agents lässt sich nicht deaktivieren. Diese Seite ist Inventar und Eindämmung, keine Prävention.',

  // ── Steuerungsarten (Phase 5) ────────────────────────────────────
  'mode.preventiveAuto': 'Präventiv · automatisiert',
  'mode.preventiveManual': 'Präventiv · manuell',
  'mode.detective': 'Nur erkennend',

  // ── Fähigkeiten ──────────────────────────────────────────────
  'cap.read:Report': 'Berichte und Org Apps im Bereich lesen.',
  'cap.create:PowerBIReport':
    'Power-BI-Berichte erstellen. Fabric kann dies nicht vom Erstellen semantischer Modelle trennen — beides erfordert Contributor.',
  'cap.create:SemanticModel':
    'Semantische Modelle erstellen. Teilt sich die Contributor-Rolle mit der Berichtserstellung; Fabric kennt keine Rolle pro Elementtyp.',
  'cap.create:FabricItem':
    'Fabric-Elemente erstellen — Lakehouses, Notebooks, Pipelines. Gesteuert über die Workspace-Rolle und das Tenant Setting „Users can create Fabric items“.',
  'cap.create:FabricDataAgent':
    'Fabric Data Agents erstellen. Es gibt keinen eigenen Schalter dafür; gesteuert über die Copilot-Kapazitätseinstellung und die Workspace-Rolle.',
  'cap.create:FabricApp':
    'Fabric-App-Elemente erstellen. Gesteuert über ein Preview-Tenant-Setting.',
  'cap.create:Workspace':
    'Fabric-Workspaces erstellen. Tenant Setting „Create workspaces“, eingeschränkt auf eine Sicherheitsgruppe.',
  'cap.create:OrgApp':
    'Org Apps erstellen und veröffentlichen. Erfordert Admin, Member oder Contributor im Workspace.',
  'cap.manage:OrgAppAudience':
    'Verwalten, wer zu einer Org-App-Audience gehört. Nur im Portal möglich — es gibt keine öffentliche API, daher eine geführte Aufgabe mit anschließender Prüfung.',
  'cap.create:CanvasApp':
    'Canvas Apps erstellen. Nur über Environment Maker — benutzerdefinierte Sicherheitsrollen werden für Canvas-App-Maker-Szenarien nicht unterstützt.',
  'cap.create:ModelDrivenApp':
    'Modellgesteuerte Apps erstellen. Environment Maker oder System Customizer.',
  'cap.create:Flow': 'Power-Automate-Cloud-Flows in der Umgebung erstellen.',
  'cap.create:CopilotStudioAgent':
    'Copilot-Studio-Agents erstellen. Pro Umgebung tatsächlich präventiv über Rechte auf der Tabelle bot — mandantenweit lässt sich das Erstellen jedoch nicht deaktivieren.',
  'cap.create:M365DeclarativeAgent':
    'Deklarative Agents in Microsoft 365 Copilot erstellen. Nur über das Admin Center, keine dokumentierte API.',
  'cap.manage:AgentBlueprint':
    'Agent Identity Blueprints verantworten — die einzige präventive Kontrolle auf Klassenebene, die jede Instanz erbt.',
  'cap.app:Approve': 'Zugriffsanfragen für den Bereich genehmigen.',
  'cap.app:Administer': 'Personas, Module und Schreib-Gates in dieser App verwalten.',
  'cap.app:Audit': 'Alles lesen, einschließlich des Audit-Trails.',

  // ── Personas & Rezepte ────────────────────────────────────────
  'personas.title': 'Personas & Rezepte',
  'personas.intro':
    'Personas bilden Ihr Rollenmodell ab und sind vollständig editierbar. Fähigkeiten und Binding-Rezepte sind es nicht — sie bilden dokumentiertes Plattformverhalten ab, und die Möglichkeit, eine dokumentierte Unmöglichkeit zu „korrigieren“, würde dieses Werkzeug zum Lügen bringen.',
  'personas.add': 'Neue Persona',
  'personas.edit': 'Bearbeiten',
  'personas.reset': 'Auf Auslieferungsstand zurücksetzen',
  'personas.show': 'Fähigkeiten anzeigen',
  'personas.hide': 'Ausblenden',
  'personas.save': 'Speichern',
  'personas.cancel': 'Abbrechen',
  'personas.custom': 'Eigene',
  'personas.inactive': 'Inaktiv',
  'personas.compileError': 'Kompiliert nicht',
  'personas.unknownCapability': 'ist keine bekannte Fähigkeit',
  'personas.moduleOff':
    'Das Modul {module} ist ausgeschaltet, daher gewährt diese Fähigkeit derzeit nichts.',
  'personas.compilesTo': 'Kompiliert zu {count} Bindings',
  'personas.seedOnly':
    'Das App-Backend ist nicht erreichbar; angezeigt wird der Auslieferungsstand. Änderungen können derzeit nicht gespeichert werden.',
  'personas.saveFailed':
    'Speichern nicht möglich — das App-Backend ist nicht erreichbar.',
  'personas.stat.total': 'Personas',
  'personas.stat.capabilities': 'Fähigkeiten',
  'personas.stat.broken': 'Kompilieren nicht',
  'personas.editor.title': 'Persona bearbeiten',
  'personas.field.id': 'Id',
  'personas.field.name': 'Name',
  'personas.field.description': 'Beschreibung',
  'personas.field.riskTier': 'Risikostufe',
  'personas.field.active': 'Aktiv',
  'personas.field.capabilities': 'Fähigkeiten',

  // ── Can-Do Explorer (Phase 6) ─────────────────────────────────────
  'cando.title': 'Can-Do Explorer',
  'cando.intro':
    'Wer darf gerade jetzt was erstellen — abgeleitet aus dem, was die Collectors tatsächlich gefunden haben, mitsamt Begründung. Nicht was beabsichtigt war, sondern was zutrifft.',
  'cando.direction.who': 'Wer darf…',
  'cando.direction.what': 'Was darf…',
  'cando.capability': 'Fähigkeit',
  'cando.principal': 'Person oder Gruppe',
  'cando.principalPlaceholder': 'Nach Namen suchen…',
  'cando.includeBlocked': 'Blockierte einbeziehen',
  'cando.showPath': 'Warum?',
  'cando.hidePath': 'Ausblenden',
  'cando.showMembers': 'Wer genau?',
  'cando.hideMembers': 'Personen ausblenden',
  'cando.moreMembers': '…und {count} weitere',
  'cando.viaGroup': 'über {group}',
  'cando.noneCan': 'In den erhobenen Daten besitzt niemand diese Fähigkeit.',
  'cando.pickPrincipal': 'Wählen Sie oben eine Person oder Gruppe aus.',
  'cando.noPrincipals': 'Keine Treffer.',
  'cando.status.granted': 'Gewährt',
  'cando.status.blocked': 'Blockiert',
  'cando.status.unknown': 'Unbekannt',
  'cando.incomplete':
    'Einige Quellen konnten nicht gelesen werden; diese Antwort ist daher unvollständig und unterschätzt die tatsächlichen Rechte.',
  'cando.emptySources':
    'Diese Quellen sind leer; alles, was sie gewährt hätten, fehlt hier: {tables}',
  'cando.everyone.title': 'Alle im Mandanten besitzen dies',
  'cando.everyone.body':
    'Mindestens eine Kontrolle gewährt dies der gesamten Organisation — typischerweise ein für alle aktiviertes Tenant Setting oder die Default-Umgebung, in der Environment Maker automatisch vergeben wird und sich nicht entfernen lässt.',
  'cando.reach': 'Reichweite je Fähigkeit',
  'cando.reach.everyone': 'Alle',
  'cando.reach.count': '{count} Prinzipale',
  'cando.reach.partlyUnknown': 'teilweise unbekannt',

  // ── Drift (Phase 7) ─────────────────────────────────────────────
  'drift.title': 'Drift',
  'drift.intro':
    'Erfasste Berechtigungen im Vergleich zu den tatsächlich erhobenen Rechten. Fehlend bedeutet, dass die Plattform ein Versprechen nicht einlöst; Überschüssig bedeutet Zugriff, den niemand beantragt hat.',
  'drift.type.Missing': 'Fehlend',
  'drift.type.Extra': 'Überschüssig',
  'drift.type.Blocked': 'Blockiert',
  'drift.type.Unknown': 'Unbekannt',
  'drift.none': 'Kein Drift für die aktuellen Filter.',
  'drift.autoRemediable': 'Kann automatisch behoben werden',
  'drift.neverAuto': 'Wird niemals automatisch entfernt',
  'drift.extraNote':
    'Überschüssiger Zugriff wird gemeldet, aber nie automatisch entzogen. Automatischer Entzug ist der Weg, auf dem ein Governance-Werkzeug einen Ausfall verursacht — das Entfernen bleibt immer eine bewusste menschliche Entscheidung.',
  'drift.noEntitlements':
    'Es sind noch keine Berechtigungen erfasst, daher erscheint jedes Recht als überschüssig. Erfassen Sie zuerst die Absicht unter Berechtigungen — dies ist ein Ausgangspunkt, keine Befundliste.',
  'drift.noStore':
    'Der Berechtigungsspeicher ist nicht erreichbar, es gibt also keinen Sollzustand zum Vergleich. Alles Folgende ist einseitig.',

  // ── Richtlinien (Phase 7) ─────────────────────────────────────
  'policies.title': 'Richtlinien',
  'policies.intro':
    'Das mitgelieferte Regelwerk, ausgewertet gegen die erhobenen Daten. Regeln, deren Daten noch nicht erhoben werden können, werden als ausstehend geführt statt ausgeblendet — ein Regelwerk, das Regeln stillschweigend übergeht, erzeugt falsche Sicherheit.',
  'policies.findings': 'Befunde',
  'policies.noFindings': 'Keine Befunde für den aktuellen Filter.',
  'policies.rules': 'Regelwerk',
  'policies.pending': 'Ausstehend',
  'policies.pendingNote':
    '{count} Regeln können noch nicht ausgewertet werden. Jede nennt genau, auf welche Daten sie wartet.',
  'policies.col.id': 'Id',
  'policies.col.statement': 'Prüft',
  'policies.col.module': 'Modul',
  'policies.col.findings': 'Befunde',
  'policies.stat.rules': 'Regeln',
  'policies.stat.active': 'Aktiv ausgewertet',
  'policies.stat.findings': 'Befunde',

  // ── Berechtigungen (Phase 7) ─────────────────────────────────
  'entitlements.title': 'Berechtigungen',
  'entitlements.intro':
    'Wer welche Persona in welchem Bereich haben soll. Das ist der Sollzustand, gegen den Drift gemessen wird.',
  'entitlements.noWriteNotice':
    'Das Erfassen einer Berechtigung ändert nichts in einer Steuerungsebene. Es beschreibt nur die Absicht, damit Sie die Lücke sehen, lange bevor ein Schreib-Gate scharf geschaltet ist.',
  'entitlements.add': 'Berechtigung erfassen',
  'entitlements.record': 'Erfassen',
  'entitlements.current': 'Erfasste Berechtigungen',
  'entitlements.none': 'Noch nichts erfasst.',
  'entitlements.revoke': 'Zurücknehmen',
  'entitlements.field.principal': 'Person oder Gruppe',
  'entitlements.field.persona': 'Persona',
  'entitlements.field.scope': 'Bereich',
  'entitlements.field.validUntil': 'Gültig bis (optional)',
  'entitlements.validUntil': 'Gültig bis {date}',
  'entitlements.expired': 'Abgelaufen am {date}',
  'entitlements.saveFailed':
    'Speichern nicht möglich — das App-Backend ist nicht erreichbar.',
  'entitlements.storeUnavailable':
    'Der Berechtigungsspeicher ist nicht erreichbar. Bis das App-Backend bereitgestellt ist, kann nichts erfasst werden.',
  'entitlements.noPrincipals':
    'In den erhobenen Daten wurden keine Prinzipale gefunden; es gibt also noch niemanden zu berechtigen.',

  // ── Absicherung der Default-Umgebung (Phase 7) ──────────────────────
  'posture.title': 'Absicherung der Default-Umgebung',
  'posture.intro':
    'Sechs Maßnahmen zur Eindämmung für die eine Umgebung, deren Zugehörigkeit sich nicht steuern lässt. Alle sind lizenzfrei, keine benötigt Managed Environments.',
  'posture.score': 'Umgesetzte Maßnahmen',
  'posture.scoreExplain':
    '{known} von {total} Maßnahmen ließen sich aus den erhobenen Daten bestimmen. Unbekannte Maßnahmen gelten nie als erfüllt.',
  'posture.environment': 'Default-Umgebung: {name}',
  'posture.noEnvironment':
    'Es wurde noch keine Default-Umgebung erhoben; bewertet werden daher nur mandantenweite Einstellungen.',
  'posture.status.pass': 'Umgesetzt',
  'posture.status.fail': 'Fehlt',
  'posture.status.unknown': 'Unbekannt',
  'posture.unknownNote':
    'Unbekannt heißt, dass wir nicht nachsehen konnten — nicht, dass die Maßnahme fehlt. Nichts davon wird geraten.',
  'posture.lever.dlpDefaultBlocked':
    'Data Policy blockiert neue Konnektoren standardmäßig',
  'posture.lever.dlpCustomConnectorUrls':
    'URL-Muster für benutzerdefinierte Konnektoren sind blockiert',
  'posture.lever.tenantIsolation': 'Tenant Isolation ist aktiv',
  'posture.lever.disableShareWithEveryone':
    'Teilen von Apps mit allen ist deaktiviert',
  'posture.lever.restrictEnvironmentCreation':
    'Erstellen von Umgebungen und Testumgebungen ist auf Administratoren beschränkt',
  'posture.lever.exchangeTransportRule':
    'Exchange-Transportregel für den Konnektor Office 365 Outlook',

  // ── Schreib-Gates (Phase 8) ──────────────────────────────────────
  'writes.title': 'Schreib-Gates',
  'writes.intro':
    'Vier Gates stehen zwischen diesem Werkzeug und jeder Änderung an einer Steuerungsebene. Alle vier müssen erfüllt sein — jedes Mal, für jeden Schreibvorgang.',
  'writes.serverSideNotice':
    'Alles auf dieser Seite konfiguriert, was das Actuator-Notebook akzeptiert. Das Notebook liest diese Konfiguration erneut und bewertet alle vier Gates bei jedem Aufruf serverseitig — der App wird dabei nicht vertraut. Die App kann weder selbst in eine Steuerungsebene schreiben noch ihren eigenen Dry-Run-Nachweis fälschen.',
  'writes.armed': 'Scharf',
  'writes.disarmed': 'Entschärft',
  'writes.notWritable': 'Manuelle Kontrolle — wird nie geschrieben',
  'writes.saveFailed':
    'Speichern nicht möglich — es wurde nichts scharf geschaltet. Das App-Backend ist nicht erreichbar.',
  'writes.actuatorMissing':
    'Das Actuator-Notebook ist nicht konfiguriert. Setzen Sie VITE_GOV_ACTUATOR_NOTEBOOK_ID nach dem Deployment.',
  'writes.noExitValue':
    'Der Actuator lief, hat aber kein Ergebnis zurückgegeben. Prüfen Sie den Notebook-Lauf in Fabric, bevor Sie annehmen, dass sich etwas geändert hat.',
  'writes.dryRunOk':
    'Dry Run erfolgreich — Gate 4 ist für diese Art und diesen Bereich jetzt erfüllt.',

  'writes.gate1.title': 'Gate 1 · Hauptschalter',
  'writes.gate1.help':
    'Ein Klick entschärft alles, in jeder Ebene. Wird ausgeschaltet ausgeliefert und bleibt es, bis jemand bewusst etwas anderes entscheidet.',
  'writes.gate2.title': 'Gate 2 · Scharf geschaltete Binding-Arten',
  'writes.gate2.help':
    'Schalten Sie jeweils eine Änderungsart scharf. Ein Werkzeug mit einem einzigen globalen Schreibschalter ist ein mandantenweiter Vorfall mit Anlauf.',
  'writes.gate3.title': 'Gate 3 · Positivliste der Bereiche',
  'writes.gate3.help':
    'Workspace-, Umgebungs- oder Kapazitäts-Ids, die dieses Werkzeug anfassen darf. Ein Pilot läuft gegen drei Workspaces, nicht gegen den Mandanten.',
  'writes.gate4.title': 'Gate 4 · Vorheriger erfolgreicher Dry Run',
  'writes.gate4.noScopes':
    'Ergänzen Sie oben einen konkreten Bereich. Ein Platzhalter lässt sich nicht als Dry Run prüfen und kann Gate 4 daher nie erfüllen.',
  'writes.noScopes': 'Noch keine Bereiche erlaubt — es kann nirgends geschrieben werden.',
  'writes.scopePlaceholder': 'Workspace- oder Umgebungs-Id',
  'writes.addScope': 'Bereich hinzufügen',
  'writes.removeScope': '{scope} entfernen',
  'writes.wildcardWarning':
    'Der Platzhalter erlaubt jeden Bereich. Gate 4 gilt weiterhin pro Bereich, aber die Pilotgrenze entfällt damit.',
  'writes.runDryRun': 'Dry Run',
  'writes.licenceWarning':
    'Das Scharfschalten ändert nicht nur den Zugriff, sondern die Lizenzsituation der Umgebung:',
  'writes.dryRun.fresh': 'Dry Run gültig · noch {days} T',
  'writes.dryRun.expired': 'Dry Run abgelaufen',
  'writes.dryRun.never': 'Nie im Dry Run geprüft',

  'writes.audit.title': 'Audit-Trail',
  'writes.audit.help':
    'Append-only, geschrieben vom Actuator. Jeder Versuch steht hier — auch Ablehnungen, denn eine Ablehnung, die niemand festgehalten hat, ist von einem nie erfolgten Schreibvorgang nicht zu unterscheiden.',
  'writes.audit.empty': 'Es wurde noch nichts versucht.',
  'writes.audit.search': 'Person, Aktion, Ziel…',
  'writes.audit.when': 'Zeitpunkt',
  'writes.audit.actor': 'Ausgelöst von',
  'writes.audit.action': 'Aktion',
  'writes.audit.target': 'Ziel',
  'writes.audit.outcome': 'Ergebnis',
  'writes.audit.detail': 'Detail',
  'writes.audit.unreadable':
    'Diese Protokolle konnten nicht gelesen werden; der Trail ist daher unvollständig: {tables}',
  'writes.outcome.Success': 'Erfolgreich',
  'writes.outcome.Planned': 'Geplant (Dry Run)',
  'writes.outcome.Refused': 'Abgelehnt',
  'writes.outcome.Failed': 'Fehlgeschlagen',

  // ── Anträge (Phase 9) ────────────────────────────────────────
  'requests.title': 'Anträge',
  'requests.intro':
    'Beantragen Sie, etwas an einer bestimmten Stelle erstellen zu dürfen. Eine genehmigende Person entscheidet; die Genehmigung erfasst die Berechtigung und wendet sie über die Schreib-Gates an.',
  'requests.new': 'Neuer Antrag',
  'requests.submit': 'Antrag stellen',
  'requests.submitted':
    'Antrag gestellt — er liegt jetzt in der Warteschlange zur Genehmigung.',
  'requests.submitFailed':
    'Antrag konnte nicht gestellt werden — das App-Backend ist nicht erreichbar.',
  'requests.withdraw': 'Zurückziehen',
  'requests.withdrawFailed': 'Der Antrag konnte nicht zurückgezogen werden.',
  'requests.mine': 'Meine Anträge',
  'requests.none': 'Sie haben noch nichts beantragt.',
  'requests.storeUnavailable':
    'Der Antragsspeicher ist nicht erreichbar; es kann derzeit nichts gestellt oder angezeigt werden.',
  'requests.field.persona': 'Persona',
  'requests.field.scope': 'Bereich',
  'requests.field.justification': 'Wozu benötigen Sie das?',
  'requests.justificationPlaceholder':
    'Was Sie vorhaben und für welches Projekt oder Team…',
  'requests.justificationTooShort':
    'Die genehmigende Person braucht genug zum Beurteilen — ein paar Worte mehr.',
  'requests.youWouldGet': 'Diese Persona würde Ihnen erlauben:',
  'requests.noBindings':
    'Diese Persona kompiliert in diesem Bereich zu nichts; eine Genehmigung würde nichts ändern. Wählen Sie einen anderen Bereich.',
  'requests.darkBindings':
    '{count} davon benötigen ein derzeit ausgeschaltetes Modul und würden bis dahin nichts gewähren.',
  'requests.capabilityCount': '{count} Fähigkeiten',
  'requests.status.Pending': 'Wartet auf Genehmigung',
  'requests.status.Approved': 'Genehmigt · angewendet, noch nicht bestätigt',
  'requests.status.Denied': 'Abgelehnt',
  'requests.status.Failed': 'Nicht angewendet',
  'requests.status.Verified': 'Bestätigt',
  'requests.status.Withdrawn': 'Zurückgezogen',

  // ── Genehmigungen (Phase 9) ───────────────────────────────────
  'approvals.title': 'Genehmigungen',
  'approvals.intro':
    'Eine Genehmigung erfasst zuerst die Berechtigung, wendet dann die kompilierten Bindings über die vier Schreib-Gates an und bestätigt anschließend durch erneutes Lesen der Steuerungsebene.',
  'approvals.queue': 'Wartet auf Entscheidung',
  'approvals.queueEmpty': 'Es wartet nichts.',
  'approvals.approve': 'Genehmigen',
  'approvals.deny': 'Ablehnen',
  'approvals.verify': 'Bestätigen',
  'approvals.notePlaceholder': 'Hinweis für die antragstellende Person (optional)…',
  'approvals.willWrite': 'Die Genehmigung schreibt:',
  'approvals.nothingToApply':
    'Es würde nichts geschrieben. Der Antrag ist so nicht erfüllbar.',
  'approvals.darkBindings':
    '{count} weitere Bindings gehören zu einem ausgeschalteten Modul und werden übersprungen.',
  'approvals.applied':
    'Genehmigt — {count} Bindings angewendet. Bestätigen Sie, um den Kreis zu schließen.',
  'approvals.applyFailed': 'Genehmigt, aber nicht angewendet: {detail}',
  'approvals.denied': 'Abgelehnt.',
  'approvals.actionFailed': 'Die Entscheidung konnte nicht festgehalten werden.',
  'approvals.verified':
    'Bestätigt — die Steuerungsebene gewährt jetzt das Zugesagte, und die Drift-Zeile ist geschlossen.',
  'approvals.notYetEffective':
    'Noch nicht wirksam. Es fehlt weiterhin: {missing}. Manche Änderungen brauchen Minuten; lassen Sie den Collector erneut laufen und bestätigen Sie noch einmal.',
  'approvals.notApprover':
    'Sie stehen nicht auf der Genehmigerliste und können diese Warteschlange daher lesen, aber nicht entscheiden. Genehmigende werden in den Einstellungen gepflegt.',
  'approvals.noSelfApproval':
    'Sie können Ihren eigenen Antrag nicht entscheiden. Eine Genehmigungskette aus einer Person ist keine Genehmigungskette.',
  'approvals.awaiting': 'Genehmigt — Bestätigung ausstehend',
  'approvals.awaitingHelp':
    'Angewendet, aber in der Steuerungsebene noch nicht bestätigt. Bis zur Bestätigung ist ein Antrag ein Versprechen, keine Tatsache.',
  'approvals.awaitingEmpty': 'Es wartet nichts auf Bestätigung.',
  'approvals.stat.pending': 'Offen',
  'approvals.stat.awaiting': 'Bestätigung ausstehend',
  'approvals.stat.verified': 'Bestätigt',
  'approvals.licenceFree':
    'Verbraucht keine Premium-Lizenz und benötigt keine Managed Environments.',
  'approvals.licenceTrigger':
    'Achtung — {kinds} würde eine Premium-Lizenz zur Voraussetzung für die aktive Nutzung dieser Umgebung machen.',

  // ── Aufgaben (Phase 11) ─────────────────────────────────────────
  'tasks.title': 'Aufgaben',
  'tasks.intro':
    'Kontrollen ohne Schreib-API. Das Werkzeug kann diese nicht ausführen und übergibt sie deshalb mit dem genauen Klickpfad — und sagt ehrlich, ob und wie sich das Ergebnis nachweisen lässt.',
  'tasks.queue': 'Wartet auf Erledigung',
  'tasks.queueEmpty': 'Es wartet nichts.',
  'tasks.done': 'Abgeschlossen',
  'tasks.doneEmpty': 'Noch nichts abgeschlossen.',
  'tasks.none': 'Es wurden noch keine Aufgaben erzeugt.',
  'tasks.storeUnavailable':
    'Der Aufgabenspeicher ist nicht erreichbar; es kann derzeit nichts erzeugt oder abgeschlossen werden.',
  'tasks.openPortal': 'Portal öffnen',
  'tasks.steps': 'Was zu tun ist',
  'tasks.claim': 'Übernehme ich',
  'tasks.attest': 'Als erledigt melden',
  'tasks.verify': 'Jetzt prüfen',
  'tasks.cancel': 'Wird nicht gemacht',
  'tasks.reopen': 'Wieder öffnen',
  'tasks.actionFailed': 'Das konnte nicht gespeichert werden.',
  'tasks.attestPrompt': 'Was haben Sie geändert? (wird als Ihre Aussage festgehalten)',
  'tasks.cancelPrompt': 'Warum wird das nicht gemacht?',

  'tasks.status.Open': 'Offen',
  'tasks.status.InProgress': 'In Arbeit',
  'tasks.status.Attested': 'Als erledigt gemeldet',
  'tasks.status.Verified': 'Bestätigt',
  'tasks.status.Cancelled': 'Wird nicht gemacht',

  'tasks.stat.open': 'Offen',
  'tasks.stat.overdue': 'Überfällig',
  'tasks.stat.attestationOnly': 'Maschinell nicht prüfbar',

  'tasks.verification.machine':
    'Kann durch erneutes Lesen der Steuerungsebene bestätigt werden',
  'tasks.verification.attestation': 'Nur eine Person kann das bezeugen',
  'tasks.attestedBy': 'Als erledigt gemeldet von {actor}',
  'tasks.verifiedNote': 'Durch erneutes Lesen der Steuerungsebene bestätigt.',
  'tasks.attestationWarning':
    'Das ist eine Aussage, kein Nachweis. Es gibt keine API, um das zurückzulesen — die App hält daher fest, wer es wann gesagt hat, und nennt es niemals bestätigt.',
  'tasks.honesty':
    '{count} davon lassen sich niemals maschinell bestätigen. Das ist eine Eigenschaft der Plattform, nicht dieses Werkzeugs.',

  'task.orgAppAudience.title': 'Gruppe zu einer Org-App-Audience hinzufügen',
  'task.m365AgentAccess.title': 'Zugriff auf Microsoft 365 Copilot Agents einschränken',
  'task.a365Registry.title': 'Agent-365-Registry-Aktion anwenden',
  'task.ppRouting.title': 'Routing der Default-Umgebung konfigurieren',
  'task.fabricItemPermission.title': 'Elementbezogene Berechtigung korrigieren',
};
