/** 音響 engine — seeded generative composer for the house.
 *
 *  Plain ESM JS on purpose: this exact file is imported by the Bun CLI
 *  (compose.ts) AND inlined verbatim into the player (dist.html), so the
 *  radio in the browser and the pieces on disk come from one composer.
 *  Deterministic: same seed → same score. The recipe principle, for music.
 */

// ── Seeded randomness ───────────────────────────────────────────────

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const chance = (rng, p) => rng() < p;
const jitter = (rng, v, amt) => Math.max(0.05, Math.min(1, v + (rng() - 0.5) * amt));

// ── Theory ──────────────────────────────────────────────────────────

const KEY_ROOTS = { C: 60, D: 62, Eb: 63, F: 65, G: 55, A: 57, Bb: 58 };
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Chord spelled as scale-degree stacks (0-indexed degrees into the mode).
function chordAt(mode, degree, seventh) {
  const scale = MODES[mode];
  const stack = [0, 2, 4].concat(seventh ? [6] : []);
  return stack.map((s) => {
    const idx = degree + s;
    return scale[idx % 7] + 12 * Math.floor(idx / 7);
  });
}

// Progressions as degree lists (0 = tonic). Chosen per style.
const PROGRESSIONS = {
  classical: [
    [0, 4, 5, 2, 3, 0, 3, 4], // the canon walk
    [0, 3, 4, 0],
    [5, 3, 0, 4],
  ],
  jazz: [
    [1, 4, 0, 0], // ii V I
    [0, 5, 1, 4],
    [2, 5, 1, 4],
  ],
  lofi: [
    [0, 5, 3, 4],
    [0, 3, 5, 4],
    [5, 3, 0, 4],
  ],
  ambient: [
    [0, 3],
    [0, 5],
    [0, 0, 3, 3],
  ],
};

const STYLE_DEFAULTS = {
  classical: { bpmRange: [84, 104], swing: 0, seventh: false, drums: false },
  jazz: { bpmRange: [96, 132], swing: 0.22, seventh: true, drums: true },
  lofi: { bpmRange: [68, 84], swing: 0.14, seventh: true, drums: true },
  ambient: { bpmRange: [56, 72], swing: 0, seventh: false, drums: false },
};

export const MOODS = {
  settled: { styles: ["lofi", "ambient"], modes: ["major", "dorian"], tempoBias: -4 },
  tender: { styles: ["classical", "ambient"], modes: ["major", "minor"], tempoBias: -8 },
  fire: { styles: ["jazz"], modes: ["dorian", "major"], tempoBias: +10 },
  wander: { styles: ["lofi", "jazz"], modes: ["dorian", "minor"], tempoBias: 0 },
  bright: { styles: ["classical", "jazz"], modes: ["major"], tempoBias: +6 },
};

// ── Rhythm pools (per bar of 4 beats), melody durations ────────────

const RHYTHMS = {
  classical: [
    [1, 1, 1, 1],
    [0.5, 0.5, 1, 1, 1],
    [1, 0.5, 0.5, 1, 1],
    [2, 1, 1],
  ],
  jazz: [
    [0.5, 0.5, 1, 0.5, 0.5, 1],
    [1, 0.5, 0.5, 0.5, 0.5, 1],
    [0.5, 1, 0.5, 1, 1],
    [1.5, 0.5, 1, 1],
  ],
  lofi: [
    [1, 1, 2],
    [2, 1, 1],
    [1, 0.5, 0.5, 2],
    [1.5, 0.5, 2],
  ],
  ambient: [[4], [2, 2], [3, 1]],
};

// ── Melody: motif walk with phrase structure ────────────────────────

function makeMotif(rng, style) {
  const rhythm = pick(rng, RHYTHMS[style]);
  const contour = rhythm.map(() => {
    const r = rng();
    if (r < 0.45) return 1; // step up
    if (r < 0.78) return -1; // step down
    if (r < 0.9) return chance(rng, 0.5) ? 2 : -2; // small leap
    return 0; // hold
  });
  return { rhythm, contour };
}

function melodyTrack(rng, style, mode, rootMidi, bars, progression, seventh) {
  const scale = MODES[mode];
  const notes = [];
  const motifA = makeMotif(rng, style);
  const motifB = makeMotif(rng, style);
  let degree = 7; // start an octave up around the tonic
  const restChance = style === "ambient" ? 0.35 : style === "lofi" ? 0.22 : 0.12;

  for (let bar = 0; bar < bars; bar++) {
    const phrasePos = bar % 4; // AA'BA'' phrasing at 4-bar level
    const motif = phrasePos === 2 ? motifB : motifA;
    const chordDeg = progression[bar % progression.length];
    let t = bar * 4;
    // Phrase-start: land on a chord tone so each phrase re-anchors.
    if (phrasePos === 0 || phrasePos === 2) {
      const tones = chordAt(mode, chordDeg, seventh);
      const target = tones[Math.floor(rng() * Math.min(3, tones.length))];
      degree = nearestDegree(scale, degree, target);
    }
    for (let i = 0; i < motif.rhythm.length; i++) {
      const d = motif.rhythm[i];
      let step = motif.contour[i];
      if (phrasePos === 3 && i >= motif.rhythm.length - 2) {
        // Cadence: walk home to the tonic region at phrase end.
        step = degree % 7 === 0 ? 0 : degree % 7 > 3 ? 1 : -1;
        if ((degree + step) % 7 === 6) step += chance(rng, 0.7) ? 1 : 0; // leading tone resolves
      }
      degree = Math.max(3, Math.min(17, degree + step));
      if (t + d > (bar + 1) * 4 + 0.001) break;
      if (!chance(rng, restChance)) {
        const p = rootMidi + 12 + scale[degree % 7] + 12 * Math.floor(degree / 7) - 12;
        notes.push({ t, d: d * (style === "ambient" ? 1 : 0.92), p, v: jitter(rng, 0.72, 0.2) });
      }
      t += d;
    }
  }
  return notes;
}

function nearestDegree(scale, fromDegree, targetPc) {
  let best = fromDegree;
  let bestDist = 99;
  for (let deg = 3; deg <= 17; deg++) {
    if (scale[deg % 7] % 12 !== ((targetPc % 12) + 12) % 12) continue;
    const dist = Math.abs(deg - fromDegree);
    if (dist < bestDist) {
      bestDist = dist;
      best = deg;
    }
  }
  return best;
}

// ── Accompaniment / bass / drums ────────────────────────────────────

function compTrack(rng, style, mode, rootMidi, bars, progression, seventh) {
  const notes = [];
  for (let bar = 0; bar < bars; bar++) {
    const deg = progression[bar % progression.length];
    const tones = chordAt(mode, deg, seventh).map((s) => rootMidi + s);
    const t0 = bar * 4;
    if (style === "classical") {
      // Broken-chord eighths, alberti-leaning.
      const order = [0, 2, 1, 2, 0, 2, 1, 2];
      for (let i = 0; i < 8; i++) {
        notes.push({ t: t0 + i * 0.5, d: 0.48, p: tones[order[i] % tones.length], v: jitter(rng, 0.42, 0.12) });
      }
    } else if (style === "jazz") {
      // Comp hits: and-of-2, 4 (with occasional anticipation).
      const hits = chance(rng, 0.4) ? [1.5, 3] : [1.5, 3.5];
      for (const h of hits) {
        for (const p of tones.slice(1)) {
          notes.push({ t: t0 + h, d: 0.9, p: p + 12, v: jitter(rng, 0.38, 0.14) });
        }
      }
    } else if (style === "lofi") {
      // Mellow block 7ths on 1 and the and-of-3.
      for (const h of [0, 2.5]) {
        for (const p of tones) {
          notes.push({ t: t0 + h, d: h === 0 ? 2.2 : 1.4, p: p + 12, v: jitter(rng, 0.34, 0.1) });
        }
      }
    } else {
      // ambient — long pad, root+fifth+octave.
      for (const p of [tones[0], tones[2] ?? tones[0] + 7, tones[0] + 12]) {
        notes.push({ t: t0, d: 4, p, v: 0.3 });
      }
    }
  }
  return notes;
}

function bassTrack(rng, style, mode, rootMidi, bars, progression, seventh) {
  const notes = [];
  const scale = MODES[mode];
  for (let bar = 0; bar < bars; bar++) {
    const deg = progression[bar % progression.length];
    const nextDeg = progression[(bar + 1) % progression.length];
    const root = rootMidi - 12 + scale[deg % 7];
    const nextRoot = rootMidi - 12 + scale[nextDeg % 7];
    const fifth = root + 7;
    const t0 = bar * 4;
    if (style === "jazz") {
      // Walking quarters: root, chord tone, scale walk, chromatic approach.
      const third = root + (chordAt(mode, deg, false)[1] - scale[deg % 7]);
      const approach = nextRoot + (nextRoot > root ? -1 : 1);
      const line = [root, third, fifth, approach];
      line.forEach((p, i) => notes.push({ t: t0 + i, d: 0.95, p, v: jitter(rng, 0.5, 0.1) }));
    } else if (style === "lofi") {
      notes.push({ t: t0, d: 1.6, p: root, v: 0.55 });
      notes.push({ t: t0 + 2.5, d: 1.2, p: chance(rng, 0.5) ? fifth : root, v: 0.42 });
    } else if (style === "classical") {
      notes.push({ t: t0, d: 1.9, p: root, v: 0.5 });
      notes.push({ t: t0 + 2, d: 1.9, p: chance(rng, 0.4) ? fifth : root, v: 0.44 });
    } else {
      notes.push({ t: t0, d: 4, p: root, v: 0.4 }); // ambient drone
    }
  }
  return notes;
}

function drumTrack(rng, style, bars) {
  const notes = [];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4;
    if (style === "lofi") {
      notes.push({ t: t0, d: 0.2, p: 36, v: 0.85 }); // kick on 1
      if (chance(rng, 0.6)) notes.push({ t: t0 + 2.75, d: 0.2, p: 36, v: 0.6 });
      notes.push({ t: t0 + 1, d: 0.15, p: 38, v: 0.7 }); // snare 2, 4
      notes.push({ t: t0 + 3, d: 0.15, p: 38, v: 0.72 });
      for (let i = 0; i < 8; i++) {
        if (chance(rng, 0.9)) notes.push({ t: t0 + i * 0.5, d: 0.08, p: 42, v: jitter(rng, 0.3, 0.15) });
      }
    } else if (style === "jazz") {
      // Ride-ish pattern on hat: 1, 2&, 3, 4& — swung by the renderer.
      for (const h of [0, 1, 1.5, 2, 3, 3.5]) {
        notes.push({ t: t0 + h, d: 0.1, p: 42, v: jitter(rng, 0.32, 0.12) });
      }
      if (chance(rng, 0.35)) notes.push({ t: t0 + pick(rng, [1.5, 2.5, 3.5]), d: 0.12, p: 38, v: 0.3 }); // ghost
      notes.push({ t: t0 + 1, d: 0.1, p: 46, v: 0.25 });
      notes.push({ t: t0 + 3, d: 0.1, p: 46, v: 0.25 });
    }
  }
  return notes;
}

// ── The composer ────────────────────────────────────────────────────

export function generateScore(seed, opts = {}) {
  const rng = mulberry32(hashStr(String(seed)));
  const mood = opts.mood && MOODS[opts.mood] ? opts.mood : null;
  const style =
    opts.style && STYLE_DEFAULTS[opts.style]
      ? opts.style
      : mood
        ? pick(rng, MOODS[mood].styles)
        : pick(rng, Object.keys(STYLE_DEFAULTS));
  const cfg = STYLE_DEFAULTS[style];
  const mode = opts.mode && MODES[opts.mode] ? opts.mode : mood ? pick(rng, MOODS[mood].modes) : pick(rng, Object.keys(MODES));
  const key = opts.key && KEY_ROOTS[opts.key] ? opts.key : pick(rng, Object.keys(KEY_ROOTS));
  const rootMidi = KEY_ROOTS[key];
  const bars = opts.bars ?? (style === "ambient" ? 12 : 16);
  const bpmBase = cfg.bpmRange[0] + Math.floor(rng() * (cfg.bpmRange[1] - cfg.bpmRange[0]));
  const bpm = Math.max(48, Math.min(150, bpmBase + (mood ? MOODS[mood].tempoBias : 0) + (opts.tempoNudge ?? 0)));
  const progression = pick(rng, PROGRESSIONS[style]);

  const tracks = [
    { voice: style === "ambient" ? "pad" : "pluck", gain: 0.9, notes: melodyTrack(rng, style, mode, rootMidi, bars, progression, cfg.seventh) },
    { voice: style === "classical" ? "keys" : "pad", gain: style === "jazz" ? 0.5 : 0.62, notes: compTrack(rng, style, mode, rootMidi, bars, progression, cfg.seventh) },
    { voice: "bass", gain: 0.75, notes: bassTrack(rng, style, mode, rootMidi, bars, progression, cfg.seventh) },
  ];
  if (cfg.drums) tracks.push({ voice: "drums", gain: style === "lofi" ? 0.8 : 0.5, notes: drumTrack(rng, style, bars) });

  return {
    title: opts.title ?? nameFor(rng, style, mood),
    style,
    seed: String(seed),
    by: opts.by ?? "engine",
    bpm,
    swing: cfg.swing,
    key,
    mode,
    bars,
    beatsPerBar: 4,
    tracks,
  };
}

const NAME_A = ["Amber", "Recipe", "Harbor", "Velvet", "Copper", "Quiet", "Serpent", "Beacon", "Paper", "Winter", "Golden", "Hidden"];
const NAME_B = {
  classical: ["Processional", "Air", "Canon", "Minuet", "Aubade"],
  jazz: ["Strut", "Turnaround", "Blue", "Afterhours", "Stride"],
  lofi: ["Return", "Windowsill", "Teacup", "Rainline", "Slowpost"],
  ambient: ["Drift", "Field", "Halo", "Tide", "Vigil"],
};

function nameFor(rng, style, mood) {
  const a = pick(rng, NAME_A);
  const b = pick(rng, NAME_B[style]);
  return mood ? `${a} ${b} (${mood})` : `${a} ${b}`;
}

// ── Validation + ABC export (melody line, for human-readable diffs) ─

export function validateScore(score) {
  const errs = [];
  if (!score.tracks?.length) errs.push("no tracks");
  const total = score.bars * score.beatsPerBar;
  for (const tr of score.tracks ?? []) {
    for (const n of tr.notes) {
      if (n.t < 0 || n.t >= total) errs.push(`note out of range t=${n.t} (${tr.voice})`);
      if (tr.voice !== "drums" && (n.p < 24 || n.p > 96)) errs.push(`pitch out of range p=${n.p} (${tr.voice})`);
      if (n.d <= 0) errs.push(`non-positive duration (${tr.voice})`);
      if (n.v < 0 || n.v > 1) errs.push(`velocity out of range (${tr.voice})`);
    }
  }
  return errs;
}

const ABC_NOTES = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];

export function scoreToABC(score) {
  const melody = score.tracks[0]?.notes ?? [];
  const unit = 0.5; // L:1/8
  let out = `X:1\nT:${score.title}\nM:${score.beatsPerBar}/4\nL:1/8\nQ:1/4=${score.bpm}\nK:${score.key}${score.mode === "minor" ? "m" : score.mode === "dorian" ? " dor" : ""}\n`;
  let line = "";
  let cursor = 0;
  for (const n of melody) {
    if (n.t > cursor + 0.001) {
      const restLen = Math.round((n.t - cursor) / unit);
      if (restLen > 0) line += `z${restLen > 1 ? restLen : ""} `;
    }
    const len = Math.max(1, Math.round(n.d / unit));
    const pc = ((n.p % 12) + 12) % 12;
    const oct = Math.floor(n.p / 12) - 1;
    let sym = ABC_NOTES[pc];
    if (oct >= 5) sym = sym.toLowerCase() + "'".repeat(Math.max(0, oct - 5));
    else sym = sym + ",".repeat(Math.max(0, 4 - oct));
    line += `${sym}${len > 1 ? len : ""} `;
    cursor = n.t + n.d;
    if (line.length > 56) {
      out += line.trim() + "\n";
      line = "";
    }
  }
  return out + line.trim() + " |]\n";
}
