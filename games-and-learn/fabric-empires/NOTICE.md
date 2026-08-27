# NOTICE

Fabric Empires is a study aid for the Microsoft DP-600 certification, built for
the Microsoft Fabric community Certification Prep Challenge.

## What ships in this repository

Source only. There are no bundled art or audio assets, by design: the terrain
material, the water, the sky, every surface detail and every object on the map
are generated at runtime from the world seed. The rule is recorded as D59 in
PLAN.md and is the reason a clone of this repository is a few megabytes rather
than a few hundred.

The music is kept out of git for the same size reason, but it is no longer kept
out of the **deployed build**. See below.

## The music: owned outright, and it ships

⚠️ **This section changed on 23 August 2026 and the change matters.** Every
track was previously generated on Suno's free plan, where Suno owns the output
and licenses it to you for personal, non-commercial use only. That is not a
licence you can pass on, so the deployed build stripped the audio out entirely.

The tracks have since been **regenerated on a Suno Pro subscription**, which
grants commercial rights:

> Commercial use rights **for new songs made**

⚠️ Read that qualifier the way it is written. The grant attaches to songs made
*while subscribed*; it is not retroactive. The old free-plan files did not
become ours when the subscription started, so they were **replaced and removed**
rather than relabelled. Nothing that predates the subscription survives
anywhere in this project.

### The anthem, "Familia Nostra"

- **Written for this project.** The Latin and German words are original, and so
  is the setting. `fabrica` is Latin for a craftsman's workshop and `texere`
  means *to weave*, which is why the chorus can say "let us weave together" and
  "let us learn together" in the same breath. The lyrics and a translation are
  in `media/familia-nostra.txt`.
- **Generated with [Suno](https://suno.com)** from those lyrics and a style
  prompt describing the genre. No existing recording, melody or artist was
  named in the prompt, and nothing here is derived from a specific song.
- **Owned**, having been generated under a Pro subscription.

⚠️ A fuller reading of Suno's terms, including the ones taking effect on
3 September 2026, is in [MUSIC-LICENSING.md](MUSIC-LICENSING.md).

The game still handles absence gracefully rather than depending on the files.
`app/src/audio.ts` probes for `app/public/audio/anthem.mp3` at load; if the file
is absent, which is the state of every fresh clone, every call is a no-op and
the opening plays in silence. Nothing breaks and nothing is logged as an error.

To hear it in a clone, put your own `anthem.mp3` at that path.

### The background score

The game also has a soundtrack that runs under play: several orchestral tracks,
shuffled, with a button in the resource bar to turn them off. The files are
ignored by git for size, not for licence.

- **Instrumental, deliberately.** Not a stylistic preference: sung words
  interfere with reading comprehension, and this game is read under a clock.
  The anthem sings because the title sequence has nothing to read. The score
  that plays for the next two hours does not. Recorded as D299 in PLAN.md.
- **Generated with [Suno](https://suno.com)** under a Pro subscription, in a
  shared early-baroque palette so the score sounds like one work. The exact
  prompts are in `media/soundtrack-prompts.txt`.
- `app/src/soundtrack.ts` names the tracks it looks for in `app/public/audio/`
  and probes each one at load. Whatever is missing is simply not in the
  playlist, and a clone with none of them has no music and no mute button
  rather than a broken one.

⚠️ **Terra Nostra is currently a named slot with no file.** Its regeneration
was stopped by a Cloudflare human verification challenge, which automation must
not answer on a person's behalf. The gap is harmless by the design above, and
generating the track fills it with no code change.
To hear something, drop your own `.mp3` files at the paths listed in
`SOUNDTRACK` in that file, or edit the list to name your own.

### The cinematic cues are not an exception

The four in-game films have sound, and unlike the music **it ships**. Every cue
is built from oscillators at the moment it plays: a bell with inharmonic
partials, a drum, a brass swell, a drone, and a reverb generated from noise.
There is no file, so there is no licence and nothing to download, and a fresh
clone hears them. See `app/src/cues.ts` and section 40 of PLAN.md.

### The trailer

`media/fabric-empires-intro.mp4` carries the anthem, and therefore the same
ownership: it is a recording of this build set to the Pro-generated
`anthem.mp3`. It is ignored by git for **size**, not for licence.

⚠️ **It used to be the counter-example to the claim above.** This document
said that nothing predating the subscription survives anywhere in the project
while, four sections later, this section said the trailer inherited
non-commercial terms. Both sentences were maintained by hand and only one of
them could be true. The trailer was in fact a 31-second file with a baked-in
copy of the free-plan take, and it played perfectly, which is why nobody
looked at it.

It is no longer made by hand. `npm run record:intro` drives the real game,
captures the title sequence, and muxes the audio in from the same
`app/public/audio/anthem.mp3` the game serves to players. Playwright records
no audio track at all, so there is no route by which a differently-licensed
recording can reach the file: the soundtrack can only arrive by being taken
from the shipped, owned one. See `tools/media/record-intro.mjs`.

Everything in the trailer other than the music is the game rendering itself
live: no shot was staged, composited or drawn by hand.

### The buried-cache films

Two four-second clips play when a Profiler digs up a cache: one as it is found,
one as it opens. Unlike everything else on the screen, **these are not the game
rendering itself** and they are not drawn by hand either.

- **Generated with Azure OpenAI (Sora 2).** Prompts and the runner are in
  `tools/treasure-clips.py`, which is committed; the clips are not.
- **Owned.** Azure OpenAI output belongs to the customer, so the licence
  problem that keeps the teaser out of git does not apply here. They are
  ignored for **size** instead, which is D59's rule and the same footing as the
  score. Masters sit in `media/treasure-scenes/`.
- **Silent.** Sora returns an ambient music bed with every clip. The track is
  stripped before the file is published, because the game's own score is
  playing underneath.
- ⚠️ **Nothing in either clip is real.** No real place, no real object, no
  archive footage. They are photoreal by prompt, which is exactly why this
  paragraph exists: a viewer cannot tell from the pixels.
- A clone without them plays both beats as no-ops. The cache is still found and
  still paid out.

## Generated questions

The capacity edition can ask a model to draft questions for a topic nobody
shipped, and save them on the host that is running the game.

- **Nothing generated is in this repository.** Saved banks live in
  `tools/coach/banks/`, which is ignored by git. The DP-600 bank that does ship
  was written by hand and is checked by tests; a drafted one is not, and the
  two must not become hard to tell apart.
- **Drafts are reviewed before they count.** Generated rows go through exactly
  the same preview as an uploaded spreadsheet, and nothing enters a course
  until somebody presses the button.
- ⚠️ **A generated question can be confidently wrong.** This is a certification
  study aid, and a wrong answer that looks authoritative is worse than no
  question at all, because it is revised and carried into the exam. Every file
  written records `"source": "generated"` and the model that wrote it, so that
  is still knowable a month later. Check the answers.

## Third-party software
Dependencies and their licences are declared in `package.json` and the lockfile.
The notable one is [three.js](https://threejs.org) (MIT), which does all of the
rendering.

## The exam

"DP-600" and "Microsoft Fabric" are Microsoft names. This project is an
independent, unofficial study aid. It is not affiliated with, endorsed by, or
sponsored by Microsoft, and the questions are written from the public exam
skills outline rather than taken from any exam.
