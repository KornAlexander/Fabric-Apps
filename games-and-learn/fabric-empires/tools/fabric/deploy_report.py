"""Create or update the Fabric Empires report item from the local PBIR."""

import base64
import json
import subprocess
import time
import urllib.error
import urllib.request

import _config

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
WS = _config.workspace_id()
NAME = _config.REPORT_NAME
ROOT = _config.REPORT_DIR
API = "https://api.fabric.microsoft.com/v1"

tok = subprocess.run(
    [AZ, "account", "get-access-token", "--resource", "https://api.fabric.microsoft.com",
     "--query", "accessToken", "-o", "tsv"],
    capture_output=True, text=True, check=True).stdout.strip()
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def call(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            raw = r.read().decode("utf-8")
            return r.status, dict(r.headers), (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} on {method} {url}\n{e.read().decode('utf-8','replace')[:2000]}")


def parts():
    """⚠️ `definition.pbir` carries `{{FE_WORKSPACE_NAME}}` and `{{FE_MODEL_ID}}`,
    not real ones. They are substituted here, on the way to the API, so the file
    on disk stays free of coordinates. Binary parts (the background PNG) are
    uploaded untouched."""
    out = []
    for p in sorted(ROOT.rglob("*")):
        if p.is_file():
            raw = p.read_bytes()
            try:
                raw = _config.resolve(raw.decode("utf-8")).encode("utf-8")
            except UnicodeDecodeError:
                pass
            out.append({"path": p.relative_to(ROOT).as_posix(),
                        "payload": base64.b64encode(raw).decode("ascii"),
                        "payloadType": "InlineBase64"})
    return out


def wait(headers, label):
    loc = headers.get("Location")
    if not loc:
        return
    for _ in range(90):
        time.sleep(4)
        _s, _h, body = call("GET", loc)
        state = (body or {}).get("status")
        if state in ("Succeeded", "Completed"):
            print(f"  {label}: {state}")
            return
        if state == "Failed":
            raise SystemExit(f"{label} FAILED: {json.dumps(body)[:2000]}")
    raise SystemExit(f"{label}: timed out")


_s, _h, listing = call("GET", f"{API}/workspaces/{WS}/reports")
existing = next((i for i in listing.get("value", []) if i["displayName"] == NAME), None)

definition = {"parts": parts()}
print(f"{len(definition['parts'])} parts")

if existing:
    print(f"updating existing report {existing['id']}")
    _s, h, _ = call("POST", f"{API}/workspaces/{WS}/reports/{existing['id']}/updateDefinition",
                    {"definition": definition})
    wait(h, "updateDefinition")
    rid = existing["id"]
else:
    print("creating new report")
    st, h, body = call("POST", f"{API}/workspaces/{WS}/reports",
                       {"displayName": NAME, "definition": definition})
    if st == 202:
        wait(h, "create")
        _s, _h, listing = call("GET", f"{API}/workspaces/{WS}/reports")
        body = next(i for i in listing["value"] if i["displayName"] == NAME)
    rid = body["id"]

print(f"\nREPORT ID: {rid}")
print(f"URL: https://app.powerbi.com/groups/{WS}/reports/{rid}")
_config.OUT.mkdir(parents=True, exist_ok=True)
(_config.OUT / "report_id.txt").write_text(rid, encoding="utf-8")
