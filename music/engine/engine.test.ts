/** 音響 engine — the composer is deterministic, in-range, and styled.
 *
 *  Determinism IS the recipe principle applied to music: the same seed
 *  must rebuild the same piece on any device, any day. These tests pin it.
 */

import { describe, expect, test } from "bun:test";

import { generateScore, scoreToABC, validateScore, MOODS } from "./engine.js";

const STYLES = ["classical", "jazz", "lofi", "ambient"] as const;

describe("generateScore", () => {
  test("same seed → identical score (the recipe principle)", () => {
    const a = generateScore("beltane-2026", { style: "classical" });
    const b = generateScore("beltane-2026", { style: "classical" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("different seeds → different pieces", () => {
    const a = generateScore("seed-one");
    const b = generateScore("seed-two");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  for (const style of STYLES) {
    test(`${style}: valid, styled, and populated`, () => {
      const s = generateScore(`test-${style}`, { style });
      expect(validateScore(s)).toEqual([]);
      expect(s.style).toBe(style);
      expect(s.tracks.length).toBeGreaterThanOrEqual(3);
      expect(s.tracks[0]!.notes.length).toBeGreaterThan(4);
      expect(s.bpm).toBeGreaterThanOrEqual(48);
      expect(s.bpm).toBeLessThanOrEqual(150);
      const hasDrums = s.tracks.some((t) => t.voice === "drums");
      expect(hasDrums).toBe(style === "jazz" || style === "lofi");
    });
  }

  test("every mood resolves to a legal style", () => {
    for (const mood of Object.keys(MOODS)) {
      const s = generateScore(`mood-${mood}`, { mood });
      expect(validateScore(s)).toEqual([]);
      expect(MOODS[mood as keyof typeof MOODS].styles).toContain(s.style);
    }
  });

  test("tempoNudge shifts bpm without leaving bounds", () => {
    const base = generateScore("hb", { style: "lofi" });
    const nudged = generateScore("hb", { style: "lofi", tempoNudge: 4 });
    expect(nudged.bpm).toBe(base.bpm + 4);
  });
});

describe("scoreToABC", () => {
  test("emits a well-formed header and terminates the tune", () => {
    const abc = scoreToABC(generateScore("abc-test", { style: "classical", key: "D", mode: "major" }));
    expect(abc).toContain("X:1");
    expect(abc).toContain("K:D");
    expect(abc.trim().endsWith("|]")).toBe(true);
  });
});
