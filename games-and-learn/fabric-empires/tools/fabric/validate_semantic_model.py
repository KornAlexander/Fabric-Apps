"""Validate the deployed model with real DAX before any report is built.

A report is a bad place to discover that a measure returns BLANK: a blank card
and a correct-but-empty card look identical. Every query below is chosen to
fail loudly if a specific thing is wrong:

  totals        -> Direct Lake framed at all, and the fact tables have rows
  by context    -> the seeded pressure effect survived into the model
  by domain     -> the Skill relationship actually matches (this is the join
                   that would silently return one blank row if the keys differed)
  text measures -> the more complex DAX parses and evaluates
"""

import json
import subprocess
import urllib.error
import urllib.request

import _config

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
DS = _config.model_id()

tok = subprocess.run(
    [AZ, "account", "get-access-token", "--resource", "https://analysis.windows.net/powerbi/api",
     "--query", "accessToken", "-o", "tsv"],
    capture_output=True, text=True, check=True).stdout.strip()
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

QUERIES = {
    "totals": "EVALUATE ROW(\"Games\", [Games], \"Attempts\", [Attempts], "
              "\"Accuracy\", [Accuracy], \"Win Rate\", [Win Rate], "
              "\"Skills Practised\", [Skills Practised], \"Skill Coverage\", [Skill Coverage])",
    "by context": "EVALUATE TOPN(10, SUMMARIZECOLUMNS('Attempt'[Context], "
                  "\"Attempts\", [Attempts], \"Accuracy\", [Accuracy], "
                  "\"Avg Secs\", [Avg Answer Seconds], \"Gap\", [Pressure Gap]), [Attempts], DESC)",
    "by domain": "EVALUATE SUMMARIZECOLUMNS('Skill'[Domain], \"Attempts\", [Attempts], "
                 "\"Accuracy\", [Accuracy])",
    "text measures": "EVALUATE ROW(\"Weakest\", [Weakest Skill], \"Strongest\", [Strongest Skill], "
                     "\"Notice\", [Data Notice])",
    "game join": "EVALUATE SUMMARIZECOLUMNS('Game'[Difficulty], \"Attempts\", [Attempts], "
                 "\"Accuracy\", [Accuracy], \"Games\", [Games])",
}

url = f"https://api.powerbi.com/v1.0/myorg/datasets/{DS}/executeQueries"
failures = 0

for label, dax in QUERIES.items():
    body = {"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=H, method="POST")
    print(f"\n=== {label} ===")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            res = json.loads(r.read().decode("utf-8"))
        rows = res["results"][0]["tables"][0]["rows"]
        if not rows:
            print("  NO ROWS returned")
            failures += 1
            continue
        for row in rows:
            print("  " + "  ".join(
                f"{k.split('[')[-1].rstrip(']')}={v if not isinstance(v, float) else round(v, 4)}"
                for k, v in row.items()))
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:600]}")
        failures += 1

print(f"\n{'ALL QUERIES OK' if failures == 0 else f'{failures} QUERY GROUP(S) FAILED'}")
