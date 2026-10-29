"""Publish the import model and its report from fabric/pbip to the Fabric workspace (D57).

The PBIP carries its data inline (deflate + base64 in M), so the published model needs no
lakehouse, gateway or credential: create (or update) it from the definition, refresh it once,
then create (or update) the report bound to it `byConnection`. Both land in the folder
"Berliner Stadtwerke" (D14). Idempotent by display name, so the ids the app embeds stay stable.

⚠️ EVERY RUN STARTS WITH THE GUARD (tools/guard_items.py --live); an update guards its item id too. A new item
must be added to tools/fabric/allowed-items.json by hand once it exists; the script prints its id.

⚠️ THE AGREEMENT GATE RUNS AGAINST THE PUBLISHED MODEL: solar per partner, charge points and the
300 m figures must equal fabric/build/expected.json (the app's own numbers), or the script fails.

Writes tools/fabric/powerbi.json (tenant, report id, page names; gitignored) for the report window; vite.config.ts reads it at build time.

Usage:  python tools/fabric/publish_pbip.py [--check-only]
"""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "tools" / "fabric" / "fabric.json").read_text(encoding="utf-8"))
TENANT, WORKSPACE = CFG["tenantId"], CFG["workspaceId"]
PBIP = ROOT / "fabric" / "pbip"
MODEL_DIR = PBIP / "Berliner-Stadtwerke-Zwilling.SemanticModel"
REPORT_DIR = PBIP / "Berliner-Stadtwerke-Zwilling.Report"
NAME = "Berliner Stadtwerke Zwilling"
FOLDER = "Berliner Stadtwerke"
APP_CONFIG = ROOT / "tools" / "fabric" / "powerbi.json"  # local, gitignored: tenant and report id stay out of the source
AZ = shutil.which("az") or "az"
FABRIC = "https://api.fabric.microsoft.com/v1"
PBI = f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE}"


def token(resource: str) -> str:
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--tenant", TENANT, "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=False, shell=sys.platform == "win32",
    )
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit(f"no token for {resource}: {out.stderr.strip()[:200]}")
    return out.stdout.strip()


def guard(ids: list[str] | None = None, names: list[str] | None = None) -> None:
    args = [sys.executable, "-I", "-X", "utf8", str(ROOT / "tools" / "guard_items.py"), "--live"]
    for i in ids or []:
        args += ["--id", i]
    for n in names or []:
        args += ["--name", n]
    if subprocess.run(args, check=False).returncode != 0:  # noqa: S603
        raise SystemExit("guard refused: nothing was written")


def call(method: str, url: str, body: dict | None = None, resource: str = "https://api.fabric.microsoft.com") -> tuple[int, dict]:
    """(status, json); follows a Fabric 202 long-running operation to its result."""
    headers = {"Authorization": f"Bearer {token(resource)}", "Content-Type": "application/json"}
    url = url if url.startswith("http") else FABRIC + url
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=300) as r:  # noqa: S310
            status, raw, hdrs = r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {url} -> {exc.code}\n{exc.read().decode('utf-8', 'replace')[:2000]}") from exc
    if status == 202 and hdrs.get("Location"):
        loc = hdrs["Location"]
        for _ in range(120):
            time.sleep(float(hdrs.get("Retry-After", 3)))
            with urllib.request.urlopen(urllib.request.Request(loc, headers=headers), timeout=120) as r:  # noqa: S310
                state = json.loads(r.read() or b"{}")
            if state.get("status") in ("Succeeded", "Completed"):
                try:
                    with urllib.request.urlopen(urllib.request.Request(loc + "/result", headers=headers), timeout=120) as r:  # noqa: S310
                        return 200, json.loads(r.read() or b"{}")
                except urllib.error.HTTPError:
                    return 200, state
            if state.get("status") == "Failed":
                raise SystemExit(f"{method} {url} failed: {json.dumps(state)[:2000]}")
        raise SystemExit(f"{method} {url}: operation did not finish")
    return status, (json.loads(raw) if raw else {})


def items(kind: str) -> list[dict]:
    out, url = [], f"/workspaces/{WORKSPACE}/{kind}"
    while url:
        _, page = call("GET", url)
        out += page.get("value", [])
        url = page.get("continuationUri")
    return out


def parts(folder: Path, skip_root: set[str]) -> list[dict]:
    out = []
    for p in sorted(folder.rglob("*")):
        rel = p.relative_to(folder).as_posix()
        if not p.is_file() or rel.split("/")[0] in skip_root or rel.startswith(".pbi"):
            continue
        out.append({"path": rel, "payload": base64.b64encode(p.read_bytes()).decode("ascii"), "payloadType": "InlineBase64"})
    return out


def upsert(kind: str, definition: dict, description: str) -> str:
    existing = [x for x in items(kind) if x["displayName"] == NAME]
    if len(existing) > 1:
        raise SystemExit(f"{len(existing)} {kind} named {NAME!r}: resolve by hand")
    if existing:
        item_id = existing[0]["id"]
        guard(ids=[item_id])
        print(f"updating {kind} {item_id}")
        call("POST", f"/workspaces/{WORKSPACE}/{kind}/{item_id}/updateDefinition", {"definition": definition})
        return item_id
    print(f"creating {kind}")
    call("POST", f"/workspaces/{WORKSPACE}/{kind}", {"displayName": NAME, "description": description, "definition": definition})
    created = [x for x in items(kind) if x["displayName"] == NAME]
    if len(created) != 1:
        raise SystemExit(f"expected one {kind} named {NAME!r}, found {len(created)}")
    # Printed at once: if a later step fails, this id is what the allow-list needs before a rerun.
    print(f"  created {kind} {created[0]['id']}: add it to tools/fabric/allowed-items.json")
    return created[0]["id"]


def refresh(model_id: str) -> None:
    pbi = "https://analysis.windows.net/powerbi/api"
    # ⚠️ On an update the history already holds the LAST refresh, completed: only an entry that
    # started after this request counts, or the old one would pass for the new one.
    asked = datetime.now(timezone.utc) - timedelta(seconds=30)
    call("POST", f"{PBI}/datasets/{model_id}/refreshes", {"type": "full"}, resource=pbi)
    for _ in range(90):
        time.sleep(5)
        _, page = call("GET", f"{PBI}/datasets/{model_id}/refreshes?$top=1", resource=pbi)
        state = page["value"][0]
        started = datetime.fromisoformat(state.get("startTime", "1970-01-01T00:00:00Z").replace("Z", "+00:00"))
        if started < asked:
            continue
        if state.get("status") == "Completed":
            print("  refresh completed")
            return
        if state.get("status") == "Failed":
            raise SystemExit(f"refresh failed: {str(state.get('serviceExceptionJson'))[:800]}")
    raise SystemExit("refresh did not complete")


def dax(model_id: str, query: str) -> list[dict]:
    _, res = call("POST", f"{PBI}/datasets/{model_id}/executeQueries",
                  {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}},
                  resource="https://analysis.windows.net/powerbi/api")
    return res["results"][0]["tables"][0]["rows"]


def agreement(model_id: str) -> None:
    """The published model must say what the app says (PLAN §6 agreement gate)."""
    exp = json.loads((ROOT / "fabric" / "build" / "expected.json").read_text(encoding="utf-8"))
    rows = dax(model_id, 'EVALUATE SUMMARIZECOLUMNS(Partner[Partner-Schlüssel], "kwp", [Solarleistung kWp], "n", [Solaranlagen])')
    got = {r["Partner[Partner-Schlüssel]"]: r for r in rows}
    row = dax(model_id, 'EVALUATE ROW("p", [Ladepunkte], "b", [Ladepunkte Stadtwerke], '
                        '"n3", [Ladepunkte bis 300 m um Quartiere], "b3", [Stadtwerke-Ladepunkte bis 300 m um Quartiere], "q", [Quartiere])')[0]
    bad = []
    for key, kwp in exp["solarKwp"].items():
        if abs((got.get(key, {}).get("[kwp]") or 0) - kwp) > 0.5:
            bad.append(f"solar {key}: {got.get(key, {}).get('[kwp]')} vs {kwp}")
        if got.get(key, {}).get("[n]") != exp["solarUnits"][key]:
            bad.append(f"units {key}: {got.get(key, {}).get('[n]')} vs {exp['solarUnits'][key]}")
    for label, want in (("[p]", exp["chargingPoints"]), ("[b]", exp["bswChargingPoints"]), ("[n3]", exp["pointsNear300"]),
                        ("[b3]", exp["bswPointsNear300"]), ("[q]", exp["estates"])):
        if row.get(label) != want:
            bad.append(f"{label}: {row.get(label)} vs {want}")
    if bad:
        raise SystemExit("AGREEMENT GATE FAILED:\n  - " + "\n  - ".join(bad))
    print("agreement gate ok: solar per partner, units, charge points, 300 m figures and estates match the app")


def into_folder(item_ids: list[str]) -> None:
    _, page = call("GET", f"/workspaces/{WORKSPACE}/folders")
    folder = next((f for f in page.get("value", []) if f["displayName"] == FOLDER), None)
    if not folder:
        raise SystemExit(f"folder {FOLDER!r} missing")
    for i in item_ids:
        _, item = call("GET", f"/workspaces/{WORKSPACE}/items/{i}")
        if item.get("folderId") != folder["id"]:
            call("POST", f"/workspaces/{WORKSPACE}/items/{i}/move", {"targetFolderId": folder["id"]})
            print(f"  moved {i} into {FOLDER}")


def main() -> None:
    if "--check-only" in sys.argv:
        model = next(x["id"] for x in items("semanticModels") if x["displayName"] == NAME)
        agreement(model)
        return
    guard(ids=[WORKSPACE], names=[NAME])
    model_def = {"parts": parts(MODEL_DIR, set())}
    model_id = upsert("semanticModels", model_def,
                      "Berlin-Zwilling: offene Daten zu Solar, Laden und degewo-Quartieren (Import, Daten im Modell). Demo von Microsoft.")
    refresh(model_id)
    agreement(model_id)
    report_parts = [p for p in parts(REPORT_DIR, set()) if p["path"] != "definition.pbir"]
    pbir = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0", "datasetReference": {"byConnection": {"connectionString": f"semanticmodelid={model_id}"}},
    }
    report_parts.append({"path": "definition.pbir", "payload": base64.b64encode(json.dumps(pbir).encode()).decode("ascii"), "payloadType": "InlineBase64"})
    report_id = upsert("reports", {"parts": report_parts}, "Berlin-Zwilling: Stadtwerke, degewo, BVG, Laden. Demo von Microsoft.")
    into_folder([model_id, report_id])
    pages = json.loads((REPORT_DIR / "definition" / "pages" / "pages.json").read_text(encoding="utf-8"))["pageOrder"]
    APP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    APP_CONFIG.write_text(json.dumps({"tenantId": TENANT, "reportId": report_id, "pages": pages}, indent=2) + "\n", encoding="utf-8")
    print(f"model {model_id}\nreport {report_id}\nwrote {APP_CONFIG.relative_to(ROOT)}; add both ids to tools/fabric/allowed-items.json")


if __name__ == "__main__":
    main()
