"""
`join-intro.py` must survive a demo that has no soundtrack.

⚠️ THE REGRESSION THIS EXISTS FOR IS A CRASH ON A PERFECTLY REASONABLE INPUT. The first version of
the joiner assumed every demo carries audio and hard-coded `[1:a]` into its filtergraph. Run against
`campus-scheduler-lmu-guide.mp4` — a silent 72-second guide already sitting in `media/` — ffmpeg
answered `Stream specifier ':a' ... matches no streams` and Python printed a traceback over a wall
of filter syntax. Nothing about that output tells a reader their file is simply silent.

Fixtures are generated here with ffmpeg's `lavfi` sources rather than committed, so this test needs
no binary assets and runs in about a second.
"""
from __future__ import annotations

# ⚠️ UTF-8 REGARDLESS OF WHERE THE OUTPUT GOES. Python uses the console encoding for a terminal but
# the LOCALE encoding for a redirected stream (cp1252 on this machine), so printing a German name or
# a warning sign raised UnicodeEncodeError as soon as anything captured stdout — a runner, CI, or a
# pipe. The suite reported 54/54 for a while purely because the shell that ran it happened to carry
# PYTHONIOENCODING; without it, 23 of 54 files failed on output rather than on anything they test.
# Imported here rather than relied upon from below: this runs before the rest of the imports.
import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(_sys.stderr, "reconfigure"):
    _sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JOINER = ROOT / "tools" / "demo" / "join-intro.py"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{'' if ok else f'  -- {detail}'}")
    if not ok:
        FAILURES.append(name)


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def loudness(path: Path, start: float, length: float) -> float:
    """Mean volume of a window, in dB. -91 is digital silence."""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(start), "-t", str(length), "-i", str(path),
         "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    for line in out.stderr.splitlines():
        if "mean_volume:" in line:
            return float(line.split("mean_volume:")[1].strip().split()[0])
    return 0.0


def main() -> int:
    if not JOINER.exists():
        print(f"missing {JOINER}")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        intro = work / "intro.mp4"
        silent = work / "silent-demo.mp4"
        noisy = work / "noisy-demo.mp4"

        # A 3 s "intro" with a tone, and two 2 s "demos" — one silent, one with audio.
        ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=3",
               "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(intro))
        ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(silent))
        ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2",
               "-f", "lavfi", "-i", "sine=frequency=220:duration=2",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(noisy))

        check("the fixture demo really has no audio stream",
              subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                              "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(silent)],
                             capture_output=True, text=True).stdout.strip() == "",
              "fixture is not silent, so the test proves nothing")

        # ── the case that used to crash ──────────────────────────────────────────
        out_silent = work / "joined-silent.mp4"
        run = subprocess.run(
            [sys.executable, str(JOINER), "--intro", str(intro), "--demo", str(silent),
             "--out", str(out_silent)],
            capture_output=True, text=True,
        )
        check("a silent demo joins without failing", run.returncode == 0,
              (run.stderr or run.stdout).strip()[:200])

        if run.returncode == 0:
            check("the joined length is intro + demo",
                  abs(duration(out_silent) - 5.0) < 0.15,
                  f"got {duration(out_silent):.2f}s, expected ~5.0s")
            # ⚠️ The point of the silent branch: the opener must land at zero, not stop dead.
            after_cut = loudness(out_silent, 3.2, 1.5)
            check("the demo half is true silence", after_cut < -80.0,
                  f"mean {after_cut:.1f} dB after the cut; expected digital silence")

        # ── and the narrated case still works ────────────────────────────────────
        out_noisy = work / "joined-noisy.mp4"
        run2 = subprocess.run(
            [sys.executable, str(JOINER), "--intro", str(intro), "--demo", str(noisy),
             "--out", str(out_noisy)],
            capture_output=True, text=True,
        )
        check("a demo WITH audio still joins", run2.returncode == 0,
              (run2.stderr or run2.stdout).strip()[:200])
        if run2.returncode == 0:
            after = loudness(out_noisy, 3.2, 1.5)
            check("the demo half keeps its own audio", after > -80.0,
                  f"mean {after:.1f} dB after the cut; the demo audio was lost")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        return 1
    print("join-intro: all checks pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
