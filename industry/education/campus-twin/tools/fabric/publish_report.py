"""Publish a PBIR report folder to the workspace, bound to a semantic model, or delete one.

One step of docs/POWER-BI-EMBED.md. Idempotent: a report with the same display name is UPDATED in
place and keeps its id, which matters because the id is what the app's embed configuration points
at. Publishing twice must not leave the app pointing at a report that no longer exists.

⚠️ THE BINDING IS WRITTEN HERE, NOT TAKEN FROM THE FOLDER. A PBIR folder on disk usually refers to
its model `byPath` (a sibling folder). That means nothing to the REST API: it needs `byConnection`
with the id of a model that already exists in the service. So `definition.pbir` is generated from
`FABRIC_SEMANTIC_MODEL_ID`, and whatever the folder carries is ignored, which also keeps one
tenant's ids out of the report source.

⚠️ A FAILED IMPORT SAYS LITTLE. The two causes met so far, both checked before anything is sent:
  * a visual's `name` (its id, not its title) containing a non-ASCII character
    -> `Report_Import_FailedToImportReport: Property 'name' has unsupported characters`
  * a page folder whose name differs from the `name` in its `page.json`, or a page missing from
    `pages.json` -> the report imports and then does not render

Usage
  $env:FABRIC_WORKSPACE_ID = "<workspace guid>"
  $env:FABRIC_SEMANTIC_MODEL_ID = "<semantic model guid>"
  $env:FABRIC_FOLDER_ID = "<folder guid>"          # optional, only used on creation
  $env:FABRIC_TENANT_ID = "<tenant guid>"          # optional, when az defaults to another tenant
  python tools/fabric/publish_report.py --site <site>           # a site from sites.py
  python tools/fabric/publish_report.py --site <site> --lang en # its English report, where it has one
  python tools/fabric/publish_report.py --source <path to X.Report> --name "<display name>" --model-name "<model>"
  python tools/fabric/publish_report.py --delete --report-id <guid> --name "<display name>"
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from fabric_ids import folder_id, semantic_model_id, tenant_id, workspace_id
from sites import SITES, add_language_argument

FABRIC_API = "https://api.fabric.microsoft.com/v1"
AZ = shutil.which("az") or "az"

#: Folder entries that are not part of a report definition as the API understands it.
#: `.platform` carries a logicalId for git integration; the service assigns its own on creation.
SKIP = {".platform", "definition.pbir", ".pbi"}


def token() -> str:
    """An access token from the signed-in az session. Never printed, never written anywhere."""
    command = [AZ, "account", "get-access-token", "--resource", "https://api.fabric.microsoft.com",
               "--query", "accessToken", "-o", "tsv"]
    tenant = tenant_id()
    if tenant:
        command += ["--tenant", tenant]
    out = subprocess.run(command, capture_output=True, text=True)  # noqa: S603
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit("az could not issue a Fabric token: run `az login` (and set FABRIC_TENANT_ID "
                         "if the workspace is in another tenant).")
    return out.stdout.strip()


def call(method: str, url: str, headers: dict, body: dict | None = None):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=headers,
        method=method,
    )
    # A throttled or dropped call is retried: an abort here leaves the service finishing an
    # operation this script has stopped watching. Anything else is reported as it is.
    for attempt in range(4):
        try:
            response = urllib.request.urlopen(request, timeout=300)  # noqa: S310
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 3:
                time.sleep(int(exc.headers.get("Retry-After") or 15))
                continue
            raise SystemExit(f"{method} {url} failed: {exc.code}\n{exc.read().decode('utf-8', 'replace')}")
        except urllib.error.URLError as exc:
            if attempt < 3:
                time.sleep(10)
                continue
            raise SystemExit(f"{method} {url} could not be reached: {exc.reason}")
    raw = response.read()
    return response.status, (json.loads(raw) if raw else {}), response.headers


def wait_for(location: str | None, headers: dict) -> None:
    """Follow a long-running operation to its end. A 202 is a promise, not a result."""
    if not location:
        return
    for _ in range(90):
        time.sleep(4)
        _, status, _ = call("GET", location, headers)
        state = status.get("status")
        if state == "Succeeded":
            return
        if state == "Failed":
            raise SystemExit(f"the service rejected the report:\n{json.dumps(status, indent=2)}")
    raise SystemExit("the service did not finish within six minutes; check the workspace before retrying")


def read_parts(source: Path) -> dict[str, bytes]:
    parts: dict[str, bytes] = {}
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix()
        segments = relative.split("/")
        # Dot-files anywhere (`.DS_Store`, editor droppings) are never part of a report.
        if segments[0] in SKIP or any(s.startswith(".") for s in segments):
            continue
        parts[relative] = path.read_bytes()
    for required in ("definition/report.json", "definition/version.json", "definition/pages/pages.json"):
        if required not in parts:
            raise SystemExit(f"{source} is not a PBIR report folder: {required} is missing")
    return parts


def check(parts: dict[str, bytes]) -> list[str]:
    """The page names a URL can address, after refusing what the import is known to choke on."""
    problems: list[str] = []
    pages_meta = json.loads(parts.get("definition/pages/pages.json", b"{}"))
    order = pages_meta.get("pageOrder", [])
    found = []
    for path, raw in parts.items():
        bits = path.split("/")
        if path.endswith("/page.json") and len(bits) == 4:
            page = json.loads(raw)
            found.append(bits[2])
            if page.get("name") != bits[2]:
                problems.append(f"{path}: name {page.get('name')!r} differs from its folder {bits[2]!r}")
        if path.endswith("/visual.json"):
            name = json.loads(raw).get("name", "")
            if not name.isascii():
                problems.append(f"{path}: visual name {name!r} is not ASCII, the import refuses it")
    for page in found:
        if page not in order:
            problems.append(f"page {page!r} is not listed in pages.json, it would not be shown")
    for page in order:
        if page not in found:
            problems.append(f"pages.json lists {page!r}, which has no folder")
    if not order:
        problems.append("the report has no pages")
    if problems:
        raise SystemExit("not publishing:\n  - " + "\n  - ".join(problems))
    return order


def binding(model_id: str) -> bytes:
    """`definition.pbir` pointing at a model in the service. Only the id is read by the API."""
    return json.dumps(
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
            "version": "4.0",
            "datasetReference": {"byConnection": {"connectionString": f"semanticmodelid={model_id}"}},
        },
        indent=2,
    ).encode("utf-8")


def find(workspace: str, headers: dict, name: str) -> list[dict]:
    reports: list[dict] = []
    url: str | None = f"{FABRIC_API}/workspaces/{workspace}/reports"
    while url:
        _, page, _ = call("GET", url, headers)
        reports += [r for r in page.get("value", []) if r["displayName"] == name]
        url = page.get("continuationUri")
    return reports


def bound_model(workspace: str, report_id: str) -> str | None:
    """The semantic model an existing report reads from, or `None` if the service will not say."""
    command = [AZ, "account", "get-access-token", "--resource", "https://analysis.windows.net/powerbi/api",
               "--query", "accessToken", "-o", "tsv"]
    if tenant_id():
        command += ["--tenant", tenant_id()]
    out = subprocess.run(command, capture_output=True, text=True)  # noqa: S603
    if out.returncode != 0:
        return None
    request = urllib.request.Request(
        f"https://api.powerbi.com/v1.0/myorg/groups/{workspace}/reports/{report_id}",
        headers={"Authorization": f"Bearer {out.stdout.strip()}"},
    )
    try:
        return json.loads(urllib.request.urlopen(request, timeout=120).read()).get("datasetId")  # noqa: S310
    except (urllib.error.HTTPError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish or delete a PBIR report in Fabric.")
    parser.add_argument("--site", choices=sorted(SITES),
                        help="a site from sites.py: sets --source, --name and --model-name for its report")
    add_language_argument(parser)
    parser.add_argument("--source", type=Path, help="the X.Report folder to publish")
    parser.add_argument("--name", help="display name of the report in the workspace")
    parser.add_argument("--delete", action="store_true", help="delete instead of publishing")
    parser.add_argument("--report-id", help="required with --delete: the id that must carry --name")
    parser.add_argument("--model-name",
                        help="display name the model behind FABRIC_SEMANTIC_MODEL_ID must have")
    parser.add_argument("--rebind", action="store_true",
                        help="allow updating a report that currently reads from a DIFFERENT model")
    args = parser.parse_args()
    if args.site:
        site = SITES[args.site]
        # Both languages of a site read from the site's one model; only folder and name differ.
        # A language the site has no report in is refused here, before anything is looked up.
        args.source = args.source or site.report_dir_in(args.lang)
        args.name = args.name or site.report_name_in(args.lang)
        args.model_name = args.model_name or site.model_name
    elif args.lang != "de":
        raise SystemExit("--lang belongs to --site: without a site, name the folder and the report yourself")
    if not args.name:
        raise SystemExit("say which report: --site <site>, or --name")
    # ⚠️ PUBLISHING NEEDS TO KNOW WHICH MODEL IT EXPECTS, ALWAYS. This check used to run only when
    # `--model-name` happened to be passed, and a guard that is optional guards the careful run and
    # not the hurried one. The model id comes from the shell; the name it must have comes from here.
    if not args.delete and not args.model_name:
        raise SystemExit("say which model the report is for: --site <site>, or --model-name")

    workspace = workspace_id()
    headers = {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}
    existing = find(workspace, headers, args.name)

    if args.delete:
        # ⚠️ BOTH THE ID AND THE NAME MUST AGREE. Deleting by name alone removes whatever happens to
        # be called that today; deleting by id alone trusts a guid pasted from somewhere. Only an
        # item that is both is the one that was meant.
        if not args.report_id:
            raise SystemExit("--delete needs --report-id")
        match = [r for r in existing if r["id"] == args.report_id]
        if not match:
            raise SystemExit(f"no report with id {args.report_id} is named {args.name!r}; nothing deleted")
        call("DELETE", f"{FABRIC_API}/workspaces/{workspace}/reports/{args.report_id}", headers)
        print(f"deleted report {args.report_id} ({args.name})")
        return

    if not args.source:
        raise SystemExit("--source is required to publish")
    if len(existing) > 1:
        raise SystemExit(f"{len(existing)} reports are named {args.name!r}; refusing to guess which to update")

    parts = read_parts(args.source)
    pages = check(parts)
    model = semantic_model_id()
    # A model id from another workspace imports and then renders nothing: say so before sending.
    _, found, _ = call("GET", f"{FABRIC_API}/workspaces/{workspace}/semanticModels/{model}", headers)
    # ⚠️ AND IS IT THE MODEL THIS REPORT WAS BUILT FOR? The id comes from the shell, and the shell
    # that published another site's report a minute ago still holds that site's model id. Bound to
    # the wrong model the report imports cleanly and shows another campus under this one's name.
    if found.get("displayName") != args.model_name:
        raise SystemExit(
            f"FABRIC_SEMANTIC_MODEL_ID is the model {found.get('displayName')!r}, but this report is for "
            f"{args.model_name!r}. Set FABRIC_SEMANTIC_MODEL_ID to that model's id."
        )
    if existing:
        # ⚠️ SAME NAME IS NOT SAME REPORT. Updating rewrites the binding too, so a hand-built report
        # that merely shares the display name would be silently repointed at this model. Only a
        # report already reading from it is taken to be an earlier publish of this one.
        # An unknown binding is refused too: "could not check" must not become "allowed".
        current = bound_model(workspace, existing[0]["id"])
        if current != model and not args.rebind:
            reads = f"reads from model {current}" if current else "could not be asked which model it reads from"
            raise SystemExit(
                f"a report named {args.name!r} exists and {reads}; this run would bind it to {model}.\n"
                "Pick another --name, or pass --rebind if repointing it is what you mean."
            )
    parts["definition.pbir"] = binding(model)
    definition = {
        "parts": [
            {"path": path, "payload": base64.b64encode(raw).decode("ascii"), "payloadType": "InlineBase64"}
            for path, raw in parts.items()
        ]
    }

    if existing:
        report_id = existing[0]["id"]
        print(f"updating report {report_id}")
        _, _, response_headers = call(
            "POST",
            f"{FABRIC_API}/workspaces/{workspace}/reports/{report_id}/updateDefinition",
            headers,
            {"definition": definition},
        )
        wait_for(response_headers.get("Location"), headers)
    else:
        print("creating report")
        body: dict = {"displayName": args.name, "definition": definition}
        if folder_id():
            body["folderId"] = folder_id()
        _, _, response_headers = call("POST", f"{FABRIC_API}/workspaces/{workspace}/reports", headers, body)
        wait_for(response_headers.get("Location"), headers)
        created = find(workspace, headers, args.name)
        if len(created) != 1:
            raise SystemExit(f"expected one report named {args.name!r} after creating it, found {len(created)}")
        report_id = created[0]["id"]

    print(f"report id : {report_id}")
    print(f"pages     : {', '.join(pages)}")
    print(f"{len(parts)} parts published. Open it once in the service before trusting it: a successful")
    print("import does not prove the visuals render.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
