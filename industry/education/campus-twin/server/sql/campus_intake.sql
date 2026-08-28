-- ================================================================================================
-- Intake tables for the Copilot path (PLAN §41.7, revised 2026-08-21).
--
-- Target: the EXISTING Fabric **SQL Database** for this project (the same one that holds
--         dbo.PlanAssignments / dbo.PlanChanges / dbo.Teachers / dbo.TeacherAvailabilities).
--         ⚠️ Its workspace, item id, server host and database name are NOT written down here:
--         they come from FABRIC_SQL_SERVER / FABRIC_SQL_DATABASE via tools/fabric/fabric_ids.py.
--         One deployment's coordinates are not a thing a template should know.
--
--   tools/fabric_intake/apply_schema.py        (idempotent, applies this file)
--
-- ⚠️ THIS FILE USED TO TARGET A NEW FABRIC **WAREHOUSE**, AND THAT WAS A MISTAKE.
-- The premise was right as far as it went: the Lakehouse SQL endpoint is read only (§41.6). The
-- error was concluding that a Warehouse was therefore needed. This workspace already has a
-- read-write Fabric SQL Database for this project holding 1930 plan assignments, 723 teachers and
-- **2173 rows of dbo.TeacherAvailabilities**, which is the same fact the intake path collects.
-- CampusIntake would have created a second model of "who is unavailable when", and two models of
-- one fact eventually disagree. Found 2026-08-21 by listing the workspace before creating anything.
--
-- ⚠️ SEPARATE TABLES, ONE DATABASE. §41.7's distinction still holds, and it is the reason these are
-- not extra columns on TeacherAvailabilities: this schema holds what somebody ASKED FOR, which is
-- not yet true of the timetable. Only an ACCEPTED request becomes a row in TeacherAvailabilities.
-- A pending request visible as an availability would be a wish presented as a fact.
--
-- ⚠️ EVERYTHING THE WAREHOUSE VERSION COULD NOT DO, THIS ENGINE DOES. Measured on the live database
-- (EngineEdition 12, product 12.0.2000.8): enforced PRIMARY KEY, DEFAULT constraints, CHECK
-- constraints, nvarchar, READ_COMMITTED_SNAPSHOT = ON. The previous file carried long comments
-- explaining that the database would not stop a duplicate id or an invalid status and that the
-- application was the only thing standing between the schema and garbage. Here it is not.
-- ================================================================================================


-- ------------------------------------------------------------------------------------------------
-- Who is this person, and what may they do.
-- ------------------------------------------------------------------------------------------------
-- ⚠️ NAMED `IntakeIdentity`, NOT `TeacherIdentity`. `dbo.Teachers` already exists with 723 rows and
-- holds the `teacherId` this table points at; a second table with a near-identical name in the same
-- schema is how somebody later joins the wrong one. `dbo.Users (Id, Email)` also exists but is
-- empty and has neither site nor role, so it cannot carry an authorisation decision.
--
-- ⚠️ THE PRIMARY KEY IS ENFORCED HERE. On Warehouse it could not be, so `resolve_identity` had to
-- read two rows and refuse when it saw both, defending against a seed script run twice. That
-- defence stays, but the database will no longer let the situation arise in the first place.
IF OBJECT_ID('dbo.IntakeIdentity') IS NULL
CREATE TABLE dbo.IntakeIdentity (
    oid          nvarchar(64)   NOT NULL,
    site         nvarchar(32)   NOT NULL,
    upn          nvarchar(256)  NULL,       -- for humans reading the table; never used to authorise
    teacherId    nvarchar(128)  NULL,       -- points at dbo.Teachers.teacherId
    role         nvarchar(16)   NOT NULL CONSTRAINT CK_IntakeIdentity_role
                                CHECK (role IN ('teacher', 'planner')),
    provenance   nvarchar(64)   NULL,       -- 'surname-unique' | 'explicit-planner' | 'manual'
    -- ⚠️ WHICH CAMPUS TO ASSUME WHEN THE CALLER NAMES NONE. Somebody really can teach at two, and
    -- without this the router had to refuse and ask every single time, which is a question a
    -- professor should not be asked twice. Flagging one does NOT weaken the rule that an explicit
    -- site always wins, and it does not remove the refusal: it only narrows it to people who are
    -- genuinely at several campuses with no preference recorded.
    isPrimary    bit            NOT NULL CONSTRAINT DF_IntakeIdentity_isPrimary DEFAULT 0,
    createdAt    datetime2(6)   NOT NULL CONSTRAINT DF_IntakeIdentity_createdAt
                                DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_IntakeIdentity PRIMARY KEY (oid, site)
);
GO

-- ⚠️ Additive migration for a table that already exists. The script is meant to be run repeatedly,
-- so every step here has to be a no-op the second time. `DEFAULT 0` means existing rows keep the
-- old behaviour exactly: nobody becomes primary by accident, and a person at one site never needed
-- the flag in the first place.
IF COL_LENGTH('dbo.IntakeIdentity', 'isPrimary') IS NULL
    ALTER TABLE dbo.IntakeIdentity
        ADD isPrimary bit NOT NULL CONSTRAINT DF_IntakeIdentity_isPrimary DEFAULT 0;
GO


-- ------------------------------------------------------------------------------------------------
-- A costed what-if, held long enough to be submitted against.
-- ------------------------------------------------------------------------------------------------
-- ⚠️ DURABLE ON PURPOSE (§41.17.4). Keeping previews in a module-level dict is wrong twice over:
-- the container scales to zero between the question and the confirmation, and §24.4 already runs
-- two replicas, so the confirmation can land on a process that never saw the question.
--
-- ⚠️ `usedAt` MAKES IT SINGLE USE, and that claim is now MEASURED rather than assumed. Ten threads
-- racing `UPDATE ... WHERE previewId = ? AND usedAt IS NULL` produced exactly one rowcount of 1 on
-- this engine WITH RCSI ON (tools/tests/live_conditional_update.py, 2026-08-21). Without it, a
-- retrying agent files the same request twice and nobody can tell whether one or two were meant.
IF OBJECT_ID('dbo.IntakePreview') IS NULL
CREATE TABLE dbo.IntakePreview (
    previewId    uniqueidentifier NOT NULL CONSTRAINT PK_IntakePreview PRIMARY KEY,
    site         nvarchar(32)     NOT NULL,
    -- ⚠️ THE IMMUTABLE ENTRA `oid`, NOT THE UPN. A UPN can be renamed, and binding ownership to it
    -- reintroduces exactly the bug IntakeIdentity keys on `oid` to avoid.
    requestedBy  nvarchar(64)     NOT NULL,
    constraints  nvarchar(max)    NOT NULL,  -- JSON: exactly the `forbid` list handed to CP-SAT
    result       nvarchar(max)    NOT NULL,  -- JSON: the impact figures the professor was shown
    planVersion  nvarchar(32)     NOT NULL,
    ruleVersion  nvarchar(32)     NULL,
    createdAt    datetime2(6)     NOT NULL CONSTRAINT DF_IntakePreview_createdAt
                                  DEFAULT SYSUTCDATETIME(),
    expiresAt    datetime2(6)     NOT NULL,
    usedAt       datetime2(6)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_IntakePreview_owner')
    CREATE INDEX IX_IntakePreview_owner ON dbo.IntakePreview (requestedBy, site) INCLUDE (usedAt);
GO


-- ------------------------------------------------------------------------------------------------
-- The request itself. Pending until a human in the planning office decides.
-- ------------------------------------------------------------------------------------------------
-- ⚠️ NOTHING IN THIS TABLE BINDS ANYTHING. A row here is a stated wish. Accepting it flips `status`
-- and may then write a row to dbo.TeacherAvailabilities; publishing a PLAN stays in the cockpit
-- (§26.5, confirmed 2026-08-21). There is deliberately no `publishedAt` column: if the schema
-- cannot express "this request published a plan", no later code can quietly start doing it.
IF OBJECT_ID('dbo.IntakeRequest') IS NULL
CREATE TABLE dbo.IntakeRequest (
    requestId         uniqueidentifier NOT NULL CONSTRAINT PK_IntakeRequest PRIMARY KEY,
    site              nvarchar(32)     NOT NULL,
    -- ⚠️ CHECKED, not merely documented. `room_issue` and `move_request` were once accepted by the
    -- API and costed as availability changes. The database now refuses a kind nobody modelled.
    -- Widen this constraint in the SAME change that teaches the solver the new shape.
    kind              nvarchar(32)     NOT NULL CONSTRAINT CK_IntakeRequest_kind
                                       CHECK (kind IN ('availability')),
    status            nvarchar(16)     NOT NULL CONSTRAINT DF_IntakeRequest_status DEFAULT 'pending',

    -- Who asked. `teacherId` is resolved SERVER SIDE from the token, never taken from the body.
    -- `submittedByOid` is what ownership and "my requests" match on; the UPN and name are for
    -- humans reading the queue and never decide anything.
    submittedByOid    nvarchar(64)     NOT NULL,
    submittedByUpn    nvarchar(256)    NOT NULL,
    submittedByName   nvarchar(400)    NULL,
    teacherId         nvarchar(128)    NULL,

    payload           nvarchar(max)    NULL,   -- JSON: the typed constraint, machine readable

    -- ⚠️ THERE IS NO FREE-TEXT COLUMN, AND THAT IS THE POINT. An earlier version had
    -- `utteranceRedacted`, filled by a German causal-marker blocklist. That is not a privacy
    -- boundary: "Meine Tochter ist krank" has no marker and is third-party health data;
    -- "Ich habe freitags Chemotherapie" is Art. 9 DSGVO data; English has no German marker to find.
    -- A blocklist removes only what somebody thought of. §9.1 item 11 asks for the reason to be
    -- UNSTORABLE, so there is nowhere to put one.
    -- ⚠️ NB dbo.TeacherAvailabilities has `note nvarchar(400) NOT NULL`. The intake path writes ''
    -- into it and must never be changed to forward a requester's words.

    previewId         uniqueidentifier NULL,
    sourceChannel     nvarchar(32)     NULL,   -- 'copilot' | 'cockpit' | 'api'
    correlationId     nvarchar(64)     NULL,

    -- ⚠️ IMPACT AS AT SUBMIT TIME, NOT NOW (§41.7 property 2). `list_queue` returns these under the
    -- key `impactAtSubmit` precisely so a panel cannot render a three-week-old "4 Termine" as
    -- current. These numbers are history the moment they are written.
    impactSessions    int              NULL,
    impactMoves       int              NULL,
    impactFeasible    bit              NULL,
    planVersion       nvarchar(32)     NULL,
    ruleVersion       nvarchar(32)     NULL,

    createdAt         datetime2(6)     NOT NULL CONSTRAINT DF_IntakeRequest_createdAt
                                       DEFAULT SYSUTCDATETIME(),
    expiresAt         datetime2(6)     NULL,

    decidedByUpn      nvarchar(256)    NULL,
    decidedAt         datetime2(6)     NULL,
    decisionNote      nvarchar(1000)   NULL,
    appliedRows       int              NULL,   -- rows written to TeacherAvailabilities on accept
    failureReason     nvarchar(1000)   NULL,

    CONSTRAINT CK_IntakeRequest_status
        CHECK (status IN ('pending', 'accepted', 'rejected', 'failed'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_IntakeRequest_queue')
    CREATE INDEX IX_IntakeRequest_queue ON dbo.IntakeRequest (site, status, createdAt DESC);
GO


-- ------------------------------------------------------------------------------------------------
-- Append only. What happened, in order, and who it was.
-- ------------------------------------------------------------------------------------------------
-- ⚠️ `actorRole` IS STAMPED AS AT THAT MOMENT and is never joined back to IntakeIdentity for
-- display. Resolving the role live would let a later edit to IntakeIdentity silently rewrite the
-- history of who was allowed to do what, which is the one thing an audit trail must not permit.
--
-- ⚠️ `occurredAt`, not `at`. `AT` collides with T-SQL's `AT TIME ZONE` and only parses unbracketed
-- by luck of the engine version.
IF OBJECT_ID('dbo.IntakeEvent') IS NULL
CREATE TABLE dbo.IntakeEvent (
    eventId     uniqueidentifier NOT NULL CONSTRAINT PK_IntakeEvent PRIMARY KEY,
    requestId   uniqueidentifier NOT NULL,
    occurredAt  datetime2(6)     NOT NULL CONSTRAINT DF_IntakeEvent_occurredAt
                                 DEFAULT SYSUTCDATETIME(),
    actorUpn    nvarchar(256)    NOT NULL,
    actorRole   nvarchar(16)     NOT NULL,
    action      nvarchar(32)     NOT NULL,
    detail      nvarchar(1000)   NULL,
    CONSTRAINT CK_IntakeEvent_action
        CHECK (action IN ('submitted', 'accepted', 'rejected', 'failed', 'applied')),
    -- A real foreign key, which the Warehouse version could only pretend to have. An event for a
    -- request that does not exist is now impossible rather than merely unlikely.
    CONSTRAINT FK_IntakeEvent_request FOREIGN KEY (requestId)
        REFERENCES dbo.IntakeRequest (requestId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_IntakeEvent_request')
    CREATE INDEX IX_IntakeEvent_request ON dbo.IntakeEvent (requestId, occurredAt);
GO


-- ------------------------------------------------------------------------------------------------
-- Seed. Replace before any real use.
-- ------------------------------------------------------------------------------------------------
-- ⚠️ WITHOUT AT LEAST ONE PLANNER ROW, NOBODY CAN READ THE QUEUE and every request sits pending
-- forever. The failure is silent: the endpoint returns a clean 403 and looks like it is working.
-- `tools/identity/build_identity_map.py` generates these from dbo.Teachers plus a directory export.
--
-- INSERT INTO dbo.IntakeIdentity (oid, site, upn, teacherId, role, provenance)
-- VALUES ('<entra-object-id>', 'oth', '<upn>', 'T-001', 'planner', 'manual');
