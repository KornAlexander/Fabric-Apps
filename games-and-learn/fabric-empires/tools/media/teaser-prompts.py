"""Writes the four Sora scene prompts for the pre-setup teaser.

⚠️ **The shared blocks live here exactly once.**

The Campus Twin prompts repeat their grade paragraph verbatim in all four
files, which is what makes the four cuts match. Repeating it by hand in four
files is also how three of them end up agreeing and one does not, and the odd
one out is only visible once the film is assembled and graded. So the constant
parts are constants, and only the subject and the camera move vary per scene.

Period is early baroque, roughly 1600-1650, chosen to match the soundtrack:
viola da gamba, recorder, sackbut. The footage is deliberately photoreal and
does not depict the game, which is a stylised hex map. That is a decision, not
an oversight (see PLAN): the teaser sets a mood before the setup screen, and
the film carries an AI-generated label in its final seconds.

    python tools/media/teaser-prompts.py
"""
from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'media' / 'teaser-scenes'

# Verbatim in every scene, so the four cuts grade as one film.
GRADE = (
    'Low golden light rakes across the scene and throws long shadows. Haze softens '
    'the distance. Cinematic colour grade with warm highlights and cool teal shadows, '
    'gentle bloom where the light catches stone and glass, anamorphic 35mm character, '
    'a restrained lens flare, shallow depth of field falling off at the frame edges, '
    'fine natural film grain.'
)

MOTION = 'Smooth stabilised motion throughout, a single unbroken shot, no cuts.'

# ⚠️ The last sentence matters more than it looks. Sora will happily put a
# parked car or a streetlight in a seventeenth-century square, and one modern
# object ruins the period for the whole film.
NEGATIVES = (
    'No text, no captions, no titles, no logos, no watermarks, no user-interface '
    'elements. No recognisable faces: people appear only small, distant, or seen '
    'from behind. Nothing modern: no cars, no tarmac, no road markings, no power '
    'lines, no electric light, no contemporary clothing.'
)

"""
Order is the film's arc, and it is chosen, not incidental: the light runs
dawn -> interiors -> golden hour -> sunset, so the day passes across the
teaser. The banners shot is last because that wide sunset is where the title
card lands.
"""
SCENES: list[tuple[str, str]] = [
    (
        'walled-city',
        'Photoreal cinematic aerial drone shot over a northern European walled city at '
        'dawn in early autumn, around the year 1620. The camera begins high and wide and '
        'glides slowly forward while descending, revealing steep tiled roofs, stone '
        'church spires, a river with a stone bridge, and the city wall with its towers. '
        'Woodsmoke rises from chimneys. A few small figures cross the market square far '
        'below.',
    ),
    (
        'harbour',
        'Photoreal cinematic aerial drone shot over a northern European harbour at dawn in '
        'early autumn, around the year 1620. The camera glides low and forward between the '
        'masts and rigging of moored wooden merchant ships, past stacked barrels, coils of '
        'rope and a stone quay, towards the harbour mouth where the sun is coming up '
        'through mist. Gulls turn over the water.',
    ),
    (
        'map-room',
        'Photoreal cinematic interior shot of a seventeenth-century cartographer\'s room '
        'lit by a tall leaded window and a single candle. The camera pushes slowly across '
        'a heavy oak table strewn with an unfinished map, brass dividers, a terrestrial '
        'globe, quills and rolled charts, coming to rest on the map itself. Dust turns in '
        'the shaft of window light.',
    ),
    (
        'scriptorium',
        'Photoreal cinematic interior shot of a seventeenth-century library, tall shelves of '
        'leather folios receding into shadow, lit by high windows. The camera drifts slowly '
        'down the aisle through broad shafts of dusty light, past a reading desk where open '
        'books lie chained, and settles looking up into the light. Dust turns slowly in the '
        'beams.',
    ),
    (
        'tower',
        'Photoreal cinematic shot of stonemasons raising a cathedral tower in the early '
        'seventeenth century, at golden hour. The camera rises slowly along timber '
        'scaffolding lashed to fresh pale stone, past a treadwheel crane and blocks '
        'swinging on ropes, to look out over the rooftops of the town below. Small '
        'figures work on the platforms, seen from behind.',
    ),
    (
        'banners',
        'Photoreal cinematic aerial drone shot over an autumn landscape at sunset, around '
        'the year 1620, with a walled city on the horizon. The camera makes a slow wide '
        'push forward over ploughed fields, hedgerows and a cart road, past a line of '
        'banners on poles standing along the ridge, their cloth moving in the wind. '
        'Several roads converge towards the distant city gate.',
    ),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for index, (slug, subject) in enumerate(SCENES, start=1):
        text = '\n\n'.join([subject, GRADE, MOTION, NEGATIVES]) + '\n'
        path = OUT / f'scene-{index}-{slug}.txt'
        path.write_text(text, encoding='utf-8')
        print(f'{path.relative_to(REPO)}  {len(text)} chars')


if __name__ == '__main__':
    main()
