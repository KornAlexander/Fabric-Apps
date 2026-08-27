"""Match the flight campaigns to each other, without repainting the survey.

The AOI is covered by two flights that meet at a tile column, and they disagree by 20 % in
brightness - which reads as two datasets on a map whose whole surface is the photograph.

What this does NOT do is alter drape.jpg. The pixels stay exactly as the survey delivered them,
for three reasons: the roof colours were measured from that file and would silently stop matching
it; a baked correction cannot be undone or inspected; and "we adjusted official imagery" is a
claim that should be visible in a sidecar rather than hidden in a JPEG. Instead this measures the
step and records a per-campaign EXPONENT, which the shader composes with the AOI-wide one it
already applies (pow(pow(x, a), b) == pow(x, a*b), so it costs nothing extra to evaluate).

Two rules make this an exposure correction rather than a colour decision:

  * **Gamma, not gain, and not per channel.** The same rule the AOI-wide correction already
    follows: it moves the mean and leaves 1.0 at 1.0, so nothing burns out and no hue is invented.
    The measured residual warmth difference between the flights is left alone and disclosed.
  * **The reference campaign is untouched, at exactly 1.0**, and it is chosen by measurement -
    the flight that resolves the most detail per pixel, not the biggest or the brightest.

Usage
  python tools/geodata/match_drape_campaigns.py --aoi ahrtal-2021
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

#: Above this in all three channels a pixel is mosaic padding, not ground. Same threshold the
#: shader and measure_drape_exposure.py use, so all three agree about what counts as data.
NODATA = 0.93

#: Where the drape's ground should sit after correction. Same target as measure_drape_exposure.
TARGET_LUMA = 0.46
MIN_GAMMA, MAX_GAMMA = 0.60, 1.00


def ground_stats(img: Image.Image, box: tuple[int, int, int, int]) -> tuple[float, float, int]:
    """Mean luma and mean detail gradient over the ground pixels of a box."""
    crop = img.crop(box).convert("RGB")
    w, h = crop.size
    px = crop.load()
    lum = 0.0
    grad = 0.0
    n = 0
    for y in range(0, h, 3):
        prev: tuple[int, int, int] | None = None
        for x in range(w):
            r, g, b = px[x, y]
            if min(r, g, b) / 255 > NODATA:
                prev = None
                continue
            lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            if prev is not None:
                grad += abs((r + g + b) - (prev[0] + prev[1] + prev[2])) / 3
            prev = (r, g, b)
            n += 1
    if not n:
        return 0.0, 0.0, 0
    return lum / n, grad / n, n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="ahrtal-2021")
    ap.add_argument(
        "--band-m",
        type=float,
        default=1500.0,
        help="width of the comparison band either side of a boundary, in metres",
    )
    args = ap.parse_args()

    root = Path("public/terrain") / args.aoi
    meta_path = root / "drape.json"
    if not meta_path.exists():
        raise SystemExit(f"no drape for {args.aoi} - run fetch_drape.py first")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    flights = meta.get("acquisitions") or []
    if len(flights) < 2:
        print(f"{args.aoi}: {len(flights)} campaign(s) - nothing to match")
        (root / "drape_campaigns.json").unlink(missing_ok=True)
        return

    img = Image.open(root / meta["file"])
    W, H = img.size
    origin_e = meta["origin"]["easting"]
    width_m = meta["extentM"]["width"]

    def to_u(easting: float) -> float:
        return (easting - origin_e) / width_m

    # Each campaign as a span in the uv the shader samples the drape by. The metadata is per 2 km
    # tile, so a span runs from the left edge of its first tile to the right edge of its last.
    spans: list[dict] = []
    for f in flights:
        lo, hi = f["eastingRange"]
        spans.append(
            {
                "acquired": f["acquired"],
                "u0": max(0.0, to_u(lo - 1000)),
                "u1": min(1.0, to_u(hi + 1000)),
            }
        )
    spans.sort(key=lambda s: s["u0"])

    band_px = max(8, round(args.band_m / width_m * W))
    print(f"{args.aoi}: {W}x{H} drape, {len(spans)} campaigns, band {args.band_m:.0f} m\n")

    # Measure each campaign on the SAME kind of ground: a band adjacent to its boundary with the
    # next campaign. Comparing whole strips would compare the Eifel plateau with the Rhine plain.
    for i, span in enumerate(spans):
        centre_u = span["u1"] if i + 1 < len(spans) else span["u0"]
        x = round(centre_u * W)
        box = (max(0, x - band_px), 0, x, H) if i + 1 < len(spans) else (x, 0, min(W, x + band_px), H)
        lum, grad, n = ground_stats(img, box)
        span.update(meanLuma=round(lum, 4), detailGradient=round(grad, 3), samples=n)
        print(
            f"  {span['acquired']}  u {span['u0']:.3f}-{span['u1']:.3f}  "
            f"luma {lum:.3f}  detail {grad:6.3f} levels/px  ({n} px)"
        )

    # The reference is the flight that resolves the most detail - a property of the imagery, not of
    # how much of the map it happens to cover.
    reference = max(spans, key=lambda s: s["detailGradient"])
    print(f"\n  reference (most detail resolved): {reference['acquired']}")

    for span in spans:
        if span is reference or span["meanLuma"] <= 0 or reference["meanLuma"] <= 0:
            span["gamma"] = 1.0
            continue
        # gamma such that mean ** gamma == reference mean, i.e. the two render alike.
        span["gamma"] = round(math.log(reference["meanLuma"]) / math.log(span["meanLuma"]), 4)

    for span in spans:
        matched = span["meanLuma"] ** span["gamma"]
        flag = "  <- untouched" if span["gamma"] == 1.0 else ""
        print(
            f"  {span['acquired']}  gamma {span['gamma']:.4f}  "
            f"{span['meanLuma']:.3f} -> {matched:.3f}{flag}"
        )

    # The AOI-wide exposure was measured on the UNMATCHED image, so re-derive it on the matched
    # one: brightening 77 % of the map and then applying the old correction would overshoot.
    weighted = 0.0
    total = 0.0
    for span in spans:
        share = max(0.0, span["u1"] - span["u0"])
        weighted += (span["meanLuma"] ** span["gamma"]) * share
        total += share
    matched_mean = weighted / total if total else 0.0
    render_gamma = meta.get("renderGamma", 1.0)
    if matched_mean > 0:
        want = math.log(TARGET_LUMA) / math.log(matched_mean)
        render_gamma = round(min(max(want, MIN_GAMMA), MAX_GAMMA), 4)
    print(
        f"\n  matched mean {matched_mean:.3f} -> renderGamma "
        f"{meta.get('renderGamma')} -> {render_gamma}"
    )

    (root / "drape_campaigns.json").write_text(
        json.dumps(
            {
                "note": (
                    "Belichtungsangleichung zwischen Bildfluegen. Gamma, nicht Verstaerkung, nicht "
                    "je Kanal: der Referenzflug bleibt exakt unveraendert, der Farbton wird nicht "
                    "angefasst. Das Bild selbst ist unveraendert; die Korrektur liegt hier."
                ),
                "reference": reference["acquired"],
                "referenceChosenBy": "hoechster gemessener Detailgradient je Bildpunkt",
                "bandM": args.band_m,
                "campaigns": [
                    {
                        "acquired": s["acquired"],
                        "u0": round(s["u0"], 6),
                        "u1": round(s["u1"], 6),
                        "gamma": s["gamma"],
                        "meanLuma": s["meanLuma"],
                        "detailGradient": s["detailGradient"],
                    }
                    for s in spans
                ],
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    meta["renderGamma"] = render_gamma
    meta["renderGammaNote"] = (
        f"Belichtungskorrektur, gemessen am angeglichenen Bild: mittlere Helligkeit "
        f"{matched_mean:.3f} -> Ziel {TARGET_LUMA:.2f}. Gamma, damit helle Flaechen nicht "
        f"ausbrennen. Nur Aufhellung."
    )
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nwrote {root / 'drape_campaigns.json'} and updated drape.json (imagery untouched)")


if __name__ == "__main__":
    main()
