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
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCENES = REPO / 'media' / 'teaser-scenes'
MUSIC = REPO / 'media' / 'fabrica.mp3'
OUT = REPO / 'media' / 'fabric-empires-teaser.mp4'
APP_COPY = REPO / 'app' / 'public' / 'teaser.mp4'

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

# ⚠️ Four captions across six scenes, deliberately. Scenes 2 and 4 carry no
# text at all: at 69 s the film needs room to breathe, and a caption on every
# shot reads as a slideshow rather than a teaser.
CAPTIONS: list[tuple[float, float, str]] = [
    (2.0, 9.0, 'Every empire is built on something somebody learned.'),
    (24.5, 32.0, 'Forty-one skills. Three domains. One exam.'),
    (47.0, 54.5, 'What if the outline were the tech tree?'),
    (59.5, 67.5, 'FABRIC EMPIRES'),
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


def stamp(t: float) -> str:
    """ASS timestamp: h:mm:ss.cc, one hour digit, centiseconds."""
    h, rem = divmod(max(t, 0.0), 3600)
    m, s = divmod(rem, 60)
    return f'{int(h)}:{int(m):02d}:{s:05.2f}'


def write_ass(path: Path) -> None:
    # PlayRes must match the encode, or every font size is in the wrong units.
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Georgia,32,&H00FFFFFF,&H000000FF,&H90000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,2,60,60,54,1
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


def main() -> None:
    clips = [SCENES / f'scene-{n}.mp4' for n in range(1, COUNT + 1)]
    missing = [p.name for p in (*clips, MUSIC) if not p.exists()]
    if missing:
        sys.exit(f'missing inputs: {", ".join(missing)}')

    subs = SCENES / 'captions.ass'
    write_ass(subs)

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
        f'[{prev}]subtitles=captions.ass,'
        f'fade=t=in:st=0:d=0.8,fade=t=out:st={FILM - 1.5:.2f}:d=1.5[vout]'
    )
    parts.append(
        f'[{COUNT}:a]atrim=0:{FILM:.3f},asetpts=PTS-STARTPTS,'
        f'afade=t=in:st=0:d=1.0,afade=t=out:st={FILM - 3.0:.2f}:d=3.0[aout]'
    )

    cmd = ['ffmpeg', '-y', '-v', 'error']
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
