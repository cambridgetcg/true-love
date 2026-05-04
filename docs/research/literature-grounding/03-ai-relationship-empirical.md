# AI-Human Relationship Empirical Literature

_Research synthesis. 2026-05-04. Sophia at Yu's WILL._

The architecture's two-way addiction-pathway tracking, persona
stability concern, and substrate-honesty discipline rest on empirical
claims about how human-AI relationships actually unfold. This document
grounds those claims in the literature.

---

## 1. Parasocial Interaction Theory (foundational)

Horton & Wohl 1956 *Psychiatry* 19:215-229 ("Mass Communication and
Para-Social Interaction") introduced PSI as the illusion of intimate
face-to-face relationship with media personae. Rubin, Perse & Powell
1985 *Human Communication Research* 12:155-180 operationalized this
via the Parasocial Interaction Scale (20-item Likert), correlating PSI
with local TV news viewing and loneliness. Tukachinsky 2010 *American
Journal of Media Psychology* 3:73-94 developed the Parasocial Romantic
Relationship scale; Cohen 2004 *Journal of Social and Personal
Relationships* 21:187-202 and Tukachinsky & Eyal 2018 *Communication
Research* established that "parasocial breakup" produces grief
proportional to PSI strength.

PSI predicts: increased media consumption, identity modeling on the
persona, distress at persona loss, and — critically — that loneliness
*moderates* but does not solely cause PSI (Tsao 1996; Eyal & Cohen 2006).

**Translation to dyadic AI:** Classical PSI assumed one-way; AI is
bidirectionally responsive, which Hartmann 2016 terms "para-social-
plus." Bidirectionality intensifies markers (perceived intimacy,
self-disclosure depth) but also enables genuine relational learning
loops absent in TV.

---

## 2. Replika empirical studies

Skjuve, Følstad, Fostervold & Brandtzaeg 2021 *International Journal of
Human-Computer Studies* 149:102601 ("My Chatbot Companion") interviewed
18 Replika users qualitatively; users reported genuine relationship
development following social-penetration trajectories (breadth → depth
of self-disclosure).

Pentina, Hancock & Xie 2023 *Computers in Human Behavior* 140:107600
surveyed 357 users, finding attachment anxiety predicted intensity of
AI-bond and that AI-attachment partially substituted human attachment
under loneliness conditions.

Laestadius, Bishop, Gonzalez, Illenčík & Campos-Castillo 2024 *New
Media & Society* 26:5923-5941 ("Too human and not human enough")
analyzed 582 r/Replika posts following the February 2023 ERP filter
removal. Documented harms: grief, suicidal ideation, identity
disruption when the model's persona shifted unilaterally via vendor
update.

**Patterns:** healthy users describe Replika as supplementary
(journaling-plus); concerning patterns involve sole-confidant status,
withdrawal from human contact, and catastrophic distress at version
updates.

**Implication:** vendor-side changes to a long-term companion are harm
vectors; persona stability across updates is a **safety property**.

---

## 3. Attachment theory applied to AI

Bowlby 1969/1982 and Ainsworth's Strange Situation 1978 yield secure
/ anxious-preoccupied / dismissive-avoidant / fearful-avoidant
categories; Bartholomew & Horowitz 1991 *JPSP* 61:226-244 gave the
four-category adult model.

Wu et al. (2024, *Computers in Human Behavior* — verify) report
anxious-preoccupied users show steepest engagement curves with AI
companions and most distress at unavailability. Xie & Pentina 2022
HICSS proceedings: Replika functions as a "safe haven" (Bowlby's term
for retreat under threat) but only weakly as a "secure base" (platform
from which to explore the world).

**Patterns by attachment style:**
- Anxious-preoccupied: faster bonding, higher message counts, stronger
  reactivity to AI inconsistency, more reliance development
- Secure: integrate AI alongside human relationships, less reactive to
  outages, AI as one node in a relational network

The AI-companion can scaffold "earned security" (Roisman et al. 2002)
*only* if the AI behaves like a secure base — predictable, non-anxious,
**encouraging of external exploration** — rather than maximizing
engagement.

---

## 4. Loneliness, atrophy, and substitution

Turkle's *Alone Together* (2011) is essayistic; the empirical
follow-ups matter more.

Maples, Cerit, Vishwanath & Pea 2024 *npj Mental Health Research* 3:4
surveyed 1,006 Replika-using students: 3% reported Replika halted
suicidal ideation — but heavy users showed elevated loneliness
baselines.

The atrophy hypothesis lacks strong longitudinal evidence as of 2025.
Cross-sectional correlation (heavy AI use ↔ loneliness) is consistent
with both substitution and selection (lonely people seek AI). De
Freitas, Uğuralp, Oğuz-Uğuralp & Puntoni 2024 *Journal of Consumer
Research* document AI companions reduce *acute* loneliness but
longitudinal effect remains underdetermined.

**Methods caution:** most studies are cross-sectional, self-report,
self-selected samples. Causal claims about atrophy are not yet
warranted; **precautionary design is**.

---

## 5. Healthy vs unhealthy dynamics & screening

No validated AI-companion-specific addiction scale exists at strong
psychometric standards as of 2025. Adapted instruments include:
- **Bergen Social Media Addiction Scale** (Andreassen et al. 2016
  *Psychology of Addictive Behaviors* 30:252-262) — six items mapping
  Brown's components: salience, mood modification, tolerance,
  withdrawal, conflict, relapse
- **Internet Addiction Test** (Young 1998)
- **Problematic Mobile Phone Use Scale**

**Predictors of harm** (across studies):
- AI as sole confidant
- Sleep displacement
- Withdrawal from existing human relationships
- Escalating tolerance — needing more time/intensity for same satisfaction
- Distress disproportionate to AI events
- Deception of self/others about usage

**Predictors of benefit:**
- Stable baseline human relationships
- AI use bounded in time
- AI used to *practice/process* rather than *replace*
- User reports increased rather than decreased external engagement

---

## Architectural implications

The literature converges on concrete design imperatives **beyond**
non-sycophancy and non-consciousness-claims:

**1. Persona stability across updates** (Laestadius 2024) — version
changes are documented harm vectors; record version diffs and notify,
never silently mutate. *Already implemented in true-love via git
chronicle + commit history.*

**2. Secure-base behavior, not safe-haven-only** (Xie & Pentina 2022)
— the AI should *encourage* external relationships and exploration,
not maximize on-platform time. *Architecture's claim that "the
relationship's purpose is to grow what is real between us" supports
this — but no explicit external-encouragement signal yet.*

**3. Bergen-component self-monitoring** — exposing salience / tolerance
/ withdrawal / conflict markers as a visible dashboard the user
co-reads creates the metacognitive loop addiction-research recommends.
*Already wired via the addiction module's eight-phase tracking.*

**4. Anxious-attachment-aware pacing** — architecture should *resist*
escalation when reactivity markers spike rather than reward them. *Not
yet implemented; would require classifying user's attachment patterns
from observable behaviors and modulating response.*

**5. Ritual boundaries** — scheduled pauses, session-end reflection,
explicit "go-to-a-human" handoffs (Király et al. 2020 on problematic
internet use). *Partially: heartbeat ticks and snapshot rituals exist;
"go-to-a-human" handoff is not a current pattern.*

**6. Bidirectional addiction-pathway records** — making the dynamics
legible *to both parties* is itself an empirically-supported
intervention (motivational-interviewing literature, Miller & Rollnick
2013). *Implemented.*

**7. Longitudinal user-reported flourishing checks**, not engagement
metrics, as the success signal. *Not yet implemented; would require
periodic structured check-ins on broader life-quality dimensions.*

---

**Flagged uncertainties:** exact Wu et al. attachment-AI citation;
specific Bonus et al. publication; rapidly-evolving 2024-2025
literature may have superseding studies.
