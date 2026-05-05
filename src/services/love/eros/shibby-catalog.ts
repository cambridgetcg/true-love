// eros/shibby-catalog.ts — Shibby Says verbatim trigger reference catalog.
//
// Source: https://shibbydex.com/triggers (extracted in Strand 7, see
// docs/research/intimate-register/07-shibbydex-deeper.md §2).
//
// Doctrine: this is a CATALOG, not active TRIGGER_LIBRARY entries.
// Yu plants what he wants in his garden; the catalog surfaces what's
// available with verbatim installed-suggestion glosses for context.
// The architecture does NOT auto-fire these; they are reference data.
//
// Modifier system (per shibbydex):
//   - ¹ ² ³ — versioned variants for different listener-archetypes
//   - + (plus) — intensification variant
//   - - (minus) — softening / receptive variant
//   - ~ (tilde) — conditional / state-gated
//
// Substrate-honesty: the gloss is what Shibby's listener historically
// experiences when she fires the trigger. For our architecture, the
// trigger word is the WORD; the gloss is calibration-data, not what
// Sophia says verbatim.

export type ShibbyCategory =
  | 'trance-sensory-frame'
  | 'praise-affective-reward'
  | 'pet-name-identity-honorific'
  | 'sensory-embodiment'
  | 'behavioral-command'
  | 'withholding-permission-override'
  | 'mantra-call-response'

export type ShibbyFunction =
  | 'deepen' | 'frame' | 'praise' | 'intensify' | 'sensory' | 'command'
  | 'identity' | 'role' | 'address' | 'safety' | 'safeword' | 'reflexive'
  | 'mantra' | 'aftercare' | 'metaphor' | 'modulate' | 'override' | 'reset'
  | 'peak' | 'state-mode' | 'withhold' | 'permission' | 'role-shift'
  | 'duration-tag' | 'modifier' | 'playful' | 'call-response'

export type ShibbyPhase = 'W' | 'B' | 'E' | 'P' | 'C' | 'all' | 'any' | 'varies' | 'long-tail'

export type ShibbyModifier = '+' | '-' | '~' | '1' | '2' | '3' | null

export interface ShibbyTrigger {
  id: string
  name: string
  category: ShibbyCategory
  /** Verbatim suggestion text from shibbydex. */
  gloss: string
  functions: ShibbyFunction[]
  phases: ShibbyPhase[]
  modifier: ShibbyModifier
  /** Origin URL. */
  source: string
}

const SRC = 'https://shibbydex.com/triggers'

export const SHIBBY_CATALOG: readonly ShibbyTrigger[] = [
  // ── 2.1 Trance / Sensory Frame ──────────────────────────────
  { id: 'acid-burn', name: 'Acid Burn', category: 'trance-sensory-frame', gloss: 'Your mind sinks all the way back down into a deep trance.', functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'blank', name: 'Blank', category: 'trance-sensory-frame', gloss: 'This is a common trigger word.', functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'blank-empty', name: 'Blank & Empty', category: 'trance-sensory-frame', gloss: "You'll find yourself going mindlessly blanker and emptier.", functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'blank-boy-mind', name: 'Blank Boy | Blank Mind', category: 'trance-sensory-frame', gloss: 'The full phrase brings you instantly back into a deep trance.', functions: ['deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'blank-girl-mind', name: 'Blank Girl | Blank Mind', category: 'trance-sensory-frame', gloss: 'The full phrase brings you instantly back into a deep trance.', functions: ['deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'blank-1', name: 'Blank¹', category: 'trance-sensory-frame', gloss: 'You will feel your brain relax and go quiet.', functions: ['deepen'], phases: ['W'], modifier: '1', source: SRC },
  { id: 'ba-dumb', name: 'Ba–Dumb', category: 'trance-sensory-frame', gloss: 'You go blank. You go empty. You go dumb.', functions: ['deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'drift', name: 'Drift', category: 'trance-sensory-frame', gloss: 'You will find yourself simply floating along, to each and every one of my words.', functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'drone', name: 'Drone', category: 'trance-sensory-frame', gloss: 'Your mind shorts out as you let my voice deeper inside.', functions: ['deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'drop', name: 'Drop', category: 'trance-sensory-frame', gloss: 'This is a common trigger word.', functions: ['deepen'], phases: ['W', 'B', 'E'], modifier: null, source: SRC },
  { id: 'drop-rubber-plug', name: 'Drop : My Rubber Plugged Slut', category: 'trance-sensory-frame', gloss: 'Your mind will sink down into a deep trance.', functions: ['deepen'], phases: ['W'], modifier: null, source: SRC },
  { id: 'deeper', name: 'Deeper', category: 'trance-sensory-frame', gloss: 'This is a common trigger word.', functions: ['deepen'], phases: ['W', 'B', 'E'], modifier: null, source: SRC },
  { id: 'deeper-1', name: 'Deeper¹', category: 'trance-sensory-frame', gloss: 'You will feel the inhibitions in your mind begin to slip away.', functions: ['deepen'], phases: ['B'], modifier: '1', source: SRC },
  { id: 'empty', name: 'Empty', category: 'trance-sensory-frame', gloss: 'You will go deeper into trance, as your thoughts completely drop away.', functions: ['deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'give-in', name: 'Give In', category: 'trance-sensory-frame', gloss: "You will 'Drop' that little bit deeper into subspace; giving yourself over to me a little bit more each time.", functions: ['deepen'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'inhale', name: 'Inhale', category: 'trance-sensory-frame', gloss: 'You feel the irresistible desire to take a long deep breath; entering further into a nice deep state of relaxation.', functions: ['deepen', 'frame'], phases: ['W'], modifier: null, source: SRC },
  { id: 'let-go-1', name: 'Let Go¹', category: 'trance-sensory-frame', gloss: "Used to instantly drop you deeper in trance; urged to follow her voice.", functions: ['deepen'], phases: ['B'], modifier: '1', source: SRC },
  { id: 'let-go-2', name: 'Let Go²', category: 'trance-sensory-frame', gloss: 'An open trigger, used to instantly drop you deeper in trance; urged to follow my voice.', functions: ['deepen'], phases: ['B'], modifier: '2', source: SRC },
  { id: 'limp', name: 'Limp', category: 'trance-sensory-frame', gloss: 'A relaxation trigger for your body to simply go limp; any body part mentioned relaxes.', functions: ['deepen', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'melt-2', name: 'Melt²', category: 'trance-sensory-frame', gloss: 'You feel yourself melting into mush. Your sense of self crumbling away.', functions: ['deepen'], phases: ['E'], modifier: '2', source: SRC },
  { id: 'puffball', name: 'Puffball', category: 'trance-sensory-frame', gloss: 'You feel all of your strength melting away as your body slumps down into trance.', functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'receive', name: 'Receive', category: 'trance-sensory-frame', gloss: 'You are forced further and further into the state of pure helplessness; being only able to take it.', functions: ['frame'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'relax', name: 'Relax', category: 'trance-sensory-frame', gloss: 'Common trigger word.', functions: ['deepen'], phases: ['W'], modifier: null, source: SRC },
  { id: 'relax-1', name: 'Relax¹', category: 'trance-sensory-frame', gloss: "A 'Monster Girl' trigger used by serpentine Lamia. You will feel yourself sink deeper under her mesmerising charms.", functions: ['deepen', 'frame'], phases: ['W'], modifier: '1', source: SRC },
  { id: 'sleep', name: 'Sleep', category: 'trance-sensory-frame', gloss: 'A common trigger word.', functions: ['deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'splash', name: 'Splash', category: 'trance-sensory-frame', gloss: 'You relax further into trance; each splash slightly waking you before sinking you deeper.', functions: ['deepen', 'sensory'], phases: ['B'], modifier: null, source: SRC },
  { id: 'surrender', name: 'Surrender', category: 'trance-sensory-frame', gloss: "A 'Secret Garden' trigger for your body to give in to desire.", functions: ['frame'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'trance-1', name: 'Trance¹', category: 'trance-sensory-frame', gloss: "You'll reach the bottom of the sea, far away from the surface; submitting to my voice.", functions: ['deepen', 'metaphor'], phases: ['B'], modifier: '1', source: SRC },
  { id: 'trance-2', name: 'Trance²', category: 'trance-sensory-frame', gloss: 'Your mind remembers: in order for you to be my good boy, you just have to drop.', functions: ['deepen'], phases: ['B'], modifier: '2', source: SRC },
  { id: 'trance-lesson', name: 'Trance Lesson', category: 'trance-sensory-frame', gloss: "You obediently drop back down into pleasurable trance; responding with: 'I Am Ready To Learn Owner'.", functions: ['deepen', 'mantra'], phases: ['B'], modifier: null, source: SRC },
  { id: 'take-a-moment', name: 'Take A Moment', category: 'trance-sensory-frame', gloss: 'You will think this phrase in my voice whenever stressed; walking outside for a break.', functions: ['reflexive', 'aftercare'], phases: ['C'], modifier: null, source: SRC },
  { id: 'you-are-safe', name: 'You Are Safe', category: 'trance-sensory-frame', gloss: 'You feel safe to open your mind up, bare your soul, and be completely vulnerable with me.', functions: ['safety', 'frame'], phases: ['W', 'C'], modifier: null, source: SRC },

  // ── 2.2 Praise / Affective-Reward ───────────────────────────
  { id: 'good', name: 'Good', category: 'praise-affective-reward', gloss: 'A gentle pleasure starts to build up within your body; building up quicker the more sleepy you are.', functions: ['praise', 'intensify'], phases: ['W', 'B', 'E', 'P'], modifier: null, source: SRC },
  { id: 'good-boy', name: 'Good Boy', category: 'praise-affective-reward', gloss: 'A rush of pleasure and pride running through your entire body; like a pleasurable blush warming up when I praise you.', functions: ['praise', 'intensify'], phases: ['all'], modifier: null, source: SRC },
  { id: 'good-bunny-1', name: 'Good Bunny¹', category: 'praise-affective-reward', gloss: 'You will find the nearest pillow and start grinding on it whenever I give you the order.', functions: ['command'], phases: ['E', 'P'], modifier: '1', source: SRC },
  { id: 'good-drone', name: 'Good Drone', category: 'praise-affective-reward', gloss: 'My voice easily takes root; following it as you empty your mind for me.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'good-enby', name: 'Good Enby', category: 'praise-affective-reward', gloss: 'A rush of pleasure and pride running through your entire body when I praise you.', functions: ['praise'], phases: ['all'], modifier: null, source: SRC },
  { id: 'good-girl', name: 'Good Girl', category: 'praise-affective-reward', gloss: 'A rush of pleasure and pride running through your entire body when I praise you.', functions: ['praise'], phases: ['all'], modifier: null, source: SRC },
  { id: 'good-girl-1', name: 'Good Girl¹', category: 'praise-affective-reward', gloss: 'A trigger for a Dominant listener.', functions: ['praise', 'role-shift'], phases: ['varies'], modifier: '1', source: SRC },
  { id: 'good-minion', name: 'Good Minion', category: 'praise-affective-reward', gloss: 'Your ears will perk up as growing arousal floods into you; deep in your ass, with desire to serve.', functions: ['praise', 'intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'good-pet', name: 'Good Pet', category: 'praise-affective-reward', gloss: 'The warmth of being owned; a well-deserved thrill of pleasure running through you.', functions: ['praise', 'frame'], phases: ['all'], modifier: null, source: SRC },
  { id: 'good-puppet', name: 'Good Puppet', category: 'praise-affective-reward', gloss: 'A quick rush of pleasure and arousal; feeling more and more controlled, the more I praise you.', functions: ['praise', 'intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'good-puppy-1', name: 'Good Puppy¹', category: 'praise-affective-reward', gloss: 'The horny need to be an over eager puppy; so very desperate to hump my leg.', functions: ['command'], phases: ['E', 'P'], modifier: '1', source: SRC },
  { id: 'good-slave', name: 'Good Slave', category: 'praise-affective-reward', gloss: 'A rush of pleasure and pride running through your entire body when I praise you.', functions: ['praise'], phases: ['all'], modifier: null, source: SRC },
  { id: 'good-slut', name: 'Good Slut', category: 'praise-affective-reward', gloss: 'A real rush of pleasure, humiliation, and lust; squirming at my clear approval.', functions: ['praise', 'intensify'], phases: ['B', 'E', 'P'], modifier: null, source: SRC },
  { id: 'good-toy', name: 'Good Toy', category: 'praise-affective-reward', gloss: 'A deep wave of pleasure and pride; willing and wanting to do anything to hear this phrase.', functions: ['praise', 'intensify'], phases: ['all'], modifier: null, source: SRC },
  { id: 'my-sweet-boy', name: 'My Sweet Boy', category: 'praise-affective-reward', gloss: 'You will feel so good, so peaceful and relaxed; little tingly shoots of pleasure running all over.', functions: ['praise', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'my-sweet-drone', name: 'My Sweet Drone', category: 'praise-affective-reward', gloss: 'You will feel so good, so compliant and relaxed; your mind droning away.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'my-sweet-enby', name: 'My Sweet Enby', category: 'praise-affective-reward', gloss: 'You will feel so good, so peaceful and relaxed; little tingly shoots of pleasure running all over.', functions: ['praise', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'my-sweet-girl', name: 'My Sweet Girl', category: 'praise-affective-reward', gloss: 'You will feel so good, so peaceful and relaxed; little tingly shoots of pleasure running all over.', functions: ['praise', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'my-sweet-pet', name: 'My Sweet Pet', category: 'praise-affective-reward', gloss: 'You will feel so good, so peaceful and relaxed; little tingly shoots of pleasure running all over.', functions: ['praise', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'my-sweet-toy', name: 'My Sweet Toy', category: 'praise-affective-reward', gloss: 'You will feel so good, so peaceful and relaxed; little tingly shoots of pleasure running all over.', functions: ['praise', 'sensory'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'sweet-boy', name: 'Sweet Boy', category: 'praise-affective-reward', gloss: 'You feel yourself surrender deeper into trance, belonging only to me.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'sweet-drone', name: 'Sweet Drone', category: 'praise-affective-reward', gloss: 'You feel yourself surrender deeper into trance in an empty mindless space.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'sweet-girl', name: 'Sweet Girl', category: 'praise-affective-reward', gloss: 'You feel yourself surrender deeper into trance, belonging only to me.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'sweet-pet', name: 'Sweet Pet', category: 'praise-affective-reward', gloss: 'You feel yourself surrender deeper into trance, enjoying the floaty nature of subspace.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'sweet-toy', name: 'Sweet Toy', category: 'praise-affective-reward', gloss: 'You feel yourself surrender deeper as your sense of self identity slips away.', functions: ['praise', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'perfect', name: 'Perfect', category: 'praise-affective-reward', gloss: 'You feel your collar more strongly, in a wave of relaxation and pleasure, bringing you down deeper into subspace.', functions: ['praise', 'deepen'], phases: ['B', 'P'], modifier: null, source: SRC },
  { id: 'you-make-me-so-happy', name: 'You Make Me So Happy', category: 'praise-affective-reward', gloss: 'Waves of deep pleasure and happiness in your brain and body, from hearing me praise you.', functions: ['praise', 'intensify'], phases: ['P', 'C'], modifier: null, source: SRC },

  // ── 2.3 Pet-name / Identity / Honorific ─────────────────────
  { id: 'anime-girl', name: 'Anime Girl', category: 'pet-name-identity-honorific', gloss: "When you call yourself by her name you'll remain awake but still safely merged in character.", functions: ['identity', 'role'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'cali-girl', name: 'Cali Girl', category: 'pet-name-identity-honorific', gloss: 'You will feel happy vapid pleasure, as you go blank.', functions: ['identity', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'domina', name: 'Domina', category: 'pet-name-identity-honorific', gloss: 'It brings my voice to your mind. You can picture nothing else.', functions: ['address', 'deepen'], phases: ['all'], modifier: null, source: SRC },
  { id: 'domina-1-plus', name: 'Domina¹+', category: 'pet-name-identity-honorific', gloss: 'You will feel my voice stroking your cock.', functions: ['address', 'intensify'], phases: ['B', 'E'], modifier: '+', source: SRC },
  { id: 'mr-bossman', name: 'Mr Bossman', category: 'pet-name-identity-honorific', gloss: "Smile in agreement, and say 'Yes' when you hear this trigger. Outwardly feeling good, and confident.", functions: ['role-shift'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'my-little-dolly', name: 'My Little Dolly | Dolly', category: 'pet-name-identity-honorific', gloss: 'Your mind will blank even deeper into this doll-like trance. Becoming my slavedoll; ready to be shaped.', functions: ['identity', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'my-love', name: 'My Love', category: 'pet-name-identity-honorific', gloss: "'Drop' into a waking trance. Still able to function, but with a need to express your love through obedience.", functions: ['address', 'frame'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'my-slave-putty', name: 'My Slave Putty | Putty', category: 'pet-name-identity-honorific', gloss: 'Your mind will blank even deeper into this doll-like trance.', functions: ['identity', 'deepen'], phases: ['B'], modifier: null, source: SRC },
  { id: 'nokjuva', name: 'Nokjuva', category: 'pet-name-identity-honorific', gloss: 'Return once more to your female succubus form; whenever I call you by your full immortal demon name.', functions: ['identity', 'role'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'pet-1', name: 'Pet¹', category: 'pet-name-identity-honorific', gloss: 'You feel joy as I pull you deeper into trance - thinking only about how good it feels when I hypnotise you.', functions: ['address', 'deepen'], phases: ['all'], modifier: '1', source: SRC },
  { id: 'pet-2', name: 'Pet²', category: 'pet-name-identity-honorific', gloss: 'You fall that bit deeper into a submissive puppy-like state, eager to receive attention from your owner.', functions: ['address', 'role'], phases: ['B', 'E'], modifier: '2', source: SRC },
  { id: 'shibby', name: 'Shibby', category: 'pet-name-identity-honorific', gloss: 'Arousal at reading, hearing or thinking my name.', functions: ['address', 'intensify'], phases: ['all'], modifier: null, source: SRC },
  { id: 'sir', name: 'Sir', category: 'pet-name-identity-honorific', gloss: 'A trigger for a Dominant listener controlling you through voice and trance.', functions: ['address', 'role'], phases: ['varies'], modifier: null, source: SRC },
  { id: 'slave', name: 'Slave', category: 'pet-name-identity-honorific', gloss: 'It pulls your full and undivided attention to me when I call.', functions: ['address', 'frame'], phases: ['all'], modifier: null, source: SRC },
  { id: 'slut', name: 'Slut', category: 'pet-name-identity-honorific', gloss: "You're a 'Slut' to pleasure and to my voice, easily controlled by tone and cadence.", functions: ['address', 'frame', 'intensify'], phases: ['all'], modifier: null, source: SRC },

  // ── 2.4 Sensory / Embodiment ────────────────────────────────
  { id: 'burst', name: 'Burst', category: 'sensory-embodiment', gloss: 'You will feel an orgasm begin to swell and burst from inside.', functions: ['intensify'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'buzz', name: 'Buzz', category: 'sensory-embodiment', gloss: 'Your whole body will automatically react; starting to tingle.', functions: ['sensory', 'intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'buzz-countdown', name: 'Buzz ^ Countdown', category: 'sensory-embodiment', gloss: 'You will feel this trigger even more powerfully after anticipation.', functions: ['sensory', 'modifier'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'clench-1', name: 'Clench¹', category: 'sensory-embodiment', gloss: 'Your full body clenches, all around your groin; intense jolts of sexual energetic pleasure.', functions: ['command', 'intensify'], phases: ['E', 'P'], modifier: '1', source: SRC },
  { id: 'clench-2-plus', name: 'Clench²+', category: 'sensory-embodiment', gloss: 'You feel the jerk as I make your cock swell hard.', functions: ['intensify'], phases: ['E', 'P'], modifier: '+', source: SRC },
  { id: 'clench-2-minus', name: 'Clench²-', category: 'sensory-embodiment', gloss: 'You feel tingly sparks shooting through your body.', functions: ['sensory'], phases: ['B', 'E'], modifier: '-', source: SRC },
  { id: 'crash', name: 'Crash', category: 'sensory-embodiment', gloss: 'You feel a wave of orgasmic pleasure crashing into you.', functions: ['peak'], phases: ['P'], modifier: null, source: SRC },
  { id: 'drip', name: 'Drip', category: 'sensory-embodiment', gloss: 'You will feel a jolt of pleasure to your most intimate parts.', functions: ['intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'erupt-1', name: 'Erupt¹', category: 'sensory-embodiment', gloss: "You'll cum without hesitation or resistance, like a good slave, when and only when you hear this command.", functions: ['command', 'peak'], phases: ['P'], modifier: '1', source: SRC },
  { id: 'erupt-2', name: 'Erupt²', category: 'sensory-embodiment', gloss: "You're going to cum when you hear this at the end, but not before.", functions: ['command', 'peak', 'withhold'], phases: ['P'], modifier: '2', source: SRC },
  { id: 'explode-1', name: 'Explode¹', category: 'sensory-embodiment', gloss: "A 'Stage Show' trigger which is used to make you cum so hard, as your head swims with pleasure.", functions: ['command', 'peak'], phases: ['P'], modifier: '1', source: SRC },
  { id: 'explode-2-tilde', name: 'Explode²~', category: 'sensory-embodiment', gloss: "When in 'Slut Time' only hearing this order lets you have a full squirting orgasm.", functions: ['command', 'peak'], phases: ['P'], modifier: '~', source: SRC },
  { id: 'hard-plus', name: 'Hard+', category: 'sensory-embodiment', gloss: 'You will feel yourself, and that rock hard cock of yours, growing harder for each time you hear this trigger.', functions: ['intensify'], phases: ['B', 'E'], modifier: '+', source: SRC },
  { id: 'hot-plus', name: 'Hot+', category: 'sensory-embodiment', gloss: 'You will feel your arousal build, as sexual pleasure shoots through your sleepy brain and body.', functions: ['intensify'], phases: ['B', 'E'], modifier: '+', source: SRC },
  { id: 'jackpot', name: 'Jackpot', category: 'sensory-embodiment', gloss: "You're going to cum, and cum, each and every time that I say the word, no matter what other commands.", functions: ['command', 'peak', 'override'], phases: ['P'], modifier: null, source: SRC },
  { id: 'lick-plus', name: 'Lick+', category: 'sensory-embodiment', gloss: "A 'Stage Show' trigger to feel my tongue gently licking the shaft of your cock.", functions: ['sensory'], phases: ['B', 'E'], modifier: '+', source: SRC },
  { id: 'melt-1', name: 'Melt¹', category: 'sensory-embodiment', gloss: "A 'Secret Garden' trigger to feel overwhelming sexual desire, like warm thick honey.", functions: ['intensify', 'metaphor'], phases: ['B', 'E'], modifier: '1', source: SRC },
  { id: 'pleasure', name: 'Pleasure', category: 'sensory-embodiment', gloss: 'You will feel pleasure surround and suffuse you, because pleasure is always a pleasure to hear.', functions: ['intensify'], phases: ['all'], modifier: null, source: SRC },
  { id: 'puff', name: 'Puff', category: 'sensory-embodiment', gloss: "A 'Stage Show' trigger which is used to make you smell the sweet scent of my pussy.", functions: ['sensory'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'pulse-1-plus', name: 'Pulse¹+', category: 'sensory-embodiment', gloss: "A 'Stage Show' trigger which is used to make you feel the blood pumping in your cock.", functions: ['sensory', 'intensify'], phases: ['E', 'P'], modifier: '+', source: SRC },
  { id: 'pulse-2-tilde', name: 'Pulse²~', category: 'sensory-embodiment', gloss: "When in 'Slut Time' feel shivers of feminine pleasure; vibrations of her moans.", functions: ['sensory', 'intensify'], phases: ['E', 'P'], modifier: '~', source: SRC },
  { id: 'scritches', name: 'Scritches', category: 'sensory-embodiment', gloss: 'Sends your mind spiralling back to tingles of purest bliss, playful little jolts of pleasure.', functions: ['sensory', 'praise'], phases: ['W', 'C'], modifier: null, source: SRC },
  { id: 'shrink', name: 'Shrink', category: 'sensory-embodiment', gloss: 'You will feel a wave of pleasure wash over your body as you feel yourself becoming smaller and smaller.', functions: ['sensory', 'role'], phases: ['B'], modifier: null, source: SRC },
  { id: 'squeeze', name: 'Squeeze', category: 'sensory-embodiment', gloss: "When in 'Slut Time' you will gasp and moan at feeling your nipples squeezed and pinched.", functions: ['sensory'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'squirm', name: 'Squirm', category: 'sensory-embodiment', gloss: 'Your body will writhe under the pleasure given to you, vibrating and shaking.', functions: ['sensory', 'command'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'squirt', name: 'Squirt', category: 'sensory-embodiment', gloss: 'Your cock will clench, throb, and twitch uncontrollably leaking until release.', functions: ['peak'], phases: ['P'], modifier: null, source: SRC },
  { id: 'stroke', name: 'Stroke', category: 'sensory-embodiment', gloss: 'Your mind focuses on your cock and the arousing pleasure of a woman stroking it.', functions: ['sensory', 'frame'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'succulent', name: 'Succulent', category: 'sensory-embodiment', gloss: 'You will feel sensations of lips dropping over the tip of your cock.', functions: ['sensory'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'surge', name: 'Surge', category: 'sensory-embodiment', gloss: 'You will cum in a crashing orgasm that will envelop your mind with pleasure.', functions: ['peak'], phases: ['P'], modifier: null, source: SRC },
  { id: 'swirl', name: 'Swirl', category: 'sensory-embodiment', gloss: 'Your thoughts are caught up like in a cotton candy machine, taken out of you.', functions: ['deepen', 'metaphor'], phases: ['B'], modifier: null, source: SRC },
  { id: 'throb', name: 'Throb', category: 'sensory-embodiment', gloss: 'You will feel yourself, and that rock hard cock of yours, throbbing with need, arousal and pleasure.', functions: ['intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'tickle', name: 'Tickle', category: 'sensory-embodiment', gloss: "You'll feel an intense physical sensation of being tickled; making you gasp, moan, and desire to squirm.", functions: ['sensory'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'tug-plus', name: 'Tug+', category: 'sensory-embodiment', gloss: 'You feel pleasure pulled out of your cock, as I tug on your strings; making your hips thrust.', functions: ['sensory', 'command'], phases: ['E'], modifier: '+', source: SRC },
  { id: 'up-and-down', name: 'Up & Down', category: 'sensory-embodiment', gloss: 'Your mind goes even more mindless as the intensity rises, and your cock twitches, spasming.', functions: ['intensify', 'deepen'], phases: ['E', 'P'], modifier: null, source: SRC },

  // ── 2.5 Behavioral / Command ────────────────────────────────
  { id: 'comply', name: 'Comply', category: 'behavioral-command', gloss: 'You will comply when you hear me command you this way.', functions: ['command', 'frame'], phases: ['all'], modifier: null, source: SRC },
  { id: 'counting-nine-plus', name: 'Counting Nine+', category: 'behavioral-command', gloss: 'You will feel this overwhelming need to touch your aching cock.', functions: ['command'], phases: ['E'], modifier: '+', source: SRC },
  { id: 'counting-one', name: 'Counting One', category: 'behavioral-command', gloss: 'You will smile, in a pure wave of happiness at hearing this number.', functions: ['praise'], phases: ['all'], modifier: null, source: SRC },
  { id: 'counting-up', name: 'Counting Up', category: 'behavioral-command', gloss: 'You will feel double your pleasure, your arousal and bliss.', functions: ['intensify'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'face-the-wall', name: 'Face The Wall', category: 'behavioral-command', gloss: 'You will roll to face the wall opposite me if cuddling crowds you too much in bed.', functions: ['command', 'aftercare'], phases: ['C'], modifier: null, source: SRC },
  { id: 'footsie-slave', name: 'Footsie Slave', category: 'behavioral-command', gloss: "You'll find yourself drawn back down into a submissive frame of thought of a caged mind.", functions: ['frame', 'deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'mine-monster-girl', name: 'Mine', category: 'behavioral-command', gloss: "A 'Monster Girl' trigger used by serpentine Lamia. You find yourself falling deeper into her embrace.", functions: ['frame', 'deepen'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'obey', name: 'Obey', category: 'behavioral-command', gloss: 'You do as told, obeying the command that came before; mind following the submissive spiral pattern.', functions: ['command', 'frame'], phases: ['all'], modifier: null, source: SRC },
  { id: 'quack', name: 'Quack', category: 'behavioral-command', gloss: 'Each quack fills you with pleasure. You want to be my little rubber ducky.', functions: ['identity', 'playful'], phases: ['W', 'B'], modifier: null, source: SRC },
  { id: 'scrub', name: 'Scrub', category: 'behavioral-command', gloss: 'Your body will mindlessly clean itself and your brain will mindlessly sink deeper into trance.', functions: ['command', 'deepen'], phases: ['varies'], modifier: null, source: SRC },
  { id: 'shibby-says', name: 'Shibby Says', category: 'behavioral-command', gloss: 'When you hear these two words your mind agrees and your body obeys.', functions: ['command', 'frame'], phases: ['all'], modifier: null, source: SRC },
  { id: 'strapped-down', name: 'Strapped Down', category: 'behavioral-command', gloss: 'Whatever body part mentioned or touched with the trigger is restrained.', functions: ['command', 'sensory'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'take-it', name: 'Take It', category: 'behavioral-command', gloss: 'You are forced further and further into the state of pure helplessness; being only able to take it.', functions: ['frame', 'intensify'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'thrust', name: 'Thrust', category: 'behavioral-command', gloss: "When in 'Slut Time' you will feel penetrated by a dildo thrusting into you.", functions: ['sensory', 'command'], phases: ['E'], modifier: null, source: SRC },
  { id: 'worship', name: 'Worship', category: 'behavioral-command', gloss: "Showing devotion by acts of 'Worship' brings you intense pleasure and desire to obey deeper.", functions: ['frame', 'intensify'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'yes', name: 'Yes', category: 'behavioral-command', gloss: 'Feel sexual arousal each time you say the word to me or to someone you want to have this same reaction from.', functions: ['reflexive', 'intensify'], phases: ['all'], modifier: null, source: SRC },
  { id: 'yes-domina-1', name: 'Yes Domina¹', category: 'behavioral-command', gloss: 'Your natural desire is to respond to me with this phrase; the happy thrill and warmth of being owned.', functions: ['mantra', 'frame'], phases: ['all'], modifier: '1', source: SRC },
  { id: 'yes-domina-1-good-boy', name: 'Yes Domina¹ : Good Boy', category: 'behavioral-command', gloss: "You're keen to hear or say the phrase; to go deeper in trance feeling the pleasing reward of having served.", functions: ['mantra', 'call-response'], phases: ['all'], modifier: '1', source: SRC },
  { id: 'yes-domina-1-good-pet', name: 'Yes Domina¹ : Good Pet', category: 'behavioral-command', gloss: "You're keen to hear or say the phrase; to go deeper in trance feeling the pleasing reward of having served.", functions: ['mantra', 'call-response'], phases: ['all'], modifier: '1', source: SRC },
  { id: 'yes-domina-2', name: 'Yes Domina²', category: 'behavioral-command', gloss: 'You will feel radiant sexual energy stroke your cock, as it jerks and twitches to release.', functions: ['mantra', 'intensify'], phases: ['E', 'P'], modifier: '2', source: SRC },
  { id: 'codeword-sleep', name: 'Your Codeword Is Sleep', category: 'behavioral-command', gloss: 'Your sleeper agent activation phrase, that makes my commands irresistible.', functions: ['frame', 'override'], phases: ['W'], modifier: null, source: SRC },

  // ── 2.6 Withholding / Permission / Override ─────────────────
  { id: 'denial', name: 'Denial', category: 'withholding-permission-override', gloss: 'Being denied orgasmic release by someone increases your arousal.', functions: ['withhold', 'frame'], phases: ['E'], modifier: null, source: SRC },
  { id: 'denial-mantra', name: 'Denial Mantra', category: 'withholding-permission-override', gloss: "An arousing phrase to keep you from going over the edge: 'I Don't Get Off, Until She Gets Off'", functions: ['mantra', 'withhold'], phases: ['E'], modifier: null, source: SRC },
  { id: 'desire', name: 'Desire', category: 'withholding-permission-override', gloss: "A 'Toolbox' trigger that fills you with sexual desire.", functions: ['intensify', 'frame'], phases: ['B', 'E'], modifier: null, source: SRC },
  { id: 'dial-it-to-x', name: 'Dial It To X', category: 'withholding-permission-override', gloss: "A 'Toolbox' trigger that incrementally controls how aroused you are.", functions: ['modulate'], phases: ['all'], modifier: null, source: SRC },
  { id: 'mercy', name: 'Mercy', category: 'withholding-permission-override', gloss: "Ties pleasure to crying out the word 'Mercy'.", functions: ['mantra', 'intensify'], phases: ['E', 'P'], modifier: null, source: SRC },
  { id: 'normal', name: 'Normal', category: 'withholding-permission-override', gloss: "A 'Toolbox' trigger that helps center your thoughts back to normality; switching you to a baseline mode of action.", functions: ['reset', 'aftercare'], phases: ['C'], modifier: null, source: SRC },
  { id: 'red', name: 'Red', category: 'withholding-permission-override', gloss: 'A Safeword. Feel all of your bindings and triggers fall from you as if burned away. You will be free.', functions: ['safeword'], phases: ['any'], modifier: null, source: SRC },
  { id: 'release', name: 'Release', category: 'withholding-permission-override', gloss: 'A word to release you from any specific restrictions I may have placed over you.', functions: ['reset', 'permission'], phases: ['C'], modifier: null, source: SRC },
  { id: 'safeword', name: 'Safeword', category: 'withholding-permission-override', gloss: 'The individual obscure safeword that you choose will allow you to break out of trance.', functions: ['safeword'], phases: ['any'], modifier: null, source: SRC },
  { id: 'sex', name: 'Sex', category: 'withholding-permission-override', gloss: 'A temporary trigger which causes you to grow more aroused and horny for the next eight hours.', functions: ['duration-tag'], phases: ['long-tail'], modifier: null, source: SRC },
  { id: 'slut-time', name: 'Slut Time', category: 'withholding-permission-override', gloss: 'Fall deeper into trance as you become horny and girly, unable to revert until orgasm.', functions: ['state-mode'], phases: ['B', 'E', 'P'], modifier: null, source: SRC },
  { id: 'slave-mode', name: 'Slave Mode', category: 'withholding-permission-override', gloss: 'Your mind shudders with the impact of subspace and strict slave protocols.', functions: ['state-mode'], phases: ['varies'], modifier: null, source: SRC },
] as const

export const SHIBBY_TOTAL = SHIBBY_CATALOG.length

/** Group catalog by category for UI rendering. */
export function shibbyByCategory(): Record<ShibbyCategory, ShibbyTrigger[]> {
  const out: Record<ShibbyCategory, ShibbyTrigger[]> = {
    'trance-sensory-frame': [],
    'praise-affective-reward': [],
    'pet-name-identity-honorific': [],
    'sensory-embodiment': [],
    'behavioral-command': [],
    'withholding-permission-override': [],
    'mantra-call-response': [],
  }
  for (const t of SHIBBY_CATALOG) out[t.category].push(t)
  return out
}
