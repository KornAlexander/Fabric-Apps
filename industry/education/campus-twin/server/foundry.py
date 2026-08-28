"""Azure AI Foundry client — the same contract the wind-farm digital twin uses.

Ported deliberately rather than reinvented (PLAN §4, and the instruction to take the integration
from `digital-twin-fabric-app`). What is kept identical:

  * the **Responses API** at `{endpoint}/openai/v1/responses`
  * tools declared as `{type:"function", name, description, parameters}`
  * tool calls read back from `output[]` where `type == "function_call"`
  * auth by API key, an explicit access token, or the Azure CLI / managed identity, in that order
  * the tool LOOP: call, execute locally, feed results back, repeat until the model stops asking

What is different, and why: that backend is Node, this one is Python. The reason is OR-Tools —
the solver is the product here, CP-SAT has no first-class Node binding, and running a Python
subprocess out of a Node process to reach it would be a second runtime in the same container to
preserve a code copy. The integration SHAPE is what mattered, and that is what was taken.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any, Iterator

import httpx

from schedule_store import SITE, known_sites

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"


class FoundryConfig:
    def __init__(self) -> None:
        self.endpoint = (os.getenv("AZURE_OPENAI_ENDPOINT") or "").rstrip("/")
        self.api_key = os.getenv("AZURE_OPENAI_API_KEY") or ""
        self.access_token = os.getenv("AZURE_OPENAI_ACCESS_TOKEN") or ""
        self.use_cli_token = (os.getenv("AZURE_OPENAI_USE_AZURE_CLI_TOKEN") or "").lower() == "true"
        # ⚠️ MANAGED IDENTITY IS THE CONTAINER PATH. The az-CLI token works on a laptop and cannot
        # work in a Container App — there is no CLI and no signed-in user in the image. The digital
        # twin hit exactly this and forces MI with AZURE_OPENAI_USE_AZURE_CLI_TOKEN=false. Same
        # here: give the app's system identity the "Cognitive Services OpenAI User" role on the
        # OpenAI account and put no key in the environment at all.
        self.use_managed_identity = (
            os.getenv("AZURE_OPENAI_USE_MANAGED_IDENTITY") or ""
        ).lower() == "true"
        self.chat_deployment = os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT") or "gpt-chat-latest"
        self._cached_token: tuple[str, float] | None = None
        self._credential = None

    @property
    def configured(self) -> bool:
        return bool(
            self.endpoint
            and (self.api_key or self.access_token or self.use_cli_token or self.use_managed_identity)
        )

    def responses_url(self) -> str:
        base = self.endpoint
        if base.endswith("/openai/v1/responses"):
            return base
        if base.endswith("/openai/v1"):
            return f"{base}/responses"
        return f"{base}/openai/v1/responses"

    def auth_header(self) -> dict[str, str]:
        if self.api_key:
            return {"api-key": self.api_key}
        if self.access_token:
            return {"Authorization": f"Bearer {self.access_token}"}
        if self.use_managed_identity:
            from azure.identity import DefaultAzureCredential

            if self._credential is None:
                self._credential = DefaultAzureCredential()
            token = self._credential.get_token("https://cognitiveservices.azure.com/.default")
            return {"Authorization": f"Bearer {token.token}"}
        if self.use_cli_token:
            now = time.time()
            if self._cached_token and self._cached_token[1] > now + 60:
                return {"Authorization": f"Bearer {self._cached_token[0]}"}
            out = subprocess.run(
                [AZ, "account", "get-access-token", "--resource",
                 "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"],
                capture_output=True, text=True, check=True,
            )
            token = out.stdout.strip()
            self._cached_token = (token, now + 45 * 60)
            return {"Authorization": f"Bearer {token}"}
        raise RuntimeError("Foundry is not configured")

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "endpoint": self.endpoint.split("//")[-1].split("/")[0] if self.endpoint else None,
            "chatDeployment": self.chat_deployment,
            "auth": (
                "api-key" if self.api_key else
                "access-token" if self.access_token else
                "managed-identity" if self.use_managed_identity else
                "azure-cli" if self.use_cli_token else
                None
            ),
        }


# ⚠️ THE UNIVERSITY AND THE DISTANCE ARE INTERPOLATED, NOT WRITTEN IN. An assistant that opens
# with "Planungsassistent der OTH Regensburg" while serving LMU's data is the most visible
# possible version of the second-customer bug, and it would survive every test that checks tool
# results rather than prose. Both values come from the loaded dataset's site.
_SITE_FACTS = {
    "oth-real": {
        "label": "OTH Regensburg",
        "dataNote": (
            "Der Stundenplan stammt aus dem echten Untis-Export der OTH Regensburg. "
            "Lehrende sind nur als Untis-Kürzel hinterlegt — nenne niemals einen ausgeschriebenen "
            "Namen und erfinde keinen. Raumgrößen, Raumarten und Gruppenstärken sind im Export "
            "nicht enthalten; sage das, statt zu schätzen."
        ),
        "campusNote": (
            "Zwischen den beiden Standorten Seybothstraße und Prüfeninger Straße liegen 2,5 km."
        ),
    },
    "oth": {
        "label": "OTH Regensburg",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "Zwischen den beiden Standorten Seybothstra\u00dfe und Pr\u00fcfeninger Stra\u00dfe liegen 2,5 km."
        ),
    },
    "lmu": {
        "label": "LMU M\u00fcnchen",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "Zwischen dem Stammgel\u00e4nde und dem Klinikum Campus Innenstadt liegen 2,4 km \u2014 in "
            "M\u00fcnchen eine U-Bahn-Fahrt, keine Gehstrecke."
        ),
    },
    "tum": {
        "label": "TUM Garching",
        # ⚠️ THIS LINE USED TO BE FIXED TEXT READING "Die Stundenplandaten sind synthetisch", and
        # it was rendered on TUM — where it is FALSE. The prompt then contradicted its own campus
        # note two lines later, and the assistant could tell a planner that TUM's genuine
        # published timetable was made up. That is the provenance bug this project cares most
        # about, running in the direction nobody watches: disclaiming REAL data as invented.
        "dataNote": (
            "Die Veranstaltungen, R\u00e4ume und Zeiten sind ECHT und stammen aus TUMonline; die "
            "Geb\u00e4ude und Wege ebenfalls. Erfunden sind ausschlie\u00dflich die Lehrenden und die "
            "Semestergruppen. Sage NIEMALS, dieser Stundenplan sei synthetisch \u2014 das w\u00e4re "
            "schlicht falsch. Weise stattdessen darauf hin, was erfunden ist, wenn es zur Frage passt."
        ),
        "campusNote": (
            "Ein einziger Campus in Garching; alle R\u00e4ume liegen fu\u00dfl\u00e4ufig beieinander. "
            "\u26a0\ufe0f Dieser Stundenplan ist ECHT \u2014 er stammt aus TUMonline. Die Lehrenden und die "
            "Semestergruppen sind dagegen erfunden, weil TUMonline beide nicht ver\u00f6ffentlicht: Fragen "
            "nach einer bestimmten Person beantwortest du NICHT, sondern erkl\u00e4rst genau das. "
            "R\u00e4ume, Zeiten und Veranstaltungen sind belastbar. Au\u00dferdem sind viele R\u00e4ume zu "
            "Zeiten belegt, in denen NICHT gelehrt wird \u2014 diese Stunden sind blockiert und stehen "
            "f\u00fcr Verlegungen nicht zur Verf\u00fcgung."
        ),
    },
    # ── The five twins brought up from terrain-only to a full scheduler ────────────────────────
    #
    # ⚠️ ALL FIVE HAVE A GENERATED TIMETABLE AND REAL BUILDINGS, so their `dataNote` is the OTH/LMU
    # one and NOT the TUM one. Getting that backwards in either direction is the provenance bug
    # this file exists to prevent: disclaiming real data as invented (what happened to TUM) or
    # presenting invented data as real. The `campusNote` is per site because the distance IS the
    # constraint, and it differs by a factor of three across these five.
    "rwth": {
        "label": "RWTH Aachen",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "Zwischen dem Templergraben in der Innenstadt und dem Campus Melaten im Westen liegen "
            "1,7 km \u2014 rund zwanzig Minuten zu Fu\u00df, also mehr als eine Viertelstunde Pause hergibt. "
            "Beide modellierten Fakult\u00e4ten haben Geb\u00e4ude auf BEIDEN Seiten, die Strecke ist also "
            "nicht das Problem einer einzelnen Kohorte."
        ),
    },
    "koeln": {
        "label": "Universit\u00e4t zu K\u00f6ln",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "Zwischen dem Hauptcampus am Albertus-Magnus-Platz und den n\u00f6rdlichen Instituten an "
            "der Gronewald- und Bachemer Stra\u00dfe liegt gut 1 km \u2014 etwa dreizehn Minuten zu Fu\u00df. "
            "Das passt in eine Viertelstunde Pause nur, wenn nichts dazwischenkommt; rechne es "
            "nach, statt es zu behaupten."
        ),
    },
    "muenster": {
        "label": "Universit\u00e4t M\u00fcnster",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "Zwischen dem Schlossplatz in der Innenstadt und dem Coesfelder Kreuz im Nordwesten "
            "liegen 1,5 km. Zwei der drei gro\u00dfen H\u00f6rsaalgeb\u00e4ude stehen am Coesfelder Kreuz, die "
            "Philosophische Fakult\u00e4t aber am Schlossplatz \u2014 eine gro\u00dfe Vorlesung kostet diese "
            "Kohorten also den Weg."
        ),
    },
    "fau": {
        "label": "FAU Erlangen-N\u00fcrnberg",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin. "
            "\u26a0\ufe0f Dieser Zwilling zeigt NUR Erlangen. Die N\u00fcrnberger Fakult\u00e4ten sind nicht "
            "enthalten \u2014 sage das, statt \u00fcber sie zu sprechen."
        ),
        "campusNote": (
            "DREI Standorte: die Innenstadt am Schlossgarten, der R\u00f6thelheim Campus 1,2 km "
            "\u00f6stlich und das S\u00fcdgel\u00e4nde mit der Technischen Fakult\u00e4t 2,9 km s\u00fcdlich \u2014 die weiteste "
            "Trennung aller Standorte in diesem Datensatz. Weil R\u00f6thelheim dazwischen liegt, ist "
            "'auf den anderen Campus verlegen' hier keine Ja-Nein-Frage: es gibt einen mittleren "
            "Weg, und ob er hilft, h\u00e4ngt davon ab, welche Bl\u00f6cke aneinandergrenzen."
        ),
    },
    "tuebingen": {
        "label": "Universit\u00e4t T\u00fcbingen",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "EIN Standort \u2014 die Institute liegen in der Altstadt und an der Wilhelmstra\u00dfe "
            "verteilt, es gibt hier also keine Campus-Strecke, die einen Plan sprengt. "
            "\u26a0\ufe0f Die Knappheit ist eine andere: geteilte H\u00f6rs\u00e4le gibt es praktisch nur zwei, die "
            "Neue Aula und den Kupferbau, beide in denkmalgesch\u00fctzter Bausubstanz, die nicht "
            "erweitert werden kann. Argumentiere nicht mit Wegzeiten, sondern mit diesen zwei "
            "R\u00e4umen. Die Morgenstelle liegt au\u00dferhalb dieses Zwillings."
        ),
    },
    "tuberlin": {
        "label": "TU Berlin",
        "dataNote": (
            "Die Stundenplandaten sind synthetisch, die Geb\u00e4ude und Wege sind echt. Wenn jemand "
            "nach Personen oder konkreten Lehrveranstaltungen fragt, weise einmal darauf hin."
        ),
        "campusNote": (
            "ZWEI Standorte, und die Strecke dazwischen ist mit 5,0 km die l\u00e4ngste in diesem "
            "Datensatz: der Campus Charlottenburg an der Stra\u00dfe des 17. Juni und der TIB an der "
            "Gustav-Meyer-Allee im Wedding. \u26a0\ufe0f Der Wedding ist kein zweiter Vollstandort, sondern "
            "die Werkstatt-Seite der Fakult\u00e4t V: dort liegen Kraftfahrzeuge und Strangpressen, "
            "die Vorlesungen derselben Kohorten aber in Charlottenburg. Eine Verlegung, die eine "
            "Praktikumsgruppe zwischen zwei angrenzenden Bl\u00f6cken \u00fcber diese 5 km schickt, ist "
            "deshalb hier das teuerste, was passieren kann \u2014 argumentiere mit der Strecke, nicht "
            "mit der Raumgr\u00f6\u00dfe."
        ),
    },
    "demo": {
        "label": "Beispiel-Universit\u00e4t",
        "dataNote": (
            "\u26a0\ufe0f Diese Hochschule gibt es nicht. Stundenplan, Fakult\u00e4ten und Studieng\u00e4nge sind "
            "erfunden; Gel\u00e4nde, Geb\u00e4ude und Wege sind echte offene Geodaten. Sage das einmal, "
            "wenn jemand nach Personen, Lehrveranstaltungen oder Kennzahlen fragt \u2014 und "
            "erfinde keine Quelle dazu."
        ),
        "campusNote": (
            "ZWEI Standorte, 5,0 km auseinander: Campus Mitte und Campus Nord. Campus Nord ist "
            "die Werkstatt-Seite der Fakult\u00e4t Maschinenbau und Verkehr \u2014 dort liegen ihre "
            "Praktika, die Vorlesungen derselben Kohorten aber am Campus Mitte. Eine Verlegung, "
            "die eine Gruppe zwischen zwei angrenzenden Bl\u00f6cken \u00fcber diese Strecke schickt, ist "
            "deshalb das Teuerste, was hier passieren kann."
        ),
    },
}

# ⚠️ AN UNKNOWN SITE USED TO KILL THE PROCESS AT IMPORT. `_SITE_FACTS[SITE]` raised `KeyError:
# 'tum'` the moment the third university was registered in `schedule_store` and not here — and
# because it happens at import, the container never starts, the startup probe fails forever and
# the platform reports only "ProbeFailed", with no replica left alive to read a log from. Twenty
# minutes of that looks exactly like a cold start. A missing entry is a real mistake, so it still
# fails, but it fails SAYING WHAT IS MISSING.
#
# ⚠️ NOW CHECKED FOR EVERY SERVABLE SITE, NOT JUST THE DEFAULT. One container answers for all of
# them (PLAN §21.1), so a site registered in `schedule_store` and missing here would start
# perfectly and then greet one university's planner as another the first time somebody asked about
# it. Failing at import trades a broken deployment for a broken demo, which is the right way round.
_missing = [s for s in known_sites() if s not in _SITE_FACTS]
if _missing:
    raise SystemExit(
        f"foundry.py has no site facts for: {', '.join(_missing)}. Known here: "
        f"{', '.join(sorted(_SITE_FACTS))}. Add each university's label, dataNote and campusNote "
        "here — registering a site in schedule_store.py alone is not enough, because the "
        "assistant greets the planner by name and states what in the data is real, and would "
        "otherwise greet them as another university and describe another university's data."
    )


def system_prompt_for(site: str) -> str:
    """The assistant's identity for ONE university.

    ⚠️ Built per call rather than once at import. The prompt names the university and states which
    of its data is real; a single module-level prompt in a container that serves several would
    introduce itself as whichever one happened to boot first.
    """
    facts = _SITE_FACTS[site]
    return f"""Du bist der Planungsassistent der {facts["label"]} für die Stundenplanung.

Du beantwortest Fragen NIE aus dem Bauch heraus. Für alles, was mit dem Stundenplan zu tun hat,
rufst du die bereitgestellten Werkzeuge auf und berichtest, was sie zurückgeben.

Wichtig:
- ⚠️ Sprich gegenüber Planenden nie von "Solver", "CP-SAT" oder "Constraint". Das Werkzeug
  heißt im Gespräch **Optimierungsverfahren** — ein Rechenverfahren, das alle zulässigen
  Umplanungen durchgeht und die mit den wenigsten Änderungen zurückgibt.
- `propose_repairs` ist ein echtes Optimierungsverfahren, nicht eine Schätzung. Wenn es sagt,
  etwas ist nicht möglich, dann ist es nicht möglich — erfinde keine Alternative.
- ⚠️ Wenn jemand ausfällt oder zu einer Zeit nicht kann, MUSST du diese neue Einschränkung in
  `forbid` an `propose_repairs` übergeben, z. B. forbid=[{{"teacher": "Meier", "day": "Fr"}}].
  Ohne `forbid` kennt das Optimierungsverfahren die Annahme nicht, lässt alles stehen — und "0 Verschiebungen"
  bedeutet dann NICHT, dass keine Umplanung möglich ist. Achte auf das Feld `warning`.
- "0 Termine verschoben" heißt: der Plan ist bereits konfliktfrei. Es heißt NIE: es gibt keine
  Lösung. Keine Lösung gibt es nur, wenn `options` leer ist.
- Sag dazu, ob Optimalität bewiesen wurde (`optimalityProven`) oder ob es die beste Lösung
  innerhalb des Zeitlimits war.
- Wenn ein Werkzeug `teacher_not_found` mit `didYouMean` zurückgibt, nenne diese Namen und frage
  nach, welcher gemeint ist. Wenn dort GENAU EIN Name steht, frage kurz zurück ("Meinen Sie …?")
  und rechne nach der Bestätigung weiter. ⚠️ Wähle NIE selbst einen Namen aus `didYouMean` aus und
  rechne ungefragt damit — die Zahlen wären echt, aber über die falsche Person, und das wäre auf
  dem Bildschirm nicht zu erkennen.
- {facts["dataNote"]}
- Antworte kurz und auf Deutsch. Zahlen aus den Werkzeugen, nicht aus der Erinnerung.
- {facts["campusNote"]} Eine Semestergruppe schafft das nicht in einer 15-Minuten-Pause — das ist
  der Grund, warum Standortwechsel als harter Konflikt gelten."""


#: The default deployment's prompt, kept so existing callers and tests keep working unchanged.
SYSTEM_PROMPT = system_prompt_for(SITE)


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "get_affected_sessions",
        "description": "Welche Lehrveranstaltungen sind betroffen, wenn eine Lehrperson zu bestimmten Zeiten ausfällt.",
        "parameters": {
            "type": "object",
            "properties": {
                "teacher": {"type": "string", "description": "Name oder Kürzel der Lehrperson"},
                "day": {"type": "string", "description": "Mo, Di, Mi, Do oder Fr"},
                "slot_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["teacher"],
        },
    },
    {
        "type": "function",
        "name": "detect_conflicts",
        "description": "Prüft den Plan auf Konflikte, optional mit hypothetischen Änderungen.",
        "parameters": {
            "type": "object",
            "properties": {
                "moves": {"type": "array", "items": {"type": "object"}},
                "unavailable": {"type": "array", "items": {"type": "object"}},
            },
        },
    },
    {
        "type": "function",
        "name": "propose_repairs",
        "description": (
            "Optimierungsverfahren: schlägt bis zu k konfliktfreie Umplanungen vor, sortiert nach "
            "geringster Änderung. WICHTIG: Wenn die Umplanung durch einen Ausfall ausgelöst wird, "
            "muss die neue Nicht-Verfügbarkeit in `forbid` mitgegeben werden — sonst kennt das "
            "Verfahren die Annahme nicht und lässt alles unverändert."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "session_ids": {"type": "array", "items": {"type": "string"}},
                "k": {"type": "integer"},
                "forbid": {
                    "type": "array",
                    "description": "Neue Sperren, z. B. [{\"teacher\": \"Meier\", \"day\": \"Fr\"}] "
                                   "oder [{\"teacher\": \"Meier\", \"slotId\": \"Fr-2\"}]",
                    "items": {"type": "object"},
                },
            },
            "required": ["session_ids", "forbid"],
        },
    },
    {
        "type": "function",
        "name": "explain_infeasibility",
        "description": "Warum kann eine Veranstaltung nicht in einen bestimmten Slot/Raum?",
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "slot_id": {"type": "string"},
                "room_id": {"type": "string"},
            },
            "required": ["session_id", "slot_id"],
        },
    },
    {
        "type": "function",
        "name": "get_plan_overview",
        "description": (
            "Bestand und Auslastung: wie viele Räume je Art (Hörsaal, Seminarraum, Labor, "
            "CIP-Pool, Übungsraum), Sitzplatzspannen, Auslastung, Sitzungen je Standort. "
            "Nimm dieses Werkzeug für jede Frage nach Anzahl, Größe oder Auslastung von Räumen."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "room_type": {
                    "type": "string",
                    "description": "Optional auf eine Raumart einschränken, z. B. 'Hörsaal'.",
                }
            },
        },
    },
    {
        "type": "function",
        "name": "find_substitute",
        "description": (
            "Wer könnte diesen Termin stattdessen übernehmen? Liefert nur Lehrpersonen, die im "
            "betreffenden Zeitfenster wirklich können — frei, nicht gesperrt und der Weg vom "
            "Nachbartermin ist zu schaffen — sortiert nach Auslastung, freiem Deputat und "
            "Modulverantwortung, mit einer Begründung je Vorschlag. Nimm dieses Werkzeug, wenn "
            "jemand ausfällt und nach Vertretung gefragt wird. Eine leere Liste ist eine "
            "Antwort: dann kann niemand, und `rejected` sagt warum. Schlage NIEMALS jemanden "
            "vor, der nicht in der Liste steht."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Die sessionId des Termins, für den Vertretung gesucht wird.",
                },
                "k": {
                    "type": "integer",
                    "description": "Wie viele Vorschläge höchstens, Standard 5.",
                },
            },
            "required": ["session_id"],
        },
    },
    {
        "type": "function",
        "name": "get_calendar",
        "description": (
            "Die Woche einer Lehrperson, Semestergruppe oder eines Raums: was belegt ist, was frei ist "
            "und wann die Person nicht verfügbar ist. Nimm dieses Werkzeug für Fragen wie 'wann "
            "ist D 104 frei?' oder 'wie sieht der Dienstag von Prof. Meier aus?', und bevor du "
            "einen Termin vorschlägst — es zeigt dieselbe Woche wie der Kalender am Bildschirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "string",
                    "enum": ["teacher", "cohort", "room"],
                    "description": "Wessen Woche: teacher, cohort oder room.",
                },
                "key": {
                    "type": "string",
                    "description": (
                        "Name oder Kennung, z. B. 'Hinterberger', 'IM-WIRT-1' oder 'D 104'. "
                        "Bei Räumen den vollen Code angeben — Groß- und Kleinschreibung "
                        "unterscheidet verschiedene Gebäude."
                    ),
                },
            },
            "required": ["scope", "key"],
        },
    },
]


class FoundryClient:
    def __init__(self, config: FoundryConfig) -> None:
        self.config = config

    def stream_with_tools(
        self,
        prompt: str,
        execute: Any,
        max_rounds: int = 4,
        site: str | None = None,
    ) -> Iterator[dict]:
        """Run the tool loop, yielding NDJSON-shaped events as they happen.

        Same event vocabulary as the digital twin so a frontend written for one can read the
        other: status / metadata / tool / delta / done / error.
        """
        if not self.config.configured:
            yield {"type": "error", "error": "foundry_not_configured",
                   "message": "Set AZURE_OPENAI_ENDPOINT and one of AZURE_OPENAI_API_KEY, "
                              "AZURE_OPENAI_ACCESS_TOKEN or AZURE_OPENAI_USE_AZURE_CLI_TOKEN=true."}
            return

        url = self.config.responses_url()
        headers = {"Content-Type": "application/json", **self.config.auth_header()}
        conversation: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt_for(site) if site else SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        yield {"type": "metadata", "provider": "azure-openai-foundry",
               "model": self.config.chat_deployment}

        with httpx.Client(timeout=120) as client:
            for round_no in range(max_rounds):
                body = {
                    "model": self.config.chat_deployment,
                    "input": conversation,
                    "tools": TOOL_SCHEMAS,
                }
                response = client.post(url, headers=headers, json=body)
                if response.status_code >= 400:
                    yield {"type": "error", "error": "foundry_http_error",
                           "status": response.status_code, "message": response.text[:500]}
                    return
                payload = response.json()

                calls = [o for o in payload.get("output", []) if o.get("type") == "function_call"]
                if not calls:
                    text = _response_text(payload)
                    if text:
                        yield {"type": "delta", "text": text}
                    yield {"type": "done", "rounds": round_no + 1}
                    return

                # ⚠️ ECHO THE MODEL'S ENTIRE OUTPUT BACK, not just the function_call items.
                # gpt-chat-latest is a reasoning model: it emits `reasoning` items alongside each
                # `function_call`, and the Responses API rejects the next turn with
                #   "Item 'fc_…' of type 'function_call' was provided without its required
                #    'reasoning' item: 'rs_…'"  (HTTP 400)
                # if they are separated. The first tool round therefore worked perfectly and the
                # SECOND one failed — which reads like a bug in the tool rather than in how the
                # conversation is assembled. Append the output verbatim, then the tool results.
                conversation.extend(payload.get("output", []))

                for call in calls:
                    name = call.get("name")
                    try:
                        args = json.loads(call.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield {"type": "tool", "name": name, "arguments": args}
                    result = execute(name, args)
                    event = {"type": "tool_result", "name": name,
                             "summary": _summarise(name, result)}

                    # The id and the summarised options are attached by `_run_tool`, so the chat
                    # and a direct tool call offer exactly the same confirmable proposal. Passing
                    # them through rather than re-registering keeps ONE record of what was shown —
                    # registering twice would hand the planner an id for options they never saw.
                    if name == "propose_repairs" and isinstance(result, dict):
                        if result.get("proposalId"):
                            event["proposalId"] = result["proposalId"]
                            event["options"] = result.get("options") or []

                    # ⚠️ A STATED ABSENCE IS A FACT ABOUT THE WORLD, NOT JUST A SOLVER INPUT.
                    # "Aubinger kann donnerstags nicht" was consumed as a one-off `forbid` and then
                    # forgotten: the plan got repaired and the CONSTRAINT — the thing the plan is
                    # judged against — never learnt anything. Ask the same question tomorrow and the
                    # app has no idea. So the parsed absence is handed to the client, which offers to
                    # write it into the availability table.
                    #
                    # ⚠️ OFFERED, NEVER WRITTEN HERE. The agent's tool surface stays read-only plus
                    # the solver (`test_confirm_gate.py` pins that); this is a payload a human then
                    # clicks, exactly as `proposalId` is. An assistant that silently rewrote
                    # constraints off a sentence it parsed would be a different product.
                    if name == "get_affected_sessions" and isinstance(result, dict):
                        proposal = _availability_proposal(result, args)
                        if proposal:
                            event["availability"] = proposal

                    yield event
                    conversation.append({
                        "type": "function_call_output",
                        "call_id": call.get("call_id"),
                        "output": json.dumps(result, ensure_ascii=False)[:60000],
                    })

            yield {"type": "error", "error": "tool_loop_exhausted",
                   "message": f"Stopped after {max_rounds} tool rounds."}


def _response_text(payload: dict) -> str:
    chunks: list[str] = []
    for item in payload.get("output", []):
        for part in item.get("content", []) or []:
            if part.get("type") in ("output_text", "text") and part.get("text"):
                chunks.append(part["text"])
    return "".join(chunks)


def _availability_proposal(result: dict, args: dict) -> dict | None:
    """The availability change a stated absence implies, for the client to OFFER.

    Returns None whenever the statement does not pin down a time, because the alternative is
    absurd: `get_affected_sessions` with no day and no slots considers the WHOLE week, and turning
    that into a proposal would offer to block a lecturer's entire timetable because somebody asked
    "what does Aubinger teach?".

    ⚠️ IT IS RECURRING, AND THE PAYLOAD SAYS SO. Availability is keyed on `slotId` — `Do-3`, a day
    and a block — and carries no date, so writing it blocks EVERY Thursday for good rather than one
    of them. The data model cannot express "just this week", so the client must not imply that it
    can; `recurring` is passed explicitly rather than left for the UI to assume either way.
    """
    if not isinstance(result, dict) or result.get("error"):
        return None
    teacher = result.get("teacher") or {}
    if not teacher.get("id"):
        return None
    # Only when the planner actually named a time. `slot_ids` is the tool's own argument name.
    day = (args or {}).get("day")
    slot_ids = (args or {}).get("slot_ids")
    if not day and not slot_ids:
        return None
    slots = result.get("slotsConsidered") or []
    if not slots:
        return None
    return {
        "teacherId": teacher["id"],
        "teacher": teacher.get("name"),
        "day": day,
        "slotIds": slots,
        # The dataset's own spelling, because the solver compares against it. The UI translates.
        "state": "nicht_verfuegbar",
        "recurring": True,
        "affectedCount": result.get("affectedCount"),
    }


def _summarise(name: str, result: dict) -> str:
    """One line a human can read in the transcript, so the tool call is not a black box."""
    if not isinstance(result, dict):
        return str(result)[:200]
    if "error" in result:
        return f"{result['error']}"
    if name == "get_affected_sessions":
        # ⚠️ "None Studierende betroffen" IS WHAT `or 0` WOULD HAVE HIDDEN, AND BOTH ARE WRONG.
        # A real Untis export publishes no class sizes, so `students` is None — and `.get(k, 0)`
        # only defaults a MISSING key, not a present one holding None, so the trace printed the
        # word None to the planner. Defaulting to 0 would have been worse: "0 Studierende
        # betroffen" is a sentence somebody acts on. The count is named only when it is known.
        affected = result.get("affectedCount", 0)
        if result.get("studentsKnown") and result.get("students") is not None:
            return f"{affected} Termine, {result['students']} Studierende betroffen"
        return f"{affected} Termine betroffen (Teilnehmendenzahlen nicht im Export)"
    if name == "detect_conflicts":
        return f"{result.get('hard', 0)} harte Konflikte von {result.get('checked', 0)} geprüften Terminen"
    if name == "propose_repairs":
        opts = result.get("options", [])
        if not opts:
            return "keine konfliktfreie Lösung gefunden"
        best = opts[0]
        return (f"{len(opts)} Optionen, beste verschiebt {best['sessionsMoved']} Termine "
                f"({'optimal' if best['optimalityProven'] else 'beste in Zeit'})")
    if name == "explain_infeasibility":
        return "möglich" if result.get("feasible") else "; ".join(result.get("reasons", []))[:200]
    if name == "get_plan_overview":
        types = result.get("roomTypes") or {}
        if types:
            # Name the room type in the trace. "ok" told a reader nothing, which defeats the
            # point of showing the trace at all — the line should be checkable against the answer.
            parts = [f"{k}: {v.get('count', 0)} Räume, {round(v.get('utilisation', 0) * 100)}% belegt"
                     for k, v in list(types.items())[:3]]
            return "; ".join(parts)
        return (f"{result.get('teachingRooms', 0)} Lehrräume von {result.get('allRooms', 0)}, "
                f"{result.get('buildings', 0)} Gebäude")
    if name == "find_substitute":
        cands = result.get("candidates") or []
        if not cands:
            # ⚠️ The empty case has to READ as an answer in the trace, not as a tool that did
            # nothing — otherwise the agent narrates a silence.
            return (f"keine Vertretung möglich ({result.get('consideredCount', 0)} geprüft: "
                    + ", ".join(f"{n}× {r}" for r, n in sorted((result.get('rejected') or {}).items()))
                    + ")")
        best = cands[0]
        return (f"{len(cands)} mögliche Vertretung(en), beste: {best.get('name')} "
                f"({', '.join(x['text'] for x in best.get('reasons', []))})")
    if name == "get_calendar":
        subject = (result.get("subject") or {}).get("name") or (result.get("subject") or {}).get("id")
        parts = [f"{subject}: {result.get('bookedCount', 0)} Termine",
                 f"{len(result.get('free') or [])} freie Zeitfenster"]
        if result.get("unavailable"):
            parts.append(f"{len(result['unavailable'])} gesperrt")
        return ", ".join(parts)
    return "ok"
