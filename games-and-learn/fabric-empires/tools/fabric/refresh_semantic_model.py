"""Frame the Direct Lake model, then re-validate.

A newly created Direct Lake model holds table METADATA but no loaded database
until it is processed, and the symptom of that is exactly what the validation
hit: measures parse, tables "cannot be found". So this is a refresh problem,
not a TMDL problem, and the fix is to process before concluding anything.
"""

import json
import subprocess
import time
import urllib.error
import urllib.request

import _config

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
WS = _config.workspace_id()
DS = _config.model_id()

tok = subprocess.run(
    [AZ, "account", "get-access-token", "--resource", "https://analysis.windows.net/powerbi/api",
     "--query", "accessToken", "-o", "tsv"],
    capture_output=True, text=True, check=True).stdout.strip()
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
BASE = f"https://api.powerbi.com/v1.0/myorg/groups/{WS}/datasets/{DS}"


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=H, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:800]


def get(url):
    req = urllib.request.Request(url, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:800]


st, body = post(f"{BASE}/refreshes", {"type": "full"})
print(f"refresh POST -> {st} {body if st >= 400 else ''}")

for i in range(1, 41):
    time.sleep(8)
    st, body = get(f"{BASE}/refreshes?$top=1")
    if st >= 400:
        print(f"  poll {i}: HTTP {st} {body}")
        continue
    entries = body.get("value", [])
    if not entries:
        print(f"  poll {i}: no refresh history yet")
        continue
    e = entries[0]
    print(f"  poll {i}: status={e.get('status')} {e.get('serviceExceptionJson', '')[:200]}")
    if e.get("status") in ("Completed", "Failed", "Disabled"):
        break
