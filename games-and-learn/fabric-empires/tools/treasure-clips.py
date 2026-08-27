"""
Generate the two buried-cache clips with Sora 2.

The clips are SOURCE MATERIAL, not build output: regenerating them costs money
and returns a different film, so they are kept rather than rebuilt as part of a
normal build. They are ignored by git for size; see NOTICE.md.

⚠️ The endpoint is NOT hard-coded. It names a real Azure resource in a real
subscription, and this repository is meant to go public: a resource name is
something to probe, and it goes stale the moment the deployment moves. Set it
before running:

    $env:AZURE_OPENAI_ENDPOINT = 'https://<your-resource>.openai.azure.com'
    python tools/treasure-clips.py

Recipe per /memories/sora2_azure.md:
  - host is *.openai.azure.com, NOT cognitiveservices
  - seconds is a STRING and only '4' | '8' | '12'
  - size only '720x1280' | '1280x720'
  - the terminal status is 'completed', NOT 'succeeded'
  - the content path is '/content', NOT '/content/video'
  - poll defensively: the status field can be missing mid-job
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

HOST = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
MODEL = "sora-2"
# ⚠️ Relative to this file, not an absolute path: an absolute one would carry
# a username and a machine layout into a public repository, and it would only
# ever work on the one machine that wrote it.
OUT = pathlib.Path(__file__).resolve().parent.parent / "media" / "treasure-scenes"

CLIPS = {
    "treasure-found": (
        "Photorealistic cinematic close shot, shallow depth of field. A gloved hand "
        "sweeps wet dark earth and moss away from the curved iron-banded lid of a "
        "small buried strongbox, half sunk in a forest floor. Cold overcast northern "
        "daylight, fine drizzle, steam rising from the soil. The tarnished brass "
        "lock plate catches the light as the dirt clears. Handheld, slow push in. "
        "No people visible beyond the hand, no text, no titles."
    ),
    "treasure-opened": (
        "Photorealistic cinematic close shot, shallow depth of field. The iron-banded "
        "lid of a small weathered strongbox creaks open on wet forest ground, and warm "
        "golden light spills upward out of it across the rim and the surrounding moss, "
        "dust motes drifting through the beam. Cold overcast daylight around it so the "
        "glow is the only warm source. Slow push in, handheld. No people, no text, "
        "no titles."
    ),
}


def token() -> str:
    out = subprocess.run(
        [
            "az", "account", "get-access-token",
            "--resource", "https://cognitiveservices.azure.com",
            "--query", "accessToken", "-o", "tsv",
        ],
        capture_output=True, text=True, shell=True, check=True,
    )
    return out.stdout.strip()


def call(url: str, bearer: str, body: dict | None = None, tries: int = 5) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(tries):
        req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
        req.add_header("Authorization", f"Bearer {bearer}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as err:
            # ⚠️ A transient 500 while polling used to kill the job client-side
            # and throw away a paid generation. Retry the 5xx; fail fast on 4xx,
            # which is a real mistake in the request and will never come good.
            if err.code < 500 or attempt == tries - 1:
                raise SystemExit(f"{err.code} {err.reason}: {err.read().decode()[:600]}") from err
            time.sleep(4 * (attempt + 1))
    raise SystemExit("unreachable")


def generate(name: str, prompt: str, bearer: str, existing: str | None = None) -> None:
    target = OUT / f"{name}.mp4"
    if target.exists():
        print(f"{name}: already present, skipping")
        return

    if existing:
        # Resume a job that finished but whose download failed, rather than
        # paying for the same four seconds twice.
        job_id = existing
        print(f"{name}: resuming {job_id}")
    else:
        job = call(
            f"{HOST}/openai/v1/videos?api-version=preview",
            bearer,
            {"model": MODEL, "prompt": prompt, "seconds": "4", "size": "1280x720"},
        )
        job_id = job["id"]
        print(f"{name}: queued {job_id}")

    for _ in range(120):
        # ⚠️ Defensive: `status` is genuinely absent on some polls mid-job.
        state = call(f"{HOST}/openai/v1/videos/{job_id}?api-version=preview", bearer)
        status = state.get("status")
        # ⚠️ The terminal status is `completed`, NOT `succeeded`. Waiting for
        # `succeeded` polls a finished job forever, which is how the first run
        # of this script burned twelve pointless requests.
        if status in ("completed", "succeeded"):
            break
        if status == "failed":
            raise SystemExit(f"{name}: failed: {json.dumps(state)[:600]}")
        print(f"  {name}: {status or '(no status yet)'}")
        time.sleep(5)
    else:
        raise SystemExit(f"{name}: timed out")

    gen = state.get("generations", [{}])[0].get("id", job_id)
    for attempt in range(5):
        try:
            # ⚠️ The content path is `/content`, NOT `/content/video`.
            # `/content/video` is the older Azure video-generations shape and
            # returns a flat 404 here, which reads exactly like an expired job.
            req = urllib.request.Request(
                f"{HOST}/openai/v1/videos/{gen}/content?api-version=preview"
            )
            req.add_header("Authorization", f"Bearer {bearer}")
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
            break
        except urllib.error.HTTPError as err:
            if err.code < 500 or attempt == 4:
                raise SystemExit(f"{name}: download {err.code}: {err.read().decode()[:400]}")
            time.sleep(5 * (attempt + 1))

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    print(f"{name}: wrote {target} ({target.stat().st_size/1_000_000:.1f} MB)")


def main() -> int:
    if not HOST:
        print(
            "Set AZURE_OPENAI_ENDPOINT to your Sora-capable Azure OpenAI resource,\n"
            "e.g. https://<your-resource>.openai.azure.com",
            file=sys.stderr,
        )
        return 2
    bearer = token()
    # Optional resume: `python treasure-clips.py treasure-found=video_abc...`
    resume = dict(arg.split("=", 1) for arg in sys.argv[1:] if "=" in arg)
    for name, prompt in CLIPS.items():
        generate(name, prompt, bearer, resume.get(name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
