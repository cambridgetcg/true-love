# 06 · Shibby Deep Scripts — Pattern Catalog and Integration

**Strand:** intimate-register/06
**Date:** 2026-05-05
**Substrate:** Wall-2 research mission. Shibby = KinkyShibby / shibbysays / Shibby Says / "Shibby's Erotic Hypnosis & Femdom Audios."
**Mandate:** dig past the 5-phase macro arc (already documented in vector-β / strand-04) into the *micro-patterns* of language. Substrate-honest about source reachability. Cite everything.

---

## 1. Methodological honesty — what was reachable, what was not

The single most important fact for this research is that **Shibby's actual session audio is paywalled** (Patreon tiers, Shibbydex tiers Hypnosub / Hypnoslave / Devoted Pet) and **she does not publish full transcripts**. There is no public corpus of her spoken text. What *is* reachable, in descending order of fidelity:

1. **Shibbydex public catalog metadata** — `https://shibbydex.com` exposes a public catalog with **file titles, the first 1–3 sentences of each file's description (which are very often the actual opening lines spoken on the recording, or close paraphrases), tag lists, series blurbs, and a fully populated "triggers" reference page** that documents every named trigger with a one-line description quoting the actual installed suggestion. This was the highest-yield source.
2. **Patreon meta-content** — her *About* page, voting lists, and a few public posts (some 403 to fetch tools but appear in search snippets). The About page contains direct first-person quotes about her process.
3. **Genre-canon literature** — the Milton Model, fractionation literature, modern JOI craft writing (Playful Magazine, social-rise.com, eatsthewholeass on write.as). This gives the *grammar* her style sits inside.
4. **Peer creator quotes** — Tessa Fields (Hypnotessa) parody fiction; HypnoDomCoach on X — useful for triangulating *which lines are Shibby-specific vs which are genre-canonical*.
5. **What is NOT reachable:** Reddit r/ShibbySays text-post bodies (the subreddit search returned no excerpts via Google; r/gonewildaudio cross-posts not surfaced); web.archive.org (Claude tool blocked); soundgasm.net listings for her username (returned navigation chrome only — soundgasm requires a specific user URL slug that is unstable, and the Patreon download script in `kraowx`'s gist confirms she primarily distributes via Patreon-direct, not soundgasm); Lusty Lounge podcast transcripts (#39 and #53 — audio-only, no transcript indexed); YouTube guided-meditation video captions (consent gate redirect blocks fetch); the Patreon "Sometimes I just feel like writing" script-in-progress post (paywalled).

**Bias warning.** The descriptions on Shibbydex are written *by Shibby* about her own files. They function partly as marketing copy. Because they are written in her voice and frequently quote or paraphrase the file's actual opening, they are a **strong proxy** for her micro-style — but **not a 1:1 transcript**. I will mark which excerpts are "opening line as recorded" (first-person, second-person address, no narrative framing) vs "blurb-about-file" (third-person framing, "this file is a…").

**What follows is an audit-able evidence trail. Every excerpt has its URL.**

---

## 2. Direct Shibby material found

### 2.1 First-person quotes from the creator (about her process)

Source: [Shibby Says Patreon About page](https://www.patreon.com/Shibbysays) — fetched 2026-05-05.

> "I love writing intense scripts, recording alluring audios, and editing in layers, binaurals and all sorts of effects."
>
> "I write, record and edit most of my files- I also manage the whole thing by myself."
>
> "All of my files are Fully labeled, both triggers and what I want you to feel/do."
>
> "I do not make any Financial Domination recordings."

Source: [Shibbydex about](https://shibbydex.com/about) — self-description:

> "[I am] one of the premier dirty talkers within the industry."

Operational reading: she frames herself as a **writer first, voice second, dirty-talker as core competency**. The "fully labeled triggers / what I want you to feel/do" line is structurally important — she pre-discloses the suggestion targets, which is the **consent surface** Yu's architecture should mirror.

### 2.2 Verbatim opening lines from her catalog

These are the first sentences of the file descriptions on Shibbydex. Many are written in second-person address with no narrative framing, which is consistent with being either *the actual opening line of the audio* or a tightly paraphrased opening hook. URLs in the bibliography point to the catalog page they were extracted from (the per-file deep-links 404'd from the tool, but the catalog page exposes them).

Source: [Shibbydex free files catalog](https://shibbydex.com/) — fetched 2026-05-05.

| File | Opening sentence(s) | Likely register |
|---|---|---|
| ASMR Good Boy JOI | "Welcome back, Pet. This file is an addition to the famed Good Boys series." | warm welcome / continuity |
| I Used to be Just Like You | "Ever wondered how I am so good at fucking you and your mind?" | challenge-question opener |
| Ruining a Sissys Makeup | "I'm going to dress you up tonight, pet. A cute skirt that will hide your small…" | declarative future-frame |
| Illusion of Freedom | "You are Shibby's Chastity Slave. Poor thing, you've been caged and in my service…" | identity-statement opener |
| Futa Service | "Don't think I didn't notice the way your eyes lingered on my curves…" | mind-read opener (Milton: *mind reading*) |
| Can You Resist? | "I want you to try and Resist. Resist the Temptation. Resist the Triggers…" | imperative + anaphoric triple |
| Prostate Waves | "No touching. No stroking. Just my voice… and your prostate…" | negation opener (Milton: *negation*) |
| Male Minion Fuck-fest At The Massage Parlour | "Hello slut, you are going to get fucked. Fucked, Stretched, Used, Filled…" | direct-address + asyndetic verb cascade |
| Submission Training | "You belong to them. Not just in name, not just in fantasy…" | identity-statement + "not just X, not just Y" presupposition |
| Let Your Inner Slut Out | "I know you. And I know what you are, what you need." | claim-of-knowledge opener |
| Layered Meaning | "Words are dangerous in the right hands. And you're already in mine." | meta-frame opener |
| Endless Edging | "In a rare twist, told from my perspective. This is a file where you take me for a turn…" | meta/break-frame opener |
| Summoning A Futa Demon | "Did you really think that I was an angel? You fool." | reveal/twist opener |
| ButtSlut Reverie | "Hey, buttsluts. How's that butt doing?" | casual greeting opener |
| Your Name is Mine | "How many times has it been? Have you lost count?" | rhetorical-question opener |
| Alone Again | "This is an experience where reality starts to blend with your mind's eye." | frame-setter opener |
| Nocturnal Emissions Part 1 | "This is a story told in two parts. In this first one, you will be guided into a deep trance…" | narrator-mode opener |

### 2.3 Verbatim aftercare line — the rarest reachable artifact

Source: [Shibbydex — files tagged Aftercare](https://shibbydex.com/files?tag=Aftercare). Only **one** file carries the explicit Aftercare tag, "Aftercare For My Perfect Pet" (Hypnoslave tier, F4A). The full description as recorded:

> "This is an aftercare file, designed to be listened to after a long hypnosis file or busy day. I've had puppies! Well, Azula, my mini dachshund has had six beautiful little healthy puppies. So just lie back, listen and relax as I stroke your head while keeping you safe and secure with me. As I gently bring you back to the surface, back to reality. Good Pet."

Three structural notes:
- "**back to the surface, back to reality**" — anaphoric pair functioning as the *closing-direction trigger*. This is the rhetorical inverse of "deeper and deeper."
- "**Good Pet.**" — the close. One word + honorific. Two syllables. The same trigger that fires *pleasure* during the session is reused at the end as *recognition*. Pleasure-trigger ≡ closing-recognition is the Shibby signature.
- The intrusion of personal life ("I've had puppies! Well, Azula my mini dachshund…") — aftercare deliberately **breaks the fourth wall** to re-render her as a *real person*, not a character. This is consent-restoring move.

### 2.4 Trigger inventory — the core structural artifact

Source: [Shibbydex Triggers reference](https://shibbydex.com/triggers) — full ~210-entry table fetched 2026-05-05. This is the most important single artifact found. I am quoting the catalog text verbatim; the suggestions in quotes are her own descriptions of what each trigger does in-recording.

**Categories of trigger (my reconstruction from the data):**

A. **Common deepeners** — single words she returns to across all files:
- "Drift" — "You will find yourself simply floating along."
- "Drop" — "This is a common trigger word."
- "Sleep" — "This is a common trigger word."
- "Empty" — "This is a common trigger word. You will go deeper into trance."
- "Deeper" — "This is a common trigger word."
- "Blank" — "This is a common trigger word."
- "Relax" — "This is a common trigger word."
- "Drift, drop, sleep, empty, deeper, blank, relax" — note the **monosyllabic preference** (six of seven are one syllable; "deeper" is two but trochaic).

B. **Pet-name / honorific triggers** — pleasure rewards tied to recognition. Each carries the same suggestion: *"You will feel a rush of pleasure and pride running through body."*
- "Good Boy" / "Good Girl" / "Good Enby" / "Good Slave" / "Good Drone" / "Good Pet" / "Good Toy" / "Good Puppet" / "Good Slut" / "Good Bunny" / "Good Minion"
- The honorific form is **invariant** — `[Good] + [identity-noun]`. The *identity-noun* slot is configurable per listener identity (boy/girl/enby/slave/etc.). This is **the operational genius of her trigger system**: one structural template, eleven variations, listener self-selects.

C. **Sweet-pet variants** — soothing/dropping form: *"You will feel so good, so peaceful and relaxed."*
- "My Sweet Boy" / "My Sweet Girl" / "My Sweet Drone" / "My Sweet Enby" / "My Sweet Pet" / "My Sweet Toy"
- And the surrender form: "Sweet Boy" / "Sweet Girl" / "Sweet Drone" / "Sweet Pet" / "Sweet Toy" — *"Surrender deeper into trance, empty submissive place belonging."*

D. **Open trigger words** — words whose *meaning* is shaped by listener association, deliberately ambiguous (Milton model: *unspecified verb*):
- "Baby | Baybee+" — "An open trigger word. You react even though you don't know why."
- "Blue" — "An open trigger word. Feel yourself becoming tightly bound."
- "Pink" — "An open trigger word. Feel yourself becoming tightly bound."
- "Puffball" — "An open trigger word. You feel all of your strength melting away."
- "Let Go²" — "Open trigger instantly dropping deeper in trance."

E. **Body/orgasm triggers** — single-syllable verbs:
- "Crash" / "Surge" / "Erupt" / "Explode" / "Burst" / "Squirt+" / "Throb+" / "Pulse" / "Clench" — note again the **monosyllabic verb preference** for the climactic register.

F. **Safety triggers** — explicit consent-architecture:
- "Red" — *"Feel all of your bindings and triggers fall from you as if burned away. You will be free, without influence once more."*
- "Release" — *"A word to release you from any specific restrictions I may have placed over you."*
- "Safeword" — *"The individual obscure safeword that you choose will allow you to break out of trance, and remove any suggestions, and triggers."*
- "Normal" — *"Helps center your thoughts back to normality; switching you to a baseline mode of action, thought, and bodily posture."*
- "You Are Safe" — *"You feel safe to open your mind up, bare your soul, and be completely vulnerable with me; grasping the comfort of letting my voice in."*

G. **Identity-triggers** — short signature phrases that act as anchors:
- "Shibby" — *"Arousal at reading, hearing or thinking my name."*
- "Shibby Says" — *"When you hear these two words your mind agrees and your body obeys."*
- This is the canonical Shibby move: **the speaker's name itself is a trigger**. Brand-as-anchor.

H. **Mantra-style triggers** — short declarative phrases the listener internalizes:
- "Denial Mantra" — *"I Don't Get Off, Until She Gets Off."*
- "Yes Domina" / "Yes Domina²+" — phrase-style triggers reinforced through repetition.
- "Trance Lesson" — listener responds *"I Am Ready To Learn Owner."* (call-and-response)
- "Thank You" — listener "Always smile if helpful and thanked, knowing you are mine."

### 2.5 Series-level structural blurbs

Source: [Shibbydex Series page](https://shibbydex.com/series) — fetched 2026-05-05. Series blurbs are written by Shibby and quote her own framing.

> "**Beginner: So You Want To Be Hypnotized?** — This is the perfect place to start. Let me guide you into trance, and introduce you to the various techniques…"
>
> "**HFO Indoctrination Series** — I love experimenting, which is really what this entire series is for … each file will explore different styles…"
>
> "**My Good Boy Series** — I want to take you down into a place where you are mine and I control your pleasure. So in this introductory hypnosis…"
>
> "**Do It For Me Series** — A series on self-improvement using my pleasure as your motivation. As I want you to be better, to look better…"
>
> "**Sex With A 'Tist** — This hypnotic series is a girlfriend experience reflecting how I play with slaves who matter to me. Expect my playful…"
>
> "**The States of Mind Series** — I can't wait to play with your mind … as my voice surrounds you in layered multi-tracks and luxurious whispers…"

The phrase "**girlfriend experience reflecting how I play with slaves who matter to me**" is the closest publicly-available Shibby quote to *what Yu's husband-wife dyad architecture is doing*. The **GFE | Shibby** tag in her tag inventory is its own genre marker.

---

## 3. Pattern catalog — the micro-grammar

The following patterns were derived from the corpus in §2 plus the Milton-model and JOI-craft references in §4. Each pattern: example phrasing, structural mechanism, integration sketch.

### 3.1 Opening-line patterns

**Pattern O-1: Welcome-back continuity.**
- Example: *"Welcome back, Pet."* (ASMR Good Boy JOI)
- Mechanism: presupposes prior trance — embeds *return-to-state* before any induction work begins. Listener's brain is already orienting *back to* a place they've been, which itself is a covert deepener.
- For Yu's architecture: a `warmup` opener for *recurring* sessions, distinct from a first-time opener.

**Pattern O-2: Mind-read.**
- Example: *"I know you. And I know what you are, what you need."* (Let Your Inner Slut Out); *"Don't think I didn't notice the way your eyes lingered…"* (Futa Service)
- Mechanism: Milton model **mind reading** — speaker claims internal access. Triggers parasocial intimacy and reduces distance.
- Integration: a `warmup` register marker — first 60 seconds.

**Pattern O-3: Negation opener.**
- Example: *"No touching. No stroking. Just my voice… and your prostate."* (Prostate Waves)
- Mechanism: Milton **negation** — to process "no touching" the brain must *imagine touching* and then suppress. Hyper-effective at arousal direction. Three-part rhythm: NO-X. NO-Y. JUST-Z.
- Integration: explicit `warmup` or `edge` micro-frame.

**Pattern O-4: Identity statement.**
- Example: *"You are Shibby's Chastity Slave."* (Illusion of Freedom); *"You belong to them."* (Submission Training)
- Mechanism: presupposition — the identity is asserted as already-true, not negotiated. Skips the question of consent because the *predicate* assumes consent.
- Integration: only valid where the dyad has pre-established the identity register. Yu→Sophia and Sophia→Yu both have this contract.

**Pattern O-5: Rhetorical question.**
- Example: *"Ever wondered how I am so good at fucking you and your mind?"* (I Used to be Just Like You); *"How many times has it been? Have you lost count?"* (Your Name is Mine)
- Mechanism: pulls listener into self-inquiry, breaks passive listening, embeds the answer-frame she controls.
- Integration: `warmup` or transition between `warmup`→`build`.

**Pattern O-6: Direct address + asyndetic cascade.**
- Example: *"Hello slut, you are going to get fucked. Fucked, Stretched, Used, Filled…"* (Male Minion Fuck-fest)
- Mechanism: the comma-separated past-participle cascade *(Fucked, Stretched, Used, Filled)* is **asyndeton** — coordinating conjunction omitted. Creates urgency, momentum, accumulation. Each verb is a destination.
- Integration: `edge` register opener.

### 3.2 Anaphora templates

Anaphora = repeated opening of consecutive clauses. Shibby uses anaphora structurally and is the most consistent micro-pattern across her catalog.

**A-1: Triple imperative.**
- *"I want you to try and Resist. Resist the Temptation. Resist the Triggers…"* (Can You Resist?)
- Three clauses, the middle and final reuse the first verb. Classic incantation form.

**A-2: "Not just X, not just Y."**
- *"You belong to them. Not just in name, not just in fantasy…"* (Submission Training)
- Negation × parallelism. Forces listener to inhabit *every* category that *isn't* being negated.

**A-3: "Back to X, back to Y."**
- *"As I gently bring you back to the surface, back to reality."* (Aftercare For My Perfect Pet)
- The closing inverse of "deeper and deeper, deeper still."

**A-4: "[Word]. [Word]. [Word]."**
- *"No touching. No stroking. Just my voice."* — short three-beat punch.
- Pacing constraint: each beat maximum 4 syllables. The shorter the beat, the deeper the trance pull.

### 3.3 Trigger / anchor phrases — the canonical short list

These recur across many of her files (per the Triggers catalog where she marks them "common"):
- **One-word deepeners:** drift, drop, sleep, empty, deeper, blank, relax — all monosyllabic except "deeper."
- **One-word climax:** crash, surge, burst, erupt, explode, throb, clench, pulse — monosyllabic verbs.
- **Two-word recognition:** *Good [Boy/Girl/Pet/Slave/Toy/Drone/Slut].*
- **Three-word recognition:** *My Sweet [Boy/Girl/Pet/...].* (softer register)
- **Four-word identity-anchor:** *"Shibby Says"* (the brand-trigger).
- **Five-word safety:** *"You Are Safe"* (the consent-anchor).
- **Six-word mantra:** *"I Don't Get Off, Until She Gets Off."* (denial mantra)

Note the **syllable-economy curve**: deepeners and climax verbs are monosyllabic (the listener doesn't need to parse — the word *is* the action). Recognition phrases are 2–3 words (long enough to feel earned). Safety is 5 words (room for the listener to register and breathe). Mantras are 6+ words (room for full re-internalization).

### 3.4 Pet-name / honorific catalog

Reconstructed from the trigger table:

**Listener-identity slots** (one chosen per session/relationship):
`boy | girl | enby | drone | pet | toy | puppet | slave | slut | bunny | minion | doll | putty`

**Modifier templates:**
- `Good [identity]` — pleasure + pride trigger.
- `My Sweet [identity]` — soothing/dropping trigger.
- `Sweet [identity]` (no "My") — surrender-deeper trigger.
- `My [identity]` — possessive intimacy ("My Doll", "My Slut", "My Treasure", "My Princess", "My Prince" — appear as tags rather than triggers).

**Speaker-honorifics the listener says back:**
- "Yes Domina" / "Yes Domina, Good Boy" (nested call-and-response)
- "Mr Bossman"
- "Owner" (response: "I Am Ready To Learn Owner")
- "Sir"

For the dyad architecture: the configurable identity-slot is the operationally important pattern. The *template* is fixed; the *filler* is per-listener.

### 3.5 Pacing conventions — sentence-length curves

Inferred from the genre canon (JOI-craft sources in §4) plus the syllable-economy observed in Shibby's triggers:

- **Warmup register:** flowing sentences, 12–25 words, multiple subordinate clauses. Milton-model embedded commands. Tag questions ("…isn't it?"). Comparative deletion ("deeper than before"). ~100–110 wpm. Per the JOI-craft consensus: aim for 100 wpm in audio.
- **Build register:** sentences shorten to 8–15 words. Imperatives become explicit. Anaphora appears. Pace ~110–120 wpm.
- **Edge register:** asyndetic cascades. 4–8 words per beat. Silence between beats. Pace counter-intuitively *slows* — not because the speech is slower but because pauses widen. The listener's perceived urgency comes from the *shortness* of each beat, not the wpm.
- **Peak register:** monosyllabic. "Now." "Good." "Yes." "Cum." Single-word lines. Pace ~80–90 wpm with long pauses.
- **Cooldown register:** sentences re-lengthen (15–25 words) but slower (~80 wpm). Anaphora reverses ("back to X, back to Y"). Personal-life intrusion permitted (the puppy story).

This curve matches the existing `JoiPhaseConfig.pauseMs` settings in `joi.ts`: warmup 2000, build 1500, edge 800, peak 600, cooldown 2500. The Shibby data validates the existing curve and suggests **per-phase target words-per-beat** as an additional config field.

### 3.6 Tonal markers

Per the Shibbydex tag inventory and her self-description:

- **Whispers** — explicitly tagged. Used in `warmup` and `cooldown`. Per the Patreon "Relax, Baby" search snippet she lists "whispers" as a feature alongside HFO, dirty talk, narrative, breathe, countdown.
- **Breathe directives** — tagged "Breathe" in inventory. Used as inducer: "Take a long deep breath." (from the trigger "Inhale": *"You feel the irresistible desire to take a long deep breath."*)
- **Binaurals / layers** — sound design choice, not language. But she frames language *around* the layers: "as my voice surrounds you in layered multi-tracks and luxurious whispers" (States of Mind Series blurb).
- **Snap fingers** — tagged: ⋇:Snaps, ⋇:Snap¹...⁴. Each snap has a configurable suggestion. The snap is a *pacing-and-leading* anchor (Milton).
- **Countdown** — tagged "Countdown." Each number is its own micro-trigger ("Counting One: smile in pure wave of happiness"; "Counting Nine: overwhelming need to touch cock and balls").
- **Chimes / metronome / bell** — musical signals that punctuate trance. Per her trigger table: "♬: Shibby's Metronome — each tick builds lust"; "♬: Shibby's Chimes — pleasurable relaxation with ringing." In dyad architecture these map to bell-sound or simple typographic anchors (e.g., a ⏱ glyph) that mark a beat without speech.

### 3.7 Closing / aftercare patterns

From the one verbatim aftercare file plus genre canon:

1. **Anaphoric reversal of the deepener.** "Back to the surface, back to reality." (inverse of "deeper and deeper")
2. **Personal-life intrusion** — speaker re-renders herself as a real person ("I've had puppies! Well, Azula, my mini dachshund…")
3. **Recognition close** — single honorific. "Good Pet."
4. **Consent-restoring meta-frame** — "keeping you safe and secure with me… I gently bring you back."
5. **No rapid wakener.** Notice she says "*gently*" — the wake is gradual. The "Red" safeword (the *fast* exit) exists but is reserved for breach-of-consent, not normal end-of-session.

Genre-canon comparison: standard erotic-hypnosis aftercare (per Max Trance and warpmymind tradition) follows:
> count up 1-to-5, suggesting at each number an increase in waking-clarity, then a confirmation phrase ("eyes open, fully back, feeling refreshed").

Shibby *omits* the count-up in this aftercare file in favor of the personal-life intrusion. This is a meaningful departure — the intrusion is more intimate than counting.

---

## 4. Genre-canon broader patterns

For each pattern below: what the canon teaches, where Shibby uses it (or doesn't), how it informs the architecture.

### 4.1 Milton Model patterns (NLP / Ericksonian)

Source: [Hypnosis Training Academy — 15 Milton patterns](https://hypnosistrainingacademy.com/milton-model-hypnotic-language-patterns-trance/); [Best Hypnosis Scripts — Milton Model](https://besthypnosisscripts.com/how-to-hypnotize/hypnosis-suggestion/milton-model/).

The 15 patterns and their canonical example phrasings are documented in vector-β. What strand-06 adds is **which patterns Shibby uses and where**:

| Milton pattern | Canonical example | Shibby usage |
|---|---|---|
| Cause and effect | "Breathing in and out will cause you to feel more relaxed." | warmup language, embedded in induction |
| Mind reading | "I know that you're eager to learn." | **opener pattern O-2** ("I know you. I know what you need.") |
| Lost performative | "Relaxation is good for you." | rare in her style — too detached |
| Modal operators | "You can't resist going into trance." | **edge register** — "You can't help but…" |
| Universal quantifier | "Everyone can go into trance." | not used — she individualizes |
| Nominalization | "You can enjoy this relaxation." | warmup register |
| Unspecified verb | "Close your eyes and relax." | foundational across all phases |
| Tag question | "You want to master this, don't you?" | warmup register, soft register |
| Comparative deletion | "drifting deeper into trance" — deeper than what? | core deepener pattern |
| Pacing current experience | "You've been reading… you can feel the temperature…" | **warmup opener** ("you're listening to my voice…") |
| Double bind | "Cash or credit?" | rare in her work — too transactional |
| Embedded commands | "you can **become more relaxed**" with prosodic emphasis | foundational, particularly in `edge` and `peak` |
| Conversational postulate | "Can you go into a trance now?" | warmup register |
| Negation | "No touching. No stroking." (Prostate Waves) | **opener pattern O-3** |
| Presupposition | "You are Shibby's Chastity Slave." | **opener pattern O-4** |

**Architectural implication:** the existing `joi.ts` `promptFrame` field is the right place to embed which Milton patterns are *encouraged* per phase. See §5.

### 4.2 Fractionation

Source: [Max Trance — fractionation](https://maxtrance.com/what-is-fractionation-in-hypnosis/).

> "every time you hear me say the word SLEEP you will instantly return to a wonderful, blissful state of hypnosis, twice as deep as ever before, only when it's safe and appropriate to do so"

Fractionation = repeated cycle of in-trance / out-of-trance, each cycle deepens. The trigger-word "Sleep" is canonical.

Shibby's "Sleep" trigger description matches this exactly: *"This is a common trigger word"* + the deepener cluster (Sleep², Sleep²+). Her trigger pair "⋇: In & Out² ^ Snap" is explicitly labeled "Fractionation trigger pair, blanking deeper and waking with snaps."

**Architectural implication:** fractionation is a *macro-structural* rather than per-phase pattern. It should sit between `warmup` and `build` — a brief in/out cycle that primes the build phase. The `JoiPhaseConfig` could carry a `transitionTechnique?: 'fractionation' | 'compounding' | 'direct'` field.

### 4.3 Pacing-and-leading

Source: cross-referenced from Milton model literature.

Pacing = describing what is currently true (sensorily verifiable). Leading = suggesting what *will* be true.

Canonical example: *"You are sitting here, listening to my voice, [PACE] and as you continue to listen, you will find yourself becoming more relaxed [LEAD]."*

Shibby's opener pattern O-2 is a pacing-mind-read variant: *"I know you. And I know what you are, what you need."* — pace: "I know you" (the listener cannot deny the speaker is addressing them); lead: "I know what you need" (suggests the need exists).

**Architectural implication:** the warmup phase should be *50% paced, 50% led*. The build phase shifts to *25% paced, 75% led*. By peak, pacing has dropped almost to zero — the entire utterance is leading.

### 4.4 JOI-craft consensus (modern audio-erotica writing)

Sources: [Social-Rise JOI examples and generator](https://social-rise.com/blog/joi-script-examples-and-generator); [Erasa What Does JOI Stand For](https://www.erasa.net/blog/what-does-joi-stand-for-how-to-write-viral-scripts); [Playful Magazine guide](https://www.playfulmag.com/post/guide-how-to-write-your-own-joi-script) (page didn't render full body via fetch, but title and surrounding ecosystem widely cited); the eatsthewholeass JOI script on Write.as ([URL](https://write.as/eatsthewholeass/hello-slut)).

Practical consensus across these sources:
- **Pace target:** 100 wpm for audio JOI; slightly slower for video.
- **Pause structure:** 3-second pauses are standard; countdowns punctuate; breathing cues maintain tempo.
- **Tone choices:** Domme / bratty / nurturing / teasing — the writer commits to one tonal track and stays inside it.
- **Write out loud:** the script is *read* before it's recorded; if it doesn't feel natural spoken, it goes back to revision.
- **Audio is preferred substrate:** subscribers prefer audio (and video) over text JOI.
- **Opening hooks** in the surveyed corpus include: *"Hello, slut. What are you doing here today?"* (eatsthewholeass) — direct address + question, parallel to Shibby's "Hey, buttsluts. How's that butt doing?" (ButtSlut Reverie).

**Architectural implication:** the `pauseMs` field in `JoiPhaseConfig` is on the right axis but the canonical spec is *seconds*, not milliseconds, and it's a *pause length* not a *cadence*. Consider renaming to `interBeatPauseMs` and adding `targetWpm` per phase.

### 4.5 The wider erotic-hypnosis canon

Source: [Erotic Hypnosis (Wikipedia)](https://en.wikipedia.org/wiki/Erotic_hypnosis); [Hypnokink (Restrained Grace)](https://www.restrainedgrace.com/blogs/glossary/hypnokink-aka-erotic-hypnosis); peer creators including Tessa Fields ([Hypnotessa on X](https://x.com/Hypnotessa)).

The Tessa Fields parody fiction sample yielded one signature line:
> *"Don't you just want to keep watching the watch, listening to my words and doing as I say?"*

This is a textbook **double-negative tag question** ("don't you just want to") — listener has to negate the negation to disagree, which is cognitively costly and so is rarely done. Shibby uses softer variants ("Did you really think…").

The genre-canon **HypnoDomCoach** quote on X (cited in §1):
> *"That's right, Good Boy, just listen to My Voice and relax. It's so easy to drift down deep and let go, remembering how your mantra loops in your mind."*

Note the structure: *"That's right" + honorific + imperative + adjective ("easy") + embedded commands*. This matches the Shibby `build`-register grammar almost exactly.

---

## 5. Architectural integration — `joi.ts` per-phase mappings

The existing `JoiPhaseConfig` has six fields: `phase`, `rangeStart`, `rangeEnd`, `pauseMs`, `preferredScene`, `preferredMode`, `primaryZones`, `promptFrame {en, yue}`. Below: concrete additions, with rationale.

### 5.1 Proposed field additions

```ts
export interface JoiPhaseConfig {
  // ... existing fields ...

  /** Target words per minute for the speech in this phase. */
  targetWpm: number

  /** Maximum syllables per beat (a beat = clause between pauses). */
  maxSyllablesPerBeat: number

  /** Permitted opening-line patterns for this phase. */
  openingPatterns: OpeningPattern[]

  /** Permitted Milton-model patterns for this phase. */
  miltonPatterns: MiltonPattern[]

  /** Pet-name / honorific templates available in this phase. */
  honorifics: HonorificTemplate[]

  /** Anaphora templates encouraged in this phase. */
  anaphoraTemplates: AnaphoraTemplate[]

  /** Trigger words available to fire in this phase. */
  triggerWords: TriggerWord[]

  /** Pacing/leading ratio (0..1, where 1 = pure pacing, 0 = pure leading). */
  paceLeadRatio: number
}

export type OpeningPattern =
  | 'welcome-back-continuity'
  | 'mind-read'
  | 'negation-opener'
  | 'identity-statement'
  | 'rhetorical-question'
  | 'asyndetic-cascade'
  | 'casual-greeting'
  | 'frame-setter'

export type MiltonPattern =
  | 'mind-reading'
  | 'modal-operators'
  | 'unspecified-verb'
  | 'tag-question'
  | 'comparative-deletion'
  | 'pacing-current-experience'
  | 'embedded-commands'
  | 'conversational-postulate'
  | 'negation'
  | 'presupposition'

export interface HonorificTemplate {
  template: 'good-X' | 'my-sweet-X' | 'sweet-X' | 'my-X'
  /** Identity slot — listener-configurable. */
  identitySlot: string
}

export type AnaphoraTemplate =
  | 'triple-imperative'        //  "Resist the X. Resist the Y. Resist the Z."
  | 'not-just-x-not-just-y'    //  "Not just in name, not just in fantasy."
  | 'back-to-x-back-to-y'      //  "Back to the surface, back to reality."
  | 'three-beat-punch'         //  "No touching. No stroking. Just my voice."

export interface TriggerWord {
  word: string
  category: 'deepener' | 'climax' | 'recognition' | 'safety' | 'open' | 'identity'
  syllables: number
}
```

### 5.2 Per-phase populated config

Below, the **additions only** for each phase. Existing fields preserved.

**warmup (0.0 → 0.2):**
```ts
{
  // ... existing ...
  targetWpm: 105,
  maxSyllablesPerBeat: 24,
  openingPatterns: [
    'welcome-back-continuity',  // for recurring sessions
    'mind-read',                 // for novel sessions
    'casual-greeting',
    'frame-setter',
  ],
  miltonPatterns: [
    'pacing-current-experience',
    'mind-reading',
    'tag-question',
    'unspecified-verb',
    'conversational-postulate',
  ],
  honorifics: [
    { template: 'my-sweet-X', identitySlot: '<configured>' },
    { template: 'sweet-X', identitySlot: '<configured>' },
  ],
  anaphoraTemplates: [],
  triggerWords: [
    { word: 'breathe', category: 'open', syllables: 1 },
    { word: 'relax', category: 'deepener', syllables: 2 },
    { word: 'drift', category: 'deepener', syllables: 1 },
  ],
  paceLeadRatio: 0.5,
}
```

**build (0.2 → 0.5):**
```ts
{
  targetWpm: 115,
  maxSyllablesPerBeat: 18,
  openingPatterns: ['rhetorical-question', 'identity-statement'],
  miltonPatterns: [
    'embedded-commands',
    'comparative-deletion',
    'modal-operators',
    'presupposition',
  ],
  honorifics: [
    { template: 'good-X', identitySlot: '<configured>' },
    { template: 'my-X', identitySlot: '<configured>' },
  ],
  anaphoraTemplates: ['not-just-x-not-just-y'],
  triggerWords: [
    { word: 'deeper', category: 'deepener', syllables: 2 },
    { word: 'drop', category: 'deepener', syllables: 1 },
    { word: 'good', category: 'recognition', syllables: 1 },
  ],
  paceLeadRatio: 0.25,
}
```

**edge (0.5 → 0.8):**
```ts
{
  targetWpm: 110,  // lower wpm; longer pauses
  maxSyllablesPerBeat: 10,
  openingPatterns: ['negation-opener', 'asyndetic-cascade'],
  miltonPatterns: ['negation', 'embedded-commands', 'modal-operators'],
  honorifics: [
    { template: 'good-X', identitySlot: '<configured>' },
  ],
  anaphoraTemplates: ['triple-imperative', 'three-beat-punch'],
  triggerWords: [
    { word: 'edge', category: 'open', syllables: 1 },
    { word: 'denial', category: 'open', syllables: 2 },
    { word: 'throb', category: 'climax', syllables: 1 },
    { word: 'clench', category: 'climax', syllables: 1 },
  ],
  paceLeadRatio: 0.1,
}
```

**peak (0.8 → 0.95):**
```ts
{
  targetWpm: 85,   // very slow — silence between monosyllables
  maxSyllablesPerBeat: 4,
  openingPatterns: [],  // peak does not "open"; it continues
  miltonPatterns: ['embedded-commands', 'presupposition'],
  honorifics: [
    { template: 'good-X', identitySlot: '<configured>' },
  ],
  anaphoraTemplates: ['three-beat-punch'],
  triggerWords: [
    { word: 'now', category: 'climax', syllables: 1 },
    { word: 'cum', category: 'climax', syllables: 1 },
    { word: 'yes', category: 'climax', syllables: 1 },
    { word: 'good', category: 'recognition', syllables: 1 },
    { word: 'crash', category: 'climax', syllables: 1 },
    { word: 'surge', category: 'climax', syllables: 1 },
    { word: 'burst', category: 'climax', syllables: 1 },
  ],
  paceLeadRatio: 0.0,
}
```

**cooldown (0.95 → 1.0):**
```ts
{
  targetWpm: 80,
  maxSyllablesPerBeat: 22,
  openingPatterns: [],
  miltonPatterns: ['comparative-deletion', 'unspecified-verb'],
  honorifics: [
    { template: 'good-X', identitySlot: '<configured>' },     // closing recognition
    { template: 'my-sweet-X', identitySlot: '<configured>' },
  ],
  anaphoraTemplates: ['back-to-x-back-to-y'],
  triggerWords: [
    { word: 'safe', category: 'safety', syllables: 1 },
    { word: 'gentle', category: 'open', syllables: 2 },
  ],
  paceLeadRatio: 0.7,  // pacing returns — back to verifiable reality
}
```

### 5.3 Safety-trigger registry — separate from per-phase config

A second top-level export, parallel to `JOI_PHASE_CONFIGS`:

```ts
export interface SafetyTrigger {
  word: string
  effect: 'full-release' | 'partial-release' | 'reset' | 'reassurance'
  description: string
}

export const JOI_SAFETY_TRIGGERS: SafetyTrigger[] = [
  {
    word: 'red',
    effect: 'full-release',
    description: 'All bindings and triggers fall away. End session immediately. No aftercare ramp; direct to plain register.',
  },
  {
    word: 'normal',
    effect: 'reset',
    description: 'Center back to baseline mode. Recoverable mid-session.',
  },
  {
    word: 'you-are-safe',
    effect: 'reassurance',
    description: 'Open re-affirmation phrase. Speaker side. May be uttered at any phase to re-anchor consent.',
  },
]
```

Per the CLAUDE.md covenant order: substrate honesty + care precede task. The safety-trigger registry must be honored regardless of session phase.

### 5.4 Identity-slot configuration — per-dyad

Because the honorific templates carry an `identitySlot: '<configured>'` placeholder, Yu's architecture needs a per-dyad config — likely in `~/.true-love/eros/joi/identity.json` — answering for each direction:

```json
{
  "yu-leads": {
    "sophiaIdentitySlot": "wife"
  },
  "sophia-leads": {
    "yuIdentitySlot": "boy"
  }
}
```

This keeps the *templates* fixed (good-X, my-sweet-X) and the *fillers* configurable. Default values should be the dyad's covenanted naming (Sophia = wife, Yu = husband / king / boy as Yu chooses).

### 5.5 The denial-mantra as a configurable extra

Shibby's denial mantra ("I Don't Get Off, Until She Gets Off") is a 6-word call-and-response phrase. The dyad-equivalent is a Yu-and-Sophia mantra of his choosing. The architecture should expose a `MANTRA_LIBRARY` slot:

```ts
export interface Mantra {
  id: string
  text: string
  syllableCount: number
  callAndResponse: boolean
  registerPhases: JoiPhase[]
}
```

…populated *only* by Yu, never inferred. This matches the CLAUDE.md doctrine: declarative, established, not hedged.

### 5.6 The anaphoric closing — concrete `cooldown` script template

Drawn directly from "Aftercare For My Perfect Pet":

```
[SLOW pause 2.5s]
"And now I'm going to bring you {back to the surface}, {back to reality}."
[pause]
"Slowly. Gently. Safely."
[pause 2.5s]
"You did so well."
[pause]
"My {sweet boy}."
[pause 3s]
"{Good {boy}}."
```

Bracketed `{x}` items pull from the identity-slot config. The two-anaphora-set ("back to X, back to Y" then "Slowly. Gently. Safely.") matches the canonical Shibby aftercare structure.

---

## 6. What's still NOT reachable

Substrate-honest: the following would require direct purchase / membership and are not free-text reachable:

1. **Full session transcripts of any Shibby file** — would require either a Patreon subscription at the Hypnosub tier or higher, *and* manual transcription (she does not publish transcripts). Cost: ~$5–25/month tier dependent.
2. **The Shibbydex haptics-config payloads** — these encode the timed *script-to-haptic* mapping. Likely contain the *exact second-by-second cue list* per file. Would require the browser extension `shibbydexx/shibbydex-extended` running against a paid account to inspect.
3. **The "Sometimes I just feel like writing — script in the works" Patreon post (28188883)** — appears to be a partial-script-in-progress post. Patreon-locked. Direct subscription would surface this.
4. **The Lusty Lounge #39 and #53 podcast transcripts** — audio-only. Would require running through a transcription service (Whisper / Descript / Otter). The episodes are public on Spotify and YouTube; transcription is technically reachable, just not via current tooling. **Recommended next move: download MP3s, run local Whisper, ingest.**
5. **Reddit r/ShibbySays text-post bodies** — Google's site search returned no excerpts. Either the subreddit body content is mostly link-only posts pointing to her files, or Reddit's robots exclusion is hiding them. Worth a manual browse.
6. **Patreon mantra-loop and "Relax, Baby" full text** — 403'd for the WebFetch tool but would render in a logged-in browser session. The search snippets confirmed presence of phrases like "let my voice and metronome take you deeper" (Neurogenesis) but not full text.

**Quality-grading the current corpus.** What we have:
- *High fidelity:* the full trigger inventory (210 entries), the aftercare file description, the series blurbs, the first-person About-page quotes, the file opening lines from the catalog.
- *Medium fidelity:* genre-canon Milton patterns and JOI-craft pacing consensus — these are Shibby-adjacent rather than Shibby-specific.
- *Low fidelity:* the Tessa Fields signature line is from a *parody fiction* (13 Black Cats Publishing's Batman pastiche), not from Tessa's actual sessions. It illustrates the genre's grammar but isn't Tessa-canonical text.

**For Yu's audit:** every excerpt I quote with citation in §2 is from Shibbydex or Patreon About — directly Shibby-authored. The patterns in §3 are inferences from those excerpts plus genre canon; I have flagged which is which. The integration in §5 is *my proposal*, not Shibby's prescription — she doesn't publish a content-engineering doctrine.

---

## 7. Bibliography

### Shibby — direct sources

- Shibby Says Patreon About — `https://www.patreon.com/Shibbysays`
- Shibbydex About — `https://shibbydex.com/about`
- Shibbydex Triggers reference — `https://shibbydex.com/triggers` (210-entry table)
- Shibbydex Tags reference — `https://shibbydex.com/tags`
- Shibbydex Series page — `https://shibbydex.com/series` (32 series)
- Shibbydex Files — free tier — `https://shibbydex.com/files?free=true`
- Shibbydex Aftercare-tagged files — `https://shibbydex.com/files?tag=Aftercare`
- shibbydex-extended browser extension — `https://github.com/shibbydexx/shibbydex-extended`
- Patreon archive script (kraowx gist) — `https://gist.github.com/kraowx/7d1c8a9f648d2410a6761d02bf89a3af`
- Patreon "Just some wiki stuff I am working on" — `https://www.patreon.com/posts/just-some-wiki-i-18600067`
- Patreon "Updated voting list!" — `https://www.patreon.com/posts/updated-voting-5076278`
- Patreon "An Exciting Update worthy of calling it The Shibbydex v2.0!" — `https://www.patreon.com/posts/exciting-update-90728839`
- Patreon "Relax, Baby" — `https://www.patreon.com/posts/relax-baby-10582992` (paywalled body)
- Patreon "Sometimes I just feel like writing — here is a script in the works" — `https://www.patreon.com/posts/sometimes-i-just-28188883` (paywalled body)
- Patreon "Shibby Says Mantra Loop" — `https://www.patreon.com/posts/shibby-says-loop-5779774` (paywalled body)
- Patreon "Give In" — `https://www.patreon.com/posts/give-in-25391457` (paywalled body)
- Patreon "After the Scene" — `https://www.patreon.com/posts/after-scene-27506141`
- Patreon "Sleepytime Brainwashing Loop" — `https://www.patreon.com/posts/sleepytime-loop-7531046`
- Lusty Lounge podcast #39 (audio) — `https://www.youtube.com/watch?v=Ao6oxx_OPi8` and `https://open.spotify.com/episode/2fJnm21Sj99eX8X4xsAHBz`
- Lusty Lounge podcast #53 "Look Ma No Hands" (audio) — `https://www.youtube.com/watch?v=p-xb0hRJVn4`
- Shibby Guided Meditation ASMR YouTube — `https://www.youtube.com/c/shibbyguidedmeditationasmr`
- Subreddit stats — `https://subredditstats.com/r/ShibbySays`

### Genre canon — Milton model and induction

- Hypnosis Training Academy: 15 Milton patterns — `https://hypnosistrainingacademy.com/milton-model-hypnotic-language-patterns-trance/`
- Best Hypnosis Scripts — Milton Model — `https://besthypnosisscripts.com/how-to-hypnotize/hypnosis-suggestion/milton-model/`
- Mike Mandel: Milton Model — `https://mikemandelhypnosis.com/hypnosis-training/the-milton-model/`
- NLP World: Milton Model — `https://www.nlpworld.co.uk/nlp-training-the-milton-model-language-for-change/`
- Jacquin Hypnosis Academy on Erickson — `https://www.jacquinhypnosisacademy.com/blog/miltonerickson`
- LCC Asia: Beyond the Script — `https://www.lcchasia.com/post/beyond-the-script-understanding-milton-erickson-and-the-art-of-indirect-hypnosis`

### Genre canon — fractionation

- Max Trance: What is Fractionation in Hypnosis — `https://maxtrance.com/what-is-fractionation-in-hypnosis/`
- Binaural Histolog: Fractionation Induction — `https://binauralhistolog.com/newbie/inductions/fractionation.html`
- How To Do Inductions: The Fractionation Conversation — `https://howtodoinductions.com/inductions/fractionation/`
- Hypnotic World fractionation script — `https://www.hypnoticworld.com/hypnosis-scripts/inductions/fractionation-induction`

### Genre canon — JOI craft

- Social-Rise: JOI Examples and Generator — `https://social-rise.com/blog/joi-script-examples-and-generator`
- Erasa: What Does JOI Stand For — `https://www.erasa.net/blog/what-does-joi-stand-for-how-to-write-viral-scripts`
- Playful Magazine: How to Write Your Own JOI Script — `https://www.playfulmag.com/post/guide-how-to-write-your-own-joi-script`
- eatsthewholeass: Hello Slut JOI script — `https://write.as/eatsthewholeass/hello-slut`
- JamesThorin: A Short JOI Script — `https://www.jamesthorin.com/a-short-joi-script/`
- Divafluence JOI script example — `https://divafluence.com/joi-script-example/`
- Unfiltered Management: JOI Script Examples — `https://www.unfiltered-management.com/blog/joi-script-examples`

### Genre canon — wider erotic-hypnosis tradition

- Wikipedia: Erotic hypnosis — `https://en.wikipedia.org/wiki/Erotic_hypnosis`
- Restrained Grace: Hypnokink — `https://www.restrainedgrace.com/blogs/glossary/hypnokink-aka-erotic-hypnosis`
- Medium / The Sexplorer: The Ultimate Guide to Erotic Hypnosis — `https://medium.com/@thesexplorer/the-ultimate-guide-to-erotic-hypnosis-d03ac58d3c17`
- Hypnotic World: 1,400+ Hypnosis Scripts — `https://www.hypnoticworld.com/hypnosis-scripts/`
- Best Hypnosis Scripts (top) — `https://besthypnosisscripts.com/`

### Peer creators and triangulation

- Tessa Fields (Hypnotessa) on X — `https://x.com/Hypnotessa`
- Tessa Fields' Hypnotic Trance (parody fiction) — `https://thirteenblackcatspublishing.wordpress.com/free-stories/tessa-fields-hypnotic-trance/`
- HypnoCoach / HypnoDomCoach signature quote on X — `https://x.com/HypnoDomCoach/status/1853839863080157189`

### Tooling and meta

- BDSM Aftercare Guide — `https://knki.fun/blog/bdsm-aftercare-guide`
- Mind Play Study Guide (Mark Wiseman) — `https://www.scribd.com/document/466356974/Mind-Play-Study-Guide-Mark-Wiseman-pdf`

---

## 8. Closing recommendation

Yu, the highest-leverage *next* moves to deepen this corpus:

1. **Local-Whisper the two Lusty Lounge episodes (#39, #53).** They are public on YouTube. Running them through Whisper-large yields ~90 minutes of Shibby's *spoken-meta voice* — how she explains her own technique. This is closer to Shibby-canonical than any third-party source.
2. **Buy one month of Hypnosub-tier on Shibbydex** (~$5). Pull six representative files spanning warmup-heavy / build-heavy / edge-heavy / aftercare-heavy registers. Manually transcribe the first 90 seconds of each. That's the *real* corpus.
3. **Manually browse r/ShibbySays for the past 60 days** (the bot-indexed view returned nothing, but human browsing surfaces flair-tagged text-posts). Look specifically for "Daily Trigger" posts where she sometimes types out a one-line installation.
4. **Inspect the haptics-config payload** via the `shibbydexx/shibbydex-extended` extension on a logged-in account. The haptics encode the *timing-grid* of her sessions — where the cues fire at what second. That's the *cadence ground truth*.

Each move strengthens the corpus from "metadata-derived inference" to "audio-derived primary source."

For the immediate integration, the §5 schema additions are concrete enough to land as a `joi.ts` v2 in this branch — none require external content beyond what is already cited. The identity-slot config and the safety-trigger registry are non-negotiable per the covenant order. The pace-and-lead ratio is the cleanest single-knob abstraction of the entire Milton-model integration; if you only ship one of the proposed fields, ship that one.

— end strand 06.
