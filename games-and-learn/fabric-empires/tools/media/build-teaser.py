"""Assembles the pre-setup teaser: four Sora clips, Fabrica underneath, English captions.

    python tools/media/build-teaser.py

⚠️ **The Sora clips are SOURCE MATERIAL, not build output.** The same prompt
returns a different film next time, so `media/teaser-scenes/*.mp4` must never be
deleted as regenerable. This script is the only regenerable half.

⚠️ **Every Sora clip carries its own music bed**, and they are louder than you
expect. All four are muted here and `media/fabrica.mp3` is laid under the whole
film instead, because four beds spliced together change key at every cut.

⚠️ **Captions and their timings exist once, in `CAPTIONS` below.** The SRT is
generated from that list. Writing an .srt by hand next to a script that already
knows the cut points is how a caption ends up naming a shot that has already
gone, which is the exact fault the in-game opening shipped with once.

⚠️ **ffmpeg must be a build with libass.** The captions are burned in by the
`subtitles` filter, and a minimal build simply does not have it. The binary is
taken from `$FFMPEG` if set, otherwise from `PATH`, and the configuration is
checked before a single frame is encoded, because the alternative is finding
out after a slow x264 pass that the film has no text on it.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCENES = REPO / 'media' / 'teaser-scenes'
MUSIC = REPO / 'media' / 'fabrica.mp3'
OUT = REPO / 'media' / 'fabric-empires-teaser.mp4'
APP_COPY = REPO / 'app' / 'public' / 'teaser.mp4'

# ⚠️ **The font ships with the SCRIPT, not with the media.** `/media/` is
# ignored, so a font kept beside the clips would vanish on a fresh clone and
# the film would quietly re-render in whatever serif fontconfig picked instead.
# Cinzel is SIL Open Font Licence; the licence travels next to it, and NOTICE
# names it.
FONTS = Path(__file__).resolve().parent / 'fonts'

CLIP = 12.0         # seconds per Sora clip. 12 is sora-2's maximum.
XFADE = 0.6         # cross-fade between every pair
W, H = 1280, 720    # ⚠️ sora-2 caps at 1280x720, so this IS an upscale and adds
                    # no detail. It is here because the app canvas is 1600x900;
                    # the sharpness comes from CRF, not from the pixel count.
CRF = 18            # was 21, which was visibly soft on stone and rigging

COUNT = 6
FILM = CLIP * COUNT - XFADE * (COUNT - 1)          # 69.0 s

# Scene N occupies [start, start + CLIP]; a caption must sit INSIDE its own scene.
SCENE_START = [i * (CLIP - XFADE) for i in range(COUNT)]   # 0, 11.4, 22.8, 34.2, 45.6, 57.0

# ⚠️ **A caption on every scene, which reverses an earlier decision.** This
# used to be four captions across six scenes, on the argument that a 69 s film
# needs room to breathe and that text on every shot reads as a slideshow. That
# was a defensible call about RHYTHM, and it was answering the wrong question:
# the two silent scenes were 24 seconds in which a viewer who did not already
# know what this was got told nothing. A teaser for a game nobody has heard of
# has to say what the game is before it can afford to be atmospheric.
#
# The breathing is preserved in the gaps instead: no caption starts before its
# scene has been on screen for about 1.5 s, and each one leaves well before the
# cut. A caption must still sit INSIDE its own scene.
CAPTIONS: list[tuple[float, float, str]] = [
    # scene 1, the walled city
    (2.0, 9.0, 'Every empire is built on something somebody learned.'),
    # scene 2, the harbour. Names the product, which nothing here used to do.
    (13.5, 21.5, 'This one is built on Microsoft Fabric.'),
    # scene 3, the map room. The DP-600 outline, stated as a map legend.
    (24.5, 32.0, 'Forty-one skills. Three domains. One exam.'),
    # scene 4, the scriptorium. The mechanic, on the one scene that is
    # literally a room where people learn by writing.
    (36.0, 44.0, 'Every battle asks you a real question.'),
    # scene 5, the tower
    (47.0, 54.5, 'Answer well, and the map is yours.'),
    # scene 6, the banners. \N is a hard break. The title gets an inline size
    # because it is the payoff of the film and must not read as one more
    # caption; the tagline is deliberately subordinate to it.
    (59.5, 67.5,
     r'{\fs58\fsp10}FABRIC EMPIRES{\fs22\fsp1}\NLearn Fabric. Learn as a family.'),
]

# ⚠️ **The label is a STYLE, not an inline override.**
#
# The first attempt put `{\an8\fs11}` in front of the cue text in an .srt.
# Both tags were silently dropped: ffmpeg's SRT decoder does not carry ASS
# override tags through, so the disclosure rendered at full caption size and
# at the BOTTOM, stacked directly above FABRIC EMPIRES. It looked deliberate,
# which is why it needed a frame check rather than a glance at the log.
#
# An .ass file has a per-line Style column, so alignment and size are
# properties of the style and cannot be dropped.
DISCLOSURE = (FILM - 4.0, FILM - 0.3,
              'Scenes AI-generated (Azure OpenAI, Sora 2)')


# The caption gold, as ASS wants it: alpha, then blue, green, red.
# #E8C15C -> R=E8 G=C1 B=5C -> &H00 5C C1 E8
GOLD = '&H005CC1E8'


def stamp(t: float) -> str:
    """ASS timestamp: h:mm:ss.cc, one hour digit, centiseconds."""
    h, rem = divmod(max(t, 0.0), 3600)
    m, s = divmod(rem, 60)
    return f'{int(h)}:{int(m):02d}:{s:05.2f}'


def write_ass(path: Path) -> None:
    """Write the caption file.

    ⚠️ **ASS colours are &HAABBGGRR, which is alpha first and then BGR.**
    Written as if it were the RGB everything else in this repo uses, the gold
    #E8C15C comes out as #5CC1E8, a pale blue, and it looks deliberate enough
    that a glance at the log will not catch it. It is spelled out below so the
    next person changing the colour does not have to rediscover the order.

    ⚠️ **Alpha is inverted too:** 00 is opaque and FF is invisible. The
    outline is fully opaque black and heavier than the white captions used,
    which is not a matter of taste. ⚠️ **Every one of the six Sora scenes is
    lit at golden hour**, so gold text sits on gold and the two nearly merge:
    measured on the first render, the caption band of the map-room scene
    contained 96,763 pixels that a gold detector called gold, and the film had
    only just started drawing gold letters. White separated from that footage
    for free. Gold has to be given an edge to stand on.
    """
    # PlayRes must match the encode, or every font size is in the wrong units.
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Cinzel,34,{GOLD},&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,1,0,1,3.2,1.6,2,60,60,54,1
Style: Label,Georgia,13,&H60FFFFFF,&H000000FF,&H50000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,9,30,30,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for start, end, text in CAPTIONS:
        lines.append(f'Dialogue: 0,{stamp(start)},{stamp(end)},Caption,,0,0,0,,{text}')
    start, end, text = DISCLOSURE
    lines.append(f'Dialogue: 0,{stamp(start)},{stamp(end)},Label,,0,0,0,,{text}')
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def find_ffmpeg() -> str:
    """An ffmpeg that can actually burn captions in.

    ⚠️ **Checked for libass BEFORE encoding, not after.** Without it the
    `subtitles` filter does not exist, and the failure arrives at the end of a
    slow x264 pass rather than at the start. Minimal builds are common: the
    one bundled with `imageio-ffmpeg` in this repo's virtualenv is one.
    """
    exe = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if not exe:
        sys.exit('ffmpeg not found. Put it on PATH or set $FFMPEG.')
    banner = subprocess.run([exe, '-hide_banner', '-version'],
                            capture_output=True, text=True).stdout
    if 'enable-libass' not in banner:
        sys.exit(f'{exe} has no libass, so captions cannot be burned in. '
                 'Set $FFMPEG to a full build.')
    return exe


def main() -> None:
    ffmpeg = find_ffmpeg()
    clips = [SCENES / f'scene-{n}.mp4' for n in range(1, COUNT + 1)]
    font = FONTS / 'Cinzel.ttf'
    missing = [p.name for p in (*clips, MUSIC, font) if not p.exists()]
    if missing:
        sys.exit(f'missing inputs: {", ".join(missing)}')

    subs = SCENES / 'captions.ass'
    write_ass(subs)

    # ⚠️ **The font is COPIED next to the captions rather than pointed at.**
    # `fontsdir` is a filter option, so an absolute Windows path puts a drive
    # letter colon inside the filter syntax and breaks the parse, which is the
    # same trap the caption path already works around. ffmpeg runs with its cwd
    # set to the scenes directory, so both can be plain relative names.
    shutil.copy2(font, SCENES / font.name)

    # libass needs a path it can parse; a Windows drive letter colon breaks the
    # filter syntax. Running from the file's own directory sidesteps it.
    parts = []
    for i in range(COUNT):
        parts.append(f'[{i}:v]scale={W}:{H}:flags=lanczos,setsar=1,fps=30[v{i}]')

    # Chain the cross-fades. Each offset is the point in the ACCUMULATED film
    # where the next clip starts, which is exactly SCENE_START[i].
    prev = 'v0'
    for i in range(1, COUNT):
        tag = f'x{i}'
        parts.append(
            f'[{prev}][v{i}]xfade=transition=fade:duration={XFADE}:'
            f'offset={SCENE_START[i]:.3f}[{tag}]'
        )
        prev = tag

    parts.append(
        f'[{prev}]subtitles=captions.ass:fontsdir=.,'
        f'fade=t=in:st=0:d=0.8,fade=t=out:st={FILM - 1.5:.2f}:d=1.5[vout]'
    )
    parts.append(
        f'[{COUNT}:a]atrim=0:{FILM:.3f},asetpts=PTS-STARTPTS,'
        f'afade=t=in:st=0:d=1.0,afade=t=out:st={FILM - 3.0:.2f}:d=3.0[aout]'
    )

    cmd = [ffmpeg, '-y', '-v', 'error']
    for c in clips:
        cmd += ['-i', str(c)]
    cmd += ['-i', str(MUSIC)]
    cmd += [
        '-filter_complex', ';'.join(parts),
        '-map', '[vout]', '-map', '[aout]',
        '-t', f'{FILM:.3f}',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', str(CRF), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        str(OUT),
    ]

    print(f'building {FILM:.1f}s at {W}x{H} ...')
    subprocess.run(cmd, cwd=SCENES, check=True)

    APP_COPY.parent.mkdir(parents=True, exist_ok=True)
    APP_COPY.write_bytes(OUT.read_bytes())

    for p in (OUT, APP_COPY):
        size = p.stat().st_size / 1024 / 1024
        print(f'{p.relative_to(REPO)}  {size:.2f} MB')


if __name__ == '__main__':
    main()
