# Can I use Suno songs in a free learning app?

> ✅ **RESOLVED, 23 August 2026.** The project now has a **Suno Pro**
> subscription, and every track was regenerated under it. Pro grants commercial
> rights, so the audio is owned outright and **ships in the deployed build**.
>
> ⚠️ The grant is **not retroactive**. Suno's wording is "commercial use rights
> for new songs made", and the help centre ties ownership to songs made *while
> subscribed*. The free-tier files therefore never became ours, and keeping them
> under a new subscription would have been a licence claim resting on a
> subscription that did not exist when they were generated. They were replaced
> and deleted, not relabelled.
>
> Everything below is the original analysis that led to stripping the audio. It
> is kept because it is still the correct reading for a free-tier account, and
> because it is the reason the replacement was done properly rather than
> cheaply.

---

**Short answer: not in the app you hand to other people. Yes, on your own
machine.**

"Free" is not the test. The Suno free tier grants **personal, non-commercial**
use only, and a study game published to a community, promoted on LinkedIn, and
tied to your professional work fails that test on more than one count even
though nobody pays for it.

This document records what the terms actually say, what follows from them for
this project, and what the options are.

> ⚠️ **This is not legal advice.** It is a careful reading of published terms by
> somebody who is not a lawyer. If you need certainty, ask one. If the app is
> connected to your employer, ask your employer's legal team, because the
> answer may be theirs to give rather than yours.

---

## 1. What the terms actually say

Suno's terms change on **3 September 2026**, and both versions matter: one
governs what you have already made, the other governs everything after.

### Current terms (revised 26 March 2026, in force until 2 September)

> "If you are a user of the free or Basic tier of the Service then, you covenant
> and agree that you will only use Outputs generated from Submissions made by
> you through the Service solely for your **lawful, internal, personal and
> non-commercial** purposes, provided that you **give attribution credit to
> Suno** in each case."

### New terms (revised 10 August 2026, effective 3 September 2026)

> "**Free or Basic Tier Accounts:** If you are a user of the free or basic tier
> of the Service then you covenant and agree that you will only use such Outputs
> for your **lawful, personal and non-commercial** purposes."

Two things loosened: "internal" is gone, and the explicit attribution
requirement is gone. **"Personal and non-commercial" did not move**, and that
is the clause that decides this question.

### Who owns the song

From Suno's own help centre:

> "If you make music with the Basic (free) plan, **Suno is the owner of the
> songs**. You are allowed to use the songs for non-commercial purposes."
>
> "If you make songs while subscribed to the Pro or Premier plan, **you own the
> songs**."

So on the free tier you hold a **permission to use**, not a licence you can pass
on. That distinction is the one that bites hardest below.

### The commercial-use restriction, in full

> "you agree not to display, distribute, license, perform, publish, reproduce,
> duplicate, copy, create derivative works from, modify, sell, resell, **grant
> access to**, transfer, or otherwise use or exploit any portion of the Service,
> and any Output or Voice Model, for any commercial purposes."

---

## 2. Why "my app is free" does not settle it

Three separate problems, and the app being free only speaks to the first.

**Free is not the same as non-commercial.** Non-commercial normally means "not
in connection with business or promotional activity", not "no money changed
hands". Open-source and Creative Commons practice has treated it that way for
twenty years. A free tool that markets a product, a platform, or a person is
routinely treated as commercial use.

**"Personal" is a second, stricter word.** Even reading "non-commercial"
generously, publishing a game for a community to download is not *personal* use
by any ordinary meaning. Under the terms in force today it also has to be
**internal**, which a public release plainly is not.

**You cannot pass on what you do not have.** Suno owns free-tier output. Putting
the mp3 in a public repository, or in a downloadable build, means handing other
people copies and rights you were never granted. The clause above names
"distribute", "grant access to" and "transfer" explicitly.

### The specific risk here

This project is a DP-600 study game, published to the Microsoft Fabric
community, written by somebody who does Fabric for a living and promoted through
their professional channels. Even with no price tag, that is **promotional
activity connected to employment**, which is the textbook example of commercial
use in substance. It is the weakest part of a "purely non-commercial" argument
and it should not be leaned on.

---

## 3. ⚠️ Two traps specific to how this was done

**Downloading from the CDN is a problem from 3 September.** The new terms say:

> "Obtaining a copy of an Output by any means other than a download channel made
> available by Suno is prohibited (for example, recording or stream ripping are
> prohibited)."

and they attach commercial rights **only** to a permitted Download:

> "You may not commercially exploit Output that has not been downloaded by you
> through an approved channel under these Terms of Service."

Pulling tracks straight from `cdn1.suno.ai` is fast and convenient, and after
3 September it is outside the approved channel. From that date, use the
download button, and note that downloads are **metered** (Pro 20/month, Premier
60/month).

**Upgrading does not fix songs you already made.** The Pro plan advertises
"Commercial use rights for **new songs made**". The assignment of ownership in
the terms covers Output "generated from Submissions made by you through the
Service **during the term of your paid-tier subscription**". So subscribing
tomorrow would not licence the tracks generated on the free tier today. They
would have to be **regenerated** under the paid plan.

---

## 4. What this project already does, and why it is right

Nothing needs to be undone. The architecture happens to be correct:

- Every audio file is **gitignored** (`app/public/audio/`, `media/`). `git
  ls-files` confirms no audio is tracked.
- The app **probes for the files at load** and no-ops when they are missing, so
  a clone plays in silence with nothing broken and nothing logged.
- The cinematic cues are **synthesised from oscillators at runtime**, so they
  carry no licence at all and ship freely.
- `NOTICE.md` states the position openly.

The result: what is distributed contains **no Suno content**. The music exists
only on the author's own machine, which is as close to "personal use" as this
gets. The demo video is the one thing to keep an eye on, since it carries the
anthem and is posted publicly.

> ⚠️ The repository currently has **no LICENSE file**, so it is "all rights
> reserved" by default. That accidentally avoids the worst version of this
> problem: an MIT licence over a tree containing free-tier Suno audio would
> purport to grant everyone rights that were never held. If a licence is added
> later, the audio must stay out of the tree.

---

## 5. Options

| | What it costs | What it gets you |
| --- | --- | --- |
| **A. Keep it local** (status quo) | nothing | Music on your machine, silence for everyone else. Defensible as personal use. The published app stays clean |
| **B. Subscribe to Pro** | $8/month | Ownership and commercial rights, ⚠️ **only for tracks regenerated while subscribed**, ⚠️ **only via metered official downloads** |
| **C. Use openly licensed music** | time | CC0 or CC-BY tracks can be committed and shipped. Attribution is a line in NOTICE. No ambiguity at all |
| **D. Synthesise it** | a day | Already proven here: the cinematic cues are oscillators and ship in the repo. A generative ambient bed is achievable and would make the project fully self-contained |

**Recommendation: A now, C or D before the app is promoted widely.**

A costs nothing and is already implemented. If the music is ever to be part of
what people actually receive, B is the honest paid route but carries the
regeneration and download-channel conditions above, while **C and D remove the
question entirely** rather than answering it. For a project whose stated rule is
that it ships no assets, D is also the most consistent answer.

---

## 6. The statement, in one paragraph

⚠️ Superseded by the Pro subscription; kept as the free-tier position. The
current statement is section 7.

> The background music and the anthem in this project were generated with Suno
> on its free tier. Suno retains ownership of free-tier output and permits only
> lawful, personal, non-commercial use of it. Because this project is published
> and is connected to professional activity, that permission is not a sound
> basis for distributing the audio, and the audio is therefore **deliberately
> excluded from the repository and from every build**. The application probes
> for the files at startup and runs silently when they are absent, which is the
> state of every copy other than the author's own. All in-game sound effects are
> synthesised at runtime and carry no third-party rights.

## 7. The current statement, in one paragraph

> The anthem and the background score in this project were generated with Suno
> under a **Pro subscription**, which grants the subscriber commercial rights to
> songs made while subscribed. The words of the anthem are original to this
> project, and no existing recording, melody or artist was named in any style
> prompt, so nothing here is derived from a specific work. The audio is
> therefore distributed with the application. Earlier free-tier versions of the
> same pieces were **deleted rather than reused**, because Suno's grant covers
> songs made while subscribed and is not retroactive. All in-game sound effects
> are synthesised at runtime and carry no third-party rights.

### How the regeneration was done, and one thing that was refused

Every track was made through the Suno web application in a signed-in browser.

⚠️ **No third-party "Suno API" was used.** Suno sells three consumer plans and
publishes no developer API; the services advertising one work by driving a
logged-in session on your behalf, which is the practice section 1 quotes the
terms as prohibiting ("you agree not to ... grant access to ... any portion of
the Service"). Obtaining a title through a route that breaches the terms
conferring it would defeat the purpose of this entire document.

⚠️ **A Cloudflare human verification challenge was not answered by automation.**
One track, *Terra Nostra*, remains ungenerated for exactly this reason. Ticking
a "confirm you are a human" box from a script is a false assertion and defeats a
bot control, and no deadline makes that a reasonable trade. The soundtrack
loader treats the missing file as an absent track, so the gap costs a slot and
nothing else.

---

*Sources, all read on 23 August 2026: [Suno Terms of Service](https://suno.com/terms)
(revised 26 March 2026), [Terms effective 3 September 2026](https://suno.com/terms-september-2026)
(revised 10 August 2026), [Suno pricing](https://suno.com/pricing), and the Suno
help centre article "Do I have the copyrights to songs I made?".*
