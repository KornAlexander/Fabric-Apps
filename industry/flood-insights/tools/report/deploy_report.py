"""Create (or update) the Flut-Insights report item in the Rayfin Apps workspace."""

import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WS = "${FABRIC_WORKSPACE_ID}"
SRC = Path(__file__).resolve().parent.parent.parent / "fabric" / "Flut-Insights.Report"
DISPLAY_NAME = "Flut-Insights — Betroffenheit & Deckung"

TOKEN = subprocess.run(
    ["az", "account", "get-access-token", "--resource", "https://api.fabric.microsoft.com",
     "--query", "accessToken", "-o", "tsv"],
    capture_output=True, text=True, shell=True, check=True,
).stdout.strip()


def call(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            raw = res.read().decode("utf-8")
            return res.status, (json.loads(raw) if raw.strip() else {}), dict(res.headers)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace"), dict(err.headers)


def await_lro(status, body, headers):
    if status != 202:
        return status, body
    loc = headers.get("Location")
    for _ in range(60):
        time.sleep(5)
        s, b, _h = call("GET", loc)
        if isinstance(b, dict) and b.get("status") in ("Succeeded", "Failed"):
            return (200 if b["status"] == "Succeeded" else 500), b
    return 504, "LRO timed out"


parts = []
for path in sorted(SRC.rglob("*")):
    if path.is_file():
        parts.append({
            "path": path.relative_to(SRC).as_posix(),
            "payload": base64.b64encode(path.read_bytes()).decode("ascii"),
            "payloadType": "InlineBase64",
        })
print(f"{len(parts)} parts")

status, items, _ = call("GET", f"https://api.fabric.microsoft.com/v1/workspaces/{WS}/reports")
existing = next(
    (i for i in items.get("value", []) if i.get("displayName") == DISPLAY_NAME), None
) if status == 200 else None

if existing:
    print(f"updating existing report {existing['id']}")
    s, b, h = call(
        "POST",
        f"https://api.fabric.microsoft.com/v1/workspaces/{WS}/reports/{existing['id']}/updateDefinition?updateMetadata=True",
        {"definition": {"parts": parts}},
    )
    s, b = await_lro(s, b, h)
    report_id = existing["id"]
else:
    print("creating report")
    s, b, h = call(
        "POST",
        f"https://api.fabric.microsoft.com/v1/workspaces/{WS}/items",
        {"displayName": DISPLAY_NAME, "type": "Report",
         "definition": {"format": "PBIR", "parts": parts}},
    )
    if s == 202:
        s, b = await_lro(s, b, h)
    report_id = b.get("id") if isinstance(b, dict) else None

print("->", s)
if s not in (200, 201):
    print(json.dumps(b, ensure_ascii=False)[:3000] if isinstance(b, dict) else str(b)[:3000])
    sys.exit(1)

if not report_id:
    _s2, items2, _h2 = call("GET", f"https://api.fabric.microsoft.com/v1/workspaces/{WS}/reports")
    report_id = next(i["id"] for i in items2["value"] if i["displayName"] == DISPLAY_NAME)

print(f"report id: {report_id}")
print(f"https://app.powerbi.com/groups/{WS}/reports/{report_id}")

