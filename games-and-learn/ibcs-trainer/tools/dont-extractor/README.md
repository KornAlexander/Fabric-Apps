# Don't-image extractor

Reusable batch tool that turns the IBCS poster photos in
[`docs/poster/`](../../docs/poster/) into the per-rule **Don't** chart images the
mini-games load from [`public/game/img/dont/`](../../public/game/img/dont/).

Each poster cell shows a rule's **Don't** chart (left, with a black diagonal
strike-through line drawn corner to corner) next to its **Do** chart (right,
clean). This tool, for every entry you list in the manifest:

1. opens the source photo (a **copy** is processed — the photo is never changed),
2. **crops** to one Don't cell,
3. detects the black border-to-border strike-through line and **paints it out**
   (OpenCV inpainting), and
4. saves the result as `public/game/img/dont/<CODE>.png`, where `<CODE>` is the
   rule code with spaces and dots replaced by hyphens (`ST 2.2` → `ST-2-2.png`),
   matching `imageCode()` in [`public/game/ibcs_rules.js`](../../public/game/ibcs_rules.js).

Missing files fall back to the procedural glyph in `ibcs_charts.js`, so you can
fill the bank in incrementally: add more crop boxes and re-run.

## Setup

```bash
cd tools/dont-extractor
python3 -m pip install -r requirements.txt
```

## Run

```bash
# process every cell in the manifest
python3 extract_dont_images.py --manifest crops.json

# process one rule and also dump the detected strike-line mask for tuning
python3 extract_dont_images.py --manifest crops.json --only "ST 2.2" --debug
```

## The manifest (`crops.json`)

```jsonc
{
  "source_dir": "docs/poster",            // relative to repo root
  "output_dir": "public/game/img/dont",   // relative to repo root
  "dark_threshold": 110,                   // pixels darker than this are "ink"
  "line_width": 7,                         // strike-line mask thickness (px)
  "cells": [
    {
      "code": "ST 2.2",                    // IBCS rule code
      "source": "poster-03.jpeg",          // file inside source_dir
      "box": [150, 72, 455, 300],          // crop: [left, top, right, bottom]
      "dark_threshold": 110,               // optional per-cell override
      "line_width": 7                      // optional per-cell override
    }
  ]
}
```

### Finding a crop box

The box is `[left, top, right, bottom]` in pixels of the source photo. Open a
photo in any image viewer, read the pixel coordinates of the Don't cell's corners
and crop **tightly** to the white card — a tight box keeps the adjacent Do cell
and the background out of the result and makes the diagonal easier to detect.

## Quality notes / limitations

- The poster photos are taken at an angle with glare, so cropped cells are low
  resolution and slightly skewed. Inpainting removes the line but can leave faint
  smudges where it crossed text or bars. For best results crop tightly and tune
  `dark_threshold` / `line_width` per cell.
- If you have the original **vector PDF** of the poster, exporting cells from it
  will give far cleaner images than these photos — point `source_dir` at those
  exports and you may not need the line-removal step at all for some cells.
