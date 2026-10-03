"""Generate the Fabric Empires TMDL semantic model (Direct Lake on OneLake).

Generated rather than hand-written because the model has ~40 columns, each
needing a stable `lineageTag` GUID. Hand-typing those is where transcription
errors live, and a wrong lineageTag does not fail loudly: it detaches a column
from its report bindings. uuid5 over a fixed namespace makes every tag stable
across regenerations, so re-running this never churns the diff.
"""

import shutil
import uuid

import _config

NS = _config.LINEAGE_NS
EXPR = "DirectLake - fabric-empires"

ROOT = _config.MODEL_DIR


def tag(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def col(table, name, source, dtype, *, hidden=False, desc=None, sort=None, fmt=None):
    lines = []
    if desc:
        lines.append(f"\t/// {desc}")
    lines.append(f"\tcolumn '{name}'")
    lines.append(f"\t\tdataType: {dtype}")
    if hidden:
        lines.append("\t\tisHidden")
    lines.append(f"\t\tlineageTag: {tag(table, name)}")
    lines.append("\t\tsummarizeBy: none")
    lines.append(f"\t\tsourceColumn: {source}")
    if fmt:
        lines.append(f"\t\tformatString: {fmt}")
    if sort:
        lines.append(f"\t\tsortByColumn: '{sort}'")
    if dtype == "dateTime":
        lines.append("\t\tannotation UnderlyingDateTimeDataType = Date")
    return "\n".join(lines) + "\n"


def table_file(name, entity, desc, columns):
    body = [f"/// {desc}", f"table '{name}'", f"\tlineageTag: {tag(name)}", ""]
    body.append("\n".join(columns))
    body.append(f"\tpartition '{entity}' = entity")
    body.append("\t\tmode: directLake")
    body.append("\t\tsource")
    body.append(f"\t\t\tentityName: {entity}")
    # Schema-enabled layout: OneLake stores these under Tables/dbo/<name>, so the
    # partition MUST name the schema. Omitting it points at Tables/<name>, which
    # does not exist, and every table silently fails to frame.
    body.append("\t\t\tschemaName: dbo")
    body.append(f"\t\t\texpressionSource: '{EXPR}'")
    return "\n".join(body) + "\n"


GAME = [
    col("Game", "Game Id", "id", "string", hidden=True),
    col("Game", "Player Id", "userId", "string", hidden=True),
    col("Game", "Player", "userName", "string", desc="Display name from the Fabric session claim."),
    col("Game", "Seed", "seed", "string", desc="With Difficulty, this IS the world: maps are generated, never stored."),
    col("Game", "Difficulty", "difficulty", "string", desc="apprentice, analyst or architect."),
    col("Game", "Players", "players", "int64", fmt="#,0"),
    col("Game", "Outcome", "outcome", "string", desc="victory, defeat or abandoned. Abandoned is the common case."),
    col("Game", "Turns", "turns", "int64", fmt="#,0"),
    col("Game", "Cities", "cities", "int64", fmt="#,0"),
    col("Game", "Readiness Percent", "readinessPercent", "int64", fmt="#,0",
        desc="Exam readiness at the end, as whole percent."),
    col("Game", "Skills Researched", "skillsResearched", "int64", fmt="#,0"),
    col("Game", "Cheats Used", "cheatsUsed", "string",
        desc="Recorded because a game won with cheats is not evidence of anything."),
    col("Game", "Started At", "startedAt", "dateTime"),
    col("Game", "Ended At", "endedAt", "dateTime"),
    col("Game", "Duration Seconds", "durationSeconds", "int64", fmt="#,0"),
]

ATTEMPT = [
    col("Attempt", "Attempt Id", "id", "string", hidden=True),
    col("Attempt", "Player Id", "userId", "string", hidden=True),
    col("Attempt", "Game Id", "gameId", "string", hidden=True),
    col("Attempt", "Topic Id", "topicId", "string", hidden=True),
    col("Attempt", "Question Id", "questionId", "string", hidden=True),
    col("Attempt", "Correct", "correct", "boolean"),
    col("Attempt", "Context", "context", "string",
        desc="Where the question was asked: battle, settle, unrest, research, treasure, boss or exam."),
    col("Attempt", "Seconds", "seconds", "int64", fmt="#,0",
        desc="Kept even when the answer was right: a slow correct answer leads the lapse that follows."),
    col("Attempt", "Seat", "seat", "int64", fmt="#,0", desc="1 or 2. Duo mode seats a second player."),
    col("Attempt", "Course Id", "courseId", "string"),
    col("Attempt", "Asked At", "askedAt", "dateTime"),
]

SKILL = [
    col("Skill", "Topic Id", "topicId", "string", hidden=True),
    col("Skill", "Skill Number", "skillNumber", "int64", fmt="#,0", hidden=True),
    col("Skill", "Skill", "skillLabel", "string", sort="Skill Number",
        desc="One measured skill from the published DP-600 outline."),
    col("Skill", "Cluster Id", "clusterId", "string", hidden=True),
    col("Skill", "Cluster", "clusterLabel", "string"),
    col("Skill", "Domain Id", "domainId", "string", hidden=True),
    col("Skill", "Domain Name", "domainLabel", "string"),
    col("Skill", "Domain", "domainDisplay", "string", sort="Domain Id",
        desc="Exam domain with its published weighting."),
    col("Skill", "Domain Weight Min", "domainWeightMin", "int64", fmt="#,0", hidden=True),
    col("Skill", "Domain Weight Max", "domainWeightMax", "int64", fmt="#,0", hidden=True),
]

MEASURES = [
    ("Games", "COUNTROWS('Game')", "#,0", "Finished campaigns."),
    ("Victories", "CALCULATE([Games], 'Game'[Outcome] = \"victory\")", "#,0", None),
    ("Win Rate", "DIVIDE([Victories], [Games])", "0.0%", None),
    ("Avg Turns", "AVERAGE('Game'[Turns])", "#,0.0", None),
    ("Avg Readiness %", "AVERAGE('Game'[Readiness Percent])", "#,0.0",
     "Mean end-of-game readiness. Already whole percent in the column."),
    ("Avg Game Minutes", "DIVIDE(AVERAGE('Game'[Duration Seconds]), 60)", "#,0.0", None),
    ("Attempts", "COUNTROWS('Attempt')", "#,0", "Questions answered."),
    ("Correct Answers", "CALCULATE([Attempts], 'Attempt'[Correct] = TRUE)", "#,0", None),
    ("Accuracy", "DIVIDE([Correct Answers], [Attempts])", "0.0%", None),
    ("Avg Answer Seconds", "AVERAGE('Attempt'[Seconds])", "#,0.0", None),
    ("Avg Seconds When Right", "CALCULATE([Avg Answer Seconds], 'Attempt'[Correct] = TRUE)", "#,0.0", None),
    ("Avg Seconds When Wrong", "CALCULATE([Avg Answer Seconds], 'Attempt'[Correct] = FALSE)", "#,0.0", None),
    ("Skills Practised", "DISTINCTCOUNT('Attempt'[Topic Id])", "#,0",
     "Distinct DP-600 skills that have been answered at least once."),
    ("Skill Coverage", "DIVIDE([Skills Practised], COUNTROWS(ALLNOBLANKROW('Skill')))", "0.0%",
     "Share of the 41 published skills that have ever been practised. "
     "ALLNOBLANKROW, not ALL: ALL counts the blank row the engine materialises on "
     "the one side of a relationship, which made full coverage report as 97.6%."),
    ("Baseline Accuracy",
     "CALCULATE([Accuracy], REMOVEFILTERS('Attempt'[Context]), REMOVEFILTERS('Skill'))", "0.0%",
     "Accuracy ignoring context and skill, so a bar can be compared to the player's own average."),
    ("Pressure Gap", "[Accuracy] - [Baseline Accuracy]", "+0.0%;-0.0%;0.0%",
     "How far this context sits below or above the player's own overall accuracy."),
]

WEAKEST = """\t/// Lowest-accuracy skill with enough attempts to mean anything.
\t/// The 12-attempt floor matters: without it this reports whichever skill was
\t/// answered once and missed, which is noise wearing the costume of a finding.
\tmeasure 'Weakest Skill' =
\t\t\tVAR Scored =
\t\t\t\tFILTER(
\t\t\t\t\tADDCOLUMNS(VALUES('Skill'[Skill]), "@acc", [Accuracy], "@n", [Attempts]),
\t\t\t\t\t[@n] >= 12
\t\t\t\t)
\t\t\tRETURN
\t\t\t\tIF(
\t\t\t\t\tISEMPTY(Scored),
\t\t\t\t\t"not enough attempts yet",
\t\t\t\t\tCONCATENATEX(TOPN(1, Scored, [@acc], ASC), 'Skill'[Skill], ", ")
\t\t\t\t)
\t\tlineageTag: {tag}
"""

STRONGEST = """\t/// Highest-accuracy skill, same 12-attempt floor and for the same reason.
\tmeasure 'Strongest Skill' =
\t\t\tVAR Scored =
\t\t\t\tFILTER(
\t\t\t\t\tADDCOLUMNS(VALUES('Skill'[Skill]), "@acc", [Accuracy], "@n", [Attempts]),
\t\t\t\t\t[@n] >= 12
\t\t\t\t)
\t\t\tRETURN
\t\t\t\tIF(
\t\t\t\t\tISEMPTY(Scored),
\t\t\t\t\t"not enough attempts yet",
\t\t\t\t\tCONCATENATEX(TOPN(1, Scored, [@acc], DESC), 'Skill'[Skill], ", ")
\t\t\t\t)
\t\tlineageTag: {tag}
"""

NOTICE = """\t/// Self-clearing banner for the seeded rows.
\t/// Written as a measure rather than a textbox on purpose: a static caption
\t/// would keep claiming the report contains sample data long after the rows
\t/// were deleted, which is precisely the kind of stale disclosure that makes
\t/// people stop reading disclosures.
\tmeasure 'Data Notice' =
\t\t\tVAR SampleGames = COUNTROWS(FILTER(ALL('Game'), LEFT('Game'[Player Id], 7) = "sample:"))
\t\t\tRETURN
\t\t\t\tIF(
\t\t\t\t\tCOALESCE(SampleGames, 0) > 0,
\t\t\t\t\t"Note: includes " & SampleGames & " seeded sample games (userId sample:*). Delete those rows to see real play only.",
\t\t\t\t\t""
\t\t\t\t)
\t\tlineageTag: {tag}
"""


def measure_block(name, dax, fmt, desc):
    out = []
    if desc:
        out.append(f"\t/// {desc}")
    out.append(f"\tmeasure '{name}' = {dax}")
    if fmt:
        out.append(f"\t\tformatString: {fmt}")
    out.append(f"\t\tlineageTag: {tag('Measure', name)}")
    return "\n".join(out) + "\n"


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    defn = ROOT / "definition"
    (defn / "tables").mkdir(parents=True)

    (ROOT / ".platform").write_text(
        '{\n  "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/'
        'platformProperties/2.0.0/schema.json",\n'
        '  "metadata": {\n    "type": "SemanticModel",\n'
        '    "displayName": "Fabric Empires"\n  },\n'
        '  "config": {\n    "version": "2.0",\n'
        f'    "logicalId": "{tag("platform")}"\n  }}\n}}\n'.replace("}}\n}}", "}\n}"),
        encoding="utf-8", newline="\n")

    (ROOT / "definition.pbism").write_text(
        '{\n  "version": "4.0",\n  "settings": {\n    "qnaEnabled": true\n  }\n}\n',
        encoding="utf-8", newline="\n")

    (defn / "database.tmdl").write_text("database\n\tcompatibilityLevel: 1605\n",
                                        encoding="utf-8", newline="\n")

    (defn / "expressions.tmdl").write_text(
        f"expression '{EXPR}' =\n"
        f"\t\tlet\n"
        f"\t\t\tSource = AzureStorage.DataLake(\"https://onelake.dfs.fabric.microsoft.com/"
        f"{{{{FE_WORKSPACE_ID}}}}/{{{{FE_SQLDB_ITEM_ID}}}}\", [HierarchicalNavigation=true])\n"
        f"\t\tin\n"
        f"\t\t\tSource\n"
        f"\tlineageTag: {tag('expression')}\n\n"
        f"\tannotation PBI_IncludeFutureArtifacts = False\n",
        encoding="utf-8", newline="\n")

    (defn / "model.tmdl").write_text(
        "model Model\n"
        "\tculture: en-US\n"
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3\n"
        "\tdiscourageImplicitMeasures\n"
        "\tsourceQueryCulture: en-US\n"
        "\tdataAccessOptions\n"
        "\t\tlegacyRedirects\n"
        "\t\treturnErrorValuesAsNull\n\n"
        "ref table 'Game'\n"
        "ref table 'Attempt'\n"
        "ref table 'Skill'\n"
        "ref table 'Measure'\n",
        encoding="utf-8", newline="\n")

    # Relationships and expressions take no description in TMDL: a `///` line is
    # rejected as an unknown 'description' property, and `//` is rejected as an
    # invalid line type. The reasoning lives in this script's docstring instead.
    (defn / "relationships.tmdl").write_text(
        f"relationship {tag('rel', 'skill-attempt')}\n"
        "\tfromColumn: Attempt.'Topic Id'\n"
        "\ttoColumn: Skill.'Topic Id'\n\n"
        f"relationship {tag('rel', 'game-attempt')}\n"
        "\tfromColumn: Attempt.'Game Id'\n"
        "\ttoColumn: Game.'Game Id'\n",
        encoding="utf-8", newline="\n")

    (defn / "tables" / "Game.tmdl").write_text(
        table_file("Game", "GameResults", "One finished campaign per row.", GAME),
        encoding="utf-8", newline="\n")
    (defn / "tables" / "Attempt.tmdl").write_text(
        table_file("Attempt", "QuestionAttempts", "One question, one answer.", ATTEMPT),
        encoding="utf-8", newline="\n")
    (defn / "tables" / "Skill.tmdl").write_text(
        table_file("Skill", "Skills", "The published DP-600 skills outline.", SKILL),
        encoding="utf-8", newline="\n")

    measures = [measure_block(*m) for m in MEASURES]
    measures.append(WEAKEST.format(tag=tag("Measure", "Weakest Skill")))
    measures.append(STRONGEST.format(tag=tag("Measure", "Strongest Skill")))
    measures.append(NOTICE.format(tag=tag("Measure", "Data Notice")))

    measure_tbl = (
        "/// Every measure lives here, so the data tables stay pure columns.\n"
        "/// Disconnected and import-mode: relating a calculated table to a Direct\n"
        "/// Lake fact is the one join that drops the model out of Direct Lake.\n"
        "table 'Measure'\n"
        f"\tlineageTag: {tag('Measure')}\n\n"
        "\tcolumn 'Value'\n"
        "\t\tdataType: int64\n"
        "\t\tisHidden\n"
        f"\t\tlineageTag: {tag('Measure', 'Value')}\n"
        "\t\tsummarizeBy: none\n"
        "\t\tsourceColumn: [Value]\n\n"
        + "\n".join(measures)
        + "\n\tpartition 'Measure' = calculated\n"
          "\t\tmode: import\n"
          "\t\tsource = {0}\n"
    )
    (defn / "tables" / "Measure.tmdl").write_text(measure_tbl, encoding="utf-8", newline="\n")

    files = sorted(p for p in ROOT.rglob("*") if p.is_file())
    print(f"wrote {len(files)} files under {ROOT}")
    for f in files:
        print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
