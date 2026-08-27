"""Recover files from an ACR image without a Docker daemon.

Pulls the manifest and layer blobs over the registry REST API and unpacks them, newest layer last
so later layers overwrite earlier ones — the same order the runtime would see.

Usage:  ACR_NAME=<registry> python tools/ops/recover_image_source.py <repository> <tag>
Output goes to `RECOVER_OUT` (default: a `.recovered/` folder in the repo root, gitignored).
"""
import gzip
import io
import json
import os
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

ACR = os.environ.get("ACR_NAME") or sys.exit(
    "ACR_NAME is not set — the container registry to pull from."
)
REPO = sys.argv[1] if len(sys.argv) > 1 else "maritime-ais-relay"
TAG = sys.argv[2] if len(sys.argv) > 2 else "latest"
OUT = Path(os.environ.get("RECOVER_OUT")
           or (Path(__file__).resolve().parents[2] / ".recovered")) / f"{REPO}-{TAG}"
KEEP = (".js", ".mjs", ".json", ".ts")

refresh = json.loads(subprocess.run(
    ["az", "acr", "login", "-n", ACR, "--expose-token", "-o", "json"],
    capture_output=True, text=True, check=True, shell=True).stdout)["accessToken"]

def post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"content-type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=120))

import urllib.parse  # noqa: E402
token = post(f"https://{ACR}.azurecr.io/oauth2/token", {
    "grant_type": "refresh_token",
    "service": f"{ACR}.azurecr.io",
    "scope": f"repository:{REPO}:pull",
    "refresh_token": refresh,
})["access_token"]

def get(path, accept):
    req = urllib.request.Request(f"https://{ACR}.azurecr.io/v2/{REPO}/{path}",
                                 headers={"authorization": f"Bearer {token}", "accept": accept})
    return OPENER.open(req, timeout=300)


class StripAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """Blob fetches 302 to Azure storage, which rejects the registry's bearer token.

    urllib replays every header on a redirect, so the storage endpoint sees a token meant for the
    registry and answers 401 — the SAS in the redirect URL is the credential.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers = {k: v for k, v in new.headers.items() if k.lower() != "authorization"}
        return new


OPENER = urllib.request.build_opener(StripAuthOnRedirect)

MANIFEST_TYPES = ",".join([
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.index.v1+json",
])
manifest = json.load(get(f"manifests/{TAG}", MANIFEST_TYPES))
if "manifests" in manifest:  # multi-arch index
    digest = manifest["manifests"][0]["digest"]
    manifest = json.load(get(f"manifests/{digest}", MANIFEST_TYPES))

layers = manifest["layers"]
print(f"{REPO}:{TAG} — {len(layers)} layers")
OUT.mkdir(parents=True, exist_ok=True)
written = 0
for i, layer in enumerate(layers, 1):
    blob = get(f"blobs/{layer['digest']}", "*/*").read()
    try:
        raw = gzip.decompress(blob)
    except OSError:
        raw = blob
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        for member in tar.getmembers():
            if not member.isfile() or "node_modules" in member.name:
                continue
            if not member.name.endswith(KEEP):
                continue
            data = tar.extractfile(member)
            if data is None:
                continue
            target = OUT / member.name.replace("..", "_")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data.read())
            written += 1
    print(f"  layer {i}/{len(layers)} done")

print(f"\nrecovered {written} files into {OUT}")
for p in sorted(OUT.rglob("*")):
    if p.is_file():
        print(f"  {p.stat().st_size:>8,}  {p.relative_to(OUT).as_posix()}")
