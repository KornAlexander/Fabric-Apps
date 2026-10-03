"""Seed clearly-marked sample rows into the fabric-empires Fabric SQL database.

EVERY row written here has a `userId` starting with `sample:`, so the whole set
comes out again with:

    DELETE FROM dbo.QuestionAttempts WHERE userId LIKE 'sample:%';
    DELETE FROM dbo.GameResults      WHERE userId LIKE 'sample:%';

The generator is deterministic (fixed RNG seed) and models three effects on
purpose, because a report built on uniform noise cannot be told apart from a
report built on broken measures:

  1. A LEARNING CURVE. Each topic carries a latent ability that rises with
     exposure, so accuracy improves over the 12 weeks and the readiness trend
     on the Overview page has a real slope to show.
  2. A CONTEXT PENALTY. `boss` and `battle` are answered under a clock, so they
     score below `research`. This is the effect the Under Pressure page exists
     to expose, and seeding it flat would make a correct page look broken.
  3. TIME-TO-ANSWER structure. Wrong answers run longer than right ones, and
     timed contexts are capped. A correct answer that took the full clock is
     the leading indicator the schema docblock cares about.
"""

import datetime as dt
import json
import random
import struct
import subprocess
import uuid

import pyodbc

import _config

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
SERVER = _config.sql_server()
DB = _config.sql_database()
OUTLINE = _config.OUTLINE

RNG = random.Random(600)

# The real vocabulary the game writes (engine ChallengeKind + the exam screen),
# with how often each occurs and how hard it is relative to plain research.
CONTEXTS = [
    # name,       share, difficulty penalty, base seconds, capped by a clock
    ("battle",    0.46, -0.13, 22, True),
    ("research",  0.19,  0.06, 38, False),
    ("settle",    0.11, -0.02, 30, False),
    ("unrest",    0.09, -0.05, 26, True),
    ("treasure",  0.07,  0.02, 28, False),
    ("boss",      0.05, -0.20, 18, True),
    ("exam",      0.03, -0.04, 34, False),
]
DIFFICULTIES = ["apprentice", "analyst", "architect"]
OUTCOMES = ["victory", "defeat", "abandoned"]

PLAYERS = [
    ("sample:aurelia", "Sample Player (Aurelia)", 0.62, 34),
    ("sample:castor", "Sample Player (Castor)", 0.48, 14),
]


def load_topics() -> list[str]:
    o = json.loads(OUTLINE.read_text(encoding="utf-8"))
    ids = []
    for b in o["branches"]:
        for c in b["clusters"]:
            for s in c["skills"]:
                ids.append(f"dp600-{s['id']}")
    return ids


def pick_context() -> tuple[str, float, int, bool]:
    r = RNG.random()
    acc = 0.0
    for name, share, penalty, secs, capped in CONTEXTS:
        acc += share
        if r <= acc:
            return name, penalty, secs, capped
    name, _, penalty, secs, capped = CONTEXTS[-1][0], 0, CONTEXTS[-1][2], CONTEXTS[-1][3], CONTEXTS[-1][4]
    return name, penalty, secs, capped


def connect() -> pyodbc.Connection:
    tok = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True).stdout.strip()
    raw = tok.encode("utf-16-le")
    return pyodbc.connect(
        f"Driver={{ODBC Driver 18 for SQL Server}};Server={SERVER};Database={DB};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60",
        attrs_before={1256: struct.pack(f"<I{len(raw)}s", len(raw), raw)},
    )


def main() -> None:
    topics = load_topics()
    assert len(topics) == 41, f"expected 41 skills, got {len(topics)}"

    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    start_of_history = now - dt.timedelta(days=84)

    games: list[tuple] = []
    attempts: list[tuple] = []

    for user_id, user_name, base_skill, game_count in PLAYERS:
        # Latent ability per topic. Rises as the player meets the topic again.
        ability = {t: base_skill + RNG.uniform(-0.18, 0.18) for t in topics}
        seen: dict[str, int] = {t: 0 for t in topics}

        for g in range(game_count):
            progress = g / max(1, game_count - 1)
            started = start_of_history + dt.timedelta(
                days=84 * progress * RNG.uniform(0.92, 1.0),
                hours=RNG.uniform(0, 14),
            )
            duration_s = int(RNG.uniform(9, 62) * 60)
            ended = started + dt.timedelta(seconds=duration_s)

            difficulty = RNG.choices(DIFFICULTIES, weights=[0.34, 0.44, 0.22])[0]
            outcome = RNG.choices(OUTCOMES, weights=[0.30, 0.20, 0.50])[0]
            turns = int(RNG.uniform(12, 78) if outcome != "abandoned" else RNG.uniform(5, 40))
            game_id = str(uuid.uuid4())

            n_attempts = int(RNG.uniform(11, 46))
            correct_count = 0

            for _ in range(n_attempts):
                topic = RNG.choice(topics)
                seen[topic] += 1
                # Exposure lifts ability, with diminishing returns.
                ability[topic] = min(0.96, ability[topic] + 0.012)

                ctx, penalty, base_secs, capped = pick_context()
                p_correct = max(0.05, min(0.97, ability[topic] + penalty))
                correct = RNG.random() < p_correct
                correct_count += correct

                secs = base_secs * RNG.uniform(0.45, 1.35)
                if not correct:
                    secs *= RNG.uniform(1.15, 1.6)
                if capped:
                    secs = min(secs, base_secs * 1.5)
                secs = max(2, int(secs))

                asked = started + dt.timedelta(seconds=RNG.uniform(0, duration_s))
                attempts.append((
                    str(uuid.uuid4()), user_id, game_id, topic,
                    f"{topic}-q{RNG.randint(1, 6)}", 1 if correct else 0,
                    ctx, secs, 1, "dp-600", asked,
                ))

            readiness = int(round(100 * (correct_count / max(1, n_attempts))))
            cheats = None if RNG.random() > 0.12 else "reveal-answer"
            games.append((
                game_id, user_id, user_name, f"seed-{RNG.randint(100000, 999999)}",
                difficulty, RNG.choice([2, 2, 3, 4]), outcome, turns,
                int(RNG.uniform(1, 9)), readiness, int(RNG.uniform(3, 41)),
                cheats, started, ended, duration_s,
            ))

    cn = connect()
    cur = cn.cursor()
    cur.fast_executemany = True

    # Idempotent: clear any previous sample run before writing.
    cur.execute("DELETE FROM dbo.QuestionAttempts WHERE userId LIKE 'sample:%'")
    cur.execute("DELETE FROM dbo.GameResults WHERE userId LIKE 'sample:%'")
    cn.commit()

    cur.executemany(
        "INSERT INTO dbo.GameResults (id, userId, userName, seed, difficulty, players, outcome, "
        "turns, cities, readinessPercent, skillsResearched, cheatsUsed, startedAt, endedAt, durationSeconds) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", games)
    cur.executemany(
        "INSERT INTO dbo.QuestionAttempts (id, userId, gameId, topicId, questionId, correct, "
        "context, seconds, seat, courseId, askedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)", attempts)
    cn.commit()

    cur.execute("SELECT COUNT(*) FROM dbo.GameResults")
    ng = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM dbo.QuestionAttempts")
    na = cur.fetchone()[0]
    print(f"inserted games={len(games)} attempts={len(attempts)}")
    print(f"table totals: GameResults={ng} QuestionAttempts={na}")

    cur.execute("SELECT context, COUNT(*), AVG(CAST(correct AS FLOAT)), AVG(CAST(seconds AS FLOAT)) "
                "FROM dbo.QuestionAttempts GROUP BY context ORDER BY COUNT(*) DESC")
    print("\ncontext              n     accuracy  avg secs")
    for ctx, n, acc, sec in cur.fetchall():
        print(f"  {ctx:12} {n:6}   {acc:6.1%}   {sec:5.1f}")

    cn.close()


if __name__ == "__main__":
    main()
